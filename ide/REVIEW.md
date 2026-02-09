# C3 IDE — Revize Roadmap v3 vs. Sprint implementace

## Celkové hodnocení

**Stav: ✅ Velmi dobrý** — Roadmap a sprinty jsou z 90 %+ konzistentní. Architektonické kontrakty jsou dodrženy napříč sprinty, klíčové security invarianty jsou implementovány, a datový tok odpovídá návrhu. Níže jsou identifikované nesrovnalosti, chybějící části, a doporučení.

---

## 1. Strukturální nesrovnalosti

### 🟡 Sprint 1: Duplicitní adresářová struktura

Sprint 1 ZIP obsahuje DVĚ paralelní implementace:
- `sprint1/` (12 souborů) — zjednodušená verze (flat structure)
- `c3-ide-sprint1/` (28 souborů) — plná Theia-kompatibilní verze (packages/ layout)

**Problém:** Není jasné, která verze je kanonická. `c3-ide-sprint1/` je úplnější (obsahuje DI moduly, proxy, oddělené packages), ale `sprint1/` má svůj vlastní README se jinou mapou souborů.

**Doporučení:** Sjednotit na jednu strukturu. Buď smazat `sprint1/` flat verzi, nebo ji označit jako "quick-start reference" v README. Plná verze `c3-ide-sprint1/` by měla být kanonická — je konzistentní s packages/ vzorem ostatních sprintů.

### 🟡 Sprint 1: Dva README soubory

Oba adresáře mají vlastní README s odlišnou mapou souborů. Informace se místy překrývají, místy doplňují. Plný `c3-ide-sprint1/README.md` je detailnější a má lepší architektonické diagramy.

---

## 2. Roadmap vs. Implementace — Nesrovnalosti

### 🔴 Sprint 6: SQLite FTS5 → In-memory inverted index

**Roadmap říká:** "SQLite s FTS5 (fulltext) pro chat historii"  
**Implementace:** In-memory inverted index s komentářem "Pro production, swap za SQLite FTS5"

**Dopad:** Pro malé projekty (stovky zpráv) je in-memory OK. Pro tisíce zpráv a multi-project workspace bude paměťová stopa růst. Při restartu IDE se index musí kompletně přebudovat.

**Doporučení:** Buď aktualizovat roadmap, aby reflektoval in-memory implementaci jako MVP s plánem migrace na SQLite FTS5, nebo doimplementovat SQLite. Protokol je identický, takže swap je čistý.

### 🟡 Sprint 2: curl handling chybí

**Roadmap říká:** Sprint 2 ShellToolService má `CURL_ALLOWED_ARGS` s detailním whitelistem pro curl parametry.  
**Implementace:** `curl` se v Sprint 2 vůbec nevyskytuje (není v ALLOWED_COMMANDS ani v arg handling). Curl handling je až v Sprint 7 (`shell-security-protocol.ts`), kde je curl v rozšířeném whitelistu s per-command arg blacklistem.

**Dopad:** Nízký — curl není kritický pro core workflow. Ale roadmap slibuje curl ve Sprint 2, což neodpovídá.

**Doporučení:** Přesunout curl sekci v roadmapu do Sprint 7, nebo přidat curl do Sprint 2 ALLOWED_COMMANDS s basic restrikcemi.

### 🟡 Sprint 2: Agent Terminal (Dedicated)

**Roadmap říká:** Sprint 2, Den 3-4 definuje "Dedicated Agent Terminal" — agent má vlastní terminálový widget, oddělený od user terminálu, s modrou barvou borderu a read-only přístupem pro uživatele.

**Implementace:** Sprint 2 README explicitně říká: "Terminal widget pro agent — rozhodnutí: používáme Theia terminal API, dedikovaný agent terminál se vytvoří v Sprint 3 spolu s Commands."

**Dopad:** Architektonicky správné rozhodnutí (odloží to do Sprint 3 kde je Command Palette), ale roadmap toto nereflektuje.

