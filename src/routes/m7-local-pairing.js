import { normalizeM7RemoteScopes } from '../remote/m7-session-authority-validation.js';
import {
  isGenuineM7SessionAuthority,
} from '../remote/m7-session-authority.js';

export const M7_LOCAL_PAIRING_ROUTE = 'POST /api/m7/remote/pairing/claims';

export const M7_LOCAL_PAIRING_ERROR = Object.freeze({
  AUTH_REQUIRED: 'M7_LOCAL_PAIRING_AUTH_REQUIRED',
  BODY_INVALID: 'M7_LOCAL_PAIRING_BODY_INVALID',
  NOT_ACTIVE: 'M7_LOCAL_PAIRING_NOT_ACTIVE',
  REQUEST_FAILED: 'M7_LOCAL_PAIRING_REQUEST_FAILED',
});

function plain(value) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function exactKeys(value, keys) {
  return plain(value)
    && Object.keys(value).length === keys.length
    && keys.every(key => Object.hasOwn(value, key));
}

function sendNoStore(res, sendJSON, status, body) {
  res.setHeader('Cache-Control', 'no-store, max-age=0');
  res.setHeader('Pragma', 'no-cache');
  return sendJSON(res, status, body);
}

function failureStatus(error) {
  if (error?.code === 'M7_SESSION_PAIRING_DISABLED') return 409;
  if (error?.code === 'M7_SESSION_STORAGE_FAILURE') return 503;
  if (error?.code === 'M7_SESSION_OPERATOR_AUTHORITY_DENIED') return 403;
  if (typeof error?.code === 'string' && error.code.startsWith('M7_SESSION_')) return 400;
  return 500;
}

export function createM7LocalPairingRoutes({
  isAuthenticatedSubject,
  parseBody,
  resolveSessionAuthority,
  sendJSON,
} = {}) {
  if (typeof isAuthenticatedSubject !== 'function'
    || typeof parseBody !== 'function'
    || typeof resolveSessionAuthority !== 'function'
    || typeof sendJSON !== 'function') {
    throw new TypeError('m7-local-pairing:dependencies-invalid');
  }
  return Object.freeze({
    [M7_LOCAL_PAIRING_ROUTE]: async (req, res) => {
      const subject = req?.authenticatedSubject;
      if (req?.authenticatedCredentialType !== 'local-capability'
        || !isAuthenticatedSubject(subject)
        || subject.actorType !== 'user'
        || typeof subject.actorId !== 'string'
        || subject.actorId.length < 1) {
        return sendNoStore(res, sendJSON, 403, {
          code: M7_LOCAL_PAIRING_ERROR.AUTH_REQUIRED,
          error: 'An authenticated local Studio capability is required.',
        });
      }
      const authority = resolveSessionAuthority();
      if (!isGenuineM7SessionAuthority(authority)) {
        return sendNoStore(res, sendJSON, 503, {
          code: M7_LOCAL_PAIRING_ERROR.NOT_ACTIVE,
          error: 'Remote pairing is not active.',
        });
      }
      const body = await parseBody(req);
      if (!exactKeys(body, ['scopes'])) {
        return sendNoStore(res, sendJSON, 400, {
          code: M7_LOCAL_PAIRING_ERROR.BODY_INVALID,
          error: 'The exact pairing scope list is required.',
        });
      }
      let scopes;
      try {
        scopes = normalizeM7RemoteScopes(body.scopes);
      } catch {
        return sendNoStore(res, sendJSON, 400, {
          code: M7_LOCAL_PAIRING_ERROR.BODY_INVALID,
          error: 'The pairing scope list is invalid.',
        });
      }
      try {
        const claim = authority.issuePairingClaim({
          authenticatedSubject: subject,
          credentialType: req.authenticatedCredentialType,
          scopes,
          subjectId: subject.actorId,
        });
        return sendNoStore(res, sendJSON, 201, {
          claimCode: claim.claimCode,
          claimId: claim.claimId,
          contract: 'M7LocalPairingClaim',
          expiresAt: claim.expiresAt,
          pairingUri: `intentsmith://pair?code=${claim.claimCode}`,
          scopes: [...claim.scopes],
          subjectId: claim.subjectId,
          version: 1,
        });
      } catch (error) {
        const status = failureStatus(error);
        return sendNoStore(res, sendJSON, status, {
          code: status === 500 ? M7_LOCAL_PAIRING_ERROR.REQUEST_FAILED : error.code,
          error: status === 500
            ? 'Remote pairing request failed.'
            : 'Remote pairing request was denied.',
        });
      }
    },
  });
}

export default createM7LocalPairingRoutes;
