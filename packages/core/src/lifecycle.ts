import type { TaskStatus } from '@intentsmith/contracts';

import { DomainError } from './errors.js';

export const TERMINAL_TASK_STATUSES: ReadonlySet<TaskStatus> = new Set(['passed', 'failed', 'cancelled']);

export const ALLOWED_TRANSITIONS: ReadonlyMap<TaskStatus, ReadonlySet<TaskStatus>> = new Map([
  ['pending', new Set(['running', 'cancelled'])],
  ['running', new Set(['paused', 'passed', 'failed', 'cancelled'])],
  ['paused', new Set(['running', 'cancelled'])],
  ['passed', new Set()],
  ['failed', new Set()],
  ['cancelled', new Set()],
]);

/**
 * Lifecycle commands are distinct from raw state transitions.
 *
 * `pending -> running` and `paused -> running` are both legal edges, but only
 * `start` may use the first and only `resume` may use the second. Validating
 * the edge alone (Phase 1 behaviour) let `resume` move a `pending` task into
 * `running` without ever creating a TaskRun or launching a worker, leaving the
 * task permanently stuck. ADR 0006 requires resume from `paused` only.
 */
export type LifecycleCommand = 'start' | 'pause' | 'resume' | 'cancel';

export const COMMAND_SOURCE_STATES: ReadonlyMap<LifecycleCommand, ReadonlySet<TaskStatus>> = new Map([
  ['start', new Set<TaskStatus>(['pending'])],
  ['pause', new Set<TaskStatus>(['running'])],
  ['resume', new Set<TaskStatus>(['paused'])],
  ['cancel', new Set<TaskStatus>(['pending', 'running', 'paused'])],
]);

export const COMMAND_TARGET_STATUS: ReadonlyMap<LifecycleCommand, TaskStatus> = new Map([
  ['start', 'running'],
  ['pause', 'paused'],
  ['resume', 'running'],
  ['cancel', 'cancelled'],
]);

export function isTerminal(status: TaskStatus): boolean {
  return TERMINAL_TASK_STATUSES.has(status);
}

export function canTransition(from: TaskStatus, to: TaskStatus): boolean {
  return ALLOWED_TRANSITIONS.get(from)?.has(to) ?? false;
}

export function assertTransition(from: TaskStatus, to: TaskStatus): void {
  if (!canTransition(from, to)) {
    throw new DomainError('INVALID_TASK_TRANSITION', `Cannot transition task from ${from} to ${to}`, false, { from, to });
  }
}

export function canRunCommand(command: LifecycleCommand, from: TaskStatus): boolean {
  return COMMAND_SOURCE_STATES.get(command)?.has(from) ?? false;
}

export function targetStatusFor(command: LifecycleCommand): TaskStatus {
  const target = COMMAND_TARGET_STATUS.get(command);
  if (!target) throw new DomainError('INVALID_TASK_TRANSITION', `Unknown lifecycle command: ${command}`);
  return target;
}

/**
 * Validates a lifecycle command against the current status and returns the
 * target status. Always throws `INVALID_TASK_TRANSITION` so that the API and
 * CLI surface a single stable error code for every rejected command.
 */
export function assertCommand(command: LifecycleCommand, from: TaskStatus): TaskStatus {
  const to = targetStatusFor(command);
  if (!canRunCommand(command, from)) {
    throw new DomainError(
      'INVALID_TASK_TRANSITION',
      `Cannot ${command} a task in status ${from}`,
      false,
      { command, from, to },
    );
  }
  assertTransition(from, to);
  return to;
}
