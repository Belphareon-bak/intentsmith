# WP-M6-RELEASE — zmrazený kandidát a validační matice IntentSmith 1.0

**Typ:** zapisující Work Package · **Stav:** KEY_CUSTODY_CHANGES_REQUIRED / PRODUCT_REMEDIATION_IMPLEMENTED / RE_REVIEW_REQUIRED / TECHNICAL_REVIEW_CHANGES_REQUESTED / ACCEPTANCE_BLOCKED
**Vstupní revision:** `55938fd0628bdb725736acdf21a451854580aaa7`
**Původní vlastník:** `codex/m6-release-20260827`; navazující ROOT scope níže.

**Aktuální ROOT scope,6. 10. 2026:** pouze vlastní cache/evidence oprava v
`scripts/run-m6-candidate-evidence.js`, `tests/m6-candidate-plan.test.js`,
`tests/m1-journey.test.js` a zdejší report/maps/inventura. M1 oracle/CHAT logika,
model parametry a historické FAIL beze změny. M5 aktuálně8/9/privacy changes required;
retain_and_rotate již zvolené, custodyA/B doložená, druhá operator kopie/reviewer recovery
ani13 signed receipts se nepředstírají. Starší datované autority/výsledky níže jsou archiv.

Operátor 2026-08-27 výslovně povolil implementovat všechny bloky M6 bez čekání
na technické re-review M5. Toto povolení mění pořadí práce, nikoli pravdu o
branách: M5 zůstává `8/9 REVIEW_PASSED / PRIVACY RE_REVIEW_REQUIRED`, skutečné rotace
a disposition historie nejsou provedené a M6 se nesmí označit `ACCEPTED`, dokud
nejsou splněné vstupy a exit kritéria `ROADMAP.md §10`.

Operátor tentýž den odložil všechny validační běhy, které vedou chat přes živé
LLM/Ollamu nebo hodnotí modelově závislou kvalitu, protože probíhá optimalizace
a aktivní modely se mohou změnit. Tyto řádky mají stav
`DEFERRED_MODEL_OPTIMIZATION`: nejsou PASS ani FAIL a starší modelové artefakty
se nesmějí připnout k novému kandidátu. Modelově nezávislé kontrakty, fake
provider testy, upgrade, soak a throughput bloky mohou pokračovat.

**Aktualizace autority 2026-09-09:** operátor následně výslovně povolil
konkrétní systémové nasazení/restart Ollamy a sériové M6 modelové okno podle
[WP-CORE-COMPLETION-20260909](WP-CORE-COMPLETION-20260909.md). Pro tento
rozsah je původní odklad překonaný; historické `DEFERRED_MODEL_OPTIMIZATION`
výsledky se zpětně nemění na PASS. Autorizovaný instalační pokus skončil
`pkexec` exit 127 / `Not authorized` před root bootstrapem. V této fázi byla
závislost `ADMIN_AUTHENTICATION_BLOCKED`, nikoli chybějící souhlas;
živé modelové běhy zůstávají `NOT_RUN`. [Evidence a navazující oprava policy](../execution/runs/m6/provider-activation-20260909.md).
M5/release acceptance, zákaz cizích zásahů a změn živých bindings zůstávají.

**Další skutečný stav 2026-09-09 12:20 UTC:** operátor admin autentizaci
dokončil; aktivace ale vyvolala rollback kvůli chybně očekávané verzi v1.
Připnutá binárka hlásí `0.32.14-intentsmith.1`, původní service 0.32.14 byla
obnovena. Reviewed v2 očekávání a bezpečné opakování jsou připravené,
provider/model kvalifikace zůstává `NOT_RUN / SYSTEM_PROVIDER_BLOCKED`.
Podrobnosti a nový terminálový launcher jsou ve výše uvedené run evidenci.

## 1. Uživatelský výsledek a rozsah

Vznikne reprodukovatelný IntentSmith 1.0 release candidate, jehož hlavní
Studio journey, lokální modelové role, řízené efekty, rozšíření, agenti, učení,
data/recovery a všechny podporované conditional plochy projdou jednou
spustitelnou a content-addressed validační maticí. Výsledek pravdivě oddělí
implementační zelenou, nezávislé review, operátorské demo a samotné vydání.

## 2. Vlastněné cesty a connector

