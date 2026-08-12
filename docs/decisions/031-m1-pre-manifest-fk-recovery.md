# 031 — pre-manifest obnova cizích klíčů v nakonfigurované C3 databázi

- **typ:** jednorázové data-recovery a migrační rozhodnutí před M1 execution
  manifestem
- **stav:** `PROPOSED / NO_LIVE_MUTATION_AUTHORITY`
- **integrationRef:** `integration/m1-consolidated-20260810`
- **sourceEvidenceRevision:** Phase A `A_EB` =
  `578d52fc64c0a7f4d123c8cb8aadf2f566e54043`, tree
  `f547142c996dda45428cff85fc148c8f2273ecbd`
- **WP:**
  [`WP-M1-PRE-MANIFEST-FK-RECOVERY`](../wp/WP-M1-PRE-MANIFEST-FK-RECOVERY.md)

Tento dokument zatím žádnou živou změnu nepovoluje. I po jeho docs-only
promotion musí operátor zvlášť přijmout materializovaný privátní plán a jeho
SHA-256. Do té doby se nakonfigurovaná databáze, její sidecary, `.env` a
permissions nemění.

## Ověřený nový predecessor

Jediná explicitně nakonfigurovaná C3 databáze je
`/home/belphareon/Projects/c3-agent-wip/data/c3.db`; konfigurace je v
`/home/belphareon/Projects/c3-agent-wip/.env` jako `C3_DB_PATH=./data/c3.db`.
Read-only baseline měl poslední stamp `2026_04_12_044_v138_runtime_guard`,
`integrity_check=ok` a 46 preexistujících foreign-key violations:

- 34 `api_contracts.lifecycle_id -> project_lifecycles.id`;
- 7 `architecture_state.lifecycle_id -> project_lifecycles.id`;
- 4 `architecture_state.milestone_id -> milestones.id`;
- 1 `conversations.project_id -> projects.id`.

První private-copy migration rehearsal použil canonical `runMigrations()`
právě jednou. Per-file transakce commitnuly 045–054 a 061; migrace 062 se
rollbackla na
`MODEL_FAILOVER_PROOF_PREEXISTING_FOREIGN_KEY_VIOLATION: 46 row(s)` a 064/065
neproběhly. Živá DB a její sidecary zůstaly beze změny. Evidence summary je
`/home/belphareon/Projects/.m1-db-rehearsal.6gi2OK/evidence-summary.md`,
SHA-256
`7c9cbcdb360132c166f92667bcab9a9c388711047ddae8dcf3578cd269584334`;
migration log má SHA-256
`c2e19ba9e99ee4c5ec0aa0c19fac04c49f913fa336bffa05407bc955506cb077`.
Přímý živý migration run je proto zakázaný: nechal by DB částečně na 061.

Pozdější private cleanup pokusy se nepřepisují zeleným B3 výsledkem. Effective
B evidence měla overall verdict `PARTIAL_SOURCE_SHM_METADATA_TOUCH`: read-only
SQLite backup/WAL attach neposunul DB rows/pages, DB bytes, WAL bytes ani módy,
ale změnil mtime live
`/home/belphareon/Projects/c3-agent-wip/data/c3.db-shm`. Její manifest
`/home/belphareon/Projects/m1-fk-cleanup-rehearsal.dHII4c/evidence/effective-evidence-manifest.json`
má SHA-256
`c8e9cf54cad5799ea46de611807b5fe7c9a65b7de9e82f7097476f0ef4ba85cb`.
Před B3 zůstal také `CHANGES_REQUIRED` unbound runner s SHA-256
`b56d7450fe8ccb5485f7b9a87decaf68d7e247a1fd11a185c042ac2ac67b9843`
a zachované harness failures s SHA-256
`4134d152e905fb6ea8cdc28666af5876921e0b0963210bd315bc60f100496573`.
Sealed B3 tyto pokusy pouze referencuje; nemaže je a netvrdí zpětný PASS.

## Posouzené varianty

### A — obnova dvou lifecycle subtree ze záloh: nepřijata

