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

const highDensitySettings: AppSettings = {
  ...baseSettings,
  highlightDensity: 'High'
};

const chunkPromptNoTranslation = buildChunkPrompt(0, 2, baseSettings);
const chunkPromptWithTranslation = buildChunkPrompt(0, 2, translatedSettings);

assert.ok(chunkPromptNoTranslation.includes('Do not add English glosses.'));
assert.ok(chunkPromptWithTranslation.includes('Append a short English gloss'));

const synthesisPromptNoTranslation = buildSynthesisPrompt('DATA', 'GLOSSARY', baseSettings, 'SAMPLE');
const synthesisPromptWithTranslation = buildSynthesisPrompt('DATA', 'GLOSSARY', translatedSettings, 'SAMPLE');
const synthesisPromptLowDensity = buildSynthesisPrompt('DATA', 'GLOSSARY', lowDensitySettings, 'SAMPLE');
const synthesisPromptHighDensity = buildSynthesisPrompt('DATA', 'GLOSSARY', highDensitySettings, 'SAMPLE');

assert.ok(!synthesisPromptNoTranslation.includes('English helper'));
assert.ok(synthesisPromptWithTranslation.includes('English helper'));
assert.ok(synthesisPromptNoTranslation.includes('Persian-first'));
assert.ok(synthesisPromptNoTranslation.includes('HIGHLIGHT DENSITY: Medium'));
assert.ok(synthesisPromptLowDensity.includes('HIGHLIGHT DENSITY: Low'));
assert.ok(synthesisPromptLowDensity.includes('max 2-3 red'));
assert.ok(synthesisPromptLowDensity.includes('subset of numbers'));
assert.ok(synthesisPromptHighDensity.includes('HIGHLIGHT DENSITY: High'));
assert.ok(synthesisPromptHighDensity.includes('Apply highlights liberally'));
assert.ok(synthesisPromptNoTranslation.includes('[[Y]]'));

console.log('Prompt checks passed');