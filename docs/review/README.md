# Externí review — index

**Autor:** Claude (`claude-opus-5`), na žádost operátora
**Založeno:** 2026-08-01 na `17a8b9a80137222233dceaf24a3d2cfbe55b06e0` (`codex/s1-legacy-loopback-containment`)
**Naposledy doplněno:** 2026-08-07 o čtyři sondy měřené na `1fc8f03e649dd561fb279ce68e5c119d35faad55`
a o `MODULE-GRAPH` měřený na `13701b2a500feac94d13322433721125793c4587`

---

## Co tato složka je

Poznámky nezávislého čtenáře repozitáře. Vznikly mimo `codex/*` větve a nejsou
součástí žádného Gate 0 kandidáta.

**Žádný soubor zde není evidence.** Autoritou o stavu zůstává generovaný
[`docs/convergence/STATUS.md`](../convergence/STATUS.md), `tests/registry.json`
a [`GATE-CRITERIA.md`](../convergence/GATE-CRITERIA.md). Řádek v těchto
dokumentech znamená *„někdo to přečetl a ověřil"*, nikoli *„je to prokázané
podle pravidel gate"*.

## Proč byla složka původně čistě aditivní — a proč to už neplatí

> **Superseded 2026-08-03 rozhodnutím operátora v `CONTRACT.md §8.`**

Srpnové dokumenty z 08-01 vznikly za dvou pravidel:

1. `AGENTS.md` → *„GPT-5.6-sol in Codex is the sole branch writer."*
2. `GATE-CRITERIA.md` § Scope of a verdict → *„Any product, source, test,
   configuration, or non-evidence documentation change invalidates the
   candidate verdict."*

Z druhého plynulo, že i oprava překlepu v `ROADMAP.md` shodí Gate 0 PASS. Proto
byla složka čistě aditivní.

**Obojí je dnes jinak.** `CONTRACT.md` je jediný zdroj pravdy pro pravidla
vývoje a `AGENTS.md` s `CLAUDE.md` jsou pouze vstupní ukazatele. `CONTRACT.md §8`
navíc rozhodl, že **Gate 0 se uplatňuje výhradně při releasu a během vývoje
neplatí** — takže změna dokumentu už nekazí kandidáta, protože se při vývoji
žádný kandidát neřeší.

Co z původního režimu platí dál: dokumenty v této složce **nejsou evidence** a
zápis do `docs/convergence/`, `src/` a `tests/` má vlastní pravidla podle
`CONTRACT.md §6` a `§7` — zejména pravidlo jednoho zapisujícího vlastníka.

## Obsah

| Dokument | Datum | Co odpovídá |
|---|---|---|
| [STATE-AND-VERIFICATION](2026-08-01-STATE-AND-VERIFICATION.md) | 08-01 | Co jsem nezávisle spustil a co z toho vyšlo; mapa větví; nálezy `EX-1`..`EX-5` |
| [WORK-PROPOSAL](2026-08-01-WORK-PROPOSAL.md) | 08-01 | Na čem se dá pracovat paralelně, aniž to koliduje s S-trackem |
| [OPEN-DECISIONS](2026-08-02-OPEN-DECISIONS.md) | 08-02 | Otevřená rozhodnutí před uzavřením M0 |
| [SMOKE-FINDINGS](2026-08-02-SMOKE-FINDINGS.md) | 08-02 | Nálezy ze smoke běhu |
| [L0-8-BOUNDARY](2026-08-07-L0-8-BOUNDARY.md) | 08-07 | Import graph, oba prototypy hranice specialisty, nálezy `L8-2`..`L8-4` |
| [OUTBOUND-CENSUS](2026-08-07-OUTBOUND-CENSUS.md) | 08-07 | 82 call sites, empirická negativní kontrola, nálezy `OB-1`..`OB-3` |
| [AUTH-MATRIX](2026-08-07-AUTH-MATRIX.md) | 08-07 | 272 route + WS povrch, negativní kontrola, nálezy `AM-1`..`AM-4` |
| [SECRET-TYPES](2026-08-07-SECRET-TYPES.md) | 08-07 | Kategorie k rotaci, varianty remediace historie, nálezy `SEC-1`..`SEC-3` |
| [MODULE-GRAPH](2026-08-07-MODULE-GRAPH.md) | 08-07 | Modulový graf `src/**`, mapa švů, dosažitelnost a cykly, nálezy `MG-1`..`MG-7` |

Zadání, ze kterých pět srpnových sond vzniklo, jsou v [`docs/wp/`](../wp/).

`MODULE-GRAPH` má vedle reportu dva soubory, které jsou jeho součástí:
[`2026-08-07-module-graph.mjs`](2026-08-07-module-graph.mjs) je měřidlo a
[`2026-08-07-MODULE-GRAPH.json`](2026-08-07-MODULE-GRAPH.json) jeho strojově
čitelný výstup. Nástroj **není zapojený do `package.json`** ani do L1 linky —
leží u svého reportu, aby se dal spustit znovu, ne aby se spouštěl sám.

## Jak s tím naložit

Nálezy zde nejsou zapsané do `RISK-REGISTER.md` ani do žádného ledgeru. Jsou
formulované tak, aby se daly přenést beze změny formulace.

Srpnové sondy navíc měly určeného adresáta: `L0-8-BOUNDARY` a `SECRET-TYPES`
míří na rozhodovací frontu `ROADMAP.md §14`, `AUTH-MATRIX` a `OUTBOUND-CENSUS`
jsou vstup pro `WP-M5-AUTH`. Naměřené skutečnosti z nich už jsou promítnuté do
`SYSTEM-MAP.md`; tyto dokumenty drží detail a postup měření.
