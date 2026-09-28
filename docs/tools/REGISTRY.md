# C.3 Tool Registry

> **Version:** 2.0
> **Status:** NORMATIVE
> **Last Updated:** 2026-02-27
> **Tools:** 153 | **E2E Tests:** 75

---

## 1. Overview

Tool Registry (`src/tools/registry.js`) is the central catalog of all executable tools available to the C3 agent. Each tool is a pure async function with:

- **Typed parameters** (required + optional)
- **Capability metadata** (risk classification, cost, category)
- **Permission declarations**
- **Structured return values** (data or `{ error, code }`)

The registry is consumed by:
- **CRE** — tool selection for SHELL/BUILD intents
- **ToolExecutor** — runtime execution with circuit breaker
- **Autonomy layer** — `safeForAutoExec()` for auto-approval
- **Agent platform** — worker agents select tools by capability

---

## 2. Tool Definition Structure

```javascript
/**
 * @typedef {Object} ToolDef
 * @property {string} name               — Unique identifier (e.g. 'fs.read')
 * @property {string} description        — Human-readable purpose
 * @property {{ required: string[], optional: string[] }} params
 * @property {string[]} permissions      — Required permissions
 * @property {ToolMeta} meta             — Capability metadata
 * @property {(params, context?) => Promise<any>} execute
 */

/**
 * @typedef {Object} ToolMeta
 * @property {boolean} sideEffects       — Modifies external state?
 * @property {boolean} idempotent        — Same input → same result?
 * @property {boolean} destructive       — Can cause data loss?
 * @property {boolean} requiresConfirmation — Needs user approval?
 * @property {'free'|'low'|'medium'|'high'} costLevel
 * @property {'read'|'write'|'exec'|'net'|'pure'} category
 */
```

---

## 3. Capability Metadata

Every tool carries a `meta` object for risk-aware execution:

| Property | Type | Description |
|----------|------|-------------|
| `sideEffects` | boolean | Does the tool modify external state (files, processes, network)? |
| `idempotent` | boolean | Safe to retry — same input always produces same result? |
| `destructive` | boolean | Can this tool cause irreversible data loss? |
| `requiresConfirmation` | boolean | Should the autonomy layer ask the user first? |
| `costLevel` | enum | Resource/time cost: `free` → `low` → `medium` → `high` |
| `category` | enum | Operation class: `pure`, `read`, `write`, `exec`, `net` |

### Category Semantics

| Category | Side Effects | Examples |
|----------|-------------|---------|
| `pure` | None — stateless computation | `math.eval`, `regex.test`, `crypto.uuid`, `validate.json` |
| `read` | None — reads external state | `fs.read`, `git.status`, `system.info`, `guard.disk` |
| `write` | Modifies files/state | `fs.write`, `git.commit`, `code.rename` |
| `exec` | Executes external process | `shell.exec`, `npm.run`, `python.run`, `profile.cpu` |
| `net` | Network I/O | `web.search`, `git.push`, `api.request`, `ssh.exec` |

### Cost Semantics

| Cost | Typical Duration | Examples |
|------|-----------------|---------|
| `free` | < 10ms | `math.eval`, `fs.exists`, `date.now` |
| `low` | < 1s | `fs.read`, `git.diff`, `validate.json` |
| `medium` | 1–30s | `npm.run`, `code.format`, `api.latency` |
| `high` | 30s+ or heavy resource use | `npm.install`, `docker.build`, `api.loadtest`, `profile.cpu` |

### Invariants

1. **`destructive: true` → `requiresConfirmation: true`** — All destructive tools require confirmation
2. **`category: 'pure'` → `sideEffects: false`** — Pure tools cannot have side effects
3. **`category: 'read'` → `sideEffects: false`** — Read tools cannot have side effects

---

## 4. Risk Classification

The `ToolRegistry` provides a layered risk assessment API:

```javascript
import { toolRegistry } from './src/tools/registry.js';

// Quick boolean check
toolRegistry.isSafe('math.eval');     // true
toolRegistry.isSafe('git.reset');     // false

// Full risk report
toolRegistry.riskAssessment('git.rebase');
// → { risk: 'critical', reasons: ['destructive', 'not idempotent', ...], meta: {...} }

// Risk levels: safe → low → medium → high → critical
```

### Risk Level Criteria

| Level | Criteria |
|-------|---------|
| **safe** | No side effects, no confirmation needed, not destructive |
| **low** | Has side effects but idempotent and not destructive |
| **medium** | Requires confirmation OR has high cost |
| **high** | Destructive but idempotent (recoverable) |
| **critical** | Destructive AND not idempotent (irreversible) |

---

## 5. Registry API

### Query Methods

```javascript
// List all tool names
toolRegistry.list()                    // → string[]

// Get tool by name
toolRegistry.get('fs.read')            // → ToolDef | undefined

// Check existence
toolRegistry.has('fs.read')            // → boolean

// Filter by metadata
toolRegistry.safeForAutoExec()         // → string[]  (89 tools)
toolRegistry.requiresConfirmation()    // → string[]  (39 tools)
toolRegistry.destructive()             // → string[]  (7 tools)
toolRegistry.byCategory('read')       // → string[]
toolRegistry.byCost('free')           // → string[]

// Dashboard
toolRegistry.capabilitySummary()       // → { total, categories, costs, ... }
```

### Capability Summary (current)

```
Total:          153
With metadata:  153 (100%)

Categories:     pure: 34, read: 49, write: 35, exec: 19, net: 16
Cost levels:    free: 80, low: 32, medium: 26, high: 15

Safe for auto:  89
Needs confirm:  39
Destructive:    7
```

---

## 6. Tool Reference

### api (4)

| Tool | Description | Required | Category | Cost |
|------|-------------|----------|----------|------|
| `api.request` | HTTP request with full control (method, headers, body, auth) | `url` | net | low |
| `api.latency` | Measure endpoint latency over multiple requests | `url` | net | medium |
| `api.validate` | Validate API response against expected schema/status/headers | `url` | net | low |
| `api.loadtest` | Concurrent load test against an endpoint | `url` | net | high |

### archive (2)

| Tool | Description | Required | Category | Cost |
|------|-------------|----------|----------|------|
| `archive.extract` | Extract a zip/tar/gz archive | `archive`, `dest` | write | medium |
| `archive.create` | Create a zip or tar.gz archive | `source`, `output` | write | medium |

### base64 (2)

| Tool | Description | Required | Category | Cost |
|------|-------------|----------|----------|------|
| `base64.encode` | Encode string or file to base64 | `input` | pure | free |
| `base64.decode` | Decode base64 to string or file | `input` | pure | free |

### code (7)

| Tool | Description | Required | Category | Cost |
|------|-------------|----------|----------|------|
| `code.analyze` | Code metrics — LOC, file count, language breakdown | — | read | low |
| `code.format` | Format code using project formatter | — | exec | medium |
| `code.lint` | Run linter and return issues | — | exec | medium |
| `code.imports` | Analyze import/require dependency graph | `path` | read | medium |
| `code.deadcode` | Detect potentially unused exports | `path` | read | medium |
| `code.rename` | Rename a symbol across all files (text-based) | `path`, `oldName`, `newName` | write | medium |
| `code.duplicates` | Detect duplicate/similar code blocks | `path` | read | high |

### crypto (5)

| Tool | Description | Required | Category | Cost |
|------|-------------|----------|----------|------|
| `crypto.randomBytes` | Cryptographically secure random bytes | — | pure | free |
| `crypto.generatePassword` | Secure random password | — | pure | free |
| `crypto.encrypt` | AES-256-GCM encryption | `text`, `key` | pure | free |
| `crypto.decrypt` | AES-256-GCM decryption | `encrypted`, `key`, `iv`, `tag` | pure | free |
| `crypto.uuid` | UUID v4 generation | — | pure | free |

