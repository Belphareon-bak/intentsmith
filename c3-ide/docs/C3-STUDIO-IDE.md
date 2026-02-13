# C3 Studio IDE — Kompletní dokumentace

## Přehled

C3 Studio je specializované IDE postavené na **Theia 1.65.2** (Electron), které slouží jako vizuální rozhraní pro C3-Agent systém. Nahrazuje standardní Theia UI vlastním modulárním rozhraním optimalizovaným pro AI-asistované workflow.

**Technologie:** Theia 1.65.2 / Lumino 2.5.0 / React 18 / Inversify DI / Electron

---

## Architektura

```
┌─────────────────────────────────────────────────────────┐
│                    Electron Shell                         │
│  ┌──────────┬──────────────────────┬──────────────────┐  │
│  │ Sidebar  │    Center View       │   Chat Panel     │  │
│  │ (left)   │    (main area)       │   (right)        │  │
│  │          │                      │                  │  │
│  │ Nav      │ Experts/Projects/    │ Session 1..3     │  │
│  │ Working  │ Conversations/       │ Feed + Input     │  │
│  │ Tree     │ Specialists/Workers/ │ Autocomplete     │  │
│  │ Settings │ Settings + Detail    │ Edit mode        │  │
│  ├──────────┴──────────────────────┴──────────────────┤  │
│  │              Bottom Panel (Agent)                    │  │
│  │  Session 1..3 × [Split | Mix | Terminal | Log]      │  │
│  └────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────┘
```

### Hlavní modul
`extensions/c3-chat-panel/lib/browser/chat-panel-module.js`

Jediný soubor (~850 řádků) obsahuje všechny widgety, UI komponenty a logiku. Registruje se jako Inversify `ContainerModule` a přebírá kontrolu nad celým Theia layoutem.

### Widgety (Theia/Lumino)

| Widget | ID | Theia Area | Popis |
|---|---|---|---|
| `C3SidebarWidget` | `c3-sidebar` | left | Navigace, working tree, nastavení |
| `C3CenterWidget` | `c3-center-view` | main | Karty/seznamy, detail panel, settings |
| `C3ChatWidget` | `c3-chat-panel` | right | Chat s AI, split relace |
| `C3AgentWidget` | `c3-agent-panel` | bottom | Terminal, agent log, split/mix |

Všechny widgety extendují `ReactWidget` ale používají manuální `ReactDOM.render` pro plnou kontrolu nad DOM.

---

## Sdílené relace (Sessions)

Klíčový koncept — **chat a spodní panel jsou propojené přes relace**.

```js
_sessionCount = 1..3     // počet aktivních relací
_sessionActive = 0..2    // aktuálně fokusovaná relace
_sessions = [{
  chat: {
    msgs: [],            // historie zpráv
    ctx: 0,              // % zaplnění kontextu (z backendu)
    expert: 'Výchozí',   // aktuální expert
    editMode: 'auto',    // 'auto' | 'ask' — režim editace
    acSuggestion: null,   // autocomplete návrh
    attachments: []       // připojené soubory
  },
  bottom: 'split',       // 'split' | 'mix' | 'terminal' | 'agent'
  log: [],               // agent log záznamy pro tuto relaci
  term: []               // terminálový výstup pro tuto relaci
}]
```

- Tlačítka "Relace 1/2/3" jsou v obou panelech a jsou **synchronizovaná**
- Změna počtu relací v jednom panelu automaticky aktualizuje druhý
- Každá relace má svůj vlastní chat, expert, log, terminal

---

## Chat Panel

### Funkce
- **Autocomplete**: Tab klávesa odešle `POST /api/autocomplete` s částečným textem, kontextem posledních zpráv a expertem. Návrh se zobrazí jako ghost text pod inputem, další Tab ho přijme.
- **Edit mode**: Přepínač `Auto` / `Dotaz` v dolní liště
  - `Auto (▶▶)`: Agent edituje soubory automaticky
  - `Dotaz (✋)`: Agent pošle `edit_request` přes WebSocket, uživatel musí schválit
- **Context meter**: Ukazatel zaplnění kontextu volá `POST /api/context` po každém odeslání zprávy + reaguje na `context_update` WebSocket events
- **Expert picker**: Oblíbení nahoře, "Zobrazit vše" pro kompletní seznam
- **Přílohy**: Drag & drop nebo klik na 📎, souborové chipy s odebíráním

### WebSocket protokol (`ws://localhost:3335/ws`)

**Klient → Server:**
```json
{
  "type": "chat",
  "message": "text zprávy",
  "expert": "Developer",
  "editMode": "auto",
  "sessionId": 0
}
```

**Server → Klient:**
```json
// Chat odpověď
{"type": "chat_response", "text": "...", "tag": "LLM", "contextPercent": 42, "sessionId": 0}

// Agent log
{"type": "agent_log", "logType": "TOOL", "text": "...", "sessionId": 0}

// Terminálový výstup
{"type": "terminal", "text": "~/c3 $ npm test", "accent": false, "sessionId": 0}

// Aktualizace kontextu
{"type": "context_update", "percent": 55, "sessionId": 0}

// Žádost o schválení editace (edit_mode=ask)
{"type": "edit_request", "file": "src/server.js", "diff": "...", "sessionId": 0}
```

---

## Center View

