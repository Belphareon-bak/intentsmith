/**
 * AI Assistant UI v2
 * Complete rewrite with persistence, projects, chat history
 */

// ═══════════════════════════════════════════════════════════════════════════
// Configuration
// ═══════════════════════════════════════════════════════════════════════════

const API_BASE = window.location.origin;
const DRAFT_SAVE_DELAY = 1000; // ms

// ═══════════════════════════════════════════════════════════════════════════
// State
// ═══════════════════════════════════════════════════════════════════════════

const state = {
  // Current context
  currentProject: null,       // { id, name, path, description }
  currentConversation: null,  // { id, project_id, title }
  currentExpert: null,        // { id, name, domain } (v44.1)

  // v44.2+ - Project working memory
  projectGoal: null,          // Current task/goal string
  activeFile: null,           // Last edited file path
  lastArtifactId: null,       // Last generated artifact

  // Data
  projects: [],
  conversations: [],
  messages: [],
  experts: [],                // Available experts (v44.1)

  // UI state
  isLoading: false,
  inChat: false,
  leftSidebarOpen: true,

  // Draft
  draftTimeout: null,

  // Pending attachments (waiting to be sent with next message)
  pendingAttachments: [],  // [{ id, name, size }]
};

// ═══════════════════════════════════════════════════════════════════════════
// DOM Elements
// ═══════════════════════════════════════════════════════════════════════════

const $ = (id) => document.getElementById(id);

const el = {
  // Sidebar
  leftSidebar: $('left-sidebar'),
  projectsList: $('projects-list'),
  historyList: $('history-list'),
  agentsList: $('agents-list'),
  storageFill: $('storage-fill'),
  storageValue: $('storage-value'),
  
  // Header
  headerTitle: $('header-title'),
  headerBadge: $('header-badge'),
  
  // Chat
  welcomeScreen: $('welcome-screen'),
  messagesArea: $('messages-area'),
  messages: $('messages'),
  chatInputArea: $('chat-input-area'),
  messageInput: $('message-input'),
  chatInput: $('chat-input'),
  sendBtn: $('send-btn'),
  
  // Status
  statusDot: $('status-dot'),
  statusText: $('status-text'),
  projectIndicator: $('project-indicator'),
  projectName: $('project-name'),

  // v44.2+ - Project Mode Banner
  projectModeBanner: $('project-mode-banner'),
  projectModeName: $('project-mode-name'),
  projectModeGoal: $('project-mode-goal'),

  // Toast
  toastContainer: $('toast-container'),
};

// ═══════════════════════════════════════════════════════════════════════════
// API
// ═══════════════════════════════════════════════════════════════════════════

async function api(method, endpoint, data = null) {
  const options = {
    method,
    headers: { 'Content-Type': 'application/json' },
  };
  
  if (data) options.body = JSON.stringify(data);
  
  try {
    const res = await fetch(`${API_BASE}${endpoint}`, options);
    const json = await res.json();
    if (!res.ok) throw new Error(json.error || `HTTP ${res.status}`);
    return json;
  } catch (err) {
    console.error(`API Error [${method} ${endpoint}]:`, err);
    throw err;
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// Data Loading
// ═══════════════════════════════════════════════════════════════════════════

async function loadProjects() {
  try {
    const data = await api('GET', '/api/projects?limit=10');
    state.projects = data.projects || [];
    renderProjects();
  } catch (err) {
    console.error('Failed to load projects:', err);
    state.projects = [];
    renderProjects();
  }
}

// v44.2 - Load experts for expert mode selection
async function loadExperts() {
  try {
    const data = await api('GET', '/api/experts');
    state.experts = data.experts || [];
    renderExpertSelector();
  } catch (err) {
    console.error('Failed to load experts:', err);
    state.experts = [];
  }
}

// v44.2 - Render expert selector dropdown
// v44.7 - Updated to populate both selectors (welcome screen + chat view)
function renderExpertSelector() {
  const selectors = [
    document.getElementById('expert-selector'),
    document.getElementById('chat-expert-selector'),
  ].filter(Boolean);

  if (selectors.length === 0) return;

  const options = state.experts.map(e =>
    `<option value="${e.id}" ${state.currentExpert?.id === e.id ? 'selected' : ''}>
      ${e.icon || '👨‍💻'} ${e.name}
    </option>`
  ).join('');

  const html = `
    <option value="">🎭 Expert</option>
    ${options}
  `;

  selectors.forEach(selector => {
    selector.innerHTML = html;
  });
}

// v44.2 - Handle expert selection change
function onExpertChange(selectElement) {
  const expertId = selectElement.value;

  if (!expertId) {
    clearExpert();
    toast('Přepnuto na obecný chat', 'info');
    return;
  }

  const expert = state.experts.find(e => e.id === expertId);
  if (expert) {
    selectExpert(expert);
  }
}

async function loadConversations() {
  try {
    const data = await api('GET', '/api/conversations?limit=10');
    state.conversations = data.conversations || [];
    renderHistory();
  } catch (err) {
    console.error('Failed to load conversations:', err);
    state.conversations = [];
    renderHistory();
  }
}

async function loadMessages(conversationId) {
  try {
    const data = await api('GET', `/api/conversations/${conversationId}/messages`);
    state.messages = data.messages || [];
    renderMessages();
  } catch (err) {
    console.error('Failed to load messages:', err);
    state.messages = [];
  }
}

async function loadStorageInfo() {
  try {
    const data = await api('GET', '/api/storage/info');
    const usedMB = (data.totalSize || 0) / (1024 * 1024);
    const percent = Math.min(100, (usedMB / 100) * 100); // 100MB limit
    
    el.storageFill.style.width = `${percent}%`;
    el.storageFill.className = 'storage-fill' + 
      (percent > 80 ? ' danger' : percent > 60 ? ' warning' : '');
    el.storageValue.textContent = `${usedMB.toFixed(1)} MB`;
  } catch (err) {
    el.storageValue.textContent = '— MB';
  }
}

async function refreshData() {
  await Promise.all([
    loadProjects(),
    loadConversations(),
    loadStorageInfo(),
  ]);
  toast('Data refreshed', 'info');
}

// ═══════════════════════════════════════════════════════════════════════════
// Projects
// ═══════════════════════════════════════════════════════════════════════════

function renderProjects(showAll = false) {
  if (state.projects.length === 0) {
    el.projectsList.innerHTML = '<div class="section-item muted">No projects yet</div>';
    return;
  }
  
  const displayProjects = showAll ? state.projects : state.projects.slice(0, 5);
  const hasMore = state.projects.length > 5 && !showAll;
  
  el.projectsList.innerHTML = displayProjects.map(p => `
    <button class="section-item ${state.currentProject?.id === p.id ? 'active' : ''}"
            onclick="openProject(${p.id})">
      <span class="section-item-icon">📁</span>
      <span>${escapeHtml(p.name)}</span>
    </button>
  `).join('') + (hasMore ? `
    <button class="section-item show-more" onclick="renderProjects(true)">
      <span class="section-item-icon">...</span>
      <span>Show all (${state.projects.length})</span>
    </button>
  ` : '');
}

async function newProject() {
  // Show modal dialog instead of prompt()
  const name = await showInputModal('New Project', 'Enter project name:', 'my-project');
  if (!name || !name.trim()) return;
  
  setLoading(true);
  
  try {
    const data = await api('POST', '/api/projects', { name: name.trim() });
    state.currentProject = data.project;
    await loadProjects();
    
    // Create new conversation for project
    await newConversationForProject(data.project.id);
    
    toast(`Project "${name}" created`, 'success');
  } catch (err) {
    toast(`Error: ${err.message}`, 'error');
  } finally {
    setLoading(false);
  }
}

/**
 * Show modal input dialog (replaces prompt())
 */
function showInputModal(title, label, placeholder = '') {
  return new Promise((resolve) => {
    // Create modal HTML
    const modalId = `modal-${Date.now()}`;
    const html = `
      <div class="modal-overlay" id="${modalId}">
        <div class="modal-dialog">
          <div class="modal-header">
            <h3>${escapeHtml(title)}</h3>
            <button class="modal-close" onclick="closeModal('${modalId}', null)">&times;</button>
          </div>
          <div class="modal-body">
            <label>${escapeHtml(label)}</label>
            <input type="text" class="modal-input" id="${modalId}-input" placeholder="${escapeHtml(placeholder)}" autofocus>
          </div>
          <div class="modal-footer">
            <button class="modal-btn secondary" onclick="closeModal('${modalId}', null)">Cancel</button>
            <button class="modal-btn primary" onclick="closeModal('${modalId}', document.getElementById('${modalId}-input').value)">Create</button>
          </div>
        </div>
      </div>
    `;
    
    document.body.insertAdjacentHTML('beforeend', html);
    
    const modal = document.getElementById(modalId);
    const input = document.getElementById(`${modalId}-input`);
    
    // Focus input
    setTimeout(() => input.focus(), 50);
    
    // Handle Enter key
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        closeModal(modalId, input.value);
      } else if (e.key === 'Escape') {
        closeModal(modalId, null);
      }
    });
    
    // Store resolve function
    modal._resolve = resolve;
  });
}

