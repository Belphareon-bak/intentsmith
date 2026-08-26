import { expectedM5PrivacyAuthorityKind } from '../../contracts/m5/privacy-remediation-v1.js';

const AUTH_REQUIRED = 'M5_PRIVACY_AUTH_REQUIRED';
const INTERNAL_ERROR = 'M5_PRIVACY_INTERNAL_ERROR';

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

function exactBody(value, keys) {
  return isRecord(value)
    && Object.keys(value).length === keys.length
    && keys.every(key => Object.hasOwn(value, key));
}

function statusForError(error) {
  const code = typeof error?.code === 'string' ? error.code : '';
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
      withUser(req, res, async authenticatedSubject => {
        const body = await parseBody(req);
        if (!exactBody(body, ['authorityKind', 'completedAtMs', 'confirmNoSecretValues'])) {
          const error = new Error('Rotation attestation body has unknown or missing fields');
          error.code = 'M5_PRIVACY_INPUT_INVALID';
          throw error;
        }
        if (body.confirmNoSecretValues !== true) {
          const error = new Error('Rotation attestation must confirm that no secret value is recorded');
          error.code = 'M5_PRIVACY_INPUT_INVALID';
          throw error;
        }
        if (body.authorityKind !== expectedM5PrivacyAuthorityKind(params.categoryId)) {
          const error = new Error('Rotation authority kind does not match the category');
          error.code = 'M5_PRIVACY_INPUT_INVALID';
          throw error;
        }
        const receipt = privacyAuthority.recordRotation({
          authenticatedSubject,
          categoryId: params.categoryId,
          authorityKind: body.authorityKind,
          completedAtMs: body.completedAtMs,
        });
        return sendJSON(res, 201, receipt);
      })
    ),

    'POST /api/security/privacy/history/attest': (req, res) => (
      withUser(req, res, async authenticatedSubject => {
        const body = await parseBody(req);
        if (!exactBody(body, [
          'decision',
          'actionStatus',
          'repositoryVisibility',
          'completedAtMs',
          'confirmOperatorAuthority',
          'confirmNoSecretValues',
        ])) {
          const error = new Error('History attestation body has unknown or missing fields');
          error.code = 'M5_PRIVACY_INPUT_INVALID';
          throw error;
        }
        if (body.confirmOperatorAuthority !== true || body.confirmNoSecretValues !== true) {
          const error = new Error('History attestation requires both explicit confirmations');
          error.code = 'M5_PRIVACY_INPUT_INVALID';
          throw error;
        }
        const receipt = privacyAuthority.recordHistory({
          authenticatedSubject,
          decision: body.decision,
          actionStatus: body.actionStatus,
          repositoryVisibility: body.repositoryVisibility,
          completedAtMs: body.completedAtMs,
        });
        return sendJSON(res, 201, receipt);
      })
    ),
  });
}

export default createPrivacyRoutes;
