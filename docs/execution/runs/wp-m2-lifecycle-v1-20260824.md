# WP-M2-LIFECYCLE-V1 — integrační evidence

- **oddíl:** M2 6/7
- **stav:** `IMPLEMENTATION_GREEN / REVIEW_REQUIRED`
- **candidate revision:** `5e6f25f748cd98834673fcfdfc8fdf7189419b04`
- **gate hardening revision:** `010556619c9b216b950d8f7e15014d76775a80d2`
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

První celý gate našel dvě evidence-infrastrukturní vady, které focused běhy
nemohly ukázat:

- lifecycle DB sady nebyly v fail-closed import-graph census připnuté přes
  canonical isolation bootstrap; `26234510` přidal bootstrap a revidoval census
  z 108 na 110 database-reachable root testů;
- `m2-tool-authority-repository` z oddílu 4 používal pevné terminal časy, ale
  execution claim z reálného `Date.now`; po překročení pevného času SQL fence
  správně začal test odmítat. `01055661` zmrazil testovací clock a exact
  registry-runner recheck má 1/1 PASS.

Dva meziběhy zasažené vlastními direct-test runtime zbytky a následným `ENOSPC`
nejsou vydávány za produktovou evidence. Po odstranění pouze přesně vlastněných
ignorovaných run adresářů proběhl celý deterministický `offline,database` gate
na čistém `010556619c9b216b950d8f7e15014d76775a80d2`:

- run `2026-08-24T08-05-53-988Z`;
- report
  `.intentsmith-artifacts/test-runs/2026-08-24T08-05-53-988Z/report.json`;
- `verdict: FAIL`, `exitCode: 1`;
- `258 PASS / 3 FAIL / 0 TIMEOUT / 2 BLOCKED / 0 SKIPPED`;
- přesná nezměněná non-PASS množina:
  `IS-T1-TESTS-CHAT-EXPORT-BUDGET-TEST` (`BLOCKED`),
  `IS-T1-TESTS-EXPORT-PDF-DOCX-TEST` (`BLOCKED`),
  `IS-T1-TESTS-NIGHTLY-AUDIT-RUNNER-SELF-TEST` (`FAIL`),
  `IS-T1-TESTS-NIGHTLY-ORCHESTRATOR-SELF-TEST` (`FAIL`) a
  `IS-T3-TESTS-VRAM-COORDINATION-TEST` (`FAIL`).

Gate tedy zůstává pravdivě baseline `FAIL`; současně nevznikl nový non-PASS ID,
timeout ani M2 produktová regrese. Devět nových `offline,database` sad vysvětluje
posun proti oddílu 5 z 249 na 258 PASS. Reálná application-service journey je
podle registry v explicitním `soak` profilu kvůli `bwrap`/Git a má samostatně
4/4 PASS. Oddíl zůstává `REVIEW_REQUIRED`, dokud lokální Claude Opus s
`--effort max` nevrátí explicitní `REVIEW_PASSED` nad přesným stabilním řezem.
Každé `CHANGES_REQUESTED` se opraví a review zopakuje.

Poslední cross-section audit na čistém product headu `05c5a856` zopakoval i
skutečnou SQLite → ProjectContext → approval → `bwrap` → Git
application-service journey; zůstala 4/4 PASS včetně restartové obnovy a
cancel/rollback negativní větve. Journey už používá `linux-bwrap-ro-v2` s
minimálním filesystemem a seccomp IPC hranicí. Všech deset lifecycle/governance
sad bylo na stejných product bytes znovu zelených; současný registry fingerprint
po aktualizaci jejich `lastGreen` je
`54dce9be3a18ef854097c5919d1471e53f38bf6ef0e828ecc5ff0438f9e302d2`.

## Přiznané limity

- V1 přijímá jen strict strukturovaný proposal; volný modelový text není
  tolerantně převáděn na effect plan.
- Jeden project change vlastní právě jeden focused argv-only proces.
- Network provider, obecný shell, Git push/tag, mobil a remote listener nejsou
  součástí oddílu 6.
- V okamžiku section-6 gate ještě oddíl 7 nebyl implementován. Nyní je
  implementačně zelený na `a7d4ce3d`, ale stejně jako tento oddíl čeká na
  povinný Opus max `REVIEW_PASSED`.
