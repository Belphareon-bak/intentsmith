# WP-M1-SETTINGS-RESET-AUTHORITY — exact dual-CAS server-settings reset

**Typ:** zapisující M1 destructive-connector/recovery-authority WP · **Slot:**
jediný writer v izolovaném disk-backed worktree

**Rozhodnutí:**
[`029/A + M1-CLOSEOUT-X1`](../decisions/029-m1-settings-reset-scope.md)

**sourceEvidenceRevision:**
`69d29ed3c929593e092d047b6e182d9715e3d08e`

**integrationRef:** `integration/m1-consolidated-20260810`

**sourceEvidenceBase:** exact metadata-ověřený a canonical fast-forward
promováný `R_REC=17aba1b5749e8229d8079f3cbc6cdb865bdc25e8` z
[`WP-M1-CHATS-EVIDENCE-RECOVERY`](WP-M1-CHATS-EVIDENCE-RECOVERY.md).

**baseRevision:** nejnovější samostatně zreviewovaný a na integration
fast-forward promováný docs-only governance checkpoint nad `R_REC`, který
obsahuje `MOBILE-PIN-REFRESH-1+2` a historickou recovery-digest attestaci níže.
Jeho exact SHA zapíše unikátní reset run report; governance commit sám vlastní
SHA nepředstírá. Invalidní `I`, samotný `G_REC`, correct sibling `X` ani holý
`R_REC` nejsou po těchto governance checkpointech přípustný source review
base.

**Branch:** `wp/m1-settings-reset-authority-20260812`

**Worktree:** `/home/belphareon/worktrees/is-m1-settings-reset-authority`

**Review/promotion refs:**

- Review A: `evidence/m1-settings-reset-authority-review-a-20260812`, worktree
  `/home/belphareon/worktrees/is-m1-settings-reset-authority-review-a`;
- merge queue: `queue/m1-settings-reset-authority-promotion-20260812`, worktree
  `/home/belphareon/worktrees/is-m1-settings-reset-authority-queue`;
- Review B: `evidence/m1-settings-reset-authority-review-b-20260812`, worktree
  `/home/belphareon/worktrees/is-m1-settings-reset-authority-review-b`.

**Stav:** `ACTIVE / CHAT_EVIDENCE_RECOVERY_PROMOTED /
MOBILE-PIN-REFRESH-1+2 / RECOVERY-DRAFT-ATTESTATION` — canonical integration je
nejméně exact metadata-ověřený
`R_REC=17aba1b5749e8229d8079f3cbc6cdb865bdc25e8`. Invalidní `I`, samotný
`G_REC` ani correct sibling `X` nejsou přípustný reset base. Finding 011
zůstává `OPEN` a Gate 1 `BLOCKED`.

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
`2aeaa5028d9caf731f6a51f1f6df78a5f548c511`
(`wp/mobile-refresh-20260809`) a jeho merge-base s
`R_REC=17aba1b5749e8229d8079f3cbc6cdb865bdc25e8` i se source evidence
`69d29ed3c929593e092d047b6e182d9715e3d08e`:
`8366eb085415149f49e04bd9e788104c4c3ec1f8`.

Tento tip je lineární potomek původně připnutého
`b9b56d517d95475636b75427181bed9cbdd159c4`; bezprostředně před `S_RESET`
navíc přibyl jediný direct-child commit nad dříve připnutým
`3ea062f52425b429872ba18ace8c14f5b2248e53`, který mění pouze
`docs/mobile/CONTRACT-V2-PROPOSAL.md`. Diff kteréhokoli z těchto pinů vůči
novému tipu nemění žádnou z dvanácti cest níže, auth/access/
trusted-local wiring ani executable security guard semantics. Jde o přijatý
docs-only `MOBILE-PIN-REFRESH-1+2`, nikoli změnu 029 scope, schválení/
refreeze mobile návrhu nebo podporu mobile větve.

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
To není tvrzení, že celý mobile merge je čistý. Exact globální census má osm
`both-changed` cest. Dvě se auto-mergeují bez conflict markeru a 029 je
nevlastní:

- `scripts/run-model-failover-candidate-measurement.js`;
- `src/routes/security.js` — mobile delta v relevantním výsledku nemění
  executable auth/guard semantics.

Zbývající stav je `CONFLICTED_OUTSIDE_029`: etablovaných 11 semantic
conflict hunků v šesti cestách:

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

Historický pre-recovery reset draft ve worktree
`/home/belphareon/worktrees/is-m1-settings-reset-authority` na branchi
`wp/m1-settings-reset-authority-20260812` měl na invalidním `I` exact
dvanácticestný census výše, žádnou staged změnu, procházel `git diff --check`
a jeho plain `git diff --no-ext-diff` měl SHA-256
`856353eb3ed831dfcf0c31c68b62195e0596369bde40ada5979e1e82ce8e756b`.
Privátně uložený `git diff --binary --full-index` patch měl SHA-256
`4dd7917e75b641ba6286aef1293ec8eaf0a2e0e54732e4870c5fab1a7eaa9a51`.
Identita binary patch artefaktu byla ověřena před přenosem; po mechanickém
reapply byl znovu ověřen exact dvanácticestný census a plain digest `856…`.
Je to historická attestace preservation kroku, nikoli digest současného
working diffu nebo finálního source subjectu.
Následné allowlisted writer opravy po samostatně přistálých governance
commitech jej smějí změnit a musí dostat vlastní stabilní review digest.

Po canonical fast-forwardu integration refu na `R_REC` byl s limitem jediného
materializovaného 029 worktree proveden tento mechanický postup:

1. exact binary diff se uložil do nového privátního disk-backed artifactu mimo
   repo a `/tmp`, v novém mode-0700 adresáři a mode-0600 souboru; bez shodného
   SHA-256 a dvanácticestného censusu se nepokračuje;
2. teprve po `git apply --reverse --check` se tentýž owned diff
   reverse-aplikoval v současném reset worktree a ověřil se čistý index i
   worktree na exact `I`;
3. existující reset branch a tentýž worktree se posunuly pouze
   `--ff-only` z `I` na exact canonical `R_REC`;
4. po `git apply --check` se stejný patch aplikoval jednou, znovu se ověřilo
   exact
   dvanáct cest, SHA-256
   `856353eb3ed831dfcf0c31c68b62195e0596369bde40ada5979e1e82ce8e756b` a
   `git diff --check`; potom se zopakoval celý aktuální allowlist/mobile/caller
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

Povinná topologie; `G3_RESET` zde znamená nejnovější samostatně zreviewovaný a
na canonical integration promováný docs-only governance checkpoint popsaný v
`baseRevision` výše, nikoli SHA zapisovaný do vlastního commitu:

```text
R_REC = sourceEvidenceBase
  -> G_MOBILE_REFRESH (MOBILE-PIN-REFRESH-1)
  -> H_RESET (recovery-digest governance checkpoint)
  -> G3_RESET = baseRevision (MOBILE-PIN-REFRESH-2)
  -> canonical integration fast-forward na G3_RESET
  -> M_RESET [ordered parents G3_RESET,D_RESET]
       kde D_RESET zachovává K_RESET + pre-S docs
  -> S_RESET (direct child M_RESET; final production legacy 410)
  -> E_A_RESET
  -> C_RESET
  -> E_B_RESET
  -> integration fast-forward
```

`S_RESET` neobsahuje report a po Review A je immutable. `E_A_RESET` má jediného
parenta `S_RESET` a mění pouze rezervovaný report. Report obsahuje právě jednou
`integrationRef`, `baseRevision=G3_RESET`, `subjectHead=S_RESET` a
`reviewA.verdict`; nikdy SHA commitu, který jej právě zapisuje. Review A
hodnotí exact range `G3_RESET..S_RESET`.

Queue použije `--no-ff` nad stále exact canonical integration tipem
`G3_RESET`, nemění behavior a vytvoří immutable `C_RESET` s ordered parents
exact `[G3_RESET,E_A_RESET]` a ancestor vazbou na `E_A_RESET`. Semantic
conflict vrací `CHANGES_REQUIRED`; queue nesmí vzniknout nad holým `R_REC`
ani vynechat governance ancestry. Review B běží nad exact `C_RESET`.
`E_B_RESET` má jediného parenta `C_RESET`, mění pouze stejný report a byteově
připojí právě `candidateHead` a `reviewB.verdict`.

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

