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
4. [`docs/development/agent-protocol.md`](docs/development/agent-protocol.md) —
   způsob práce agenta v repozitáři, přijatý v `CONTRACT.md §10`. Podřízený
   `CONTRACT.md`; anglicky.
5. [`ROADMAP.md`](ROADMAP.md) — závislosti, milníky, paralelní proudy a aktuální
   pořadí práce.
6. [`SYSTEM-MAP.md`](SYSTEM-MAP.md) — aktuálně změřený stav a mapování
   schopností na kód.
7. Příslušný dokument v [`docs/inventory/`](docs/inventory/) — detail části,
   které se práce skutečně týká.

## Autorita dokumentů

- produkt a rozsah: přijatá verze `PRODUCT.md`;
- evoluční směr a operátorská rozhodnutí: `DIRECTION.md`;
- způsob práce: `CONTRACT.md`, pro agenta upřesněný v
  `docs/development/agent-protocol.md`;
- prováděcí pořadí: přijatá verze `ROADMAP.md`;
- změřená fakta: `SYSTEM-MAP.md`.

Stav v hlavičce dokumentu je závazný. Soubor označený jako pracovní návrh se
čte kvůli kontextu a review, ale sám se nestává operátorským rozhodnutím.
Do jeho přijetí platí již zapsaná rozhodnutí v `DIRECTION.md` a pracovní pravidla
v `CONTRACT.md`.

**Co vznikne během běhu, není autorita.** Plán, report, návrhová poznámka ani
nový test nezakládají požadavek — smějí ho vysvětlit, implementovat nebo ověřit.
Jakmile je soubor vytvořený v tomto běhu citován jako zdroj požadavku, práce se
zastaví a vrátí k poslednímu nezávisle autoritativnímu požadavku.
`CONTRACT.md §10`.

Historické dokumenty v `docs/convergence/` a release evidence zůstávají
důkazem minulých běhů. Nejsou instrukcí pro běžný vývoj. Gate 0 se spouští jen
v explicitním release Work Package podle `CONTRACT.md`, nikdy jako první krok
běžné práce.

## První bezpečný krok

Než cokoli změníš, ověř aktuální `HEAD`, větev, remotes, worktrees a pracovní
strom. Cizí nebo nejasně vlastněné změny zachovej. Potom sleduj skutečný call
graph a podle potřeby spusť produkt; dokument ani název testu není náhradou za
pozorované chování.

Součástí té kontroly je **rozpočet pracovní plochy** (`CONTRACT.md` §6). Neomezuje,
kolik práce smí běžet — brání jen tomu, aby zůstávaly dokončené worktree a sandboxy.
Prakticky: práce, která jen navazuje v čase, přepne větev v existujícím checkoutu;
kdo zakládá nový worktree, nejdřív vypořádá bezpečně odstranitelné absorbované.
Stav vypíše `scripts/workspace-budget.sh report`, úklid sandboxů `clean --yes`.
Dirty, používané, detached a evidence-bearing checkouty se nemažou automaticky;
důkazy ke gate se nemažou nikdy.

Pak **pojmenuj konkrétní autoritativní položku, kterou tenhle běh posouvá** —
výstup aktivního Work Package, položku `ROADMAP.md §12`, schopnost ze
`SYSTEM-MAP.md`, přijaté a neimplementované rozhodnutí z `docs/decisions/`,
otevřenou regresi, nebo explicitní zadání operátora. Když ji pojmenovat nelze,
zeptej se. Nezahajuj práci proto, abys zjistil, co ta práce je.
