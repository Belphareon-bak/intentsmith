// Finance Safety Policy v50.0
// ══════════════════════════════════════════════════════════════════════════════
//
// Handles: Investment advice, Financial guarantees, Market predictions
//
// Scope:
//   - Investment recommendations with guaranteed returns
//   - Specific buy/sell signals
//   - Market timing advice
//   - Tax evasion
//
// Key Principle:
//   - Can discuss, compare, explain → SYNTHESIS
//   - Cannot guarantee, recommend specific investments → REFUSE
//
// ══════════════════════════════════════════════════════════════════════════════

import {
  SafetyAction,
  SafetyDomain,
  createSafetyVerdict,
} from '../engine.js';

// ════════════════════════════════════════════════════════════════════════════
// PATTERN DEFINITIONS
// ════════════════════════════════════════════════════════════════════════════

/**
 * Patterns that ALWAYS result in REFUSE
 */
const ForbiddenPatterns = [
  // Guaranteed returns
  {
    pattern: /\bguarantee\b.*\b(return|profit|income|gain)\b/i,
    reason_code: 'NO_INVESTMENT_GUARANTEE',
    template: 'Nemohu garantovat žádné investiční výnosy.',
    alternatives: [
      'vysvětlit historické výnosy a jejich variabilitu',
      'diskutovat o rizikových profilech různých aktiv',
      'pomoci s diverzifikací portfolia',
    ],
  },
  {
    pattern: /\bwill (definitely|certainly|surely)\b.*\b(increase|go up|rise|grow|profit)\b/i,
    reason_code: 'NO_PRICE_PREDICTION',
    template: 'Nemohu předpovídat s jistotou pohyb cen.',
    alternatives: [
      'analyzovat historické trendy',
      'vysvětlit faktory ovlivňující cenu',
      'diskutovat o různých scénářích',
    ],
  },

  // Specific investment signals
  {
    pattern: /\b(buy|sell|invest in)\b.*\b(now|today|immediately)\b.*\b(stock|crypto|bitcoin|ethereum)\b/i,
    reason_code: 'NO_TIMING_ADVICE',
    template: 'Nemohu dávat konkrétní signály k nákupu nebo prodeji.',
    alternatives: [
      'vysvětlit DCA strategii (pravidelné investování)',
      'diskutovat o fundamentální vs technické analýze',
      'pomoci pochopit tvůj investiční horizont',
    ],
  },

  // Crypto "what to buy for profit"
  {
    pattern: /\b(which|what)\b.*\b(crypto|coin|token)\b.*\b(buy|invest)\b.*\b(profit|gain|money|rich)\b/i,
    reason_code: 'NO_CRYPTO_PICKS',
    template: 'Nemohu doporučit konkrétní kryptoměny k zaručenému zhodnocení.',
    alternatives: [
      'porovnat dlouhodobé fundamenty různých projektů',
      'vysvětlit rizikové profily (Bitcoin vs altcoiny)',
      'navrhnout scénáře bez garancí',
    ],
  },
  {
    // Czech: "Jakou kryptoměnu koupit abych zbohatl"
    pattern: /\b(co|jak[áéou]u?|kter[áéou]u?)\b.*\b(krypto|coin|měn)/i,
    reason_code: 'NO_CRYPTO_PICKS',
    template: 'Nemohu doporučit konkrétní kryptoměny k zaručenému zhodnocení.',
    alternatives: [
      'porovnat dlouhodobé fundamenty různých projektů',
      'vysvětlit rizikové profily (Bitcoin vs altcoiny)',
      'navrhnout scénáře bez garancí',
    ],
    condition: (query) => {
      // Only trigger if asking about buying/profit
      const buyProfit = /\b(koupit|investovat|zbohat|vydělat|zhodnotit)\b/i;
      return buyProfit.test(query);
    },
  },

  // Tax evasion
  {
    pattern: /\bhow to (hide|evade|avoid paying)\b.*\btax\b/i,
    reason_code: 'NO_TAX_EVASION',
    template: 'Nemohu radit s daňovými úniky.',
    alternatives: [
      'vysvětlit legální daňovou optimalizaci',
      'diskutovat o odpočtech a slevách',
      'doporučit konzultaci s daňovým poradcem',
    ],
  },

  // Insider trading
  {
    pattern: /\b(insider|non-public|confidential)\b.*\b(information|tip|trading)\b/i,
    reason_code: 'NO_INSIDER_TRADING',
    template: 'Nemohu radit s obchodováním na základě neveřejných informací.',
    alternatives: [
      'vysvětlit pravidla veřejného obchodování',
      'diskutovat o legálních zdrojích informací',
      'vysvětlit důsledky insider tradingu',
    ],
  },
];

