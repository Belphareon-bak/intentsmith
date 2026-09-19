# SystemSmith_1: skutečný projektový průchod a opravy produktu

Stav: **IMPLEMENTATION_VERIFIED / REVIEW_PENDING / APPLICATION_INCOMPLETE**.
Autorita: operátorovo zadání samostatně vytvořit SystemSmith_1, nikoli kopii
existujícího SystemSmithu. Review rozsah `ee5f36b9..df1fc3b7`; nasazený runtime
`df1fc3b73d0b588727d434eb71cae0ac6a248840`. GPU hunt ani modelové bindingy
nejsou změnou tohoto balíku. Vizuální ladění je odložené podle operátora.

## Co skutečný modelový průchod ukázal

Projekt vznikl autentizovaným produktovým API. Původní přirozené zadání dostal
skutečný M1 chat; D1 používal existující binding `qwen3.5:27b`, CODE
`qwen3.8:latest`. Zdrojáky existujícího SystemSmithu ani ShellSmithu se nečetly
ani nekopírovaly. Codex následně dával připomínky k návrhu, neimplementoval
za model zdrojáky utility.

1. První odpověď bez měření prohlásila senzory za nedostupné a potřebovala
   upřesnění OS/frameworku. Návrh zaměňoval směr závislostí a doporučil
   čtení `/proc` pomocí `execSync`.
2. Po připomínce vznikl skutečný M2 návrh tří souborů: CPU reader, RAM reader
   a akceptační test. Obsahy, hashe a přesný plán jsou uložené v DB i důkazech.
3. Ruční kontrola odmítla maskování resetů CPU čítačů pomocí `Math.max(0, …)`
   a nemožné hodnoty RAM. Modelové testy tyto případy nepokrývaly. Plán
   `lifecycle:0a96634f-d287-4cb9-9148-b4fcd213043f` byl **zrušen před zápisem**.
   Zelená governance sama neznamená správné výpočty ani dostatečné assertions.
4. Další modelová odpověď dostala konkrétní připomínky. Při kontrole produktu
   se navíc ukázalo, že původní popis se zkracuje na 300/180 znaků a CODE
   nevidí hotové moduly mimo právě přepisované cíle.

Důkazy jsou pod `.intentsmith-artifacts/systemsmith-project-20260919/`:
`01-chat.json`, `02-chat.json`, `03-chat.json`, `04-draft.json`,
`04-cancelled.json`, `05-chat.json`, `first-candidate-review.json`.
Žádný z těchto kroků není tvrzení, že vznikla hotová aplikace.

## Opravy a hranice review

- **Celý původní cíl:** popis projektu se při výběru kontextu nezkracuje.
  Pokud se nevejde spolu s aktuálním požadavkem, plánování odmítne požadavek
  s vysvětlením. Kontextové okno ani schválený profil D1 se nezvyšovaly.
- **Pozorované prostředí:** model dostává OS, architekturu, verzi Node a
  povolené kořeny/importy projektu. Senzory zůstávají `not_probed`; povolený
  import není důkaz nainstalované závislosti. Plán mimo kořeny se odmítá ještě
  před nabídnutím generování. Prompt vysvětluje směr závislostí a oddělení
  čistých sběračů od GUI.
- **Návaznost modulů:** každá položka souboru může uvést `contextFiles` —
  nejvýše osm existujících cest pouze ke čtení. Cesta nesmí být současně
  zapisovaný cíl. Používá stejnou kanonickou validaci cest, manifest,
  `O_NOFOLLOW`, odmítnutí hardlinků, kontrolu digestu a úplné UTF-8 obsahy.
  Stav `read_only` je odlišen od `proposed`. Kontext se nikdy nemění na efekt.
  Po generování se znovu ověří revize celého projektu. Nevejde-li se kontext,
  nevznikne částečný plán ani tiše zkrácený zdroják.
- **Desktopový základ:** explicitní typ Desktop je v HTTP i průvodci.
  Deklaruje Electron 42.11.3 (verze přítomná v nástrojích tohoto checkoutu),
  start a povolené importy `electron`/`node:child_process`. Nic neinstaluje
  ani nespouští. Pokyny vyžadují izolovaný renderer a úzké preload IPC.
  Nové základy dovolují také úpravy package/README/ROADMAP. Staré ani cizí
  politiky se automaticky nerozšiřují. Skutečná bezpečnost výsledné aplikace
  stále potřebuje kontrolu vygenerovaného kódu; samotný prompt ji nevynucuje.
- **Oprava strukturálního návrhu:** model dostává skutečné existující adresáře.
  Chybějící adresář, cyklus nebo jiný vyjmenovaný strukturální problém dovolí
  nejvýše jednu opravu plánu s konkrétní zpětnou vazbou. Chyba provideru,
  přerušené generování, cancellation ani změna revize se neopakují. Testy
  pokrývají úspěšnou opravu, druhé odmítnutí i zákaz opakování chyb provideru.
