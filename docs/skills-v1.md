# Skills System v85

## System Overview

The Skills system adds **controlled workflows with checkpoints** to C3 — predefined step sequences with interactive validation that guarantee results per contract. Skills handle known, repeating procedures; the Planner handles new problems.

**Design principle:** Skill = fixed skeleton (structure, format, validation, storage) + dynamic inputs (context, purpose, style). Skill controls the process; user controls the content.

**What it does:**
- Loads skill definitions from `skills/*.json` at startup (hot-reload via API)
- CRE classifies SKILL intent, then a separate SkillResolver LLM identifies which skill + parameters
- User confirms before execution (trust gating later)
- Executes steps sequentially with interactive checkpoints (ask, review, validate)
- Guarantees output quality via validation criteria

**What it does NOT do:**
- No branching, conditions, or nested skills (deterministic linear flow)
- No dynamic skill creation (future: Detector proposes new skills)
- No background execution (async within request lifecycle)
- No project-scoped skills (global only in MVP)

---

## Architecture

```
┌─────────────┐    SKILL     ┌──────────────┐     resolve     ┌────────────┐
│ User Input  │ ───intent──▸ │ CRE Decision │ ──────────────▸ │  Resolver  │
└─────────────┘              └──────────────┘                  └─────┬──────┘
                                                                     │
                                                          {skillId, params, confidence}
                                                                     │
                                                                     ▼
                                                              ┌─────────────┐
                                                              │   Runner    │
                                                              │ (state m.)  │
                                                              └──────┬──────┘
                                                                     │
                                              ┌──────────┬───────────┼───────────┬──────────┐
                                              │          │           │           │          │
                                         ┌────▼───┐ ┌───▼────┐ ┌───▼────┐ ┌───▼────┐ ┌───▼─────┐
                                         │  LLM   │ │Template│ │  Ask   │ │ Review │ │Validate │
                                         └────────┘ └────────┘ └────────┘ └────────┘ └─────────┘
                                                                    │          │
                                                              AWAITING_INPUT   │
                                                                    │          │
                                                              user responds ───┘
```

### Data Flow

1. **CRE Classification** — LLM classifier detects SKILL intent from user input. Feature guard: if skills disabled, intent downgrades to CONVERSATIONAL.

2. **Skill Resolver** (`src/skills/resolver.js`) — Separate LLM call with skill index as system prompt. Returns `{ skillId, params, confidence }`. Post-LLM validation: (1) skillId exists in registry, (2) required params present, (3) extra params stripped, (4) confidence clamped to [0,1].

3. **Confirmation** — If confidence >= 0.6, shows confirmation prompt with skill name, parameters, and step list. User responds "ano"/"ne". If confidence < 0.6, shows explicit "not sure" message.

4. **Execution** — Runner executes steps sequentially. Each step returns `{ status, output, retryable, errorType }`. Output accumulates in `stepsOutput` map, available to subsequent steps via `{{steps.X.output}}`. Interactive steps (ask, review) pause execution with `AWAITING_INPUT` state.

5. **Interactive Checkpoints** — When the runner hits an `ask` or `review` step, execution pauses. The current state (step index, accumulated outputs) is persisted to DB. User response resumes execution from the next step via `resume()`.

6. **Validation** — The `validate` step uses LLM to check output against success criteria. If validation fails, the skill FAILS — skills guarantee results per contract.

7. **Persistence** — Execution state and step results are persisted to SQLite (`skill_executions`, `skill_steps`).

---

## Skill Definition Format

Skills are defined as JSON files in `skills/` directory:

```json
{
  "id": "create-expertise",
  "version": 2,
  "description": "Vytvoří expertizu na zadané téma — s upřesněním, kontrolou a validací",
  "parameters": {
    "topic": {
      "type": "string",
      "required": true,
      "description": "Téma expertizy"
    }
  },
  "successCriteria": "Expertiza musí obsahovat: úvod, minimálně 3 sekce, příklady, závěr",
  "steps": [
    {
      "id": "clarify",
      "type": "ask",
      "prompt": "Upřesni prosím: pro koho, jaký účel, specifické požadavky?"
    },
    {
      "id": "draft",
      "type": "llm",
      "prompt": "Vytvoř expertizu na: {{topic}}. Kontext: {{steps.clarify.output}}"
    },
    {
      "id": "review",
      "type": "review",
      "content": "{{steps.draft.output}}",
      "prompt": "Zkontroluj návrh. Schválit (ano) nebo navrhnout úpravy:"
    },
    {
      "id": "refine",
      "type": "llm",
      "prompt": "Uprav expertizu podle: {{steps.review.output}}"
    },
    {
      "id": "validate",
      "type": "validate",
      "content": "{{steps.refine.output}}",
      "criteria": "Expertiza musí obsahovat: úvod, 3+ sekce, příklady, závěr"
    },
    {
      "id": "save",
      "type": "write",
      "path": "expertiza-{{topic}}.md",
      "content": "{{steps.refine.output}}"
    }
  ]
}
```

