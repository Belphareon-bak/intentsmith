# Studio 2.0 — specifikace UI

Stav: podklad k [WP-STUDIO-2](../wp/WP-STUDIO-2-20260925.md). Vizuální a
interakční předloha je klikací prototyp ([README](README.md)); kde se text a
prototyp liší, platí tento text.

## 1. Zásady

- Rodina ShellSmith/SystemSmith: tenké 1px linky, 5/9px rádiusy, nadpisy sekcí
  kapitálkami, obrysové ikony, tabulková čísla. Žádné emoji v UI.
- Barvy, písmo a rozměry jen přes tokeny ([THEMES](THEMES.md)). Žádné
  konstanty barev v komponentách.
- Čeština v celém UI. Stavy mají slovo, ne jen barvu.
- Skutečné `<button>`, `aria-label` u ikon, viditelný fokus, text 4,5:1.
- Graf zaplnění kontextu a velikost DB jsou drobné ukazatele (hlavička relace,
  stavová lišta, záložka Kontext), nikdy dominantní prvek.
- UI nic nepředstírá: bez terminálu M1/M2 není úspěch, odpojení je vidět.

## 2. Rozvržení

```
┌ titulní lišta 38 px: značka · nabídka · paleta příkazů · ovládání zobrazení · okno ┐
├ navigace ┬──────────── střed ────────────┬ pravý panel ┤
│ plná     │ sloupce relací 1–3            │ Změny       │
│   nebo   │   nebo katalog + detail       │ Soubory     │
│ ikony    │                               │ Správa zdr. │
│          │                               │ Kontext     │
└──────────┴───────────────────────────────┴─────────────┘
└ stavová lišta 24 px ┘
```

Všechny svislé hranice jsou posuvníky. Šířky a výšky se ukládají. Skrývání
panelů je **jen** v titulní liště, v nabídce Zobrazení a v paletě (Decision
049 bod 4).

## 3. Titulní lišta

- Značka (kovadlina v barvě akcentu).
- Nabídka: **Soubor, Úpravy, Zobrazení, Relace, Agent, Nápověda** — klávesové
  zkratky vpravo, zaškrtávací a přepínací položky, najetí myší přepíná otevřenou
  nabídku. Obsah položek odpovídá prototypu.
- Pole „Hledat, přepnout relaci, spustit příkaz…" otevře paletu (Ctrl+K).
- Ovládání zobrazení, zleva: **Dlaždice / Seznam**, **velikost dlaždic**
  (3 stupně), **počet sloupců 1 / 2 / 3**, přepínače **Navigace**,
  **Terminály relací**, **Pracovní plocha**. Mimo režim, kde má ovládání smysl,
  je zobrazené ztlumeně, ale funkční.

## 4. Navigace

- **Plná** (180–440 px) nebo **ikony** (šířka roste s velikostí písma, popisky
  vždy bezpatkovým písmem, aby se vešly i v Matrixu a při 18 px).
- Sekce: **Konverzace, Projekty, Specialisté, Expertýzy, Workeři, Obchod,
  Multimédia**; dole **Nastavení**. U sekce počet; u Konverzací výstražná
  barva, když relace čeká na schválení.
- Klik na sekci otevře její katalog uprostřed. Šipka rozbalí rychlé odkazy:
  Konverzace — otevřené relace s čísly a stavem (§5), pak tři nedávné, nahoře
  naposledy zavřené; Projekty — aktivní; Specialisté; Expertýzy — oblíbené.
  Nastavení rychlé odkazy nemá.
- Sbalování panelů (nastavení Rozvržení): při nedostatku místa se navigace
  zúží na ikony a pravý panel se skryje; ruční přepnutí má přednost.

## 5. Otevřené relace (bez záložek)

Rozhodnutí operátora z 28. 9.: lišta záložek relací není. Duplikovala levý
seznam a přepínání přes ni působilo nepředvídatelně.

- Otevřené relace jsou vidět v levé navigaci (Konverzace → Otevřené relace),
  ve výběru v hlavičce sloupce (§6), v paletě a v nabídce Relace. Jde
  o **konverzace** — projektovou (ikona složky), se specialistou (ikona lidí)
  a volnou (bublina).
