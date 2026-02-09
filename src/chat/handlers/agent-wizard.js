// Agent Builder Wizard — Conversational Agent Creation (B9)
// ══════════════════════════════════════════════════════════════════════════════
//
// Phase machine: GATHERING → GENERATING → PREVIEW → CONFIRMING → ACTIVE
//
// Architecture: Same pattern as build-handoff.js — per-session state in Map,
// intercepted in conversation.js before CRE classification.
//
// ══════════════════════════════════════════════════════════════════════════════

import { logger } from '../../core/logger.js';
import { ResponseTag, TaggedResponse, ResponseSpeaker, ChatMode } from '../controller.js';
import { AgentBuilder } from '../../agents/builder.js';
import { validateAgentDefinition } from '../../agents/schema.js';

// ─── Response builder (same pattern as build-handoff.js) ─────────────────────

function buildResponse(content, metadata = {}) {
  return new TaggedResponse({
    content,
    tag: new ResponseTag({
      speaker: ResponseSpeaker.SYSTEM,
      mode: ChatMode.CONVERSATION,
      confidence: 0.9,
      canExecute: false,
      metadata: { wizard: true, ...metadata },
    }),
  });
}

// ─── Wizard State (per session) ──────────────────────────────────────────────

const wizardStates = new Map();

/**
 * @typedef {Object} WizardState
 * @property {'GATHERING'|'GENERATING'|'PREVIEW'|'CONFIRMING'} phase
 * @property {string} originalInput
 * @property {string|null} agentType
 * @property {Object} gathered
 * @property {string[]} pendingQuestions
 * @property {Object|null} definition
 * @property {string|null} explanation
 * @property {string} updatedAt
 */

function getWizardState(sessionId) {
  return wizardStates.get(sessionId) || null;
}

function setWizardState(sessionId, state) {
  wizardStates.set(sessionId, { ...state, updatedAt: new Date().toISOString() });
}

function clearWizardState(sessionId) {
  wizardStates.delete(sessionId);
}

// ─── Exports for conversation.js ─────────────────────────────────────────────

export function getActiveWizard(sessionId) {
  return getWizardState(sessionId);
}

export function cancelWizard(sessionId) {
  clearWizardState(sessionId);
}

// ─── Agent Type Detection ────────────────────────────────────────────────────

const TYPE_PATTERNS = {
  MONITOR: [
    /(?:sleduj|sledovat|monitoruj|monitorovat|hlidej|hlidat|kontroluj|kontrolovat)\s+(?:pocasi|teplotu|kurz|cenu)/i,
    /(?:upozorni|dej.+vedet)\s+(?:me\s+)?kdyz/i,
    /(?:monitor|watch|alert).+(?:weather|temperature|price|stock)/i,
  ],
  HUNTER: [
    /(?:hledej|hlidej|sleduj)\s+(?:nove\s+)?(?:inzeraty|nabidky|nemovitosti|pozemky|byty|reality)/i,
    /(?:watch|find|hunt).+(?:listings?|deals?|properties)/i,
    /(?:sreality|bezrealitky|reality)/i,
  ],
  DIGEST: [
    /(?:denne|kazdodenni|denni)\s+(?:prehled|digest|report|souhrn)/i,
    /denne\b.+(?:posli|posilej|prehled|zprav|report)/i,
    /(?:sbirej|agreguj)\s+(?:zpravy|novinky|clanky|informace)/i,
    /(?:rss|feed|zpravy|novinky|news)/i,
    /(?:daily|weekly)\s+(?:digest|report|summary)/i,
  ],
  TRACKER: [
    /(?:sleduj|hlidej)\s+(?:zaruku|platnost|termin|expiraci)/i,
    /(?:track|monitor).+(?:warranty|expir|deadline)/i,
  ],
};

function detectAgentType(input) {
  for (const [type, patterns] of Object.entries(TYPE_PATTERNS)) {
    for (const pat of patterns) {
      if (pat.test(input)) return type;
    }
  }
  return null;
}

// ─── Wizard Trigger Patterns ─────────────────────────────────────────────────

