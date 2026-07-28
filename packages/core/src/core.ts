import {
  AuditEventSchema,
  CreateProjectInputSchema,
  CreateTaskInputSchema,
  TaskSchema,
  WorkerEventSchema,
  parseWithSchema,
  type AuditEvent,
  type CreateProjectInput,
  type CreateTaskInput,
  type Evidence,
  type NormalizedError,
  type Project,
  type Task,
  type TaskResult,
  type TaskRun,
  type TaskRunStatus,
  type WorkerClaim,
  type WorkerEvent,
} from '@intentsmith/contracts';

import type { ApprovalLedger } from './approvals.js';
import { DomainError, normalizeError } from './errors.js';
import { assertCommand } from './lifecycle.js';
import { KeyedMutex } from './mutex.js';
import { canonicalizeCapabilityEnvelope, canonicalizeExistingPath } from './path-policy.js';
import type {
  AuditRepository,
  Clock,
  IdGenerator,
  ProjectRepository,
  TaskRepository,
  Timer,
  TransactionManager,
  WorkerAdapter,
  WorkerHandle,
} from './ports.js';
import { SystemTimer } from './runtime-adapters.js';
import { decideVerdict } from './verdict.js';

/** Run statuses that a restart may find and must not present as live. */
export const INTERRUPTIBLE_RUN_STATUSES: readonly TaskRunStatus[] = ['running', 'paused'];

type WorkerOutcome = {
  events: unknown[];
  forcedError?: NormalizedError;
  timedOut: boolean;
};

type ActiveRun = {
  runId: string;
  controller: AbortController;
  handle: WorkerHandle;
  settled: Promise<void>;
  /**
   * Set when the worker finished while the task was paused. Finalization is
   * deferred until resume so the outcome is never silently dropped.
   */
  pendingOutcome?: WorkerOutcome;
};

export type CollectedChangeEvidence = {
  acceptable: boolean;
  findings: string[];
  unavailableReason?: string;
  gateEvidence: Evidence[];
  diffs: TaskResult['diffs'];
  approvals: TaskResult['approvals'];
  /** Stable evidence links copied into the terminal audit event. */
  auditLinks: Record<string, unknown>;
};

export type ChangeEvidenceCollector = {
  collect(input: { task: Task; run: TaskRun; workerClaim?: WorkerClaim }): Promise<CollectedChangeEvidence>;
};

export type IntentSmithCoreOptions = {
  clock: Clock;
  ids: IdGenerator;
  projects: ProjectRepository;
  tasks: TaskRepository;
  audit: AuditRepository;
  transactions: TransactionManager;
  worker: WorkerAdapter;
  timer?: Timer;
  /**
   * Capability approvals, when the deployment mediates tools.
   *
   * Optional because a Core without a tool-calling worker has nothing to
   * approve. When it is present, every path that ends a run revokes whatever
   * that run still held: permission granted for work that is no longer
   * happening must not survive to authorize something else.
   */
  approvals?: ApprovalLedger;
  /**
   * Phase 3 edit evidence pipeline.
   *
   * Optional for earlier fake-worker phases. When `requireChangeEvidenceForCodeTasks`
   * is true, absence or failure of this collector is terminal and cannot be
   * replaced by the worker's success claim.
   */
  changeEvidence?: ChangeEvidenceCollector;
  requireChangeEvidenceForCodeTasks?: boolean;
};

export class IntentSmithCore {
  private readonly activeRuns = new Map<string, ActiveRun>();
  private readonly commands = new KeyedMutex();
  private readonly timer: Timer;

  constructor(private readonly options: IntentSmithCoreOptions) {
    this.timer = options.timer ?? new SystemTimer();
  }

  async createProject(input: CreateProjectInput): Promise<Project> {
    const parsed = parseWithSchema(CreateProjectInputSchema, input);
    const now = this.options.clock.now();
    const project: Project = {
      id: this.options.ids.next('project'),
      name: parsed.name,
      rootPath: canonicalizeExistingPath(parsed.rootPath),
      trustState: parsed.trustState ?? 'untrusted',
      status: 'active',
      createdAt: now,
      updatedAt: now,
    };

    await this.options.transactions.transaction(async () => {
      await this.options.projects.create(project);
      await this.appendAudit({
        projectId: project.id,
        type: 'project.created',
        message: 'Project created',
        data: { rootPath: project.rootPath, trustState: project.trustState },
      });
    });
    return project;
  }

