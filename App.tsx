import React, { useState, useEffect } from 'react';
import { Layout } from './components/Layout';
import { InputPanel } from './components/InputPanel';
import { OutputPanel } from './components/OutputPanel';
import { HistorySidebar } from './components/HistorySidebar';
import { PipelineUI } from './components/PipelineUI';
import { Session, AppSettings, ViewMode, PipelineState, ExtractedChunkData, Flashcard } from './types';
import * as storageService from './services/storageService';
import * as geminiService from './services/geminiService';
import { calculateCoverageReport, splitTextIntoChunks } from './services/pipelineService';
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
  chunkResults: [],
  coverageReport: {},
  outlineNotice: undefined
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
  const [outputJson, setOutputJson] = useState<any>(null);
  const [pipelineState, setPipelineState] = useState<PipelineState>(DEFAULT_PIPELINE_STATE);

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
        if (session.pipelineState) setPipelineState(session.pipelineState);
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
    setPipelineState(DEFAULT_PIPELINE_STATE);
    setViewMode('input');
    if (window.innerWidth < 1024) setIsSidebarOpen(false);
  };

  const handlePipelineGenerate = async () => {
    if (!inputText.trim()) return;

    setIsLoading(true);
    setError(null);
    setViewMode('output');

    // --- PHASE A: OUTLINE ---
    setPipelineState(prev => ({ ...prev, status: 'outlining', currentError: undefined, outlineNotice: undefined }));
    
    try {
      // 1. Outline
      const outlineResult = await geminiService.generateOutline(inputText);
      const outline = outlineResult.outline;
      
      // 2. Prepare Chunks
      const chunks = splitTextIntoChunks(inputText);
      setPipelineState(prev => ({
        ...prev,
        status: 'chunking',
        outline,
        totalChunks: chunks.length,
        processedChunks: 0,
        chunkResults: [], // Reset if starting over
        coverageReport: {},
        outlineNotice: outlineResult.notice
      }));

      // --- PHASE B: CHUNK PROCESSING ---
      const chunkResults: ExtractedChunkData[] = [];
      const collectedFlashcards: Flashcard[] = [];
      
      for (let i = 0; i < chunks.length; i++) {
        const { text: chunkText, start: sourceStart, end: sourceEnd } = chunks[i];
        const chunkData = await geminiService.processChunk(chunkText, i, chunks.length, settings, sourceStart, sourceEnd);
        chunkResults.push(chunkData);
        if (chunkData.activeRecallQuestions && chunkData.activeRecallQuestions.length > 0) {
            collectedFlashcards.push(...chunkData.activeRecallQuestions);
        }
        
        // Update state progressively
        setPipelineState(prev => ({
          ...prev,
          processedChunks: i + 1,
          chunkResults: [...prev.chunkResults, chunkData],
          coverageReport: calculateCoverageReport(outline, [...prev.chunkResults, chunkData])
        }));
      }

      // --- PHASE C: STITCHING ---
      setPipelineState(prev => ({ ...prev, status: 'stitching' }));
      
      const finalMarkdown = await geminiService.stitchFinalOutput(outline, chunkResults, settings, inputText.slice(0, 5000));
      
      setOutputMarkdown(finalMarkdown);
      setOutputJson({ markdownOutput: finalMarkdown, flashcards: collectedFlashcards });

      const finalCoverage = calculateCoverageReport(outline, chunkResults, finalMarkdown);
      
      // Final State
      const finalState: PipelineState = {
        ...pipelineState,
        status: 'complete',
        outline,
        outlineNotice: outlineResult.notice,
        chunkResults,
        totalChunks: chunks.length,
        processedChunks: chunks.length,
        coverageReport: finalCoverage
      };
      
      setPipelineState(finalState);
      saveSessionData(finalMarkdown, finalState, collectedFlashcards);

    } catch (err: any) {
      console.error(err);
      setError("Pipeline failed: " + err.message);
      setPipelineState(prev => ({ ...prev, status: 'error', currentError: err.message }));
    } finally {
      setIsLoading(false);
    }
  };

  const saveSessionData = async (markdown: string, pState: PipelineState, flashcards: Flashcard[]) => {
    const now = Date.now();
    const sessionData: Session = {
      id: currentSessionId || crypto.randomUUID(),
      createdAt: currentSessionId ? (sessions.find(s => s.id === currentSessionId)?.createdAt || now) : now,
      title: inputTitle || 'Study Session',
      tags: inputTags.split(',').map(t => t.trim()).filter(Boolean),
      inputText,
      modelUsed: MODEL_NAME,
      outputMarkdown: markdown,
      outputJson: { markdownOutput: markdown, flashcards }, 
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
            isLoading={isLoading} error={error}
          />
        </div>

        <div className={`flex-1 h-full overflow-y-auto bg-slate-50 ${viewMode === 'input' ? 'hidden lg:block' : ''} p-4 md:p-6`}>
           <div className="max-w-4xl mx-auto">
             <PipelineUI state={pipelineState} onRetry={handlePipelineGenerate} />
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