# WP-M1-MODEL-CLEANUP-AUTHORITY — jeden vlastník modelového delete effectu

**Typ:** zapisující WP · **Slot:** hlavní checkout, jeden writer
**Vstupní revision:** `a3a00baae2dffa6204afa327b97f102ee36c8c09`
**Závislosti:** dokončený manual binding application checkpoint a canonical
model identity

**Aktuální stav:** C1 + C2a jsou fresh-clone ověřené. C2b gateway a binding
cutover/exact verification jsou fresh-clone ověřené na `cfcb63dd` a pokrývají
čtyři z pěti živých cest. VRAM, cross-process claim, durable delete audit, operationless
legacy rehydrate a post-DB runtime-finalize reconciliation zůstávají otevřené.
Poslední VRAM hrana čeká na
[rozhodnutí 023](../decisions/023-m1-vram-artifact-use-authority.md), které
odděluje úzkou artifact/delete ochranu od širší GPU residency autority.

Toto zadání uzavírá findings
[`006`](../findings/006-model-cleanup-bypasses-registry-guard.md) a
[`007`](../findings/007-model-cleanup-timestamp-ordering.md) bez tvrzení, že je
už uzavřená širší active-use a auditní hranice z
[`010`](../findings/010-model-delete-use-and-audit-boundary.md).

## 1. Uživatelský výsledek

C1 přesměruje explicitní HTTP a opt-in age cleanup do jediné bounded cesty,
odstraní přímý chatový provider effect a odmítne drift zjištěný druhým
inventory snapshotem. Současný chatový candidate source vrací právě one-step
rollback identitu, proto ji C1 zaparkuje před inventory; nevydává to za funkční
chat delete.
Model, který je při konkrétním guardu už chráněný bindingem, rezervovanou
validací, retencí nebo souběžnou binding mutací, skončí typovaně před
destruktivním provider efektem. Atomická ochrana po posledním snapshotu proti
concurrent pull, nově startující validaci a dalšímu active model use patří do C2
a není claim C1.

## 2. Povolené a zakázané cesty

**Checkpoint C1 vlastní:**

- `src/upgrade/model-{identity,registry,binding-application}.js`;
- úzké cleanup/dedupe změny v `src/upgrade/upgrade-manager.js`;
- delete adaptéry v `src/routes/system.js` a
  `src/chat/handlers/pre-handler.js`;
- scheduler wiring v `src/server.js`;
- `tests/m1-model-{identity,binding-application}.test.js`;
- tento WP, findings 006/007/010, inventuru 18a, M1 report a příslušné stavové
  věty v `ROADMAP.md` a `SYSTEM-MAP.md`.

**Checkpoint C2 smí navíc vlastnit pouze po samostatném čistém C1 commitu:**
živé produkční model-use consumery potvrzené source-to-effect call graphem,
nový neutrální reservation port a focused testy. C2a vlastní port,
delete/validation a pull serializaci; C2b vlastní gateway a binding
cutover/verify. Binding cutover rezervuje previous+target až po cold pullu,
znovu ověří exact digest pod lease a drží jej přes durable zápis, compensation
i synchronní finalize; verification drží target přes durable success a před
retry delay jej uvolní. VRAM residency sémantika je samostatná shromážděná otázka.
Dormant vision, semantic-index a legacy verify se nezapojují jen kvůli
původnímu chybnému součtu sedmi.

**Zakázané:** veřejný M1 connector, automatic failover/proof issuance,
produktové UI, online discovery, změna provider retry policy, GPU/Ollama běh,
nová závislost a vzdálený destructive provider scope bez rozhodnutí operátora.

## 3. Connector

Veřejný `ModelRequest/Result v1` se nemění. Interním seamem C1 je
`ModelRegistry.deleteModel(name, {source, expectedDigestSha256})` pod jediným
`ModelBindingApplication.runExclusiveModelMutation({kind:'MODEL_DELETE'})`.

Veřejné kompatibilní tvary zůstávají:

- HTTP `{ok, deleted, freedGB}`;
- WS `{action:'model_deleted', model, freedGB}`.

Exact name, digest a source jsou interní receipt; bez přijatého connector
rozhodnutí se nepřidávají do veřejného payloadu.

## 4. Vstup a závislosti

Canonical presence identity už rozlišuje alias `name`/`name:latest` od identity
artefaktu. Manual binding application už vlastní apply/rollback/rehydrate
mutex a durable desired/runtime stav. C1 tento owner znovu nepíše; rozšíří jej
o jediný destruktivní callback.

