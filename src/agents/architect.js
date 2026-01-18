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
  
  // Data
  projects: [],
  conversations: [],
  messages: [],
  
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
    });
    
    removeMessage(typingId);
    
    if (res.response) {
      addMessage('assistant', res.response);
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
    addMessageToDOM(msg.role, msg.content);
  }
  
  scrollToBottom();
}

function addMessage(role, content) {
  state.messages.push({ role, content, created_at: new Date().toISOString() });
  addMessageToDOM(role, content);
  scrollToBottom();
}

function addMessageToDOM(role, content) {
  const id = `msg-${++msgCounter}`;
  const avatar = role === 'user' ? '👤' : '🤖';
  const roleName = role === 'user' ? 'You' : 'AI Assistant';
  const html = renderMarkdown(content, role === 'assistant');
  
  el.messages.insertAdjacentHTML('beforeend', `
    <div class="message ${role}" id="${id}">
      <div class="message-avatar">${avatar}</div>
      <div class="message-body">
        <div class="message-role">${roleName}</div>
        <div class="message-text">${html}</div>
      </div>
    </div>
  `);
  
  return id;
}

function addTyping() {
  const id = `typing-${++msgCounter}`;
  
  el.messages.insertAdjacentHTML('beforeend', `
    <div class="message assistant" id="${id}">
      <div class="message-avatar">🤖</div>
      <div class="message-body">
        <div class="message-role">AI Assistant</div>
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
    if (el.messages) {
      el.messages.scrollTo({
        top: el.messages.scrollHeight,
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
  // Header
  if (state.currentProject) {
    el.headerTitle.textContent = state.currentProject.name;
    el.headerBadge.textContent = 'PROJECT';
    el.projectIndicator.style.display = 'flex';
    el.projectName.textContent = state.currentProject.name;
  } else if (state.currentConversation) {
    el.headerTitle.textContent = state.currentConversation.title || 'New Chat';
    el.headerBadge.textContent = '';
    el.projectIndicator.style.display = 'none';
  } else {
    el.headerTitle.textContent = 'AI Assistant';
    el.headerBadge.textContent = '';
    el.projectIndicator.style.display = 'none';
  }
  
  // Status
  el.statusText.textContent = state.isLoading ? 'Processing...' : 'Ready';
  el.statusDot.className = 'status-dot' + (state.isLoading ? ' loading' : '');
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
  saveSettings();
}

function loadSettings() {
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

function saveSettings() {
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

// Helper
function escapeHtml(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
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
