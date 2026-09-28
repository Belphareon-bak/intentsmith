# WP-M2-CODE ProjectContext V1 — implementation evidence

**Date:** 2026-08-24  
**Branch:** `codex/m2-project-context-opus-remediation-20260824`  
**Accepted M1 base:** `44a9ba87c99a448b1b1b5f479963c3b6aaac7e91`  
**Original contract candidate:** `a73f786bab306222421161d493e18aec2369b492`  
**Production implementation:** `11b9bfbfaaa9451566e3de2faf14aa51c224111b`  
**Status:** `IMPLEMENTED / FOCUSED_GREEN / OPUS_RE_REVIEW_BLOCKED_BY_ACCOUNT_LIMIT`

Tento report není `REVIEW_PASSED` ani M2 acceptance. Povinný nezávislý
Claude Opus review s `--model opus --effort max` je připravený, ale lokální
CLI jej 2026-08-24 neprovedlo, protože účet vrátil
`You've hit your monthly spend limit`. Implementace proto zůstává kandidát,
dokud executable review skutečně neskončí `REVIEW_PASSED`.

## Doručený produkční řez

- `ProjectContextQuery/Snapshot@1` vynucuje canonical root bez trailing
  slash, deterministické pořadí items a přesné byte/token účtování.
- `project-context-provider.js` publikuje registry-bound
  `observeWorkspaceRevision` a `queryProjectContext`.
- Query ověřuje `expected === before === after`; změna nebo smazání mezi
  kroky vrátí `PROJECT_CONTEXT_STALE` bez items.
- Retrieval nepoužívá Git, subprocess, network, wall-clock ranking, globální
  index ani graf. Pořadí je score-desc a následně UTF-8 path/line.
- Manifest odmítá traversal, root alias, externí symlink i hardlink s více
  jmény; ignorované a neallowlistované symlinky se nevyhodnocují.
- Produkční `CODE_ANALYSIS` už neimportuje `code-search`,
  `file-discovery`, `symbol-index`, `knowledge-graph`,
  `graph-retrieval` ani answer fallback. Stable `empty`, stale,
  invalid-scope, cancel a timeout jsou na consumer hranici rozlišitelné.
- LLM dostane pouze revision-bound excerpts. Synthesis failure nezmění
  úspěšný ProjectContext důkaz na falešné connector selhání.

## Čerstvá focused evidence

| Suite | Výsledek |
|---|---:|
| `tests/m2-project-context-contract.test.js` | 16 PASS |
| `tests/m2-project-context-boundary.test.js` | 15 PASS |
| `tests/m2-project-context-retrieval.test.js` | 9 PASS |
| `tests/m2-project-context-consumer.test.js` | 9 PASS |
| **Nový řez celkem** | **49 PASS / 0 FAIL / 0 SKIP** |

Retrieval test používá committed tří-dotazový oracle, reálné filesystem
fixtures, paralelní projekt A/B, canary projektu B, mid-build mutation i delete,
pre-cancel, deadline a late abort. Consumer test vede skutečný production
handler přes skutečný provider a temp registry; model je pouze offline fake.
Žádný Ollama/GPU/model/network běh se nespouštěl.

Šest dotčených legacy sad bylo znovu spuštěno:

| Suite | Výsledek |
|---|---:|
| `query-expander.test.js` | 18 PASS |
| `code-search.test.js` | 14 PASS |
| `file-discovery.test.js` | 17 PASS |
| `symbol-index.test.js` | 16 PASS |
| `knowledge-graph.test.js` | 17 PASS |
| `context-builder.test.js` | 16 PASS |
| **Legacy kompatibilita celkem** | **98 PASS / 0 FAIL** |

## Boundary a registry

Autoritativní module graph po čistém source commitu přijal právě čtyři nové
hrany provideru a současně utáhl deset odstraněných hran. Osm z nich je
odstranění legacy CODE_ANALYSIS stacku; dvě dřívější
`response-finalizer -> improvement-loops/cre-bridge` hrany byly už odstraněné
na M1 linii. Cykly zůstaly `3 -> 3`, počet souborů v cyklech `28 -> 28`.
`tests/module-boundary-ratchet.test.js` poté prošel `13/13`.

Test registry po čtyřech ProjectContext suites a pěti přesných fixture-program
exclusions:

- `401` runnable programs;
- `14` explicit support exclusions;
- fingerprint
  `b876ffdfde59f83a4e55982f0c95e8366ec0788cce7e97ac1d70c00de2ea207b`;
- `validate-test-registry --write-doc` a následný `--json` check: PASS.

`git diff --check` prošel. Úplný deterministický M2 integrační runner patří
na společný integrační SHA po všech oddílech; tento report proto netvrdí nový
full-gate PASS a nemění známou M1 baseline `233 PASS / 3 FAIL / 2 BLOCKED`.

## Nezávislé review

Původní Opus review nad `44a9ba87..a73f786b` skončilo
`CHANGES_REQUESTED / CONTRACT_ONLY` s blokátory BF-1 až BF-5. Tento řez
kandidátně uzavírá všechny:

1. provider a produkční consumer existují;
2. revision precondition a dvojité pozorování jsou executable;
3. observation seam je veřejný;
4. registry gate je zelený a dokument synchronní;
5. contract vynucuje pořadí i budget accounting.

NB-1 až NB-4 a NB-9 jsou opravené. Dangling allowlisted symlink zůstává
vědomě fail-closed `INTERNAL`; hardlink read exposure je nyní odmítnuté
`INVALID_SCOPE`. Plná heuristická parity se symbol indexem/grafem není
tvrzená — containment je vědomý, schválený capability reduction a obnovuje ji
navazující project-bound index WP.

## Aktuální integrační revalidace

Přesný rozšířený source review range je
`44a9ba87c99a448b1b1b5f479963c3b6aaac7e91..5e19b825`. Čistý společný
`offline,database` gate na `0046cd9d76c19cb3160659b5caf56a32af5024c0`
znovu spustil všechny čtyři registrované ProjectContext sady jako PASS; report
je `.intentsmith-artifacts/test-runs/2026-08-24T09-09-50-584Z/report.json` a
celkově zůstal na přesné baseline
`260 PASS / 3 FAIL / 2 BLOCKED / 0 TIMEOUT`. To uzavírá dříve odloženou
integrační revalidaci, ale nikoli povinný Opus max re-review.
