// ═══════════════════════════════════════════════════════════════════════════════
// C3-Agent — B9: Agent Builder Wizard
// ═══════════════════════════════════════════════════════════════════════════════
//
// Conversational agent creation through chat interface.
// User says "Chci hlídat počasí v Praze" → wizard asks questions →
// generates agent config → saves to DB → starts agent.
//
// Wizard states:
//   IDLE → DETECT_INTENT → CHOOSE_TEMPLATE → CONFIGURE → CONFIRM → DONE
//
// Integration: Registered as chat handler for wizard intent.
//   CRE detects "chci hlídat", "nastav agenta", "vytvoř worker" → WIZARD intent
//
// ═══════════════════════════════════════════════════════════════════════════════

import { WORKER_TEMPLATES, getTemplateDescriptions } from '../../agents/worker-configs.js';

// ─── Wizard States ───────────────────────────────────────────────────────────

export const WizardState = {
  IDLE: 'idle',
  DETECT_INTENT: 'detect_intent',
  CHOOSE_TEMPLATE: 'choose_template',
  CONFIGURE: 'configure',
  CONFIRM: 'confirm',
  DONE: 'done',
  CANCELLED: 'cancelled',
};

// ─── Intent Detection Patterns ───────────────────────────────────────────────

const WIZARD_TRIGGER_PATTERNS = [
  // CZ
  /(?:chci|chtěl|potřebuju)\s+(?:hlídat|sledovat|monitorovat)/i,
  /(?:vytvoř|nastav|přidej)\s+(?:agenta|worker|hlídač|monitor)/i,
  /(?:upozorni|oznam)\s+(?:mě|mi)\s+(?:když|až|pokud)/i,
  /(?:hlídej|sleduj)\s+(?:mi|pro mě)/i,
  // EN
  /(?:i want to|please)\s+(?:monitor|watch|track|alert)/i,
  /(?:create|set up|add)\s+(?:an?\s+)?(?:agent|worker|monitor|watcher)/i,
  /(?:notify|alert)\s+me\s+(?:when|if)/i,
];

// Template detection from user intent
const TEMPLATE_HINTS = {
  weather: [
    /počasí|teplota|déšť|sníh|bouřka|mráz|weather|temperature|rain|snow/i,
  ],
  realEstate: [
    /realit|nemovitost|byt|dom[yůu]?|dům|pozemk|pronáj|prodej|sreality|bezrealitky|estate|apartment|house|rent/i,
  ],
  news: [
    /zpráv|novin|článk|rss|feed|news|article|blog/i,
  ],
};

// ─── Parameter Extraction ────────────────────────────────────────────────────

const PARAM_EXTRACTORS = {
  // City extraction
  city: [
    /(?:v|pro|in)\s+([A-ZÁČĎÉĚÍŇÓŘŠŤÚŮÝŽ][a-záčďéěíňóřšťúůýž]+(?:\s+[A-ZÁČĎÉĚÍŇÓŘŠŤÚŮÝŽ][a-záčďéěíňóřšťúůýž]+)?)/,
    /^([A-ZÁČĎÉĚÍŇÓŘŠŤÚŮÝŽ][a-záčďéěíňóřšťúůýž]+)$/,
  ],

  // Price extraction
  maxPrice: [
    /(?:do|max|maximálně|under)\s*(\d[\d\s]*)\s*(?:Kč|kč|CZK|korun)/i,
    /(\d[\d\s]*)\s*(?:Kč|kč|CZK)/i,
    /(\d+)\s*(?:mil|milion|M)\b/i,
  ],

  // Area extraction
  minArea: [
    /(?:minim(?:um|álně)?|min\.?|aspoň|alespoň|od|from)\s*(\d+)\s*(?:m²|m2|metrů)/i,
    /(\d+)\s*(?:m²|m2)\s*(?:a více|minimum|\+)/i,
  ],

  // Keywords extraction
  keywords: [
    /(?:klíčová slova|filtr|hledej|keywords?|filter)\s*:?\s*(.+)/i,
    /(?:obsahující|s|with)\s+(.+)/i,
  ],

  // Channel extraction
  channel: [
    /(?:přes|na|via|through)\s+(email|telegram|ntfy|push)/i,
    /(email|telegram|ntfy)/i,
  ],

  // Email extraction
  email: [
    /([a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,})/,
  ],

  // Schedule extraction
  schedule: [
    /(?:každ(?:ý|ou|é|ých))\s+(\d+)\s*(?:minut|hodin|hod)/i,
    /(?:ráno|dopoledne|odpoledne|večer)/i,
    /(\d+)x\s*(?:denně|týdně)/i,
  ],
};

