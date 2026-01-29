// ═══════════════════════════════════════════════════════════════════════════════
// C3 Visibility Layer - Transparency & Control UI Components
// ═══════════════════════════════════════════════════════════════════════════════
//
// Phase A: Visibility (read-only)
//   A1: Context Bar - workspace, files, mode, intent
//   A2: Live Action Log - "What C3 is doing"
//
// Phase B: Controlled file operations
//   B1: Drag & Drop to context
//   B2: Edit requests with diff preview
//   B3: Diff Viewer component
//
// Phase C: Audit & Debug
//   C1: Decision Trace per response
//   C2: Audit trail
//
// ═══════════════════════════════════════════════════════════════════════════════

// ─────────────────────────────────────────────────────────────────────────────
// State
// ─────────────────────────────────────────────────────────────────────────────

const c3State = {
  // Context tracking
  workspace: null,
  loadedFiles: [],
  userProvidedFiles: [], // Files added via drag & drop

  // Mode & Intent
  mode: 'CHAT', // CHAT | PROJECT | EXPERT
  currentIntent: null,
  responseIntent: null,

  // Active modules
  activeModules: [],

  // Action log
  actionLog: [],
  maxLogEntries: 50,

  // Pending changes (for diff preview)
  pendingChanges: [],

  // Audit trail
  auditTrail: [],

  // UI state
  actionLogExpanded: false,
  debugMode: false,
};

// ─────────────────────────────────────────────────────────────────────────────
// Phase A1: Context Bar
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Create and inject the C3 Context Bar
 */
function createContextBar() {
  const bar = document.createElement('div');
  bar.id = 'c3-context-bar';
  bar.className = 'c3-context-bar';
  bar.innerHTML = `
    <div class="c3-context-section" id="c3-workspace">
      <span class="c3-context-icon">📁</span>
      <span class="c3-context-label">Workspace</span>
      <span class="c3-context-value" id="c3-workspace-value">—</span>
    </div>

    <div class="c3-context-divider"></div>

    <div class="c3-context-section" id="c3-files">
      <span class="c3-context-icon">📄</span>
      <span class="c3-context-label">Context</span>
      <span class="c3-context-value" id="c3-files-count">0 files</span>
    </div>

    <div class="c3-context-divider"></div>

    <div class="c3-context-section" id="c3-mode">
      <span class="c3-context-icon">⚙️</span>
      <span class="c3-context-label">Mode</span>
      <span class="c3-context-value c3-badge" id="c3-mode-value">CHAT</span>
    </div>

    <div class="c3-context-divider"></div>

    <div class="c3-context-section" id="c3-intent">
      <span class="c3-context-icon">🎯</span>
      <span class="c3-context-label">Intent</span>
      <span class="c3-context-value c3-badge" id="c3-intent-value">—</span>
    </div>

    <div class="c3-context-spacer"></div>

    <div class="c3-context-section c3-modules" id="c3-modules">
      <span class="c3-context-icon">🔗</span>
      <span class="c3-modules-list" id="c3-modules-list"></span>
    </div>

    <button class="c3-context-toggle" id="c3-debug-toggle" onclick="c3ToggleDebug()" title="Toggle debug mode">
      <span id="c3-debug-icon">🔍</span>
    </button>
  `;

  // Insert after main header
  const mainHeader = document.querySelector('.main-header');
  if (mainHeader) {
    mainHeader.insertAdjacentElement('afterend', bar);
  }
}

/**
 * Update Context Bar values
 */
