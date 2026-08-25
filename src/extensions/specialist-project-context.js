import { createHash } from 'node:crypto';

import {
  PROJECT_CONTEXT_CONTRACT_VERSION,
  PROJECT_CONTEXT_KIND,
} from '../../contracts/m2/project-context-v1.js';
import { projectContextProvider as defaultProvider } from '../code-intel/project-context-provider.js';

const CAPABILITY_CONTRACT = 'SpecialistProjectContextCapability';
const CAPABILITY_VERSION = 1;
const DEFAULT_BUDGET = Object.freeze({
  maxFiles: 8,
  maxBytes: 32_768,
  maxTokens: 8_192,
});
const MAX_BUDGET = Object.freeze({
  maxFiles: 16,
  maxBytes: 65_536,
  maxTokens: 16_384,
});

function fail(message, code = 'M3_SPECIALIST_PROJECT_CONTEXT_INVALID') {
  throw Object.assign(new Error(message), { code });
}

function boundedInteger(value, fallback, maximum, label) {
  const resolved = value ?? fallback;
  if (!Number.isSafeInteger(resolved) || resolved < 1 || resolved > maximum) {
    fail(`${label} is outside the specialist ProjectContext budget`);
  }
  return resolved;
}

function requestId(state, query) {
  const digest = createHash('sha256').update(JSON.stringify({
    extensionId: state.extensionId,
    toolId: state.toolId,
    conversationId: state.conversationId,
    userMessageId: state.userMessageId,
    projectId: state.projectId,
    queryText: query.queryText,
    maxFiles: query.maxFiles,
    maxBytes: query.maxBytes,
    maxTokens: query.maxTokens,
  })).digest('hex');
  return `spctx:${digest}`;
}

/**
 * A capability with split authority:
 * - only core receives `host.openInvocation()`;
 * - extensions receive `capability.query()` and an opaque per-turn token.
 *
 * An extension therefore cannot name another project or invent ambient path
 * authority. ProjectContext still re-resolves the registered root and checks
 * the workspace revision before and after retrieval.
 */
export function createSpecialistProjectContextBridge({ provider = defaultProvider } = {}) {
  if (
    !provider
    || typeof provider.observeWorkspaceRevision !== 'function'
    || typeof provider.queryProjectContext !== 'function'
  ) fail('A complete ProjectContext provider is required');

  const invocations = new WeakMap();

  const host = Object.freeze({
    openInvocation({ extensionId, toolId, project, conversationId, userMessageId, signal = null } = {}) {
      const projectId = Number(project?.id);
      if (
        typeof extensionId !== 'string'
        || typeof toolId !== 'string'
        || !Number.isSafeInteger(projectId)
        || projectId <= 0
        || typeof project?.path !== 'string'
        || project.path.length === 0
        || !conversationId
        || !Number.isSafeInteger(Number(userMessageId))
        || Number(userMessageId) <= 0
      ) fail(
        'Specialist ProjectContext requires an exact extension, tool, persisted turn and active project',
        'M3_SPECIALIST_PROJECT_CONTEXT_REQUIRED',
      );
      const token = Object.freeze(Object.create(null));
      invocations.set(token, Object.freeze({
        extensionId,
        toolId,
        projectId,
        canonicalRoot: project.path,
        conversationId: String(conversationId),
        userMessageId: Number(userMessageId),
        signal,
      }));
      return token;
    },
    closeInvocation(token) {
      return invocations.delete(token);
    },
  });

  const capability = Object.freeze({
    contract: CAPABILITY_CONTRACT,
    version: CAPABILITY_VERSION,
    async query(invocation, options = {}) {
      const state = invocations.get(invocation);
      if (!state) fail(
        'ProjectContext invocation is not owned by the specialist host',
        'M3_SPECIALIST_PROJECT_CONTEXT_AUTHORITY_REQUIRED',
      );
      // A persisted-turn capability is deliberately one-shot. Package code
      // cannot retain it and replay a later read after core returned control.
      invocations.delete(invocation);
      const allowed = new Set(['queryText', 'maxFiles', 'maxBytes', 'maxTokens']);
      if (!options || typeof options !== 'object' || Array.isArray(options)
        || Object.keys(options).some(key => !allowed.has(key))) {
        fail('ProjectContext query has unsupported fields');
      }
      if (typeof options.queryText !== 'string' || options.queryText.trim().length === 0) {
        fail('ProjectContext queryText is required');
      }
      const query = {
        queryText: options.queryText,
        maxFiles: boundedInteger(options.maxFiles, DEFAULT_BUDGET.maxFiles, MAX_BUDGET.maxFiles, 'maxFiles'),
        maxBytes: boundedInteger(options.maxBytes, DEFAULT_BUDGET.maxBytes, MAX_BUDGET.maxBytes, 'maxBytes'),
        maxTokens: boundedInteger(options.maxTokens, DEFAULT_BUDGET.maxTokens, MAX_BUDGET.maxTokens, 'maxTokens'),
      };
      const invocationContext = { signal: state.signal };
      const observation = await provider.observeWorkspaceRevision({
        projectId: state.projectId,
        canonicalRoot: state.canonicalRoot,
      }, invocationContext);
      return provider.queryProjectContext({
        contract: PROJECT_CONTEXT_KIND.QUERY,
        version: PROJECT_CONTEXT_CONTRACT_VERSION,
        requestId: requestId(state, query),
        projectId: observation.projectId,
        canonicalRoot: observation.canonicalRoot,
        workspaceRevision: observation.workspaceRevision,
        ...query,
      }, invocationContext);
    },
  });

  return Object.freeze({ host, capability });
}

export const specialistProjectContextBridge = createSpecialistProjectContextBridge();

export default specialistProjectContextBridge;
