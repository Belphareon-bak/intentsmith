# C3-Agent — Chat Quality Roadmap
## Od funkčního routingu k produktově kvalitnímu chatu

**Verze:** v55.2 → v56+
**Datum:** 2026-02-05
**Stav:** Architektura solidní, výstupní kvalita neověřená

---

## Současný stav — objektivně

### Co máme a funguje
```
INPUT → Intent classify → CRE decide → Route → [Handler] → OUTPUT
  ✅        ✅              ✅           ✅       ⚠️          ❌
```

| Vrstva | Stav | Poznámka |
|--------|------|----------|
| Intent classification | ✅ Solid | 18 testů, priority chain, sticky logic |
| Decision invariants | ✅ Solid | 6 hard invariants, constructor throws |
| Safety pre-check (A3) | ✅ Solid | ALLOW/RESTRICT/REFUSE |
| Routing | ✅ Solid | Explicitní, žádné fallbacky |
| Build handoff | ✅ Solid | State machine s cancel |
| Quality pipeline (vstup) | ✅ Solid | K5.1-K5.5, source trust, relevance |
| Output gate (D6) | 🆕 Nový | Zombie, density, format enforcement |
| Web search | ⚠️ Funguje ale nekvalitně | DDG parsing, SearX fallback, fetchPage |
| ANSWER (konverzace/kreativa) | ⚠️ Závisí na LLM | Forbidden phrase check + creative gate |
| File export | ❌ Neexistuje | file.write jen do sandboxu, žádné formáty |
| Frontend | ❌ Neexistuje | Jen agents.html, žádné chat UI |
| Conversation memory | ⚠️ Částečné | History in-memory, LongTermMemory existuje |
| E2E testování | ❌ 0 testů | Unit testy jsou, ale žádný E2E flow test |

### Klíčový insight
**Systém správně rozhoduje KAM dotaz směřovat, ale nekontroluje CO se na konci vrátí.**

Output gate (D6) řeší post-synthesis validation. Ale to nestačí — je to jen poslední záchrana. Kvalita musí vzniknout ve třech bodech:
1. **Kvalita vstupních dat** (web search musí vrátit relevantní obsah)
2. **Kvalita syntézy** (prompty pro LLM musí vynucovat konkrétní obsah)
3. **Kvalita validace** (D6 gate musí zamítnout špatné výstupy)

---

## Roadmapa — 4 fáze

### Fáze 1: Web Search Quality (KRITICKÁ)
**Proč první:** Bez kvalitních dat nemůže LLM syntetizovat kvalitní odpověď. Garbage in → garbage out.

#### 1.1 Search Provider Reliability
**Problém:** DDG HTML parsing je fragile. SearX instance padají. Žádné metriky úspěšnosti.

**Stav dnes:**
- `searchDDG()` parsuje HTML response z html.duckduckgo.com → brittle, DDG může změnit HTML
- `searchSearX()` — 5 hardcoded instancí, rotace na failure, 5min cooldown
- Žádný Brave/Google/Bing API klíč
- `parseDDGResults()` — regex parsing HTML snippetů

**Úkoly:**
- [ ] **Search provider metriky** — logovat: request_count, success_rate, avg_latency per provider
- [ ] **Search result quality score** — po parsingu: kolik výsledků má title + snippet + URL? Prázdný snippet = degraded
- [ ] **DDG fallback zlepšení** — DDG lite API (api.duckduckgo.com/q=...) jako alternativa k HTML parsingu
- [ ] **SearX instance health** — místo hardcoded seznamu: endpoint /api/search/providers vrací živé instance
- [ ] **Volitelný API klíč** — config pro Brave Search API / Google Custom Search (platba za kvalitu)

**Test T7.1:**
```
searchWeb("nejlepší restaurace Praha") → ≥ 5 výsledků s title + snippet + url
searchWeb("aktuální kurz EUR/CZK") → ≥ 1 výsledek s číslem v snippet
```

#### 1.2 Scrape Quality (fetchPage)
**Problém:** `fetchPage()` je jednoduchý HTML-to-text stripper. Na moderních SPA stránkách vrátí prázdno nebo navigační menu.

**Stav dnes:**
- Odstraní `<script>`, `<style>`, `<nav>`, `<header>`, `<footer>`
- Regex extrakce `<article>`, `<main>`, `<div class="content">`
- Max 5000 znaků → na reportech často ořízne klíčový obsah
- Žádná detekce: "dostal jsem login stránku" nebo "dostal jsem cookie banner"

