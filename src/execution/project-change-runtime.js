import { createHash } from 'node:crypto';

import {
  M2_EFFECT_CONTRACT_KIND,
  computeEffectRequestDigest,
} from '../../contracts/m2/effect-v1.js';
import {
  M2_EXECUTION_CONTRACT_KIND,
  computeM2ExecutionValueDigest,
  computeM2ProjectChangeRequestDigest,
} from '../../contracts/m2/execution-v1.js';
import {
  deleteProjectFileDurable,
  readProjectFileBytes,
  writeProjectFileAtomic,
} from '../executor/project-path-authority.js';
import { reconcileOwnedProcess } from './process-recovery.js';

export const ProjectChangeRuntimeErrorCode = Object.freeze({
  INPUT_INVALID: 'PROJECT_CHANGE_RUNTIME_INPUT_INVALID',
  AUTHORITY_INCOMPLETE: 'PROJECT_CHANGE_AUTHORITY_INCOMPLETE',
  CONTEXT_STALE: 'PROJECT_CHANGE_CONTEXT_STALE',
  FILE_DRIFT: 'PROJECT_CHANGE_FILE_DRIFT',
  WRITE_FAILED: 'PROJECT_CHANGE_WRITE_FAILED',
  TEST_FAILED: 'PROJECT_CHANGE_TEST_FAILED',
  TEST_CANCELLED: 'PROJECT_CHANGE_TEST_CANCELLED',
  TEST_TIMED_OUT: 'PROJECT_CHANGE_TEST_TIMED_OUT',
  TEST_ORPHANED: 'PROJECT_CHANGE_TEST_ORPHANED',
  GIT_FAILED: 'PROJECT_CHANGE_GIT_FAILED',
  ROLLBACK_FAILED: 'PROJECT_CHANGE_ROLLBACK_FAILED',
  RECOVERY_REQUIRED: 'PROJECT_CHANGE_RECOVERY_REQUIRED',
  PROCESS_RECOVERY_UNRESOLVED: 'PROJECT_CHANGE_PROCESS_RECOVERY_UNRESOLVED',
});

export class ProjectChangeRuntimeError extends Error {
  constructor(code, message, details = null) {
    super(message);
    this.name = 'ProjectChangeRuntimeError';
    this.code = code;
    this.details = details;
  }
}

function fail(code, message, details = null) {
  throw new ProjectChangeRuntimeError(code, message, details);
}

function sha(bytes) {
  return `sha256:${createHash('sha256').update(bytes).digest('hex')}`;
}

function isWorkspaceRevisionObservation(value) {
  return value !== null
    && typeof value === 'object'
    && typeof value.workspaceRevision === 'string'
    && /^wsr1:[0-9a-f]{64}$/.test(value.workspaceRevision);
}

function eventId(executionId, generation, type, key) {
  const digest = createHash('sha256')
    .update(JSON.stringify({ executionId, generation, type, key }), 'utf8')
    .digest('hex');
  return `event:${digest}`;
}

function timestamp(clock) {
  const value = clock();
  if (!Number.isSafeInteger(value) || value < 0) {
    fail(ProjectChangeRuntimeErrorCode.INPUT_INVALID, 'Runtime clock returned an invalid value');
  }
  return new Date(value).toISOString();
}

function emptyProcess() {
  return { pid: null, processGroupId: null, startIdentity: null, exitCode: null, signal: null };
}

function emptyNetwork() {
  return { resolvedAddresses: [], finalUrl: null, status: null, bytes: 0 };
}

function effectResult({
  request,
  terminalStatus,
  startedAt,
  completedAt,
  process = emptyProcess(),
  paths = [],
  beforeDigest = null,
  afterDigest = null,
  outputDigest = null,
  errorCode = null,
  evidenceRef,
  lateCompletionRejected = false,
  rollback = { required: false, status: 'not_required', evidenceRef: null },
}) {
  return {
    contract: M2_EFFECT_CONTRACT_KIND.EFFECT_RESULT,
    version: 1,
    effectId: request.effectId,
    runId: request.runId,
    projectId: request.origin.projectId,
    requestDigest: computeEffectRequestDigest(request),
    approvalGrantId: request.approvalGrantId,
    terminalStatus,
    startedAt,
    completedAt,
    process,
    changes: { paths, beforeDigest, afterDigest, diffArtifact: null },
    network: emptyNetwork(),
    rollback,
    outputDigest,
    errorCode,
    evidenceRefs: [evidenceRef],
    lateCompletionRejected,
  };
}

function terminalForProcess(status) {
  if (status === 'succeeded') return { terminal: 'succeeded', error: null };
  if (status === 'cancelled') return { terminal: 'cancelled', error: 'PROCESS_CANCELLED' };
  if (status === 'timed_out') return { terminal: 'timed_out', error: 'PROCESS_TIMED_OUT' };
  if (status === 'killed') return { terminal: 'killed', error: 'PROCESS_KILLED' };
  if (status === 'orphaned') return { terminal: 'orphaned', error: 'PROCESS_ORPHANED' };
  return { terminal: 'failed', error: 'PROCESS_FAILED' };
}

function processTerminationProven(outcome) {
  return outcome?.terminalStatus !== 'orphaned'
    && (outcome?.processGroupState === 'empty' || outcome?.cleanup?.groupState === 'empty');
}

function matchesImage(observation, image) {
  if (!image.exists) return observation.exists === false;
  return observation.exists === true
    && sha(observation.bytes) === image.digest
    && observation.bytes.length === image.bytes
    && observation.mode === image.mode;
}

function observeProjectImage(canonicalRoot, relativePath) {
  try {
    return Object.freeze({ state: 'observed', value: readProjectFileBytes(canonicalRoot, relativePath) });
  } catch {
    return Object.freeze({ state: 'foreign', value: null });
  }
}

function imageState(observation, before, after) {
  if (observation.state !== 'observed') return 'foreign';
  if (matchesImage(observation.value, before)) return 'before';
  if (matchesImage(observation.value, { exists: true, ...after })) return 'after';
  return 'foreign';
}

