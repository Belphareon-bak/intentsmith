# Tři skutečné projekty — průběžné důkazy 19. 9. 2026

**IN_PROGRESS / APPLICATIONS_NOT_COMPLETE / REVIEW_PENDING.** Pořadí operátora:
SystemSmith_1, widget počasí, widget zpráv; teprve potom převzetí cizího projektu.
Jde o obecnou zkoušku projektové práce, nikoli o specializaci IntentSmithu na monitory.

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
