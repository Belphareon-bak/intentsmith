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

export function canTransition(from: TaskStatus, to: TaskStatus): boolean {
  return ALLOWED_TRANSITIONS.get(from)?.has(to) ?? false;
}

export function assertTransition(from: TaskStatus, to: TaskStatus): void {
  if (!canTransition(from, to)) {
    throw new DomainError('INVALID_TASK_TRANSITION', `Cannot transition task from ${from} to ${to}`, false, { from, to });
  }
}
