import { getCurrentVersion } from '../packaging/auto-updater.js';

// H9: Settings, Health, Autocomplete, Audit, Logs routes
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
          sendJSON(res, 200, JSON.parse(row.data));
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

        db.db.prepare(`
          INSERT OR REPLACE INTO user_settings (id, data, updated_at)
          VALUES (1, ?, datetime('now'))
        `).run(JSON.stringify(body));

        sendJSON(res, 200, { success: true });
      } catch (err) {
        sendJSON(res, 500, safeError(err));
      }
    },

    'GET /api/health': (req, res) => {
      sendJSON(res, 200, {
        status: 'ok',
        version: getCurrentVersion(),
        timestamp: new Date().toISOString(),
        llm: true,
        cwd: process.cwd()
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
        db.db.exec('DELETE FROM user_settings');
        sendJSON(res, 200, { success: true, message: 'Settings cleared' });
      } catch (err) {
        sendJSON(res, 500, safeError(err));
      }
    },
  };
}
