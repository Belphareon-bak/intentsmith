const AUTH_REQUIRED_CODE = 'M4_LEARNING_AUTH_REQUIRED';
const INTERNAL_ERROR_CODE = 'M4_LEARNING_INTERNAL_ERROR';

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

function statusForError(error) {
  const code = typeof error?.code === 'string' ? error.code.toUpperCase() : '';
  if (code.includes('NOT_FOUND')) return 404;
  if (/(?:AUTH_REQUIRED|FORBIDDEN|UNAUTHORIZED)/.test(code)) return 403;
  if (/(?:NOT_ACTIVE|MISMATCH|CONFLICT|ALREADY_DECIDED|TRANSITION_INVALID)/.test(code)) return 409;
  if (/(?:STORAGE_FAILURE|NOT_INITIALIZED|UNAVAILABLE)/.test(code)) return 503;
  if (/(?:INPUT_INVALID|PROJECT_INVALID|REQUIRED|MALFORMED)/.test(code)) return 400;
  return 500;
}

function sendFailure(res, error, { sendJSON, safeError }) {
  const status = statusForError(error);
  if (status === 500) {
    const safe = safeError(error);
    return sendJSON(res, 500, {
      error: isRecord(safe) && typeof safe.error === 'string'
        ? safe.error
        : 'Internal server error',
      code: INTERNAL_ERROR_CODE,
    });
  }
  return sendJSON(res, status, {
    error: typeof error?.message === 'string' && error.message.length > 0
      ? error.message
      : 'M4 learning request failed.',
    code: error.code,
  });
}

function sendAuthRequired(res, sendJSON) {
  return sendJSON(res, 403, {
    error: 'An authenticated user subject is required.',
    code: AUTH_REQUIRED_CODE,
  });
}

function requireDependencies({ learningService, parseBody, sendJSON, safeError }) {
  const serviceMethods = [
    'listProposalReviews',
    'getProposalReview',
    'approveProposal',
    'rejectProposal',
    'weakenLearning',
    'rollbackLearning',
    'deleteLearning',
  ];
  if (!isRecord(learningService)
    || serviceMethods.some(method => typeof learningService[method] !== 'function')) {
    throw new TypeError('M4 learning routes require the complete application service');
  }
  for (const [name, dependency] of Object.entries({ parseBody, sendJSON, safeError })) {
    if (typeof dependency !== 'function') {
      throw new TypeError(`M4 learning routes require ${name}`);
    }
  }
}

function boundedLimit(searchParams) {
  const raw = searchParams.get('limit');
  if (raw === null) return 50;
  if (!/^[1-9][0-9]*$/.test(raw)) return Number.NaN;
  return Number(raw);
}

export function createLearningRoutes({
  learningService,
  parseBody,
  sendJSON,
  safeError,
} = {}) {
  requireDependencies({ learningService, parseBody, sendJSON, safeError });
  const failureDependencies = { sendJSON, safeError };

  async function withUser(req, res, operation) {
    const authenticatedSubject = authenticatedUser(req);
    if (!authenticatedSubject) return sendAuthRequired(res, sendJSON);
    try {
      return await operation(authenticatedSubject);
    } catch (error) {
      return sendFailure(res, error, failureDependencies);
    }
  }

  async function bodyOperation(req, res, params, method) {
    return withUser(req, res, async (authenticatedSubject) => {
      const parsed = await parseBody(req);
      const body = isRecord(parsed) ? parsed : {};
      const result = await learningService[method]({
        authenticatedSubject,
        projectId: params.projectId,
        proposalId: params.proposalId,
        reason: body.reason,
        ...(method === 'weakenLearning' ? {
          confidenceBps: body.confidenceBps,
          value: body.value,
        } : {}),
      });
      return sendJSON(res, 200, result);
    });
  }

  return Object.freeze({
    'GET /api/projects/:projectId/learning/proposals': (req, res, params) => (
      withUser(req, res, async (authenticatedSubject) => {
        const url = new URL(req.url, 'http://127.0.0.1');
        const result = await learningService.listProposalReviews({
          authenticatedSubject,
          projectId: params.projectId,
          state: url.searchParams.get('state') || 'all',
          limit: boundedLimit(url.searchParams),
        });
        return sendJSON(res, 200, result);
      })
    ),

    'GET /api/projects/:projectId/learning/proposals/:proposalId': (req, res, params) => (
      withUser(req, res, async (authenticatedSubject) => {
        const result = await learningService.getProposalReview({
          authenticatedSubject,
          projectId: params.projectId,
          proposalId: params.proposalId,
        });
        return sendJSON(res, 200, result);
      })
    ),

    'POST /api/projects/:projectId/learning/proposals/:proposalId/approve': (
      req, res, params,
    ) => bodyOperation(req, res, params, 'approveProposal'),

    'POST /api/projects/:projectId/learning/proposals/:proposalId/reject': (
      req, res, params,
    ) => bodyOperation(req, res, params, 'rejectProposal'),

    'POST /api/projects/:projectId/learning/proposals/:proposalId/weaken': (
      req, res, params,
    ) => bodyOperation(req, res, params, 'weakenLearning'),

    'POST /api/projects/:projectId/learning/proposals/:proposalId/rollback': (
      req, res, params,
    ) => bodyOperation(req, res, params, 'rollbackLearning'),

    'DELETE /api/projects/:projectId/learning/proposals/:proposalId': (
      req, res, params,
    ) => bodyOperation(req, res, params, 'deleteLearning'),
  });
}
