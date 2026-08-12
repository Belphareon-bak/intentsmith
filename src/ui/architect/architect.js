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
  currentExpertise: null,      // { id, name, domain } (v44.1)

  // v44.2+ - Project working memory
  projectGoal: null,          // Current task/goal string
  activeFile: null,           // Last edited file path
  lastArtifactId: null,       // Last generated artifact

  // Data
  projects: [],
  conversations: [],
  messages: [],
  expertises: [],              // Available expertises (v44.1)

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

// v63.0: Active request AbortController for cancel support
let activeRequestController = null;

async function api(method, endpoint, data = null, { signal } = {}) {
  const options = {
    method,
    headers: { 'Content-Type': 'application/json' },
  };

  if (signal) options.signal = signal;
  if (data) options.body = JSON.stringify(data);

  try {
    const res = await fetch(`${API_BASE}${endpoint}`, options);
    const json = await res.json();
    if (!res.ok) throw new Error(json.error || `HTTP ${res.status}`);
    return json;
  } catch (err) {
    if (err.name === 'AbortError') {
      console.log(`[API] Request cancelled: ${method} ${endpoint}`);
      throw err;
    }
    console.error(`API Error [${method} ${endpoint}]:`, err);
    throw err;
  }
}

/**
 * v63.0: Cancel the active chat request (if any).
 * Called by the cancel button / keyboard shortcut.
 */
