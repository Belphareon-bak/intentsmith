# C3-Agent — Aktualizovaná Roadmapa v2

## Od aktuálního stavu k tvé vizi

**Datum:** 2026-02-09
**Verze kódu:** v59.0 (po merge DEV A security + DEV B IDE bridge)
**Testy:** 930+ (36 suites + 350 konverzačních kroků + ws-bridge 41)

---

## Tvá vize — 4+2 pilíře

### Pilíř 1: CHAT — náhrada ChatGPT
Kvalitní konverzační AI s generováním dokumentů a expertní specializací.
Umí odpovídat přesně, v kontextu, ve správném jazyce, s podklady.

### Pilíř 2: PROJEKTY — stavění věcí
D1→CODE→R2→D2→R1 pipeline pro velké projekty (web, smart home, aplikace).
Týdny práce, ne jednorázové odpovědi.

### Pilíř 3: WORKERI — autonomní hlídací psi
Běží na pozadí 24/7. Sledují web, počasí, nabídky, zprávy.
Posílají notifikace (email, Telegram, SMS) když se něco stane.

### Pilíř 4: SPECIALISTÉ — komplexní on-demand agenti
Účetní, správce domácnosti, AI researcher. Kombinují expertní znalosti,
nástroje, rutiny a paměť. Nejsou jen chat persona — umí generovat
faktury, kontrolovat zákony, navrhovat jídelníčky.

### Pilíř 5: IDE — vlastní vývojové prostředí
Eclipse Theia s custom panely: Chat, Agent Log, Diff Viewer, Terminal.
Nahrazuje webUI. Čistá separace konverzace / agent activity / terminál.

### Pilíř 6: PRODUKT — balíčkování a ochrana
Instalovatelná aplikace (ne `npm start`). Ochrana zdrojového kódu.
Licenční systém. Setup wizard.

---

## Kde je každý pilíř dnes (po merge v59)

### Pilíř 1: CHAT — 75%

| Co funguje | Co chybí / nefunguje správně |
|------------|------------------------------|
| ✅ CRE routing (11 intentů) | 🔴 Jazykové úniky: 10% odpovědí SK místo CZ |
| ✅ Safety engine (4 domény) | 🔴 EN "thanks" → spouští SEARCH (100% repro) |
| ✅ Quality pipeline (K5.1–K5.5) | 🔴 Local handler vždy česky (datum/čas/calc) |
| ✅ Output gate D6 | 🔴 Raw JSON leak v odpovědi |
| ✅ Export MD/HTML/TXT | 🔴 Nodiacritics stížnost ("zkreslil text") |
| ✅ Language detection (7 jazyků) | 🔴 "Write HTTP server" → SEARCH místo CODE |
| ✅ Conversation store (DB) | ❌ PDF export |
| ✅ Context budget per intent | ❌ DOCX generování |
| ✅ Query canonicalizer | ⚠️ fetchPage quality (block detection) |
| ✅ Expert routing + enforcement | ⚠️ Auto-retry search |
| ✅ Expert paměť (cross-session DB) | ⚠️ Confidence styling |
| ✅ HTTP hardening (DEV A) | ⚠️ Expert domain prompty — neověřená kvalita |
| ✅ WS event streaming (DEV B) | |

**Nově zjištěno z 350 konverzačních testů:**
- Qwen 2.5:32b přepíná do slovenštiny na abstraktních tématech (~10% CZ odpovědí)
- 1× přepnutí CZ→SK→RU (startupy v Česku — začne SK, dokončí rusky)
- 1× čínské znaky uprostřed české odpovědi (Československo)
- Každé EN "Thanks!" na konci konverzace spustí search (5/5 = 100%)
- Každý EN dotaz na datum/čas vrátí českou odpověď (8/8 = 100%)

### Pilíř 2: PROJEKTY — 70%

| Co funguje | Co chybí |
|------------|----------|
| ✅ D1→CODE→R2→D2→R1 pipeline | ⚠️ Multi-session projekty |
| ✅ Planner start/clarify/approve/reject | ⚠️ Project-scoped paměť |
| ✅ Build handoff z chatu | ⚠️ Progress tracking per projekt |
| ✅ Architect mode (editor, git, reviewer) | ⚠️ Reálné testování na projektech |
| ✅ Project focus v DB | |

