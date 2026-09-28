import { createHash } from 'node:crypto';
import { readFile as defaultReadFile } from 'node:fs/promises';
import path from 'node:path';

import {
  PROJECT_CONTEXT_CONTRACT_VERSION,
  PROJECT_CONTEXT_ERROR_CODE,
  PROJECT_CONTEXT_KIND,
  PROJECT_CONTEXT_NORMALIZATION_VERSION,
  PROJECT_CONTEXT_OUTCOME,
  PROJECT_CONTEXT_TERMINAL_STATUS,
  computeProjectContextSnapshotDigest,
  estimateProjectContextTokens,
  normalizeProjectContextQuery,
  validateProjectContextQuery,
  validateProjectContextSnapshot,
} from '../../contracts/m2/project-context-v1.js';
import {
  PROJECT_CONTEXT_SOURCE_SET,
  ProjectContextManifestError,
  buildProjectContextManifest,
} from './project-context-manifest.js';
import {
  ProjectContextScopeError,
  resolveProjectContextScope,
} from './project-context-scope.js';

const utf8Decoder = new TextDecoder('utf-8', { fatal: true });
const MAX_SNIPPET_LINES = 80;
const CONTEXT_LINES_BEFORE = 5;

function compareUtf8(left, right) {
  return Buffer.compare(Buffer.from(left, 'utf8'), Buffer.from(right, 'utf8'));
}

function deepFreeze(value) {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    for (const child of Object.values(value)) deepFreeze(child);
    Object.freeze(value);
  }
  return value;
}

function checkInvocation(invocationContext, now = Date.now) {
  if (invocationContext?.signal?.aborted) {
    const timeout = invocationContext.signal.reason?.abortSource === 'timeout'
      || invocationContext.signal.reason?.name === 'TimeoutError';
    const error = new Error(timeout ? 'Project context deadline elapsed.' : 'Project context cancelled.');
    error.code = timeout ? PROJECT_CONTEXT_ERROR_CODE.TIMEOUT : PROJECT_CONTEXT_ERROR_CODE.CANCELLED;
    throw error;
  }
  if (invocationContext?.deadlineAt !== undefined) {
    if (!Number.isFinite(invocationContext.deadlineAt)) {
      throw new TypeError('project-context-provider:invalid-deadlineAt');
    }
    if (now() >= invocationContext.deadlineAt) {
      const error = new Error('Project context deadline elapsed.');
      error.code = PROJECT_CONTEXT_ERROR_CODE.TIMEOUT;
      throw error;
    }
  }
}

async function resolveProjects(dependencies) {
  if (dependencies.projects) return dependencies.projects;
  try {
    const database = await import('../db/database.js');
    return database.projects;
  } catch (cause) {
    const error = new Error('Project context provider is not ready.', { cause });
    error.code = PROJECT_CONTEXT_ERROR_CODE.NOT_READY;
    throw error;
  }
}

async function resolveScope(scope, invocationContext, dependencies) {
  checkInvocation(invocationContext, dependencies.now);
  const projects = await resolveProjects(dependencies);
  const resolver = dependencies.resolveProjectContextScope ?? resolveProjectContextScope;
  const resolved = await resolver(scope, {
    projects,
    ...(dependencies.realpath ? { realpath: dependencies.realpath } : {}),
  });
  checkInvocation(invocationContext, dependencies.now);
  return resolved;
}

async function buildManifest(scope, invocationContext, dependencies) {
  const builder = dependencies.buildProjectContextManifest ?? buildProjectContextManifest;
  const manifest = await builder(scope, invocationContext, dependencies);
  checkInvocation(invocationContext, dependencies.now);
  return manifest;
}

function errorSnapshot(query, code, message, extra = {}) {
  const status = code === PROJECT_CONTEXT_ERROR_CODE.TIMEOUT
    ? PROJECT_CONTEXT_TERMINAL_STATUS.TIMEOUT
    : code === PROJECT_CONTEXT_ERROR_CODE.CANCELLED
      ? PROJECT_CONTEXT_TERMINAL_STATUS.CANCELLED
      : PROJECT_CONTEXT_TERMINAL_STATUS.ERROR;
  const snapshot = {
    contract: PROJECT_CONTEXT_KIND.SNAPSHOT,
    version: PROJECT_CONTEXT_CONTRACT_VERSION,
    requestId: query.requestId,
    projectId: query.projectId,
    status,
    error: { code, message, ...extra },
  };
  const validation = validateProjectContextSnapshot(snapshot);
  if (!validation.valid) {
    throw new TypeError(`project-context-provider:invalid-error-snapshot:${validation.errors.join(',')}`);
  }
  return deepFreeze(snapshot);
}