**Vlastněné cesty:** `contracts/m6/**`, `src/release/**`, M6 testy a fixture,
`scripts/*m6*`, nezbytné focused opravy skutečných release regresí,
`tests/registry.json`, generovaný `docs/convergence/TEST-REGISTRY.md`, M6 run/review
dokumenty a přesné M6 stavové řádky v `ROADMAP.md`/`SYSTEM-MAP.md`.

**Connector:** interní `M6ReleaseValidation@1` mezi připnutým kandidátem,
test registrem, runtime evidence a release verdictem. Nemění veřejný HTTP/WS
produktový kontrakt ani model binding.

**Zakázané bez nové explicitní autority:** push, merge do cizí větve, tag,
publish, force/rewrite Git historie, credential rotation u providerů, změna
aktivního model bindingu, zásah do coworker checkoutu/procesů a souběžné GPU
zatížení.

## 3. Vstupní revision a závislosti

- technický základ: `55938fd0628bdb725736acdf21a451854580aaa7`;
- M1–M4 jsou operátorsky přijaté podle `ROADMAP.md`;
- M5 druhé review: 5/9 přijato, 4/9 implementačně opraveno a čeká na re-review;
- tvrdé acceptance závislosti: M5 9/9, 8/8 skutečných rotací, history receipt,
  nulové HIGH/CRITICAL blokátory a nezávislé M6 review;
- operátor povolil implementovat přes tuto závislost, ale ne ji přeskočit ve
  finálním verdiktu.

## 4. Malá demonstrace

Z čerstvého klonu připnutého commitu: instalace a produkční Studio build,
otevření Git projektu, pokračování existující konverzace přes lokální Ollamu,
malá schválená změna s plánem/efektem/testem/diffem/auditem, negativní
cancel/error/recovery větev, spuštění specialisty a extension agenta, kontrola
schváleného learning itemu a model-discovery conditional journey. Artefakt musí
nést exact candidate/build identity a nulový neočekávaný egress.

## 5. Pozitivní a negativní test

**Pozitivní:** všechny položky povinné matice `ROADMAP.md §10` vrátí PASS nad
jediným čistým kandidátem a release artefaktem.

**Negativní:** validator odmítne alespoň dirty/mismatched candidate, BLOCKED či
NOT RUN required řádek, chybějící L0 důkaz, nepovolenou conditional plochu,
nepřipnutý model/GPU artefakt, neodpovídající build digest, neuzavřenou M5
bránu a self-asserted review/operator approval.

## 6. Implementační bloky

1. release baseline: PDF/export, orchestration a VRAM determinismus;
2. executable release manifest a přesné candidate/artifact bindingy;
3. server/WS/Studio + effect/approval/security/data/recovery journey;
4. specialist/agent/learning/RemoteCorePort/conditional journey;
5. upgrade a backup/restore round-trip;
6. sekvenční Ollama/GPU, performance, soak/nightly a resource budgety;
7. třináct content-addressed L0 evidence řádků a Gate 0 attestační řetěz;
8. nezávislý review packet a operátorské demo; tag/publish až samostatně.

## 7. Stop condition

Zastavit konkrétní efekt a eskalovat, pokud by vyžadoval změnu některého L0,
oslabení acceptance, nový veřejný connector, destruktivní historii/rotaci,
tag/publish/push, neodsouhlasené produktové chování nebo kolizi s cizím
writerem či GPU/Ollama procesem. Ostatní M6 bloky mohou pokračovat a blokovaná
položka zůstane pravdivě `BLOCKED`.

## 8. Přesné ověření

```bash
node scripts/validate-test-registry.js
npm run test:deterministic
node scripts/validate-m6-release.js
npm run gate0:validate-disposition
npm run gate0:validate-attestation
git diff --check
git status --short --branch
```

WP je implementačně hotový teprve po čistém fresh-clone kandidátu a kompletním
review packetu. `ACCEPTED` vyžaduje navíc reálné M5 operátorské podmínky,
nezávislé review a demo; `BLOCKED`, `NOT RUN` ani předpokládaný budoucí PASS se
nepočítá.

## 9. Implementační closeout 2026-08-27