function mismatchedAfterImages(request, material) {
  const mismatched = [];
  for (const file of material) {
    const observation = observeProjectImage(request.project.canonicalRoot, file.path);
    const change = request.changes[file.ordinal];
    if (imageState(observation, change.before, change.after) !== 'after') {
      mismatched.push(file.path);
    }
  }
  return mismatched;
}

function requireDependencies(dependencies) {
  const required = [
    'executionRepository', 'effectRepository', 'owner', 'liveness',
    'observeRevision', 'observeGitBaseline', 'processProvider',
  ];
  if (!dependencies || required.some(key => !dependencies[key])) {
    fail(ProjectChangeRuntimeErrorCode.INPUT_INVALID, 'Project-change runtime dependencies are incomplete');
  }
  return dependencies;
}

function grantMapForSteps(steps, grants) {
  if (!Array.isArray(grants) || grants.length !== steps.length) {
    fail(ProjectChangeRuntimeErrorCode.AUTHORITY_INCOMPLETE, 'One grant is required for every child effect');
  }
  const map = new Map(grants.map(entry => [entry.effectId, entry.grantId]));
  if (map.size !== steps.length || steps.some(step => !map.has(step.effectId))) {
    fail(ProjectChangeRuntimeErrorCode.AUTHORITY_INCOMPLETE, 'Grant set does not match exact child effects');
  }
  return map;
}

function parentResult({
  request,
  generation,
  startedAt,
  completedAt,
  terminalStatus,
  changedPaths,
  afterRevision,
  focusedTest,
  git,
  rollback,
  errorCode,
  evidenceRefs,
  lateCompletionRejected = false,
}) {
  return {
    contract: M2_EXECUTION_CONTRACT_KIND.RESULT,
    version: 1,
    executionId: request.executionId,
    requestDigest: computeM2ProjectChangeRequestDigest(request),
    runId: request.runId,
    projectId: request.project.projectId,
    terminalStatus,
    fencingGeneration: generation,
    startedAt,
    completedAt,
    changes: {
      paths: changedPaths,
      beforeRevision: request.project.workspaceRevision,
      afterRevision,
      diffDigest: terminalStatus === 'succeeded'
        ? computeM2ExecutionValueDigest(request.changes.map(change => ({
          path: change.path,
          before: change.before.digest,
          after: change.after.digest,
        })))
        : null,
    },
    focusedTest,
    git,
    rollback,
    errorCode,
    evidenceRefs: [...evidenceRefs].sort((left, right) => Buffer.compare(Buffer.from(left), Buffer.from(right))),
    lateCompletionRejected,
  };
}

function notStartedFocused(request) {
  return {
    effectId: request.focusedTest.authority.effectId,
    terminalStatus: 'not_started',
    exitCode: null,
    signal: null,
    stdoutDigest: null,
    stderrDigest: null,
    outputTruncated: false,
  };
}

function initialGit(request) {
  return {
    status: 'not_requested',
    beforeHead: request.project.gitHead,
    afterHead: request.project.gitHead,
    commitId: null,
    foreignDirtPreserved: true,
  };
}

async function rollbackApplied({
  request,
  material,
  appliedPaths,
  generation,
  executionRepository,
  effectRepository,
  clock,
}) {
  const restored = [];
  const failed = [];
  for (const file of [...material].reverse()) {
    if (!appliedPaths.has(file.path)) continue;
    const change = request.changes[file.ordinal];
    const rollbackRequest = effectRepository.getEffectRequest(file.rollbackEffectId);
    const observed = observeProjectImage(request.project.canonicalRoot, file.path);
    if (observed.state !== 'observed') {
      failed.push(file.path);
      continue;
    }
    if (!matchesImage(observed.value, { exists: true, ...change.after })) {
      if (matchesImage(observed.value, change.before)) {
        restored.push(file.path);
        continue;
      }
      failed.push(file.path);
      continue;
    }
    const startedAt = timestamp(clock);
    executionRepository.appendEvent({
      eventId: eventId(request.executionId, generation, 'rollback_intent', file.path),
      executionId: request.executionId,
      generation,
      phase: 'rollback',
      type: 'rollback_intent',
      path: file.path,
      effectId: rollbackRequest.effectId,
      details: { afterDigest: change.after.digest, beforeDigest: change.before.digest },
    });
    try {
      if (change.before.exists) {
        writeProjectFileAtomic(
          request.project.canonicalRoot,
          file.path,
          file.beforeBytes,
          { expectedTarget: observed.value.target, createParents: false, desiredMode: change.before.mode },
        );
      } else {
        deleteProjectFileDurable(
          request.project.canonicalRoot,
          file.path,
          { expectedTarget: observed.value.target },
        );
      }
      const restoredObservation = readProjectFileBytes(request.project.canonicalRoot, file.path);
      if (!matchesImage(restoredObservation, change.before)) {
        throw new Error('rollback readback mismatch');
      }
      executionRepository.appendEvent({
        eventId: eventId(request.executionId, generation, 'rollback_applied', file.path),
        executionId: request.executionId,
        generation,
        phase: 'rollback',
        type: 'rollback_applied',
        path: file.path,
        effectId: rollbackRequest.effectId,
        details: { restored: true },
      });
      const completedAt = timestamp(clock);
      effectRepository.recordEffectResult(effectResult({
        request: rollbackRequest,
        terminalStatus: 'succeeded',
        startedAt,
        completedAt,
        paths: [file.path],
        beforeDigest: change.after.digest,
        afterDigest: change.before.digest,
        outputDigest: rollbackRequest.payloadDigest,
        evidenceRef: `execution:${request.executionId}:rollback:${file.ordinal}`,
      }));
      restored.push(file.path);
    } catch {
      failed.push(file.path);
    }
  }
  restored.sort((left, right) => Buffer.compare(Buffer.from(left), Buffer.from(right)));
  failed.sort((left, right) => Buffer.compare(Buffer.from(left), Buffer.from(right)));
  return Object.freeze({ restored, failed });
}

