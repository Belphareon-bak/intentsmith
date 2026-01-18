// C.3 v33.2 Server - p(AI)assistant
// ══════════════════════════════════════════════════════════════════════════════

import http from 'http';
import fs from 'fs';
import path from 'path';
import { config } from './config.js';
import { logger } from './core/logger.js';
import { workflowEngine } from './workflow/engine.js';
import db from './db/database.js';

// Agent Platform v33
import { AgentRepository, initAgentTables } from './agents/repository.js';
import { AgentScheduler } from './agents/scheduler.js';
import { AgentRunner } from './agents/runner.js';
import { createAgentRoutes } from './agents/api.js';
import { LLMServices } from './agents/llm-services.js';

// Initialize Agent tables
initAgentTables(db.db);

// Simple LLM client wrapper for agents
const agentLLMClient = {
  async chat({ model, messages, format }) {
    const systemMsg = messages.find(m => m.role === 'system');
    const userMsg = messages.find(m => m.role === 'user');
    
    const body = {
      model: model || 'qwen2.5:32b',
      messages,
      stream: false,
      format: format === 'json' ? 'json' : undefined,
      options: { temperature: 0.3 }
    };
    
    try {
      const response = await fetch(`${config.llm?.baseUrl || 'http://localhost:11434'}/api/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
      });
      const data = await response.json();
      return { content: data.message?.content || '' };
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
    const fs = await import('fs/promises');
    const path = await import('path');
    const fullPath = path.join(process.cwd(), filepath);
    const content = await fs.readFile(fullPath, 'utf-8');
    res.writeHead(200, {
      'Content-Type': contentType + '; charset=utf-8',
      'Access-Control-Allow-Origin': '*',
      'Cache-Control': 'no-cache',
    });
    res.end(content);
  } catch (err) {
    res.writeHead(404, { 'Content-Type': 'text/plain' });
    res.end('File not found');
  }
}

async function getArchitectUIHTML() {
  try {
    const fs = await import('fs/promises');
    const path = await import('path');
    const htmlPath = path.join(process.cwd(), 'src/ui/architect/architect.html');
    return await fs.readFile(htmlPath, 'utf-8');
  } catch {
    return `<!DOCTYPE html>
<html>
<head><title>C.3 Architect</title></head>
<body style="background: #0f0f0f; color: white; font-family: sans-serif; padding: 40px;">
<h1>🏗️ Architect Mode</h1>
<p>UI files not found. Make sure src/ui/architect/ exists.</p>
</body>
</html>`;
  }
}

// ════════════════════════════════════════════════════════════════════════════
// INTENT CLASSIFICATION HELPERS
// ════════════════════════════════════════════════════════════════════════════

/**
 * Detect file type from message and intent
 */
function detectFileTypeFromIntent(message, intent) {
  // Check explicit file type mentions
  if (/\bpdf\b/i.test(message)) return 'pdf';
  if (/\b(xlsx|excel|spreadsheet)\b/i.test(message)) return 'xlsx';
  if (/\bcsv\b/i.test(message)) return 'csv';
  if (/\b(docx|word)\b/i.test(message)) return 'docx';
  if (/\bjson\b/i.test(message)) return 'json';
  if (/\b(yaml|yml)\b/i.test(message)) return 'yaml';
  
  // Default based on intent
  const intentDefaults = {
    'FILE_REQUEST': 'pdf',
    'REPORT_REQUEST': 'pdf',
    'TABLE_REQUEST': 'xlsx',
    'CONFIG_REQUEST': 'json'
  };
  
  return intentDefaults[intent] || 'pdf';
}

/**
 * Extract topic/subject from message
 */
function extractTopicFromMessage(message) {
  return message
    .replace(/vygeneruj\s+(mi\s+)?/gi, '')
    .replace(/vytvoř\s+(mi\s+)?/gi, '')
    .replace(/připrav\s+(mi\s+)?/gi, '')
    .replace(/exportuj\s+(jako\s+)?/gi, '')
    .replace(/udělej\s+(mi\s+)?/gi, '')
    .replace(/chci\s+(to\s+)?/gi, '')
    .replace(/\b(pdf|xlsx|excel|csv|docx|word|dokument|tabulku?|soubor|report|přehled)\b/gi, '')
    .replace(/\s+(s|kde|který|která|které|obsahující|ke\s+stažení)\s+/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

// ════════════════════════════════════════════════════════════════════════════
// API ROUTES
// ════════════════════════════════════════════════════════════════════════════

const routes = {
  // Health check
  'GET /': (req, res) => {
    sendJSON(res, 200, {
      name: 'p(AI)assistant',
      version: '34.3.2',
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
        'GET /agents - Agent Platform UI',
        'GET /api/agents - List all agents',
        'POST /api/agents - Create agent',
        'POST /api/agents/build - Build agent from description',
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
  // ══════════════════════════════════════════════════════════════════════════
  
  'POST /chat': async (req, res) => {
    const body = await parseBody(req);
    const { message } = body;
    
    if (!message) {
      return sendJSON(res, 400, { error: 'message is required' });
    }
    
    try {
      const { callOllama } = await import('./llm/client.js');
      const { PROMPTS } = await import('./llm/prompts.js');
      
      const response = await callOllama('CHAT', message, PROMPTS.CHAT);
      
      sendJSON(res, 200, {
        response: response.content,
        model: response.model,
        duration: response.duration,
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
  'POST /api/chat': async (req, res) => {
    const body = await parseBody(req);
    const { conversation_id, project_id, message } = body;
    
    if (!conversation_id || !message) {
      return sendJSON(res, 400, { error: 'conversation_id and message are required' });
    }
    
    try {
      // Save user message
      db.messages.addMessage(conversation_id, 'user', message);
      
      // v34.3.2: SEMANTIC INTENT CLASSIFIER - check FIRST before any chat logic
      const artifactPipeline = await import('./artifact-pipeline.js');
      const { callOllama } = await import('./llm/client.js');
      
      // LLM call function for classifier and pipeline
      const llmCall = async (prompt, systemPrompt, options) => {
        return callOllama('CHAT', prompt, systemPrompt, options);
      };
      
      // Use async semantic classifier (hybrid: heuristic + LLM)
      const intentResult = await artifactPipeline.classifyIntent(message, llmCall);
      logger.info('Server', `Intent classified: ${intentResult.intent} (${intentResult.confidence.toFixed(2)}, ${intentResult.method}${intentResult.cached ? ', cached' : ''})`);
      
      // Map intent to task type
      const isArtifact = intentResult.intent !== artifactPipeline.INTENT.CHAT;
      
      if (isArtifact) {
        const task = {
          type: 'ARTIFACT',
          intent: intentResult.intent,
          artifactType: detectFileTypeFromIntent(message, intentResult.intent),
          topic: extractTopicFromMessage(message),
          confidence: intentResult.confidence
        };
        
        logger.info('Server', `Artifact request: ${task.artifactType} - ${task.topic}`);
        
        // Load user settings for locale
        let userSettings = {};
        try {
          const settingsRow = db.db.prepare('SELECT data FROM user_settings WHERE id = 1').get();
          if (settingsRow) {
            userSettings = JSON.parse(settingsRow.data);
          }
        } catch (e) {
          logger.warn('Server', 'Could not load user settings, using defaults');
        }
        
        // Execute artifact pipeline
        const result = await artifactPipeline.executeArtifactPipeline(
          message,
          userSettings,
          llmCall
        );
        
        if (result.success) {
          // Build response with download link
          const artifact = result.artifact;
          const downloadUrl = artifact.downloadUrl;
          const confidence = result.metadata?.confidence || 'unknown';
          
          // Confidence indicator
          const confidenceText = {
            high: '✅ Ověřená data',
            medium: '⚡ Odhadovaná data',
            low: '⚠️ Orientační data',
            unknown: '❓ Neověřeno'
          }[confidence] || '❓ Neověřeno';
          
          // Determine display type (actual type, not requested)
          const displayType = artifact.actualType?.toUpperCase() || artifact.type?.toUpperCase() || 'PDF';
          
          let response = `✅ **Soubor vygenerován**

📄 **${artifact.title}**

${result.data.description || ''}

| Sloupec | Ukázka |
|---------|--------|
${result.data.columns?.slice(0, 4).map(col => `| ${col} | ${result.data.data[0]?.[col] || '-'} |`).join('\n')}

📊 **Celkem řádků:** ${result.data.data.length}
🎯 **Kvalita dat:** ${confidenceText}

---

⬇️ **[Stáhnout ${displayType}: ${artifact.title}](${downloadUrl})**`;

          // Add HTML fallback warning
          if (result.htmlFallback || artifact.htmlFallback) {
            response += `\n\n💡 **Tip:** Pro skutečné PDF nainstalujte puppeteer: \`npm install puppeteer\``;
          }

          // Add warning if partial/fallback
          if (result.warning) {
            response += `\n\n⚠️ **Upozornění:** ${result.warning}`;
          }
          
          // Add notes
          if (result.data.notes?.length) {
            response += '\n\n📝 **Poznámky:**\n' + result.data.notes.map(n => `- ${n}`).join('\n');
          }

          db.messages.addMessage(conversation_id, 'assistant', response);
          
          return sendJSON(res, 200, { 
            response,
            artifact: {
              type: artifact.actualType || artifact.type,
              requestedType: artifact.requestedType,
              title: artifact.title,
              downloadUrl: artifact.downloadUrl,
              size: artifact.size,
              confidence: confidence,
              canRetry: result.canRetry || false,
              htmlFallback: result.htmlFallback || artifact.htmlFallback || false
            }
          });
        } else {
          // Artifact generation failed - provide helpful error with retry option
          let errorResponse = `❌ **Nepodařilo se vygenerovat soubor**

**Důvod:** ${result.error}`;

          if (result.suggestion) {
            errorResponse += `\n\n💡 **Tip:** ${result.suggestion}`;
          }
          
          errorResponse += `\n\n**Co můžete zkusit:**
- Upřesnit požadavek (např. "RTX 4000 série, nové, CZ e-shopy")
- Zjednodušit dotaz
- Zkusit znovu (model může mít lepší výsledek)`;

          db.messages.addMessage(conversation_id, 'assistant', errorResponse);
          return sendJSON(res, 200, { 
            response: errorResponse,
            canRetry: result.canRetry || true
          });
        }
      }
      
      // Continue with regular chat flow...
      let response;
      
      if (project_id) {
        // Use Architect for project context
        global.architectSessions = global.architectSessions || {};
        let orchestrator = global.architectSessions[project_id];
        
        if (!orchestrator) {
          // Load project
          const project = db.projects.findById.get(project_id);
          if (project) {
            const { ConversationOrchestrator } = await import('./architect/index.js');
            orchestrator = new ConversationOrchestrator(project.path);
            await orchestrator.init(project.name);
            global.architectSessions[project_id] = orchestrator;
          }
        }
        
        if (orchestrator) {
          const result = await orchestrator.process(message);
          response = result.response;
        } else {
          response = 'Project not found. Please create or select a project.';
        }
      } else {
        // Simple chat without project context
        const { callOllama, callOllamaVision } = await import('./llm/client.js');
        const webSearch = await import('./llm/web-search.js');
        
        // Get recent messages for context
        const recentMessages = db.messages.getLastN.all(conversation_id, 10);
        const context = recentMessages.map(m => `${m.role}: ${m.content}`).join('\n\n');
        
        // Check for recent image attachments
        const recentAttachments = db.attachments.listByConversation.all(conversation_id);
        const imageAttachments = recentAttachments.filter(a => 
          a.mime_type?.startsWith('image/') && 
          ['image/jpeg', 'image/png', 'image/gif', 'image/webp'].includes(a.mime_type)
        ).slice(0, 3); // Max 3 images
        
        // If images are present, use vision model
        if (imageAttachments.length > 0) {
          logger.info('Server', `Processing ${imageAttachments.length} image(s) with vision model`);
          
          try {
            // Load images as base64
            const images = [];
            for (const att of imageAttachments) {
              const imgPath = path.join('./data/attachments', att.filename);
              if (fs.existsSync(imgPath)) {
                const imgBuffer = fs.readFileSync(imgPath);
                const base64 = imgBuffer.toString('base64');
                images.push(base64);
              }
            }
            
            if (images.length > 0) {
              const visionPrompt = context 
                ? `Context: ${context}\n\nUser: ${message}`
                : message;
              
              const visionSystemPrompt = `You are a helpful AI assistant that can analyze images.
Describe what you see in detail and answer the user's question about the image(s).
Respond in the same language as the user's message.
Be specific and helpful.`;
              
              const visionResult = await callOllamaVision(visionPrompt, images, visionSystemPrompt);
              response = visionResult.content;
              
              // Save and return
              db.messages.addMessage(conversation_id, 'assistant', response);
              return sendJSON(res, 200, { response });
            }
          } catch (visionErr) {
            logger.warn('Server', `Vision error: ${visionErr.message}`);
            // Fall through to regular chat with error message
            if (visionErr.message.includes('not installed')) {
              response = `⚠️ Vision model není nainstalován.\n\nPro analýzu obrázků spusťte:\n\`\`\`\nollama pull llava:13b\n\`\`\`\n\nPotom restartujte server.`;
              db.messages.addMessage(conversation_id, 'assistant', response);
              return sendJSON(res, 200, { response });
            }
          }
        }
        
        // Check if web search is needed
        let searchContext = '';
        let extractedLinks = [];
        
        if (webSearch.needsWebSearch(message)) {
          logger.info('Server', 'Web search triggered');
          
          // Check if message contains full URL
          const urlMatch = message.match(/https?:\/\/[^\s]+/);
          // Check if message contains domain (e.g. seznam.cz, bazos.cz)
          const domainMatch = message.match(/\b([\w-]+\.(cz|sk|com|org|net|eu|io))\b/i);
          
          if (urlMatch) {
            // Fetch specific URL
            logger.info('Server', `Fetching URL: ${urlMatch[0]}`);
            const page = await webSearch.fetchPage(urlMatch[0], 8000);
            if (page) {
              extractedLinks = page.links || [];
              searchContext = `\n\n[WEB CONTENT]\nSource: ${page.url}\nTitle: ${page.title}\n\n${page.content}`;
              if (extractedLinks.length > 0) {
                searchContext += '\n\n[EXTRACTED LINKS - USE ONLY THESE EXACT URLs]:\n';
                extractedLinks.forEach((link, i) => {
                  searchContext += `${i+1}. ${link.title}\n   URL: ${link.url}\n`;
                });
              }
              searchContext += '\n[END WEB CONTENT]';
              logger.info('Server', `Fetched ${page.content.length} chars, ${extractedLinks.length} links`);
            }
          } else if (domainMatch) {
            const domain = domainMatch[1];
            
            // Extract search terms
            const searchTerms = message
              .toLowerCase()
              .replace(domain, '')
              .replace(/\b(najdi|vyhledej|hledej|dej mi|ukaž|odkaz|na|z|ze|webu?|stránk\w*|seznam|všech?n?y?|zpráv\w*|v\s*současn\w*|chvíl\w*|karty?|všechny)\b/gi, '')
              .replace(/\s+/g, ' ')
              .trim();
            
            // For bazos.cz, construct search URL directly
            if (domain.includes('bazos')) {
              // bazos has specific URL structure for search
              const bazosSearch = searchTerms.replace(/\s+/g, '-').replace(/[^a-z0-9-]/gi, '');
              const searchUrl = `https://pc.bazos.cz/inzeraty/${encodeURIComponent(searchTerms.replace(/\s+/g, '-'))}/`;
              logger.info('Server', `Fetching bazos search: ${searchUrl}`);
              const page = await webSearch.fetchPage(searchUrl, 15000);
              
              if (page && page.links && page.links.length > 0) {
                // Filter only inzerat links
                extractedLinks = page.links.filter(l => l.url.includes('/inzerat/'));
                searchContext = `\n\n[BAZOS.CZ SEARCH RESULTS FOR: ${searchTerms}]\n`;
                searchContext += `Found ${extractedLinks.length} listings:\n\n`;
                extractedLinks.slice(0, 10).forEach((link, i) => {
                  searchContext += `${i+1}. ${link.title}\n   LINK: ${link.url}\n\n`;
                });
                searchContext += '[END RESULTS]\n\nIMPORTANT: Use ONLY the exact URLs listed above. Do NOT modify or invent URLs.';
                logger.info('Server', `Found ${extractedLinks.length} bazos listings`);
              } else {
                // Fallback to homepage
                const homePage = await webSearch.fetchPage(`https://www.${domain}`, 10000);
                if (homePage) {
                  searchContext = `\n\n[WEB CONTENT FROM ${domain}]\n${homePage.content}\n[END]`;
                }
              }
            } else {
              // Other domains - fetch homepage
              const url = `https://www.${domain.replace(/^www\./, '')}`;
              logger.info('Server', `Fetching: ${url}`);
              const page = await webSearch.fetchPage(url, 10000);
              
              if (page) {
                extractedLinks = page.links || [];
                searchContext = `\n\n[WEB CONTENT FROM ${domain.toUpperCase()}]\n${page.content}`;
                if (extractedLinks.length > 0) {
                  searchContext += '\n\n[LINKS FROM THIS PAGE - USE ONLY THESE EXACT URLs]:\n';
                  extractedLinks.slice(0, 15).forEach((link, i) => {
                    searchContext += `${i+1}. ${link.title} - ${link.url}\n`;
                  });
                }
                searchContext += '\n[END WEB CONTENT]';
                logger.info('Server', `Fetched ${page.content.length} chars, ${extractedLinks.length} links`);
              }
            }
            
            // Also do DuckDuckGo search for more results
            if (searchTerms.length > 2) {
              const query = `${searchTerms} site:${domain}`;
              logger.info('Server', `Also searching: ${query}`);
              const searchResults = await webSearch.searchAndFormat(query, true);
              if (searchResults) {
                searchContext += '\n\n[ADDITIONAL SEARCH RESULTS]\n' + searchResults;
              }
            }
          } else {
            // General web search
            const query = webSearch.extractSearchQuery(message);
            logger.info('Server', `Web search: ${query}`);
            searchContext = '\n\n[SEARCH RESULTS]\n' + await webSearch.searchAndFormat(query, true);
          }
        }
        
        // CRITICAL: If query requires external data but we have none → NEDOSTATEK_DAT
        const requiresExternalData = webSearch.needsExternalData(message);
        const hasNoData = !searchContext || searchContext.trim().length < 50;
        
        if (requiresExternalData && hasNoData) {
          logger.warn('Server', 'Query requires external data but none available');
          response = `NEDOSTATEK_DAT

Váš dotaz vyžaduje aktuální data z internetu (odkazy, nabídky, ceny), která se nepodařilo získat.

**Možné příčiny:**
- Cílová stránka blokuje přístup
- Web search nenašel relevantní výsledky
- Problém s připojením

**Doporučení:**
- Zkuste specifikovat konkrétní web (např. "na sauto.cz")
- Nebo vložte přímý odkaz na stránku`;
          
          db.messages.addMessage(conversation_id, 'assistant', response);
          return sendJSON(res, 200, { response });
        }
        
        const prompt = context 
          ? `${context}\n\nUser: ${message}${searchContext}`
          : `User: ${message}${searchContext}`;
        
        // v34.2: Artifact requests are now handled at the beginning of POST /api/chat
        // This code path is only reached for regular chat
        
        // Strict, structured system prompt based on best practices
        let systemPrompt;
        
        if (searchContext) {
          // Web search mode - strict factual with sources
          systemPrompt = `ROLE: You are a Strict Information Assistant.
TASK: Answer using ONLY the provided web content in [brackets].
FORMAT: Use numbered lists, cite sources with exact URLs.

RULES:
- Extract and present specific data (titles, prices, dates, URLs)
- Use Markdown formatting (headers, lists, bold for key info)
- Cite exact URLs from the provided content - NEVER invent URLs
- If data is insufficient, respond exactly: NEDOSTATEK_DAT
- Respond in the same language as the user
- Be thorough but concise - no filler text`;
        } else {
          // General chat mode - helpful but structured
          systemPrompt = `ROLE: You are a helpful AI Assistant.
TASK: Provide clear, structured, actionable answers.
FORMAT: Use Markdown - headers, numbered lists, code blocks where appropriate.

RULES:
- Be specific and thorough - give complete answers
- Use numbered lists for multiple items
- Bold key terms and important information
- For code, always use markdown code blocks with language
- If uncertain, say so honestly
- Respond in the same language as the user
- No vague or lazy responses - provide real value`;
        }
        
        const llmOptions = { 
          temperature: searchContext ? 0.15 : 0.5,
          top_p: 0.75,
          repeat_penalty: 1.1
        };
        
        // First attempt
        let result = await callOllama('CHAT', prompt, systemPrompt, llmOptions);
        response = result.content;
        
        // Validation + retry logic
        const isLazyResponse = response.length < 50 && !response.includes('NEDOSTATEK_DAT');
        const hasInventedUrl = searchContext && /https?:\/\/[^\s]+/.test(response) && 
          !searchContext.includes(response.match(/https?:\/\/[^\s]+/)?.[0]?.split('?')[0]);
        
        if (isLazyResponse || hasInventedUrl) {
          logger.warn('Server', `Response validation failed, retrying with stricter prompt`);
          
          // Stricter retry prompt
          const retrySystemPrompt = `${systemPrompt}

CRITICAL REMINDER:
- Previous response was rejected for being ${isLazyResponse ? 'too brief/vague' : 'containing invented URLs'}
- You MUST provide a complete, structured answer
- If using URLs, copy them EXACTLY from the provided content
- No shortcuts - give a thorough response`;
          
          const retryResult = await callOllama('CHAT', prompt, retrySystemPrompt, {
            ...llmOptions,
            temperature: 0.1  // Even lower for retry
          });
          response = retryResult.content;
        }
      }
      
      // Save assistant message
      db.messages.addMessage(conversation_id, 'assistant', response);
      
      // Update conversation title if first message
      const conv = db.conversations.findById.get(conversation_id);
      if (conv && !conv.title && conv.message_count <= 2) {
        db.conversations.updateTitle.run(message.substring(0, 50), conversation_id);
      }
      
      sendJSON(res, 200, { response });
      
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
      
      res.writeHead(200, {
        'Content-Type': contentType,
        'Content-Disposition': `${disposition}; filename="${params.filename}"`,
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
      
      res.writeHead(200, {
        'Content-Type': attachment.mime_type,
        'Content-Disposition': `inline; filename="${attachment.original_name}"`,
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
      version: '34.3.2',
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
};

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
  <title>p(AI)assistant v33.3.3</title>
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
    <div class="logo">⚡ p(AI)assistant <small style="color:#888">v33.3.3</small></div>
    <div class="status">
      <div class="status-dot"></div>
      <span id="statusText">Ready</span>
    </div>
  </header>
  
  <main>
    <div class="chat-container">
      <div class="messages" id="messages">
        <div class="message system">
          Vítej v p(AI)assistant v33.3.3! Zadej požadavek a já ho implementuji.
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
║     ⚡  p(AI)assistant v33.3.3                               ║
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
