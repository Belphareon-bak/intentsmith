# P9 — dlouhohorizontový outbound scan

**Typ:** dvoufázový evidence WP; A zapisuje runner, B provede 26h měření
**Stav:** BLOCKED_UNTIL_M2_NETWORK_EFFECT
**Phase A base:** přijatý post-M2 outbound checkpoint
**Phase B measurement revision:** aktuální integration tip obsahující A merge;
přesné SHA zaznamená run report
**Adresát:** vlastník `WP-M5-OBSERVE`

## 1. Výsledek

Na jednom připnutém post-M2 SHA změří defaultní produkt pod blokující OS-level
instrumentací nejméně 26 hodin. Výsledek pokryje 5min polling i celý 24h cyklus
včetně jeho ±90min rozptylu a pravdivě uvede každý pokus nebo nulu.

Sonda nereviduje call-site census a není sama L0-12 PASS.

## 2. Vlastněné a zakázané cesty

- fáze A: `scripts/outbound-long-horizon-probe.mjs`,
  `tests/outbound-long-horizon-probe.test.js`,
  `tests/fixtures/outbound-long-horizon/**`, nový registry entry a branch-local
  `docs/convergence/TEST-REGISTRY.md`;
- run report: `docs/execution/runs/p9-outbound-long-horizon-report.md`; A subject
  jej nemění a jeho `E_A`/`E_B` připnou A subject/candidate reviews; po raw
  měření report-only B subject doplní measurement data a dostane vlastní obálky;
- fáze B: raw DB/log/JSON/pcap manifest v izolovaném `<artifact-root>`;
- zakázané všechny `src/**`, ostatní testy/scripts, config/authority docs,
  existující registry entries a druhý finding/report.

Oba subjecty a jejich obálky spotřebují writer slot; raw 26h měření ne. Běh má
vlastní checkout/runtime root a nesdílí DB, port ani provider s jiným měřením.
Report drží dvě oddělené provenance sady:

```text
phaseA.integrationRef / baseRevision / subjectHead
phaseA.reviewA.verdict / candidateHead / reviewB.verdict
phaseB.integrationRef / reportBaseRevision / measurementRevision
phaseB.measurementTree / runnerBlob / rawDigest / subjectHead
phaseB.reviewA.verdict / candidateHead / reviewB.verdict
```

Registry rezervace: `IS-T1-TESTS-OUTBOUND-LONG-HORIZON-PROBE-TEST`, path/argv
`tests/outbound-long-horizon-probe.test.js`, capability `C3-027`, `T1/offline`,
fixture `isolated-home`, timeout/expected `120000/20000`, requirements
`{network:none, database:false, server:false, ollama:false, gpu:false}`,
`required:true`, owner `P9-OUTBOUND-LONG-HORIZON`, `state:ACTIVE`,
`lastGreen:{commit:null,artifact:null}`, `flakeCount:0`,
`quarantineExpiry:null`.

## 3. Connector

Žádný se nemění. Sonda pozoruje přijatý canonical `network.request` a zbytkové
OS spojovací pokusy. Telemetry sama nestačí.

## 4. Vstup a závislosti

- hard dependency: M1 accepted, `WP-M2-EFFECT` a outbound consumer integrovány;
- každá zapisující fáze se aktivuje z pojmenovaného `integration/<batch>` refu,
  exact base zapíše do reportu a používá vlastní branch/worktree;
- fáze A začne hned po přijetí outbound consumeru, implementuje pouze runner,
  test/fixture/registry a projde Review A + merge queue; nečeká na M5;
- fáze B větví z aktuálního přijatého integration tipu, který obsahuje A merge;
  neběží na pre-A outbound SHA;
- test-owned fake loopback Ollama provider obslouží startup i periodické
  `/api/ps`, `/api/show` a `/api/tags`; sonda netvrdí, že Ollamu „nechá být“;
- external network je blokovaná a pouze logovaná, nikdy povolená;
- první 26h běh může překrýt M3/M4; opakuje se na release candidate, pokud se
  po něm změní relevantní runtime strom.

Runner před i po každém běhu fail-closed ověří čistý strom a
`git rev-parse HEAD == --source-revision`; report uloží measurement commit,
`HEAD^{tree}` a blob runneru.

## 5. Malá demonstrace

Nejdřív proběhnou dvě oddělené kontroly:

1. **OS canary mimo produktový broker** provede z test-owned child procesu jeden
   pokus na pevný veřejný TEST-NET cíl. Instrumentace jej musí zachytit a
   zablokovat; žádný external success není povolen.
2. **Broker canary** použije exact single-use test grant pro test-owned loopback
   target a prokáže allow + intent/outcome audit bez externí sítě.

Defaultní 26h produkt pak běží bez outbound grantů. Canonical broker deny se
očekává před DNS; OS-level nula je platná jen proto, že samostatný OS canary
prokázal funkční měřidlo.

```text
os-canary:        observedBlockedAttempts = 1, externalSuccesses = 0
broker-canary:    exact loopback grant consumed once, paired audit
default-26h:      úplný časový interval + každý attempt nebo přesná nula
```

Bez obou canary kontrol je nulový výsledek neplatný.

## 6. Focused pozitivní a negativní důkaz