### Pilíř 3: WORKERI — 50%

| Co funguje | Co chybí |
|------------|----------|
| ✅ Agent runner + scheduler | ❌ RSS/Atom source adapter |
| ✅ Auto-start z DB | ❌ Multi-source agent |
| ✅ Edge detection | ❌ Agent builder wizard (konverzační tvorba) |
| ✅ Conditions (compare, contains, new_items) | ❓ E2E doručení (email reálně odejde?) |
| ✅ URL source + schema extraction | ❓ E2E doručení (Telegram reálně dojde?) |
| ✅ Webhook action | |
| ✅ LLM-generated notifikace | |
| ✅ Notification channels (email, Telegram) — kód | |
| ✅ Notification pipeline + policy + digest — kód | |
| ✅ Trust tracking + feedback (34 testů) | |
| ✅ Agent secrets (API klíče) | |
| ✅ Agent health dashboard (bylo ve webUI) | |

**Klíčový otazník:** Notification kód existuje a má testy, ale nebylo
ověřeno E2E (reálný email na inbox, reálná Telegram zpráva na telefon).

### Pilíř 4: SPECIALISTÉ — 30%

| Co funguje | Co chybí |
|------------|----------|
| ✅ Expert personas + store + DB | ❌ Specialist Contract (nová entita ≠ expert) |
| ✅ Expert handler + routing | ❌ Specialist Runtime |
| ✅ Expert memory (cross-session) | ❌ Document generator (PDF faktury) |
| ✅ Tool enforcement guard (41 testů) | ❌ Knowledge base per specialista |
| ✅ ACCOUNTANT-PILOT-SPEC.md | ❌ Routine engine (sub-workery) |
| ✅ tax-rates.js (RATES[year] + freshness) | ❌ Specialist builder |
| ✅ tax-calc.js (OSVČ + s.r.o.) | ⚠️ Tool registration (krok 1 integration) |
| ✅ vat-calc.js (DPH) | ⚠️ Tool dispatch (krok 2) |
| ✅ salary-calc.js (hrubá→čistá) | ⚠️ Enhanced systemPrompt (krok 3) |
| ✅ deadline-checker.js (lhůty + penále) | ⚠️ Memory change awareness (krok 4) |
| ✅ rate-verifier.js (monitoring agent) | ⚠️ Rate monitor registrace (krok 5) |
| ✅ 81/81 accountant testů | |
| ✅ INTEGRATION-GUIDE.md (6 kroků) | |

### Pilíř 5: IDE — 0% runtime, 100% příprava

| Co je hotovo | Co zbývá |
|--------------|----------|
| ✅ IDE Roadmap v3 (1754 řádků, 8 sprintů) | ❌ Sprint 0–7 implementace |
| ✅ Sprint 0–7 kód existuje (ZIPy, review done) | ❌ Theia runtime build + deployment |
| ✅ Architektonické kontrakty definovány | |
| ✅ WS bridge backend ready (41 testů) | |
| ✅ Backend security hardened (61 testů) | |

### Pilíř 6: PRODUKT — 5%

| Co je hotovo | Co chybí |
|--------------|----------|
| ✅ Shell injection fix | ❌ Installer (Electron/Docker/pkg) |
| ✅ Command whitelist + sandbox | ❌ Auto-updater |
| ✅ Secrets API auth | ❌ Source code obfuskace |
| ✅ LLM Gateway auth tokens | ❌ License key / activation system |
| | ❌ Setup wizard |
| | ❌ API rate limiting |

---

## Roadmapa — všechno co je potřeba udělat

### Fáze Q: QUALITY FIXES (3 dny)
**Cíl:** Odpovědi ve správném jazyce, bez routingových chyb.
**Proč první:** Bez tohohle chat není produkční — 10% odpovědí je v cizím jazyce.

