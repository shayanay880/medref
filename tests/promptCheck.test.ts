

import assert from 'node:assert';
import { test } from 'node:test';
import { buildChunkPrompt, buildSynthesisPrompt } from '../services/geminiService';
import { AppSettings } from '../types';

const baseSettings: AppSettings = {
  outputLength: 'Standard',
  includeExtra: false,
  includeTranslation: false,
  highlightDensity: 'Medium',
  autoIncludeGlossary: true,
  selectedModel: 'gemini-3-flash-preview'
};

const translatedSettings: AppSettings = {
  ...baseSettings,
  includeTranslation: true
};

const translatedNonStrictSettings: AppSettings = {
  ...translatedSettings,
  includeExtra: true
};

const lowDensitySettings: AppSettings = {
  ...baseSettings,
  highlightDensity: 'Low'
};

const highDensitySettings: AppSettings = {
  ...baseSettings,
  highlightDensity: 'High'
};

test('prompt templates include expected guidance', () => {
  const chunkPromptNoTranslation = buildChunkPrompt(0, 2, baseSettings);
  const chunkPromptWithTranslation = buildChunkPrompt(0, 2, translatedSettings);

  assert.ok(chunkPromptNoTranslation.includes('Do not add English glosses.'));
  assert.ok(chunkPromptWithTranslation.includes('Append a short English gloss'));

  const synthesisPromptNoTranslation = buildSynthesisPrompt('DATA', baseSettings, 'Heart Failure', ['Cardio']);
  const synthesisPromptWithTranslation = buildSynthesisPrompt('DATA', translatedSettings, 'Heart Failure', ['Cardio']);
  const synthesisPromptWithExtras = buildSynthesisPrompt('DATA', translatedNonStrictSettings, 'Heart Failure', ['Cardio']);
  const synthesisPromptLowDensity = buildSynthesisPrompt('DATA', lowDensitySettings, 'Heart Failure', ['Cardio']);
  const synthesisPromptHighDensity = buildSynthesisPrompt('DATA', highDensitySettings, 'Heart Failure', ['Cardio']);

  assert.ok(synthesisPromptWithTranslation.includes('English helper'));
  assert.ok(synthesisPromptNoTranslation.includes('Persian-first'));
  assert.ok(synthesisPromptNoTranslation.includes('HIGHLIGHT DENSITY: Medium'));
  assert.ok(synthesisPromptLowDensity.includes('HIGHLIGHT DENSITY: Low'));
  assert.ok(synthesisPromptLowDensity.includes('max 2-3 red'));
  assert.ok(synthesisPromptLowDensity.includes('subset of numbers'));
  assert.ok(synthesisPromptHighDensity.includes('HIGHLIGHT DENSITY: High'));
  assert.ok(synthesisPromptHighDensity.includes('Apply highlights liberally'));
  assert.ok(synthesisPromptNoTranslation.includes('[[Y]]'));
  assert.ok(synthesisPromptNoTranslation.includes('Study Goal (Title): Heart Failure'));
  assert.ok(synthesisPromptNoTranslation.includes('Tags: Cardio'));
  assert.ok(synthesisPromptNoTranslation.includes('compress or omit non-goal material'));
  assert.ok(synthesisPromptNoTranslation.includes('no خارج از متن or [[EXTRA]]'));
  assert.ok(synthesisPromptWithExtras.includes('extras allowed inline'));
  assert.ok(synthesisPromptNoTranslation.includes('[[EXTRA]]')); // ensure marker guidance present
  assert.ok(synthesisPromptNoTranslation.includes('near the bullet it supports'));
});