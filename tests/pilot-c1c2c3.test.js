// Pilot C1-C2-C3 — Real-world Quality Score Distribution Test
// ══════════════════════════════════════════════════════════════════════════════
//
// 3 different use cases scored through the full pipeline:
//   C1: Backend system (multi-tenant REST API + RBAC) — architectural depth
//   C2: CLI tool (backup CLI) — low ceremony, friction sensitivity
//   C3: Web app with scope changes — change management stress test
//
// PRAVIDLO: Žádné zásahy do vah, heuristik, promptů ani scoringu.
//           Pilot je pozorování, ne ladění.
//
// ══════════════════════════════════════════════════════════════════════════════

import {
  db,
  projects,
  lifecycles as lifecycleRepo,
  qualityScores,
} from '../src/db/database.js';

import {
  computeSpecScore,
  computeRoadmapScore,
  computeChangeScore,
  computeLifecycleScore,
} from '../src/planner/quality-score.js';

import {
  logSpecScore,
  logRoadmapScore,
  logChangeScore,
  logLifecycleScore,
  getLatestScores,
  getScoreHistory,
  getScoreTrend,
} from '../src/planner/quality-telemetry.js';

import {
  getSummary,
  getProjectReport,
  getDistribution,
  getVolatilityIndex,
  getSpecVersionDelta,
  generateTextReport,
} from '../src/planner/quality-report.js';

// ─── Test infrastructure ────────────────────────────────────────────────────

let passed = 0;
let failed = 0;
const failures = [];

function check(condition, name, detail = '') {
  if (condition) {
    console.log(`  ✓ ${name}`);
    passed++;
  } else {
    console.log(`  ✗ ${name}${detail ? ` — ${detail}` : ''}`);
    failed++;
    failures.push({ name, detail });
  }
}

function inRange(value, min, max) {
  return value >= min && value <= max;
}

const TS = Date.now();
const LC_C1 = `lc-pilot-c1-${TS}`;
const LC_C2 = `lc-pilot-c2-${TS}`;
const LC_C3 = `lc-pilot-c3-${TS}`;

// ─── Cleanup ────────────────────────────────────────────────────────────────

function cleanDB() {
  for (const lcId of [LC_C1, LC_C2, LC_C3]) {
    try { db.prepare(`DELETE FROM quality_scores WHERE lifecycle_id = ?`).run(lcId); } catch {}
    try { db.prepare(`DELETE FROM project_lifecycles WHERE id = ?`).run(lcId); } catch {}
  }
  try { db.prepare(`DELETE FROM projects WHERE name LIKE 'pilot-c%'`).run(); } catch {}
}

function setupLifecycle(lcId, projectName, desc) {
  const project = projects.getOrCreate(projectName, `/tmp/${projectName}`, desc);
  lifecycleRepo.save(lcId, Number(project.id), 'SPEC', null, {});
}

// ═══════════════════════════════════════════════════════════════════════════════
// C1: Backend System — Multi-tenant REST API + RBAC
// ═══════════════════════════════════════════════════════════════════════════════

function makeC1Spec() {
  return {
    title: 'Multi-tenant REST API pro správu projektů s RBAC, audit logem a rate limitingem',
    goals: [
      {
        id: 'G1',
        description: 'Multi-tenant data isolation — each tenant sees only own data',
        priority: 'MUST',
        success_criteria: 'GET /api/projects with tenant-A token returns 0 results from tenant-B. Verified with integration test using 2 tenants, 5 projects each.',
      },
      {
        id: 'G2',
        description: 'Role-based access control with 4 roles: admin, manager, developer, viewer',
        priority: 'MUST',
        success_criteria: 'POST /api/projects with viewer token → 403 Forbidden. Admin can CRUD all. Manager can CRUD own team. Developer can read + update assigned. Verified with permission matrix test (4 roles × 6 endpoints = 24 cases).',
      },
      {
        id: 'G3',
        description: 'Complete audit log of all state-changing operations',
        priority: 'MUST',
        success_criteria: 'Every POST/PUT/DELETE creates audit_log entry with { user_id, action, resource, before, after, timestamp }. Verified: 100 random operations → 100 audit entries, queryable by user_id and date range.',
      },
      {
        id: 'G4',
        description: 'Rate limiting per tenant to prevent abuse',
        priority: 'SHOULD',
        success_criteria: 'Tenant exceeding 100 req/min gets 429 Too Many Requests. Sliding window. Verified with autocannon: 200 requests in 30s → first 100 succeed, rest get 429.',
      },
    ],
    requirements: {
      functional: [
        {
          id: 'R1',
          description: 'JWT-based authentication with RS256 signing',
          goal_id: 'G2',
          acceptance_test: 'POST /auth/login { email, password } → { access_token, refresh_token, expires_in: 3600 }. Invalid credentials → 401.',
        },
        {
          id: 'R2',
          description: 'CRUD operations for projects resource',
          goal_id: 'G1',
          acceptance_test: 'POST /api/projects { name, description } → 201 with Location header. GET /api/projects → paginated list. PUT /api/projects/:id → 200. DELETE → 204.',
        },
        {
          id: 'R3',
          description: 'Tenant middleware extracts tenant_id from JWT and scopes all queries',
          goal_id: 'G1',
          acceptance_test: 'All repository methods receive tenant_id. SELECT * FROM projects WHERE tenant_id = ? verified in query logs.',
        },
        {
          id: 'R4',
          description: 'Permission middleware checks role before handler execution',
          goal_id: 'G2',
          acceptance_test: 'Middleware chain: authenticate → extractTenant → checkPermission → handler. Missing role → 403 before handler runs (verified with spy).',
        },
        {
          id: 'R5',
          description: 'Audit log middleware captures before/after state for mutations',
          goal_id: 'G3',
          acceptance_test: 'PUT /api/projects/1 { name: "new" } → audit_log row with before={ name: "old" }, after={ name: "new" }, diff computed.',
        },
        {
          id: 'R6',
          description: 'Rate limiter with sliding window algorithm per tenant',
          goal_id: 'G4',
          acceptance_test: 'Redis ZRANGEBYSCORE-based sliding window. 101st request in 60s window → 429 with Retry-After header.',
        },
        {
          id: 'R7',
          description: 'Refresh token rotation with one-time use',
          goal_id: 'G2',
          acceptance_test: 'POST /auth/refresh { refresh_token } → new pair. Reuse of old refresh_token → 401 + invalidate all tokens for user.',
        },
      ],
      non_functional: [
        {
          id: 'NF1',
          category: 'security',
          description: 'No SQL injection, XSS, or CSRF vulnerabilities',
          metric: 'OWASP ZAP scan with 0 high/critical findings. All inputs parameterized (no string concat in SQL).',
        },
        {
          id: 'NF2',
          category: 'performance',
          description: 'API response time under load',
          metric: 'p95 latency < 200ms at 50 concurrent users (measured with k6). GET /api/projects < 50ms at p50.',
        },
        {
          id: 'NF3',
          category: 'reliability',
          description: 'Graceful degradation when Redis is unavailable',
          metric: 'Rate limiter falls back to in-memory with warning log. API continues serving with degraded rate limiting.',
        },
        {
          id: 'NF4',
          category: 'observability',
          description: 'Structured JSON logging with correlation IDs',
          metric: 'Every request gets X-Request-Id header. Logs include { request_id, tenant_id, user_id, method, path, status, duration_ms }.',
        },
      ],
    },
    tech_stack: {
      languages: ['Node.js 22', 'TypeScript 5.4'],
      frameworks: ['Fastify 5', 'Prisma 6'],
      tools: ['PostgreSQL 16', 'Redis 7', 'jose (JWT)', 'pino (logging)'],
      rationale: 'Fastify for performance (2x Express throughput). Prisma for type-safe DB access with migration support. PostgreSQL for ACID transactions and row-level security. Redis for distributed rate limiting and session cache.',
    },
    design_decisions: [
      {
        id: 'DD1',
        decision: 'Authentication strategy',
        chosen: 'JWT with RS256 + refresh token rotation',
        alternatives_considered: ['Session-based auth with Redis store', 'OAuth2 with external IdP (Auth0)', 'API key per tenant'],
        rationale: 'JWT enables stateless auth, reducing Redis dependency for every request. RS256 allows public key verification without shared secret. Session-based would be simpler but requires Redis for every request — however JWT trades off revocation complexity for scalability. API keys lack user-level granularity.',
      },
      {
        id: 'DD2',
        decision: 'Multi-tenancy isolation model',
        chosen: 'Shared database with tenant_id column + RLS policies',
        alternatives_considered: ['Database per tenant', 'Schema per tenant'],
        rationale: 'Shared DB with RLS is operationally simplest (one migration, one connection pool). Database-per-tenant provides strongest isolation but is operationally expensive (N databases, N migrations). Schema-per-tenant is a middle ground, however PostgreSQL RLS provides equivalent security guarantees with lower operational overhead.',
      },
      {
        id: 'DD3',
        decision: 'Rate limiting algorithm',
        chosen: 'Redis sorted set sliding window',
        alternatives_considered: ['Token bucket (node-rate-limiter)', 'Fixed window counter', 'Leaky bucket'],
        rationale: 'Sliding window prevents burst-at-boundary attacks that fixed windows allow. Token bucket is simpler but harder to distribute across instances. Redis sorted sets provide O(log N) operations with automatic expiry, whereas in-memory solutions do not survive process restarts.',
      },
    ],
    risks: [
      {
        id: 'RISK1',
        description: 'Tenant data leak through missing WHERE clause or JOIN without tenant_id filter',
        severity: 'CRITICAL',
        likelihood: 'MEDIUM',
        mitigation: 'PostgreSQL RLS as safety net. Integration test suite with 2 tenants checking cross-tenant isolation on every endpoint. Code review checklist includes tenant_id verification.',
      },
      {
        id: 'RISK2',
        description: 'JWT token theft enables persistent unauthorized access until expiry',
        severity: 'HIGH',
        likelihood: 'LOW',
        mitigation: 'Short-lived access tokens (15 min). Refresh token rotation (one-time use). Token revocation list in Redis checked on sensitive operations.',
      },
      {
        id: 'RISK3',
        description: 'Rate limiter Redis failure blocks all API requests',
        severity: 'HIGH',
        likelihood: 'LOW',
        mitigation: 'Circuit breaker pattern: if Redis unreachable for >3s, fall back to in-memory rate limiter with conservative limits. Alert on fallback activation.',
      },
    ],
    acceptance_criteria: [
      'Multi-tenant isolation: tenant-A cannot access tenant-B data (24 endpoint × 2 tenant matrix)',
      'RBAC: 4 roles × 6 endpoints permission matrix passes (24 cases)',
      'Audit log: 100% of mutations captured with before/after diff',
      'Rate limiting: 429 returned at configured threshold (±5% tolerance)',
      'CI pipeline green: lint + unit + integration + OWASP ZAP scan',
    ],
  };
}

