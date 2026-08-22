// C3 Studio — attachment byte bridge (decision 021, byte bridge).
//
// The renderer cannot read files it names. `showOpenDialog` hands back paths,
// and a path is not bytes: the panel used to fabricate a `File`-shaped object
// around one, `FileReader` returned empty, and the inline-only attachment
// policy correctly refused an item the user had just picked.
//
// The bridge closes that without giving the renderer disk read authority. A
// path only ever enters this module from a native dialog the user just
// dismissed, and leaves as an opaque single-use token. `readTokenBytes` is the
// only way back to bytes, so the renderer's reach is exactly "the files I was
// shown choosing", never "the path I can spell".
//
// The ceiling is enforced from `fstat` on the open descriptor BEFORE any buffer
// is allocated. That is the point of doing this here rather than in the panel:
// a 2 GiB pick costs one stat, not 2 GiB of renderer heap followed by a policy
// rejection.
const fs = require('node:fs');
const crypto = require('node:crypto');
const path = require('node:path');

/** Tokens outlive the dialog only long enough for the panel to read them. */
const TOKEN_TTL_MS = 5 * 60 * 1000;

/**
 * Memory guard, not the attachment policy.
 *
 * The policy ceilings live in src/ws-bridge/m1-attachment-policy.js and are
 * mirrored client-side; the panel passes the per-kind ceiling it is about to
 * enforce as `maxBytes`. This cap only bounds what a caller can ask for, so a
 * renderer bug cannot turn one pick into an unbounded allocation. It is
 * deliberately well above any policy ceiling — if it ever starts refusing real
 * attachments, the policy is what should be revisited, not this number.
 */
const HARD_READ_CAP_BYTES = 32 * 1024 * 1024;

const REJECTION = Object.freeze({
  NO_TOKEN: 'M1_BRIDGE_TOKEN_UNKNOWN',
  EXPIRED: 'M1_BRIDGE_TOKEN_EXPIRED',
  NOT_A_FILE: 'M1_BRIDGE_NOT_A_FILE',
  TOO_LARGE: 'M1_BRIDGE_ITEM_TOO_LARGE',
  CHANGED: 'M1_BRIDGE_FILE_CHANGED',
  READ_FAILED: 'M1_BRIDGE_READ_FAILED',
});

const TEXT_MEDIA_TYPES = Object.freeze({
  '.json': 'application/json',
  '.md': 'text/markdown',
  '.csv': 'text/csv',
  '.html': 'text/html',
  '.htm': 'text/html',
  '.css': 'text/css',
});

/**
 * Every extension the panel treats as an image, including the ones the
 * attachment policy refuses.
 *
 * Reporting an SVG or a BMP as `text/plain` would be worse than reporting it
 * accurately and having it rejected: the panel reads anything matching its
 * image test as a data URL, so a laundered type would arrive as
 * `data:text/plain;base64,...` and be measured and delivered as text. A dragged
 * SVG is refused as an unsupported type, and a picked one has to be refused the
 * same way — the bridge states what the file is and lets the policy make one
 * decision about it.
 */
const IMAGE_MEDIA_TYPES = Object.freeze({
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.svg': 'image/svg+xml',
  '.bmp': 'image/bmp',
  '.ico': 'image/x-icon',
  '.tif': 'image/tiff',
  '.tiff': 'image/tiff',
  '.avif': 'image/avif',
});

/**
 * Media type for a picked file.
 *
 * Unknown extensions are offered as text, which is what the panel's own
 * extension test already assumed; the panel's binary branch still refuses
 * anything it cannot read.
 */
function mediaTypeForName(name) {
  const extension = path.extname(name).toLowerCase();
  if (IMAGE_MEDIA_TYPES[extension]) return IMAGE_MEDIA_TYPES[extension];
  return TEXT_MEDIA_TYPES[extension] || 'text/plain';
}

function clampCeiling(maxBytes) {
  if (!Number.isInteger(maxBytes) || maxBytes <= 0) return HARD_READ_CAP_BYTES;
  return Math.min(maxBytes, HARD_READ_CAP_BYTES);
}

/**
 * @param {{now?: () => number, fileSystem?: typeof fs, randomToken?: () => string}} [dependencies]
 */
