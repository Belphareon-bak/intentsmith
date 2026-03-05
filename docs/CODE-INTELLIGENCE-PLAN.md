# Code Intelligence — Kompletní plán (8 fází) v3

## Context

C3 umí výborně lifecycle-driven development (SPEC→BUILD→REVIEW), ale **neumí ad-hoc analýzu existujícího kódu**. Když uživatel otevře projekt a řekne "najdi bug", C3 ukáže metadata místo analýzy kódu. IDE AI (IntelliJ, Cursor) toto řeší pipeline: query → search → context → reasoning.

**Cíl:** Dostat C3 nad úroveň IDE AI asistentů přidáním 7 vrstev code intelligence.

**Aktuální stav (z explorace):**
- IntentType má 17 hodnot — **CODE_ANALYSIS chybí**
- `fs.find` tool existuje (glob + grep-like) — ale nikdy se nepoužívá pro code analysis
- ripgrep NENÍ nainstalován (nutno doinstalovat)
- tree-sitter NENÍ nainstalován
- File handler čte max 512KB, formátuje do code fence (70+ jazyků)
- Context budget pro CODE: 1500 tokenů history + 500 LTM — **příliš málo**
- `handleAnswerDecision()` → `synthesizeWithLLM()` → Quality Gate v2 — celý pipeline existuje
- `text.search` tool existuje v registry (řádky 1845-1890) — grep-like search přes FS

---

## Přehled fází

| Fáze | Název | ROI | Složitost | Závislosti |
|------|-------|-----|-----------|------------|
| **1** | Code Search Engine + Query Expander | NEJVYŠŠÍ | Nízká | žádné |
| **2** | Smart File Discovery | Vysoký | Nízká | Fáze 1 |
| **3** | Multi-File Context Builder | Vysoký | Střední | Fáze 2 |
| **4** | Deep Code Analyzer | Vysoký | Střední | Fáze 3 |
| **5** | AST Intelligence (tree-sitter) | Střední | Vysoká | Fáze 3 |
| **5.5** | **Project Symbol Index** | Vysoký | Střední | Fáze 5 |
| **6** | Semantic Code Index | Střední | Vysoká | Fáze 3 |
| **7** | Autonomous Debugging Agent | Nejvyšší long-term | Velmi vysoká | Fáze 1-4 |

**Fáze 1+3 = Quick Win** (90% IntelliJ behavior). **Fáze 1-4 = MVP.** Fáze 5-7 = competitive advantage.

### Finální pipeline (po všech fázích):

```
User Query → Query Expander → Symbol Index → Code Search → File Discovery
  → Context Builder → Code Analyzer → LLM → Answer
```

---

## Kritická architektonická změna: Routing Priority

### Problém
File Intent Heuristic (`project.js:233-275`) může přepsat CODE_ANALYSIS:
```
"explain server.js" → heuristika vrátí FILE_READ → CODE_ANALYSIS handler se nespustí
```

### Řešení
CODE_ANALYSIS musí být **prioritní override** — heuristika se PŘESKOČÍ pokud CRE klasifikuje jako CODE_ANALYSIS:
```javascript
// V project.js, PŘED file heuristic:
if (decision.intent === IntentType.CODE_ANALYSIS) {
  return await handleCodeAnalysisDecision(input, decision, context);
}
// Pak teprve file heuristic (pro FILE_READ/FILE_EXPLAIN)
```

Alternativně: CODE_ANALYSIS patterns detekovat v pre-CRE regex fázi (jako attachment guard), aby CRE vůbec nemusel klasifikovat.

---

## FÁZE 1 — Code Search Engine + Query Expander

### 1.1 Nový modul: `src/code-intel/code-search.js`

```javascript
export async function searchCode(projectPath, query, opts = {}) {
  // opts: { maxResults: 30, contextLines: 3, fileTypes: null, ignoreCase: true }
  // Returns: { results: [{ file, line, content, contextBefore, contextAfter }],
  //            totalMatches, searchTime, engine: 'ripgrep'|'grep'|'node' }
}

export async function searchSymbol(projectPath, symbol, opts = {}) {
  // Hledá definice: function X, class X, const X, def X, func X, type X
  // Returns: { definitions: [{ file, line, kind, content }], references: [...] }
}
```