function cancelActiveRequest() {
  if (activeRequestController) {
    activeRequestController.abort();
    activeRequestController = null;
    return true;
  }
  return false;
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

// v44.2 - Load expertises for expertise mode selection
async function loadExpertises() {
  try {
    const data = await api('GET', '/api/expertises');
    state.expertises = data.expertises || [];
    renderExpertiseSelector();
  } catch (err) {
    console.error('Failed to load expertises:', err);
    state.expertises = [];
  }
}

// v44.2 - Render expertise selector dropdown
// v44.7 - Updated to populate both selectors (welcome screen + chat view)
function renderExpertiseSelector() {
  const selectors = [
    document.getElementById('expertise-selector'),
    document.getElementById('chat-expertise-selector'),
  ].filter(Boolean);

  if (selectors.length === 0) return;

  const options = state.expertises.map(e =>
    `<option value="${e.id}" ${state.currentExpertise?.id === e.id ? 'selected' : ''}>
      ${e.icon || '👨‍💻'} ${e.name}
    </option>`
  ).join('');

  const html = `
    <option value="">🎭 Expertyza</option>
    ${options}
  `;

  selectors.forEach(selector => {
    selector.innerHTML = html;
  });
}

// v44.2 - Handle expertise selection change
function onExpertiseChange(selectElement) {
  const expertiseId = selectElement.value;

  if (!expertiseId) {
    clearExpertise();
    toast('Přepnuto na obecný chat', 'info');
    return;
  }

  const expertise = state.expertises.find(e => e.id === expertiseId);
  if (expertise) {
    selectExpertise(expertise);
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

    // v44.5 - Sync session state from backend (preserves expertise if locked)
    if (data.sessionState) {
      if (data.sessionState.expertise) {
        state.currentExpertise = data.sessionState.expertise;
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

    // v44.5 - Sync expertise state from conversation/session
    if (data.sessionState?.expertise) {
      state.currentExpertise = data.sessionState.expertise;
    } else if (data.conversation.expertise) {
      // Fallback: expertise stored on conversation
      state.currentExpertise = data.conversation.expertise;
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

  // v63.0: Create AbortController for this request
  activeRequestController = new AbortController();
  const { signal } = activeRequestController;

  try {
    const res = await api('POST', '/api/chat', {
      conversation_id: state.currentConversation.id,
      project_id: state.currentProject?.id || null,
      message: msg,  // Send original message (attachments already uploaded)
      // v44.1 - Include expertise and session context
      expertise: state.currentExpertise || null,
      project: state.currentProject || null,
      // v45.0 - Include user-provided files from drag & drop
      userContext: typeof c3State !== 'undefined' ? c3State.userProvidedFiles : [],
    }, { signal });

    removeMessage(typingId);

    // v44.1 - Sync state from server response BEFORE adding message
    // so we can use the updated expertise info for the message display
    if (res.state) {
      if (res.state.project !== undefined) {
        state.currentProject = res.state.project;
        updateProjectIndicator();
      }
      if (res.state.expertise !== undefined) {
        state.currentExpertise = res.state.expertise;
        updateExpertiseIndicator();
      }
    }

    if (res.response) {
      // v44.5 - Include expertise info in message
      // Use expertise from response metadata, response state, or current state
      const responseExpertise = res.metadata?.expertise || res.state?.expertise || state.currentExpertise;

      // v45.0 - Process C3 visibility layer
      if (typeof processC3Response === 'function') {
        processC3Response(res);
      }

      // v44.5 - Check for structured fallback (tool failure with options)
      const structured = res.metadata?.structured;
      if (structured?.type === 'ASK_USER' && structured?.subtype === 'TOOL_FAILURE_RECOVERY') {
        // Render rich fallback UI instead of plain message
        addToolFailureMessage(res.response, structured, { expertise: responseExpertise });
      } else {
        addMessage('assistant', res.response, { expertise: responseExpertise });
      }
    }

    // Update conversation title from first message
    if (state.messages.length <= 2 && !state.currentConversation.title) {
      state.currentConversation.title = msg.substring(0, 50);
      await loadConversations();
    }

  } catch (err) {
    removeMessage(typingId);
    if (err.name === 'AbortError') {
      // v63.0: User cancelled the request — don't show error
      toast('Požadavek zrušen', 'info');
    } else {
      addMessage('assistant', `❌ Error: ${err.message}`);
      toast(`Error: ${err.message}`, 'error');
    }
  } finally {
    activeRequestController = null;
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
    addMessageToDOM(msg.role, msg.content, { expertise: msg.expertise });
  }

  scrollToBottom();
}

/**
 * Add a message to state and DOM
 * @param {string} role - 'user' or 'assistant'
 * @param {string} content - Message content
 * @param {Object} options - Optional { expertise: { id, name, icon } }
 */
function addMessage(role, content, options = {}) {
  const msg = {
    role,
    content,
    created_at: new Date().toISOString(),
    // v44.5 - Include expertise info if present
    expertise: options.expertise || null,
  };
  state.messages.push(msg);
  addMessageToDOM(role, content, options);
  scrollToBottom();
}

/**
 * Add message to DOM
 * v44.5 - Now supports expertise display
 */
function addMessageToDOM(role, content, options = {}) {
  const id = `msg-${++msgCounter}`;
  const expertise = options.expertise;

  // v44.5 - Use expertise info if available for assistant messages
  let avatar, roleName, expertiseClass = '';
  if (role === 'user') {
    avatar = '👤';
    roleName = 'You';
  } else if (expertise) {
    // Expertise response
    avatar = expertise.icon || '👨‍💻';
    roleName = expertise.name || 'Expertyza';
    expertiseClass = ' expertise-message';
  } else {
    // Regular AI response
    avatar = '🤖';
    roleName = 'AI Assistant';
  }

  const html = renderMarkdown(content, role === 'assistant');

  el.messages.insertAdjacentHTML('beforeend', `
    <div class="message ${role}${expertiseClass}" id="${id}">
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
  const expertise = options.expertise;
  const avatar = expertise ? (expertise.icon || '👨‍💻') : '🤖';
  const roleName = expertise ? expertise.name : 'AI Assistant';
  const expertiseClass = expertise ? ' expertise-message' : '';

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
    <div class="message assistant tool-failure-message${expertiseClass}" id="${id}">
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
    expertise: options.expertise || null,
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
    // v63.0: Abort active request + clear state
    cancelActiveRequest();
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

  // v44.5 - Show expertise avatar/name if expertise is active
  const expertise = state.currentExpertise;
  const avatar = expertise ? (expertise.icon || '👨‍💻') : '🤖';
  const roleName = expertise ? expertise.name : 'AI Assistant';
  const expertiseClass = expertise ? ' expertise-message' : '';

  el.messages.insertAdjacentHTML('beforeend', `
    <div class="message assistant${expertiseClass}" id="${id}">
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
  // Header - Project or Expertise or Default
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
  } else if (state.currentExpertise) {
    // v44.1 - Expertise mode display
    el.headerTitle.textContent = state.currentExpertise.name;
    el.headerBadge.textContent = 'EXPERTISE';
    el.projectIndicator.style.display = 'flex';
    el.projectName.textContent = state.currentExpertise.name;
    // v44.2+ - Hide project banner when in expertise mode
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

  // v44.4 - Expertise badge indicator
  const expertiseBadge = document.getElementById('expertise-badge');
  const expertiseBadgeIcon = document.getElementById('expertise-badge-icon');
  const expertiseBadgeName = document.getElementById('expertise-badge-name');
  if (expertiseBadge) {
    if (state.currentExpertise) {
      expertiseBadge.style.display = 'flex';
      expertiseBadgeIcon.textContent = state.currentExpertise.icon || '👨‍💻';
      expertiseBadgeName.textContent = state.currentExpertise.name;
    } else {
      expertiseBadge.style.display = 'none';
    }
  }

  // v44.4 - Update expertise selector dropdown to match state
  const expertiseSelector = document.getElementById('expertise-selector');
  if (expertiseSelector && state.currentExpertise) {
    expertiseSelector.value = state.currentExpertise.id;
  } else if (expertiseSelector) {
    expertiseSelector.value = '';
  }
}

// v44.1 - Project/Expertise indicator updates
function updateProjectIndicator() {
  updateUI();
}

function updateExpertiseIndicator() {
  updateUI();
}

// v44.1 - Select expertise
function selectExpertise(expertise) {
  state.currentExpertise = expertise;
  updateUI();
  toast(`Expertyza: ${expertise.name}`, 'info');
}

// v44.1 - Clear expertise
function clearExpertise() {
  state.currentExpertise = null;
  updateUI();
}

// v44.4 - Clear expertise from UI (badge click)
function clearExpertiseFromUI() {
  clearExpertise();
  toast('Expertyza zrušena', 'info');
  // Also update selector dropdown
  const selector = document.getElementById('expertise-selector');
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
  // v44.5 - DON'T clear expertise on welcome - expertise persists across chats
  // state.currentExpertise = null;  // REMOVED: Expertise should persist
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
  model: 'qwen3.5:27b',
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
    loadExpertises(),  // v44.2 - Load expertises for expertise mode
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
const ARCHITECT_SETTINGS_DEFAULT_DOCUMENT = {
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
    modelChat: 'qwen3.5:27b',
    modelCode: 'qwen3.5:27b',
    ollamaUrl: 'http://localhost:11434',
    maxTokens: 32768,
    lockConfig: false
  }
};

// Keep the mutable UI state separate from the unmodified reset template. The
// JSON round-trip is safe here because the source is a static literal owned by
// this file; server documents are copied below with data-property semantics.
const settingsState = JSON.parse(JSON.stringify(ARCHITECT_SETTINGS_DEFAULT_DOCUMENT));

// Portable settings are intentionally a small, default-deny profile. This
// browser copy is pinned against the repository-owned profile by M1 tests;
// unknown v2 fields never reach the import endpoint.
const ARCHITECT_SETTINGS_BACKUP_KIND = 'INTENTSMITH_SETTINGS_BACKUP';
const ARCHITECT_SETTINGS_BACKUP_SCHEMA_VERSION = 2;
const ARCHITECT_SETTINGS_PORTABLE_PROFILE = 'UX_PREFERENCES_V1';
const ARCHITECT_SETTINGS_PORTABLE_PATHS = Object.freeze([
  '/appearance/accentColor',
  '/appearance/fontFamily',
  '/appearance/fontSize',
  '/appearance/theme',
  '/c3.language',
  '/c3.output.codeBlocks',
  '/c3.output.markdownRendering',
  '/c3.output.syntaxHighlight',
  '/output/codeStyle',
  '/output/defaultFormat',
  '/output/namingConvention'
]);

let architectSettingsMutationState = 'IDLE';
let architectSettingsGeneration = 0;
let architectSettingsRevision = null;
let architectSettingsCommittedProjection = null;
let architectSettingsSaveEpoch = 0;
let architectSettingsSaveTail = Promise.resolve(true);
let architectSettingsPolicyRevision = null;
let architectSettingsResetReceipt = null;
let architectSettingsResetLocalPhase = 'IDLE';
let architectSettingsResetLocalInFlight = null;

// Architect owns only this bounded projection of the public v2 connector.
// Private/effect UI fields remain in-memory for the current session and must
// never reach the generic settings writer.
const ARCHITECT_SETTINGS_ALIAS_MAP = Object.freeze([
  Object.freeze({ server: 'c3.account.displayName', local: Object.freeze(['user', 'name']) }),
  Object.freeze({ server: 'c3.account.timezone', local: Object.freeze(['location', 'timezone']) }),
  Object.freeze({ server: 'c3.account.currency', local: Object.freeze(['location', 'currency']) }),
  Object.freeze({ server: 'c3.language', local: Object.freeze(['location', 'language']) }),
  Object.freeze({ server: 'c3.llm.chatModel', local: Object.freeze(['system', 'modelChat']) }),
  Object.freeze({ server: 'c3.llm.codeModel', local: Object.freeze(['system', 'modelCode']) }),
  Object.freeze({ server: 'c3.llm.ollamaUrl', local: Object.freeze(['system', 'ollamaUrl']) }),
  Object.freeze({ server: 'c3.llm.contextWindow', local: Object.freeze(['system', 'maxTokens']) })
]);

const ARCHITECT_SETTINGS_NESTED_OWNER_MAP = Object.freeze({
  appearance: Object.freeze(['theme', 'accentColor', 'fontFamily', 'fontSize', 'density']),
  output: Object.freeze(['enabledTypes', 'defaultFormat', 'codeStyle', 'namingConvention'])
});

function architectSettingsPlainObject(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function architectSettingsExactKeys(value, expected) {
  return architectSettingsPlainObject(value)
    && Object.keys(value).sort().join('\0') === expected.join('\0');
}

function architectSettingsExactStringList(actual, expected) {
  return Array.isArray(actual)
    && actual.length === expected.length
    && actual.every((value, index) => typeof value === 'string' && value === expected[index]);
}

function architectSettingsPolicyValid(value) {
  return value === null || (
    architectSettingsExactKeys(value, [
      'autoCleanupDays',
      'autoCleanupEnabled',
      'autoFailoverEnabled'
    ])
    && typeof value.autoFailoverEnabled === 'boolean'
    && typeof value.autoCleanupEnabled === 'boolean'
    && Number.isSafeInteger(value.autoCleanupDays)
    && value.autoCleanupDays >= 1
    && value.autoCleanupDays <= 3650
  );
}

function architectSettingsPortableValueValid(path, value) {
  if (path === '/appearance/accentColor') return typeof value === 'string' && /^#[0-9A-Fa-f]{6}$/.test(value);
  if (path === '/appearance/fontFamily') return ['system', 'inter', 'roboto', 'source-code'].includes(value);
  if (path === '/appearance/fontSize') return Number.isSafeInteger(value) && value >= 12 && value <= 20;
  if (path === '/appearance/theme') return ['dark', 'light', 'system'].includes(value);
  if (path === '/c3.language') return ['cs', 'en'].includes(value);
  if (path === '/c3.output.codeBlocks'
      || path === '/c3.output.markdownRendering'
      || path === '/c3.output.syntaxHighlight') return typeof value === 'boolean';
  if (path === '/output/codeStyle') return ['default', 'airbnb', 'google', 'standard'].includes(value);
  if (path === '/output/defaultFormat') return ['markdown', 'json', 'csv', 'yaml'].includes(value);
  if (path === '/output/namingConvention') return ['camelCase', 'snake_case', 'kebab-case', 'PascalCase'].includes(value);
  return false;
}

function architectSettingsRequireBackup(value) {
  if (!architectSettingsExactKeys(value, [
    'kind',
    'modelAutomationPolicy',
    'omissions',
    'schemaVersion',
    'settingsProjection'
  ])) throw new Error('Nepodporovaný formát přenosné zálohy');
  const projection = value.settingsProjection;
  const values = projection && projection.values;
  const omissions = value.omissions;
  if (value.kind !== ARCHITECT_SETTINGS_BACKUP_KIND
      || value.schemaVersion !== ARCHITECT_SETTINGS_BACKUP_SCHEMA_VERSION
      || !architectSettingsExactKeys(projection, ['profile', 'values'])
      || projection.profile !== ARCHITECT_SETTINGS_PORTABLE_PROFILE
      || !architectSettingsPlainObject(values)
      || !Object.keys(values).every(path => (
        ARCHITECT_SETTINGS_PORTABLE_PATHS.includes(path)
        && architectSettingsPortableValueValid(path, values[path])
      ))
      || !architectSettingsPolicyValid(value.modelAutomationPolicy)
      || !architectSettingsExactKeys(omissions, [
        'excluded',
        'scope',
        'sourceHadExcludedPaths',
        'strategy'
      ])
      || omissions.strategy !== 'DEFAULT_DENY'
      || omissions.scope !== 'GENERAL_SETTINGS'
      || omissions.excluded !== 'ALL_PATHS_NOT_IN_PROFILE'
      || typeof omissions.sourceHadExcludedPaths !== 'boolean') {
    throw new Error('Nepodporovaný formát přenosné zálohy');
  }
  return value;
}

function architectSettingsRequireLegacyBackup(value) {
  const omitted = value && value.omittedSensitiveKeys;
  const omittedValid = Array.isArray(omitted)
    && omitted.every((key, index) => typeof key === 'string' && (index === 0 || omitted[index - 1] < key));
  if (!architectSettingsExactKeys(value, [
    'generalSettings',
    'kind',
    'modelAutomationPolicy',
    'omittedSensitiveKeys',
    'schemaVersion'
  ])
      || value.kind !== ARCHITECT_SETTINGS_BACKUP_KIND
      || value.schemaVersion !== 1
      || !architectSettingsPlainObject(value.generalSettings)
      || !architectSettingsPolicyValid(value.modelAutomationPolicy)
      || !omittedValid) {
    throw new Error('Nepodporovaný legacy formát zálohy');
  }
  return value;
}

function architectSettingsImportEnvelope(value) {
  if (!architectSettingsPlainObject(value)) throw new Error('Soubor musí obsahovat JSON objekt');
  if (value.kind === ARCHITECT_SETTINGS_BACKUP_KIND
      || Object.prototype.hasOwnProperty.call(value, 'schemaVersion')) {
    return value.schemaVersion === 1
      ? architectSettingsRequireLegacyBackup(value)
      : architectSettingsRequireBackup(value);
  }
  return {
    kind: ARCHITECT_SETTINGS_BACKUP_KIND,
    schemaVersion: 1,
    generalSettings: value,
    modelAutomationPolicy: null,
    omittedSensitiveKeys: []
  };
}

function architectSettingsPortableEntry(document, path) {
  if (path.startsWith('/appearance/') || path.startsWith('/output/')) {
    const [, section, key] = path.split('/');
    if (!Object.prototype.hasOwnProperty.call(document, section)
        || !architectSettingsPlainObject(document[section])
        || !Object.prototype.hasOwnProperty.call(document[section], key)) {
      return { found: false, value: undefined };
    }
    return { found: true, value: document[section][key] };
  }
  const key = path.slice(1);
  return Object.prototype.hasOwnProperty.call(document, key)
    ? { found: true, value: document[key] }
    : { found: false, value: undefined };
}

function architectSettingsExpectedPortableEntries(envelope) {
  if (envelope.schemaVersion === ARCHITECT_SETTINGS_BACKUP_SCHEMA_VERSION) {
    return Object.keys(envelope.settingsProjection.values).sort().map(path => ({
      path,
      value: envelope.settingsProjection.values[path]
    }));
  }
  const entries = [];
  for (const path of ARCHITECT_SETTINGS_PORTABLE_PATHS) {
    const entry = architectSettingsPortableEntry(envelope.generalSettings, path);
    if (!entry.found) continue;
    if (!architectSettingsPortableValueValid(path, entry.value)) {
      throw new Error('Legacy záloha obsahuje neplatnou přenosnou předvolbu');
    }
    entries.push({ path, value: entry.value });
  }
  return entries;
}

function architectSettingsExpectedIgnoredSourcePathCount(envelope) {
  if (envelope.schemaVersion === ARCHITECT_SETTINGS_BACKUP_SCHEMA_VERSION) return 0;
  let count = 0;
  for (const [key, value] of Object.entries(envelope.generalSettings)) {
    if ((key === 'appearance' || key === 'output') && architectSettingsPlainObject(value)) {
      for (const child of Object.keys(value)) {
        if (!ARCHITECT_SETTINGS_PORTABLE_PATHS.includes(`/${key}/${child}`)) count += 1;
      }
    } else if (!ARCHITECT_SETTINGS_PORTABLE_PATHS.includes(`/${key}`)) {
      count += 1;
    }
  }
  return count;
}

async function architectSettingsResponse(response, mutation = false) {
  let body;
  try {
    body = await response.json();
  } catch (_) {
    const error = new Error('Server vrátil nečitelnou odpověď');
    error.deliveryUnknown = mutation && response.ok === true;
    throw error;
  }
  if (!response.ok) {
    const code = body && typeof body.code === 'string' ? body.code : `HTTP_${response.status}`;
    const path = body && typeof body.path === 'string' ? ` (${body.path})` : '';
    const error = new Error(`${code}${path}`);
    error.code = code;
    error.status = response.status;
    if (Number.isSafeInteger(body?.expectedRevision)) error.expectedRevision = body.expectedRevision;
    if (Number.isSafeInteger(body?.currentRevision)) error.currentRevision = body.currentRevision;
    if (Number.isSafeInteger(body?.expectedPolicyRevision)) {
      error.expectedPolicyRevision = body.expectedPolicyRevision;
    }
    if (Number.isSafeInteger(body?.currentPolicyRevision)) {
      error.currentPolicyRevision = body.currentPolicyRevision;
    }
    error.deliveryUnknown = false;
    throw error;
  }
  if (!architectSettingsPlainObject(body) || body.ok !== true) {
    const error = new Error('Server vrátil neplatnou odpověď');
    error.deliveryUnknown = mutation;
    throw error;
  }
  return body;
}

async function architectSettingsV2Response(response, mutation = false) {
  let body;
  try {
    body = await response.json();
  } catch (_) {
    const error = new Error('Server vrátil nečitelnou odpověď nastavení');
    error.deliveryUnknown = mutation && response.ok === true;
    throw error;
  }
  if (!response.ok) {
    const code = body && typeof body.code === 'string' ? body.code : `HTTP_${response.status}`;
    const error = new Error(code);
    error.code = code;
    error.status = response.status;
    if (Number.isSafeInteger(body?.expectedRevision)) error.expectedRevision = body.expectedRevision;
    if (Number.isSafeInteger(body?.currentRevision)) error.currentRevision = body.currentRevision;
    error.deliveryUnknown = false;
    throw error;
  }
  if (!architectSettingsExactKeys(body, ['revision', 'settings'])
      || !Number.isSafeInteger(body.revision)
      || body.revision < 1
      || !architectSettingsPlainObject(body.settings)) {
    const error = new Error('Server vrátil neplatný verzovaný dokument nastavení');
    error.deliveryUnknown = mutation;
    throw error;
  }
  return body;
}

async function architectSettingsPolicyResponse(response) {
  let body;
  try {
    body = await response.json();
  } catch (_) {
    throw new Error('Server vrátil nečitelnou model-policy odpověď');
  }
  if (!response.ok) {
    const code = body && typeof body.code === 'string' ? body.code : `HTTP_${response.status}`;
    const error = new Error(code);
    error.code = code;
    error.status = response.status;
    error.deliveryUnknown = false;
    throw error;
  }
  const policy = body && body.policy;
  if (!architectSettingsExactKeys(body, ['ok', 'policy'])
      || body.ok !== true
      || !architectSettingsExactKeys(policy, [
        'autoCleanupDays',
        'autoCleanupEnabled',
        'autoFailoverEnabled',
        'lastEventId',
        'revision',
        'schemaVersion',
        'updatedAtMs'
      ])
      || policy.schemaVersion !== 1
      || !Number.isSafeInteger(policy.revision)
      || policy.revision < 1
      || typeof policy.autoFailoverEnabled !== 'boolean'
      || typeof policy.autoCleanupEnabled !== 'boolean'
      || !Number.isSafeInteger(policy.autoCleanupDays)
      || policy.autoCleanupDays < 1
      || policy.autoCleanupDays > 3650
      || typeof policy.lastEventId !== 'string'
      || policy.lastEventId.length < 16
      || !Number.isSafeInteger(policy.updatedAtMs)
      || policy.updatedAtMs < 0) {
    throw new Error('Server vrátil neplatnou model-policy odpověď');
  }
  return policy;
}

function architectSettingsPolicyCommitValid(policy) {
  return architectSettingsExactKeys(policy, [
    'autoCleanupDays',
    'autoCleanupEnabled',
    'autoFailoverEnabled',
    'lastEventId',
    'revision',
    'updatedAtMs'
  ])
    && Number.isSafeInteger(policy.revision)
    && policy.revision >= 1
    && typeof policy.autoFailoverEnabled === 'boolean'
    && typeof policy.autoCleanupEnabled === 'boolean'
    && Number.isSafeInteger(policy.autoCleanupDays)
    && policy.autoCleanupDays >= 1
    && policy.autoCleanupDays <= 3650
    && typeof policy.lastEventId === 'string'
    && policy.lastEventId.length >= 16
    && Number.isSafeInteger(policy.updatedAtMs)
    && policy.updatedAtMs >= 0;
}

function architectSettingsEventValid(event, eventKind, source, actor) {
  return architectSettingsExactKeys(event, ['actor', 'eventId', 'eventKind', 'requestId', 'source'])
    && typeof event.eventId === 'string'
    && event.eventId.length >= 16
    && typeof event.requestId === 'string'
    && event.requestId.length >= 16
    && event.eventKind === eventKind
    && event.actor === actor
    && event.source === source;
}

function architectSettingsRequireCommitBase(body, expectedKeys, eventKind, source, actor) {
  if (!architectSettingsExactKeys(body, expectedKeys)
      || body.ok !== true
      || body.success !== true
      || !Number.isSafeInteger(body.revision)
      || body.revision < 1
      || !architectSettingsPlainObject(body.settings)
      || !architectSettingsPolicyCommitValid(body.policy)
      || !architectSettingsEventValid(body.event, eventKind, source, actor)
      || body.policy.lastEventId !== body.event.eventId
      || typeof body.runtimeApplied !== 'boolean'
      || (body.runtimeApplied && body.runtimeErrorCode !== null)
      || (!body.runtimeApplied && body.runtimeErrorCode !== 'SETTINGS_RUNTIME_APPLY_FAILED')) {
    const error = new Error('Server nepotvrdil úplný commit nastavení');
    error.deliveryUnknown = true;
    throw error;
  }
  return body;
}

function architectSettingsRequireImportCommit(body, expectedEnvelope, expectedRevision) {
  const expectedSchemaVersion = expectedEnvelope.schemaVersion;
  const expectedEntries = architectSettingsExpectedPortableEntries(expectedEnvelope);
  const expectedPaths = expectedEntries.map(entry => entry.path);
  const expectedIgnoredSourcePathCount = architectSettingsExpectedIgnoredSourcePathCount(expectedEnvelope);
  architectSettingsRequireCommitBase(body, [
    'appliedPortablePaths',
    'event',
    'featuresChanged',
    'ignoredSourcePathCount',
    'ok',
    'policy',
    'preservedLocalPathCount',
    'revision',
    'runtimeApplied',
    'runtimeErrorCode',
    'settings',
    'sourceSchemaVersion',
    'success'
  ], 'BACKUP_IMPORT', 'SETTINGS_IMPORT', 'user:settings-import');
  if (!Number.isSafeInteger(expectedRevision)
      || body.revision !== expectedRevision + 1
      || body.sourceSchemaVersion !== expectedSchemaVersion
      || !Number.isSafeInteger(body.featuresChanged)
      || body.featuresChanged < 0
      || !Number.isSafeInteger(body.ignoredSourcePathCount)
      || body.ignoredSourcePathCount !== expectedIgnoredSourcePathCount
      || !Number.isSafeInteger(body.preservedLocalPathCount)
      || body.preservedLocalPathCount < 0
      || !architectSettingsExactStringList(body.appliedPortablePaths, expectedPaths)
      || !expectedEntries.every(entry => {
        const committed = architectSettingsPortableEntry(body.settings, entry.path);
        return committed.found && Object.is(committed.value, entry.value);
      })
      || (expectedEnvelope.modelAutomationPolicy !== null
        && (body.policy.autoFailoverEnabled !== expectedEnvelope.modelAutomationPolicy.autoFailoverEnabled
          || body.policy.autoCleanupEnabled !== expectedEnvelope.modelAutomationPolicy.autoCleanupEnabled
          || body.policy.autoCleanupDays !== expectedEnvelope.modelAutomationPolicy.autoCleanupDays))) {
    const error = new Error('Server vrátil neplatná metadata importu');
    error.deliveryUnknown = true;
    throw error;
  }
  return body;
}

function architectSettingsRequireResetCommit(body, expectedRevision, expectedPolicyRevision) {
  architectSettingsRequireCommitBase(body, [
    'event',
    'ok',
    'policy',
    'revision',
    'runtimeApplied',
    'runtimeErrorCode',
    'settings',
    'success'
  ], 'GLOBAL_RESET', 'GLOBAL_RESET', 'user:global-reset');
  if (body.revision !== expectedRevision + 1
      || body.policy.revision !== expectedPolicyRevision + 1
      || Object.keys(body.settings).length !== 0
      || body.policy.autoFailoverEnabled !== false
      || body.policy.autoCleanupEnabled !== false
      || body.policy.autoCleanupDays !== 14) {
    const error = new Error('Server nepotvrdil přesný reset nastavení');
    error.deliveryUnknown = true;
    throw error;
  }
  return body;
}

function architectSettingsCloneData(value) {
  if (Array.isArray(value)) return value.map(item => architectSettingsCloneData(item));
  if (!architectSettingsPlainObject(value)) return value;
  const clone = {};
  for (const [key, child] of Object.entries(value)) {
    Object.defineProperty(clone, key, {
      configurable: true,
      enumerable: true,
      value: architectSettingsCloneData(child),
      writable: true
    });
  }
  return clone;
}

function architectSettingsReadLocal(document, path) {
  return path.reduce((value, key) => value[key], document);
}

function architectSettingsWriteLocal(document, path, value) {
  const parent = path.slice(0, -1).reduce((target, key) => target[key], document);
  parent[path[path.length - 1]] = architectSettingsCloneData(value);
}

function architectSettingsProjectionFromState(document = settingsState) {
  const projection = {};
  for (const entry of ARCHITECT_SETTINGS_ALIAS_MAP) {
    projection[entry.server] = architectSettingsCloneData(
      architectSettingsReadLocal(document, entry.local)
    );
  }
  for (const [container, children] of Object.entries(ARCHITECT_SETTINGS_NESTED_OWNER_MAP)) {
    projection[container] = {};
    for (const child of children) {
      projection[container][child] = architectSettingsCloneData(document[container][child]);
    }
  }
  return projection;
}

function architectSettingsStateForPublicDocument(document) {
  if (!architectSettingsPlainObject(document)) {
    throw new Error('Server vrátil neplatný veřejný dokument nastavení');
  }
  const projectedState = architectSettingsCloneData(ARCHITECT_SETTINGS_DEFAULT_DOCUMENT);
  for (const entry of ARCHITECT_SETTINGS_ALIAS_MAP) {
    if (Object.prototype.hasOwnProperty.call(document, entry.server)) {
      architectSettingsWriteLocal(projectedState, entry.local, document[entry.server]);
    }
  }
  for (const [container, children] of Object.entries(ARCHITECT_SETTINGS_NESTED_OWNER_MAP)) {
    if (!Object.prototype.hasOwnProperty.call(document, container)) continue;
    if (!architectSettingsPlainObject(document[container])) {
      throw new Error(`Server vrátil neplatnou sekci ${container}`);
    }
    for (const child of children) {
      if (Object.prototype.hasOwnProperty.call(document[container], child)) {
        projectedState[container][child] = architectSettingsCloneData(document[container][child]);
      }
    }
  }
  return projectedState;
}

function architectSettingsValuesEqual(left, right) {
  return JSON.stringify(left) === JSON.stringify(right);
}

function architectSettingsPatchBetween(committed, desired) {
  const patch = {};
  for (const entry of ARCHITECT_SETTINGS_ALIAS_MAP) {
    if (!architectSettingsValuesEqual(committed[entry.server], desired[entry.server])) {
      patch[entry.server] = architectSettingsCloneData(desired[entry.server]);
    }
  }
  for (const [container, children] of Object.entries(ARCHITECT_SETTINGS_NESTED_OWNER_MAP)) {
    const changed = {};
    for (const child of children) {
      if (!architectSettingsValuesEqual(committed[container][child], desired[container][child])) {
        changed[child] = architectSettingsCloneData(desired[container][child]);
      }
    }
    if (Object.keys(changed).length > 0) patch[container] = changed;
  }
  return patch;
}

function applyArchitectSettingsDocument(document, revision) {
  if (!Number.isSafeInteger(revision) || revision < 1) {
    throw new Error('Server vrátil neplatnou revision nastavení');
  }
  const publicState = architectSettingsStateForPublicDocument(document);
  // Reset only GENERIC-owned paths. Private/effect fields remain in memory for
  // this session and are neither read from nor written to the legacy blob.
  for (const entry of ARCHITECT_SETTINGS_ALIAS_MAP) {
    architectSettingsWriteLocal(
      settingsState,
      entry.local,
      architectSettingsReadLocal(publicState, entry.local)
    );
  }
  for (const [container, children] of Object.entries(ARCHITECT_SETTINGS_NESTED_OWNER_MAP)) {
    for (const child of children) {
      settingsState[container][child] = architectSettingsCloneData(publicState[container][child]);
    }
  }
  architectSettingsRevision = revision;
  architectSettingsCommittedProjection = architectSettingsProjectionFromState(publicState);
  applySettings();
  populateSettingsUI();
  updateSettingsSummary();
}

// Offline-only authority for retiring exact legacy notification credentials
// from localStorage['paiass_settings']. The receipt contains digests and path
// IDs only; raw values never leave this renderer through HTTP, WS or download.
const ARCHITECT_LEGACY_CREDENTIAL_RECEIPT_SCHEMA =
  'INTENTSMITH_LEGACY_CREDENTIAL_RECEIPT/V1';
const ARCHITECT_LEGACY_CREDENTIAL_RECEIPT_SOURCE = 'PAIASS_SETTINGS';
const ARCHITECT_LEGACY_CREDENTIAL_STORAGE_KEY = 'paiass_settings';
const ARCHITECT_LEGACY_CREDENTIAL_PATHS = Object.freeze([
  'notifications.discordWebhook',
  'notifications.emailAddresses',
  'notifications.slackChannel',
  'notifications.slackWebhook',
  'notifications.smsApiKey',
  'notifications.smsPhone',
  'notifications.smsSecret',
  'notifications.telegramChatId',
  'notifications.telegramToken',
  'notifications.webhookUrl'
]);
const ARCHITECT_LEGACY_CREDENTIAL_PURGE_KEYS = Object.freeze([
  'action',
  'pathDigests',
  'postimageSha256',
  'preimageSha256',
  'schema',
  'source'
]);
const ARCHITECT_LEGACY_CREDENTIAL_EXPORT_KEYS = Object.freeze([
  'action',
  'exportSha256',
  'pathDigests',
  'postimageSha256',
  'preimageSha256',
  'schema',
  'source'
]);
const ARCHITECT_LEGACY_CREDENTIAL_PATH_DIGEST_KEYS = Object.freeze([
  'path',
  'valueSha256'
]);
const ARCHITECT_LEGACY_CREDENTIAL_SHA256 = /^[0-9a-f]{64}$/;
let architectLegacyCredentialReceiptState = 'READY';

function architectLegacyCredentialReceiptError(code) {
  const error = new Error(code);
  error.code = code;
  return error;
}

function architectLegacyCredentialReceiptStatus(state, code = '') {
  architectLegacyCredentialReceiptState = state;
  const status = document.getElementById('legacy-credential-receipt-status');
  if (status) {
    status.dataset.state = state;
    status.textContent = code ? `${state}: ${code}` : state;
  }
}

function architectLegacyCredentialExactOwnKeys(value, expected) {
  if (!architectSettingsPlainObject(value)) return false;
  const actual = Reflect.ownKeys(value);
  if (actual.length !== expected.length
      || actual.some(key => typeof key !== 'string')) return false;
  actual.sort();
  return actual.every((key, index) => key === expected[index]);
}

function architectRequireLegacyCredentialReceipt(receipt) {
  if (!architectSettingsPlainObject(receipt)
      || (receipt.action !== 'EXPORT' && receipt.action !== 'PURGE')) {
    throw architectLegacyCredentialReceiptError('LEGACY_RECEIPT_INVALID');
  }
  const expectedKeys = receipt.action === 'EXPORT'
    ? ARCHITECT_LEGACY_CREDENTIAL_EXPORT_KEYS
    : ARCHITECT_LEGACY_CREDENTIAL_PURGE_KEYS;
  if (!architectLegacyCredentialExactOwnKeys(receipt, expectedKeys)
      || receipt.schema !== ARCHITECT_LEGACY_CREDENTIAL_RECEIPT_SCHEMA
      || receipt.source !== ARCHITECT_LEGACY_CREDENTIAL_RECEIPT_SOURCE
      || !ARCHITECT_LEGACY_CREDENTIAL_SHA256.test(receipt.preimageSha256)
      || !ARCHITECT_LEGACY_CREDENTIAL_SHA256.test(receipt.postimageSha256)
      || receipt.preimageSha256 === receipt.postimageSha256
      || (receipt.action === 'EXPORT'
        && !ARCHITECT_LEGACY_CREDENTIAL_SHA256.test(receipt.exportSha256))
      || !Array.isArray(receipt.pathDigests)
      || receipt.pathDigests.length < 1
      || receipt.pathDigests.length > ARCHITECT_LEGACY_CREDENTIAL_PATHS.length) {
    throw architectLegacyCredentialReceiptError('LEGACY_RECEIPT_INVALID');
  }
  let previousPath = null;
  for (const entry of receipt.pathDigests) {
    if (!architectLegacyCredentialExactOwnKeys(
      entry,
      ARCHITECT_LEGACY_CREDENTIAL_PATH_DIGEST_KEYS
    )
        || typeof entry.path !== 'string'
        || !ARCHITECT_LEGACY_CREDENTIAL_PATHS.includes(entry.path)
        || (previousPath !== null && previousPath >= entry.path)
        || !ARCHITECT_LEGACY_CREDENTIAL_SHA256.test(entry.valueSha256)) {
      throw architectLegacyCredentialReceiptError('LEGACY_RECEIPT_INVALID');
    }
    previousPath = entry.path;
  }
  return receipt;
}

async function architectLegacyCredentialSha256(value) {
  if (typeof value !== 'string'
      || !globalThis.crypto
      || !globalThis.crypto.subtle
      || typeof globalThis.crypto.subtle.digest !== 'function') {
    throw architectLegacyCredentialReceiptError('LEGACY_RECEIPT_DIGEST_UNAVAILABLE');
  }
  const bytes = new TextEncoder().encode(value);
  const digest = await globalThis.crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('');
}

function architectLegacyCredentialDocument(raw) {
  let documentValue;
  try {
    documentValue = JSON.parse(raw);
  } catch (_) {
    throw architectLegacyCredentialReceiptError('LEGACY_RECEIPT_SOURCE_INVALID');
  }
  if (!architectSettingsPlainObject(documentValue)) {
    throw architectLegacyCredentialReceiptError('LEGACY_RECEIPT_SOURCE_INVALID');
  }
  return documentValue;
}

async function architectApplyLegacyCredentialReceipt(receiptInput) {
  architectLegacyCredentialReceiptStatus('APPLYING');
  try {
    const receipt = architectRequireLegacyCredentialReceipt(receiptInput);
    let currentRaw;
    try {
      currentRaw = localStorage.getItem(ARCHITECT_LEGACY_CREDENTIAL_STORAGE_KEY);
    } catch (_) {
      throw architectLegacyCredentialReceiptError('LEGACY_RECEIPT_STORAGE_READ_FAILED');
    }
    if (typeof currentRaw !== 'string') {
      throw architectLegacyCredentialReceiptError('LEGACY_RECEIPT_SOURCE_MISSING');
    }
    const currentDocument = architectLegacyCredentialDocument(currentRaw);
    const currentSha256 = await architectLegacyCredentialSha256(currentRaw);
    if (currentSha256 === receipt.postimageSha256) {
      if (!architectSettingsPlainObject(currentDocument.notifications)
          || receipt.pathDigests.some(entry => Object.prototype.hasOwnProperty.call(
            currentDocument.notifications,
            entry.path.slice('notifications.'.length)
          ))) {
        throw architectLegacyCredentialReceiptError('LEGACY_RECEIPT_STALE');
      }
      let idempotentRaw;
      try {
        idempotentRaw = localStorage.getItem(ARCHITECT_LEGACY_CREDENTIAL_STORAGE_KEY);
      } catch (_) {
        throw architectLegacyCredentialReceiptError('LEGACY_RECEIPT_STALE');
      }
      if (idempotentRaw !== currentRaw) {
        throw architectLegacyCredentialReceiptError('LEGACY_RECEIPT_STALE');
      }
      architectLegacyCredentialReceiptStatus('ALREADY_APPLIED');
      return Object.freeze({ ok: true, state: 'ALREADY_APPLIED', code: null });
    }
    if (currentSha256 !== receipt.preimageSha256) {
      throw architectLegacyCredentialReceiptError('LEGACY_RECEIPT_STALE');
    }
    if (!architectSettingsPlainObject(currentDocument.notifications)) {
      throw architectLegacyCredentialReceiptError('LEGACY_RECEIPT_PATH_MISSING');
    }

    for (const entry of receipt.pathDigests) {
      const property = entry.path.slice('notifications.'.length);
      if (!Object.prototype.hasOwnProperty.call(currentDocument.notifications, property)) {
        throw architectLegacyCredentialReceiptError('LEGACY_RECEIPT_PATH_MISSING');
      }
      const serializedValue = JSON.stringify(currentDocument.notifications[property]);
      if (typeof serializedValue !== 'string'
          || await architectLegacyCredentialSha256(serializedValue) !== entry.valueSha256) {
        throw architectLegacyCredentialReceiptError('LEGACY_RECEIPT_PATH_DIGEST_MISMATCH');
      }
    }

    for (const entry of receipt.pathDigests) {
      delete currentDocument.notifications[entry.path.slice('notifications.'.length)];
    }
    const predictedPostimage = JSON.stringify(currentDocument);
    if (await architectLegacyCredentialSha256(predictedPostimage)
        !== receipt.postimageSha256) {
      throw architectLegacyCredentialReceiptError('LEGACY_RECEIPT_POSTIMAGE_MISMATCH');
    }

    let prewriteRaw;
    try {
      prewriteRaw = localStorage.getItem(ARCHITECT_LEGACY_CREDENTIAL_STORAGE_KEY);
    } catch (_) {
      throw architectLegacyCredentialReceiptError('LEGACY_RECEIPT_STALE');
    }
    if (prewriteRaw !== currentRaw) {
      throw architectLegacyCredentialReceiptError('LEGACY_RECEIPT_STALE');
    }
    try {
      localStorage.setItem(
        ARCHITECT_LEGACY_CREDENTIAL_STORAGE_KEY,
        predictedPostimage
      );
    } catch (_) {
      throw architectLegacyCredentialReceiptError('LEGACY_RECEIPT_STORAGE_WRITE_FAILED');
    }
    let readback;
    try {
      readback = localStorage.getItem(ARCHITECT_LEGACY_CREDENTIAL_STORAGE_KEY);
    } catch (_) {
      throw architectLegacyCredentialReceiptError('LEGACY_RECEIPT_READBACK_FAILED');
    }
    if (readback !== predictedPostimage) {
      throw architectLegacyCredentialReceiptError('LEGACY_RECEIPT_READBACK_FAILED');
    }
    architectLegacyCredentialReceiptStatus('APPLIED');
    return Object.freeze({ ok: true, state: 'APPLIED', code: null });
  } catch (error) {
    const code = typeof error?.code === 'string'
      ? error.code
      : 'LEGACY_RECEIPT_INVALID';
    architectLegacyCredentialReceiptStatus('FAILED', code);
    return Object.freeze({ ok: false, state: 'FAILED', code });
  }
}

function importLegacyCredentialReceipt() {
  const input = document.createElement('input');
  input.type = 'file';
  input.accept = '.json,application/json';
  input.onchange = async event => {
    const file = event.target.files[0];
    if (!file) return;
    let receipt;
    try {
      receipt = JSON.parse(await file.text());
    } catch (_) {
      architectLegacyCredentialReceiptStatus('FAILED', 'LEGACY_RECEIPT_FILE_INVALID');
      showToast('error', 'Receipt odmítnut', 'LEGACY_RECEIPT_FILE_INVALID');
      return;
    }
    const result = await architectApplyLegacyCredentialReceipt(receipt);
    if (result.ok) {
      showToast(
        'success',
        result.state === 'APPLIED' ? 'Legacy credentials odstraněny' : 'Receipt již aplikován',
        result.state
      );
    } else {
      showToast('error', 'Receipt odmítnut', result.code);
    }
  };
  input.click();
}

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

function architectSettingsAdoptV2Snapshot(snapshot, { apply = true } = {}) {
  const publicState = architectSettingsStateForPublicDocument(snapshot.settings);
  if (apply) {
    applyArchitectSettingsDocument(snapshot.settings, snapshot.revision);
  } else {
    architectSettingsRevision = snapshot.revision;
    architectSettingsCommittedProjection = architectSettingsProjectionFromState(publicState);
  }
  return snapshot;
}

async function architectSettingsReadV2({ apply = true } = {}) {
  const response = await fetch('/api/settings/v2');
  const snapshot = await architectSettingsV2Response(response, false);
  return architectSettingsAdoptV2Snapshot(snapshot, { apply });
}

async function loadSettings() {
  await architectSettingsSaveTail;
  const generation = architectSettingsGeneration;
  const loadableState = architectSettingsMutationState === 'IDLE'
    || architectSettingsMutationState === 'READ_FAILED'
    || architectSettingsMutationState === 'DELIVERY_UNKNOWN';
  if (!loadableState) return false;
  try {
    const response = await fetch('/api/settings/v2');
    const snapshot = await architectSettingsV2Response(response, false);
    if (generation !== architectSettingsGeneration
        || architectSettingsMutationState === 'PENDING') {
      return false;
    }
    if (architectSettingsRevision !== null && snapshot.revision < architectSettingsRevision) {
      return false;
    }
    applyArchitectSettingsDocument(snapshot.settings, snapshot.revision);
    architectSettingsMutationState = 'IDLE';
    return true;
  } catch (error) {
    if (generation !== architectSettingsGeneration
        || architectSettingsMutationState === 'PENDING') {
      return false;
    }
    architectSettingsRevision = null;
    architectSettingsCommittedProjection = null;
    architectSettingsMutationState = 'READ_FAILED';
    console.warn('Failed to load versioned settings from server:', error);
    // Do not consume, delete, or overwrite the legacy full-document blob here.
    // Its verified transfer and purge belong to the dedicated secret-storage WP.
    applySettings();
    populateSettingsUI();
    showToast(
      'error',
      'Nastavení se nepodařilo načíst',
      'Zobrazené výchozí hodnoty nejsou autoritativní a ukládání je zablokované.'
    );
    return false;
  }
}

async function architectSettingsReloadForReconfirmation(title) {
  architectSettingsSaveEpoch += 1;
  architectSettingsGeneration += 1;
  architectSettingsRevision = null;
  architectSettingsCommittedProjection = null;
  architectSettingsMutationState = 'PENDING';
  try {
    await architectSettingsReadV2({ apply: true });
    architectSettingsMutationState = 'IDLE';
    showToast(
      'error',
      title,
      'Serverová verze byla znovu načtena. Zkontrolujte ji a změnu potvrďte znovu.'
    );
    return true;
  } catch (reloadError) {
    architectSettingsMutationState = 'DELIVERY_UNKNOWN';
    console.warn('Failed to reload authoritative settings:', reloadError);
    showToast(
      'error',
      title,
      'Autoritativní stav nelze načíst. Další zápisy zůstávají zablokované do obnovení stránky.'
    );
    return false;
  }
}

async function architectSettingsCommitProjection(desired, epoch) {
  if (epoch !== architectSettingsSaveEpoch) return 'STALE';
  try {
    if (architectSettingsRevision === null || architectSettingsCommittedProjection === null) {
      return 'BLOCKED';
    }
    if (epoch !== architectSettingsSaveEpoch) return 'STALE';
    const patch = architectSettingsPatchBetween(architectSettingsCommittedProjection, desired);
    if (Object.keys(patch).length === 0) {
      updateSettingsSummary();
      return 'SESSION_ONLY';
    }
    const expectedRevision = architectSettingsRevision;
    const response = await fetch('/api/settings/v2', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ expectedRevision, patch })
    });
    const committed = await architectSettingsV2Response(response, true);
    if (committed.revision !== expectedRevision + 1) {
      const error = new Error('Server nepotvrdil přesný další revision settings commitu');
      error.deliveryUnknown = true;
      throw error;
    }
    if (epoch !== architectSettingsSaveEpoch) return 'STALE';
    architectSettingsAdoptV2Snapshot(committed, { apply: false });
    updateSettingsSummary();
    return 'COMMITTED';
  } catch (error) {
    console.warn('Failed to save versioned settings:', error);
    if (error.code === 'USER_SETTINGS_REVISION_CONFLICT' || error.status === 409) {
      await architectSettingsReloadForReconfirmation('Nastavení se mezitím změnilo');
      return 'STALE';
    }
    if (error.deliveryUnknown !== false) {
      await architectSettingsReloadForReconfirmation('Výsledek uložení nelze potvrdit');
      return 'DELIVERY_UNKNOWN';
    }
    showToast('error', 'Uložení selhalo', error.message);
    return 'FAILED';
  }
}

function saveSettings() {
  if (architectSettingsMutationState !== 'IDLE') {
    showToast(
      'error',
      'Uložení zablokováno',
      architectSettingsMutationState === 'PENDING'
        ? 'Obnova nebo autoritativní reload nastavení právě probíhá.'
        : 'Výsledek poslední změny je nejasný. Znovu načtěte stránku.'
    );
    return Promise.resolve('BLOCKED');
  }

  if (architectSettingsRevision === null || architectSettingsCommittedProjection === null) {
    showToast(
      'error',
      'Uložení čeká na autoritativní stav',
      'Nejdřív znovu načtěte nastavení; zobrazené výchozí hodnoty se neodešlou.'
    );
    loadSettings();
    return Promise.resolve('BLOCKED');
  }

  const desired = architectSettingsProjectionFromState();
  const epoch = architectSettingsSaveEpoch;
  architectSettingsGeneration += 1;
  const operation = architectSettingsSaveTail.then(
    () => architectSettingsCommitProjection(desired, epoch)
  );
  architectSettingsSaveTail = operation.catch(() => 'FAILED');
  return operation;
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
    notifEl.textContent = 'In-App (core 1.0)';
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

  // Update user name if not set
  if (data.name && !settingsState.user.name) {
    settingsState.user.name = data.name;
    const nameInput = document.getElementById('user-name');
    if (nameInput) nameInput.value = data.name;
  }

  updateUserStatus();
  saveSettings();
  showToast(
    'info',
    `${provider === 'google' ? 'Google' : 'GitHub'} propojeno pro tuto relaci`,
    'Propojený účet se na settings server neukládá.'
  );
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
  showToast('info', `${providerNames[provider]} odpojeno v této relaci`, '');
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
      <p class="modal-description">Lokální účet zůstane pouze v této otevřené relaci.</p>

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
        <span class="form-hint">Tato obrazovka heslo trvale neukládá.</span>
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

  updateUserStatus();
  saveSettings();
  hideModal();
  showToast(
    'info',
    'Lokální účet vytvořen pro tuto relaci',
    'Profilové jméno se ukládá odděleně; účetní údaje ne.'
  );
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
  showToast('info', 'Účet upraven pro tuto relaci', 'Profilové jméno se ukládá odděleně.');
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
  showToast('info', 'Lokální účet odstraněn z této relace', '');
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
      showToast('info', 'Avatar změněn pro tuto relaci', 'Na settings server se neukládá.');
    };
    reader.readAsDataURL(file);
  };
  input.click();
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
  saveSettings().then(result => {
    if (result === 'COMMITTED') {
      showToast(
        'success',
        'Podporované regionální předvolby uloženy',
        'Město, země a jednotky zůstávají jen v této relaci.'
      );
    } else if (result === 'SESSION_ONLY') {
      showToast('info', 'Změna platí jen pro tuto relaci', 'Serverová hodnota se nezměnila.');
    }
  });
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
    showToast('info', 'Prompt změněn pro tuto relaci', 'Na settings server se neukládá.');
  }
}

function resetCustomPrompt() {
  if (confirm('Obnovit výchozí prompt?')) {
    settingsState.memory.customPrompt = '';
    const textarea = document.getElementById('custom-prompt');
    if (textarea) textarea.value = '';
    updatePromptCharCount();
    saveSettings();
    showToast('info', 'Prompt obnoven pro tuto relaci', 'Na settings server se neukládá.');
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
        showToast('info', 'Paměť importována pro tuto relaci', 'Na settings server se neukládá.');
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

async function architectSettingsCompleteResetReceipt() {
  if (!architectSettingsResetReceipt) return false;
  if (architectSettingsResetLocalInFlight) return architectSettingsResetLocalInFlight;
  const receipt = architectSettingsResetReceipt;
  architectSettingsResetLocalPhase = 'APPLYING';
  architectSettingsMutationState = 'LOCAL_APPLYING';
  const operation = Promise.resolve().then(() => {
    localStorage.removeItem(ARCHITECT_LEGACY_CREDENTIAL_STORAGE_KEY);
    if (receipt !== architectSettingsResetReceipt) return false;
    applyArchitectSettingsDocument(receipt.settings, receipt.revision);
    architectSettingsPolicyRevision = receipt.policy.revision;
    architectSettingsResetLocalPhase = 'COMPLETE';
    architectSettingsMutationState = 'IDLE';
    showToast(
      'success',
      'Serverová nastavení resetována',
      [
        receipt.runtimeApplied ? '' : 'Část změn se projeví po restartu.',
        'Lokální rozložení, accordion stav, relace a ostatní data zůstala zachovaná.'
      ].filter(Boolean).join(' ')
    );
    return true;
  }).catch(error => {
    if (receipt === architectSettingsResetReceipt) {
      architectSettingsResetLocalPhase = 'DEGRADED';
      architectSettingsMutationState = 'LOCAL_DEGRADED';
      showToast(
        'error',
        'Reset serveru je commitnutý',
        `Lokální dokončení selhalo (${error.message}). Opakování provede jen lokální dokončení.`
      );
    }
    return false;
  });
  architectSettingsResetLocalInFlight = operation;
  operation.finally(() => {
    if (architectSettingsResetLocalInFlight === operation) {
      architectSettingsResetLocalInFlight = null;
    }
  });
  return operation;
}

async function resetSettings() {
  if (architectSettingsResetReceipt && architectSettingsResetLocalPhase === 'DEGRADED') {
    return architectSettingsCompleteResetReceipt();
  }
  if (architectSettingsResetReceipt && architectSettingsResetLocalInFlight) {
    return architectSettingsResetLocalInFlight;
  }
  if (!confirm('Opravdu chcete resetovat pouze serverová nastavení? Lokální data zůstanou zachovaná.')) {
    return;
  }
  if (architectSettingsMutationState !== 'IDLE') {
    showToast('error', 'Reset nelze spustit', 'Nejprve dokončete obnovu nebo znovu načtěte stránku.');
    return;
  }
  architectSettingsMutationState = 'PENDING';
  architectSettingsGeneration += 1;
  const saveEpoch = architectSettingsSaveEpoch;
  try {
    await architectSettingsSaveTail;
    if (saveEpoch !== architectSettingsSaveEpoch) {
      const error = new Error('Serverová verze se změnila; reset potvrďte znovu');
      error.deliveryUnknown = false;
      throw error;
    }
    const settingsSnapshot = await architectSettingsV2Response(
      await fetch('/api/settings/v2'),
      false
    );
    const policySnapshot = await architectSettingsPolicyResponse(
      await fetch('/api/system/models/settings')
    );
    const expectedRevision = settingsSnapshot.revision;
    const expectedPolicyRevision = policySnapshot.revision;
    const response = await fetch('/api/settings/reset', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        scope: 'SERVER_SETTINGS_V1',
        expectedRevision,
        expectedPolicyRevision
      })
    });
    const body = architectSettingsRequireResetCommit(
      await architectSettingsResponse(response, true),
      expectedRevision,
      expectedPolicyRevision
    );
    architectSettingsResetReceipt = body;
    architectSettingsResetLocalPhase = 'RECEIPT';
    architectSettingsPolicyRevision = body.policy.revision;
    await architectSettingsCompleteResetReceipt();
  } catch (error) {
    if (error.code === 'SETTINGS_RESET_REVISION_CONFLICT' || error.status === 409) {
      await architectSettingsReloadForReconfirmation('Reset narazil na novější nastavení');
    } else if (error.deliveryUnknown !== false) {
      await architectSettingsReloadForReconfirmation('Výsledek resetu nelze potvrdit');
    } else {
      architectSettingsMutationState = 'IDLE';
      showToast('error', 'Reset selhal', error.message);
    }
  }
}