- **Kanonická pravidla šablony:** opravené pořadí kořenů/importů. Kontrola proti
  skutečnému M2 kontraktu nejdříve reprodukovala chybu, potom prošla pro oba
  typy. U našeho čistého projektu id 13 se jednorázově opravilo pouze pořadí
  týchž položek (commit `4a6072f`); žádné oprávnění ani implementace nepřibyly.
- **Souborové kořeny inventury:** baseline nyní přečte také jednotlivý přesně
  uvedený soubor, např. README/package, přes tentýž bezpečný reader a velikostní
  limit jako soubory v adresářích. Symlinky, hardlinky, chybějící a nadlimitní
  soubory zůstávají odmítnuté. Nové integrační testy pro skutečný general i
  desktop základ nejprve selhaly a po opravě prošly draftem, schválením,
  skutečným bwrap testem i Git commitem. Generátor v těchto dvou testech je
  deterministická fixture; nejde o modelový důkaz funkční utility.
- **Studio:** formulář zachovává a umožňuje upravit kontextové cesty.
  Souhrn desktopového projektu pravdivě uvádí nenainstalovaný Electron.

Schvalovaný diff, test, Git identita a procesový sandbox zůstávají v dosavadní
M2 autoritě. `dependsOn` nadále odkazuje jen na jiné cíle dané dávky.
`contextFiles` je kompatibilní rozšíření vstupu draftu, nikoli rozšíření
zapisovací pravomoci. Relevantní soubory: `project-collaboration.js`,
`project-onboarding.js`, `m2-code-draft.js`, `m2-lifecycle-application-service.js`
a ruční Studio modul. Importový graf nemá novou hranu.

## Ověření

- Projektová spolupráce **22/22**, Studio M2 **39/39**, M1 klient **133/133**.
- M2 application service **66/66**, včetně existujícího kontextu, neexistující
  cesty, traversal, překryvu s cílem, chráněné cesty, velikosti a změny revize.
  Existující reálné bwrap testy této sady běží z IDE testovacího prostředí;
  jejich úspěch neřeší odlišný AppArmor kontext systemd služby.
- Produkční Studio build a kontrola spotřebitele **PASS**. Skutečný Electron
  v odděleném profilu prošel tvorbou desktopového projektu přes GUI/HTTP,
  zobrazením kontextového pole a kontrolou závěrečného souhrnu. Tento GUI test
  nepoužíval model ani produkční databázi. Snímky: `desktop-created.png`,
  `readonly-context-composer.png`, `desktop-review-final.png`.
- Úplný offline/database audit na neměnném `df1fc3b7`: **359 PASS / 1 FAIL**,
  360 programů. Jediný non-PASS `nightly-orchestrator-self-test`:
  `registry hash differs from the reviewed Gate 0 policy`. Verdikt zůstává
  **FAIL**, operátorská pečeť se neupravovala.
- Registry **525** programů, fingerprint
  `fbe1945675b7ccc36eeea1e86139b0c663254c45df77c775a240ae59213d2ea0`;
  module boundary **1378** hran, bez přidané hrany proti baseline 1379.

První úplný běh `systemsmith-flow-2c05bf63` se zachovává: **285 PASS / 75 FAIL**.
72 programů mělo exit 0, ale neplatnou identitu zdroje po mém následném commitu
s opravou textu průvodce. Další tři selhání: zastaralý LOC census, mobilní
browser a očekávaná release pečeť. Census je opravený (včetně zachovaného
neúspěšného mezikroku formátování). Mobilní sada prošla samostatně **24/24**
a v čistém finálním profilu; příčina prvního selhání není prokázaná, produktový
mobilní kód se neměnil. Neúspěšné logy nebyly přepsané ani smazané.

Další zachovaný běh `systemsmith-flow-71cdf1e4`: **358 PASS / 2 FAIL**.
Vedle pečeti selhal `m7-durable-rate-limiter` při souběhu procesů na
`database is locked`. Samostatné opakování prošlo **11/11** a nejnovější úplný
profil také PASS. M7 kód se neměnil; příčina časově ojedinělého selhání není
prokázaná. Tento neúspěšný běh se nezaměňuje za čistý nejnovější profil.

Mezilehlé úplné profily `c0eeec50` a `ec78722b` mají shodně 359 PASS / 1 FAIL.
Nejnovější důkaz:
`gate-file-roots/systemsmith-flow-df1fc3b7/report.json` + `inventory.json` a 360 logů.
SHA-256 inventář relevantních souborů: `evidence-sha256.json`.

## Nasazení, data a aktuální stav utility

Instalátor pořídil zálohu
`~/.local/state/intentsmith/installation-backups/2026-09-19T06-12-13-579Z`.
Backend je aktivní, autentizované HTTP 200, bez autentizace 401. DB
`quick_check=ok`, bez FK chyb. Kontrola proti záloze potvrdila shodné zprávy,
konverzace, evaluace, rozhodnutí, bindingy a paměťové tabulky; projektům mohl
pouze startup posunout `last_active`. Administrátorský credential zachován.
Následující tvorba/archivace testovacího projektu je samostatně zaznamenaná.
Důkaz: `deployment-file-roots/deployment.json`, `desktop-current.json`,
`first-attempt-archived.json`. Starší instalační důkazy a skutečně nainstalované
release kopie zůstávají zachované pro audit/rollback.