function recoveredFocusedEvidence(request, executionRepository, effectRepository) {
  const effectId = request.focusedTest.authority.effectId;
  const event = [...executionRepository.listEvents(request.executionId)]
    .reverse()
    .find(candidate => candidate.type === 'process_terminated' && candidate.effectId === effectId);
  const focused = event?.details?.focused;
  const result = effectRepository.getEffectResult(effectId);
  if (!focused || !result
    || focused.effectId !== effectId
    || result.terminalStatus !== 'succeeded'
    || result.outputDigest !== computeM2ExecutionValueDigest(focused)
    || focused.terminalStatus !== 'succeeded'
    || focused.exitCode !== request.focusedTest.expectedExitCode
    || focused.signal !== null
    || typeof focused.stdoutDigest !== 'string'
    || typeof focused.stderrDigest !== 'string'
    || typeof focused.outputTruncated !== 'boolean') {
    return null;
  }
  return Object.freeze({ ...focused });
}

function recoveredGitInput(request, material, gitMaterial) {
  return {
    projectRoot: request.project.canonicalRoot,
    baseline: {
      projectId: request.project.projectId,
      canonicalRoot: request.project.canonicalRoot,
      head: request.project.gitHead,
      branchRef: request.project.gitBranchRef,
      foreignDirtDigest: request.project.foreignDirtDigest,
    },
    files: material.map(file => ({
      path: file.path,
      bytes: file.afterBytes,
      mode: request.changes[file.ordinal].after.mode,
    })),
    message: gitMaterial.message,
    identity: gitMaterial.identity,
  };
}

function recoveryInDoubtResult({
  request,
  claim,
  startedAt,
  completedAt,
  focused,
  git,
  paths,
  errorCode = ProjectChangeRuntimeErrorCode.RECOVERY_REQUIRED,
}) {
  return parentResult({
    request,
    generation: claim.generation,
    startedAt,
    completedAt,
    terminalStatus: 'orphaned',
    changedPaths: [],
    afterRevision: null,
    focusedTest: focused,
    git,
    rollback: {
      required: paths.length > 0,
      status: paths.length > 0 ? 'failed' : 'not_required',
      paths,
      evidenceRef: paths.length > 0 ? `execution:${request.executionId}:recovery-in-doubt` : null,
    },
    errorCode,
    evidenceRefs: [`execution:${request.executionId}:recovery-terminal`],
    lateCompletionRejected: true,
  });
}

