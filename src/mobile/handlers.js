// /m1 route handlers — B5.
// ==============================================================================
//
// Handlers run only *after* gateway-policy has authorized the request, so none
// of them re-checks the token.  They do re-check anything the policy cannot
// know: whether the operation key is a replay, whether an approval still binds
// to its payload, whether an upstream is reachable.
//
// Split of responsibility with the legacy server (PLAN.md §2 diagram):
//
//   reads  — requested through the core-owned RemoteCorePort. Its production
//            providers may project the shared WAL database, but the gateway
//            handler no longer owns those repository queries.
//   chat   — delegated upstream over loopback.  CRE, quality gates, and the
//            LLM live in the server process and stay its responsibility; the
//            gateway must not become a second place where chat is decided
//            (PLAN.md §2 rule 6: no existing contract is weakened for mobile).
//
// Every response goes through `withEnvelope`, which stamps the protocol version
// and the scopes actually in force (§8.7), or through `mobileError`, which
// carries a specific cause (§8.3).
//
// ==============================================================================

import {
  CURSOR_BACKWARD,
  MOBILE_ERRORS,
  PROTOCOL_VERSION,
  UNKNOWN_REASONS,
  decodeCursor,
  mobileError,
  normalizeUnknownReason,
  paginate,
  paginateBackward,
  versioned,
  withEnvelope,
} from './protocol.js';
import { claimPairingCode, getMobileDevice, listDevices, revokeDevice } from './pairing.js';
import { listMobileNotifications, ackMobileNotifications } from '../notifications/channels/mobile.js';
import { approvalIsBound, evaluateApprovalDecision, decisionState } from '../approvals/authority.js';

const DEFAULT_PAGE_SIZE = 25;
const MAX_PAGE_SIZE = 100;
const MAX_MESSAGE_LENGTH = 32_000;

// Browser-managed HTTP caches are outside the app's logical cache lifecycle.
// Approval list and decision results therefore carry an explicit transport
// directive without changing their frozen response bodies.
export const APPROVAL_RESPONSE_HEADERS = Object.freeze({ 'Cache-Control': 'no-store' });
export const DEVICE_RESPONSE_HEADERS = Object.freeze({ 'Cache-Control': 'no-store' });
export const SETTINGS_RESPONSE_HEADERS = Object.freeze({ 'Cache-Control': 'no-store' });
export const MEMORY_RESPONSE_HEADERS = Object.freeze({ 'Cache-Control': 'no-store' });
export const WORKER_RESPONSE_HEADERS = Object.freeze({ 'Cache-Control': 'no-store' });
export const SPECIALIST_RESPONSE_HEADERS = Object.freeze({ 'Cache-Control': 'no-store' });
export const PROJECT_CONVERSATION_RESPONSE_HEADERS = Object.freeze({ 'Cache-Control': 'no-store' });
export const CONVERSATION_RESPONSE_HEADERS = Object.freeze({ 'Cache-Control': 'no-store' });
export const NOTIFICATION_RESPONSE_HEADERS = Object.freeze({ 'Cache-Control': 'no-store' });

// ── GET /m1/health ───────────────────────────────────────────────────────────
//
// Public and deliberately minimal: it carries no conversation data, no device
// list, and no configuration.  Its only job is to let a client tell "network
// unreachable" apart from "server down" apart from "token rejected", which
// §8.3 requires and which no authenticated endpoint can do.

export async function handleHealth({ upstream }) {
  const upstreamState = await upstream.probe();
  return {
    status: 200,
    body: withEnvelope({
      status: 'ok',
      protocolVersion: PROTOCOL_VERSION,
      // Reported separately so a client sees a gateway that is up but cannot
      // reach the brain, rather than a blanket failure.
      upstream: upstreamState.reachable ? 'ok' : 'unreachable',
      upstreamDetail: upstreamState.reachable ? null : upstreamState.reason,
      time: new Date().toISOString(),
    }),
  };
}

// ── GET /m1/capabilities ─────────────────────────────────────────────────────

export async function handleCapabilities({ principal, upstream, corePort = null }) {
  const upstreamState = await upstream.probe();
  return {
    status: 200,
    body: withEnvelope({
      protocolVersion: PROTOCOL_VERSION,
      device: { id: principal.deviceId, name: principal.name },
      // §8.7 — the client's idea of its own scopes is refreshed from the
      // server on every capabilities read, so MD-12 cannot drift.
      scopes: principal.scopes,
      features: {
        chat: principal.scopes.includes('write:chat') && upstreamState.reachable,
        conversations: principal.scopes.includes('read:chat')
          && corePort?.capabilities(principal)?.features?.['conversations.read']?.status === 'available',
        projects: principal.scopes.includes('read:projects')
          && corePort?.capabilities(principal)?.features?.['projects.read']?.status === 'available',
        settings: principal.scopes.includes('read:settings')
          && corePort?.capabilities(principal)?.features?.['settings.read']?.status === 'available',
        settingsWrite: principal.scopes.includes('write:settings')
          && corePort?.capabilities(principal)?.features?.['settings.write']?.status === 'available',
        memory: principal.scopes.includes('read:memory')
          && corePort?.capabilities(principal)?.features?.['storedInformation.read']?.status === 'available',
        memoryWrite: principal.scopes.includes('write:memory')
          && corePort?.capabilities(principal)?.features?.['storedInformation.write']?.status === 'available',
        workers: principal.scopes.includes('read:workers')
          && corePort?.capabilities(principal)?.features?.['workers.read']?.status === 'available',
        workersWrite: principal.scopes.includes('write:workers')
          && corePort?.capabilities(principal)?.features?.['workers.toggle']?.status === 'available',
        specialists: principal.scopes.includes('read:specialists')
          && corePort?.capabilities(principal)?.features?.['specialists.read']?.status === 'available',
        devices: principal.scopes.includes('read:devices'),
        notifications: principal.scopes.includes('read:notifications'),
        approvals: principal.scopes.includes('read:approvals'),
        // Streaming does not exist upstream (PLAN.md §3): onLLMToken has no
        // producer.  Advertising it would make the client build a UI for a
        // capability the backend cannot deliver.
        streaming: false,
      },
      limits: { maxMessageLength: MAX_MESSAGE_LENGTH, pageSize: DEFAULT_PAGE_SIZE },
      upstream: upstreamState.reachable ? 'ok' : 'unreachable',
      // MM2: the versioned in-process connector is reported separately from
      // legacy booleans so old clients remain compatible and new clients can
      // distinguish unavailable providers from missing scopes.
      remoteCore: corePort?.capabilities(principal) ?? null,
    }, { principal }),
  };
}

// ── GET /m1/projects ────────────────────────────────────────────────────────

export async function handleProjects({ corePort, principal, query }) {
  const allowedParameters = new Set(['state', 'limit', 'cursor']);
  const seenParameters = new Set();
  for (const name of query.keys()) {
    if (!allowedParameters.has(name)) {
      return errorResponse(MOBILE_ERRORS.BAD_REQUEST, { reason: 'unknown_parameter', field: name });
    }
    if (seenParameters.has(name)) {
      return errorResponse(MOBILE_ERRORS.BAD_REQUEST, { reason: 'duplicate_parameter', field: name });
    }
    seenParameters.add(name);
  }

  const state = query.get('state') || 'active';
  if (state !== 'active' && state !== 'archived') {
    return errorResponse(MOBILE_ERRORS.BAD_REQUEST, {
      reason: 'state_invalid',
      allowed: ['active', 'archived'],
    });
  }

  const rawLimit = query.get('limit');
  if (rawLimit !== null && (!/^[1-9][0-9]*$/.test(rawLimit) || Number(rawLimit) > MAX_PAGE_SIZE)) {
    return errorResponse(MOBILE_ERRORS.BAD_REQUEST, {
      reason: 'limit_invalid',
      allowed: { min: 1, max: MAX_PAGE_SIZE },
    });
  }
  const limit = rawLimit === null ? 50 : Number(rawLimit);
  const stream = `projects:${state}`;
  const cursor = decodeCursor(query.get('cursor'), { stream });
  if (!cursor.valid) {
    return errorResponse(MOBILE_ERRORS.CURSOR_UNKNOWN, { reason: cursor.reason, restart: true });
  }

  const outcome = await invokeProjectRead(corePort, {
    operation: 'list',
    state,
    limit,
    offset: cursor.position,
  }, principal);
  if (!outcome.ok) return projectReadError(outcome.error);

  const page = paginate({
    rows: outcome.data.rows.map(project => versioned(project)),
    limit,
    stream,
    position: cursor.position,
  });
  return {
    status: 200,
    body: withEnvelope(page.items, {
      principal,
      extra: { hasMore: page.hasMore, nextCursor: page.nextCursor, end: page.end, state },
    }),
  };
}

// ── GET /m1/projects/:id ────────────────────────────────────────────────────

export async function handleProjectDetail({ corePort, principal, params }) {
  const outcome = await invokeProjectRead(corePort, {
    operation: 'detail',
    id: params.id,
  }, principal);
  if (!outcome.ok) return projectReadError(outcome.error);
  return {
    status: 200,
    body: withEnvelope(versioned(outcome.data.project), { principal }),
  };
}

async function invokeProjectRead(corePort, input, principal) {
  if (!corePort || typeof corePort.invoke !== 'function') {
    return { ok: false, error: { code: 'capability_unavailable' } };
  }
  try {
    return await corePort.invoke({
      version: 1,
      feature: 'projects.read',
      input,
      principal,
    });
  } catch (error) {
    return { ok: false, error: { code: error?.code || 'provider_failure' } };
  }
}

function projectReadError(error) {
  if (error?.code === 'not_found') {
    return errorResponse(MOBILE_ERRORS.NOT_FOUND, { resource: 'project' });
  }
  if (error?.code === 'project_id_invalid' || error?.code === 'state_invalid'
      || error?.code === 'limit_invalid' || error?.code === 'cursor_invalid'
      || error?.code === 'operation_invalid') {
    return errorResponse(MOBILE_ERRORS.BAD_REQUEST, { reason: error.code });
  }
  if (error?.code === 'capability_forbidden') {
    return errorResponse(MOBILE_ERRORS.SCOPE_REQUIRED, { requiredScope: 'read:projects' });
  }
  return errorResponse(MOBILE_ERRORS.SERVER_UNAVAILABLE, {
    reason: error?.code || 'projects_provider_unavailable',
  });
}

// ── GET /m1/settings ────────────────────────────────────────────────────────

