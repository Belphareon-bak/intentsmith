// C.3 v57.0 Server - p(AI)assistant
// ══════════════════════════════════════════════════════════════════════════════

import 'dotenv/config';
import http from 'http';
import fs from 'fs';
import path from 'path';
import { randomUUID } from 'crypto';
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
let expertiseLayer = null;
let expertiseStore = null;
let getExpertiseStore = null;
if (config.features.expertises !== false) {
  try {
    const store = await import('./expertises/expertise-store.js');
    getExpertiseStore = store.getExpertiseStore;
  } catch (err) {
    logger.warn('Server', `Expert store not available: ${err.message}`);
  }

  const possiblePaths = [
    './expertises/expertise-layer.js',
    './expertise-layer.js',
    './src/expertises/expertise-layer.js',
  ];
  for (const p of possiblePaths) {
    try {
      expertiseLayer = await import(p);
      logger.info('Server', `Expert layer loaded from ${p}`);
      break;
    } catch (err) {
      logger.debug('Server', `Expert layer not at ${p}: ${err.code || err.message}`);
    }
  }
  if (!expertiseLayer) logger.warn('Server', 'Expert layer not available - file not found');
} else {
  logger.info('Server', 'Expertise platform disabled (C3_ENABLE_EXPERTISES=false)');
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

// H9: Route modules (extracted from server.js)
import { createPlannerRoutes } from './routes/planner.js';
import { createArchitectRoutes } from './routes/architect.js';
import { createAgentPlatformRoutes } from './routes/agents.js';
import { createExpertiseRoutes, createLifecycleRoutes } from './routes/expertises.js';
import { createProjectRoutes } from './routes/projects.js';
import { createChatRoutes } from './routes/chat.js';
import { createMiscRoutes } from './routes/misc.js';
import { toolRegistry } from './tools/registry.js';

// v56.0 Sprint 3: Initialize ConversationStore with DB
import { getConversationStore } from './chat/conversation-store.js';
getConversationStore(db);

// v67.0: Initialize MemoryBank with DB
import { getMemoryBank } from './memory/memory-bank.js';
getMemoryBank(db);

// F1: Setup Wizard — first-run detection + API routes
import { SetupWizard, createSetupRoutes } from './setup/wizard.js';
const setupWizard = new SetupWizard(config.db?.path ? path.dirname(config.db.path) : './data');
setupWizard.load();
const setupComplete = setupWizard.isComplete();
if (!setupComplete) {
  logger.info('Server', 'First run detected — setup wizard available at /api/setup/*');
}

// F2: Auto-updater — background version checker
import { startUpdateChecker, stopUpdateChecker, getCurrentVersion } from './packaging/auto-updater.js';

// F3: License system — feature gates
import { licenseManager, TIERS } from './licensing/license.js';
const licenseStatus = licenseManager.getStatus();
logger.info('Server', `License: ${licenseStatus.tier} (${licenseStatus.valid ? 'valid' : licenseStatus.error || 'no key'})`);

// v57.0: Initialize ExpertStore with DB (if experts enabled)
if (getExpertiseStore) expertiseStore = getExpertiseStore(db);

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

// v63.0: Wizard-specific rate limiter (🔴2)
const _wizardRateLimits = new Map();
function checkWizardRateLimit(key, intervalMs) {
  const now = Date.now();
  const last = _wizardRateLimits.get(key) || 0;
  if (now - last < intervalMs) return false;
  _wizardRateLimits.set(key, now);
  return true;
}

// H9: Build deps object for route modules
const routeDeps = {
  db, parseBody, sendJSON, sendHTML, sendStaticFile, safeError, safeParseInt,
  logger, config, path, fs, randomUUID,
  ChatController, expertiseLayer, expertiseStore,
  callWithAuth, createAuthToken, LLMCallerRole,
  getArchitectSession, setArchitectSession, getArchitectUIHTML,
  createMockResponse, agentRoutes, agentRunner,
  checkWizardRateLimit,
};

const routes = {
  // Health check (inline — small)
  'GET /': (req, res) => {
    sendJSON(res, 200, {
      name: 'p(AI)assistant',
      version: '65.6.0',
      status: 'ok',
      setupComplete,
      endpoints: [
        'POST /chat',
        'POST /planner/start',
        'GET /api/global-memory',
        'GET /architect',
        'GET /expertises',
        'GET /agents',
        'GET /chat-ui',
        'POST /api/lifecycle/start',
        'GET /api/debug/modules (C3_TRACE=1)',
      ],
    });
  },

  // H9: Spread route modules
  ...createChatRoutes(routeDeps),
  ...createPlannerRoutes(routeDeps),
  ...createArchitectRoutes(routeDeps),
  ...createAgentPlatformRoutes(routeDeps),
  ...createExpertiseRoutes(routeDeps),
  ...createLifecycleRoutes(routeDeps),
  ...createProjectRoutes(routeDeps),
  ...createMiscRoutes(routeDeps),

  // F1: Setup Wizard routes (always available — idempotent after completion)
  ...createSetupRoutes(setupWizard, routeDeps),

  // F3: License status API
  'GET /api/license/status': (req, res) => {
    const status = licenseManager.getStatus();
    sendJSON(res, 200, {
      tier: status.tier,
      valid: status.valid,
      features: status.features,
      expiresAt: status.expiresAt || null,
      owner: status.owner || null,
    });
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

// F3: License feature gates — restrict PRO/ENTERPRISE features on FREE tier
if (licenseStatus.tier === 'FREE') {
  const proRequired = (req, res) => sendJSON(res, 403, {
    error: 'PRO license required for this feature',
    tier: 'FREE',
    upgrade: 'Set C3_LICENSE_KEY in environment or use /api/setup/license',
  });
  for (const key of Object.keys(routes)) {
    // Agents & workers require PRO
    if (key.includes('/api/agents') || key === 'GET /agents' ||
        key.includes('/api/sources/') || key.includes('/api/notifications') ||
        key.includes('/api/scheduler')) {
      routes[key] = proRequired;
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

// Create custom_expertises table if not exists (v69: renamed from custom_experts)
try {
  db.db.exec(`
    CREATE TABLE IF NOT EXISTS custom_expertises (
      id TEXT PRIMARY KEY,
      config TEXT NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);
} catch (err) {
  logger.warn('Server', `Could not create custom_expertises table: ${err.message}`);
}

// Load custom experts on startup
function loadCustomExpertises() {
  if (!expertiseLayer) return;
  
  try {
    const rows = db.db.prepare('SELECT id, config FROM custom_expertises').all();
    for (const row of rows) {
      const config = JSON.parse(row.config);
      expertiseLayer.expertiseRegistry.addCustom(config);
    }
    logger.info('Server', `Loaded ${rows.length} custom experts`);
  } catch (err) {
    logger.warn('Server', `Could not load custom experts: ${err.message}`);
  }
}

// Save custom experts
function saveCustomExpertises() {
  if (!expertiseLayer) return;
  
  try {
    const experts = expertiseLayer.expertiseRegistry.getCustom();
    
    // Clear existing
    db.db.exec('DELETE FROM custom_expertises');

    // Insert all
    const insert = db.db.prepare('INSERT INTO custom_expertises (id, config) VALUES (?, ?)');
    for (const expert of experts) {
      insert.run(expert.id, JSON.stringify(expert.toJSON()));
    }
    
    logger.debug('Server', `Saved ${experts.length} custom experts`);
  } catch (err) {
    logger.warn('Server', `Could not save custom experts: ${err.message}`);
  }
}

// Load custom experts on startup
loadCustomExpertises();

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

  // v64.0: Bind CRE Gatekeeper audit DB
  try {
    const { creOverrideLog } = await import('./db/database.js');
    const { creDecisionEngine } = await import('./chat/cre-decision.js');
    creDecisionEngine.bindAuditDb(creOverrideLog);
    logger.info('Server', 'CRE Gatekeeper audit DB bound');
  } catch (err) {
    logger.debug('Server', `CRE audit DB bind skipped: ${err.message}`);
  }

  // F2: Start background update checker (only if repository configured)
  if (process.env.C3_UPDATE_REPO) {
    startUpdateChecker((update) => {
      logger.info('Updater', `New version available: ${update.latestVersion} (current: ${update.currentVersion})`);
      logger.info('Updater', `Release: ${update.releaseUrl}`);
    });
  }

  const ver = getCurrentVersion() || '65.6.0';
  logger.info('Server', `p(AI)assistant v${ver} started`);
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

  // F2: Stop update checker
  try { stopUpdateChecker(); } catch { /* ignore */ }

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
