# Re-review R1–R3: soukromí a viditelnost panelů

Stav: **IMPLEMENTED / INSTALLED / REVIEW_REQUIRED**.
Původní nezávislé `CHANGES_REQUIRED` je zachované. Výchozí source `ba7c72d6`,
větev `work/privacy-panels-rereview-20260917`. Autorita je operátorovo předané
re-review, rozsah v [WP](../wp/WP-PRIVACY-PANELS-REREVIEW-20260917.md).
Oprava obecného časového kontextu zůstává součástí kandidáta.

## R1 — odmítnutý vstup v logu

`src/routes/chat.js` již nevypisuje preview těla před kontrolou soukromí.
Test `chat-privacy-http` spouští skutečný server s `C3_LOG_LEVEL=info`,
kontroluje pozitivní přítomnost INFO logování a posílá odlišné canary přes
kanonické M1 `/api/chat`, kompatibilní `/api/chat` i `/chat`. Všechny vrátí
409, bez nové konverzace, zprávy či canary v zachyceném stdout/stderr po
ukončení procesu. Původní zdroj selhal právě na kompatibilním preview;
negativní důkaz se nemaže.

## R2 — pracovní paměť projektu

`SessionState` uplatňuje současnou policy při získání živého stavu i obnově
uložené relace. Změna přepínače odstraní cache cíle/souboru/artefaktu před
dalším tahem; při vypnutí se nečte projektová `working_memory`. Obnova je
čisté čtení, již nepoužívá write-through settery. Zápis hodnot ověřuje
současnou DB policy a serializace při vypnutí neobsahuje pracovní paměť.

Nejde o skrytou výjimku pro uloženou provozní paměť: dřívější hodnoty se
nepoužijí. Výslovný nový cíl v živé relaci může sloužit jejímu řízení a
kontrole odchylek; při vypnutí se neobnoví po restartu a neukládá se do
projektové pracovní paměti. Přepnutí zpět na true dovolí opětovně načíst
dříve uložené hodnoty. Přepínač nemaže historii ani již uložená data.
Obsah dřívějších zpráv podléhá samostatnému nastavení historie, nikoli tomuto
přepínači; nepodporovaný režim bez historie stále blokuje nový chat.

Test používá skutečný `projectHandler`, privátní SQLite a všechny tři
hodnoty: kladné načtení při true, čerstvou/teplou/serializovanou relaci při
false, explicitní pomíjivý cíl, zachování drift kontroly, zákaz zápisu a
opětovné true. Celé projektové řádky zůstávají shodné. HTTP test navíc ověřuje
nastavení a projektovou odpověď přes skutečný procesový restart nad stejnou
DB. Nové programy se nepřidávají; rozšířeny jsou dva již registrované testy.

## R3 — boční panely

Převzat přesný commit `4fca7e67c0b853fb85fc6ea9ba702e5a9d00f815`
jako `da0c912047caa28b20b3f7520f527b4c2a19262f`, bez konfliktu.
Activity bar se dál skrývá, celý rodič navigace/chatu už nedostane nulové
maximum šířky. Profil ani nastavení se nemažou. Převzatý lifecycle test
pokrývá startovací šířky 0/32/240/420 px na obou stranách.

## Ověření původního opravného řezu `3bbf8bc1`

- Privacy + související settings: **36/36 PASS**, včetně skutečného HTTP.
- Produkční Studio build a consumer/protocol/preload kontrola: **PASS**.
- Registr: **519**, nezměněný hash
  `04252cb29ea270886c049b01034c2bfec034a77d22ec4675decf593ae052ecb6`.