async function recoverOnly(request, claim, dependencies, startedAt) {
  const {
    executionRepository,
    effectRepository,
    observeRevision,
    observeGitBaseline,
    gitProvider,
    clock,
    processRecovery = reconcileOwnedProcess,
  } = dependencies;
  const outstandingProcesses = executionRepository.listOutstandingProcesses(request.executionId);
  for (const processRecord of outstandingProcesses) {
    const recovery = await processRecovery(processRecord);
    if (!recovery
      || recovery.authority !== 'linux-pidfd-v1'
      || !['terminated', 'already_terminated'].includes(recovery.status)
      || recovery.groupState !== 'empty') {
      fail(
        ProjectChangeRuntimeErrorCode.PROCESS_RECOVERY_UNRESOLVED,
        'A previously owned process group could not be proven empty',
        {
          effectId: processRecord.effectId,
          recordedGeneration: processRecord.generation,
          reason: recovery?.reason ?? 'invalid-recovery-result',
        },
      );
    }
    executionRepository.appendEvent({
      eventId: eventId(
        request.executionId,
        claim.generation,
        'process_terminated',
        `${processRecord.effectId}:${processRecord.generation}`,
      ),
      executionId: request.executionId,
      generation: claim.generation,
      phase: 'process_recovery',
      type: 'process_terminated',
      effectId: processRecord.effectId,
      details: {
        recovered: true,
        recordedGeneration: processRecord.generation,
        authority: recovery.authority,
        status: recovery.status,
        reason: recovery.reason,
        identityMatched: recovery.identityMatched,
        termSent: recovery.termSent,
        killSent: recovery.killSent,
        groupState: recovery.groupState,
      },
    });
  }
  const material = executionRepository.getFileMaterial(request.executionId);
  const appliedPaths = new Set();
  const drift = [];
  for (const file of material) {
    const change = request.changes[file.ordinal];
    const observed = observeProjectImage(request.project.canonicalRoot, file.path);
    const state = imageState(observed, change.before, change.after);
    executionRepository.appendEvent({
      eventId: eventId(request.executionId, claim.generation, 'recovery_observed', file.path),
      executionId: request.executionId,
      generation: claim.generation,
      phase: 'recovery',
      type: 'recovery_observed',
      path: file.path,
      details: { state },
    });
    if (state === 'after') appliedPaths.add(file.path);
    if (state === 'foreign') drift.push(file.path);
  }

  const focused = recoveredFocusedEvidence(request, executionRepository, effectRepository)
    ?? notStartedFocused(request);

  if (request.gitCommit !== null) {
    let gitObservation;
    try {
      gitObservation = observeGitBaseline(
        request.project.canonicalRoot,
        request.changes.map(change => change.path),
        { projectId: request.project.projectId },
      );
    } catch {
      gitObservation = null;
    }
    const gitBaselineExact = gitObservation
      && gitObservation.branchRef === request.project.gitBranchRef
      && gitObservation.foreignDirtDigest === request.project.foreignDirtDigest;
    const allAfter = appliedPaths.size === material.length && drift.length === 0;
    let exactGitRecovery = null;
    if (gitBaselineExact && allAfter && gitProvider && typeof gitProvider.recover === 'function') {
      try {
        exactGitRecovery = await gitProvider.recover(recoveredGitInput(
          request,
          material,
          executionRepository.getGitMaterial(request.executionId),
        ));
      } catch { /* classified below as in doubt */ }
    }

    if (!gitBaselineExact || drift.length > 0
      || (gitObservation.head !== request.project.gitHead && !allAfter)) {
      const result = recoveryInDoubtResult({
        request,
        claim,
        startedAt,
        completedAt: timestamp(clock),
        focused,
        git: {
          status: 'in_doubt', beforeHead: request.project.gitHead,
          afterHead: gitObservation?.head ?? null, commitId: null, foreignDirtPreserved: false,
        },
        paths: drift.length > 0 ? [...drift] : request.changes.map(change => change.path),
      });
      executionRepository.recordResult(result);
      return result;
    }

    if (gitObservation.head === request.project.gitHead
      && allAfter && exactGitRecovery?.status !== 'not_committed') {
      const result = recoveryInDoubtResult({
        request,
        claim,
        startedAt,
        completedAt: timestamp(clock),
        focused,
        git: {
          status: 'in_doubt', beforeHead: request.project.gitHead,
          afterHead: gitObservation.head, commitId: null, foreignDirtPreserved: false,
        },
        paths: request.changes.map(change => change.path),
      });
      executionRepository.recordResult(result);
      return result;
    }

    if (gitObservation.head !== request.project.gitHead) {
      const recoveredGit = exactGitRecovery;
      if (recoveredGit?.status !== 'committed') {
        const result = recoveryInDoubtResult({
          request,
          claim,
          startedAt,
          completedAt: timestamp(clock),
          focused,
          git: {
            status: 'in_doubt', beforeHead: request.project.gitHead,
            afterHead: gitObservation.head, commitId: null, foreignDirtPreserved: false,
          },
          paths: request.changes.map(change => change.path),
        });
        executionRepository.recordResult(result);
        return result;
      }

      const forwardComplete = request.changes.every(change => (
        effectRepository.getEffectResult(change.forwardAuthority.effectId)?.terminalStatus === 'succeeded'
      ));
      const rollbackStarted = request.changes.some(change => (
        effectRepository.getEffectResult(change.rollbackAuthority.effectId) !== null
      ));
      if (!forwardComplete || rollbackStarted || focused.terminalStatus !== 'succeeded') {
        const result = recoveryInDoubtResult({
          request,
          claim,
          startedAt,
          completedAt: timestamp(clock),
          focused,
          git: recoveredGit,
          paths: request.changes.map(change => change.path),
        });
        executionRepository.recordResult(result);
        return result;
      }

      const gitRequest = effectRepository.getEffectRequest(request.gitCommit.authority.effectId);
      const existingGitResult = effectRepository.getEffectResult(gitRequest.effectId);
      if (existingGitResult && existingGitResult.terminalStatus !== 'succeeded') {
        const result = recoveryInDoubtResult({
          request,
          claim,
          startedAt,
          completedAt: timestamp(clock),
          focused,
          git: recoveredGit,
          paths: request.changes.map(change => change.path),
        });
        executionRepository.recordResult(result);
        return result;
      }
      if (!existingGitResult) {
        const gitStartedAt = timestamp(clock);
        executionRepository.appendEvent({
          eventId: eventId(request.executionId, claim.generation, 'git_ref_updated', recoveredGit.commitId),
          executionId: request.executionId,
          generation: claim.generation,
          phase: 'git_recovery',
          type: 'git_ref_updated',
          effectId: gitRequest.effectId,
          details: { beforeHead: recoveredGit.beforeHead, afterHead: recoveredGit.afterHead, recovered: true },
        });
        effectRepository.recordEffectResult(effectResult({
          request: gitRequest,
          terminalStatus: 'succeeded',
          startedAt: gitStartedAt,
          completedAt: timestamp(clock),
          paths: request.gitCommit.paths,
          beforeDigest: sha(Buffer.from(recoveredGit.beforeHead)),
          afterDigest: sha(Buffer.from(recoveredGit.afterHead)),
          outputDigest: sha(Buffer.from(recoveredGit.commitId)),
          evidenceRef: `execution:${request.executionId}:git-recovered`,
        }));
      }

      let afterObservation;
      try {
        afterObservation = await observeRevision({
          projectId: request.project.projectId,
          canonicalRoot: request.project.canonicalRoot,
        });
      } catch {
        afterObservation = null;
      }
      if (!isWorkspaceRevisionObservation(afterObservation)) {
        const result = recoveryInDoubtResult({
          request,
          claim,
          startedAt,
          completedAt: timestamp(clock),
          focused,
          git: recoveredGit,
          paths: request.changes.map(change => change.path),
        });
        executionRepository.recordResult(result);
        return result;
      }
      executionRepository.appendEvent({
        eventId: eventId(request.executionId, claim.generation, 'terminal_prepared', 'recovered-success'),
        executionId: request.executionId,
        generation: claim.generation,
        phase: 'terminal',
        type: 'terminal_prepared',
        details: { afterRevision: afterObservation.workspaceRevision, recovered: true },
      });
      const result = parentResult({
        request,
        generation: claim.generation,
        startedAt,
        completedAt: timestamp(clock),
        terminalStatus: 'succeeded',
        changedPaths: request.changes.map(change => change.path),
        afterRevision: afterObservation.workspaceRevision,
        focusedTest: focused,
        git: recoveredGit,
        rollback: { required: false, status: 'not_required', paths: [], evidenceRef: null },
        errorCode: null,
        evidenceRefs: [`execution:${request.executionId}:recovered-success`],
      });
      executionRepository.recordResult(result);
      return result;
    }
  }

  const rollback = drift.length === 0
    ? await rollbackApplied({
      request,
      material,
      appliedPaths,
      generation: claim.generation,
      executionRepository,
      effectRepository,
      clock,
    })
    : { restored: [], failed: drift };
  const rollbackFailed = rollback.failed.length > 0;
  const result = parentResult({
    request,
    generation: claim.generation,
    startedAt,
    completedAt: timestamp(clock),
    terminalStatus: 'orphaned',
    changedPaths: [],
    afterRevision: null,
    focusedTest: focused,
    git: request.gitCommit === null ? initialGit(request) : {
      status: 'reverted', beforeHead: request.project.gitHead,
      afterHead: request.project.gitHead, commitId: null, foreignDirtPreserved: true,
    },
    rollback: {
      required: appliedPaths.size > 0 || drift.length > 0,
      status: rollbackFailed ? 'failed' : appliedPaths.size > 0 ? 'succeeded' : 'not_required',
      paths: rollbackFailed ? rollback.failed : rollback.restored,
      evidenceRef: appliedPaths.size > 0 || drift.length > 0
        ? `execution:${request.executionId}:recovery`
        : null,
    },
    errorCode: rollbackFailed
      ? ProjectChangeRuntimeErrorCode.ROLLBACK_FAILED
      : ProjectChangeRuntimeErrorCode.RECOVERY_REQUIRED,
    evidenceRefs: [`execution:${request.executionId}:recovery-terminal`],
    lateCompletionRejected: true,
  });
  executionRepository.recordResult(result);
  return result;
}