Níže uvedený closeout je historický dílčí důkaz, nikoli aktuální technical
verdict. Operátorský review prokázal, že locked set vynechal 58 ACTIVE+required
programů a finální validator mohl přijmout self-asserted ignorovaný JSON.
Aktuální stav je proto `TECHNICAL_REVIEW_CHANGES_REQUESTED`; 311/311 zůstává
pravdivým výsledkem pouze vybraného podsetu.

- exact product candidate: `8abd6065bd614a15bf9f7814dea14ed1e040c616`;
- candidate tree: `f41a6af70b29d9024ba1006aabe417aad2ff26aa`;
- registry: 464 programů, fingerprint
  `3593af7c529d73c15cc3f12ee7e4e90fd2de91e6b383313ac43bca46969ea342`;
- locked execution: 311/311 required výsledků PASS přes deterministic, owned
  server, controlled soak, detached fresh clone a fyzický GPU pilot;
- L0: 13/13 PASS; conditional model-discovery journey: PASS;
- release artifact: 7 content-addressed build souborů, exact candidate binding;
- validator: `valid: true / verdict: BLOCKED / exitCode: 2`, bez errors;
- productové review: `PENDING`; M5 acceptance, Gate 0 a operator demo:
  `BLOCKED` na externí autoritě.

Autoritativní implementační report je
[`m6-integration-closeout-20260827.md`](../execution/runs/m6-integration-closeout-20260827.md)
a přesná review jednotka je
[`2026-08-27-M6-OPERATOR-REVIEW-PACKET.md`](../review/2026-08-27-M6-OPERATOR-REVIEW-PACKET.md).
Tento zápis není self-issued `REVIEW_PASSED` ani release approval.

## 10. Remediation progress po review

Implementované, ale zatím znovu nezreviewované bloky:

- Git-native raw evidence a exact artifact/receipt re-evaluation;
- množinově úplný plán všech `ACTIVE + required` programů;
- sedmifázový plan v6 s exact runner-owned server authority pro devět
  historických live-server consumer journeys, exact toolchain preflightem a
  fail-fast po prvním required non-PASS (Decision 040);
- skutečný persistentní application upgrade 136.0.0 → 136.1.0;
- upgrade receipt v3 váže přesný inode/device stejného SQLite souboru,
  migrační počty 56 → 87, celý canary a skutečný `lo`-only network namespace;
- L0-11 durable model artifact authority podle Decision 037.

L0-11 current-snapshot evidence na `12b63e58` tvoří 11/11 durable
adversariálních checks, 27/27 model-use, 8/8 VRAM, 109/109 binding application,
15/15 current registry, 7/7 gateway signal a 55/55 schema. Registrovaný audit
má 7/7 programů PASS; support audit má artifact 158/158 a ratchet 13/13 PASS.
Výsledek je `RE_REVIEW_REQUIRED`, nikoli L0-11 acceptance.
Integrované schéma má 158 tabulek / 87 migrací a registr 465 programů, z toho
371 ACTIVE a 366 `ACTIVE + required`. Registry nyní fail-closed zakazuje required external
program, který committed runner musí vždy hard-blockovat; přesná disposition je
v Decision 039.
Původních třináct false-soak ACTIVE položek je překlasifikovaných podle
skutečného runtime. Nové 24h a pětiminutové throughput programy běží nad owned
production serverem v loopback-only Linux namespace; jejich zkrácené sondy
prošly, ale jsou explicitně `DEV_ONLY` a release evidence je odmítá. Skutečný
24h soak i plný maximum-throughput následně prošly na exact source `193e2351`;
původní společný wrapper zůstává pravdivě FAIL po host suspendu a oba výsledky
čekají na review. Exact současný evidence HEAD `05803dad` má nový úplný
deterministický běh 352/352 PASS. Unified frozen candidate report a
operátorský re-review jsou stále otevřené. Stav proto zůstává
`TECHNICAL_REVIEW_CHANGES_REQUESTED / ACCEPTANCE_BLOCKED`.

## 11. Decision 041 second re-review remediation

Exact candidate `75498c69` dostal `CHANGES_REQUIRED`, přestože jeho focused
programy byly `375/375 PASS`. Commit `8632c490` uzavírá reprodukované raw-byte
a Git-history vady: SQLite authority načítá exact BLOB bytes; release verifier
prochází každý commit a diff vůči každému parentu, zakazuje merge a ověřuje
samostatně candidate→receipt evidence HEAD; všechny Git read cesty vypínají a
odmítají replacement metadata a skryté index flags.