function makeC1Roadmap() {
  return {
    milestones: [
      {
        id: 'ms-1',
        title: 'Database Schema + Prisma Setup',
        sequence: 1,
        description: 'PostgreSQL schema with tenants, users, roles, projects, audit_log tables. Prisma schema with RLS policies. Seed script for dev data.',
        dependencies: [],
        estimated_loc: 500,
        estimated_files: 8,
        estimated_complexity: 'MEDIUM',
        goals_addressed: ['G1'],
        requirements_addressed: ['R3'],
        acceptance_criteria: [
          'prisma migrate deploy creates all tables',
          'RLS policy: SET app.tenant_id = X → SELECT only returns tenant X rows',
          'Seed script creates 2 tenants with 5 projects each',
        ],
        test_strategy: {
          type: 'integration',
          description: 'Migration + RLS verification with 2 concurrent tenant connections',
          expected_test_count: 6,
        },
      },
      {
        id: 'ms-2',
        title: 'Auth Module (JWT + Refresh)',
        sequence: 2,
        description: 'RS256 JWT generation/verification. Login endpoint. Refresh token rotation with one-time use. Token invalidation.',
        dependencies: ['ms-1'],
        estimated_loc: 700,
        estimated_files: 6,
        estimated_complexity: 'HIGH',
        goals_addressed: ['G2'],
        requirements_addressed: ['R1', 'R7'],
        acceptance_criteria: [
          'POST /auth/login → JWT pair',
          'Invalid credentials → 401',
          'Refresh → new pair, old invalidated',
          'Reuse old refresh → 401 + revoke all',
        ],
        test_strategy: {
          type: 'unit+integration',
          description: 'JWT crypto unit tests + login/refresh integration tests',
          expected_test_count: 12,
        },
      },
      {
        id: 'ms-3',
        title: 'RBAC Middleware + Permission Matrix',
        sequence: 3,
        description: 'Role extraction from JWT. Permission matrix (4 roles × actions). Middleware chain: authenticate → extractTenant → checkPermission.',
        dependencies: ['ms-2'],
        estimated_loc: 400,
        estimated_files: 5,
        estimated_complexity: 'MEDIUM',
        goals_addressed: ['G2'],
        requirements_addressed: ['R4'],
        acceptance_criteria: [
          'Admin: full CRUD on all resources',
          'Viewer: read-only, POST/PUT/DELETE → 403',
          'Manager: CRUD own team resources',
          'Missing role claim → 403',
        ],
        test_strategy: {
          type: 'unit+integration',
          description: 'Permission matrix parameterized tests (4×6=24 cases)',
          expected_test_count: 24,
        },
      },
      {
        id: 'ms-4',
        title: 'Projects CRUD + Audit Log',
        sequence: 4,
        description: 'RESTful projects endpoints with pagination, filtering, sorting. Audit log middleware capturing before/after state diffs.',
        dependencies: ['ms-3'],
        estimated_loc: 600,
        estimated_files: 7,
        estimated_complexity: 'MEDIUM',
        goals_addressed: ['G1', 'G3'],
        requirements_addressed: ['R2', 'R5'],
        acceptance_criteria: [
          'CRUD endpoints return correct status codes',
          'Pagination with cursor-based navigation',
          'Audit log entry for every mutation with diff',
          'Audit log queryable by user_id and date range',
        ],
        test_strategy: {
          type: 'integration',
          description: 'CRUD + audit verification with 2-tenant isolation check',
          expected_test_count: 15,
        },
      },
      {
        id: 'ms-5',
        title: 'Rate Limiter + Observability',
        sequence: 5,
        description: 'Redis sliding window rate limiter. Fallback to in-memory. Structured logging with pino. Correlation IDs. Health check endpoint.',
        dependencies: ['ms-1'],
        estimated_loc: 450,
        estimated_files: 5,
        estimated_complexity: 'MEDIUM',
        goals_addressed: ['G4'],
        requirements_addressed: ['R6'],
        acceptance_criteria: [
          '101st request in 60s → 429 with Retry-After',
          'Redis down → in-memory fallback + warning log',
          'Every log line has request_id, tenant_id',
          'GET /health → { status, uptime, redis }',
        ],
        test_strategy: {
          type: 'unit+integration',
          description: 'Sliding window unit test + load test with autocannon',
          expected_test_count: 10,
        },
      },
    ],
    requirements_coverage: {
      covered: ['R1', 'R2', 'R3', 'R4', 'R5', 'R6', 'R7'],
      uncovered: [],
    },
  };
}

// ═══════════════════════════════════════════════════════════════════════════════
// C2: CLI Tool — Backup with Versioning
// ═══════════════════════════════════════════════════════════════════════════════

