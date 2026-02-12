// C.3 v59.0 — Push Notification Channel (ntfy.sh)
// ══════════════════════════════════════════════════════════════════════════════
//
// Simple push notifications via ntfy.sh (or compatible server).
// No external dependencies — uses native fetch.
//
// Config from environment:
//   C3_NTFY_SERVER  — Server URL (default: https://ntfy.sh)
//   C3_NTFY_TOPIC   — Default topic name
//   C3_NTFY_TOKEN   — Optional auth token for private servers
// ══════════════════════════════════════════════════════════════════════════════

import { NotificationChannel } from './base.js';

const PRIORITY_MAP = {
  low: '2',
  normal: '3',
  high: '4',
  critical: '5',
};

const PRIORITY_TAGS = {
  low: 'information_source',
  normal: 'robot',
  high: 'warning',
  critical: 'rotating_light',
};

export class PushChannel extends NotificationChannel {
  constructor({ logger }) {
    super();
    this.logger = logger;
    this.serverUrl = (process.env.C3_NTFY_SERVER || 'https://ntfy.sh').replace(/\/+$/, '');
    this.defaultTopic = process.env.C3_NTFY_TOPIC || '';
    this.token = process.env.C3_NTFY_TOKEN || '';
  }

  get name() {
    return 'push';
  }

  async send(notification) {
    const topic = notification.recipient || this.defaultTopic;
    if (!topic) {
      return { delivered: false, error: 'No topic configured (set C3_NTFY_TOPIC or provide recipient)' };
    }

    const url = `${this.serverUrl}`;
    const priority = Number(PRIORITY_MAP[notification.priority] || '3');
    const tags = [PRIORITY_TAGS[notification.priority] || 'robot'];

    // Use JSON body instead of HTTP headers to support UTF-8 (Czech diacritics etc.)
    const body = {
      topic,
      title: notification.title || 'C3 Notification',
      message: notification.body || '',
      priority,
      tags,
    };

    const headers = { 'Content-Type': 'application/json' };
    if (this.token) {
      headers['Authorization'] = `Bearer ${this.token}`;
    }

    try {
      const res = await fetch(url, {
        method: 'POST',
        headers,
        body: JSON.stringify(body),
      });

      if (!res.ok) {
        const text = await res.text().catch(() => '');
        const error = `ntfy ${res.status}: ${text}`.trim();
        this.logger.error('PushChannel', `Send failed: ${error}`);
        return { delivered: false, error };
      }

      const data = await res.json().catch(() => ({}));
      this.logger.info('PushChannel', `Sent to topic ${topic}`, { messageId: data.id });
      return { delivered: true, messageId: data.id || '' };
    } catch (err) {
      this.logger.error('PushChannel', `Send failed: ${err.message}`);
      return { delivered: false, error: err.message };
    }
  }

  async verify() {
    if (!this.defaultTopic) {
      return { ok: false, error: 'No topic configured (set C3_NTFY_TOPIC)' };
    }

    try {
      const res = await fetch(`${this.serverUrl}/v1/health`, { signal: AbortSignal.timeout(5000) });
      if (res.ok) {
        this.logger.info('PushChannel', `Server healthy: ${this.serverUrl}`);
        return { ok: true };
      }
      return { ok: false, error: `Server returned ${res.status}` };
    } catch (err) {
      return { ok: false, error: err.message };
    }
  }
}
