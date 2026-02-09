# C3 IDE — Sprint 6: Multi-project + Advanced Features

## Přehled

Sprint 6 přidává multi-project workspace, fulltext vyhledávání v chat historii,
token usage dashboard a Electron packaging konfiguraci.

## Architektura

```
┌─────────────────────────────────────────────────────────────────┐
│ Workspace                                                       │
│                                                                 │
│  c3-workspace/                                                  │
│  ├── projects/                                                  │
│  │   ├── mobilni-aplikace/     ← project.json + design/ + src/ │
│  │   └── e-shop-backend/       ← project.json + src/           │
│  └── .c3/                                                      │
│      ├── settings.json         ← activeProject slug            │
│      ├── trash/                ← soft-deleted projects         │
│      └── global-history.jsonl                                  │
│                                                                 │
│  ┌──────────────────────────────────────────────────────┐      │
│  │ Project Switcher (Ctrl+Shift+W)                      │      │
│  │ 📐 Mobilní aplikace (DESIGN, krok 12) ← aktivní     │      │
│  │ 🔨 E-shop backend (BUILD, sprint 3)                  │      │
│  │ 💬 Bez projektu (volná konverzace)                   │      │
│  │ + Nový projekt...                                    │      │
│  └──────────────────────────────────────────────────────┘      │
│                                                                 │
│  ┌──────────────────────────────────────────────────────┐      │
│  │ Chat Search (Ctrl+Shift+H)                           │      │
│  │ 🔍 [WireGuard_________________________]              │      │
│  │ Filter: [Všechny role ▼]                             │      │
│  │ ────────────────────────────────────────────────      │      │
│  │ 💬 user: ...text with «WireGuard» VPN...             │      │
│  │    14:32 — mobilni-aplikace                          │      │
│  │ 🤖 assistant: ...«WireGuard» tunnel config...        │      │
│  │    14:33 — mobilni-aplikace                          │      │
│  │ ────────────────────────────────────────────────      │      │
│  │ 2 výsledků (3ms)                                     │      │
│  └──────────────────────────────────────────────────────┘      │
│                                                                 │
│  ┌──────────────────────────────────────────────────────┐      │
│  │ 📊 Token Usage                                       │      │
│  │ ┌────────────┬────────────┐                          │      │
│  │ │ Dnes       │ Tento týden│                          │      │
│  │ │ 12.5k      │ 87.2k     │                          │      │
│  │ ├────────────┼────────────┤                          │      │
│  │ │ Projekt    │ Cena       │                          │      │
│  │ │ 145.8k     │ ~$2.34    │                          │      │
│  │ └────────────┴────────────┘                          │      │
│  │ Podle intentu:                                       │      │
│  │ DESIGN      45%  ████████░░                          │      │
│  │ CODE        30%  ██████░░░░                          │      │
│  │ CONVERSATIONAL 25% █████░░░░                         │      │
│  │ Posledních 30 dní:                                   │      │
│  │ ▁▂▃▄▅▆▇█▅▃▂▁▂▃▅▇▆▅▃▂                               │      │
│  └──────────────────────────────────────────────────────┘      │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

## Testy — 37/37

```
--- 1. Slugify ---
  ✅ basic slug
  ✅ czech diacritics
  ✅ special chars
  ✅ leading/trailing hyphens stripped
  ✅ max 64 chars
  ✅ empty → projekt

--- 2. MultiProjectService ---
  ✅ scan empty workspace
  ✅ create project
  ✅ create second project
  ✅ scan workspace with 2 projects
  ✅ duplicate project throws
  ✅ switch project
  ✅ get active project
  ✅ switch to null (no project)
  ✅ delete project (soft)
  ✅ delete nonexistent throws

--- 3. ChatSearchService ---
  ✅ index and search basic
  ✅ search with diacritics
  ✅ search without diacritics finds diacritic content
  ✅ search returns snippets
  ✅ search with role filter
  ✅ search with project filter
  ✅ search no results
  ✅ bulk index
  ✅ search with limit
  ✅ get stats
  ✅ clear project removes entries
  ✅ search queryTime is fast

--- 4. TokenDashboardService ---
  ✅ record and get stats
  ✅ all-time includes all projects
  ✅ intent percentages add to 100
  ✅ daily usage present
  ✅ get records with filter
  ✅ clear project removes records
  ✅ model breakdown

--- 5. Search Performance ---
  ✅ index 1000 messages < 200ms
  ✅ search 1000 messages < 50ms
