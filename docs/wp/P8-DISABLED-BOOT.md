# P8 — disabled-boot a Ollama-less boot sonda

**Typ:** dvoufázový evidence WP; A zapisuje harness, B měří a zapisuje report
**Stav:** PHASE_A_BLOCKED_UNTIL_M1 / PHASE_B_BLOCKED_UNTIL_POST_M2
**Phase A base:** přijatý M1 integrační SHA
**Phase B measurement revision:** aktuální přijatý post-M2 integration tip,
který obsahuje A merge; přesné SHA zaznamená run report
**Adresát:** vlastník `WP-M3-BOUNDARY`

Tato sonda se nespouští nad historickým `0a6bde54`: M1 stále mění composition
root a provider chování. Statický nález zůstává vstupem, nikoli aktuální
runtime evidence.

## 1. Výsledek

Sonda odpoví dvě otázky na jednom připnutém SHA:

1. zmizí vypnutý volitelný modul z routingu, timerů/background jobs, session
   state, pending confirmations, DB zápisů a externích efektů, nebo pouze z UI;
2. nastartuje core s nedostupným providerem a vrátí
   `LLM_PROVIDER_UNAVAILABLE` bez false-success.

Jde o vstup M3 boundary, ne opravu produktu.

## 2. Vlastněné a zakázané cesty

- fáze A: `tests/m3-disabled-boot.test.js`,
  `tests/fixtures/m3-disabled-boot/**`, nový registry entry a branch-local
  `docs/convergence/TEST-REGISTRY.md`;
- run report: `docs/execution/runs/p8-disabled-boot-report.md`; A subject jej
  nemění a jeho `E_A`/`E_B` připnou A subject/candidate reviews; po raw měření
  report-only B subject doplní measurement data a dostane vlastní obálky;
- fáze B: raw artifacty v izolovaném externím `<artifact-root>`;
- zakázané: všechny `src/**`, ostatní testy, config, authority docs, existující
  registry entries a další tracked výstupy.

Oba subjecty a jejich reportové obálky spotřebují writer slot. Samotný raw běh
ne, ale vytváří DB, logy a handles, proto nesmí sdílet checkout ani runtime
root s writerem.
Report drží dvě oddělené provenance sady:

```text
phaseA.integrationRef / baseRevision / subjectHead
phaseA.reviewA.verdict / candidateHead / reviewB.verdict
phaseB.integrationRef / reportBaseRevision / measurementRevision
phaseB.measurementTree / runnerBlob / rawDigest / subjectHead
phaseB.reviewA.verdict / candidateHead / reviewB.verdict
```

Registry rezervace: `IS-T1-TESTS-M3-DISABLED-BOOT-TEST`, path/argv
`tests/m3-disabled-boot.test.js`, capability `C3-023`, `T1/offline`, fixture
`isolated-home-and-owned-loopback-server`, timeout/expected `300000/90000`,
requirements `{network: loopback, database: false, server: false, ollama: false,
gpu: false}`, `required:true`, owner `P8-DISABLED-BOOT`, `state:ACTIVE`,
`lastGreen:{commit:null,artifact:null}`, `flakeCount:0`,
`quarantineExpiry:null`.

## 3. Connector

Žádný se nemění. Sonda pozoruje route registry a přijatý M1 provider error.
Pokud je pro měření nutný nový injection seam, patří do pozdějšího psaného WP.

## 4. Vstup a závislosti

- hard dependency: M1 acceptance a čistý připnutý source SHA;
- každá zapisující fáze se aktivuje z pojmenovaného `integration/<batch>` refu,
  exact base zapíše do reportu a používá vlastní branch/worktree;
- fáze A z tohoto SHA implementuje pouze runner/fixture/registry, projde Review
  A a merge queue **před** `WP-M3-BOUNDARY`;
- fáze B čeká na M2 a větví z aktuálního přijatého post-M2 integration tipu,
  který má A merge jako předka; neběží přímo na starém A ani M1 SHA;
- runner musí používat vlastní HOME/XDG/TMP/DB/project/output root a unikátní
  loopback porty;
- žádná GPU, skutečná Ollama ani externí síť.

Fáze A nesmí měnit composition root, který má B teprve informovat. Potřeba
nového produkčního injection seam je `BLOCK`, ne rozšíření harnessu.
Runner před i po měření fail-closed ověří čistý strom a
`git rev-parse HEAD == --source-revision`; report uloží measurement commit,
`HEAD^{tree}` a blob runneru.

## 5. Malá demonstrace

