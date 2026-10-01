# IntentSmith — průběžné dokončování od 30. 9. 2026

## Checkpoint 1. 10. 2026, 02:05 UTC — první fyzický účetní nález

Na čistém `84f22982` první fyzický M1 účetní test **FAIL**: jediný zachycený
provider požadavek na připnutý `qwen3.5:27b` měl `num_ctx=4096`, vstupních
1 118 tokenů, `num_predict=256` a terminál `done_reason=length`. Model
ukončil odpověď uprostřed povinného daňového disclaimeru. Backend správně
vrátil HTTP **502 `MODEL_RESPONSE_TRUNCATED`** a privátní SQLite ponechala
jen uživatelský tah, bez asistenčního textu. Doklad je soukromá capture
`.intentsmith-artifacts/direct-tests/chat-accountant-live.test-waYVes/artifacts/chat-accountant-live-provider.jsonl`;
nejde o přijatý živý účetní výsledek.

Úzká oprava v rozpracovaném integračním stromu nastavuje 512 výstupních
tokenů jen pro VAT wrapper; ostatní expertizy zůstávají na 256 a neúplný
terminál se dál odmítá. Řízený M1 provider red-first reprodukoval 502 při
starém limitu a po opravě prošel **2/2**. Významový VAT oracle také chybně
odmítal přesné číslo zákona z výsledku nástroje a dvě běžné varianty tučného
Markdown nadpisu; po cílených červených mutacích nyní prochází **40/40**
včetně tabulky, negace přes citaci a nesprávných částek. Sousední přímé
účetní/překladatelské/projektové sady prošly **49/49**. Tento patch ještě
čeká na čistý commit, nezávislé review a nový fyzický běh.

## Checkpoint 1. 10. 2026, 01:55 UTC — společný chat a veřejná hranice

Na čistém a pushnutém `5d72b4aa` doběhl úplný offline/database profil
**402/402 PASS, 0 FAIL/BLOCKED/TIMEOUT/SKIPPED** s přesně povolenými místními
toolchainy; report
`.intentsmith-artifacts/test-runs/2026-10-01T01-41-43-923Z/report.json`.
Pokryl nové offline orákulum účetního DPH, izolovaný 53případový runner a
dosavadní integrační zdroj. Fyzické modelové a release brány v něm nejsou.

Účetní live test má na izolovaném `80990a60` omezené nezávislé
`REVIEW_PASS`; přímé offline orákulum **38/38** a řízený M1/SQLite test
**2/2**. Na `5d72b4aa` jsou stejné bytes integrovány, ale fyzický modelový
běh ještě **LIVE_NOT_RUN**. 53případový korpus má na aktuálním runneru pouze
jednopřípadový fyzický pilot `http-plain` (`LIVE_COMPLETE_UNASSESSED`,
ručně správná dvouvětá odpověď); tři úplné nezměněné finální opakování jsou
**LIVE_NOT_RUN**. První infrastrukturální pilot selhal před providerem a je
výslovně `LIVE_ABORTED`, nikoli kvalita produktu.

Izolovaná oprava veřejné hranice specialisty `43130aa8` získala omezené
nezávislé `REVIEW_PASS`: reviewer zopakoval host throw s privátním markerem,
M1 HTTP/SQLite **5/5** a Sázení integraci **20/20**. Stejné produktové a
testové bytes jsou integrované v `1303535f`, zatím nenasazené. Na společném
stromu přímé specialistické HTTP testy prošly a přesně jedna nová hrana
`specialist.js → specialist-public.js` byla přijata přes module ratchet:
1 463 hran, 3 cykly / 28 členů, ratchet **13/13** a dokumentační validace
**160/160**. Celý profil po této produktové deltě se musí zopakovat.

Čerstvý M5 scanner na `5d72b4aa` našel v aktuálním stromu **0** nálezů
(3 065 cest / 1 333 přečtených souborů), ale **15/15** známých historických
objektů zůstává dosažitelných ze 341 refů; historie je deklarovaně
`retain_and_rotate`, ne uzavřená podepsaným receipt. Opravený počet 15 je
zaznamenaný ve WP, Decision 035 a action packetu; zářijových 13 je v nich
označeno jako tehdejší snímek. M5 stále postrádá osm category receipts,
history receipt a dokončenou offline custody. Signed authority verifier
vrací `BLOCKED / M6_RELEASE_EVIDENCE_NOT_FOUND` pro všech 13 požadovaných
release souborů. M6, produkční nasazení a mobilní M7 zůstávají otevřené.

## Checkpoint 1. 10. 2026, 01:03 UTC — úplný vývojový audit

Čistý a pushnutý integrační source `1f13b936` prošel úplným
offline/database profilem **400/400 PASS, 0 FAIL, 0 BLOCKED, 0 TIMEOUT**.
Přesně povolené lokální toolchainy zahrnuly i všech 13 dříve blokovaných
programů; report je
`.intentsmith-artifacts/test-runs/2026-10-01T00-53-01-193Z/report.json`
(registry fingerprint `233d99bb58b2cb64ec87288851d6704fa0d92cc3e6af9fbb1313bde35ecd7923`).
Oprava samokontroly `afb726fa` používá původní historický registr s pečetí
`162b890b…` a nemění produkční Gate 0 politiku. Profil neobsahuje fyzické
Ollama/GPU, čerstvý release kandidát, M5 custody ani nasazení.

Po integraci na společném zdroji prošly také registrované cílené sady
workeru **10/10** na `20792e81`, Sázení a návazných scénářů **6/6** na
`8bf1c069`, druhé kompakce a dokumentace **2/2** na `a1c151fa`.
IDE 2.0 produkční browser/node/Electron build a čtyři fyzické Electron sady
prošly na `8bf1c069` **4/4, 0 BLOCKED**; tento source není nasazený.
První fyzické naplnění okna, překladatel, projektová expertiza a přesné
hodnoty prošly na starším čistém `c815ec43`; po posledních produktových
opravách se živé scénáře mají opakovat na jediném finálním kandidátu.

