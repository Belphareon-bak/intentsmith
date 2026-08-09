# WP-M2-OUTBOUND-PILOT — web search a scrape přes canonical network effect

**Typ:** zapisující M2 consumer WP
**Stav:** BLOCKED_BY_M1_AND_M2_EFFECT
**Source evidence revision:** `0a6bde54e1d2fdf7c284207e9555a0577ce6f6ff`
**Checkout base:** přijatý integrační commit po `WP-M2-EFFECT` a připnutí
`ToolRequest/Result`; přesný SHA zapíše integrátor při aktivaci
**Vychází z:** [`OUTBOUND-CENSUS`](../review/2026-08-07-OUTBOUND-CENSUS.md)

Tento kontrakt nahrazuje chybný návrh `WP-M5-OUTBOUND-GATE`. Flag bez exact
scope, approval a durable auditu není L0-12 gate.

## 0. Aktivační brána

1. M1 je přijaté a M2 je podle roadmapy otevřené.
2. `WP-M2-EFFECT` integroval verzované `EffectRequest/Result` a
   `ApprovalGrant` včetně canonical `network.request`, timeout/cancel,
   persistentního auditu a URL/DNS/redirect policy.
3. Vlastník `ToolRequest/Result` připnul risk class a překlad tool → effect.
4. Žádný aktivní writer nevlastní stejné metody nebo connector.
5. Canonical `integration/<batch>` ref a exact base SHA jsou zapsané v
   `docs/execution/runs/wp-m2-outbound-pilot-report.md`; writer z něj větví do
   vlastního worktree.

```bash
git worktree add /home/belphareon/worktrees/is-m2-outbound-pilot \
  -b wp/m2-outbound-pilot <m2-effect-and-tools-checkpoint>
```

Pokud provider/connector ještě neexistuje, WP se **nesmí** obejít lokálním
„malým brokerem“.

Čerstvý worktree musí mít reprodukovatelné závislosti z lockfilu:

```bash
npm ci --offline
```

Chybějící offline cache je `BLOCK`; writer nesmí tiše přepnout na síťovou
instalaci ani použít `node_modules` z jiného checkoutu.

## 1. Výsledek

LLM-inicovaný web search ani scrape neotevře spojení bez single-use approvalu
svázaného s normalizovaným requestem, projektem, runem, expirací a cílovým
scope. Deny skončí typovaným výsledkem před DNS/transport efektem. Allow má
durable intent/outcome audit a respektuje cancel/timeout.

Web nástroje jsou defaultně nedostupné bez explicitního grantu. Neexistuje
fallback „při chybě zkus fetch přímo“ ani prázdný úspěch.

## 2. Vlastněné a zakázané cesty

| Druh | Cesty |
|---|---|
| runtime consumer | `src/executor/tool-executor.js` — pouze `executeWebSearch` a scrape větev; `src/llm/web-search.js` — pouze adapter na přijatý network effect |
| focused test | `tests/m2-outbound-pilot.test.js` |
| run report | `docs/execution/runs/wp-m2-outbound-pilot-report.md`; subject `S` jej nemění, report-only `E_A` připne `S`/Review A a `E_B` připne candidate `C`/Review B |
| registry | pouze nový rezervovaný entry v `tests/registry.json` |
| generovaný | branch-local `docs/convergence/TEST-REGISTRY.md`; integrátor regeneruje na merge SHA |
| zakázané | provider/broker a approval implementace M2, `src/llm/gateway.js`, ostatní executor/LLM metody, `src/config.js`, DB schema, chat/WS/routes, authority/decision docs, ostatní run reporty a existující registry entries |

Registry entry používá plné povinné pole stejně jako ostatní aktivní sady:

```text
id: IS-T1-TESTS-M2-OUTBOUND-PILOT-TEST
path: tests/m2-outbound-pilot.test.js
argv: ["node", "tests/m2-outbound-pilot.test.js"]
capabilityId: C3-020
tier/profile/fixture: T1 / offline / isolated-home
timeoutMs/expectedDurationMs: 120000 / 20000
requirements: {network: none, database: false, server: false, ollama: false, gpu: false}
required: true
owner: WP-M2-OUTBOUND-PILOT
state: ACTIVE
lastGreen: {commit: null, artifact: null}
flakeCount: 0
quarantineExpiry: null
```