Skutečný temp-Git E2E sestaví validní 13-receipt bundle a získá PASS ze
standalone verifieru. Mutace `src/server.js`, následný signed receipt a revert
vrátí FAIL v bundle CLI i plném release CLI. Focused a structural matice je
`382/382 PASS`, registry zůstává 471 / `ffb7110746…`. Třetí nezávislý review
kandidatu `37edf30d` skončil `REVIEW_PASSED` a samostatně autorizovaná
ceremonie 2026-08-29 připnula čtyři produkční veřejné klíče. Protože trust
store a M5-R19 oracle mění produktové bytes, nový candidate vyžaduje úzký
re-review. M5 i M6 zůstávají acceptance-blocked na skutečných receipts a
zbývající release/runtime evidence.

## 12. Úzký ceremony/M5-R19 re-review a worker correction 2026-08-29

Candidate `d81be45f` dostal `CHANGES_REQUIRED`. Deklarovaných `402/402` kontrol,
registry 471, trust store i privacy scan byly nezávisle reprodukované, ale M5-R19
opravil pouze model-failover test. Autoritativní
`M6_CURRENT_VERSION_MIGRATION_COUNT` zůstal 79 a skutečný loopback-only
136.0.0→136.1.0 upgrade selhal po aplikaci 80 migrací přesně `80 !== 79`.
Kontrakt, runtime/technical fixture a tento WP byly na tomto kandidátu
sjednocené na 80; historický 79-migration receipt a staré review pakety se
nepřepisují a nejsou evidencí nového kandidáta. Modelová integrace následně
přidala sedm migrací a první dva M7 persistence bloky další dvě, takže současný
společný candidate používá 89. Rychlý test odmítá jakýkoliv další rozdíl mezi
kontraktem a migration setem.

Plošný shell, který spouštěl všechny `tests/*m6*` s libovolným 300s timeoutem a
bez `pipefail`, byl zastaven. Zabil 24h soak po pěti minutách a zkracoval přesně
pětiminutový throughput, takže nemohl vytvořit release evidence. Další běhy musí
použít locked registry/runner, přesný timeout a zachovat úplný exit/verdict.

Custody zůstává blokující: čtyři nešifrované privátní klíče jsou na stejném
trvale připojeném `/home` svazku pod účtem aplikace/workerů. Žádný receipt se
nesmí podepsat, dokud nejsou stejné keypairy přesunuty do skutečně offline
úložiště a reviewer key nemá oddělenou custody. Přesun stávajících keypairů
nemění product bytes; regenerace klíčů ano.

## 13. Model-evaluation integration checkpoint 2026-08-29

Accepted exact-artifact model evaluation is integrated into the M6 line at
merge `ff9a7dfc`; exact product candidate `73385eeb` includes the reviewed
M5-R19 ancestry and binds the application-upgrade contract to the integrated
87-migration set. A dedicated detached checkout reproduced the focused release
boundary `298/298 PASS` and one continuous offline+database registry gate
`303/303 PASS`, with identical start/end candidate SHA and zero non-PASS rows.

This closes the deterministic integration implementation only. Live Ollama
chat/model-quality and physical GPU evidence remain
`DEFERRED_MODEL_OPTIMIZATION`; key custody, M5 receipts, 24h soak, full
throughput, independent review, operator demo and Gate 0 remain blocking.
Exact commands, identities and digests are recorded in
[`m6-model-evaluation-integration-20260829.md`](../execution/runs/m6/m6-model-evaluation-integration-20260829.md).

## 14. Operator-demo authority integration

Fail-closed operator-demo plan/observation runner je připraven v
[`WP-M6-OPERATOR-DEMO-PREP.md`](WP-M6-OPERATOR-DEMO-PREP.md). Jde o
`IMPLEMENTATION_GREEN / REVIEW_PENDING` na exact candidatu `d71ac77a`.
Focused hranice prošla `301/301` a po opravě stale registry policy pinu prošel
jeden souvislý offline+database gate `304/304`. Runner nemá approval mód a
finální signed-authority verifier znovu validuje committed observation i raw
artefakty. Skutečné demo nebylo spuštěno a approval nebyl vydán. Integrace proto
nemění žádný M6 acceptance verdict ani otevřený externí blocker výše. Přesné
SHA, diagnostický FAIL a opravený PASS jsou v
[`m6-operator-demo-authority-integration-20260829.md`](../execution/runs/m6/m6-operator-demo-authority-integration-20260829.md).

