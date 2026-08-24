import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

import {
  M2_EFFECT_CONTRACT_KIND,
  computeEffectArgvDigest,
  computeEffectRequestDigest,
  validateEffectRequest,
} from '../../contracts/m2/effect-v1.js';
import {
  M2_EXECUTION_CONTRACT_KIND,
  computeM2ExecutionValueDigest,
  computeM2ProjectChangeAuthoritySetDigest,
  computeM2ProjectChangePatchSetDigest,
  validateM2ProjectChangeRequest,
} from '../../contracts/m2/execution-v1.js';
import { observeWorkspaceRevision } from '../code-intel/project-context-provider.js';
import { readProjectFileBytes } from '../executor/project-path-authority.js';

const fatalUtf8 = new TextDecoder('utf-8', { fatal: true });

export const ProjectChangePlanningErrorCode = Object.freeze({
  INPUT_INVALID: 'PROJECT_CHANGE_INPUT_INVALID',
  CONTEXT_STALE: 'PROJECT_CHANGE_CONTEXT_STALE',
  TARGET_DIRTY: 'PROJECT_CHANGE_TARGET_DIRTY',
  TARGET_HARDLINKED: 'PROJECT_CHANGE_TARGET_HARDLINKED',
  TARGET_NOT_UTF8: 'PROJECT_CHANGE_TARGET_NOT_UTF8',
  PARENT_UNAVAILABLE: 'PROJECT_CHANGE_PARENT_UNAVAILABLE',
  NESTED_REPOSITORY: 'PROJECT_CHANGE_NESTED_REPOSITORY',
  CONTRACT_INVALID: 'PROJECT_CHANGE_CONTRACT_INVALID',
});

export class ProjectChangePlanningError extends Error {
  constructor(code, message, details = null) {
    super(message);
    this.name = 'ProjectChangePlanningError';
    this.code = code;
    this.details = details;
  }
}

function fail(code, message, details = null) {
  throw new ProjectChangePlanningError(code, message, details);
}

function digestBytes(bytes) {
  return `sha256:${createHash('sha256').update(bytes).digest('hex')}`;
}

function effectId(executionId, role, relativePath = '') {
  const digest = createHash('sha256')
    .update(JSON.stringify({ executionId, role, relativePath }), 'utf8')
    .digest('hex');
  return `effect:${digest}`;
}

function idempotencyKey(executionId, role, relativePath = '') {
  const digest = createHash('sha256')
    .update(JSON.stringify({ executionId, role, relativePath }), 'utf8')
    .digest('hex');
  return `exec:${digest}`;
}

function compareUtf8(left, right) {
  return Buffer.compare(Buffer.from(left, 'utf8'), Buffer.from(right, 'utf8'));
}

function canonicalTimestamp(value) {
  const millis = typeof value === 'number' ? value : Date.parse(value);
  if (!Number.isFinite(millis)) fail(ProjectChangePlanningErrorCode.INPUT_INVALID, 'createdAt is invalid');
  const timestamp = new Date(millis).toISOString();
  if (typeof value === 'string' && timestamp !== value) {
    fail(ProjectChangePlanningErrorCode.INPUT_INVALID, 'createdAt is not canonical');
  }
  return timestamp;
}

function requireGitBaseline(value, projectId, canonicalRoot) {
  const valid = value
    && typeof value === 'object'
    && (typeof value.head === 'string' && /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/.test(value.head))
    && (typeof value.branchRef === 'string' && value.branchRef.startsWith('refs/heads/'))
    && /^sha256:[0-9a-f]{64}$/.test(value.foreignDirtDigest)
    && Array.isArray(value.targetDirtyPaths)
    && value.projectId === projectId
    && value.canonicalRoot === canonicalRoot;
  if (!valid) fail(ProjectChangePlanningErrorCode.INPUT_INVALID, 'An exact attached Git baseline is required');
  return value;
}

