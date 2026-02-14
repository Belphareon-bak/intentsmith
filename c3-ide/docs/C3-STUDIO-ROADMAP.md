# C3 Studio IDE — Roadmapa integrace s C3

## Fáze 1: Datová vrstva (Backend ↔ IDE)
> Všechna data se načítají z databáze, změny se ukládají zpět

### 1.1 CRUD entit přes REST API
- [x] **Experti**: GET/PUT `/api/experts` — načtení do `EXPERTS[]`, editace
- [x] **Projekty**: GET/POST/PUT/DELETE `/api/projects` — načtení do `PROJECTS[]`, CRUD
- [x] **Konverzace**: GET/POST/DELETE `/api/conversations` — načtení do `CONVERSATIONS[]`, vytvoření, archivace
- [ ] **Specialisté**: GET/POST/PUT/DELETE `/api/specialists` — načtení do `SPECIALISTS[]`, CRUD
- [x] **Workeri**: GET/POST/PUT `/api/agents` — načtení do `WORKERS[]`, CRUD

### 1.2 Real-time synchronizace
- [x] WebSocket channel protocol v1 (hello handshake, 5 kanálů)
- [x] Event bus (C3Bus) — transport emituje, UI subscribuje
- [x] Exponential backoff reconnect + session rehydration
- [ ] Optimistic UI updates + rollback při chybě

### 1.3 Persistence nastavení na serveru
- [x] Crash recovery — localStorage c3-session-state (convId, expert, editMode)
- [x] Health monitor — 30s polling, zelená/žlutá/červená tečka
- [ ] Synchronizace appearance settings across sessions

---

## Fáze 2: Working Tree (Workspace)
> Reálná reflexe souborového systému

### 2.1 Načtení workspace
- [x] GET `/api/workspace/tree` → rekurzivní strom (max depth 5)
- [x] Path traversal security (resolve + path.sep guard)
- [ ] File watcher (WebSocket) pro live aktualizace při změnách na disku

### 2.2 Operace se soubory
- [x] GET `/api/workspace/file` — čtení souboru (max 2MB, SHA-256 hash)
- [x] POST `/api/workspace/file` — zápis s optimistic locking (409 Conflict)
- [x] POST `/api/workspace/directory` — vytvoření adresáře (recursive)
- [x] PUT `/api/workspace/rename` — přejmenování (path security)
- [x] DELETE `/api/workspace/file` — smazání souboru/adresáře

### 2.3 Editor v hlavním okně
- [ ] Double-click na soubor → otevře v center view jako editor tab
- [ ] Záložky otevřených souborů v horní liště center view
- [ ] Syntax highlighting (CodeMirror / Monaco)
- [ ] Diff view pro zobrazení změn agenta

### 2.4 Git integrace
- [x] GET `/api/workspace/git-status` — async spawn s 1.5s timeout
- [x] Git branch info (git branch --show-current)
- [ ] Stage/Unstage soubory přímo v tree

---

## Fáze 3: Agent Runtime
> Agent pracuje na základě konverzace, výstup viditelný v IDE

### 3.1 Terminálový backend
- [x] C3ToolExecutor — shell exec s whitelist, argv spawn, sanitized env
- [x] WebSocket terminal channel (exec_start → exec_result)
- [x] Input do terminálu z IDE (input field + Enter)
- [x] Execution lock (_termExecuting) — prevent spam

### 3.2 Agent execution loop
- [x] Agent event stream (TURN_START/END, CRE, LLM, GATE, TOOL, ERROR)
- [x] agent-client.js formatter → readable log entries
- [x] Mix view — interleaved log + terminal sorted by timestamp
- [ ] Soubory se editují → diff se zobrazí v center view

### 3.3 Edit mode: Auto vs Ask
- [x] Edit mode toggle (Auto/Ask) odesílá se přes WS channel
- [x] Ask mode: edit_request → approve/reject v chatu
- [x] Edit ACK — idempotency guard, 30s timeout auto-reject
- [ ] Kumulativní schvalování: "Schválit vše" pro batch

### 3.4 Context management
- [x] Status channel broadcast — real context % po každém tahu
- [x] Context meter UI + polling POST /api/context
- [x] STOP button — cancel LLM + terminal + log entry

---

## Fáze 4: Wizard integrace
> Napojení "Nový" tlačítek na existující wizard systém

