# C3 Studio IDE — Roadmapa integrace s C3

## Fáze 1: Datová vrstva (Backend ↔ IDE)
> Všechna data se načítají z databáze, změny se ukládají zpět

### 1.1 CRUD entit přes REST API
- [ ] **Experti**: GET/POST/PATCH/DELETE `/api/experts` — načtení do `EXPERTS[]`, vytvoření nového, editace, mazání
- [ ] **Projekty**: GET/POST/PATCH/DELETE `/api/projects` — načtení do `PROJECTS[]`, CRUD
- [ ] **Konverzace**: GET/POST/DELETE `/api/conversations` — načtení do `CONVERSATIONS[]`, vytvoření, archivace
- [ ] **Specialisté**: GET/POST/PATCH/DELETE `/api/specialists` — načtení do `SPECIALISTS[]`, CRUD
- [ ] **Workeri**: GET/POST/PATCH/DELETE `/api/agents` — načtení do `WORKERS[]`, CRUD

### 1.2 Real-time synchronizace
- [ ] WebSocket eventy pro CRUD operace (`entity_created`, `entity_updated`, `entity_deleted`)
- [ ] Optimistic UI updates + rollback při chybě
- [ ] Polling fallback když WS není dostupný

### 1.3 Persistence nastavení na serveru
- [ ] Uložení appearance settings do uživatelského profilu (ne jen localStorage)
- [ ] Synchronizace across sessions

---

## Fáze 2: Working Tree (Workspace)
> Reálná reflexe souborového systému

### 2.1 Načtení workspace
- [ ] Při otevření projektu: GET `/api/workspace/tree` → naplnění `FILES[]`
- [ ] Rekurzivní strom s lazy loading pro velké adresáře
- [ ] File watcher (WebSocket) pro live aktualizace při změnách na disku

### 2.2 Operace se soubory
- [ ] **Nový soubor**: Klik na 📄 → inline input pro název → POST `/api/workspace/file`
- [ ] **Nová složka**: Klik na 📁 → inline input pro název → POST `/api/workspace/directory`
- [ ] **Přejmenování**: Double-click na název → inline editace → PATCH `/api/workspace/rename`
- [ ] **Smazání**: Pravé tlačítko / klávesa Delete → potvrzení → DELETE `/api/workspace/file`

### 2.3 Editor v hlavním okně
- [ ] Double-click na soubor → otevře v center view jako editor tab
- [ ] Záložky otevřených souborů v horní liště center view
- [ ] Syntax highlighting (CodeMirror / Monaco)
- [ ] Diff view pro zobrazení změn agenta

### 2.4 Git integrace
- [ ] Real-time git status (M/A/D/U) z backendu
- [ ] Git branch indicator v working tree header
- [ ] Stage/Unstage soubory přímo v tree

---

## Fáze 3: Agent Runtime
> Agent pracuje na základě konverzace, výstup viditelný v IDE

### 3.1 Terminálový backend
- [ ] PTY (pseudo-terminal) process na serveru per relace
- [ ] WebSocket streaming terminalového výstupu → `session.term[]`
- [ ] Input do terminálu z IDE (interaktivní terminal)

### 3.2 Agent execution loop
- [ ] Agent parsuje user intent z chatu → plánuje akce
- [ ] Každá akce generuje `agent_log` event → zobrazí se v Log
- [ ] Příkazy se spouští v přidělené PTY → výstup v Terminal
- [ ] Soubory se editují → diff se zobrazí v center view

### 3.3 Edit mode: Auto vs Ask
- [ ] **Auto**: Agent provede editaci → pošle `file_changed` event → IDE aktualizuje tree + otevřený soubor
- [ ] **Ask**: Agent pošle `edit_request` s diff → uživatel schválí/odmítne v chatu → agent pokračuje/alternativa
- [ ] Kumulativní schvalování: "Schválit vše" tlačítko pro batch approval

### 3.4 Context management
- [ ] Real-time `context_update` eventy po každém API callu
- [ ] Vizualizace: kolik kontextu zabírají soubory, kolik konverzace
- [ ] Auto-truncation upozornění při >80%

---

## Fáze 4: Wizard integrace
> Napojení "Nový" tlačítek na existující wizard systém

### 4.1 Expert wizard
- [ ] Klik "Nový" u Expertů → otevře wizard v center view
- [ ] Základní údaje: name, domain, icon, desc, systemPrompt, tone, temperature
- [ ] Capabilities (5D) — 5 sliderů s LOW/MEDIUM/HIGH gradient hinty
- [ ] Uložení → POST `/api/experts` + reload seznamu

### 4.2 Specialist wizard
- [ ] Klik "Nový" u Specialistů → wizard s mapováním capabilities
- [ ] Expert sandbox pro testování
- [ ] Uložení → POST `/api/specialists`

### 4.3 Worker wizard
- [ ] Klik "Nový" u Workerů → wizard s cron konfigurací
- [ ] Výběr specialisty/experta pro workera
- [ ] Test run tlačítko
- [ ] Uložení → POST `/api/agents`

### 4.4 Project wizard
- [ ] Klik "Nový" u Projektů → wizard se sprint konfigurací
- [ ] Přiřazení expertů/workerů k projektu
- [ ] Workspace path výběr
- [ ] Uložení → POST `/api/projects`

### 4.5 Conversation wizard
- [ ] Klik "Nový" u Konverzací → rovnou otevře nový chat v relaci
- [ ] Výběr experta + systémového promptu
- [ ] POST `/api/conversations` pro persistence

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
- [ ] Slash commands: `/edit`, `/run`, `/test`, `/explain`, `/review`
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
| Diff review | 🔲 Fáze 5 | — |
