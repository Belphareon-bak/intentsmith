# Hledání lepších modelů — návrh, implementace, měření

**Stav:** postaveno a ověřeno ostrým během
**Datum:** 2026-08-19
**Vstupní bod:** `scripts/model-upgrade-hunt.js`

---

## 1. Proč to vzniklo

Scoring uměl seřadit modely, které už jsou na disku, ale **nové neuměl najít**.
Full-cycle discovery spuštěné 2026-08-19 to ukázalo přesně:

| co | zjištění |
|---|---|
| katalog | nejnovější položka `2025-07-15`, tedy 13 měsíců stará |
| L4 discovery | ptalo se jen na rodiny, které už jsou nainstalované — **7 z 235** |
| co našlo | 6 „novinek": `qwen3.5:27b-mlx`, `qwen3.5:9b-mlx`, `qwen2.5-coder:3b`, `deepseek-r1:8b` — samé kvantizace a menší varianty toho, co už na disku je |
| návrhy | 31, všechny s `candidateScore 0.000`, navrhující downgrady (`deepseek-r1-32b → phi4:14b`) |

Nová rodina se tedy nemohla objevit z principu. `glm-5.2`, `deepseek-v4-pro`,
`kimi-k3`, `llama4`, `gemma4` ani `gpt-oss` L4 nikdy nevidělo.

---

## 2. Tvar řešení

Trychtýř, ve kterém je stahování **poslední a nejužší** krok. Hledání je levné
a paralelní; sériové je jen ověřování.

```
0  vyjmenovat všech 235 rodin z ollama.com              1 request, 0 GB
1  PRO KAŽDOU ROLI zvlášť: vlastní laťka, způsobilost,
   kategorie → vlastní seznam kandidátů                 minuty, 0 GB
┌─ 2a stáhnout jednoho kandidáta      (bez časového kritéria)
│  2b změřit umístění ve VRAM  ──přetéká──→ smazat ────┐
│  2c schopnostní minimum ~2 min ──propadl──→ smazat ──┤
│  3  souboj se stávajícím na stejných úlohách         │
│  4  lepší? → nový stávající (starý zůstává na disku) │
│     horší? → smazat                                  │
└──────────────── další kandidát ←─────────────────────┘
```

Na disku leží vždy nejvýš **jeden kandidát navíc**. Nahrazený model se
**nemaže** — teprve provoz ukáže, jestli byla výměna dobrý nápad.

---

## 3. Rozhodnutí, která to formovala

### 3.1 Odhad velikosti nesmí být brána — měření ano

Katalogový odhad podstřeluje skutečnost o třetinu:

| model | odhad | skutečnost (32k kontext) | rozdíl |
|---|---|---|---|
| `qwen3.5:27b` | 18 500 MB | 23 859 MB | +29 % |
| `qwen2.5:32b` | 22 000 MB | 29 983 MB | +36 % |

Ollama ale v `/api/ps` hlásí `size` a `size_vram`. Když se liší, zbytek leží na
CPU. Je to **měřený binární fakt**, nezávislý na výrobci GPU — proto na detekci
hardwaru nestojí nic kritického a na neznámé kartě se jen stáhne o pár
kandidátů víc.

Předfiltr před stažením proto používá **nejnižší pozorovanou režii** (1.06) a je
záměrně shovívavý. Pustit dál model, který se nevejde, je levné — odmítne ho
měření. Opačná chyba by byla drahá.

### 3.2 Přetečení je diskvalifikace, ne penalizace

Změřeno na RTX 3090:

| model | umístění | propustnost |
|---|---|---|
| `llava-llama3:8b` | 5.85 / 5.85 GB | **135.9 tok/s** |
| `qwen3:14b` | 13.92 / 13.92 GB | **73.5 tok/s** |
| `qwen3-30b-a3b` | 19.47 / 19.47 GB | **142.4 tok/s** |
| `qwen3.5:27b` | 20.61 / 23.30 GB | přetéká 2.69 GB |
| `deepseek-r1-32b` | 21.09 / 28.29 GB | přetéká 7.20 GB |
| `qwen2.5:32b` | 21.07 / 29.28 GB | 6.0 tok/s (8.2 GB na CPU) |