function updateContextBar(data = {}) {
  // Workspace
  if (data.workspace !== undefined) {
    c3State.workspace = data.workspace;
    const wsEl = document.getElementById('c3-workspace-value');
    if (wsEl) {
      wsEl.textContent = data.workspace || '—';
      wsEl.title = data.workspace || '';
    }
  }

  // Files count
  if (data.files !== undefined) {
    c3State.loadedFiles = data.files;
    const filesEl = document.getElementById('c3-files-count');
    if (filesEl) {
      const count = data.files.length + c3State.userProvidedFiles.length;
      filesEl.textContent = `${count} file${count !== 1 ? 's' : ''}`;
      filesEl.title = [...data.files, ...c3State.userProvidedFiles].join('\n');
    }
  }

  // Mode
  if (data.mode !== undefined) {
    c3State.mode = data.mode;
    const modeEl = document.getElementById('c3-mode-value');
    if (modeEl) {
      modeEl.textContent = data.mode;
      modeEl.className = `c3-context-value c3-badge c3-badge-${data.mode.toLowerCase()}`;
    }
  }

  // Intent
  if (data.intent !== undefined) {
    c3State.currentIntent = data.intent;
    const intentEl = document.getElementById('c3-intent-value');
    if (intentEl) {
      intentEl.textContent = data.intent || '—';
      intentEl.className = `c3-context-value c3-badge c3-badge-${(data.intent || 'none').toLowerCase()}`;
    }
  }

  // Active modules
  if (data.modules !== undefined) {
    c3State.activeModules = data.modules;
    const modulesEl = document.getElementById('c3-modules-list');
    if (modulesEl) {
      modulesEl.innerHTML = data.modules.map(m =>
        `<span class="c3-module-chip" title="${m}">${getModuleIcon(m)}</span>`
      ).join('');
    }
  }
}

function getModuleIcon(module) {
  const icons = {
    'ToolExecutor': '🔧',
    'Synthesis': '✨',
    'DriftGuard': '🛡️',
    'RelevanceFilter': '🎯',
    'SourceTrust': '🔒',
    'ConfidenceScaling': '📊',
    'CreativeDepth': '🎨',
    'WebSearch': '🌐',
    'FileRead': '📖',
    'FileWrite': '✏️',
  };
  return icons[module] || '📦';
}

// ─────────────────────────────────────────────────────────────────────────────
// Phase A2: Live Action Log
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Create the collapsible action log
 */
function createActionLog() {
  const container = document.createElement('div');
  container.id = 'c3-action-log';
  container.className = 'c3-action-log collapsed';
  container.innerHTML = `
    <button class="c3-action-log-header" onclick="c3ToggleActionLog()">
      <span class="c3-action-log-icon">▸</span>
      <span class="c3-action-log-title">C3 Actions</span>
      <span class="c3-action-log-count" id="c3-action-count">(0)</span>
    </button>
    <div class="c3-action-log-content" id="c3-action-log-content"></div>
  `;

  // Insert below context bar
  const contextBar = document.getElementById('c3-context-bar');
  if (contextBar) {
    contextBar.insertAdjacentElement('afterend', container);
  }
}

/**
 * Add action to log
 */
function addC3Action(action) {
  const entry = {
    timestamp: new Date().toISOString(),
    ...action,
  };

  c3State.actionLog.unshift(entry);

  // Trim log if too long
  if (c3State.actionLog.length > c3State.maxLogEntries) {
    c3State.actionLog.pop();
  }

  renderActionLog();
  updateActionCount();
}

/**
 * Render action log entries
 */
function renderActionLog() {
  const content = document.getElementById('c3-action-log-content');
  if (!content) return;

  content.innerHTML = c3State.actionLog.map(entry => `
    <div class="c3-action-entry c3-action-${entry.type || 'info'}">
      <span class="c3-action-time">${formatTime(entry.timestamp)}</span>
      <span class="c3-action-icon">${getActionIcon(entry.type)}</span>
      <span class="c3-action-text">${entry.message}</span>
      ${entry.detail ? `<span class="c3-action-detail">${entry.detail}</span>` : ''}
    </div>
  `).join('');
}

function updateActionCount() {
  const countEl = document.getElementById('c3-action-count');
  if (countEl) {
    countEl.textContent = `(${c3State.actionLog.length})`;
  }
}

