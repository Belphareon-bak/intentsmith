/**
 * C3 Backend — Sprint 5 Integration
 * Pure Node.js — no external dependencies.
 */
'use strict';
const path = require('path');
const fs = require('fs');
const { spawn } = require('child_process');

// ─── Reconnection Manager ────────────────────────────────

class ReconnectionManager {
  constructor(config = {}) {
    this.config = {
      initialDelayMs: 1000, maxDelayMs: 30000, backoffMultiplier: 2,
      maxAttempts: 0, jitterMs: 500, ...config,
    };
    this.state = 'disconnected';
    this.currentDelay = 0;
    this.attemptCount = 0;
    this.disconnectedAt = 0;
    this.timer = null;
    this.connectFn = null;
    this.listeners = { stateChange: [], reconnected: [] };
  }

  setConnectFunction(fn) { this.connectFn = fn; }
  on(event, fn) { if (this.listeners[event]) this.listeners[event].push(fn); }
  emit(event, data) { (this.listeners[event] || []).forEach(fn => fn(data)); }
  getState() { return this.state; }
  getAttemptCount() { return this.attemptCount; }

  notifyConnected() {
    const wasReconnecting = this.state === 'reconnecting';
    this.setState('connected');
    const downtimeMs = Date.now() - this.disconnectedAt;
    const attempts = this.attemptCount;
    this.resetBackoff();
    if (wasReconnecting) this.emit('reconnected', { downtimeMs, attempts });
  }

  notifyDisconnected() {
    if (this.state === 'connected') this.disconnectedAt = Date.now();
    this.setState('disconnected');
    this.startReconnection();
  }

  startReconnection() {
    if (!this.connectFn) return;
    this.setState('reconnecting');
    this.scheduleAttempt();
  }

  scheduleAttempt() {
    const jitter = (Math.random() * 2 - 1) * this.config.jitterMs;
    const delay = this.currentDelay === 0 ? 0 : this.currentDelay + jitter;
    this.timer = setTimeout(() => this.attempt(), Math.max(0, delay));
    if (this.currentDelay === 0) this.currentDelay = this.config.initialDelayMs;
    else this.currentDelay = Math.min(this.currentDelay * this.config.backoffMultiplier, this.config.maxDelayMs);
  }

  async attempt() {
    this.attemptCount++;
    try {
      const ok = this.connectFn ? await this.connectFn() : false;
      if (ok) { this.notifyConnected(); return; }
    } catch {}
    if (this.config.maxAttempts > 0 && this.attemptCount >= this.config.maxAttempts) {
      this.setState('disconnected');
      return;
    }
    this.scheduleAttempt();
  }

  resetBackoff() {
    this.currentDelay = 0;
    this.attemptCount = 0;
    if (this.timer) { clearTimeout(this.timer); this.timer = null; }
  }

  setState(state) {
    if (this.state === state) return;
    this.state = state;
    this.emit('stateChange', state);
  }

  dispose() {
    this.resetBackoff();
    this.listeners = { stateChange: [], reconnected: [] };
  }
}

// ─── LLM Timeout Manager ────────────────────────────────

class LlmTimeoutManager {
  constructor(config = {}) {
    this.config = {
      warningThresholdMs: 30000, hardTimeoutMs: 60000, killTimeoutMs: 120000,
      ...config,
    };
    this.warningTimer = null;
    this.hardTimer = null;
    this.killTimer = null;
    this.activeTurnId = null;
    this.startedAt = 0;
    this.callbacks = {};
  }

  setCallbacks(cbs) { this.callbacks = cbs; }

  startTracking(turnId) {
    this.clear();
    this.activeTurnId = turnId;
    this.startedAt = Date.now();

    this.warningTimer = setTimeout(() => {
      if (this.activeTurnId === turnId) this.callbacks.onWarning?.(turnId, Date.now() - this.startedAt);
    }, this.config.warningThresholdMs);

    this.hardTimer = setTimeout(() => {
      if (this.activeTurnId === turnId) this.callbacks.onHardTimeout?.(turnId, Date.now() - this.startedAt);
    }, this.config.hardTimeoutMs);

    this.killTimer = setTimeout(() => {
      if (this.activeTurnId === turnId) {
        this.callbacks.onKill?.(turnId, Date.now() - this.startedAt);
        this.clear();
      }
    }, this.config.killTimeoutMs);
  }

  stopTracking() { this.clear(); }
  isTracking() { return this.activeTurnId !== null; }
  getElapsedMs() { return this.startedAt > 0 ? Date.now() - this.startedAt : 0; }

  clear() {
    if (this.warningTimer) { clearTimeout(this.warningTimer); this.warningTimer = null; }
    if (this.hardTimer) { clearTimeout(this.hardTimer); this.hardTimer = null; }
    if (this.killTimer) { clearTimeout(this.killTimer); this.killTimer = null; }
    this.activeTurnId = null;
    this.startedAt = 0;
  }

  dispose() { this.clear(); }
}

// ─── Crash Recovery ──────────────────────────────────────

class CrashRecoveryService {
  constructor() { this.loaders = {}; }
  setLoaders(loaders) { this.loaders = loaders; }

  async recover(projectPath) {
    const report = { type: 'crash_recovery', projectRestored: false, chatHistoryRestored: false, pendingReview: false };
    if (this.loaders.loadProject) {
      try { const p = await this.loaders.loadProject(projectPath); report.projectRestored = !!p; } catch {}
    }
    if (this.loaders.loadChatHistory) {
      try {
        const h = await this.loaders.loadChatHistory(path.join(projectPath, 'chat'));
        report.chatHistoryRestored = (h && h.length > 0);
      } catch {}
    }
    if (this.loaders.checkPendingReview) {
      try { report.pendingReview = await this.loaders.checkPendingReview(projectPath); } catch {}
    }
    return report;
  }
}

