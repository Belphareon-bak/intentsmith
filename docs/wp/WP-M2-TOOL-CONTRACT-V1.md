# WP-M2-TOOL-CONTRACT-V1

**Typ:** M2 oddíl 4/7 — jednotný `ToolRequest/ToolResult`, durable authority
a aktivní Studio/chat consumer

**Stav:** `PINNED_V1 / IMPLEMENTATION_GREEN / OPERATOR_REVIEW_PENDING`

**Autorita:** operátorské spuštění celé M2; `ROADMAP.md` §6 krok 3;
`ToolRequest/Result` connector v tabulce integračních kontraktů

**Integrační vstup:** `fa437d021e07728388eb61bbca88bcc98e208ddf`

## Uživatelský výsledek

Aktivní Studio/chat `toolExecutor` vede každý registrovaný nástroj přes jeden
typovaný connector. Pure lokální nástroje mají durable request, jediný immutable
terminal a exact replay bez druhého zavolání provideru. Effectful nástroj se
nesmí dostat k legacy handleru, dokud adapter nepředloží přesný canonical
`EffectRequest` a případný durable `EffectResult`.

První produkční překlad je `file.write -> fs.write`; pending approval není
falešný terminal a retry po schválení vytvoří právě jeden `ToolResult`.
Síťové, read, exec a databázové nástroje, pro které přesný provider ještě není,
končí pravdivě jako unavailable před efektem. Web denial zároveň potlačí
starý LLM fallback, aby se nevrátila neozdrojovaná odpověď vydávaná za search.

Kontrakt je podle Decision 030 mechanicky `PINNED_V1`. Připnutí není review
PASS: přesné integrační bajty musí ještě přijmout operátor.

## Vlastněný rozsah

- `contracts/m2/tool-v1.js`;
- registry descriptorů, broker, durable repository, effect adapter a runtime v
  `src/tools/m2-tool-*.js`;
- SQLite migrace 074 pro append-only `tool_v1_requests/results`, 075 pro exact
  append-only `ToolRequest` ↔ `EffectRequest` vazbu, 076 pro execution fencing
  a terminal truth a 077 pro atomickou invalidaci zbývající effect authority;
- aktivní Studio/chat singleton v `src/executor/tool-executor.js`;
- skutečný LOCAL `file.write` consumer a approval settlement v chat handlerech;
- potlačení fallbacku po authority denial v `src/chat/handlers/decisions.js`,
  včetně mixed-batch výsledku;
- contract, broker, repository a production-consumer testy;
- test registry, module-boundary baseline, tento WP a run report.

## Zakázaný rozsah

- obecný process/network/Git provider, sandbox, patch/test/rollback engine;
- lifecycle/governance a RemoteCorePort;
- přímé napojení specialist-runtime executorů mimo Studio/chat consumer;
- listener, pairing, remote runtime, mobil, GPU/Ollama/model a cizí checkouty;
- označení secure-unavailable nástroje jako implementovaného.

## Kontraktové invariants

- Request i result mají exact keys, canonical UTF-8/NFC JSON, bounded hodnoty a
  SHA-256 digests.
- Risk class, schema a požadovaný effect kind vlastní registry, ne caller nebo
  LLM.
- Request identity vychází z trusted persistované conversation/user-message
  identity; stejné bajty replayují, drift konfliktuje.
- Každý request má nejvýše jeden immutable terminal; approval-required je
  nonterminal a nemá `ToolResult`.
- Effectful request má nejvýše jednu durable vazbu na přesný EffectRequest;
  A/B záměna, actor/origin/target/payload drift i jiný registry descriptor
  fail-close selžou při zápisu i opětovném čtení.
- Effectful success musí jmenovat canonical succeeded `EffectResult`, který
  odpovídá runu, projektu, actorovi, kindu a přesnému target/payload překladu.
- Effectful output se deterministicky projektuje z canonical EffectResult;
  adapterem dodaný output není zdroj pravdy.
