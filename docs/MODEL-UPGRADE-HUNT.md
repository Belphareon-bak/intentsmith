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
1  seřadit podle externích signálů, odříznout nevhodné  minuty, 0 GB
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

### 3.9 GPU-agnostičnost

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

## 5. Testy

| sada | testů |
|---|---|
| `tests/vram-measurement.test.js` | 14 |
| `tests/model-sweep.test.js` | 26 |
| `tests/pairwise-trial.test.js` | 16 |
| `tests/candidate-trial.test.js` | 15 |

Všechny běží **bez sítě a bez modelů** (`fetch` nahrazený atrapou), takže jsou
rychlé a nezávislé na tom, co je zrovna nainstalované.

Celková regrese napříč 20 dotčenými sadami: **906 testů, 0 selhání.**
