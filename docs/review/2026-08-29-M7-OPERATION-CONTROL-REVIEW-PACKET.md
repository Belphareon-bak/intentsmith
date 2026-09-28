# M7 operation control — review packet

**Požadovaný verdikt:** `REVIEW_PASSED` nebo `CHANGES_REQUIRED`

**Product candidate:** `4d279e3c62b7d2816e700f9cc5b470b116a32542`

**Product tree:** `98b09e2954244a979c7e817e84a555b6a8b0dade`

**Review range:** `5729566777c56e1becc0daaffa5604f00f651710..4d279e3c62b7d2816e700f9cc5b470b116a32542`

## Review otázky

Review má sledovat provider → journal → SQLite trigger → restartovou projekci,
nejen fixture výsledky:

1. Jsou list/get přesně partitionované podle důvěryhodného device a subjectu,
   nebo lze requestem zvolit cizí partition?
2. Je `OperationRecord@1` odvozený pouze z exact intent/outcome/abandonment
   řetězu a váže revision všechny změny, které mohou ovlivnit zobrazený stav?
3. Váže cursor device, subject, capability/operation, state filter, celý
   snapshot a offset? Selžou tamper, cross-subject replay a snapshot drift bez
   partial dat?
4. Musí abandon projít provider authority a durable source
   `operation.abandon` intentem, nebo lze handler bezpečnostně obejít?
5. Je expected revision kontrolovaná v téže `BEGIN IMMEDIATE` transakci jako
   append-only receipt a odmítne stale/terminal/foreign target?
6. Dokládá SQL trigger exact canonical BLOB, source intent a poslední
   pending/unknown target event? Odmítne chybějící UDF, column drift,
   UPDATE/DELETE a nekanonické bytes?
7. Nemění abandon původní event, nevolá původní handler, cancel ani retry a
   neprezentuje abandoned jako důkaz, že underlying efekt neproběhl?
8. Vrací restart a replay shodný target stav bez druhého efektu a dostane source
   abandon operation svůj vlastní terminal outcome?
9. Zůstává control-plane descriptor neinzerovaný a lze jej vyvolat pouze pro
   implementovanou exact operaci, aniž by incomplete health handler zablokoval
   operation recovery?
10. Jsou čtyři nové importní hrany minimální a bez růstu 3 cyklů / 28 souborů?
11. Je migration-count rebind na 90 úplný napříč M1/M6 oracly a runnerem, nebo
   může schema drift vytvořit false-green release evidence?
12. Dokládají dva červené běhy fail-closed toolchain a je finální `331/331`
   skutečně nový run nad čistým exact kandidátem?

## Minimální reprodukce

```bash
git diff --check 57295667..4d279e3c
node tests/m7-operation-control-adapters.test.js
node tests/m7-operation-journal.test.js
node tests/m7-in-process-capability-provider.test.js
node tests/m7-conversation-core-adapters.test.js
node tests/m7-settings-information-core-adapters.test.js
node tests/mobile-remote-capability-contract.test.js
node tests/mobile-remote-capability-provider-contract.test.js
node scripts/mobile-gate.js
node tests/schema-migrations.test.js
node tests/m1-model-failover-schema.test.js
node tests/m6-runtime-evidence.test.js
node tests/m6-technical-evidence.test.js
node tests/nightly-orchestrator-self-test.js
node tests/module-boundary-ratchet.test.js
node tests/artifact-validation.test.js
node scripts/validate-test-registry.js --json
```

Zelený report:
`.intentsmith-artifacts/m7-operation-control-offline-database-final2-20260829/2026-08-29T04-16-11-438Z/report.json`.
Ověřit SHA-256
`7017b4de3d248ca94980372a3b8a3e5e1504d71d2538e11fd4e38c013fb8ad0b`,
source `4d279e3c62b7d2816e700f9cc5b470b116a32542`, registry
`917ccb7ea3fc358d221304c19417f97fbb0f98ceb9588acb00ce07629208d3bc`,
verdict `PASS`, exit 0 a counts `331/0/0/0/0`.

Červené mezireporty na stejném source:

- bez toolchain allowlistu: `323 PASS / 8 BLOCKED`, exit 2, SHA-256
  `065deb002281b07bf00db2f0b4628111a6f99a833745b91e4d39fc88bff4b2e9`;
- bez exact PDF interpreter pinu: `329 PASS / 2 BLOCKED`, exit 2, SHA-256
  `04d09261997af60245752a79b1375fa94122e4d641c76cdf2d3a996462f66514`.

Packet žádá verdict pouze pro operation-control blok. Nežádá M7 acceptance ani
nepovoluje approval normalizaci, production composition, session/cursor keys,
pairing, listener/transport activation, mobilní distribuci, live LLM/GPU/device
práci, M5/M6 podpisy, rotace, history změny, promotion, tag, publish nebo push.