export async function executeProjectChange({
  executionId,
  grants = null,
  focusedEnvironment = {},
  signal = null,
}, dependencyValues) {
  const dependencies = requireDependencies(dependencyValues);
  const {
    executionRepository,
    effectRepository,
    owner,
    liveness,
    observeRevision,
    observeGitBaseline,
    processProvider,
    gitProvider = null,
    clock = Date.now,
  } = dependencies;
  const terminal = executionRepository.getResult(executionId);
  if (terminal) return terminal;
  const request = executionRepository.getProjectChangeRequest(executionId);
  if (!request) fail(ProjectChangeRuntimeErrorCode.INPUT_INVALID, 'Execution request does not exist');
  const startedAt = timestamp(clock);
  const claim = executionRepository.acquireClaim({ executionId, owner, liveness });
  const steps = executionRepository.getSteps(executionId);
  const previousApproval = executionRepository.getLatestApprovalSet(executionId);

  if (previousApproval) {
    executionRepository.recordApprovalSet({
      executionId,
      generation: claim.generation,
      grantIds: previousApproval.grantIds,
    });
    return recoverOnly(request, claim, { ...dependencies, clock }, startedAt);
  }

  const consumedApproval = executionRepository.getConsumedApprovalSet(executionId);
  if (consumedApproval.status === 'complete') {
    executionRepository.recordApprovalSet({
      executionId,
      generation: claim.generation,
      grantIds: consumedApproval.grantIds,
    });
    return recoverOnly(request, claim, { ...dependencies, clock }, startedAt);
  }
  if (consumedApproval.status === 'partial') {
    fail(
      ProjectChangeRuntimeErrorCode.AUTHORITY_INCOMPLETE,
      'A partial consumed authority set cannot be replayed or executed',
    );
  }

  const grantsByEffect = grantMapForSteps(steps, grants);
  const items = steps.map(step => {
    const effect = effectRepository.getEffectRequest(step.effectId);
    if (!effect || computeEffectRequestDigest(effect) !== step.requestDigest) {
      fail(ProjectChangeRuntimeErrorCode.AUTHORITY_INCOMPLETE, 'Stored child effect differs from execution authority');
    }
    return {
      grantId: grantsByEffect.get(step.effectId),
      request: { ...effect, approvalGrantId: grantsByEffect.get(step.effectId) },
    };
  });
  effectRepository.consumeApprovalGrantBatch({ items, executionOwner: owner });
  const grantIds = [...grantsByEffect.values()]
    .sort((left, right) => Buffer.compare(Buffer.from(left), Buffer.from(right)));
  executionRepository.recordApprovalSet({ executionId, generation: claim.generation, grantIds });

  if (computeM2ExecutionValueDigest(focusedEnvironment) !== request.focusedTest.environmentDigest) {
    const result = parentResult({
      request,
      generation: claim.generation,
      startedAt,
      completedAt: timestamp(clock),
      terminalStatus: 'failed',
      changedPaths: [],
      afterRevision: null,
      focusedTest: notStartedFocused(request),
      git: initialGit(request),
      rollback: { required: false, status: 'not_required', paths: [], evidenceRef: null },
      errorCode: ProjectChangeRuntimeErrorCode.AUTHORITY_INCOMPLETE,
      evidenceRefs: [`execution:${executionId}:environment-mismatch`],
    });
    executionRepository.recordResult(result);
    return result;
  }

  let observed;
  try {
    observed = await observeRevision({
      projectId: request.project.projectId,
      canonicalRoot: request.project.canonicalRoot,
    });
  } catch {
    observed = null;
  }
  if (!isWorkspaceRevisionObservation(observed)
    || observed.workspaceRevision !== request.project.workspaceRevision) {
    const result = parentResult({
      request,
      generation: claim.generation,
      startedAt,
      completedAt: timestamp(clock),
      terminalStatus: 'failed',
      changedPaths: [],
      afterRevision: null,
      focusedTest: notStartedFocused(request),
      git: initialGit(request),
      rollback: { required: false, status: 'not_required', paths: [], evidenceRef: null },
      errorCode: ProjectChangeRuntimeErrorCode.CONTEXT_STALE,
      evidenceRefs: [`execution:${executionId}:stale`],
    });
    executionRepository.recordResult(result);
    return result;
  }
  let initialGitObservation;
  try {
    initialGitObservation = observeGitBaseline(
      request.project.canonicalRoot,
      request.changes.map(change => change.path),
      { projectId: request.project.projectId },
    );
  } catch {
    initialGitObservation = null;
  }
  if (
    !initialGitObservation
    || initialGitObservation.head !== request.project.gitHead
    || initialGitObservation.branchRef !== request.project.gitBranchRef
    || initialGitObservation.foreignDirtDigest !== request.project.foreignDirtDigest
    || initialGitObservation.targetDirtyPaths.length !== 0
  ) {
    const result = parentResult({
      request,
      generation: claim.generation,
      startedAt,
      completedAt: timestamp(clock),
      terminalStatus: 'failed',
      changedPaths: [],
      afterRevision: null,
      focusedTest: notStartedFocused(request),
      git: { ...initialGit(request), foreignDirtPreserved: false },
      rollback: { required: false, status: 'not_required', paths: [], evidenceRef: null },
      errorCode: ProjectChangeRuntimeErrorCode.FILE_DRIFT,
      evidenceRefs: [`execution:${executionId}:git-baseline-changed`],
    });
    executionRepository.recordResult(result);
    return result;
  }

  const material = executionRepository.getFileMaterial(executionId);
  const appliedPaths = new Set();
  let focused = notStartedFocused(request);
  let git = initialGit(request);
  let stop = null;

  const finishStopped = async () => {
    const outstandingProcesses = executionRepository.listOutstandingProcesses(executionId);
    if (outstandingProcesses.length > 0) {
      fail(
        ProjectChangeRuntimeErrorCode.PROCESS_RECOVERY_UNRESOLVED,
        'A recorded process group is not proven empty; rollback and terminalization are fenced',
        { effectIds: outstandingProcesses.map(process => process.effectId) },
      );
    }
    const rolledBack = await rollbackApplied({
      request,
      material,
      appliedPaths,
      generation: claim.generation,
      executionRepository,
      effectRepository,
      clock,
    });
    const rollbackFailed = rolledBack.failed.length > 0;
    const required = appliedPaths.size > 0;
    const result = parentResult({
      request,
      generation: claim.generation,
      startedAt,
      completedAt: timestamp(clock),
      terminalStatus: rollbackFailed ? 'orphaned' : stop.status,
      changedPaths: [],
      afterRevision: null,
      focusedTest: focused,
      git,
      rollback: {
        required,
        status: rollbackFailed ? 'failed' : required ? 'succeeded' : 'not_required',
        paths: rollbackFailed ? rolledBack.failed : rolledBack.restored,
        evidenceRef: required ? `execution:${executionId}:rollback` : null,
      },
      errorCode: rollbackFailed ? ProjectChangeRuntimeErrorCode.ROLLBACK_FAILED : stop.code,
      evidenceRefs: [`execution:${executionId}:failed`],
      lateCompletionRejected: focused.terminalStatus === 'orphaned',
    });
    executionRepository.recordResult(result);
    return result;
  };

  for (const file of material) {
    const change = request.changes[file.ordinal];
    const currentObservation = observeProjectImage(request.project.canonicalRoot, file.path);
    if (currentObservation.state !== 'observed'
      || !matchesImage(currentObservation.value, change.before)) {
      stop = { status: 'failed', code: ProjectChangeRuntimeErrorCode.FILE_DRIFT };
      break;
    }
    const current = currentObservation.value;
    const forward = effectRepository.getEffectRequest(file.forwardEffectId);
    const effectStartedAt = timestamp(clock);
    executionRepository.appendEvent({
      eventId: eventId(executionId, claim.generation, 'phase_intent', file.path),
      executionId,
      generation: claim.generation,
      phase: 'write',
      type: 'phase_intent',
      path: file.path,
      effectId: forward.effectId,
      details: { beforeDigest: change.before.digest, afterDigest: change.after.digest },
    });
    try {
      writeProjectFileAtomic(
        request.project.canonicalRoot,
        file.path,
        file.afterBytes,
        { expectedTarget: current.target, createParents: false, desiredMode: change.after.mode },
      );
      appliedPaths.add(file.path);
      const after = readProjectFileBytes(request.project.canonicalRoot, file.path);
      if (!matchesImage(after, { exists: true, ...change.after })) throw new Error('write readback mismatch');
      executionRepository.appendEvent({
        eventId: eventId(executionId, claim.generation, 'phase_applied', file.path),
        executionId,
        generation: claim.generation,
        phase: 'write',
        type: 'phase_applied',
        path: file.path,
        effectId: forward.effectId,
        details: { afterDigest: change.after.digest },
      });
      effectRepository.recordEffectResult(effectResult({
        request: forward,
        terminalStatus: 'succeeded',
        startedAt: effectStartedAt,
        completedAt: timestamp(clock),
        paths: [file.path],
        beforeDigest: change.before.digest,
        afterDigest: change.after.digest,
        outputDigest: change.after.digest,
        evidenceRef: `execution:${executionId}:forward:${file.ordinal}`,
      }));
    } catch (error) {
      let exactAfterObserved = false;
      try {
        const afterFailure = readProjectFileBytes(request.project.canonicalRoot, file.path);
        if (matchesImage(afterFailure, { exists: true, ...change.after })) {
          exactAfterObserved = true;
          appliedPaths.add(file.path);
        }
      } catch { /* rollback scanner will classify this as foreign */ }
      const appliedOrAmbiguous = appliedPaths.has(file.path)
        || exactAfterObserved
        || error?.effectApplied === true;
      if (!effectRepository.getEffectResult(forward.effectId)) {
        effectRepository.recordEffectResult(effectResult({
          request: forward,
          terminalStatus: appliedOrAmbiguous ? 'orphaned' : 'failed',
          startedAt: effectStartedAt,
          completedAt: timestamp(clock),
          paths: appliedOrAmbiguous ? [file.path] : [],
          beforeDigest: appliedOrAmbiguous ? change.before.digest : null,
          afterDigest: exactAfterObserved ? change.after.digest : null,
          outputDigest: exactAfterObserved ? change.after.digest : null,
          errorCode: 'FS_WRITE_FAILED',
          evidenceRef: `execution:${executionId}:forward-failed:${file.ordinal}`,
          lateCompletionRejected: appliedOrAmbiguous,
          rollback: appliedOrAmbiguous ? {
            required: true,
            status: 'pending',
            evidenceRef: `execution:${executionId}:forward-rollback-pending:${file.ordinal}`,
          } : undefined,
        }));
      }
      stop = { status: 'failed', code: ProjectChangeRuntimeErrorCode.WRITE_FAILED };
      break;
    }
  }

  if (!stop) {
    const processRequest = effectRepository.getEffectRequest(request.focusedTest.authority.effectId);
    const processStartedAt = timestamp(clock);
    let recordedProcess = null;
    let processOutcome;
    try {
      const recordSupervisor = info => {
          recordedProcess = {
            pid: info.supervisorPid ?? info.pid,
            processGroupId: info.supervisorPgid ?? info.processGroupId,
            bootId: info.supervisorBootId ?? info.bootId,
            startIdentity: info.supervisorStartIdentity ?? info.startIdentity,
          };
          executionRepository.recordProcess({
            executionId,
            generation: claim.generation,
            effectId: processRequest.effectId,
            supervisorPid: recordedProcess.pid,
            processGroupId: recordedProcess.processGroupId,
            ownerBootId: recordedProcess.bootId,
            ownerStartIdentity: recordedProcess.startIdentity,
          });
          executionRepository.appendEvent({
            eventId: eventId(executionId, claim.generation, 'process_started', processRequest.effectId),
            executionId,
            generation: claim.generation,
            phase: 'focused_test',
            type: 'process_started',
            effectId: processRequest.effectId,
            details: { pid: recordedProcess.pid, processGroupId: recordedProcess.processGroupId },
          });
          return Object.freeze({ durable: true });
      };
      if (typeof processProvider.run === 'function') {
        processOutcome = await processProvider.run({
          sandboxProfile: request.focusedTest.sandboxProfile,
          projectRoot: request.project.canonicalRoot,
          binary: request.focusedTest.binary,
          argv: request.focusedTest.argv,
          argvDigest: request.focusedTest.argvDigest,
          canonicalCwd: request.focusedTest.canonicalCwd,
          environment: focusedEnvironment,
          environmentDigest: request.focusedTest.environmentDigest,
          timeoutMs: request.focusedTest.timeoutMs,
          expectedExitCode: request.focusedTest.expectedExitCode,
        }, {
          recordSupervisorIdentity: recordSupervisor,
          signal,
        });
      } else {
        processOutcome = await processProvider.execute({
          binary: request.focusedTest.binary,
          argv: request.focusedTest.argv,
          canonicalCwd: request.focusedTest.canonicalCwd,
          environment: focusedEnvironment,
          environmentDigest: request.focusedTest.environmentDigest,
          timeoutMs: request.focusedTest.timeoutMs,
          signal,
          onSupervisor: recordSupervisor,
        });
      }
    } catch (error) {
      processOutcome = {
        terminalStatus: 'failed', exitCode: null, signal: null,
        stdoutDigest: null, stderrDigest: null, outputTruncated: false,
        lateCompletionRejected: false, errorCode: error?.code || 'PROCESS_UNAVAILABLE',
      };
    }
    const terminationProven = recordedProcess ? processTerminationProven(processOutcome) : true;
    const effectiveProcessStatus = recordedProcess && !terminationProven
      ? 'orphaned'
      : processOutcome.terminalStatus;
    focused = {
      effectId: processRequest.effectId,
      terminalStatus: effectiveProcessStatus,
      exitCode: processOutcome.exitCode,
      signal: processOutcome.signal,
      stdoutDigest: processOutcome.stdoutDigest,
      stderrDigest: processOutcome.stderrDigest,
      outputTruncated: processOutcome.outputTruncated,
    };
    const processTerminal = terminalForProcess(effectiveProcessStatus);
    const processCompletedAt = timestamp(clock);
    if (recordedProcess && terminationProven) {
      executionRepository.appendEvent({
        eventId: eventId(executionId, claim.generation, 'process_terminated', processRequest.effectId),
        executionId,
        generation: claim.generation,
        phase: 'focused_test',
        type: 'process_terminated',
        effectId: processRequest.effectId,
        details: {
          focused,
          effectStartedAt: processStartedAt,
          effectCompletedAt: processCompletedAt,
        },
      });
    }
    effectRepository.recordEffectResult(effectResult({
      request: processRequest,
      terminalStatus: processTerminal.terminal,
      startedAt: processStartedAt,
      completedAt: processCompletedAt,
      process: {
        pid: recordedProcess?.pid ?? null,
        processGroupId: recordedProcess?.processGroupId ?? null,
        startIdentity: recordedProcess?.startIdentity ?? null,
        exitCode: processOutcome.exitCode,
        signal: processOutcome.signal,
      },
      outputDigest: computeM2ExecutionValueDigest(focused),
      errorCode: processTerminal.error,
      evidenceRef: `execution:${executionId}:focused-test`,
      lateCompletionRejected: effectiveProcessStatus === 'orphaned'
        || Boolean(processOutcome.lateCompletionRejected),
    }));
    if (effectiveProcessStatus !== 'succeeded' || processOutcome.exitCode !== 0) {
      const mapping = {
        cancelled: ['cancelled', ProjectChangeRuntimeErrorCode.TEST_CANCELLED],
        timed_out: ['timed_out', ProjectChangeRuntimeErrorCode.TEST_TIMED_OUT],
        orphaned: ['orphaned', ProjectChangeRuntimeErrorCode.TEST_ORPHANED],
      };
      const [status, code] = mapping[effectiveProcessStatus]
        ?? ['failed', ProjectChangeRuntimeErrorCode.TEST_FAILED];
      stop = { status, code };
    }
  }

  if (!stop && request.gitCommit !== null) {
    if (!gitProvider || typeof gitProvider.commit !== 'function') {
      stop = { status: 'failed', code: ProjectChangeRuntimeErrorCode.GIT_FAILED };
      git = {
        status: 'failed', beforeHead: request.project.gitHead,
        afterHead: request.project.gitHead, commitId: null, foreignDirtPreserved: true,
      };
    } else {
      const gitRequest = effectRepository.getEffectRequest(request.gitCommit.authority.effectId);
      const gitStartedAt = timestamp(clock);
      try {
        const gitMaterial = executionRepository.getGitMaterial(executionId);
        git = await gitProvider.commit({
          projectRoot: request.project.canonicalRoot,
          baseline: {
            projectId: request.project.projectId,
            canonicalRoot: request.project.canonicalRoot,
            head: request.project.gitHead,
            branchRef: request.project.gitBranchRef,
            foreignDirtDigest: request.project.foreignDirtDigest,
          },
          files: material.map(file => ({
            path: file.path,
            bytes: file.afterBytes,
            mode: request.changes[file.ordinal].after.mode,
          })),
          message: gitMaterial.message,
          identity: gitMaterial.identity,
        });
        executionRepository.appendEvent({
          eventId: eventId(executionId, claim.generation, 'git_ref_updated', git.commitId),
          executionId,
          generation: claim.generation,
          phase: 'git',
          type: 'git_ref_updated',
          effectId: gitRequest.effectId,
          details: { beforeHead: git.beforeHead, afterHead: git.afterHead },
        });
        effectRepository.recordEffectResult(effectResult({
          request: gitRequest,
          terminalStatus: 'succeeded',
          startedAt: gitStartedAt,
          completedAt: timestamp(clock),
          paths: request.gitCommit.paths,
          beforeDigest: sha(Buffer.from(git.beforeHead)),
          afterDigest: sha(Buffer.from(git.afterHead)),
          outputDigest: sha(Buffer.from(git.commitId)),
          evidenceRef: `execution:${executionId}:git-commit`,
        }));
      } catch (error) {
        const provenPostEffectCode = [
          'EXACT_GIT_COMMAND_FAILED',
          'EXACT_GIT_IN_DOUBT',
        ].includes(error?.code);
        const candidateCommitId = provenPostEffectCode
          && error?.details?.effectApplied === true
          && typeof error?.details?.commitId === 'string'
          ? error.details.commitId
          : null;
        const compensated = candidateCommitId !== null
          && error.code === 'EXACT_GIT_COMMAND_FAILED'
          && error?.details?.rollbackStatus === 'succeeded';
        const inDoubt = candidateCommitId !== null
          && error.code === 'EXACT_GIT_IN_DOUBT'
          && error?.details?.rollbackStatus === 'failed';
        const appliedCommitId = compensated || inDoubt ? candidateCommitId : null;
        git = {
          status: inDoubt ? 'in_doubt' : 'failed',
          beforeHead: request.project.gitHead,
          afterHead: compensated ? request.project.gitHead : null,
          commitId: appliedCommitId,
          foreignDirtPreserved: !inDoubt,
        };
        if (!effectRepository.getEffectResult(gitRequest.effectId)) {
          effectRepository.recordEffectResult(effectResult({
            request: gitRequest,
            terminalStatus: inDoubt ? 'orphaned' : 'failed',
            startedAt: gitStartedAt,
            completedAt: timestamp(clock),
            paths: appliedCommitId === null ? [] : request.gitCommit.paths,
            beforeDigest: appliedCommitId === null
              ? null
              : sha(Buffer.from(request.project.gitHead)),
            afterDigest: appliedCommitId === null ? null : sha(Buffer.from(appliedCommitId)),
            outputDigest: appliedCommitId === null ? null : sha(Buffer.from(appliedCommitId)),
            errorCode: inDoubt
              ? 'GIT_COMMIT_IN_DOUBT'
              : compensated
                ? 'GIT_COMMIT_COMPENSATED'
                : 'GIT_COMMIT_PRE_EFFECT_FAILED',
            evidenceRef: inDoubt
              ? `execution:${executionId}:git-in-doubt`
              : compensated
                ? `execution:${executionId}:git-compensated`
                : `execution:${executionId}:git-pre-effect-failed`,
            lateCompletionRejected: inDoubt,
            rollback: appliedCommitId === null
              ? { required: false, status: 'not_required', evidenceRef: null }
              : {
                required: true,
                status: compensated ? 'succeeded' : 'failed',
                evidenceRef: compensated
                  ? `execution:${executionId}:git-compensated`
                  : `execution:${executionId}:git-compensation-failed`,
              },
          }));
        }
        stop = {
          status: inDoubt ? 'orphaned' : 'failed',
          code: ProjectChangeRuntimeErrorCode.GIT_FAILED,
        };
      }
    }
  }

  if (!stop && request.gitCommit === null) {
    let finalGitObservation;
    try {
      finalGitObservation = observeGitBaseline(
        request.project.canonicalRoot,
        request.changes.map(change => change.path),
        { projectId: request.project.projectId },
      );
    } catch {
      finalGitObservation = null;
    }
    const expectedPaths = request.changes.map(change => change.path);
    if (
      !finalGitObservation
      || finalGitObservation.head !== request.project.gitHead
      || finalGitObservation.branchRef !== request.project.gitBranchRef
      || finalGitObservation.foreignDirtDigest !== request.project.foreignDirtDigest
      || finalGitObservation.targetDirtyPaths.length !== expectedPaths.length
      || finalGitObservation.targetDirtyPaths.some((candidate, index) => candidate !== expectedPaths[index])
    ) {
      git = {
        ...initialGit(request), foreignDirtPreserved: false,
      };
      stop = { status: 'failed', code: ProjectChangeRuntimeErrorCode.GIT_FAILED };
    }
  }

  if (stop) return finishStopped();

  let afterObservation;
  try {
    afterObservation = await observeRevision({
      projectId: request.project.projectId,
      canonicalRoot: request.project.canonicalRoot,
    });
  } catch {
    afterObservation = null;
  }
  if (!isWorkspaceRevisionObservation(afterObservation)) {
    if (git.status !== 'committed') {
      stop = { status: 'failed', code: ProjectChangeRuntimeErrorCode.CONTEXT_STALE };
      return finishStopped();
    }
    const result = parentResult({
      request,
      generation: claim.generation,
      startedAt,
      completedAt: timestamp(clock),
      terminalStatus: 'orphaned',
      changedPaths: [],
      afterRevision: null,
      focusedTest: focused,
      git,
      rollback: { required: false, status: 'not_required', paths: [], evidenceRef: null },
      errorCode: ProjectChangeRuntimeErrorCode.CONTEXT_STALE,
      evidenceRefs: [`execution:${executionId}:revision-observation-failed-after-commit`],
    });
    executionRepository.recordResult(result);
    return result;
  }
  if (mismatchedAfterImages(request, material).length > 0) {
    stop = { status: 'failed', code: ProjectChangeRuntimeErrorCode.FILE_DRIFT };
    return finishStopped();
  }
  executionRepository.appendEvent({
    eventId: eventId(executionId, claim.generation, 'terminal_prepared', 'success'),
    executionId,
    generation: claim.generation,
    phase: 'terminal',
    type: 'terminal_prepared',
    details: { afterRevision: afterObservation.workspaceRevision },
  });
  const result = parentResult({
    request,
    generation: claim.generation,
    startedAt,
    completedAt: timestamp(clock),
    terminalStatus: 'succeeded',
    changedPaths: request.changes.map(change => change.path),
    afterRevision: afterObservation.workspaceRevision,
    focusedTest: focused,
    git,
    rollback: { required: false, status: 'not_required', paths: [], evidenceRef: null },
    errorCode: null,
    evidenceRefs: [`execution:${executionId}:succeeded`],
  });
  executionRepository.recordResult(result);
  return result;
}

export default executeProjectChange;