## 11. Review-B remediation r2 (normativní amendment)

Tento amendment nahrazuje pouze původní neúspěšnou Review-B obálku a její
navazující topologii. Nemění veřejný connector, dual-CAS transakci, auth/access/
trusted-local hranici, runtime/source/docs/test allowlist ani produktovou
sémantiku oddílů 1–9. Jediná nově povolená executable remediation je oprava
již allowlistovaného Studio test harnessu v
`tests/m1-studio-client.test.js`; nesmí oslabit žádnou behavior assertion.

### 11.1 Pravdivý výsledek původní Review B

Původní immutable production subject a jeho platná Review A zůstávají
dohledatelné, ale původní candidate nebyl přijat:

```text
G4:  4e88ca68d969f96e818c720efafdcf08f0a57258
S:   d42dffb380232199ba3532d0645a0ee012afa12e
E_A: c3b4b0ac0adf99fd71f1db81b6bdb68ca34835b3
C:   ae649a3840036d53705ab50dcfb56f68ee10eae8
```

V prvním gate attemptu se první max-4 program spustil a jeho čtyři top-level
cases skončily `0/4`, protože chyběl nativní binding `better-sqlite3`.
Checkpointy/programy 2–4 byly `NOT RUN`. Verdikt tohoto samostatného attemptu
je exact `BLOCKED_ENVIRONMENT / BLOCKED`; nesmí se sloučit s pozdějším
`CHANGES_REQUIRED`. Artifact root měl mode `0700`, deset prázdných adresářů,
nula souborů a canonical manifest SHA-256
`47bcba2684c50a002f025c5f4c2b3bc6f5c103806f194dd5339634bc9a7f76ca`.
Jeho exact cesta je:

```text
/home/belphareon/worktrees/is-m1-settings-reset-authority-review-b/.intentsmith-artifacts/direct-tests/m1-settings-notification-authority.test-QKIe5i
```

Pro tento pokus nevznikl žádný diskový log a zpětně se nevyrábí.

Jediná environment remediation proběhla příkazem:

```text
npm_config_nodedir=/home/belphareon/.cache/node-gyp/22.21.1 npm rebuild better-sqlite3 --offline --build-from-source --foreground-scripts --no-audit --no-fund
```

Příkaz skončil `exit 0`; npm log
`/home/belphareon/.npm/_logs/2026-08-12T08_38_17_583Z-debug-0.log`
má SHA-256
`7b20e61c0945c2e15c409ce5f2c083ee0817c242e36ec69580ea77f1e00d86b3`
a dokládá install výsledek `{code:0,signal:null}`. Výsledný
`better_sqlite3.node` měl 2 190 424 B a SHA-256
`2e23ed862e1cac3393f8cfb8474e6d0dd5b08d11c4b66bde6ea9b66770fdaffb`.

Opravený environment attempt má canonical gate-summary SHA-256
`3cd6225ecb96d8a05d3507617643002a1ba029956fabb962283c4097824ba298`
a skončil fail-fast takto:

```text
m1-settings-notification-authority.test.js  4/4 PASS
m1-model-policy.test.js                    36/36 PASS
m1-studio-client.test.js                 114/128 FAIL
validate-test-registry.js          NOT RUN_FAIL_FAST
```

Studio artifact root níže má canonical manifest SHA-256
`15dd5551b20b94bd996a240041872b8955b35c36cb5cc5fd526cf2d9e510de7e`.

```text
/home/belphareon/worktrees/is-m1-settings-reset-authority-review-b/.intentsmith-artifacts/direct-tests/m1-studio-client.test-KmZjCZ
```

Jeho `runtime/intentsmith-test.sqlite` má SHA-256
`dc817431b7186157495600c0bd106069e9437ed039f62e9dc529edf64d1bdd13`.

