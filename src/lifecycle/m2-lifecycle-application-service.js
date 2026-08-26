import { createHash, randomUUID } from 'node:crypto';
import {
  lstat as defaultLstat,
  readdir as defaultReaddir,
  realpath as defaultRealpath,
} from 'node:fs/promises';
import path from 'node:path';

import {
  PROJECT_CONTEXT_KIND,
  PROJECT_CONTEXT_TERMINAL_STATUS,
} from '../../contracts/m2/project-context-v1.js';
import {
  M2_GOVERNANCE_CONTRACT_KIND,
  M2_GOVERNANCE_CONTRACT_VERSION,
  M2_GOVERNANCE_REQUIRED_CHECKS,
  M2_GOVERNANCE_VERDICT,
  computeM2GovernanceBaselineDigest,
  computeM2GovernancePolicySnapshotDigest,
  computeM2GovernanceDecisionDigest,
  computeM2GovernanceReceiptDigest,
  validateM2GovernancePolicySnapshot,
} from '../../contracts/m2/governance-v1.js';
import {
  M2_LIFECYCLE_CONTRACT_KIND,
  M2_LIFECYCLE_CONTRACT_VERSION,
  M2_LIFECYCLE_STATE,
  computeM2LifecycleApprovalIntentDigest,
  computeM2LifecyclePlanSnapshotDigest,
  computeM2LifecycleValueDigest,
  validateM2LifecycleApprovalIntentForPlan,
  validateM2LifecyclePlanSnapshotForContext,
  validateM2LifecyclePlanSnapshotForDecision,
  validateM2LifecycleTerminalSnapshot,
  validateM2LifecycleTerminalSnapshotForExecution,
} from '../../contracts/m2/lifecycle-v1.js';
import {
  computeM2ExecutionValueDigest,
  computeM2ProjectChangeRequestDigest,
} from '../../contracts/m2/execution-v1.js';
import {
  PROJECT_CONTEXT_FILE_POLICY,
  buildProjectContextManifest,
  computeProjectContextWorkspaceRevision,
} from '../code-intel/project-context-manifest.js';
import {
  observeWorkspaceRevision,
  queryProjectContext,
} from '../code-intel/project-context-provider.js';
import { createApprovalGrantIssuer } from '../effects/approval-grant-issuer.js';
import { EffectAuthorityRepository } from '../effects/effect-authority-repository.js';
import {
  processExecutionLiveness,
  processExecutionOwner,
} from '../effects/execution-owner.js';
import { ExecutionAuthorityRepository } from '../execution/execution-authority-repository.js';
import {
  exactGitProvider,
  observeExactGitBaseline,
} from '../execution/exact-git-provider.js';
import { planProjectChange } from '../execution/project-change-planner.js';
import { executeProjectChange } from '../execution/project-change-runtime.js';
import { processSandboxProvider } from '../execution/process-sandbox-provider.js';
import { readProjectFileBytes } from '../executor/project-path-authority.js';
import {
  createM2GovernanceReceipt,
  evaluateM2Governance,
} from './m2-governance-evaluator.js';
import { M2LifecycleAuthorityRepository } from './m2-lifecycle-authority-repository.js';
import { compileM2ProjectChangeProposal } from './m2-proposal-compiler.js';

const POLICY_PATH = '.c3/m2-governance-policy.json';
const DEFAULT_APPROVAL_WINDOW_MS = 60 * 60 * 1000;
const MAX_CONTEXT_FILES = 24;
const MAX_CONTEXT_BYTES = 256 * 1024;
const MAX_CONTEXT_TOKENS = 64 * 1024;
const IDENTIFIER_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;

export const M2LifecycleServiceErrorCode = Object.freeze({
  INPUT_INVALID: 'M2_LIFECYCLE_INPUT_INVALID',
  AUTH_REQUIRED: 'M2_LIFECYCLE_AUTH_REQUIRED',
  OWNER_MISMATCH: 'M2_LIFECYCLE_OWNER_MISMATCH',
  ORIGIN_MISMATCH: 'M2_LIFECYCLE_ORIGIN_MISMATCH',
  PROJECT_UNAVAILABLE: 'M2_LIFECYCLE_PROJECT_UNAVAILABLE',
  CONTEXT_UNAVAILABLE: 'M2_LIFECYCLE_CONTEXT_UNAVAILABLE',
  CONTEXT_STALE: 'M2_LIFECYCLE_CONTEXT_STALE',
  POLICY_UNAVAILABLE: 'M2_LIFECYCLE_POLICY_UNAVAILABLE',
  GOVERNANCE_DENIED: 'M2_LIFECYCLE_GOVERNANCE_DENIED',
  PLAN_NOT_FOUND: 'M2_LIFECYCLE_PLAN_NOT_FOUND',
  PLAN_DIGEST_MISMATCH: 'M2_LIFECYCLE_PLAN_DIGEST_MISMATCH',
  PLAN_EXPIRED: 'M2_LIFECYCLE_PLAN_EXPIRED',
  ALREADY_TERMINAL: 'M2_LIFECYCLE_ALREADY_TERMINAL',
  CANCELLED: 'M2_LIFECYCLE_CANCELLED',
  LATE_SUCCESS_AFTER_CANCEL: 'M2_LIFECYCLE_LATE_SUCCESS_AFTER_CANCEL',
  RESULT_REVISION_MISMATCH: 'M2_LIFECYCLE_RESULT_REVISION_MISMATCH',
  RECOVERY_INCOMPLETE: 'M2_LIFECYCLE_RECOVERY_INCOMPLETE',
  STORAGE_FAILURE: 'M2_LIFECYCLE_STORAGE_FAILURE',
});

export class M2LifecycleServiceError extends Error {
  constructor(code, message, details = null) {
    super(message);
    this.name = 'M2LifecycleServiceError';
    this.code = code;
    this.details = details;
  }
}

function fail(code, message, details = null) {
  throw new M2LifecycleServiceError(code, message, details);
}

function compareUtf8(left, right) {
  return Buffer.compare(Buffer.from(left, 'utf8'), Buffer.from(right, 'utf8'));
}

function canonicalTimestamp(value) {
  if (!Number.isSafeInteger(value) || value < 0) {
    fail(M2LifecycleServiceErrorCode.INPUT_INVALID, 'Trusted clock returned an invalid timestamp');
  }
  return new Date(value).toISOString();
}

