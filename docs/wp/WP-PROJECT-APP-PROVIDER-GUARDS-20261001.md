# WP — public project-app provider evidence and request cleanup

## Root přejímka — 1. 10. 2026, 11:43 UTC

**REVIEW_PASS / REGISTERED_8_PASS / NO_NEW_MODEL_RUN.** Čistý autor
`15337cdeed901c2a8468c16345db31efc2999ea1` má nezávislé source review,
opakovaných **35/35** a další skutečné **3/3** kontroly cleanup před headers,
upstream response abort a replay původních úplných ledger/TaskFlow důkazů.
Review manifest SHA-256
`f1427bbe4cdc8ab951821e1ed465ba2bbe4af390119b1587ef15bb79b468ed92`.
Chybný první restart-import a jeho 23 PASS / 12 FAIL zůstávají uchované.

Root cherry-pick `eb832646` a registrace `0bf96f05` mají nezávislé
integrační **REVIEW_PASS**. Přesných pět author blobů zůstalo totožných;
produkční stromy src/contracts/IDE/specialists/skills jsou shodné s `f96c2d23`.
Celých 593 descriptors zachováno kromě právě dvou předem uvedených polí
M2 fixture/network. Canonical writer obnovil projekci, registry fingerprint
`24c927fc68f58622302ee675af30a9a05dc16f2ff54a8b2cc689b92100af58ca`.
Source census 681 / 234 011 LF, tests 599 / 265 388 LF; DB-reachable roots 142.
Root integrační review manifest SHA-256
`7699f528a7389c2f30fe6e7032771eebcd245bdd8df272e3beb2bbbc988b1e99`.

Společná skutečná registrovaná brána na clean
`0bf96f05358a576a24d8971770c3d6daa2b339eb` skončila exit 0,
**8 PASS / 0 FAIL / 0 BLOCKED / 0 TIMEOUT / 0 SKIPPED**, report
`2026-10-01T11-38-51-086Z/report.json`, SHA-256
`1a33fceee836e11a886bbb5efbf7a9883ac6c170ad7c7582d64f597627d0c514`.
Žádná modelová/CHAT/server sada nebyla vybraná. Starší skutečné fyzické
aplikace zůstávají přijaté; tato oprava je nové CPU/resource přijetí,
nikoli nová inference, celý profil, instalace či release.

## Historický autorský Work Package

Status: `IMPLEMENTATION_GREEN / REVIEW_PENDING / NO_NEW_MODEL_RUN`.

Authority: the operator's completion request and ROOT's explicit bounded
assignment following independent review of three public harness defects.
This WP repairs the existing physical project runner's evidence/resource guards.
It adds no product requirement or alternative runner.

Base: published `6f0f04d5034a5f7307882c3d0034f644c89f8dc4`.
Owner: `/root/full405_diagnosis`; existing checkout
`/home/belphareon/Projects/intentsmith-full405-baseline-oracles-20261001`,
branch `work/project-app-provider-guards-20261001`.
The former `ce2d2d4d` branch and its ignored raw evidence remain preserved;
the independent private archive also retains all 404 regular evidence files.

## Owned scope and outcome

- `scripts/run-project-app-journey.js` and a small shared scripts helper;
- existing `tests/project-app-acceptance.test.js` version controls and
  `tests/project-app-m2-functional.test.js` owned-loopback CPU controls;
- this WP.

The physical runner must reject absent/blank/invalid provider versions and
require the terminal metadata to match the exact validated expected version.
Both the namespace relay and parent provider relay must cancel their own
upstream request when the downstream aborts/closes, track that request until
its close settles, and finish cleanup before model unload or GPU lease release.

Product `src/`, contracts, registry, frozen Ledger/TaskFlow oracles and public
blueprints are outside this writing scope. Historical `92f7b51c` and `6f0f04d5`
physical PASS have valid captured metadata and complete calls; they are retained.
ROOT owns registry/integration/push; this candidate remains independently
`REVIEW_PENDING` until accepted.

## Acceptance and stop conditions

1. Existing provider-proof CPU controls remain strict; absent/blank/invalid
   expected or terminal versions reject rather than comparing undefined values.
2. Actual owned loopback HTTP request abort/close cancels the upstream socket;
   explicit cleanup awaits settlement and reports zero tracked requests before
   later cleanup callbacks can run. The shared implementation is used by both
   existing relay paths.
3. Both scenario syntax/no-inference preflights and both app CPU suites pass
   with Node 24.21.0. Registered M2 acceptance follows ROOT's truthful loopback
   descriptor update. Test SQLite writes stay in canonical private
   isolation; no production DB/service, model/GPU, CHAT or browser work.