Všech čtrnáct selhání je test/harness defect v allowlistované Studio suite:

- 11x `architectSettingsCompleteResetReceipt is not defined`: harness helper
  exportuje, ale jeho slice začíná až na `async function resetSettings()` a
  vynechá bezprostředně předcházející definici helperu;
- 1x `succeeded.features is not a function`: harness vystavuje callable jako
  `succeeded.functions.features`;
- 2x fixed-microtask/request-index předpoklad po sekvenci fresh settings,
  policy, POST a features: jednou expected `requests=5`, observed `3`, jednou
  dereference neexistujícího `requests[2].url`.

Tato selhání nevyvrátila behavior kandidáta, ale povinný max-4 gate zůstal
červený. Výsledek je proto `CHANGES_REQUIRED`, registry program se správně
nespustil a původní `E_B_RESET` nevznikl. Původní Review B se nesmí přepsat na
PASS ani dokončit připojením dvou report řádků.

### 11.2 Zachování historie a čerstvé r2 rezervace

Původní source, Review-A a queue refs se nepohybují; absentní původní Review-B
ref se zpětně nevytváří. Zachovají se také rejected parent-order ref
`rejected/m1-settings-reset-parent-order-20260812` na
`11af49c63c5048383acefb463cae3ff5817e51c0`, výše uvedené artefakty a npm log.
Zakázaný je history rewrite, rebase, force update, nahrazení starých refs nebo
vydávání corrected attemptu za pokračování původní obálky.

Čerstvé rezervace jsou:

```text
governance: docs/m1-settings-reset-review-b-remediation-r2-20260812
source:     wp/m1-settings-reset-authority-r2-20260812
Review A:   evidence/m1-settings-reset-authority-review-a-r2-20260812
queue:      queue/m1-settings-reset-authority-promotion-r2-20260812
Review B:   evidence/m1-settings-reset-authority-review-b-r2-20260812
report:     docs/execution/runs/wp-m1-settings-reset-authority-20260812-report.md
```

Přesné sekvenční disk-backed worktree rezervace jsou:

```text
/home/belphareon/worktrees/is-m1-settings-reset-authority-r2
/home/belphareon/worktrees/is-m1-settings-reset-authority-review-a-r2
/home/belphareon/worktrees/is-m1-settings-reset-authority-queue-r2
/home/belphareon/worktrees/is-m1-settings-reset-authority-review-b-r2
```

V každém okamžiku smí existovat nejvýše jeden nový 029-owned worktree. Starý
Review-B checkout a jeho ignored artefakty se neodstraní, dokud nejsou důkazy
výše zachované a ověřené; dokud existuje, nový r2 checkout se nematerializuje.
Nic nevzniká v `/tmp` a cizí worktrees zůstávají mimo cleanup autoritu.

### 11.3 Povinná replacement topologie

Tento docs-only amendment je `G5`, jediný child exact `G4`, a mění právě tento
WP. `G5` musí před r2 writerem projít nezávislým review a canonical integration
se na něj posune pouze fast-forwardem. Vlastní SHA se do tohoto dokumentu
nezapisuje; ověří se z Git objektu spolu s jediným parentem a jednou změněnou
cestou.

Replacement DAG bez přepisu historie je:

```text
G4 -> G5
G5 -> M2 [ordered parents G5,
          D=beebc29f596788dd65eac7896dc1f389595fd501]
   -> S2
   -> E_A2
G5 + E_A2 -> C2 [ordered parents G5,E_A2]
             -> E_B2
             -> canonical integration fast-forward
```

`M2` zachová docs-only amendment z `G5` a přenese původní zreviewovatelný reset
subject z `D`; semantic conflict je `STOP`. `S2` je direct child `M2`, poslední
produkční commit a mění přesně tři cesty:

```text
src/routes/misc.js
tests/m1-model-policy.test.js
tests/m1-studio-client.test.js
```

