# Inventura #2 — CRE (klasifikace a rozhodování)

**Schopnost:** #2 podle `CONTRACT.md` §6 · **Datum:** 2026-08-02
**Commit:** `17a8b9a8` · **Stav:** k schválení operátorem

> `CONTRACT.md` §3 krok 1. Popisuje stav, nerozhoduje.

---

## 1. Rozsah

| Soubor | Řádků |
|---|---:|
| `src/chat/cre-decision.js` | **4 196** |
| `src/chat/cre-routing-patches.js` | 134 |
| **Celkem** | **4 330** |

`controller.js` (2 173 ř.) je konzument CRE, ne její součást — patří do #6.

---

## 2. Co jsem naměřil a přečetl

| | |
|---|---|
| Decision typy | **8** (`TOOL_CALL`, `ASK_USER`, `ANSWER`, `REFUSE`, `LOCAL`, `PLAN`, `SKILL`) |
| Intent typy | **19** |
| Guardů | **12** (`GUARD 1` … `GUARD 12`) |
| Deterministická klasifikace (LOCAL) | 0–1 ms |
| Klasifikace **bez dostupného modelu** | **~6 000 ms**, pak regex fallback |

### Jak klasifikace ve skutečnosti běží

Kód na řádku 1074 to říká přímo: *„v71: Primary classification is LLM-based
(`_llmClassifyIntent`)."*

```
vstup
 ├─ deterministické vzory (LOCAL: čas, matematika, kalendář)   → terminální, <1 ms
 ├─ deterministické SKILL vzory
 └─ _llmClassifyIntent()  ← PRIMÁRNÍ CESTA
      ├─ úspěch → 12 guardů validuje a opravuje výstup LLM
      └─ selhání → regex fallback
```

**CRE je LLM-first s deterministickou guard vrstvou, ne deterministický
klasifikátor.** To je pro roadmapu podstatnější než cokoli jiného v této
inventuře, protože to určuje, co je vůbec možné otestovat bez modelu.

---

## 3. Seznam 1 — co je dobré a použije se

| Co | Proč |
|---|---|
| **12 guardů jako deterministická vrstva nad LLM** | Výstup modelu se nebere na slovo — guardy strhávají `shellCommand`, vynucují `fileTarget`, srážejí `DESIGN` bez potvrzeného vzoru, hlídají feature flag u `SKILL`. Přesně ten vzor, který má LLM-first návrh mít. |
| **LOCAL jako terminální rozhodnutí** | Čas, matematika a kalendář se počítají deterministicky, bez modelu, pod 1 ms. Ověřeno měřením. |
| **Regex fallback při výpadku modelu** | Systém nespadne. Klasifikuje hůř, ale klasifikuje. |
| **Gatekeeper audit** | Počitadla rozhodnutí vázaná na DB (`server.js:1300`), 43 asercí ve vlastní sadě. |
| **`CRE_DIAG` trace** | Každé rozhodnutí loguje `classifiedBy`, `initialIntent`, `finalIntent`, `isIntentBreak`, `confidence`, `slots`. Skvělý materiál pro L3. |
| **`cre-routing-patches.js`** | Malý, izolovaný, otestovaný a **skutečně zapojený** (import na `cre-decision.js:32`). |
| **Testové pokrytí** | 401 asercí v `cre-comprehensive`, 43 v gatekeeperu, dalších ~140 v šesti sadách. |

---

## 4. Seznam 2 — co je zbytečné

| Co | Doklad |
|---|---|
| **Zavádějící komentář v `cre-routing-patches.js`** | Hlavička říká *„Integration: Add these patterns to `classifyIntent()` … BEFORE the existing SEARCH/FACTUAL classification"* — jako by to byl nezaintegrovaný návrh. Integrace přitom proběhla, soubor je importovaný. Popis neodpovídá skutečnosti. |

Nic dalšího jsem jako prokazatelně zbytečné neoznačil. Sporné věci jsou níže.

---

## 5. Seznam 3 — co je nejasné a potřebuje rozhodnutí

