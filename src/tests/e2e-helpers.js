// C.3 v35.1 E2E Test Helpers
// ══════════════════════════════════════════════════════════════════════════════
// Mock objekty a utility pro E2E testy
// ══════════════════════════════════════════════════════════════════════════════

// ════════════════════════════════════════════════════════════════════════════
// MOCK CONVERSATION CONTEXT
// ════════════════════════════════════════════════════════════════════════════

export class MockConversationContext {
  constructor() {
    this.messages = [];
    this.contextLock = null;
    this.correctionMode = false;
    this.lastClassification = null;
  }

  addMessage(role, content) {
    this.messages.push({ role, content, timestamp: new Date().toISOString() });
    return this;
  }

  setContextLock(lock) {
    this.contextLock = {
      ...lock,
      lockedAt: new Date().toISOString()
    };
    return this;
  }

  clearContextLock() {
    this.contextLock = null;
    return this;
  }

  enterCorrectionMode() {
    this.correctionMode = true;
    return this;
  }

  exitCorrectionMode() {
    this.correctionMode = false;
    return this;
  }

  getHistory() {
    return this.messages;
  }

  getLastUserMessage() {
    return this.messages.filter(m => m.role === 'user').pop();
  }

  reset() {
    this.messages = [];
    this.contextLock = null;
    this.correctionMode = false;
    this.lastClassification = null;
    return this;
  }
}

// ════════════════════════════════════════════════════════════════════════════
// MOCK WEB SEARCH
// ════════════════════════════════════════════════════════════════════════════

export class MockWebSearch {
  constructor() {
    this.responses = new Map();
    this.calls = [];
  }

  // Pre-configure response for URL pattern
  mockResponse(urlPattern, response) {
    this.responses.set(urlPattern, response);
    return this;
  }

  async fetch(url) {
    this.calls.push({ url, timestamp: new Date().toISOString() });
    
    for (const [pattern, response] of this.responses) {
      if (url.includes(pattern)) {
        return {
          success: true,
          url,
          content: response,
          timestamp: new Date().toISOString()
        };
      }
    }
    
    return {
      success: false,
      url,
      error: 'No mock configured for URL'
    };
  }

  async search(query) {
    this.calls.push({ query, type: 'search', timestamp: new Date().toISOString() });
    
    return {
      results: [],
      query,
      timestamp: new Date().toISOString()
    };
  }

  getCalls() {
    return this.calls;
  }

  wasCalledWith(urlOrQuery) {
    return this.calls.some(c => 
      (c.url && c.url.includes(urlOrQuery)) || 
      (c.query && c.query.includes(urlOrQuery))
    );
  }

  reset() {
    this.calls = [];
    return this;
  }
}

// ════════════════════════════════════════════════════════════════════════════
// MOCK ARTIFACT PIPELINE
// ════════════════════════════════════════════════════════════════════════════

export class MockArtifactPipeline {
  constructor() {
    this.artifacts = [];
    this.blocked = [];
    this.enabled = true;
  }

  generate(type, content, metadata = {}) {
    if (!this.enabled) {
      this.blocked.push({ type, reason: 'pipeline_disabled' });
      return { success: false, reason: 'pipeline_disabled' };
    }
    
    const artifact = {
      id: `artifact_${Date.now()}`,
      type,
      content,
      metadata,
      createdAt: new Date().toISOString()
    };
    
    this.artifacts.push(artifact);
    return { success: true, artifact };
  }

  block(reason) {
    this.blocked.push({ reason, timestamp: new Date().toISOString() });
  }

  disable() {
    this.enabled = false;
    return this;
  }

  enable() {
    this.enabled = true;
    return this;
  }

  getArtifacts() {
    return this.artifacts;
  }

  getBlocked() {
    return this.blocked;
  }

  wasBlocked() {
    return this.blocked.length > 0;
  }

  wasBlockedWith(reason) {
    return this.blocked.some(b => b.reason === reason);
  }