function staleSnapshot(query, observedRevision) {
  if (observedRevision === query.workspaceRevision) {
    return errorSnapshot(
      query,
      PROJECT_CONTEXT_ERROR_CODE.INTERNAL,
      'A transient project change could not be represented by a stable revision.',
    );
  }
  return errorSnapshot(
    query,
    PROJECT_CONTEXT_ERROR_CODE.STALE,
    'The project changed while context was being assembled.',
    {
      expectedRevision: query.workspaceRevision,
      observedRevision,
    },
  );
}

function countOccurrences(text, term) {
  let count = 0;
  let offset = 0;
  while (count < 100) {
    const found = text.indexOf(term, offset);
    if (found < 0) break;
    count += 1;
    offset = found + Math.max(1, term.length);
  }
  return count;
}

function buildCandidate(entry, content, terms, projectId, workspaceRevision) {
  const normalizedPath = entry.path.toLowerCase();
  const normalizedContent = content.toLowerCase();
  let score = 0;
  for (const term of terms) {
    if (normalizedPath.includes(term)) score += 1000;
    score += countOccurrences(normalizedContent, term) * 10;
  }
  if (score === 0) return null;

  const lines = content.split('\n');
  let firstMatch = 0;
  for (let index = 0; index < lines.length; index += 1) {
    const normalizedLine = lines[index].toLowerCase();
    if (terms.some(term => normalizedLine.includes(term))) {
      firstMatch = index;
      break;
    }
  }
  const startIndex = Math.max(0, firstMatch - CONTEXT_LINES_BEFORE);
  const endIndex = Math.min(lines.length, startIndex + MAX_SNIPPET_LINES);
  const snippet = lines.slice(startIndex, endIndex).join('\n');
  if (snippet.length === 0) return null;

  return {
    path: entry.path,
    startLine: startIndex + 1,
    endLine: Math.max(startIndex + 1, endIndex),
    content: snippet,
    contentDigest: entry.contentDigest,
    score,
    provenance: {
      sourceSet: PROJECT_CONTEXT_SOURCE_SET,
      projectId,
      workspaceRevision,
      path: entry.path,
      contentDigest: entry.contentDigest,
    },
  };
}

async function retrieveCandidates(scope, manifest, terms, invocationContext, dependencies) {
  const readFile = dependencies.readFile ?? defaultReadFile;
  const candidates = [];
  for (const entry of manifest.entries) {
    checkInvocation(invocationContext, dependencies.now);
    if (entry.kind !== 'regular@1') continue;
    let bytes;
    try {
      bytes = await readFile(path.join(scope.canonicalRoot, entry.path), {
        signal: invocationContext.signal,
      });
    } catch (cause) {
      checkInvocation(invocationContext, dependencies.now);
      const error = new Error('Project context file became unavailable during retrieval.', { cause });
      error.code = PROJECT_CONTEXT_ERROR_CODE.STALE;
      throw error;
    }
    checkInvocation(invocationContext, dependencies.now);
    const digest = `sha256:${createHash('sha256').update(bytes).digest('hex')}`;
    if (digest !== entry.contentDigest) {
      const error = new Error('Project context file changed after manifest observation.');
      error.code = PROJECT_CONTEXT_ERROR_CODE.STALE;
      throw error;
    }
    let content;
    try {
      content = utf8Decoder.decode(bytes);
    } catch {
      const error = new Error('Manifest regular-file classification changed during retrieval.');
      error.code = PROJECT_CONTEXT_ERROR_CODE.STALE;
      throw error;
    }
    const candidate = buildCandidate(
      entry,
      content,
      terms,
      scope.projectId,
      manifest.revision,
    );
    if (candidate) candidates.push(candidate);
  }
  candidates.sort((left, right) => (
    right.score - left.score
    || compareUtf8(left.path, right.path)
    || left.startLine - right.startLine
    || left.endLine - right.endLine
  ));
  return candidates;
}

function applyBudget(query, candidates) {
  const items = [];
  let usedBytes = 0;
  let truncationReason = null;
  for (const candidate of candidates) {
    if (items.length >= query.maxFiles) {
      truncationReason = 'maxFiles';
      break;
    }
    const candidateBytes = Buffer.byteLength(candidate.content, 'utf8');
    const nextBytes = usedBytes + candidateBytes;
    if (nextBytes > query.maxBytes) {
      truncationReason = 'maxBytes';
      break;
    }
    if (estimateProjectContextTokens(nextBytes) > query.maxTokens) {
      truncationReason = 'maxTokens';
      break;
    }
    items.push(candidate);
    usedBytes = nextBytes;
  }
  return {
    items,
    usedBytes,
    usedTokens: estimateProjectContextTokens(usedBytes),
    truncationReason,
  };
}

