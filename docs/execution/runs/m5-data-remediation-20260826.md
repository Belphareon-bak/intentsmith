# M5 DATA — adversariální remediation evidence

- **Původní review candidate:** `94ea4ea715d0019f66b47a039872aefbee2a9daa`
- **Remediation product commit:** `bcfa5c8d93401405bd936e016903acca3f0df50b`
- **Stav oddílu:** `IMPLEMENTATION_GREEN / RE_REVIEW_REQUIRED`
- **Push:** neproveden

Tento řez opravuje nálezy `M5-R03` až `M5-R06` z operátorského review. Není to
nezávislý re-review, M5 acceptance ani povolení otevřít M6 gate.

## Uzavřené implementační podmínky

1. Backup vyhodnotí exact výsledek `wal_checkpoint(TRUNCATE)` a publikuje
   snapshot pouze pro `busy=0`, `log=0`, `checkpointed=0`. Neúplný, chybný nebo
   nečitelný výsledek končí `BACKUP_WAL_CHECKPOINT_INCOMPLETE`; partial adresář
   se odstraní a immutable backup nevznikne.
2. Offline restore kontroluje otevření všech existujících částí
   `c3.db/c3.db-wal/c3.db-shm`, vytváří durable pre-restore safety snapshot
   celého file-setu a před instalací nového main DB odstaví oba sidecary.
   Regrese obnovuje validní starší main DB nad zachovaným novějším WAL a
   prokazuje, že post-backup řádek po reopen nevstane.
3. Restore-lock owner identity je tri-state `present/absent/unknown`.
   `EACCES`, nevalidní `/proc/<pid>/stat`, nečitelný lock a nejednoznačný holder
   census jsou fail-closed. Cílený holder census používá podporovaný Linux
   nástroj `/usr/bin/fuser`; chybějící, timeoutovaný nebo chybový census je
   `DATABASE_RESTORE_PROCESS_CENSUS_UNREADABLE`.
4. Stale cleanup ani release nemažou cestu po odděleném checku. Lock se nejprve
   atomicky přesune do unikátní karantény a teprve tam se znovu ověří inode,
   device, token, PID a process-start identita. Změněná živá identita se
   nemaže; create-if-absent hardlink při obnově nemůže přepsat dalšího vlastníka.

## Přímé regrese a kompatibilita

| Důkaz | Výsledek |
|---|---:|
| `node tests/m5-data-restore.test.js` | `13/13 PASS` |
| `node tests/storage-architecture.test.js` | `34/34 PASS` |
| `node tests/schema-migrations.test.js` | `38/38 PASS` |
| `node tests/module-boundary-ratchet.test.js` | `13/13 PASS` |
| `node tests/artifact-validation.test.js` | `154/154 PASS` |
| `node tests/repository-hygiene.test.js` | `1844 tracked paths / PASS` |
| `git diff --check` | `PASS` |

Nové negativní regrese přímo pokrývají review checkpoint tuple
`{busy:1, log:1, checkpointed:0}`, replay zachovaného novějšího WAL, nečitelnou
lock-owner identitu, nečitelný holder census a deterministickou výměnu stale
locku za nový živý lock těsně před cleanupem.

Úplný deterministický gate se v tomto průběžném bloku nespouštěl. Jeho poslední
připnutý stav zůstává historicky `284 PASS / 2 FAIL / 2 BLOCKED`, `verdict:
FAIL`, `exitCode: 1`; nový candidate a gate vzniknou až po opravě všech devíti
oddílů.
