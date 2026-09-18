/**
 * @intentsmith/settings — Protocol (common)
 *
 * All IntentSmith preference keys registered in Theia Preferences.
 * Read via PreferenceService.get('intentsmith.backend.url').
 */

export const INTENTSMITH_SETTINGS_SECTION = 'intentsmith';

export interface IntentSmithSettings {
  // Backend
  'intentsmith.backend.url': string;
  'intentsmith.backend.autoReconnect': boolean;
  'intentsmith.backend.reconnectMaxDelay': number;

  // Chat
  'intentsmith.chat.fontSize': number;
  'intentsmith.chat.showIntentBadges': boolean;
  'intentsmith.chat.showTimestamps': boolean;
  'intentsmith.chat.maxHistory': number;

  // Agent
  'intentsmith.agent.autoScroll': boolean;
  'intentsmith.agent.verbosity': 'minimal' | 'normal' | 'verbose';
  'intentsmith.agent.showTokenCounts': boolean;

  // Shell
  'intentsmith.shell.timeout': number;
  'intentsmith.shell.maxOutput': number;

  // Project
  'intentsmith.project.autoSaveInterval': number;
  'intentsmith.project.gitAutoCommit': boolean;

  // Export
  'intentsmith.export.includeChat': boolean;
  'intentsmith.export.includeAgentLog': boolean;
  'intentsmith.export.includeSrc': boolean;

  // Features
  'intentsmith.features.agents': boolean;
  'intentsmith.features.lifecycle': boolean;
  'intentsmith.features.expertises': boolean;
  'intentsmith.features.telemetry': boolean;
  'intentsmith.features.specialistTelemetry': boolean;
  'intentsmith.features.autonomy': boolean;
  'intentsmith.features.skills': boolean;

  // UI
  'intentsmith.language': 'cs' | 'en';
  'intentsmith.theme': 'dark' | 'light';

  // ─── v87: LLM Settings ──────────────────────────────
  'intentsmith.llm.chatModel': string;
  'intentsmith.llm.codeModel': string;
  'intentsmith.llm.visionModel': string;
  'intentsmith.llm.ollamaUrl': string;
  'intentsmith.llm.temperature': number;
  'intentsmith.llm.contextWindow': number;
  'intentsmith.llm.timeoutChat': number;
  'intentsmith.llm.timeoutCode': number;
  'intentsmith.llm.numGpu': number;

  // ─── v87: Memory & Context ──────────────────────────
  'intentsmith.memory.conversationMaxTurns': number;
  'intentsmith.memory.compactThreshold': number;
  'intentsmith.memory.compactKeepTurns': number;
  'intentsmith.memory.ltmEnabled': boolean;
  'intentsmith.memory.ltmMaxEntries': number;
  'intentsmith.memory.ltmDecayHalfLife': number;
  'intentsmith.memory.contextBudgetChat': number;
  'intentsmith.memory.contextBudgetCode': number;
  'intentsmith.memory.contextBudgetMaxTokens': number;
  'intentsmith.memory.learningEnabled': boolean;
  'intentsmith.memory.feedbackDetection': boolean;
  'intentsmith.memory.patternTracking': boolean;

  // ─── v87: Account / Identity ────────────────────────
  'intentsmith.account.displayName': string;
  'intentsmith.account.description': string;
  'intentsmith.account.timezone': string;
  'intentsmith.account.currency': string;

  // ─── v87: System ────────────────────────────────────
  'intentsmith.system.logLevel': 'debug' | 'info' | 'warn' | 'error';
  'intentsmith.system.logRetentionDays': number;
  'intentsmith.system.maxFileSize': number;
  'intentsmith.system.rateLimit': number;

  // ─── v87: Output ────────────────────────────────────
  'intentsmith.output.codeBlocks': boolean;
  'intentsmith.output.syntaxHighlight': boolean;
  'intentsmith.output.markdownRendering': boolean;
  'intentsmith.output.maxResponseLength': number;

  // ─── v87 P2: Appearance ───────────────────────────
  'intentsmith.appearance.density': 'comfortable' | 'compact' | 'minimal';
  'intentsmith.appearance.uiScale': string;

  // ─── v87 P2: Notifications ────────────────────────
  'intentsmith.notif.desktopEnabled': boolean;
  'intentsmith.notif.quietEnabled': boolean;
  'intentsmith.notif.quietFrom': string;
  'intentsmith.notif.quietTo': string;

