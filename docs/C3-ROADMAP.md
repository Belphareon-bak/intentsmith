# C3 Agent — Development Roadmap

> Comprehensive plan for strengthening C3's autonomous code generation capabilities.
> Based on gap analysis of existing infrastructure vs. Claude Code/Opus CLI agent capabilities.
> Synthesized from architecture review (4 rounds) + second-opinion roadmap comparison.
> Written 2026-03-04, updated 2026-03-05.

---

## Current State Assessment

C3 has **strong foundations** across 25 code-intel modules (~4,500 LOC), a mature lifecycle engine, and a working project build pipeline. What's missing is the **execution loop** — the ability to iteratively generate, test, diagnose, and fix code without human intervention.

### What Works Well
- **Knowledge Graph** (741 LOC): 9 node types, 8 edge types, incremental update, module-level queries
- **Context Builder** (600 LOC): Smart truncation, intent-aware strategies, hierarchical context
- **Context Engine** (v100): Symbol-aware compression, ~70% token savings over full-file context
- **Graph Retrieval** (313 LOC): Priority BFS, hub penalty, namespace boost, edge weights
- **Architecture Detector** (341 LOC): 18 frameworks, 10 layers, 8 patterns, convention detection
- **Lifecycle Build** (1,356 LOC): Milestone pipeline, scope enforcement, health scoring, auto-commit
- **Critic Agent** (410 LOC): 7 failure types, targeted repair instructions, multi-source analysis
- **Runtime Feedback** (442 LOC): Jest/Mocha/pytest/go/cargo/gcc parsers, pattern detection, fix suggestions
- **AST Analyzer**: tree-sitter based, JS/Python/Go/Java, symbol extraction with params + export status
- **Guardian + Contract Registry + Policy Engine** (v98-v100): Architecture governance, API tracking, drift detection
- **Refactor Agent** (v100): Smell detection, risk-gated plan, atomic apply/revert
- **Milestone Decomposer** (v100): Auto-splits milestones >1500 LOC
- **Execution Graph** (v96): Runtime call flow tracking
- **Impact Analyzer** (v96): Caller analysis, risk scoring
- **Test Coverage Explorer** (v96): Coverage gap analysis
- **Multi-Agent Pipeline** (v100): 5-role pipeline (planner→builder→architect→critic→debugger)

### What's Missing (Gap → Roadmap Feature)
| Gap | Impact | Roadmap |
|-----|--------|---------|
| No execution loop (milestone runs once) | Can't self-correct | **F3** |
| Repair instructions are text, not composable patches | Can't validate/revert fixes | **F1** |
| Error parsing extracts summaries, not root causes | Fixes target symptoms, not causes | **F2** |
| No cost-benefit context ranking | Wastes tokens on irrelevant files | **F4** |
| No cross-turn context tracking | Repeats work, loses state between iterations | **F5** |
| Critic classifies but doesn't reason | No root-cause analysis | **F6** |
| Graph exists but no query/debug UX | Developer can't inspect decisions | **F7** |
| Pattern detection is immediate-turn only | No cross-milestone learning | **F8** |

---

## Roadmap: F1–F8 (Core Agent Evolution)

### Dependency Graph

```
F1 (Patch Engine) ──┐
                     ├──→ F3 (Execution Loop) ──→ F5 (Task Memory)
F2 (Error Parsers) ──┘         │                       │
                               ├──→ F4 (Context Opt.)  │
                               │                       │
                               └──→ F6 (Self-Critique) ┘
                                         │
                              F7 (Graph Debug) ←──── F8 (Pattern Mining)
```

**Critical path**: F1 + F2 → F3 → (F4, F5, F6) → (F7, F8)

F1 and F2 are independent prerequisites. F3 is the linchpin — everything after it is enhancement.

---

## F1: Patch Engine

**Goal**: Replace text-based repair instructions with structured, composable, revertible patches.

**Why first**: The execution loop (F3) needs to apply fixes incrementally. Without structured patches, every retry regenerates the entire file — wasteful, error-prone, and context-destroying. Problems with full-file writes: LLM changes unrelated code, formatting breaks, merge conflicts, large diffs = worse debugging.

### Architecture

```
src/patch/
    patch-engine.js      — main API (~80 LOC)
    patch-parser.js       — LLM output → Patch ADT (~100 LOC)
    patch-validator.js    — pre-apply checks (~80 LOC)
    patch-applier.js      — apply/revert/compose (~120 LOC)
```

**Total: ~380 LOC**

### Patch ADT