function requireIdentifier(value, label) {
  if (typeof value !== 'string' || !IDENTIFIER_PATTERN.test(value)) {
    fail(M2LifecycleServiceErrorCode.INPUT_INVALID, `${label} is invalid`);
  }
  return value;
}

function requireSubject(subject) {
  if (
    subject?.actorType !== 'user'
    || typeof subject.actorId !== 'string'
    || !IDENTIFIER_PATTERN.test(subject.actorId)
  ) fail(M2LifecycleServiceErrorCode.AUTH_REQUIRED, 'An authenticated user subject is required');
  return Object.freeze({ type: 'user', id: subject.actorId });
}

function normalizeOrigin(origin, projectId) {
  if (!origin || typeof origin !== 'object') {
    fail(M2LifecycleServiceErrorCode.INPUT_INVALID, 'A project-bound transport origin is required');
  }
  const normalized = {
    surface: origin.surface,
    sessionId: origin.sessionId ?? null,
    conversationId: origin.conversationId ?? null,
    projectId,
  };
  if (!['http', 'ws', 'studio'].includes(normalized.surface)) {
    fail(M2LifecycleServiceErrorCode.INPUT_INVALID, 'Transport surface is invalid');
  }
  for (const key of ['sessionId', 'conversationId']) {
    if (!(normalized[key] === null || (
      typeof normalized[key] === 'string' && IDENTIFIER_PATTERN.test(normalized[key])
    ))) fail(M2LifecycleServiceErrorCode.INPUT_INVALID, `${key} is invalid`);
  }
  if (origin.projectId !== undefined && origin.projectId !== projectId) {
    fail(M2LifecycleServiceErrorCode.ORIGIN_MISMATCH, 'Transport project binding does not match');
  }
  return Object.freeze(normalized);
}

function sameOrigin(left, right) {
  return left?.surface === right?.surface
    && left?.sessionId === right?.sessionId
    && left?.conversationId === right?.conversationId
    && left?.projectId === right?.projectId;
}

function sha256(bytes) {
  return `sha256:${createHash('sha256').update(bytes).digest('hex')}`;
}

function parsePolicyDefinition(bytes) {
  const text = bytes.toString('utf8');
  if (!Buffer.from(text, 'utf8').equals(bytes)) {
    fail(M2LifecycleServiceErrorCode.POLICY_UNAVAILABLE, 'Governance policy is not UTF-8');
  }
  let value;
  try { value = JSON.parse(text); } catch {
    fail(M2LifecycleServiceErrorCode.POLICY_UNAVAILABLE, 'Governance policy is not valid JSON');
  }
  const expected = [
    'externalImports', 'layers', 'policyId', 'requiredChecks', 'rules',
    'sourceExtensions', 'unmappedFilePolicy',
  ].sort();
  if (!value || typeof value !== 'object' || Array.isArray(value)
    || Object.keys(value).sort().join('\0') !== expected.join('\0')) {
    fail(M2LifecycleServiceErrorCode.POLICY_UNAVAILABLE, 'Governance policy has non-exact keys');
  }
  return value;
}

function loadPolicySnapshot(projectId, canonicalRoot, workspaceRevision, readFile) {
  let observation;
  try { observation = readFile(canonicalRoot, POLICY_PATH); } catch (error) {
    fail(M2LifecycleServiceErrorCode.POLICY_UNAVAILABLE, 'Governance policy is unavailable', {
      cause: error?.code || error?.message || String(error),
    });
  }
  if (!observation?.exists || !Buffer.isBuffer(observation.bytes)) {
    fail(M2LifecycleServiceErrorCode.POLICY_UNAVAILABLE, 'Governance policy is missing');
  }
  const definition = parsePolicyDefinition(observation.bytes);
  const snapshot = Object.freeze({
    contract: M2_GOVERNANCE_CONTRACT_KIND.POLICY_SNAPSHOT,
    version: M2_GOVERNANCE_CONTRACT_VERSION,
    policyId: definition.policyId,
    projectId,
    workspaceRevision,
    policyPath: POLICY_PATH,
    layers: definition.layers,
    rules: definition.rules,
    externalImports: definition.externalImports,
    sourceExtensions: definition.sourceExtensions,
    requiredChecks: definition.requiredChecks,
    unmappedFilePolicy: definition.unmappedFilePolicy,
  });
  const validation = validateM2GovernancePolicySnapshot(snapshot);
  if (!validation.valid) {
    fail(M2LifecycleServiceErrorCode.POLICY_UNAVAILABLE, 'Governance policy is invalid', {
      errors: [...validation.errors],
    });
  }
  if (computeM2ExecutionValueDigest(snapshot.requiredChecks)
    !== computeM2ExecutionValueDigest(M2_GOVERNANCE_REQUIRED_CHECKS)) {
    fail(M2LifecycleServiceErrorCode.POLICY_UNAVAILABLE, 'Required governance checks differ from v1');
  }
  return snapshot;
}

async function buildGovernanceBaseline(
  policySnapshot,
  canonicalRoot,
  readFile,
  {
    lstat = defaultLstat,
    readdir = defaultReaddir,
    realpath = defaultRealpath,
    maxFiles = 10_000,
    maxBytes = 8 * 1024 * 1024,
  } = {},
) {
  const filesByPath = new Map();
  const roots = [...new Set(policySnapshot.layers.flatMap(layer => layer.roots))]
    .sort(compareUtf8);
  let complete = true;
  let observedBytes = 0;
  let observedEntries = 0;

  async function walk(relativeDirectory, depth) {
    if (!complete) return;
    if (depth > 64 || ++observedEntries > maxFiles) {
      complete = false;
      return;
    }
    const absoluteDirectory = path.join(canonicalRoot, relativeDirectory);
    try {
      const [resolved, stat] = await Promise.all([
        realpath(absoluteDirectory),
        lstat(absoluteDirectory),
      ]);
      if (resolved !== absoluteDirectory || !stat.isDirectory() || stat.isSymbolicLink()) {
        complete = false;
        return;
      }
      const entries = await readdir(absoluteDirectory, { withFileTypes: true });
      entries.sort((left, right) => compareUtf8(left.name, right.name));
      for (const entry of entries) {
        if (!complete || ++observedEntries > maxFiles) {
          complete = false;
          return;
        }
        const relativePath = path.posix.join(relativeDirectory, entry.name);
        if (entry.isSymbolicLink()) {
          complete = false;
        } else if (entry.isDirectory()) {
          await walk(relativePath, depth + 1);
        } else if (entry.isFile()) {
          const observation = readFile(canonicalRoot, relativePath);
          if (!observation.exists || observation.linkCount !== 1) {
            complete = false;
            continue;
          }
          observedBytes += observation.bytes.length;
          if (observedBytes > maxBytes) {
            complete = false;
            return;
          }
          filesByPath.set(relativePath, Object.freeze({
            path: relativePath,
            contentBase64: observation.bytes.toString('base64'),
            digest: sha256(observation.bytes),
            bytes: observation.bytes.length,
          }));
        } else {
          complete = false;
        }
      }
    } catch {
      complete = false;
    }
  }

  for (const root of roots) await walk(root, 0);
  const files = [...filesByPath.values()];
  files.sort((left, right) => compareUtf8(left.path, right.path));
  return Object.freeze({
    projectId: policySnapshot.projectId,
    workspaceRevision: policySnapshot.workspaceRevision,
    complete,
    files: Object.freeze(files),
  });
}