/**
 * Close modal and resolve promise
 */
window.closeModal = function(modalId, value) {
  const modal = document.getElementById(modalId);
  if (modal) {
    modal._resolve(value);
    modal.remove();
  }
};

async function openProject(projectId) {
  setLoading(true);
  
  try {
    const data = await api('GET', `/api/projects/${projectId}`);
    state.currentProject = data.project;
    
    // Load project conversations
    const convData = await api('GET', `/api/projects/${projectId}/conversations?limit=1`);
    
    if (convData.conversations?.length > 0) {
      // Continue last conversation
      await openConversation(convData.conversations[0].id);
    } else {
      // Create new conversation for project
      await newConversationForProject(projectId);
    }
    
    updateUI();
    renderProjects();
  } catch (err) {
    toast(`Error: ${err.message}`, 'error');
  } finally {
    setLoading(false);
  }
}

async function newConversationForProject(projectId) {
  const data = await api('POST', '/api/conversations', { project_id: projectId });
  state.currentConversation = data.conversation;
  state.messages = [];
  
  // Clear and switch to chat
  renderMessages();  // Clear old messages from DOM
  switchToChat();
  
  // Show project welcome as first message
  if (state.currentProject) {
    addMessage('assistant', `📁 **Project: ${state.currentProject.name}**\n\nHow can I help you with this project?`);
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// Conversations
// ═══════════════════════════════════════════════════════════════════════════

function renderHistory(showAll = false) {
  // Filter only non-project conversations
  const nonProjectChats = state.conversations.filter(c => !c.project_id);
  
  if (nonProjectChats.length === 0) {
    el.historyList.innerHTML = '<div class="section-item muted">No conversations yet</div>';
    return;
  }
  
  const displayChats = showAll ? nonProjectChats : nonProjectChats.slice(0, 5);
  const hasMore = nonProjectChats.length > 5 && !showAll;
  
  el.historyList.innerHTML = displayChats.map(c => `
    <div class="section-item-row ${state.currentConversation?.id === c.id ? 'active' : ''}">
      <button class="section-item" onclick="openConversation('${c.id}')">
        <span class="section-item-icon">💬</span>
        <span>${escapeHtml(c.title || 'Untitled chat')}</span>
      </button>
      <button class="section-item-delete" onclick="event.stopPropagation(); deleteConversation('${c.id}')" title="Smazat chat">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <path d="M3 6h18M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a2 2 0 012-2h4a2 2 0 012 2v2"/>
        </svg>
      </button>
    </div>
  `).join('') + (hasMore ? `
    <button class="section-item show-more" onclick="renderHistory(true)">
      <span class="section-item-icon">...</span>
      <span>Show all (${nonProjectChats.length})</span>
    </button>
  ` : '');
}

async function newChat() {
  setLoading(true);

  try {
    const data = await api('POST', '/api/conversations', {});
    state.currentConversation = data.conversation;
    state.currentProject = null;
    state.messages = [];

    // v44.5 - Sync session state from backend (preserves expert if locked)
    if (data.sessionState) {
      if (data.sessionState.expert) {
        state.currentExpert = data.sessionState.expert;
      }
      // Future: other session state can be synced here
    }

    renderMessages();  // Clear old messages from DOM
    switchToChat();
    updateUI();
    await loadConversations();
  } catch (err) {
    toast(`Error: ${err.message}`, 'error');
  } finally {
    setLoading(false);
  }
}

async function openConversation(conversationId) {
  setLoading(true);

  try {
    const data = await api('GET', `/api/conversations/${conversationId}`);
    state.currentConversation = data.conversation;

    // Load project if associated
    if (data.conversation.project_id) {
      const projData = await api('GET', `/api/projects/${data.conversation.project_id}`);
      state.currentProject = projData.project;
    } else {
      state.currentProject = null;
    }

    // v44.5 - Sync expert state from conversation/session
    if (data.sessionState?.expert) {
      state.currentExpert = data.sessionState.expert;
    } else if (data.conversation.expert) {
      // Fallback: expert stored on conversation
      state.currentExpert = data.conversation.expert;
    }

    // Load messages
    await loadMessages(conversationId);

    switchToChat();
    updateUI();
    renderHistory();
    renderProjects();
  } catch (err) {
    toast(`Error: ${err.message}`, 'error');
  } finally {
    setLoading(false);
  }
}

async function deleteConversation(conversationId) {
  if (!confirm('Opravdu smazat tento chat?')) return;
  
  try {
    await api('DELETE', `/api/conversations/${conversationId}`);
    
    // If we deleted current conversation, clear it
    if (state.currentConversation?.id === conversationId) {
      state.currentConversation = null;
      state.messages = [];
      renderMessages();
    }
    
    // Reload conversations
    await loadConversations();
    toast('Chat smazán', 'info');
  } catch (err) {
    toast(`Chyba: ${err.message}`, 'error');
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// Messaging
// ═══════════════════════════════════════════════════════════════════════════

async function sendMessage(text = null) {
  const input = state.inChat ? el.chatInput : el.messageInput;
  const msg = text || input.value.trim();
  if (!msg || state.isLoading) return;

  // v45.0 - Log user action to C3 visibility layer
  if (typeof addC3Action === 'function') {
    addC3Action({
      type: 'info',
      message: `User: ${msg.substring(0, 50)}${msg.length > 50 ? '...' : ''}`,
    });
  }

  input.value = '';
  autoResize(input);
  clearDraft();
  
  // Create conversation if needed
  if (!state.currentConversation) {
    try {
      const data = await api('POST', '/api/conversations', {
        project_id: state.currentProject?.id || null,
      });
      state.currentConversation = data.conversation;
    } catch (err) {
      toast(`Error: ${err.message}`, 'error');
      return;
    }
  }
  
  // Switch to chat view
  if (!state.inChat) {
    switchToChat();
  }
  
  // Build message with attachments
  let fullMessage = msg;
  if (state.pendingAttachments.length > 0) {
    const attachmentText = state.pendingAttachments
      .map(a => `📎 ${a.name}`)
      .join('\n');
    fullMessage = `${attachmentText}\n\n${msg}`;
  }
  
  // Add user message (with attachments shown)
  addMessage('user', fullMessage);
  
  // Clear pending attachments
  clearPendingAttachments();
  
  const typingId = addTyping();
  setLoading(true);
  
  try {
    const res = await api('POST', '/api/chat', {
      conversation_id: state.currentConversation.id,
      project_id: state.currentProject?.id || null,
      message: msg,  // Send original message (attachments already uploaded)
      // v44.1 - Include expert and session context
      expert: state.currentExpert || null,
      project: state.currentProject || null,
      // v45.0 - Include user-provided files from drag & drop
      userContext: typeof c3State !== 'undefined' ? c3State.userProvidedFiles : [],
    });

    removeMessage(typingId);

    // v44.1 - Sync state from server response BEFORE adding message
    // so we can use the updated expert info for the message display
    if (res.state) {
      if (res.state.project !== undefined) {
        state.currentProject = res.state.project;
        updateProjectIndicator();
      }
      if (res.state.expert !== undefined) {
        state.currentExpert = res.state.expert;
        updateExpertIndicator();
      }
    }

    if (res.response) {
      // v44.5 - Include expert info in message
      // Use expert from response metadata, response state, or current state
      const responseExpert = res.metadata?.expert || res.state?.expert || state.currentExpert;

      // v45.0 - Process C3 visibility layer
      if (typeof processC3Response === 'function') {
        processC3Response(res);
      }

      // v44.5 - Check for structured fallback (tool failure with options)
      const structured = res.metadata?.structured;
      if (structured?.type === 'ASK_USER' && structured?.subtype === 'TOOL_FAILURE_RECOVERY') {
        // Render rich fallback UI instead of plain message
        addToolFailureMessage(res.response, structured, { expert: responseExpert });
      } else {
        addMessage('assistant', res.response, { expert: responseExpert });
      }
    }

    // Update conversation title from first message
    if (state.messages.length <= 2 && !state.currentConversation.title) {
      state.currentConversation.title = msg.substring(0, 50);
      await loadConversations();
    }

  } catch (err) {
    removeMessage(typingId);
    addMessage('assistant', `❌ Error: ${err.message}`);
    toast(`Error: ${err.message}`, 'error');
  } finally {
    setLoading(false);
  }
}

function sendFromChat() {
  sendMessage();
}

// ═══════════════════════════════════════════════════════════════════════════
// Messages Rendering
// ═══════════════════════════════════════════════════════════════════════════

let msgCounter = 0;

function renderMessages() {
  el.messages.innerHTML = '';
  msgCounter = 0;

  for (const msg of state.messages) {
    addMessageToDOM(msg.role, msg.content, { expert: msg.expert });
  }

  scrollToBottom();
}

/**
 * Add a message to state and DOM
 * @param {string} role - 'user' or 'assistant'
 * @param {string} content - Message content
 * @param {Object} options - Optional { expert: { id, name, icon } }
 */
function addMessage(role, content, options = {}) {
  const msg = {
    role,
    content,
    created_at: new Date().toISOString(),
    // v44.5 - Include expert info if present
    expert: options.expert || null,
  };
  state.messages.push(msg);
  addMessageToDOM(role, content, options);
  scrollToBottom();
}

/**
 * Add message to DOM
 * v44.5 - Now supports expert display
 */
function addMessageToDOM(role, content, options = {}) {
  const id = `msg-${++msgCounter}`;
  const expert = options.expert;

  // v44.5 - Use expert info if available for assistant messages
  let avatar, roleName, expertClass = '';
  if (role === 'user') {
    avatar = '👤';
    roleName = 'You';
  } else if (expert) {
    // Expert response
    avatar = expert.icon || '👨‍💻';
    roleName = expert.name || 'Expert';
    expertClass = ' expert-message';
  } else {
    // Regular AI response
    avatar = '🤖';
    roleName = 'AI Assistant';
  }

  const html = renderMarkdown(content, role === 'assistant');

  el.messages.insertAdjacentHTML('beforeend', `
    <div class="message ${role}${expertClass}" id="${id}">
      <div class="message-avatar">${avatar}</div>
      <div class="message-body">
        <div class="message-role">${roleName}</div>
        <div class="message-text">${html}</div>
      </div>
    </div>
  `);

  return id;
}

/**
 * v44.5 - Add rich tool failure message with action buttons
 * Shows fallback log and interactive options
 */
function addToolFailureMessage(content, structured, options = {}) {
  const id = `msg-${++msgCounter}`;
  const expert = options.expert;
  const avatar = expert ? (expert.icon || '👨‍💻') : '🤖';
  const roleName = expert ? expert.name : 'AI Assistant';
  const expertClass = expert ? ' expert-message' : '';

  // Build fallback log display
  let fallbackHtml = '';
  if (structured.failedTools?.length > 0) {
    fallbackHtml = '<div class="tool-failure-log">';
    fallbackHtml += '<div class="failure-log-title">Pokus o získání dat:</div>';
    for (const tool of structured.failedTools) {
      const icon = tool.code === 'SOURCE_BLOCKED' ? '⛔' : '❌';
      const toolName = {
        'web.search': 'Vyhledávání',
        'web.scrape': 'Načtení stránky',
        'file.read': 'Čtení souboru',
      }[tool.tool] || tool.tool;
      fallbackHtml += `<div class="failure-log-item">${icon} ${toolName}: ${tool.error}</div>`;
    }
    fallbackHtml += '</div>';
  }

  // Build action buttons
  let actionsHtml = '<div class="tool-failure-actions">';
  for (const opt of (structured.options || [])) {
    if (opt.id === 'cancel') continue; // Skip cancel, always show
    const btnClass = opt.action === 'auto' ? 'btn-primary' : 'btn-secondary';
    actionsHtml += `<button class="failure-action-btn ${btnClass}" onclick="handleToolFailureAction('${opt.id}', '${opt.action}')">${opt.label}</button>`;
  }
  actionsHtml += `<button class="failure-action-btn btn-ghost" onclick="handleToolFailureAction('cancel', 'cancel')">Zrušit</button>`;
  actionsHtml += '</div>';

  // Suggestion tip
  let tipHtml = '';
  if (structured.suggestion) {
    tipHtml = `<div class="tool-failure-tip">💡 <strong>Tip:</strong> ${structured.suggestion}</div>`;
  }

  // Store structured data for action handlers
  state.pendingToolFailure = structured;

  el.messages.insertAdjacentHTML('beforeend', `
    <div class="message assistant tool-failure-message${expertClass}" id="${id}">
      <div class="message-avatar">${avatar}</div>
      <div class="message-body">
        <div class="message-role">${roleName}</div>
        <div class="message-text">
          <div class="tool-failure-header">⚠️ Nepodařilo se zpracovat požadavek</div>
          <div class="tool-failure-query"><strong>Váš dotaz:</strong> ${structured.originalInput || ''}</div>
          ${fallbackHtml}
          ${tipHtml}
          ${actionsHtml}
        </div>
      </div>
    </div>
  `);

  // Store message in state
  state.messages.push({
    role: 'assistant',
    content,
    expert: options.expert || null,
    structured,
    created_at: new Date().toISOString(),
  });

  scrollToBottom();
  return id;
}

/**
 * v44.5 - Handle tool failure action button click
 */
function handleToolFailureAction(actionId, actionType) {
  const structured = state.pendingToolFailure;
  if (!structured) return;

  if (actionType === 'cancel') {
    toast('Operace zrušena', 'info');
    state.pendingToolFailure = null;
    return;
  }

  if (actionType === 'retry') {
    // Retry with original query
    sendMessage(structured.originalInput);
    state.pendingToolFailure = null;
    return;
  }

  if (actionType === 'auto') {
    // Auto action (e.g., try different provider)
    const opt = structured.options?.find(o => o.id === actionId);
    if (opt?.tool === 'web.search') {
      // Send original query with provider hint
      sendMessage(`${structured.originalInput}`);
    }
    state.pendingToolFailure = null;
    return;
  }

  if (actionType === 'prompt') {
    // Show prompt for user input
    const opt = structured.options?.find(o => o.id === actionId);
    const input = state.inChat ? el.chatInput : el.messageInput;
    input.focus();
    input.placeholder = opt?.prompt || 'Zadejte nový dotaz...';
    toast(opt?.prompt || 'Zadejte nový dotaz', 'info');
    state.pendingToolFailure = null;
    return;
  }
}

function addTyping() {
  const id = `typing-${++msgCounter}`;

  // v44.5 - Show expert avatar/name if expert is active
  const expert = state.currentExpert;
  const avatar = expert ? (expert.icon || '👨‍💻') : '🤖';
  const roleName = expert ? expert.name : 'AI Assistant';
  const expertClass = expert ? ' expert-message' : '';

  el.messages.insertAdjacentHTML('beforeend', `
    <div class="message assistant${expertClass}" id="${id}">
      <div class="message-avatar">${avatar}</div>
      <div class="message-body">
        <div class="message-role">${roleName}</div>
        <div class="typing">
          <span></span><span></span><span></span>
        </div>
      </div>
    </div>
  `);

  scrollToBottom();
  return id;
}

function removeMessage(id) {
  const msg = document.getElementById(id);
  if (msg) msg.remove();
}

function scrollToBottom() {
  // Use requestAnimationFrame for smooth scrolling after DOM update
  requestAnimationFrame(() => {
    // Scroll the messages-area container (which has overflow-y: auto),
    // NOT the inner messages div
    if (el.messagesArea) {
      el.messagesArea.scrollTo({
        top: el.messagesArea.scrollHeight,
        behavior: 'smooth'
      });
    }
  });
}

function renderMarkdown(text, isAssistant = false) {
  if (!text) return '';
  
  marked.setOptions({
    highlight: (code, lang) => {
      if (lang && hljs.getLanguage(lang)) {
        return hljs.highlight(code, { language: lang }).value;
      }
      return hljs.highlightAuto(code).value;
    },
    breaks: true,
  });
  
  let html = marked.parse(text);
  
  // For assistant messages, highlight questions
  if (isAssistant) {
    // Wrap sentences ending with ? in a highlight span
    html = html.replace(
      /(<li>|<p>)([^<]*\?)/g, 
      '$1<span class="ai-question">$2</span>'
    );
  }
  
  return html;
}

// ═══════════════════════════════════════════════════════════════════════════
// UI Updates
// ═══════════════════════════════════════════════════════════════════════════

function updateUI() {
  // Header - Project or Expert or Default
  if (state.currentProject) {
    el.headerTitle.textContent = state.currentProject.name;
    el.headerBadge.textContent = 'PROJECT';
    el.projectIndicator.style.display = 'flex';
    el.projectName.textContent = state.currentProject.name;
    // v44.2+ - Show project mode banner
    if (el.projectModeBanner) {
      el.projectModeBanner.style.display = 'flex';
      el.projectModeName.textContent = state.currentProject.name;
      el.projectModeGoal.textContent = state.projectGoal || '';
    }
  } else if (state.currentExpert) {
    // v44.1 - Expert mode display
    el.headerTitle.textContent = state.currentExpert.name;
    el.headerBadge.textContent = 'EXPERT';
    el.projectIndicator.style.display = 'flex';
    el.projectName.textContent = state.currentExpert.name;
    // v44.2+ - Hide project banner when in expert mode
    if (el.projectModeBanner) {
      el.projectModeBanner.style.display = 'none';
    }
  } else if (state.currentConversation) {
    el.headerTitle.textContent = state.currentConversation.title || 'New Chat';
    el.headerBadge.textContent = '';
    el.projectIndicator.style.display = 'none';
    // v44.2+ - Hide project banner
    if (el.projectModeBanner) {
      el.projectModeBanner.style.display = 'none';
    }
  } else {
    el.headerTitle.textContent = 'AI Assistant';
    el.headerBadge.textContent = '';
    el.projectIndicator.style.display = 'none';
    // v44.2+ - Hide project banner
    if (el.projectModeBanner) {
      el.projectModeBanner.style.display = 'none';
    }
  }

  // Status
  el.statusText.textContent = state.isLoading ? 'Processing...' : 'Ready';
  el.statusDot.className = 'status-dot' + (state.isLoading ? ' loading' : '');

  // v44.4 - Expert badge indicator
  const expertBadge = document.getElementById('expert-badge');
  const expertBadgeIcon = document.getElementById('expert-badge-icon');
  const expertBadgeName = document.getElementById('expert-badge-name');
  if (expertBadge) {
    if (state.currentExpert) {
      expertBadge.style.display = 'flex';
      expertBadgeIcon.textContent = state.currentExpert.icon || '👨‍💻';
      expertBadgeName.textContent = state.currentExpert.name;
    } else {
      expertBadge.style.display = 'none';
    }
  }

  // v44.4 - Update expert selector dropdown to match state
  const expertSelector = document.getElementById('expert-selector');
  if (expertSelector && state.currentExpert) {
    expertSelector.value = state.currentExpert.id;
  } else if (expertSelector) {
    expertSelector.value = '';
  }
}

// v44.1 - Project/Expert indicator updates
function updateProjectIndicator() {
  updateUI();
}

function updateExpertIndicator() {
  updateUI();
}

// v44.1 - Select expert
function selectExpert(expert) {
  state.currentExpert = expert;
  updateUI();
  toast(`Expert: ${expert.name}`, 'info');
}

// v44.1 - Clear expert
function clearExpert() {
  state.currentExpert = null;
  updateUI();
}

// v44.4 - Clear expert from UI (badge click)
function clearExpertFromUI() {
  clearExpert();
  toast('Expert zrušen', 'info');
  // Also update selector dropdown
  const selector = document.getElementById('expert-selector');
  if (selector) selector.value = '';
}

function switchToChat() {
  state.inChat = true;
  el.welcomeScreen.classList.add('hidden');
  el.messagesArea.classList.remove('hidden');
  el.chatInputArea.classList.remove('hidden');
  el.chatInput.focus();
}

function switchToWelcome() {
  state.inChat = false;
  state.currentConversation = null;
  state.currentProject = null;
  // v44.5 - DON'T clear expert on welcome - expert persists across chats
  // state.currentExpert = null;  // REMOVED: Expert should persist
  state.messages = [];
  el.welcomeScreen.classList.remove('hidden');
  el.messagesArea.classList.add('hidden');
  el.chatInputArea.classList.add('hidden');
  el.messageInput.focus();
  updateUI();
}

function setLoading(loading) {
  state.isLoading = loading;
  el.sendBtn.disabled = loading;
  updateUI();
}

// v44.2+ - Project Mode Actions
function changeProject() {
  // Open project selection - switch to projects view in sidebar
  state.leftSidebarOpen = true;
  el.leftSidebar.classList.add('open');
  // Switch to projects section
  const projectsSection = document.querySelector('.section[data-section="projects"]');
  if (projectsSection) {
    projectsSection.scrollIntoView({ behavior: 'smooth' });
  }
  toast('Vyberte nový projekt', 'info');
}

function exitProjectMode() {
  state.currentProject = null;
  state.projectGoal = null;
  updateUI();
  addMessage('assistant', '👋 **Projekt ukončen.** Jste zpět v obecném chatu.');
  toast('Projekt ukončen', 'info');
}

// ═══════════════════════════════════════════════════════════════════════════
// Sidebar
// ═══════════════════════════════════════════════════════════════════════════

function toggleLeftSidebar() {
  state.leftSidebarOpen = !state.leftSidebarOpen;
  el.leftSidebar.classList.toggle('collapsed', !state.leftSidebarOpen);
  el.leftSidebar.classList.toggle('open', state.leftSidebarOpen);
}

function toggleSection(sectionId) {
  const header = event.currentTarget;
  const content = header.nextElementSibling;
  
  header.classList.toggle('collapsed');
  content.classList.toggle('collapsed');
}

// ═══════════════════════════════════════════════════════════════════════════
// Draft Persistence
// ═══════════════════════════════════════════════════════════════════════════

function saveDraft() {
  const input = state.inChat ? el.chatInput : el.messageInput;
  const content = input.value.trim();
  
  if (!content) return;
  
  // Debounce
  if (state.draftTimeout) clearTimeout(state.draftTimeout);
  
  state.draftTimeout = setTimeout(async () => {
    try {
      await api('POST', '/api/drafts', {
        conversation_id: state.currentConversation?.id || null,
        project_id: state.currentProject?.id || null,
        content,
      });
    } catch (err) {
      console.error('Failed to save draft:', err);
    }
  }, DRAFT_SAVE_DELAY);
}

async function loadDraft() {
  try {
    const params = new URLSearchParams();
    if (state.currentConversation?.id) params.set('conversation_id', state.currentConversation.id);
    if (state.currentProject?.id) params.set('project_id', state.currentProject.id);
    
    const data = await api('GET', `/api/drafts?${params}`);
    
    if (data.draft?.content) {
      const input = state.inChat ? el.chatInput : el.messageInput;
      input.value = data.draft.content;
      autoResize(input);
    }
  } catch (err) {
    console.error('Failed to load draft:', err);
  }
}

function clearDraft() {
  if (state.draftTimeout) clearTimeout(state.draftTimeout);
  
  api('DELETE', '/api/drafts', {
    conversation_id: state.currentConversation?.id || null,
    project_id: state.currentProject?.id || null,
  }).catch(() => {});
}

// ═══════════════════════════════════════════════════════════════════════════
// Utilities
// ═══════════════════════════════════════════════════════════════════════════

function autoResize(textarea) {
  textarea.style.height = 'auto';
  textarea.style.height = Math.min(textarea.scrollHeight, 200) + 'px';
}

function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

function toast(message, type = 'info') {
  const id = `toast-${Date.now()}`;
  const icons = { success: '✓', error: '✕', warning: '⚠', info: 'ℹ' };
  
  el.toastContainer.insertAdjacentHTML('beforeend', `
    <div class="toast ${type}" id="${id}">
      <span>${icons[type] || 'ℹ'}</span>
      <span>${escapeHtml(message)}</span>
    </div>
  `);
  
  setTimeout(() => {
    const toast = document.getElementById(id);
    if (toast) {
      toast.style.animation = 'slideIn 0.3s ease reverse';
      setTimeout(() => toast.remove(), 300);
    }
  }, 4000);
}

async function attachFile() {
  const input = document.createElement('input');
  input.type = 'file';
  input.multiple = true;
  
  input.onchange = async (e) => {
    const files = e.target.files;
    if (!files.length) return;
    
    for (const file of files) {
      const formData = new FormData();
      formData.append('file', file);
      
      if (state.currentConversation?.id) {
        formData.append('conversation_id', state.currentConversation.id);
      }
      if (state.currentProject?.id) {
        formData.append('project_id', String(state.currentProject.id));
      }
      
      try {
        toast(`Uploading ${file.name}...`, 'info');
        
        const res = await fetch(`${API_BASE}/api/attachments`, {
          method: 'POST',
          body: formData
        });
        
        const data = await res.json();
        
        if (res.ok) {
          // Add to pending attachments (will be included with next message)
          state.pendingAttachments.push({
            id: data.id,
            name: file.name,
            size: data.size
          });
          
          toast(`✓ ${file.name} ready to send`, 'success');
          
          // Show pending attachments indicator
          renderPendingAttachments();
          
          // Refresh storage info
          loadStorageInfo();
        } else {
          toast(`Error: ${data.error}`, 'error');
        }
      } catch (err) {
        toast(`Upload failed: ${err.message}`, 'error');
      }
    }
  };
  
  input.click();
}

/**
 * Render pending attachments indicator above input
 */
function renderPendingAttachments() {
  // Remove old indicator
  const old = document.querySelector('.pending-attachments');
  if (old) old.remove();
  
  if (state.pendingAttachments.length === 0) return;
  
  const container = state.inChat ? el.chatInputArea : el.welcomeScreen.querySelector('.input-wrapper');
  if (!container) return;
  
  const html = `
    <div class="pending-attachments">
      ${state.pendingAttachments.map((att, i) => `
        <div class="pending-attachment">
          <span class="attachment-icon">📎</span>
          <span class="attachment-name">${escapeHtml(att.name)}</span>
          <span class="attachment-size">(${(att.size / 1024).toFixed(1)} KB)</span>
          <button class="attachment-remove" onclick="removePendingAttachment(${i})" title="Remove">×</button>
        </div>
      `).join('')}
    </div>
  `;
  
  container.insertAdjacentHTML('afterbegin', html);
}

/**
 * Remove a pending attachment
 */
window.removePendingAttachment = function(index) {
  state.pendingAttachments.splice(index, 1);
  renderPendingAttachments();
};

// Export deleteConversation for onclick
window.deleteConversation = deleteConversation;

/**
 * Clear all pending attachments
 */
function clearPendingAttachments() {
  state.pendingAttachments = [];
  const indicator = document.querySelector('.pending-attachments');
  if (indicator) indicator.remove();
}

// ═══════════════════════════════════════════════════════════════════════════
// Event Listeners
// ═══════════════════════════════════════════════════════════════════════════

function initEvents() {
  // Enter to send
  el.messageInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  });
  
  el.chatInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      sendFromChat();
    }
  });
  
  // Auto resize
  el.messageInput.addEventListener('input', () => {
    autoResize(el.messageInput);
    saveDraft();
  });
  
  el.chatInput.addEventListener('input', () => {
    autoResize(el.chatInput);
    saveDraft();
  });
  
  // Keyboard shortcuts
  document.addEventListener('keydown', (e) => {
    // Ctrl+K - Focus input
    if ((e.ctrlKey || e.metaKey) && e.key === 'k') {
      e.preventDefault();
      const input = state.inChat ? el.chatInput : el.messageInput;
      input.focus();
    }
    
    // Ctrl+N - New chat
    if ((e.ctrlKey || e.metaKey) && e.key === 'n') {
      e.preventDefault();
      newChat();
    }
    
    // Escape - Back to welcome
    if (e.key === 'Escape' && state.inChat) {
      switchToWelcome();
    }
  });
  
  // Window beforeunload - save draft
  window.addEventListener('beforeunload', () => {
    const input = state.inChat ? el.chatInput : el.messageInput;
    if (input.value.trim()) {
      // Sync save on unload
      navigator.sendBeacon('/api/drafts', JSON.stringify({
        conversation_id: state.currentConversation?.id || null,
        project_id: state.currentProject?.id || null,
        content: input.value.trim(),
      }));
    }
  });
}

