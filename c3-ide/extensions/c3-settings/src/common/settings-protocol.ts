/**
 * @c3/settings — Protocol (common)
 *
 * All C3 preference keys registered in Theia Preferences.
 * Read via PreferenceService.get('c3.backend.url').
 */

export const C3_SETTINGS_SECTION = 'c3';

export interface C3Settings {
  // Backend
  'c3.backend.url': string;
  'c3.backend.autoReconnect': boolean;
  'c3.backend.reconnectMaxDelay': number;

  // Chat
  'c3.chat.fontSize': number;
  'c3.chat.showIntentBadges': boolean;
  'c3.chat.showTimestamps': boolean;
  'c3.chat.maxHistory': number;

  // Agent
  'c3.agent.autoScroll': boolean;
  'c3.agent.verbosity': 'minimal' | 'normal' | 'verbose';
  'c3.agent.showTokenCounts': boolean;

  // Shell
  'c3.shell.timeout': number;
  'c3.shell.maxOutput': number;

  // Project
  'c3.project.autoSaveInterval': number;
  'c3.project.gitAutoCommit': boolean;

  // Export
  'c3.export.includeChat': boolean;
  'c3.export.includeAgentLog': boolean;
  'c3.export.includeSrc': boolean;

  // Features
  'c3.features.agents': boolean;
  'c3.features.lifecycle': boolean;
  'c3.features.expertises': boolean;
  'c3.features.telemetry': boolean;
  'c3.features.specialistTelemetry': boolean;
  'c3.features.autonomy': boolean;
  'c3.features.skills': boolean;

  // UI
  'c3.language': 'cs' | 'en';
  'c3.theme': 'dark' | 'light';

  // ─── v87: LLM Settings ──────────────────────────────
  'c3.llm.chatModel': string;
  'c3.llm.codeModel': string;
  'c3.llm.visionModel': string;
  'c3.llm.ollamaUrl': string;
  'c3.llm.temperature': number;
  'c3.llm.contextWindow': number;
  'c3.llm.timeoutChat': number;
  'c3.llm.timeoutCode': number;
  'c3.llm.numGpu': number;

  // ─── v87: Memory & Context ──────────────────────────
  'c3.memory.conversationMaxTurns': number;
  'c3.memory.compactThreshold': number;
  'c3.memory.compactKeepTurns': number;
  'c3.memory.ltmEnabled': boolean;
  'c3.memory.ltmMaxEntries': number;
  'c3.memory.ltmDecayHalfLife': number;
  'c3.memory.contextBudgetChat': number;
  'c3.memory.contextBudgetCode': number;
  'c3.memory.contextBudgetMaxTokens': number;
  'c3.memory.learningEnabled': boolean;
  'c3.memory.feedbackDetection': boolean;
  'c3.memory.patternTracking': boolean;

  // ─── v87: Account / Identity ────────────────────────
  'c3.account.displayName': string;
  'c3.account.description': string;
  'c3.account.timezone': string;
  'c3.account.currency': string;

  // ─── v87: System ────────────────────────────────────
  'c3.system.logLevel': 'debug' | 'info' | 'warn' | 'error';
  'c3.system.logRetentionDays': number;
  'c3.system.maxFileSize': number;
  'c3.system.rateLimit': number;

  // ─── v87: Output ────────────────────────────────────
  'c3.output.codeBlocks': boolean;
  'c3.output.syntaxHighlight': boolean;
  'c3.output.markdownRendering': boolean;
  'c3.output.maxResponseLength': number;

  // ─── v87 P2: Appearance ───────────────────────────
  'c3.appearance.density': 'comfortable' | 'compact' | 'minimal';
  'c3.appearance.uiScale': string;

  // ─── v87 P2: Notifications ────────────────────────
  'c3.notif.desktopEnabled': boolean;
  'c3.notif.quietEnabled': boolean;
  'c3.notif.quietFrom': string;
  'c3.notif.quietTo': string;

