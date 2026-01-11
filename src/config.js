// C.3 v28 Configuration
// ══════════════════════════════════════════════════════════════════════════════

export const config = {
  // Server
  server: {
    port: parseInt(process.env.C3_PORT || '3335'),
    host: process.env.C3_HOST || '127.0.0.1',
  },

  // Ollama
  ollama: {
    baseUrl: process.env.OLLAMA_URL || 'http://localhost:11434',
    retries: 3,
    retryDelay: 2000,
  },

  // Model bindings - which model for which role
  models: {
    // Fast thinking (qwen2.5:32b - good at JSON, fast)
    THINKER: 'qwen2.5:32b',
    ANALYZER: 'qwen2.5:32b',
    CLASSIFIER: 'qwen2.5:32b',
    
    // Planning (qwen2.5:32b - structured output)
    PLANNER: 'qwen2.5:32b',
    REVIEWER: 'qwen2.5:32b',
    
    // Coding (qwen2.5-coder:32b - code specialist)
    CODER: 'qwen2.5-coder:32b',
    FIXER: 'qwen2.5-coder:32b',
    
    // Adversarial review (deepseek-r1 - only for HIGH complexity)
    ADVERSARIAL: 'deepseek-r1:32b',
    
    // Chat (general conversation)
    CHAT: 'qwen2.5:32b',
    
    // Vision (for image analysis) - requires: ollama pull llava:13b
    VISION: 'llava:13b',
  },

  // Timeouts per role (ms) - REDUCED from v27
  timeouts: {
    THINKER: 45000,     // 45s (was 60s)
    ANALYZER: 45000,    // 45s (was 60s)
    CLASSIFIER: 30000,  // 30s (new)
    PLANNER: 60000,     // 60s (was 90s)
    REVIEWER: 45000,    // 45s (was 60s)
    CODER: 90000,       // 90s (was 180s)
    FIXER: 90000,       // 90s (was 120s)
    ADVERSARIAL: 120000, // 120s (unchanged)
    CHAT: 30000,        // 30s
    VISION: 60000,      // 60s for image analysis
  },

  // Workflow configuration
  workflow: {
    // Max iterations for review loop
    maxIterations: 3,
    
    // Max design audit retries (now optional)
    maxDesignRetries: 1,
    
    // Complexity thresholds
    complexity: {
      // Simple: skip DESIGN_AUDIT, skip ADVERSARIAL
      SIMPLE: { designAudit: false, adversarial: false },
      // Medium: do DESIGN_AUDIT once, skip ADVERSARIAL
      MEDIUM: { designAudit: true, adversarial: false },
      // HIGH: full workflow with ADVERSARIAL
      HIGH: { designAudit: true, adversarial: true },
    },
    
    // Learning: auto-apply after N confirmations
    learningThreshold: 3,
  },

  // Database
  db: {
    path: process.env.C3_DB_PATH || './data/c3.db',
  },

  // Logging
  log: {
    level: process.env.C3_LOG_LEVEL || 'info', // debug, info, warn, error
    timestamps: true,
  },
};

// Complexity keywords for classification
export const complexityKeywords = {
  HIGH: [
    'architecture', 'microservice', 'distributed', 'scalable', 'security',
    'authentication', 'authorization', 'encryption', 'database migration',
    'real-time', 'websocket', 'multi-tenant', 'api gateway', 'load balancing',
  ],
  MEDIUM: [
    'api', 'rest', 'crud', 'frontend', 'backend', 'fullstack', 'testing',
    'deployment', 'docker', 'ci/cd', 'database', 'orm', 'caching',
  ],
  // Everything else is SIMPLE
};

export default config;