**Search engine priority:**
1. **ripgrep** (primární) — 10-100x rychlejší, respektuje .gitignore, parallel search
   ```
   rg --json -n --type-add 'code:*.{js,ts,py,go,java,rs,c,cpp,cs,php,rb,swift,kt,scala}' --type code "query" projectPath
   ```
2. **grep** (fallback) — `grep -rn --include='*.{js,ts,py,...}' "query" projectPath`
3. **Node.js fs** (last resort) — `readdir` + `readFile` + `match`

**Ignorované:** `node_modules`, `.git`, `dist`, `build`, `__pycache__`, `venv`, `.c3`, `vendor`, `target`

**Limity:** Max 5000 prohledaných souborů, max 1MB per soubor, timeout 10s

**Search cache:** `Map<queryHash, { results, timestamp }>`, TTL 30s. Debug agent volá search opakovaně.

### 1.2 Query Expander: `src/code-intel/query-expander.js`

**Problém:** Uživatel řekne "why forwardingAddress fails", ale root cause je v `NOT_RETURNED_BY_DEFAULT` a `ALLOW_PARTIAL_RESULTS`.

```javascript
export function expandQuery(input) {
  // 1. Extrahuj identifikátory (camelCase, snake_case, UPPER_CASE, PascalCase)
  //    "why forwardingAddress fails" → ["forwardingAddress"]
  //
  // 2. Rozlož camelCase → sub-terms
  //    "forwardingAddress" → ["forwarding", "address"]
  //
  // 3. Extrahuj technické termy (error, timeout, null, exception, ...)
  //
  // 4. Ignoruj stop-words (why, the, this, jak, proč, ten, ...)
  //
  // Returns: { primary: ["forwardingAddress"], secondary: ["forwarding", "address"], terms: [...] }
}
```

**Žádný LLM** — čistě heuristika. Rychlé, deterministické.

### 1.3 CRE: IntentType.CODE_ANALYSIS

**Kde:** `src/chat/cre-decision.js`

```javascript
CODE_ANALYSIS: 'CODE_ANALYSIS',
```

**Regex patterns:**
```javascript
const CODE_ANALYSIS_PATTERNS = [
  /analyz[uj|ovat].*(?:kód|code|modul|tříd|class)/i,
  /(?:najd[i|ěte]|find|hledej).*(?:bug|chyb|error|problém)/i,
  /(?:why|proč).*(?:fail|padá|nefunguje|crash|error)/i,
  /(?:explain|vysvětli).*(?:code|kód|modul|funkc|metod|class|tříd)/i,
  /(?:debug|ladění|stacktrace|exception|traceback)/i,
  /(?:root.?cause|příčin)/i,
  /(?:code.?review|review.*(?:kód|code))/i,
  /(?:refactor|refaktor)/i,
  /(?:how.*work|jak.*funguje).*(?:code|kód|modul|systém)/i,
  /(?:what.*does|co.*dělá).*(?:this|tato|ten|tento).*(?:code|kód|funkce|metoda)/i,
  /(?:analyze|propose.*solution|navrhni.*řešení)/i,
];
```

**Routing:** CODE_ANALYSIS → `TOOL_CALL` (musí nejdřív hledat kód, ne odpovídat z hlavy)

**STRONG_INTENT:** ANO — CODE_ANALYSIS nesmí být overridden follow-up re-classification.

### 1.4 Handler: `src/chat/handlers/code-analysis.js`

```javascript
export async function handleCodeAnalysisDecision(input, decision, context) {
  const projectPath = context.project?.path;
  if (!projectPath) return handleAnswerDecision(input, decision, context); // fallback

  // 1. Expand query (heuristic, no LLM)
  const expanded = expandQuery(input);

  // 2. Search code (ripgrep → grep → node)
  const searchResults = await searchCode(projectPath, expanded.primary[0], {
    maxResults: 30, contextLines: 3
  });

  // 3. Rank files (fáze 2, nebo basic ranking v fázi 1)
  // 4. Read top files (readFileSafe)
  // 5. Build multi-file context (fáze 3)
  // 6. LLM synthesis with CODE_ANALYSIS system prompt
  // 7. Return structured response
}
```

### 1.5 Context Budget

```javascript
CODE_ANALYSIS: { history: 500, search: 0, ltm: 300, codeContext: 15000 }
```

