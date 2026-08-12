# WP-M1-PRE-MANIFEST-FK-RECOVERY — exact quarantine cleanup před credential census

**Typ:** jednorázový operátorský data-recovery prerequisite · **Slot:** jeden
executor, server/workers quiescent, žádný souběžný DB writer

**Rozhodnutí:**
[`031 / B-QUARANTINE-CLEANUP`](../decisions/031-m1-pre-manifest-fk-recovery.md)

**sourceEvidenceRevision:** Phase A `A_EB` =
`578d52fc64c0a7f4d123c8cb8aadf2f566e54043`, tree
`f547142c996dda45428cff85fc148c8f2273ecbd`

**integrationRef:** `integration/m1-consolidated-20260810`

**Stav:** `PROPOSED / BLOCKED_ON_INDEPENDENT_DOCS_PASS + CANONICAL_PROMOTION +
EXACT_OPERATOR_PLAN_ACCEPTANCE`

## 1. Výsledek

Před credential census vznikne verified privátní backup a quarantine preimage,
potom jediná atomická cleanup transakce a právě jedno canonical migration
invocation do 065. Úspěch vyžaduje FK nula, `quick_check=ok`,
`integrity_check=ok`, 60 stampů a latest 065. WP netvrdí, že zbývajících 300
API rows má čistou milestone provenance.

WP neprovádí credential transfer/scrub ani modelový effect. Odemkne pouze
canonical 026 census a plan, ze kterých později vznikne jediný společný
credentials+model `M1-EXECUTION-MANIFEST`.

## 2. Scope

**Povolené live paths:**

- `/home/belphareon/Projects/c3-agent-wip` pouze exact chmod `0755`;
- `/home/belphareon/Projects/c3-agent-wip/data` pouze exact chmod `0700`;
- `/home/belphareon/Projects/c3-agent-wip/.env` pouze exact chmod `0600`, bytes
  invariantní;
- `/home/belphareon/Projects/c3-agent-wip/data/c3.db` pouze backup, exact repair,
  canonical migrations a případný předem přijatý restore;
- existující `c3.db-wal` a `c3.db-shm` pouze SQLite-owned lifecycle a exact
  chmod `0600`; žádný direct content edit.

**Povolený private output:** právě jeden late-bound root podle decision 031
pod `/home/belphareon/.local/share/intentsmith-private`, mode `0700`, s exact
plan/backup/quarantine/evidence paths.

**Zakázané:** tracked repo zápis během live execution, jiná user DB/project/
config cesta, změna `.env` bytes, secret output, `/tmp`, síť, server, workers,
Electron, Ollama, GPU, model pull/delete/stop/unload/rebind, credential apply a
automatický restart. Raw identifiers a rows zůstávají jen v private
quarantine; veřejný výstup používá counts a digests.

## 3. Plan freeze a fresh gate

Decision 031, tento WP a `m1-batch` amendment nejdřív projdou nezávislým docs
review (`writer != reviewer`) a canonical fast-forward promotion. Potom
read-only planner vytvoří exclusive private root a sealed plan, který pinuje:

- exact configured path, A_EB revision/tree a migration source closure;
- DB/WAL/SHM/env identity, digests, modes a nulové exact-path handles;
- schema count 46/latest044, counts a šest domain digestů;
- FK46 relation vector, exact 34/7/1 preimage hashes, pět prázdných
  conversation child setů a active projection 73 rows/digest
  `745cda2ee90a0fee006874941a4bf18da927b4f764e8eab543aee64e7d5ac3d8`;
- každý materializovaný absolute plan/backup/quarantine/evidence path,
  executor/source hashes, effects, restore postup a `modelFallback=null`.

Těsně před prvním chmod se celý gate zopakuje. Mismatch znamená
`STOP_NO_APPLY_RE-CENSUS_REPLAN_REHEARSE`; stale plán zůstane evidencí a nový
plán vyžaduje novou exact operátorskou akceptaci.

## 4. Jediný povolený live běh

Po exact akceptaci proběhne sériově:

1. exclusive `execution-started` marker;
2. pouze šest exact permission přechodů z decision 031, s invariantními bytes;
3. při nulových handles a empty WAL consistent SQLite backup, fsync, mode
   `0400`, digest/readback, latest044/FK46/integrity verification;
4. exclusive mode-0400 export exact 34 API, 7 architecture a jedné
   conversation preimage s plan-bound counts/digests;
5. právě jedna repair transaction: preimage recheck, delete 34+7, žádné
   conversation delete, jeden orphan `project_id=NULL`, commit jen při FK0 a
   invariantních nedotčených domain digestech;
6. exclusive migration-started marker a právě jedno `runMigrations(db)`, bez
   retry;
7. exact applied set 045–054, 061, 062, 064, 065, celkem 60/latest065;
8. po DB close FK0, quick/integrity ok, counts API300/architecture372/
   conversations876/milestones0, šest domain digestů a unresolved tuple
   `300/48/0/0`;
9. úplný sealed artifact inventory a detached digest.

Každá fáze má oddělený O_EXCL STARTED/FINISHED marker. FINISHED se nevydá při
nedokončené fázi a marker se nepřepisuje.

## 5. Failure a restore

- Selhání před repair commitem: `STOP`, repair rollback, žádné migrations.
  Permission hardening se nevrací na group-writable mód.
- Selhání po repair commitu nebo migration startu: žádný retry; failed live DB
  se zachová do conditional quarantine pathu a proběhne právě jeden předem
  přijatý restore z verified backupu.
- Restore success znamená logický pinned prestate latest044/FK46/counts/
  digests/integrity; byte/inode identita se netvrdí a stale WAL/SHM se
  nerecyklují.
- Restore failure znamená `BLOCKED_RESTORE_REQUIRED`; server/workers zůstanou
  vypnuté a další restore/migration/census vyžaduje novou autoritu.
- Ani po success nenastane auto-restart; backup, quarantine a failure evidence
  se nemažou.

## 6. Acceptance a handoff

PASS vyžaduje shodu operator-accepted plan SHA, oba fresh gates, exact
permissions, backup, 34/7/1 quarantine, jednu repair transaction, jedno
migration invocation bez retry, exact poststate a úplný private inventory.
Unresolved `300 API / 48 IDs / 0 milestones / 0 joins` zůstane výslovně
otevřený.

Potom, stále bez serveru/workers, smí navázat canonical 026 credential census
právě jednou a plan právě jednou. Drift nebo unmappable source zastaví tok před
manifestem; recovery se kvůli tomu automaticky nevrací. Credential apply čeká
na pozdější jediný digest-bound `M1-EXECUTION-MANIFEST` a jeho exact přijetí.
Modelový fallback zůstává v tomto WP nevybraný.

## 7. Stop conditions

Zastavit při chybějícím docs PASS/promotion/operator acceptance, path/mode/
owner/handle/data driftu, jiné FK topologii, nonempty WAL, neověřeném backupu,
preimage mismatch, jiném row count, partial/neočekávaném migration setu,
potřebě síťového/modelového effectu, změně auth/access/trusted-local hranice
nebo potřebě cesty mimo scope. `BLOCKED`, partial stamp, restore failure a
unresolved provenance se nesmějí přeznačit na PASS.
