# C3 IDE — Roadmap & Sprint Plan

> **v3 — rozšířeno o architektonické kontrakty (turn model, concurrency, protocol versioning, crash consistency)**

## Technologický základ

**Framework:** Eclipse Theia (EPL-2.0)
**Proč Theia:** Framework na stavění IDE, ne IDE samo — terminál, file tree, editor, panel system zadarmo. Custom extensions pro C3-specifické panely.

**LSP strategie:**
Odstraňujeme `@theia/plugin-ext-vscode` (VS Code compatibility layer + marketplace),
ale NECHÁVÁME `@theia/plugin-ext` v minimal konfiguraci — jen pro LSP hosting.
Bez toho Monaco nemá language intelligence (jen syntax highlighting).
Alternativa: vlastní LSP launcher per jazyk — ale to je 3× víc práce.

```
LSP konfigurace (Sprint 0.5):
├── Dart LSP      → dart language-server (flutter projects)
├── TypeScript    → typescript-language-server
├── Python        → pylsp nebo pyright
└── Ověřit: hover, go-to-def, diagnostics fungují
```

**Audit Trail (od Sprint 2):**
Všechny agent events se logují do `agent-log/events.jsonl` jako append-only log.
Cíl: deterministické přehrání session bez LLM (replay mode).

**Turn Lifecycle Model:**
Každý turn má explicitní `turn_start` a `turn_end` — bez nich replay
neví kde turn začíná, končí, ani jestli skončil úspěšně.

```
events.jsonl format:
{"seq":1,"turnId":"t-001","type":"turn_start","ts":"...","payload":{"input":"navrhni architekturu"}}
{"seq":2,"turnId":"t-001","type":"cre_decision","ts":"...","payload":{"intent":"DESIGN","confidence":0.92}}
{"seq":3,"turnId":"t-001","type":"llm_start","ts":"...","payload":{"model":"qwen2.5"}}
{"seq":4,"turnId":"t-001","type":"llm_done","ts":"...","payload":{"tokens_out":847}}
{"seq":5,"turnId":"t-001","type":"gate_verdict","ts":"...","payload":{"d61":"ok","d62":"ok"}}
{"seq":6,"turnId":"t-001","type":"turn_end","ts":"...","payload":{"status":"ok","duration_ms":2100}}
```

**turn_end.status hodnoty:**
- `ok` — turn dokončen normálně
- `cancelled_by_user` — uživatel stiskl Cancel
- `timeout` — LLM / ShellTool timeout
- `error` — neočekávaná chyba (+ error detail v payload)
- `interrupted` — nový user input přerušil běžící turn

Bez `turn_start`/`turn_end`:
- replay neumí spočítat trvání turnu
- neumíš porovnávat CRE chování mezi verzemi
- neumíš dělat regresní testy nad event logem
```

**Architektura:**

```
C3 IDE (Theia)
├── Theia Core (zdarma)
│   ├── Monaco Editor + LSP
│   ├── Terminal (xterm.js + PTY)
│   ├── File Tree + File Watcher
│   ├── Panel System (drag, resize, split)
│   └── Command Palette + Keybindings
│
├── C3 Extensions (custom)
│   ├── @c3/chat-panel
│   ├── @c3/agent-panel
│   ├── @c3/project-status
│   ├── @c3/shell-bridge
│   └── @c3/design-viewer
│
└── C3 Backend (existující)
    ├── CRE Decision Engine
    ├── DESIGN / BUILD / REVIEW pipeline
    ├── Output Gate (D6)
    └── LLM Orchestration (Ollama)
```

**Layout:**

```
┌──────────┬────────────────────────┬─────────────────┐
│ Project  │ Editor / Diff Viewer   │ C3 Chat         │
│ Tree     │                        │                 │
│          │                        │ [dialog only]   │
│          │                        │                 │
│          ├────────────────────────┤                 │
│          │ Agent Log              │                 │
│          │ CRE decisions, tools,  │                 │
│          │ gate verdicts, status  │                 │
│          ├────────────────────────┤                 │
│          │ Terminal               │                 │
│          │ $ flutter build apk    │                 │
└──────────┴────────────────────────┴─────────────────┘
```

---

## Architektonické kontrakty (platné napříč sprinty)

Tyto kontrakty MUSÍ platit vždy. Nejsou „nice to have" — bez nich
se systém rozbije po týdnech používání způsobem, který je těžké debugovat.

### Agent Execution Model (concurrency contract)

```
PRAVIDLA:
1. V jednu chvíli běží MAX 1 agent execution (turn).
   Žádný paralelismus. Queue size = 1 (ne neomezená).

2. Nový user input během execution:
   a) Pokud agent je v interruptible fázi (LLM streaming):
      → CANCEL current turn (turn_end.status = "interrupted")
      → Spustit nový turn
   b) Pokud agent je v non-interruptible fázi (ShellTool exec):
      → Enqueue (max 1 položka)
      → UI: "Agent pracuje... vaše zpráva bude zpracována po dokončení"

3. ShellTool execution:
   - Vždy blokující (agent čeká na výsledek)
   - Cancel = SIGTERM → 5s grace → SIGKILL
   - Timeout = stejné jako cancel

4. REVIEW phase:
   - Agent NIKDY nespouští shell automaticky
   - Jen uživatel může trigger "spusť testy"

5. Priorita signálů:
   CANCEL > USER_MESSAGE > AGENT_STEP

6. Všechny stavové přechody se logují do audit trailu.
```

**Interruptible vs non-interruptible fáze:**

| Fáze | Interruptible | Důvod |
|---|---|---|
| CRE classification | ✅ | Čistá funkce, žádný side-effect |
| LLM streaming | ✅ | Token stream se dá zastavit |
| ShellTool exec | ❌ | Process běží, musí se čistě ukončit |
| File write | ❌ | Atomický zápis, nesmí se přerušit |
| Gate validation | ✅ | Čistá funkce |

### Chat Input vs. Command Palette (UX invariant)

```
PRAVIDLO:
- Chat input    = VŽDY přirozený jazyk → CRE routing
- Command Palette = VŽDY imperativní IDE akce → přímé volání

NIKDY se nesmí smíchat.
```

**Proč:**
Pokud Command Palette posílá raw text do CRE, uživatel neví jestli
"review this file" je chat zpráva nebo IDE command. CRE bude routing
hádat, a bude hádat špatně.

**Technicky:**
```typescript
// Command Palette → vždy strukturovaný command, nikdy raw text
{ type: 'c3_command', name: 'review_file', payload: { path: 'lib/main.dart' } }

// Chat input → vždy raw text do CRE
{ type: 'chat_message', content: 'podívej se na main.dart' }
```

Command Palette commands OBCHÁZEJÍ CRE — jdou přímo na handler.
Chat messages VŽDY procházejí CRE.

### WebSocket Protocol Versioning

```
Při WS connect — povinný handshake:

IDE → Backend:
{ "type": "hello", "protocol_version": 1, "ide_version": "0.1.0" }

Backend → IDE:
{ "type": "hello_ack", "protocol_version": 1, "backend_version": "58.3" }

Nebo odmítnutí:
{ "type": "hello_reject", "reason": "Backend protocol v2 vyžaduje IDE ≥ 0.5.0" }
```

Bez toho: update backendu + starší IDE = tiché rozbití (nejhorší typ bugů).
Verze se zvyšuje při JAKÉKOLIV změně WS message formátu.

### Git Dirty Tree Invariant

```
PRAVIDLO:
Agent NIKDY NEMĚNÍ soubor, který má user local modifications.

Před každou file operací:
1. git status --porcelain
2. Pokud output !== "" (dirty tree):
   → Agent STOP
   → Chat: "Repo má necommitnuté změny. Prosím commitněte nebo stashněte."
   → Agent log: "GIT_DIRTY_TREE: blocked file write"
