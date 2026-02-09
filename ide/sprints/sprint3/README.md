# C3 IDE — Sprint 3: DESIGN Viewer + Command Palette

## Přehled

Sprint 3 přidává vizualizaci designového výstupu, C3-specific command palette
s klávesovými zkratkami, notifikace pro agent eventy, a context menu v file tree.

## Architektura

```
┌──────────────────────────────────────────────────────────────┐
│ C3 IDE (Theia)                                               │
│                                                              │
│  ┌─────────────────────────────────────────────────────────┐ │
│  │ Command Palette (Ctrl+Shift+P)                          │ │
│  │ ┌──────────────────────┐  ┌───────────────────────────┐ │ │
│  │ │ C3: Nový projekt     │  │ Quick Chat (Ctrl+K)       │ │ │
│  │ │ C3: Spustit build    │  │ 💬 "přirozený jazyk"      │ │ │
│  │ │ C3: Code review      │  │     ↓ CRE routing         │ │ │
│  │ │     ↓ DIRECT handler  │  └───────────────────────────┘ │ │
│  │ └──────────────────────┘                                 │ │
│  └─────────────────────────────────────────────────────────┘ │
│                                                              │
│  ┌────────────────────────────────────────────────────┐      │
│  │ Design Viewer                                      │      │
│  │ ┌──────────┬───────────────────────────────────────┤      │
│  │ │ Outline  │  📐 Architecture  │  📋 Sprints       │      │
│  │ │          │                                       │      │
│  │ │ ▸ Stack  │  [Metadata Cards]                     │      │
│  │ │ ▸ Sprint │  [Markdown Content]                   │      │
│  │ │ ▸ Risks  │                                       │      │
│  │ └──────────┴───────────────────────────────────────┘      │
│  │ Source: design/*.md + project.json (NEVER chat)    │      │
│  └────────────────────────────────────────────────────┘      │
│                                                              │
│  ┌──────────────────┐  ┌───────────────────────────────┐     │
│  │ Notifications     │  │ Context Menu (file tree)      │     │
│  │ ✅ Task done      │  │ C3: Review tento soubor       │     │
│  │ ❌ Error → log    │  │ C3: Vysvětli tento soubor     │     │
│  │ 🛡️ Shell blocked  │  │ C3: Refaktoruj               │     │
│  └──────────────────┘  │ C3: Přidej testy              │     │
│                         └───────────────────────────────┘     │
│  ┌─────────────────────────────────────────────────────────┐ │
│  │ Statusbar                                               │ │
│  │ 🟢 C3 │ 📐 DESIGN (krok 12) │ 📱 Mobilní app          │ │
│  └─────────────────────────────────────────────────────────┘ │
└──────────────────────────────────────────────────────────────┘
```

## Kontrakty dodržené

| Kontrakt | Implementace |
|---|---|
| Chat ≠ Command Palette | Commands → `{ type: 'c3_command' }` BYPASSES CRE; Chat → `{ type: 'chat_message' }` → CRE |
| Design ≠ Conversation | Viewer reads ONLY `design/*.md` + `project.json`, NEVER chat |
| Design Files Immutability | `DesignImmutabilityGuard` marks `design/*.md` read-only + banner |
| Keyboard-first workflow | Every action accessible via keyboard shortcut |

## Klávesové zkratky

| Klávesa | Akce | Typ |
|---|---|---|
| `Ctrl+Shift+C` | Focus Chat panel | Navigation |
| `Ctrl+Shift+A` | Focus Agent Log | Navigation |
| `Ctrl+Shift+D` | Focus Design Viewer | Navigation |
| `Ctrl+K` | Quick Chat Input (→ CRE) | Chat |
| `F5` | Znovu spustit poslední příkaz | Agent |
| `Escape` | Zrušit operaci / Zavřít | Agent |
| `Enter` | Odeslat zprávu (v chatu) | Chat |
| `Shift+Enter` | Nový řádek (v chatu) | Chat |
| `Ctrl+Shift+P` | Command Palette (Theia) | Theia |

