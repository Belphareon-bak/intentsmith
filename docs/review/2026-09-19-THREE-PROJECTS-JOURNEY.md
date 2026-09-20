# Tři skutečné projekty — funkční aplikace a meze 19. 9. 2026

**THREE_APPLICATIONS_RUNTIME_VERIFIED / ASSISTED_JOURNEY / REVIEW_PENDING.**
Autorita: operátorovo zadání dokončit tři různé projekty přes IntentSmith,
zlepšovat obecný projektový postup a uklidit vlastní pracovní kopie.
Nejde o samostatné dokončení na jeden prompt ani o uzavření production release.

## Aktuální výsledek

Všechny tři aplikace jsou nainstalované v hlavní nabídce tohoto počítače.
Jejich implementaci vytvořil skutečný CODE model (`qwen3.8:latest`) přes
produkční draft → přesné M2 schválení → bwrap test → Git commit. Codex rozdělil
práci, revidoval výstupy, dodal nezávislé ověření a konkrétní opravné požadavky.
Zdrojáky existujícího SystemSmithu ani ShellSmithu se do nových aplikací
nekopírovaly. Závěrečné README/ROADMAP obou widgetů jsou výslovně operátorská
redakce přes M2: modelové návody obsahovaly neimplementované funkce a byly
zrušené. Spouštěče, sběrače, providery, renderer i IPC jsou modelový výstup.

| Aplikace / projekt | Čistý commit | Doložené chování |
| --- | --- | --- |
| SystemSmith_1 / 13 | `70d146936e2157008e3837774aa7c1edfe88c47c` | Živé CPU/RAM/NVIDIA GPU/FAN/network/disky, šest grafů, detail, řazené a vyhledávané procesy, pauza, trvalá volba 1/5/15/60 minut historie |
| WeatherSmith / 14 | `74f7a861767a33250cfeee5e0082939280201abe` | Živé počasí a sedmidenní výhled, hledání města, nejvýše 30 uložených míst, ruční souřadnice, obnova a chybové stavy |
| NewsSmith / 15 | `cc083cff07644e1ec7508a54cc8df371e5db3bdf` | Skutečné RSS/Atom, výběr z pěti zdrojů, klíčová slova, nepřečtené/přečtené, obnova, trvalé preference a čtecí historie |

Skutečný Electron přes **vlastní vygenerovaný launcher**, nikoli jen webový
mock, prošel u každé aplikace dvěma starty s různými PID, exit 0 a obnovením
nastavení. Renderery nemají Node. Síť widgetů byla skutečná; žádná modelová
inference neprobíhá při jejich běžném provozu.

Důkazy pod `.intentsmith-artifacts/three-projects-20260919/`:

- `system-desktop-zykJG9/result.json`, `overview-live.png`;
- `weather-desktop-ap6Qb3/result.json`, `round-2.png` (finální CSS);
- `news-desktop-E2Vh49/result.json`, `initial.png`;
- `final-app-inventory.json` a `*-desktop-install.json` s přesnými menu entries;
- `23k-widget-ui-search.json` / `27a-widget-ui-layout.json`: skutečné DOM
  interakce s řízenou asynchronní sítí, souběh, hledání, odebrání místa a datum
  také v `America/Los_Angeles`;
- `33j-widget-ui.json`: zdroje, filtry, přečtení, obnovení, změna zdrojů během
  požadavku a zachování obsahu/času při výpadku;
- `24b-entry-contract.json`, `34c-entry-contract.json`: přesný odesílatel,
  hlavní frame a URL, nastavení profilu před single-instance lockem;
- `25b-launcher-test.json`, `35a-launcher-test.json`: sanitizace prostředí,
  skutečné argumenty, exit 7, SIGTERM 143 a nedostupný runtime; raw skripty a logy jsou uchované.

## Co výsledek neprokazuje

- **SystemSmith_1 není doložený jako lightweight.** Celý procesový strom měl
  v 60s privátním Xvfb/software-renderovaném běhu 488,317 MiB PSS a 7,2085 %
  jednoho jádra; souběžně probíhal CODE. Jde o měření, ne srovnání s Mission
  Center. NVIDIA je jediný implementovaný GPU provider; per-process GPU a
  síťové přenosy se nepředstírají. Vzorky historie jsou pouze v RAM.