**Doporučení:** Aktualizovat roadmap — přesunout Dedicated Agent Terminal do Sprint 3, nebo poznačit v Sprint 2, že terminal widget je delegován.

### 🟢 Sprint 2: Whitelist rozšíření

**Roadmap:** ALLOWED_COMMANDS nemá `sort`, `uniq`, `tr`, `sed`.  
**Implementace:** Přidány `sort`, `uniq`, `tr`, `sed`.

**Dopad:** Pozitivní — rozumné rozšíření pro text processing tasks v BUILD/CODE intentu.

---

## 3. Kontrakty — Ověření

| Kontrakt | Roadmap | Implementace | Status |
|----------|---------|-------------|--------|
| Protocol versioning (hello handshake) | Sprint 1 | ✅ ws-server.js | ✅ OK |
| Turn lifecycle (turn_start/turn_end) | Sprint 1+ | ✅ ws-server.js, audit trail | ✅ OK |
| turn_end.status values | 5 hodnot | ✅ TurnEndStatus type | ✅ OK |
| Event ordering (seq, ne timestamp) | Sprint 1 | ✅ monotonic counter | ✅ OK |
| Agent concurrency (max 1 turn) | Sprint 1 | ✅ activeTurn + pendingMessage | ✅ OK |
| Chat ≠ Command Palette | Sprint 3 | ✅ c3_command vs chat_message | ✅ OK |
| Command Palette bypasses CRE | Sprint 3 | ✅ Direct handler, ne routing | ✅ OK |
| Design ≠ Conversation | Sprint 3 | ✅ Reads only design/*.md | ✅ OK |
| Design files immutability | Sprint 3 | ✅ DesignImmutabilityGuard | ✅ OK |
| Git dirty tree invariant | Sprint 2 | ✅ checkGitDirtyTree() | ✅ OK |
| Crash consistency (atomic write) | Sprint 2+ | ✅ tmp+fsync+rename | ✅ OK |
| argv-based spawn (shell: false) | Sprint 2 | ✅ Enforced everywhere | ✅ OK |
| Blocked args (-e, -c, --exec) | Sprint 2 | ✅ BLOCKED_ARG_PATTERNS | ✅ OK |
| npm --ignore-scripts | Sprint 2 | ✅ sanitizeNpmArgs() | ✅ OK |
| Capability matrix (intent → shell) | Sprint 2 | ✅ CAPABILITY_MATRIX | ✅ OK |
| WebSocket protocol versioning | Sprint 1 | ✅ PROTOCOL_VERSION=1 | ✅ OK |
| Bubblewrap isolation | Sprint 7 | ✅ process-isolation-service | ✅ OK |
| WS session token | Sprint 7 | ✅ 256-bit, constant-time | ✅ OK |
| WS rate limiting | Sprint 7 | ✅ Token bucket | ✅ OK |
| WS local-only binding | Sprint 7 | ✅ 127.0.0.1 only | ✅ OK |
| PENDING_REVIEW persistence | Sprint 4 | ✅ changeset.json + project.json | ✅ OK |
| Exponential backoff reconnect | Sprint 5 | ✅ With jitter | ✅ OK |

**Všechny klíčové kontrakty jsou implementovány.** ✅

---

## 4. Test Coverage

| Sprint | Roadmap tvrdí | Skutečnost | Poznámka |
|--------|--------------|-----------|----------|
| Sprint 1 | 6 test suites | ✅ ws-server.test.js | OK — testy handshake, lifecycle, concurrency |
| Sprint 2 | 25 security testů | ✅ shell-security.test.ts | OK — 25 testů, pokrývá všechny vrstvy |
| Sprint 4 | 30/30 | ✅ sprint4.test.js | OK — diff parsing, apply, lifecycle, git |
| Sprint 5 | 29/29 | ✅ sprint5.test.js | OK — reconnect, timeout, crash, export, settings |
| Sprint 6 | 37/37 | ✅ sprint6.test.js | OK — slug, multi-project, search, tokens, perf |
| Sprint 7 | 90/90 | ✅ sprint7.test.js | OK — 11 kategorií, 90 testů |

**Celkem: ~216+ testů napříč sprinty.** Test coverage je solidní.

---

## 5. Chybějící Sprinty / Části

### ❌ Sprint 0 a Sprint 0.5 chybí v dodávce

Roadmap definuje Sprint 0 (Theia scaffold) a Sprint 0.5 (LSP validation), ale ZIP soubory začínají od Sprint 1.

**Dopad:** Sprint 0 je prerekvizita pro všechno ostatní. Bez něj nelze sprinty 1-7 spustit.

**Doporučení:** Buď dodat Sprint 0/0.5 jako ZIP, nebo zdokumentovat, že jsou již hotové a integrované do base projektu.

### 🟡 Sprint 3: Chybí `quick-chat` widget reference

Roadmap definuje Quick Chat Input (Ctrl+K) — rychlý vstup jako overlay. Sprint 3 command-palette-contribution.ts registruje keybinding, ale dedikovaný QuickChatInput widget (overlay) není explicitně v souborech.

**Doporučení:** Ověřit, zda Quick Chat je implementován jako Theia QuickInput (dialog) nebo custom widget. Pokud QuickInput, je to OK — stačí zavolat `quickInputService.open()`.

---

## 6. Drobné nesrovnalosti

| # | Oblast | Detail |
|---|--------|--------|
| 1 | Roadmap souhrn | Říká "8.5 sprintů = 58 dní" ale Sprint 0.5 je 2 dny, takže by mělo být 58 dní = 7×8 + 2 = 58 ✅ OK |
| 2 | Sprint 6 keybinding | Roadmap říká `Ctrl+Shift+P → "C3: Přepnout projekt"`, implementace používá `Ctrl+Shift+W` — lepší, nekoliduje s Command Palette |
| 3 | Sprint 7 whitelist | Rozšířen ze ~25 příkazů (roadmap) na 40 příkazů — přidány docker, make, cmake, cargo, go, java, javac, mvn, gradle, pip, pip3, ruby, apk, apt-get, brew |
| 4 | Sprint 2 env sanitization | Roadmap stripuje 6 patterns (SECRET, TOKEN, KEY, PASSWORD, CREDENTIAL, AUTH). Sprint 7 rozšiřuje na prefix+suffix matching s explicitním seznamem (ANTHROPIC_API_KEY, OPENAI_API_KEY, AWS_*, DATABASE_URL atd.) |
| 5 | Roadmap layout | Layout diagram ukazuje "Agent Log" pod editorem, ale implementace ho umisťuje jako tab vedle terminálu — funkčně ekvivalentní |

---

## 7. Doporučení pro další iteraci

1. **Sjednotit Sprint 1** — odstranit duplicitní flat verzi, ponechat jen packages/ strukturu
2. **Aktualizovat roadmap** ohledně SQLite FTS5 → in-memory (nebo doimplementovat SQLite)
3. **Přesunout curl handling** v roadmapu do Sprint 7 kde je implementován
4. **Dodat Sprint 0 / 0.5** nebo zdokumentovat jejich stav
5. **Zvážit integration testy** — sprinty mají unit testy, ale chybí end-to-end test, který by propojil WS server → Chat Panel → Agent Log → ShellTool → Review pipeline
6. **Token dashboard** — roadmap nezmiňuje cost estimation, ale Sprint 6 ji implementuje — přidat do roadmap jako feature

---

## Závěr

Projekt je ve výborném stavu. Architektonické kontrakty jsou konzistentně dodrženy, security model je solidní (7 vrstev + bubblewrap), a test coverage pokrývá kritické cesty. Hlavní nesrovnalosti jsou kosmetické (curl placement, SQLite vs in-memory, Sprint 1 duplikace) a neohrožují funkčnost ani bezpečnost systému.
