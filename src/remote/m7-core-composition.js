// Transport-free M7 core composition.
//
// This is deliberately not a server bootstrap. It composes only reviewed
// in-process adapters and keeps session, listener, pairing and transport
// authority outside the module.

import {
  validateConversationCommand,
  validateConversationResult,
} from '../../contracts/m1/index.js';
import { validateProjectContextSnapshot } from '../../contracts/m2/project-context-v1.js';
import {
  MOBILE_REMOTE_CAPABILITY_MANIFESTS_V1,
  MOBILE_REMOTE_CONTROL_PLANE_MANIFEST_V1,
  validateMobileRemoteOperationPair,
} from '../../docs/mobile/contracts/remote-capability-manifests-v1.js';
import {
  validateMobileRemotePayload,
} from '../../docs/mobile/contracts/remote-capability-payloads-v1.js';
import {
  MOBILE_REMOTE_CAPABILITY_REQUIREMENTS_V1,
} from '../../docs/mobile/contracts/remote-capability-requirements-v1.js';
import { createM7ConversationCoreAdapters } from './m7-conversation-core-adapters.js';
import { createM7InProcessCapabilityProvider } from './m7-in-process-capability-provider.js';
import { createM7M2ApprovalCoreAdapters } from './m7-m2-approval-core-adapters.js';
import { createM7NotificationCoreAdapters } from './m7-notification-core-adapters.js';
import { createM7OperationControlAdapters } from './m7-operation-control-adapters.js';
import { createM7OperationJournal } from './m7-operation-journal.js';
import { createM7ProjectCoreAdapters } from './m7-project-core-adapters.js';
import { createM7RemoteHealthAdapter } from './m7-remote-health-adapter.js';
import { consumeM7RunEventCoreAdapter } from './m7-run-event-core-adapter.js';
import {
  createM7SettingsInformationCoreAdapters,
} from './m7-settings-information-core-adapters.js';

export const M7_CORE_COMPOSITION_STAGE = 'COMPOSED_NOT_ACTIVE';

const CONFIG_KEYS = Object.freeze([
  'authorityResolver',
  'authorizeConversation',
  'authorizeProject',
  'clock',
  'coreVersion',
  'cursorKey',
  'database',
  'executeConversation',
  'healthComponents',
  'maxConversationScan',
  'maxInformationScan',
  'maxApprovalScan',
  'maxMessageScan',
  'maxNotificationScan',
  'maxProjectScan',
  'mediateMutation',
  'mutationMediator',
  'm2ApprovalPort',
  'notificationPort',
  'observeWorkspaceRevision',
  'authorizeNotification',
  'queryProjectContext',
  'realpath',
  'runEventAdapter',
]);

const EXTERNAL_VALIDATORS = Object.freeze({
  'ConversationCommand@1': validateConversationCommand,
  'ConversationResult@1': validateConversationResult,
  'ProjectContextSnapshot@1': validateProjectContextSnapshot,
});

function plain(value) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function requireExactConfig(value) {
  if (!plain(value) || Object.keys(value).some(key => !CONFIG_KEYS.includes(key))) {
    throw new TypeError('m7-core-composition:config-invalid');
  }
  return value;
}

function mergeHandlers(...groups) {
  const handlers = {};
  for (const group of groups) {
    if (!plain(group)) throw new TypeError('m7-core-composition:handler-group-invalid');
    for (const [operationId, handler] of Object.entries(group)) {
      if (Object.hasOwn(handlers, operationId) || typeof handler !== 'function') {
        throw new TypeError('m7-core-composition:handler-collision-or-invalid');
      }
      handlers[operationId] = handler;
    }
  }
  return Object.freeze(handlers);
}

export function createM7CoreComposition(configValue = {}) {
  const config = requireExactConfig(configValue);
  if (config.mediateMutation !== undefined && config.mutationMediator !== undefined) {
    throw new TypeError('m7-core-composition:mutation-authority-ambiguous');
  }
  const clock = config.clock ?? Date.now;
  const journal = createM7OperationJournal(config.database, { clock });
  const projects = createM7ProjectCoreAdapters({
    authorizeProject: config.authorizeProject,
    cursorKey: config.cursorKey,
    database: config.database,
    maxProjectScan: config.maxProjectScan,
    now: clock,
    observeWorkspaceRevision: config.observeWorkspaceRevision,
    queryProjectContext: config.queryProjectContext,
    realpath: config.realpath,
  });
  const conversations = createM7ConversationCoreAdapters({
    authorizeConversation: config.authorizeConversation,
    cursorKey: config.cursorKey,
    database: config.database,
    executeConversation: config.executeConversation,
    maxConversationScan: config.maxConversationScan,
    maxMessageScan: config.maxMessageScan,
  });
  const settingsInformation = createM7SettingsInformationCoreAdapters({
    authorizeProject: config.authorizeProject,
    cursorKey: config.cursorKey,
    database: config.database,
    mediateMutation: config.mutationMediator?.mediate ?? config.mediateMutation,
    maxInformationScan: config.maxInformationScan,
    now: clock,
  });
  const operationControl = createM7OperationControlAdapters({
    cursorKey: config.cursorKey,
    journal,
  });
  const approvals = config.m2ApprovalPort === undefined
    ? null
    : createM7M2ApprovalCoreAdapters({
      approvalPort: config.m2ApprovalPort,
      cursorKey: config.cursorKey,
      maxApprovalScan: config.maxApprovalScan,
      now: clock,
    });
  const events = config.runEventAdapter === undefined
    ? null
    : consumeM7RunEventCoreAdapter(config.runEventAdapter);
  const notifications = config.notificationPort === undefined
    ? null
    : createM7NotificationCoreAdapters({
      authorizeNotification: config.authorizeNotification,
      database: config.database,
      maxNotificationScan: config.maxNotificationScan,
      notificationPort: config.notificationPort,
      now: clock,
    });
  const health = createM7RemoteHealthAdapter({
    clock,
    components: config.healthComponents,
    coreVersion: config.coreVersion,
  });
  const handlers = mergeHandlers(
    approvals?.handlers ?? {},
    events?.handlers ?? {},
    notifications?.handlers ?? {},
    projects.handlers,
    conversations.handlers,
    settingsInformation.handlers,
    operationControl.handlers,
    health.handlers,
  );
  const provider = createM7InProcessCapabilityProvider({
    authorityResolver: config.authorityResolver,
    controlPlaneManifest: MOBILE_REMOTE_CONTROL_PLANE_MANIFEST_V1,
    externalValidators: EXTERNAL_VALIDATORS,
    handlers,
    manifests: MOBILE_REMOTE_CAPABILITY_MANIFESTS_V1,
    mutationMediator: config.mutationMediator,
    mutationJournal: journal,
    requirements: MOBILE_REMOTE_CAPABILITY_REQUIREMENTS_V1,
    validateOperationPair: validateMobileRemoteOperationPair,
    validatePayload: validateMobileRemotePayload,
  });

  return Object.freeze({
    adapters: Object.freeze({
      approvals,
      conversations,
      events,
      health,
      notifications,
      operationControl,
      projects,
      settingsInformation,
    }),
    journal,
    provider,
    stage: M7_CORE_COMPOSITION_STAGE,
  });
}

export default createM7CoreComposition;