```
Q1. Language enforcement                                          [1 den]
    - System prompt: "Odpovídej VÝHRADNĚ v jazyce uživatele.
      NIKDY slovensky, NIKDY v jiném jazyce než v jakém se ptá."
    - Post-response language validation gate:
      detekuj SK/RU/CN znaky v odpovědi → retry s přísnějším promptem
    - Fallback: pokud 2× retry selže → odpověď + disclaimer
    Kde: llm/prompts.js, chat/controller.js (nový validation step)

Q2. CRE routing: EN "thanks" → CONVERSATIONAL                    [2h]
    - Pattern: krátká pozitivní zpráva (< 8 slov, sentiment positive)
      → CONVERSATIONAL intent, ne SEARCH
    - Konkrétně: "Thanks", "Bye", "Great", "Awesome", "See you"
    Kde: chat/cre-decision.js

Q3. CRE routing: code request → CODE                             [2h]
    - Pattern: "Write/Create/Build me a [code thing]" → CODE intent
    - "Write me a simple HTTP server in Node.js" nesmí jít do SEARCH
    Kde: chat/cre-decision.js

Q4. Local handler i18n                                            [4h]
    - Detekovat jazyk z session nebo posledního inputu
    - Formátovat datum, čas, kalkulačku v jazyce uživatele
    - EN: "📊 **Today is Monday, Feb 9, 2026**"
    - CZ: "📊 **Dnes je pondělí, 9. 2. 2026**"
    Kde: chat/handlers/local.js

Q5. Response sanitization                                         [1h]
    - if (response starts with '{' && isJSON) → extract .content field
    - Nikdy nevrátit raw JSON jako odpověď uživateli
    Kde: chat/controller.js

Q6. Nodiacritics tolerance                                        [1h]
    - System prompt: "Čeština bez diakritiky je normální vstup.
      Nekomentuj to, neomlouvej se za to, prostě odpověz."
    Kde: llm/prompts.js
```

**Po Q fixech — aktualizovat test harness:**
```
Přidat do conv-*.test.js quality assertions:
  - language mismatch detection (SK/RU/CN v CZ odpovědi)
  - raw JSON leak detection
  - search-on-gratitude detection
  - local handler language match
Aby tyto bugy byly regresně chycené.
```

**Milestone:** "350 konverzačních kroků, 0 jazykových úniků, 0 špatných routingů."

---

### Fáze A: CHAT dokončení (1 týden)
**Cíl:** Chat je na úrovni, kde ho denně používáš místo ChatGPT.

```
A1. fetchPage quality                                             [1 den]
    - Block detection (cookie walls, paywalls, JS-only pages)
    - Smart truncation (keyword relevance scoring)
    Kde: chat/handlers/utils/web.js nebo fetchPage

A2. Auto-retry search                                             [4h]
    - < 3 výsledků → LLM reformuluje query → retry
    - Max 2 retry, pak odpověz s tím co máš
    Kde: chat/handlers/decisions.js (search flow)

A3. Confidence styling                                            [4h]
    - Odpověď reflektuje sílu podkladů
    - "Podle dostupných zdrojů..." vs "Jednoznačně..."
    Kde: chat/handlers/utils/synthesis.js

A5. PDF export                                                    [1 den]
    - puppeteer HTML→PDF
    - Nebo: md-to-pdf (jednodušší, bez headless Chrome)
    Kde: chat/export/ (nový modul)

A6. DOCX generování                                               [1 den]
    - docx-js nebo pandoc wrapper
    Kde: chat/export/ (nový modul)

A7. Expert domain prompty — ověření kvality                       [1 den]
    - A/B test: expert vs obecný chat na stejný dotaz
    - Per-doména: finance, IT, zdraví, právo, vaření
    - Vyladit prompt pokud expert nedává lepší výsledky
    Kde: experts/expert-layer.js (system prompty)

A9. Legacy cleanup                                                [2h]
    - Smazat workflow/engine.js pokud ještě existuje
    - Sjednotit verze, uklidit mrtvý kód
```

**Co je HOTOVO z původní Fáze A:**
- ~~A4. HTTP hardening~~ ✅ DEV A security (CORS, secrets auth, shell hardening)
- ~~A8. Expert paměť~~ ✅ expert_memory tabulka v DB

**Milestone:** "Pošlu C3 dotaz → dostanu českou, podloženou odpověď → exportuju jako PDF."

---

### Fáze D-int: ÚČETNÍ INTEGRACE (3 dny)
**Cíl:** Účetní tools (81 testů) napojit na chat — "kolik zaplatím z 850k" → přesný výsledek.
**Proč teď:** Tools jsou hotové, chybí jen 6 kroků lepidla z Integration Guide.