- WeatherSmith má ověřené explicitně zvolené Prahu/Brno, **nikoli skutečnou
  polohu operátora**. Geolokace je na kliknutí, závislá na OS/Electron provideru
  a při nedostupnosti funguje hledání města/ruční souřadnice. Výstup je
  modelový odhad Open-Meteo. Widget nearchivuje počasí pro offline start.
- NewsSmith má pět konkrétních zdrojů, ne libovolné vlastní URL. Nemá systémové
  notifikace. Externí HTTPS článek se otevírá až po kliknutí. HTML z feedu se
  nevkládá do DOM. Tray/always-on-top/panel OS ani jiné platformy nejsou doložené.
- Vlastní testy modelu několikrát prošly při chybných rozhraních či nefunkčním
  GUI. Nezávislá kontrola odhalila i syntakticky vadný entrypoint (`34b`) a
  klikání překryté sticky panelem (`33g/33h`). Tyto návrhy nebyly použité;
  neúspěšné pokusy a zrušené plány zůstávají v evidenci.

## Obecná oprava po závěrečném průchodu

Nasazeno **`b0975bff832a26d43eccfa533e024b892a3aeecb`**, publikováno na
`github/work/systemsmith-project-flow-20260919`. Předchozí runtime `ba144c86`.
Receipt `deployment-syntax/deployment.json` dokládá devět nezměněných tabulek,
16 zachovaných projektů, auth, 105 migrací, quick_check OK a nula FK chyb.
Hunt timer zůstal podle původního stavu vypnutý/neaktivní. Předchozí oprava přesných úseků prokazatelně posloužila
při dokončení obou widgetů, aniž by bylo nutné přepisovat funkční části.

Nový modelový draft kontroluje syntaxi každého `.js/.mjs/.cjs/.jsx` výsledku
**před vznikem plánu**, také po přesné opravě. Retained soubory ze starých
návrhů se zkontrolují před první inferencí. Chyba libovolného souboru shodí
celou dávku bez nového plánu či efektu. Používá existující tree-sitter JS
parser; kód se nevyhodnocuje, importy nelinkují a proces se nespouští.
Žádná nová závislost, žádná změna oprávnění nebo schválení.

To je gramatická kontrola JS, ne důkaz Node runtime/API, rozlišení modulů,
existence symbolů ani funkčnosti. Přímé operátorské `/m2-plan` je dosavadní
samostatná cesta; TypeScript, HTML a CSS tento guard nekontroluje.

Service **96/96 PASS**, včetně chybné syntaxe prvního peeru, čtvrtého cíle,
přesné opravy a retained starého návrhu; bez vyhodnocení/linkování validního
kódu. Původní testy rollbacku při funkční chybě peeru a restartu zůstávají.
První testovací běhy s vadným importem/fixturami jsou uchované jako FAIL.
Modulový ratchet PASS, 1 378 hran bez přidané interní hrany.

Předchozí přesná oprava měla celý profil 356 PASS / 1 FAIL / 3 BLOCKED;
první příkaz nedodal cesty PDF/OCR nástrojů. Přesné tři blokované programy
následně se správným prostředím prošly 3/3. To nejsou dva kompletní zelené
běhy. Jediný ostatní FAIL je známá Gate 0 neshoda registru; pečeť se neměnila.
Nový úplný sériový profil `draft-syntax-20260919` na `b0975bff`: **359 PASS /
1 FAIL / 0 BLOCKED**, celkový verdict FAIL kvůli stejné Gate 0 neshodě.
`installed-syntax-historical-probe.json` ověřuje přímo nainstalovaný parser
nad skutečnými starými modelovými bajty: vadný `34b` odmítá a opravený `34c`
přijímá. Nejde o novou inferenci ani HTTP mutaci.

## Původ výsledku a dokončený úklid

`final-application-provenance.json` přiřazuje všech **43** finálních
implementačních/UI/package souborů tří utilit k přesnému digestu a úspěšnému
M2 plánu, bez chybějící položky. Profily a screenshoty z fyzických běhů jsou
oddělené od kontrolovaných DOM/IPC testů.

Dvě dávky úklidu odstranily **19 430 506 496 B (18,10 GiB)** v 51 904
spotřebovaných testovacích adresářích. První ověřila 2 392 hashů, druhá
23 243 hashů před i po. Důkazy, aktivní gate, skutečná data a cizí práce jsou
zachované. Nejde o slib stejného nárůstu `df` při souběžné cizí práci.
[Postup, vyloučené plochy a přesné výsledky](../wp/WP-WORKSPACE-CLEANUP-20260919.md).

