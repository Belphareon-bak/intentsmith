# WP-M1-STANDALONE-CHATS-DECOMMISSION — fail-closed unsupported package

**Typ:** zapisující M1 support-boundary/decommission WP · **Slot:** jediný
writer v izolovaném disk-backed worktree

**Rozhodnutí:**
[`029/A + M1-CLOSEOUT-X1`](../decisions/029-m1-settings-reset-scope.md)

**sourceEvidenceRevision:**
`69d29ed3c929593e092d047b6e182d9715e3d08e`

**integrationRef:** `integration/m1-consolidated-20260810`

**baseRevision:**
`5d33a46336489e6d9a09d17a5fd5edf05da76cdc` — promoted docs-only aktivační
checkpoint obsahující tento WP

**Branch:** `wp/m1-standalone-chats-decommission-20260812`

**Worktree:**
`/home/belphareon/worktrees/is-m1-standalone-chats-decommission`

**Review/promotion refs:**

- Review A:
  `evidence/m1-standalone-chats-decommission-review-a-20260812`, worktree
  `/home/belphareon/worktrees/is-m1-standalone-chats-decommission-review-a`;
- merge queue:
  `queue/m1-standalone-chats-decommission-promotion-20260812`, worktree
  `/home/belphareon/worktrees/is-m1-standalone-chats-decommission-queue`;
- Review B:
  `evidence/m1-standalone-chats-decommission-review-b-20260812`, worktree
  `/home/belphareon/worktrees/is-m1-standalone-chats-decommission-review-b`.

**Stav:** `SOURCE + REVIEW A/B BEHAVIOR PASS / PROMOTION ENVELOPE INVALID /
RECOVERY_ACTIVE` — immutable `S_CHAT=1b46d59d3c52859827f0b0b6b0ee7babd1fe2028`,
Review A `E_A_CHAT=439a2018af2e93c65586f60107557ec004cacd0f` a queue candidate
`C_CHAT=578876dd77c68df4bdcf6239383fa782b649f843` jsou zachované. Corrected Review
B skončil PASS, ale canonical evidence commit
`I=39776f1e90e425bd91a7be707edc556a299869bd` porušuje byte-exact report append.
Decision [030](../decisions/030-m1-chats-evidence-envelope-recovery.md) proto
aktivuje jednorázovou obálkovou recovery. Reset, Finding 011 i Gate 1 zůstávají
`BLOCKED` do metadata gate a canonical fast-forwardu na `R_REC`.

## 1. Uživatelský výsledek

Tracked standalone `chats/` package přestane předstírat podporovanou nebo
dodávanou serverovou aplikaci. Přímý start skončí deterministicky fail-closed
ještě před importem DB, otevřením nebo vytvořením souboru, registrací route,
listenerem, schedulerem či network efektem. Operátor dostane jednoznačnou
non-secret zprávu `C3_STANDALONE_CHATS_UNSUPPORTED_NOT_SHIPPED`.

Toto je vědomě přijatá změna support claimu na `unsupported / not shipped`.
Není to factory delete, privacy erase ani oprávnění smazat či transformovat
existující chats DB, WAL, attachments, historii, konfiguraci nebo backupy.
Všechny existující datové bytes musí zůstat beze změny.

## 2. Povolené a zakázané cesty

**Přesný source/docs allowlist subjectu:**

- `chats/src/server.js` — jediný dependency-free fail-closed entrypoint;
- `chats/package.json` — pouze přidání exact `"private": true`, pravdivá změna
  `description` a změna `start`/`dev` na tentýž sentinel bez watcheru; `name`,
  `version`, `type`, `main`, ostatní scripts, dependencies a všechna další
  metadata zůstávají byte-hodnotově zachovaná;
- nový `chats/UNSUPPORTED.md` — operátorský support a data-preservation text;
- `docs/CHANGELOG.md` — nová aktuální release-note položka; historická v78
  deprecation položka se nepřepisuje;
- `docs/findings/011-user-settings-authority-and-secret-exposure.md` — pouze
  source-progress a přesná hranice tvrzení;
- unikátní
  `docs/execution/runs/wp-m1-standalone-chats-decommission-20260812-report.md`
  smí poprvé vzniknout až jako jediná změněná cesta report-only `E_A` po
  nezávislém Review A.

**Zakázané:**

- `chats/src/db/database.js` a všechny ostatní
  `chats/src/{chat,agents,core,workflow,experts,orchestrator,tests}/**` cesty;
- jakákoli tracked nebo untracked chats data, `data/**`, `*.db`, `*.sqlite*`,
  `*-wal`, `*-shm`, attachments, logs, sessions, history nebo backup;
- mazání, přesun, přepis, migrace, VACUUM, checkpoint, recovery nebo pouhé
  otevření existující DB;
- root `package.json`, lockfile, dependency addition/removal/update,
  `tests/registry.json`, generovaný registry dokument nebo nová test suite;
- canonical `src/**`, `c3-ide/**`, `src/ui/**`, mobile, Setup, settings/reset,
  auth/access boundary, schema/migration a build output;
