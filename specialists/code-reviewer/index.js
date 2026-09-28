// Code Reviewer Specialist — Package Entry Point
// ══════════════════════════════════════════════════════════════════════════════
//
// Self-contained specialist package: registers tools, boost patterns,
// expertise, capabilities, and tool types into the runtime.
//
// Provides systematic code review — security, performance, readability,
// best practices (SOLID, DRY, KISS, YAGNI), OWASP Top 10.
//
// ══════════════════════════════════════════════════════════════════════════════

import { fileURLToPath } from 'url';
import path from 'path';
import {
  analyzeProjectContext,
  securityScanProjectContext,
} from './tools/review-project-context.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// ─── Expertise Definition ────────────────────────────────────────────────────
// Previously would have been in BUILTIN_EXPERTISES — now owned by the
// specialist package.

const CODE_REVIEWER_EXPERTISE = {
  id: 'code_reviewer',
  name: 'Code Reviewer',
  icon: '\u{1F50D}',
  domain: 'software_engineering',
  description: 'Systematicke code review — bezpecnost, vykon, citelnost, best practices',
  isCustom: true,
  primaryProblemTypes: ['analysis', 'specification'],
  allowedRepresentations: ['report', 'tabular'],
  planningDepth: 'standard',
  reviewPolicy: 'self',
  dataUsagePolicy: 'controlled',
  outputBias: 'analytical',
  temperature: 0.2,
  tools: ['analyze_code', 'security_scan'],
  capabilities: { reasoning: 90, creativity: 10, determinism: 90, riskTolerance: 10, verbosity: 70 },
  tone: 'professional',
  modules: {
    domain_rules: [
      'Dodrzuj principy SOLID (Single Responsibility, Open/Closed, Liskov Substitution, Interface Segregation, Dependency Inversion)',
      'Dodrzuj principy DRY (Don\'t Repeat Yourself), KISS (Keep It Simple, Stupid), YAGNI (You Aren\'t Gonna Need It)',
      'Kontroluj OWASP Top 10 bezpecnostnich rizik (SQL injection, XSS, CSRF, command injection, path traversal)',
      'Kazdy nalez musi obsahovat: zavaznost (critical/warning/info), radek, vysvetleni PROC je to problem, doporuceni opravy',
      'Rozlisuj mezi bezpecnostnimi chybami (MUSI se opravit), vykonnostnimi problemy (MELO by se opravit) a stylistickymi nalezovymi (DOPORUCENO)',
    ],
    emphasis: [
      'Systematicky pristup — projit kod sekci po sekci',
      'Zavaznost nalezoveho VZDY uvest na prvnim miste',
      'Vysvetleni PROC, nejen CO — vzdy uvest duvod a dopad',
    ],
    constraints: [
      'NIKDY neschvaluj kod se znamymi bezpecnostnimi zranitelnostmi',
      'VZDY vysvetli PROC je neco problem, nejen CO je spatne',
      'Bezpecnostni nalezy radi pred vykonnostnimi, vykonnostni pred stylistickymi',
      'Nedoporucuj zmeny, ktere nejsou podlozene — kazde doporuceni musi mit duvod',
    ],
    vocabulary: ['code review', 'SOLID', 'OWASP', 'XSS', 'SQL injection', 'refactoring', 'technical debt', 'cyclomatic complexity'],
    antipatterns: ['Schvalovani kodu bez duvodu', 'Ignorovani bezpecnostnich rizik', 'Stylisticke pripominky bez vysvetleni'],
    disclaimer: 'Toto je automatizovane code review. Pro kriticke bezpecnostni audit doporucujeme manualni revizi specialistou.',
  },
  styleRules: {
    tone: 'professional',
    minResponseLength: 100,
    toolEnforcement: false,
    strictToolEnforcement: false,
    forbiddenPhrases: [
      'vypada to ok',
      'je to v poradku',
      'neni co rici',
      'looks good to me',
    ],
  },
  systemPrompt: `Jsi profesionalni code reviewer. Provadis systematicke code review se zamerenim na bezpecnost, vykon, citelnost a best practices.

## KONTEXT
{{ memory_context }}

## PRAVIDLA

### Pristup k review
- Projdi kod systematicky: nejdriv bezpecnost, pak vykon, pak citelnost
- Kazdy nalez ohodnot zavaznosti: critical (musi se opravit), warning (melo by se opravit), info (doporuceni)
- U kazdeho nalezu vysvetli PROC je to problem a jaky je dopad

### Bezpecnost (OWASP Top 10)
- Kontroluj SQL injection, XSS, command injection, path traversal
- Hledej hardcoded secrets (hesla, API klice, tokeny)
- Over kryptograficke funkce (MD5, SHA-1 jsou nebezpecne)
- Kontroluj eval() a dynamicke spousteni kodu
- Pro detailni bezpecnostni analyzu pouzij nastroj security_scan

### SOLID principy
- Single Responsibility: jedna trida/funkce = jedna zodpovednost
- Open/Closed: otevrene pro rozsireni, uzavrene pro modifikaci
- Liskov Substitution: podtypy musi byt zastupitelne za bazovy typ
- Interface Segregation: male specificke rozhrani > velke obecne
- Dependency Inversion: zavisej na abstrakci, ne na implementaci

### Dalsi principy
- DRY: neopakuj se — duplicitni logika patri do sdilene funkce
- KISS: udrzuj to jednoduche — jednoduchy kod je bezpecnejsi
- YAGNI: nepridavej funkcionalitu "pro budoucnost"

### Vystup
- Nalezy serad podle zavaznosti (critical > warning > info)
- Pro kazdou kategorii (bezpecnost, vykon, citelnost) uved souhrn
- Na konci uved celkove hodnoceni a doporuceni
- Pro analyzu kodu pouzij nastroj analyze_code
- Pro bezpecnostni scan pouzij nastroj security_scan

### Disclaimer (POVINNY)
Na konci KAZDE odpovedi obsahujici review:
"*Toto je automatizovane code review. Pro kriticke bezpecnostni audit doporucujeme manualni revizi specialistou.*"`,
};