  hasArtifactOfType(type) {
    return this.artifacts.some(a => a.type === type);
  }

  reset() {
    this.artifacts = [];
    this.blocked = [];
    this.enabled = true;
    return this;
  }
}

// ════════════════════════════════════════════════════════════════════════════
// MOCK DATA LAYER
// ════════════════════════════════════════════════════════════════════════════

export class MockDataLayer {
  constructor() {
    this.activeSources = new Set();
    this.queries = [];
  }

  activateSource(sourceId) {
    this.activeSources.add(sourceId);
    return this;
  }

  deactivateSource(sourceId) {
    this.activeSources.delete(sourceId);
    return this;
  }

  deactivateAll() {
    this.activeSources.clear();
    return this;
  }

  query(sourceId, query) {
    this.queries.push({ sourceId, query, timestamp: new Date().toISOString() });
    return { results: [], source: sourceId };
  }

  isActive(sourceId) {
    return this.activeSources.has(sourceId);
  }

  getActiveSources() {
    return Array.from(this.activeSources);
  }

  getQueries() {
    return this.queries;
  }

  reset() {
    this.activeSources.clear();
    this.queries = [];
    return this;
  }
}

// ════════════════════════════════════════════════════════════════════════════
// MOCK DECISION LAYER (s P0 guardy)
// ════════════════════════════════════════════════════════════════════════════

export class MockDecisionLayer {
  constructor() {
    this.classifications = [];
    this.guards = {
      problemTypeHard: true,
      contextLock: true,
      correctionMode: true,
      artifactEligibility: true
    };
  }

  /**
   * P0.1 - ProblemType Hard Guards
   */
  classify(query, context = {}) {
    const result = this._classifyInternal(query, context);
    this.classifications.push({ query, result, timestamp: new Date().toISOString() });
    return result;
  }

  _classifyInternal(query, context) {
    const queryLower = query.toLowerCase();
    
    // P0.1: price_range POUZE pokud obsahuje cenové indikátory
    const hasPriceIndicator = 
      queryLower.includes('cena') ||
      queryLower.includes('kolik stojí') ||
      queryLower.includes('kolik stoji') ||
      /\d+\s*(kč|czk|eur|usd|\$|€)/i.test(query);
    
    // Faktické dotazy (astronomie, data, kalendář)
    const isFactual = 
      queryLower.includes('kdy') ||
      queryLower.includes('úplněk') ||
      queryLower.includes('fáze měsíce') ||
      queryLower.includes('faze mesice') ||
      queryLower.includes('datum') ||
      /\d{4}/.test(query);  // Obsahuje rok
    
    // Pokud je faktický dotaz bez cenového indikátoru
    if (isFactual && !hasPriceIndicator) {
      return {
        problemType: 'factual',
        confidence: 0.85,
        requiresEvidence: true,
        artifactEligible: false
      };
    }
    
    // Cenový dotaz
    if (hasPriceIndicator) {
      return {
        problemType: 'price_range',
        confidence: 0.8,
        requiresEvidence: true,
        artifactEligible: true
      };
    }
    
    // Default: chat
    return {
      problemType: 'chat',
      confidence: 0.6,
      requiresEvidence: false,
      artifactEligible: false
    };
  }

  /**
   * P0.3 - Correction Mode Detection
   */
  detectCorrectionTrigger(message) {
    const triggers = [
      'jsi mimo',
      'jsi úplně mimo',
      'ne, myslel jsem',
      'ne, myslela jsem',
      'tady je zdroj',
      'špatně',
      'spatne',
      'to není správně',
      'to neni spravne'
    ];
    
    const messageLower = message.toLowerCase();
    const triggered = triggers.some(t => messageLower.includes(t));
    
    return {
      triggered,
      trigger: triggered ? triggers.find(t => messageLower.includes(t)) : null
    };
  }