- Provider output je success až po schema validaci a durable result commitu;
  storage failure úspěch zadrží.
- Timeout/cancel abortuje pure provider i effect preparation, uloží pravdivý
  terminal a odmítá pozdní completion; adapter throw nikdy nezůstane bez
  durable terminalu.
- Neznámý nebo nepřeložitelný nástroj nesmí zavolat legacy handler ani způsobit
  filesystem, process nebo network efekt.
- Legacy circuit breaker smí zadržet pure provider, ale nesmí přeskočit durable
  ToolRequest/ToolResult authority; effectful unavailable cesta zůstává
  fail-closed v brokeru.

## Acceptance

1. Validator odmítne unknown fields, neplatné digests, nekanonické hodnoty,
   down-classing risku, schema-invalid input/output a rozporný terminal.
2. Exact retry nezavolá provider znovu; jiná request/result bytes konfliktují.
3. Pending approval nevytvoří terminal; po canonical settlement vznikne právě
   jeden linked terminal i přes WS reconnect a workspace drift po provedeném
   efektu. Exact replay už adapter ani efekt znovu nevolá.
4. Forged adapter state, cizí EffectRequest/Result nebo pouhá effect ID nestačí
   k success.
5. Aktivní Studio/chat local tool projde durable brokerem; web, database,
   unregistered a další nepodporované effectful nástroje skončí před handlerem;
   totéž platí i po otevření legacy circuit breakeru.
6. Authority denial v běžném, REPORT i mixed pure+denial flow potlačí LLM
   fallback/syntézu.
7. Migrace je append-only, fingerprintovaná a odmítne pre-existing drift.
8. Registry, module graph, focused sady, artifact validace a deterministický gate
   se zopakují na čistém kandidátu; známý baseline `FAIL/BLOCKED` se nesmí
   přepsat na PASS.
9. Operátor vrátí nad přesným připnutým řezem `REVIEW_PASSED`; každý
   `CHANGES_REQUESTED` se opraví, znovu připne a review se opakuje.

## Přiznané limity

- Produkční effect adapter v tomto řezu podporuje jen `file.write`. `web.search`,
  `web.scrape`, `file.read`, `code.execute` a `database.query` jsou bezpečně
  unavailable, ne funkční M2 tools.
- Jeden search může znamenat více provider requestů a redirectů; dokud není
  každý konkrétní request vlastněn effect brokerem, síť se neotevře.
- Standalone `new ToolExecutor()` zůstává pro staré izolované compatibility
  testy; aktivní Studio/chat exportovaný singleton má broker povinně.
- Obecný execution sandbox a rollback truth patří oddílu 5/7.
- První dostupné Opus max review na `e45ea351` nenašlo produktový blocker, ale
  správně vrátilo `CHANGES_REQUESTED` kvůli stale gate a dokumentační evidenci.

## Stop conditions

- legacy handler by šel zavolat před typed boundary nebo po authority denial;
- success by šel commitnout bez durable requestu či přesného effect výsledku;
- retry by mohl vytvořit druhý efekt nebo jiný terminal;
- implementace by vstoupila do sandbox/lifecycle/remote nebo cizího scope;
- Chybějící operátorský verdict: práce a hardening mohou pokračovat, ale oddíl
  nesmí být označen jako reviewed/hotový.

## Ověření

```bash
node tests/m2-tool-contract-v1.test.js
node tests/m2-tool-broker-v1.test.js
node tests/m2-tool-authority-repository.test.js
node tests/m2-tool-production-consumer.test.js
node tests/schema-migrations.test.js
node tests/m2-effect-contract-v1.test.js
node tests/m2-effect-authority-repository.test.js
node tests/m2-effect-broker-v1.test.js
node tests/m2-effect-execution-owner.test.js
node tests/m2-effect-file-consumer.test.js
node tests/m2-effect-file-runtime.test.js
node tests/module-boundary-ratchet.test.js
node scripts/validate-test-registry.js --json
node --test tests/artifact-validation.test.js
npm run test:deterministic
git diff --check
```