function isManifestObservablePath(relativePath) {
  const segments = relativePath.split('/');
  if (segments.slice(0, -1).some(segment => (
    PROJECT_CONTEXT_FILE_POLICY.ignoredDirectories.includes(segment)
  ))) return false;
  const basename = path.posix.basename(relativePath);
  return PROJECT_CONTEXT_FILE_POLICY.includedBasenames.includes(basename)
    || PROJECT_CONTEXT_FILE_POLICY.includedExtensions.includes(
      path.posix.extname(basename).toLowerCase(),
    );
}

function computeExpectedAfterRevision(manifest, request, material) {
  const entries = new Map(manifest.entries.map(entry => [entry.path, { ...entry }]));
  for (let ordinal = 0; ordinal < material.length; ordinal += 1) {
    const file = material[ordinal];
    if (!isManifestObservablePath(file.path)) continue;
    const change = request.changes[ordinal];
    entries.set(file.path, {
      path: file.path,
      kind: 'regular@1',
      size: change.after.bytes,
      contentDigest: change.after.digest,
    });
  }
  const sorted = [...entries.values()].sort((left, right) => compareUtf8(left.path, right.path));
  return computeProjectContextWorkspaceRevision(request.project.projectId, sorted);
}

function candidateFiles(material) {
  return Object.freeze(material.map(file => Object.freeze({
    path: file.path,
    contentBase64: file.afterBytes.toString('base64'),
  })));
}

function lifecycleIdentity(idFactory) {
  return Object.freeze({
    lifecycleId: requireIdentifier(idFactory('lifecycle'), 'lifecycleId'),
    milestoneId: requireIdentifier(idFactory('milestone'), 'milestoneId'),
    runId: requireIdentifier(idFactory('run'), 'runId'),
    executionId: requireIdentifier(idFactory('execution'), 'executionId'),
  });
}

function defaultIdFactory(kind) {
  return `${kind}:${randomUUID()}`;
}

function buildPlan({ identity, actor, origin, compiled, request, contextSnapshot, decision, createdAt, expiresAt }) {
  return Object.freeze({
    contract: M2_LIFECYCLE_CONTRACT_KIND.PLAN_SNAPSHOT,
    version: M2_LIFECYCLE_CONTRACT_VERSION,
    identity,
    state: M2_LIFECYCLE_STATE.AWAITING_APPROVAL,
    planVersion: 1,
    actor,
    origin,
    project: request.project,
    intent: compiled.intent,
    requestDigest: computeM2ProjectChangeRequestDigest(request),
    patchSetDigest: request.patchSetDigest,
    authoritySetDigest: request.authoritySetDigest,
    changes: request.changes.map(change => Object.freeze({
      path: change.path,
      afterDigest: change.after.digest,
      afterBytes: change.after.bytes,
    })),
    focusedTest: Object.freeze({
      binary: request.focusedTest.binary,
      argv: request.focusedTest.argv,
      argvDigest: request.focusedTest.argvDigest,
      environmentDigest: request.focusedTest.environmentDigest,
      timeoutMs: request.focusedTest.timeoutMs,
    }),
    gitCommit: request.gitCommit === null ? null : Object.freeze({
      expectedHead: request.gitCommit.expectedHead,
      branchRef: request.gitCommit.branchRef,
      paths: request.gitCommit.paths,
      messageDigest: request.gitCommit.messageDigest,
      identityDigest: request.gitCommit.identityDigest,
    }),
    governancePolicyDigest: decision.policyDigest,
    governanceBaselineDigest: decision.baselineDigest,
    contextSnapshotDigest: computeM2LifecycleValueDigest(contextSnapshot),
    governanceDecisionDigest: computeM2GovernanceDecisionDigest(decision),
    expectedAfterRevision: decision.expectedAfterRevision,
    createdAt,
    approvalExpiresAt: expiresAt,
  });
}

function buildApproval(plan, authenticatedSubject, now, idFactory) {
  const approvedAt = canonicalTimestamp(now);
  const approval = Object.freeze({
    contract: M2_LIFECYCLE_CONTRACT_KIND.APPROVAL_INTENT,
    version: M2_LIFECYCLE_CONTRACT_VERSION,
    approvalId: requireIdentifier(idFactory('approval'), 'approvalId'),
    identity: plan.identity,
    state: M2_LIFECYCLE_STATE.AWAITING_APPROVAL,
    decision: 'approve',
    planVersion: plan.planVersion,
    planDigest: computeM2LifecyclePlanSnapshotDigest(plan),
    requestDigest: plan.requestDigest,
    authoritySetDigest: plan.authoritySetDigest,
    projectId: plan.project.projectId,
    workspaceRevision: plan.project.workspaceRevision,
    actor: { type: 'user', id: authenticatedSubject.actorId },
    approvedAt,
    expiresAt: plan.approvalExpiresAt,
  });
  const validation = validateM2LifecycleApprovalIntentForPlan(plan, approval);
  if (!validation.valid) {
    fail(M2LifecycleServiceErrorCode.INPUT_INVALID, 'Approval intent is invalid', {
      errors: [...validation.errors],
    });
  }
  return approval;
}

function resultState(result) {
  const mapping = {
    succeeded: M2_LIFECYCLE_STATE.SUCCEEDED,
    failed: M2_LIFECYCLE_STATE.FAILED,
    cancelled: M2_LIFECYCLE_STATE.CANCELLED,
    timed_out: M2_LIFECYCLE_STATE.TIMED_OUT,
    orphaned: M2_LIFECYCLE_STATE.ORPHANED,
  };
  return mapping[result?.terminalStatus] ?? M2_LIFECYCLE_STATE.ORPHANED;
}

