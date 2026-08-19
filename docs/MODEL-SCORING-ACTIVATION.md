# Aktivace model scoringu a pročištění modelů

**Stav:** scoring aktivní, druhý zdroj faktů zapojen, outbound discovery zapnuté
**Datum:** 2026-08-17
**Verze kódu:** v135 (`src/upgrade/`)
**Cíl:** zprovoznit scoring všech dostupných modelů tak, aby jeho výstup byl použitelný jako podklad pro smazání nepotřebných Ollama modelů (187 GB na disku).

> Kapitoly 1–2 popisují stav **před** zásahem a zůstávají jako záznam příčiny.
> Co se změnilo, je v kapitolách 6–10.

---

## 1. Výchozí stav

### 1.1 Platforma je postavená, ale nikdy neběžela

Všechny nosné tabulky scoringu jsou prázdné (`data/c3.db`):

| Tabulka | Řádků | Význam |
|---|---|---|
| `model_universe_raw` | **0** | surová fakta o modelech |
| `model_universe_derived` | **0** | odvozená skóre + confidence |
| `model_performance` | **0** | empirické metriky (v120) |
| `discovered_models` | **0** | L4 online discovery (v121.1) |
| `model_catalog_cache` | **0** | cache katalogu |
| `model_usage` | 13 | pasivní telemetrie — jediná data, která vznikla |
| `model_signal_events` | 13 | pasivní telemetrie |
| `upgrade_proposals` | 8 | staré návrhy |

Existuje `upgrade-manager.checkForUpgrades()` i `startPeriodicCheck()`, ale nic je periodicky nevolá s `fullCycle`, a `C3_ENABLE_ONLINE_DISCOVERY` je `false`.

### 1.2 Auditované vady jsou opravené

`docs/archive/AUDIT-v123.md` popisoval 5 vad v upgrade pipeline. Ověřeno ve v135 — **všechny opravené**:

| # | Vada | Stav |
|---|---|---|
| 11 | metrics-collector: `splice(0)` před `tx()` → ztráta metrik | opraveno (`[...this._buffer]`, splice až po tx) |
| 12 | proposal-store: check-then-insert bez transakce | opraveno v124 (atomická `transaction()`) |
| 14 | ranker: skoková funkce vah na hranici 10 vzorků | opraveno v124 (lineární interpolace, `empirical-scorer.js:92`) |
| 26 | online-discovery: křehké HTML parsování | opraveno v124.6 (`MAX_TAGS = 30`) |
| 27 | benchmark-estimator: `log(0)` | opraveno (guardy `<= 0`) |
| 29 | expirované návrhy se nečistí | opraveno (`expireStale(7)` v cyklu) |
| 30 | Ollama nedostupná → žádný backoff | opraveno v124.6 (30s cache) |

Blokátorem tedy **nejsou** známé vady, ale strukturální vada odhalená až měřením.

---

## 2. Strukturální vada: lokální modely nejsou obohaceny z katalogu

### 2.1 Měření

Suchý běh scoringu nad 13 nainstalovanými modely (GPU 24 GB, `includeCatalog: true`, 62 kandidátů):

```
=== CODE top10 ===
  1. 0.5952  deepseek-r1-0528:14b  [catalog]
  2. 0.5848  deepseek-r1:14b       [catalog]
  3. 0.5826  gemma3:27b            [catalog]
  ...        všech 10 z katalogu, žádný nainstalovaný
```

Nainstalované modely skórují **0.225–0.272**, katalogové **0.55–0.60**. Žádný lokální model se nedostane do top 10 pro žádnou roli.

### 2.2 Příčina

