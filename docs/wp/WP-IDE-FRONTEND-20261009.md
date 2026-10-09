# WP — skutečný frontend IDE podle schváleného návrhu

Stav: IMPLEMENTED_REVIEWED_CANDIDATE, 2026-10-09. Vlastník checkoutu: root.
Frontendový rozsah dokončen; společný release není přijatý. Publikace větve
má samostatný lokální receipt, neznamená merge nebo nasazení.
Autorita: přímé zadání operátora z 9. 10. — použít Claude preview ve skutečném
IDE, zachovat původní palety, zjednodušit nastavení a navigaci. Navazuje na
operátorem schválené úpravy účtů, úložiště, huntu a Gitu z téže konverzace.
Návrh je vizuální podklad; jeho ukázková data nejsou produktové výsledky.

Základ: GitHub main `138e958be927df9835c091d3ad41d44b347e85b5`, ověřeno
`git ls-remote` a `git fetch origin main`. Větev `work/ide-frontend-20261009`.
Vzor: `/home/belphareon/Projects/docs/reviewer-tools/ide-redesign-20261009/preview-v4-claude/navrh.html`
v nadřazeném Projects (čtení, žádná změna zdrojového preview).

## Výstup a vlastnictví

Root je jediný zapisující agent v tomto checkoutu. Vlastní kanonickou šablonu
`docs/studio2/prototype/src/*`, browser moduly rozšíření `intentsmith-studio2`,
jejich přegenerované view, nativní preload dialogu složek, cílené testy,
registr testů a navazující UI-SPEC/VIEW-LAYER a tento WP. Ostatní agenti dělají
čtecí analýzu a nezávislé review; případné návrhové patche ukládají výhradně
do vlastních externích pracovních adresářů, root je integruje sekvenčně.
Backend, původní preview, běžící IDE a evidence dlouhého běhu nejsou vlastněné.

## Chování

- Původní rám IDE, písma a jedenáct nativních palet; plnošířkový aktivní řádek
  navigace a barevné obrysové ikony bez obdélníkového podkladu. Bez duplicitních
  počtů v levé navigaci. Nastavení mají čistý seznam/dlaždice bez redundantních
  sloupců. Hustota seznamu reaguje na stejný ovladač velikosti jako dlaždice.
- Modelové pracoviště ve střední ploše, jednoduchá matice evaluace a katalog
  podle schváleného vzoru, s rozlišením měření a externích doporučení. V pravém
  panelu jen stručný přehled rolí. Konfigurace kontextu a naměřené limity zvlášť.
- Běžné nastavení používá pojmenované sekce místo zbytečných záložek. Účty,
  kanály, úložiště, zálohy a Git používají skutečné API. Ovládání bez připojeného
  backendového kontraktu neprezentuje úspěch ani ukázková data.
- Hunt má Přehled, Katalog, Nastavení huntu a challenge, Historii; katalog
  primárně modely ke stažení v mezích známé VRAM, role a zdroje doporučení,
  více skutečných dostupných kvantizací. Plány používají serverové revize.
- Zachovat ochrany identity projektu/modelu, schválení efektů, CAS, chyby a
  ověření výsledků novým čtením. Bez automatického spuštění GPU nebo kanálů.

## Rozhraní a ověření

Stávající stores a `/api/system/models/*`, `/api/scm/*`, `/api/settings`.
Nové API připravuje coworker v `intentsmith-ide-backend-20261009`; draft se
čte kvůli integraci, není důkazem nasazeného backendu. Před společným průchodem
zaznamenat přesný publikovaný SHA backendu a ověřit konečný kontrakt.

Pozitivní i negativní testy ověří render, skutečné stavy konektorů, třídění
evaluace, katalogové filtry, jednorázový plán a bezpečnost mutací. Vizuální
kontrola v izolovaném browseru přes skutečný generovaný React, více nativních
motivů a šířek. `build-view --check`, cílené Studio testy, registr a relevantní
L1. Nezávislé review mimo autorský checkout a opravy všech doložených nálezů.

Hranice: publikace frontendové větve není release ani přejímka. Nezastavovat
produkční backend ani chráněný 24h běh. Zastavení vlastního izolovaného
ověřovacího procesu přes jeho evidované PID; nikdy plošný kill.

## Uzavřené frontendové ověření

