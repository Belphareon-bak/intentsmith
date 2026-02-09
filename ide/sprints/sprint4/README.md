# C3 IDE — Sprint 4: Diff Viewer + Code Review + Git Integration

## Přehled

Sprint 4 přidává kompletní review pipeline: agent navrhuje změny kódu jako diff,
uživatel je reviewuje (accept/reject/edit) v Monaco diff editoru, a přijaté změny
se automaticky commitnou s popisnou zprávou.

## Review Pipeline Lifecycle

```
BUILD → agent generuje diff(y)
      → createChangeSet() → patches do .c3/pending-diffs/
      → project.json: phase = "pending_review"
      → uživatel otevře IDE (i po restartu!)
      → Review Panel se otevře automaticky
      → uživatel reviewuje: Accept / Reject / Edit
      → "Apply Changes" → zápis na disk + auto-commit
      → project.json: phase = "build"
      → zpět do BUILD nebo další sprint
```

## Architektura

```
┌─────────────────────────────────────────────────────────────┐
│                                                             │
│  Agent (BUILD)                                              │
│  ├── Generuje unified diff pro každý soubor                │
│  ├── Posílá přes WS jako agent event                       │
│  └── Backend → DiffService.createChangeSet()               │
│                                                             │
│  .c3/pending-diffs/                                        │
│  ├── changeset.json         ← metadata + status            │
│  ├── lib_main.dart.patch    ← unified diff                 │
│  ├── lib_main.dart.mod      ← full modified content        │
│  └── lib_vpn.dart.patch                                    │
│                                                             │
│  ┌──────────────────────────────────────────────────────┐  │
│  │ Review Panel (right sidebar)                         │  │
│  │ ┌──────────────────────────────────────────────────┐ │  │
│  │ │ 🔍 Code Review — Sprint 1                       │ │  │
│  │ │ ███████████████░░░░░  2/3 reviewed               │ │  │
│  │ │ ✅ lib/main.dart          +12 -3                 │ │  │
│  │ │ ⏳ lib/vpn_service.dart   +45 -0  [✅] [❌]     │ │  │
│  │ │ ❌ test/bad_test.dart     +28 -0                 │ │  │
│  │ │ ──────────────────────────────────────────────── │ │  │
│  │ │ [✅ Accept All] [❌ Reject All]  [🚀 Apply]     │ │  │
│  │ └──────────────────────────────────────────────────┘ │  │
│  └──────────────────────────────────────────────────────┘  │
│                                                             │
│  ┌──────────────────────────────────────────────────────┐  │
│  │ Monaco Diff Editor (main area)                       │  │
│  │ ┌────────────────────┬────────────────────────────┐  │  │
│  │ │ Original           │ Modified (proposed)         │  │  │
│  │ │                    │                             │  │  │
│  │ │ void main() {      │ void main() {              │  │  │
│  │ │   print("hello");  │   print("greetings");  ← + │  │  │
│  │ │ }                  │   print("hello");          │  │  │
│  │ │                    │ }                           │  │  │
│  │ └────────────────────┴────────────────────────────┘  │  │
│  │ [✅ Accept] [✏️ Edit] [❌ Reject]                    │  │
│  └──────────────────────────────────────────────────────┘  │
│                                                             │
│  Git Integration (minimal)                                  │
│  ├── Auto-commit: feat(vpn): Add WireGuard tunnel          │
│  ├── Sprint branch: c3/sprint-1                             │
│  └── NO merge/rebase/push (user does that)                  │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

## Testy — 30/30

```
--- 1. Diff Parsing ---
  ✅ parse additions
  ✅ parse mixed
  ✅ parse new file
  ✅ parse deleted file
  ✅ parse empty diff

--- 2. Diff Application ---
  ✅ apply addition
  ✅ apply deletion
  ✅ apply replacement
  ✅ apply to empty (new file)

