// CRE v36.5 Capability Registry
// ══════════════════════════════════════════════════════════════════════════════
//
// PURPOSE: Single source of truth about what the system CAN do
//
// This is NOT:
//   - feature flags
//   - permissions
//   - execution guards
//
// This IS:
//   - Formal declaration of real system capabilities
//   - Separated from current data availability
//   - Separated from decision logic
//
// The LLM MUST know these capabilities to avoid lying about what it can do.
//
// ══════════════════════════════════════════════════════════════════════════════

import { WorkflowIntent } from './dialog-state-v2.js';

// ════════════════════════════════════════════════════════════════════════════
// CAPABILITY KINDS
// ════════════════════════════════════════════════════════════════════════════

export const CapabilityKind = {
  SEARCH: 'SEARCH',
  NEWS_AGGREGATION: 'NEWS_AGGREGATION',
  ARTIFACT_GENERATION: 'ARTIFACT_GENERATION',
  ADVICE: 'ADVICE',
  CALCULATION: 'CALCULATION',
  CALENDAR: 'CALENDAR',
  WEB_BROWSING: 'WEB_BROWSING',
  DATA_LOOKUP: 'DATA_LOOKUP'
};

// ════════════════════════════════════════════════════════════════════════════
// CAPABILITY DEFINITIONS
// ════════════════════════════════════════════════════════════════════════════

/**
 * Static capability definitions
 * These describe what the system CAN do, not what it's currently able to do
 */
export const CapabilityDefinitions = {
  [CapabilityKind.SEARCH]: {
    id: CapabilityKind.SEARCH,
    enabled: true,
    description: 'Vyhledávání v externích zdrojích (inzerce, databáze, weby)',
    descriptionForLLM: 'Systém UMÍ vyhledávat v reálném čase. Podporované zdroje: Sauto, Bazoš, Mobile.de, Sreality, Bezrealitky.',
    requires: ['query'],
    optional: ['source', 'location', 'priceRange'],
    realTime: true,
    deterministic: false,
    backends: ['sauto', 'bazos', 'mobile.de', 'sreality', 'bezrealitky']
  },
  
  [CapabilityKind.NEWS_AGGREGATION]: {
    id: CapabilityKind.NEWS_AGGREGATION,
    enabled: true,
    description: 'Souhrn zpráv z vybraných zpravodajských zdrojů',
    descriptionForLLM: 'Systém UMÍ agregovat zprávy z externích zdrojů. Podporované: Reuters, AP, ČTK, Novinky, iDnes, Seznam Zprávy.',
    requires: ['sources'],
    optional: ['topic', 'timeframe'],
    realTime: true,
    deterministic: false,
    backends: ['reuters', 'ap', 'ctk', 'novinky', 'idnes', 'seznam']
  },
  
  [CapabilityKind.ARTIFACT_GENERATION]: {
    id: CapabilityKind.ARTIFACT_GENERATION,
    enabled: true,
    description: 'Generování dokumentů (PDF, DOCX, reporty)',
    descriptionForLLM: 'Systém UMÍ generovat PDF, DOCX a další dokumenty. Vyžaduje podkladová data.',
    requires: ['data'],
    optional: ['template', 'format'],
    realTime: false,
    deterministic: true,
    backends: ['puppeteer', 'docx']
  },
  
  [CapabilityKind.ADVICE]: {
    id: CapabilityKind.ADVICE,
    enabled: true,
    description: 'Poskytování rad a doporučení na základě znalostí',
    descriptionForLLM: 'Systém UMÍ poskytovat rady a doporučení.',
    requires: [],
    optional: ['context'],
    realTime: false,
    deterministic: false,
    backends: []
  },
  
  [CapabilityKind.CALCULATION]: {
    id: CapabilityKind.CALCULATION,
    enabled: true,
    description: 'Matematické výpočty a kalkulace',
    descriptionForLLM: 'Systém UMÍ provádět výpočty.',
    requires: [],
    optional: [],
    realTime: false,
    deterministic: true,
    backends: []
  },
  
  [CapabilityKind.CALENDAR]: {
    id: CapabilityKind.CALENDAR,
    enabled: true,
    description: 'Práce s kalendářními daty, astronomické výpočty',
    descriptionForLLM: 'Systém ZNÁ aktuální datum a čas. UMÍ počítat fáze měsíce, svátky, kalendářní události.',
    requires: [],
    optional: [],
    realTime: false,
    deterministic: true,
    backends: []
  },
  
  [CapabilityKind.WEB_BROWSING]: {
    id: CapabilityKind.WEB_BROWSING,
    enabled: true,
    description: 'Procházení webových stránek a scraping',
    descriptionForLLM: 'Systém UMÍ procházet web a získávat aktuální informace.',
    requires: ['url'],
    optional: [],
    realTime: true,
    deterministic: false,
    backends: ['puppeteer', 'fetch']
  },
  
  [CapabilityKind.DATA_LOOKUP]: {
    id: CapabilityKind.DATA_LOOKUP,
    enabled: true,
    description: 'Vyhledávání v registrovaných datových zdrojích',
    descriptionForLLM: 'Systém MÁ přístup k datovým zdrojům: GPU databáze, databáze aut.',
    requires: ['domain'],
    optional: ['filters'],
    realTime: false,
    deterministic: true,
    backends: ['gpu', 'cars']  // From DataRegistry
  }
};