### Professional Workflow Pattern

Skills follow the pattern: **Clarify → Draft → Review → Refine → Validate → Persist**

```
ask(clarify) → llm(draft) → review(checkpoint) → llm(refine) → validate(criteria) → write(save)
     ↕                            ↕
  user input                  user approves
                              or corrects
```

### Step Types

| Type | Purpose | Interactive | Retryable | Fields |
|------|---------|-------------|-----------|--------|
| `llm` | Call LLM with substituted prompt | No | Yes (transient) | `prompt`, `systemPrompt`, `temperature`, `maxTokens`, `model` |
| `template` | Pure string substitution | No | No | `template` |
| `write` | Write content to file (sandboxed) | No | No | `path`, `content` |
| `shell` | Execute whitelisted command | No | On timeout | `command` |
| `ask` | Pause execution, show question, wait for user input | **Yes** | No | `prompt` |
| `review` | Show content for approval/correction | **Yes** | No | `content`, `prompt` |
| `validate` | Check output against criteria via LLM | No | Yes (transient) | `content`, `criteria`, `failMessage` |
| `transform` | Deterministic JSON transforms (v122) | No | No | `content` |

### Interactive Steps

**`ask`** — Pauses execution and shows a question (with substitutions). User's response becomes the step output. Use to clarify parameters, get preferences, or collect additional context.

**`review`** — Shows content from a prior step. User either approves ("ano"/"ok") → step output = reviewed content (pass-through), or provides corrections → user's text becomes step output. Subsequent steps (e.g. refine LLM) handle both cases.

**`validate`** — Non-interactive. Uses LLM to check content against criteria. Returns PASS (content passes through) or FAIL (skill fails). Enforces the skill's quality contract.

### Substitution Syntax

- `{{paramName}}` — replaced with parameter value
- `{{steps.X.output}}` — replaced with output of step with id `X`

---

## Step I/O Contract

Every step executor returns:

```javascript
{
  status: 'success' | 'error' | 'awaiting_input',
  output: any,              // string content or file path (null for awaiting_input)
  retryable: boolean,       // can this step be retried?
  errorType: 'transient' | 'validation' | 'security' | null,
  errorMessage?: string,    // human-readable error
  // Interactive steps also return:
  prompt?: string,          // question or instruction for user
  content?: string,         // content being reviewed (review step)
}
```

**Retry policy:**
- Only retries if `retryable === true AND errorType === 'transient'`
- Max 2 retries with linear backoff (1s, 2s)
- Never retries `validation` or `security` errors
- Interactive steps (`awaiting_input`) are never retried

---

## State Machine

```
IDLE ──prepare()──▸ CONFIRMING ──confirm()──▸ EXECUTING ──done──▸ DONE
                         │                     │      ↑
                      cancel()           ask/review   resume()
                         │                     │      │
                         ▼                     ▼      │
                     CANCELLED           AWAITING_INPUT
                                               │
                                            cancel()
                                               │
                                               ▼
                                           CANCELLED

                    EXECUTING ──error──▸ FAILED
```

### Resume Mechanism

When execution hits an interactive step (ask/review):
1. Runner saves current state (step index, stepsOutput) to DB
2. State transitions to `AWAITING_INPUT`
3. Handler returns prompt/content to user
4. User responds → handler calls `resume(executionId, userInput)`
5. Runner loads state from DB, processes user input as step output
6. Execution continues from the next step
7. May hit another interactive step → repeat from step 1

---

## Safety Mechanisms

### 1. Feature Flag

```bash
C3_ENABLE_SKILLS=false  # disable skills (default: ON)
```

Also available as IDE toggle: Settings > Features > Skills.

### 2. Runtime Hot-Toggle (FeatureManager)

Skills can be toggled on/off at runtime from IDE Settings without server restart:

```
IDE Settings UI ──onPreferenceChanged──▸ WebSocket sync_settings
                                              │
                                              ▼
                                     FeatureManager.set('skills', false)
                                              │
                                              ▼
                                     CRE Guard: SKILL → CONVERSATIONAL
```

### 3. Confirmation Before Execution

Every skill execution requires user confirmation. Low confidence (< 0.6) shows explicit uncertainty message.

### 4. Interactive Checkpoints

Users can review and correct generated content at `review` steps. Users can cancel execution at any interactive checkpoint.

### 5. Validation Gate