3. Teprve po clean tree → agent smí psát

VÝJIMKA:
- Soubory v .c3/ directory (agent metadata) — vždy zapisovatelné
- project.json — vždy zapisovatelný (metadata, ne kód)
```

Bez toho: agent přepíše uživatelovu práci a uživatel přestane věřit.

### Crash Consistency (atomic writes)

```
PRAVIDLO:
Všechny persistentní soubory (project.json, events.jsonl)
se zapisují ATOMICKY:

1. Zápis do: project.json.tmp
2. fsync(fd)
3. rename(project.json.tmp → project.json)

Rename je atomická operace na POSIX (ext4, btrfs).
```

```typescript
async function atomicWriteJson(filePath: string, data: any): Promise<void> {
  const tmp = filePath + '.tmp';
  const fd = await fs.open(tmp, 'w');
  await fd.writeFile(JSON.stringify(data, null, 2));
  await fd.sync();      // fsync — data jsou na disku
  await fd.close();
  await fs.rename(tmp, filePath);  // atomic na POSIX
}
```

Bez toho: IDE crash uprostřed zápisu `project.json` = corrupted soubor
= projekt se nenačte = uživatel ztratí vše od posledního čistého zápisu.

### Design Files Immutability Guard

```
PRAVIDLO:
Soubory v design/*.md jsou READ-ONLY v editoru.
Editace jen přes chat → nový design turn → C3 přegeneruje soubor.

PROČ:
Ruční editace design/architecture.md rozbije projektový model:
- project.json.context odkazuje na rozhodnutí z designu
- agent naváže na nekonzistentní stav
- invariant "design ≠ konverzace" se rozpadne

IMPLEMENTACE:
1. FileSystemProvider: design/*.md → readOnly: true
2. Pokud user otevře design soubor → banner:
   "Tento soubor je generovaný C3. Upravte přes chat: 'Změň architekturu...'"
3. Explicitní unlock: Command "C3: Odemknout design soubory"
   → warning dialog: "Ruční editace může rozbít projektový kontext."
   → pokud potvrdí → dočasný write access (do konce session)
```

---

> **📋 Poznámka k Sprint 0 a 0.5:** Tyto sprinty jsou prerekvizity pro vše ostatní.
> Sprint 0 vytvoří Theia scaffold (prázdné IDE), Sprint 0.5 ověří LSP.
> Implementační soubory pro Sprint 0/0.5 jsou součástí base Theia projektu
> (monorepo root, `applications/electron/`, `configs/`), nikoliv samostatné packages.
> Sprinty 1–7 předpokládají, že Sprint 0/0.5 je hotový a IDE se spouští.

## Sprint 0 — Theia Shell + Scaffold (7 dní)

### Cíl
Spustitelná Theia instance s C3 brandem, stripnutými nepotřebnými moduly, a prázdnými C3 panely. Žádná C3 logika — jen shell.

### Prerekvizity
- Node.js 22+
- yarn (Theia používá yarn workspaces)
- Python 3.10+ (build tooling)
- Existující C3 backend (běží separátně)

### Den 1-2: Theia projekt scaffold

**1. Inicializace monorepa:**
```
c3-ide/
├── package.json              ← yarn workspaces root
├── tsconfig.json
├── applications/
│   └── electron/             ← Electron wrapper (desktop app)
│       ├── package.json
│       └── electron-main.ts
├── extensions/
│   ├── c3-chat-panel/        ← Chat extension (prázdný shell)
│   ├── c3-agent-panel/       ← Agent log extension (prázdný shell)
│   ├── c3-project-status/    ← Statusbar widget
│   └── c3-shell-bridge/      ← ShellTool ↔ Terminal bridge
└── configs/
    ├── theia.product.json    ← Branding (název, ikona, about)
    └── default-preferences.json
```

**2. Theia package selection — co nechat, co vyhodit:**

NECHAT (core):
- `@theia/core` — framework base
- `@theia/editor` — Monaco editor
- `@theia/filesystem` — file tree + watcher
- `@theia/terminal` — xterm.js terminal
- `@theia/workspace` — workspace management
- `@theia/monaco` — Monaco integration
- `@theia/navigator` — file explorer panel
- `@theia/outline-view` — code outline
- `@theia/markers` — problems panel (pro budoucí linting)
- `@theia/preferences` — settings UI
- `@theia/electron` — Electron shell
- `@theia/plugin-ext` — ⚠️ MINIMAL: jen LSP hosting, bez marketplace

VYHODIT:
- `@theia/git` — C3 má vlastní git flow
- `@theia/debug` — nepotřebujeme DAP
- `@theia/scm` — source control management UI
- `@theia/search-in-workspace` — nahradí C3 search
- `@theia/task` — task runner (C3 má ShellTool)
- `@theia/vsx-registry` — VS Code extension marketplace
- `@theia/getting-started` — welcome tab
- `@theia/plugin-ext-vscode` — VS Code compatibility layer (velký, nepotřebný)

**3. Build & smoke test:**
```bash
cd c3-ide
yarn
yarn build
yarn start:electron
```
Výsledek: Theia se spustí jako desktop app, prázdné okno s file tree a terminálem.

### Den 3-4: C3 branding + prázdné panely

**1. Branding:**
- Název: "C3 Studio" (ne "IDE" — C3 je víc než editor)
- Ikona: C3 logo
- About dialog: verze, build, odkaz na docs
- Splash screen: volitelný

**2. Prázdný Chat Panel (`@c3/chat-panel`):**
```typescript
// c3-chat-panel/src/browser/chat-panel-widget.tsx
@injectable()
export class C3ChatPanelWidget extends ReactWidget {
  static readonly ID = 'c3:chat-panel';
  static readonly LABEL = 'C3 Chat';

  constructor() {
    super();
    this.id = C3ChatPanelWidget.ID;
    this.title.label = C3ChatPanelWidget.LABEL;
    this.title.closable = true;
    this.title.iconClass = 'c3-chat-icon';
  }

  protected render(): React.ReactNode {
    return <div className="c3-chat-container">
      <div className="c3-chat-messages">
        {/* Sprint 1: message list */}
      </div>
      <div className="c3-chat-input">
        <textarea placeholder="Napiš zprávu..." disabled />
      </div>
    </div>;
  }
}
```

**3. Prázdný Agent Log Panel (`@c3/agent-panel`):**
```typescript
@injectable()
export class C3AgentPanelWidget extends ReactWidget {
  static readonly ID = 'c3:agent-panel';
  static readonly LABEL = 'Agent Log';

