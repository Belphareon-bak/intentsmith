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
    // v59 - Sync full view if open for projects
    syncFullViewState('projects');
  } catch (err) {
    console.error('Failed to load projects:', err);
    state.projects = [];
    renderProjects();
  }
}

/**
 * v59 - Sync full view state with main state when data changes
 */
function syncFullViewState(type) {
  if (!fullViewState.type || fullViewState.type !== type) return;

  if (type === 'projects') {
    fullViewState.items = [...state.projects];
  } else if (type === 'conversations') {
    fullViewState.items = [...state.conversations];
  }

  // Remove any selected IDs that no longer exist
  const existingIds = new Set(fullViewState.items.map(i => String(i.id)));
  for (const id of fullViewState.selected) {
    if (!existingIds.has(String(id))) {
      fullViewState.selected.delete(id);
    }
  }

  renderFullViewList();
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
    // v59 - Sync full view if open for conversations
    syncFullViewState('conversations');
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

    // Reload conversations (also syncs full view via v59 syncFullViewState)
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
  // v59 - Find the section container and toggle collapsed class
  const section = document.getElementById(`section-${sectionId}`);
  if (section) {
    section.classList.toggle('collapsed');
  }
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
  // Notifications (v57 enhanced)
  notifications: {
    channels: {
      inapp: true,
      push: false,
      email: false,
      telegram: false,
      slack: false,
      discord: false,
      webhook: false,
      sms: false
    },
    // Channel configs
    emailAddresses: [],
    telegramToken: '',
    telegramChatId: '',
    slackWebhook: '',
    slackChannel: '',
    discordWebhook: '',
    webhookUrl: '',
    webhookMethod: 'POST',
    smsProvider: '',
    smsApiKey: '',
    smsSecret: '',
    smsPhone: '',
    // Settings
    defaultPriority: 'normal',
    quietHours: {
      enabled: false,
      from: '22:00',
      to: '07:00'
    },
    escalation: true,
    activeTemplate: null
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

  // v60 - Apply accent color to all CSS custom properties
  const accentColor = settingsState.appearance.accentColor || '#6366f1';
  document.documentElement.style.setProperty('--accent', accentColor);
  document.documentElement.style.setProperty('--accent-hover', adjustColor(accentColor, 20));
  document.documentElement.style.setProperty('--accent-light', adjustColor(accentColor, 40));
  document.documentElement.style.setProperty('--accent-dark', adjustColor(accentColor, -20));
  document.documentElement.style.setProperty('--primary', accentColor);
  document.documentElement.style.setProperty('--primary-hover', adjustColor(accentColor, 20));

  // Apply accent as rgba for backgrounds
  const rgb = hexToRgb(accentColor);
  if (rgb) {
    document.documentElement.style.setProperty('--accent-rgb', `${rgb.r}, ${rgb.g}, ${rgb.b}`);
    document.documentElement.style.setProperty('--accent-10', `rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, 0.1)`);
    document.documentElement.style.setProperty('--accent-20', `rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, 0.2)`);
  }

  // Apply font size
  document.documentElement.style.setProperty('--font-size-base', settingsState.appearance.fontSize + 'px');

  // Apply density
  document.body.classList.toggle('compact', settingsState.appearance.density === 'compact');
}

// v60 - Convert hex to RGB
function hexToRgb(hex) {
  const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
  return result ? {
    r: parseInt(result[1], 16),
    g: parseInt(result[2], 16),
    b: parseInt(result[3], 16)
  } : null;
}

function populateSettingsUI() {
  // User
  const nameInput = document.getElementById('user-name');
  if (nameInput) nameInput.value = settingsState.user.name || '';
  
  // Notifications (v57 enhanced)
  setCheckbox('notif-inapp', settingsState.notifications.channels.inapp);
  setCheckbox('notif-push', settingsState.notifications.channels.push);
  setCheckbox('notif-email', settingsState.notifications.channels.email);
  setCheckbox('notif-telegram', settingsState.notifications.channels.telegram);
  setCheckbox('notif-slack', settingsState.notifications.channels.slack);
  setCheckbox('notif-discord', settingsState.notifications.channels.discord);
  setCheckbox('notif-webhook', settingsState.notifications.channels.webhook);
  setCheckbox('notif-sms', settingsState.notifications.channels.sms);

  // Channel configs
  setValue('notif-telegram-token', settingsState.notifications.telegramToken);
  setValue('notif-telegram-chat', settingsState.notifications.telegramChatId);
  setValue('notif-slack-webhook', settingsState.notifications.slackWebhook);
  setValue('notif-slack-channel', settingsState.notifications.slackChannel);
  setValue('notif-discord-webhook', settingsState.notifications.discordWebhook);
  setValue('notif-webhook-url', settingsState.notifications.webhookUrl);
  setValue('notif-webhook-method', settingsState.notifications.webhookMethod);
  setValue('notif-sms-provider', settingsState.notifications.smsProvider);
  setValue('notif-sms-apikey', settingsState.notifications.smsApiKey);
  setValue('notif-sms-secret', settingsState.notifications.smsSecret);
  setValue('notif-sms-phone', settingsState.notifications.smsPhone);

  // Email list
  renderEmailList();

  // Quiet hours
  setCheckbox('quiet-hours-enabled', settingsState.notifications.quietHours.enabled);
  setValue('quiet-from', settingsState.notifications.quietHours.from);
  setValue('quiet-to', settingsState.notifications.quietHours.to);

  // Priority
  document.querySelectorAll('.priority-btn').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.priority === settingsState.notifications.defaultPriority);
  });

  // Template highlight
  if (settingsState.notifications.activeTemplate) {
    document.querySelectorAll('.notif-template-btn').forEach(btn => {
      const btnTemplate = btn.getAttribute('onclick')?.match(/'(\w+)'/)?.[1];
      btn.classList.toggle('active', btnTemplate === settingsState.notifications.activeTemplate);
    });
  }

  // Update channel statuses
  setTimeout(updateChannelStatuses, 100);
  
  // Appearance
  document.querySelectorAll('.theme-btn').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.theme === settingsState.appearance.theme);
  });

  // v60 - Accent color buttons with custom color support
  const accentColor = settingsState.appearance.accentColor || '#6366f1';
  const presetColors = ['#6366f1', '#8b5cf6', '#ec4899', '#14b8a6', '#f59e0b', '#ef4444'];
  const isPreset = presetColors.includes(accentColor);

  document.querySelectorAll('.color-btn:not(.custom-color-btn)').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.color === accentColor);
  });

  // Custom color button
  const customBtn = document.getElementById('custom-color-btn');
  const customInput = document.getElementById('custom-accent-color');
  if (customBtn && customInput) {
    customBtn.classList.toggle('active', !isPreset);
    customInput.value = accentColor;
    if (!isPreset) {
      customBtn.style.background = accentColor;
    }
  }

  // Color preview
  const colorValueEl = document.getElementById('current-accent-color');
  if (colorValueEl) {
    colorValueEl.textContent = accentColor;
    colorValueEl.style.color = accentColor;
  }

  setValue('font-family', settingsState.appearance.fontFamily);
  setValue('font-size', settingsState.appearance.fontSize);
  const fontSizeValue = document.getElementById('font-size-value');
  if (fontSizeValue) fontSizeValue.textContent = (settingsState.appearance.fontSize || 14) + 'px';
  setRadio('density', settingsState.appearance.density);
  
  // Memory & Persistence (v60)
  setValue('custom-prompt', settingsState.memory.customPrompt || '');
  updatePromptCharCount();
  setCheckbox('save-history', settingsState.memory.saveHistory !== false);
  setCheckbox('save-context', settingsState.memory.saveContext !== false);
  setCheckbox('save-attachments', settingsState.memory.saveAttachments !== false);
  updateStorageInfo();

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
  // Update notification overview
  const notifEl = document.getElementById('overview-notif');
  if (notifEl) {
    const channels = [];
    if (settingsState.notifications.channels.email) channels.push('Email');
    if (settingsState.notifications.channels.inapp) channels.push('App');
    if (settingsState.notifications.channels.push) channels.push('Push');
    if (settingsState.notifications.channels.telegram) channels.push('TG');
    if (settingsState.notifications.channels.slack) channels.push('Slack');
    if (settingsState.notifications.channels.discord) channels.push('Discord');
    notifEl.textContent = channels.length > 0 ? channels.slice(0, 2).join(' + ') + (channels.length > 2 ? ' +' + (channels.length - 2) : '') : 'Vypnuto';
  }

  // Update theme overview
  const themeEl = document.getElementById('overview-theme');
  if (themeEl) {
    const themeLabels = { dark: 'Tmavé', light: 'Světlé', system: 'Systémové' };
    themeEl.textContent = themeLabels[settingsState.appearance.theme] || 'Tmavé';
  }

  // Update location overview
  const locationEl = document.getElementById('overview-location');
  if (locationEl) {
    const city = settingsState.location.city || 'Praha';
    const country = settingsState.location.country || 'CZ';
    locationEl.textContent = `${city}, ${country}`;
  }

  // Update context overview
  const contextEl = document.getElementById('overview-context');
  if (contextEl) {
    const saveHistory = settingsState.memory?.saveHistory !== false;
    const saveContext = settingsState.memory?.saveContext !== false;
    contextEl.textContent = saveHistory && saveContext ? 'Aktivní' :
                            saveHistory || saveContext ? 'Částečný' : 'Vypnutý';
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// USER / IDENTITY - v60 Enhanced
// ═══════════════════════════════════════════════════════════════════════════

function toggleAccountConnection(provider) {
  const accountItem = document.getElementById(`account-${provider}`);
  const isConnected = accountItem?.classList.contains('connected');

  if (isConnected) {
    disconnectAccount(provider);
  } else {
    connectAccount(provider);
  }
}

function connectAccount(provider) {
  const providerNames = { google: 'Google', github: 'GitHub' };
  const placeholders = {
    google: 'vas@gmail.com',
    github: 'username'
  };

  // v57.3 - Local account linking (no OAuth server needed)
  const email = prompt(
    `Zadejte svůj ${providerNames[provider]} ${provider === 'google' ? 'email' : 'username'}:`,
    placeholders[provider]
  );

  if (!email || !email.trim()) {
    showToast('info', 'Zrušeno', '');
    return;
  }

  const trimmed = email.trim();
  const displayEmail = provider === 'github' && !trimmed.includes('@')
    ? `${trimmed}@github.com`
    : trimmed;

  handleOAuthSuccess(provider, {
    email: displayEmail,
    name: trimmed.split('@')[0]
  });
}

function handleOAuthSuccess(provider, data) {
  const accountItem = document.getElementById(`account-${provider}`);
  const emailEl = document.getElementById(`${provider}-email`);
  const actionBtn = accountItem?.querySelector('.account-action-btn .action-text');

  if (accountItem) {
    accountItem.classList.add('connected');
  }
  if (emailEl) {
    emailEl.textContent = data.email;
  }
  if (actionBtn) {
    actionBtn.textContent = 'Odpojit';
  }

  // Store connected account
  if (!settingsState.user.connectedAccounts.find(a => a.provider === provider)) {
    settingsState.user.connectedAccounts.push({
      provider,
      email: data.email,
      name: data.name,
      connectedAt: new Date().toISOString()
    });
  }

  // Auto-fill email for notifications if not set
  if (provider === 'google' && data.email) {
    const emailInput = document.getElementById('notif-email-address');
    if (emailInput && !emailInput.value) {
      emailInput.value = data.email;
      validateChannelConfig('email');
    }
  }

  // Update user name if not set
  if (data.name && !settingsState.user.name) {
    settingsState.user.name = data.name;
    const nameInput = document.getElementById('user-name');
    if (nameInput) nameInput.value = data.name;
  }

  updateUserStatus();
  saveSettings();
  showToast('success', `${provider === 'google' ? 'Google' : 'GitHub'} propojeno`, data.email);
}

function disconnectAccount(provider) {
  const providerNames = { google: 'Google', github: 'GitHub' };

  if (!confirm(`Opravdu chcete odpojit účet ${providerNames[provider]}?`)) {
    return;
  }

  const accountItem = document.getElementById(`account-${provider}`);
  const emailEl = document.getElementById(`${provider}-email`);
  const actionBtn = accountItem?.querySelector('.account-action-btn .action-text');

  if (accountItem) {
    accountItem.classList.remove('connected');
  }
  if (emailEl) {
    emailEl.textContent = 'Nepropojeno';
  }
  if (actionBtn) {
    actionBtn.textContent = 'Propojit';
  }

  // Remove from connected accounts
  settingsState.user.connectedAccounts = settingsState.user.connectedAccounts.filter(
    a => a.provider !== provider
  );

  updateUserStatus();
  saveSettings();
  showToast('info', `${providerNames[provider]} odpojeno`, '');
}

function updateUserName() {
  const nameInput = document.getElementById('user-name');
  if (nameInput) {
    settingsState.user.name = nameInput.value;
    updateUserStatus();
    saveSettings();
  }
}

function updateUserStatus() {
  const statusEl = document.getElementById('user-status');
  if (!statusEl) return;

  const connectedCount = settingsState.user.connectedAccounts.length;
  const hasLocalAccount = settingsState.user.localAccount;

  if (connectedCount > 0 || hasLocalAccount) {
    statusEl.textContent = connectedCount > 0
      ? `Propojeno: ${connectedCount} účt${connectedCount === 1 ? '' : 'y'}`
      : 'Lokální účet';
    statusEl.classList.add('connected');
  } else {
    statusEl.textContent = 'Nepřihlášen';
    statusEl.classList.remove('connected');
  }
}

function showLocalAccountModal() {
  showModal(`
    <div class="modal-content local-account-modal">
      <h3>Vytvořit lokální účet</h3>
      <p class="modal-description">Lokální účet je uložen pouze na tomto zařízení.</p>

      <div class="form-group">
        <label>Uživatelské jméno</label>
        <input type="text" id="local-username" class="settings-input" placeholder="Vaše jméno">
      </div>

      <div class="form-group">
        <label>Email (volitelné)</label>
        <input type="email" id="local-email" class="settings-input" placeholder="email@example.com">
      </div>

      <div class="form-group">
        <label>Heslo (volitelné)</label>
        <input type="password" id="local-password" class="settings-input" placeholder="Pro lokální šifrování">
        <span class="form-hint">Heslo slouží k šifrování lokálních dat.</span>
      </div>

      <div class="modal-actions">
        <button class="btn btn-secondary" onclick="hideModal()">Zrušit</button>
        <button class="btn btn-primary" onclick="createLocalAccount()">Vytvořit účet</button>
      </div>
    </div>
  `);
}

function createLocalAccount() {
  const username = document.getElementById('local-username')?.value?.trim();
  const email = document.getElementById('local-email')?.value?.trim();
  const password = document.getElementById('local-password')?.value;

  if (!username) {
    showToast('error', 'Chybí jméno', 'Zadejte uživatelské jméno.');
    return;
  }

  settingsState.user.localAccount = {
    username,
    email: email || null,
    hasPassword: !!password,
    createdAt: new Date().toISOString()
  };

  settingsState.user.name = username;

  // Update UI
  const nameInput = document.getElementById('user-name');
  if (nameInput) nameInput.value = username;

  const localSection = document.getElementById('local-account-section');
  const localStatus = document.getElementById('local-account-status');
  const localBtn = document.getElementById('btn-local-account');

  if (localSection) localSection.classList.add('has-account');
  if (localStatus) {
    localStatus.querySelector('.status-text').textContent = username;
  }
  if (localBtn) {
    localBtn.textContent = 'Upravit';
    localBtn.onclick = showEditLocalAccountModal;
  }

  // Auto-fill email if provided
  if (email) {
    const emailInput = document.getElementById('notif-email-address');
    if (emailInput && !emailInput.value) {
      emailInput.value = email;
      validateChannelConfig('email');
    }
  }

  updateUserStatus();
  saveSettings();
  hideModal();
  showToast('success', 'Lokální účet vytvořen', username);
}

function showEditLocalAccountModal() {
  const account = settingsState.user.localAccount;
  if (!account) {
    showLocalAccountModal();
    return;
  }

  showModal(`
    <div class="modal-content local-account-modal">
      <h3>Upravit lokální účet</h3>

      <div class="form-group">
        <label>Uživatelské jméno</label>
        <input type="text" id="local-username" class="settings-input" value="${account.username || ''}">
      </div>

      <div class="form-group">
        <label>Email (volitelné)</label>
        <input type="email" id="local-email" class="settings-input" value="${account.email || ''}">
      </div>

      <div class="modal-actions">
        <button class="btn btn-danger" onclick="deleteLocalAccount()">Smazat účet</button>
        <button class="btn btn-secondary" onclick="hideModal()">Zrušit</button>
        <button class="btn btn-primary" onclick="updateLocalAccount()">Uložit</button>
      </div>
    </div>
  `);
}

function updateLocalAccount() {
  const username = document.getElementById('local-username')?.value?.trim();
  const email = document.getElementById('local-email')?.value?.trim();

  if (!username) {
    showToast('error', 'Chybí jméno', 'Zadejte uživatelské jméno.');
    return;
  }

  settingsState.user.localAccount.username = username;
  settingsState.user.localAccount.email = email || null;
  settingsState.user.name = username;

  const nameInput = document.getElementById('user-name');
  if (nameInput) nameInput.value = username;

  const localStatus = document.getElementById('local-account-status');
  if (localStatus) {
    localStatus.querySelector('.status-text').textContent = username;
  }

  updateUserStatus();
  saveSettings();
  hideModal();
  showToast('success', 'Účet aktualizován', '');
}

function deleteLocalAccount() {
  if (!confirm('Opravdu chcete smazat lokální účet?')) return;

  settingsState.user.localAccount = null;

  const localSection = document.getElementById('local-account-section');
  const localStatus = document.getElementById('local-account-status');
  const localBtn = document.getElementById('btn-local-account');

  if (localSection) localSection.classList.remove('has-account');
  if (localStatus) {
    localStatus.querySelector('.status-text').textContent = 'Žádný lokální účet';
  }
  if (localBtn) {
    localBtn.textContent = '+ Vytvořit lokální účet';
    localBtn.onclick = showLocalAccountModal;
  }

  updateUserStatus();
  saveSettings();
  hideModal();
  showToast('info', 'Lokální účet smazán', '');
}

function changeAvatar() {
  const input = document.createElement('input');
  input.type = 'file';
  input.accept = 'image/*';
  input.onchange = async (e) => {
    const file = e.target.files[0];
    if (!file) return;

    // Convert to base64 for storage
    const reader = new FileReader();
    reader.onload = (e) => {
      const base64 = e.target.result;
      settingsState.user.avatar = base64;

      const avatarEl = document.getElementById('user-avatar');
      if (avatarEl) {
        avatarEl.innerHTML = `<img src="${base64}" alt="Avatar" style="width: 100%; height: 100%; object-fit: cover; border-radius: 50%;"><span class="avatar-edit-hint">📷</span>`;
      }

      saveSettings();
      showToast('success', 'Avatar aktualizován', '');
    };
    reader.readAsDataURL(file);
  };
  input.click();
}

// ═══════════════════════════════════════════════════════════════════════════
// NOTIFICATIONS
// ═══════════════════════════════════════════════════════════════════════════

// v57.3 - Toggle channel config panel visibility (click on header)
function toggleChannelConfig(channel, event) {
  if (event?.target?.closest?.('.toggle')) return;
  const item = document.querySelector(`.channel-item[data-channel="${channel}"]`);
  if (item) item.classList.toggle('expanded');
}

function updateNotifSettings() {
  const channelsToValidate = ['email', 'telegram', 'slack', 'discord', 'webhook', 'push', 'sms'];

  // Save channel configs first
  settingsState.notifications.telegramToken = document.getElementById('notif-telegram-token')?.value || '';
  settingsState.notifications.telegramChatId = document.getElementById('notif-telegram-chat')?.value || '';
  settingsState.notifications.slackWebhook = document.getElementById('notif-slack-webhook')?.value || '';
  settingsState.notifications.slackChannel = document.getElementById('notif-slack-channel')?.value || '';
  settingsState.notifications.discordWebhook = document.getElementById('notif-discord-webhook')?.value || '';
  settingsState.notifications.webhookUrl = document.getElementById('notif-webhook-url')?.value || '';
  settingsState.notifications.webhookMethod = document.getElementById('notif-webhook-method')?.value || 'POST';
  settingsState.notifications.smsProvider = document.getElementById('notif-sms-provider')?.value || '';
  settingsState.notifications.smsApiKey = document.getElementById('notif-sms-apikey')?.value || '';
  settingsState.notifications.smsSecret = document.getElementById('notif-sms-secret')?.value || '';
  settingsState.notifications.smsPhone = document.getElementById('notif-sms-phone')?.value || '';

  // v57.3 - Allow enabling channels freely; warn if not configured but don't block
  const newChannels = {};
  channelsToValidate.forEach(channel => {
    const checkbox = document.getElementById(`notif-${channel}`);
    if (!checkbox) return;

    newChannels[channel] = checkbox.checked;

    // Show warning + auto-expand config if enabling without config
    if (checkbox.checked && !isChannelConfigured(channel)) {
      showChannelConfigWarning(channel);
      const item = document.querySelector(`.channel-item[data-channel="${channel}"]`);
      if (item) item.classList.add('expanded');
    }
  });

  // In-app is always valid
  newChannels.inapp = document.getElementById('notif-inapp')?.checked || false;

  settingsState.notifications.channels = newChannels;

  // Quiet hours
  settingsState.notifications.quietHours = {
    enabled: document.getElementById('quiet-hours-enabled')?.checked || false,
    from: document.getElementById('quiet-from')?.value || '22:00',
    to: document.getElementById('quiet-to')?.value || '07:00'
  };

  updateChannelStatuses();
  updateSettingsSummary();
  saveSettings();
}

// v60 - Check if channel has valid configuration
function isChannelConfigured(channel) {
  switch (channel) {
    case 'email':
      const emailInput = document.getElementById('notif-email-address')?.value?.trim();
      return emailInput || settingsState.notifications.emailAddresses?.length > 0;

    case 'telegram':
      const token = document.getElementById('notif-telegram-token')?.value?.trim();
      const chat = document.getElementById('notif-telegram-chat')?.value?.trim();
      return token && chat;

    case 'slack':
      const slackUrl = document.getElementById('notif-slack-webhook')?.value?.trim();
      return slackUrl && slackUrl.includes('hooks.slack.com');

    case 'discord':
      const discordUrl = document.getElementById('notif-discord-webhook')?.value?.trim();
      return discordUrl && discordUrl.includes('discord.com/api/webhooks');

    case 'webhook':
      const webhookUrl = document.getElementById('notif-webhook-url')?.value?.trim();
      return webhookUrl && webhookUrl.startsWith('http');

    case 'push':
      return typeof Notification !== 'undefined' && Notification.permission === 'granted';

    case 'sms':
      const provider = document.getElementById('notif-sms-provider')?.value;
      const apiKey = document.getElementById('notif-sms-apikey')?.value?.trim();
      const phone = document.getElementById('notif-sms-phone')?.value?.trim();
      return provider && apiKey && phone;

    default:
      return true;
  }
}

// v60 - Show warning when channel is not configured
function showChannelConfigWarning(channel) {
  const warnings = {
    email: 'Nejprve zadejte emailovou adresu.',
    telegram: 'Nejprve vyplňte Telegram Bot Token a Chat ID.',
    slack: 'Nejprve zadejte Slack Webhook URL.',
    discord: 'Nejprve zadejte Discord Webhook URL.',
    webhook: 'Nejprve zadejte Webhook URL.',
    push: 'Nejprve povolte push notifikace v prohlížeči.',
    sms: 'Nejprve nakonfigurujte SMS poskytovatele.'
  };

  showToast('warning', 'Nelze aktivovat', warnings[channel] || 'Kanál není nakonfigurován.');

  // Highlight the config section
  const configEl = document.getElementById(`${channel}-config`);
  if (configEl) {
    configEl.classList.add('highlight');
    setTimeout(() => configEl.classList.remove('highlight'), 2000);
  }
}

function addEmailAddress() {
  const input = document.getElementById('notif-email-address');
  if (input && input.value) {
    if (!settingsState.notifications.emailAddresses.includes(input.value)) {
      settingsState.notifications.emailAddresses.push(input.value);
      renderEmailList();
      saveSettings();
      showToast('success', 'Email přidán', input.value);
      input.value = '';
      validateChannelConfig('email');
    } else {
      showToast('warning', 'Email již existuje', input.value);
    }
  }
}

// v57 - Render email list with remove buttons
function renderEmailList() {
  const list = document.getElementById('email-list');
  if (!list) return;

  list.innerHTML = settingsState.notifications.emailAddresses.map((email, i) => `
    <span class="email-tag">
      ${email}
      <button class="email-tag-remove" onclick="removeEmail(${i})" title="Odstranit">×</button>
    </span>
  `).join('');
}

function removeEmail(index) {
  settingsState.notifications.emailAddresses.splice(index, 1);
  renderEmailList();
  validateChannelConfig('email');
  saveSettings();
}

// v57 - Apply notification template
function applyNotifTemplate(template) {
  const templates = {
    personal: { inapp: true, push: false, email: true, telegram: false, slack: false, discord: false, webhook: false, sms: false },
    work: { inapp: true, push: true, email: true, telegram: false, slack: true, discord: false, webhook: false, sms: false },
    developer: { inapp: true, push: true, email: false, telegram: false, slack: false, discord: true, webhook: true, sms: false },
    minimal: { inapp: true, push: false, email: false, telegram: false, slack: false, discord: false, webhook: false, sms: false }
  };

  const config = templates[template];
  if (!config) return;

  // Update checkboxes
  Object.keys(config).forEach(channel => {
    const checkbox = document.getElementById(`notif-${channel}`);
    if (checkbox) checkbox.checked = config[channel];
  });

  // Update state
  settingsState.notifications.channels = { ...config };
  settingsState.notifications.activeTemplate = template;

  // Update template buttons
  document.querySelectorAll('.notif-template-btn').forEach(btn => {
    const btnTemplate = btn.getAttribute('onclick')?.match(/'(\w+)'/)?.[1];
    btn.classList.toggle('active', btnTemplate === template);
  });

  updateChannelStatuses();
  saveSettings();
  showToast('success', 'Šablona aplikována', `${template.charAt(0).toUpperCase() + template.slice(1)}`);
}

// v57 - Validate channel configuration
function validateChannelConfig(channel) {
  const statusEl = document.getElementById(`status-${channel}`);
  if (!statusEl) return false;

  let isValid = false;
  let statusText = 'Nenastaveno';
  let statusClass = '';

  switch (channel) {
    case 'email':
      isValid = settingsState.notifications.emailAddresses.length > 0;
      statusText = isValid ? `${settingsState.notifications.emailAddresses.length} adres` : 'Nenastaveno';
      statusClass = isValid ? 'connected' : '';
      break;

    case 'telegram':
      const token = document.getElementById('notif-telegram-token')?.value;
      const chat = document.getElementById('notif-telegram-chat')?.value;
      isValid = token && chat;
      statusText = isValid ? 'Nakonfigurováno' : 'Vyplňte token a chat ID';
      statusClass = isValid ? 'connected' : '';
      break;

    case 'slack':
      const slackUrl = document.getElementById('notif-slack-webhook')?.value;
      isValid = slackUrl && slackUrl.includes('hooks.slack.com');
      statusText = isValid ? 'Nakonfigurováno' : 'Nenastaveno';
      statusClass = isValid ? 'connected' : '';
      break;

    case 'discord':
      const discordUrl = document.getElementById('notif-discord-webhook')?.value;
      isValid = discordUrl && discordUrl.includes('discord.com/api/webhooks');
      statusText = isValid ? 'Nakonfigurováno' : 'Nenastaveno';
      statusClass = isValid ? 'connected' : '';
      break;

    case 'webhook':
      const webhookUrl = document.getElementById('notif-webhook-url')?.value;
      isValid = webhookUrl && webhookUrl.startsWith('http');
      statusText = isValid ? 'Nakonfigurováno' : 'Nenastaveno';
      statusClass = isValid ? 'connected' : '';
      break;

    case 'push':
      isValid = Notification.permission === 'granted';
      statusText = isValid ? 'Povoleno' : (Notification.permission === 'denied' ? 'Zakázáno' : 'Vyžaduje povolení');
      statusClass = isValid ? 'connected' : (Notification.permission === 'denied' ? 'error' : '');
      break;
  }

  statusEl.textContent = statusText;
  statusEl.className = 'channel-status ' + statusClass;

  return isValid;
}

// v57 - Update all channel statuses
function updateChannelStatuses() {
  ['email', 'telegram', 'slack', 'discord', 'webhook', 'push'].forEach(validateChannelConfig);

  // In-App is always active if enabled
  const inappStatus = document.getElementById('status-inapp');
  if (inappStatus) {
    const enabled = settingsState.notifications.channels.inapp;
    inappStatus.textContent = enabled ? 'Aktivní' : 'Vypnuto';
    inappStatus.className = 'channel-status ' + (enabled ? 'connected' : '');
  }
}

// v57 - Request push notification permission
async function requestPushPermission() {
  if (!('Notification' in window)) {
    showToast('error', 'Nepodporováno', 'Váš prohlížeč nepodporuje push notifikace');
    return;
  }

  try {
    const permission = await Notification.requestPermission();
    validateChannelConfig('push');

    if (permission === 'granted') {
      showToast('success', 'Push notifikace povoleny', '');
      // Send test notification
      new Notification('p(AI)assistant', {
        body: 'Push notifikace jsou nyní aktivní! 🎉',
        icon: '/favicon.ico'
      });
    } else if (permission === 'denied') {
      showToast('error', 'Přístup odepřen', 'Push notifikace byly zamítnuty v nastavení prohlížeče');
    }
  } catch (err) {
    showToast('error', 'Chyba', err.message);
  }
}

// v57 - Test notification channel
async function testChannel(channel) {
  showToast('info', 'Odesílám testovací notifikaci...', channel);

  try {
    const response = await fetch('/api/notifications/test', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        channel,
        config: getChannelConfig(channel)
      })
    });

    const result = await response.json();

    if (result.success) {
      showToast('success', 'Test úspěšný', `${channel} notifikace odeslána`);
      validateChannelConfig(channel);
    } else {
      showToast('error', 'Test selhal', result.error || 'Neznámá chyba');
    }
  } catch (err) {
    // Fallback for local testing (no backend)
    if (channel === 'push' && Notification.permission === 'granted') {
      new Notification('p(AI)assistant - Test', {
        body: 'Toto je testovací push notifikace! ✅',
        icon: '/favicon.ico'
      });
      showToast('success', 'Test úspěšný', 'Push notifikace odeslána');
    } else {
      showToast('warning', 'Backend nedostupný', 'Test odeslán pouze lokálně');
    }
  }
}

