# Studio 2 — schválená paleta nastavení B + 20 %

Autorita: operátor 29. 9. 2026 vybral variantu B z náhledu
`studio2-settings-options-20260928-34b424c3` a požadoval o 20 % vyšší
sytost barevných ikon. Po upozornění, že stále vidí předchozí verzi,
byl dokončen build, ověření a přepnutí instalovaného frontendu.
Rozsah: [WP posledních relací a kategorií](../wp/WP-STUDIO-2-RECENCY-CATEGORIES-20260928.md).

**LOCAL_PRODUCTION_DEPLOYED / IMPLEMENTATION_VERIFIED / REVIEW_PENDING.**
Nezávislé review této delty neproběhlo. Zděděná Gate 0 pečeť celého
integračního profilu má FAIL; veřejnou přejímku M5/M6 tento balík nemění.

## Proč uživatel viděl starou verzi

Schválená paleta byla ve zdrojích a nově sestaveném balíku, ale instalace
ještě ukazovala na frontend `32361710`. Otevřené okno navíc nahraný frontend
za běhu nevymění. Nyní `installation.json` ukazuje na AppImage ze zdroje
`fddfe9966e7cea648bff3bb4d2bdcfdd0900f3d2` se SHA-256
`705ea03a353af6549e8ff483599875b577782fe0469df322f7f178862693d006`.
Instalovaný soubor:
`/mnt/vi7000/intentsmith/releases/studio2-frontend-fddfe9966e7cea648bff3bb4d2bdcfdd0900f3d2/IntentSmith-Studio2.AppImage`.

## Co přesně se změnilo

- Nastavení opět používá obrysové symboly a významy z vybrané varianty B,
  včetně posuvníků pro Účet, databáze pro Paměť, kódu pro Výstup, čipu pro
  Systém a disku pro Zálohy. Ikona má 32 px v dlaždici; podklad tvoří
  10% příměs její barvy do panelu, bez viditelného okraje.
- Dvanáct odstínů má přesně pořadí předlohy B:
  `65, 35, 300, 280, 260, 240, 220, 200, 180, 160, 140, 115` stupňů.
  OKLCH chroma tmavého motivu je `0.084` místo `0.070`, světlého
  `0.07812` místo `0.0651`; světlost i podklady zůstaly stejné.
- Kanonický prototyp, generovaná React vrstva a test očekávání nyní
  odpovídají této volbě. Konektory a paleta levé navigace zůstaly byteově
  stejné. Předchozí report `32361710` je historický stav, ne aktuální
  vzhled ikon nastavení.

## Ověření

| Kontrola | Výsledek |
|---|---|
| Prototyp a generovaná vrstva | **1916 kontrol PASS**, fuzz 3000 bez chyby, generátor `--check` PASS |
| LiveModel / SessionStore | **72/72 PASS** / **14 skupin PASS** |
| Dokumentační integrita | **160/160 PASS** |
| Node 24 produkční build, M1 guard, AppImage | PASS |
| Skutečný AppImage proti stávajícímu backendu | PASS: skutečné konverzace a projektové časy, MRU 1–5, obnova relace |
| Schválená B ve skutečném AppImage | PASS: stejné tvary, pořadí 12 odstínů, 10% podklady a přesná chroma ×1,2 v **11 kombinacích motivů** |
| Kontrast ikon nastavení / kategoriálních štítků | nejméně **4,94 : 1** / **4,82 : 1** ve zkoušených motivech |
| Electron UI gate, zdroj `fddfe996` | PASS: výlučný frontend, strop relací, ochrany práce, motivy, reload, žádný restartovací dialog |
| Přepnutí produkčního pinu / běžné spuštění bez CDP | PASS / PASS; vlastní rám, čisté ukončení |

Vstupní profil celého integračního auditu na `b5fda0f1` měl **385 PASS /
1 zděděný FAIL Gate 0**. Tento audit není vydáván za nový celý běh na
`fddfe996`; finální revize má cílené testy, reálný Electron a AppImage.
První pokus testovacího helperu špatně porovnával text `.68` s `0.68`,
další preflight měl chybné očekávání revize a po restartu hostitele
neplatnou cestu k Xauthority. Tyto neúspěšné pokusy zůstávají v soukromé
pracovní evidenci; opravené finální běhy prošly. Nešlo o selhání aplikace.

Instalace změnila pouze pin `studioAppImage`. Ostatní kontrolované soubory,
backendová služba a její PID `2026` zůstaly během přepnutí stejné. Čtení
původní DB před/po: `quick_check=ok`, nula porušených vazeb, stejné počty
**51 konverzací / 2 zpráv / 16 projektů / 7 modelových vazeb** a všech sedm
celých modelových záznamů přesně shodných. Jde o stav tohoto běhu; starší
report měřil DB v jiném okamžiku.

## Vyzkoušení a důkazy

Uložit rozpracovanou práci, zavřít **svá otevřená okna IDE 2.0** a znovu
spustit ikonu IntentSmith IDE 2.0 nebo `gtk-launch intentsmith`. Profil,
backend ani Legacy se při tom nemažou. Staré okno dál vykresluje dříve
nahraný frontend.

[Předloha B vedle screenshotů aktuálního AppImage](/mnt/vi7000/intentsmith/evidence/studio2-settings-b20-20260929-fddfe996/index.html)
obsahuje tmavý i světlý motiv, seznam i dlaždice, běžný start, měření a
SHA-256 všech 20 souborů. Paket je místní soukromá evidence; screenshoty
uživatelských dat se na GitHub nepublikují.
