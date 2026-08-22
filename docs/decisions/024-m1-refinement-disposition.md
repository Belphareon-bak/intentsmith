# 024 — disposition model-backed refinementu podle fixního A/B corpusu

- **typ:** BLOCK na Gate 2; implementace měřidla může pokračovat bez volby
- **stav rozhodnutí:** ČEKÁ NA FYZICKÉ A/B; nevybírat bez čísel
- **WP:** WP-M1-QUALITY / B5
- **rail:** R2 LOCAL_FIRST, R3 OBSERVABLE_BEHAVIOR, R4 MEASURED_QUALITY, R6 REVERSIBILITY
- **source měřidla:** `759bcad0f3bdc4be7eb8fd134d429dc572601d3a`

## Proč je rozhodnutí blokované

Odstranění double-refine a jednoznačná telemetrie jsou bezpečnostní oprava a
nevyžadují produktovou volbu. Zda má model-backed refinement zůstat zapnutý,
ale nelze určit podle zelených fake testů: přidává modelové tokeny a latenci a
může být deterministickým scorerem odmítnut. Gate 2 proto rozhoduje až nad
jedním exact modelem, jedním commitnutým corpusem a skutečnými A/B čísly.

## Varianty

| Varianta | Chování | Přínos | Cena a riziko |
|---|---|---|---|
| **A — ponechat** | Jeden finalizer-owned refine pro každý eligible score `<75`. | Zachová veškerý naměřený accepted quality gain. | Platí se latence a tokeny i za odmítnuté candidates; drift guard zůstává kritický. |
| **B — omezit** | Zachovat ownera, ale povolit refinement jen pro intents/corpus třídy s kladným delta a přijatelnou cenou. | Soustředí cenu na prokázaný přínos a drží snadný rollback. | Vyžaduje explicitní allowlist/threshold a další měření při jeho změně. |
| **C — odstranit** | Odstranit model-backed rewrite; ponechat synthesis retry, deterministické gate a scoring telemetry. | Nulová refinement latence/tokeny a nejmenší drift surface. | Přijde se o každý prokázaný accepted quality gain. |

## Povinná tabulka před volbou

| Metrika | Hodnota |
|---|---:|
| exact source | `PENDING_GPU_PASS` |
| model/digest/context | `qwen3.5:27b` / `7653528b…ec06e` / 4096 |
| corpus SHA-256 | `a2b1ab9175407cd144306532bf87859aaa6fef196a3c5ed9787b1f6df128790f` |
| corpus cases | 4 |
| attempted / accepted / rejected | `PENDING_GPU_PASS` |
| acceptance rate | `PENDING_GPU_PASS` |
| mean applied score delta | `PENDING_GPU_PASS` |
| A latency p50 / p95 | `PENDING_GPU_PASS` |
| refinement latency p50 / p95 | `PENDING_GPU_PASS` |
| B final latency p50 / p95 | `PENDING_GPU_PASS` |
| A prompt/output tokens | `PENDING_GPU_PASS` |
| refinement prompt/output tokens | `PENDING_GPU_PASS` |
| konkrétní accepted případ a cena | `PENDING_GPU_PASS` |
| konkrétní rejected případ a cena | `PENDING_GPU_PASS` |

## Zatím dostupný důkaz

Offline kontrakt má konkrétní accepted fixture `60 -> 79`, jedno volání a 65
tokenů, ale jde o fake model a není to podklad pro variantu A/B/C. Registrovaný
T3 preflight `m1-b5-quality-preflight-759bcad0-20260823` skončil před provider
efektem: cizí model byl rezidentní, compute `1`, free VRAM 4 775 MiB a
utilization 93 %. Fyzické hodnoty proto zůstávají `PENDING_GPU_PASS`, nikoli
nula nebo odhad.

## Přesná otázka pro Gate 2

```text
024-refinement-disposition: A-KEEP | B-LIMIT | C-REMOVE
024-evidence-run: <exact PASS run id>
024-source: <exact clean source SHA>
024-corpus: a2b1ab9175407cd144306532bf87859aaa6fef196a3c5ed9787b1f6df128790f
024-accepted-case: <id, score delta, latency, tokens>
024-rejected-case: <id, candidate delta, rejection reason, latency, tokens>
024-threshold-or-allowlist: <unchanged | exact new bounded policy | removed>
024-rollback: <exact one-commit or config path>
```

Do doplnění této tabulky není žádná z variant přijata. B5 může dokončit pouze
měření; Gate 2 musí výslovně zvolit disposition.
