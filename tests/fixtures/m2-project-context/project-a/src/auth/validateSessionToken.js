export const SESSION_VALIDATION_RESULT = 'project-a-session-valid';

export function validateSessionToken(token) {
  if (typeof token !== 'string' || token.length === 0) return false;
  return token.startsWith('session-a:validateSessionToken');
}