// v57 - Get channel configuration for API
function getChannelConfig(channel) {
  switch (channel) {
    case 'email':
      return { addresses: settingsState.notifications.emailAddresses };
    case 'telegram':
      return {
        token: settingsState.notifications.telegramToken,
        chatId: settingsState.notifications.telegramChatId
      };
    case 'slack':
      return {
        webhookUrl: settingsState.notifications.slackWebhook,
        channel: settingsState.notifications.slackChannel
      };
    case 'discord':
      return { webhookUrl: settingsState.notifications.discordWebhook };
    case 'webhook':
      return {
        url: settingsState.notifications.webhookUrl,
        method: settingsState.notifications.webhookMethod
      };
    case 'sms':
      return {
        provider: settingsState.notifications.smsProvider,
        apiKey: settingsState.notifications.smsApiKey,
        secret: settingsState.notifications.smsSecret,
        phone: settingsState.notifications.smsPhone
      };
    default:
      return {};
  }
}

// v57 - Show webhook payload example
function showWebhookPayload() {
  const payload = {
    event: 'notification',
    timestamp: new Date().toISOString(),
    priority: 'normal',
    data: {
      title: 'Příklad notifikace',
      message: 'Toto je ukázková zpráva z p(AI)assistant',
      source: 'agent',
      agentId: 'example-agent',
      metadata: {}
    }
  };

  const html = `
    <pre style="background: var(--bg-tertiary); padding: 16px; border-radius: 8px; overflow-x: auto; font-size: 12px;">
${JSON.stringify(payload, null, 2)}
    </pre>
  `;

  // Create modal
  const modalId = `modal-webhook-${Date.now()}`;
  document.body.insertAdjacentHTML('beforeend', `
    <div class="modal-overlay" id="${modalId}" onclick="if(event.target===this)this.remove()">
      <div class="modal-dialog" style="max-width: 500px;">
        <div class="modal-header">
          <h3>📋 Webhook Payload</h3>
          <button class="modal-close" onclick="document.getElementById('${modalId}').remove()">&times;</button>
        </div>
        <div class="modal-body">
          <p style="margin-bottom: 12px; color: var(--text-secondary);">Příklad JSON payloadu, který bude odeslán na váš webhook:</p>
          ${html}
          <button class="btn btn-secondary btn-sm" style="margin-top: 12px;" onclick="navigator.clipboard.writeText(\`${JSON.stringify(payload, null, 2)}\`); showToast('success', 'Zkopírováno', '')">
            📋 Kopírovat do schránky
          </button>
        </div>
      </div>
    </div>
  `);
}