```
D-int1. Tool registration                                        [2h]
    - accountant.tools array v expert-layer.js
    - Přidat: tax_calc, vat_calc, salary_calc, deadline_checker
    Kde: experts/expert-layer.js

D-int2. Tool dispatch                                             [2h]
    - ACCOUNTANT_TOOLS map v tool-executor.js
    - Route: tool_name → import → execute → return result
    Kde: experts/tool-executor.js nebo c3-tool-executor.js

D-int3. Enhanced accountant systemPrompt                          [3h]
    - Tool-only pravidla (NIKDY nepočítej v hlavě, VŽDY volej tool)
    - Citace zákonů (ZDP §X, DPH zákon §Y)
    - Disclaimer ("Toto není daňové poradenství")
    - Memory injection (klient X má IČO Y)
    Kde: experts/expert-layer.js (accountant persona prompt)

D-int4. Memory change awareness                                   [2h]
    - Při update paměti: uložit previous_value
    - "Klient Novák změnil IČO z X na Y" v kontextu
    Kde: experts/expert-store.js

D-int5. Rate monitor agent registrace                             [2h]
    - RATE_MONITOR_AGENT z rate-verifier.js
    - Registrovat do agent scheduler
    - 1× týdně (pondělí 9:00) kontrola ČSSZ, VZP, FS
    Kde: agents/ (registrace), experts/tools/rate-verifier.js

D-int6. E2E test                                                  [1 den]
    - "Kolik zaplatím z 850k jako OSVČ za rok 2024?" → přesné číslo
    - "Jaká je DPH z 10000?" → přesný výsledek
    - "Kdy je deadline pro přiznání?" → datum + urgency
    - Ověřit: tool se skutečně volá, ne LLM hallucination
    Kde: tests/ (nový E2E test)
```

**Milestone:** "Ptám se C3 účetního 'kolik zaplatím daň z 850k' — dostanu přesný výpočet s citací zákona."

---

### Fáze B: WORKERI — notifikace a zdroje (2–3 týdny)
**Cíl:** Aspoň 3 agenti běží 24/7 a reálně posílají notifikace.

```
Týden 1:
  B0. E2E verifikace existujícího kódu                           [1 den]
      - Reálně odeslat email přes notifications/channels/email.js
      - Reálně odeslat Telegram zprávu přes channels/telegram.js
      - Ověřit pipeline.js → policy.js → channel → doručení
      - Pokud nefunguje: opravit, pokud funguje: ✅ pokračuj
      Kde: notifications/ (existující kód)

  B4. Push channel (ntfy.sh nebo Pushover)                        [1 den]
      - Jednoduché, bez vlastního serveru
      - Test: agent → ntfy → notifikace na telefonu
      Kde: notifications/channels/ (nový)

  B5. RSS/Atom source adapter                                     [2 dny]
      - Nový zdroj pro zpravodajské agenty
      - Parsování RSS/Atom → normalized items
      - Deduplikace (seen items store)
      Kde: agents/sources/ (nový)

Týden 2:
  B6. Multi-source agent                                          [2 dny]
      - Agent s více zdroji, merge výsledků
      - Příklad: "sleduj pozemky na Sreality + Bezrealitky"
      Kde: agents/ (rozšíření runner)

  B9. Agent builder wizard                                        [3 dny]
      - Konverzační tvorba agenta přes chat
      - "Chci hlídat počasí v Praze" → wizard se zeptá na práh, kanál, frekvenci
      - Generuje agent config → uloží do DB → spustí
      - NE předpřipravené šablony — kvalitní wizard s vysvětlením
      Kde: chat/handlers/ (nový wizard handler) + agents/

Týden 3:
  B8. Testování 3 reálných workerů                                [1 týden]
      - Počasí monitor → Telegram notifikace
      - Realitní hlídač → email
      - Zpravodajský aggregátor (RSS) → denní digest report
      - Běží 24/7, opravit co selže
      Kde: reálný provoz + debugging
```