// ─── Wizard Session ──────────────────────────────────────────────────────────

export class WizardSession {
  constructor(conversationId, lang = 'cs') {
    this.conversationId = conversationId;
    this.lang = lang;
    this.state = WizardState.IDLE;
    this.template = null;
    this.params = {};
    this.missingParams = [];
    this.history = [];
    this.createdAt = new Date();
    this.updatedAt = new Date();
  }

  /**
   * Check if user input triggers the wizard.
   * @param {string} input
   * @returns {boolean}
   */
  static isWizardTrigger(input) {
    return WIZARD_TRIGGER_PATTERNS.some(p => p.test(input));
  }

  /**
   * Detect which template the user wants from their input.
   * @param {string} input
   * @returns {string|null} Template ID or null
   */
  static detectTemplate(input) {
    for (const [templateId, patterns] of Object.entries(TEMPLATE_HINTS)) {
      if (patterns.some(p => p.test(input))) return templateId;
    }
    return null;
  }

  /**
   * Extract parameters from user input.
   * @param {string} input
   * @returns {object} Extracted params
   */
  static extractParams(input) {
    const extracted = {};

    for (const [paramName, patterns] of Object.entries(PARAM_EXTRACTORS)) {
      for (const pattern of patterns) {
        const match = input.match(pattern);
        if (match) {
          let value = match[1];

          // Post-process
          if (paramName === 'maxPrice') {
            value = value.replace(/\s/g, '');
            if (/mil|M/i.test(input.substring(match.index, match.index + match[0].length + 10))) {
              value = String(Number(value) * 1_000_000);
            }
            extracted[paramName] = Number(value);
          } else if (paramName === 'minArea') {
            extracted[paramName] = Number(value);
          } else if (paramName === 'keywords') {
            extracted[paramName] = value.split(/[,;]+/).map(k => k.trim()).filter(Boolean);
          } else {
            extracted[paramName] = value;
          }
          break;
        }
      }
    }

    return extracted;
  }

  /**
   * Process user input and return next wizard response.
   * @param {string} input
   * @returns {{ response: string, state: string, done: boolean, agentConfig?: object }}
   */
  process(input) {
    this.history.push({ role: 'user', content: input, at: new Date() });
    this.updatedAt = new Date();

    // Cancel
    if (/^(?:zruš|cancel|stop|nechci|quit)(?:\s|$)/i.test(input.trim())) {
      this.state = WizardState.CANCELLED;
      const msg = this.lang === 'cs'
        ? 'Tvorba agenta zrušena.'
        : 'Agent creation cancelled.';
      return this._respond(msg, true);
    }

    switch (this.state) {
      case WizardState.IDLE:
        return this._handleIdle(input);
      case WizardState.CHOOSE_TEMPLATE:
        return this._handleChooseTemplate(input);
      case WizardState.CONFIGURE:
        return this._handleConfigure(input);
      case WizardState.CONFIRM:
        return this._handleConfirm(input);
      default:
        return this._handleIdle(input);
    }
  }

  _handleIdle(input) {
    // Try to detect template from initial input
    const template = WizardSession.detectTemplate(input);
    const params = WizardSession.extractParams(input);
    Object.assign(this.params, params);

    if (template) {
      this.template = template;
      this.state = WizardState.CONFIGURE;
      return this._askNextParam();
    }

    // No template detected → ask user to choose
    this.state = WizardState.CHOOSE_TEMPLATE;
    const templates = getTemplateDescriptions(this.lang);
    const list = templates.map((t, i) =>
      `${i + 1}. ${t.icon} **${t.name}** — ${t.description}`
    ).join('\n');

    const msg = this.lang === 'cs'
      ? `Jaký typ agenta chceš vytvořit?\n\n${list}\n\nZadej číslo nebo popiš co chceš sledovat.`
      : `What type of agent would you like to create?\n\n${list}\n\nEnter a number or describe what you want to monitor.`;

    return this._respond(msg);
  }

