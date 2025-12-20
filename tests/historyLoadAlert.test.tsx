import React from 'react';
import assert from 'node:assert';
import { test } from 'node:test';
import { render, screen, waitFor } from '@testing-library/react';
import { JSDOM } from 'jsdom';
import { webcrypto } from 'node:crypto';

const setupDom = () => {
  const dom = new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>', {
    url: 'http://localhost'
  });

  Object.defineProperty(globalThis, 'window', { value: dom.window, writable: true });
  Object.defineProperty(globalThis, 'document', { value: dom.window.document, writable: true });
  Object.defineProperty(globalThis, 'navigator', { value: dom.window.navigator, writable: true });
  Object.defineProperty(globalThis, 'localStorage', { value: dom.window.localStorage, writable: true });
  if (!globalThis.crypto) {
    Object.defineProperty(globalThis, 'crypto', { value: webcrypto, writable: true });
  }
};

test('shows alert when session history fails to load', async () => {
  setupDom();

  (globalThis as any).__storageServiceOverride = {
    getAllSessions: async () => {
      throw new Error('storage unavailable');
    }
  };

  (globalThis as any).window.__storageServiceOverride = (globalThis as any).__storageServiceOverride;

  const { default: App } = await import('../App');

  render(<App />);

  await waitFor(() => {
    assert.match(document.body.textContent || '', /history unavailable/i);
    assert.match(document.body.textContent || '', /history cannot be loaded/i);
  }, { timeout: 2000 });

  delete (globalThis as any).__storageServiceOverride;
});
