# 007 — model cleanup porovnává dva různé timestamp formáty lexikograficky

- **vlastník:** [`WP-M1-MODEL-CLEANUP-AUTHORITY`](../wp/WP-M1-MODEL-CLEANUP-AUTHORITY.md), checkpoint C1
- **nalezeno v:** nezávislé read-only review `B3-IDENTITY`
- **stav:** `REMEDIATED / FRESH_CLONE_VERIFIED`; source `da95ab15`, baseline
  `3ff178fd`
- **závislost:** sjednocená časová reprezentace nebo numerické porovnání

## Evidence

Původní `runAutoCleanup()` porovnával ISO cutoff se SQLite `used_at` jako text.
Aktuální checkpoint načte všechny aliasové usage řádky, každý přijme jen jako
striktní UTC SQLite nebo ISO `Z` timestamp, převede je na epoch milliseconds a
teprve potom zvolí numerické maximum.

Neplatný čas, nulová usage evidence, chybějící provider `modified_at` i chyba
čtení DB fail-close zastaví kandidáta. Rovnost s cutoffem je chráněná; delete
smí pokračovat pouze pro čas striktně starší. Provider modification time
zůstává druhou ochranou i tehdy, když existuje usage historie. Nulová usage se
nepovažuje za „nikdy nepoužito“, protože ne všechny model-use cesty dnes do
`model_usage` zapisují.

Aliasový regression test nyní zapisuje recent usage produkčním SQLite tvarem
`datetime('now')`, ale záměrně neleží na 14denní hraně. Pinuje tím canonical
alias join, nikoli dosud neopravenou cutoff chybu.

## Dopad

Scheduler nyní čte výhradně autoritativní JSON `user_settings.id=1`; malformed,
missing, DB error a jiná hodnota než literal `true` nevytvoří inventory ani
delete efekt. Dva překrývající se tick běhy nejsou povoleny: druhý končí
`MODEL_CLEANUP_BUSY` před druhým inventory efektem.

## Splněná acceptance

- SQLite i ISO časy před/na/po cutoffu a mixed-format alias řádky jsou
  explicitně testované;
- numerické maximum vzniká až po parsování všech řádků, nikoli nad SQL
  `MAX(TEXT)`;
- nulová usage, neplatná či chybějící age evidence a DB read failure mají
  nulový delete;
- finding 006 i 007 používají stejnou cleanup mutation cestu.

## Mutační důkaz

Dočasná jediná změna `>= cutoff` na `> cutoff` způsobila, že přesně model na
hraně prošel do delete kandidátů; focused sada skončila 24/1, exit 1. Mutace
byla vrácena a čistý focused běh je součástí checkpoint evidence.