export const WIZARD_PATTERNS = [
  /chci\s+(sledovat|monitorovat|hlidat|kontrolovat)/i,
  /nastav\s+(mi\s+)?(agenta|monitoring|hlidani|sledovani)/i,
  /vytvor\s+(mi\s+)?(agenta|monitor|hlidac)/i,
  /sleduj\s+(pro\s+me\s+)?(pocasi|ceny|zpravy|inzeraty|reality|novinky)/i,
  /hlidej\s+(mi\s+)?(pocasi|ceny|zpravy|inzeraty|reality|novinky)/i,
  /upozorni\s+me\s+kdyz/i,
  /dej\s+mi\s+vedet\s+kdyz/i,
  /chci\s+dostavat\s+(notifikace|upozorneni|zpravy)/i,
  /create\s+(an?\s+)?agent/i,
  /set\s+up\s+(a\s+)?(monitor|watcher|alert)/i,
  /monitor\s+(weather|prices?|listings?|news)/i,
  /alert\s+me\s+when/i,
  /watch\s+for\s+/i,
];

export function isWizardTrigger(input) {
  return WIZARD_PATTERNS.some(p => p.test(input));
}

// ─── Question generation ─────────────────────────────────────────────────────

const QUESTION_TEMPLATES = {
  sourceUrl: {
    cs: 'Jakou URL/zdroj chces sledovat? (napriklad URL API, RSS feed, nebo web stranku)',
    en: 'What URL/source do you want to monitor? (e.g., API URL, RSS feed, or webpage)',
  },
  condition: {
    cs: 'Pri jake podmince chces dostat notifikaci? (napriklad "teplota pod 0", "cena pod 2M", "novy inzerat")',
    en: 'When should you be notified? (e.g., "temperature below 0", "price under 2M", "new listing")',
  },
  channel: {
    cs: 'Kam posilat upozorneni?\n  1. **telegram** — zprava na Telegram\n  2. **email** — email\n  3. **push** — push notifikace (ntfy.sh)',
    en: 'Where to send notifications?\n  1. **telegram**\n  2. **email**\n  3. **push** (ntfy.sh)',
  },
  frequency: {
    cs: 'Jak casto kontrolovat?\n  1. **kazdych 30 min** (30m)\n  2. **kazdou hodinu** (1h)\n  3. **kazdych 4h** (4h)\n  4. **denne** (1d)\n  5. vlastni (napriklad "denne v 8:00")',
    en: 'How often to check?\n  1. **every 30 min** (30m)\n  2. **every hour** (1h)\n  3. **every 4h** (4h)\n  4. **daily** (1d)\n  5. custom (e.g., "daily at 8:00")',
  },
};

function getNeededQuestions(gathered, agentType) {
  const needed = [];

  // MONITOR/TRACKER needs explicit condition
  if (!gathered.condition && (agentType === 'MONITOR' || agentType === 'TRACKER')) {
    needed.push('condition');
  }

  // Always need channel and frequency
  if (!gathered.channel) needed.push('channel');
  if (!gathered.frequency) needed.push('frequency');

  return needed;
}

function formatQuestion(key, lang = 'cs') {
  const tmpl = QUESTION_TEMPLATES[key];
  return tmpl?.[lang] || tmpl?.cs || key;
}

// ─── Answer parsing ──────────────────────────────────────────────────────────

function parseChannelAnswer(input) {
  const normalized = input.toLowerCase().trim();
  if (/telegram/i.test(normalized) || normalized === '1') return 'telegram';
  if (/email/i.test(normalized) || normalized === '2') return 'email';
  if (/push|ntfy/i.test(normalized) || normalized === '3') return 'push';
  return null;
}

function parseFrequencyAnswer(input) {
  const normalized = input.toLowerCase().trim();
  if (/30\s*m|kazdych\s*30|every\s*30/i.test(normalized) || normalized === '1') return '30m';
  if (/1\s*h|kazdou\s*hod|every\s*hour/i.test(normalized) || normalized === '2') return '1h';
  if (/4\s*h|kazdych?\s*4|every\s*4/i.test(normalized) || normalized === '3') return '4h';
  if (/1\s*d|denn|daily/i.test(normalized) || normalized === '4') return '1d';
  // Try to extract cron-like schedule
  if (/v\s+\d{1,2}[:.]\d{2}|at\s+\d{1,2}[:.]\d{2}/i.test(normalized)) {
    const match = normalized.match(/(\d{1,2})[:.](\d{2})/);
    if (match) return `cron:0 ${match[1]} * * *`;
  }
  // Try interval format directly
  if (/^\d+[mhd]$/.test(normalized)) return normalized;
  return null;
}

