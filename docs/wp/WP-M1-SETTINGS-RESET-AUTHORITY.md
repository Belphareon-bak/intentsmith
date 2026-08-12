# WP-M1-SETTINGS-RESET-AUTHORITY — exact dual-CAS server-settings reset

**Typ:** zapisující M1 destructive-connector/recovery-authority WP · **Slot:**
jediný writer v izolovaném disk-backed worktree

**Rozhodnutí:**
[`029/A + M1-CLOSEOUT-X1`](../decisions/029-m1-settings-reset-scope.md)

**sourceEvidenceRevision:**
`69d29ed3c929593e092d047b6e182d9715e3d08e`

**integrationRef:** `integration/m1-consolidated-20260810`

**baseRevision:** exact metadata-ověřený a canonical fast-forward promováný
`R_REC` z
[`WP-M1-CHATS-EVIDENCE-RECOVERY`](WP-M1-CHATS-EVIDENCE-RECOVERY.md); jeho plné
SHA zapíše až unikátní reset run report. Invalidní `I`, samotný `G_REC` ani
samotný correct sibling `X` nejsou přípustný base.

**Branch:** `wp/m1-settings-reset-authority-20260812`

**Worktree:** `/home/belphareon/worktrees/is-m1-settings-reset-authority`

**Review/promotion refs:**

- Review A: `evidence/m1-settings-reset-authority-review-a-20260812`, worktree
  `/home/belphareon/worktrees/is-m1-settings-reset-authority-review-a`;
- merge queue: `queue/m1-settings-reset-authority-promotion-20260812`, worktree
  `/home/belphareon/worktrees/is-m1-settings-reset-authority-queue`;
- Review B: `evidence/m1-settings-reset-authority-review-b-20260812`, worktree
  `/home/belphareon/worktrees/is-m1-settings-reset-authority-review-b`.

**Stav:** `ACTIVE / BLOCKED_ON_CHAT_EVIDENCE_RECOVERY` — chats source candidate
a corrected Review B behavior mají PASS, ale canonical commit
`I=39776f1e90e425bd91a7be707edc556a299869bd` má invalidní report obálku.
Reset writer nesmí pokračovat z `I`, aktivačního checkpointu, `G_REC` ani
nepromovaného siblingu `X`. Finding 011 zůstává `OPEN` a Gate 1 `BLOCKED`.

Současně smí být materializovaný nejvýše jeden nově vytvořený 029-owned
worktree pro writer, review nebo queue krok. Výše uvedené worktree cesty jsou
sekvenční rezervace. Existující/cizí worktrees a procesy nejsou součástí tohoto
limitu ani cleanup autority; ownership `UNKNOWN` zůstává nedotčené a nic nového
nevzniká v `/tmp`.

## 1. Uživatelský výsledek

Uživatel může po explicitním potvrzení resetovat pouze canonical serverová
nastavení scope `SERVER_SETTINGS_V1`. Server atomicky:

- odstraní z `user_settings.id=1` přesně 46
  `GENERIC_USER_SETTING_PATHS` a top-level `storage`;
- zachová unknown/unowned hodnoty i všechny řádky mimo `id=1`;
- vrátí exact public settings projection `{}`;
- resetuje model automation policy na OFF/default;
- inkrementuje settings a policy revision každou právě o jedna;
- zapíše právě jeden `GLOBAL_RESET` event.

Reset není factory delete ani privacy erase. Zachová ostatní DB tabulky,
konverzace, paměť, agenty, projekty, soubory, environment, Setup JSON,
attachments, historii, backupy i lokální UI data mimo dvě výslovně vlastněné
client akce níže.

## 2. Povolené a zakázané cesty

**Přesný runtime/source allowlist:**

- `src/routes/misc.js` — exact input/HTTP mapování, truthy post-commit runtime
  status a finální legacy alias 410;
- `src/db/user-settings.js` — pouze owner-only `id=1` reset uvnitř
  caller-owned transaction;
- `src/db/model-policy.js` — jediný dual-CAS `BEGIN IMMEDIATE` commit point,
  policy default a `GLOBAL_RESET` event;
- `c3-ide/extensions/c3-chat-panel/lib/browser/chat-panel-module.js` — Studio
  dual CAS, exact receipt, feature-flags local reload/retry a pravdivé UI texty;
- `src/ui/architect/architect.js` — Architect dual CAS, exact receipt,
  receipt-local cleanup/retry a zachování ostatního local state;
- `src/ui/architect/architect.html` — pouze pravdivé „serverová nastavení“
  označení a zachování inertního false-factory-delete povrchu.

**Přesný test allowlist bez nové suite:**

