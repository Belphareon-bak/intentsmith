# C3 Agent — API Reference

> **v135** | 272 route definitions / 251 unique keys across 20 source files
> Generated from source code analysis. All routes are HTTP/1.1, JSON bodies (unless noted).
>
> Counted 2026-08-07 on `1fc8f03e`. The earlier figure "~200 endpoints across 15
> route modules" undercounted: besides `src/routes/*.js` (257) the same table
> also receives keys from `src/setup/wizard.js` (6), `src/notifications/trust-api.js` (5)
> and `src/server.js` (4). 21 keys are defined twice — see
> [Duplicate keys](#duplicate-keys). Full listing and the effect/auth matrix:
> [`docs/review/2026-08-07-AUTH-MATRIX.md`](review/2026-08-07-AUTH-MATRIX.md).

## Table of Contents

- [Authentication & Middleware](#authentication--middleware)
- [Common Patterns](#common-patterns)
- [Chat](#chat)
- [Conversations](#conversations)
- [Projects](#projects)
- [Expertises](#expertises)
- [Agents](#agents)
- [Skills](#skills)
- [Specialists](#specialists)
- [Marketplace](#marketplace)
- [Planner](#planner)
- [Architect](#architect)
- [Lifecycle](#lifecycle)
- [Quality](#quality)
- [Autonomy](#autonomy)
- [Notifications](#notifications)
- [System](#system) (incl. Model Validation)
- [Security](#security)
- [Settings & Features](#settings--features)
- [Setup Wizard](#setup-wizard)
- [Misc](#misc)

---

## Authentication & Middleware

### Global Middleware

| Layer | Description |
|-------|-------------|
| **Local access boundary** | `evaluateLegacyLocalAccess()` runs before routing and rejects non-loopback peer, host, origin or invalid opaque-origin capability with `403 LEGACY_LOCAL_ACCESS_REQUIRED`. IntentSmith remains loopback-only. |
| **Global auth guard** | `authorizeGlobalRequest()` runs after exact route matching and before every handler. Only `GET /`, `GET /health` and `GET /api/health` are public. Unauthenticated production requests return typed 401; an insufficient API-token scope returns typed 403. |
| CORS | `OPTIONS *` → 204 with `Access-Control-Allow-*` headers |
| Rate limit | Tiered per-IP sliding window (v125): Tier 0 exempt (OPTIONS, health, WS), Tier 1 read 600/min (GET), Tier 2 write 120/min (POST/PUT/DELETE). Disabled on localhost. Proxy: `C3_TRUST_PROXY=true` |
| Path traversal guard | Static file serving + workspace + project paths validated against root. conversationId + package ID sanitized (v126) |
| Security headers | `X-Content-Type-Options`, `X-Frame-Options`, CSP |

### Auth Mechanisms

| Credential | Mechanism |
|-------|-----------|
| Studio HTTP | Private per-process capability in `X-IntentSmith-Local-Capability`; accepted only for the exact loopback backend origin |
| Studio WS | Stejná capability v subprotocolu `c3-local-v1.*`; subject se binduje při upgradu |
| Admin/CLI | `Authorization: Bearer …` nebo `X-Admin-Token`; comparison je timing-safe |
| Vydaný API token | Bearer token ověřený přes hash, expiry a route-class scope |
| Development | Explicitní non-production loopback bypass; v production neexistuje |

### Route classes and scopes

Route key is the matched declaration, not caller input. Public keys are an
exact allowlist. Ostatní klíče mají třídu `READ`, `MUTATE`, `APPROVAL` nebo
`ADMIN`. Vydaný token potřebuje odpovídající scope (`read`, `write`, `approve`,
`admin`, `*`) nebo přesný `route:METHOD /pattern` scope. Přidání syntakticky
neklasifikovatelné route shodí startup; neznámá route nemá implicitní allow.

Produkční černá skříňka ověřuje, že `GET /api/projects` bez credentialu vrací
401 ještě před handlerem, admin i Studio capability projdou a skutečně vydaný
read-only token smí číst, ale zápis končí 403. Body nemůže tvrdit vlastní
`authenticatedSubject`; ten vkládá pouze transportní guard.

### Health and diagnostics

`GET /`, `GET /health` and `GET /api/health` use one production readiness
handler. The `misc` route factory accepts that handler as a dependency; its
legacy fallback exists only so the factory can still be tested in isolation.
Health is public and exposes only readiness booleans. Authenticated
`GET /api/system/diagnostics` adds bounded request/failure counters, recent
failure taxonomy, lifecycle-recovery state and WebSocket health. It never
stores or emits arbitrary response bodies or credential values.

The same authenticated diagnostics response includes the bounded view of the
append-only outbound audit. Production installs the global outbound guard
before optional services initialize: loopback stays local, unscoped external
requests are durably denied before transport, and model metadata discovery is
restricted to its declared read scope and exact HTTPS origins.

---

## Common Patterns

### Error Response

```json
{
  "error": "Human-readable message",
  "statusCode": 400,
  "details": "Optional detail"
}
```

Status codes: `400` (bad request), `401`/`403` (auth), `404` (not found), `409` (conflict), `500` (internal), `503` (service unavailable).

### Pagination

- `?limit=N` — Max items (defaults vary by endpoint, typically 10–100)
- `?status=active|archived|deleted|all` — State filter
- Results sorted by `created_at DESC` or `last_active DESC`

### Common Query Parameters

- `?since=ISO8601` — Time filter
- `?model=name` — Model selection
- `?detailed=true` — Verbose response

---

## Chat

### `POST /chat`

Primary chat endpoint (legacy path, used by standalone UI).

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `message` | string | ✅ | User input |
| `session_id` | string | | Session ID (auto-generated if omitted) |
| `expertise` | string | | Active expertise ID |
| `attachments` | array | | `[{name, path, type, size}]` |
| `projectId` | string | | Active project ID |

**Success (200):** `{response, mode, confidence, session_id}`

**Provider unavailable (503):**
`{error: "Model provider is temporarily unavailable.", code: "LLM_PROVIDER_UNAVAILABLE", recoverable: true}`

**Side effects:** ChatController.handle() → CRE → handler → persists to ConversationStore.
Terminal processing failures retain the user turn but do not persist an assistant turn.

### `POST /api/chat`

Primary chat endpoint (API path, used by IDE integration).

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `conversation_id` | string | ✅ | Conversation ID |
| `project_id` | string | | Project ID |
| `message` | string | ✅ | User input |
| `attachments` | array | | File attachments |
| `userId` | string | | User identifier |

**Success (200):** `{response, mode, confidence, metadata}`

**Provider unavailable (503):**
`{error: "Model provider is temporarily unavailable.", code: "LLM_PROVIDER_UNAVAILABLE", recoverable: true}`

**Side effects:** Same as `/chat`; also persists messages to conversation. Terminal
processing failures retain the user turn but do not persist an assistant turn.

### `GET /chat-ui`

Returns standalone chat HTML page.

---

### Sessions

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/api/chat/sessions/stats` | Session statistics |
| `GET` | `/api/chat/sessions` | List active sessions `→ {sessions, total}` |
| `GET` | `/api/chat/sessions/:sessionId` | Single session info `→ {exists, ...}` |
| `DELETE` | `/api/chat/sessions/:sessionId` | Remove session from memory |

### Specialists (session-scoped)

| Method | Path | Body | Description |
|--------|------|------|-------------|
| `POST` | `/api/chat/specialist` | `{sessionId, specialistId}` | Set active specialist |
| `DELETE` | `/api/chat/specialist` | `{sessionId}` | Clear active specialist |

**Side effects:** Modifies session state; affects routing in ChatController

---

## Conversations

| Method | Path | Body / Query | Response | Side Effects |
|--------|------|-------------|----------|-------------|
| `GET` | `/api/conversations` | `?limit=10&status=active` | `{conversations: []}` | — |
| `POST` | `/api/conversations` | `{project_id?, title?, welcomeMessage?}` | `{conversation}` | Creates DB record; persists welcome message |
| `GET` | `/api/conversations/:id` | — | `{conversation}` or 404 | — |
| `GET` | `/api/conversations/:id/messages` | — | `{messages: []}`; `404 {error, code: "CONVERSATION_NOT_FOUND"}` pro neexistující identitu | — |
| `PUT` | `/api/conversations/:id` | `{project_id?, title?}` | `{conversation}` | Updates metadata |
| `PATCH` | `/api/conversations/:id/archive` | — | `{success, status: 'archived'}` | Sets `state='archived'` |
| `PATCH` | `/api/conversations/:id/restore` | — | `{success, status: 'active'}` | Restores from archive |
| `DELETE` | `/api/conversations/:id` | `?hard=true` | `{success, mode}` | Soft delete (default) or hard delete |

History route čte existenci konverzace a její zprávy v jednom synchronním
SQLite snapshotu. `200 {messages: []}` proto znamená existující prázdnou
konverzaci v okamžiku snapshotu; neexistující identita vrací typovaný `404`.

### Export

| Method | Path | Body | Response |
|--------|------|------|----------|
| `POST` | `/api/export` | `{conversation_id, format?, scope?}` | `{filename, download_url, format, scope, size, turn_count}` |

### Drafts

| Method | Path | Body | Description |
|--------|------|------|-------------|
| `GET` | `/api/drafts` | `?conversation_id&project_id` | Get saved draft |
| `POST` | `/api/drafts` | `{conversation_id?, project_id?, content}` | Save draft |
| `DELETE` | `/api/drafts` | `{conversation_id?, project_id?}` | Clear draft |

### Memory

| Method | Path | Body | Description |
|--------|------|------|-------------|
| `GET` | `/api/memory` | — | Read user_memory entries |
| `POST` | `/api/memory` | `{...memory_data}` (max 100KB) | Write to user_memory (INSERT OR REPLACE) |

---

## Projects

| Method | Path | Body / Query | Response | Side Effects |
|--------|------|-------------|----------|-------------|
| `GET` | `/api/projects/defaults` | — | `{defaultDir}` | — |
| `GET` | `/api/projects` | `?limit=10&status=active` | `{projects: []}` | — |
| `POST` | `/api/projects` | `{name, description?, type?, path?, autoPath?}` | `{id, project, path, type, lifecycle, scaffold[], welcomeMessage?}` | Creates dir; git init; scaffolds files; creates DB record |
| `GET` | `/api/projects/:id` | — | `{project}` or 404 | — |
| `PUT` | `/api/projects/:id` | `{name?, path?, description?}` | `{project}` | Updates metadata |
| `GET` | `/api/projects/:id/conversations` | `?limit=10&status=active` | `{conversations: []}` | — |
| `GET` | `/api/projects/:id/lifecycle` | — | `{lifecycle}` or null | Returns active lifecycle + milestone counts |

### Lifecycle Binding

| Method | Path | Body | Response | Side Effects |
|--------|------|------|----------|-------------|
| `POST` | `/api/projects/:id/lifecycle/bind` | `{sessionId}` | `{ok, phase, lifecycleId}` | Binds session to lifecycle; sets RAM state |
| `POST` | `/api/projects/lifecycle/start` | `{projectId?, projectPath?, projectName, description?, type?, sessionId}` | Lifecycle state | Creates lifecycle record; analyzes project |

Legacy endpoints: `GET /projects`, `POST /projects` (same as `/api/` variants).

---

## Expertises

| Method | Path | Body | Response | Side Effects |
|--------|------|------|----------|-------------|
| `GET` | `/api/expertises` | — | `{experts: [], categories: []}` | Lists built-in + custom |
| `GET` | `/api/expertises/:id` | — | Expertise config or 404 | — |
| `POST` | `/api/expertises` | Full expertise config | `{...expert}` | Validates; adds to registry; persists to DB |
| `PUT` | `/api/expertises/:id` | Updated fields | `{...expert}` or 404 | Updates; persists |
| `GET` | `/api/expertise-schema` | — | Schema constants | — |

### Merge Preview

| Method | Path | Body / Query | Response |
|--------|------|-------------|----------|
| `GET` | `/api/merge-preview` | `?expertises=id1,id2&weight_id1=0.5` | `{promptPreview, compatibility, ...}` |
| `POST` | `/api/merge-preview` | `{expertises: [{id, name, ...}]}` | Same (rate-limited: 2/sec) |

### Expertise Wizard

| Method | Path | Body | Response | Side Effects |
|--------|------|------|----------|-------------|
| `POST` | `/api/expertise-wizard/test-prompt` | `{expertiseConfig, question}` | `{response, model, duration, ...}` | LLM call (rate-limited: 1/5sec) |

---

## Agents

| Method | Path | Body | Response | Side Effects |
|--------|------|------|----------|-------------|
| `GET` | `/api/agents` | `?all=true` | `{agents: [], schedules: []}` | — |
| `GET` | `/api/agents/:id` | — | `{agent}` or 404 | — |
| `POST` | `/api/agents` | `{name, description, type, definition}` | `{agent}` | Creates agent |
| `PUT` | `/api/agents/:id` | Updated fields | `{agent}` or 404 | Updates agent |
| `DELETE` | `/api/agents/:id` | — | `{success}` | Deletes agent |
| `POST` | `/api/agents/:id/run` | — | `{execution}` | Manually runs agent |
| `POST` | `/api/agents/:id/enable` | — | `{success}` | Enables agent |
| `POST` | `/api/agents/:id/disable` | — | `{success}` | Disables agent |
| `GET` | `/api/agents/:id/runs` | `?limit=N` | `{runs: []}` | — |
| `GET` | `/api/agents/schema` | — | Schema constants | — |

### Agent Builder (LLM-guided)

| Method | Path | Body | Description |
|--------|------|------|-------------|
| `POST` | `/api/agents/build` | `{description}` | LLM generates agent draft |
| `POST` | `/api/agents/refine` | `{agent, feedback}` | Refines from feedback |
| `POST` | `/api/agents/confirm` | `{agent}` | Confirms and persists |
| `POST` | `/api/agents/dry-run` | `{definition}` | Validates + normalizes (no persistence) |

### Sources (for agent data pipelines)

| Method | Path | Body | Description |
|--------|------|------|-------------|
| `POST` | `/api/sources/inspect` | `{url, type?}` | Inspects HTTP source structure |
| `POST` | `/api/sources/validate-field` | `{data, field_path}` | Validates field extraction |
| `POST` | `/api/sources/validate-condition` | `{condition, data}` | Validates condition evaluation |

---

## Skills

| Method | Path | Body | Response | Side Effects |
|--------|------|------|----------|-------------|
| `GET` | `/api/skills` | — | `{skills: [...]}` | Lists registered skills |
| `GET` | `/api/skills/:id` | — | `{skill}` or 404 | — |
| `POST` | `/api/skills/reload` | — | `{loaded, reloaded}` | Hot-reloads registry from disk |
| `GET` | `/api/skills/executions/:id` | — | `{execution}` or 404 | — |
| `POST` | `/api/skills/executions/:id/confirm` | — | `{result}` | Starts execution (CONFIRMING → running) |
| `POST` | `/api/skills/executions/:id/resume` | `{input}` | `{result}` | Resumes AWAITING_INPUT |
| `POST` | `/api/skills/executions/:id/cancel` | — | `{success}` | Cancels pending execution |

---

## Specialists

| Method | Path | Body | Response | Side Effects |
|--------|------|------|----------|-------------|
| `GET` | `/api/specialists` | — | `{ok, specialists: [...]}` | Lists installed specialists |
| `GET` | `/api/specialists/:id` | — | Full detail or 404 | — |
| `POST` | `/api/specialists/:id/enable` | — | `{ok, status, version}` | Enables; acquires lock |
| `POST` | `/api/specialists/:id/disable` | — | `{ok, status}` | Disables; checks dependents |
| `POST` | `/api/specialists/:id/update` | — | `{ok, oldVersion, newVersion}` | Updates; re-discovers |
| `POST` | `/api/specialists/discover` | — | `{ok, discovered, newlyInstalled}` | Scans disk; installs; enables |
| `GET` | `/api/specialists/:id/integrity` | — | Integrity check result | — |
| `GET` | `/api/specialists/telemetry` | — | Telemetry data | — |

### Specialist Expertises

| Method | Path | Body | Description |
|--------|------|------|-------------|
| `GET` | `/api/specialists/:id/expertises` | — | List specialist-provided expertises |
| `POST` | `/api/specialists/:id/expertises` | Expertise config | Add expertise |
| `DELETE` | `/api/specialists/:id/expertises/:eid` | — | Remove expertise |
| `PATCH` | `/api/specialists/:id/expertises/:eid` | Updates | Update expertise |

---

## Marketplace

> Vzdálený katalog balíčků (skills, expertises, specialists). Instalace s SHA-256 verifikací.

| Method | Path | Body / Query | Response | Side Effects |
|--------|------|-------------|----------|-------------|
| `GET` | `/api/marketplace/catalog` | `?force=true` | `{ok, packages[]}` s install statusem | Fetch/cache remote catalog |
| `POST` | `/api/marketplace/catalog/refresh` | — | `{ok}` | Vynutí refresh cache |
| `GET` | `/api/marketplace/installed` | — | `{ok, packages[]}` | Seznam nainstalovaných balíčků |
| `POST` | `/api/marketplace/install/:type/:id` | — | `{ok, package}` | Stáhne, ověří SHA-256, nainstaluje |
| `DELETE` | `/api/marketplace/installed/:type/:id` | — | `{ok}` | Odinstalace + cleanup |
| `POST` | `/api/marketplace/update/:type/:id` | — | `{ok, oldVersion, newVersion}` | Update na nejnovější kompatibilní |
| `POST` | `/api/marketplace/export/:type/:id` | — | `{ok, package}` | Export lokálního balíčku |

> **`:type`** = `skill` | `expertise` | `specialist`
> **`:id`** = identifikátor balíčku

---

## Planner

| Method | Path | Body / Query | Response | Side Effects |
|--------|------|-------------|----------|-------------|
| `POST` | `/planner/start` | `{request, context?}` | Workflow session | Starts planning session |
| `POST` | `/planner/clarify` | `{sessionId, answers}` | Updated session | Clarification phase |
| `POST` | `/planner/approve` | `{sessionId}` | Result | Approves plan |
| `POST` | `/planner/reject` | `{sessionId, feedback?}` | Result | Rejects with feedback |
| `GET` | `/planner/session` | `?id=sessionId` | Session detail | — |
| `GET` | `/planner/sessions` | `?all=false` | `{sessions: []}` | — |
| `GET` | `/planner/progress` | `?id=sessionId&detailed=true` | Progress data | — |
| `GET` | `/planner/dashboard` | — | `{total, active, sessions}` (20 max) | — |
| `GET` | `/planner/project/:projectId/sessions` | — | `{projectId, sessions}` | — |
| `POST` | `/planner/resume` | `{sessionId, chatSessionId?}` | `{success, ...}` or 404 | Restores session state |

---

## Architect

| Method | Path | Body | Response | Side Effects |
|--------|------|------|----------|-------------|
| `POST` | `/architect/init` | `{projectRoot, projectName}` | `{success, project, state}` | Creates orchestrator; caches session (4h TTL) |
| `POST` | `/architect/message` | `{projectRoot, message, attachments?}` | `{...result, state}` | Processes message; updates state |
| `GET` | `/architect/status/:projectRoot` | — | Session state or 404 | — |
| `POST` | `/architect/action` | `{projectRoot, action}` | `{...result, state}` | Executes action |
| `GET` | `/architect` | — | HTML | Architect UI |
| `GET` | `/architect/architect.css` | — | CSS | Stylesheet |
| `GET` | `/architect/architect.js` | — | JavaScript | Client script |

---

## Lifecycle

Lifecycle endpoints are spread across projects and expertises routes:

| Method | Path | Body | Description |
|--------|------|------|-------------|
| `POST` | `/api/projects/lifecycle/start` | `{projectId?, projectPath?, projectName, description?, type?, sessionId}` | Start lifecycle (SPEC phase) |
| `POST` | `/api/projects/:id/lifecycle/bind` | `{sessionId}` | Bind session to active lifecycle |
| `GET` | `/api/projects/:id/lifecycle` | — | Get lifecycle state + milestone counts |
| `POST` | `/api/lifecycle/start` | `{projectId, description?, sessionId}` | Alt lifecycle start (via expertises route) |

---

## Quality

| Method | Path | Query | Response |
|--------|------|-------|----------|
| `GET` | `/api/quality/summary` | `?since=30&type=spec` | Aggregate quality scores |
| `GET` | `/api/quality/distribution` | `?since=30&type=spec` | Distribution analysis |
| `GET` | `/api/quality/project/:id` | — | Project quality report |
| `GET` | `/api/quality/volatility/:id` | — | Volatility index |
| `GET` | `/api/quality/report` | `?since=30` | Formatted text report (`text/plain`) |

---

## Autonomy

| Method | Path | Body | Response | Side Effects |
|--------|------|------|----------|-------------|
| `GET` | `/api/autonomy/status` | — | `{currentThreshold, trustLevel, autoApplyEnabled, ...}` | — |
| `POST` | `/api/autonomy/approve/:id` | — | `{success, improvement, currentThreshold}` | Applies improvement; updates CRE |
| `POST` | `/api/autonomy/reject/:id` | — | `{success, improvement}` | Marks rejected |
| `POST` | `/api/autonomy/alerts/:id/acknowledge` | — | `{success}` | Acknowledges alert |

---

## Notifications

### Agent Notifications (in agents route)

| Method | Path | Query | Description |
|--------|------|-------|-------------|
| `GET` | `/api/notifications` | `?unread=true&limit=N` | List notifications |
| `POST` | `/api/notifications/:id/read` | — | Mark read |
| `POST` | `/api/notifications/read-all` | — | Mark all read |

### Notification System Config

| Method | Path | Body / Query | Response | Side Effects |
|--------|------|-------------|----------|-------------|
| `GET` | `/api/notifications/config` | — | SMTP config + `credentialPersistence: environment_only`; password is only a configured sentinel | — |
| `POST` | `/api/notifications/config` | `{emailEnabled, smtpHost, smtpPort, smtpUser, smtpFrom, emailRecipient, ...}` | `{success, credentialPersistence}` | Saves non-secret config; rejects `smtpPass`; runtime credential comes only from `C3_SMTP_PASS` |
| `GET` | `/api/notifications/channels` | — | `{channels: [{name, configured}]}` | — |
| `POST` | `/api/notifications/test` | `{channel, recipient?}` | Test result | Sends test notification |
| `POST` | `/api/notifications/verify` | `{channel}` | Verify result | Verifies channel config |
| `GET` | `/api/notifications/log` | `?limit=50` | `{entries, count}` (max 200) | — |
| `POST` | `/api/notifications/send` | `{channel, recipient?, title, body?, priority?}` | Send result | Sends notification |

---

## System

| Method | Path | Query | Response | Side Effects |
|--------|------|-------|----------|-------------|
| `GET` | `/api/system/gpu` | — | `{profile: {gpus, cpu}, recommendation, sessionCapacity}` | GPU detection + session capacity |
| `POST` | `/api/system/gpu/refresh` | — | Same | Forces re-detection |
| `GET` | `/api/system/models/compatibility` | — | `{vram_mb, tiers, recommendations}` | Hardware-fit hints only; not quality evidence |
| `GET` | `/api/system/models/check` | `?model=name` | Compatibility result | — |
| `GET` | `/api/system/models` | — | `{models, ollama_url, current_model}` | Proxies to Ollama `/api/tags` |
| `GET` | `/api/system/models/info` | `?model=name` | Model details | Proxies to Ollama `/api/show` |
| `GET` | `/api/system/models/universe` | `?limit=50&offset=0&state=stable|partial|unstable&sort=confidence|updated|name|context|params&order=asc|desc` | `{models[], total, limit, offset, snapshot_id, sort, filters}` | Factual universe listing; confidence describes metadata reliability, not model quality |
| `GET` | `/api/system/models/universe/:name` | `?tag=&include_signals=true|false&signal_limit=20&source_limit=30` | `{model, sources[], signals[], snapshot_id}` | Lazy detail fetch for one model (source rows + optional signal trace) |
| `GET` | `/api/system/info` | — | System diagnostics (incl. sessions, provider config) | — |
| `GET` | `/api/system/storage` | — | Storage stats | — |

### Model discovery and manual binding

> Discovery responses contain no quality recommendation. Apply is accepted only
> after a durable operation or provider-pull intent exists.

| Method | Path | Body | Response | Side Effects |
|--------|------|------|----------|-------------|
| `GET` | `/api/system/upgrades` | — | `{authority, discovery, lastCheckTime, history}` | Read-only discovery status |
| `POST` | `/api/system/upgrades/check` | `{fullCycle?}` | `{authority, discovery}` | Refreshes factual discovery; no evaluation |
| `GET` | `/api/system/models/candidates` | — | `{authority, candidates[], roles[]}` | Catalog/discovery candidates; quality is `NOT_EVALUATED` |
| `POST` | `/api/system/upgrades/apply` | `{role, targetModel}` | `{ok, status: 'started', role, targetModel}` | Manual durable apply; pulls if needed; exact verification and WS are application-owned |
| `POST` | `/api/system/upgrades/rollback` | `{role, operationId, committedBindingRevision, failedAttemptRevision}` | `{ok, role, from, to, configVersion}` | Exact-operation manual rollback; role-only rollback is rejected |
| `GET` | `/api/system/upgrades/bindings` | — | `{bindings, overrides, configVersion}` | Read-only current binding projection |

> `model_changed` has exactly one producer: `ModelBindingApplication`. Provider
> pull progress is advisory; it is not evaluation evidence or binding success.
### Model Evaluations (v136.1)

| Method | Path | Body / Query | Response | Side Effects |
|--------|------|-------------|----------|-------------|
| `GET` | `/api/system/models/evaluations` | — | `{schemaVersion, generatedAt, authority, bindingAuthority, bindings, statusCounts, roles, models}` | Read-only Ollama inventory + SQLite read |

Každý artifact/role řádek obsahuje exact digest, suite version a contract SHA,
stav `COMPLETE|FAILED|BLOCKED|MISSING`, score a timestamp tam, kde existují.
`bindingAuthority.status` je `DURABLE` pouze po startup ověření všech sedmi
runtime modelů a digestů. `DEGRADED`, `UNVERIFIED_RUNTIME` a bootstrap stavy
blokují candidate actionability; jinak připravený kandidát dostane
`BINDING_AUTHORITY_DEGRADED`. DB řádky samy actionability nezakládají.
Odstraněné v123 endpointy `/validate` a `/validation-scores` vracejí 404;
evaluace se spouštějí řízeným hunt workflow, nikoli skrytým HTTP/WS jobem.

---

## Security

> Globální M5 guard klasifikuje `/api/security/*` jako admin surface a běží
> před handlerem. Production vyžaduje admin authority; explicitní localhost
> bypass existuje jen v development mode. Starší route-level kontrola zůstává
> defense-in-depth, není však jedinou hranicí.

| Method | Path | Query / Body | Response | Side Effects |
|--------|------|-------------|----------|-------------|
| `GET` | `/api/security/audit` | `?type=cre|merge|drift|llm|all&limit=100&since=ISO` | `{type, results: {...}}` | Reads audit tables (max 1000/type) |
| `GET` | `/api/security/tokens` | — | `{tokens: [...]}` | Lists tokens (hash only) |
| `POST` | `/api/security/tokens` | `{name, scopes?, expiresIn?}` | `{id, name, token, scopes, ...}` | Creates token; plaintext returned once only |
| `DELETE` | `/api/security/tokens/:id` | — | `{success}` or 404 | Deletes token |
| `GET` | `/api/security/webhook-secret` | — | `{configured, source, persistence}` | Environment-only status; never emits masked material |
| `POST` | `/api/security/webhook-secret` | — | `409 M5_PRIVACY_WEBHOOK_SECRET_ENV_ONLY` | API generation and persistence are disabled |
| `GET` | `/api/security/privacy/remediation` | — | `PrivacyRemediationStatus@1` | Reads append-only operator receipts; never returns values |
| `POST` | `/api/security/privacy/rotations/:categoryId/attest` | `{authorityKind, completedAtMs, confirmNoSecretValues}` | `PrivacyRotationReceipt@1` | Attests one exact rotation category from transport user authority |
| `POST` | `/api/security/privacy/history/attest` | `{decision, actionStatus, repositoryVisibility, completedAtMs, confirmOperatorAuthority, confirmNoSecretValues}` | `PrivacyHistoryReceipt@1` | Records the one append-only operator history disposition |

---

## Settings & Features

| Method | Path | Body | Response | Side Effects |
|--------|------|------|----------|-------------|
| `GET` | `/api/settings` | — | `{...user_settings}` | — |
| `POST` | `/api/settings` | `{...settings}` | `{success, featuresChanged}` | Saves to DB; applies feature flags |
| `GET` | `/api/features` | — | `{features: {...}}` | — |
| `POST` | `/api/features/reset` | — | `{ok, features}` | Resets to defaults |
| `POST` | `/api/features/:name` | `{enabled: bool}` | `{ok, features}` | Toggles feature flag at runtime |
| `GET` | `/api/license/status` | — | `{tier, valid, features, expiresAt, owner}` | — |

---

## Setup Wizard

| Method | Path | Body | Response | Side Effects |
|--------|------|------|----------|-------------|
| `GET` | `/api/setup/status` | — | `{completed, ollamaUrl, ollamaVerified, language, ...}` | — |
| `POST` | `/api/setup/ollama` | `{url}` | `{ok, models, missing, available}` | Tests Ollama connectivity |
| `POST` | `/api/setup/language` | `{language: 'cs'|'en'}` | `{language}` | Sets language |
| `POST` | `/api/setup/notifications` | `{channel, config}` | `{channel, enabled}` | Configures notification channel |
| `POST` | `/api/setup/license` | `{key?}` | `{hasKey}` | Stores license key |
| `POST` | `/api/setup/complete` | — | `{completed}` | Marks complete; writes `.env` |

---

## Misc

| Method | Path | Body / Query | Response | Side Effects |
|--------|------|-------------|----------|-------------|
| `GET` | `/` | — | `{name, version, status, endpoints}` | Health check |
| `GET` | `/health` | — | Same | Alias |
| `GET` | `/api/health` | — | Same | Alias |
| `GET` | `/api/storage/info` | — | `{totalSize}` | — |
| `POST` | `/api/autocomplete` | `{partial, context: [{role, text}]}` | `{suggestion}` | LLM call (max 80 tokens) |
| `POST` | `/api/context` | `{messageCount}` | `{percent}` | — |
| `GET` | `/api/audit` | `?conversation_id&limit=100` | `{audit, drift}` | — |
| `GET` | `/api/logs` | — | `{logs}` (1000 max) | — |
| `GET` | `/api/logs/export` | — | Text file (attachment) | — |
| `POST` | `/api/reset` | — | `{success}` | Clears user_settings |
| `POST` | `/api/feedback` | `{message, category?, version?, context?}` | `{ok, id}` | Rate-limited (1/30s); stores in DB |
| `POST` | `/api/feedback/:id/attach` | `{name, type, data}` | `{ok, filename, size}` | Writes attachment to disk (max 2MB per file, 5MB total) |
| `GET` | `/api/feedback` | — | Feedback rows (100 max) | — |
| `GET` | `/api/scheduler/status` | — | `{status, next_run, active_agents}` | — |

### Debug (requires `C3_TRACE=1`)

| Method | Path | Response |
|--------|------|----------|
| `GET` | `/api/debug/modules` | `{source, totalFiles, files}` |
| `GET` | `/api/debug/health` | `{status, uptime, memory, tracer, nodeVersion}` |

---

## Architectural Notes

1. **No Express** — Custom `matchRoute(method, url)` router in `server.js`
2. **Route factories** — Each module exports `createXXXRoutes(deps)` → `{METHOD PATH: handler}` map
3. **Dependency injection** — `deps` = `{db, logger, sendJSON, parseBody, ...}` passed to factories
4. **Lazy imports** — Heavy modules (architect, planner, agents) loaded on first request
5. **AbortController** — Chat routes listen for client disconnect and cancel LLM generation
6. **Rate limiting** — Wizard endpoints have stricter limits (0.5–5s between calls)