```javascript
{
  file: string,              // relative to project root
  regions: [{
    anchor: string,          // semantic anchor: "function login(", "class UserService"
    anchorType: 'function' | 'class' | 'method' | 'import' | 'line' | 'insert_after',
    contextBefore: string,   // lines before region (for disambiguation)
    old: string[],           // lines to remove (empty = pure insert)
    new: string[],           // lines to add
  }],
  metadata: {
    type: 'fix' | 'feature' | 'refactor',
    confidence: number,      // 0-1, from LLM or heuristic
    description: string,     // human-readable summary
    milestone: string,       // milestone ID for tracking
  }
}
```

### Three Operation Types

The patch engine supports 3 region operations:

| Operation | `anchorType` | Description |
|-----------|------------|-------------|
| **Modify** | `function`, `class`, `method`, `line` | Replace existing code region |
| **Insert** | `insert_after` | Add new code after anchor point |
| **Delete** | any | `new` array is empty → removes matched region |

### Semantic Anchors (NOT Line Numbers)

**Critical design decision**: Anchors are semantic, not positional. After iteration 1, line numbers shift. Semantic anchors survive edits.

```
@@ function login(user, password)     ← semantic anchor
- return db.find(user)
+ if (!user) throw new Error("Missing user")
+ return db.find(user)
```

**Anchor fallback strategy** (3-tier):
```javascript
function findAnchor(content, anchor) {
  // 1. Exact match
  const exactIdx = content.indexOf(anchor);
  if (exactIdx >= 0) return exactIdx;

  // 2. Normalized match (collapse whitespace)
  const normalized = anchor.replace(/\s+/g, ' ').trim();
  const normalizedContent = content.replace(/\s+/g, ' ');
  const normIdx = normalizedContent.indexOf(normalized);
  if (normIdx >= 0) return content.indexOf(content.split('\n').find(l =>
    l.replace(/\s+/g, ' ').trim().includes(normalized)));

  // 3. AST-assisted lookup (uses existing ast-analyzer.js)
  // e.g., "function login" → astAnalyzer.findFunction("login") → exact line
  return -1; // anchor not found → patch rejected
}
```

**Context window anchors**: Each region includes `contextBefore` — lines immediately preceding the region. This disambiguates when the same anchor appears multiple times (e.g., overloaded methods).

### Module Breakdown

**`patch-parser.js`** — LLM output → Patch ADT:
- Parse ```diff blocks from LLM output
- Parse custom `@@ anchor` format
- **Fallback**: If LLM outputs full file content instead of diff, compute diff via simple line comparison against original
- Normalize: trim whitespace, normalize line endings
- **Deterministic**: No LLM calls inside parser

**`patch-validator.js`** — Pre-apply checks:
- File exists (`fs.existsSync`)
- Anchor found in content (3-tier fallback)
- Old lines match (prevent stale patch)
- Patch size guard: max 300 lines changed, max 5 files (prevents LLM runaway)
- Syntax validation: post-apply `parseAST()` via existing `ast-analyzer.js` (tree-sitter, JS/Python/Go/Java). Unsupported languages: skip AST check.
- Conflict detection: overlapping regions within same file

**`patch-applier.js`** — Apply/revert/compose:
- `applyPatch(patch, fileContent)` → new content
- `revertPatch(patch, modifiedContent)` → original content
- `composePatchSet(patches[])` → merge patches for same file, detect conflicts
- **Atomic write**: write to tmp file → rename (prevents corruption on crash)
- **Backup**: save original content before apply (enables rollback in execution loop)

**`patch-engine.js`** — Main API:
```javascript
export function applyPatch(patch) {
  const parsed = parsePatch(patch);
  const validation = validatePatch(parsed);
  if (!validation.valid) return { success: false, errors: validation.errors };
  const result = apply(parsed);
  return { success: true, result, metrics: computeMetrics(parsed) };
}

export function previewPatch(patch) { /* dry-run, no write */ }
export function rollbackPatch()     { /* restore from backup */ }
export function validatePatch(patch) { /* checks only */ }
```

### Patch Metrics

Every applied patch logs:
- `linesChanged`, `filesChanged`
- `anchorsResolved` (exact/normalized/ast)
- `syntaxValid` (post-apply AST check result)
- `success` / `failure` reason

These feed into task memory (F5) and strategy learning (F8).

### LLM Prompt Strategy

Don't ask the LLM to generate the full patch ADT — that's fragile. Instead:
1. Ask LLM to output changes as ```diff blocks with file paths and semantic anchors
2. `parsePatch()` extracts regions from the diff output
3. Fallback: if LLM outputs full file content instead of diff, compute diff ourselves

**Latency impact**: Zero — patch parsing is post-processing on existing LLM output.

### Integration Points
- `critic-agent.js`: `generateRepairRequest()` outputs `Patch[]` instead of text instructions
- `lifecycle-build.js`: `executeMilestone()` applies patches from critic, validates, reverts on failure
- Architecture Guardian: patch metrics (files changed, public API touched) → risk scoring

---