Runner provede pro každý podporovaný `C3_ENABLE_*` flag dvojici **explicitně
enabled baseline → disabled varianta** ve stejném izolovaném prostředí. To je
nutné zejména pro default-off `AUTONOMY` a `ONLINE_DISCOVERY`: product default
není jejich pozitivní kontrola. Enabled baseline dostane pouze test-owned fake
prerekvizity a blokovanou external transport instrumentaci; musí skutečně
ukázat route/job/attempt, který disabled varianta odstraňuje. Product-default
boot se měří ještě zvlášť a nesmí se zaměnit s enabled control.

Matrice na revalidated source revision je explicitní; fáze A ji znovu odvodí z
`config.features` a jakýkoli přidaný, odstraněný nebo přejmenovaný klíč bez
aktualizace kontraktu skončí `BLOCK`:

| config key | canonical env / default | alias | povinná enabled control plocha |
|---|---|---|---|
| `agents` | `C3_ENABLE_AGENTS` / ON | — | `/api/agents` handler není disabled `501` a test-owned scheduler je pozorovatelný |
| `lifecycle` | `C3_ENABLE_LIFECYCLE` / ON | — | `POST /api/lifecycle/start` + lifecycle pre-handler |
| `expertises` | `C3_ENABLE_EXPERTISES` / ON | `C3_ENABLE_EXPERTS`, jen když canonical chybí | `/api/expertises` route a expertise routing handler |
| `telemetry` | `C3_ENABLE_TELEMETRY` / ON | — | test-owned WS turn vytvoří telemetry snapshot |
| `specialistTelemetry` | `C3_SPECIALIST_TELEMETRY` / ON | — | test-owned specialist event se objeví v telemetry summary |
| `autonomy` | `C3_ENABLE_AUTONOMY` / OFF | — | `/api/autonomy/status` route a právě jeden test-owned interval handle |
| `skills` | `C3_ENABLE_SKILLS` / ON | — | `/api/skills` route a fixture skill v registru |
| `comfyui` | `C3_ENABLE_COMFYUI` / ON | — | `/api/media/health` přes test-owned fake loopback connector |
| `onlineDiscovery` | `C3_ENABLE_ONLINE_DISCOVERY` / OFF | — | full-cycle fixture vyšle právě jeden mediovaný request na test-owned fake registry |

Alias má samostatně testovat precedence canonical hodnoty; není desátým
produkčním flagem. Enabled control nesmí použít externí síť, skutečnou GPU ani
skutečný provider.

Ollama-less precondition runner vytvoří deterministicky pomocí neplatného URL
scheme nebo test-owned fake provideru; nepoužije postup „najdi volný port a pak
jej zavři“, který má TOCTOU okno.

Existující `capability-01-server-behaviours` se zde nespouští přímo: jeho helper
může při selhání ponechat ignorovaný artifact uvnitř checkoutu, který běžný
`git status` neukáže. Fáze A má vlastní fixture a všechny raw výstupy směruje do
explicitního externího artifact rootu.

## 6. Focused pozitivní a negativní důkaz

Pro každý flag report porovná baseline s vypnutou variantou v sedmi plochách:
routes, active handles po bootu a po 90 s, session state, pending confirmation,
DB schema/data delta, outbound attempts a boot import graph.

Povinné kontroly:

- explicitně enabled control každého modulu skutečně zaregistruje pozorovaný
  route/job/attempt, včetně default-off modulů;
- vypnutý modul nesmí být označen čistý, pokud měřidlo jeho aktivitu nikdy
  nevidělo ani v baseline;
- nedostupný provider je testem vyrobený a server přesto dosáhne ready;
- model request vrátí přesný typed error a nespustí external transport;
- každé `ČISTÝ`, `ZŮSTÁVÁ` i `NEMĚŘITELNÉ` odkazuje na raw artifact/příkaz.

## 7. Stop / eskalace

- **BLOCK:** boot padá, měření vyžaduje source změnu nebo izolace není úplná.
- **BLOCK:** runner či pozitivní kontrola chybí.
- **PARK:** konkrétní plocha je neměřitelná; report ji označí
  `NEMĚŘITELNÉ` s důvodem, nevymyslí výsledek.
- Produktové vady se zapíší jako řádky jediného reportu; sonda nevytváří druhý
  finding soubor mimo vlastněný výstup.

## 8. Reprodukce a přijetí

Fáze A:

```bash
set -euo pipefail

IS_P8_A_BASE=<full-accepted-m1-integration-sha>
IS_P8_A_ALLOWED='^(tests/m3-disabled-boot\.test\.js|tests/fixtures/m3-disabled-boot/.*|tests/registry\.json|docs/convergence/TEST-REGISTRY\.md)$'
test "$(git merge-base "$IS_P8_A_BASE" HEAD)" = "$IS_P8_A_BASE"
IS_P8_A_SUBJECT=$(git rev-parse --verify HEAD)
node -e "if (Number(process.versions.node.split('.')[0]) !== 22) process.exit(1)"
test "$(npm --version)" = "10.9.4"
npm ci --offline
test -d node_modules
test -z "$(git status --porcelain=v1 --untracked-files=all)"
C3_LOG_LEVEL=error node tests/m3-disabled-boot.test.js --self-test
node scripts/validate-test-registry.js
C3_LOG_LEVEL=error node tests/repository-hygiene.test.js
node scripts/module-boundary-ratchet.mjs
git diff --no-renames --name-only "$IS_P8_A_BASE"...HEAD |
  awk -v allowed="$IS_P8_A_ALLOWED" '$0 !~ allowed { print "OUT_OF_SCOPE " $0; bad=1 } END { exit bad }'
git diff --check "$IS_P8_A_BASE"...HEAD
test "$(git rev-parse --verify HEAD)" = "$IS_P8_A_SUBJECT"
test -z "$(git status --porcelain=v1 --untracked-files=all)"
```

Fáze A připne reviewnuté rodiče bez self-reference:

```bash
set -euo pipefail

IS_P8_A_BASE=<full-accepted-m1-integration-sha>
IS_P8_A_SUBJECT=<full-phase-a-reviewed-subject-head>
IS_P8_REPORT='docs/execution/runs/p8-disabled-boot-report.md'
IS_P8_A_INTEGRATION_REF=<canonical-phase-a-integration-ref>
IS_P8_A_EA=<full-phase-a-review-a-evidence-head>
IS_P8_A_C=<full-phase-a-reviewed-candidate-head>
IS_P8_A_EB=<full-phase-a-review-b-evidence-head>
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
assert_report_absent "$IS_P8_A_SUBJECT" "$IS_P8_REPORT"
test "$(git rev-list --parents -n 1 "$IS_P8_A_EA" | wc -w)" -eq 2
test "$(git rev-parse "$IS_P8_A_EA^")" = "$IS_P8_A_SUBJECT"
test "$(git diff --no-renames --name-only "$IS_P8_A_SUBJECT" "$IS_P8_A_EA")" = "$IS_P8_REPORT"
test "$(git show "$IS_P8_A_EA:$IS_P8_REPORT" | rg -Fxc "phaseA.integrationRef: $IS_P8_A_INTEGRATION_REF")" -eq 1
test "$(git show "$IS_P8_A_EA:$IS_P8_REPORT" | rg -Fxc "phaseA.baseRevision: $IS_P8_A_BASE")" -eq 1
test "$(git show "$IS_P8_A_EA:$IS_P8_REPORT" | rg -Fxc "phaseA.subjectHead: $IS_P8_A_SUBJECT")" -eq 1
test "$(git show "$IS_P8_A_EA:$IS_P8_REPORT" | rg -Fxc 'phaseA.reviewA.verdict: PASS')" -eq 1
IS_P8_A_EA_REPORT=$(git show "$IS_P8_A_EA:$IS_P8_REPORT")
if rg -q '^phaseA\.(candidateHead|reviewB\.verdict):' <<<"$IS_P8_A_EA_REPORT"; then
  printf '%s\n' 'forbidden Phase A Review B field in P8 A_EA' >&2
  exit 1
else
  IS_P8_A_FORBIDDEN_STATUS=$?
  test "$IS_P8_A_FORBIDDEN_STATUS" -eq 1
fi
git merge-base --is-ancestor "$IS_P8_A_EA" "$IS_P8_A_C"
assert_report_same "$IS_P8_A_EA" "$IS_P8_A_C" "$IS_P8_REPORT"
test "$(git rev-list --parents -n 1 "$IS_P8_A_EB" | wc -w)" -eq 2
test "$(git rev-parse "$IS_P8_A_EB^")" = "$IS_P8_A_C"
test "$(git diff --no-renames --name-only "$IS_P8_A_C" "$IS_P8_A_EB")" = "$IS_P8_REPORT"
assert_report_append "$IS_P8_A_C" "$IS_P8_A_EB" "$IS_P8_REPORT" \
  "phaseA.candidateHead: $IS_P8_A_C" 'phaseA.reviewB.verdict: PASS'
test "$(git show "$IS_P8_A_EB:$IS_P8_REPORT" | rg -Fxc "phaseA.candidateHead: $IS_P8_A_C")" -eq 1
test "$(git show "$IS_P8_A_EB:$IS_P8_REPORT" | rg -Fxc 'phaseA.reviewB.verdict: PASS')" -eq 1
test "$(git show "$IS_P8_A_EB:$IS_P8_REPORT" | rg -Fxc "phaseA.integrationRef: $IS_P8_A_INTEGRATION_REF")" -eq 1
test "$(git show "$IS_P8_A_EB:$IS_P8_REPORT" | rg -Fxc "phaseA.baseRevision: $IS_P8_A_BASE")" -eq 1
test "$(git show "$IS_P8_A_EB:$IS_P8_REPORT" | rg -Fxc "phaseA.subjectHead: $IS_P8_A_SUBJECT")" -eq 1
test "$(git show "$IS_P8_A_EB:$IS_P8_REPORT" | rg -Fxc 'phaseA.reviewA.verdict: PASS')" -eq 1
for IS_P8_KEY in phaseA.integrationRef phaseA.baseRevision phaseA.subjectHead phaseA.reviewA.verdict; do
  assert_one_report_key "$IS_P8_A_EA" "$IS_P8_REPORT" "$IS_P8_KEY" || exit 1
done
for IS_P8_KEY in phaseA.integrationRef phaseA.baseRevision phaseA.subjectHead phaseA.reviewA.verdict phaseA.candidateHead phaseA.reviewB.verdict; do
  assert_one_report_key "$IS_P8_A_EB" "$IS_P8_REPORT" "$IS_P8_KEY" || exit 1
done
git diff --check "$IS_P8_A_SUBJECT" "$IS_P8_A_EA"
git diff --check "$IS_P8_A_C" "$IS_P8_A_EB"
```

