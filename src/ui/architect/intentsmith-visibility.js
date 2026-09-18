// ═══════════════════════════════════════════════════════════════════════════════
// IntentSmith Visibility Layer - Transparency & Control UI Components
// ═══════════════════════════════════════════════════════════════════════════════
//
// Phase A: Visibility (read-only)
//   A1: Context Bar - workspace, files, mode, intent
//   A2: Live Action Log - "What IntentSmith is doing"
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

const intentsmithState = {
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
 * Create and inject the IntentSmith Context Bar
 */
function createContextBar() {
  const bar = document.createElement('div');
  bar.id = 'intentsmith-context-bar';
  bar.className = 'intentsmith-context-bar';
  bar.innerHTML = `
    <div class="intentsmith-context-section" id="intentsmith-workspace">
      <span class="intentsmith-context-icon">📁</span>
      <span class="intentsmith-context-label">Workspace</span>
      <span class="intentsmith-context-value" id="intentsmith-workspace-value">—</span>
    </div>

    <div class="intentsmith-context-divider"></div>

    <div class="intentsmith-context-section" id="intentsmith-files">
      <span class="intentsmith-context-icon">📄</span>
      <span class="intentsmith-context-label">Context</span>
      <span class="intentsmith-context-value" id="intentsmith-files-count">0 files</span>
    </div>

    <div class="intentsmith-context-divider"></div>

    <div class="intentsmith-context-section" id="intentsmith-mode">
      <span class="intentsmith-context-icon">⚙️</span>
      <span class="intentsmith-context-label">Mode</span>
      <span class="intentsmith-context-value intentsmith-badge" id="intentsmith-mode-value">CHAT</span>
    </div>

    <div class="intentsmith-context-divider"></div>

    <div class="intentsmith-context-section" id="intentsmith-intent">
      <span class="intentsmith-context-icon">🎯</span>
      <span class="intentsmith-context-label">Intent</span>
      <span class="intentsmith-context-value intentsmith-badge" id="intentsmith-intent-value">—</span>
    </div>

    <div class="intentsmith-context-spacer"></div>

    <div class="intentsmith-context-section intentsmith-modules" id="intentsmith-modules">
      <span class="intentsmith-context-icon">🔗</span>
      <span class="intentsmith-modules-list" id="intentsmith-modules-list"></span>
    </div>

    <button class="intentsmith-context-toggle" id="intentsmith-debug-toggle" onclick="intentsmithToggleDebug()" title="Toggle debug mode">
      <span id="intentsmith-debug-icon">🔍</span>
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
    intentsmithState.workspace = data.workspace;
    const wsEl = document.getElementById('intentsmith-workspace-value');
    if (wsEl) {
      wsEl.textContent = data.workspace || '—';
      wsEl.title = data.workspace || '';
    }
  }

  // Files count
  if (data.files !== undefined) {
    intentsmithState.loadedFiles = data.files;
    const filesEl = document.getElementById('intentsmith-files-count');
    if (filesEl) {
      const count = data.files.length + intentsmithState.userProvidedFiles.length;
      filesEl.textContent = `${count} file${count !== 1 ? 's' : ''}`;
      filesEl.title = [...data.files, ...intentsmithState.userProvidedFiles].join('\n');
    }
  }

  // Mode
  if (data.mode !== undefined) {
    intentsmithState.mode = data.mode;
    const modeEl = document.getElementById('intentsmith-mode-value');
    if (modeEl) {
      modeEl.textContent = data.mode;
      modeEl.className = `intentsmith-context-value intentsmith-badge intentsmith-badge-${data.mode.toLowerCase()}`;
    }
  }

  // Intent
  if (data.intent !== undefined) {
    intentsmithState.currentIntent = data.intent;
    const intentEl = document.getElementById('intentsmith-intent-value');
    if (intentEl) {
      intentEl.textContent = data.intent || '—';
      intentEl.className = `intentsmith-context-value intentsmith-badge intentsmith-badge-${(data.intent || 'none').toLowerCase()}`;
    }
  }

  // Active modules
  if (data.modules !== undefined) {
    intentsmithState.activeModules = data.modules;
    const modulesEl = document.getElementById('intentsmith-modules-list');
    if (modulesEl) {
      modulesEl.innerHTML = data.modules.map(m =>
        `<span class="intentsmith-module-chip" title="${m}">${getModuleIcon(m)}</span>`
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
  container.id = 'intentsmith-action-log';
  container.className = 'intentsmith-action-log collapsed';
  container.innerHTML = `
    <button class="intentsmith-action-log-header" onclick="intentsmithToggleActionLog()">
      <span class="intentsmith-action-log-icon">▸</span>
      <span class="intentsmith-action-log-title">IntentSmith Actions</span>
      <span class="intentsmith-action-log-count" id="intentsmith-action-count">(0)</span>
    </button>
    <div class="intentsmith-action-log-content" id="intentsmith-action-log-content"></div>
  `;

  // Insert below context bar
  const contextBar = document.getElementById('intentsmith-context-bar');
  if (contextBar) {
    contextBar.insertAdjacentElement('afterend', container);
  }
}

/**
 * Add action to log
 */
function addIntentSmithAction(action) {
  const entry = {
    timestamp: new Date().toISOString(),
    ...action,
  };

  intentsmithState.actionLog.unshift(entry);

  // Trim log if too long
  if (intentsmithState.actionLog.length > intentsmithState.maxLogEntries) {
    intentsmithState.actionLog.pop();
  }

  renderActionLog();
  updateActionCount();
}

/**
 * Render action log entries
 */
function renderActionLog() {
  const content = document.getElementById('intentsmith-action-log-content');
  if (!content) return;

  content.innerHTML = intentsmithState.actionLog.map(entry => `
    <div class="intentsmith-action-entry intentsmith-action-${entry.type || 'info'}">
      <span class="intentsmith-action-time">${formatTime(entry.timestamp)}</span>
      <span class="intentsmith-action-icon">${getActionIcon(entry.type)}</span>
      <span class="intentsmith-action-text">${entry.message}</span>
      ${entry.detail ? `<span class="intentsmith-action-detail">${entry.detail}</span>` : ''}
    </div>
  `).join('');
}

function updateActionCount() {
  const countEl = document.getElementById('intentsmith-action-count');
  if (countEl) {
    countEl.textContent = `(${intentsmithState.actionLog.length})`;
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

function intentsmithToggleActionLog() {
  const log = document.getElementById('intentsmith-action-log');
  const icon = log?.querySelector('.intentsmith-action-log-icon');
  if (log) {
    intentsmithState.actionLogExpanded = !intentsmithState.actionLogExpanded;
    log.classList.toggle('collapsed', !intentsmithState.actionLogExpanded);
    if (icon) {
      icon.textContent = intentsmithState.actionLogExpanded ? '▾' : '▸';
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
  dropZone.id = 'intentsmith-drop-zone';
  dropZone.className = 'intentsmith-drop-zone';
  dropZone.innerHTML = `
    <div class="intentsmith-drop-zone-content">
      <span class="intentsmith-drop-zone-icon">📄</span>
      <span class="intentsmith-drop-zone-text">Drop file to add to context</span>
      <span class="intentsmith-drop-zone-hint">File will be loaded but NOT modified</span>
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
  const dropZone = document.getElementById('intentsmith-drop-zone');
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
    const dropZone = document.getElementById('intentsmith-drop-zone');
    if (dropZone) {
      dropZone.classList.remove('active');
    }
  }
}