Runner pinuje source SHA, monotonic start/end, wall-clock duration, environment,
fake-provider transcript, instrumentaci a digest raw logu. Zaznamená čas,
canonical destination, resolved address, callsite pokud je dostupný a gate.

Negativně se ověří:

- instrumentace blokuje external, ale dovolí pouze test-owned loopback;
- fake provider skutečně obdržel očekávané poll requesty;
- restart, log rotation ani clock adjustment nevytvoří mezeru;
- kratší nebo přerušený běh se označí `PARTIAL/NOT RUN`, nikdy PASS;
- OS canary bez právě jednoho zachyceného pokusu nebo broker canary bez exact
  grant/auditu shodí celý běh.

## 7. Stop / eskalace

- **FINDING:** neznámý outbound attempt je řádek reportu s raw důkazem; sonda
  jej neopravuje.
- **BLOCK:** instrumentace, fake provider nebo artifact persistence selže.
- **PARK:** dostupné okno je kratší; report uvede přesnou délku a nepokryté
  schedulery, ale nevytvoří production claim.

## 8. Reprodukce a přijetí

```bash
set -euo pipefail

IS_P9_A_BASE=<full-accepted-post-m2-outbound-sha>
IS_P9_A_ALLOWED='^(scripts/outbound-long-horizon-probe\.mjs|tests/outbound-long-horizon-probe\.test\.js|tests/fixtures/outbound-long-horizon/.*|tests/registry\.json|docs/convergence/TEST-REGISTRY\.md)$'
test "$(git merge-base "$IS_P9_A_BASE" HEAD)" = "$IS_P9_A_BASE"
IS_P9_A_SUBJECT=$(git rev-parse --verify HEAD)
node -e "if (Number(process.versions.node.split('.')[0]) !== 22) process.exit(1)"
test "$(npm --version)" = "10.9.4"
npm ci --offline
test -d node_modules
test -z "$(git status --porcelain=v1 --untracked-files=all)"
node tests/outbound-long-horizon-probe.test.js
node scripts/validate-test-registry.js
C3_LOG_LEVEL=error node tests/repository-hygiene.test.js
node scripts/module-boundary-ratchet.mjs
git diff --no-renames --name-only "$IS_P9_A_BASE"...HEAD |
  awk -v allowed="$IS_P9_A_ALLOWED" '$0 !~ allowed { print "OUT_OF_SCOPE " $0; bad=1 } END { exit bad }'
git diff --check "$IS_P9_A_BASE"...HEAD
test "$(git rev-parse --verify HEAD)" = "$IS_P9_A_SUBJECT"
test -z "$(git status --porcelain=v1 --untracked-files=all)"
```

