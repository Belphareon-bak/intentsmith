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
  type WorkerClaim,
  type WorkerEvent,
} from '@intentsmith/contracts';

import { DomainError, normalizeError } from './errors.js';
import { assertTransition } from './lifecycle.js';
import { canonicalizeCapabilityEnvelope, canonicalizeExistingPath } from './path-policy.js';
import type { AuditRepository, Clock, IdGenerator, ProjectRepository, TaskRepository, TransactionManager, WorkerAdapter, WorkerHandle } from './ports.js';
import { decideVerdict } from './verdict.js';

type ActiveRun = {
  runId: string;
  controller: AbortController;
  handle: WorkerHandle;
  settled: Promise<void>;
};

export type IntentSmithCoreOptions = {
  clock: Clock;
  ids: IdGenerator;
  projects: ProjectRepository;
  tasks: TaskRepository;
  audit: AuditRepository;
  transactions: TransactionManager;
  worker: WorkerAdapter;
};

export class IntentSmithCore {
  private readonly activeRuns = new Map<string, ActiveRun>();

  constructor(private readonly options: IntentSmithCoreOptions) {}

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

  async startTask(taskId: string): Promise<Task> {
    const { task, run } = await this.transitionToRun(taskId, 'running');
    const controller = new AbortController();
    const handle = this.options.worker.start({ task, run, signal: controller.signal });
    const settled = this.finalizeWhenDone(task.id, run.id, handle, controller);
    void settled.catch(() => undefined);
    this.activeRuns.set(task.id, { runId: run.id, controller, handle, settled });
    return task;
  }

  async pauseTask(taskId: string): Promise<Task> {
    const task = await this.transitionTask(taskId, 'paused');
    const active = this.activeRuns.get(taskId);
    if (active) {
      await active.handle.pause();
      const run = await this.requireRun(active.runId);
      await this.options.tasks.updateRun({ ...run, status: 'paused' });
    }
    return task;
  }

  async resumeTask(taskId: string): Promise<Task> {
    const task = await this.transitionTask(taskId, 'running');
    const active = this.activeRuns.get(taskId);
    if (active) {
      await active.handle.resume();
      const run = await this.requireRun(active.runId);
      await this.options.tasks.updateRun({ ...run, status: 'running' });
    }
    return task;
  }

  async cancelTask(taskId: string): Promise<Task> {
    const task = await this.transitionTask(taskId, 'cancelled');
    const active = this.activeRuns.get(taskId);
    if (active) {
      active.controller.abort();
      await active.handle.cancel();
      const run = await this.requireRun(active.runId);
      await this.options.tasks.updateRun({ ...run, status: 'cancelled', endedAt: this.options.clock.now() });
      const result = decideVerdict({
        id: this.options.ids.next('result'),
        taskId,
        runId: active.runId,
        now: this.options.clock.now(),
        deterministicEvidence: [],
        cancelled: true,
      });
      await this.options.tasks.saveResult(result);
      this.activeRuns.delete(taskId);
    }
    return task;
  }

  async getTaskResult(taskId: string): Promise<TaskResult | null> {
    return await this.options.tasks.getResult(taskId);
  }

  async listAuditEvents(taskId: string): Promise<AuditEvent[]> {
    return await this.options.audit.listByTask(taskId);
  }

  async shutdown(): Promise<void> {
    const active = [...this.activeRuns.entries()];
    for (const [taskId] of active) {
      await this.cancelTask(taskId);
    }
    await Promise.allSettled(active.map(([, run]) => run.settled));
  }

  async waitForTask(taskId: string): Promise<Task> {
    const active = this.activeRuns.get(taskId);
    if (active) {
      await active.settled.catch(() => undefined);
    }
    return await this.getTask(taskId);
  }

  private async transitionToRun(taskId: string, to: 'running'): Promise<{ task: Task; run: TaskRun }> {
    let current: Task | undefined;
    try {
      return await this.options.transactions.transaction(async () => {
        current = await this.getTask(taskId);
        assertTransition(current.status, to);
        const now = this.options.clock.now();
        const run: TaskRun = {
          id: this.options.ids.next('run'),
          taskId,
          attempt: (await this.options.tasks.countRuns(taskId)) + 1,
          status: 'running',
          startedAt: now,
        };
        const task = { ...current, status: to, latestRunId: run.id, updatedAt: now };
        await this.options.tasks.createRun(run);
        await this.options.tasks.update(task);
        await this.appendAudit({
          projectId: task.projectId,
          taskId,
          runId: run.id,
          type: 'task.transition',
          message: `Task transitioned from ${current.status} to ${to}`,
          data: { from: current.status, to },
        });
        return { task, run };
      });
    } catch (error) {
      await this.auditRejectedTransition(current, to, error);
      throw error;
    }
  }