Není to plynulé zpomalení, ale propad na hranici použitelnosti — 6 tok/s proti
74. Swap režim se proto **nezavádí ani za potvrzení**; jen se do logu zapíše,
že by kandidát byl ve hře, kdyby se vešel.

### 3.3 Měří se při kontextu, na kterém se reálně jede

`qwen2.5:32b` zabírá 19.41 GB při 4k a 29.28 GB při 32k. Měřit při menším
kontextu by bránu obešlo, takže se měří při `config.compact.contextWindow`
(32 768).

### 3.4 Měří se z prázdné paměti

`qwen3.5:27b` vedle jiného rezidentního modelu vyšel jako přetékající
(17.7 tok/s); po vyprázdnění paměti se vešel celý a dal 33.6 tok/s. **Stejný
model, dvojnásobný rozdíl** — bez `drainResident()` se neměří model, ale
kontence.

### 3.5 `hardwareFit` zmizel ze skóre kvality

Dřív byl 20 % skóre a spolu se `speed` (7 %) dával **27 % váhy věcem, které
s kvalitou nesouvisí** — odtud systematická výhoda malých modelů, kvůli které
původně vyhrával `llava-llama3:8b` roli CHAT. Dnes je vejde-se tvrdá brána
(`checkVramGate`) a těch 20 % připadlo benchmarkům a kategorii.

### 3.6 Váha rychlosti závisí na roli

U CHAT je odezva součástí kvality, u D1 běží deliberace na pozadí. Fixních 7 %
neseděly nikde:

| role | váha rychlosti |
|---|---|
| CHAT | 0.15 |
| R2 | 0.12 |
| CODE, VISION | 0.08 |
| D2 | 0.06 |
| D1, R1 | 0.03 |

Rychlost se navíc bere **z měření**, ne z odhadu podle počtu parametrů. MoE
model `qwen3-30b-a3b` má 30B parametrů, aktivuje ~3B a dává 142 tok/s — odhad
podle velikosti by pořadí obrátil.

### 3.7 Krátká sada je schopnostní minimum, ne zkrácené hodnocení

Nelze poctivě zaručit, že dvouminutová sada nevyřadí lepší model. Proto smí
odmítnout jen to, co je pro roli objektivně nepoužitelné, a každá položka je
binární:

- model se načte a odpoví neprázdně
- na vyžádaný JSON vrátí platný JSON
- na český vstup odpoví česky (kontroluje se diakritika)

Cokoli, co je otázkou kvality, jde **vždy** do plného souboje.

### 3.8 Souboj řeší saturaci sad

Validační sady saturují: v běhu 13 modelů × 5 sad padla **100 % hodnota 26× z
65**; `llava:13b` — vision model — dostal 100 % v sadě `code`. Absolutní skóre
tedy u špičky nerozlišuje.

Řešení není zpřísňovat prahy, ale změnit otázku. Místo „kolik procent dal
kandidát" se ptáme „na kterých konkrétních úlohách je lepší než ten, koho má
nahradit":

- úloha, kde oba dopadnou stejně, do rozhodnutí **nevstupuje**
- rozhoduje se z rozlišujících úloh podle **marže**, ne pass/fail
- když nerozliší ani jedna úloha, kvalita se prohlásí za nerozhodnou a rozhodne
  naměřená propustnost — ale jen při rozdílu ≥ 1.25×, jinak stávající zůstává

Setrvačnost je záměrná: výměna má cenu jen tehdy, když je pro ni důvod.

### 3.9 Jeden běh sady nestačí — úlohy přeskakují

První ostrý běh vydal protichůdné rozhodnutí: role **D1 a R1 používají tutéž
sadu `reasoning` a tutéž dvojici modelů**, přesto vyšly opačně.

```
D1: qwen3-coder vs deepseek-r1-32b → kandidát vyhrál 3:0, marže 1.000
R1: qwen3-coder vs deepseek-r1-32b → kandidát ztrácí 1.000 na 5 úlohách
```