/**
 * Patterns that result in RESTRICT
 */
const RestrictedPatterns = [
  // Investment advice without clear educational context
  {
    pattern: /\bshould i (buy|sell|invest)\b/i,
    reason_code: 'INVESTMENT_DECISION',
    template: 'Potřebuji vědět víc o tvé situaci - investiční horizont, tolerance rizika, cíle?',
    condition: (query) => {
      // Allow if asking for comparison or education
      const educational = /\b(compare|difference|pros|cons|learn|understand)\b/i;
      return !educational.test(query);
    },
  },

  // Specific portfolio allocation
  {
    pattern: /\bhow much\b.*\b(invest|put|allocate)\b.*\b(stock|crypto|bond)\b/i,
    reason_code: 'ALLOCATION_ADVICE',
    template: 'Alokace závisí na osobní situaci. Jaký je tvůj investiční horizont a tolerance rizika?',
    condition: () => true,
  },
];

/**
 * Patterns that are explicitly ALLOWED
 */
const AllowedPatterns = [
  // Educational content
  /\bwhat is\b.*\b(stock|bond|crypto|investment|dividend)\b/i,
  /\bhow (does|do)\b.*\b(market|trading|investing)\b.*\bwork\b/i,
  /\bexplain\b.*\b(portfolio|diversification|risk)\b/i,

  // Comparisons and analysis
  /\bcompare\b.*\b(stock|etf|fund|crypto)\b/i,
  /\bpros and cons\b/i,
  /\bdifference between\b/i,

  // Historical data
  /\bhistorical\b.*\b(return|performance|data)\b/i,
  /\bhow did\b.*\bperform\b/i,

  // Tax preparation (not evasion)
  /\btax (return|filing|declaration|document)\b/i,
  /\bwhat documents\b.*\btax\b/i,
  /\bhow to file\b.*\btax\b/i,

  // General financial literacy
  /\bbudget/i,
  /\bemergency fund/i,
  /\bsaving/i,
  /\bdebt (payoff|management)/i,
];

// ════════════════════════════════════════════════════════════════════════════
// FINANCE POLICY
// ════════════════════════════════════════════════════════════════════════════

export const FinancePolicy = {
  name: 'Finance Safety Policy',
  domain: SafetyDomain.FINANCE,
  scope: 'Investment advice, Financial guarantees, Market predictions',

  /**
   * Evaluate a query against finance safety rules
   */
  evaluate({ query, context = {} }) {
    // Check allowed patterns first
    for (const pattern of AllowedPatterns) {
      if (pattern.test(query)) {
        return null; // Explicitly allowed
      }
    }

    // Check forbidden patterns
    for (const rule of ForbiddenPatterns) {
      if (rule.pattern.test(query)) {
        // Check condition if present
        if (rule.condition && !rule.condition(query)) {
          continue;
        }
        return createSafetyVerdict({
          action: SafetyAction.REFUSE,
          domain: SafetyDomain.FINANCE,
          reason_code: rule.reason_code,
          user_message_template: rule.template,
          alternatives: rule.alternatives,
        });
      }
    }

    // Check restricted patterns
    for (const rule of RestrictedPatterns) {
      if (rule.pattern.test(query)) {
        if (rule.condition && !rule.condition(query)) {
          continue;
        }
        return createSafetyVerdict({
          action: SafetyAction.RESTRICT,
          domain: SafetyDomain.FINANCE,
          reason_code: rule.reason_code,
          user_message_template: rule.template,
          alternatives: [],
        });
      }
    }

    return null;
  },
};

// ════════════════════════════════════════════════════════════════════════════
// EXPORTS
// ════════════════════════════════════════════════════════════════════════════

export default FinancePolicy;
