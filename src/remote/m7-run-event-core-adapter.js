import { createHash } from 'node:crypto';

import { validateCoreEvent } from '../../contracts/m1/index.js';
import { canonicalizeM2ExecutionValue } from '../../contracts/m2/execution-v1.js';

export const M7_RUN_EVENT_CORE_ERROR = Object.freeze({
  INPUT_INVALID: 'M7_RUN_EVENT_INPUT_INVALID',
  RUN_NOT_AVAILABLE: 'REMOTE_EVENT_RUN_NOT_AVAILABLE',
  WINDOW_GONE: 'REMOTE_EVENT_WINDOW_GONE',
});

const IDENTIFIER = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u;
const DEFAULT_MAX_RUNS = 256;
const DEFAULT_MAX_EVENTS_PER_RUN = 256;
const MAX_CONFIGURED_BOUND = 10_000;
const adapterState = new WeakMap();

function plain(value) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function deepFreeze(value, seen = new Set()) {
  if (value === null || typeof value !== 'object' || seen.has(value)) return value;
  seen.add(value);
  for (const child of Object.values(value)) deepFreeze(child, seen);
  return Object.freeze(value);
}

function requireBound(value, label, fallback) {
  const resolved = value ?? fallback;
  if (!Number.isSafeInteger(resolved) || resolved < 1 || resolved > MAX_CONFIGURED_BOUND) {
    throw new TypeError(`m7-run-events:${label}-invalid`);
  }
  return resolved;
}

function requireFunction(value, label, fallback) {
  const resolved = value ?? fallback;
  if (typeof resolved !== 'function') throw new TypeError(`m7-run-events:${label}-invalid`);
  return resolved;
}

function requireIdentity(value, label) {
  if (!IDENTIFIER.test(value || '')) throw new TypeError(`m7-run-events:${label}-invalid`);
  return value;
}

function requireProjectId(value) {
  if (value === null || value === undefined) return null;
  if (!Number.isSafeInteger(value) || value < 1) {
    throw new TypeError('m7-run-events:project-id-invalid');
  }
  return value;
}

function canonicalTimestamp(milliseconds) {
  if (!Number.isSafeInteger(milliseconds) || milliseconds < 1) {
    throw new TypeError('m7-run-events:clock-invalid');
  }
  return new Date(milliseconds).toISOString();
}

function eventDigest(event) {
  return createHash('sha256')
    .update(canonicalizeM2ExecutionValue(event), 'utf8')
    .digest('hex');
}

function mapCoreEvent(event, projectId, occurredAt) {
  const progress = event.payload?.progressPercent;
  const progressPercent = Number.isSafeInteger(progress) && progress >= 0 && progress <= 100
    ? progress
    : null;
  const digest = eventDigest(event);
  return deepFreeze({
    eventId: `event:m1:${digest}`,
    runId: event.requestId,
    sequence: event.sequence,
    phase: event.phase,
    eventType: event.eventType,
    occurredAt,
    title: event.eventType,
    detail: null,
    progressPercent,
    terminalStatus: event.phase === 'terminal' ? event.terminalStatus : null,
    correlation: {
      conversationId: event.conversationId,
      turnId: event.turnId,
      projectId,
    },
  });
}

function readError(request, code, message) {
  return deepFreeze({
    contract: 'RunEventPage',
    version: 1,
    requestId: request.requestId,
    runId: request.runId,
    status: 'error',
    error: { code, message, retryable: false },
  });
}

function requireContext(value) {
  if (!plain(value) || !IDENTIFIER.test(value.subjectId || '')) {
    throw new TypeError('m7-run-events:trusted-context-invalid');
  }
  return value;
}

function runKey(subjectId, runId) {
  return `${subjectId}\u0000${runId}`;
}

function wakeRun(run) {
  const waiters = [...run.waiters];
  run.waiters.clear();
  for (const waiter of waiters) waiter();
}

function waitForRun(run, waitMs, setTimer, clearTimer) {
  if (waitMs === 0) return Promise.resolve();
  return new Promise(resolve => {
    let settled = false;
    let timer = null;
    const finish = () => {
      if (settled) return;
      settled = true;
      if (timer !== null) clearTimer(timer);
      run.waiters.delete(finish);
      resolve();
    };
    run.waiters.add(finish);
    timer = setTimer(finish, waitMs);
    if (settled && timer !== null) clearTimer(timer);
  });
}

function pageFromRun(request, run) {
  const firstSequence = run.events[0].event.sequence;
  const lastSequence = run.events.at(-1).event.sequence;
  const afterSequence = request.afterSeq ?? 0;
  if (afterSequence < firstSequence - 1) {
    return readError(
      request,
      M7_RUN_EVENT_CORE_ERROR.WINDOW_GONE,
      'The requested event window is no longer retained.',
    );
  }
  const events = run.events
    .filter(entry => entry.event.sequence > afterSequence)
    .slice(0, request.limit)
    .map(entry => entry.event);
  const nextAfterSeq = events.length > 0
    ? events.at(-1).sequence
    : Math.min(Math.max(afterSequence, firstSequence - 1), lastSequence);
  const caughtUp = nextAfterSeq >= lastSequence;
  return deepFreeze({
    contract: 'RunEventPage',
    version: 1,
    requestId: request.requestId,
    runId: request.runId,
    status: 'ok',
    events,
    windowStartSeq: firstSequence,
    windowEndSeq: lastSequence,
    nextAfterSeq,
    caughtUp,
    terminal: run.terminal && caughtUp,
  });
}