## 3. Connector

WP **konzumuje, nemění** přijaté verze `ToolRequest/Result`,
`EffectRequest/Result` a `ApprovalGrant`.

Canonical network request musí nejméně nést method, canonical URL/origin,
redirect policy, timeout, request payload digest, project/run identity a exact
approval reference. Result rozliší deny, timeout, cancel, transport failure a
validní odpověď; telemetry není náhrada durable auditu.

Search dnes není jeden transport: má DDG pokus, až pět paralelních SearX originů
a ToolExecutor může podle výsledku zopakovat search s deterministicky
`simplified` nebo `broadened` query. Před approvalem se proto z původního vstupu
vypočítá exact normalizovaný **provider/query plan**: ordered originy, method,
digest původní i všech dovolených odvozených query variant, jejich pořadí a
branch predicate, maximální celkový attempt budget a concurrency. Varianta,
která není předem v plánu, potřebuje nový grant nebo fail-closed deny.

Každý konkrétní transport je samostatný `network.request` child effect pod
tímto plánem, má před transportem stabilní `effectId` a exact payload digest a
dostane vlastní intent/outcome audit. Parent plan je jen omezené seskupení a
auditní korelace, **není** znovupoužitelný authority grant. Approval service smí
jedním uživatelským rozhodnutím atomicky vydat konečnou sadu exact single-use
child grantů — jeden grant pro jeden předem materializovaný child effect — jen
pokud tuto batch operaci vlastní a testuje přijatý M2 connector. Jinak musí
uživatel schválit každý child zvlášť. Consumer nikdy sám neodvozuje grant ani
nepřepisuje jeho scope.

Grant pro původní query neautorizuje jiný digest; grant pro DDG neautorizuje
SearX a grant pro jeden SearX origin neautorizuje jiný. Nevyužité child granty
se po vítězi, cancelu, timeoutu nebo konci runu atomicky revokují. Loser requesty
se zruší a auditují; nedeklarovaný fallback, reuse child grantu nebo překročený
souhrnný budget selže před transportem.

Scrape grant pinuje jedinou canonical URL/origin. Každý redirect se znovu
canonicalizuje a kontroluje proti schválenému scope; cross-origin redirect bez
samostatně schváleného cíle je deny.

Jakákoli potřeba měnit connector shape vrací práci jeho vlastníkovi a blokuje
tento consumer WP.

## 4. Vstup a závislosti

- source evidence: `0a6bde54`, kde census zachytil přímou fetch cestu;
- branch base: post-M1, post-`WP-M2-EFFECT`, post-tool-contract checkpoint;
- hard dependency: M1 acceptance, canonical network effect, approval a audit;
- předchází M5 residual census; není M5 náhradou;
- L0-8 je nezávislé.

Při aktivaci integrátor znovu trasuje skutečný call graph obou metod. Nový
callsite nebo direct fetch mimo owned scope je `BLOCK`, ne implicitní rozšíření.

## 5. Malá demonstrace

S test-owned fake network adapterem:

```text
without grant -> EFFECT_DENIED, transportAttempts=0, durable deny receipt
search plan   -> only declared origins, bounded attempts, audit per attempt
scrape grant  -> one canonical target, one attempt, one intent/outcome audit
```

Stejná demonstrace proběhne pro search i scrape. Pozitivní kontrola fake
transportu je povinná; jinak by nula pokusů mohla znamenat rozbitý měřicí šev.

## 6. Focused pozitivní a negativní testy

Pozitivní test pokryje exact provider plan pro search, exact URL grant pro
scrape, validovaný response a spárovaný durable audit každého skutečného
transport attemptu.

Negativní testy povinně pokryjí:

1. chybějící, expired, revoked, reused a payload/project/run-mismatched grant;
2. deny před DNS, redirectem nebo transportem (`transportAttempts=0`);
3. canonicalization změnu po approvalu;
4. search provider plan: grant pro jeden origin nesmí povolit jiný, fan-out
   nepřekročí schválený počet/concurrency a Promise.any losers se zruší i
   auditují;
