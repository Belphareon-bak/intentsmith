# Chování #2 — CRE (klasifikace a rozhodování)

**`CONTRACT.md` §3 krok 2** · **2026-08-02** · `17a8b9a8`
**Stav: schváleno 2026-08-02. Deterministická část: `tests/capability-02-cre-behaviours.test.js` — 9/9.**
**Modelová část: dosud nenapsána.**

> Rozhodnutí operátora (inventura #2, `C-2`): **CRE je na Ollamě závislá,
> testovat ji bez ní nemá přínos.** Fake LLM klient se nestaví.
>
> Většina chování je proto profil `model`. Sloupec **Model** říká, co ke svému
> ověření potřebuje běžící Ollamu — a co ne, protože LOCAL cesta a guard vrstva
> model nevolají vůbec.

---

## Deterministická vrstva — ověřitelná bez modelu

| # | Chování | Model |
|---|---|---|
| **C-01** | Dotaz na čas a na jednoduchý výpočet je klasifikován jako `LOCAL` a odpovězen bez volání modelu. | ne |
| **C-02** | Rozhodnutí `LOCAL` je terminální — nenásleduje žádné volání gateway. | ne |
| **C-03** | Každé rozhodnutí vytvoří `CRE_DIAG` záznam s `classifiedBy`, `initialIntent`, `finalIntent` a `confidence`. | ne |
| **C-04** | Když je model nedostupný, klasifikace spadne na regex, **nikdy nevyhodí výjimku** a nečeká na opakované pokusy. | ne |
| **C-05** | `shellCommand` z výstupu modelu je vždy stržen — příkaz nikdy nepochází z modelu (`GUARD 1`). | ne |
| **C-06** | `SKILL` se nevybere, když je jeho feature flag vypnutý (`GUARD 4`). | **ano** — přesunuto |
| **C-07** | Žádná zpráva neobejde `decide()` — invariant L0-1. | ne |

## Klasifikace — vyžaduje model

| # | Chování | Model |
|---|---|---|
| **C-08** | Jednoznačný dotaz na informaci je klasifikován jako `SEARCH`. | **ano** |
| **C-09** | Jednoznačná žádost o kód je klasifikována jako `CODE`, ne `SEARCH`. | **ano** |
| **C-10** | Poděkování a rozloučení je `CONVERSATIONAL`, ne `SEARCH` (routing patch Q2). | **ano** |
| **C-11** | Nejednoznačný vstup dá `AMBIGUOUS` se slotem pro upřesnění, ne odhad. | **ano** |

## Guardy nad výstupem modelu — vyžadují model

| # | Chování | Model |
|---|---|---|
| **C-12** | Při aktivní kreativní expertize je `SEARCH` přepsán na `CREATIVE` (`GUARD 6`). | **ano** |
| **C-13** | `FILE_WRITE` bez rozpoznatelného cíle se nevybere (`GUARD 2`). | **ano** |
| **C-14** | `DESIGN` bez potvrzeného deterministického vzoru je sražen na `CREATIVE` (`GUARD 5`). | **ano** |

---

## Čeho se seznam vědomě nedotýká

- **Přesnosti klasifikace jako čísla.** „Kolik procent intentů CRE trefí" je
  metrika L3 nad pevným korpusem, ne akceptační chování. Jedno chování = jeden
  jednoznačný případ.
- **Všech 19 intentů a všech 12 guardů.** Seznam pokrývá deterministickou
  vrstvu úplně a z modelové vybírá reprezentativní případy. Zbytek se přidá,
  až konkrétní chyba ukáže, že je potřeba — podle pravidla „seznam roste jen
  z reality".
- **Rozdělení `cre-decision.js`.** Operátor rozhodl nedělit (`C-4`).

---

## Otevřené z inventury, které se řeší spolu s touto schopností

**`C-1` — bez dostupného modelu trvá klasifikace ~6 000 ms.** `config.ollama.retries`
= 3, odstupy 2 s a 4 s, teprve pak regex fallback. Týká se každé zprávy.

Klasifikace **má** fallback, takže na ni čekat 6 sekund je čistá ztráta. Role
volajících a jejich limity už v `auth-types.js` existují (`LLMCallerRole.CRE_DECISION`),
takže je kam odlišnou retry politiku pověsit.

### Nesouvisí to s přepínáním modelu — ověřeno

Operátor se ptal, jestli retry neexistuje kvůli tomu, že nahrání jiného modelu
chvíli trvá. **Nesouvisí.** `gateway.js` už tyto případy rozlišuje:

| Situace | Chování dnes |
|---|---|
| Timeout / `AbortError` — model nahrává, odpovídá pomalu | *„not retrying (model is working, just slow)"*, má `config.timeouts.CHAT` = 60 s |
| Zrušení uživatelem | neopakuje se |
| **`fetch failed` — nikdo neposlouchá** | **opakuje se 3×**, odstupy 2 s a 4 s |

Pomalý model tedy retry nepotřebuje a nedostává ho. Šest sekund se platí
výhradně za odmítnuté spojení, které se za tu dobu nespraví.

### Rozhodnutí operátora — 2026-08-02

**Pro klasifikaci jeden pokus bez opakování.** Hotovo.

`C-04c` dostalo mez 2 000 ms a **selhalo na 6 091 ms** — vada doložena testem
dřív než opravou. Gateway nově přijímá `options.retries` a `classifyIntent()`
si říká o `retries: 1`. Po opravě: **80 ms**, tedy 76× rychleji. Pomalý model
zasažen není, timeouty se neopakovaly ani předtím.

### Health check Ollamy — otevřené

Operátor navrhl přidat ověření dostupnosti Ollamy, protože by to zjednodušilo
řadu věcí. Zjištění k tomu:

- `ollamaAvailable` **už existuje**, ale v `src/upgrade/model-discovery.js`,
  tedy ve schopnosti **18b, která je mimo základ**. Odvozuje se navíc nepřímo —
  `ollamaModels.length > 0`, takže běžící Ollama bez modelů vyjde jako
  nedostupná.
- Gateway (#3) sama žádný pojem dostupnosti nemá.

Zavést health check do gateway znamená sáhnout na #3, která svým seznamem
chování zatím neprošla. **Navrhuji to nedělat teď** a zařadit jako chování
schopnosti #3 (5. v pořadí) — s tou opravou, že se dostupnost má odvozovat
z odpovědi endpointu, ne z počtu modelů.
