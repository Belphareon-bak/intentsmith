// handlers/local.js — LOCAL computation handlers (TERMINAL)
// ══════════════════════════════════════════════════════════════════════════════
// v44.7 - LOCAL is special: deterministic computation, no external APIs
// Examples: "kdy bude úplněk?", "kolik je hodin?", "5+3"
// INVARIANT: LOCAL crosses the durable M2 direct-tool boundary and NEVER goes
// to web.search or any effect provider.
// ══════════════════════════════════════════════════════════════════════════════

import { ResponseTag, TaggedResponse, ResponseSpeaker, ChatMode } from '../controller.js';
import { logger } from '../../core/logger.js';
import { getLanguageContext } from './utils/language.js';
import {
  formatTodayResponse,
  formatTimeResponse,
  formatMathResponse,
  formatMoonResponse,
  formatChristmasResponse,
  formatDate,
} from './utils/local-i18n.js';

/**
 * Handle LOCAL decision - TERMINAL direct computation
 */
export async function handleLocalDecision(input, decision, context, dependencies = {}) {
  const { sessionState } = context;
  const handler = decision.metadata?.handler || 'local.date';

  logger.info('HandleLocal', `Executing LOCAL decision (TERMINAL)`, {
    handler,
    input: input.substring(0, 50),
  });

  let result;
  let durableToolResult = null;
  try {
    let executor = dependencies.toolExecutor;
    if (!executor) {
      const module = await import('../../executor/tool-executor.js');
      executor = module.toolExecutor;
    }
    if (!executor || typeof executor.execute !== 'function') {
      throw Object.assign(new Error('M2 tool runtime is unavailable'), {
        code: 'TOOL_EFFECT_AUTHORITY_UNAVAILABLE',
      });
    }
    const execution = await executor.execute({
      type: 'TOOL_CALL',
      tools: [handler],
      intent: decision.intent,
    }, {
      ...context,
      input,
      query: input,
      maxAutoRetries: 0,
    });
    durableToolResult = execution.toolResults?.[0] || null;
    if (!durableToolResult?.success) {
      const error = new Error(durableToolResult?.error || 'Durable local tool failed');
      error.code = durableToolResult?.errorCode || execution.errorCode || 'M2_TOOL_RESULT_UNCOMMITTED';
      error.m2AuthorityFailure = durableToolResult?.meta?.m2AuthorityFailure === true;
      throw error;
    }
    const output = durableToolResult.data;
    if (handler === 'local.math') {
      result = { expression: output.expression, answer: output.result };
    } else if (handler === 'local.calendar') {
      result = {
        type: output.type,
        answer: output.answer,
        unit: output.unit,
        date: output.date,
        today: output.today,
        explanation: output.explanation,
      };
    } else {
      const exact = new Date(output.timestamp);
      const asksForTime = /kolik\s+(je\s+)?hodin|what.*time|current.*time/i.test(input);
      result = {
        answer: asksForTime
          ? exact.toLocaleTimeString('cs-CZ')
          : exact.toLocaleDateString('cs-CZ'),
        dayOfWeek: output.dayOfWeek,
        timestamp: output.timestamp,
        explanation: asksForTime
          ? `Aktuální čas: ${exact.toLocaleTimeString('cs-CZ')}`
          : `Dnes je ${output.dayOfWeek}, ${exact.toLocaleDateString('cs-CZ')}`,
      };
    }
  } catch (err) {
    logger.error('HandleLocal', `Computation failed: ${err.message}`);
    return new TaggedResponse({
      content: '🔒 Lokální nástroj nemá ověřený M2 výsledek. Náhradní odpověď nebyla vytvořena.',
      tag: new ResponseTag({
        speaker: ResponseSpeaker.SYSTEM,
        mode: context.hasActiveProject ? ChatMode.PROJECT : ChatMode.CONVERSATION,
        confidence: 1,
        canExecute: false,
        metadata: {
          decision: decision.toJSON(),
          handler,
          securityBlocked: true,
          fallbackSuppressed: true,
          error: err.code || 'M2_TOOL_RESULT_UNCOMMITTED',
          m2AuthorityFailure: err.m2AuthorityFailure === true,
        },
      }),
    });
  }

  // Record successful decision
  if (sessionState) {
    sessionState.recordDecision(decision, input);
  }

  const tag = new ResponseTag({
    speaker: ResponseSpeaker.SYSTEM,
    mode: ChatMode.CONVERSATION,
    confidence: decision.confidence,
    canExecute: false,
    metadata: {
      decision: decision.toJSON(),
      localComputation: true,
      handler,
      computationResult: result,
      toolRequestId: durableToolResult?.meta?.m2ToolRequestId || null,
      toolTerminalStatus: durableToolResult?.meta?.m2ToolStatus || null,
    },
  });

  // Q4: Detect user language for i18n response formatting
  const langCtx = context.langCtx || getLanguageContext(input);
  const lang = langCtx?.language || 'cs';

  const content = formatLocalResponse(input, result, handler, lang);

  return new TaggedResponse({
    content,
    tag,
  });
}

export {
  computeCalendar,
  computeDate,
  computeMath,
  normalizeCzechMath,
} from '../../tools/local-computations.js';

/**
 * Format LOCAL computation result for user
 * Q4: Now i18n-aware — formats response in user's detected language
 */
export function formatLocalResponse(input, result, handler, lang = 'cs') {
  if (result.error) {
    return lang === 'en'
      ? `⚠️ Calculation failed: ${result.error}`
      : `⚠️ Nepodařilo se vypočítat: ${result.error}`;
  }

  // Q4: Use i18n-aware formatters based on handler type
  switch (handler) {
    case 'local.date':
      {
        const exact = Number.isSafeInteger(result.timestamp)
          ? new Date(result.timestamp)
          : null;
      if (/kolik\s+(je\s+)?hodin|what.*time|current.*time/i.test(input)) {
          return formatTimeResponse(lang, exact);
        }
        return formatTodayResponse(lang, exact);
      }

    case 'local.math':
      if (result.expression && result.answer !== null) {
        // v82.1: DPH results include richer explanation
        if (result.explanation && /DPH|VAT/i.test(result.expression)) {
          return `📊 **${result.explanation}**`;
        }
        return formatMathResponse(result.expression, result.answer, lang);
      }
      break;

    case 'local.calendar':
      if (result.answer && result.date && result.today) {
        const calDate = lang !== 'cs'
          ? formatDate(new Date(result.date.split('.').reverse().join('-')), lang)
          : result.date;
        const todayDate = lang !== 'cs'
          ? formatDate(new Date(result.today.split('.').reverse().join('-')), lang)
          : result.today;
        // v72: Distinguish moon vs christmas calendar results
        if (result.type === 'christmas') {
          return formatChristmasResponse(result.answer, calDate, todayDate, lang);
        }
        return formatMoonResponse(result.answer, calDate, todayDate, lang);
      }
      break;
  }

  // Fallback: use explanation if available
  if (result.explanation) {
    return `📊 **${result.explanation}**`;
  }

  if (result.answer !== null && result.answer !== undefined) {
    return `📊 **${lang === 'en' ? 'Result:' : 'Výsledek:'} ${result.answer}${result.unit ? ' ' + result.unit : ''}`;
  }

  return lang === 'en' ? `📊 Computation complete.` : `📊 Výpočet dokončen.`;
}