5. simplified/broadened retry smí použít jen předem vypočtený digest, pořadí a
   branch predicate; změněná či třetí query varianta, nový grantless retry a
   překročení celkového attempt budgetu selžou před transportem;
6. loopback, RFC1918, link-local, IPv6 local, metadata endpoint, DNS rebinding a
   redirect na zakázanou adresu;
7. timeout/cancel před spojením i během body read, bez orphan effectu;
8. audit write failure fail-closed před transportem;
9. chybějící, reused nebo scope-mismatched child grant selže před transportem;
   jeden approval event případně vydá právě deklarovaný počet navzájem
   odlišných exact grantů a všechny nevyužité revokuje;
10. selhání durable outcome auditu **po** fake transportu nesmí vrátit success;
    vrátí typovaný audit-persistence failure a zachová recovery evidence;
11. žádný direct `fetch` fallback a žádný prázdný success;
12. fake positive control, který prokáže, že instrumentace skutečně vidí pokus.

Sada zůstane `network:none`; žádný test nepoužije internet ani Ollamu.

## 7. Stop / eskalace

- **BLOCK:** chybí canonical provider, exact approval, persistentní audit nebo
  SSRF/redirect policy.
- **BLOCK:** M2 neumí vydat exact child grant pro každý materializovaný attempt
  (jednotlivě nebo atomickou bounded batch operací); consumer tuto autoritu
  nesmí doplnit bokem.
- **BLOCK:** je nutná změna `gateway.js`, veřejného connectoru, DB schema nebo
  jiné executor metody.
- **BLOCK:** existuje další LLM-inicovaný outbound callsite mimo dva změřené;
  předat vlastníkovi M2/M5 census, nerozšířit scope.
- **FINDING:** nesouvisející vada search/scrape se předá integrátorovi bez
  opravy v této větvi.

Default `ON` ani rozhodnutí uvnitř writer branche nejsou povolené.

## 8. Ověření a přijetí

```bash
set -euo pipefail

IS_M2_BASE=<full-m2-effect-and-tools-checkpoint-sha>
IS_M2_ALLOWED='^(src/executor/tool-executor\.js|src/llm/web-search\.js|tests/m2-outbound-pilot\.test\.js|tests/registry\.json|docs/convergence/TEST-REGISTRY\.md)$'
test "$(git merge-base "$IS_M2_BASE" HEAD)" = "$IS_M2_BASE"
IS_M2_SUBJECT=$(git rev-parse --verify HEAD)
node -e "if (Number(process.versions.node.split('.')[0]) !== 22) process.exit(1)"
test "$(npm --version)" = "10.9.4"
npm ci --offline
test -d node_modules
test -z "$(git status --porcelain=v1 --untracked-files=all)"
C3_LOG_LEVEL=error node tests/m2-outbound-pilot.test.js
node scripts/validate-test-registry.js
node scripts/module-boundary-ratchet.mjs
C3_LOG_LEVEL=error node tests/repository-hygiene.test.js
git diff --no-renames --name-only "$IS_M2_BASE"...HEAD |
  awk -v allowed="$IS_M2_ALLOWED" '$0 !~ allowed { print "OUT_OF_SCOPE " $0; bad=1 } END { exit bad }'
git diff --check "$IS_M2_BASE"...HEAD
test "$(git rev-parse --verify HEAD)" = "$IS_M2_SUBJECT"
test -z "$(git status --porcelain=v1 --untracked-files=all)"
```