**Co je HOTOVO z původní Fáze B:**
- ~~B1. Notification Service~~ ✅ notifications/ modul existuje (pipeline, policy, digest)
- ~~B2. Email channel~~ ✅ channels/email.js existuje (E2E neověřeno)
- ~~B3. Telegram channel~~ ✅ channels/telegram.js existuje (E2E neověřeno)
- ~~B7. Agent health dashboard~~ ✅ existoval ve webUI (→ přesunout do IDE)

**Milestone:** "Ráno dostanu na Telegram zprávu od C3, že se změnilo počasí / vyšel nový pozemek."

---

### Fáze C: PROJEKTY — reálné nasazení (1–2 týdny + průběžně)
**Cíl:** Jeden reálný projekt postavený přes D1→CODE→R2→D2→R1.

```
  C1. Multi-session projekt                                       [2 dny]
      - Planner si pamatuje stav přes dny
      - "Pokračuj kde jsme skončili" funguje
      Kde: chat/planner/, workflow/

  C2. Progress tracking                                           [2 dny]
      - Co je hotové, co zbývá, blocker list
      - Per-projekt stav viditelný v IDE
      Kde: workflow/, IDE panel

  C3. Spustit reálný projekt přes pipeline                        [průběžně]
      - Tvůj web / smart home / jiný reálný projekt
      - Od návrhu po deployment

  C4. Opravit co se rozbije                                       [průběžně]
      - Tohle je ta nejdůležitější část
      - Pipeline existuje (42 workflow testů), teď potřebuje kilometry
```

**Milestone:** "C3 mi pomohl postavit [konkrétní věc] od návrhu po deploymentu."

Tohle je fáze, kde se má hlavně **používat**, ne programovat.

---

### Fáze E: IDE — Eclipse Theia deployment (8 sprintů, ~2 měsíce)
**Cíl:** Vlastní IDE nahrazující webUI. Čistá separace chat / agent log / terminál.
**Běží paralelně s Fázemi B-D**, protože je na jiné ose (frontend vs backend).

```
Sprint 0: Theia Shell + Scaffold                                 [7 dní]
    - Theia projekt scaffold, npm build, C3 branding
    - Prázdné panely: Chat, Agent Log, Terminal
    - Theme + CSS, strip nepotřebné (Marketplace, Git)
    Stav: kód existuje (ZIP, review done)

Sprint 0.5: LSP Validation Buffer                                [2 dny]
    - Risk mitigation: ověřit že LSP funguje v Theia
    - Dart, TypeScript, Python — hover, go-to-def, diagnostics
    Stav: kód existuje

Sprint 1: Chat + Agent Log + Backend Connection                   [7 dní]
    - Chat panel s real-time messaging přes WS bridge
    - Agent log panel (CRE decisions, tool calls, gate verdicts)
    - Backend connection manager (health check, reconnect)
    Stav: kód existuje, WS bridge backend ready (41 testů)

Sprint 2: ShellTool + Project Store + Status                      [7 dní]
    - ShellTool execution přes terminál
    - Project store (multi-project management)
    - Status bar (model, project, connection)
    Stav: kód existuje

Sprint 3: DESIGN Viewer + Command Palette                         [7 dní]
    - Design document viewer (Markdown rendered)
    - Command palette (C3-specifické příkazy)
    - Dashboard (welcome tab nahrazení)
    Stav: kód existuje

Sprint 4: Diff Viewer + Code Review                               [7 dní]
    - Side-by-side diff viewer pro code review
    - Approve/reject UI pro review pipeline
    Stav: kód existuje

Sprint 5: Polish + Export + Settings                              [7 dní]
    - Export (PDF, DOCX, MD) — integruje Fázi A5/A6
    - Settings panel (LLM config, expert selection)
    - UI polish pass
    Stav: kód existuje

Sprint 6: Multi-project + Advanced Features                       [7 dní]
    - Multi-project switching
    - Advanced agent management UI
    - Notification preferences
    Stav: kód existuje

Sprint 7: Hardening + Bezpečnost                                  [7 dní]
    - Content Security Policy
    - Input sanitization
    - Crash recovery
    - Performance profiling
    Stav: kód existuje
```

**Milestone:** "Otevřu C3 IDE, chatuju s agentem, vidím co dělá v agent logu, review kód v diff vieweru."

---

