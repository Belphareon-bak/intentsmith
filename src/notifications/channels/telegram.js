// C.3 v57.0 — Telegram Notification Channel
// ══════════════════════════════════════════════════════════════════════════════

import { NotificationChannel } from './base.js';
import { toMarkdown } from '../templates/default.js';

const TELEGRAM_API = 'https://api.telegram.org';

/**
 * Telegram channel using Bot API via native fetch.
 * No external dependencies.
 *
 * Config from environment:
 *   C3_TELEGRAM_BOT_TOKEN, C3_TELEGRAM_CHAT_ID (default recipient)
 */
export class TelegramChannel extends NotificationChannel {
  constructor({ logger }) {
    super();
    this.logger = logger;
    this.token = process.env.C3_TELEGRAM_BOT_TOKEN;
    this.defaultChatId = process.env.C3_TELEGRAM_CHAT_ID;
  }

  get name() {
    return 'telegram';
  }

  async _callAPI(method, body) {
    if (!this.token) {
      throw new Error('Telegram bot token not configured (set C3_TELEGRAM_BOT_TOKEN)');
    }

    const url = `${TELEGRAM_API}/bot${this.token}/${method}`;
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });

    const data = await res.json();
    if (!data.ok) {
      throw new Error(`Telegram API error: ${data.description || res.status}`);
    }
    return data.result;
  }

  async send(notification) {
    const chatId = notification.recipient || this.defaultChatId;
    if (!chatId) {
      return { delivered: false, error: 'No recipient chat_id (set C3_TELEGRAM_CHAT_ID or provide recipient)' };
    }
    if (!this.token) {
      return { delivered: false, error: 'Telegram bot token not configured (set C3_TELEGRAM_BOT_TOKEN)' };
    }

    try {
      const text = toMarkdown(notification);
      const result = await this._callAPI('sendMessage', {
        chat_id: chatId,
        text,
        parse_mode: 'MarkdownV2',
        disable_web_page_preview: true,
      });

      this.logger.info('TelegramChannel', `Sent to ${chatId}`, { messageId: result.message_id });
      return { delivered: true, messageId: String(result.message_id) };
    } catch (err) {
      // Fallback: try plain text if markdown fails
      try {
        const plainText = `[${notification.priority.toUpperCase()}] ${notification.title}\n\n${notification.body}\n\nAgent: ${notification.agentId}`;
        const result = await this._callAPI('sendMessage', {
          chat_id: chatId,
          text: plainText,
        });
        this.logger.info('TelegramChannel', `Sent to ${chatId} (plain fallback)`, { messageId: result.message_id });
        return { delivered: true, messageId: String(result.message_id) };
      } catch (fallbackErr) {
        this.logger.error('TelegramChannel', `Send failed: ${fallbackErr.message}`);
        return { delivered: false, error: fallbackErr.message };
      }
    }
  }

  async verify() {
    if (!this.token) {
      return { ok: false, error: 'Telegram bot token not configured' };
    }

    try {
      const me = await this._callAPI('getMe', {});
      this.logger.info('TelegramChannel', `Bot verified: @${me.username}`);
      return { ok: true };
    } catch (err) {
      return { ok: false, error: err.message };
    }
  }
}