## Command Palette příkazy

```
C3: Nový projekt              → { name: 'new_project' }
C3: Pokračovat v návrhu       → { name: 'continue_design' }
C3: Zobrazit design           → { name: 'show_design' }
C3: Spustit build             → { name: 'start_build' }
C3: Code review               → { name: 'start_review' }
C3: Uzavřít projekt           → { name: 'close_project' }
C3: Exportovat projekt        → { name: 'export_project' }
C3: Zobrazit historii         → { name: 'show_history' }
C3: Zobrazit Agent Log        → { name: 'show_agent_log' }
C3: Vyčistit chat             → { name: 'clear_chat' }
C3: Reconnect k backendu      → { name: 'reconnect' }
C3: Odemknout design soubory  → { name: 'unlock_design' }
C3: Zobrazit klávesové zkratky
```

## Context Menu (File Tree)

```
Pravý klik na soubor:
├── C3: Review tento soubor     → { name: 'review_file', payload: { filePath } }
├── C3: Vysvětli tento soubor   → { name: 'explain_file', payload: { filePath } }
├── C3: Refaktoruj tento soubor → { name: 'refactor_file', payload: { filePath } }
└── C3: Přidej testy            → { name: 'add_tests', payload: { filePath } }
```

## Notifikace

| Event | Typ | Chování |
|---|---|---|
| `turn_end(ok)` | info | Toast, auto-dismiss 5s |
| `turn_end(error)` | error | Persistent + "Zobrazit log" |
| `turn_end(cancelled)` | info | Toast, auto-dismiss 3s |
| `turn_end(timeout)` | warn | Persistent + "Zobrazit log" |
| `shell_blocked` | warn | Toast 8s + "Zobrazit log" |
| `gate_verdict(fail)` | warn | Toast + details |
| `cre_decision(low conf)` | info | Toast (confidence < 60%) |
| `error(unrecoverable)` | error | Persistent + "Zobrazit log" |
| `status → disconnected` | warn | Persistent |
| Phase change | info | Toast |
| Build result | info/error | Toast or persistent |

## Soubory

```
packages/
├── design-viewer/                          @c3/design-viewer
│   └── src/
│       ├── common/
│       │   └── design-viewer-protocol.ts       Types, immutability constants
│       ├── node/
│       │   ├── design-viewer-service.ts        FS loader, outline parser, watcher
│       │   └── design-viewer-module.ts         Backend DI
│       └── browser/
│           ├── design-viewer-widget.tsx         Main ReactWidget (tabs, outline, MD)
│           ├── design-viewer-contribution.ts    Theia widget registration
│           ├── design-viewer-module.ts          Frontend DI
│           ├── design-immutability-guard.ts     Read-only guard + unlock command
│           ├── components/
│           │   ├── OutlineSidebar.tsx            Navigable section tree
│           │   └── MetadataCards.tsx             Stack, decisions, sprint cards
│           └── styles/
│               └── design-viewer.css            Split layout, outline, markdown
│
├── command-palette/                        @c3/command-palette
│   └── src/browser/
│       ├── command-palette-contribution.ts  All C3 commands + Quick Chat + keybindings
│       └── command-palette-module.ts        Frontend DI
│
├── context-menu/                           @c3/context-menu
│   └── src/browser/
│       ├── context-menu-contribution.ts     File tree right-click C3 actions
│       └── context-menu-module.ts           Frontend DI
│
├── notifications/                          @c3/notifications
│   └── src/browser/
│       ├── notification-service.ts          Rule-based agent event notifications
│       └── notification-module.ts           Frontend DI
│
└── keybindings/                            @c3/keybindings
    └── src/browser/
        ├── keybindings-contribution.ts      Keymap reference + cheat sheet command
        └── keybindings-module.ts            Frontend DI
```

## Prerekvizity

- Sprint 1 (Chat, Agent Log, WS connection)
- Sprint 2 (ShellTool, ProjectStore, StatusBar)