function sortedEvidence(values) {
  return [...new Set(values.filter(value => typeof value === 'string'))].sort(compareUtf8);
}

function buildNonSuccessTerminal({ plan, approval, result, state, errorCode, workspaceRevision, completedAt }) {
  const terminal = Object.freeze({
    contract: M2_LIFECYCLE_CONTRACT_KIND.TERMINAL_SNAPSHOT,
    version: M2_LIFECYCLE_CONTRACT_VERSION,
    identity: plan.identity,
    state,
    planVersion: plan.planVersion,
    planDigest: computeM2LifecyclePlanSnapshotDigest(plan),
    approvalIntentDigest: approval ? computeM2LifecycleApprovalIntentDigest(approval) : null,
    requestDigest: plan.requestDigest,
    authoritySetDigest: plan.authoritySetDigest,
    projectId: plan.project.projectId,
    workspaceRevision,
    resultDigest: result ? computeM2ExecutionValueDigest(result) : null,
    governanceDecisionDigest: plan.governanceDecisionDigest,
    governanceReceiptDigest: null,
    errorCode,
    completedAt,
    evidenceRefs: sortedEvidence([
      ...(result?.evidenceRefs ?? []),
      `lifecycle:${plan.identity.lifecycleId}:${state}`,
    ]),
  });
  const validation = validateM2LifecycleTerminalSnapshot(terminal);
  if (!validation.valid) {
    fail(M2LifecycleServiceErrorCode.STORAGE_FAILURE, 'Lifecycle terminal is invalid', {
      errors: [...validation.errors],
    });
  }
  return terminal;
}

function viewFromMaterial(plan, material) {
  return Object.freeze(material.map((file, index) => Object.freeze({
    path: file.path,
    before: Object.freeze({
      exists: Boolean(file.beforeExists),
      digest: file.beforeDigest,
      bytes: file.beforeBytes.length,
      content: file.beforeExists ? file.beforeBytes.toString('utf8') : null,
    }),
    after: Object.freeze({
      digest: plan.changes[index].afterDigest,
      bytes: file.afterBytes.length,
      content: file.afterBytes.toString('utf8'),
    }),
  })));
}

function requireDependencies(value) {
  const requiredMethods = [
    ['projects.findById.get', value.projects?.findById?.get],
    ['lifecycleRepository.registerOperation', value.lifecycleRepository?.registerOperation],
    ['executionRepository.registerProjectChange', value.executionRepository?.registerProjectChange],
    ['effectRepository.registerEffectRequest', value.effectRepository?.registerEffectRequest],
    ['approvalGrantIssuer.issue', value.approvalGrantIssuer?.issue],
  ];
  for (const [label, method] of requiredMethods) {
    if (typeof method !== 'function') throw new TypeError(`m2-lifecycle-service:${label}-required`);
  }
  for (const key of [
    'clock', 'idFactory', 'realpath', 'authorityTransaction', 'observeRevision',
    'queryContext', 'buildManifest', 'observeGitBaseline', 'planChange',
    'evaluateGovernance', 'createGovernanceReceipt', 'executeChange', 'readProjectFile',
  ]) {
    if (typeof value[key] !== 'function') throw new TypeError(`m2-lifecycle-service:${key}-required`);
  }
  return value;
}