Po přijetí A merge SHA fáze B:

```bash
set -euo pipefail

IS_P8_MEASUREMENT=<full-accepted-post-m2-p8-measurement-sha>
IS_P8_ARTIFACT_ROOT=<absolute-isolated-artifact-root>
test "$(git rev-parse HEAD)" = "$IS_P8_MEASUREMENT"
test -z "$(git status --porcelain=v1 --untracked-files=all)"
node -e "if (Number(process.versions.node.split('.')[0]) !== 22) process.exit(1)"
test "$(npm --version)" = "10.9.4"
npm ci --offline
test -d node_modules
test -z "$(git status --porcelain=v1 --untracked-files=all)"
C3_LOG_LEVEL=error node tests/m3-disabled-boot.test.js \
  --artifact-root "$IS_P8_ARTIFACT_ROOT" \
  --source-revision "$IS_P8_MEASUREMENT"
IS_P8_MEASUREMENT_TREE=$(git rev-parse "$IS_P8_MEASUREMENT^{tree}")
IS_P8_RUNNER_BLOB=$(git rev-parse "$IS_P8_MEASUREMENT:tests/m3-disabled-boot.test.js")
IS_P8_RAW_MANIFEST="$IS_P8_ARTIFACT_ROOT/manifest.json"
test -f "$IS_P8_RAW_MANIFEST"
IS_P8_RAW_DIGEST=$(sha256sum "$IS_P8_RAW_MANIFEST" | awk '{ print $1 }')
rg -q '^[0-9a-f]{64}$' <<<"$IS_P8_RAW_DIGEST"
printf 'measurementTree=%s\nrunnerBlob=%s\nrawDigest=%s\n' \
  "$IS_P8_MEASUREMENT_TREE" "$IS_P8_RUNNER_BLOB" "$IS_P8_RAW_DIGEST"
test "$(git rev-parse HEAD)" = "$IS_P8_MEASUREMENT"
test -z "$(git status --porcelain=v1 --untracked-files=all)"
```

Očekávání: všechny exity `0`; tracked strom je před report committem čistý;
runner atomicky vytvoří právě `<artifact-root>/manifest.json`, který pinuje SHA,
environment, porty, časy a artifact digesty. Report se
přijímá jen s úplnou maticí a přesnými reprodukčními příkazy.

Report-only B subject vznikne **přímo** z measurement SHA; tím není potřeba
domýšlet, zda mezilehlý runtime tree zůstal stejný. Do novějšího integration
tipu vstoupí až přes candidate `C`. Pokud se před použitím reportu v M3 změnil
relevantní runtime tree, měření se opakuje. Scope gate je:

```bash
set -euo pipefail

IS_P8_B_REPORT_BASE=<full-phase-b-report-base-sha>
IS_P8_B_INTEGRATION_REF=<canonical-phase-b-integration-ref>
IS_P8_A_EB=<full-accepted-phase-a-review-b-evidence-head>
IS_P8_A_INTEGRATION_REF=<canonical-phase-a-integration-ref>
IS_P8_A_BASE=<full-phase-a-base-sha>
IS_P8_A_SUBJECT=<full-phase-a-reviewed-subject-head>
IS_P8_A_C=<full-phase-a-reviewed-candidate-head>
IS_P8_MEASUREMENT=<full-accepted-post-m2-p8-measurement-sha>
IS_P8_MEASUREMENT_TREE=<full-measurement-tree-sha>
IS_P8_RUNNER_BLOB=<full-runner-blob-sha>
IS_P8_RAW_DIGEST=<raw-manifest-sha256>
IS_P8_REPORT='docs/execution/runs/p8-disabled-boot-report.md'
IS_P8_B_REPORT_ALLOWED='^docs/execution/runs/p8-disabled-boot-report\.md$'
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
test "$IS_P8_B_REPORT_BASE" = "$IS_P8_MEASUREMENT"
git merge-base --is-ancestor "$IS_P8_A_EB" "$IS_P8_B_REPORT_BASE"
assert_report_same "$IS_P8_A_EB" "$IS_P8_B_REPORT_BASE" "$IS_P8_REPORT"
test "$IS_P8_MEASUREMENT_TREE" = "$(git rev-parse "$IS_P8_MEASUREMENT^{tree}")"
test "$IS_P8_RUNNER_BLOB" = "$(git rev-parse "$IS_P8_MEASUREMENT:tests/m3-disabled-boot.test.js")"
rg -q '^[0-9a-f]{64}$' <<<"$IS_P8_RAW_DIGEST"
test "$(git merge-base "$IS_P8_B_REPORT_BASE" HEAD)" = "$IS_P8_B_REPORT_BASE"
IS_P8_B_SUBJECT=$(git rev-parse --verify HEAD)
test "$(git rev-list --parents -n 1 "$IS_P8_B_SUBJECT" | wc -w)" -eq 2
test "$(git rev-parse "$IS_P8_B_SUBJECT^")" = "$IS_P8_B_REPORT_BASE"
assert_report_extension "$IS_P8_B_REPORT_BASE" "$IS_P8_B_SUBJECT" "$IS_P8_REPORT" \
  "phaseB.integrationRef: $IS_P8_B_INTEGRATION_REF" \
  "phaseB.reportBaseRevision: $IS_P8_B_REPORT_BASE" \
  "phaseB.measurementRevision: $IS_P8_MEASUREMENT" \
  "phaseB.measurementTree: $IS_P8_MEASUREMENT_TREE" \
  "phaseB.runnerBlob: $IS_P8_RUNNER_BLOB" \
  "phaseB.rawDigest: $IS_P8_RAW_DIGEST"
test -z "$(git status --porcelain=v1 --untracked-files=all)"
git diff --no-renames --name-only "$IS_P8_B_REPORT_BASE"...HEAD |
  awk -v allowed="$IS_P8_B_REPORT_ALLOWED" '$0 !~ allowed { print "OUT_OF_SCOPE " $0; bad=1 } END { exit bad }'
git diff --check "$IS_P8_B_REPORT_BASE"...HEAD
IS_P8_B_SUBJECT_REPORT=$(git show "$IS_P8_B_SUBJECT:$IS_P8_REPORT")
assert_p8_b_subject_key() {
  local IS_KEY="$1" IS_EXPECTED="$2"
  test "$(awk -v prefix="$IS_KEY:" 'index($0, prefix) == 1 { n++ } END { print n + 0 }' <<<"$IS_P8_B_SUBJECT_REPORT")" -eq 1 || return 1
  test "$(rg -Fxc "$IS_KEY: $IS_EXPECTED" <<<"$IS_P8_B_SUBJECT_REPORT")" -eq 1 || return 1
}
assert_p8_b_subject_key phaseA.integrationRef "$IS_P8_A_INTEGRATION_REF" || exit 1
assert_p8_b_subject_key phaseA.baseRevision "$IS_P8_A_BASE" || exit 1
assert_p8_b_subject_key phaseA.subjectHead "$IS_P8_A_SUBJECT" || exit 1
assert_p8_b_subject_key phaseA.reviewA.verdict PASS || exit 1
assert_p8_b_subject_key phaseA.candidateHead "$IS_P8_A_C" || exit 1
assert_p8_b_subject_key phaseA.reviewB.verdict PASS || exit 1
assert_p8_b_subject_key phaseB.integrationRef "$IS_P8_B_INTEGRATION_REF" || exit 1
assert_p8_b_subject_key phaseB.reportBaseRevision "$IS_P8_B_REPORT_BASE" || exit 1
assert_p8_b_subject_key phaseB.measurementRevision "$IS_P8_MEASUREMENT" || exit 1
assert_p8_b_subject_key phaseB.measurementTree "$IS_P8_MEASUREMENT_TREE" || exit 1
assert_p8_b_subject_key phaseB.runnerBlob "$IS_P8_RUNNER_BLOB" || exit 1
assert_p8_b_subject_key phaseB.rawDigest "$IS_P8_RAW_DIGEST" || exit 1
if rg -q '^phaseB\.(subjectHead|reviewA\.verdict|candidateHead|reviewB\.verdict):' \
  <<<"$IS_P8_B_SUBJECT_REPORT"; then
  printf '%s\n' 'forbidden self-reference field in P8 Phase B subject' >&2
  exit 1
else
  IS_P8_B_SUBJECT_FORBIDDEN_STATUS=$?
  test "$IS_P8_B_SUBJECT_FORBIDDEN_STATUS" -eq 1
fi
```

