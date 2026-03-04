# C3 Agent — API Reference

> **v93.1** | ~180 endpoints across 13 route modules
> Generated from source code analysis. All routes are HTTP/1.1, JSON bodies (unless noted).

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
- [Planner](#planner)
- [Architect](#architect)
- [Lifecycle](#lifecycle)
- [Quality](#quality)
- [Autonomy](#autonomy)
- [Notifications](#notifications)
- [System](#system)
- [Security](#security)
- [Settings & Features](#settings--features)
- [Setup Wizard](#setup-wizard)
- [Misc](#misc)

---

## Authentication & Middleware

### Global Middleware

| Layer | Description |
|-------|-------------|
| CORS | `OPTIONS *` → 204 with `Access-Control-Allow-*` headers |
| Rate limit | Per-IP sliding window, default 100 req/60s (configurable) |
| Path traversal guard | Static file serving validates paths within allowed base dirs |
| Security headers | `X-Content-Type-Options`, `X-Frame-Options`, CSP |

### Auth Mechanisms

| Scope | Mechanism |
|-------|-----------|
| `/api/security/*` | `X-Admin-Token` header required (or localhost in dev mode) |
| Setup routes | No auth (idempotent) |
| All other routes | No auth (stateless, local-only deployment) |

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

**Response:** `{response, mode, confidence, session_id}`
**Side effects:** ChatController.handle() → CRE → handler → persists to ConversationStore

### `POST /api/chat`

Primary chat endpoint (API path, used by IDE integration).

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `conversation_id` | string | ✅ | Conversation ID |
| `project_id` | string | | Project ID |
| `message` | string | ✅ | User input |
| `attachments` | array | | File attachments |
| `userId` | string | | User identifier |

**Response:** `{response, mode, confidence, metadata}`
**Side effects:** Same as `/chat`; also persists messages to conversation

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
| `GET` | `/api/conversations/:id/messages` | — | `{messages: []}` | — |
| `PUT` | `/api/conversations/:id` | `{project_id?, title?}` | `{conversation}` | Updates metadata |
| `PATCH` | `/api/conversations/:id/archive` | — | `{success, status: 'archived'}` | Sets `state='archived'` |
| `PATCH` | `/api/conversations/:id/restore` | — | `{success, status: 'active'}` | Restores from archive |
| `DELETE` | `/api/conversations/:id` | `?hard=true` | `{success, mode}` | Soft delete (default) or hard delete |

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
| `GET` | `/api/notifications/config` | — | SMTP config (password masked) | — |
| `POST` | `/api/notifications/config` | `{emailEnabled, smtpHost, smtpPort, smtpUser, smtpPass, smtpFrom, emailRecipient, ...}` | `{success}` | Saves config; updates runtime channel |
| `GET` | `/api/notifications/channels` | — | `{channels: [{name, configured}]}` | — |
| `POST` | `/api/notifications/test` | `{channel, recipient?}` | Test result | Sends test notification |
| `POST` | `/api/notifications/verify` | `{channel}` | Verify result | Verifies channel config |
| `GET` | `/api/notifications/log` | `?limit=50` | `{entries, count}` (max 200) | — |
| `POST` | `/api/notifications/send` | `{channel, recipient?, title, body?, priority?}` | Send result | Sends notification |

---

## System

| Method | Path | Query | Response | Side Effects |
|--------|------|-------|----------|-------------|
| `GET` | `/api/system/gpu` | — | `{profile: {gpus, cpu}, recommendation}` | GPU detection |
| `POST` | `/api/system/gpu/refresh` | — | Same | Forces re-detection |
| `GET` | `/api/system/models/compatibility` | — | `{vram_mb, tiers, recommendations}` | — |
| `GET` | `/api/system/models/check` | `?model=name` | Compatibility result | — |
| `GET` | `/api/system/models` | — | `{models, ollama_url, current_model}` | Proxies to Ollama `/api/tags` |
| `GET` | `/api/system/models/info` | `?model=name` | Model details | Proxies to Ollama `/api/show` |
| `GET` | `/api/system/info` | — | System diagnostics | — |
| `GET` | `/api/system/storage` | — | Storage stats | — |

---

## Security

> All `/api/security/*` endpoints require `X-Admin-Token` header.

| Method | Path | Query / Body | Response | Side Effects |
|--------|------|-------------|----------|-------------|
| `GET` | `/api/security/audit` | `?type=cre|merge|drift|llm|all&limit=100&since=ISO` | `{type, results: {...}}` | Reads audit tables (max 1000/type) |
| `GET` | `/api/security/tokens` | — | `{tokens: [...]}` | Lists tokens (hash only) |
| `POST` | `/api/security/tokens` | `{name, scopes?, expiresIn?}` | `{id, name, token, scopes, ...}` | Creates token; plaintext returned once only |
| `DELETE` | `/api/security/tokens/:id` | — | `{success}` or 404 | Deletes token |

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
