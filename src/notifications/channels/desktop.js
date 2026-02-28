// C.3 v87 — Desktop Notification Channel (Electron)
// ==============================================================================
//
// Sends notifications via the Electron Notification API.
// Only works in Electron context — gracefully degrades in pure Node.
//
// ==============================================================================

import { NotificationChannel } from './base.js';

export class DesktopChannel extends NotificationChannel {
  constructor(options = {}) {
    super();
    this.logger = options.logger || { info: () => {}, error: () => {} };
    this._enabled = process.env.C3_DESKTOP_NOTIFICATIONS !== 'false';
  }

  get name() { return 'desktop'; }

  async verify() {
    if (!this._enabled) {
      return { ok: false, error: 'Desktop notifications disabled' };
    }
    return { ok: true };
  }

  async send(notification) {
    if (!this._enabled) {
      return { delivered: false, error: 'Desktop notifications disabled', channel: 'desktop' };
    }

    // Desktop notifications are handled by the frontend (Electron)
    // We store them as in_app and let the WS push trigger the Electron Notification API
    this.logger.info('DesktopChannel', `Queued desktop notification: ${notification.title}`);
    return {
      delivered: true,
      channel: 'desktop',
      _wsPayload: {
        type: 'desktop_notification',
        title: notification.title || 'C3',
        body: notification.body || '',
        priority: notification.priority || 'normal',
        agentId: notification.agentId || null,
      },
    };
  }
}

export default DesktopChannel;
