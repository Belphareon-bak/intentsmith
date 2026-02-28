// C.3 v57.0 — Notifications Module
// ══════════════════════════════════════════════════════════════════════════════

export { NotificationRouter } from './service.js';
export { NotificationChannel } from './channels/base.js';
export { EmailChannel } from './channels/email.js';
export { TelegramChannel } from './channels/telegram.js';
export { PushChannel } from './channels/push.js';
export { WebhookChannel } from './channels/webhook.js';
export { DesktopChannel } from './channels/desktop.js';
export { NotificationPolicy } from './policy.js';
export { NotificationPipeline } from './pipeline.js';
export { DigestAggregator } from './digest.js';

export { initNotificationTables } from './db.js';

// Trust Feedback Loop (v57.2)
export { TrustTracker, getTrustTracker, resetTrustTracker, TRUST_CONFIG, buildAutoMuteNotification, buildDegradeNotification } from './trust.js';
export { FeedbackHandler, buildFeedbackKeyboard, parseFeedbackCallback, isFeedbackCallback } from './feedback.js';
export { createTrustRoutes } from './trust-api.js';

import { logger } from '../core/logger.js';
import { NotificationRouter } from './service.js';
import { NotificationPolicy } from './policy.js';
import { NotificationPipeline } from './pipeline.js';
import { DigestAggregator } from './digest.js';
import { EmailChannel } from './channels/email.js';
import { TelegramChannel } from './channels/telegram.js';
import { PushChannel } from './channels/push.js';

/**
 * Create and configure a NotificationRouter with all available channels.
 * Low-level: used by test-notify endpoint and as Pipeline dependency.
 *
 * @param {object} options
 * @param {object} [options.db] - Database instance
 * @returns {NotificationRouter}
 */
export function createNotificationRouter({ db = null } = {}) {
  const rawDb = db?.db || db;
  const router = new NotificationRouter({ logger, db: rawDb });

  router.registerChannel(new EmailChannel({ logger }));
  router.registerChannel(new TelegramChannel({ logger }));
  router.registerChannel(new PushChannel({ logger }));

  return router;
}

/**
 * Create the full notification pipeline (router + policy + digest).
 * This is what the runner should use for all notification delivery.
 *
 * @param {object} options
 * @param {object} [options.db] - Database instance
 * @returns {{ pipeline: NotificationPipeline, router: NotificationRouter, policy: NotificationPolicy, digest: DigestAggregator }}
 */
export function createNotificationPipeline({ db = null } = {}) {
  const rawDb = db?.db || db;
  const router = createNotificationRouter({ db: rawDb });
  const policy = new NotificationPolicy({ db: rawDb, logger });
  const digest = new DigestAggregator({ db: rawDb, logger });
  const pipeline = new NotificationPipeline({ router, policy, digest, db: rawDb, logger });

  return { pipeline, router, policy, digest };
}