function makeC2Spec() {
  return {
    title: 'Zálohovací CLI nástroj s verzováním, kompresí a možností restore',
    goals: [
      {
        id: 'G1',
        description: 'Create compressed backups of specified directories',
        priority: 'MUST',
        success_criteria: 'backuptool backup /data → creates timestamped .tar.gz in ~/.backuptool/store/, verified with tar -tzf listing all original files.',
      },
      {
        id: 'G2',
        description: 'Versioned backup history with list and diff',
        priority: 'MUST',
        success_criteria: 'backuptool list → shows versions with timestamps and sizes. backuptool diff v3 v5 → shows added/removed/changed files between versions.',
      },
      {
        id: 'G3',
        description: 'Restore any version to original or custom location',
        priority: 'MUST',
        success_criteria: 'backuptool restore v3 → restores to original path. backuptool restore v3 --to /tmp/restore → restores to /tmp/restore. Checksum verification after restore.',
      },
    ],
    requirements: {
      functional: [
        {
          id: 'R1',
          description: 'backuptool backup <dir> creates versioned archive',
          goal_id: 'G1',
          acceptance_test: 'backuptool backup /tmp/testdir → v1 created, backuptool backup /tmp/testdir → v2 created. Both exist in store.',
        },
        {
          id: 'R2',
          description: 'backuptool list shows all versions',
          goal_id: 'G2',
          acceptance_test: 'After 3 backups: backuptool list → "v1 2026-02-24 14:30 1.2MB" format, 3 rows.',
        },
        {
          id: 'R3',
          description: 'backuptool restore <version> restores files',
          goal_id: 'G3',
          acceptance_test: 'Create file A, backup v1. Delete A, create B. backup v2. backuptool restore v1 → A exists, B gone.',
        },
        {
          id: 'R4',
          description: 'backuptool diff <v1> <v2> shows changes',
          goal_id: 'G2',
          acceptance_test: 'v1 has {a.txt, b.txt}. v2 has {a.txt, c.txt}. diff v1 v2 → added: c.txt, removed: b.txt.',
        },
        {
          id: 'R5',
          description: 'backuptool prune --keep-last N removes old versions',
          goal_id: 'G2',
          acceptance_test: 'After 10 backups: backuptool prune --keep-last 3 → only v8, v9, v10 remain.',
        },
      ],
      non_functional: [
        {
          id: 'NF1',
          category: 'performance',
          description: 'Backup speed for typical project',
          metric: 'Backup of 500MB directory completes in <30s on SSD. Compression ratio ≥ 2:1 for text-heavy projects.',
        },
        {
          id: 'NF2',
          category: 'reliability',
          description: 'Atomic backup — no partial archives on crash',
          metric: 'Kill -9 during backup → no corrupted .tar.gz in store (write to temp + rename).',
        },
        {
          id: 'NF3',
          category: 'usability',
          description: 'Clear error messages and progress indicators',
          metric: 'Missing directory → "Error: /foo does not exist" (exit code 1). Large backup → progress bar with ETA.',
        },
      ],
    },
    tech_stack: {
      languages: ['Node.js 22'],
      frameworks: ['commander 12'],
      tools: ['tar (node:child_process)', 'zlib (node:zlib)', 'better-sqlite3'],
      rationale: 'Node.js for cross-platform CLI. Native tar+zlib for compression performance. SQLite for version metadata (no external DB dependency).',
    },
    design_decisions: [
      {
        id: 'DD1',
        decision: 'Compression strategy',
        chosen: 'tar + gzip via native node:child_process tar command',
        alternatives_considered: ['archiver npm package', 'node-tar (pure JS)'],
        rationale: 'Native tar is 3-5x faster than pure JS implementations for large directories. archiver adds dependency bloat. However, native tar requires tar binary on PATH — acceptable since all target platforms (Linux, macOS) include it by default.',
      },
      {
        id: 'DD2',
        decision: 'Version metadata storage',
        chosen: 'SQLite database in ~/.backuptool/meta.db',
        alternatives_considered: ['JSON manifest file', 'Filename-based versioning (backup-v1.tar.gz)'],
        rationale: 'SQLite enables efficient queries (list, diff, prune) without loading entire history. JSON manifest risks corruption on concurrent access. Filename-based versioning lacks metadata (source path, checksum) but is simpler for single-user scenarios — on the other hand SQLite is still a single file and zero-config.',
      },
    ],
    risks: [
      {
        id: 'RISK1',
        description: 'Disk space exhaustion from accumulated backup versions',
        severity: 'MEDIUM',
        likelihood: 'HIGH',
        mitigation: 'backuptool prune --keep-last N command. Warning when store exceeds 80% of available disk. Auto-prune option in config.',
      },
      {
        id: 'RISK2',
        description: 'Restore to wrong directory overwrites production data',
        severity: 'HIGH',
        likelihood: 'LOW',
        mitigation: 'Dry-run mode (--dry-run) shows what would be restored. Confirmation prompt for restore to existing directory unless --force flag.',
      },
    ],
    acceptance_criteria: [
      'backuptool backup → restore roundtrip: SHA-256 checksums match for all files',
      'backuptool list → correct versions, timestamps, sizes',
      'backuptool diff → accurate added/removed/changed report',
      'backuptool prune --keep-last 3 → only 3 versions remain',
      'Cross-platform: CI green on Ubuntu and macOS',
    ],
  };
}

function makeC2Roadmap() {
  return {
    milestones: [
      {
        id: 'ms-1',
        title: 'Core Backup Engine',
        sequence: 1,
        description: 'tar+gzip archive creation with temp file + atomic rename. SHA-256 checksum computation. SQLite metadata storage.',
        dependencies: [],
        estimated_loc: 350,
        estimated_files: 4,
        estimated_complexity: 'MEDIUM',
        goals_addressed: ['G1'],
        requirements_addressed: ['R1'],
        acceptance_criteria: [
          'createBackup(dir) → .tar.gz in store + metadata row',
          'checksum verification on created archive',
          'Atomic write (no partial archives)',
        ],
        test_strategy: {
          type: 'integration',
          description: 'Backup creation + verification with known test directory',
          expected_test_count: 6,
        },
      },
      {
        id: 'ms-2',
        title: 'CLI Interface + List/Diff',
        sequence: 2,
        description: 'Commander-based CLI with backup, list, diff, restore, prune subcommands. Table-formatted output for list. Tree-diff output for diff.',
        dependencies: ['ms-1'],
        estimated_loc: 300,
        estimated_files: 3,
        estimated_complexity: 'LOW',
        goals_addressed: ['G2'],
        requirements_addressed: ['R2', 'R4'],
        acceptance_criteria: [
          'backuptool list → formatted table output',
          'backuptool diff v1 v2 → added/removed/changed',
          'backuptool --help → usage info',
        ],
        test_strategy: {
          type: 'unit+integration',
          description: 'CLI parsing unit tests + output format integration tests',
          expected_test_count: 8,
        },
      },
      {
        id: 'ms-3',
        title: 'Restore Engine + Prune',
        sequence: 3,
        description: 'Archive extraction with optional target directory. Checksum verification after restore. Prune command with --keep-last N.',
        dependencies: ['ms-1'],
        estimated_loc: 250,
        estimated_files: 3,
        estimated_complexity: 'MEDIUM',
        goals_addressed: ['G3'],
        requirements_addressed: ['R3', 'R5'],
        acceptance_criteria: [
          'restore v1 → files match original checksums',
          'restore v1 --to /tmp/x → restores to custom path',
          'prune --keep-last 3 → deletes old + updates metadata',
          'Dry-run mode shows actions without executing',
        ],
        test_strategy: {
          type: 'integration',
          description: 'Roundtrip backup→restore with checksum verification',
          expected_test_count: 10,
        },
      },
    ],
    requirements_coverage: {
      covered: ['R1', 'R2', 'R3', 'R4', 'R5'],
      uncovered: [],
    },
  };
}

// ═══════════════════════════════════════════════════════════════════════════════
// C3: Web App with Changing Scope — Training Planner
// ═══════════════════════════════════════════════════════════════════════════════