// ─── Entry Point: Wizard Detected ────────────────────────────────────────────

export function handleAgentWizardDetected(input, context) {
  const { sessionId } = context;
  const agentType = detectAgentType(input);

  const gathered = {
    description: input,
    sourceUrl: null,
    sourceType: null,
    condition: null,
    channel: null,
    frequency: null,
    recipient: null,
  };

  // Extract hints from the original input
  // URL detection
  const urlMatch = input.match(/https?:\/\/[^\s]+/);
  if (urlMatch) {
    gathered.sourceUrl = urlMatch[0];
    gathered.sourceType = urlMatch[0].match(/rss|feed|atom/i) ? 'rss' : 'http';
  }

  // Channel hints
  if (/telegram/i.test(input)) gathered.channel = 'telegram';
  else if (/email|mail/i.test(input)) gathered.channel = 'email';
  else if (/push|ntfy/i.test(input)) gathered.channel = 'push';

  // Frequency hints
  if (/kazdou\s*hodinu|hourly|every\s*hour/i.test(input)) gathered.frequency = '1h';
  else if (/denne|daily|kazdodenni/i.test(input)) gathered.frequency = '1d';
  else if (/kazdych?\s*30/i.test(input)) gathered.frequency = '30m';

  const needed = getNeededQuestions(gathered, agentType);

  setWizardState(sessionId, {
    phase: 'GATHERING',
    originalInput: input,
    agentType,
    gathered,
    pendingQuestions: needed,
    definition: null,
    explanation: null,
  });

  // Build initial response
  const typeLabel = agentType ? ` (typ: **${agentType}**)` : '';
  let response = `🤖 **Agent Builder Wizard**${typeLabel}\n\nRozumim, vytvorime agenta: "${input}"\n\n`;

  if (needed.length > 0) {
    response += `Potrebuji jeste par informaci:\n\n`;
    response += formatQuestion(needed[0]);
  } else {
    // All info gathered from input — go directly to generating
    setWizardState(sessionId, {
      ...getWizardState(sessionId),
      phase: 'GENERATING',
    });
    response += 'Mam vsechny informace, generuji konfiguraci agenta...';
  }

  return buildResponse(response, { wizardPhase: 'GATHERING' });
}

// ─── Phase Router ────────────────────────────────────────────────────────────

export async function handleWizardInput(input, context) {
  const { sessionId } = context;
  const state = getWizardState(sessionId);

  if (!state) {
    return buildResponse('Wizard neni aktivni. Rekni mi co chces sledovat.');
  }

  switch (state.phase) {
    case 'GATHERING':
      return handleGathering(input, state, context);
    case 'GENERATING':
      return await handleGenerating(state, context);
    case 'PREVIEW':
      return handlePreviewResponse(input, state, context);
    case 'CONFIRMING':
      return await handleConfirming(input, state, context);
    default:
      clearWizardState(sessionId);
      return buildResponse('Wizard resetovan. Rekni mi co chces sledovat.');
  }
}

// ─── GATHERING phase ─────────────────────────────────────────────────────────

