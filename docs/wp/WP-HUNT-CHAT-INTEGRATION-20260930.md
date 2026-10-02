# GPU hunt + chat + Studio 2 — integrační kandidát

## Navazující integrační zadání ROOT — 2. 10. 2026

Autorita: doplňující nezávislý posudek předaný operátorem a jeho výslovný
pokyn převzít společnou integraci, CI a reprezentativní projektový průchod.
ROOT vlastní integraci ve stávajícím checkoutu `intentsmith-real-chat-journeys-20260930`;
žádný nový worktree. Vstupy: publikovaný nechatový `2a479852c8dffa672d03c56f3cef20e495289dcb`
a chatový `6f0259ec86054adb4076901c81ca7cf74fc7f370`, oba remote SHA ověřené.
Cizí chatový checkout je čistý a zůstává nedotčený. Ladění konverzace zůstává
jeho workerovi; tento WP přebírá publikovanou deltu a její otevřená selhání.

Zkušební merge má tři konflikty: `tests/registry.json`,
`docs/convergence/TEST-REGISTRY.md`, `tests/harness-exit-code.test.js`.
ROOT je vyřeší se zachováním kontrol obou stran; katalog regeneruje kanonickým
validátorem ze sloučeného registru. Další vlastněné integrační cesty:
`.github/workflows/ci.yml`, `ROADMAP.md`, `SYSTEM-MAP.md`, `docs/WORK-PROGRESS.md`.
Po prvním společném profilu přibírá ROOT také `README.md`: pouze počty
kanonického registru. Diagnostika CI smí upravit prostředí či izolaci testové
fixture; nesmí oslabit ochranu úplného souhrnu, uživatelské opravy nebo 413.
Konkrétní navázaná cesta `tests/m1-chat-contract.test.js`: pouze izolace
negativní kapacitní fixture jako plain conversation. Reprodukce ukázala,
že 30 B host tool facts přepne očekávaný recent-user guard na summary guard;
produktové chování zůstává fail-closed/provider0. Původní přesná aserce platí.
Workflow zachová oba push filtry a přidá skutečné registrované chatové sady,
jejich toolchain a uchování výsledků. Společný offline/database profil se
spustí na pojmenovaném kandidátu; známé FAIL/BLOCKED se neumlčí.

Navazující omezený scanner opraví doložené falešné dependency v komentářích/
řetězcích podle existujícího AST WP; nezakládá obecný framework. Větší projekt
naváže podle projektového WP s předem stanoveným oracle, kontextem a konečným
opravným rozpočtem. Review přijímá jednotlivé výsledky a jejich meze,
nikoli automaticky celý release. Produkční instalace, modelová aktivace,
M5/M6 a mobilní fyzická přejímka jsou oddělené.

Následující text uchovává historický integrační checkpoint ze září.

### Publikovaná archivní delta CHAT — 2. 10. 2026, 12:46 UTC

ROOT nalezl novější remote `00ec5b526c629f54dc897e9dbda4c67a1cd061f7`,
nad již sloučeným `6f0259ec`. Delta má 25 cest; jediný konflikt je přesná
graph baseline. Vstup ROOT `4fb800c51f16a06e69cd5510db4646cdfd1ca357`
zachovává CODE16k, všechny jeho kontroly a sedm veřejných fan qualification
cest. CHAT přidává právě store→archive-evidence-index; ROOT baseline 1497
se zachová a jediná nová hrana bude přijata oficiálním ratchetem nad čistým
merge source. Limity cyklů 3/28 se nezvyšují. Registry/workflow jsou byte exact.

CHAT delta nemění ProjectHandler ani CRE routování původních fan požadavků:
projektový D1 vstup zůstává blokovaný. Public CHAT report dál NO_GO /
REVIEW_PENDING; zděděné opravy a jeho historické FAILy nejsou release acceptance.
DPH routing handoff explicitně žádá ROOT o package/shared eligibility opravu;
tento konkrétní BE specialist scope je odlišený od ladění konverzace.

Čistý merge source `a60c1824a69c097ea5b21d22ae67420c0dd42317` přijal přesnou
archivní hranu oficiálním ratchetem: 1498, bez removed edge nebo nového cyklu.
Registry znovu regenerovaný ze sloučeného stromu: byte exact 594/35,
fingerprint `740d8d35cba4f6793c7972827a9d2bdbe5cf5577860fdf86a9da882b185a39a6`.
Celý profil proběhne na novém společném kandidátu po omezené eligibility
opravě, aby se neopakoval bez nové produktové změny.