export function createM2LifecycleApplicationService(dependencyValues) {
  const dependencies = requireDependencies(dependencyValues);
  const {
    projects,
    lifecycleRepository,
    executionRepository,
    effectRepository,
    approvalGrantIssuer,
    clock,
    idFactory,
    realpath,
    authorityTransaction,
    observeRevision,
    queryContext,
    buildManifest,
    observeGitBaseline,
    planChange,
    evaluateGovernance: governanceEvaluator,
    createGovernanceReceipt: receiptFactory,
    executeChange,
    readProjectFile,
    owner,
    liveness,
    processProvider,
    gitProvider,
    requireRecoveryCensus = false,
  } = dependencies;
  const activeRuns = new Map();
  let recoveryCensusComplete = requireRecoveryCensus !== true;
  let recoveryCensusAttempts = 0;
  let recoveryCensusLastAttemptAt = null;
  let recoveryCensusLastErrorCode = null;
  const recoveryExecutionAuthority = Symbol('m2-recovery-execution-authority');

  function requireRecoveryCensusComplete(authority = null) {
    if (!recoveryCensusComplete && authority !== recoveryExecutionAuthority) {
      fail(
        M2LifecycleServiceErrorCode.RECOVERY_INCOMPLETE,
        'Startup lifecycle recovery census has not completed',
      );
    }
  }

  async function resolveProject(projectId) {
    if (!Number.isSafeInteger(projectId) || projectId < 1) {
      fail(M2LifecycleServiceErrorCode.INPUT_INVALID, 'projectId is invalid');
    }
    let project;
    try { project = await projects.findById.get(projectId); } catch (error) {
      fail(M2LifecycleServiceErrorCode.PROJECT_UNAVAILABLE, 'Project registry lookup failed', {
        cause: error?.message || String(error),
      });
    }
    if (!project || project.id !== projectId || project.status !== 'active'
      || typeof project.path !== 'string') {
      fail(M2LifecycleServiceErrorCode.PROJECT_UNAVAILABLE, 'An active registered project is required');
    }
    let canonicalRoot;
    try { canonicalRoot = await realpath(project.path); } catch (error) {
      fail(M2LifecycleServiceErrorCode.PROJECT_UNAVAILABLE, 'Registered project root is unavailable', {
        cause: error?.message || String(error),
      });
    }
    return Object.freeze({ projectId, canonicalRoot });
  }

  function requireOwnedOperation({ authenticatedSubject, lifecycleId, origin }) {
    const actor = requireSubject(authenticatedSubject);
    requireIdentifier(lifecycleId, 'lifecycleId');
    const operation = lifecycleRepository.getOperation(lifecycleId);
    if (!operation) fail(M2LifecycleServiceErrorCode.PLAN_NOT_FOUND, 'Lifecycle plan does not exist');
    const plan = operation.plan ?? lifecycleRepository.getPlan(lifecycleId);
    if (plan.actor.id !== actor.id) {
      fail(M2LifecycleServiceErrorCode.OWNER_MISMATCH, 'Authenticated subject does not own this lifecycle');
    }
    const transportOrigin = normalizeOrigin(origin, plan.project.projectId);
    if (!sameOrigin(transportOrigin, plan.origin)) {
      fail(M2LifecycleServiceErrorCode.ORIGIN_MISMATCH, 'Transport origin does not own this lifecycle');
    }
    return { actor, operation, plan };
  }

  async function prepareSmallProjectChange({ authenticatedSubject, projectId, origin, proposal, signal = null }) {
    requireRecoveryCensusComplete();
    const actor = requireSubject(authenticatedSubject);
    const compiled = compileM2ProjectChangeProposal(proposal);
    const transportOrigin = normalizeOrigin(origin, projectId);
    const projectScope = await resolveProject(projectId);
    const invocation = signal == null ? {} : { signal };
    const observed = await observeRevision(projectScope, invocation, { projects });
    const identity = lifecycleIdentity(idFactory);
    const contextSnapshot = await queryContext({
      contract: PROJECT_CONTEXT_KIND.QUERY,
      version: 1,
      requestId: requireIdentifier(idFactory('context'), 'context requestId'),
      projectId,
      canonicalRoot: projectScope.canonicalRoot,
      workspaceRevision: observed.workspaceRevision,
      queryText: compiled.intent,
      maxFiles: MAX_CONTEXT_FILES,
      maxBytes: MAX_CONTEXT_BYTES,
      maxTokens: MAX_CONTEXT_TOKENS,
    }, invocation, { projects });
    if (contextSnapshot.status !== PROJECT_CONTEXT_TERMINAL_STATUS.OK) {
      const stale = contextSnapshot.error?.code === 'PROJECT_CONTEXT_STALE';
      fail(
        stale ? M2LifecycleServiceErrorCode.CONTEXT_STALE : M2LifecycleServiceErrorCode.CONTEXT_UNAVAILABLE,
        'Project context could not be pinned',
        { snapshot: contextSnapshot },
      );
    }

    const targetPaths = compiled.changes.map(change => change.path);
    const gitBaseline = observeGitBaseline(projectScope.canonicalRoot, targetPaths, { projectId });
    const planned = await planChange({
      executionId: identity.executionId,
      runId: identity.runId,
      actor,
      origin: transportOrigin,
      projectContext: observed,
      gitBaseline,
      changes: compiled.changes,
      focusedTest: compiled.focusedTest,
      gitCommit: compiled.gitCommit,
      createdAt: canonicalTimestamp(clock()),
    }, {
      observeRevision: scope => observeRevision(scope, invocation, { projects }),
    });
    const manifest = await buildManifest(projectScope, invocation);
    if (manifest.revision !== planned.request.project.workspaceRevision) {
      fail(M2LifecycleServiceErrorCode.CONTEXT_STALE, 'Workspace changed during planning');
    }
    const policySnapshot = loadPolicySnapshot(
      projectId,
      projectScope.canonicalRoot,
      manifest.revision,
      readProjectFile,
    );
    const baselineSnapshot = await buildGovernanceBaseline(
      policySnapshot,
      projectScope.canonicalRoot,
      readProjectFile,
    );
    const expectedAfterRevision = computeExpectedAfterRevision(
      manifest,
      planned.request,
      planned.files,
    );
    const decision = governanceEvaluator({
      lifecycleId: identity.lifecycleId,
      milestoneId: identity.milestoneId,
      request: planned.request,
      policySnapshot,
      baselineSnapshot,
      candidateFiles: candidateFiles(planned.files),
      expectedAfterRevision,
    });
    if (decision.verdict !== M2_GOVERNANCE_VERDICT.ALLOW) {
      fail(M2LifecycleServiceErrorCode.GOVERNANCE_DENIED, 'Deterministic governance did not allow execution', {
        decision,
      });
    }

    const createdAtMs = clock();
    const expiresAtMs = createdAtMs + DEFAULT_APPROVAL_WINDOW_MS;
    const plan = buildPlan({
      identity,
      actor,
      origin: transportOrigin,
      compiled,
      request: planned.request,
      contextSnapshot,
      decision,
      createdAt: canonicalTimestamp(createdAtMs),
      expiresAt: canonicalTimestamp(expiresAtMs),
    });
    const validations = [
      validateM2LifecyclePlanSnapshotForContext(contextSnapshot, plan),
      validateM2LifecyclePlanSnapshotForDecision(planned.request, decision, plan),
    ];
    const planErrors = validations.flatMap(validation => validation.errors);
    if (planErrors.length > 0) {
      fail(M2LifecycleServiceErrorCode.INPUT_INVALID, 'Lifecycle plan is not exact', { errors: planErrors });
    }

    try {
      authorityTransaction(() => {
        for (const effect of planned.effectRequests) effectRepository.registerEffectRequest(effect);
        executionRepository.registerProjectChange(planned.request, {
          files: planned.files,
          git: planned.git,
        });
        lifecycleRepository.registerOperation({
          plan,
          request: planned.request,
          contextSnapshot,
          focusedEnvironment: planned.focusedEnvironment,
          policySnapshot,
          baselineSnapshot,
          decision,
        });
        lifecycleRepository.appendEvent({
          eventId: requireIdentifier(idFactory('event'), 'eventId'),
          lifecycleId: identity.lifecycleId,
          eventType: 'operation_registered',
          details: { planDigest: computeM2LifecyclePlanSnapshotDigest(plan) },
        });
      });
    } catch (error) {
      fail(M2LifecycleServiceErrorCode.STORAGE_FAILURE, 'Lifecycle plan could not be stored atomically', {
        cause: error?.code || error?.message || String(error),
      });
    }
    return statusView(identity.lifecycleId);
  }

  function ensureGrantSet(plan, approval) {
    const existing = lifecycleRepository.getGrantSet(plan.identity.lifecycleId);
    if (existing) return existing;
    const steps = executionRepository.getSteps(plan.identity.executionId);
    const now = clock();
    const remaining = Date.parse(plan.approvalExpiresAt) - now;
    if (!Number.isSafeInteger(remaining) || remaining < 1) {
      fail(M2LifecycleServiceErrorCode.PLAN_EXPIRED, 'Approval window expired before grant issuance');
    }
    const grants = steps.map(step => Object.freeze({
      effectId: step.effectId,
      grantId: approvalGrantIssuer.issue({
        effectId: step.effectId,
        authenticatedSubject: { actorType: 'user', actorId: approval.actor.id },
        ttlMs: Math.min(remaining, 86_400_000),
      }).grant.grantId,
    })).sort((left, right) => compareUtf8(left.effectId, right.effectId));
    lifecycleRepository.recordGrantSet({
      lifecycleId: plan.identity.lifecycleId,
      approvalIntentDigest: computeM2LifecycleApprovalIntentDigest(approval),
      grants,
    });
    return lifecycleRepository.getGrantSet(plan.identity.lifecycleId);
  }

  async function observeCurrentRevision(plan, signal) {
    return observeRevision({
      projectId: plan.project.projectId,
      canonicalRoot: plan.project.canonicalRoot,
    }, signal == null ? {} : { signal }, { projects });
  }

  async function assertGovernanceInputsCurrent(plan) {
    const policy = loadPolicySnapshot(
      plan.project.projectId,
      plan.project.canonicalRoot,
      plan.project.workspaceRevision,
      readProjectFile,
    );
    const baseline = await buildGovernanceBaseline(
      policy,
      plan.project.canonicalRoot,
      readProjectFile,
    );
    if (!baseline.complete
      || computeM2GovernancePolicySnapshotDigest(policy) !== plan.governancePolicyDigest
      || computeM2GovernanceBaselineDigest(baseline) !== plan.governanceBaselineDigest) {
      fail(
        M2LifecycleServiceErrorCode.CONTEXT_STALE,
        'Governance policy or its complete source inventory changed before approval',
      );
    }
  }

  function buildSuccessTerminal(plan, approval, result, decision, receipt, completedAt) {
    const terminal = Object.freeze({
      contract: M2_LIFECYCLE_CONTRACT_KIND.TERMINAL_SNAPSHOT,
      version: M2_LIFECYCLE_CONTRACT_VERSION,
      identity: plan.identity,
      state: M2_LIFECYCLE_STATE.SUCCEEDED,
      planVersion: plan.planVersion,
      planDigest: computeM2LifecyclePlanSnapshotDigest(plan),
      approvalIntentDigest: computeM2LifecycleApprovalIntentDigest(approval),
      requestDigest: plan.requestDigest,
      authoritySetDigest: plan.authoritySetDigest,
      projectId: plan.project.projectId,
      workspaceRevision: result.changes.afterRevision,
      resultDigest: computeM2ExecutionValueDigest(result),
      governanceDecisionDigest: computeM2GovernanceDecisionDigest(decision),
      governanceReceiptDigest: computeM2GovernanceReceiptDigest(receipt),
      errorCode: null,
      completedAt,
      evidenceRefs: sortedEvidence([
        ...receipt.evidenceRefs,
        `lifecycle:${plan.identity.lifecycleId}:succeeded`,
      ]),
    });
    const semantic = validateM2LifecycleTerminalSnapshotForExecution({
      contextSnapshot: lifecycleRepository.getContextSnapshot(plan.identity.lifecycleId),
      plan,
      approval,
      request: lifecycleRepository.getRequest(plan.identity.lifecycleId),
      result,
      governanceDecision: decision,
      governanceReceipt: receipt,
      terminal,
    });
    if (!semantic.valid) {
      fail(M2LifecycleServiceErrorCode.STORAGE_FAILURE, 'Success terminal is not evidence-bound', {
        errors: [...semantic.errors],
      });
    }
    return terminal;
  }

  async function finalizeResult(plan, approval, result, signal = null) {
    const existing = lifecycleRepository.getTerminal(plan.identity.lifecycleId);
    if (existing) return existing;
    const decision = lifecycleRepository.getDecision(plan.identity.lifecycleId);
    const completedAt = canonicalTimestamp(clock());
    let terminal;
    if (result.terminalStatus === 'succeeded') {
      let receipt = lifecycleRepository.getReceipt(plan.identity.lifecycleId);
      if (receipt) {
        // The receipt was persisted only after the exact result and observed
        // after-revision matched. Recovery must finish that already-authorized
        // junction even if unrelated workspace drift happened after the crash.
        terminal = buildSuccessTerminal(plan, approval, result, decision, receipt, completedAt);
      } else {
        const current = await observeCurrentRevision(plan, signal);
        if (lifecycleRepository.getCancelIntent(plan.identity.lifecycleId)) {
        // A cancellation intent is durable authority. A child process may still
        // win the OS-level race and report success, but that result can never be
        // projected as lifecycle success or receive a governance receipt.
          terminal = buildNonSuccessTerminal({
            plan,
            approval,
            result,
            state: M2_LIFECYCLE_STATE.ORPHANED,
            errorCode: M2LifecycleServiceErrorCode.LATE_SUCCESS_AFTER_CANCEL,
            workspaceRevision: current.workspaceRevision,
            completedAt,
          });
        } else if (current.workspaceRevision !== result.changes.afterRevision
          || current.workspaceRevision !== plan.expectedAfterRevision) {
          terminal = buildNonSuccessTerminal({
            plan,
            approval,
            result,
            state: M2_LIFECYCLE_STATE.ORPHANED,
            errorCode: M2LifecycleServiceErrorCode.RESULT_REVISION_MISMATCH,
            workspaceRevision: current.workspaceRevision,
            completedAt,
          });
        } else {
          receipt = receiptFactory({
            request: lifecycleRepository.getRequest(plan.identity.lifecycleId),
            result,
            decision,
            recordedAt: completedAt,
          });
          lifecycleRepository.recordReceipt({ lifecycleId: plan.identity.lifecycleId, receipt });
          terminal = buildSuccessTerminal(plan, approval, result, decision, receipt, completedAt);
        }
      }
    } else {
      const current = await observeCurrentRevision(plan, signal);
      terminal = buildNonSuccessTerminal({
        plan,
        approval,
        result,
        state: resultState(result),
        errorCode: result.errorCode || `PROJECT_CHANGE_${result.terminalStatus.toUpperCase()}`,
        workspaceRevision: current.workspaceRevision,
        completedAt,
      });
    }
    lifecycleRepository.recordTerminal({ lifecycleId: plan.identity.lifecycleId, terminal });
    return terminal;
  }

  async function runApproved(plan, approval, grantSet, signal = null, recoveryAuthority = null) {
    requireRecoveryCensusComplete(recoveryAuthority);
    const lifecycleId = plan.identity.lifecycleId;
    const existing = activeRuns.get(lifecycleId);
    if (existing) return existing.promise;
    const controller = new AbortController();
    if (signal) {
      if (signal.aborted) controller.abort(signal.reason);
      else signal.addEventListener('abort', () => controller.abort(signal.reason), { once: true });
    }
    const promise = Promise.resolve().then(async () => {
      try {
        const result = await executeChange({
          executionId: plan.identity.executionId,
          grants: grantSet.grants,
          focusedEnvironment: lifecycleRepository.getFocusedEnvironment(lifecycleId),
          signal: controller.signal,
        }, {
          executionRepository,
          effectRepository,
          owner,
          liveness,
          observeRevision: scope => observeRevision(scope, { signal: controller.signal }, { projects }),
          observeGitBaseline,
          processProvider,
          gitProvider,
          clock,
        });
        // Terminal projection is trusted cleanup and must not inherit an
        // already-aborted request signal; otherwise a correctly cancelled
        // child process could prevent its durable lifecycle terminal.
        return finalizeResult(plan, approval, result);
      } finally {
        activeRuns.delete(lifecycleId);
      }
    });
    activeRuns.set(lifecycleId, { controller, promise });
    return promise;
  }

  async function approveSmallProjectChange({ authenticatedSubject, lifecycleId, planDigest, origin, signal = null }) {
    const owned = requireOwnedOperation({ authenticatedSubject, lifecycleId, origin });
    const { plan } = owned;
    const existingTerminal = lifecycleRepository.getTerminal(lifecycleId);
    if (existingTerminal) return statusView(lifecycleId);
    requireRecoveryCensusComplete();
    if (planDigest !== computeM2LifecyclePlanSnapshotDigest(plan)) {
      fail(M2LifecycleServiceErrorCode.PLAN_DIGEST_MISMATCH, 'Approval does not name the exact current plan');
    }
    const current = await observeCurrentRevision(plan, signal);
    if (current.workspaceRevision !== plan.project.workspaceRevision) {
      fail(M2LifecycleServiceErrorCode.CONTEXT_STALE, 'Workspace changed before approval');
    }
    await assertGovernanceInputsCurrent(plan);
    if (clock() > Date.parse(plan.approvalExpiresAt)) {
      fail(M2LifecycleServiceErrorCode.PLAN_EXPIRED, 'Lifecycle plan approval expired');
    }
    let approval = lifecycleRepository.getApprovalIntent(lifecycleId);
    if (!approval) {
      approval = buildApproval(plan, authenticatedSubject, clock(), idFactory);
      lifecycleRepository.recordApprovalIntent({ lifecycleId, approval });
      lifecycleRepository.appendEvent({
        eventId: requireIdentifier(idFactory('event'), 'eventId'),
        lifecycleId,
        eventType: 'approval_recorded',
        details: { approvalIntentDigest: computeM2LifecycleApprovalIntentDigest(approval) },
      });
    }
    if (lifecycleRepository.getCancelIntent(lifecycleId)) {
      fail(M2LifecycleServiceErrorCode.CANCELLED, 'Lifecycle was cancelled before execution');
    }
    const grantSet = ensureGrantSet(plan, approval);
    await runApproved(plan, approval, grantSet, signal);
    return statusView(lifecycleId);
  }

  async function cancelSmallProjectChange({ authenticatedSubject, lifecycleId, origin, reason = 'user_cancelled' }) {
    const { plan } = requireOwnedOperation({ authenticatedSubject, lifecycleId, origin });
    if (typeof reason !== 'string' || reason.trim().length < 1
      || reason !== reason.normalize('NFC') || reason.includes('\0')
      || Buffer.byteLength(reason, 'utf8') > 256) {
      fail(M2LifecycleServiceErrorCode.INPUT_INVALID, 'Cancellation reason is invalid');
    }
    const existingTerminal = lifecycleRepository.getTerminal(lifecycleId);
    if (existingTerminal) {
      fail(M2LifecycleServiceErrorCode.ALREADY_TERMINAL, 'Lifecycle is already terminal');
    }
    const existingResult = executionRepository.getResult(plan.identity.executionId);
    if (existingResult) {
      const approval = lifecycleRepository.getApprovalIntent(lifecycleId);
      await finalizeResult(plan, approval, existingResult);
      fail(M2LifecycleServiceErrorCode.ALREADY_TERMINAL, 'Execution was already terminal');
    }
    lifecycleRepository.recordCancelIntent({
      lifecycleId,
      actorId: plan.actor.id,
      reason,
      requestedAt: canonicalTimestamp(clock()),
    });
    effectRepository.revokeRunGrants({ runId: plan.identity.runId, reason: 'lifecycle_cancelled' });
    const active = activeRuns.get(lifecycleId);
    if (active) {
      active.controller.abort(Object.assign(new Error('Lifecycle cancelled'), { name: 'AbortError' }));
      await active.promise;
      return statusView(lifecycleId);
    }
    const approval = lifecycleRepository.getApprovalIntent(lifecycleId);
    const terminal = buildNonSuccessTerminal({
      plan,
      approval,
      result: null,
      state: M2_LIFECYCLE_STATE.CANCELLED,
      errorCode: M2LifecycleServiceErrorCode.CANCELLED,
      workspaceRevision: plan.project.workspaceRevision,
      completedAt: canonicalTimestamp(clock()),
    });
    lifecycleRepository.recordTerminal({ lifecycleId, terminal });
    return statusView(lifecycleId);
  }

  function statusView(lifecycleId) {
    const operation = lifecycleRepository.getOperation(lifecycleId);
    if (!operation) fail(M2LifecycleServiceErrorCode.PLAN_NOT_FOUND, 'Lifecycle plan does not exist');
    const plan = operation.plan ?? lifecycleRepository.getPlan(lifecycleId);
    const approval = lifecycleRepository.getApprovalIntent(lifecycleId);
    const grantSet = lifecycleRepository.getGrantSet(lifecycleId);
    const result = executionRepository.getResult(plan.identity.executionId);
    const terminal = lifecycleRepository.getTerminal(lifecycleId);
    const cancelIntent = lifecycleRepository.getCancelIntent(lifecycleId);
    let state = plan.state;
    if (terminal) state = terminal.state;
    else if (activeRuns.has(lifecycleId) || grantSet) state = M2_LIFECYCLE_STATE.EXECUTING;
    const material = executionRepository.getFileMaterial(plan.identity.executionId);
    return Object.freeze({
      lifecycleId,
      state,
      plan,
      planDigest: computeM2LifecyclePlanSnapshotDigest(plan),
      approval: approval ? Object.freeze({
        approvalId: approval.approvalId,
        intentDigest: computeM2LifecycleApprovalIntentDigest(approval),
        completeGrantSet: Boolean(grantSet),
        grantCount: grantSet?.grants?.length ?? 0,
      }) : null,
      diff: viewFromMaterial(plan, material),
      result,
      terminal,
      cancelRequested: Boolean(cancelIntent),
      audit: Object.freeze({
        governanceDecision: lifecycleRepository.getDecision(lifecycleId),
        governanceReceipt: lifecycleRepository.getReceipt(lifecycleId),
        lifecycleEvents: lifecycleRepository.listEvents(lifecycleId),
        executionEvents: executionRepository.listEvents(plan.identity.executionId),
      }),
    });
  }

  function getSmallProjectChangeStatus({ authenticatedSubject, lifecycleId, origin }) {
    requireOwnedOperation({ authenticatedSubject, lifecycleId, origin });
    return statusView(lifecycleId);
  }

  async function recoverIncompleteSmallProjectChanges() {
    recoveryCensusAttempts += 1;
    recoveryCensusLastAttemptAt = canonicalTimestamp(clock());
    try {
      const recovered = [];
      for (const operation of lifecycleRepository.listRecoverable()) {
        const plan = operation.plan ?? lifecycleRepository.getPlan(operation.lifecycleId);
        const approval = lifecycleRepository.getApprovalIntent(plan.identity.lifecycleId);
        const cancelIntent = lifecycleRepository.getCancelIntent(plan.identity.lifecycleId);
        const result = executionRepository.getResult(plan.identity.executionId);
        if (result) {
          await finalizeResult(plan, approval, result);
        } else if (cancelIntent) {
          effectRepository.revokeRunGrants({ runId: plan.identity.runId, reason: 'lifecycle_cancelled' });
          const terminal = buildNonSuccessTerminal({
            plan,
            approval,
            result: null,
            state: M2_LIFECYCLE_STATE.CANCELLED,
            errorCode: M2LifecycleServiceErrorCode.CANCELLED,
            workspaceRevision: plan.project.workspaceRevision,
            completedAt: canonicalTimestamp(clock()),
          });
          lifecycleRepository.recordTerminal({ lifecycleId: plan.identity.lifecycleId, terminal });
        } else if (approval) {
          const durableGrantSet = lifecycleRepository.getGrantSet(plan.identity.lifecycleId);
          if (durableGrantSet) {
            // Complete durable issuance is the execution authority. Approval
            // expiry cannot relabel an already-started or recovery-only run.
            await runApproved(plan, approval, durableGrantSet, null, recoveryExecutionAuthority);
          } else if (clock() >= Date.parse(approval.expiresAt)) {
            // A crash after durable approval but before the complete grant-set
            // must not wedge the startup census forever. Revoke any partial,
            // still-unconsumed issuance and close the plan without an effect.
            effectRepository.revokeRunGrants({
              runId: plan.identity.runId,
              reason: 'lifecycle_approval_expired',
            });
            const terminal = buildNonSuccessTerminal({
              plan,
              approval,
              result: null,
              state: M2_LIFECYCLE_STATE.BLOCKED,
              errorCode: M2LifecycleServiceErrorCode.PLAN_EXPIRED,
              workspaceRevision: plan.project.workspaceRevision,
              completedAt: canonicalTimestamp(clock()),
            });
            lifecycleRepository.recordTerminal({ lifecycleId: plan.identity.lifecycleId, terminal });
          } else {
            const grantSet = ensureGrantSet(plan, approval);
            await runApproved(plan, approval, grantSet, null, recoveryExecutionAuthority);
          }
        }
        recovered.push(statusView(plan.identity.lifecycleId));
      }
      recoveryCensusComplete = true;
      recoveryCensusLastErrorCode = null;
      return Object.freeze(recovered);
    } catch (error) {
      recoveryCensusComplete = false;
      recoveryCensusLastErrorCode = String(error?.code || error?.name || 'ERROR').slice(0, 128);
      throw error;
    }
  }

  function getRecoveryCensusStatus() {
    return Object.freeze({
      complete: recoveryCensusComplete,
      attempts: recoveryCensusAttempts,
      lastAttemptAt: recoveryCensusLastAttemptAt,
      lastErrorCode: recoveryCensusLastErrorCode,
    });
  }

  return Object.freeze({
    prepareSmallProjectChange,
    approveSmallProjectChange,
    cancelSmallProjectChange,
    getSmallProjectChangeStatus,
    recoverIncompleteSmallProjectChanges,
    getRecoveryCensusStatus,
  });
}