## F2: Runtime Parsers + Error Normalization

**Goal**: Transform raw build/test output into structured error objects with root-cause classification.

**Why before F3**: The execution loop needs to know WHAT failed and WHY, not just "tests failed."

### Architecture

```
src/planner/error-normalizer.js    (~200 LOC)
```

### Normalized Error

```javascript
{
  code: string,               // normalized: MISSING_PROPERTY, TYPE_MISMATCH, IMPORT_NOT_FOUND, ...
  file: string,               // file path
  line: number | null,        // line number (null if unknown)
  symbol: string | null,      // symbol name if extractable
  message: string,            // original error message
  raw: string,                // original full output line
  category: 'compile' | 'runtime' | 'test' | 'lint',
  recoverable: boolean,       // heuristic: can this be fixed by code change?
  derivedFrom: string | null, // root cause error code (cascade detection)
}
```

### Error Normalization Map (~30 entries)

| Raw Pattern | Normalized Code | Category |
|-------------|----------------|----------|
| `TS2339: Property '...' does not exist` | `MISSING_PROPERTY` | compile |
| `TypeError: Cannot read properties of undefined` | `NULL_REFERENCE` | runtime |
| `ReferenceError: ... is not defined` | `UNDEFINED_VARIABLE` | runtime |
| `SyntaxError: Unexpected token` | `SYNTAX_ERROR` | compile |
| `Module not found: Can't resolve` | `IMPORT_NOT_FOUND` | compile |
| `AssertionError: expected ... to equal` | `ASSERTION_FAILED` | test |
| `TypeError: ... is not a function` | `TYPE_MISMATCH` | runtime |
| `ENOENT: no such file or directory` | `FILE_NOT_FOUND` | runtime |
| `IndentationError` (Python) | `SYNTAX_ERROR` | compile |
| `undefined: ...` (Go) | `UNDEFINED_VARIABLE` | compile |
| `cannot find symbol` (Java) | `MISSING_PROPERTY` | compile |
| `unused import` (ESLint/Go) | `UNUSED_IMPORT` | lint |

### Key Functions

| Function | Description |
|----------|-------------|
| `normalizeErrors(rawOutput, language)` | Parse raw output → `NormalizedError[]` |
| `deduplicateErrors(errors)` | Remove duplicates (same code+file+line) |
| `classifyRecoverability(error)` | Heuristic: can LLM fix this? |
| `findRootCause(errors)` | Cascade detection: one error causes many downstream |
| `formatErrorsForLLM(errors)` | Compact representation for prompt context |

### Root Cause Detection

Errors cascade. If `IMPORT_NOT_FOUND` for module X, then all `UNDEFINED_VARIABLE` referencing symbols from X are downstream effects. `findRootCause()` identifies the earliest error in the dependency chain and marks downstream errors as `{ derivedFrom: rootError.code }`.

This is critical for the execution loop: fixing the root cause may resolve 5+ downstream errors in one patch.

### Integration
- Extends existing `runtime-feedback.js` `parseTestOutput()` / `parseBuildOutput()` with normalization layer
- Critic agent receives `NormalizedError[]` instead of raw text → more targeted repairs
- Execution loop (F3) uses normalized errors for convergence detection

**Latency impact**: ~1ms per parse (regex only, no LLM). Runs on existing test/build output.

---

## F3: Execution Loop

**Goal**: Iterative fix cycle — generate → test → diagnose → patch → test → ... until convergence or budget exhaustion.

**Why central**: This is the single biggest capability gap between C3 and production agent systems. Everything else is enhancement.

### Architecture

```
src/planner/execution-loop.js    (~350 LOC)
```

### Pipeline

```
plan patch (LLM)
    ↓
validate patch (F1)
    ↓
apply patch (F1)
    ↓
run tests + build
    ↓
parse errors (F2)
    ↓
check convergence
    ↓
repeat or stop
```

### Loop Structure

```
executeMilestoneWithLoop(lifecycle, milestone)
  ├── iteration 0: generate code (existing executeMilestone flow)
  ├── run tests + build
  ├── if PASS → done
  ├── normalize errors (F2)
  ├── iteration 1..N:
  │     ├── build iteration context:
  │     │     ├── normalized errors from last iteration
  │     │     ├── previous patches (what was already tried)
  │     │     ├── git diff (repo awareness)
  │     │     └── task memory hints (F5, if available)
  │     ├── generate fix patch (LLM → F1 parser)
  │     ├── validate patch (F1 validator)
  │     ├── apply patch (F1 applier, with backup)
  │     ├── run tests + build
  │     ├── check convergence:
  │     │     ├── PASS → done
  │     │     ├── same errors as last iteration → stop (not converging)
  │     │     ├── error count increasing → rollback + stop (diverging)
  │     │     └── new errors, count decreasing → continue
  │     └── update iteration memory
  └── final: checkpoint (existing flow, with iteration report)
```