  // ─── v93: Email Notifications ─────────────────────
  'c3.notif.emailEnabled': boolean;
  'c3.notif.smtpHost': string;
  'c3.notif.smtpPort': number;
  'c3.notif.smtpUser': string;
  'c3.notif.smtpFrom': string;
  'c3.notif.emailRecipient': string;
  'c3.notif.emailOnLifecycle': boolean;
  'c3.notif.emailOnWorker': boolean;
}

export const C3_DEFAULTS: C3Settings = {
  'c3.backend.url': 'ws://localhost:3001/c3/ws',
  'c3.backend.autoReconnect': true,
  'c3.backend.reconnectMaxDelay': 30000,

  'c3.chat.fontSize': 14,
  'c3.chat.showIntentBadges': true,
  'c3.chat.showTimestamps': false,
  'c3.chat.maxHistory': 500,

  'c3.agent.autoScroll': true,
  'c3.agent.verbosity': 'normal',
  'c3.agent.showTokenCounts': false,

  'c3.shell.timeout': 30000,
  'c3.shell.maxOutput': 65536,

  'c3.project.autoSaveInterval': 60000,
  'c3.project.gitAutoCommit': true,

  'c3.export.includeChat': true,
  'c3.export.includeAgentLog': false,
  'c3.export.includeSrc': true,

  'c3.features.agents': true,
  'c3.features.lifecycle': true,
  'c3.features.expertises': true,
  'c3.features.telemetry': true,
  'c3.features.specialistTelemetry': true,
  'c3.features.autonomy': false,
  'c3.features.skills': true,

  'c3.language': 'cs',
  'c3.theme': 'dark',

  // v87: LLM Settings
  'c3.llm.chatModel': 'qwen3.5:27b',
  'c3.llm.codeModel': 'qwen3.5:27b',
  'c3.llm.visionModel': 'llava-llama3:8b',
  'c3.llm.ollamaUrl': 'http://127.0.0.1:11434',
  'c3.llm.temperature': 0.7,
  'c3.llm.contextWindow': 32768,
  'c3.llm.timeoutChat': 90000,
  'c3.llm.timeoutCode': 90000,
  'c3.llm.numGpu': -1,

  // v87: Memory & Context
  'c3.memory.conversationMaxTurns': 500,
  'c3.memory.compactThreshold': 0.75,
  'c3.memory.compactKeepTurns': 6,
  'c3.memory.ltmEnabled': true,
  'c3.memory.ltmMaxEntries': 1000,
  'c3.memory.ltmDecayHalfLife': 69,
  'c3.memory.contextBudgetChat': 60,
  'c3.memory.contextBudgetCode': 40,
  'c3.memory.contextBudgetMaxTokens': 24576,
  'c3.memory.learningEnabled': true,
  'c3.memory.feedbackDetection': true,
  'c3.memory.patternTracking': true,

  // v87: Account / Identity
  'c3.account.displayName': '',
  'c3.account.description': '',
  'c3.account.timezone': 'Europe/Prague',
  'c3.account.currency': 'CZK',

  // v87: System
  'c3.system.logLevel': 'info',
  'c3.system.logRetentionDays': 30,
  'c3.system.maxFileSize': 1048576,
  'c3.system.rateLimit': 120,

  // v87: Output
  'c3.output.codeBlocks': true,
  'c3.output.syntaxHighlight': true,
  'c3.output.markdownRendering': true,
  'c3.output.maxResponseLength': 8192,

  // v87 P2: Appearance
  'c3.appearance.density': 'comfortable',
  'c3.appearance.uiScale': '1.0',

  // v87 P2: Notifications
  'c3.notif.desktopEnabled': true,
  'c3.notif.quietEnabled': false,
  'c3.notif.quietFrom': '22:00',
  'c3.notif.quietTo': '07:00',

  // v93: Email Notifications
  'c3.notif.emailEnabled': false,
  'c3.notif.smtpHost': '',
  'c3.notif.smtpPort': 587,
  'c3.notif.smtpUser': '',
  'c3.notif.smtpFrom': '',
  'c3.notif.emailRecipient': '',
  'c3.notif.emailOnLifecycle': true,
  'c3.notif.emailOnWorker': true,
};
