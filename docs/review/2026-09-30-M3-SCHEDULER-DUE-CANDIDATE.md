# M3 scheduler: splatné běhy a formát plánu

**Integrační checkpoint 22:32 UTC:** izolovaný kandidát `6be426aa` prošel
omezeným nezávislým `REVIEW_PASS` po opravě cron preview. Je cherry-pickem
integrován jako `cde6c2e7` + `08719686`; na čistém integrovaném
`08719686` prošly stejné čtyři registrované sady **4/4**
(`.intentsmith-artifacts/run-suites/2026-09-30T22-31-54-367Z/report.json`).
Jde o vývojový důkaz, nikoli nasazení nebo autonomní přejímku.

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
  a hranici cooldownu. Kontroluje také, že finální náhled cron plánu
  uvádí `cron`, nikoli `interval`. Před časovou opravou nové kontroly
  selhaly 2/2; před opravou náhledu selhala cron regrese. Po opravách je
  celá sada 6/6.
- Registrované sady scheduleru, Project Health, trvalého HTTP průchodu
  a produktového HTTP průchodu prošly 4/4 na čistém izolovaném
  `6be426aa` (`.intentsmith-artifacts/run-suites/2026-09-30T22-30-09-598Z/report.json`)
  a 4/4 na čistém integrovaném `08719686` (report výše). Registr má nadále
  573 sad; změněná sada nyní správně uvádí DB profil.

## Výkonnostní mez

`julianday(s.next_run)` zajišťuje správný výběr i pro původní textový
formát, ale SQLite pro podmínku nepoužije rozsah indexu
`idx_agent_schedule_next`: `EXPLAIN QUERY PLAN` ukázal `SCAN s USING INDEX`
místo původního `SEARCH s USING INDEX (next_run<?)`. Kontrola je tedy
lineární v počtu plánů. V read-only inventuře instalované DB 30. 9. 2026
bylo **6** řádků `agent_schedule_v33` a **6** řádků `agents_v33`; při této
velikosti nemáme důkaz provozního problému. Výkon pro větší registr agentů
nebyl benchmarkován a zůstává otevřenou škálovací hranicí.

Nativní Project Health má stále `schedule: {type: "manual"}` a instaluje
se vypnutý. Tento kandidát sám nezapíná autonomní monitoring a neprokazuje
skutečné automatické spuštění přes produktový proces, restart uprostřed
běhu ani fyzické Studio UI. `C3-015` a `C3-021` proto zůstávají bez
aktuální produktové přejímky. Instalovaný backend `c84b88cd` kandidátní
opravu neobsahuje.