`buildCandidates()` v [`src/upgrade/model-discovery.js:128-162`](../src/upgrade/model-discovery.js#L128-L162) staví lokální kandidáty **výhradně z odpovědi Ollama API** a nikdy je nespojí s `CATALOG`. Výsledek pro všech 13 lokálních modelů:

```
glm-4.7-flash:latest   bench=ne release=- vram=- cat=unknown
qwen3-coder:30b        bench=ne release=- vram=- cat=general
qwen2.5-coder:32b      bench=ne release=- vram=- cat=code
...
```

Naproti tomu `_filterCatalog()` ([`model-discovery.js:272-290`](../src/upgrade/model-discovery.js#L272-L290)) katalogové položky **tvrdě filtruje** na ty, které `releaseDate` i `benchmarks` mají — takže katalogový kandidát má metadata vždy, lokální nikdy.

### 2.3 Dopad na váhy skóre

Rozpad skóre lokálního modelu (role CODE):

```
benchmark:   0        ← váha 0.35, mrtvá
hardwareFit: 0.5      ← váha 0.20, konstantní fallback (vram undefined)
maturity:    0.5      ← váha 0.15, konstantní fallback (releaseDate undefined)
generation:  0        ← váha 0.10, mrtvá
category:    0        ← váha 0.13, mrtvá pro 4 modely s family=unknown
speed:       0.918–1.2 ← váha 0.07, JEDINÁ proměnná složka
```

**88 % váhy skóre je u lokálních modelů nulové nebo konstantní.** Reálně se řadí podle `speed`, což je inverzní funkce velikosti → *menší model vždy vyhraje*. Proto dry run doporučil `llava-llama3:8b` (vision, 8B) jako nejlepší model pro role **CHAT** i **R2**.

### 2.4 Navazující vady

**(a) Nesoulad tagů config × Ollama.** `config.models` váže `deepseek-r1-32b` a `qwen3-30b-a3b`, Ollama hlásí `deepseek-r1-32b:latest` a `qwen3-30b-a3b:latest`. Scoring je vyhodnotí jako **NENAINSTALOVANÉ** pro role D1, D2, R1. Stejná exact-match logika je v `_filterCatalog` (`installedNames.has(entry.name)`), takže katalog nabízí i modely, které už fyzicky jsou na disku.

**(b) Katalog nepokrývá novější modely.** Z 55 položek katalogu sedí na 13 nainstalovaných modelů 6 jen podle základního jména, a přesný tag jen 2 (`llava-llama3:8b`, `qwen2.5:32b`). Zcela chybí: `glm-4.7-flash`, `qwq`, `phi4-reasoning`, `devstral-small-2`, `qwen3-coder`, `deepseek-r1-32b`, `qwen3-30b-a3b`. Fallback (`qwen3.5:27b` → benchmarky z `qwen3.5:4b`) navíc podhodnocuje velké varianty.

**(c) `family=unknown`** pro `glm-4.7-flash`, `qwq`, `devstral-small-2` → nulový `category` bonus (13 % váhy) a nefunkční `generation` bonus.

---

## 3. Plán aktivace

### Fáze 1 — Opravit obohacení lokálních kandidátů (blokující)

1. **Join lokálních kandidátů s katalogem** v `buildCandidates()`: pro každý lokální model dohledat katalogovou položku a převzít `benchmarks`, `releaseDate`, `baseVramMb`, `category`. Když přesný tag chybí, použít `benchmark-estimator.js` pro škálování z jiné velikosti téže rodiny (kód existuje, jen se pro lokální modely nevolá) a označit `benchmarkConfidence < 1`.
2. **Kanonizace tagů** — jedno místo, které srovná `X` ≡ `X:latest`. Použít napříč `config.models` porovnáním, `installedNames.has()` i `_filterCatalog`. Zdroj pravdy: `model-identity.js`.
3. **Doplnit rodiny** `glm`, `qwq`, `devstral` do `parseModelName()`.

*Ověření:* dry run musí u všech 13 lokálních modelů hlásit `bench=ANO`, a bound modely nesmí být hlášené jako nenainstalované.

### Fáze 2 — Naplnit katalog a universe

4. Doplnit do `model-catalog.js` chybějících 7 rodin.
5. Zapnout `C3_ENABLE_ONLINE_DISCOVERY=true` (L4) a WhatLLM enrichment (L5) — pokryjí modely, které v ručním katalogu nikdy nebudou.
6. Spustit `checkForUpgrades({ fullCycle: true })` → naplní `model_universe_raw` / `_derived`.

### Fáze 3 — Empirická kalibrace

7. Nechat běžet `metrics-collector` na reálné zátěži do ≥10 vzorků na roli (`MIN_SAMPLES`), aby se rozjela empirická složka (`empiricalWeight` 0 → 0.10 → 0.20).
8. Volitelně `validation-suites.js` pro lokální ověření kandidátů (bonus 0.05).

### Fáze 4 — Rozhodnutí o smazání

9. Teprve s naplněným `model_universe_derived` dává smysl řadit modely a mazat. Rozhodovací pravidlo: model smazat, pokud **není bound na žádnou roli** *a zároveň* **není v top-3 pro žádnou roli** *a zároveň* má **nulové `model_usage`**.

---

## 4. Aktuální stav vazeb (podklad pro pročištění)

`config.models` váže **4 ze 13** modelů:

| Role | Model | Velikost |
|---|---|---|
| D1, R1 | `deepseek-r1-32b` | 18 GB |
| D2 | `qwen3-30b-a3b` | 17 GB |
| CODE, R2, CHAT | `qwen3.5:27b` | 17 GB |
| VISION | `llava:13b` | 8 GB |
| | **bound celkem** | **60 GB** |

Nevázaných 9 modelů = **135 GB**: `glm-4.7-flash` (19), `qwq:32b` (19), `qwen2.5-coder:32b` (19), `qwen2.5:32b` (19), `qwen3-coder:30b` (18), `devstral-small-2:24b` (15), `phi4-reasoning:14b` (11), `qwen3:14b` (9.3), `llava-llama3:8b` (5.5).

> **Pozor:** řazení podle data poslední změny (`ollama list`) je zavádějící — `deepseek-r1-32b` a `qwen2.5:32b` jsou obojí „7 měsíců staré“, ale první je bound na dvě role a druhý na žádnou. Mazat podle stáří by rozbilo D1/R1.

---

## 5. Odhad

| Fáze | Rozsah | Poznámka |
|---|---|---|
| 1 | ~150 ř. ve 3 souborech + testy | blokující, bez ní scoring nedává smysl |
| 2 | data + konfigurace | katalog je ruční práce |
| 3 | běh na reálné zátěži | čas, ne kód |
| 4 | skript nad `model_universe_derived` | ~50 ř. |

Po Fázi 1 už bude dry run vypovídající a půjde smazat nejjasnější kandidáty i bez plné empirické kalibrace.

---

## 6. Co bylo provedeno

### 6.1 Obohacení lokálních kandidátů — `src/upgrade/catalog-enrichment.js` (nový)

Lokální kandidáti se nově párují s katalogem a přebírají benchmarky, VRAM,
zralost a kategorii. Párování má tři kroky: přesná shoda podle lookup klíče →
interpolace uvnitř rodiny (`benchmark-estimator.js`) → nahlášení do logu.

Lookup klíč (`catalogLookupKey`) sjednocuje zápis velikosti, protože Ollama
hlásí `deepseek-r1-32b`, zatímco katalog vede `deepseek-r1:32b`. Je to
**samostatný klíč pro dohledání metadat, ne identita vazby** —
`canonicalModelName()` z `model-identity.js` schválně shodu podle rodiny a
velikosti nedělá, protože autorizuje failover, a tato volnější logika ho nesmí
nahradit.

Katalog se načítá vždy, ne jen při `includeCatalog`, jinak by rychlý cyklus
skóroval naslepo.

**Výsledek:** z 13 nainstalovaných modelů je 11 spárovaných přesně, 2 odhadem,
0 bez podkladu (před zásahem 0 / 0 / 13).

### 6.2 Rodiny modelů — `src/upgrade/model-family-extensions.js` (nový)

Doplněny rodiny `qwq`, `devstral`, `glm`, `granite` a oprava `qwen3-coder`,
který se kvůli pořadí prefixů trefoval do `qwen3` a padal do kategorie
`general` místo `code`.

Tabulka rodin **záměrně nešla do `model-profiles.js`**: ten je připnutý
bajtovým hashem v `model-failover-proof-policy.js` jako revidovaná autorita nad
kontraktem rolí a validačních sad. Pin je fail-closed a platí na celý soubor,
takže i aditivní změna by ho shodila. Rozpoznání rodiny žádnou autoritou nad
rolemi není, takže patří mimo pin. Test v `tests/catalog-enrichment.test.js`
hlídá, že soubor zůstává bajtově nedotčený.

### 6.3 Způsobilost pro roli — `checkRoleEligibility()` v `model-ranker.js`

`MODEL_PROFILES[role].requirements` se dosud při skórování vůbec nevynucovaly.
`BENCHMARK_WEIGHTS.VISION` přitom obsahuje jen textové benchmarky (mmlu, arena,
reasoning), takže roli VISION vyhrával silný textový model, který obraz vůbec
nezpracuje — `qwen3:14b` byl první, `llava:13b` sedmý.

Nezpůsobilost je proto **vyřazení, ne penalizace**. Vynucuje se jen to, co lze
z dostupných dat poctivě rozhodnout: rozsah parametrů a schopnost `vision`.
Požadavky typu `json-output` zůstávají měkké, protože je katalog u drtivé
většiny položek neuvádí a tvrdý filtr by seznam kandidátů vyprázdnil — ty patří
validačním sadám.

### 6.4 Vyhlazení `computeHardwareFit()`

Funkce vracela tři konstantní pásma, takže na hranici poměru 0.80 skočilo skóre
o 0.30 (po váze o 0.06 celkového skóre) mezi modely lišícími se o promile VRAM.
Je to táž skoková vada, jakou audit v123 (#14) opravil u blend vah. Kotevní
body pásem zůstaly zachované kvůli kalibraci, mění se jen přechod mezi nimi na
lineární rampu.

### 6.5 Doplnění katalogu

Přidány položky pro `qwq:32b`, `devstral-small-2:24b` a `glm-4.7-flash`. Jejich
benchmarky **nejsou měřené v tomto repu** — jsou to odhady, a proto nesou nové
pole `benchmarkConfidence` (0.55 / 0.55 / 0.35), kterým ranker benchmarkovou
složku úměrně utlumí. U `glm-4.7-flash` je `releaseDate: null`, protože datum
vydání neznám a `modified_at` z Ollama je čas stažení, ne vydání.

Odhady se mají nahradit skutečným podkladem z validační sady nebo L5.

### 6.6 Report — `scripts/model-scoring-report.js` (nový)

Spojí discovery + obohacení, validační sady a `model_usage` do jednoho žebříčku
podle rolí a doporučení k pročištění.

```
node scripts/model-scoring-report.js              # rychlý žebříček
node scripts/model-scoring-report.js --validate   # + reálné volání modelů
node scripts/model-scoring-report.js --json       # strojový výstup
```

Bez `--validate` se použijí dřív uložené výsledky z DB, jsou-li v TTL
(14 dní). Skript otevírá DB přímo přes `better-sqlite3` jako
`bin/quality-report.js` — runtime modul `src/db/database.js` se nepoužívá,
protože jeho fail-closed chování na `C3_DB_PATH` je záměrné a CLI ho nemá
obcházet.

Pravidlo pro smazání: model je kandidát, jen když **není navázaný na roli**
*a zároveň* **není v top-3 žádné role, pro kterou je způsobilý** *a zároveň*
**má nulové `model_usage`**. Kterákoli jedna splněná podmínka ho zachrání.

### 6.7 Dopad na skóre

| | před | po |
|---|---|---|
| rozsah skóre lokálních modelů | 0.225–0.272 | 0.36–0.66 |
| benchmarková složka | 0 u všech | reálná u 13/13 |
| pořadí CODE (vázaný `qwen3.5:27b`) | 9/13 | 1/13 |
| VISION | vyhrál textový model | jen 2 způsobilí llava |

### 6.8 Testy

`tests/catalog-enrichment.test.js` (nový, 41 testů) pokrývá lookup klíč,
obohacení, způsobilost, rodiny a pin. `tests/model-upgrade-phase2.test.js`
rozšířen o kotvy a monotonii `computeHardwareFit`.

Regrese přes 13 dotčených sad: **691 testů, 0 selhání.**

---

## 7. L5 — externí benchmarky (whatllm.org)

Cesta L5 existovala, ale byla vypnutá, což zakrývalo tři vady párování. Po
zapnutí by vpravila **cizí čísla s jistotou 0.85**. Změřeno na 13 nainstalovaných
modelech: spárovaly se 4 a všechny čtyři špatně.

### 7.1 Vady párování

| Vada | Projev |
|---|---|
| Verze se parsovala, ale v `matchModels()` neporovnávala | `qwen2.5:32b` → `Qwen3 32B`, `qwen3.5:27b` → `Qwen3.6 27B` |
| Specializace se ignorovala | `qwen3-coder:30b` → `Qwen3 Omni 30B A3B` |
| `parseOllamaName()` hledala velikost jen v tagu | `deepseek-r1-32b:latest` → params `null`, model nespárovatelný |
| `parseWhatllmName()` neuměla verzi za spojovníkem | `Phi-4`, `GLM-5.1` → verze `null` |
| Shoda podle samotné rodiny stačila | `deepseek-r1-32b` → `DeepSeek V4 Pro` (q=53.2, frontier cloud model) |

Opraveno: verze i tvrdá specializace (`coder`, `omni`, `vl`, `vision`, `embed`,
`guard`, `math`) se musí shodovat; velikost se hledá i v základu jména; verze se
čte i přes spojovník. Nově se navíc vyžaduje **rozlišovací znak nad rámec
rodiny** — porovnatelná velikost, porovnatelná generace, nebo shodná neprázdná
množina měkkých variant. Nejednoznačná shoda se raději zahodí, než aby se tiše
vybrala jedna z možností.

**Výsledek:** 4 shody z 13, všechny obhajitelné (`Devstral Small 2`,
`Qwen3 30B A3B 2507 Instruct`, `Qwen3 Coder Next`, `Phi-4`). Zbylých 9 modelů
whatllm nezná — `qwq`, `glm-4.7-flash`, `llava`, generace `qwen2.5` a
`deepseek-r1` distil.

### 7.2 Nesouměřitelné stupnice

Vážnější než párování. Obě čísla se tváří jako „kvalita modelu“, ale měří ji v
jiném režimu obtížnosti: whatllm skládá index z frontier sad (GPQA Diamond,
AIME, SWE-Bench Verified), kde lokální 14B model dostane ~5 ze 100; katalog nese
klasické sady (HumanEval, MMLU), kde tentýž model dá 0.6+.

Na modelech přítomných v obou zdrojích spolu ty hodnoty **prakticky
nekorelují**:

| model | whatllm / max | katalog průměr |
|---|---|---|
| `phi4:14b` | 0.073 | 0.618 |
| `qwen3.5:4b` | 0.255 | 0.482 |
| `devstral-small-2:24b` | 0.281 | 0.568 |
| `qwen3.5:35b` | 0.385 | 0.632 |

Původní `qualityIndex / maxQuality` proto posunulo každý whatllm model zhruba o
polovinu dolů proti katalogovým — scoring systematicky trestal právě ty modely,
které whatllm náhodou zná. Je to táž třída vady jako původní chybějící
obohacení: systematické zkreslení z nekonzistentních metadat.

Lineární kalibrace by při nulové korelaci fitovala šum, takže se zachovává jen
**pořadí**: percentil modelu v rozdělení whatllm se přeloží na tentýž percentil
rozdělení katalogu (`buildScaleCalibration()`). Výsledek je s katalogem
souměřitelný z konstrukce, aniž by se předstíral vztah mezi absolutními
hodnotami. Bez obou rozdělení se nekalibruje a enrichment se přeskočí.

`devstral-small-2:24b` tak místo 0.258 dostane 0.424.

### 7.3 L5 zůstává vypnuté

`config.features.onlineDiscovery` jsem **nepřepínal**. Produkt je local-first a
`tests/outbound-network-optin.test.js` explicitně kontroluje, že čisté prostředí
nechává automatické objevování vypnuté. Zapnutí je operátorské rozhodnutí:

```bash
C3_ENABLE_ONLINE_DISCOVERY=true
```

Po zapnutí nahradí L5 odhadnuté katalogové benchmarky (`benchmarkConfidence`
0.35–0.55) reálnými daty s jistotou 0.85 u těch modelů, které whatllm zná.

---

## 8. Výsledek validace

Doběhlo všech 65 běhů (13 modelů × 5 sad), bez chyb. Výsledky jsou v
`validation_suite_scores` a report je bere z DB, dokud nejsou starší 14 dní.

**Sady ale saturují.** Hodnota 100 % padla 26× z 65. `devstral-small-2:24b` má
100 % ve čtyřech sadách z pěti, `llava:13b` — vision model — dostal 100 % v sadě
`code` a 91 % v `reasoning`. Naopak `deepseek-r1-32b`, reasoning specialista, má
v `reasoning` jen 63 %.

To znamená, že u špičky pole **validace nerozlišuje** a její váha (0.05) je tam
spíš šum. Pořadí mezi prvními čtyřmi modely dnes rozhoduje benchmarkový podklad,
ne změřené chování. Zpřísnění grader ů je předpoklad pro to, aby se dalo
rozhodovat podle měření.

### Doporučení k pročištění

Ponechat 8 modelů (108 GB), smazat 5 (78 GB):

```
ollama rm qwq:32b glm-4.7-flash:latest qwen3-coder:30b devstral-small-2:24b phi4-reasoning:14b
```

Výhrada: `devstral-small-2` a `qwen3-coder` mají po zapnutí L5 reálná data z
whatllm (q=17.7 a 21.3) a `qwen3-coder` je jediný nainstalovaný coder model
generace 3. Před smazáním těch dvou dává smysl L5 zapnout a report spustit znovu.

---

## 9. Druhý zdroj: HuggingFace

Do 2026-08-19 stála veškerá kvalitativní data na **jediném** externím zdroji.
`ollama.com/library` odpovídá jen na „existuje a jaké má tagy" — kvalitu nenese,
takže fallback neexistoval a výpadek whatllm.org tiše shodí celé obohacení.

`src/upgrade/huggingface-client.js` přidává nezávislá **fakta**, ne druhý odhad
kvality:

| Signál | K čemu | Proč je to fakt |
|---|---|---|
| `createdAt` | `maturity` (15 % váhy), `generation` bonus | ověřitelné datum publikace |
| `pipeline_tag` | způsobilost pro VISION | metadata modelu, ne hádání z názvu |
| `downloads`, `likes` | korroborace | — |

**Adopce se záměrně nepřevádí na skóre.** Popularita není kvalita: starší model
má víc stažení jen proto, že je déle venku, a kvantizované forky mají vlastní
čísla. Kdyby se z ní dělal benchmark, vznikla by táž třída vady jako u míchání
whatllm a katalogu.

Výběr repozitáře (`pickCanonicalRepo`) upřednostní originál před odvozeninou —
`unsloth/Qwen3.5-27B-GGUF` má víc stažení než `Qwen/Qwen3.5-27B`, ale jeho
`createdAt` je datum kvantizace, ne vydání modelu.

### Co druhý zdroj hned našel

Dohledal 8 z 8 nainstalovaných modelů a odhalil dva rozpory v primárních datech:

| model | pole | katalog | HuggingFace |
|---|---|---|---|
| `qwen3.5:27b` | `releaseDate` | 2025-07-15 | **2026-02-24** |
| `qwen3.5:27b` | kategorie | `general` | **`image-text-to-text`** |

Model je tedy multimodální — filtr způsobilosti ho z role VISION vyřazoval
neprávem. Po opravě je v ní první (0.6204). Datum se liší o 7 měsíců, což
přímo posouvá 25 % váhy skóre.

Rozpory se **nepřepisují automaticky**: katalog je revidovaný, takže se datum
jen doplní, když chybí, a při neshodě nad 90 dní se nahlásí. Report je vypisuje
pod hlavičkou.

---

## 10. Outbound discovery je nově zapnuté

Operátorské rozhodnutí 2026-08-19 (zaznamenáno v `DIRECTION.md`, obrací
rozhodnutí z 2026-08-02): `C3_ENABLE_ONLINE_DISCOVERY` má výchozí **on**, vypíná
se explicitně hodnotou `false`.

Důvod: bez discovery katalog tiše stárne a scoring doporučuje modely, které byly
před měsíci nahrazeny.

Local-first tím zůstává v platnosti — omezení zní „nic mimo stroj není
*povinné*", ne „nic mimo stroj se nesmí použít". Každá cesta degraduje sama
(registry po 3 selháních offline, sonda na Ollamu couvá 30 s, WhatLLM i HF mají
error cooldown), takže offline běh stále seřadí z lokálního katalogu.
`tests/outbound-network-optin.test.js` nově hlídá, že bránu lze vypnout a že ji
vypne jedině přesná hodnota `false`.

---

## 11. Co zbývá

1. **Zpřísnit validační sady** — dokud dávají 100 % polovině pole, nerozhodují.
   Nejde o drobnost, ale o předpoklad rozhodování podle měření. Nově je vidět i
   opačný extrém: `qwen3.5:27b` má v sadě `vision` jen 33 %, přestože je podle
   metadat multimodální — buď sada, nebo formát promptu neodpovídá modelu.
2. **Opravit `releaseDate` u `qwen3.5:27b`** v katalogu podle HF (2026-02-24) a
   projít, jestli podobný posun nemají i další položky.
3. **Doplnit katalog** o `qwq` a `glm-4.7-flash` — whatllm je nezná a zůstávaly
   na odhadu. (Oba modely byly mezitím smazané.)
4. **Naplnit `model_universe`** spuštěním `checkForUpgrades({ fullCycle: true })`
   — tabulky jsou stále prázdné, report je obchází a počítá přímo z discovery.
5. **Zvážit třetí zdroj kvality.** HF je zdroj faktů, ne kvality, takže
   whatllm.org zůstává jediným zdrojem benchmarků. Redundance kvality zatím není.
