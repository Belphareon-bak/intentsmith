# WP-M2-LIFECYCLE-V1

**Typ:** M2 oddíl 6/7 — exact lifecycle junction a deterministická governance

**Stav:** `PINNED_V1 / ACCEPTED / FINAL_OPERATOR_REVIEW_PASSED`

**Autorita:** operátorské spuštění celé M2; `ROADMAP.md` §6 krok 4 a exit
kritéria pro jeden viditelný plan → approval → change → test → diff → audit
journey bez paralelní legacy effect cesty

## Uživatelský výsledek

Lokálně autentizovaný uživatel vybere registrovaný aktivní Git projekt a předá
přesný malý change proposal. IntentSmith z něj vytvoří immutable lifecycle plan
svázaný s canonical project rootem, workspace revision, exact
`ProjectChangeRequest`, předefektovým governance decisionem a úplnou approval
set. Uživatel schválí přesný plan digest; teprve potom se vydají payload-bound
single-use granty a oddíl 5 provede write, focused test, rollback a exact Git.

Lifecycle terminal se neodvozuje z modelového textu ani z legacy milestone
statusu. `succeeded` vyžaduje exact úspěšný `ProjectChangeResult`, post-result
governance receipt a shodu všech project/run/request/revision digestů. Status
vrací plán, schválené authority, diff summary, test, Git a audit evidence z
durable autority.

## Vlastněný rozsah

- `LifecyclePlanSnapshot`, `LifecycleApprovalIntent` a
  `LifecycleTerminalSnapshot` v1;
- `GovernancePolicySnapshot`, `GovernanceDecision` a `GovernanceReceipt` v1;
- strict proposal compiler bez tolerantního modelového fallbacku;
- deterministický pre-effect governance evaluator nad exact after-images;
- migrace 079, append-only lifecycle/governance repository a SQL terminal join;
- jedna application service nad `ProjectContext`, `ProjectChange`, effect
  authority, exact approval issuer a durable execution runtime;
- start/approve/cancel/status/recover API a explicitní quarantine legacy
  effect-capable lifecycle vstupů;
- offline fake-model-free journey se skutečným SQLite, temp Git a bubblewrap;
- registry, module graph, schema/artifact/gate evidence a operátorské review.

## Zakázaný rozsah

- změna kontraktů nebo bezpečnostních invariants oddílů 1–5;
- použití `WorkflowOrchestrator`, `execution-loop`, `GitManager`,
  `C3ToolExecutor`, `applyPatchSet`, `git add -A` nebo přímého `writeFile` jako
  M2 lifecycle effect cesty;
- implicitní approval z obecného „ano“, session path nebo request-body actor;
- listener, pairing, remote runtime nebo `RemoteCorePort` (oddíl 7);
- network/GPU/Ollama/model/Electron běhy, mobil a cizí checkouty/procesy;
- vydání známého celkového gate `FAIL/BLOCKED` za PASS.

## Kontraktové invariants

- Projektová autorita vzniká pouze ID lookupem aktivního registry řádku a exact
  canonical realpath shodou; caller path je vždy neautoritativní.
- Proposal má exact keys, nejméně jednu změnu a právě jeden focused argv-only
  test. Neznámý klíč, chybějící test, traversal nebo tolerantní text failuje
  před uložením plánu a před grantem.
- Plan váže lifecycle/run/execution/project/actor/origin identity, context
  snapshot, request/patch/authority/policy/baseline/decision digest a exact
  change/test/Git view. Approval váže current plan version i plan digest.
- Governance hodnotí úplný exact candidate material ověřený proti request
  digestům. Missing/invalid/truncated/unmapped/unreadable nebo unsupported
  required check je `unavailable`, nikdy implicitní PASS.
- Policy změněná týmž requestem neautorizuje sama sebe; rozhoduje immutable
  snapshot připnutý před efektem.
- SQL odmítne update/delete identity, rozdílný idempotent replay, druhý terminal
  a `succeeded` bez exact succeeded execution resultu a allow receiptu.
- Approval se považuje za complete až po vydání úplné exact grant set. Partial
  vydání, stale revision, wrong subject/digest, expiry nebo replay nic nespustí.
- Cancel je durable intent, revokuje neconsumed granty, abortuje aktivní runtime
  a čeká na pravdivý execution/lifecycle terminal. Consumed effect se nemaže.
- Restart census obnovuje pouze durable nonterminal runy. Již consumed approval
  vyvolá recovery-only execution bez opakování write/test/Git efektů.
- Legacy lifecycle effect vstupy nesmějí zůstat druhou autorizovanou cestou.

## Acceptance

1. Contract a compiler positive/negative/extra-key/false-success sady projdou.
2. Missing/invalid policy, incomplete inventory, unsupported required check,
   policy self-change a violation za 200. souborem failují před efektem.
3. SQL forge `succeeded`, wrong result/receipt/revision/project, update/delete a
   dvě connection race skončí fail-closed.
4. Start vyřeší projekt ID-only, dvakrát ověří revision a uloží celý plan,
   effect requests i execution material před odpovědí `awaiting_approval`.
5. Approval wrong actor/digest/version/revision, partial issuance a replay mají
   nula efektů; exact approval spustí právě jeden runtime.
6. Cancel před approval i během focused testu, timeout, kill, restart po
   execution resultu a restart před lifecycle terminalem mají pravdivý výsledek
   bez late success a bez opakování efektu.
7. Skutečný offline SQLite/temp Git/bwrap journey ukáže exact plan, approval,
   diff, test, Git a audit; reopen vrátí byte-identický durable status.
8. Legacy effect-capable lifecycle endpoints jsou typed unavailable/gone nebo
   používají tutéž application service; static sentinel nedovolí starý bypass.
9. Registry, schema, module ratchet, artifact validation a deterministický gate
   se zopakují s přesně přiznaným verdict/counts/non-PASS setem.
10. Operátor vrátí nad přesným připnutým řezem `REVIEW_PASSED`; každý
    `CHANGES_REQUESTED` se opraví, znovu připne a review se opakuje.

## Přiznané limity

- V1 přijímá strict strukturovaný proposal. Volný modelový text se nesmí
  tolerantně převést na effect plan; generativní proposal adapter může vzniknout
  později pouze se strict schema validací a stejným lifecycle junctionem.
- Deterministická governance v tomto řezu vlastní explicitní policy checky.
  Heuristický duplicate/concept/spec review zůstává advisory a nemůže vytvořit
  success.
- Jeden ProjectChange vlastní právě jeden focused process. Multi-command workflow
  není v1 a nevytváří se přes shellový wrapper.
- Mechanické `PINNED_V1` není review verdict a nesmí být přeloženo na PASS.

## Ověření

```bash
node tests/m2-lifecycle-contract-v1.test.js
node tests/m2-lifecycle-proposal-compiler.test.js
node tests/m2-governance-contract-v1.test.js
node tests/m2-governance-evaluator.test.js
node tests/m2-lifecycle-authority-repository.test.js
node tests/m2-lifecycle-application-service.test.js
node tests/m2-lifecycle-routes.test.js
node tests/m2-lifecycle-surface-retirement.test.js
node tests/m2-lifecycle-studio-surface.test.js
node tests/m2-negotiated-lifecycle-quarantine.test.js
node tests/schema-migrations.test.js
node tests/m1-model-failover-schema.test.js
node tests/module-boundary-ratchet.test.js
node scripts/validate-test-registry.js --json
node --test tests/artifact-validation.test.js
npm run test:deterministic
git diff --check
```
