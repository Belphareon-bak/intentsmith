# WP-M3-L0-8-ENFORCEMENT — samostatný ratchet hranice specialistů

**Typ:** zapisující prerequisite WP
**Stav:** BLOCKED_UNTIL_CONTRACT_MERGE_AND_INTEGRATION_REF
**Source evidence revision:** `0a6bde54e1d2fdf7c284207e9555a0577ce6f6ff`
**Checkout base:** reviewnutý integrační commit obsahující
[`decision 019`](../decisions/019-l0-8-specialist-boundary.md) a tento kontrakt;
přesný SHA zapíše integrátor při aktivaci
**Vychází z:** [`L0-8 boundary evidence`](../review/2026-08-07-L0-8-BOUNDARY.md)

Toto je zadání, ne stav ani důkaz dokončení.

## 0. Aktivační brána

1. Integrační checkout je čistý a contract checkpoint je reviewnutý.
   Canonical `integration/<batch>` ref a exact base SHA jsou pojmenované v
   `docs/execution/runs/wp-m3-l0-8-enforcement-report.md`.
2. Relevantní implementační zdroje se od source evidence revision nezměnily,
   nebo integrátor před aktivací výslovně revalidoval delta.
3. Žádný aktivní WP nevlastní níže uvedené cesty ani stejné registry ID/path.
4. Writer má vlastní disk-backed worktree; nesdílí checkout s M1 writerem.

```bash
git worktree add /home/belphareon/worktrees/is-l0-8-enforcement \
  -b wp/l0-8-enforcement <accepted-contract-checkpoint>
```

`0a6bde54` je měřený zdroj, ne branch base.

Writer v čerstvém worktree spustí `npm ci --offline`; chybějící lokální cache
je `BLOCK`, nikoli oprávnění k online instalaci nebo sdílení `node_modules`.

## 1. Výsledek

Nový offline checker rekurzivně objeví všechny balíčky a spustitelné
`.js`/`.mjs`/`.cjs` soubory v `specialists/**`, vypíše přesné zakázané
`from -> to` odkazy do `src/**` a nedovolí jejich růst. Neznámá executable
extension nebo nečitelný package strom je fail-closed. Dnešní čtyři odkazy jsou
dočasně připnuté; WP je **neopravuje**.

Jde o nezbytný L0 rail, ne o dokončenou capability #8.

## 2. Vlastněné a zakázané cesty

| Druh | Cesty |
|---|---|
| vlastněné | `scripts/specialist-boundary-ratchet.mjs` |
| test a fixture | `tests/specialist-boundary-ratchet.test.js`, `tests/fixtures/specialist-boundary/**` |
| sdílená registry výjimka | pouze nový `suites/<rezervované-id>` v `tests/registry.json` |
| generovaný | branch-local regenerace `docs/convergence/TEST-REGISTRY.md`; integrátor ji na merge SHA regeneruje znovu |
| odvozený registry collateral | `README.md`, ale pouze mechanická synchronizace čtyř čísel odvozených z branch-local registry: celkový počet programů v hlavičce, počet `ACTIVE` v hlavičce a dva komentáře stromu s celkovým počtem; verze ani jiný text se nemění |
| run report | `docs/execution/runs/wp-m3-l0-8-enforcement-report.md`; subject `S` jej nemění, report-only `E_A` připne `S`/Review A a `E_B` připne candidate `C`/Review B |
| zakázané | `src/**`, `specialists/**`, `scripts/module-graph.mjs`, `scripts/module-boundary-ratchet.mjs`, existující registry entries, `schemaVersion`, `exclusions`, globální authority docs a ostatní `docs/**` kromě přesného run reportu |

Checker je samostatný. `module-graph.mjs` dnes v `externalIntoSrc` uvádí dva
deduplikované specialistické páry: accountant runtime import a dummy-logger →
specialist-runtime. Druhý pochází z JSDoc, ale scanner nenese `kind` ani count,
slije dva stejné dummy occurrences a seed JSDoc pár vynechá. Neumí tedy
autoritativně vyjádřit čtyři skutečné výskyty. Existující ratchet navíc vlastní
pouze interní `src/**` `graph.edges`, jinou provenance a už přijatou baseline.
Tyto politiky se neslučují.

Registry rezervace musí obsahovat celý validní záznam:

```text
id: IS-T1-TESTS-SPECIALIST-BOUNDARY-RATCHET-TEST
path: tests/specialist-boundary-ratchet.test.js
argv: ["node", "tests/specialist-boundary-ratchet.test.js"]
capabilityId: C3-027
tier/profile/fixture: T1 / offline / isolated-home
timeoutMs/expectedDurationMs: 120000 / 15000
requirements: {network: none, database: false, server: false, ollama: false, gpu: false}
required: true
owner: WP-M3-L0-8-ENFORCEMENT
state: ACTIVE
lastGreen: {commit: null, artifact: null}
flakeCount: 0
quarantineExpiry: null
```

Program count se ověřuje jako **branch-local +1**, nikdy hardcoded globálním
číslem po merge jiných větví. Stejný branch-local registr je jedinou autoritou
pro čtyři povolené číselné náhrady v root `README.md`; WP nesmí měnit jeho
verzi, prose ani strukturu.

## 3. Connector

**Žádný.** WP nemění registrační `ctx`, produktový contract ani runtime.

## 4. Vstup a závislosti

- source evidence: `0a6bde54`;
- branch base: přijatý contract checkpoint;
- hard dependency: decision 019;
- integrační dependency: `ENFORCEMENT -> INJECTION`;
- nezávisí na M1, M2 ani cestové mapě `CORE/OPTIONAL`.

Baseline je přesně `tests/fixtures/specialist-boundary/baseline.json` a pinuje:

```text
schemaVersion
sourceRevision
specialistsTree
scannerBlob
exceptions[] = {from, to, kind, count, owner, expiresOnIntegration}
```

Povoleny jsou jen exact dvojice **a exact occurrence count**; dvě shodné JSDoc
reference v `dummy-logger/index.js` se nesmějí slít tak, aby třetí výskyt prošel
bez driftu. Tři unikátní dvojice mají celkový count čtyři, owner
`WP-M3-L0-8-INJECTION` a `expiresOnIntegration` stejného WP. Neodpovídající
tree/scanner/revision/count, ručně rozšířená výjimka nebo výjimka přítomná po
injection merge jsou tvrdé selhání. Odstranění výjimek vlastní integrátor na
výsledném merge SHA, ne injection writer.

Checker má také read-only režim `--require-clean`: provede stejnou discovery a
analýzu, ale nezapisuje ani nekonzumuje exception baseline a vyžaduje přesně
nula porušení. Tento režim slouží injection subject branchi, jejíž změna stromu
správně zneplatní starou provenance; novou baseline smí připnout až integrátor.

Bootstrap baseline se nevytváří ruční editací. Z čistého checker subject `S`
ji writer připne explicitním CLI; každá položka uvádí kind, exact pair a count:

```bash
node scripts/specialist-boundary-ratchet.mjs --write-baseline \
  --accept-reference "runtime|specialists/accountant-cz/adapters.js -> src/expertises/tool-adapter.js|1" \
  --accept-reference "jsdoc|specialists/accountant-cz/knowledge/seed.js -> src/expertises/knowledge-base.js|1" \
  --accept-reference "jsdoc|specialists/dummy-logger/index.js -> src/expertises/specialist-runtime.js|2" \
  --owner WP-M3-L0-8-INJECTION \
  --expires-on-integration WP-M3-L0-8-INJECTION
```

Writer odmítne dirty tree, neúplnou či nadbytečnou acceptance, růst mezi scanem
a zápisem a jiný total count. Po injection merge použije integrátor z čistého
commitnutého candidate `C` režim
`--write-baseline --expire-owner WP-M3-L0-8-INJECTION`; ten uspěje jen při nula
aktuálních porušeních a zapíše baseline bez výjimek.

## 5. Malá demonstrace

```bash
node scripts/specialist-boundary-ratchet.mjs
```

Na source stromu: exit `0`, dynamicky zjištěný počet balíčků a právě čtyři
připnuté odkazy — runtime import accountant adaptéru a tři JSDoc type importy.
Každý je vypsaný s `kind`, `from`, `to`, ownerem a expirací.

## 6. Focused pozitivní a negativní testy

Pozitivní test ověří rekurzivní discovery bez hardcoded seznamu balíčků,
porušení mimo entrypoint a reprodukci připnuté baseline.

Negativní testy povinně pokryjí:

1. static import, re-export, literal `import()`, `require()` a JSDoc type import;
2. nový šestý fixture balíček objevený automaticky;
   fixture navíc prokáže discovery `.mjs` a `.cjs` souboru mimo entrypoint;