  protected render(): React.ReactNode {
    return <div className="c3-agent-container">
      <div className="c3-agent-header">
        <span className="c3-status-badge idle">IDLE</span>
      </div>
      <div className="c3-agent-log">
        {/* Sprint 1: real-time CRE log */}
      </div>
    </div>;
  }
}
```

**4. Panel registrace a default layout:**
```typescript
// Registrace v contribution
export class C3PanelContribution implements WidgetContribution {
  registerWidgets(widgets: WidgetRegistry): void {
    widgets.registerWidget(C3ChatPanelWidget.ID, container => ...);
    widgets.registerWidget(C3AgentPanelWidget.ID, container => ...);
  }
}
```

**5. Layout persistence — `c3.layout.json`:**

⚠️ Theia `ApplicationShellLayoutMigration` je křehká — rozbije se při
update verze, změně widget ID, nebo crash recovery.

Řešení: vlastní layout soubor:
```json
// .c3/layout.json
{
  "schema_version": 1,
  "userModified": false,
  "layout": {
    "right": ["c3:chat-panel"],
    "bottom": ["terminal", "c3:agent-panel"],
    "main": ["editor"]
  }
}
```

Pravidla:
- První start: apply `c3.layout.json` default
- Uživatel změní layout: `userModified = true`
- Další starty: pokud `userModified`, neaplikovat default
- Reset layout: command "C3: Obnovit výchozí rozložení"

Tím se nebudou prát layout migrace s uživatelovými preferencemi.

### Den 5: Theme + CSS

**C3 theme (dark-first):**
- Založený na Theia dark theme
- Accent barva pro C3 elementy (brand color)
- Chat panel: tmavé pozadí, jasný text, barevné odlišení user/assistant
- Agent log: monospacové písmo, barevné tagy pro intent typy
- Status badge barvy: 🟢 IDLE, 🔵 THINKING, 🟡 EXECUTING, 🔴 ERROR

### Den 6-7: Strip + Polish + Smoke Test

**Co smazat/skrýt z UI:**
- Welcome tab → nahradit C3 dashboard (Sprint 3)
- Git panel → skrýt (C3 má vlastní git flow)
- Debug panel → smazat
- Extensions panel → smazat
- Source Control panel → smazat

**Smoke test checklist:**
- [ ] App se spustí do 3 sekund
- [ ] File tree zobrazuje project directory
- [ ] Terminal funguje (echo, ls, cd)
- [ ] Chat panel je viditelný vpravo
- [ ] Agent panel je viditelný dole
- [ ] Panely se dají přesouvat drag & drop
- [ ] Theme vypadá konzistentně
- [ ] Keybindings fungují (Ctrl+`, Ctrl+B, Ctrl+J)

### Sprint 0 — Deliverables
- Spustitelná Electron app "C3 Studio"
- Prázdné panely: Chat, Agent Log
- Funkční: terminál, file tree, editor
- Odstraněné: git, debug, SCM, marketplace
- C3 dark theme
- Layout persistence (`c3.layout.json`)

---

## Sprint 0.5 — LSP Validation Buffer (2 dny)

### Cíl
Ověřit, že LSP funguje s minimálním `plugin-ext` (bez `plugin-ext-vscode`).
Toto je risk-mitigation sprint — pokud LSP nefunguje, řeší se TEĎKA, ne v Sprint 3.

### Den 1: LSP Smoke Test

**Testovat s každým jazykem:**

```
Dart LSP:
  - [ ] Otevřít .dart soubor → syntax highlighting ✅
  - [ ] Hover na symbol → typ + dokumentace
  - [ ] Go to Definition (Ctrl+Click)
  - [ ] Diagnostics (červené podtržení chyb)
  - [ ] Autocomplete

TypeScript LSP:
  - [ ] Stejné checky jako Dart

Python LSP:
  - [ ] Stejné checky jako Dart
```

**Jak spustit LSP v Theia bez plugin-ext-vscode:**

Varianta A (preferovaná): Theia `@theia/plugin-ext` s VS Code .vsix soubory
- Stáhnout Dart extension .vsix
- Nainstalovat lokálně: `theia plugin install dart-code.vsix`
- Ověřit že LSP se spustí

Varianta B (fallback): Vlastní LSP launcher
```typescript
// @c3/lsp-launcher/src/node/dart-lsp.ts
@injectable()
export class DartLSPContribution implements LanguageServerContribution {
  readonly id = 'dart';
  readonly name = 'Dart';

  async start(clientConnection: IConnection): Promise<void> {
    const command = 'dart';
    const args = ['language-server', '--protocol=lsp'];
    const serverConnection = await this.createProcessStreamConnection(command, args);
    this.forward(clientConnection, serverConnection);
  }
}
```

### Den 2: Fix + Document

- Pokud Varianta A funguje → dokumentovat postup, pokračovat
- Pokud ne → implementovat Varianta B pro Dart + TypeScript
- Python může počkat (nižší priorita pro Flutter projekt)

### Sprint 0.5 — Deliverables
- LSP funguje pro Dart a TypeScript (hover, go-to-def, diagnostics)
- Dokumentovaný postup instalace LSP
- Rozhodnutí: plugin-ext vs. vlastní launcher

---

## Sprint 1 — Chat + Agent Log + Backend Connection (7 dní)

### Cíl
Funkční chat s C3 backendem, real-time agent log zobrazující CRE rozhodnutí a tool cally. Uživatel může psát do chatu a vidět odpovědi + co agent dělá.

### Den 1-2: C3 Backend Communication Protocol

**Protokol:** WebSocket (ne HTTP polling — potřebujeme streaming + push events)

```typescript
// Shared types: @c3/protocol
interface C3Message {
  id: string;
  type: 'user' | 'assistant' | 'system';
  content: string;
  timestamp: string;
  metadata?: {
    intent?: string;
    confidence?: number;
    tools?: string[];
    designProject?: DesignProjectState;
  };
}

interface C3AgentEvent {
  id: string;
  seq: number;            // monotonic counter — agent panel sorts by this, NOT timestamp
  turnId: string;         // groups events to one user turn (e.g., "t-001")
  type: 'cre_decision' | 'tool_call' | 'tool_result' |
        'gate_verdict' | 'llm_start' | 'llm_token' |
        'llm_done' | 'error' | 'status_change';
  timestamp: string;
  payload: Record<string, any>;
}

// ⚠️ CRITICAL: Agent panel řadí podle `seq`, ne `timestamp`.
// Timestamp může být nekonzistentní (clock skew, paralelní tool calls).
// `seq` je monotonní counter na backendu — garantuje pořadí.

// WebSocket message envelope
interface C3WSMessage {
  channel: 'chat' | 'agent' | 'terminal' | 'status';
  data: C3Message | C3AgentEvent | C3StatusUpdate;
}
```

**Backend adaptér (Node.js):**
```typescript
// @c3/backend-bridge/src/node/c3-backend-service.ts
@injectable()
export class C3BackendService {
  private ws: WebSocket | null = null;
  private chatEmitter = new Emitter<C3Message>();
  private agentEmitter = new Emitter<C3AgentEvent>();

  readonly onChatMessage = this.chatEmitter.event;
  readonly onAgentEvent = this.agentEmitter.event;

  async connect(url: string): Promise<void> { /* ... */ }
  async sendMessage(text: string): Promise<void> { /* ... */ }
  async getHistory(): Promise<C3Message[]> { /* ... */ }
}
```

**C3 backend strana — nový WebSocket endpoint:**
```javascript
// c3-backend/ws-server.js
// Přidá se k existujícímu Express serveru
const wss = new WebSocketServer({ server, path: '/c3/ws' });

wss.on('connection', (ws, req) => {
  const sessionId = extractSession(req);

  // Přeposílat CRE decisions jako agent events
  logger.on('CREDecision', (data) => {
    ws.send(JSON.stringify({
      channel: 'agent',
      data: { type: 'cre_decision', payload: data, timestamp: new Date().toISOString() }
    }));
  });

  // Chat messages
  ws.on('message', async (raw) => {
    const msg = JSON.parse(raw);
    if (msg.channel === 'chat') {
      const response = await conversationHandler.handle(msg.data.content, sessionId);
      ws.send(JSON.stringify({ channel: 'chat', data: response }));
    }
  });
});
```

### Den 3-4: Chat Panel Implementation

**Message List:**
```tsx
// Renderování zpráv
function ChatMessage({ msg }: { msg: C3Message }) {
  return (
    <div className={`c3-msg c3-msg-${msg.type}`}>
      <div className="c3-msg-avatar">
        {msg.type === 'user' ? '👤' : '🤖'}
      </div>
      <div className="c3-msg-content">
        <MarkdownRenderer content={msg.content} />
        {msg.metadata?.intent && (
          <span className="c3-msg-intent-badge">
            {msg.metadata.intent}
          </span>
        )}
      </div>
    </div>
  );
}
```

**Chat Input:**
- Textarea s auto-resize
- Enter = odeslat, Shift+Enter = nový řádek
- Ctrl+Up = předchozí zpráva (history)
- Typing indicator když agent zpracovává
- Disable input během zpracování