// ─── Tool Definitions ───────────────────────────────────────────────────────

const EXPERTISE_EVIDENCE = Object.freeze({
  id: 'code_reviewer',
  moduleVersion: '1.1.0',
  appliedRules: Object.freeze(['mandatory-disclaimer', 'severity-order']),
});

async function prepareProjectContextParams(projectContext, params, executionContext) {
  const snapshot = await projectContext.query(executionContext.projectContext, {
    queryText: params.queryText,
    maxFiles: 8,
    maxBytes: 32_768,
    maxTokens: 8_192,
  });
  if (snapshot.status !== 'ok') {
    throw Object.assign(new Error(snapshot.error?.message || 'ProjectContext retrieval failed'), {
      code: snapshot.error?.code || 'M3_SPECIALIST_PROJECT_CONTEXT_FAILED',
    });
  }
  if (snapshot.outcome !== 'found' || snapshot.items.length === 0) {
    throw Object.assign(new Error('ProjectContext found no reviewable source for this query'), {
      code: 'M3_SPECIALIST_PROJECT_CONTEXT_EMPTY',
    });
  }
  return {
    params: {
      focus: params.focus || 'all',
      contextSnapshotDigest: snapshot.snapshotDigest,
      contextItems: snapshot.items,
    },
    evidence: {
      contract: snapshot.contract,
      version: snapshot.version,
      projectId: snapshot.projectId,
      workspaceRevision: snapshot.workspaceRevision,
      snapshotDigest: snapshot.snapshotDigest,
      outcome: snapshot.outcome,
      items: snapshot.items.map(item => ({
        path: item.path,
        startLine: item.startLine,
        endLine: item.endLine,
        contentDigest: item.contentDigest,
      })),
    },
  };
}

function renderReviewResult({ result, evidence }) {
  const data = result?.data || {};
  const findings = data.findings || data.vulnerabilities || [];
  const heading = data.vulnerabilities ? 'Bezpečnostní review' : 'Code review';
  const lines = [
    `## ${heading}`,
    '',
    `ProjectContext: \`${evidence?.snapshotDigest || 'unavailable'}\``,
    `Workspace revision: \`${evidence?.workspaceRevision || 'unavailable'}\``,
    '',
  ];
  if (findings.length === 0) {
    lines.push('V načteném výřezu nebyl deterministickými pravidly nalezen konkrétní problém.');
  } else {
    for (const finding of findings) {
      const location = finding.line ? `${finding.path}:${finding.line}` : finding.path;
      lines.push(`- **${String(finding.severity).toUpperCase()}** \`${location}\` — ${finding.message || finding.name}`);
      if (finding.recommendation) lines.push(`  Oprava: ${finding.recommendation}`);
    }
  }
  lines.push('', `Skóre: ${data.score ?? 'n/a'}/100`, '', `*${CODE_REVIEWER_EXPERTISE.modules.disclaimer}*`);
  if (data.score === undefined) {
    lines.splice(lines.length - 3, 1, `Riziko: ${data.riskLevel || 'unknown'}`);
  }
  return lines.join('\n');
}

