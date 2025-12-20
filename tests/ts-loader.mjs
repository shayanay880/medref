import { readFile, access } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import process from 'node:process';
import ts from 'typescript';

export async function resolve(specifier, context, defaultResolve) {
  try {
    return await defaultResolve(specifier, context, defaultResolve);
  } catch (error) {
    if (!specifier.endsWith('.ts') && !specifier.endsWith('.tsx') && !specifier.startsWith('node:') && !specifier.includes('://')) {
      const parentPath = context.parentURL ? path.dirname(fileURLToPath(context.parentURL)) : process.cwd();
      const basePath = specifier.startsWith('/') ? specifier : path.resolve(parentPath, specifier);

      const tryResolveWithAccess = async (ext) => {
        const candidatePath = `${basePath}${ext}`;
        try {
          await access(candidatePath);
          return { url: pathToFileURL(candidatePath).href };
        } catch {
          return null;
        }
      };

      let resolved = await tryResolveWithAccess('.tsx');
      if (!resolved) resolved = await tryResolveWithAccess('.ts');
      
      if (resolved) return resolved;
    }
    throw error;
  }
}

export async function load(url, context, defaultLoad) {
  if (url.endsWith('.ts') || url.endsWith('.tsx')) {
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