- Položka: **číslo**, krátký název, tečka stavu (pracuje / čeká na schválení /
  hotovo / nečinná). Číslo je pořadí v seznamu otevřených relací (1–5) a platí
  pro Alt+1…5. Plné číslo = sloupec s fokusem, obrysové = relace viditelná
  v jiném sloupci.
- **Nejvýš 5 otevřených relací.** Při otevření další se sama zavře relace,
  se kterou se nejdéle nepracovalo, pokud je skrytá už před otevřením, nepracuje,
  nečeká na schválení, nemá neuložený soubor ani rozepsanou zprávu či přílohu
  a neběží v ní příkaz terminálu; dole ve středu to oznámí
  krátké hlášení. Když taková relace není, nová se neotevře a hlášení řekne
  proč.
- **Otevření** konverzace, projektu nebo specialisty: bez otevřené relace je
  akce „Otevřít" a relace zabere jediný sloupec; jinak „Otevřít v nové relaci"
  a relace se ukáže v novém sloupci vedle. Při třech plných sloupcích nahradí
  sloupec, se kterým se nejdéle nepracovalo — nikdy sloupec s fokusem.
  Už otevřená konverzace se jen přepne. Totéž platí pro Ctrl+T.
- **Klik** na otevřenou relaci (levý seznam, výběr ve sloupci, Alt+N): je-li
  ve sloupci, dostane fokus; jinak se zobrazí ve sloupci s fokusem.
  **Ctrl+klik** ji zobrazí ve vedlejším sloupci.
- Sloupec s fokusem je výrazně označený (akcentová linka, podbarvená hlavička,
  plné číslo); u ostatních sloupců je název tlumený.
- **Ukončení** relace: × v hlavičce sloupce, nabídka Relace nebo kontextové
  menu v levém seznamu. Konverzace zůstává v historii. Sloupec zmizí; když byl
  jediný, převezme ho naposledy použitá skrytá relace.
- Připínání a „zavřít ostatní / vpravo" odpadají.
- Víc než 3 sloupce (dvě řady, 6–8 relací podle rozlišení) je odložené na
  pozdější rozhodnutí.

## 6. Sloupce relací

**Počet a šířka.** 1–3 sloupce, výchozí stejná šířka, posuvník mezi sloupci,
dvojklik srovná. Sloupců nikdy není víc než otevřených relací.

**Výběr relace ve sloupci (zadání 25. 9., bod 1; 28. 9.).** Klik na název
v hlavičce sloupce otevře výběr **Poslední relace**: otevřené relace od
naposledy použité (číslo, název, stav, kde jsou). Volba zobrazí relaci v tomto
sloupci; je-li už v jiném sloupci, sloupce si ji **vymění**. Dole je „Nová
relace v tomto sloupci". Tlačítko × relaci ukončí (§5).

**Hlavička:** číslo, ikona druhu, stav, název, čip projektu nebo specialisty
(otevře jeho detail), značka záměru, režim úprav **Auto / Kontrola**, malý
ukazatel kontextu, výběr relace, ukončení relace. V úzkém sloupci mizí
postupně značka záměru, čip, ukazatel, výběr režimu (container queries).

**Zprávy** vyplňují celou šířku sloupce (bez pevného maxima):
- uživatel — tlumený blok s časem;
- agent — autor (IntentSmith, u specialisty jeho jméno), značka záměru,
  expertýza, čas a délka; **časová osa kroků** (nástroj, model, čekání,
  schválení, zrušení, timeout, chyba — `work-activity.js`); odstavce přes
  `renderMarkdown`; kód; při běhu indikátor a **Zastavit**; pod dokončenou
  odpovědí ikona **kopírování**, která po kliknutí krátce ukáže
  „Zkopírováno", při chybě „Kopírování se nepovedlo";
- interní zpracování backendu (desítky událostí) se v chatu ukazuje jako
  nejvýš **4 fáze** — Porozumění zadání, Příprava kontextu, Generování
  odpovědi (s modelem), Kontroly výstupu. Ve výchozím stavu jsou sbalené do
  řádku „Zpracování · N fáze · čas"; rozbalená fáze má čas (do začátku dalšího
  kroku) a po dokončení je zelená jako ostatní kroky. Skutečná práce (nástroje,
  soubory, chyby) je vidět vždy. Úplný výpis událostí je v kartě Průběh;
- **karta schválení** (počet souborů, +/−, režim): Zobrazit změny / Zamítnout
  / Schválit; výsledek jako řádek „Schváleno · … zapsáno" nebo „Zamítnuto".

