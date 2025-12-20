import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  logPipelineComplete,
  logPipelineError,
  logPipelineResume,
  logPipelineStart,
  resetEventLogger,
  setEventLogger
} from '../services/eventLogger';

describe('eventLogger', () => {
  const handler = vi.fn();

  beforeEach(() => {
    handler.mockClear();
    setEventLogger(handler);
  });

  afterEach(() => {
    resetEventLogger();
  });

  it('logs sanitized start/resume/complete events', () => {
    logPipelineStart({ sessionId: 'abc', totalChunks: 5, tagCount: 2 });
    logPipelineResume({ sessionId: 'abc', processedChunks: 3 });
    logPipelineComplete({ sessionId: 'abc', processedChunks: 5, totalChunks: 5 });

    expect(handler).toHaveBeenCalledTimes(3);
    expect(handler).toHaveBeenNthCalledWith(1, expect.objectContaining({
      type: 'start',
      sessionId: 'abc',
      totalChunks: 5,
      processedChunks: 0,
      tagCount: 2,
      timestamp: expect.any(Number)
    }));
    expect(handler).toHaveBeenNthCalledWith(2, expect.objectContaining({
      type: 'resume',
      processedChunks: 3,
      totalChunks: 0,
      tagCount: 0
    }));
    expect(handler).toHaveBeenNthCalledWith(3, expect.objectContaining({
      type: 'complete',
      processedChunks: 5,
      totalChunks: 5
    }));
  });

  it('captures error events with message without leaking PII', () => {
    logPipelineError({ sessionId: 'def', errorMessage: 'Detailed failure context', processedChunks: 1 });

    expect(handler).toHaveBeenCalledTimes(1);
    const event = handler.mock.calls[0][0];
    expect(event).toMatchObject({
      type: 'error',
      sessionId: 'def',
      processedChunks: 1,
      errorMessage: 'Detailed failure context'
    });
    expect(event).not.toHaveProperty('inputText');
    expect((event.errorMessage || '').length).toBeLessThanOrEqual(200);
  });
});