  async getProject(projectId: string): Promise<Project> {
    const project = await this.options.projects.get(projectId);
    if (!project) throw new DomainError('PROJECT_NOT_FOUND', `Project not found: ${projectId}`);
    return project;
  }

  async createTask(input: CreateTaskInput): Promise<Task> {
    const parsed = parseWithSchema(CreateTaskInputSchema, input);
    const project = await this.getProject(parsed.projectId);
    const now = this.options.clock.now();
    const scope = canonicalizeCapabilityEnvelope(parsed.scope);
    const roots = [...scope.fsReadRoots, ...scope.fsWriteRoots];
    if (!roots.every(root => root === project.rootPath || root.startsWith(`${project.rootPath}/`))) {
      throw new DomainError('TASK_SCOPE_OUTSIDE_PROJECT', 'Task scope roots must stay inside the project workspace.');
    }

    const task: Task = {
      id: this.options.ids.next('task'),
      projectId: parsed.projectId,
      dependencyIds: [],
      type: parsed.type,
      goal: parsed.goal,
      scope,
      inputs: [],
      expectedOutputs: parsed.expectedOutputs,
      acceptanceCriteria: parsed.acceptanceCriteria,
      workerPreference: {
        kind: 'fake',
        scenario: parsed.workerScenario ?? 'success',
      },
      timeoutMs: parsed.timeoutMs ?? scope.timeoutMs,
      retryPolicy: {
        maxAttempts: 1,
        backoffMs: 0,
      },
      status: 'pending',
      createdAt: now,
      updatedAt: now,
    };
    parseWithSchema(TaskSchema, task);

    await this.options.transactions.transaction(async () => {
      await this.options.tasks.createTask(task);
      await this.appendAudit({
        projectId: task.projectId,
        taskId: task.id,
        type: 'task.created',
        message: 'Task created',
        data: { type: task.type, workerScenario: task.workerPreference.scenario },
      });
    });
    return task;
  }

  async getTask(taskId: string): Promise<Task> {
    const task = await this.options.tasks.getTask(taskId);
    if (!task) throw new DomainError('TASK_NOT_FOUND', `Task not found: ${taskId}`);
    return task;
  }

  async listTaskRuns(taskId: string): Promise<TaskRun[]> {
    await this.getTask(taskId);
    return await this.options.tasks.listRuns(taskId);
  }

  async startTask(taskId: string): Promise<Task> {
    return await this.commands.run(taskId, async () => {
      if (this.activeRuns.has(taskId)) {
        throw new DomainError('INVALID_TASK_TRANSITION', 'Cannot start a task that already has an active run.', false, {
          command: 'start',
        });
      }
      const { task, run } = await this.beginRun(taskId);
      const controller = new AbortController();
      const handle = this.options.worker.start({ task, run, signal: controller.signal });
      const active: ActiveRun = { runId: run.id, controller, handle, settled: Promise.resolve() };
      active.settled = this.watchRun(taskId, run.id, handle, controller, task.timeoutMs);
      // Failures are surfaced through task state and audit, never as an
      // unhandled rejection; `settled` stays awaitable for shutdown/waitForTask.
      void active.settled.catch(() => undefined);
      this.activeRuns.set(taskId, active);
      return task;
    });
  }

  async pauseTask(taskId: string): Promise<Task> {
    return await this.commands.run(taskId, async () => {
      const active = this.activeRuns.get(taskId);
      if (active) await active.handle.pause();
      return await this.applyCommand(taskId, 'pause', 'paused');
    });
  }

  async resumeTask(taskId: string): Promise<Task> {
    return await this.commands.run(taskId, async () => {
      const task = await this.applyCommand(taskId, 'resume', 'running');
      const active = this.activeRuns.get(taskId);
      if (!active) return task;

      const pending = active.pendingOutcome;
      if (pending) {
        // The worker finished while paused; settle it now instead of dropping it.
        active.pendingOutcome = undefined;
        await this.finalizeRun(taskId, active.runId, pending);
        return await this.getTask(taskId);
      }
      await active.handle.resume();
      return task;
    });
  }

