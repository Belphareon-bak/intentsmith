# Studio 2 — poslední relace, kategorie a časy

Autorita: explicitní zadání operátora 28. 9. 2026. Rozsah:
[WP-STUDIO-2-RECENCY-CATEGORIES](../wp/WP-STUDIO-2-RECENCY-CATEGORIES-20260928.md).

**LOCAL_PRODUCTION_DEPLOYED / IMPLEMENTATION_VERIFIED / REVIEW_PENDING.**
Nezávislé přijetí této delta změny zatím neproběhlo. Celý audit má známý
zděděný FAIL Gate 0; nejde o veřejnou M5/M6 přejímku.

## Co se změnilo a proč

1. **Poslední relace 1–5:** jedno MRU pořadí pro roletku, levý seznam,
   hlavičku sloupce, paletu, nabídku Relace a Alt+N. Otevření a přijaté odeslání
   posunou relaci na 1. Původní číslo při vytvoření již není zobrazované pořadí.
   ID, transportní sloty a vazby M1/M2 zůstávají stabilní; zamítnuté odeslání
   aktivitu nezmění. Pořadí i čas posledního použití se uloží do profilu.
2. **Rozpoznání kontextu:** Chat, Projekt, Specialista mají ikonu a barevný
   štítek v hlavičce, dlaždicích, seznamu a detailu. Projekt se specialistou
   ukazuje oba štítky. Katalog je od nejnovější aktivity a zobrazuje relativní
   čas (`3m`, `5h`, `6d`), detail Vytvořeno a Poslední aktivita. Zobrazení
   kombinuje skutečné backendové datum s posledním otevřením v tomto profilu;
   neznámé datum zůstává „—“. SQLite datum bez zóny se čte jako UTC.
3. **Původní data:** globální seznam backendu projektové konverzace vynechává.
   UI proto spojuje již existující globální, projektové a specialistické GET
   konektory, deduplikuje ID, kontroluje projektový scope a při neúplném
   načtení ukáže upozornění. Nejvýš čtyři dodatečné požadavky běží souběžně.
   Specialistická vazba z historie slouží k popisu; sama neaktivuje specialistu.
   Explicitní specialistické otevření má původní samostatný řízený konektor.
4. **Barvy:** chat žlutá, projekt červená, specialista fialová, expertýza
   modrá, worker zelená, obchod oranžová a multimédia tyrkysová. Kategorie
   nepoužívají růžovou. Nastavení má dvanáct vlastních, tlumených odstínů;
   Úložiště a Zálohy jsou rozdílné. Monochromatická navigace v ostatních
   tématech zůstává, barevné štítky zůstávají čitelné. Vzhled i logika změn
   jsou nejdřív v kanonickém prototypu; React vrstva je strojově generovaná.

## Přesná instalace

| Část | Identita |
|---|---|
| Nový frontend | `79c190962af1d7c83427b0e10ca3dde17f130af3` |
| Běžící backend | `c84b88cd0c0b76639823c82c022d2feab96dfc15` |
| AppImage SHA-256 | `7b18541716fe069c2bef99ca9a463cb6080014e0d8a0dfed326ec5ad1ff2e28c` |
| Frontend bundle SHA-256 | `51d3627fb47b5e0b1db295b8c30a9bb205726919b2bb606347d57bac5ec8d8f2` |
| Legacy frontend | `72247a4983abcb12d42f6da6cc5b27af8f2212fd` |

Trvalý balík:
`/mnt/vi7000/intentsmith/releases/studio2-frontend-79c190962af1d7c83427b0e10ca3dde17f130af3/IntentSmith-Studio2.AppImage`.
Atomicky se změnil pouze `studioAppImage` v existující instalaci, se zálohou
předchozí konfigurace a kontrolou SHA. Backend zůstal aktivní, PID `493803`
před nasazením i po něm. Neměnila se DB, migrace ani modelové role; žádná
startup modelová sonda ani nový GPU tah. Backendová jednotka, prostředí,
sandboxová volba, hold, desktopové položky, uživatelské profily a preference
Legacy se kvůli nasazení nepřepisovaly.

## Ověření finálního zdroje a balíku

