# WP-M5-PROCESS — governed process lifecycle hardening

**Typ:** M5 production hardening · **Stav:** `REVIEW_PASSED`

**Product revision:** `7a282a3fc58ca8d151d2070ea041d952efe9aaf2`

**Module-baseline revision:** `d3829643545fde1d6b6f71db9f1d88b86bd54b91`

## Uživatelský výsledek

Focused proces M2 běží jen v přijatém Linux `linux-bwrap-ro-v2` sandboxu,
navíc s konečnými resource limity. Timeout i cancel uklidí celou vlastněnou
process group. Pokud server spadne po durable zápisu identity, restart nejdřív
prokáže a uklidí tento přesný proces a teprve potom smí pokračovat ve file/Git
recovery.

## Autorita a invariants

- Cíl nezačne, dokud supervisor neprojde exact-path kontrolou `bwrap`,
  `prlimit`, Node, binary a project root.
- Před durable identity callbackem dostane supervisor děděné RLIMIT stropy:
  4 GiB address space, 64 MiB file size, 256 open files, nulové core dumpy a
  CPU limit odvozený z již schváleného wall-clock timeoutu.
- Chybějící `prlimit` je `PROCESS_RESOURCE_LIMITER_UNAVAILABLE`; neexistuje
  plain-spawn fallback.
- Restartová signal authority používá `linux-pidfd-v1`. Exact `/usr/bin/python3`
  helper otevře pidfd ještě před opakovaným ověřením boot ID,
  `/proc/<pid>/stat` start time, leader PID a PGID a drží ho otevřený přes
  TERM/KILL i finální empty census. Samotný PID ani PGID nikdy nestačí a nelze
  je vyměnit mezi kontrolou a signálem.
- Boot change, prázdná group nebo prokazatelně nahrazená PID identita jsou
  evidence, že původní vlastněný proces skončil; cizí aktuální PID se
  nesignalizuje.
- Chybějící leader s neprázdnou group, `EACCES`, nečitelná identita nebo
  nevyklizená group jsou `PROJECT_CHANGE_PROCESS_RECOVERY_UNRESOLVED`.
  V této větvi se nespustí file rollback ani nevznikne čistý terminal.
- Úspěšný cleanup se zapisuje existujícím append-only
  `process_terminated` eventem pod aktuálním fencing generation. Outstanding
  census je odvozen z durable process rows a následné termination evidence.
- Provider outcome `orphaned`, unknown group nebo chybějící exact empty důkaz
  nesmí vytvořit `process_terminated`, parent terminal ani rollback. After-image
  a outstanding row zůstanou pro restartový pidfd recovery pass.
- Startup opakuje recovery census po jedné sekundě, protože přijatá M2 claim
  authority nedovoluje takeover před expirací lease. Do konvergence zůstávají
  nové lifecycle operace fail-closed. Stejný guard běží před prepare, před
  approval existujícího plánu i uvnitř jediného effect-start runneru; recovery
  používá neexportovatelnou symbolovou autoritu.
- Cleanup inventarizuje výhradně `m2_execution_processes`. Neprochází host
  procesy a nesahá na GPU, Ollamu ani jiné cizí úlohy.

## Přiznané limity

- Implementovaný profil je pouze Linux/bubblewrap/pidfd. Absence exact
  `/usr/bin/python3` s `os.pidfd_open`, `bwrap` nebo `prlimit` je typed
  unavailable a installer ji odmítne.
- RLIMIT address space není cgroup RSS quota. Je to konečný per-process
  address-space strop děděný celou sandbox group; M5 netvrdí cgroup izolaci.
- Pokud OS odmítne přečíst identitu nebo signalizovat přesně vlastněnou group,
  systém úmyslně zůstane recovery-incomplete. Bez operátorského zásahu
  nevydává úspěch ani nepokračuje v mutaci projektu.

## Acceptance

1. Fake identity matice prokáže no-signal boot/PID-reuse a fail-closed
   unknown větve.
2. Skutečná detached TERM-resistant group je přes exact durable identitu
   ukončena KILL eskalací a potvrzena jako empty.
3. Skutečný sandbox prokáže RLIMIT hodnoty ještě v durable callbacku před
   startem cíle.
4. Restartový integrační test prokáže pořadí process cleanup → file rollback;
   unresolved větev zachová after-image i outstanding evidence.
5. Původní M2 process, execution, lifecycle a install sady zůstanou green.
6. Registry, module ratchet, artifact validation a hygiene projdou; celkový
   baseline se interpretuje pravdivě.

Druhé operátorské review tento oddíl přijalo. M3 je přijaté; M5 jako celek
zůstává `CHANGES_REQUESTED` a M6 gate je zavřený.
