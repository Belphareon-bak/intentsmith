import { getCurrentVersion } from '../packaging/auto-updater.js';
import { featureManager } from '../core/feature-manager.js';
import config from '../config.js';
import { writeFile, mkdir } from 'fs/promises';
import { join } from 'path';
import { getWebSocketBridgeHealth } from '../ws-bridge/ws-server.js';
import {
  createModelAutomationPolicyRepository,
  sanitizeGenericModelAutomationSettings,
} from '../db/model-policy.js';
import {
  GENERIC_FEATURE_SETTING_KEYS,
  UserSettingsError,
  createUserSettingsRepository,
  mergeGenericUserSettings,
} from '../db/user-settings.js';

// H9: Settings, Health, Autocomplete, Audit, Logs routes
const _fbRateMap = new Map(); // IP → last feedback timestamp (rate limit)
const MODEL_POLICY_SETTINGS_HTTP_STATUS = Object.freeze({
  MODEL_AUTOMATION_POLICY_BACKUP_INPUT_INVALID: 400,
  MODEL_AUTOMATION_POLICY_BACKUP_VERSION_UNSUPPORTED: 400,
  MODEL_AUTOMATION_POLICY_BACKUP_GENERAL_SETTINGS_INVALID: 400,
  MODEL_AUTOMATION_POLICY_BACKUP_POLICY_INVALID: 400,
  MODEL_AUTOMATION_POLICY_BACKUP_SENSITIVE_KEYS_INVALID: 400,
  MODEL_AUTOMATION_POLICY_AUTO_FAILOVER_INVALID: 400,
  MODEL_AUTOMATION_POLICY_AUTO_CLEANUP_INVALID: 400,
  MODEL_AUTOMATION_POLICY_CLEANUP_DAYS_INVALID: 400,
  MODEL_AUTOMATION_POLICY_DB_BUSY: 503,
  MODEL_AUTOMATION_POLICY_ID_CONFLICT: 503,
  MODEL_AUTOMATION_POLICY_INVALID_STATE: 503,
  MODEL_AUTOMATION_POLICY_STORAGE_CONTRACT: 503,
  MODEL_AUTOMATION_POLICY_DB_WRITE_FAILED: 503,
  MODEL_AUTOMATION_POLICY_BACKUP_READ_FAILED: 503,
  MODEL_AUTOMATION_POLICY_STORED_GENERAL_SETTINGS_INVALID: 503,
  MODEL_AUTOMATION_POLICY_STORED_PORTABLE_VALUE_INVALID: 409,
});

function modelPolicySettingsHttpStatus(code) {
  return MODEL_POLICY_SETTINGS_HTTP_STATUS[code] || 500;
}

const USER_SETTINGS_HTTP_STATUS = Object.freeze({
  USER_SETTINGS_INPUT_INVALID: 400,
  USER_SETTINGS_EXPECTED_REVISION_INVALID: 400,
  USER_SETTINGS_PATH_UNOWNED: 400,
  USER_SETTINGS_VALUE_INVALID: 400,
  USER_SETTINGS_REVISION_CONFLICT: 409,
  USER_SETTINGS_ROW_MISSING: 503,
  USER_SETTINGS_JSON_INVALID: 503,
  USER_SETTINGS_DOCUMENT_NOT_OBJECT: 503,
  USER_SETTINGS_REVISION_INVALID: 503,
  USER_SETTINGS_REVISION_EXHAUSTED: 503,
  USER_SETTINGS_DB_READ_FAILED: 503,
  USER_SETTINGS_DB_WRITE_FAILED: 503,
  USER_SETTINGS_DB_BUSY: 503,
  USER_SETTINGS_STORAGE_CONTRACT: 503,
  USER_SETTINGS_TRANSACTION_FAILED: 503,
});

function userSettingsHttpStatus(code) {
  return USER_SETTINGS_HTTP_STATUS[code] || 500;
}

function publicPolicyCommit(policy) {
  return {
    revision: policy.revision,
    autoFailoverEnabled: policy.settings.autoFailoverEnabled,
    autoCleanupEnabled: policy.settings.autoCleanupEnabled,
    autoCleanupDays: policy.settings.autoCleanupDays,
    lastEventId: policy.lastEventId,
    updatedAtMs: policy.updatedAtMs,
  };
}