Nezávislé review nového opt-in účetního live testu `afb73b05` nyní hlásí
**CHANGES_REQUIRED**: orákulum propouští současně správnou a chybnou částku
DPH v jedné větě. GPU běh se před opravou nespustil. Samostatně je otevřená
veřejná hranice vybraného specialisty: deterministická M1 metadata mohou
obsahovat syrový výsledek nástroje a Sázení může při chybě providera hlásit
`SUCCESS`; red-first oprava vzniká izolovaně. Strukturálně ověřený Hunt
packet je stále **596/1 173 / NO_DECISION**, bez aktuálního DB score.
Read-only instalovaná DB v 00:18 UTC měla **84/84 MISSING** a všech sedm
modelových vazeb `UNVERIFIED_RUNTIME`; hodnoticí sidecar `0.34.2-intentsmith.1`
se lišil od běžícího providera `0.34.0-intentsmith.1`.

## Checkpoint 1. 10. 2026, 01:00 UTC — integrační source `1f13b936`

Tento čistý, pushnutý source je **vývojový kandidát**, nikoli nasazený
backend/frontend ani M5/M6 release. Od checkpointu 00:23 integroval
reviewované opravy veřejné hranice specialistů (`b9b8738f`), recovery a
deduplikace M3 workeru (`20792e81`) a M1 cestu Sázkaře s kvalifikovanou
fixture (`8bf1c069`). Druhá kompakce zůstává integrovaná od `a1c151fa`.
Omezené nezávislé review před integrací prošlo pro specialistickou hranici,
worker a opravu původu Sázkařovy fixture; neznamená to přejímku jejich
sloučeného běhu. Poslední přesné registrované důkazy jsou specialistický
balík **7/7** na `b9b8738f`, worker **8/8** na `7373b44c`, Sázení **1/1** na
`676d6ab8` a druhá kompakce s dokumentací **2/2** na `a1c151fa`.
Sázkařova nabídka je **curated fixture, origin unverified**; její přesná
matematika dokládá testovaný transport, nikoli autentický dnešní veřejný kurz.

Registr `1f13b936` má **580 programů** (`483 ACTIVE`, `82 BLOCKED`,
`15 HISTORICAL`). Poslední dokončený celý offline/database běh na
`edc61a73` vybral **400** sad a skončil **399 PASS / 1 FAIL**; jediný FAIL
byl nesoulad vývojového registru se zapečetěnou Gate 0 politikou. Novější
`afb726fa` připnul self-test k historické pečeti, ale úplný profil na
`1f13b936` v tomto checkpointu ještě nemá výsledek. Historických
**353/353** z M6 release kandidáta není aktuální počet vývojových sad.

Hunt má nově integrovaný strukturální validátor druhého dávkového posudku
(`9b22f490`, zpřesněný `1f13b936`). Git manifest připíná raw SHA-256 přesně
**106** soukromých dávek. Reprodukovaný report uznal **596/1 173** odpovědí
a **2 324/3 689** kritérií; explicitně chybí **577** odpovědí a **1 365**
kritérií. Výsledek je `DEVELOPMENT_REVIEW_INCOMPLETE / NO_DECISION`,
`decisionAuthority:false`, `acceptedGrader:false`; validace struktury
neověřuje věcnou správnost známek. Poslední read-only stav instalované DB
z 1. 10. 00:18 UTC stále uváděl **84/84 MISSING**, **0** přijatých
rozhodnutí a sedm `UNVERIFIED_RUNTIME` vazeb; na source `1f13b936` nebylo
provedeno nové rozhodovací měření ani aktivace role.

IDE 2.0 build a čtyři fyzické Electron sady prošly **4/4** na dřívějším
`033afd47`; nový build ani fyzický UI běh na `1f13b936` zatím není doložen.
Poslední dokumentovaný instalovaný frontend je `fddfe996`, backend
`c84b88cd`; jejich aktuální identita se tímto source checkpointem znovu
neověřovala. Fyzický účetní model, širší spolehlivost backendu a mobilní
M7 integrace zůstávají otevřené. Mobilní propojení a úklid větví/worktree
navazují až po stabilizaci IDE/backendu a vlastnickém auditu důkazů.

## Checkpoint 1. 10. 2026, 00:23 UTC

Druhá skutečná auto-context kompakce přes restart a projekty A/B je
integrovaná jako `a1c151fa`. Přísnější negativní orákula získala nezávislé
omezené `REVIEW_PASS` na izolovaném `73345875`; na čistém sloučeném SHA
prošly registrované sady kompakce a dokumentace **2/2**
(`.intentsmith-artifacts/test-runs/2026-10-01T00-19-00-493Z/report.json`).
To ověřuje řízený HTTP/SQLite tok a sumarizační provider prompty; fyzická
kvalita druhého souhrnu je stále `LIVE_NOT_RUN`.

Revize opravy účetního `12b7726a` zůstává `CHANGES_REQUIRED`: i po
úspěšném účtování mohl generativní wrapper při provider 503 vrátit raw JSON
jako HTTP 200/SUCCESS. Úspěšný překlad navíc opakoval původní vstup ve
veřejných `toolResults`. Oba nedostatky reprodukovaly nové červené M1
HTTP/SQLite testy. Lokální oprava nyní dává terminální 503/502 bez uložené
asistenční odpovědi, zatímco interní provider prompt zachovává celý nástrojový
výsledek; přímé testy překladatele **3/3** a účetního **2/2** procházejí.
Čistý commit, registrovaný běh a nezávislá revize této delty ještě chybí.

## Checkpoint 1. 10. 2026, 00:17 UTC

Integrovaný účetní kandidát `033afd47` na čistém pushnutém stromu prošel
registrovanými sadami účetního/překladatele/followupu **3/3** a artifact/M1
**2/2**. Následné nezávislé review ale správně vrátilo
`CHANGES_REQUIRED`: fail-closed dokumentový nástroj mohl spustit modelový
fallback a obecné veřejné `extractedParams` mohly odhalit celé zadání.
Reprodukce na skutečném M1 HTTP/SQLite vrátila HTTP 500 po jednom provider
volání, nikoli falešné `SUCCESS`. Lokální oprava vrací typované `FAILED`
bez modelu, filtruje veřejné parametry na čtyři skaláry VAT a má přímé
účetní testy **2/2**, navazující specialistické **3/3**, M1 i artifact
validaci PASS. Čistý commit, registrovaný běh a nezávislá revize nové delty
ještě chybí; přijetí účetního milníku je proto otevřené.

