import assert from 'node:assert';
import { buildChunkPrompt, buildSynthesisPrompt } from '../services/geminiService';
import { AppSettings } from '../types';

const baseSettings: AppSettings = {
  outputLength: 'Standard',
  includeExtra: false,
  includeTranslation: false,
  highlightDensity: 'Medium'
};

const translatedSettings: AppSettings = {
  ...baseSettings,
  includeTranslation: true
};

const chunkPromptNoTranslation = buildChunkPrompt(0, 2, baseSettings);
const chunkPromptWithTranslation = buildChunkPrompt(0, 2, translatedSettings);

assert.ok(!chunkPromptNoTranslation.includes('English gloss'));
assert.ok(chunkPromptWithTranslation.includes('English gloss'));

const synthesisPromptNoTranslation = buildSynthesisPrompt('DATA', baseSettings, 'SAMPLE');
const synthesisPromptWithTranslation = buildSynthesisPrompt('DATA', translatedSettings, 'SAMPLE');

assert.ok(!synthesisPromptNoTranslation.includes('English helper'));
assert.ok(synthesisPromptWithTranslation.includes('English helper'));
assert.ok(synthesisPromptWithTranslation.includes('Persian-first'));

console.log('Prompt checks passed');