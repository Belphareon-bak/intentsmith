# Rezervace čísel migrací — union census 2026-08-22, kontroly 2026-08-23 a 2026-08-24

**Vlastník:** integrační vlastník M1 · **Metoda:** union přes všechny živé větve
· **Platí od:** 2026-08-22

Tento dokument je položka 3 závazné Gate 1 fronty (`ROADMAP.md` §13). Vzniká
proto, aby obě migrační položky fronty — 020 a 015 — dostaly čísla z jednoho
censusu a nekolidovaly spolu ani s žádnou existující větví.

## Změřený stav

```text
git branch -a  (mimo archive/** a recovery/**)   351 větví
union obsazených čísel src/db/migrations/**      001–065, bez jediné mezery
nejvyšší obsazené číslo                          065
```

Kdo drží pásmo nad 054:

| Čísla | Linka | Větve |
|---|---|---|
| 055–060, 063 | mobilní | `wp/mobile-prototype-20260817`, `wp/mobile-refresh-20260809`, `integration/mobile-alpha-20260812`, `codex/mobile-prototype-20260817` |
| 061–062, 064–065 | M1 konsolidace | `integration/m1-consolidated-20260810` a ~120 navazujících `docs/**`, `evidence/**`, `queue/**`, `wp/**` větví |

`wp/mobile-prototype-20260817` drží 050–065 souvisle, protože obě linky nese
zároveň.

## Rezervace

| Číslo | Rozhodnutí | Obsah |
|---|---|---|
| **066** | [020](../decisions/020-m1-model-failover-opt-in-surface.md) | oddělená failover-policy storage, default-off, versioned/CAS řádek |
| **067** | [015](../decisions/015-m1-model-failover-proof-policy.md) | immutable proof run artifact vázaný na PASS proof |

## Proč to nejsou 058 a 059

`ROADMAP.md` §13 bod 5 uvádí `058` = 020 a `059` = 015 a k tomu poznámku, že
`055`–`057` jsou obsazené mobilními migracemi z `d6fee86f`. To platilo, když se
fronta psala. Mobilní linka mezitím pokračovala na `058`, `059`, `060` a `063`
a M1 konsolidace zabrala `061`, `062`, `064` a `065`. Rezervace `058`/`059` by
dnes vyrobila kolizi při prvním merge s kteroukoli mobilní větví.

Přesně kvůli tomuhle fronta žádá **union census přes všechny větve**, ne jen
kontrolu vlastního stromu. ROADMAP je opravená ve stejném commitu jako tento
dokument.

## Jak census zopakovat

```bash
for b in $(git branch -a --format='%(refname:short)' | grep -vE "^archive/|^recovery/"); do
  git ls-tree -r --name-only "$b" -- src/db/migrations 2>/dev/null \
    | sed -E 's#.*/[0-9_]{11}([0-9]{3})_.*#\1#'
done | grep -E "^[0-9]{3}$" | sort -u
```

Před každou další migrací se census pouští znovu. Rezervované číslo, které se
do dvou týdnů nepoužije, se uvolňuje.

## Kontrolní census 2026-08-23 — eval historie

Před začleněním eval historie byl census zopakován nad aktuálně dostupnými
branch tipy. Výsledek se od původní rezervace změnil:

```text
git branch -a  (mimo archive/** a recovery/**)   352 větví
union obsazených čísel src/db/migrations/**      001–069
068 na aktuálním tipu                            model_evaluation_history
069 na codex/m1-closeout-20260822                model_failover_runtime_finalization
první volné číslo                                070
```

`model_failover_runtime_finalization` existovalo už v commitu `c8ffbccc` jako
068 a teprve později bylo na své větvi přesunuto na 069. Číslo 068 proto není
bezpečné znovu použít: databáze, nad kterou se původní commit spustil, už může
mít stejný version string v `schema_migrations` a jinou migraci by tiše
přeskočila. Eval historie proto dostává **070**, i když na branch tipech po
přejmenování není druhý soubor 068 vidět.