**Streaming:**
- `llm_token` events → progressivní rendering odpovědi
- Cursor bliká na konci během streamování
- Cancel button během generování

**Klíčový princip:** Chat panel zobrazuje POUZE konverzaci. Žádné logy, žádné tool cally, žádné CRE decisions. Jen otázka → odpověď.

### Den 5-6: Agent Log Panel Implementation

**Event Timeline:**
```tsx
function AgentEventRow({ event }: { event: C3AgentEvent }) {
  const ICONS = {
    cre_decision: '🧠',
    tool_call: '🔧',
    tool_result: '📋',
    gate_verdict: '🚦',
    llm_start: '⏳',
    llm_done: '✅',
    error: '❌',
    status_change: '🔄',
  };

  return (
    <div className={`c3-agent-event c3-agent-${event.type}`}>
      <span className="c3-agent-time">
        {formatTime(event.timestamp)}
      </span>
      <span className="c3-agent-icon">{ICONS[event.type]}</span>
      <span className="c3-agent-detail">
        <AgentEventDetail event={event} />
      </span>
    </div>
  );
}
```

**CRE Decision rendering:**
```
🧠 14:32:05  CRE → DESIGN @ 0.92
              "Navrhni architekturu e-shopu"
              tools: [] | type: ANSWER

🔧 14:32:06  TOOL → web.search
              query: "e-commerce architecture patterns 2025"

📋 14:32:07  RESULT → 3 results (0.8s)

🚦 14:32:08  GATE → D6.1 ✅ D6.2 ✅ D6.3 ✅

✅ 14:32:09  LLM DONE → 847 tokens (2.1s)
```

**Filtrování:**
- Checkbox filtry: CRE | Tools | Gate | LLM | Errors
- Severity: ALL | WARN | ERROR
- Clear button

**Auto-scroll:** sleduje nové eventy, zastaví se když uživatel scrollne nahoru

### Den 7: Integration Test + Polish

**Test scénáře:**
1. Odeslat "ahoj" → chat zobrazí odpověď, agent log zobrazí CRE CONVERSATIONAL
2. Odeslat "navrhni architekturu" → chat zobrazí design, agent log zobrazí DESIGN + tool calls
3. Odeslat "kolik je 5+3" → chat zobrazí "8", agent log zobrazí LOCAL
4. Restart backendu → reconnect, error v agent logu, recovery

### Sprint 1 — Deliverables
- Funkční chat s C3 backendem přes WebSocket
- Streaming odpovědí (token by token)
- Agent log s real-time CRE decisions
- Event filtrování a auto-scroll
- Chat input s history a cancel

---

## Sprint 2 — ShellTool + Project Store + Status (7 dní)

### Cíl
Agent může spouštět příkazy v terminálu. Projekty přežijí restart. Statusbar zobrazuje aktuální fázi (DESIGN/BUILD/REVIEW).

### Den 1-2: ShellTool Backend

**Sandboxed Shell Executor:**

⚠️ **CRITICAL SECURITY:** Nikdy `spawn(cmd, { shell: true })` ani `/bin/sh -c`.
Vždy argv-based: `spawn(binary, args, { shell: false })`.
Jinak `node -e "require('child_process').exec('rm -rf /')"` projde whitelistem.

```typescript
// @c3/shell-bridge/src/node/shell-tool-service.ts
interface ShellToolRequest {
  command: string;        // jen binary name: "flutter", "npm", "git"
  args: string[];         // argv: ["test", "--reporter", "json"]
  cwd: string;            // MUSÍ být v project sandbox
  env?: Record<string, string>;
  timeoutMs?: number;     // default 30_000
  maxOutputKb?: number;   // default 64
}

interface ShellToolResult {
  exitCode: number;
  stdout: string;
  stderr: string;
  durationMs: number;
  truncated: boolean;
}

@injectable()
export class ShellToolService {
  private readonly ALLOWED_COMMANDS = new Set([
    'ls', 'cat', 'head', 'tail', 'wc', 'grep', 'find',
    'mkdir', 'cp', 'mv', 'touch',
    'git', 'npm', 'npx', 'pnpm', 'yarn',
    'node', 'python', 'python3',
    'flutter', 'dart',
    'tsc', 'eslint', 'prettier',
    'pytest', 'jest', 'vitest',
    'diff', 'sort', 'uniq', 'tr', 'sed',
  ]);

  // Args that are NEVER allowed (regardless of command)
  private readonly BLOCKED_ARGS = [
    /^-e$/,             // node -e, python -e → arbitrary code execution
    /^--eval$/,
    /^-c$/,             // sh -c, python -c
    /^--command$/,
    /^--exec$/,
  ];

  // curl + wget: deferred to Sprint 7 (per-command arg blacklist)
  // Viz Sprint 7 — ShellSecurity rozšířený whitelist s per-command restrikcemi

  async execute(req: ShellToolRequest): Promise<ShellToolResult> {
    // 1. Validate command is in whitelist
    if (!this.ALLOWED_COMMANDS.has(req.command)) {
      throw new Error(`SHELL_BLOCKED: "${req.command}" not in allowed commands`);
    }

    // 2. Check blocked args (prevents node -e, python -c)
    for (const arg of req.args) {
      for (const pattern of this.BLOCKED_ARGS) {
        if (pattern.test(arg)) {
          throw new Error(`SHELL_BLOCKED: arg "${arg}" is not allowed`);
        }
      }
    }

    // 3. Validate cwd is in project sandbox
    const projectRoot = this.getProjectRoot();
    const resolvedCwd = path.resolve(req.cwd);
    if (!resolvedCwd.startsWith(projectRoot)) {
      throw new Error(`SHELL_BLOCKED: cwd "${req.cwd}" outside project sandbox`);
    }

    // 4. Spawn WITHOUT shell — argv-based only
    return this.spawnArgv(req.command, req.args, {
      cwd: resolvedCwd,
      shell: false,       // ← CRITICAL: never true
      timeout: req.timeoutMs || 30_000,
      env: this.sanitizeEnv(req.env),
    });
  }

  // Strip sensitive env vars from child process
  private sanitizeEnv(extra?: Record<string, string>): Record<string, string> {
    const safe = { ...process.env, ...(extra || {}) };
    const STRIP = ['SECRET', 'TOKEN', 'KEY', 'PASSWORD', 'CREDENTIAL', 'AUTH'];
    for (const key of Object.keys(safe)) {
      if (STRIP.some(s => key.toUpperCase().includes(s))) {
        delete safe[key];
      }
    }
    return safe;
  }
}
```

**Intent → ShellTool binding (request construction):**
Agent NIKDY nestaví shell string. CRE rozhodne intent → ShellTool bridge
sestaví `{ command, args }` z strukturovaného requestu:

```typescript
// Správně: agent říká "spusť testy"
// ShellTool bridge přeloží na:
{ command: 'flutter', args: ['test', '--reporter', 'json'], cwd: projectDir }

// Špatně: agent posílá "flutter test --reporter json" jako string
// To by vyžadovalo shell parsing → security risk
```

**Intent → ShellTool binding:**
```
Intent       | ShellTool povolení
─────────────┼─────────────────────────
DESIGN       | ❌ nikdy
BUILD        | ✅ plné (scaffold, test, build)
CODE         | ✅ omezené (write, test, lint)
REVIEW       | ✅ read-only (test, diff, cat)
SEARCH       | ❌ nikdy
CONVERSATIONAL| ❌ nikdy
LOCAL        | ❌ nikdy
```

### Den 3-4: Terminal ↔ Agent Bridge

**Problém:** Když agent spustí `flutter test`, musí to běžet ve viditelném terminálu — uživatel chce vidět output v reálném čase, ne až po dokončení.