Writer rehearsal v
`/home/belphareon/Projects/m1-preserve-rehearsal.z1lvsM` označil chování jako
`PASS WITH SOURCE-CORRUPTION CAVEAT`; jeho artifact-list digest je
`25283fe3572145a772a2b5a48d5fab6693f39bcc96ef6d47dcc1373df4cc5b82`.
Nezávislé review však skončilo `CHANGES_REQUIRED` pro apply-ready attestation:
provenance obálka nebyla uzavřená, část zdrojů sdílela korupční lineage a
obnovený C5 lifecycle ve fázi `BUILD` nesl neuzavřený stale-session/handoff
runtime risk. Shoda dvou poškozených zdrojů není důkaz pravdy. Varianta A se
proto nesmí použít pro živou obnovu ani jako preserve-data claim.

### B — privátní quarantine a přesný cleanup: doporučená varianta

Sealed writer rehearsal nad exact private snapshotem
`d2023ff49dd27131a03335283ffc580fae10a1f0a1db2f233f6ef7a30fa22bb1`
je v
`/home/belphareon/Projects/m1-fk-cleanup-rehearsal-b3.Zmv24S`.
Jeho final manifest má SHA-256
`9b85d042dc6515431df94f8406e167dee1ed0e825f813b484dd217c1bdab7143`
a writer verdict `PASS_FOR_PINNED_PRIVATE_SNAPSHOT`. Prokázal:

- privátní export preimage, potom v jedné repair transakci přesně
  `DELETE 34 api_contracts`, `DELETE 7 architecture_state`, žádné smazání
  konverzace a právě jeden `conversations.project_id -> NULL`;
- `foreign_key_check=0`, `quick_check=ok`, `integrity_check=ok`;
- právě jedno volání canonical `runMigrations()`, bez retry: 14 aplikovaných
  migrací 045–054, 061, 062, 064 a 065, výsledkem 60 stampů a latest 065;
- žádný live DB, credential, model, network ani Ollama effect.

Independent supplement v
`/home/belphareon/Projects/m1-b3-independent-supplement.8hBhg7` skončil
`PASS_FOR_PINNED_PRIVATE_SNAPSHOT_SUPPLEMENT`. Jeho manifest má SHA-256
`7a5e01f974298ccd4513bf64da3148f917dfec2152750d135c060f9197050ada`
a verification SHA-256
`7594bd687b6d25552bbf377e89d6eae46fb00339c21ac91c64a2808c6806395d`.
Reviewer odvodil skutečný production active-selection call graph: mapování
zůstalo 73 → 73 se shodným canonical digestem
`745cda2ee90a0fee006874941a4bf18da927b4f764e8eab543aee64e7d5ac3d8`.
Všech pět schema-derived child setů orphan konverzace bylo před i po prázdných.
Finální nezávislý B3 verdikt je `PASS_FOR_PINNED_PRIVATE_SNAPSHOT` a doporučuje
variantu B před odmítnutou A.

Oba PASS verdicty jsou omezené na připnutý privátní snapshot. Neprokazují
současný živý stav a samy nejsou autoritou k mutaci. Před live execution musí
exact schema/stamp, counts a šest domain digestů, FK46 vector, target preimage
hashes/counts, five-child closure i active map 73/digest souhlasit. Jiný stav
znamená přesně `STOP_NO_APPLY_RE-CENSUS_REPLAN_REHEARSE`.

## Přiznaná cena varianty B

B je lossful cleanup governance orphanů, nikoli obnovení jejich významu.
Privátní backup a exact preimage export zachovají recoverability, ale živá DB
po úspěchu nebude obsahovat 34 orphan API contracts ani 7 orphan architecture
state rows. Jediná orphan konverzace zůstane zachovaná a ztratí pouze
neobnovitelný project link; všech pět jejích child setů je prázdných.

Foreign-key nula neznamená úplnou doménovou čistotu. Po cleanupu zůstává
explicitní `UNRESOLVED_NON_FK_PROVENANCE_DEBT`: 300 `api_contracts`, 48
distinct deklarovaných milestone IDs, 0 `milestones` a 0 exact lifecycle ↔
milestone joins. Tento dluh se nesmí přeznačit na opravenou provenance ani
schovat za `integrity_check=ok`.

## Oddělená autorita a pořadí

Promované 026 dodalo census/plan/apply nástroj, ale jeho PASS výslovně
netvrdil skutečný operátorský census nebo apply. B3 Phase A zase zakazuje user
DB/config změnu. Cleanup, permission hardening a schema migration proto nejsou
implementační detail ani položka dnešního `M1-EXECUTION-MANIFEST`; vyžadují
toto samostatné recovery rozhodnutí.

