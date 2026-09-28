// Separate contract: EffectRequest@2 is reserved for project-root file.list.
// This scope authorizes one exact HTTPS GET in the local operator's conversation.
import { createHash } from 'node:crypto';

export const CONVERSATION_WEB = Object.freeze({
  contract: 'ConversationWebRequest', version: 1,
  maxUrlBytes: 2048, maxResponseBytes: 1048576, timeoutMs: 15000, approvalTtlMs: 300000,
});
export const webDigest = bytes => createHash('sha256').update(bytes).digest('hex');
export function webError(code) { return Object.assign(new Error(code), { code }); }

export function canonicalWebUrl(input) {
  if (typeof input !== 'string' || /[\s\u0000-\u001f\u007f]/u.test(input)) throw webError('WEB_URL_INVALID');
  let url;
  try { url = new URL(input); } catch { throw webError('WEB_URL_INVALID'); }
  if (url.protocol !== 'https:' || url.username || url.password || url.hash || url.port
    || Buffer.byteLength(url.href) > CONVERSATION_WEB.maxUrlBytes) throw webError('WEB_URL_INVALID');
  return url.href;
}

export function parseWebApproval(input) {
  return String(input || '').trim().match(/^(?:schv[aá]lit\s+web|approve\s+web)\s+(web:[a-f0-9]{64})$/iu)?.[1] || null;
}

export function requireWebIdentity(context) {
  // Shape check only. The repository must additionally verify the opaque local
  // transport brand; the remote M7 principal can share the same actor ID.
  if (context?.authenticatedSubject?.actorType !== 'user'
    || context.authenticatedSubject.actorId !== 'local-operator'
    || typeof context.conversationId !== 'string' || !context.conversationId
    || !Number.isSafeInteger(context.userMessageId) || context.userMessageId < 1) {
    throw webError('WEB_IDENTITY_REQUIRED');
  }
  return context.authenticatedSubject.actorId;
}