// ═══════════════════════════════════════════════════════════════════════════
// RIGHT SIDEBAR - Settings & Memory
// ═══════════════════════════════════════════════════════════════════════════

let rightSidebarOpen = false;
let memoryItems = [];
let appSettings = {
  model: 'qwen2.5:32b',
  temperature: 0.7,
  systemPrompt: '',
  contextWindow: 32768,
  ollamaUrl: 'http://localhost:11434'
};

function toggleRightSidebar() {
  const sidebar = document.getElementById('right-sidebar');
  const backdrop = document.getElementById('sidebar-backdrop');
  
  rightSidebarOpen = !rightSidebarOpen;
  
  if (rightSidebarOpen) {
    sidebar.classList.add('open');
    backdrop.classList.add('visible');
    loadSettings();
    loadMemory();
  } else {
    sidebar.classList.remove('open');
    backdrop.classList.remove('visible');
  }
}

function switchSettingsTab(tabId) {
  // Update tab buttons
  document.querySelectorAll('.settings-tab').forEach(tab => {
    tab.classList.toggle('active', tab.dataset.tab === tabId);
  });
  
  // Update panels
  document.querySelectorAll('.settings-panel').forEach(panel => {
    panel.classList.toggle('active', panel.id === `settings-${tabId}`);
  });
  
  // Load data for tab
  if (tabId === 'memory') loadMemory();
  if (tabId === 'tools') loadTools();
}