function createAttachmentBridge(dependencies = {}) {
  const now = dependencies.now || Date.now;
  const fileSystem = dependencies.fileSystem || fs;
  const randomToken = dependencies.randomToken
    || (() => crypto.randomBytes(32).toString('hex'));
  /** @type {Map<string, {path: string, size: number, mtimeMs: number, expiresAt: number}>} */
  const grants = new Map();

  function dropExpired() {
    const cutoff = now();
    for (const [token, grant] of grants) {
      if (grant.expiresAt <= cutoff) grants.delete(token);
    }
  }

  /**
   * Mint one grant per path the dialog returned.
   *
   * A path that is not a regular file right now is dropped rather than granted:
   * the panel has no use for it and a directory would only fail later, further
   * from the pick that produced it.
   */
  function grantPaths(filePaths) {
    dropExpired();
    const files = [];
    let directory = null;
    for (const filePath of Array.isArray(filePaths) ? filePaths : []) {
      if (typeof filePath !== 'string' || filePath.length === 0) continue;
      let stats;
      try {
        stats = fileSystem.statSync(filePath);
      } catch {
        continue;
      }
      if (!stats.isFile()) continue;
      const token = randomToken();
      grants.set(token, {
        path: filePath,
        size: stats.size,
        mtimeMs: stats.mtimeMs,
        expiresAt: now() + TOKEN_TTL_MS,
      });
      /* The containing directory, so the next dialog can open where this one
         left off. It is not read authority: the renderer already chooses the
         dialog's starting directory, and a token is still the only way to
         bytes. */
      if (directory === null) directory = path.dirname(filePath);
      files.push({
        token,
        name: path.basename(filePath),
        size: stats.size,
        type: mediaTypeForName(filePath),
      });
    }
    return { directory, files };
  }

  /**
   * Spend a token for bytes.
   *
   * The token is consumed whether or not the read succeeds — a grant stands for
   * one user gesture, and a failed read does not hand back a second attempt at
   * the same file. Size is re-checked on the open descriptor rather than
   * trusting the size recorded at pick time, so a file that grew between the
   * dialog and the read cannot slip past the ceiling.
   */
  function readTokenBytes(token, maxBytes) {
    dropExpired();
    if (typeof token !== 'string' || !grants.has(token)) {
      return { ok: false, code: REJECTION.NO_TOKEN };
    }
    const grant = grants.get(token);
    grants.delete(token);
    if (grant.expiresAt <= now()) return { ok: false, code: REJECTION.EXPIRED };

    const ceiling = clampCeiling(maxBytes);
    let descriptor;
    try {
      descriptor = fileSystem.openSync(grant.path, 'r');
      const stats = fileSystem.fstatSync(descriptor);
      if (!stats.isFile()) return { ok: false, code: REJECTION.NOT_A_FILE };
      /* Refuse before allocating, not after reading. */
      if (stats.size > ceiling) {
        return { ok: false, code: REJECTION.TOO_LARGE, size: stats.size, limit: ceiling };
      }
      const buffer = Buffer.alloc(stats.size);
      let read = 0;
      while (read < buffer.length) {
        const chunk = fileSystem.readSync(descriptor, buffer, read, buffer.length - read, read);
        if (chunk === 0) break;
        read += chunk;
      }
      if (read !== buffer.length) return { ok: false, code: REJECTION.CHANGED };
      /* A Uint8Array copy crosses contextBridge as structured-cloneable data;
         a Buffer would arrive as a plain object with a numeric-keyed body. */
      return { ok: true, bytes: new Uint8Array(buffer), size: read };
    } catch {
      return { ok: false, code: REJECTION.READ_FAILED };
    } finally {
      if (descriptor !== undefined) {
        try { fileSystem.closeSync(descriptor); } catch { /* already gone */ }
      }
    }
  }

  return {
    grantPaths,
    readTokenBytes,
    /** Test seam only — the renderer never sees this. */
    _grantCount: () => grants.size,
  };
}

module.exports = {
  HARD_READ_CAP_BYTES,
  REJECTION,
  TOKEN_TTL_MS,
  clampCeiling,
  createAttachmentBridge,
  mediaTypeForName,
};
