// C.3 v93 — Notification Emitter
// ══════════════════════════════════════════════════════════════════════════════
//
// Bridges domain events (lifecycle, worker) to the notification pipeline.
// Uses pipeline.process() — NOT router.send() — so policy, quiet hours,
// digest, and trust scoring are all applied.
//
// Config is cached (TTL ~10s) to avoid DB read on every event.
// Call invalidateCache() after settings sync.
//
// ══════════════════════════════════════════════════════════════════════════════

import { logger as defaultLogger } from '../core/logger.js';

const CONFIG_CACHE_TTL = 10_000; // 10 seconds

export class NotificationEmitter {
  /**
   * @param {object} options
   * @param {import('./pipeline.js').NotificationPipeline} options.pipeline
   * @param {import('better-sqlite3').Database} options.db - Raw better-sqlite3 instance
   * @param {object} [options.logger]
   */
  constructor({ pipeline, db, logger = defaultLogger }) {
    this.pipeline = pipeline;
    this.db = db;
    this.logger = logger;
    this._cfgCache = null;
    this._cfgCacheTs = 0;
  }

  /**
   * Invalidate cached config (call after settings sync).
   */
  invalidateCache() {
    this._cfgCache = null;
    this._cfgCacheTs = 0;
  }

  /**
   * Read email notification config from user_settings (cached).
   * @returns {{ channel: string, recipient: string, onLifecycle: boolean, onWorker: boolean } | null}
   */
  _getEmailConfig() {
    const now = Date.now();
    if (this._cfgCache !== undefined && this._cfgCache !== null && (now - this._cfgCacheTs) < CONFIG_CACHE_TTL) {
      return this._cfgCache;
    }
    // Also cache null results to avoid hammering DB
    if (this._cfgCache === null && (now - this._cfgCacheTs) < CONFIG_CACHE_TTL) {
      return null;
    }

    try {
      const row = this.db.prepare('SELECT data FROM user_settings WHERE id = 1').get();
      this._cfgCacheTs = now;

      if (!row) {
        this._cfgCache = null;
        return null;
      }

      const s = JSON.parse(row.data);
      if (!s['c3.notif.emailEnabled'] || !s['c3.notif.emailRecipient']) {
        this._cfgCache = null;
        return null;
      }

      this._cfgCache = {
        channel: 'email',
        recipient: s['c3.notif.emailRecipient'],
        onLifecycle: s['c3.notif.emailOnLifecycle'] !== false,
        onWorker: s['c3.notif.emailOnWorker'] !== false,
      };
      return this._cfgCache;
    } catch {
      this._cfgCache = null;
      this._cfgCacheTs = now;
      return null;
    }
  }

  /**
   * Emit a lifecycle event notification.
   *
   * @param {object} params
   * @param {'milestone_pass'|'milestone_fail'|'milestone_blocked'|'lifecycle_complete'} params.type
   * @param {string} params.projectName
   * @param {string} [params.milestoneTitle]
   * @param {string} [params.details]
   * @param {number} [params.retryCount] - For FAIL events
   */
  async emitLifecycleEvent({ type, projectName, milestoneTitle, details, retryCount }) {
    const cfg = this._getEmailConfig();
    if (!cfg || !cfg.onLifecycle) return;

    const titles = {
      milestone_pass: `Milestone hotový: ${milestoneTitle || '?'}`,
      milestone_fail: `Milestone selhal: ${milestoneTitle || '?'}`,
      milestone_blocked: `Milestone blokován: ${milestoneTitle || '?'}`,
      lifecycle_complete: `Projekt dokončen: ${projectName}`,
    };

    const priorityMap = {
      milestone_pass: 'normal',
      milestone_fail: 'high',
      milestone_blocked: 'high',
      lifecycle_complete: 'normal',
    };

    let body = `Projekt: ${projectName}`;
    if (details) body += `\n${details}`;
    if (type === 'milestone_fail' && retryCount != null) {
      body += `\nRetries exhausted: ${retryCount}`;
    }

    try {
      await this.pipeline.process({
        agent_id: 'lifecycle',
        channel: cfg.channel,
        recipient: cfg.recipient,
        title: titles[type] || `Lifecycle: ${type}`,
        body,
        priority: priorityMap[type] || 'normal',
        created_at: Date.now(),
        reason: { trigger: type, source_type: 'lifecycle' },
      });
    } catch (err) {
      this.logger.error('NotificationEmitter', `Lifecycle event failed: ${err.message}`);
    }
  }

  /**
   * Emit a worker (agent) event notification.
   * Only 'error' and 'complete' types are emitted (no spam).
   *
   * @param {object} params
   * @param {string} params.agentId
   * @param {'error'|'complete'} params.type
   * @param {string} params.title
   * @param {string} [params.details]
   */
  async emitWorkerEvent({ agentId, type, title, details }) {
    if (type !== 'error' && type !== 'complete') return; // only these two

    const cfg = this._getEmailConfig();
    if (!cfg || !cfg.onWorker) return;

    try {
      await this.pipeline.process({
        agent_id: agentId,
        channel: cfg.channel,
        recipient: cfg.recipient,
        title: `[Worker] ${title}`,
        body: details || '',
        priority: type === 'error' ? 'high' : 'normal',
        created_at: Date.now(),
        reason: { trigger: type, source_type: 'worker' },
      });
    } catch (err) {
      this.logger.error('NotificationEmitter', `Worker event failed: ${err.message}`);
    }
  }
}
