
import assert from 'node:assert';
import { getAi } from '../services/geminiService';

const originalApiKey = process.env.API_KEY;
const originalEnvDescriptor = Object.getOwnPropertyDescriptor(import.meta, 'env');

const setImportMetaEnv = (envValue: Record<string, string> | undefined) => {
  Object.defineProperty(import.meta, 'env', {
    value: envValue,
    configurable: true,
    writable: true
  });
};

try {
  setImportMetaEnv(undefined);
  process.env.API_KEY = 'test-key';

  const ai = getAi();
  assert.ok(ai, 'getAi should return a GoogleGenAI client when API_KEY is set');
  console.log('getAi returns client when API_KEY is set');
} finally {
  if (originalEnvDescriptor) {
    Object.defineProperty(import.meta, 'env', originalEnvDescriptor);
  }
  process.env.API_KEY = originalApiKey;
}

try {
  setImportMetaEnv(undefined);
  delete process.env.API_KEY;
  // Fix: use a regex matching the actual error message and provide all required arguments.
  assert.throws(
    () => getAi(),
    /API Key is missing/,
    'getAi should throw when no API key is configured'
  );
  console.log('getAi throws when API key is missing');
} finally {
  if (originalEnvDescriptor) {
    Object.defineProperty(import.meta, 'env', originalEnvDescriptor);
  }
  process.env.API_KEY = originalApiKey;
}
