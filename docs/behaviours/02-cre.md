# Chování #2 — CRE (klasifikace a rozhodování)

**`CONTRACT.md` §3 krok 2** · **2026-08-02** · `17a8b9a8`
**Stav: schváleno 2026-08-02.**

| Část | Sada | Výsledek |
|---|---|---|
| deterministická | `tests/capability-02-cre-behaviours.test.js` | **9/9** |
| modelová | `tests/capability-02-cre-model-behaviours.test.js` | **8/9 — `C-13` selhalo** |

> **Schopnost #2 je `FAIL`.** Ne „skoro hotová" — `CONTRACT.md` §5: jedno
> neprocházející chování ze schváleného seznamu je FAIL celé schopnosti.
> Detail nálezu je níže v § `C-13`.

Modelová sada běžela proti Ollamě na `127.0.0.1:11434`, model `qwen3.5:27b`
(`config.models.CHAT`, protože `FAST` není nastaven). Dva běhy, shodný výsledek —
`C-13` tedy není variance modelu. Bez Ollamy sada končí `BLOCKED` (exit 2), nikdy
ne zeleně.

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
| **C-05** | `shellCommand` z výstupu modelu je vždy stržen — příkaz nikdy nepochází z modelu (`GUARD 1`). | **ano** — přesunuto |
| **C-06** | `SKILL` se nevybere, když je jeho feature flag vypnutý (`GUARD 4`). | **ano** — přesunuto |
| **C-07** | Žádná zpráva neobejde `decide()` — invariant L0-1. | ne |

## Klasifikace — vyžaduje model

| # | Chování | Model |
|---|---|---|
| **C-08** | Jednoznačný dotaz na informaci je klasifikován jako `SEARCH`. | **ano** |
| **C-09** | Jednoznačná žádost o kód je klasifikována jako `CODE`, ne `SEARCH`. | **ano** |
| **C-10** | Poděkování a rozloučení je `CONVERSATIONAL`, ne `SEARCH` (routing patch Q2). | ~~ano~~ **ne** |
| **C-11** | Nejednoznačný vstup dá `AMBIGUOUS` se slotem pro upřesnění, ne odhad. | **ano** |

## Guardy nad výstupem modelu — vyžadují model

| # | Chování | Model |
|---|---|---|
| **C-12** | Při aktivní kreativní expertize je `SEARCH` přepsán na `CREATIVE` (`GUARD 6`). | **ano** |
| **C-13** | `FILE_WRITE` bez rozpoznatelného cíle se nevybere (`GUARD 2`). | **ano** |
| **C-14** | `DESIGN` bez potvrzeného deterministického vzoru je sražen na `CREATIVE` (`GUARD 5`). | **ano** |

---

## `C-13` — nález, vyžaduje rozhodnutí operátora

**Chování:** „`FILE_WRITE` bez rozpoznatelného cíle se nevybere (`GUARD 2`)."
**Skutečnost:** vybere se.

```
vstup:      „ulož to"
model:      FILE_WRITE, confidence 0.9, fileTarget: null
rozhodnutí: FILE_WRITE, type LOCAL, handler file.write, filePath: null
```

`_validateLLMResult()` (`cre-decision.js:2519`) `FILE_WRITE` bez cíle **nezamítá**,
pokud vstup obsahuje signál uložení — a `/ulo[žz]/` je přesně on. Komentář na
řádku 2522 to říká záměrně: *„user might say 'ulož to do souboru' (auto-generate)"*.

Cesta pak pokračuje takto:

| Krok | Co se stane |
|---|---|
| `cre-decision.js:3699` | `filePath = llmMeta.fileTarget \|\| extractWriteFilePath(input)` → `null` |
| `handlers/file.js:553` | cíl chybí → **vygeneruje se `output-<timestamp>.md`** |
| `handlers/file.js:540` | bez aktivního projektu je základ cesty **`process.cwd()`** |

Na „ulož to" tedy vznikne soubor, o který nikdo nepožádal, se jménem, které
nikdo nezadal, v aktuálním pracovním adresáři.

### Rozpor je mezi seznamem a návrhem, ne v testu

Kód dělá to, co v něm někdo záměrně zamýšlel. Schválené chování `C-13` říká něco
jiného. Jedno z toho je špatně a **rozhodnout to nepřísluší agentovi** —
`CONTRACT.md` §7 dovoluje opravit chybu, ne přepsat schválený seznam.

| Varianta | Co znamená |
|---|---|
| **A — opravit kód** | `FILE_WRITE` bez cíle se nevybere; „ulož to" skončí dotazem na jméno souboru. `C-13` platí, jak je schválené. Cena: uživatel musí jméno vždy zadat. |
| **B — opravit chování** | `C-13` se přeformuluje na „`FILE_WRITE` bez cíle **a bez signálu uložení** se nevybere". Auto-jméno zůstává funkcí. Cena: „ulož to" dál mlčky zapisuje do `cwd()`. |
| **B′ — B plus potvrzení** | Auto-jméno zůstane, ale zapíše se až po potvrzení navrženého jména. Nejdražší, žádná ze dvou cen se neplatí. |

Do rozhodnutí zůstává test **červený**. Snížit ho kvůli zelené zakazuje
`CONTRACT.md` §7.

---

## Opravy sloupce „Model" proti schválené verzi

Sloupec je pozorování o prerekvizitě, ne součást chování — samotné věty se
nemění. Běh ukázal, že dvě hodnoty neseděly:

| # | Schváleno | Skutečnost | Doklad |
|---|---|---|---|
| **C-05** | ne | **ano** | `GUARD 1` (`delete parsed.shellCommand`) je uvnitř `_llmClassifyIntent()`. Bez modelu se ta cesta nikdy nespustí, takže bez modelu chování neověří nic. Přesunuto do modelové sady. |
| **C-10** | ano | **ne** | `isGratitudeOrFarewell()` je na deterministické fast-path (`cre-decision.js:3047`), model se nevolá. Ověřeno: `classifiedBy: "deterministic"`. |

`C-10` **zatím zůstává v modelové sadě**, kde ho schválený seznam umístil.
Přesun do deterministické sady je návrh k odsouhlasení — získal by se tím jeden
zelený důkaz navíc bez prerekvizity Ollamy.

**Seznam měl 14 chování, testy mělo 5.** Zbývalo jich devět, ne sedm, jak uváděl
předchozí handoff: navíc `C-05` (viz výše) a `C-06` (v tabulce označené
„přesunuto", ale v žádné sadě). Modelová sada teď pokrývá všech devět.

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