### csv (1)

| Tool | Description | Required | Category | Cost |
|------|-------------|----------|----------|------|
| `csv.convert` | Convert between CSV and JSON | `input`, `direction` | pure | free |

### data (2)

| Tool | Description | Required | Category | Cost |
|------|-------------|----------|----------|------|
| `data.parse` | Parse data from one format to structured object | `input` | pure | free |
| `data.filter` | Filter array of objects by criteria | `data`, `criteria` | pure | free |

### date (4)

| Tool | Description | Required | Category | Cost |
|------|-------------|----------|----------|------|
| `date.now` | Current date/time in various formats | — | pure | free |
| `date.parse` | Parse date string to structured components | `input` | pure | free |
| `date.diff` | Calculate difference between two dates | `from`, `to` | pure | free |
| `date.format` | Format date with locale and timezone | `input` | pure | free |

### db (4)

| Tool | Description | Required | Category | Cost |
|------|-------------|----------|----------|------|
| `db.query` | Execute SQL on a SQLite database | `dbPath`, `sql` | write | low |
| `db.schema` | Show database schema | `dbPath` | read | free |
| `db.backup` | Create database backup | `dbPath` | write | low |
| `db.migrate` | Run SQL migration files | `dbPath`, `migrationsDir` | write | high |

### deps (4) — Dependency Intelligence

| Tool | Description | Required | Category | Cost |
|------|-------------|----------|----------|------|
| `deps.tree` | Transitive dependency tree with depth/size info | — | read | medium |
| `deps.licenses` | Scan all dependency licenses, flag copyleft/unknown | — | read | medium |
| `deps.size` | Size impact analysis per dependency | — | read | medium |
| `deps.vuln` | Vulnerability audit; optional confirmed npm audit fix | — | exec | low |

### diff (2)

| Tool | Description | Required | Category | Cost |
|------|-------------|----------|----------|------|
| `diff.create` | Unified diff between two texts or files | `a`, `b` | read | low |
| `diff.apply` | Apply a unified diff patch | `target`, `patch` | write | low |

### docker (6)

| Tool | Description | Required | Category | Cost |
|------|-------------|----------|----------|------|
| `docker.run` | Run command in Docker container | `image`, `command` | exec | high |
| `docker.build` | Build Docker image | `tag` | exec | high |
| `docker.ps` | List running containers | — | read | free |
| `docker.images` | List Docker images | — | read | free |
| `docker.logs` | Show container logs | `container` | read | free |
| `docker.compose` | Docker Compose operations | `action` | exec | high |

### env (2)

| Tool | Description | Required | Category | Cost |
|------|-------------|----------|----------|------|
| `env.get` | Read environment variable(s), hides secrets | — | read | free |
| `env.set` | Set environment variable for current session | `key`, `value` | write | free |

### fs (20)

| Tool | Description | Required | Category | Cost | Destructive |
|------|-------------|----------|----------|------|-------------|
| `fs.read` | Read file | `path` | read | free | — |
| `fs.write` | Write file | `path`, `content` | write | free | — |
| `fs.list` | List directory | `path` | read | free | — |
| `fs.copy` | Copy file/directory | `src`, `dest` | write | low | — |
| `fs.move` | Move/rename | `src`, `dest` | write | low | YES |
| `fs.delete` | Delete file/directory | `path` | write | free | YES |
| `fs.glob` | Find files by glob pattern | `pattern` | read | low | — |
| `fs.diff` | Compare two files | `fileA`, `fileB` | read | low | — |
| `fs.stat` | File metadata | `path` | read | free | — |
| `fs.mkdir` | Create directory | `path` | write | free | — |
| `fs.exists` | Check existence | `path` | read | free | — |
| `fs.head` | First N lines | `path` | read | free | — |
| `fs.tail` | Last N lines | `path` | read | free | — |
| `fs.append` | Append to file | `path`, `content` | write | free | — |
| `fs.chmod` | Change permissions | `path`, `mode` | write | free | — |
| `fs.symlink` | Create symlink | `target`, `linkPath` | write | free | — |
| `fs.readJson` | Read & parse JSON file | `path` | read | free | — |
| `fs.writeJson` | Write JSON file | `path`, `data` | write | free | — |
| `fs.patch` | Line-based edits (search & replace) | `path`, `edits` | write | low | — |
| `fs.find` | Search files by name/content | — | read | low | — |

