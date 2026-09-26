# IntentSmith — mapa systému

**Studio: průběh práce a prostředí, 2026-09-23:** konkrétní tahy, nástroje,
čekání, souborové diffy/+− a kopírování formátované odpovědi. Přidáno skutečné
prostředí backendu a explicitní potvrzované/automatické instalace npm a .NET SDK
v odděleném rozsahu. Default ask, bez sudo. Skutečný Electron/M2 a SDK ověřeny;
Nasazeno `72247a49`: 366 PASS / 1 FAIL Gate 0 / 0 BLOCKED. Při prvním
nasazení startup probe přerušila cizí CHAT panel. Doplněné čekání na společný
GPU zámek prošlo i skutečným restartem: 7 odložených sond, žádný chatový
požadavek při drženém zámku. Incident zachován v reportu. REVIEW_PENDING;
měřicí kontrakty ani modelové role nezměněny.
Na nasazené studiové linii měl module graph 1 421 hran, 3 cykly / 28 členů.
[Podrobnosti, důkazy a omezení](docs/review/2026-09-23-STUDIO-ACTIVITY-ENVIRONMENT.md).

**GPU hunt — dvojí hodnocení, 25. 9. 2026:**
Vývojová větev `work/hunt-model-controls-20260917` má dva oddělené
append-only posudky a bránu proti jediné známce, sporům po kritériích a
záměně artefaktu. Solver již omezuje model na dvě role a vynucuje nezávislé
autorské a revizní role. Cílené testy prošly; živá DB má při read-only kontrole
0 záznamů přejímky; hunt migrace 118 a 119 v instalaci dosud nejsou. **IMPLEMENTED /
REVIEW_PENDING / NOT_DEPLOYED / NO_AUTONOMOUS_GO**.
[Stav, testy a chybějící přejímky](docs/review/2026-09-25-GPU-HUNT-DUAL-GRADING-MILESTONE.md).


**GPU hunt — cílové workflow a oddělení rolí, 24. 9. 2026:**
Operátor upřesnil nejvýše dvě nesouvisející role na model a nejméně dva
nezávislé hodnotitele. Zpracovaný návrh celého provozu k revizi;
současný kód stále volí prvního přijatého hodnotitele a dovoluje tři role/model.
**DESIGN_REVIEW / NO_IMPLEMENTATION_CHANGE / NO_AUTONOMOUS_GO**.
[Workflow, podmínky autonomie a konkrétní implementační mezery](docs/GPU-HUNT-WORKFLOW.md).
Navazující revize doplnila povinnou proveditelnost měření, absolutní brány,
zdroje čerstvých případů a přechodné dvojí review. Reprodukce intervalové
metody je ilustrační, ne nové hodnocení panelu. [Výsledek revize](docs/review/2026-09-24-HUNT-WORKFLOW-REVIEW.md).
Následné [ověření proveditelnosti](docs/review/2026-09-24-HUNT-DECISION-FEASIBILITY.md)
potvrdilo 18 441 skupin pro nulový rozdíl / toleranci 0,02 v KL a společnou
binární provozní cestu všech rolí. 21 000 syntetických simulací ukazuje i
riziko t/percentilového bootstrapu při vzácném zhoršení; metoda není přijatá.
Autorizovaný GET běžícího backendu potvrdil CHAT `qwen3.5:27b`; produkční
reprodukce panelového selhání s přesným profilem ještě neproběhla.

**GPU hunt — ověření druhého CHAT posudku, 24. 9. 2026:**
Potvrzena návaznost všech 1 200 dialogů a konkrétní vady včetně dvou smyček
a výskytu neveřejných údajů v předchozích tazích Gemmy. Opusův součet pokrývá
12/20 scénářů; bez známek po ID nejde vypočítat shodu ani otevřít přejímku.
Původní známky zachované, **AUDIT_NOT_GRADING_ACCEPTANCE / NO_AUTONOMOUS_GO**.
[Rozbor, opravy závěrů a důkazy](docs/review/2026-09-24-CHAT-OPUS-RECONCILIATION.md).

**GPU hunt — dokončený CHAT sběr a první reference, 24. 9. 2026:**
1 196 úplných dialogů a čtyři výjimky z 1 200 plánovaných. Posouzeno
60 dialogů ručně a 60 striktních JSON; jeden dialog čeká na rozsouzení,
1 076 úplných dialogů ještě známku nemá. Identita odkryta po zmrazení
prvního posudku; znalost sady a pilotu přiznána. Nejde o přejímku hodnotitele.
**PARTIAL_REFERENCE_GRADING_DRAFT / NO_AUTONOMOUS_GO**.
[Výsledky a zbývající místní hodnoticí cesta](docs/review/2026-09-24-CHAT-PANEL-ASSESSMENT.md).

**GPU hunt — navázání po krátkém konfliktu GPU, 24. 9. 2026:**
Qwen3.5 dokončen. Qwen3.6 přerušen při cizí GPU aktivitě; časově doložen
souběh s RustDesk CUDA/NVENC sondou. Doplněno omezené čekání a nejvýše tři
navázání při GPU konfliktu, zachování deníku a původního rozpočtu.
Přehled rozlišuje čekání od zastavení. 24 cílených testů a 11 browser kontrol PASS.
**RUNTIME_RESUMED / NOT_GRADED**.
[Diagnóza, aktuální běh a důkazy](docs/review/2026-09-24-CHAT-GPU-CONTENTION.md).


**GPU hunt — velký CHAT sběr po slepém posudku, 23. 9. 2026:**
Operátorem spuštěný panel deseti místních modelů: 20 CS/EN párů, tři
opakování, 1 200 dialogů / nejvýše 3 480 volání, okno 24 hodin.
Rubrika v2 upravuje podmíněný kredit u injektáže a nevyplněné šablony;
40 promptů se nemění. Posudek pilotu (96 známek) uchován v původní verzi.
**COLLECTION_RUNNING / NOT_GRADED / NO_AUTONOMOUS_GO** — stav je snímek
zahájeného běhu, aktuální průběh a výsledek jsou v jeho trvalé evidenci.
[Průběh, změny rubriky, původní známky a ovládání běhu](docs/review/2026-09-23-CHAT-PANEL.md).


**GPU hunt — skutečný CHAT pilot, 23. 9. 2026:**
Qwen3.8 a Phi4 dokončily **24/24 dialogů, 64/64 volání** za 7 min 33 s.
Návaznost, identity a úplnost ověřené; obsahové známky zatím nevydané.
Připravené oddělené stránky pro anonymní a pojmenované hodnocení, 17 browser
kontrol PASS. Opravený výpis uplynulého času; 45 cílených kontrol PASS.
Další desetimodelový CHAT panel (3 480 volání) je zmrazený, nespuštěný.
**CAPTURE_COMPLETE / UNGRADED / REVIEW_PENDING / NO_AUTONOMOUS_GO**.
[Dialogy, důkazy, rozpočet a další postup](docs/review/2026-09-23-CHAT-PILOT.md).

**GPU hunt — technická příprava dalšího sběru, 23. 9. 2026:**
Trvalý deník a pokračování mezi okny, souhrnné rozpočty a průběžná ochrana
RAM/FS/GPU jsou implementované. Připravený CHAT pilot: dva přesné artefakty,
24 dialogů / 64 volání, zatím 0 volání. Nové CODE zadání vyžaduje jistotu i
pod prahem; dvě reference prošly 24/24 technickými kontrolami. Kandidát
extraktoru pracuje pouze s prózou a nemá přejímku ani skórovací autoritu.
60 cílených kontrol PASS; nejde o modelový pilot ani release PASS.
Aktuální module graph má 1 427 hran, 3 cykly / 28 členů.
**REVIEW_PENDING / NOT_DEPLOYED / NO_AUTONOMOUS_GO**.
[Nové předání, příkazy, důkazy a zbývající přejímky](docs/review/2026-09-23-HUNT-COLLECTION-READY.md).

**GPU hunt — druhý CODE posudek připojen, 23. 9. 2026:**
Původní DRAFT ověřen přes packet ID, custody a hashe: shoda 60/60 os,
všech 60 citací nalezeno. Předchozí expozice zachovaná; nejde o nezávislou
přejímku ani o nové skóre. U O09–O12 je shodná próza, API se liší;
v O01–O08 je správné API 216/240, 24 polí chybí. Operátor přijal jistotu
ve všech kvalitativních větvích pro novou verzi zadání (direction §7.5).
13 cílených testů PASS, žádná inference/import/nasazení. **NO_AUTONOMOUS_GO**.
[Rozsouzení a meze důkazu](docs/review/2026-09-23-CODE-RECONCILIATION.md).

**GPU hunt — druhé posouzení připraveno, 23. 9. 2026:**
30 odpovědí a 360 pozorovaných návratů má oddělený formulář bez identit,
původních známek a autorských důvodů. Předchozí expozice je přiznaná;
nejde o nový slepý přejímací vzorek. Podprahová jistota zůstává ve starém
měření mimo hodnocení; univerzální povinnost pro všechny kvalitativní
větve je návrh nové verze zadání. 5 testů exportu + 11 browser kontrol.
Nová inference 0, žádná přejímka ani GO. Pokračování plného CHAT panelu
v dalším okně je výslovný návrh, nikoli automatické prodloužení rozpočtu.
[Podklad, vyjasnění a další postup](docs/review/2026-09-23-CODE-SECOND-REVIEW.md).

**GPU hunt — čtyři milníky pro společnou revizi, 23. 9. 2026:**
Nová explicitní technická složka CODE prošla 53 kontrolami a přehrála všech
210 odpovědí bez inference. Celková známka zůstává null; 30 textů má oddělené
neslepé autorské posouzení. Tři původní odmítnutí správné formulace jsou
doložená; 16 odpovědí skutečně vynechává požadované vysvětlení. Sběrač,
DB/read model, slepý export a Studio detail podporují skutečné navazující
tahy. Nový CHAT návrh obsahuje 20 CZ/EN dvojic / 40 úloh, jediný striktní
JSON scénář; není aktivovaný. Matice zachovává 2 922 původních odpovědí
a známek. 190 cílených testů, 25 browser kontrol; žádný release gate ani
živý modelový journey. **IMPLEMENTED_AND_OFFLINE_VERIFIED / REVIEW_PENDING /
NOT_DEPLOYED / NO_AUTONOMOUS_GO**.
[Milníky, výsledky, zdrojové commity, rozpočet a přenositelné důkazy](docs/review/2026-09-23-HUNT-MILESTONES-REVIEW.md).

**GPU hunt — rozsouzení textových kontrol a pokrytí matice, 23. 9. 2026:**
Všech 154 inventarizovaných míst má autorské zařazení, důvod a zdrojový
kontext: 102 mechanických/protokolových kontrol, 40 prózových kontrol okolí
mimo měnitelný úsek, 12 míst vyžadujících sémantickou úpravu. Není to
nezávislá přejímka. Nové párové sondy: 14 mutací, 13 nesouladů; jeden
rezervní referenční běh nedokončen, jeho dva páry neprovedeny. Aktivní CODE
přejímka navíc kontroluje práh, rychlost a chybějící měření před inferencí.
Matice výslovně ukazuje CHAT 38/40 a zbývající 2 úlohy / 60 odpovědí.
**AUTHOR_DISPOSITION_REVIEW_PENDING / NOT_DEPLOYED / NO_REPLAY**.
[Rozpad, přesný rozsah sond a opravená matice](docs/review/2026-09-23-HUNT-TEXT-DISPOSITION.md).

**GPU hunt — audit textových orákul, 23. 9. 2026:**
Offline inventář zahrnuje všech 37 CODE fixtures a 83 verzí kontrolních
souborů; lexikální seznam není přejímka jejich významu. Skutečný izolovaný
runner doložil falešné odmítnutí i přijetí u aktivního výpisu jistoty a další
falešné odmítnutí v rezervní matematické úloze. Nové přejímací kontroly
zastaví aktuální CODE sadu před inferencí. **ORACLE_DEFECTS_REPRODUCED /
PREFLIGHT_HARDENED / NOT_DEPLOYED / REVIEW_PENDING**. Orákulum prózy není
opravené a nové známky nebyly vydané. Úplná matice zobrazuje všech 2 922
původních odpovědí, oddělené osy a upozornění na sporné CODE známky.
[Audit, přehratelné sondy, matice a zbývající práce](docs/review/2026-09-23-HUNT-ORACLE-TEXT-AUDIT.md).

**GPU hunt — osobní porovnání odpovědí, 23. 9. 2026:**
Offline podklad z uloženého panelu: 27 společných úloh, 4 modely na úlohu,
324 odpovědí včetně všech opakování; 12 modelů celkem. Vlastní známky,
preference a návrhy vah s exportem. Rozložení v2: zadání → pojmenovaný model
→ všechny tři odpovědi → viditelné známky a důvody; kompatibilní staré poznámky
a exporty. Žádný import do produkce ani změna GO.
[Výběr, původ známek a ověření rozhraní](docs/review/2026-09-23-HUNT-ANSWER-COMPARISON.md).

**GPU hunt — hodnocení uloženého sběru, 23. 9. 2026:**
Doplněny CLI, lokální API a Studio pro hodnocení již uložených odpovědí.
Přejímka T4 vyžaduje nezávislé označení a jiný digest hodnotitele, provozní
přejímka přijímá úplný postup každé ze sedmi rolí. Zneplatnění přejímky
vyřazuje aktuální skóre i běžící hodnocení; historie zůstává.
Nasazeno `400c9d8f`, Studio fyzicky prokliknuté v sedmi záložkách.
Finální fyzický běh: všech 7 rolí plus druhý CODE kandidát, **327 pokusů**;
216 otevřených odpovědí čeká na posouzení.
Offline/database 364 PASS / 1 známý Gate 0 FAIL / 0 BLOCKED. Přehled místa
čte skutečný modelový FS; odmítnutí hodnocení je viditelné i v Historii.
**DEPLOYED / REVIEW_PENDING**; žádná přejímka skutečného hodnotitele
ani autonomní výběr nejsou tímto vyhlášeny. Přijatých profilů 0/7.
[Ověření a konkrétní meze](docs/review/2026-09-23-HUNT-GRADING-INTEGRATION.md).

**GPU hunt — úložiště a arbitráž, 22. 9. 2026:**
Nasazený `cd5a6943` po opravě user environment používá modely na Vi7000.
Systémová Ollama a read-only sidecar mají 12 shodných name/digest/size;
backend API health/hunt/evaluace/kandidáti 4×200, sedm nepřijatých profilů.
Storage probe neprováděl inferenci. Z 28 releasů 26 přímo referencovaných,
dva KEEP_UNPROVEN; nic smazáno. **CONFIGURATION_VERIFIED /
ARBITRATION_REVIEW_PENDING / AUTONOMOUS_SELECTION_NO_GO**.
[Rozsah a důkazy](docs/review/2026-09-22-HUNT-ARBITRATION-STORAGE.md).

**GPU hunt — sběr pod dohledem, 21. 9. 2026:**
Běžná cesta nově sbírá odlišné D1/D2/R1/R2/CHAT sady bez nepřijatého soudce,
s průběžným uložením, detaily ve Studiu a odděleným exportem bez identit.
CODE/VISION zůstávají průzkumné; přejímka a provozní platnost zůstávají otevřené.
Paměťový profil je jednotně 16 384 tokenů / 22 GB, nikoli důkaz pro větší kontext.
Nasazeno `cd5a6943`. Skutečný Qwen běh přes sedm rolí: 306 pokusů,
pět rolí bez známek čeká na posouzení. Nové stahování blokuje rezerva 40 GiB.
**DEPLOYED / SUPERVISED_COLLECTION_VERIFIED / REVIEW_PENDING / AUTONOMOUS_SELECTION_NO_GO**.
[Rozsah, ověření a zbývající práce](docs/review/2026-09-21-HUNT-SUPERVISED-COLLECTION.md).


**GPU hunt — rozsouzení review, 21. 9. 2026:**
Malý provozní vzorek předpovědní platnost benchmarku nepotvrdil ani nevyvrátil;
změna znaménka u D1/R2 při podprahovém benchmarku není prokázaná reverze.
Nový vzorek: 29 číselných dvojic + 1 nevyřešený scope. Opraven export
`score`/`contentScore`, dvě autorské kritériové korekce připojeny bez přepsání
původní evidence. Hodnoticí měřítko stále není přijaté. Nové sémantické sady
nejsou zapojené do běžného huntu; staré T5 cesty jsou blokované, provozní
přejímka podporuje pouze CODE. **SCALE_ADJUDICATION_OPEN / NOT_DEPLOYED / NO_GO**.
[Srovnání známek, korekce závěru a zbývající implementace](docs/review/2026-09-21-HUNT-REVIEW-RECONCILIATION.md).

