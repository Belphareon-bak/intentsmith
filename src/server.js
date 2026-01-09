// C.3 v28 Server
// ══════════════════════════════════════════════════════════════════════════════

import http from 'http';
import { config } from './config.js';
import { logger } from './core/logger.js';
import { workflowEngine } from './workflow/engine.js';
import db from './db/database.js';

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

// ════════════════════════════════════════════════════════════════════════════
// API ROUTES
// ════════════════════════════════════════════════════════════════════════════

const routes = {
  // Health check
  'GET /': (req, res) => {
    sendJSON(res, 200, {
      name: 'C.3 Agent',
      version: '28.0.0',
      status: 'ok',
      endpoints: [
        'POST /workflow - Start or continue workflow',
        'GET /workflow/:sessionId - Get workflow status',
        'GET /sessions - List active sessions',
        'POST /chat - Simple chat',
        'GET /memory - List global memory',
        'POST /memory - Set memory value',
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
  // UI
  // ══════════════════════════════════════════════════════════════════════════
  
  'GET /ui': async (req, res) => {
    sendHTML(res, getUIHTML());
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
  <title>C.3 Agent v28</title>
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
    <div class="logo">🤖 C.3 Agent <small style="color:#888">v28</small></div>
    <div class="status">
      <div class="status-dot"></div>
      <span id="statusText">Ready</span>
    </div>
  </header>
  
  <main>
    <div class="chat-container">
      <div class="messages" id="messages">
        <div class="message system">
          Vítej v C.3 Agent v28! Zadej požadavek a já ho implementuji.
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
  console.log(`
╔══════════════════════════════════════════════════════════════╗
║                                                              ║
║     🤖  C.3 Agent v28                                        ║
║                                                              ║
║     API:  http://${config.server.host}:${config.server.port}                            ║
║     UI:   http://${config.server.host}:${config.server.port}/ui                         ║
║                                                              ║
║     Adaptivní workflow podle složitosti                      ║
║     SQLite databáze pro persistenci                          ║
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
