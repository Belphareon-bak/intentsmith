# WP — migrační inventář backendu po atomickém create-only

Autorita: explicitní zadání operátora dokončit backend a ověřit dokumentaci;
přijatý atomický `file.create` s migrací 121 z
`WP-CHAT-ATOMIC-CREATE-20261001`. Vstup: čistý publikovaný `45caf5b5`, CI PASS.
Použit stávající vlastní checkout full405-baseline-oracles, bez nového worktree.
Stav: **IMPLEMENTATION_IN_PROGRESS / REVIEW_PENDING**.

Úplný profil na `45caf5b5` je **FAIL: 397 PASS / 5 FAIL / 3 BLOCKED**,
privátní `2026-10-01T07-43-29-051Z/report.json`. Tři selhání konkrétně
ukázala zastaralý migration manifest, LOC census a očekávání 107 místo
108 migrací. Dvě účetní routing/context chyby patří předanému CHATu;
tento WP je neřeší. Tři BLOCKED vznikly bez nastavené authority PDF
interpretu v rootově příkazu, nikoli z prokázané vady produktu.

Výstup: přesné zdrojové identity a počty v dokumentaci a schémových testech;
M6 receipt pro aktuální kandidát vyžaduje skutečných 108 migrací. Starý
receipt s 107 i jiný neúplný počet se odmítne. Schéma či těla migrací,
release verze, zdrojové hash pečeti ani validační pravidla se nemění.

Vlastněné: `docs/execution/migration-reservation.md`, měřené řádky
`SYSTEM-MAP.md`, měřené registry řádky `README.md` a aktuální module graph
řádek `ROADMAP.md`, konstantní current migration count v
`contracts/m6/runtime-evidence-v1.js`, přesné migration očekávání v
`tests/m1-model-failover-schema.test.js` a záporné receipt fixtures v
`tests/m6-runtime-evidence.test.js`, tento WP a následný review receipt.
Zakázané: chat/specialist/expertise source a testy, registry, src, migration
těla, produkční DB/služby/modely, deployment a cleanup.

Fresh read-only union prošel 330 commitnutých refs a 71 registrovaných
worktrees. Slot 121 má jedinou identitu
`2026_10_01_121_m2_atomic_create.js`; žádná kolizní identity nebyla nalezena.
Private proof: `backend-migration-evidence/slot121-union.json`. Historická
rezervace se nevydává za předem provedenou; doplňuje se skutečný integrační
inventář již přijaté migrace. Instalovaná DB se nemění.

Ověření: registrované artifact-validation, M1 schema a M6 runtime receipt,
negativní receipt se starými 107 a nadbytečnými 109, byte diff zbytku
contracts/testů a nezávislé review. LOC se přeměří až po celé testové deltě
stejným newline algoritmem jako stávající artifact validator. Žádná aserce
se nevypíná ani neodvozuje od libovolně změněného schématu. Celý profil
zůstává neúspěšný, dokud se neopakuje a nejsou vyřešené předané CHAT chyby.

První clean kandidát `c483ea7e` má registrované **2 PASS / 1 FAIL**,
report `2026-10-01T08-01-09-211Z/report.json`. M1 schema a M6 receipt jsou
PASS; artifact-validation odhalil další zastaralé registry/tool/module
počty a chybu čárky ve vygenerovaném LOC řádku. Tento red výsledek je
zachován. Následná metadata oprava doplní přesný census bez změny asercí,
historické baseline počty v jejich datovaných odstavcích zůstanou.

Clean `1141ab61` má registrované **3/3 PASS**, report
`2026-10-01T08-04-18-443Z/report.json`. Správně deklarovaný PDF/OCR runtime
dal backend účetní workflow a PDF/DOCX **2/2 PASS**, report
`2026-10-01T08-05-06-178Z/report.json`. Původní tři BLOCKED z rootova
celého běhu zůstávají zaznamenané. Exportní chatový budget není tímto WP
opakovaný; další chatovou práci převzal jiný worker.

Nezávislé review `1141ab61` našlo jednu dokumentační chybu: aktuální README
počty 591/493 ještě odkazovaly na starý `c1a25dc1` s počty 590/492.
Referenční source je nyní opravený na `45caf5b5`; stav nové dokumentační
opravy je **REVIEW_PENDING**. Testové aserce a všechny historické výsledky
zůstávají beze změny.