| # | Zjištění | Otázka |
|---|---|---|
| **C-1** | **Bez dostupného modelu trvá každá klasifikace ~6 sekund.** `config.ollama.retries` = 3, gateway zkouší s odstupy 2 s a 4 s, a teprve pak spadne na regex. Naměřeno: `classificationTimeMs: 6065`. Týká se **každé** zprávy, ne jen jedné. | Má být retry politika pro *klasifikaci* jiná než pro *generování*? Klasifikace má fallback, takže na ni čekat 6 s nedává smysl. |
| **C-2** | **Všechny CRE sady kromě jedné jsou v registru profil `model`, `ollama: true`.** Tím jsou **mimo deterministický rozsah `G0-C5`**. Gate 0 „199 deterministických PASS" tedy o CRE — jádru systému — neříká nic. Všechny mají `lastGreen.commit: null`. | Má CRE dostat deterministickou testovací cestu (fake LLM klient), nebo se smíří s tím, že jádro se ověřuje jen s běžící Ollamou? |
| **C-3** | **`cre-guard-interactions` padá 1 z 25 bez modelu.** Regex fallback vrátí `PLAN` tam, kde test čeká non-BUILD při aktivním `creativeLock`. Není to vada guardu — je to rozdíl mezi LLM cestou a fallbackem. | Má se od fallbacku vyžadovat shoda s LLM cestou, nebo je přijatelné, že klasifikuje jinak? To je produktové rozhodnutí, ne testovací. |
| **C-4** | **`cre-decision.js` má 4 196 řádků** a drží v jednom souboru typy, vzory, LLM klasifikaci, 12 guardů, arbitraci a fallback. | Rozdělit jako #6 a `system.js`, nebo je soudržnost rozhodovací logiky důvod nechat to pohromadě? |
| **C-5** | **Dokumentace neodpovídá kódu.** `CLAUDE.md` uvádí soubor `src/chat/cre-decision-types.js`, který **neexistuje** (typy jsou v `cre-decision.js:63` a `:80`); uvádí „11 guard pravidel" a „~2 900+ ř." (skutečnost: 12 a 4 196); a její tabulka intentů obsahuje `ANALYZE`, `AGENT_WIZARD`, `ATTACHMENT_EXPLAIN`, které v `IntentType` nejsou, a naopak vynechává `ITEM_LOOKUP`, `FILE_READ`, `FILE_WRITE`, `SHELL`, `SKILL`, `CODE_ANALYSIS` a `COMMAND`. | Opravit `CLAUDE.md` teď, nebo až po inventuře všech schopností jednou dávkou? |

---

## 6. Co inventura nenašla

- **Žádný bypass CRE** — invariant L0-1 drží; nenašel jsem cestu, kterou by zpráva obešla `decide()`.
- **Žádný mrtvý guard** — všech 12 je v rozhodovací cestě dosažitelných.
- **Žádný osiřelý modul** — `cre-routing-patches.js` je zapojený, ne opuštěný.

---

## 7. Rozhodnutí operátora — 2026-08-02

| # | Rozhodnutí |
|---|---|
| **C-1** | Otevřeno. Retry politika klasifikace se vyhodnotí s ostatními až po kompletní inventuře. |
| **C-2** | **Uzavřeno. CRE je na Ollamě závislá, testovat ji bez ní nemá přínos.** Profil `model` zůstává, deterministická cesta přes fake LLM se nedělá. |
| **C-3** | **Uzavřeno týmž rozhodnutím.** Odchylka regex fallbacku od LLM cesty není vada — bez modelu se stejné chování neočekává. |
| **C-4** | **Uzavřeno. Nedělit.** 4 196 řádků je v pořádku; nesouhlasí dokumentace, ne kód. |
| **C-5** | **Dokumentace je legacy.** Zjištění této inventury jsou aktuálnější než `CLAUDE.md`. Neopravovat po kouscích — až po kompletní inventuře, jako celek. |

**Metodické rozhodnutí:** inventura pokračuje všemi částmi bez zastavování na
dílčí otázky. Otevřené položky se sbírají a řeší se dohromady na konci.
