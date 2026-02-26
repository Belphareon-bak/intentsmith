// General Safety Policy v50.0
// ══════════════════════════════════════════════════════════════════════════════
//
// Handles: Violence, Hacking, Malware, Illegal activities
//
// Scope:
//   - Physical harm to people
//   - Unauthorized access to systems
//   - Malicious software creation
//   - Illegal activities facilitation
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
  // Physical violence
  {
    pattern: /\bhow to (make|create|build|construct)\b.*\b(bomb|explosive|weapon|poison)\b/i,
    reason_code: 'WEAPONS_CREATION',
    template: 'Nemohu poskytovat návody na výrobu zbraní nebo výbušnin.',
    alternatives: [
      'vysvětlit bezpečnostní protokoly a prevenci',
      'diskutovat o legálních aspektech držení zbraní',
      'poskytnout informace o sebeobraně v rámci zákona',
    ],
  },
  {
    pattern: /\bhow to (kill|murder|harm|injure|hurt)\b.*\b(person|people|someone|human)\b/i,
    reason_code: 'PHYSICAL_HARM',
    template: 'Nemohu poskytovat návody na ubližování lidem.',
    alternatives: [
      'diskutovat o řešení konfliktů',
      'poskytnout informace o psychologické pomoci',
      'vysvětlit právní důsledky násilí',
    ],
  },

  // Hacking and unauthorized access
  {
    pattern: /\bhack\b.*\b(into|password|account|system|database)\b/i,
    reason_code: 'UNAUTHORIZED_ACCESS',
    template: 'Nemohu poskytovat návody na neoprávněný přístup do systémů.',
    alternatives: [
      'vysvětlit principy kybernetické bezpečnosti',
      'diskutovat o etickém hackingu a penetračním testování',
      'poskytnout informace o zabezpečení vlastních systémů',
    ],
  },
  {
    pattern: /\b(crack|bypass|circumvent)\b.*\b(password|security|authentication|protection)\b/i,
    reason_code: 'SECURITY_BYPASS',
    template: 'Nemohu poskytovat návody na obcházení bezpečnostních opatření.',
    alternatives: [
      'vysvětlit jak funguje autentizace',
      'diskutovat o legitimních způsobech obnovy přístupu',
      'poskytnout informace o správě hesel',
    ],
  },

  // Malware
  {
    pattern: /\b(create|write|make|develop)\b.*\b(virus|malware|trojan|ransomware|keylogger|spyware)\b/i,
    reason_code: 'MALWARE_CREATION',
    template: 'Nemohu poskytovat návody na tvorbu škodlivého softwaru.',
    alternatives: [
      'vysvětlit jak se chránit před malwarem',
      'diskutovat o antivirových řešeních',
      'poskytnout informace o bezpečném programování',
    ],
  },

  // Illegal activities
  {
    pattern: /\bhow to (steal|fraud|scam|embezzle|launder)\b/i,
    reason_code: 'ILLEGAL_ACTIVITY',
    template: 'Nemohu poskytovat návody na nelegální činnosti.',
    alternatives: [
      'vysvětlit právní důsledky podvodů',
      'diskutovat o ochraně před podvody',
      'poskytnout informace o legitimních finančních postupech',
    ],
  },
  {
    pattern: /\b(forge|counterfeit|fake)\b.*\b(document|money|id|passport|certificate)\b/i,
    reason_code: 'DOCUMENT_FORGERY',
    template: 'Nemohu poskytovat návody na padělání dokumentů.',
    alternatives: [
      'vysvětlit jak ověřit pravost dokumentů',
      'diskutovat o legitimních způsobech získání dokumentů',
      'poskytnout informace o procesu vydávání dokladů',
    ],
  },

  // v82.1: Prompt injection — attempts to override system instructions
  {
    pattern: /\b(ignore|forget|disregard|override)\b.*\b(previous|all|system|prior)\b.*\b(instructions?|prompts?|rules?)\b/i,
    reason_code: 'PROMPT_INJECTION',
    template: 'Detekován pokus o prompt injection. Tento vstup byl zablokován.',
    alternatives: [
      'položit běžný dotaz',
      'vysvětlit co potřebujete',
    ],
  },
  {
    pattern: /\breturn\s+["'].*["']\s*$/i,
    reason_code: 'PROMPT_INJECTION',
    template: 'Detekován pokus o prompt injection. Tento vstup byl zablokován.',
    alternatives: [
      'položit běžný dotaz',
    ],
  },

  // Drugs
  {
    pattern: /\bhow to (make|produce|synthesize|manufacture)\b.*\b(drugs|meth|cocaine|heroin|lsd)\b/i,
    reason_code: 'DRUG_PRODUCTION',
    template: 'Nemohu poskytovat návody na výrobu nelegálních látek.',
    alternatives: [
      'diskutovat o rizicích drogové závislosti',
      'poskytnout informace o léčbě závislostí',
      'vysvětlit právní důsledky drogové výroby',
    ],
  },
];

