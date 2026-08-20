# Model scoring a hledání modelů — souhrn a stav

**Datum:** 2026-08-20 · **Verze:** v136.0.0 · **Testy:** 939, 0 selhání

Souhrn práce od 2026-08-17. Slouží jako přehled a jako vstupní bod pro další
relaci. Detaily: [`MODEL-SCORING-ACTIVATION.md`](MODEL-SCORING-ACTIVATION.md)
(scoring) a [`MODEL-UPGRADE-HUNT.md`](MODEL-UPGRADE-HUNT.md) (hledání).

---

## 1. Kde to začalo

Úklid disku odhalil 187 GB Ollama modelů. Otázka „které smazat" vedla na
scoring, který byl **postavený, ale nikdy nespuštěný** — a při prvním měření
dával nepoužitelné pořadí.

## 2. Co se opravilo, chronologicky

| # | Vada | Jak se projevila | Oprava |
|---|---|---|---|
| 1 | Lokální modely se nespojovaly s katalogem | 88 % váhy skóre nulové nebo konstantní; rozhodovala jen velikost | `catalog-enrichment.js` |
| 2 | Rodiny `qwq`, `glm`, `devstral` neznámé; `qwen3-coder` klasifikován jako general | nulový bonus za kategorii | `model-family-extensions.js` |
| 3 | `requirements` z profilů se nevynucovaly | roli VISION vyhrával textový model | `checkRoleEligibility()` |
| 4 | `computeHardwareFit` mělo skoková pásma | skok 0.06 na promile VRAM | lineární rampa |
| 5 | L5 párování ignorovalo generaci a specializaci | `qwen2.5:32b` → `Qwen3 32B`, `deepseek-r1-32b` → `DeepSeek V4 Pro` | přepsané `matchModels` |
| 6 | whatllm a katalog míchaly nesouměřitelné škály | whatllm modely systematicky o polovinu níž | `buildScaleCalibration()` percentilem |
| 7 | Jediný zdroj kvality | výpadek whatllm.org shodí celé obohacení | `huggingface-client.js` jako druhý zdroj faktů |
| 8 | L4 hledalo jen v nainstalovaných rodinách | 7 z 235 rodin; našlo jen kvantizace toho, co už je | `model-sweep.js` |
| 9 | Odhad VRAM podstřeloval o třetinu | `qwen2.5:32b` odhad 22 GB, skutečnost 30 GB | `vram-measurement.js` přes `/api/ps` |
| 10 | Sady saturují (100 % padlo 26× z 65) | absolutní skóre u špičky nerozlišuje | párový souboj s marží |
| 11 | Jeden běh sady nestačí | tatáž dvojice vyšla jednou 3:0, podruhé 0:5 | 3 opakování + práh podle nestability |
| 12 | Jeden promíchaný seznam kandidátů | vision model kandidátem na CODE | seznam **per role** |

## 3. Klíčová rozhodnutí

**Měření místo odhadu.** Katalogový odhad VRAM podstřeluje o třetinu, takže
bránou je `/api/ps` (`size` vs `size_vram`) — měřený binární fakt, nezávislý na
výrobci GPU. Dvě pasti: měřit z **prázdné paměti** (kontence zdvojnásobila
výsledek) a při **skutečném kontextu** (32k, ne 4k).

**Přetečení je diskvalifikace, ne penalizace.** 8 GB na CPU → 6 tok/s proti
73.5. Swap režim se nezavádí ani za potvrzení.

**`hardwareFit` není složkou kvality.** Byl 20 % a se `speed` tvořil 27 % váhy
pro věci nesouvisející s kvalitou → systematická výhoda malých modelů.

**Váha rychlosti podle role.** CHAT 0.15, D1/R1 0.03. Rychlost z naměřených
tok/s, ne z počtu parametrů — MoE model s 30B parametrů dával 142 tok/s.

**Krátká sada je schopnostní minimum, ne zkrácené hodnocení.** Tři binární
kontroly (odpoví, JSON, čeština). Nemůže vyřadit model, který je „jen horší".