async function handleDrop(e) {
  e.preventDefault();
  const dropZone = document.getElementById('intentsmith-drop-zone');
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
    intentsmithState.userProvidedFiles.push(fileInfo);

    // Log action
    addIntentSmithAction({
      type: 'file_add',
      message: `Added to context: ${file.name}`,
      detail: `${formatFileSize(file.size)}`,
    });

    // Update context bar
    updateContextBar({ files: intentsmithState.loadedFiles });

    // Show toast
    showIntentSmithToast('success', 'File Added', `${file.name} added to context`);

    // Show file badge in chat input area
    showFileContextBadge(fileInfo);

  } catch (err) {
    addIntentSmithAction({
      type: 'error',
      message: `Failed to read file: ${file.name}`,
      detail: err.message,
    });
    showIntentSmithToast('error', 'Error', `Failed to read ${file.name}`);
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
  let badgeContainer = document.getElementById('intentsmith-file-badges');
  if (!badgeContainer) {
    badgeContainer = document.createElement('div');
    badgeContainer.id = 'intentsmith-file-badges';
    badgeContainer.className = 'intentsmith-file-badges';

    // Insert above chat input
    const chatInputArea = document.getElementById('chat-input-area');
    if (chatInputArea) {
      chatInputArea.insertAdjacentElement('afterbegin', badgeContainer);
    }
  }

  const badge = document.createElement('div');
  badge.className = 'intentsmith-file-badge';
  badge.innerHTML = `
    <span class="intentsmith-file-badge-icon">📄</span>
    <span class="intentsmith-file-badge-name">${fileInfo.name}</span>
    <span class="intentsmith-file-badge-size">${formatFileSize(fileInfo.size)}</span>
    <button class="intentsmith-file-badge-remove" onclick="removeFileFromContext('${fileInfo.name}')" title="Remove from context">×</button>
  `;
  badgeContainer.appendChild(badge);
}