  /**
   * P0.4 - Artifact Eligibility
   */
  canGenerateArtifact(problemType, query) {
    const BLOCKED_TYPES = ['factual', 'availability', 'calendar', 'chat'];
    
    if (BLOCKED_TYPES.includes(problemType)) {
      return {
        eligible: false,
        reason: 'ARTIFACT_BLOCKED_BY_CONTEXT',
        problemType
      };
    }
    
    return { eligible: true };
  }

  getClassifications() {
    return this.classifications;
  }

  getLastClassification() {
    return this.classifications[this.classifications.length - 1];
  }

  reset() {
    this.classifications = [];
    return this;
  }
}

// ════════════════════════════════════════════════════════════════════════════
// MOCK CONTEXT MANAGER (P0.2)
// ════════════════════════════════════════════════════════════════════════════

export class MockContextManager {
  constructor() {
    this.contextLock = null;
    this.history = [];
  }

  /**
   * P0.2 - Context Lock
   * Extrahuje a zamyká temporal/domain kontext
   */
  extractAndLock(query, previousContext = null) {
    const extracted = this.extractContext(query);
    
    // Merge s předchozím kontextem
    if (previousContext) {
      this.contextLock = {
        ...previousContext,
        ...extracted,
        lockedAt: new Date().toISOString()
      };
    } else {
      this.contextLock = {
        ...extracted,
        lockedAt: new Date().toISOString()
      };
    }
    
    this.history.push({ action: 'lock', context: this.contextLock });
    return this.contextLock;
  }

  extractContext(query) {
    const context = {};
    const queryLower = query.toLowerCase();
    
    // Extract year
    const yearMatch = query.match(/\b(20\d{2})\b/);
    if (yearMatch) {
      context.year = parseInt(yearMatch[1]);
    }
    
    // Extract month
    const months = {
      'leden': 1, 'ledna': 1, 'únor': 2, 'února': 2, 'unor': 2, 'unora': 2,
      'březen': 3, 'března': 3, 'brezen': 3, 'brezna': 3,
      'duben': 4, 'dubna': 4, 'květen': 5, 'května': 5, 'kveten': 5, 'kvetna': 5,
      'červen': 6, 'června': 6, 'cerven': 6, 'cervna': 6,
      'červenec': 7, 'července': 7, 'cervenec': 7, 'cervence': 7,
      'srpen': 8, 'srpna': 8, 'září': 9, 'zari': 9,
      'říjen': 10, 'října': 10, 'rijen': 10, 'rijna': 10,
      'listopad': 11, 'listopadu': 11, 'prosinec': 12, 'prosince': 12
    };
    
    for (const [name, num] of Object.entries(months)) {
      if (queryLower.includes(name)) {
        context.month = num;
        context.monthName = name;
        break;
      }
    }
    
    // Extract domain
    if (queryLower.includes('měsíc') || queryLower.includes('úplněk') || 
        queryLower.includes('fáze') || queryLower.includes('mesic')) {
      context.domain = 'astronomical';
    } else if (queryLower.includes('cena') || queryLower.includes('gpu') || 
               queryLower.includes('rtx')) {
      context.domain = 'prices';
    }
    
    // Extract explicit URL
    const urlMatch = query.match(/(https?:\/\/[^\s]+)/);
    if (urlMatch) {
      context.source = urlMatch[1];
      context.sourceType = 'explicit_url';
    }
    
    return context;
  }

  /**
   * Check if context should carry over
   */
  shouldCarryContext(newQuery) {
    if (!this.contextLock) return false;
    
    const newContext = this.extractContext(newQuery);
    
    // Pokud nový dotaz mění doménu, reset
    if (newContext.domain && newContext.domain !== this.contextLock.domain) {
      this.history.push({ action: 'domain_change', old: this.contextLock.domain, new: newContext.domain });
      return false;
    }
    
    return true;
  }

