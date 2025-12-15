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

const lowDensitySettings: AppSettings = {
  ...baseSettings,
  highlightDensity: 'Low'
};

const chunkPromptNoTranslation = buildChunkPrompt(0, 2, baseSettings);
const chunkPromptWithTranslation = buildChunkPrompt(0, 2, translatedSettings);

assert.ok(chunkPromptNoTranslation.includes('Do not add English glosses.'));
assert.ok(chunkPromptWithTranslation.includes('append a short English gloss'));

const synthesisPromptNoTranslation = buildSynthesisPrompt('DATA', 'GLOSSARY', baseSettings, 'SAMPLE');
const synthesisPromptWithTranslation = buildSynthesisPrompt('DATA', 'GLOSSARY', translatedSettings, 'SAMPLE');
const synthesisPromptLowDensity = buildSynthesisPrompt('DATA', 'GLOSSARY', lowDensitySettings, 'SAMPLE');

assert.ok(!synthesisPromptNoTranslation.includes('English helper'));
assert.ok(synthesisPromptWithTranslation.includes('English helper'));
assert.ok(synthesisPromptNoTranslation.includes('Persian-first'));
assert.ok(synthesisPromptNoTranslation.includes('HIGHLIGHT DENSITY: Medium'));
assert.ok(synthesisPromptLowDensity.includes('HIGHLIGHT DENSITY: Low'));
assert.ok(synthesisPromptLowDensity.includes('max 3'));
assert.ok(synthesisPromptLowDensity.includes('max 8'));
assert.ok(synthesisPromptLowDensity.includes('max 4'));

console.log('Prompt checks passed');