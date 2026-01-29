// C.3 v45.0.0 Server - p(AI)assistant
// ══════════════════════════════════════════════════════════════════════════════

import http from 'http';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { config } from './config.js';
import { logger } from './core/logger.js';
import { workflowEngine } from './workflow/engine.js';
import db from './db/database.js';

// ESM __dirname equivalent
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Agent Platform v33
import { AgentRepository, initAgentTables } from './agents/repository.js';
import { AgentScheduler } from './agents/scheduler.js';
import { AgentRunner } from './agents/runner.js';
import { createAgentRoutes } from './agents/api.js';
import { LLMServices } from './agents/llm-services.js';

// Expert Layer v35
let expertLayer = null;
async function loadExpertLayer() {
  const possiblePaths = [
    './experts/expert-layer.js',    // Primary location (src/experts/)
    './expert-layer.js',             // Fallback (root)
    './src/experts/expert-layer.js'  // Alternative
  ];
  
  for (const p of possiblePaths) {
    try {
      expertLayer = await import(p);
      logger.info('Server', `Expert layer loaded from ${p}`);
      return;
    } catch {}
  }
  logger.warn('Server', 'Expert layer not available - file not found');
}
await loadExpertLayer();

// Orchestrator v36 (Agent-Expert Integration)
let orchestrator = null;
async function loadOrchestrator() {
  try {
    const { getOrchestrator } = await import('./orchestrator/orchestrator.js');
    orchestrator = getOrchestrator();
    logger.info('Server', 'Orchestrator v36 loaded');
  } catch (err) {
    logger.warn('Server', `Orchestrator not available: ${err.message}`);
  }
}
await loadOrchestrator();

// Initialize Agent tables
initAgentTables(db.db);

// v36.9.1: LLM client routed through gateway with auth tokens
import { callWithAuth } from './llm/gateway.js';
import { createAuthToken, LLMCallerRole } from './llm/auth-types.js';

// v44.0: ChatController - THE ONLY entry point for chat
import { ChatController, ChatMode } from './unification/chat-controller.js';
import { getDefaultHandlers } from './unification/handlers.js';
import { toolExecutor } from './unification/tool-executor.js';
import { toolRegistry } from './tools/registry.js';

// Configure ChatController with default handlers
ChatController.configure({
  handlers: getDefaultHandlers(),
  config: {
    autoModeDetection: true,
    modeConfidenceThreshold: 0.6,
  },
});
logger.info('Server', 'ChatController v45.0 configured');

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

const agentLLMClient = {
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

// Initialize Agent Platform
const agentRepository = new AgentRepository(db.db);
const llmServices = new LLMServices({ llmClient: agentLLMClient });
const agentRunner = new AgentRunner({ repository: agentRepository, llmServices });
const agentScheduler = new AgentScheduler({ repository: agentRepository, runner: agentRunner });
const agentRoutes = createAgentRoutes({ 
  repository: agentRepository, 
  scheduler: agentScheduler, 
  executor: agentRunner,
  llmClient: agentLLMClient
});

// Bind LLM client to Orchestrator (late binding)
if (orchestrator) {
  orchestrator.setLLMClient(agentLLMClient);
  logger.info('Server', 'Orchestrator bound to LLM client');
}

// ════════════════════════════════════════════════════════════════════════════
// REQUEST HELPERS
// ════════════════════════════════════════════════════════════════════════════

async function parseBody(req) {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', chunk => body += chunk);
    req.on('end', () => {
      try {
        resolve(body ? JSON.parse(body) : {});
      } catch {
        resolve({ raw: body });
      }
    });
    req.on('error', reject);
  });
}

function sendJSON(res, status, data) {
  res.writeHead(status, {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
  });
  res.end(JSON.stringify(data));
}