function resetAll() {
  showToast(
    'error',
    'Úplné smazání není dostupné',
    'Současný backend nemá kontrakt pro smazání agentů, konverzací a paměti. Použijte pouze reset nastavení.'
  );
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

async function exportSettings() {
  try {
    const response = await fetch('/api/settings/backup');
    const body = await architectSettingsResponse(response, false);
    const backup = architectSettingsRequireBackup(body.backup);
    downloadJSON(
      JSON.stringify(backup, null, 2),
      `intentsmith-preferences-${new Date().toISOString().slice(0, 10)}.json`
    );
    showToast(
      'success',
      'Přenosná záloha vytvořena',
      'Obsahuje jen podporované předvolby a modelovou automatizační policy; tajemství a lokální cíle neobsahuje.'
    );
  } catch (error) {
    showToast('error', 'Export selhal', error.message);
  }
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
        const envelope = architectSettingsImportEnvelope(data);
        if (architectSettingsMutationState !== 'IDLE') {
          throw new Error('Jiná obnova právě probíhá nebo čeká na autoritativní reload');
        }
        architectSettingsMutationState = 'PENDING';
        architectSettingsGeneration += 1;
        const saveEpoch = architectSettingsSaveEpoch;
        try {
          await architectSettingsSaveTail;
          if (saveEpoch !== architectSettingsSaveEpoch) {
            const error = new Error('Serverová verze se změnila; import potvrďte znovu');
            error.deliveryUnknown = false;
            throw error;
          }
          if (architectSettingsRevision === null || architectSettingsCommittedProjection === null) {
            await architectSettingsReadV2({ apply: true });
          }
          const expectedRevision = architectSettingsRevision;
          const response = await fetch('/api/settings/import', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              backup: envelope,
              expectedRevision
            })
          });
          const body = architectSettingsRequireImportCommit(
            await architectSettingsResponse(response, true),
            envelope,
            expectedRevision
          );
          architectSettingsMutationState = 'IDLE';
          applyArchitectSettingsDocument(body.settings, body.revision);
          showToast(
            'success',
            'Předvolby importovány',
            [
              body.runtimeApplied ? '' : 'Část změn se projeví po restartu.',
              body.ignoredSourcePathCount > 0
                ? `${body.ignoredSourcePathCount} nepřenosných zdrojových cest bylo ignorováno.`
                : '',
              'Lokální private/effect pole této relace zůstala beze změny.'
            ].filter(Boolean).join(' ')
          );
        } catch (error) {
          if (error.code === 'USER_SETTINGS_REVISION_CONFLICT' || error.status === 409) {
            await architectSettingsReloadForReconfirmation('Import narazil na novější nastavení');
            error.handled = true;
          } else if (error.deliveryUnknown !== false) {
            await architectSettingsReloadForReconfirmation('Výsledek importu nelze potvrdit');
            error.handled = true;
          } else {
            architectSettingsMutationState = 'IDLE';
          }
          throw error;
        }
      } catch (err) {
        if (!err.handled) showToast('error', 'Chyba importu', err.message);
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
window.updateLocationSettings = updateLocationSettings;
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
// v44.1 - Expertise functions
window.selectExpertise = selectExpertise;
window.clearExpertise = clearExpertise;
window.clearExpertiseFromUI = clearExpertiseFromUI;
// v44.2 - Expertise selector
window.onExpertiseChange = onExpertiseChange;
// v44.2+ - Project mode actions
window.changeProject = changeProject;
window.exitProjectMode = exitProjectMode;
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