První dvě cesty jsou byte-identický finální legacy-410 delta z původního `S`.
Třetí opraví pouze výše vyjmenované Studio harness vady: zahrne definici
`architectSettingsCompleteResetReceipt`, volá skutečně vystavenou `features`
funkci a nahradí fixed-microtask/index předpoklady deterministickým čekáním a
identifikací requestu. Nesmí změnit produkční kód, očekávaný connector/receipt,
počet behavior scénářů ani oslabit pozitivní či negativní assertion.
Po `S2` nesmí před `E_A2/C2/E_B2` přistát žádná další source/docs/test změna.

Nový writer není Review-A ani Review-B reviewer. Review A posoudí celý exact
range `G5..S2`, včetně původního dual-CAS subjectu, final-410 pořadí a opravy
harnessu; starý PASS se nerecykluje. `E_A2` je direct child `S2`, mění jen
původně rezervovaný report a zapíše exact `integrationRef`, `baseRevision=G5`,
`subjectHead=S2` a `reviewA.verdict: PASS`.

`C2` je immutable queue merge s ordered parents exact `[G5,E_A2]`, stromem
byte-identickým s `E_A2` a beze změny behavioru. Review B vznikne v čerstvém
disk-backed checkoutu exact `C2`. Dependency instalace a výše připnutý offline
native build jsou environment preflight před gate; gate se nespouští bez
loadable bindingu a během gate se už prostředí neremeduje.

Review B spustí čerstvý max-4 gate z oddílu 8 přesně jednou a fail-fast. Jen
úplný PASS dovolí `E_B2`, direct child `C2`, který ve stejném reportu byteově
připojí právě `candidateHead: C2` a `reviewB.verdict: PASS`. Metadata gate pak
musí ověřit parenty, stromy, allowlist, report prefix/append a nulovou změnu
auth/access/trusted-local hranice. Canonical integration se posune na `E_B2`
jen fast-forwardem; jiný výsledek zůstává pravdivě `CHANGES_REQUIRED` nebo
`BLOCKED` bez promotion.

## 12. Review-B remediation r3 (normativní amendment)

Tento amendment zachovává oddíl 11 i všechny starší pokusy beze změny a
nahrazuje pouze neúspěšnou r2 Review-B obálku. Nemění produkt, connector,
dual-CAS transakci, auth/access/trusted-local hranici ani allowlist. Jediná
nově povolená změna je oprava cross-realm porovnání ve stávající allowlistované
suite `tests/m1-studio-client.test.js`; behavior assertions se nesmí oslabit.

### 12.1 Immutable r2 výsledek

Přesná r2 topologie zůstává dohledatelná a nesmí se přepsat:

```text
S2:   e95a34da0f6546e0b32019df1b9104a1668d49b0
E_A2: fd1d45a8571d8cfb26eebcc0b718dfaaba7af743
C2:   20f487411b1b13952ce09b689e30047875803193
```

Review A nad r2 skončila `PASS`, ale nález Review B vyžaduje nový subject, a
proto je tento PASS pro další promotion invalidovaný a nesmí se recyklovat.
Review-B environment preflight byl úspěšný a jeho důkazy jsou:

```text
npm-ci log SHA-256:       df29ccbfcf9d6b7d57859dbf3c67240f967cd83386a93a96d9d21afadc8852ff
native-build log SHA-256: 017695809f8dbf2c6015ab49334243f40c9f7416925f1604182cc57baff54d03
binding SHA-256:          2e23ed862e1cac3393f8cfb8474e6d0dd5b08d11c4b66bde6ea9b66770fdaffb
```

Max-4 gate běžel právě jednou a fail-fast:

```text
m1-settings-notification-authority.test.js   4/4 PASS
m1-model-policy.test.js                     36/36 PASS
m1-studio-client.test.js                  127/128 FAIL
validate-test-registry.js           NOT RUN_FAIL_FAST
```

Jediné selhání je test/harness defect: objekt vytvořený ve VM realm má proti
host objektu odlišnou referenční/prototypovou identitu při `deepStrictEqual`.
Nejde o behavior failure kandidáta, gate je však povinně červený a r2 verdikt
je `CHANGES_REQUIRED`; `E_B2` nevznikl a canonical integration se na `C2`
neposune. Dochovaný artifact root je:

```text
/home/belphareon/worktrees/is-m1-settings-reset-authority-review-b-r2/.intentsmith-artifacts/direct-tests/m1-studio-client.test-w2Sue6
```

Jeho canonical structural inventory SHA-256 je
`05a62c6e59fbba9660a4cbe4da48eb0a8b64ac0630d2ef12f9f1af1c11221a81`,
SHA-256 řádku se sorted file-checksum manifestem je
`ee37ab0291e5836b4e3191b23d8ae3cb7436f621f2e10f7be0d8b5e33355e148`
a `runtime/intentsmith-test.sqlite` má SHA-256
`dc817431b7186157495600c0bd106069e9437ed039f62e9dc529edf64d1bdd13`.
Artefakt, oba preflight logy a staré refs zůstávají zachované; r3 se nesmí
vydávat za pokračování r2 attemptu.

### 12.2 Přesná oprava a r3 rezervace

Oprava změní přesně čtyři již existující feature assertions tak, že hodnotu
z VM realm před porovnáním převede existujícím `hostClone()`:

```text
succeeded.functions.features()
fenced.functions.features()
overlapping.functions.features()
afterFailure.functions.features()
```

Každý výraz bude mít exact tvar `hostClone(<expression>)`; očekávané hodnoty,
počet scénářů a všechny ostatní assertions zůstanou byte-identické. Žádná jiná
testová, docs nebo produkční změna v subjectu není dovolena.

Čerstvé refs jsou:

```text
governance: docs/m1-settings-reset-review-b-remediation-r3-20260812
source:     wp/m1-settings-reset-authority-r3-20260812
Review A:   evidence/m1-settings-reset-authority-review-a-r3-20260812
queue:      queue/m1-settings-reset-authority-promotion-r3-20260812
Review B:   evidence/m1-settings-reset-authority-review-b-r3-20260812
report:     docs/execution/runs/wp-m1-settings-reset-authority-20260812-report.md
```

### 12.3 Povinná replacement topologie

Tento docs-only amendment je `G6`, jediný child exact
`G5=13014c394e8b7ae4a4437321f687cb2a40d3600f`, a mění právě tento WP. Writer
není reviewer; `G6` projde nezávislým review a canonical integration se z `G5`
na `G6` posune pouze fast-forwardem ještě před writerem.

```text
G5 -> G6
G6 + S2 -> M3 [ordered parents G6,S2]
             -> S3
             -> E_A3
G6 + E_A3 -> C3 [ordered parents G6,E_A3]
              -> E_B3
              -> canonical integration fast-forward
```

`M3` zachová celý immutable r2 subject ze `S2` včetně už přítomného
produkčního legacy-alias 410 a přidá governance ancestry z `G6`; semantic
conflict je `STOP`. `S3` je direct child `M3`, poslední immutable
source/test subject commit, ale není novou produkční změnou: mění přesně jedinou
cestu `tests/m1-studio-client.test.js` a pouze čtyři výše připnuté řádky.
Po `S3` nesmí před `E_A3/C3/E_B3` přistát žádná další source/docs/test změna.

Čerstvá Review A posoudí exact range `G6..S3`; starý Review-A PASS ani r2
Review-B výsledek se nerecyklují. `E_A3` je direct child `S3`, mění pouze
stejný report a zapíše exact `integrationRef`, `baseRevision=G6`,
`subjectHead=S3` a `reviewA.verdict: PASS`. `C3` má ordered parents exact
`[G6,E_A3]`, strom byte-identický s `E_A3` a žádnou behavior změnu.

Review B běží v čerstvém disk-backed checkoutu exact `C3`. Offline dependency
instalace a loadable native binding jsou pouze preflight; poté spustí celý
max-4 gate právě jednou a fail-fast. Pouze úplný PASS dovolí `E_B3`, direct
child `C3`, s exact dvouřádkovým appendem `candidateHead: C3` a
`reviewB.verdict: PASS`. Metadata gate ověří parenty, stromy, jednu-cestnou S3
opravu, report obálku a nulovou změnu auth/access/trusted-local hranice.
Canonical integration se na `E_B3` posune pouze fast-forwardem.
