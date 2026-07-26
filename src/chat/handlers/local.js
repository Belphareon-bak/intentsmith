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
  formatChristmasResponse,
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
      type: 'moon',
      answer: daysToFullMoon,
      unit: 'dní',
      date: nextFullMoon.toLocaleDateString('cs-CZ'),
      today: todayStr,
      explanation: `Příští úplněk bude za ${daysToFullMoon} dní (${nextFullMoon.toLocaleDateString('cs-CZ')}), počítáno od ${todayStr}`,
    };
  }

  // Days until Christmas (v72: added "vanoc" without diacritics)
  if (/váno|vanoc|christmas/i.test(input)) {
    const christmas = new Date(now.getFullYear(), 11, 24);
    if (christmas < now) {
      christmas.setFullYear(christmas.getFullYear() + 1);
    }
    const days = Math.ceil((christmas - now) / (1000 * 60 * 60 * 24));
    const todayStr = now.toLocaleDateString('cs-CZ');
    return {
      type: 'christmas',
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
 * Normalize Czech natural-language math into a standard expression.
 * "847 děleno 7" → "847 / 7", "3 krát 5" → "3 * 5", "2 na druhou" → "2 ** 2"
 */
export function normalizeCzechMath(input) {
  let expr = input.toLowerCase().trim();

  // Strip common Czech prefixes: "vypočítej", "kolik je", "spočítej", etc.
  expr = expr
    .replace(/^(vypočít[ea][jž]\s*(mi\s*(prosím\s*)?)?)/i, '')
    .replace(/^(spočít[ea][jž]\s*(mi\s*(prosím\s*)?)?)/i, '')
    .replace(/^(kolik\s+je\s*)/i, '')
    .replace(/^(jaký\s+je\s+výsledek\s*)/i, '')
    .trim();

  // Division: "děleno", "lomeno", "÷"
  expr = expr.replace(/\s*(děleno|lomeno|÷)\s*/gi, ' / ');

  // Multiplication: "krát", "×", "násobek"
  expr = expr.replace(/\s*(krát|×)\s*/gi, ' * ');

  // Addition: "plus", "a"(between numbers)
  expr = expr.replace(/\s+plus\s+/gi, ' + ');
  expr = expr.replace(/(\d)\s+a\s+(\d)/g, '$1 + $2');

  // Subtraction: "mínus", "méně"
  expr = expr.replace(/\s*(mínus|minus|méně)\s*/gi, ' - ');

  // Power: "na druhou" → **2, "na třetí" → **3
  expr = expr.replace(/(\d+)\s+na\s+druhou/gi, '$1 ** 2');
  expr = expr.replace(/(\d+)\s+na\s+t[řr]et[ií]/gi, '$1 ** 3');

  // Square root: "odmocnina z 144" → Math.sqrt(144)
  expr = expr.replace(/odmocnina\s+z\s+(\d+)/gi, 'Math.sqrt($1)');

  // Percent: "15 procent z 200" → (15/100)*200
  expr = expr.replace(/(\d+)\s*procent\s+z\s+(\d+)/gi, '($1/100)*$2');

  // Clean remaining Czech words (keep digits, operators, parens, dots)
  // Protect Math.sqrt and ** from being stripped
  const sqrtPlaceholder = '\x00SQ\x00';
  const powPlaceholder = '\x00PW\x00';
  expr = expr.replace(/Math\.sqrt/g, sqrtPlaceholder);
  expr = expr.replace(/\*\*/g, powPlaceholder);
  expr = expr.replace(/[a-záčďéěíňóřšťúůýž]+/gi, '').trim();
  expr = expr.replace(new RegExp(sqrtPlaceholder.replace(/\x00/g, '\\x00'), 'g'), 'Math.sqrt');
  expr = expr.replace(new RegExp(powPlaceholder.replace(/\x00/g, '\\x00'), 'g'), '**');

  // Collapse extra spaces
  expr = expr.replace(/\s{2,}/g, ' ').trim();

  return expr || null;
}

/**
 * Compute math expressions
 * Supports both standard notation (5+3) and Czech natural language (847 děleno 7)
 * v82.1: DPH/VAT calculation — "DPH z 10000 při 21%" → 2100
 */
export function computeMath(input) {
  const nonFiniteResult = (expression, result) => ({
    answer: NaN,
    expression,
    error: 'non_finite_result',
    nonFiniteResult: Number.isNaN(result) ? 'NaN' : String(result),
    explanation: `${expression} does not have a finite numeric result`,
  });

  // v82.1: DPH/VAT — "DPH z 10000 Kč při sazbě 21%", "DPH z 5000 (15%)"
  const dphMatch = input.match(/dph\s+(?:z\s+)?(?:částky\s+)?(\d[\d\s]*)\s*(?:kč\s*)?(?:při\s+(?:sazbě\s+)?)?(\d+)\s*%/i);
  if (dphMatch) {
    const base = parseFloat(dphMatch[1].replace(/\s/g, ''));
    const rate = parseFloat(dphMatch[2]);
    const vat = Math.round(base * rate / 100 * 100) / 100;
    const total = base + vat;
    return {
      answer: vat,
      expression: `DPH ${rate}% z ${base}`,
      explanation: `Základ: ${base} Kč, DPH ${rate}%: ${vat} Kč, celkem s DPH: ${total} Kč`,
    };
  }
  // v72: Factorial — "5!", "10!"
  const factMatch = input.match(/(\d+)\s*!/);
  if (factMatch) {
    const n = parseInt(factMatch[1], 10);
    if (n >= 0 && n <= 170) { // 170! is max safe for JS floats
      let result = 1;
      for (let i = 2; i <= n; i++) result *= i;
      return {
        answer: result,
        expression: `${n}!`,
        explanation: `${n}! = ${result}`,
      };
    }
  }

  // v72: Power — "2**10", "3 ** 4", "2^8"
  const powMatch = input.match(/(\d+)\s*(?:\*\*|\^)\s*(\d+)/);
  if (powMatch) {
    const base = parseFloat(powMatch[1]);
    const exp = parseFloat(powMatch[2]);
    const result = Math.pow(base, exp);
    return {
      answer: result,
      expression: `${powMatch[1]} ** ${powMatch[2]}`,
      explanation: `${powMatch[1]} ** ${powMatch[2]} = ${result}`,
    };
  }

  // Try standard notation — extract full arithmetic expression from input
  const exprMatch = input.match(/([\d]+(?:\s*[+\-*/]\s*[\d]+)+)/);
  if (exprMatch) {
    const expr = exprMatch[1].replace(/\s+/g, '');
    // Safe eval: only digits and basic operators
    if (/^[\d+\-*/().]+$/.test(expr)) {
      try {
        const result = Function('"use strict"; return (' + expr + ')')();
        if (typeof result === 'number' && Number.isFinite(result)) {
          return {
            answer: result,
            expression: expr,
            explanation: `${expr} = ${result}`,
          };
        }
        if (typeof result === 'number') return nonFiniteResult(expr, result);
      } catch {
        // fall through to Czech normalization
      }
    }
  }

  // Try Czech natural language normalization
  const normalized = normalizeCzechMath(input);
  if (normalized && /[\d]/.test(normalized)) {
    try {
      // Safe eval: only allow digits, operators, parens, dots, Math.sqrt, **
      if (/^[\d\s+\-*/().%]*(?:Math\.sqrt\([\d.]+\))?[\d\s+\-*/().%]*$/.test(normalized)
          || /\*\*/.test(normalized)) {
        const result = Function('"use strict"; return (' + normalized + ')')();
        if (typeof result === 'number' && Number.isFinite(result)) {
          return {
            answer: result,
            expression: normalized,
            explanation: `${normalized} = ${result}`,
          };
        }
        if (typeof result === 'number') return nonFiniteResult(normalized, result);
      }
    } catch {
      // eval failed — fall through
    }
  }

  return { answer: null, error: 'Could not parse math expression' };
}

/**
 * Compute date/time queries
 */
export function computeDate(input) {
  const now = new Date();

  if (/kolik\s+(je\s+)?hodin|what.*time|current.*time/i.test(input)) {
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
      if (/kolik\s+(je\s+)?hodin|what.*time|current.*time/i.test(input)) {
        return formatTimeResponse(lang);
      }
      return formatTodayResponse(lang);

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