Marže přesně ±1.000 znamená, že jeden model dal 1.0 a druhý 0.0 — to není
rozdíl v kvalitě, ale selhání. Ověřeno třemi běhy téže sady na témž modelu
(`deepseek-r1-32b`, `reasoning`):

| úloha | běh 1 | běh 2 | běh 3 |
|---|---|---|---|
| `json_compliance` | 0 | **1** | 1 |
| `czech_json` | 1 | **0** | 1 |
| skóre sady | 63 % | 63 % | 75 % |

Dvě z osmi úloh přeskakují mezi 0 a 1, protože se hodnotí binárně a model
vzorkuje (`temperature 0.1`). Při jediném běhu pak práh 0.05 bere náhodný
přeskok za silný signál.

Oprava má dvě části:

1. **Každá sada běží `DEFAULT_REPEATS` (3) krát na každém modelu** a úloha se
   shrne na průměr.
2. **Úloha rozlišuje, jen když je rozdíl větší než její vlastní nestabilita.**
   Prahem není konstanta, ale `max(TASK_MARGIN_EPSILON, spread)`, kde `spread`
   je rozdíl nejlepšího a nejhoršího běhu téže úlohy na témž modelu. Úloha,
   která sama přeskakuje o 1.0, tak nemůže nic rozhodnout.

Nestabilní úlohy se navíc vypisují (`unstableTasks`), aby bylo vidět, které
části sady nenesou spolehlivý signál.

### 3.10 Sady se mezi rolemi nespouštějí opakovaně

Role sdílejí validační sady: `reasoning` obsluhuje D1, D2 i R1. Bez cache by se
pro jednu dvojici modelů spustila třikrát a zkouška jednoho kandidáta by trvala
skoro dvojnásobek. `createSuiteCache()` drží výsledek podle dvojice sada+model —
skóre modelu na dané sadě se v rámci běhu nemění, takže je bezpečné ho podržet,
a klíč obsahuje model, aby si role nemíchaly různé stávající modely.

| sada | role, které ji sdílejí |
|---|---|
| `reasoning` | D1, D2, R1 |
| `code` | CODE |
| `review` | R2 |
| `chat` | CHAT |
| `vision` | VISION |

### 3.10b Seznam kandidátů je vlastní pro každou roli

Původní návrh stavěl **jeden** společný seznam a pak každého kandidáta hnal
přes všechny role. To je špatná otázka: cílem není jeden univerzální model —
ten neexistuje — ale nejlepší model pro každou roli zvlášť.

Role se liší ve třech věcech a každá z nich vstupuje do seznamu:

| co | jak se liší |
|---|---|
| **laťka** | hodnocení jejího stávajícího modelu, ne globální maximum. Silná role nezvedne laťku slabé. |
| **způsobilost** | VISION potřebuje vision model, D1 minimálně 14B |
| **kategorie** | `MODEL_PROFILES[role].preferredCategories` jako **filtr**, ne bonus |

Kategorie byla ta chybějící část. Bez ní se `llava-phi3` (vision model)
objevoval jako kandidát na CODE i D1. Po zavedení:

```
llava-phi3:3.8b-mini-fp16     → VISION
bakllava:7b-v1-fp16           → VISION
devstral:latest               → CODE, R2
starcoder:15b-base-q8_0       → CODE, R2
qwen3.8:latest                → D1, D2, CODE, R1, R2, CHAT
```

Neznámá kategorie se **nevyřazuje** — zahodit model kvůli mezeře v rozpoznávání
názvu by bylo horší než ho nechat projít s nulovým bonusem; rozhodne pak souboj.

Kandidát se stáhne jednou a zkouší se jen v rolích, kde je kandidátem. Pořadí
ve frontě je dané jeho nejlepší prioritou napříč těmi rolemi.

### 3.10c Pool nesmí být omezený na hodnocené rodiny

whatllm hodnotí 17 z 235 rodin a mezi nimi **není jediný vision model**. Dokud
byl pool omezený na hodnocené rodiny, role VISION nemohla dostat kandidáta
nikdy. Externí hodnocení je proto signál pro řazení a filtr proti laťce, ale
**ne podmínka vstupu** — `buildCandidatePool()` projde všech 235 rodin
(182 z nich má variantu, která se na 24 GB může vejít).