**Úkoly:**
- [ ] **Content quality detection** — po scrape: je content delší než 200 znaků? Obsahuje slova z query? Pokud ne → skip tento zdroj
- [ ] **Smart truncation** — místo `substring(0, 5000)` → extrahuj odstavce relevantní ke query (keyword overlap scoring)
- [ ] **Block detection** — rozpoznej: login wall, cookie popup, paywall, "enable JavaScript" → loguj a skip
- [ ] **Readability extraction** — implementuj algo typu Readability.js (Mozilla) pro čistější extrakci main contentu
- [ ] **Configurable maxLength** — REPORT pipeline potřebuje víc dat než SEARCH (10K vs 5K)

**Test T7.2:**
```
fetchPage("https://cs.wikipedia.org/wiki/Praha") → content.length > 1000
fetchPage("https://some-spa-site.com") → content_quality_score > 0 (not just nav links)
```

#### 1.3 Search-to-Synthesis Pipeline
**Problém:** SEARCH intent → 1 search → top results → synthesis. Ale pro složitější dotazy by pomohl iterativní search.

**Stav dnes:**
- SEARCH: `searchWeb(query)` → top výsledky → `synthesizeWithLLM()`
- REPORT: `searchWeb()` → top 5 URLs → `fetchPage()` each → `synthesizeWithLLM()`
- ITEM_LOOKUP: totéž jako REPORT ale s item formatting
- Žádná schopnost: "search nevrátil nic užitečného → reformuluj query a zkus znovu"

**Úkoly:**
- [ ] **Search retry s reformulací** — pokud search vrátí < 3 výsledky nebo nízký relevance score → LLM reformuluje query → retry (max 1)
- [ ] **Multi-query pro REPORT** — místo jednoho search query pro report → LLM vygeneruje 2-3 doplňkové queries pro komplexní téma
- [ ] **Result deduplication** — merge výsledky z více queries, odstranit duplicitní URL

**Test T7.3:**
```
REPORT("stav AI v 2024") → search použije ≥ 2 queries
REPORT fallback → pokud první search vrátí 0, reformuluje a zkusí znovu
```

---

### Fáze 2: Response Quality (VYSOKÁ PRIORITA)
**Proč druhá:** S kvalitními daty teď potřebujeme kvalitní syntézu.

#### 2.1 ANSWER Path — Conversational & Creative
**Problém:** `handleAnswerDecision()` posílá input přímo do LLM s generic system promptem. Žádné post-processing kromě forbidden phrase check.

**Stav dnes:**
- System prompt: "You are a helpful AI assistant in CONVERSATIONAL mode"
- History: posledních 5 zpráv jako context
- Creative quality gate: `assertCreativeQuality()` — loguje ale neblokuje (comment: "For now, log but don't block")
- D6 output gate zatím NENÍ hooknutý do ANSWER path (jen v synthesis.js pro TOOL_CALL)

**Úkoly:**
- [ ] **D6 gate pro ANSWER path** — hookovat `enforceOutputContract()` i do `handleAnswerDecision()`, ne jen do `synthesizeWithLLM()`
- [ ] **Creative quality gate enforcement** — přepnout z log-only na retry (assertCreativeQuality → fail → retry s přísnějším promptem)
- [ ] **Conversational system prompt upgrade** — přidat: "pokud nevíš, řekni to, ale nabídni alternativu" místo generic "you are helpful"
- [ ] **Czech language quality** — system prompt musí explicitně říct: odpovídej česky pokud user mluví česky

**Test T8.1:**
```
ANSWER("ahoj") → response v češtině, ne "Hello!"
ANSWER("vymysli kampaň pro kavárnu") → response > 200 znaků s konkrétními nápady
ANSWER("co si myslíš o AI?") → response bez "jako jazykový model"
```

#### 2.2 TOOL_CALL Path — Synthesis Quality
**Problém:** Output gate D6 už validuje. Ale synthesis prompty potřebují zpřísnit.

**Stav dnes:**
- Synthesis system prompt je dobrý pro REPORT a ITEM_LOOKUP (specifické instrukce)
- Pro SEARCH intent je generic: "Lead with most relevant info, include URLs"
- FACTUAL: "Direct answer first, brief explanation"
- D6 gate: zombie, density, format enforcement ✅