### Fáze D: SPECIALISTÉ — architektura + pilot (6–8 týdnů)
**Cíl:** Účetní specialista funguje end-to-end: chat → výpočet → PDF faktura.

Specialista ≠ expert ≠ worker. Je to nová entita:

```
Týden 1–2: Architektura
  D1. Specialist Contract                                         [1 týden]
      - Definice: co je specialista, co umí, co potřebuje
      - Knowledge base (zákony, sazby, šablony)
      - Bound tools (generátor faktur, kalkulačka DPH) — ✅ tools existují
      - Routines (měsíční kontrola, připomínky)
      - Memory (klient X má IČO Y, poslední faktura Z)
      Kde: experts/ (nová vrstva nad expert-layer)

  D2. Specialist Runtime                                          [1 týden]
      - Jak specialista zpracovává požadavek
      - Chat interface (ptám se účetního)
      - Tool execution (generuj fakturu) — ✅ tools ready
      - Routine scheduling (připomeň mi za měsíc)
      Kde: experts/ (nový runtime)

Týden 3–4: Nástroje
  D3. Document generator engine                                   [1 týden]
      - Šablony + data → PDF/DOCX
      - Faktura, kontrolní hlášení, smlouva
      - Reusable pro všechny specialisty
      Kde: experts/tools/ nebo utils/doc-generator

  D4. Knowledge base per specialista                              [4 dny]
      - FTS5 (fulltext search v SQLite) nebo vektorový store
      - Účetní: ZDP, DPH zákon, vyhlášky
      Kde: experts/ (nový modul)

  D5. Routine engine                                              [3 dny]
      - Specialista si naplánuje vlastní úkoly (sub-workery)
      - "Připomeň mi 15. každý měsíc kontrolní hlášení"
      - Napojení na agent scheduler (✅ existuje)
      Kde: experts/ + agents/

Týden 5–6: Účetní pilot (end-to-end)
  D6. Účetní specialista end-to-end                               [2 týdny]
      - "Vygeneruj fakturu pro klienta Novák" → PDF
      - "Kdy je deadline pro kontrolní hlášení?" → odpověď + reminder
      - "Zkontroluj nové předpisy" → web search + shrnutí
      - "Kolik zaplatím z 850k jako OSVČ?" → přesný výpočet ✅ (po D-int)
      Kde: integrace všeho výše

  D7. Testování + iterace                                         [průběžně]

Týden 7–8: Generalizace
  D8. Druhý specialista (správce domácnosti / AI researcher)      [1 týden]
  D9. Specialist builder — konverzační vytvoření nového specialisty [1 týden]
```

**Co je HOTOVO:**
- ~~Deterministické účetní tools~~ ✅ (tax-calc, vat-calc, salary-calc, deadline-checker, rate-verifier) — 81 testů
- ~~Účetní spec~~ ✅ ACCOUNTANT-PILOT-SPEC.md
- ~~Integration guide~~ ✅ 6 kroků definováno
- ~~Expert personas + memory + enforcement~~ ✅

**Milestone:** "Řeknu C3: vygeneruj fakturu pro klienta Novák — a dostanu PDF."

---

### Fáze F: BALÍČKOVÁNÍ + OCHRANA (2–3 týdny)
**Cíl:** Instalovatelná aplikace, chráněný zdrojový kód.

```
  F1. Installer                                                   [1 týden]
      Možnosti (vybrat jednu):
      a) Electron wrapper — desktop app + bundled Ollama
      b) Docker compose — C3 + Ollama + SQLite
      c) pkg/nexe — single binary Node.js
      Doporučení: Electron (nejlepší UX) nebo Docker (nejjednodušší)

  F2. Setup wizard                                                [2 dny]
      - Průvodce prvním spuštěním
      - Ollama URL, model selection, jazyk, Telegram token
      Kde: nový modul

  F3. Auto-updater                                                [2 dny]
      - Check for updates, download, restart
      Kde: Electron auto-updater nebo vlastní

  F4. Source code obfuskace                                       [2 dny]
      - javascript-obfuscator nebo bytenode (V8 bytecode)
      - Ne 100% ochrana, ale ztížení čtení
      Kde: build pipeline

  F5. License key / activation system                             [3 dny]
      - Offline-first (žádný license server)
      - Hardware fingerprint + signed key
      Kde: nový modul

  F6. API rate limiting                                           [1 den]
      - Pro případný external access
      - express-rate-limit nebo vlastní
      Kde: server.js
```

