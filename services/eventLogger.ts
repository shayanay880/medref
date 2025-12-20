import { PipelinePhase } from '../types';

export type PipelineEventType = 'start' | 'resume' | 'complete' | 'error';

export interface PipelineEventPayload {
  sessionId?: string;
  status?: PipelinePhase;
  totalChunks?: number;
  processedChunks?: number;
  tagCount?: number;
  errorMessage?: string;
}

export interface SanitizedPipelineEvent extends Required<Pick<PipelineEventPayload, 'totalChunks' | 'processedChunks' | 'tagCount'>> {
  type: PipelineEventType;
  sessionId?: string;
  status?: PipelinePhase;
  errorMessage?: string;
  timestamp: number;
}

type EventLogger = (event: SanitizedPipelineEvent) => void;

const defaultLogger: EventLogger = (event) => {
  // Console logger is intentionally lightweight and PII-safe
  console.info('[pipeline-event]', event);
};

let activeLogger: EventLogger = defaultLogger;

const sanitizePayload = (type: PipelineEventType, payload: PipelineEventPayload): SanitizedPipelineEvent => ({
  type,
  sessionId: payload.sessionId,
  status: payload.status,
  totalChunks: payload.totalChunks ?? 0,
  processedChunks: payload.processedChunks ?? 0,
  tagCount: payload.tagCount ?? 0,
  errorMessage: payload.errorMessage ? String(payload.errorMessage).slice(0, 200) : undefined,
  timestamp: Date.now()
});

export const setEventLogger = (logger: EventLogger) => {
  activeLogger = logger;
};

export const resetEventLogger = () => {
  activeLogger = defaultLogger;
};

export const logPipelineEvent = (type: PipelineEventType, payload: PipelineEventPayload = {}) => {
  const event = sanitizePayload(type, payload);
  activeLogger(event);
  return event;
};

export const logPipelineStart = (payload: PipelineEventPayload = {}) => logPipelineEvent('start', payload);
export const logPipelineResume = (payload: PipelineEventPayload = {}) => logPipelineEvent('resume', payload);
export const logPipelineComplete = (payload: PipelineEventPayload = {}) => logPipelineEvent('complete', payload);
export const logPipelineError = (payload: PipelineEventPayload = {}) => logPipelineEvent('error', payload);