```bash
set -euo pipefail

IS_P9_A_BASE=<full-accepted-post-m2-outbound-sha>
IS_P9_A_SUBJECT=<full-phase-a-reviewed-subject-head>
IS_P9_REPORT='docs/execution/runs/p9-outbound-long-horizon-report.md'
IS_P9_A_INTEGRATION_REF=<canonical-phase-a-integration-ref>
IS_P9_A_EA=<full-phase-a-review-a-evidence-head>
IS_P9_A_C=<full-phase-a-reviewed-candidate-head>
IS_P9_A_EB=<full-phase-a-review-b-evidence-head>
assert_one_report_key() {
  local IS_REPORT_HEAD="$1" IS_REPORT_PATH="$2" IS_REPORT_KEY="$3"
  test "$(git show "$IS_REPORT_HEAD:$IS_REPORT_PATH" | awk -v prefix="$IS_REPORT_KEY:" 'index($0, prefix) == 1 { n++ } END { print n + 0 }')" -eq 1
}
assert_report_absent() {
  local IS_REPORT_ENTRY
  IS_REPORT_ENTRY=$(git ls-tree "$1" -- "$2") || return 1
  test -z "$IS_REPORT_ENTRY"
}
assert_report_blob() {
  local IS_REPORT_ENTRY IS_REPORT_MODE_TYPE
  IS_REPORT_ENTRY=$(git ls-tree "$1" -- "$2") || return 1
  IS_REPORT_MODE_TYPE=$(awk 'NF { n++; mode=$1; type=$2 } END { print n ":" mode ":" type }' <<<"$IS_REPORT_ENTRY") || return 1
  test "$IS_REPORT_MODE_TYPE" = '1:100644:blob'
}
assert_report_same() {
  local IS_LEFT_REPORT_BLOB IS_RIGHT_REPORT_BLOB
  assert_report_blob "$1" "$3" || return 1
  assert_report_blob "$2" "$3" || return 1
  IS_LEFT_REPORT_BLOB=$(git rev-parse "$1:$3") || return 1
  IS_RIGHT_REPORT_BLOB=$(git rev-parse "$2:$3") || return 1
  test "$IS_LEFT_REPORT_BLOB" = "$IS_RIGHT_REPORT_BLOB"
}
assert_report_append() {
  assert_report_blob "$1" "$3" || return 1
  assert_report_blob "$2" "$3" || return 1
  node -e '
    const { execFileSync } = require("node:child_process");
    const [parent, head, path, ...lines] = process.argv.slice(1);
    const before = execFileSync("git", ["show", `${parent}:${path}`]);
    const after = execFileSync("git", ["show", `${head}:${path}`]);
    if (before.length === 0 || before[before.length - 1] !== 10) process.exit(1);
    const expected = Buffer.concat([before, Buffer.from(`${lines.join("\n")}\n`)]);
    if (!expected.equals(after)) process.exit(1);
  ' "$@"
}
assert_report_absent "$IS_P9_A_SUBJECT" "$IS_P9_REPORT"
test "$(git rev-list --parents -n 1 "$IS_P9_A_EA" | wc -w)" -eq 2
test "$(git rev-parse "$IS_P9_A_EA^")" = "$IS_P9_A_SUBJECT"
test "$(git diff --no-renames --name-only "$IS_P9_A_SUBJECT" "$IS_P9_A_EA")" = "$IS_P9_REPORT"
test "$(git show "$IS_P9_A_EA:$IS_P9_REPORT" | rg -Fxc "phaseA.integrationRef: $IS_P9_A_INTEGRATION_REF")" -eq 1
test "$(git show "$IS_P9_A_EA:$IS_P9_REPORT" | rg -Fxc "phaseA.baseRevision: $IS_P9_A_BASE")" -eq 1
test "$(git show "$IS_P9_A_EA:$IS_P9_REPORT" | rg -Fxc "phaseA.subjectHead: $IS_P9_A_SUBJECT")" -eq 1
test "$(git show "$IS_P9_A_EA:$IS_P9_REPORT" | rg -Fxc 'phaseA.reviewA.verdict: PASS')" -eq 1
IS_P9_A_EA_REPORT=$(git show "$IS_P9_A_EA:$IS_P9_REPORT")
if rg -q '^phaseA\.(candidateHead|reviewB\.verdict):' <<<"$IS_P9_A_EA_REPORT"; then
  printf '%s\n' 'forbidden Phase A Review B field in P9 A_EA' >&2
  exit 1
else
  IS_P9_A_FORBIDDEN_STATUS=$?
  test "$IS_P9_A_FORBIDDEN_STATUS" -eq 1
fi
git merge-base --is-ancestor "$IS_P9_A_EA" "$IS_P9_A_C"
assert_report_same "$IS_P9_A_EA" "$IS_P9_A_C" "$IS_P9_REPORT"
test "$(git rev-list --parents -n 1 "$IS_P9_A_EB" | wc -w)" -eq 2
test "$(git rev-parse "$IS_P9_A_EB^")" = "$IS_P9_A_C"
test "$(git diff --no-renames --name-only "$IS_P9_A_C" "$IS_P9_A_EB")" = "$IS_P9_REPORT"
assert_report_append "$IS_P9_A_C" "$IS_P9_A_EB" "$IS_P9_REPORT" \
  "phaseA.candidateHead: $IS_P9_A_C" 'phaseA.reviewB.verdict: PASS'
test "$(git show "$IS_P9_A_EB:$IS_P9_REPORT" | rg -Fxc "phaseA.candidateHead: $IS_P9_A_C")" -eq 1
test "$(git show "$IS_P9_A_EB:$IS_P9_REPORT" | rg -Fxc 'phaseA.reviewB.verdict: PASS')" -eq 1
test "$(git show "$IS_P9_A_EB:$IS_P9_REPORT" | rg -Fxc "phaseA.integrationRef: $IS_P9_A_INTEGRATION_REF")" -eq 1
test "$(git show "$IS_P9_A_EB:$IS_P9_REPORT" | rg -Fxc "phaseA.baseRevision: $IS_P9_A_BASE")" -eq 1
test "$(git show "$IS_P9_A_EB:$IS_P9_REPORT" | rg -Fxc "phaseA.subjectHead: $IS_P9_A_SUBJECT")" -eq 1
test "$(git show "$IS_P9_A_EB:$IS_P9_REPORT" | rg -Fxc 'phaseA.reviewA.verdict: PASS')" -eq 1
for IS_P9_KEY in phaseA.integrationRef phaseA.baseRevision phaseA.subjectHead phaseA.reviewA.verdict; do
  assert_one_report_key "$IS_P9_A_EA" "$IS_P9_REPORT" "$IS_P9_KEY" || exit 1
done
for IS_P9_KEY in phaseA.integrationRef phaseA.baseRevision phaseA.subjectHead phaseA.reviewA.verdict phaseA.candidateHead phaseA.reviewB.verdict; do
  assert_one_report_key "$IS_P9_A_EB" "$IS_P9_REPORT" "$IS_P9_KEY" || exit 1
done
git diff --check "$IS_P9_A_SUBJECT" "$IS_P9_A_EA"
git diff --check "$IS_P9_A_C" "$IS_P9_A_EB"
```

Po přijetí fáze A běží fáze B:

