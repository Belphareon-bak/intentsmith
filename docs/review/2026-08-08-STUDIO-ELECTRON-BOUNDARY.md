# Studio Electron boundary — fresh-clone evidence

**Datum:** 2026-08-08

**Scope:** `WP-M0-E`, capability `C3-001`

**Výsledek:** dva po sobě jdoucí `PASS` na `7236d221`; dva předchozí červené
kalibrační běhy jsou zachované a neslučují se do zeleného souhrnu

## Hranice tvrzení

Tento balíček nehodnotí vzhled, DOM, layout, CSS, screenshot ani UX současného
Studia. Dnešní UI je pouze dočasný nosič Electron transportu. Runner používá
CDP `Network.*`, veřejné `C3WS.send` a `C3Bus`; nečte privátní `_c3` ani stav
komponent.

## Fresh-clone envelope

- remote: `git@github-intentsmith:Belphareon-bak/intentsmith.git`;
- větev: `claude/gate1-mobile-app-progress-5sywlt`;
- finální testovaný SHA: `7236d221b9f70669514d6910276e522c2bfe020c`;
- klon a artifact root byly mimo `/home/belphareon/Projects` a měly privátní
  mód `0700`;
- runtime běžel v novém user/network namespace jen s loopbackem a se scoped
  X11 přístupem;
- root instalace `npm ci`: exit `0`, 233 balíčků; audit hlásil 2 moderate,
  8 high a 1 critical nález, bez automatického `audit fix`;
- z `c3-ide/` `corepack yarn install --frozen-lockfile`: exit `0`;
- z `c3-ide/` `corepack yarn build`: exit `0`, pět webpack warnings; finální
  build na testovaném SHA trval 38,63 s;
- `node tests/studio-electron-runner-contract.test.js`: 16/16, exit `0`.

Při závěrečné exact-SHA reinstalaci prošel samostatný `npm ci` exit `0`, ale
navazující Yarn příkaz byl jednou omylem spuštěn z kořene a Corepack jej správně
odmítl, exit `1`, protože root deklaruje `packageManager: npm`. Správný příkaz
z `c3-ide/` byl ihned zopakován a skončil exit `0`, bez změny pracovního stromu.

Runtime příkaz měl tento tvar; konkrétní privátní artifact a Xauthority cesty
nejsou součástí přenositelného kontraktu:

```bash
env -i \
  PATH=<minimal-system-and-node-path> \
  LANG=C.UTF-8 LC_ALL=C.UTF-8 TZ=Europe/Prague \
  INTENTSMITH_TEST_SOURCE_REVISION=<full-sha> \
  INTENTSMITH_TEST_ARTIFACT_DIR=<owned-0700-directory> \
  INTENTSMITH_STUDIO_DISPLAY=<validated-x11-display> \
  INTENTSMITH_STUDIO_XAUTHORITY=<validated-0600-file> \
  node tests/studio-electron-boundary.e2e.js
```

## Úplná chronologie

| # | Zdroj | Výsledek | Exit | Sanitizovaný artefakt | Význam |
|---|---|---|---:|---|---|
| 1 | `4643b0e6` | `FAIL electron-exited-before-cdp` | 1 | [`01-FAIL`](2026-08-08-STUDIO-ELECTRON-BOUNDARY-01-FAIL.json), SHA-256 `c1982cc0…eb1f2d` | Časný `SIGTRAP`; D-Bus není doložená příčina. Stejný build následně naběhl. |
| 2 | `4643b0e6` | `FAIL functional-websocket-probe-failed` | 1 | [`02-FAIL`](2026-08-08-STUDIO-ELECTRON-BOUNDARY-02-FAIL.json), SHA-256 `1cc35b3e…a5f0c35` | Runner chybně zaměnil legacy mode event za finální CRE intent. |
| 3 | `7236d221` | `PASS` | 0 | [`03-PASS`](2026-08-08-STUDIO-ELECTRON-BOUNDARY-03-PASS.json), SHA-256 `bf69b52a…d5c37f8` | První úplný opravený běh. |
| 4 | `7236d221` | `PASS` | 0 | [`04-PASS`](2026-08-08-STUDIO-ELECTRON-BOUNDARY-04-PASS.json), SHA-256 `9ff0b690…a4ad24` | Nezávislé opakování na stejném SHA a buildu. |

Červené běhy zůstávají součástí evidence. Runner nemá interní retry a první
selhání tedy nemůže skrýt pozdějším průchodem.

## Shodný výsledek obou PASS běhů

- 648 CDP událostí;
- 27 capability-chráněných HTTP requestů, všechny povinné route `2xx`, pouze
  povolený media-history stav `404`;
- jeden živý C3 `/c3/ws` a jeden oddělený Theia `/socket.io/` WebSocket;
- `externalAttempts=0`, `otherLoopbackAttempts=0`, žádná anomálie;
- boundary trojúhelník: cross-site bez Origin + capability `403`, opaque bez
  capability `403`, skutečný Electron opaque + capability `200`;
- právě jeden korelovaný deterministický aritmetický turn, správný výsledek,
  nula provider requestů během turnu, nula LLM/tool/edit efektů;
- live-ready pozorování 65 881 ms a 65 885 ms;
- Electron i backend `exitCode=0`, `signal=null`, bez forced killu; port file
  odstraněný a vlastněné process groups prázdné;
- shodné čtyři build SHA-256 v obou bězích.

## Co výsledek neuzavírá

- capability #21 zůstává `RUNTIME_VERIFIED + BROKEN`: M1 stále potřebuje dva
  panely, scoped cancel, reconnect, provider failure a pravdivé terminal stavy;
- legacy `cre_decision` nese mode detection `conversation`, ne finální CRE
  intent; sémantiku musí sjednotit verzovaný M1 connector;
- první pre-CDP `SIGTRAP` je zachovaný residual. Pokud se zopakuje, další krok
  je samostatná core/crashpad diagnostika, ne GPU-disable flag ani skrytý retry;
- registrovaná T5 sada zůstává `BLOCKED`, dokud standardní orchestrátor nedodá
  frozen install a production-build envelope. Ručně splněná prerekvizita není
  důvod tvrdit, že je cesta automatizovaně `ACTIVE`.

Raw Electron profil, testovací DB, capability, DevTools metadata a logy nejsou
součástí balíčku a nesmějí se commitnout.
