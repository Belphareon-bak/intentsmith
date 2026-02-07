// ══════════════════════════════════════════════════════════════════════════════
// C3-Agent Tracer Hooks — ESM resolve/load interceptor
// Runs in a worker thread, communicates via MessagePort
// ══════════════════════════════════════════════════════════════════════════════

import { relative } from 'node:path';
import { fileURLToPath } from 'node:url';

let port = null;
let srcRoot = '';

export function initialize(data) {
  port = data.port;
  srcRoot = data.srcRoot;
}

export async function resolve(specifier, context, nextResolve) {
  const result = await nextResolve(specifier, context);
  
  // Track only project files under src/
  if (result.url.startsWith('file://')) {
    try {
      const absPath = fileURLToPath(result.url);
      if (absPath.includes('/src/') && !absPath.includes('node_modules')) {
        const relPath = relative(srcRoot, absPath);
        if (!relPath.startsWith('..')) {
          const parentRel = context.parentURL
            ? relative(srcRoot, fileURLToPath(context.parentURL))
            : 'entry';
          
          port?.postMessage({
            type: 'module-resolved',
            relPath,
            parent: parentRel.startsWith('..') ? 'external' : parentRel,
          });
        }
      }
    } catch { /* ignore resolution errors */ }
  }
  
  return result;
}