IDE 2.0 produkční browser/node/Electron build na čistém `033afd47` prošel;
fyzické Electron sady boundary, M1 journey, M2 composer a exkluzivní Studio
UI mají **4/4 PASS, 0 BLOCKED**
(`.intentsmith-artifacts/test-runs/2026-10-01T00-02-01-374Z/report.json`).
Backend ani frontend z tohoto kandidáta nebyly nasazeny. Izolovaná druhá
kompakce `73345875` po opravě negativních orákul získala omezené
`REVIEW_PASS` a registrovaně prošla **1/1**; worker crash/recovery
`7373b44c` získal omezené `REVIEW_PASS` a registrovaně prošel **8/8**.
Oba kandidáty zatím čeká integrace do společného stromu a opakování.

## Checkpoint 1. 10. 2026, 00:00 UTC

Účetní `accountant-cz` má poprvé přesný test skutečné M1 HTTP/SQLite cesty
pro výslovně daný základ 10 000 Kč, sazbu 21 % a rok 2025. Izolovaný
kandidát `48364ff5` získal omezené `REVIEW_PASS` a byl sloučen jako
`8e52c69a`. Red-first odhalil ztracený `specialistTool`/`extractedParams`
v generativním wrapperu; další integrační aserce odhalila ztracený
`executionStatus`. Po doplnění všech tří údajů prošel přímý produktový test
**1/1**, M1 kontrakt **73/73**, překladatel **1/1** a specialistický
followup **1/1**. Dokumentační validace je **160/160** po přepočtu LOC.
Doplněk `executionStatus` čeká na novou nezávislou revizi a registrovaný
čistý běh; fyzický účetní model je stále `LIVE_NOT_RUN`. Veřejný rozsah
`extractedParams` se posoudí před mobilním kontraktem.

Test druhé kompakce `95590541` má **CHANGES_REQUIRED**: první zelená zkouška
nezaručila předání starší prose v souhrnu a nekontrolovala sumarizační
provider požadavky na cizí projektová data. Oprava negativních orákul běží
v izolované větvi. Worker crash/recovery `7373b44c` má red→green důkaz
skutečné duplicitní notifikace a nyní čeká na nezávislé DB review.

## Checkpoint 30. 9. 2026, 23:55 UTC (1. 10. v Praze)

Na čistém, vzdáleně ověřeném `c815ec435f69b4a52b30ab2f96da65136890d3c6`
prošly čtyři navazující fyzické chatové zkoušky s modelem
`qwen3.5:27b`, instalovaným digestem
`7653528ba5cba4dd8e19da24aaddc7f4d0b5ecd93571c0825dfd4137958ec06e`
a providerem `0.34.0-intentsmith.1`. Každá použila vlastní backend/SQLite,
GPU zámek a provider capture; model byl mezi běhy uvolněn. Jde o vývojové
živé důkazy, ne o release Gate 0 ani o potvrzení aktuálních Hunt vazeb.

- Registrovaná sada `IS-T3-E2E-85-LONG-SESSION-DEGRADATION` **PASS 1/1**,
  čtyři vnitřní kroky; report
  `.intentsmith-artifacts/run-suites/2026-09-30T23-43-46-670Z/report.json`.
  Captured provider **60** volání; okno **4096**, osm přesných hodnotových
  odpovědí jako holé JSON objekty **8/8**, první uložená kompakce v šestém
  tahu, původních 5 189 tokenů historie proti 2 888 efektivním po souhrnu.
  Finální prompt nemá surový první vstup a model odpověděl přesně
  `RIGEL_KAPPA_731` pouze ze souhrnu. Mechanismus i kvalita mají oddělené
  `PASS` v privátním `85-window-fill-evidence.json`; dřívější živý FAIL 3/8
  JSON a HTTP 502 je tímto na novém SHA opraven v měřeném scénáři.
- Vybraný překladatel přes M1, jeden dokončený modelový požadavek, správný
  výsledek a trvalý projektový stav: **PASS 1/1**,
  `.intentsmith-artifacts/direct-tests/chat-translator-live.test-RGxNY0/artifacts/chat-translator-live-evidence.json`.
- Kladný, záporný a nulový rozdíl s přesným JSON výsledkem: **PASS 3/3**
  uvnitř jedné opt-in sady,
  `.intentsmith-artifacts/direct-tests/chat-value-fidelity-live.test-3VhJuL/artifacts/chat-value-fidelity-live-evidence.json`.
- Přechod A→B→A mezi dvěma projekty, vlastní soubor/expertiza a trvalé zprávy:
  **PASS 1/1**, tři dokončená modelová volání,
  `.intentsmith-artifacts/direct-tests/chat-project-expertise-live.test-cJsULF/artifacts/chat-project-expertise-live-evidence.json`.

Tyto soukromé artefakty jsou mimo Git; zdroj a dokumentace jsou pushnuté.
Preflight připíná instalovaný digest, terminální odpověď modelu však nemusí
obsahovat samostatnou digest attestaci obsloužených bytů. Nové kandidátní
scénáře worker recovery, druhé kompakce a účetního běží v oddělených větvích;
jejich první vývojové výsledky nejsou dosud integrovanou přejímkou.

## Checkpoint 30. 9. 2026, 23:42 UTC (1. 10. v Praze)

Úplný offline/databázový audit na čistém `63dc55fb` doběhl s výsledkem
**398 PASS / 2 FAIL / 0 BLOCKED / 0 TIMEOUT**
(`.intentsmith-artifacts/test-runs/2026-09-30T23-33-20-098Z/report.json`).
Původně blokované toolchain sady v něm již prošly. Jeden FAIL je zastaralý
aktuální počet hran v `ROADMAP.md`: přesná přijatá baseline má **1 462**,
zatímco dokument psal 1 460. Opravený údaj prošel přímým
`artifact-validation` **160/160**. Druhý FAIL, `nightly-orchestrator-self-test`,
je nesoulad nového fingerprintu registru se zapečetěnou Gate 0 politikou;
nesmí se označit za PASS ani obejít běžnou úpravou testu. Gate 0 vyžaduje
samostatný release Work Package a nezávislou přejímku.

