/**
 * @c3/settings — Theia Preferences Contribution
 *
 * Registers all c3.* preference keys in Theia's PreferenceService.
 * Users can edit these in Settings UI or settings.json.
 */

import { injectable } from '@theia/core/shared/inversify';
import {
  FrontendApplicationContribution,
} from '@theia/core/lib/browser';
import { C3_DEFAULTS } from '../common/settings-protocol';

/**
 * Preference schema for all C3 settings.
 * Theia registers these via PreferenceContribution in the DI module.
 */
export const C3_PREFERENCE_SCHEMA = {
  type: 'object' as const,
  properties: {
    // ─── Backend ───────────────────────────────────────
    'c3.backend.url': {
      type: 'string',
      default: C3_DEFAULTS['c3.backend.url'],
      description: 'WebSocket URL pro připojení k C3 backendu.',
    },
    'c3.backend.autoReconnect': {
      type: 'boolean',
      default: C3_DEFAULTS['c3.backend.autoReconnect'],
      description: 'Automaticky se znovu připojit při výpadku.',
    },
    'c3.backend.reconnectMaxDelay': {
      type: 'number',
      default: C3_DEFAULTS['c3.backend.reconnectMaxDelay'],
      minimum: 1000,
      maximum: 120000,
      description: 'Maximální prodleva mezi pokusy o připojení (ms).',
    },

    // ─── Chat ──────────────────────────────────────────
    'c3.chat.fontSize': {
      type: 'number',
      default: C3_DEFAULTS['c3.chat.fontSize'],
      minimum: 10,
      maximum: 24,
      description: 'Velikost písma v chat panelu.',
    },
    'c3.chat.showIntentBadges': {
      type: 'boolean',
      default: C3_DEFAULTS['c3.chat.showIntentBadges'],
      description: 'Zobrazit intent badge u zpráv (DESIGN, BUILD, ...).',
    },
    'c3.chat.showTimestamps': {
      type: 'boolean',
      default: C3_DEFAULTS['c3.chat.showTimestamps'],
      description: 'Zobrazit časové značky u zpráv.',
    },
    'c3.chat.maxHistory': {
      type: 'number',
      default: C3_DEFAULTS['c3.chat.maxHistory'],
      minimum: 50,
      maximum: 5000,
      description: 'Maximální počet zpráv v chat historii.',
    },

    // ─── Agent ─────────────────────────────────────────
    'c3.agent.autoScroll': {
      type: 'boolean',
      default: C3_DEFAULTS['c3.agent.autoScroll'],
      description: 'Automaticky scrollovat Agent Log na nové eventy.',
    },
    'c3.agent.verbosity': {
      type: 'string',
      default: C3_DEFAULTS['c3.agent.verbosity'],
      enum: ['minimal', 'normal', 'verbose'],
      description: 'Úroveň detailu v Agent Logu.',
    },
    'c3.agent.showTokenCounts': {
      type: 'boolean',
      default: C3_DEFAULTS['c3.agent.showTokenCounts'],
      description: 'Zobrazit počet tokenů u LLM volání.',
    },

    // ─── Shell ─────────────────────────────────────────
    'c3.shell.timeout': {
      type: 'number',
      default: C3_DEFAULTS['c3.shell.timeout'],
      minimum: 5000,
      maximum: 300000,
      description: 'Timeout pro shell příkazy (ms).',
    },
    'c3.shell.maxOutput': {
      type: 'number',
      default: C3_DEFAULTS['c3.shell.maxOutput'],
      minimum: 1024,
      maximum: 1048576,
      description: 'Maximální velikost shell výstupu (bytes).',
    },

    // ─── Project ───────────────────────────────────────
    'c3.project.autoSaveInterval': {
      type: 'number',
      default: C3_DEFAULTS['c3.project.autoSaveInterval'],
      minimum: 10000,
      maximum: 600000,
      description: 'Interval automatického ukládání project.json (ms).',
    },
    'c3.project.gitAutoCommit': {
      type: 'boolean',
      default: C3_DEFAULTS['c3.project.gitAutoCommit'],
      description: 'Automaticky commitnout po Accept All v code review.',
    },

    // ─── Export ────────────────────────────────────────
    'c3.export.includeChat': {
      type: 'boolean',
      default: C3_DEFAULTS['c3.export.includeChat'],
      description: 'Zahrnout chat historii do exportu.',
    },
    'c3.export.includeAgentLog': {
      type: 'boolean',
      default: C3_DEFAULTS['c3.export.includeAgentLog'],
      description: 'Zahrnout agent log do exportu.',
    },
    'c3.export.includeSrc': {
      type: 'boolean',
      default: C3_DEFAULTS['c3.export.includeSrc'],
      description: 'Zahrnout zdrojový kód do exportu.',
    },

    // ─── UI ────────────────────────────────────────────
    'c3.language': {
      type: 'string',
      default: C3_DEFAULTS['c3.language'],
      enum: ['cs', 'en'],
      enumDescriptions: ['Čeština', 'English'],
      description: 'Jazyk uživatelského rozhraní C3.',
    },
    'c3.theme': {
      type: 'string',
      default: C3_DEFAULTS['c3.theme'],
      enum: ['dark', 'light'],
      description: 'Barevné schéma C3 panelů.',
    },
  },
};

/**
 * Helper to read a C3 preference.
 * Usage: getC3Pref(preferenceService, 'c3.chat.fontSize')
 */
export function getC3Pref<K extends keyof typeof C3_DEFAULTS>(
  preferenceService: { get: (key: string, fallback?: any) => any },
  key: K,
): typeof C3_DEFAULTS[K] {
  return preferenceService.get(key, C3_DEFAULTS[key]);
}
