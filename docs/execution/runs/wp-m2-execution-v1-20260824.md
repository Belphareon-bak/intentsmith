# WP-M2-EXECUTION-V1 — integrační evidence

- **oddíl:** M2 5/7
- **stav:** `IMPLEMENTATION_GREEN / REVIEW_PENDING`
- **contract commit:** `1ef645cd`
- **process containment commit:** `9b2a7cce`
- **durable project-change commit:** `1c41cbd3`
- **hardening revision:** `08d249adab097fc4e628b5ee8e54e9df1a26fa9c`
- **větev:** `codex/m2-integration-20260824`
- **push:** neproveden

Tento report nedokládá `PINNED_V1`, `REVIEW_PASSED` ani M2 PASS. Dokládá
implementačně zelený oddíl 5 a source-bound evidence před povinným Opus max
review.

## Dodaný řez

- `ProjectChangeRequest/Result@1` s exact patch, rollback, focused-test a Git
  authority set;
- append-only migrace 078: 10 tabulek, 20 append-only triggerů, exact request,
  before/after BLOB material, child steps, approval generations, claim/renewal,
  process identity, journal a jediný terminal;
- atomická multi-grant consumption a restartová rekonstrukce úplné consumed set;
- file intent/applied journal, byte/mode readback a reverse rollback bez přepsání
  third-party driftu;
- fail-closed bubblewrap provider s read-only root/project, network/PID/IPC
  isolation, private tmp, durable supervisor handshake a celým PGID lifecycle;
- exact Git commit přes temporary index, literal/NUL paths, CAS ref, exact-path
  real index a foreign dirt proof;
- restartová klasifikace baseline/exact/foreign: rollback baseline, roll-forward
  pro deterministicky prokázaný commit, jinak `in_doubt` bez přepsání;
- skutečné procesní pády přes `SIGKILL` po ref CAS i po index update.

## Focused evidence

| Sada | Výsledek |
|---|---:|
| `m2-execution-contract-v1` | 22/22 PASS |
| `m2-execution-authority-repository` | 13/13 PASS |
| `m2-execution-project-change` | 10/10 PASS |
| `m2-execution-process-supervision` | 11/11 PASS |
| `m2-execution-git-preservation` | 10/10 PASS |
| `m2-effect-authority-repository` | 43/43 PASS |
| `schema-migrations` | 38/38 PASS; 68 migrací |
| `m1-model-failover-schema` | 20/20 PASS; tip 078 / 68 migrací |
| `module-boundary-ratchet` | 13/13 PASS; 1 098 hran; 3 cykly / 28 souborů |
| `artifact-validation` | 154/154 PASS |

Registry po přidání pěti execution programů:

- `valid: true`;
- 416 runnable programů a 14 explicitních exclusions;
- fingerprint
  `318e38d8752181de401e8100c762a056e704df51d9a03bd22f20ece759b7cb96`;
- generovaný `docs/convergence/TEST-REGISTRY.md` je aktuální.

Tři sady vyžadující host `bwrap`/Git jsou podle existující registry konvence
aktivní v explicitním `soak` profilu. Výchozí `offline,database` gate je proto
nevydává za BLOCKED; jejich čerstvý výsledek dokládají přímé focused běhy výše.

První opakovaný celý gate odhalil i příliš těsný 30s limit starší
`m2-effect-file-runtime`: sada se pod aktuální I/O zátěží ukončila na 30,033 s,
zatímco samostatný opakovaný běh dokončil všech 6 checků za 34,21 s. Registry
proto pravdivě kalibruje očekávání na 45 s a hard timeout na 120 s; produktový
kód ani výsledek sady se tím nemění.

## Nezávislý interní audit před Opus

První read-only audit našel Git crash window, grant-consumption/approval-set
window a SQL lease fencing. Po opravách re-audit uzavřel původní R1–R4 a našel
ještě renewal shortening/resurrection a ne-literal/LF Git paths. Hardening na
`08d249ad` přidal MAX effective lease, monotonic live renewal, literal
pathspecs, NUL index-info a skutečný `SIGKILL`. Následné focused sady jsou výše
zelené. Tento interní audit nenahrazuje požadovaný Opus verdict.

## Artifact a celý gate

Artifact validation je čerstvě zelená 154/154. Host-toolchain sady mají navíc
runner report
`.intentsmith-artifacts/test-runs/2026-08-24-m2-section5-toolchain/report.json`:
na čistém `69370d49` je `verdict: PASS`, `exitCode: 0`, `3 PASS / 0 non-PASS`
a exact allow-set obsahuje jen `toolchain:bwrap` a `toolchain:git`. Kalibrační
runner report
`.intentsmith-artifacts/test-runs/2026-08-24-m2-effect-runtime-timeout-calibration/report.json`
na čistém `181bb0cd` dokládá `1/1 PASS` za 44 204 ms, bez timeoutu a leaků.

Celý deterministický `offline,database` gate na čistém
`181bb0cdfa371aaef222fee53e39d7ed60ff8c25`:

- run `2026-08-24T06-26-18-087Z`;
- report
  `.intentsmith-artifacts/test-runs/2026-08-24T06-26-18-087Z/report.json`;
- `verdict: FAIL`, `exitCode: 1`;
- `249 PASS / 3 FAIL / 0 TIMEOUT / 2 BLOCKED / 0 SKIPPED`;
- přesná nezměněná non-PASS množina:
  `IS-T1-TESTS-CHAT-EXPORT-BUDGET-TEST` (`BLOCKED`),
  `IS-T1-TESTS-EXPORT-PDF-DOCX-TEST` (`BLOCKED`),
  `IS-T1-TESTS-NIGHTLY-AUDIT-RUNNER-SELF-TEST` (`FAIL`),
  `IS-T1-TESTS-NIGHTLY-ORCHESTRATOR-SELF-TEST` (`FAIL`) a
  `IS-T3-TESTS-VRAM-COORDINATION-TEST` (`FAIL`).

Gate tedy zůstává pravdivě baseline `FAIL`; současně nevznikl nový non-PASS ID,
timeout ani produktová regrese. Oddíl zůstává `REVIEW_PENDING`, dokud Opus max
nevrátí `REVIEW_PASSED`.

Při cross-section auditu na čistém `d034df62` byly všechny tři host-toolchain
sady spuštěny znovu přímo a zůstaly zelené: project change 10/10, process
supervision 11/11 a exact Git preservation 10/10. Běhy použily skutečné
`bwrap`/Git procesy, nezanechaly direct-test runtime a nedotkly se GPU/Ollamy.

## Omezení a navazující práce

- Oddíl 5 nepřepojil legacy lifecycle ani Studio surface; to je oddíl 6.
- Není zde network provider, obecný shell, Git push/tag ani non-Linux sandbox.
- V okamžiku section-5 gate ještě celý M2 čekal na oddíly 6–7. Oba jsou nyní
  implementačně zelené; acceptance dál čeká na Opus max PASS všech sedmi
  oddílů a finální closeout.