export async function handleSettings({ corePort, principal, query }) {
  const firstParameter = query.keys().next();
  if (!firstParameter.done) {
    return settingsResponse(errorResponse(MOBILE_ERRORS.BAD_REQUEST, {
      reason: 'unknown_parameter',
      field: firstParameter.value,
    }));
  }

  let outcome;
  try {
    outcome = await corePort?.invoke({
      version: 1,
      feature: 'settings.read',
      input: { operation: 'read' },
      principal,
    }) ?? { ok: false, error: { code: 'capability_unavailable' } };
  } catch (error) {
    outcome = { ok: false, error: { code: error?.code || 'provider_failure' } };
  }

  if (!outcome.ok) {
    if (outcome.error?.code === 'capability_forbidden') {
      return settingsResponse(errorResponse(MOBILE_ERRORS.SCOPE_REQUIRED, { requiredScope: 'read:settings' }));
    }
    if (outcome.error?.code === 'operation_invalid') {
      return settingsResponse(errorResponse(MOBILE_ERRORS.BAD_REQUEST, { reason: outcome.error.code }));
    }
    return settingsResponse(errorResponse(MOBILE_ERRORS.SERVER_UNAVAILABLE, {
      reason: outcome.error?.code || 'settings_provider_unavailable',
    }));
  }

  return {
    status: 200,
    headers: SETTINGS_RESPONSE_HEADERS,
    body: withEnvelope(versioned(outcome.data), { principal }),
  };
}

function settingsResponse(result) {
  return { ...result, headers: SETTINGS_RESPONSE_HEADERS };
}

function settingsOperationResponse({ operationId, record, principal, replayed = false }) {
  const open = record.state === 'PENDING' || record.state === 'UNKNOWN';
  return {
    status: open ? 202 : 200,
    headers: SETTINGS_RESPONSE_HEADERS,
    body: withEnvelope(
      { operationId, state: record.state, result: record.result },
      { principal, extra: replayed ? { replayed: true } : {} },
    ),
  };
}

function rejectSettingsOperation(journal, principal, operationId, errorCode, result = null) {
  try {
    return journal.reject(principal.deviceId, operationId, errorCode, result);
  } catch {
    return { resolved: false, current: { known: true, state: 'UNKNOWN', result: null } };
  }
}

function settingsUnknownResponse(journal, principal, operationId, reason) {
  try { journal.markUnknown(principal.deviceId, operationId, reason); } catch { /* no durable answer */ }
  return settingsResponse(errorResponse(MOBILE_ERRORS.SERVER_UNAVAILABLE, {
    reason,
    operationId,
    state: 'UNKNOWN',
    resolveBy: `GET /m1/operations/${operationId}`,
  }));
}

// ── PUT /m1/settings ───────────────────────────────────────────────────────
//
// One user intent writes one allow-listed UX preference. The expected
// revision prevents a phone from overwriting a newer desktop edit, and the
// operation key prevents a lost response from turning into a second write.

export async function handleSettingsWrite({ corePort, journal, principal, body }) {
  const keys = body && typeof body === 'object' && !Array.isArray(body)
    ? Object.keys(body).sort()
    : [];
  const exact = keys.length === 4
    && keys[0] === 'expectedRevision'
    && keys[1] === 'operationId'
    && keys[2] === 'path'
    && keys[3] === 'value';
  if (!exact) {
    return settingsResponse(errorResponse(MOBILE_ERRORS.BAD_REQUEST, {
      reason: 'body_shape_invalid',
    }));
  }

  const { operationId, expectedRevision, path, value } = body;
  if (!operationId) {
    return settingsResponse(errorResponse(MOBILE_ERRORS.BAD_REQUEST, {
      field: 'operationId', reason: 'required',
    }));
  }
  if (!Number.isSafeInteger(expectedRevision) || expectedRevision < 1) {
    return settingsResponse(errorResponse(MOBILE_ERRORS.BAD_REQUEST, {
      field: 'expectedRevision', reason: 'invalid',
    }));
  }
  if (typeof path !== 'string' || path.length === 0) {
    return settingsResponse(errorResponse(MOBILE_ERRORS.BAD_REQUEST, {
      field: 'path', reason: 'invalid',
    }));
  }

  const claim = journal.begin({
    deviceId: principal.deviceId,
    operationId,
    operationType: 'settings.write',
    request: { expectedRevision, path, value },
  });
  if (claim.outcome === 'conflict') {
    const descriptor = claim.reason === 'fingerprint_mismatch'
      ? MOBILE_ERRORS.OPERATION_CONFLICT
      : MOBILE_ERRORS.BAD_REQUEST;
    return settingsResponse(errorResponse(descriptor, {
      reason: claim.reason, operationId,
    }));
  }
  if (claim.outcome === 'limited') {
    return settingsResponse(errorResponse(
      claim.reason === 'open_operation_cap' ? MOBILE_ERRORS.OPERATION_LIMIT : MOBILE_ERRORS.RATE_LIMITED,
      { reason: claim.reason, openOperations: journal.openOperations(principal.deviceId) },
    ));
  }
  if (claim.outcome === 'replay') {
    return settingsOperationResponse({ operationId, record: claim.record, principal, replayed: true });
  }

  let outcome;
  try {
    outcome = await corePort?.invoke({
      version: 1,
      feature: 'settings.write',
      input: { operation: 'write', expectedRevision, path, value },
      principal,
    }) ?? { ok: false, error: { code: 'capability_unavailable' } };
  } catch (error) {
    const definitelyNotDispatched = [
      'capability_unavailable', 'capability_forbidden', 'capability_unknown',
      'contract_version_unsupported', 'input_invalid',
    ].includes(error?.code);
    if (!definitelyNotDispatched) {
      return settingsUnknownResponse(
        journal, principal, operationId, UNKNOWN_REASONS.GATEWAY_EXCEPTION,
      );
    }
    outcome = { ok: false, error: { code: error.code } };
  }

  if (!outcome.ok) {
    const code = outcome.error?.code || 'settings_write_failed';
    const rejectedResult = code === 'settings_revision_conflict'
      ? { currentRevision: outcome.error?.details?.currentRevision ?? null }
      : null;
    const resolution = rejectSettingsOperation(
      journal, principal, operationId, code, rejectedResult,
    );
    if (!resolution.resolved && resolution.current?.state === 'UNKNOWN') {
      return settingsUnknownResponse(
        journal, principal, operationId, UNKNOWN_REASONS.RESULT_PERSISTENCE_FAILED,
      );
    }
    if (!resolution.resolved && resolution.current?.known) {
      return settingsOperationResponse({ operationId, record: resolution.current, principal });
    }
    if (code === 'settings_revision_conflict') {
      return settingsResponse(errorResponse(MOBILE_ERRORS.STATE_CONFLICT, {
        reason: code,
        operationId,
        state: 'REJECTED',
        currentRevision: rejectedResult.currentRevision,
      }));
    }
    if (['operation_invalid', 'settings_revision_invalid', 'setting_path_invalid', 'setting_value_invalid'].includes(code)) {
      return settingsResponse(errorResponse(MOBILE_ERRORS.BAD_REQUEST, {
        reason: code, operationId, state: 'REJECTED',
      }));
    }
    if (code === 'capability_forbidden') {
      return settingsResponse(errorResponse(MOBILE_ERRORS.SCOPE_REQUIRED, {
        requiredScope: 'write:settings', operationId, state: 'REJECTED',
      }));
    }
    return settingsResponse(errorResponse(MOBILE_ERRORS.SERVER_UNAVAILABLE, {
      reason: code, operationId, state: 'REJECTED',
    }));
  }

  const result = outcome.data;
  const resultKeys = result && typeof result === 'object' && !Array.isArray(result)
    ? Object.keys(result).sort()
    : [];
  const validResult = resultKeys.length === 3
    && resultKeys[0] === 'path'
    && resultKeys[1] === 'revision'
    && resultKeys[2] === 'value'
    && result.revision === expectedRevision + 1
    && result.path === path
    && Object.is(result.value, value);
  if (!validResult) {
    // A provider can only know this result after attempting the transaction.
    // Treat a malformed success as ambiguous; never persist or return it as a
    // confirmed effect merely because it arrived in a `{ok:true}` envelope.
    return settingsUnknownResponse(
      journal, principal, operationId, UNKNOWN_REASONS.GATEWAY_EXCEPTION,
    );
  }
  try {
    const resolution = journal.confirm(principal.deviceId, operationId, result);
    if (!resolution.resolved) {
      return settingsOperationResponse({ operationId, record: resolution.current, principal });
    }
  } catch {
    return settingsUnknownResponse(
      journal, principal, operationId, UNKNOWN_REASONS.RESULT_PERSISTENCE_FAILED,
    );
  }

  return {
    status: 200,
    headers: SETTINGS_RESPONSE_HEADERS,
    body: withEnvelope({ operationId, state: 'CONFIRMED', result }, { principal }),
  };
}

// ── GET /m1/memory ──────────────────────────────────────────────────────────

export async function handleStoredInformation({ corePort, principal, query }) {
  const allowedParameters = new Set(['kind', 'limit', 'cursor']);
  const seenParameters = new Set();
  for (const name of query.keys()) {
    if (!allowedParameters.has(name)) {
      return errorResponse(MOBILE_ERRORS.BAD_REQUEST, { reason: 'unknown_parameter', field: name });
    }
    if (seenParameters.has(name)) {
      return errorResponse(MOBILE_ERRORS.BAD_REQUEST, { reason: 'duplicate_parameter', field: name });
    }
    seenParameters.add(name);
  }

  const kind = query.get('kind') || 'all';
  if (!['all', 'ltm', 'task'].includes(kind)) {
    return errorResponse(MOBILE_ERRORS.BAD_REQUEST, {
      reason: 'kind_invalid', allowed: ['all', 'ltm', 'task'],
    });
  }
  const rawLimit = query.get('limit');
  if (rawLimit !== null && (!/^[1-9][0-9]*$/.test(rawLimit) || Number(rawLimit) > MAX_PAGE_SIZE)) {
    return errorResponse(MOBILE_ERRORS.BAD_REQUEST, {
      reason: 'limit_invalid', allowed: { min: 1, max: MAX_PAGE_SIZE },
    });
  }
  const limit = rawLimit === null ? 50 : Number(rawLimit);
  const stream = `stored-information:${kind}`;
  const cursor = decodeCursor(query.get('cursor'), { stream });
  if (!cursor.valid) {
    return errorResponse(MOBILE_ERRORS.CURSOR_UNKNOWN, { reason: cursor.reason, restart: true });
  }

  let outcome;
  try {
    outcome = await corePort?.invoke({
      version: 1,
      feature: 'storedInformation.read',
      input: { operation: 'list', kind, limit, offset: cursor.position },
      principal,
    }) ?? { ok: false, error: { code: 'capability_unavailable' } };
  } catch (error) {
    outcome = { ok: false, error: { code: error?.code || 'provider_failure' } };
  }

  if (!outcome.ok) {
    if (outcome.error?.code === 'capability_forbidden') {
      return errorResponse(MOBILE_ERRORS.SCOPE_REQUIRED, { requiredScope: 'read:memory' });
    }
    if (['operation_invalid', 'kind_invalid', 'limit_invalid', 'cursor_invalid'].includes(outcome.error?.code)) {
      return errorResponse(MOBILE_ERRORS.BAD_REQUEST, { reason: outcome.error.code });
    }
    return errorResponse(MOBILE_ERRORS.SERVER_UNAVAILABLE, {
      reason: outcome.error?.code || 'stored_information_provider_unavailable',
    });
  }

  const page = paginate({
    rows: outcome.data.rows.map(record => versioned(record)),
    limit,
    stream,
    position: cursor.position,
  });
  return {
    status: 200,
    body: withEnvelope(page.items, {
      principal,
      extra: { hasMore: page.hasMore, nextCursor: page.nextCursor, end: page.end, kind },
    }),
  };
}