- `ROADMAP.md`, `SYSTEM-MAP.md`, decision 029, tento statický WP a
  `docs/wp/README.md` uvnitř source subjectu;
- externí síť, Electron, Ollama, GPU, full-product test, `npm install` nebo
  standalone watch/build proces.

Rename se pro allowlist počítá jako odstraněná původní a přidaná cílová cesta.
Jakákoli cesta mimo allowlist je `CHANGES_REQUIRED`, nikoli důvod allowlist
potichu rozšířit.

## 3. Exact support a boot kontrakt

`chats/src/server.js` se nahradí malým ESM sentinelem, který:

1. může importovat pouze Node builtin potřebný pro bezpečný main guard;
2. neimportuje `better-sqlite3`, `http`, `fs`, config, logger ani žádný lokální
   chats modul;
3. při pouhém importu nemá side effect;
4. při přímém spuštění zapíše na stderr právě jeden řádek
   `C3_STANDALONE_CHATS_UNSUPPORTED_NOT_SHIPPED`, nic na stdout a skončí
   exitem `78`;
5. nikdy nevolá `listen()`, `fetch()`, timer, scheduler, signal handler ani
   filesystem API.

`chats/package.json` se stane exact private přes `"private": true` a jeho
`description` pravdivě řekne `unsupported / not shipped`. `start` i `dev`
spustí tentýž jednorázový sentinel; `dev` nesmí použít `--watch` ani jinak
udržovat proces živý. Mimo tyto čtyři exact field změny se package metadata,
test scripts a dependency mapy zachovají. Žádná dependency se kvůli
decommissionu nepřidává, neodstraňuje, neaktualizuje ani neinstaluje.

`private:true` je pouze nested npm nonpublication guard tohoto standalone
package. Není důkazem ani změnou root archive/package inclusion pravidel a
neuzavírá M5-PACKAGE census či případné vyloučení `chats/` ze shipped archivu.

Původní raw `GET/POST /api/settings` a `POST /api/reset` route se odstraněním
starého server entrypointu stanou nedosažitelné a inertní. Nevzniká náhradní
HTTP 410 server: nový listener by byl nová capability a porušil by fail-before-
listener kontrakt.

`chats/UNSUPPORTED.md` musí výslovně říct:

- standalone package není součást shipped/core 1.0 produktu;
- canonical `/chat-ui` a hlavní server nejsou tímto decommissionem označené za
  unsupported;
- existující standalone chats data se nemažou ani nemigrují;
- jejich budoucí export, recovery nebo erase vyžaduje vlastní WP.

## 4. Vstup, dependency a vlastnictví

Writer začne pouze z čistého `baseRevision` zaznamenaného v reportu a ověří,
že jde o descendant pojmenovaného `integrationRef` obsahující tento statický
WP. Aktivační checkpoint musí být nezávisle reviewovaný a promován před prvním
source zápisem.

Decommission a reset mají oddělené writery i reviewery. Platí:

- chats writer není reviewer tohoto subjectu;
- chats writer není reset writer;
- chats Review A/B nejsou reset writer ani reset Review A/B;
- žádný agent nepoužije cizí dirty checkout ani nepřevezme neprokázané
  procesy/data; ownership `UNKNOWN` nikdy neopravňuje k úklidu.

Práce je striktně sériová: současně smí být materializovaný nejvýše jeden nově
vytvořený 029-owned worktree pro writer, review nebo queue krok. Výše uvedené
cesty jsou sekvenční rezervace, ne oprávnění vytvořit je najednou. Tento limit
se nevztahuje na už existující nebo cizí worktrees/procesy a neopravňuje je
měnit, přesouvat ani odstraňovat; neprokázané vlastnictví zůstává `UNKNOWN` a
nedotčené. Nic nového nevzniká v `/tmp`.

## 5. Demonstrovatelný výsledek

Immutable subject `S_CHAT` musí ukázat:

- statický call graph entrypointu nemá cestu k DB, listeneru ani raw routes;
- přímý `node chats/src/server.js` končí exitem `78` s exact jedním stderr
  markerem a prázdným stdout;
- `npm --prefix chats start` a `npm --prefix chats run dev` jsou staticky
  svázané s týmž jednorázovým entrypointem a `dev` nemá watcher;
- před/po manifest test-owned sentinel DB, WAL, attachment a unknown souboru má
  shodný path, type, mode, size a SHA-256;
- žádný TCP/HTTP listener nevznikne a žádný proces po ověření nezůstane živý;
- release note a `UNSUPPORTED.md` netvrdí delete, migration ani podporu
  canonical chat UI.

Evidence smí používat jen test-owned fixture v explicitním disk-backed artifact
rootu pod `/home/belphareon/worktrees`. Nesmí číst obsah skutečných
uživatelských dat ani vytvářet artifact v repo checkoutu.

## 6. Minimální ověření a max-volume hranice

Writer během vývoje spouští pouze:

```text
node --check chats/src/server.js
git diff --check
```

