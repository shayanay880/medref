import React, { useState, useEffect } from 'react';
import { Layout } from './components/Layout';
import { InputPanel } from './components/InputPanel';
import { OutputPanel } from './components/OutputPanel';
import { HistorySidebar } from './components/HistorySidebar';
import { PipelineUI } from './components/PipelineUI';
import { ChunkNavigator } from './components/ChunkNavigator';
import { Session, AppSettings, ViewMode, PipelineState, ExtractedChunkData, StructuredOutput, OutlineResult, ChunkPlanEntry, ChunkResultState } from './types';
import * as storageService from './services/storageService';
import * as geminiService from './services/geminiService';
import { splitTextIntoChunks } from './services/pipelineService';
import { MODEL_NAME } from './constants';

const DEFAULT_SETTINGS: AppSettings = {
  outputLength: 'Standard',
  includeExtra: false, // Strict Mode ON by default
  includeTranslation: false,
  highlightDensity: 'Medium',
};

const DEFAULT_PIPELINE_STATE: PipelineState = {
  status: 'idle',
  totalChunks: 0,
  processedChunks: 0,
  outline: [],
  outlineResult: undefined,
  rawInputHash: undefined,
  chunkStates: {},
  chunkResults: []
};

const computeHash = (text: string) => {
  let hash = 0;
  for (let i = 0; i < text.length; i++) {
    hash = (hash << 5) - hash + text.charCodeAt(i);
    hash |= 0;
  }
  return hash.toString();
};

