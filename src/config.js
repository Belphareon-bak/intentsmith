// C.3 v120 Configuration
// ══════════════════════════════════════════════════════════════════════════════

import os from 'os';
import path from 'path';

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
    specialistTelemetry: process.env.C3_SPECIALIST_TELEMETRY !== 'false',  // v82: Specialist execution observability
    autonomy: process.env.C3_ENABLE_AUTONOMY === 'true',  // v83: Guarded autonomy (opt-IN, default OFF)
    skills: process.env.C3_ENABLE_SKILLS !== 'false',  // v85: Skills system (default ON)
  },

  // Server
  server: {
    // Port: 0 = dynamic (OS assigns free port), default 0 for conflict-free startup
    port: parseInt(process.env.C3_PORT || '0'),
    host: process.env.C3_HOST || '127.0.0.1',
    // Port file: written after listen with assigned port (for IDE discovery)
    portFile: process.env.C3_PORT_FILE || path.join(os.homedir(), '.c3', 'port'),
    // CORS: allowed origins (empty = same-origin only, '*' = allow all)
    allowedOrigins: (process.env.C3_CORS_ORIGINS || '').split(',').filter(Boolean),
    // Rate limiting: tiered per IP per window (v125)
    rateLimit: {
      windowMs: 60_000,          // 1 minute
      readMaxRequests: 600,      // GET endpoints
      writeMaxRequests: 120,     // POST/PUT/DELETE endpoints
      trustProxy: process.env.C3_TRUST_PROXY === 'true',  // trust X-Forwarded-For
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
    D1: process.env.C3_MODEL_D1 || 'deepseek-r1-32b',

    // D2: Fix deliberation — focused fix reasoning
    D2: process.env.C3_MODEL_D2 || 'qwen3-30b-a3b',

    // CODE: Implementation — code generation and fixes
    CODE: process.env.C3_MODEL_CODE || 'qwen3.5:27b',

    // R1: Final deep review (= D1, same deep reasoning)
    R1: process.env.C3_MODEL_R1 || 'deepseek-r1-32b',

    // R2: Quick review — fast structural/logic check
    R2: process.env.C3_MODEL_R2 || 'qwen3.5:27b',

    CHAT: process.env.C3_MODEL_CHAT || 'qwen3.5:27b',
    VISION: process.env.C3_MODEL_VISION || 'llava:13b',
  },

  // Timeouts per role (ms) — multiply via C3_TIMEOUT_SCALE env (default 1)
  timeouts: (() => {
    const scale = parseFloat(process.env.C3_TIMEOUT_SCALE) || 1;
    return {
      D1: 120000 * scale,
      D2: 60000 * scale,
      CODE: 120000 * scale,
      R1: 120000 * scale,
      R2: 45000 * scale,
      CHAT: 180000 * scale,
      VISION: 60000 * scale,
    };
  })(),

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
    // v104: Max iterations for execution loop fix cycle
    maxLoopIterations: parseInt(process.env.C3_MAX_LOOP_ITERATIONS || '8'),
  },

  // v83: Guarded Autonomy — self-tuning CRE parameters
  autonomy: {
    intervalMs: parseInt(process.env.C3_AUTONOMY_INTERVAL || '900000'),    // 15 min
    minTurnsPerWindow: parseInt(process.env.C3_AUTONOMY_MIN_TURNS || '10'),
    trustThreshold: 10,  // consecutive approvals before auto-apply
    parameters: {
      overrideThreshold: {
        min: 0.75,
        max: 0.90,
        maxStep: 0.03,
        default: 0.85,
      },
    },
    rollbackGuards: {
      askUserSpikePercent: 8.0,
      breakSpikePercent: 5.0,
      baselineWindows: 6,
      cooldownWindows: 2,
    },
  },

  // File handling limits
  limits: {
    maxFileSize: parseInt(process.env.C3_MAX_FILE_SIZE || String(1024 * 1024)),            // 1 MB
    maxDisplayLines: parseInt(process.env.C3_MAX_DISPLAY_LINES || '500'),
    maxTextAttachment: parseInt(process.env.C3_MAX_TEXT_ATTACHMENT || String(1024 * 1024)), // 1 MB
    maxImageAttachment: parseInt(process.env.C3_MAX_IMAGE_ATTACHMENT || String(5242880)),   // 5 MB
    maxBodySize: parseInt(process.env.C3_MAX_BODY_SIZE || String(6291456)),                 // 6 MB
    maxTreeDepth: parseInt(process.env.C3_MAX_TREE_DEPTH || '5'),
  },

  // v125: Session concurrency — prepared for multi-session / multi-GPU
  sessions: {
    // Max concurrent LLM-active sessions (1 = single GPU, >1 = multi-GPU)
    // Single GPU: only 1 session can use LLM at a time (model thrashing otherwise)
    maxConcurrentLLM: parseInt(process.env.C3_MAX_CONCURRENT_LLM || '1'),
    // Queue timeout: how long a session waits for LLM slot before rejecting (ms)
    llmQueueTimeout: parseInt(process.env.C3_LLM_QUEUE_TIMEOUT || '300000'),  // 5 min
    // Auto-detect GPU count and set maxConcurrentLLM = dedicated GPU count
    gpuAutoScale: process.env.C3_GPU_AUTO_SCALE === 'true',
  },

  // v125: LLM provider configuration — prepared for future online model support
  // Currently only 'ollama' is implemented. 'openai' is a stub for future CLI integration.
  providers: {
    active: process.env.C3_LLM_PROVIDER || 'ollama',
    // Future: OpenAI-compatible API (Claude, GPT, Groq, etc.)
    // When implemented, set C3_LLM_PROVIDER=openai and configure:
    // openai: {
    //   baseUrl: process.env.C3_OPENAI_URL || 'https://api.openai.com/v1',
    //   apiKey: process.env.C3_OPENAI_KEY,
    //   model: process.env.C3_OPENAI_MODEL || 'gpt-4o',
    // },
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

// v124: Marketplace
config.marketplace = {
  catalogUrl: process.env.C3_MARKETPLACE_URL || 'https://raw.githubusercontent.com/Belphareon-bak/C3-agent/master/marketplace/catalog.json',
};

export default config;