| Číslo | Vlastník | Obsah |
|---|---|---|
| **068** | historicky `c8ffbccc` | nepoužívat znovu; původní runtime-finalization identita |
| **069** | `codex/m1-closeout-20260822` | runtime finalization po odstranění kolize |
| **070** | `claude/gate1-mobile-app-progress-5sywlt` | append-only historie modelových evaluací |

## Kontrolní census 2026-08-24 — konsolidace modelových evaluací

Před vytvořením nové migrace byl union census zopakován přes všechny dostupné
živé větve mimo `archive/**` a `recovery/**`. Dřívější pracovní odhad `081` už
neplatí: integrační M2 větev mezitím přidala i toto číslo.

```text
git branch -a  (mimo archive/** a recovery/**)   363 větví
union obsazených čísel src/db/migrations/**      001–081
071–081                                         M2 authority migrace
první volné číslo                                082
```

| Číslo | Vlastník | Obsah |
|---|---|---|
| **071–081** | `codex/m2-integration-20260824` a zdrojové M2 větve | M2 effect/tool/execution/lifecycle authority |
| **082** | `codex/model-evaluation-consolidation-20260824` | model evaluation decision/audit a odstranění v123 runtime tabulek |

Rezervace `082` je aktivní od 2026-08-24. Před vznikem souboru migrace se
census zopakuje ještě jednou; případný novější konflikt dostane přednost a WP
se posune na další volné číslo.

## Kontrolní census 2026-08-26 — review remediace modelových evaluací

Review rozsahu `e8c1ba85..96c762db` prokázalo, že M2 mezitím použilo 082 a 083
a modelová linka po posledním censusu přidala dva různé suffixy pod 081.
Opakovaný census všech dostupných lokálních a remote live refů mimo
`archive/**` a `recovery/**` změřil:

```text
živé refs                                         364
081                                               M2 + dva model compatibility repairy
082                                               M2 + model evaluation consolidation
083                                               M2 rollback receipts
první souvislý volný blok                         084–086
```

Modelová linka proto uvolňuje 081/082 a používá následující identity v pořadí,
ve kterém se musí aplikovat:

| Číslo | Vlastník | Obsah |
|---|---|---|
| **084** | model-evaluation review remediace | kompatibilita policy triggerů |
| **085** | model-evaluation review remediace | kompatibilita proof triggeru |
| **086** | model-evaluation review remediace | exact-contract evaluace, decisions, audit a odstranění v123 runtime tabulek |

Tento census je porovnaný s integračním tipem
`codex/m2-integration-20260824@9f8a7019`, který vlastní 071–083. Samostatně
zůstává v unionu starší konflikt čísla 070 mezi `model_evaluation_history`
a `m2_effect_authority`; nevznikl v tomto review rozsahu a musí jej vyřešit
integrační vlastník před sloučením obou linek. Není zde tiše přeznačen ani
vydáván za vyřešený.

Migrační preflight nyní vedle celého version stringu kontroluje i třímístný
numerický slot. Povoluje pouze dvě přesně vyjmenované historické dvojice 008
a 030; každou jinou kolizi odmítne před vytvořením `schema_migrations` nebo
spuštěním `up()`. Po budoucím spojení modelové a M2 linky tak existující konflikt
070 fail-closed zastaví integraci místo tichého průchodu.

## Oprava identity po review 2026-08-26

Následné upgrade review prokázalo, že výše popsané přesunutí už aplikovaných
081/081/082 na 084–086 porušilo rozhodnutí 016 a běžný upgrade z DB na
`96c762db` spouštěl konsolidaci podruhé. Platí proto:

- původní plné identity 081/081/082 jsou obnovené a neměnné;
- přesná modelová dvojice pod 081 je třetí explicitně grandfathered kolize;
- identity 084, 085 a 086 jsou trvale vyřazené a nesmějí být znovu použity;
- runner je v jedné transakci adoptuje zpět na původní identity; existující
  původní stamp má přednost, jinak se přejmenováním zachová jeho `applied_at`;
- guard kontroluje před adopcí i numerické sloty už uložené v
  `schema_migrations`. M2 konflikt 070 proto zůstává viditelný a fail-closed;
  vyřešit jej smí pouze autoritativní M2 integrační linka.
