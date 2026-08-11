// C.3 v57.0 — Notification Router
// ══════════════════════════════════════════════════════════════════════════════

import { logger as defaultLogger } from '../core/logger.js';
import {
  NOTIFICATION_CHANNEL_DISABLED,
  NOTIFICATION_CHANNEL_UNSUPPORTED,
  isManagedExternalNotificationChannel,
  notificationChannelDecision,
  readNotificationChannelPolicy,
  requireNotificationChannelPolicy,
} from './channel-policy.js';

export const NOTIFICATION_CHANNEL_UNAVAILABLE = 'NOTIFICATION_CHANNEL_UNAVAILABLE';

/**
 * NotificationRouter — orchestrates delivery across registered channels.
 *
 * Usage:
 *   const router = new NotificationRouter({ logger });
 *   router.registerChannel(new TelegramChannel({ logger }));
 *   router.registerChannel(new EmailChannel({ logger }));
 *   await router.send({ channel: 'telegram', recipient: '123', title: '...', body: '...' });
 */
export class NotificationRouter {
  constructor({ logger = defaultLogger, db = null, channelPolicy = null } = {}) {
    this.logger = logger;
    this.db = db;
    this.channelPolicy = channelPolicy === null
      ? readNotificationChannelPolicy()
      : requireNotificationChannelPolicy(channelPolicy);
    /** @type {Map<string, import('./channels/base.js').NotificationChannel>} */
    this.channels = new Map();
  }

  /**
   * Register a notification channel.
   * @param {import('./channels/base.js').NotificationChannel} channel
   */
  registerChannel(channel) {
    if (!isManagedExternalNotificationChannel(channel?.name)) {
      return false;
    }
    if (!notificationChannelDecision(this.channelPolicy, channel.name).enabled) {
      return false;
    }
    this.channels.set(channel.name, channel);
    this.logger.info('NotificationRouter', `Channel registered: ${channel.name}`);
    return true;
  }

  /**
   * Send through the explicitly requested channel. Only an absent channel
   * property selects the local in_app default.
   *
   * @param {object} notification
   * @param {string} notification.channel - 'telegram' | 'email' | 'webhook' | 'in_app'
   * @param {string} notification.recipient
   * @param {string} notification.title
   * @param {string} notification.body
   * @param {'low'|'normal'|'high'} notification.priority
   * @param {string} notification.agentId
   * @param {object} [notification.data]
   * @returns {Promise<{delivered: boolean, channel: string, error?: string}>}
   */
  async send(notification) {
    const channelName = Object.hasOwn(notification, 'channel')
      ? notification.channel
      : 'in_app';

    // in_app is always "delivered" (stored in DB by the caller)
    if (channelName === 'in_app') {
      this.logger.debug('NotificationRouter', 'in_app notification (DB only)', {
        agentId: notification.agentId,
      });
      this._logDelivery(notification, channelName, true);
      return { delivered: true, channel: 'in_app' };
    }

    const policyDecision = notificationChannelDecision(this.channelPolicy, channelName);
    if (policyDecision.external && !policyDecision.enabled) {
      return {
        delivered: false,
        channel: channelName,
        code: NOTIFICATION_CHANNEL_DISABLED,
        error: NOTIFICATION_CHANNEL_DISABLED,
      };
    }
    if (!policyDecision.managed) {
      return {
        delivered: false,
        channel: channelName,
        code: NOTIFICATION_CHANNEL_UNSUPPORTED,
        error: NOTIFICATION_CHANNEL_UNSUPPORTED,
      };
    }

    const channel = this.channels.get(channelName);
    if (!channel) {
      this.logger.warn('NotificationRouter', NOTIFICATION_CHANNEL_UNAVAILABLE);
      return {
        delivered: false,
        channel: channelName,
        code: NOTIFICATION_CHANNEL_UNAVAILABLE,
        error: NOTIFICATION_CHANNEL_UNAVAILABLE,
      };
    }

    try {
      const result = await channel.send(notification);
      this._logDelivery(notification, channelName, result.delivered, result.error);

      return {
        delivered: result.delivered,
        channel: channelName,
        messageId: result.messageId,
        error: result.error,
      };
    } catch (err) {
      const error = `Unexpected error in ${channelName}: ${err.message}`;
      this.logger.error('NotificationRouter', error);
      this._logDelivery(notification, channelName, false, error);
      return { delivered: false, channel: channelName, error };
    }
  }

