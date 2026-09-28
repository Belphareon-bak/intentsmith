# Studio 2 — poslední použití, kategorie a barvy

Autorita: explicitní zadání operátora 28. 9. 2026 (číslování posledních pěti
relací, kategorie a časy v katalogu/detailu, výrazné barvy kategorií a tlumené
barvy nastavení napříč motivy). Výchozí revize `222ec568`; frontend `16318bf8`,
backend `c84b88cd`. Tento WP popisuje implementaci zadání.

## Výsledek a konektory

- Jedno pořadí podle posledního použití: levý seznam, roletka, číslo sloupce,
  paleta, nabídka Relace a Alt+N. Otevření i odeslání zprávy posune relaci na 1.
  Stabilní ID relace a vazby M1/M2 se nemění.
- Chat / Projekt / Specialista mají ikony a barevné štítky; projekt se
  specialistou ukáže obě vazby. Dlaždice a seznam zobrazují poslední použití
  (`3m`, `5h`, `6d`), detail vytvoření a poslední aktivitu. Katalog je od nejnovějšího.
- Backendové datum a vazby: stávající `/api/conversations` a detail,
  `/api/projects`, `/api/specialists`; poslední lokální otevření relace je
  trvale uložené ve stejném profilu. Žádná nová databázová migrace.
- Kategorie: žlutá, červená, fialová, modrá, zelená, oranžová a tyrkysová;
  štítky zůstanou barevné i při monochromatické navigaci.

## Vlastněné cesty

`docs/studio2/prototype/{src,test}/**`, `docs/studio2/VIEW-LAYER.md`,
`docs/studio2/UI-SPEC.md`, `docs/studio2/PRODUCTION.md`,
`docs/studio2/design/**` dle potřeby,
`intentsmith-ide/extensions/intentsmith-studio2/**`, odpovídající
`tests/studio2-*.test.js`, tento WP, report, změřený stav v `SYSTEM-MAP.md`
a `ROADMAP.md`. Generovaná vrstva pouze přes `scripts/build-view.js`.

Zakázané: cizí checkouty, živá DB, backendová politika a procesy/GPU,
neuložená práce v uživatelských oknech. Nasazení má vyměnit pouze ověřený
frontend v existující instalaci a ponechat Legacy.

## Ukázka a testy

- Pět relací: otevřít roletku, použít pátou, odeslat a ověřit 1–5 i stejné ID.
- Katalog se skutečnými daty a různé typy; štítky, pořadí, časy a detail.
- Nastavení vedle navigace; tmavé/světlé Studio a ostatní motivy.
- Negativně: zamítnuté/prázdné odeslání nepřepíše aktivitu; neplatné datum
  se nevydává za skutečný čas; M2 a ochrany zavírání zůstanou zachované.
- `node tests/studio2-session-store.test.js`,
  `node tests/studio2-live-model.test.js`, `node tests/studio2-view.test.js`,
  generátor `--check`, prototypové scénáře/fuzz, produkční build a skutečný
  Electron/AppImage na soukromém profilu. Souhrnný offline/database profil
  přizná zděděnou Gate 0 pečeť zvlášť.

Stop podmínka: rozšíření oprávnění, změna vazeb M1/M2, ztráta neuložené práce
nebo regresní start. Nezávislé review je oddělené od implementačního ověření.

## Ověřený stav

Místně nasazený frontend `79c19096`, backend `c84b88cd` zachován.
**LOCAL_PRODUCTION_DEPLOYED / IMPLEMENTATION_VERIFIED / REVIEW_PENDING.**
Finální celý profil 385 PASS / 1 zděděný FAIL Gate 0; finální tři Electron
scénáře, AppImage nad původními daty, obnova, běžné spuštění a 11 kombinací
motivů PASS. Náhledy, SHA a limity jsou v
[reportu](../review/2026-09-28-STUDIO2-RECENCY-CATEGORIES.md).

## Navazující oprava podle připomínek operátora

Explicitní oprava zadání: v konverzacích je barevný pouze kategoriální štítek,
ikony a jejich podklady jsou neutrální. Obchod a Multimédia mají navazovat
na chladné barvy konce navigace. Nastavení potřebuje viditelně odlišné,
čitelnější ikony, nikoli jen téměř šedé odstíny. Projektový detail zobrazuje
Vytvořeno a Poslední aktivita ze skutečných backendových dat a posledního
použití v profilu, stejně jako konverzace.

Výchozí čistý `04f2be71`, produkční frontend `79c19096`, backend `c84b88cd`.
Tři konkrétní palety předložit v náhledu; volba je preference, opravy dat
a neutrálních ikon na ní nezávisí. Vlastněné cesty zůstávají výše, navíc
`intentsmith-ide/extensions/intentsmith-studio2/scripts/preview-view.js`.
Ověření: záporně žádné barevné dekorace ikon v konverzacích a žádné domyšlené
datum; kladně projektová data, přežití lokální aktivity po zavření/obnově,
kanonický prototyp a skutečný AppImage v tmavých/světlých motivech.
