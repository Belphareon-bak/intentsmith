import { realpath as defaultRealpath } from 'node:fs/promises';
import path from 'node:path';

import {
  PROJECT_CONTEXT_ERROR_CODE,
  isProjectContextProjectId,
} from '../../contracts/m2/project-context-v1.js';
import { isPlainRecord } from '../../contracts/m1/shared.js';

const ACTIVE_PROJECT_STATUS = 'active';

function isCanonicalAbsoluteRoot(value) {
  return typeof value === 'string'
    && value.length > 0
    && !value.includes('\0')
    && path.posix.isAbsolute(value)
    && path.posix.normalize(value) === value;
}

function invalidScope(reason, options = {}) {
  return new ProjectContextScopeError(reason, options);
}

export class ProjectContextScopeError extends Error {
  constructor(reason, options = {}) {
    super('Project context scope is not bound to an active registered project.', options);
    this.name = 'ProjectContextScopeError';
    this.code = PROJECT_CONTEXT_ERROR_CODE.INVALID_SCOPE;
    this.reason = reason;
  }
}

/**
 * Resolves a caller scope through the project registry and fails closed on any
 * identity/root ambiguity. The registry lookup is intentionally ID-only: path
 * lookup must never turn a caller-supplied root into project authority.
 */
export async function resolveProjectContextScope(
  scope,
  { projects, realpath = defaultRealpath } = {},
) {
  if (typeof projects?.findById?.get !== 'function') {
    throw new TypeError('project-context-scope:projects.findById.get-required');
  }
  if (typeof realpath !== 'function') {
    throw new TypeError('project-context-scope:realpath-required');
  }
  if (!isPlainRecord(scope)) {
    throw invalidScope('invalid-scope');
  }

  const { projectId, canonicalRoot } = scope;
  if (!isProjectContextProjectId(projectId)) {
    throw invalidScope('invalid-project-id');
  }
  if (!isCanonicalAbsoluteRoot(canonicalRoot)) {
    throw invalidScope('noncanonical-root');
  }

  let project;
  try {
    project = await projects.findById.get(projectId);
  } catch (cause) {
    throw invalidScope('registry-lookup-failed', { cause });
  }

  if (!isPlainRecord(project) || project.id !== projectId) {
    throw invalidScope('project-not-found');
  }
  if (project.status !== ACTIVE_PROJECT_STATUS) {
    throw invalidScope('project-not-active');
  }
  if (typeof project.path !== 'string' || project.path.length === 0) {
    throw invalidScope('invalid-registered-root');
  }

  let registeredRoot;
  try {
    registeredRoot = await realpath(project.path);
  } catch (cause) {
    throw invalidScope('registered-root-unavailable', { cause });
  }

  if (!isCanonicalAbsoluteRoot(registeredRoot)) {
    throw invalidScope('invalid-registered-root');
  }
  if (canonicalRoot !== registeredRoot) {
    throw invalidScope('root-mismatch');
  }

  return Object.freeze({ projectId, canonicalRoot: registeredRoot });
}