Povinné pořadí je:

```text
docs-only 031 + WP independent PASS
  -> canonical fast-forward promotion
  -> fresh live read-only/no-handle/no-drift plan
  -> exact operator acceptance varianty B + materialized plan SHA-256
  -> permissions + backup + quarantine + repair + one-shot migrations
  -> FK/integrity/latest-065 verification
  -> separate explicit 026 authority for credential census once + plan once
  -> jeden společný M1-EXECUTION-MANIFEST pro credentials + model
  -> B3 Phase B
```

Recovery plan je data-recovery prerequisite, ne druhý credentials/model
manifest. Pozdější M1 execution manifest zůstává jediný a digest-bound. Toto
rozhodnutí nevybírá fallback model, nevydává proof a nepovoluje pull, delete,
stop, unload nebo rebind.

031 docs, jejich review/promotion, materializace ani operátorské přijetí
recovery plánu nepovolují credential census, credential plan ani apply.
Úspěšná recovery pouze splní jejich databázový prerequisite. Následný canonical
026 census a plan vyžadují novou samostatnou explicitní autoritu operátora;
credential apply smí vzniknout až z později zvlášť přijatého exact
`M1-EXECUTION-MANIFEST`.

B3 Phase B zůstává přesně podle terminal-failover WP na disposable file-backed
DB/runtime. Nakonfigurovaná user DB, její config a jiné user files se v
modelové Phase B nemění; recovery tohoto rozhodnutí se nesmí použít k rozšíření
její effect authority.

## Late-bound privátní plán

Po docs promotion, ale před operátorskou akceptací se smí pouze read-only
materializovat jeden nový root tohoto exact tvaru:

```text
/home/belphareon/.local/share/intentsmith-private/m1-pre-manifest-fk-recovery-<UTC_BASIC>-<16-lowerhex>
```

`UTC_BASIC` je přesně `YYYYMMDDTHHMMSSZ`; suffix je 16 kryptograficky
náhodných lowercase hex znaků. Materializovaný plán nahradí oba tokeny a
uvede každý níže definovaný path jako absolutní string. Operátor přijímá právě
jeho exact SHA-256; template ani adresář bez plánu nejsou authority.

Root musí před vytvořením neexistovat, parent
`/home/belphareon/.local/share/intentsmith-private` musí být real directory
mode `0700`, vlastněný current UID a bez symlink traversal. Root i subdirectory
vzniknou exclusive mode `0700`; každý sealed artifact je regular,
owner-owned, single-link, no-follow a mode `0400`, pracovní DB pouze `0600`.
Exact suffix paths jsou:

```text
plan/recovery-plan.json
plan/recovery-plan.sha256
backup/c3-pre-recovery.db
backup/c3-pre-recovery.db.sha256
quarantine/orphan-api-contracts.json
quarantine/orphan-architecture-state.json
quarantine/orphan-conversation-preimage.json
quarantine/failed-live-after-error.db
evidence/live-preflight.json
evidence/execution-started.json
evidence/execution-finished.json
evidence/execution-failed.json
evidence/permissions-started.json
evidence/permissions-finished.json
evidence/backup-started.json
evidence/backup-finished.json
evidence/quarantine-started.json
evidence/quarantine-finished.json
evidence/repair-started.json
evidence/repair-finished.json
evidence/migration-started.json
evidence/migration-finished.json
evidence/restore-started.json
evidence/restore-finished.json
evidence/post-verification.json
evidence/artifact-manifest.json
evidence/artifact-manifest.sha256
evidence/recovery-instructions.json
```

Conditional failure/restore artifacts smějí být absent při úspěchu; plán
jejich očekávanou absenci nebo přítomnost uvede. Žádný raw row, identifier nebo
secret nesmí opustit tento privátní root.

Tento rozšířený seznam opravuje rozpor mezi původním exact suffix seznamem a
požadavkem WP na oddělený marker každé fáze. Executor je vložen přímo v plánu
jako exact UTF-8 source a SHA-256 a smí být spuštěn jen izolovaným připnutým
Pythonem (`-I -S -c`) s exact `--plan` a operátorem přijatým SHA-256; není to
nový suffix ani neauditovaný helper. `artifact-manifest.json` inventarizuje
všechny ostatní přítomné exact suffix artefakty a explicitně vyjme pouze sebe a
svůj detached digest z rekurzivního hash scope. Po vytvoření obou musí executor
ověřit jejich mode/owner/link/bytes/digest readback a konečný exact path set;
nejde o výjimku pro neinventarizovaný helper nebo data.

