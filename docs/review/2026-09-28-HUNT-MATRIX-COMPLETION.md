# Doplnění skutečné matice model × role

Stav: **COLLECTION_AND_REVIEW_IN_PROGRESS**, bez rozhodovací autority.
Navazuje na `2026-09-28-HUNT-ROLE-ALLOCATION.md`. Cílem je srovnatelná
evidence celého desetimodelového panelu, ne další doporučení z neúplné tabulky.

## Uzamčený rozsah

- CHAT: nový sběr všech deseti modelů, 40 úloh / model, jedno úplné
  produkční vícekolové provedení každé úlohy (400 dialogů, 1 160 základních
  volání plus skutečné opravné pokusy handleru). Nejde o tři opakování
  historického panelu ani o doložení stability. Staré dialogy z 27. září
  se do této kohorty nepřebírají.
- Modely mají totožný explicitní referenční čas. Jen vedoucí hodinový blok
  skutečného produkčního promptu je nahrazen předem uzamčenou hodnotou;
  původní hodiny se ukládají do každého receipt. Produkční hodiny aplikace
  se nemění. Tento profil se nesmí směšovat s historickým živým časem.
- Konkrétní digesty, poskytovatel, prompty, inference i zdrojový commit
  jsou v plánu před prvním voláním. Audit ověřuje všechny modely navzájem,
  úplnou historii každého požadavku a skutečnou identitu odpovědí.
- D/R: 554 dalších úplných odpovědí má doloženou shodu zadání a inference
  s aktuálními sedmi zachovanými případy. Potřebují skutečné nové posudky
  podle současné rubriky. Staré známky se nepřepočítají mechanicky.
  Dalších 13 odpovědí vyčerpalo rozpočet a není úplným podkladem.
- Opravený `model_cleanup` je samostatná verze. Existující úplné odpovědi
  dvou kotev nenahrazují dosud chybějící ostatní kandidáty.
- CODE má technické komponentní výsledky; celkové skóre čeká na platné
  významové kontroly. VISION má šest relevantních modelů; opakování při
  teplotě nula se nepočítají jako nezávislá pozorování.

## Co bude výsledkem

U každé buňky budou oddělené počty plánovaných / zachycených / úplných /
posouzených odpovědí, přesná kohorta a počet skutečných hodnotitelů.
Nové odpovědi ani nehotové posudky nesmějí dostat zděděné procento. Druhý
skutečný posudek nesmí být nahrazen simulací nebo nepřijatým místním modelem.
Původní soubory a hodnocení zůstávají zachované.

Žádné přepnutí rolí, mazání modelů ani automatický timer nejsou součástí
tohoto doplnění. Evidence: `/mnt/vi7000/intentsmith/evidence/hunt-matrix-completion-20260928/`.

## Kontroly před sběrem

- `hunt-completion-simulation`: 5/5; včetně celého fiktivního desetimodelového
  sběru, exportu 400 odpovědí a odmítnutí odlišného profilu / hodin.
- `m1-model-contract`: 34/34; produkční kontext hodin zůstává živý.
- Závěrečný audit skutečného sběru a skutečné posudky zatím nevznikly.
