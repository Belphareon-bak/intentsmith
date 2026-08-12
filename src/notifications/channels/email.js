// C.3 v57.0 — Email Notification Channel
// ══════════════════════════════════════════════════════════════════════════════

import { NotificationChannel } from './base.js';
import { toHTML, toPlainText } from '../templates/default.js';

/**
 * Email channel using nodemailer SMTP.
 *
 * Config from the injected startup environment authority:
 *   C3_SMTP_HOST, C3_SMTP_PORT, C3_SMTP_USER, C3_SMTP_PASS, C3_SMTP_FROM
 */
export class EmailChannel extends NotificationChannel {
  #notificationEnvironmentAuthority;

  constructor({
    logger,
    notificationEnvironmentAuthority,
    requireNotificationEnvironmentAuthority,
  }) {
    super();
    if (typeof requireNotificationEnvironmentAuthority !== 'function') {
      const error = new TypeError('NOTIFICATION_ENVIRONMENT_AUTHORITY_INVALID');
      error.code = 'NOTIFICATION_ENVIRONMENT_AUTHORITY_INVALID';
      throw error;
    }
    this.#notificationEnvironmentAuthority = requireNotificationEnvironmentAuthority(
      notificationEnvironmentAuthority,
    );
    this.logger = logger;
    this.transporter = null;
  }

  get name() {
    return 'email';
  }

  async _getTransporter() {
    if (this.transporter) return this.transporter;
    const config = this.#config();

    // Lazy-load nodemailer to avoid crash if not installed
    let nodemailer;
    try {
      nodemailer = await import('nodemailer');
    } catch {
      throw new Error('nodemailer not installed — run: npm install nodemailer');
    }

    this.transporter = nodemailer.default.createTransport({
      host: config.host,
      port: config.port,
      secure: config.port === 465,
      auth: {
        user: config.user,
        pass: config.pass,
      },
    });

    return this.transporter;
  }

  async send(notification) {
    if (typeof notification.recipient !== 'string' || notification.recipient.length === 0) {
      return { delivered: false, error: 'Email recipient is required' };
    }
    const config = this.#config();
    if (!config.host || !config.user) {
      return { delivered: false, error: 'SMTP not configured (set C3_SMTP_HOST, C3_SMTP_USER)' };
    }

    try {
      const transporter = await this._getTransporter();
      const info = await transporter.sendMail({
        from: config.from,
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

  #config() {
    const value = key => this.#notificationEnvironmentAuthority.value(key);
    const user = value('C3_SMTP_USER');
    return {
      host: value('C3_SMTP_HOST'),
      port: parseInt(value('C3_SMTP_PORT') || '587'),
      user,
      pass: value('C3_SMTP_PASS'),
      from: value('C3_SMTP_FROM') || user,
    };
  }

  async verify(recipient) {
    if (arguments.length > 0
        && (typeof recipient !== 'string' || recipient.length === 0)) {
      return { ok: false, error: 'Email recipient is required' };
    }
    const config = this.#config();
    if (!config.host || !config.user) {
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