**Řešení: Dedicated Agent Terminal**

> ⚠️ **Implementační poznámka:** Dedicated Agent Terminal widget je delegován do Sprint 3
> (kde je Command Palette a notifikační systém). Sprint 2 používá Theia Terminal API
> jako základ; vizuální oddělení (modrý border, read-only) se přidá v Sprint 3.

```typescript
@injectable()
export class C3ShellBridgeContribution {
  // Agent má vlastní terminál (ne sdílený s uživatelem)
  private agentTerminal: TerminalWidget | null = null;

  async executeInTerminal(command: string, cwd: string): Promise<ShellToolResult> {
    // 1. Zajistit agent terminál existuje
    if (!this.agentTerminal) {
      this.agentTerminal = await this.terminalService.newTerminal({
        title: '🤖 C3 Agent',
        cwd,
      });
    }

    // 2. Focus na agent terminál (uživatel vidí co se děje)
    this.agentTerminal.show();

    // 3. Spustit příkaz + zachytit output
    return this.executeWithCapture(this.agentTerminal, command, cwd);
  }
}
```

**UX:**
- Agent terminál má jinou barvu borderu (modrý) než user terminál (zelený)
- Agent terminál je read-only pro uživatele (nemůže do něj psát)
- Label: "🤖 C3 Agent" vs "Terminal"
- Pokud agent neběží, terminál zobrazuje "Agent idle — čekám na příkaz"

### Den 5: Persistent Project Store

**`project.json` — single source of truth:**
```json
{
  "schema_version": 1,
  "project_id": "mobilni-aplikace",
  "name": "Mobilní aplikace",
  "type": "mobile_app",
  "phase": "design",
  "active": true,
  "created_at": "2026-02-08T18:10:00Z",
  "updated_at": "2026-02-09T14:32:00Z",
  "context": {
    "stack": {
      "frontend": "Flutter",
      "vpn": "WireGuard",
      "backend": "Node.js"
    },
    "decisions": [
      { "what": "Flutter over React Native", "why": "nativní výkon", "when": "2026-02-08" },
      { "what": "WireGuard for VPN", "why": "modern, fast", "when": "2026-02-08" }
    ],
    "current_sprint": 0,
    "total_sprints": 7,
    "design_turns": 12
  },
  "files": {
    "design": "design/architecture.md",
    "sprints": "design/sprints.md",
    "chat_log": "chat/conversation.jsonl"
  }
}
```

**Project Store Service:**
```typescript
@injectable()
export class C3ProjectStoreService {
  private readonly PROJECT_FILE = 'project.json';
  private readonly CURRENT_SCHEMA = 1;

  // Načtení po startu — rehydratace session state
  async loadActiveProject(workspacePath: string): Promise<C3Project | null> {
    const projectFile = path.join(workspacePath, this.PROJECT_FILE);
    if (await fs.pathExists(projectFile)) {
      let data = await fs.readJson(projectFile);

      // Schema migration
      if (!data.schema_version || data.schema_version < this.CURRENT_SCHEMA) {
        data = this.migrateSchema(data);
        await this.saveProject(data); // persist migrated version
      }

      if (data.active) return data;
    }
    return null;
  }

  private migrateSchema(data: any): C3Project {
    // v0 → v1: add schema_version, normalize phase names
    if (!data.schema_version) {
      data.schema_version = 1;
      logger.info('ProjectStore', 'Migrated project to schema v1', { id: data.project_id });
    }
    // Future: v1 → v2, v2 → v3, etc.
    return data;
  }

  // Uložení po každém turn — ATOMIC WRITE (viz Crash Consistency kontrakt)
  async saveProject(project: C3Project): Promise<void> {
    project.updated_at = new Date().toISOString();
    const filePath = path.join(project.path, this.PROJECT_FILE);
    await atomicWriteJson(filePath, project);
  }

  // Rehydratace: BE start → load project → set activeDesignProject
  async rehydrateSession(sessionState: SessionState): Promise<void> {
    const project = await this.loadActiveProject(sessionState.workspacePath);
    if (project) {
      sessionState.activeDesignProject = project.context;
      sessionState.hasActiveDesignProject = true;
      logger.info('ProjectStore', 'Rehydrated project', {
        id: project.project_id, phase: project.phase,
      });
    }
  }
}
```

Tohle fixuje ten bug ze screenshotu — po restartu BE se projekt načte z `project.json`, ne z RAM.

### Den 6: Project Status Widget

**Statusbar widget (dole):**
```
┌──────────────────────────────────────────────────────────────┐
│ 🟢 C3 Connected │ 📐 DESIGN (krok 12/?) │ 📱 Mobilní app │
└──────────────────────────────────────────────────────────────┘
```

**Stavy:**
- `📐 DESIGN (krok N)` — aktivní design projekt
- `🔨 BUILD (sprint N/M)` — build phase
- `🔍 REVIEW` — code review phase
- `💬 CHAT` — volná konverzace (žádný projekt)
- `🔴 DISCONNECTED` — backend offline

**Kliknutí na status:**
- Quick pick menu: "Pokračovat v návrhu", "Zobrazit projekt", "Uzavřít projekt"

### Den 7: Integration + Save triggers + Audit Trail

**Auto-save triggers:**
```typescript
// Project se uloží při:
// 1. Každém CRE decision (turn complete)
conversationHandler.on('turnComplete', () => projectStore.save());

// 2. Phase change (DESIGN → BUILD)
pipeline.on('phaseChange', () => projectStore.save());

// 3. Graceful shutdown
process.on('SIGTERM', () => projectStore.save());

// 4. Každých 60 sekund (watchdog)
setInterval(() => projectStore.save(), 60_000);
```

**Audit Trail — `agent-log/events.jsonl`:**

Od Sprint 2 se KAŽDÝ agent event loguje do append-only JSONL souboru.
Cíl: deterministické přehrání session bez LLM (replay/debug).

```typescript
@injectable()
export class AuditTrailService {
  private seq = 0;
  private stream: fs.WriteStream;

  async init(projectPath: string): Promise<void> {
    const logDir = path.join(projectPath, 'agent-log');
    await fs.ensureDir(logDir);
    this.stream = fs.createWriteStream(
      path.join(logDir, 'events.jsonl'),
      { flags: 'a' }  // append
    );
  }

  log(turnId: string, type: string, payload: any): void {
    const event = {
      seq: ++this.seq,
      turnId,
      type,
      ts: new Date().toISOString(),
      payload,
    };
    this.stream.write(JSON.stringify(event) + '\n');
  }
}
```

**Co se loguje (s turn lifecycle):**
```
seq=1  turnId=t-001  turn_start    {input: "navrhni architekturu"}
seq=2  turnId=t-001  cre_decision  {intent: DESIGN, confidence: 0.92}
seq=3  turnId=t-001  llm_start     {model: qwen2.5, tokens_in: 450}
seq=4  turnId=t-001  llm_done      {tokens_out: 847, duration_ms: 2100}
seq=5  turnId=t-001  gate_verdict  {d61: ok, d62: ok, d63: ok}
seq=6  turnId=t-001  turn_end      {status: "ok", duration_ms: 2340}
seq=7  turnId=t-002  turn_start    {input: "spusť testy"}
seq=8  turnId=t-002  cre_decision  {intent: CODE, confidence: 0.85}
seq=9  turnId=t-002  shell_exec    {command: flutter, args: [test], exit: 0}
seq=10 turnId=t-002  turn_end      {status: "ok", duration_ms: 4200}
```

**Replay mode (budoucí Sprint):**
```bash
c3-replay --events agent-log/events.jsonl --dry-run
# Přehraje decisions bez LLM callu → ověří determinismus CRE
# turn_start/turn_end umožní: per-turn timing, success rate, regression comparison
```

