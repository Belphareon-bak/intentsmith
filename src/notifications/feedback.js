// C3-Agent v57.2 — Notification Feedback Handler
// ══════════════════════════════════════════════════════════════════════════════
//
// Handles user feedback on notifications from:
//   1. Telegram inline keyboard (callback_query)
//   2. API endpoint (POST /api/notifications/:id/feedback)
//
// Flow:
//   User taps 👍/👎 on Telegram → Telegram sends callback_query
//   → webhook receives it → feedbackHandler.handleTelegramCallback()
//   → TrustTracker.recordFeedback()
//   → if auto-degradation triggers → send explanation notification
//
// ══════════════════════════════════════════════════════════════════════════════

import { logger } from '../core/logger.js';
import {
  getTrustTracker,
  buildAutoMuteNotification,
  buildDegradeNotification,
} from './trust.js';

// ─────────────────────────────────────────────────────────────────────────────
// Telegram Inline Keyboard Builder
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Build Telegram inline keyboard markup for feedback.
 * Attach this to every notification sent via Telegram.
 *
 * @param {number} notificationId — from notification_log_v57
 * @returns {Object} Telegram InlineKeyboardMarkup
 */
export function buildFeedbackKeyboard(notificationId) {
  return {
    inline_keyboard: [
      [
        {
          text: '👍 Užitečné',
          callback_data: `feedback:${notificationId}:useful`,
        },
        {
          text: '👎 Zbytečné',
          callback_data: `feedback:${notificationId}:not_useful`,
        },
      ],
    ],
  };
}

/**
 * Parse callback_data from Telegram.
 *
 * @param {string} callbackData — e.g. "feedback:42:useful"
 * @returns {{ valid: boolean, notificationId?: number, isUseful?: boolean }}
 */
export function parseFeedbackCallback(callbackData) {
  if (!callbackData || typeof callbackData !== 'string') {
    return { valid: false };
  }

  const parts = callbackData.split(':');
  if (parts.length !== 3 || parts[0] !== 'feedback') {
    return { valid: false };
  }

  const notificationId = parseInt(parts[1], 10);
  if (isNaN(notificationId)) {
    return { valid: false };
  }

  const isUseful = parts[2] === 'useful';
  if (parts[2] !== 'useful' && parts[2] !== 'not_useful') {
    return { valid: false };
  }

  return { valid: true, notificationId, isUseful };
}

// ─────────────────────────────────────────────────────────────────────────────
// Feedback Handler
// ─────────────────────────────────────────────────────────────────────────────

export class FeedbackHandler {
  #trustTracker;
  #notificationRouter;

