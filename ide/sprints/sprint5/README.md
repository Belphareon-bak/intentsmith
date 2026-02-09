# C3 IDE — Sprint 5: UX Stabilization

## Přehled

Sprint 5 dodává production-ready UX: error recovery s exponential backoff,
LLM timeout handling, crash recovery, project export/import (zip), uživatelská
nastavení (20 preference keys), a first-run onboarding.

## Packages

### 1. @c3/error-recovery

**ReconnectionManager** — exponential backoff reconnection:
```
Backend spadne
→ Statusbar 🔴 DISCONNECTED
→ Auto-reconnect: 0ms → 1s → 2s → 4s → 8s → 16s → 30s (cap)
→ ± 500ms jitter (anti thundering herd)
→ Po reconnect: rehydratace + "⚠️ Reconnected after 12s"
```

**LlmTimeoutManager** — three-tier timeout:
```
LLM request starts
→ 30s: onWarning — "Trvá déle než obvykle..."
→ 60s: onHardTimeout — [Cancel] [Počkat] buttons
→ 120s: onKill — auto-cancel, agent → IDLE
```

**CrashRecoveryService** — IDE restart recovery:
```
IDE crash / kill -9
→ Restart → loadProject(project.json) → rehydrate
→ loadChatHistory(conversation.jsonl)
→ checkPendingReview → auto-open Review Panel
→ "🔄 Session obnovena z disku"
```

### 2. @c3/project-export

**Export:**
```
C3: Exportovat projekt →
test-app-export-2026-02-09.zip
├── project.json
├── design/architecture.md, sprints.md
├── src/                    (volitelné)
├── chat/conversation.jsonl (volitelné)
└── agent-log/events.jsonl  (volitelné)
```

**Import:**
```
C3: Importovat projekt → select zip
→ validateImport() — checks project.json exists, has name/phase
→ extractZip() → rehydrate
→ "Projekt 'Test App' načten (fáze: DESIGN)"
```

**Validation:** checks project.json existence, name field, phase field, reports warnings.

### 3. @c3/settings

20 preference keys registered in Theia Preferences:

| Category | Keys | Examples |
|---|---|---|
| Backend | 3 | url, autoReconnect, reconnectMaxDelay |
| Chat | 4 | fontSize, showIntentBadges, showTimestamps, maxHistory |
| Agent | 3 | autoScroll, verbosity (minimal/normal/verbose), showTokenCounts |
| Shell | 2 | timeout, maxOutput |
| Project | 2 | autoSaveInterval, gitAutoCommit |
| Export | 3 | includeChat, includeAgentLog, includeSrc |
| UI | 2 | language (cs/en), theme (dark/light) |

All have JSON Schema with types, defaults, min/max, enums, Czech descriptions.

### 4. @c3/onboarding

4-step first-run wizard:

```
Step 0: Vítej v C3 Studio! — intro
Step 1: Připojení k backendu — URL input + test connection
Step 2: Rychlý přehled — Chat, Agent Log, Design Viewer, Code Review, Quick Chat
Step 3: Vše připraveno! — example prompt suggestion
```

Features: step indicator with animated dots, skip button, back/next navigation,
connection test with status feedback, localStorage completion flag,
re-trigger via "C3: Znovu spustit onboarding".

## Testy — 29/29

```
--- 1. ReconnectionManager ---
  ✅ initial state is disconnected
  ✅ notifyConnected sets state
  ✅ notifyDisconnected from connected
  ✅ exponential backoff delays (1→2→4→8→cap)
  ✅ resetBackoff clears state
  ✅ state change listener
  ✅ max attempts stops reconnection

--- 2. LlmTimeoutManager ---
  ✅ initial state not tracking
  ✅ startTracking sets state
  ✅ stopTracking clears

--- 3. CrashRecoveryService ---
  ✅ recover with no loaders
  ✅ recover with successful loaders
  ✅ recover handles loader errors gracefully

--- 4. Settings Defaults ---
  ✅ all required keys exist
  ✅ default types are correct
  ✅ default values are reasonable

--- Timer-based tests ---
  ✅ reconnected event fires after disconnect+reconnect
  ✅ LLM warning callback fires
  ✅ LLM kill callback fires and clears
  ✅ LLM stopTracking prevents callbacks

--- 5. ProjectExportService ---
  ✅ export creates zip
  ✅ export fails without project.json
  ✅ validate directory import
  ✅ validate rejects missing project.json
  ✅ validate rejects missing name
  ✅ validate zip import
  ✅ import from zip

--- 6. Helpers ---
  ✅ pathExists returns true for existing
  ✅ pathExists returns false for missing
```

## Soubory

```
packages/
├── error-recovery/                      @c3/error-recovery
│   └── src/browser/
│       ├── error-recovery-service.ts       ReconnectionManager + LlmTimeoutManager + CrashRecovery
│       └── error-recovery-module.ts        Frontend DI
│
├── project-export/                      @c3/project-export
│   └── src/
│       ├── common/
│       │   └── project-export-protocol.ts  ExportOptions, ImportValidation, ArchiveManifest
│       └── node/
│           ├── project-export-service.ts   zip/unzip via child_process (shell: false)
│           └── project-export-module.ts    Backend DI
│
├── settings/                            @c3/settings
│   └── src/
│       ├── common/
│       │   └── settings-protocol.ts        C3Settings interface + C3_DEFAULTS
│       └── browser/
│           ├── settings-contribution.ts    JSON Schema for Theia Preferences
│           └── settings-module.ts          Frontend DI (PreferenceContribution)
│
├── onboarding/                          @c3/onboarding
│   └── src/browser/
│       ├── onboarding-widget.tsx           4-step wizard, localStorage flag
│       ├── onboarding-contribution.ts      FrontendApplicationContribution, auto-show
│       ├── onboarding-module.ts            Frontend DI
│       ├── components/
│       │   └── OnboardingSteps.tsx         Welcome, Connect, Tour, Ready steps
│       └── styles/
│           └── onboarding.css              Dialog, steps, inputs, tour items, animations
│
├── c3-backend/
│   └── sprint5-integration.js           All services in plain Node.js (no deps)
│
└── tests/
    └── sprint5.test.js                  29 tests (all passing)
```

## Prerekvizity

Sprint 1–4 (Chat, Agent Log, WS, ShellTool, ProjectStore, StatusBar,
Design Viewer, Command Palette, Notifications, Diff Viewer, Review Panel, Git)