  _handleChooseTemplate(input) {
    const trimmed = input.trim();

    // Number selection
    const num = parseInt(trimmed);
    const templates = getTemplateDescriptions(this.lang);
    if (num >= 1 && num <= templates.length) {
      this.template = templates[num - 1].id;
      this.state = WizardState.CONFIGURE;
      return this._askNextParam();
    }

    // Try NL detection
    const template = WizardSession.detectTemplate(input);
    if (template) {
      this.template = template;
      const params = WizardSession.extractParams(input);
      Object.assign(this.params, params);
      this.state = WizardState.CONFIGURE;
      return this._askNextParam();
    }

    const msg = this.lang === 'cs'
      ? 'Nerozumím. Zadej číslo (1-3) nebo popiš co chceš sledovat.'
      : 'I didn\'t understand. Enter a number (1-3) or describe what you want to monitor.';
    return this._respond(msg);
  }

  _handleConfigure(input) {
    // Extract params from response
    const params = WizardSession.extractParams(input);
    Object.assign(this.params, params);

    // Also try direct value for current missing param
    if (this.missingParams.length > 0) {
      const currentParam = this.missingParams[0];
      if (!this.params[currentParam] && input.trim().length > 0) {
        // Treat as direct answer
        if (currentParam === 'city') this.params.city = input.trim();
        else if (currentParam === 'channel') {
          const ch = input.trim().toLowerCase();
          if (['email', 'telegram', 'ntfy'].includes(ch)) this.params.channel = ch;
        }
        else if (currentParam === 'recipient' || currentParam === 'email') {
          this.params.recipient = input.trim();
        }
      }
    }

    return this._askNextParam();
  }

  _handleConfirm(input) {
    if (/^(?:ano|yes|ok|jo|jasně|sure|yep|potvrz|potvrzuji|1)\b/i.test(input.trim())) {
      this.state = WizardState.DONE;
      const config = this._buildConfig();

      const msg = this.lang === 'cs'
        ? `✅ Agent **${config.name}** vytvořen a spuštěn!\n\nMůžeš ho spravovat příkazem \`/agents\`.`
        : `✅ Agent **${config.name}** created and started!\n\nManage it with the \`/agents\` command.`;

      return this._respond(msg, true, config);
    }

    if (/^(?:ne|no|nope|2)\b/i.test(input.trim())) {
      this.state = WizardState.CANCELLED;
      const msg = this.lang === 'cs' ? 'Agent nebyl vytvořen.' : 'Agent was not created.';
      return this._respond(msg, true);
    }

    const msg = this.lang === 'cs' ? 'Odpověz **ano** nebo **ne**.' : 'Please answer **yes** or **no**.';
    return this._respond(msg);
  }

  _askNextParam() {
    const required = this._getRequiredParams();
    this.missingParams = required.filter(p => !this.params[p]);

    if (this.missingParams.length === 0) {
      // All params collected → confirm
      this.state = WizardState.CONFIRM;
      return this._showSummary();
    }

    const param = this.missingParams[0];
    const question = this._getParamQuestion(param);
    return this._respond(question);
  }

  _getRequiredParams() {
    switch (this.template) {
      case 'weather':
        return ['city', 'channel'];
      case 'realEstate':
        return ['city', 'maxPrice', 'channel'];
      case 'news':
        return ['channel'];
      default:
        return ['channel'];
    }
  }

  _getParamQuestion(param) {
    const questions = {
      cs: {
        city: '📍 V jakém městě? (např. Praha, Brno, Ostrava)',
        maxPrice: '💰 Jaká je maximální cena? (např. "do 5 milionů Kč")',
        minArea: '📐 Minimální plocha v m²? (např. 60)',
        channel: '📱 Kam posílat upozornění?\n1. 📧 Email\n2. 💬 Telegram\n3. 🔔 ntfy (push na telefon)',
        recipient: '📬 Na jakou adresu? (email, Telegram chat ID, nebo ntfy topic)',
        keywords: '🔍 Klíčová slova pro filtrování? (nebo "přeskoč" pro žádný filtr)',
      },
      en: {
        city: '📍 Which city? (e.g., Prague, Brno, Ostrava)',
        maxPrice: '💰 What\'s the maximum price? (e.g., "up to 5 million CZK")',
        minArea: '📐 Minimum area in m²? (e.g., 60)',
        channel: '📱 Where should notifications go?\n1. 📧 Email\n2. 💬 Telegram\n3. 🔔 ntfy (push notifications)',
        recipient: '📬 What address? (email, Telegram chat ID, or ntfy topic)',
        keywords: '🔍 Keywords to filter by? (or "skip" for no filter)',
      },
    };

    return (questions[this.lang] || questions.en)[param] || `Please provide: ${param}`;
  }