function assertNoNestedRepository(canonicalRoot, relativePath, fileSystem) {
  let directory = path.dirname(path.join(canonicalRoot, relativePath));
  while (directory !== canonicalRoot) {
    if (fileSystem.existsSync(path.join(directory, '.git'))) {
      fail(
        ProjectChangePlanningErrorCode.NESTED_REPOSITORY,
        'A change target is inside a nested Git repository',
        { relativePath, directory },
      );
    }
    const parent = path.dirname(directory);
    if (parent === directory || !directory.startsWith(`${canonicalRoot}${path.sep}`)) {
      fail(ProjectChangePlanningErrorCode.INPUT_INVALID, 'Target ancestry left the project root');
    }
    directory = parent;
  }
}

function makeEffect({
  effectId: id,
  executionId,
  runId,
  actor,
  origin,
  kind,
  target,
  payloadBytes,
  workspaceRevision,
  role,
  riskClass,
  requiredCapability,
  timeoutMs,
  createdAt,
}) {
  const request = {
    contract: M2_EFFECT_CONTRACT_KIND.EFFECT_REQUEST,
    version: 1,
    effectId: id,
    runId,
    parentEffectId: null,
    actor,
    origin,
    kind,
    target,
    payloadDigest: digestBytes(payloadBytes),
    payloadBytes: payloadBytes.length,
    workspaceRevision,
    requiredCapability,
    riskClass,
    timeoutMs,
    idempotencyKey: idempotencyKey(executionId, role, target.relativePath ?? ''),
    approvalGrantId: null,
    createdAt,
  };
  const validation = validateEffectRequest(request);
  if (!validation.valid) {
    fail(ProjectChangePlanningErrorCode.CONTRACT_INVALID, 'A child effect is invalid', {
      role,
      errors: [...validation.errors],
    });
  }
  return request;
}

/**
 * Prepare the complete immutable project-change request and every child effect
 * before any approval is issued or any file is modified.
 */