### Sekce
| View | Data | Akce | Přidání |
|---|---|---|---|
| Experti | `EXPERTS[]` | Otevřít, Editovat | ✅ + Nový |
| Projekty | `PROJECTS[]` | Otevřít, Editovat, Archivovat | ✅ + Nový |
| Konverzace | `CONVERSATIONS[]` | Otevřít, Archivovat | ✅ + Nový |
| Specialisté | `SPECIALISTS[]` | Otevřít, Editovat | ✅ + Nový |
| Workeri | `WORKERS[]` | Spustit, Pozastavit, Editovat | ✅ + Nový |
| Nastavení | `SETTINGS_SECTIONS[]` | — | — |

### Zobrazení
- **Dlaždice** — grid s auto-fill, zoom mění velikost dlaždic (3 úrovně)
- **Seznam** — řádkový seznam, zoom škáluje výšku řádků, font a emoji

### Detail panel
- Pravý sloupec (280px) s poli, tagy, akcemi
- **Editace**: Pole se změní na inputy, akce na Uložit/Zrušit
- **Relace picker**: Při 2+ relacích se zobrazí "OTEVŘÍT V RELACI" s tlačítky 1/2/3

---

## Bottom Panel

### 4 režimy (na záložkách)
| Režim | Popis |
|---|---|
| **Split** | Agent Log vlevo, Terminal vpravo |
| **Mix** | Prokládaný výstup — log + terminal v jednom streamu |
| **Terminal** | Jen terminálový výstup |
| **Log** | Jen agent log |

Číslo relace se zobrazuje vpravo v záhlaví.

---

## Sidebar

### Navigace
5 sekcí s ikonami, badge počty, dropdown s recent položkami:
- Konverzace, Projekty, Specialisté, Experti, Workeri

### Working Tree
- **Collapse/Expand**: Klik na adresář (▶/▼)
- **Git status**: M (modified), A (added), D (deleted) — barevně odlišeno
- **Toolbar**: ↑ (sbalit vše), 📄 (nový soubor), 📁 (nová složka)
- **Klik na soubor**: Označí jako aktivní (green highlight)

### Collapsed mode
Při šířce < 48px se sidebar přepne do icon-only režimu s tooltips.

---

## Appearance System

### Témata
- Tmavé (`_darkC`), Světlé (`_lightC`), Systém (auto-detect)
- CSS proměnné: `--c3-bg0` až `--c3-bg5`, `--c3-tx1/tx2`, `--c3-accent`, `--c3-border/border2`

### Barvy
8 accent palet + 2 custom color pickers:
`green, blue, purple, pink, orange, white, red, cyan`

### Pozadí
5 preset: Výchozí, Antracit, Noční modř, Custom 1, Custom 2
- Pozadí se blenduje přes `_cl()` (color lerp) pro generování bg1-bg5

### Intenzita
- Aktivní prvky: 10-100% (interpolace mezi muted a full accent)
- Neaktivní prvky: 0-100% (interpolace od šedé k accent)

### Persistence
Všechna nastavení se ukládají do `localStorage['c3-settings']` a načítají při startu.

---

## Backend API (očekávané endpointy)

| Endpoint | Method | Popis |
|---|---|---|
| `/chat` | POST | Odeslání zprávy (fallback pro WS) |
| `/api/autocomplete` | POST | Autocomplete návrh |
| `/api/context` | POST | Dotaz na zaplnění kontextu |
| `/api/projects` | GET | Seznam projektů |
| `/api/projects/:id` | PATCH/DELETE | Editace/archivace projektu |
| `/api/experts` | GET | Seznam expertů |
| `/api/experts/:id` | PATCH | Editace experta |
| `/api/conversations` | GET | Seznam konverzací |
| `/api/conversations/:id` | GET/DELETE | Detail/archivace konverzace |
| `/api/conversations/:id/messages` | GET | Zprávy konverzace |
| `/api/agents` | GET | Seznam workerů |
| `/api/agents/:id/run` | POST | Spuštění workeru |
| `/api/agents/:id/disable` | POST | Pozastavení workeru |
| `/health` | GET | Health check |
| `ws://localhost:3335/ws` | WS | Real-time komunikace |

---

## Build & Launch

```bash
cd c3-ide
yarn build          # ~55s, webpack frontend + backend
node applications/electron/scripts/launch.js  # spustí Electron
```

---

## Klíčové funkce (utility)

| Funkce | Popis |
|---|---|
| `_hp(hex)` | Hex → [R,G,B] |
| `_hs(r,g,b)` | RGB → Hex string |
| `_cl(a,b,t)` | Color lerp (linear interpolation) |
| `_mkPalette(hex)` | Generuje kompletní paletu z jedné barvy |
| `_applyTheme()` | Aplikuje téma (bg0-bg5, tx1-tx2, borders) |
| `_applyAccent()` | Aplikuje accent barvu + intenzity |
| `_applyFont()` | Aplikuje font family |
| `_applyAllSettings()` | Řetězec: theme → accent → font → re-render |
| `renderSidebar()` | Re-render sidebar |
| `renderCenter()` | Re-render center view |
| `renderChat()` | Re-render chat panel |
| `renderAgent()` | Re-render bottom panel |
| `_setSessionCount(n)` | Změní počet relací (sync chat + bottom) |
