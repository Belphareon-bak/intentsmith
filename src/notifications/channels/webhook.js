// C.3 v87 — Webhook Notification Channel (HMAC-signed)
// ==============================================================================
//
// Sends POST requests to configured webhook URLs with HMAC-SHA256 signature.
//
// Config env vars:
//   C3_WEBHOOK_URL    — target webhook URL (required)
//   C3_WEBHOOK_SECRET — HMAC secret key (required for signature)
//
// Headers sent:
//   Content-Type: application/json
//   X-C3-Signature: sha256=<hmac_hex>
//   X-C3-Timestamp: <unix_ms>
//
// Retry policy: max 3 attempts, exponential backoff (1s → 2s → 4s)
// Dead-letter: failed notifications logged to notification_log_v57 with error
//
// ==============================================================================

import { createHmac } from 'crypto';
import { NotificationChannel } from './base.js';

const MAX_RETRIES = 3;
const BACKOFF_BASE_MS = 1000;
const TIMEOUT_MS = 10000;

export class WebhookChannel extends NotificationChannel {
  /**
   * @param {object} [options]
   * @param {string} [options.url] - Webhook URL
   * @param {string} [options.secret] - HMAC secret
   * @param {object} [options.logger]
   */
  constructor(options = {}) {
    super();
    this.url = options.url || process.env.C3_WEBHOOK_URL || null;
    this.secret = options.secret || process.env.C3_WEBHOOK_SECRET || null;
    this.logger = options.logger || { info: () => {}, error: () => {}, warn: () => {} };
  }

  get name() { return 'webhook'; }

  async verify() {
    if (!this.url) {
      return { ok: false, error: 'No webhook URL configured (C3_WEBHOOK_URL)' };
    }
    if (!this.secret) {
      return { ok: false, error: 'No HMAC secret configured (C3_WEBHOOK_SECRET)' };
    }
    try {
      new URL(this.url);
    } catch (_) {
      return { ok: false, error: `Invalid webhook URL: ${this.url}` };
    }
    return { ok: true };
  }

  /**
   * Send notification via webhook with HMAC signature + retry.
   */
  async send(notification) {
    const targetUrl = notification.recipient || this.url;
    if (!targetUrl) {
      return { delivered: false, error: 'No webhook URL', channel: 'webhook' };
    }

    const timestamp = Date.now();
    const payload = JSON.stringify({
      event: 'notification',
      timestamp,
      title: notification.title || 'C3 Notification',
      body: notification.body || '',
      priority: notification.priority || 'normal',
      agentId: notification.agentId || null,
      data: notification.data || {},
    });

    const signature = this._sign(payload, timestamp);
    const headers = {
      'Content-Type': 'application/json',
      'X-C3-Timestamp': String(timestamp),
    };
    if (signature) {
      headers['X-C3-Signature'] = signature;
    }

    // Retry loop with exponential backoff
    let lastError = null;
    for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
      if (attempt > 0) {
        const delay = BACKOFF_BASE_MS * Math.pow(2, attempt - 1);
        await new Promise(r => setTimeout(r, delay));
      }

      try {
        const res = await fetch(targetUrl, {
          method: 'POST',
          headers,
          body: payload,
          signal: AbortSignal.timeout(TIMEOUT_MS),
        });

        if (res.ok) {
          this.logger.info('WebhookChannel', `Delivered to ${targetUrl} (attempt ${attempt + 1})`);
          return { delivered: true, channel: 'webhook' };
        }

        lastError = `HTTP ${res.status}`;
        // 4xx = don't retry (client error)
        if (res.status >= 400 && res.status < 500) {
          break;
        }
      } catch (err) {
        lastError = err.message;
      }
    }

    this.logger.error('WebhookChannel', `Failed after ${MAX_RETRIES} attempts: ${lastError}`);
    return { delivered: false, error: lastError, channel: 'webhook' };
  }

  /**
   * Compute HMAC-SHA256 signature.
   * @param {string} payload
   * @param {number} timestamp
   * @returns {string|null} 'sha256=<hex>' or null if no secret
   */
  _sign(payload, timestamp) {
    if (!this.secret) return null;
    const data = `${timestamp}.${payload}`;
    const hmac = createHmac('sha256', this.secret).update(data).digest('hex');
    return `sha256=${hmac}`;
  }
}

export default WebhookChannel;
