# WP-M3-L0-8-INJECTION — uzavření L0-8 strict injectionem

**Typ:** zapisující prerequisite WP
**Stav:** BLOCKED_BY_ENFORCEMENT
**Source evidence revision:** `0a6bde54e1d2fdf7c284207e9555a0577ce6f6ff`
**Checkout base:** přijatý integrační commit po
`WP-M3-L0-8-ENFORCEMENT`; přesný SHA zapíše integrátor při aktivaci
**Vychází z:** [`decision 019`](../decisions/019-l0-8-specialist-boundary.md)

Toto je zadání, ne stav ani specialista E2E.

## 0. Aktivační brána

1. Enforcement WP je přijatý a integrovaný; jeho checker na integračním SHA
   prokazatelně vidí dnešní čtyři odkazy.
   Canonical `integration/<batch>` ref a exact base SHA jsou zapsané v
   `docs/execution/runs/wp-m3-l0-8-injection-report.md`.
2. Integrační checkout je čistý a relevantní delta proti source evidence je
   reviewnutá.
3. Žádný aktivní WP nevlastní loader, accountant/dummy balíček nebo stejné
   testy.
4. Writer má vlastní disk-backed worktree.

```bash
git worktree add /home/belphareon/worktrees/is-l0-8-injection \
  -b wp/l0-8-injection <enforcement-merge-checkpoint>
```

## 1. Výsledek

Všechny čtyři odkazy `specialists/** -> src/**` zmizí. Accountant dostane
`ToolAdapter` přes registrační `ctx`, zachová dnešní výpočet i clarify větev a
chybějící capability selže deklarovaně před registrací.

Loader zároveň uzavře nález L8-2: celý balíček se prověří fail-closed před
prvním module importem nebo `register()`; zakázaný tranzitivní soubor tedy
nemůže nejdřív vykonat top-level side effect.

Výsledek je L0 prerequisite a regrese stávajícího chování. Není to důkaz
enable → route → output → disable journey ani splnění capability #8.

## 2. Vlastněné a zakázané cesty

| Druh | Cesty |
|---|---|
| accountant runtime | `specialists/accountant-cz/adapters.js`, `specialists/accountant-cz/index.js` |
| strict type cleanup | `specialists/accountant-cz/knowledge/seed.js`, `specialists/dummy-logger/index.js` |
| composition root | `src/specialists/specialist-loader.js` |
| focused testy | `tests/accountant-self-contained.test.js`, `tests/specialist-loader.test.js`, `tests/tool-adapter.test.js` |
| run report | `docs/execution/runs/wp-m3-l0-8-injection-report.md`; subject `S` jej nemění, report-only `E_A` připne `S`/Review A a `E_B` připne candidate `C`/Review B |
| read-only dependency | `src/expertises/tool-adapter.js` — změna není povolena |
| registry | bez změny; všechny tři sady už jsou registrované |
| zakázané | ostatní `src/**`, ostatní specialistické balíčky, `scripts/**`, `contracts/**`, registry, authority a decision docs, ostatní run reporty, module/specialist baseline |

Případná potřeba změnit `tool-adapter.js`, další balíček nebo M1 cestu je
`BLOCK`, nikoli tiché rozšíření scope.

## 3. Connector

WP vlastní dnešní interní registrační `ctx` pouze po dobu změny a přidá právě
jedno povinné pole `ToolAdapter`. Chybějící pole se validuje před importem
accountant implementace.

Manifest, `coreContract`, `requiredCapabilities`, semver ani veřejné SDK se
nezavádějí. Budoucí verzovanou podobu vlastní `WP-M3-BOUNDARY`; tento závazek
je uložen v decision 019, injection worker kvůli němu nemění globální docs.

## 4. Vstup, závislosti a integrační delta

- source evidence: `0a6bde54`;
- branch base: přijatý enforcement merge checkpoint;
- hard dependency: decision 019 a integrovaný enforcement;
- žádná dependency na M1/M2 runtime;
- integrační pořadí: enforcement → injection → baseline tightening.

Import `ToolAdapter` do loaderu vytvoří jedinou očekávanou interní hranu:

```text
src/specialists/specialist-loader.js -> src/expertises/tool-adapter.js
```

Feature branch proto očekává `MODULE_BOUNDARY_RATCHET_FAIL` s právě jedním
`ADDED` edge, ne falešný výsledek `baseline=actual, added=0`. Konkrétní počet
hran se odvodí na exact branch base a nesmí se kopírovat ze statického WP.
Teprve integrátorův první
`--write-baseline` průchod na merge candidate vypíše `ACCEPTANCE_REQUIRED`;
přesnou hranu přijme následný `--accept-edge`. Jiná hrana nebo cyklus je
`BLOCK`.

