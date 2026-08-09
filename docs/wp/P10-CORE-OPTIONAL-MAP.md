# P10 — file-level mapa `CORE / OPTIONAL`

**Typ:** dvoufázový evidence WP; A zapisuje validator, B klasifikuje post-M2 graf
**Stav:** PHASE_A_AFTER_CONTRACT_MERGE / PHASE_B_BLOCKED_UNTIL_POST_M2
**Phase A base:** accepted contract/integration checkpoint
**Phase B measurement revision:** aktuální přijatý post-M2 integration tip
obsahující A merge a předcházející `WP-M3-BOUNDARY`
**Adresát:** vlastník kroku M3/A2

Historická čísla 416/1 004 patří census SHA `8116d09f`; `0a6bde54` už mělo
423/1 016. Ani jedno číslo není acceptance constant. Počet se vždy odvodí z
JSON na skutečném source SHA.

## 1. Výsledek

Každý soubor vrácený autoritativním `scripts/module-graph.mjs` dostane právě
jednu značku `CORE`, `OPTIONAL` nebo `UNRESOLVED`. Report vypíše všechny
`CORE -> OPTIONAL` hrany, jejich vztah k SCC a cenu budoucího směrového railu.

Jde o vstup A2, nikoli zapnutí railu nebo přesun souborů.

## 2. Vlastněné a zakázané cesty

- fáze A: `scripts/validate-core-optional-map.mjs`,
  `tests/core-optional-map-validator.test.js`,
  `tests/fixtures/core-optional-map/**`, nový registry entry a branch-local
  `docs/convergence/TEST-REGISTRY.md`;
- run report: `docs/execution/runs/p10-core-optional-map-report.md`; A subject
  jej nemění a jeho `E_A`/`E_B` připnou A subject/candidate reviews; po raw
  derivaci report-only B subject doplní measurement data a dostane vlastní obálky;
- fáze B: raw `module-graph.json` a `core-optional-map.json` v izolovaném
  `<artifact-root>`;
- zakázané: `src/**`, module graph/ratchet/baseline, ostatní scripts/testy,
  authority docs a existující registry entries.

Oba subjecty a jejich obálky spotřebují writer slot; raw derivace ne. Obě
zapisující jednotky jdou přes Review A a merge queue.
Report drží dvě oddělené provenance sady:

```text
phaseA.integrationRef / baseRevision / subjectHead
phaseA.reviewA.verdict / candidateHead / reviewB.verdict
phaseB.integrationRef / reportBaseRevision / measurementRevision
phaseB.measurementTree / graphScannerBlob / validatorBlob / rawDigest / subjectHead
phaseB.reviewA.verdict / candidateHead / reviewB.verdict
```

Registry rezervace: `IS-T1-TESTS-CORE-OPTIONAL-MAP-VALIDATOR-TEST`, path/argv
`tests/core-optional-map-validator.test.js`, capability `C3-027`, `T1/offline`,
fixture `isolated-home`, timeout/expected `120000/15000`, requirements
`{network:none, database:false, server:false, ollama:false, gpu:false}`,
`required:true`, owner `P10-CORE-OPTIONAL-MAP`, `state:ACTIVE`,
`lastGreen:{commit:null,artifact:null}`, `flakeCount:0`,
`quarantineExpiry:null`.

## 3. Connector

Žádný. Klasifikace používá přijaté doménové rozhodnutí
[`R1`](../review/2026-08-08-MODULE-INDEPENDENCE.md) §6.1; nevytváří nový
extension connector ani nové porty.

## 4. Vstup a závislosti

- fáze A může začít po contract merge proti dnešnímu stabilnímu graph JSON
  protokolu a vlastní jen validator/test/registry;
- každá zapisující fáze se aktivuje z pojmenovaného `integration/<batch>` refu,
  exact base zapíše do reportu a používá vlastní branch/worktree;
- fáze B používá přesný post-M2 SHA, protože M2 mění core/effect/tool hranice,
  a proběhne před prvním zapisujícím M3/A2 nebo M3 boundary commitem;
- autoritativní měřidlo je stávající `scripts/module-graph.mjs`;
- fáze B větví z aktuálního přijatého post-M2 integration tipu, který obsahuje
  A merge; validator nesmí klasifikaci sám domýšlet;
- pokud R1 konkrétní soubor nerozhodne, značka je `UNRESOLVED`, ne domněnka.