**GPU hunt — uzavřené hodnocení a nové provozní zkoušky, 20. 9. 2026:**
53 rubrik sjednoceno, přesný produkční parser sdílen; všech 2 922 starých
pokusů dohodnoceno (2 861 obsahových známek, 37 nečitelných, 24 limitů).
Známky zmrazené před odkrytím identit. Nových 76 použitelných provozních
pokusů přes všech 7 rolí: CODE 4/6 proti 3/6, NEROZHODNUTO; D1 a R2
mají obrácený bodový směr; VISION 4/4 proti 4/4 bez rozlišení. Jedna nová
R1 obsahová otázka zůstává bez souhrnné známky. 32 vadně označených revizí
a 1 VISION bez digestu zachováno zvlášť. Generate digest doplněn ověřeným
reprodukovatelným `.2` providerem pro manuální obrazovou kvalifikaci.
Finální offline/database regrese 363 PASS / 1 známý FAIL / 0 BLOCKED;
není L1 green ani nezávislá přejímka. Statické review UI prokliknuté,
celý Studio journey zbývá. **REVIEW_PENDING / NOT_DEPLOYED / NO_GO**.
Timer, bindingy, produkční import a mazání zůstávají neaktivované.
[Závěrečný packet a omezení](docs/review/2026-09-20-HUNT-COMPLETION.md).

**GPU hunt — produkční JSON parser, 20. 9. 2026:** CHAT T2 a VISION nyní
používají přímo `client.js#extractJSON`; produkční parser se neměnil.
Replay 1 182 odpovědí, všech 54 fence s prózou přečteno; 48 obsahových
výsledků opraveno (17 CHAT / 31 VISION). Čistý `30c5df33`: VISION 299/299,
celý offline/database profil **363 PASS / 1 FAIL** (známá Gate 0 pečeť).
Původní odpovědi a známky zachované, překryvy reasoning rubrik stále otevřené.
**PARSER_PARITY_VERIFIED / REVIEW_PENDING / NOT_DEPLOYED**, autonomní hunt **NO-GO**.
[Změny výsledků, důkazy a meze](docs/review/2026-09-20-PARSER-PARITY.md).

**GPU hunt — offline posouzení sběru, 20. 9. 2026:** všech 210 CODE odpovědí
má výsledek spustitelných kontrol (133 plných / 3 částečné / 74 neúspěšných;
67 unikátních spuštění). Ověřeno 16 externích známek po jejich přečtení;
14 dalších položek vzorku má posudek 88 obsahových kritérií, bez souhrnu
z překrývajících se bodů. Potvrzená VISION parserová falešná nula; celkem
95 parserových odmítnutí potřebuje odděleně posoudit obsah. Nejde o 95
prokázaných falešných nul. Původních 247 zapečetěných souborů beze změny.
**POST_COLLECTION_ASSESSMENT_PARTIAL / REVIEW_PENDING / NOT_DEPLOYED**;
**NO_GO_FOR_AUTONOMOUS_HUNT**, bez nové inference a produkčních změn.
[Posudky, CODE výsledky, ověřený archiv a otevřené vady](docs/review/2026-09-20-HUNT-GRADING-FOLLOWUP.md).

Následující checkpointy zachycují dřívější etapy; jejich stav hodnocení
není aktuálním stavem navazujícího posudku výše.

**GPU hunt — rozšířený sběr, 20. 9. 2026:** všech 12 lokálních artefaktů,
10 pro textové role a 8 pro VISION; **2 922/2 922** pokusů na čistém `775434ff`.
2 898 dokončených generací, 24 tokenových limitů, 0 transportních chyb.
Integrita PASS, formulář 14/14, ověřený archiv a vzorek 15 cílených + 15 náhodných.
Obsahové známky zatím nevydané; CODE čeká na samostatné orákulum.
**COLLECTION_COMPLETE / NOT_GRADED / REVIEW_PENDING / NOT_DEPLOYED**;
**NO_GO_FOR_AUTONOMOUS_HUNT**, timer vypnutý, GPU po sběru uvolněná.
Starší níže uvedené známky nejsou výsledky tohoto nového sběru.
[Výsledky sběru, podklady k hodnocení a meze](docs/review/2026-09-20-HUNT-ALL-INSTALLED.md).

**GPU hunt — opravené sady a nový sběr, 20. 9. 2026:** všech sedm rolí,
nejméně dva kandidáti na roli, tři pro CODE. 633 zaznamenaných pokusů:
632 dokončených odpovědí a jeden výstupní limit; jedno další přerušené
provider volání zachované mimo vzorek. Sběr `01b30ae6`, konečný kód
`b9b7707b`; shoda veřejných vstupů a generačních profilů doložená.
315 deterministických posudků oddělených od raw dat; 317 otevřených
odpovědí čeká na nezávislé posouzení. Anonymní vzorek 15 cílených + 15 náhodných.
CODE orákula 62/62, VISION 276/276, review renderer 16/16; široká regrese
**363 PASS / 1 FAIL** (neshoda registru s přijatou Gate 0 politikou), bez BLOCKED.
Staré T5 sady v této větvi odmítnuté před inferencí. Zjištěna otevřená chyba
provider účtování MTP paměti. **READY_FOR_INDEPENDENT_REVIEW / NO_GO_FOR_AUTONOMOUS_HUNT /
NOT_DEPLOYED**; timer vypnutý, GPU po sběru volná, žádné nové automatické vazby
ani mazání. Opravy nejsou nasazené přes cizí produktovou větev.
[Nové odpovědi, opravy, ověření a zbývající kroky](docs/review/2026-09-20-HUNT-SUITE-REPAIR.md).

Následující checkpointy jsou historická evidence, nikoli aktuální přejímka.

**GPU hunt — závěrečné měření všech rolí, 19. 9. 2026:** zdroj `89531748`,
318 benchmarkových a 16 vývojových provozních CODE pokusů, tři artefakty,
2 331 odpovědí. CODE Qwen/Devstral/Coder: 80,95/49,21/11,43 %; VISION Qwen:
84,62 %. D1/D2/R1/R2/CHAT nemají platné souhrnné skóre. Provozní CODE
Qwen 4/8, Devstral 1/8 na známých vývojových případech; není to nový holdout.
Široká regrese na shodném runtime: 361 PASS / 1 FAIL (Gate 0 pečeť).
**NO_GO_FOR_AUTONOMOUS_HUNT / NEROZHODNUTO / REVIEW_PENDING / NOT_DEPLOYED**,
0/7 přijatých profilů. Chybí přejímka měřidel i část produkční integrace;
legacy substringové hodnocení není ještě všude zablokované. Timer vypnutý,
GPU uvolněná, nové výsledky mimo produkční DB.
[Závěrečný dokument, všechny meze a ověřený archiv](docs/review/2026-09-19-GPU-HUNT-FINAL-REVIEW.md).

Následující checkpointy zachovávají historické výsledky, nikoli aktuální přejímku.

**GPU hunt — přejímací brána, 19. 9. 2026:** `decisionReady` se odvozuje
z append-only přejímky hodnotitele a odděleného párového provozního měření
pro přesný kontrakt/runtime. Odvolání se znovu kontroluje; přejímka jedné
dvojice neplatí pro jiné artefakty. Čistý `83cc4704`: 360 PASS / 1 známý
Gate 0 FAIL, 17 kontrol brány, 57 sond CODE orákul a opakovaný Electron PASS.
Žádná nová inference ani produkční přejímka; GPU byla obsazená cizí prací.
**REVIEW_PENDING / FULL_HUNT_NOT_READY / NOT_DEPLOYED**, timer vypnutý,
hold zachovaný. [Packet a zbývající meze](docs/review/2026-09-19-EVALUATION-ACCEPTANCE-GATE.md).

**GPU hunt — opravy workflow, 19. 9. 2026:** `6610faf6` opravuje přenos
patchů (včetně doslovných Markdown delimitérů), falešnou oscilaci, čtení
harness diagnostik a chybějící chyby v následném promptu. Průzkumné sady již
nezakládají rozhodnutí ani retenční důkaz. Finální orákula 60/60, široká
regrese 359 PASS / 1 očekávaný Gate 0 FAIL; skutečný read-only Electron
průchod sedmi záložek a reconnect PASS. Vývojová inference staršího
`bdbcd201`: Qwen 2/8, Devstral 0/8; finální parser při replay navíc opraví
jeden skutečný případ. Nové měření finálního runtime zůstalo blokované cizí GPU prací.
Klasifikační doplnění `20a2f764`: 49/49 párových kontrol a 60/60 orákul.
**REVIEW_PENDING / FULL_HUNT_NOT_READY / NOT_DEPLOYED**; timer disabled,
hold trvá. [Rozsah, důkazy a otevřené kroky](docs/review/2026-09-19-HUNT-WORKFLOW-REPAIR.md).

**GPU hunt, navazující oprava a audit 2026-09-19:** falešná konvergence
v produkčním fix loopu opravena; výsledek, paměť oprav a metriky nyní vyžadují
potvrzené kontroly. Regrese před opravou 63 PASS / 4 FAIL, po 67/67; navazující
build 114/114. Čistý `cd1c2170`: po sériových follow-upech 359 PASS /
1 zděděný FAIL Gate 0, bez BLOCKED. V instalaci zatím není. Hunt má
provozní infrastrukturu, ale
nemá přijaté rozhodovací sady všech rolí ani integrovaný CODE pilot.
Timer zůstává vypnutý, mazání vypnuté; **IMPLEMENTATION_VERIFIED /
REVIEW_PENDING / NOT_DEPLOYED**. [Oprava a seznam zbývající práce](docs/review/2026-09-19-GPU-HUNT-READINESS.md).

**CODE, dokončený provozní duel 2026-09-19:** 48/48 pokusů, Qwen3.8
0/24 dokončených oprav, Devstral 0/24; 44 chybných oprav a 4 ověřená
vyčerpání rozpočtu, žádný nehodnotitelný pokus v konečné sérii. Oba modely
splnily 22 GB profil při 16 384 tokenech. Verdikt **NEROZHODNUTO**,
binding CODE beze změny. Překážkou jsou zejména nepřijaté C3 patche;
tři falešná hlášení konvergence odmítla závěrečná kontrola souborů.
Provider opraven, starší přerušený běh zachovaný. GPU uvolněná, timer
vypnutý a chráněný před starou instalací. **DECISION_RUN_COMPLETE /
REVIEW_PENDING / NOT_DEPLOYED**, širší testy 359 PASS / 1 zděděný FAIL.
[Důkazy a meze](docs/review/2026-09-19-CODE-MEASUREMENT.md).

Starší checkpointy níže zachycují stav v dané etapě; aktuální výsledek
a provozní stav uvádí dokončený duel výše.

**Historický checkpoint — CODE, dvoubloková sonda 2026-09-19:** opravené zahození kratší části
jednoho úseku; před opravou čtyři falešné nuly, po opravě 57/57 kontrol PASS.
Extrakce 63 ranních odpovědí beze změny. Pět deklarovaných skupin není
hotové rozhodovací pravidlo §6; krok 4 zůstává částečný. Bez nové inference
a zápisu skóre; instalace `ec78722b` opravu neobsahuje.
PILOT_INCOMPLETE / REVIEW_PENDING / NOT_DEPLOYED. [Důkazy](docs/review/2026-09-19-CODE-MEASUREMENT.md).

**CODE pilot, měření 2026-09-19:** dokončeno 63/63 pokusů na čistém
`0ca09dd9`; Qwen3.8 85,71 %, Devstral 46,03 %, qwen3-coder 11,43 %.
Dvě zadání mají doplněné veřejné rozhraní, novou identitu a čerstvý baseline.
16/16 neúspěšných odpovědí reprodukovalo stejné skóre. Průzkumné srovnání,
bez finálního pravidla a provozního holdoutu; role ani artefakty se neměnily.
Souběžná instalace `c0eeec50` tuto deltu neobsahuje a znovu je aktivní timer.
PILOT_INCOMPLETE / REVIEW_PENDING / NOT_DEPLOYED. [Důkazy a meze](docs/review/2026-09-19-CODE-MEASUREMENT.md).

**CODE pilot, noční checkpoint 2026-09-18:** ověřené hodnotitele a výsledkové
třídy (`d2ce71b7`), jedno nové měření Qwen3.8 76,19 % (21/21). Devstral
zrušen na pokyn operátora, coder nezahájen. Hunt timer inactive/disabled,
další testy odložené kvůli nočnímu klidu. Ostatní role mají připravené
neaktivní podklady, nikoli ověřené sady. 359 PASS / 1 zděděný FAIL před
poslední integrací vzhledu; integrovaný build PASS, GUI neověřené.
REVIEW_PENDING / PILOT_INCOMPLETE / NOT_DEPLOYED. [Důkazy a meze](docs/review/2026-09-18-CODE-PILOT-GRADER-CHECKPOINT.md).

**Evaluace, 2026-09-18 večer:** instalováno `230778ad`; 12 různých VISION PNG
+ kontrola bez obrázku, 13 × 3 odpovědí v každém ze dvou finálních běhů.
Qwen3.8 84,6 %, Ornith 78,8 %; průzkumné výsledky, bindingy nezměněné.
Sdílené gradery zahrnuté do identity sady, opravené JSON/F1 kontroly; CHAT
a sdílená zadání D1/D2/R1 zůstávají otevřené. Noční mazání vypnuté.
Poslední výsledek každého testovacího programu: 358 PASS / 1 FAIL / 1 TIMEOUT.
REVIEW_PENDING; [důkazy a meze](docs/review/2026-09-18-EVALUATION-HARDENING-VISION.md).
Nový [kontrakt CODE pilotu](docs/wp/WP-GPU-HUNT-EVALUATION-CONTRACT-20260918.md)
není implementační přejímka.

**Tři projektové průchody, 2026-09-19:** všechny tři utility jsou v nabídce
aplikací: SystemSmith_1 (`70d14693`), WeatherSmith (`74f7a861`) a NewsSmith
(`cc083cff`). Skutečný Electron přes vlastní modelové launchery, živá data a
dva procesové starty se zachovanými preferencemi prošly u všech tří. Jde o
asistovaný modelový průchod, ne autonomní vytvoření na jeden prompt.
SystemSmith_1 měl 488,3 MiB PSS a 7,21 % jednoho CPU jádra v privátním software
renderingu; požadavek lightweight není doložený. Počasí má ověřená uložená
místa, nikoli skutečnou polohu operátora; zprávy pět pevných zdrojů.
Úklid vlastních kopií odstranil 18,10 GiB; poslední dávka ověřila 23 243 hashů.
Instalováno `b0975bff`: přesné opravy úseků a odmítnutí vadné JS syntaxe před
plánem včetně retained návrhů (service 96/96, boundary PASS). Úplný profil
359 PASS / 1 zděděný FAIL Gate 0 / 0 BLOCKED; pečeť se neměnila. Nasazení
potvrdilo integritu DB, nezměněných devět tabulek a zachování autentizace.
**THREE_APPLICATIONS_RUNTIME_VERIFIED / ASSISTED_JOURNEY / REVIEW_PENDING**,
nikoli celkový prod-ready. [Výsledky, meze a neúspěchy](docs/review/2026-09-19-THREE-PROJECTS-JOURNEY.md).

Navazující převzetí skutečného ShellSmithu dokončilo jednu modelovou opravu
v oddělené kopii přes M2: odmítnutí raw CR/LF/TAB před URL normalizací.
Nová regrese selže na původním kódu; opravený návrh má 30/30 a renderer build
PASS. Ostatních 63 původních souborů i původní instalace zůstaly nedotčené.
Průchod odhalil vnucený scaffold vstup a prázdný výběr ukázek. Návazná obecná
oprava **`9660d99b` je aktuálně nasazená**: skutečný package manifest,
zachování importovaných konvencí, doplnění volného kontextu a CJS/JS Node testy.
Projektová sada 28/28; vlastní úplný profil 359 PASS / 1 FAIL Gate 0 / 0 BLOCKED.
Nasazení proběhlo až po uvolnění GPU zámku, s ověřením původní verze i dat.
Následná skutečná D1 odpověď správně rozpoznala main, CJS i testovací příkaz,
s 3 pozorovanými ukázkami v nezměněném 4096 profilu. Nejde o audit celého
ShellSmithu ani kontrolovaný A/B benchmark.

**Následující checkpointy jsou historické, nikoli aktuální stav tří utilit.**