function updateTemperature() {
  const slider = document.getElementById('temperature-slider');
  const value = document.getElementById('temperature-value');
  const temp = slider.value / 100;
  value.textContent = temp.toFixed(2);
  appSettings.temperature = temp;
  saveSettings();
}

function updateSettings() {
  appSettings.model = document.getElementById('model-select')?.value || appSettings.model;
  appSettings.systemPrompt = document.getElementById('system-prompt')?.value || '';
  appSettings.contextWindow = parseInt(document.getElementById('context-select')?.value) || 32768;
  appSettings.ollamaUrl = document.getElementById('ollama-url')?.value || 'http://localhost:11434';
  saveModelSettings();
}

function loadModelSettings() {
  // Load from localStorage
  const saved = localStorage.getItem('c3-settings');
  if (saved) {
    try {
      appSettings = { ...appSettings, ...JSON.parse(saved) };
    } catch (e) {}
  }
  
  // Update UI
  const modelSelect = document.getElementById('model-select');
  const tempSlider = document.getElementById('temperature-slider');
  const tempValue = document.getElementById('temperature-value');
  const systemPrompt = document.getElementById('system-prompt');
  const contextSelect = document.getElementById('context-select');
  const ollamaUrl = document.getElementById('ollama-url');
  
  if (modelSelect) modelSelect.value = appSettings.model;
  if (tempSlider) tempSlider.value = appSettings.temperature * 100;
  if (tempValue) tempValue.textContent = appSettings.temperature.toFixed(2);
  if (systemPrompt) systemPrompt.value = appSettings.systemPrompt;
  if (contextSelect) contextSelect.value = appSettings.contextWindow;
  if (ollamaUrl) ollamaUrl.value = appSettings.ollamaUrl;
}