3. vypočtený import: povolí se jen prokazatelně package-local cíl po
   canonicalizaci přes přesný `computed-package-local` tvar z decision 019;
   oba dnešní `import(tool.modulePath)` call sites musí projít, změna anchoru,
   neliterální filename, caller input nebo unikající cíl fail-closed;
4. read/parse failure a symlink/path escape;
5. porušení v tranzitivním souboru mimo entrypoint;
6. nový exact edge, širokou výjimku, stale provenance a expired výjimku;
7. odstraněnou baseline položku při stále přítomném odkazu;
8. mutation check: dočasné fixture porušení test shodí a po vrácení projde.

Test navíc ověří, že `--require-clean` na čisté fixture projde, na libovolném
porušení selže a nikdy nezmění baseline.
Bootstrap/expiry CLI má negativní test pro chybějící, nadbytečnou a špatně
spočtenou reference, dirty tree a nenulové porušení při `--expire-owner`.

## 7. Stop / eskalace

- **BLOCK:** source census už nejsou právě čtyři odkazy nebo se změnila
  relevantní cesta; worker předá přesný diff integrátorovi a scope nerozšíří.
- **BLOCK:** řešení vyžaduje zápis do `src/**`, `specialists/**` nebo stávajícího
  module ratchetu.
- **BLOCK:** scanner neumí některý syntaktický tvar rozhodnout fail-closed.
- **FINDING:** jiný specialistický problém se pouze uvede v handoffu; tento WP
  nemá vlastnictví pro zápis finding/decision dokumentu.

Žádný `PARK` pro JSDoc neexistuje; decision 019 jej rozhodlo přísně.

## 8. Ověření a přijetí

```bash
set -euo pipefail

IS_L08_ENFORCEMENT_BASE=<full-accepted-contract-checkpoint-sha>
IS_L08_ENFORCEMENT_ALLOWED='^(scripts/specialist-boundary-ratchet\.mjs|tests/specialist-boundary-ratchet\.test\.js|tests/fixtures/specialist-boundary/.*|tests/registry\.json|docs/convergence/TEST-REGISTRY\.md|README\.md)$'
test "$(git merge-base "$IS_L08_ENFORCEMENT_BASE" HEAD)" = "$IS_L08_ENFORCEMENT_BASE"
IS_L08_ENFORCEMENT_SUBJECT=$(git rev-parse --verify HEAD)
node -e "if (Number(process.versions.node.split('.')[0]) !== 22) process.exit(1)"
test "$(npm --version)" = "10.9.4"
npm ci --offline
test -d node_modules
test -z "$(git status --porcelain=v1 --untracked-files=all)"
C3_LOG_LEVEL=error node tests/specialist-boundary-ratchet.test.js
node scripts/specialist-boundary-ratchet.mjs
node scripts/validate-test-registry.js
node - "$IS_L08_ENFORCEMENT_BASE" <<'NODE'
const fs = require('node:fs');
const { execFileSync } = require('node:child_process');

const baseRevision = process.argv[2];
const baseRegistry = JSON.parse(execFileSync(
  'git',
  ['show', `${baseRevision}:tests/registry.json`],
  { encoding: 'utf8' },
));
const currentRegistry = JSON.parse(fs.readFileSync('tests/registry.json', 'utf8'));
const countState = (registry, state) => registry.suites
  .filter(suite => suite.state === state).length;
const assertRegularReadme = revision => {
  const entries = execFileSync(
    'git',
    ['ls-tree', revision, '--', 'README.md'],
    { encoding: 'utf8' },
  ).trimEnd().split('\n').filter(Boolean);
  if (entries.length !== 1
      || !/^100644 blob [0-9a-f]+\tREADME\.md$/.test(entries[0])) {
    throw new Error(`README.md is not exactly one 100644 blob at ${revision}`);
  }
};
const baseTotal = baseRegistry.suites.length;
const currentTotal = currentRegistry.suites.length;
const baseActive = countState(baseRegistry, 'ACTIVE');
const currentActive = countState(currentRegistry, 'ACTIVE');

assertRegularReadme(baseRevision);
assertRegularReadme('HEAD');

if (currentTotal !== baseTotal + 1 || currentActive !== baseActive + 1) {
  throw new Error('specialist registry delta is not exactly one ACTIVE program');
}

const replaceOnce = (source, before, after) => {
  const first = source.indexOf(before);
  if (first === -1 || source.indexOf(before, first + before.length) !== -1) {
    throw new Error(`README marker is missing or duplicated: ${before}`);
  }
  return `${source.slice(0, first)}${after}${source.slice(first + before.length)}`;
};

let expectedReadme = execFileSync(
  'git',
  ['show', `${baseRevision}:README.md`],
  { encoding: 'utf8' },
);
expectedReadme = replaceOnce(
  expectedReadme,
  `**${baseTotal} registrovaných testovacích programů**`,
  `**${currentTotal} registrovaných testovacích programů**`,
);
expectedReadme = replaceOnce(
  expectedReadme,
  `\`${baseActive} ACTIVE\``,
  `\`${currentActive} ACTIVE\``,
);
expectedReadme = replaceOnce(
  expectedReadme,
  `# Testy a kanonický registr ${baseTotal} programů`,
  `# Testy a kanonický registr ${currentTotal} programů`,
);
expectedReadme = replaceOnce(
  expectedReadme,
  `#   Kanonický registr ${baseTotal} programů`,
  `#   Kanonický registr ${currentTotal} programů`,
);