function getActionIcon(type) {
  const icons = {
    'context': '📂',
    'intent': '🎯',
    'tool': '🔧',
    'synthesis': '✨',
    'decision': '🧠',
    'file_read': '📖',
    'file_write': '✏️',
    'file_add': '📄',
    'skip': '⏭️',
    'error': '❌',
    'success': '✅',
    'info': '💬',
  };
  return icons[type] || '•';
}

function formatTime(isoString) {
  const date = new Date(isoString);
  return date.toLocaleTimeString('cs-CZ', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

function c3ToggleActionLog() {
  const log = document.getElementById('c3-action-log');
  const icon = log?.querySelector('.c3-action-log-icon');
  if (log) {
    c3State.actionLogExpanded = !c3State.actionLogExpanded;
    log.classList.toggle('collapsed', !c3State.actionLogExpanded);
    if (icon) {
      icon.textContent = c3State.actionLogExpanded ? '▾' : '▸';
    }
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Phase B1: Drag & Drop File to Context
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Initialize drag & drop zone
 */
function initDragDrop() {
  const chatContainer = document.getElementById('chat-container');
  if (!chatContainer) return;

  // Create drop zone overlay
  const dropZone = document.createElement('div');
  dropZone.id = 'c3-drop-zone';
  dropZone.className = 'c3-drop-zone';
  dropZone.innerHTML = `
    <div class="c3-drop-zone-content">
      <span class="c3-drop-zone-icon">📄</span>
      <span class="c3-drop-zone-text">Drop file to add to context</span>
      <span class="c3-drop-zone-hint">File will be loaded but NOT modified</span>
    </div>
  `;
  chatContainer.appendChild(dropZone);

  // Drag events
  chatContainer.addEventListener('dragenter', handleDragEnter);
  chatContainer.addEventListener('dragover', handleDragOver);
  chatContainer.addEventListener('dragleave', handleDragLeave);
  chatContainer.addEventListener('drop', handleDrop);
}

function handleDragEnter(e) {
  e.preventDefault();
  const dropZone = document.getElementById('c3-drop-zone');
  if (dropZone) {
    dropZone.classList.add('active');
  }
}

function handleDragOver(e) {
  e.preventDefault();
}

function handleDragLeave(e) {
  e.preventDefault();
  // Only hide if leaving the container entirely
  if (!e.currentTarget.contains(e.relatedTarget)) {
    const dropZone = document.getElementById('c3-drop-zone');
    if (dropZone) {
      dropZone.classList.remove('active');
    }
  }
}

async function handleDrop(e) {
  e.preventDefault();
  const dropZone = document.getElementById('c3-drop-zone');
  if (dropZone) {
    dropZone.classList.remove('active');
  }

  const files = Array.from(e.dataTransfer.files);
  if (files.length === 0) return;

  for (const file of files) {
    await addFileToContext(file);
  }
}

/**
 * Add file to context (read-only, no disk write)
 */
async function addFileToContext(file) {
  try {
    // Read file content
    const content = await readFileContent(file);

    const fileInfo = {
      name: file.name,
      size: file.size,
      type: file.type || 'text/plain',
      content: content,
      addedAt: new Date().toISOString(),
    };

    // Add to user-provided files
    c3State.userProvidedFiles.push(fileInfo);

    // Log action
    addC3Action({
      type: 'file_add',
      message: `Added to context: ${file.name}`,
      detail: `${formatFileSize(file.size)}`,
    });

    // Update context bar
    updateContextBar({ files: c3State.loadedFiles });

    // Show toast
    showC3Toast('success', 'File Added', `${file.name} added to context`);

    // Show file badge in chat input area
    showFileContextBadge(fileInfo);

  } catch (err) {
    addC3Action({
      type: 'error',
      message: `Failed to read file: ${file.name}`,
      detail: err.message,
    });
    showC3Toast('error', 'Error', `Failed to read ${file.name}`);
  }
}

function readFileContent(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (e) => resolve(e.target.result);
    reader.onerror = (e) => reject(e);
    reader.readAsText(file);
  });
}

function formatFileSize(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/**
 * Show file context badge above input
 */
function showFileContextBadge(fileInfo) {
  let badgeContainer = document.getElementById('c3-file-badges');
  if (!badgeContainer) {
    badgeContainer = document.createElement('div');
    badgeContainer.id = 'c3-file-badges';
    badgeContainer.className = 'c3-file-badges';

    // Insert above chat input
    const chatInputArea = document.getElementById('chat-input-area');
    if (chatInputArea) {
      chatInputArea.insertAdjacentElement('afterbegin', badgeContainer);
    }
  }

  const badge = document.createElement('div');
  badge.className = 'c3-file-badge';
  badge.innerHTML = `
    <span class="c3-file-badge-icon">📄</span>
    <span class="c3-file-badge-name">${fileInfo.name}</span>
    <span class="c3-file-badge-size">${formatFileSize(fileInfo.size)}</span>
    <button class="c3-file-badge-remove" onclick="removeFileFromContext('${fileInfo.name}')" title="Remove from context">×</button>
  `;
  badgeContainer.appendChild(badge);
}

function removeFileFromContext(fileName) {
  c3State.userProvidedFiles = c3State.userProvidedFiles.filter(f => f.name !== fileName);

  // Update UI
  const badgeContainer = document.getElementById('c3-file-badges');
  if (badgeContainer) {
    const badges = badgeContainer.querySelectorAll('.c3-file-badge');
    badges.forEach(badge => {
      if (badge.querySelector('.c3-file-badge-name')?.textContent === fileName) {
        badge.remove();
      }
    });
  }

  // Update context bar
  updateContextBar({ files: c3State.loadedFiles });

  addC3Action({
    type: 'context',
    message: `Removed from context: ${fileName}`,
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// Phase B2 & B3: Diff Preview
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Show diff preview for proposed changes
 */
function showDiffPreview(changes) {
  c3State.pendingChanges = changes;

  const overlay = document.createElement('div');
  overlay.id = 'c3-diff-overlay';
  overlay.className = 'c3-diff-overlay';
  overlay.innerHTML = `
    <div class="c3-diff-modal">
      <div class="c3-diff-header">
        <h3 class="c3-diff-title">🛠️ Proposed Changes</h3>
        <button class="c3-diff-close" onclick="closeDiffPreview()">×</button>
      </div>
      <div class="c3-diff-content" id="c3-diff-content">
        ${changes.map((change, i) => renderDiffChange(change, i)).join('')}
      </div>
      <div class="c3-diff-footer">
        <div class="c3-diff-summary">
          <span class="c3-diff-additions">+${countAdditions(changes)} lines</span>
          <span class="c3-diff-deletions">-${countDeletions(changes)} lines</span>
        </div>
        <div class="c3-diff-actions">
          <button class="c3-diff-btn c3-diff-btn-cancel" onclick="closeDiffPreview()">Cancel</button>
          <button class="c3-diff-btn c3-diff-btn-apply" onclick="applyChanges()">Apply Changes</button>
        </div>
      </div>
    </div>
  `;

  document.body.appendChild(overlay);

  addC3Action({
    type: 'decision',
    message: `Showing diff preview`,
    detail: `${changes.length} file(s)`,
  });
}

function renderDiffChange(change, index) {
  const diff = generateUnifiedDiff(change.oldContent, change.newContent, change.file);

  return `
    <div class="c3-diff-file" data-index="${index}">
      <div class="c3-diff-file-header">
        <span class="c3-diff-file-icon">📄</span>
        <span class="c3-diff-file-name">${change.file}</span>
        <span class="c3-diff-file-action">${change.action || 'modified'}</span>
      </div>
      <div class="c3-diff-lines">
        ${diff}
      </div>
    </div>
  `;
}

function generateUnifiedDiff(oldContent, newContent, fileName) {
  const oldLines = (oldContent || '').split('\n');
  const newLines = (newContent || '').split('\n');

  let html = '';
  const context = 3; // Lines of context

  // Simple diff: show changed lines
  // For production, use a proper diff library
  const maxLen = Math.max(oldLines.length, newLines.length);

  for (let i = 0; i < maxLen; i++) {
    const oldLine = oldLines[i];
    const newLine = newLines[i];

    if (oldLine === newLine) {
      html += `<div class="c3-diff-line c3-diff-context"><span class="c3-diff-line-num">${i + 1}</span><span class="c3-diff-line-content">${escapeHtml(oldLine || '')}</span></div>`;
    } else {
      if (oldLine !== undefined) {
        html += `<div class="c3-diff-line c3-diff-deletion"><span class="c3-diff-line-num">-</span><span class="c3-diff-line-content">${escapeHtml(oldLine)}</span></div>`;
      }
      if (newLine !== undefined) {
        html += `<div class="c3-diff-line c3-diff-addition"><span class="c3-diff-line-num">+</span><span class="c3-diff-line-content">${escapeHtml(newLine)}</span></div>`;
      }
    }
  }

  return html;
}

function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

function countAdditions(changes) {
  return changes.reduce((sum, c) => sum + (c.newContent?.split('\n').length || 0), 0);
}

function countDeletions(changes) {
  return changes.reduce((sum, c) => sum + (c.oldContent?.split('\n').length || 0), 0);
}

function closeDiffPreview() {
  const overlay = document.getElementById('c3-diff-overlay');
  if (overlay) {
    overlay.remove();
  }
  c3State.pendingChanges = [];

  addC3Action({
    type: 'skip',
    message: 'Changes cancelled by user',
  });
}

async function applyChanges() {
  const changes = c3State.pendingChanges;
  if (changes.length === 0) return;

  try {
    for (const change of changes) {
      // Call API to apply change
      await window.api('POST', '/api/files/write', {
        path: change.file,
        content: change.newContent,
      });

      addC3Action({
        type: 'file_write',
        message: `Applied changes to: ${change.file}`,
      });

      // Add to audit trail
      c3State.auditTrail.push({
        timestamp: new Date().toISOString(),
        file: change.file,
        action: change.action || 'modified',
        approved: true,
      });
    }

    closeDiffPreview();
    showC3Toast('success', 'Changes Applied', `${changes.length} file(s) updated`);

  } catch (err) {
    addC3Action({
      type: 'error',
      message: `Failed to apply changes: ${err.message}`,
    });
    showC3Toast('error', 'Error', err.message);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Phase C1: Decision Trace (Debug Mode)
// ─────────────────────────────────────────────────────────────────────────────

function c3ToggleDebug() {
  c3State.debugMode = !c3State.debugMode;
  const icon = document.getElementById('c3-debug-icon');
  if (icon) {
    icon.textContent = c3State.debugMode ? '🔬' : '🔍';
  }

  document.body.classList.toggle('c3-debug-mode', c3State.debugMode);

  addC3Action({
    type: 'info',
    message: `Debug mode ${c3State.debugMode ? 'enabled' : 'disabled'}`,
  });
}

/**
 * Render decision trace for a response (shown in debug mode)
 */
function renderDecisionTrace(trace) {
  if (!c3State.debugMode) return '';

  return `
    <div class="c3-decision-trace">
      <div class="c3-decision-trace-header" onclick="this.parentElement.classList.toggle('expanded')">
        <span class="c3-decision-trace-icon">🧠</span>
        <span class="c3-decision-trace-title">Decision Trace</span>
      </div>
      <div class="c3-decision-trace-content">
        ${trace.intent ? `<div class="c3-trace-item"><span class="c3-trace-label">Intent:</span> <span class="c3-trace-value">${trace.intent}</span></div>` : ''}
        ${trace.responseIntent ? `<div class="c3-trace-item"><span class="c3-trace-label">ResponseIntent:</span> <span class="c3-trace-value">${trace.responseIntent}</span></div>` : ''}
        ${trace.toolsUsed ? `<div class="c3-trace-item"><span class="c3-trace-label">Tools:</span> <span class="c3-trace-value">${trace.toolsUsed.join(', ')}</span></div>` : ''}
        ${trace.relevanceFiltered ? `<div class="c3-trace-item"><span class="c3-trace-label">Relevance:</span> <span class="c3-trace-value">${trace.relevanceFiltered}</span></div>` : ''}
        ${trace.sourceTrust ? `<div class="c3-trace-item"><span class="c3-trace-label">Source Trust:</span> <span class="c3-trace-value">${trace.sourceTrust}</span></div>` : ''}
        ${trace.confidence ? `<div class="c3-trace-item"><span class="c3-trace-label">Confidence:</span> <span class="c3-trace-value">${trace.confidence}</span></div>` : ''}
      </div>
    </div>
  `;
}

// ─────────────────────────────────────────────────────────────────────────────
// Toast Notifications
// ─────────────────────────────────────────────────────────────────────────────

function showC3Toast(type, title, message) {
  let container = document.getElementById('c3-toast-container');
  if (!container) {
    container = document.createElement('div');
    container.id = 'c3-toast-container';
    container.className = 'c3-toast-container';
    document.body.appendChild(container);
  }

  const icons = { success: '✅', error: '❌', info: '💬', warning: '⚠️' };

  const toast = document.createElement('div');
  toast.className = `c3-toast c3-toast-${type}`;
  toast.innerHTML = `
    <span class="c3-toast-icon">${icons[type] || '💬'}</span>
    <div class="c3-toast-content">
      <div class="c3-toast-title">${title}</div>
      <div class="c3-toast-message">${message}</div>
    </div>
  `;

  container.appendChild(toast);

  // Auto-remove after 4s
  setTimeout(() => {
    toast.classList.add('c3-toast-fade');
    setTimeout(() => toast.remove(), 300);
  }, 4000);
}

// ─────────────────────────────────────────────────────────────────────────────
// API Integration Hooks
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Hook into chat response to update C3 state
 */
function processC3Response(response) {
  if (!response) return;

  // Update from metadata
  const meta = response.metadata || {};

  if (meta.intent) {
    updateContextBar({ intent: meta.intent });
    addC3Action({
      type: 'intent',
      message: `Intent: ${meta.intent}`,
    });
  }

  if (meta.responseIntent) {
    addC3Action({
      type: 'decision',
      message: `Response format: ${meta.responseIntent}`,
    });
  }

  if (meta.toolsUsed && meta.toolsUsed.length > 0) {
    updateContextBar({ modules: meta.toolsUsed });
    for (const tool of meta.toolsUsed) {
      addC3Action({
        type: 'tool',
        message: `Used: ${tool}`,
      });
    }
  }

  if (meta.relevanceStats) {
    addC3Action({
      type: 'decision',
      message: `Relevance filter: ${meta.relevanceStats.relevant}/${meta.relevanceStats.total} sources`,
    });
  }

  // Check for pending file changes
  if (meta.pendingChanges && meta.pendingChanges.length > 0) {
    showDiffPreview(meta.pendingChanges);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Initialization
// ─────────────────────────────────────────────────────────────────────────────

function initC3Visibility() {
  // Create UI components
  createContextBar();
  createActionLog();
  initDragDrop();

  // Initial state
  addC3Action({
    type: 'info',
    message: 'C3 Visibility Layer initialized',
  });

  console.log('[C3] Visibility layer initialized');
}

// Export for global access
window.c3State = c3State;
window.updateContextBar = updateContextBar;
window.addC3Action = addC3Action;
window.c3ToggleActionLog = c3ToggleActionLog;
window.c3ToggleDebug = c3ToggleDebug;
window.showDiffPreview = showDiffPreview;
window.closeDiffPreview = closeDiffPreview;
window.applyChanges = applyChanges;
window.processC3Response = processC3Response;
window.removeFileFromContext = removeFileFromContext;
window.showC3Toast = showC3Toast;
window.renderDecisionTrace = renderDecisionTrace;

// Auto-init when DOM ready
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initC3Visibility);
} else {
  initC3Visibility();
}
