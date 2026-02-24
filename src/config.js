// C.3 v57.0 Configuration
// ══════════════════════════════════════════════════════════════════════════════

export const config = {
  // Feature flags — enable/disable optional modules (B/C/D)
  // Core chat works without any of these.
  features: {
    agents:    process.env.C3_ENABLE_AGENTS !== 'false',     // Phase B: Workers
    lifecycle: process.env.C3_ENABLE_LIFECYCLE !== 'false',  // Phase C: Project Lifecycle
    expertises: (() => {
      const val = process.env.C3_ENABLE_EXPERTISES ?? process.env.C3_ENABLE_EXPERTS;
      if (process.env.C3_ENABLE_EXPERTS && !process.env.C3_ENABLE_EXPERTISES) {
        console.warn('[DEPRECATED] C3_ENABLE_EXPERTS → use C3_ENABLE_EXPERTISES');
      }
      return val !== 'false';
    })(),  // Phase D: Expertises
    telemetry: process.env.C3_ENABLE_TELEMETRY !== 'false',  // Resilience telemetry
  },

  // Server
  server: {
    port: parseInt(process.env.C3_PORT || '3335'),
    host: process.env.C3_HOST || '127.0.0.1',
    // CORS: allowed origins (empty = same-origin only, '*' = allow all)
    allowedOrigins: (process.env.C3_CORS_ORIGINS || '').split(',').filter(Boolean),
    // Rate limiting: max requests per IP per window
    rateLimit: {
      windowMs: 60_000,   // 1 minute
      maxRequests: 120,    // 120 req/min per IP
    },
  },

  // Ollama
  ollama: {
    baseUrl: process.env.OLLAMA_URL || 'http://127.0.0.1:11434',
    retries: 3,
    retryDelay: 2000,
  },

  // Model bindings - which model for which role
  // ═══════════════════════════════════════════════════════
  // WORKFLOW ROLES:
  //   D1 = Deep deliberation (analysis, planning, redesign)
  //   D2 = Fix deliberation (lighter, focused on fixes)
  //   CODE = Implementation (code specialist)
  //   R1 = Final deep review (same brain as D1)
  //   R2 = Quick review (fast, good at JSON)
  // ═══════════════════════════════════════════════════════
  models: {
    // D1: Deep deliberation — analysis, planning, final review, redesign
    D1: process.env.C3_MODEL_D1 || 'deepseek-r1:32b',

    // D2: Fix deliberation — focused fix reasoning
    D2: process.env.C3_MODEL_D2 || 'qwen3-30b-a3b',

    // CODE: Implementation — code generation and fixes
    CODE: process.env.C3_MODEL_CODE || 'qwen2.5-coder:32b',

    // R1: Final deep review (= D1, same deep reasoning)
    R1: process.env.C3_MODEL_R1 || 'deepseek-r1:32b',

    // R2: Quick review — fast structural/logic check
    R2: process.env.C3_MODEL_R2 || 'qwen2.5:32b',

    CHAT: process.env.C3_MODEL_CHAT || 'qwen2.5:32b',
    VISION: process.env.C3_MODEL_VISION || 'llava:13b',
  },

  // Timeouts per role (ms)
  timeouts: {
    // Workflow roles
    D1: 120000,       // 120s — deep deliberation needs time
    D2: 60000,        // 60s — fix deliberation, focused
    CODE: 90000,      // 90s — code generation
    R1: 120000,       // 120s — deep review (= D1)
    R2: 45000,        // 45s — quick review

    CHAT: 60000,
    VISION: 60000,
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

  // Context auto-compact (background conversation compression)
  compact: {
    contextWindow: parseInt(process.env.C3_CONTEXT_WINDOW || '32768'),   // model context window in tokens
    threshold: parseFloat(process.env.C3_COMPACT_THRESHOLD || '0.75'),   // trigger at 75% fill (safe margin)
    keepTurns: parseInt(process.env.C3_COMPACT_KEEP_TURNS || '6'),       // keep last N turns uncompressed
    summaryModel: process.env.C3_COMPACT_MODEL || null,                  // null = use CHAT model
  },

  // Database
  db: {
    path: process.env.C3_DB_PATH || './data/c3.db',
  },

  // Projects
  projects: {
    defaultDir: process.env.C3_PROJECTS_DIR || './projects',
  },

  // v61: Project Lifecycle (Phase C — Collaborative Milestone Execution)
  lifecycle: {
    // How often to trigger PROJECT_REVIEW (every N milestones)
    reviewFrequency: parseInt(process.env.C3_LIFECYCLE_REVIEW_FREQ || '3'),
    // Max LOC per milestone (context budget)
    maxMilestoneLOC: parseInt(process.env.C3_MAX_MILESTONE_LOC || '2000'),
    // Max files per milestone (context budget)
    maxMilestoneFiles: parseInt(process.env.C3_MAX_MILESTONE_FILES || '10'),
    // Max retries before milestone is BLOCKED
    maxMilestoneRetries: parseInt(process.env.C3_MAX_MILESTONE_RETRIES || '3'),
    // Auto-commit on milestone PASS
    autoCommit: (process.env.C3_LIFECYCLE_AUTO_COMMIT || 'true') === 'true',
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
