# IntentSmith — průběžné dokončování k 30. 9. 2026

## Checkpoint 22:38 UTC

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