Tento B subject zachová přijatý Phase A report jako byte prefix, přidá
neprázdný měřený payload a zakončí jej exact-once measurement provenance;
Review A tak váže celý nový payload. Payload nesmí obsahovat line-start
`phaseA.` ani `phaseB.`; tento namespace patří jen exact provenance a evidence.
Subject neobsahuje vlastní SHA ani review.
Z normativních Phase B polí smí `E_A` přidat pouze
`phaseB.subjectHead` a `phaseB.reviewA.verdict`; následující obálky tuto
vazbu a pozdější candidate Review B znovu ověří:

```bash
set -euo pipefail

IS_P8_B_REPORT_BASE=<full-phase-b-report-base-sha>
IS_P8_B_INTEGRATION_REF=<canonical-phase-b-integration-ref>
IS_P8_A_EB=<full-accepted-phase-a-review-b-evidence-head>
IS_P8_A_INTEGRATION_REF=<canonical-phase-a-integration-ref>
IS_P8_A_BASE=<full-phase-a-base-sha>
IS_P8_A_SUBJECT=<full-phase-a-reviewed-subject-head>
IS_P8_A_C=<full-phase-a-reviewed-candidate-head>
IS_P8_MEASUREMENT=<full-accepted-post-m2-p8-measurement-sha>
IS_P8_MEASUREMENT_TREE=<full-measurement-tree-sha>
IS_P8_RUNNER_BLOB=<full-runner-blob-sha>
IS_P8_RAW_MANIFEST=<absolute-isolated-artifact-root>/manifest.json
IS_P8_RAW_DIGEST=<raw-manifest-sha256>
IS_P8_REPORT='docs/execution/runs/p8-disabled-boot-report.md'
IS_P8_B_SUBJECT=<full-phase-b-reviewed-subject-head>
IS_P8_B_EA=<full-phase-b-review-a-evidence-head>
IS_P8_B_C=<full-phase-b-reviewed-candidate-head>
IS_P8_B_EB=<full-phase-b-review-b-evidence-head>
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
  test "$(git show "$IS_REPORT_HEAD:$IS_P8_REPORT" | rg -Fxc "phaseA.integrationRef: $IS_P8_A_INTEGRATION_REF")" -eq 1 || return 1
  test "$(git show "$IS_REPORT_HEAD:$IS_P8_REPORT" | rg -Fxc "phaseA.baseRevision: $IS_P8_A_BASE")" -eq 1 || return 1
  test "$(git show "$IS_REPORT_HEAD:$IS_P8_REPORT" | rg -Fxc "phaseA.subjectHead: $IS_P8_A_SUBJECT")" -eq 1 || return 1
  test "$(git show "$IS_REPORT_HEAD:$IS_P8_REPORT" | rg -Fxc 'phaseA.reviewA.verdict: PASS')" -eq 1 || return 1
  test "$(git show "$IS_REPORT_HEAD:$IS_P8_REPORT" | rg -Fxc "phaseA.candidateHead: $IS_P8_A_C")" -eq 1 || return 1
  test "$(git show "$IS_REPORT_HEAD:$IS_P8_REPORT" | rg -Fxc 'phaseA.reviewB.verdict: PASS')" -eq 1 || return 1
  for IS_P8_KEY in phaseA.integrationRef phaseA.baseRevision phaseA.subjectHead phaseA.reviewA.verdict phaseA.candidateHead phaseA.reviewB.verdict; do
    assert_one_report_key "$IS_REPORT_HEAD" "$IS_P8_REPORT" "$IS_P8_KEY" || return 1
  done
}
test "$IS_P8_B_REPORT_BASE" = "$IS_P8_MEASUREMENT"
git merge-base --is-ancestor "$IS_P8_A_EB" "$IS_P8_B_REPORT_BASE"
assert_report_same "$IS_P8_A_EB" "$IS_P8_B_REPORT_BASE" "$IS_P8_REPORT"
verify_phase_a_keys "$IS_P8_A_EB"
test "$IS_P8_MEASUREMENT_TREE" = "$(git rev-parse "$IS_P8_MEASUREMENT^{tree}")"
test "$IS_P8_RUNNER_BLOB" = "$(git rev-parse "$IS_P8_MEASUREMENT:tests/m3-disabled-boot.test.js")"
test -f "$IS_P8_RAW_MANIFEST"
test "$IS_P8_RAW_DIGEST" = "$(sha256sum "$IS_P8_RAW_MANIFEST" | awk '{ print $1 }')"
rg -q '^[0-9a-f]{64}$' <<<"$IS_P8_RAW_DIGEST"
test "$(git rev-list --parents -n 1 "$IS_P8_B_SUBJECT" | wc -w)" -eq 2
test "$(git rev-parse "$IS_P8_B_SUBJECT^")" = "$IS_P8_B_REPORT_BASE"
assert_report_extension "$IS_P8_B_REPORT_BASE" "$IS_P8_B_SUBJECT" "$IS_P8_REPORT" \
  "phaseB.integrationRef: $IS_P8_B_INTEGRATION_REF" \
  "phaseB.reportBaseRevision: $IS_P8_B_REPORT_BASE" \
  "phaseB.measurementRevision: $IS_P8_MEASUREMENT" \
  "phaseB.measurementTree: $IS_P8_MEASUREMENT_TREE" \
  "phaseB.runnerBlob: $IS_P8_RUNNER_BLOB" \
  "phaseB.rawDigest: $IS_P8_RAW_DIGEST"
verify_phase_a_keys "$IS_P8_B_SUBJECT"
test "$(git rev-list --parents -n 1 "$IS_P8_B_EA" | wc -w)" -eq 2
test "$(git rev-parse "$IS_P8_B_EA^")" = "$IS_P8_B_SUBJECT"
test "$(git diff --no-renames --name-only "$IS_P8_B_SUBJECT" "$IS_P8_B_EA")" = "$IS_P8_REPORT"
assert_report_append "$IS_P8_B_SUBJECT" "$IS_P8_B_EA" "$IS_P8_REPORT" \
  "phaseB.subjectHead: $IS_P8_B_SUBJECT" 'phaseB.reviewA.verdict: PASS'
verify_phase_a_keys "$IS_P8_B_EA"
test "$(git show "$IS_P8_B_EA:$IS_P8_REPORT" | rg -Fxc "phaseB.integrationRef: $IS_P8_B_INTEGRATION_REF")" -eq 1
test "$(git show "$IS_P8_B_EA:$IS_P8_REPORT" | rg -Fxc "phaseB.reportBaseRevision: $IS_P8_B_REPORT_BASE")" -eq 1
test "$(git show "$IS_P8_B_EA:$IS_P8_REPORT" | rg -Fxc "phaseB.measurementRevision: $IS_P8_MEASUREMENT")" -eq 1
test "$(git show "$IS_P8_B_EA:$IS_P8_REPORT" | rg -Fxc "phaseB.measurementTree: $IS_P8_MEASUREMENT_TREE")" -eq 1
test "$(git show "$IS_P8_B_EA:$IS_P8_REPORT" | rg -Fxc "phaseB.runnerBlob: $IS_P8_RUNNER_BLOB")" -eq 1
test "$(git show "$IS_P8_B_EA:$IS_P8_REPORT" | rg -Fxc "phaseB.rawDigest: $IS_P8_RAW_DIGEST")" -eq 1
test "$(git show "$IS_P8_B_EA:$IS_P8_REPORT" | rg -Fxc "phaseB.subjectHead: $IS_P8_B_SUBJECT")" -eq 1
test "$(git show "$IS_P8_B_EA:$IS_P8_REPORT" | rg -Fxc 'phaseB.reviewA.verdict: PASS')" -eq 1
IS_P8_B_EA_REPORT=$(git show "$IS_P8_B_EA:$IS_P8_REPORT")
if rg -q '^phaseB\.(candidateHead|reviewB\.verdict):' <<<"$IS_P8_B_EA_REPORT"; then
  printf '%s\n' 'forbidden Phase B Review B field in P8 B_EA' >&2
  exit 1
else
  IS_P8_B_FORBIDDEN_STATUS=$?
  test "$IS_P8_B_FORBIDDEN_STATUS" -eq 1
fi
git merge-base --is-ancestor "$IS_P8_B_EA" "$IS_P8_B_C"
assert_report_same "$IS_P8_B_EA" "$IS_P8_B_C" "$IS_P8_REPORT"
test "$(git rev-list --parents -n 1 "$IS_P8_B_EB" | wc -w)" -eq 2
test "$(git rev-parse "$IS_P8_B_EB^")" = "$IS_P8_B_C"
test "$(git diff --no-renames --name-only "$IS_P8_B_C" "$IS_P8_B_EB")" = "$IS_P8_REPORT"
assert_report_append "$IS_P8_B_C" "$IS_P8_B_EB" "$IS_P8_REPORT" \
  "phaseB.candidateHead: $IS_P8_B_C" 'phaseB.reviewB.verdict: PASS'
verify_phase_a_keys "$IS_P8_B_EB"
test "$(git show "$IS_P8_B_EB:$IS_P8_REPORT" | rg -Fxc "phaseB.candidateHead: $IS_P8_B_C")" -eq 1
test "$(git show "$IS_P8_B_EB:$IS_P8_REPORT" | rg -Fxc 'phaseB.reviewB.verdict: PASS')" -eq 1
test "$(git show "$IS_P8_B_EB:$IS_P8_REPORT" | rg -Fxc "phaseB.integrationRef: $IS_P8_B_INTEGRATION_REF")" -eq 1
test "$(git show "$IS_P8_B_EB:$IS_P8_REPORT" | rg -Fxc "phaseB.reportBaseRevision: $IS_P8_B_REPORT_BASE")" -eq 1
test "$(git show "$IS_P8_B_EB:$IS_P8_REPORT" | rg -Fxc "phaseB.measurementRevision: $IS_P8_MEASUREMENT")" -eq 1
test "$(git show "$IS_P8_B_EB:$IS_P8_REPORT" | rg -Fxc "phaseB.measurementTree: $IS_P8_MEASUREMENT_TREE")" -eq 1
test "$(git show "$IS_P8_B_EB:$IS_P8_REPORT" | rg -Fxc "phaseB.runnerBlob: $IS_P8_RUNNER_BLOB")" -eq 1
test "$(git show "$IS_P8_B_EB:$IS_P8_REPORT" | rg -Fxc "phaseB.rawDigest: $IS_P8_RAW_DIGEST")" -eq 1
test "$(git show "$IS_P8_B_EB:$IS_P8_REPORT" | rg -Fxc "phaseB.subjectHead: $IS_P8_B_SUBJECT")" -eq 1
test "$(git show "$IS_P8_B_EB:$IS_P8_REPORT" | rg -Fxc 'phaseB.reviewA.verdict: PASS')" -eq 1
for IS_P8_KEY in phaseB.integrationRef phaseB.reportBaseRevision phaseB.measurementRevision phaseB.measurementTree phaseB.runnerBlob phaseB.rawDigest phaseB.subjectHead phaseB.reviewA.verdict; do
  assert_one_report_key "$IS_P8_B_EA" "$IS_P8_REPORT" "$IS_P8_KEY" || exit 1
done
for IS_P8_KEY in phaseB.integrationRef phaseB.reportBaseRevision phaseB.measurementRevision phaseB.measurementTree phaseB.runnerBlob phaseB.rawDigest phaseB.subjectHead phaseB.reviewA.verdict phaseB.candidateHead phaseB.reviewB.verdict; do
  assert_one_report_key "$IS_P8_B_EB" "$IS_P8_REPORT" "$IS_P8_KEY" || exit 1
done
git diff --check "$IS_P8_B_SUBJECT" "$IS_P8_B_EA"
git diff --check "$IS_P8_B_C" "$IS_P8_B_EB"
```

Canonical ref se pro každou fázi posune až po metadata gate příslušného `E_B`.