const App: React.FC = () => {
  const [sessions, setSessions] = useState<Session[]>([]);
  const [currentSessionId, setCurrentSessionId] = useState<string | null>(null);
  const [isSidebarOpen, setIsSidebarOpen] = useState(true);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [viewMode, setViewMode] = useState<ViewMode>('input'); 
  
  const [inputTitle, setInputTitle] = useState('');
  const [inputText, setInputText] = useState('');
  const [inputTags, setInputTags] = useState('');
  const [settings, setSettings] = useState<AppSettings>(DEFAULT_SETTINGS);
  const [outputMarkdown, setOutputMarkdown] = useState('');
  const [outputJson, setOutputJson] = useState<StructuredOutput | null>(null);
  const [pipelineState, setPipelineState] = useState<PipelineState>(DEFAULT_PIPELINE_STATE);
  const [resumeSessionId, setResumeSessionId] = useState<string | null>(null);

  useEffect(() => {
    const loadSessions = async () => {
      try {
        const stored = await storageService.getAllSessions();
        setSessions(stored.sort((a, b) => b.createdAt - a.createdAt));
      } catch (err) {
        console.error("Failed to load sessions", err);
      }
    };
    loadSessions();
  }, []);

  useEffect(() => {
    if (currentSessionId) {
      const session = sessions.find(s => s.id === currentSessionId);
      if (session) {
        setInputTitle(session.title);
        setInputText(session.inputText);
        setInputTags(session.tags.join(', '));
        setSettings({ ...DEFAULT_SETTINGS, ...session.settings });
        setOutputMarkdown(session.outputMarkdown || '');
        setOutputJson(session.outputJson || null);
        if (session.pipelineState) {
          setPipelineState({
            ...DEFAULT_PIPELINE_STATE,
            ...session.pipelineState,
            chunkStates: session.pipelineState.chunkStates || {},
            chunkResults: session.pipelineState.chunkResults || []
          });
        }
        setViewMode(session.outputMarkdown ? 'output' : 'input');
      }
    }
  }, [currentSessionId, sessions]);

  useEffect(() => {
    const hash = computeHash(inputText || '');
    const match = sessions.find((s) => s.pipelineState?.rawInputHash === hash && s.pipelineState?.status !== 'complete');
    setResumeSessionId(match ? match.id : null);
  }, [inputText, sessions]);

  const handleCreateNew = () => {
    setCurrentSessionId(null);
    setInputTitle('');
    setInputText('');
    setInputTags('');
    setSettings(DEFAULT_SETTINGS);
    setOutputMarkdown('');
    setOutputJson(null);
    setPipelineState(DEFAULT_PIPELINE_STATE);
    setViewMode('input');
    if (window.innerWidth < 1024) setIsSidebarOpen(false);
  };

  const handleResumeExisting = () => {
    if (!resumeSessionId) return;
    const session = sessions.find((s) => s.id === resumeSessionId);
    if (!session) return;
    setCurrentSessionId(session.id);
    setInputTitle(session.title);
    setInputText(session.inputText);
    setInputTags(session.tags.join(', '));
    setSettings({ ...DEFAULT_SETTINGS, ...session.settings });
    setOutputMarkdown(session.outputMarkdown || '');
    setOutputJson(session.outputJson || null);
    setPipelineState({
      ...DEFAULT_PIPELINE_STATE,
      ...session.pipelineState,
      chunkStates: session.pipelineState?.chunkStates || {},
      chunkResults: session.pipelineState?.chunkResults || []
    });
    setViewMode('output');
  };

  const deriveChunkResults = (states: Record<number, ChunkResultState>): ExtractedChunkData[] =>
    Object.values(states)
      .filter((s) => s.result)
      .sort((a, b) => a.chunkId - b.chunkId)
      .map((s) => ({ ...s.result! }));

  const persistState = async (next: PipelineState, markdown?: string) => {
    setPipelineState(next);
    await saveSessionData(markdown ?? outputMarkdown ?? '', next);
  };

  const buildChunkPlan = (text: string, outline: any): { plan: ChunkPlanEntry[]; rawChunks: { text: string; start: number; end: number }[] } => {
    const rawChunks = splitTextIntoChunks(text);
    const plan = rawChunks.map((c, idx) => ({
      chunkId: idx,
      title: `Chunk ${idx + 1}`,
      start: c.start,
      end: c.end,
      outlineIdsCovered: outline?.map ? outline.map((o: any) => o.id) : []
    }));
    return { plan, rawChunks };
  };

  const initializeChunkStates = (plan: ChunkPlanEntry[]): Record<number, ChunkResultState> => {
    return plan.reduce<Record<number, ChunkResultState>>((acc, entry) => {
      acc[entry.chunkId] = { chunkId: entry.chunkId, status: 'pending', attempts: 0 };
      return acc;
    }, {});
  };

  const runChunkPlan = async (
    plan: ChunkPlanEntry[],
    existingStates: Record<number, ChunkResultState>,
    hash: string,
    outlineResult: OutlineResult,
    baseState: PipelineState
  ) => {
    let states = { ...existingStates };
    let encounteredError: string | undefined;

    for (const entry of plan) {
      const currentState = states[entry.chunkId] || { chunkId: entry.chunkId, status: 'pending', attempts: 0 };
      if (currentState.status === 'complete' && currentState.result) {
        continue;
      }

      const runningState: ChunkResultState = {
        ...currentState,
        status: 'running',
        attempts: (currentState.attempts || 0) + 1,
        lastError: undefined
      };
      states[entry.chunkId] = runningState;

      const interimState: PipelineState = {
        ...baseState,
        status: 'chunking',
        rawInputHash: hash,
        outline: outlineResult.outline,
        outlineResult,
        totalChunks: plan.length,
        processedChunks: Object.values(states).filter((s) => s.status === 'complete').length,
        chunkStates: states,
        chunkResults: deriveChunkResults(states)
      };
      await persistState(interimState);

      try {
        const chunkText = inputText.slice(entry.start, entry.end);
        const chunkData = await geminiService.processChunk(chunkText, entry.chunkId, plan.length, settings);
        const result: ChunkResultState = {
          ...runningState,
          status: 'complete',
          result: { ...chunkData, sourceStart: entry.start, sourceEnd: entry.end }
        };
        states[entry.chunkId] = result;
      } catch (err: any) {
        states[entry.chunkId] = {
          ...runningState,
          status: 'error',
          lastError: err?.message || 'Chunk failed'
        };
        encounteredError = err?.message || 'Chunk failed';
      }

      const updatedState: PipelineState = {
        ...baseState,
        status: encounteredError ? 'error' : 'chunking',
        rawInputHash: hash,
        outline: outlineResult.outline,
        outlineResult,
        totalChunks: plan.length,
        processedChunks: Object.values(states).filter((s) => s.status === 'complete').length,
        chunkStates: states,
        chunkResults: deriveChunkResults(states),
        currentError: encounteredError
      };
      await persistState(updatedState);
    }

    return { states, encounteredError };
  };

  const handlePipelineGenerate = async () => {
    if (!inputText.trim()) return;

    setIsLoading(true);
    setError(null);
    setViewMode('output');

    const rawInputHash = computeHash(inputText);
    setPipelineState((prev) => ({ ...prev, status: 'outlining', currentError: undefined, rawInputHash }));

    try {
      const outlineSections = await geminiService.generateOutline(inputText);
      const { plan } = buildChunkPlan(inputText, outlineSections);
      const outlineResult: OutlineResult = {
        outline: outlineSections,
        coverageChecklist: outlineSections.map((o) => o.id),
        chunkPlan: plan
      };

      const chunkStates = initializeChunkStates(plan);

      const outlineState: PipelineState = {
        status: 'chunking',
        totalChunks: plan.length,
        processedChunks: 0,
        outline: outlineSections,
        outlineResult,
        rawInputHash,
        chunkStates,
        chunkResults: []
      };
      await persistState(outlineState);

      const { states, encounteredError } = await runChunkPlan(plan, chunkStates, rawInputHash, outlineResult, outlineState);

      if (encounteredError) {
        setError('Some chunks failed. Retry individually or continue pipeline.');
        setIsLoading(false);
        return;
      }

      const completeState: PipelineState = {
        ...outlineState,
        status: 'stitching',
        chunkStates: states,
        chunkResults: deriveChunkResults(states),
        processedChunks: Object.values(states).filter((s) => s.status === 'complete').length
      };
      await persistState(completeState);

      const finalMarkdown = await geminiService.stitchFinalOutput(
        outlineSections,
        deriveChunkResults(states),
        settings,
        inputText.slice(0, 5000)
      );

      setOutputMarkdown(finalMarkdown);
      setOutputJson({ markdownOutput: finalMarkdown });

      const finalState: PipelineState = {
        ...completeState,
        status: 'complete',
        chunkResults: deriveChunkResults(states),
        processedChunks: completeState.totalChunks,
        markdownOutput: finalMarkdown
      };

      await persistState(finalState, finalMarkdown);

    } catch (err: any) {
      console.error(err);
      setError("Pipeline failed: " + err.message);
      const failedState: PipelineState = { ...pipelineState, status: 'error', currentError: err.message };
      await persistState(failedState);
    } finally {
      setIsLoading(false);
    }
  };

  const handleContinuePipeline = async () => {
    if (!pipelineState.outlineResult || !pipelineState.rawInputHash) return;
    setIsLoading(true);
    setError(null);

    try {
      const { chunkPlan } = pipelineState.outlineResult;
      const { states, encounteredError } = await runChunkPlan(
        chunkPlan,
        pipelineState.chunkStates || {},
        pipelineState.rawInputHash,
        pipelineState.outlineResult,
        pipelineState
      );

      if (encounteredError) {
        setError('Some chunks failed. Retry failed chunks.');
        setIsLoading(false);
        return;
      }

      const readyState: PipelineState = {
        ...pipelineState,
        status: 'stitching',
        chunkStates: states,
        chunkResults: deriveChunkResults(states),
        processedChunks: Object.values(states).filter((s) => s.status === 'complete').length
      };
      await persistState(readyState);

      const finalMarkdown = await geminiService.stitchFinalOutput(
        pipelineState.outline,
        deriveChunkResults(states),
        settings,
        inputText.slice(0, 5000)
      );

      setOutputMarkdown(finalMarkdown);
      setOutputJson({ markdownOutput: finalMarkdown });

      const finalState: PipelineState = {
        ...readyState,
        status: 'complete',
        markdownOutput: finalMarkdown,
        processedChunks: readyState.totalChunks
      };
      await persistState(finalState, finalMarkdown);
    } catch (err: any) {
      setError('Resume failed: ' + err.message);
      const failedState: PipelineState = { ...pipelineState, status: 'error', currentError: err.message };
      await persistState(failedState);
    } finally {
      setIsLoading(false);
    }
  };

  const handleRunSingleChunk = async (chunkId: number) => {
    if (!pipelineState.outlineResult || !pipelineState.rawInputHash) return;
    const planEntry = pipelineState.outlineResult.chunkPlan.find((c) => c.chunkId === chunkId);
    if (!planEntry) return;
    setIsLoading(true);
    setError(null);

    try {
      const runningState: Record<number, ChunkResultState> = {
        ...pipelineState.chunkStates,
      };
      const current = runningState[chunkId] || { chunkId, status: 'pending', attempts: 0 };
      runningState[chunkId] = { ...current, status: 'running', attempts: (current.attempts || 0) + 1, lastError: undefined };

      const interim: PipelineState = {
        ...pipelineState,
        status: 'chunking',
        chunkStates: runningState,
        processedChunks: Object.values(runningState).filter((s) => s.status === 'complete').length,
        chunkResults: deriveChunkResults(runningState)
      };
      await persistState(interim);

      const chunkText = inputText.slice(planEntry.start, planEntry.end);
      const chunkData = await geminiService.processChunk(chunkText, planEntry.chunkId, pipelineState.outlineResult.chunkPlan.length, settings);

      runningState[chunkId] = {
        ...runningState[chunkId],
        status: 'complete',
        result: { ...chunkData, sourceStart: planEntry.start, sourceEnd: planEntry.end }
      };

      const updated: PipelineState = {
        ...pipelineState,
        status: 'chunking',
        chunkStates: runningState,
        chunkResults: deriveChunkResults(runningState),
        processedChunks: Object.values(runningState).filter((s) => s.status === 'complete').length
      };
      await persistState(updated);
    } catch (err: any) {
      const failedState: Record<number, ChunkResultState> = {
        ...pipelineState.chunkStates,
        [chunkId]: {
          ...(pipelineState.chunkStates?.[chunkId] || { chunkId, attempts: 0, status: 'pending' }),
          status: 'error',
          attempts: (pipelineState.chunkStates?.[chunkId]?.attempts || 0) + 1,
          lastError: err?.message || 'Chunk failed'
        }
      };
      setError('Chunk retry failed');
      const updated: PipelineState = {
        ...pipelineState,
        status: 'error',
        chunkStates: failedState,
        chunkResults: deriveChunkResults(failedState),
        currentError: err?.message
      };
      await persistState(updated);
    } finally {
      setIsLoading(false);
    }
  };

  const handleRetryFailedChunks = async () => {
    if (!pipelineState.outlineResult || !pipelineState.rawInputHash) return;
    const hasFailures = Object.values(pipelineState.chunkStates || {}).some((c) => c.status === 'error');
    if (!hasFailures) return;
    await handleContinuePipeline();
  };

  const saveSessionData = async (markdown: string, pState: PipelineState) => {
    const now = Date.now();
    const sessionData: Session = {
      id: currentSessionId || crypto.randomUUID(),
      createdAt: currentSessionId ? (sessions.find(s => s.id === currentSessionId)?.createdAt || now) : now,
      title: inputTitle || 'Study Session',
      tags: inputTags.split(',').map(t => t.trim()).filter(Boolean),
      inputText,
      modelUsed: MODEL_NAME,
      outputMarkdown: markdown,
      outputJson: { markdownOutput: markdown }, 
      settings,
      pipelineState: pState
    };

    await storageService.saveSession(sessionData);
    setSessions(prev => {
      const existingIdx = prev.findIndex(s => s.id === sessionData.id);
      if (existingIdx >= 0) {
        const updated = [...prev];
        updated[existingIdx] = sessionData;
        return updated.sort((a, b) => b.createdAt - a.createdAt);
      }
      return [sessionData, ...prev];
    });
    setCurrentSessionId(sessionData.id);
  };

  const handleDeleteSession = async (id: string) => {
    await storageService.deleteSession(id);
    setSessions(prev => prev.filter(s => s.id !== id));
    if (currentSessionId === id) handleCreateNew();
  };

  return (
           <Layout
      sidebar={
        <HistorySidebar 
          sessions={sessions}
          currentSessionId={currentSessionId}
          onSelectSession={(id) => {
            setCurrentSessionId(id);
            if (window.innerWidth < 1024) setIsSidebarOpen(false);
          }}
          onDeleteSession={handleDeleteSession}
          onNewSession={handleCreateNew}
          isOpen={isSidebarOpen}
          setIsOpen={setIsSidebarOpen}
        />
      }
      isSidebarOpen={isSidebarOpen}
      toggleSidebar={() => setIsSidebarOpen(!isSidebarOpen)}
    >
      <div className="h-full flex flex-col lg:flex-row overflow-hidden relative">
        <div className="lg:hidden flex border-b border-slate-200 bg-white">
           <button onClick={() => setViewMode('input')} className={`flex-1 py-3 text-sm font-medium ${viewMode === 'input' ? 'text-teal-600 border-b-2 border-teal-600' : 'text-slate-500'}`}>Input</button>
           <button onClick={() => setViewMode('output')} className={`flex-1 py-3 text-sm font-medium ${viewMode === 'output' ? 'text-teal-600 border-b-2 border-teal-600' : 'text-slate-500'}`}>Output</button>
        </div>

        <div className={`flex-1 h-full overflow-y-auto bg-white border-r border-slate-200 ${viewMode !== 'input' ? 'hidden lg:block' : 'block'}`}>
          <InputPanel
            title={inputTitle} setTitle={setInputTitle}
            text={inputText} setText={setInputText}
            tags={inputTags} setTags={setInputTags}
            settings={settings} setSettings={setSettings}
            onGenerate={handlePipelineGenerate}
            onResume={resumeSessionId ? handleResumeExisting : undefined}
            resumeAvailable={Boolean(resumeSessionId)}
            isLoading={isLoading} error={error}
          />
        </div>

        <div className={`flex-1 h-full overflow-y-auto bg-slate-50 ${viewMode === 'input' ? 'hidden lg:block' : ''} p-4 md:p-6`}>
           <div className="max-w-4xl mx-auto">
             <PipelineUI state={pipelineState} onRetry={handlePipelineGenerate} />
             <ChunkNavigator
               chunkPlan={pipelineState.outlineResult?.chunkPlan}
               chunkStates={pipelineState.chunkStates || {}}
               onRunChunk={handleRunSingleChunk}
               onRetryFailed={handleRetryFailedChunks}
               onContinueAll={handleContinuePipeline}
               isProcessing={isLoading}
             />
             <OutputPanel
                markdown={outputMarkdown}
                json={outputJson}
                pipelineState={pipelineState}
                isLoading={isLoading}
             />
           </div>
        </div>
      </div>
    </Layout>
  );
};

export default App;