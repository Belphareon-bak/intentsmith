# IntentSmith — vstupní bod pro agenty

Tento soubor je pouze vstupní ukazatel. Není samostatným zdrojem produktových
rozhodnutí, pracovních pravidel, aktuálního stavu ani release procedury.

## Povinné pořadí četby

1. [`PRODUCT.md`](PRODUCT.md) — komu IntentSmith slouží, jaký problém řeší a
   co musí umět verze 1.0.
2. [`DIRECTION.md`](DIRECTION.md) — proč se produkt vyvíjí evolučně z C3 a
   která směrová rozhodnutí už operátor udělal.
3. [`CONTRACT.md`](CONTRACT.md) — závazný způsob práce, pravomoci, invarianty a
   důkazní pravidla.
4. [`ROADMAP.md`](ROADMAP.md) — závislosti, milníky, paralelní proudy a aktuální
   pořadí práce.
5. [`SYSTEM-MAP.md`](SYSTEM-MAP.md) — aktuálně změřený stav a mapování
   schopností na kód.
6. Příslušný dokument v [`docs/inventory/`](docs/inventory/) — detail části,
   které se práce skutečně týká.

## Autorita dokumentů

- produkt a rozsah: přijatá verze `PRODUCT.md`;
- evoluční směr a operátorská rozhodnutí: `DIRECTION.md`;
- způsob práce: `CONTRACT.md`;
- prováděcí pořadí: přijatá verze `ROADMAP.md`;
- změřená fakta: `SYSTEM-MAP.md`.

Stav v hlavičce dokumentu je závazný. Soubor označený jako pracovní návrh se
čte kvůli kontextu a review, ale sám se nestává operátorským rozhodnutím.
Do jeho přijetí platí již zapsaná rozhodnutí v `DIRECTION.md` a pracovní pravidla
v `CONTRACT.md`.

Historické dokumenty v `docs/convergence/` a release evidence zůstávají
důkazem minulých běhů. Nejsou instrukcí pro běžný vývoj. Gate 0 se spouští jen
v explicitním release Work Package podle `CONTRACT.md`, nikdy jako první krok
běžné práce.

## První bezpečný krok

Než cokoli změníš, ověř aktuální `HEAD`, větev, remotes, worktrees a pracovní
strom. Cizí nebo nejasně vlastněné změny zachovej. Potom sleduj skutečný call
graph a podle potřeby spusť produkt; dokument ani název testu není náhradou za
pozorované chování.