### Key Design Decisions

1. **Max iterations**: Configurable via `C3_MAX_LOOP_ITERATIONS`, default 8. At ~60s per LLM call, this is ~8 minutes worst case.

2. **Convergence detection** (the critical innovation):
   ```javascript
   function shouldContinue(currentErrors, previousErrors, iteration, maxIter) {
     if (iteration >= maxIter) return { continue: false, reason: 'budget_exhausted' };
     if (currentErrors.length === 0) return { continue: false, reason: 'all_passed' };

     // Same errors as last iteration → not converging
     const sameErrors = currentErrors.every(e =>
       previousErrors.some(p => p.code === e.code && p.file === e.file && p.line === e.line)
     );
     if (sameErrors) return { continue: false, reason: 'not_converging' };

     // Error count increasing → diverging
     if (currentErrors.length > previousErrors.length * 1.5) {
       return { continue: false, reason: 'diverging' };
     }

     return { continue: true, reason: 'errors_decreasing' };
   }
   ```

3. **Iteration memory** (volatile, per-loop):
   ```javascript
   {
     iteration: number,
     patchesApplied: Patch[],         // all patches so far
     errorHistory: NormalizedError[][], // errors per iteration
     filesModified: Set<string>,       // touched files
     strategiesUsed: string[],         // what was tried
   }
   ```
   Discarded after the loop ends. NOT the persistent task memory (F5).

4. **Rollback strategy**: If iteration N makes things worse (error count > N-1), revert patch N via F1 rollback and try alternative strategy via critic agent. Max 1 rollback per iteration.

5. **Git context injection** (repo awareness): Each iteration includes `git diff --cached` output in the LLM prompt. Agent sees exactly what has changed since the start. ~30 LOC, high ROI.

6. **Test staging** (optimization, not MVP):
   - Iteration 0: run all tests
   - Iteration 1+: run only tests for modified files (if framework supports `--filter`)
   - Final iteration: run all tests (confirmation)

### Milestone Execution Flow (Updated)

```
Before (v102):
  plan → generate → checkpoint → PASS/FAIL

After (F3):
  plan → generate → test
    → PASS: checkpoint → done
    → FAIL: normalize errors → patch → test → ...
      → converged: checkpoint → done
      → exhausted: checkpoint (with iteration report) → BLOCKED
```

### Latency Budget

| Step | Time |
|------|------|
| LLM generation | ~60s (qwen3.5:27b) |
| Test run | ~5-30s (project dependent) |
| Patch parse + validate | ~10ms |
| Error normalize | ~1ms |
| **Per iteration** | **~65-95s** |
| **8 iterations worst case** | **~8-13 min** |
| **Typical (2-3 iterations)** | **~2-5 min** |

### Integration
- `lifecycle-build.js`: `executeMilestone()` calls `executeMilestoneWithLoop()` instead of direct workflow
- `buildMilestoneRequest()`: receives iteration context (errors, patches, git diff)
- `milestoneCheckpoint()`: runs after loop ends (success or exhaustion), includes iteration report
- Config: `C3_MAX_LOOP_ITERATIONS=8` in `.env`

---

## F4: Context Optimizer + Signature Map

**Goal**: Maximize information density per token in LLM context. Build compact API maps for cluster-aware code generation.

**Why after F3**: Context quality only matters when we have multiple iterations. One-shot generation can't benefit from budget optimization.

### Architecture

```
src/code-intel/context-optimizer.js    (~200 LOC)  — cost-benefit ranking
src/code-intel/signature-map.js        (~150 LOC)  — compact API map extraction
```

### 4A: Context Optimizer

**Core idea**: Not all files are equally useful per token. A 500-line utility with 2 relevant functions wastes 480 lines of context. Rank files by `relevance / tokenCost`.

**Cost-benefit matrix**:
```javascript
function rankFilesByValue(files, query, budget) {
  return files
    .map(f => ({
      ...f,
      relevance: computeRelevance(f, query),     // 0-1, from search score + graph distance
      tokenCost: estimateTokens(f.content),       // existing function
      value: computeRelevance(f, query) / Math.max(1, estimateTokens(f.content) / 100),
    }))
    .sort((a, b) => b.value - a.value);
}
```

**Token budget allocation** (example for 6K token budget):
```
summary:    500 tokens
signatures: 400 tokens
cluster:    2000 tokens
seed files: 3000 tokens
```

**Budget forecasting**: Before adding a file to context, check if remaining budget allows full source. If not, switch to signature-only representation (F4B).

**Redundancy detection**: If file A imports and re-exports all of file B, including both wastes tokens. Detect via KG IMPORTS edges + symbol overlap.

### 4B: Signature Map