- `tests/m1-settings-notification-authority.test.js`;
- `tests/m1-model-policy.test.js`;
- `tests/m1-studio-client.test.js`.

**Přesný docs/evidence allowlist:**

- `docs/API-REFERENCE.md` — exact active reset a retired alias;
- `docs/CHANGELOG.md` — aktuální release note, ne přepis historických záznamů;
- `docs/findings/011-user-settings-authority-and-secret-exposure.md` — pouze
  source-progress a přesná hranice tvrzení;
- unikátní
  `docs/execution/runs/wp-m1-settings-reset-authority-20260812-report.md` smí
  poprvé vzniknout až jako jediná změněná cesta report-only `E_A` po Review A.

**Zakázané:**

- `src/routes/system.js`; existující `GET /api/system/models/settings` už
  poskytuje typed policy revision a nesmí se kvůli resetu rozšiřovat;
- `src/server.js`, `src/routes/security.js`, Setup, notification authority,
  WS/protocol, mobile, chats, agent, conversation, project nebo file-delete
  cesty;
- schema/migrace, nová tabulka, nový endpoint/connector/capability, renderer
  admin token, dependency, package/lockfile nebo build output;
- `tests/registry.json`, generovaný registry dokument, nový top-level test nebo
  změna registry počtu/fingerprintu;
- `ROADMAP.md`, `SYSTEM-MAP.md`, decision 029, tento statický WP a
  `docs/wp/README.md` uvnitř source subjectu;
- změna existující trusted-local/access/auth boundary;
- factory delete, privacy erase, DB table-wide delete, filesystem cleanup,
  actual user-data migration, external network, Electron/build, GPU, Ollama
  nebo full-product test.

Rename se pro allowlist počítá jako odstraněná původní a přidaná cílová cesta.
Jakákoli cesta mimo allowlist je `CHANGES_REQUIRED`.

## 3. Exact veřejný connector

Jediný aktivní reset connector je:

```http
POST /api/settings/reset
Content-Type: application/json
```

Body musí být exact plain object bez inherited nebo extra keys:

```json
{"scope":"SERVER_SETTINGS_V1","expectedRevision":1,"expectedPolicyRevision":1}
```

Obě revisions jsou positive safe integers. Missing body, invalid JSON,
`null`, array, non-object, wrong scope, extra/inherited key, boolean, string,
float, zero, negative, unsafe integer nebo chybějící revision vrátí před DB,
runtime a client-local efektem:

```json
{"ok":false,"code":"SETTINGS_RESET_INPUT_INVALID"}
```

s HTTP `400`.

Stale settings nebo policy revision vrátí HTTP `409`:

```json
{
  "ok": false,
  "code": "SETTINGS_RESET_REVISION_CONFLICT",
  "expectedRevision": 1,
  "currentRevision": 2,
  "expectedPolicyRevision": 1,
  "currentPolicyRevision": 2
}
```

Response vždy nese obě expected/current dvojice, i když je stale jen jedna.
Nemá DB, event, runtime ani UI efekt a nesmí vyvolat automatický replay.

Úspěšný exact receipt zachová existující vnější tvar s `ok:true`,
`success:true`, committed settings `revision`, exact `settings:{}`, veřejným
default-policy commitem, jedním `GLOBAL_RESET` eventem a pravdivými
`runtimeApplied`/`runtimeErrorCode`. Client jej přijme jen když obě revisions
postoupily právě o jedna, settings jsou exact `{}`, policy je OFF/default a
event odpovídá commitu.

## 4. Jediný transaction/authority commit point

Route validuje a parsuje exact body, potom předá obě revisions jedinému
`ModelAutomationPolicyRepository.resetFromGlobalSettings()` seamu. Repository
vlastní top-level `transaction.immediate()`; nested repository nesmí otevřít
druhou transakci ani commitnout samostatně.

Uvnitř jediného `BEGIN IMMEDIATE` a před první mutací:

1. načte konzistentní `user_settings.id=1` snapshot a jeho revision;
2. načte konzistentní model-policy projection/event a její revision;
3. porovná obě current revisions s oběma expected hodnotami;
4. při kterémkoli mismatch vyhodí jediný
   `SETTINGS_RESET_REVISION_CONFLICT` s oběma dvojicemi.

Teprve potom:

1. z klonu současného `id=1` dokumentu odstraní exact
   `GENERIC_USER_SETTING_PATHS` a top-level `storage`;
2. zachová unknown/unowned hodnoty, nested siblings a sentinel řádky `id != 1`;
3. zapíše `id=1` s settings revision `+1`;
4. zapíše policy OFF/default s policy revision `+1`;
5. přidá právě jeden append-only `GLOBAL_RESET` event;
6. commitne vše nebo nic.