**Desktopové projektové kroky, 2026-09-19:** nasazeno `d22f64ac`.
Celý původní cíl a aktuální oprava mají přednost před staršími zprávami.
Kontext existujících modulů pouze ke čtení, pozorované
adresáře a jedna strukturální oprava plánu. General i Desktop mají kanonická
pravidla; inventura podporuje i přesné souborové kořeny se stejnými limity.
M2 66/66, projekt 23/23, Studio 39/39; celý profil 359 PASS / 1 FAIL (Gate 0).
Nové integrační testy projdou skutečným základem → draftem → sandboxem → commitem;
generátor je v nich fixture. SystemSmith_1 z reálného modelu zůstává
**APPLICATION_INCOMPLETE**, produkční systemd sandbox BLOCKED AppArmorem.
Modelové návrhy včetně posledního s 14/14 vlastními testy odmítla nezávislá
kontrola; žádný utility kód není aplikovaný. Zůstává práce na kvalitě oprav
modelu i všech funkcích monitoru, nikoli pouze na provozním sandboxu.
Neúspěšné modelové návrhy i běhy auditu jsou zachované. REVIEW_PENDING.
[Průchod, opravy a zachované neúspěchy](docs/review/2026-09-19-SYSTEMSMITH-PROJECT-FLOW.md).

**Studio — dotažení předloh, 2026-09-18:** nasazeno `0ef67a56`.
Sémantická paleta, barevná navigace/role, 12 sekčních přehledů, kompaktní
karty, miniatury stylů a živý náhled. Electron v šířce 960/1400, text
0/100 %, kandidáti a restart ověřeny. 359 PASS / 1 FAIL (stávající Gate 0).
REVIEW_PENDING. [Snímky a důkazy](docs/review/2026-09-18-IDE-DESIGN-REFINEMENT.md).

**IDE vzhled, 2026-09-18:** nasazeno `9ab808f1`, zachováno novější hodnocení
z `230778ad`. Dvě ikony rozložení, výraznost veškerého textu, 12 kategorií /
33 záložek nastavení a volitelný styl Studio. Skutečný Electron, min/max textu
a restart PASS; úplný profil 359 PASS / 1 FAIL (nezměněná Gate 0 pečeť).
REVIEW_PENDING. [Rozsah a důkazy](docs/review/2026-09-18-IDE-APPEARANCE.md).

**IDE a GPU hunt, 2026-09-18:** nasazeno `576719bf`. Řazení hlavičkou,
celé použitelné role v jedné evaluaci, číselné matice, 249 kandidátů ze
sloučeného katalogu, záložky/kontext/sloupce/soubory a zarovnané seznamy.
119 cílených/navazujících Node testů, 20 kontrol instalovaného GUI PASS;
úplný profil 359 PASS / 1 FAIL (nezměněná Gate 0 pečeť). Data zachovaná.
REVIEW_PENDING. [Rozsah a důkaz](docs/review/2026-09-18-IDE-HUNT-POLISH.md).

**Obnova hlavní navigace, 2026-09-18:** nasazeno `57726969`. Opravená
regrese obnovy uloženého rozložení: levé menu zůstává vedle nastavení a katalogů;
sbalení ponechá pás ikon, zmizel i prázdný pravý panel. Ověřeno 17 GUI kontrol
z instalované kopie, 25 workspace regresí a 71 navazujících kontrol PASS.
Úplný profil 359 PASS / 1 FAIL (nezměněná Gate 0 pečeť). REVIEW_PENDING.
[Review a meze](docs/review/2026-09-18-IDE-SIDEBAR-RESTORE.md).

**IDE pracovní prostor, 2026-09-18:** nasazeno `c52b03ff`, pojmenované relace,
samostatné sloupce chatu/souborů/výstupů, historie a knihovny specialistů,
centrální katalogy a nastavení. Aktivní názvy IntentSmith, kompatibilita starých
dat zachovaná. 106 cílených testů PASS, produkční build a skutečné GUI PASS;
úplný profil 359 PASS / 1 FAIL (nezměněná Gate 0 pečeť). REVIEW_PENDING,
M2 systemd AppArmor a M5 historie stále otevřené.
[Review a meze](docs/review/2026-09-18-IDE-WORKSPACE.md).

**Stahování a CODE postup, 2026-09-18:** instalováno `39cad5f1`.
Gemma4:31b dokončená 15:13:26 CEST; Studio má trvalý průběh s rychlostí/ETA
a obnovou spojení. Tři nová CODE měření přes GUI (63 vyhodnocení):
Qwen3.8 71,4 %, Devstral 32,4 %, Ornith 25,7 %. CODE zůstává Qwen3.8.
Startup probe nenechává runner dalších pět minut v GPU. Fyzické GUI ověřené
včetně historie, viditelnosti karty a zachování posunu během pollingu.
Úplný profil 359 PASS / 1 zděděný FAIL release pečeti. REVIEW_PENDING;
na disku zůstává přibližně 16 GiB, další automatické stahování omezuje rezerva.
[Review a důkazy](docs/review/2026-09-18-MODEL-DOWNLOAD-JOURNEY.md).

**Projektový flow, 2026-09-18:** nasazeno `5e46fca7`, nový projekt → návrh →
přesný M2 krok; existující cizí projekt → čtecí analýza → cíl a priority.
Úplný gate 358 PASS / 1 FAIL (nezměněná release pečeť), Studio build PASS.
Skutečný systemd M2 průchod je **BLOCKED AppArmorem**; privátní IDE/Studio
zkouška tento provozní problém neodhalila. Profil a postup připravené, vyžadují
heslo správce. REVIEW_PENDING, bez tvrzení production-ready.
[Packet a přesné meze](docs/review/2026-09-18-PROJECT-FLOW.md).

**Detail měření a kandidáti, 2026-09-18:** instalováno `2ca3cca1`.
Řazení a propojování tabulek, vysvětlený rozpad úloh, detail konkrétního měření,
aktualizovaný katalog (API 82 kandidátů, 26 VISION, 13 vydaných v roce 2026)
a šest dostupných diagnostických zdrojů. Instalované Studio ověřeno proklikáním
7/7 záložek; 516 měření / 234 rozhodnutí / 7 bindingů beze změny.
Úplný profil 358 PASS / 1 zděděný FAIL release pečeti. Šest dostupných zdrojů
neznamená šest změřených kvalit; širší quick/full benchmark zůstává mimo tuto
změnu. [Rozsah a evidence](docs/review/2026-09-18-MODEL-DETAILS.md). REVIEW_PENDING.

**Obnova modelového pracoviště, 2026-09-18:** operátor znovu otevřel vadu po
restartu backendu: HTTP zůstávalo na starém portu i po úspěšném WS reconnectu.
Instalováno `9f9ed339`; 7/7 záložek ověřeno při nedostupných datech i po rotaci
portu/capability, odděleně 7/7 nad produkční DB po skutečném restartu služby.
Skóre/historie/bindingy nezměněné. Kombinovaná validace 358 PASS / 1 zděděný
FAIL release pečeti; REVIEW_PENDING. Původní otevřené Studio potřebuje jedno
zavření a nové spuštění ikonou; jeho frontend se za běhu nevyměnil.
[Review, negativní pokusy a meze](docs/review/2026-09-18-MODEL-WORKSPACE-RECONNECT.md).


**Základ změřen 2026-08-02 na `17a8b9a8`; pre-fix OS-isolated scan proběhl na
`24457ba2`; registry klasifikace byla opravena v `06309bc8`, post-fix scan
aktuálního registru proběhl na `a85c344f` a izolovaný HTTP/restart baseline na
`ac320335`. Fresh-clone Studio probe proběhl na dokumentačním HEAD `df8f1039`
se zdrojovým stromem shodným s `ac320335`; registrovaný Electron boundary
runner byl znovu fresh-clone ověřen na `7236d221` a současný legacy runtime
byl offline buildem a 65s non-visual journey znovu potvrzen na `9464dacf`.
Finální M1 fresh-install journey prošel na `d518d7ec` přes built Electron,
skutečný server/SQLite/Ollamu i kontrolované negativní terminály.**
Neutrální dokument, nezávislý na nástroji.
Pravidla vývoje: [`CONTRACT.md`](CONTRACT.md) · Detail: [`docs/inventory/`](docs/inventory/)

**Modelové pracoviště Studia, 2026-09-18:** instalováno `9298ef46`.
Uložená denní GPU inventura, skutečný nový ruční test, čekání na GPU,
tabulky rolí a kandidátů, detail úloh, historie a vysvětlený Správce.
Hunt dává přednost slabým/chybějícím rolím. Úplný profil 358 PASS / 1 FAIL
(zděděná release pečeť), řízený fyzický Electron PASS. Tři nové CODE sady
z běžného GUI: Qwen3.8 71,4 %, Qwen3.5 33,3 %, Qwen Coder 11,4 %;
63 vyhodnocení, nové DB řádky, starší historie i bindingy zachované.
REVIEW_PENDING.
[Review a průběžná živá evidence](docs/review/2026-09-18-MODEL-WORKSPACE.md).

**Předchozí instalace po opravě evaluace, 2026-09-17: `2f150ce7`.** Ruční
výběr modelu už ověřuje skutečné pole digestu v inventáři; Studio zobrazuje
fázi, úlohu, opakování, počty a podložený odhad času. Živý Qwen3.5:27b/CODE
na 8d1da07e dokončil 21 vyhodnocení, skóre 2/7, RESPONSE_BOUND; finální API
vrací stejné COMPLETE skóre. Historie a bindingy zachované. Dva úplné profily
358 PASS / 1 FAIL (release pečeť), řízený fyzický Electron PASS, REVIEW_PENDING.
[Packet](docs/review/2026-09-17-EVALUATION-PROGRESS.md).

**Předchozí instalace po privacy review, 2026-09-17: `365a4f1d`.** Informační API relací obcházelo
`saveContext=false` do dalšího tahu chatu. Policy nyní platí přímo při
serializaci bez vytváření relace či změny lifecycle; negativní reprodukce
a cílené HTTP/in-process regrese jsou doložené. Úplný profil **358 PASS /
1 FAIL** (release pečeť); čistá instalace, zachování sledovaných DB tabulek
a spuštění Studia ověřené. Nezávislé přijetí zůstává otevřené.
[Packet](docs/review/2026-09-17-SESSION-INFO-PRIVACY.md).

**Navazující M5 inventář, 2026-09-17:** 15 známých historických objektů
(původních 13 + testovací TLS klíč a veřejný certifikát). Červencový containment
je zachovaný; zářijové odstranění je samostatný záznam. Nový podpis nesmí
použít starý scan 13/13. [Remediace a meze review](docs/review/2026-09-17-M5-TLS-HISTORY-REMEDIATION.md).
Osm starších instalací obsahuje zbytkové kopie stejného páru; jejich obsah
se nemění a nepočítá se jako nové Git objekty. V době inventury aktivní `d4dea0bb` je bez
páru. Původní soak přerušen restartem hostu 21:20 (FAIL/SIGTERM), nový
24h běh na `d4dea0bb` začal 21:26 CEST a není dosud PASS. Tato větev
v inventarizačním kroku neměnila živou instalaci. [Inventura](docs/execution/runs/m5-tls-residual-copies-20260917.json).

**Předchozí společná instalace 2026-09-17:** `c2989a3e` spojuje opravy
soukromí/panelů, specialisty, časový kontext a Studio design `023af4dd`.
Celý offline/database profil: **358 PASS / 1 FAIL / 0 BLOCKED**; jediný
FAIL je release pečeť, bez změny její autority. Šest HTTP programů / 134
kontrol, Studio build v čistém klonu, privacy scanner aktuálního stromu,
skutečné otevření ikonou a reload PASS. Sledované DB tabulky nezměněné.
Pětiminutový health throughput PASS; 24h soak od 18:29 CEST teprve běží.
GPU/NVML a provider Sázkaře jsou BLOCKED, nezávislé přijetí a M5/M6 otevřené.
[Packet a přesné meze](docs/review/2026-09-17-PRODUCTION-CLOSEOUT.md),
[checksumy důkazů](docs/execution/runs/production-closeout-20260917.json).

**Předchozí společná instalace 2026-09-17:** `3f005fc0` spojuje specialisty,
opravný commit `3bbf8bc1` (privacy/panely) a obecný časový kontext.
Privacy + Studio focused PASS; fyzická geometrie a vstupy chatu ověřeny
přes skutečnou ikonu i reload běžného profilu. Profil společného zdroje
na `e564f22c` má **357 PASS / 1 FAIL / 1 BLOCKED**: release pečeť a oddělený
OCR runtime. OCR program samostatně ve svém prostředí PASS. Produktové
zdroje jsou shodné s instalovaným `3f005fc0`; 354/1 níže patří předchozímu
`3bbf8bc1`. Neúspěšný profil z dlouhé instalační cesty a kolísání heap testu
jsou zachované v [navazujícím packetu](docs/review/2026-09-17-PRIVACY-PANELS-REREVIEW.md).

**Oprava specialistů ve Studiu, 2026-09-17:** kandidát `be0f5d65` integruje
účetní dokumentový workflow a autonomního Sázkaře, zachovává instalovanou
opravu časového kontextu `58d7cced`. Čistý instalační snapshot: 7/7 focused
PASS a skutečné Electron PDF/HEIC journey PASS. Celý profil: 356 PASS /
2 FAIL / 1 BLOCKED (release seal, dokumentační formát LOC, oddělený OCR
toolchain). Oprava formátu a konečný stav instalace mají vlastní záznam v
[review packetu](docs/review/2026-09-17-STUDIO-SPECIALISTS.md).
Živý sázkař je PROVIDER_BLOCKED na zdroji historie; integrace REVIEW_PENDING.

**Re-review R1–R3, původní ověřený kandidát `3bbf8bc1`, 2026-09-17:** logování kompatibilního
chatu a projektová pracovní paměť mají navazující regresní opravu; panelový
commit `4fca7e67` je integrován jako `da0c9120`. 36 privacy/settings testů
a produkční Studio build PASS. Úplný profil **354 PASS / 1 FAIL**, jen známá
release pečeť. Fyzické panely: 240/416 px, dostupné také po reloadu, ověřeno
v privátním i běžném profilu. Sledované DB tabulky mají nezměněné hashe.
Nové nezávislé přijetí zůstává otevřené, původní verdikt je `CHANGES_REQUIRED`.
[Packet](docs/review/2026-09-17-PRIVACY-PANELS-REREVIEW.md).

**Předchozí lokální instalace 2026-09-17:** `58d7cced`, větev
`work/chat-date-context-20260917`. Časový kontext v každé interaktivní
modelové odpovědi je odvozený ze skutečných hodin a lokálního časového pásma.
Fyzický model přes instalovaný HTTP backend správně použil včera/dnes/zítra
ve tvůrčím zadání (16./17./18. 9. 2026). HTTP sequence bez modelu i kontrola
provider payloadu prošly. Celý profil **353 PASS / 2 FAIL** (dokumentační
fráze opravena v následném dokumentačním commitu; release seal zůstává).
[Packet](docs/review/2026-09-17-CHAT-CLOCK-REVIEW.md),
[run record](docs/execution/runs/chat-clock-20260917.json). REVIEW_REQUIRED.

**Předchozí lokální instalace a opravy revize 2026-09-17:** `1da840c0`,
větev `work/review-remediation-20260917`. Automatické učení respektuje
nastavení i projektovou hranici; Studio potvrzuje pouze skutečné native
agentí výsledky. Režim bez historie není implementovaný, API jej odmítá
a již uložené false blokuje nový chat. Úplný profil: **354 PASS / 1 FAIL**,
jen očekávaný release seal. Produkční Studio build, 10 nových regresí
v čistém instalačním snapshotu a spuštění přes ikonu jsou ověřené.
[Review packet](docs/review/2026-09-17-PRIVACY-AGENT-REMEDIATION.md),
[strojový záznam](docs/execution/runs/privacy-agent-remediation-20260917.json).
Stav **IMPLEMENTED / INSTALLED / REVIEW_REQUIRED**, nikoli přijatý release.

**Předchozí společný kandidát (publikační kontrola 2026-09-17):** runtime
`20e5a022`, publikační kontrola zdroje `26a038db`, větev
`work/hunt-review-followup-20260912`. Nový úplný deterministický profil má
353/353 PASS; [run record](docs/execution/runs/github-publication-20260917.json)
zachovává i původní 352 PASS / 1 FAIL a opravu kalendářní závislosti testu.
Produktové zdroje jsou shodné s `20e5a022`, jeho produkční Studio build
prošel 2026-09-12. Fyzický dvousouborový build/restart/restore
má [ohraničený review receipt](docs/review/2026-09-12-PRODUCTION-JOURNEY-REVIEW-RECEIPT.md);
novější [hunt/core delta](docs/review/2026-09-12-HUNT-REVIEW-FOLLOWUP.md) zůstává
REVIEW_PENDING. Údaje o modelovém panelu jsou měření z 2026-09-12, nikoli
nově spuštěné modelové testy z 2026-09-17. Starší checkpointy níže zůstávají
historickou evidencí svých přesných revizí.

> Čísla níže jsou **změřená**, ne převzatá. Kde se rozcházejí se starší
> dokumentací, platí tento dokument.

