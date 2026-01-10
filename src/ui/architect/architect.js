/**
 * C.3 Architect Mode UI
 * Inspired by Open WebUI patterns
 * ══════════════════════════════════════════════════════════════════════════
 */

// ═══════════════════════════════════════════════════════════════════════════
// Configuration
// ═══════════════════════════════════════════════════════════════════════════

const API_BASE = window.location.origin;
const CONFIDENCE_THRESHOLD = 0.7;

// ═══════════════════════════════════════════════════════════════════════════
// State
// ═══════════════════════════════════════════════════════════════════════════

let state = {
  projectRoot: null,
  projectName: null,
  initialized: false,
  mode: 'architect',
  current: null,
  confidence: 0,
  blocks: [],
  stats: { total: 0, done: 0, wip: 0 },
  blocker: null,
  messages: [],
  isLoading: false,
};

// ═══════════════════════════════════════════════════════════════════════════
// DOM Elements
// ═══════════════════════════════════════════════════════════════════════════

const $ = (id) => document.getElementById(id);

const elements = {
  projectName: $('project-name'),
  blocksDone: $('blocks-done'),
  blocksTotal: $('blocks-total'),
  progressPercent: $('progress-percent'),
  blockList: $('block-list'),
  currentBlockPath: $('current-block-path'),
  currentBlockStatus: $('current-block-status'),
  confidenceFill: $('confidence-fill'),
  confidenceValue: $('confidence-value'),
  modeBadge: $('mode-badge'),
  messagesContainer: $('messages-container'),
  emptyState: $('empty-state'),
  messageInput: $('message-input'),
  sendButton: $('send-button'),
  btnGenerate: $('btn-generate'),
  definitionContent: $('definition-content'),
  blockerAlert: $('blocker-alert'),
  blockerDescription: $('blocker-description'),
  loadingOverlay: $('loading-overlay'),
  toastContainer: $('toast-container'),
};

// ═══════════════════════════════════════════════════════════════════════════
// API Calls
// ═══════════════════════════════════════════════════════════════════════════