**Úkoly:**
- [ ] **FACTUAL synthesis hardening** — vynucuj: "Odpověz JEDNOU větou s konkrétním faktem. Pak krátce vysvětli."
- [ ] **SEARCH synthesis hardening** — vynucuj: "Začni odpovědí, ne seznamem zdrojů. Uveď čísla/data kde existují."
- [ ] **Confidence-based response styling** — confidence < 0.5 → explicitně řekni "nenašel jsem nic spolehlivého"
- [ ] **Source citation format** — jednoduchý formát: `[1]` na konci věty, zdroje dole. Ne inline URLs v textu.

**Test T8.2:**
```
SEARCH("kolik obyvatel má Praha") → odpověď začíná číslem, ne "Vyhledal jsem..."
REPORT("AI trendy 2024") → odpověď má ≥ 3 konkrétní fakta s čísly
FACTUAL("kdy je deadline DPFO") → odpověď ≤ 3 věty s konkrétním datem
```

#### 2.3 Response Language Consistency
**Problém:** LLM někdy odpoví anglicky na český dotaz, nebo mixuje jazyky.

**Stav dnes:**
- Žádná explicitní language detection
- System prompt je v angličtině → LLM má tendenci odpovídat anglicky
- REPORT/ITEM_LOOKUP prompt explicitně obsahuje české fráze → pomáhá

**Úkoly:**
- [ ] **Language detection** — jednoduchý regex: je vstup česky? (diakritika, české vzory)
- [ ] **Dynamic system prompt language** — pokud vstup česky → přidej "ODPOVÍDEJ VÝHRADNĚ ČESKY" do system promptu
- [ ] **Mixed language fallback** — pokud search results jsou anglicky ale user česky → instrukce: "přelož do češtiny"

**Test T8.3:**
```
"co je to GraphQL" → response v češtině
"vysvětli mi DPH" → response 100% v češtině
"explain DPH" → response v angličtině (respektuje jazyk uživatele)
```

---

### Fáze 2.5: User Expectation Alignment (SOUČÁST SPRINTU 2)
**Identifikováno v review:** Systém dělá správnou věc (ASK_USER, RESTRICT, DEGRADE) ale uživatel to vnímá jako vyhýbání.

#### Stav dnes — rozptýlený, nekonzistentní
Messaging existuje na 4 místech, každé jinak:

| Situace | Kde se řeší | Formát | Problém |
|---------|-------------|--------|---------|
| ASK_USER | `formatClarificationRequest()` | `🤔 "input" Upřesněte záměr:` + options | OK, ale generické |
| REFUSE | `handleRefuseDecision()` | `⚠️ Tento požadavek nemohu zpracovat.` | Bez alternativy |
| Tool failure | `buildFailureFallback()` | Structured options + human text | Nejlepší z těchto — ale jen pro tool selhání |
| D6 gate fail | `synthesizeWithLLM()` → retry/degrade | Confidence 0.55, žádná user zpráva | User neví, že dostal degraded |
| REPORT fallback | `buildReportFallback()` | `⚠️ Nelze získat aktuální zdroje` + orientační přehled | Slušné ale statické |

#### Problém
5 různých formátů pro 5 různých "nemůžu ti teď plně odpovědět" situací. Uživatel nedokáže rozlišit severity ani akci.

#### Řešení: `buildExpectationMessage(type, context)`
Jeden deterministický generátor, který pokrývá všechny non-happy-path situace:

```
Type: CLARIFYING   → "Potřebuji upřesnit X, abych mohl Y" (co chybí + proč)
Type: DEGRADED     → "Odpovídám s omezenými daty: Z" (co mám + co chybí)
Type: SEARCHING    → "Hledám, ale zatím nemám nic konkrétního" (transparency)
Type: REFUSING     → "Tohle nemohu, ale mohu nabídnout A" (alternativa)
Type: RETRYING     → "První pokus nesplnil kvalitu, zkouším znovu" (pro debug/verbose)
```

**Úkoly:**
- [ ] **Sjednotit messaging** — jeden modul `expectation.js` s `buildExpectationMessage(type, context)`
- [ ] **Povinná alternativa** — REFUSE nikdy bez nabídky alternativy (dnes je to jen "přeformulujte dotaz")
- [ ] **Degraded transparency** — když D6 gate projde s confidence 0.55, přidej suffix: "⚠️ Odpověď vychází z omezených dat."
- [ ] **Testovatelné** — pattern matching na výstup: každý expectation type má povinné části