Read-only kontrola Huntu v 23:35 UTC nad instalovanou DB stále hlásí
**84/84 použitelných model–role dvojic MISSING**, 0 aktuálně přijatých
rozhodnutí a všech sedm vazeb `UNVERIFIED_RUNTIME`. Soukromý druhý posudek
obsahuje **596/1 173** odpovědí a **2 324/3 689** kritérií; lokální evaluator
neběží, případný vzdálený běh dosud není doložen. Instalovaná DB má migraci
120, ale postrádá schémata/stamps 118 a 119. Bezpečná kopie DB prošla
aplikací právě těchto dvou migrací, kontrolou integrity a cizích klíčů i
idempotentním opakováním; produkční DB zůstala beze změny. Vázání rolí a
aktivace modelů z této částečné matice nejsou oprávněné.

Pořadí dalších průchodů: živý test 85 na čistém integrovaném SHA; pak
překladatel a projektová expertiza s fyzickým modelem; řízený pád workeru,
druhá kompakce přes restart a chybějící doménové chatové scénáře; aktuální
produkční build a Electron; teprve po stabilizaci IDE/backendu mobilní M7.
Redukce větví a worktree zůstává posledním krokem po auditu jejich vlastníků
a dosažitelnosti důkazů.

## Checkpoint 30. 9. 2026, 23:32 UTC (1. 10. v Praze)

Integrační kandidát `d2591bc0` je čistě pushnutý. Oprava registrace nástrojů
překladatele získala omezené nezávislé `REVIEW_PASS`, po sloučení prošly
registrované sady překladatele, loaderu a provider capture **3/3**
(`.intentsmith-artifacts/run-suites/2026-09-30T23-20-37-258Z/report.json`).
Přísný JSON režim získal `REVIEW_PASS` na izolovaném `7234f55b`; společný
merge zachoval přepočet promptu po `done_reason=length` a má samostatný
nezávislý `REVIEW_PASS` na `d2591bc0`. Sedm registrovaných cílených sad
včetně M1 kontraktu, hodnotové věrnosti, modelové hranice a M6 plánu prošlo
**7/7** (`.intentsmith-artifacts/run-suites/2026-09-30T23-27-43-697Z/report.json`).
Další produktové HTTP/SQLite scénáře pro projektovou expertizu, specialistu,
ruční Project Health a automaticky plánovaný M3 worker prošly **4/4**
(`.intentsmith-artifacts/run-suites/2026-09-30T23-29-19-317Z/report.json`).
To je vývojový důkaz, nikoli Gate 0 ani živá modelová přejímka.

Úplný audit před těmito integracemi na čistém `55d37eaa` skončil **384 PASS /
3 FAIL / 13 BLOCKED**
(`.intentsmith-artifacts/test-runs/2026-09-30T23-11-21-495Z/report.json`).
Zastaralé literály M6 plánu 53/9 byly opraveny na skutečných 55/11 po
registraci dalších dvou scénářů; registrovaný M6 test prošel **1/1** na
`ede6a4f0`. Všech původně 13 blokovaných sad pak s přesně povolenými
místními toolchainy prošlo ve dvou oddělených bězích **10/10** a **3/3**
(`.intentsmith-artifacts/test-runs/2026-09-30T23-23-01-107Z/report.json`,
`.intentsmith-artifacts/test-runs/2026-09-30T23-23-59-135Z/report.json`).
Module ratchet na společném zdroji ohlásil dvě přesné nové vazby,
`runner.js → schema.js` a `decisions.js → auth-types.js`, bez nového cyklu.
Po omezených nezávislých revizích byl jejich přesný seznam přijat do baseline
z připnutého `d2591bc0`; přímý test ratchetu prošel **13/13**. Registr
současného kandidáta obsahuje **576** programů (`479 ACTIVE`, `82 BLOCKED`,
`15 HISTORICAL`), fingerprint
`d3c32dc80f2b1680439fea42c2f4f3be96447405ad119ca69408bb308d24432c`.
Nový úplný audit po commitu baseline a aktualizaci dokumentace ještě chybí;
zapečetěná Gate 0 politika registru dosud odmítá změněný fingerprint.

Skutečný `qwen3.5:27b` průchod okna 4K, živý překlad a nový fyzický
Electron/build na konečném SHA jsou **LIVE_NOT_RUN / NOT_RUN**. Kandidát stále
není nasazený: běžící backend je `c84b88cd`, instalovaný frontend `fddfe996`.
Integrační frontend zachovává schválenou paletu B, ale proti instalované verzi
obsahuje čtyři změny zobrazení detailu měření modelů; starší historická věta
o byte shodě proto neplatí pro dnešní HEAD. Mobilní M7 a redukce větví/worktree
zůstávají v dohodnutém pořadí až za přejímkou IDE/backendu.

## Checkpoint 23:03 UTC

Plánovaný M3 produktový kandidát po opravě produkční hranice získal omezené
nezávislé review produktové a bezpečnostní části. Jeho jediný zbývající
nález, nesprávný `SYSTEM-MAP.md` census, byl opraven a nezávisle přepočten
na **677/232 563** zdrojových a **572/258 048** testových `.js` souborů/řádků
v kombinovaném stromu. Zdroj je integrován na `9f07fe7b`. Registrované
sady plánovače, ručního produkčního HTTP průchodu a automatického intervalu
prošly na tomto SHA **3/3**
(`.intentsmith-artifacts/run-suites/2026-09-30T23-02-42-513Z/report.json`,
`gateEvidence:false`). První integrační pokus **FAIL 3/3** byl chybou
spouštěcího `PATH`: podřízené testy použily Node 22 proti nativnímu
`better-sqlite3` sestavenému pro Node 24. Po přepnutí celého `PATH` na
Node 24 prošel stejný registrovaný výběr; nejde o tiché smazání původního
reportu. Produkční autentizace a plánovaný běh zůstávají dvěma oddělenými
důkazy. Backend není nasazený a tato změna není release přejímka.

## Historický checkpoint 22:56 UTC

