# WP-M2-EFFECT-CONTRACT-V1

**Typ:** M2 oddíl 2/7 — effect connector, approval authority a první produkční
filesystem consumer

**Stav:** `PINNED_V1 / IMPLEMENTATION_GREEN / OPERATOR_REVIEW_PENDING`

**Autorita:** explicitní operátorské spuštění M2; `ROADMAP.md` §6;
`docs/decisions/011-m1-studio-http-fallback-effect-authority.md` varianta C;
`docs/inventory/22-effect-authority-trace.md` § „Navrhovaný M2 connector“

**Integrační vstup:** `33cf221c` — oddíly 1 a 3 sloučené

## Uživatelský výsledek

První skutečná Studio filesystem-write cesta už nemůže zapsat přímo. Vytvoří
striktní `EffectRequest@1`, vyžádá exact-scope `ApprovalGrant@1`, atomicky jej
spotřebuje spolu s durable execution claimem a uloží pravdivý
`EffectResult@1`. Reconnect používá stabilní conversation/user-message identitu,
ne životnost websocketu. Neautorizovaný legacy write končí typovanou chybou
`M2_EFFECT_AUTHORITY_REQUIRED` před efektem.

Kontrakt je podle Decision 030 mechanicky `PINNED_V1`. Připnutí není review
PASS: přesné integrační bajty musí ještě přijmout operátor.

## Vlastněný rozsah

- `contracts/m2/effect-v1.js`;
- SQLite authority ledger a current semantic ratchet přes migraci 080;
- issuer, broker, execution-owner identity a filesystem provider v
  `src/effects/`;
- Studio file-decision consumer a propagace typované chyby přes chat/M1/WS;
- trusted idempotency z persistované user-message identity;
- produkční ProjectContext provider v effect runtime;
- příslušné contract, repository, broker, runtime, consumer, schema, CRE a WS
  testy;
- registry projekce, module-boundary baseline, Work Package a run report.

## Zakázaný scope

- ToolRequest/Result, obecný process/network/Git execution a rollback engine;
- lifecycle/governance a RemoteCorePort;
- změna M1 terminálního slovníku;
- mobil, GPU/Ollama/model, cizí checkouty a coworkerovy procesy;
- druhá ručně udržovaná JSON Schema autorita.

## Authority a persistence invariants

- Request, grant i result jsou striktní, kanonicky serializované a immutable.
- Každý terminal result jmenuje přesný consumed grant a durable execution claim.
- Grant je exact-scope, subject-bound, expirovatelný, revokovatelný a single-use.
- Grant constraints jsou jedinou sdílenou projekcí requestu a stejnou
  semantiku vynucuje repository i deterministický SQLite trigger.
- Consume + execution claim proběhnou v jedné `BEGIN IMMEDIATE` transakci;
  přímé SQL ani druhý proces nesmějí autoritu obejít.
- Result nesmí časově předcházet requestu ani durable execution claimu.
- Restart považuje claimed efekt za `IN_DOUBT`, dokud není vlastník prokazatelně
  mrtvý; teprve potom smí zapsat jediný durable `orphaned` terminal.
- Liveness je vázaná na boot ID, PID a `/proc` start identity. Pouze explicitní
  `ENOENT/ESRCH` při známém boot ID dokazuje smrt; I/O, permission a parse chyba
  je neznámý stav a fail-closed.
- Filesystem target projde project-path authority, odmítá hardlinky a ověřuje
  přesné before/after bajty. Chybějící parent se nevytváří implicitně.
- Atomic write fsyncne soubor, rename a existující parent directory. Selhání
  durability nebo post-write verification je applied `orphaned` s pending
  rollbackem, nikdy obyčejné failure či success.
- Cancel, timeout, nevalidní provider evidence a neznámé settlement nesou
  konzervativní changes/evidence a po startu provideru `rollback: pending`;
  pre-provider odmítnutí naopak nesmí tvrdit late completion ani efekt.
- Append-only DB triggery chrání audit i při přímém SQL.

## Acceptance

1. Validator odmítne unknown fields, nekanonické targety, target/kind mismatch,
   falešný risk, invalidní timestamp a neplatný terminal.
2. Grant nelze vydat pro cizí subject/effect/payload/project/run/kind/revision ani
   pro terminální request.
3. Souběžné consume/recovery pokusy mají právě jednoho vítěze a konvergují ke
   stejnému durable výsledku.
4. Restart obnoví pending approval a exact authority state bez vazby na původní
   websocket session; result-commit/pending-cleanup okno se samo opraví a
   neznepřístupní terminal.
5. Každý vybraný tool překročí security hook před executorem; `file.write` ani
   write za dřívějším read/search nesmí legacy autoritu obejít.
6. Success je možný jen po přesném byte verification a durability hranici.
7. Registry, module graph, focused sady a celý deterministický runner jsou
   zopakovány na čistém integračním commitu; známé baseline non-PASS nesmějí být
   přepsány na PASS.
8. Operátor vrátí pro přesný připnutý review řez `REVIEW_PASSED`; při
   `CHANGES_REQUESTED` se cyklus opravy, nového připnutí a review opakuje.

## Přiznané limity

- Node path API neuzavírá hostile ABA interval mezi poslední revalidací a
  `rename(2)`; missing-parent mkdir je proto v tomto oddílu zakázaný a úplné
  dirfd/openat2 řešení patří execution sandboxu.
- Synchronous filesystem syscall nelze přerušit JavaScript timerem uprostřed;
  timeout/cancel je konzervativní od okamžiku, kdy provider začal.
- Execution owner je durable v `m2_effect_execution_claims`; event stream uvádí
  consume, ale owner identity se čte z claim ledgeru, ne z event details.

## Stop conditions

- implementace by potřebovala změnit schválené chování Decision 011/C nebo L0;
- authority by nešla vynutit v SQLite a na produkční consumer hranici;
- terminal by mohl vzniknout bez přesného grantu/claimu nebo efekt po erroru;
- práce by vstoupila do dalšího M2 oddílu či cizího/GPU scope;
- Chybějící operátorský verdict: oddíl zůstává `OPERATOR_REVIEW_PENDING` a
  nesmí být označen jako hotový.

## Ověření

```bash
node tests/m2-effect-contract-v1.test.js
node tests/m2-effect-authority-repository.test.js
node tests/m2-effect-broker-v1.test.js
node tests/m2-effect-execution-owner.test.js
node tests/m2-effect-file-consumer.test.js
node tests/m2-effect-file-runtime.test.js
node tests/schema-migrations.test.js
node tests/m1-model-failover-schema.test.js
node tests/capability-02-cre-behaviours.test.js
node tests/ws-bridge.test.js
node tests/execution-loop.test.js
node tests/module-boundary-ratchet.test.js
node scripts/validate-test-registry.js --json
node --test tests/artifact-validation.test.js
npm run test:deterministic
git diff --check
```