**Co je HOTOVO:**
- ~~Shell injection fix~~ ✅ DEV A
- ~~Command whitelist + sandbox~~ ✅ DEV A
- ~~Secrets API auth~~ ✅ DEV A
- ~~LLM Gateway auth~~ ✅

**Milestone:** "Stáhnu C3 installer, proklikám wizard, a za 5 minut chatuju s AI."

---

## Celkový timeline

```
Fáze Q: QUALITY    ███░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░  3 dny
Fáze A: CHAT       ░░░█████░░░░░░░░░░░░░░░░░░░░░░░░░░░░  1 týden
Fáze D-int: ÚČETNÍ ░░░░░░░░███░░░░░░░░░░░░░░░░░░░░░░░░░  3 dny
Fáze B: WORKERI    ░░░░░░░░░░░██████████░░░░░░░░░░░░░░░░  2–3 týdny
Fáze C: PROJEKTY   ░░░░░░░░░░░░░░░░░░░░░████░░░░░░░░░░░░  1–2 týdny + průběžně
Fáze D: SPECIALISTÉ░░░░░░░░░░░░░░░░░░░░░░░░░░████████████  6–8 týdnů
Fáze E: IDE        ░░░██████████████████████████░░░░░░░░░  paralelně (~2 měsíce)
Fáze F: BALÍČKOVÁNÍ░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░██████  2–3 týdny
                   ──────────────────────────────────────────
                   Týden 1    Měsíc 1    Měsíc 2    Měsíc 3    Měsíc 4
```

**Milníky:**
- **Týden 1:** Chat bez jazykových úniků, správný routing
- **Týden 2:** PDF/DOCX export, účetní tools napojené
- **Týden 5:** 3 workeri běží 24/7, reálné notifikace
- **Týden 7:** Reálný projekt přes pipeline
- **Týden 8:** IDE basic runtime (Sprint 0–1)
- **Týden 14:** Účetní generuje faktury
- **Týden 16:** Instalovatelná aplikace

---

## Princip řazení

1. **Quality fixes první** — protože bez nich je 10% odpovědí ve špatném jazyce.
   Nelze mluvit o "produkčním chatu" s SK/RU leaky. Navíc jsou rychlé (3 dny).

2. **Chat dokončení** — protože ho budeš používat každý den. A protože
   každý další pilíř staví na kvalitním chatu.

3. **Účetní integrace** — protože tools jsou hotové (81 testů) a chybí jen
   6 kroků lepidla. Nejvyšší ROI: 3 dny práce → funkční specialista.

4. **Workeri** — protože jakmile běží, pracují za tebe 24/7.

5. **Projekty** — protože pipeline existuje (42 testů), potřebuje jen kilometry.

6. **IDE paralelně** — protože je na jiné ose (frontend). Neblokuje backend práci.

7. **Specialisté + balíčkování poslední** — protože jsou architektonicky nejsložitější
   a stavějí na všem ostatním.

---

## Co NEDĚLAT

1. ❌ Neimplementovat autonomy/observability/skills/copilot/ecosystem z ROADMAP v43
2. ❌ Nestavět vlastní frontend framework — Theia + vanilla JS stačí
3. ❌ Neoptimalizovat performance před dokončením features
4. ❌ Neprogramovat planner, dokud ho nezačneš používat na reálném projektu
5. ❌ Nestavět specialistu, dokud chat + workeri nefungují spolehlivě
6. ❌ Nedělat "ještě jedno vylepšení" na hotových věcech — jít dál
7. ❌ Nedělat předpřipravené šablony workerů — lepší je kvalitní wizard
8. ❌ Neřešit webUI bugy — přechod na IDE
9. ❌ Nestavět vlastní LLM — Qwen/Ollama stačí, řešit prompt engineering

---

## Kompletní task list (91 úkolů)

