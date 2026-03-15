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

function buildToolDefinitions(toolsDir) {
  return [
    {
      id: 'code-reviewer.analyze_code',
      name: 'Analyza kodu',
      description: 'Analyze code for quality issues — readability, SOLID, performance, security',
      modulePath: path.join(toolsDir, 'analyze-code.js'),
      functionName: 'analyzeCode',
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
        return params;
      },
    },
    {
      id: 'code-reviewer.security_scan',
      name: 'Security Scan',
      description: 'Scan code for security vulnerabilities — OWASP Top 10, hardcoded secrets, insecure crypto',
      modulePath: path.join(toolsDir, 'security-scan.js'),
      functionName: 'securityScan',
      patterns: [{
        priority: 10,
        patterns: [
          /(?:bezpe[čc]nostn[ií]|security)\s+(?:scan|kontrola|audit|anal[ýy]za)/i,
          /(?:scan|kontrola|audit)\s+(?:bezpe[čc]nost|security)/i,
          /\bowasp\b/i,
          /(?:zranitelnost|vulnerabilit)/i,
        ],
      }],
      extractParams: () => ({}),
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
  const { runtime, manifest, logger: log } = ctx;
  const toolsDir = path.join(__dirname, 'tools');

  // 1. Tools — register into SpecialistRuntime
  runtime.registerSpecialist({
    id: 'code-reviewer',
    domain: 'software_engineering',
    globalParamExtractor: null,
    tools: buildToolDefinitions(toolsDir),
  });

  // 2. Expertise — register custom expertise definition
  if (ctx.registries?.expertise) {
    ctx.registries.expertise.addCustom(CODE_REVIEWER_EXPERTISE);
  }

  // 3. Boost patterns — register into auto-select
  if (ctx.registries?.autoSelect?.registerBoostPatterns) {
    ctx.registries.autoSelect.registerBoostPatterns('code_reviewer', CODE_REVIEWER_BOOST_PATTERNS);
  }

  // 4. ToolType registration — dynamic CRE tool types
  if (ctx.registries?.cre?.registerToolType) {
    for (const tool of manifest?.tools || []) {
      ctx.registries.cre.registerToolType(tool.id);
    }
  }

  // 5. ToolExecutor handlers — register tool execution handlers for CRE
  if (ctx.registries?.toolExecutor?.register) {
    const tools = buildToolDefinitions(toolsDir);
    for (const tool of tools) {
      ctx.registries.toolExecutor.register(tool.id, async (params) => {
        const mod = await import(tool.modulePath);
        return mod[tool.functionName](params);
      });
    }
  }

  // 6. Capabilities (v121 — registered when CapabilityRegistry is available)
  if (ctx.registries?.capability?.register) {
    for (const cap of manifest?.capabilities || []) {
      ctx.registries.capability.register(cap, manifest.id);
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
  const { runtime, manifest } = ctx;

  // 1. Tools
  try {
    if (typeof runtime?.unregisterSpecialist === 'function') {
      runtime.unregisterSpecialist('code-reviewer');
    }
  } catch { /* handled by loader fail-safe */ }

  // 2. Expertise
  try {
    ctx.registries?.expertise?.removeCustom('code_reviewer');
  } catch { /* noop */ }

  // 3. Boost patterns
  try {
    ctx.registries?.autoSelect?.unregisterBoostPatterns('code_reviewer');
  } catch { /* noop */ }

  // 4. ToolType + ToolExecutor
  try {
    for (const tool of manifest?.tools || []) {
      ctx.registries?.cre?.unregisterToolType(tool.id);
      ctx.registries?.toolExecutor?.unregister(tool.id);
    }
  } catch { /* noop */ }

  // 5. Capabilities
  try {
    ctx.registries?.capability?.unregisterBySpecialist?.(manifest?.id);
  } catch { /* noop */ }
}