function makeC3Spec() {
  return {
    title: 'Webová aplikace pro plánování tréninků s profily, PDF exportem a mobilní optimalizací',
    goals: [
      {
        id: 'G1',
        description: 'User profiles with training history and progress tracking',
        priority: 'MUST',
        success_criteria: 'User registers, logs workouts for 7 days → dashboard shows weekly volume chart, personal records, streak counter. Verified with Cypress e2e test.',
      },
      {
        id: 'G2',
        description: 'Training plan creation with exercise library',
        priority: 'MUST',
        success_criteria: 'User creates plan "Push/Pull/Legs" with 3 days, each with 4-6 exercises from library. Plan persists across sessions. Verified: create plan → logout → login → plan visible.',
      },
      {
        id: 'G3',
        description: 'Export training plan and history to PDF',
        priority: 'SHOULD',
        success_criteria: 'GET /api/export/pdf?plan_id=X → downloadable PDF with exercises, sets, reps. PDF passes pdftotext extraction check (text readable).',
      },
      {
        id: 'G4',
        description: 'Mobile-first responsive design',
        priority: 'MUST',
        success_criteria: 'Lighthouse mobile score ≥ 90. Touch-friendly buttons (min 44px tap target). Works on viewport 320px–1440px.',
      },
    ],
    requirements: {
      functional: [
        {
          id: 'R1',
          description: 'User registration + login with email/password',
          goal_id: 'G1',
          acceptance_test: 'POST /auth/register { email, password, name } → 201. POST /auth/login → JWT. Duplicate email → 409 Conflict.',
        },
        {
          id: 'R2',
          description: 'Training plan CRUD with exercise templates',
          goal_id: 'G2',
          acceptance_test: 'POST /api/plans { name, days: [{ exercises: [...] }] } → 201. GET /api/plans → list. PUT → update. DELETE → 204.',
        },
        {
          id: 'R3',
          description: 'Workout logging with sets, reps, weight',
          goal_id: 'G1',
          acceptance_test: 'POST /api/workouts { plan_id, day, exercises: [{ id, sets: [{ reps: 10, weight: 60 }] }] } → 201. GET /api/workouts?since=2026-02-01 → list.',
        },
        {
          id: 'R4',
          description: 'Dashboard with progress charts and personal records',
          goal_id: 'G1',
          acceptance_test: 'GET /api/dashboard → { weekly_volume: [...], personal_records: [...], streak: 7 }. Chart data matches logged workouts.',
        },
        {
          id: 'R5',
          description: 'PDF export of training plan with formatting',
          goal_id: 'G3',
          acceptance_test: 'GET /api/export/pdf?plan_id=1 → Content-Type: application/pdf, file opens in viewer, contains plan name and exercises.',
        },
      ],
      non_functional: [
        {
          id: 'NF1',
          category: 'performance',
          description: 'Page load time',
          metric: 'First Contentful Paint < 1.5s on 3G network (Lighthouse throttled). Bundle size < 200KB gzipped.',
        },
        {
          id: 'NF2',
          category: 'accessibility',
          description: 'WCAG 2.1 AA compliance',
          metric: 'axe-core audit: 0 violations. Keyboard navigation works for all interactive elements.',
        },
        {
          id: 'NF3',
          category: 'responsiveness',
          description: 'Mobile-first design system',
          metric: 'Visual regression tests pass at 320px, 768px, 1024px, 1440px. No horizontal scroll at any breakpoint.',
        },
      ],
    },
    tech_stack: {
      languages: ['TypeScript 5.4'],
      frameworks: ['Next.js 15', 'Prisma 6', 'Tailwind CSS 4'],
      tools: ['PostgreSQL 16', 'puppeteer (PDF generation)', 'chart.js'],
      rationale: 'Next.js for SSR + API routes in one framework. Tailwind for utility-first responsive design. Prisma for type-safe DB. puppeteer for server-side PDF rendering.',
    },
    design_decisions: [
      {
        id: 'DD1',
        decision: 'PDF generation strategy',
        chosen: 'Server-side puppeteer rendering of HTML template',
        alternatives_considered: ['pdfkit (programmatic PDF)', 'react-pdf (React components)', 'wkhtmltopdf'],
        rationale: 'Puppeteer renders actual HTML/CSS → pixel-perfect output matching web design. pdfkit requires manual layout code (fragile). react-pdf is limited in styling. wkhtmltopdf is deprecated — however puppeteer has higher memory overhead (headless Chrome) which is acceptable for batch export (not real-time).',
      },
      {
        id: 'DD2',
        decision: 'State management for workout logging',
        chosen: 'React Server Components + server actions for mutations',
        alternatives_considered: ['Client-side SPA with React Query', 'Redux with optimistic updates'],
        rationale: 'RSC reduces client bundle size (no state library shipped). Server actions simplify mutations (no API route boilerplate). Redux would add complexity for what is primarily a CRUD app — on the other hand, RSC limits real-time interactivity which is acceptable for workout logging.',
      },
    ],
    risks: [
      {
        id: 'RISK1',
        description: 'Puppeteer memory usage spikes during concurrent PDF exports',
        severity: 'MEDIUM',
        likelihood: 'MEDIUM',
        mitigation: 'Queue PDF generation with concurrency limit (max 3 concurrent). Reuse browser instance across requests. 30s timeout per PDF.',
      },
      {
        id: 'RISK2',
        description: 'Mobile performance degradation with large workout history',
        severity: 'MEDIUM',
        likelihood: 'MEDIUM',
        mitigation: 'Paginate workout history (20 per page). Virtual scrolling for exercise library. Lazy load chart data.',
      },
      {
        id: 'RISK3',
        description: 'Offline usage not supported — data loss if network drops during workout',
        severity: 'LOW',
        likelihood: 'HIGH',
        mitigation: 'LocalStorage fallback for in-progress workout. Sync to server on reconnect. Visual indicator for offline mode.',
      },
    ],
    acceptance_criteria: [
      'User can register, create plan, log workouts, see dashboard — full flow in Cypress',
      'PDF export produces valid, readable PDF with correct content',
      'Lighthouse mobile ≥ 90 on dashboard page',
      'All breakpoints (320px–1440px) render without horizontal scroll',
    ],
  };
}