export async function planProjectChange({
  executionId,
  runId,
  actor,
  origin,
  projectContext,
  gitBaseline: gitBaselineValue,
  changes: changeInputs,
  focusedTest: focusedInput,
  gitCommit: gitInput = null,
  createdAt = Date.now(),
}, {
  fileSystem = fs,
  observeRevision = (scope) => observeWorkspaceRevision(scope),
} = {}) {
  if (!projectContext || typeof projectContext !== 'object'
    || !Array.isArray(changeInputs) || changeInputs.length === 0
    || !focusedInput || typeof focusedInput !== 'object') {
    fail(ProjectChangePlanningErrorCode.INPUT_INVALID, 'Project context, changes, and one focused test are required');
  }
  const canonicalRoot = fileSystem.realpathSync(projectContext.canonicalRoot);
  if (canonicalRoot !== projectContext.canonicalRoot) {
    fail(ProjectChangePlanningErrorCode.INPUT_INVALID, 'Project root must already be canonical');
  }
  const baseline = requireGitBaseline(gitBaselineValue, projectContext.projectId, canonicalRoot);
  const declaredPaths = changeInputs.map(change => change?.path);
  if (new Set(declaredPaths).size !== declaredPaths.length
    || declaredPaths.some(value => typeof value !== 'string')) {
    fail(ProjectChangePlanningErrorCode.INPUT_INVALID, 'Change paths must be unique strings');
  }
  const dirtyTargets = baseline.targetDirtyPaths.filter(candidate => declaredPaths.includes(candidate));
  if (dirtyTargets.length > 0) {
    fail(ProjectChangePlanningErrorCode.TARGET_DIRTY, 'A target path was dirty before execution', {
      paths: dirtyTargets,
    });
  }
  const firstObservation = await observeRevision({
    projectId: projectContext.projectId,
    canonicalRoot,
  });
  if (firstObservation.workspaceRevision !== projectContext.workspaceRevision) {
    fail(ProjectChangePlanningErrorCode.CONTEXT_STALE, 'Project context is stale before planning');
  }

  const created = canonicalTimestamp(createdAt);
  const sortedInputs = [...changeInputs].sort((left, right) => compareUtf8(left.path, right.path));
  const effectRequests = [];
  const files = [];
  const changes = [];

  for (const input of sortedInputs) {
    if (typeof input.afterContent !== 'string') {
      fail(ProjectChangePlanningErrorCode.INPUT_INVALID, 'afterContent must be a UTF-8 string', { path: input.path });
    }
    assertNoNestedRepository(canonicalRoot, input.path, fileSystem);
    const parent = path.dirname(path.join(canonicalRoot, input.path));
    let parentStat;
    try { parentStat = fileSystem.statSync(parent); } catch { /* handled below */ }
    if (!parentStat?.isDirectory()) {
      fail(ProjectChangePlanningErrorCode.PARENT_UNAVAILABLE, 'Target parent directory must already exist', {
        path: input.path,
      });
    }
    const before = readProjectFileBytes(canonicalRoot, input.path, { fileSystem });
    if (before.exists && before.linkCount !== 1) {
      fail(ProjectChangePlanningErrorCode.TARGET_HARDLINKED, 'Hardlinked targets are unavailable', {
        path: input.path,
        linkCount: before.linkCount,
      });
    }
    if (before.exists) {
      try { fatalUtf8.decode(before.bytes); } catch {
        fail(ProjectChangePlanningErrorCode.TARGET_NOT_UTF8, 'Existing target is not valid UTF-8', {
          path: input.path,
        });
      }
    }
    const afterBytes = Buffer.from(input.afterContent, 'utf8');
    const forwardId = effectId(executionId, 'forward', input.path);
    const rollbackId = effectId(executionId, 'rollback', input.path);
    const filesystemTarget = {
      type: 'filesystem',
      canonicalRoot,
      relativePath: input.path,
      resolvedRealpath: before.target.real,
    };
    const forward = makeEffect({
      effectId: forwardId,
      executionId,
      runId,
      actor,
      origin,
      kind: 'fs.write',
      target: filesystemTarget,
      payloadBytes: afterBytes,
      workspaceRevision: projectContext.workspaceRevision,
      role: 'forward',
      riskClass: 'write',
      requiredCapability: 'project.fs.write',
      timeoutMs: 120_000,
      createdAt: created,
    });
    const rollbackKind = before.exists ? 'fs.write' : 'fs.delete';
    const rollback = makeEffect({
      effectId: rollbackId,
      executionId,
      runId,
      actor,
      origin,
      kind: rollbackKind,
      target: filesystemTarget,
      payloadBytes: before.bytes,
      workspaceRevision: projectContext.workspaceRevision,
      role: 'rollback',
      riskClass: before.exists ? 'write' : 'destructive',
      requiredCapability: before.exists ? 'project.fs.write' : 'project.fs.delete',
      timeoutMs: 120_000,
      createdAt: created,
    });
    effectRequests.push(forward, rollback);
    files.push({ path: input.path, beforeBytes: before.bytes, afterBytes });
    changes.push({
      path: input.path,
      before: {
        exists: before.exists,
        digest: before.exists ? digestBytes(before.bytes) : null,
        bytes: before.bytes.length,
        mode: before.mode,
      },
      after: {
        digest: digestBytes(afterBytes),
        bytes: afterBytes.length,
        mode: before.exists ? before.mode : (input.mode ?? 0o644),
      },
      forwardAuthority: {
        effectId: forward.effectId,
        requestDigest: computeEffectRequestDigest(forward),
      },
      rollbackAuthority: {
        effectId: rollback.effectId,
        requestDigest: computeEffectRequestDigest(rollback),
      },
    });
  }

  const focusedPayload = Buffer.from(JSON.stringify({
    binary: focusedInput.binary,
    argv: focusedInput.argv,
    environment: focusedInput.environment,
  }), 'utf8');
  const focused = makeEffect({
    effectId: effectId(executionId, 'focused-test'),
    executionId,
    runId,
    actor,
    origin,
    kind: 'process.exec',
    target: {
      type: 'process',
      binary: focusedInput.binary,
      argv: focusedInput.argv,
      argvDigest: computeEffectArgvDigest(focusedInput.argv),
      canonicalCwd: canonicalRoot,
    },
    payloadBytes: focusedPayload,
    workspaceRevision: projectContext.workspaceRevision,
    role: 'focused-test',
    riskClass: 'exec',
    requiredCapability: 'project.process.exec',
    timeoutMs: focusedInput.timeoutMs,
    createdAt: created,
  });
  effectRequests.push(focused);

  let gitEffect = null;
  let gitMaterial = null;
  if (gitInput !== null) {
    gitMaterial = { message: gitInput.message, identity: gitInput.identity };
    const gitPayload = Buffer.from(JSON.stringify(gitMaterial), 'utf8');
    gitEffect = makeEffect({
      effectId: effectId(executionId, 'git-commit'),
      executionId,
      runId,
      actor,
      origin,
      kind: 'git.commit',
      target: {
        type: 'git',
        canonicalRepo: canonicalRoot,
        paths: changes.map(change => change.path),
        expectedWorkspaceRevision: projectContext.workspaceRevision,
        remote: null,
      },
      payloadBytes: gitPayload,
      workspaceRevision: projectContext.workspaceRevision,
      role: 'git-commit',
      riskClass: 'write',
      requiredCapability: 'project.git.commit',
      timeoutMs: 120_000,
      createdAt: created,
    });
    effectRequests.push(gitEffect);
  }

  const request = {
    contract: M2_EXECUTION_CONTRACT_KIND.REQUEST,
    version: 1,
    executionId,
    runId,
    actor,
    origin,
    project: {
      projectId: projectContext.projectId,
      canonicalRoot,
      workspaceRevision: projectContext.workspaceRevision,
      gitHead: baseline.head,
      gitBranchRef: baseline.branchRef,
      foreignDirtDigest: baseline.foreignDirtDigest,
    },
    patchSetDigest: computeM2ProjectChangePatchSetDigest(changes),
    changes,
    focusedTest: {
      authority: {
        effectId: focused.effectId,
        requestDigest: computeEffectRequestDigest(focused),
      },
      binary: focusedInput.binary,
      argv: focusedInput.argv,
      argvDigest: computeM2ExecutionValueDigest(focusedInput.argv),
      canonicalCwd: canonicalRoot,
      environmentDigest: computeM2ExecutionValueDigest(focusedInput.environment),
      timeoutMs: focusedInput.timeoutMs,
      expectedExitCode: 0,
      sandboxProfile: 'linux-bwrap-ro-v1',
    },
    gitCommit: gitEffect === null ? null : {
      authority: {
        effectId: gitEffect.effectId,
        requestDigest: computeEffectRequestDigest(gitEffect),
      },
      expectedHead: baseline.head,
      branchRef: baseline.branchRef,
      paths: changes.map(change => change.path),
      messageDigest: computeM2ExecutionValueDigest(gitInput.message),
      identityDigest: computeM2ExecutionValueDigest(gitInput.identity),
    },
    authoritySetDigest: null,
    createdAt: created,
  };
  request.authoritySetDigest = computeM2ProjectChangeAuthoritySetDigest(request);
  const validation = validateM2ProjectChangeRequest(request);
  if (!validation.valid) {
    fail(ProjectChangePlanningErrorCode.CONTRACT_INVALID, 'ProjectChangeRequest is invalid', {
      errors: [...validation.errors],
    });
  }
  const finalObservation = await observeRevision({
    projectId: projectContext.projectId,
    canonicalRoot,
  });
  if (finalObservation.workspaceRevision !== projectContext.workspaceRevision) {
    fail(ProjectChangePlanningErrorCode.CONTEXT_STALE, 'Project changed while planning');
  }

  return Object.freeze({
    request: Object.freeze(request),
    effectRequests: Object.freeze(effectRequests.map(item => Object.freeze(item))),
    files: Object.freeze(files.map(item => Object.freeze(item))),
    focusedEnvironment: Object.freeze({ ...focusedInput.environment }),
    git: gitMaterial === null ? null : Object.freeze(gitMaterial),
  });
}

export default planProjectChange;