**Dokončený provozní checkpoint 12:38–12:42 UTC:** druhý terminálový pokus
úspěšně aktivoval přesný systémový provider bez změny target inode/bytes
nebo devítimodelového inventáře. Nezávislé health review prošlo. Dvě následné
řízené chat operace na clean `ceb8de93` prokázaly exact response digest a
usage/durable claims v soukromé DB; nezávislé evidence review prošlo. Aktuálně
`ACTIVATION_HEALTH_REVIEW_PASSED / CONTROLLED_GATEWAY_REVIEW_PASSED`.
Historické auth/version/Node ABI neúspěchy zůstávají v run evidenci; nejsou
aktuálním blokátorem této kvalifikace. Celá M6 matice/acceptance zůstává otevřená.

Navazující registrované běhy na clean `ceb8de93` prošly nezávislým review:
GPU pilot PASS (4 requests, plná GPU residency, cancel, přirozená obnova)
a pipeline program 17/17 PASS (2 skutečné provider inference, zbývající
workflow/role kroky jsou stavové fixture). Přesné hashe a hranice obsahuje
stejný run/review záznam; celý M6 release gate tím není uzavřený.

## ROOT follow-up: current109 upgrade fixture, 5. 10. 2026

Současná autorita operátora dovoluje ROOT dokončení produktu, commit/push a izolované testy.
ROOT v work/real-chat-journeys-20260930 přebírá pouze tests/m6-previous-version-upgrade.e2e.js
a přímo navázané současné report/WP/census řádky. Původní writer i historické větve/evidence zůstávají.
M5/M6 podpisy, key custody, acceptance a produkční nasazení se tím nemění.

Own offline previous-lock cache:220/220 SRI PASS, SQL prebuild ABI137 PASS; nativebootstrap
receipt59aee897…559a41. První actual109 test skončil FAIL/previousreadiness po97,5s;
receipt636ac164…efc05c, diagnosis34bdaa95…9cac5b. Canary/migration/backup checks NOT_REACHED.
Předchozí d3d zdroj čte C3_PORT_FILE/DB_PATH/PROJECTS_DIR, současný test posílal moderní INTENTSMITH názvy.
ROOT adoptoval přesný test8e22907dfdd600f874082a939fc53d43308eb1ac115aae76c4e0a3547645feb0:
13 explicitních legacy aliases pouze pro ownpreviousclone+exactpreviousSHA; currentENV,
nonce/capability/PID/loopbacknamespace/56→109/canary/sameDB/rollback oracle zachované.
Nový bounded private journal před cleanup uchová portfile4096B/stdout/stderr tails0600; tiskne jen artifactpath.
Manifest4fa2c1fb…9805c/18members a CPU-V2 actual12/12 PASS; původní checker syntaxFAIL zachovaný.
ROOT manifest/syntax/diff kontrola PASS; společné CODE+M6 bounded review PASS bez findings,
JOINT-REVIEW c735179f25c9dbddbe366731b4f91d86bd74605c02ae278c63af2fe4b77f0b22,
M6-REVIEW 7b26ee66946766e23cf8d041372ae8e6c1d060ea4b9b97f5d49cb54a398c9cf4.
Teprve nový clean/published source+CI/inputfreeze dovolí jediný další actual109; první FAIL se nepřepisuje.

### Produktová metadata kompatibilita — CPU checkpoint 5. 10., 02:24 UTC

Actual retry na `0be289d5` skončil za7,918s; receipt9d22fde9…386e8,
diagnosis608d2f68…5004. Previous install/readiness/canary/count56, úmyslný
upgrade collision a exactbackuprestore56 prošly. CurrentAPIcanary také prošla,
ale kontrola metadata skončila ENOENT: immutablepreviousd3d zapisuje `.c3/project.json`.
Finalcount109/sameDBinode nebyly dosaženy. Historický FAIL zůstává beze změny.