// ════════════════════════════════════════════════════════════════════════════
// WORKFLOW → CAPABILITY MAPPING
// ════════════════════════════════════════════════════════════════════════════

export const WorkflowCapabilityMap = {
  [WorkflowIntent.SEARCH]: CapabilityKind.SEARCH,
  [WorkflowIntent.NEWS_AGGREGATION]: CapabilityKind.NEWS_AGGREGATION,
  [WorkflowIntent.REPORT]: CapabilityKind.ARTIFACT_GENERATION,
  [WorkflowIntent.ADVICE]: CapabilityKind.ADVICE,
  [WorkflowIntent.CHAT]: CapabilityKind.ADVICE
};

// ════════════════════════════════════════════════════════════════════════════
// CAPABILITY REGISTRY CLASS
// ════════════════════════════════════════════════════════════════════════════

class CapabilityRegistry {
  constructor() {
    this.capabilities = { ...CapabilityDefinitions };
    this.runtimeOverrides = {};
  }
  
  /**
   * Get capability definition
   */
  get(capabilityId) {
    return this.capabilities[capabilityId] || null;
  }
  
  /**
   * Get capability for workflow intent
   */
  getForWorkflow(workflowIntent) {
    const capabilityId = WorkflowCapabilityMap[workflowIntent];
    return capabilityId ? this.get(capabilityId) : null;
  }
  
  /**
   * Check if capability is enabled
   */
  isEnabled(capabilityId) {
    const cap = this.get(capabilityId);
    return cap?.enabled ?? false;
  }
  
  /**
   * Get all enabled capabilities
   */
  getAllEnabled() {
    return Object.values(this.capabilities).filter(c => c.enabled);
  }
  
  /**
   * Generate capability summary for LLM prompt injection
   * This is CRITICAL - tells LLM the truth about what system can do
   */
  generateLLMCapabilitySummary() {
    const enabled = this.getAllEnabled();
    
    const lines = enabled.map(cap => {
      const backends = cap.backends?.length > 0 
        ? ` [${cap.backends.join(', ')}]` 
        : '';
      const realtime = cap.realTime ? ' (real-time)' : '';
      return `• ${cap.id}: ${cap.descriptionForLLM}${backends}${realtime}`;
    });
    
    return lines.join('\n');
  }
  
  /**
   * Runtime override for testing or dynamic capability changes
   */
  setRuntimeOverride(capabilityId, override) {
    this.runtimeOverrides[capabilityId] = override;
  }
  
  /**
   * Clear runtime overrides
   */
  clearOverrides() {
    this.runtimeOverrides = {};
  }
}

// Singleton instance
export const capabilityRegistry = new CapabilityRegistry();

// ════════════════════════════════════════════════════════════════════════════
// SYSTEM SLOTS
// ════════════════════════════════════════════════════════════════════════════

/**
 * System slots that should ALWAYS be available
 * These are injected into every dialog state
 */
export function getSystemSlots() {
  const now = new Date();
  
  return {
    now: now.toISOString(),
    date: now.toISOString().split('T')[0],
    time: now.toTimeString().split(' ')[0],
    timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || 'Europe/Prague',
    dayOfWeek: ['neděle', 'pondělí', 'úterý', 'středa', 'čtvrtek', 'pátek', 'sobota'][now.getDay()],
    year: now.getFullYear(),
    month: now.getMonth() + 1,
    day: now.getDate()
  };
}

/**
 * Generate system context for LLM
 */
export function generateSystemContext() {
  const slots = getSystemSlots();
  const capabilities = capabilityRegistry.generateLLMCapabilitySummary();
  
  return `
═══════════════════════════════════════════════════════════════════
SYSTÉMOVÝ KONTEXT (pravdivý, autoritativní)
═══════════════════════════════════════════════════════════════════

AKTUÁLNÍ ČAS:
• Datum: ${slots.date} (${slots.dayOfWeek})
• Čas: ${slots.time}
• Časové pásmo: ${slots.timezone}

SCHOPNOSTI SYSTÉMU (co SKUTEČNĚ umím):
${capabilities}

DŮLEŽITÉ PRAVIDLO:
❌ NIKDY neříkej "nemohu prohledávat internet" nebo "nemám přístup k aktuálním datům"
❌ NIKDY neříkej "potřeboval bych vědět aktuální datum"
✅ VŽDY používej výše uvedené schopnosti a aktuální čas
✅ Pokud něco chybí, řekni CO KONKRÉTNĚ potřebuješ (zdroj, parametr)
═══════════════════════════════════════════════════════════════════
`;
}