Injection writer nesmí měnit ani specialistickou, ani module baseline.
Integrátor po merge odstraní čtyři expirované L0-8 výjimky, připne novou clean
baseline a regeneruje integrační evidence.

## 5. Malá demonstrace

- `adapters.js` exportuje factory `createAdapters(ToolAdapter)`; pět tříd se
  vytvoří až uvnitř factory.
- `index.js` předá `ctx.ToolAdapter` oběma cestám sestavení tool definitions.
- loader vloží jedinou identitu třídy do `ctx` a před importem spustí
  rekurzivní package preflight.
- tři JSDoc type importy se nahradí lokálními strukturálními typedefy bez
  odkazu do core.

Očekávaná regrese:

```text
status: ok | net: 735892 | tax: 114108
clarify: clarify ["gross_income"]
```

## 6. Focused pozitivní a negativní testy

Pozitivně musí projít stávající accountant, loader a tool-adapter baterie;
factory vrátí stejné tools a instance sdílejí přesnou identitu
`ctx.ToolAdapter`.

Negativní testy povinně ověří:

1. chybějící `ctx.ToolAdapter` selže pojmenovanou chybou před registrací;
2. rekurzivní preflight objeví porušení mimo `manifest.entry`;
   discovery zahrnuje `.js`, `.mjs` i `.cjs` a neznámou executable extension
   nebo nečitelný package strom odmítne;
3. fixture s top-level side-effect markerem při porušení marker **nevytvoří**;
4. read/parse failure, symlink/path escape a neprokazatelný computed import
   fail-closed; dnešní accountant a code-reviewer `import(tool.modulePath)`
   projdou pouze přes exact `computed-package-local` proof z decision 019
   (`__dirname/tools`, literal `.js`, regular-file realpath uvnitř package);
5. žádný static, dynamic, require, re-export ani JSDoc odkaz do `src/**`
   nezůstane ve všech pěti balíčcích;
6. vypnutý nebo odinstalovaný specialista se neregistruje a nemá side effect;
7. změna nevytvoří druhou identitu `ToolAdapter` ani npm/workspace dependency.

Standalone checker se na subject branchi spustí v režimu `--require-clean`,
který vyžaduje nula porušení bez zápisu baseline. Baseline provenance opravuje
až integrátor.

## 7. Stop / eskalace

- **BLOCK:** `ToolAdapter` má proti source evidence nový import nebo potřebuje
  další injected symbol.
- **BLOCK:** je nutný zásah do M1, veřejného connectoru, manifestu, npm
  workspace nebo cesty mimo §2.
- **BLOCK:** preflight neumí před importem fail-closed rozhodnout existující
  package pattern.
- **BLOCK:** module graph ukáže jinou novou hranu nebo růst SCC/cyklu.
- **FINDING:** duplicita tools L8-3 a core kopie bez konzumenta L8-4 se pouze
  předají integrátorovi; zde se neopravují.

## 8. Ověření a přijetí

```bash
set -euo pipefail

IS_L08_INJECTION_BASE=<full-enforcement-merge-checkpoint-sha>
IS_L08_INJECTION_ALLOWED='^(specialists/accountant-cz/(adapters\.js|index\.js|knowledge/seed\.js)|specialists/dummy-logger/index\.js|src/specialists/specialist-loader\.js|tests/(accountant-self-contained|specialist-loader|tool-adapter)\.test\.js)$'
test "$(git merge-base "$IS_L08_INJECTION_BASE" HEAD)" = "$IS_L08_INJECTION_BASE"
IS_L08_INJECTION_SUBJECT=$(git rev-parse --verify HEAD)
node -e "if (Number(process.versions.node.split('.')[0]) !== 22) process.exit(1)"
test "$(npm --version)" = "10.9.4"
npm ci --offline
test -d node_modules
test -z "$(git status --porcelain=v1 --untracked-files=all)"
C3_LOG_LEVEL=error node tests/accountant-self-contained.test.js
C3_LOG_LEVEL=error node tests/tool-adapter.test.js
C3_LOG_LEVEL=error node tests/specialist-loader.test.js
node scripts/specialist-boundary-ratchet.mjs --require-clean
if IS_L08_MODULE_OUTPUT=$(node scripts/module-boundary-ratchet.mjs 2>&1); then
  printf '%s\n' 'expected module boundary ratchet failure' >&2
  exit 1
else
  IS_L08_MODULE_STATUS=$?
fi
test "$IS_L08_MODULE_STATUS" -eq 1
test "$(rg -c '^ADDED ' <<<"$IS_L08_MODULE_OUTPUT")" -eq 1
rg -Fxq 'ADDED src/specialists/specialist-loader.js -> src/expertises/tool-adapter.js' \
  <<<"$IS_L08_MODULE_OUTPUT"
rg -q '^MODULE_BOUNDARY_RATCHET_FAIL ' <<<"$IS_L08_MODULE_OUTPUT"
if rg -q '^(CYCLE_COUNT_GREW|FILES_IN_CYCLES_GREW|ACCEPTANCE_REQUIRED)' \
  <<<"$IS_L08_MODULE_OUTPUT"; then
  printf '%s\n' 'unexpected cycle growth or acceptance request in read-only mode' >&2
  exit 1
else
  IS_L08_FORBIDDEN_OUTPUT_STATUS=$?
  test "$IS_L08_FORBIDDEN_OUTPUT_STATUS" -eq 1
fi
node scripts/validate-test-registry.js
C3_LOG_LEVEL=error node tests/repository-hygiene.test.js
git diff --no-renames --name-only "$IS_L08_INJECTION_BASE"...HEAD |
  awk -v allowed="$IS_L08_INJECTION_ALLOWED" '$0 !~ allowed { print "OUT_OF_SCOPE " $0; bad=1 } END { exit bad }'
git diff --check "$IS_L08_INJECTION_BASE"...HEAD
test "$(git rev-parse --verify HEAD)" = "$IS_L08_INJECTION_SUBJECT"
test -z "$(git status --porcelain=v1 --untracked-files=all)"
```