export function createDefaultM2LifecycleApplicationService({
  database,
  projects,
  clock = Date.now,
  processProvider = processSandboxProvider,
} = {}) {
  if (!database || typeof database.transaction !== 'function') {
    throw new TypeError('m2-lifecycle-service:database-required');
  }
  const effectRepository = new EffectAuthorityRepository(database, { clock });
  const executionRepository = new ExecutionAuthorityRepository(database, { clock });
  const lifecycleRepository = new M2LifecycleAuthorityRepository(database, { clock });
  const approvalGrantIssuer = createApprovalGrantIssuer(effectRepository, {
    clock,
    defaultTtlMs: DEFAULT_APPROVAL_WINDOW_MS,
  });
  return createM2LifecycleApplicationService({
    projects,
    lifecycleRepository,
    executionRepository,
    effectRepository,
    approvalGrantIssuer,
    clock,
    idFactory: defaultIdFactory,
    realpath: defaultRealpath,
    authorityTransaction: callback => database.transaction(callback)(),
    observeRevision: observeWorkspaceRevision,
    queryContext: queryProjectContext,
    buildManifest: buildProjectContextManifest,
    observeGitBaseline: observeExactGitBaseline,
    planChange: planProjectChange,
    evaluateGovernance: evaluateM2Governance,
    createGovernanceReceipt: createM2GovernanceReceipt,
    executeChange: executeProjectChange,
    readProjectFile: readProjectFileBytes,
    owner: processExecutionOwner,
    liveness: processExecutionLiveness,
    processProvider,
    gitProvider: exactGitProvider,
    requireRecoveryCensus: true,
  });
}

export const _testInternals = Object.freeze({
  POLICY_PATH,
  buildGovernanceBaseline,
  computeExpectedAfterRevision,
  isManifestObservablePath,
  loadPolicySnapshot,
  normalizeOrigin,
  parsePolicyDefinition,
});

export default createM2LifecycleApplicationService;
