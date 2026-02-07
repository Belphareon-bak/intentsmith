// C.3 v57.0 — Notifications Module
// ══════════════════════════════════════════════════════════════════════════════

export { NotificationRouter } from './service.js';
export { NotificationChannel } from './channels/base.js';
export { EmailChannel } from './channels/email.js';
export { TelegramChannel } from './channels/telegram.js';

export { initNotificationTables } from './db.js';

import { logger } from '../core/logger.js';
import { NotificationRouter } from './service.js';
import { EmailChannel } from './channels/email.js';
import { TelegramChannel } from './channels/telegram.js';

/**
 * Create and configure a NotificationRouter with all available channels.
 * @param {object} options
 * @param {object} [options.db] - Database instance (for delivery logging)
 * @returns {NotificationRouter}
 */
export function createNotificationRouter({ db = null } = {}) {
  const router = new NotificationRouter({ logger, db: db?.db || db });

  router.registerChannel(new EmailChannel({ logger }));
  router.registerChannel(new TelegramChannel({ logger }));

  return router;
}