  async cancelTask(taskId: string): Promise<Task> {
    return await this.commands.run(taskId, async () => {
      const active = this.activeRuns.get(taskId);
      // Abort before the state write so a cooperative worker stops promptly;
      // the command lock still guarantees a single winner.
      if (active) {
        active.controller.abort();
        await active.handle.cancel();
      }

      const task = await this.applyCommand(taskId, 'cancel', 'cancelled', async () => {
        if (!active) return;
        const run = await this.requireRun(active.runId);
        if (isTerminalRunStatus(run.status)) return;
        await this.options.tasks.updateRun({ ...run, status: 'cancelled', endedAt: this.options.clock.now() });
        const result = decideVerdict({
          id: this.options.ids.next('result'),
          taskId,
          runId: active.runId,
          now: this.options.clock.now(),
          deterministicEvidence: [],
          cancelled: true,
        });
        await this.saveResultOnce(result);
        const cancellingTask = await this.getTask(taskId);
        await this.appendAudit({
          projectId: cancellingTask.projectId,
          taskId,
          runId: active.runId,
          type: 'task.verdict',
          message: 'Core verdict: cancelled',
          data: { verdict: 'cancelled', risks: result.unresolvedRisks },
        });
      });

      if (active) {
        // The run is over, so nothing it was permitted to do still applies.
        await this.revokeApprovals(active.runId, 'Run cancelled.');
        this.activeRuns.delete(taskId);
      }
      return task;
    });
  }

  async getTaskResult(taskId: string): Promise<TaskResult | null> {
    return await this.options.tasks.getResult(taskId);
  }

  async listAuditEvents(taskId: string): Promise<AuditEvent[]> {
    return await this.options.audit.listByTask(taskId);
  }

  /**
   * Recovery policy for runs found in a non-terminal state at startup.
   *
   * A `running` or `paused` row left by a previous process has no live worker
   * behind it. Such a run is closed as `failed` with a `blocked` result that
   * records the interruption, its task moves to `failed`, and the audit trail
   * is preserved. Nothing is restarted automatically; a new run requires an
   * explicit user action.
   */
  async recoverInterruptedRuns(): Promise<TaskRun[]> {
    const orphaned = await this.options.tasks.listRunsByStatus(INTERRUPTIBLE_RUN_STATUSES);
    const recovered: TaskRun[] = [];
    for (const run of orphaned) {
      if (this.activeRuns.has(run.taskId)) continue;
      const closed = await this.commands.run(run.taskId, async () =>
        await this.options.transactions.transaction(async () => {
          const current = await this.options.tasks.getRun(run.id);
          if (!current || isTerminalRunStatus(current.status)) return null;
          const task = await this.getTask(current.taskId);
          const now = this.options.clock.now();
          const interrupted: TaskRun = { ...current, status: 'failed', endedAt: now };
          await this.options.tasks.updateRun(interrupted);
          if (!isTerminalTaskStatus(task.status)) {
            await this.options.tasks.update({ ...task, status: 'failed', updatedAt: now });
          }
          await this.saveResultOnce({
            id: this.options.ids.next('result'),
            taskId: task.id,
            runId: current.id,
            actions: [],
            diffs: [],
            artifacts: [],
            deterministicEvidence: [],
            securityEvidence: [],
            governanceFindings: [],
            approvals: [],
            unresolvedRisks: [
              'Run was interrupted by an unexpected process restart and was not resumed automatically.',
            ],
            coreVerdict: 'blocked',
            createdAt: now,
          });
          await this.appendAudit({
            projectId: task.projectId,
            taskId: task.id,
            runId: current.id,
            type: 'task.verdict',
            message: 'Run marked as interrupted after restart',
            data: { verdict: 'blocked', reason: 'process_restart', previousRunStatus: current.status },
          });
          return interrupted;
        }),
      );
      if (closed) {
        // A restart is not consent. Anything this run still held is closed:
        // pending questions expire unanswered, unused grants are revoked.
        await this.revokeApprovals(closed.id, 'Run was interrupted by a process restart.');
        recovered.push(closed);
      }
    }
    return recovered;
  }