| Zkouška | Výsledek |
|---|---|
| Celý offline/database profil, čistý `79c19096` | **385 PASS / 1 FAIL / 0 TIMEOUT / 0 BLOCKED** |
| LiveModel | **71/71 PASS**; MRU, kontext, datum, negativní aktivace specialisty |
| SessionStore | PASS; MRU, ochrana rozpracované práce, obnova, stabilní ID a vazby |
| TransportAdapter / CatalogStore | PASS; přijaté a zamítnuté odeslání, existující GET index, deduplikace a nesprávný scope |
| Prototyp / generovaná React vrstva | **1916 kontrol, 0 selhání**, fuzz 3000 bez chyby; shoda generátoru a zobrazení |
| Integrita dokumentace | **160/160 PASS**, aktuální census |
| Skutečný Electron, Studio 2 | PASS; výlučné UI, relace, strop, ochrany, soubory, motivy, start a obnova |
| Skutečný Electron, M1 | PASS; řízený wire backend, success/error/cancel/reconnect, síťová hranice, čisté ukončení |
| Skutečný Electron, M2 composer | PASS; skutečný DOM vstup, odmítnutí nepovolených efektů, zachování vstupu a kontextu |
| Finální AppImage nad původními daty | PASS; skutečná roletka 1–5, přepnutí 5 → 1 při stejných ID, obnova aktivity, kontext a detail |
| Všech 11 kombinací motivů | PASS; 7 odlišných barev kategorií, 12 odlišných barev nastavení; nejnižší kontrast štítků **4,66 : 1** |
| Běžný instalovaný desktopový launcher bez CDP | PASS; soukromý profil, skutečné okno, vlastní rám, čisté ukončení |
| Produkční build / balení / M1 consumer guard | PASS; původní protokol a preload zachovány |

Tři finální Electron zkoušky i AppImage mají zdrojovou identitu `79c19096`;
AppImage důkaz má rovněž SHA výše. Živá data se při této zkoušce jen četla,
relace a motivy se měnily v soukromém profilu. Odeslání a chybové scénáře se
ověřily řízeným backendem, nikoli zprávou do původní DB či GPU během cizí práce.

Jediný finální FAIL je
`IS-T1-TESTS-NIGHTLY-ORCHESTRATOR-SELF-TEST`, zděděná Gate 0 pečeť registru.
Audit proto skutečně má verdikt **FAIL**; nejde o plně zelenou sadu.
Finální manifest: `.intentsmith-artifacts/test-runs/2026-09-28T19-22-02-691Z/report.json`.
Předchozí celý běh na `382aea3e` měl stejných 385 PASS / 1 FAIL;
finální změna přidala negativní test a ponechala popis historie oddělený od
aktivace specialisty.

První AppImage pokus narazil na ještě překryté UI při kliknutí; harness nyní
čeká na nepřekryté okno i po obnově. Druhý odhalil nízký kontrast tří světlých
odstínů (4,16–4,43 : 1); paleta se opravila a finální všechny kombinace prošly.
Tyto neúspěšné pokusy jsou uchované v evidenci, nikoli překlasifikované na PASS.

Integrita živé DB po nasazení: `quick_check=ok`, nula foreign-key chyb,
všech sedm celých modelových vazeb shodných s kontrolou před změnou, včetně
časů a identit. Počty: `51 konverzací, 8 zpráv, 16 projektů a 7 modelových vazeb, shodně s kontrolou před změnou`.

## Praktické použití a meze

Uložit rozpracovanou práci, zavřít IntentSmith a znovu otevřít **IntentSmith
IDE 2.0**, případně `gtk-launch intentsmith`. Otevřená uživatelská okna se
neukončovala. Legacy zůstává pod `gtk-launch intentsmith-legacy` nad stejným
spravovaným backendem a původní DB. Není potřeba mazat profil ani přepínat UI.

Katalog používá stávající limity backendových konektorů: 50 globálních
konverzací, 50 aktivních projektů, 50 konverzací na projekt a 100 na specialistu.
Tato změna nezavádí neomezené stránkování historie. Čas posledního otevření je
lokální tomuto profilu; backendový čas zpráv zůstává sdílený. Kontrast se měřil
pro výchozí kombinace témat, nikoli libovolné uživatelské CSS.

Soukromá evidence včetně screenshotů původních dat, skriptů, auditních logů,
zdroje a ověřených `SHA256SUMS`:
`/mnt/vi7000/intentsmith/evidence/studio2-recency-20260928-79c19096`.
[Náhledy skutečného balíku](/mnt/vi7000/intentsmith/evidence/studio2-recency-20260928-79c19096/index.html).
Screenshoty a původní obsah konverzací se na GitHub nepublikují.