function sendHTML(res, html) {
  res.writeHead(200, {
    'Content-Type': 'text/html; charset=utf-8',
    'Access-Control-Allow-Origin': '*',
  });
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
    
    // Try multiple paths: relative to server.js, then relative to cwd
    const pathsToTry = [
      path.join(__dirname, '..', filepath),           // From src/../filepath
      path.join(__dirname, filepath.replace(/^src\//, '')),  // From src/filepath without src prefix
      path.join(process.cwd(), filepath)              // From cwd/filepath
    ];
    
    for (const fullPath of pathsToTry) {
      try {
        const content = await fsPromises.readFile(fullPath, 'utf-8');
        res.writeHead(200, {
          'Content-Type': contentType + '; charset=utf-8',
          'Access-Control-Allow-Origin': '*',
          'Cache-Control': 'no-cache',
        });
        res.end(content);
        return;
      } catch {}
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

// ════════════════════════════════════════════════════════════════════════════
// API ROUTES
// v44.5: server.js = transport & wiring ONLY
// All logic goes through ChatController → handlers.js → CRE → ToolExecutor
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
// ║  Put it in handlers.js or CRE. That's what they're for.                   ║
// ╚═══════════════════════════════════════════════════════════════════════════╝
//

const routes = {
  // Health check
  'GET /': (req, res) => {
    sendJSON(res, 200, {
      name: 'p(AI)assistant',
      version: '36.0.0',
      status: 'ok',
      endpoints: [
        'POST /workflow - Start or continue workflow',
        'GET /workflow/:sessionId - Get workflow status',
        'GET /sessions - List active sessions',
        'POST /chat - Simple chat',
        'GET /memory - List global memory',
        'POST /memory - Set memory value',
        'GET /ui - Workflow UI',
        'GET /architect - Architect Mode UI',
        'GET /experts - Expert Layer UI (v35)',
        'GET /agents - Agent Platform UI',
        'GET /api/agents - List all agents',
        'POST /api/agents - Create agent',
        'POST /api/agents/build - Build agent from description',
        'POST /api/orchestrator/request - Request expert (v36)',
        'POST /api/orchestrator/check - Pre-flight expert check (v36)',
        'GET /api/orchestrator/log - Audit log (v36)',
        'GET /api/orchestrator/stats - Statistics (v36)',
      ],
    });
  },
  
  // ══════════════════════════════════════════════════════════════════════════
  // WORKFLOW API
  // ══════════════════════════════════════════════════════════════════════════
  
  'POST /workflow': async (req, res) => {
    const body = await parseBody(req);
    const { sessionId, message, workdir } = body;
    
    if (!sessionId) {
      return sendJSON(res, 400, { error: 'sessionId is required' });
    }
    
    logger.info('Server', `POST /workflow`, { sessionId, messageLength: message?.length });
    
    try {
      // Check if session exists
      const existingSession = workflowEngine.getSession(sessionId);
      
      let result;
      
      if (!existingSession) {
        // Start new workflow
        if (!message) {
          return sendJSON(res, 400, { error: 'message is required for new workflow' });
        }
        if (!workdir) {
          return sendJSON(res, 400, { error: 'workdir is required for new workflow' });
        }
        
        result = await workflowEngine.start(sessionId, message, workdir);
      } else {
        // Continue existing workflow
        if (!message) {
          return sendJSON(res, 400, { error: 'message is required to continue workflow' });
        }
        
        result = await workflowEngine.continue(sessionId, message);
      }
      
      sendJSON(res, 200, result);
      
    } catch (err) {
      logger.error('Server', `Workflow error: ${err.message}`);
      sendJSON(res, 500, { error: err.message, state: 'ERROR' });
    }
  },
  
  'GET /workflow/:sessionId': (req, res, params) => {
    const session = workflowEngine.getSession(params.sessionId);
    
    if (!session) {
      return sendJSON(res, 404, { error: 'Session not found' });
    }
    
    sendJSON(res, 200, {
      sessionId: session.sessionId,
      state: session.state,
      complexity: session.complexity,
      summary: session.getSummary(),
    });
  },
  
  // ══════════════════════════════════════════════════════════════════════════
  // SESSIONS API
  // ══════════════════════════════════════════════════════════════════════════
  
  'GET /sessions': (req, res) => {
    const sessions = [];
    
    for (const [id, session] of workflowEngine.sessions) {
      sessions.push({
        sessionId: id,
        state: session.state,
        complexity: session.complexity,
        workdir: session.workdir,
      });
    }
    
    sendJSON(res, 200, { sessions });
  },
  
  // ══════════════════════════════════════════════════════════════════════════
  // MEMORY API
  // ══════════════════════════════════════════════════════════════════════════
  
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
    const { message } = body;

    if (!message) {
      return sendJSON(res, 400, { error: 'message is required' });
    }

    try {
      // v44.5: Route through ChatController - THE ONLY brain
      const sessionId = `simple-${Date.now()}`;

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
      });

    } catch (err) {
      logger.error('Server', `Chat error: ${err.message}`);
      sendJSON(res, 500, { error: err.message });
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
      
      // Store orchestrator for this project (simplified - in production use proper session management)
      global.architectSessions = global.architectSessions || {};
      global.architectSessions[projectRoot] = orchestrator;
      
      sendJSON(res, 200, {
        success: true,
        project: projectName,
        state: orchestrator.getSessionInfo(),
      });
    } catch (err) {
      logger.error('Server', `Architect init error: ${err.message}`);
      sendJSON(res, 500, { error: err.message });
    }
  },
  
  'POST /architect/message': async (req, res) => {
    const body = await parseBody(req);
    const { projectRoot, message, attachments } = body;
    
    if (!projectRoot || !message) {
      return sendJSON(res, 400, { error: 'projectRoot and message are required' });
    }
    
    try {
      global.architectSessions = global.architectSessions || {};
      let orchestrator = global.architectSessions[projectRoot];
      
      if (!orchestrator) {
        // Try to load existing project
        const { ConversationOrchestrator } = await import('./architect/index.js');
        orchestrator = new ConversationOrchestrator(projectRoot);
        await orchestrator.init('unknown'); // Will load existing state
        global.architectSessions[projectRoot] = orchestrator;
      }
      
      const result = await orchestrator.process(message, attachments || []);
      
      sendJSON(res, 200, {
        ...result,
        state: orchestrator.getSessionInfo(),
      });
    } catch (err) {
      logger.error('Server', `Architect message error: ${err.message}`);
      sendJSON(res, 500, { error: err.message });
    }
  },
  
  'GET /architect/status/:projectRoot': async (req, res, params) => {
    const projectRoot = decodeURIComponent(params.projectRoot);
    
    try {
      global.architectSessions = global.architectSessions || {};
      const orchestrator = global.architectSessions[projectRoot];
      
      if (!orchestrator) {
        return sendJSON(res, 404, { error: 'Project not loaded' });
      }
      
      sendJSON(res, 200, orchestrator.getSessionInfo());
    } catch (err) {
      sendJSON(res, 500, { error: err.message });
    }
  },
  
  'POST /architect/action': async (req, res) => {
    const body = await parseBody(req);
    const { projectRoot, action } = body;
    
    if (!projectRoot || !action) {
      return sendJSON(res, 400, { error: 'projectRoot and action are required' });
    }
    
    try {
      global.architectSessions = global.architectSessions || {};
      const orchestrator = global.architectSessions[projectRoot];
      
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
      sendJSON(res, 500, { error: err.message });
    }
  },
  
  // ══════════════════════════════════════════════════════════════════════════
  // UI
  // ══════════════════════════════════════════════════════════════════════════
  
  'GET /ui': async (req, res) => {
    sendHTML(res, getUIHTML());
  },
  
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
      sendJSON(res, 500, { error: err.message });
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
    try {
      db.db.prepare(`
        INSERT OR REPLACE INTO user_memory (id, data, updated_at)
        VALUES (1, ?, datetime('now'))
      `).run(JSON.stringify(body));
      sendJSON(res, 200, { success: true });
    } catch (err) {
      sendJSON(res, 500, { error: err.message });
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
      sendJSON(res, 500, { error: err.message });
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
      sendJSON(res, 500, { error: err.message });
    }
  },
  
  'GET /api/projects/:id': async (req, res, params) => {
    try {
      const project = db.projects.findById.get(parseInt(params.id));
      
      if (!project) {
        return sendJSON(res, 404, { error: 'Project not found' });
      }
      
      sendJSON(res, 200, { project });
    } catch (err) {
      sendJSON(res, 500, { error: err.message });
    }
  },
  
  'GET /api/projects/:id/conversations': async (req, res, params) => {
    const url = new URL(req.url, `http://${req.headers.host}`);
    const limit = parseInt(url.searchParams.get('limit')) || 10;
    
    try {
      const conversations = db.conversations.listRecentByProject.all(parseInt(params.id), limit);
      sendJSON(res, 200, { conversations });
    } catch (err) {
      sendJSON(res, 500, { error: err.message });
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
      sendJSON(res, 500, { error: err.message });
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
      sendJSON(res, 500, { error: err.message });
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
      sendJSON(res, 500, { error: err.message });
    }
  },
  
  'GET /api/conversations/:id/messages': async (req, res, params) => {
    try {
      const messages = db.messages.listByConversation.all(params.id);
      sendJSON(res, 200, { messages });
    } catch (err) {
      sendJSON(res, 500, { error: err.message });
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
      sendJSON(res, 500, { error: err.message });
    }
  },
  
  // Chat (send message)
  // v44.0: ALL chat goes through ChatController - THE ONLY entry point
  'POST /api/chat': async (req, res) => {
    const body = await parseBody(req);
    const { conversation_id, project_id, message } = body;

    if (!conversation_id || !message) {
      return sendJSON(res, 400, { error: 'conversation_id and message are required' });
    }

    try {
      // Save user message
      db.messages.addMessage(conversation_id, 'user', message);

      // v44.0: Route through ChatController - NO legacy routing
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

      const response = result.response;

      // Save assistant message
      db.messages.addMessage(conversation_id, 'assistant', response);

      // Update conversation title if first message
      const conv = db.conversations.findById.get(conversation_id);
      if (conv && !conv.title && conv.message_count <= 2) {
        db.conversations.updateTitle.run(message.substring(0, 50), conversation_id);
      }

      sendJSON(res, 200, {
        response,
        mode: result.mode,
        confidence: result.confidence,
        metadata: result.metadata,
      });

    } catch (err) {
      logger.error('Server', `Chat error: ${err.message}`);
      sendJSON(res, 500, { error: err.message });
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
      sendJSON(res, 500, { error: err.message });
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
      sendJSON(res, 500, { error: err.message });
    }
  },
  
  'DELETE /api/drafts': async (req, res) => {
    const body = await parseBody(req);
    const { conversation_id, project_id } = body;
    
    try {
      db.drafts.clear(conversation_id, project_id ? parseInt(project_id) : null);
      sendJSON(res, 200, { success: true });
    } catch (err) {
      sendJSON(res, 500, { error: err.message });
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
      sendJSON(res, 500, { error: err.message });
    }
  },
  
  // Project roadmap
  'GET /api/projects/:id/roadmap': async (req, res, params) => {
    try {
      const project = db.projects.findById.get(parseInt(params.id));
      
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
      sendJSON(res, 500, { error: err.message });
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
        const project = db.projects.findById.get(parseInt(projectId));
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
      sendJSON(res, 500, { error: err.message });
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
      sendJSON(res, 500, { error: err.message });
    }
  },
  
  // Get attachment
  'GET /api/attachments/:id': async (req, res, params) => {
    try {
      const fs = await import('fs/promises');
      
      const attachment = db.attachments.findById.get(parseInt(params.id));
      
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
      sendJSON(res, 500, { error: err.message });
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
      sendJSON(res, 500, { error: err.message });
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
      sendJSON(res, 500, { error: err.message });
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
        } catch {}
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
      sendJSON(res, 500, { error: err.message });
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
      sendJSON(res, 500, { error: err.message });
    }
  },

  'POST /api/experts': async (req, res) => {
    try {
      if (!expertLayer) {
        return sendJSON(res, 500, { error: 'Expert layer not loaded' });
      }

      const body = await parseBody(req);
      
      if (!body.name) {
        return sendJSON(res, 400, { error: 'Name is required' });
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
      sendJSON(res, 500, { error: err.message });
    }
  },

  'PUT /api/experts/:id': async (req, res, params) => {
    try {
      if (!expertLayer) {
        return sendJSON(res, 500, { error: 'Expert layer not loaded' });
      }

      const body = await parseBody(req);
      const expert = expertLayer.expertRegistry.updateCustom(params.id, body);
      
      if (!expert) {
        return sendJSON(res, 404, { error: 'Custom expert not found' });
      }

      // Save to database
      saveCustomExperts();

      sendJSON(res, 200, expert.toJSON());
    } catch (err) {
      sendJSON(res, 500, { error: err.message });
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
      sendJSON(res, 500, { error: err.message });
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
      sendJSON(res, 500, { error: err.message });
    }
  },

  // ══════════════════════════════════════════════════════════════════════════
  // ORCHESTRATOR API v36 (Agent-Expert Integration)
  // ══════════════════════════════════════════════════════════════════════════

  'POST /api/orchestrator/request': async (req, res) => {
    try {
      if (!orchestrator) {
        return sendJSON(res, 500, { error: 'Orchestrator not loaded' });
      }

      // P1: Auth check placeholder (implement proper auth in production)
      // TODO: Add authentication/role check here
      // if (!isAuthorized(req, 'orchestrator.request')) {
      //   return sendJSON(res, 403, { error: 'Unauthorized' });
      // }

      const body = await parseBody(req);
      
      if (!body.expertId || !body.task) {
        return sendJSON(res, 400, { error: 'expertId and task are required' });
      }

      const result = await orchestrator.requestExpert({
        requester: body.requester || 'api_manual',
        expertId: body.expertId,
        task: body.task,
        context: body.context || null
      });

      sendJSON(res, result.success ? 200 : 400, result);
    } catch (err) {
      sendJSON(res, 500, { error: err.message });
    }
  },

  'POST /api/orchestrator/check': async (req, res) => {
    try {
      if (!orchestrator) {
        return sendJSON(res, 500, { error: 'Orchestrator not loaded' });
      }

      const body = await parseBody(req);
      
      if (!body.task) {
        return sendJSON(res, 400, { error: 'task is required' });
      }

      const result = orchestrator.shouldUseExpert(body.task, body.context);
      sendJSON(res, 200, result);
    } catch (err) {
      sendJSON(res, 500, { error: err.message });
    }
  },

  'GET /api/orchestrator/log': async (req, res) => {
    try {
      if (!orchestrator) {
        return sendJSON(res, 500, { error: 'Orchestrator not loaded' });
      }

      // P1: Auth check placeholder
      // TODO: Add admin role check here

      const url = new URL(req.url, `http://${req.headers.host}`);
      const filters = {
        requester: url.searchParams.get('requester'),
        expertId: url.searchParams.get('expertId'),
        status: url.searchParams.get('status'),
        since: url.searchParams.get('since') ? parseInt(url.searchParams.get('since')) : null,
        limit: url.searchParams.get('limit') ? parseInt(url.searchParams.get('limit')) : 100
      };

      // Remove null/undefined filters
      Object.keys(filters).forEach(k => filters[k] == null && delete filters[k]);

      const log = orchestrator.getAuditLog(filters);
      sendJSON(res, 200, { entries: log, count: log.length });
    } catch (err) {
      sendJSON(res, 500, { error: err.message });
    }
  },

  'GET /api/orchestrator/stats': async (req, res) => {
    try {
      if (!orchestrator) {
        return sendJSON(res, 500, { error: 'Orchestrator not loaded' });
      }

      const stats = orchestrator.getStats();
      sendJSON(res, 200, stats);
    } catch (err) {
      sendJSON(res, 500, { error: err.message });
    }
  },

  'DELETE /api/orchestrator/log': async (req, res) => {
    try {
      if (!orchestrator) {
        return sendJSON(res, 500, { error: 'Orchestrator not loaded' });
      }

      // P1: Auth check - admin only
      // TODO: Add admin role check here

      const count = orchestrator.clearLog();
      sendJSON(res, 200, { cleared: count });
    } catch (err) {
      sendJSON(res, 500, { error: err.message });
    }
  },
};

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
      paramNames.forEach((name, i) => {
        params[name] = decodeURIComponent(match[i + 1]);
      });
      return { handler, params };
    }
  }
  
  return null;
}