### 1.6 Wiring

- `conversation.js` switch: `case IntentType.CODE_ANALYSIS: return handleCodeAnalysisDecision(...)`
- `project.js`: CODE_ANALYSIS **PŘED** file heuristic (priority override)
- `context-budget.js`: nový budget tier

### Soubory fáze 1

| # | Soubor | Akce |
|---|--------|------|
| 1 | `src/code-intel/code-search.js` | NEW — searchCode(), searchSymbol(), cache |
| 2 | `src/code-intel/query-expander.js` | NEW — expandQuery() |
| 3 | `src/chat/cre-decision.js` | MODIFY — IntentType.CODE_ANALYSIS + patterns |
| 4 | `src/chat/handlers/code-analysis.js` | NEW — handleCodeAnalysisDecision() |
| 5 | `src/chat/handlers/conversation.js` | MODIFY — switch case CODE_ANALYSIS |
| 6 | `src/chat/handlers/project.js` | MODIFY — CODE_ANALYSIS priority override |
| 7 | `src/chat/context-budget.js` | MODIFY — CODE_ANALYSIS budget |
| 8 | `tests/code-search.test.js` | NEW |
| 9 | `tests/query-expander.test.js` | NEW |

---

## FÁZE 2 — Smart File Discovery

### 2.1 `src/code-intel/file-discovery.js`

```javascript
export function rankFiles(searchResults, queryTerms, opts = {}) {
  // Scoring per file:
  //   0.30 × keyword_match (normalized match count)
  //   0.20 × proximity_score (query terms close to each other in same file)
  //   0.20 × path_relevance (src/ > test/, filename contains query term)
  //   0.15 × recency (git log -n 200 --name-only, cached)
  //   0.10 × file_type_boost (code=1.0, config=0.5, docs=0.3)
  //   0.05 × cluster_density (files imported/required together)
  //
  // Returns: ranked [{ file, score, reason, matchCount }]
}

export function extractImports(fileContent, language) {
  // Regex-based (no AST):
  // JS:     import ... from 'path' | require('path')
  // Python: import X | from X import Y
  // Go:     import "path"
  // Java:   import com.example.Class
  // Returns: string[]
}
```

**Proximity scoring:** Pokud query má 2+ termů, soubor kde jsou blízko sebe (±20 řádků) dostane vyšší score.

**Git recency:** Batch volání `git log -n 200 --name-only --format=''` (jednou, ne per-file). Cache 60s.

### Soubory fáze 2

| # | Soubor | Akce |
|---|--------|------|
| 1 | `src/code-intel/file-discovery.js` | NEW — rankFiles(), extractImports() |
| 2 | `src/chat/handlers/code-analysis.js` | MODIFY — use rankFiles() |
| 3 | `tests/file-discovery.test.js` | NEW |

---

## FÁZE 3 — Multi-File Context Builder

### 3.1 `src/code-intel/context-builder.js`

```javascript
export async function buildCodeContext(projectPath, rankedFiles, opts = {}) {
  // opts: { maxFiles: 10, maxTokens: 15000, maxLinesPerFile: 200, queryTerms: [] }
  //
  // Pro každý soubor (od highest score):
  //   1. Přečti obsah (readFileSafe)
  //   2. Smart truncation:
  //      - VŽDY zachovej prvních 20 řádků (imports, class decl)
  //      - VŽDY zachovej řádky s query match ± 10 řádků
  //      - Zbytek: "// ... (truncated N lines)"
  //   3. Context graph deduplication:
  //      - Pokud file A importuje B a oba jsou v context → don't repeat shared imports
  //   4. Metadata per file: last_modified, symbol count, imports list
  //   5. Formátuj do markdown code fence
  //   6. Token estimation: chars / 4
  //   7. Zastav pokud totalTokens > maxTokens
  //
  // Returns: { context: string, files: [{ path, lines, truncated }], totalTokens }
}
```

**Výstupní formát:**
```markdown
### File: src/DominoAccountAttribute.java (285 lines, modified 2024-01-15)
**Imports:** com.example.ConnectorBase, java.util.List
**Symbols:** enum DominoAccountAttribute (45 fields)

```java
package com.example;
import ...;

