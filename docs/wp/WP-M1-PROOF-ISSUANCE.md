# WP-M1-PROOF-ISSUANCE — policy/ledger checkpoint před durable PASS proofem

**Typ:** zapisující WP · **Rail:** R1, R3, R5, R6
**Stav zadání:** policy/ledger subject je připravený k Review A; vlastní issuer
zůstává `CHANGES_REQUIRED` do úplného přijetí provenance/retry kontraktu 024.
**Rozhodnutí:** [`015`](../decisions/015-m1-model-failover-proof-policy.md)

## 1. Uživatelský výsledek

Tento prerequisite subject připíná celý schválený policy envelope a připravuje
append-only schema, ve kterém pozdější operator-only issuer může nad jedním
dokončeným, parentem přijatým role-suite měřením vydat digest-bound `PASS`
proof. Subject sám proof nevydává a žádný issuer connector neimplementuje.

Tento WP **neaktivuje** automatic failover, `ACTIVATE`, `REAPPLY`, `RESTORE`,
scheduler ani Studio. Skutečné modelové měření a GPU pilot jsou samostatná
operátorská akce; implementační acceptance běží pouze s test-owned loopback
providerem.

## 2. Vlastněné cesty a connector

**Povolené produktové cesty:**

- `src/upgrade/model-failover-proof-policy.js`;
- `scripts/run-model-failover-measurement.js` pouze pro pravdivý
  `NOT_ISSUED` handoff po zapnutí policy;
- nová aditivní migrace
  `src/db/migrations/2026_08_10_062_model_failover_proof_issuance.js`.

**Povolené důkazy a mechanické projekce:**

- `tests/m1-model-failover-proof-policy.test.js`;
- `tests/m1-model-failover-measurement.test.js`;
- `tests/m1-model-failover-parent-acceptance.test.js` pouze pokud se mění
  přesný `NOT_ISSUED` handoff;
- `tests/m1-model-failover-schema.test.js` a `tests/schema-migrations.test.js`;
- pouze proof-fixture compatibility úseky v
  `tests/m1-model-binding-storage.test.js`,
  `tests/m1-model-binding-repository.test.js` a
  `tests/m1-model-failover-coordinator.test.js`; tyto sady po 062 nesmějí
  obcházet companion ledger přímým legacy insertem;
- `docs/inventory/18a-sprava-modelu.md`, rozhodnutí 015 a tento statický WP.

**Integrator-only, nikoli writer-owned:**

- `tests/fixtures/module-boundary/baseline.json`, pouze pokud exact ratchet po
  Review A vrátí `ACCEPTANCE_REQUIRED`; baseline zapisuje integrátor na
  merge-candidate a jen pro přeměřený multiset hran.
- `tests/registry.json`, `docs/convergence/TEST-REGISTRY.md`, mechanické počty,
  `ROADMAP.md`, `SYSTEM-MAP.md` a souhrnné run reporty.

**Zakázané:**

- editace migrace 046 nebo jiné už aplikované migrace;
- `src/upgrade/model-failover.js`, coordinator, scheduler, provider/runtime
  binding, routes, Studio/WS, mobile, LLM gateway a GPU/VRAM authority;
- automatická revalidace, background job, externí síť nebo nová závislost;
- caller-owned práh, suite, čas, TTL, proof ID, hash, source revision nebo DB
  cesta;
- změna L0-9 nebo tvrzení `Gate 1 PASS`.

Tento subject nemá issuer connector. Dřívější návrh s callerovým
`acceptancePath` a veřejným `ALREADY_ISSUED` byl review odmítnut: caller path
neprokazuje původ parent runu a nová operátorská akce dělá nové měření.
Navazující connector smí vzniknout až po přijetí celého devítiřádkového bloku
024; schema 062 na něm nezávisí.

## 3. Vstupní revision, závislosti a pořadí

- `integrationRef`: `refs/remotes/origin/integration/gate1-prod-ready-20260809`;
- `sourceEvidenceRevision`: `2cbed0a06c7b86d115f4da21af67751a086b8ab9`;
- skutečný `baseRevision`:
  `1d351f67428eb1c4ae1adc99ce4dd99baef608e9`;
- přijato: 015/A bootstrap, provisional TTL `604800000` ms, operator-only
  serial trigger a content-addressed storage;
- přijato a integrováno: 020/E policy authority + migrace 061;
- číslo 062 je rezervované union censem. Mobilní 055–060 nejsou závislostí
  tohoto writeru; jejich skutečná late-insertion parita vznikne v odděleném WP
  na prvním společném SHA.

Pořadí uvnitř WP:

1. policy A + pravdivý measurement handoff;
2. migrace 062 a strict expiry;
3. focused a schema důkaz policy/ledger subjectu;
4. Review A a merge queue tohoto prerequisite;
5. až po přijetí 024 samostatný content-addressed issuer subject.

## 4. Malá demonstrace

Nad čistým lokálním klonem a isolated SQLite:

1. policy odvodí hash celého authority envelope včetně acceptance, TTL a tří
   source pinů;
2. změna prahu, TTL nebo libovolného pinnutého source skončí fail-closed;
3. migrace 062 commitne exact companion+proof dvojici, nebo odmítne transakci;
4. proof je způsobilý těsně před expiry a nezpůsobilý při
   `now === expiresAtMs`;
5. žádný nový proof, binding, provider, broadcast ani síťový efekt nevznikne.

TTL se počítá od `acceptance.completedAtMs`, ne od pozdějšího času issuance.
Pokud je acceptance už expirovaná, issuer ji nesmí „omladit“.

## 5. Pozitivní test

- všech sedm rolí má `requiredScore=1`,
  `requiredPassedCount=totalCount`, TTL 7 dní a `reason=null`;
- nový measurement nese úplný aktuální contract, zůstává `NOT_ISSUED` a
  výslovně požaduje oddělený operator commit;
- authority hash zahrnuje acceptance prahy/TTL, runner, role mapu a raw-byte
  piny `model-failover.js`, profilů i validačních sad;
- deferred companion-first/proof-second transakce commitne oba záznamy nebo
  žádný;
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
node scripts/module-boundary-ratchet.mjs
node tests/module-boundary-ratchet.test.js
git diff --check
```

Review A navíc ověří exact allowlist proti plnému `baseRevision`, source blob
migrace 046 je byte-identický a diff neobsahuje automatic activation/runtime
cesty. Review B zopakuje focused/schema/repository/registry/hygiene/ratchet
gates na immutable candidate `C` a z nového `--no-local` klonu.

Subject `S` nemění souhrnný run report, `ROADMAP.md` ani `SYSTEM-MAP.md`. Teprve
report-only `E_A` po Review A připne `S` do
`docs/execution/runs/wp-m1-proof-issuance-20260810-report.md`; integrační
vlastník aktualizuje stavové dokumenty na skutečném candidate SHA. Tento
statický kontrakt se po aktivaci skutečnými SHA ani stavem nedoplňuje.
