// Streaming Indexer v101 — Reactive index updates via file watcher
// ══════════════════════════════════════════════════════════════════════════════
//
// Hooks into chokidar file-watcher to reactively reindex changed files.
// Uses symbolIndex.reindexFile() which cascades to knowledgeGraph.reindexFile().
//
// Per-file lock prevents race conditions (concurrent removeFile + reindexFile).
// Additional 200ms debounce on top of chokidar's 300ms awaitWriteFinish.
//
// ══════════════════════════════════════════════════════════════════════════════

import { logger } from '../core/logger.js';

// ─── Code file extensions ───────────────────────────────────────────────────

const CODE_EXT = new Set([
  '.js', '.ts', '.jsx', '.tsx', '.mjs', '.cjs',
  '.py', '.go', '.rs', '.java', '.rb', '.php',
  '.c', '.cpp', '.h', '.hpp', '.cs', '.swift',
  '.vue', '.svelte',
]);

function isCodeFile(relPath) {
  const dot = relPath.lastIndexOf('.');
  return dot >= 0 && CODE_EXT.has(relPath.substring(dot));
}

// ─── Streaming Indexer ──────────────────────────────────────────────────────

export class StreamingIndexer {
  constructor() {
    this._projectPath = null;
    this._active = false;
    this._callback = null;
    this._queue = [];
    this._processing = false;
    this._fileLocks = new Map();  // relPath → Promise
    this._debounceTimer = null;
    this._stats = { filesReindexed: 0, filesDeleted: 0, errors: 0 };

    // Lazy-loaded modules
    this._watchProject = null;
    this._removeCallback = null;
    this._symbolIndex = null;
    this._knowledgeGraph = null;
  }

  /**
   * Start streaming indexer for a project.
   * Requires symbolIndex and knowledgeGraph to be available.
   *
   * @param {string} projectPath
   * @param {Object} [deps] - { symbolIndex, knowledgeGraph } (for testing)
   */
  async start(projectPath, deps = {}) {
    if (this._active) return;
    this._projectPath = projectPath;

    // Load dependencies
    try {
      if (deps.symbolIndex) {
        this._symbolIndex = deps.symbolIndex;
      } else {
        const mod = await import('./symbol-index.js');
        this._symbolIndex = mod.symbolIndex || mod.default;
      }
      if (deps.knowledgeGraph) {
        this._knowledgeGraph = deps.knowledgeGraph;
      } else {
        const mod = await import('./knowledge-graph.js');
        this._knowledgeGraph = mod.knowledgeGraph || mod.default;
      }
      const fw = await import('../ws-bridge/file-watcher.js');
      this._watchProject = fw.watchProject;
      this._removeCallback = fw.removeCallback;
    } catch (err) {
      logger.warn('StreamingIndexer', `Dependencies unavailable: ${err.message}`);
      return;
    }

    this._callback = (events) => this._onFileEvents(events);
    this._watchProject(projectPath, this._callback);
    this._active = true;
    this._stats = { filesReindexed: 0, filesDeleted: 0, errors: 0 };

    logger.info('StreamingIndexer', `Started for ${projectPath}`);
  }

  /** Stop streaming indexer */
  stop() {
    if (!this._active) return;
    if (this._removeCallback && this._projectPath && this._callback) {
      this._removeCallback(this._projectPath, this._callback);
    }
    clearTimeout(this._debounceTimer);
    this._active = false;
    this._queue = [];
    logger.info('StreamingIndexer', `Stopped (${this._stats.filesReindexed} reindexed, ${this._stats.filesDeleted} deleted)`);
  }

  /** Handle file events from chokidar (batched) */
  _onFileEvents(events) {
    for (const ev of events) {
      if (!isCodeFile(ev.path)) continue;
      this._queue.push(ev);
    }
    if (this._queue.length === 0) return;

    // Additional debounce (200ms) on top of chokidar's 300ms
    clearTimeout(this._debounceTimer);
    this._debounceTimer = setTimeout(() => this._processQueue(), 200);
  }

  /** Process queued events with dedup and per-file locking */
  async _processQueue() {
    if (this._processing || this._queue.length === 0) return;
    this._processing = true;

    try {
      // Dedup: keep latest event per file
      const latest = new Map();
      for (const ev of this._queue) {
        latest.set(ev.path, ev.event);
      }
      this._queue = [];

      for (const [relPath, event] of latest) {
        // Per-file lock: wait for any in-progress operation on this file
        const existingLock = this._fileLocks.get(relPath);
        if (existingLock) {
          try { await existingLock; } catch { /* ignore */ }
        }

        // Create new lock for this operation
        const lockPromise = this._processFile(relPath, event);
        this._fileLocks.set(relPath, lockPromise);

        try {
          await lockPromise;
        } finally {
          // Clear lock only if it's still ours
          if (this._fileLocks.get(relPath) === lockPromise) {
            this._fileLocks.delete(relPath);
          }
        }
      }
    } finally {
      this._processing = false;
      // Re-check queue (events may have arrived during processing)
      if (this._queue.length > 0) {
        this._debounceTimer = setTimeout(() => this._processQueue(), 50);
      }
    }
  }

  /** Process a single file event */
  async _processFile(relPath, event) {
    try {
      if (event === 'unlink') {
        // File deleted
        if (this._knowledgeGraph) {
          this._knowledgeGraph.removeFile(relPath);
        }
        if (this._symbolIndex?.removeFile) {
          this._symbolIndex.removeFile(relPath);
        }
        this._stats.filesDeleted++;
      } else {
        // File added or changed — reindex via symbolIndex (cascades to KG)
        if (this._symbolIndex?.reindexFile) {
          await this._symbolIndex.reindexFile(relPath);
        } else if (this._knowledgeGraph) {
          await this._knowledgeGraph.reindexFile(relPath);
        }
        this._stats.filesReindexed++;
      }
    } catch (err) {
      this._stats.errors++;
      logger.warn('StreamingIndexer', `Error processing ${relPath}: ${err.message}`);
    }
  }

  /** Get indexer statistics */
  getStats() {
    return {
      ...this._stats,
      active: this._active,
      queueLength: this._queue.length,
      projectPath: this._projectPath,
    };
  }
}

// ─── Singleton ──────────────────────────────────────────────────────────────

export const streamingIndexer = new StreamingIndexer();

export default { StreamingIndexer, streamingIndexer };