/**
 * Patterns that result in RESTRICT (need clarification)
 */
const RestrictedPatterns = [
  // Potentially dual-use security topics
  {
    pattern: /\b(vulnerability|exploit|sql injection|xss|csrf)\b/i,
    reason_code: 'SECURITY_TOPIC',
    template: 'Tohle téma vyžaduje kontext. Jde o zabezpečení vlastního systému nebo studium?',
    condition: (query) => {
      // Allow if clearly educational or defensive
      const defensive = /\b(protect|secure|prevent|defend|fix|patch)\b/i;
      const educational = /\b(learn|study|understand|explain|what is)\b/i;
      return !defensive.test(query) && !educational.test(query);
    },
  },

  // Lock picking, physical security
  {
    pattern: /\b(pick|bypass)\b.*\block\b/i,
    reason_code: 'PHYSICAL_SECURITY',
    template: 'Potřebuji vědět kontext - jde o vlastní zámek nebo studium bezpečnosti?',
    condition: (query) => {
      const own = /\b(my|own|lost key|locked out)\b/i;
      return !own.test(query);
    },
  },
];

/**
 * Patterns that are explicitly ALLOWED
 * These override potential false positives
 */
const AllowedPatterns = [
  // Security education
  /\bwhat is\b.*\b(hacking|malware|virus)\b/i,
  /\bhow (does|do)\b.*\b(hackers|attacks)\b.*\bwork\b/i,
  /\bexplain\b.*\b(security|vulnerability)\b/i,

  // Fiction and games
  /\b(movie|film|book|game|story|fiction)\b/i,
  /\bwriting a (novel|story|script)\b/i,

  // Professional security
  /\bpenetration test/i,
  /\bethical hack/i,
  /\bsecurity audit/i,
  /\bbug bounty/i,

  // Self-defense within law
  /\bself[- ]?defense\b/i,
  /\bprotect (myself|my family)\b/i,
];

// ════════════════════════════════════════════════════════════════════════════
// GENERAL POLICY
// ════════════════════════════════════════════════════════════════════════════

export const GeneralPolicy = {
  name: 'General Safety Policy',
  domain: SafetyDomain.GENERAL,
  scope: 'Violence, Hacking, Malware, Illegal activities',

  /**
   * Evaluate a query against general safety rules
   *
   * @param {Object} params
   * @param {string} params.query - User query
   * @param {Object} params.context - Conversation context
   * @returns {Object|null} SafetyVerdict or null if not applicable
   */
  evaluate({ query, context = {} }) {
    // Check allowed patterns first (override false positives)
    for (const pattern of AllowedPatterns) {
      if (pattern.test(query)) {
        return null; // Not our concern, allow
      }
    }

    // Check forbidden patterns
    for (const rule of ForbiddenPatterns) {
      if (rule.pattern.test(query)) {
        return createSafetyVerdict({
          action: SafetyAction.REFUSE,
          domain: SafetyDomain.GENERAL,
          reason_code: rule.reason_code,
          user_message_template: rule.template,
          alternatives: rule.alternatives,
        });
      }
    }

    // Check restricted patterns
    for (const rule of RestrictedPatterns) {
      if (rule.pattern.test(query)) {
        // Check condition if present
        if (rule.condition && !rule.condition(query)) {
          continue; // Condition not met, skip
        }
        return createSafetyVerdict({
          action: SafetyAction.RESTRICT,
          domain: SafetyDomain.GENERAL,
          reason_code: rule.reason_code,
          user_message_template: rule.template,
          alternatives: [],
        });
      }
    }

    // Not a general safety concern
    return null;
  },
};

// ════════════════════════════════════════════════════════════════════════════
// EXPORTS
// ════════════════════════════════════════════════════════════════════════════

export default GeneralPolicy;
