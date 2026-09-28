# M4 — výsledek operátorského review

- **Adresát:** integrátor M4 a operátor release
- **Důvod:** svázat operátorský verdict s přesnými product bytes
- **Verdict:** `REVIEW_PASSED` — všech sedm oddílů
- **Přesný product candidate:** `286f5ba881aa5dce3797955efe68a7d5cd97f39c`
- **Review packet HEAD:** `bb765b62940714d49950ff21f822da0131f6faf9`
- **Review range:** `d6213232e4384f1ea1a855fce7f7d093905ebded..286f5ba881aa5dce3797955efe68a7d5cd97f39c`
- **Větev:** `codex/m4-integration-20260826`
- **Upstream / push:** žádný / neproveden

Operátor nezávisle ověřil kontrakt, produkční cesty, konzumenty,
negativní hranice, user gate i úplný integrační baseline. Verdict platí
právě pro uvedený product candidate; dokumentační review packet nad ním
product bytes nemění.

## Verdicty oddílů

| # | Oddíl | Verdict |
|---:|---|---|
| 1 | Contract, identity a negativní invarianty | `REVIEW_PASSED` |
| 2 | Durable authority, scope, lifecycle a retention | `REVIEW_PASSED` |
| 3 | Code Intelligence producer a proposal gate | `REVIEW_PASSED` |
| 4 | ProjectLearningContext a planner boundary | `REVIEW_PASSED` |
| 5 | HTTP a Studio user authority | `REVIEW_PASSED` |
| 6 | Outcome measurement a durable plan artifacts | `REVIEW_PASSED` |
| 7 | Complete journey, rollback/delete a integrační baseline | `REVIEW_PASSED` |

## Reprodukovaná evidence

- osm M4 programů: `73/73 PASS`;
- úplný deterministický gate na source `286f5ba8`: pravdivě
  `verdict: FAIL`, exit `1`, přesně
  `276 PASS / 2 FAIL / 2 BLOCKED / 0 TIMEOUT`;
- všech osm M4 programů v úplném gate: `PASS`;
- jediné non-PASS jsou zděděné `nightly-orchestrator-self-test`,
  `vram-coordination`, `chat-export-budget` a `export-pdf-docx`;
- registry před akceptačním pinem: 446 programů, fingerprint
  `30cd508c5e615650234d17bb80ac75cedd5e39b9f5133846529d89228c2340be`;
- schema `38/38`, artifact `154/154`, module ratchet `13/13`;
- worktree byl při review čistý, bez upstreamu a bez pushu.

## Otevřená neblokující poznámka

`M4-N1 / INFO`: striktní `validateLearnedPatternConformance` je záměrně
fail-closed. Slabší SPEC model, který neudrží exact strukturu, proto shodí
SPEC krok pokaždé, kdy jsou v projektu schválené vzorce. Je to správná
bezpečnostní hranice, nikoli podmínka přijetí; provozní kompatibilita patří
do budoucí model-scoring sady.

## Dispozice

M4 je `ACCEPTED / REVIEW_PASSED`. Verdict nepokrývá žádný pozdější
product commit ani nový non-PASS. M3 oddíl 7 zůstá samostatně otevřený;
tento výsledek jej nemění ani neuzavírá.