// ════════════════════════════════════════════════════════════════════════════
// SERVER
// ════════════════════════════════════════════════════════════════════════════

const server = http.createServer(async (req, res) => {
  // CORS preflight
  if (req.method === 'OPTIONS') {
    res.writeHead(204, {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
    });
    return res.end();
  }
  
  const url = new URL(req.url, `http://${req.headers.host}`);
  const pathname = url.pathname;
  
  logger.debug('Server', `${req.method} ${pathname}`);
  
  const route = matchRoute(req.method, pathname);
  
  if (!route) {
    return sendJSON(res, 404, { error: 'Not found' });
  }
  
  try {
    await route.handler(req, res, route.params);
  } catch (err) {
    logger.error('Server', `Handler error: ${err.message}`);
    sendJSON(res, 500, { error: err.message });
  }
});

// ════════════════════════════════════════════════════════════════════════════
// UI HTML
// ════════════════════════════════════════════════════════════════════════════

function getUIHTML() {
  return `<!DOCTYPE html>
<html lang="cs">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>p(AI)assistant v45.0.0</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      background: #0a0a0f;
      color: #e0e0e0;
      min-height: 100vh;
      display: flex;
      flex-direction: column;
    }
    
    header {
      background: linear-gradient(135deg, #1a1a2e 0%, #16213e 100%);
      padding: 1rem 2rem;
      border-bottom: 1px solid #2a2a4a;
      display: flex;
      justify-content: space-between;
      align-items: center;
    }
    
    .logo {
      font-size: 1.5rem;
      font-weight: 700;
      color: #00d4ff;
    }
    
    .status {
      display: flex;
      gap: 1rem;
      align-items: center;
    }
    
    .status-dot {
      width: 10px;
      height: 10px;
      background: #00ff88;
      border-radius: 50%;
      animation: pulse 2s infinite;
    }
    
    @keyframes pulse {
      0%, 100% { opacity: 1; }
      50% { opacity: 0.5; }
    }
    
    main {
      flex: 1;
      display: flex;
      max-width: 1400px;
      margin: 0 auto;
      width: 100%;
      padding: 1rem;
      gap: 1rem;
    }
    
    .chat-container {
      flex: 2;
      display: flex;
      flex-direction: column;
      background: #12121a;
      border-radius: 12px;
      border: 1px solid #2a2a4a;
      overflow: hidden;
    }
    
    .messages {
      flex: 1;
      overflow-y: auto;
      padding: 1rem;
      display: flex;
      flex-direction: column;
      gap: 1rem;
    }
    
    .message {
      max-width: 85%;
      padding: 0.75rem 1rem;
      border-radius: 12px;
      line-height: 1.5;
    }
    
    .message.user {
      background: #1e3a5f;
      align-self: flex-end;
      border-bottom-right-radius: 4px;
    }
    
    .message.assistant {
      background: #1a1a2e;
      align-self: flex-start;
      border-bottom-left-radius: 4px;
      border: 1px solid #2a2a4a;
    }
    
    .message.system {
      background: #2a1a2e;
      align-self: center;
      font-size: 0.9rem;
      color: #c0a0c0;
    }
    
    .message pre {
      background: #0a0a0f;
      padding: 0.75rem;
      border-radius: 8px;
      overflow-x: auto;
      margin: 0.5rem 0;
      font-size: 0.85rem;
    }
    
    .message code {
      font-family: 'Fira Code', 'Consolas', monospace;
    }
    
    .input-area {
      padding: 1rem;
      border-top: 1px solid #2a2a4a;
      background: #0a0a0f;
    }
    
    .input-row {
      display: flex;
      gap: 0.5rem;
    }
    
    .input-area textarea {
      flex: 1;
      background: #1a1a2e;
      border: 1px solid #2a2a4a;
      border-radius: 8px;
      padding: 0.75rem;
      color: #e0e0e0;
      font-family: inherit;
      font-size: 1rem;
      resize: none;
      min-height: 60px;
    }
    
    .input-area textarea:focus {
      outline: none;
      border-color: #00d4ff;
    }
    
    .input-area button {
      background: linear-gradient(135deg, #00d4ff 0%, #0099cc 100%);
      color: #000;
      border: none;
      border-radius: 8px;
      padding: 0.75rem 1.5rem;
      font-weight: 600;
      cursor: pointer;
      transition: transform 0.1s, opacity 0.1s;
    }
    
    .input-area button:hover {
      opacity: 0.9;
    }
    
    .input-area button:active {
      transform: scale(0.98);
    }
    
    .input-area button:disabled {
      opacity: 0.5;
      cursor: not-allowed;
    }
    
    .sidebar {
      flex: 1;
      max-width: 350px;
      display: flex;
      flex-direction: column;
      gap: 1rem;
    }
    
    .panel {
      background: #12121a;
      border-radius: 12px;
      border: 1px solid #2a2a4a;
      padding: 1rem;
    }
    
    .panel h3 {
      color: #00d4ff;
      font-size: 0.9rem;
      text-transform: uppercase;
      letter-spacing: 0.05em;
      margin-bottom: 0.75rem;
    }
    
    .config-row {
      display: flex;
      flex-direction: column;
      gap: 0.25rem;
      margin-bottom: 0.75rem;
    }
    
    .config-row label {
      font-size: 0.85rem;
      color: #888;
    }
    
    .config-row input {
      background: #1a1a2e;
      border: 1px solid #2a2a4a;
      border-radius: 6px;
      padding: 0.5rem;
      color: #e0e0e0;
      font-family: monospace;
      font-size: 0.9rem;
    }
    
    .config-row input:focus {
      outline: none;
      border-color: #00d4ff;
    }
    
    .workflow-state {
      display: inline-block;
      padding: 0.25rem 0.5rem;
      border-radius: 4px;
      font-size: 0.8rem;
      font-weight: 600;
    }
    
    .workflow-state.INIT { background: #333; }
    .workflow-state.ANALYZING { background: #1e3a5f; }
    .workflow-state.ASK_USER { background: #5f3a1e; color: #ffa500; }
    .workflow-state.AUTO_ANSWER { background: #3a5f1e; }
    .workflow-state.PLANNING { background: #3a1e5f; }
    .workflow-state.IMPLEMENTING { background: #1e5f3a; }
    .workflow-state.DONE { background: #0a3a0a; color: #00ff88; }
    .workflow-state.ERROR { background: #5f1e1e; color: #ff4444; }
    
    .quick-actions {
      display: flex;
      flex-wrap: wrap;
      gap: 0.5rem;
    }
    
    .quick-actions button {
      background: #1a1a2e;
      border: 1px solid #2a2a4a;
      color: #e0e0e0;
      padding: 0.5rem 0.75rem;
      border-radius: 6px;
      cursor: pointer;
      font-size: 0.85rem;
      transition: background 0.1s;
    }
    
    .quick-actions button:hover {
      background: #2a2a4a;
    }
    
    .timing {
      font-family: monospace;
      font-size: 0.85rem;
      color: #888;
    }
    
    .timing span {
      color: #00d4ff;
    }
  </style>
</head>
<body>
  <header>
    <div class="logo">⚡ p(AI)assistant <small style="color:#888">v45.0.0</small></div>
    <div class="status">
      <div class="status-dot"></div>
      <span id="statusText">Ready</span>
    </div>
  </header>
  
  <main>
    <div class="chat-container">
      <div class="messages" id="messages">
        <div class="message system">
          Vítej v p(AI)assistant v45.0.0! Zadej požadavek a já ho implementuji.
        </div>
      </div>
      
      <div class="input-area">
        <div class="input-row">
          <textarea id="input" placeholder="Napiš požadavek nebo odpověz na otázky..." rows="3"></textarea>
          <button id="sendBtn" onclick="send()">Odeslat</button>
        </div>
      </div>
    </div>
    
    <div class="sidebar">
      <div class="panel">
        <h3>⚙️ Konfigurace</h3>
        <div class="config-row">
          <label>Session ID</label>
          <input type="text" id="sessionId" value="session-${Date.now()}">
        </div>
        <div class="config-row">
          <label>Workdir</label>
          <input type="text" id="workdir" value="/tmp/c3-project">
        </div>
      </div>
      
      <div class="panel">
        <h3>📊 Stav workflow</h3>
        <p>Stav: <span class="workflow-state INIT" id="workflowState">INIT</span></p>
        <p>Složitost: <span id="complexity">-</span></p>
        <p class="timing">Čas: <span id="timing">-</span></p>
      </div>
      
      <div class="panel">
        <h3>⚡ Rychlé akce</h3>
        <div class="quick-actions">
          <button onclick="quickSend('OK')">✓ OK</button>
          <button onclick="quickSend('Jiný návrh')">🔄 Jiný návrh</button>
          <button onclick="newSession()">🆕 Nová session</button>
        </div>
      </div>
    </div>
  </main>
  
  <script>
    const API = '';
    let isProcessing = false;
    
    function addMessage(content, role = 'assistant') {
      const messages = document.getElementById('messages');
      const div = document.createElement('div');
      div.className = 'message ' + role;
      
      // Simple markdown-ish rendering
      let html = content
        .replace(/\`\`\`(\\w*)?\\n([\\s\\S]*?)\`\`\`/g, '<pre><code>$2</code></pre>')
        .replace(/\`([^\`]+)\`/g, '<code>$1</code>')
        .replace(/\\*\\*([^*]+)\\*\\*/g, '<strong>$1</strong>')
        .replace(/\\n/g, '<br>');
      
      div.innerHTML = html;
      messages.appendChild(div);
      messages.scrollTop = messages.scrollHeight;
    }
    
    function updateState(state, complexity, timing) {
      const stateEl = document.getElementById('workflowState');
      stateEl.textContent = state;
      stateEl.className = 'workflow-state ' + state;
      
      if (complexity) {
        document.getElementById('complexity').textContent = complexity;
      }
      if (timing) {
        document.getElementById('timing').textContent = timing;
      }
    }
    
    async function send() {
      if (isProcessing) return;
      
      const input = document.getElementById('input');
      const message = input.value.trim();
      if (!message) return;
      
      const sessionId = document.getElementById('sessionId').value;
      const workdir = document.getElementById('workdir').value;
      
      addMessage(message, 'user');
      input.value = '';
      
      isProcessing = true;
      document.getElementById('sendBtn').disabled = true;
      document.getElementById('statusText').textContent = 'Processing...';
      
      try {
        const res = await fetch(API + '/workflow', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ sessionId, message, workdir }),
        });
        
        const data = await res.json();
        
        updateState(
          data.state,
          data.complexity || data.summary?.complexity,
          data.summary?.totalTime
        );
        
        // Format response based on state
        let response = '';
        
        if (data.error) {
          response = '❌ Chyba: ' + data.error;
        } else if (data.state === 'AUTO_ANSWER' && data.auto_answers) {
          response = '📋 **Předpoklady** (potvrdíte "OK" nebo upravíte):\\n\\n';
          data.auto_answers.forEach(a => {
            response += '• ' + a.text + '\\n  → ' + a.answer + '\\n\\n';
          });
        } else if (data.state === 'ASK_USER' && data.questions_for_user) {
          response = '❓ **Potřebuji upřesnění:**\\n\\n';
          data.questions_for_user.forEach((q, i) => {
            response += (i+1) + '. ' + q.text + '\\n';
            if (q.suggested_answer) {
              response += '   (návrh: ' + q.suggested_answer + ')\\n';
            }
            response += '\\n';
          });
        } else if (data.state === 'PLAN_REVIEW' && data.plan) {
          response = data.plan + '\\n\\n*Potvrďte "OK" pro implementaci nebo napište připomínky.*';
        } else if (data.state === 'DONE') {
          response = '✅ **Hotovo!**\\n\\nVytvořené soubory:\\n';
          (data.files || []).forEach(f => {
            response += '• \`' + f + '\`\\n';
          });
          if (data.summary) {
            response += '\\nČas: ' + data.summary.totalTime;
          }
        } else {
          response = JSON.stringify(data, null, 2);
        }
        
        addMessage(response);
        
      } catch (err) {
        addMessage('❌ Chyba: ' + err.message, 'system');
      } finally {
        isProcessing = false;
        document.getElementById('sendBtn').disabled = false;
        document.getElementById('statusText').textContent = 'Ready';
      }
    }
    
    function quickSend(text) {
      document.getElementById('input').value = text;
      send();
    }
    
    function newSession() {
      document.getElementById('sessionId').value = 'session-' + Date.now();
      document.getElementById('messages').innerHTML = '<div class="message system">Nová session vytvořena.</div>';
      updateState('INIT', '-', '-');
    }
    
    // Enter to send
    document.getElementById('input').addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        send();
      }
    });
  </script>
</body>
</html>`;
}

// ════════════════════════════════════════════════════════════════════════════
// START
// ════════════════════════════════════════════════════════════════════════════

server.listen(config.server.port, config.server.host, () => {
  // Start agent scheduler
  agentScheduler.start();
  
  console.log(`
╔══════════════════════════════════════════════════════════════╗
║                                                              ║
║     ⚡  p(AI)assistant v45.0.0                               ║
║                                                              ║
║     Chat:      http://${config.server.host}:${config.server.port}/architect             ║
║     Agents:    http://${config.server.host}:${config.server.port}/agents                ║
║     API:       http://${config.server.host}:${config.server.port}                       ║
║                                                              ║
╚══════════════════════════════════════════════════════════════╝
  `);
});

// Graceful shutdown
process.on('SIGINT', () => {
  logger.info('Server', 'Shutting down...');
  db.close();
  process.exit(0);
});

process.on('SIGTERM', () => {
  logger.info('Server', 'Shutting down...');
  db.close();
  process.exit(0);
});

export default server;