ROOT přebírá omezený produktový port `src/planner/project-onboarding.js` a jeho
tři přímé readery v `src/server.js`, `src/planner/lifecycle-analyzer.js` a
`src/chat/handlers/utils/project-state-reader.js`, plus existující welcome/upgrade testy.
Poslední cesta mění pouze čtení projektových metadat; konverzační ladění má jiný worker.
Žádný migration writer, přejmenování souborů, model activation, mobil nebo deploy.
Source `413917e286d7d785f65ce92b154545990bd6703e`: sharedread-onlyport vybere
legacy pouze při skutečné absenci canonical. Invalid/unreadable/unsafe canonical
nesmí legacy obejít. FatalUTF8, byte/character caps, fd-pinned read, hardlink/symlink
odmítnutí a observedpath/hash/devino zachované; existující ABA/root limity se nemění.
Upgrade oracle navíc ověřuje původní rawlegacybytes/path/hash/devino před a po,
DB56→109/canary/backupfailedrestore/sameDB/nonce/capability/cleanup zůstávají.
Manifest03b8917a…2e09, CPU50/50 PASS; independent source review
`d66e6b2c3545b0fdd3eac8d2ec839a020bbf00a3f48a4760d00d6a032849455c` PASS bez findings.
Tři konkrétní reader→port edges přidávají1507→1510; žádný nový cyklus nebo člen.
Po společném publish/remote/CI a immutable inputfreeze ROOT provede jediný nový
izolovaný actual109 gate, max600s. Aktuálně `NOT_RUN`; source/CPU PASS není upgrade PASS.
Úzké adoption/baseline/export review `d7671f03e3ce71ecc2e6ecb1ba772fc47cd1283c92ff3566d2f352fc3ed9b361`
PASS: šest source hashů exact, +3/−0 edges/1510/3/28, provenance2d145220, HTTP export4/4 +API exact.

Cílený společný profil na387be88f:7/7 PASS (welcome/sharedcontext/boundary/ratchet/artifacts),
reportSHA `e4bdd295860f866ba7da88c8e20d609d7722ee8c56f8b5e2e025033bc8f249d2`. CI zachovává CHAT7 a přidává welcome do CODE12.

### Actual109 přijatý dílčí milník, 5. 10. 2026, 02:43 UTC

