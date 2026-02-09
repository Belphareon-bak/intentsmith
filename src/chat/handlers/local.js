// handlers/local.js — LOCAL computation handlers (TERMINAL)
// ══════════════════════════════════════════════════════════════════════════════
// v44.7 - LOCAL is special: deterministic computation, no external APIs
// Examples: "kdy bude úplněk?", "kolik je hodin?", "5+3"
// INVARIANT: LOCAL NEVER calls tools, NEVER goes to web.search
// ══════════════════════════════════════════════════════════════════════════════

import { ResponseTag, TaggedResponse, ResponseSpeaker, ChatMode } from '../controller.js';
import { logger } from '../../core/logger.js';
import { getLanguageContext } from './utils/language.js';
import {
  formatTodayResponse,
  formatTimeResponse,
  formatMathResponse,
  formatMoonResponse,
  formatDate,
} from './utils/local-i18n.js';

/**
 * Handle LOCAL decision - TERMINAL direct computation
 */
export async function handleLocalDecision(input, decision, context) {
  const { sessionState } = context;
  const handler = decision.metadata?.handler || 'local.date';

  logger.info('HandleLocal', `Executing LOCAL decision (TERMINAL)`, {
    handler,
    input: input.substring(0, 50),
  });

  let result;
  try {
    switch (handler) {
      case 'local.calendar':
        result = computeCalendar(input);
        break;
      case 'local.math':
        result = computeMath(input);
        break;
      case 'local.date':
      default:
        result = computeDate(input);
        break;
    }
  } catch (err) {
    logger.error('HandleLocal', `Computation failed: ${err.message}`);
    result = { error: err.message, answer: null };
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

/**
 * Compute calendar-related queries (moon phases, days until events)
 */
export function computeCalendar(input) {
  const now = new Date();

  // Moon phase calculation (simplified)
  if (/úplněk|uplnek|full.*moon/i.test(input)) {
    const lunarCycle = 29.53;
    const refFullMoon = new Date('2025-01-13');
    const daysSinceRef = (now - refFullMoon) / (1000 * 60 * 60 * 24);
    const daysInCurrentCycle = daysSinceRef % lunarCycle;
    const daysToFullMoon = Math.round(lunarCycle - daysInCurrentCycle);

    const nextFullMoon = new Date(now);
    nextFullMoon.setDate(nextFullMoon.getDate() + daysToFullMoon);

    // v57.3: Include today's date for transparency
    const todayStr = now.toLocaleDateString('cs-CZ');

    return {
      answer: daysToFullMoon,
      unit: 'dní',
      date: nextFullMoon.toLocaleDateString('cs-CZ'),
      today: todayStr,
      explanation: `Příští úplněk bude za ${daysToFullMoon} dní (${nextFullMoon.toLocaleDateString('cs-CZ')}), počítáno od ${todayStr}`,
    };
  }

  // Days until Christmas
  if (/váno|christmas/i.test(input)) {
    const christmas = new Date(now.getFullYear(), 11, 24);
    if (christmas < now) {
      christmas.setFullYear(christmas.getFullYear() + 1);
    }
    const days = Math.ceil((christmas - now) / (1000 * 60 * 60 * 24));
    const todayStr = now.toLocaleDateString('cs-CZ');
    return {
      answer: days,
      unit: 'dní',
      date: christmas.toLocaleDateString('cs-CZ'),
      today: todayStr,
      explanation: `Do Vánoc zbývá ${days} dní (od ${todayStr})`,
    };
  }

  return computeDate(input);
}

/**
 * Compute math expressions
 */
export function computeMath(input) {
  const mathMatch = input.match(/(\d+)\s*([+\-*/])\s*(\d+)/);
  if (mathMatch) {
    const [, a, op, b] = mathMatch;
    const numA = parseFloat(a);
    const numB = parseFloat(b);
    let result;

    switch (op) {
      case '+': result = numA + numB; break;
      case '-': result = numA - numB; break;
      case '*': result = numA * numB; break;
      case '/': result = numB !== 0 ? numA / numB : NaN; break;
      default: result = NaN;
    }

    return {
      answer: result,
      expression: `${a} ${op} ${b}`,
      explanation: `${a} ${op} ${b} = ${result}`,
    };
  }

  return { answer: null, error: 'Could not parse math expression' };
}

/**
 * Compute date/time queries
 */
export function computeDate(input) {
  const now = new Date();

  if (/hodin|time/i.test(input)) {
    return {
      answer: now.toLocaleTimeString('cs-CZ'),
      explanation: `Aktuální čas: ${now.toLocaleTimeString('cs-CZ')}`,
    };
  }

  if (/datum|date|den|day/i.test(input)) {
    const dayNames = ['neděle', 'pondělí', 'úterý', 'středa', 'čtvrtek', 'pátek', 'sobota'];
    return {
      answer: now.toLocaleDateString('cs-CZ'),
      dayOfWeek: dayNames[now.getDay()],
      explanation: `Dnes je ${dayNames[now.getDay()]}, ${now.toLocaleDateString('cs-CZ')}`,
    };
  }

  return {
    answer: now.toLocaleString('cs-CZ'),
    explanation: `Aktuální datum a čas: ${now.toLocaleString('cs-CZ')}`,
  };
}

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
      if (/hodin|time/i.test(input)) {
        return formatTimeResponse(lang);
      }
      return formatTodayResponse(lang);

    case 'local.math':
      if (result.expression && result.answer !== null) {
        return formatMathResponse(result.expression, result.answer, lang);
      }
      break;

    case 'local.calendar':
      if (result.answer && result.date && result.today) {
        const moonDate = lang !== 'cs'
          ? formatDate(new Date(result.date.split('.').reverse().join('-')), lang)
          : result.date;
        const todayDate = lang !== 'cs'
          ? formatDate(new Date(result.today.split('.').reverse().join('-')), lang)
          : result.today;
        return formatMoonResponse(result.answer, moonDate, todayDate, lang);
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
