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

    // ─── Features ─────────────────────────────────────
    'c3.features.skills': {
      type: 'boolean',
      default: C3_DEFAULTS['c3.features.skills'],
      description: 'Povolit systém skillů — automatické rozpoznání a spouštění opakujících se postupů (v85).',
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

    // ─── v87: LLM Settings ────────────────────────────
    'c3.llm.chatModel': {
      type: 'string',
      default: C3_DEFAULTS['c3.llm.chatModel'],
      description: 'Hlavní model pro chat a syntézu.',
    },
    'c3.llm.codeModel': {
      type: 'string',
      default: C3_DEFAULTS['c3.llm.codeModel'],
      description: 'Model pro generování kódu.',
    },
    'c3.llm.visionModel': {
      type: 'string',
      default: C3_DEFAULTS['c3.llm.visionModel'],
      description: 'Model pro analýzu obrázků.',
    },
    'c3.llm.ollamaUrl': {
      type: 'string',
      default: C3_DEFAULTS['c3.llm.ollamaUrl'],
      description: 'URL adresa Ollama serveru.',
    },
    'c3.llm.temperature': {
      type: 'number',
      default: C3_DEFAULTS['c3.llm.temperature'],
      minimum: 0,
      maximum: 2,
      description: 'Teplota generování (0 = deterministický, 2 = kreativní).',
    },
    'c3.llm.contextWindow': {
      type: 'number',
      default: C3_DEFAULTS['c3.llm.contextWindow'],
      minimum: 2048,
      maximum: 131072,
      description: 'Velikost kontextového okna modelu (tokeny).',
    },
    'c3.llm.timeoutChat': {
      type: 'number',
      default: C3_DEFAULTS['c3.llm.timeoutChat'],
      minimum: 10000,
      maximum: 300000,
      description: 'Timeout pro chat volání (ms).',
    },
    'c3.llm.timeoutCode': {
      type: 'number',
      default: C3_DEFAULTS['c3.llm.timeoutCode'],
      minimum: 10000,
      maximum: 300000,
      description: 'Timeout pro code generování (ms).',
    },
    'c3.llm.numGpu': {
      type: 'number',
      default: C3_DEFAULTS['c3.llm.numGpu'],
      minimum: -1,
      maximum: 8,
      description: 'Počet GPU vrstev (-1 = auto, 0 = CPU only).',
    },

    // ─── v87: Memory & Context ────────────────────────
    'c3.memory.conversationMaxTurns': {
      type: 'number',
      default: C3_DEFAULTS['c3.memory.conversationMaxTurns'],
      minimum: 50,
      maximum: 5000,
      description: 'Maximální počet turnů v konverzaci.',
    },
    'c3.memory.compactThreshold': {
      type: 'number',
      default: C3_DEFAULTS['c3.memory.compactThreshold'],
      minimum: 0.3,
      maximum: 0.95,
      description: 'Práh pro automatickou kompakci kontextu (0-1).',
    },
    'c3.memory.compactKeepTurns': {
      type: 'number',
      default: C3_DEFAULTS['c3.memory.compactKeepTurns'],
      minimum: 2,
      maximum: 20,
      description: 'Počet posledních turnů uchovaných při kompakci.',
    },
    'c3.memory.ltmEnabled': {
      type: 'boolean',
      default: C3_DEFAULTS['c3.memory.ltmEnabled'],
      description: 'Povolit dlouhodobou paměť (LTM).',
    },
    'c3.memory.ltmMaxEntries': {
      type: 'number',
      default: C3_DEFAULTS['c3.memory.ltmMaxEntries'],
      minimum: 100,
      maximum: 10000,
      description: 'Maximální počet záznamů v LTM.',
    },
    'c3.memory.ltmDecayHalfLife': {
      type: 'number',
      default: C3_DEFAULTS['c3.memory.ltmDecayHalfLife'],
      minimum: 7,
      maximum: 365,
      description: 'Poločas rozpadu důvěryhodnosti LTM (dny).',
    },
    'c3.memory.contextBudgetChat': {
      type: 'number',
      default: C3_DEFAULTS['c3.memory.contextBudgetChat'],
      minimum: 10,
      maximum: 90,
      description: 'Budget kontextu pro chat (% z kontextového okna).',
    },
    'c3.memory.contextBudgetCode': {
      type: 'number',
      default: C3_DEFAULTS['c3.memory.contextBudgetCode'],
      minimum: 10,
      maximum: 90,
      description: 'Budget kontextu pro kód (% z kontextového okna).',
    },
    'c3.memory.contextBudgetMaxTokens': {
      type: 'number',
      default: C3_DEFAULTS['c3.memory.contextBudgetMaxTokens'],
      minimum: 2048,
      maximum: 65536,
      description: 'Absolutní hard cap pro kontext (tokeny). Chrání proti runaway kontextu.',
    },
    'c3.memory.learningEnabled': {
      type: 'boolean',
      default: C3_DEFAULTS['c3.memory.learningEnabled'],
      description: 'Povolit učení z uživatelských preferencí.',
    },
    'c3.memory.feedbackDetection': {
      type: 'boolean',
      default: C3_DEFAULTS['c3.memory.feedbackDetection'],
      description: 'Automatická detekce zpětné vazby v konverzaci.',
    },
    'c3.memory.patternTracking': {
      type: 'boolean',
      default: C3_DEFAULTS['c3.memory.patternTracking'],
      description: 'Sledování vzorců napříč konverzacemi.',
    },

    // ─── v87: Account / Identity ──────────────────────
    'c3.account.displayName': {
      type: 'string',
      default: C3_DEFAULTS['c3.account.displayName'],
      description: 'Zobrazované jméno uživatele.',
    },
    'c3.account.description': {
      type: 'string',
      default: C3_DEFAULTS['c3.account.description'],
      description: 'Popis/bio uživatele (pro personalizaci odpovědí).',
    },
    'c3.account.timezone': {
      type: 'string',
      default: C3_DEFAULTS['c3.account.timezone'],
      description: 'Časové pásmo uživatele.',
    },
    'c3.account.currency': {
      type: 'string',
      default: C3_DEFAULTS['c3.account.currency'],
      enum: ['CZK', 'EUR', 'USD', 'GBP'],
      description: 'Výchozí měna pro finanční výpočty.',
    },

    // ─── v87: System ──────────────────────────────────
    'c3.system.logLevel': {
      type: 'string',
      default: C3_DEFAULTS['c3.system.logLevel'],
      enum: ['debug', 'info', 'warn', 'error'],
      description: 'Úroveň logování.',
    },
    'c3.system.logRetentionDays': {
      type: 'number',
      default: C3_DEFAULTS['c3.system.logRetentionDays'],
      minimum: 7,
      maximum: 365,
      description: 'Retence logů (dny).',
    },
    'c3.system.maxFileSize': {
      type: 'number',
      default: C3_DEFAULTS['c3.system.maxFileSize'],
      minimum: 102400,
      maximum: 10485760,
      description: 'Maximální velikost souboru pro zpracování (bytes).',
    },
    'c3.system.rateLimit': {
      type: 'number',
      default: C3_DEFAULTS['c3.system.rateLimit'],
      minimum: 10,
      maximum: 1000,
      description: 'Rate limit — maximální požadavky za minutu.',
    },

    // ─── v87: Output ──────────────────────────────────
    'c3.output.codeBlocks': {
      type: 'boolean',
      default: C3_DEFAULTS['c3.output.codeBlocks'],
      description: 'Zobrazovat code blocky ve výstupu.',
    },
    'c3.output.syntaxHighlight': {
      type: 'boolean',
      default: C3_DEFAULTS['c3.output.syntaxHighlight'],
      description: 'Zvýrazňování syntaxe v code blocích.',
    },
    'c3.output.markdownRendering': {
      type: 'boolean',
      default: C3_DEFAULTS['c3.output.markdownRendering'],
      description: 'Renderovat markdown ve výstupu.',
    },
    'c3.output.maxResponseLength': {
      type: 'number',
      default: C3_DEFAULTS['c3.output.maxResponseLength'],
      minimum: 1024,
      maximum: 65536,
      description: 'Maximální délka odpovědi (tokeny).',
    },

    // ─── v87 P2: Appearance ───────────────────────────
    'c3.appearance.density': {
      type: 'string',
      default: C3_DEFAULTS['c3.appearance.density'],
      enum: ['comfortable', 'compact', 'minimal'],
      description: 'Hustota UI elementů.',
    },
    'c3.appearance.uiScale': {
      type: 'string',
      default: C3_DEFAULTS['c3.appearance.uiScale'],
      enum: ['1.0', '1.1', '1.25'],
      description: 'Škálování UI (100% / 110% / 125%).',
    },

    // ─── v87 P2: Notifications ────────────────────────
    'c3.notif.desktopEnabled': {
      type: 'boolean',
      default: C3_DEFAULTS['c3.notif.desktopEnabled'],
      description: 'Systémové desktop notifikace (Electron).',
    },
    'c3.notif.quietEnabled': {
      type: 'boolean',
      default: C3_DEFAULTS['c3.notif.quietEnabled'],
      description: 'Tichý režim — potlačit notifikace v zadaném čase.',
    },
    'c3.notif.quietFrom': {
      type: 'string',
      default: C3_DEFAULTS['c3.notif.quietFrom'],
      description: 'Začátek tichého režimu (HH:MM).',
    },
    'c3.notif.quietTo': {
      type: 'string',
      default: C3_DEFAULTS['c3.notif.quietTo'],
      description: 'Konec tichého režimu (HH:MM).',
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