Vše kromě interního module ratchetu má exit `0`. Normální ratchet musí skončit
`1` s `MODULE_BOUNDARY_RATCHET_FAIL`, právě jedním `ADDED` edge z §4 a bez
růstu cyklu; `ACCEPTANCE_REQUIRED` se v normálním režimu neočekává.

Na čistém commitnutém queue candidate integrátor provede přesně:

```bash
set -euo pipefail

test -z "$(git status --porcelain=v1 --untracked-files=all)"
if IS_L08_ACCEPT_OUTPUT=$(node scripts/module-boundary-ratchet.mjs --write-baseline 2>&1); then
  printf '%s\n' 'expected explicit edge acceptance request' >&2
  exit 1
else
  IS_L08_ACCEPT_STATUS=$?
fi
test "$IS_L08_ACCEPT_STATUS" -eq 1
test "$(rg -c '^ACCEPTANCE_REQUIRED ' <<<"$IS_L08_ACCEPT_OUTPUT")" -eq 1
rg -Fxq 'ACCEPTANCE_REQUIRED src/specialists/specialist-loader.js -> src/expertises/tool-adapter.js' \
  <<<"$IS_L08_ACCEPT_OUTPUT"
test -z "$(git status --porcelain=v1 --untracked-files=all)"
node scripts/module-boundary-ratchet.mjs --write-baseline \
  --accept-edge "src/specialists/specialist-loader.js -> src/expertises/tool-adapter.js"
git add tests/fixtures/module-boundary/baseline.json
git commit -m "test(boundary): accept L0-8 injection edge"
test -z "$(git status --porcelain=v1 --untracked-files=all)"
node scripts/specialist-boundary-ratchet.mjs --write-baseline \
  --expire-owner WP-M3-L0-8-INJECTION
git add tests/fixtures/specialist-boundary/baseline.json
git commit -m "test(boundary): expire L0-8 source exceptions"
test -z "$(git status --porcelain=v1 --untracked-files=all)"
```

Každý writer-mode krok začíná z čistého stromu; proto jsou baseline změny dva
oddělené integrační commity. Výsledný immutable commit je candidate `C` a na
něm integrátor znovu vyžaduje oba ratchety, registry, focused testy a hygiene s
exitem `0`. Report obálky se ověří přesně takto:

```bash
set -euo pipefail

IS_L08_INJECTION_BASE=<full-enforcement-merge-checkpoint-sha>
IS_L08_INJECTION_SUBJECT=<full-reviewed-subject-head>
IS_L08_INJECTION_REPORT='docs/execution/runs/wp-m3-l0-8-injection-report.md'
IS_L08_INJECTION_INTEGRATION_REF=<canonical-integration-ref>
IS_L08_INJECTION_EA=<full-review-a-evidence-head>
IS_L08_INJECTION_C=<full-reviewed-final-candidate-head>
IS_L08_INJECTION_EB=<full-review-b-evidence-head>
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
assert_report_absent "$IS_L08_INJECTION_SUBJECT" "$IS_L08_INJECTION_REPORT"
test "$(git rev-list --parents -n 1 "$IS_L08_INJECTION_EA" | wc -w)" -eq 2
test "$(git rev-parse "$IS_L08_INJECTION_EA^")" = "$IS_L08_INJECTION_SUBJECT"
test "$(git diff --no-renames --name-only "$IS_L08_INJECTION_SUBJECT" "$IS_L08_INJECTION_EA")" = "$IS_L08_INJECTION_REPORT"
test "$(git show "$IS_L08_INJECTION_EA:$IS_L08_INJECTION_REPORT" | rg -Fxc "integrationRef: $IS_L08_INJECTION_INTEGRATION_REF")" -eq 1
test "$(git show "$IS_L08_INJECTION_EA:$IS_L08_INJECTION_REPORT" | rg -Fxc "baseRevision: $IS_L08_INJECTION_BASE")" -eq 1
test "$(git show "$IS_L08_INJECTION_EA:$IS_L08_INJECTION_REPORT" | rg -Fxc "subjectHead: $IS_L08_INJECTION_SUBJECT")" -eq 1
test "$(git show "$IS_L08_INJECTION_EA:$IS_L08_INJECTION_REPORT" | rg -Fxc 'reviewA.verdict: PASS')" -eq 1
IS_L08_INJECTION_EA_REPORT=$(git show "$IS_L08_INJECTION_EA:$IS_L08_INJECTION_REPORT")
if rg -q '^(candidateHead|reviewB\.verdict):' <<<"$IS_L08_INJECTION_EA_REPORT"; then
  printf '%s\n' 'forbidden Review B field in injection E_A' >&2
  exit 1
else
  IS_L08_INJECTION_FORBIDDEN_STATUS=$?
  test "$IS_L08_INJECTION_FORBIDDEN_STATUS" -eq 1
fi
git merge-base --is-ancestor "$IS_L08_INJECTION_EA" "$IS_L08_INJECTION_C"
assert_report_same "$IS_L08_INJECTION_EA" "$IS_L08_INJECTION_C" "$IS_L08_INJECTION_REPORT"
test "$(git rev-list --parents -n 1 "$IS_L08_INJECTION_EB" | wc -w)" -eq 2
test "$(git rev-parse "$IS_L08_INJECTION_EB^")" = "$IS_L08_INJECTION_C"
test "$(git diff --no-renames --name-only "$IS_L08_INJECTION_C" "$IS_L08_INJECTION_EB")" = "$IS_L08_INJECTION_REPORT"
assert_report_append "$IS_L08_INJECTION_C" "$IS_L08_INJECTION_EB" "$IS_L08_INJECTION_REPORT" \
  "candidateHead: $IS_L08_INJECTION_C" 'reviewB.verdict: PASS'
test "$(git show "$IS_L08_INJECTION_EB:$IS_L08_INJECTION_REPORT" | rg -Fxc "candidateHead: $IS_L08_INJECTION_C")" -eq 1
test "$(git show "$IS_L08_INJECTION_EB:$IS_L08_INJECTION_REPORT" | rg -Fxc 'reviewB.verdict: PASS')" -eq 1
test "$(git show "$IS_L08_INJECTION_EB:$IS_L08_INJECTION_REPORT" | rg -Fxc "integrationRef: $IS_L08_INJECTION_INTEGRATION_REF")" -eq 1
test "$(git show "$IS_L08_INJECTION_EB:$IS_L08_INJECTION_REPORT" | rg -Fxc "baseRevision: $IS_L08_INJECTION_BASE")" -eq 1
test "$(git show "$IS_L08_INJECTION_EB:$IS_L08_INJECTION_REPORT" | rg -Fxc "subjectHead: $IS_L08_INJECTION_SUBJECT")" -eq 1
test "$(git show "$IS_L08_INJECTION_EB:$IS_L08_INJECTION_REPORT" | rg -Fxc 'reviewA.verdict: PASS')" -eq 1
for IS_L08_KEY in integrationRef baseRevision subjectHead reviewA.verdict; do
  assert_one_report_key "$IS_L08_INJECTION_EA" "$IS_L08_INJECTION_REPORT" "$IS_L08_KEY" || exit 1
done
for IS_L08_KEY in integrationRef baseRevision subjectHead reviewA.verdict candidateHead reviewB.verdict; do
  assert_one_report_key "$IS_L08_INJECTION_EB" "$IS_L08_INJECTION_REPORT" "$IS_L08_KEY" || exit 1
done
git diff --check "$IS_L08_INJECTION_SUBJECT" "$IS_L08_INJECTION_EA"
git diff --check "$IS_L08_INJECTION_C" "$IS_L08_INJECTION_EB"
```

`E_B` zapíše `C` a Review B, ale nikoli vlastní SHA. Canonical integration ref
se posune na `E_B` až po samostatném metadata gate; runtime/source strom mezi
`C` a `E_B` je díky exact one-path diffu totožný.