// ════════════════════════════════════════════════════════════════════════════
// CAPABILITY STATUS EVALUATION
// ════════════════════════════════════════════════════════════════════════════

/**
 * Evaluate if a capability can be executed right now
 * 
 * @param {string} capabilityId - Capability to evaluate
 * @param {Object} context - Current execution context
 * @returns {{ canExecute: boolean, missing: string[], reason: string }}
 */
export function evaluateCapabilityStatus(capabilityId, context = {}) {
  const cap = capabilityRegistry.get(capabilityId);
  
  if (!cap) {
    return {
      canExecute: false,
      missing: [],
      reason: `Unknown capability: ${capabilityId}`
    };
  }
  
  if (!cap.enabled) {
    return {
      canExecute: false,
      missing: [],
      reason: `Capability ${capabilityId} is disabled`
    };
  }
  
  // Check required slots
  const missing = [];
  for (const req of cap.requires) {
    if (!context[req]) {
      missing.push(req);
    }
  }
  
  if (missing.length > 0) {
    return {
      canExecute: false,
      missing,
      reason: `Missing required: ${missing.join(', ')}`
    };
  }
  
  return {
    canExecute: true,
    missing: [],
    reason: null
  };
}

// ════════════════════════════════════════════════════════════════════════════
// FALLBACK RESPONSE TEMPLATES
// ════════════════════════════════════════════════════════════════════════════

/**
 * Generate truthful fallback response based on capability status
 * This replaces generic "nemohu" responses with actionable information
 */
export function generateCapabilityFallback(capabilityId, status, context = {}) {
  const cap = capabilityRegistry.get(capabilityId);
  
  if (!cap) {
    return '❓ Tato funkce není dostupná.';
  }
  
  // Capability exists and is enabled, but missing requirements
  if (cap.enabled && status.missing.length > 0) {
    const missingText = status.missing.map(m => {
      switch (m) {
        case 'query': return 'vyhledávací dotaz';
        case 'source': return 'zdroj dat (např. Sauto, Bazoš)';
        case 'sources': return 'zpravodajské zdroje (např. Reuters, Novinky)';
        case 'data': return 'podkladová data';
        case 'url': return 'URL adresa';
        case 'domain': return 'datová doména';
        case 'timeframe': return 'časové období';
        default: return m;
      }
    }).join(', ');
    
    const backends = cap.backends?.length > 0 
      ? `\n\nDostupné zdroje: ${cap.backends.join(', ')}`
      : '';
    
    return `✅ **Tuto akci umím provést**, ale potřebuji: ${missingText}${backends}\n\nUpřesni, prosím, co konkrétně potřebuješ.`;
  }
  
  // Generic fallback
  return `ℹ️ ${cap.description}`;
}

// ════════════════════════════════════════════════════════════════════════════
// MOON PHASE CALCULATOR (for calendar capability)
// ════════════════════════════════════════════════════════════════════════════

/**
 * Calculate days until next full moon
 * Simple algorithm based on known full moon date
 */
export function daysUntilFullMoon(fromDate = new Date()) {
  // Known full moon: January 13, 2025
  const knownFullMoon = new Date('2025-01-13T22:27:00Z');
  const lunarCycle = 29.53059; // days
  
  const daysSinceKnown = (fromDate - knownFullMoon) / (1000 * 60 * 60 * 24);
  const cyclePosition = daysSinceKnown % lunarCycle;
  
  const daysUntilNext = cyclePosition < 0 
    ? Math.abs(cyclePosition)
    : lunarCycle - cyclePosition;
  
  return Math.round(daysUntilNext);
}

/**
 * Get moon phase info
 */
export function getMoonPhaseInfo(date = new Date()) {
  const daysUntil = daysUntilFullMoon(date);
  const lunarCycle = 29.53;
  
  // Determine current phase
  let phase;
  if (daysUntil < 1) {
    phase = 'úplněk';
  } else if (daysUntil < 7) {
    phase = 'ubývající měsíc';
  } else if (daysUntil < 15) {
    phase = 'poslední čtvrt / nov';
  } else if (daysUntil < 22) {
    phase = 'dorůstající měsíc';
  } else {
    phase = 'první čtvrt';
  }
  
  const nextFullMoon = new Date(date.getTime() + daysUntil * 24 * 60 * 60 * 1000);
  
  return {
    currentPhase: phase,
    daysUntilFullMoon: daysUntil,
    nextFullMoonDate: nextFullMoon.toISOString().split('T')[0]
  };
}

// ════════════════════════════════════════════════════════════════════════════
// EXPORTS
// ════════════════════════════════════════════════════════════════════════════

export default {
  CapabilityKind,
  CapabilityDefinitions,
  WorkflowCapabilityMap,
  capabilityRegistry,
  getSystemSlots,
  generateSystemContext,
  evaluateCapabilityStatus,
  generateCapabilityFallback,
  daysUntilFullMoon,
  getMoonPhaseInfo
};