### Sprint 2 — Deliverables
- ShellTool s whitelistem a sandboxem (argv-based, `shell: false`)
- Dedicated agent terminál (read-only pro uživatele)
- Intent → ShellTool binding (BUILD ✅, DESIGN ❌)
- Persistent project.json + rehydratace po restartu (atomic write)
- Statusbar widget s fází a projektem
- Audit trail s turn lifecycle (`turn_start`/`turn_end`)

---

## Sprint 3 — DESIGN Viewer + Command Palette (7 dní)

### Cíl
Vizualizace DESIGN výstupu (architektura, sprinty), C3-specific command palette, keyboard-first workflow.

### Den 1-2: DESIGN Viewer Panel

**Problém:** DESIGN výstup je strukturovaný (architektura, stack, sprinty, rozhodnutí), ale v chatu se to čte špatně — je to zaplavené v konverzaci.

**Řešení: Dedicated Design Viewer**

```
┌────────────────────────────────────┐
│ 📐 Design: Mobilní aplikace       │
├────────────────────────────────────┤
│ Phase: DESIGN (krok 12)           │
│ Stack: Flutter + WireGuard + Node │
├──────────┬─────────────────────────┤
│ Outline  │ Content                 │
│          │                         │
│ ▸ Stack  │ ## Architektura         │
│ ▸ Sprints│                         │
│ ▸ Risks  │ Frontend: Flutter 3.x   │
│ ▸ Decisions│ Backend: Node.js + ..│
│          │                         │
│          │ ## Sprinty              │
│          │ Sprint 0: Prerekvizity  │
│          │ Sprint 1: WireGuard ... │
└──────────┴─────────────────────────┘
```

**Implementace:**
- Markdown rendering pro design obsah
- Outline panel (navigace sekcemi)
- Live update — nový design turn → automaticky se překreslí
- Export do PDF/Markdown (pravé tlačítko)

**⚠️ Zdroj dat — VÝHRADNĚ soubory, NIKDY chat:**

Design Viewer čte POUZE z:
- `design/architecture.md` — designový dokument (generovaný C3)
- `design/sprints.md` — plán sprintů
- `project.json → context` — metadata (stack, decisions)

Chat je VSTUP (uživatel říká co chce), ne zdroj pravdy.
Design Viewer je VÝSTUP (co C3 navrhl).

Pokud Design Viewer parsuje chat → rozpadne se koncept
"design ≠ konverzace" a při refaktoru promptů se design "rozjede".

```typescript
@injectable()
export class DesignViewerService {
  // Zdroj dat: jen filesystem, nikdy chat
  async loadDesign(projectPath: string): Promise<DesignDocument> {
    return {
      architecture: await fs.readFile(
        path.join(projectPath, 'design', 'architecture.md'), 'utf-8'
      ),
      sprints: await fs.readFile(
        path.join(projectPath, 'design', 'sprints.md'), 'utf-8'
      ),
      metadata: (await fs.readJson(
        path.join(projectPath, 'project.json')
      )).context,
    };
  }
}
```

**⚠️ Viz kontrakt: "Design Files Immutability Guard"**

Design soubory jsou v editoru READ-ONLY:
- Uživatel otevře `design/architecture.md` → read-only mode + banner:
  "Tento soubor je generovaný C3. Upravte přes chat."
- Editace: uživatel napíše do chatu "Změň stack na React Native"
  → C3 přegeneruje `design/architecture.md`
  → Design Viewer se automaticky překreslí
- Explicitní unlock: "C3: Odemknout design soubory" (s warning dialogem)

### Den 3-4: C3 Command Palette

Každý C3 command posílá STRUKTUROVANÝ objekt, NIKDY raw text do CRE:

```typescript
// Příklad: "C3: Code review" v command palette
// SPRÁVNĚ:
{ type: 'c3_command', name: 'start_review', payload: {} }

// ŠPATNĚ:
{ type: 'chat_message', content: 'udělej code review' }
// ↑ Tohle by šlo přes CRE → nepředvídatelný routing
```

**Rozšíření Theia command palette o C3 příkazy:**

```
Ctrl+Shift+P → Command Palette:

C3: Nový projekt           → { name: 'new_project' }
C3: Pokračovat v návrhu    → { name: 'continue_design' }
C3: Zobrazit design        → { name: 'show_design' }
C3: Spustit build          → { name: 'start_build' }
C3: Code review            → { name: 'start_review' }
C3: Uzavřít projekt        → { name: 'close_project' }
C3: Exportovat projekt     → { name: 'export_project' }
C3: Zobrazit historii      → { name: 'show_history' }
C3: Reconnect k backendu   → { name: 'reconnect' }
C3: Zobrazit agent log     → { name: 'show_agent_log' }
C3: Vyčistit chat          → { name: 'clear_chat' }
C3: Odemknout design soubory → { name: 'unlock_design' }
```

**Quick Actions (Ctrl+K → quick input):**
- Rychlý vstup do chatu — TOHLE JE chat message (jde přes CRE)
- Uživatel napíše přirozený jazyk → odešle se jako `chat_message`
- ESC zavře, Enter odešle
- UI jasně odlišuje: "💬 Napište zprávu..." (ne "Vyberte příkaz...")

### Den 5: Keyboard Shortcuts

```
Ctrl+Shift+C  → Focus Chat panel
Ctrl+Shift+A  → Focus Agent Log panel
Ctrl+Shift+D  → Focus Design Viewer
Ctrl+`        → Focus Terminal (Theia default)
Ctrl+B        → Toggle Sidebar (Theia default)
Ctrl+J        → Toggle Bottom Panel (Theia default)
Ctrl+K        → Quick Chat Input (custom)
Ctrl+Enter    → Odeslat v chatu (alternativa k Enter)
Escape        → Cancel agent execution / Close palette
F5            → Znovu spustit poslední agent command
```

### Den 6-7: Notifications + Context Menu

**Notification system:**
- Agent dokončil task → toast notification
- Agent narazil na error → persistent notification s "Zobrazit log"
- Build úspěšný/neúspěšný → color-coded notification

**Context menu v file tree:**
```
Pravý klik na soubor:
├── Open in Editor (default)
├── ─────────────
├── C3: Review tento soubor
├── C3: Vysvětli tento soubor
├── C3: Refaktoruj tento soubor
└── C3: Přidej testy pro tento soubor
```

Kliknutí → odešle příkaz do chatu s cestou k souboru jako kontextem.

### Sprint 3 — Deliverables
- Design Viewer s outline a live update
- C3 command palette commands
- Quick Chat Input (Ctrl+K)
- Keyboard shortcuts pro všechny panely
- Notifikace pro agent events
- Context menu v file tree

---

## Sprint 4 — Diff Viewer + Code Review (7 dní)

### Cíl
Agent může navrhovat změny, uživatel je vidí jako diff, může přijmout/odmítnout. Code review pipeline v IDE.

### Den 1-2: Agent Diff Proposals

**Když agent navrhne změnu kódu:**
```
Agent chce editovat lib/main.dart:
1. Vytvoří diff (unified format)
2. Pošle přes WebSocket jako agent event
3. IDE zobrazí side-by-side diff v editoru
4. Uživatel: Accept / Reject / Edit
```

**Diff Widget:**
```typescript
@injectable()
export class C3DiffProposalWidget extends ReactWidget {
  async showDiff(proposal: CodeChangeProposal): Promise<UserAction> {
    // Otevřít Monaco diff editor
    const diffEditor = await this.editorManager.openDiff(
      proposal.originalUri,
      proposal.modifiedUri,
      `C3: ${proposal.description}`
    );

    // Toolbar nad diff editorem
    return new Promise(resolve => {
      this.showToolbar({
        onAccept: () => {
          this.applyChange(proposal);
          resolve('accept');
        },
        onReject: () => resolve('reject'),
        onEdit: () => {
          // Uživatel může editovat navržený kód
          resolve('edit');
        },
      });
    });
  }
}
```

### Den 3-4: Code Review Pipeline v IDE

**Lifecycle — s PENDING_REVIEW stavem:**

```
BUILD → agent generuje diff(y)
      → PENDING_REVIEW (persistovaný v project.json)
      → uživatel otevře IDE (možná po restartu!)
      → REVIEW (reviewuje diffy)
      → APPLY (accept) / REJECT (odmítnutí)
      → zpět do BUILD nebo další sprint