## Fresh live gate a permissions

Plán pinuje exact bytes/digest/mode/owner/link/inode stav DB, existujících
WAL/SHM a `.env`, relevantní logical row fingerprints, latest 044, přesně 46 FK
violations, repo revisions, migration source closure a nulové exact-path
handles. Těsně před prvním chmod se celý gate zopakuje. Jakýkoli drift,
process/server/worker, open DB/WAL/SHM handle, neempty WAL, jiný FK set/count,
jiný stamp, nejasný owner nebo path znamená
`STOP_NO_APPLY_RE-CENSUS_REPLAN_REHEARSE` a novou operátorskou akceptaci.

Přijímaný plán smí měnit permissions pouze takto, pokud fresh preflight stále
vidí dnešní exact výchozí módy:

```text
/home/belphareon/Projects/c3-agent-wip                    0775 -> 0755
/home/belphareon/Projects/c3-agent-wip/data               0775 -> 0700
/home/belphareon/Projects/c3-agent-wip/.env               0664 -> 0600
/home/belphareon/Projects/c3-agent-wip/data/c3.db          0644 -> 0600
/home/belphareon/Projects/c3-agent-wip/data/c3.db-wal      0644 -> 0600
/home/belphareon/Projects/c3-agent-wip/data/c3.db-shm      0644 -> 0600
```

Chybějící sidecar se kvůli chmod nevytváří. `.env` bytes se nemění. Jiný
výchozí mód není implicitní no-op ani oprávnění k širšímu chmod; plán se
znovu vytvoří. Hardening se při pozdějším recovery failure automaticky
nevrací na group-writable módy.

## STOP a restore

- Selhání před repair commitem skončí bez datové mutace; repair transaction se
  rollbackne a migrace se nespustí.
- Po repair commitu nebo po prvním spuštění migrations znamená jakékoli
  selhání `STOP`, žádný retry a právě jeden předem přijatý restore attempt z
  verified `backup/c3-pre-recovery.db`. Partial stamps nesmějí zůstat live.
- Před restore se failed live image zachová do exact conditional quarantine
  pathu. Restore vrací logický pinned pre-recovery stav latest 044 / 46 FK
  violations; netvrdí byteově shodný inode nebo SQLite header. Stale sidecary
  se nesmějí znovu použít.
- Pokud restore neprojde exact verification, server/workers zůstanou vypnuté,
  stav je `BLOCKED_RESTORE_REQUIRED` a žádný další pokus, migration, census ani
  manifest nevznikne bez nové autority.
- Po úspěšném recovery se server/workers rovněž automaticky nerestartují.
  Quiescent stav pouze umožní požádat o samostatnou 026 census/plan autoritu;
  031 ji ani apply autoritu samo nevytváří.

## Exact operátorská akceptace

Po independent docs PASS, canonical promotion a materializaci plánu musí
operátor potvrdit v jednom bloku minimálně:

```text
031: B-QUARANTINE-CLEANUP
031-live-database: /home/belphareon/Projects/c3-agent-wip/data/c3.db
031-recovery-plan-sha256: <materialized exact lowercase 64hex>
031-data-effect: DELETE-34-API-CONTRACTS + DELETE-7-ARCHITECTURE-STATE + NULL-ONE-CONVERSATION-PROJECT-LINK
031-permissions: ROOT-0755 + DATA-0700 + DB-WAL-SHM-ENV-0600
031-migrations: ONE-SHOT-045-065-NO-RETRY
031-restore: ONE-VERIFIED-BACKUP-RESTORE-ATTEMPT-ON-POST-COMMIT-FAILURE
031-non-fk-debt: ACK-300-API-48-IDS-0-MILESTONES-0-JOINS
031-model-fallback: UNSELECTED-UNTIL-M1-EXECUTION-MANIFEST
```

Jiná odpověď, neúplný blok nebo digest mismatch znamená `NOT_AUTHORIZED`.
Souhlas s dokončením M1 ani přijetí pozdějšího execution manifestu se nesmí
zpětně vydat za tento souhlas.
