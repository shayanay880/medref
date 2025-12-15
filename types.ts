export type OutputLength = 'Light' | 'Standard' | 'Deep';
export type HighlightDensity = 'Low' | 'Medium';

export interface AppSettings {
  outputLength: OutputLength;
  includeExtra: boolean; // Strict Mode (False = Strict ON, True = Allow Extra)
  includeTranslation: boolean;
  highlightDensity: HighlightDensity;
}

export type PipelinePhase = 'idle' | 'outlining' | 'chunking' | 'stitching' | 'complete' | 'error';

export interface SectionOutline {
  id: string;
  title: string;
  summary: string;
}

export interface CoverageChecklistItem {
  sectionId: string;
  title: string;
  covered: boolean;
}

export interface ChunkPlanItem {
  chunkId: number;
  start: number;
  end: number;
  length: number;
}

export interface OutlineResult {
  outline: SectionOutline[];
  notice?: string;
  coverageChecklist?: CoverageChecklistItem[];
  chunkPlan?: ChunkPlanItem[];
}

export interface Flashcard {
  question: string;
  answer: string;
}

export interface ExtractedChunkData {
  chunkId: number;
  sourceStart: number;
  sourceEnd: number;
  // Exam Mode Fields
  tldrPoints: string[];
  algorithmSteps: string[];
  numbers: string[];
  diagnosticPatterns: string[];
  pitfalls: string[];
  memoryAids: string[];
  activeRecallQuestions: Flashcard[];
  glossaryTerms: string[];
  extraContent: string[]; // Only if strict mode OFF
  
  // Detailed content for Deep Mode fallback
  chunkMarkdown: string; 
}

export type ChunkStatus = 'pending' | 'processing' | 'success' | 'error';

export interface ChunkResultState {
  chunkId: number;
  status: ChunkStatus;
  attempts: number;
  lastError?: string;
  sourceStart?: number;
  sourceEnd?: number;
  data?: ExtractedChunkData;
}

export interface StitchQAReport {
  summary: string;
  warnings?: string[];
}

export interface PipelineState {
  status: PipelinePhase;
  rawInputHash?: string;
  settingsSnapshot?: AppSettings;
  totalChunks: number;
  processedChunks: number;
  outline: SectionOutline[];
  outlineResult?: OutlineResult;
  chunkResults: ChunkResultState[];
  currentError?: string;
  markdownOutput?: string;
  coverageReport?: Record<string, number>; // sectionId -> coverage percent
  outlineNotice?: string;
  stitchedOutput?: string;
  stitchQAReport?: StitchQAReport;
}

export interface StructuredOutput {
  markdownOutput: string;
  rawInputHash?: string;
  settingsSnapshot?: AppSettings;
  stitchQAReport?: StitchQAReport;
  pipelineState?: PipelineState;
}

export interface Session {
  id: string;
  createdAt: number;
  title: string;
  tags: string[];
  inputText: string;
  rawInputHash?: string;
  modelUsed: string;
  outputMarkdown: string;
  outputJson: StructuredOutput | null;
  settings: AppSettings;
  pipelineState?: PipelineState; // Persist pipeline progress
}

export type AppState = {
  sessions: Session[];
  currentSessionId: string | null;
};

export type ViewMode = 'input' | 'output';