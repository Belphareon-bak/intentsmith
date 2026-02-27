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
  'c3.features.skills': boolean;

  // UI
  'c3.language': 'cs' | 'en';
  'c3.theme': 'dark' | 'light';
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

  'c3.features.skills': true,

  'c3.language': 'cs',
  'c3.theme': 'dark',
};
