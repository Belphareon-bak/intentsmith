// C.3 v120 Configuration
// ══════════════════════════════════════════════════════════════════════════════

import os from 'os';
import path from 'path';
import { resolveHttpTimeoutPolicy, resolveRoleTimeouts } from './timeout-policy.js';

export const DEFAULT_MODEL_BINDINGS = Object.freeze({
  D1: 'qwen3.5:27b',
  D2: 'qwen3.8:latest',
  CODE: 'qwen3.5:27b',
  R1: 'qwen3.8:latest',
  R2: 'qwen3:14b',
  CHAT: 'qwen3.5:27b',
  VISION: 'llava-llama3:8b',
});

export const config = {
  // Feature flags — enable/disable optional modules (B/C/D)
  // Core chat works without any of these.
  features: {
    agents:    (process.env.INTENTSMITH_ENABLE_AGENTS ?? process.env['C3_ENABLE_AGENTS']) !== 'false',     // Phase B: Workers
    lifecycle: (process.env.INTENTSMITH_ENABLE_LIFECYCLE ?? process.env['C3_ENABLE_LIFECYCLE']) !== 'false',  // Phase C: Project Lifecycle
    expertises: (() => {
      const val = (process.env.INTENTSMITH_ENABLE_EXPERTISES ?? process.env['C3_ENABLE_EXPERTISES']) ?? (process.env.INTENTSMITH_ENABLE_EXPERTS ?? process.env['C3_ENABLE_EXPERTS']);
      if ((process.env.INTENTSMITH_ENABLE_EXPERTS ?? process.env['C3_ENABLE_EXPERTS']) && !(process.env.INTENTSMITH_ENABLE_EXPERTISES ?? process.env['C3_ENABLE_EXPERTISES'])) {
        console.warn('[DEPRECATED] INTENTSMITH_ENABLE_EXPERTS → use INTENTSMITH_ENABLE_EXPERTISES');
      }
      return val !== 'false';
    })(),  // Phase D: Expertises
    telemetry: (process.env.INTENTSMITH_ENABLE_TELEMETRY ?? process.env['C3_ENABLE_TELEMETRY']) !== 'false',  // Resilience telemetry
    specialistTelemetry: (process.env.INTENTSMITH_SPECIALIST_TELEMETRY ?? process.env['C3_SPECIALIST_TELEMETRY']) !== 'false',  // v82: Specialist execution observability
    autonomy: (process.env.INTENTSMITH_ENABLE_AUTONOMY ?? process.env['C3_ENABLE_AUTONOMY']) === 'true',  // v83: Guarded autonomy (opt-IN, default OFF)
    skills: (process.env.INTENTSMITH_ENABLE_SKILLS ?? process.env['C3_ENABLE_SKILLS']) !== 'false',  // v85: Skills system (default ON)
    // M5 release freeze: conditional external surfaces are opt-in in development
    // and rejected as unsupported in production until they gain an M6 journey.
    comfyui: (process.env.INTENTSMITH_ENABLE_COMFYUI ?? process.env['C3_ENABLE_COMFYUI']) === 'true',
    marketplace: (process.env.INTENTSMITH_ENABLE_MARKETPLACE ?? process.env['C3_ENABLE_MARKETPLACE']) === 'true',
    externalNotifications: (process.env.INTENTSMITH_ENABLE_EXTERNAL_NOTIFICATIONS ?? process.env['C3_ENABLE_EXTERNAL_NOTIFICATIONS']) === 'true',
    // Outbound model discovery (L4 online discovery, L5 WhatLLM benchmarks,
    // registry verify). This is the only path on which the product contacts
    // anything outside the machine.
    //
    // Operator decision 2026-08-19 (DIRECTION.md): default ON, opt-OUT via
    // INTENTSMITH_ENABLE_ONLINE_DISCOVERY=false. Keeping a local model set current is
    // worth the outbound traffic; without discovery the catalog silently ages.
    // M5 does not reverse that decision: enabled requests cross the centralized
    // exact-origin scope and append-only audit. Every discovery path still
    // degrades independently, so the local catalog remains usable offline.
    onlineDiscovery: (process.env.INTENTSMITH_ENABLE_ONLINE_DISCOVERY ?? process.env['C3_ENABLE_ONLINE_DISCOVERY']) !== 'false',
  },

  // Server
  server: {
    // Port: 0 = dynamic (OS assigns free port), default 0 for conflict-free startup
    port: parseInt((process.env.INTENTSMITH_PORT ?? process.env['C3_PORT']) || '0'),
    host: (process.env.INTENTSMITH_HOST ?? process.env['C3_HOST']) || '127.0.0.1',
    // Port file: written after listen with assigned port (for IDE discovery)
    portFile: (process.env.INTENTSMITH_PORT_FILE ?? process.env['C3_PORT_FILE']) || path.join(os.homedir(), '.intentsmith', 'port'),
    // CORS: explicit local HTTP origins only (empty = same-origin only).
    // The src/server.js entrypoint imports runtime-environment.js first, so it
    // rejects wildcards and non-local origins before product runtime state.
    // Other entrypoints must import that bootstrap explicitly; the listener
    // and per-request guards still revalidate their own boundaries fail closed.
    allowedOrigins: ((process.env.INTENTSMITH_CORS_ORIGINS ?? process.env['C3_CORS_ORIGINS']) || '').split(',').filter(Boolean),
    // Rate limiting: tiered per IP per window (v125)
    rateLimit: {
      windowMs: 60_000,          // 1 minute
      readMaxRequests: 600,      // GET endpoints
      writeMaxRequests: 120,     // POST/PUT/DELETE endpoints
      trustProxy: (process.env.INTENTSMITH_TRUST_PROXY ?? process.env['C3_TRUST_PROXY']) === 'true',  // trust X-Forwarded-For
    },
    // Finite request-receipt protection; LLM response duration is controlled
    // independently by the per-role timeouts below.
    httpTimeouts: resolveHttpTimeoutPolicy(),
  },

  // Ollama
  ollama: {
    baseUrl: process.env.OLLAMA_URL || 'http://127.0.0.1:11434',
    modelsPath: process.env.OLLAMA_MODELS || '/usr/share/ollama/.ollama/models',
    retries: 3,
    retryDelay: 2000,
  },

  // v130: ComfyUI (multimedia generation)
  comfyui: {
    baseUrl: (process.env.INTENTSMITH_COMFYUI_URL ?? process.env['C3_COMFYUI_URL']) || 'http://127.0.0.1:8188',
    timeout: parseInt((process.env.INTENTSMITH_COMFYUI_TIMEOUT ?? process.env['C3_COMFYUI_TIMEOUT']) || '300000'),  // 5min (video gen is slow)
    retries: 2,
    maxStorageGB: parseInt((process.env.INTENTSMITH_COMFYUI_MAX_STORAGE_GB ?? process.env['C3_COMFYUI_MAX_STORAGE_GB']) || '10'),
    maxOutputSizeMB: parseInt((process.env.INTENTSMITH_COMFYUI_MAX_OUTPUT_MB ?? process.env['C3_COMFYUI_MAX_OUTPUT_MB']) || '100'),
  },

  // Model bindings - which model for which role
  // ═══════════════════════════════════════════════════════
  // WORKFLOW ROLES:
  //   D1 = Deep deliberation (analysis, planning, redesign)
  //   D2 = Fix deliberation (lighter, focused on fixes)
  //   CODE = Implementation (code specialist)
  //   R1 = Final deep review
  //   R2 = Quick review (fast, good at JSON)
  // ═══════════════════════════════════════════════════════
  models: {
    // D1: Deep deliberation — analysis, planning, final review, redesign
    D1: (process.env.INTENTSMITH_MODEL_D1 ?? process.env['C3_MODEL_D1']) || DEFAULT_MODEL_BINDINGS.D1,

    // D2: Fix deliberation — focused fix reasoning
    D2: (process.env.INTENTSMITH_MODEL_D2 ?? process.env['C3_MODEL_D2']) || DEFAULT_MODEL_BINDINGS.D2,

    // CODE: Implementation — code generation and fixes
    CODE: (process.env.INTENTSMITH_MODEL_CODE ?? process.env['C3_MODEL_CODE']) || DEFAULT_MODEL_BINDINGS.CODE,

    // R1: Final deep review
    R1: (process.env.INTENTSMITH_MODEL_R1 ?? process.env['C3_MODEL_R1']) || DEFAULT_MODEL_BINDINGS.R1,

    // R2: Quick review — fast structural/logic check
    R2: (process.env.INTENTSMITH_MODEL_R2 ?? process.env['C3_MODEL_R2']) || DEFAULT_MODEL_BINDINGS.R2,

    CHAT: (process.env.INTENTSMITH_MODEL_CHAT ?? process.env['C3_MODEL_CHAT']) || DEFAULT_MODEL_BINDINGS.CHAT,
    VISION: (process.env.INTENTSMITH_MODEL_VISION ?? process.env['C3_MODEL_VISION']) || DEFAULT_MODEL_BINDINGS.VISION,
  },

  // Timeouts per role (ms) — multiply via INTENTSMITH_TIMEOUT_SCALE env (default 1)
  timeouts: resolveRoleTimeouts(),

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
    contextWindow: parseInt((process.env.INTENTSMITH_CONTEXT_WINDOW ?? process.env['C3_CONTEXT_WINDOW']) || '32768'),   // model context window in tokens
    threshold: parseFloat((process.env.INTENTSMITH_COMPACT_THRESHOLD ?? process.env['C3_COMPACT_THRESHOLD']) || '0.75'),   // trigger at 75% fill (safe margin)
    keepTurns: parseInt((process.env.INTENTSMITH_COMPACT_KEEP_TURNS ?? process.env['C3_COMPACT_KEEP_TURNS']) || '6'),       // keep last N turns uncompressed
    summaryModel: (process.env.INTENTSMITH_COMPACT_MODEL ?? process.env['C3_COMPACT_MODEL']) || null,                  // null = use CHAT model
  },

  // Database
  db: {
    // Runtime entry points establish the project-local default explicitly.
    // Library/test imports without that bootstrap must fail closed.
    path: (process.env.INTENTSMITH_DB_PATH ?? process.env['C3_DB_PATH'])?.trim() || null,
  },

  // Projects
  projects: {
    defaultDir: (process.env.INTENTSMITH_PROJECTS_DIR ?? process.env['C3_PROJECTS_DIR']) || './projects',
  },

  // v61: Project Lifecycle (Phase C — Collaborative Milestone Execution)
  lifecycle: {
    // How often to trigger PROJECT_REVIEW (every N milestones)
    reviewFrequency: parseInt((process.env.INTENTSMITH_LIFECYCLE_REVIEW_FREQ ?? process.env['C3_LIFECYCLE_REVIEW_FREQ']) || '3'),
    // Max LOC per milestone (context budget)
    maxMilestoneLOC: parseInt((process.env.INTENTSMITH_MAX_MILESTONE_LOC ?? process.env['C3_MAX_MILESTONE_LOC']) || '2000'),
    // Max files per milestone (context budget)
    maxMilestoneFiles: parseInt((process.env.INTENTSMITH_MAX_MILESTONE_FILES ?? process.env['C3_MAX_MILESTONE_FILES']) || '10'),
    // Max retries before milestone is BLOCKED
    maxMilestoneRetries: parseInt((process.env.INTENTSMITH_MAX_MILESTONE_RETRIES ?? process.env['C3_MAX_MILESTONE_RETRIES']) || '3'),
    // Auto-commit on milestone PASS
    autoCommit: ((process.env.INTENTSMITH_LIFECYCLE_AUTO_COMMIT ?? process.env['C3_LIFECYCLE_AUTO_COMMIT']) || 'true') === 'true',
    // v104: Max iterations for execution loop fix cycle
    maxLoopIterations: parseInt((process.env.INTENTSMITH_MAX_LOOP_ITERATIONS ?? process.env['C3_MAX_LOOP_ITERATIONS']) || '8'),
  },

  // v83: Guarded Autonomy — self-tuning CRE parameters
  autonomy: {
    intervalMs: parseInt((process.env.INTENTSMITH_AUTONOMY_INTERVAL ?? process.env['C3_AUTONOMY_INTERVAL']) || '900000'),    // 15 min
    minTurnsPerWindow: parseInt((process.env.INTENTSMITH_AUTONOMY_MIN_TURNS ?? process.env['C3_AUTONOMY_MIN_TURNS']) || '10'),
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
    maxFileSize: parseInt((process.env.INTENTSMITH_MAX_FILE_SIZE ?? process.env['C3_MAX_FILE_SIZE']) || String(1024 * 1024)),            // 1 MB
    maxDisplayLines: parseInt((process.env.INTENTSMITH_MAX_DISPLAY_LINES ?? process.env['C3_MAX_DISPLAY_LINES']) || '500'),
    maxTextAttachment: parseInt((process.env.INTENTSMITH_MAX_TEXT_ATTACHMENT ?? process.env['C3_MAX_TEXT_ATTACHMENT']) || String(1024 * 1024)), // 1 MB
    maxImageAttachment: parseInt((process.env.INTENTSMITH_MAX_IMAGE_ATTACHMENT ?? process.env['C3_MAX_IMAGE_ATTACHMENT']) || String(5242880)),   // 5 MB
    maxDocumentAttachment: parseInt((process.env.INTENTSMITH_MAX_DOCUMENT_ATTACHMENT ?? process.env['C3_MAX_DOCUMENT_ATTACHMENT']) || String(10 * 1024 * 1024)), // PDF/HEIC, measured 6.56 MiB receipt photo
    maxBodySize: parseInt((process.env.INTENTSMITH_MAX_BODY_SIZE ?? process.env['C3_MAX_BODY_SIZE']) || String(6291456)),                 // 6 MB
    maxTreeDepth: parseInt((process.env.INTENTSMITH_MAX_TREE_DEPTH ?? process.env['C3_MAX_TREE_DEPTH']) || '5'),
  },

  // v125: Session concurrency — prepared for multi-session / multi-GPU
  sessions: {
    // Max concurrent LLM-active sessions (1 = single GPU, >1 = multi-GPU)
    // Single GPU: only 1 session can use LLM at a time (model thrashing otherwise)
    maxConcurrentLLM: parseInt((process.env.INTENTSMITH_MAX_CONCURRENT_LLM ?? process.env['C3_MAX_CONCURRENT_LLM']) || '1'),
    // Queue timeout: how long a session waits for LLM slot before rejecting (ms)
    llmQueueTimeout: parseInt((process.env.INTENTSMITH_LLM_QUEUE_TIMEOUT ?? process.env['C3_LLM_QUEUE_TIMEOUT']) || '300000'),  // 5 min
    // Auto-detect GPU count and set maxConcurrentLLM = dedicated GPU count
    gpuAutoScale: (process.env.INTENTSMITH_GPU_AUTO_SCALE ?? process.env['C3_GPU_AUTO_SCALE']) === 'true',
  },

  // v125: LLM provider configuration — prepared for future online model support
  // Currently only 'ollama' is implemented. 'openai' is a stub for future CLI integration.
  providers: {
    active: (process.env.INTENTSMITH_LLM_PROVIDER ?? process.env['C3_LLM_PROVIDER']) || 'ollama',
    // Future: OpenAI-compatible API (Claude, GPT, Groq, etc.)
    // When implemented, set INTENTSMITH_LLM_PROVIDER=openai and configure:
    // openai: {
    //   baseUrl: (process.env.INTENTSMITH_OPENAI_URL ?? process.env['C3_OPENAI_URL']) || 'https://api.openai.com/v1',
    //   apiKey: (process.env.INTENTSMITH_OPENAI_KEY ?? process.env['C3_OPENAI_KEY']),
    //   model: (process.env.INTENTSMITH_OPENAI_MODEL ?? process.env['C3_OPENAI_MODEL']) || 'gpt-4o',
    // },
  },

  // Logging
  log: {
    level: (process.env.INTENTSMITH_LOG_LEVEL ?? process.env['C3_LOG_LEVEL']) || 'info', // debug, info, warn, error
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
  catalogUrl: (process.env.INTENTSMITH_MARKETPLACE_URL ?? process.env['C3_MARKETPLACE_URL']) || 'https://raw.githubusercontent.com/C3studio/C3-agent/master/marketplace/catalog.json',
};

export default config;