- Module boundary: **1 339 hran**, žádná přidaná/odebraná, 3 cykly / 28 členů.
- Session context **66/66**, chat fixes **58/58**, Studio **127/127 PASS**.
- Čistý instalační snapshot: privacy **11/11 PASS**, consumer guard PASS.
- Úplný profil na `3bbf8bc1`: **354 PASS / 1 FAIL / 0 TIMEOUT / 0 BLOCKED /
  0 SKIPPED**, celkový verdikt **FAIL**. Jediné selhání je
  `IS-T1-TESTS-NIGHTLY-ORCHESTRATOR-SELF-TEST`:
  `registry hash differs from the reviewed Gate 0 policy`.
- Fyzický Electron v privátním profilu: startup, Nastavení, reload PASS;
  levý rodič 240 px, pravý 416 px, oba ve viewportu, hit-testing i vstup chatu
  dostupné. Ověření běžného nainstalovaného profilu přes GTK ikonu také PASS:
  otevřené Nastavení a reload, stejné šířky a dostupné oba vstupy chatu.

## Instalace, data a přesné review piny

První nainstalovaný opravný runtime: **`3bbf8bc1b354bbee187d5fe51a21b00072b4d3d9`**.
Review rozsah **`ba7c72d6..3bbf8bc1`** zahrnuje i převzatou panelovou opravu.
Následný dokumentační commit obsahuje výsledky, nemění produktový zdroj.
[Strojový záznam](../execution/runs/privacy-panels-rereview-20260917.json)
obsahuje ověřený hash úplného reportu a všech **355 suite logů**.

Čistý detached snapshot používá stejné ověřené závislosti a Studio build;
nejde o nové stažení balíčků. Bundle SHA-256:
`c49fc709d3f5085142b913e3205b6621f735fb010f57eae1ec3b572d8b0f9bda`.
Instalátor provedl zálohu a migration probe, sjednotil backend/Studio/hunt
na nový pin a spustil backend. Záloha:
`~/.local/state/intentsmith/installation-backups/2026-09-17T14-20-39-295Z/`.
Hunt zůstal inactive, timer active/persistent. Diagnostické Studio bylo
po ověření zavřeno a znovu otevřeno běžnou ikonou bez debug portu.

DB `quick_check=ok`, 0 FK porušení. Obsah 10 řádků `project_memory`,
28 položek `memory`, 7 desired bindings, 503 evaluací, 21 hunt pokusů
i nastavení má stejné hashe před/po aktualizaci. Žádné skutečné modelové
měření tento běh nespouštěl. API bez capability vrací 401, s ní 200.

Zachované diagnostické neúspěchy: první kontrola PID čekala pole argv,
Electron má přepsaný procesový titulek; identita byla následně ověřena také
přes `/proc/PID/exe` a okno zavřeno standardní WM zprávou. Backend mezitím
prodělal krátký dodatečný restart. První CDP připojení před připraveností
narazilo na starý port. První navigační sonda klikla na již otevřené Nastavení,
čímž podle existujícího UI přepnula do konverzačního focusu; upravená sonda
rozlišuje aktuální pohled. Tyto pokusy nejsou vydávané za PASS.
Privátní Electron sonda uchovává také chyby vypnutých vedlejších endpointů
a vynuceného úklidu vlastních procesů; nejde o důkaz funkčnosti těchto ploch.

