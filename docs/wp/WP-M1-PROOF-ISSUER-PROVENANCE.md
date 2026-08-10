# WP-M1-PROOF-ISSUER-PROVENANCE — orchestration-owned issuance

**Typ:** připravený zapisující WP · **Rail:** R1, R3, R5, R6
**Stav zadání:** 024/A přijato operátorem 2026-08-10; implementace čeká už jen
na formální přijetí konsolidačního rodiče a přidělení exact integračního base
**Rozhodnutí:** [`024`](../decisions/024-m1-proof-issuer-provenance.md)

## 1. Uživatelský výsledek

Operátor jedním explicitním příkazem zvolí roli a instalovaný model. Tentýž
proces provede důvěryhodný parent measurement, durable uloží oba artefakty a
vydá právě jeden digest-bound PASS proof pro tento parent result. Caller nikdy
nepředává artefaktovou cestu ani proof autoritu.

WP neaktivuje failover, scheduler, revalidation, Studio ani veřejný HTTP/WS
connector. Reálný modelový běh je součást jednoho explicitního issuance
příkazu; není ale součást implementační acceptance, která používá test-owned
loopback provider.

## 2. Povolené a zakázané cesty

**Předběžně povolené po aktivaci:**

- nový `scripts/issue-model-failover-proof.js`, který současně exportuje
  interní connector a obsahuje tenkou CLI composition;
- `scripts/run-model-failover-candidate-measurement.js` pouze pro
  non-serialized in-memory expected-authority handoff;
- nový `tests/m1-model-failover-proof-issuer.test.js`;
- `tests/m1-model-failover-parent-acceptance.test.js` pouze pro exact pin
  non-serialized authority handoffu;
- `tests/registry.json`;
- `docs/convergence/TEST-REGISTRY.md`;
- `README.md` pouze pro mechanické registry počty;
- `tests/artifact-validation.test.js` pouze pokud registrace vyžaduje
  mechanickou aktualizaci exact počtu;
- `ROADMAP.md`;
- `SYSTEM-MAP.md`;
- `docs/inventory/18a-sprava-modelu.md`;
- `docs/execution/runs/wp-m1-model-report.md`;
- unikátní report
  `docs/execution/runs/wp-m1-proof-issuer-provenance-20260810-report.md`.

**Zakázané:**

- změna migrace 062 nebo jejího proof/blob schématu;
- caller-owned acceptance/measurement path, store root, proof ID, hash, čas,
  TTL, threshold, suite, source revision nebo expected authority;
- nový veřejný HTTP/WS/mobile connector;
- automatic activation, scheduler, background renewal, provider mutation,
  pull/delete/rebind nebo externí síť;
- nová závislost či správa kryptografického klíče;
- editace cizího aktivního issuer worktree.

## 3. Vlastněný connector a verze

Po přijetí 024/A vlastní WP interní `OperatorModelFailoverProofIssuer v2`:

```text
issueModelFailoverProof({ db, role, proposedModelName })
  -> { status: ISSUED, proofId, expiresAtMs }
```

`db` je composition-owned file-backed connection. Store root se odvodí z jeho
kanonické cesty; in-memory nebo nekanonická DB se odmítne. Role a model jsou
jediný operátorský intent. Parent runner, policy, clock authority, source piny,
artifact paths, proof ID a transaction boundary vlastní issuer. Cizí top-level
transakce se odmítne. Issuer znovu ověří source/policy/contract autoritu po
durable publikaci a connection-local `foreign_keys=ON` bezprostředně před
vlastním `BEGIN IMMEDIATE`.

Exact digest je vlastnost vydaného proofu a pozorovaného artefaktu, nikoli
trvalý binding role. Connector přijme při každé operátorské akci jiné platné
`proposedModelName`; strict inventory odvodí právě pozorovaný digest a nový
artefakt dostane samostatný proof. Žádný proof nesmí autorizovat jiné bytes.

Connector žije v operator-only scriptu, který importuje existující parent
script. Produkční `src/**` proto neimportuje `scripts/**`. Test importuje tentýž
export; nepoužívá alternativní issuer implementaci.

## 4. Source revision, závislosti a pořadí

- `sourceEvidenceRevision`:
  `133040261280150df7a03bf70b8416d79188e879`;
- `integrationRef`:
  `refs/remotes/origin/integration/gate1-prod-ready-20260809`;
- při vzniku návrhu tento remote ref ukazuje na
  `1d351f67428eb1c4ae1adc99ce4dd99baef608e9`; stejnojmenná lokální branch na
  `159c193fb68401ba6d1547633187bfa3cb200d12` není autorita;
- konsolidační review queue je aktuálně připnutá na
  `a24815895d984aeb2c36f114770567082f37c339`; je to source evidence pro
  přípravu, nikoli přijatý `baseRevision` ani důvod posunout stabilní ref;
- `baseRevision`: **nepřiděleno** — vznikne až po přijetí jednoho schema 062
  candidate na stabilní integrační ref;
