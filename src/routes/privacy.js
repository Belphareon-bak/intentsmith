const AUTH_REQUIRED = 'M5_PRIVACY_AUTH_REQUIRED';
const INTERNAL_ERROR = 'M5_PRIVACY_INTERNAL_ERROR';
const OFFLINE_SIGNATURE_REQUIRED = 'M5_PRIVACY_OFFLINE_SIGNATURE_REQUIRED';

function isRecord(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function authenticatedUser(req) {
  const subject = req?.authenticatedSubject;
  return isRecord(subject)
    && subject.actorType === 'user'
    && typeof subject.actorId === 'string'
    && subject.actorId.trim() !== ''
    ? subject
    : null;
}

function statusForError(error) {
  const code = typeof error?.code === 'string' ? error.code : '';
  if (code.includes('OFFLINE_SIGNATURE_REQUIRED')) return 410;
  if (code.includes('WRITER_AUTHORITY_REQUIRED')) return 403;
  if (code.includes('AUTH_REQUIRED')) return 403;
  if (code.includes('ALREADY_RECORDED')) return 409;
  if (code.includes('INPUT_INVALID')) return 400;
  if (code.includes('STORAGE_FAILURE')) return 503;
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
      code: INTERNAL_ERROR,
    });
  }
  return sendJSON(res, status, {
    error: typeof error?.message === 'string' ? error.message : 'Privacy operation failed',
    code: error.code,
  });
}

export function createPrivacyRoutes({
  privacyAuthority,
  parseBody,
  sendJSON,
  safeError,
} = {}) {
  if (!privacyAuthority
    || typeof privacyAuthority.summary !== 'function'
    || typeof privacyAuthority.recordRotation !== 'function'
    || typeof privacyAuthority.recordHistory !== 'function') {
    throw new TypeError('M5 privacy routes require the complete authority repository');
  }
  for (const [name, dependency] of Object.entries({ parseBody, sendJSON, safeError })) {
    if (typeof dependency !== 'function') throw new TypeError(`M5 privacy routes require ${name}`);
  }

  async function withUser(req, res, operation) {
    const authenticatedSubject = authenticatedUser(req);
    if (!authenticatedSubject) {
      return sendJSON(res, 403, {
        error: 'An authenticated user subject is required.',
        code: AUTH_REQUIRED,
      });
    }
    try {
      return await operation(authenticatedSubject);
    } catch (error) {
      return sendFailure(res, error, { sendJSON, safeError });
    }
  }

  return Object.freeze({
    'GET /api/security/privacy/remediation': (req, res) => (
      withUser(req, res, () => sendJSON(res, 200, privacyAuthority.summary()))
    ),

    'POST /api/security/privacy/rotations/:categoryId/attest': (req, res, params) => (
      withUser(req, res, () => sendJSON(res, 410, {
        error: 'Privacy receipts require the offline Ed25519 operator ceremony.',
        code: OFFLINE_SIGNATURE_REQUIRED,
        categoryId: typeof params?.categoryId === 'string' ? params.categoryId : null,
      }))
    ),

    'POST /api/security/privacy/history/attest': (req, res) => (
      withUser(req, res, () => sendJSON(res, 410, {
        error: 'Privacy receipts require the offline Ed25519 operator ceremony.',
        code: OFFLINE_SIGNATURE_REQUIRED,
      }))
    ),
  });
}

export default createPrivacyRoutes;
