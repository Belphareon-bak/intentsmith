# 024 — disposition model-backed refinementu podle fixního A/B corpusu

- **typ:** BLOCK na Gate 2; implementace měřidla může pokračovat bez volby
- **stav rozhodnutí:** FYZICKÁ ČÍSLA DOSTUPNÁ; čeká na volbu operátora
- **WP:** WP-M1-QUALITY / B5
- **rail:** R2 LOCAL_FIRST, R3 OBSERVABLE_BEHAVIOR, R4 MEASURED_QUALITY, R6 REVERSIBILITY
- **source měřidla:** `20f61f2ea37a0396a46be88ed88881a181ea2b02`

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
| exact source | `20f61f2ea37a0396a46be88ed88881a181ea2b02` |
| model/digest/context | `qwen3.5:27b` / `7653528b…ec06e` / 4096 |
| corpus SHA-256 | `a2b1ab9175407cd144306532bf87859aaa6fef196a3c5ed9787b1f6df128790f` |
| corpus cases | 4 |
| attempted / accepted / rejected | 2 / 0 / 2 |
| acceptance rate | 0 % |
| mean applied score delta | 0 |
| A latency p50 / p95 | 3 670 / 26 548 ms |
| refinement latency p50 / p95 | 933 / 13 358 ms |
| B final latency p50 / p95 | 3 670 / 26 548 ms |
| A prompt/output tokens | 399 / 377 |
| refinement prompt/output tokens | 565 / 462 |
| konkrétní accepted případ a cena | žádný — to je acceptance FAIL, ne chybějící údaj |
| konkrétní rejected případ a cena | `dns-steps`: candidate 72 → 82, semantic drift `0,316 < 0,35`, 13 358 ms, 808 tokenů; `prague-factual`: 59 → 59, 933 ms, 219 tokenů |

## Fyzický důkaz

Offline kontrakt má konkrétní accepted fixture `60 -> 79`, jedno volání a 65
tokenů, ale fake model nebyl podklad pro variantu A/B/C. Registrovaný fyzický
run `m1-b5-quality-ab-20f61f2e-20260823` na clean source provedl šest exact
`qwen3.5:27b` requestů, zachoval všechna čtyři finální corpus chování, neměl
provider error a přirozeně obnovil GPU proti zaznamenanému RustDesk baseline.
Verdikt je přesto FAIL: dva eligible refinementy byly oba odmítnuté, applied
delta je 0 a cena je 1 027 tokenů plus 14 291 ms.

## Doporučení

**Doporučená varianta je C — odstranit model-backed refinement.** A nemá žádný
fyzicky přijatý přínos. B by v této chvíli znamenalo buď měřit jiný corpus,
nebo oslabit semantic drift threshold, aby prošel candidate s podobností
`0,316`; ani jedno není důkaz přínosu na commitnuté acceptance množině.
Deterministický scorer a synthesis retry zůstanou, takže odstranění je malé a
vratné. Rozhodnutí ale zůstává operator-only Gate 2 BLOCK.

## Přesná otázka pro Gate 2

```text
024-refinement-disposition: A-KEEP | B-LIMIT | C-REMOVE
024-evidence-run: m1-b5-quality-ab-20f61f2e-20260823 (acceptance FAIL)
024-source: 20f61f2ea37a0396a46be88ed88881a181ea2b02
024-corpus: a2b1ab9175407cd144306532bf87859aaa6fef196a3c5ed9787b1f6df128790f
024-accepted-case: NONE
024-rejected-case: dns-steps (+10 candidate, semantic drift, 13358 ms, 808 tokens)
024-threshold-or-allowlist: <unchanged | exact new bounded policy | removed>
024-rollback: <exact one-commit or config path>
```

Tabulka je doplněná, ale žádná varianta není přijata automaticky. Gate 2 musí
výslovně zvolit disposition; bez této volby B5 ani M1 nejsou hotové.