### git (18)

| Tool | Description | Required | Category | Cost | Destructive |
|------|-------------|----------|----------|------|-------------|
| `git.status` | Status, branch, recent log | — | read | free | — |
| `git.commit` | Stage + commit | `message` | write | low | — |
| `git.diff` | Staged/unstaged diff | — | read | free | — |
| `git.push` | Push to remote | — | net | medium | — |
| `git.pull` | Pull from remote | — | net | medium | — |
| `git.clone` | Clone repository | `url` | net | high | — |
| `git.branch` | Create/delete/list branches | `action` | write | free | — |
| `git.checkout` | Switch branch or restore files | `target` | write | low | — |
| `git.merge` | Merge branch | `branch` | write | medium | — |
| `git.stash` | Stash changes | `action` | write | free | — |
| `git.tag` | Create/list/delete tags | `action` | write | free | — |
| `git.log` | Detailed commit log | — | read | free | — |
| `git.remote` | Manage remotes | `action` | read | free | — |
| `git.reset` | Reset HEAD | — | write | low | YES |
| `git.cherry-pick` | Apply specific commits | `commits` | write | medium | — |
| `git.rebase` | Rebase branch | — | write | high | YES |
| `git.init` | Initialize repository | — | write | free | — |
| `git.blame` | Line-by-line authorship | `file` | read | low | — |

### guard (4) — Resource Guards

| Tool | Description | Required | Category | Cost |
|------|-------------|----------|----------|------|
| `guard.disk` | Check disk space, warn if low | — | read | free |
| `guard.memory` | System + process memory pressure | — | read | free |
| `guard.fd` | Open file descriptors vs limit | — | read | free |
| `guard.watchdog` | Combined health check (disk + memory + fd) | — | read | free |

### hash (1), http (1), image (2), json (1), log (2)

| Tool | Description | Required | Category | Cost |
|------|-------------|----------|----------|------|
| `hash.checksum` | Compute hash (sha256, md5, etc.) | `input` | pure | low |
| `http.request` | Full HTTP client | `url` | net | medium |
| `image.info` | Image metadata | `path` | read | free |
| `image.resize` | Resize image (requires ImageMagick) | `input`, `output` | write | medium |
| `json.transform` | Pick/omit/sort/flatten/unique | `data` | pure | free |
| `log.tail` | Tail log file with filtering | `path` | read | free |
| `log.analyze` | Analyze log — errors, patterns | `path` | read | low |

### math (3)

| Tool | Description | Required | Category | Cost |
|------|-------------|----------|----------|------|
| `math.eval` | Safe math expression eval | `expression` | pure | free |
| `math.stats` | Statistics (mean, median, std, quartiles) | `data` | pure | free |
| `math.convert` | Unit conversion (length, weight, temp, data, time) | `value`, `from`, `to` | pure | free |

### memory (2), net (3), npm (7)

| Tool | Description | Required | Category | Cost |
|------|-------------|----------|----------|------|
| `memory.store` | Store fact in session memory | `key`, `value` | write | free |
| `memory.recall` | Recall fact from session memory | `key` | read | free |
| `net.ping` | Ping host | `host` | net | low |
| `net.ports` | Check open ports / list listening | — | net | low |
| `net.dns` | DNS lookup | `hostname` | net | low |
| `npm.install` | Install packages | — | exec | high |
| `npm.run` | Run npm script | `script` | exec | medium |
| `npm.list` | List installed packages | — | read | free |
| `npm.outdated` | Check outdated packages | — | read | low |
| `npm.audit` | Security audit; optional confirmed fix | — | exec | low |
| `npm.init` | Initialize package.json | — | write | free |
| `npm.scripts` | List available scripts | — | read | free |