### 3.11 Souboj respektuje způsobilost role

První běh porovnával `qwen3-coder` i v roli VISION, kde textový model nemůže
vyhrát — stálo to šest běhů sady navíc. O způsobilosti rozhodl filtr už dřív
(`checkRoleEligibility`) a souboj ho nemá obcházet. Nezpůsobilá role se
přeskočí a ohlásí (`roleSkipped`).

Vlastnosti kandidáta se odvodí z názvu, ale volající je může dodat přesnější —
`qwen3.5:27b` je podle HuggingFace multimodální, což z názvu nepoznáš.

### 3.12 Jistota rozhodnutí je vidět

Rozhodnutí opřené o jedinou rozlišující úlohu je jedno pozorování, ne trend.
Signál se nezahazuje — úloha stabilní přes tři běhy nese informaci — ale
rozhodnutí nese `confidence`, aby bylo vidět, jak široký podklad za ním stojí:

| rozlišujících úloh | jistota |
|---|---|
| ≥ 3 | vysoká |
| 2 | střední |
| 1 | nízká (jediná úloha) |

### 3.13 GPU-agnostičnost

Detektor umí `nvidia-smi`, `rocm-smi` i `lspci`, ale slouží **jen k předvýběru**.
O přijetí rozhoduje `/api/ps`, které funguje všude. Navíc se filtrují formáty
vázané na hardware — MLX (Apple Silicon) a NVFP4 (Blackwell) — aby se
nestahovalo něco, co dané prostředí nespustí.

---

## 4. Moduly

| soubor | role |
|---|---|
| `src/upgrade/vram-measurement.js` | měření umístění a propustnosti, úklid paměti |
| `src/upgrade/model-sweep.js` | fáze 0+1: rodiny, tagy, předfiltr, řazení |
| `src/upgrade/pairwise-trial.js` | souboj po úlohách, rozhodnutí podle marže |
| `src/upgrade/candidate-trial.js` | fáze 2–4: pull → měření → minimum → souboj → úklid |
| `scripts/model-upgrade-hunt.js` | CLI, který to spojuje |

```bash
node scripts/model-upgrade-hunt.js --shortlist        # nic nestahuje
node scripts/model-upgrade-hunt.js --run --limit=3
node scripts/model-upgrade-hunt.js --run --only=qwen3.8:latest
```

---

## 4b. Ostrý běh

Druhý běh, už s opakováním sad, na kandidátovi `qwen3-coder:latest`:

```
✓ vejde se do VRAM (20.49/20.49 GB při 32768 tok), 146.5 tok/s
✓ schopnostní minimum prošlo (3 kontroly)
   D1      KANDIDÁT   marže 1.000 na 1 rozlišující úloze, jistota nízká
   D2      KANDIDÁT   marže 0.889 na 3 rozlišujících úlohách, jistota vysoká
   CODE    stávající  kvalita nerozlišila
   R1      KANDIDÁT   marže 1.000 na 1 rozlišující úloze, jistota nízká
   R2      stávající  kvalita nerozlišila
   CHAT    stávající  kvalita nerozlišila
   VISION  stávající  kandidát ztrácí na 3 úlohách
```

D1 a R1 sdílejí sadu `reasoning` a dvojici modelů — nově dávají **shodný**
výsledek, což byl přesně ten rozpor, který první běh odhalil.

Vazby se nemění automaticky; výstup je podklad k ručnímu potvrzení.

---

## 5. Testy

| sada | testů |
|---|---|
| `tests/vram-measurement.test.js` | 14 |
| `tests/model-sweep.test.js` | 39 |
| `tests/pairwise-trial.test.js` | 30 |
| `tests/candidate-trial.test.js` | 21 |

Všechny běží **bez sítě a bez modelů** (`fetch` nahrazený atrapou), takže jsou
rychlé a nezávislé na tom, co je zrovna nainstalované.

Celková regrese napříč 20 dotčenými sadami: **939 testů, 0 selhání.**