```

⚠️ PENDING_REVIEW je kritický stav — uživatel může odejít/restartovat
mezi generováním diffu a review. `project.json` musí vědět:

```json
{
  "phase": "pending_review",
  "pending_changes": [
    {
      "file": "lib/vpn_service.dart",
      "diff_path": ".c3/pending-diffs/vpn_service.patch",
      "description": "Add WireGuard tunnel configuration",
      "status": "pending"
    }
  ]
}
```

Po startu IDE: pokud `phase === "pending_review"` → otevřít Review Panel automaticky.

**Review Panel:**
```
┌──────────────────────────────────┐
│ 🔍 Code Review — Sprint 1       │
├──────────────────────────────────┤
│ ✅ lib/main.dart      +12 -3   │
│ ⏳ lib/vpn_service.dart +45 -0  │ ← klikni pro diff
│ ⏳ test/vpn_test.dart  +28 -0   │
├──────────────────────────────────┤
│ [Accept All] [Reject All]       │
│ Progress: 1/3 reviewed          │
└──────────────────────────────────┘
```

### Den 5: Multi-file Changes

**Atomic change sets:**
- Agent navrhuje skupinu souborů najednou (ne jeden po jednom)
- Uživatel vidí celý change set
- Accept All = aplikuj všechny
- Partial accept = agent se adaptuje

### Den 6-7: Git Integration (minimální)

**Ne full git UI, ale:**
- Auto-commit po Accept All s popisnou zprávou
- Commit message generovaná z agent contextu:
  ```
  feat(vpn): Add WireGuard tunnel configuration

  C3 Agent — Sprint 1, Step 3
  - Added VPN service with WireGuard integration
  - Added connection state management
  - Added unit tests for tunnel lifecycle
  ```
- Branch management: `c3/sprint-1`, `c3/sprint-2`
- Žádné merge/rebase/push — to dělá uživatel

### Sprint 4 — Deliverables
- Monaco diff viewer pro agent proposals
- Accept/Reject/Edit workflow
- Review Panel se seznamem změn
- Multi-file atomic change sets
- Auto-commit s generovanou zprávou

---

## Sprint 5 — Polish + Export + Settings (7 dní)

### Cíl
Production-ready UX, export projektu, user settings, error recovery.

### Den 1-2: Error Recovery + Reconnection

**Backend disconnect:**
```
Backend spadne
→ Statusbar: 🔴 DISCONNECTED
→ Auto-reconnect (exponential backoff: 1s, 2s, 4s, 8s, max 30s)
→ Po reconnect: rehydratace projektu
→ Agent log: "⚠️ Reconnected after 12s downtime"
→ Chat: "(systém se znovu připojil)"
```

**LLM timeout:**
```
LLM neodpovídá > 60s
→ Agent log: "⏱️ LLM timeout (60s)"
→ Chat: "Odpověď trvá déle než obvykle... [Cancel] [Počkat]"
→ Cancel → abort request, agent se vrátí do IDLE
```

**Crash recovery:**
```
IDE crash / kill -9
→ Restart IDE
→ Načte project.json → rehydratace
→ Chat history ze souboru (conversation.jsonl)
→ Agent log: "🔄 Session restored from disk"
```

### Den 3-4: Project Export/Import

**Export:**
```
C3: Exportovat projekt → zip archiv:
mobilni-aplikace-export-2026-02-09.zip
├── project.json
├── design/
│   ├── architecture.md
│   └── sprints.md
├── src/                    ← zdrojový kód
├── chat/
│   └── conversation.jsonl  ← chat historie
└── agent-log/
    └── events.jsonl        ← agent log (volitelné)
```

**Import:**
```
C3: Importovat projekt → dialog pro výběr zip/složky
→ Validace project.json
→ Rehydratace
→ "Projekt 'Mobilní aplikace' načten (fáze: DESIGN, krok 12)"
```

### Den 5: User Settings

**C3 Settings (v Theia Preferences):**
```json
{
  "c3.backend.url": "ws://localhost:3001/c3/ws",
  "c3.backend.autoReconnect": true,

  "c3.chat.fontSize": 14,
  "c3.chat.showIntentBadges": true,
  "c3.chat.showTimestamps": false,

  "c3.agent.autoScroll": true,
  "c3.agent.verbosity": "normal",     // minimal | normal | verbose
  "c3.agent.showTokenCounts": false,

  "c3.shell.timeout": 30000,
  "c3.shell.maxOutput": 65536,

  "c3.project.autoSaveInterval": 60000,
  "c3.project.gitAutoCommit": true,

  "c3.language": "cs",                // cs | en
  "c3.theme": "dark"                  // dark | light
}
```

### Den 6: Onboarding + Help

**First-run experience:**
```
1. "Vítej v C3 Studio!"
2. Připojení k backendu (auto-detect nebo manuální URL)
3. Výběr workspace (existující nebo nový)
4. Quick tour: "Tady je chat, tady je agent log, tady je terminál"
5. "Napiš 'Navrhni architekturu...' pro start"
```

**Help panel:**
- Klávesové zkratky
- Přehled fází (DESIGN → BUILD → REVIEW)
- FAQ

### Den 7: Performance + Final Polish

**Performance targets:**
- Startup: < 3s na studeném startu
- Chat response rendering: < 50ms
- Agent log event: < 10ms
- File tree refresh: < 200ms

**Polish:**
- Konzistentní ikonky
- Loading states pro všechny async operace
- Empty states ("Žádný projekt", "Agent idle")
- Tooltips na všech ikonách

### Sprint 5 — Deliverables
- Error recovery (disconnect, timeout, crash)
- Project export/import (zip)
- User settings (backend, UI, shell)
- First-run onboarding
- Performance tuning

---

## Sprint 6 — Multi-project + Advanced Features (7 dní)

### Cíl
Podpora více projektů, pokročilé features, pripravenost na release.

### Den 1-2: Multi-project Support

**Project Switcher:**
```
Ctrl+Shift+W → "C3: Přepnout projekt"
→ Quick pick:
  📐 Mobilní aplikace (DESIGN, krok 12) ← aktivní
  🔨 E-shop backend (BUILD, sprint 3)
  💬 Bez projektu (volná konverzace)
  + Nový projekt...
```

**Workspace structure:**
```
c3-workspace/
├── projects/
│   ├── mobilni-aplikace/
│   │   ├── project.json
│   │   ├── design/
│   │   └── src/
│   └── e-shop-backend/
│       ├── project.json
│       └── src/
└── .c3/
    ├── settings.json
    └── global-history.jsonl