export function createM7RunEventCoreAdapter({
  clearTimeoutFn,
  maxEventsPerRun,
  maxRuns,
  now,
  setTimeoutFn,
} = {}) {
  const clock = requireFunction(now, 'clock', Date.now);
  const setTimer = requireFunction(setTimeoutFn, 'set-timeout', setTimeout);
  const clearTimer = requireFunction(clearTimeoutFn, 'clear-timeout', clearTimeout);
  const runLimit = requireBound(maxRuns, 'max-runs', DEFAULT_MAX_RUNS);
  const eventLimit = requireBound(
    maxEventsPerRun,
    'max-events-per-run',
    DEFAULT_MAX_EVENTS_PER_RUN,
  );
  const runs = new Map();
  let observationRevision = 0;

  function observeCoreEvent({ event, projectId = null, subjectId } = {}) {
    requireIdentity(subjectId, 'subject-id');
    const normalizedProjectId = requireProjectId(projectId);
    const validation = validateCoreEvent(event);
    if (!validation.valid) {
      throw new TypeError(`m7-run-events:core-event-invalid:${validation.errors.join(',')}`);
    }
    const key = runKey(subjectId, event.requestId);
    let run = runs.get(key);
    const digest = eventDigest(event);
    if (run) {
      const duplicate = run.events.find(entry => entry.event.sequence === event.sequence);
      if (duplicate) {
        if (duplicate.sourceDigest !== digest) {
          run.corrupt = true;
          wakeRun(run);
          return false;
        }
        return true;
      }
      if (run.corrupt || run.terminal || event.sequence !== run.lastObservedSequence + 1) {
        run.corrupt = true;
        wakeRun(run);
        return false;
      }
      if (run.projectId !== normalizedProjectId
        || run.conversationId !== event.conversationId
        || run.turnId !== event.turnId) {
        run.corrupt = true;
        wakeRun(run);
        return false;
      }
    } else {
      if (event.sequence !== 1) return false;
      run = {
        conversationId: event.conversationId,
        corrupt: false,
        events: [],
        lastObservedSequence: 0,
        projectId: normalizedProjectId,
        subjectId,
        terminal: false,
        touchedRevision: 0,
        turnId: event.turnId,
        waiters: new Set(),
      };
      runs.set(key, run);
    }
    const occurredAt = canonicalTimestamp(clock());
    run.events.push({ sourceDigest: digest, event: mapCoreEvent(event, normalizedProjectId, occurredAt) });
    run.lastObservedSequence = event.sequence;
    run.terminal = event.phase === 'terminal';
    run.touchedRevision = ++observationRevision;
    if (run.events.length > eventLimit) run.events.splice(0, run.events.length - eventLimit);
    wakeRun(run);

    while (runs.size > runLimit) {
      const oldest = [...runs.entries()]
        .filter(([, candidate]) => candidate.waiters.size === 0)
        .sort((left, right) => left[1].touchedRevision - right[1].touchedRevision)[0];
      if (!oldest) break;
      runs.delete(oldest[0]);
    }
    return true;
  }

  async function listRunEvents(request, trustedContext) {
    let context;
    try {
      context = requireContext(trustedContext);
    } catch {
      return readError(
        request,
        M7_RUN_EVENT_CORE_ERROR.INPUT_INVALID,
        'The trusted event context is invalid.',
      );
    }
    const key = runKey(context.subjectId, request.runId);
    let run = runs.get(key);
    if (!run || run.corrupt) {
      return readError(
        request,
        M7_RUN_EVENT_CORE_ERROR.RUN_NOT_AVAILABLE,
        'The requested run is not available.',
      );
    }
    let page = pageFromRun(request, run);
    const waitMs = request.waitMs ?? 0;
    if (page.status === 'ok' && page.caughtUp && !page.terminal && waitMs > 0) {
      await waitForRun(run, waitMs, setTimer, clearTimer);
      run = runs.get(key);
      if (!run || run.corrupt) {
        return readError(
          request,
          M7_RUN_EVENT_CORE_ERROR.RUN_NOT_AVAILABLE,
          'The requested run is not available.',
        );
      }
      page = pageFromRun(request, run);
    }
    return page;
  }

  const adapter = Object.freeze({
    handlers: Object.freeze({ 'run-event.list': listRunEvents }),
    listRunEvents,
    observeCoreEvent,
  });
  adapterState.set(adapter, { handlers: adapter.handlers });
  return adapter;
}

export function consumeM7RunEventCoreAdapter(adapter) {
  const state = adapterState.get(adapter);
  if (!state) throw new TypeError('m7-run-events:genuine-adapter-required');
  return state;
}

export default createM7RunEventCoreAdapter;