function handleGathering(input, state, context) {
  const { sessionId } = context;
  const { gathered, pendingQuestions } = state;

  if (pendingQuestions.length === 0) {
    // Shouldn't happen, but handle gracefully
    setWizardState(sessionId, { ...state, phase: 'GENERATING' });
    return handleWizardInput(input, context);
  }

  const currentQuestion = pendingQuestions[0];

  // Parse answer based on expected question type
  let answered = false;
  switch (currentQuestion) {
    case 'sourceUrl':
      gathered.sourceUrl = input.trim();
      gathered.sourceType = /rss|feed|atom/i.test(input) ? 'rss' : 'http';
      answered = true;
      break;
    case 'condition':
      gathered.condition = input.trim();
      answered = true;
      break;
    case 'channel': {
      const ch = parseChannelAnswer(input);
      if (ch) {
        gathered.channel = ch;
        answered = true;
      } else {
        return buildResponse('Nerozumim. Zvol prosim: **telegram**, **email**, nebo **push**.');
      }
      break;
    }
    case 'frequency': {
      const freq = parseFrequencyAnswer(input);
      if (freq) {
        gathered.frequency = freq;
        answered = true;
      } else {
        return buildResponse('Nerozumim frekvenci. Zkus napriklad: **1h**, **30m**, **denne**, nebo **v 8:00**.');
      }
      break;
    }
    default:
      // Generic answer — store as condition
      gathered.condition = input.trim();
      answered = true;
  }

  if (answered) {
    pendingQuestions.shift();
  }

  // More questions to ask?
  if (pendingQuestions.length > 0) {
    setWizardState(sessionId, { ...state, gathered, pendingQuestions });
    return buildResponse(formatQuestion(pendingQuestions[0]));
  }

  // All answered — move to GENERATING
  setWizardState(sessionId, { ...state, gathered, pendingQuestions: [], phase: 'GENERATING' });

  return buildResponse('Mam vsechny informace. Generuji konfiguraci agenta...\n\n_(tohle muze trvat par sekund)_');
}

// ─── GENERATING phase ────────────────────────────────────────────────────────

async function handleGenerating(state, context) {
  const { sessionId } = context;
  const { gathered, agentType, originalInput } = state;

  // Build enriched description for the builder
  const parts = [originalInput];
  if (gathered.sourceUrl) parts.push(`Zdroj: ${gathered.sourceUrl}`);
  if (gathered.condition) parts.push(`Podminka: ${gathered.condition}`);
  if (gathered.channel) parts.push(`Kanal: ${gathered.channel}`);
  if (gathered.frequency) {
    if (gathered.frequency.startsWith('cron:')) {
      parts.push(`Rozvrh: cron ${gathered.frequency.slice(5)}`);
    } else {
      parts.push(`Frekvence: kazdych ${gathered.frequency}`);
    }
  }
  if (agentType) parts.push(`Typ agenta: ${agentType}`);

  const enrichedDescription = parts.join('\n');

  // Try to use the LLM builder
  let definition = null;
  let explanation = '';

  try {
    // Check if LLM client is available via context
    const llmClient = context.llmClient || context.llm;

    if (llmClient) {
      const builder = new AgentBuilder({ llmClient });
      const result = await builder.buildFromDescription(enrichedDescription);

      if (result.definition && !result.error) {
        definition = result.definition;
        explanation = result.explanation || '';

        // Override channel/frequency from gathered data (user explicitly chose these)
        if (gathered.channel && definition.actions) {
          for (const action of definition.actions) {
            if (action.type === 'notify') {
              action.config = action.config || {};
              action.config.channel = gathered.channel;
            }
          }
        }
        if (gathered.frequency) {
          if (gathered.frequency.startsWith('cron:')) {
            definition.schedule = { type: 'cron', value: gathered.frequency.slice(5) };
          } else {
            definition.schedule = { type: 'interval', value: gathered.frequency };
          }
        }
      } else if (result.questions?.length > 0) {
        // Builder needs more info
        setWizardState(sessionId, {
          ...state,
          phase: 'GATHERING',
          pendingQuestions: ['condition'],
        });
        return buildResponse(`Potrebuji jeste upresntit:\n\n${result.questions.join('\n')}`);
      }
    }
  } catch (err) {
    logger.warn('AgentWizard', `LLM builder failed: ${err.message}, using template fallback`);
  }

  // Fallback: generate definition from template if LLM not available or failed
  if (!definition) {
    definition = buildTemplateDefinition(gathered, agentType);
    explanation = 'Konfigurace vygenerovana z sablon (LLM neni dostupne).';
  }

  // Validate
  const validation = validateAgentDefinition(definition);
  if (!validation.valid) {
    logger.warn('AgentWizard', `Generated definition has validation errors: ${validation.errors.join(', ')}`);
  }

  setWizardState(sessionId, {
    ...state,
    phase: 'PREVIEW',
    definition,
    explanation,
  });

  return buildPreviewResponse(definition, explanation, validation);
}

// ─── Template Definition Builder (fallback without LLM) ──────────────────────