---

## Spuštění

```bash
npm install                   # 233 balíčků, ~16 s
node src/server.js            # http://127.0.0.1:3335
node --watch src/server.js    # vývoj
```

**Prerekvizity:** Node.js 22+ · SQLite (better-sqlite3) · Ollama pro LLM cesty
(bez ní běží deterministické intenty, ostatní vrací `LLM_PROVIDER_UNAVAILABLE`)

```bash
npm test                      # deterministické sady
node scripts/validate-test-registry.js
```

**Prerekvizity sad — stav k 2026-08-03.** Deklarace byla empiricky prověřena v
OS network namespace bez odchozí routy. Autoritativní post-fix run na
`a85c344f` vybral 203 programů a skončil `200 PASS / 1 FAIL / 2 BLOCKED`, exit
`1`; proto nejde o zelený celek:

| Sada | Stav |
|---|---|
| `export-pdf-docx`, `chat-export-budget` | **Vyřešeno.** Deklarováno jako `BLOCKED` s prerekvizitou `toolchain: python-pdf-runtime`. Instalace: `./scripts/install-pdf-runtime.sh` |
| `quality-gate` | **Nereprodukuje.** Bez `go` na PATH projde 22/22. |
| `multi-source-integration` | **Vyřešeno.** 12 offline testů zůstalo; 2 BBC/OpenMeteo testy jsou v samostatné `network: external` sadě. |
| `dependency-manager` | **Vyřešeno.** Unit test už nespouští skutečné `npm install`; fake executable ověřuje přesně tři pokusy bez sítě. |
| `harness-exit-code` | **Vyřešeno.** Po review import graphu je pin 95; mutační kontrola stále prokazuje odstranění isolation anchoru. |
| `nightly-orchestrator-self-test` | **M6 release baseline opravený a změřený.** Required PDF/export programy jsou pravdivě ACTIVE nad explicitním lokálním Python runtime, zapečetěný candidate plán má registry fingerprint `3593af7c…` a exact candidate `8abd6065` prošel `296/296` deterministickými programy včetně orchestration self-testů. |

Registr do 2026-08-02 **toolchain deklarovat neuměl** — `hasConcreteBlockedPrerequisite()`
uznával jen network/server/ollama/gpu, takže sada potřebující Python musela
zůstat `ACTIVE` a padat. To je přesně mezera, kvůli které `G0-C7` tuhle třídu
chyby nezachytil. Doplněno `requirements.toolchain`.

### Aktuální runtime baseline

Na přesném `ac320335` proběhl server v izolovaném runtime rootu s prázdným
`HOME/XDG/TMP`, vlastní DB, projekty a output adresářem, bez zděděných tajemství
a s vypnutým online discovery, ComfyUI a autonomií:

- health `200` za 19 ms a založení konverzace `201`;
- skutečný HTTP deterministický dotaz `17 * 23` vrátil přesný výsledek za 22 ms;
- skutečný HTTP modelový dotaz přes `qwen3.5:27b` vrátil odpověď za 24 784 ms;
- před restartem byly uloženy přesně čtyři turny; po stop/start nad stejnou DB
  byly načteny stejné čtyři role za 19 ms;
- samostatná modelová behavior sada CRE prošla **9/9**, exit `0`; studená první
  klasifikace trvala 20 966 ms, následující přibližně 1,1–1,3 s.

Lokální raw evidence zůstává mimo Git v
`.intentsmith-artifacts/runtime-baseline.qAU9qe/`; sanitizované JSON souhrny mají
SHA-256 `2700a942…d8c37` před restartem a `8d123f79…42bb68` po restartu. Toto
je **current-checkout pozorování**, nikoliv přenositelná release evidence:
neobsahuje commitnutý runner ani environment manifest. Tento starší baseline
sám neprokazoval fresh-clone instalaci ani Theia runtime; následný WP-M0-E je
změřil samostatně níže a odkryl dvě Studio produktové vady.

### Aktuální Studio baseline

WP-M0-E na `df8f1039` použil dva disposable čisté klony; produktové cesty jsou
od `ac320335` beze změny. `npm ci`, frozen Yarn install a production Theia build
prošly exit `0`. Build zabalil byte-identický commitnutý
`c3-chat-panel/lib/browser/chat-panel-module.js`, nikoliv stale TS source.
Samostatný package build `@c3/chat-panel` skončil exit `1` na šesti chybných
importech a před selháním změnil 4 trackované a vytvořil 36 untracked generated
výstupů pouze v disposable klonu. Repozitář přitom v `docs/dev-checklist.md`
výslovně označuje commitnutý JS za ručně udržovaný runtime a `tsc -b` zakazuje.

Diagnostický runtime v OS network namespace při počátečním bootu přešel do
`ready`, provedl WS handshake a přes skutečný Studio panel vrátil
deterministické `17*23 = 391` za 24 ms. Současně odkryl dvě produktové vady:

- renderer se pokusil načíst Google Fonts i pod blokovaným outboundem;
- sedm startup Studio HTTP rodin, včetně dříve vynechané `/api/agents`, vracelo
  `403`. Sanitizovaná CDP revalidace na `1fc8f03e` prokázala, že existující
  bootstrap capability na wire posílá;
  Chromium ale z `file://` posílá `Origin` nepřítomný a
  `Sec-Fetch-Site: cross-site`. Backend proto správně odmítá
  `CROSS_SITE_WITHOUT_ORIGIN` ještě před capability větví. Rozbitý je spoj mezi
  browser transportem a policy kontraktem, nikoliv instalace shimu.

DevTools Network záznam nebyl zachován jako strojově čitelný artefakt; konkrétní
URL, wire header a Fonts pokus jsou current-host observation, zatímco uložený
backend log potvrzuje opakovaná boundary odmítnutí. Při teardownu přibližně šest
minut po startu skončil Electron po ztrátě GPU procesu `SIGTRAP`, současně s
řízeným `SIGTERM` backendu. Diagnostický namespace a `--no-sandbox` neumožňují
rozlišit environment teardown od produktové vady: počáteční journey prošla,
stabilita a clean shutdown nejsou prokázané.

Detail, přesné build příkazy a lokální screenshot/logy jsou v
[`docs/inventory/21-studio-ws.md`](docs/inventory/21-studio-ws.md). M0 tím
získalo fresh-clone install/build a initial boot/chat pozorování, ale Studio
část končí `PRODUCT_FAIL + STABILITY_INCONCLUSIVE`, ne `PASS`.

Následná oprava zachovala autoritativní `lib`, odstranila Google Fonts egress a
normalizovala opaque Electron Origin pouze za přesnou local capability. Na
`7236d221` pak remote fresh clone prošel `npm ci`, frozen Yarn instalací a
production buildem. První automatizovaný běh skončil časným pre-CDP `SIGTRAP`,
druhý odkryl chybnou interpretaci legacy `cre_decision` v runneru. Po opravě
proběhly dva samostatné `PASS`, exit `0`: 648 CDP událostí, nulový external i
other-loopback provoz, přesný boundary trojúhelník, korelovaný deterministický
turn bez provider requestu či efektu, nejméně 65 s live-ready a čisté exity
Electronu i backendu. Současný vzhled nebyl hodnocen. Červené běhy i oba PASS
artefakty jsou v
[`docs/review/2026-08-08-STUDIO-ELECTRON-BOUNDARY.md`](docs/review/2026-08-08-STUDIO-ELECTRON-BOUNDARY.md).

T5 runner zůstává registry `BLOCKED`, protože standardní auditní orchestrátor
zatím nevyrábí jeho production build. To neanuluje current-host fresh-clone
výsledek, ale brání vydávat ručně splněnou prerekvizitu za nightly readiness.

---

## Rozsah

Aktuální tabulka zahrnuje opravy soukromí/agentů z 17. 9. (519 programů).
Historické výsledky níže nadále patří svým přesným source pinům.

Předchozí desktop/hunt checkpoint `9d13bb53` s testovacím follow-up `2587ae56`,
2026-09-17. Společná instalace, produkční backend, GTK desktop launcher a GUI
huntu jsou fyzicky ověřené. Finální profil: **353 PASS / 1 release-seal FAIL**.
Obsah 503 modelových evaluací, 21 hunt attempts a 7 desired bindings se proti
předinstalační záloze nezměnil. Novou kalibraci blokuje ovladač GPU; nová delta
není nezávisle přijatá. [Packet tohoto checkpointu](docs/review/2026-09-17-DESKTOP-HUNT-REVIEW.md).
Následující dřívější výsledky si zachovávají vlastní piny.

Společný kandidát včetně sidebar opravy `9d5e207a`: **353/353 PASS** a
produkční Studio build na čistém `20e5a022`. Změna kontraktu + timeout
incumbenta má DB retry regresi. Panel D1/D2/R1/R2 je dokončený (12 kandidátů,
0 roleErrors); 13/38 duelů má nedostatečný důkaz. Stav je
**REVIEW_PENDING**, nikoli release acceptance. [Evidence a hranice](docs/review/2026-09-12-HUNT-REVIEW-FOLLOWUP.md).

Studio model controls jsou instalované na `08f8d1c5`: filtr odhadované VRAM,
řazení kandidátů, test konkrétního instalovaného modelu/role a vysvětlení
chybějícího aktuálního skóre. Offline/database **358 PASS / 1 FAIL** (registry
release pečeť), řízený fyzický Electron PASS. Živé GPU měření je **BLOCKED**
na nesouladu NVIDIA 595.84 / NVML 595.91; nové inference skóre nevzniklo.
Tlačítka a filtry odpovídají motivu; chyby testu jsou přímo u modelu a role.
**REVIEW_PENDING** — [aktuální UI oprava a evidence](docs/review/2026-09-17-HUNT-MODEL-CONTROLS-FOLLOWUP.md).

| | |
|---|---:|
| `src/**/*.js` | **231 172 ř.**, 672 `.js` souborů v pracovním kandidátu |
| `tests/**/*.js` | **252 790 ř.**, 551 `.js` souborů v pracovním kandidátu |
| Registrovaných testových programů | **555** (`461 ACTIVE`, `79 BLOCKED`, `15 HISTORICAL`) v integračním manifestu; úplný profil má samostatný výsledek |
| Tabulek v čerstvé DB / aplikovaných migrací | **185 / 107** |
| HTTP rout | **Nezměřeno na integračním SHA**; hunt snapshot měl 246 statických deklarací |
| **Historický capability souhrn po B6** | **7 z 22** `ACCEPTED/PASS` v tabulce níže; jde o rozsah B6, nikoli procento hotovosti celého produktu ani nových změn. Novější přijetí M2–M4 a aktuální opravy mají vlastní scope a důkazy. |

Aktuální registry fingerprint je
`11dc87a658024842a4696a1bf024bd153671d5b56655a0f69ddd1767553397bb`.
Historický post-fix scan na `a85c344f` zůstává platný pouze pro tehdejší
fingerprint; současný registry řádek sám není akceptační důkaz.

Technická integrace core 2026-09-09 přebírá mobilní `2f11e911` a B
`0b0a4669`. Registry obsahuje 413 `ACTIVE + required`, z toho 352 deterministic
(`279 offline + 73 database`). Nezávislé review odhalilo injekci systemd vstupu
a chybný hash M7 indexu v Android manifestu; obě opravy i přesné rozlišení
veřejného credential názvu v privacy scanneru prošly nezávislým review a
integračním během na `70eef905`. Navazující `a71e5b98` opravuje podporovaný
061/066 upgrade modelové politiky a zastaralý role-config test; tehdejší čistý
deterministic běh má 351 PASS / 1 sealed-registry FAIL. Registry má 19
support exclusions včetně přesné historické migrační fixture; všech 512
spustitelných položek je zachováno. Historický `f7f78d5a` zůstává
`350 PASS / 1 FAIL`; jeho dřívější artifact-binding claim má nově potvrzenou
vadu. Tehdejší sealed policy z B (`922f65e9…0b40`, 351 deterministic) vysvětluje
historický FAIL. Reviewed refresh `573c7d92` nyní připíná současný fingerprint
`3ce12a0e…fdbbfc` a všech 352 required deterministic programů; původních 511
programových řádků zůstalo beze změny, přibyl mobile offline program a přesná
061 support fixture. Následný clean `69b52278` má 352 PASS / 0 ostatních stavů
s existujícími dependencies. Historické FAIL reporty ani podmínky M6 acceptance
se nemění; [aktuální source-specific důkazy](docs/execution/runs/m6/core-completion-followup-20260909.md).

Aktuální model-evaluation autoritu popisují
[`MODEL-SCORING-ACTIVATION.md`](docs/MODEL-SCORING-ACTIVATION.md) a
[`030-model-evaluation-authority-consolidation.md`](docs/decisions/030-model-evaluation-authority-consolidation.md).
Tyto dokumenty nahrazují historické auto-failover/proof lifecycle popisy v
pozdější capability tabulce: veřejné auto-transition repository writery jsou
odstraněné a gateway, binding verification i autoritativní scoring vyžadují
digest přímo v provider response. Při srpnovém měření nainstalovaná systémová Ollama
0.32.14 jej neposkytuje, takže durable runtime zůstává záměrně fail-closed.
Remediovaný source rozsah `74beafea..26ab3291` prošel nezávislým Opus max
`REVIEW_PASSED`. Autorizovaný installed-panel scoring 2026-08-28 proběhl přes
izolovaný patchovaný sidecar. Přijatý 13artefaktový snapshot obsahuje 79
kompatibilních model-role párů: 55 `COMPLETE`, 24 `BLOCKED`, 0 applicable
`MISSING`; 12 raw `MISSING` je explicitní N/A. Z COMPLETE evidence má 15 běhů
ověřený skutečný interval a 40 starších current-contract řádků je veřejně
označeno `LEGACY_UNVERIFIED` bez publikovaného startu a duration. Produktový
head `53ded662` navíc ukládá SHA-bound normalizovaný inventory vstup a jeho
offline replay nad stejnou DB reprodukuje 55/24/0/12 bez kontaktu s providerem.
Nezávislé rereview rozsahu `d6137d4c..3f027938` zopakovalo replay, SHA/tamper
kontrolu, manifest i clean-clone gate 279/279 a vrátilo
[`REVIEW_PASSED`](docs/review/2026-08-28-WP-MODEL-EVALUATION-EVIDENCE-REREVIEW.md).
Srpnový scoring/evidence balík je `ACCEPTED`; systémový response-digest provider
byl v tomto snapshotu samostatně `SYSTEM_PROVIDER_BLOCKED`. Evidence:
[`model-scoring-live-20260828.md`](docs/execution/runs/model-scoring-live-20260828.md).
Po následném explicitně autorizovaném odstranění čtyř VRAM-blocked exact
artefaktů měla inventory ve snapshotu 2026-08-28 devět modelů a 55/0/0/8 coverage
(`COMPLETE/BLOCKED/applicable MISSING/N/A`); DB historie i bindingy zůstaly
beze změny. Důkaz:
[`model-removal-live-20260828.json`](docs/execution/runs/model-removal-live-20260828.json).

Tool census ze zdroje: **9 JavaScript soubory, 8 905 řádků, 153 top-level
nástrojových deklarací**. Počet 213 v dřívější inventuře byl textový false count.

---

**Provozní checkpoint 2026-09-09:** Systémová Ollama `0.32.14-intentsmith.1` byla aktivována a nezávisle
ověřena. Na čistém `ceb8de93` prošly dvě řízené operace pro `qwen3.5:27b`,
digest `7653528b…8ec06e`: typed exact verification a gateway s usage/claim
evidencí v soukromé kopii DB. Původní absence response digestu již není
blokátorem tohoto ověřeného rozsahu. Celý modelový panel, startup serveru,
koordinace přes živou DB a release acceptance tím ověřeny nejsou.
[Run a přesné identity](docs/execution/runs/m6/provider-activation-20260909.md).

## Capability picture 22/22 — historický rozsah B6

Tato tabulka zachovává dřívější rozpad B6; není souhrnem všech následných
přijetí M2–M4 ani aktuálního auditu. Aktuální remediace je uvedena pod ní.
Příčka není procento hotovosti.
`BROKEN` označuje potvrzenou dílčí vadu a může stát vedle příčky. Modulový test
sám nikdy neposouvá schopnost na `USER_JOURNEY_VERIFIED`.

