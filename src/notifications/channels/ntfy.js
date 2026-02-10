// ═══════════════════════════════════════════════════════════════════════════════
// C3-Agent — B4: ntfy.sh Push Notification Channel
// ═══════════════════════════════════════════════════════════════════════════════
//
// Simple push notifications via ntfy.sh (or self-hosted ntfy server).
// No account needed — just a topic URL. Works on Android, iOS, desktop.
//
// Config env vars:
//   C3_NTFY_URL   — server URL (default: https://ntfy.sh)
//   C3_NTFY_TOPIC — topic name (required)
//   C3_NTFY_TOKEN — auth token (optional, for private topics)
//
// Extends NotificationChannel base class from notifications/channels/base.js
//
// ═══════════════════════════════════════════════════════════════════════════════

// ─── Priority Mapping ────────────────────────────────────────────────────────
//
// C3 priority → ntfy priority (1-5):
//   urgent   → 5 (max)
//   high     → 4
//   normal   → 3 (default)
//   low      → 2
//   min      → 1

const PRIORITY_MAP = {
  urgent: '5',
  high: '4',
  normal: '3',
  low: '2',
  min: '1',
};

// ─── Emoji Tags ──────────────────────────────────────────────────────────────

const AGENT_TAGS = {
  weather:    'sun_behind_cloud,thermometer',
  realestate: 'house,mag',
  news:       'newspaper,globe_with_meridians',
  price:      'chart_with_downwards_trend,money_bag',
  monitor:    'eyes,bell',
  default:    'robot,bell',
};

// ─── NtfyChannel Class ──────────────────────────────────────────────────────

export class NtfyChannel {
  /**
   * @param {object} [options]
   * @param {string} [options.serverUrl] - ntfy server URL
   * @param {string} [options.topic] - Topic name
   * @param {string} [options.token] - Auth token
   * @param {object} [options.logger] - Logger instance
   */
  constructor(options = {}) {
    this.serverUrl = options.serverUrl || process.env.C3_NTFY_URL || 'https://ntfy.sh';
    this.topic = options.topic || process.env.C3_NTFY_TOPIC || null;
    this.token = options.token || process.env.C3_NTFY_TOKEN || null;
    this.logger = options.logger || { info: () => {}, error: () => {}, warn: () => {} };
    this._lastError = null;
  }

  get name() { return 'ntfy'; }

  /**
   * Verify ntfy channel is configured and reachable.
   * @returns {Promise<{ ok: boolean, error?: string, details?: object }>}
   */
  async verify() {
    if (!this.topic) {
      return { ok: false, error: 'No topic configured (C3_NTFY_TOPIC)' };
    }

    try {
      // Check if server is reachable by fetching topic info
      const url = `${this.serverUrl}/${this.topic}/json?poll=1&since=0`;
      const headers = {};
      if (this.token) headers['Authorization'] = `Bearer ${this.token}`;

      const res = await fetch(url, { headers, signal: AbortSignal.timeout(5000) });

      if (res.ok || res.status === 200) {
        return { ok: true, details: { serverUrl: this.serverUrl, topic: this.topic } };
      }

      if (res.status === 401 || res.status === 403) {
        return { ok: false, error: 'Authentication failed — check C3_NTFY_TOKEN' };
      }

      return { ok: false, error: `Server returned ${res.status}` };
    } catch (err) {
      return { ok: false, error: `Connection failed: ${err.message}` };
    }
  }

  /**
   * Send notification via ntfy.
   *
   * @param {object} notification
   * @param {string} notification.recipient - Topic override (or uses default)
   * @param {string} notification.title - Notification title
   * @param {string} notification.body - Message body
   * @param {string} [notification.priority='normal'] - Priority level
   * @param {string} [notification.agentId] - Agent ID for tag selection
   * @param {string} [notification.url] - Click URL
   * @param {string[]} [notification.actions] - Action buttons
   * @returns {Promise<{ delivered: boolean, messageId?: string, error?: string, channel: string }>}
   */
  async send(notification) {
    const topic = notification.recipient || this.topic;
    if (!topic) {
      return { delivered: false, error: 'No topic specified', channel: 'ntfy' };
    }

    const url = `${this.serverUrl}`;
    const priority = PRIORITY_MAP[notification.priority] || '3';

    // Select emoji tags based on agent type
    const agentType = notification.agentId?.split('-')[0] || 'default';
    const tags = AGENT_TAGS[agentType] || AGENT_TAGS.default;

    const headers = {
      'Content-Type': 'application/json',
    };
    if (this.token) headers['Authorization'] = `Bearer ${this.token}`;

    const body = {
      topic,
      title: notification.title || 'C3-Agent',
      message: notification.body || '',
      priority: Number(priority),
      tags: tags.split(','),
    };

    // Optional click URL
    if (notification.url) {
      body.click = notification.url;
    }

    // Optional action buttons
    if (notification.actions && notification.actions.length > 0) {
      body.actions = notification.actions.map(a => ({
        action: 'view',
        label: a.label || a,
        url: a.url || a,
      }));
    }

    try {
      const res = await fetch(url, {
        method: 'POST',
        headers,
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(10000),
      });

      if (res.ok) {
        const data = await res.json().catch(() => ({}));
        this._lastError = null;
        this.logger.info(`[ntfy] Sent to ${topic}: ${notification.title}`);
        return { delivered: true, messageId: data.id || null, channel: 'ntfy' };
      }

      const errText = await res.text().catch(() => '');
      this._lastError = `HTTP ${res.status}: ${errText}`;
      this.logger.error(`[ntfy] Failed: ${this._lastError}`);
      return { delivered: false, error: this._lastError, channel: 'ntfy' };
    } catch (err) {
      this._lastError = err.message;
      this.logger.error(`[ntfy] Error: ${err.message}`);
      return { delivered: false, error: err.message, channel: 'ntfy' };
    }
  }

  /**
   * Send a test notification.
   * @param {string} [topic]
   */
  async test(topic) {
    return this.send({
      recipient: topic || this.topic,
      title: '🧪 C3-Agent Test',
      body: `Test notification sent at ${new Date().toISOString()}`,
      priority: 'low',
      agentId: 'test',
    });
  }

  getLastError() { return this._lastError; }
}

// ─── Factory ─────────────────────────────────────────────────────────────────

/**
 * Create and configure ntfy channel from environment.
 */
export function createNtfyChannel(options = {}) {
  return new NtfyChannel(options);
}

export default NtfyChannel;
