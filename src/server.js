// C.3 v57.0 Server - p(AI)assistant
// ══════════════════════════════════════════════════════════════════════════════

import http from 'http';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { config } from './config.js';
import { logger } from './core/logger.js';
import { installGlobalHandlers, handleError } from './core/error-handler.js';
import db from './db/database.js';

// ESM __dirname equivalent
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Global error handlers (Phase 1 — error-handler.js)
installGlobalHandlers({ logger, exitOnUncaught: false });

// ─── Optional: Agent Platform v33 (Phase B) ─────────────────────────────────
let AgentRepository, AgentScheduler, AgentRunner, createAgentRoutes, LLMServices;
if (config.features.agents !== false) {
  try {
    const repo = await import('./agents/repository.js');
    AgentRepository = repo.AgentRepository;
    repo.initAgentTables(db.db);
    AgentScheduler = (await import('./agents/scheduler.js')).AgentScheduler;
    AgentRunner = (await import('./agents/runner.js')).AgentRunner;
    createAgentRoutes = (await import('./agents/api.js')).createAgentRoutes;
    LLMServices = (await import('./agents/llm-services.js')).LLMServices;
    logger.info('Server', 'Agent platform loaded (Phase B)');
  } catch (err) {
    logger.warn('Server', `Agent platform not available: ${err.message}`);
  }
} else {
  logger.info('Server', 'Agent platform disabled (C3_ENABLE_AGENTS=false)');
}

// ─── Optional: Expert Layer v35 + v57 (Phase D) ─────────────────────────────
let expertLayer = null;
let expertStore = null;
let getExpertStore = null;
if (config.features.experts !== false) {
  try {
    const store = await import('./experts/expert-store.js');
    getExpertStore = store.getExpertStore;
  } catch (err) {
    logger.warn('Server', `Expert store not available: ${err.message}`);
  }

  const possiblePaths = [
    './experts/expert-layer.js',
    './expert-layer.js',
    './src/experts/expert-layer.js',
  ];
  for (const p of possiblePaths) {
    try {
      expertLayer = await import(p);
      logger.info('Server', `Expert layer loaded from ${p}`);
      break;
    } catch (err) {
      logger.debug('Server', `Expert layer not at ${p}: ${err.code || err.message}`);
    }
  }
  if (!expertLayer) logger.warn('Server', 'Expert layer not available - file not found');
} else {
  logger.info('Server', 'Expert platform disabled (C3_ENABLE_EXPERTS=false)');
}

// v36.9.1: LLM client routed through gateway with auth tokens
import { callWithAuth } from './llm/gateway.js';
import { createAuthToken, LLMCallerRole } from './llm/auth-types.js';

// v57.2: Trust Feedback Loop
import { createTrustRoutes } from './notifications/trust-api.js';
import { getTrustTracker } from './notifications/trust.js';

// v44.0: ChatController - THE ONLY entry point for chat
import { ChatController, ChatMode } from './chat/controller.js';

// v59.0: WebSocket bridge for IDE integration
import { attachWebSocketServer } from './ws-bridge/index.js';
import { getDefaultHandlers } from './chat/handlers/index.js';
import { toolExecutor } from './executor/tool-executor.js';
import { toolRegistry } from './tools/registry.js';

// v56.0 Sprint 3: Initialize ConversationStore with DB
import { getConversationStore } from './chat/conversation-store.js';
getConversationStore(db);

// v57.0: Initialize ExpertStore with DB (if experts enabled)
if (getExpertStore) expertStore = getExpertStore(db);

// Configure ChatController with default handlers
ChatController.configure({
  handlers: getDefaultHandlers(),
  config: {
    autoModeDetection: true,
    modeConfidenceThreshold: 0.6,
  },
});
logger.info('Server', 'ChatController v57.0 configured');

// ════════════════════════════════════════════════════════════════════════════
// v44.0: Wire ToolExecutor to existing tool implementations
// ════════════════════════════════════════════════════════════════════════════

toolExecutor.wireServices({
  // Wire existing toolRegistry tools as services
  searchService: {
    async search(query) {
      const tool = toolRegistry.get('web.search');
      if (!tool) throw new Error('web.search tool not available');
      const result = await tool.execute({ query, maxResults: 5 });
      if (result.error) throw new Error(result.error);
      return { results: result };
    }
  },
  scrapeService: {
    async scrape(url) {
      const tool = toolRegistry.get('web.scrape');
      if (!tool) throw new Error('web.scrape tool not available');
      const result = await tool.execute({ url });
      if (result.error) throw new Error(result.error);
      return result;
    }
  }
});

logger.info('Server', 'ToolExecutor wired to toolRegistry', {
  search: !!toolExecutor.searchService,
  scrape: !!toolExecutor.scrapeService
});

// ─── Agent Platform Init (conditional — Phase B) ───────────────────────────
let agentLLMClient = null;
let agentRepository = null;
let agentRunner = null;
let agentScheduler = null;
let agentRoutes = null;

if (AgentRepository) {
  agentLLMClient = {
    async chat({ model, messages, format, options = {} }) {
      try {
        const token = createAuthToken({
          role: LLMCallerRole.WORKFLOW_THINKER,
          decisionId: `agent_${Date.now()}`,
          auditContext: { sessionId: 'agents' }
        });

        const response = await callWithAuth(token, '', {
          model: model || 'qwen2.5:32b',
          messages,
          format: format === 'json' ? 'json' : undefined,
          temperature: options.temperature ?? 0.3
        });

        return { content: response.content || '' };
      } catch (err) {
        logger.error('AgentLLM', `Error: ${err.message}`);
        return { content: '' };
      }
    }
  };

  agentRepository = new AgentRepository(db.db);
  const llmServices = new LLMServices({ llmClient: agentLLMClient });
  agentRunner = new AgentRunner({ repository: agentRepository, llmServices });
  agentScheduler = new AgentScheduler({ repository: agentRepository, runner: agentRunner });
  agentRoutes = createAgentRoutes({
    repository: agentRepository,
    scheduler: agentScheduler,
    executor: agentRunner,
    llmClient: agentLLMClient
  });
  logger.info('Server', 'Agent platform initialized (Phase B)');
} else {
  logger.info('Server', 'Agent platform skipped (disabled or not available)');
}

// ════════════════════════════════════════════════════════════════════════════
// REQUEST HELPERS
// ════════════════════════════════════════════════════════════════════════════

const MAX_BODY_SIZE = 1 * 1024 * 1024; // 1MB

// H1: Error sanitization — never leak internal error details to clients
function safeError(err) {
  const id = `E-${Date.now().toString(36)}`;
  logger.error('Server', `[${id}] ${err.message}`, { stack: err.stack });
  const payload = { error: 'Internal server error', errorId: id };
  if (config.log?.level === 'debug') payload.detail = err.message;
  return payload;
}

// H7: Safe parseInt — returns parsed number or throws for invalid input
function safeParseInt(val, name = 'id') {
  const n = parseInt(val, 10);
  if (isNaN(n)) throw Object.assign(new Error(`Invalid ${name}: ${val}`), { statusCode: 400 });
  return n;
}

async function parseBody(req) {
  return new Promise((resolve, reject) => {
    let body = '';
    let size = 0;
    req.on('data', chunk => {
      size += chunk.length;
      if (size > MAX_BODY_SIZE) {
        req.destroy();
        reject(new Error('Request body too large (max 1MB)'));
        return;
      }
      body += chunk;
    });
    req.on('end', () => {
      if (!body) return resolve({});
      try {
        resolve(JSON.parse(body));
      } catch {
        reject(new Error('Invalid JSON in request body'));
      }
    });
    req.on('error', reject);
  });
}

function getCorsOrigin(req) {
  const origin = req?.headers?.origin;
  const allowed = config.server.allowedOrigins;
  if (!allowed.length) return origin || '*'; // no restriction configured
  if (allowed.includes(origin)) return origin;
  return null; // blocked
}

// H2: Security headers — applied to all responses
const SECURITY_HEADERS = {
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'SAMEORIGIN',
  'X-XSS-Protection': '1; mode=block',
  'Referrer-Policy': 'strict-origin-when-cross-origin',
  'Content-Security-Policy': "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self'; connect-src 'self' ws: wss:",
};

function sendJSON(res, status, data, req = null) {
  const corsOrigin = getCorsOrigin(req);
  const headers = { 'Content-Type': 'application/json', ...SECURITY_HEADERS };
  if (corsOrigin) headers['Access-Control-Allow-Origin'] = corsOrigin;
  res.writeHead(status, headers);
  res.end(JSON.stringify(data));
}

function sendHTML(res, html, req = null) {
  const corsOrigin = getCorsOrigin(req);
  const headers = { 'Content-Type': 'text/html; charset=utf-8', ...SECURITY_HEADERS };
  if (corsOrigin) headers['Access-Control-Allow-Origin'] = corsOrigin;
  res.writeHead(200, headers);
  res.end(html);
}

// Mock Express-style response for agent routes
function createMockResponse(res) {
  return {
    json: (data) => sendJSON(res, 200, data),
    status: (code) => ({
      json: (data) => sendJSON(res, code, data)
    })
  };
}

