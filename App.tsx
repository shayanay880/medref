import React, { useState, useEffect, useRef, useMemo } from 'react';
import { RefreshCw } from 'lucide-react';
import { Layout } from './components/Layout';
import { InputPanel } from './components/InputPanel';
import { OutputPanel } from './components/OutputPanel';
import { HistorySidebar } from './components/HistorySidebar';
import { PipelineUI } from './components/PipelineUI';
import { ChunkNavigator } from './components/ChunkNavigator';
import { MasteryDashboard } from './components/MasteryDashboard';
import { Session, AppSettings, ViewMode, PipelineState, ExtractedChunkData, StructuredOutput, OutlineResult, ChunkPlanEntry, ChunkResultState, RawInputDigest, SectionOutline, OutlinePriority, GlossaryEntry } from './types';
import * as storageService from './services/storageService';
import * as geminiService from './services/geminiService';
import { splitTextIntoChunks, calculateCoverageReport, calculateSectionMastery } from './services/pipelineService';
import { MODEL_NAME } from './constants';

const DEFAULT_SETTINGS: AppSettings = {
  outputLength: 'Standard',
  includeExtra: false, // Strict Mode ON by default
  includeTranslation: false,
  highlightDensity: 'Medium',
  autoIncludeGlossary: true,
};

const DEFAULT_PIPELINE_STATE: PipelineState = {
  status: 'idle',
  totalChunks: 0,
  processedChunks: 0,
  outline: [],
  outlineResult: undefined,
  rawInputHash: undefined,
  chunkStates: {},
  chunkResults: [],
  coverageReport: {},
  masteryStatus: { score: 0, completedSections: 0, totalSections: 0, sectionProgress: {} },
  lastGoalTitle: '',
  lastGoalTags: [],
  isGoalStale: false
};

const DRAFT_STORAGE_KEY = 'medref-draft';

const computeInputDigest = async (text: string): Promise<RawInputDigest> => {
  const length = text.length;
  try {
    if (typeof crypto !== 'undefined' && crypto.subtle) {
      const encoder = new TextEncoder();
      const data = encoder.encode(`${length}:${text}`);
      const digest = await crypto.subtle.digest('SHA-256', data);
      const hashArray = Array.from(new Uint8Array(digest));
      const hash = hashArray.map((b) => b.toString(16).padStart(2, '0')).join('');
      return { hash, length };
    }
  } catch (e) {
    console.warn('Crypto digest failed, falling back to simple hash', e);
  }
  
  // Fallback simple hash for non-secure contexts
  let hash = 0;
  for (let i = 0; i < length; i++) {
    const char = text.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash |= 0; // Convert to 32bit integer
  }
  return { hash: hash.toString(16), length };
};

const normalizeDigest = (digest?: RawInputDigest | string | null): RawInputDigest | undefined => {
  if (!digest) return undefined;
  if (typeof digest === 'string') return { hash: digest, length: 0 };
  return digest;
};

const parseTags = (tags: string) => tags.split(',').map((t) => t.trim()).filter(Boolean);

const normalizeTags = (tags: string | string[]): string[] => {
  const values = Array.isArray(tags) ? tags : tags.split(',');
  return values
    .map((t) => t.trim())
    .filter(Boolean)
    .map((t) => t.toLowerCase())
    .sort();
};

const tagsMatch = (a: string[] = [], b: string[] = []) => {
  const left = normalizeTags(a);
  const right = normalizeTags(b);
  if (left.length !== right.length) return false;
  return left.every((value, idx) => value === right[idx]);
};

const digestsMatch = (a?: RawInputDigest, b?: RawInputDigest) => !!a && !!b && a.hash === b.hash && a.length === b.length;

const digestKey = (digest: RawInputDigest) => `${digest.hash}:${digest.length}`;