Explicitní reset již defaultního stavu je stále nový `+1/+1` auditovaný commit.
Retry stejného requestu po ztracené odpovědi používá staré revisions a skončí
`409` bez druhého eventu. Pre-commit chyba rollbackne všechny tabulky a
neprovede runtime/UI efekt.

## 5. Runtime a auth hranice

Po 026 neexistuje živá DB notification credential cache. Reset nesmí měnit
immutable environment notification authority ani žádný env/Setup soubor.

Po DB commitu se pouze `FeatureManager` vrátí na startup env defaults.
Skutečná post-commit runtime chyba nesmí změnit durable success na rollback
nebo falešný HTTP 500. Receipt zůstane úspěšný a vrátí:

- `runtimeApplied:false`;
- `runtimeErrorCode:"SETTINGS_RUNTIME_APPLY_FAILED"`.

Úspěšný runtime apply vrátí `runtimeApplied:true` a `runtimeErrorCode:null`.
Logger failure je observational a committed response nezmění.

Route zachová existující canonical trusted-local access boundary. UI navíc
vyžaduje explicitní potvrzení. Nepřidává se renderer admin token, route-level
auth guard ani localhost/dev bypass. Potřeba změnit auth guard, access boundary
nebo trusted-local kontrakt je stop condition, nikoli implementační detail.

## 6. Studio a Architect receipt fáze

Oba klienti získají settings revision z existujícího `GET /api/settings/v2` a
policy revision z existujícího `GET /api/system/models/settings`. Oddělené read
snapshoty jsou bezpečné: mezilehlý concurrent commit vyústí v serverový `409`,
nikoli automatický replay. Po conflict/erroru se klient může lokálně reloadnout,
ale nový reset vyžaduje nový explicitní user action a confirmation.

### Studio

Studio:

- odešle exact dual-CAS body;
- přijme jen exact committed receipt;
- nastaví server projection na `{}` a obě lokální revisions na receipt hodnoty;
- invaliduje `_featureFlags` a znovu je načte ze serveru;
- zachová celý `localStorage`;
- při feature-flags reload/cleanup chybě zachová receipt v lokální degraded fázi
  a dovolí retry pouze této lokální fáze, nikdy druhý POST reset;
- texty označí akci jako reset serverových nastavení, nikoli všech
  uživatelských dat nebo factory reset.

### Architect

Architect:

- odešle exact dual-CAS body a přijme jen exact committed receipt;
- po receipt odstraní pouze local server-replica key `paiass_settings`;
- zachová `paiass_accordion_state` i všechny ostatní localStorage/session hodnoty;
- při local cleanup/render chybě zachová receipt v lokální degraded fázi a
  retry neopakuje serverový POST;
- zachová druhé tlačítko „Úplné smazání“ explicitně nedostupné a bez HTTP/local
  effectu;
- texty označí první akci jako reset serverových nastavení.

Delivery-unknown před validním receiptem nikdy nevede k optimistickému lokálnímu
mazání. Lost receipt se automaticky nereplayuje; bezpečný další user action
nejdřív načte aktuální revisions.

## 7. Legacy alias a mobile merge preflight

`POST /api/reset` skončí před parse/body, DB, runtime a client-local efektem
exact HTTP `410`:

```json
{"ok":false,"code":"LEGACY_RESET_ALIAS_RETIRED"}
```

Commit, který zavede tento alias 410, je poslední produkční commit celého
subjectu a současně immutable `S_RESET`. Jeho parent už musí obsahovat:

- dual-CAS canonical route a jediný transaction commit point;
- Studio i Architect cutover;
- exact local receipt/no-replay chování;
- všechny source/docs/test změny kromě samotné finální alias assertion, která
  smí přistát v témže `S_RESET`.

Aktivační census pinuje pending mobile ref
`b9b56d517d95475636b75427181bed9cbdd159c4`
(`wp/mobile-refresh-20260809`) a jeho merge-base s
`69d29ed3c929593e092d047b6e182d9715e3d08e`:
`8366eb085415149f49e04bd9e788104c4c3ec1f8`.

Na tomto snapshotu je mobile strana proti merge-base beze změny pro celý
reset-relevant manifest:

```text
src/routes/misc.js
src/db/user-settings.js
src/db/model-policy.js
c3-ide/extensions/c3-chat-panel/lib/browser/chat-panel-module.js
src/ui/architect/architect.js
src/ui/architect/architect.html
tests/m1-settings-notification-authority.test.js
tests/m1-model-policy.test.js
tests/m1-studio-client.test.js
docs/API-REFERENCE.md
docs/CHANGELOG.md
docs/findings/011-user-settings-authority-and-secret-exposure.md
```