async function sendStaticFile(res, filepath, contentType) {
  try {
    const fsPromises = await import('fs/promises');

    // H5: Path traversal guard — all candidate paths must resolve within allowed base dirs
    const baseDirs = [
      path.resolve(__dirname, '..'),   // project root
      path.resolve(process.cwd()),     // cwd
    ];

    const pathsToTry = [
      path.join(__dirname, '..', filepath),           // From src/../filepath
      path.join(__dirname, filepath.replace(/^src\//, '')),  // From src/filepath without src prefix
      path.join(process.cwd(), filepath)              // From cwd/filepath
    ];

    for (const fullPath of pathsToTry) {
      const resolved = path.resolve(fullPath);
      if (!baseDirs.some(base => resolved.startsWith(base + path.sep) || resolved === base)) {
        logger.warn('Server', `Path traversal blocked: ${filepath} → ${resolved}`);
        continue;
      }
      try {
        const content = await fsPromises.readFile(fullPath, 'utf-8');
        res.writeHead(200, {
          'Content-Type': contentType + '; charset=utf-8',
          'Access-Control-Allow-Origin': res._corsOrigin || '*',
          'Cache-Control': 'no-cache',
          ...SECURITY_HEADERS,
        });
        res.end(content);
        return;
      } catch (err) {
        // Expected: trying multiple paths
        logger.debug('Server', `Static file not at ${fullPath}: ${err.code}`);
      }
    }
    
    // None found
    throw new Error(`File not found: ${filepath}`);
  } catch (err) {
    res.writeHead(404, { 'Content-Type': 'text/plain' });
    res.end('File not found');
  }
}

async function getArchitectUIHTML() {
  try {
    const fsPromises = await import('fs/promises');
    // Use __dirname (relative to server.js in src/) to find ui/architect/
    const htmlPath = path.join(__dirname, 'ui/architect/architect.html');
    return await fsPromises.readFile(htmlPath, 'utf-8');
  } catch (err) {
    logger.warn('Server', `Architect UI not found at expected path: ${err.message}`);
    return `<!DOCTYPE html>
<html>
<head><title>C.3 Architect</title></head>
<body style="background: #0f0f0f; color: white; font-family: sans-serif; padding: 40px;">
<h1>🏗️ Architect Mode</h1>
<p>UI files not found. Make sure src/ui/architect/ exists.</p>
<p style="color: #666; font-size: 12px;">Expected: ${path.join(__dirname, 'ui/architect/architect.html')}</p>
</body>
</html>`;
  }
}

// H3: Architect sessions with TTL — prevents unbounded memory growth
const ARCHITECT_SESSION_TTL = 4 * 60 * 60 * 1000; // 4 hours
const ARCHITECT_MAX_SESSIONS = 20;
const architectSessions = new Map(); // key → { orchestrator, lastAccess }

function getArchitectSession(key) {
  const entry = architectSessions.get(key);
  if (entry) entry.lastAccess = Date.now();
  return entry?.orchestrator || null;
}

function setArchitectSession(key, orchestrator) {
  // Evict oldest if at capacity
  if (architectSessions.size >= ARCHITECT_MAX_SESSIONS && !architectSessions.has(key)) {
    let oldest = null, oldestKey = null;
    for (const [k, v] of architectSessions) {
      if (!oldest || v.lastAccess < oldest) { oldest = v.lastAccess; oldestKey = k; }
    }
    if (oldestKey) architectSessions.delete(oldestKey);
  }
  architectSessions.set(key, { orchestrator, lastAccess: Date.now() });
}

// Cleanup stale sessions every 30 minutes
const architectCleanupInterval = setInterval(() => {
  const now = Date.now();
  for (const [key, entry] of architectSessions) {
    if (now - entry.lastAccess > ARCHITECT_SESSION_TTL) {
      architectSessions.delete(key);
      logger.debug('Server', `Evicted stale architect session: ${key}`);
    }
  }
}, 30 * 60 * 1000);
architectCleanupInterval.unref(); // Don't prevent process exit

// ════════════════════════════════════════════════════════════════════════════
// API ROUTES
// v44.5: server.js = transport & wiring ONLY
// All logic goes through ChatController → handlers/ → CRE → ToolExecutor
// ════════════════════════════════════════════════════════════════════════════
//
// ╔═══════════════════════════════════════════════════════════════════════════╗
// ║  🛑 ARCHITECTURAL INVARIANT - DO NOT VIOLATE                              ║
// ╠═══════════════════════════════════════════════════════════════════════════╣
// ║  server.js MUST NOT contain:                                              ║
// ║  ❌ intent classification (classifyIntent, detectIntent, etc.)            ║
// ║  ❌ LLM calls (llmCall, callOllama, generateResponse, etc.)               ║
// ║  ❌ fallback logic ("if error, try X")                                    ║
// ║  ❌ expert/project decisions                                               ║
// ║  ❌ semantic routing (switch on intent type)                               ║
// ║                                                                           ║
// ║  server.js MAY ONLY:                                                      ║
// ║  ✅ parse HTTP request                                                    ║
// ║  ✅ create context object                                                 ║
// ║  ✅ call ChatController.handle()                                          ║
// ║  ✅ return HTTP response                                                  ║
// ║                                                                           ║
// ║  If you think "just this one special case..." → STOP                      ║
// ║  Put it in handlers/ modules or CRE. That's what they're for.                   ║
// ╚═══════════════════════════════════════════════════════════════════════════╝
//

const routes = {
  // Health check
  'GET /': (req, res) => {
    sendJSON(res, 200, {
      name: 'p(AI)assistant',
      version: '57.0.0',
      status: 'ok',
      endpoints: [
        'POST /chat - Simple chat',
        'POST /planner/start - Start D1→CODE→R2→R1 workflow',
        'POST /planner/clarify - Answer D1 clarification questions',
        'POST /planner/approve - Approve plan, start execution',
        'POST /planner/reject - Reject plan with feedback',
        'GET /planner/session?id= - Get workflow session status',
        'GET /memory - List global memory',
        'POST /memory - Set memory value',
        'GET /architect - Architect Mode UI',
        'GET /experts - Expert Layer UI (v35)',
        'GET /agents - Agent Platform UI',
        'GET /chat-ui - Chat UI (v56.1)',
        'GET /api/agents - List all agents',
        'POST /api/agents - Create agent',
        'POST /api/agents/build - Build agent from description',
        'POST /api/lifecycle/start - Start lifecycle (SPEC phase)',
        'POST /api/lifecycle/spec/answer - Answer spec questions',
        'POST /api/lifecycle/spec/approve - Approve spec → PLANNING',
        'POST /api/lifecycle/roadmap/approve - Approve roadmap → BUILD',
        'POST /api/lifecycle/milestone/approve - Approve milestone plan',
        'POST /api/lifecycle/milestone/next - Start next milestone',
        'POST /api/lifecycle/milestone/blocked - Handle blocked milestone',
        'POST /api/lifecycle/change/propose - Propose change request',
        'POST /api/lifecycle/change/approve - Approve change',
        'POST /api/lifecycle/change/reject - Reject change',
        'GET /api/lifecycle/status?id= - Full lifecycle status',
        'GET /api/lifecycle/resume?id= - Resume lifecycle',
        'GET /api/debug/modules - Module trace (C3_TRACE=1)',
        'GET /api/debug/health - Server health (C3_TRACE=1)',
      ],
    });
  },
  
  // v55.1 - Chat session management endpoints
  'GET /api/chat/sessions/stats': (req, res) => {
    const stats = ChatController.getStats();
    sendJSON(res, 200, stats);
  },
  
  'GET /api/chat/sessions': (req, res) => {
    const sessionIds = ChatController.getActiveSessions();
    const sessions = sessionIds.map(id => ({
      sessionId: id,
      ...ChatController.getSessionInfo(id)
    }));
    sendJSON(res, 200, { sessions, total: sessions.length });
  },
  
  'GET /api/chat/sessions/:sessionId': (req, res, params) => {
    const info = ChatController.getSessionInfo(params.sessionId);
    if (!info.exists) {
      return sendJSON(res, 404, { error: 'Session not found' });
    }
    sendJSON(res, 200, info);
  },
  
  'DELETE /api/chat/sessions/:sessionId': (req, res, params) => {
    const info = ChatController.getSessionInfo(params.sessionId);
    if (!info.exists) {
      return sendJSON(res, 404, { error: 'Session not found' });
    }
    ChatController.removeSession(params.sessionId);
    sendJSON(res, 200, { success: true, deleted: params.sessionId });
  },
  
  // ══════════════════════════════════════════════════════════════════════════
  // GLOBAL MEMORY API (H6: canonical path is /api/global-memory, /memory kept for backward compat)
  // ══════════════════════════════════════════════════════════════════════════

  'GET /api/global-memory': (req, res) => {
    const memories = db.globalMemory.listAll.all();
    sendJSON(res, 200, { memories });
  },

  'POST /api/global-memory': async (req, res) => {
    const body = await parseBody(req);
    const { key, value, category } = body;

    if (!key || value === undefined) {
      return sendJSON(res, 400, { error: 'key and value are required' });
    }

    db.globalMemory.setValue(key, value, category || 'general');
    sendJSON(res, 200, { success: true, key });
  },

  'DELETE /api/global-memory/:key': (req, res, params) => {
    db.globalMemory.delete.run(params.key);
    sendJSON(res, 200, { success: true, deleted: params.key });
  },

  // Deprecated: use /api/global-memory instead
  'GET /memory': (req, res) => {
    const memories = db.globalMemory.listAll.all();
    sendJSON(res, 200, { memories });
  },

  'POST /memory': async (req, res) => {
    const body = await parseBody(req);
    const { key, value, category } = body;

    if (!key || value === undefined) {
      return sendJSON(res, 400, { error: 'key and value are required' });
    }

    db.globalMemory.setValue(key, value, category || 'general');
    sendJSON(res, 200, { success: true, key });
  },

  'DELETE /memory/:key': (req, res, params) => {
    db.globalMemory.delete.run(params.key);
    sendJSON(res, 200, { success: true, deleted: params.key });
  },
  
  // ══════════════════════════════════════════════════════════════════════════
  // PROJECTS API
  // ══════════════════════════════════════════════════════════════════════════
  
  'GET /projects': (req, res) => {
    const projects = db.projects.list.all(50);
    sendJSON(res, 200, { projects });
  },
  
  'POST /projects': async (req, res) => {
    const body = await parseBody(req);
    const { name, path, description } = body;
    
    if (!name || !path) {
      return sendJSON(res, 400, { error: 'name and path are required' });
    }
    
    const project = db.projects.getOrCreate(name, path, description || '');
    sendJSON(res, 200, { project });
  },
  
  // ══════════════════════════════════════════════════════════════════════════
  // CHAT API (Simple, stateless)
  // v44.5: Now routes through ChatController like /api/chat
  // ══════════════════════════════════════════════════════════════════════════

  'POST /chat': async (req, res) => {
    const body = await parseBody(req);
    const { message, session_id } = body;

    if (!message) {
      return sendJSON(res, 400, { error: 'message is required' });
    }

    try {
      // v56.0 Sprint 3: Use provided session_id or create a proper one
      const sessionId = session_id || `chat-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

      const result = await ChatController.handle({
        message,
        sessionId,
        userId: null,
        context: {
          hasActiveProject: false,
        },
      });

      sendJSON(res, 200, {
        response: result.response,
        mode: result.mode,
        confidence: result.confidence,
        session_id: sessionId, // v56.0: Return session_id for continuity
      });

    } catch (err) {
      logger.error('Server', `Chat error: ${err.message}`);
      sendJSON(res, 500, safeError(err));
    }
  },
  
  // ══════════════════════════════════════════════════════════════════════════
  // v56.1 Sprint 4C: CHAT UI
  // ══════════════════════════════════════════════════════════════════════════
  
  'GET /chat-ui': async (req, res) => {
    await sendStaticFile(res, 'src/chat/chat.html', 'text/html');
  },
  
  // ══════════════════════════════════════════════════════════════════════════
  // v56.1 Sprint 4B: EXPORT PIPELINE
  // ══════════════════════════════════════════════════════════════════════════
  
  'POST /api/export': async (req, res) => {
    const body = await parseBody(req);
    const { conversation_id, format, scope } = body;
    
    if (!conversation_id) {
      return sendJSON(res, 400, { error: 'conversation_id is required' });
    }
    
    try {
      const { exportConversation } = await import('./chat/export-pipeline.js');
      const result = await exportConversation(conversation_id, {
        format: format || 'md',
        scope: scope || 'conversation',
      });
      
      sendJSON(res, 200, {
        filename: result.filename,
        download_url: result.downloadUrl,
        format: result.format,
        scope: result.scope,
        size: result.size,
        turn_count: result.turnCount,
      });
    } catch (err) {
      logger.error('Server', `Export error: ${err.message}`);
      sendJSON(res, 500, safeError(err));
    }
  },

  // ══════════════════════════════════════════════════════════════════════════
  // PLANNER WORKFLOW API — D1→CODE→R2→D2/R1 Pipeline
  // ══════════════════════════════════════════════════════════════════════════

  'POST /planner/start': async (req, res) => {
    const body = await parseBody(req);
    const { request, context } = body;

    if (!request) {
      return sendJSON(res, 400, { error: 'request is required' });
    }

    try {
      const { workflowOrchestrator } = await import('./planner/index.js');
      const result = await workflowOrchestrator.start(request, context || {});
      sendJSON(res, 200, result);
    } catch (err) {
      logger.error('Server', `Planner start error: ${err.message}`);
      sendJSON(res, 500, safeError(err));
    }
  },

  'POST /planner/clarify': async (req, res) => {
    const body = await parseBody(req);
    const { sessionId, answers } = body;

    if (!sessionId || !answers) {
      return sendJSON(res, 400, { error: 'sessionId and answers are required' });
    }

    try {
      const { workflowOrchestrator } = await import('./planner/index.js');
      const result = await workflowOrchestrator.clarify(sessionId, answers);
      sendJSON(res, 200, result);
    } catch (err) {
      logger.error('Server', `Planner clarify error: ${err.message}`);
      sendJSON(res, 500, safeError(err));
    }
  },

  'POST /planner/approve': async (req, res) => {
    const body = await parseBody(req);
    const { sessionId } = body;

    if (!sessionId) {
      return sendJSON(res, 400, { error: 'sessionId is required' });
    }

    try {
      const { workflowOrchestrator } = await import('./planner/index.js');
      const result = await workflowOrchestrator.approve(sessionId);
      sendJSON(res, 200, result);
    } catch (err) {
      logger.error('Server', `Planner approve error: ${err.message}`);
      sendJSON(res, 500, safeError(err));
    }
  },

  'POST /planner/reject': async (req, res) => {
    const body = await parseBody(req);
    const { sessionId, feedback } = body;

    if (!sessionId) {
      return sendJSON(res, 400, { error: 'sessionId is required' });
    }

    try {
      const { workflowOrchestrator } = await import('./planner/index.js');
      const result = await workflowOrchestrator.reject(sessionId, feedback || '');
      sendJSON(res, 200, result);
    } catch (err) {
      logger.error('Server', `Planner reject error: ${err.message}`);
      sendJSON(res, 500, safeError(err));
    }
  },

  'GET /planner/session': async (req, res) => {
    const url = new URL(req.url, `http://${req.headers.host}`);
    const sessionId = url.searchParams.get('id');

    if (!sessionId) {
      return sendJSON(res, 400, { error: 'id query param is required' });
    }

    try {
      const { workflowOrchestrator } = await import('./planner/index.js');
      const session = workflowOrchestrator.getSession(sessionId);
      if (!session) {
        return sendJSON(res, 404, { error: 'Session not found' });
      }
      sendJSON(res, 200, {
        id: session.id,
        state: session.state,
        plan: session.plan,
        fixAttempts: session.fixAttempts,
        redesignAttempts: session.redesignAttempts,
        historyLength: session.history.length,
        createdAt: session.createdAt,
        updatedAt: session.updatedAt,
      });
    } catch (err) {
      sendJSON(res, 500, safeError(err));
    }
  },

  'GET /planner/sessions': async (req, res) => {
    const url = new URL(req.url, `http://${req.headers.host}`);
    const activeOnly = url.searchParams.get('all') !== 'true';

    try {
      const { workflowOrchestrator } = await import('./planner/index.js');
      const sessions = workflowOrchestrator.listSessions({ activeOnly });
      sendJSON(res, 200, { sessions });
    } catch (err) {
      sendJSON(res, 500, safeError(err));
    }
  },

  // Phase C2: Enhanced progress with time estimates and detailed breakdown
  'GET /planner/progress': async (req, res) => {
    const url = new URL(req.url, `http://${req.headers.host}`);
    const sessionId = url.searchParams.get('id');
    const detailed = url.searchParams.get('detailed') === 'true';

    try {
      const { workflowOrchestrator } = await import('./planner/index.js');
      const { buildProgressApiResponse, formatDetailedProgress } = await import('./planner/progress-tracker.js');

      if (sessionId) {
        const progress = workflowOrchestrator.getProgress(sessionId);
        if (!progress) {
          return sendJSON(res, 404, { error: 'Session not found' });
        }
        const data = detailed
          ? formatDetailedProgress(progress)
          : progress;
        sendJSON(res, 200, data);
      } else {
        // All sessions with progress
        const result = buildProgressApiResponse(
          (id) => workflowOrchestrator.getProgress(id),
          (opts) => workflowOrchestrator.listSessions(opts),
        );
        sendJSON(res, result.status, result.data);
      }
    } catch (err) {
      sendJSON(res, 500, safeError(err));
    }
  },

  // Phase C2: Dashboard — all sessions with compact progress summaries
  'GET /planner/dashboard': async (req, res) => {
    try {
      const { workflowOrchestrator } = await import('./planner/index.js');
      const { formatDetailedProgress, estimateRemainingTime } = await import('./planner/progress-tracker.js');

      const sessions = workflowOrchestrator.listSessions({ activeOnly: false });
      const dashboard = sessions.slice(0, 20).map(s => {
        const progress = workflowOrchestrator.getProgress(s.sessionId);
        return {
          sessionId: s.sessionId,
          state: s.state,
          planTitle: s.planTitle || null,
          request: s.request,
          complexity: s.complexity,
          percentage: progress?.percentage ?? 0,
          estimatedRemaining: progress ? estimateRemainingTime(progress) : null,
          blockerCount: progress?.blockers?.length || 0,
          fixAttempts: progress?.fixAttempts || 0,
          createdAt: s.createdAt,
          updatedAt: s.updatedAt,
        };
      });

      sendJSON(res, 200, {
        total: sessions.length,
        active: sessions.filter(s => s.state !== 'COMPLETED' && s.state !== 'FAILED').length,
        sessions: dashboard,
      });
    } catch (err) {
      sendJSON(res, 500, safeError(err));
    }
  },

  // Phase C: Project-scoped sessions
  'GET /planner/project/:projectId/sessions': async (req, res, params) => {
    try {
      const projectId = safeParseInt(params.projectId, 'projectId');
      if (isNaN(projectId)) {
        return sendJSON(res, 400, { error: 'Invalid projectId' });
      }

      const { workflowOrchestrator } = await import('./planner/index.js');
      const allSessions = workflowOrchestrator.listSessions({ activeOnly: false });
      const projectSessions = allSessions.filter(s => {
        const session = workflowOrchestrator.getSession(s.sessionId);
        return session && session.projectId === projectId;
      });

      sendJSON(res, 200, { projectId, sessions: projectSessions });
    } catch (err) {
      sendJSON(res, 500, safeError(err));
    }
  },

  // Phase C1: Enhanced resume with handoff state restoration
  'POST /planner/resume': async (req, res) => {
    const body = await parseBody(req);
    const { sessionId, chatSessionId } = body;

    if (!sessionId) {
      return sendJSON(res, 400, { error: 'sessionId is required' });
    }

    try {
      const { restoreSession } = await import('./chat/handlers/session-resume.js');
      const setHandoff = chatSessionId
        ? (await import('./chat/handlers/build-handoff.js')).setHandoffState
        : () => {};

      const result = await restoreSession(
        chatSessionId || 'api-session',
        sessionId,
        setHandoff,
      );

      sendJSON(res, result.success ? 200 : 404, result);
    } catch (err) {
      logger.error('Server', `Planner resume error: ${err.message}`);
      sendJSON(res, 500, safeError(err));
    }
  },

  // ══════════════════════════════════════════════════════════════════════════
  // ARCHITECT MODE API
  // ══════════════════════════════════════════════════════════════════════════

  'POST /architect/init': async (req, res) => {
    const body = await parseBody(req);
    const { projectRoot, projectName } = body;
    
    if (!projectRoot || !projectName) {
      return sendJSON(res, 400, { error: 'projectRoot and projectName are required' });
    }
    
    try {
      const { createArchitect } = await import('./architect/index.js');
      const orchestrator = await createArchitect(projectRoot, projectName);
      
      setArchitectSession(projectRoot, orchestrator);
      
      sendJSON(res, 200, {
        success: true,
        project: projectName,
        state: orchestrator.getSessionInfo(),
      });
    } catch (err) {
      logger.error('Server', `Architect init error: ${err.message}`);
      sendJSON(res, 500, safeError(err));
    }
  },
  
  'POST /architect/message': async (req, res) => {
    const body = await parseBody(req);
    const { projectRoot, message, attachments } = body;
    
    if (!projectRoot || !message) {
      return sendJSON(res, 400, { error: 'projectRoot and message are required' });
    }
    
    try {
      let orchestrator = getArchitectSession(projectRoot);

      if (!orchestrator) {
        // Try to load existing project
        const { ConversationOrchestrator } = await import('./architect/index.js');
        orchestrator = new ConversationOrchestrator(projectRoot);
        await orchestrator.init('unknown'); // Will load existing state
        setArchitectSession(projectRoot, orchestrator);
      }
      
      const result = await orchestrator.process(message, attachments || []);
      
      sendJSON(res, 200, {
        ...result,
        state: orchestrator.getSessionInfo(),
      });
    } catch (err) {
      logger.error('Server', `Architect message error: ${err.message}`);
      sendJSON(res, 500, safeError(err));
    }
  },
  
  'GET /architect/status/:projectRoot': async (req, res, params) => {
    const projectRoot = decodeURIComponent(params.projectRoot);
    
    try {
      const orchestrator = getArchitectSession(projectRoot);

      if (!orchestrator) {
        return sendJSON(res, 404, { error: 'Project not loaded' });
      }

      sendJSON(res, 200, orchestrator.getSessionInfo());
    } catch (err) {
      sendJSON(res, 500, safeError(err));
    }
  },

  'POST /architect/action': async (req, res) => {
    const body = await parseBody(req);
    const { projectRoot, action } = body;

    if (!projectRoot || !action) {
      return sendJSON(res, 400, { error: 'projectRoot and action are required' });
    }

    try {
      const orchestrator = getArchitectSession(projectRoot);
      
      if (!orchestrator) {
        return sendJSON(res, 404, { error: 'Project not loaded' });
      }
      
      const result = await orchestrator.actions.execute(action);
      
      sendJSON(res, 200, {
        ...result,
        state: orchestrator.getSessionInfo(),
      });
    } catch (err) {
      logger.error('Server', `Architect action error: ${err.message}`);
      sendJSON(res, 500, safeError(err));
    }
  },
  
  // ══════════════════════════════════════════════════════════════════════════
  // UI
  // ══════════════════════════════════════════════════════════════════════════
  
  // Architect UI
  'GET /architect': async (req, res) => {
    sendHTML(res, await getArchitectUIHTML());
  },
  
  'GET /architect/architect.css': async (req, res) => {
    await sendStaticFile(res, 'src/ui/architect/architect.css', 'text/css');
  },
  
  'GET /architect/architect.js': async (req, res) => {
    await sendStaticFile(res, 'src/ui/architect/architect.js', 'application/javascript');
  },
  
  // ══════════════════════════════════════════════════════════════════════════
  // AGENTS PLATFORM v33
  // ══════════════════════════════════════════════════════════════════════════
  
  'GET /agents': async (req, res) => {
    await sendStaticFile(res, 'src/agents/agents.html', 'text/html');
  },
  
  'GET /api/agents': async (req, res) => {
    const url = new URL(req.url, `http://${req.headers.host}`);
    const mockReq = { query: { all: url.searchParams.get('all') } };
    const mockRes = createMockResponse(res);
    await agentRoutes.listAgents(mockReq, mockRes);
  },
  
  'GET /api/agents/:id': async (req, res, params) => {
    const mockReq = { params: { id: params.id } };
    const mockRes = createMockResponse(res);
    await agentRoutes.getAgent(mockReq, mockRes);
  },
  
  'POST /api/agents': async (req, res) => {
    const body = await parseBody(req);
    const mockReq = { body };
    const mockRes = createMockResponse(res);
    await agentRoutes.createAgent(mockReq, mockRes);
  },
  
  'PUT /api/agents/:id': async (req, res, params) => {
    const body = await parseBody(req);
    const mockReq = { params: { id: params.id }, body };
    const mockRes = createMockResponse(res);
    await agentRoutes.updateAgent(mockReq, mockRes);
  },
  
  'DELETE /api/agents/:id': async (req, res, params) => {
    const mockReq = { params: { id: params.id } };
    const mockRes = createMockResponse(res);
    await agentRoutes.deleteAgent(mockReq, mockRes);
  },
  
  'POST /api/agents/:id/run': async (req, res, params) => {
    const mockReq = { params: { id: params.id } };
    const mockRes = createMockResponse(res);
    await agentRoutes.runAgent(mockReq, mockRes);
  },
  
  'POST /api/agents/:id/enable': async (req, res, params) => {
    const mockReq = { params: { id: params.id } };
    const mockRes = createMockResponse(res);
    await agentRoutes.enableAgent(mockReq, mockRes);
  },
  
  'POST /api/agents/:id/disable': async (req, res, params) => {
    const mockReq = { params: { id: params.id } };
    const mockRes = createMockResponse(res);
    await agentRoutes.disableAgent(mockReq, mockRes);
  },
  
  'GET /api/agents/:id/runs': async (req, res, params) => {
    const url = new URL(req.url, `http://${req.headers.host}`);
    const mockReq = { 
      params: { id: params.id },
      query: { limit: url.searchParams.get('limit') }
    };
    const mockRes = createMockResponse(res);
    await agentRoutes.getAgentRuns(mockReq, mockRes);
  },
  
  'POST /api/agents/build': async (req, res) => {
    const body = await parseBody(req);
    const mockReq = { body };
    const mockRes = createMockResponse(res);
    await agentRoutes.createFromDescription(mockReq, mockRes);
  },
  
  'POST /api/agents/refine': async (req, res) => {
    const body = await parseBody(req);
    const mockReq = { body };
    const mockRes = createMockResponse(res);
    await agentRoutes.refineAgent(mockReq, mockRes);
  },
  
  'POST /api/agents/confirm': async (req, res) => {
    const body = await parseBody(req);
    const mockReq = { body };
    const mockRes = createMockResponse(res);
    await agentRoutes.confirmAgent(mockReq, mockRes);
  },
  
  'POST /api/agents/dry-run': async (req, res) => {
    const body = await parseBody(req);
    try {
      const result = await agentRunner.dryRun(body.definition);
      sendJSON(res, 200, result);
    } catch (err) {
      sendJSON(res, 500, safeError(err));
    }
  },
  
  // Source Inspection API
  'POST /api/sources/inspect': async (req, res) => {
    const body = await parseBody(req);
    const mockReq = { body };
    const mockRes = createMockResponse(res);
    await agentRoutes.inspectSourceUrl(mockReq, mockRes);
  },
  
  'POST /api/sources/validate-field': async (req, res) => {
    const body = await parseBody(req);
    const mockReq = { body };
    const mockRes = createMockResponse(res);
    await agentRoutes.validateField(mockReq, mockRes);
  },
  
  'POST /api/sources/validate-condition': async (req, res) => {
    const body = await parseBody(req);
    const mockReq = { body };
    const mockRes = createMockResponse(res);
    await agentRoutes.validateCondition(mockReq, mockRes);
  },
  
  // Memory API
  'GET /api/memory': async (req, res) => {
    try {
      const row = db.db.prepare('SELECT data FROM user_memory WHERE id = 1').get();
      if (row) {
        sendJSON(res, 200, JSON.parse(row.data));
      } else {
        sendJSON(res, 200, []);
      }
    } catch (err) {
      sendJSON(res, 200, []);
    }
  },
  
  'POST /api/memory': async (req, res) => {
    const body = await parseBody(req);
    // H6: Validate memory payload — max 100KB, must be array or object
    const json = JSON.stringify(body);
    if (json.length > 100 * 1024) {
      return sendJSON(res, 400, { error: 'Memory payload too large (max 100KB)' });
    }
    if (typeof body !== 'object' || body === null) {
      return sendJSON(res, 400, { error: 'Memory payload must be a JSON object or array' });
    }
    try {
      db.db.prepare(`
        INSERT OR REPLACE INTO user_memory (id, data, updated_at)
        VALUES (1, ?, datetime('now'))
      `).run(json);
      sendJSON(res, 200, { success: true });
    } catch (err) {
      sendJSON(res, 500, safeError(err));
    }
  },
  
  'GET /api/notifications': async (req, res) => {
    const url = new URL(req.url, `http://${req.headers.host}`);
    const mockReq = { 
      query: { 
        unread: url.searchParams.get('unread'),
        limit: url.searchParams.get('limit')
      }
    };
    const mockRes = createMockResponse(res);
    await agentRoutes.getNotifications(mockReq, mockRes);
  },
  
  'POST /api/notifications/:id/read': async (req, res, params) => {
    const mockReq = { params: { id: params.id } };
    const mockRes = createMockResponse(res);
    await agentRoutes.markNotificationRead(mockReq, mockRes);
  },
  
  'POST /api/notifications/read-all': async (req, res) => {
    const mockRes = createMockResponse(res);
    await agentRoutes.markAllNotificationsRead({}, mockRes);
  },
  
  'GET /api/scheduler/status': async (req, res) => {
    const mockRes = createMockResponse(res);
    await agentRoutes.getSchedulerStatus({}, mockRes);
  },

  // ══════════════════════════════════════════════════════════════════════════
  // API v2 - Projects, Conversations, Chat
  // ══════════════════════════════════════════════════════════════════════════
  
  // Projects
  'GET /api/projects': async (req, res) => {
    const url = new URL(req.url, `http://${req.headers.host}`);
    const limit = parseInt(url.searchParams.get('limit')) || 10;
    
    try {
      const projects = db.projects.listRecent.all(limit);
      sendJSON(res, 200, { projects });
    } catch (err) {
      sendJSON(res, 500, safeError(err));
    }
  },
  
  'POST /api/projects': async (req, res) => {
    const body = await parseBody(req);
    const { name, description } = body;
    
    if (!name) {
      return sendJSON(res, 400, { error: 'name is required' });
    }
    
    try {
      const fs = await import('fs/promises');
      const path = await import('path');
      
      // Create project directory
      const projectsDir = path.join(process.cwd(), 'projects');
      await fs.mkdir(projectsDir, { recursive: true });
      
      const projectPath = path.join(projectsDir, name.replace(/[^a-zA-Z0-9-_]/g, '-'));
      await fs.mkdir(projectPath, { recursive: true });
      await fs.mkdir(path.join(projectPath, '.c3'), { recursive: true });
      await fs.mkdir(path.join(projectPath, 'chat'), { recursive: true });
      
      // Create in DB
      const project = db.projects.getOrCreate(name, projectPath, description || '');
      
      sendJSON(res, 201, { project });
    } catch (err) {
      sendJSON(res, 500, safeError(err));
    }
  },
  
  'GET /api/projects/:id': async (req, res, params) => {
    try {
      const project = db.projects.findById.get(safeParseInt(params.id));
      
      if (!project) {
        return sendJSON(res, 404, { error: 'Project not found' });
      }
      
      sendJSON(res, 200, { project });
    } catch (err) {
      sendJSON(res, 500, safeError(err));
    }
  },
  
  'GET /api/projects/:id/conversations': async (req, res, params) => {
    const url = new URL(req.url, `http://${req.headers.host}`);
    const limit = parseInt(url.searchParams.get('limit')) || 10;

    try {
      const conversations = db.conversations.listRecentByProject.all(safeParseInt(params.id), limit);
      sendJSON(res, 200, { conversations });
    } catch (err) {
      sendJSON(res, 500, safeError(err));
    }
  },

  // ══════════════════════════════════════════════════════════════════════════
  // v59: Open Folder - Register existing filesystem folder as project
  // ══════════════════════════════════════════════════════════════════════════

  'POST /api/projects/open-folder': async (req, res) => {
    const body = await parseBody(req);
    const { folderPath, name } = body;

    if (!folderPath) {
      return sendJSON(res, 400, { error: 'folderPath is required' });
    }

    try {
      const fsPromises = await import('fs/promises');
      const pathModule = await import('path');
      const fsConstants = await import('fs');

      // 1. Normalize path (resolve to absolute, follow symlinks)
      let normalizedPath;
      try {
        normalizedPath = await fsPromises.realpath(folderPath);
      } catch (err) {
        return sendJSON(res, 400, {
          error: 'Path does not exist or is not accessible',
          details: err.message
        });
      }

      // 2. Validate it's a directory
      const stats = await fsPromises.stat(normalizedPath);
      if (!stats.isDirectory()) {
        return sendJSON(res, 400, { error: 'Path is not a directory' });
      }

      // 3. Check write permissions
      try {
        await fsPromises.access(normalizedPath, fsConstants.constants.W_OK);
      } catch (err) {
        return sendJSON(res, 400, {
          error: 'No write access to directory',
          details: 'The folder must be writable to store project metadata'
        });
      }

      // 4. Check if already registered in DB
      const existingProject = db.projects.findByPath.get(normalizedPath);
      if (existingProject) {
        // Update last_active and return existing project
        db.projects.touch(existingProject.id);
        return sendJSON(res, 200, {
          project: existingProject,
          status: 'already_registered',
          message: 'Project was already registered'
        });
      }

      // 5. Detect existing metadata directories
      const c3Path = pathModule.join(normalizedPath, '.c3');
      const c3ArchitectPath = pathModule.join(normalizedPath, '.c3-architect');

      let hasC3 = false;
      let hasC3Architect = false;
      let metadataState = null;

      try {
        await fsPromises.access(c3Path);
        hasC3 = true;
      } catch { /* doesn't exist */ }

      try {
        await fsPromises.access(c3ArchitectPath);
        hasC3Architect = true;
        // Try to read existing state
        try {
          const statePath = pathModule.join(c3ArchitectPath, 'state.json');
          const stateContent = await fsPromises.readFile(statePath, 'utf-8');
          metadataState = JSON.parse(stateContent);
        } catch { /* state.json doesn't exist or invalid */ }
      } catch { /* doesn't exist */ }

      // 6. Bootstrap metadata if missing
      let bootstrapped = false;
      if (!hasC3 && !hasC3Architect) {
        // Create minimal .c3-architect structure
        await fsPromises.mkdir(c3ArchitectPath, { recursive: true });
        await fsPromises.mkdir(pathModule.join(c3ArchitectPath, 'roadmap'), { recursive: true });

        // Derive name from folder name if not provided
        const derivedName = name || pathModule.basename(normalizedPath);

        // Create minimal state.json
        const initialState = {
          projectName: derivedName,
          createdAt: new Date().toISOString(),
          phase: 'discovery',
          version: '1.0.0',
          isExternal: true
        };

        await fsPromises.writeFile(
          pathModule.join(c3ArchitectPath, 'state.json'),
          JSON.stringify(initialState, null, 2),
          'utf-8'
        );

        bootstrapped = true;
        metadataState = initialState;
      }

      // 7. Register in DB (is_external = 1)
      const projectName = name || metadataState?.projectName || pathModule.basename(normalizedPath);
      const description = metadataState?.description || `External project: ${normalizedPath}`;

      const { project, wasExisting } = db.projects.registerExternal(projectName, normalizedPath, description);

      sendJSON(res, 201, {
        project,
        status: 'registered',
        metadata: {
          hasC3,
          hasC3Architect,
          bootstrapped,
          state: metadataState
        }
      });

    } catch (err) {
      logger.error('Server', `Open folder error: ${err.message}`);
      sendJSON(res, 500, safeError(err));
    }
  },

  'DELETE /api/projects/:id': async (req, res, params) => {
    try {
      const project = db.projects.findById.get(safeParseInt(params.id));
      if (!project) {
        return sendJSON(res, 404, { error: 'Project not found' });
      }

      // Delete project from DB (cascades to conversations, etc.)
      db.projects.delete.run(safeParseInt(params.id));

      sendJSON(res, 200, { success: true, deleted: params.id });
    } catch (err) {
      sendJSON(res, 500, safeError(err));
    }
  },
  
  // Conversations
  'GET /api/conversations': async (req, res) => {
    const url = new URL(req.url, `http://${req.headers.host}`);
    const limit = parseInt(url.searchParams.get('limit')) || 10;
    
    try {
      const conversations = db.conversations.listRecent.all(limit);
      sendJSON(res, 200, { conversations });
    } catch (err) {
      sendJSON(res, 500, safeError(err));
    }
  },
  
  'POST /api/conversations': async (req, res) => {
    const body = await parseBody(req);
    const { project_id, title } = body;
    
    try {
      const id = `conv-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
      const conversation = db.conversations.getOrCreate(id, project_id || null, title || null);
      
      sendJSON(res, 201, { conversation });
    } catch (err) {
      sendJSON(res, 500, safeError(err));
    }
  },
  
  'GET /api/conversations/:id': async (req, res, params) => {
    try {
      const conversation = db.conversations.findById.get(params.id);
      
      if (!conversation) {
        return sendJSON(res, 404, { error: 'Conversation not found' });
      }
      
      sendJSON(res, 200, { conversation });
    } catch (err) {
      sendJSON(res, 500, safeError(err));
    }
  },
  
  'GET /api/conversations/:id/messages': async (req, res, params) => {
    try {
      const messages = db.messages.listByConversation.all(params.id);
      sendJSON(res, 200, { messages });
    } catch (err) {
      sendJSON(res, 500, safeError(err));
    }
  },
  
  // Delete conversation
  'DELETE /api/conversations/:id': async (req, res, params) => {
    try {
      // Delete messages first (foreign key)
      db.db.prepare('DELETE FROM messages WHERE conversation_id = ?').run(params.id);
      // Delete attachments
      db.db.prepare('DELETE FROM attachments WHERE conversation_id = ?').run(params.id);
      // Delete conversation
      db.db.prepare('DELETE FROM conversations WHERE id = ?').run(params.id);
      
      sendJSON(res, 200, { success: true });
    } catch (err) {
      sendJSON(res, 500, safeError(err));
    }
  },
  
  // Chat (send message)
  // v44.0: ALL chat goes through ChatController - THE ONLY entry point
  // v56.0 Sprint 3: DB persistence now handled by ConversationStore inside ChatController.handle
  'POST /api/chat': async (req, res) => {
    const body = await parseBody(req);
    const { conversation_id, project_id, message } = body;

    if (!conversation_id || !message) {
      return sendJSON(res, 400, { error: 'conversation_id and message are required' });
    }

    try {
      // v56.0: No manual DB writes here — ChatController.handle persists via ConversationStore
      logger.info('Server', `[ChatController] Processing: "${message.substring(0, 50)}..."`);

      const result = await ChatController.handle({
        message,
        sessionId: conversation_id,
        userId: body.userId || null,
        context: {
          projectId: project_id,
          hasActiveProject: !!project_id,
        },
      });

      logger.info('Server', `[ChatController] Mode: ${result.mode}, Confidence: ${result.confidence.toFixed(2)}`);

      sendJSON(res, 200, {
        response: result.response,
        mode: result.mode,
        confidence: result.confidence,
        metadata: result.metadata,
      });

    } catch (err) {
      logger.error('Server', `Chat error: ${err.message}`);
      sendJSON(res, 500, safeError(err));
    }
  },
  
  // Drafts
  'GET /api/drafts': async (req, res) => {
    const url = new URL(req.url, `http://${req.headers.host}`);
    const conversationId = url.searchParams.get('conversation_id');
    const projectId = url.searchParams.get('project_id');
    
    try {
      const draft = db.drafts.get(conversationId, projectId ? parseInt(projectId) : null);
      sendJSON(res, 200, { draft });
    } catch (err) {
      sendJSON(res, 500, safeError(err));
    }
  },
  
  'POST /api/drafts': async (req, res) => {
    const body = await parseBody(req);
    const { conversation_id, project_id, content } = body;
    
    if (!content) {
      return sendJSON(res, 400, { error: 'content is required' });
    }
    
    try {
      db.drafts.save(content, conversation_id, project_id ? parseInt(project_id) : null);
      sendJSON(res, 200, { success: true });
    } catch (err) {
      sendJSON(res, 500, safeError(err));
    }
  },
  
  'DELETE /api/drafts': async (req, res) => {
    const body = await parseBody(req);
    const { conversation_id, project_id } = body;
    
    try {
      db.drafts.clear(conversation_id, project_id ? parseInt(project_id) : null);
      sendJSON(res, 200, { success: true });
    } catch (err) {
      sendJSON(res, 500, safeError(err));
    }
  },
  
  // Storage info
  'GET /api/storage/info': async (req, res) => {
    try {
      const result = db.attachments.getTotalSize.get();
      sendJSON(res, 200, { totalSize: result?.total || 0 });
    } catch (err) {
      sendJSON(res, 200, { totalSize: 0 });
    }
  },
  
  // Assign conversation to project
  'POST /api/conversations/:id/assign': async (req, res, params) => {
    const body = await parseBody(req);
    const { project_id } = body;
    
    if (!project_id) {
      return sendJSON(res, 400, { error: 'project_id is required' });
    }
    
    try {
      db.conversations.assignToProject.run(project_id, params.id);
      sendJSON(res, 200, { success: true });
    } catch (err) {
      sendJSON(res, 500, safeError(err));
    }
  },
  
  // Project roadmap
  'GET /api/projects/:id/roadmap': async (req, res, params) => {
    try {
      const project = db.projects.findById.get(safeParseInt(params.id));
      
      if (!project) {
        return sendJSON(res, 404, { error: 'Project not found' });
      }
      
      const fs = await import('fs/promises');
      const path = await import('path');
      
      // Try to read roadmap/main.md
      const roadmapPath = path.join(project.path, 'roadmap', 'main.md');
      
      try {
        const roadmap = await fs.readFile(roadmapPath, 'utf-8');
        sendJSON(res, 200, { roadmap });
      } catch {
        // No roadmap yet
        sendJSON(res, 200, { roadmap: null });
      }
    } catch (err) {
      sendJSON(res, 500, safeError(err));
    }
  },
  
  // Attachments upload
  'POST /api/attachments': async (req, res) => {
    try {
      const fs = await import('fs/promises');
      const path = await import('path');
      const crypto = await import('crypto');
      
      // Parse multipart form data
      const boundary = req.headers['content-type']?.split('boundary=')[1];
      
      if (!boundary) {
        return sendJSON(res, 400, { error: 'Invalid content type' });
      }
      
      const chunks = [];
      for await (const chunk of req) {
        chunks.push(chunk);
      }
      const buffer = Buffer.concat(chunks);
      
      // Simple multipart parser
      const parts = buffer.toString('binary').split('--' + boundary);
      let fileData = null;
      let filename = '';
      let mimeType = '';
      let conversationId = '';
      let projectId = '';
      
      for (const part of parts) {
        if (part.includes('filename="')) {
          const filenameMatch = part.match(/filename="([^"]+)"/);
          const contentTypeMatch = part.match(/Content-Type: ([^\r\n]+)/);
          
          if (filenameMatch) {
            filename = filenameMatch[1];
            mimeType = contentTypeMatch ? contentTypeMatch[1] : 'application/octet-stream';
            
            // Extract file data (after double CRLF)
            const dataStart = part.indexOf('\r\n\r\n') + 4;
            const dataEnd = part.lastIndexOf('\r\n');
            fileData = Buffer.from(part.substring(dataStart, dataEnd), 'binary');
          }
        } else if (part.includes('name="conversation_id"')) {
          const dataStart = part.indexOf('\r\n\r\n') + 4;
          conversationId = part.substring(dataStart).trim().replace(/\r\n--$/, '');
        } else if (part.includes('name="project_id"')) {
          const dataStart = part.indexOf('\r\n\r\n') + 4;
          projectId = part.substring(dataStart).trim().replace(/\r\n--$/, '');
        }
      }
      
      if (!fileData || !filename) {
        return sendJSON(res, 400, { error: 'No file uploaded' });
      }
      
      // Generate hash
      const hash = crypto.createHash('sha256').update(fileData).digest('hex').substring(0, 16);
      const ext = path.extname(filename);
      const storedFilename = `${hash}${ext}`;
      
      // Determine storage path
      let attachmentsDir;
      if (projectId) {
        const project = db.projects.findById.get(safeParseInt(projectId, 'projectId'));
        if (project) {
          attachmentsDir = path.join(project.path, 'attachments');
        }
      }
      
      if (!attachmentsDir && conversationId) {
        attachmentsDir = path.join(process.cwd(), 'chats', conversationId, 'attachments');
      }
      
      if (!attachmentsDir) {
        attachmentsDir = path.join(process.cwd(), 'data', 'attachments');
      }
      
      await fs.mkdir(attachmentsDir, { recursive: true });
      
      const filePath = path.join(attachmentsDir, storedFilename);
      await fs.writeFile(filePath, fileData);
      
      // Save to DB
      const id = db.attachments.create(
        conversationId || null,
        projectId ? parseInt(projectId) : null,
        storedFilename,
        filename,
        mimeType,
        fileData.length,
        hash,
        filePath
      );
      
      // Check total storage
      const totalSize = db.attachments.getTotalSize.get();
      const totalMB = (totalSize?.total || 0) / (1024 * 1024);
      
      sendJSON(res, 201, { 
        id, 
        filename: storedFilename,
        originalName: filename,
        size: fileData.length,
        totalStorageMB: totalMB.toFixed(1),
        warning: totalMB > 80 ? 'Storage approaching 100MB limit' : null
      });
      
    } catch (err) {
      logger.error('Server', `Attachment upload error: ${err.message}`);
      sendJSON(res, 500, safeError(err));
    }
  },
  
  // ══════════════════════════════════════════════════════════════════════════
  // v34.2: ARTIFACT DOWNLOAD
  // ══════════════════════════════════════════════════════════════════════════
  
  'GET /api/artifacts/:filename': async (req, res, params) => {
    try {
      const fsPromises = await import('fs/promises');
      const pathModule = await import('path');
      
      const artifactsDir = './data/artifacts';
      const filepath = pathModule.default.join(artifactsDir, params.filename);
      
      // Check if file exists
      try {
        await fsPromises.access(filepath);
      } catch {
        return sendJSON(res, 404, { error: 'Artifact not found' });
      }
      
      // Determine content type from extension
      let contentType, disposition;
      
      if (params.filename.endsWith('.pdf')) {
        contentType = 'application/pdf';
        disposition = 'inline';
      } else if (params.filename.endsWith('.xlsx')) {
        contentType = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
        disposition = 'attachment';
      } else if (params.filename.endsWith('.csv')) {
        contentType = 'text/csv; charset=utf-8';
        disposition = 'attachment';
      } else if (params.filename.endsWith('.json')) {
        contentType = 'application/json; charset=utf-8';
        disposition = 'attachment';
      } else if (params.filename.endsWith('.html')) {
        contentType = 'text/html; charset=utf-8';
        disposition = 'inline';
      } else {
        contentType = 'application/octet-stream';
        disposition = 'attachment';
      }
      
      // Read file
      const content = await fsPromises.readFile(filepath);
      
      // Create safe ASCII filename + UTF-8 encoded original
      // RFC 5987: filename*=UTF-8''encoded_name for non-ASCII
      const safeFilename = params.filename.replace(/[^\x00-\x7F]/g, '_');
      const encodedFilename = encodeURIComponent(params.filename);
      
      res.writeHead(200, {
        'Content-Type': contentType,
        'Content-Disposition': `${disposition}; filename="${safeFilename}"; filename*=UTF-8''${encodedFilename}`,
        'Content-Length': content.length,
        'Cache-Control': 'private, max-age=3600'
      });
      res.end(content);
      
    } catch (err) {
      logger.error('Server', `Artifact download error: ${err.message}`);
      sendJSON(res, 500, safeError(err));
    }
  },
  
  // Get attachment
  'GET /api/attachments/:id': async (req, res, params) => {
    try {
      const fs = await import('fs/promises');
      
      const attachment = db.attachments.findById.get(safeParseInt(params.id));
      
      if (!attachment) {
        return sendJSON(res, 404, { error: 'Attachment not found' });
      }
      
      const data = await fs.readFile(attachment.path);
      
      // Safe filename for non-ASCII characters
      const safeFilename = attachment.original_name.replace(/[^\x00-\x7F]/g, '_');
      const encodedFilename = encodeURIComponent(attachment.original_name);
      
      res.writeHead(200, {
        'Content-Type': attachment.mime_type,
        'Content-Disposition': `inline; filename="${safeFilename}"; filename*=UTF-8''${encodedFilename}`,
        'Content-Length': data.length,
      });
      res.end(data);
      
    } catch (err) {
      sendJSON(res, 500, safeError(err));
    }
  },

  // ══════════════════════════════════════════════════════════════════════════
  // v34: SETTINGS API
  // ══════════════════════════════════════════════════════════════════════════
  
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
      version: '34.4.2',
      timestamp: new Date().toISOString()
    });
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

  // ════════════════════════════════════════════════════════════════════════════
  // EXPERT LAYER ROUTES (v35)
  // ════════════════════════════════════════════════════════════════════════════

  'GET /experts': async (req, res) => {
    try {
      // Try multiple possible locations (relative to server.js and cwd)
      const possiblePaths = [
        path.join(__dirname, 'experts/experts.html'),             // Primary: src/experts/
        path.join(__dirname, '..', 'src/experts/experts.html'),   // From parent
        path.join(process.cwd(), 'src/experts/experts.html'),     // CWD fallback
        path.join(process.cwd(), 'experts/experts.html'),
        path.join(process.cwd(), 'experts.html')                  // Last resort
      ];
      
      let html = null;
      for (const p of possiblePaths) {
        try {
          html = fs.readFileSync(p, 'utf8');
          break;
        } catch (err) {
          // Expected: trying multiple paths
          logger.debug('Server', `experts.html not at ${p}: ${err.code}`);
        }
      }
      
      if (!html) {
        throw new Error('experts.html not found in: ' + possiblePaths.join(', '));
      }
      
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(html);
    } catch (err) {
      res.writeHead(500);
      res.end('Error loading experts page: ' + err.message);
    }
  },

  'GET /api/experts': async (req, res) => {
    try {
      if (!expertLayer) {
        return sendJSON(res, 500, { error: 'Expert layer not loaded' });
      }

      const experts = expertLayer.expertRegistry.getAll().map(e => e.toJSON());
      const categories = expertLayer.getExpertCategories();
      
      // Add custom experts to custom category
      const customExperts = experts.filter(e => e.isCustom).map(e => e.id);
      const customCat = categories.find(c => c.id === 'custom');
      if (customCat) {
        customCat.experts = customExperts;
      }

      sendJSON(res, 200, { experts, categories });
    } catch (err) {
      sendJSON(res, 500, safeError(err));
    }
  },

  'GET /api/experts/:id': async (req, res, params) => {
    try {
      if (!expertLayer) {
        return sendJSON(res, 500, { error: 'Expert layer not loaded' });
      }

      const expert = expertLayer.expertRegistry.get(params.id);
      if (!expert) {
        return sendJSON(res, 404, { error: 'Expert not found' });
      }

      sendJSON(res, 200, expert.toJSON());
    } catch (err) {
      sendJSON(res, 500, safeError(err));
    }
  },

  'POST /api/experts': async (req, res) => {
    try {
      if (!expertLayer) {
        return sendJSON(res, 500, { error: 'Expert layer not loaded' });
      }

      const body = await parseBody(req);

      // v57.0 - Validate config before saving
      const validation = validateExpertConfig(body);
      if (!validation.valid) {
        return sendJSON(res, 400, {
          error: 'Invalid expert configuration',
          details: validation.errors
        });
      }

      // Generate ID from name
      const id = body.id || body.name.toLowerCase()
        .replace(/\s+/g, '_')
        .replace(/[^a-z0-9_]/g, '')
        .substring(0, 32);

      // Check if exists
      if (expertLayer.expertRegistry.get(id)) {
        return sendJSON(res, 400, { error: 'Expert with this ID already exists' });
      }

      const expert = expertLayer.expertRegistry.addCustom({
        id,
        ...body,
        primaryProblemTypes: body.primaryProblemTypes || ['procedural'],
        allowedRepresentations: body.allowedRepresentations || ['structured'],
        preferredModels: body.preferredModels || ['qwen2.5:32b']
      });

      // Save to database
      saveCustomExperts();

      sendJSON(res, 201, expert.toJSON());
    } catch (err) {
      sendJSON(res, 500, safeError(err));
    }
  },

  'PUT /api/experts/:id': async (req, res, params) => {
    try {
      if (!expertLayer) {
        return sendJSON(res, 500, { error: 'Expert layer not loaded' });
      }

      const body = await parseBody(req);

      // v57.0 - Validate config before updating
      // Only validate fields that are being updated
      const configToValidate = { name: body.name || 'placeholder', ...body };
      const validation = validateExpertConfig(configToValidate);
      if (!validation.valid) {
        return sendJSON(res, 400, {
          error: 'Invalid expert configuration',
          details: validation.errors
        });
      }

      const expert = expertLayer.expertRegistry.updateCustom(params.id, body);

      if (!expert) {
        return sendJSON(res, 404, { error: 'Custom expert not found' });
      }

      // Save to database
      saveCustomExperts();

      sendJSON(res, 200, expert.toJSON());
    } catch (err) {
      sendJSON(res, 500, safeError(err));
    }
  },

  'DELETE /api/experts/:id': async (req, res, params) => {
    try {
      if (!expertLayer) {
        return sendJSON(res, 500, { error: 'Expert layer not loaded' });
      }

      const deleted = expertLayer.expertRegistry.removeCustom(params.id);
      
      if (!deleted) {
        return sendJSON(res, 404, { error: 'Custom expert not found' });
      }

      // Save to database
      saveCustomExperts();

      sendJSON(res, 200, { success: true });
    } catch (err) {
      sendJSON(res, 500, safeError(err));
    }
  },

  'POST /api/experts/route': async (req, res) => {
    try {
      if (!expertLayer) {
        return sendJSON(res, 500, { error: 'Expert layer not loaded' });
      }

      const body = await parseBody(req);
      const result = expertLayer.routeToExpert(body.message, body.intent);

      sendJSON(res, 200, {
        expertId: result.expert?.id || null,
        expertName: result.expert?.name || null,
        confidence: result.confidence,
        reason: result.reason
      });
    } catch (err) {
      sendJSON(res, 500, safeError(err));
    }
  },

  // (Orchestrator API v36 routes removed — module-level orchestrator was dead code.
  //  Architect routes at /api/architect/* still work via ConversationOrchestrator.)

  // ════════════════════════════════════════════════════════════════════════════
  // v61: Lifecycle API — Project Lifecycle Management
  // ════════════════════════════════════════════════════════════════════════════

  'POST /api/lifecycle/start': async (req, res) => {
    const body = await parseBody(req);
    const { projectId, request, config: lcConfig } = body;

    if (!projectId || !request) {
      return sendJSON(res, 400, { error: 'projectId and request are required' });
    }

    try {
      const { ProjectLifecycle } = await import('./planner/lifecycle.js');
      const { startSpec } = await import('./planner/lifecycle-spec.js');

      const lifecycle = ProjectLifecycle.create({ projectId, config: lcConfig || {} });
      const specResult = await startSpec(lifecycle, request, {});

      sendJSON(res, 200, {
        lifecycleId: lifecycle.id,
        phase: lifecycle.phase,
        ...specResult,
      });
    } catch (err) {
      logger.error('Server', `Lifecycle start error: ${err.message}`);
      sendJSON(res, 500, safeError(err));
    }
  },

  'POST /api/lifecycle/spec/answer': async (req, res) => {
    const body = await parseBody(req);
    const { lifecycleId, answers } = body;

    if (!lifecycleId || !answers) {
      return sendJSON(res, 400, { error: 'lifecycleId and answers are required' });
    }

    try {
      const { ProjectLifecycle } = await import('./planner/lifecycle.js');
      const { answerSpecQuestions } = await import('./planner/lifecycle-spec.js');

      const lifecycle = ProjectLifecycle.resume(lifecycleId);
      const result = await answerSpecQuestions(lifecycle, answers);
      sendJSON(res, 200, { lifecycleId, phase: lifecycle.phase, ...result });
    } catch (err) {
      logger.error('Server', `Lifecycle spec/answer error: ${err.message}`);
      sendJSON(res, 500, safeError(err));
    }
  },

  'POST /api/lifecycle/spec/approve': async (req, res) => {
    const body = await parseBody(req);
    const { lifecycleId } = body;

    if (!lifecycleId) {
      return sendJSON(res, 400, { error: 'lifecycleId is required' });
    }

    try {
      const { ProjectLifecycle } = await import('./planner/lifecycle.js');
      const { approveSpec } = await import('./planner/lifecycle-spec.js');
      const { generateRoadmap } = await import('./planner/lifecycle-planning.js');

      const lifecycle = ProjectLifecycle.resume(lifecycleId);
      await approveSpec(lifecycle);
      const roadmapResult = await generateRoadmap(lifecycle);

      sendJSON(res, 200, { lifecycleId, phase: lifecycle.phase, ...roadmapResult });
    } catch (err) {
      logger.error('Server', `Lifecycle spec/approve error: ${err.message}`);
      sendJSON(res, 500, safeError(err));
    }
  },

  'POST /api/lifecycle/roadmap/approve': async (req, res) => {
    const body = await parseBody(req);
    const { lifecycleId } = body;

    if (!lifecycleId) {
      return sendJSON(res, 400, { error: 'lifecycleId is required' });
    }

    try {
      const { ProjectLifecycle } = await import('./planner/lifecycle.js');
      const { approveRoadmap } = await import('./planner/lifecycle-planning.js');

      const lifecycle = ProjectLifecycle.resume(lifecycleId);
      const result = await approveRoadmap(lifecycle);
      sendJSON(res, 200, { lifecycleId, phase: lifecycle.phase, ...result });
    } catch (err) {
      logger.error('Server', `Lifecycle roadmap/approve error: ${err.message}`);
      sendJSON(res, 500, safeError(err));
    }
  },

  'POST /api/lifecycle/milestone/approve': async (req, res) => {
    const body = await parseBody(req);
    const { lifecycleId, milestoneId } = body;

    if (!lifecycleId || !milestoneId) {
      return sendJSON(res, 400, { error: 'lifecycleId and milestoneId are required' });
    }

    try {
      const { ProjectLifecycle } = await import('./planner/lifecycle.js');
      const { approveMilestonePlan } = await import('./planner/lifecycle-build.js');

      const lifecycle = ProjectLifecycle.resume(lifecycleId);
      const result = await approveMilestonePlan(lifecycle, milestoneId);
      sendJSON(res, 200, { lifecycleId, milestoneId, ...result });
    } catch (err) {
      logger.error('Server', `Lifecycle milestone/approve error: ${err.message}`);
      sendJSON(res, 500, safeError(err));
    }
  },

  'POST /api/lifecycle/milestone/next': async (req, res) => {
    const body = await parseBody(req);
    const { lifecycleId } = body;

    if (!lifecycleId) {
      return sendJSON(res, 400, { error: 'lifecycleId is required' });
    }

    try {
      const { ProjectLifecycle } = await import('./planner/lifecycle.js');
      const { startNextMilestone } = await import('./planner/lifecycle-build.js');

      const lifecycle = ProjectLifecycle.resume(lifecycleId);
      const result = await startNextMilestone(lifecycle);
      sendJSON(res, 200, { lifecycleId, ...result });
    } catch (err) {
      logger.error('Server', `Lifecycle milestone/next error: ${err.message}`);
      sendJSON(res, 500, safeError(err));
    }
  },

  'POST /api/lifecycle/milestone/blocked': async (req, res) => {
    const body = await parseBody(req);
    const { lifecycleId, milestoneId, decision, feedback } = body;

    if (!lifecycleId || !milestoneId || !decision) {
      return sendJSON(res, 400, { error: 'lifecycleId, milestoneId and decision are required' });
    }

    try {
      const { ProjectLifecycle } = await import('./planner/lifecycle.js');
      const { handleMilestoneBlocked } = await import('./planner/lifecycle-build.js');

      const lifecycle = ProjectLifecycle.resume(lifecycleId);
      const result = await handleMilestoneBlocked(lifecycle, milestoneId, decision, feedback);
      sendJSON(res, 200, { lifecycleId, milestoneId, ...result });
    } catch (err) {
      logger.error('Server', `Lifecycle milestone/blocked error: ${err.message}`);
      sendJSON(res, 500, safeError(err));
    }
  },

  'POST /api/lifecycle/review/acknowledge': async (req, res) => {
    const body = await parseBody(req);
    const { lifecycleId, action } = body;

    if (!lifecycleId) {
      return sendJSON(res, 400, { error: 'lifecycleId is required' });
    }

    try {
      const { ProjectLifecycle } = await import('./planner/lifecycle.js');
      const lifecycle = ProjectLifecycle.resume(lifecycleId);

      // Action: 'continue' → back to BUILD, 'change' → CHANGE_MANAGEMENT
      if (action === 'change') {
        lifecycle.transitionTo('CHANGE_MANAGEMENT');
      } else {
        lifecycle.transitionTo('BUILD');
      }

      sendJSON(res, 200, { lifecycleId, phase: lifecycle.phase });
    } catch (err) {
      logger.error('Server', `Lifecycle review/acknowledge error: ${err.message}`);
      sendJSON(res, 500, safeError(err));
    }
  },

  'POST /api/lifecycle/change/propose': async (req, res) => {
    const body = await parseBody(req);
    const { lifecycleId, description } = body;

    if (!lifecycleId || !description) {
      return sendJSON(res, 400, { error: 'lifecycleId and description are required' });
    }

    try {
      const { ProjectLifecycle } = await import('./planner/lifecycle.js');
      const { proposeChange } = await import('./planner/lifecycle-change.js');

      const lifecycle = ProjectLifecycle.resume(lifecycleId);
      const result = await proposeChange(lifecycle, description);
      sendJSON(res, 200, { lifecycleId, ...result });
    } catch (err) {
      logger.error('Server', `Lifecycle change/propose error: ${err.message}`);
      sendJSON(res, 500, safeError(err));
    }
  },

  'POST /api/lifecycle/change/approve': async (req, res) => {
    const body = await parseBody(req);
    const { lifecycleId, changeRequestId } = body;

    if (!lifecycleId || !changeRequestId) {
      return sendJSON(res, 400, { error: 'lifecycleId and changeRequestId are required' });
    }

    try {
      const { ProjectLifecycle } = await import('./planner/lifecycle.js');
      const { applyChange } = await import('./planner/lifecycle-change.js');

      const lifecycle = ProjectLifecycle.resume(lifecycleId);
      const result = await applyChange(lifecycle, changeRequestId);
      sendJSON(res, 200, { lifecycleId, ...result });
    } catch (err) {
      logger.error('Server', `Lifecycle change/approve error: ${err.message}`);
      sendJSON(res, 500, safeError(err));
    }
  },

  'POST /api/lifecycle/change/reject': async (req, res) => {
    const body = await parseBody(req);
    const { changeRequestId } = body;

    if (!changeRequestId) {
      return sendJSON(res, 400, { error: 'changeRequestId is required' });
    }

    try {
      const { rejectChange } = await import('./planner/lifecycle-change.js');
      const result = rejectChange(changeRequestId);
      sendJSON(res, 200, result);
    } catch (err) {
      logger.error('Server', `Lifecycle change/reject error: ${err.message}`);
      sendJSON(res, 500, safeError(err));
    }
  },

  'GET /api/lifecycle/status': async (req, res) => {
    const url = new URL(req.url, `http://${req.headers.host}`);
    const lifecycleId = url.searchParams.get('id');

    if (!lifecycleId) {
      return sendJSON(res, 400, { error: 'id query param is required' });
    }

    try {
      const { ProjectLifecycle } = await import('./planner/lifecycle.js');
      const { computeLifecycleProgress } = await import('./planner/lifecycle-progress.js');
      const { getDriftHistory, getAggregateHealth } = await import('./planner/lifecycle-review.js');
      const { listChangeRequests } = await import('./planner/lifecycle-change.js');

      const lifecycle = ProjectLifecycle.resume(lifecycleId);
      const progress = computeLifecycleProgress(lifecycleId);
      const driftHistory = getDriftHistory(lifecycleId);
      const aggregateHealth = getAggregateHealth(lifecycleId);
      const changeRequests = listChangeRequests(lifecycleId);

      sendJSON(res, 200, {
        lifecycleId,
        phase: lifecycle.phase,
        progress,
        driftHistory,
        aggregateHealth,
        changeRequests,
      });
    } catch (err) {
      logger.error('Server', `Lifecycle status error: ${err.message}`);
      sendJSON(res, 500, safeError(err));
    }
  },

  'GET /api/lifecycle/resume': async (req, res) => {
    const url = new URL(req.url, `http://${req.headers.host}`);
    const lifecycleId = url.searchParams.get('id');

    if (!lifecycleId) {
      return sendJSON(res, 400, { error: 'id query param is required' });
    }

    try {
      const { ProjectLifecycle } = await import('./planner/lifecycle.js');
      const { computeLifecycleProgress } = await import('./planner/lifecycle-progress.js');

      const lifecycle = ProjectLifecycle.resume(lifecycleId);
      const progress = computeLifecycleProgress(lifecycleId);

      sendJSON(res, 200, {
        lifecycleId,
        phase: lifecycle.phase,
        config: lifecycle.config,
        progress,
      });
    } catch (err) {
      logger.error('Server', `Lifecycle resume error: ${err.message}`);
      sendJSON(res, 500, safeError(err));
    }
  },
};

// ─── Guard agent routes if platform not loaded ──────────────────────────────
if (!agentRoutes) {
  const notAvailable = (req, res) => sendJSON(res, 501, {
    error: 'Agent platform not available (C3_ENABLE_AGENTS=false)'
  });
  for (const key of Object.keys(routes)) {
    if (key.includes('/api/agents') || key === 'GET /agents' ||
        key.includes('/api/sources/') || key.includes('/api/notifications') ||
        key.includes('/api/scheduler')) {
      routes[key] = notAvailable;
    }
  }
}

// ═══ Trust Feedback Loop API (v57.2) ═════════════════════════════════════════
// Initialize trust tracker singleton with raw DB, then mount routes
getTrustTracker(db.db);
const trustRoutes = createTrustRoutes({ db: db.db, sendJSON, parseBody });
Object.assign(routes, trustRoutes);

// ════════════════════════════════════════════════════════════════════════════
// DEBUG: Runtime Module Tracer (activate: C3_TRACE=1 or --import ./src/core/tracer-register.mjs)
// ════════════════════════════════════════════════════════════════════════════

if (process.env.C3_TRACE === '1' || globalThis.__c3_tracer) {
  routes['GET /api/debug/modules'] = (req, res) => {
    if (globalThis.__c3_tracer) {
      sendJSON(res, 200, globalThis.__c3_tracer.getReport());
    } else {
      // Fallback: list statically known files
      import('fs').then(fs => import('path').then(path => {
        const srcDir = path.dirname(new URL(import.meta.url).pathname);
        const files = [];
        function walk(dir, base = '') {
          for (const entry of fs.readdirSync(dir)) {
            const full = path.join(dir, entry);
            const rel = base ? `${base}/${entry}` : entry;
            if (fs.statSync(full).isDirectory()) {
              if (!entry.startsWith('.') && entry !== 'node_modules' && entry !== '_archive') {
                walk(full, rel);
              }
            } else if (entry.endsWith('.js') || entry.endsWith('.mjs')) {
              files.push(rel);
            }
          }
        }
        walk(srcDir);
        sendJSON(res, 200, { source: 'filesystem', totalFiles: files.length, files });
      }));
    }
  };

  routes['GET /api/debug/health'] = (req, res) => {
    sendJSON(res, 200, {
      status: 'ok',
      uptime: process.uptime(),
      memory: process.memoryUsage(),
      tracer: !!globalThis.__c3_tracer,
      nodeVersion: process.version,
    });
  };

  logger.info('Server', 'Debug endpoints enabled: /api/debug/modules, /api/debug/health');
}

// ════════════════════════════════════════════════════════════════════════════
// EXPERT PERSISTENCE HELPERS
// ════════════════════════════════════════════════════════════════════════════

// Create experts table if not exists
try {
  db.db.exec(`
    CREATE TABLE IF NOT EXISTS custom_experts (
      id TEXT PRIMARY KEY,
      config TEXT NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);
} catch (err) {
  logger.warn('Server', `Could not create experts table: ${err.message}`);
}

// Load custom experts on startup
function loadCustomExperts() {
  if (!expertLayer) return;
  
  try {
    const rows = db.db.prepare('SELECT id, config FROM custom_experts').all();
    for (const row of rows) {
      const config = JSON.parse(row.config);
      expertLayer.expertRegistry.addCustom(config);
    }
    logger.info('Server', `Loaded ${rows.length} custom experts`);
  } catch (err) {
    logger.warn('Server', `Could not load custom experts: ${err.message}`);
  }
}

// Save custom experts
function saveCustomExperts() {
  if (!expertLayer) return;
  
  try {
    const experts = expertLayer.expertRegistry.getCustom();
    
    // Clear existing
    db.db.exec('DELETE FROM custom_experts');
    
    // Insert all
    const insert = db.db.prepare('INSERT INTO custom_experts (id, config) VALUES (?, ?)');
    for (const expert of experts) {
      insert.run(expert.id, JSON.stringify(expert.toJSON()));
    }
    
    logger.debug('Server', `Saved ${experts.length} custom experts`);
  } catch (err) {
    logger.warn('Server', `Could not save custom experts: ${err.message}`);
  }
}

// Load custom experts on startup
loadCustomExperts();

// ════════════════════════════════════════════════════════════════════════════
// ROUTER
// ════════════════════════════════════════════════════════════════════════════

function matchRoute(method, url) {
  const key = `${method} ${url}`;
  
  // Exact match
  if (routes[key]) {
    return { handler: routes[key], params: {} };
  }
  
  // Pattern match (with :param)
  for (const [pattern, handler] of Object.entries(routes)) {
    const [routeMethod, routePath] = pattern.split(' ');
    
    if (routeMethod !== method) continue;
    
    // Convert pattern to regex
    const paramNames = [];
    const regexStr = routePath.replace(/:(\w+)/g, (_, name) => {
      paramNames.push(name);
      return '([^/]+)';
    });
    
    const regex = new RegExp(`^${regexStr}$`);
    const match = url.match(regex);
    
    if (match) {
      const params = {};
      try {
        paramNames.forEach((name, i) => {
          params[name] = decodeURIComponent(match[i + 1]);
        });
      } catch {
        return null; // Malformed URI component → 404
      }
      return { handler, params };
    }
  }
  
  return null;
}

// ════════════════════════════════════════════════════════════════════════════
// SERVER
// ════════════════════════════════════════════════════════════════════════════

// ── Rate limiter (per-IP, in-memory) ─────────────────────────────────────
const _rateBuckets = new Map();
function checkRateLimit(ip) {
  const { windowMs, maxRequests } = config.server.rateLimit;
  const now = Date.now();
  let bucket = _rateBuckets.get(ip);
  if (!bucket || now - bucket.start > windowMs) {
    bucket = { start: now, count: 0 };
    _rateBuckets.set(ip, bucket);
  }
  bucket.count++;
  return bucket.count <= maxRequests;
}
// Cleanup stale buckets every 5 minutes
setInterval(() => {
  const cutoff = Date.now() - config.server.rateLimit.windowMs * 2;
  for (const [ip, b] of _rateBuckets) {
    if (b.start < cutoff) _rateBuckets.delete(ip);
  }
}, 300_000).unref();

const server = http.createServer(async (req, res) => {
  // CORS preflight
  if (req.method === 'OPTIONS') {
    const corsOrigin = getCorsOrigin(req);
    const headers = {
      'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
    };
    if (corsOrigin) headers['Access-Control-Allow-Origin'] = corsOrigin;
    res.writeHead(204, headers);
    return res.end();
  }

  // Rate limiting
  const clientIp = req.socket.remoteAddress || 'unknown';
  if (!checkRateLimit(clientIp)) {
    res.writeHead(429, { 'Content-Type': 'application/json', 'Retry-After': '60', ...SECURITY_HEADERS });
    return res.end(JSON.stringify({ error: 'Too many requests' }));
  }

  let pathname;
  try {
    const url = new URL(req.url, `http://${req.headers.host}`);
    pathname = url.pathname;
  } catch {
    return sendJSON(res, 400, { error: 'Malformed URL' });
  }

  logger.debug('Server', `${req.method} ${pathname}`);

  const route = matchRoute(req.method, pathname);

  if (!route) {
    return sendJSON(res, 404, { error: 'Not found' });
  }

  try {
    await route.handler(req, res, route.params);
  } catch (err) {
    if (err.message === 'Request body too large (max 1MB)') {
      return sendJSON(res, 413, { error: 'Request body too large (max 1MB)' });
    }
    if (err.message === 'Invalid JSON in request body') {
      return sendJSON(res, 400, { error: 'Invalid JSON in request body' });
    }
    if (err.statusCode) {
      return sendJSON(res, err.statusCode, { error: err.message });
    }
    logger.error('Server', `Handler error: ${err.message}`);
    sendJSON(res, 500, safeError(err));
  }
});

