# SystemSmith_1: skutečný projektový průchod a opravy produktu

Stav: **IMPLEMENTATION_VERIFIED / REVIEW_PENDING / APPLICATION_INCOMPLETE**.
Autorita: operátorovo zadání samostatně vytvořit SystemSmith_1, nikoli kopii
existujícího SystemSmithu. Review rozsah `ee5f36b9..c0eeec50`; nasazený runtime
`c0eeec50d569f229cc96872774ac9dc445c172bc`. GPU hunt ani modelové bindingy
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
- **Studio:** formulář zachovává a umožňuje upravit kontextové cesty.
  Souhrn desktopového projektu pravdivě uvádí nenainstalovaný Electron.

Schvalovaný diff, test, Git identita a procesový sandbox zůstávají v dosavadní
M2 autoritě. `dependsOn` nadále odkazuje jen na jiné cíle dané dávky.
`contextFiles` je kompatibilní rozšíření vstupu draftu, nikoli rozšíření
zapisovací pravomoci. Relevantní soubory: `project-collaboration.js`,
`project-onboarding.js`, `m2-code-draft.js`, `m2-lifecycle-application-service.js`
a ruční Studio modul. Importový graf nemá novou hranu.

## Ověření

- Projektová spolupráce **18/18**, Studio M2 **39/39**, M1 klient **133/133**.
- M2 application service **60/60**, včetně existujícího kontextu, neexistující
  cesty, traversal, překryvu s cílem, chráněné cesty, velikosti a změny revize.
  Existující reálné bwrap testy této sady běží z IDE testovacího prostředí;
  jejich úspěch neřeší odlišný AppArmor kontext systemd služby.
- Produkční Studio build a kontrola spotřebitele **PASS**. Skutečný Electron
  v odděleném profilu prošel tvorbou desktopového projektu přes GUI/HTTP,
  zobrazením kontextového pole a kontrolou závěrečného souhrnu. Tento GUI test
  nepoužíval model ani produkční databázi. Snímky: `desktop-created.png`,
  `readonly-context-composer.png`, `desktop-review-final.png`.
- Úplný offline/database audit na neměnném `c0eeec50`: **359 PASS / 1 FAIL**,
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

Finální důkaz:
`gate-final/systemsmith-flow-c0eeec50/report.json` + `inventory.json` a 360 logů.
SHA-256 inventář relevantních souborů: `evidence-sha256.json`.

## Nasazení, data a aktuální stav utility

Instalátor pořídil zálohu
`~/.local/state/intentsmith/installation-backups/2026-09-19T05-26-42-031Z`.
Backend je aktivní, autentizované HTTP 200, bez autentizace 401. DB
`quick_check=ok`, bez FK chyb. Kontrola proti záloze potvrdila shodné zprávy,
konverzace, evaluace, rozhodnutí, bindingy a paměťové tabulky; projektům mohl
pouze startup posunout `last_active`. Administrátorský credential zachován.
Následující tvorba/archivace testovacího projektu je samostatně zaznamenaná.
Důkaz: `deployment.json`, `desktop-current.json`, `first-attempt-archived.json`.

Původní kontrolní projekt id 12 byl se všemi konverzacemi archivován. Jeho
čistý výchozí Git strom se zachoval v `first-attempt-project/`, nic se nemazalo.
Nový aktivní **SystemSmith_1, id 13**, vznikl z desktopového základu v
`~/Projects/intentsmith/projects/systemsmith_1`; konverzace
`conv-1789795632117-ye567eh8z`. Celý původní požadavek je uložený v jeho popisu.
Zatím jde o základ, ne o funkční systémový monitor. Druhý pokus o inference
zastavil sdílený GPU zámek cizího CODE měření; běh druhého workera se nepřerušil.

## Co brání dokončení celého průchodu

1. **Systemd sandbox:** i po instalaci opravy produktu skutečný procesový
   provider vrací `bwrap: loopback: Failed RTM_NEWADDR: Operation not permitted`.
   To není vyřešené zelenými testy z IDE. `sudo -n` vyžaduje heslo, které agent
   nemá. Připravený AppArmor profil a dva instalační příkazy jsou v
   [DESKTOP.md](../DESKTOP.md), část Sandbox projektových testů. Operátor dostal
   jednorázový požadavek na nahrání profilu; odpověď zatím nepřišla. Izolace
   se nevypínala. Důkaz: `systemd-sandbox.log`, `systemd-sandbox-final.log`.
2. **GPU:** navazující fyzické modelové volání počká na uvolnění společného
   zámku měření druhého workera. Zámek se neobchází a cizí modely se neodkládají.
3. **Aplikace:** po odstranění provozní překážky znovu projít modelový návrh,
   přesnou změnu, behaviorální testy a opravy; následně všechny metriky,
   historii 1m–1h, perzistentní nastavení, GUI, procesy a integraci do nabídky.
   Změřit režii a prověřit chybějící senzory, restart i delší běh.

Žádný spojený důkaz hotové aplikace ani její výkonnosti zatím neexistuje.
Tento packet připravuje review oprav projektového postupu; není release
akceptace, vyřešení AppArmoru nebo prohlášení autonomního builderu za dokončený.