The `validate` step type checks output against success criteria via LLM before proceeding. Failed validation = skill failure. This guarantees output quality per the skill's contract.

### 6. Write Step Containment

- Rejects absolute paths and path traversal (`..`)
- `path.resolve()` + containment check (must be within workspace)
- Post-write `fs.realpath()` — detects symlink escapes, deletes file if violated
- Security violations: `{ errorType: 'security', retryable: false }`

### 7. Shell Step Whitelist

Only whitelisted commands can execute:

```javascript
const ALLOWED_COMMANDS = new Set([
  'dot', 'plantuml', 'mermaid', 'npx', 'node',
  'cat', 'ls', 'wc', 'head', 'tail', 'echo',
]);
```

- 30 second timeout
- Sandboxed to workspace `cwd`
- Blocked commands: `{ errorType: 'security', retryable: false }`

### 8. Resolver Post-Validation

LLM output is validated before execution:
1. `skillId` must exist in registry
2. All required parameters must be present
3. Extra parameters are stripped
4. Confidence clamped to [0, 1]

### 9. Registry Graceful Empty Load

If `skills/` directory doesn't exist, registry is empty (no crash). SKILL intent falls through to ANSWER.

---

## API Endpoints

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/api/skills` | List all registered skills |
| `GET` | `/api/skills/:id` | Get skill definition |
| `POST` | `/api/skills/reload` | Hot-reload skill definitions from disk |
| `GET` | `/api/skills/executions/:id` | Execution status + steps |
| `POST` | `/api/skills/executions/:id/confirm` | Confirm & execute |
| `POST` | `/api/skills/executions/:id/resume` | Resume AWAITING_INPUT execution |
| `POST` | `/api/skills/executions/:id/cancel` | Cancel pending/awaiting execution |

---

## Database Schema

### `skill_executions`

| Column | Type | Description |
|--------|------|-------------|
| `id` | TEXT PK | Execution ID (`exec-{timestamp}-{random}`) |
| `skill_id` | TEXT | Skill definition ID |
| `skill_version` | INTEGER | Skill version at execution time |
| `state` | TEXT | `IDLE`, `CONFIRMING`, `EXECUTING`, `AWAITING_INPUT`, `DONE`, `FAILED`, `CANCELLED` |
| `input` | TEXT | Original user input |
| `params` | TEXT | JSON parameters |
| `steps_output` | TEXT | JSON accumulated step outputs |
| `confidence` | REAL | Resolver confidence |
| `current_step_id` | TEXT | Currently executing or awaiting step |
| `error_message` | TEXT | Error description (if FAILED) |
| `session_id` | TEXT | Session ID |
| `conversation_id` | TEXT | Conversation ID |
| `locked_at` | DATETIME | For future lock mechanism |
| `started_at` | DATETIME | Execution start time |
| `confirmed_at` | DATETIME | User confirmation time |
| `completed_at` | DATETIME | Completion time |
| `created_at` | DATETIME | Row creation time |

### `skill_steps`

| Column | Type | Description |
|--------|------|-------------|
| `id` | INTEGER PK | Auto-increment |
| `execution_id` | TEXT FK | References `skill_executions.id` |
| `step_id` | TEXT | Step ID from definition |
| `step_type` | TEXT | `llm`, `template`, `write`, `shell`, `ask`, `review`, `validate` |
| `status` | TEXT | `success`, `error`, or `awaiting_input` |
| `error_type` | TEXT | `transient`, `validation`, `security`, or null |
| `output` | TEXT | Step output content |
| `output_hash` | TEXT | SHA-256 prefix (16 chars) for telemetry |
| `retryable` | INTEGER | 0 or 1 |
| `retry_count` | INTEGER | Number of retries attempted |
| `duration_ms` | INTEGER | Step execution time |
| `error_message` | TEXT | Error description |
| `created_at` | DATETIME | Row creation time |

---

## Configuration

| Setting | Default | Description |
|---------|---------|-------------|
| `C3_ENABLE_SKILLS` env var | `true` (ON) | Enable/disable skills system |
| `c3.features.skills` IDE pref | `true` | IDE Settings toggle (hot-toggle via FeatureManager) |
| Confidence threshold | `0.6` | Below this: explicit "not sure" message |
| Shell timeout | `30s` | Max execution time for shell steps |
| Max retries | `2` | Retry count for transient step failures |

---

## Files

| File | Purpose |
|------|---------|
| `src/db/migrations/2026_02_26_020_v85_skills.js` | Schema: 2 tables |
| `src/db/database.js` | Repositories: skillExecutions, skillSteps |
| `src/config.js` | Feature flag |
| `src/core/feature-manager.js` | Runtime feature hot-toggle singleton |
| `src/skills/registry.js` | Skill definition loader + validator + hot-reload |
| `src/skills/resolver.js` | LLM-based skill identification |
| `src/skills/runner.js` | State machine + step execution + resume |
| `src/skills/steps/substitute.js` | `{{placeholder}}` substitution |
| `src/skills/steps/template.js` | Template step executor |
| `src/skills/steps/llm.js` | LLM step executor |
| `src/skills/steps/write.js` | Write step executor (sandboxed) |
| `src/skills/steps/shell.js` | Shell step executor (whitelisted) |
| `src/skills/steps/ask.js` | Ask step executor (interactive) |
| `src/skills/steps/review.js` | Review step executor (interactive) |
| `src/skills/steps/validate.js` | Validate step executor (LLM criteria check) |
| `src/chat/cre-decision.js` | SKILL intent/decision + CRE guard |
| `src/chat/handlers/skill.js` | Skill handler (resolve, confirm, execute, resume) |
| `src/chat/handlers/conversation.js` | Handler dispatch + confirmation/resume intercept |
| `src/routes/skills.js` | REST API endpoints (incl. reload, resume) |
| `src/server.js` | Registry init + route mount |
| `src/ws-bridge/session-adapter.js` | WebSocket sync_settings control action |
| `src/routes/misc.js` | POST /api/settings → FeatureManager sync |
| `src/llm/auth-types.js` | SKILL_EXECUTOR + SKILL_RESOLVER roles |
| `skills/create-expertise.json` | Example skill (v2: interactive) |
| `skills/create-skill.json` | Meta-skill: creates new skill definitions |
| `src/skills/detector.js` | Workflow pattern detection + skill proposals |
| `src/db/migrations/2026_02_27_022_v85_workflow_patterns.js` | Pattern tracking table |
| `c3-ide/extensions/c3-settings/` | IDE Settings UI toggle |
| `c3-ide/extensions/c3-chat-panel/lib/browser/ws-client.js` | WebSocket syncSettings |
| `docs/skills-v1.md` | This documentation |

---

## Skill Detector (Autodetekce)

The detector tracks repeating workflow patterns and proposes creating skills.

### How It Works

```
Turn N: SEARCH decision → recorded
Turn N+1: CREATIVE decision → recorded → sequence "SEARCH → CREATIVE" stored
Turn N+2: (different session, same pattern) → count++
...
count >= 3 → "Všiml jsem si, že opakovaně používáš postup: SEARCH → CREATIVE. Mám z toho vytvořit skill?"
```

### Rules

- Minimum 2 different decision types in sequence
- Minimum 3 occurrences within 7 days
- After proposing, counter resets (no nagging)
- Only productive decision types tracked (not ANSWER, CONVERSATIONAL, GREETING)
- User must confirm — no automatic skill creation

### Flow

1. **Detection**: `recordDecision()` called after each CRE decision in conversation handler
2. **Proposal**: `checkForProposal()` checked before each turn in skill handler
3. **User confirms**: auto-launches `create-skill` meta-skill with pattern context
4. **User declines**: counter resets, pattern won't be proposed again until it recurs

### DB Table: `workflow_patterns`

| Column | Type | Description |
|--------|------|-------------|
| `pattern_hash` | TEXT PK | SHA-256 prefix of tool sequence |
| `tool_sequence` | TEXT | Human-readable sequence (e.g., "SEARCH → CREATIVE → WRITE") |
| `count` | INTEGER | Number of occurrences |
| `last_seen` | DATETIME | Most recent occurrence |
| `proposed` | INTEGER | 1 if already proposed |
| `session_ids` | TEXT | Comma-separated session IDs (last 10) |
| `created_at` | DATETIME | Row creation time |

### Meta-skill: create-skill

When the user accepts a proposal (or manually triggers "create-skill"), the meta-skill runs:

```
ask(clarify) → llm(generate JSON) → review(checkpoint) → llm(refine) → validate(schema) → write(save) → template(done)
```

After completion, the registry auto-reloads to include the new skill.

---

## Responsibility Split

| Skill controls (fixed) | User controls (dynamic) |
|------------------------|------------------------|
| Structure, format, sections | Context, purpose, audience |
| Validation criteria | Style preferences, depth |
| Storage conventions | Specific constraints |
| Step sequence, checkpoints | Corrections at review |
| Security (sandbox, whitelist) | Content decisions |

---

## Future Candidates

- **Project-scoped skills** — Skills specific to a project directory
- **Trust gating** — Auto-execute after N consecutive confirmations (like Autonomy trust)
- **Skill composition** — Skill referencing other skills (limited depth)
- **Skill editor** — UI for creating/editing skill definitions
- **Conditional review** — Skip review step if output passes pre-check criteria
