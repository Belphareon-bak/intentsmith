# C3 Storage Architecture — Backup, Retention, History

**Verze:** v2.0 (2026-08-26)
**Status:** M5 DATA IMPLEMENTATION-GREEN — operator review pending
**Stav implementace overen:** 2026-08-26 — viz [Stav implementace](#stav-implementace)

> Sekce [Stav implementace](#stav-implementace) je popis současného M5 DATA
> řezu. Zbytek dokumentu zachovává širší návrh a není automaticky tvrzením o
> hotové implementaci. Podrobnosti jsou
> v [`docs/review/2026-08-07-SECRET-TYPES.md`](review/2026-08-07-SECRET-TYPES.md)
> a v zadani [`docs/wp/WP-M5-DATA.md`](wp/WP-M5-DATA.md).

---

## Stav implementace

Ověřeno čtením produkční cesty a zaměřeným round-trip testem. Přesná candidate
revize a fresh-clone doklad jsou uvedené v M5 DATA execution reportu.

| Cast navrhu | Stav | Kde |
|---|---|---|
| State backup — vytvoření | **implementováno, V2** | `createStateBackup()`, `src/core/db-backup.js` |
| Výpis záloh | **implementováno** | `listBackups()` |
| Retence 7 denních + 4 týdenní | **implementováno** | `pruneBackups()` |
| Statistiky záloh | **implementováno** | `getBackupStats()` |
| **State restore** | **implementováno, offline-only** | `restoreStateBackup()`, `scripts/restore-state-backup.js` |
| History restore | **NEIMPLEMENTOVANO** | — |
| Daily drain | implementovano | `drainMessages()` |
| Auto-clean | implementovano | `autoClean()` |

Záloha se spouští při nakonfigurovaném startupu, shutdownu a přes systémové
backup routy. `POST /api/system/restore` je úmyslně online connector bez
zapisovací autority: vrací `409 DATABASE_RESTORE_REQUIRES_OFFLINE`. Obnovu smí
provést pouze CLI se zastaveným serverem:

```bash
node scripts/restore-state-backup.js \
  --data-dir /absolutni/cesta/k/data \
  --backup c3-state-YYYY-MM-DDTHH-MM-SS-sssZ.backup
```

CLI ověří úplný manifest, SHA-256 každého souboru, SQLite `quick_check`, přesné
řádky `schema_migrations` a jejich podporu aktuálním releasem. Linux `/proc`
kontrola a vlastněný restore lock odmítnou otevřenou DB nebo souběžný opener.
Před atomickou výměnou vznikne jedinečná `pre-restore-*.db` bezpečnostní kopie.

### Kde se implementace lisi od navrhu

| Navrh rika | Skutecnost |
|---|---|
| `c3.db` se zálohuje přes `db.backup()` (SQLite native) | `wal_checkpoint(TRUNCATE)` + synchronní kopie + fsync |
| `metadata.json` obsahuje jen souhrn | V2 obsahuje přesný content manifest a fingerprints |
| `schema_version` je verze schématu | V2 ukládá seřazené identity z `schema_migrations`; počet je jen odvozený údaj |
| Pruneable log tabulky nejsou v zaloze | jsou — kopiruje se cely soubor `c3.db`, ne vyber tabulek |

### Znama rizika, ktera navrh neresi

**Starý stejno-denní overwrite je odstraněný.** V2 názvy obsahují milisekundový
UTC čas a při kolizi deterministický suffix. Hotová záloha se nikdy nepřepisuje;
nejdřív vzniká privátní partial adresář, který se po fsync atomicky přejmenuje.

**Automatický restore vlastní pouze SQLite databázi.** `skills/`,
`specialists/` a konfigurace zůstávají v backupu jako `archival_only`. Jsou
kódotvorné nebo release-owned, takže je obnova dat nesmí tiše downgradovat.
Legacy V1 zálohy zůstávají listovatelné, ale bez přesného manifestu nejsou
automaticky obnovitelné.

**Zaloha nese tajemstvi v plaintextu.** `user_settings.data` obsahuje
`webhookSecret` jako hodnotu (`src/routes/security.js:218-245`) a kopiruje se
s `c3.db`. Sifrovani at-rest neexistuje. Rotace tajemstvi je proto vratna
obnovou ze starsi zalohy.

---

## Obsah

0. [Stav implementace](#stav-implementace) — co z tohoto navrhu dnes skutecne existuje
1. [Zakladni princip](#zakladni-princip)
2. [Rozdeleni dat](#rozdeleni-dat)
3. [Hybrid model: DB + History soubory](#hybrid-model-db--history-soubory)
4. [Daily drain — odlev historie z DB](#daily-drain--odlev-historie-z-db)
5. [State backup](#state-backup)
6. [History backup](#history-backup)
7. [Auto-clean job — automaticke cisteni](#auto-clean-job--automaticke-cisteni)
8. [Kompletni konfigurace](#kompletni-konfigurace)
9. [Triggery](#triggery)
10. [REST API](#rest-api)
11. [FE integrace](#fe-integrace)
12. [DB tabulky — kategorizace](#db-tabulky--kategorizace)
13. [Adresarova struktura](#adresarova-struktura)
14. [FTS strategie](#fts-strategie)
15. [Restore scenar](#restore-scenar)
16. [Implementacni faze](#implementacni-faze)
17. [Budoucnost — marketplace / cloud](#budoucnost--marketplace--cloud)

---

## Zakladni princip

**DB = aktualni stav.** Zadna rostouci historie. Konstantne mala.

**Historie = soubory na disku.** Append-only, mimo DB. Konverzace, lifecycle eventy, memory zmeny.

**Dve oddelene veci:**
- **Retention** = automaticky proces (co drzet, co cistit)
- **Backup** = bezpecnostni proces (jak obnovit)

Nesmí se míchat.

---

## Rozdeleni dat

### A) State (v DB)

Aktualni stav systemu. Nemeni velikost s casem.

- `projects` — metadata projektu
- `conversations` — metadata konverzaci (id, title, expertise, created_at — BEZ messages)
- `expertises`, `conversation_expertises`, `expertise_memory`
- `specialists`, `specialist_expertises`, `specialist_memory`
- `knowledge_facts`, `knowledge_sources`
- `user_settings`, `api_tokens`
- `memory` (LTM — current values)
- `global_memory`, `project_memory`
- `project_lifecycles`, `milestones` (current phase)
- `agents` (worker definice)
- `schema_migrations`
- `session_state`

**Velikost:** ~5-20 MB, konstantni.

### B) Historie (v souborech)

Append-only, linearne roste s pouzitim.

- **Messages** — vsechny zpravy vsech konverzaci
- **Lifecycle eventy** — spec revize, milestone zmeny, drift checks
- **Memory zmeny** — history of value changes
- **Specialist interakce** — tool execution log

**Velikost:** roste, ale retence po 365 dnech maze.

### C) Pruneable logs (v DB, kratka retence)

Heavy data s kratkym zivotem. Mazat automaticky, nearchivovat.

- `agent_logs` — 7 dni
- `llm_execution_log` — 5 dni
- `cre_override_log` — 7 dni
- `telemetry_snapshots` — 7 dni
- `telemetry_metrics` — 14 dni
- `telemetry_alerts` — 14 dni
- `workflow_patterns` — 30 dni
- `drift_checks` — 30 dni
- `specialist_telemetry` — 30 dni

### D) Co se NEZALOHUJE

- `data/artifacts/` — velke binarni prilohy (metadata v DB staci)
- Pruneable logs (viz vyse)
- FTS indexy (rebuild z dat)

---

## Hybrid model: DB + History soubory

```
                    ┌─────────────┐
User message ──────>│   DB (HOT)  │──── UI cte odtud (dnesni zpravy)
                    │  messages   │
                    │  (dnes)     │
                    └──────┬──────┘
                           │ daily drain
                           v
                    ┌─────────────┐
                    │  History    │──── UI cte pri scroll nahoru
                    │  (JSONL)   │
                    │  append    │
                    └─────────────┘
```

### Jak to funguje

1. **Zpravy se pisi do DB** normalne (zadna zmena v chat pipeline)
2. **Daily drain job** presune vcera a starsi zpravy z DB do JSONL souboru
3. **DB drzi jen dnesni zpravy** (nebo posledni N hodin — konfigurovatelne)
4. **UI cte z DB** pro aktualni konverzaci
5. **Starsi zpravy** se ctou z JSONL pri scrollovani nahoru / otevřeni stare konverzace
6. **FTS** je jen nad DB (dnesni data) — deep search pres JSONL je volitelny

### Proc hybrid a ne full event-sourcing

- **Zadny refaktor chat pipeline** — zapis do DB zustava stejny
- **Zadny refaktor cteni** pro aktualni konverzace — SQL dotazy funguji
- **Jediny novy kod**: drain job + JSONL reader pro stare konverzace
- **Postupny prechod** — muze byt hotovy za den, ne za tyden

---

## Daily drain — odlev historie z DB

### Co se odleva

| Tabulka | Drain pravidlo | Cilovt soubor |
|---------|---------------|---------------|
| `messages` | starsi nez 1 den | `history/conversations/{shard}/{conv_id}.jsonl` |
| `messages_fts` | orphaned rowids | (delete + optimize) |
| `project_lifecycles` history | completed faze | `history/lifecycle/{project_id}.jsonl` |
| `milestones` | completed/failed | `history/lifecycle/{project_id}.jsonl` |
| `specialist_memory` | starsi nez retence | `history/memory/{specialist_id}.jsonl` |

### Drain algoritmus

```
drain():
  1. BEGIN TRANSACTION
  2. SELECT messages WHERE created_at < datetime('now', '-{cutoffHours} hours')
     AND conversation_id NOT IN (SELECT id FROM conversations WHERE deleted_at IS NOT NULL)
  3. GROUP BY conversation_id
  4. Pro kazdy conversation_id:
     a. shard = conv_id.slice(0, 2)
     b. Ensure dir: history/conversations/{shard}/
     c. Append do history/conversations/{shard}/{conv_id}.jsonl
        - fs.openSync(path, 'a') + writeSync + fsyncSync + closeSync
        - Format: jedna JSON radka per message
     d. Pokud file write selze → skip tuto konverzaci (data zustanou v DB)
  5. DELETE FROM messages WHERE id IN (uspesne drainovane)
  6. DELETE FROM messages_fts WHERE rowid NOT IN (SELECT id FROM messages)
  7. INSERT INTO messages_fts(messages_fts) VALUES('optimize')
  8. COMMIT
  9. Pokud commit selze → duplicity v JSONL (dedup pri cteni, viz Bezpecnost)
```

### JSONL format (per message)

```json
{"id":"msg-123","conv_id":"conv-abc","role":"user","content":"...","metadata":"{}","created_at":"2026-03-01T14:00:00Z"}
{"id":"msg-124","conv_id":"conv-abc","role":"assistant","content":"...","metadata":"{\"mode\":\"ANSWER\"}","created_at":"2026-03-01T14:00:05Z"}
```

### Bezpecnost

- Drain je v transakci — bud vse nebo nic
- JSONL append je `fs.openSync` + `fs.writeSync` + `fs.fsyncSync` (synchronni, crash-safe)
- Pokud JSONL zapis selze → skip konverzaci, data zustanou v DB
- Partial JSON line detection pri cteni (posledni radka bez `\n` = zahodit)

### Deduplikace (reseni atomicity gap)

JSONL zapis a DB commit nejsou jeden atomicky celek. Pokud JSONL append uspeje ale DB commit selze, pri pristim drainu se stejne zpravy zapisi znovu → duplicity v JSONL.

**Reseni:** Reader deduplikuje po message ID pri cteni:
```
readConversationHistory():
  lines = read JSONL soubor
  seen = Set()
  Pro kazdy radek:
    msg = JSON.parse(radek)
    Pokud msg.id in seen → skip
    seen.add(msg.id)
```

Toto je idempotentni — duplicity nemaji vliv na spravnost, jen na velikost souboru. Periodicka kompakce (budoucnost) muze deduplikovat i na disku.

### Integrity check (pri startu)

Pri startu serveru pro kazdy JSONL soubor:
1. Overit ze posledni radka konci `\n`
2. Pokud ne → truncate posledni neukonceny radek
3. Overit ze kazdy radek je validni JSON (lazy — jen pokud se soubor cte)

Toto zachyti crash uprostred zapisu.

### Drain vs soft-delete

Drain NESMI zapisovat zpravy z konverzaci, ktere jsou soft-deleted. Jinak by se po hard-delete (auto-clean krok 2) JSONL soubor smazal, ale dalsi drain by ho znovu vytvoril ze zbyvajicich zprav v DB.

Ochrana: drain query filtruje `WHERE conversation_id NOT IN (SELECT id FROM conversations WHERE deleted_at IS NOT NULL)`. Soft-deleted konverzace se nedraini — jejich zpravy zrusi hard-delete v auto-clean.

---

## State backup

### Co obsahuje

1. **c3.db** — `wal_checkpoint(TRUNCATE)` + `fs.copyFileSync()` (synchronni)
   > Navrh puvodne pocital s `db.backup()` (SQLite native). Implementace ho
   > nepouziva — viz [Stav implementace](#kde-se-implementace-lisi-od-navrhu).
2. **skills/*.json** — skill definice
3. **specialists/*/** — specialist baliky
4. **data/c3-setup.json** — setup konfigurace
5. **data/design-defaults.json** — tech stack defaults

### Co NEobsahuje

- `data/history/` — to je history backup (oddeleny)
- `data/artifacts/` — velke binarni prilohy
- ~~Pruneable log tabulky~~ — **navrh; implementace je zahrnuje.** Kopiruje se
  cely soubor `c3.db`, ne vyber tabulek, takze pruneable logy v zaloze jsou.

### Format

```
data/backups/
  c3-state-2026-03-01.backup/
    c3.db
    skills/
      create-expertise.json
      create-skill.json
    specialists/
      accountant-cz/
      dummy-logger/
    config/
      c3-setup.json
      design-defaults.json
    metadata.json
```

### metadata.json

Navrh:

```json
{
  "version": "91.0.0",
  "schema_version": 25,
  "created_at": "2026-03-01T18:00:00Z",
  "type": "state",
  "db_size_bytes": 5242880,
  "tables_excluded": ["agent_logs", "llm_execution_log", "telemetry_*"]
}
```

Skutecne zapisovana metadata (`db-backup.js:137-145`):

```json
{
  "version": "...",
  "schema_version": 47,
  "created_at": "...",
  "type": "state",
  "db_size_bytes": 0,
  "files_count": 0,
  "total_size_bytes": 0
}
```

Rozdily: `tables_excluded` se nezapisuje a `schema_version` je
`SELECT COUNT(*) FROM migrations` — tedy **pocet** migraci, ne identita
schematu. Kompatibilitni kontrola pri restore na tom stat nemuze.

### Retence zaloh

- Dnesni zaloha prepise predchozi ze stejneho dne
- Drzi max **7 dennich** + **4 tydennich** (nedele)
- Celkem max ~11 zaloh
- Starsi se automaticky mazou

---

## History backup

### Co obsahuje

```
data/history/
  conversations/
    conv-abc123.jsonl
    conv-def456.jsonl
  lifecycle/
    proj-xyz.jsonl
  memory/
    specialist-changes.jsonl
```

### Backup metoda

Jednoducha kopie `data/history/` adresare. Soubory jsou append-only, takze:
- rsync / cp je bezpecne
- Inkrementalni kopie (jen nove/zmenene soubory) je efektivni

### Retence historie

- Konverzace: **365 dni** (default, konfigurovatelne)
- Lifecycle: **365 dni**
- Memory changes: **180 dni**
- Pred smazanim: **ask before delete** (UI dialog)

---

## Auto-clean job — automaticke cisteni

### Princip

Automaticky cistici job bezi periodicky (default: 1x denne). Maze data ze dvou mist:

1. **DB tabulky** — pruneable logy s kratkou retenci (heavy data, nearchivuji se)
2. **History JSONL soubory** — stare konverzace/lifecycle/memory soubory po retenci

Vsechny retencni doby jsou **konfigurovatelne** pres `user_settings` (viz sekce 8).

### Co se cisti a kdy (defaults)

#### A) DB tabulky — prune (smazat, nearchivovat)

| Tabulka | Konfig klic | Default | Min | Popis |
|---------|-------------|---------|-----|-------|
| `llm_execution_log` | `retention.llm_logs` | **5 dni** | 1 | LLM volani, tokeny, latence |
| `agent_logs` | `retention.agent_logs` | **7 dni** | 1 | Worker execution logy |
| `cre_override_log` | `retention.cre_logs` | **7 dni** | 1 | CRE rozhodnuti a overrides |
| `telemetry_snapshots` | `retention.telemetry` | **7 dni** | 1 | Specialist telemetrie snapshots |
| `telemetry_metrics` | `retention.telemetry` | **14 dni** | 1 | Specialist metriky (sdili klic s snapshots) |
| `telemetry_alerts` | `retention.telemetry` | **14 dni** | 1 | Specialist alerty |
| `specialist_telemetry` | `retention.specialist_telemetry` | **30 dni** | 7 | Specialist interaction log |
| `workflow_patterns` | `retention.workflow_patterns` | **30 dni** | 7 | Skill detector patterns |
| `drift_checks` | `retention.drift_checks` | **30 dni** | 7 | Lifecycle drift checks |
| `capability_drift_log` | `retention.drift_checks` | **30 dni** | 7 | Capability drift (sdili klic) |
| `auto_expertise_log` | `retention.expertise_logs` | **30 dni** | 7 | Auto-select logy |
| `merge_audit_log` | `retention.expertise_logs` | **30 dni** | 7 | Merge engine audit (sdili klic) |
| `skill_steps` | `retention.skill_steps` | **30 dni** | 7 | Skill execution kroky |
| `audit_events` | `retention.audit_events` | **90 dni** | 14 | Security audit log |
| `quality_scores` | `retention.quality_scores` | **90 dni** | 14 | Kvalitni skore odpovedi |

Poznamka: tabulky se sdilenym konfig klicem pouzivaji stejnou hodnotu. Uzivatel nastavuje jen hlavni klic (napr. `retention.telemetry = 14`) a ten se aplikuje na vsechny tabulky v te skupine.

#### B) History JSONL soubory — prune (smazat po retenci)

| Typ souboru | Konfig klic | Default | Min | Adresar |
|-------------|-------------|---------|-----|---------|
| Konverzace | `retention.conversations` | **365 dni** | 30 | `history/conversations/*.jsonl` |
| Lifecycle | `retention.lifecycle` | **365 dni** | 30 | `history/lifecycle/*.jsonl` |
| Memory changes | `retention.memory_changes` | **180 dni** | 30 | `history/memory/*.jsonl` |

Retence u JSONL se pocita od `mtime` souboru (posledni zapis = posledni zprava).

#### C) Soft-deleted items — hard delete po grace period

| Typ | Konfig klic | Default | Min |
|-----|-------------|---------|-----|
| Konverzace | `retention.soft_delete_grace` | **14 dni** | 1 |
| Projekty | `retention.soft_delete_grace` | **14 dni** | 1 |

Uzivatel smaze konverzaci/projekt → soft-delete (status='deleted' / deleted_at). Po grace period se hard-deletnnou vcetne vsech messages a sub-dat.

### Auto-clean algoritmus

```
auto_clean(db, dataDir, config):
  stats = {}

  ── 1. Prune DB tabulky ──
  Pro kazdy radek v tabulce A) vyse:
    effectiveDays = max(policy.min, config[policy.klic] || policy.default)
    Pokud DB pod tlakem (>500MB): effectiveDays *= 0.75
    Pokud DB pod silnym tlakem (>2GB): effectiveDays *= 0.5
    DELETE FROM {table} WHERE {dateCol} < datetime('now', '-{effectiveDays} days')
    stats[table] = deleted_count

  ── 2. Hard-delete soft-deleted items ──
  graceDays = config.soft_delete_grace || 14
  deletedConvIds = SELECT id FROM conversations WHERE deleted_at < now - graceDays
  DELETE conversations WHERE id IN deletedConvIds (cascade messages)
  DELETE projects WHERE status='deleted' AND updated_at < now - graceDays (cascade)
  // Smazat i orphaned JSONL soubory pro smazane konverzace:
  Pro kazdy convId v deletedConvIds:
    shard = convId.slice(0, 2)
    Pokud existuje history/conversations/{shard}/{convId}.jsonl → smazat

  ── 3. Prune history JSONL ──
  Pro kazdy typ v tabulce B) vyse:
    retentionDays = config[typ.klic] || typ.default
    Pro kazdy soubor v adresari:
      Pokud soubor.mtime < now - retentionDays → smazat

  ── 4. FTS cleanup ──
  DELETE FROM messages_fts WHERE rowid NOT IN (SELECT id FROM messages)
  INSERT INTO messages_fts(messages_fts) VALUES('optimize')

  ── 5. LTM TTL pruning ──
  DELETE FROM memory WHERE ttl IS NOT NULL AND age > ttl

  ── 6. Compact (podminene) ──
  Pokud stats.totalDeleted > 50 NEBO pressure != 'normal':
    WAL checkpoint(TRUNCATE) + ANALYZE
  Pokud DB > threshold (500MB) a posledni VACUUM > 7 dni:
    VACUUM

  return stats
```

### Casovani

| Interval | Co bezi | Konfigurovatelne |
|----------|---------|-----------------|
| **Pri startu serveru** | Plny auto_clean() | ne (vzdy) |
| **Denne** (24h interval) | Plny auto_clean() | `clean.interval_hours` (default: 24, min: 1, max: 168) |
| **Manualne** | `POST /api/system/clean` | vzdy dostupne |

Interval je `setInterval`, `.unref()` (nebrani ukonceni procesu).

### Logovani

Kazdy beh auto_clean loguje:
```
[Retention] Auto-clean: 142 rows pruned (llm_execution_log: 89, agent_logs: 38, ...), 2 JSONL files deleted, DB: 12MB (normal)
```

Pokud se nic nesmaze: zadny log (tichy uspech).

---

## Kompletni konfigurace

### Ulozeni

Konfigurace je soucasti `user_settings` (tabulka, id=1, JSON blob). Klice pod `storage.*`:

```json
{
  "storage": {
    "retention": {
      "conversations": 365,
      "lifecycle": 365,
      "memory_changes": 180,
      "llm_logs": 5,
      "agent_logs": 7,
      "cre_logs": 7,
      "telemetry": 14,
      "specialist_telemetry": 30,
      "workflow_patterns": 30,
      "drift_checks": 30,
      "expertise_logs": 30,
      "skill_steps": 30,
      "audit_events": 90,
      "quality_scores": 90,
      "soft_delete_grace": 14
    },
    "backup": {
      "on_shutdown": true,
      "on_startup": true,
      "periodic": false,
      "periodic_hours": 24,
      "max_daily": 7,
      "max_weekly": 4
    },
    "drain": {
      "cutoff_hours": 24,
      "enabled": true
    },
    "clean": {
      "interval_hours": 24,
      "enabled": true
    }
  }
}
```

### Validacni pravidla

| Sekce | Klic | Typ | Default | Min | Max | Poznamka |
|-------|------|-----|---------|-----|-----|----------|
| retention | conversations | int | 365 | 30 | 3650 | JSONL soubory |
| retention | lifecycle | int | 365 | 30 | 3650 | JSONL soubory |
| retention | memory_changes | int | 180 | 30 | 3650 | JSONL soubory |
| retention | llm_logs | int | 5 | 1 | 365 | DB tabulka |
| retention | agent_logs | int | 7 | 1 | 365 | DB tabulka |
| retention | cre_logs | int | 7 | 1 | 365 | DB tabulka |
| retention | telemetry | int | 14 | 1 | 365 | DB — snapshots + metrics + alerts |
| retention | specialist_telemetry | int | 30 | 7 | 365 | DB tabulka |
| retention | workflow_patterns | int | 30 | 7 | 365 | DB tabulka |
| retention | drift_checks | int | 30 | 7 | 365 | DB — drift + capability_drift |
| retention | expertise_logs | int | 30 | 7 | 365 | DB — auto_expertise + merge_audit |
| retention | skill_steps | int | 30 | 7 | 365 | DB tabulka |
| retention | audit_events | int | 90 | 14 | 3650 | DB tabulka |
| retention | quality_scores | int | 90 | 14 | 365 | DB tabulka |
| retention | soft_delete_grace | int | 14 | 1 | 365 | Soft-delete grace period |
| backup | on_shutdown | bool | true | — | — | Backup pri vypnuti IDE |
| backup | on_startup | bool | true | — | — | Backup pri startu |
| backup | periodic | bool | false | — | — | Periodicke zalohy |
| backup | periodic_hours | int | 24 | 1 | 168 | Interval v hodinach |
| backup | max_daily | int | 7 | 1 | 30 | Max dennich zaloh |
| backup | max_weekly | int | 4 | 1 | 12 | Max tydennich zaloh |
| drain | cutoff_hours | int | 24 | 1 | 168 | Drain messages starsi nez N hodin |
| drain | enabled | bool | true | — | — | Drain zapnut/vypnut |
| clean | interval_hours | int | 24 | 1 | 168 | Interval auto-clean v hodinach |
| clean | enabled | bool | true | — | — | Auto-clean zapnut/vypnut |

### Cteni konfigurace (BE)

```javascript
function getStorageConfig(db) {
  try {
    const row = db.prepare('SELECT data FROM user_settings WHERE id = 1').get();
    if (!row) return DEFAULTS;
    const settings = JSON.parse(row.data);
    return mergeDefaults(settings.storage || {}, DEFAULTS);
  } catch (_) {
    return DEFAULTS;
  }
}
```

Kazdy dotaz na konfiguraci pouziva `mergeDefaults()` — chybejici klice se doplni z defaultu, hodnoty mimo rozsah se orezou na min/max.

### Zmena konfigurace

- **BE**: `PUT /api/system/storage/settings` — validace + merge do user_settings
- **FE**: Settings > Uloziste — formular s inputy + apply
- **Reload**: po zmene se restartuje `setInterval` pro auto-clean (novy interval)

---

## Triggery

| Trigger | Co se stane | Konfig klic | Default |
|---------|-------------|-------------|---------|
| **Start serveru** | auto_clean + drain + backup | `backup.on_startup` | ON |
| **Vypnuti IDE** | drain + backup | `backup.on_shutdown` | ON |
| **Periodicky** | auto_clean + drain | `clean.interval_hours` | 24h, ON |
| **Periodicke zalohy** | backup | `backup.periodic` + `backup.periodic_hours` | OFF |
| **Manualne** | cokoliv | — | vzdy dostupne |

### Poradi operaci

**Startup:**
1. `runMigrations(db)` (existujici)
2. `validateHistoryIntegrity(dataDir)` — truncate neukoncene JSONL radky (crash recovery)
3. `autoClean(db, dataDir, config)` — prune staré logy + orphaned JSONL
4. `drainMessages(db, dataDir, config)` — presun messages do JSONL
5. `createStateBackup(db, dataDir)` — pokud `backup.on_startup = true`
6. Zbytek startu (agents, WS, preload...)

**Shutdown:**
1. Flush telemetry (existujici)
2. `drainMessages(db, dataDir, config)` — presun messages do JSONL
3. `createStateBackup(db, dataDir)` — pokud `backup.on_shutdown = true`
4. `db.close()` (existujici)

**Periodicke (setInterval):**
- Auto-clean: `autoClean()` kazdych `clean.interval_hours` hodin
- Backup: `createStateBackup()` kazdych `backup.periodic_hours` hodin (pokud `backup.periodic = true`)
- Oba intervaly `.unref()` (nebrani ukonceni procesu)

### Implementace "pri vypnuti IDE"

1. **FE** (`onWillStop` hook v Theia / `beforeunload`) → `POST /api/system/shutdown-backup`
2. **BE** provede: drain + state backup (synchronni, max ~5s)
3. **SIGINT/SIGTERM** — `gracefulShutdown()` udela totez
4. Pokud IDE crashne a nic se nefiruje → **startup** zachyti stav pri pristim spusteni

---

## REST API

| Endpoint | Metoda | Popis | Faze |
|----------|--------|-------|------|
| `GET /api/system/storage` | GET | Statistiky (DB size, history size, backup count, retention config) | 1 (edit existujici) |
| `GET /api/system/storage/settings` | GET | Aktualni storage konfigurace (retention + backup + drain + clean) | 1 |
| `PUT /api/system/storage/settings` | PUT | Zmena konfigurace (validace + merge + restart intervalu) | 1 |
| `POST /api/system/drain` | POST | Manualni drain (messages z DB → JSONL) | 1 |
| `POST /api/system/clean` | POST | Manualni spusteni auto-clean | 1 |
| `POST /api/system/backup` | POST | Manualni state backup | 2 |
| `GET /api/system/backups` | GET | Seznam zaloh (datum, typ, velikost, schema version) | 2 |
| `POST /api/system/shutdown-backup` | POST | Drain + state backup (volano z FE pri shutdown) | 2 |
| `POST /api/system/restore` | POST | Restore ze zalohy (body: `{ backup_name }`) | 5 |

### Priklad odpovedi

**`GET /api/system/storage`:**
```json
{
  "db_size_mb": 8.2,
  "history": {
    "total_mb": 142,
    "files": 847,
    "conversations": 847,
    "lifecycle": 12,
    "memory": 3
  },
  "backups": {
    "count": 3,
    "last_at": "2026-03-01T14:00:00Z",
    "total_mb": 24
  },
  "messages_in_db": 156,
  "last_clean": "2026-03-01T06:00:00Z",
  "last_drain": "2026-03-01T06:00:00Z"
}
```

**`GET /api/system/storage/settings`:**
```json
{
  "retention": { "conversations": 365, "llm_logs": 5, "..." : "..." },
  "backup": { "on_shutdown": true, "on_startup": true, "periodic": false, "periodic_hours": 24 },
  "drain": { "cutoff_hours": 24, "enabled": true },
  "clean": { "interval_hours": 24, "enabled": true }
}
```

---

## FE integrace

### Settings > Uloziste

```
┌──────────────────────────────────────────────────────┐
│  Uloziste                                             │
│                                                       │
│  DB velikost:     8.2 MB                              │
│  Historie:        142 MB (847 konverzaci)             │
│  Zalohy:          3 (posledni: dnes 14:00)            │
│  Posledni cisteni: dnes 06:00                         │
│                                                       │
│  ─── Retence (historie) ───────────────────────────── │
│  Konverzace:     [365] dni                            │
│  Lifecycle:      [365] dni                            │
│  Memory zmeny:   [180] dni                            │
│                                                       │
│  ─── Retence (DB logy) ───────────────────────────── │
│  LLM logy:              [5] dni                       │
│  Agent logy:             [7] dni                      │
│  CRE logy:               [7] dni                      │
│  Telemetrie:             [14] dni                     │
│  Specialist telemetrie:  [30] dni                     │
│  Audit events:           [90] dni                     │
│  Soft-delete grace:      [14] dni                     │
│                                                       │
│  ─── Zalohy ──────────────────────────────────────── │
│  Pri vypnuti IDE:  [x]                                │
│  Pri startu:       [x]                                │
│  Periodicke:       [ ] kazdych [24] hodin             │
│  Max dennich:      [7]    Max tydennich: [4]          │
│                                                       │
│  ─── Cisteni ─────────────────────────────────────── │
│  Automaticke:      [x] kazdych [24] hodin             │
│  Drain (messages): [x] starsi nez [24] hodin          │
│                                                       │
│  ─── Akce ────────────────────────────────────────── │
│  [Zalohovat ted]  [Cisteni ted]  [Drain ted]          │
│  [Obnovit ze zalohy]  [Zobrazit zalohy]               │
└──────────────────────────────────────────────────────┘
```

Kazda zmena hodnoty → `PUT /api/system/storage/settings` → server restartuje interval.
Akce tlacitka → prislusny POST endpoint.

---

## DB tabulky — kategorizace

### STATE (zustavaji v DB, zalohuji se)

| Tabulka | Popis |
|---------|-------|
| `conversations` | Metadata (BEZ messages) |
| `projects` | Projekt registry |
| `project_memory` | KV pamet projektu |
| `global_memory` | Sdilena pamet |
| `user_memory` | User sidebar data |
| `expertises` | Definice expertiz |
| `conversation_expertises` | Aktivni vazby |
| `expertise_memory` | Cross-session pamet |
| `expertise_bindings` | Legacy single-lock |
| `specialists` | Specialist registry |
| `specialist_expertises` | Specialist↔expertise vazby |
| `specialist_memory` | Persistent context (current) |
| `specialist_migrations` | Migration tracking |
| `knowledge_facts` | Fakta (sazby, zakonz) |
| `knowledge_sources` | Zdroje faktu |
| `knowledge_verification_log` | Verifikace |
| `agents` | Worker definice |
| `user_settings` | Nastaveni |
| `api_tokens` | Auth tokeny |
| `memory` | LTM (current values) |
| `learned_patterns` | Auto-answer vzory |
| `session_state` | Session persistence |
| `schema_migrations` | Verze schematu |
| `project_lifecycles` | Aktualni faze |
| `milestones` | Aktualni milniky |
| `skill_executions` | Aktivni exekuce |
| `drafts` | Rozepsane zpravy |
| `attachments` | Metadata priloh |

### DRAIN (presunout do history souborů, pak smazat z DB)

| Tabulka | Drain pravidlo | Cil |
|---------|---------------|-----|
| `messages` | starsi nez 1 den | `history/conversations/{shard}/{conv_id}.jsonl` |
| `messages_fts` | orphaned rowids | (smazat + optimize) |

### PRUNE (smazat z DB po retenci, nearchivovat)

| Tabulka | Retence |
|---------|---------|
| `llm_execution_log` | 5 dni |
| `agent_logs` | 7 dni |
| `cre_override_log` | 7 dni |
| `telemetry_snapshots` | 7 dni |
| `telemetry_metrics` | 14 dni |
| `telemetry_alerts` | 14 dni |
| `specialist_telemetry` | 30 dni |
| `workflow_patterns` | 30 dni |
| `drift_checks` | 30 dni |
| `capability_drift_log` | 30 dni |
| `auto_expertise_log` | 30 dni |
| `merge_audit_log` | 30 dni |
| `audit_events` | 90 dni |
| `quality_scores` | 90 dni |
| `skill_steps` | 30 dni |

---

## Adresarova struktura

### Directory sharding

Pro 10 000+ konverzaci by jeden adresar degradoval FS vykon. Pouzivame 2-znakovy hash prefix z conv_id jako shard:

```
shardDir(convId) = convId.slice(0, 2)
// "conv-abc123" → "co/"
// "a1b2c3d4"    → "a1/"
```

### Plna struktura

```
data/
  c3.db                              ← STATE DB (~5-20 MB, konstantni)
  c3-setup.json                      ← Setup config
  design-defaults.json               ← Tech stack defaults
  artifacts/                          ← Prilohy (nezalohuji se)
  history/                            ← Append-only historie
    conversations/
      co/                             ← Shard prefix (prvni 2 znaky conv_id)
        conv-abc123.jsonl             ← Messages pro konverzaci abc123
      a1/
        a1b2c3d4.jsonl
    lifecycle/
      proj-xyz.jsonl                  ← Lifecycle eventy projektu
    memory/
      changes.jsonl                   ← Memory value changes
  backups/                            ← State backupy
    c3-state-2026-03-01.backup/
      c3.db
      skills/
      specialists/
      config/
      metadata.json
    c3-state-2026-02-28.backup/
      ...
```

Shard se pouziva jen pro `conversations/` (nejvic souboru). `lifecycle/` a `memory/` nemaji dost souboru na sharding.

---

## FTS strategie

- **FTS index** existuje JEN v active DB nad dnesmimi messages
- **Daily drain** po presunu messages: `DELETE orphaned FTS rows` + `OPTIMIZE`
- **Deep search** pres historii: scan JSONL souboru (volitelne, pomalejsi)
- **Budoucnost**: externi search index (lunr, minisearch) pro historii

---

## Restore scenar

> **NEIMPLEMENTOVANO k 2026-08-07.** Cela tato sekce je navrh. `db-backup.js`
> umi create/list/prune/stats a nic vic; route pro obnovu neexistuje. Kroky nize
> jsou zadani pro [`WP-M5-DATA`](wp/WP-M5-DATA.md), ne popis chovani produktu.
>
> Nez se restore implementuje, musi se rozhodnout dve veci, ktere tento navrh
> neresi: prepis zalohy stejneho dne (viz [Stav implementace](#znama-rizika-ktera-navrh-neresi))
> a to, ze `schema_version` v metadatech je pocet migraci, ne jejich identita —
> takze krok 4 nize na nem nemuze stat.

### State restore

1. UI: "Obnovit ze zalohy" → seznam zaloh s datumy a velikostmi
2. User vybere zalohu
3. **Potvrzeni**: "Aktualni stav bude prepsan. Pokracovat?"
4. Validace: metadata.json — schema_version kompatibilita
5. Pokud schema mismatch → run migrations
6. Replace: `c3.db`, `skills/`, `specialists/`, `config/`
7. Restart backend
8. Hotovo

### Konzistence state vs history

**State restore NEMENI history.** To je zamerne:

- State backup = "kdo jsem, co umim, co mam rozdelane" (konfigurace, projekty, expertizy)
- History = "co se stalo" (konverzace, lifecycle eventy)

Po restore muze nastat:
- **State je starsi nez history** → v DB chybi metadata konverzaci, ktere v JSONL existuji
  - Reader to zvladne: JSONL soubory bez conversations zaznamu v DB se proste nezobrazi v seznamu
  - Alternativa: scan JSONL adresare a re-create conversations metadata (budoucnost)
- **State je novejsi nez history** → v DB jsou konverzace, pro ktere neexistuje JSONL
  - To je normalni stav (zpravy jeste nebyly drainovane)

Zamysleny invariant: **nikdy neztratite data.** V nejhorsim pripade se nektere konverzace nezobrazi v seznamu, ale JSONL soubory zustanou na disku.

> **Neprokazano.** Invariant je formulovany pro restore, ktery neexistuje, a
> nedrzi proti scenari z [Stav implementace](#znama-rizika-ktera-navrh-neresi):
> zaloha stejneho dne se prepisuje, takze restart nad poskozenou databazi muze
> jedinou dobrou zalohu zlikvidovat. Dukaz musi dodat round-trip
> backup → poskozeni → restore → porovnani ve [`WP-M5-DATA`](wp/WP-M5-DATA.md).

### History restore

- History soubory jsou append-only — staci zkopirovat zpet do `data/history/`
- Zadna migrace, zadny schema check
- Stare konverzace se objevi automaticky
- **Restore history BEZ state restore** je bezpecne — jen pridava data

---

## Vztah k existujicimu kodu

### Co uz existuje (`src/db/data-retention.js`)

Existujici modul ma hardcoded `RETENTION_POLICIES` s pevnymi hodnotami (30d telemetrie, 60d logy, 90d conv memory). Obsahuje:
- Time-based table pruning (hardcoded)
- Soft-delete grace period (hardcoded 14d)
- Message archiving (cap 200/conv, hard-delete archived po 180d)
- LTM TTL pruning
- Pressure control (DB >500MB → 75%, >2GB → 50%)
- `compactDatabase()` (WAL checkpoint + ANALYZE)

### Co se zmeni

`data-retention.js` se **rozšíří** (ne prepise):
1. Hardcoded `RETENTION_POLICIES` → ctou se z `user_settings` (s defaults jako fallback)
2. Pridani: JSONL history pruning
3. Pridani: FTS cleanup po drain
4. Message archiving zustava (200/conv cap) — drain ho nepotrebuje, ale je uzitecny
5. Pressure control zustava — aplikuje se na konfigurovatelne hodnoty

### Existujici wiring v `server.js`

Aktualne v server.js:
- Startup: `pruneAllData(db.db)` (radek 146)
- Daily interval: `pruneAllData` (radek 1008)
- Weekly interval: `pruneAllData` + conditional `compactDatabase` (radek 1012)
- Graceful shutdown: flush telemetry + db.close (radek 1078)

Nove:
- Startup: drain + backup (if enabled) + auto_clean
- Configurable interval: auto_clean (default 24h)
- Shutdown: drain + backup (if enabled) + db.close
- Weekly compact zustava

---

## Implementacni faze

### Faze 1: Drain + konfigurovatelna retence

**Novy soubor:** `src/core/history-drain.js`
- `drainMessages(db, dataDir, { cutoffHours })` — presun messages z DB do JSONL
- Atomicky: file append (fsync) + DB delete v transakci
- `getHistoryStats(dataDir)` — pocet souboru, celkova velikost
- `pruneHistory(dataDir, retentionDays)` — smaz stare JSONL

**Edit:** `src/db/data-retention.js`
- Novy `loadRetentionConfig(db)` — cte `storage.retention.*` z `user_settings`
- `RETENTION_POLICIES` → dynamicke (merge config + defaults + min/max validace)
- Novy `autoClean(db, dataDir, config)` — jednotna funkce: prune DB + prune JSONL + FTS + compact
- Export `getStorageConfig(db)` — sdileny helper pro ostatni moduly

**Edit:** `src/server.js`
- Import history-drain
- Startup: `drainMessages()` + `autoClean()`
- Configurable interval misto hardcoded daily/weekly

**Soubory:** `src/core/history-drain.js` (novy), `src/db/data-retention.js` (edit), `src/server.js` (edit)

### Faze 2: State backup + REST API

**Novy soubor:** `src/core/db-backup.js`
- `createStateBackup(db, dataDir, meta)` — `db.backup()` + kopie skills/specialists/config
- `listBackups(dataDir)` — seznam zaloh s metadaty
- `pruneBackups(backupsDir, { maxDaily, maxWeekly })` — retence zaloh
- `metadata.json` generace (verze, schema, datum, velikost)

**Edit:** `src/routes/system.js` — nove endpointy:
- `POST /api/system/backup` — manualni state backup
- `GET /api/system/backups` — seznam zaloh
- `POST /api/system/drain` — manualni drain
- `POST /api/system/shutdown-backup` — drain + backup (volano z FE)
- `POST /api/system/clean` — manualni auto-clean
- `GET /api/system/storage/settings` — aktualni konfigurace
- `PUT /api/system/storage/settings` — zmena konfigurace

**Edit:** `GET /api/system/storage` (existujici) — pridat: history stats, backup count, retention config

**Edit:** `src/server.js`
- Shutdown hook: drain + backup pred db.close()
- Startup hook: backup (if on_startup=true)

**Soubory:** `src/core/db-backup.js` (novy), `src/routes/system.js` (edit), `src/server.js` (edit)

### Faze 3: JSONL reader

**Novy soubor:** `src/core/history-reader.js`
- `readConversationHistory(dataDir, convId, { limit, before })` — cteni z JSONL
- **v1: Nacti cely soubor** — pro typickou konverzaci (100-500 zprav, <1MB) je to dostatecne rychle
- Partial line detection (posledni radka bez `\n` = zahodit)
- Deduplikace po message ID (pro pripad crash-duplicates z drain atomicity gap)
- Filtrace: `before` timestamp → vrat jen zpravy starsi nez, `limit` → max N zprav
- **Budoucnost (v2):** Index soubory (`history/index/{shard}/{conv_id}.idx`) s byte offsety kazdych 100 zprav pro seek-based pagination u velkych konverzaci. Neni nutne pro v1.

**Edit:** `src/routes/chat.js`
- `GET /api/conversations/:id/messages` — fallback na JSONL kdyz DB nema starsi zpravy

**Soubory:** `src/core/history-reader.js` (novy), `src/routes/chat.js` (edit)

### Faze 4: FE + shutdown trigger

**Edit:** `chat-panel-module.js`
- Settings > Uloziste sekce (viz FE integrace mockup)
- Formular: retention inputy + backup checkboxy + action buttons
- Storage stats widget (DB size, history size, backup count)

**Edit:** Theia contribution (nebo `chat-panel-module.js` preload)
- `onWillStop` / `beforeunload` → `POST /api/system/shutdown-backup`

**Soubory:** `chat-panel-module.js` (edit)

### Faze 5: Restore

**Novy soubor:** `src/core/db-restore.js`
- `restoreFromBackup(backupPath, dataDir)` — validace, schema check, replace, restart
- Schema version check vs current → run migrations if needed
- Replace: c3.db + skills/ + specialists/ + config/

**Edit:** `src/routes/system.js`
- `POST /api/system/restore` — restore ze zalohy (body: { backup_name })

**Edit:** `chat-panel-module.js`
- Restore dialog: seznam zaloh, vyber, potvrzeni, progress

**Soubory:** `src/core/db-restore.js` (novy), `src/routes/system.js` (edit), `chat-panel-module.js` (edit)

---

## Budoucnost — marketplace / cloud

**Ted ne. GitHub staci.**

Az bude marketplace:
- Verejne skills, specialisti, expertizy se synchronizuji z cloudu
- Lokalne se zalohuji jen user-created (flag `is_local: true`)
- Sync protokol s checksums a verzemi

Do te doby: vsechno je lokalni, vsechno se zalohuje.

---

*Vytvoreno: 2026-03-02*
*Engine: c3-agent v91.0.0*