  _showSummary() {
    const config = this._buildConfig();

    if (this.lang === 'cs') {
      let summary = `📋 **Shrnutí agenta:**\n\n`;
      summary += `**Název:** ${config.name}\n`;
      summary += `**Typ:** ${this.template}\n`;

      if (this.params.city) summary += `**Město:** ${this.params.city}\n`;
      if (this.params.maxPrice) summary += `**Max. cena:** ${Number(this.params.maxPrice).toLocaleString('cs-CZ')} Kč\n`;
      if (this.params.minArea) summary += `**Min. plocha:** ${this.params.minArea} m²\n`;
      if (this.params.keywords?.length) summary += `**Filtr:** ${this.params.keywords.join(', ')}\n`;
      summary += `**Kanál:** ${this.params.channel || 'ntfy'}\n`;

      summary += `\nVytvořit agenta? (**ano** / **ne**)`;
      return this._respond(summary);
    }

    let summary = `📋 **Agent Summary:**\n\n`;
    summary += `**Name:** ${config.name}\n`;
    summary += `**Type:** ${this.template}\n`;
    if (this.params.city) summary += `**City:** ${this.params.city}\n`;
    summary += `**Channel:** ${this.params.channel || 'ntfy'}\n`;
    summary += `\nCreate this agent? (**yes** / **no**)`;
    return this._respond(summary);
  }

  _buildConfig() {
    const factory = WORKER_TEMPLATES[this.template];
    if (!factory) {
      return { name: `Agent-${Date.now()}`, definition: {}, enabled: true };
    }
    return factory(this.params);
  }

  _respond(text, done = false, agentConfig = null) {
    this.history.push({ role: 'assistant', content: text, at: new Date() });
    return {
      response: text,
      state: this.state,
      done: done || this.state === WizardState.DONE || this.state === WizardState.CANCELLED,
      agentConfig: agentConfig || undefined,
    };
  }

  /**
   * Serialize wizard state for persistence.
   */
  toJSON() {
    return {
      conversationId: this.conversationId,
      lang: this.lang,
      state: this.state,
      template: this.template,
      params: this.params,
      missingParams: this.missingParams,
      createdAt: this.createdAt.toISOString(),
      updatedAt: this.updatedAt.toISOString(),
    };
  }

  /**
   * Restore wizard state from serialized data.
   */
  static fromJSON(data) {
    const session = new WizardSession(data.conversationId, data.lang);
    session.state = data.state;
    session.template = data.template;
    session.params = data.params;
    session.missingParams = data.missingParams || [];
    session.createdAt = new Date(data.createdAt);
    session.updatedAt = new Date(data.updatedAt);
    return session;
  }
}

// ─── Wizard Manager ──────────────────────────────────────────────────────────

export class WizardManager {
  constructor() {
    /** @type {Map<string, WizardSession>} */
    this.sessions = new Map();
  }

  /**
   * Get or create wizard session for a conversation.
   */
  getSession(conversationId, lang = 'cs') {
    if (this.sessions.has(conversationId)) {
      return this.sessions.get(conversationId);
    }
    const session = new WizardSession(conversationId, lang);
    this.sessions.set(conversationId, session);
    return session;
  }

  /**
   * Remove completed/cancelled session.
   */
  endSession(conversationId) {
    this.sessions.delete(conversationId);
  }

  /**
   * Check if conversation has active wizard.
   */
  hasActiveWizard(conversationId) {
    const session = this.sessions.get(conversationId);
    if (!session) return false;
    return session.state !== WizardState.IDLE &&
           session.state !== WizardState.DONE &&
           session.state !== WizardState.CANCELLED;
  }

  /**
   * Get all active sessions (for debugging/admin).
   */
  getActiveSessions() {
    return [...this.sessions.entries()]
      .filter(([_, s]) => s.state !== WizardState.IDLE && s.state !== WizardState.DONE)
      .map(([id, s]) => ({ conversationId: id, state: s.state, template: s.template }));
  }
}

export default { WizardSession, WizardManager, WizardState };
