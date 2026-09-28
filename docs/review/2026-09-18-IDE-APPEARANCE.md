# Studio: nastavení, výraznost veškerého textu a barevný styl

Stav: **INSTALLED_RUNTIME_VERIFIED / REVIEW_PENDING**. Operátor potvrdil všechny
úpravy a výslovně opravil rozsah posuvníku na **veškerý text**. Zvolený zdroj a
instalace `9ab808f197ffaf1032989743253153c745d48a3d`; předchozí aktivní `230778ad` byl zachován mergem
`cc8f4ace`. Vstup pracovní větve `585e9ece`. Vlastní změny vzhledu se revidují
v rozsahu **`cc8f4ace..9ab808f1`**, převzaté evaluace mají svůj samostatný rozsah.

## Zadání a výsledek

| Požadavek | Výsledek |
|---|---|
| Jedna relace / Vedle sebe | Dvě SVG ikony, tooltipy, aria-pressed, trvale zvýrazněná aktivní volba. Přepínání zachová identitu relací a souborů. |
| Výraznost veškerého textu | Vzhled → Písmo. Okamžitý účinek na text navigace, chatu, záložek, nastavení, Monaco a výstupů. Rozsah 0–100 %, ani nula písmo neschová. |
| Sekční nastavení | Všech 12 kategorií, 33 tematických záložek, responzivní karty, hlavní levé menu zachované. Šipky a Home/End mezi záložkami; křížek vrací do pracovního prostoru. |
| Barevnější dark mode | Volitelný Studio: chladné plochy, fialový akcent, modrá a mátová. Funguje i světlá/systémová varianta; původní IntentSmith zůstává výchozí. |

Posuvník původně měnil pouze mírné přibarvení tx3/tx4. Nová hodnota
`textIntensity` ovládá barvu vykreslených znaků na každém DOM prvku včetně
Monaco tokenů; nepoužívá průhlednost celého panelu. Sémantická barva `color`
se nemění, změna výplně zachovává rozdíly syntaxe/stavů. Staré `passiveInt`
zůstává v profilu pro rollback, nový parametr má výchozích 70 %. Nativní
okenní rám OS a text v obrázcích/PDF nejsou DOM text tohoto IDE.

Přeskupení zachovalo přesné AST výrazy 58 konfiguračních volání a obsluh
událostí ostatních sekcí (`control-inventory.json`). Inspirace nezavedla
fiktivní předplatné, SSO ani cloudové funkce. Stávající ovladače a API zůstaly
zachované. Nový posuvník/fonty mají čitelný popis a živý náhled.

## Ověření

- Produkční build a kontrola skutečného M1 consumer bundlu PASS.
- Workspace, desktop a M2 Studio: 101/101; M1 Studio: 133/133;
  artifact validation: 160/160.
- Úplný offline/database profil na přesném `9ab808f1`: **359 PASS / 1 FAIL**, 360
  programů. Jediný non-PASS `nightly-orchestrator-self-test`: `registry hash
  differs from the reviewed Gate 0 policy`. Verdikt zůstává **FAIL**, pečeť
  nezměněna. Hash všech 360 logů ověřen proti reportu.
- Skutečný Electron z oddělené připravené instalace: 36 kontrol kategorií,
  záložek, klávesnice a barev; 4 kontroly ikon/sloupců a Monaco; matice 0/100 %
  na 10 textových plochách. Na každé se změnila výplň textu, nezměnilo pozadí
  ani sémantická barva. Použit reálný HTTP/M1 chat s deterministickým dotazem
  na čas; terminál měří vykreslený prompt a log skutečný stav průchodu.
- Skutečný restart backendu i Electronu: nové PID, Studio a 0 % se obnovily.
  Dále všech 33 záložek prošlo v okně 960 × 760 bez přetečení karet; běžná
  šířka 1400. Hlavní levá navigace dostupná v obou případech.
- Soubory a historie testu jsou v privátní DB/profilu. Tento důkaz neznamená
  fyzickou GPU evaluaci ani modelovou kvalifikaci.

Zachované neúspěšné pokusy: první build spuštěný z kořene odmítl Corepack
kvůli npm/yarn rozdílu; po spuštění z IDE build prošel. První M1 běh 132/1
narazil na statický matcher jednoduchých uvozovek u názvu karty; následný
133/0 ponechává matcher i původní text. První GUI skripty předpokládaly
neexistující CSS třídu, uvítací text terminálu a trvalost neuloženého úvodního
projektového sdělení. Po opravě selektorů a vložení skutečného chatového tahu
prošly; chybové logy se nemažou. Nejde o důkaz ztráty uložených zpráv.

## Nasazení a data

Nasazena čistá detached kopie `9ab808f197ffaf1032989743253153c745d48a3d`; launcher i backend/hunt
odkazují na stejnou instalaci. Backend PID 1911076, autorizované
HTTP 200, bez capability 401. Před změnou ověřeny neaktivní hunt/evaluace,
žádný GPU běh nebyl ukončen nebo spuštěn. Instalační záloha:
`/home/belphareon/.local/state/intentsmith/installation-backups/2026-09-18T19-38-28-836Z`.

SQLite quick_check ok, 0 FK chyb, 105 migrací. Devět chráněných tabulek
je bajtově shodných po kanonickém seřazení řádků (konverzace/zprávy, evaluace,
bindingy a paměť). Projekty mají shodná všechna pole kromě očekávaného
startup `last_active` u 2/4/5/6/7/11. Administrátorský credential i profil
Studia zachované. Původní uživatelské okno nebylo nuceně ukončeno; nové GUI
se načte po zavření a opětovném otevření aplikace.

## Důkazy a hranice

[Strojový souhrn](../execution/runs/ide-appearance-20260918.json),
[uživatelský návod](../IDE-WORKSPACE.md),
[WP](../wp/WP-IDE-APPEARANCE-20260918.md).
Lokální adresář `.intentsmith-artifacts/ide-appearance-20260918/` obsahuje
screenshoty, CDP kroky, buildy, report, manifest a 360 testových logů.
Archiv `ide-appearance-evidence.tar.gz`: 2031079 B,
SHA-256 `49299dd0e2f6652284ad0a3615e3390eff71364b14476fe4d061b0e323be7d07`. Manifest zahrnuje 423 souborů;
privátní DB/profil, port/capability soubory a env nejsou v archivu.

Tato úprava neuzavírá nezávislé review, Gate 0 ani dříve otevřené M5/M2 a
GPU-hunt kvalifikační mezery. Nejde o prohlášení celého produktu za prod-ready.