## Převzetí skutečného existujícího kódu — návazný průchod

Až po dokončení tří desktopových běhů byl přes produktové open-folder API
načten oddělený klon skutečného ShellSmithu z `b29eb502`, vytvořeného mimo
IntentSmith. Projekt 16, 43 textových souborů / 7 ukázek. Hashová kontrola
potvrdila import bez změny souborů, Git i původní instalace zůstaly nedotčené.
Úvod pravdivě vymezil statickou analýzu a zeptal se na cíl (`40-import.json`).
Výchozích 26 testů v klonu prošlo; samotný import žádný kód nespustil.

První skutečná D1 odpověď (`40-chat.json`) chybně přenesla ESM/src/index.mjs
z obecné šablony do existující aplikace. Model dostal nula ukázek po redukci
kontextu. Navazující **obecná oprava**:

- bezpečně načtený package manifest poskytuje kompaktní deklarovaný main,
  type (při absenci `unspecified`) a start/test/build, bez vykonání;
- pravidla výslovně zachovávají existující konvence; hardcoded senzorové
  předpoklady byly odstraněné z obecného kontextu;
- po zmenšení rezervy odpovědi/history se do zbývajícího místa znovu vyberou
  pozorované úryvky. Všechny zkrácené ukázky jsou označené a profil zůstává stejný;
- plán přijme `test/` či `tests/` a `.test.cjs/.test.js/.test.mjs`, stále s
  backendem určeným Node profilem a skutečnými assertions, bez příkazů od modelu.

Projektová sada **28/28 PASS**, včetně manifestů, absence typu, neplatného
JSON, deklarovaného neexistujícího main, CJS/JS plánů a zachování celého cíle.
První 23/24 běh zachoval skutečnou regresi rozpočtu: delší systémové instrukce
vytlačily dlouhý cíl. Oprava zkrátila instrukce; test se neoslabil.

Konkrétní dokončený krok: ShellSmith před `new URL()` neodmítal raw CR/LF/TAB,
WHATWG normalizace pak tiše změnila host/path. `40-url-before.json` zachycuje
reprodukci. Široká první governance odmítla již existující dynamické importy
ve dvou cizích test helper modulech (`41-draft.json`). Pro tento omezený krok
operátor výslovně připravil v klonu policy pro `src/shared` a jeden regresní
soubor s původně padajícím placeholderem; zbytek repozitáře není předstíraně
prohlášený za zkontrolovaný. Žádná aplikační implementace se ručně neopravovala.
První návazný CODE návrh (`42`) odmítl **nasazený** nový syntax guard už přes
skutečné HTTP; projekt zůstal čistý a plán nevznikl. `43` správně opravil
implementaci, ale nový modelový test očekával chybnou hlášku existujícího
odmítnutí `%0A`. Před zápisem byl zrušen. Přesná oprava `44` zachovala
implementaci bajtově a napravila pouze tento nový test; žádný dřívější test
se neoslabil.

**Výsledek převzetí:** skutečné M2 provedení `44` má `succeeded`, commit
`31dbc413af6d96006fd7beeea2ac528e899a0b25` v importované kopii. Nový test
selže na původních bajtech (`44-red-on-original.log`), přesný návrh projde
v reálném sandboxu a všech **30/30** testů původního klienta s novou regresí
projde v privátní kopii. Produkční renderer build také PASS. Po skutečném
schválení odpovídají aplikované bajty návrhu a ostatních **63** původních
souborů zůstalo shodných (`44-applied-integrity.json`).

`shellsmith-uri-input.patch` obsahuje jen skutečnou opravu a její nový test,
bez operátorské policy přípravy. `git apply --check` nad původním čistým
ShellSmithem PASS; do původní instalace se patch bezprostředně neaplikoval.
Tohle je doložené převzetí a dokončení jedné konkrétní změny, **nikoli audit či
certifikace celého ShellSmithu**. Analýza stále pracuje s omezenými ukázkami.

