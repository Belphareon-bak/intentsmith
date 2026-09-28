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
- Skutečný CHAT: 400/400 dialogů, 1 163 volání, audit úplné historie a
  116 společných systémových promptů mezi deseti modely PASS. Paket má SHA
  `05a33f2075ba83e9d978738d689df21fcbc2e1c6b72813c8c93b6970d16f783e`.
  Společné systémové instrukce a referenční hodiny jsou zvlášť doložené
  v `chat/review/SHARED-CONTEXT.md`; oba hodnotitelé je musí dostat.
- První nový posudek D/R doplňku je dokončený: 554/554 odpovědí,
  1 545/1 545 kritérií, validátor PASS. Jde o exponovaného externího
  hodnotitele, nikoli lidskou referenci nebo přejímku. Druhý posudek čeká.
- První posudek CHAT: průběžný deník, dosud 260/400 celých rozhovorů.
  Nejde o hotové pořadí ani druhý nezávislý posudek.

## Doplnění profilu po ověření podpory kontextu

D1/D2/R2 `model_cleanup` doplněno: 72 nových úplných odpovědí (8 modelů
× 3 role × 3 pokusy), vedle 18 existujících kotevních odpovědí. Dalších
šest nových R1 odpovědí na starém profilu zůstává oddělených. Phi4
požadovaných 24 576 tokenů kontextu nepodporuje: poskytovatel přidělí 16 384.
Původní blokace nebyla důkaz nedostatku GPU paměti. Runner nyní odlišuje
`MODEL_PROFILE_CONTEXT_MISMATCH` od `MODEL_PROFILE_NOT_FULL_GPU`.

Devět dotčených slotů dostává nový společný profil všech deseti modelů:
16 384 kontext, 12 288 výstup, 900 s na volání, stejné prompty/rubriky a
teplota 0,1. Osm slotů pokrývá původní neúplné odpovědi a devátý je
R1/model_cleanup. Celkem 270 nových odpovědí, tři pokusy. Staré výsledky
se zachovají, ale celý srovnávaný slot se vyhodnotí v novém profilu.

CODE confidence v2 má veřejně jednoznačné podmínky ve všech větvích kvality;
30 nových odpovědí bude samostatnou verzí zadání. Technické kontroly mají
výstupy gold=1, alternative=1 a broken=4/24; **plné sémantické skóre
nevydávají**. Ostatních šest CODE úloh má doloženou shodu veřejných vstupů,
profilu a spustitelného replay ze září; jejich technické komponenty se
nezaměňují za úspěšnost celého opravného workflow.

Doplnění většího profilu a CODE v2 je připravené ke sběru; počty provedených
pokusů dokládají až jednotlivé result.json, nikoli tento plán.