| # | Uživatelské chování | Stav | Nejbližší chybějící důkaz nebo potvrzená vada |
|---|---|---|---|
| 1 | Spustí server na loopbacku, připraví DB a obslouží API. | `ACCEPTED/PASS` | B6 fresh clone spustil skutečný server nad izolovanou SQLite, obsloužil API a skončil s čistým shutdownem. |
| 2 | CRE vybere hlídaný intent; deterministická cesta nevolá model. | `ACCEPTED/PASS` | Přijaté offline i Ollama behavior sady jsou 10/10 a 9/9. |
| 3 | Modelový požadavek jde na lokální Ollamu nebo skončí typovanou chybou. | `ACCEPTED/PASS` | B6 doložil exact lokální `qwen3.5:27b`, HTTP 503 outage a cancel/error seams bez false-success. |
| 4 | Uživatel založí či obnoví konverzaci a historie přežije restart. | `ACCEPTED/PASS` | B6 obnovil exact 50/50 zpráv po skutečném restartu; outage ani cancel neuložily assistant success. |
| 5 | Výsledek je deterministicky ohodnocen bez přidání nového obsahu. | `ACCEPTED/PASS` + `BROKEN` | Decision 024/C odstranilo post-answer modelový rewrite po fyzickém A/B; scorer telemetrie zůstává špatně zkalibrovaná pro krátké správné FACTUAL odpovědi (finding 011). |
| 6 | Chat request projde routingem, syntézou a finalizací do jednoho pravdivého výsledku. | `ACCEPTED/PASS` | B6 prošel success/error/cancel/restart přes veřejné HTTP i negotiated Studio `m1-wire-v1`; refinement caller je odstraněný. |
| 7 | Expertiza se vybere a měřitelně ovlivní odpověď. | `RUNTIME_VERIFIED` + `BROKEN` | Explicitní `code_reviewer` se stále neroutuje; chybí route→chat E2E. |
| 8 | Zapnutý specialista využije expertizu a nástroje; vypnutý nezasáhne. | `RUNTIME_VERIFIED` + `BROKEN` | L0-8 interní import a chybějící enable→route→output→disable E2E. |
| 9 | Skill z triggeru získá vstupy a approval a provede známý postup. | `RUNTIME_VERIFIED` | Celý skill až po ověřený výstup a negativní effect boundary. |
| 10 | Lifecycle vede projekt od záměru přes plán a provedení ke kontrole. | `RUNTIME_VERIFIED` | Celý SPEC→roadmap→build→review a recovery journey. |
| 11 | Po approvalu provede scoped patch, test a při selhání rollback. | `EXISTS` | Skutečný uživatelský patch/test/diff/rollback journey. |
| 12 | Code Intelligence vysvětlí projekt a vrátí schválenou konvenci do dalšího kontextu. | `EXISTS` + `BROKEN` | Pattern miner nemá produkční import; chybí learn→next-context round-trip. |
| 13 | Governance zachytí architektonický, API nebo regresní drift. | `EXISTS` | Reálný lifecycle checkpoint, který vadu skutečně zablokuje. |
| 14 | Zapnutý agent reaguje na zdroj a ukáže výsledek; vypnutý nic neudělá. | `RUNTIME_VERIFIED` | První viditelný agent E2E a disabled negativní cesta. |
| 15 | Projektová paměť se uloží, vrátí a lze ji zeslabit či smazat. | `EXISTS` + `BROKEN` | PatternTracker se zapisuje, ale nemá produkčního konzumenta. |
| 16 | Typovaný nástroj projde jednotnou policy/approval hranicí a vrátí strukturovaný výsledek. | `EXISTS` | Chat/skill→tool→effect→audit journey a společná M2 authority. |
| 17 | Uživatel nakonfiguruje a obdrží auditovanou notifikaci. | `EXISTS` | Skutečné doručení ve Studiu a negativní channel cesta. |
| 18a | Uživatel vidí lokální modely a stabilní role přizpůsobené VRAM. | `RUNTIME_VERIFIED` | Current-SHA role/binding/degradation journey přes API a Studio. |
| 18b | Explicitně vyvolaná kontrola navrhne upgrade, který lze schválit či odmítnout. | `RUNTIME_VERIFIED` | Úmyslný check→approve/reject→rollback a finální disposition. |
| 19 | Explicitně otevřený katalog transakčně instaluje, aktualizuje či odebere balíček. | `EXISTS` | Lokální katalog a external install/rollback journey. |
| 20 | Uživatel generuje, ruší a spravuje média bez konfliktu o VRAM. | `EXISTS` + `BROKEN` | Studio render I/O a neukončený `healthTimer`; chybí ComfyUI journey. |
| 21 | Ve Studiu chatuje, vidí progress, ruší práci a po reconnectu obnoví stav. | `ACCEPTED/PASS` | Built B6 doložil 2 panely, 5 terminálů, 12 progress eventů, cancel/error, reconnect, exact negotiation, nulový egress a čistý shutdown. |

Souhrn: **7 `ACCEPTED/PASS`, 7 `RUNTIME_VERIFIED`, 8 `EXISTS`; 6 řádků
mají dílčí `BROKEN`**. Žádná další schopnost zatím nemá obhajitelný stav
`USER_JOURNEY_VERIFIED`. Inventury jsou detailní pracovní podklad; tento lehký
obraz je jediný stavový souhrn.

---

## Schopnosti a jejich soubory

Toto je závazné mapování schopnost → kód. **Hranice schopností nekopírují
adresáře** — u čtyř schopností kód leží jinde, než by název adresáře čekal.

> **2026-08-02:** #11 se srovnalo — `execution-loop.js`, `error-normalizer.js`
> a `fix-strategy.js` přešly z `planner/` do `executor/`. Byla to uzavřená
> trojice se dvěma dotyky ven.
>
> **#13 se srovnat nedá a je to doloženo.** `architecture-check.js`
> a `architecture-policy.js` importuje `lifecycle-planning.js`
> a `lifecycle-build.js`, tedy #10. Přesun do `architect/` by křížové importy
> jen otočil, ne odstranil. Governance a lifecycle **nejsou oddělitelné
> přesunem souborů** — sdílejí kód, ne jen adresář.

### Základ

| # | Schopnost | Ř. | Soubory |
|---|---|---:|---|
| 1 | Server, routing, DB | 12,5k | `server.js`, `routes/`, `db/`, `config.js`, `security/`, `core/` |
| 2 | CRE | 4,3k | `chat/cre-decision.js`, `chat/cre-routing-patches.js` |
| 4 | Konverzace | 2,3k | `chat/conversation-store.js`, `chat/context-*.js`, `chat/ltm-context.js`, `chat/export-pipeline.js` |
| 18a | Správa modelů | 0,9k | `upgrade/model-profiles.js`, `upgrade/model-registry.js` |
| 3 | LLM gateway | 2,9k | `llm/` |
| 5 | Quality Gate v2 | 2,9k | `chat/quality/` |
| 6 | Chat pipeline | 20,4k | `chat/handlers/` (45), `chat/controller.js` |
| 21 | Studio + WS | 1,3k + **14,9k** | `ws-bridge/` + **`intentsmith-ide/` (139 souborů TS/TSX, 20+ rozšíření)** — Theia IDE je **plocha produktu**, viz `DIRECTION.md` |
| 7 | Expertizy | 9,5k | `expertises/` **mimo** specialist-runtime, scenario-engine, knowledge-base |
| 16 | Nástroje | 7,6k | `tools/` — legacy `registry.js` drží **153 registrovaných nástrojů**; M2 typed authority je v `m2-tool-*.js` |
| 9 | Skills | 1,8k | `skills/` — 8 vykonávaných step typů + samostatná substitution helper vrstva |
| 15 | Paměť | 3,1k | `memory/` |
| 12 | Code Intelligence | 11,6k | `code-intel/` |
| 11 | Execution + patch | 6,9k | `patch/`, `executor/` — **hranice sedí od 2026-08-02** |
| 10 | Project lifecycle | 14,5k | `planner/` **mimo** soubory patřící #13 |
| 13 | Governance | 4,7k | `architect/`, **+ `planner/architecture-{guardian,check,policy}.js`, `planner/api-contract-registry.js`, `planner/critic-agent.js`, `code-intel/regression-predictor.js`** |

### Rozšíření a volitelné subsystémy

| # | Schopnost | Ř. | Poznámka |
|---|---|---:|---|
| 8 | Specialisté | ~2,9k | `specialists/` **+ 1 516 ř. v `expertises/`**; 1.0 vyžaduje platformu + jeden E2E |
| 14 | Agenti | 6,5k | `agents/` **+ `chat/handlers/agent-wizard.js`**; 1.0 vyžaduje platformu + jeden E2E |
| 17 | Notifikace | 3,3k | `notifications/` |
| 18b | Upgrade automatika | 9,5k | `upgrade/` mimo #18a; automatické discovery je opt-in, nikoliv jediná outbound plocha |
| 19 | Marketplace | 0,9k | `marketplace/` |
| 20 | Media | 1,3k | `media/` |

Nedokončené / mimo 1.0: licencování, setup wizard.

**Legacy plocha:** `src/ui/architect/` (web UI na `/architect`) je zděděný
předchůdce C3 Studia z doby před přechodem na Theia. Není to fallback pro 1.0.
Osud neurozhodnut — viz `DIRECTION.md` §4.

---

## Kde se testuje bez modelu a kde ne

| Převážně `offline` — ověřitelné bez Ollamy | Převážně `model` — vyžaduje Ollamu |
|---|---|
| #12 Code Intelligence (13/17) | **#2 CRE** (rozhodnuto: bez Ollamy nemá smysl) |
| #13 Governance (11/12) | **#10 Lifecycle** (19 sad `model`) |
| #11 Execution (8/10) | #5 QGv2 (11/24) |
| #16 Nástroje (4/5) · #18a (vše) | #7 Expertizy (9/24) |

---

## Třináct invariantů

Jsou závaznou release podmínkou a vývojovými rails. Ne všechny dnes platí:
otevřený nebo neověřený stav je uveden níže a nesmí se vydávat za splnění. Plné
znění v [`CONTRACT.md`](CONTRACT.md) §2.

1. CRE je jediná autorita — žádná zpráva ji neobejde
2. `mergeExpertisePrompt()` je čistá funkce
3. ExpertiseEnforcer: max 2 retries, temperature decay −0,1
4. 5D vektor `{reasoning, creativity, determinism, riskTolerance, verbosity}`
5. QGv2 je deterministický a idempotentní, bez LLM
6. Patch engine: 3-tier anchor, atomický zápis, plný rollback
7. Execution loop: max 8 iterací
8. Specialista neimportuje interní `src/**` — **M3 candidate splněno.**
   `ToolAdapter` i registry poskytuje host jen jako deklarované capability.
   Rekurzivní package scanner fail-closed odmítá interní, symlink/computed,
   effectful builtin, third-party bare a známé ambient-effect cesty. Přesný
   modulový ratchet má 1 148 hran, 3 cykly a 28 souborů v cyklech. Scanner je
   statická extension hranice, nikoli hostile-code runtime sandbox.
9. Model upgrade nikdy neupgraduje sám
10. **Legacy listener nikdy neopustí loopback**
11. Významný efekt zůstává pod přesnou uživatelskou authority — **OPEN_VIOLATION
    jako celek**. M2 a M3 uzavřely project/file/process/Git/network i extension
    efektové cesty. M5 privacy a M6 promotion jsou převedené na offline Ed25519
    receipts a nedůvěryhodnou SQLite cache, ale Decision 041 re-review candidatu
    `73fdf836` skončil `CHANGES_REQUIRED`. Remediation bajtové identity,
    restartových UDF, exact bindings a Git lineage čeká na nové nezávislé
    review. Dokud tato authority není přijatá, passing M2/M3/model programy
    nesmějí L0-11 povýšit na `VERIFIED`.
    Změřeno 2026-08-07: samotné approval route (`POST /api/autonomy/approve/:id`,
    `POST /api/lifecycle/*/approve`, `POST /api/skills/executions/:id/confirm`)
    nemají žádnou per-route kontrolu — chrání je totéž co `GET /api/health`.
    Perzistentní audit efektů neexistuje; jediná audit tabulka `merge_audit_log`
    je o mergích. `docs/review/2026-08-07-AUTH-MATRIX.md`. První M2 kandidát
    `37fab4f9` zavřel absolutní/traversal/symlink a jednoduché path-race bypassy
    pro patch, preview, rollback a dead-import write; invariant však zůstává
    `UNVERIFIED`, dokud neexistuje a neprojde celý effect/approval connector,
    revokace, process/network/Git mediace, audit a uživatelský journey.
12. Žádná tichá background outbound komunikace — **IMPLEMENTATION_GREEN /
    LONG_HORIZON_PENDING**. Global production `fetch` guard je instalovaný před
    optional/background službami. Externí request bez exact scope se durably
    audituje a zastaví před transportem; model discovery zachovává operátorský
    default-on stav, ale má přesný metadata-read scope, tři HTTPS originy a
    append-only decision/terminal audit. Google Fonts egress zůstává odstraněný.
    Změřeno 2026-08-07: 82 `fetch` call sites, z toho 46 skutečně odchozích.
    Default konfigurace pod blokující instrumentací neprovedla **žádné** spojení
    mimo loopback — okno 75 s pokrylo startup, idle, shutdown a 30s agent
    scheduler, **nepokrylo** 5min poll ani 24h cyklus, pro delší horizont je to
    `NOT RUN`. LLM-inicovaný web egress zůstává na M2 hranici unavailable,
    pro legacy automatické pipeline,
    protože query není přesnou autoritou provider fallbacku a redirectů. Nový
    rozsah z Decision 044 nabízí samostatné schválení jediného cíle; global
    guard navíc blokuje každý případný legacy bypass.
    `docs/review/2026-08-07-OUTBOUND-CENSUS.md`
13. Učení nerozšiřuje authority, nemění code/config a nekříží projekt bez
    opt-inu — **VERIFIED** na M4 product candidate `286f5ba8`: operátorské
    review prošlo `7/7 REVIEW_PASSED`; produkční learning repository zapisuje
    jen do vlastních `m4_*` tabulek, runtime konzumenti jsou omezení na
    project-bound prompt context a outcome attribution a cross-project cesta
    je fail-closed default-off bez explicitního opt-inu.

---

## Auditní remediace 2026-09-11

Práce pokračuje z `983121ee` na vlastní větvi `work/audit-remediation-20260911`.
Nové změny mají stav `IMPLEMENTED_CANDIDATE / REVIEW_REQUIRED`; nejsou novou
acceptance M2/M5/M6. Analýza projektu nyní používá skutečný reasoning adaptér
se string system promptem, propaguje cancel/deadline/length a neukládá
provider failure jako assistant success. Opraveny jsou také ignorované cesty
ripgrep, option-like dotazy a syntax check patchů na Node 22 bez package scope.
Tři dříve padající serverové programy prošly; jejich historické registry
klasifikace a staré FAIL důkazy se tím nemažou.

Backend i Studio mají aktualizované lockfiles a audit 2026-09-11 bez nálezů.
Studio používá Theia 1.74.1, Electron 42.11.3 a ověřený webpack preload entry;
Theia 1.75 vyžaduje samostatný přechod na esbuild a není součástí této opravy.
Dva skutečné Electron journey na `3d088733` prošly: boundary s produkčním
backendem a M1 cesta s řízeným fixture. Build, skutečné spuštění a fixture
scénář mají oddělené důkazy; žádný z nich nenahrazuje kompletní modelový build.

[Decision 044](docs/decisions/044-conversation-web-approval.md) přidává do 1.0
web bez projektu s jednotlivým schválením. Nový consumer má samostatný
`ConversationWebRequest@1`, typed DB writer, vazbu na uložený user-turn,
jednorázovou spotřebu, veřejný připnutý DNS cíl a uloženou odpověď. Žádný
projekt se nevymýšlí a projektové M2 kontrakty se nerozšiřují. Specifická
HTTP cesta a negativní transport/replay testy prošly; kompletní původní
webové modelové scénáře se tím neprohlašují za přijaté.

Samostatný [webový review packet](docs/review/2026-09-11-CONVERSATION-WEB-REVIEW-PACKET.md)
nově zahrnuje celé zavedení od `983121ee` až po `dbe6630a`, které dřívější
multi-file review range vynechalo. Source opravuje M7 záměnu actor ID za
místní transportní oprávnění a doplňuje terminal audit po ztrátě scope.
M7 dostane odmítací text, pending souhlas a 0 I/O; neposkytuje typed remote
webový výsledek. Audit outage zůstává unavailable a není crash recovery.
Předchozí source `dbe6630a` má celý profil 353/353 PASS, web 20/20, lifecycle service 36/36,
izolované auth/web server programy 2/2 (13 + 2 případy). První nový běh měl
349 PASS / 2 FAIL / 2 TIMEOUT a zůstává zachovaný. Tehdejší stav webu byl
`IMPLEMENTED_CANDIDATE / WEB_REVIEW_REQUIRED`; tehdejší scoped operátorské review
nepokrývalo celý síťový řez. Novější review e87 je zaznamenané níže. [Přesné důkazy a hranice](docs/execution/runs/conversation-web-review-20260911.md).
Před merge s upstream `fe064ee8` zbývá společné číslování migrací 111/112
a kolidujících dokumentů Decision 044; k žádné integraci nedošlo.

