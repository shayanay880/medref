import { readFile } from 'node:fs/promises';
import ts from 'typescript';

export async function resolve(specifier, context, defaultResolve) {
  try {
    return await defaultResolve(specifier, context, defaultResolve);
  } catch (error) {
    if (!specifier.endsWith('.ts') && !specifier.startsWith('node:') && !specifier.includes('://')) {
      return defaultResolve(`${specifier}.ts`, context, defaultResolve);
    }
    throw error;
  }
}

export async function load(url, context, defaultLoad) {
  if (url.endsWith('.ts')) {
    const source = await readFile(new URL(url));
    const { outputText } = ts.transpileModule(source.toString(), {
      compilerOptions: {
        module: ts.ModuleKind.ESNext,
        target: ts.ScriptTarget.ES2020,
        jsx: ts.JsxEmit.React,
        esModuleInterop: true
      }
    });

    return {
      format: 'module',
      source: outputText,
      shortCircuit: true
    };
  }

  return defaultLoad(url, context, defaultLoad);
}