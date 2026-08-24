import {
  createM2LegacyLifecycleQuarantineRoutes,
} from '../lifecycle/m2-legacy-lifecycle-quarantine.js';

const AUTH_REQUIRED_CODE = 'M2_LIFECYCLE_AUTH_REQUIRED';
const INTERNAL_ERROR_CODE = 'M2_LIFECYCLE_INTERNAL_ERROR';

function isRecord(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function authenticatedUser(req) {
  const subject = req?.authenticatedSubject;
  return isRecord(subject)
    && subject.actorType === 'user'
    && typeof subject.actorId === 'string'
    && subject.actorId.trim().length > 0
    ? subject
    : null;
}

function originFromBody(body) {
  const origin = isRecord(body?.origin) ? body.origin : {};
  return {
    surface: origin.surface,
    sessionId: origin.sessionId,
    conversationId: origin.conversationId,
    projectId: origin.projectId,
  };
}

function originFromSearchParams(searchParams) {
  const projectId = searchParams.get('projectId');
  return {
    surface: searchParams.get('surface') ?? undefined,
    sessionId: searchParams.get('sessionId') ?? undefined,
    conversationId: searchParams.get('conversationId') ?? undefined,
    projectId: projectId === null ? undefined : Number(projectId),
  };
}

function statusForError(error) {
  const code = typeof error?.code === 'string' ? error.code.toUpperCase() : '';
  if (code.includes('NOT_FOUND')) return 404;
  if (/(?:^|_)AUTH(?:_|$)|SUBJECT|FORBIDDEN|UNAUTHORIZED|OWNER/.test(code)) return 403;
  if (code.includes('RECOVERY_INCOMPLETE')) return 503;
  if (/(?:STALE|CONFLICT|DRIFT|MISMATCH|BUSY|IN_PROGRESS|REPLAY|EXPIRED|INCOMPLETE|DIRTY|DENIED|CANCELLED|TERMINAL)/.test(code)) {
    return 409;
  }
  if (/(?:UNAVAILABLE|PROVIDER_MISSING|STORAGE_FAILURE|NOT_INITIALIZED)/.test(code)) return 503;
  if (/(?:CONTRACT|INPUT|INVALID|MALFORMED|REQUIRED|MISSING|M2_PROPOSAL)/.test(code)) {
    return 400;
  }
  return 500;
}

function typedErrorPayload(error) {
  return {
    error: typeof error?.message === 'string' && error.message.length > 0
      ? error.message
      : 'M2 lifecycle request failed.',
    code: error.code,
  };
}

function internalErrorPayload(error, safeError) {
  const safe = safeError(error);
  if (!isRecord(safe)) {
    return { error: 'Internal server error', code: INTERNAL_ERROR_CODE };
  }
  const payload = { ...safe };
  delete payload.ok;
  if (typeof payload.error !== 'string' || payload.error.length === 0) {
    payload.error = 'Internal server error';
  }
  payload.code = INTERNAL_ERROR_CODE;
  return payload;
}

function sendFailure(res, error, { sendJSON, safeError }) {
  const status = statusForError(error);
  const payload = status === 500
    ? internalErrorPayload(error, safeError)
    : typedErrorPayload(error);
  return sendJSON(res, status, payload);
}

function sendAuthRequired(res, sendJSON) {
  return sendJSON(res, 403, {
    error: 'An authenticated user subject is required.',
    code: AUTH_REQUIRED_CODE,
  });
}

function requireFactoryDependencies({ m2LifecycleService, parseBody, sendJSON, safeError }) {
  const serviceMethods = [
    'prepareSmallProjectChange',
    'approveSmallProjectChange',
    'cancelSmallProjectChange',
    'getSmallProjectChangeStatus',
  ];
  if (!isRecord(m2LifecycleService)
    || serviceMethods.some(method => typeof m2LifecycleService[method] !== 'function')) {
    throw new TypeError('M2 lifecycle routes require the complete lifecycle service');
  }
  for (const [name, dependency] of Object.entries({ parseBody, sendJSON, safeError })) {
    if (typeof dependency !== 'function') {
      throw new TypeError(`M2 lifecycle routes require ${name}`);
    }
  }
}

export function createM2LifecycleRoutes({
  m2LifecycleService,
  parseBody,
  sendJSON,
  safeError,
} = {}) {
  requireFactoryDependencies({ m2LifecycleService, parseBody, sendJSON, safeError });

  const errorDependencies = { sendJSON, safeError };
  const routes = {
    'POST /api/m2/lifecycle/prepare': async (req, res) => {
      const authenticatedSubject = authenticatedUser(req);
      if (!authenticatedSubject) return sendAuthRequired(res, sendJSON);
      try {
        const parsed = await parseBody(req);
        const body = isRecord(parsed) ? parsed : {};
        const result = await m2LifecycleService.prepareSmallProjectChange({
          authenticatedSubject,
          projectId: body.projectId,
          origin: originFromBody(body),
          proposal: body.proposal,
          signal: req.signal ?? null,
        });
        return sendJSON(res, 200, result);
      } catch (error) {
        return sendFailure(res, error, errorDependencies);
      }
    },

    'POST /api/m2/lifecycle/approve': async (req, res) => {
      const authenticatedSubject = authenticatedUser(req);
      if (!authenticatedSubject) return sendAuthRequired(res, sendJSON);
      try {
        const parsed = await parseBody(req);
        const body = isRecord(parsed) ? parsed : {};
        const result = await m2LifecycleService.approveSmallProjectChange({
          authenticatedSubject,
          lifecycleId: body.lifecycleId,
          planDigest: body.planDigest,
          origin: originFromBody(body),
          signal: req.signal ?? null,
        });
        return sendJSON(res, 200, result);
      } catch (error) {
        return sendFailure(res, error, errorDependencies);
      }
    },

    'POST /api/m2/lifecycle/cancel': async (req, res) => {
      const authenticatedSubject = authenticatedUser(req);
      if (!authenticatedSubject) return sendAuthRequired(res, sendJSON);
      try {
        const parsed = await parseBody(req);
        const body = isRecord(parsed) ? parsed : {};
        const result = await m2LifecycleService.cancelSmallProjectChange({
          authenticatedSubject,
          lifecycleId: body.lifecycleId,
          reason: body.reason,
          origin: originFromBody(body),
          signal: req.signal ?? null,
        });
        return sendJSON(res, 200, result);
      } catch (error) {
        return sendFailure(res, error, errorDependencies);
      }
    },

    'GET /api/m2/lifecycle/status': async (req, res) => {
      const authenticatedSubject = authenticatedUser(req);
      if (!authenticatedSubject) return sendAuthRequired(res, sendJSON);
      try {
        const url = new URL(req.url, 'http://127.0.0.1');
        const lifecycleId = url.searchParams.get('id');
        if (!lifecycleId) {
          const error = new TypeError('id query parameter is required');
          error.code = 'M2_LIFECYCLE_INPUT_INVALID';
          throw error;
        }
        const result = await m2LifecycleService.getSmallProjectChangeStatus({
          authenticatedSubject,
          lifecycleId,
          origin: originFromSearchParams(url.searchParams),
        });
        return sendJSON(res, 200, result);
      } catch (error) {
        return sendFailure(res, error, errorDependencies);
      }
    },

    ...createM2LegacyLifecycleQuarantineRoutes({ sendJSON }),
  };

  return Object.freeze(routes);
}
