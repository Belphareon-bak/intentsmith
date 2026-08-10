# WP-M1-PROOF-ISSUANCE — durable PASS proof bez aktivace

**Typ:** zapisující WP · **Rail:** R1, R3, R5, R6
**Stav zadání:** připraveno k nezávislému Review A; není implementační evidence
**Rozhodnutí:** [`015`](../decisions/015-m1-model-failover-proof-policy.md)

## 1. Uživatelský výsledek

Operátor může nad jedním dokončeným, parentem přijatým role-suite měřením
vydat právě jeden digest-bound `PASS` proof. Proof je způsobilý jen tehdy,
když jeho oba immutable artefakty už durable existují v content-addressed
store, aktuální role contract znovu přesně sedí a sedmidenní TTL ještě
nevypršelo.

Tento WP **neaktivuje** automatic failover, `ACTIVATE`, `REAPPLY`, `RESTORE`,
scheduler ani Studio. Skutečné modelové měření a GPU pilot jsou samostatná
operátorská akce; implementační acceptance běží pouze s test-owned loopback
providerem.

## 2. Vlastněné cesty a connector

**Povolené produktové cesty:**

- `src/upgrade/model-failover-proof-policy.js`;
- nový operator-only `scripts/issue-model-failover-proof.js`;
- `scripts/run-model-failover-measurement.js` pouze pro pravdivý
  `NOT_ISSUED` handoff po zapnutí policy;
- nová aditivní migrace
  `src/db/migrations/2026_08_10_062_model_failover_proof_issuance.js`.

**Povolené důkazy a mechanické projekce:**

- `tests/m1-model-failover-proof-policy.test.js`;
- `tests/m1-model-failover-measurement.test.js`;
- `tests/m1-model-failover-parent-acceptance.test.js` pouze pokud se mění
  přesný `NOT_ISSUED` handoff;
- nový `tests/m1-model-failover-proof-issuer.test.js`;
- `tests/m1-model-failover-schema.test.js` a `tests/schema-migrations.test.js`;
- pouze proof-fixture compatibility úseky v
  `tests/m1-model-binding-storage.test.js`,
  `tests/m1-model-binding-repository.test.js` a
  `tests/m1-model-failover-coordinator.test.js`; tyto sady po 062 nesmějí
  obcházet companion ledger přímým legacy insertem;
- `tests/registry.json`, `docs/convergence/TEST-REGISTRY.md` a mechanické počty
  v `README.md`;
- `ROADMAP.md`, `SYSTEM-MAP.md`,
  `docs/inventory/18a-sprava-modelu.md`, rozhodnutí 015 a
  `docs/execution/runs/wp-m1-model-report.md`;
- unikátní evidence report
  `docs/execution/runs/wp-m1-proof-issuance-20260810-report.md`.

**Integrator-only, nikoli writer-owned:**

- `tests/fixtures/module-boundary/baseline.json`, pouze pokud exact ratchet po
  Review A vrátí `ACCEPTANCE_REQUIRED`; baseline zapisuje integrátor na
  merge-candidate a jen pro přeměřený multiset hran.

**Zakázané:**

- editace migrace 046 nebo jiné už aplikované migrace;
- `src/upgrade/model-failover.js`, coordinator, scheduler, provider/runtime
  binding, routes, Studio/WS, mobile, LLM gateway a GPU/VRAM authority;
- automatická revalidace, background job, externí síť nebo nová závislost;
- caller-owned práh, suite, čas, TTL, proof ID, hash, source revision nebo DB
  cesta;
- změna L0-9 nebo tvrzení `Gate 1 PASS`.

Vlastněný connector je interní `OperatorModelFailoverProofIssuer v1`:

```text
issueModelFailoverProof({ db, acceptancePath })
  -> { status: ISSUED | ALREADY_ISSUED, proofId, expiresAtMs, ... }
```

`db` dodává composition/CLI vrstva a `acceptancePath` je pouze locator uvnitř
jediné private candidate-measurement root. Všechna bezpečnostní a proof pole se
odvozují z ověřených bytes a aktuální policy, nikoli z volajícího.

## 3. Vstupní revision, závislosti a pořadí

- `integrationRef`: `integration/gate1-prod-ready-20260809`;
- `sourceEvidenceRevision` i skutečný `baseRevision`:
  `2cbed0a06c7b86d115f4da21af67751a086b8ab9`;
- přijato: 015/A bootstrap, provisional TTL `604800000` ms, operator-only
  serial trigger a content-addressed storage;
- přijato a integrováno: 020/E policy authority + migrace 061;
- číslo 062 je rezervované union censem. Mobilní 055–060 nejsou závislostí
  tohoto writeru; jejich skutečná late-insertion parita vznikne v odděleném WP
  na prvním společném SHA.

Pořadí uvnitř WP:

1. policy A + pravdivý measurement handoff;
2. migrace 062 a strict expiry;
3. content-addressed issuer + DB transaction;
4. focused a schema důkaz;
5. fresh-clone acceptance a nezávislé Review B.