function memoryResponse(result) {
  return { ...result, headers: MEMORY_RESPONSE_HEADERS };
}

function memoryOperationResponse({ operationId, record, principal, replayed = false }) {
  const open = record.state === 'PENDING' || record.state === 'UNKNOWN';
  return {
    status: open ? 202 : 200,
    headers: MEMORY_RESPONSE_HEADERS,
    body: withEnvelope(
      { operationId, state: record.state, result: record.result },
      { principal, extra: replayed ? { replayed: true } : {} },
    ),
  };
}

function memoryUnknownResponse(journal, principal, operationId, reason) {
  try { journal.markUnknown(principal.deviceId, operationId, reason); } catch { /* no durable answer */ }
  return memoryResponse(errorResponse(MOBILE_ERRORS.SERVER_UNAVAILABLE, {
    reason,
    operationId,
    state: 'UNKNOWN',
    resolveBy: `GET /m1/operations/${operationId}`,
  }));
}

// ── POST /m1/memory ────────────────────────────────────────────────────────
//
// Manual memory is create-only. Task/execution memory, replacement and delete
// remain outside the mobile surface.

export async function handleStoredInformationWrite({ corePort, journal, principal, body }) {
  const keys = body && typeof body === 'object' && !Array.isArray(body)
    ? Object.keys(body).sort()
    : [];
  const exact = keys.length === 4
    && keys[0] === 'category'
    && keys[1] === 'key'
    && keys[2] === 'operationId'
    && keys[3] === 'value';
  if (!exact) {
    return memoryResponse(errorResponse(MOBILE_ERRORS.BAD_REQUEST, {
      reason: 'body_shape_invalid',
    }));
  }

  const { operationId, category, key, value } = body;
  if (!operationId) {
    return memoryResponse(errorResponse(MOBILE_ERRORS.BAD_REQUEST, {
      field: 'operationId', reason: 'required',
    }));
  }
  if (typeof category !== 'string' || typeof key !== 'string' || typeof value !== 'string') {
    return memoryResponse(errorResponse(MOBILE_ERRORS.BAD_REQUEST, {
      reason: 'memory_input_invalid',
    }));
  }

  const claim = journal.begin({
    deviceId: principal.deviceId,
    operationId,
    operationType: 'memory.create',
    request: { category, key, value },
  });
  if (claim.outcome === 'conflict') {
    const descriptor = claim.reason === 'fingerprint_mismatch'
      ? MOBILE_ERRORS.OPERATION_CONFLICT
      : MOBILE_ERRORS.BAD_REQUEST;
    return memoryResponse(errorResponse(descriptor, {
      reason: claim.reason, operationId,
    }));
  }
  if (claim.outcome === 'limited') {
    return memoryResponse(errorResponse(
      claim.reason === 'open_operation_cap' ? MOBILE_ERRORS.OPERATION_LIMIT : MOBILE_ERRORS.RATE_LIMITED,
      { reason: claim.reason, openOperations: journal.openOperations(principal.deviceId) },
    ));
  }
  if (claim.outcome === 'replay') {
    return memoryOperationResponse({ operationId, record: claim.record, principal, replayed: true });
  }

  let outcome;
  try {
    outcome = await corePort?.invoke({
      version: 1,
      feature: 'storedInformation.write',
      input: { operation: 'create', category, key, value },
      principal,
    }) ?? { ok: false, error: { code: 'capability_unavailable' } };
  } catch (error) {
    const definitelyNotDispatched = [
      'capability_unavailable', 'capability_forbidden', 'capability_unknown',
      'contract_version_unsupported', 'input_invalid',
    ].includes(error?.code);
    if (!definitelyNotDispatched) {
      return memoryUnknownResponse(
        journal, principal, operationId, UNKNOWN_REASONS.GATEWAY_EXCEPTION,
      );
    }
    outcome = { ok: false, error: { code: error.code } };
  }

  if (!outcome.ok) {
    const code = outcome.error?.code || 'stored_information_write_failed';
    let resolution;
    try {
      resolution = journal.reject(principal.deviceId, operationId, code);
    } catch {
      return memoryUnknownResponse(
        journal, principal, operationId, UNKNOWN_REASONS.RESULT_PERSISTENCE_FAILED,
      );
    }
    if (!resolution.resolved && resolution.current?.state === 'UNKNOWN') {
      return memoryUnknownResponse(
        journal, principal, operationId, UNKNOWN_REASONS.RESULT_PERSISTENCE_FAILED,
      );
    }
    if (!resolution.resolved && resolution.current?.known) {
      return memoryOperationResponse({ operationId, record: resolution.current, principal });
    }
    if (code === 'memory_key_conflict') {
      return memoryResponse(errorResponse(MOBILE_ERRORS.STATE_CONFLICT, {
        reason: code, operationId, state: 'REJECTED',
      }));
    }
    if (['operation_invalid', 'memory_category_invalid', 'memory_key_invalid', 'memory_value_invalid'].includes(code)) {
      return memoryResponse(errorResponse(MOBILE_ERRORS.BAD_REQUEST, {
        reason: code, operationId, state: 'REJECTED',
      }));
    }
    if (code === 'capability_forbidden') {
      return memoryResponse(errorResponse(MOBILE_ERRORS.SCOPE_REQUIRED, {
        requiredScope: 'write:memory', operationId, state: 'REJECTED',
      }));
    }
    return memoryResponse(errorResponse(MOBILE_ERRORS.SERVER_UNAVAILABLE, {
      reason: code, operationId, state: 'REJECTED',
    }));
  }

  const result = outcome.data;
  const resultKeys = result && typeof result === 'object' && !Array.isArray(result)
    ? Object.keys(result).sort()
    : [];
  const validResult = resultKeys.length === 4
    && resultKeys[0] === 'category'
    && resultKeys[1] === 'id'
    && resultKeys[2] === 'key'
    && resultKeys[3] === 'kind'
    && result.category === category
    && result.key === key
    && result.kind === 'ltm'
    && result.id === `ltm:mem_default_${category}_${key}`;
  if (!validResult) {
    return memoryUnknownResponse(
      journal, principal, operationId, UNKNOWN_REASONS.GATEWAY_EXCEPTION,
    );
  }

  try {
    const resolution = journal.confirm(principal.deviceId, operationId, result);
    if (!resolution.resolved) {
      return memoryOperationResponse({ operationId, record: resolution.current, principal });
    }
  } catch {
    return memoryUnknownResponse(
      journal, principal, operationId, UNKNOWN_REASONS.RESULT_PERSISTENCE_FAILED,
    );
  }

  return {
    status: 200,
    headers: MEMORY_RESPONSE_HEADERS,
    body: withEnvelope({ operationId, state: 'CONFIRMED', result }, { principal }),
  };
}

// ── GET /m1/workers and /m1/specialists ─────────────────────────────────────

async function handleConfiguredResourceList({
  corePort,
  principal,
  query,
  feature,
  scope,
  stream,
  unavailableReason,
}) {
  const allowedParameters = new Set(['limit', 'cursor']);
  const seenParameters = new Set();
  for (const name of query.keys()) {
    if (!allowedParameters.has(name)) {
      return errorResponse(MOBILE_ERRORS.BAD_REQUEST, { reason: 'unknown_parameter', field: name });
    }
    if (seenParameters.has(name)) {
      return errorResponse(MOBILE_ERRORS.BAD_REQUEST, { reason: 'duplicate_parameter', field: name });
    }
    seenParameters.add(name);
  }

  const rawLimit = query.get('limit');
  if (rawLimit !== null && (!/^[1-9][0-9]*$/.test(rawLimit) || Number(rawLimit) > MAX_PAGE_SIZE)) {
    return errorResponse(MOBILE_ERRORS.BAD_REQUEST, {
      reason: 'limit_invalid', allowed: { min: 1, max: MAX_PAGE_SIZE },
    });
  }
  const limit = rawLimit === null ? 50 : Number(rawLimit);
  const cursor = decodeCursor(query.get('cursor'), { stream });
  if (!cursor.valid) {
    return errorResponse(MOBILE_ERRORS.CURSOR_UNKNOWN, { reason: cursor.reason, restart: true });
  }

  let outcome;
  try {
    outcome = await corePort?.invoke({
      version: 1,
      feature,
      input: { operation: 'list', limit, offset: cursor.position },
      principal,
    }) ?? { ok: false, error: { code: 'capability_unavailable' } };
  } catch (error) {
    outcome = { ok: false, error: { code: error?.code || 'provider_failure' } };
  }

  if (!outcome.ok) {
    if (outcome.error?.code === 'capability_forbidden') {
      return errorResponse(MOBILE_ERRORS.SCOPE_REQUIRED, { requiredScope: scope });
    }
    if (['operation_invalid', 'limit_invalid', 'cursor_invalid'].includes(outcome.error?.code)) {
      return errorResponse(MOBILE_ERRORS.BAD_REQUEST, { reason: outcome.error.code });
    }
    return errorResponse(MOBILE_ERRORS.SERVER_UNAVAILABLE, {
      reason: outcome.error?.code || unavailableReason,
    });
  }

  const page = paginate({
    rows: outcome.data.rows.map(record => versioned(record)),
    limit,
    stream,
    position: cursor.position,
  });
  return {
    status: 200,
    body: withEnvelope(page.items, {
      principal,
      extra: { hasMore: page.hasMore, nextCursor: page.nextCursor, end: page.end },
    }),
  };
}

export async function handleWorkers(args) {
  return handleConfiguredResourceList({
    ...args,
    feature: 'workers.read',
    scope: 'read:workers',
    stream: 'workers',
    unavailableReason: 'workers_provider_unavailable',
  });
}