Integrační větev je čistě publikovaná na `658ba911`; nenasazený backend
zůstává starší `c84b88cd`. Dva navazující izolované kandidáty ještě nelze
přijmout. Přísný JSON režim na `0785ac1c` v reálném provider-body průchodu
chybně povýšil citovanou větu za výstupní pokyn (`format=json`); nezávislé
review je **CHANGES_REQUIRED** a probíhá oprava s negativními případy.
Plánovaný M3 produktový scénář na `fbab2281` prošel registrovaně **3/3**,
ale testovací přesměrování důvěryhodných manifestů bylo dostupné i při
`NODE_ENV=production`; nezávislé review je **CHANGES_REQUIRED** a oprava
odděluje testovací rozvrh od produkční autentizace. Obě čísla jsou vývojové
důkazy původních kandidátů, nikoli přejímka oprav.

Read-only Hunt report v 22:36 UTC nad instalovanou DB a providerem
`0.34.2-intentsmith.1` opět uvádí **84/84** použitelných model–role dvojic
`MISSING`, **0** přijatých rozhodnutí a `UNVERIFIED_RUNTIME` bindingy.
Kontrola druhého posudku našla 106 dávkových JSONů, **596/1 173** různých
odpovědí a **2 324** kritérií; D1 má 166/180, D2/R1/R2 dosud žádné. Jde o
vývojový částečný posudek, bez kanonické úplné validace a bez rozhodovací
autority. `PROGRESS.md` v soukromém důkazním adresáři uvádí zastaralý konec
D1 na indexu 558; skutečně dodané dávky končí na 595. Lokální inventář
ukazuje **46 worktree**, z nichž rozpočtový skript označuje právě jednu za
bezpečně odstranitelnou; vlastní redukce počká na závěrečný audit vlastníků,
důkazů a dosažitelnosti commitů.

## Historický checkpoint 22:38 UTC

Chatový `length` retry `22c369c3` získal nezávislé omezené `REVIEW_PASS` a
je integrovaný jako `0e0f48be`. Opravné CODE požadavky v plném 4K okně nyní
znovu rozpočtují volitelnou historii a dostávají odlišnou úspornější
systémovou instrukci; úplný souhrn, aktuální dotaz a krátká poslední
uživatelská oprava zůstávají chráněné. Registrovaná M1 sada na čistém
integračním SHA prošla **1/1**, uvnitř **49/49**
(`.intentsmith-artifacts/run-suites/2026-09-30T22-38-34-364Z/report.json`).
Skutečný modelový výsledek opravy je **LIVE_NOT_RUN**; společný běh sady 85
se zopakuje po integraci formátové opravy JSON. Jeden přímý modelový
`chat-pipeline` pokus bez GPU lease skončil **50/52** a není důkazem
akceptace. Aktuální read-only Hunt report v 22:36 UTC nad instalovanou DB
opět uvádí **84/84** použitelných dvojic `MISSING`, **0** přijatých
rozhodnutí a `UNVERIFIED_RUNTIME` bindingy.

## Historický checkpoint 22:32 UTC

Oprava splatnosti a validního plánu M3 workeru `6be426aa` získala po
remediaci nálezu cron preview omezené nezávislé **REVIEW_PASS**. Integrační
commity `cde6c2e7` + `08719686` prošly na čistém společném SHA registrovaně
**4/4** (`.intentsmith-artifacts/run-suites/2026-09-30T22-31-54-367Z/report.json`).
Změna profilu registru má nový fingerprint
`3e537b30b9893274c0fe53d3551e770c870ad4fa7d63fcccf2089e2b8380a853`;
počty sad se nemění. `SYSTEM-MAP.md` nyní odráží přesný LOC census tohoto
kandidáta. Plánovaný skutečný běh důvěryhodné extension instance ještě
nebyl ověřen; nativní Project Health zůstává `manual` a vypnutý. Zdroj
dosud není nasazený.

## Historický checkpoint 22:23 UTC

Integrační kandidát `9c9fdd345cdea394b67593a3ce0b0a4556ac1a5e` je čistý,
ale zatím **není celý pushnutý**: vzdálená větev končí na `40ba87eb`.
Rozdíl tvoří čtyři lokální commity s rozpočtem chatového promptu a typovaným
odmítnutím příliš velkého kontextu. Nové zdroje nebyly nasazeny: běžící
backend je `c84b88cd`, instalovaný frontend `fddfe996`.

- Sada `IS-T3-E2E-85-LONG-SESSION-DEGRADATION` na přesném `9c9fdd34`
  skončila **FAIL 1/1** (2 dílčí testy prošly, třetí v běžném desetihovorném
  chatu dostal HTTP 502). Provider zachytil 46 volání připnutého
  `qwen3.5:27b` digestu `7653528b...`; tři terminální odpovědi téhož
  dotazu skončily `done_reason=length` při `num_predict=1200`.
  Opakování nedostalo účinnou zkracovací instrukci, protože se již nevešla
  do 4K promptu. Jde o otevřenou produktovou chybu, nikoli výpadek
  poskytovatele. Soukromý report:
  `.intentsmith-artifacts/run-suites/2026-09-30T22-10-04-822Z/report.json`.
- V téže sadě dílčí naplnění okna dokončilo všech **8/8** dlouhých tahů,
  syrová historie dosáhla **5282** odhadovaných tokenů při skutečném
  `num_ctx=4096`; souhrn při šestém tahu ušetřil **316** tokenů a finální
  odpověď vrátila přesně `RIGEL_KAPPA_731` jen z uloženého souhrnu.
  `mechanismStatus=PASS` tedy dokládá tento omezený mechanismus. Všech osm
  numerických hodnot bylo správných, ale pouze **3/8** odpovědí splnily
  předepsaný čistý JSON; `arithmeticQuality=FAIL` a celá sada zůstává
  **FAIL**. Soukromý důkaz je v `artifacts/85-window-fill-evidence.json`
  téhož běhu. GPU lease byl uvolněn.
- Integrované registrované HTTP/SQLite fixture průchody specialisty,
  projektové expertizy a workeru prošly **3/3** na čistém `40ba87eb`
  (`.intentsmith-artifacts/run-suites/2026-09-30T22-06-09-948Z/report.json`).
  Skutečný modelový A→B→A průchod na témže SHA prošel **1/1** a ověřil
  vlastní projektový zdroj i pravidlo v každém finálním promptu
  (`.intentsmith-artifacts/direct-tests/chat-project-expertise-live.test-Kf5zNl/`).
  Tyto průchody nepokrývají všechny specialisty ani autonomní periodický worker.