```bash
set -euo pipefail

IS_P9_MEASUREMENT=<full-accepted-p9-measurement-sha>
IS_P9_ARTIFACT_ROOT=<absolute-isolated-artifact-root>
test "$(git rev-parse HEAD)" = "$IS_P9_MEASUREMENT"
test -z "$(git status --porcelain=v1 --untracked-files=all)"
node -e "if (Number(process.versions.node.split('.')[0]) !== 22) process.exit(1)"
test "$(npm --version)" = "10.9.4"
npm ci --offline
test -d node_modules
test -z "$(git status --porcelain=v1 --untracked-files=all)"
node scripts/outbound-long-horizon-probe.mjs \
  --mode os-canary \
  --target 203.0.113.1:9 \
  --artifact-root "$IS_P9_ARTIFACT_ROOT/os-canary" \
  --source-revision "$IS_P9_MEASUREMENT"
node scripts/outbound-long-horizon-probe.mjs \
  --mode broker-canary \
  --artifact-root "$IS_P9_ARTIFACT_ROOT/broker-canary" \
  --source-revision "$IS_P9_MEASUREMENT"
node scripts/outbound-long-horizon-probe.mjs \
  --mode default \
  --duration-ms 93600000 \
  --artifact-root "$IS_P9_ARTIFACT_ROOT/default" \
  --source-revision "$IS_P9_MEASUREMENT"
node scripts/outbound-long-horizon-probe.mjs \
  --mode finalize \
  --artifact-root "$IS_P9_ARTIFACT_ROOT" \
  --source-revision "$IS_P9_MEASUREMENT"
IS_P9_MEASUREMENT_TREE=$(git rev-parse "$IS_P9_MEASUREMENT^{tree}")
IS_P9_RUNNER_BLOB=$(git rev-parse "$IS_P9_MEASUREMENT:scripts/outbound-long-horizon-probe.mjs")
IS_P9_RAW_MANIFEST="$IS_P9_ARTIFACT_ROOT/manifest.json"
test -f "$IS_P9_RAW_MANIFEST"
IS_P9_RAW_DIGEST=$(sha256sum "$IS_P9_RAW_MANIFEST" | awk '{ print $1 }')
rg -q '^[0-9a-f]{64}$' <<<"$IS_P9_RAW_DIGEST"
printf 'measurementTree=%s\nrunnerBlob=%s\nrawDigest=%s\n' \
  "$IS_P9_MEASUREMENT_TREE" "$IS_P9_RUNNER_BLOB" "$IS_P9_RAW_DIGEST"
test "$(git rev-parse HEAD)" = "$IS_P9_MEASUREMENT"
test -z "$(git status --porcelain=v1 --untracked-files=all)"
```

Všechny čtyři runner exity musí být `0`; 93 600 000 ms je 26 hodin. `finalize`
nesmí otevřít síť; ověří tři dokončené submanifesty a atomicky vytvoří právě
`<artifact-root>/manifest.json` s jejich digesty. Report musí uvést přesné okno,
obě canary kontroly, pokryté schedulery a vše, co zůstalo nepokryté. Broker
canary si sám založí test-owned loopback server a exact grant;
`203.0.113.1:9` je pouze dokumentační TEST-NET cíl a OS rail jej musí
zablokovat před úspěšným spojením.

Report-only B subject vznikne **přímo** z measurement SHA a do novějšího tipu
vstoupí až přes candidate `C`. Relevantní runtime delta před release claimem
vynutí nové měření. Scope gate:

```bash
set -euo pipefail

IS_P9_B_REPORT_BASE=<full-phase-b-report-base-sha>
IS_P9_B_INTEGRATION_REF=<canonical-phase-b-integration-ref>
IS_P9_A_EB=<full-accepted-phase-a-review-b-evidence-head>
IS_P9_A_INTEGRATION_REF=<canonical-phase-a-integration-ref>
IS_P9_A_BASE=<full-phase-a-base-sha>
IS_P9_A_SUBJECT=<full-phase-a-reviewed-subject-head>
IS_P9_A_C=<full-phase-a-reviewed-candidate-head>
IS_P9_MEASUREMENT=<full-accepted-p9-measurement-sha>
IS_P9_MEASUREMENT_TREE=<full-measurement-tree-sha>
IS_P9_RUNNER_BLOB=<full-runner-blob-sha>
IS_P9_RAW_DIGEST=<raw-manifest-sha256>
IS_P9_REPORT='docs/execution/runs/p9-outbound-long-horizon-report.md'
IS_P9_B_REPORT_ALLOWED='^docs/execution/runs/p9-outbound-long-horizon-report\.md$'
assert_report_blob() {
  local IS_REPORT_ENTRY IS_REPORT_MODE_TYPE
  IS_REPORT_ENTRY=$(git ls-tree "$1" -- "$2") || return 1
  IS_REPORT_MODE_TYPE=$(awk 'NF { n++; mode=$1; type=$2 } END { print n ":" mode ":" type }' <<<"$IS_REPORT_ENTRY") || return 1
  test "$IS_REPORT_MODE_TYPE" = '1:100644:blob'
}
assert_report_same() {
  local IS_LEFT_REPORT_BLOB IS_RIGHT_REPORT_BLOB
  assert_report_blob "$1" "$3" || return 1
  assert_report_blob "$2" "$3" || return 1
  IS_LEFT_REPORT_BLOB=$(git rev-parse "$1:$3") || return 1
  IS_RIGHT_REPORT_BLOB=$(git rev-parse "$2:$3") || return 1
  test "$IS_LEFT_REPORT_BLOB" = "$IS_RIGHT_REPORT_BLOB"
}
assert_report_extension() {
  assert_report_blob "$1" "$3" || return 1
  assert_report_blob "$2" "$3" || return 1
  node -e '
    const { execFileSync } = require("node:child_process");
    const [parent, head, path, ...lines] = process.argv.slice(1);
    const before = execFileSync("git", ["show", `${parent}:${path}`]);
    const after = execFileSync("git", ["show", `${head}:${path}`]);
    const suffix = Buffer.from(`${lines.join("\n")}\n`);
    if (before.length === 0 || before[before.length - 1] !== 10) process.exit(1);
    if (after.length <= before.length + suffix.length || after[after.length - 1] !== 10) process.exit(1);
    if (!after.subarray(0, before.length).equals(before)) process.exit(1);
    if (!after.subarray(after.length - suffix.length).equals(suffix)) process.exit(1);
    const payload = after.subarray(before.length, after.length - suffix.length);
    const payloadText = payload.toString("utf8");
    if (payload[payload.length - 1] !== 10 || !/[^\s]/u.test(payloadText)) process.exit(1);
    if (/(^|\n)[ \t]*phase[AB]\./u.test(payloadText)) process.exit(1);
  ' "$@"
}
test "$IS_P9_B_REPORT_BASE" = "$IS_P9_MEASUREMENT"
git merge-base --is-ancestor "$IS_P9_A_EB" "$IS_P9_B_REPORT_BASE"
assert_report_same "$IS_P9_A_EB" "$IS_P9_B_REPORT_BASE" "$IS_P9_REPORT"
test "$IS_P9_MEASUREMENT_TREE" = "$(git rev-parse "$IS_P9_MEASUREMENT^{tree}")"
test "$IS_P9_RUNNER_BLOB" = "$(git rev-parse "$IS_P9_MEASUREMENT:scripts/outbound-long-horizon-probe.mjs")"
rg -q '^[0-9a-f]{64}$' <<<"$IS_P9_RAW_DIGEST"
test "$(git merge-base "$IS_P9_B_REPORT_BASE" HEAD)" = "$IS_P9_B_REPORT_BASE"
IS_P9_B_SUBJECT=$(git rev-parse --verify HEAD)
test "$(git rev-list --parents -n 1 "$IS_P9_B_SUBJECT" | wc -w)" -eq 2
test "$(git rev-parse "$IS_P9_B_SUBJECT^")" = "$IS_P9_B_REPORT_BASE"
assert_report_extension "$IS_P9_B_REPORT_BASE" "$IS_P9_B_SUBJECT" "$IS_P9_REPORT" \
  "phaseB.integrationRef: $IS_P9_B_INTEGRATION_REF" \
  "phaseB.reportBaseRevision: $IS_P9_B_REPORT_BASE" \
  "phaseB.measurementRevision: $IS_P9_MEASUREMENT" \
  "phaseB.measurementTree: $IS_P9_MEASUREMENT_TREE" \
  "phaseB.runnerBlob: $IS_P9_RUNNER_BLOB" \
  "phaseB.rawDigest: $IS_P9_RAW_DIGEST"
test -z "$(git status --porcelain=v1 --untracked-files=all)"
git diff --no-renames --name-only "$IS_P9_B_REPORT_BASE"...HEAD |
  awk -v allowed="$IS_P9_B_REPORT_ALLOWED" '$0 !~ allowed { print "OUT_OF_SCOPE " $0; bad=1 } END { exit bad }'
git diff --check "$IS_P9_B_REPORT_BASE"...HEAD
IS_P9_B_SUBJECT_REPORT=$(git show "$IS_P9_B_SUBJECT:$IS_P9_REPORT")
assert_p9_b_subject_key() {
  local IS_KEY="$1" IS_EXPECTED="$2"
  test "$(awk -v prefix="$IS_KEY:" 'index($0, prefix) == 1 { n++ } END { print n + 0 }' <<<"$IS_P9_B_SUBJECT_REPORT")" -eq 1 || return 1
  test "$(rg -Fxc "$IS_KEY: $IS_EXPECTED" <<<"$IS_P9_B_SUBJECT_REPORT")" -eq 1 || return 1
}
assert_p9_b_subject_key phaseA.integrationRef "$IS_P9_A_INTEGRATION_REF" || exit 1
assert_p9_b_subject_key phaseA.baseRevision "$IS_P9_A_BASE" || exit 1
assert_p9_b_subject_key phaseA.subjectHead "$IS_P9_A_SUBJECT" || exit 1
assert_p9_b_subject_key phaseA.reviewA.verdict PASS || exit 1
assert_p9_b_subject_key phaseA.candidateHead "$IS_P9_A_C" || exit 1
assert_p9_b_subject_key phaseA.reviewB.verdict PASS || exit 1
assert_p9_b_subject_key phaseB.integrationRef "$IS_P9_B_INTEGRATION_REF" || exit 1
assert_p9_b_subject_key phaseB.reportBaseRevision "$IS_P9_B_REPORT_BASE" || exit 1
assert_p9_b_subject_key phaseB.measurementRevision "$IS_P9_MEASUREMENT" || exit 1
assert_p9_b_subject_key phaseB.measurementTree "$IS_P9_MEASUREMENT_TREE" || exit 1
assert_p9_b_subject_key phaseB.runnerBlob "$IS_P9_RUNNER_BLOB" || exit 1
assert_p9_b_subject_key phaseB.rawDigest "$IS_P9_RAW_DIGEST" || exit 1
if rg -q '^phaseB\.(subjectHead|reviewA\.verdict|candidateHead|reviewB\.verdict):' \
  <<<"$IS_P9_B_SUBJECT_REPORT"; then
  printf '%s\n' 'forbidden self-reference field in P9 Phase B subject' >&2
  exit 1
else
  IS_P9_B_SUBJECT_FORBIDDEN_STATUS=$?
  test "$IS_P9_B_SUBJECT_FORBIDDEN_STATUS" -eq 1
fi
```