// ── GET /m1/workers/:id/runs ───────────────────────────────────────────────
//
// Metadata-only terminal history. Running rows, logs, explain records, error
// text and trigger identities are deliberately absent from the projection.
export async function handleWorkerRuns({ corePort, principal, params, query }) {
  const allowedParameters = new Set(['limit', 'cursor']);
  const seenParameters = new Set();
  for (const name of query.keys()) {
    if (!allowedParameters.has(name)) {
      return workerResponse(errorResponse(MOBILE_ERRORS.BAD_REQUEST, {
        reason: 'unknown_parameter', field: name,
      }));
    }
    if (seenParameters.has(name)) {
      return workerResponse(errorResponse(MOBILE_ERRORS.BAD_REQUEST, {
        reason: 'duplicate_parameter', field: name,
      }));
    }
    seenParameters.add(name);
  }

  const id = params?.id;
  if (
    typeof id !== 'string'
    || id.length < 1
    || id.length > 128
    || id !== id.trim()
    || /[\u0000-\u001f\u007f]/u.test(id)
  ) {
    return workerResponse(errorResponse(MOBILE_ERRORS.BAD_REQUEST, {
      reason: 'worker_id_invalid',
    }));
  }

  const rawLimit = query.get('limit');
  if (rawLimit !== null && (!/^[1-9][0-9]*$/.test(rawLimit) || Number(rawLimit) > MAX_PAGE_SIZE)) {
    return workerResponse(errorResponse(MOBILE_ERRORS.BAD_REQUEST, {
      reason: 'limit_invalid', allowed: { min: 1, max: MAX_PAGE_SIZE },
    }));
  }
  const limit = rawLimit === null ? 20 : Number(rawLimit);
  const stream = `worker-runs:${id}`;
  const cursor = decodeCursor(query.get('cursor'), { stream });
  if (!cursor.valid || (!cursor.initial && cursor.direction !== CURSOR_BACKWARD)) {
    return workerResponse(errorResponse(MOBILE_ERRORS.CURSOR_UNKNOWN, {
      reason: cursor.valid ? 'cursor_direction_mismatch' : cursor.reason,
      restart: true,
    }));
  }

  let outcome;
  try {
    outcome = await corePort?.invoke({
      version: 1,
      feature: 'workers.read',
      input: {
        operation: 'history',
        id,
        limit,
        end: cursor.initial ? null : cursor.position,
      },
      principal,
    }) ?? { ok: false, error: { code: 'capability_unavailable' } };
  } catch (error) {
    outcome = { ok: false, error: { code: error?.code || 'provider_failure' } };
  }

  if (!outcome.ok) {
    if (outcome.error?.code === 'capability_forbidden') {
      return workerResponse(errorResponse(MOBILE_ERRORS.SCOPE_REQUIRED, {
        requiredScope: 'read:workers',
      }));
    }
    if (outcome.error?.code === 'not_found') {
      return workerResponse(errorResponse(MOBILE_ERRORS.NOT_FOUND, { resource: 'worker' }));
    }
    if (outcome.error?.code === 'cursor_invalid') {
      return workerResponse(errorResponse(MOBILE_ERRORS.CURSOR_UNKNOWN, {
        reason: 'cursor_position_invalid', restart: true,
      }));
    }
    if (['operation_invalid', 'worker_id_invalid', 'limit_invalid'].includes(outcome.error?.code)) {
      return workerResponse(errorResponse(MOBILE_ERRORS.BAD_REQUEST, {
        reason: outcome.error.code,
      }));
    }
    return workerResponse(errorResponse(MOBILE_ERRORS.SERVER_UNAVAILABLE, {
      reason: outcome.error?.code || 'workers_provider_unavailable',
    }));
  }

  const page = paginateBackward({
    rows: outcome.data.rows.slice().reverse().map(record => versioned(record)),
    stream,
    start: outcome.data.start,
  });
  return {
    status: 200,
    headers: WORKER_RESPONSE_HEADERS,
    body: withEnvelope({
      worker: versioned(outcome.data.worker),
      runs: page.items,
    }, {
      principal,
      extra: {
        hasMore: page.hasMore,
        nextCursor: page.nextCursor,
        end: page.end,
        direction: CURSOR_BACKWARD,
      },
    }),
  };
}

function workerResponse(result) {
  return { ...result, headers: WORKER_RESPONSE_HEADERS };
}

function workerOperationResponse({ operationId, record, principal, replayed = false }) {
  const open = record.state === 'PENDING' || record.state === 'UNKNOWN';
  return {
    status: open ? 202 : 200,
    headers: WORKER_RESPONSE_HEADERS,
    body: withEnvelope(
      { operationId, state: record.state, result: record.result },
      { principal, extra: replayed ? { replayed: true } : {} },
    ),
  };
}

function workerUnknownResponse(journal, principal, operationId, reason) {
  try { journal.markUnknown(principal.deviceId, operationId, reason); } catch { /* no durable answer */ }
  return workerResponse(errorResponse(MOBILE_ERRORS.SERVER_UNAVAILABLE, {
    reason,
    operationId,
    state: 'UNKNOWN',
    resolveBy: `GET /m1/operations/${operationId}`,
  }));
}

// ── PUT /m1/workers/:id/enabled ────────────────────────────────────────────
//
// The gateway owns the operation journal, while AgentRepository +
// AgentScheduler in the live legacy process remain the lifecycle authority.
export async function handleWorkerToggle({ corePort, journal, principal, params, body }) {
  const keys = body && typeof body === 'object' && !Array.isArray(body)
    ? Object.keys(body).sort()
    : [];
  const exact = keys.length === 3
    && keys[0] === 'enabled'
    && keys[1] === 'expectedEnabled'
    && keys[2] === 'operationId';
  if (!exact) {
    return workerResponse(errorResponse(MOBILE_ERRORS.BAD_REQUEST, {
      reason: 'body_shape_invalid',
    }));
  }

  const id = params?.id;
  const { operationId, expectedEnabled, enabled } = body;
  if (!operationId) {
    return workerResponse(errorResponse(MOBILE_ERRORS.BAD_REQUEST, {
      field: 'operationId', reason: 'required',
    }));
  }
  if (
    typeof id !== 'string'
    || id.length < 1
    || id.length > 128
    || id !== id.trim()
    || /[\u0000-\u001f\u007f]/u.test(id)
    || typeof expectedEnabled !== 'boolean'
    || typeof enabled !== 'boolean'
    || expectedEnabled === enabled
  ) {
    return workerResponse(errorResponse(MOBILE_ERRORS.BAD_REQUEST, {
      reason: 'worker_transition_invalid',
    }));
  }

  const claim = journal.begin({
    deviceId: principal.deviceId,
    operationId,
    operationType: 'worker.toggle',
    request: { id, expectedEnabled, enabled },
  });
  if (claim.outcome === 'conflict') {
    const descriptor = claim.reason === 'fingerprint_mismatch'
      ? MOBILE_ERRORS.OPERATION_CONFLICT
      : MOBILE_ERRORS.BAD_REQUEST;
    return workerResponse(errorResponse(descriptor, { reason: claim.reason, operationId }));
  }
  if (claim.outcome === 'limited') {
    return workerResponse(errorResponse(
      claim.reason === 'open_operation_cap' ? MOBILE_ERRORS.OPERATION_LIMIT : MOBILE_ERRORS.RATE_LIMITED,
      { reason: claim.reason, openOperations: journal.openOperations(principal.deviceId) },
    ));
  }
  if (claim.outcome === 'replay') {
    return workerOperationResponse({ operationId, record: claim.record, principal, replayed: true });
  }

  let outcome;
  try {
    outcome = await corePort?.invoke({
      version: 1,
      feature: 'workers.toggle',
      input: { operation: 'setEnabled', id, expectedEnabled, enabled },
      principal,
    }) ?? { ok: false, error: { code: 'capability_unavailable', details: { decided: true } } };
  } catch (error) {
    const definitelyNotDispatched = [
      'capability_unavailable', 'capability_forbidden', 'capability_unknown',
      'contract_version_unsupported', 'input_invalid',
    ].includes(error?.code);
    if (!definitelyNotDispatched) {
      return workerUnknownResponse(
        journal, principal, operationId, UNKNOWN_REASONS.GATEWAY_EXCEPTION,
      );
    }
    outcome = { ok: false, error: { code: error.code, details: { decided: true } } };
  }

  if (!outcome.ok && outcome.error?.details?.decided !== true) {
    return workerUnknownResponse(
      journal, principal, operationId, normalizeUnknownReason(outcome.error?.code),
    );
  }

  if (!outcome.ok) {
    const code = outcome.error?.code || 'worker_toggle_failed';
    let resolution;
    try {
      resolution = journal.reject(principal.deviceId, operationId, code);
    } catch {
      return workerUnknownResponse(
        journal, principal, operationId, UNKNOWN_REASONS.RESULT_PERSISTENCE_FAILED,
      );
    }
    if (!resolution.resolved && resolution.current?.state === 'UNKNOWN') {
      return workerUnknownResponse(
        journal, principal, operationId, UNKNOWN_REASONS.RESULT_PERSISTENCE_FAILED,
      );
    }
    if (!resolution.resolved && resolution.current?.known) {
      return workerOperationResponse({ operationId, record: resolution.current, principal });
    }
    if (code === 'worker_state_conflict') {
      return workerResponse(errorResponse(MOBILE_ERRORS.STATE_CONFLICT, {
        reason: code, operationId, state: 'REJECTED',
      }));
    }
    if (code === 'worker_not_found') {
      return workerResponse(errorResponse(MOBILE_ERRORS.NOT_FOUND, {
        resource: 'worker', operationId, state: 'REJECTED',
      }));
    }
    if (['operation_invalid', 'worker_id_invalid', 'worker_transition_invalid'].includes(code)) {
      return workerResponse(errorResponse(MOBILE_ERRORS.BAD_REQUEST, {
        reason: code, operationId, state: 'REJECTED',
      }));
    }
    if (code === 'capability_forbidden') {
      return workerResponse(errorResponse(MOBILE_ERRORS.SCOPE_REQUIRED, {
        requiredScope: 'write:workers', operationId, state: 'REJECTED',
      }));
    }
    return workerResponse(errorResponse(MOBILE_ERRORS.SERVER_UNAVAILABLE, {
      reason: code, operationId, state: 'REJECTED',
    }));
  }

  const result = outcome.data;
  const resultKeys = result && typeof result === 'object' && !Array.isArray(result)
    ? Object.keys(result).sort()
    : [];
  const validResult = resultKeys.length === 3
    && resultKeys[0] === 'enabled'
    && resultKeys[1] === 'id'
    && resultKeys[2] === 'previousEnabled'
    && result.id === id
    && result.previousEnabled === expectedEnabled
    && result.enabled === enabled;
  if (!validResult) {
    return workerUnknownResponse(
      journal, principal, operationId, UNKNOWN_REASONS.GATEWAY_EXCEPTION,
    );
  }

  try {
    const resolution = journal.confirm(principal.deviceId, operationId, result);
    if (!resolution.resolved) {
      return workerOperationResponse({ operationId, record: resolution.current, principal });
    }
  } catch {
    return workerUnknownResponse(
      journal, principal, operationId, UNKNOWN_REASONS.RESULT_PERSISTENCE_FAILED,
    );
  }

  return {
    status: 200,
    headers: WORKER_RESPONSE_HEADERS,
    body: withEnvelope({ operationId, state: 'CONFIRMED', result }, { principal }),
  };
}