Navazující obecná oprava plánovače je publikovaná a **nasazená na `9660d99b`**.
Její vlastní úplný profil `existing-context-20260919`: **359 PASS / 1 FAIL /
0 BLOCKED**; opět jen známá Gate 0 pečeť. Automatická úloha
`intentsmith-project-flow-finalize-20260919.service` počkala na uvolnění GPU,
získala společný zámek a zkontrolovala přesnou původní instalaci `b0975bff`.
Receipt `deployment-existing-context/deployment.json` potvrzuje aktivní backend,
zachování auth, devíti tabulek a všech projektových dat kromě očekávaného
startovního `last_active` devíti projektů, quick_check OK a nula FK chyb.
Předčasné pokusy zůstávají v `deployment-existing-context/run*.log`: žádný
nezastavil cizí úlohu ani nepřepsal běžící backend. `pending.json` je historický
záznam čekání, nikoli aktuální stav nasazení. Úloha skončila s exit 0.

Skutečné následné HTTP/D1 čtení `45-chat.json` na instalovaném `9660d99b`
vrátilo 200, `project.collaboration`, `canExecute=false`, `plan=null`.
Odpověď správně uvádí `src/main/main.js`, CJS a přesný manifestový testovací
příkaz `node --test test/*.test.cjs`. Výběr obsahoval 3 pozorované ukázky při
stejném 4096-tokenovém profilu; první běh `40` měl nula. Není to kontrolovaný
A/B benchmark: mezi běhy se změnil také projekt a požadavek. Odpověď přiznává
neznámé obsahy a IPC, priority zůstávají obecné; formulace „funkční testy“
není audit celé aplikace. Samotný čtecí tah žádné nové testy nespustil.
Zvlášť doložených 30 testů a build pochází z kroku `44` popsaného výše.

Finální lokální soupis je `final-summary.json`; `final-evidence-manifest.json`
připíná soubory tohoto dokončeného průchodu včetně screenshotů, modelových
návrhů, dvou posledních úplných profilů, nasazení a následného čtení.
Soukromé Electron profily a jednorázové runtime kopie nejsou vydávané za důkazy.
Ověřeno **1 652 souborů / 16 066 376 B**; SHA-256 manifestu:
`02ea5f0e0c619bf3f838ab1b42d3b26abd68f93779e87d125a76526c069df943`.
Manifest připíná implementační `9660d99b`; závěrečný commit mění pouze dokumentaci.

## Historické checkpointy (zachované beze změny)

Následující popisy nehotových aplikací/instalací platily v čase daného
checkpointu. Aktuální inventura je výše.

## Novější checkpoint: desktop a přesné opravy

Aktivní IntentSmith je `a77cb63b`. SystemSmith_1 je skutečně nainstalovaný v
nabídce aplikací na `70d146936e2157008e3837774aa7c1edfe88c47c`.
`system-desktop-zykJG9/result.json` dokládá vlastní launcher, skutečné host
údaje, dvě různá PID, exit 0, obnovení délky historie a screenshoty. Šedesát
sekund měření celého stromu dalo 488,317 MiB PSS / 7,2085 % jednoho CPU jádra
v privátním Xvfb se software renderingem při souběžném CODE. Není to důkaz
nízkých nároků ani srovnání s Mission Center. README utility vymezuje
nepodporované per-process GPU/network údaje a ne-NVIDIA GPU.

WeatherSmith má ověřené živé Open-Meteo forecast/geocoding a NewsSmith všech
pět RSS zdrojů (BBC technology/science/world, Root.cz, Seznam Zprávy).
Kontrolovaná místa Praha/Brno nejsou zjištěná poloha operátora. Desktopové
kontrolery widgetů ještě nejsou hotové; chybný weather návrh `23g` není použitý.

Nová obecná oprava `revisionOf` interně vrací `replacements`, nikoli celé
`afterContent`: 1–16 přesných, jednoznačných, nepřekrývajících se úseků proti
stejnému předchozímu souboru. Vnější M2 plán nadále obsahuje úplné before/after,
pevné cesty, test a nové schválení. Limity výsledku, origin/digest/revision,
atomická dávka i explicitní reusePrevious zůstávají. Model nemůže náhradou
určit cestu nebo získat oprávnění. Service 88/88 zahrnuje nejednoznačné,
překrývající se, sekvenčně závislé a příliš velké náhrady; při chybě nevzniká
plán ani zápis. Skutečný účinek na kvalitu další opravy se teprve ověřuje.