Validator před i po derivaci fail-closed ověří čistý strom a
`git rev-parse HEAD == --source-revision`; report uloží measurement commit,
`HEAD^{tree}`, blob graph scanneru i validatoru.

## 5. Malá demonstrace

```bash
node tests/core-optional-map-validator.test.js
node scripts/validate-test-registry.js
C3_LOG_LEVEL=error node tests/repository-hygiene.test.js
node scripts/module-boundary-ratchet.mjs
```

Po přijetí fáze A běží fáze B:

```bash
node scripts/module-graph.mjs . \
  --out <absolute-isolated-artifact-root>/module-graph.json
```

Klasifikovaný počet se čte z `counts.srcFiles` a seznam souborů z
`fanIn[].file`. Žádný počet se neopisuje z historického review.

`core-optional-map.json` má tento minimální tvar:

```text
sourceRevision
graphSha256
rows[] = {file, classification: CORE|OPTIONAL|UNRESOLVED, reason}
coreToOptional[] = {edge, inSameCycle}
```

`coreToOptional` není ručně opsaný seznam: validator jej znovu odvodí z
`module-graph.json` a `rows`.

## 6. Focused pozitivní a negativní důkaz

Report povinně obsahuje:

1. přesně jeden řádek pro každý unikátní `fanIn[].file`;
2. odůvodnění každého `OPTIONAL` a `UNRESOLVED` podle R1;
3. všechny `CORE -> OPTIONAL` exact edges z JSON;
4. označení hran uvnitř SCC a počet hran, které by A2 dnes shodil;
5. doporučení fail-closed versus expiring exact allowlist bez změny checkeru.

Negativní kontrola odmítne duplicitu, chybějící/foreign file, neznámou značku,
součet odlišný od `counts.srcFiles`, prázdný reason u `OPTIONAL/UNRESOLVED`,
neshodný graph digest, špatný SCC příznak a ručně uvedenou či chybějící
`CORE -> OPTIONAL` hranu.

## 7. Stop / eskalace

- **BLOCK:** kterýkoli `UNRESOLVED` soubor leží na kandidátní directional hraně
  nebo ve stejném SCC; A2 se nezapne. Ostatní `UNRESOLVED` lze explicitně
  zaparkovat. Neexistuje neurčitý většinový práh.
- **FINDING:** jeden soubor míchá core a optional side effect; pouze se popíše.
- **PARK:** jednotlivý soubor zůstane `UNRESOLVED` s konkrétním důvodem.

## 8. Reprodukce a přijetí

Fáze A:

```bash
set -euo pipefail

IS_P10_A_BASE=<full-accepted-contract-integration-sha>
IS_P10_A_ALLOWED='^(scripts/validate-core-optional-map\.mjs|tests/core-optional-map-validator\.test\.js|tests/fixtures/core-optional-map/.*|tests/registry\.json|docs/convergence/TEST-REGISTRY\.md)$'
test "$(git merge-base "$IS_P10_A_BASE" HEAD)" = "$IS_P10_A_BASE"
IS_P10_A_SUBJECT=$(git rev-parse --verify HEAD)
node -e "if (Number(process.versions.node.split('.')[0]) !== 22) process.exit(1)"
test "$(npm --version)" = "10.9.4"
npm ci --offline
test -d node_modules
test -z "$(git status --porcelain=v1 --untracked-files=all)"
node tests/core-optional-map-validator.test.js
node scripts/validate-test-registry.js
C3_LOG_LEVEL=error node tests/repository-hygiene.test.js
node scripts/module-boundary-ratchet.mjs
git diff --no-renames --name-only "$IS_P10_A_BASE"...HEAD |
  awk -v allowed="$IS_P10_A_ALLOWED" '$0 !~ allowed { print "OUT_OF_SCOPE " $0; bad=1 } END { exit bad }'
git diff --check "$IS_P10_A_BASE"...HEAD
test "$(git rev-parse --verify HEAD)" = "$IS_P10_A_SUBJECT"
test -z "$(git status --porcelain=v1 --untracked-files=all)"
```