  /**
   * P0.7 - Domain Contamination Check
   */
  checkDomainContamination(newQuery) {
    if (!this.contextLock) return { contaminated: false };
    
    const newContext = this.extractContext(newQuery);
    
    if (newContext.domain && newContext.domain !== this.contextLock.domain) {
      return {
        contaminated: true,
        oldDomain: this.contextLock.domain,
        newDomain: newContext.domain,
        action: 'DOMAIN_RESET_REQUIRED'
      };
    }
    
    return { contaminated: false };
  }

  getContextLock() {
    return this.contextLock;
  }

  clearLock() {
    this.history.push({ action: 'clear', previousContext: this.contextLock });
    this.contextLock = null;
    return this;
  }

  getHistory() {
    return this.history;
  }

  reset() {
    this.contextLock = null;
    this.history = [];
    return this;
  }
}

// ════════════════════════════════════════════════════════════════════════════
// TEST FIXTURES
// ════════════════════════════════════════════════════════════════════════════

export const FIXTURES = {
  // Moon phases data from spaceweatherlive.com
  moonPhasesFeb2026: {
    url: 'https://www.spaceweatherlive.com/cs/kalendar-fazi-mesice/2026/2.html',
    data: {
      month: 'únor',
      year: 2026,
      phases: [
        { date: '2026-02-01', phase: 'První čtvrť', time: '09:10' },
        { date: '2026-02-09', phase: 'Úplněk', time: '13:43' },
        { date: '2026-02-17', phase: 'Poslední čtvrť', time: '02:01' },
        { date: '2026-02-23', phase: 'Nov', time: '12:44' }
      ]
    }
  },
  
  // GPU prices
  gpuPrices: {
    source: 'gpu_source',
    data: [
      { model: 'RTX 4070', price_min: 14990, price_max: 17990 },
      { model: 'RTX 4080', price_min: 27990, price_max: 32990 }
    ]
  }
};

// ════════════════════════════════════════════════════════════════════════════
// HELPER FUNCTIONS
// ════════════════════════════════════════════════════════════════════════════

export function createTestContext() {
  return {
    conversation: new MockConversationContext(),
    webSearch: new MockWebSearch(),
    artifactPipeline: new MockArtifactPipeline(),
    dataLayer: new MockDataLayer(),
    decisionLayer: new MockDecisionLayer(),
    contextManager: new MockContextManager()
  };
}

export function simulateUserMessage(ctx, message) {
  ctx.conversation.addMessage('user', message);
  
  // Check correction mode
  const correction = ctx.decisionLayer.detectCorrectionTrigger(message);
  if (correction.triggered) {
    ctx.conversation.enterCorrectionMode();
  }
  
  // Check domain contamination
  const contamination = ctx.contextManager.checkDomainContamination(message);
  if (contamination.contaminated) {
    ctx.dataLayer.deactivateAll();
    ctx.contextManager.clearLock();
  }
  
  // Extract and lock context
  const previousLock = ctx.contextManager.getContextLock();
  if (ctx.contextManager.shouldCarryContext(message) && previousLock) {
    ctx.contextManager.extractAndLock(message, previousLock);
  } else {
    ctx.contextManager.extractAndLock(message);
  }
  
  // Classify
  const classification = ctx.decisionLayer.classify(message, ctx.contextManager.getContextLock());
  
  // Check artifact eligibility
  const artifactCheck = ctx.decisionLayer.canGenerateArtifact(classification.problemType, message);
  if (!artifactCheck.eligible) {
    ctx.artifactPipeline.block(artifactCheck.reason);
  }
  
  return {
    message,
    correction,
    contamination,
    context: ctx.contextManager.getContextLock(),
    classification,
    artifactEligible: artifactCheck.eligible
  };
}

export default {
  MockConversationContext,
  MockWebSearch,
  MockArtifactPipeline,
  MockDataLayer,
  MockDecisionLayer,
  MockContextManager,
  FIXTURES,
  createTestContext,
  simulateUserMessage
};