public enum DominoAccountAttribute {
  // ... (lines 1-40 truncated)
  FORWARDING_ADDRESS("forwardingAddress", String.class, NOT_RETURNED_BY_DEFAULT),  // ← line 42
  // ... (lines 43-285 truncated)
}
```
```

### 3.2 Code Analysis System Prompt

```javascript
export function buildCodeAnalysisPrompt(query, codeContext, projectInfo) {
  return `You are analyzing a codebase to answer a developer's question.

## Developer Question
${query}

## Project
${projectInfo}

## Codebase Excerpt
${codeContext}

## Instructions
1. Identify the root cause of the issue described
2. Explain the mechanism (how the bug/behavior occurs)
3. Propose concrete fixes with code changes
4. If multiple solutions exist, rank them by impact and simplicity

## Output Format
### Analysis
[What you found in the code]

### Root Cause
[Specific file, line, and mechanism]

### Solution 1: [Title] (Recommended)
[Description + code patch]

### Solution 2: [Title]
[Alternative approach]
`;
}
```

### 3.3 Context Budget update

```javascript
CODE_ANALYSIS: { history: 500, search: 0, ltm: 300, codeContext: 15000 }
// Total: ~16300 tokenů — fits 32K context with room for system prompt + response
```

**Token estimation:** `Math.ceil(text.length / 4)` (dostatečně přesné pro budgeting)

### Soubory fáze 3

| # | Soubor | Akce |
|---|--------|------|
| 1 | `src/code-intel/context-builder.js` | NEW — buildCodeContext(), smart truncation |
| 2 | `src/chat/context-budget.js` | MODIFY — CODE_ANALYSIS tier |
| 3 | `src/chat/handlers/utils/synthesis.js` | MODIFY — code analysis system prompt |
| 4 | `src/chat/handlers/code-analysis.js` | MODIFY — use buildCodeContext() |
| 5 | `tests/context-builder.test.js` | NEW |

---

## FÁZE 4 — Deep Code Analyzer

### 4.1 `src/code-intel/code-analyzer.js`

```javascript
export function analyzeCodeStructure(fileContent, language) {
  // Regex-based structure extraction:
  //   classes, functions, imports, exports, constants
  //
  // + Error pattern detection (deterministické):
  //   catch {}, empty catch, TODO, FIXME, throw new Error, console.error
  //
  // + Configuration detection:
  //   timeout, retry, cache, pool, limit, max, min
  //
  // Returns: {
  //   classes: [{ name, line, methods, extends?, implements? }],
  //   functions: [{ name, line, params, exported }],
  //   imports: [...], exports: [...], constants: [...],
  //   codeSmells: [{ type, line, message }],  // empty catch, TODO, etc.
  //   configValues: [{ name, value, line }],   // timeout=60, retries=3, etc.
  // }
}
```

**Per-language regex sets:**
- Java: `class X`, `interface X`, `public void method()`, `import`, `@Override`
- Python: `class X`, `def method(self)`, `import X`, `from X import Y`
- JavaScript: `class X`, `function X`, `export`, `const X =`, `import`, `=>`
- Go: `func X`, `type X struct`, `import`, `const`, `var`
- Rust: `fn X`, `struct X`, `enum X`, `impl X`, `use`

**Code smell patterns (all languages):**
```javascript
const SMELL_PATTERNS = [
  { pattern: /catch\s*\(\w*\)\s*\{\s*\}/, type: 'EMPTY_CATCH' },
  { pattern: /\/\/\s*TODO/i, type: 'TODO' },
  { pattern: /\/\/\s*FIXME/i, type: 'FIXME' },
  { pattern: /\/\/\s*HACK/i, type: 'HACK' },
  { pattern: /console\.(error|warn)\(/, type: 'CONSOLE_ERROR' },
  { pattern: /process\.exit\(/, type: 'PROCESS_EXIT' },
  { pattern: /eval\(/, type: 'EVAL_USAGE' },
];
```

### 4.2 Enriched Context

Context builder (fáze 3) volá `analyzeCodeStructure()` a přidá metadata do markdown:
```
### File: DominoAccountAttribute.java
**Type:** Java Enum
**Symbols:** 45 enum fields, 3 methods
**Code Smells:** 0
**Config Values:** NOT_RETURNED_BY_DEFAULT (3 occurrences)
```

### Soubory fáze 4

