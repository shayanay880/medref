export type OutputLength = 'Light' | 'Standard' | 'Deep';
export type HighlightDensity = 'Low' | 'Medium' | 'High';

export interface AppSettings {
  outputLength: OutputLength;
  includeExtra: boolean; // Strict Mode (False = Strict ON, True = Allow Extra)
  includeTranslation: boolean;
  highlightDensity: HighlightDensity;
  autoIncludeGlossary: boolean;
}

export type PipelinePhase = 'idle' | 'outlining' | 'chunking' | 'stitching' | 'complete' | 'error';

export interface RawInputDigest {
  hash: string;
  length: number;
}

export type OutlinePriority = 'high' | 'medium' | 'low';

export interface SectionOutline {
  id: string;
  title: string;
  summary: string;
  charStart?: number;
  charEnd?: number;
  priority: OutlinePriority;
}

export interface ChunkPlanEntry {
  chunkId: number;
  title: string;
  start: number;
  end: number;
  outlineIds: string[];
  outlinePriorities?: Record<string, OutlinePriority>;
  highestPriority?: OutlinePriority;
}

export interface OutlineResult {
  outline: SectionOutline[];
  chunkPlan: ChunkPlanEntry[];
  chunkPlanMap?: Record<number, ChunkPlanEntry>;
}

export type SectionMasteryStatus = 'unstarted' | 'learning' | 'mastered';

export interface SectionMastery {
  sectionId: string;
  title: string;
  completion: number; // 0-1 based on covered chunks vs planned chunks
  masteryScore: number; // 0-1 composite score including active recall density
  activeRecallCount: number;
  coveredChunks: number;
  expectedChunks: number;
  status: SectionMasteryStatus;
}

export interface MasteryStatus {
  score: number; // 0-1 overall mastery
  completedSections: number;
  totalSections: number;
  sectionProgress: Record<string, SectionMastery>;
}

export interface Flashcard {
  question: string;
  answer: string;
}

export interface GlossaryEntry {
  term: string; // Persian term with English helper in parentheses
  definition: string; // Short Persian definition
  englishTerm?: string;
}

export interface ExtractedChunkData {
  chunkId: number;
  sourceStart: number;
  sourceEnd: number;
  coversOutlineIds: string[];
  // Exam Mode Fields
  tldrPoints: string[];
  algorithmSteps: string[];
  numbers: string[];
  diagnosticPatterns: string[];
  pitfalls: string[];
  memoryAids: string[];
  activeRecallQuestions: { question: string; answer: string }[];
  glossaryTerms: string[];
  extraContent: string[]; // Only if strict mode OFF
  
  // Detailed content for Deep Mode fallback
  chunkMarkdown: string;
}

export type ChunkRunStatus = 'pending' | 'running' | 'complete' | 'error';

export interface ChunkResultState {
  chunkId: number;
  status: ChunkRunStatus;
  attempts: number;
  lastError?: string;
  result?: ExtractedChunkData;
}

export interface PipelineState {
  status: PipelinePhase;
  totalChunks: number;
  processedChunks: number;
  outline: SectionOutline[];
  outlineResult?: OutlineResult;
  rawInputHash?: RawInputDigest;
  chunkStates: Record<number, ChunkResultState>;
  chunkResults: ExtractedChunkData[];
  currentError?: string;
  markdownOutput?: string;
  coverageReport?: Record<string, { covered: boolean; chunkIds: number[] }>;
  masteryStatus?: MasteryStatus;
  stitchQAReport?: any;
  lastGoalTitle?: string;
  lastGoalTags?: string[];
  isGoalStale?: boolean;
}

export interface StructuredOutput {
  markdownOutput: string;
  glossaryEntries?: GlossaryEntry[];
  glossaryEnabled?: boolean;
  pinnedGlossaryTerms?: string[];
  pipelineState?: PipelineState;
}

export interface Session {
  id: string;
  createdAt: number;
  title: string;
  tags: string[];
  inputText: string;
  modelUsed: string;
  outputMarkdown: string;
  outputJson: StructuredOutput | null;
  settings: AppSettings;
  inputFingerprint?: RawInputDigest;
  pipelineState?: PipelineState; // Persist pipeline progress
  masteryStatus?: MasteryStatus;
}

export type AppState = {
  sessions: Session[];
  currentSessionId: string | null;
};

export type ViewMode = 'input' | 'output';