  async shutdown(): Promise<void> {
    const active = [...this.activeRuns.entries()];
    for (const [taskId] of active) {
      // A task may already have reached a terminal state between the snapshot
      // and this call; that is not a shutdown failure.
      await this.cancelTask(taskId).catch(() => undefined);
    }
    await Promise.allSettled(active.map(([, run]) => run.settled));
  }

  async waitForTask(taskId: string): Promise<Task> {
    const active = this.activeRuns.get(taskId);
    if (active) await active.settled.catch(() => undefined);
    return await this.getTask(taskId);
  }

  /** Creates the TaskRun and moves the task to `running` in one transaction. */
  private async beginRun(taskId: string): Promise<{ task: Task; run: TaskRun }> {
    let current: Task | undefined;
    try {
      return await this.options.transactions.transaction(async () => {
        current = await this.getTask(taskId);
        assertCommand('start', current.status);
        const now = this.options.clock.now();
        const run: TaskRun = {
          id: this.options.ids.next('run'),
          taskId,
          attempt: (await this.options.tasks.countRuns(taskId)) + 1,
          status: 'running',
          startedAt: now,
        };
        const task: Task = { ...current, status: 'running', latestRunId: run.id, updatedAt: now };
        await this.options.tasks.createRun(run);
        await this.options.tasks.update(task);
        await this.appendAudit({
          projectId: task.projectId,
          taskId,
          runId: run.id,
          type: 'task.transition',
          message: `Task transitioned from ${current.status} to running`,
          data: { from: current.status, to: 'running', command: 'start' },
        });
        return { task, run };
      });
    } catch (error) {
      await this.auditRejectedCommand(current, 'start', error);
      throw error;
    }
  }

  /**
   * Applies a lifecycle command and its run-level side effects atomically.
   * Phase 1 committed the task transition first and updated the run afterwards,
   * so a failure in between left task and run disagreeing.
   */
  private async applyCommand(
    taskId: string,
    command: 'pause' | 'resume' | 'cancel',
    to: Task['status'],
    withinTransaction?: () => Promise<void>,
  ): Promise<Task> {
    let current: Task | undefined;
    try {
      return await this.options.transactions.transaction(async () => {
        current = await this.getTask(taskId);
        assertCommand(command, current.status);
        const task: Task = { ...current, status: to, updatedAt: this.options.clock.now() };
        await this.options.tasks.update(task);
        if (command !== 'cancel') await this.syncRunStatus(task, to === 'paused' ? 'paused' : 'running');
        await this.appendAudit({
          projectId: task.projectId,
          taskId,
          runId: task.latestRunId,
          type: 'task.transition',
          message: `Task transitioned from ${current.status} to ${to}`,
          data: { from: current.status, to, command },
        });
        if (withinTransaction) await withinTransaction();
        return task;
      });
    } catch (error) {
      await this.auditRejectedCommand(current, command, error);
      throw error;
    }
  }

  private async syncRunStatus(task: Task, status: TaskRunStatus): Promise<void> {
    const active = this.activeRuns.get(task.id);
    if (!active) return;
    const run = await this.requireRun(active.runId);
    if (isTerminalRunStatus(run.status)) return;
    await this.options.tasks.updateRun({ ...run, status });
  }

  private async auditRejectedCommand(task: Task | undefined, command: string, error: unknown): Promise<void> {
    if (!task || !(error instanceof DomainError) || error.code !== 'INVALID_TASK_TRANSITION') return;
    try {
      await this.appendAudit({
        projectId: task.projectId,
        taskId: task.id,
        runId: task.latestRunId,
        type: 'task.invalid_transition',
        message: error.message,
        data: { from: task.status, command },
      });
    } catch {
      // Never let audit bookkeeping mask the original rejection.
    }
  }