```bash
set -euo pipefail

IS_P10_A_BASE=<full-accepted-contract-integration-sha>
IS_P10_A_SUBJECT=<full-phase-a-reviewed-subject-head>
IS_P10_REPORT='docs/execution/runs/p10-core-optional-map-report.md'
IS_P10_A_INTEGRATION_REF=<canonical-phase-a-integration-ref>
IS_P10_A_EA=<full-phase-a-review-a-evidence-head>
IS_P10_A_C=<full-phase-a-reviewed-candidate-head>
IS_P10_A_EB=<full-phase-a-review-b-evidence-head>
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
assert_report_absent "$IS_P10_A_SUBJECT" "$IS_P10_REPORT"
test "$(git rev-list --parents -n 1 "$IS_P10_A_EA" | wc -w)" -eq 2
test "$(git rev-parse "$IS_P10_A_EA^")" = "$IS_P10_A_SUBJECT"
test "$(git diff --no-renames --name-only "$IS_P10_A_SUBJECT" "$IS_P10_A_EA")" = "$IS_P10_REPORT"
test "$(git show "$IS_P10_A_EA:$IS_P10_REPORT" | rg -Fxc "phaseA.integrationRef: $IS_P10_A_INTEGRATION_REF")" -eq 1
test "$(git show "$IS_P10_A_EA:$IS_P10_REPORT" | rg -Fxc "phaseA.baseRevision: $IS_P10_A_BASE")" -eq 1
test "$(git show "$IS_P10_A_EA:$IS_P10_REPORT" | rg -Fxc "phaseA.subjectHead: $IS_P10_A_SUBJECT")" -eq 1
test "$(git show "$IS_P10_A_EA:$IS_P10_REPORT" | rg -Fxc 'phaseA.reviewA.verdict: PASS')" -eq 1
IS_P10_A_EA_REPORT=$(git show "$IS_P10_A_EA:$IS_P10_REPORT")
if rg -q '^phaseA\.(candidateHead|reviewB\.verdict):' <<<"$IS_P10_A_EA_REPORT"; then
  printf '%s\n' 'forbidden Phase A Review B field in P10 A_EA' >&2
  exit 1
else
  IS_P10_A_FORBIDDEN_STATUS=$?
  test "$IS_P10_A_FORBIDDEN_STATUS" -eq 1
fi
git merge-base --is-ancestor "$IS_P10_A_EA" "$IS_P10_A_C"
assert_report_same "$IS_P10_A_EA" "$IS_P10_A_C" "$IS_P10_REPORT"
test "$(git rev-list --parents -n 1 "$IS_P10_A_EB" | wc -w)" -eq 2
test "$(git rev-parse "$IS_P10_A_EB^")" = "$IS_P10_A_C"
test "$(git diff --no-renames --name-only "$IS_P10_A_C" "$IS_P10_A_EB")" = "$IS_P10_REPORT"
assert_report_append "$IS_P10_A_C" "$IS_P10_A_EB" "$IS_P10_REPORT" \
  "phaseA.candidateHead: $IS_P10_A_C" 'phaseA.reviewB.verdict: PASS'
test "$(git show "$IS_P10_A_EB:$IS_P10_REPORT" | rg -Fxc "phaseA.candidateHead: $IS_P10_A_C")" -eq 1
test "$(git show "$IS_P10_A_EB:$IS_P10_REPORT" | rg -Fxc 'phaseA.reviewB.verdict: PASS')" -eq 1
test "$(git show "$IS_P10_A_EB:$IS_P10_REPORT" | rg -Fxc "phaseA.integrationRef: $IS_P10_A_INTEGRATION_REF")" -eq 1
test "$(git show "$IS_P10_A_EB:$IS_P10_REPORT" | rg -Fxc "phaseA.baseRevision: $IS_P10_A_BASE")" -eq 1
test "$(git show "$IS_P10_A_EB:$IS_P10_REPORT" | rg -Fxc "phaseA.subjectHead: $IS_P10_A_SUBJECT")" -eq 1
test "$(git show "$IS_P10_A_EB:$IS_P10_REPORT" | rg -Fxc 'phaseA.reviewA.verdict: PASS')" -eq 1
for IS_P10_KEY in phaseA.integrationRef phaseA.baseRevision phaseA.subjectHead phaseA.reviewA.verdict; do
  assert_one_report_key "$IS_P10_A_EA" "$IS_P10_REPORT" "$IS_P10_KEY" || exit 1
done
for IS_P10_KEY in phaseA.integrationRef phaseA.baseRevision phaseA.subjectHead phaseA.reviewA.verdict phaseA.candidateHead phaseA.reviewB.verdict; do
  assert_one_report_key "$IS_P10_A_EB" "$IS_P10_REPORT" "$IS_P10_KEY" || exit 1
done
git diff --check "$IS_P10_A_SUBJECT" "$IS_P10_A_EA"
git diff --check "$IS_P10_A_C" "$IS_P10_A_EB"
```

Fáze B:

```bash
set -euo pipefail

IS_P10_MEASUREMENT=<full-accepted-p10-measurement-sha>
IS_P10_ARTIFACT_ROOT=<absolute-isolated-artifact-root>
test "$(git rev-parse HEAD)" = "$IS_P10_MEASUREMENT"
test -z "$(git status --porcelain=v1 --untracked-files=all)"
node -e "if (Number(process.versions.node.split('.')[0]) !== 22) process.exit(1)"
test "$(npm --version)" = "10.9.4"
npm ci --offline
test -d node_modules
test -z "$(git status --porcelain=v1 --untracked-files=all)"
node scripts/module-graph.mjs . \
  --out "$IS_P10_ARTIFACT_ROOT/module-graph.json"
node scripts/validate-core-optional-map.mjs \
  --graph "$IS_P10_ARTIFACT_ROOT/module-graph.json" \
  --map "$IS_P10_ARTIFACT_ROOT/core-optional-map.json" \
  --source-revision "$IS_P10_MEASUREMENT"
node scripts/module-boundary-ratchet.mjs
IS_P10_MEASUREMENT_TREE=$(git rev-parse "$IS_P10_MEASUREMENT^{tree}")
IS_P10_GRAPH_SCANNER_BLOB=$(git rev-parse "$IS_P10_MEASUREMENT:scripts/module-graph.mjs")
IS_P10_VALIDATOR_BLOB=$(git rev-parse "$IS_P10_MEASUREMENT:scripts/validate-core-optional-map.mjs")
IS_P10_RAW_MAP="$IS_P10_ARTIFACT_ROOT/core-optional-map.json"
test -f "$IS_P10_RAW_MAP"
IS_P10_RAW_DIGEST=$(sha256sum "$IS_P10_RAW_MAP" | awk '{ print $1 }')
rg -q '^[0-9a-f]{64}$' <<<"$IS_P10_RAW_DIGEST"
printf 'measurementTree=%s\ngraphScannerBlob=%s\nvalidatorBlob=%s\nrawDigest=%s\n' \
  "$IS_P10_MEASUREMENT_TREE" "$IS_P10_GRAPH_SCANNER_BLOB" \
  "$IS_P10_VALIDATOR_BLOB" "$IS_P10_RAW_DIGEST"
test "$(git rev-parse HEAD)" = "$IS_P10_MEASUREMENT"
test -z "$(git status --porcelain=v1 --untracked-files=all)"
```

Očekávání: všechny exity `0`; oba JSONy a report pinují source SHA a report
uvádí SHA-256 `core-optional-map.json`; tracked strom je před report committem
čistý. Přijetí klasifikace proběhne samostatným review, nikoli pouze kontrolou
počtu.

Report-only B subject vznikne **přímo** z measurement SHA a do novějšího tipu
vstoupí až přes candidate `C`. Změna relevantního graph/runtime tree před
použitím mapy derivaci zneplatní. Scope gate:

```bash
set -euo pipefail

IS_P10_B_REPORT_BASE=<full-phase-b-report-base-sha>
IS_P10_B_INTEGRATION_REF=<canonical-phase-b-integration-ref>
IS_P10_A_EB=<full-accepted-phase-a-review-b-evidence-head>
IS_P10_A_INTEGRATION_REF=<canonical-phase-a-integration-ref>
IS_P10_A_BASE=<full-phase-a-base-sha>
IS_P10_A_SUBJECT=<full-phase-a-reviewed-subject-head>
IS_P10_A_C=<full-phase-a-reviewed-candidate-head>
IS_P10_MEASUREMENT=<full-accepted-p10-measurement-sha>
IS_P10_MEASUREMENT_TREE=<full-measurement-tree-sha>
IS_P10_GRAPH_SCANNER_BLOB=<full-graph-scanner-blob-sha>
IS_P10_VALIDATOR_BLOB=<full-validator-blob-sha>
IS_P10_RAW_DIGEST=<core-optional-map-sha256>
IS_P10_REPORT='docs/execution/runs/p10-core-optional-map-report.md'
IS_P10_B_REPORT_ALLOWED='^docs/execution/runs/p10-core-optional-map-report\.md$'
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
test "$IS_P10_B_REPORT_BASE" = "$IS_P10_MEASUREMENT"
git merge-base --is-ancestor "$IS_P10_A_EB" "$IS_P10_B_REPORT_BASE"
assert_report_same "$IS_P10_A_EB" "$IS_P10_B_REPORT_BASE" "$IS_P10_REPORT"
test "$IS_P10_MEASUREMENT_TREE" = "$(git rev-parse "$IS_P10_MEASUREMENT^{tree}")"
test "$IS_P10_GRAPH_SCANNER_BLOB" = "$(git rev-parse "$IS_P10_MEASUREMENT:scripts/module-graph.mjs")"
test "$IS_P10_VALIDATOR_BLOB" = "$(git rev-parse "$IS_P10_MEASUREMENT:scripts/validate-core-optional-map.mjs")"
rg -q '^[0-9a-f]{64}$' <<<"$IS_P10_RAW_DIGEST"
test "$(git merge-base "$IS_P10_B_REPORT_BASE" HEAD)" = "$IS_P10_B_REPORT_BASE"
IS_P10_B_SUBJECT=$(git rev-parse --verify HEAD)
test "$(git rev-list --parents -n 1 "$IS_P10_B_SUBJECT" | wc -w)" -eq 2
test "$(git rev-parse "$IS_P10_B_SUBJECT^")" = "$IS_P10_B_REPORT_BASE"
assert_report_extension "$IS_P10_B_REPORT_BASE" "$IS_P10_B_SUBJECT" "$IS_P10_REPORT" \
  "phaseB.integrationRef: $IS_P10_B_INTEGRATION_REF" \
  "phaseB.reportBaseRevision: $IS_P10_B_REPORT_BASE" \
  "phaseB.measurementRevision: $IS_P10_MEASUREMENT" \
  "phaseB.measurementTree: $IS_P10_MEASUREMENT_TREE" \
  "phaseB.graphScannerBlob: $IS_P10_GRAPH_SCANNER_BLOB" \
  "phaseB.validatorBlob: $IS_P10_VALIDATOR_BLOB" \
  "phaseB.rawDigest: $IS_P10_RAW_DIGEST"
test -z "$(git status --porcelain=v1 --untracked-files=all)"
git diff --no-renames --name-only "$IS_P10_B_REPORT_BASE"...HEAD |
  awk -v allowed="$IS_P10_B_REPORT_ALLOWED" '$0 !~ allowed { print "OUT_OF_SCOPE " $0; bad=1 } END { exit bad }'
git diff --check "$IS_P10_B_REPORT_BASE"...HEAD
IS_P10_B_SUBJECT_REPORT=$(git show "$IS_P10_B_SUBJECT:$IS_P10_REPORT")
assert_p10_b_subject_key() {
  local IS_KEY="$1" IS_EXPECTED="$2"
  test "$(awk -v prefix="$IS_KEY:" 'index($0, prefix) == 1 { n++ } END { print n + 0 }' <<<"$IS_P10_B_SUBJECT_REPORT")" -eq 1 || return 1
  test "$(rg -Fxc "$IS_KEY: $IS_EXPECTED" <<<"$IS_P10_B_SUBJECT_REPORT")" -eq 1 || return 1
}
assert_p10_b_subject_key phaseA.integrationRef "$IS_P10_A_INTEGRATION_REF" || exit 1
assert_p10_b_subject_key phaseA.baseRevision "$IS_P10_A_BASE" || exit 1
assert_p10_b_subject_key phaseA.subjectHead "$IS_P10_A_SUBJECT" || exit 1
assert_p10_b_subject_key phaseA.reviewA.verdict PASS || exit 1
assert_p10_b_subject_key phaseA.candidateHead "$IS_P10_A_C" || exit 1
assert_p10_b_subject_key phaseA.reviewB.verdict PASS || exit 1
assert_p10_b_subject_key phaseB.integrationRef "$IS_P10_B_INTEGRATION_REF" || exit 1
assert_p10_b_subject_key phaseB.reportBaseRevision "$IS_P10_B_REPORT_BASE" || exit 1
assert_p10_b_subject_key phaseB.measurementRevision "$IS_P10_MEASUREMENT" || exit 1
assert_p10_b_subject_key phaseB.measurementTree "$IS_P10_MEASUREMENT_TREE" || exit 1
assert_p10_b_subject_key phaseB.graphScannerBlob "$IS_P10_GRAPH_SCANNER_BLOB" || exit 1
assert_p10_b_subject_key phaseB.validatorBlob "$IS_P10_VALIDATOR_BLOB" || exit 1
assert_p10_b_subject_key phaseB.rawDigest "$IS_P10_RAW_DIGEST" || exit 1
if rg -q '^phaseB\.(subjectHead|reviewA\.verdict|candidateHead|reviewB\.verdict):' \
  <<<"$IS_P10_B_SUBJECT_REPORT"; then
  printf '%s\n' 'forbidden self-reference field in P10 Phase B subject' >&2
  exit 1
else
  IS_P10_B_SUBJECT_FORBIDDEN_STATUS=$?
  test "$IS_P10_B_SUBJECT_FORBIDDEN_STATUS" -eq 1
fi
```