| # | Soubor | Akce |
|---|--------|------|
| 1 | `src/code-intel/code-analyzer.js` | NEW — analyzeCodeStructure() |
| 2 | `src/code-intel/context-builder.js` | MODIFY — enriched context |
| 3 | `tests/code-analyzer.test.js` | NEW |

---

## FÁZE 5 — AST Intelligence (tree-sitter)

### 5.1 Tree-sitter integrace

```bash
npm install tree-sitter tree-sitter-javascript tree-sitter-python tree-sitter-go tree-sitter-java
```

### 5.2 `src/code-intel/ast-analyzer.js`

```javascript
export function parseAST(fileContent, language) { ... }
export function findUsages(projectPath, symbolName, language) { ... }
export function getCallChain(projectPath, functionName) { ... }
```

**Lazy parsing:** Pouze pro soubory s `ranking score > 0.5`. Ne celý projekt.

### Soubory fáze 5

| # | Soubor | Akce |
|---|--------|------|
| 1 | `package.json` | MODIFY — tree-sitter deps |
| 2 | `src/code-intel/ast-analyzer.js` | NEW |
| 3 | `tests/ast-analyzer.test.js` | NEW |

---

## FÁZE 5.5 — Project Symbol Index

### Problém
Bez indexu je "kde se používá validateToken?" = grep celého projektu (pomalé, nepřesné).
IDE (IntelliJ, VS Code) vždy mají symbol index → O(1) lookup.

### 5.5.1 `src/code-intel/symbol-index.js`

```javascript
export class SymbolIndex {
  // In-memory index, built from AST (fáze 5) + regex fallback

  // Build/update
  async buildIndex(projectPath) { ... }        // Full scan, background
  async reindexFile(filePath) { ... }          // Incremental (on git diff / file change)

  // Query
  findSymbol(name) { ... }                     // → { file, line, type, exported, language }
  findReferences(symbolName) { ... }           // → [{ file, line, context }]
  getCallGraph(functionName) { ... }           // → { callers: [...], callees: [...] }
  getFileSymbols(filePath) { ... }             // → [{ name, type, line, exported }]
  getImportChain(symbolName) { ... }           // → [file1 → file2 → file3]
}
```

**Data model:**
```javascript
{
  name: "validateToken",
  type: "function",          // function | class | method | variable | constant | enum | interface | type
  file: "src/auth/token.js",
  line: 42,
  language: "javascript",
  exported: true,
  params: ["token", "options"],
}
```

**In-memory storage:**
```javascript
{
  symbolsByName: Map<string, Symbol[]>,     // name → all definitions (may be in multiple files)
  symbolsByFile: Map<string, Symbol[]>,     // file → all symbols in file
  references: Map<string, Reference[]>,     // symbolName → all usage locations
  imports: Map<string, string[]>,           // file → imported module paths
}
```

### 5.5.2 Index Build

**Source:** AST (tree-sitter, fáze 5) pro přesné výsledky, regex fallback pro jazyky bez tree-sitter.

**Trigger:**
- Project open → background full build
- Git diff → incremental reindex changed files
- File save (pokud watcher) → reindex single file

**Performance:**
- Typický projekt (500 souborů): <2s build
- Velký projekt (5000 souborů): <10s build (background, non-blocking)
- Lookup: O(1) via Map

### 5.5.3 Integrace do Code Analysis pipeline

**PŘED code search** (pokud symbol existuje v indexu, grep není potřeba):
```javascript
// V handleCodeAnalysisDecision():
const expanded = expandQuery(input);

// 1. Try symbol index first (O(1))
for (const term of expanded.primary) {
  const symbol = symbolIndex.findSymbol(term);
  if (symbol) {
    const refs = symbolIndex.findReferences(term);
    const callGraph = symbolIndex.getCallGraph(term);
    // → Skip grep, go directly to context builder with precise files
  }
}

// 2. Fallback to code search (grep/ripgrep) if no symbol match
const searchResults = await searchCode(projectPath, ...);
```

### Soubory fáze 5.5

| # | Soubor | Akce |
|---|--------|------|
| 1 | `src/code-intel/symbol-index.js` | NEW — SymbolIndex class |
| 2 | `src/code-intel/index-builder.js` | NEW — AST→Symbol extraction |
| 3 | `src/chat/handlers/code-analysis.js` | MODIFY — symbol index lookup before search |
| 4 | `tests/symbol-index.test.js` | NEW |