function saveModelSettings() {
  localStorage.setItem('c3-settings', JSON.stringify(appSettings));
}

// Memory functions
async function loadMemory() {
  try {
    const res = await fetch('/api/memory');
    if (res.ok) {
      memoryItems = await res.json();
    } else {
      memoryItems = [];
    }
  } catch (e) {
    memoryItems = [];
  }
  renderMemory();
}

function renderMemory() {
  const list = document.getElementById('memory-list');
  const count = document.getElementById('memory-count');
  
  if (!list) return;
  
  count.textContent = `${memoryItems.length} položek`;
  
  if (memoryItems.length === 0) {
    list.innerHTML = `
      <div class="memory-empty">
        <svg fill="none" stroke="currentColor" viewBox="0 0 24 24" width="48" height="48">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M9 3v2m6-2v2M9 19v2m6-2v2M5 9H3m2 6H3m18-6h-2m2 6h-2M7 19h10a2 2 0 002-2V7a2 2 0 00-2-2H7a2 2 0 00-2 2v10a2 2 0 002 2zM9 9h6v6H9V9z"/>
        </svg>
        <p>Žádné položky v paměti</p>
        <button class="btn btn-sm" onclick="addMemoryItem()">+ Přidat první</button>
      </div>
    `;
    return;
  }
  
  list.innerHTML = memoryItems.map((item, i) => `
    <div class="memory-item" data-index="${i}">
      <div class="memory-item-content">
        <div class="memory-item-key">${escapeHtml(item.key || 'info')}</div>
        <div class="memory-item-value">${escapeHtml(item.value)}</div>
      </div>
      <div class="memory-item-actions">
        <button class="memory-item-btn" onclick="editMemoryItem(${i})" title="Upravit">
          <svg fill="none" stroke="currentColor" viewBox="0 0 24 24" width="14" height="14">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z"/>
          </svg>
        </button>
        <button class="memory-item-btn delete" onclick="deleteMemoryItem(${i})" title="Smazat">
          <svg fill="none" stroke="currentColor" viewBox="0 0 24 24" width="14" height="14">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"/>
          </svg>
        </button>
      </div>
    </div>
  `).join('');
}

