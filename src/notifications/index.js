// C.3 v57.0 — Notifications Module
// ══════════════════════════════════════════════════════════════════════════════

export { NotificationRouter } from './service.js';
export { NotificationChannel } from './channels/base.js';
export { EmailChannel } from './channels/email.js';
export { TelegramChannel } from './channels/telegram.js';
export { PushChannel } from './channels/push.js';
export { WebhookChannel } from './channels/webhook.js';
export { DesktopChannel } from './channels/desktop.js';
export {
  EXTERNAL_NOTIFICATION_CHANNEL_FLAGS,
  NOTIFICATION_CHANNEL_DISABLED,
  NOTIFICATION_CHANNEL_POLICY_INVALID,
  notificationChannelEnabled,
  readNotificationChannelPolicy,
} from './channel-policy.js';
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
import { WebhookChannel } from './channels/webhook.js';
import { DesktopChannel } from './channels/desktop.js';
import {
  EXTERNAL_NOTIFICATION_CHANNELS,
  notificationChannelEnabled,
  readNotificationChannelPolicy,
  requireNotificationChannelPolicy,
} from './channel-policy.js';

const DEFAULT_CHANNEL_FACTORIES = Object.freeze({
  email: (channelLogger, authorities) => new EmailChannel({
    logger: channelLogger,
    ...authorities,
  }),
  telegram: (channelLogger, authorities) => new TelegramChannel({
    logger: channelLogger,
    ...authorities,
  }),
  push: (channelLogger, authorities) => new PushChannel({
    logger: channelLogger,
    ...authorities,
  }),
  webhook: (channelLogger, authorities) => new WebhookChannel({
    logger: channelLogger,
    url: authorities.notificationEnvironmentAuthority.value('C3_WEBHOOK_URL'),
    requireWebhookSecretAuthority: authorities.requireWebhookSecretAuthority,
    webhookSecretAuthority: authorities.webhookSecretAuthority,
  }),
  desktop: channelLogger => new DesktopChannel({ logger: channelLogger }),
});

function notificationFactoryError() {
  const error = new TypeError('NOTIFICATION_CHANNEL_FACTORY_INVALID');
  error.code = 'NOTIFICATION_CHANNEL_FACTORY_INVALID';
  return error;
}

/**
 * Create and configure a NotificationRouter with all available channels.
 * Low-level: used by test-notify endpoint and as Pipeline dependency.
 *
 * @param {object} options
 * @param {object} [options.db] - Database instance
 * @param {Function} [options.requireNotificationEnvironmentAuthority] - Authority validator
 * @param {object} [options.notificationEnvironmentAuthority] - Opaque notification authority
 * @param {Function} [options.requireWebhookSecretAuthority] - Authority validator
 * @param {object} [options.webhookSecretAuthority] - Opaque webhook HMAC authority
 * @returns {NotificationRouter}
 */
export function createNotificationRouter({
  db = null,
  env = process.env,
  channelPolicy = null,
  channelFactories = DEFAULT_CHANNEL_FACTORIES,
  logger: channelLogger = logger,
  requireNotificationEnvironmentAuthority = null,
  notificationEnvironmentAuthority = null,
  requireWebhookSecretAuthority = null,
  webhookSecretAuthority = null,
} = {}) {
  const rawDb = db?.db || db;
  const validatedPolicy = channelPolicy === null
    ? readNotificationChannelPolicy(env)
    : requireNotificationChannelPolicy(channelPolicy);
  if (!channelFactories || typeof channelFactories !== 'object') {
    throw notificationFactoryError();
  }
  if (typeof requireNotificationEnvironmentAuthority !== 'function') {
    throw notificationFactoryError();
  }
  const validatedNotificationEnvironmentAuthority =
    requireNotificationEnvironmentAuthority(notificationEnvironmentAuthority);
  const authorities = Object.freeze({
    notificationEnvironmentAuthority: validatedNotificationEnvironmentAuthority,
    requireNotificationEnvironmentAuthority,
    requireWebhookSecretAuthority,
    webhookSecretAuthority,
  });
  const router = new NotificationRouter({
    logger: channelLogger,
    db: rawDb,
    channelPolicy: validatedPolicy,
  });

  for (const channelName of EXTERNAL_NOTIFICATION_CHANNELS) {
    if (!notificationChannelEnabled(validatedPolicy, channelName)) continue;
    const factory = Object.hasOwn(channelFactories, channelName)
      ? channelFactories[channelName]
      : null;
    if (typeof factory !== 'function') {
      throw notificationFactoryError();
    }
    const channel = factory(channelLogger, authorities);
    if (!channel || channel.name !== channelName || !router.registerChannel(channel)) {
      throw notificationFactoryError();
    }
  }

  return router;
}

/**
 * Create the full notification pipeline (router + policy + digest).
 * This is what the runner should use for all notification delivery.
 *
 * @param {object} options
 * @param {object} [options.db] - Database instance
 * @param {Function} [options.requireNotificationEnvironmentAuthority] - Authority validator
 * @param {object} [options.notificationEnvironmentAuthority] - Opaque notification authority
 * @param {Function} [options.requireWebhookSecretAuthority] - Authority validator
 * @param {object} [options.webhookSecretAuthority] - Opaque webhook HMAC authority
 * @returns {{ pipeline: NotificationPipeline, router: NotificationRouter, policy: NotificationPolicy, digest: DigestAggregator }}
 */
export function createNotificationPipeline({
  db = null,
  env = process.env,
  channelPolicy = null,
  channelFactories = DEFAULT_CHANNEL_FACTORIES,
  logger: channelLogger = logger,
  requireNotificationEnvironmentAuthority = null,
  notificationEnvironmentAuthority = null,
  requireWebhookSecretAuthority = null,
  webhookSecretAuthority = null,
} = {}) {
  const rawDb = db?.db || db;
  const router = createNotificationRouter({
    db: rawDb,
    env,
    channelPolicy,
    channelFactories,
    logger: channelLogger,
    requireNotificationEnvironmentAuthority,
    notificationEnvironmentAuthority,
    requireWebhookSecretAuthority,
    webhookSecretAuthority,
  });
  const policy = new NotificationPolicy({ db: rawDb, logger: channelLogger });
  const digest = new DigestAggregator({ db: rawDb, logger: channelLogger });
  const pipeline = new NotificationPipeline({
    router,
    policy,
    digest,
    db: rawDb,
    logger: channelLogger,
  });

  return { pipeline, router, policy, digest };
}
