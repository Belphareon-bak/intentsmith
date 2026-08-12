import { createHash, timingSafeEqual } from 'node:crypto';

export const SETUP_ADMIN_AUTH_REQUIRED = 'SETUP_ADMIN_AUTH_REQUIRED';

function digestToken(value) {
  return createHash('sha256').update(value, 'utf8').digest();
}

function credentialHeaderCensus(req) {
  if (req?.rawHeaders === undefined) return null;
  if (!Array.isArray(req.rawHeaders) || req.rawHeaders.length % 2 !== 0) return false;
  const found = [];
  for (let index = 0; index < req.rawHeaders.length; index += 2) {
    const name = req.rawHeaders[index];
    const value = req.rawHeaders[index + 1];
    if (typeof name !== 'string' || typeof value !== 'string') return false;
    const normalizedName = name.toLowerCase();
    if (normalizedName === 'x-admin-token' || normalizedName === 'authorization') {
      found.push([normalizedName, value]);
    }
  }
  return found;
}

function readPresentedToken(req) {
  const headers = req?.headers;
  if (!headers || typeof headers !== 'object' || Array.isArray(headers)) return null;

  const hasDirect = Object.hasOwn(headers, 'x-admin-token');
  const hasAuthorization = Object.hasOwn(headers, 'authorization');
  if (hasDirect === hasAuthorization) return null;
  const name = hasDirect ? 'x-admin-token' : 'authorization';
  const value = headers[name];
  if (typeof value !== 'string') return null;

  const census = credentialHeaderCensus(req);
  if (census === false || (census !== null
    && (census.length !== 1 || census[0][0] !== name || census[0][1] !== value))) {
    return null;
  }

  if (hasDirect) {
    if (value.length === 0 || /[\s,\0]/u.test(value)) return null;
    return value;
  }

  const match = /^Bearer ([^\s,]+)$/u.exec(value);
  return match?.[1] || null;
}

/**
 * Capture the strict admin-token authority once during startup. The returned
 * guard has no localhost/development bypass and never reads process.env again.
 */
export function createStrictAdminTokenGuard({ expectedToken } = {}) {
  const configured = typeof expectedToken === 'string'
    && expectedToken.length > 0
    && !/[\s,\0]/u.test(expectedToken);
  const expectedDigest = digestToken(configured ? expectedToken : '');

  return function requireStrictAdminAuth(req) {
    const presented = readPresentedToken(req);
    const presentedDigest = digestToken(presented || '');
    const matches = timingSafeEqual(presentedDigest, expectedDigest);
    return configured && presented !== null && matches;
  };
}