function addMemoryItem() {
  const key = prompt('Klíč (např. preference, context, user):');
  if (!key) return;
  
  const value = prompt('Hodnota:');
  if (!value) return;
  
  memoryItems.push({ key, value });
  saveMemory();
  renderMemory();
}

function editMemoryItem(index) {
  const item = memoryItems[index];
  if (!item) return;
  
  const value = prompt('Nová hodnota:', item.value);
  if (value === null) return;
  
  item.value = value;
  saveMemory();
  renderMemory();
}

function deleteMemoryItem(index) {
  if (!confirm('Opravdu smazat tuto položku?')) return;
  memoryItems.splice(index, 1);
  saveMemory();
  renderMemory();
}

async function saveMemory() {
  try {
    await fetch('/api/memory', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(memoryItems)
    });
  } catch (e) {
    console.error('Failed to save memory:', e);
  }
}

function exportMemory() {
  const data = JSON.stringify(memoryItems, null, 2);
  const blob = new Blob([data], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'c3-memory.json';
  a.click();
  URL.revokeObjectURL(url);
}

function importMemory() {
  const input = document.createElement('input');
  input.type = 'file';
  input.accept = '.json';
  input.onchange = async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    
    try {
      const text = await file.text();
      const data = JSON.parse(text);
      if (Array.isArray(data)) {
        memoryItems = data;
        saveMemory();
        renderMemory();
        showToast('Paměť importována', 'success');
      }
    } catch (err) {
      showToast('Chyba importu: ' + err.message, 'error');
    }
  };
  input.click();
}

// Tools functions
async function loadTools() {
  // For now, just show placeholder
  // In future, this will load from /api/tools
}

function toggleToolCategory(category) {
  const items = document.getElementById(`tools-${category}`);
  if (items) {
    items.classList.toggle('collapsed');
  }
}

function refreshTools() {
  showToast('Nástroje obnoveny', 'success');
  loadTools();
}

// ═══════════════════════════════════════════════════════════════════════════
// Initialization
// ═══════════════════════════════════════════════════════════════════════════

async function init() {
  console.log('AI Assistant v2 initializing...');
  
  initEvents();
  
  // Load initial data
  await Promise.all([
    loadProjects(),
    loadConversations(),
    loadStorageInfo(),
    loadExperts(),  // v44.2 - Load experts for expert mode
  ]);
  
  // Check URL params
  const params = new URLSearchParams(window.location.search);
  const projectId = params.get('project');
  const conversationId = params.get('conversation');
  
  if (conversationId) {
    await openConversation(conversationId);
  } else if (projectId) {
    await openProject(parseInt(projectId));
  } else {
    // Load draft for welcome screen
    await loadDraft();
  }
  
  updateUI();
  console.log('AI Assistant ready');
}

document.addEventListener('DOMContentLoaded', init);

// ═══════════════════════════════════════════════════════════════════════════
// v34: RIGHT SIDEBAR SETTINGS MANAGEMENT
// ═══════════════════════════════════════════════════════════════════════════
// ═══════════════════════════════════════════════════════════════════════════
// RIGHT SIDEBAR - p(AI)assistant Settings Management
// Add this to architect.js or include as separate file
// ═══════════════════════════════════════════════════════════════════════════

// Settings state
const settingsState = {
  // User
  user: {
    name: '',
    avatar: null,
    connectedAccounts: [],
    sessionScope: 'personal'
  },
  // Notifications
  notifications: {
    channels: {
      inapp: true,
      email: false,
      telegram: false,
      webhook: false
    },
    emailAddresses: [],
    telegramToken: '',
    telegramChatId: '',
    webhookUrl: '',
    defaultPriority: 'normal',
    quietHours: {
      enabled: false,
      from: '22:00',
      to: '07:00'
    },
    escalation: true
  },
  // Appearance
  appearance: {
    theme: 'dark',
    accentColor: '#6366f1',
    fontFamily: 'system',
    fontSize: 14,
    density: 'comfortable'
  },
  // Memory
  memory: {
    skills: [],
    customPrompt: '',
    saveHistory: true,
    saveContext: true
  },
  // Location
  location: {
    city: 'Praha',
    country: 'CZ',
    timezone: 'Europe/Prague',
    currency: 'CZK',
    units: 'metric',
    language: 'cs'
  },
  // Output
  output: {
    enabledTypes: ['code', 'docs', 'xlsx', 'pdf', 'reports'],
    defaultFormat: 'markdown',
    codeStyle: 'default',
    namingConvention: 'camelCase'
  },
  // System
  system: {
    runtime: 'local',
    modelChat: 'qwen2.5:32b',
    modelCode: 'qwen2.5-coder:32b',
    ollamaUrl: 'http://localhost:11434',
    maxTokens: 32768,
    lockConfig: false
  }
};

// ═══════════════════════════════════════════════════════════════════════════
// ACCORDION
// ═══════════════════════════════════════════════════════════════════════════

function toggleAccordion(sectionId) {
  const section = document.querySelector(`.accordion-section[data-section="${sectionId}"]`);
  if (!section) return;
  
  const isOpen = section.classList.contains('open');
  
  // Optionally close others (single-open mode)
  // document.querySelectorAll('.accordion-section.open').forEach(s => s.classList.remove('open'));
  
  section.classList.toggle('open', !isOpen);
  
  // Save open state
  saveAccordionState();
}

function saveAccordionState() {
  const openSections = Array.from(document.querySelectorAll('.accordion-section.open'))
    .map(s => s.dataset.section);
  localStorage.setItem('paiass_accordion_state', JSON.stringify(openSections));
}

