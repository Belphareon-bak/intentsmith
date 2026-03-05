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

const watchers = new Map(); // projectPath → { watcher, callbacks: Set<Function> }

/**
 * Watch a project directory for file changes.
 * Events are batched (100ms debounce) and deduplicated per batch.
 * Multiple callbacks can be registered for the same project.
 *
 * @param {string} projectPath — Absolute path to project root
 * @param {Function} onChange — (events: Array<{event, path}>) => void
 */
export function watchProject(projectPath, onChange) {
  const existing = watchers.get(projectPath);
  if (existing) {
    // Add callback to existing watcher
    existing.callbacks.add(onChange);
    return;
  }

  let batch = [];
  let timer = null;
  const seen = new Set();
  const callbacks = new Set([onChange]);

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
      const events = [...batch];
      batch = [];
      seen.clear();
      for (const cb of callbacks) {
        try { cb(events); } catch { /* non-blocking */ }
      }
    }, 100);
  });

  watchers.set(projectPath, { watcher, callbacks });
}

/**
 * Remove a specific callback from a project's watcher.
 * Closes the watcher if no callbacks remain.
 *
 * @param {string} projectPath
 * @param {Function} onChange
 */
export function removeCallback(projectPath, onChange) {
  const entry = watchers.get(projectPath);
  if (!entry) return;
  entry.callbacks.delete(onChange);
  if (entry.callbacks.size === 0) {
    entry.watcher.close();
    watchers.delete(projectPath);
  }
}

/**
 * Stop watching a specific project (closes watcher + all callbacks).
 * @param {string} projectPath
 */
export function unwatchProject(projectPath) {
  const entry = watchers.get(projectPath);
  if (entry) {
    entry.watcher.close();
    watchers.delete(projectPath);
  }
}

/**
 * Stop all watchers (cleanup on server shutdown).
 */
export function unwatchAll() {
  for (const [, entry] of watchers) {
    entry.watcher.close();
  }
  watchers.clear();
}