- závislosti: operátorem přijaté 024/A, přijatý schema/ledger checkpoint 062,
  ukončené nebo explicitně převedené vlastnictví paralelního issuer writeru;
- pořadí: decision → statický contract/activation review → jediný writer →
  immutable subject `S` → Review A → merge queue → fresh-clone Review B.

Dokud `baseRevision` není full SHA dosažitelný z pojmenovaného integration
refu, tento dokument není aktivní Work Package.

## 5. Malá demonstrace

S test-owned loopback providerem a isolated file-backed SQLite operátor předá
jen roli a model. Issuer spustí parent, přijme pouze jeho in-memory autoritu,
publikuje mode-0400 single-link blobs pod jejich SHA-256 a v jednom
`BEGIN IMMEDIATE` vloží companion+proof. Výsledek je `ISSUED`; žádný binding,
event/state, scheduler, broadcast ani externí request nevznikne. Povolené
modelové efekty jsou přesně dva loopback `GET /api/tags` a jedna úplná role
suite 8 nebo 6 loopback `POST /api/chat`; pull, delete, rebind, provider
mutation a jiná route jsou zakázané.
Proof ID je přesně `mfp-${acceptanceArtifactSha256}`. Publikace používá private
temp file, byte readback, `fsync` souboru i adresáře a atomické zveřejnění;
databáze ukládá digest/length, nikoli callerem vybranou cestu.

## 6. Focused pozitivní a negativní test

Pozitivně se prokáže exact parent run, byte readback, DB-derived store,
strict expiry, transaction atomicity, terminální authority recheck a
jediný proof pro tentýž in-memory parent result. Veřejný cross-process resume
ani exactly-once operator outcome se netvrdí. Skutečná parent cesta používá
pouze test-owned loopback provider.

Negativně musí před proofem selhat caller path/hash/time/TTL authority,
strukturálně validní forged pár artefaktů, source/policy/contract/inventory
drift, non-file DB, store escape/symlink/hardlink/mode/owner drift,
`foreign_keys=OFF` při finálním commit pointu, blob collision, DB failure po
publikaci a pokus vyvolat binding, provider mutation/pull/delete/rebind,
scheduler, broadcast, jinou loopback route/count nebo external-network effect.
Non-serialized `expectedAuthority` se nesmí objevit v measurement/acceptance
bytes, stdout, stderr, logu ani veřejném resultu; focused leak test pinuje všech
pět hran.
Samostatný retry po simulovaném crashi musí pravdivě spustit nové měření; test
nesmí očekávat `ALREADY_ISSUED` bez durable attempt journalu.

## 7. Stop condition a eskalace

Zastavit dotčenou část při jiné variantě než přijaté 024, potřebě nové
migrace/dependency/public connectoru, změně 062, nejasné durable-root autoritě,
novém požadavku na concurrent/cross-process idempotency nebo konfliktu s
aktivním writerem. Veřejný WP souběžnou issuance netvrdí; deterministické ID
chrání pouze duplicate stejného in-memory parent resultu. Bezpečné read-only
review a dokumentační evidence mohou pokračovat.

## 8. Přesné ověření a evidence DAG

Po doplnění full `baseRevision` a přijetí 024 běží v čistém feature checkoutu
a znovu v `git clone --no-local` tento blok:

```bash
set -euo pipefail
npm ci --offline
node tests/m1-model-failover-proof-issuer.test.js
node tests/m1-model-failover-parent-acceptance.test.js
node tests/m1-model-failover-proof-policy.test.js
node tests/m1-model-failover-measurement.test.js
node tests/m1-model-failover-schema.test.js
node tests/schema-migrations.test.js
node tests/m1-model-failover-repository.test.js
node tests/m1-model-failover-coordinator.test.js
node tests/m1-model-binding-storage.test.js
node tests/m1-model-binding-repository.test.js
node tests/m1-model-policy.test.js
node tests/artifact-validation.test.js
node scripts/validate-test-registry.js --json
node tests/repository-hygiene.test.js
node scripts/specialist-boundary-ratchet.mjs --require-clean
node tests/specialist-boundary-ratchet.test.js
node scripts/module-boundary-ratchet.mjs
node tests/module-boundary-ratchet.test.js
git diff --check
test -z "$(git status --porcelain=v1 --untracked-files=all)"
```

Očekávaný výsledek je exit 0 každého příkazu, validní registr, žádná nová
ratchet hrana bez integrátorského přijetí a prázdný porcelain. GPU/Ollama běh
do implementační acceptance nepatří; skutečná parent cesta používá
test-owned loopback provider.

Evidence DAG bude mít vlastní report:

```text
subject S
  -> report-only E_A
  -> merge candidate C na přiděleném integration base
  -> report-only E_B po --no-local fresh-clone Review B
```

Statický WP se po aktivaci nepřepisuje skutečnými SHA. Dokud chybí přijaté
rozhodnutí a exact base, očekávaný výsledek je `BLOCKED`, nikoli PASS.