B subject zachová přijatý Phase A report jako byte prefix, přidá neprázdný
měřený payload a zakončí jej exact-once measurement provenance; Review A tak
váže celý nový payload. Payload nesmí obsahovat line-start `phaseA.` ani
`phaseB.`; tento namespace patří jen exact provenance a evidence. Subject
neobsahuje vlastní SHA ani review. Z
normativních Phase B polí smí `E_A` přidat pouze `phaseB.subjectHead` a
`phaseB.reviewA.verdict`; nesmí poprvé zapsat ani opravit klasifikaci.

```bash
set -euo pipefail

IS_P10_B_REPORT_BASE=<full-phase-b-report-base-sha>
IS_P10_B_INTEGRATION_REF=<canonical-phase-b-integration-ref>
IS_P10_A_EB=<full-accepted-phase-a-review-b-evidence-head>
IS_P10_A_INTEGRATION_REF=<canonical-phase-a-integration-ref>
IS_P10_A_BASE=<full-phase-a-base-sha>
IS_P10_A_SUBJECT=<full-phase-a-reviewed-subject-head>
IS_P10_A_C=<full-phase-a-reviewed-candidate-head>
IS_P10_MEASUREMENT=<full-accepted-p10-measurement-sha>
IS_P10_MEASUREMENT_TREE=<full-measurement-tree-sha>
IS_P10_GRAPH_SCANNER_BLOB=<full-graph-scanner-blob-sha>
IS_P10_VALIDATOR_BLOB=<full-validator-blob-sha>
IS_P10_RAW_MAP=<absolute-isolated-artifact-root>/core-optional-map.json
IS_P10_RAW_DIGEST=<core-optional-map-sha256>
IS_P10_REPORT='docs/execution/runs/p10-core-optional-map-report.md'
IS_P10_B_SUBJECT=<full-phase-b-reviewed-subject-head>
IS_P10_B_EA=<full-phase-b-review-a-evidence-head>
IS_P10_B_C=<full-phase-b-reviewed-candidate-head>
IS_P10_B_EB=<full-phase-b-review-b-evidence-head>
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
  test "$(git show "$IS_REPORT_HEAD:$IS_P10_REPORT" | rg -Fxc "phaseA.integrationRef: $IS_P10_A_INTEGRATION_REF")" -eq 1 || return 1
  test "$(git show "$IS_REPORT_HEAD:$IS_P10_REPORT" | rg -Fxc "phaseA.baseRevision: $IS_P10_A_BASE")" -eq 1 || return 1
  test "$(git show "$IS_REPORT_HEAD:$IS_P10_REPORT" | rg -Fxc "phaseA.subjectHead: $IS_P10_A_SUBJECT")" -eq 1 || return 1
  test "$(git show "$IS_REPORT_HEAD:$IS_P10_REPORT" | rg -Fxc 'phaseA.reviewA.verdict: PASS')" -eq 1 || return 1
  test "$(git show "$IS_REPORT_HEAD:$IS_P10_REPORT" | rg -Fxc "phaseA.candidateHead: $IS_P10_A_C")" -eq 1 || return 1
  test "$(git show "$IS_REPORT_HEAD:$IS_P10_REPORT" | rg -Fxc 'phaseA.reviewB.verdict: PASS')" -eq 1 || return 1
  for IS_P10_KEY in phaseA.integrationRef phaseA.baseRevision phaseA.subjectHead phaseA.reviewA.verdict phaseA.candidateHead phaseA.reviewB.verdict; do
    assert_one_report_key "$IS_REPORT_HEAD" "$IS_P10_REPORT" "$IS_P10_KEY" || return 1
  done
}
test "$IS_P10_B_REPORT_BASE" = "$IS_P10_MEASUREMENT"
git merge-base --is-ancestor "$IS_P10_A_EB" "$IS_P10_B_REPORT_BASE"
assert_report_same "$IS_P10_A_EB" "$IS_P10_B_REPORT_BASE" "$IS_P10_REPORT"
verify_phase_a_keys "$IS_P10_A_EB"
test "$IS_P10_MEASUREMENT_TREE" = "$(git rev-parse "$IS_P10_MEASUREMENT^{tree}")"
test "$IS_P10_GRAPH_SCANNER_BLOB" = "$(git rev-parse "$IS_P10_MEASUREMENT:scripts/module-graph.mjs")"
test "$IS_P10_VALIDATOR_BLOB" = "$(git rev-parse "$IS_P10_MEASUREMENT:scripts/validate-core-optional-map.mjs")"
test -f "$IS_P10_RAW_MAP"
test "$IS_P10_RAW_DIGEST" = "$(sha256sum "$IS_P10_RAW_MAP" | awk '{ print $1 }')"
rg -q '^[0-9a-f]{64}$' <<<"$IS_P10_RAW_DIGEST"
test "$(git rev-list --parents -n 1 "$IS_P10_B_SUBJECT" | wc -w)" -eq 2
test "$(git rev-parse "$IS_P10_B_SUBJECT^")" = "$IS_P10_B_REPORT_BASE"
assert_report_extension "$IS_P10_B_REPORT_BASE" "$IS_P10_B_SUBJECT" "$IS_P10_REPORT" \
  "phaseB.integrationRef: $IS_P10_B_INTEGRATION_REF" \
  "phaseB.reportBaseRevision: $IS_P10_B_REPORT_BASE" \
  "phaseB.measurementRevision: $IS_P10_MEASUREMENT" \
  "phaseB.measurementTree: $IS_P10_MEASUREMENT_TREE" \
  "phaseB.graphScannerBlob: $IS_P10_GRAPH_SCANNER_BLOB" \
  "phaseB.validatorBlob: $IS_P10_VALIDATOR_BLOB" \
  "phaseB.rawDigest: $IS_P10_RAW_DIGEST"
verify_phase_a_keys "$IS_P10_B_SUBJECT"
test "$(git rev-list --parents -n 1 "$IS_P10_B_EA" | wc -w)" -eq 2
test "$(git rev-parse "$IS_P10_B_EA^")" = "$IS_P10_B_SUBJECT"
test "$(git diff --no-renames --name-only "$IS_P10_B_SUBJECT" "$IS_P10_B_EA")" = "$IS_P10_REPORT"
assert_report_append "$IS_P10_B_SUBJECT" "$IS_P10_B_EA" "$IS_P10_REPORT" \
  "phaseB.subjectHead: $IS_P10_B_SUBJECT" 'phaseB.reviewA.verdict: PASS'
verify_phase_a_keys "$IS_P10_B_EA"
test "$(git show "$IS_P10_B_EA:$IS_P10_REPORT" | rg -Fxc "phaseB.integrationRef: $IS_P10_B_INTEGRATION_REF")" -eq 1
test "$(git show "$IS_P10_B_EA:$IS_P10_REPORT" | rg -Fxc "phaseB.reportBaseRevision: $IS_P10_B_REPORT_BASE")" -eq 1
test "$(git show "$IS_P10_B_EA:$IS_P10_REPORT" | rg -Fxc "phaseB.measurementRevision: $IS_P10_MEASUREMENT")" -eq 1
test "$(git show "$IS_P10_B_EA:$IS_P10_REPORT" | rg -Fxc "phaseB.measurementTree: $IS_P10_MEASUREMENT_TREE")" -eq 1
test "$(git show "$IS_P10_B_EA:$IS_P10_REPORT" | rg -Fxc "phaseB.graphScannerBlob: $IS_P10_GRAPH_SCANNER_BLOB")" -eq 1
test "$(git show "$IS_P10_B_EA:$IS_P10_REPORT" | rg -Fxc "phaseB.validatorBlob: $IS_P10_VALIDATOR_BLOB")" -eq 1
test "$(git show "$IS_P10_B_EA:$IS_P10_REPORT" | rg -Fxc "phaseB.rawDigest: $IS_P10_RAW_DIGEST")" -eq 1
test "$(git show "$IS_P10_B_EA:$IS_P10_REPORT" | rg -Fxc "phaseB.subjectHead: $IS_P10_B_SUBJECT")" -eq 1
test "$(git show "$IS_P10_B_EA:$IS_P10_REPORT" | rg -Fxc 'phaseB.reviewA.verdict: PASS')" -eq 1
IS_P10_B_EA_REPORT=$(git show "$IS_P10_B_EA:$IS_P10_REPORT")
if rg -q '^phaseB\.(candidateHead|reviewB\.verdict):' <<<"$IS_P10_B_EA_REPORT"; then
  printf '%s\n' 'forbidden Phase B Review B field in P10 B_EA' >&2
  exit 1
else
  IS_P10_B_FORBIDDEN_STATUS=$?
  test "$IS_P10_B_FORBIDDEN_STATUS" -eq 1
fi
git merge-base --is-ancestor "$IS_P10_B_EA" "$IS_P10_B_C"
assert_report_same "$IS_P10_B_EA" "$IS_P10_B_C" "$IS_P10_REPORT"
test "$(git rev-list --parents -n 1 "$IS_P10_B_EB" | wc -w)" -eq 2
test "$(git rev-parse "$IS_P10_B_EB^")" = "$IS_P10_B_C"
test "$(git diff --no-renames --name-only "$IS_P10_B_C" "$IS_P10_B_EB")" = "$IS_P10_REPORT"
assert_report_append "$IS_P10_B_C" "$IS_P10_B_EB" "$IS_P10_REPORT" \
  "phaseB.candidateHead: $IS_P10_B_C" 'phaseB.reviewB.verdict: PASS'
verify_phase_a_keys "$IS_P10_B_EB"
test "$(git show "$IS_P10_B_EB:$IS_P10_REPORT" | rg -Fxc "phaseB.candidateHead: $IS_P10_B_C")" -eq 1
test "$(git show "$IS_P10_B_EB:$IS_P10_REPORT" | rg -Fxc 'phaseB.reviewB.verdict: PASS')" -eq 1
test "$(git show "$IS_P10_B_EB:$IS_P10_REPORT" | rg -Fxc "phaseB.integrationRef: $IS_P10_B_INTEGRATION_REF")" -eq 1
test "$(git show "$IS_P10_B_EB:$IS_P10_REPORT" | rg -Fxc "phaseB.reportBaseRevision: $IS_P10_B_REPORT_BASE")" -eq 1
test "$(git show "$IS_P10_B_EB:$IS_P10_REPORT" | rg -Fxc "phaseB.measurementRevision: $IS_P10_MEASUREMENT")" -eq 1
test "$(git show "$IS_P10_B_EB:$IS_P10_REPORT" | rg -Fxc "phaseB.measurementTree: $IS_P10_MEASUREMENT_TREE")" -eq 1
test "$(git show "$IS_P10_B_EB:$IS_P10_REPORT" | rg -Fxc "phaseB.graphScannerBlob: $IS_P10_GRAPH_SCANNER_BLOB")" -eq 1
test "$(git show "$IS_P10_B_EB:$IS_P10_REPORT" | rg -Fxc "phaseB.validatorBlob: $IS_P10_VALIDATOR_BLOB")" -eq 1
test "$(git show "$IS_P10_B_EB:$IS_P10_REPORT" | rg -Fxc "phaseB.rawDigest: $IS_P10_RAW_DIGEST")" -eq 1
test "$(git show "$IS_P10_B_EB:$IS_P10_REPORT" | rg -Fxc "phaseB.subjectHead: $IS_P10_B_SUBJECT")" -eq 1
test "$(git show "$IS_P10_B_EB:$IS_P10_REPORT" | rg -Fxc 'phaseB.reviewA.verdict: PASS')" -eq 1
for IS_P10_KEY in phaseB.integrationRef phaseB.reportBaseRevision phaseB.measurementRevision phaseB.measurementTree phaseB.graphScannerBlob phaseB.validatorBlob phaseB.rawDigest phaseB.subjectHead phaseB.reviewA.verdict; do
  assert_one_report_key "$IS_P10_B_EA" "$IS_P10_REPORT" "$IS_P10_KEY" || exit 1
done
for IS_P10_KEY in phaseB.integrationRef phaseB.reportBaseRevision phaseB.measurementRevision phaseB.measurementTree phaseB.graphScannerBlob phaseB.validatorBlob phaseB.rawDigest phaseB.subjectHead phaseB.reviewA.verdict phaseB.candidateHead phaseB.reviewB.verdict; do
  assert_one_report_key "$IS_P10_B_EB" "$IS_P10_REPORT" "$IS_P10_KEY" || exit 1
done
git diff --check "$IS_P10_B_SUBJECT" "$IS_P10_B_EA"
git diff --check "$IS_P10_B_C" "$IS_P10_B_EB"
```

B subject obsahuje klasifikaci bez self SHA; canonical ref se posune až po
metadata gate příslušného `E_B`.