### process (2), profile (4) — Observability

| Tool | Description | Required | Category | Cost |
|------|-------------|----------|----------|------|
| `process.list` | List running processes | — | read | free |
| `process.kill` | Kill process by PID | `pid` | exec | free |
| `profile.cpu` | CPU profile via V8 --prof | `script` | exec | high |
| `profile.heap` | V8 heap snapshot | `script` | exec | high |
| `profile.eventloop` | Event loop lag measurement | — | read | low |
| `profile.benchmark` | Micro-benchmark JS function | `code` | exec | medium |

### python (3), regex (3), shell (1), ssh (2)

| Tool | Description | Required | Category | Cost |
|------|-------------|----------|----------|------|
| `python.run` | Run Python script/code | `input` | exec | medium |
| `python.pip` | Install Python packages | `packages` | exec | high |
| `python.venv` | Manage virtual environments | `action` | write | low |
| `regex.test` | Test regex pattern | `pattern`, `text` | pure | free |
| `regex.extract` | Extract all matches | `pattern`, `text` | pure | free |
| `regex.replace` | Regex replace | `pattern`, `text`, `replacement` | pure | free |
| `shell.exec` | Execute shell command | `command` | exec | medium |
| `ssh.exec` | Remote command via SSH | `host`, `command` | net | medium |
| `ssh.copy` | SCP file transfer | `source`, `dest` | net | medium |

### system (3), template (1), test (2), text (3), tools (3)

| Tool | Description | Required | Category | Cost |
|------|-------------|----------|----------|------|
| `system.info` | OS, CPU, memory, uptime | — | read | free |
| `system.disk` | Disk usage | — | read | free |
| `system.which` | Check if command exists | `command` | read | free |
| `template.render` | Mustache-style template | `template`, `vars` | pure | free |
| `test.detect` | Auto-detect test framework | — | read | free |
| `test.run` | Run tests (auto-detect or specified) | — | exec | high |
| `text.search` | Grep-like search in files | `pattern` | read | low |
| `text.replace` | Find & replace in files | `pattern`, `replacement` | write | low |
| `text.count` | Line/word/char count | `input` | read | free |
| `tools.check` | Check available external tools | — | read | low |
| `tools.install` | Install missing tool/package | `package` | exec | high |
| `tools.suggest` | Suggest tool to install from error | `error` | pure | free |

### url (4), validate (4), web (3), workspace (3), yaml (2)

| Tool | Description | Required | Category | Cost |
|------|-------------|----------|----------|------|
| `url.parse` | Parse URL components | `url` | pure | free |
| `url.build` | Build URL from components | `base` | pure | free |
| `url.encode` | URL-encode string | `input` | pure | free |
| `url.decode` | URL-decode string | `input` | pure | free |
| `validate.json` | JSON syntax + field validation | `input` | pure | free |
| `validate.email` | Email format validation | `email` | pure | free |
| `validate.url` | URL format validation | `url` | pure | free |
| `validate.semver` | Semver validation/comparison | `version` | pure | free |
| `web.search` | Web search | `query` | net | medium |
| `web.fetch` | Fetch URL content | `url` | net | medium |
| `web.scrape` | Scrape web page | `url` | net | medium |
| `workspace.snapshot` | Save workspace state | — | write | low |
| `workspace.restore` | Restore workspace snapshot | `name` | write | high |
| `workspace.snapshots` | List snapshots | — | read | free |
| `yaml.parse` | Parse YAML to JSON | `input` | pure | free |
| `yaml.stringify` | JSON to YAML | `data` | pure | free |