- Generátor/parita a 141 cílených testů PASS; 12 nových modelových a 10
  management regresí navíc k 14 novým UI/SCM a 105 stávajícím LiveModel.
  Tři původní view assertions byly přeneseny na přijatý management kontrakt;
  malformed data, explicitní potvrzení a readback zůstávají ověřené.
- Skutečný nativní Theia build PASS bez instalace/rebuildu sdílených závislostí.
- Autor browser: skutečný React, třídění, pět barevných pásů, filtry katalogu,
  inline typing, jednorázový plán, seznam/dlaždice, nativní palety a šířky.
- Autorské HTTP: BE přesně `0766a0ba`, skutečná autentizace a migrations,
  12 modelových kontrol a 10 management checkpointů / 91 požadavků / restart.
  Všechny vlastní procesy uzavřené, inference a send 0; starší fixture FAIL
  zachovány. Důkazy nezávisle ověřené; navíc non-author HTTP subset 8/8.
- Actual React + HTTP: čtyři formuláře (účet, cesta, retence, SSH) prošly
  fyzickým klikáním, zápisem a nezávislým čtením. Celkový V5 harness zůstává
  FAIL: očekával ready Hunt v neinstalovaném desktopu (DESKTOP_NOT_INSTALLED).
  Tento dílčí rozsah přijatý review, žádný další celý CRUD retry.
- Nezávislé checkpointy opravily podklady ikon, pozdní výběr složky, ztrátu
  názvu větve, editaci profilu během zápisu a vadný řádek role-settings.
  Oba P2 poslední delty uzavřené; vlastní browser review 7/7. Celý L1 navíc
  zachytil pořadí columnsVM/wsVM, které mohlo předčasně označit M2 plán za
  prohlédnutý. Oprava a540 zachovává původní oracle a prošla nezávislou revizí.
- Celé L1 na čistém `817c289871ae2e968b7a88d1556bceb3c957be00`: 414/414 PASS,
  concurrency1 a původních 11 ověřených toolchain prerequisites, žádný retry
  ani únik podle runneru. Nezávisle ověřeny všechny logy a otisky.
  Původní 649 (374/24/16) a a540 (389/9/16) zůstávají FAIL; část chyb byla
  souběžné pozorování dočasné fixture v source-tree guardu, část registry/LOC
  census. Guard ani testové assertions nebyly oslabeny. První dirty invocation
  a chybný výběr suite ID zůstávají exit2 před testy.
- Finální `119d258cdf89788435e706a875256cbb811ab074` přidává pouze čtyři
  settings-only CSS rules a opravu dokumentačního fingerprintu. Na tomto SHA
  3 relevantní programy PASS (view/parita, UI, artifact integrity), aktuální
  browser více palet/šířek PASS. Celých 414 se nevydává za běh na119.
- AppImage119 SHA-256 `6bfe56c16bf8178b09b44a9e5e3fab1e4ae0686a22dae21331be3699b85fe12b`,
  195157758 B. Static packaged parity + všech11 palet. Actual cold boot vlastního
  prázdného profilu: klik Nastavení, 13 tile rules, no pageerrors, exit0/cleanup.
  Backend v tomto nativním běhu výslovně nepřipojen; bridge folder-picker
  přítomný, skutečný dialog se v této kontrole neotevíral. Historické native
  exit1 a jejich následný cleanup receipt zůstávají zachované.
- Závěrečné review `full817-style119/REVIEW.json`, SHA-256
  `0617093270dd4cb82e2d950995ecb28969a5d1c6e98784da7e1f04f6472a4414`,
  bez nových nálezů, umožňuje předání frontendového kandidáta.

Přesné piny, příkazy, hranice a lokální balík: [předání](../review/2026-10-09-IDE-FRONTEND.md).

Známé hranice: staré celé `/api/settings` není serverové CAS; katalog musí
přiznat chybějící veřejné podklady či kvantizační metadata. Hunt API poskytuje
posledních pět souhrnů; úplný archiv běhů vyžaduje další BE rozhraní. Backend
nemá přesun úložišť modelů, HTTPS tokenový editor ani časový plán záloh.
Tyto části nepředstírají úspěch. Coworker BE zůstává samostatná větev;
frontendová publikace neznamená společný release ani instalaci do běžícího IDE.