**Test T8.4:**
```
REFUSE → response obsahuje alternativní akci (ne jen "přeformulujte")
DEGRADE → response obsahuje upozornění na omezenou kvalitu
ASK_USER → response vysvětluje CO chybí a PROČ to potřebuje
```

---

### Fáze 3: File Export & Conversation Memory (STŘEDNÍ PRIORITA)
**Proč třetí:** Uživatel chce výsledky nejen vidět, ale i uložit a navázat.

#### 3.1 File Export System
**Problém:** `file.write` umí jen plaintext do sandboxu. Žádný export do formátů (PDF, MD, DOCX).

**Stav dnes:**
- `executeFileWrite()` → `fs.writeFile(path, content, 'utf-8')` → jen plaintext
- Žádný intent pro "exportuj / ulož / vygeneruj dokument"
- Žádný formát conversion

**Úkoly:**
- [ ] **EXPORT intent v CRE** — nový intent type nebo sub-intent: "ulož to jako PDF", "exportuj do markdown"
- [ ] **Markdown export** — triviální: response text → .md soubor s metadaty
- [ ] **HTML export** — response text → HTML template s CSS styly
- [ ] **PDF export** — via puppeteer nebo jsPDF: HTML → PDF
- [ ] **Export pipeline** — `EXPORT` intent → posbírej poslední response(s) → formátuj → ulož → vrať link
- [ ] **Download endpoint** — `GET /api/export/:fileId` → slouží soubor

**Test T9.1:**
```
"ulož to jako markdown" → .md soubor ke stažení
"exportuj report do PDF" → .pdf soubor ke stažení
"vygeneruj HTML stránku" → .html soubor ke stažení
```

#### 3.2 Conversation Memory Enhancement
**Problém:** `POST /chat` vytváří one-shot session. `POST /api/chat` používá conversation_id ale history je jen in-memory v ChatController.

**Stav dnes:**
- `ChatController.#responseHistory` — in-memory array, max 10 items
- `LongTermMemory` — SQLite persistent store (existuje, ale není napojená na chat flow)
- Messages se ukládají do DB (`db.messages.addMessage`) → ale ChatController je nečte zpět
- Při restartu serveru: všechny session states ztraceny

**Úkoly:**
- [ ] **Session state persistence** — při `ChatController.handle()` uložit session state do DB, při dalším handle() načíst zpět
- [ ] **History from DB** — místo `#responseHistory.slice(-10)` → načti posledních 10 zpráv z `messages` tabulky
- [ ] **LongTermMemory integration** — po každé konverzaci: extrahuj fakta → ulož do long-term memory → dostupné v dalších session
- [ ] **POST /chat upgrade** — přijímej volitelný `session_id` → pokud existuje, navazuj na existující session

**Test T9.2:**
```
Session persistence: send 3 messages → restart server → 4th message has context
LongTermMemory: "Jmenuji se Petr" → later session → "Jak se jmenuji?" → "Petr"
```

#### 3.3 Frontend (Chat UI)
**Problém:** Žádné chat UI neexistuje. Jen API endpointy.

**Stav dnes:**
- `agents.html` — HTML UI pro agent builder (nesouvisí s chatem)
- Žádný chat interface
- API je hotové: `POST /api/chat`, `GET /api/conversations/:id/messages`

**Úkoly:**
- [ ] **Minimální chat UI** — single-page HTML+JS: message list, input box, send button
- [ ] **Conversation list** — sidebar s historií konverzací
- [ ] **Markdown rendering** — response se zobrazuje jako formatted markdown
- [ ] **Export button** — u každé odpovědi: "Exportovat jako MD/PDF"
- [ ] **Mode indicator** — zobrazit aktuální mode (conversation/project/expert)
- [ ] **Confidence indicator** — barevný indikátor confidence u odpovědi

**Poznámka:** Frontend je nice-to-have. API-first přístup je správný. Ale pro testování a demo je UI nezbytné.

---

### Fáze 4: Expert System (POSLEDNÍ)
**Proč poslední:** Expert je overlay na kvalitní chat. Bez kvalitního chatu je expert jen persona na špatné odpovědi.

**Prerequisity:**
- ✅ Web search vrací kvalitní data (Fáze 1)
- ✅ Syntéza produkuje obsahové odpovědi (Fáze 2)
- ✅ D6 gate validuje výstupy (DONE)
- ✅ Konverzační paměť funguje (Fáze 3)