function restoreAccordionState() {
  try {
    const saved = JSON.parse(localStorage.getItem('paiass_accordion_state') || '[]');
    saved.forEach(sectionId => {
      const section = document.querySelector(`.accordion-section[data-section="${sectionId}"]`);
      if (section) section.classList.add('open');
    });
  } catch (e) {
    console.warn('Failed to restore accordion state:', e);
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// SETTINGS PERSISTENCE
// ═══════════════════════════════════════════════════════════════════════════

async function loadSettings() {
  try {
    const res = await fetch('/api/settings');
    if (res.ok) {
      const data = await res.json();
      Object.assign(settingsState, data);
    }
  } catch (e) {
    console.warn('Failed to load settings from server, using defaults');
  }
  
  // Also check localStorage as fallback
  try {
    const local = JSON.parse(localStorage.getItem('paiass_settings') || '{}');
    // Merge local with state (local takes precedence for offline)
    Object.keys(local).forEach(key => {
      if (settingsState[key]) {
        Object.assign(settingsState[key], local[key]);
      }
    });
  } catch (e) {
    console.warn('Failed to load local settings');
  }
  
  applySettings();
  populateSettingsUI();
}

async function saveSettings() {
  // Save to localStorage first (always works)
  localStorage.setItem('paiass_settings', JSON.stringify(settingsState));
  
  // Then try server
  try {
    await fetch('/api/settings', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(settingsState)
    });
  } catch (e) {
    console.warn('Failed to save settings to server:', e);
  }
  
  updateSettingsSummary();
}

function applySettings() {
  // Apply theme
  document.documentElement.setAttribute('data-theme', settingsState.appearance.theme);
  
  // Apply accent color
  document.documentElement.style.setProperty('--accent', settingsState.appearance.accentColor);
  document.documentElement.style.setProperty('--accent-hover', adjustColor(settingsState.appearance.accentColor, 20));
  
  // Apply font size
  document.documentElement.style.setProperty('--font-size-base', settingsState.appearance.fontSize + 'px');
  
  // Apply density
  document.body.classList.toggle('compact', settingsState.appearance.density === 'compact');
}

function populateSettingsUI() {
  // User
  const nameInput = document.getElementById('user-name');
  if (nameInput) nameInput.value = settingsState.user.name || '';
  
  // Notifications
  setCheckbox('notif-inapp', settingsState.notifications.channels.inapp);
  setCheckbox('notif-email', settingsState.notifications.channels.email);
  setCheckbox('notif-telegram', settingsState.notifications.channels.telegram);
  setCheckbox('notif-webhook', settingsState.notifications.channels.webhook);
  
  setValue('notif-email-address', settingsState.notifications.emailAddresses[0] || '');
  setValue('notif-telegram-token', settingsState.notifications.telegramToken);
  setValue('notif-telegram-chat', settingsState.notifications.telegramChatId);
  setValue('notif-webhook-url', settingsState.notifications.webhookUrl);
  
  setCheckbox('quiet-hours-enabled', settingsState.notifications.quietHours.enabled);
  setValue('quiet-from', settingsState.notifications.quietHours.from);
  setValue('quiet-to', settingsState.notifications.quietHours.to);
  // Note: defaultPriority and escalation removed from sidebar - now per-agent settings
  
  // Appearance
  document.querySelectorAll('.theme-btn').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.theme === settingsState.appearance.theme);
  });
  document.querySelectorAll('.color-btn').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.color === settingsState.appearance.accentColor);
  });
  setValue('font-family', settingsState.appearance.fontFamily);
  setValue('font-size', settingsState.appearance.fontSize);
  setRadio('density', settingsState.appearance.density);
  
  // Memory
  renderSkillsList();
  setValue('custom-prompt', settingsState.memory.customPrompt);
  setCheckbox('save-history', settingsState.memory.saveHistory);
  setCheckbox('save-context', settingsState.memory.saveContext);
  
  // Location
  setValue('location-city', settingsState.location.city);
  setValue('location-country', settingsState.location.country);
  setValue('timezone', settingsState.location.timezone);
  setValue('currency', settingsState.location.currency);
  setRadio('units', settingsState.location.units);
  setValue('language', settingsState.location.language);
  
  // Output
  settingsState.output.enabledTypes.forEach(type => {
    setCheckbox('output-' + type, true);
  });
  setValue('default-format', settingsState.output.defaultFormat);
  setValue('code-style', settingsState.output.codeStyle);
  setValue('naming-convention', settingsState.output.namingConvention);
  
  // System
  setRadio('runtime', settingsState.system.runtime);
  setValue('model-chat', settingsState.system.modelChat);
  setValue('model-code', settingsState.system.modelCode);
  setValue('ollama-url', settingsState.system.ollamaUrl);
  setValue('max-tokens', settingsState.system.maxTokens);
  setCheckbox('lock-config', settingsState.system.lockConfig);
  
  updateSettingsSummary();
}

// Helper functions
function setValue(id, value) {
  const el = document.getElementById(id);
  if (el) el.value = value;
}

function setCheckbox(id, checked) {
  const el = document.getElementById(id);
  if (el) el.checked = checked;
}

function setRadio(name, value) {
  const radio = document.querySelector(`input[name="${name}"][value="${value}"]`);
  if (radio) radio.checked = true;
}

function adjustColor(hex, percent) {
  const num = parseInt(hex.replace('#', ''), 16);
  const amt = Math.round(2.55 * percent);
  const R = (num >> 16) + amt;
  const G = (num >> 8 & 0x00FF) + amt;
  const B = (num & 0x0000FF) + amt;
  return '#' + (0x1000000 + 
    (R < 255 ? (R < 1 ? 0 : R) : 255) * 0x10000 + 
    (G < 255 ? (G < 1 ? 0 : G) : 255) * 0x100 + 
    (B < 255 ? (B < 1 ? 0 : B) : 255)
  ).toString(16).slice(1);
}

// ═══════════════════════════════════════════════════════════════════════════
// SETTINGS SUMMARY
// ═══════════════════════════════════════════════════════════════════════════

function updateSettingsSummary() {
  const summary = document.getElementById('settings-summary');
  if (!summary) return;
  
  const items = [];
  
  // Notifications
  const channels = [];
  if (settingsState.notifications.channels.email) channels.push('Email');
  if (settingsState.notifications.channels.inapp) channels.push('App');
  if (settingsState.notifications.channels.telegram) channels.push('TG');
  items.push(`🔔 ${channels.join(' + ') || 'Off'}`);
  
  // Theme
  const themeLabel = settingsState.appearance.theme === 'dark' ? 'Dark' : 
                     settingsState.appearance.theme === 'light' ? 'Light' : 'Auto';
  items.push(`🎨 ${themeLabel}`);
  
  // Location + Currency
  items.push(`📍 ${settingsState.location.city}`);
  items.push(`💰 ${settingsState.location.currency}`);
  
  summary.innerHTML = items.map(i => `<span class="summary-item">${i}</span>`).join('');
}

// ═══════════════════════════════════════════════════════════════════════════
// USER / IDENTITY
// ═══════════════════════════════════════════════════════════════════════════

function connectAccount(provider) {
  // In real implementation, this would open OAuth flow
  console.log('Connecting to:', provider);
  showToast('info', `Připojení k ${provider}...`, 'Tato funkce bude brzy dostupná.');
}

// ═══════════════════════════════════════════════════════════════════════════
// NOTIFICATIONS
// ═══════════════════════════════════════════════════════════════════════════

function updateNotifSettings() {
  settingsState.notifications.channels = {
    inapp: document.getElementById('notif-inapp')?.checked || false,
    email: document.getElementById('notif-email')?.checked || false,
    telegram: document.getElementById('notif-telegram')?.checked || false,
    webhook: document.getElementById('notif-webhook')?.checked || false
  };
  saveSettings();
}

function addEmailAddress() {
  const input = document.getElementById('notif-email-address');
  if (input && input.value) {
    settingsState.notifications.emailAddresses.push(input.value);
    saveSettings();
    showToast('success', 'Email přidán', input.value);
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// LOCATION SETTINGS
// ═══════════════════════════════════════════════════════════════════════════

function updateLocationSettings() {
  settingsState.location = {
    city: document.getElementById('location-city')?.value || 'Praha',
    country: document.getElementById('location-country')?.value || 'CZ',
    timezone: document.getElementById('timezone')?.value || 'Europe/Prague',
    currency: document.getElementById('currency')?.value || 'CZK',
    units: document.querySelector('input[name="units"]:checked')?.value || 'metric',
    language: document.getElementById('language')?.value || 'cs'
  };
  
  updateSettingsSummary();
  saveSettings();
  
  // Show confirmation
  showToast('success', 'Nastavení uloženo', `Měna: ${settingsState.location.currency}, Jazyk: ${settingsState.location.language}`);
}

// ═══════════════════════════════════════════════════════════════════════════
// APPEARANCE
// ═══════════════════════════════════════════════════════════════════════════

function setTheme(theme) {
  settingsState.appearance.theme = theme;
  
  // Update UI
  document.querySelectorAll('.theme-btn').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.theme === theme);
  });
  
  applySettings();
  saveSettings();
}

function setAccentColor(color) {
  settingsState.appearance.accentColor = color;
  
  // Update UI
  document.querySelectorAll('.color-btn').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.color === color);
  });
  
  applySettings();
  saveSettings();
}

function updateFontSize() {
  const slider = document.getElementById('font-size');
  const valueDisplay = document.getElementById('font-size-value');
  
  if (slider && valueDisplay) {
    settingsState.appearance.fontSize = parseInt(slider.value);
    valueDisplay.textContent = slider.value + 'px';
    applySettings();
    saveSettings();
  }
}

function updateAppearance() {
  settingsState.appearance.fontFamily = document.getElementById('font-family')?.value || 'system';
  applySettings();
  saveSettings();
}