**Core idea**: For files outside the immediate edit scope but in the dependency cluster, include only their API signatures — not full source.

**Signature extraction** (uses existing AST analyzer):
```javascript
async function buildSignatureMap(files, projectPath) {
  const signatures = [];
  for (const filePath of files) {
    const content = await readFile(path.join(projectPath, filePath), 'utf-8');
    const { tree, supported } = await parseAST(content, extToLanguage(path.extname(filePath)));

    if (supported && tree) {
      // AST path: precise extraction via existing extractSymbols()
      const symbols = extractSymbols(tree, language, filePath);
      signatures.push({
        file: filePath,
        exports: symbols.filter(s => s.exported).map(s => formatSignature(s)),
      });
    } else {
      // Regex fallback: extract export lines
      const exportLines = content.split('\n')
        .filter(l => /^export\s+(function|class|const|let|var|interface|type|enum)\s/.test(l.trim()))
        .map(l => l.trim());
      signatures.push({ file: filePath, exports: exportLines });
    }
  }
  return signatures;
}
```

**Output format** (injected into LLM prompt):
```
## API Signatures (dependency context — DO NOT modify these files)

### src/service.js
- export function processOrder(orderId, items): Promise<Order>
- export function cancelOrder(orderId): Promise<void>
- export class OrderValidator { validate(order): ValidationResult }

### src/util.js
- export function formatDate(date, locale?): string
- export function parseAmount(raw): number
```

**Token savings**: 300-line file → ~5-10 signature lines = 30x compression. 10-file cluster with 3 seed files: 3 full source + 7 signatures ≈ same tokens as 4 files full source, but 10 files of API awareness.

### 4C: Cluster Wiring

Wire existing `expandWithGraph()` into the execution loop context builder (~50 LOC glue code):

```javascript
const seedFiles = milestone.scope_files;
const clusterFiles = expandWithGraph(graph, seedFiles, { maxFiles: 10, maxDepth: 2 });
const signatureOnlyFiles = clusterFiles.filter(f => !seedFiles.includes(f));

const context = [
  buildCodeContext(seedFiles, ...),             // existing — full source
  buildSignatureMap(signatureOnlyFiles, ...),    // new (F4B) — signatures only
];
```

---

## F5: Task Memory

**Goal**: Persistent memory across iterations AND across milestones. Remember what was tried, what worked, what failed.

**Why after F3+F4**: Memory is only useful when there are multiple iterations generating state to remember.

### Architecture

```
src/memory/task-memory.js    (~200 LOC)
```

### Two Layers

| Layer | Scope | Lifetime | Storage |
|-------|-------|----------|---------|
| **Iteration memory** | Within one execution loop | Discarded after loop ends | In-memory object |
| **Task memory** | Across milestones within a project | Persistent, decays | SQLite (existing DB) |

**Iteration memory** (designed in F3): Patches applied, errors per iteration, files modified, strategies used. Reset on each new milestone.

**Task memory** (new):
```javascript
{
  projectId: string,
  entries: [{
    kind: 'error_pattern' | 'fix_strategy' | 'file_note' | 'architecture_decision',
    key: string,          // e.g., "IMPORT_NOT_FOUND:src/service.js"
    value: string,        // "Fixed by adding missing export in index.js"
    confidence: number,   // 0-1, decays over time (half-life ~69 days, same as LTM)
    milestone: string,    // which milestone created this
    created: number,
    accessCount: number,
  }]
}
```

### Key Operations

| Function | Description |
|----------|-------------|
| `recordFix(error, patch, success)` | After fix attempt: record what was tried and whether it worked |
| `queryRelevant(errors, files)` | Before fix attempt: retrieve relevant past experiences |
| `recordArchDecision(decision)` | Architecture choices that affect future milestones |
| `prune()` | Remove low-confidence entries (same decay as LTM) |

### Integration with F3

At the start of each iteration, the loop queries task memory:
```javascript
const pastExperience = taskMemory.queryRelevant(currentErrors, modifiedFiles);
// Inject into LLM prompt: "In previous milestones, similar errors were fixed by: ..."
```

### DB Schema (new migration)

```sql
CREATE TABLE task_memory (
  id INTEGER PRIMARY KEY,
  project_id TEXT NOT NULL,
  kind TEXT NOT NULL,
  key TEXT NOT NULL,
  value TEXT NOT NULL,
  confidence REAL DEFAULT 0.8,
  milestone_id TEXT,
  created_at INTEGER,
  last_accessed_at INTEGER,
  access_count INTEGER DEFAULT 0,
  UNIQUE(project_id, kind, key)
);
```

---

## F6: Self-Critique + Signature-First Patching

**Goal**: Before generating a fix, reason about WHY the error occurred and WHAT the fix should change at the API level. Then implement.

