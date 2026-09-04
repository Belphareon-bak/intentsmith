// Security Routes — Auth guard, API tokens, audit, webhook secret
// ══════════════════════════════════════════════════════════════════════════════
//
// All routes require auth: localhost bypass (dev mode only) OR C3_ADMIN_TOKEN.
// Production without C3_ADMIN_TOKEN → process.exit(1) at startup.
//
// Token hashing: SHA-256, raw token returned ONCE at creation.
// Audit: unified view across CRE, merge, drift, LLM logs.
//
// ══════════════════════════════════════════════════════════════════════════════

import { createHash, randomBytes, timingSafeEqual } from 'crypto';
import { randomUUID } from 'crypto';

const MAX_AUDIT_LIMIT = 1000;
const DEFAULT_AUDIT_LIMIT = 100;

// ── Auth Guard ───────────────────────────────────────────────────────────────

function requireAuth(req, sendJSON, res) {
  // Strategy 1: localhost bypass ONLY in dev mode
  const isDev = process.env.NODE_ENV !== 'production';
  const remoteAddr = req.socket?.remoteAddress || '';
  const isLocalhost = ['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(remoteAddr);

  if (isDev && isLocalhost) return true;

  // Strategy 2: admin token (timing-safe comparison)
  const adminToken = process.env.C3_ADMIN_TOKEN;
  if (!adminToken) {
    sendJSON(res, 403, { error: 'Security routes require C3_ADMIN_TOKEN or localhost access' });
    return false;
  }

  const provided = req.headers['x-admin-token'] ||
    (req.headers['authorization'] || '').replace(/^Bearer\s+/i, '');

  if (!provided || !_timingSafeCompare(provided, adminToken)) {
    sendJSON(res, 403, { error: 'Invalid admin token' });
    return false;
  }

  return true;
}

function _timingSafeCompare(a, b) {
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  if (bufA.length !== bufB.length) {
    // Pad to equal length to prevent length-based timing leaks
    const maxLen = Math.max(bufA.length, bufB.length);
    const padA = Buffer.alloc(maxLen);
    const padB = Buffer.alloc(maxLen);
    bufA.copy(padA);
    bufB.copy(padB);
    timingSafeEqual(padA, padB); // always compare, but result is false
    return false;
  }
  return timingSafeEqual(bufA, bufB);
}

// ── Token helpers ────────────────────────────────────────────────────────────

function _hashToken(plaintext) {
  return createHash('sha256').update(plaintext).digest('hex');
}

// ── Routes ───────────────────────────────────────────────────────────────────

/**
 * @param {{ db: Object, parseBody: Function, sendJSON: Function, logger: Object, webhookSecretAuthority: Object, requireWebhookSecretAuthority: Function }} deps
 */
export function createSecurityRoutes({
  db,
  parseBody,
  sendJSON,
  logger,
  webhookSecretAuthority,
  requireWebhookSecretAuthority,
}) {
  const secretAuthority = requireWebhookSecretAuthority(webhookSecretAuthority);
  const rawDb = db.db || db;

  // ── Startup checks ──
  const isDev = process.env.NODE_ENV !== 'production';
  if (!isDev && !process.env.C3_ADMIN_TOKEN) {
    logger.error('Security', 'FATAL: NODE_ENV=production but C3_ADMIN_TOKEN is not set. Security routes cannot operate.');
    process.exit(1);
  }
  if (isDev) {
    logger.warn('Security', 'Running in DEV mode — localhost bypass active for security routes');
  }

  return {
    // ── Unified Audit ──────────────────────────────────────────────────────
    'GET /api/security/audit': (req, res) => {
      if (!requireAuth(req, sendJSON, res)) return;

      const url = new URL(req.url, `http://${req.headers.host}`);
      const type = url.searchParams.get('type') || 'all';
      const limit = Math.min(parseInt(url.searchParams.get('limit')) || DEFAULT_AUDIT_LIMIT, MAX_AUDIT_LIMIT);
      const since = url.searchParams.get('since');

      let sinceDate = null;
      if (since) {
        const parsed = new Date(since);
        if (!isNaN(parsed.getTime())) {
          sinceDate = parsed.toISOString();
        }
      }

      const results = {};

      const _query = (table, lim) => {
        try {
          if (sinceDate) {
            return rawDb.prepare(`SELECT * FROM ${table} WHERE created_at > ? ORDER BY created_at DESC LIMIT ?`).all(sinceDate, lim);
          }
          return rawDb.prepare(`SELECT * FROM ${table} ORDER BY created_at DESC LIMIT ?`).all(lim);
        } catch (_) {
          return [];
        }
      };

      if (type === 'cre' || type === 'all') {
        results.cre = _query('cre_audit_log', type === 'all' ? Math.ceil(limit / 4) : limit);
      }
      if (type === 'merge' || type === 'all') {
        results.merge = _query('merge_audit_log', type === 'all' ? Math.ceil(limit / 4) : limit);
      }
      if (type === 'drift' || type === 'all') {
        results.drift = _query('capability_drift_log', type === 'all' ? Math.ceil(limit / 4) : limit);
      }
      if (type === 'llm' || type === 'all') {
        results.llm = _query('llm_audit_log', type === 'all' ? Math.ceil(limit / 4) : limit);
      }

      sendJSON(res, 200, { type, limit, since: sinceDate, results });
    },

    // ── API Tokens: List ───────────────────────────────────────────────────
    'GET /api/security/tokens': (req, res) => {
      if (!requireAuth(req, sendJSON, res)) return;

      try {
        const tokens = rawDb.prepare(
          'SELECT id, name, scopes, last_used_at, expires_at, created_at FROM api_tokens ORDER BY created_at DESC'
        ).all();
        sendJSON(res, 200, { tokens });
      } catch (_) {
        sendJSON(res, 200, { tokens: [] });
      }
    },

    // ── API Tokens: Create ─────────────────────────────────────────────────
    'POST /api/security/tokens': async (req, res) => {
      if (!requireAuth(req, sendJSON, res)) return;

      const body = await parseBody(req);
      const name = (body.name || '').trim();
      if (!name) {
        return sendJSON(res, 400, { error: 'Token name is required' });
      }

      const id = randomUUID();
      const plaintext = 'c3_' + randomBytes(32).toString('hex');
      const tokenHash = _hashToken(plaintext);
      const scopes = JSON.stringify(body.scopes || []);
      const expiresAt = body.expiresIn
        ? new Date(Date.now() + body.expiresIn * 1000).toISOString()
        : null;

      try {
        rawDb.prepare(
          'INSERT INTO api_tokens (id, name, token_hash, scopes, expires_at) VALUES (?, ?, ?, ?, ?)'
        ).run(id, name, tokenHash, scopes, expiresAt);

        sendJSON(res, 201, {
          id,
          name,
          token: plaintext, // returned ONCE only
          scopes: body.scopes || [],
          expires_at: expiresAt,
          created_at: new Date().toISOString(),
        });
      } catch (err) {
        if (err.message?.includes('UNIQUE')) {
          return sendJSON(res, 409, { error: 'Token hash collision — retry' });
        }
        sendJSON(res, 500, { error: 'Failed to create token' });
      }
    },

    // ── API Tokens: Delete ─────────────────────────────────────────────────
    'DELETE /api/security/tokens/:id': (req, res, params) => {
      if (!requireAuth(req, sendJSON, res)) return;

      try {
        const result = rawDb.prepare('DELETE FROM api_tokens WHERE id = ?').run(params.id);
        if (result.changes === 0) {
          return sendJSON(res, 404, { error: 'Token not found' });
        }
        sendJSON(res, 200, { ok: true, deleted: params.id });
      } catch (_) {
        sendJSON(res, 500, { error: 'Failed to delete token' });
      }
    },

    // ── Webhook Secret ─────────────────────────────────────────────────────
    'GET /api/security/webhook-secret': (req, res) => {
      if (!requireAuth(req, sendJSON, res)) return;

      sendJSON(res, 200, secretAuthority.status());
    },

    'POST /api/security/webhook-secret': (req, res) => {
      if (!requireAuth(req, sendJSON, res)) return;

      return sendJSON(res, 410, {
        ok: false,
        code: 'CREDENTIAL_SOURCE_READ_ONLY',
      });
    },

    // ── Sessions ───────────────────────────────────────────────────────────
    'GET /api/security/sessions': (req, res) => {
      if (!requireAuth(req, sendJSON, res)) return;

      sendJSON(res, 200, {
        count: 0, // TODO: wire to actual WS connection count
        uptime_seconds: Math.round(process.uptime()),
      });
    },
  };
}

// ── Token Validation Helper ──────────────────────────────────────────────────
//
// validateApiToken(rawDb, token) — for middleware integration
// 1. Hash incoming token (SHA-256, includes c3_ prefix)
// 2. Lookup by hash in api_tokens
// 3. Check expires_at: if set AND expired → reject
// 4. Update last_used_at ONLY on successful validation
// 5. Return { valid, id, name, scopes } or { valid: false }
//
// The mobile gateway policy imports this helper for deterministic scope
// decisions. Listener wiring remains disabled until the separate gateway and
// its server-level negative tests are complete (G0-R032).

export function validateApiToken(rawDb, token) {
  if (!token || typeof token !== 'string') return { valid: false };

  const hash = _hashToken(token);
  try {
    const row = rawDb.prepare('SELECT id, name, scopes, expires_at FROM api_tokens WHERE token_hash = ?').get(hash);
    if (!row) return { valid: false };

    // Check expiry (UTC comparison)
    if (row.expires_at) {
      const expiresMs = new Date(row.expires_at).getTime();
      if (isNaN(expiresMs) || expiresMs < Date.now()) {
        return { valid: false, reason: 'expired' };
      }
    }

    // Update last_used_at ONLY on successful validation
    rawDb.prepare("UPDATE api_tokens SET last_used_at = datetime('now') WHERE id = ?").run(row.id);

    return {
      valid: true,
      id: row.id,
      name: row.name,
      scopes: JSON.parse(row.scopes || '[]'),
    };
  } catch (_) {
    return { valid: false };
  }
}

export default { createSecurityRoutes, validateApiToken };