GPU, Ollama ani externí síť nejsou prerekvizitou C1. C2 rovněž začíná
deterministickými fake-provider závody; skutečný modelový běh zůstává samostatný
a sériový.

## 5. Malá demonstrace

1. Reálný post-apply chat kandidát je one-step rollback identita a skončí bez
   inventory, preview a delete effectu.
2. Interní chat adapter umí přijmout exact registry plan a jednorázově spotřebuje
   explicitní potvrzení; nejde však o dosažitelný runtime journey bez retirementu.
3. Binding vložený mezi plán a delete skončí bez inventory i delete effectu.
4. Stable exact name+digest vede na právě jeden provider DELETE.
5. Digest/name drift mezi dvěma inventory snapshoty vede na nula DELETE.
6. Auto-clean smaže jen kandidáta s doloženou usage striktně starší než cutoff;
   nulová usage, rovnost, invalidní čas, DB chyba a overlapping tick nic
   nesmažou.

## 6. Focused pozitivní a negativní test

**Pozitivní:** stable exact artifact; HTTP delegace; internal single-use chat
adapter; skutečný post-apply chat rollback candidate se zaparkuje;
authoritative JSON scheduler; SQLite i ISO starý čas; canonical dedupe; public
payload parity.

**Negativní:** bound/validating/desired/pending/rollback identita; binding
interleaving; application busy; chybějící owner; ambiguous/missing digest;
exact name nebo digest drift; malformed settings; čas na/po cutoffu, mixed
format, nulová usage, invalidní/missing čas a DB chyba; overlapping tick;
route bez registry;
přímý `/api/delete` mimo registry.

Mutační minimum C1: odstranění druhého inventory, durable-binding guardu nebo
rovnosti cutoffu musí focused sadu zčervenat.

## 7. Stop condition a pravdivé residualy

Zastavit pouze dotčenou část při potřebě změnit veřejný connector, povolit
remote delete, přidat cross-process destructive claim nebo zvolit cílový
durable audit. Nezávislé C1 části pokračují.

Změna VRAM owner vocabulary nebo `src/media/**` navíc čeká na 023. Samotný
per-model lease nesmí být vydán za vyřešení gateway/ComfyUI GPU admission.

C1 nesmí prohlásit active inference za chráněnou. C2 musí zapojit celý skutečný
živý call graph, ne jen gateway, a dormant cesty musí pravdivě vyřadit. Dokud
není C2 a auditní disposition hotová, L0-11
zůstává `PARTIAL` a Gate 1 `BLOCKED` z dalších již pojmenovaných důvodů.
Funkční chat cleanup navíc čeká na operátorské rozhodnutí, která historická
identita už není rollback autoritou a smí být explicitně retireovaná.

Focused binding checkpoint nesmí být vydán za atomický DB/runtime commit:
durable `APPLIED` vzniká před `runtime.commit()` a jeho pozdní výjimka zatím
nemá typovaný reconciliation incident. Operationless legacy override je stále
name-only a pouze `LEGACY_UNVERIFIED`. Z pěti živých cest zbývá připojit VRAM;
cross-process a durable audit jsou samostatné acceptance body.

## 8. Přesné ověření

```bash
C3_LOG_LEVEL=error node tests/m1-model-identity.test.js
C3_LOG_LEVEL=error node tests/m1-model-binding-application.test.js
C3_LOG_LEVEL=error node tests/m1-model-settings.test.js
C3_LOG_LEVEL=error node tests/routes-smoke.test.js
C3_LOG_LEVEL=error node tests/confirmation-ownership.test.js
C3_LOG_LEVEL=error node tests/upgrade-flow.test.js
C3_LOG_LEVEL=error node tests/upgrade-ux-v125.test.js
C3_LOG_LEVEL=error node tests/m1-model-contract.test.js
C3_LOG_LEVEL=error node tests/model-upgrade.test.js
C3_LOG_LEVEL=error node tests/m1-model-use-authority.test.js
node --check src/upgrade/model-binding-application.js
node scripts/module-boundary-ratchet.mjs
node scripts/validate-test-registry.js --json
node tests/artifact-validation.test.js
node tests/repository-hygiene.test.js
git diff --check
```

Zdrojový commit se po C1 ověří z nového `git clone --no-local` s
`npm ci --offline`. GPU/Ollama/external network jsou `NOT RUN`, nikoli PASS.
