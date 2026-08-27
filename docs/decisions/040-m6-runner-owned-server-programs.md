# 040 — Required server journeys dostávají runner-owned server authority

- **stav:** `IMPLEMENTED / FULL_CANDIDATE_RUN_PENDING / RE_REVIEW_REQUIRED`
- **rozsah:** M6 locked plan, devět legacy live-server journeys a audit toolchain
- **datum:** 2026-08-27

## Problém

M6 plán po opravě množinové úplnosti vybral všech 369 `ACTIVE + required`
programů. Devět z nich ale nekonstruuje server: spotřebovává již běžící C3 na
loopbacku. Obecný `nightly-audit` záměrně označuje `requirements.server` jako
hard blocker a server nikdy nespouští. Pouhé přidání
`--allow-blocker=server` by proto vytvořilo nepravdivě „spustitelný“ plán bez
producenta serverové autority.

Stejný ostrý candidate probe ukázal pět deklarovaných toolchain prerequisite:
`git`, `bwrap`, `bubblewrap`, `prlimit` a PDF Python. Dřívější runner uměl
materiálně preflightovat jen X11; ostatní názvy pouze odstranily stav
`BLOCKED`, aniž by připnuly existenci executable.

## Rozhodnutí

Locked plán verze 6 má sedm sériových fází. Modelové/server-profile programy
bez `requirements.server` zůstávají v obecném auditu. Přesný zmrazený seznam
devíti consumer journeys běží v samostatné fázi
`runner-owned-server-programs` přes
`scripts/run-m6-server-program-evidence.js`.

Každý program dostane vlastní privátní runtime, HOME, XDG, temp, projekty,
SQLite, npm cache, Git config, logy a port-file. Runner:

1. ověří, že pevný loopback port 3335 není obsazen;
2. vygeneruje privátní test nonce a admin token;
3. spustí exact `src/server.js` a přijme jen privátní port-file svázaný s PID,
   hostem, portem, nonce a per-process local capability;
4. čeká na public `/api/health` s manual redirect policy;
5. předá testu exact PID/nonce attestation a stejný izolovaný filesystem;
6. po testu server ukončí přes exact child PID, bounded SIGTERM/SIGKILL a
   vynutí clean shutdown jako podmínku PASS;
7. spojí server i test output do content-addressed per-program logu a znovu
   ověří clean exact candidate.

Historické journeys záměrně běží v `NODE_ENV=test`: jejich HTTP klienti
nepředávají produkční local capability a spoléhají na dnešní explicitní
development-loopback auth třídu. Evidence toto omezení nese přímo v reportu;
nejde o náhradu samostatné production auth journey, kterou dál poskytuje
`IS-T1-TESTS-M5-GLOBAL-AUTH-TEST` v `owned-production-server` fázi.

Obecný audit runner současně ověřuje exact canonical executable authority pro
`/usr/bin/git`, `/usr/bin/bwrap`, `/usr/bin/prlimit`, `/usr/bin/unshare` a
`/usr/bin/ip`. PDF runtime musí mít absolutní spustitelný canonical target a
obě případné env vazby se musí shodovat. Candidate fáze používají
`--fail-fast`, takže první required non-PASS zastaví další plánovanou práci.

## Hranice tvrzení

Focused kontrakty dokazují množinovou úplnost, izolaci, PID/nonce binding,
toolchain preflight a fail-fast. Dokud všech devět journeys a následně všech
sedm fází neproběhne nad jedním čistým commitnutým kandidátem, stav zůstává
`FULL_CANDIDATE_RUN_PENDING`. Rozhodnutí samo nevydává M5/M6 review, rotace,
history disposition, Gate 0, demo ani release approval.