**Stav dnes (expert handler):**
- `expertHandler()` — CRE decide s expert context → expert persona overlay
- Expert NEMĚNÍ decision type (invariant)
- Expert jen INTERPRETUJE výsledky svým stylem
- `expert-layer.js` — definice expertů s doménami, styly, hloubkou
- Custom experts v DB

**Co bude potřeba doladit:**
- [ ] Expert-specific synthesis prompts (ne generic overlay)
- [ ] Domain-specific quality gates (health expert nesmí dávat diagnózy)
- [ ] Expert confidence calibration (expert ≠ vyšší confidence automaticky)
- [ ] Expert memory (expert si pamatuje kontext domény přes sessions)

---

## Prioritizovaný úkolový seznam

### Sprint 1: Search Foundation (est. 2-3 dny)
```
1.1 Search provider metriky + quality score + usefulness tracking
    (logovat: query → result_count → reformulace? → degradace? → "nic nenalezeno"?)
1.2 fetchPage content quality detection + block detection
2.3 Language detection + dynamic system prompt language
```
**Výstup:** Search vrací měřitelně kvalitní data, odpovědi jsou ve správném jazyce.

### Sprint 2: Synthesis Hardening + Expectation (est. 3-4 dny)
```
2.1 D6 gate pro ANSWER path + creative gate enforcement
2.2 FACTUAL/SEARCH synthesis prompt zpřísnění
2.2 Source citation format
2.5 User Expectation Alignment — sjednocený messaging modul
1.3 Search retry s reformulací
```
**Výstup:** Odpovědi obsahují konkrétní informace. Non-happy-path komunikuje jasně.

### Sprint 3: Memory & Persistence (est. 2-3 dny)
```
3.2 Session state persistence (DB backing)
3.2 History from DB (survive restart)
3.2 POST /chat session upgrade
```
**Výstup:** Konverzace přežije restart, kontext se zachovává.

### Sprint 4: Export & UI (est. 3-4 dny)
```
3.1 Markdown + HTML export
3.1 Export pipeline + download endpoint
3.3 Minimální chat UI
3.1 PDF export (optional — závisí na puppeteer)
```
**Výstup:** Uživatel vidí chat UI, může exportovat odpovědi.

### Sprint 5: Expert Layer (est. 3-4 dny)
```
4.x Expert-specific synthesis
4.x Domain quality gates
4.x Expert memory
```
**Výstup:** Kvalitní expert overlay na kvalitním chatu.

---

## E2E Test Strategy

Pro každý sprint: E2E test, který simuluje celý flow bez mockování LLM.

```
T7: Web Search Quality Tests (Sprint 1)
  T7.1: Search returns ≥ N results with title+snippet+url
  T7.2: fetchPage extracts meaningful content (not nav/login)
  T7.3: REPORT pipeline uses multi-query

T8: Response Quality Tests (Sprint 2)
  T8.1: ANSWER produces Czech, concrete, non-zombie responses
  T8.2: TOOL_CALL synthesis starts with answer, not process narration
  T8.3: Language consistency (Czech in → Czech out)

T9: Export & Memory Tests (Sprint 3-4)
  T9.1: Export pipeline produces downloadable files
  T9.2: Session persistence survives restart

T10: Expert Quality Tests (Sprint 5)
  T10.1: Expert doesn't change decision type
  T10.2: Expert synthesis uses domain-specific style
  T10.3: Domain safety gates block harmful advice
```

---

## Metriky úspěchu

Kdy je chat "kvalitní"?

| Metrika | Cíl | Jak měřit |
|---------|-----|-----------|
| Search success rate | ≥ 80% | provider metriky |
| Zombie response rate | < 5% | D6.1 gate logs |
| Content density pass rate | ≥ 90% | D6.2 gate logs |
| Format compliance | ≥ 85% | D6.3 gate logs |
| Language consistency | ≥ 95% | manual spot check |
| Unit test coverage | 100% pass | T1-T6 (103 testů) |
| E2E test coverage | ≥ 80% pass | T7-T9 |

---

## Co NEDĚLAT

1. **Nepřidávat nové intent types** — současných 8 pokrývá všechno
2. **Neměnit CRE invarianty** — jsou správné
3. **Neměnit safety engine** — A3 je kompletní
4. **Nepsat frontend před kvalitním API** — API-first
5. **Nepřidávat experty před kvalitním chatem** — expert na špatném chatu = špatný expert
6. **Neoptimalizovat performance** — je to předčasné, nejdřív kvalita