// ═══════════════════════════════════════════════════════════════════════════
// MEMORY & SKILLS
// ═══════════════════════════════════════════════════════════════════════════

function renderSkillsList() {
  const list = document.getElementById('skills-list');
  if (!list) return;
  
  list.innerHTML = settingsState.memory.skills.map((skill, i) => `
    <div class="memory-item">
      <span class="memory-text">${skill}</span>
      <button class="btn-icon-xs" onclick="removeSkill(${i})">×</button>
    </div>
  `).join('');
}

function addSkill() {
  const input = document.getElementById('new-skill');
  if (input && input.value.trim()) {
    settingsState.memory.skills.push(input.value.trim());
    input.value = '';
    renderSkillsList();
    saveSettings();
  }
}

function removeSkill(index) {
  settingsState.memory.skills.splice(index, 1);
  renderSkillsList();
  saveSettings();
}

function clearMemory() {
  if (confirm('Opravdu chcete vymazat všechnu paměť? Tato akce je nevratná.')) {
    settingsState.memory.skills = [];
    settingsState.memory.customPrompt = '';
    renderSkillsList();
    document.getElementById('custom-prompt').value = '';
    saveSettings();
    showToast('success', 'Paměť vymazána', '');
  }
}

function exportMemorySettings() {
  const data = JSON.stringify(settingsState.memory, null, 2);
  downloadJSON(data, 'paiass-memory.json');
}

function importMemorySettings() {
  const input = document.createElement('input');
  input.type = 'file';
  input.accept = '.json';
  input.onchange = async (e) => {
    const file = e.target.files[0];
    if (file) {
      try {
        const text = await file.text();
        const data = JSON.parse(text);
        Object.assign(settingsState.memory, data);
        populateSettingsUI();
        saveSettings();
        showToast('success', 'Paměť importována', '');
      } catch (err) {
        showToast('error', 'Chyba importu', err.message);
      }
    }
  };
  input.click();
}

// ═══════════════════════════════════════════════════════════════════════════
// LOCATION
// ═══════════════════════════════════════════════════════════════════════════

async function detectLocation() {
  try {
    // Use IP-based geolocation (no permission needed)
    const res = await fetch('https://ipapi.co/json/');
    const data = await res.json();
    
    settingsState.location.city = data.city || settingsState.location.city;
    settingsState.location.country = data.country_code || settingsState.location.country;
    settingsState.location.timezone = data.timezone || settingsState.location.timezone;
    settingsState.location.currency = data.currency || settingsState.location.currency;
    
    populateSettingsUI();
    saveSettings();
    showToast('success', 'Lokace detekována', `${data.city}, ${data.country_code}`);
  } catch (err) {
    showToast('error', 'Nelze detekovat lokaci', err.message);
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// SYSTEM
// ═══════════════════════════════════════════════════════════════════════════

function viewLogs() {
  // Open logs viewer
  window.open('/api/logs', '_blank');
}

async function exportLogs() {
  try {
    const res = await fetch('/api/logs/export');
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `paiass-logs-${new Date().toISOString().split('T')[0]}.log`;
    a.click();
    URL.revokeObjectURL(url);
  } catch (err) {
    showToast('error', 'Chyba exportu logů', err.message);
  }
}

function resetSettings() {
  if (confirm('Opravdu chcete resetovat všechna nastavení na výchozí hodnoty?')) {
    localStorage.removeItem('paiass_settings');
    localStorage.removeItem('paiass_accordion_state');
    location.reload();
  }
}

function resetAll() {
  if (confirm('POZOR: Tímto smažete všechna data včetně agentů, konverzací a paměti. Pokračovat?')) {
    if (confirm('Jste si opravdu jisti? Tato akce je NEVRATNÁ.')) {
      // Clear everything
      localStorage.clear();
      fetch('/api/reset', { method: 'POST' }).finally(() => {
        location.reload();
      });
    }
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// ABOUT
// ═══════════════════════════════════════════════════════════════════════════

function showChangelog() {
  showToast('info', 'Changelog', 'Bude implementováno...');
}

function showLicenses() {
  showToast('info', 'Licence', 'MIT License - Belfik © 2026');
}

async function runDiagnostics() {
  showToast('info', '🔧 Diagnostika', 'Spouštím...');
  
  try {
    const checks = [];
    
    // Check Ollama
    try {
      const res = await fetch(settingsState.system.ollamaUrl + '/api/tags');
      const data = await res.json();
      checks.push(`✅ Ollama: ${data.models?.length || 0} modelů`);
    } catch {
      checks.push('❌ Ollama: nedostupná');
    }
    
    // Check API
    try {
      const res = await fetch('/api/health');
      if (res.ok) {
        checks.push('✅ API: OK');
      } else {
        checks.push('❌ API: chyba');
      }
    } catch {
      checks.push('❌ API: nedostupné');
    }
    
    // Check storage
    const storage = localStorage.getItem('paiass_settings');
    checks.push(`📦 LocalStorage: ${storage ? Math.round(storage.length / 1024) + 'KB' : 'prázdné'}`);
    
    alert('Diagnostika:\n\n' + checks.join('\n'));
  } catch (err) {
    showToast('error', 'Diagnostika selhala', err.message);
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// EXPORT / IMPORT SETTINGS
// ═══════════════════════════════════════════════════════════════════════════

function exportSettings() {
  const data = JSON.stringify(settingsState, null, 2);
  downloadJSON(data, 'paiass-settings.json');
}

function importSettings() {
  const input = document.createElement('input');
  input.type = 'file';
  input.accept = '.json';
  input.onchange = async (e) => {
    const file = e.target.files[0];
    if (file) {
      try {
        const text = await file.text();
        const data = JSON.parse(text);
        Object.assign(settingsState, data);
        applySettings();
        populateSettingsUI();
        saveSettings();
        showToast('success', 'Nastavení importována', '');
      } catch (err) {
        showToast('error', 'Chyba importu', err.message);
      }
    }
  };
  input.click();
}

function downloadJSON(data, filename) {
  const blob = new Blob([data], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

// ═══════════════════════════════════════════════════════════════════════════
// TOAST (if not already defined)
// ═══════════════════════════════════════════════════════════════════════════

function showToast(type, title, message) {
  const container = document.getElementById('toast-container');
  if (!container) return;
  
  const toast = document.createElement('div');
  toast.className = `toast toast-${type}`;
  toast.innerHTML = `
    <div class="toast-icon">${type === 'success' ? '✅' : type === 'error' ? '❌' : 'ℹ️'}</div>
    <div class="toast-content">
      <div class="toast-title">${title}</div>
      ${message ? `<div class="toast-message">${message}</div>` : ''}
    </div>
    <button class="toast-close" onclick="this.parentElement.remove()">×</button>
  `;
  container.appendChild(toast);
  
  setTimeout(() => toast.remove(), 5000);
}

// ═══════════════════════════════════════════════════════════════════════════
// INIT
// ═══════════════════════════════════════════════════════════════════════════

// Call on page load
document.addEventListener('DOMContentLoaded', () => {
  loadSettings();
  restoreAccordionState();
});

// Export for global access
window.toggleAccordion = toggleAccordion;
window.setTheme = setTheme;
window.setAccentColor = setAccentColor;
window.updateFontSize = updateFontSize;
window.updateAppearance = updateAppearance;
window.updateNotifSettings = updateNotifSettings;
window.updateLocationSettings = updateLocationSettings;
window.addEmailAddress = addEmailAddress;
window.addSkill = addSkill;
window.removeSkill = removeSkill;
window.clearMemory = clearMemory;
window.exportMemory = exportMemory;
window.importMemory = importMemory;
window.detectLocation = detectLocation;
window.viewLogs = viewLogs;
window.exportLogs = exportLogs;
window.resetSettings = resetSettings;
window.resetAll = resetAll;
window.showChangelog = showChangelog;
window.showLicenses = showLicenses;
window.runDiagnostics = runDiagnostics;
window.exportSettings = exportSettings;
window.importSettings = importSettings;
window.connectAccount = connectAccount;
// v44.1 - Expert functions
window.selectExpert = selectExpert;
window.clearExpert = clearExpert;
window.clearExpertFromUI = clearExpertFromUI;
// v44.2 - Expert selector
window.onExpertChange = onExpertChange;
// v44.2+ - Project mode actions
window.changeProject = changeProject;
window.exitProjectMode = exitProjectMode;