Candidate `ad93ec63c22078015319cf64996a072acac3744d`, remote exact,
[CI37255445247](https://github.com/Belphareon-bak/intentsmith/actions/runs/37255445247) všech18SUCCESS.
Celý offline/database profil02:33:11–02:42:47 UTC:410PASS/0FAIL/BLOCKED/TIMEOUT,
report `eeedf1e511afb1ba2101dce437365eb474819c74deaaac17e5efce198b4b0fd8`.
Dvě původní ROOT config/interrupt FAIL zachované; explicit Node24/PDF/OCR preflight4/4 PASS.

Jediný physical gate9,660548737s / exit0 / beztimeoutu: previousd3d install offline,
readiness/canary/API/count56 → forcedcollision/count80/exit1 → exactbackuprestore56
→ current136.1.0API/canary/metadata → count109 na stejném restoredSQLiteinode.
Původních180B `.c3/project.json` bytes/path/hash/devino přežilo beze změny.
Raw before marker je uložený; raw after samostatně ne, prošly přesné literal assertions
v připnuté fixture84e960a4…439e a skutečný produktový sharedreader.
Runtime receipt je M6PreviousVersionUpgradeReceipt@3; wrapper receipt
`4cc8b7f89323352960adafe9c834f31b20ceaf6a91f7c24949223dad24a6d547`,
actualmanifest `1cf3955bbd63bc00c0c6687b773ff6779b8d5503eb687894e6f3598a990debbd`.
Independent final review
`82b6dd0a291a941a56f3b99a3210526b54b70a4cf8ba099074aaac20175ca884`
**ACTUAL_UPGRADE_ACCEPTANCE_REVIEW_PASS**, n=1/ad93; manifestf59964d7…1ef64.
15/15actualmembers,220offlineblobs,3283tracked/6181deps/14links independently ověřené.
11observedownPIDů+launcher absent, canarytemp deleted, group0/noforcedkill;
cache1debuglog added/0changed/0removed, zdroje/deps původní, předchozíFAIL unchanged.

Tento unsigned scoped proof nepřijímá M5/M6/release, nepokrývá fullrestore109,
fresh install/renderer/Electron build, soak/throughput, signed key/history/privacy/demo/Gate0.
Další příprava: current lock158/158 content+SQLprebuild v nové owncache; install NOT_RUN.
Původní previouscache220 i sharedcache zůstaly nezměněné (copy-only/read-only zdroje).
RO inventory731524a5…26b0c a copyreceipt4a54ecc0…2fb75e evidují rozsah;
Yarn/Electron/headers pins a skutečný registeredfreshgate zbývají.


### První skutečný fresh install, 5. 10. 2026, 03:47 UTC

Candidate42b3fcf1/current remote/CI18PASS; immutable vlastní cache closure35587 members,
manifest88e4d088…b7b28 / copyreceipt4bd79e47…8d2679. Žádné shared cache writes.
Existing registered runFreshClonePhase běžel v own HOME/5cache paths, user/netnamespace,
--profile=core --minimal --offline. Start03:27:51.821633UTC, end03:28:29.910742UTC,
38,08948559s/exit1, bez TERM/KILL. HEAD v čerstvém clone správný.
Backend npmci/better-sqlite3 native, frozen Yarn install4,52s, Electron native rebuild
prošly; Studio production build skončil DNS chybou. Následných5 registered programů NOT_RUN.
Původní3430 B install log a689 B wrapper log zůstávají; install.sh tail-8 usekl hostname.
Nezávislý review2dbac0d1c98f93f4f816943858e32298934202343d199d885b1ab683727f63a3 /
manifestcd2cb8786f37d1fc735ecd5d33d15f1aa7b165d146373d961c64a748b422353b
potvrzuje skutečný FAIL, clone/PID cleanup a sourceclean. Příčina konkrétní DNS žádosti
je source inference: Theia prepareElectron→replaceFfmpeg→nested @electron/get2;
owned cache má Electron ZIP, ale chybí FFmpeg ZIP a SHASUMS. Není živý network capture.

Existing makeFreshCloneEnvironment už kopíruje electron_config_cache do XDG_CACHE_HOME/electron,
kde get2 Cache hledá archive/checksums. TMPDIR/theia-cli je až extracted library cache.
Nejmenší náprava: nový vlastní cache subset s původním Electron ZIP a2 přesně vázanými soubory:
ffmpeg-v42.11.3-linux-x64.zip /1459395 B /
05b10c9d074423946a20690ede8afb11c73ba8b8750989ddec56aca4b3dc23db;
SHASUMS256.txt /7680 B /a2fa201ef93fcc3f3454692ca561e05b396212add1a137554c087f126c5ce853.
Checksum row odpovídá ZIPům. Původní cache/receipt a skutečný FAIL neměnit.
Žádný public runner patch, download/networkfallback/TMP injection/skipchecksum.
Po CPU cache resolver review a exact candidate/CI/cache freeze jediný nový registered fresh pokus.
Full109 standalone backup/restore zůstává PLAN1101617a…7b8d8 / NOT_RUN; M5/M6 nejsou přijaté.

### Navazující omezené vlastnictví obnovy, 5. 10. 2026

Vstup `0d8edd99`; ROOT vlastní `src/core/db-backup.js` a `tests/m5-data-restore.test.js`.
Důvod: skutečný full109 odhalil, že readonly SQLite validace přidává WAL/SHM do V2 archivu.
Rozsah: výhradní validační kopie mimo archiv, bytes/SHA vazba obou kopií na manifest,
cleanup vlastní main/WAL/SHM s konkrétní chybou, zachované native/schema a public return/wire.
Ověření: readonly WAL archiv a opakovaná obnova/reuse beze změny; poškozená kopie a copy failure,
existující datové sady a jeden zmrazený full109 max180 s/model0 na nové vlastní DB, stejný oracle.
Navázaný harness `tests/m1-journey.test.js`: pouze oprava skutečně emitovaného počtu29→74.
CHAT logika, model activation, mobil, produkční deploy a signed acceptance jsou mimo tuto opravu.
Stav a datované důkazy jsou v `WORK-PROGRESS.md`, ROADMAP a inventuře #1.

### Uzavřená data remediation, 5. 10. 2026, 05:25 UTC

Publikovaný `86dbca40`, CI37264792541 všech18 SUCCESS; celý offline/database profil410/410,
report `a5a2f4a38cd5054d4e4e994aaad9d633fb5fd2949a6cc769e41423cfd326d11c`.
Nativní datová sada24/24 a M1 kontrakt74/74, nezávislé ověření celého profilu PASS.
První full1090d8 selhal produktově na archive WAL/SHM; druhý86db zachoval přesné bytes/archiv,
ale selhal v harnessu na běžné změně project.last_active při startup discovery. Oba FAIL nezměněné.
Úzká private harness oprava CPU12 a review44cbf93b…92795 zachovává PLAN1101617a…7b8d8:
raw API after před assert; všechna pole přesná kromě canonical/nondecreasing last_active
ve skutečně měřeném start/readiness okně. Není změnou produktu/oracle/modelových parametrů.
Jediný nový actual05:18:36–05:19:09 UTC/33,149704 s/model0 prošel; receipt
`d215cd75847dacb21fcd9e35e5bd7ac3e873d3118487705752d5cbf35d774e79`.
Independent review `493a5b69e6a79aec6db143155520952e46a07e251966b2d6ba06fee21bf7bdf4`
**FULL109_DATABASE_ROUNDTRIP_ACCEPTANCE_REVIEW_PASS**:34 členů/20 freeze refs/current closure,
přesné before-reopen DB/safety bytes, původní obsah/metadata, dva marker404, exact109/schema/quick/FK,
archiv82 files/81 payload beze změny a bez sidecars, čistý konec own procesů/source/deps/refs.
Scope n=1 DB-only na86db; nepřijímá generated app/project/config/skills restore ani signed M5/M6/release.
Stávající fresh install/build0d8 review PASS; zbývá celý fresh phase se všemi5 programy.
[Aktuální souhrn](../WORK-PROGRESS.md) určuje další pořadí; žádná další CODE inference bez rozhodnutí ke kroku7.

### Fresh5 uzavřený a omezená cache remediation,6. 10. 2026

Actual source90c17489,5. 10.06:23:03–06:28:46UTC/343,277s: všech5 registered programů.
PASS Electron boundary/Studio M1/Studio M2; FAIL M1 outage false-success a upgrade cache 0775 před DB.
ROOT receiptb00ca2c2…33cd0b/manifest39bf7a85…3bc3fc; independentd3ce667d…15354/4589b821…7c3d6:
FRESH5_3_PASS_2_FAIL_REVIEW_COMPLETE_NOT_ACCEPTED.1636 independent bytehashů +8cookie metadata-only.
10 dokončených exact-model odpovědí (4class/4answer/2summary),311 samples/275 full GPU/min 5 337 MiB.
178 lifetimes absent/0cleanup signals; unload/lease/failedclone cleanup potvrzené. Root closure po přerušení;
3 pozdější tracked změny nezávisle rekonstruované z Git90; historické bytes beze změny.
Adapter NOT_RUN je success-only counter, nikoli pravda o pěti skutečných bězích.
Clone uklizený před ROOT9buildhash capture; žádné nové install-only přijetí/release/wholeprofile.
M1 classifier zachytí typed PROVIDER_UNAVAILABLE a pokračuje fallbackem; přesný outagepayload/intent
před assert nezachovaný. CHAT vlastní jiný worker; doporučená propagation do stávajícího error mappingu.
Cache cp zachoval0775 při obou kopiích. Nový helper kontroluje private canonical owned parent/new target,
po cp jen own root 0700; source/cache bytes/nested execute modes beze změny, bootstrap nezměněný.
Behaviorální regresní test oba copy kroky,0775→0700,source/payload/mode preservation/missing source,
existing target/symlink target/parent;23/23CPU,registry 596 valid. Source review 69836bd2…350de0 PASS.
LOCAL-CHECKSb044ac1a…82623 zaznamenává tool výsledky, není raw-log ani reviewer rerun.
M1 nově uloží před stejnými assertions klientem UTF-8 decoded body/status/roles; žádný arbitrary wire proof.
Post-fix physical NOT_RUN. Po CHAT opravě společný freeze/CI/volná GPU a původní celá fresh5 sada;
žádná další V4–V7 monitor série ani změna oracle. M5 je 8/9; signed8 categories+history stále chybí,
retain_and_rotate zvolené; custodyA/B+stále druhá operator kopie a reviewer recovery. Online zdroje zachovat.
