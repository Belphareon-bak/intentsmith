// C.3 v57.0 — Email Notification Channel
// ══════════════════════════════════════════════════════════════════════════════

import { NotificationChannel } from './base.js';
import { toHTML, toPlainText } from '../templates/default.js';

/**
 * Email channel using nodemailer SMTP.
 *
 * Config from environment:
 *   C3_SMTP_HOST, C3_SMTP_PORT, C3_SMTP_USER, C3_SMTP_PASS, C3_SMTP_FROM
 */
export class EmailChannel extends NotificationChannel {
  constructor({ logger }) {
    super();
    this.logger = logger;
    this.transporter = null;

    this.config = {
      host: process.env.C3_SMTP_HOST,
      port: parseInt(process.env.C3_SMTP_PORT || '587'),
      user: process.env.C3_SMTP_USER,
      pass: process.env.C3_SMTP_PASS,
      from: process.env.C3_SMTP_FROM || process.env.C3_SMTP_USER,
    };
  }

  get name() {
    return 'email';
  }

  async _getTransporter() {
    if (this.transporter) return this.transporter;

    // Lazy-load nodemailer to avoid crash if not installed
    let nodemailer;
    try {
      nodemailer = await import('nodemailer');
    } catch {
      throw new Error('nodemailer not installed — run: npm install nodemailer');
    }

    this.transporter = nodemailer.default.createTransport({
      host: this.config.host,
      port: this.config.port,
      secure: this.config.port === 465,
      auth: {
        user: this.config.user,
        pass: this.config.pass,
      },
    });

    return this.transporter;
  }

  async send(notification) {
    if (!this.config.host || !this.config.user) {
      return { delivered: false, error: 'SMTP not configured (set C3_SMTP_HOST, C3_SMTP_USER)' };
    }

    try {
      const transporter = await this._getTransporter();
      const info = await transporter.sendMail({
        from: this.config.from,
        to: notification.recipient,
        subject: `[C3] ${notification.title}`,
        text: toPlainText(notification),
        html: toHTML(notification),
      });

      this.logger.info('EmailChannel', `Sent to ${notification.recipient}`, { messageId: info.messageId });
      return { delivered: true, messageId: info.messageId };
    } catch (err) {
      this.logger.error('EmailChannel', `Send failed: ${err.message}`);
      return { delivered: false, error: err.message };
    }
  }

  /**
   * Update SMTP config at runtime (from IDE settings sync).
   * Invalidates existing transporter so next send() creates a new one.
   */
  updateConfig({ host, port, user, pass, from }) {
    if (!host) return; // minimum: host is required (relay/no-auth SMTP is valid)
    this.config.host = host;
    this.config.port = parseInt(port) || 587;
    if (user !== undefined) this.config.user = user;
    if (pass !== undefined) this.config.pass = pass;
    this.config.from = from || user || this.config.user;
    this.transporter = null; // force re-create on next send
    this.logger.info('EmailChannel', `Config updated (host: ${host}, port: ${this.config.port})`);
  }

  async verify() {
    if (!this.config.host || !this.config.user) {
      return { ok: false, error: 'SMTP not configured' };
    }

    try {
      const transporter = await this._getTransporter();
      await transporter.verify();
      return { ok: true };
    } catch (err) {
      return { ok: false, error: err.message };
    }
  }
}