  /** Races the worker against its timeout and finalizes exactly once. */
  private async watchRun(
    taskId: string,
    runId: string,
    handle: WorkerHandle,
    controller: AbortController,
    timeoutMs: number,
  ): Promise<void> {
    let cancelTimer: (() => void) | undefined;
    const timeout = new Promise<'timeout'>(resolve => {
      cancelTimer = this.timer.schedule(() => resolve('timeout'), timeoutMs);
    });

    let outcome: WorkerOutcome;
    try {
      const raced = await Promise.race([handle.done, timeout]);
      if (raced === 'timeout') {
        controller.abort();
        // AbortSignal is the cooperative notification; the WorkerHandle owns
        // the process and must also be told to terminate it. Without this call
        // an external worker can stay alive with an approval request pending
        // after Core has already declared the TaskRun timed out.
        await handle.cancel().catch(() => undefined);
        outcome = {
          events: [],
          forcedError: { code: 'WORKER_TIMEOUT', message: 'Worker timed out', retryable: true },
          timedOut: true,
        };
      } else {
        outcome = { events: raced.events, timedOut: false };
      }
    } catch (error) {
      // A worker that throws must become a normalized error, not a crash.
      outcome = { events: [], forcedError: normalizeError(error), timedOut: false };
    } finally {
      cancelTimer?.();
    }

    await this.commands.run(taskId, async () => {
      const task = await this.getTask(taskId);
      if (task.status === 'cancelled') return;
      if (task.status === 'paused') {
        const active = this.activeRuns.get(taskId);
        // Hold the outcome; `resumeTask` finalizes it.
        if (active) active.pendingOutcome = outcome;
        return;
      }
      await this.finalizeRun(taskId, runId, outcome);
    });
  }

  private async finalizeRun(taskId: string, runId: string, outcome: WorkerOutcome): Promise<void> {
    const taskBeforeEvidence = await this.getTask(taskId);
    const runBeforeEvidence = await this.requireRun(runId);
    // A terminal run verdict is immutable; a late worker event cannot rewrite it.
    if (isTerminalRunStatus(runBeforeEvidence.status) || isTerminalTaskStatus(taskBeforeEvidence.status)) return;

    const parsed = await this.collectWorkerEvents(taskBeforeEvidence, runId, outcome.events);
    const requiresChangeSet =
      this.options.requireChangeEvidenceForCodeTasks === true && taskBeforeEvidence.type === 'code';
    let changeEvidence: CollectedChangeEvidence | undefined;
    if (this.options.changeEvidence) {
      try {
        changeEvidence = await this.options.changeEvidence.collect({
          task: taskBeforeEvidence,
          run: runBeforeEvidence,
          ...(parsed.claim === undefined ? {} : { workerClaim: parsed.claim }),
        });
      } catch {
        changeEvidence = {
          acceptable: false,
          findings: [],
          unavailableReason: 'The Git-backed change evidence pipeline could not complete.',
          gateEvidence: [],
          diffs: [],
          approvals: [],
          auditLinks: {},
        };
      }
    }

    await this.options.transactions.transaction(async () => {
      const task = await this.getTask(taskId);
      const run = await this.requireRun(runId);
      if (isTerminalRunStatus(run.status) || isTerminalTaskStatus(task.status)) return;

      const result = decideVerdict({
        id: this.options.ids.next('result'),
        taskId,
        runId,
        now: this.options.clock.now(),
        workerClaim: parsed.claim,
        deterministicEvidence: [...parsed.evidence, ...(changeEvidence?.gateEvidence ?? [])],
        artifacts: parsed.artifacts,
        diffs: parsed.diffs,
        workerError: outcome.forcedError ?? parsed.workerError,
        invalidWorkerEvent: parsed.invalidEvent,
        workerProtocolViolation: parsed.protocolViolation,
        timedOut: outcome.timedOut,
        requiresChangeSet,
        ...(changeEvidence
          ? {
              changeCapture: {
                acceptable: changeEvidence.acceptable,
                findings: changeEvidence.findings,
                ...(changeEvidence.unavailableReason === undefined
                  ? {}
                  : { unavailableReason: changeEvidence.unavailableReason }),
              },
              diffs: changeEvidence.diffs,
              approvals: changeEvidence.approvals,
            }
          : {}),
      });
      const nextStatus = result.coreVerdict === 'pass' ? 'passed' : 'failed';
      const now = this.options.clock.now();
      await this.options.tasks.updateRun({ ...run, status: outcome.timedOut ? 'timeout' : nextStatus, endedAt: now });
      await this.options.tasks.update({ ...task, status: nextStatus, updatedAt: now });
      await this.saveResultOnce(result);
      await this.appendAudit({
        projectId: task.projectId,
        taskId,
        runId,
        type: 'task.verdict',
        message: `Core verdict: ${result.coreVerdict}`,
        data: {
          verdict: result.coreVerdict,
          risks: result.unresolvedRisks,
          ...(changeEvidence ? { evidenceLinks: changeEvidence.auditLinks } : {}),
        },
      });
      await this.revokeApprovals(
        runId,
        outcome.timedOut ? 'Run timed out.' : `Run ended with verdict ${result.coreVerdict}.`,
      );
      this.activeRuns.delete(taskId);
    });
  }

