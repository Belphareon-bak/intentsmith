# C3 IDE — Sprint 7: Security & Trust

## Přehled

Sprint 7 je security hardening sprint: audit ShellTool sandboxu,
process isolation (bubblewrap), WebSocket auth + rate limiting,
a penetration testing framework s 90 testy.

## 7-Layer Defense Model

```
┌─────────────────────────────────────────────────────────────┐
│ LLM output: "npm install express && rm -rf /"               │
│                                                             │
│ ┌─────────────────────────────────────────────────────────┐ │
│ │ Layer 1: Command Whitelist                          ✅  │ │
│ │   npm ∈ ALLOWED_COMMANDS → pass                         │ │
│ │   (rm would be blocked here)                            │ │
│ ├─────────────────────────────────────────────────────────┤ │
│ │ Layer 2: Arg Blacklist                              ✅  │ │
│ │   "install" ∈ NPM_SAFE_SUBCOMMANDS → pass               │ │
│ │   inject --ignore-scripts                               │ │
│ │   (node -e, python -c blocked here)                     │ │
│ ├─────────────────────────────────────────────────────────┤ │
│ │ Layer 3: argv spawn (shell: false)                  ✅  │ │
│ │   "&&" is a literal arg, NOT a separator                │ │
│ │   "rm -rf /" is NEVER executed                          │ │
│ ├─────────────────────────────────────────────────────────┤ │
│ │ Layer 4: cwd Sandbox                                ✅  │ │
│ │   resolved cwd must be inside project root              │ │
│ │   ../../etc/passwd → BLOCKED (path traversal)           │ │
│ ├─────────────────────────────────────────────────────────┤ │
│ │ Layer 5: Env Sanitization                           ✅  │ │
│ │   ANTHROPIC_API_KEY, DATABASE_URL → stripped             │ │
│ │   *_SECRET, *_TOKEN, *_PASSWORD → stripped               │ │
│ ├─────────────────────────────────────────────────────────┤ │
│ │ Layer 6: Bubblewrap (Linux)                         ✅* │ │
│ │   --ro-bind / /  (read-only root)                       │ │
│ │   --bind cwd cwd (write only project dir)               │ │
│ │   --unshare-pid --unshare-net --die-with-parent         │ │
│ │   * if bwrap installed; fallback to Layers 1-5          │ │
│ ├─────────────────────────────────────────────────────────┤ │
│ │ Layer 7: Timeout + Kill                             ✅  │ │
│ │   30s SIGTERM → 5s grace → SIGKILL                      │ │
│ │   Output truncated at 64KB                              │ │
│ └─────────────────────────────────────────────────────────┘ │
│                                                             │
│ Result: npm install express --ignore-scripts                │
│         (in sandbox, sanitized env, with timeout)           │
└─────────────────────────────────────────────────────────────┘
```

## WebSocket Security

```
┌─────────────────────────────────────────────────────┐
│ WebSocket Security                                  │
├─────────────────────────────────────────────────────┤
│                                                     │
│ 1. LOCAL-ONLY BINDING                               │
│    127.0.0.1 only — non-local IPs rejected          │
│    ::1 and ::ffff:127.x.x.x recognized              │
│                                                     │
│ 2. SESSION TOKEN                                    │
│    256-bit random token (crypto.randomBytes)         │
│    Required in WS handshake                          │
│    Constant-time comparison (timingSafeEqual)         │
│                                                     │
│ 3. RATE LIMITING                                    │
│    Token bucket: 20 burst, 100/min sustained         │
│    Per-connection isolation                          │
│                                                     │
│ 4. INPUT SANITIZATION                               │
│    Max 100KB message size                            │
│    JSON schema: type field required                  │
│    Message type whitelist                            │
│    Script/iframe/null-byte stripping                 │
│                                                     │
└─────────────────────────────────────────────────────┘
```

## Testy — 90/90