---

## 7. Destructive Tools (7)

These tools can cause irreversible data loss and always require user confirmation:

| Tool | Risk |
|------|------|
| `fs.delete` | Deletes files/directories |
| `fs.move` | Moving can overwrite destination |
| `git.reset` | Reset can discard uncommitted changes |
| `git.rebase` | Rewrites commit history |
| `process.kill` | Terminates running process |
| `db.migrate` | Modifies database schema |
| `workspace.restore` | Overwrites current workspace |

---

## 8. Self-Install Capability

When the agent encounters a missing external tool, `tools.suggest` analyzes the error and returns installation instructions. `tools.install` can then install the package using the appropriate package manager.

Supported tools for auto-install:

| Command | Package | apt | brew | npm |
|---------|---------|-----|------|-----|
| `convert` | ImageMagick | `imagemagick` | `imagemagick` | — |
| `ffmpeg` | FFmpeg | `ffmpeg` | `ffmpeg` | — |
| `docker` | Docker | `docker.io` | `docker` | — |
| `python3` | Python | `python3` | `python3` | — |
| `typescript` | TypeScript | — | — | `typescript` |
| `prettier` | Prettier | — | — | `prettier` |
| `eslint` | ESLint | — | — | `eslint` |
| ... | (20+ entries) | | | |

---

## 9. Testing

```bash
# Full E2E test suite (82 tests)
node tests/tool-registry-e2e.test.js

# Tool executor + circuit breaker tests (31 tests)
node tests/e2e-resilience.test.js

# Tool pipeline E2E (44 tests)
node tests/tool-pipeline-e2e.test.js
```

Test coverage includes:
- Registry structure & API (5 tests)
- Metadata integrity for ALL 153 tools (8 tests)
- Risk classification & query methods (9 tests)
- Tool execution across 11 categories (60 tests)

---

## 10. Adding a New Tool

```javascript
tools['category.name'] = {
  name: 'category.name',
  description: 'What this tool does',
  params: {
    required: ['param1'],
    optional: ['param2', 'param3'],
  },
  permissions: ['fs.read'],  // required permissions
  meta: {
    sideEffects: false,
    idempotent: true,
    destructive: false,
    requiresConfirmation: false,
    costLevel: 'free',
    category: 'pure',
  },
  async execute(params) {
    try {
      // Implementation
      return { result: 'value' };
    } catch (err) {
      return { error: err.message, code: 'CATEGORY_ERROR' };
    }
  },
};
```

### Checklist

- [ ] `name` matches the key (`tools['x.y']` → `name: 'x.y'`)
- [ ] `description` is > 5 characters
- [ ] `params.required` and `params.optional` are arrays
- [ ] `meta` has all 6 fields with valid values
- [ ] `destructive: true` implies `requiresConfirmation: true`
- [ ] `category: 'pure'` implies `sideEffects: false`
- [ ] `execute()` returns structured data or `{ error, code }`
- [ ] E2E test added to `tests/tool-registry-e2e.test.js`

---

## Appendix: Change Log

| Version | Date | Changes |
|---------|------|---------|
| 1.0 | 2026-02-26 | Initial: 10 tools (web, data, fs, memory, git, shell, http) |
| 1.1 | 2026-02-26 | Expand to 34 tools (+archive, hash, json, csv, template, env, docker, image, db, cron, base64) |
| 1.2 | 2026-02-27 | Expand to 88 tools (+git full, fs full, npm, text, system, net, docker, self-install) |
| 1.3 | 2026-02-27 | Expand to 133 tools (+yaml, crypto, regex, date, math, url, diff, test, python, code, ssh, log, validate, workspace) |
| 1.4 | 2026-02-27 | Add capability metadata to all 133 tools + risk query API |
| 2.0 | 2026-02-27 | Expand to 153 tools (+profiling, API testing, code analysis, dependency intelligence, resource guards) + 75 E2E tests |
