/**
 * @intentsmith/settings — Theia Preferences Contribution
 *
 * Registers all intentsmith.* preference keys in Theia's PreferenceService.
 * Users can edit these in Settings UI or settings.json.
 */

import { injectable } from '@theia/core/shared/inversify';
import {
  FrontendApplicationContribution,
} from '@theia/core/lib/browser';
import { INTENTSMITH_DEFAULTS } from '../common/settings-protocol';

/**
 * Preference schema for all IntentSmith settings.
 * Theia registers these via PreferenceContribution in the DI module.
 */
export const INTENTSMITH_PREFERENCE_SCHEMA = {
  type: 'object' as const,
  properties: {
    // ─── Backend ───────────────────────────────────────
    'intentsmith.backend.url': {
      type: 'string',
      default: INTENTSMITH_DEFAULTS['intentsmith.backend.url'],
      description: 'WebSocket URL pro připojení k IntentSmith backendu.',
    },
    'intentsmith.backend.autoReconnect': {
      type: 'boolean',
      default: INTENTSMITH_DEFAULTS['intentsmith.backend.autoReconnect'],
      description: 'Automaticky se znovu připojit při výpadku.',
    },
    'intentsmith.backend.reconnectMaxDelay': {
      type: 'number',
      default: INTENTSMITH_DEFAULTS['intentsmith.backend.reconnectMaxDelay'],
      minimum: 1000,
      maximum: 120000,
      description: 'Maximální prodleva mezi pokusy o připojení (ms).',
    },

    // ─── Chat ──────────────────────────────────────────
    'intentsmith.chat.fontSize': {
      type: 'number',
      default: INTENTSMITH_DEFAULTS['intentsmith.chat.fontSize'],
      minimum: 10,
      maximum: 24,
      description: 'Velikost písma v chat panelu.',
    },
    'intentsmith.chat.showIntentBadges': {
      type: 'boolean',
      default: INTENTSMITH_DEFAULTS['intentsmith.chat.showIntentBadges'],
      description: 'Zobrazit intent badge u zpráv (DESIGN, BUILD, ...).',
    },
    'intentsmith.chat.showTimestamps': {
      type: 'boolean',
      default: INTENTSMITH_DEFAULTS['intentsmith.chat.showTimestamps'],
      description: 'Zobrazit časové značky u zpráv.',
    },
    'intentsmith.chat.maxHistory': {
      type: 'number',
      default: INTENTSMITH_DEFAULTS['intentsmith.chat.maxHistory'],
      minimum: 50,
      maximum: 5000,
      description: 'Maximální počet zpráv v chat historii.',
    },

    // ─── Agent ─────────────────────────────────────────
    'intentsmith.agent.autoScroll': {
      type: 'boolean',
      default: INTENTSMITH_DEFAULTS['intentsmith.agent.autoScroll'],
      description: 'Automaticky scrollovat Agent Log na nové eventy.',
    },
    'intentsmith.agent.verbosity': {
      type: 'string',
      default: INTENTSMITH_DEFAULTS['intentsmith.agent.verbosity'],
      enum: ['minimal', 'normal', 'verbose'],
      description: 'Úroveň detailu v Agent Logu.',
    },
    'intentsmith.agent.showTokenCounts': {
      type: 'boolean',
      default: INTENTSMITH_DEFAULTS['intentsmith.agent.showTokenCounts'],
      description: 'Zobrazit počet tokenů u LLM volání.',
    },

    // ─── Shell ─────────────────────────────────────────
    'intentsmith.shell.timeout': {
      type: 'number',
      default: INTENTSMITH_DEFAULTS['intentsmith.shell.timeout'],
      minimum: 5000,
      maximum: 300000,
      description: 'Timeout pro shell příkazy (ms).',
    },
    'intentsmith.shell.maxOutput': {
      type: 'number',
      default: INTENTSMITH_DEFAULTS['intentsmith.shell.maxOutput'],
      minimum: 1024,
      maximum: 1048576,
      description: 'Maximální velikost shell výstupu (bytes).',
    },

    // ─── Project ───────────────────────────────────────
    'intentsmith.project.autoSaveInterval': {
      type: 'number',
      default: INTENTSMITH_DEFAULTS['intentsmith.project.autoSaveInterval'],
      minimum: 10000,
      maximum: 600000,
      description: 'Interval automatického ukládání project.json (ms).',
    },
    'intentsmith.project.gitAutoCommit': {
      type: 'boolean',
      default: INTENTSMITH_DEFAULTS['intentsmith.project.gitAutoCommit'],
      description: 'Automaticky commitnout po Accept All v code review.',
    },

    // ─── Export ────────────────────────────────────────
    'intentsmith.export.includeChat': {
      type: 'boolean',
      default: INTENTSMITH_DEFAULTS['intentsmith.export.includeChat'],
      description: 'Zahrnout chat historii do exportu.',
    },
    'intentsmith.export.includeAgentLog': {
      type: 'boolean',
      default: INTENTSMITH_DEFAULTS['intentsmith.export.includeAgentLog'],
      description: 'Zahrnout agent log do exportu.',
    },
    'intentsmith.export.includeSrc': {
      type: 'boolean',
      default: INTENTSMITH_DEFAULTS['intentsmith.export.includeSrc'],
      description: 'Zahrnout zdrojový kód do exportu.',
    },

    // ─── Features ─────────────────────────────────────
    'intentsmith.features.agents': {
      type: 'boolean',
      default: INTENTSMITH_DEFAULTS['intentsmith.features.agents'],
      description: 'Povolit autonomní agenty a monitorování.',
    },
    'intentsmith.features.lifecycle': {
      type: 'boolean',
      default: INTENTSMITH_DEFAULTS['intentsmith.features.lifecycle'],
      description: 'Povolit lifecycle engine (SPEC→BUILD→REVIEW).',
    },
    'intentsmith.features.expertises': {
      type: 'boolean',
      default: INTENTSMITH_DEFAULTS['intentsmith.features.expertises'],
      description: 'Povolit doménové expertízy a merge engine.',
    },
    'intentsmith.features.telemetry': {
      type: 'boolean',
      default: INTENTSMITH_DEFAULTS['intentsmith.features.telemetry'],
      description: 'Povolit resilience telemetrii a metriky.',
    },
    'intentsmith.features.specialistTelemetry': {
      type: 'boolean',
      default: INTENTSMITH_DEFAULTS['intentsmith.features.specialistTelemetry'],
      description: 'Povolit pasivní observabilitu specialistů.',
    },
    'intentsmith.features.autonomy': {
      type: 'boolean',
      default: INTENTSMITH_DEFAULTS['intentsmith.features.autonomy'],
      description: 'Povolit guarded autonomy — self-tuning CRE.',
    },
    'intentsmith.features.skills': {
      type: 'boolean',
      default: INTENTSMITH_DEFAULTS['intentsmith.features.skills'],
      description: 'Povolit systém skillů — automatické rozpoznání a spouštění opakujících se postupů.',
    },

    // ─── UI ────────────────────────────────────────────
    'intentsmith.language': {
      type: 'string',
      default: INTENTSMITH_DEFAULTS['intentsmith.language'],
      enum: ['cs', 'en'],
      enumDescriptions: ['Čeština', 'English'],
      description: 'Jazyk uživatelského rozhraní IntentSmith.',
    },
    'intentsmith.theme': {
      type: 'string',
      default: INTENTSMITH_DEFAULTS['intentsmith.theme'],
      enum: ['dark', 'light'],
      description: 'Barevné schéma IntentSmith panelů.',
    },

    // ─── v87: LLM Settings ────────────────────────────
    'intentsmith.llm.chatModel': {
      type: 'string',
      default: INTENTSMITH_DEFAULTS['intentsmith.llm.chatModel'],
      description: 'Hlavní model pro chat a syntézu.',
    },
    'intentsmith.llm.codeModel': {
      type: 'string',
      default: INTENTSMITH_DEFAULTS['intentsmith.llm.codeModel'],
      description: 'Model pro generování kódu.',
    },
    'intentsmith.llm.visionModel': {
      type: 'string',
      default: INTENTSMITH_DEFAULTS['intentsmith.llm.visionModel'],
      description: 'Model pro analýzu obrázků.',
    },
    'intentsmith.llm.ollamaUrl': {
      type: 'string',
      default: INTENTSMITH_DEFAULTS['intentsmith.llm.ollamaUrl'],
      description: 'URL adresa Ollama serveru.',
    },
    'intentsmith.llm.temperature': {
      type: 'number',
      default: INTENTSMITH_DEFAULTS['intentsmith.llm.temperature'],
      minimum: 0,
      maximum: 2,
      description: 'Teplota generování (0 = deterministický, 2 = kreativní).',
    },
    'intentsmith.llm.contextWindow': {
      type: 'number',
      default: INTENTSMITH_DEFAULTS['intentsmith.llm.contextWindow'],
      minimum: 2048,
      maximum: 131072,
      description: 'Velikost kontextového okna modelu (tokeny).',
    },
    'intentsmith.llm.timeoutChat': {
      type: 'number',
      default: INTENTSMITH_DEFAULTS['intentsmith.llm.timeoutChat'],
      minimum: 10000,
      maximum: 300000,
      description: 'Timeout pro chat volání (ms).',
    },
    'intentsmith.llm.timeoutCode': {
      type: 'number',
      default: INTENTSMITH_DEFAULTS['intentsmith.llm.timeoutCode'],
      minimum: 10000,
      maximum: 300000,
      description: 'Timeout pro code generování (ms).',
    },
    'intentsmith.llm.numGpu': {
      type: 'number',
      default: INTENTSMITH_DEFAULTS['intentsmith.llm.numGpu'],
      minimum: -1,
      maximum: 8,
      description: 'Počet GPU vrstev (-1 = auto, 0 = CPU only).',
    },

    // ─── v87: Memory & Context ────────────────────────
    'intentsmith.memory.conversationMaxTurns': {
      type: 'number',
      default: INTENTSMITH_DEFAULTS['intentsmith.memory.conversationMaxTurns'],
      minimum: 50,
      maximum: 5000,
      description: 'Maximální počet turnů v konverzaci.',
    },
    'intentsmith.memory.compactThreshold': {
      type: 'number',
      default: INTENTSMITH_DEFAULTS['intentsmith.memory.compactThreshold'],
      minimum: 0.3,
      maximum: 0.95,
      description: 'Práh pro automatickou kompakci kontextu (0-1).',
    },
    'intentsmith.memory.compactKeepTurns': {
      type: 'number',
      default: INTENTSMITH_DEFAULTS['intentsmith.memory.compactKeepTurns'],
      minimum: 2,
      maximum: 20,
      description: 'Počet posledních turnů uchovaných při kompakci.',
    },
    'intentsmith.memory.ltmEnabled': {
      type: 'boolean',
      default: INTENTSMITH_DEFAULTS['intentsmith.memory.ltmEnabled'],
      description: 'Povolit dlouhodobou paměť (LTM).',
    },
    'intentsmith.memory.ltmMaxEntries': {
      type: 'number',
      default: INTENTSMITH_DEFAULTS['intentsmith.memory.ltmMaxEntries'],
      minimum: 100,
      maximum: 10000,
      description: 'Maximální počet záznamů v LTM.',
    },
    'intentsmith.memory.ltmDecayHalfLife': {
      type: 'number',
      default: INTENTSMITH_DEFAULTS['intentsmith.memory.ltmDecayHalfLife'],
      minimum: 7,
      maximum: 365,
      description: 'Poločas rozpadu důvěryhodnosti LTM (dny).',
    },
    'intentsmith.memory.contextBudgetChat': {
      type: 'number',
      default: INTENTSMITH_DEFAULTS['intentsmith.memory.contextBudgetChat'],
      minimum: 10,
      maximum: 90,
      description: 'Budget kontextu pro chat (% z kontextového okna).',
    },
    'intentsmith.memory.contextBudgetCode': {
      type: 'number',
      default: INTENTSMITH_DEFAULTS['intentsmith.memory.contextBudgetCode'],
      minimum: 10,
      maximum: 90,
      description: 'Budget kontextu pro kód (% z kontextového okna).',
    },
    'intentsmith.memory.contextBudgetMaxTokens': {
      type: 'number',
      default: INTENTSMITH_DEFAULTS['intentsmith.memory.contextBudgetMaxTokens'],
      minimum: 2048,
      maximum: 65536,
      description: 'Absolutní hard cap pro kontext (tokeny). Chrání proti runaway kontextu.',
    },
    'intentsmith.memory.learningEnabled': {
      type: 'boolean',
      default: INTENTSMITH_DEFAULTS['intentsmith.memory.learningEnabled'],
      description: 'Povolit učení z uživatelských preferencí.',
    },
    'intentsmith.memory.feedbackDetection': {
      type: 'boolean',
      default: INTENTSMITH_DEFAULTS['intentsmith.memory.feedbackDetection'],
      description: 'Automatická detekce zpětné vazby v konverzaci.',
    },
    'intentsmith.memory.patternTracking': {
      type: 'boolean',
      default: INTENTSMITH_DEFAULTS['intentsmith.memory.patternTracking'],
      description: 'Sledování vzorců napříč konverzacemi.',
    },

    // ─── v87: Account / Identity ──────────────────────
    'intentsmith.account.displayName': {
      type: 'string',
      default: INTENTSMITH_DEFAULTS['intentsmith.account.displayName'],
      description: 'Zobrazované jméno uživatele.',
    },
    'intentsmith.account.description': {
      type: 'string',
      default: INTENTSMITH_DEFAULTS['intentsmith.account.description'],
      description: 'Popis/bio uživatele (pro personalizaci odpovědí).',
    },
    'intentsmith.account.timezone': {
      type: 'string',
      default: INTENTSMITH_DEFAULTS['intentsmith.account.timezone'],
      description: 'Časové pásmo uživatele.',
    },
    'intentsmith.account.currency': {
      type: 'string',
      default: INTENTSMITH_DEFAULTS['intentsmith.account.currency'],
      enum: ['CZK', 'EUR', 'USD', 'GBP'],
      description: 'Výchozí měna pro finanční výpočty.',
    },

    // ─── v87: System ──────────────────────────────────
    'intentsmith.system.logLevel': {
      type: 'string',
      default: INTENTSMITH_DEFAULTS['intentsmith.system.logLevel'],
      enum: ['debug', 'info', 'warn', 'error'],
      description: 'Úroveň logování.',
    },
    'intentsmith.system.logRetentionDays': {
      type: 'number',
      default: INTENTSMITH_DEFAULTS['intentsmith.system.logRetentionDays'],
      minimum: 7,
      maximum: 365,
      description: 'Retence logů (dny).',
    },
    'intentsmith.system.maxFileSize': {
      type: 'number',
      default: INTENTSMITH_DEFAULTS['intentsmith.system.maxFileSize'],
      minimum: 102400,
      maximum: 10485760,
      description: 'Maximální velikost souboru pro zpracování (bytes).',
    },
    'intentsmith.system.rateLimit': {
      type: 'number',
      default: INTENTSMITH_DEFAULTS['intentsmith.system.rateLimit'],
      minimum: 10,
      maximum: 1000,
      description: 'Rate limit — maximální požadavky za minutu.',
    },

    // ─── v87: Output ──────────────────────────────────
    'intentsmith.output.codeBlocks': {
      type: 'boolean',
      default: INTENTSMITH_DEFAULTS['intentsmith.output.codeBlocks'],
      description: 'Zobrazovat code blocky ve výstupu.',
    },
    'intentsmith.output.syntaxHighlight': {
      type: 'boolean',
      default: INTENTSMITH_DEFAULTS['intentsmith.output.syntaxHighlight'],
      description: 'Zvýrazňování syntaxe v code blocích.',
    },
    'intentsmith.output.markdownRendering': {
      type: 'boolean',
      default: INTENTSMITH_DEFAULTS['intentsmith.output.markdownRendering'],
      description: 'Renderovat markdown ve výstupu.',
    },
    'intentsmith.output.maxResponseLength': {
      type: 'number',
      default: INTENTSMITH_DEFAULTS['intentsmith.output.maxResponseLength'],
      minimum: 1024,
      maximum: 65536,
      description: 'Maximální délka odpovědi (tokeny).',
    },

    // ─── v87 P2: Appearance ───────────────────────────
    'intentsmith.appearance.density': {
      type: 'string',
      default: INTENTSMITH_DEFAULTS['intentsmith.appearance.density'],
      enum: ['comfortable', 'compact', 'minimal'],
      description: 'Hustota UI elementů.',
    },
    'intentsmith.appearance.uiScale': {
      type: 'string',
      default: INTENTSMITH_DEFAULTS['intentsmith.appearance.uiScale'],
      enum: ['1.0', '1.1', '1.25'],
      description: 'Škálování UI (100% / 110% / 125%).',
    },

    // ─── v87 P2: Notifications ────────────────────────
    'intentsmith.notif.desktopEnabled': {
      type: 'boolean',
      default: INTENTSMITH_DEFAULTS['intentsmith.notif.desktopEnabled'],
      description: 'Systémové desktop notifikace (Electron).',
    },
    'intentsmith.notif.quietEnabled': {
      type: 'boolean',
      default: INTENTSMITH_DEFAULTS['intentsmith.notif.quietEnabled'],
      description: 'Tichý režim — potlačit notifikace v zadaném čase.',
    },
    'intentsmith.notif.quietFrom': {
      type: 'string',
      default: INTENTSMITH_DEFAULTS['intentsmith.notif.quietFrom'],
      description: 'Začátek tichého režimu (HH:MM).',
    },
    'intentsmith.notif.quietTo': {
      type: 'string',
      default: INTENTSMITH_DEFAULTS['intentsmith.notif.quietTo'],
      description: 'Konec tichého režimu (HH:MM).',
    },

    // ─── v93: Email Notifications ────────────────────
    'intentsmith.notif.emailEnabled': {
      type: 'boolean',
      default: INTENTSMITH_DEFAULTS['intentsmith.notif.emailEnabled'],
      description: 'Povolit email notifikace (SMTP).',
    },
    'intentsmith.notif.smtpHost': {
      type: 'string',
      default: INTENTSMITH_DEFAULTS['intentsmith.notif.smtpHost'],
      description: 'SMTP server (např. smtp.gmail.com).',
    },
    'intentsmith.notif.smtpPort': {
      type: 'number',
      default: INTENTSMITH_DEFAULTS['intentsmith.notif.smtpPort'],
      minimum: 1,
      maximum: 65535,
      description: 'SMTP port (587 = STARTTLS, 465 = SSL, 25 = plain).',
    },
    'intentsmith.notif.smtpUser': {
      type: 'string',
      default: INTENTSMITH_DEFAULTS['intentsmith.notif.smtpUser'],
      description: 'SMTP uživatelské jméno (email).',
    },
    'intentsmith.notif.smtpFrom': {
      type: 'string',
      default: INTENTSMITH_DEFAULTS['intentsmith.notif.smtpFrom'],
      description: 'Adresa odesílatele (pokud prázdné, použije se smtpUser).',
    },
    'intentsmith.notif.emailRecipient': {
      type: 'string',
      default: INTENTSMITH_DEFAULTS['intentsmith.notif.emailRecipient'],
      description: 'Email příjemce notifikací.',
    },
    'intentsmith.notif.emailOnLifecycle': {
      type: 'boolean',
      default: INTENTSMITH_DEFAULTS['intentsmith.notif.emailOnLifecycle'],
      description: 'Email při lifecycle eventech (milestone PASS/FAIL/BLOCKED).',
    },
    'intentsmith.notif.emailOnWorker': {
      type: 'boolean',
      default: INTENTSMITH_DEFAULTS['intentsmith.notif.emailOnWorker'],
      description: 'Email při worker eventech (agent error/complete).',
    },
  },
};

/**
 * Helper to read a IntentSmith preference.
 * Usage: getIntentSmithPref(preferenceService, 'intentsmith.chat.fontSize')
 */
export function getIntentSmithPref<K extends keyof typeof INTENTSMITH_DEFAULTS>(
  preferenceService: { get: (key: string, fallback?: any) => any },
  key: K,
): typeof INTENTSMITH_DEFAULTS[K] {
  return preferenceService.get(key, INTENTSMITH_DEFAULTS[key]);
}
