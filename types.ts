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

export interface OutlineResult {
  outline: SectionOutline[];
  notice?: string;
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

export interface PipelineState {
  status: PipelinePhase;
  totalChunks: number;
  processedChunks: number;
  outline: SectionOutline[];
  chunkResults: ExtractedChunkData[];
  currentError?: string;
  markdownOutput?: string;
  coverageReport?: Record<string, number>; // sectionId -> coverage percent
  outlineNotice?: string;
}

export interface StructuredOutput {
  markdownOutput: string;
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
  pipelineState?: PipelineState; // Persist pipeline progress
}

export type AppState = {
  sessions: Session[];
  currentSessionId: string | null;
};

export type ViewMode = 'input' | 'output';