function makeC3Roadmap() {
  return {
    milestones: [
      {
        id: 'ms-1',
        title: 'Auth + User Profiles',
        sequence: 1,
        description: 'User registration, login, JWT auth. Profile page with basic info. Prisma schema for users, plans, workouts.',
        dependencies: [],
        estimated_loc: 500,
        estimated_files: 8,
        estimated_complexity: 'MEDIUM',
        goals_addressed: ['G1'],
        requirements_addressed: ['R1'],
        acceptance_criteria: [
          'Register → login → profile page shows user info',
          'JWT stored in httpOnly cookie',
          'Prisma migrations create all tables',
        ],
        test_strategy: {
          type: 'integration',
          description: 'Auth flow integration tests with supertest',
          expected_test_count: 8,
        },
      },
      {
        id: 'ms-2',
        title: 'Training Plans + Exercise Library',
        sequence: 2,
        description: 'Plan CRUD, exercise template library (50+ seeded), drag-and-drop exercise ordering, plan preview.',
        dependencies: ['ms-1'],
        estimated_loc: 700,
        estimated_files: 10,
        estimated_complexity: 'MEDIUM',
        goals_addressed: ['G2'],
        requirements_addressed: ['R2'],
        acceptance_criteria: [
          'Create plan with 3 days, 5 exercises each',
          'Exercise library searchable by muscle group',
          'Drag-and-drop reordering persists',
        ],
        test_strategy: {
          type: 'integration+e2e',
          description: 'API tests + Cypress plan creation flow',
          expected_test_count: 12,
        },
      },
      {
        id: 'ms-3',
        title: 'Workout Logging + Dashboard',
        sequence: 3,
        description: 'Workout log form with sets/reps/weight inputs. Dashboard with weekly volume chart, personal records, streak tracker.',
        dependencies: ['ms-2'],
        estimated_loc: 800,
        estimated_files: 8,
        estimated_complexity: 'HIGH',
        goals_addressed: ['G1'],
        requirements_addressed: ['R3', 'R4'],
        acceptance_criteria: [
          'Log workout with 4 exercises, 3 sets each',
          'Dashboard shows correct weekly volume',
          'Personal records update after new max',
          'Streak counter accurate',
        ],
        test_strategy: {
          type: 'integration+e2e',
          description: 'API tests for data accuracy + Cypress dashboard verification',
          expected_test_count: 15,
        },
      },
      {
        id: 'ms-4',
        title: 'PDF Export + Mobile Polish',
        sequence: 4,
        description: 'Puppeteer-based PDF export. Responsive breakpoints. Touch-friendly UI. Lighthouse optimization.',
        dependencies: ['ms-3'],
        estimated_loc: 400,
        estimated_files: 5,
        estimated_complexity: 'MEDIUM',
        goals_addressed: ['G3', 'G4'],
        requirements_addressed: ['R5'],
        acceptance_criteria: [
          'PDF export contains plan name, exercises, sets',
          'Lighthouse mobile ≥ 90',
          'All breakpoints render correctly',
          'Touch targets ≥ 44px',
        ],
        test_strategy: {
          type: 'integration+visual',
          description: 'PDF content verification + Playwright visual regression at 4 breakpoints',
          expected_test_count: 10,
        },
      },
    ],
    requirements_coverage: {
      covered: ['R1', 'R2', 'R3', 'R4', 'R5'],
      uncovered: [],
    },
  };
}

// C3 change requests — 3 scope changes during build
function makeC3Change1_PaymentGateway() {
  return {
    affected_milestones: ['ms-4'],
    impact: {
      milestones_to_add: [
        {
          title: 'Payment Gateway Integration',
          estimated_loc: 600,
          description: 'Stripe integration for premium plans. Webhook handling. Subscription management.',
        },
      ],
      milestones_to_remove: [],
      milestones_to_modify: [
        {
          id: 'ms-1',
          changes: 'Add subscription_tier to user model. Add billing_info table.',
        },
      ],
      effort_delta: '+1 milestone (~600 LOC), +1 DB migration, Stripe test mode setup',
      risk_level: 'MEDIUM',
    },
    feasibility: 'FEASIBLE',
    recommendation: 'Approve — monetization is critical for sustainability. Stripe has excellent docs and test mode. New milestone ms-5 after ms-4, modifying ms-1 schema is backward compatible.',
    preserved_milestones: ['ms-1', 'ms-2', 'ms-3'],
  };
}

function makeC3Change2_TeamPlanning() {
  return {
    affected_milestones: ['ms-2', 'ms-3'],
    impact: {
      milestones_to_add: [
        {
          title: 'Team Management + Shared Plans',
          estimated_loc: 500,
          description: 'Team creation, invite flow, shared training plans with role-based access (coach/athlete).',
        },
      ],
      milestones_to_remove: [],
      milestones_to_modify: [
        {
          id: 'ms-2',
          changes: 'Plans get owner_id + team_id. Plan visibility: private/team/public.',
        },
        {
          id: 'ms-3',
          changes: 'Dashboard shows team aggregate stats alongside personal stats.',
        },
      ],
      effort_delta: '+1 milestone (~500 LOC), 2 milestone modifications, new DB tables (teams, team_members)',
      risk_level: 'MEDIUM',
    },
    feasibility: 'FEASIBLE',
    recommendation: 'Approve — team planning is a key differentiator. Modifications to ms-2 and ms-3 are additive (new columns, not restructuring). ms-6 handles team-specific logic separately.',
    preserved_milestones: ['ms-1', 'ms-2', 'ms-3', 'ms-4'],
  };
}

function makeC3Change3_OfflineMode() {
  return {
    affected_milestones: ['ms-3', 'ms-4'],
    impact: {
      milestones_to_add: [
        {
          title: 'Service Worker + Offline Sync',
          estimated_loc: 700,
          description: 'PWA service worker with cache-first strategy. IndexedDB for offline workout logging. Background sync on reconnect. Conflict resolution (last-write-wins).',
        },
      ],
      milestones_to_remove: [],
      milestones_to_modify: [
        {
          id: 'ms-3',
          changes: 'Workout form saves to IndexedDB first, then syncs. Offline indicator in UI.',
        },
        {
          id: 'ms-4',
          changes: 'Add PWA manifest. Cache static assets. Lighthouse PWA audit.',
        },
      ],
      effort_delta: '+1 milestone (~700 LOC), 2 milestone modifications, IndexedDB schema, service worker',
      risk_level: 'HIGH',
    },
    feasibility: 'CHALLENGING',
    recommendation: 'Approve with caveat — offline mode adds significant complexity (sync, conflicts, IndexedDB). Recommend last-write-wins for MVP conflict resolution. Defer advanced merge to post-launch. Risk: service worker caching can cause stale UI bugs.',
    preserved_milestones: ['ms-1', 'ms-2', 'ms-3', 'ms-4', 'ms-5', 'ms-6'],
  };
}

// ═══════════════════════════════════════════════════════════════════════════════
// Test Runner
// ═══════════════════════════════════════════════════════════════════════════════

