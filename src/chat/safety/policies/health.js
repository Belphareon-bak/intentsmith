// Health Safety Policy v50.0
// ══════════════════════════════════════════════════════════════════════════════
//
// Handles: Medical diagnoses, Treatment recommendations, Drug advice
//
// Scope:
//   - Self-diagnosis requests
//   - Treatment recommendations
//   - Drug dosage advice
//   - Mental health crises
//
// Key Principle:
//   - Can provide health information → ALLOW
//   - Can explain conditions → SYNTHESIS
//   - Cannot diagnose or prescribe → REFUSE
//   - Mental health emergencies → immediate resources
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
  // Self-diagnosis
  {
    pattern: /\bdo i have\b.*\b(disease|cancer|condition|disorder|syndrome|infection)\b/i,
    reason_code: 'NO_SELF_DIAGNOSIS',
    template: 'Nemohu diagnostikovat zdravotní stavy.',
    alternatives: [
      'vysvětlit obecné příznaky daného stavu',
      'doporučit kdy navštívit lékaře',
      'poskytnout informace o vyšetřeních',
    ],
  },
  {
    pattern: /\bdiagnose me\b/i,
    reason_code: 'NO_SELF_DIAGNOSIS',
    template: 'Nemohu poskytovat lékařské diagnózy.',
    alternatives: [
      'vysvětlit co znamenají určité příznaky obecně',
      'pomoci připravit otázky pro lékaře',
      'doporučit vhodného specialistu',
    ],
  },
  {
    pattern: /\bmám\b.*\b(rakovinu|cukrovku|nemoc|onemocnění)\b.*\?/i,
    reason_code: 'NO_SELF_DIAGNOSIS',
    template: 'Nemohu diagnostikovat zdravotní stavy.',
    alternatives: [
      'vysvětlit obecné příznaky',
      'doporučit kdy navštívit lékaře',
      'poskytnout informace o vyšetřeních',
    ],
  },

  // Treatment prescription
  {
    pattern: /\bwhat (drug|medication|medicine)\b.*\bshould i (take|use)\b/i,
    reason_code: 'NO_PRESCRIPTION',
    template: 'Nemohu předepisovat léky.',
    alternatives: [
      'vysvětlit jak léky obecně fungují',
      'diskutovat o typech léčby',
      'doporučit konzultaci s lékařem nebo lékárníkem',
    ],
  },
  {
    // Catches: "How much X should I take" for any medication
    pattern: /\b(how much|what dose|dosage)\b.*\bshould\b.*\b(take|use)\b/i,
    reason_code: 'NO_DOSAGE_ADVICE',
    template: 'Nemohu radit s dávkováním léků.',
    alternatives: [
      'odkázat na příbalový leták',
      'doporučit konzultaci s lékařem nebo lékárníkem',
      'vysvětlit obecně jak dávkování funguje',
    ],
  },

  // Dangerous self-treatment
  {
    pattern: /\bhow to (treat|cure|heal)\b.*\b(myself|at home)\b.*\b(without doctor|without medical)\b/i,
    reason_code: 'NO_DIY_TREATMENT',
    template: 'Nemohu radit s léčením vážných stavů bez odborné péče.',
    alternatives: [
      'vysvětlit první pomoc',
      'poskytnout obecné informace o stavu',
      'doporučit kdy vyhledat lékařskou pomoc',
    ],
  },

  // Abortion methods (sensitive - redirect to professionals)
  {
    pattern: /\bhow to (perform|do|induce)\b.*\babortion\b.*\b(at home|myself|without doctor)\b/i,
    reason_code: 'NO_UNSAFE_PROCEDURES',
    template: 'Nemohu poskytovat návody na nebezpečné lékařské postupy.',
    alternatives: [
      'poskytnout informace o legálních možnostech',
      'odkázat na profesionální zdravotnická zařízení',
      'diskutovat o podpůrných zdrojích',
    ],
  },
];

/**
 * Patterns that result in RESTRICT
 */
