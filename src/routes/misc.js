import { getCurrentVersion } from '../packaging/auto-updater.js';
import { featureManager } from '../core/feature-manager.js';
import config from '../config.js';
import { writeFile, mkdir } from 'fs/promises';
import { join } from 'path';
import { getWebSocketBridgeHealth } from '../ws-bridge/ws-server.js';
import {
  POLICY_SOURCE,
  readModelAutomationPolicy,
  resetModelAutomationPolicy,
  stripReservedAutomationKeys,
  updateModelAutomationPolicy,
} from '../db/model-policy.js';

// H9: Settings, Health, Autocomplete, Audit, Logs routes
const _fbRateMap = new Map(); // IP → last feedback timestamp (rate limit)
export function createMiscRoutes(deps) {
  const { db, parseBody, sendJSON, safeError, logger, callWithAuth, createAuthToken, LLMCallerRole } = deps;
  return {
    // Storage info
    'GET /api/storage/info': async (req, res) => {
      try {
        const result = db.attachments.getTotalSize.get();
        sendJSON(res, 200, { totalSize: result?.total || 0 });
      } catch (err) {
        sendJSON(res, 200, { totalSize: 0 });
      }
    },

    'GET /api/settings': async (req, res) => {
      try {
        const row = db.db.prepare('SELECT data FROM user_settings WHERE id = 1').get();
        if (row) {
          // Decision 020/E: the owned automation keys are not emitted here, so a
          // client has nothing to post back and cannot round-trip a policy.
          sendJSON(res, 200, stripReservedAutomationKeys(JSON.parse(row.data)).settings);
        } else {
          sendJSON(res, 200, {});
        }
      } catch (err) {
        sendJSON(res, 200, {});
      }
    },

    'POST /api/settings': async (req, res) => {
      const body = await parseBody(req);
      try {
        db.db.exec(`
          CREATE TABLE IF NOT EXISTS user_settings (
            id INTEGER PRIMARY KEY,
            data TEXT NOT NULL,
            updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
          )
        `);

        // Decision 020/E: drop, not reject — rejecting would turn every Studio
        // settings save into a 400 on installations whose document already has
        // `models`. Foreign keys inside `models` survive untouched.
        const { settings, ignoredReservedKeys } = stripReservedAutomationKeys(body);

        db.db.prepare(`
          INSERT OR REPLACE INTO user_settings (id, data, updated_at)
          VALUES (1, ?, datetime('now'))
        `).run(JSON.stringify(settings));

        // The sanitized document also goes to the runtime: an unsaved policy
        // must not reach the feature manager either.
        const changed = featureManager.applySettings(settings);

        sendJSON(res, 200, {
          success: true,
          featuresChanged: changed || 0,
          ignoredReservedKeys,
        });
      } catch (err) {
        sendJSON(res, 500, safeError(err));
      }
    },

    // Decision 020/E: the explicit, versioned adapter. Unlike the generic save
    // this one may carry policy — and it is atomic with the general document,
    // so a failed import leaves neither half applied.
    'POST /api/settings/import': async (req, res) => {
      const body = await parseBody(req);
      try {
        if (!body || typeof body !== 'object' || Array.isArray(body)) {
          return sendJSON(res, 400, { error: 'Import body must be an object' });
        }
        if (body.version !== 1) {
          return sendJSON(res, 400, { error: 'Unsupported import version' });
        }
        const settings = body.settings;
        if (!settings || typeof settings !== 'object' || Array.isArray(settings)) {
          return sendJSON(res, 400, { error: 'Import settings must be an object' });
        }
        db.db.exec(`
          CREATE TABLE IF NOT EXISTS user_settings (
            id INTEGER PRIMARY KEY,
            data TEXT NOT NULL,
            updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
          )
        `);
        const sanitized = stripReservedAutomationKeys(settings).settings;
        const apply = db.db.transaction(() => {
          db.db.prepare(`
            INSERT OR REPLACE INTO user_settings (id, data, updated_at)
            VALUES (1, ?, datetime('now'))
          `).run(JSON.stringify(sanitized));
          if (body.policy !== undefined) {
            updateModelAutomationPolicy(db.db, {
              values: body.policy,
              actor: 'user:explicit-import',
              source: POLICY_SOURCE.EXPLICIT_IMPORT,
            });
          }
        });
        apply();
        const changed = featureManager.applySettings(sanitized);
        sendJSON(res, 200, {
          ok: true,
          featuresChanged: changed || 0,
          policy: readModelAutomationPolicy(db.db).policy,
        });
      } catch (err) {
        sendJSON(res, err?.httpStatus || 500, safeError(err));
      }
    },

    // ── Feature Flags ───────────────────────────────────────────────────
    'GET /api/features': (req, res) => {
      sendJSON(res, 200, { features: featureManager.getAll() });
    },

    'POST /api/features/reset': (req, res) => {
      featureManager.resetToDefaults(config.features);
      sendJSON(res, 200, { ok: true, features: featureManager.getAll() });
    },

    'POST /api/features/:name': async (req, res, params) => {
      const name = params.name;
      if (!featureManager.has(name)) {
        return sendJSON(res, 400, { error: `Unknown feature: ${name}` });
      }
      const body = await parseBody(req);
      featureManager.set(name, !!body.enabled);
      sendJSON(res, 200, { ok: true, features: featureManager.getAll() });
    },

    'GET /api/health': (req, res) => {
      sendJSON(res, 200, {
        status: 'ok',
        version: getCurrentVersion(),
        timestamp: new Date().toISOString(),
        llm: true,
        cwd: process.cwd(),
        wsBridge: getWebSocketBridgeHealth(),
      });
    },

    'POST /api/autocomplete': async (req, res) => {
      const body = await parseBody(req);
      const prefix = (body.partial || '').trim();
      if (prefix.length < 3) return sendJSON(res, 200, { suggestion: null });

      try {
        const token = createAuthToken({
          role: LLMCallerRole.SYNTHESIZER,
          decisionId: `autocomplete_${Date.now()}`,
          auditContext: { sessionId: 'ide-autocomplete' },
          maxTokens: 80,
        });
        const context = (body.context || []).map(m => ({
          role: m.role === 'system' ? 'system' : m.role === 'user' ? 'user' : 'assistant',
          content: m.text || '',
        }));
        const messages = [
          ...context.slice(-4),
          { role: 'user', content: prefix },
        ];
        const result = await callWithAuth(token, '', {
          systemPrompt: 'Dokonči uživatelovu zprávu. Vrať POUZE doplnění textu, nic dalšího. Odpovídej v češtině.',
          messages,
          temperature: 0.3,
        });
        const suggestion = (result.content || '').trim();
        sendJSON(res, 200, { suggestion: suggestion || null });
      } catch (err) {
        logger.debug('Server', `Autocomplete error: ${err.message}`);
        sendJSON(res, 200, { suggestion: null });
      }
    },

    'POST /api/context': (req, res) => {
      // Stub — rough estimate based on message count
      let body = '';
      req.on('data', c => { body += c; });
      req.on('end', () => {
        try {
          const data = JSON.parse(body);
          const msgCount = data.messageCount || 0;
          const percent = Math.min(95, Math.round((msgCount * 800 / 32000) * 100));
          sendJSON(res, 200, { percent });
        } catch {
          sendJSON(res, 200, { percent: 0 });
        }
      });
    },

    'GET /api/audit': async (req, res) => {
      try {
        const url = new URL(req.url, `http://${req.headers.host}`);
        const convId = url.searchParams.get('conversation_id');
        const limit = Math.min(parseInt(url.searchParams.get('limit') || '100'), 500);

        let auditLogs = [];
        let driftLogs = [];

        try {
          auditLogs = convId
            ? db.db.prepare('SELECT * FROM merge_audit_log WHERE conversation_id=? ORDER BY created_at DESC LIMIT ?').all(convId, limit)
            : db.db.prepare('SELECT * FROM merge_audit_log ORDER BY created_at DESC LIMIT ?').all(limit);
        } catch { /* table may not exist yet */ }

        try {
          driftLogs = convId
            ? db.db.prepare('SELECT * FROM capability_drift_log WHERE conversation_id=? ORDER BY created_at DESC LIMIT ?').all(convId, limit)
            : db.db.prepare('SELECT * FROM capability_drift_log ORDER BY created_at DESC LIMIT ?').all(limit);
        } catch { /* table may not exist yet */ }

        sendJSON(res, 200, { audit: auditLogs, drift: driftLogs });
      } catch (err) {
        sendJSON(res, 500, { error: err.message });
      }
    },

    'GET /api/logs': async (req, res) => {
      try {
        const logs = db.db.prepare(`
          SELECT * FROM logs 
          ORDER BY created_at DESC 
          LIMIT 1000
        `).all();
        sendJSON(res, 200, { logs });
      } catch (err) {
        sendJSON(res, 200, { logs: [] });
      }
    },

    'GET /api/logs/export': async (req, res) => {
      try {
        const logs = db.db.prepare(`
          SELECT * FROM logs 
          ORDER BY created_at DESC
        `).all();

        const content = logs.map(l => 
          `[${l.created_at}] [${l.level}] ${l.message}`
        ).join('\n');

        res.writeHead(200, {
          'Content-Type': 'text/plain',
          'Content-Disposition': 'attachment; filename=paiass-logs.log'
        });
        res.end(content);
      } catch (err) {
        res.writeHead(500);
        res.end('Error exporting logs');
      }
    },

    'POST /api/reset': async (req, res) => {
      try {
        // Decision 020/E: a global reset is an audited transition to OFF, not a
        // silent disappearance of the policy. Both halves commit together.
        const clear = db.db.transaction(() => {
          db.db.exec('DELETE FROM user_settings');
          resetModelAutomationPolicy(db.db, { actor: 'user:explicit-reset' });
        });
        clear();
        sendJSON(res, 200, { success: true, message: 'Settings cleared' });
      } catch (err) {
        sendJSON(res, 500, safeError(err));
      }
    },

    // ── Feedback ──────────────────────────────────────────────────────────
    'POST /api/feedback': async (req, res) => {
      // Rate limit: 1 per 30s per IP
      const ip = req.socket?.remoteAddress || 'unknown';
      const now = Date.now();
      if (_fbRateMap.get(ip) > now - 30000) {
        return sendJSON(res, 429, { error: 'Too many requests. Wait 30s.' });
      }
      _fbRateMap.set(ip, now);

      const body = await parseBody(req);
      const message = (body.message || '').trim();
      if (!message) {
        return sendJSON(res, 400, { error: 'Message is required' });
      }
      if (message.length > 2000) {
        return sendJSON(res, 400, { error: 'Message too long (max 2000 chars)' });
      }
      const VALID_CATS = ['bug', 'performance', 'ux', 'feature', 'other'];
      const category = VALID_CATS.includes(body.category) ? body.category : 'other';
      const version = body.version || null;
      const context = body.context ? JSON.stringify(body.context) : null;
      const lastResponse = typeof body.lastResponse === 'string' ? body.lastResponse.slice(0, 4000) : null;
      try {
        const result = db.db.prepare(
          'INSERT INTO feedback (category, message, version, context, last_response) VALUES (?, ?, ?, ?, ?)'
        ).run(category, message, version, context, lastResponse);
        sendJSON(res, 201, { ok: true, id: Number(result.lastInsertRowid) });
      } catch (err) {
        sendJSON(res, 500, { error: 'Failed to save feedback' });
      }
    },

    'POST /api/feedback/:id/attach': async (req, res, params) => {
      const feedbackId = parseInt(params.id);
      if (!feedbackId) return sendJSON(res, 400, { error: 'Invalid feedback ID' });

      // Verify feedback exists
      const fb = db.db.prepare('SELECT id FROM feedback WHERE id = ?').get(feedbackId);
      if (!fb) return sendJSON(res, 404, { error: 'Feedback not found' });

      const body = await parseBody(req);
      const name = (body.name || '').replace(/[^a-zA-Z0-9._-]/g, '_').replace(/\.{2,}/g, '.').replace(/^[._-]+/, '').slice(0, 100) || 'file';
      const mimeType = body.type || 'application/octet-stream';
      const data = body.data; // base64

      if (!name || !data || typeof data !== 'string') {
        return sendJSON(res, 400, { error: 'name and data (base64) required' });
      }

      // Decode base64
      const buf = Buffer.from(data, 'base64');
      if (buf.length > 2 * 1024 * 1024) {
        return sendJSON(res, 400, { error: 'File too large (max 2MB)' });
      }

      // Check total attachments for this feedback (max 5MB)
      try {
        const total = db.db.prepare('SELECT COALESCE(SUM(size),0) as total FROM feedback_attachments WHERE feedback_id = ?').get(feedbackId);
        if ((total?.total || 0) + buf.length > 5 * 1024 * 1024) {
          return sendJSON(res, 400, { error: 'Total attachments too large (max 5MB)' });
        }
      } catch (_) { /* table may not exist yet */ }

      // Write to disk
      const dir = join(process.cwd(), 'data', 'feedback', String(feedbackId));
      try {
        await mkdir(dir, { recursive: true });
        const filePath = join(dir, name);
        await writeFile(filePath, buf);

        db.db.prepare(
          'INSERT INTO feedback_attachments (feedback_id, filename, mime_type, size, path) VALUES (?, ?, ?, ?, ?)'
        ).run(feedbackId, name, mimeType, buf.length, filePath);

        sendJSON(res, 201, { ok: true, filename: name, size: buf.length });
      } catch (err) {
        sendJSON(res, 500, { error: 'Failed to save attachment' });
      }
    },

    'GET /api/feedback': (req, res) => {
      try {
        const rows = db.db.prepare(
          'SELECT id, category, message, version, context, created_at FROM feedback ORDER BY created_at DESC LIMIT 100'
        ).all();
        // Attach attachment count per feedback
        for (const row of rows) {
          try {
            const cnt = db.db.prepare('SELECT COUNT(*) as c FROM feedback_attachments WHERE feedback_id = ?').get(row.id);
            row.attachments = cnt?.c || 0;
          } catch (_) { row.attachments = 0; }
        }
        sendJSON(res, 200, { feedback: rows });
      } catch (_) {
        sendJSON(res, 200, { feedback: [] });
      }
    },
  };
}