- Izolovaný M3 kandidát `fe9e4392` reprodukoval a opravil chybu splatnosti
  ISO času a nesoulad `schedule.value`; registrované sady prošly **4/4**
  na čisté pushnuté větvi `work/m3-scheduler-due-20260930`. Čeká nezávislé
  review a integrace. Nativní Project Health stále používá ruční plán;
  autonomní spuštění, restart během běhu a fyzické Studio UI jsou
  **NOT_RUN**.
- Hunt dokumenty již zaznamenávají poslední read-only inventuru:
  **84/84** použitelných model–role dvojic má chybějící aktuální evidenci,
  **0** přijatých rozhodnutí; aktivace je **NO_GO**. V 22:25 UTC neběžel
  hodnoticí proces ani Hunt timer. Staré skóre se nesmí vydávat za aktuální.
- Poslední úplný offline/database audit `09e72b74` zůstává **399 PASS /
  1 FAIL** kvůli zapečetěné Gate 0 politice registru. Aktuální `SYSTEM-MAP.md`
  navíc obsahuje zastaralé řádkové census údaje; finální audit a Gate 0
  pečeť vyžadují zmrazený, nezávisle revidovaný registr. Mobilní nová
  konverzace, VPN/device matice a podepsaný balík přijdou po přejímce
  IDE/backendu. Redukce větví a worktree je poslední milník po ověření
  vlastnictví a dosažitelnosti.

## Historický checkpoint 21:14 UTC

Čistá integrační větev `work/real-chat-journeys-20260930` je pushnutá na
`8134a61396f4720e33679b859ed6c324eb7ed2af`. Obsahuje opravu recentního
uživatelského tahu, přijatou revokaci historického Hunt skóre a produktový M3
Project Health scénář včetně opravy filtru notifikací. Registr má **573** sad
(`477 ACTIVE`, `81 BLOCKED`, `15 HISTORICAL`), fingerprint
`c387cd363c4ca1292858f326c19e1f511bc604d5f1c6b658fe74ab8680ee69ea`.
Běžící backend zůstává starší release `c84b88cd`; instalovaný frontend je
`fddfe996`. Kandidát není nasazený.

- Integrovaný cílený registrovaný běh na `d1739e21` prošel **5/5**:
  M1 chat kontrakt, Hunt read model a grading, Studio zobrazení a M3 produktový
  průchod. Po doplnění M3 změny/notifikace a opravy `agent` filtru prošel na
  integračním `8134a613` registrovaný produktový průchod **1/1**
  (`.intentsmith-artifacts/run-suites/2026-09-30T21-01-42-294Z/report.json`,
  `gateEvidence:false`). Negativní filtr před opravou selhal. Omezená
  nezávislá review obou změn skončila `REVIEW_PASS`.
- Nový živý běh `IS-T3-E2E-85-LONG-SESSION-DEGRADATION` na čistém `c25174a4`
  skončil **3/4 PASS, 1 FAIL**: surová historie dosáhla 4 579 tokenů při
  `num_ctx=4096`, souhrn v šestém tahu ušetřil 446 odhadovaných tokenů,
  finální prompt obsahoval auditní kód, ale model místo požadovaného samotného
  kódu napsal dlouhé odmítnutí. Ze sedmi číselných odpovědí byla jedna
  rozporná (55 označeno za vyšší než 66), osmý tah původní test přeskočil.
  Technický i věcný verdikt je proto **FAIL**. Soukromý report je
  `.intentsmith-artifacts/run-suites/2026-09-30T20-42-23-470Z/report.json`;
  zpřísněné orákulum všech osmi tahů je na izolovaném `2cd02aac` ve stavu
  `REVIEW_PENDING/LIVE_NOT_RUN` a oprava věrnosti souhrnu se připravuje.
- Read-only instalovaná DB k 21:01 UTC: aktuální hodnoticí provider filtr
  `0.34.2-intentsmith.1`, interaktivní provider `0.34.0-intentsmith.1`,
  **84/84 použitelných model–role dvojic MISSING**, **0 přijatých rozhodnutí**,
  vazby `UNVERIFIED_RUNTIME`. Read model a Studio nyní při revokaci posudku
  nebo změně suite vracejí bez platné známky; zdrojová oprava měla nezávislé
  `REVIEW_PASS`. Hunt skórování a aktivace zůstávají **NO_GO**.
- Produkční frontend build na integračním `e0c651b8` prošel; čtyři fyzické
  Electron scénáře včetně Studio 2 UI skončily **4/4 PASS** v izolovaném auditu
  `.intentsmith-artifacts/test-runs/2026-09-30T21-07-46-499Z/report.json`.
  Běžící instalovaná verze tím nebyla změněna.
- Poslední úplný offline/database audit čistého `09e72b74` je
  **399 PASS / 1 FAIL / 0 BLOCKED** ze 400 sad. Jediný FAIL je stará
  zapečetěná Gate 0 politika registru. Po zmrazení finálního registru je nutné
  nezávisle revidovat delta sad/profilů a teprve potom obnovit pečeť;
  plný audit na aktuálním SHA ještě neběžel. Release verdict zůstává
  **FAIL/NOT_ACCEPTED**.
- Mobilní integrace M7 čeká podle rozhodnutého pořadí na stabilní IDE/backend.
  První mobilní konverzace, fyzická device/VPN matice a podepsaný balík jsou
  `NOT_RUN`. Redukce větví a worktree přijde po přejímce a inventáři cizí práce.

Následující sekce jsou historické checkpointy a jejich čísla nejsou
povyšována na současný PASS.

## Historický integrační checkpoint 20:07 UTC

Na `work/real-chat-journeys-20260930` je společný kandidát
`09e72b74939175eabb9a8a8d9733178a7adbb4fd`: IDE 2.0, chat, Hunt
`caf767bf`, oprava úplného souhrnu a opt-in testy hodnotové věrnosti.
Není nasazený; běžící backend je stále `c84b88cd`, frontend `fddfe996`.
Registr má **572 programů** (`476 ACTIVE`, `81 BLOCKED`, `15 HISTORICAL`),
fingerprint `8fdc658258af7394aaaf7bf753b28bbc6f1da8341b873b35f7821becf00c455b`.