// v57 - Set default notification priority
function setDefaultPriority(priority) {
  settingsState.notifications.defaultPriority = priority;

  // Update UI
  document.querySelectorAll('.priority-btn').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.priority === priority);
  });

  saveSettings();
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

function setAccentColor(color, isCustom = false) {
  settingsState.appearance.accentColor = color;

  // Update UI - preset buttons
  document.querySelectorAll('.color-btn:not(.custom-color-btn)').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.color === color);
  });

  // Update custom color button
  const customBtn = document.getElementById('custom-color-btn');
  const customInput = document.getElementById('custom-accent-color');
  if (customBtn && customInput) {
    const isPreset = ['#6366f1', '#8b5cf6', '#ec4899', '#14b8a6', '#f59e0b', '#ef4444'].includes(color);
    customBtn.classList.toggle('active', isCustom || !isPreset);
    customInput.value = color;
    if (isCustom || !isPreset) {
      customBtn.style.background = color;
    } else {
      customBtn.style.background = 'conic-gradient(red, yellow, lime, aqua, blue, magenta, red)';
    }
  }

  // Update current color preview
  const colorValueEl = document.getElementById('current-accent-color');
  if (colorValueEl) {
    colorValueEl.textContent = color;
    colorValueEl.style.color = color;
  }

  applySettings();
  updateSettingsSummary();
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
  if (confirm('Opravdu chcete vymazat všechnu paměť a historii? Tato akce je nevratná.')) {
    settingsState.memory.skills = [];
    settingsState.memory.customPrompt = '';
    document.getElementById('custom-prompt').value = '';
    updatePromptCharCount();
    saveSettings();

    // Clear stored data
    localStorage.removeItem('paiass_history');
    localStorage.removeItem('paiass_attachments');
    localStorage.removeItem('paiass_cache');

    updateStorageInfo();
    showToast('success', 'Vše vymazáno', 'Paměť a historie byly vymazány.');
  }
}