**Why after F3+F5**: Self-critique needs iteration history (F3) and past experience (F5) to be effective.

### Architecture

```
src/planner/self-critique.js    (~200 LOC)
```

### 6A: LLM-Driven Root Cause Analysis

Current critic agent classifies failures deterministically (regex → category). This works for simple cases but fails for logic errors, API misuse, and multi-file bugs.

**New approach**: After normalizing errors (F2), ask the LLM:
```
Given these errors:
  1. MISSING_PROPERTY: src/controller.js:45 — Property 'validate' does not exist on type 'OrderService'
  2. TYPE_MISMATCH: src/controller.js:52 — Argument of type 'string' is not assignable to 'number'

And these file signatures:
  src/service.js: export class OrderService { processOrder(id, items), cancelOrder(id) }

What is the ROOT CAUSE? What specific changes are needed?
Respond as:
1. Root cause: <one sentence>
2. Fix plan: <list of specific signature-level changes>
```

**Token cost**: ~500 tokens input + ~200 tokens output. At qwen3.5:27b: ~10s. Worthwhile for complex errors.

**When to use**: Only when errors persist after 1st fix attempt (iteration >= 2). First iteration uses deterministic critic (fast, no LLM call).

### 6B: Signature-First Patching

**Two-step generation** — plan at API level, then implement:

**Step 1 — Patch Plan** (fast, ~200 output tokens):
```
modify validateToken()
reason: missing null check

src/service.js: ADD method validate(order): ValidationResult
src/controller.js: MODIFY handleRequest() to call service.validate()
```

**Step 2 — Implementation** (full generation, guided by plan):
```
Implement these changes: [plan from step 1]
Current file content: [full source of modified files]
API context: [signature map of dependency cluster]
```

**Why two steps**:
- Step 1 catches hallucinated APIs early (plan references non-existent function → caught before generation)
- Step 2 has clear specification → more focused generation → fewer errors
- Plan can be validated against KG (does `OrderService` exist? Does it have `processOrder`?)

**Plan validation** (uses existing KG + symbol index):
```javascript
function validatePlan(planSteps, graph, index) {
  const issues = [];
  for (const step of planSteps) {
    if (step.action === 'MODIFY') {
      const symbols = index.findByName(step.symbol);
      if (symbols.length === 0) issues.push(`Symbol "${step.symbol}" not found`);
    }
    if (step.action === 'ADD' && step.file) {
      if (!graph.getNode(fileNodeId(step.file))) issues.push(`File "${step.file}" not in graph`);
    }
  }
  return issues;
}
```

**Latency**: Step 1 ~15s + Step 2 ~60s = ~75s total. Only ~15s more than single-step. High ROI.

**When to use**: Always for iteration >= 1 (fix iterations). Iteration 0 (initial generation) uses single-step for speed.

---

## F7: Graph Debugging

**Goal**: Let developers inspect C3's decision-making via structured graph queries.

**Why late**: Developer experience feature. Doesn't improve generation quality.

### Architecture

```
src/code-intel/graph-query.js    (~200 LOC)
```

### Query API

| Function | Description | Example |
|----------|-------------|---------|
| `findPath(from, to)` | Shortest path between nodes | "Why does service.js affect controller.js?" |
| `getImpactRadius(nodeId, depth)` | All nodes within N hops | "What files are affected?" |
| `detectCycles()` | Find circular dependencies | "Are there import cycles?" |
| `computeMetrics(nodeId)` | Fan-in, fan-out, betweenness | "How central is this file?" |
| `explainContext(files)` | Why these files were selected | Debug context builder decisions |
| `exportMermaid(subgraph)` | Export as Mermaid diagram | Visual debugging |

**Integration**: REST endpoint `/api/code-intel/query`. IDE can display results in agent panel.

---

## F8: Pattern Mining

**Goal**: Discover recurring patterns across milestones. Learn from experience.

**Why last**: Requires data from many iterations (F3) and task memory (F5) to have enough signal.

### Architecture

```
src/code-intel/pattern-miner.js    (~250 LOC)
```

### Pattern Types

| Pattern | Detection | Actionable Output |
|---------|-----------|-------------------|
| **Error cascade** | Same root cause → same downstream errors | Pre-emptive fix suggestion |
| **Fix archetype** | Same error code → same fix strategy works | Skip analysis, apply known fix |
| **File coupling** | Files A and B always modified together | Suggest B when A is in scope |
| **Architecture drift** | Pattern violations increasing | Warning in guardian audit |
| **Complexity hotspot** | Same files cause errors repeatedly | Suggest refactoring |

**Scoring**: Each pattern has a confidence score. Only surface patterns above threshold (0.7). Confidence decays with time (half-life ~69 days, same as LTM).

