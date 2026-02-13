# C3 – Shrnutí vývoje verzí 45–55

> Zdroj: kompletní historie této konverzace (analýza sprintů, bugů, testů, logů, rozhodnutí).
> Cíl: jednoznačný technický přehled *co se kdy dělalo a proč*, bez marketingu.

---

## v45–v47 — Základní stabilizace chatu (pre‑CRE)
**Cíl:** Zprovoznit chat bez pádů, sjednotit tok request → response.

### Provedeno
- Základní `ChatController` pipeline
- První rozdělení handlerů (conversation / search / local)
- Základní intent heuristiky (bez CRE)
- Ošetření prázdných vstupů, emoji, krátkých vstupů

### Stav
- Chat funguje, ale:
  - silně závislý na promptu
  - neoddělený routing vs. UX politika
  - nekonzistentní chování v multi‑turn

---

## v48 — Zavedení CRE (Conversation Routing Engine)
**Cíl:** Oddělit *rozhodování* od *provedení*.

### Provedeno
- CRE jako samostatná vrstva
- Rozhodnutí: `ANSWER | TOOL_CALL | LOCAL | ASK_USER`
- Základní intent taxonomy
- CRE testy (unit level)

### Přínos
- Routing je vysvětlitelný a testovatelný
- Přestává se řešit intent v promptu

### Problémy
- Controller stále přepisuje CRE rozhodnutí
- Nejasná hranice „UX guard vs. rozhodnutí“

---

## v49 — Tool pipeline & web search
**Cíl:** Stabilní SEARCH flow.

### Provedeno
- `ToolExecutor`
- `web.search` (DDG + SearX fallback)
- SearchMetrics (FAIR / EMPTY / NO_RESULTS)
- První circuit‑breaker (globální)

### Problémy
- Raw input jde přímo do search
- Follow‑up dotazy bez kontextu
- Fragmentované dotazy po sanitizaci

---

## v50 — Sanitizace & bezpečnost
**Cíl:** Zabránit šumu, instrukcím a exploitům.

### Provedeno
- `sanitizeSearchQuery()`
  - odstranění instrukcí („řekni mi“, „odpověz“ …)
  - limit délky
- SafetyEngine (pre‑check)
- Hardening ToolExecutoru

### Zjištění
- Sanitizér **čistí**, ale **nerozumí významu**
- Vznikají fragmenty („mi o Pythagorovi“)

---

## v51 — Output Quality Gate (D6)
**Cíl:** Zabránit zombie odpovědím.

### Provedeno
- `output-gate.js`
  - zombie detection
  - informační hustota
  - intent alignment
- `quality.js` – creative quality assertions

### Efekt
- Žádné:
  - „Jako AI…"
  - „Zde je odpověď…"
  - prázdné kostry

---

## v52 — History & follow‑up problémy
**Cíl:** Správné navazování dotazů.

### Provedeno
- Odhalení zásadního bugu:
  - historie obsahovala **jen assistant odpovědi**
- Návrh user+assistant pair historie

### Stav
- Follow‑up typu „A co jeho teorém?“ selhává

---

## v53 — Sprint A: CRE routing fixy
**Cíl:** Zastavit falešné SEARCH / ASK_USER.

### Provedeno
- Nové pattern sety
- Dvouvrstvý catch‑all
- Lepší detekce faktických dotazů

### Výsledek
- CRE rozhoduje správně
- Odhaleno: controller má vlastní UX override

---

## v54 — Sprint B: Search pipeline
**Cíl:** Stabilita a izolace.

### Provedeno
- Per‑session circuit breaker
- Paralelní SearX fallback
- STOP_WORDS
- Lepší SearchMetrics

### Zjištění
- Sanitized query **se nepoužívala** (context spread bug)

---

## v55 — Sprint C1 + C2: Kontext
**Cíl:** Skutečná konverzační kontinuita.

### C1 – Routing kontext
- User+assistant history pairs
- `lastTurnTopic`
- `enrichSearchQuery()`

### C2 – Synthesis kontext
- `conversationContext` v promptu
- SandboxPath isolation

### Výsledek
- Follow‑up funguje:
  - zájmena
  - změna tématu
- Chat odpovídá „o čem se bavíme“, ne jen „na co se ptáš“

---

## Shrnutí 45–55 jednou větou

> **Vývoj přešel od prompt‑driven chatu k deterministickému systému, kde jsou odděleny vrstvy: rozhodnutí (CRE), data (tools), kontext (history), kvalita (gates) — a zůstává poslední chybějící článek: sémantická transformace dotazu (Query Canonicalizer).**

---

## Co zůstalo otevřené po v55
- ❌ Query Canonicalizer (význam → dotaz)
- ❌ Language lock v synthesis
- ❌ ExpertHandler hijack
- ❌ Délkové instrukce (1 věta vs. realita)

---

*Konec souboru*