  /**
   * @param {Object} opts
   * @param {TrustTracker} opts.trustTracker
   * @param {Object} [opts.notificationRouter] — for sending auto-mute explanations
   */
  constructor({ trustTracker, notificationRouter = null }) {
    this.#trustTracker = trustTracker;
    this.#notificationRouter = notificationRouter;
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Telegram Callback Handler
  // ─────────────────────────────────────────────────────────────────────────

  /**
   * Handle Telegram callback_query for feedback.
   *
   * Called from your Telegram webhook handler when callback_data starts with "feedback:".
   *
   * @param {Object} callbackQuery — Telegram callback_query object
   * @param {string} botToken — for answering the callback
   * @returns {Promise<{ answered: boolean, action?: string }>}
   */
  async handleTelegramCallback(callbackQuery, botToken) {
    const { id: callbackId, data: callbackData, message } = callbackQuery;

    // Parse
    const parsed = parseFeedbackCallback(callbackData);
    if (!parsed.valid) {
      await this.#answerCallback(callbackId, botToken, '❌ Neplatná data');
      return { answered: true };
    }

    const { notificationId, isUseful } = parsed;

    // Record feedback
    const result = this.#trustTracker.recordFeedback(notificationId, isUseful);

    if (!result.success) {
      await this.#answerCallback(callbackId, botToken, '❌ Notifikace nenalezena');
      return { answered: true };
    }

    // Answer the callback (removes "loading" state in Telegram)
    const emoji = isUseful ? '👍' : '👎';
    await this.#answerCallback(callbackId, botToken, `${emoji} Díky za zpětnou vazbu!`);

    // Edit the original message to remove keyboard (prevent double-voting)
    if (message?.chat?.id && message?.message_id) {
      await this.#removeKeyboard(botToken, message.chat.id, message.message_id, emoji);
    }

    // Handle auto-degradation consequences
    if (result.action && this.#notificationRouter) {
      await this.#sendTrustActionNotification(result.action, result.metrics);
    }

    logger.info('Feedback', `Telegram callback: notification=${notificationId}, useful=${isUseful}, action=${result.action || 'none'}`);

    return { answered: true, action: result.action };
  }

  // ─────────────────────────────────────────────────────────────────────────
  // API Handler
  // ─────────────────────────────────────────────────────────────────────────

  /**
   * Handle API feedback request.
   *
   * Route: POST /api/notifications/:id/feedback
   * Body: { "useful": true|false }
   *
   * @param {number} notificationId
   * @param {boolean} isUseful
   * @returns {{ success: boolean, metrics?: Object, action?: string }}
   */
  handleApiFeedback(notificationId, isUseful) {
    const result = this.#trustTracker.recordFeedback(notificationId, isUseful);

    if (!result.success) {
      return { success: false, error: 'Notification not found' };
    }

    // Handle auto-degradation (fire-and-forget for API)
    if (result.action && this.#notificationRouter) {
      this.#sendTrustActionNotification(result.action, result.metrics)
        .catch(err => logger.error('Feedback', `Failed to send trust action notification: ${err.message}`));
    }

    return {
      success: true,
      metrics: {
        usefulRatio: result.metrics.usefulRatio,
        trustLevel: result.metrics.trustLevel,
        totalFeedback: result.metrics.totalFeedback,
      },
      action: result.action,
    };
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Private: Telegram API calls
  // ─────────────────────────────────────────────────────────────────────────

  async #answerCallback(callbackId, botToken, text) {
    try {
      await fetch(`https://api.telegram.org/bot${botToken}/answerCallbackQuery`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          callback_query_id: callbackId,
          text,
          show_alert: false,
        }),
      });
    } catch (err) {
      logger.error('Feedback', `Failed to answer callback: ${err.message}`);
    }
  }

  async #removeKeyboard(botToken, chatId, messageId, feedbackEmoji) {
    try {
      await fetch(`https://api.telegram.org/bot${botToken}/editMessageReplyMarkup`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          chat_id: chatId,
          message_id: messageId,
          reply_markup: {
            inline_keyboard: [
              [{ text: `${feedbackEmoji} Zpětná vazba zaznamenána`, callback_data: 'noop' }],
            ],
          },
        }),
      });
    } catch (err) {
      // Non-critical — keyboard just stays
      logger.debug('Feedback', `Failed to remove keyboard: ${err.message}`);
    }
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Private: Trust action notifications
  // ─────────────────────────────────────────────────────────────────────────

  /**
   * Send explanation notification when auto-degradation occurs.
   * Auto-mute must NEVER be silent.
   */
  async #sendTrustActionNotification(action, metrics) {
    if (!this.#notificationRouter) return;

    let notification;

    // Get agent name (best effort)
    const agentName = metrics.agentId; // TODO: resolve to human name via repository

    switch (action) {
      case 'auto_muted':
        notification = buildAutoMuteNotification(agentName, metrics);
        break;
      case 'degraded_to_digest':
        notification = buildDegradeNotification(agentName, metrics);
        break;
      default:
        return; // No notification needed for recovery
    }

    try {
      // Send through all configured channels (this is a system notification, not from agent)
      await this.#notificationRouter.send({
        agentId: '_system',
        title: notification.title,
        body: notification.body,
        priority: 'low',
        channels: ['telegram', 'email'], // System notifications go to all channels
      });
    } catch (err) {
      logger.error('Feedback', `Failed to send trust action notification: ${err.message}`);
    }
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Telegram Webhook Helper
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Check if a Telegram update is a feedback callback.
 * Use this in your webhook handler to route to FeedbackHandler.
 *
 * @param {Object} update — Telegram Update object
 * @returns {boolean}
 */
export function isFeedbackCallback(update) {
  return !!(
    update?.callback_query?.data &&
    update.callback_query.data.startsWith('feedback:')
  );
}

export default {
  FeedbackHandler,
  buildFeedbackKeyboard,
  parseFeedbackCallback,
  isFeedbackCallback,
};