// v60 - Custom prompt management
function saveCustomPrompt() {
  const textarea = document.getElementById('custom-prompt');
  if (textarea) {
    settingsState.memory.customPrompt = textarea.value;
    updatePromptCharCount();
    saveSettings();
    showToast('success', 'Prompt uložen', '');
  }
}

function resetCustomPrompt() {
  if (confirm('Obnovit výchozí prompt?')) {
    settingsState.memory.customPrompt = '';
    const textarea = document.getElementById('custom-prompt');
    if (textarea) textarea.value = '';
    updatePromptCharCount();
    saveSettings();
    showToast('info', 'Prompt obnoven', 'Výchozí nastavení obnoveno.');
  }
}

function updatePromptCharCount() {
  const textarea = document.getElementById('custom-prompt');
  const counter = document.getElementById('prompt-char-count');
  if (textarea && counter) {
    const length = textarea.value.length;
    counter.textContent = `${length} / 2000`;
    counter.style.color = length > 1800 ? 'var(--warning)' : length > 2000 ? 'var(--error)' : 'var(--text-muted)';
  }
}

// v60 - Persistence settings
function updatePersistenceSettings() {
  settingsState.memory.saveHistory = document.getElementById('save-history')?.checked ?? true;
  settingsState.memory.saveContext = document.getElementById('save-context')?.checked ?? true;
  settingsState.memory.saveAttachments = document.getElementById('save-attachments')?.checked ?? true;

  updateSettingsSummary();
  saveSettings();
}