- Konfliktní chatové skládání historie zachovává celý uložený souhrn,
  fail-closed odmítá nadlimitní souhrn a přednostně vybírá nedávné
  uživatelské opravy. M1 test prošel **42/42**. Registrované M1 HTTP/SQLite
  fixture průchody expertiz a hodnotové věrnosti prošly na předchozím
  čistém `96beddf4` **2/2**; po Hunt merge se musí zopakovat.
- Opravený Hunt read model připojuje ověřené dva posudky a rozsouzení ke
  zdrojovému pokusu. Při jednom posudku a sporu je skóre `null`; ověřený
  COMPLETE řádek ho smí vydat až po rozsouzení. Grading acceptance **24/24**,
  read model i Studio test prošly. Nezávislé review navíc našlo, že detail
  finálního řádku a historie po odvolání přejímky stále ukazovaly syrové
  `COMPLETE` a skóre. Izolovaná oprava promítá `BLOCKED/null` do obou API
  výstupů a syrový zápis odděluje jako `recordedResult`. Navazující review
  našlo stejnou mezeru při změně názvu, verze nebo SHA sady a při chybějícím
  aktuálním plánu. Kandidát uzavírá i tyto historické sémantické řádky;
  jeho nezávislá přejímka čeká.
  Skutečné rozhodnutí pro role a instalace
  zůstávají **NO_GO**. Druhý hodnotitel má 106 samostatných dávkových JSONů
  se 596 odlišnými odpověďmi (CHAT 400, D/R 166, CODE 30); jejich validace,
  agregace a rozsouzení ještě nebyly přijaty. Aktuální produkční evidence
  nad providerem `0.34.0-intentsmith.1` dál chybí.
- Celý sériový offline/database profil na čistém `edc61a73` vybral 400
  programů a skončil **398 PASS / 2 FAIL / 0 BLOCKED**; soukromý report je
  `.intentsmith-artifacts/test-runs/2026-09-30T19-58-51-602Z/report.json`.
  FAIL `artifact-validation` byl zastaralý počet hran v ROADMAP po
  oficiální aktualizaci baseline na 1 460 hran. Na `09e72b74` je dokument
  opravený a cílený `artifact-validation` prošel 160/160; celý profil se
  musí zopakovat. Druhý FAIL je původní zapečetěná Gate 0 politika
  registru; bez nové přejímky se pečeť nepřepisuje. Release verdict je FAIL.
- Opt-in živé sady pro naplnění kontextu, projektové expertizy a podepsané
  číselné rozdíly na finálním integrovaném SHA zůstávají `LIVE_NOT_RUN`.
  Starší živý běh naplnění okna technicky uspěl, ale odhalil nejméně čtyři
  chybné číselné odpovědi ze sedmi a porušení finálního formátu.
- Mobilní M7 zůstává `NOT_ACCEPTED`; fyzická VPN/device matice a první
  zpráva v nové mobilní konverzaci čekají na stabilní IDE/backend.
  Zmenšení větví a worktree je až poslední milník po přejímce a zachování
  cizí práce.

Nezávislé přijetí finálního společného merge, nový úplný audit, produkční
build/UI a živé modelové výsledky ještě chybějí. Žádný z uvedených
fixture PASS tyto brány nenahrazuje.

## Historický checkpoint 19:38 UTC

Tento záznam je vývojový checkpoint, nikoli release acceptance. Poslední
ověřený a pushnutý integrační zdroj před tímto dokumentačním commitem je
`60e091a81527dada7b42312a0ddc390222fb7d99` na
`work/real-chat-journeys-20260930`; `git ls-remote` se s ním shodoval.
Instalovaný frontend IDE 2.0 je nadále `fddfe996`, běžící backend `c84b88cd`;
nový integrační zdroj ještě není nasazený. Studio 2 produkční kandidát
`1cb4a79f` je v této větvi integrován. Frontend z aktuálního zdroje se
produkčně sestavil a všechny čtyři registrované izolované Electron scénáře
prošly na čistém `09247504` (M1 journey, Studio2 exclusive UI, boundary,
M2 composer). Zdroj frontendu je byte shodný s instalovaným frontendem,
backend kandidáta však mění šest cest proti běžícímu `c84b88cd`. Release
review, build kombinovaného balíku a nasazení této delty zůstávají otevřené.

## Chat a projekty

- Živá sada `IS-T3-E2E-85-LONG-SESSION-DEGRADATION` na čistém `09247504`
  technicky prošla **4/4** s **57** zachycenými provider voláními připnutého
  `qwen3.5:27b`. Syrová historie přesáhla skutečné `num_ctx=4096`;
  dokončený souhrn ušetřil 429 odhadovaných tokenů na stejném snapshotu,
  poslední prompt obsahoval kód z prvního tahu bez původní první zprávy a
  CODE odpověď po `length` dokončilo opakování. Soukromý důkaz je v
  `.intentsmith-artifacts/run-suites/2026-09-30T18-51-43-442Z/`; lease byl
  uvolněn. Jde o průkaz funkce cesty, nikoli správnosti všech odpovědí.
  [Rozsah a přesné limity](../wp/WP-CHAT-WINDOW-FILL-20260930.md).
- Nezávislé přečtení všech sedmi číselných odpovědí odhalilo **nejméně 4/7
  věcně chybné nebo rozporné**. Správný rozdíl byl ve všech sedmi případech
  11. Ve třetím tahu model uvedl 106→23 a rozdíl 83 místo 106→95 a 11;
  ve čtvrtém uvedl rozdíl 29 místo 11; v sedmém označil 59 za nižší než 48.
  Všechna porovnávaná data byla v příslušném provider promptu. Uložený
  souhrn navíc převzal chybnou odpověď 23/83 jako úspěšně zodpovězenou.
  Finální odpověď přidala slova kolem kódu proti zadání „pouze kódem“.
  **Kvalita odpovědí tedy není PASS.** Aktuální test a capture na `a9fec745`
  zpřísňují přesný finální formát a skutečné `num_predict`; nový živý běh
  těchto orákul je `LIVE_NOT_RUN`. Připravuje se samostatná opt-in sada
  s kontrolovanými kladnými, zápornými a nulovými výsledky.
