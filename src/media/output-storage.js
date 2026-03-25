// v130: Media Output Storage — file management + quota enforcement
// ══════════════════════════════════════════════════════════════════════════════

import fs from 'fs';
import path from 'path';
import os from 'os';
import { logger } from '../core/logger.js';

export class MediaOutputStorage {
  constructor({ baseDir, maxGB = 10 } = {}) {
    this._baseDir = baseDir || path.join(os.homedir(), '.c3', 'media');
    this._maxBytes = maxGB * 1024 * 1024 * 1024;
    this._db = null;
  }

  setDb(db) {
    this._db = db;
  }

  init() {
    // Create base directory + standard subfolder structure
    const subdirs = ['images', 'videos', 'img2img', 'thumbnails', 'temp'];
    for (const sub of [this._baseDir, ...subdirs.map(s => path.join(this._baseDir, s))]) {
      if (!fs.existsSync(sub)) {
        fs.mkdirSync(sub, { recursive: true });
      }
    }
    logger.debug('MediaStorage', `Initialized at ${this._baseDir} (${subdirs.join(', ')})`);
  }

  get baseDir() { return this._baseDir; }

  // ── File operations ────────────────────────────────────────────────────────

  // Resolve type subfolder: txt2img → images/, img2img → img2img/, txt2vid → videos/
  _typeSubfolder(type) {
    const map = { txt2img: 'images', img2img: 'img2img', txt2vid: 'videos' };
    return map[type] || 'images';
  }

  async saveOutput(generationId, filename, buffer, type) {
    // Security: reject path traversal
    if (filename.includes('..') || filename.includes('/') || filename.includes('\\')) {
      throw new Error(`Invalid filename: ${filename}`);
    }

    // Store in type-specific subfolder: media/{type}/{generationId}/
    const subfolder = this._typeSubfolder(type);
    const genDir = path.join(this._baseDir, subfolder, generationId);
    if (!fs.existsSync(genDir)) {
      fs.mkdirSync(genDir, { recursive: true });
    }

    const filePath = path.join(genDir, filename);
    fs.writeFileSync(filePath, buffer);
    return filePath;
  }

  async saveMultipleOutputs(generationId, outputs, type) {
    const paths = [];
    for (const { filename, buffer } of outputs) {
      const p = await this.saveOutput(generationId, filename, buffer, type);
      paths.push(p);
    }
    return paths;
  }

  getOutputPath(generationId, filename) {
    // Security: reject path traversal
    if (filename.includes('..') || filename.includes('/') || filename.includes('\\')) {
      return null;
    }

    // Search in all type subfolders (images/, img2img/, videos/) + legacy root
    const searchDirs = ['images', 'img2img', 'videos', ''];
    for (const sub of searchDirs) {
      const filePath = path.join(this._baseDir, sub, generationId, filename);
      if (fs.existsSync(filePath)) return filePath;
    }
    return null;
  }

  // ── Delete generation ──────────────────────────────────────────────────────

  async deleteGeneration(generationId) {
    // Search in all type subfolders + legacy root
    const searchDirs = ['images', 'img2img', 'videos', ''];
    for (const sub of searchDirs) {
      const genDir = path.join(this._baseDir, sub, generationId);
      if (fs.existsSync(genDir)) {
        fs.rmSync(genDir, { recursive: true, force: true });
      }
    }
  }

  // ── DB queries ─────────────────────────────────────────────────────────────

  getHistory({ page = 0, limit = 20, type, favorite } = {}) {
    if (!this._db) return [];
    const offset = page * limit;

    if (favorite) {
      return this._db.prepare(`
        SELECT id, type, prompt, status, created_at, completed_at, duration_ms, favorite, outputs, error
        FROM media_generations WHERE favorite = 1
        ORDER BY created_at DESC LIMIT ? OFFSET ?
      `).all(limit, offset);
    }

    if (type) {
      return this._db.prepare(`
        SELECT id, type, prompt, status, created_at, completed_at, duration_ms, favorite, outputs, error
        FROM media_generations WHERE type = ?
        ORDER BY created_at DESC LIMIT ? OFFSET ?
      `).all(type, limit, offset);
    }

    return this._db.prepare(`
      SELECT id, type, prompt, status, created_at, completed_at, duration_ms, favorite, outputs, error
      FROM media_generations
      ORDER BY created_at DESC LIMIT ? OFFSET ?
    `).all(limit, offset);
  }

  setFavorite(id, favorite) {
    if (!this._db) return;
    this._db.prepare(`UPDATE media_generations SET favorite = ? WHERE id = ?`)
      .run(favorite ? 1 : 0, id);
  }

  search(query, { limit = 20 } = {}) {
    if (!this._db) return [];
    return this._db.prepare(`
      SELECT id, type, prompt, status, created_at, favorite, outputs
      FROM media_generations
      WHERE prompt LIKE ?
      ORDER BY created_at DESC LIMIT ?
    `).all(`%${query}%`, limit);
  }

  // ── Storage statistics ─────────────────────────────────────────────────────

  getStats() {
    let totalSize = 0;
    let fileCount = 0;

    if (!fs.existsSync(this._baseDir)) return { totalSize, fileCount };

    // Recursive scan through all subdirs
    const scanDir = (dir) => {
      try {
        const entries = fs.readdirSync(dir, { withFileTypes: true });
        for (const entry of entries) {
          const fullPath = path.join(dir, entry.name);
          if (entry.isDirectory()) {
            scanDir(fullPath);
          } else {
            try {
              const stat = fs.statSync(fullPath);
              totalSize += stat.size;
              fileCount++;
            } catch (_) {}
          }
        }
      } catch (_) {}
    };

    scanDir(this._baseDir);
    return { totalSize, fileCount };
  }

  // ── Quota enforcement ──────────────────────────────────────────────────────

  async enforceQuota() {
    if (!this._db) return;

    const stats = this.getStats();
    if (stats.totalSize < this._maxBytes) return;

    logger.info('MediaStorage', `Storage ${(stats.totalSize / 1024 / 1024 / 1024).toFixed(2)} GB exceeds ${(this._maxBytes / 1024 / 1024 / 1024).toFixed(0)} GB quota — cleaning up`);

    // Delete oldest non-favorite generations
    const old = this._db.prepare(`
      SELECT id FROM media_generations
      WHERE favorite = 0 AND status IN ('completed','failed','cancelled')
      ORDER BY created_at ASC
      LIMIT 50
    `).all();

    for (const row of old) {
      await this.deleteGeneration(row.id);
      this._db.prepare(`DELETE FROM media_generations WHERE id = ?`).run(row.id);

      const current = this.getStats();
      if (current.totalSize < this._maxBytes) break;
    }
  }

  // ── Cleanup old generations ────────────────────────────────────────────────

  cleanup({ maxAgeDays = 90 } = {}) {
    if (!this._db) return 0;

    const cutoff = new Date(Date.now() - maxAgeDays * 86400000).toISOString();
    const old = this._db.prepare(`
      SELECT id FROM media_generations
      WHERE favorite = 0 AND created_at < ?
    `).all(cutoff);

    let cleaned = 0;
    for (const row of old) {
      try {
        const genDir = path.join(this._baseDir, row.id);
        if (fs.existsSync(genDir)) {
          fs.rmSync(genDir, { recursive: true, force: true });
        }
        this._db.prepare(`DELETE FROM media_generations WHERE id = ?`).run(row.id);
        cleaned++;
      } catch (_) {}
    }

    return cleaned;
  }
}