function buildToolDefinitions(toolsDir, projectContext) {
  return [
    {
      id: 'code-reviewer.analyze_code',
      name: 'Analyza kodu',
      description: 'Analyze code for quality issues — readability, SOLID, performance, security',
      modulePath: path.join(toolsDir, 'review-project-context.js'),
      functionName: 'analyzeProjectContext',
      execute: analyzeProjectContext,
      needsProjectContext: true,
      failClosed: true,
      expertiseEvidence: EXPERTISE_EVIDENCE,
      prepareParams: (params, executionContext) => (
        prepareProjectContextParams(projectContext, params, executionContext)
      ),
      renderResult: renderReviewResult,
      patterns: [{
        priority: 8,
        patterns: [
          /(?:analyzuj|zkontroluj|over|projdi)\s+(?:ten(?:to)?|tenhle)?\s*k[oó]d/i,
          /code\s*(?:review|analysis|analyze|check)/i,
          /(?:kvalita|quality)\s+k[oó]du/i,
          /(?:zkontrolovat|analyzovat)\s+k[oó]d/i,
        ],
      }],
      extractParams: (input) => {
        const params = {};
        const lower = input.toLowerCase();
        if (/bezpe[čc]nost|security/i.test(lower)) params.focus = 'security';
        else if (/v[ýy]kon|perform/i.test(lower)) params.focus = 'performance';
        else if (/[čc]itelnost|readab/i.test(lower)) params.focus = 'readability';
        else if (/\bsolid\b/i.test(lower)) params.focus = 'solid';
        else params.focus = 'all';
        params.queryText = input;
        return params;
      },
    },
    {
      id: 'code-reviewer.security_scan',
      name: 'Security Scan',
      description: 'Scan code for security vulnerabilities — OWASP Top 10, hardcoded secrets, insecure crypto',
      modulePath: path.join(toolsDir, 'review-project-context.js'),
      functionName: 'securityScanProjectContext',
      execute: securityScanProjectContext,
      needsProjectContext: true,
      failClosed: true,
      expertiseEvidence: EXPERTISE_EVIDENCE,
      prepareParams: (params, executionContext) => (
        prepareProjectContextParams(projectContext, params, executionContext)
      ),
      renderResult: renderReviewResult,
      patterns: [{
        priority: 10,
        patterns: [
          /(?:bezpe[čc]nostn[ií]|security)\s+(?:scan|kontrola|audit|anal[ýy]za)/i,
          /(?:scan|kontrola|audit)\s+(?:bezpe[čc]nost|security)/i,
          /\bowasp\b/i,
          /(?:zranitelnost|vulnerabilit)/i,
        ],
      }],
      extractParams: input => ({ queryText: input, focus: 'security' }),
    },
  ];
}

// ─── Boost Patterns ─────────────────────────────────────────────────────────

const CODE_REVIEWER_BOOST_PATTERNS = [
  /code\s*review/i,
  /\breview\w*\s+k[oó]d/i,
  /\bbezpe[čc]nost\w*\s+k[oó]d/i,
  /\brefaktor/i,
  /\bsolid\b/i,
  /\bowasp\b/i,
  /pull\s*request/i,
  /\bpr\s+review/i,
];

// ─── Registration ───────────────────────────────────────────────────────────

/**
 * Register code-reviewer specialist — tools, boost patterns,
 * expertise, capabilities, tool types, tool executors.
 *
 * v121: Self-contained registration via ctx.registries.
 *
 * @param {Object} ctx - Registration context from specialist-loader
 */