---

## FÁZE 6 — Semantic Code Index

### 6.1 Embedding pipeline

```javascript
export async function indexProject(projectPath) { ... }
export async function semanticSearch(projectPath, query, topK = 10) { ... }
```

**Embedding model:** `bge-code` nebo `nomic-embed-code` (optimalizované pro kód, ne `all-MiniLM-L6-v2`).

**Semantic chunking:** function/class/method granularity (ne fixed-size tokens).

**Background indexing:** Na project open, incremental update via git diff. Index limit 50MB/projekt.

### 6.2 Storage

```sql
CREATE VIRTUAL TABLE code_embeddings USING vec0(
  embedding float[768],  -- bge-code (768 dims)
  file_path, chunk_type, chunk_name, start_line, end_line, content
);
```

### Soubory fáze 6

| # | Soubor | Akce |
|---|--------|------|
| 1 | `package.json` | MODIFY — sqlite-vec + embedding deps |
| 2 | `src/code-intel/semantic-index.js` | NEW |
| 3 | `src/code-intel/chunker.js` | NEW |
| 4 | `src/db/migrations/XXX_code_embeddings.js` | NEW |

---

## FÁZE 7 — Autonomous Debugging Agent

### 7.1 `src/code-intel/debug-agent.js`

```javascript
export async function debugIssue(projectPath, bugReport, context) {
  // Beam search: top 3 hypotheses, testované paralelně
  // Max 5 iterací: hypothesize → search → analyze → verify → patch
  // Self-correction: slepá ulička → revize hypothesis (max 3 revize)
}
```

### Soubory fáze 7

| # | Soubor | Akce |
|---|--------|------|
| 1 | `src/code-intel/debug-agent.js` | NEW |
| 2 | `tests/debug-agent.test.js` | NEW |

---

## Celkový přehled souborů

### Nové soubory (19)

| Fáze | Soubor | Účel |
|------|--------|------|
| 1 | `src/code-intel/code-search.js` | ripgrep/grep code search + cache |
| 1 | `src/code-intel/query-expander.js` | heuristic query expansion |
| 1 | `src/chat/handlers/code-analysis.js` | CODE_ANALYSIS handler |
| 1 | `tests/code-search.test.js` | search testy |
| 1 | `tests/query-expander.test.js` | expander testy |
| 2 | `src/code-intel/file-discovery.js` | file ranking + import extraction |
| 2 | `tests/file-discovery.test.js` | ranking testy |
| 3 | `src/code-intel/context-builder.js` | multi-file context assembly |
| 3 | `tests/context-builder.test.js` | context testy |
| 4 | `src/code-intel/code-analyzer.js` | regex structure + smells + config |
| 4 | `tests/code-analyzer.test.js` | analyzer testy |
| 5 | `src/code-intel/ast-analyzer.js` | tree-sitter AST |
| 5.5 | `src/code-intel/symbol-index.js` | SymbolIndex class (in-memory) |
| 5.5 | `src/code-intel/index-builder.js` | AST→Symbol extraction |
| 5.5 | `tests/symbol-index.test.js` | symbol index testy |
| 6 | `src/code-intel/semantic-index.js` | vector embeddings |
| 6 | `src/code-intel/chunker.js` | code chunk extraction |
| 7 | `src/code-intel/debug-agent.js` | autonomous debugger |
| 7 | `tests/debug-agent.test.js` | agent testy |

### Modifikované soubory (7)

| Fáze | Soubor | Změna |
|------|--------|-------|
| 1 | `src/chat/cre-decision.js` | IntentType.CODE_ANALYSIS + patterns + STRONG_INTENT |
| 1 | `src/chat/handlers/conversation.js` | switch case CODE_ANALYSIS |
| 1 | `src/chat/handlers/project.js` | CODE_ANALYSIS priority override (PŘED file heuristic) |
| 1 | `src/chat/context-budget.js` | CODE_ANALYSIS budget tier |
| 3 | `src/chat/handlers/utils/synthesis.js` | code analysis system prompt |
| 5 | `package.json` | tree-sitter deps |
| 5.5 | `src/chat/handlers/code-analysis.js` | symbol index lookup before search |