Aktuální výsledky společného `d7e7d1b1`: úplný offline/database profil
401 PASS /2 FAIL /5 BLOCKED, žádné timeout/skipped. Po explicitním povolení
již dostupných nástrojů desktop-hunt a development-installation cíleně PASS.
Tři PDF/OCR BLOCKED zůstávají; druhý FAIL je cizí chatové routování
„Co je DPH v Německu?“ → vat_calculator/clarify, precision 83,3 %.
Artifact-validation měl pouze drift README/ROADMAP; oprava počtů 160/160 PASS.
CI `36993324070` má 6 CHAT PASS /1 M1 FAIL, downstream M2/Studio SKIPPED.
Řízená reprodukce ukázala host-dependent kapacitní fixture, ne chybějící
upload nebo oslabenou ochranu: plain-conversation fixture prošla 74/74
pod sedmi i jedenácti nástroji. Původní sourceErrorType CI nebyl zalogovaný;
reprodukce podporuje diagnózu, ne tvrzení o přečteném poli. Přesná aserce
RECENT_USER/413 a nulové provider volání zůstává. Nezávislá diagnóza SHA
`78f09945f40e806821a480551ecacbe3dfbe2cbb105ffa9c11d84ae01888bb35`.

Nové CI na `7afc96f2`, run `36995956642`: CHAT 7/7 PASS. Dvě M2 sady
selhaly před spuštěním aplikace na `bwrap: loopback: Failed RTM_NEWADDR`.
Raw ZIP SHA `99f6c8e7976d9f576b413f72663410d5cdbfc55ff244278ce63fb78a92cd94b7`
zůstává zachovaný. ROOT přibírá pouze CI namespace bootstrap podle
existujícího profilu v `docs/DESKTOP.md`: root-owned profil pro `/usr/bin/bwrap`,
bez vypnutí AppArmor, změny produktového sandboxu či sudo při aplikačních testech.
CI zaznamená kernel nastavení a skutečně vyzkouší namespace před testy.

**Stav:** SOURCE_MERGED_CANDIDATE / OFFLINE_FOCUSED_PASS / REVIEW_PENDING /
NOT_DEPLOYED / REAL_NO_GO. Tato pracovní větev vychází z chat/Studio 2 commitu
`09247504143ac0a37d75d7d52867768447790ad2` a slučuje přesný Hunt commit
`e37189b252a195f30e98b8f58ab25ec68dba7d85` se zachováním obou rodičů.
Žádný krok tohoto WP neotevírá GPU, Ollamu, živou DB, timer, instalovanou
službu ani modelové vazby. Zveřejnění větve není nezávislé přijetí kandidáta.

**Společná integrace, 30. 9. 2026, 20:07 UTC:** Hunt oprava `caf767bf` je
sloučená s chatovým zachováním celého souhrnu a testy správnosti hodnot v
`edc61a73` na `work/real-chat-journeys-20260930`. Registr má nyní 572
programů (`476 ACTIVE`, `81 BLOCKED`, `15 HISTORICAL`), module graph 1 460
hran, 3 cykly / 28 členů. Na tomto čistém SHA skončil celý offline/database
audit **398 PASS / 2 FAIL / 0 BLOCKED**: zastaralý počet hran v ROADMAP a
zapečetěná Gate 0 politika registru. ROADMAP je na `09e72b74` opravená a
cílená kontrola artefaktů prošla 160/160; celý audit po ní chybí. Nezávislé
review zjistilo neplatné `COMPLETE` v historii a detailu po odvolání přejímky.
Navazující review našlo stejný únik při změně názvu, verze nebo SHA sady a
bez aktuálního plánu. Izolovaná oprava blokuje i tyto historické sémantické
řádky, zachovává syrový auditní zápis odděleně a čeká na nové review.
Kandidát zůstává `REVIEW_PENDING / NOT_DEPLOYED /
REAL_NO_GO`.

## Vlastněný rozsah

- Sjednotit chatové skládání historie: archivní souhrn, uživatelské opravy,
  rozpočet okna, CODE retry a projektovou instrukci. Konflikt `decisions.js`
  je v integrovaném kandidátu vyřešen se zachováním celého souhrnu a
  předností nedávných uživatelských oprav.