// v60 - Storage management
function updateStorageInfo() {
  // Calculate localStorage usage
  const historySize = getStorageSize('paiass_history');
  const attachmentsSize = getStorageSize('paiass_attachments');
  const cacheSize = getStorageSize('paiass_cache') + getStorageSize('paiass_settings');
  const totalSize = historySize + attachmentsSize + cacheSize;

  const formatSize = (bytes) => {
    if (bytes === 0) return '0 B';
    if (bytes < 1024) return bytes + ' B';
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
    return (bytes / (1024 * 1024)).toFixed(2) + ' MB';
  };

  const setEl = (id, value) => {
    const el = document.getElementById(id);
    if (el) el.textContent = formatSize(value);
  };

  setEl('storage-history', historySize);
  setEl('storage-attachments', attachmentsSize);
  setEl('storage-cache', cacheSize);
  setEl('storage-total', totalSize);
}

function getStorageSize(key) {
  try {
    const item = localStorage.getItem(key);
    return item ? new Blob([item]).size : 0;
  } catch {
    return 0;
  }
}

function clearCache() {
  if (confirm('Vymazat cache? Nastavení zůstanou zachována.')) {
    localStorage.removeItem('paiass_cache');
    updateStorageInfo();
    showToast('success', 'Cache vymazána', '');
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
// OUTPUT & FORMATS (v60)
// ═══════════════════════════════════════════════════════════════════════════

function updateOutputSettings() {
  // Get enabled output types
  const outputTypes = ['code', 'docs', 'xlsx', 'pptx', 'pdf', 'reports'];
  settingsState.output.enabledTypes = outputTypes.filter(type =>
    document.getElementById(`output-${type}`)?.checked
  );

  // Get format preferences
  settingsState.output.defaultFormat = document.getElementById('default-format')?.value || 'markdown';
  settingsState.output.codeStyle = document.getElementById('code-style')?.value || 'default';
  settingsState.output.namingConvention = document.getElementById('naming-convention')?.value || 'camelCase';

  saveSettings();
}

function previewFormat() {
  const format = document.getElementById('default-format')?.value || 'markdown';
  const previewEl = document.getElementById('format-preview');
  if (!previewEl) return;

  const examples = {
    markdown: `# Ukázka Markdown

**Tučný text** a *kurzíva*

- Seznam položek
- Další položka

\`\`\`javascript
const hello = "world";
\`\`\``,

    json: `{
  "name": "Ukázka",
  "values": [1, 2, 3],
  "nested": {
    "key": "value"
  }
}`,

    csv: `name,age,city
Jan,25,Praha
Marie,30,Brno
Petr,28,Ostrava`,

    yaml: `name: Ukázka
values:
  - 1
  - 2
  - 3
nested:
  key: value`
  };

  previewEl.textContent = examples[format] || 'Náhled není k dispozici.';
  previewEl.classList.toggle('visible', !previewEl.classList.contains('visible'));
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
window.clearCache = clearCache;
window.saveCustomPrompt = saveCustomPrompt;
window.resetCustomPrompt = resetCustomPrompt;
window.updatePersistenceSettings = updatePersistenceSettings;
window.exportMemory = exportMemory;
window.importMemory = importMemory;
window.detectLocation = detectLocation;
window.updateOutputSettings = updateOutputSettings;
window.previewFormat = previewFormat;
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
// v57 - Enhanced notifications
window.applyNotifTemplate = applyNotifTemplate;
window.validateChannelConfig = validateChannelConfig;
window.testChannel = testChannel;
window.requestPushPermission = requestPushPermission;
window.showWebhookPayload = showWebhookPayload;
window.setDefaultPriority = setDefaultPriority;
window.removeEmail = removeEmail;

// ═══════════════════════════════════════════════════════════════════════════
// v58 - Full View Modal for Projects/Conversations with Bulk Operations
// ═══════════════════════════════════════════════════════════════════════════

let fullViewState = {
  type: null, // 'projects' | 'conversations'
  items: [],
  selected: new Set(),
  searchQuery: '',
  viewMode: localStorage.getItem('fullview-mode') || 'list' // 'list' | 'grid'
};

/**
 * Show full view modal for projects or conversations
 */
function showFullView(type) {
  fullViewState.type = type;
  fullViewState.selected = new Set();
  fullViewState.searchQuery = '';

  const modal = document.getElementById('fullview-modal');
  const title = document.getElementById('fullview-title');
  const searchInput = document.getElementById('fullview-search');

  if (type === 'projects') {
    title.innerHTML = '📁 Všechny projekty';
    fullViewState.items = [...state.projects];
  } else {
    title.innerHTML = '💬 Všechny konverzace';
    // Include all conversations (both project and non-project)
    fullViewState.items = [...state.conversations];
  }

  searchInput.value = '';
  modal.classList.remove('hidden');

  // Apply view mode
  applyViewMode();

  renderFullViewList();
  updateFullViewUI();

  // Focus search input
  setTimeout(() => searchInput.focus(), 100);

  // Add escape key handler
  document.addEventListener('keydown', handleFullViewEscape);
}

/**
 * Set full view display mode (list or grid)
 */
function setFullViewMode(mode) {
  fullViewState.viewMode = mode;
  applyViewMode();

  // Save preference
  try {
    localStorage.setItem('fullview-mode', mode);
  } catch (e) {}
}

/**
 * Apply view mode to UI
 */
function applyViewMode() {
  const list = document.getElementById('fullview-list');
  const toggleBtns = document.querySelectorAll('.view-toggle-btn');

  // Update list class
  list.classList.remove('view-list', 'view-grid');
  list.classList.add(`view-${fullViewState.viewMode}`);

  // Update toggle buttons
  toggleBtns.forEach(btn => {
    btn.classList.toggle('active', btn.dataset.view === fullViewState.viewMode);
  });
}

/**
 * Close full view modal
 */
function closeFullView() {
  const modal = document.getElementById('fullview-modal');
  modal.classList.add('hidden');
  fullViewState.type = null;
  fullViewState.items = [];
  fullViewState.selected = new Set();

  document.removeEventListener('keydown', handleFullViewEscape);
}

function handleFullViewEscape(e) {
  if (e.key === 'Escape') {
    closeFullView();
  }
}

/**
 * Render the list of items in full view
 */
function renderFullViewList() {
  const container = document.getElementById('fullview-list');
  const query = fullViewState.searchQuery.toLowerCase();

  // Filter items based on search
  const filtered = fullViewState.items.filter(item => {
    const name = (item.name || item.title || 'Untitled').toLowerCase();
    return name.includes(query);
  });

  if (filtered.length === 0) {
    container.innerHTML = `
      <div class="fullview-empty">
        <div class="fullview-empty-icon">${fullViewState.type === 'projects' ? '📁' : '💬'}</div>
        <div class="fullview-empty-text">${query ? 'Žádné výsledky' : 'Žádné položky'}</div>
      </div>
    `;
    updateFullViewUI();
    return;
  }

  container.innerHTML = filtered.map(item => {
    const id = item.id;
    const name = escapeHtml(item.name || item.title || 'Untitled');
    const isSelected = fullViewState.selected.has(id);
    const icon = fullViewState.type === 'projects' ? '📁' : '💬';
    const meta = formatItemMeta(item);
    const isActive = fullViewState.type === 'projects'
      ? state.currentProject?.id === id
      : state.currentConversation?.id === id;

    return `
      <div class="fullview-item ${isSelected ? 'selected' : ''} ${isActive ? 'active' : ''}"
           data-id="${id}"
           onclick="toggleItemSelection('${id}')">
        <div class="fullview-checkbox"></div>
        <span class="fullview-icon">${icon}</span>
        <div class="fullview-info">
          <div class="fullview-name">${name}</div>
          <div class="fullview-meta">${meta}</div>
        </div>
        <div class="fullview-item-actions">
          <button class="fullview-item-btn" onclick="event.stopPropagation(); openFromFullView('${id}')" title="Otevřít">
            <svg fill="none" stroke="currentColor" viewBox="0 0 24 24" width="16" height="16">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z"/>
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z"/>
            </svg>
          </button>
          <button class="fullview-item-btn danger" onclick="event.stopPropagation(); deleteFromFullView('${id}')" title="Smazat">
            <svg fill="none" stroke="currentColor" viewBox="0 0 24 24" width="16" height="16">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"/>
            </svg>
          </button>
        </div>
      </div>
    `;
  }).join('');

  updateFullViewUI();
}

/**
 * Format metadata for item (date, message count, etc.)
 */
function formatItemMeta(item) {
  const parts = [];

  if (item.created_at) {
    const date = new Date(item.created_at);
    parts.push(date.toLocaleDateString('cs-CZ'));
  }

  if (item.message_count) {
    parts.push(`${item.message_count} zpráv`);
  }

  if (item.project_id && fullViewState.type === 'conversations') {
    parts.push('📁 Projekt');
  }

  return parts.join(' • ') || '—';
}

/**
 * Toggle selection of an item
 */
function toggleItemSelection(id) {
  if (fullViewState.selected.has(id)) {
    fullViewState.selected.delete(id);
  } else {
    fullViewState.selected.add(id);
  }

  // Update visual state
  const itemEl = document.querySelector(`.fullview-item[data-id="${id}"]`);
  if (itemEl) {
    itemEl.classList.toggle('selected', fullViewState.selected.has(id));
  }

  updateFullViewUI();
}

/**
 * Toggle select all items
 */
function toggleSelectAll() {
  const query = fullViewState.searchQuery.toLowerCase();
  const filtered = fullViewState.items.filter(item => {
    const name = (item.name || item.title || 'Untitled').toLowerCase();
    return name.includes(query);
  });

  const allSelected = filtered.length > 0 && filtered.every(item => fullViewState.selected.has(item.id));

  if (allSelected) {
    // Deselect all
    filtered.forEach(item => fullViewState.selected.delete(item.id));
  } else {
    // Select all filtered items
    filtered.forEach(item => fullViewState.selected.add(item.id));
  }

  renderFullViewList();
}

/**
 * Update UI elements (counts, button states)
 */
function updateFullViewUI() {
  const countEl = document.getElementById('fullview-count');
  const selectedCountEl = document.getElementById('fullview-selected-count');
  const deleteBtn = document.getElementById('fullview-delete-selected');
  const deleteCountSpan = document.getElementById('delete-count');
  const selectAllBtn = document.getElementById('fullview-select-all');

  const total = fullViewState.items.length;
  const selectedCount = fullViewState.selected.size;

  // Update counts
  countEl.textContent = `${total} ${fullViewState.type === 'projects' ? 'projektů' : 'konverzací'}`;

  if (selectedCount > 0) {
    selectedCountEl.style.display = 'inline';
    selectedCountEl.textContent = `${selectedCount} vybráno`;
    deleteBtn.style.display = 'flex';
    deleteCountSpan.textContent = `Smazat (${selectedCount})`;
  } else {
    selectedCountEl.style.display = 'none';
    deleteBtn.style.display = 'none';
  }

  // Update select all button text
  const query = fullViewState.searchQuery.toLowerCase();
  const filtered = fullViewState.items.filter(item => {
    const name = (item.name || item.title || 'Untitled').toLowerCase();
    return name.includes(query);
  });
  const allSelected = filtered.length > 0 && filtered.every(item => fullViewState.selected.has(item.id));
  selectAllBtn.querySelector('span').textContent = allSelected ? 'Zrušit výběr' : 'Vybrat vše';
}

/**
 * Filter full view list based on search
 */
function filterFullView() {
  const searchInput = document.getElementById('fullview-search');
  fullViewState.searchQuery = searchInput.value;
  renderFullViewList();
}

/**
 * Open item from full view
 */
async function openFromFullView(id) {
  closeFullView();

  if (fullViewState.type === 'projects') {
    await openProject(parseInt(id));
  } else {
    await openConversation(id);
  }
}

/**
 * Delete single item from full view
 */
async function deleteFromFullView(id) {
  const item = fullViewState.items.find(i => String(i.id) === String(id));
  const name = item?.name || item?.title || 'tuto položku';

  if (!confirm(`Opravdu chcete smazat "${name}"?`)) {
    return;
  }

  try {
    if (fullViewState.type === 'projects') {
      await api('DELETE', `/api/projects/${id}`);
      await loadProjects();
    } else {
      await api('DELETE', `/api/conversations/${id}`);
      await loadConversations();
    }

    // Remove from local state
    fullViewState.items = fullViewState.items.filter(i => String(i.id) !== String(id));
    fullViewState.selected.delete(id);

    renderFullViewList();
    toast('Položka smazána', 'success');
  } catch (err) {
    toast(`Chyba: ${err.message}`, 'error');
  }
}

/**
 * Delete all selected items
 */
async function deleteSelected() {
  const count = fullViewState.selected.size;

  if (count === 0) return;

  const itemType = fullViewState.type === 'projects' ? 'projektů' : 'konverzací';
  if (!confirm(`Opravdu chcete smazat ${count} ${itemType}?`)) {
    return;
  }

  setLoading(true);
  let successCount = 0;
  let errorCount = 0;

  for (const id of fullViewState.selected) {
    try {
      if (fullViewState.type === 'projects') {
        await api('DELETE', `/api/projects/${id}`);
      } else {
        await api('DELETE', `/api/conversations/${id}`);
      }
      successCount++;
    } catch (err) {
      console.error(`Failed to delete ${id}:`, err);
      errorCount++;
    }
  }

  // Reload data
  if (fullViewState.type === 'projects') {
    await loadProjects();
    fullViewState.items = [...state.projects];
  } else {
    await loadConversations();
    fullViewState.items = [...state.conversations];
  }

  fullViewState.selected = new Set();
  renderFullViewList();

  setLoading(false);

  if (errorCount > 0) {
    toast(`Smazáno ${successCount}, chyby: ${errorCount}`, 'warning');
  } else {
    toast(`Smazáno ${successCount} položek`, 'success');
  }
}

// v58/59 - Window exports for full view and sections
window.showFullView = showFullView;
window.closeFullView = closeFullView;
window.toggleSelectAll = toggleSelectAll;
window.deleteSelected = deleteSelected;
window.filterFullView = filterFullView;
window.toggleItemSelection = toggleItemSelection;
window.setFullViewMode = setFullViewMode;
window.openFromFullView = openFromFullView;
window.deleteFromFullView = deleteFromFullView;
window.toggleSection = toggleSection;