  /**
   * Test a channel by sending a verification/test message.
   * @param {string} channelName
   * @param {string} recipient - Test recipient
   * @returns {Promise<{ok: boolean, error?: string}>}
   */
  async testChannel(channelName, recipient) {
    const policyDecision = notificationChannelDecision(this.channelPolicy, channelName);
    if (policyDecision.external && !policyDecision.enabled) {
      return {
        ok: false,
        channel: channelName,
        code: NOTIFICATION_CHANNEL_DISABLED,
        error: NOTIFICATION_CHANNEL_DISABLED,
      };
    }
    if (!policyDecision.managed) {
      return {
        ok: false,
        channel: channelName,
        code: NOTIFICATION_CHANNEL_UNSUPPORTED,
        error: NOTIFICATION_CHANNEL_UNSUPPORTED,
      };
    }

    const channel = this.channels.get(channelName);
    if (!channel) {
      return {
        ok: false,
        channel: channelName,
        code: NOTIFICATION_CHANNEL_UNAVAILABLE,
        error: NOTIFICATION_CHANNEL_UNAVAILABLE,
      };
    }

    // First verify the channel config
    const verifyResult = await channel.verify();
    if (!verifyResult.ok) {
      return verifyResult;
    }

    // Send a test notification
    const result = await channel.send({
      recipient,
      title: 'C3 Test Notification',
      body: 'This is a test notification from C3 Agent Platform. If you see this, the channel is working correctly.',
      priority: 'low',
      agentId: 'system',
    });

    return { ok: result.delivered, channel: channelName, error: result.error };
  }

  /**
   * Update config on a registered channel at runtime.
   * @param {string} channelName
   * @param {object} config
   */
  updateChannelConfig(channelName, config) {
    const policyDecision = notificationChannelDecision(this.channelPolicy, channelName);
    if (policyDecision.external && !policyDecision.enabled) {
      return {
        updated: false,
        channel: channelName,
        code: NOTIFICATION_CHANNEL_DISABLED,
        error: NOTIFICATION_CHANNEL_DISABLED,
      };
    }
    if (!policyDecision.managed) {
      return {
        updated: false,
        channel: channelName,
        code: NOTIFICATION_CHANNEL_UNSUPPORTED,
        error: NOTIFICATION_CHANNEL_UNSUPPORTED,
      };
    }
    const channel = this.channels.get(channelName);
    if (channel && typeof channel.updateConfig === 'function') {
      channel.updateConfig(config);
      this.logger.info('NotificationRouter', `Channel config updated: ${channelName}`);
      return { updated: true, channel: channelName };
    }
    return {
      updated: false,
      channel: channelName,
      code: NOTIFICATION_CHANNEL_UNAVAILABLE,
      error: NOTIFICATION_CHANNEL_UNAVAILABLE,
    };
  }

  /**
   * @returns {string[]} List of registered channel names
   */
  getAvailableChannels() {
    return ['in_app', ...this.channels.keys()];
  }

  /**
   * Log delivery attempt to notification_log table (if DB available).
   */
  _logDelivery(notification, channel, delivered, error = null) {
    if (!this.db) return;

    try {
      this.db.prepare(`
        INSERT INTO notification_log_v57 (agent_id, channel, recipient, title, delivered, error)
        VALUES (?, ?, ?, ?, ?, ?)
      `).run(
        notification.agentId || null,
        channel,
        notification.recipient || null,
        notification.title || null,
        delivered ? 1 : 0,
        error || null
      );
    } catch (err) {
      // Don't fail delivery because of log error
      this.logger.debug('NotificationRouter', `Log write failed: ${err.message}`);
    }
  }
}