## 4. Malá demonstrace

Nad čistým lokálním klonem, test-owned loopback providerem a isolated SQLite:

1. parent vytvoří mode-0400 measurement a acceptance se shodným digestem;
2. issuer je znovu byteově, strukturálně a proti živé policy ověří;
3. issuer durable publikuje oba blobs pod jejich SHA-256, znovu je přečte a
   teprve potom v jednom `BEGIN IMMEDIATE` vloží artifact ledger a proof;
4. stejná acceptance při opakování vrátí tentýž proof bez druhého zápisu;
5. proof je způsobilý těsně před expiry a nezpůsobilý při
   `now === expiresAtMs`;
6. žádný binding, failover event/state, config, provider, broadcast ani síťový
   efekt nevznikne.

TTL se počítá od `acceptance.completedAtMs`, ne od pozdějšího času issuance.
Pokud je acceptance už expirovaná, issuer ji nesmí „omladit“.

## 5. Pozitivní test

- všech sedm rolí má `requiredScore=1`,
  `requiredPassedCount=totalCount`, TTL 7 dní a `reason=null`;
- nový measurement nese úplný aktuální contract, zůstává `NOT_ISSUED` a
  výslovně požaduje oddělený operator commit;
- issuer přijme pouze current clean source revision a exact parent/child
  artefakty, přepočítá grade/aggregate a zapíše přesná proof/ledger pole;
- content store používá deterministic SHA path, regular owned mode-0400 file,
  single-link metadata, read-back SHA/length a fsync souboru i namespace;
- deferred companion-first/proof-second transakce commitne oba záznamy nebo
  žádný;
- duplicate/retry je idempotentní a dvě WAL connections nevydají dva proofy;
- fresh i upgrade DB obsahují 062 a čtyři proof eligibility hrany jsou
  striktní.

## 6. Negativní test

Povinně fail-close:

- neúplná suite, libovolný failed test, score pod 1, count pod total, změněné
  pořadí/test ID, forged aggregate nebo grade;
- starý measurement contract, policy/validation/source drift a změna policy
  mezi preflightem a terminálním DB zápisem;
- caller authority navíc, budoucí nebo expirovaný čas, overflow TTL a pokus
  dodat proof ID/hash/threshold/TTL/source revision;
- acceptance nebo measurement mimo owned root, symlink, hardlink, jiný mód,
  owner, byte length, SHA, path, druhý artefakt nebo non-canonical JSON;
- store collision s jinými bytes, preexisting symlink/directory, fsync/readback
  failure, DB failure po durable blobu (orphan je přiznaný, proof nevznikne);
- přímý proof INSERT bez companion ledgeru, companion bez proofu při commitu,
  mismatch libovolného svázaného pole, UPDATE/DELETE/`INSERT OR REPLACE` a
  duplicate acceptance;
- historický proof bez 062 ledgeru nesmí projít žádným ze čtyř triggerů;
- `expiresAtMs - 1` projde, rovnost a pozdější čas neprojde;
- nulový automatic failover/scheduler/provider/runtime/broadcast/external
  network efekt.

## 7. Stop condition a eskalace

Zastavit dotčenou část a vrátit `CHANGES_REQUIRED`, pokud implementace potřebuje:

- změnit veřejný HTTP/WS/M1 connector nebo zapnout scheduler/automatic
  activation;
- přijmout jinou policy než přesný 015/A + 7d blok;
- dovolit DB proof bez obou durable artefaktů nebo přepsat migraci 046;
- přidat závislost, background model/GPU běh nebo caller-owned authority;
- vyřešit mobile 055–060 cherry-pickem bez samostatné autorizace a Review A;
- sáhnout do cesty aktivního cizího writera.

Produkční proof z reálného modelu je po tomto WP stále `NOT RUN`, dokud jej
operátor výslovně nespustí. Automatic activation a Gate 1 zůstávají `BLOCKED`.

## 8. Přesné ověření a výstup

Ve feature worktree po `npm ci --offline`:

```bash
set -euo pipefail
node tests/m1-model-failover-proof-policy.test.js
node tests/m1-model-failover-measurement.test.js
node tests/m1-model-failover-parent-acceptance.test.js
node tests/m1-model-failover-proof-issuer.test.js
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
```

Review A navíc ověří exact allowlist proti plnému `baseRevision`, source blob
migrace 046 je byte-identický a diff neobsahuje automatic activation/runtime
cesty. Review B zopakuje focused/schema/repository/registry/hygiene/ratchet
gates na immutable candidate `C` a z nového `--no-local` klonu.

Výstup jde pouze do
`docs/execution/runs/wp-m1-proof-issuance-20260810-report.md`, stavových pasáží
roadmapy/mapy/inventory a existujícího M1 reportu. Tento statický kontrakt se po
aktivaci skutečnými SHA ani stavem nedoplňuje.