```
--- 1. Layer 1: Command Whitelist ---           (10 tests)
  ✅ allowed: ls, node, git
  ✅ BLOCKED: rm, bash, sh, sudo, nc, perl, /usr/bin/bash

--- 2. Layer 2: Arg Blacklist ---               (8 tests)
  ✅ BLOCKED: node -e, --eval, python3 -c
  ✅ BLOCKED: git --upload-pack, curl -o, --output
  ✅ allowed: curl (no -o), node index.js

--- 3. Layer 2b: npm Safety ---                 (7 tests)
  ✅ npm install → injects --ignore-scripts
  ✅ npm ci → injects --ignore-scripts
  ✅ no duplicate injection
  ✅ npm test → no injection needed
  ✅ BLOCKED: npm exec, npm explore

--- 4. Layer 4: cwd Sandbox ---                 (8 tests)
  ✅ allowed: project root, subdirectory
  ✅ BLOCKED: /etc, /tmp, ../../etc/passwd, ../../../
  ✅ BLOCKED: nonexistent cwd

--- 5. Layer 5: Env Sanitization ---            (12 tests)
  ✅ strips: ANTHROPIC_API_KEY, OPENAI_API_KEY, DATABASE_URL, AWS_*
  ✅ strips suffix: *_SECRET, *_TOKEN, *_PASSWORD, *_API_KEY
  ✅ preserves: PATH, HOME, NODE_ENV

--- 6. WS Session Token ---                     (6 tests)
  ✅ 256-bit hex token, validate correct/wrong/empty/null
  ✅ regenerate invalidates old token

--- 7. WS Rate Limiter ---                      (4 tests)
  ✅ burst allowed, then blocked
  ✅ per-connection independence

--- 8. WS Input Validation ---                  (14 tests)
  ✅ BLOCKED: non-local IP, missing token
  ✅ allowed: 127.0.0.1, ::1, ::ffff:127.*
  ✅ BLOCKED: oversized, invalid JSON, unknown type
  ✅ sanitizes: script tags, iframe, null bytes

--- 9. WsSecurityGuard ---                      (3 tests)
  ✅ combined auth + rate limit + validation

--- 10. Process Isolation ---                   (13 tests)
  ✅ bwrap args: ro-bind, bind, die-with-parent, unshare-pid/net
  ✅ network heuristic: npm install=net, npm test=no-net, etc.

--- 11. Integration ---                         (5 tests)
  ✅ full chain: git status (allow + sanitized env)
  ✅ full chain: npm install (inject + sanitize)
  ✅ full chain: python -c (blocked layer 2)
  ✅ full chain: cat ../../etc/passwd (blocked layer 4)
  ✅ shell:false — semicolons as literal args
```

## Packages

| Package | Řádků | Co dělá |
|---|---|---|
| `@c3/shell-security` | ~520 | Command whitelist (40 cmds), arg blacklist (global + per-cmd), npm subcommand filter + --ignore-scripts injection, cwd sandbox + path traversal detection, env sanitization (exact + prefix + suffix patterns), timeout SIGTERM→SIGKILL, full execute() method |
| `@c3/ws-security` | ~350 | SessionTokenManager (256-bit, constant-time validate), RateLimiter (token bucket), InputValidator (local-only, JSON schema, type whitelist, XSS sanitization), WsSecurityGuard (combined) |
| `@c3/process-isolation` | ~220 | Bubblewrap probing (capabilities check), sandbox arg builder (ro-bind, bind, tmpfs, unshare-pid/net, die-with-parent), per-command network heuristic, security report generator |
| `@c3/security-audit` | ~350 | 26 predefined pen-test definitions, security model documentation, test categories (9 types), severity classification |

## Soubory

```
packages/
├── shell-security/
│   └── src/
│       ├── common/
│       │   └── shell-security-protocol.ts    Whitelist, blacklist, env patterns, types
│       └── node/
│           └── shell-security-service.ts     7-layer validate(), execute(), sanitizeEnv()
│
├── ws-security/
│   └── src/
│       └── node/
│           └── ws-security-service.ts        SessionToken, RateLimiter, InputValidator, Guard
│
├── process-isolation/
│   └── src/
│       └── node/
│           └── process-isolation-service.ts  Bubblewrap probe, sandbox args, network heuristic
│
├── security-audit/
│   └── src/
│       └── security-audit-protocol.ts        26 pen-tests, SECURITY_MODEL doc, report types
│
├── c3-backend/
│   └── sprint7-integration.js                All services in plain Node.js
│
└── tests/
    └── sprint7.test.js                       90 tests (all passing)
```

## Known Risks & Mitigations

| Risk | Severity | Mitigation |
|------|----------|------------|
| npm lifecycle scripts | High | `--ignore-scripts` forced on install/ci |
| Docker escape | Medium | Docker whitelisted but user-controlled |
| Symlink race | Low | `realpathSync()` before comparison |
| bwrap unavailable | Medium | Layers 1-5 still active, warning shown |
| LLM social engineering | Medium | All 7 layers code-enforced, not prompt-based |

## Prerekvizity

Sprint 1–6 (all previous packages)
