# Studio 2 — oprava startu původního profilu

Autorita: operátorovo hlášení prázdného okna s dialogem Restart a předchozí
zadání dokončit, otestovat a místně nasadit IDE 2.0; staré UI ponechat jako
Legacy. Rozsah: [WP-STUDIO-2-PRODUCTION](../wp/WP-STUDIO-2-PRODUCTION-20260928.md).

**LOCAL_PRODUCTION_DEPLOYED / IMPLEMENTATION_VERIFIED / REVIEW_PENDING.**
Nezávislé přijetí této opravy zatím neproběhlo. Nejde o veřejnou M5/M6 přejímku.

## Dvě skutečné příčiny

1. Studio 2 přepínalo rám až po vytvoření okna. Theia současně obnovovala
   sdílenou preferenci `window.titleBarStyle=native`. Na profilu s původním
   rámem vyvolala synchronizace dialog Restart. Předchozí zkoušky přítomnosti
   DOM a geometrie nezaručovaly nepřekryté, použitelné okno.
2. Původní profil obsahuje ve `focusFiles` objekty příloh, např. jméno,
   velikost a `type: attachment`. Nové UI je předalo jako cestu do
   `splitPath`, která volá `lastIndexOf`. React spadl a odpojil celý pohled.
   Odstranění restartového dialogu tedy samo nestačilo. Tento pád byl
   reprodukován na kopii skutečného profilu, včetně stacku a snímku okna.

## Oprava

- AppImage i zdrojový launcher používají `scripts/electron-main.js`.
  `THEIA_ELECTRON_DISABLE_NATIVE_ELEMENTS=1` se nastaví před načtením Theia
  mainu a vytvořením okna, i když profil ukládá původní nativní rám.
- Studio 2 přebírá Theia menu kontribuci pro vlastní lištu. Zachovává příkazy
  a menu model, nesynchronizuje preference rámu/menu sdílené s Legacy a
  nevytváří druhou lištu. Ostatní restartové a bezpečnostní handlery zůstávají.
  Žádný zdroj Theiy ani `node_modules` se kvůli tomu neupravoval.
- `LiveModel` rozliší cestu souboru a metadata přílohy. Přílohy zůstanou
  v uložené relaci a v panelu Kontext se zobrazí jejich jméno a velikost.
  Název přílohy se nevydává za projektovou cestu. Převod zvládne i neplatný
  jednotlivý záznam, aniž by shodil okno.
- Přejmenování a mazání projektového souboru zachovává metadata příloh;
  přepisuje pouze skutečnou cestu odpovídající provedené operaci.
- Prototyp, šablona a vygenerované React obrazovky se nemění.

## Přesná instalace

| Část | Identita |
|---|---|
| Nový frontend | `16318bf8df79eb72b0c1b8ad11dcf2cc3c130873` |
| Běžící backend | `c84b88cd0c0b76639823c82c022d2feab96dfc15` |
| AppImage SHA-256 | `315439481d8ff3f4054b20c537d2b7189c18de3c5004808469aa0ab65efde246` |
| Frontend bundle SHA-256 | `4d8b3a85d18e0b73890b48d77ae0d6a13778ed4656f8416ddf1868477c5f99a9` |
| Legacy frontend | `72247a4983abcb12d42f6da6cc5b27af8f2212fd` |

Trvalý AppImage je v
`/mnt/vi7000/intentsmith/releases/studio2-frontend-16318bf8df79eb72b0c1b8ad11dcf2cc3c130873/IntentSmith-Studio2.AppImage`.
V instalaci se atomicky změnil pouze `studioAppImage`; obsah balíku a jeho
součet kontroluje původní desktopový runtime. Konfigurace před změnou je
uchovaná v soukromé evidenci. Backend se nezastavoval: před změnou i po ní
má PID `493803`. Neproběhla migrace, výměna DB ani startup modelové sondy.

DB zůstává `/home/belphareon/Projects/intentsmith/data/c3.db`, profil
`~/.config/intentsmith-studio2`. Backendová jednotka, přístupové prostředí,
sandboxová volba, hunt hold, desktopové položky i původní nativní preference
Legacy mají původní kontrolní součty.

## Ověření finálního zdroje a balíku

| Zkouška | Výsledek |
|---|---|
| Celý offline/database profil na čistém `16318bf8` | **385 PASS / 1 FAIL / 0 TIMEOUT / 0 BLOCKED** |
| Studio 2, skutečný Electron: relace, soubory, prostředí, paleta, motivy, obnova | PASS; původní nativní preference, vlastní rám, žádný překrývající host dialog |
| M1 Electron journey | PASS; řízený wire backend, success/error/cancel/reconnect, síťová hranice a čisté ukončení |
| M2 composer Electron journey | PASS; návrh, skutečný DOM vstup a odmítnutí nepovolených efektů |
| Finální AppImage, kopie skutečného profilu: první a druhý start | PASS; původní čtyři relace, nepřekryté UI, nabídka projektů, uložený vlastní rám |
| Finální AppImage, nativní profil: první a druhý start | PASS; 20 kontrol po načtení při každém startu, žádný dialog Restart |
| Běžný desktopový launch bez CDP | PASS; také skutečný uživatelský profil, okno `1747 × 1366`, původní relace a přílohy v Kontextu |
| Legacy nad týmž backendem | PASS; soukromý testovací profil, původní nativní rám a klasické UI |
| LiveModel / session store / runner contract / integrity dokumentace | **68 / 12 / 27 / 160**, všechno PASS |
| Produkční build a M1 consumer guard | PASS; byte preload/protokol/consumer zachován |

Jediný finální FAIL je
`IS-T1-TESTS-NIGHTLY-ORCHESTRATOR-SELF-TEST`: zděděná Gate 0 pečeť registru.
Celkový audit má proto verdikt FAIL; tato známá výjimka se nepřeznačuje na PASS.
Audit je v
`.intentsmith-artifacts/test-runs/2026-09-28T17-40-28-680Z/report.json`.

Předchozí audit na `dd08b83d` měl navíc FAIL testovací fixture, která ještě
neobsahovala nové povinné důkazy nepřekrytého startu. Fixture se doplnila a
finální celý profil ověřil její opravu. Souběžné pokusy Electronu s offline
auditem také skončily `source-worktree-dirty` a jednou CDP chybou; finální
Electron běhy se provedly po skončení auditu a prošly. Tyto neúspěšné pokusy
ani první nasazená meziverze s pádem na přílohách se z evidence neodstraňují.

Integrita živé DB: `quick_check=ok`, nula foreign-key chyb, všech sedm celých
řádků modelových vazeb shodných s produkčním stavem před opravou, včetně
`applied_at`. Počty zůstávají 50 konverzací, 6 zpráv, 16 projektů a 1012
modelových evaluací. Modelový chat/M2/SCM z předchozího nasazení je historická
evidence; tato oprava nemění backend a znovu nerozbíhala GPU zkoušku.

## Důkazy a použití

Soukromý paket včetně neúspěšných pokusů, auditních logů, snímků, skriptů,
zdroje a `SHA256SUMS`:
`/mnt/vi7000/intentsmith/evidence/studio2-startup-20260928-16318bf8`.
Původní zapečetěná produkční evidence `studio2-production-20260928-c84b88cd`
se nepřepisovala. Kopie profilů a jejich IndexedDB se do nového paketu nekopírují.

Opravené okno je spuštěné běžnou položkou **IntentSmith IDE 2.0**.
Další start: `gtk-launch intentsmith`. Původní UI: `gtk-launch intentsmith-legacy`.
Není potřeba přepínat UI, mazat profil ani potvrzovat změnu rámu.