export async function handleSpecialists(args) {
  return handleConfiguredResourceList({
    ...args,
    feature: 'specialists.read',
    scope: 'read:specialists',
    stream: 'specialists',
    unavailableReason: 'specialists_provider_unavailable',
  });
}

function specialistResponse(result) {
  return { ...result, headers: SPECIALIST_RESPONSE_HEADERS };
}

// ── GET /m1/specialists/:id ────────────────────────────────────────────────
//
// Persisted package metadata and expertise bindings only. The standalone
// gateway cannot observe live registration, runtime tools or filesystem
// integrity and therefore does not invent them.
export async function handleSpecialistDetail({ corePort, principal, params, query }) {
  for (const name of query.keys()) {
    return specialistResponse(errorResponse(MOBILE_ERRORS.BAD_REQUEST, {
      reason: 'unknown_parameter', field: name,
    }));
  }

  const id = params?.id;
  if (
    typeof id !== 'string'
    || id.length < 1
    || id.length > 128
    || id !== id.trim()
    || /[\u0000-\u001f\u007f]/u.test(id)
  ) {
    return specialistResponse(errorResponse(MOBILE_ERRORS.BAD_REQUEST, {
      reason: 'specialist_id_invalid',
    }));
  }

  let outcome;
  try {
    outcome = await corePort?.invoke({
      version: 1,
      feature: 'specialists.read',
      input: { operation: 'detail', id },
      principal,
    }) ?? { ok: false, error: { code: 'capability_unavailable' } };
  } catch (error) {
    outcome = { ok: false, error: { code: error?.code || 'provider_failure' } };
  }

  if (!outcome.ok) {
    if (outcome.error?.code === 'capability_forbidden') {
      return specialistResponse(errorResponse(MOBILE_ERRORS.SCOPE_REQUIRED, {
        requiredScope: 'read:specialists',
      }));
    }
    if (outcome.error?.code === 'not_found') {
      return specialistResponse(errorResponse(MOBILE_ERRORS.NOT_FOUND, {
        resource: 'specialist',
      }));
    }
    if (['operation_invalid', 'specialist_id_invalid'].includes(outcome.error?.code)) {
      return specialistResponse(errorResponse(MOBILE_ERRORS.BAD_REQUEST, {
        reason: outcome.error.code,
      }));
    }
    return specialistResponse(errorResponse(MOBILE_ERRORS.SERVER_UNAVAILABLE, {
      reason: outcome.error?.code || 'specialists_provider_unavailable',
    }));
  }

  return specialistResponse({
    status: 200,
    body: withEnvelope(versioned(outcome.data.specialist), { principal }),
  });
}

// ── GET /m1/conversations ────────────────────────────────────────────────────

function projectConversationResponse(result, filtered) {
  return {
    ...result,
    headers: filtered ? PROJECT_CONVERSATION_RESPONSE_HEADERS : CONVERSATION_RESPONSE_HEADERS,
  };
}

function conversationResponse(result) {
  return { ...result, headers: CONVERSATION_RESPONSE_HEADERS };
}

export async function handleConversations({ corePort, principal, query }) {
  const projectFiltered = query.has('projectId');
  const allowedParameters = new Set(['limit', 'cursor', 'projectId']);
  const seenParameters = new Set();
  for (const name of query.keys()) {
    if (!allowedParameters.has(name)) {
      return projectConversationResponse(
        errorResponse(MOBILE_ERRORS.BAD_REQUEST, { reason: 'unknown_parameter', field: name }),
        projectFiltered,
      );
    }
    if (seenParameters.has(name)) {
      return projectConversationResponse(
        errorResponse(MOBILE_ERRORS.BAD_REQUEST, { reason: 'duplicate_parameter', field: name }),
        projectFiltered,
      );
    }
    seenParameters.add(name);
  }

  const projectId = query.get('projectId');
  if (projectId !== null && (!/^[1-9][0-9]*$/.test(projectId)
      || !Number.isSafeInteger(Number(projectId)))) {
    return projectConversationResponse(
      errorResponse(MOBILE_ERRORS.BAD_REQUEST, { reason: 'project_id_invalid' }), true,
    );
  }
  if (projectId !== null && !principal?.scopes?.includes('read:projects')) {
    return projectConversationResponse(
      errorResponse(MOBILE_ERRORS.SCOPE_REQUIRED, { requiredScope: 'read:projects' }), true,
    );
  }
  const limit = clampLimit(query.get('limit'));
  const stream = projectId === null ? 'conversations' : `conversations:project:${projectId}`;
  const cursor = decodeCursor(query.get('cursor'), { stream });
  if (!cursor.valid) {
    // §8.2 — an unrecognised cursor is refused with a name, never guessed at.
    // `restart: true` tells the client the correct recovery is to load from the
    // beginning, so it does not have to infer that.
    return projectConversationResponse(
      errorResponse(MOBILE_ERRORS.CURSOR_UNKNOWN, { reason: cursor.reason, restart: true }),
      projectFiltered,
    );
  }

  // One row beyond the page so `hasMore` is observed rather than inferred
  // from a full page (§8.6).
  const outcome = await invokeConversationRead(corePort, {
    operation: 'list',
    limit,
    position: cursor.position,
    projectId,
  }, principal);
  if (!outcome.ok) {
    return projectConversationResponse(conversationReadError(outcome.error), projectFiltered);
  }

  const page = paginate({
    rows: outcome.data.rows.map(conversation => versioned(conversation)),
    limit,
    stream,
    position: cursor.position,
  });

  return projectConversationResponse({
    status: 200,
    body: withEnvelope(page.items, {
      principal,
      extra: { hasMore: page.hasMore, nextCursor: page.nextCursor, end: page.end },
    }),
  }, projectFiltered);
}

// ── GET /m1/conversations/:id ────────────────────────────────────────────────

export async function handleConversationDetail({ corePort, principal, params, query }) {
  // Preserve the shipped repair order: a missing/deleted conversation is a
  // 404 even when the supplied cursor is also broken. The client cannot
  // restart a stream whose resource no longer exists.
  const present = await invokeConversationRead(corePort, {
    operation: 'exists',
    id: params.id,
  }, principal);
  if (!present.ok) return conversationResponse(conversationReadError(present.error));

  const limit = clampLimit(query.get('limit'), 50);
  const stream = `messages:${params.id}`;

  // §8.2 — `anchor` opens a walk at a named end of the stream; after that the
  // cursor carries the direction.  Sending both would be two different claims
  // about where the page starts, so it is refused rather than silently resolved
  // in favour of one of them.
  const anchor = query.get('anchor');
  const rawCursor = query.get('cursor');
  if (anchor !== null && rawCursor) {
    return conversationResponse(errorResponse(MOBILE_ERRORS.BAD_REQUEST, {
      reason: 'anchor_with_cursor',
      detail: 'anchor opens a walk; a cursor continues one',
    }));
  }
  if (anchor !== null && anchor !== 'latest') {
    // An unknown anchor must not fall through to the oldest page: that is how a
    // client ends up believing it is holding the newest messages when it is not.
    return conversationResponse(errorResponse(MOBILE_ERRORS.BAD_REQUEST, {
      reason: 'anchor_unknown', anchor, allowed: ['latest'],
    }));
  }

  const cursor = decodeCursor(rawCursor, { stream });
  if (!cursor.valid) {
    return conversationResponse(errorResponse(
      MOBILE_ERRORS.CURSOR_UNKNOWN, { reason: cursor.reason, restart: true },
    ));
  }

  const backward = anchor === 'latest' || cursor.direction === CURSOR_BACKWARD;
  const outcome = await invokeConversationRead(corePort, {
    operation: 'detail',
    id: params.id,
    limit,
    position: cursor.position,
    direction: backward ? CURSOR_BACKWARD : 'forward',
    anchorLatest: anchor === 'latest',
  }, principal);
  if (!outcome.ok) return conversationResponse(conversationReadError(outcome.error));

  const toMessage = message => versioned({
    ...message,
    metadata: safeParse(message.metadata),
  });
  let page;
  if (backward) {
    page = paginateBackward({
      rows: outcome.data.rows.map(toMessage),
      stream,
      start: outcome.data.start,
    });
  } else {
    page = paginate({
      rows: outcome.data.rows.map(toMessage),
      limit,
      stream,
      position: cursor.position,
    });
  }

  return conversationResponse({
    status: 200,
    body: withEnvelope({
      conversation: versioned(outcome.data.conversation),
      messages: page.items,
    }, {
      principal,
      extra: {
        hasMore: page.hasMore,
        nextCursor: page.nextCursor,
        end: page.end,
        // §8.7 — the response states which way this walk runs, so "end" is never
        // ambiguous between "oldest message reached" and "newest message reached".
        direction: backward ? CURSOR_BACKWARD : 'forward',
      },
    }),
  });
}

async function invokeConversationRead(corePort, input, principal) {
  if (!corePort || typeof corePort.invoke !== 'function') {
    return { ok: false, error: { code: 'capability_unavailable' } };
  }
  try {
    return await corePort.invoke({
      version: 1,
      feature: 'conversations.read',
      input,
      principal,
    });
  } catch (error) {
    return { ok: false, error: { code: error?.code || 'provider_failure' } };
  }
}

function conversationReadError(error) {
  if (error?.code === 'not_found') {
    return errorResponse(MOBILE_ERRORS.NOT_FOUND, { resource: 'conversation' });
  }
  if (error?.code === 'conversation_id_invalid' || error?.code === 'page_invalid'
      || error?.code === 'project_id_invalid' || error?.code === 'operation_invalid') {
    return errorResponse(MOBILE_ERRORS.BAD_REQUEST, { reason: error.code });
  }
  if (error?.code === 'capability_forbidden') {
    return errorResponse(MOBILE_ERRORS.SCOPE_REQUIRED, { requiredScope: 'read:chat' });
  }
  return errorResponse(MOBILE_ERRORS.SERVER_UNAVAILABLE, {
    reason: error?.code || 'conversations_provider_unavailable',
  });
}

