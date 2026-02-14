// C3 WS Bridge — File Watcher
// ══════════════════════════════════════════════════════════════════════════════
//
// v59.0 — chokidar wrapper with batch dedup and lifecycle management.
//
// Usage:
//   import { watchProject, unwatchProject, unwatchAll } from './file-watcher.js';
//   watchProject('/path/to/project', (events) => { ... });
//
// ══════════════════════════════════════════════════════════════════════════════

import chokidar from 'chokidar';
import path from 'path';

const watchers = new Map();

/**
 * Watch a project directory for file changes.
 * Events are batched (100ms debounce) and deduplicated per batch.
 *
 * @param {string} projectPath — Absolute path to project root
 * @param {Function} onChange — (events: Array<{event, path}>) => void
 */
export function watchProject(projectPath, onChange) {
  if (watchers.has(projectPath)) return;

  let batch = [];
  let timer = null;
  const seen = new Set();

  const watcher = chokidar.watch(projectPath, {
    ignored: [/node_modules/, /\.git/, /\.c3/],
    persistent: true,
    ignoreInitial: true,
    awaitWriteFinish: { stabilityThreshold: 300 },
  });

  watcher.on('all', (event, filePath) => {
    const rel = path.relative(projectPath, filePath);
    const key = event + ':' + rel;
    if (seen.has(key)) return;
    seen.add(key);

    batch.push({ event, path: rel });
    clearTimeout(timer);
    timer = setTimeout(() => {
      onChange([...batch]);
      batch = [];
      seen.clear();
    }, 100);
  });

  watchers.set(projectPath, watcher);
}

/**
 * Stop watching a specific project.
 * @param {string} projectPath
 */
export function unwatchProject(projectPath) {
  const w = watchers.get(projectPath);
  if (w) {
    w.close();
    watchers.delete(projectPath);
  }
}

/**
 * Stop all watchers (cleanup on server shutdown).
 */
export function unwatchAll() {
  for (const [, w] of watchers) {
    w.close();
  }
  watchers.clear();
}
