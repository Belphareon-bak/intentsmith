// M1 attachment policy — decision 021/R1 variant B.
//
// The old path was not "deliver bytes": ChatController reads `a.path` from disk
// when an attachment has no content, so accepting a caller-supplied path over
// the wire would hand a remote command read authority over the backend
// filesystem. Inline-only removes that entirely — `path` does not appear in the
// DTO at all, not even as null.
//
// This module is the single named seam for the limits. Decision 021 is explicit
// that some of these numbers are NEW runtime policy rather than inherited
// values, and that they may only change here, together with their test, and
// from measurement rather than by quietly removing the limit.

/**
 * Per-item ceilings come from the product's real attachment authority:
 * `config.limits.maxTextAttachment` / `maxImageAttachment` (overridable via
 * C3_MAX_TEXT_ATTACHMENT / C3_MAX_IMAGE_ATTACHMENT). The 10 MiB settings slider
 * is deliberately NOT an input here — it is disconnected from this path.
 *
 * `maxCount`, `maxAggregateBytes` and `maxFrameBytes` are new policy: today's UI
 * has no attachment count and the WS server has no project payload ceiling, so
 * there was nothing to inherit. They are set conservatively from the per-item
 * authority, not guessed from expected traffic.
 */
export function createM1AttachmentLimits(limits = {}) {
  const maxTextBytes = Number.isInteger(limits.maxTextAttachment) && limits.maxTextAttachment > 0
    ? limits.maxTextAttachment
    : 1024 * 1024;
  const maxImageBytes = Number.isInteger(limits.maxImageAttachment) && limits.maxImageAttachment > 0
    ? limits.maxImageAttachment
    : 5 * 1024 * 1024;
  return Object.freeze({
    maxCount: 5,
    maxTextBytes,
    maxImageBytes,
    // One oversized image plus a few text files, and never more than the frame.
    maxAggregateBytes: maxImageBytes + (3 * maxTextBytes),
    // The serialized frame ceiling the WS server enforces as maxPayload.
    maxFrameBytes: maxImageBytes + (3 * maxTextBytes) + (1024 * 1024),
  });
}

export const M1_ATTACHMENT_IMAGE_TYPES = Object.freeze([
  'image/png',
  'image/jpeg',
  'image/gif',
  'image/webp',
]);

export const M1_ATTACHMENT_REJECTION = Object.freeze({
  SHAPE: 'M1_ATTACHMENT_SHAPE_INVALID',
  PATH_PRESENT: 'M1_ATTACHMENT_PATH_FORBIDDEN',
  COUNT: 'M1_ATTACHMENT_COUNT_EXCEEDED',
  TYPE: 'M1_ATTACHMENT_TYPE_UNSUPPORTED',
  ITEM_BYTES: 'M1_ATTACHMENT_ITEM_TOO_LARGE',
  AGGREGATE_BYTES: 'M1_ATTACHMENT_AGGREGATE_TOO_LARGE',
});

function isPlainRecord(value) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

/**
 * Decoded byte length of an attachment's inline content.
 *
 * Text is measured as UTF-8 bytes. An image arrives as a data URL, so its real
 * cost is the decoded base64 payload, not the string length — measuring the
 * string would let a 5 MiB image pass a 5 MiB limit as ~6.7 MiB on the wire.
 */
export function m1AttachmentByteLength(attachment) {
  const content = attachment?.content;
  if (typeof content !== 'string') return null;
  const dataUrl = /^data:([^;,]+);base64,(.*)$/s.exec(content);
  if (!dataUrl) {
    // TextEncoder is available in both the browser bundle and Node.
    return new TextEncoder().encode(content).length;
  }
  const base64 = dataUrl[2];
  const padding = base64.endsWith('==') ? 2 : (base64.endsWith('=') ? 1 : 0);
  return Math.max(0, Math.floor((base64.length * 3) / 4) - padding);
}

function attachmentKind(attachment) {
  const type = typeof attachment?.type === 'string' ? attachment.type : '';
  if (M1_ATTACHMENT_IMAGE_TYPES.includes(type)) return 'image';
  if (type === '' || type.startsWith('text/') || type === 'application/json') return 'text';
  return null;
}

/**
 * Validate an inline-only attachment collection.
 *
 * The empty collection is always valid. Anything that fails is rejected as a
 * whole: a partially delivered set would be a different message than the user
 * composed.
 *
 * @returns {{ok: true, attachments: Array}|{ok: false, code: string, index: number|null}}
 */
export function validateM1Attachments(value, limits) {
  const ceilings = limits || createM1AttachmentLimits();
  if (!Array.isArray(value)) {
    return { ok: false, code: M1_ATTACHMENT_REJECTION.SHAPE, index: null };
  }
  if (value.length === 0) return { ok: true, attachments: [] };
  if (value.length > ceilings.maxCount) {
    return { ok: false, code: M1_ATTACHMENT_REJECTION.COUNT, index: null };
  }

  const normalized = [];
  let aggregate = 0;
  for (let index = 0; index < value.length; index += 1) {
    const attachment = value[index];
    if (!isPlainRecord(attachment)) {
      return { ok: false, code: M1_ATTACHMENT_REJECTION.SHAPE, index };
    }
    // `path` is not "ignored" — its presence rejects the whole collection, so a
    // filesystem-backed item can never be silently downgraded to inline.
    if (Object.hasOwn(attachment, 'path')) {
      return { ok: false, code: M1_ATTACHMENT_REJECTION.PATH_PRESENT, index };
    }
    const keys = Object.keys(attachment).sort();
    const allowed = ['content', 'name', 'type'];
    if (keys.some(key => !allowed.includes(key)) || !keys.includes('content') || !keys.includes('name')) {
      return { ok: false, code: M1_ATTACHMENT_REJECTION.SHAPE, index };
    }
    if (typeof attachment.name !== 'string' || attachment.name.length === 0
      || attachment.name.length > 512) {
      return { ok: false, code: M1_ATTACHMENT_REJECTION.SHAPE, index };
    }
    // An empty string is legitimate content — an empty file. Missing content is
    // not: that is the contentless item whose bytes the backend used to read.
    if (typeof attachment.content !== 'string') {
      return { ok: false, code: M1_ATTACHMENT_REJECTION.SHAPE, index };
    }
    const kind = attachmentKind(attachment);
    if (kind === null) {
      return { ok: false, code: M1_ATTACHMENT_REJECTION.TYPE, index };
    }
    const bytes = m1AttachmentByteLength(attachment);
    if (bytes === null) {
      return { ok: false, code: M1_ATTACHMENT_REJECTION.SHAPE, index };
    }
    const itemCeiling = kind === 'image' ? ceilings.maxImageBytes : ceilings.maxTextBytes;
    if (bytes > itemCeiling) {
      return { ok: false, code: M1_ATTACHMENT_REJECTION.ITEM_BYTES, index };
    }
    aggregate += bytes;
    if (aggregate > ceilings.maxAggregateBytes) {
      return { ok: false, code: M1_ATTACHMENT_REJECTION.AGGREGATE_BYTES, index };
    }
    const item = { name: attachment.name, content: attachment.content };
    if (typeof attachment.type === 'string') item.type = attachment.type;
    normalized.push(item);
  }
  return { ok: true, attachments: normalized };
}

export default {
  M1_ATTACHMENT_IMAGE_TYPES,
  M1_ATTACHMENT_REJECTION,
  createM1AttachmentLimits,
  m1AttachmentByteLength,
  validateM1Attachments,
};
