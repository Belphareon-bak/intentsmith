# WP-M1-PROOF-ISSUER-PROVENANCE — orchestration-owned issuance

**Typ:** aktivní zapisující WP · **Rail:** R1, R3, R5, R6
**Stav zadání:** `ACTIVE / PARENT_HANDOFF_IMPLEMENTED / ISSUER_IMPLEMENTED / REVIEW_PENDING`;
024/A je přijaté a exact promoted integration base je zmrazený
**Rozhodnutí:** [`024`](../decisions/024-m1-proof-issuer-provenance.md)

## 1. Uživatelský výsledek

Operátor jedním explicitním příkazem zvolí roli a instalovaný model. Tentýž
proces provede důvěryhodný parent measurement, durable uloží oba artefakty a
vydá právě jeden digest-bound PASS proof pro tento parent result. Caller nikdy
nepředává artefaktovou cestu ani proof autoritu. Issuer desired ani active
binding nemění; nový model nebo digest je samostatný explicitní run a proof.

WP neaktivuje failover, scheduler, revalidation, Studio ani veřejný HTTP/WS
connector. Reálný modelový běh je součást jednoho explicitního issuance
příkazu; není ale součást implementační acceptance, která používá test-owned
loopback provider.

## 2. Povolené a zakázané cesty

**Povolené:**

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

Kanonickou file-backed cestu hlavní DB odvozuje issuer z connection authority;
caller ani environment nesmí store root změnit. Issuer subject zvolil první
verzovaný layout
`<canonical-main-db>.artifacts/model-failover-proofs/v1/sha256/<sha256>.json`.
Jde o implementační kontrakt, nikoli rozšíření operátorského potvrzovacího
bloku 024. Parent checkpoint durable store nevytváří.

## 4. Source revision, závislosti a pořadí

- `sourceEvidenceRevision`:
  `a24815895d984aeb2c36f114770567082f37c339`;
- review queue:
  `refs/remotes/origin/queue/m1-consolidation-20260810`;
- runtime candidate uvnitř její evidence:
  `c0fcc444f9f0d5a3519a02c6ab3b4d0bedd1fdab`;
- `integrationRef`:
  `refs/remotes/origin/integration/m1-consolidated-20260810`;
- `baseRevision`:
  `eb93d59bf8e143ee92149f61a8491fb3e26f9835`;
- stabilní remote ref zůstává
  `refs/remotes/origin/integration/gate1-prod-ready-20260809` na
  `1d351f67428eb1c4ae1adc99ce4dd99baef608e9`;
- závislosti: operátorem přijaté 024/A, formálně přijatý konsolidační
  schema/ledger checkpoint 062 a ukončené nebo explicitně převedené
  vlastnictví paralelního issuer writeru;
- pořadí: decision → statický contract/activation review → jediný writer →
  immutable subject `S` → Review A → merge queue → fresh-clone Review B.

Exact base je dosažitelný z pojmenovaného integration refu a tento dokument je
aktivní Work Package. První subject implementoval pouze parent in-memory
handoff. Navazující subject implementuje issuer, durable store a DB commit a
přidává issuer script do exact source closure. Skutečný modelový proof vznikne
až po Review A/B tohoto immutable subjectu.

## 5. Malá demonstrace

S test-owned loopback providerem a isolated file-backed SQLite operátor předá
jen roli a model. Issuer spustí parent, přijme pouze jeho in-memory autoritu,
publikuje mode-0400 single-link blobs pod jejich SHA-256 a v jednom
`BEGIN IMMEDIATE` vloží companion+proof. Výsledek je `ISSUED`; žádný binding,
event/state, scheduler, broadcast ani externí request nevznikne. Povolené
modelové efekty jsou přesně čtyři loopback `GET /api/tags` a jedna úplná role
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
Proof pro digest A nesmí autorizovat digest B; nový explicitní operátorský run
pro digest B smí vydat vlastní proof. Desired i active binding musí zůstat před
i po issuance byteově a revision-shodné.

První parent-only subject má užší focused acceptance: přesnou zmrazenou result
identitu lze z module-private `WeakMap` převzít jen jednou. Clone, forgery,
druhý `take` a jakýkoli callerový override jsou odmítnuté. Převzatá privátní
capability dovoluje více preflight i terminálních rechecků; každý znovu načte
oba immutable mode-0400 artefakty, ověří source/export boundary a privátní
expected autoritu a vrátí pouze nové kopie validovaných bytes a path-free
bezpečnou projekci. Expected authority se neobjeví ve veřejném resultu, JSON,
stdout ani stderr.

## 7. Stop condition a eskalace

Zastavit dotčenou část při jiné variantě než přijaté 024, potřebě nové
migrace/dependency/public connectoru, změně 062, nejasné durable-root autoritě,
novém požadavku na concurrent/cross-process idempotency nebo konfliktu s
aktivním writerem. Veřejný WP souběžnou issuance netvrdí; deterministické ID
chrání pouze duplicate stejného in-memory parent resultu. Bezpečné read-only
review a dokumentační evidence mohou pokračovat.

## 8. Přesné ověření a evidence DAG

Po dokončení issuer subjectu běží v čistém feature checkoutu a při Review B
znovu v `git clone --no-local` zúžený blok, který neduplikuje už existující
repository/coordinator/binding matice:

```bash
set -euo pipefail
npm ci --offline
node --check scripts/issue-model-failover-proof.js
node tests/m1-model-failover-proof-issuer.test.js
node tests/m1-model-failover-parent-acceptance.test.js
node tests/m1-model-failover-proof-policy.test.js
node tests/m1-model-failover-schema.test.js
node tests/schema-migrations.test.js
node tests/artifact-validation.test.js
node scripts/validate-test-registry.js --json
git diff --check
test -z "$(git status --porcelain=v1 --untracked-files=all)"
```

Očekávaný výsledek je exit 0 každého příkazu, validní registr a prázdný
porcelain. GPU/Ollama běh
do implementační acceptance nepatří; skutečná parent cesta používá
test-owned loopback provider.

Evidence DAG bude mít vlastní report:

```text
subject S
  -> report-only E_A
  -> merge candidate C na přiděleném integration base
  -> report-only E_B po --no-local fresh-clone Review B
```

Statický WP se po aktivaci nepřepisuje skutečnými subject SHA. Dokud chybí
issuer Review A/B a skutečný operátorský proof, Gate 1 je `BLOCKED`, nikoli
PASS.