**Integration with F3**: At loop start, query for relevant archetypes:
```javascript
const archetypes = patternMiner.findArchetypes(currentErrors);
if (archetypes.length > 0) {
  iterationContext.suggestedStrategy = archetypes[0].fixStrategy;
}
```

---

## Implementation Order & Estimates

| Phase | Feature | New Files | ~LOC | Dependencies | Priority |
|-------|---------|-----------|------|-------------|----------|
| **1** | F1: Patch Engine | `patch/` (4 files) | 380 | None | CRITICAL |
| **1** | F2: Error Normalizer | `error-normalizer.js` | 200 | None | CRITICAL |
| **2** | F3: Execution Loop | `execution-loop.js` | 350 | F1, F2 | CRITICAL |
| **3** | F4: Context Optimizer | `context-optimizer.js`, `signature-map.js` | 350 | F3 | HIGH |
| **3** | F5: Task Memory | `task-memory.js` + migration | 200 | F3 | HIGH |
| **4** | F6: Self-Critique | `self-critique.js` | 200 | F3, F4, F5 | HIGH |
| **5** | F7: Graph Debug | `graph-query.js` | 200 | KG (existing) | MEDIUM |
| **5** | F8: Pattern Mining | `pattern-miner.js` | 250 | F3, F5 | MEDIUM |

**Total new code**: ~2,130 LOC across 9 files
**Total new tests**: ~200-250 tests

### Phase 1 (F1 + F2) — Foundation

Can be developed in parallel (no dependency between them).

**F1 deliverable**: `parsePatch()`, `applyPatch()`, `revertPatch()`, `composePatchSet()`, `validatePatch()`, `previewPatch()`
**F2 deliverable**: `normalizeErrors()`, `findRootCause()`, `deduplicateErrors()`, `formatErrorsForLLM()`
**Tests**: ~60 unit tests (patch operations + error normalization)

### Phase 2 (F3) — The Loop

Depends on F1 + F2. Highest-impact single feature.

**Deliverable**: `executeMilestoneWithLoop()` with convergence detection, iteration tracking, rollback, git context injection
**Integration**: Wire into `lifecycle-build.js`, add `C3_MAX_LOOP_ITERATIONS` config
**Tests**: ~40 tests (loop mechanics + convergence + rollback)

### Phase 3 (F4 + F5) — Optimization

Can be developed in parallel after F3 works.

**F4 deliverable**: `rankFilesByValue()`, `buildSignatureMap()`, cluster wiring
**F5 deliverable**: `TaskMemory` class, DB migration, query/record APIs
**Tests**: ~50 tests

### Phase 4 (F6) — Intelligence

Requires F3 + F4 + F5.

**Deliverable**: LLM root cause analysis, signature-first patching, plan validation
**Tests**: ~30 tests

### Phase 5 (F7 + F8) — Polish

Can be developed in parallel. Lowest priority.

**F7 deliverable**: Graph query API, Mermaid export, explain endpoint
**F8 deliverable**: Pattern detection, archetype matching, drift integration
**Tests**: ~40 tests

---

## Long-Term Roadmap (F9–F14)

After F1–F8 delivers the core execution agent, these extensions leverage the foundation:

### F9: Adaptive Build Strategy (v109)

Agent selects build approach based on project archetype:
- REST API → schema-first (define routes, then implement handlers)
- UI app → component-first (build components, then wire state)
- CLI tool → command-first (define commands, then add logic)

Uses existing `architecture-detector.js` (18 frameworks detected) + F8 pattern mining data.

### F10: Failure Strategy Selection (v110)

Categorize errors and select fix strategy before generating patch:
- `SYNTAX_ERROR` → re-parse, check missing brackets/commas
- `IMPORT_NOT_FOUND` → check exports, fix path
- `NULL_REFERENCE` → add null check at call site
- `ASSERTION_FAILED` → analyze test expectations vs implementation

Extends F2 error normalizer + F6 self-critique.

### F11: Autonomous Dependency Upgrades (v111)

Natural extension of F3 execution loop:
1. Run `npm update` (or equivalent)
2. Run tests
3. If failures: normalize errors (F2) → patch (F1) → iterate (F3)
4. If converged: commit

Uses existing infrastructure end-to-end. Mainly a new entry point, not new modules.

### F12: Performance Intelligence (v112)

Agent detects performance anti-patterns in generated code:
- N+1 queries (detected via AST: loop containing DB call)
- Unbounded loops (no limit/pagination)
- Missing indexes (schema analysis)

Extends AST analyzer + architecture detector.

### F13: Continuous Improvement Mode (v113)

Agent runs autonomously in background:
1. Analyze repo (existing code-intel)
2. Detect coverage gaps (existing test-coverage-explorer)
3. Generate tests for uncovered branches
4. Run and validate

Combines F3 execution loop + test-coverage-explorer + AST analyzer.