--- 3. ChangeSet Status ---
  ✅ all pending → pending
  ✅ mixed pending → pending
  ✅ all rejected → all_rejected
  ✅ all accepted → all_accepted
  ✅ mixed results → reviewed

--- 4. Commit Messages ---
  ✅ standard message format
  ✅ fallback subject

--- 5. DiffService Lifecycle ---
  ✅ create change set
  ✅ load change set
  ✅ accept first proposal
  ✅ accept second → all_accepted
  ✅ apply accepted
  ✅ status is applied

--- 6. Reject Flow ---
  ✅ reject all

--- 7. Edit Flow ---
  ✅ edit proposal

--- 8. Atomic Write ---
  ✅ atomic write
  ✅ atomic write JSON
  ✅ no leftover tmp

--- 9. Rehydration ---
  ✅ rehydrate pending change set

--- 10. Git Integration ---
  ✅ git service on non-repo returns false
  ✅ git service on real repo
```

## Kontrakty dodržené

| Kontrakt | Implementace |
|---|---|
| Crash Consistency | atomicWrite: tmp → fsync → rename (POSIX atomic) |
| PENDING_REVIEW persistence | changeset.json + project.json přežijí restart |
| Rehydration | loadChangeSet() obnoví stav z .c3/pending-diffs/ |
| Git shell: false | GitService.git() uses argv-based spawn, no shell |
| Sprint branches | c3/sprint-N, no merge/push |
| Auto-commit | Descriptive message from agent context |

## Commit Message Format

```
feat(vpn): Add WireGuard tunnel configuration

C3 Agent — Sprint 1, Step 3

- Added VPN service with WireGuard integration
- Added connection state management
- Added unit tests for tunnel lifecycle

Intent: BUILD
Project: Mobilní app
```

## Soubory

```
packages/
├── diff-viewer/                            @c3/diff-viewer
│   └── src/
│       ├── common/
│       │   └── diff-viewer-protocol.ts         Types, ChangeSet, Proposal, ApplyResult
│       ├── node/
│       │   ├── diff-viewer-service.ts          FS storage, diff parsing, apply logic
│       │   └── diff-viewer-module.ts           Backend DI
│       └── browser/
│           ├── diff-proposal-manager.ts        Monaco diff editor opener, virtual docs
│           ├── diff-viewer-module.ts           Frontend DI
│           ├── components/
│           │   ├── DiffToolbar.tsx              Accept/Reject/Edit buttons + file info
│           │   └── InlineDiff.tsx               Colored diff lines (fallback renderer)
│           └── styles/
│               └── diff-viewer.css             Toolbar, buttons, inline diff, status badges
│
├── review-panel/                           @c3/review-panel
│   └── src/
│       ├── common/
│       │   └── review-panel-protocol.ts        Widget ID, ReviewPanelState
│       └── browser/
│           ├── review-panel-widget.tsx          Main widget: file list, progress, bulk actions
│           ├── review-panel-contribution.ts     Theia registration, auto-open on pending_review
│           ├── review-panel-module.ts           Frontend DI
│           ├── components/
│           │   └── ReviewItem.tsx               Single file row: icon, stats, inline actions
│           └── styles/
│               └── review-panel.css            List, progress bar, footer, empty state
│
├── git-integration/                        @c3/git-integration
│   └── src/
│       ├── common/
│       │   └── git-integration-protocol.ts     CommitRequest, BranchInfo, CommitMessage
│       └── node/
│           ├── git-integration-service.ts      Auto-commit, sprint branches, argv spawn
│           └── git-integration-module.ts       Backend DI
│
├── c3-backend/
│   └── sprint4-integration.js              Backend: DiffService + GitService + ReviewPipeline
│
└── tests/
    └── sprint4.test.js                     30 tests (all passing)
```

## Prerekvizity

- Sprint 1 (Chat, Agent Log, WS connection)
- Sprint 2 (ShellTool, ProjectStore — pending_changes, phase management)
- Sprint 3 (Command Palette, Notifications — phase change notifications)