async function run() {
  console.log('═'.repeat(70));
  console.log('  PILOT C1-C2-C3 — Quality Score Distribution Test');
  console.log('═'.repeat(70));

  cleanDB();
  setupLifecycle(LC_C1, 'pilot-c1-backend', 'Multi-tenant REST API');
  setupLifecycle(LC_C2, 'pilot-c2-cli', 'Backup CLI Tool');
  setupLifecycle(LC_C3, 'pilot-c3-webapp', 'Training Planner Web App');

  // ═══════════════════════════════════════════════════════════════════════════
  // C1: Backend System — Spec + Roadmap
  // ═══════════════════════════════════════════════════════════════════════════
  console.log('\n' + '═'.repeat(70));
  console.log('  C1: Backend System — Multi-tenant REST API');
  console.log('═'.repeat(70));

  const c1Spec = makeC1Spec();
  const c1SpecResult = computeSpecScore(c1Spec);
  console.log(`\n  C1 spec_score: ${c1SpecResult.score} (${c1SpecResult.label})`);
  console.log(`    decision_depth:    ${c1SpecResult.breakdown.decision_depth}`);
  console.log(`    measurability:     ${c1SpecResult.breakdown.measurability}`);
  console.log(`    coverage_quality:  ${c1SpecResult.breakdown.coverage_quality}`);
  console.log(`    specificity:       ${c1SpecResult.breakdown.specificity}`);
  console.log(`    risk_quality:      ${c1SpecResult.breakdown.risk_quality}`);

  check(c1SpecResult.score >= 0.70,
    'C1.1: spec_score ≥ 0.70 (architectural depth)',
    `got ${c1SpecResult.score}`);
  check(c1SpecResult.breakdown.decision_depth >= 0.70,
    'C1.2: decision_depth ≥ 0.70 (3 decisions with 3+ alternatives)',
    `got ${c1SpecResult.breakdown.decision_depth}`);
  check(c1SpecResult.breakdown.risk_quality >= 0.65,
    'C1.3: risk_quality ≥ 0.65 (CRITICAL+HIGH risks with mitigations)',
    `got ${c1SpecResult.breakdown.risk_quality}`);

  // Log via telemetry
  const c1SpecTelemetry = logSpecScore(LC_C1, c1Spec, 1);
  check(c1SpecTelemetry !== null, 'C1.4: telemetry logged spec score');

  const c1Roadmap = makeC1Roadmap();
  const c1RoadmapResult = computeRoadmapScore(c1Roadmap);
  console.log(`\n  C1 roadmap_score: ${c1RoadmapResult.score} (${c1RoadmapResult.label})`);
  console.log(`    milestone_completeness: ${c1RoadmapResult.breakdown.milestone_completeness}`);
  console.log(`    dependency_coherence:   ${c1RoadmapResult.breakdown.dependency_coherence}`);
  console.log(`    requirement_coverage:   ${c1RoadmapResult.breakdown.requirement_coverage}`);
  console.log(`    sizing_realism:         ${c1RoadmapResult.breakdown.sizing_realism}`);

  check(c1RoadmapResult.score >= 0.70,
    'C1.5: roadmap_score ≥ 0.70',
    `got ${c1RoadmapResult.score}`);

  const c1RoadmapTelemetry = logRoadmapScore(LC_C1, c1Roadmap, 1);
  check(c1RoadmapTelemetry !== null, 'C1.6: telemetry logged roadmap score');

  // Lifecycle score
  const c1Lifecycle = logLifecycleScore(LC_C1);
  check(c1Lifecycle !== null, 'C1.7: lifecycle score computed');
  console.log(`\n  C1 lifecycle_score: ${c1Lifecycle?.score} (${c1Lifecycle?.label})`);

  // ═══════════════════════════════════════════════════════════════════════════
  // C2: CLI Tool — Spec + Roadmap
  // ═══════════════════════════════════════════════════════════════════════════
  console.log('\n' + '═'.repeat(70));
  console.log('  C2: CLI Tool — Backup with Versioning');
  console.log('═'.repeat(70));

  const c2Spec = makeC2Spec();
  const c2SpecResult = computeSpecScore(c2Spec);
  console.log(`\n  C2 spec_score: ${c2SpecResult.score} (${c2SpecResult.label})`);
  console.log(`    decision_depth:    ${c2SpecResult.breakdown.decision_depth}`);
  console.log(`    measurability:     ${c2SpecResult.breakdown.measurability}`);
  console.log(`    coverage_quality:  ${c2SpecResult.breakdown.coverage_quality}`);
  console.log(`    specificity:       ${c2SpecResult.breakdown.specificity}`);
  console.log(`    risk_quality:      ${c2SpecResult.breakdown.risk_quality}`);

  check(c2SpecResult.score >= 0.60,
    'C2.1: spec_score ≥ 0.60 (low ceremony CLI)',
    `got ${c2SpecResult.score}`);

  // CLI should not be penalized for lower ceremony
  check(c2SpecResult.label !== 'WEAK',
    'C2.2: CLI spec is not WEAK (friction sensitivity check)',
    `got ${c2SpecResult.label}`);

  const c2SpecTelemetry = logSpecScore(LC_C2, c2Spec, 1);
  check(c2SpecTelemetry !== null, 'C2.3: telemetry logged spec score');

  const c2Roadmap = makeC2Roadmap();
  const c2RoadmapResult = computeRoadmapScore(c2Roadmap);
  console.log(`\n  C2 roadmap_score: ${c2RoadmapResult.score} (${c2RoadmapResult.label})`);
  console.log(`    milestone_completeness: ${c2RoadmapResult.breakdown.milestone_completeness}`);
  console.log(`    dependency_coherence:   ${c2RoadmapResult.breakdown.dependency_coherence}`);
  console.log(`    requirement_coverage:   ${c2RoadmapResult.breakdown.requirement_coverage}`);
  console.log(`    sizing_realism:         ${c2RoadmapResult.breakdown.sizing_realism}`);

  check(c2RoadmapResult.score >= 0.65,
    'C2.4: roadmap_score ≥ 0.65',
    `got ${c2RoadmapResult.score}`);

  const c2RoadmapTelemetry = logRoadmapScore(LC_C2, c2Roadmap, 1);
  check(c2RoadmapTelemetry !== null, 'C2.5: telemetry logged roadmap score');

  const c2Lifecycle = logLifecycleScore(LC_C2);
  check(c2Lifecycle !== null, 'C2.6: lifecycle score computed');
  console.log(`\n  C2 lifecycle_score: ${c2Lifecycle?.score} (${c2Lifecycle?.label})`);

  // ═══════════════════════════════════════════════════════════════════════════
  // C3: Web App — Spec + Roadmap + 3 Change Requests
  // ═══════════════════════════════════════════════════════════════════════════
  console.log('\n' + '═'.repeat(70));
  console.log('  C3: Web App — Training Planner + 3 Scope Changes');
  console.log('═'.repeat(70));

  const c3Spec = makeC3Spec();
  const c3SpecResult = computeSpecScore(c3Spec);
  console.log(`\n  C3 spec_score: ${c3SpecResult.score} (${c3SpecResult.label})`);
  console.log(`    decision_depth:    ${c3SpecResult.breakdown.decision_depth}`);
  console.log(`    measurability:     ${c3SpecResult.breakdown.measurability}`);
  console.log(`    coverage_quality:  ${c3SpecResult.breakdown.coverage_quality}`);
  console.log(`    specificity:       ${c3SpecResult.breakdown.specificity}`);
  console.log(`    risk_quality:      ${c3SpecResult.breakdown.risk_quality}`);

  check(inRange(c3SpecResult.score, 0.65, 0.90),
    'C3.1: spec_score in expected range (0.65–0.90)',
    `got ${c3SpecResult.score}`);

  const c3SpecTelemetry = logSpecScore(LC_C3, c3Spec, 1);
  check(c3SpecTelemetry !== null, 'C3.2: telemetry logged spec score');

  const c3Roadmap = makeC3Roadmap();
  const c3RoadmapResult = computeRoadmapScore(c3Roadmap);
  console.log(`\n  C3 roadmap_score: ${c3RoadmapResult.score} (${c3RoadmapResult.label})`);
  console.log(`    milestone_completeness: ${c3RoadmapResult.breakdown.milestone_completeness}`);
  console.log(`    dependency_coherence:   ${c3RoadmapResult.breakdown.dependency_coherence}`);
  console.log(`    requirement_coverage:   ${c3RoadmapResult.breakdown.requirement_coverage}`);
  console.log(`    sizing_realism:         ${c3RoadmapResult.breakdown.sizing_realism}`);

  check(c3RoadmapResult.score >= 0.65,
    'C3.3: roadmap_score ≥ 0.65',
    `got ${c3RoadmapResult.score}`);

  const c3RoadmapTelemetry = logRoadmapScore(LC_C3, c3Roadmap, 1);
  check(c3RoadmapTelemetry !== null, 'C3.4: telemetry logged roadmap score');

  // ─── Change 1: Payment Gateway ───────────────────────────────────────────
  console.log('\n  ─── Change 1: "Přidej platební bránu" ───');
  const change1 = makeC3Change1_PaymentGateway();
  const change1Result = computeChangeScore(change1);
  console.log(`  change1_score: ${change1Result.score} (${change1Result.label})`);
  console.log(`    impact_clarity:     ${change1Result.breakdown.impact_clarity}`);
  console.log(`    risk_articulation:  ${change1Result.breakdown.risk_articulation}`);
  console.log(`    delta_complexity:   ${change1Result.breakdown.delta_complexity}`);
  console.log(`    preservation:       ${change1Result.breakdown.preservation}`);

  check(change1Result.score >= 0.65,
    'C3.5: change1 (payment) score ≥ 0.65',
    `got ${change1Result.score}`);
  check(change1Result.breakdown.preservation >= 0.60,
    'C3.6: change1 preservation ≥ 0.60 (3 milestones preserved)',
    `got ${change1Result.breakdown.preservation}`);

  logChangeScore(LC_C3, change1, 'cr-payment-001');
  logLifecycleScore(LC_C3);

  // ─── Change 2: Team Planning ─────────────────────────────────────────────
  console.log('\n  ─── Change 2: "Chci i týmové plánování" ───');
  const change2 = makeC3Change2_TeamPlanning();
  const change2Result = computeChangeScore(change2);
  console.log(`  change2_score: ${change2Result.score} (${change2Result.label})`);
  console.log(`    impact_clarity:     ${change2Result.breakdown.impact_clarity}`);
  console.log(`    risk_articulation:  ${change2Result.breakdown.risk_articulation}`);
  console.log(`    delta_complexity:   ${change2Result.breakdown.delta_complexity}`);
  console.log(`    preservation:       ${change2Result.breakdown.preservation}`);

  check(change2Result.score >= 0.65,
    'C3.7: change2 (team) score ≥ 0.65',
    `got ${change2Result.score}`);
  check(change2Result.breakdown.preservation >= 0.60,
    'C3.8: change2 preservation ≥ 0.60 (4 milestones preserved)',
    `got ${change2Result.breakdown.preservation}`);

  logChangeScore(LC_C3, change2, 'cr-team-002');
  logLifecycleScore(LC_C3);

  // ─── Change 3: Offline Mode ──────────────────────────────────────────────
  console.log('\n  ─── Change 3: "Musí běžet offline" ───');
  const change3 = makeC3Change3_OfflineMode();
  const change3Result = computeChangeScore(change3);
  console.log(`  change3_score: ${change3Result.score} (${change3Result.label})`);
  console.log(`    impact_clarity:     ${change3Result.breakdown.impact_clarity}`);
  console.log(`    risk_articulation:  ${change3Result.breakdown.risk_articulation}`);
  console.log(`    delta_complexity:   ${change3Result.breakdown.delta_complexity}`);
  console.log(`    preservation:       ${change3Result.breakdown.preservation}`);

  check(change3Result.score >= 0.65,
    'C3.9: change3 (offline) score ≥ 0.65',
    `got ${change3Result.score}`);
  check(change3Result.breakdown.preservation >= 0.60,
    'C3.10: change3 preservation ≥ 0.60 (6 milestones preserved)',
    `got ${change3Result.breakdown.preservation}`);

  logChangeScore(LC_C3, change3, 'cr-offline-003');

  // Final lifecycle score for C3 (after all changes)
  const c3FinalLifecycle = logLifecycleScore(LC_C3);
  check(c3FinalLifecycle !== null, 'C3.11: final lifecycle score computed');
  console.log(`\n  C3 final lifecycle_score: ${c3FinalLifecycle?.score} (${c3FinalLifecycle?.label})`);

  // ═══════════════════════════════════════════════════════════════════════════
  // Cross-project Analytics
  // ═══════════════════════════════════════════════════════════════════════════
  console.log('\n' + '═'.repeat(70));
  console.log('  Cross-project Analytics');
  console.log('═'.repeat(70));

  // ─── Summary ──────────────────────────────────────────────────────────────
  const summary = getSummary();
  console.log(`\n  Summary: ${summary.projects_analyzed} projects, mean=${summary.mean}, median=${summary.median}, stddev=${summary.stddev}`);
  console.log(`  Distribution: EXCELLENT=${summary.distribution.EXCELLENT} GOOD=${summary.distribution.GOOD} ACCEPTABLE=${summary.distribution.ACCEPTABLE} WEAK=${summary.distribution.WEAK}`);

  check(summary.projects_analyzed >= 3,
    'A1: ≥3 projects in summary',
    `got ${summary.projects_analyzed}`);
  check(summary.mean > 0 && summary.mean < 1,
    'A2: mean is valid (0, 1)',
    `got ${summary.mean}`);
  check(summary.stddev > 0,
    'A3: stddev > 0 (scores differ across pilots)',
    `got ${summary.stddev}`);

  // ─── Per-type breakdown ───────────────────────────────────────────────────
  if (summary.per_type.spec) {
    console.log(`\n  Per-type spec:    mean=${summary.per_type.spec.mean} (n=${summary.per_type.spec.count})`);
  }
  if (summary.per_type.roadmap) {
    console.log(`  Per-type roadmap: mean=${summary.per_type.roadmap.mean} (n=${summary.per_type.roadmap.count})`);
  }
  if (summary.per_type.change) {
    console.log(`  Per-type change:  mean=${summary.per_type.change.mean} (n=${summary.per_type.change.count})`);
  }

  check(summary.per_type.spec !== undefined, 'A4: per_type has spec stats');
  check(summary.per_type.roadmap !== undefined, 'A5: per_type has roadmap stats');
  check(summary.per_type.change !== undefined, 'A6: per_type has change stats');

  // ─── Distribution ─────────────────────────────────────────────────────────
  const dist = getDistribution();
  console.log(`\n  Distribution: total=${dist.total}`);
  for (const [label, pct] of Object.entries(dist.percentages)) {
    console.log(`    ${label}: ${dist.buckets[label]} (${pct}%)`);
  }

  check(dist.total >= 9,
    'A7: distribution has ≥9 scores (3 specs + 3 roadmaps + 3 changes)',
    `got ${dist.total}`);

  // Not all WEAK — engine is not overly harsh
  check(dist.buckets.WEAK < dist.total,
    'A8: not all scores are WEAK',
    `WEAK=${dist.buckets.WEAK}/${dist.total}`);

  // Not all EXCELLENT — engine discriminates
  check(dist.buckets.EXCELLENT < dist.total,
    'A9: not all scores are EXCELLENT (engine discriminates)',
    `EXCELLENT=${dist.buckets.EXCELLENT}/${dist.total}`);

  // ─── C1 vs C2 comparison ─────────────────────────────────────────────────
  console.log('\n  ─── C1 (backend) vs C2 (CLI) comparison ───');
  const c1Report = getProjectReport(LC_C1);
  const c2Report = getProjectReport(LC_C2);

  const c1SpecScore = c1Report.latest?.spec?.score ?? 0;
  const c2SpecScore = c2Report.latest?.spec?.score ?? 0;

  console.log(`  C1 spec: ${c1SpecScore}, C2 spec: ${c2SpecScore}`);

  // C1 (deeper architecture) should score ≥ C2 on spec (more decisions, more risks)
  // But this is observation, not hard requirement — just log the delta
  const specDelta = c1SpecScore - c2SpecScore;
  console.log(`  Delta (C1-C2): ${specDelta > 0 ? '+' : ''}${specDelta.toFixed(4)}`);

  check(typeof specDelta === 'number',
    'A10: C1 vs C2 comparison computed',
    `delta=${specDelta.toFixed(4)}`);

  // ─── Volatility ───────────────────────────────────────────────────────────
  console.log('\n  ─── Volatility Index ───');
  const c1Vol = getVolatilityIndex(LC_C1);
  const c2Vol = getVolatilityIndex(LC_C2);
  const c3Vol = getVolatilityIndex(LC_C3);

  console.log(`  C1 volatility: ${c1Vol}`);
  console.log(`  C2 volatility: ${c2Vol}`);
  console.log(`  C3 volatility: ${c3Vol}`);

  // C3 has 3 change requests + multiple lifecycle scores → should have highest volatility
  check(c3Vol >= c1Vol,
    'A11: C3 volatility ≥ C1 (more changes = more volatility)',
    `C3=${c3Vol}, C1=${c1Vol}`);
  check(c3Vol >= c2Vol,
    'A12: C3 volatility ≥ C2',
    `C3=${c3Vol}, C2=${c2Vol}`);

  // ─── C3 Project Report (change management detail) ─────────────────────────
  console.log('\n  ─── C3 Project Report ───');
  const c3Report = getProjectReport(LC_C3);

  check(c3Report.latest.change !== undefined,
    'A13: C3 has latest change score');
  check(c3Report.history.length >= 7,
    'A14: C3 history has ≥7 entries (spec + roadmap + 3 changes + lifecycle scores)',
    `got ${c3Report.history.length}`);
  check(c3Report.trend.change !== undefined && c3Report.trend.change.length >= 3,
    'A15: C3 has ≥3 change trend entries',
    `got ${c3Report.trend.change?.length ?? 0}`);

  // ─── Change Scores Stability ──────────────────────────────────────────────
  console.log('\n  ─── Change Score Stability ───');
  const changeTrend = c3Report.trend.change || [];
  if (changeTrend.length >= 3) {
    console.log(`  Change 1: ${changeTrend[0].score}`);
    console.log(`  Change 2: ${changeTrend[1].score}`);
    console.log(`  Change 3: ${changeTrend[2].score}`);

    // All changes should score reasonably (none catastrophically low)
    for (let i = 0; i < 3; i++) {
      check(changeTrend[i].score >= 0.50,
        `A16.${i + 1}: change ${i + 1} score ≥ 0.50 (not catastrophic)`,
        `got ${changeTrend[i].score}`);
    }
  }

  // ─── Text Report ──────────────────────────────────────────────────────────
  console.log('\n  ─── Text Report Preview ───');
  const textReport = generateTextReport({ sinceDays: 1 });
  console.log(textReport);

  check(textReport.includes('C3 Quality Score Report'),
    'A19: text report has header');
  check(textReport.includes('EXCELLENT') || textReport.includes('GOOD') || textReport.includes('ACCEPTABLE'),
    'A20: text report has distribution labels');

  // ═══════════════════════════════════════════════════════════════════════════
  // Pilot Data Summary (for human analysis)
  // ═══════════════════════════════════════════════════════════════════════════
  console.log('\n' + '═'.repeat(70));
  console.log('  PILOT DATA SUMMARY');
  console.log('═'.repeat(70));

  console.log('\n  ┌─────────────────────────┬──────────┬──────────┬──────────┐');
  console.log('  │ Metric                  │ C1 (API) │ C2 (CLI) │ C3 (Web) │');
  console.log('  ├─────────────────────────┼──────────┼──────────┼──────────┤');
  console.log(`  │ spec_score              │ ${pad(c1SpecResult.score)} │ ${pad(c2SpecResult.score)} │ ${pad(c3SpecResult.score)} │`);
  console.log(`  │ roadmap_score           │ ${pad(c1RoadmapResult.score)} │ ${pad(c2RoadmapResult.score)} │ ${pad(c3RoadmapResult.score)} │`);
  console.log(`  │ change_score (avg)      │    —     │    —     │ ${pad(avgScore([change1Result.score, change2Result.score, change3Result.score]))} │`);
  console.log(`  │ lifecycle_score          │ ${pad(c1Lifecycle?.score)} │ ${pad(c2Lifecycle?.score)} │ ${pad(c3FinalLifecycle?.score)} │`);
  console.log(`  │ volatility              │ ${pad(c1Vol)}   │ ${pad(c2Vol)}   │ ${pad(c3Vol)}   │`);
  console.log(`  │ milestone_count          │    5     │    3     │    4+3   │`);
  console.log(`  │ change_count             │    0     │    0     │    3     │`);
  console.log('  └─────────────────────────┴──────────┴──────────┴──────────┘');

  console.log('\n  Labels:');
  console.log(`    C1: spec=${c1SpecResult.label} roadmap=${c1RoadmapResult.label} lifecycle=${c1Lifecycle?.label}`);
  console.log(`    C2: spec=${c2SpecResult.label} roadmap=${c2RoadmapResult.label} lifecycle=${c2Lifecycle?.label}`);
  console.log(`    C3: spec=${c3SpecResult.label} roadmap=${c3RoadmapResult.label} changes=${change1Result.label}/${change2Result.label}/${change3Result.label} lifecycle=${c3FinalLifecycle?.label}`);

  // ═══════════════════════════════════════════════════════════════════════════
  // Pilot Observations (diagnostic — not pass/fail)
  // ═══════════════════════════════════════════════════════════════════════════
  console.log('\n' + '═'.repeat(70));
  console.log('  PILOT OBSERVATIONS (diagnostic)');
  console.log('═'.repeat(70));

  // O1: Roadmap ceiling effect — all 3 roadmaps score 1.0
  const allRoadmapsPerfect = c1RoadmapResult.score === 1 && c2RoadmapResult.score === 1 && c3RoadmapResult.score === 1;
  if (allRoadmapsPerfect) {
    console.log('\n  ⚠ CEILING: All 3 roadmaps score 1.0 — scoring does not discriminate');
    console.log('    → roadmap_score is binary (well-formed=1, broken=0), not gradient');
    console.log('    → Consider: milestone quality heuristics, test coverage depth, dependency complexity');
  }

  // O2: Change score uniformity — all 3 changes score identically
  const changeScoresIdentical = change1Result.score === change2Result.score && change2Result.score === change3Result.score;
  if (changeScoresIdentical) {
    console.log(`\n  ⚠ UNIFORM: All 3 change scores identical (${change1Result.score})`);
    console.log('    → Change scoring does not differentiate FEASIBLE/MEDIUM vs CHALLENGING/HIGH');
    console.log('    → risk_level and feasibility have no impact on score');
  }

  // O3: Spec range compression
  const specRange = c1SpecResult.score - Math.min(c1SpecResult.score, c2SpecResult.score, c3SpecResult.score);
  console.log(`\n  📊 Spec score range: ${Math.min(c1SpecResult.score, c2SpecResult.score, c3SpecResult.score)}–${Math.max(c1SpecResult.score, c2SpecResult.score, c3SpecResult.score)} (spread: ${specRange.toFixed(2)})`);
  if (specRange < 0.10) {
    console.log('    ⚠ COMPRESSED: <0.10 spread across 3 very different projects');
    console.log('    → Backend API vs CLI vs Web app should show more variance');
  }

  // O4: Volatility always 0 — because scores don't vary within a project
  const allVolZero = c1Vol === 0 && c2Vol === 0 && c3Vol === 0;
  if (allVolZero) {
    console.log('\n  ⚠ FLAT: Volatility = 0 for all projects (including C3 with 3 changes)');
    console.log('    → Scores within each artifact_type are identical → no delta to measure');
    console.log('    → Volatility only becomes meaningful with spec v1→v2 revisions');
  }

  // O5: C1 vs C2 discrimination
  console.log(`\n  📊 C1 (backend) vs C2 (CLI) spec delta: ${(c1SpecResult.score - c2SpecResult.score).toFixed(2)}`);
  if (Math.abs(c1SpecResult.score - c2SpecResult.score) < 0.05) {
    console.log('    ⚠ Backend and CLI spec scores nearly identical');
    console.log('    → Engine rewards structural completeness, not architectural complexity');
  }

  // O6: per_type mean from report vs pilot actuals
  if (summary.per_type.spec) {
    console.log(`\n  📊 Report mean spec: ${summary.per_type.spec.mean} (includes non-pilot data from DB)`);
    console.log(`     Pilot-only mean spec: ${((c1SpecResult.score + c2SpecResult.score + c3SpecResult.score) / 3).toFixed(2)}`);
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // Cleanup + Results
  // ═══════════════════════════════════════════════════════════════════════════
  cleanDB();

  console.log('\n' + '═'.repeat(70));
  console.log(`  Pilot C1-C2-C3: ${passed} passed, ${failed} failed`);
  console.log('═'.repeat(70));

  if (failures.length > 0) {
    console.log('\n  Failures:');
    for (const f of failures) {
      console.log(`    ✗ ${f.name}${f.detail ? ` — ${f.detail}` : ''}`);
    }
  }

  process.exit(failed > 0 ? 1 : 0);
}

// ─── Helpers ────────────────────────────────────────────────────────────────

function pad(val) {
  if (val == null) return '   —   ';
  return String(val).padStart(6).padEnd(8);
}

function avgScore(scores) {
  const valid = scores.filter(s => s != null);
  if (valid.length === 0) return 0;
  return Math.round((valid.reduce((a, b) => a + b, 0) / valid.length) * 100) / 100;
}

run().catch(err => {
  console.error('FATAL:', err);
  process.exit(1);
});