function removeFileFromContext(fileName) {
  intentsmithState.userProvidedFiles = intentsmithState.userProvidedFiles.filter(f => f.name !== fileName);

  // Update UI
  const badgeContainer = document.getElementById('intentsmith-file-badges');
  if (badgeContainer) {
    const badges = badgeContainer.querySelectorAll('.intentsmith-file-badge');
    badges.forEach(badge => {
      if (badge.querySelector('.intentsmith-file-badge-name')?.textContent === fileName) {
        badge.remove();
      }
    });
  }

  // Update context bar
  updateContextBar({ files: intentsmithState.loadedFiles });

  addIntentSmithAction({
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
  intentsmithState.pendingChanges = changes;

  const overlay = document.createElement('div');
  overlay.id = 'intentsmith-diff-overlay';
  overlay.className = 'intentsmith-diff-overlay';
  overlay.innerHTML = `
    <div class="intentsmith-diff-modal">
      <div class="intentsmith-diff-header">
        <h3 class="intentsmith-diff-title">🛠️ Proposed Changes</h3>
        <button class="intentsmith-diff-close" onclick="closeDiffPreview()">×</button>
      </div>
      <div class="intentsmith-diff-content" id="intentsmith-diff-content">
        ${changes.map((change, i) => renderDiffChange(change, i)).join('')}
      </div>
      <div class="intentsmith-diff-footer">
        <div class="intentsmith-diff-summary">
          <span class="intentsmith-diff-additions">+${countAdditions(changes)} lines</span>
          <span class="intentsmith-diff-deletions">-${countDeletions(changes)} lines</span>
        </div>
        <div class="intentsmith-diff-actions">
          <button class="intentsmith-diff-btn intentsmith-diff-btn-cancel" onclick="closeDiffPreview()">Cancel</button>
          <button class="intentsmith-diff-btn intentsmith-diff-btn-apply" onclick="applyChanges()">Apply Changes</button>
        </div>
      </div>
    </div>
  `;

  document.body.appendChild(overlay);

  addIntentSmithAction({
    type: 'decision',
    message: `Showing diff preview`,
    detail: `${changes.length} file(s)`,
  });
}

function renderDiffChange(change, index) {
  const diff = generateUnifiedDiff(change.oldContent, change.newContent, change.file);

  return `
    <div class="intentsmith-diff-file" data-index="${index}">
      <div class="intentsmith-diff-file-header">
        <span class="intentsmith-diff-file-icon">📄</span>
        <span class="intentsmith-diff-file-name">${change.file}</span>
        <span class="intentsmith-diff-file-action">${change.action || 'modified'}</span>
      </div>
      <div class="intentsmith-diff-lines">
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
      html += `<div class="intentsmith-diff-line intentsmith-diff-context"><span class="intentsmith-diff-line-num">${i + 1}</span><span class="intentsmith-diff-line-content">${escapeHtml(oldLine || '')}</span></div>`;
    } else {
      if (oldLine !== undefined) {
        html += `<div class="intentsmith-diff-line intentsmith-diff-deletion"><span class="intentsmith-diff-line-num">-</span><span class="intentsmith-diff-line-content">${escapeHtml(oldLine)}</span></div>`;
      }
      if (newLine !== undefined) {
        html += `<div class="intentsmith-diff-line intentsmith-diff-addition"><span class="intentsmith-diff-line-num">+</span><span class="intentsmith-diff-line-content">${escapeHtml(newLine)}</span></div>`;
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
  const overlay = document.getElementById('intentsmith-diff-overlay');
  if (overlay) {
    overlay.remove();
  }
  intentsmithState.pendingChanges = [];

  addIntentSmithAction({
    type: 'skip',
    message: 'Changes cancelled by user',
  });
}

async function applyChanges() {
  const changes = intentsmithState.pendingChanges;
  if (changes.length === 0) return;

  try {
    for (const change of changes) {
      // Call API to apply change
      await window.api('POST', '/api/files/write', {
        path: change.file,
        content: change.newContent,
      });

      addIntentSmithAction({
        type: 'file_write',
        message: `Applied changes to: ${change.file}`,
      });

      // Add to audit trail
      intentsmithState.auditTrail.push({
        timestamp: new Date().toISOString(),
        file: change.file,
        action: change.action || 'modified',
        approved: true,
      });
    }

    closeDiffPreview();
    showIntentSmithToast('success', 'Changes Applied', `${changes.length} file(s) updated`);

  } catch (err) {
    addIntentSmithAction({
      type: 'error',
      message: `Failed to apply changes: ${err.message}`,
    });
    showIntentSmithToast('error', 'Error', err.message);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Phase C1: Decision Trace (Debug Mode)
// ─────────────────────────────────────────────────────────────────────────────

function intentsmithToggleDebug() {
  intentsmithState.debugMode = !intentsmithState.debugMode;
  const icon = document.getElementById('intentsmith-debug-icon');
  if (icon) {
    icon.textContent = intentsmithState.debugMode ? '🔬' : '🔍';
  }

  document.body.classList.toggle('intentsmith-debug-mode', intentsmithState.debugMode);

  addIntentSmithAction({
    type: 'info',
    message: `Debug mode ${intentsmithState.debugMode ? 'enabled' : 'disabled'}`,
  });
}

/**
 * Render decision trace for a response (shown in debug mode)
 */
function renderDecisionTrace(trace) {
  if (!intentsmithState.debugMode) return '';

  return `
    <div class="intentsmith-decision-trace">
      <div class="intentsmith-decision-trace-header" onclick="this.parentElement.classList.toggle('expanded')">
        <span class="intentsmith-decision-trace-icon">🧠</span>
        <span class="intentsmith-decision-trace-title">Decision Trace</span>
      </div>
      <div class="intentsmith-decision-trace-content">
        ${trace.intent ? `<div class="intentsmith-trace-item"><span class="intentsmith-trace-label">Intent:</span> <span class="intentsmith-trace-value">${trace.intent}</span></div>` : ''}
        ${trace.responseIntent ? `<div class="intentsmith-trace-item"><span class="intentsmith-trace-label">ResponseIntent:</span> <span class="intentsmith-trace-value">${trace.responseIntent}</span></div>` : ''}
        ${trace.toolsUsed ? `<div class="intentsmith-trace-item"><span class="intentsmith-trace-label">Tools:</span> <span class="intentsmith-trace-value">${trace.toolsUsed.join(', ')}</span></div>` : ''}
        ${trace.relevanceFiltered ? `<div class="intentsmith-trace-item"><span class="intentsmith-trace-label">Relevance:</span> <span class="intentsmith-trace-value">${trace.relevanceFiltered}</span></div>` : ''}
        ${trace.sourceTrust ? `<div class="intentsmith-trace-item"><span class="intentsmith-trace-label">Source Trust:</span> <span class="intentsmith-trace-value">${trace.sourceTrust}</span></div>` : ''}
        ${trace.confidence ? `<div class="intentsmith-trace-item"><span class="intentsmith-trace-label">Confidence:</span> <span class="intentsmith-trace-value">${trace.confidence}</span></div>` : ''}
      </div>
    </div>
  `;
}

// ─────────────────────────────────────────────────────────────────────────────
// Toast Notifications
// ─────────────────────────────────────────────────────────────────────────────

function showIntentSmithToast(type, title, message) {
  let container = document.getElementById('intentsmith-toast-container');
  if (!container) {
    container = document.createElement('div');
    container.id = 'intentsmith-toast-container';
    container.className = 'intentsmith-toast-container';
    document.body.appendChild(container);
  }

  const icons = { success: '✅', error: '❌', info: '💬', warning: '⚠️' };

  const toast = document.createElement('div');
  toast.className = `intentsmith-toast intentsmith-toast-${type}`;
  toast.innerHTML = `
    <span class="intentsmith-toast-icon">${icons[type] || '💬'}</span>
    <div class="intentsmith-toast-content">
      <div class="intentsmith-toast-title">${title}</div>
      <div class="intentsmith-toast-message">${message}</div>
    </div>
  `;

  container.appendChild(toast);

  // Auto-remove after 4s
  setTimeout(() => {
    toast.classList.add('intentsmith-toast-fade');
    setTimeout(() => toast.remove(), 300);
  }, 4000);
}

// ─────────────────────────────────────────────────────────────────────────────
// API Integration Hooks
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Hook into chat response to update IntentSmith state
 */
function processIntentSmithResponse(response) {
  if (!response) return;

  // Update from metadata
  const meta = response.metadata || {};

  if (meta.intent) {
    updateContextBar({ intent: meta.intent });
    addIntentSmithAction({
      type: 'intent',
      message: `Intent: ${meta.intent}`,
    });
  }

  if (meta.responseIntent) {
    addIntentSmithAction({
      type: 'decision',
      message: `Response format: ${meta.responseIntent}`,
    });
  }

  if (meta.toolsUsed && meta.toolsUsed.length > 0) {
    updateContextBar({ modules: meta.toolsUsed });
    for (const tool of meta.toolsUsed) {
      addIntentSmithAction({
        type: 'tool',
        message: `Used: ${tool}`,
      });
    }
  }

  if (meta.relevanceStats) {
    addIntentSmithAction({
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

function initIntentSmithVisibility() {
  // Create UI components
  createContextBar();
  createActionLog();
  initDragDrop();

  // Initial state
  addIntentSmithAction({
    type: 'info',
    message: 'IntentSmith Visibility Layer initialized',
  });

  console.log('[IntentSmith] Visibility layer initialized');
}

// Export for global access
window.intentsmithState = intentsmithState;
window.updateContextBar = updateContextBar;
window.addIntentSmithAction = addIntentSmithAction;
window.intentsmithToggleActionLog = intentsmithToggleActionLog;
window.intentsmithToggleDebug = intentsmithToggleDebug;
window.showDiffPreview = showDiffPreview;
window.closeDiffPreview = closeDiffPreview;
window.applyChanges = applyChanges;
window.processIntentSmithResponse = processIntentSmithResponse;
window.removeFileFromContext = removeFileFromContext;
window.showIntentSmithToast = showIntentSmithToast;
window.renderDecisionTrace = renderDecisionTrace;

// Auto-init when DOM ready
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initIntentSmithVisibility);
} else {
  initIntentSmithVisibility();
}