function buildTemplateDefinition(gathered, agentType) {
  const id = slugify(gathered.description);
  const schedule = gathered.frequency?.startsWith('cron:')
    ? { type: 'cron', value: gathered.frequency.slice(5) }
    : { type: 'interval', value: gathered.frequency || '1h' };

  const sourceType = gathered.sourceType || 'http';
  const source = {
    id: 'source-1',
    type: sourceType,
    config: { url: gathered.sourceUrl || 'https://example.com/api' },
  };
  if (sourceType === 'rss') {
    source.config.maxItems = 20;
  }

  const conditionType = agentType === 'HUNTER' ? 'new_items' : 'exists';
  const condition = {
    id: 'main-condition',
    type: conditionType,
    field: `sources.source-1.data`,
  };

  const trigger = {
    id: 'main-trigger',
    condition_id: 'main-condition',
    edge: 'rising',
    cooldown: 300,
    max_fires_per_day: 10,
  };

  const notifyAction = {
    type: 'notify',
    trigger_id: 'main-trigger',
    config: {
      channel: gathered.channel || 'telegram',
      title: `Agent: ${gathered.description.substring(0, 50)}`,
      message: 'Podminka splnena — zkontrolujte data.',
      priority: 'normal',
    },
  };

  return {
    id,
    name: gathered.description.substring(0, 128),
    description: gathered.description.substring(0, 500),
    icon: agentType === 'HUNTER' ? '🔍' : agentType === 'DIGEST' ? '📰' : '🔔',
    schedule,
    sources: [source],
    conditions: [condition],
    triggers: [trigger],
    actions: [notifyAction],
  };
}

function slugify(text) {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, '')
    .replace(/\s+/g, '-')
    .substring(0, 64) || 'custom-agent';
}

// ─── PREVIEW phase ───────────────────────────────────────────────────────────

function buildPreviewResponse(definition, explanation, validation) {
  const schedule = definition.schedule?.type === 'cron'
    ? `cron: ${definition.schedule.value}`
    : `kazdych ${definition.schedule?.value || '?'}`;

  const sources = (definition.sources || [])
    .map(s => `  - **${s.id}** (${s.type}): ${s.config?.url || 'N/A'}`)
    .join('\n');

  const conditions = (definition.conditions || [])
    .map(c => `  - **${c.id}**: ${c.type} na \`${c.field || 'N/A'}\`${c.operator ? ` ${c.operator} ${c.value}` : ''}`)
    .join('\n');

  const actions = (definition.actions || [])
    .map(a => `  - **${a.type}**: ${a.config?.channel || ''} ${a.config?.title || ''}`)
    .join('\n');

  let msg = `🤖 **Nahled agenta: ${definition.name || definition.id}** ${definition.icon || ''}\n\n`;
  msg += `**ID:** \`${definition.id}\`\n`;
  msg += `**Rozvrh:** ${schedule}\n\n`;
  msg += `**Zdroje:**\n${sources}\n\n`;
  msg += `**Podminky:**\n${conditions}\n\n`;
  msg += `**Akce:**\n${actions}\n\n`;

  if (explanation) {
    msg += `**Vysvetleni:** ${explanation}\n\n`;
  }

  if (validation && !validation.valid) {
    msg += `⚠️ **Varovani:** ${validation.errors.join(', ')}\n\n`;
  }

  msg += `---\n**Spustit agenta?** (ano / ne / upravit [co zmenit])`;

  return buildResponse(msg, { wizardPhase: 'PREVIEW' });
}