// ════════════════════════════════════════════════════════════════════════════
// REMOVED: Legacy workflow UI (getUIHTML) — v57.0
// Legacy workflow engine (THINKER→CODER→REVIEWER) deleted.
// Use /architect for UI, planner/workflow.js for backend.

// ════════════════════════════════════════════════════════════════════════════
// START
// ════════════════════════════════════════════════════════════════════════════

server.listen(config.server.port, config.server.host, async () => {
  // Start agent scheduler (Phase B — conditional)
  if (agentScheduler) agentScheduler.start();

  // D-int5: Auto-register example agents from src/agents/examples/
  if (agentRepository) {
    try {
      const { readdirSync, readFileSync } = await import('node:fs');
      const { join, dirname } = await import('node:path');
      const { fileURLToPath } = await import('node:url');
      const __dir = dirname(fileURLToPath(import.meta.url));
      const exDir = join(__dir, 'agents', 'examples');
      let registered = 0;
      for (const f of readdirSync(exDir).filter(f => f.endsWith('.json'))) {
        const def = JSON.parse(readFileSync(join(exDir, f), 'utf-8'));
        if (!def.id || agentRepository.getAgent(def.id)) continue;
        agentRepository.createAgent({
          id: def.id, name: def.name, description: def.description,
          icon: def.icon || '🤖', definition: def, enabled: true,
        });
        if (agentScheduler && def.schedule?.type !== 'manual') {
          agentScheduler.scheduleAgent(agentRepository.getAgent(def.id));
        }
        registered++;
      }
      if (registered > 0) logger.info('Server', `Auto-registered ${registered} example agents`);
    } catch (err) {
      logger.debug('Server', `Example agent registration skipped: ${err.message}`);
    }
  }

  // v59.0: Attach WebSocket server for IDE integration
  attachWebSocketServer(server, ChatController, logger);

  // Phase C1: Preload active workflow sessions into RAM cache
  try {
    const { preloadActiveSessions } = await import('./chat/handlers/session-resume.js');
    const count = preloadActiveSessions();
    if (count > 0) logger.info('Server', `Preloaded ${count} active workflow sessions`);
  } catch (err) {
    logger.debug('Server', `Session preload skipped: ${err.message}`);
  }

  // C1: Preload active lifecycle handoff states from DB (crash recovery)
  try {
    const { lifecycleHandoffState, lifecycles: lcRepo } = await import('./db/database.js');
    const { initLifecycleStateDb, preloadActiveLifecycles } = await import('./chat/handlers/lifecycle-state.js');
    initLifecycleStateDb(lifecycleHandoffState, lcRepo);
    const lcCount = preloadActiveLifecycles();
    if (lcCount > 0) logger.info('Server', `Preloaded ${lcCount} active lifecycle handoff states`);
  } catch (err) {
    logger.debug('Server', `Lifecycle handoff preload skipped: ${err.message}`);
  }

  logger.info('Server', `p(AI)assistant v57.0 started`);
  logger.info('Server', `Chat:   http://${config.server.host}:${config.server.port}/architect`);
  if (agentRoutes) logger.info('Server', `Agents: http://${config.server.host}:${config.server.port}/agents`);
  logger.info('Server', `API:    http://${config.server.host}:${config.server.port}`);
  logger.info('Server', `WS:    ws://${config.server.host}:${config.server.port}/c3/ws`);
});