4. Frozen oracle/public blueprint bytes, exact five/six path binding, product
   source, contracts and registry remain unchanged from the base.

Commands: Node 24 `--check` on changed scripts/test; Node 24 runner
`--preflight` and `--scenario taskflow --preflight`; canonical registered runner
for `IS-T1-TESTS-PROJECT-APP-ACCEPTANCE-TEST` and
`IS-T1-TESTS-PROJECT-APP-M2-FUNCTIONAL-TEST` with their actual declared toolchain
allowances. Exact commands/results/source pins are appended after execution.

Stop if completing these guards requires product/contract changes, a new
physical runner, frozen oracle changes or any real provider/GPU request.

Network declaration: ROOT must update only the existing M2 descriptor to
`network: loopback` and fixture `isolated-db-and-owned-loopback-project-process`.
Its database profile, DB requirement, toolchains, server/ollama/GPU false and
all other descriptors stay unchanged. Acceptance remains `network: none`.
No registered M2 run against the old `none` descriptor will be claimed.

## Implementation and concrete results

The existing runner now validates the `/api/version` value before starting the
relay. Qualification requires a validated expected identity and exact terminal
model/digest/version, complete stop and unchanged output-to-preview binding.
The former synthetic positive version `qualification-version` is replaced with
valid controlled `0.34.0`; no existing behavioral rejection oracle is weakened.

Both existing relay tiers use `createOwnedProviderRelay`. It owns the handler
before asynchronous body reads, cancels its request/response on downstream
abort or incomplete response close, and waits for handler and upstream close
events. Normal complete request close preserves the response. Parent cleanup
awaits that settlement before unloading the owned model or releasing its lease,
and recomputes qualification after the drain so a late relay error cannot be
hidden. An unproved drain remains FAIL with lease retained. No alternate live
runner or new CLI/provider transport mode is introduced.

Private evidence directory, retained in this existing checkout:
`.intentsmith-artifacts/project-app-provider-guards-20261001/`.

| Actual evidence | Exit / result | Durable file |
| --- | --- | --- |
| Exact baseline runner from `6f0f04d5`, focused added version assertion; only relative import locations adapted | exit 1, 0 PASS / 1 FAIL: equal `undefined` versions incorrectly attest | `baseline-version-red.json`, `baseline-version-red.log` |
| Four Node 24.21.0 syntax checks; Ledger and TaskFlow `--preflight` | all exit 0; both preflights `LIVE_NOT_RUN` | `cpu-commands.json`, individual syntax/preflight logs |
| First complete CPU attempt after moving loopback controls into M2 | exit 1, 23 PASS / 12 FAIL: accidental import added to the embedded TaskFlow restart script | `app-cpu-direct.log`, `cpu-commands.json` |
| Fixed direct CPU run | exit 0, 35 PASS / 0 FAIL | `app-cpu-direct-fixed.json`, `app-cpu-direct-fixed.log` |
| Final meaningful guard controls, with actual owned socket counts | exit 0, 7 PASS / 0 FAIL | `final-controls.json`, `final-controls.log` |
| Final complete direct CPU run, executable/test hashes identical before and after | exit 0, 35 PASS / 0 FAIL (9 acceptance, 26 M2 including 2 cleanup subtests) | `app-cpu-final.json`, `app-cpu-final.log` |
| Protected source and frozen artifacts against base | all unchanged | `scope-invariants.json` |

The failed first complete attempt is retained. Its accidental extra import was
removed from the embedded restart script; that original new-process contract
and bytes are preserved. The real relay import is after the canonical isolation
bootstrap. This creates no additional database-reachable root test or suite.

The 7 focused cases include a complete response, downstream response close,
explicit cleanup of both inner and parent, and aborted upload. Logs observe one
actual closed upstream socket and zero active requests for cancellation/drain;
the aborted upload also observes the parent-hop socket close, zero upstream
generations and zero model callbacks. These are controlled CPU HTTP fixtures,
with no Ollama, provider/model, GPU, CHAT, browser or production DB/service call.

Final complete CPU log SHA-256:
`04ce0cea596e588352defc0338e75b3e065159ffe27c99db37757472fc8eaa03`.
The tested executable/test hashes are pinned in `app-cpu-final.json`; they must
match the committed candidate bytes. Product `src/`, contracts, registry and
projection remain unchanged. Both frozen oracle/helper files and public
blueprints retain their exact base bytes. Historical physical PASS remain
separate, and no new physical/live or release acceptance is asserted.

ROOT performs independent review, the two-field M2 descriptor/projection update
and the exact-candidate registered combined gate before integration/push.
