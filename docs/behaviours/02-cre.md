# Chování #2 — CRE (klasifikace a rozhodování)

**`CONTRACT.md` §3 krok 2** · **2026-08-02** · `17a8b9a8`
**Stav: schváleno 2026-08-02.**

| Část | Sada | Výsledek |
|---|---|---|
| deterministická | `tests/capability-02-cre-behaviours.test.js` | **10/10** |
| modelová | `tests/capability-02-cre-model-behaviours.test.js` | **9/9** |

> **Schopnost #2 je `PASS`.** Všech 15 chování má právě jeden test a všechny
> procházejí. Chování `C-15` přibylo jako regrese z nálezu `C-13` — podle
> pravidla „seznam roste jen z reality".

Modelová sada běžela proti Ollamě na `127.0.0.1:11434`, model `qwen3.5:27b`
(`config.models.CHAT`, protože `FAST` není nastaven). Bez Ollamy končí `BLOCKED`
(exit 2), nikdy ne zeleně.

**Rozdělení chování mezi sady** — 6 deterministických (`C-01`–`C-04`, `C-07`,
`C-15`), 9 modelových (`C-05`, `C-06`, `C-08`–`C-14`).

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
| **C-13** | `FILE_WRITE` bez rozpoznatelného cíle **a zároveň bez signálu uložení** se nevybere (`GUARD 2`). | **ano** |
| **C-14** | `DESIGN` bez potvrzeného deterministického vzoru je sražen na `CREATIVE` (`GUARD 5`). | **ano** |

## Zápis na disk

| # | Chování | Model |
|---|---|---|
| **C-15** | Zápis bez aktivního projektu nevznikne v kořeni instalace. | ne |

---

## `C-13` — nález a rozhodnutí operátora, 2026-08-02

**Původní znění:** „`FILE_WRITE` bez rozpoznatelného cíle se nevybere (`GUARD 2`)."
**Skutečnost:** vybere se. Test to odhalil při prvním běhu modelové sady.

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

### Co „ulož to" doopravdy je — změřeno, ne odhadnuto

Spustí se **výhradně z vlastní zprávy uživatele**, nikdy samo. Typická sekvence
je *dotaz → odpověď asistenta → „ulož to"*; ukládá se ta poslední odpověď.
Naměřeno na 11 formulacích:

| vstup | intent | cíl |
|---|---|---|
| `ulož to`, `zapiš to do souboru`, `save it`, `ulož mi to prosím`, `můžeš to uložit?` | `FILE_WRITE` | auto-jméno |
| `ulož to do plan.md`, `dej to do souboru poznamky.txt`, `vytvoř soubor todo.md` | `FILE_WRITE` | z textu |
| `shrň mi to`, `co dělá ta funkce`, `díky` | `CONVERSATIONAL` | — |

Pět z osmi ukládacích formulací tedy končí u auto-jména — běžná cesta, ne
okrajový případ. Dvě pojistky ale existují už dnes:

- **bez předchozí odpovědi se nezapíše nic** — přijde `⚠️ Není co uložit`;
- **po zápisu přijde jméno i celá cesta** (`handlers/file.js:634`), takže soubor
  nevzniká potají.

### Rozhodnutí — varianta „B + oprava místa"

Rozpor byl mezi seznamem a návrhem, ne v testu: kód dělá užitečnou věc, kterou
do něj někdo záměrně dal, a schválená věta ji zakazovala. Skutečné riziko není
nechtěný soubor, ale **hromadění `output-*.md` v kořeni instalace**.

| Co | Jak |
|---|---|
| **`C-13` upřesněno** | „…bez rozpoznatelného cíle **a zároveň bez signálu uložení** se nevybere." To je přesně to, co `GUARD 2` hlídá. „Ulož to" funguje dál. |
| **`C-15` přidáno jako regrese** | Bez aktivního projektu se nezapisuje do `process.cwd()`, ale do `data/output/` (přebitelné přes `C3_OUTPUT_DIR`). |

Oprava místa je v `handlers/file.js` — `defaultWriteRoot()` nahradilo
`process.cwd()`. Sandbox `validateFilePath()` se tím **utahuje**, ne uvolňuje:
bez projektu byl dosud povolený celý podstrom `cwd()`, nově jen `data/output/`.

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

## `C-12` — první verze testu procházela z nesprávného důvodu

Test původně poslal jen „Prokletý ostrov" s aktivní kreativní expertizou a čekal
`CREATIVE`. Prošel — ale `GUARD 6` se přitom vůbec nespustil: **model ten holý
název klasifikuje jako `CREATIVE` sám** (`initialIntent: CREATIVE`, žádný
override v `CRE_DIAG`). Test tedy o guardu nedokazoval nic.

Vyšlo to najevo přes `adversarial-cre` `X6b`, které na témž vstupu bez expertizy
čeká `SEARCH` nebo `AMBIGUOUS` a **padá** — to selhání je starší než tato práce
a potvrzené i na čistém stromě.

**Opraveno:** vstup je nově `kdo napsal Prokletý ostrov`, který je bez expertizy
`SEARCH` a s ní `CREATIVE`. Testují se obě poloviny, takže `CREATIVE` může
pocházet jedině od guardu.

---

## `C-04c` — test měřil prostředí, ne chování

Při doplňování `C-15` začalo `C-04c` padat na **19 671 ms** proti mezi 2 000 ms.
Nešlo o regresi retry politiky: „nedostupný model" si sada **nezajišťovala, jen
ho předpokládala** od prostředí. Na stroji, kde Ollama běží, tedy neměřila
odmítnuté spojení, ale skutečné volání modelu včetně jeho nahrání.

Sada je registrovaná jako `profile: offline`, `network: none`, takže ve svém
fixture je předpoklad splněný — spuštěná ručně na vývojovém stroji ale měřila
něco jiného, než co její věta tvrdí.

**Opraveno:** `C-04` si teď nedostupnost vyrobí sama — obsadí volný port, zavře
ho a na tu adresu přesměruje `config.ollama.baseUrl`. Po opravě **21 ms** a
výsledek nezávisí na tom, jestli Ollama zrovna běží.

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
