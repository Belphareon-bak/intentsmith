# Sada `code_patch` — evaluace CODE spuštěným testem

**Postaveno:** den 1 přestavby evaluace (2026-08-20) ·
Kontext: [`EVAL-REDESIGN.md`](EVAL-REDESIGN.md) · [`MODEL-PLATFORM-HANDOFF.md`](MODEL-PLATFORM-HANDOFF.md)

---

## 1. Co sada dělá

Vezme skutečnou vadu z historie tohohle repa, dá modelu vadnou funkci a popis
požadovaného chování, jeho odpověď vloží zpátky do souboru a **spustí skrytý
test**. Skóre úlohy je 1 nebo 0 podle toho, jestli test prošel.

```
zdroják PŘED opravou + popis vady  →  model vrátí opravenou funkci
funkce se vloží zpátky do souboru  →  spustí se skrytý test v izolaci
                                       test projde = 1, neprojde = 0
```

Proti staré sadě `code`, kde o skóre rozhodovalo pár klíčových slov: `llava:13b`
— vision model — v ní dostal 100 %, a nefunkční `isPrime` dostal 1.0 za to, že
obsahoval `return` a cyklus. Tady o skóre rozhoduje `node tests/….test.js`.

## 2. Rozhodnutí z kontrolního bodu

Hlavním rizikem dne bylo, jestli se odpověď modelu dá spolehlivě aplikovat.
Sonda na třech úlohách (`qwen3-coder`, 2026-08-20) dopadla jednoznačně:

| co se sledovalo | výsledek |
|---|---|
| tvar odpovědi | **3× ze 3** přesně jeden blok ` ```javascript ` |
| obsah bloku | celá funkce od hlavičky po uzavírací závorku |
| unified diff | ani jednou |
| vysvětlující text okolo | ani jednou |

**Parser unified diffů se proto nepíše.** Odpověď stačí vzít jako celou funkci
a nahradit ji v souboru.

Jednotkou zadání je funkce, ne soubor — a to nezávisle na tom, jak model
odpovídá. Zdrojáky úloh mají 249 až 3531 řádků; celý soubor o 3531 řádcích by
byl řádově dvacet tisíc tokenů na výstupu, tedy mimo `num_ctx` i mimo rozumný
čas generování.

## 3. Jak se úlohy kurátorují

`node src/eval/build-code-suite.js --max-function-lines 250 --max-diff-lines 100`

Čtyři síta, každé něco vyřadí:

1. commit mění **jeden** zdroják a **jeden** test — jinak není jasné, co opravit
2. změna leží uvnitř **jediné funkce** — jinak se nedá zadat „přepiš tuhle funkci"
3. funkce se vejde do limitu řádků — delší se generují minuty
4. **test padá před opravou a prochází s gold patchem**, ve stejné izolaci, v
   jaké pak poběží odpověď modelu

Čtvrté síto je to podstatné: co jím projde, je zaručeně řešitelné a měřitelné.
Při stavbě 2026-08-20 vyřadilo commit `2c5f1756`, jehož gold patch neprojde
vlastním testem — takový commit by jako úloha měřil nesmysl.

**Výtěžnost z 805 commitů:**

| síto | zbývá |
|---|---|
| kandidátů (1 zdroják + 1 test, diff ≤ 100 ř.) | 29 |
| změna uvnitř jediné funkce | 10 |
| funkce ≤ 250 řádků | 7 |
| gold patch projde vlastním testem | **6** |

Největší ztráta je síto 2 — 19 z 29 commitů mění víc míst v souboru najednou
(typicky import nahoře a tělo metody dole). Podpora více funkcí v jednom zadání
je proto nejúčinnější způsob, jak sadu zvětšit.

Fixture [`src/eval/code-suite-tasks.json`](../src/eval/code-suite-tasks.json)
drží jen metadata — hash, cestu ke zdrojáku, cestu k testu, předmět commitu.
Zdrojový kód se nekopíruje; `deriveTask()` si ho vytáhne přes `git show`.

## 4. Anti-cheat

| pravidlo | jak je splněné |
|---|---|
| hodnoticí logika neobsahuje termíny z promptu | hodnotí se spuštěním testu, ne porovnáváním textu |
| skryté testy | model vidí vadnou funkci a **název** požadovaného chování, ne tělo testu, fixtury ani aserce |
| bez úniku řešení | gold patch se do promptu nedostane; ověřeno testem `zadání neukazuje test ani gold patch` |

### Proč je v zadání i požadované chování

První sonda skončila **0/3** — a ne kvůli neschopnosti modelu. U `da03e8bd` zní
předmět commitu „preserve verification abort boundary", kdežto skrytý test
vyžaduje, aby se `clearTimeout` zavolalo *před* parsováním těla odpovědi. To se
z předmětu uhodnout nedá; úloha by měřila čtení myšlenek, ne programování.

Zadání proto obsahuje i názvy testů, které commit přidal — tedy popis toho, **co
má platit**, přesně jak ho formuloval autor opravy. Hranice zůstává: model se
dozví požadavek, ne způsob ověření.

## 5. Izolace

Spouští se kód, který napsal model:

- odhozený `git worktree`, nikdy pracovní strom
- podproces s timeoutem
- **síťový namespace** `unshare -rn` s nahozeným `lo` — loopback funguje
  (některé testy ho potřebují), ven se model nedostane (ověřeno: `EAI_AGAIN`)

## 6. Pasti, které to stálo

**`git worktree add` nevytvoří `node_modules`.** Každý test pak spadne na
`ERR_MODULE_NOT_FOUND` a vypadá to jako nespolehlivé orákulum. Řeší symlink.

**`git checkout <ref> -- <cesta>` mění index hlavního repa**, i při zápisu do
jiného `--work-tree`. Používá se `git show <ref>:<cesta>` a ruční zápis; hlídá
to test `index zdrojového repa zůstane nedotčený`.

**Ztráta čárky za uzavírací závorkou.** U vlastnosti objektu končí řádek `},`.
Když se při náhradě zahodí zbytek řádku za závorkou, soubor přestane být
syntakticky platný — shodilo to úlohu `a33cc20a`. Rozsah funkce si proto veze
`tail` a náhrada ho připojí zpátky.

**Commit, který soubor zakládá, není oprava** — nemá stav „před".

## 7. Soubory

| soubor | co dělá |
|---|---|
| `src/eval/code-task-extractor.js` | najde a ověří kandidáty v historii |
| `src/eval/function-span.js` | najde rozsah funkce kolem změněných řádků |
| `src/eval/code-patch-runner.js` | prompt → aplikace → spuštění testu → skóre |
| `src/eval/code-patch-suite.js` | sada ve tvaru pro `ValidationRunner` |
| `src/eval/build-code-suite.js` | kurátorská stavba fixture |
| `src/eval/discrimination-report.js` | doklad, že sada rozlišuje |

Testy: `tests/function-span.test.js` (8), `tests/code-patch-runner.test.js` (14),
`tests/code-task-extractor.test.js` (12).

---

## 8. Doklad rozlišení (2026-08-20)

> **⚠️ Čísla v tomhle oddíle jsou z binárního hodnocení „prošel celý soubor".**
> Po přechodu na odstupňované skóre (oddíl 9) se musí přeměřit. Platí z nich
> závěr, že sada rozlišuje, ale ne konkrétní hodnoty.


`node src/eval/discrimination-report.js qwen2.5-coder:32b qwen3-coder:latest qwen3:14b`
— 3 modely × 3 opakování × 6 úloh, 27,8 min, přes `comparePair()` z
`pairwise-trial.js`. Surový výstup:
[`execution/runs/code-patch-discrimination-20260820.md`](execution/runs/code-patch-discrimination-20260820.md).

| model | pass_rate |
|---|---|
| `qwen2.5-coder:32b` | **0,167** (1/6) |
| `qwen3-coder:latest` | 0,000 |
| `qwen3:14b` | 0,000 |

| veličina | hodnota |
|---|---|
| rozptyl nejlepší − nejhorší | **0,167** |
| naměřený šum metriky | **0,000** |
| práh (`TASK_MARGIN_EPSILON`) | 0,050 |

**Akceptační kritérium dne 1 je splněné:** rozptyl 0,167 je větší než šum
metriky. Sada rozlišuje tam, kde stará sada `code` dávala všem 100 %.

### Co je na tom silné

**Šum je nulový.** Žádná úloha nezměnila skóre mezi opakováními — 54 běhů,
54 shodných výsledků. Proti tomu stará sada `reasoning`: úlohy
`json_compliance` a `czech_json` přeskakovaly 0↔1 mezi běhy a skóre sady
kolísalo 63 % → 63 % → 75 %. Rozdíl 0,167 tedy není náhodný přeskok; při třech
opakováních vyšel pokaždé stejně.

### Co je na tom slabé — a je potřeba to vědět

**Rozlišuje jediná úloha z šesti.** `patch_da03e8bd` odděluje
`qwen2.5-coder:32b` od zbytku; ostatních pět dává všem modelům 0. V měřítku
`pairwise-trial` je to jistota „nízká (jediná úloha)".

**Dva ze tří modelů sada neodliší.** `qwen3-coder` proti `qwen3:14b` skončilo
0/6 rozlišujících úloh, tedy **nerozhodně**.

**Stará sada měla strop, tahle má podlahu.** Dřív dostal 100 % kdokoli včetně
vision modelu; teď je pět úloh ze šesti nad síly všech tří modelů. Diagnostika
ukazuje, že ve **všech** případech byla odpověď syntakticky platná funkce —
modely tedy nepadají na tvaru odpovědi, ale na chování. Podíl kolem 17 % u
opravdových oprav z repozitáře odpovídá tomu, co lokální modely této velikosti
na úlohách typu SWE-bench dokážou; podlaha není vada měření, ale změřená
vlastnost pole kandidátů.

### Čím sadu zesílit (v tomhle pořadí)

1. **Podpora změn ve víc funkcích.** 19 z 29 kandidátů padá právě na tomhle
   sítu — je to zdaleka největší zdroj úloh.
2. **Rozprostřít obtížnost.** Sada potřebuje i mechaničtější opravy, aby
   rozlišovala i mezi slabšími modely, ne jen na jedné těžké úloze.
3. **Až potom prahy a vazba role.** Dokud rozlišuje jedna úloha, nemá se na
   sadu vázat automatické rozhodování.

### Co z toho platí pro provoz

Rozhodnutí `REMOVAL_ENABLED_BY_DEFAULT = false` zůstává v platnosti. Sada sice
rozlišuje, ale jen na jedné úloze ze šesti a mezi dvěma ze tří modelů
nerozhodne vůbec — verdikt „neuspěl" tedy pořád často znamená „nešlo změřit".
Vazba role CODE se nepřepíná; `code_patch` běží vedle `code` jako podklad
k ručnímu potvrzení.


---

## 9. Odstupňované skóre a víc funkcí (2026-08-20, druhá iterace)

Důvod: z šesti úloh rozlišovala **jediná**. Pět ostatních dávalo všem modelům
nulu, takže nenesly žádnou informaci. Dvě změny to mají napravit.

### 9.1 Skóre je podíl splněných požadavků, ne „prošel soubor"

Testový soubor úlohy má desítky testů, ale opravy se týkají jen těch, které
commit přidal — u `da03e8bd` je to **1 test z 34**. Binární hodnocení celého
souboru pak dávalo nulu i modelu, který z požadovaného chování zvládl část, a
stíralo rozdíly mezi modely.

```
skóre = splněné cílové testy / všechny cílové testy
      = 0, pokud oprava rozbije cokoli mimo ně