Relevantní three-way výsledek proto pro tyto blobs bere integration stranu.
To není tvrzení, že celý mobile merge je čistý. Exact globální stav tohoto
snapshotu je `CONFLICTED_OUTSIDE_029`: 11 conflict hunků v šesti cestách:

- `README.md` — 3;
- `docs/convergence/TEST-REGISTRY.md` — 1;
- `docs/wp/README.md` — 1;
- `tests/fixtures/module-boundary/baseline.json` — 2;
- `tests/registry.json` — 2;
- `tests/schema-migrations.test.js` — 2.

029 tyto konflikty nevlastní a nesmí je řešit. Drift pinned mobile refu,
merge-base, mobile-side reset manifestu nebo uvedeného merge/conflict censusu
je `STOP` a vyžaduje nový governance/review vstup, ne tichou aktualizaci
subjectu.

Writer před vytvořením `S_RESET` a nezávislé Review A nad exact `S_RESET` znovu
ověří canonical strom, oba pinned SHA, prázdný mobile-side diff uvedeného
manifestu, relevantní integration-blob výsledek, globální
`CONFLICTED_OUTSIDE_029` census a callers:

- nula first-party `/api/reset` callerů;
- nula reset cest používajících `localStorage.clear()`;
- žádné resurrected legacy Architect chování;
- žádný semantic conflict se nesmí opravit v 029 queue.

Tato kontrola nepřijímá ani nepromuje mobile větev. Při její pozdější skutečné
promotion musí mobile integrátor znovu ověřit actual resulting tree, nulu
legacy callerů/resetových `localStorage.clear()` efektů a všechny tehdy aktuální
konflikty; dnešní relevantní blob inference není budoucí merge attestace.

### Evidence-recovery base a byte-identický přenos rozpracovaného diffu

Decision [030](../decisions/030-m1-chats-evidence-envelope-recovery.md) připíná
jednorázovou topologii `I -> G_REC -> R_REC` s correct siblingem `X` z
`C_CHAT`. `G_REC` záměrně nemění žádnou z dvanácti reset-relevantních cest
uvedených v manifestu výše; zvlášť nemění
`docs/findings/011-user-settings-authority-and-secret-exposure.md`, přestože
byla v governance allowlistu. `X` mění pouze standalone-chats run report a
`R_REC` přebírá všechny non-report paths byte-identicky z `G_REC`. Proto musí
metadata gate prokázat prázdný path i blob delta `I..R_REC` nad celým
dvanácticestným reset manifestem.

Současný necommitnutý reset draft ve worktree
`/home/belphareon/worktrees/is-m1-settings-reset-authority` na branchi
`wp/m1-settings-reset-authority-20260812` má exact dvanácticestný census výše,
žádnou staged změnu, prochází `git diff --check` a jeho
`git diff --no-ext-diff --binary` má SHA-256
`856353eb3ed831dfcf0c31c68b62195e0596369bde40ada5979e1e82ce8e756b`.
Nesmí se commitnout na `I`, rebasovat, mergovat, stashnout ani převést do
druhého reset worktree.

Po canonical fast-forwardu integration refu na `R_REC` se zachová limitem
jediného materializovaného 029 worktree tento mechanický postup:

1. exact binary diff se uloží do nového privátního disk-backed artifactu mimo
   repo a `/tmp`, v novém mode-0700 adresáři a mode-0600 souboru; bez shodného
   SHA-256 a dvanácticestného censusu se nepokračuje;
2. teprve po `git apply --reverse --check` se tentýž owned diff reverse-aplikuje
   v současném reset worktree a ověří se čistý index i worktree na exact `I`;
3. existující reset branch a tentýž worktree se posunou pouze
   `--ff-only` z `I` na exact canonical `R_REC`;
4. po `git apply --check` se stejný patch aplikuje jednou, znovu se ověří exact
   dvanáct cest, SHA-256
   `856353eb3ed831dfcf0c31c68b62195e0596369bde40ada5979e1e82ce8e756b` a
   `git diff --check`; potom se opakuje celý aktuální allowlist/mobile/caller
   preflight.

Artifact zůstane privátní a zachovaný minimálně do úspěšného reapply a digest
gate. Zakázané jsou `stash`, `reset --hard`, force update, druhý reset worktree,
ruční přepis patchů a cleanup před důkazem obnovy. Jakákoli odlišnost je
`STOP`; recovery sama nedává oprávnění měnit reset behavior nebo jeho allowlist.

