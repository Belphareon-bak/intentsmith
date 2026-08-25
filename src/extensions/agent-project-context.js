import { createHash } from 'node:crypto';
import { realpath as defaultRealpath } from 'node:fs/promises';

import {
  PROJECT_CONTEXT_CONTRACT_VERSION,
  PROJECT_CONTEXT_KIND,
} from '../../contracts/m2/project-context-v1.js';
import { projectContextProvider as defaultProvider } from '../code-intel/project-context-provider.js';

const CAPABILITY_CONTRACT = 'AgentProjectContextCapability';
const CAPABILITY_VERSION = 1;
const DEFAULT_BUDGET = Object.freeze({
  maxFiles: 12,
  maxBytes: 49_152,
  maxTokens: 12_288,
});
const MAX_BUDGET = Object.freeze({
  maxFiles: 16,
  maxBytes: 65_536,
  maxTokens: 16_384,
});

function fail(message, code = 'M3_AGENT_PROJECT_CONTEXT_INVALID') {
  throw Object.assign(new Error(message), { code });
}

function boundedInteger(value, fallback, maximum, label) {
  const resolved = value ?? fallback;
  if (!Number.isSafeInteger(resolved) || resolved < 1 || resolved > maximum) {
    fail(`${label} is outside the agent ProjectContext budget`);
  }
  return resolved;
}

function requestId(state, query) {
  const digest = createHash('sha256').update(JSON.stringify({
    extensionId: state.extensionId,
    agentId: state.agentId,
    runId: state.runId,
    projectId: state.projectId,
    query,
  })).digest('hex');
  return `agctx:${digest}`;
}

/**
 * Split authority for autonomous agent reads. Only the host can bind a token
 * to a durable agent run and an active project registry row. Extension data
 * receives only the one-shot query capability and can neither nominate a path
 * nor retain ambient read authority across runs.
 */
export function createAgentProjectContextBridge({
  provider = defaultProvider,
  projects,
  realpath = defaultRealpath,
} = {}) {
  if (
    !provider
    || typeof provider.observeWorkspaceRevision !== 'function'
    || typeof provider.queryProjectContext !== 'function'
  ) fail('A complete ProjectContext provider is required');
  if (typeof projects?.findById?.get !== 'function') {
    fail('The active project registry is required');
  }
  if (typeof realpath !== 'function') fail('A canonical root resolver is required');

  const invocations = new WeakMap();

  const host = Object.freeze({
    async openInvocation({ extensionId, agentId, runId, projectId, signal = null } = {}) {
      const numericProjectId = Number(projectId);
      if (
        typeof extensionId !== 'string'
        || extensionId.length === 0
        || typeof agentId !== 'string'
        || agentId.length === 0
        || !Number.isSafeInteger(Number(runId))
        || Number(runId) <= 0
        || !Number.isSafeInteger(numericProjectId)
        || numericProjectId <= 0
      ) fail(
        'Agent ProjectContext requires an exact extension, agent, run and project',
        'M3_AGENT_PROJECT_CONTEXT_REQUIRED',
      );
      const project = projects.findById.get(numericProjectId);
      if (!project || project.status !== 'active' || typeof project.path !== 'string') {
        fail('Agent ProjectContext project is not active', 'M3_AGENT_PROJECT_CONTEXT_REQUIRED');
      }
      let canonicalRoot;
      try {
        canonicalRoot = await realpath(project.path);
      } catch {
        fail('Agent ProjectContext project root is unavailable', 'M3_AGENT_PROJECT_CONTEXT_REQUIRED');
      }
      const token = Object.freeze(Object.create(null));
      invocations.set(token, Object.freeze({
        extensionId,
        agentId,
        runId: Number(runId),
        projectId: numericProjectId,
        canonicalRoot,
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
        'ProjectContext invocation is not owned by the agent host',
        'M3_AGENT_PROJECT_CONTEXT_AUTHORITY_REQUIRED',
      );
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
      const invocationContext = state.signal ? { signal: state.signal } : {};
      const observation = await provider.observeWorkspaceRevision({
        projectId: state.projectId,
        canonicalRoot: state.canonicalRoot,
      }, invocationContext, { projects });
      return provider.queryProjectContext({
        contract: PROJECT_CONTEXT_KIND.QUERY,
        version: PROJECT_CONTEXT_CONTRACT_VERSION,
        requestId: requestId(state, query),
        projectId: observation.projectId,
        canonicalRoot: observation.canonicalRoot,
        workspaceRevision: observation.workspaceRevision,
        ...query,
      }, invocationContext, { projects });
    },
  });

  return Object.freeze({ host, capability });
}

export default createAgentProjectContextBridge;