if (fs.readFileSync('README.md', 'utf8') !== expectedReadme) {
  throw new Error('README delta is not the exact four derived registry counts');
}
NODE
node tests/artifact-validation.test.js
C3_LOG_LEVEL=error node tests/repository-hygiene.test.js
node scripts/module-boundary-ratchet.mjs
git diff --no-renames --name-only "$IS_L08_ENFORCEMENT_BASE"...HEAD |
  awk -v allowed="$IS_L08_ENFORCEMENT_ALLOWED" '$0 !~ allowed { print "OUT_OF_SCOPE " $0; bad=1 } END { exit bad }'
git diff --check "$IS_L08_ENFORCEMENT_BASE"...HEAD
test "$(git rev-parse --verify HEAD)" = "$IS_L08_ENFORCEMENT_SUBJECT"
test -z "$(git status --porcelain=v1 --untracked-files=all)"
```

Po Review A a Review B se bez opakování self-reference spustí exact envelope
gate z `CONTRACT.md §6`:

```bash
set -euo pipefail

IS_L08_ENFORCEMENT_BASE=<full-accepted-contract-checkpoint-sha>
IS_L08_ENFORCEMENT_SUBJECT=<full-reviewed-subject-head>
IS_L08_ENFORCEMENT_REPORT='docs/execution/runs/wp-m3-l0-8-enforcement-report.md'
IS_L08_ENFORCEMENT_INTEGRATION_REF=<canonical-integration-ref>
IS_L08_ENFORCEMENT_EA=<full-review-a-evidence-head>
IS_L08_ENFORCEMENT_C=<full-reviewed-merge-candidate-head>
IS_L08_ENFORCEMENT_EB=<full-review-b-evidence-head>
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
assert_report_absent "$IS_L08_ENFORCEMENT_SUBJECT" "$IS_L08_ENFORCEMENT_REPORT"
test "$(git rev-list --parents -n 1 "$IS_L08_ENFORCEMENT_EA" | wc -w)" -eq 2
test "$(git rev-parse "$IS_L08_ENFORCEMENT_EA^")" = "$IS_L08_ENFORCEMENT_SUBJECT"
test "$(git diff --no-renames --name-only "$IS_L08_ENFORCEMENT_SUBJECT" "$IS_L08_ENFORCEMENT_EA")" = "$IS_L08_ENFORCEMENT_REPORT"
test "$(git show "$IS_L08_ENFORCEMENT_EA:$IS_L08_ENFORCEMENT_REPORT" | rg -Fxc "integrationRef: $IS_L08_ENFORCEMENT_INTEGRATION_REF")" -eq 1
test "$(git show "$IS_L08_ENFORCEMENT_EA:$IS_L08_ENFORCEMENT_REPORT" | rg -Fxc "baseRevision: $IS_L08_ENFORCEMENT_BASE")" -eq 1
test "$(git show "$IS_L08_ENFORCEMENT_EA:$IS_L08_ENFORCEMENT_REPORT" | rg -Fxc "subjectHead: $IS_L08_ENFORCEMENT_SUBJECT")" -eq 1
test "$(git show "$IS_L08_ENFORCEMENT_EA:$IS_L08_ENFORCEMENT_REPORT" | rg -Fxc 'reviewA.verdict: PASS')" -eq 1
IS_L08_ENFORCEMENT_EA_REPORT=$(git show "$IS_L08_ENFORCEMENT_EA:$IS_L08_ENFORCEMENT_REPORT")
if rg -q '^(candidateHead|reviewB\.verdict):' <<<"$IS_L08_ENFORCEMENT_EA_REPORT"; then
  printf '%s\n' 'forbidden Review B field in enforcement E_A' >&2
  exit 1
