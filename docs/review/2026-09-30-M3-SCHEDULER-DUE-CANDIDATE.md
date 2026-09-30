# M3 scheduler: splatné běhy a formát plánu

**Stav:** kandidát; nezávislé review, integrace a nasazení čekají.

## Pozorovaný problém

`AgentRepository.setSchedule()` ukládal čas jako UTC ISO 8601, zatímco
`getDueAgents()` jej porovnával textově se SQLite `CURRENT_TIMESTAMP`.
Na izolované in-memory DB byl plán `2026-09-30T22:12:07.455Z` v čase
`2026-09-30 22:13:07` již splatný, ale dotaz vrátil nula řádků a scheduler
nespustil žádný běh. Srovnání `julianday()` bere oba formáty jako čas a
zachovává milisekundy; neplatné datum nevybere.

Autoritativní agent DSL (`src/agents/schema.js` a
`src/agents/AGENT-DSL-SCHEMA.md`) používá `schedule.value` pro interval i
cron. Scheduler jej používá také, ale pomocné metody runneru četly
`schedule.interval` nebo `schedule.cron`. Náhled proto označil validní
`{type: "interval", value: "5m"}` za neplatný a cooldown místo pěti minut
počítal výchozí jednu minutu.

## Rozsah kandidáta a důkaz

- Oprava výběru splatných plánů v repozitáři a sjednocení validace,
  náhledu, popisu a cooldownu runneru s `schedule.value`.
- Regrese v `IS-T1-TESTS-SCHEDULER-TEST` používá skutečné SQLite schéma,
  repozitář a scheduler: splatný, budoucí, vypnutý a poškozený plán,
  novou instanci scheduleru nad uloženým plánem, validní interval/cron
  a hranici cooldownu. Před opravou nové kontroly selhaly 2/2; po opravě
  je celá sada 6/6.
- Registrované sady scheduleru, Project Health, trvalého HTTP průchodu
  a produktového HTTP průchodu prošly 4/4 v lokálním kandidátním běhu
  `.intentsmith-artifacts/run-suites/2026-09-30T22-19-17-709Z/report.json`.
  Registr má nadále 573 sad; změněná sada nyní správně uvádí DB profil.

Nativní Project Health má stále `schedule: {type: "manual"}` a instaluje
se vypnutý. Tento kandidát sám nezapíná autonomní monitoring a neprokazuje
skutečné automatické spuštění přes produktový proces, restart uprostřed
běhu ani fyzické Studio UI. `C3-015` a `C3-021` proto zůstávají bez
aktuální produktové přejímky. Instalovaný backend `c84b88cd` kandidátní
opravu neobsahuje.