Po `S_RESET` smějí následovat pouze report-only `E_A_RESET`, queue merge bez
behavior editace a report-only `E_B_RESET`. Jakákoli source/docs/test změna po
legacy 410 invaliduje subject a vyžaduje nový poslední produkční commit i review.

## 8. Čtyři logické scénáře a minimální gate

Existující harnessy pokryjí nejvýše čtyři logické scénáře:

1. exact scope/dual CAS/`id=1` owner reset/sentinel/repeat/lost-response;
2. legacy alias 410/atomic rollback/post-commit runtime degradace;
3. Studio dual CAS/feature reload/local preservation/local-only retry;
4. Architect dual CAS/one-key cleanup/local preservation/local-only retry.

Nevzniká nová suite ani registry změna. Tři existující behavior programy a
strukturální registry validátor tvoří celý max-4 program gate:

```text
node tests/m1-settings-notification-authority.test.js
node tests/m1-model-policy.test.js
node tests/m1-studio-client.test.js
node scripts/validate-test-registry.js --json
```

Writer během vývoje spouští jen syntax změněných JS a diff hygiene:

```text
node --check src/routes/misc.js
node --check src/db/user-settings.js
node --check src/db/model-policy.js
node --check c3-ide/extensions/c3-chat-panel/lib/browser/chat-panel-module.js
node --check src/ui/architect/architect.js
git diff --check
```

Review A je nezávislý read-only allowlist, transaction/call-graph, connector,
negative-test a final-410-order review immutable `S_RESET`. Behavior se
nespouští po každém writer checkpointu.

Review B spustí max-4 gate jednou nad exact immutable candidate `C_RESET`.
Remediation mění subject, ruší review a nový candidate se měří znovu. Electron,
build, E2E, network, GPU, Ollama, full product ani release gate nejsou součástí
029.

## 9. Autonomie a stop conditions

Uvnitř allowlistu writer autonomně volí fail-closed, preserve-data, no-replay,
no-network a nejvratnější kompatibilní implementaci. Error detail keys,
repository helper API, lokální receipt state machine a fixtures jsou
implementační detaily připnuté tímto WP a neeskalují se po řádcích.

Dotčená část se zastaví při:

- nové veřejné capability nebo connectoru;
- změně L0;
- nevratném smazání dat nebo rozšíření reset owner scope;
- external network effectu;
- model pull/delete/rebind;
- změně již přijatého support claimu;
- nové runtime/test dependency;
- neřešitelném source conflictu;
- přidání, zeslabení nebo obejití auth guardu, access boundary či trusted-local
  kontraktu.

Vadu uvnitř allowlistu writer opraví; vadu mimo scope přidá do jednoho
souhrnného finding handoffu. Jakákoli změna allowlistu musí přistát vlastním
docs-only governance commitem před novým writerem a projít nezávislým review.
Vždy platí `writer != reviewer` a reset writer/reviewers jsou odlišní od chats
writer/reviewerů.

## 10. Evidence DAG, report a promotion

Povinná topologie:

```text
R_REC = baseRevision
  -> reset/caller cutover commits
  -> S_RESET (final production legacy 410)
  -> E_A_RESET
  -> C_RESET
  -> E_B_RESET
  -> integration fast-forward
```

`S_RESET` neobsahuje report a po Review A je immutable. `E_A_RESET` má jediného
parenta `S_RESET` a mění pouze rezervovaný report. Report obsahuje právě jednou
`integrationRef`, `baseRevision`, `subjectHead` a `reviewA.verdict`; nikdy SHA
commitu, který jej právě zapisuje.

Queue použije `--no-ff` nad aktuálním integration tipem, nemění behavior a
vytvoří immutable `C_RESET` s ancestor vazbou na `E_A_RESET`. Semantic conflict
vrací `CHANGES_REQUIRED`. Review B běží nad exact `C_RESET`. `E_B_RESET` má
jediného parenta `C_RESET`, mění pouze stejný report a byteově připojí právě
`candidateHead` a `reviewB.verdict`.

Po metadata gate se integration ref fast-forwardne na `E_B_RESET`. Worktrees a
refs se odstraní až po důkazu jeho dosažitelnosti, čistém stavu a nulových
vlastněných procesech; ownership `UNKNOWN` neopravňuje k úklidu.

## Výstup

- immutable dual-CAS reset subject s final production legacy 410;
- samostatné Review A/B a promotion report;
- exact max-4 gate evidence bez nové suite;
- pravdivý Finding 011 handoff: 029 přijato, ale není factory/privacy erase;
- Gate 1 zůstane `BLOCKED`, dokud integrační vlastník nepřijme celý 029 a
  následné B3/B4 prerequisites.