Governance scanner už nepovažuje `from` uvnitř exportované funkce/deklarace
za re-export. Skutečné re-exporty a importy se kontrolují dál; 22/22 zahrnuje
původní reprodukci i zakázaný skutečný import. Jde o konzervativní scanner,
nikoli úplný parser JS. Dřívější chyby `23a/23b` nelze tomuto nálezu jednoznačně
přisoudit: přesný nepřijatý výstup není v plánu uložený. Prázdné pole specifier
v redigovaném reportu neprokazuje prázdný import v modelovém zdroji.

Následující oddíly jsou starší checkpointy, nikoli aktuální inventura aplikací.

## Provoz a úklid

- Instalovaný `532b6c34e755c01b9b2d171b63d187c8f94b1350` podporuje opravu
  přesně určeného nepoužitého návrhu a zachování vybraných souborů bez další
  inference. Jiný autor, původ, digest nebo revize projektu jsou odmítnuté;
  nový plán vyžaduje nové schválení. Původní materiál zůstává neměnný.
- Skutečný `systemd --user` sandboxový probe prošel po instalaci připraveného
  AppArmor profilu pro `/usr/bin/bwrap`. Izolace M2 se nevypínala. Starší
  checkpoint `d22f64ac` zůstává historicky BLOCKED; aktuální stav už takový není.
- Nasazení ověřilo devět nezměněných datových tabulek, databázovou integritu,
  zachování autentizace a původně vypnutého Hunt timeru. Binding CODE se neměnil.
- Odstraněno 46 850 spotřebovaných testovacích adresářů v rozsahu vlastního
  checkoutu, součet 17 694 388 224 bajtů (16,48 GiB). Před i po úklidu souhlasilo
  všech 2 392 kontrolovaných hashů důkazů. Aktivní procesy, cizí rozpracované
  stromy, skutečná data a staré instalační receipty zůstaly zachované.

## Dosavadní projektový průchod

Projekt 13, `SystemSmith_1`, vzniká ve vlastní složce přes skutečný backend,
vazbu CODE/Qwen3.8, návrh, přesné schválení, sandbox a Git commit. Dosavadní
implementace sběračů je výstupem tohoto modelu. Codex kontroluje plány,
upřesňuje požadavky a dodává oddělené nezávislé ověřovací vstupy; nepíše
místo modelu implementaci utility ani nekopíruje existující SystemSmith.
Je to **asistovaný průchod**, nikoli důkaz samostatného dokončení na jeden prompt.

Zapsané kroky: CPU/RAM (`02`), síť/disky (`10`), GPU/FAN/host (`11`),
procesy/společný snapshot (`12b`). Všechny mají terminální M2 `succeeded`.
Pokus `04` prokazatelně selhal na testu a provedl rollback; jeho kód není
v aktuálním projektu. Ostatní odmítnuté návrhy, chyby kontextu i odpovědi
bez použitelného obsahu zůstávají v důkazech.

30 skutečných snapshotů na tomto hostu prošlo: nejpomalejší sběr 52,84 ms,
nejvyšší RSS procesu sběrače 101 568 512 bajtů, součet CPU času 1 636,565 ms.
Poslední vzorek obsahoval 625 procesů, 10 fan čidel a 1 GPU. **Nejde o měření
GUI ani srovnávací benchmark celé aplikace.** Desktopové okno, kompletní UX,
instalace utility a oba další projekty v tomto checkpointu ještě nejsou dokončené.

## Obecné opravy odhalené průchodem

1. Testovací profil spouští Node test discovery. Nový `test/*.test.mjs`
   nemusí přepisovat původní acceptance soubor a nemůže zůstat mimo ověření.
   Regrese skutečně spouští testovací proces: nová chyba musí selhat, opravená
   dvojice projít a následně musí selhat i porušení starého testu.
2. CODE prompt odděluje úkol aktuálního souboru od seznamu ostatních cest.
   Do každé inference už neopakuje konkurenční instrukce všech souborů;
   zachované soubory jsou označené bez generování. Cesty, test, zápisová
   oprávnění ani limity se tím nemění. Tato úprava sama nezaručuje kvalitu modelu.