else
  IS_L08_ENFORCEMENT_FORBIDDEN_STATUS=$?
  test "$IS_L08_ENFORCEMENT_FORBIDDEN_STATUS" -eq 1
fi
git merge-base --is-ancestor "$IS_L08_ENFORCEMENT_EA" "$IS_L08_ENFORCEMENT_C"
assert_report_same "$IS_L08_ENFORCEMENT_EA" "$IS_L08_ENFORCEMENT_C" "$IS_L08_ENFORCEMENT_REPORT"
test "$(git rev-list --parents -n 1 "$IS_L08_ENFORCEMENT_EB" | wc -w)" -eq 2
test "$(git rev-parse "$IS_L08_ENFORCEMENT_EB^")" = "$IS_L08_ENFORCEMENT_C"
test "$(git diff --no-renames --name-only "$IS_L08_ENFORCEMENT_C" "$IS_L08_ENFORCEMENT_EB")" = "$IS_L08_ENFORCEMENT_REPORT"
assert_report_append "$IS_L08_ENFORCEMENT_C" "$IS_L08_ENFORCEMENT_EB" "$IS_L08_ENFORCEMENT_REPORT" \
  "candidateHead: $IS_L08_ENFORCEMENT_C" 'reviewB.verdict: PASS'
test "$(git show "$IS_L08_ENFORCEMENT_EB:$IS_L08_ENFORCEMENT_REPORT" | rg -Fxc "candidateHead: $IS_L08_ENFORCEMENT_C")" -eq 1
test "$(git show "$IS_L08_ENFORCEMENT_EB:$IS_L08_ENFORCEMENT_REPORT" | rg -Fxc 'reviewB.verdict: PASS')" -eq 1
test "$(git show "$IS_L08_ENFORCEMENT_EB:$IS_L08_ENFORCEMENT_REPORT" | rg -Fxc "integrationRef: $IS_L08_ENFORCEMENT_INTEGRATION_REF")" -eq 1
test "$(git show "$IS_L08_ENFORCEMENT_EB:$IS_L08_ENFORCEMENT_REPORT" | rg -Fxc "baseRevision: $IS_L08_ENFORCEMENT_BASE")" -eq 1
test "$(git show "$IS_L08_ENFORCEMENT_EB:$IS_L08_ENFORCEMENT_REPORT" | rg -Fxc "subjectHead: $IS_L08_ENFORCEMENT_SUBJECT")" -eq 1
test "$(git show "$IS_L08_ENFORCEMENT_EB:$IS_L08_ENFORCEMENT_REPORT" | rg -Fxc 'reviewA.verdict: PASS')" -eq 1
for IS_L08_KEY in integrationRef baseRevision subjectHead reviewA.verdict; do
  assert_one_report_key "$IS_L08_ENFORCEMENT_EA" "$IS_L08_ENFORCEMENT_REPORT" "$IS_L08_KEY" || exit 1
done
for IS_L08_KEY in integrationRef baseRevision subjectHead reviewA.verdict candidateHead reviewB.verdict; do
  assert_one_report_key "$IS_L08_ENFORCEMENT_EB" "$IS_L08_ENFORCEMENT_REPORT" "$IS_L08_KEY" || exit 1
done
git diff --check "$IS_L08_ENFORCEMENT_SUBJECT" "$IS_L08_ENFORCEMENT_EA"
git diff --check "$IS_L08_ENFORCEMENT_C" "$IS_L08_ENFORCEMENT_EB"
```

Očekávání: všechny exity `0`; registry má branch-local +1 a čtyři odvozená
čísla v root `README.md` s ní přesně souhlasí; interní module ratchet nemá nový
edge; změněné cesty jsou přesně z §2. `git diff --check`
ověřuje whitespace, nikoli scope ani graf — ty dokazují samostatné dva řádky.

`E_A` i `E_B` mění právě tento report; jejich metadata gate se nevpisuje zpět
do kontrolované obálky. Integrátor spustí oba ratchety a registry validaci na
`C`; canonical integration ref posune až na ověřený `E_B`.