**Skladatel:** textové pole, příloha, čip expertýzy, čip modelu, Ctrl+Enter,
Odeslat; doplnění Tab (`/api/autocomplete`) jako dnes.

**Spodní část sloupce** (výška společná pro všechny sloupce, posuvník):
**Terminál** (příkazy agenta i uživatele této relace), **Log agenta**,
**Průběh** (tabulka kroků: čas, krok, nástroj, cíl, trvání, stav), **Audit**,
**Problémy**. Skrývá se přepínačem Terminály relací.

## 7. Pravý panel — Pracovní plocha

Patří relaci ve sloupci s fokusem; hlavička ukazuje její číslo a název.
V režimu katalogu je skrytý.

- **Změny** — čekající změny M2 s rozbalitelným diffem, „Schválit vše" /
  „Zamítnout vše"; po rozhodnutí prázdný stav s výsledkem.
- **Soubory (zadání 25. 9., bod 2)** — místo druhé horní lišty:
  **Upravené v relaci** (z plánu a výsledku M2, zápisů nástrojů, událostí
  `workspace`; +/−, stav navrženo / zapsáno), **Otevřené** (soubory, které
  relace četla nebo uživatel otevřel, přílohy), **Projekt** (strom). Klik otevře
  soubor v panelu: náhled, přepnutí na diff, úpravy stávajícím editorem se
  stráží neuložených změn. Panel jde roztáhnout.
- **Správa zdrojů (zadání 25. 9., bod 3)** — [SCM](SCM.md) §5.
- **Kontext** — zaplnění rozdělené na systém / historie / soubory, tokeny,
  soubory v kontextu, paměť projektu.

## 8. Katalog (jednotný pro všechny sekce)