```

### Den 3-4: Chat History Search

**Fulltext search přes chat historii:**
```
Ctrl+Shift+H → Search Chat History
→ "WireGuard" → zobrazí všechny zprávy obsahující WireGuard
→ Klikni na výsledek → scrollne na kontext
→ "Zobrazit celou konverzaci" → otevře v novém tabu
```

**Implementace:**
- In-memory inverted index pro chat historii (MVP; protokol je připraven na swap za SQLite FTS5 v budoucnu)
- Index: message content, intent, timestamp, project
- Real-time indexing (nová zpráva → okamžitě hledatelná)

### Den 5-6: Token Usage + Cost Tracking

**Token Dashboard Widget:**
```
┌──────────────────────────────┐
│ 📊 Token Usage               │
├──────────────────────────────┤
│ Today:    12,450 tokens      │
│ This week: 87,230 tokens     │
│ Project:  145,800 tokens     │
│ Est. cost: ~$2.34            │
├──────────────────────────────┤
│ By intent:                   │
│ DESIGN      45%  ████████░░  │
│ CODE        30%  ██████░░░░  │
│ CONVERSATIONAL 25% █████░░░░ │
├──────────────────────────────┤
│ By model:                    │
│ claude-3-sonnet  80%         │
│ local (ollama)   20%         │
├──────────────────────────────┤
│ Last 30 days:                │
│ ▁▂▃▄▅▆▇█▅▃▂▁▂▃▅▇▆▅▃▂       │
└──────────────────────────────┘
```

### Den 7: Release Preparation

**Packaging:**
- Electron builder pro Linux (.AppImage, .deb)
- Windows (.exe installer) — budoucnost
- macOS (.dmg) — budoucnost
- Auto-update mechanismus (electron-updater)

**Release checklist:**
- [ ] Všechny panely fungují
- [ ] Backend connection je stabilní
- [ ] Project persistence přežije restart
- [ ] ShellTool sandbox je bezpečný
- [ ] Export/Import funguje
- [ ] Performance < 3s startup
- [ ] Error recovery funguje
- [ ] Dokumentace hotová

### Sprint 6 — Deliverables
- Multi-project support se switcherem
- Chat history fulltext search (in-memory inverted index, SQLite FTS5-ready protokol)
- Token usage dashboard
- Electron packaging (Linux MVP)
- Release checklist ✅

---

## Sprint 7 — Hardening + Bezpečnost (7 dní)

### Cíl
Security audit, hardening ShellTool sandboxu, a penetration testing vlastního kódu.

### Den 1-2: ShellTool Security Audit

**Kontrolní body:**
1. Whitelist review — chybí nějaký legitimní příkaz? Je nějaký příliš?
2. Argv-based spawn — ověřit že NIKDE není `shell: true`
3. Blocked args — `node -e`, `python -c`, `--exec` zachyceny?
4. Environment sanitization — žádné tajné proměnné v child process
5. Path traversal — `../../../etc/passwd` nesmí projít (resolved path check)
6. Symlink attacks — symlink z sandboxu ven
7. Arg injection — `--output=/etc/passwd` v curl/git args

**Security test matice:**
```
Test                                    | Výsledek
────────────────────────────────────────┼──────────
node -e "exec('rm -rf /')"             | BLOCKED (blocked arg -e)
python -c "import os; os.system(...)"  | BLOCKED (blocked arg -c)
git clone --upload-pack='rm -rf /'     | BLOCKED (blocked arg --upload-pack)
flutter test; rm -rf /                  | BLOCKED (shell: false, ";" je arg)
curl file:///etc/passwd                 | BLOCKED (--proto =http,https)
ls ../../etc/passwd                     | BLOCKED (cwd outside sandbox)
npm run postinstall (malicious)         | ⚠️ RISK — npm scripts run in shell
```

⚠️ **npm/yarn risk:** `npm run` spouští skripty přes shell.
Mitigace: `--ignore-scripts` flag povinný, nebo whitelist npm commands:
```typescript
const NPM_SAFE_ARGS = new Set([
  'install', 'ci', 'test', 'run', 'build',
  'list', 'outdated', 'audit',
]);
// + vždy přidat: --ignore-scripts pro install/ci
```

### Den 3-4: Process Isolation

**Linux (primární target):**

Argv-based spawn je první vrstva. Bubblewrap je druhá vrstva (defense in depth):

```typescript
async spawnSandboxed(
  command: string, args: string[], cwd: string
): Promise<ShellToolResult> {
  if (await this.hasBubblewrap()) {
    // Bubblewrap: filesystem isolation + no network
    const bwrapArgs = [
      '--ro-bind', '/', '/',         // read-only root
      '--bind', cwd, cwd,            // write access jen do project dir
      '--tmpdir', '/tmp',
      '--proc', '/proc',
      '--die-with-parent',
      '--unshare-net',               // žádný síťový přístup (volitelné)
      '--', command, ...args,
    ];
    return this.spawnArgv('bwrap', bwrapArgs, { cwd, shell: false });
  }

  // Fallback: argv-based spawn bez bubblewrap (stále bezpečné díky whitelistu)
  return this.spawnArgv(command, args, { cwd, shell: false });
}
```

**Vrstvy obrany (defense in depth):**
```
Layer 1: Command whitelist (ALLOWED_COMMANDS)
Layer 2: Arg blacklist (BLOCKED_ARGS — no -e, -c, --exec)
Layer 3: argv-based spawn (shell: false — no pipe, no chain)
Layer 4: cwd sandbox (resolved path must be in project dir)
Layer 5: env sanitization (strip secrets)
Layer 6: bubblewrap (filesystem + network isolation) — pokud dostupný
Layer 7: timeout + SIGTERM/SIGKILL (30s default)
```

### Den 5: WebSocket Security

**Autentizace:**
- Local-only binding (127.0.0.1, ne 0.0.0.0)
- Session token v WS handshake
- Rate limiting na WS messages

**Input sanitization:**
- Max message size: 100KB
- JSON schema validation
- Command injection prevention v chat input

### Den 6-7: Integration Security Test

**Test scénáře:**
```
1. Pokus o rm -rf / přes chat → BLOCKED
2. Pokus o přístup mimo sandbox → BLOCKED
3. Pokus o command injection v chat → sanitized
4. Backend restart během long-running command → graceful cleanup
5. Concurrent shell commands → queue, ne parallel
6. Output > 64KB → truncated, warning
7. Command timeout → SIGTERM, pak SIGKILL
```

### Sprint 7 — Deliverables
- Security-hardened ShellTool
- Process isolation (bubblewrap na Linuxu)
- WebSocket authentication
- Penetration test report
- Documented security model

---

## Souhrn

```
Sprint 0:    Theia Shell + Scaffold          7 dní
Sprint 0.5:  LSP Validation Buffer           2 dny
Sprint 1:    Chat + Agent Log + Backend      7 dní
Sprint 2:    ShellTool + Project Store       7 dní
Sprint 3:    Design Viewer + Commands        7 dní
Sprint 4:    Diff Viewer + Code Review       7 dní
Sprint 5:    Polish + Export + Settings      7 dní
Sprint 6:    Multi-project + Advanced        7 dní
Sprint 7:    Hardening + Security            7 dní
─────────────────────────────────────────────────────
IDEÁLNÍ:     8.5 sprintů = 58 dní
REALISTICKY: 75–85 dní (Theia edge cases, LSP integrace, sandbox debugging)
```

**Proč realistický odhad je vyšší:**
- Theia build systém má nedokumentované quirks
- LSP integrace bez plugin-ext-vscode může vyžadovat extra wiring
- ShellTool sandbox testování na edge cases zabere víc než plánovaný den
- Event ordering bugy se projeví až pod zátěží
- Každý sprint má ~20% buffer pro neočekávané problémy

**Milníky:**

| Po Sprintu | Stav |
|---|---|
| Sprint 0.5 | IDE shell se spouští, LSP funguje |
| Sprint 2 | **Funkční MVP** — chat, agent log, ShellTool, persistent projekty |
| Sprint 4 | **Code review workflow** — diff, accept/reject, auto-commit |
| Sprint 5 | **Production-ready** single-user |
| Sprint 7 | **Security-hardened** — připravený na distribuci |

**Co záměrně NENÍ v plánu:**
- Multi-user collaboration (nepotřebuješ to)
- Cloud deployment (C3 je lokální)
- VS Code extension marketplace (C3 je self-contained)
- Mobile app (desktop-first)
- Plugin system pro třetí strany (předčasné)