// ── POST /m1/chat ────────────────────────────────────────────────────────────
//
// The one mutating chat path, and therefore the one that must not be able to
// run twice for a single user intent.  The journal decides that before any
// upstream call happens.

export async function handleChat({ rawDb, journal, upstream, corePort = null, principal, body }) {
  const message = typeof body?.message === 'string' ? body.message.trim() : '';
  const conversationId = typeof body?.conversationId === 'string' ? body.conversationId.trim() : '';
  const operationId = body?.operationId;

  if (!message) return errorResponse(MOBILE_ERRORS.BAD_REQUEST, { field: 'message', reason: 'empty' });
  if (message.length > MAX_MESSAGE_LENGTH) {
    return errorResponse(MOBILE_ERRORS.BAD_REQUEST, { field: 'message', reason: 'too_long', max: MAX_MESSAGE_LENGTH });
  }
  if (!conversationId) {
    return errorResponse(MOBILE_ERRORS.BAD_REQUEST, { field: 'conversationId', reason: 'required' });
  }
  if (!operationId) {
    // Required, not optional: without a key the server cannot make a retry
    // safe, and a client that omits it is asking for duplicate sends.
    return errorResponse(MOBILE_ERRORS.BAD_REQUEST, { field: 'operationId', reason: 'required' });
  }

  const claim = journal.begin({
    deviceId: principal.deviceId,
    operationId,
    operationType: 'chat.send',
    request: { conversationId, message },
  });

  if (claim.outcome === 'conflict') {
    const descriptor = claim.reason === 'fingerprint_mismatch'
      ? MOBILE_ERRORS.OPERATION_CONFLICT
      : MOBILE_ERRORS.BAD_REQUEST;
    return errorResponse(descriptor, { reason: claim.reason, operationId, record: claim.record ?? null });
  }

  if (claim.outcome === 'limited') {
    // §8.11 — a recognisable refusal, never a queue.  `openOperations` is
    // included so the client can show the user exactly what to resolve.
    return errorResponse(
      claim.reason === 'open_operation_cap' ? MOBILE_ERRORS.OPERATION_LIMIT : MOBILE_ERRORS.RATE_LIMITED,
      {
        reason: claim.reason,
        open: claim.open ?? null,
        limit: claim.limit ?? null,
        retryAfterMs: claim.retryAfterMs ?? null,
        openOperations: journal.openOperations(principal.deviceId),
      },
    );
  }

  if (claim.outcome === 'replay') {
    // §8.8 — the original result, and no second effect.  `replayed: true` lets
    // the client tell "this went through" from "this just went through".
    return chatOperationResponse({ operationId, record: claim.record, principal, replayed: true });
  }

  // ── Effect ────────────────────────────────────────────────────────────────
  try {
    ensureConversationRow(rawDb, conversationId);

    const upstreamResult = corePort
      ? portChatResult(await corePort.invoke({
        version: 1,
        feature: 'conversations.send',
        input: { conversationId, message },
        principal,
      }))
      : await upstream.postChat({ conversationId, message });

    if (!upstreamResult.ok) {
      // The upstream said no in a way we understand → a decided negative.
      if (upstreamResult.decided) {
        const resolution = journal.reject(
          principal.deviceId, operationId, upstreamResult.code || 'upstream_error',
        );
        if (!resolution.resolved) return chatResolutionResponse(resolution, operationId, principal);
        return errorResponse(MOBILE_ERRORS.SERVER_UNAVAILABLE, {
          reason: upstreamResult.code || 'upstream_error',
          operationId,
          state: 'REJECTED',
        });
      }
      // We could not tell whether the effect happened.  MD-19 rule 3: this is
      // UNKNOWN, and the client must resolve it by *reading* the state — it
      // must not retry with a fresh key, which would turn one send into two.
      //
      // The transport code is narrowed to the closed vocabulary here as well as
      // in the journal, so the screen shown now and the reason read back later
      // are the same word.
      const reason = normalizeUnknownReason(upstreamResult.code);
      journal.markUnknown(principal.deviceId, operationId, reason);
      return errorResponse(MOBILE_ERRORS.SERVER_UNAVAILABLE, {
        reason,
        operationId,
        state: 'UNKNOWN',
        resolveBy: `GET /m1/operations/${operationId}`,
      });
    }

    const result = {
      conversationId,
      response: upstreamResult.data?.response ?? '',
      mode: upstreamResult.data?.mode ?? null,
      confidence: upstreamResult.data?.confidence ?? null,
    };
    try {
      const resolution = journal.confirm(principal.deviceId, operationId, result);
      if (!resolution.resolved) {
        return chatResolutionResponse(resolution, operationId, principal);
      }
    } catch (persistError) {
      // The effect happened; writing it down did not.  Reporting success would
      // promise a record the client can never read back, so this is UNKNOWN
      // with the one cause that says the answer existed and was lost.
      // (A database that is entirely gone defeats this too — then nothing here
      // can record anything, and the 503 below is all that is left.)
      try {
        journal.markUnknown(principal.deviceId, operationId, UNKNOWN_REASONS.RESULT_PERSISTENCE_FAILED);
      } catch { /* nothing left to write to */ }
      return errorResponse(MOBILE_ERRORS.SERVER_UNAVAILABLE, {
        reason: UNKNOWN_REASONS.RESULT_PERSISTENCE_FAILED,
        operationId,
        state: 'UNKNOWN',
        resolveBy: `GET /m1/operations/${operationId}`,
      });
    }

    return {
      status: 200,
      body: withEnvelope(
        { operationId, state: 'CONFIRMED', result: versioned(result) },
        { principal },
      ),
    };
  } catch (error) {
    // A throw here is genuinely ambiguous — the request may or may not have
    // reached the model.  UNKNOWN is the only honest state.
    journal.markUnknown(principal.deviceId, operationId, UNKNOWN_REASONS.GATEWAY_EXCEPTION);
    return errorResponse(MOBILE_ERRORS.SERVER_UNAVAILABLE, {
      reason: UNKNOWN_REASONS.GATEWAY_EXCEPTION,
      operationId,
      state: 'UNKNOWN',
      resolveBy: `GET /m1/operations/${operationId}`,
    });
  }
}

// ── GET /m1/operations/:operationId ──────────────────────────────────────────
//
// §8.10 / MD-19 §4.1 rule 1.  Carries no payload, needs no scope, and is
// always safe: it is how an UNKNOWN gets resolved without risking a second
// execution.

export async function handleOperationLookup({ journal, principal, params }) {
  const record = journal.lookup(principal.deviceId, params.operationId);

  if (!record.known) {
    // Explicitly "I do not know this key" — distinct from any outcome, so the
    // client can apply MD-19 §4.1 rule 3 (retry with the *same* key only if it
    // still holds the original request) rather than assume success or failure.
    return {
      status: 404,
      body: {
        ok: true,
        protocolVersion: PROTOCOL_VERSION,
        data: { operationId: params.operationId, known: false, state: null },
      },
    };
  }

  return {
    status: 200,
    body: withEnvelope({
      operationId: params.operationId,
      known: true,
      state: record.state,
      operationType: record.operationType,
      requestFingerprint: record.requestFingerprint,
      result: record.result,
      errorCode: record.errorCode,
      // A lookup is a *read of the last recorded state*, not a reconciliation
      // with whatever ran upstream — GATEWAY.md §6 says so out loud.  This read
      // is itself the current check (the envelope carries `serverTime`), so the
      // stored `lastCheckedAt` would only repeat it; it is reported per entry in
      // `GET /m1/operations`, where it is about *other* attempts and does mean
      // something.
      unknownReason: record.unknownReason,
      unknownAt: record.unknownAt,
      createdAt: record.createdAt,
      resolvedAt: record.resolvedAt,
    }, { principal }),
  };
}

// ── GET /m1/operations ───────────────────────────────────────────────────────
//
// The cap in §8.11 refuses every further mutation once it is reached, and
// PENDING/UNKNOWN never expire.  Without a way to see and release them the cap
// is a one-way ratchet: the app reaches a state it cannot leave.  This route
// and the abandon route below are that way out.

export async function handleOperationList({ journal, principal }) {
  const open = journal.openOperations(principal.deviceId);
  return {
    status: 200,
    body: withEnvelope(open, {
      principal,
      extra: {
        open: open.length,
        limit: journal.limits.maxOpenOperations,
        // At the cap, mutations are already being refused; the client shows
        // recovery rather than a normal composer.
        atLimit: open.length >= journal.limits.maxOpenOperations,
      },
    }),
  };
}

// ── POST /m1/operations/:operationId/abandon ─────────────────────────────────
//
// MD-19 §4.3: the cap is released by resolution or by a deliberate act, never
// by evicting the oldest record.  Abandoning is that deliberate act, and it has
// a stated price — the server-side effect stays unresolved and is no longer
// traceable.  The response says so explicitly rather than reporting a clean
// success.

export async function handleOperationAbandon({ journal, principal, params }) {
  const record = journal.lookup(principal.deviceId, params.operationId);
  if (!record.known) return errorResponse(MOBILE_ERRORS.NOT_FOUND, { resource: 'operation' });

  // A resolved record is not occupying the cap and must not be rewritten:
  // discarding a known outcome would destroy the answer, not a hanging attempt.
  if (record.state === 'CONFIRMED' || record.state === 'REJECTED') {
    return errorResponse(MOBILE_ERRORS.STATE_CONFLICT, {
      reason: 'already_resolved',
      state: record.state,
    });
  }

  const abandoned = journal.discardOpen(principal.deviceId, params.operationId);
  if (!abandoned) {
    return errorResponse(MOBILE_ERRORS.STATE_CONFLICT, { reason: 'not_open' });
  }

  const open = journal.openOperations(principal.deviceId);
  return {
    status: 200,
    body: withEnvelope({
      operationId: params.operationId,
      abandoned: true,
      // Said plainly: this closed the record, not the operation.
      effectStillUnknown: record.state === 'UNKNOWN',
      open: open.length,
      limit: journal.limits.maxOpenOperations,
    }, { principal }),
  };
}

// ── POST /m1/pair/claim ──────────────────────────────────────────────────────

