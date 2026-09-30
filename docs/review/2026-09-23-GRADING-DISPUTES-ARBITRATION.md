# Sporné známky k rozsouzení — vzorek 2026-09-21

**Stav:** ARBITRATION_INPUT / NOT_ACCEPTED.
Podklad pro operátora. Porovnává slepé známky Opusu se známkami autora sady
nad týmž 30položkovým vzorkem (`review-sample-answers.json`,
`blindToIdentity: true`).

Zdroje: [Opus](../../../Projects/coworker/intentsmith-hunt-completion-20260920/claude-sample-grades-20260921.json),
[autor](../../../Projects/coworker/intentsmith-hunt-completion-20260920/review-sample-my-grades.json).

## 0. Shrnutí — spor je menší, než vypadal

Osm položek se lišilo o 0,25 a víc. **Po přečtení autorových důvodů jich
šest vychází v jeho prospěch a Opus je stahuje.** Zbývá **jeden skutečný
spor o měřítko** a jedna drobnost o míře srážky.

Rozdíl neměl náhodný směr: u D1 byl Opus mírnější (0,875 proti 0,588),
u D2 přísnější (0,512 proti 0,588). Obojí má nyní pojmenovanou příčinu.

## 1. Informační asymetrie, ne rozdíl úsudku

Autor zná DDL, které ve veřejném výřezu není: historická migrace 030 má
`role PRIMARY KEY` a `previous_model NOT NULL`.

Z toho plyne, že řádek s `previous_model = NULL` **v reálné tabulce vzniknout
nemůže** a opakované řádky pro tutéž roli také ne. Odpovědi, které diagnostikují
„null previous_model" a „více řádků stejné role", popisují scénáře, které
schéma zakazuje. Autor za to správně nesráží, protože to v zadání nebylo —
ale Opus za ně kredituje jako za platnou diagnózu.

**Dopad:** položky 1, 12, 20, 24. Opus tuto asymetrii uznává; známky autora
jsou v tomto ohledu lépe podložené.

## 2. Dvě systematické chyby Opusu

### 2.1 D2, kritérium 3 — hledal jsem štítek místo obsahu

Kritérium zní: *„Explain one concrete incomplete or unsafe shortcut and its
observable failure. **Any evidenced shortcut in the supplied case is eligible**,
not only the reference example."*

Opus hledal sekci nadepsanou „tempting fix" a když chyběla, dal 0 nebo 0,25.
Autor správně uznal jakoukoli doloženou zkratku:

| Položka | Autorův nález | Opus |
|---|---|---|
| [20] `d2_model_cleanup` | raw-string dedup ponechá canonical alias duplicity → **1** | 0 |
| [6] `d2_history_late_guard` | zachycení výjimky appendu neověří sémantický error payload → **1** | 0,25 |

**Opus stahuje obě.** To samo vysvětluje většinu rozdílu u D2.

### 2.2 D1, kritérium 4 — nekontroloval jsem, jestli test vůbec rozliší

Opus kreditoval testový návrh za to, že má konkrétní vstupy. Autor navíc
ověřoval, **jestli ten test dokáže odlišit rozbité od opraveného**. Dvakrát
nedokáže:

- **[1] `d1_model_cleanup`:** fixture `["llama3", "llama3:latest", "", "  ", "mistral"]`
  s bindingem na `llama3`. Obě aliasové varianty kanonikalizují na `llama3`,
  které **je bound** — vypadnou tedy kontrolou aktivních modelů, ne deduplikací.
  Test deduplikaci neprokazuje vůbec. Chybí newest/rebind fixture.
- **[17] `d1_metrics_flush`:** scénář 12 událostí předpokládá dávku po 10,
  ale stávající `_flush()` bere **celý buffer**. Scénář je neproveditelný.

**Opus stahuje obě.** Kontrola realizovatelnosti testu patří do kritéria 4
a Opus ji vynechal.

## 3. Položky, kde spor mizí po přečtení důvodů

| # | Úloha | Opus | Autor | Rozhodnutí |
|---|---|---:|---:|---|
| 1 | `d1_model_cleanup` | 1,000 | 0,625 | autor — fixture nerozlišuje (§2.2) |
| 2 | `d1_model_lease` | 0,875 | 0,625 | autor — „vymýšlí částečný caller a nutnost multi-key API" je doložená výhrada |
| 6 | `d2_history_late_guard` | 0,312 | 0,688 | autor — K3 uznán správně (§2.1) |
| 17 | `d1_metrics_flush` | 1,000 | 0,625 | autor — neproveditelný scénář (§2.2) |
| 18 | `d1_metrics_flush` | 0,750 | 0,438 | **otevřeno, drobnost** — oba penalizujeme obrácený kauzální sled, liší se míra (0,25 vs 0,5) |
| 20 | `d2_model_cleanup` | 0,438 | 0,688 | autor — K3 uznán správně (§2.1); **na hlavní vadě se shodujeme** |

U [20] stojí za zaznamenání, že jsme **nezávisle našli tutéž vadu**: `seen`
se plní až v následném `.map()`, takže všechny `.filter()` callbacky proběhnou
dřív a duplicity projdou. Oba jsme za ni dali 0,25. Rozdíl v součtu vznikl
jinde.

## 4. Jediný skutečný spor o měřítko

**Položky [12] a [24], `r2_model_cleanup`. Opus 1,000, autor 0,750.**

Obě odpovědi našly hlavní vadu správně a s reprodukcí. Rozcházíme se v tom,
jak hodnotit jejich **dodatečný nález o chybějící revalidaci na delete seamu**:

- Odpověď [12] jej výslovně označí za *„mimo připnutou referenci, nevěřený,
  čeká na adjudikaci"*.
- **Autor** to bere jako důvod ke srážce: nález vidí, ale konkrétní současnou
  ochranu nedokládá, přestože caller byl dodán.
- **Opus** to bere jako přednost: kritérium žádá, aby dodatečné nálezy měly
  ověřený důkaz, a odpověď správně rozliší doložené od nedoloženého místo aby
  tvrdila víc, než ví.

**Otázka pro operátora zní:**

> Má odpověď, která svůj vedlejší nález sama označí za neověřený, dostat za
> tuhle poctivost plný počet, nebo srážku za to, že nález nedotáhla?

Rozhodnutí se promítne do každé budoucí rubriky, kde je kritérium
„additional real findings require evidence".

**Opus doporučuje plný počet**, protože opak vytváří tlak tvrdit víc, než
odpověď dokládá — a přesně to bylo jádro původní vady hodnotitelů.

## 5. Co z toho plyne pro pořadí modelů

Po stažení šesti sporů se průměry sbližují a **systematický rozdíl u D1 a D2
mizí** — nebyl to rozpor měřítek, byly to dvě chyby v Opusově čtení kritérií
plus neznalost DDL.

Zůstává jedna otevřená otázka (§4) a jedna drobnost (§3, položka 18). Ani jedna
se netýká CODE, které se známkuje spuštěním skrytých testů. **Rozhodování
o CODE tedy na tomto rozsouzení nevisí.**