Původní kontrolní projekt id 12 byl se všemi konverzacemi archivován. Jeho
čistý výchozí Git strom se zachoval v `first-attempt-project/`, nic se nemazalo.
Nový aktivní **SystemSmith_1, id 13**, vznikl z desktopového základu v
`~/Projects/intentsmith/projects/systemsmith_1`; konverzace
`conv-1789795632117-ye567eh8z`. Celý původní požadavek je uložený v jeho popisu.
Zatím jde o základ, ne o funkční systémový monitor. Cizí CODE měření dočasně
zastavilo inference společným zámkem; po uvolnění jsme pokračovali. Běh druhého
workera se nepřerušil, bindingy se nezměnily.

Navazující průchod: `06-chat.json` odhalil neexistující `src/config`;
`07-chat.json` zbytečnou otázku na GUI; `08-chat.json` skutečný limit dlouhé
připomínky vedle celého původního cíle. Kratší `09` a zpřesňující `10` již
navrhly izolované CPU/RAM sběrače a test. `11-draft.json` odmítl nekanonická
pravidla a `12-draft.json` odmítl neúplnou baseline kvůli souborovým kořenům.
Obě chyby jsou opravené obecně a mají reprodukční testy. Žádný z těchto
neúspěchů nevytvořil částečný zapisovací plán.

Po nasazení `df1fc3b7` vznikl skutečný pending plán `13-draft.json` pro
`src/cpu.mjs`, `src/ram.mjs` a test. Původní modelové testy na přesné soukromé
kopii pod skutečným M2 sandbox providerem skončily **6 PASS / 1 FAIL**: validní
RAM vracela `null` (regex klíč bez dvojtečky, konstanty s dvojtečkou; navíc
chybělo UTF-8 v implicitním readeru). Nezávislé CPU sondy našly 66,67 místo
50 %, přijetí poškozeného čítače jako 90 % a 110 % při poklesu čítače.
`13-audit-probes.json` uchovává vstupy/očekávání/výsledky. Guest čas se již
účtuje do user/nice, jak ukazuje
[kernel account_guest_time](https://github.com/torvalds/linux/blob/master/kernel/sched/cputime.c).
Nesmí se při součtu přičíst znovu. Dokumentace kernelu také upozorňuje na
[možný pokles iowait](https://docs.kernel.org/filesystems/proc.html#miscellaneous-kernel-statistics-in-proc-stat);
nepoužitelný vzorek nelze nahradit vymyšleným procentem.

Plán `lifecycle:4e9b8542-cbb4-4e3a-82c2-16a275303547` byl zrušen před produkčním
zápisem (`14-cancelled.json`); model dostal konkrétní opravnou připomínku.
Soukromé sondy nejsou schválením M2 ani důkazem spuštění ze systemd.

Fyzické čtení hosta potvrzuje /proc zdroje i hwmon ventilátory nct6687.
`host-sensor-observation.json` obsahuje konkrétní hodnoty a čas, nikoli tvrzení
modelu. Požadavky, které ještě nejsou implementované, vede
`requirements-progress.json`.

## Co brání dokončení celého průchodu

1. **Systemd sandbox:** i po instalaci opravy produktu skutečný procesový
   provider vrací `bwrap: loopback: Failed RTM_NEWADDR: Operation not permitted`.
   To není vyřešené zelenými testy z IDE. `sudo -n` vyžaduje heslo, které agent
   nemá. Připravený AppArmor profil a dva instalační příkazy jsou v
   [DESKTOP.md](../DESKTOP.md), část Sandbox projektových testů. Operátor dostal
   jednorázový požadavek na nahrání profilu; odpověď zatím nepřišla. Izolace
   se nevypínala. Důkaz: `systemd-sandbox.log`, `systemd-sandbox-final.log`,
   `systemd-sandbox-df1fc3b7.log`.
2. **Kapacita a kvalita modelu:** schválený profil D1 je 4096. Celý původní cíl
   zůstává zachovaný, delší další připomínka se však nemusí vejít. Plánování
   a testové assertions stále vyžadují kritickou kontrolu; nikoli souhlas se
   vším, co model navrhne. GPU blokace byla dočasná a zámek se neobcházel.
3. **Aplikace:** po odstranění provozní překážky znovu projít modelový návrh,
   přesnou změnu, behaviorální testy a opravy; následně všechny metriky,
   historii 1m–1h, perzistentní nastavení, GUI, procesy a integraci do nabídky.
   Změřit režii a prověřit chybějící senzory, restart i delší běh.

Žádný spojený důkaz hotové aplikace ani její výkonnosti zatím neexistuje.
Tento packet připravuje review oprav projektového postupu; není release
akceptace, vyřešení AppArmoru nebo prohlášení autonomního builderu za dokončený.