export async function handlePairClaim({ rawDb, body, env }) {
  const result = claimPairingCode(rawDb, {
    code: body?.code,
    deviceName: typeof body?.deviceName === 'string' && body.deviceName.trim()
      ? body.deviceName.trim().slice(0, 64)
      : 'mobile device',
    env,
  });

  if (!result.ok) {
    return errorResponse(result.error, result.reason ? { reason: result.reason } : {});
  }

  return {
    status: 200,
    body: {
      ok: true,
      protocolVersion: PROTOCOL_VERSION,
      data: {
        // Returned exactly once.  There is no endpoint that can read it back.
        token: result.token,
        deviceId: result.deviceId,
        scopes: result.scopes,
        expiresAt: result.expiresAt,
      },
    },
  };
}

// ── Devices ─────────────────────────────────────────────────────────────────

export async function handleDevices({ rawDb, principal }) {
  const now = Date.now();
  const devices = listDevices(rawDb).map(device => versioned({
    ...device,
    current: device.deviceId === principal.deviceId,
    expired: sqlTimeToMs(device.expiresAt) <= now,
  }));
  return {
    status: 200,
    headers: DEVICE_RESPONSE_HEADERS,
    body: withEnvelope(devices, { principal }),
  };
}

function deviceOperationResponse({ operationId, record, principal, replayed = false }) {
  const open = record.state === 'PENDING' || record.state === 'UNKNOWN';
  return {
    status: open ? 202 : 200,
    headers: DEVICE_RESPONSE_HEADERS,
    body: withEnvelope(
      { operationId, state: record.state, result: record.result },
      { principal, extra: replayed ? { replayed: true } : {} },
    ),
  };
}

export async function handleDeviceRevoke({ rawDb, journal, principal, params, body }) {
  const targetId = typeof params.id === 'string' ? params.id : '';
  const operationId = body?.operationId;
  if (!/^[A-Za-z0-9_-]{8,128}$/.test(targetId)) {
    return errorResponse(MOBILE_ERRORS.BAD_REQUEST, { field: 'deviceId', reason: 'invalid' });
  }
  if (!operationId) {
    return errorResponse(MOBILE_ERRORS.BAD_REQUEST, { field: 'operationId', reason: 'required' });
  }

  const target = getMobileDevice(rawDb, targetId);
  if (!target) return errorResponse(MOBILE_ERRORS.NOT_FOUND, { resource: 'device' });

  const claim = journal.begin({
    deviceId: principal.deviceId,
    operationId,
    operationType: 'device.revoke',
    request: { deviceId: target.deviceId },
  });
  if (claim.outcome === 'conflict') {
    return errorResponse(MOBILE_ERRORS.OPERATION_CONFLICT, { reason: claim.reason, operationId });
  }
  if (claim.outcome === 'limited') {
    return errorResponse(
      claim.reason === 'open_operation_cap' ? MOBILE_ERRORS.OPERATION_LIMIT : MOBILE_ERRORS.RATE_LIMITED,
      { reason: claim.reason, openOperations: journal.openOperations(principal.deviceId) },
    );
  }
  if (claim.outcome === 'replay') {
    return deviceOperationResponse({ operationId, record: claim.record, principal, replayed: true });
  }

  let result;
  try {
    // Token revocation and its durable operation result share one SQLite
    // transaction. This matters most for self-revocation: after commit this
    // token can never call the recovery endpoint, so an UNKNOWN outcome would
    // be permanently unresolvable by the initiating device.
    rawDb.transaction(() => {
      const fresh = getMobileDevice(rawDb, target.deviceId);
      if (!fresh) throw new Error('device_disappeared');
      const changed = revokeDevice(rawDb, target.deviceId);
      result = {
        deviceId: target.deviceId,
        revoked: true,
        alreadyRevoked: !changed,
        current: target.deviceId === principal.deviceId,
        // Revocation blocks future server reads. It cannot erase an offline
        // phone and the wire response must not invite that interpretation.
        remoteWipe: false,
      };
      const resolution = journal.confirm(principal.deviceId, operationId, result);
      if (!resolution.resolved) throw new Error(`operation_${resolution.reason}`);
    })();
  } catch {
    let failureState = 'UNKNOWN';
    try {
      const rejected = journal.reject(principal.deviceId, operationId, 'device_revoke_failed');
      if (rejected.resolved || rejected.current?.state === 'REJECTED') failureState = 'REJECTED';
    } catch { /* the response remains UNKNOWN; startup recovery owns the row */ }
    return errorResponse(MOBILE_ERRORS.SERVER_UNAVAILABLE, {
      reason: 'device_revoke_failed',
      operationId,
      state: failureState,
      ...(failureState === 'UNKNOWN'
        ? { resolveBy: `GET /m1/operations/${operationId}` }
        : {}),
    });
  }

  return {
    status: 200,
    headers: DEVICE_RESPONSE_HEADERS,
    body: withEnvelope({ operationId, state: 'CONFIRMED', ...result }, { principal }),
  };
}

// ── Notifications ────────────────────────────────────────────────────────────

export async function handleNotifications({ rawDb, principal, query }) {
  const afterSeq = Number.parseInt(query.get('afterSeq') || '0', 10) || 0;
  const limit = clampLimit(query.get('limit'), 50);

  const rows = listMobileNotifications(rawDb, { deviceId: principal.deviceId, afterSeq, limit });
  const hasMore = rows.length > limit;
  const items = hasMore ? rows.slice(0, limit) : rows;

  return {
    status: 200,
    headers: NOTIFICATION_RESPONSE_HEADERS,
    body: withEnvelope(items, {
      principal,
      extra: {
        hasMore,
        end: !hasMore,
        // Sequence-based, not cursor-based: the client asks for "after N",
        // which is naturally monotonic and survives reconnects.
        nextAfterSeq: items.length ? items[items.length - 1].seq : afterSeq,
      },
    }),
  };
}

export async function handleNotificationAck({ rawDb, principal, body }) {
  const ids = Array.isArray(body?.ids) ? body.ids.filter(id => typeof id === 'string').slice(0, 200) : [];
  if (ids.length === 0) return errorResponse(MOBILE_ERRORS.BAD_REQUEST, { field: 'ids', reason: 'required' });
  // F-112: the principal's device is part of the write, not merely of the read.
  const changed = ackMobileNotifications(rawDb, ids, { deviceId: principal.deviceId });
  return {
    status: 200,
    headers: NOTIFICATION_RESPONSE_HEADERS,
    body: withEnvelope({ acknowledged: changed }, { principal }),
  };
}

// ── Approvals ────────────────────────────────────────────────────────────────

export async function handleApprovals({ rawDb, principal }) {
  const rows = rawDb.prepare(`
    SELECT id, subject_type, subject_id, title, detail, payload_fingerprint,
           created_at, expires_at, decided_at, decision,
           validity, precondition_ref
      FROM mobile_approvals
     WHERE decided_at IS NULL
     ORDER BY created_at ASC
     LIMIT 100
  `).all();

  const now = Date.now();
  return approvalResponse({
    status: 200,
    body: withEnvelope(rows.map(row => versioned({
      id: row.id,
      subjectType: row.subject_type,
      subjectId: row.subject_id,
      title: row.title,
      detail: row.detail,
      // §8.4 — the fingerprint travels with the approval so the client can
      // prove it is deciding on the payload it was shown.
      payloadFingerprint: row.payload_fingerprint,
      createdAt: row.created_at,
      expiresAt: row.expires_at,
      expired: sqlTimeToMs(row.expires_at) < now,
      // `025`: čím je approval omezený.  `window` propadá časem, `precondition`
      // platí, dokud se nezmění cíl — a obrazovka to musí říkat jinak, protože
      // odpočet u druhého případu není informace, ale mýlka.
      validity: row.validity || 'window',
      // Cesta k cíli je `S2`, stejně jako popis; jde stejnou routou za
      // `read:approvals` a do notifikace se nikdy nedostane.
      preconditionRef: row.precondition_ref || null,
    })), { principal }),
  });
}

function attemptApprovalResolution({ journal, principal, operationId, resolve }) {
  try {
    return { resolution: resolve(), response: null };
  } catch {
    // The approval decision may already be durable even though recording its
    // operation result failed.  The only truthful recovery state is UNKNOWN,
    // using the same closed reason and read-only lookup path as chat results.
    try {
      journal.markUnknown(
        principal.deviceId,
        operationId,
        UNKNOWN_REASONS.RESULT_PERSISTENCE_FAILED,
      );
    } catch { /* a database that is entirely unavailable cannot record recovery */ }
    return {
      resolution: null,
      response: errorResponse(MOBILE_ERRORS.SERVER_UNAVAILABLE, {
        reason: UNKNOWN_REASONS.RESULT_PERSISTENCE_FAILED,
        operationId,
        state: 'UNKNOWN',
        resolveBy: `GET /m1/operations/${operationId}`,
      }),
    };
  }
}

export async function handleApprovalDecide(args) {
  return approvalResponse(await decideApproval(args));
}

/**
 * Terminální trojice — **co**, **kdy** a **kdo** (M1-c).
 *
 * Konfliktní větve dřív vracely buď jen `decision`, nebo vůbec nic, takže druhé
 * zařízení nemělo z čeho postavit `SS-09` („rozhodnuto jinde") — a muselo by si
 * pravdu dojít do databáze, kterou nevidí.  Dokument `MULTI-DEVICE.md` přitom
 * slibuje „co, kdy a kdo"; tohle je ta trojice, aby ten slib platil.
 *
 * `state` je vedle `decision` schválně: `invalidated` a `cancelled` nejsou
 * lidské zamítnutí a klient je musí umět rozlišit (`decisionState`).
 */
function terminalTuple(row) {
  if (!row || !row.decided_at) return null;
  return {
    decision: row.decision,
    state: decisionState(row.decision),
    decidedAt: row.decided_at,
    decidedBy: row.decided_by || null,
    ...(row.decision_reason ? { decisionReason: row.decision_reason } : {}),
  };
}