async function api(method, endpoint, data = null) {
  const options = {
    method,
    headers: { 'Content-Type': 'application/json' },
  };
  
  if (data) {
    options.body = JSON.stringify(data);
  }
  
  try {
    const response = await fetch(`${API_BASE}${endpoint}`, options);
    const result = await response.json();
    
    if (!response.ok) {
      throw new Error(result.error || `HTTP ${response.status}`);
    }
    
    return result;
  } catch (err) {
    console.error(`API Error [${method} ${endpoint}]:`, err);
    throw err;
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// Project Management
// ═══════════════════════════════════════════════════════════════════════════

async function initProject() {
  const projectRoot = prompt('Cesta k projektu:', '/home/user/my-project');
  if (!projectRoot) return;
  
  const projectName = prompt('Název projektu:', projectRoot.split('/').pop());
  if (!projectName) return;
  
  showLoading(true);
  
  try {
    const result = await api('POST', '/architect/init', { projectRoot, projectName });
    
    state.projectRoot = projectRoot;
    state.projectName = projectName;
    state.initialized = true;
    
    toast('Projekt inicializován', 'success');
    await loadStatus();
    
  } catch (err) {
    toast(`Chyba: ${err.message}`, 'error');
  } finally {
    showLoading(false);
  }
}

async function loadStatus() {
  if (!state.projectRoot) return;
  
  try {
    const result = await api('GET', `/architect/status/${encodeURIComponent(state.projectRoot)}`);
    
    state.mode = result.mode || 'architect';
    state.current = result.current;
    state.confidence = result.confidence || 0;
    state.blocks = result.blocks || [];
    state.stats = result.stats || { total: 0, done: 0, wip: 0 };
    state.blocker = result.blocker;
    state.projectName = result.project || state.projectName;
    
    updateUI();
    
  } catch (err) {
    console.error('Load status error:', err);
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// Messaging
// ═══════════════════════════════════════════════════════════════════════════

async function sendMessage(message = null) {
  const text = message || elements.messageInput.value.trim();
  if (!text || state.isLoading) return;
  
  if (!state.projectRoot) {
    toast('Nejdříve inicializuj projekt', 'warning');
    return;
  }
  
  // Add user message to UI
  addMessage('user', text);
  elements.messageInput.value = '';
  
  // Show typing indicator
  const typingId = addTypingIndicator();
  state.isLoading = true;
  updateSendButton();
  
  try {
    const result = await api('POST', '/architect/message', {
      projectRoot: state.projectRoot,
      message: text,
    });
    
    // Remove typing indicator
    removeMessage(typingId);
    
    // Add assistant response
    if (result.response) {
      addMessage('assistant', result.response);
    }
    
    // Update state from response
    if (result.confidence !== undefined) {
      state.confidence = result.confidence;
    }
    
    if (result.action) {
      handleAction(result.action);
    }
    
    // Reload status for latest state
    await loadStatus();
    
  } catch (err) {
    removeMessage(typingId);
    addMessage('assistant', `❌ Chyba: ${err.message}`);
    toast(`Chyba: ${err.message}`, 'error');
  } finally {
    state.isLoading = false;
    updateSendButton();
  }
}

function sendQuickAction(action) {
  sendMessage(action);
}

function handleAction(action) {
  switch (action.type) {
    case 'SWITCH':
      toast(`Přepnuto na ${action.path}`, 'success');
      break;
    case 'CODER':
      toast(`Vygenerováno ${action.files?.length || 0} souborů`, 'success');
      break;
    case 'COMPLETE':
      toast(`Blok ${action.path} dokončen`, 'success');
      break;
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// UI Updates
// ═══════════════════════════════════════════════════════════════════════════

function updateUI() {
  // Project info
  elements.projectName.textContent = state.projectName || 'Načítám...';
  elements.blocksDone.textContent = state.stats.done;
  elements.blocksTotal.textContent = state.stats.total;
  
  const percent = state.stats.total > 0 
    ? Math.round((state.stats.done / state.stats.total) * 100) 
    : 0;
  elements.progressPercent.textContent = percent;
  
  // Current block
  if (state.current) {
    elements.currentBlockPath.textContent = state.current.path;
    elements.currentBlockStatus.textContent = state.current.status;
    elements.currentBlockStatus.className = `current-block-status ${state.current.status}`;
  } else {
    elements.currentBlockPath.textContent = 'Žádný blok';
    elements.currentBlockStatus.textContent = '—';
  }
  
  // Confidence
  const confidencePercent = Math.round(state.confidence * 100);
  elements.confidenceValue.textContent = `${confidencePercent}%`;
  elements.confidenceFill.style.width = `${confidencePercent}%`;
  
  // Confidence color
  elements.confidenceFill.classList.remove('high', 'medium', 'low');
  if (state.confidence >= CONFIDENCE_THRESHOLD) {
    elements.confidenceFill.classList.add('high');
  } else if (state.confidence >= 0.5) {
    elements.confidenceFill.classList.add('medium');
  } else {
    elements.confidenceFill.classList.add('low');
  }
  
  // Mode badge
  elements.modeBadge.textContent = state.mode.toUpperCase();
  elements.modeBadge.className = `mode-badge ${state.mode}`;
  
  // Generate button
  elements.btnGenerate.disabled = state.confidence < CONFIDENCE_THRESHOLD;
  
  // Blocker
  if (state.blocker) {
    elements.blockerAlert.classList.remove('hidden');
    elements.blockerDescription.textContent = state.blocker.description;
  } else {
    elements.blockerAlert.classList.add('hidden');
  }
  
  // Render blocks
  renderBlocks();
  
  // Hide empty state if we have messages
  if (state.messages.length > 0) {
    elements.emptyState.classList.add('hidden');
  }
}

function renderBlocks() {
  if (!state.blocks || state.blocks.length === 0) {
    elements.blockList.innerHTML = `
      <li style="padding: 16px; color: var(--text-muted); text-align: center;">
        Žádné bloky
      </li>
    `;
    return;
  }
  
  const html = state.blocks.map(block => {
    const isActive = state.current?.path === block.id;
    const isDone = block.done;
    
    return `
      <li class="block-item ${isActive ? 'active' : ''} ${isDone ? 'done' : ''}"
          onclick="switchBlock('${block.id}')">
        <span class="checkbox"></span>
        <span class="block-name">${block.name || block.id}</span>
        ${!isDone && block.confidence ? `
          <span class="block-confidence">${Math.round(block.confidence * 100)}%</span>
        ` : ''}
      </li>
      ${block.children?.length > 0 ? `
        <ul class="subblock-list">
          ${block.children.map(sub => `
            <li class="subblock-item" onclick="switchBlock('${sub.id}')">
              ${sub.name || sub.id}
            </li>
          `).join('')}
        </ul>
      ` : ''}
    `;
  }).join('');
  
  elements.blockList.innerHTML = html;
}

function switchBlock(blockId) {
  sendMessage(`přejdi na ${blockId}`);
}

// ═══════════════════════════════════════════════════════════════════════════
// Messages
// ═══════════════════════════════════════════════════════════════════════════

let messageIdCounter = 0;

function addMessage(role, content) {
  const id = `msg-${++messageIdCounter}`;
  const message = { id, role, content, timestamp: new Date() };
  state.messages.push(message);
  
  const html = renderMessage(message);
  elements.messagesContainer.insertAdjacentHTML('beforeend', html);
  
  // Scroll to bottom
  elements.messagesContainer.scrollTop = elements.messagesContainer.scrollHeight;
  
  // Hide empty state
  elements.emptyState.classList.add('hidden');
  
  return id;
}

function renderMessage(message) {
  const avatar = message.role === 'user' ? '👤' : '🏗️';
  const contentHtml = renderMarkdown(message.content);
  const time = message.timestamp.toLocaleTimeString('cs-CZ', { hour: '2-digit', minute: '2-digit' });
  
  return `
    <div class="message ${message.role}" id="${message.id}">
      <div class="message-avatar">${avatar}</div>
      <div class="message-content">
        <div class="message-text">${contentHtml}</div>
        <div class="message-meta">${time}</div>
      </div>
    </div>
  `;
}

function addTypingIndicator() {
  const id = `typing-${++messageIdCounter}`;
  
  const html = `
    <div class="message assistant" id="${id}">
      <div class="message-avatar">🏗️</div>
      <div class="message-content">
        <div class="typing-indicator">
          <span></span><span></span><span></span>
        </div>
      </div>
    </div>
  `;
  
  elements.messagesContainer.insertAdjacentHTML('beforeend', html);
  elements.messagesContainer.scrollTop = elements.messagesContainer.scrollHeight;
  
  return id;
}

function removeMessage(id) {
  const el = document.getElementById(id);
  if (el) el.remove();
}

function renderMarkdown(text) {
  if (!text) return '';
  
  // Configure marked
  marked.setOptions({
    highlight: function(code, lang) {
      if (lang && hljs.getLanguage(lang)) {
        return hljs.highlight(code, { language: lang }).value;
      }
      return hljs.highlightAuto(code).value;
    },
    breaks: true,
  });
  
  return marked.parse(text);
}

// ═══════════════════════════════════════════════════════════════════════════
// Tabs
// ═══════════════════════════════════════════════════════════════════════════

function switchTab(tabName) {
  // Update tab buttons
  document.querySelectorAll('.panel-tab').forEach(tab => {
    tab.classList.toggle('active', tab.dataset.tab === tabName);
  });
  
  // Update tab content
  document.querySelectorAll('.tab-content').forEach(content => {
    content.classList.toggle('hidden', content.id !== `tab-${tabName}`);
  });
}

// ═══════════════════════════════════════════════════════════════════════════
// Utilities
// ═══════════════════════════════════════════════════════════════════════════

function showLoading(show) {
  elements.loadingOverlay.classList.toggle('hidden', !show);
}

function updateSendButton() {
  elements.sendButton.disabled = state.isLoading;
}

function toast(message, type = 'info') {
  const id = `toast-${Date.now()}`;
  
  const html = `
    <div class="toast ${type}" id="${id}">
      <span>${getToastIcon(type)}</span>
      <span>${message}</span>
    </div>
  `;
  
  elements.toastContainer.insertAdjacentHTML('beforeend', html);
  
  // Auto remove after 4 seconds
  setTimeout(() => {
    const el = document.getElementById(id);
    if (el) {
      el.style.animation = 'slideIn 0.3s ease reverse';
      setTimeout(() => el.remove(), 300);
    }
  }, 4000);
}

function getToastIcon(type) {
  switch (type) {
    case 'success': return '✅';
    case 'error': return '❌';
    case 'warning': return '⚠️';
    default: return 'ℹ️';
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// Event Listeners
// ═══════════════════════════════════════════════════════════════════════════

function initEventListeners() {
  // Message input - Enter to send
  elements.messageInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  });
  
  // Auto-resize textarea
  elements.messageInput.addEventListener('input', () => {
    const el = elements.messageInput;
    el.style.height = 'auto';
    el.style.height = Math.min(el.scrollHeight, 200) + 'px';
  });
  
  // Keyboard shortcuts
  document.addEventListener('keydown', (e) => {
    // Ctrl/Cmd + K - focus input
    if ((e.ctrlKey || e.metaKey) && e.key === 'k') {
      e.preventDefault();
      elements.messageInput.focus();
    }
    
    // Escape - clear input
    if (e.key === 'Escape') {
      elements.messageInput.value = '';
      elements.messageInput.blur();
    }
  });
}

// ═══════════════════════════════════════════════════════════════════════════
// Initialization
// ═══════════════════════════════════════════════════════════════════════════

async function init() {
  console.log('C.3 Architect Mode UI initialized');
  
  initEventListeners();
  
  // Check URL for project root
  const params = new URLSearchParams(window.location.search);
  const projectRoot = params.get('project');
  
  if (projectRoot) {
    state.projectRoot = projectRoot;
    await loadStatus();
  }
  
  // Add welcome message
  addMessage('assistant', 
    '👋 Vítej v **Architect Mode**!\n\n' +
    'Tento mód je určen pro komplexní projekty, kde je důležité:\n' +
    '- Definovat před kódováním\n' +
    '- Pracovat po blocích\n' +
    '- Držet kontext a rozhodnutí\n\n' +
    'Začni inicializací projektu nebo vyber existující blok ze sidebaru.'
  );
}

// Start
document.addEventListener('DOMContentLoaded', init);