const normalizeOutlineResult = (outlineResult?: OutlineResult): OutlineResult | undefined => {
  if (!outlineResult) return outlineResult;
  const normalizePriority = (priority?: OutlinePriority | string): OutlinePriority => {
    const normalized = (priority || '').toString().toLowerCase();
    return normalized === 'high' || normalized === 'low' || normalized === 'medium' ? (normalized as OutlinePriority) : 'medium';
  };
  const normalizedOutline = (outlineResult.outline || []).map((item) => ({
    ...item,
    priority: normalizePriority((item as any).priority)
  }));
  const priorityRank: Record<OutlinePriority, number> = { high: 3, medium: 2, low: 1 };
  const normalizedPlan = (outlineResult.chunkPlan || []).map((entry) => {
    const outlineIds: string[] = entry.outlineIds || (entry as any).outlineIdsCovered || [];
    const outlinePriorities = outlineIds.reduce<Record<string, OutlinePriority>>((acc, id) => {
      const match = normalizedOutline.find((o) => o.id === id);
      if (match) acc[id] = match.priority;
      return acc;
    }, {});
    const highestPriority = outlineIds.reduce<OutlinePriority | undefined>((best, id) => {
      const candidate = outlinePriorities[id];
      if (!candidate) return best;
      if (!best) return candidate;
      return priorityRank[candidate] > priorityRank[best] ? candidate : best;
    }, entry.highestPriority ? normalizePriority(entry.highestPriority) : undefined);
    return {
      ...entry,
      outlineIds,
      outlinePriorities,
      highestPriority: highestPriority || 'medium'
    };
  });

  const chunkPlanMap = outlineResult.chunkPlanMap || normalizedPlan.reduce<Record<number, ChunkPlanEntry>>((acc, entry) => {
    acc[entry.chunkId] = entry;
    return acc;
  }, {});

  return {
    ...outlineResult,
    outline: normalizedOutline,
    chunkPlan: normalizedPlan,
    chunkPlanMap
  };
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
  const [inputFingerprint, setInputFingerprint] = useState<RawInputDigest | null>(null);
  const [ignoredResumeKey, setIgnoredResumeKey] = useState<string | null>(null);
  const hasHydratedDraft = useRef(false);
  
  const currentGoalTitle = inputTitle || 'Study Session';
  const currentGoalTags = useMemo(() => parseTags(inputTags), [inputTags]);
  const parsedTags = currentGoalTags;

  const resumeDetails = useMemo(() => {
    if (!resumeSessionId) return undefined;
    const session = sessions.find(s => s.id === resumeSessionId);
    if (!session) return undefined;
    const progress = session.pipelineState?.processedChunks || 0;
    const total = session.pipelineState?.totalChunks || 0;
    return `Found matching session: "${session.title}" (${progress}/${total} chunks processed)`;
  }, [resumeSessionId, sessions]);

  const canFastResynthesize = useMemo(() => {
    const digestReady = pipelineState.rawInputHash && inputFingerprint && digestsMatch(pipelineState.rawInputHash, inputFingerprint);
    const chunkCount = (pipelineState.chunkResults?.length || 0) ||
      (Object.values(pipelineState.chunkStates || {}) as ChunkResultState[]).filter((s) => s.status === 'complete' && s.result).length;
    return Boolean(digestReady && chunkCount);
  }, [inputFingerprint, pipelineState.chunkResults, pipelineState.chunkStates, pipelineState.rawInputHash]);

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
    if (hasHydratedDraft.current || currentSessionId) return;
    try {
      const cached = localStorage.getItem(DRAFT_STORAGE_KEY);
      if (!cached) return;
      const parsed = JSON.parse(cached);
      setInputTitle(parsed.title || '');
      setInputText(parsed.text || '');
      setInputTags(parsed.tags || '');
      setSettings({ ...DEFAULT_SETTINGS, ...(parsed.settings || {}) });
      hasHydratedDraft.current = true;
    } catch (err) {
      console.error('Failed to hydrate draft', err);
    }
  }, [currentSessionId]);

  useEffect(() => {
    if (currentSessionId) return;
    const payload = {
      title: inputTitle,
      text: inputText,
      tags: inputTags,
      settings
    };
    try {
      localStorage.setItem(DRAFT_STORAGE_KEY, JSON.stringify(payload));
    } catch (err) {
      console.error('Failed to persist draft', err);
    }
  }, [currentSessionId, inputTitle, inputText, inputTags, settings]);

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
          const normalizedHash = normalizeDigest(session.pipelineState.rawInputHash || session.inputFingerprint);
          const normalizedOutline = normalizeOutlineResult(session.pipelineState.outlineResult);
          const resolvedOutline = normalizedOutline?.outline || session.pipelineState?.outline || [];
          const resolvedChunks = session.pipelineState.chunkResults || [];
          const progress = computeProgress(resolvedOutline, resolvedChunks, normalizedOutline);
          setPipelineState({
            ...DEFAULT_PIPELINE_STATE,
            ...session.pipelineState,
            rawInputHash: normalizedHash,
            outline: resolvedOutline,
            outlineResult: normalizedOutline,
            chunkStates: session.pipelineState.chunkStates || {},
            chunkResults: resolvedChunks,
            coverageReport: session.pipelineState.coverageReport || progress.coverageReport,
            masteryStatus: session.pipelineState.masteryStatus || progress.masteryStatus,
            lastGoalTitle: session.pipelineState.lastGoalTitle || '',
            lastGoalTags: session.pipelineState.lastGoalTags || [],
            isGoalStale: session.pipelineState.isGoalStale ?? false
          });
          setInputFingerprint(normalizedHash || null);
        }
        if (!session.pipelineState) {
          setInputFingerprint(null);
        }
        setViewMode(session.outputMarkdown ? 'output' : 'input');
      }
    }
  }, [currentSessionId, sessions]);

  useEffect(() => {
    let cancelled = false;

    const calculateDigest = async () => {
      if (!inputText.trim()) {
        setInputFingerprint(null);
        setResumeSessionId(null);
        return;
      }

      const digest = await computeInputDigest(inputText);
      if (cancelled) return;

      setInputFingerprint(digest);

      const digestIdentifier = digestKey(digest);
      if (ignoredResumeKey === digestIdentifier) {
        setResumeSessionId(null);
        return;
      }

      const match = sessions.find((s) => {
        const candidate = normalizeDigest(s.pipelineState?.rawInputHash || s.inputFingerprint);
        if (!candidate) return false;
        return digestsMatch(candidate, digest) && s.pipelineState?.status !== 'complete';
      });

      setResumeSessionId(match ? match.id : null);
    };

    calculateDigest();

    return () => {
      cancelled = true;
    };
  }, [inputText, sessions, ignoredResumeKey]);

  useEffect(() => {
    const hasChunks = (pipelineState.chunkResults || []).length > 0;
    if (!hasChunks) return;

    const titleChanged = (pipelineState.lastGoalTitle || '') !== (currentGoalTitle || '');
    const tagsChanged = !tagsMatch(currentGoalTags, pipelineState.lastGoalTags || []);
    const isStale = titleChanged || tagsChanged;

    setPipelineState((prev) => {
      if (prev.isGoalStale === isStale) return prev;
      return { ...prev, isGoalStale: isStale };
    });
  }, [currentGoalTags, currentGoalTitle, pipelineState.chunkResults, pipelineState.lastGoalTags, pipelineState.lastGoalTitle]);

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

  const handleClearDraft = () => {
    try {
      localStorage.removeItem(DRAFT_STORAGE_KEY);
    } catch (err) {
      console.error('Failed to clear draft', err);
    }
    if (!currentSessionId) {
      setInputTitle('');
      setInputText('');
      setInputTags('');
      setSettings(DEFAULT_SETTINGS);
      setOutputMarkdown('');
      setOutputJson(null);
      setPipelineState(DEFAULT_PIPELINE_STATE);
      setViewMode('input');
    }
  };

  const handleStartFreshPipeline = () => {
    if (inputFingerprint) {
      setIgnoredResumeKey(digestKey(inputFingerprint));
    }
    setResumeSessionId(null);
    setCurrentSessionId(null);
    setPipelineState(DEFAULT_PIPELINE_STATE);
    setOutputMarkdown('');
    setOutputJson(null);
    setViewMode('input');
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
    const normalizedHash = normalizeDigest(session.pipelineState?.rawInputHash || session.inputFingerprint);
    const normalizedOutline = normalizeOutlineResult(session.pipelineState?.outlineResult);
    const existingChunkResults = session.pipelineState?.chunkResults || [];
    const resolvedOutline = normalizedOutline?.outline || session.pipelineState?.outline || [];
    const progress = computeProgress(resolvedOutline, existingChunkResults, normalizedOutline);

    setPipelineState({
      ...DEFAULT_PIPELINE_STATE,
      ...session.pipelineState,
      rawInputHash: normalizedHash,
      outline: resolvedOutline,
      outlineResult: normalizedOutline,
      chunkStates: session.pipelineState?.chunkStates || {},
      chunkResults: existingChunkResults,
      coverageReport: session.pipelineState?.coverageReport || progress.coverageReport,
      masteryStatus: session.pipelineState?.masteryStatus || progress.masteryStatus,
      lastGoalTitle: session.pipelineState?.lastGoalTitle || '',
      lastGoalTags: session.pipelineState?.lastGoalTags || [],
      isGoalStale: session.pipelineState?.isGoalStale ?? false
    });
    setInputFingerprint(normalizedHash || null);
    setViewMode('output');
  };

  const deriveChunkResults = (states: Record<number, ChunkResultState>): ExtractedChunkData[] =>
    Object.values(states)
      .filter((s) => s.result)
      .sort((a, b) => a.chunkId - b.chunkId)
      .map((s) => ({ ...s.result! }));

  const computeProgress = (outline: SectionOutline[], chunkResults: ExtractedChunkData[], outlineResult?: OutlineResult) => {
    const coverageReport = calculateCoverageReport(outline, chunkResults);
    const masteryStatus = calculateSectionMastery(outline, coverageReport, chunkResults, outlineResult);
    return { coverageReport, masteryStatus };
  };

  const persistState = async (next: PipelineState, markdown?: string, structuredOutput?: StructuredOutput) => {
    const enrichedState: PipelineState = {
      ...next,
      lastGoalTitle: next.lastGoalTitle ?? pipelineState.lastGoalTitle ?? currentGoalTitle,
      lastGoalTags: next.lastGoalTags ?? pipelineState.lastGoalTags ?? currentGoalTags,
      isGoalStale: next.isGoalStale ?? false
    };

    setPipelineState(enrichedState);
    await saveSessionData(markdown ?? outputMarkdown ?? '', enrichedState, structuredOutput);
  };

  const buildStructuredOutput = (markdown: string, glossaryEntries: GlossaryEntry[]): StructuredOutput => ({
    markdownOutput: markdown,
    glossaryEntries,
    glossaryEnabled: settings.autoIncludeGlossary,
    pinnedGlossaryTerms: outputJson?.pinnedGlossaryTerms || []
  });

  const buildChunkPlan = (text: string, outline: SectionOutline[]): { plan: ChunkPlanEntry[]; rawChunks: { text: string; start: number; end: number }[] } => {
    const rawChunks = splitTextIntoChunks(text);
    // Safety check: ensure outline is an array before mapping
    const outlineIds: string[] = Array.isArray(outline) ? outline.map((o: SectionOutline) => o.id) : [];
    const outlinesPerChunk = outlineIds.length ? Math.ceil(outlineIds.length / Math.max(rawChunks.length, 1)) : 0;
    let outlineCursor = 0;
    const priorityRank: Record<OutlinePriority, number> = { high: 3, medium: 2, low: 1 };

    const plan = rawChunks.map((c, idx) => {
      const remaining = outlineIds.length - outlineCursor;
      const takeCount = outlinesPerChunk > 0 ? Math.min(outlinesPerChunk, remaining) : outlineIds.length;
      const assignedIds = takeCount > 0 ? outlineIds.slice(outlineCursor, outlineCursor + takeCount) : outlineIds;
      outlineCursor += takeCount > 0 ? takeCount : 0;
      
      // Calculate priorities if outline data is available
      let outlinePriorities: Record<string, OutlinePriority> = {};
      let highestPriority: OutlinePriority = 'medium';

      if (Array.isArray(outline)) {
        outlinePriorities = assignedIds.reduce<Record<string, OutlinePriority>>((acc, id) => {
          const match = outline.find((o) => o.id === id);
          if (match) acc[id] = match.priority;
          return acc;
        }, {});
        
        if (assignedIds.length > 0) {
           highestPriority = assignedIds.reduce<OutlinePriority>((best, id) => {
            const candidate = outlinePriorities[id];
            if (!candidate) return best;
            return priorityRank[candidate] > priorityRank[best] ? candidate : best;
          }, 'medium');
        }
      }

      return {
        chunkId: idx,
        title: `Chunk ${idx + 1}`,
        start: c.start,
        end: c.end,
        outlineIds: assignedIds,
        outlinePriorities,
        highestPriority
      };
    });
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
    hash: RawInputDigest,
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

      const interimProgress = computeProgress(outlineResult.outline, deriveChunkResults(states), outlineResult);

      const interimState: PipelineState = {
        ...baseState,
        status: 'chunking',
        rawInputHash: hash,
        outline: outlineResult.outline,
        outlineResult,
        totalChunks: plan.length,
        processedChunks: Object.values(states).filter((s) => s.status === 'complete').length,
        chunkStates: states,
        chunkResults: deriveChunkResults(states),
        coverageReport: interimProgress.coverageReport,
        masteryStatus: interimProgress.masteryStatus
      };
      await persistState(interimState);

      try {
        const chunkText = inputText.slice(entry.start, entry.end);
        const focusSections = outlineResult.outline.filter((section) => entry.outlineIds.includes(section.id));
        const chunkData = await geminiService.processChunk(chunkText, entry.chunkId, plan.length, settings, focusSections);
        const result: ChunkResultState = {
          ...runningState,
          status: 'complete',
          result: { ...chunkData, sourceStart: entry.start, sourceEnd: entry.end, coversOutlineIds: entry.outlineIds }
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

      const updatedProgress = computeProgress(outlineResult.outline, deriveChunkResults(states), outlineResult);

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
        coverageReport: updatedProgress.coverageReport,
        masteryStatus: updatedProgress.masteryStatus,
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

    const rawInputHash = inputFingerprint || await computeInputDigest(inputText);
    setPipelineState((prev) => ({
      ...prev,
      status: 'outlining',
      currentError: undefined,
      rawInputHash,
      lastGoalTitle: currentGoalTitle,
      lastGoalTags: currentGoalTags,
      isGoalStale: false,
      coverageReport: DEFAULT_PIPELINE_STATE.coverageReport,
      masteryStatus: DEFAULT_PIPELINE_STATE.masteryStatus,
      chunkStates: {},
      chunkResults: []
    }));

    try {
      const outlineSections = await geminiService.generateOutline(inputText, inputTitle, parsedTags);
      const { plan } = buildChunkPlan(inputText, outlineSections);
      const outlineResult: OutlineResult = {
        outline: outlineSections,
        chunkPlan: plan,
        chunkPlanMap: plan.reduce<Record<number, ChunkPlanEntry>>((acc, entry) => {
          acc[entry.chunkId] = entry;
          return acc;
        }, {})
      };

      const chunkStates = initializeChunkStates(plan);

      const outlineProgress = computeProgress(outlineSections, [], outlineResult);

      const outlineState: PipelineState = {
        status: 'chunking',
        totalChunks: plan.length,
        processedChunks: 0,
        outline: outlineSections,
        outlineResult,
        rawInputHash,
        chunkStates,
        chunkResults: [],
        coverageReport: outlineProgress.coverageReport,
        masteryStatus: outlineProgress.masteryStatus,
        lastGoalTitle: currentGoalTitle,
        lastGoalTags: currentGoalTags,
        isGoalStale: false
      };
      await persistState(outlineState);

      const { states, encounteredError } = await runChunkPlan(plan, chunkStates, rawInputHash, outlineResult, outlineState);

      if (encounteredError) {
        setError('Some chunks failed. Retry individually or continue pipeline.');
        setIsLoading(false);
        return;
      }

      const completeProgress = computeProgress(outlineSections, deriveChunkResults(states), outlineResult);

      const completeState: PipelineState = {
        ...outlineState,
        status: 'stitching',
        chunkStates: states,
        chunkResults: deriveChunkResults(states),
        processedChunks: Object.values(states).filter((s) => s.status === 'complete').length,
        coverageReport: completeProgress.coverageReport,
        masteryStatus: completeProgress.masteryStatus,
        lastGoalTitle: currentGoalTitle,
        lastGoalTags: currentGoalTags,
        isGoalStale: false
      };
      await persistState(completeState);

      const stitched = await geminiService.stitchFinalOutput(
        outlineSections,
        deriveChunkResults(states),
        settings,
        inputText.slice(0, 5000),
        inputTitle,
        parsedTags
      );

      const structuredOutput = buildStructuredOutput(stitched.markdown, stitched.glossaryEntries);

      setOutputMarkdown(stitched.markdown);
      setOutputJson(structuredOutput);

      const finalProgress = computeProgress(outlineSections, deriveChunkResults(states), outlineResult);

      const finalState: PipelineState = {
        ...completeState,
        status: 'complete',
        chunkResults: deriveChunkResults(states),
        processedChunks: completeState.totalChunks,
        markdownOutput: stitched.markdown,
        coverageReport: finalProgress.coverageReport,
        masteryStatus: finalProgress.masteryStatus,
        lastGoalTitle: currentGoalTitle,
        lastGoalTags: currentGoalTags,
        isGoalStale: false
      };

      await persistState(finalState, stitched.markdown, structuredOutput);

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
    const activeFingerprint = inputFingerprint || (inputText.trim() ? await computeInputDigest(inputText) : null);
    if (pipelineState.rawInputHash && activeFingerprint && !digestsMatch(pipelineState.rawInputHash, activeFingerprint)) {
      setError('Current input differs from the saved pipeline. Start a new run to avoid mismatched progress.');
      return;
    }
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

      const readyProgress = computeProgress(pipelineState.outline, deriveChunkResults(states), pipelineState.outlineResult);

      const readyState: PipelineState = {
        ...pipelineState,
        status: 'stitching',
        chunkStates: states,
        chunkResults: deriveChunkResults(states),
        processedChunks: Object.values(states).filter((s) => s.status === 'complete').length,
        coverageReport: readyProgress.coverageReport,
        masteryStatus: readyProgress.masteryStatus,
        lastGoalTitle: currentGoalTitle,
        lastGoalTags: currentGoalTags,
        isGoalStale: false
      };
      await persistState(readyState);

      const stitched = await geminiService.stitchFinalOutput(
        pipelineState.outline,
        deriveChunkResults(states),
        settings,
        inputText.slice(0, 5000),
        inputTitle,
        parsedTags
      );

      const structuredOutput = buildStructuredOutput(stitched.markdown, stitched.glossaryEntries);

      setOutputMarkdown(stitched.markdown);
      setOutputJson(structuredOutput);

      const finalProgress = computeProgress(pipelineState.outline, deriveChunkResults(states), pipelineState.outlineResult);

      const finalState: PipelineState = {
        ...readyState,
        status: 'complete',
        markdownOutput: stitched.markdown,
        processedChunks: readyState.totalChunks,
        coverageReport: finalProgress.coverageReport,
        masteryStatus: finalProgress.masteryStatus,
        lastGoalTitle: currentGoalTitle,
        lastGoalTags: currentGoalTags,
        isGoalStale: false
      };
      await persistState(finalState, stitched.markdown, structuredOutput);
    } catch (err: any) {
      setError('Resume failed: ' + err.message);
      const failedState: PipelineState = { ...pipelineState, status: 'error', currentError: err.message };
      await persistState(failedState);
    } finally {
      setIsLoading(false);
    }
  };

  const handleResynthesizeStitch = async () => {
    const chunkResults = pipelineState.chunkResults?.length
      ? pipelineState.chunkResults
      : deriveChunkResults(pipelineState.chunkStates || {});

    if (!chunkResults.length || !pipelineState.outline.length) return;

    setIsLoading(true);
    setError(null);

    try {
      const stitchingProgress = computeProgress(pipelineState.outline, chunkResults, pipelineState.outlineResult);

      const stitchingState: PipelineState = {
        ...pipelineState,
        status: 'stitching',
        chunkResults,
        processedChunks: pipelineState.totalChunks || chunkResults.length,
        coverageReport: stitchingProgress.coverageReport,
        masteryStatus: stitchingProgress.masteryStatus,
        lastGoalTitle: currentGoalTitle,
        lastGoalTags: currentGoalTags,
        isGoalStale: false
      };
      await persistState(stitchingState);

      const stitched = await geminiService.stitchFinalOutput(
        pipelineState.outline,
        chunkResults,
        settings,
        inputText.slice(0, 5000),
        inputTitle,
        parsedTags
      );

      const structuredOutput = buildStructuredOutput(stitched.markdown, stitched.glossaryEntries);

      setOutputMarkdown(stitched.markdown);
      setOutputJson(structuredOutput);

      const finalProgress = computeProgress(pipelineState.outline, chunkResults, pipelineState.outlineResult);

      const finalState: PipelineState = {
        ...stitchingState,
        status: 'complete',
        markdownOutput: stitched.markdown,
        processedChunks: stitchingState.totalChunks || chunkResults.length,
        coverageReport: finalProgress.coverageReport,
        masteryStatus: finalProgress.masteryStatus,
        isGoalStale: false,
        lastGoalTitle: currentGoalTitle,
        lastGoalTags: currentGoalTags
      };
      await persistState(finalState, stitched.markdown, structuredOutput);
    } catch (err: any) {
      setError('Re-synthesis failed: ' + err.message);
      const failedState: PipelineState = { ...pipelineState, status: 'error', currentError: err.message };
      await persistState(failedState);
    } finally {
      setIsLoading(false);
    }
  };

  const handleFastResynthesize = async () => {
    if (!pipelineState.outline?.length || !pipelineState.rawInputHash) {
      setError('No completed chunks to stitch.');
      return;
    }

    const activeFingerprint = inputFingerprint || (inputText.trim() ? await computeInputDigest(inputText) : null);
    if (!activeFingerprint || !digestsMatch(pipelineState.rawInputHash, activeFingerprint)) {
      setError('Source text changed—rerun extraction before re-synthesizing.');
      return;
    }

    const stitchedChunks = pipelineState.chunkResults?.length
      ? pipelineState.chunkResults
      : deriveChunkResults(pipelineState.chunkStates || {});

    if (!stitchedChunks.length) {
      setError('No chunk results available to stitch.');
      return;
    }

    setIsLoading(true);
    setError(null);

    const stitchingProgress = computeProgress(pipelineState.outline, stitchedChunks, pipelineState.outlineResult);

    const stitchingState: PipelineState = {
      ...pipelineState,
      status: 'stitching',
      chunkResults: stitchedChunks,
      coverageReport: stitchingProgress.coverageReport,
      masteryStatus: stitchingProgress.masteryStatus
    };
    await persistState(stitchingState);

    try {
      const stitched = await geminiService.stitchFinalOutput(
        pipelineState.outline,
        stitchedChunks,
        settings,
        inputText.slice(0, 5000),
        inputTitle,
        parsedTags
      );

      const structuredOutput = buildStructuredOutput(stitched.markdown, stitched.glossaryEntries);

      setOutputMarkdown(stitched.markdown);
      setOutputJson(structuredOutput);

      const finalProgress = computeProgress(pipelineState.outline, stitchedChunks, pipelineState.outlineResult);

      const finalState: PipelineState = {
        ...stitchingState,
        status: 'complete',
        markdownOutput: stitched.markdown,
        processedChunks: stitchingState.totalChunks,
        coverageReport: finalProgress.coverageReport,
        masteryStatus: finalProgress.masteryStatus
      };

      await persistState(finalState, stitched.markdown, structuredOutput);
    } catch (err: any) {
      setError('Re-synthesis failed: ' + err.message);
      const failedState: PipelineState = { ...pipelineState, status: 'error', currentError: err.message };
      await persistState(failedState);
    } finally {
      setIsLoading(false);
    }
  };

  const handleRunSingleChunk = async (chunkId: number) => {
    if (!pipelineState.outlineResult || !pipelineState.rawInputHash) return;
    const activeFingerprint = inputFingerprint || (inputText.trim() ? await computeInputDigest(inputText) : null);
    if (pipelineState.rawInputHash && activeFingerprint && !digestsMatch(pipelineState.rawInputHash, activeFingerprint)) {
      setError('Current input differs from the saved pipeline. Start a new run to avoid mismatched progress.');
      return;
    }
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

      const interimProgress = computeProgress(pipelineState.outline, deriveChunkResults(runningState), pipelineState.outlineResult);

      const interim: PipelineState = {
        ...pipelineState,
        status: 'chunking',
        chunkStates: runningState,
        processedChunks: Object.values(runningState).filter((s) => s.status === 'complete').length,
        chunkResults: deriveChunkResults(runningState),
        coverageReport: interimProgress.coverageReport,
        masteryStatus: interimProgress.masteryStatus
      };
      await persistState(interim);

      const chunkText = inputText.slice(planEntry.start, planEntry.end);
      const focusSections = pipelineState.outline.filter((section) => planEntry.outlineIds.includes(section.id));
      const chunkData = await geminiService.processChunk(chunkText, planEntry.chunkId, pipelineState.outlineResult.chunkPlan.length, settings, focusSections);

      runningState[chunkId] = {
        ...runningState[chunkId],
        status: 'complete',
        result: { ...chunkData, sourceStart: planEntry.start, sourceEnd: planEntry.end, coversOutlineIds: planEntry.outlineIds }
      };

      const updatedProgress = computeProgress(pipelineState.outline, deriveChunkResults(runningState), pipelineState.outlineResult);

      const updated: PipelineState = {
        ...pipelineState,
        status: 'chunking',
        chunkStates: runningState,
        chunkResults: deriveChunkResults(runningState),
        processedChunks: Object.values(runningState).filter((s) => s.status === 'complete').length,
        coverageReport: updatedProgress.coverageReport,
        masteryStatus: updatedProgress.masteryStatus
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
      const failedProgress = computeProgress(pipelineState.outline, deriveChunkResults(failedState), pipelineState.outlineResult);

      const updated: PipelineState = {
        ...pipelineState,
        status: 'error',
        chunkStates: failedState,
        chunkResults: deriveChunkResults(failedState),
        coverageReport: failedProgress.coverageReport,
        masteryStatus: failedProgress.masteryStatus,
        currentError: err?.message
      };
      await persistState(updated);
    } finally {
      setIsLoading(false);
    }
  };

  const handleRetryFailedChunks = async () => {
    if (!pipelineState.outlineResult || !pipelineState.rawInputHash) return;
    const hasFailures = Object.values(pipelineState.chunkStates || {}).some((c: ChunkResultState) => c.status === 'error');
    if (!hasFailures) return;
    await handleContinuePipeline();
  };

  const saveSessionData = async (markdown: string, pState: PipelineState, structuredOutput?: StructuredOutput) => {
    const now = Date.now();
    const sessionData: Session = {
      id: currentSessionId || crypto.randomUUID(),
      createdAt: currentSessionId ? (sessions.find(s => s.id === currentSessionId)?.createdAt || now) : now,
      title: inputTitle || 'Study Session',
      tags: parsedTags,
      inputText,
      modelUsed: MODEL_NAME,
      outputMarkdown: markdown,
      outputJson: structuredOutput || outputJson || { markdownOutput: markdown },
      settings,
      inputFingerprint: pState.rawInputHash,
      pipelineState: pState,
      masteryStatus: pState.masteryStatus
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
          onClearDraft={handleClearDraft}
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
            onStartFresh={resumeSessionId ? handleStartFreshPipeline : undefined}
            resumeAvailable={Boolean(resumeSessionId)}
            resumeDetails={resumeDetails}
            isLoading={isLoading} error={error}
          />
        </div>

        <div className={`flex-1 h-full overflow-y-auto bg-slate-50 ${viewMode === 'input' ? 'hidden lg:block' : ''} p-4 md:p-6`}>
           <div className="max-w-4xl mx-auto">
             {canFastResynthesize && (
               <div className="mb-4 p-4 bg-emerald-50 border border-emerald-100 rounded-xl flex flex-col md:flex-row md:items-center gap-3">
                 <div className="flex-1 text-sm text-emerald-900">
                   <p className="font-semibold flex items-center gap-2">
                     <RefreshCw size={16} className="text-emerald-600" />
                     Re-synthesize (fast)
                   </p>
                   <p className="text-emerald-800 mt-1">
                     Title or tags updated? Re-run only the stitch step to reflect goal changes without reprocessing chunks.
                   </p>
                 </div>
                 <button
                   onClick={handleFastResynthesize}
                   disabled={isLoading}
                   className="inline-flex items-center justify-center px-4 py-2 text-sm font-semibold text-white bg-emerald-600 hover:bg-emerald-700 disabled:opacity-60 rounded-lg shadow-sm transition-colors"
                 >
                   <RefreshCw size={16} className="mr-2" />
                   Re-synthesize (fast)
                 </button>
               </div>
              )}
             <PipelineUI state={pipelineState} onRetry={handlePipelineGenerate} />
             <MasteryDashboard
               outline={pipelineState.outline}
               masteryStatus={pipelineState.masteryStatus}
               coverageReport={pipelineState.coverageReport}
               chunkPlan={pipelineState.outlineResult?.chunkPlan}
               onRunChunk={handleRunSingleChunk}
               isProcessing={isLoading}
             />
             <ChunkNavigator
               chunkPlan={pipelineState.outlineResult?.chunkPlan}
               chunkStates={pipelineState.chunkStates || {}}
               outline={pipelineState.outline}
               coverageReport={pipelineState.coverageReport}
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
                highlightDensity={settings.highlightDensity}
                onResynthesizeStitch={handleResynthesizeStitch}
                isGoalStale={pipelineState.isGoalStale}
             />
           </div>
        </div>
      </div>
    </Layout>
  );
};

export default App;