async function decideApproval({ rawDb, journal, principal, params, body }) {
  const decision = body?.decision;
  const operationId = body?.operationId;
  const payloadFingerprint = body?.payloadFingerprint;

  if (decision !== 'approve' && decision !== 'reject') {
    return errorResponse(MOBILE_ERRORS.BAD_REQUEST, { field: 'decision', reason: 'must_be_approve_or_reject' });
  }
  // `operationId` je mobilní specifikum (`MD-19`), ne pravidlo approvalu —
  // proto se kontroluje tady a ne ve sdílené autoritě.
  if (!operationId) return errorResponse(MOBILE_ERRORS.BAD_REQUEST, { field: 'operationId', reason: 'required' });

  const row = rawDb.prepare(`
    SELECT id, payload_fingerprint, expires_at, decided_at, decision, decided_by,
           decision_reason, origin, run_id, operation_ref
      FROM mobile_approvals WHERE id = ?
  `).get(params.id);

  // Pravidla vyhodnocuje **jedna sdílená funkce** pro obě plochy (nález 5
  // z review).  Dvě sady pravidel nad jednou tabulkou znamenají, že jedna z nich
  // je mírnější — a přes tu se to obejde.  Doručení zůstává mobilní: `MD-19`
  // žurnál a obrazovky `SS-09`/`MS-14` jsou vlastnost téhle plochy, ne pravidla.
  const verdict = evaluateApprovalDecision(row, { decision, payloadFingerprint });

  if (verdict.verdict === 'refused') {
    switch (verdict.reason) {
      case 'fingerprint_required':
        return errorResponse(MOBILE_ERRORS.BAD_REQUEST, { field: 'payloadFingerprint', reason: 'required' });
      case 'not_found':
        return errorResponse(MOBILE_ERRORS.NOT_FOUND, { resource: 'approval' });
      case 'unbound_approval':
        // Odmítnuto **dřív, než se zabere operační klíč**, takže odmítnutí
        // zařízení nic nestojí a nezůstane po něm pokus k rozřešení.  Frontu to
        // neschovává — skrytý čekající požadavek by udělal z „nic nečeká"
        // nepravdu (`SS-02`).
        return errorResponse(MOBILE_ERRORS.STATE_CONFLICT, {
          reason: 'unbound_approval',
          approvalId: params.id,
        });
      default:
        break;  // expirace a otisk se řeší až po zabrání klíče, viz níže
    }
  }

  // §8.5 — the operation key makes the *decision* idempotent, but it does not
  // make the grant reusable.  Both checks run, and the single-use check is the
  // one that cannot be satisfied by presenting a valid key.
  const claim = journal.begin({
    deviceId: principal.deviceId,
    operationId,
    operationType: 'approval.decide',
    request: { approvalId: params.id, decision, payloadFingerprint },
  });

  if (claim.outcome === 'conflict') {
    return errorResponse(MOBILE_ERRORS.OPERATION_CONFLICT, { reason: claim.reason, operationId });
  }
  if (claim.outcome === 'limited') {
    return errorResponse(
      claim.reason === 'open_operation_cap' ? MOBILE_ERRORS.OPERATION_LIMIT : MOBILE_ERRORS.RATE_LIMITED,
      { reason: claim.reason, openOperations: journal.openOperations(principal.deviceId) },
    );
  }
  if (claim.outcome === 'replay') {
    return approvalOperationResponse({
      approvalId: params.id, operationId, record: claim.record, principal, replayed: true,
    });
  }

  // §8.4 — the grant binds to the payload the user saw.  If the payload moved
  // underneath them, the approval no longer means what they agreed to.  The
  // fingerprint is required above, so this comparison can no longer be skipped
  // by simply not sending one.
  if (payloadFingerprint !== row.payload_fingerprint) {
    const attempt = attemptApprovalResolution({
      journal, principal, operationId,
      resolve: () => journal.reject(principal.deviceId, operationId, 'approval_superseded'),
    });
    if (attempt.response) return attempt.response;
    const { resolution } = attempt;
    if (!resolution.resolved) {
      return approvalResolutionResponse(resolution, params.id, operationId, principal);
    }
    return errorResponse(MOBILE_ERRORS.APPROVAL_SUPERSEDED, {
      expected: row.payload_fingerprint,
      operationId,
    });
  }
  if (row.decided_at) {
    const attempt = attemptApprovalResolution({
      journal, principal, operationId,
      resolve: () => journal.reject(principal.deviceId, operationId, 'state_conflict'),
    });
    if (attempt.response) return attempt.response;
    const { resolution } = attempt;
    if (!resolution.resolved) {
      return approvalResolutionResponse(resolution, params.id, operationId, principal);
    }
    return errorResponse(MOBILE_ERRORS.STATE_CONFLICT, {
      reason: 'already_decided',
      ...terminalTuple(row),
      operationId,
    });
  }
  if (sqlTimeToMs(row.expires_at) < Date.now()) {
    const attempt = attemptApprovalResolution({
      journal, principal, operationId,
      resolve: () => journal.reject(principal.deviceId, operationId, 'approval_expired'),
    });
    if (attempt.response) return attempt.response;
    const { resolution } = attempt;
    if (!resolution.resolved) {
      return approvalResolutionResponse(resolution, params.id, operationId, principal);
    }
    return errorResponse(MOBILE_ERRORS.APPROVAL_EXPIRED, { operationId });
  }

  // Conditional UPDATE: `decided_at IS NULL` is the single-use precondition,
  // decided atomically rather than by the read above.
  const info = rawDb.prepare(`
    UPDATE mobile_approvals
       SET decided_at = CURRENT_TIMESTAMP, decision = ?, decided_by = ?, decision_operation = ?
     WHERE id = ? AND decided_at IS NULL
  `).run(decision, principal.deviceId, operationId, params.id);

  if (info.changes === 0) {
    const attempt = attemptApprovalResolution({
      journal, principal, operationId,
      resolve: () => journal.reject(principal.deviceId, operationId, 'state_conflict'),
    });
    if (attempt.response) return attempt.response;
    const { resolution } = attempt;
    if (!resolution.resolved) {
      return approvalResolutionResponse(resolution, params.id, operationId, principal);
    }
    // Přečíst znovu: mezi kontrolou a zápisem odpověděl někdo jiný a jeho
    // odpověď je ta platná.  Bez tohohle čtení by druhé zařízení dostalo holé
    // „prohráls závod" a nevědělo **co** vlastně platí.
    const decided = rawDb.prepare(`
      SELECT decided_at, decision, decided_by, decision_reason
        FROM mobile_approvals WHERE id = ?
    `).get(params.id);
    return errorResponse(MOBILE_ERRORS.STATE_CONFLICT, {
      reason: 'race_lost',
      ...(terminalTuple(decided) || {}),
      operationId,
    });
  }

  const result = { approvalId: params.id, decision };
  const attempt = attemptApprovalResolution({
    journal, principal, operationId,
    resolve: () => journal.confirm(principal.deviceId, operationId, result),
  });
  if (attempt.response) return attempt.response;
  const { resolution } = attempt;
  if (!resolution.resolved) {
    return approvalResolutionResponse(resolution, params.id, operationId, principal);
  }
  return { status: 200, body: withEnvelope({ ...result, state: 'CONFIRMED' }, { principal }) };
}

// ── helpers ──────────────────────────────────────────────────────────────────

function chatOperationResponse({ operationId, record, principal, replayed = false }) {
  const open = record.state === 'PENDING' || record.state === 'UNKNOWN';
  return {
    status: open ? 202 : 200,
    body: withEnvelope(
      { operationId, state: record.state, result: record.result },
      { principal, extra: replayed ? { replayed: true } : {} },
    ),
  };
}

function chatResolutionResponse(resolution, operationId, principal) {
  const current = resolution?.current;
  if (!current?.known) return missingOperationResponse(operationId);
  return chatOperationResponse({ operationId, record: current, principal });
}

function portChatResult(result) {
  if (result.ok) return { ok: true, data: result.data };
  const details = result.error?.details || {};
  return {
    ok: false,
    code: result.error?.code || 'upstream_unavailable',
    decided: details.decided === true,
    ...(Number.isInteger(details.status) ? { status: details.status } : {}),
  };
}

function approvalOperationResponse({ approvalId, operationId, record, principal, replayed = false }) {
  return {
    status: 200,
    body: withEnvelope(
      { approvalId, state: record.state, result: record.result },
      { principal, extra: replayed ? { replayed: true } : {} },
    ),
  };
}

function approvalResolutionResponse(resolution, approvalId, operationId, principal) {
  const current = resolution?.current;
  if (!current?.known) return missingOperationResponse(operationId);
  return approvalOperationResponse({
    approvalId, operationId, record: current, principal,
  });
}

function missingOperationResponse(operationId) {
  return errorResponse(MOBILE_ERRORS.SERVER_UNAVAILABLE, {
    reason: UNKNOWN_REASONS.RESULT_PERSISTENCE_FAILED,
    operationId,
  });
}

function errorResponse(descriptor, details = {}) {
  const payload = mobileError(descriptor, details);
  return { status: payload.status, body: { ok: false, error: payload.error } };
}

function approvalResponse(result) {
  return { ...result, headers: APPROVAL_RESPONSE_HEADERS };
}

function clampLimit(raw, fallback = DEFAULT_PAGE_SIZE) {
  const parsed = Number.parseInt(raw ?? '', 10);
  if (!Number.isInteger(parsed) || parsed <= 0) return fallback;
  return Math.min(parsed, MAX_PAGE_SIZE);
}

function safeParse(json) {
  try { return json ? JSON.parse(json) : null; } catch { return null; }
}

function sqlTimeToMs(value) {
  if (!value) return 0;
  const normalized = String(value).includes('T') ? String(value) : String(value).replace(' ', 'T') + 'Z';
  const ms = Date.parse(normalized);
  return Number.isNaN(ms) ? 0 : ms;
}

function ensureConversationRow(rawDb, conversationId) {
  rawDb.prepare(`
    INSERT INTO conversations (id, title, state) VALUES (?, NULL, 'active')
    ON CONFLICT(id) DO NOTHING
  `).run(conversationId);
}

export const MOBILE_HANDLERS = Object.freeze({
  'GET /m1/health': handleHealth,
  'POST /m1/pair/claim': handlePairClaim,
  'GET /m1/capabilities': handleCapabilities,
  'GET /m1/projects': handleProjects,
  'GET /m1/projects/:id': handleProjectDetail,
  'GET /m1/settings': handleSettings,
  'PUT /m1/settings': handleSettingsWrite,
  'GET /m1/memory': handleStoredInformation,
  'POST /m1/memory': handleStoredInformationWrite,
  'GET /m1/workers': handleWorkers,
  'GET /m1/workers/:id/runs': handleWorkerRuns,
  'PUT /m1/workers/:id/enabled': handleWorkerToggle,
  'GET /m1/specialists': handleSpecialists,
  'GET /m1/specialists/:id': handleSpecialistDetail,
  'GET /m1/devices': handleDevices,
  'POST /m1/devices/:id/revoke': handleDeviceRevoke,
  'GET /m1/conversations': handleConversations,
  'GET /m1/conversations/:id': handleConversationDetail,
  'POST /m1/chat': handleChat,
  'GET /m1/operations': handleOperationList,
  'GET /m1/operations/:operationId': handleOperationLookup,
  'POST /m1/operations/:operationId/abandon': handleOperationAbandon,
  'GET /m1/notifications': handleNotifications,
  'POST /m1/notifications/ack': handleNotificationAck,
  'GET /m1/approvals': handleApprovals,
  'POST /m1/approvals/:id/decide': handleApprovalDecide,
});

export default MOBILE_HANDLERS;