3. Opravy nepoužitého návrhu zachovávají jeho funkční části. Dosavadní reálná
   měření zároveň ukazují, že model může vrátit i obsahově nezměněnou chybu;
   zelený vlastní test modelu není dostatečným důkazem správnosti. Návazná
   kontrola `M2_CODE_DRAFT_REVISION_UNCHANGED` odmítá bajtově totožnou opravu
   před vznikem nového plánu (service 74/74); tato kontrola ještě není součástí
   instalovaného `532b6c34`. Explicitní `reusePrevious` zůstává povolené.

První návazný test service měl 70 PASS / 3 FAIL: testovací fixture odvozovala
runtime přepínače pomocí pevného počtu posledních argumentů a po změně test
discovery zahodila `--disable-wasm-trap-handler`. Fixture nyní bere přepínače
před `--test`; assertion skutečné alokace WebAssembly zůstává. Opakování 73/73.
Projektová sada 24/24. Úplný profil poslední instalované verze byl 359 PASS /
1 FAIL (`nightly-orchestrator-self-test`, známá neshoda Gate 0 registru).
`532b6c34` má vlastní sériový profil 359 PASS / 1 FAIL a je nasazený.
První souběžný profil téhož commitu měl 345 PASS / 15 FAIL: čtrnáct sad
skončilo s exit 0, ale odmítla je kontrola čistoty kvůli souběžné dočasné
source fixture orchestration self-testu. Tento běh zůstává FAIL a je uložený.
Při kontrolním nasazení nejprve selhal starý seznam sedmi projektů v pomocném
ověřovači. Před nasazením přibyly projekty 14/15 (WeatherSmith/NewsSmith);
rozdíl byl pouze očekávaný `last_active` devíti projektů při startovním scanu.
Po ověření přesného rozdílu prošly všechny kontroly dat, autentizace i integrity.
Původní selhání ověřovače je zachované, nedošlo k opakované instalaci.

## Důkazy

Návazný checkpoint: SystemSmith_1 má commit `4ca9b05` s rozhraním. Browser
`15c` ověřil skutečné vykreslovací volání grafů, zachování null, nejvýše jedno
pomalé čtení, zastavení při pauze, řazení, hledání a obnovu preference.
Snapshot byl řízená fixture; fyzický Electron s host daty zatím není doložený.
WeatherSmith (14) a NewsSmith (15) jsou založené, implementace ještě chybí.
Weather D1 navrhl jen test existence souborů; operátorův asistující Codex plán
před generováním upravil na funkční data/testy. První CODE běh `21` skončil
`OUTPUT_INCOMPLETE`, bez plánu a bez zápisu. Nelze jej vykázat jako úspěch.

Úplný profil `b9620f93` prošel 359/1 (jediný stejný Gate 0 FAIL).
Další změna řadí explicitní úkol až za zdrojový kontext. Reaguje na opakované
kopírování téměř totožného vadného kódu (`16a` změnil jen import). Cesty, obsah,
limity a pravomoci zůstávají stejné; účinek na skutečnou kvalitu modelu musí
teprve potvrdit následující pokus. Nejde o nové měření role ani důkaz autonomie.

Společný Electron 42.11.3 se podařilo spustit ze skutečné uživatelské systemd
služby přes již povolený bwrap user namespace, s renderer sandboxem a context
isolation, bez Node v rendereru. Doplňující žádost o instalaci dalšího root
AppArmor profilu byla zrušená, profil se neinstaloval. Úspěšný izolovaný runtime
probe není důkazem dokončení tří aplikací.

Lokální kořen: `.intentsmith-artifacts/three-projects-20260919/`.
`NN-request.json` obsahuje konkrétní schvalovaný vstup; `NN-draft.json` přesné
modelové bajty a digest plánu; `NN-approve.json` skutečný výsledek včetně
rollbacku/commitu. `NN-independent-test.json` je oddělená kontrola přesných
bajtů v soukromé kopii, ne náhrada živého M2 provedení.
Nasazení: `deployment/deployment.json`; fyzická data: `02-live-host.json`,
`10-live-host.json`, `11-live-host.json`, `12b-host-soak.json`.
Úklid: `/home/belphareon/Projects/.intentsmith-artifacts/cleanup-20260919/owned-result.json`.

Technické podklady: [Linux diskové čítače](https://docs.kernel.org/admin-guide/iostats.html),
[procfs](https://docs.kernel.org/filesystems/proc.html),
[Electron izolace](https://www.electronjs.org/docs/latest/tutorial/security).