// ════════════════════════════════════════════════════════════════════════════
// GLOBAL ERROR HANDLERS
// ════════════════════════════════════════════════════════════════════════════

process.on('unhandledRejection', (reason, promise) => {
  const message = reason instanceof Error ? reason.message : String(reason);
  const stack = reason instanceof Error ? reason.stack : undefined;
  logger.error('Process', 'Unhandled Promise Rejection', {
    message,
    stack,
    promiseInfo: 'Promise rejection not caught',
  });
});

process.on('uncaughtException', (error, origin) => {
  logger.error('Process', 'Uncaught Exception - FATAL', {
    message: error.message,
    stack: error.stack,
    origin,
  });
  
  // Attempt graceful shutdown
  try {
    db.close();
  } catch (e) {
    // Ignore cleanup errors
  }
  
  // Give logs time to flush, then exit
  setTimeout(() => process.exit(1), 100);
});

// ════════════════════════════════════════════════════════════════════════════
// GRACEFUL SHUTDOWN
// ════════════════════════════════════════════════════════════════════════════

/**
 * v55.1 - Graceful shutdown with proper cleanup
 */
function gracefulShutdown(signal) {
  logger.info('Server', `Received ${signal}, shutting down gracefully...`);
  
  // Stop session cleanup timer
  try {
    ChatController.stopCleanup();
    logger.debug('Server', 'Session cleanup stopped');
  } catch (e) {
    // Ignore
  }
  
  // Close database
  try {
    db.close();
    logger.debug('Server', 'Database closed');
  } catch (e) {
    // Ignore
  }
  
  logger.info('Server', 'Shutdown complete');
  process.exit(0);
}

process.on('SIGINT', () => gracefulShutdown('SIGINT'));
process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));

export default server;