  private async transitionTask(taskId: string, to: Task['status']): Promise<Task> {
    let current: Task | undefined;
    try {
      return await this.options.transactions.transaction(async () => {
        current = await this.getTask(taskId);
        assertTransition(current.status, to);
        const task = { ...current, status: to, updatedAt: this.options.clock.now() };
        await this.options.tasks.update(task);
        await this.appendAudit({
          projectId: task.projectId,
          taskId,
          runId: task.latestRunId,
          type: 'task.transition',
          message: `Task transitioned from ${current.status} to ${to}`,
          data: { from: current.status, to },
        });
        return task;
      });
    } catch (error) {
      await this.auditRejectedTransition(current, to, error);
      throw error;
    }
  }

  private async auditRejectedTransition(task: Task | undefined, to: Task['status'], error: unknown): Promise<void> {
    if (task && error instanceof DomainError && error.code === 'INVALID_TASK_TRANSITION') {
      await this.appendAudit({
        projectId: task.projectId,
        taskId: task.id,
        runId: task.latestRunId,
        type: 'task.invalid_transition',
        message: error instanceof Error ? error.message : 'Invalid task transition',
        data: { from: task.status, to },
      });
    }
  }

  private async finalizeWhenDone(taskId: string, runId: string, handle: WorkerHandle, controller: AbortController): Promise<void> {
    const task = await this.getTask(taskId);
    let timeoutId: NodeJS.Timeout | undefined;
    const timeout = new Promise<'timeout'>(resolve => {
      timeoutId = setTimeout(() => resolve('timeout'), task.timeoutMs);
    });
    const outcome = await Promise.race([handle.done, timeout])
      .catch(error => ({
        events: [{ type: 'failed', error: normalizeError(error) }],
      }))
      .finally(() => {
        if (timeoutId) clearTimeout(timeoutId);
      });

    if (outcome === 'timeout') {
      controller.abort();
      await this.finalizeTask(taskId, runId, [], { code: 'WORKER_TIMEOUT', message: 'Worker timed out', retryable: true }, true, false);
      return;
    }
    await this.finalizeTask(taskId, runId, outcome.events, undefined, false, false);
  }

  private async finalizeTask(
    taskId: string,
    runId: string,
    rawEvents: unknown[],
    forcedError: NormalizedError | undefined,
    timedOut: boolean,
    cancelled: boolean,
  ): Promise<void> {
    await this.options.transactions.transaction(async () => {
      const task = await this.getTask(taskId);
      if (task.status === 'cancelled' || task.status === 'paused') return;

      const parsed = await this.collectWorkerEvents(task, runId, rawEvents);
      const result = decideVerdict({
        id: this.options.ids.next('result'),
        taskId,
        runId,
        now: this.options.clock.now(),
        workerClaim: parsed.claim,
        deterministicEvidence: parsed.evidence,
        artifacts: parsed.artifacts,
        diffs: parsed.diffs,
        workerError: forcedError ?? parsed.workerError,
        invalidWorkerEvent: parsed.invalidEvent,
        timedOut,
        cancelled,
      });
      const nextStatus = result.coreVerdict === 'pass' ? 'passed' : result.coreVerdict === 'cancelled' ? 'cancelled' : 'failed';
      const runStatus = timedOut ? 'timeout' : nextStatus;
      await this.options.tasks.updateRun({ ...(await this.requireRun(runId)), status: runStatus, endedAt: this.options.clock.now() });
      await this.options.tasks.update({ ...task, status: nextStatus, updatedAt: this.options.clock.now() });
      await this.options.tasks.saveResult(result);
      await this.appendAudit({
        projectId: task.projectId,
        taskId,
        runId,
        type: 'task.verdict',
        message: `Core verdict: ${result.coreVerdict}`,
        data: { verdict: result.coreVerdict, risks: result.unresolvedRisks },
      });
      this.activeRuns.delete(taskId);
    });
  }

  private async collectWorkerEvents(task: Task, runId: string, rawEvents: unknown[]): Promise<{
    evidence: Evidence[];
    artifacts: TaskResult['artifacts'];
    diffs: TaskResult['diffs'];
    claim?: WorkerClaim;
    workerError?: NormalizedError;
    invalidEvent: boolean;
  }> {
    const evidence: Evidence[] = [];
    const artifacts: TaskResult['artifacts'] = [];
    const diffs: TaskResult['diffs'] = [];
    let claim: WorkerClaim | undefined;
    let workerError: NormalizedError | undefined;
    let invalidEvent = false;

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
      if (event.type === 'completed') claim = event.claim;
      if (event.type === 'failed') workerError = event.error;
    }
    return { evidence, artifacts, diffs, claim, workerError, invalidEvent };
  }

  private async requireRun(runId: string): Promise<TaskRun> {
    const run = await this.options.tasks.getRun(runId);
    if (!run) throw new DomainError('TASK_RUN_NOT_FOUND', `Task run not found: ${runId}`);
    return run;
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
