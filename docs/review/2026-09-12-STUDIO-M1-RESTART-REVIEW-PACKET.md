# Studio M1: startup HTTP before deliberate listener restart

Status: IMPLEMENTATION_VERIFIED / REVIEW_PENDING. This change stabilizes the
registered verification scenario. Production code, shipped UI, network policy,
backend fixture, dependency locks and registry membership are unchanged.

Source range: `055b23967c1ed22bb04f88894be8e0591b24338e..1a6645aad92d8a93a4726e9dfc4776de1e32aa24`.
WP: `docs/wp/WP-STUDIO-M1-RESTART-20260912.md`.

The M1 runner previously treated WebSocket negotiation as startup readiness.
The shipped UI separately starts its list requests after 1500 ms and its API
health request after 2000 ms; the latter can enqueue another project lookup.
The runner could intentionally stop the listener while these requests were
being dispatched. Waiting only for the five lists moved the collision to the
health request in the controlled follow-up experiment.

The final runner waits for all seven HTTP families already required by the M1
policy, complete wire headers/responses for every observed GET in those families,
and the existing 750ms quiescence condition. It rechecks the same capture after
settling, including failed requests and outstanding duplicates. Only then does
it install the lifecycle monitor and execute the existing M1 scenario.
The startup wait uses the existing CDP deadline; settling uses the existing 5s
bound. No registered program timeout, route requirement, 65s observation floor,
terminal/cancel/rehydrate assertion or security policy was weakened.

## Retained counterfactuals

| Probe | Runner base | Result |
|---|---|---|
| Hold five startup GETs, release at actual WS listener disconnect | 630d9ebf | FAIL: five connection refusals; identical final policy failures and failed wire records to historical 71968508 |
| Same five GETs delayed by an independent 200ms timer | original runner, environment pinned a6ef0216 | FAIL: five connection refusals |
| Same 200ms delay, first attempt waiting only for lists | a6ef0216 | FAIL: delayed `/api/health` connection refused |
| Same 200ms delay, complete startup HTTP + settling | 1a6645aa | PASS, strict M1 verdict and full observation preserved |

The injected probes are diagnostic programs copied into ignored artifacts.
Their exact source, SHA256 and diff are retained. They are not registered-suite
acceptance evidence. The paired original/final programs differ only in the
exact new startup helper/call and clock-injectable quiescence helper. The UI,
fixture, policy and 200ms fault input are the same.

The final delayed run observed the five responses at 2109–2112 ms, a subsequent
project lookup finishing at 2408 ms, and the restart request at 3884 ms. The
counterfactual restarted before releasing the delayed batch and immediately
recorded connection refusals. No capability, raw header or arbitrary Chromium
error text is present in the timing trace.

This proves and remedies the reproduced sequencing race. Historical 71968508
lacked timing/error classification, so attribution of that original run remains
uncertain even though its entire failure signature matches. It is not relabelled
PASS. Both the original failed capture and all three new failing experiments
remain available.

## Verification and limits

The focused runner contract has 27 checks, including six new cases for delayed
complete wire evidence, outstanding follow-up requests, missing wire information,
bounded waiting, late failure, cancellation, HTTP failure and failure followed
by success. The existing CDP reducer has 63 passing checks. Earlier focused runs
were development evidence; the final whole profile revalidates the committed tests.

Built Electron on 1a6645aa: composer DOM, M0 and M1 all PASS in one serial sequence,
plus the separate delayed diagnostic PASS. Every probe has a private loopback
namespace and Xvfb, hidden GPU devices, isolated backend state and clean shutdown.
The frontend bundle remains
`8fee233175ff7bc2b2f4bb5b98778c740c3c6720649119e1c20c4fdbd632ad69`.
The M1 backend is controlled; this is not a physical model journey or fresh-clone
release build proof. The previous hunt/HTTP evidence retains its own exact pin.

Required offline/database profile on `1a6645aad92d8a93a4726e9dfc4776de1e32aa24`: **353 PASS / 0 FAIL / 0 TIMEOUT / 0 BLOCKED / 0 SKIPPED**.
Report: `.intentsmith-artifacts/audit/studio-m1-restart-20260912-01/report.json`.
SHA256: `8d402624e30f9f9297a050a4bdd557c15d4edcec898fc87e79fa7b15da49259a`. Registry remains 516 programs with fingerprint
`162b890b97142127fdd4859bc48a02056a837b3fd2773e26d8a130e0e55f4deb`.
Later handoff changes are documentation only; the manifest verifies byte parity
with this tested source. All failed diagnostics remain outside this PASS count.

## Review and handoff

Review `tests/studio-electron-boundary.e2e.js` and
`tests/studio-electron-runner-contract.test.js`, plus the exact diagnostic diffs.
`source-parity.json` proves unchanged production/UI/policy/fixture/registry bytes.
Current status is recorded in ROADMAP, SYSTEM-MAP and inventory #21.
The local handoff is `.intentsmith-artifacts/studio-m1-restart-review-20260912/`:
source.bundle, manifest.json, evidence.tar.gz and handoff.json. All archived
members and their files on disk are checked by SHA256. Private DB/HOME/profiles,
Xauthority and raw provider/Electron logs are excluded.

Independent review, the complete physical Studio → production server → durable
binding → model → preview → approval → execution → process restart journey,
fresh-install/restore qualification and external M5/M6 acceptance remain separate.
No live hunt, service, model, binding, operator key or foreign checkout was changed.