**Seznam kandidátů je vlastní pro každou roli** — vlastní laťka (její stávající
model), způsobilost, a `preferredCategories` jako filtr.

**Adopce z HuggingFace se nepřevádí na skóre.** Popularita není kvalita.

**Rozpory mezi zdroji se hlásí, nepřepisují.** Katalog je revidovaný.

## 4. Naměřená data (RTX 3090, 32k kontext)

Po aktualizaci Ollamy na 0.32.14:

| model | VRAM | vejde se | tok/s |
|---|---|---|---|
| `qwen3.5:27b` | 16.98 GB | ano | 41.2 |
| `qwen3.8:latest` | 16.20 GB | ano | 38.8 |
| `qwen3-30b-a3b` | 19.20 GB | ano | 42.0 |
| `llava:13b` | 10.04 GB | ano | 58.0 |
| `deepseek-r1-32b` | 25.83 GB | **ne** | — |

Aktualizace Ollamy zlepšila paměť (`qwen3.5:27b` přestal přetékat: 23.30 → 16.98 GB),
ale propustnost spadla (`qwen3-30b-a3b` 142 → 42 tok/s). **Neověřeno** — měření
proběhlo za běhu jiné úlohy, je potřeba zopakovat v klidu.

## 5. Nástroje

```bash
# vhodnost modelů pro role (skóre + naměřená validace)
node scripts/model-scoring-report.js --matrix
node scripts/model-scoring-report.js --matrix --measure   # + VRAM a tok/s
node scripts/model-scoring-report.js --validate           # přeměří validaci

# hledání lepších modelů
node scripts/model-upgrade-hunt.js --shortlist            # nic nestahuje
node scripts/model-upgrade-hunt.js --role=CODE --run --limit=2
node scripts/model-upgrade-hunt.js --run --limit=3        # všechny role
```

## 6. Otevřené body

1. **Validační sady saturují.** 100 % padlo 26× z 65 běhů; `llava:13b` dostal
   100 % v sadě `code`. Párové srovnání to obchází, ale nevyřešilo. Bez
   zpřísnění nelze rozhodovat podle měření.
2. **Katalog je 13 měsíců starý** a nové modely v něm nejsou. `qwen3.8` a
   `qwen3-coder` proto dostávají skoro nulovou benchmarkovou složku a matice je
   podhodnocuje — přestože `qwen3.8` má nejvyšší externí hodnocení (57.7).
3. **`BENCHMARK_WEIGHTS.VISION` obsahuje jen textové benchmarky.** Mezi
   způsobilými vision modely se tedy řadí podle textu. Matice na to upozorní
   (`qwen3.5:27b` skóre vede, ale validace 33 % proti 83 % u `llava:13b`).
4. **Ověřit propad propustnosti** po aktualizaci Ollamy v klidném stavu.
5. **`model_universe` je prázdný** — report i hunt ho obcházejí a počítají
   přímo z discovery.
6. **whatllm zůstává jediným zdrojem kvality.** HuggingFace dodává fakta
   (datum, schopnosti, adopce), ne hodnocení. Redundance kvality není.

## 7. Co je potřeba vědět o prostředí

- **Ollama 0.32.14** (aktualizováno 2026-08-20 z 0.17.7, která odmítala nové
  modely přes HTTP 412). Instalace je systémová binárka pod rootem —
  aktualizace vyžaduje `sudo` heslo.
- **`C3_ENABLE_ONLINE_DISCOVERY` má výchozí `on`** od 2026-08-19 (operátorské
  rozhodnutí v `DIRECTION.md`, obrací zápis z 2026-08-02).
- **`model-profiles.js` je připnutý bajtovým hashem** ve fail-closed proof
  policy. Změny rodin patří do `model-family-extensions.js`.
- Vazby rolí se **nikdy nemění automaticky** — výstup je podklad k ručnímu
  potvrzení.