// ─── Project Export ──────────────────────────────────────

class ProjectExportService {
  async exportProject(options) {
    const { projectPath, outputDir, includeChat, includeAgentLog, includeSrc, includeInternal } = options;
    const pjPath = path.join(projectPath, 'project.json');
    if (!await pathExists(pjPath)) return { success: false, error: 'project.json not found' };

    const data = JSON.parse(await fs.promises.readFile(pjPath, 'utf-8'));
    const safeName = (data.name || 'c3-project').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
    const fileName = safeName + '-export-' + new Date().toISOString().slice(0, 10) + '.zip';
    const patterns = ['project.json'];

    for (const { dir, include } of [
      { dir: 'design', include: true },
      { dir: 'src', include: includeSrc !== false },
      { dir: 'chat', include: includeChat !== false },
      { dir: 'agent-log', include: includeAgentLog === true },
      { dir: '.c3', include: includeInternal === true },
    ]) {
      if (include && await pathExists(path.join(projectPath, dir))) patterns.push(dir);
    }

    await fs.promises.mkdir(outputDir, { recursive: true });
    const zipPath = path.join(outputDir, fileName);
    await runCommand('zip', ['-r', zipPath, ...patterns], { cwd: projectPath });
    const stat = await fs.promises.stat(zipPath);
    return { success: true, zipPath, fileName, sizeBytes: stat.size };
  }

  async importProject(options) {
    const { sourcePath, targetDir } = options;
    const v = await this.validateImport(sourcePath);
    if (!v.valid) return { success: false, error: v.errors.join(', ') };

    const dir = path.join(targetDir, (v.projectName || 'imported').toLowerCase().replace(/[^a-z0-9]+/g, '-'));
    await fs.promises.mkdir(dir, { recursive: true });
    await runCommand('unzip', ['-o', sourcePath, '-d', dir]);
    const data = JSON.parse(await fs.promises.readFile(path.join(dir, 'project.json'), 'utf-8'));
    return { success: true, projectPath: dir, projectName: data.name, phase: data.phase };
  }

  async validateImport(sourcePath) {
    const errors = [], warnings = [];
    if (sourcePath.endsWith('.zip')) {
      const contents = await listZipContents(sourcePath);
      if (!contents.some(f => f === 'project.json' || f.endsWith('/project.json')))
        errors.push('project.json not found in archive');
      return { valid: errors.length === 0, errors, warnings, fileCount: contents.length };
    }
    const pjPath = path.join(sourcePath, 'project.json');
    if (!await pathExists(pjPath)) { errors.push('project.json not found'); return { valid: false, errors, warnings }; }
    const data = JSON.parse(await fs.promises.readFile(pjPath, 'utf-8'));
    if (!data.name) errors.push('Missing "name"');
    if (!data.phase) warnings.push('Missing "phase"');
    return { valid: errors.length === 0, errors, warnings, projectName: data.name, phase: data.phase };
  }
}

// ─── Settings Defaults ──────────────────────────────────

const C3_DEFAULTS = {
  'c3.backend.url': 'ws://localhost:3001/c3/ws',
  'c3.backend.autoReconnect': true,
  'c3.backend.reconnectMaxDelay': 30000,
  'c3.chat.fontSize': 14,
  'c3.chat.showIntentBadges': true,
  'c3.chat.showTimestamps': false,
  'c3.chat.maxHistory': 500,
  'c3.agent.autoScroll': true,
  'c3.agent.verbosity': 'normal',
  'c3.agent.showTokenCounts': false,
  'c3.shell.timeout': 30000,
  'c3.shell.maxOutput': 65536,
  'c3.project.autoSaveInterval': 60000,
  'c3.project.gitAutoCommit': true,
  'c3.export.includeChat': true,
  'c3.export.includeAgentLog': false,
  'c3.export.includeSrc': true,
  'c3.language': 'cs',
  'c3.theme': 'dark',
};

// ─── Helpers ─────────────────────────────────────────────

async function pathExists(p) { try { await fs.promises.access(p); return true; } catch { return false; } }

function runCommand(cmd, args, opts = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { shell: false, stdio: ['ignore', 'pipe', 'pipe'], timeout: 60000, ...opts });
    let stderr = '';
    child.stderr.on('data', c => { stderr += c.toString(); });
    child.on('close', code => { if (code === 0) resolve(); else reject(new Error(cmd + ' failed (exit ' + code + '): ' + stderr)); });
    child.on('error', reject);
  });
}

function listZipContents(zipPath) {
  return new Promise((resolve, reject) => {
    const child = spawn('unzip', ['-l', zipPath], { shell: false, stdio: ['ignore', 'pipe', 'pipe'], timeout: 10000 });
    let stdout = '';
    child.stdout.on('data', c => { stdout += c.toString(); });
    child.on('close', code => {
      if (code === 0) {
        const files = stdout.split('\n').filter(l => /^\s*\d+/.test(l) && !l.includes('--------'))
          .map(l => l.trim().split(/\s+/).pop() || '').filter(f => f && !f.endsWith('/'));
        resolve(files);
      } else reject(new Error('unzip -l failed'));
    });
    child.on('error', reject);
  });
}

module.exports = {
  ReconnectionManager, LlmTimeoutManager, CrashRecoveryService,
  ProjectExportService, C3_DEFAULTS, pathExists, runCommand, listZipContents,
};