B subject zachová přijatý Phase A report jako byte prefix, přidá neprázdný
měřený payload a zakončí jej exact-once measurement provenance; Review A tak
váže celý nový payload. Payload nesmí obsahovat line-start `phaseA.` ani
`phaseB.`; tento namespace patří jen exact provenance a evidence. Subject
neobsahuje vlastní SHA ani review. Z
normativních Phase B polí smí `E_A` přidat pouze `phaseB.subjectHead` a
`phaseB.reviewA.verdict`; nesmí poprvé zapsat ani opravit měřená fakta.

```bash
set -euo pipefail

IS_P9_B_REPORT_BASE=<full-phase-b-report-base-sha>
IS_P9_B_INTEGRATION_REF=<canonical-phase-b-integration-ref>
IS_P9_A_EB=<full-accepted-phase-a-review-b-evidence-head>
IS_P9_A_INTEGRATION_REF=<canonical-phase-a-integration-ref>
IS_P9_A_BASE=<full-phase-a-base-sha>
IS_P9_A_SUBJECT=<full-phase-a-reviewed-subject-head>
IS_P9_A_C=<full-phase-a-reviewed-candidate-head>
IS_P9_MEASUREMENT=<full-accepted-p9-measurement-sha>
IS_P9_MEASUREMENT_TREE=<full-measurement-tree-sha>
IS_P9_RUNNER_BLOB=<full-runner-blob-sha>
IS_P9_RAW_MANIFEST=<absolute-isolated-artifact-root>/manifest.json
IS_P9_RAW_DIGEST=<raw-manifest-sha256>
IS_P9_REPORT='docs/execution/runs/p9-outbound-long-horizon-report.md'
IS_P9_B_SUBJECT=<full-phase-b-reviewed-subject-head>
IS_P9_B_EA=<full-phase-b-review-a-evidence-head>
IS_P9_B_C=<full-phase-b-reviewed-candidate-head>
IS_P9_B_EB=<full-phase-b-review-b-evidence-head>
assert_one_report_key() {
  local IS_REPORT_HEAD="$1" IS_REPORT_PATH="$2" IS_REPORT_KEY="$3"
  test "$(git show "$IS_REPORT_HEAD:$IS_REPORT_PATH" | awk -v prefix="$IS_REPORT_KEY:" 'index($0, prefix) == 1 { n++ } END { print n + 0 }')" -eq 1
}
assert_report_blob() {
  local IS_REPORT_ENTRY IS_REPORT_MODE_TYPE
  IS_REPORT_ENTRY=$(git ls-tree "$1" -- "$2") || return 1
  IS_REPORT_MODE_TYPE=$(awk 'NF { n++; mode=$1; type=$2 } END { print n ":" mode ":" type }' <<<"$IS_REPORT_ENTRY") || return 1
  test "$IS_REPORT_MODE_TYPE" = '1:100644:blob'
}
assert_report_same() {
  local IS_LEFT_REPORT_BLOB IS_RIGHT_REPORT_BLOB
  assert_report_blob "$1" "$3" || return 1
  assert_report_blob "$2" "$3" || return 1
  IS_LEFT_REPORT_BLOB=$(git rev-parse "$1:$3") || return 1
  IS_RIGHT_REPORT_BLOB=$(git rev-parse "$2:$3") || return 1
  test "$IS_LEFT_REPORT_BLOB" = "$IS_RIGHT_REPORT_BLOB"
}
assert_report_append() {
  assert_report_blob "$1" "$3" || return 1
  assert_report_blob "$2" "$3" || return 1
  node -e '
    const { execFileSync } = require("node:child_process");
    const [parent, head, path, ...lines] = process.argv.slice(1);
    const before = execFileSync("git", ["show", `${parent}:${path}`]);
    const after = execFileSync("git", ["show", `${head}:${path}`]);
    if (before.length === 0 || before[before.length - 1] !== 10) process.exit(1);
    const expected = Buffer.concat([before, Buffer.from(`${lines.join("\n")}\n`)]);
    if (!expected.equals(after)) process.exit(1);
  ' "$@"
}
assert_report_extension() {
  assert_report_blob "$1" "$3" || return 1
  assert_report_blob "$2" "$3" || return 1
  node -e '
    const { execFileSync } = require("node:child_process");
    const [parent, head, path, ...lines] = process.argv.slice(1);
    const before = execFileSync("git", ["show", `${parent}:${path}`]);
    const after = execFileSync("git", ["show", `${head}:${path}`]);
    const suffix = Buffer.from(`${lines.join("\n")}\n`);
    if (before.length === 0 || before[before.length - 1] !== 10) process.exit(1);
    if (after.length <= before.length + suffix.length || after[after.length - 1] !== 10) process.exit(1);
    if (!after.subarray(0, before.length).equals(before)) process.exit(1);
    if (!after.subarray(after.length - suffix.length).equals(suffix)) process.exit(1);
    const payload = after.subarray(before.length, after.length - suffix.length);
    const payloadText = payload.toString("utf8");
    if (payload[payload.length - 1] !== 10 || !/[^\s]/u.test(payloadText)) process.exit(1);
    if (/(^|\n)[ \t]*phase[AB]\./u.test(payloadText)) process.exit(1);
  ' "$@"
}
verify_phase_a_keys() {
  local IS_REPORT_HEAD="$1"
  test "$(git show "$IS_REPORT_HEAD:$IS_P9_REPORT" | rg -Fxc "phaseA.integrationRef: $IS_P9_A_INTEGRATION_REF")" -eq 1 || return 1
  test "$(git show "$IS_REPORT_HEAD:$IS_P9_REPORT" | rg -Fxc "phaseA.baseRevision: $IS_P9_A_BASE")" -eq 1 || return 1
  test "$(git show "$IS_REPORT_HEAD:$IS_P9_REPORT" | rg -Fxc "phaseA.subjectHead: $IS_P9_A_SUBJECT")" -eq 1 || return 1
  test "$(git show "$IS_REPORT_HEAD:$IS_P9_REPORT" | rg -Fxc 'phaseA.reviewA.verdict: PASS')" -eq 1 || return 1
  test "$(git show "$IS_REPORT_HEAD:$IS_P9_REPORT" | rg -Fxc "phaseA.candidateHead: $IS_P9_A_C")" -eq 1 || return 1
  test "$(git show "$IS_REPORT_HEAD:$IS_P9_REPORT" | rg -Fxc 'phaseA.reviewB.verdict: PASS')" -eq 1 || return 1
  for IS_P9_KEY in phaseA.integrationRef phaseA.baseRevision phaseA.subjectHead phaseA.reviewA.verdict phaseA.candidateHead phaseA.reviewB.verdict; do
    assert_one_report_key "$IS_REPORT_HEAD" "$IS_P9_REPORT" "$IS_P9_KEY" || return 1
  done
}
test "$IS_P9_B_REPORT_BASE" = "$IS_P9_MEASUREMENT"
git merge-base --is-ancestor "$IS_P9_A_EB" "$IS_P9_B_REPORT_BASE"
assert_report_same "$IS_P9_A_EB" "$IS_P9_B_REPORT_BASE" "$IS_P9_REPORT"
verify_phase_a_keys "$IS_P9_A_EB"
test "$IS_P9_MEASUREMENT_TREE" = "$(git rev-parse "$IS_P9_MEASUREMENT^{tree}")"
test "$IS_P9_RUNNER_BLOB" = "$(git rev-parse "$IS_P9_MEASUREMENT:scripts/outbound-long-horizon-probe.mjs")"
test -f "$IS_P9_RAW_MANIFEST"
test "$IS_P9_RAW_DIGEST" = "$(sha256sum "$IS_P9_RAW_MANIFEST" | awk '{ print $1 }')"
rg -q '^[0-9a-f]{64}$' <<<"$IS_P9_RAW_DIGEST"
test "$(git rev-list --parents -n 1 "$IS_P9_B_SUBJECT" | wc -w)" -eq 2
test "$(git rev-parse "$IS_P9_B_SUBJECT^")" = "$IS_P9_B_REPORT_BASE"
assert_report_extension "$IS_P9_B_REPORT_BASE" "$IS_P9_B_SUBJECT" "$IS_P9_REPORT" \
  "phaseB.integrationRef: $IS_P9_B_INTEGRATION_REF" \
  "phaseB.reportBaseRevision: $IS_P9_B_REPORT_BASE" \
  "phaseB.measurementRevision: $IS_P9_MEASUREMENT" \
  "phaseB.measurementTree: $IS_P9_MEASUREMENT_TREE" \
  "phaseB.runnerBlob: $IS_P9_RUNNER_BLOB" \
  "phaseB.rawDigest: $IS_P9_RAW_DIGEST"
verify_phase_a_keys "$IS_P9_B_SUBJECT"
test "$(git rev-list --parents -n 1 "$IS_P9_B_EA" | wc -w)" -eq 2
test "$(git rev-parse "$IS_P9_B_EA^")" = "$IS_P9_B_SUBJECT"
test "$(git diff --no-renames --name-only "$IS_P9_B_SUBJECT" "$IS_P9_B_EA")" = "$IS_P9_REPORT"
assert_report_append "$IS_P9_B_SUBJECT" "$IS_P9_B_EA" "$IS_P9_REPORT" \
  "phaseB.subjectHead: $IS_P9_B_SUBJECT" 'phaseB.reviewA.verdict: PASS'
verify_phase_a_keys "$IS_P9_B_EA"
test "$(git show "$IS_P9_B_EA:$IS_P9_REPORT" | rg -Fxc "phaseB.integrationRef: $IS_P9_B_INTEGRATION_REF")" -eq 1
test "$(git show "$IS_P9_B_EA:$IS_P9_REPORT" | rg -Fxc "phaseB.reportBaseRevision: $IS_P9_B_REPORT_BASE")" -eq 1
test "$(git show "$IS_P9_B_EA:$IS_P9_REPORT" | rg -Fxc "phaseB.measurementRevision: $IS_P9_MEASUREMENT")" -eq 1
test "$(git show "$IS_P9_B_EA:$IS_P9_REPORT" | rg -Fxc "phaseB.measurementTree: $IS_P9_MEASUREMENT_TREE")" -eq 1
test "$(git show "$IS_P9_B_EA:$IS_P9_REPORT" | rg -Fxc "phaseB.runnerBlob: $IS_P9_RUNNER_BLOB")" -eq 1
test "$(git show "$IS_P9_B_EA:$IS_P9_REPORT" | rg -Fxc "phaseB.rawDigest: $IS_P9_RAW_DIGEST")" -eq 1
test "$(git show "$IS_P9_B_EA:$IS_P9_REPORT" | rg -Fxc "phaseB.subjectHead: $IS_P9_B_SUBJECT")" -eq 1
test "$(git show "$IS_P9_B_EA:$IS_P9_REPORT" | rg -Fxc 'phaseB.reviewA.verdict: PASS')" -eq 1
IS_P9_B_EA_REPORT=$(git show "$IS_P9_B_EA:$IS_P9_REPORT")
if rg -q '^phaseB\.(candidateHead|reviewB\.verdict):' <<<"$IS_P9_B_EA_REPORT"; then
  printf '%s\n' 'forbidden Phase B Review B field in P9 B_EA' >&2
  exit 1
else
  IS_P9_B_FORBIDDEN_STATUS=$?
  test "$IS_P9_B_FORBIDDEN_STATUS" -eq 1
fi
git merge-base --is-ancestor "$IS_P9_B_EA" "$IS_P9_B_C"
assert_report_same "$IS_P9_B_EA" "$IS_P9_B_C" "$IS_P9_REPORT"
test "$(git rev-list --parents -n 1 "$IS_P9_B_EB" | wc -w)" -eq 2
test "$(git rev-parse "$IS_P9_B_EB^")" = "$IS_P9_B_C"
test "$(git diff --no-renames --name-only "$IS_P9_B_C" "$IS_P9_B_EB")" = "$IS_P9_REPORT"
assert_report_append "$IS_P9_B_C" "$IS_P9_B_EB" "$IS_P9_REPORT" \
  "phaseB.candidateHead: $IS_P9_B_C" 'phaseB.reviewB.verdict: PASS'
verify_phase_a_keys "$IS_P9_B_EB"
test "$(git show "$IS_P9_B_EB:$IS_P9_REPORT" | rg -Fxc "phaseB.candidateHead: $IS_P9_B_C")" -eq 1
test "$(git show "$IS_P9_B_EB:$IS_P9_REPORT" | rg -Fxc 'phaseB.reviewB.verdict: PASS')" -eq 1
test "$(git show "$IS_P9_B_EB:$IS_P9_REPORT" | rg -Fxc "phaseB.integrationRef: $IS_P9_B_INTEGRATION_REF")" -eq 1
test "$(git show "$IS_P9_B_EB:$IS_P9_REPORT" | rg -Fxc "phaseB.reportBaseRevision: $IS_P9_B_REPORT_BASE")" -eq 1
test "$(git show "$IS_P9_B_EB:$IS_P9_REPORT" | rg -Fxc "phaseB.measurementRevision: $IS_P9_MEASUREMENT")" -eq 1
test "$(git show "$IS_P9_B_EB:$IS_P9_REPORT" | rg -Fxc "phaseB.measurementTree: $IS_P9_MEASUREMENT_TREE")" -eq 1
test "$(git show "$IS_P9_B_EB:$IS_P9_REPORT" | rg -Fxc "phaseB.runnerBlob: $IS_P9_RUNNER_BLOB")" -eq 1
test "$(git show "$IS_P9_B_EB:$IS_P9_REPORT" | rg -Fxc "phaseB.rawDigest: $IS_P9_RAW_DIGEST")" -eq 1
test "$(git show "$IS_P9_B_EB:$IS_P9_REPORT" | rg -Fxc "phaseB.subjectHead: $IS_P9_B_SUBJECT")" -eq 1
test "$(git show "$IS_P9_B_EB:$IS_P9_REPORT" | rg -Fxc 'phaseB.reviewA.verdict: PASS')" -eq 1
for IS_P9_KEY in phaseB.integrationRef phaseB.reportBaseRevision phaseB.measurementRevision phaseB.measurementTree phaseB.runnerBlob phaseB.rawDigest phaseB.subjectHead phaseB.reviewA.verdict; do
  assert_one_report_key "$IS_P9_B_EA" "$IS_P9_REPORT" "$IS_P9_KEY" || exit 1
done
for IS_P9_KEY in phaseB.integrationRef phaseB.reportBaseRevision phaseB.measurementRevision phaseB.measurementTree phaseB.runnerBlob phaseB.rawDigest phaseB.subjectHead phaseB.reviewA.verdict phaseB.candidateHead phaseB.reviewB.verdict; do
  assert_one_report_key "$IS_P9_B_EB" "$IS_P9_REPORT" "$IS_P9_KEY" || exit 1
done
git diff --check "$IS_P9_B_SUBJECT" "$IS_P9_B_EA"
git diff --check "$IS_P9_B_C" "$IS_P9_B_EB"
```

B subject obsahuje raw výsledek bez self SHA; canonical ref se posune až po
metadata gate příslušného `E_B`.