  // ─── v93: Email Notifications ─────────────────────
  'intentsmith.notif.emailEnabled': boolean;
  'intentsmith.notif.smtpHost': string;
  'intentsmith.notif.smtpPort': number;
  'intentsmith.notif.smtpUser': string;
  'intentsmith.notif.smtpFrom': string;
  'intentsmith.notif.emailRecipient': string;
  'intentsmith.notif.emailOnLifecycle': boolean;
  'intentsmith.notif.emailOnWorker': boolean;
}

export const INTENTSMITH_DEFAULTS: IntentSmithSettings = {
  'intentsmith.backend.url': 'ws://localhost:3001/intentsmith/ws',
  'intentsmith.backend.autoReconnect': true,
  'intentsmith.backend.reconnectMaxDelay': 30000,

  'intentsmith.chat.fontSize': 14,
  'intentsmith.chat.showIntentBadges': true,
  'intentsmith.chat.showTimestamps': false,
  'intentsmith.chat.maxHistory': 500,

  'intentsmith.agent.autoScroll': true,
  'intentsmith.agent.verbosity': 'normal',
  'intentsmith.agent.showTokenCounts': false,

  'intentsmith.shell.timeout': 30000,
  'intentsmith.shell.maxOutput': 65536,

  'intentsmith.project.autoSaveInterval': 60000,
  'intentsmith.project.gitAutoCommit': true,

  'intentsmith.export.includeChat': true,
  'intentsmith.export.includeAgentLog': false,
  'intentsmith.export.includeSrc': true,

  'intentsmith.features.agents': true,
  'intentsmith.features.lifecycle': true,
  'intentsmith.features.expertises': true,
  'intentsmith.features.telemetry': true,
  'intentsmith.features.specialistTelemetry': true,
  'intentsmith.features.autonomy': false,
  'intentsmith.features.skills': true,

  'intentsmith.language': 'cs',
  'intentsmith.theme': 'dark',

  // v87: LLM Settings
  'intentsmith.llm.chatModel': 'qwen3.5:27b',
  'intentsmith.llm.codeModel': 'qwen3.5:27b',
  'intentsmith.llm.visionModel': 'llava-llama3:8b',
  'intentsmith.llm.ollamaUrl': 'http://127.0.0.1:11434',
  'intentsmith.llm.temperature': 0.7,
  'intentsmith.llm.contextWindow': 32768,
  'intentsmith.llm.timeoutChat': 90000,
  'intentsmith.llm.timeoutCode': 90000,
  'intentsmith.llm.numGpu': -1,

  // v87: Memory & Context
  'intentsmith.memory.conversationMaxTurns': 500,
  'intentsmith.memory.compactThreshold': 0.75,
  'intentsmith.memory.compactKeepTurns': 6,
  'intentsmith.memory.ltmEnabled': true,
  'intentsmith.memory.ltmMaxEntries': 1000,
  'intentsmith.memory.ltmDecayHalfLife': 69,
  'intentsmith.memory.contextBudgetChat': 60,
  'intentsmith.memory.contextBudgetCode': 40,
  'intentsmith.memory.contextBudgetMaxTokens': 24576,
  'intentsmith.memory.learningEnabled': true,
  'intentsmith.memory.feedbackDetection': true,
  'intentsmith.memory.patternTracking': true,

  // v87: Account / Identity
  'intentsmith.account.displayName': '',
  'intentsmith.account.description': '',
  'intentsmith.account.timezone': 'Europe/Prague',
  'intentsmith.account.currency': 'CZK',

  // v87: System
  'intentsmith.system.logLevel': 'info',
  'intentsmith.system.logRetentionDays': 30,
  'intentsmith.system.maxFileSize': 1048576,
  'intentsmith.system.rateLimit': 120,

  // v87: Output
  'intentsmith.output.codeBlocks': true,
  'intentsmith.output.syntaxHighlight': true,
  'intentsmith.output.markdownRendering': true,
  'intentsmith.output.maxResponseLength': 8192,

  // v87 P2: Appearance
  'intentsmith.appearance.density': 'comfortable',
  'intentsmith.appearance.uiScale': '1.0',

  // v87 P2: Notifications
  'intentsmith.notif.desktopEnabled': true,
  'intentsmith.notif.quietEnabled': false,
  'intentsmith.notif.quietFrom': '22:00',
  'intentsmith.notif.quietTo': '07:00',

  // v93: Email Notifications
  'intentsmith.notif.emailEnabled': false,
  'intentsmith.notif.smtpHost': '',
  'intentsmith.notif.smtpPort': 587,
  'intentsmith.notif.smtpUser': '',
  'intentsmith.notif.smtpFrom': '',
  'intentsmith.notif.emailRecipient': '',
  'intentsmith.notif.emailOnLifecycle': true,
  'intentsmith.notif.emailOnWorker': true,
};