```bash
set -euo pipefail

IS_M2_BASE=<full-m2-effect-and-tools-checkpoint-sha>
IS_M2_SUBJECT=<full-reviewed-subject-head>
IS_M2_REPORT='docs/execution/runs/wp-m2-outbound-pilot-report.md'
IS_M2_INTEGRATION_REF=<canonical-integration-ref>
IS_M2_EA=<full-review-a-evidence-head>
IS_M2_C=<full-reviewed-merge-candidate-head>
IS_M2_EB=<full-review-b-evidence-head>
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
assert_report_absent "$IS_M2_SUBJECT" "$IS_M2_REPORT"
test "$(git rev-list --parents -n 1 "$IS_M2_EA" | wc -w)" -eq 2
test "$(git rev-parse "$IS_M2_EA^")" = "$IS_M2_SUBJECT"
test "$(git diff --no-renames --name-only "$IS_M2_SUBJECT" "$IS_M2_EA")" = "$IS_M2_REPORT"
test "$(git show "$IS_M2_EA:$IS_M2_REPORT" | rg -Fxc "integrationRef: $IS_M2_INTEGRATION_REF")" -eq 1
test "$(git show "$IS_M2_EA:$IS_M2_REPORT" | rg -Fxc "baseRevision: $IS_M2_BASE")" -eq 1
test "$(git show "$IS_M2_EA:$IS_M2_REPORT" | rg -Fxc "subjectHead: $IS_M2_SUBJECT")" -eq 1
test "$(git show "$IS_M2_EA:$IS_M2_REPORT" | rg -Fxc 'reviewA.verdict: PASS')" -eq 1
IS_M2_EA_REPORT=$(git show "$IS_M2_EA:$IS_M2_REPORT")
if rg -q '^(candidateHead|reviewB\.verdict):' <<<"$IS_M2_EA_REPORT"; then
  printf '%s\n' 'forbidden Review B field in M2 E_A' >&2
  exit 1
else
  IS_M2_FORBIDDEN_STATUS=$?
  test "$IS_M2_FORBIDDEN_STATUS" -eq 1
fi
git merge-base --is-ancestor "$IS_M2_EA" "$IS_M2_C"
assert_report_same "$IS_M2_EA" "$IS_M2_C" "$IS_M2_REPORT"
test "$(git rev-list --parents -n 1 "$IS_M2_EB" | wc -w)" -eq 2
test "$(git rev-parse "$IS_M2_EB^")" = "$IS_M2_C"
test "$(git diff --no-renames --name-only "$IS_M2_C" "$IS_M2_EB")" = "$IS_M2_REPORT"
assert_report_append "$IS_M2_C" "$IS_M2_EB" "$IS_M2_REPORT" \
  "candidateHead: $IS_M2_C" 'reviewB.verdict: PASS'
test "$(git show "$IS_M2_EB:$IS_M2_REPORT" | rg -Fxc "candidateHead: $IS_M2_C")" -eq 1
test "$(git show "$IS_M2_EB:$IS_M2_REPORT" | rg -Fxc 'reviewB.verdict: PASS')" -eq 1
test "$(git show "$IS_M2_EB:$IS_M2_REPORT" | rg -Fxc "integrationRef: $IS_M2_INTEGRATION_REF")" -eq 1
test "$(git show "$IS_M2_EB:$IS_M2_REPORT" | rg -Fxc "baseRevision: $IS_M2_BASE")" -eq 1
test "$(git show "$IS_M2_EB:$IS_M2_REPORT" | rg -Fxc "subjectHead: $IS_M2_SUBJECT")" -eq 1
test "$(git show "$IS_M2_EB:$IS_M2_REPORT" | rg -Fxc 'reviewA.verdict: PASS')" -eq 1
for IS_M2_KEY in integrationRef baseRevision subjectHead reviewA.verdict; do
  assert_one_report_key "$IS_M2_EA" "$IS_M2_REPORT" "$IS_M2_KEY" || exit 1
done
for IS_M2_KEY in integrationRef baseRevision subjectHead reviewA.verdict candidateHead reviewB.verdict; do
  assert_one_report_key "$IS_M2_EB" "$IS_M2_REPORT" "$IS_M2_KEY" || exit 1
done
git diff --check "$IS_M2_SUBJECT" "$IS_M2_EA"
git diff --check "$IS_M2_C" "$IS_M2_EB"
```

Očekávání: všechny exity `0`, registry branch-local +1, žádný undeclared edge
ani cesta. Candidate `C` navíc znovu spustí M2 effect/approval/audit contract
testy a oba consumer scénáře. `E_A`/`E_B` mění jen report a canonical ref se
posune až po metadata gate `E_B`.

WP neprokazuje celé L0-12. M5 po M3/M4 stále provede residual outbound census,
conditional-surface disposition a release evidence.