function handlePreviewResponse(input, state, context) {
  const { sessionId } = context;
  const normalized = input.trim().toLowerCase();

  // YES — confirm
  if (/^(ano|jo|ok|yes|sure|jasn[eě]?|spust|start)\s*[!.]?$/i.test(normalized)) {
    setWizardState(sessionId, { ...state, phase: 'CONFIRMING' });
    return handleConfirming(input, state, context);
  }

  // NO — cancel
  if (/^(ne|no|nechci|cancel|zrus)/i.test(normalized)) {
    clearWizardState(sessionId);
    return buildResponse('Agent zrusen. Pokud chces vytvorit jineho, rekni mi.');
  }

  // MODIFY — refine
  if (/^(uprav|zmen|zmenit|modify|change|edit)/i.test(normalized)) {
    // Store modification request, try to re-generate
    const modification = input.replace(/^(uprav|zmen|zmenit|modify|change|edit)\s*/i, '').trim();
    if (modification) {
      // Apply simple modifications
      const def = state.definition;
      if (/frekvenc|interval|rozvrh|schedule/i.test(modification)) {
        const freq = parseFrequencyAnswer(modification);
        if (freq) {
          if (freq.startsWith('cron:')) {
            def.schedule = { type: 'cron', value: freq.slice(5) };
          } else {
            def.schedule = { type: 'interval', value: freq };
          }
          setWizardState(sessionId, { ...state, definition: def });
          const validation = validateAgentDefinition(def);
          return buildPreviewResponse(def, state.explanation, validation);
        }
      }
      if (/kanal|channel/i.test(modification)) {
        const ch = parseChannelAnswer(modification);
        if (ch && def.actions) {
          for (const a of def.actions) {
            if (a.type === 'notify') {
              a.config = a.config || {};
              a.config.channel = ch;
            }
          }
          setWizardState(sessionId, { ...state, definition: def });
          const validation = validateAgentDefinition(def);
          return buildPreviewResponse(def, state.explanation, validation);
        }
      }

      // Generic modification — try LLM refine or just show preview again
      return buildResponse(`Nepodarilo se automaticky upravit. Co presne chces zmenit?\n\nMuzne napriklad:\n- "uprav frekvenci na 30m"\n- "uprav kanal na email"\n- "zrus" pro zruseni`);
    }

    return buildResponse('Co chces upravit? (napriklad "uprav frekvenci na 30 minut" nebo "uprav kanal na email")');
  }

  // Unknown — remind options
  return buildResponse('Chces agenta spustit?\n- **ano** — ulozit a spustit\n- **ne** — zrusit\n- **upravit [co]** — zmenit konfiguraci');
}

// ─── CONFIRMING phase ────────────────────────────────────────────────────────

async function handleConfirming(input, state, context) {
  const { sessionId } = context;
  const definition = state.definition;

  if (!definition) {
    clearWizardState(sessionId);
    return buildResponse('Chyba: zadna definice agenta. Zkus to znovu.');
  }

  try {
    // Try to save via agent repository from context
    const repo = context.agentRepository || context.agents?.repository;
    const scheduler = context.agentScheduler || context.agents?.scheduler;

    if (repo) {
      // Save agent to DB
      repo.createAgent({
        id: definition.id,
        name: definition.name,
        description: definition.description || '',
        icon: definition.icon || '🤖',
        definition,
        enabled: true,
      });

      // Schedule if scheduler available
      if (scheduler) {
        scheduler.scheduleAgent(definition.id);
      }

      clearWizardState(sessionId);

      const schedule = definition.schedule?.type === 'cron'
        ? `(cron: ${definition.schedule.value})`
        : `(kazdych ${definition.schedule?.value || '?'})`;

      return buildResponse(
        `✅ **Agent "${definition.name}" je aktivni!**\n\n` +
        `ID: \`${definition.id}\`\n` +
        `Rozvrh: ${schedule}\n` +
        `Kanal: ${definition.actions?.find(a => a.type === 'notify')?.config?.channel || 'in_app'}\n\n` +
        `Agent bude kontrolovat zdroje dle rozvrhu a posilat notifikace pri splneni podminek.`,
        { wizardPhase: 'ACTIVE', agentId: definition.id }
      );
    }

    // No repository available — return definition for manual setup
    clearWizardState(sessionId);
    return buildResponse(
      `⚠️ Agent repository neni dostupny. Tady je vygenerovana konfigurace:\n\n` +
      '```json\n' + JSON.stringify(definition, null, 2) + '\n```\n\n' +
      `Uloz ji pres API: \`POST /api/agents\` s timto body.`,
      { wizardPhase: 'MANUAL', agentId: definition.id }
    );
  } catch (err) {
    logger.error('AgentWizard', `Failed to save agent: ${err.message}`);
    clearWizardState(sessionId);
    return buildResponse(
      `❌ Chyba pri ukladani agenta: ${err.message}\n\n` +
      'Konfigurace:\n```json\n' + JSON.stringify(definition, null, 2) + '\n```'
    );
  }
}