### F14: Cross-Project Learning (v114)

Pattern sharing across projects within same workspace:
- Common error patterns
- Successful fix strategies
- Architecture templates

Extends F5 task memory with cross-project query scope.

### Already Built (No New Work Needed)

These features from the second roadmap already exist in C3 v95–v102:

| Proposed Feature | Existing Module | Version |
|-----------------|----------------|---------|
| Feature Decomposition | `milestone-decomposer.js` | v100 |
| Architecture Drift Detection | `drift-detector.js` | v102 |
| Automated Refactoring | `refactor-agent.js` | v100 |
| Semantic Code Search | `query-expander.js` + `code-search.js` | v95 |
| Execution Flow Graph | `execution-graph.js` | v96 |
| Impact Simulation | `impact-analyzer.js` | v96 |
| Test Coverage Intelligence | `test-coverage-explorer.js` | v96 |
| Contract Graph | `api-contract-registry.js` | v98 |
| Project Archetype Detection | `architecture-detector.js` | v95 |
| Pattern Extraction | `architecture-detector.js` `minePatterns()` | v95 |
| Skill System | `src/skills/` (full registry + runner) | v85 |
| Multi-Agent Collaboration | `multi-agent.js` (5-role pipeline) | v100 |
| Dead Code Detection | `dead-code-detector.js` | v96 |
| Regression Prediction | `regression-predictor.js` | v100 |

---

## Constraints & Non-Goals

### Latency Budget
- Single LLM call: 30-90s (qwen3.5:27b on local GPU)
- Max loop budget: ~8-13 minutes (8 iterations)
- Acceptable total milestone time: 15 minutes (including checkpoint)
- **Rule**: No feature should add more than 1 LLM call per iteration

### What We Won't Build
- **Multi-candidate generation**: 3x latency for marginal quality gain on local models
- **AST-aware code generation**: LLM generates text, not ASTs. AST is only for validation
- **Multi-model routing**: Single GPU = one model at a time. No dynamic model selection
- **Distributed execution**: Single-machine, single-process. No worker pools
- **Parallel task execution**: Single GPU, can't run multiple LLM calls simultaneously
- **IDE-integrated debugging**: Graph debug is API-only, not visual IDE integration (yet)

### Existing Infrastructure Reuse
| Feature | Existing Module | Reuse |
|---------|----------------|-------|
| AST validation | `ast-analyzer.js` | `parseAST()` for patch validation + anchor lookup |
| Graph expansion | `graph-retrieval.js` | `expandWithGraph()` for cluster context |
| Hierarchical context | `context-builder.js` | `buildHierarchicalContext()` for module summaries |
| Symbol lookup | `symbol-index.js` | `findByName()` for plan validation |
| Architecture detection | `architecture-detector.js` | `minePatterns()` for context strategy |
| Impact analysis | `impact-analyzer.js` | Risk scoring for file prioritization |
| Drift detection | `drift-detector.js` | Architecture drift for guardian |
| Test parsing | `runtime-feedback.js` | `parseTestOutput()` as base for F2 |
| Failure classification | `critic-agent.js` | Deterministic path for iteration 0 |
| LTM decay | `long-term.js` | Confidence decay formula for task memory |

---

## Success Metrics

| Metric | Current (v103) | Target (after F1-F6) |
|--------|---------------|---------------------|
| Milestone first-pass success rate | ~30% | ~50% |
| Milestone success with retries | ~50% (3 retries, manual checkpoint) | ~80% (8 iterations, auto-fix) |
| Average iterations to pass | N/A (no loop) | 2-3 |
| Fix precision (fix targets root cause) | ~40% (text instructions) | ~70% (normalized errors + self-critique) |
| Context token efficiency | ~30% relevant | ~60% (signature map + optimizer) |
| Time to milestone completion | ~5 min (one shot) | ~5-8 min (with loop, higher success) |

---

## Version Mapping

| Version | Content | Est. LOC |
|---------|---------|----------|
| v103 | **Model Upgrade System** (qwen2.5:32b → qwen3.5:27b) | done |
| v104 | F1: Patch Engine (4 modules) + F2: Error Normalizer | ~580 |
| v105 | F3: Execution Loop + git context injection | ~350 |
| v106 | F4: Context Optimizer + Signature Map | ~350 |
| v107 | F5: Task Memory + DB migration | ~200 |
| v108 | F6: Self-Critique + Signature-First Patching | ~200 |
| v109 | F7: Graph Debug + F8: Pattern Mining | ~450 |
| v110+ | F9-F14: Long-term extensions | TBD |

Each version = one commit, tests included, docs updated.

After v105 (F3), C3 becomes an **autonomous debugging agent**.
After v108 (F6), C3 reaches **near-parity with production agent systems** on local hardware.