function successfulSnapshot(query, normalized, candidates) {
  const budgeted = applyBudget(query, candidates);
  if (candidates.length > 0 && budgeted.items.length === 0) {
    return errorSnapshot(
      query,
      PROJECT_CONTEXT_ERROR_CODE.BUDGET_EXHAUSTED,
      'The highest-ranked project context item does not fit the requested budget.',
    );
  }
  const snapshot = {
    contract: PROJECT_CONTEXT_KIND.SNAPSHOT,
    version: PROJECT_CONTEXT_CONTRACT_VERSION,
    requestId: query.requestId,
    projectId: query.projectId,
    status: PROJECT_CONTEXT_TERMINAL_STATUS.OK,
    outcome: budgeted.items.length > 0
      ? PROJECT_CONTEXT_OUTCOME.FOUND
      : PROJECT_CONTEXT_OUTCOME.EMPTY,
    workspaceRevision: query.workspaceRevision,
    normalizationVersion: PROJECT_CONTEXT_NORMALIZATION_VERSION,
    normalizedQuery: normalized.normalizedQuery,
    terms: [...normalized.terms],
    items: budgeted.items,
    budget: {
      maxFiles: query.maxFiles,
      maxBytes: query.maxBytes,
      maxTokens: query.maxTokens,
      usedFiles: budgeted.items.length,
      usedBytes: budgeted.usedBytes,
      usedTokens: budgeted.usedTokens,
    },
    truncation: budgeted.truncationReason
      ? { truncated: true, reason: budgeted.truncationReason }
      : { truncated: false },
    snapshotDigest: null,
  };
  snapshot.snapshotDigest = computeProjectContextSnapshotDigest(snapshot);
  const validation = validateProjectContextSnapshot(snapshot);
  if (!validation.valid) {
    throw new TypeError(`project-context-provider:invalid-success-snapshot:${validation.errors.join(',')}`);
  }
  return deepFreeze(snapshot);
}

function mapProviderError(query, error) {
  if (error instanceof ProjectContextScopeError) {
    return errorSnapshot(
      query,
      PROJECT_CONTEXT_ERROR_CODE.INVALID_SCOPE,
      'The requested project scope is not available.',
    );
  }
  const code = error instanceof ProjectContextManifestError ? error.code : error?.code;
  if (Object.values(PROJECT_CONTEXT_ERROR_CODE).includes(code) && code !== PROJECT_CONTEXT_ERROR_CODE.STALE) {
    return errorSnapshot(query, code, error.message || 'Project context could not be produced.');
  }
  return errorSnapshot(
    query,
    PROJECT_CONTEXT_ERROR_CODE.INTERNAL,
    'Project context could not be produced safely.',
  );
}

export async function observeWorkspaceRevision(
  scope,
  invocationContext = {},
  dependencies = {},
) {
  const resolved = await resolveScope(scope, invocationContext, dependencies);
  const manifest = await buildManifest(resolved, invocationContext, dependencies);
  return deepFreeze({
    projectId: resolved.projectId,
    canonicalRoot: resolved.canonicalRoot,
    workspaceRevision: manifest.revision,
  });
}

export async function queryProjectContext(
  query,
  invocationContext = {},
  dependencies = {},
) {
  const validation = validateProjectContextQuery(query);
  if (!validation.valid) {
    throw new TypeError(`project-context-provider:invalid-query:${validation.errors.join(',')}`);
  }
  const normalized = normalizeProjectContextQuery(query.queryText);
  try {
    const scope = await resolveScope({
      projectId: query.projectId,
      canonicalRoot: query.canonicalRoot,
    }, invocationContext, dependencies);
    const revisionBefore = await buildManifest(scope, invocationContext, dependencies);
    if (revisionBefore.revision !== query.workspaceRevision) {
      return staleSnapshot(query, revisionBefore.revision);
    }

    let candidates;
    try {
      candidates = await retrieveCandidates(
        scope,
        revisionBefore,
        normalized.terms,
        invocationContext,
        dependencies,
      );
    } catch (error) {
      if (error?.code !== PROJECT_CONTEXT_ERROR_CODE.STALE) throw error;
      const observed = await buildManifest(scope, invocationContext, dependencies);
      return staleSnapshot(query, observed.revision);
    }

    const revisionAfter = await buildManifest(scope, invocationContext, dependencies);
    if (
      revisionAfter.revision !== revisionBefore.revision
      || revisionAfter.revision !== query.workspaceRevision
    ) {
      return staleSnapshot(query, revisionAfter.revision);
    }
    checkInvocation(invocationContext, dependencies.now);
    return successfulSnapshot(query, normalized, candidates);
  } catch (error) {
    return mapProviderError(query, error);
  }
}

export const projectContextProvider = Object.freeze({
  observeWorkspaceRevision,
  queryProjectContext,
});

export default projectContextProvider;