```

## Packages

| Package | Řádků | Co dělá |
|---|---|---|
| `@c3/multi-project` | ~620 | Workspace scan, project CRUD (create/switch/delete), slugify s diakritikou, soft-delete do .c3/trash/, QuickPick switcher (Ctrl+Shift+W) |
| `@c3/chat-search` | ~570 | In-memory inverted index, diacritic-aware tokenizer, TF scoring + position bonus, snippet extraction s «highlighted» terms, role/project/date filtry |
| `@c3/token-dashboard` | ~530 | Token usage recording + JSONL persistence, stats aggregace (today/week/project/allTime), intent/model breakdown s procenty, daily sparkline chart, cost estimation |
| `@c3/release` | ~200 | Electron builder config (AppImage + deb), release checklist (14 items), performance targets, Theia app config |

## Klíčové features

**Multi-project:**
- `projects/` directory s project.json per projekt
- Switcher: Ctrl+Shift+W → QuickPick se všemi projekty
- Phase icons: 📐 DESIGN, 🔨 BUILD, 🔍 REVIEW, 💤 IDLE, 💬 volná konverzace
- Soft-delete: přesune do `.c3/trash/slug-timestamp/`
- Slugify: NFD diacritics stripping, max 64 chars

**Chat Search:**
- Diacritic-aware: "architektura" najde "architekturu" (NFD normalization)
- Inverted index: O(1) lookup per token, intersection pro multi-word queries
- Scoring: TF + position bonus + recency bonus
- Snippets: ±40 chars kolem matche, «highlighted» terms
- Filtry: role (user/assistant), project, date range
- Performance: 1000 zpráv index < 200ms, search < 50ms

**Token Dashboard:**
- Per-turn recording: inputTokens, outputTokens, model, intent
- Stats: today, thisWeek, project, allTime
- Intent breakdown: DESIGN 45%, CODE 30%, CONVERSATIONAL 25%
- Model breakdown: claude-3-sonnet 80%, local 20%
- Daily sparkline: ▁▂▃▄▅▆▇█ (posledních 30 dní)
- Cost estimation: per-model pricing tables

**Release:**
- Electron builder: AppImage + deb (Linux MVP)
- 14-item release checklist (7 functional, 2 security, 3 performance, 2 docs)
- Performance targets: startup <3s, chat render <50ms, agent event <10ms

## Soubory

```
packages/
├── multi-project/                      @c3/multi-project
│   └── src/
│       ├── common/
│       │   └── multi-project-protocol.ts   Types, WorkspaceInfo, ProjectEntry, phase icons
│       ├── node/
│       │   └── multi-project-service.ts    Scan, create, switch, delete, slugify
│       └── browser/
│           └── project-switcher-contribution.ts  QuickPick, Ctrl+Shift+W, new project dialog
│
├── chat-search/                        @c3/chat-search
│   └── src/
│       ├── common/
│       │   └── chat-search-protocol.ts     ChatIndexEntry, SearchQuery/Result/Response
│       ├── node/
│       │   └── chat-search-service.ts      Inverted index, tokenizer, scoring, snippets
│       └── browser/
│           ├── components/
│           │   └── ChatSearchWidget.tsx     Search input, result list, debounce, filters
│           └── styles/
│               └── chat-search.css         Input, results, snippets, highlight marks
│
├── token-dashboard/                    @c3/token-dashboard
│   └── src/
│       ├── common/
│       │   └── token-dashboard-protocol.ts TokenUsageRecord, TokenStats, pricing tables
│       ├── node/
│       │   └── token-dashboard-service.ts  Recording, stats aggregation, JSONL persistence
│       └── browser/
│           ├── components/
│           │   └── TokenDashboardWidget.tsx Summary cards, intent bars, sparkline chart
│           └── styles/
│               └── token-dashboard.css     Cards grid, bars, sparkline, cost highlight
│
├── release/
│   └── src/
│       └── release-config.ts           Electron builder, checklist, perf targets, Theia config
│
├── c3-backend/
│   └── sprint6-integration.js          All 3 services in plain Node.js
│
└── tests/
    └── sprint6.test.js                 37 tests (all passing)
```

## Prerekvizity

Sprint 1–5 (Chat, Agent Log, WS, ShellTool, ProjectStore, StatusBar,
Design Viewer, Command Palette, Notifications, Diff Viewer, Review Panel,
Git, Error Recovery, Project Export, Settings, Onboarding)