Zdroj je zveřejněný na
[`work/privacy-panels-rereview-20260917`](https://github.com/Belphareon-bak/intentsmith/tree/work/privacy-panels-rereview-20260917).
Větev obsahuje také níže popsanou souběžnou integraci specialistů. GitHub
`main` a nezávislé re-review zůstávají samostatné otevřené kroky.
Původní review výsledky se nepřepisují.

## Souběžná integrace a skutečný konečný runtime

Během dokončování ověření druhý worker nasadil **`3f005fc097c82cd9fef49ca946758d005ef00235`**.
Předtím zjistil instalovaný `3bbf8bc1` a zahrnul jej do merge; opravy R1–R3
ani hodiny tím nezmizely. Jeho samostatný rozsah a omezení popisuje
[specialistický packet](2026-09-17-STUDIO-SPECIALISTS.md). Tato větev převzala
merge jako `e564f22c` a doplnila review evidenci. `git diff 3f005fc0 e564f22c`
mění jen dokumentaci; produktový kód, kontrakty, závislosti i testy jsou stejné.

Na skutečném `3f005fc0` byly znovu ověřeny privacy regrese **11/11** a Studio
**130/130**, consumer build a skutečné panely při otevřeném Nastavení/reloadu:
**240/416 px**, platný hit-testing, dva dostupné chatové vstupy. Potom bylo
diagnostické okno zavřeno a Studio spuštěno běžnou ikonou bez debug portu.
Běžné okno dosáhlo ready; později bylo zavřeno mimo tuto sondu, proto se
násilně znovu neotevíralo. Backend zůstal aktivní (PID 663954), API 401/200,
hunt inactive, timer active/persistent. Sledované DB hashe se stále shodují.

| Běh | Přesný výsledek |
| --- | --- |
| Celý profil v dlouhé instalační cestě `3f005fc0` | **355 PASS / 3 FAIL / 1 BLOCKED** |
| Celý profil z pracovního checkoutu `e564f22c` se stejným kódem | **357 PASS / 1 FAIL / 1 BLOCKED**, verdict **FAIL** |
| Účetní integrace, samostatný OCR runtime na `3f005fc0` | **1/1 program PASS**, 8 vnitřních kontrol |
| M2 process supervision, samostatně z pracovního checkoutu | **1/1 program PASS**, 13 vnitřních kontrol |

Závěrečný jediný FAIL je `nightly-orchestrator-self-test` / release seal.
BLOCKED je `accountant-workflow-integration`: obecný PDF runtime a účetní
OCR runtime mají různé připnuté závislosti. Tento program proto běžel
samostatně s `INTENTSMITH_PDF_PYTHON=~/.local/share/ucetni/venv/bin/python`
a explicitním opt-in obou toolchain položek. První ruční opt-in ještě
použil obecný PDF runtime a selhal **2/8 kontrol PASS, 6 FAIL**; i tento
log zůstává. Výsledky samostatných běhů se nesčítají do zeleného full gate.

Dva další FAIL z instalační cesty se neskrývají:

- M2 fixture vytváří pathname socket pod celým checkout path. V dlouhé
  SHA instalační cestě požadované jméno neexistuje: samostatná sonda
  reprodukovala zkrácení 169bytové cesty na skutečný 108bytový socket.
  Test beze změny zdroje prošel v kratším pracovním checkoutu, samostatně
  i v celém profilu. Produkční sandbox ani assertions nebyly oslabeny.
- Heap kontrola specialist loaderu naměřila nejprve **12,38 MB** proti
  limitu 10 MB, v opakovaném plném profilu **6,70 MB**. Test běží bez
  povinného GC; samotný rozdíl není důkaz produkčního memory leaku ani
  uzavření jeho možnosti. Metrika zůstává nestabilní a zaslouží samostatné
  měření retained heap. Limit ani test nebyly změněny.

Společný registr má **523 programů** (`429 ACTIVE / 79 BLOCKED / 15 HISTORICAL`),
hash `f29ced20ed0c8e847d8f28ff92a19231c75b78328d18ede86f8bd5c4cb35a4c4`.
Graph **1 358 hran / 3 cykly / 28 členů** prošel ratchetem. Strojový záznam
uchovává hashe obou společných full reportů, všech jejich 358 vytvořených
logů a oddělených kontrol. Nová nezávislá acceptance zůstává otevřená;
živý Sázkař má samostatný `PROVIDER_BLOCKED` z packetu druhého workera.

Lokální důkazy jsou v `.intentsmith-artifacts/privacy-panels-rereview-20260917/`.
`http-before.log` a `memory-before.log` jsou očekávané FAIL na původním
zdroji. Release seal je oddělená práce podle CONTRACT §8; nepřipíná se jen
kvůli zelenému výsledku vývojové větve. Tento packet nedává M5/M6 acceptance.