---

## Implementační pořadí

```
Fáze 1 (Code Search + Query Expander + CRE intent)  ← ZAČÍT ZDE
  ↓
Fáze 3 (Context Builder)              ← QUICK WIN: 1+3 = 90% IntelliJ
  ↓
Fáze 2 (File Discovery)               ← ranking quality boost
  ↓
Fáze 4 (Code Analyzer)                ← enriched context, smells, config
  ↓
Fáze 5 (AST / tree-sitter)            ← heavy upgrade, optional for MVP
  ↓
Fáze 6 (Semantic Index)               ← research project
  ↓
Fáze 7 (Debug Agent)                  ← builds on everything above
```

**Quick Win = Fáze 1+3.** Stačí na 90% IntelliJ behavior.
**MVP = Fáze 1-4.** Řeší 95% use cases.
**Competitive advantage = Fáze 5-7.** Lepší než IDE AI.

---

## Odhad velikosti (realistický)

| Fáze | Nový kód | Testy | Modifikace | Glue/config/errors |
|------|----------|-------|------------|---------------------|
| 1 | ~300 řádků | ~200 řádků | ~60 řádků | ~40 řádků |
| 2 | ~180 řádků | ~120 řádků | ~20 řádků | ~20 řádků |
| 3 | ~250 řádků | ~150 řádků | ~40 řádků | ~30 řádků |
| 4 | ~350 řádků | ~180 řádků | ~30 řádků | ~30 řádků |
| 5 | ~450 řádků | ~200 řádků | ~20 řádků | ~40 řádků |
| 6 | ~550 řádků | ~180 řádků | ~10 řádků | ~50 řádků |
| 7 | ~400 řádků | ~250 řádků | ~30 řádků | ~40 řádků |
| **Total** | **~2480** | **~1280** | **~210** | **~250** |
| **Grand total** | | | | **~4220 řádků** |

---

## Verifikace

### Po fázi 1+3 (Quick Win):

**Test 1 — Domino connector:**
```
Input: "Tento konektor má problém s atributem forwardingAddress. Analyzuj kód."
Expected: C3 najde DominoAccountAttribute.java, přečte ho, identifikuje NOT_RETURNED_BY_DEFAULT,
          vysvětlí interakci s ALLOW_PARTIAL_RESULTS, navrhne řešení.
```

**Test 2 — Bug report:**
```
Input: "Proč testy padají na timeout?"
Expected: Hledá "timeout" → najde config → analyzuje hodnoty → navrhne úpravu.
```

**Test 3 — Code understanding:**
```
Input: "Jak funguje autentizace v tomto projektu?"
Expected: Hledá auth/login/jwt/session → najde moduly → vysvětlí flow.
```

### Po fázi 4 (MVP):

**Test 4 — Code smells:**
```
Input: "Najdi potenciální problémy v kódu."
Expected: Deterministicky najde empty catches, TODOs, eval(), hardcoded secrets.
```

### Po fázi 5 (AST):

**Test 5 — Symbol resolution:**
```
Input: "Kde se používá funkce validateToken?"
Expected: Definice + všechny call sites + import chain.
```

### Po fázi 7 (Debug Agent):

**Test 6 — Autonomous debug:**
```
Input: "Endpoint /api/users vrací 500. Debug."
Expected: Autonomně: hledá → čte → identifikuje → patchuje → ověřuje.
```

---

## Performance opatření

| Concern | Řešení |
|---------|--------|
| Search na velkém projektu | ripgrep (parallel, .gitignore), timeout 10s |
| Git recency per file | Batch: `git log -n 200 --name-only`, cache 60s |
| Multi-file context size | Smart truncation, token budget 15000 |
| Opakované search (debug agent) | In-memory cache, TTL 30s |
| AST parsing celého projektu | Lazy: jen files s ranking > 0.5 |
| Semantic index build | Background, incremental via git diff |
| Token estimation | `chars / 4` heuristika |

---

## Akce: Tento plán uložit jako `docs/CODE-INTELLIGENCE-PLAN.md`

Po schválení se plán přesune z plan-file do `docs/CODE-INTELLIGENCE-PLAN.md` jako trvalý strategický dokument. Pak začne implementace fáze 1+3 (Quick Win).
