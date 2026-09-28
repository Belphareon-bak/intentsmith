// C.3 v57.0 — Notification Channel Base Class
// ══════════════════════════════════════════════════════════════════════════════

/**
 * Abstract base class for notification channels.
 * All channels must extend this and implement send() and verify().
 */
export class NotificationChannel {
  /**
   * @returns {string} Channel name (e.g. 'email', 'telegram')
   */
  get name() {
    throw new Error('NotificationChannel.name must be overridden');
  }

  /**
   * Send a notification through this channel.
   * @param {object} notification
   * @param {string} notification.recipient - Channel-specific recipient (email, chat_id, URL)
   * @param {string} notification.title
   * @param {string} notification.body
   * @param {'low'|'normal'|'high'} notification.priority
   * @param {string} notification.agentId
   * @param {object} [notification.data] - Extra metadata
   * @returns {Promise<{delivered: boolean, messageId?: string, error?: string}>}
   */
  async send(notification) {
    throw new Error('NotificationChannel.send() must be implemented');
  }

  /**
   * Verify that the channel is properly configured and reachable.
   * @returns {Promise<{ok: boolean, error?: string}>}
   */
  async verify() {
    throw new Error('NotificationChannel.verify() must be implemented');
  }
}
