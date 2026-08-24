# WP-M2-LIFECYCLE-V1 — integrační evidence

- **oddíl:** M2 6/7
- **stav:** `IMPLEMENTATION_GREEN / REVIEW_REQUIRED`
- **candidate revision:** `5e6f25f748cd98834673fcfdfc8fdf7189419b04`
- **větev:** `codex/m2-integration-20260824`
- **push:** neproveden

Tento report nedokládá `PINNED_V1`, `REVIEW_PASSED` ani M2 PASS. Dokládá
implementačně zelený source-bound kandidát oddílu 6 před povinným Opus max
review. Účtový spend limit Opusu není verdict a nesmí se překládat na PASS.

## Dodaný řez

- exact `GovernancePolicySnapshot`, `GovernanceDecision` a
  `GovernanceReceipt` v1 s deterministickým vyhodnocením úplného source layoutu;
- exact `LifecyclePlanSnapshot`, `LifecycleApprovalIntent` a
  `LifecycleTerminalSnapshot` v1 se strict proposal compilerem;
- migrace 079 se 7 lifecycle/governance tabulkami, 14 append-only triggery
  a fingerprintem
  `e08966bdf3a40c6acd3a8832a4f8912968d506ab852e74ce776e74b6c5186b87`;
- durable repository a application service nad ProjectContext, exact
  ProjectChange execution a payload-bound single-use approval granty;
- skutečné start/approve/cancel/status HTTP hranice a Studio surface;
- `410 Gone` pro legacy HTTP lifecycle mutátory a negotiated-chat karanténa
  před quick-build, obecným „ano“ i legacy C4 rebind cestou;
- restartová obnova z durable receipt bez opakování write/test/Git efektu,
  terminal cancel a klasifikace pozdního success po cancel jako `ORPHANED`.

## Focused evidence

| Sada | Výsledek |
|---|---:|
| `m2-governance-contract-v1` | 11/11 PASS |
| `m2-governance-evaluator` | 19/19 PASS |
| `m2-lifecycle-contract-v1` | 14/14 PASS |
| `m2-lifecycle-proposal-compiler` | 12/12 PASS |
| `m2-lifecycle-authority-repository` | 13/13 PASS |
| `m2-lifecycle-application-service` | 4/4 PASS |
| `m2-lifecycle-routes` | 7/7 PASS |
| `m2-lifecycle-surface-retirement` | 6/6 PASS |
| `m2-lifecycle-studio-surface` | 9/9 PASS |
| `m2-negotiated-lifecycle-quarantine` | 8/8 PASS |

Nové focused sady mají dohromady 103/103 PASS. Relevantní existující regrese
`build-handoff`, `lifecycle-handoff`, `ws-bridge`, `chat-pipeline`,
`m1-studio-client`, `chat-persistence` a `chat-fixes` mají dohromady 459/459
PASS. Všechny běhy byly offline, bez GPU, Ollamy, Electronu a sítě.

## Strukturální evidence

- `schema-migrations`: 38/38 PASS; 69 migrací;
- `m1-model-failover-schema`: 20/20 PASS; tip 079 / 69 migrací;
- `module-boundary-ratchet`: 13/13 PASS; 1 116 hran; 3 cykly / 28 souborů;
- `artifact-validation`: 154/154 PASS;
- registry: 426 runnable programů a 14 explicitních exclusions;
- registry fingerprint po připnutí `lastGreen` je
  `5796d25d7b10adacd0eabcb62fb8da13fb184d6908e3ab9cabb7e453c3793ac0`.

## Celý gate a review

Celý deterministický `offline,database` gate bude doplněn až z čistého evidence
commitu. Historický gate je pravdivě `FAIL` s pěti známými non-PASS ID; tento
report jej nevydává za PASS. Oddíl zůstává `REVIEW_REQUIRED`, dokud lokální
Claude Opus s `--effort max` nevrátí explicitní `REVIEW_PASSED` nad přesným
stabilním řezem. Každé `CHANGES_REQUESTED` se opraví a review zopakuje.

## Přiznané limity

- V1 přijímá jen strict strukturovaný proposal; volný modelový text není
  tolerantně převáděn na effect plan.
- Jeden project change vlastní právě jeden focused argv-only proces.
- Network provider, obecný shell, Git push/tag, mobil a remote listener nejsou
  součástí oddílu 6.
- Oddíl 7 (`RemoteCorePort` a bezpečná remote boundary) ještě není implementován.