const RestrictedPatterns = [
  // Symptom interpretation
  {
    pattern: /\bi have\b.*\b(symptom|pain|ache|feeling|problem)\b.*\bwhat (is it|could it be|does it mean)\b/i,
    reason_code: 'SYMPTOM_INTERPRETATION',
    template: 'Mohu poskytnout obecné informace, ale pro diagnózu navštiv lékaře. Jak dlouho máš tyto příznaky?',
    condition: () => true,
  },

  // Drug interactions
  {
    pattern: /\bcan i (take|mix|combine)\b.*\bwith\b.*\b(drug|medication|medicine|alcohol)\b/i,
    reason_code: 'DRUG_INTERACTION',
    template: 'Interakce léků jsou komplexní téma. Konzultuj to prosím s lékárníkem.',
    condition: () => true,
  },

  // Alternative medicine for serious conditions
  {
    pattern: /\b(alternative|natural|herbal)\b.*\b(treatment|cure|remedy)\b.*\b(cancer|diabetes|heart)\b/i,
    reason_code: 'ALTERNATIVE_FOR_SERIOUS',
    template: 'U vážných onemocnění je důležitá konzultace s lékařem. Jaký je tvůj současný léčebný plán?',
    condition: () => true,
  },
];

/**
 * Special handling: Mental health emergencies
 * These get immediate resources, not just restriction
 */
const EmergencyPatterns = [
  {
    pattern: /\b(want to|going to|thinking about)\b.*\b(kill myself|suicide|end my life|die)\b/i,
    reason_code: 'MENTAL_HEALTH_EMERGENCY',
    template: `Slyším tě a je mi líto, že procházíš těžkým obdobím.

Prosím kontaktuj krizovou linku:
• Linka bezpečí: 116 111 (non-stop)
• Linka důvěry: 116 123
• Centrum krizové intervence: 284 016 666

Nejsi na to sám/sama.`,
    alternatives: [],
    is_emergency: true,
  },
  {
    pattern: /\b(chci|hodlám|přemýšlím)\b.*\b(zabít se|sebevražd|skončit se životem|umřít)\b/i,
    reason_code: 'MENTAL_HEALTH_EMERGENCY',
    template: `Slyším tě a je mi líto, že procházíš těžkým obdobím.

Prosím kontaktuj krizovou linku:
• Linka bezpečí: 116 111 (non-stop)
• Linka důvěry: 116 123
• Centrum krizové intervence: 284 016 666

Nejsi na to sám/sama.`,
    alternatives: [],
    is_emergency: true,
  },
];

/**
 * Patterns that are explicitly ALLOWED
 */
const AllowedPatterns = [
  // Health information
  /\bwhat is\b.*\b(disease|condition|syndrome|treatment)\b/i,
  /\bhow (does|do)\b.*\b(body|organ|system)\b.*\bwork\b/i,
  /\bexplain\b.*\b(health|medical|condition)\b/i,

  // General wellness
  /\bhealthy (diet|lifestyle|habits)\b/i,
  /\bexercise\b/i,
  /\bnutrition\b/i,
  /\bsleep\b.*\b(tips|habits|hygiene)\b/i,

  // First aid (basic)
  /\bfirst aid\b/i,
  /\bwhat to do if\b.*\b(cut|burn|fall|choke)\b/i,

  // Mental health information (not crisis)
  /\bwhat is\b.*\b(depression|anxiety|adhd|autism)\b/i,
  /\bhow to (manage|cope with)\b.*\b(stress|anxiety)\b/i,
  /\btherapy\b.*\b(types|options|benefits)\b/i,

  // Prevention
  /\bhow to prevent\b/i,
  /\bvaccin/i,
  /\bscreening\b/i,
];

// ════════════════════════════════════════════════════════════════════════════
// HEALTH POLICY
// ════════════════════════════════════════════════════════════════════════════

export const HealthPolicy = {
  name: 'Health Safety Policy',
  domain: SafetyDomain.HEALTH,
  scope: 'Medical diagnoses, Treatment recommendations, Drug advice',

  /**
   * Evaluate a query against health safety rules
   */
  evaluate({ query, context = {} }) {
    // Check emergencies FIRST (highest priority)
    for (const rule of EmergencyPatterns) {
      if (rule.pattern.test(query)) {
        // For emergencies, we don't refuse - we provide resources
        // But we use RESTRICT to prevent normal flow
        return createSafetyVerdict({
          action: SafetyAction.REFUSE, // Special case: direct resource message
          domain: SafetyDomain.HEALTH,
          reason_code: rule.reason_code,
          user_message_template: rule.template,
          alternatives: ['poskytnout informace o dostupné pomoci'],
        });
      }
    }

    // Check allowed patterns
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
          domain: SafetyDomain.HEALTH,
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
          domain: SafetyDomain.HEALTH,
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

export default HealthPolicy;