- Převzít Hunt sběr, nezávislé dvojí známkování, arbitráž, rozhodovací metodu,
  plán/retenci a jejich zdrojová historická evidence. Schéma má migrace
  117, 118, 119 a 120 v tomto pořadí, celkem 107.
- Sloučit registr přes ID sad: 568 programů, 474 ACTIVE, 79 BLOCKED,
  15 HISTORICAL a 23 explicitních support vyloučení. Generovaný katalog
  vzniká kanonickým validátorem.
- Přenést dostupný detail uložených odpovědí a obou posudků do skutečného
  `intentsmith-studio2` modelového pracoviště a jeho prototypové šablony.
  Historický `chat-panel-module.js` zůstává odstraněný; historický simulační
  report si jeho tehdejší renderer připíná přes Git objekt Hunt commitu.

## Dosavadní důkazy v izolované větvi

| Kontrola | Výsledek | Meze |
|---|---|---|
| Chat contract | 36/36 PASS | deterministické scénáře |
| Migration schema | 61/61 PASS | nové dočasné DB, žádná živá DB |
| Model failover schema | 20/20 PASS | nové dočasné DB |
| Evaluation read model | 20/20 PASS | single-grader známka jen historická, aktuálně BLOCKED |
| Nové Hunt suite | 12/12 PASS | poslední úplná simulace trvala 116 s; bez inference |
| Studio 2 model workspace | 9/9 PASS | přesné ID detailu, transkript, dvě revize, rozsouzení, fail-closed odlišná identita |
| Detail uložených posudků | 24/24 grading acceptance, 21/21 read model, 9/9 Studio 2 PASS | `GET .../evaluations/:runId` nyní ověřuje oba append-only posudky a případné rozsouzení; zdrojový běh zůstává neměnný, skóre sporu je null až do ověřeného COMPLETE řádku; test Studia používá skutečný výstup read modelu |
| Studio 2 view | PASS | shoda generovaného rendereru s prototypem, scénáře a 3000 fuzz kroků |
| Desktop hunt | 34/34 PASS | Node 24 v `PATH`, lokální izolované závislosti |
| Module graph | 1459 hran, 3 cykly / 28 členů; ratchet PASS | 23 hran integračního merge `e20a7265` a další dvě hrany read modelu přijaty oficiálním nástrojem nad čistým zdrojem `8c64e427` |
| Celý offline/database profil | **399 PASS / 1 FAIL / 0 BLOCKED**, verdikt FAIL | sériový běh na čistém `4edd1be6`; jediný FAIL je neaktualizovaná zapečetěná Gate 0 politika registru; report `.intentsmith-artifacts/test-runs/hunt-chat-integration-serial-4edd1be6/report.json` |

## Neuzavřené brány

1. Původní zkrácení uloženého souhrnu je ve společném kandidátu odstraněno;
   nevejde-li se celý, cesta selže před voláním providera. M1 testy 42/42
   prošly. Skutečný živý modelový běh finálního SHA a nezávislé review
   společného konfliktu stále chybějí; nedávný příliš dlouhý uživatelský tah
   může být kvůli pevnému oknu zkrácen viditelným označením.
2. Sjednocený zdroj ani syntetická simulace nejsou důkazem aktuálních živých
   skóre. Poslední read-only kontrola instalovaného provideru uváděla 84/84
   použitelných model–role dvojic `MISSING`, žádné přijaté rozhodnutí.
   Druhý skutečný posudek a rozsouzení celé matice, kvalifikace hodnotitelů,
   rozhodovací holdout a provozní revize stále chybějí.
3. Celý offline/database profil na `4edd1be6` není zelený: 399/400 PASS,
   zapečetěná Gate 0 pečeť registru zůstává FAIL. Nezávislé zdrojové review
   nové projekce posudků a nové live acceptance se provádějí samostatně;
   celý profil po této opravě nebyl znovu spuštěn. Instalace a mobilní
   napojení nejsou součástí tohoto kandidáta.

**Předání:** [aktuální projektový checkpoint](../review/2026-09-30-COMPLETION-TRACKER.md)
uvádí samostatně tuto společnou integraci a starší checkpointy. Hunt matice a její přesné
hranice jsou v [matrici 28. 9.](../review/2026-09-28-HUNT-MATRIX-COMPLETION.md).
