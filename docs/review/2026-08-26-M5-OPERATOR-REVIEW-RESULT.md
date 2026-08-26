# M5 — operátorský technický review výsledek

- **Product candidate:** `94ea4ea715d0019f66b47a039872aefbee2a9daa`
- **Review range:** `1276e5ce..94ea4ea7`
- **Evidence HEAD:** `83265e3940176ca572a07f47b2c425549c25fcef`
- **Technický verdikt:** `CHANGES_REQUESTED`
- **Oddíly:** `0 REVIEW_PASSED / 9 CHANGES_REQUESTED`
- **M5 acceptance:** `BLOCKED`
- **M6 gate:** `CLOSED`
- **Push:** neproveden

Zelených `92/92` M5 checks zůstává platným dílčím implementačním důkazem, ale
adversariální operátorské review našlo osmnáct věcných vad: jednu critical,
třináct high a čtyři medium blocking. Celý deterministický report zůstává
pravdivě `284 PASS / 2 FAIL / 2 BLOCKED`, `verdict: FAIL`, `exitCode: 1`; nebyl
znovu spuštěn a jeho čtyři non-PASS jsou zděděné.

## Připnuté nálezy a podmínky přijetí

| ID | Oddíl | Severity | Nález | Podmínka přijetí |
|---|---|---|---|---|
| M5-R01 | PACKAGE | HIGH | `install.sh --verify-only` může spustit NVM a vrátit úspěch nad Node 20. | Verify-only je read-only a mimo Node 22 končí exit 1. |
| M5-R02 | PACKAGE | MEDIUM | Upgrade dokumentuje neexistující storage dokument a `/api/status`. | Opravit odkazy/health endpoint a smoke-testovat dokumentované příkazy. |
| M5-R03 | DATA | HIGH | Backup přijme neúplný WAL checkpoint a může vynechat commitnutá data. | SQLite-native konzistentní backup nebo fail-closed checkpoint. |
| M5-R04 | DATA | HIGH | Restore ponechá staré DB WAL/SHM a po reopen vrátí post-backup data. | Atomicky pracovat s celým DB/WAL/SHM file-setem. |
| M5-R05 | DATA | HIGH | Nečitelný `/proc` je fail-open pro live restore lock. | `unknown/unreadable` musí být fail-closed. |
| M5-R06 | DATA | HIGH | Stale-lock check a unlink mají TOCTOU proti novému živému locku. | Inode/token-safe stale cleanup. |
| M5-R07 | AUTH | MEDIUM | WS zahazuje transportní credentials a přijme mixed či duplicate bearer autoritu. | Tri-state parser, úplný transportní set a fail-closed malformed/duplicate/mixed credentials. |
| M5-R08 | PROCESS | HIGH | Provider `orphaned` může být zapsán jako `process_terminated`. | Termination pouze po důkazu prázdné group; orphan/unknown zůstává outstanding. |
| M5-R09 | PROCESS | HIGH | Incomplete startup census blokuje prepare, ale ne approval existujícího plánu. | Globální census guard na každém effect-start vstupu. |
| M5-R10 | PROCESS | HIGH | PID/PGID identity check a numerický signal mají TOCTOU. | Kernelově stabilní ownership, například pidfd/cgroup. |
| M5-R11 | OBSERVE | MEDIUM | `close` s `writableEnded=true` bez `finish` nefinalizuje request. | `close` vždy volá exact-once `finalize(true)`. |
| M5-R12 | OUTBOUND | HIGH | Loopback fast-path následuje redirect mimo loopback bez policy a auditu. | Manual redirect před každým fast-pathem a nové rozhodnutí pro každou `Location`. |
| M5-R13 | OUTBOUND | HIGH | Veřejný string scope dovolí forged path/query/headers/body. | Opaque module-bound capability a exact endpoint kontrakty. |
| M5-R14 | PERF | HIGH | Evidence ověřuje callerem dodané hodnoty, ne Git blob a jeho obsah. | Clean candidate binding, blob/artifact digest a metriky odvozené fail-closed ze zdroje. |
| M5-R15 | REMOTE | HIGH | Project result není svázán s revision, query ani budgetem requestu. | Exact revision/query/budget result binding. |
| M5-R16 | CONDITIONAL | MEDIUM | Resolver trimuje config, runtime používá raw truthiness. | Jediný normalizovaný manifest/predicate pro preflight i startup. |
| M5-R17 | PRIVACY | CRITICAL | Přímý self-consistent SQL INSERT zfalšuje rotation i history receipts. | Opaque transportní writer capability vynucená až na SQL boundary. |
| M5-R18 | PRIVACY | HIGH | Scanner nečte bytes několika distribuovaných runtime stromů a má Git TOCTOU. | Roots z distribučního manifestu, tracked/content-read census a exact HEAD blobs. |

Navíc `git diff --check 1276e5ce..83265e39` našel sedm nových prázdných řádků
na EOF. Každý věcný nález vyžaduje přímou negativní regresi. Nový product
candidate musí projít focused, structural a celým deterministickým gate; M5 lze
přijmout až po `9/9 REVIEW_PASSED`, skutečných osmi rotacích, přijatém history
receiptu a nulových známých critical/high blockerech.

Operátor doporučil history disposition `rewrite_and_rotate`, ale žádný rewrite,
rotace, push ani jiná destruktivní akce tímto výsledkem není autorizovaná.