export function createMiscRoutes(deps) {
  const { db, parseBody, sendJSON, logger, callWithAuth, createAuthToken, LLMCallerRole } = deps;
  const settingsFeatureManager = deps.featureManager || featureManager;
  const policyRepository = () => createModelAutomationPolicyRepository(db.db);
  const settingsRepository = () => createUserSettingsRepository(db.db);

  const applyCommittedSettingsRuntime = (operation, callback) => {
    try {
      return { runtimeApplied: true, runtimeErrorCode: null, value: callback() };
    } catch (error) {
      let detail = 'unknown runtime error';
      try {
        detail = error?.message || String(error);
      } catch (_) {
        // Post-commit diagnostics must never change the durable HTTP outcome.
      }
      try {
        logger.warn('Settings', `${operation} committed but runtime apply failed: ${detail}`);
      } catch (_) {
        // Logging is observational; a logger failure cannot turn a commit into 500.
      }
      return {
        runtimeApplied: false,
        runtimeErrorCode: 'SETTINGS_RUNTIME_APPLY_FAILED',
        value: 0,
      };
    }
  };

  const resetAllSettings = async (_req, res) => {
    let committed;
    try {
      committed = policyRepository().resetFromGlobalSettings();
    } catch (error) {
      const code = typeof error?.code === 'string'
        ? error.code
        : 'MODEL_AUTOMATION_POLICY_RESET_FAILED';
      return sendJSON(res, modelPolicySettingsHttpStatus(code), { ok: false, code });
    }
    const runtime = applyCommittedSettingsRuntime(
      'reset',
      () => settingsFeatureManager.resetToDefaults(config.features),
    );
    return sendJSON(res, 200, {
      ok: true,
      success: true,
      generalSettings: committed.generalSettings,
      policy: publicPolicyCommit(committed.policy),
      event: committed.policy.event,
      runtimeApplied: runtime.runtimeApplied,
      runtimeErrorCode: runtime.runtimeErrorCode,
    });
  };

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
          const result = sanitizeGenericModelAutomationSettings(JSON.parse(row.data));
          sendJSON(res, 200, result.document);
        } else {
          sendJSON(res, 200, {});
        }
      } catch (err) {
        sendJSON(res, 200, {});
      }
    },

    'GET /api/settings/v2': (_req, res) => {
      let current;
      try {
        current = settingsRepository().readPublic();
      } catch (error) {
        const code = typeof error?.code === 'string'
          ? error.code
          : 'USER_SETTINGS_DB_READ_FAILED';
        return sendJSON(res, userSettingsHttpStatus(code), { ok: false, code });
      }
      return sendJSON(res, 200, current);
    },

    'PUT /api/settings/v2': async (req, res) => {
      let body;
      try {
        body = await parseBody(req);
      } catch (_) {
        return sendJSON(res, 400, {
          ok: false,
          code: 'USER_SETTINGS_INPUT_INVALID',
        });
      }

      let committed;
      try {
        committed = settingsRepository().commitGeneric(body);
      } catch (error) {
        const code = typeof error?.code === 'string'
          ? error.code
          : 'USER_SETTINGS_DB_WRITE_FAILED';
        const details = code === 'USER_SETTINGS_REVISION_CONFLICT'
          ? {
              expectedRevision: error?.details?.expectedRevision,
              currentRevision: error?.details?.currentRevision,
            }
          : {};
        return sendJSON(res, userSettingsHttpStatus(code), {
          ok: false,
          code,
          ...details,
        });
      }

      // Runtime feature flags consume only the seven exact boolean paths.
      // They are post-commit effects; a runtime failure cannot undo or lie
      // about the durable CAS result represented by this exact response.
      applyCommittedSettingsRuntime(
        'versioned generic update',
        () => settingsFeatureManager.applySettings(committed.featurePatch),
      );
      return sendJSON(res, 200, {
        revision: committed.revision,
        settings: committed.settings,
      });
    },

    'POST /api/settings': async (req, res) => {
      let body;
      try {
        body = await parseBody(req);
      } catch (_) {
        return sendJSON(res, 400, {
          success: false,
          code: 'USER_SETTINGS_INPUT_INVALID',
        });
      }

      let sanitized;
      let committed;
      try {
        sanitized = sanitizeGenericModelAutomationSettings(body);
        committed = mergeGenericUserSettings(db.db, sanitized.document);
      } catch (error) {
        const invalidInput = error instanceof UserSettingsError
          && error.code === 'USER_SETTINGS_INPUT_INVALID';
        return sendJSON(res, invalidInput ? 400 : 503, {
          success: false,
          code: invalidInput
            ? 'USER_SETTINGS_INPUT_INVALID'
            : 'USER_SETTINGS_STORAGE_FAILED',
        });
      }

      const runtime = applyCommittedSettingsRuntime(
        'generic update',
        // Never pass the committed or incoming document here: both may contain
        // protected values while this compatibility route remains live.
        () => settingsFeatureManager.applySettings(
          Object.fromEntries(
            GENERIC_FEATURE_SETTING_KEYS
              .filter(key => Object.hasOwn(sanitized.document, key))
              .map(key => [key, sanitized.document[key]]),
          ),
        ),
      );

      return sendJSON(res, 200, {
        success: true,
        featuresChanged: runtime.value || 0,
        ignoredReservedKeys: sanitized.ignoredReservedKeys,
        ignoredNotificationKeys: committed.ignoredNotificationKeys,
        ignoredProtectedKeys: committed.ignoredProtectedKeys,
        runtimeApplied: runtime.runtimeApplied,
        runtimeErrorCode: runtime.runtimeErrorCode,
      });
    },

    'GET /api/settings/backup': (_req, res) => {
      try {
        const backup = policyRepository().exportSettingsBackup();
        return sendJSON(res, 200, { ok: true, backup });
      } catch (error) {
        const code = typeof error?.code === 'string'
          ? error.code
          : 'MODEL_AUTOMATION_POLICY_BACKUP_READ_FAILED';
        const path = code === 'MODEL_AUTOMATION_POLICY_STORED_PORTABLE_VALUE_INVALID'
          && typeof error?.details?.path === 'string'
          ? error.details.path
          : null;
        return sendJSON(res, modelPolicySettingsHttpStatus(code), {
          ok: false,
          code,
          ...(path === null ? {} : { path }),
        });
      }
    },

    'POST /api/settings/import': async (req, res) => {
      let body;
      try {
        body = await parseBody(req);
      } catch (_) {
        return sendJSON(res, 400, {
          ok: false,
          code: 'MODEL_AUTOMATION_POLICY_BACKUP_INPUT_INVALID',
        });
      }
      let committed;
      try {
        committed = policyRepository().replaceFromSettingsImport(body);
      } catch (error) {
        const code = typeof error?.code === 'string'
          ? error.code
          : 'MODEL_AUTOMATION_POLICY_IMPORT_FAILED';
        return sendJSON(res, modelPolicySettingsHttpStatus(code), { ok: false, code });
      }
      const runtime = applyCommittedSettingsRuntime(
        'import',
        () => settingsFeatureManager.applySettings(committed.generalSettings),
      );
      return sendJSON(res, 200, {
        ok: true,
        success: true,
        generalSettings: committed.generalSettings,
        policy: publicPolicyCommit(committed.policy),
        event: committed.policy.event,
        featuresChanged: runtime.value || 0,
        sourceSchemaVersion: committed.sourceSchemaVersion,
        appliedPortablePaths: committed.appliedPortablePaths,
        ignoredSourcePathCount: committed.ignoredSourcePaths.length,
        preservedLocalPathCount: committed.preservedLocalPaths.length,
        runtimeApplied: runtime.runtimeApplied,
        runtimeErrorCode: runtime.runtimeErrorCode,
      });
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

    'POST /api/settings/reset': resetAllSettings,

    // Legacy alias retained for the old /architect surface. Both paths now
    // share the same audited, atomic general-settings + policy commit point.
    'POST /api/reset': resetAllSettings,

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