[Operátorská historická fakta pro M5](docs/execution/runs/m5/operator-history-facts-20260911.md)
jsou podkladem pro posouzení neaplikovatelnosti rotace, nikoli podepsané
receipts. Druhé fyzické médium a celý podpisový řetězec nejsou potvrzené.
[Kontrakty po 1.0](docs/post-release/README.md) jsou pouze návrhy k review.

Navazující [malý CODE draft](docs/wp/WP-BOUNDED-CODE-DRAFT-20260911.md)
vede ze Studio příkazu `/m2-draft src/app.js :: popis změny` přes jeden omezený
modelový požadavek do stejného strict M2 návrhu. Úplný before/after obsah se
ukáže před `/m2-approve`; model nevolí cestu ani test. Výchozí kontrola je
pouze syntax; API dovoluje explicitní focused test. Draft vyžaduje existující
M2 governance, Git projekt a malý JS soubor (do 1600 bajtů), neaktivuje legacy
milestone executor. Stav: `IMPLEMENTED_CANDIDATE / REVIEW_REQUIRED`;
fyzický modelový důkaz na `782ed681` s předchozí instalací závislostí je `PASS`: jeden request na exact
`qwen3.5:27b`, context 4096, 138 input / 68 output tokenů, následné M2
schválení a šest skutečných funkčních případů v sandboxu. Finální `5424f867`
má 353/353 deterministic a 2/2 Electron PASS. Opakování modelového testu po
sjednocení 170 balíčků s aktuálním lockfilem zastavil změněný sdílený inventář
modelů a cizí GPU práce, před inferencí (`CURRENT_MODEL_RECHECK_BLOCKED`).
Jde o malou změnu jednoho souboru;
celý projektový builder zůstává P0. [Přesný rozsah, původní neúspěchy a důkazy](docs/execution/runs/bounded-code-draft-20260911.md).

Navazující řez 2026-09-12 přidává `/m2-build <JSON>`: explicitní souborový
plán se závislostmi a povinným autorským testem, generovaný přes stejný M2
náhled, schválení a execution. Cesty, test ani Git identity nevybírá model.
Limity zůstávají malé: nejvýše 32 cílů v existujících adresářích, 2200 B
úplného promptu, 1536 output tokenů na soubor a 120 s na celou generaci.
Studio zachovává whitespace uvnitř JSON. Nové webové testy používají skutečné
loopback TLS sockety a souběžné SQLite procesy; veřejný HTTPS endpoint tím
ověřen není. [Návod a konkrétní souborový plán](docs/PROJECT-BUILD.md).
Na `877a3005` má celý profil **353/353 PASS**, service 53/53, Studio VM 24/24,
routes 14/14 a web 23/23. HTTP 27 + 7 kontrol a Electron 2/2 proběhly na
shodných runtime bytes z `d09c9998`. Předchozí 352 PASS / 1 TIMEOUT a 351 PASS
/ 2 TIMEOUT jsou zachované; optimalizace pouze přípravy dvou testových schémat
zachovala skutečnou persistenci, všechny assertions a původní limity.
[Report a úplný review scope](docs/review/2026-09-12-PROJECT-BUILD-WEB-REVIEW-PACKET.md).
Úplný přirozenojazyčný builder, fyzický modelový běh a spojený Studio/server/model
journey zůstávají otevřené. Cizí hunt větev byla později pozorována na `dbf1abfc`
čistá; integrační kolize 111/112 a Decision 044 trvají.

## Navazující Studio/CODE řezy — 2026-09-12

Aktuální výsledek na `dc81a0f0`: **BOUNDED_PHYSICAL_BUILD_PASS / INSTALL_PASS /
CURRENT_CODE_MEASURED / REVIEW_PENDING**. Jedna skutečná cesta spojuje instalované
Studio, produkční server, durable CODE binding a lokální model, schválené zápisy,
12 funkčních assertions, nové procesy a obnovu SQLite. Povinný deterministic je
353/353. Modelový benchmark 7×3 dává Qwenu 3.5 0,333333 a Qwen Coderu 0,114286;
správné referenční opravy projdou 7/7, původní vady zůstanou 7/7 červené.
[Exact source, install provenance a zbývající hranice](docs/review/2026-09-12-PRODUCTION-JOURNEY-REVIEW-PACKET.md).

Následující odstavce zachovávají dřívější checkpointy tohoto dne:

Operátorem dodané [review webu a builderu na e87](docs/review/2026-09-12-WEB-BUILDER-OPERATOR-REVIEW.md)
nenašlo blocker. Zápis výslovně zachovává výluky a nepřisuzuje neuvedenou
Opus provenance. `ipaddr.js` 2.4.0 je zdokumentovaná bezpečnostní hranice;
aktualizace vyžaduje nové SSRF/DNS/socket review.

Studio má formulář cíle, explicitních souborů/dependencies a testu, úplný
náhled a tlačítka stavu/schválení/zrušení. Přesný origin i zobrazený plan digest
se kontrolují také proti starým DOM callbackům. Žádná nová efektová autorita,
automatický mkdir, policy nebo modelový binding. [Návod](docs/PROJECT-BUILD.md)
obsahuje validovaný příklad pravidel a přesně rozlišuje formulář od JSON vstupu.

CODE suite identity nyní zahrnuje sedm grader/helper/orchestrace/lock souborů
a Node verzi, chybějící bytes blokují reuse. Staré COMPLETE zůstávají historií;
import agregovaného panelu bez provenience se odmítne před DB bootstrapem.
Parser a test používají `process.execPath`. Toto je oprava pravdivosti evidence,
nikoli nové měření modelů nebo změna nasazení.

Source `a10e3e0d`: **353/353 deterministic**, **75 + 7 HTTP**. Studio build
na `9462ec0b` a **3/3 Electron**; produktové/probe bytes beze změny.
Native DOM dokládá autentizovaný formulář a skutečné odmítnutí chybějící policy,
nikoli modelovou generaci. Řízený HTTP build/test/commit i rollback prvního
vadného dependency souboru přežijí skutečně nový proces nad stejnou DB;
model/auth/registry jsou fixture. První full **349 PASS / 3 FAIL / 1 TIMEOUT**
a všechny vývojové neúspěchy zůstávají v důkazech. Setup transakce zachovává
SQL, schéma, durability i všechny 34 tool-broker assertions a 30s limit.
[Přesné výsledky](docs/execution/runs/build-composer-completion-20260912.md).

Read-only preflight e87 proti hunt `3b0dcdfb` doložil kolizi migrace 111,
Decision 044 a devět textových konfliktů; oprava CODE reuse je už v této větvi.
Hunt byl tehdy čistý na `3f3a2220` se dvěma běžícími procesy a nebyl integrován.
Navazující integrace v této větvi zachovala web `applied_at` a ověřila obě upgrade
linie. Ohraničený fyzický build je nyní doložen; přirozenojazyčný builder, review
nových delt a M5/M6 externí podmínky zůstávají otevřené.

## Otevřené release-blocking vady

Re-review R1/R2 doložilo obsah odmítnutého kompatibilního požadavku v logu
a obnovu pracovní paměti při `saveContext=false`. Opravy ve větvi
`work/privacy-panels-rereview-20260917` jsou implementované, nové nezávislé
přijetí zůstává otevřené. R3 (panely) je do stejného kandidáta integrováno.
[Reprodukce, rozsah opravy a instalační stav](docs/review/2026-09-17-PRIVACY-PANELS-REREVIEW.md).

Revize F1/F2/F3 z 17. 9.: implementované kandidátní opravy společné paměťové
policy, projektového namespace a native Studio ovládání mají cílené důkazy.
Historie zůstává durable; soukromý režim bez historie není implementovaný,
nové vypnutí se odmítá a starší vypnutí blokuje chat před persistencí. Staré
nescopované LTM záznamy se do nového kontextu nepřebírají. Nejde o novou M4/M5
acceptance. [Samostatný remediation packet](docs/review/2026-09-17-PRIVACY-AGENT-REMEDIATION.md).

Kanonické místo pro selhání, které je **předchozí, release-blocking a nezpůsobené
právě rozpracovanou změnou** — `CONTRACT.md §10`,
[`agent-protocol.md §12`](docs/development/agent-protocol.md). Každá položka
uvádí padající test nebo bránu, co blokuje, pozorovanou kauzalitu a prioritu.
Detail smí být v samostatném findingu; ten se odsud odkazuje, nenahrazuje tento
seznam. **Nezakládá se na to další sledovací dokument.**

Tahle sekce není totéž co „Známý stav, který se vědomě neřeší" níže: tam patří
věci, u kterých už operátor rozhodl, že se odkládají. Sem patří to, co blokuje
a rozhodnuté není.

Historický rozchod `nightly-orchestrator-self-test` se zapečetěným registrem
byl očekávaný vývojový stav podle `CONTRACT.md §8`. Aktuální seal refresh
`573c7d92` a deterministic 352/352 na `69b52278` jej již uzavírají; staré
reporty v následující chronologii zůstávají historické. Otevřené současné
modelové výsledky shrnuje [M6 checkpoint](docs/execution/runs/m6/core-completion-followup-20260909.md).

| Vada | Blokuje | Kauzalita | Priorita |
|---|---|---|---|
| Aktuální CODE kvalita, měření 2026-09-12 | Spolehlivost větších projektových změn | Exact Qwen 3.5 dosáhl 0,333333 a Qwen Coder 0,114286 na novém kontraktu 6ee5ab47…, 7 úloh × 3 opakování. Všech 7 gold kontrol projde a 7 broken kontrol selže; nejde o důkaz obecné kvality. Malý dvousouborový Studio journey prošel. Zůstává potřeba kvalitnější model/kontext a větší uživatelský scénář; měření samo binding neaktivovalo. [Raw evidence a meze](docs/review/2026-09-12-PRODUCTION-JOURNEY-REVIEW-PACKET.md). | P0 |
| Použitelný generovaný kód, audit 2026-09-11 | Dokončení M6 projektu a release | Privátní cookbook na `15426214` s 16384 contextem a 240s SPEC budgetem dokončil SPEC, obě revize i plán. CODE poté třikrát skončil `length` na 4096 tokenech; testovací executor zapsal neúplné soubory, všechny tři měly Python syntax error. Běh byl po reprodukci zastaven, nikoli PASS. Nový společný CODE guard odmítá takový výstup před persistencí a ukončí workflow FAILED; kvalita dokončené aplikace a celý produkční executor journey dál nejsou prokázané. | P0 |
| _historický stav k 2026-08-22: nic otevřeného v této tabulce_ | — | — | — |
| SPEC revize a dokončení projektu, historický checkpoint 2026-09-09 | M6 projektový journey | Na `875c041a` cookbook 26/16 FAIL. Nový `b365896f` s JSON/retention/oracle opravami při 16384 skončil 24/18 FAIL: první SPEC a revize řazení validní, retence doložená, revize výživy třikrát na výstupním limitu 4000 při 9795 z 16384 tokenů. Žádná roadmapa ani milník; staré falešné oracle zůstávají historicky doložené. [Raw důkazy](docs/execution/runs/m6/core-completion-followup-20260909.md). | P0 |
| Výpis/vysvětlení souboru a web bez projektu | Dokončení uživatelských M2/M6 scénářů | Projektové `file.read`, `file.list@2` a FILE_EXPLAIN jsou integrované a jejich source/follow-up review prošlo. Skutečný FILE_EXPLAIN na `3bda6ddb` navíc provedl jeden exact-digest modelový request a po restartu obnovil stejný uložený výsledek; tato runtime evidence čeká na samostatné review. Přijatý M2 milník se tím znovu neotevírá. B/C/E má 34 historických odmítnutí webu s platným aktérem a bez projektu; operátor nyní přijal jednotlivé schvalované HTTPS požadavky (Decision 044). Nový consumer je implementační candidate; všech 34 původních scénářů dosud nebylo zopakováno. [Výsledky a otevřené hranice](docs/execution/runs/m6/core-completion-followup-20260909.md). | P0 |

Změřeno 2026-08-22 na `fbbe1e74`, profil `offline,database`, 234 sad:
`{"PASS":229,"FAIL":3,"BLOCKED":2}`. Tři selhání jsou předchozí a prostředím
podmíněná, shodná s baseline před Gate 1 sérií.

Změřeno 2026-08-21 na `f5d0771f`, profil `offline,database`, 231 sad:
`{"PASS":222,"FAIL":7,"BLOCKED":2}`. Všechny čtyři vady výše ověřeny jako
**předchozí** — běh na čistém `43687e6b` ve worktree dal bajtově shodný výstup
selhání. Zapsány podle `CONTRACT.md §10`, neabsorbovány.

Uzavřeno 2026-08-21: **`module-boundary-ratchet`** — všech 29 přidaných hran
zrevidováno a přijato jmenovitě (`--accept-edge`), všechny uvnitř `src/eval/**`
a `src/upgrade/**` z eval série, `removed=0`, smyčky beze změny (`3`/`28`).
Baseline přepsán na `0765ccab`, 1 020 → 1 049 hran. `MODULE_BOUNDARY_RATCHET_PASS`.

Uzavřeno 2026-08-21: **`m1-model-failover-parent-acceptance`** — parent exportuje
pro child přesně vyjmenovaný blob set `CANDIDATE_SOURCE_PATHS`, ale
`src/upgrade/model-failover.js` mezitím začal importovat `src/db/user-settings.js`,
který v seznamu nebyl. Child proto padal na `Cannot find module` a všech šest
selhání byla kaskáda z tohohle jednoho. Tranzitivní uzávěra ověřena skriptem —
chyběl právě ten jeden soubor. 9 failed → 15 passed / 0 failed.

Uzavřeno 2026-08-21: **`harness-exit-code`** — `module-boundary-ratchet.test.js`
jako jediný root test vytvářel temp adresáře bez statického isolation
bootstrapu. Doplněn kanonický import; tím se odkryl evidenční census, zastaralý
nezávisle na téhle práci (pin 95, skutečnost 99 — drift 95→98 přinesly eval
sady z 19.–21. 8.). Fail-closed assertion `unprotected == []` držela po celou
dobu. rc=1 → rc=0.

Uzavřeno 2026-08-21: **`m1-model-binding-application`** — `upgrade/candidate-trial.js`
volal Ollama delete endpoint vlastní cestou a obcházel tím kanonickou identitu
i exclusive mutation autoritu. Mazací funkce se tam teď dostává injekcí
z runtime kontextu (rozhodnutí 019, strict injection), takže bez autority se
fail-closed nemaže a nevzniká modulová hrana. 97/1 → 98/0.

**Změřeno 2026-08-21: `BLOCKED` neznamená rozbité.** Operátor upozornil, že
tyhle cesty se v C3 běžně používaly a testovaly — jen nefungovaly dokonale.
Ověřeno spuštěním: server nastartován a **26 registrovaných `server`-profilových
sad puštěno přímo proti němu**, mimo `nightly-audit` (`server` je tam hard
blocker, který `--no-block` ani `--allow-blocker` neobejdou).

**Výsledek 21 PASS / 5 FAIL.** Health, chat API, konverzace, projekty, přílohy,
expertizy, specialisté, agenti, skills, paměť, notifikace, bezpečnost, kvalita,
export, websocket, security hardening, model upgrade, feedback, drafts,
features a agent execution prošly na první pokus.

Jediné diagnostikované selhání nebylo vadou produktu: `03-conversations`
očekával `200` s prázdným polem u neexistující konverzace, zatímco route vrací
`404` podle [rozhodnutí 012](docs/decisions/012-m1-rehydrate-empty-history-authority.md),
varianta B, schválené operátorem 2026-08-08. Test nesl předrozhodovací C3
očekávání; srovnán, sada je 16/16.

Zbylá čtyři selhání (`19-rate-limit`, `22-autonomy`, `56-chat-with-project`,
`60-ws-chat`, `80-ws-semantic-events`) **nejsou diagnostikovaná** a nesmí se
vydávat ani za vady, ani za zastaralá očekávání, dokud se nezměří.

Zbylá tři selhání a dvě `BLOCKED` sady **vadami nejsou**:

| Sada | Proč to není vada |
|---|---|
| `nightly-orchestrator-self-test` | `CONTRACT.md §8` — rozchod se zapečetěným fingerprintem registru je při vývoji očekávaný stav |
| `nightly-audit-runner-self-test` | Samostatně prochází (`rc=0`). Uvnitř auditu čeká na blocker `toolchain:x11-display`, který se uvnitř auditu nevyrobí — prostředí |
| `vram-coordination` | GPU a prostředí, ne kód |
| `chat-export-budget`, `export-pdf-docx` | `BLOCKED` s deklarovaným `toolchain: python-pdf-runtime`; chybějící runtime je očekávaný, ne vada |