| # | Fáze | Úkol | Effort | Závisí na |
|---|------|------|--------|-----------|
| 1 | Q | Q1 Language enforcement | 1d | — |
| 2 | Q | Q2 CRE: thanks → CONVERSATIONAL | 2h | — |
| 3 | Q | Q3 CRE: code request → CODE | 2h | — |
| 4 | Q | Q4 Local handler i18n | 4h | — |
| 5 | Q | Q5 Response sanitization | 1h | — |
| 6 | Q | Q6 Nodiacritics tolerance | 1h | — |
| 7 | Q | Quality test assertions upgrade | 4h | Q1–Q6 |
| 8 | A | A1 fetchPage quality | 1d | — |
| 9 | A | A2 Auto-retry search | 4h | — |
| 10 | A | A3 Confidence styling | 4h | — |
| 11 | A | A5 PDF export | 1d | — |
| 12 | A | A6 DOCX generování | 1d | — |
| 13 | A | A7 Expert prompt tuning | 1d | — |
| 14 | A | A9 Legacy cleanup | 2h | — |
| 15 | D-int | D-int1 Tool registration | 2h | — |
| 16 | D-int | D-int2 Tool dispatch | 2h | #15 |
| 17 | D-int | D-int3 Enhanced accountant prompt | 3h | #15 |
| 18 | D-int | D-int4 Memory change awareness | 2h | — |
| 19 | D-int | D-int5 Rate monitor registrace | 2h | — |
| 20 | D-int | D-int6 E2E test | 1d | #15–19 |
| 21 | B | B0 E2E notification verification | 1d | — |
| 22 | B | B4 Push channel (ntfy.sh) | 1d | #21 |
| 23 | B | B5 RSS/Atom source adapter | 2d | — |
| 24 | B | B6 Multi-source agent | 2d | #23 |
| 25 | B | B9 Agent builder wizard | 3d | #21 |
| 26 | B | B8 Worker: počasí → Telegram | 2d | #21 |
| 27 | B | B8 Worker: reality → email | 2d | #21 |
| 28 | B | B8 Worker: zprávy RSS → digest | 2d | #23, #21 |
| 29 | C | C1 Multi-session projekt | 2d | — |
| 30 | C | C2 Progress tracking | 2d | — |
| 31 | C | C3 Reálný projekt | průběžně | #29, #30 |
| 32 | C | C4 Fix co se rozbije | průběžně | #31 |
| 33 | E | Sprint 0: Theia scaffold | 7d | — |
| 34 | E | Sprint 0.5: LSP validation | 2d | #33 |
| 35 | E | Sprint 1: Chat + Agent Log + WS | 7d | #34 |
| 36 | E | Sprint 2: ShellTool + Project | 7d | #35 |
| 37 | E | Sprint 3: DESIGN viewer + palette | 7d | #36 |
| 38 | E | Sprint 4: Diff viewer + review | 7d | #37 |
| 39 | E | Sprint 5: Export + Settings | 7d | #38, A5, A6 |
| 40 | E | Sprint 6: Multi-project | 7d | #39 |
| 41 | E | Sprint 7: Hardening | 7d | #40 |
| 42 | D | D1 Specialist Contract | 1w | A, D-int |
| 43 | D | D2 Specialist Runtime | 1w | #42 |
| 44 | D | D3 Document generator | 1w | A5, A6 |
| 45 | D | D4 Knowledge base | 4d | — |
| 46 | D | D5 Routine engine | 3d | B (scheduler) |
| 47 | D | D6 Účetní end-to-end | 2w | #42–46 |
| 48 | D | D7 Testování + iterace | průběžně | #47 |
| 49 | D | D8 Druhý specialista | 1w | #47 |
| 50 | D | D9 Specialist builder | 1w | #49 |
| 51 | F | F1 Installer (Electron/Docker) | 1w | E (Sprint 5+) |
| 52 | F | F2 Setup wizard | 2d | #51 |
| 53 | F | F3 Auto-updater | 2d | #51 |
| 54 | F | F4 Source code obfuskace | 2d | #51 |
| 55 | F | F5 License key system | 3d | #51 |
| 56 | F | F6 API rate limiting | 1d | — |

---

*Tento dokument nahrazuje C3-Agent-Finalni-Roadmapa.md (v57.0, 2026-02-07).
Aktualizováno o: quality findings z 350 konverzačních testů, DEV A/B merge stav,
účetní tools progress, IDE roadmap integrace, korekce od uživatele.*