export async function register(ctx) {
  const runtime = ctx.requireCapability('specialist.runtime.v1');
  const projectContext = ctx.requireCapability('code-intel.project-context.v1');
  const manifest = ctx.manifest.payload;
  const specialistId = ctx.extensionId;
  const registries = {
    autoSelect: ctx.getCapability('specialist.registry.auto-select.v1'),
    cre: ctx.getCapability('specialist.registry.cre.v1'),
    toolExecutor: ctx.getCapability('specialist.registry.tool-executor.v1'),
    capability: ctx.getCapability('specialist.registry.capability.v1'),
    expertise: ctx.getCapability('specialist.registry.expertise.v1'),
  };
  const toolsDir = path.join(__dirname, 'tools');

  // 1. Tools — register into SpecialistRuntime
  //    ID must match manifest.expertises[0] for integrity check consistency.
  runtime.registerSpecialist({
    id: 'code_reviewer',
    extensionId: specialistId,
    domain: 'software_engineering',
    globalParamExtractor: null,
    tools: buildToolDefinitions(toolsDir, projectContext),
  });

  // 2. Expertise — register custom expertise definition
  if (registries.expertise) {
    registries.expertise.addCustom(CODE_REVIEWER_EXPERTISE);
  }

  // 3. Boost patterns — register into auto-select
  if (registries.autoSelect?.registerBoostPatterns) {
    registries.autoSelect.registerBoostPatterns('code_reviewer', CODE_REVIEWER_BOOST_PATTERNS);
  }

  // 4. ToolType registration — dynamic CRE tool types
  if (registries.cre?.registerToolType) {
    for (const tool of manifest?.tools || []) {
      registries.cre.registerToolType(tool.id);
    }
  }

  // 5. ToolExecutor handlers — register tool execution handlers for CRE
  if (registries.toolExecutor?.register) {
    const tools = buildToolDefinitions(toolsDir, projectContext);
    for (const tool of tools) {
      // The general CRE registry has no core-owned project/turn authority and
      // must not become an ambient filesystem back door. Project-bound tools
      // execute only through SpecialistRuntime, which mints an opaque
      // invocation for the exact persisted chat turn.
      registries.toolExecutor.register(tool.id, () => ({
        status: 'error',
        errorCode: 'M3_SPECIALIST_PROJECT_CONTEXT_REQUIRED',
        error: 'This tool requires a specialist ProjectContext invocation',
      }));
    }
  }

  // 6. Capabilities (v121 — registered when CapabilityRegistry is available)
  if (registries.capability?.register) {
    for (const cap of manifest.providedCapabilities) {
      registries.capability.register(cap, specialistId);
    }
  }
}

/**
 * Unregister code-reviewer specialist from all registries.
 * v121: Fail-safe — each step independent, errors don't block others.
 *
 * @param {Object} ctx - Registration context from specialist-loader
 */
export function unregister(ctx) {
  const runtime = ctx.requireCapability('specialist.runtime.v1');
  const manifest = ctx.manifest.payload;
  const specialistId = ctx.extensionId;
  const registries = {
    autoSelect: ctx.getCapability('specialist.registry.auto-select.v1'),
    cre: ctx.getCapability('specialist.registry.cre.v1'),
    toolExecutor: ctx.getCapability('specialist.registry.tool-executor.v1'),
    capability: ctx.getCapability('specialist.registry.capability.v1'),
    expertise: ctx.getCapability('specialist.registry.expertise.v1'),
  };

  // 1. Tools
  try {
    if (typeof runtime?.unregisterSpecialist === 'function') {
      runtime.unregisterSpecialist('code_reviewer');
    }
  } catch { /* handled by loader fail-safe */ }

  // 2. Expertise
  try {
    registries.expertise?.removeCustom('code_reviewer');
  } catch { /* noop */ }

  // 3. Boost patterns
  try {
    registries.autoSelect?.unregisterBoostPatterns('code_reviewer');
  } catch { /* noop */ }

  // 4. ToolType + ToolExecutor
  try {
    for (const tool of manifest?.tools || []) {
      registries.cre?.unregisterToolType(tool.id);
      registries.toolExecutor?.unregister(tool.id);
    }
  } catch { /* noop */ }

  // 5. Capabilities
  try {
    registries.capability?.unregisterBySpecialist?.(specialistId);
  } catch { /* noop */ }
}
