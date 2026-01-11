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

function renderProjects() {
  if (state.projects.length === 0) {
    el.projectsList.innerHTML = '<div class="section-item muted">No projects yet</div>';
    return;
  }
  
  el.projectsList.innerHTML = state.projects.slice(0, 3).map(p => `
    <button class="section-item ${state.currentProject?.id === p.id ? 'active' : ''}"
            onclick="openProject(${p.id})">
      <span class="section-item-icon">📁</span>
      <span>${escapeHtml(p.name)}</span>
    </button>
  `).join('');
}

async function newProject() {
  const name = prompt('Project name:');
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
  switchToChat();
  
  // Show project roadmap as first message
  if (state.currentProject) {
    addMessage('assistant', `📁 **Project: ${state.currentProject.name}**\n\nHow can I help you with this project?`);
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// Conversations
// ═══════════════════════════════════════════════════════════════════════════

function renderHistory() {
  if (state.conversations.length === 0) {
    el.historyList.innerHTML = '<div class="section-item muted">No conversations yet</div>';
    return;
  }
  
  el.historyList.innerHTML = state.conversations.slice(0, 3).map(c => `
    <button class="section-item ${state.currentConversation?.id === c.id ? 'active' : ''}"
            onclick="openConversation('${c.id}')">
      <span class="section-item-icon">${c.project_id ? '📁' : '💬'}</span>
      <span>${escapeHtml(c.title || 'Untitled chat')}</span>
    </button>
  `).join('');
}

async function newChat() {
  setLoading(true);
  
  try {
    const data = await api('POST', '/api/conversations', {});
    state.currentConversation = data.conversation;
    state.currentProject = null;
    state.messages = [];
    
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
  
  // Add user message
  addMessage('user', msg);
  const typingId = addTyping();
  setLoading(true);
  
  try {
    const res = await api('POST', '/api/chat', {
      conversation_id: state.currentConversation.id,
      project_id: state.currentProject?.id || null,
      message: msg,
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
  const html = renderMarkdown(content);
  
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
  el.messages.scrollTop = el.messages.scrollHeight;
}

function renderMarkdown(text) {
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
  
  return marked.parse(text);
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
          toast(`Uploaded: ${file.name} (${(data.size / 1024).toFixed(1)} KB)`, 'success');
          
          // Add attachment reference to chat
          if (state.inChat && state.currentConversation) {
            addMessage('user', `📎 Attached: ${file.name}`);
          }
          
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