Review A je nezávislý read-only allowlist/call-graph review immutable
`S_CHAT`. Behavior se nespouští při každém checkpointu.

Review B nad exact immutable candidate `C_CHAT` spustí právě jeden bounded
negative boot/data-preservation gate: exact exit/stderr/stdout, nulový
listener/process a byteově shodný před/po manifest. Nevzniká nový testovací
soubor ani registry záznam. Tento predecessor gate se nepočítá jako pátý
logický reset scénář z následného WP.

Remediation mění subject a ruší předchozí review. Plný produkt, Electron,
network, GPU, Ollama ani historické chats testy se nespouštějí.

## 7. Autonomie a stop conditions

Uvnitř allowlistu writer volí fail-closed, preserve-data, no-network a nejmenší
vratnou implementaci. Přijatý support claim `unsupported / not shipped` se
znovu neeskaluje.

Dotčená část se zastaví při:

- potřebě nové veřejné capability, connectoru nebo listeneru;
- změně L0;
- jakémkoli čtení, zápisu nebo nevratném mazání existujících dat;
- external network effectu;
- nové runtime/test dependency;
- změně auth guardu, access boundary nebo trusted-local kontraktu;
- neřešitelném source conflictu;
- nutnosti změnit support claim nad rámec již přijatého standalone `chats/`
  disposition.

Finding mimo allowlist se zapíše do jednoho souhrnného handoffu a neopravuje se.
Jakákoli změna allowlistu vyžaduje vlastní docs-only governance commit před
novým writerem a nové nezávislé review.

## 8. Evidence DAG, report a promotion

Povinná topologie:

```text
baseRevision
  -> S_CHAT
  -> E_A_CHAT
  -> C_CHAT
  -> E_B_CHAT
  -> integration fast-forward
```

`S_CHAT` neobsahuje report a po Review A je immutable. `E_A_CHAT` má jediného
parenta `S_CHAT` a mění pouze rezervovaný report. Report obsahuje právě jednou
`integrationRef`, `baseRevision`, `subjectHead` a `reviewA.verdict`; nikdy SHA
commitu, který jej právě zapisuje.

Queue použije `--no-ff` nad aktuálním integration tipem, nemění behavior a
vytvoří immutable `C_CHAT` s ancestor vazbou na `E_A_CHAT`. Review B běží nad
exact `C_CHAT`. `E_B_CHAT` má jediného parenta `C_CHAT`, mění pouze stejný
report a byteově připojí právě `candidateHead` a `reviewB.verdict`.

Po metadata gate se integration ref fast-forwardne na `E_B_CHAT`. Teprve tento
tip je přípustný `baseRevision` reset subjectu. Worktrees/refs se uklidí až po
důkazu dosažitelnosti `E_B_CHAT`, čistém stavu a nulových vlastněných procesech;
neprokázané vlastnictví zůstává `UNKNOWN`.

### Jednorázová recovery skutečně vzniklé invalidní obálky

První pokus o `E_B_CHAT`, commit
`I=39776f1e90e425bd91a7be707edc556a299869bd`, je sice direct child `C_CHAT` a
mění pouze rezervovaný report, ale připojil 25 řádků Review B narativu a až za
ně dva povinné metadata řádky. Standardní `assert_report_append` jej proto
správně odmítá. Narativ včetně prvního
`CHANGES_REQUIRED / harness-only` výsledku, `lsof` self-observation, věty o
nezatajování nonzero výsledku a obou plných evidence digestů se nesmí ztratit;
decision 030 jej uchovává verbatim mimo report.

Pro tento jediný incident standardní poslední dva kroky nahrazuje
[`WP-M1-CHATS-EVIDENCE-RECOVERY`](WP-M1-CHATS-EVIDENCE-RECOVERY.md):

```text
C_CHAT
├── I -> G_REC -------------------┐
└── X (correct E_B_CHAT) ---------┴-> R_REC
```

`X` je nový direct child `C_CHAT` a report byteově rozšiřuje jen o exact
`candidateHead` a `reviewB.verdict: PASS`; jeho report blob je
`04b839db53abcbce510a9d57d7b750f20e2c6f9d` a root tree
`118a7b5007cfcb75baad0ce894b2e3bbd5517e72`. `R_REC` má parent order
`[G_REC, X]`, report byte-identický s `X` a všechny non-report paths z `G_REC`.
Corrected Review B se znovu nespouští. Integration postupuje pouze
fast-forwardem `I -> G_REC -> R_REC`, bez history rewrite. Pro tento skutečně
nastalý incident nahrazuje v předchozím odstavci výraz `E_B_CHAT` výhradně
metadata-ověřený canonical `R_REC`; samotné `I`, `G_REC` ani `X` reset
neodemknou.

## Výstup

- immutable fail-closed chats subject;
- Review A/B a promotion report v rezervované cestě;
- exact promotion tip jako vstup pro reset WP;
- pravdivý handoff: standalone package unsupported/not shipped, data preserved,
  canonical chat UI mimo scope, Finding 011 a Gate 1 stále otevřené.
