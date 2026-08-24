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
  `d6a006c086879d350395857a60b9eb794d4f54d4c9cd102d15e02d14d2ff65d4`;
- generovaný `docs/convergence/TEST-REGISTRY.md` je aktuální.

Tři sady vyžadující host `bwrap`/Git jsou podle existující registry konvence
aktivní v explicitním `soak` profilu. Výchozí `offline,database` gate je proto
nevydává za BLOCKED; jejich čerstvý výsledek dokládají přímé focused běhy výše.

## Nezávislý interní audit před Opus

První read-only audit našel Git crash window, grant-consumption/approval-set
window a SQL lease fencing. Po opravách re-audit uzavřel původní R1–R4 a našel
ještě renewal shortening/resurrection a ne-literal/LF Git paths. Hardening na
`08d249ad` přidal MAX effective lease, monotonic live renewal, literal
pathspecs, NUL index-info a skutečný `SIGKILL`. Následné focused sady jsou výše
zelené. Tento interní audit nenahrazuje požadovaný Opus verdict.

## Artifact a celý gate

Artifact validation je čerstvě zelená 154/154. Celý deterministický gate bude
do tohoto reportu doplněn až na čistém evidence commitu. Do té doby oddíl
zůstává `REVIEW_PENDING`; historický celkový gate je pravdivě `FAIL`, ne PASS.

## Omezení a navazující práce

- Oddíl 5 nepřepojil legacy lifecycle ani Studio surface; to je oddíl 6.
- Není zde network provider, obecný shell, Git push/tag ani non-Linux sandbox.
- Celý M2 stále čeká na oddíly 6–7 a Opus max PASS všech sedmi oddílů.
