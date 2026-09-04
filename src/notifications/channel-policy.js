// External notification channel authority.
//
// Core in-app notifications are always local and need no opt-in. Every
// retained external channel is disabled unless its exact environment flag is
// the literal string "true".

export const NOTIFICATION_CHANNEL_POLICY_INVALID = 'NOTIFICATION_CHANNEL_POLICY_INVALID';
export const NOTIFICATION_CHANNEL_DISABLED = 'NOTIFICATION_CHANNEL_DISABLED';
export const NOTIFICATION_CHANNEL_UNSUPPORTED = 'NOTIFICATION_CHANNEL_UNSUPPORTED';

export const EXTERNAL_NOTIFICATION_CHANNEL_FLAGS = Object.freeze({
  email: 'C3_ENABLE_NOTIFICATION_EMAIL',
  telegram: 'C3_ENABLE_NOTIFICATION_TELEGRAM',
  push: 'C3_ENABLE_NOTIFICATION_PUSH',
  webhook: 'C3_ENABLE_NOTIFICATION_WEBHOOK',
  desktop: 'C3_ENABLE_NOTIFICATION_DESKTOP',
});

export const EXTERNAL_NOTIFICATION_CHANNELS = Object.freeze(
  Object.keys(EXTERNAL_NOTIFICATION_CHANNEL_FLAGS),
);

// Internal channels never cross an operator-selected external transport.
// `mobile` persists only an already-authorised, content-free projection in the
// companion inbox; the gateway transport has its own authentication boundary.
export const INTERNAL_NOTIFICATION_CHANNELS = Object.freeze(['mobile']);
const INTERNAL_NOTIFICATION_CHANNEL_SET = new Set(INTERNAL_NOTIFICATION_CHANNELS);

const VALIDATED_POLICIES = new WeakSet();

export class NotificationChannelPolicyError extends Error {
  constructor() {
    super(NOTIFICATION_CHANNEL_POLICY_INVALID);
    this.name = 'NotificationChannelPolicyError';
    this.code = NOTIFICATION_CHANNEL_POLICY_INVALID;
  }
}

export function canonicalNotificationChannelName(channelName) {
  return typeof channelName === 'string' ? channelName : null;
}

export function canonicalNotificationVerifierChannelName(channelName) {
  return channelName === 'ntfy'
    ? 'push'
    : canonicalNotificationChannelName(channelName);
}

export function readNotificationChannelPolicy(env = process.env) {
  if (!env || typeof env !== 'object') {
    throw new NotificationChannelPolicyError();
  }

  const enabled = Object.create(null);
  for (const channelName of EXTERNAL_NOTIFICATION_CHANNELS) {
    const envName = EXTERNAL_NOTIFICATION_CHANNEL_FLAGS[channelName];
    const value = Object.hasOwn(env, envName) ? env[envName] : undefined;
    if (value !== undefined && value !== 'true' && value !== 'false') {
      throw new NotificationChannelPolicyError();
    }
    enabled[channelName] = value === 'true';
  }

  const policy = Object.freeze({
    enabled: Object.freeze(enabled),
  });
  VALIDATED_POLICIES.add(policy);
  return policy;
}

export function requireNotificationChannelPolicy(policy) {
  if (!policy || !VALIDATED_POLICIES.has(policy)) {
    throw new NotificationChannelPolicyError();
  }
  return policy;
}

export function isManagedExternalNotificationChannel(channelName) {
  const canonicalName = canonicalNotificationChannelName(channelName);
  return canonicalName !== null
    && Object.hasOwn(EXTERNAL_NOTIFICATION_CHANNEL_FLAGS, canonicalName);
}

export function isManagedNotificationChannel(channelName) {
  const canonicalName = canonicalNotificationChannelName(channelName);
  return canonicalName === 'in_app'
    || INTERNAL_NOTIFICATION_CHANNEL_SET.has(canonicalName)
    || isManagedExternalNotificationChannel(canonicalName);
}

export function notificationChannelEnabled(policy, channelName) {
  requireNotificationChannelPolicy(policy);
  if (channelName === 'in_app') return true;
  const canonicalName = canonicalNotificationChannelName(channelName);
  return canonicalName !== null
    && Object.hasOwn(EXTERNAL_NOTIFICATION_CHANNEL_FLAGS, canonicalName)
    && policy.enabled[canonicalName] === true;
}

export function notificationChannelDecision(policy, channelName) {
  requireNotificationChannelPolicy(policy);
  if (channelName === 'in_app') {
    return Object.freeze({
      managed: true,
      external: false,
      canonicalName: 'in_app',
      enabled: true,
      code: null,
    });
  }

  const canonicalName = canonicalNotificationChannelName(channelName);
  if (INTERNAL_NOTIFICATION_CHANNEL_SET.has(canonicalName)) {
    return Object.freeze({
      managed: true,
      external: false,
      canonicalName,
      enabled: true,
      code: null,
    });
  }
  const managed = canonicalName !== null
    && Object.hasOwn(EXTERNAL_NOTIFICATION_CHANNEL_FLAGS, canonicalName);
  const enabled = managed && policy.enabled[canonicalName] === true;
  return Object.freeze({
    managed,
    external: managed,
    canonicalName,
    enabled,
    code: managed
      ? (enabled ? null : NOTIFICATION_CHANNEL_DISABLED)
      : NOTIFICATION_CHANNEL_UNSUPPORTED,
  });
}

export function notificationVerifierChannelEnabled(policy, channelName) {
  requireNotificationChannelPolicy(policy);
  const canonicalName = canonicalNotificationVerifierChannelName(channelName);
  return canonicalName !== null
    && Object.hasOwn(EXTERNAL_NOTIFICATION_CHANNEL_FLAGS, canonicalName)
    && policy.enabled[canonicalName] === true;
}