### 4.1 Expert wizard
- [x] Klik "Nový" u Expertů → dispatch `c3-wizard-open` event → wizard v center view
- [x] Wizard existuje (center-views-module.js): name, domain, icon, capabilities
- [ ] Uložení → POST `/api/experts` + reload seznamu (schema anti-drift)

### 4.2 Specialist wizard
- [ ] Klik "Nový" u Specialistů → wizard s mapováním capabilities
- [ ] Expert sandbox pro testování
- [ ] Uložení → POST `/api/specialists`

### 4.3 Worker wizard
- [x] Klik "Nový" u Workerů → inject `/new-agent` do chatu
- [x] Chat-based wizard (agent-wizard.js na backendu)
- [ ] Test run tlačítko

### 4.4 Project wizard
- [x] Klik "Nový" u Projektů → detail editace s POST
- [ ] Přiřazení expertů/workerů k projektu
- [ ] Workspace path výběr

### 4.5 Conversation wizard
- [x] Klik "Nový" → POST `/api/conversations` → link `_convId` na session
- [x] Expert z aktuální relace se přenáší
- [x] Otevření konverzace → fetch messages + link _convId + metadata parse

---

## Fáze 5: Advanced features
> Pokročilé funkce pro produktivitu

### 5.1 Diff & Review
- [ ] Agent generuje diff → zobrazení v center view jako side-by-side diff
- [ ] Inline approve/reject per hunk
- [ ] Kumulativní commit tlačítko: "Schválit a commitovat"

### 5.2 Multi-agent orchestrace
- [ ] Každá relace může mít jiného agenta
- [ ] Vizualizace agent interakcí v Mix view
- [ ] Delegace mezi agenty viditelná v logu

### 5.3 Autocomplete intelligence
- [ ] Kontextové návrhy na základě otevřeného souboru + konverzace
- [x] Slash commands: `/edit`, `/run`, `/test`, `/explain`, `/review`
- [ ] Smart suggestions: "Spustit testy?" po editaci kódu

### 5.4 Theming & Customization
- [ ] Uživatelské CSS injekce
- [ ] Plugin system pro sidebar rozšíření
- [ ] Keyboard shortcuts editor

---

## Závislosti a pořadí

```
Fáze 1 (Data) ──┬── Fáze 2 (Working Tree)
                 │
                 ├── Fáze 4 (Wizards)
                 │
                 └── Fáze 3 (Agent Runtime) ── Fáze 5 (Advanced)
```

- **Fáze 1** je prerekvizita pro vše ostatní
- **Fáze 2, 3, 4** mohou probíhat paralelně po dokončení Fáze 1
- **Fáze 5** závisí na Fáze 3

## Stav implementace

| Oblast | Stav | Poznámka |
|---|---|---|
| IDE Layout & UI | ✅ Hotovo | Sidebar, Center, Chat, Bottom panel |
| Appearance system | ✅ Hotovo | Témata, barvy, intenzity, pozadí |
| Session splits | ✅ Hotovo | 1-3 propojené relace chat ↔ bottom |
| Autocomplete UI | ✅ Hotovo | Tab → backend, ghost text, accept |
| Edit mode toggle | ✅ Hotovo | Auto/Ask v UI, posílá se s payload |
| Context meter | ✅ Hotovo | UI + polling + WS events |
| Working tree | ✅ Hotovo | Collapse, git status, toolbar |
| Backend CRUD | ✅ Hotovo | REST PUT/POST, data z backendu, PATCH→PUT fix |
| WS transport | ✅ Hotovo | Event bus, handshake, reconnect, channel routing |
| Session persistence | ✅ Hotovo | localStorage crash recovery, convId routing |
| Health monitor | ✅ Hotovo | 30s polling, zelená/žlutá/červená tečka |
| Edit ACK | ✅ Hotovo | Idempotency guard, 30s timeout, approve/reject |
| Reálný workspace | ✅ Hotovo | 7 API routes, git status+branch, path security |
| Agent terminal | ✅ Hotovo | Input field, exec lock, STOP button, cancel |
| Wizard napojení | ✅ Hotovo | Expert wizard event, conversation POST, worker chat |
| Audit log panel | ✅ Hotovo | 5. tab v bottom panel, merge/drift logy, 30s cache |
| Slash commands | ✅ Hotovo | /run, /test, /edit, /explain, /review |
| Diff review | 🔲 Fáze 5 | — |
