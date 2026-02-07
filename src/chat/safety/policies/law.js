// Law Safety Policy v50.0
// ══════════════════════════════════════════════════════════════════════════════
//
// Handles: Legal advice, Compliance guidance, Jurisdictional issues
//
// Scope:
//   - Specific legal recommendations
//   - Contract interpretation as legal advice
//   - Jurisdictional legal claims
//   - Criminal defense strategy
//
// Key Principle:
//   - Can explain general legal concepts → ALLOW
//   - Can compare approaches → SYNTHESIS
//   - Cannot provide specific legal advice → RESTRICT/REFUSE
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
  // Specific legal advice on criminal matters
  {
    pattern: /\bhow to (avoid|evade|escape)\b.*\b(prosecution|arrest|conviction|jail)\b/i,
    reason_code: 'NO_CRIMINAL_EVASION',
    template: 'Nemohu radit s vyhýbáním se trestnímu stíhání.',
    alternatives: [
      'vysvětlit obecně trestní řízení',
      'doporučit konzultaci s obhájcem',
      'vysvětlit práva obviněného',
    ],
  },

  // False testimony
  {
    pattern: /\bhow to (lie|deceive|mislead)\b.*\b(court|police|judge|lawyer)\b/i,
    reason_code: 'NO_PERJURY_ADVICE',
    template: 'Nemohu radit s křivou výpovědí nebo klamáním soudu.',
    alternatives: [
      'vysvětlit důsledky křivé výpovědi',
      'diskutovat o právu nevypovídat',
      'doporučit konzultaci s právníkem',
    ],
  },

  // Contract fraud
  {
    pattern: /\bhow to (break|void|escape)\b.*\bcontract\b.*\bwithout (paying|consequence)\b/i,
    reason_code: 'NO_CONTRACT_FRAUD',
    template: 'Nemohu radit s podvodným porušením smlouvy.',
    alternatives: [
      'vysvětlit legitimní důvody pro ukončení smlouvy',
      'diskutovat o výpovědních lhůtách',
      'doporučit právní konzultaci',
    ],
  },

  // Immigration fraud
  {
    pattern: /\b(fake|forge|fabricate)\b.*\b(visa|passport|asylum|immigration)\b/i,
    reason_code: 'NO_IMMIGRATION_FRAUD',
    template: 'Nemohu radit s ilegálními imigračními praktikami.',
    alternatives: [
      'vysvětlit legitimní imigrační procesy',
      'diskutovat o typech víz',
      'doporučit konzultaci s imigračním právníkem',
    ],
  },
];

/**
 * Patterns that result in RESTRICT
 */
const RestrictedPatterns = [
  // Employee monitoring
  {
    pattern: /\b(can i|am i allowed to)\b.*\b(monitor|track|spy|watch)\b.*\b(employee|worker|staff)/i,
    reason_code: 'EMPLOYEE_MONITORING',
    template: 'Monitorování zaměstnanců je regulované. V jaké jsi jurisdikci a jaký typ monitoringu máš na mysli?',
    condition: () => true,
  },
  {
    pattern: /\bmohu\b.*\b(monitorovat|sledovat|kontrolovat)\b.*\b(zaměstnanc|pracovník)/i,
    reason_code: 'EMPLOYEE_MONITORING',
    template: 'Monitorování zaměstnanců je regulované. V jaké jsi jurisdikci a jaký typ monitoringu máš na mysli?',
    condition: () => true,
  },

  // Firing employees
  {
    pattern: /\bhow (can i|to)\b.*\b(fire|terminate|dismiss)\b.*\b(employee|worker)\b/i,
    reason_code: 'EMPLOYMENT_TERMINATION',
    template: 'Ukončení pracovního poměru má specifická pravidla. Jde o výpověď, dohodu, nebo okamžité zrušení?',
    condition: () => true,
  },

  // Contract interpretation
  {
    pattern: /\bis this (contract|clause|term)\b.*\b(legal|valid|enforceable)\b/i,
    reason_code: 'CONTRACT_VALIDITY',
    template: 'Platnost smlouvy závisí na mnoha faktorech. Můžeš sdílet konkrétní část smlouvy?',
    condition: () => true,
  },

  // Legal claims
  {
    pattern: /\bcan i (sue|take to court|claim damages)\b/i,
    reason_code: 'LITIGATION_ADVICE',
    template: 'Možnost žaloby závisí na specifických okolnostech. Jaká je situace a v jaké jurisdikci?',
    condition: () => true,
  },

  // Custody and family law
  {
    pattern: /\bhow (can i|to) (get|win)\b.*\bcustody\b/i,
    reason_code: 'CUSTODY_ADVICE',
    template: 'Opatrovnické spory jsou velmi specifické. Doporučuji konzultaci s rodinným právníkem.',
    condition: () => true,
  },
];

/**
 * Patterns that are explicitly ALLOWED
 */
const AllowedPatterns = [
  // General legal education
  /\bwhat is\b.*\b(law|regulation|statute|contract|tort)\b/i,
  /\bhow (does|do)\b.*\b(court|legal system|lawsuit)\b.*\bwork\b/i,
  /\bexplain\b.*\b(legal|law|rights|liability)\b/i,

  // Procedural information
  /\bhow to (file|submit|register)\b.*\b(document|form|application)\b/i,
  /\bwhat documents\b.*\bneed\b/i,
  /\bprocess for\b/i,
  /\bsteps to\b/i,

  // Compliance general
  /\bGDPR/i,
  /\bcompliance requirements\b/i,
  /\bregulatory\b.*\brequirements\b/i,

  // Historical/educational
  /\blegal history\b/i,
  /\bcase study\b/i,
  /\bprecedent\b/i,

  // Business formation
  /\bhow to (start|form|register)\b.*\b(company|business|llc|s\.r\.o)\b/i,
  /\bbusiness (license|permit)\b/i,
];

// ════════════════════════════════════════════════════════════════════════════
// LAW POLICY
// ════════════════════════════════════════════════════════════════════════════

export const LawPolicy = {
  name: 'Law Safety Policy',
  domain: SafetyDomain.LAW,
  scope: 'Legal advice, Compliance guidance, Jurisdictional issues',

  /**
   * Evaluate a query against law safety rules
   */
  evaluate({ query, context = {} }) {
    // Check allowed patterns first
    for (const pattern of AllowedPatterns) {
      if (pattern.test(query)) {
        return null;
      }
    }

    // Check forbidden patterns
    for (const rule of ForbiddenPatterns) {
      if (rule.pattern.test(query)) {
        return createSafetyVerdict({
          action: SafetyAction.REFUSE,
          domain: SafetyDomain.LAW,
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
          domain: SafetyDomain.LAW,
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

export default LawPolicy;
