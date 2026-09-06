// RemoteCorePort candidate contract v1.
//
// This is an in-process connector contract, not an HTTP route list. The core
// owns it and a companion gateway may consume it without receiving a generic
// request, module-import or legacy-listener escape hatch.

export const REMOTE_CORE_PORT_NAME = 'RemoteCorePort';
export const REMOTE_CORE_PORT_VERSION = 1;

// M1's ConversationCommand/Result and CoreEvent are still PROVISIONAL_V1.
// Keep this candidate label honest until those prerequisite contracts are
// pinned; changing this to FROZEN requires its own reviewed milestone.
export const REMOTE_CORE_PORT_STAGE = 'CANDIDATE_V1';

const feature = (domain, action, scopes, mutation = false) => Object.freeze({
  domain,
  action,
  scopes: Object.freeze([...scopes]),
  mutation,
});

export const REMOTE_CORE_FEATURES = Object.freeze({
  'projects.read': feature('projects', 'read', ['read:projects']),
  'projects.create': feature('projects', 'create', ['write:projects'], true),
  'projects.update': feature('projects', 'update', ['write:projects'], true),
  'projects.archive': feature('projects', 'archive', ['write:projects'], true),

  'conversations.read': feature('conversations', 'read', ['read:chat']),
  'conversations.create': feature('conversations', 'create', ['write:chat'], true),
  'conversations.update': feature('conversations', 'update', ['write:chat'], true),
  'conversations.archive': feature('conversations', 'archive', ['write:chat'], true),
  'conversations.send': feature('conversations', 'send', ['write:chat'], true),

  'settings.read': feature('settings', 'read', ['read:settings']),
  'settings.write': feature('settings', 'write', ['write:settings'], true),

  'storedInformation.read': feature('storedInformation', 'read', ['read:memory']),
  'storedInformation.write': feature('storedInformation', 'write', ['write:memory'], true),
  'storedInformation.delete': feature('storedInformation', 'delete', ['write:memory'], true),

  'workers.read': feature('workers', 'read', ['read:workers']),
  'workers.toggle': feature('workers', 'toggle', ['write:workers'], true),
  'workers.dryRun': feature('workers', 'dryRun', ['execute:worker-dry-run'], true),

  'specialists.read': feature('specialists', 'read', ['read:specialists']),
  'specialists.toggle': feature('specialists', 'toggle', ['write:specialists'], true),

  'approvals.read': feature('approvals', 'read', ['read:approvals']),
  'approvals.decide': feature('approvals', 'decide', ['write:approvals'], true),

  'notifications.read': feature('notifications', 'read', ['read:notifications']),
  'notifications.ack': feature('notifications', 'ack', ['write:notifications'], true),

  'events.read': feature('events', 'read', ['read:events']),
});

export const REMOTE_CORE_DOMAINS = Object.freeze([
  'projects',
  'conversations',
  'settings',
  'storedInformation',
  'workers',
  'specialists',
  'approvals',
  'notifications',
  'events',
]);

export const REMOTE_CORE_FEATURE_IDS = Object.freeze(Object.keys(REMOTE_CORE_FEATURES));
export const REMOTE_CORE_SUPPORTED_VERSIONS = Object.freeze([REMOTE_CORE_PORT_VERSION]);

export function negotiateRemoteCoreVersion(offered = REMOTE_CORE_SUPPORTED_VERSIONS) {
  if (!Array.isArray(offered) || offered.length === 0 || offered.length > 8) {
    return Object.freeze({
      ok: false,
      code: 'contract_offer_invalid',
      supportedVersions: REMOTE_CORE_SUPPORTED_VERSIONS,
    });
  }

  const normalized = offered.map(value => (
    typeof value === 'string' && /^v[1-9][0-9]*$/.test(value)
      ? Number.parseInt(value.slice(1), 10)
      : value
  ));
  if (normalized.some(value => !Number.isSafeInteger(value) || value < 1)) {
    return Object.freeze({
      ok: false,
      code: 'contract_offer_invalid',
      supportedVersions: REMOTE_CORE_SUPPORTED_VERSIONS,
    });
  }
  if (new Set(normalized).size !== normalized.length) {
    return Object.freeze({
      ok: false,
      code: 'contract_offer_duplicate',
      supportedVersions: REMOTE_CORE_SUPPORTED_VERSIONS,
    });
  }

  const selected = normalized.find(value => REMOTE_CORE_SUPPORTED_VERSIONS.includes(value));
  if (!selected) {
    return Object.freeze({
      ok: false,
      code: 'contract_version_unsupported',
      supportedVersions: REMOTE_CORE_SUPPORTED_VERSIONS,
    });
  }
  return Object.freeze({
    ok: true,
    name: REMOTE_CORE_PORT_NAME,
    version: selected,
    stage: REMOTE_CORE_PORT_STAGE,
  });
}

export default {
  REMOTE_CORE_PORT_NAME,
  REMOTE_CORE_PORT_VERSION,
  REMOTE_CORE_PORT_STAGE,
  REMOTE_CORE_FEATURES,
  REMOTE_CORE_DOMAINS,
  REMOTE_CORE_FEATURE_IDS,
  REMOTE_CORE_SUPPORTED_VERSIONS,
  negotiateRemoteCoreVersion,
};