## Známý stav, který se vědomě neřeší

Zaznamenané, rozhodnuté, ne zapomenuté.

Upřesnění 020: výraz „settings authority“ v historickém souhrnném řádku níže
znamená lokálně validující helper, nikoli prokázanou jedinou writer autoritu.
Pět živých mutation cest nad `user_settings` tuto hranici vyvrátilo; závazný
aktuální stav je samostatný řádek `Model failover opt-in surface`.

| Co | Stav |
|---|---|
| Bezpečnost, credentials, privacy incident `P-001`..`P-003` | Odloženo do odladění základu (rozhodnutí operátora) |
| Chybí globální auth guard; `validateApiToken()` je napsaná a nezapojená | Součást téhož balíku. Změřeno 2026-08-07: 251 unikátních route, per-route kontrolu má 7; middleware chain neexistuje (server je `http.createServer` + jedna route tabulka), takže guard má právě jedno možné místo. Most k agent route navíc zahazuje hlavičky. `docs/review/2026-08-07-AUTH-MATRIX.md` |
| WS terminal channel přijímá `exec` po handshaku bez tokenu | Neškodné na loopbacku (invariant 10). Totéž platí pro `control/edit_approve`, který po handshaku **zapisuje soubor**, a pro `chat`. Terminal má capability guard (`shell-security.js` whitelist), ne auth guard |
| Dvě neslučitelné auth sémantiky | `security.js:20-38` je fail-closed, `agents/api.js:18` fail-open. Dnes latentní — tři handlery, které fail-open guard hlídá, nejsou připojené (`GET /api/secrets` → 404) a `mountAgentRoutes()` je mrtvý kód |
| `webhookSecret` uložený v plaintextu v `user_settings` | Šifrování at-rest neexistuje; hodnota se kopíruje do každé zálohy, takže rotace je vratná restorem. `api_tokens` naopak drží jen hash. `docs/review/2026-08-07-SECRET-TYPES.md` |
| Git historie obsahuje `data/c3.db` (+ `-wal`) a jednu přílohu navíc | Mimo `trackedObjectManifest` v `PRIVACY-INCIDENT.json`, který pokrývá containment současného stromu, ne historický rozsah. Vše dosažitelné, obsah neotevřen |
| Skills mají krok `shell`, jinde je shell denied | Zaznamenáno k prověření |
| Rehydrate ACK autorita je neúplná | Server prvních 32 ID ověří, ale delší set tiše usekne a přesto vrátí autoritativní ACK; klient komplement `validIds` maže. Missing i funkční in-memory store mohou stejným způsobem označit vše za neplatné. Běžné UI drží 1–3 panely, reachability je dnes hlavně corrupt/manual persisted state. Schváleno 014/A: durable-store guard, úplný partition nebo typovaný reject a bezpečný local restore; implementace otevřená. |
| Modelová kanonická identita a auto-rebind | **B3 IDENTITY IMPLEMENTED; automatic failover zůstává explicitně default-off:** `name` a `name:latest` sdílejí konzervativní presence identitu, exact artifact authority navíc vždy váže digest. Settings, desired binding, claim recovery, manual binding application, provider effect journal a runtime finalization jsou durable a fail-closed; proof issuance/automatic failover se bez schválených role-suite prahů neaktivuje. M6 Decision 037 doplnila produkční cross-process artifact claims pro všech pět živých use cest včetně VRAM, append-only pull/delete audit, loopback-only destruktivní scope a stalled-pull recovery. Globální Ollama/ComfyUI GPU residency zůstává podle Decision 023/A samostatná kapacitní hranice a není součástí L0-11 artifact-delete tvrzení. |
| Model deletion and retention authority | **M6 L0-11 IMPLEMENTED / CURRENT_SNAPSHOT_GREEN / RE_REVIEW_REQUIRED:** produkční `modelUseAuthority` se před binding rehydrate váže na SQLite repository z migrace 098. Shared use a exclusive pull/delete claims nesou boot ID, PID, UID a `/proc` start ticks; `BEGIN IMMEDIATE` dává jediného winnera, živý nebo nečitelný owner blokuje a pouze prokazatelně mrtvý/reused owner dostane terminál `OWNER_GONE_RECOVERED`. Gateway, registry validation, binding cutover/verification a VRAM drží shared claim do `finally`; pull/delete drží exclusive claim. Provider intent je durable před prvním efektem a terminál je append-only `SUCCEEDED`, `FAILED` nebo `ORPHANED`. Orphan i intent-only crash fence blokují další use/mutace; 120s pull idle timeout abortuje reader a startup smí obnovit jen stejný exact pull/origin/operation, po úspěchu přidá `RECONCILED_SUCCEEDED`. Destruktivní origin je pouze uncredentialed HTTP loopback; remote/path/query origin selže před inventory. Legacy chat cleanup vrací `MODEL_CLEANUP_CHAT_RETIRED` bez preview/inventory/efektu. Exact current snapshot `12b63e58` má 232 focused a 171 support PASS; [review packet](docs/review/2026-09-11-M6-L0-11-CURRENT-SNAPSHOT-REVIEW-PACKET.md) čeká na verdikt. Delete orphan zůstává bezpečně blokující, nikoli falešně dokončený. |
| Referenční modelový runtime profil | **B3-PROFILE ACCEPTED / GPU PASS:** fyzický T3 na clean source `31859488` ověřil exact `qwen3.5:27b`, digest `7653528b…ec06e`, `num_ctx=4096`, plnou GPU residency, zakázaný fallback a mid-generation cancel bez false success. Finální B6 provider audit na `d518d7ec` pozoroval jen bezpečný adaptivní kontext `1024/4096`, nikdy hodnotu nad profilem, 8 chat requestů na přesný model a nulový refinement prompt. Malý non-Ollama desktop workload se posuzuje relativně a nebyl ukončen; cizí Ollama, nedostatek VRAM a vysoká utilization zůstávají fail-closed. Sdílená media VRAM authority patří až do M2 a zůstává ve findingu 003. |
| Model failover opt-in surface | **020/E ACCEPTED / IMPLEMENTED / COMPATIBILITY_REVIEW_PASSED:** operátor přijal oddělenou revisioned `model_automation_policy` autoritu a legacy drop korekce. Dedicated storage, append-only audit, typed GET/PUT a explicitní import/reset cesta jsou implementované; `a71e5b98` navíc zachovává autoritu přes podporované 061/066 upgrady a tento compatibility scope prošel nezávislým review. Automatic failover zůstává default-off do splnění samostatné proof/activation autority; tato oprava statusu jej neaktivuje. Viz [`020`](docs/decisions/020-m1-model-failover-opt-in-surface.md) a [reconciliation](docs/execution/runs/status-reconciliation-20260911.md). |
| Complete SPEC output authority | **DECISION 043 ACCEPTED / REMEDIATION_CANDIDATE / RE_REVIEW_REQUIRED / MODEL_NOT_RUN:** pouze identity-bound `workflow.spec-document.json@1` smí překročit vlastní `WORKFLOW_PLANNER` ceiling 4000 na 6000. První review přijalo SPEC binding a vrátilo `CHANGES_REQUIRED` za starší legacy `callWithAuth` bypass role ceilings. `dca0e89b` odděluje nezměněné defaulty od maximálních ceilings, vynucuje policy v `authorize`/`isAuthorized`/`call` a regrese vyžaduje nula provider volání pro token o jeden nad ceiling. M1 contract je 32/32; workflow 46/46, lifecycle 158/158 a úplný current gate na `d2b03cc3` 352/352 PASS. Skutečný cookbook čeká na úzký re-review. |
| Token streaming neexistuje — `onLLMToken` je konzument bez producenta | Odpověď přichází celá |
| Nedostupná Ollama při klasifikaci | Opravena na jeden pokus; změřeno přibližně 80 ms místo 6 091 ms |
| Automatické online model discovery | `C3_ENABLE_ONLINE_DISCOVERY`, **default on od 2026-08-19** (operátorské rozhodnutí v `DIRECTION.md`), vypíná se hodnotou `false`. Review remediation je implementation-green na `122b5df5`, ale čeká na re-review: všechny transporty používají manual redirect, každá `Location` dostává nové rozhodnutí a neexportovaná capability váže exact Ollama/Hugging Face/WhatLLM path, query, headers, body a method profily. Opsaný scope literal není autorita. |
| M5 performance release budget | **REVIEW_PASSED na `816a2a4c`:** operátorský výsledek 2026-08-27 výslovně přijal M5 PERF re-review. `M5PerformanceEvidence@3` a raw v2 vážou každé GPU tvrzení na raw measurement nebo read-only census receipt a nepřijmou nečitelný či nulový RSS jako nejlepší hodnotu. Exact clean candidate má autoritativní 5min run: HTTP p95 `5,022 ms`, ProjectContext p95 `32,769 ms`, soak `300 074 ms` / `1 498` vzorků / p95 `14,314 ms`, nula chyb, peak RSS `171,859 MiB`; GPU je pravdivě `not_run_not_requested`. Nové 24h/maximum-throughput běhy jsou samostatná M6 Decision 038 evidence ve stavu `REVIEW_REQUIRED`, nikoli změna tohoto M5 verdiktu. |
| M5 production hardening review | **8/9 REVIEW_PASSED / BACKUP_COMPAT_REMEDIATION_REVIEW_PASSED / HISTORY_DECISION_RECORDED / PRIVACY CHANGES REQUIRED / KEY CUSTODY PARTIAL / ACCEPTANCE_BLOCKED:** osm oddílů zůstává přijatých. Decision 041 byte/history implementace na `37edf30d` dostala nezávislé `REVIEW_PASSED` a trust store má čtyři rozdílné veřejné Ed25519 identity. Review přijalo restore opravu `65bcbc4b` i follow-up `b4136a43`. Operátor vybral `retain_and_rotate`; current scanner vrací `PASS_CURRENT_TREE_HISTORY_RETAINED_AS_DECLARED`, ale podepsaný history receipt ještě nebyl vydán. Přesně připnuté LUKS2 médium A drží ověřenou offline kopii tří operátorských private keys. Fyzicky oddělené LUKS2 médium B drží ověřenou offline kopii právě reviewer private key a vylučuje tři operátorské private keys. Obě média jsou zavřená a vypnutá. Online zdroj zůstává do druhé ověřené kopie operátorských klíčů a otestované oddělené recovery kopie reviewer key. Všech osm credential kategorií, podepsaná history disposition a M5 acceptance zůstávají otevřené. M6 gate zůstává zavřený. |
| M6 IntentSmith 1.0 candidate | **DETERMINISTIC_353_PASS / FRESH_INSTALL_PASS / BOUNDED_PHYSICAL_BUILD_PASS / CURRENT_CODE_MEASURED / REVIEW_PENDING / ACCEPTANCE_BLOCKED:** source `dc81a0f0` spojuje skutečné Studio, model, schválení, sandbox, restarty a DB restore. Odděleně jsou doložené schema upgrady 61/61 a dva current-contract CODE modely. Celý autonomní projekt, obecná kvalita CODE, přijetí nových delt a vnější M5/M6 podmínky zůstávají otevřené. [Review packet](docs/review/2026-09-12-PRODUCTION-JOURNEY-REVIEW-PACKET.md). |
| M7 Remote Companion | **UI_SURFACES_REVIEW_PASSED / HOST_GATE_GREEN / DEVICE_NOT_RUN / NOT_ACCEPTED:** canonical JSON, systemd renderer a dřívější throwaway APK/AAB jsou scoped-reviewované. Nezávislé narrow re-review přijalo exact candidate `429b779f`: durable journal guard zavírá settings double-activation okno a held-flush regrese odlišuje staré bytes. Mobile 47/47, runtime 7/7, adapter 8/8, artifact validation 158/158, boundary 0 violations a Android `test lint` prošly; zabalené assety jsou bajtově shodné se zdrojem. Fyzický Android/VPN/pairing/revocation/TalkBack, produkční konfigurace a credentials, signer, release build, distribuce a matice 13+7 zbývají. [Přesný handoff](docs/execution/runs/mobile/m7-ui-surfaces-20260910.md) a [review result](docs/review/2026-09-11-M7-MOBILE-UI-SURFACES-REREVIEW-RESULT.md). |
| C3 Studio Google Fonts | Oba runtime link loadery, ruční preview import i archivní v7 import jsou odstraněné; hygiene zakazuje obě Google Fonts domény ve spustitelných Studio assetech. Registrovaný runner prošel ve dvou fresh-clone Electron CDP bězích na `7236d221` s nulovým egresssem. Registry zůstává pravdivě `BLOCKED`. **Měřeno 2026-08-21:** build envelope už chybějící překážkou není — `yarn install --offline` + `yarn build` trvají dohromady **54 s** a postaví všech šest artefaktů. **Vyřešeno 2026-08-22: `STUDIO_ELECTRON_BOUNDARY_PASS`.** Příčinou `electron-exited-before-cdp` byla délka `TMPDIR` — Chromium v něm zakládá unix domain sockety a `sun_path` má limit 108 bajtů, runtime root pod `.intentsmith-artifacts` má 95 znaků. Bisekce: `HOME` ani `XDG_*` nevadí, shodí to výhradně `TMPDIR`; bez namespace padá stejně, takže izolace ani D-Bus (falešná stopa) příčinou nebyly. Sada dává Electronu krátký privátní temp. Evidence: nulový egress, 65,8 s soak, boundary matice 403/403/200, čistý shutdown. |
| C3 Studio local HTTP | Root cause byl potvrzen jako capability na wire + nepřítomný `Origin` + `Sec-Fetch-Site: cross-site`. Electron-main nyní doplňuje `Origin: null` jen pro přesný top-level file Studio request s odpovídající privátní capability; backend guard zůstal beze změny. Dva fresh-clone negativní journey na `7236d221` prokázaly startup/POST `2xx` i přesný fail-closed security trojúhelník; registry čeká jen na standardní build envelope, nikoli na další ruční journey. |
| C3 Studio source/build | Operátor přijal funkční ručně udržovaný `lib` jako současný autoritativní runtime. Stale TS je historický archiv; package build/clean/watch ani starý v7 fix payload nesmějí runtime přepsat nebo smazat. Současný vzhled není finální UI kontrakt. |
| C3 Studio current-HEAD runtime | **M1 ACCEPTED / B6 PASS:** produkční ACK `241b39ab` aktivoval exact `m1-wire-v1`; byte bridge je součástí shipped preloadu a postbuild guardu. Standalone fresh clone na `d518d7ec` prošel offline npm/Yarn instalací, produkčním Theia/Electron buildem a jednou B6 evidence envelope. Literal Studio renderer vedl deterministický i modelový turn přes skutečný server, izolovanou SQLite a exact lokální Ollamu; controlled wire backend reprodukoval 2 panely, success, provider error, ordered cancel a reconnect. Síťový census měl nula external/other-loopback/unsupported pokusů, všechny spinnery se vyčistily a Electron i backend skončily bez forced killu. Current UI je funkční M1 baseline, nikoli finální vizuální baseline. Důkaz: `docs/execution/runs/m1-b6-fresh-install-20260823.md`. |
| `multi-source-external.test.js` | Explicitní public-service smoke; není deterministická offline evidence |
| L0-8 specialist boundary | **M3 ACCEPTED / REVIEW_PASSED.** Rozhodnutí 019/A je implementované jako strict capability injection, `ExtensionManifest/Context` a rekurzivní fail-closed scanner všech package JS souborů. Oddíl 7 navíc fail-closed odstavil 13 legacy agent mutation routes a připnul scheduler k `AgentExtensionService.resolveExecution`; všech sedm oddílů má operátorské `REVIEW_PASSED`. Nejde o hostile-code runtime sandbox. Vedle toho zůstává starší zjištění, že 5 nástrojů existuje dvakrát bajtově identicky a core kopie `src/expertises/tools/**` nemá v `src/**` konzumenta. |
| `src/expertises/tools/**` bez konzumenta | Runtime cesta vede přes kopii v balíčku specialisty; core kopii drží naživu jen testy. Disposition `RETAIN`/`RETIRE` nerozhodnuta |
| Self-learning | **M4 ACCEPTED / REVIEW_PASSED na `286f5ba8`:** content-addressed observation/proposal/outcome, append-only authority, explicitní user gate, same-project Code Intelligence producer, verzovaný `ProjectLearningContext`, exact SPEC conformance a durable outcome measurement tvoří jednu uzavřenou smyčku. Reálná SQLite E2E cesta prošla od dvou změn přes approval a plan conformance `0 → 10000` po rollback/delete; nejde o model-quality benchmark. Cross-project retrieval je default off. Osm M4 programů prošlo 73/73 a úplný gate zachoval přesně zděděné `276 PASS / 2 FAIL / 2 BLOCKED`; sedm oddílů nezávisle přijato bez blockeru. `M4-N1` zůstá INFO: slabší SPEC model může na striktním fail-closed conformance kontraktu selhat. |
| Lineární matching rout, regex per request | Naměřeno 0,87 ms — vědomě ponecháno |
| Manual model binding application state | **Backend runtime cutover FRESH-CLONE VERIFIED na `e7d89b5e`; append-only hardening FRESH-CLONE VERIFIED na `bcc9eb84`:** `npm ci --offline` a celá focused/compatibility baterie níže prošly z čistého klonu; migrace 050–053 drží append-only runtime generaci, provider pull intent/outcome a exact-digest verification; legacy override zůstává `LEGACY_UNVERIFIED`. Migrace 053 navíc vlastními signály odmítá `INSERT OR REPLACE` identity kolize ve všech souvisejících auditních journalech, vyžaduje neprázdnou TEXT identitu a nedovolí callerovi zadat event/application/provider-attempt sekvenci. Upgrade před první schema mutací odmítne preexistující `NULL` identitu nebo nekladné pořadí; původ kladné historické hodnoty zpětně prokázat nelze. Provider effect má exact loopback origin, DB-enforced request/actor/current-revision/target authority, obnovovaný pětiminutový claim, fencing a DB-assigned command sequence. No-op receipt atomicky uzavírá celý terminální prefix do připnutého frontieru; pending nebo neuzavřený úspěšný provider command blokuje apply, rollback i jinou desired projekci podle přijatého 018/Q5/A. DB guard chrání projekci přes `UPDATE`, `DELETE` i `INSERT OR REPLACE` a stejná konfliktová cesta nesmí přepsat receipt ani jeho causal junction. Jedna application service vlastní exact local provider, runtime CAS/kompenzaci, HTTP/chat/registry, startup rehydrate, sériovou post-listen verifikaci a commit-layer `model_changed`; staré writery nemají produkčního volajícího. Fresh-clone výsledky zahrnují application 73/73, repository 39/39, storage 16/16, failover schema 13/13, schema migrations 38/38, routes smoke 109/109 a registry 375 programů s fingerprintem `a2f1e67e…f77b8`. HTTP `200 started` následuje durable user-target intent nebo binding operation, nikdy pomocný legacy recovery intent; read-only interní status nekoreluje historický provider failure s novějším bindingem. Proposal post-commit failure se opraví idempotentním replayem bez druhého provider/runtime effectu. Produkční void broadcaster pravdivě končí `APPLIED_NOTIFICATION_DEGRADED`, nikoli falešným doručením; exactly-once WS delivery bez outboxu se netvrdí. Veřejný status/typed-error kontrakt ani Studio rollback surface tento WP nepřidal. Skutečný GPU/Ollama běh nebyl spuštěn. Celý B3/Gate 1 zůstává `BLOCKED` na 015, proof/automatic failover, UI recovery a GPU evidence. |
| Manual binding finalize reconciliation | **FRESH-CLONE VERIFIED na `7c4aa73c`:** review jednotka `0a6bde54..7c4aa73c` prošla nezávislým read-only code/evidence review. Migrace 054 nepovyšuje historický success, přidává append-only `DIRECT_CONFIRMED`/`RECOVERED_BY` receipt a DB blokuje verification/notification bez potvrzení nejnovější runtime generace. Před první mutací navíc vyžaduje úplnou pre-054 trigger autoritu a právě jeden přesný legacy history řádek pro každý změněný `RUNTIME_APPLY`; chybějící i duplicitní stopa fail-close zastaví upgrade. Repository před receipt odvozuje interní `RUNTIME_RECONCILIATION_REQUIRED` s `runtimeFinalizeStatus: UNKNOWN`; veřejný stav zůstává kompatibilně `PENDING` / `NOT_APPLIED`. Application zapisuje receipt po synchronním runtime commitu a před proposal/broadcast/verification; nejasné commit/receipt okno řeší operation-scoped exact startup generation bez druhého pullu nebo nového user-provider intentu. Recovery znovu čte exact provider identitu. Nová post-054 `upgrade_history` vzniká s přímým nebo recovery-confirmed receiptem; pre-054 změněný `RUNTIME_APPLY` musí mít svou původní atomickou history stopu. Čistý lokální klon prošel `npm ci --offline`, focused/compatibility sadami, registry 376 programů, hygiene 1 527 cest a ratchetem 1 016/1 016 hran. Neúspěšný startup recovery nemá schválenou veřejnou degraded/fail-fast policy. Operationless legacy override je dál name-only `LEGACY_UNVERIFIED`; celý M1/Gate 1 zůstává otevřený. |
| Rate limiter je na loopbacku mrtvý kód | Vědomě ponecháno |