  private async collectWorkerEvents(
    task: Task,
    runId: string,
    rawEvents: unknown[],
  ): Promise<{
    evidence: Evidence[];
    artifacts: TaskResult['artifacts'];
    diffs: TaskResult['diffs'];
    claim?: WorkerClaim;
    workerError?: NormalizedError;
    invalidEvent: boolean;
    protocolViolation: boolean;
  }> {
    const evidence: Evidence[] = [];
    const artifacts: TaskResult['artifacts'] = [];
    const diffs: TaskResult['diffs'] = [];
    let claim: WorkerClaim | undefined;
    let workerError: NormalizedError | undefined;
    let invalidEvent = false;
    let protocolViolation = false;
    let terminalSeen = false;

    for (const rawEvent of rawEvents) {
      let event: WorkerEvent;
      try {
        event = parseWithSchema(WorkerEventSchema, rawEvent);
      } catch (error) {
        invalidEvent = true;
        await this.appendAudit({
          projectId: task.projectId,
          taskId: task.id,
          runId,
          type: 'worker.invalid_event',
          message: 'Worker event failed schema validation',
          data: { error: normalizeError(error) },
        });
        continue;
      }

      if (terminalSeen) {
        // `completed`/`failed` end the stream; anything after it is a protocol
        // violation, including a second terminal event.
        protocolViolation = true;
        await this.appendAudit({
          projectId: task.projectId,
          taskId: task.id,
          runId,
          type: 'worker.invalid_event',
          message: `Worker emitted "${event.type}" after a terminal event`,
          data: { type: event.type },
        });
        continue;
      }

      await this.appendAudit({
        projectId: task.projectId,
        taskId: task.id,
        runId,
        type: 'worker.event',
        message: `Worker event: ${event.type}`,
        data: { type: event.type },
      });

      if (event.type === 'evidence') evidence.push(event.evidence);
      if (event.type === 'artifact') artifacts.push(event.artifact);
      if (event.type === 'completed') {
        claim = event.claim;
        terminalSeen = true;
      }
      if (event.type === 'failed') {
        workerError = event.error;
        terminalSeen = true;
      }
    }
    return { evidence, artifacts, diffs, claim, workerError, invalidEvent, protocolViolation };
  }

  /** Persists a result unless the run already has one (results are immutable). */
  private async saveResultOnce(result: TaskResult): Promise<void> {
    const existing = await this.options.tasks.getResultByRun(result.runId);
    if (existing) return;
    await this.options.tasks.saveResult(result);
  }

  private async requireRun(runId: string): Promise<TaskRun> {
    const run = await this.options.tasks.getRun(runId);
    if (!run) throw new DomainError('TASK_RUN_NOT_FOUND', `Task run not found: ${runId}`);
    return run;
  }

  /** Ends any approval the run still held. Safe when no ledger is configured. */
  private async revokeApprovals(runId: string, reason: string): Promise<void> {
    await this.options.approvals?.revokeRun(runId, reason);
  }

  private async appendAudit(input: Omit<AuditEvent, 'id' | 'createdAt'>): Promise<void> {
    const event: AuditEvent = {
      id: this.options.ids.next('audit'),
      createdAt: this.options.clock.now(),
      ...input,
    };
    parseWithSchema(AuditEventSchema, event);
    await this.options.audit.append(event);
  }
}

function isTerminalRunStatus(status: TaskRunStatus): boolean {
  return status === 'passed' || status === 'failed' || status === 'cancelled' || status === 'timeout';
}

function isTerminalTaskStatus(status: Task['status']): boolean {
  return status === 'passed' || status === 'failed' || status === 'cancelled';
}