- Oprava čekání na asynchronní souhrn a odmítání nedokončeného výstupu je
  integrovaná a omezeně nezávisle revidovaná. Obecný sestavovač finálního
  promptu však může vynechat prostředek již uloženého souhrnu. Izolovaný
  kandidát zachování celého souhrnu `56164594` prošel 41/41 M1 testy, ale
  dostal `CHANGES_REQUIRED`: v těsném 4K okně požadoval 349 slov při
  `num_predict=280`. Náhradní `223d4817` přepočítává instrukci podle
  skutečného finálního limitu, získal omezené nezávislé `REVIEW_PASS` a je
  integrován v `60e091a8`. Na společném SHA prošly M1 41/41, kompakce
  13/13, WebSocket 92/92 a projekty 33/33. Nový živý modelový běh této
  produktové opravy je stále `LIVE_NOT_RUN`.
- Projektový A→B→A průchod má deterministický test a omezené nezávislé review.
  Projektové expertizy prošly na společném SHA cíleným skutečným HTTP průchodem
  **1/1** s izolovaným providerem a kontrolou finálního promptu. Nativní worker
  prošel HTTP/SQLite scénáři **6/6**, související runner **22/22** a Project
  Health **10/10**; test restartuje DB/služby v jednom procesu. Specialistický
  M1 test dvou projektů po zesílení orákula prošel nezávislým omezeným review
  a na společném SHA **1/1**. Kontroluje čtyři tahy, odlišné zdrojové bajty,
  nálezy a nulový modelový fallback. Tyto fixture testy neměří odpověď
  skutečného modelu, všechny specialisty ani Studio UI. Integrované worker
  HTTP testy prošly **6/6**, runner **22/22**, Project Health **10/10**;
  registry, M6 plán, artifact-validation a harness také prošly. Nový
  modelově cílený projektový A→B→A test kontroluje finální provider prompt
  a SQLite přes M1 HTTP; po opravě pravdivého zápisu artefaktu má nezávislé
  `REVIEW_PASS` a na integračním `dd9342a8` prošel registrovaně **1/1**.
  Jeho skutečný modelový běh je `LIVE_NOT_RUN`.

## GPU hunt, release a mobil

- Read-only report z instalované DB `data/c3.db` v 18:17 UTC nad providerem
  `0.34.0-intentsmith.1` uvádí **84/84 použitelných dvojic model–role MISSING**,
  **0 COMPLETE** a **0 přijatých rozhodnutí**. Runtime vazby sedmi rolí jsou
  `UNVERIFIED_RUNTIME`. Starší uložené běhy a vývojová hodnoticí matice
  nepředstavují aktuální přijaté skóre. Druhý hodnotitel má jen částečné
  soukromé výstupy (106 JSON souborů / 590 známkovaných položek z matice
  1173 odpovědí); přejímka a aktivace jsou **NO_GO**. Hunt kandidát je na
  jiné, zatím nesloučené větvi. Kandidát `4edd1be6` propojuje Hunt se
  Studio 2 a má izolovanou simulaci **5/5**, detailní UI test **9/9**,
  `desktop-hunt` **34/34**. Jeho čistý serializovaný offline/database audit
  vybral 400 programů a skončil **399 PASS / 1 FAIL / 0 BLOCKED**; jediný
  FAIL je zapečetěný Gate 0 hash. Nezávislé review integrace našlo
  `CHANGES_REQUIRED`: skutečný detail běhu z read API zatím nepřipojuje dva
  posudky a rozsouzení, které syntetický Studio 2 test zobrazil. Oprava
  read modelu a test skutečné API cesty probíhají v izolované větvi;
  integrace a živé hodnocení teprve následují. Tato čísla nepředstavují
  přijaté skóre.
  [Pravidla výběru](../MODEL-SCORING-ACTIVATION.md).
- Poslední úplný offline/database audit čistého integračního `09247504`
  skončil **387 PASS / 1 FAIL / 0 BLOCKED**. Jediný FAIL je kontrola
  zapečetěného Gate 0 hashe registru, který se po nových testech liší;
  report je `.intentsmith-artifacts/test-runs/2026-09-30T19-02-22-473Z/report.json`.
  Aktuální `60e091a8` má po nových testech registr 558 a celý profil na něm
  dosud neběžel. Cílený provider capture self-test prošel **6/6**. Žádný
  z těchto běhů není release PASS; přepis pečeti bez nové review není řešení.
- Mobilní aplikace má připravené UI a úzké review, ale fyzický Android,
  VPN/pairing/revocation, přístupnost, podepsaný release a produkční
  napojení nejsou ověřené. Host mobilní gate na společném zdroji prošel
  **47/47**. Integrace se otevírá po stabilizaci IDE 2.0 a
  backendu; M7 zůstává **NOT_ACCEPTED**. Konkrétní funkční mezera pro tuto
  fázi: `newChat()` vytvoří pouze lokální ID a M7 `conversation.execute`
  odmítne neexistující konverzaci jako `ACCESS_DENIED`. Katalog M7 zatím
  nemá `conversation.create`; před mobilní přejímkou je nutné schválit
  kontrakt a ověřit průchod nová konverzace → první zpráva → historie.

## Git a navazující brány

Integrační branch do `60e091a8` včetně je pushnutá přesně na
`origin/work/real-chat-journeys-20260930`; test expertiz má také vzdálenou
izolovanou větev. Rozpracovaný Hunt a oprava souhrnu jsou zatím lokální
kandidáti, tedy tvrzení „vše na Git remote“ by bylo nepravdivé. Soukromé
provider logy, databáze a obrazové důkazy nejsou součástí Git zdrojů.
Inventář pracovních stromů zatím nenašel žádný cizí checkout, jehož vlastnictví
a zachování důkazů by dovolovalo bezpečné smazání. Úklid je poslední milník
po integraci, ověření remote a uchování důkazů.

Další brány v pořadí: (1) nezávisle přijmout opravu celého souhrnu a sloučit
Hunt s jeho UI bez ztráty chatového chování; (2) zmrazit společný SHA, spustit
celý offline/database profil, Studio UI a živé chatové sady s odděleným
technickým a kvalitativním verdiktem; (3) dokončit skutečné Hunt hodnocení,
nezávislé posouzení a rozhodnutí o modelech; (4) přejmout a nasadit
IDE/backend, poté otevřít mobilní napojení; (5) ověřit exact remote a až
nakonec zredukovat bezpečně odstranitelné větve a worktree.