---

## Co je zastaralé

`docs/ROADMAP.md`, `docs/convergence/*`, `docs/README.md`, historický `todo.md`
a `docs/archive/*` obsahují **legacy tvrzení**. `AGENTS.md` a `CLAUDE.md` jsou
nyní shodné ukazatele bez stavových claimů. Příklady rozporů, které tento
dokument opravuje:
15 expertíz (skutečně 18) · `chat/cre-decision-types.js` (neexistuje) ·
11 guardů (12) · `cre-decision.js` ~2 900 ř. (4 196) · tabulka intentů se
třemi neexistujícími a sedmi chybějícími · „~98 % hotovo" · „3 500+ verified tests".

Ponechány jako reference. **Autoritou je tento dokument.**

Aktualizace souborových funkcí 2026-09-10: module graph má 1 302 hran,
20 nových přesně revidovaných hran, žádná odebraná, stejné 3 cykly / 28 členů.
[Předání uzavřené dávky](docs/execution/runs/m6/core-completion-review-20260910.md).


Závěrečné předání auditních oprav 2026-09-11:
[run report](docs/execution/runs/audit-remediation-20260911.md).
Na `5d7aab48` prošlo 353/353 deterministických programů; následná oprava
rozlišení web deadline prošla cílenými DB/transport a skutečnými HTTP testy
na `7a5f4104`. Serverová sada má 23/23 PASS, dvě skutečné Studio cesty mají
oddělený PASS na `3d088733`. Opravy jsou `IMPLEMENTED_CANDIDATE /
INDEPENDENT_REVIEW_REQUIRED`; modelový build quality P0, M5 podpisy/custody
a celá M6 acceptance zůstávají otevřené. Kontrakty po 1.0 jsou návrh.

Navazující multi-file candidate (WP-MULTIFILE-DRAFT-20260911) dovoluje 1–3
explicitní JS cíle přes `/m2-draft src/app.js, src/helper.js :: změna`. Model
pracuje sériově v kanonickém pořadí cest, každá odpověď obsahuje jediný soubor;
společný 120s deadline, 4096 kontext a 1536 výstupních tokenů na požadavek
zůstávají omezené. Všechny vstupy a následné peer after-images podléhají stejnému
2200B stropu. Jediný připnutý M2 plán a focused process vznikají až po celé
validní dávce. Studio nyní dovoluje durable cancel během approval/testu i při
souběžném M1 turnu. CJS parser odmítá únik ze syntetického wrapperu pomocí
`vm.compileFunction`. Součástí kandidátu jsou upstream role-ceiling oprava
`dca0e89b` a failed-evaluation oprava `0e563cc8`. Stav je
`IMPLEMENTATION_GREEN / BOUNDED_MODEL_PASS / REVIEW_REQUIRED`;
žádná nová M5/M6 acceptance. Scope je malá dávka souborů, nikoli celý builder.

Na společném implementation source `c6c9ee3a` prošlo **353/353 deterministic**
programů, **24/24 HTTP kroků**, build a oba Electron programy (**2/2**). Nový
fyzický CODE běh se současnými závislostmi změnil dva soubory ve dvou dokončených
požadavcích na exact Qwen při 4096/1536 a prošel 12 funkčními assertions.
Source byl čistý, scope a Xvfb ukončené; všech 353 log hashů a raw modelové
identity jsou ověřené. Tento malý service journey neprokazuje celou aplikaci
ani spojený Studio/server/DURABLE binding/model/restart průchod.
[Review packet](docs/review/2026-09-11-PRODUCTION-FOLLOWUP-REVIEW-PACKET.md) a
[úplný běh](docs/execution/runs/multifile-code-draft-20260911.md) zachovávají
původní neúspěchy, scope a otevřené M5/M6 podmínky.

Checkpoint GPU hunt / Ollama autocheck 2026-09-11 na `0cbe8e2a`:
module graph má 1 308 hran. Šest nových explicitních hran zapojuje kontrolu vydání
do outbound policy a existující upgrade manager; evaluační, capability a VRAM
volání váže na společnou model-use autoritu. Žádná hrana nebyla odstraněna,
cykly zůstávají `3` / `28`. Přesné hrany a source provenance jsou zachované
v `tests/fixtures/module-boundary/baseline.json`; nejde o nový acceptance verdikt.

Ollama autocheck / GPU hunt, 2026-09-11: denní metadata check je zapojený
a běží; reprodukovaný provider prošel stream/non-stream/typed GPU kvalifikací.
Finální kód `0e563cc8` má 352/352 deterministic PASS. Jednomodelový CODE
pilot nad migrovanou kopií DB dokončil pull → měření → decision `INCUMBENT`;
bindingy a původní DB se neměnily. Nezávislé review a sjednocení provozní DB
zůstává otevřené. [Přesné výsledky a rozsah](docs/execution/runs/gpu-hunt-ollama-autocheck-20260911.md).

Pravidelný GPU hunt 2026-09-11: implementace bootstrap/incremental ledgeru
a provider-specific měření navazuje na explicitní zadání operátora.
[Decision 048](docs/decisions/048-reproducible-evaluation-provider.md) zachycuje
podporovanou cestu; stav zůstává `REVIEW_PENDING` do nezávislého review.

Provider-specific hunt checkpoint 2026-09-11: module graph má 1 309 hran.
Jediná nová hrana `model-hunt-state -> model-identity` sdílí kanonické
jméno pro append-only discovery ledger; cykly zůstávají 3 / 28.

Provozní checkpoint GPU huntu 2026-09-11 na `7c693d32`: reprodukovatelná
Ollama `0.34.0-intentsmith.1` je instalována systémově i pro ephemeral sidecar.
Skutečná user service dokončila CODE duel nad provozní DB: dvě provider-bound
COMPLETE evidence a INCONCLUSIVE decision, bez změny bindingů. Start, obsazený
port a ukončení všech vlastních GPU procesů byly ověřeny. Migrace 111/112 drží
provider-specific reuse a bootstrap katalog 180 kandidátů. Autocheck a noční
limitovaný hunt jsou enabled; široký panel a nezávislé review zůstávají otevřené.
[Přesný rozsah a aktuální důkazy](docs/review/2026-09-11-GPU-HUNT-PRODUCTION-REVIEW-PACKET.md).

Finální source `67b63347` sjednotil i CLI coverage a SHA-bound offline replay
podle provider verze. Clean-clone profil offline/database má **352/352 PASS**;
aktuální coverage před širší dávkou byla 2 COMPLETE / 60 applicable MISSING /
8 N/A. Úvodní hunt s limitem 13 kandidátů byl spuštěn pod samostatnou user
service 2026-09-11 ve 23:14 CEST; jeho dokončení se tímto netvrdí.
[Strojová evidence včetně předchozích neúspěšných gate](docs/execution/runs/gpu-hunt-production-20260911.json).

Validační oprava GPU huntu 2026-09-12: module graph má 1 310 hran.
Nová hrana `model-evaluation-history -> model-evaluation-runner` zahrnuje
efektivní výchozí parametry inference do suite contract hash. Cykly zůstávají
3 / 28. Timeout cold loadu a per-role chyby mají [samostatný review follow-up](docs/review/2026-09-12-GPU-HUNT-VALIDATION-REVIEW.md); acceptance je otevřená.


Uzavření společné technické integrace core/hunt 2026-09-12 na `f80bcaa1`:
**353/353 deterministic PASS**, lifecycle 53/53 za 18,1 s, schema 61/61.
Migrations 100 / fresh tables 177 včetně sqlite_sequence; registry 516 se
stejným fingerprintem 162b890b…. Aktuální module graph má 1 323 hran, 3 cykly /
28 členů. První 351 PASS / 1 FAIL / 1 TIMEOUT a Studio 2 PASS / 1 FAIL jsou
zachované; izolované M1 opakování prošlo bez zásahu do policy. Příčina prvního
M1 network capture failure zůstává neprokázaná. [Přesný scope a review](docs/review/2026-09-12-CORE-HUNT-INTEGRATION-REVIEW-PACKET.md)
a [run record](docs/execution/runs/core-hunt-integration-20260912.md).
Nejde o přijetí release, nové retence huntu ani fyzického modelového journey.

Vstupní hunt checkpoint `ee4472d5`, 2026-09-12: module graph má 1 317 hran.
Sedm nových hran patří `model-hunt-retention.js`, který používá existující
role, history a pairwise autoritu; počet cyklů zůstává 3 a jejich členů 28.
Operátor zapnutí úzkého mazání výslovně požadoval. Provedení a ochrany:
`docs/decisions/048-reproducible-evaluation-provider.md`; M6 review se tím
nepřeznačuje na přijaté.

Navazující integrace dokončené retence 2026-09-12 (`16fed51f` + `ee4472d5`):
aktuální module graph má 1 330 hran, 3 cykly / 28 členů. Sedm nových hran
propojuje retention policy s existujícími role/history/pairwise autoritami.
Kanonická provider Decision 048 obsahuje i novou autorizovanou retenci; 044
zůstává historickým aliasem. Web migrace 113, registry 516 a schema 100 migrací
zůstávají ve společném kandidátu. Nová regresní kontrola nepovolí odstranění
ze starého CODE kontraktu. Kandidát `ed595ad3` má **353/353 deterministic PASS**,
Studio **3/3 PASS** v jedné sekvenci a HTTP **75 + 7 PASS** se dvěma skutečnými
procesovými restarty. Registry zůstává 516. Stav je IMPLEMENTATION_VERIFIED /
REVIEW_PENDING; původní M1 capture failure na 71968508 má stále neprokázanou
příčinu. Fyzický modelový journey a M5/M6 acceptance zůstávají otevřené.
[Celý retenční a integrační review rozsah](docs/review/2026-09-12-HUNT-RETENTION-INTEGRATION-REVIEW-PACKET.md).

Studio M1 startup/restart follow-up 2026-09-12, source `1a6645aa`: řízené
zpoždění reprodukovalo pět connection refusal a stejnou chybnou wire signaturu
jako historický 71968508. První čekání jen na seznamy nestačilo (`api-health`
FAIL); finální čekání na všech sedm povinných HTTP rodin a ustálení nyní
prochází stejným 200ms zpožděním. Běžné Studio 3/3 a celý deterministic 353/353
PASS. Síťová policy, UI, produktový kód, registry i 65s pozorování jsou zachované.
Opravený reprodukovaný souběh není zpětný důkaz příčiny historického běhu.
Review zůstává PENDING; fyzický modelový journey není součástí těchto důkazů.
[Scope, neúspěšné pokusy a důkazy](docs/review/2026-09-12-STUDIO-M1-RESTART-REVIEW-PACKET.md).

## Specialisté ve Studiu — oprava 2026-09-17

Integrace větve `ff313081` do provozní linie `e0b75ee4`: seznam podle
`/api/specialists`, potvrzená aktivace ID balíčku a vazba na stabilní konverzaci.
M1 inline dokumenty mají samostatný limit 10 MiB / dávka 20 MiB a rámec
zahrnující base64 režii; obsah se nedoplňuje čtením libovolné cesty na backendu.
Účetní dokumentový host má jednorázovou autoritu pro konkrétní konverzaci,
lokální OCR, privátní evidence a kontrolované exporty. Sázkař používá již
připravený autonomní engine s veřejnou Fortunou. Detailní konečný důkaz je
v `docs/review/2026-09-17-STUDIO-SPECIALISTS.md`; integrace zůstává
**REVIEW_PENDING**, nejde o nové přijetí celého produktu.

Katalog modelů, následná oprava 2026-09-17: `40990f46` doplňuje náhradní
čtení dedikované VRAM přes živé NV-CONTROL pouze pro katalog. NVIDIA/NVML
preflight zůstává samostatný. Přesný module graph: 1 360 hran, 3 cykly /
28 členů; jediná nová hrana `routes/system -> upgrade/model-hunt-diagnostics`.
Při neznámém limitu se katalog neschovává. Fyzický renderer s řízeným backendem
ověřil viditelnost katalogu, ruční filtr a negativní test. Scoring zůstává
BLOCKED. Instalováno `d4dea0bb`, živé API má 24103 MiB a 49/71 v limitu.
[Review a přesné výsledky kontrol](docs/review/2026-09-17-VRAM-CAPACITY-FALLBACK.md).
