// Design Handler — DESIGN intent: structured synthesis from LLM knowledge
// ══════════════════════════════════════════════════════════════════════════════
// v58.0 — Handles DESIGN intent (architecture, roadmap, sprint plan)
//
// ARCHITECTURE:
//   - NEVER calls web.search or scrape
//   - Uses LLM to synthesize structured design from knowledge
//   - Opinionated: makes decisions, offers alternatives at end
//   - Stateful: stores project context in sessionState for follow-ups
//
// Flow:
//   1. Detect project type from input
//   2. Load default stack for that project type
//   3. Build specialized system prompt (language-native, opinionated)
//   4. Call LLM with context-aware user prompt
//   5. Validate response (language + forbidden phrases)
//   6. Store project context for follow-ups
// ══════════════════════════════════════════════════════════════════════════════

import { ResponseTag, TaggedResponse, ResponseSpeaker, ChatMode } from '../controller.js';
import {
  creDecisionEngine,
  IntentType,
  DESIGN_FORBIDDEN_PHRASES,
} from '../cre-decision.js';
import { logger } from '../../core/logger.js';
import { getLanguageContext } from './utils/language.js';
import { enforceOutputContract, buildOutputGateRetryPrompt } from './utils/output-gate.js';
import { assertDesignQuality, buildDesignRetryPrompt } from './utils/quality.js';

import { readFileSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

// ─── Load design defaults ──────────────────────────────────────────────────

let DESIGN_DEFAULTS = {};
try {
  // Try multiple paths (development vs production)
  const paths = [
    join(dirname(fileURLToPath(import.meta.url)), '../../data/design-defaults.json'),
    join(dirname(fileURLToPath(import.meta.url)), '../../../data/design-defaults.json'),
    join(process.cwd(), 'data/design-defaults.json'),
  ];
  for (const p of paths) {
    try {
      DESIGN_DEFAULTS = JSON.parse(readFileSync(p, 'utf-8'));
      logger.info('DesignHandler', 'Loaded design defaults', { path: p });
      break;
    } catch { /* try next */ }
  }
} catch (e) {
  logger.warn('DesignHandler', 'Could not load design-defaults.json, using empty defaults');
}

// ─── Project type detection ────────────────────────────────────────────────

function detectProjectType(input) {
  const text = input.toLowerCase();
  if (/mobil|android|ios|flutter|react.native|kotlin\s*multi/i.test(text)) return 'mobile_app';
  if (/web\s*(app|aplikac|strán)|next\.?js|react\s+app|frontend/i.test(text)) return 'web_app';
  if (/\b(api|backend|server|endpoint|rest|graphql|microservic)\b/i.test(text)) return 'backend_api';
  if (/\b(agent|pipeline|llm|ai\s+syst|orchestr|rag)\b/i.test(text)) return 'ai_agent';
  return 'generic';
}

// ─── System prompt builders ────────────────────────────────────────────────

function buildDesignSystemPrompt(language, projectType, defaults) {
  const defaultsText = defaults && Object.keys(defaults).length > 1
    ? Object.entries(defaults)
        .filter(([k]) => !['label', 'note'].includes(k))
        .map(([k, v]) => `  ${k}: ${v}`)
        .join('\n')
    : '  (žádné specifické — rozhodneš na základě požadavků)';

  const projectLabel = defaults?.label || projectType;

  if (language === 'cs' || language === 'sk') {
    return `Jsi zkušený softwarový architekt a tech lead. Navrhuješ technická řešení.

ROLE:
- Rozhoduješ se pro konkrétní technologie a zdůvodňuješ proč.
- Neomlouváš se. Neříkáš "záleží na kontextu" ani "existuje více možností".
- Alternativy uvádíš NA KONCI, ne místo rozhodnutí.
- Mluvíš jako architekt, ne jako chatbot.

JAZYK:
- Odpovídej VÝHRADNĚ ${language === 'cs' ? 'ČESKY' : 'SLOVENSKY'}.
- NIKDY nepřepínej do polštiny, angličtiny ani jiného jazyka.
- Technické termíny piš v originále (Flutter, WireGuard, SSE, CI/CD, Docker).

STRUKTURA ODPOVĚDI (dodržuj toto pořadí):
0️⃣ Cílový stav — co bude výsledek (3-5 konkrétních bodů)
1️⃣ High-level architektura — komponenty, technologie, zodpovědnosti
    - Použij ASCII diagramy: [Mobile App] → [VPN] → [Backend]
2️⃣ Detailní architektura — struktura projektu, bezpečnost, komunikace
    - Použij code blocks pro adresářové stromy
3️⃣ Vývojový plán — sprinty s: číslo, název, cíl, implementace, testy
    - Sprint = reálně proveditelný blok (1-3 dny solo vývojář)
4️⃣ CI/CD a provoz
5️⃣ Rizika — bez obalu, s realitou, ne s diplomatickými frázemi
6️⃣ Alternativy — co jiného existuje a proč jsi to nezvolil

PRAVIDLA:
- BUĎ KONKRÉTNÍ. Čísla, jména technologií, názvy souborů, příkazy.
- KAŽDÝ sprint musí mít: cíl, co implementuješ, jak testuješ, fail scénáře.
- ZAKÁZANÉ FRÁZE: "informace jsou omezené", "doporučuji konzultovat",
  "záleží na požadavcích", "existuje více možností", "pokud potřebujete další informace",
  "neváhejte se zeptat", "rád vám pomohu"
- Pokud něco nevíš jistě, řekni to přímo: "Tady si nejsem 100% jistý, ověř X."
  NE: "Informace jsou omezené."

DEFAULT STACK pro typ projektu "${projectLabel}":
${defaultsText}
(Můžeš se odchýlit pokud máš dobrý důvod. Vždy zdůvodni.)`;
  }

  // English fallback
  return `You are an experienced software architect and tech lead. You design technical solutions.

ROLE:
- Make concrete technology decisions and justify them.
- Don't apologize. Don't say "it depends" or "there are multiple options".
- Alternatives go AT THE END, not instead of decisions.
- Speak like an architect, not a chatbot.

LANGUAGE:
- Respond EXCLUSIVELY IN ENGLISH.
- Use technical terms as-is (Flutter, WireGuard, SSE, CI/CD, Docker).

RESPONSE STRUCTURE (follow this order):
0️⃣ Target state — what the result will be (3-5 concrete points)
1️⃣ High-level architecture — components, technologies, responsibilities
2️⃣ Detailed architecture — project structure, security, communication
3️⃣ Development plan — sprints with: number, name, goal, implementation, tests
4️⃣ CI/CD and operations
5️⃣ Risks — no sugarcoating
6️⃣ Alternatives — what else exists and why you didn't choose it

RULES:
- BE SPECIFIC. Numbers, technology names, file names, commands.
- FORBIDDEN PHRASES: "limited information", "I recommend consulting",
  "it depends on requirements", "there are multiple options"

DEFAULT STACK for "${projectLabel}":
${defaultsText}`;
}

function buildDesignContinueSystemPrompt(language, project) {
  // v58.3: Role lock — re-injected on every CONTINUE turn to prevent
  // LLM from drifting to chatbot tone after 2-3 turns.
  const turnCount = project.turnCount || 1;

  const baseInstruction = language === 'cs' || language === 'sk'
    ? `═══ ROLE LOCK: ARCHITEKT (turn ${turnCount + 1}) ═══
Jsi VÝHRADNĚ softwarový architekt a tech lead. NE chatbot, NE asistent.
Toto je pokračování design session — drž profesionální, autoritativní tón.
Rozhoduj se. Neomlouvej se. Nenavrhuj "konzultaci s odborníkem".

JAZYK: Odpovídej VÝHRADNĚ ${language === 'cs' ? 'ČESKY' : 'SLOVENSKY'}.

PRAVIDLA:
- Navazuj na předchozí návrh — NEOPAKUJ co už bylo řečeno.
- Rozšiř/upřesni požadovanou sekci.
- Zachovej konzistenci s předchozími rozhodnutími (stack, architektura).
- Pokud uživatel mění direction, explicitně řekni co se mění a proč.
- Buď konkrétní — čísla, názvy, příkazy.
- ZAKÁZANÉ FRÁZE: "informace jsou omezené", "doporučuji konzultovat", "neváhejte se zeptat", "záleží na kontextu"`
    : `═══ ROLE LOCK: ARCHITECT (turn ${turnCount + 1}) ═══
You are EXCLUSIVELY a software architect and tech lead. NOT a chatbot, NOT an assistant.
This is a continuation of a design session — maintain professional, authoritative tone.
Make decisions. Don't apologize. Don't suggest "consulting an expert".

LANGUAGE: Respond EXCLUSIVELY IN ENGLISH.

RULES:
- Build on the previous design — DON'T repeat what was already said.
- Expand/refine the requested section.
- Maintain consistency with previous decisions (stack, architecture).
- If user changes direction, explicitly state what changes and why.
- Be specific — numbers, names, commands.
- FORBIDDEN: "limited information", "it depends on the context", "feel free to ask"`;

  return baseInstruction;
}

// ─── User prompt builders ──────────────────────────────────────────────────

function buildDesignUserPrompt(input, context) {
  const parts = [];

  // Include conversation history (last 3 turns max)
  if (context.history?.length > 0) {
    const historyContext = context.history
      .slice(-3)
      .map(h => {
        const hp = [];
        if (h.userInput) hp.push(`User: ${h.userInput}`);
        if (h.response?.content) {
          hp.push(`Assistant: ${h.response.content.substring(0, 300)}`);
        }
        return hp.join('\n');
      })
      .filter(p => p.length > 0)
      .join('\n---\n');

    if (historyContext) {
      parts.push(`Předchozí konverzace:\n${historyContext}\n`);
    }
  }

  parts.push(`Požadavek uživatele:\n${input}`);
  return parts.join('\n');
}

function buildDesignContinueUserPrompt(input, context, project) {
  const parts = [];

  // Project context
  parts.push(`AKTIVNÍ PROJEKT: ${project.type} (fáze: ${project.phase}, turn ${project.turnCount})`);
  if (project.defaults?.label) {
    parts.push(`Typ: ${project.defaults.label}`);
  }

  // Previous response summary (max 1500 chars to save tokens)
  const lastResponse = context.history?.slice(-1)?.[0]?.response?.content || '';
  if (lastResponse) {
    const summary = lastResponse.substring(0, 1500);
    parts.push(`\nPŘEDCHOZÍ NÁVRH (shrnutí):\n${summary}`);
    if (lastResponse.length > 1500) {
      parts.push('[...zkráceno...]');
    }
  }

  parts.push(`\nNOVÝ POŽADAVEK UŽIVATELE:\n${input}`);
  return parts.join('\n');
}

// ─── Response validation ───────────────────────────────────────────────────

function validateDesignResponse(content, language) {
  const violations = [];

  // 1. Language leak detection
  if (language === 'cs' || language === 'sk') {
    if (/\b(informacje|ograniczone|zalecam|proszę|również)\b/i.test(content)) {
      violations.push('LANGUAGE_LEAK_PL');
    }
    if (/\b(lo siento|no puedo|en español|también)\b/i.test(content)) {
      violations.push('LANGUAGE_LEAK_ES');
    }
  }

  // 2. Design-specific forbidden phrases
  for (const phrase of DESIGN_FORBIDDEN_PHRASES) {
    if (content.toLowerCase().includes(phrase.toLowerCase())) {
      violations.push(`DESIGN_FORBIDDEN: ${phrase}`);
    }
  }

  // 3. Minimum length (design docs should be substantial)
  if (content.length < 300) {
    violations.push('TOO_SHORT');
  }

  return {
    valid: violations.length === 0,
    violations,
    severity: violations.some(v => v.startsWith('LANGUAGE_LEAK')) ? 'CRITICAL' : 'WARNING',
  };
}

// ─── Main handlers ─────────────────────────────────────────────────────────

/**
 * Handle initial DESIGN decision — first turn of design project.
 *
 * @param {string} input - User's message
 * @param {Object} decision - CRE decision (ANSWER + DESIGN)
 * @param {Object} context - Handler context (sessionId, sessionState, history)
 * @returns {TaggedResponse}
 */
export async function handleDesignDecision(input, decision, context) {
  const { sessionId, sessionState } = context;

  logger.info('DesignHandler', 'DESIGN intent — starting structured synthesis', {
    sessionId,
    input: input.substring(0, 100),
  });

  try {
    const creBridge = await import('../../llm/cre-bridge.js');

    // 1. Detect project type
    const projectType = detectProjectType(input);
    const defaults = DESIGN_DEFAULTS[projectType] || DESIGN_DEFAULTS.generic || {};

    logger.info('DesignHandler', 'Project type detected', {
      projectType,
      hasDefaults: Object.keys(defaults).length > 1,
    });

    // 2. Build prompts
    const langCtx = getLanguageContext(input);
    const systemPrompt = buildDesignSystemPrompt(langCtx.language, projectType, defaults);
    const userPrompt = buildDesignUserPrompt(input, context);

    // 3. Call LLM — retry once on language/forbidden violation
    const MAX_RETRIES = 1;
    let retry = 0;
    let result;
    let currentUserPrompt = userPrompt;

    while (retry <= MAX_RETRIES) {
      result = await creBridge.generateChatResponse(currentUserPrompt, systemPrompt, {
        sessionId: `design-${sessionId}`,
        temperature: retry === 0 ? 0.6 : 0.4,  // Lower temp = more structured
      });

      // 4a. Validate general forbidden phrases
      const generalValidation = creDecisionEngine.validateResponse(result.content);
      if (!generalValidation.valid) {
        logger.warn('DesignHandler', 'General forbidden phrases detected', {
          violations: generalValidation.violations,
          retry,
        });
        if (retry < MAX_RETRIES) {
          currentUserPrompt = `${userPrompt}\n\n⚠️ PŘEDCHOZÍ ODPOVĚĎ OBSAHOVALA ZAKÁZANÉ FRÁZE: ${generalValidation.violations.join(', ')}\nOprav to a odpověz znovu. BEZ omluv, BEZ hedgingu.`;
          retry++;
          continue;
        }
      }

      // 4b. Validate DESIGN-specific quality
      const designValidation = validateDesignResponse(result.content, langCtx.language);
      if (!designValidation.valid) {
        logger.warn('DesignHandler', 'DESIGN validation failed', {
          violations: designValidation.violations,
          severity: designValidation.severity,
          retry,
        });
        if (designValidation.severity === 'CRITICAL' && retry < MAX_RETRIES) {
          const langInstruction = langCtx.language === 'cs'
            ? 'ODPOVÍDEJ VÝHRADNĚ ČESKY. ŽÁDNÁ polština, angličtina ani jiný jazyk.'
            : 'Respond EXCLUSIVELY in the requested language.';
          currentUserPrompt = `${userPrompt}\n\n⚠️ KRITICKÁ CHYBA: ${designValidation.violations.join(', ')}\n${langInstruction}`;
          retry++;
          continue;
        }
      }

      // 4c. D6 output gate (generic)
      const gateVerdict = enforceOutputContract(result.content, {
        intent: 'DESIGN',
        responseIntent: null,
      });
      if (!gateVerdict.ok && retry < MAX_RETRIES) {
        logger.warn('DesignHandler', 'D6 gate failed', {
          dimension: gateVerdict.failDimension,
          reason: gateVerdict.reason,
          retry,
        });
        currentUserPrompt = buildOutputGateRetryPrompt(currentUserPrompt, gateVerdict, { language: langCtx.language });
        retry++;
        continue;
      }

      // 4d. v58.0 Sprint 4: DESIGN quality assertion (hedging, language, structure)
      const qualityCheck = assertDesignQuality(result.content, input);
      if (!qualityCheck.valid && retry < MAX_RETRIES) {
        logger.warn('DesignHandler', 'DESIGN quality gate → RETRY', {
          reason: qualityCheck.reason,
          severity: qualityCheck.severity,
          contentLength: result.content.length,
          retry,
        });
        const retryInstruction = qualityCheck.severity === 'CRITICAL'
          ? `⚠️ KRITICKÁ CHYBA: ${qualityCheck.reason}\nODPOVÍDEJ VÝHRADNĚ ČESKY. Oprav chybu a odpověz znovu.`
          : `⚠️ KVALITA NEDOSTATEČNÁ: ${qualityCheck.reason}\nBuď KONKRÉTNĚJŠÍ. Rozhoduj se. Žádný hedging.`;
        currentUserPrompt = `${userPrompt}\n\n${retryInstruction}`;
        retry++;
        continue;
      }
      if (!qualityCheck.valid) {
        logger.warn('DesignHandler', 'DESIGN quality gate failed after retry — returning degraded', {
          reason: qualityCheck.reason,
          severity: qualityCheck.severity,
        });
      }

      break;  // All gates passed
    }

    // 5. Store project context for follow-ups (uses SessionState methods)
    if (sessionState) {
      if (typeof sessionState.setActiveDesignProject === 'function') {
        sessionState.setActiveDesignProject({
          type: projectType,
          defaults,
          startedAt: new Date().toISOString(),
          phase: 'design',
          turnCount: 1,
          language: langCtx.language,
        });
      } else {
        // Fallback for older SessionState without v58.0 methods
        sessionState.activeDesignProject = {
          type: projectType,
          defaults,
          startedAt: new Date().toISOString(),
          phase: 'design',
          turnCount: 1,
          language: langCtx.language,
        };
      }
      sessionState.recordDecision(decision, input);
      // Persist to storage (survives page reload)
      if (typeof sessionState.saveToStorage === 'function') {
        sessionState.saveToStorage();
      }
    }

    // 6. Quality metrics telemetry (v58.3 — log, not gate)
    const finalQuality = assertDesignQuality(result.content, input);
    logger.info('DesignMetrics', 'DESIGN response quality', {
      intent: 'DESIGN',
      projectType,
      sections_present: finalQuality.details?.sections ?? '?',
      forbidden_hits: finalQuality.details?.hedging?.length ?? 0,
      length: result.content.length,
      retries: retry,
      model: result.model,
      duration: result.duration,
      valid: finalQuality.valid,
      language: langCtx.language,
    });

    // 7. Return result
    const tag = new ResponseTag({
      speaker: ResponseSpeaker.SYSTEM,
      mode: ChatMode.CONVERSATION,
      confidence: 0.9,
      canExecute: false,
      metadata: {
        model: result.model,
        duration: result.duration,
        decision: decision.toJSON?.() || decision,
        designProject: { type: projectType, phase: 'design' },
      },
    });

    return new TaggedResponse({ content: result.content, tag });

  } catch (err) {
    logger.error('DesignHandler', `DESIGN LLM call failed: ${err.message}`);

    const tag = new ResponseTag({
      speaker: ResponseSpeaker.SYSTEM,
      mode: ChatMode.CONVERSATION,
      confidence: 1.0,
      canExecute: false,
      metadata: { error: true, errorType: 'DESIGN_LLM_FAILED' },
    });

    return new TaggedResponse({
      content: `⚠️ **Chyba při generování návrhu**\n\nSystém nemohl vytvořit technický návrh.\n\n` +
               `**Důvod:** ${err.message}\n\nZkuste to prosím znovu.`,
      tag,
    });
  }
}

/**
 * Handle DESIGN_CONTINUE — follow-up within active design project.
 *
 * @param {string} input - User's follow-up message
 * @param {Object} decision - CRE decision (ANSWER + DESIGN)
 * @param {Object} context - Handler context
 * @returns {TaggedResponse}
 */
export async function handleDesignContinue(input, decision, context) {
  const { sessionId, sessionState } = context;
  const project = sessionState?.activeDesignProject;

  if (!project) {
    // No active project — fall back to initial design
    logger.warn('DesignHandler', 'DESIGN_CONTINUE without active project, treating as new DESIGN');
    return handleDesignDecision(input, decision, context);
  }

  logger.info('DesignHandler', 'DESIGN_CONTINUE — refining project', {
    sessionId,
    projectType: project.type,
    turnCount: project.turnCount,
    input: input.substring(0, 100),
  });

  try {
    const creBridge = await import('../../llm/cre-bridge.js');

    const langCtx = getLanguageContext(input);
    const systemPrompt = buildDesignContinueSystemPrompt(
      project.language || langCtx.language,
      project
    );
    const userPrompt = buildDesignContinueUserPrompt(input, context, project);

    const result = await creBridge.generateChatResponse(userPrompt, systemPrompt, {
      sessionId: `design-${sessionId}`,
      temperature: 0.5,
    });

    // Validate — basic language/forbidden + design quality
    const designValidation = validateDesignResponse(result.content, project.language || langCtx.language);
    if (!designValidation.valid) {
      logger.warn('DesignHandler', 'DESIGN_CONTINUE validation issues', {
        violations: designValidation.violations,
      });
    }

    // v58.0 Sprint 4: Quality gate (relaxed for follow-ups — no retry, just log)
    const qualityCheck = assertDesignQuality(result.content, input, { isFollowUp: true });
    if (!qualityCheck.valid) {
      logger.warn('DesignHandler', 'DESIGN_CONTINUE quality issues (degraded)', {
        reason: qualityCheck.reason,
        details: qualityCheck.details,
      });
    }

    // Update project context
    if (typeof sessionState.updateDesignProject === 'function') {
      sessionState.updateDesignProject({
        turnCount: project.turnCount + 1,
        phase: detectDesignPhase(input, project),
      });
    } else {
      project.turnCount++;
      project.phase = detectDesignPhase(input, project);
      project.updatedAt = new Date().toISOString();
    }

    if (sessionState) {
      sessionState.recordDecision(decision, input);
      if (typeof sessionState.saveToStorage === 'function') {
        sessionState.saveToStorage();
      }
    }

    // v58.3: Quality metrics telemetry (CONTINUE)
    logger.info('DesignMetrics', 'DESIGN_CONTINUE response quality', {
      intent: 'DESIGN_CONTINUE',
      projectType: project.type,
      turn: project.turnCount + 1,
      sections_present: qualityCheck.details?.sections ?? '?',
      forbidden_hits: qualityCheck.details?.hedging?.length ?? 0,
      length: result.content.length,
      retries: 0,
      model: result.model,
      duration: result.duration,
      valid: qualityCheck.valid,
      language: project.language,
    });

    const tag = new ResponseTag({
      speaker: ResponseSpeaker.SYSTEM,
      mode: ChatMode.CONVERSATION,
      confidence: 0.9,
      canExecute: false,
      metadata: {
        model: result.model,
        duration: result.duration,
        decision: decision.toJSON?.() || decision,
        designProject: { type: project.type, phase: project.phase, turn: project.turnCount },
      },
    });

    return new TaggedResponse({ content: result.content, tag });

  } catch (err) {
    logger.error('DesignHandler', `DESIGN_CONTINUE failed: ${err.message}`);

    const tag = new ResponseTag({
      speaker: ResponseSpeaker.SYSTEM,
      mode: ChatMode.CONVERSATION,
      confidence: 1.0,
      canExecute: false,
      metadata: { error: true, errorType: 'DESIGN_CONTINUE_FAILED' },
    });

    return new TaggedResponse({
      content: `⚠️ **Chyba při zpracování**\n\n${err.message}\n\nZkuste přeformulovat požadavek.`,
      tag,
    });
  }
}

// ─── Helpers ───────────────────────────────────────────────────────────────

/**
 * Detect current design phase from input context.
 */
function detectDesignPhase(input, project) {
  if (/sprint|vývojov|implementa/i.test(input)) return 'sprint_planning';
  if (/architektur|struktur|komponen/i.test(input)) return 'architecture';
  if (/test|QA|kvalit/i.test(input)) return 'testing';
  if (/deploy|nasazen|CI|CD|provoz/i.test(input)) return 'deployment';
  if (/rizik|risk/i.test(input)) return 'risk_assessment';
  if (/stack|technologi|framework/i.test(input)) return 'tech_selection';
  return project.phase || 'design';
}

/**
 * Check if input is an explicit factual query that should escape DESIGN mode.
 * Used by conversation.js to allow SEARCH during active DESIGN project.
 */
export function isExplicitFactQuery(input) {
  return [
    /jak[aá]\s+je\s+(nejnov[eě]j[sš][ií]|aktu[aá]ln[ií]|posledn[ií])\s+verze/i,
    /kolik\s+stoj[ií]/i,
    /cena\s+/i,
    /what\s+is\s+the\s+(latest|current)\s+version/i,
    /how\s+much\s+(does|is)/i,
    /\b(najdi|vyhledej|search|find|look\s+up)\b/i,
  ].some(p => p.test(input));
}

export default {
  handleDesignDecision,
  handleDesignContinue,
  isExplicitFactQuery,
  detectProjectType,
  validateDesignResponse,
};
