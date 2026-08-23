# WP-M2-EFFECT-CONTRACT-V1

**Typ:** prerequisite `WP-M2-EFFECT`

**Autorita:** explicitní operátorské spuštění M2; `ROADMAP.md` §6;
`docs/decisions/011-m1-studio-http-fallback-effect-authority.md` varianta C;
`docs/inventory/22-effect-authority-trace.md` § „Navrhovaný M2 connector“

**Vstupní revision:** `8f31e34f` — nezávisle přijatý první M2 containment řez

## Uživatelský výsledek

M2 dostane jednu executable kandidátní verzi `EffectRequest/Result@1` a
`ApprovalGrant@1`; `PINNED_V1` smí vzniknout až po nezávislém review.
Přesný effect request lze durable zaregistrovat, navázat na něj expirovatelný
single-use grant a tento grant právě jednou atomicky spotřebovat nebo revokovat.
Restart neztratí stav ani append-only audit těchto přechodů.

Tento prerequisite ještě nepřepojuje Studio, tools, lifecycle ani jiné
effect-capable consumery a nesmí být vydáván za hotový broker nebo M2 PASS.

## Vlastněné cesty

- `contracts/m2/effect-v1.js`;
- `src/effects/effect-authority-repository.js`;
- `src/db/migrations/2026_08_23_070_m2_effect_authority.js`;
- `tests/m2-effect-contract-v1.test.js`;
- `tests/m2-effect-authority-repository.test.js`;
- nezbytná rozšíření `tests/schema-migrations.test.js`;
- mechanické rozšíření exact migration oracle v
  `tests/m1-model-failover-schema.test.js`;
- nové append-only suite záznamy v `tests/registry.json`;
- tento Work Package a unikátní run report tohoto bloku.

## Zakázaný scope

- consumer wiring ve Studiu, WS, routes, tools, skills nebo lifecycle;
- změna M1 terminálního slovníku;
- path-authority, patch, Git, process, network nebo rollback implementace;
- coworkerův `WP-M2-CODE`, mobil, GPU/model a cizí checkouty;
- druhá ručně udržovaná JSON Schema autorita.

## Connector a persistence

- `EffectRequest@1` nese stabilní identity, actor/origin, uzavřený kind/target,
  payload digest, workspace revision, capability, risk, timeout a idempotency.
- `EffectResult@1` má jediný terminál a pravdivě rozlišuje success, failure,
  cancellation, timeout, kill a orphaning.
- `ApprovalGrant@1` je exact-scope, expirovatelný a vždy single-use.
- Request a result jsou immutable; request lze právě jednou navázat na
  spotřebovaný grant. Grant lze spotřebovat nebo revokovat, nikdy obojí.
- Authority eventy jsou append-only. DB triggery chrání stav i proti přímému
  zápisu mimo repository.

## Acceptance

1. Validator odmítne unknown fields, nekanonické targety, target/kind mismatch,
   falešný risk class, invalidní timestamp a neplatný terminální tvar.
2. Grant nelze vydat pro cizí effect, payload, project, run, kind nebo revision.
3. Změna libovolné části requestu po approvalu znemožní consume.
4. Dva consume pokusy mají právě jednoho vítěze; expired, revoked a již
   consumed grant mají rozdílný typovaný výsledek.
5. Run revokace je atomická a restart nad stejnou SQLite DB obnoví přesný stav.
6. Request/result/event audit nejde přepsat ani smazat přímým SQL.
7. Stejný effect terminal lze idempotentně zopakovat; odlišný druhý terminal je
   odmítnut.

## Stop conditions

- implementace by potřebovala změnit schválené chování 011/C nebo L0;
- executable connector by vyžadoval druhou schema autoritu;
- atomické consume/revoke nelze vynutit v SQLite;
- práce by musela vstoupit do cizího consumer nebo coworker scope;
- focused sada najde možnost efektivně spotřebovat grant pro jiný request.

## Ověření

```bash
node tests/m2-effect-contract-v1.test.js
node tests/m2-effect-authority-repository.test.js
node tests/schema-migrations.test.js
node tests/module-boundary-ratchet.test.js
npm run test:deterministic
npm run test:registry
git diff --check
```
