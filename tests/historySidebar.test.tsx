

import { cleanup, render, screen } from '@testing-library/react';
import React from 'react';
import { describe, it, expect } from 'vitest';
import { HistorySidebar } from '../components/HistorySidebar';
import { AppSettings, PipelineState, Session } from '../types';

const baseSettings: AppSettings = {
  outputLength: 'Standard',
  includeExtra: false,
  includeTranslation: false,
  highlightDensity: 'Medium',
  autoIncludeGlossary: true,
  selectedModel: 'gemini-3-flash-preview'
};

const basePipelineState: PipelineState = {
  status: 'idle',
  totalChunks: 0,
  processedChunks: 0,
  outline: [],
  chunkStates: {},
  chunkResults: [],
  coverageReport: {},
  masteryStatus: { score: 0, completedSections: 0, totalSections: 0, sectionProgress: {} },
  lastGoalTitle: '',
  lastGoalTags: [],
  isGoalStale: false
};

const createSession = (overrides: Partial<Session> = {}): Session => ({
  id: 'session-1',
  createdAt: Date.now(),
  title: 'Example Session',
  tags: ['cardio'],
  inputText: 'input',
  modelUsed: 'test',
  outputMarkdown: 'output',
  outputJson: null,
  settings: baseSettings,
  inputFingerprint: undefined,
  pipelineState: basePipelineState,
  ...overrides
});

describe('HistorySidebar error badges', () => {
  it('shows an error badge when the session has an error status', () => {
    const sessionWithError = createSession({
      lastStatus: 'error',
      lastErrorMessage: 'Pipeline failed',
      pipelineState: { ...basePipelineState, status: 'error', currentError: 'Pipeline failed' }
    });

    render(
      <HistorySidebar
        sessions={[sessionWithError]}
        currentSessionId={sessionWithError.id}
        onSelectSession={() => {}}
        onDeleteSession={() => {}}
        onNewSession={() => {}}
        onClearDraft={() => {}}
        isOpen
        setIsOpen={() => {}}
      />
    );

    expect(screen.getByLabelText('Session has errors')).toBeInTheDocument();
  });

  it('removes the error badge after a successful rerun', () => {
    const session = createSession({
      lastStatus: 'error',
      lastErrorMessage: 'Pipeline failed',
      pipelineState: { ...basePipelineState, status: 'error', currentError: 'Pipeline failed' }
    });

    render(
      <HistorySidebar
        sessions={[session]}
        currentSessionId={session.id}
        onSelectSession={() => {}}
        onDeleteSession={() => {}}
        onNewSession={() => {}}
        onClearDraft={() => {}}
        isOpen
        setIsOpen={() => {}}
      />
    );

    cleanup();

    const recoveredSession = createSession({
      id: session.id,
      lastStatus: 'complete',
      pipelineState: { ...basePipelineState, status: 'complete', currentError: undefined }
    });

    render(
      <HistorySidebar
        sessions={[recoveredSession]}
        currentSessionId={recoveredSession.id}
        onSelectSession={() => {}}
        onDeleteSession={() => {}}
        onNewSession={() => {}}
        onClearDraft={() => {}}
        isOpen
        setIsOpen={() => {}}
      />
    );

    expect(screen.queryByLabelText('Session has errors')).toBeNull();
  });
});