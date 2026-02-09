# C3 IDE — Sprint 2: ShellTool + Project Store + Status

## Přehled

Sprint 2 přidává tři pilíře: bezpečné spouštění shell příkazů,
persistentní projekt stav, a statusbar zobrazení fáze.

## Architektura

```
┌─────────────────────────────────────────────────────────────┐
│ C3 IDE (Theia)                                              │
│                                                             │
│  ┌──────────────────┐   ┌───────────────────┐               │
│  │ Status Widget    │   │ Agent Panel       │               │
│  │ 🟢 DESIGN step 3│   │ (Shell events)    │               │
│  └──────┬───────────┘   └──────┬────────────┘               │
│         │                      │                            │
│  ┌──────┴──────────────────────┴──────────────────────────┐ │
│  │  ShellToolService                                      │ │
│  │  ┌─────────┐ ┌──────────┐ ┌──────┐ ┌───────┐ ┌──────┐│ │
│  │  │Whitelist│→│Arg Block │→│ npm  │→│ cwd   │→│spawn ││ │
│  │  │Layer 1  │ │Layer 2   │ │inv.  │ │Layer 4│ │sh:no ││ │
│  │  └─────────┘ └──────────┘ └──────┘ └───────┘ └──────┘│ │
│  │              + Capability Matrix + Git Dirty Tree      │ │
│  └────────────────────────────────────────────────────────┘ │
│                                                             │
│  ┌──────────────────────┐  ┌────────────────────────┐       │
│  │ ProjectStoreService  │  │ AuditTrailService      │       │
│  │ project.json         │  │ events.jsonl           │       │
│  │ atomic write         │  │ append-only            │       │
│  │ schema migration     │  │ turn lifecycle         │       │
│  └──────────────────────┘  └────────────────────────┘       │
└─────────────────────────────────────────────────────────────┘
```

## Kontrakty dodržené v této implementaci

| Kontrakt | Implementace |
|---|---|
| Capability Matrix | `CAPABILITY_MATRIX` dict → validace před každým spawn |
| npm --ignore-scripts | `sanitizeNpmArgs()` auto-inject na install/ci/add |
| npm script confirmation | `checkNpmScriptConfirmation()` → UI dialog |
| Git dirty tree | `checkGitDirtyTree()` → git status --porcelain |
| Crash consistency | `atomicWriteJson()` → tmp + fsync + rename |
| Turn lifecycle | AuditTrail: `turn_start`/`turn_end` s status |
| argv-based spawn | `spawn(cmd, args, { shell: false })` — VŽDY |

## Bezpečnostní model (7 vrstev)

```
Request
  │
  ▼
[Layer 0] Capability Matrix — intent SMÍÁ spouštět shell?
  │
  ▼
[Layer 1] Command Whitelist — je binary v seznamu?
  │
  ▼
[Layer 2] Arg Blacklist — není -e, -c, --exec, --eval?
  │
  ▼
[npm inv.] sanitizeNpmArgs — --ignore-scripts na install
  │
  ▼
[npm scr.] checkNpmScriptConfirmation — user approval pro run/test
  │
  ▼
[Layer 4] cwd Sandbox — resolvedCwd.startsWith(projectRoot)?
  │
  ▼
[git inv.] checkGitDirtyTree — git status === clean?
  │
  ▼
[Layer 5] env Sanitization — strip SECRET/TOKEN/KEY/PASSWORD
  │
  ▼
[Layer 3] spawn(binary, argv, { shell: false }) ← CRITICAL
  │
  ▼
[Layer 7] Timeout → SIGTERM → 5s grace → SIGKILL
```

## Soubory

```
packages/
├── shell-bridge/                       @c3/shell-bridge (ShellTool)
│   └── src/
│       ├── common/
│       │   └── shell-bridge-protocol.ts    Types, CapabilityMatrix, whitelist
│       └── node/
│           ├── shell-tool-service.ts       Full implementation (7 layers)
│           ├── shell-bridge-module.ts      Theia backend DI
│           └── __tests__/
│               └── shell-security.test.ts  Security test matrix (25 tests)
│
├── project-store/                      @c3/project-store (Persistence)
│   └── src/
│       ├── common/
│       │   └── project-store-protocol.ts   C3Project type, service interface
│       └── node/
│           ├── project-store-service.ts    Atomic write, migration, auto-save
│           └── project-store-module.ts     Theia backend DI
│
├── audit-trail/                        @c3/audit-trail (Event log)
│   └── src/node/
│       └── audit-trail-service.ts      Append-only JSONL, seq resume, rotation
│
├── status-widget/                      @c3/status-widget (Statusbar)
│   └── src/browser/
│       ├── status-widget-contribution.ts  StatusBar items + quick pick
│       ├── status-widget-module.ts        Theia frontend DI
│       └── styles/
│           └── status-widget.css          Phase colors, status badge
│
└── c3-backend/                         Backend integration
    └── sprint2-integration.js          ShellExecutor + AuditTrail + ProjectStore
```

## Testování

### Security test matrix
```bash
npx jest packages/shell-bridge/src/node/__tests__/shell-security.test.ts
```

Testy pokrývají:
- Command whitelist (sh, bash, rm, wget, /bin/sh, ./exploit.sh)
- Arg blacklist (node -e, python -c, --eval, git --upload-pack)
- cwd sandbox (path traversal, absolute paths outside project)
- Capability matrix (DESIGN no shell, REVIEW read-only, CONVERSATIONAL no shell)
- npm invariant (--ignore-scripts inject, npm run/test requires confirmation)
- Kombinované útoky (valid cmd + code exec arg, valid cmd + cwd escape)

### Manuální test scénáře
1. `flutter test` přes BUILD intent → ✅ spustí se v agent terminálu
2. `npm install lodash` přes BUILD → ✅ přidá --ignore-scripts automaticky
3. `npm test` přes BUILD → ⚠️ dialog: "Povolit?" → user klikne Ano → ✅
4. `node -e "exec('rm -rf /')"` → ❌ ARG_BLOCKED
5. `git commit` přes REVIEW → ❌ READONLY_DENIED
6. `flutter test` přes DESIGN → ❌ CAPABILITY_DENIED
7. Restart IDE → project.json se načte → statusbar zobrazí správnou fázi
8. Kill -9 IDE → project.json.bak existuje → recovery funguje

## Co NENÍ v tomto sprintu

- Terminal widget pro agent (rozhodnutí: používáme Theia terminal API,
  dedikovaný agent terminál se vytvoří v Sprint 3 spolu s Commands)
- bubblewrap sandboxing (Sprint 7)
- Symlink attack protection (Sprint 7)
- User confirmation UI dialog (Sprint 3 — potřebuje Command Palette)

## Prerekvizity

- Sprint 0 + 0.5 hotový (Theia shell, LSP)
- Sprint 1 hotový (Chat, Agent Log, WS connection)
