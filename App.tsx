import React, { useState, useEffect } from 'react';
import { Layout } from './components/Layout';
import { InputPanel } from './components/InputPanel';
import { OutputPanel } from './components/OutputPanel';
import { HistorySidebar } from './components/HistorySidebar';
import { PipelineUI } from './components/PipelineUI';
import { ChunkSidebar } from './components/ChunkSidebar';
import { Session, AppSettings, ViewMode, PipelineState, ExtractedChunkData, StructuredOutput, ChunkResultState } from './types';
import * as storageService from './services/storageService';
import * as geminiService from './services/geminiService';
import { calculateCoverageReport, splitTextIntoChunks } from './services/pipelineService';
import { hashString } from './services/hashService';
import { MODEL_NAME } from './constants';

const DEFAULT_SETTINGS: AppSettings = {
  outputLength: 'Standard',
  includeExtra: false, // Strict Mode ON by default
  includeTranslation: false,
  highlightDensity: 'Medium',
};

const createDefaultPipelineState = (settingsSnapshot: AppSettings): PipelineState => ({
  status: 'idle',
  rawInputHash: undefined,
  settingsSnapshot,
  totalChunks: 0,
  processedChunks: 0,
  outline: [],
  outlineResult: undefined,
  chunkResults: [],
  coverageReport: {},
  outlineNotice: undefined,
  stitchedOutput: undefined,
  stitchQAReport: undefined
});

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
  const [pipelineState, setPipelineState] = useState<PipelineState>(createDefaultPipelineState(DEFAULT_SETTINGS));
  const [resumeCandidate, setResumeCandidate] = useState<Session | null>(null);

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
    const detectResumeCandidate = async () => {
      if (currentSessionId || resumeCandidate || sessions.length === 0) return;

      for (const session of sessions) {
        if (!session.pipelineState || !session.rawInputHash) continue;
        const computedHash = await hashString(session.inputText || '');
        const inProgress = session.pipelineState.status !== 'complete' && session.pipelineState.status !== 'idle';
        if (computedHash === session.rawInputHash && inProgress) {
          setResumeCandidate(session);
          break;
        }
      }
    };

    detectResumeCandidate();
  }, [sessions, currentSessionId, resumeCandidate]);

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
          const checklistFallback = session.pipelineState.outline?.map(section => ({
            sectionId: section.id,
            title: section.title,
            covered: Boolean(session.pipelineState?.coverageReport?.[section.id])
          }));

          const hydrated = {
            ...createDefaultPipelineState(session.pipelineState.settingsSnapshot || session.settings),
            ...session.pipelineState,
            rawInputHash: session.pipelineState.rawInputHash || session.rawInputHash,
            outlineResult: session.pipelineState.outlineResult || (session.pipelineState.outline.length
              ? {
                  outline: session.pipelineState.outline,
                  coverageChecklist: checklistFallback,
                  chunkPlan: session.pipelineState.chunkResults.map((chunk, idx) => ({
                    chunkId: chunk.chunkId ?? idx,
                    start: chunk.sourceStart ?? 0,
                    end: chunk.sourceEnd ?? 0,
                    length: Math.max((chunk.sourceEnd || 0) - (chunk.sourceStart || 0), 0)
                  }))
                }
              : undefined),
            stitchedOutput: session.pipelineState.stitchedOutput || session.outputMarkdown,
          } as PipelineState;

          setPipelineState(hydrated);
        } else {
          setPipelineState(createDefaultPipelineState(session.settings));
        }
        setViewMode(session.outputMarkdown ? 'output' : 'input');
      }
    }
  }, [currentSessionId, sessions]);

  const handleCreateNew = () => {
    setCurrentSessionId(null);
    setInputTitle('');
    setInputText('');
    setInputTags('');
    setSettings(DEFAULT_SETTINGS);
    setOutputMarkdown('');
    setOutputJson(null);
    setPipelineState(createDefaultPipelineState(DEFAULT_SETTINGS));
    setViewMode('input');
    if (window.innerWidth < 1024) setIsSidebarOpen(false);
  };

  const handlePipelineGenerate = async () => {
    if (!inputText.trim()) return;

    setIsLoading(true);
    setError(null);
    setViewMode('output');
    let pipelineProgress: PipelineState | null = null;
    try {
      const rawInputHash = await hashString(inputText);
      setOutputMarkdown('');
      setOutputJson(null);

      // --- PHASE A: OUTLINE ---
      pipelineProgress = {
        ...createDefaultPipelineState(settings),
        status: 'outlining',
        rawInputHash,
        settingsSnapshot: settings,
        currentError: undefined,
        outlineNotice: undefined
      };
      setPipelineState(pipelineProgress);
      await saveSessionData('', pipelineProgress);

      const outlineResult = await geminiService.generateOutline(inputText);
      const outline = outlineResult.outline;
      const chunks = splitTextIntoChunks(inputText);
      const outlineChecklist = outline.map(section => ({
        sectionId: section.id,
        title: section.title,
        covered: false
      }));
      const chunkPlan = chunks.map((chunk, idx) => ({
        chunkId: idx,
        start: chunk.start,
        end: chunk.end,
        length: chunk.text.length
      }));

      pipelineProgress = {
        ...pipelineProgress,
        status: 'chunking',
        outline,
        outlineResult: { ...outlineResult, coverageChecklist: outlineResult.coverageChecklist || outlineChecklist, chunkPlan },
        totalChunks: chunks.length,
        processedChunks: 0,
        chunkResults: chunkPlan.map(plan => ({
          chunkId: plan.chunkId,
          status: 'pending',
          attempts: 0,
          sourceStart: plan.start,
          sourceEnd: plan.end
        })),
        coverageReport: {},
        outlineNotice: outlineResult.notice
      };
      setPipelineState(pipelineProgress);
      await saveSessionData('', pipelineProgress);

      // --- PHASE B: CHUNK PROCESSING ---
      for (let i = 0; i < chunks.length; i++) {
        const { text: chunkText, start: sourceStart, end: sourceEnd } = chunks[i];
        const updatedChunks: ChunkResultState[] = pipelineProgress.chunkResults.map(cr => ({ ...cr }));
        const existing = updatedChunks[i];
        updatedChunks[i] = {
          ...existing,
          status: 'processing',
          attempts: (existing?.attempts || 0) + 1,
          lastError: undefined,
          sourceStart,
          sourceEnd
        };

        pipelineProgress = {
          ...pipelineProgress,
          chunkResults: updatedChunks,
          totalChunks: chunks.length,
        };
        setPipelineState(pipelineProgress);
        await saveSessionData('', pipelineProgress);

        try {
          const chunkData = await geminiService.processChunk(chunkText, i, chunks.length, settings, sourceStart, sourceEnd);

          const completedChunks = pipelineProgress.chunkResults.map((cr, idx) => idx === i ? {
            ...cr,
            status: 'success' as const,
            lastError: undefined,
            data: chunkData,
          } : cr);

          const processedCount = completedChunks.filter(cr => cr.status === 'success').length;
          const coverageReport = calculateCoverageReport(outline, completedChunks
            .map(cr => cr.data)
            .filter(Boolean) as ExtractedChunkData[]);

          pipelineProgress = {
            ...pipelineProgress,
            chunkResults: completedChunks,
            processedChunks: processedCount,
            coverageReport,
          };

          setPipelineState(pipelineProgress);
          await saveSessionData('', pipelineProgress);
        } catch (chunkErr: any) {
          const failedChunks = pipelineProgress.chunkResults.map((cr, idx) => idx === i ? {
            ...cr,
            status: 'error' as const,
            lastError: chunkErr?.message || 'Chunk failed'
          } : cr);

          pipelineProgress = {
            ...pipelineProgress,
            chunkResults: failedChunks,
            status: 'error',
            currentError: chunkErr?.message || 'Chunk failed'
          };

          setPipelineState(pipelineProgress);
          await saveSessionData('', pipelineProgress);
          throw chunkErr;
        }
      }

      // --- PHASE C: STITCHING ---
      pipelineProgress = { ...pipelineProgress, status: 'stitching' };
      setPipelineState(pipelineProgress);
      await saveSessionData('', pipelineProgress);

      const successfulChunks = pipelineProgress.chunkResults
        .filter(cr => cr.status === 'success' && cr.data)
        .map(cr => cr.data!) as ExtractedChunkData[];

      const finalMarkdown = await geminiService.stitchFinalOutput(outline, successfulChunks, settings, inputText.slice(0, 5000));
      const finalCoverage = calculateCoverageReport(outline, successfulChunks, finalMarkdown);

      const finalState: PipelineState = {
        ...pipelineProgress,
        status: 'complete',
        outline,
        outlineNotice: outlineResult.notice,
        chunkResults: pipelineProgress.chunkResults,
        totalChunks: chunks.length,
        processedChunks: chunks.length,
        coverageReport: finalCoverage,
        stitchedOutput: finalMarkdown,
        stitchQAReport: { summary: 'Stitching completed; QA passthrough ready.' }
      };

      setOutputMarkdown(finalMarkdown);
      setOutputJson({
        markdownOutput: finalMarkdown,
        rawInputHash,
        settingsSnapshot: settings,
        stitchQAReport: finalState.stitchQAReport,
        pipelineState: finalState
      });

      setPipelineState(finalState);
      await saveSessionData(finalMarkdown, finalState);

    } catch (err: any) {
      console.error(err);
      setError("Pipeline failed: " + err.message);
      setPipelineState(prev => ({ ...prev, status: 'error', currentError: err.message }));
      if (pipelineProgress) {
        await saveSessionData(outputMarkdown, { ...pipelineProgress, status: 'error', currentError: err.message });
      }
    } finally {
      setIsLoading(false);
    }
  };

  const saveSessionData = async (markdown: string, pState: PipelineState, jsonOverride?: StructuredOutput | null) => {
    const now = Date.now();
    const existing = currentSessionId ? sessions.find(s => s.id === currentSessionId) : undefined;
    const safeMarkdown = markdown ?? outputMarkdown;
    const structuredOutput = jsonOverride !== undefined
      ? jsonOverride
      : safeMarkdown
        ? {
            markdownOutput: safeMarkdown,
            rawInputHash: pState.rawInputHash,
            settingsSnapshot: pState.settingsSnapshot,
            stitchQAReport: pState.stitchQAReport,
            pipelineState: pState
          }
        : outputJson;

    const sessionData: Session = {
      id: currentSessionId || crypto.randomUUID(),
      createdAt: currentSessionId ? (existing?.createdAt || now) : now,
      title: inputTitle || 'Study Session',
      tags: inputTags.split(',').map(t => t.trim()).filter(Boolean),
      inputText,
      rawInputHash: pState.rawInputHash,
      modelUsed: MODEL_NAME,
      outputMarkdown: safeMarkdown,
      outputJson: structuredOutput || null,
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

  const handleResumeSession = () => {
    if (resumeCandidate) {
      setCurrentSessionId(resumeCandidate.id);
      setResumeCandidate(null);
      setViewMode('output');
    }
  };

  const handleStartFreshRun = () => {
    setResumeCandidate(null);
    handleCreateNew();
  };
  
  // Re-implement single chunk run for sidebar
  const handleRunChunk = async (chunkIndex: number) => {
      const chunks = splitTextIntoChunks(inputText);
      const chunk = chunks[chunkIndex];
      if (!chunk) return;
      
      setIsLoading(true);
      
      try {
          // Update state to processing
           const updatedChunks = [...pipelineState.chunkResults];
           updatedChunks[chunkIndex] = {
               ...updatedChunks[chunkIndex],
               status: 'processing',
               attempts: (updatedChunks[chunkIndex].attempts || 0) + 1,
               lastError: undefined
           };
           
           setPipelineState(prev => ({ ...prev, chunkResults: updatedChunks }));
           
           const chunkData = await geminiService.processChunk(chunk.text, chunkIndex, chunks.length, settings, chunk.start, chunk.end);
           
           // Update state to success
           updatedChunks[chunkIndex] = {
               ...updatedChunks[chunkIndex],
               status: 'success',
               data: chunkData
           };
           
           const processedCount = updatedChunks.filter(c => c.status === 'success').length;
           
           setPipelineState(prev => ({
               ...prev,
               chunkResults: updatedChunks,
               processedChunks: processedCount
           }));
           
           // Autosave
           await saveSessionData(outputMarkdown, {
               ...pipelineState,
               chunkResults: updatedChunks,
               processedChunks: processedCount
           });
           
      } catch(err: any) {
           const updatedChunks = [...pipelineState.chunkResults];
           updatedChunks[chunkIndex] = {
               ...updatedChunks[chunkIndex],
               status: 'error',
               lastError: err.message
           };
           setPipelineState(prev => ({ ...prev, chunkResults: updatedChunks }));
      } finally {
          setIsLoading(false);
      }
  };

  const handleViewChunkNotes = (chunkIndex: number) => {
    const chunkResult = pipelineState.chunkResults[chunkIndex];
    const data = chunkResult?.data;
    const message = data?.chunkMarkdown || data?.tldrPoints?.join('\n') || chunkResult?.lastError || 'No notes yet.';
    alert(message);
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
        {resumeCandidate && (
          <div className="absolute top-4 left-1/2 -translate-x-1/2 z-20 w-[95%] max-w-3xl">
            <div className="bg-white border border-teal-200 shadow-lg rounded-xl p-4 flex flex-col gap-3">
              <div className="flex items-center justify-between gap-4">
                <div>
                  <p className="text-xs font-semibold text-teal-700 uppercase">In-progress pipeline detected</p>
                  <p className="text-base font-bold text-slate-800">{resumeCandidate.title || 'Study Session'}</p>
                  <p className="text-sm text-slate-500">Hash verified for this input. Resume to continue where you left off.</p>
                </div>
                <div className="text-xs text-slate-500 bg-teal-50 border border-teal-100 px-2 py-1 rounded">Matched hash</div>
              </div>
              <div className="flex flex-wrap justify-end gap-2">
                <button
                  onClick={handleStartFreshRun}
                  className="px-3 py-1.5 text-sm font-medium text-slate-600 bg-slate-100 rounded-lg hover:bg-slate-200"
                >
                  Start new run
                </button>
                <button
                  onClick={handleResumeSession}
                  className="px-3 py-1.5 text-sm font-semibold text-white bg-teal-600 rounded-lg hover:bg-teal-700 shadow"
                >
                  Resume previous run
                </button>
              </div>
            </div>
          </div>
        )}
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
            isLoading={isLoading} error={error}
          />
        </div>

        <div className={`flex-1 h-full overflow-y-auto bg-slate-50 ${viewMode === 'input' ? 'hidden lg:block' : ''} p-4 md:p-6`}>
           <div className="max-w-5xl mx-auto">
             <div className="grid lg:grid-cols-3 gap-4 mb-4">
               <div className="lg:col-span-2">
                 <PipelineUI state={pipelineState} onRetry={handlePipelineGenerate} />
               </div>
               <ChunkSidebar
                 chunkResults={pipelineState.chunkResults}
                 onRunChunk={handleRunChunk}
                 onRetryChunk={handleRunChunk}
                 onViewNotes={handleViewChunkNotes}
               />
             </div>
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