```

Regrese ruší zisk celý: oprava, která rozbije jiné chování, není oprava.
Požadavek, jehož test vůbec nedoběhl, se počítá jako nesplněný, ne jako regrese.

**Ověřeno na všech šesti úlohách:** gold patch dává 1,00, stav před opravou
0,00 — s jednou výjimkou.

### 9.2 Úlohy nemají stejnou podlahu

`d8a2aa05` má před opravou **0,33**: jeden ze tří přidaných testů projde i na
vadném kódu. Model, který neudělá nic, tam tedy nedostane nulu.

Důsledek: skóre úloh nejsou mezi sebou přímo srovnatelná a je potřeba u každé
úlohy znát její podlahu. Zapsat `baselineScore` do fixture je první věc, která
se má udělat dál.

### 9.3 Zadání unese víc funkcí

`findSpansForLines()` + `replaceSpans()` — změna smí zasáhnout několik funkcí,
zadání je očísluje a chce zpátky tolik bloků, kolik jich poslalo. Náhrady jdou
**od konce souboru**, aby zůstala platná čísla řádků. Když model pošle bloků
víc, přiřadí se podle jména funkce; když míň, úloha propadá — hádat, co model
myslel, by měření zkreslilo.

**Výtěžnost to ale skoro nezvedla:** z 29 kandidátů je odvoditelných 11 (dřív
10), z toho 8 do 250 řádků (dřív 7). Úzké hrdlo se přesunulo jinam — 18 z 29
commitů mění řádky, které **neleží v žádné funkci** (importy, konstanty na
nejvyšší úrovni). Další růst zásoby proto vyžaduje buď povolit víc zdrojáků na
commit, nebo umět zadat i změnu mimo funkce.

### 9.4 Co zbývá k cíli „6 ze 6"

1. Zapsat podlahu (`baselineScore`) každé úlohy do fixture.
2. Přeměřit panel s odstupňovaným skóre — teprve to ukáže, kolik úloh reálně
   rozlišuje.
3. Kalibrovat výběr: v sadě nechat jen úlohy, kde se skóre napříč panelem liší.
   Úlohy, které dnes nikdo nevyřeší, **nemazat** — jsou to rezervy pro silnější
   modely, jen se odloží mimo aktivní sadu.
4. Panel rozšířit nad tři modely; čím širší, tím míň hrozí přeučení výběru úloh
   na dnešní trojici.