Hlavička: ikona a název sekce, souhrn, hledání, hlavní akce sekce (Nová
konverzace, Nový projekt…). Pod ní filtry skupin s počty. Obsah jako
**dlaždice** (ikona, štítek stavu, název, podrobnost, dva řádky popisu,
skupina, meta) nebo **seznam** (název, skupina, podrobnosti, popis, stav);
volba a velikost z titulní lišty platí pro všechny sekce. Hustota a
rámečky/linky se projeví i tady. Klik vybere položku a otevře detail vedle;
dvojklik na konverzaci otevře relaci; pravé tlačítko nabídne akce. Prázdné
stavy říkají, co udělat (Multimédia: „Zatím žádné generování").

## 9. Detail (jednotná šablona)

Panel vpravo od katalogu (340–900 px, posuvník, ×). Pořadí: ikona, název, stav,
druh a identifikátor; hlavní akce, vedlejší akce, „⋯"; vnitřní záložky; popis,
**Vlastnosti**, bloky (řádky, seznam, štítky, pruhy, tabulka, text, prázdný
stav), **Souvislosti**.

| Sekce | Hlavní akce | Záložky |
|---|---|---|
| Konverzace | Přepnout na relaci; Ukončit relaci / Otevřít nebo Otevřít v nové relaci (§5) | Přehled |
| Projekt | Otevřít / Otevřít v nové relaci (§5) | Přehled, Konverzace, Soubory, Správa zdrojů (politika gitu) |
| Specialista | Otevřít / Otevřít v nové relaci (§5) | Přehled, Nástroje, Nastavení |
| Expertýza | Použít v aktivní relaci | Přehled (profil 5D), Pravidla |
| Worker | Spustit teď; Pozastavit; Upravit definici | Přehled, Zdroje, Běhy |
| Balíček | Nainstalovat / Odinstalovat / Aktualizovat | Přehled, Verze |
| Médium | Otevřít, Oblíbené, Zrušit, Smazat | Přehled |
| Nastavení | podle kategorie | záložky kategorie (§10) |

Průvodci (projekt, specialista, expertýza, worker se zdroji, podmínkami,
spouštěči, akcemi a dry-run) běží v detailu v rozšířené šířce, krok po kroku,
se stejnou logikou jako dnes.

## 10. Nastavení

Původních **12 kategorií a jejich záložky** zůstává:

| Kategorie | Záložky |
|---|---|
| Účet | Profil, Projekty |
| Modely a inference | Lokální modely, Inference, Připojení, Hardware; obrazovky huntu, hodnocení, rolí, governoru a upgradů přejdou beze změny obsahu tam, kde jsou dnes |
| Paměť | Historie a kontext, Paměť a učení, Kapacita a retence |
| Oznámení | Kanály, Tiché hodiny |
| Výstup | Formátování, Délka odpovědi |
| Vzhled | Obecné, Písmo, Barvy a prvky, Rozvržení, Vlastní CSS |
| Systém | Prostředí a závislosti, Spouštění, Diagnostika, Limity |
| Úložiště | Databáze, Údržba |
| Zálohy | Export, Obnova, Výchozí hodnoty |
| Funkční přepínače | Přepínače, Obnovení |
| Zabezpečení | Audit, Přístup, Relace |
| O aplikaci | Aplikace, Zpětná vazba |

Záložka Náhled u Vzhledu odpadá: každá změna se projeví v celém UI okamžitě.
Dlaždice/seznam a počet sloupců jsou v titulní liště, v nastavení se neopakují.

## 11. Paleta a kontextová menu

- **Paleta** (Ctrl+K): otevřené relace, příkazy (nová relace, sloupce 1–3,
  panely, nastavení vzhledu, další styl, změna modelu), přechod do sekcí;
  filtr psaním, Enter spustí první výsledek, Esc zavře.
- **Kontextová menu** u záložek, položek katalogu, rychlých odkazů navigace a
  v detailu „⋯": otevřít, otevřít vedle, nová relace v projektu / se
  specialistou, připnout, přejmenovat, duplikovat, archivovat, smazat.

## 12. Stavová lišta

Připojení, verze backendu, `ws :port`, počet relací (pracuje / čeká),
kontext relace s fokusem, DB, GPU, oznámení.

## 13. Parita se starým UI (podmínka přepnutí výchozího UI)

Vše, co dnes umí `chat-panel-module.js` a center views, musí mít místo
v novém UI, jinak se výchozí nepřepne (Decision 049 D2):

- chat, časová osa, M2 návrh/schválení/zrušení, diff, kopírování odpovědi;
- relace: pojmenování, obnova po restartu, rehydratace, uzavření bez posunu
  cizí relace (`ide-workspace.test.js`), nezávislé editory, výstupy a fronty příloh;
- editor souborů se stráží neuložených změn (`intentsmith-editor-state`),
  pracovní strom: nový soubor, složka, přejmenování, smazání;
- terminál s doplňováním Tab;
- přílohy (výběr bez odhalení cesty, limity a odmítnutí);
- pracovní prostory specialistů (`intentsmith-specialist-workspaces`);
- průvodci projektu, specialisty, expertýzy, workeru (dry-run, test);
- obchod, multimédia (generování, historie, oblíbené, zrušení), upgrady;
- modely: inventář, stahování, role, hodnocení, hunt a jeho řízení, governor;
- M4 návrhy učení, M7 párování, zpětná vazba, prostředí a instalace;
- všech 12 kategorií nastavení a všechny volby vzhledu ([THEMES](THEMES.md)).

## 14. Mimo rozsah

Vlastní Electron shell místo Theie (Decision 049 D1), nové typy balíčků
v obchodě, změny modelových rolí a měření, jakákoli nová schopnost shellu.

## Doplnění operátora 28. 9. — aktivita a kategorie

- „Poslední relace“: posledních pět otevřených relací podle použití, čísla
  1–5 od nejnovější nahoře. Otevření a přijaté odeslání zprávy přesouvá na 1.
  Stejná čísla v navigaci, sloupci, paletě, nabídce a Alt+N; ID se nemění.
- Konverzace ukazují barevný štítek a ikonu Chat / Projekt / Specialista.
  Dvojí vazba má oba štítky. Dlaždice i seznam jsou od nejnovější aktivity,
  s relativním časem `3m`, `5h`, `6d`. Detail má Vytvořeno a Poslední aktivita.
- Kategorie: chat žlutá, projekt červená, specialista fialová, expertýza
  modrá, worker zelená, obchod oranžová, multimédia tyrkysová. Syté odstíny
  mají tmavou a světlou variantu. Růžová se pro kategorie nepoužívá.
- Nastavení má tlumenější vlastní tóny, sousední Úložiště a Zálohy nejsou
  stejné. Monochromatická navigace tématu nemění barvy kategorií ve štítcích.
