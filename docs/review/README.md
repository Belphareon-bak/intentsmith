# Externí review — index

**Autor:** Claude (`claude-opus-5`), na žádost operátora
**Datum:** 2026-08-01
**Základ:** `17a8b9a80137222233dceaf24a3d2cfbe55b06e0` (`codex/s1-legacy-loopback-containment`)

---

## Co tato složka je

Poznámky nezávislého čtenáře repozitáře. Vznikly mimo `codex/*` větve a nejsou
součástí žádného Gate 0 kandidáta.

**Žádný soubor zde není evidence.** Autoritou o stavu zůstává generovaný
[`docs/convergence/STATUS.md`](../convergence/STATUS.md), `tests/registry.json`
a [`GATE-CRITERIA.md`](../convergence/GATE-CRITERIA.md). Řádek v těchto
dokumentech znamená *„někdo to přečetl a ověřil"*, nikoli *„je to prokázané
podle pravidel gate"*.

## Proč to nesahá na existující soubory

Dvě pravidla repozitáře to zakazují a obě jsou respektována bez výjimky:

1. `AGENTS.md` → **„GPT-5.6-sol in Codex is the sole branch writer."**
2. `GATE-CRITERIA.md` § Scope of a verdict → *„Any product, source, test,
   configuration, or non-evidence documentation change invalidates the
   candidate verdict."*

Z druhého pravidla plyne, že i pouhá oprava překlepu v `ROADMAP.md` shodí
právě získaný Gate 0 PASS a vynutí nový běh `C→E→R→A`. Proto je tato složka
**čistě aditivní**: přidává nový adresář, nemění ani neodstraňuje žádný
existující soubor, a nezasahuje do `tests/`, `src/` ani `docs/convergence/`.

**I tak platí:** pokud se tato složka kdykoli sloučí do kandidátní větve,
kandidát tím pozbývá platnosti a potřebuje nový attestation. Je to jeden
soubor navíc ve stromu, což je přesně ten druh změny, který pravidlo popisuje.
Doporučené řešení je v [WORK-PROPOSAL](2026-08-01-WORK-PROPOSAL.md) §4.

## Obsah

| Dokument | Co odpovídá |
|---|---|
| [STATE-AND-VERIFICATION](2026-08-01-STATE-AND-VERIFICATION.md) | Co jsem nezávisle spustil a co z toho vyšlo; mapa větví; pět nálezů `EX-1`..`EX-5` |
| [WORK-PROPOSAL](2026-08-01-WORK-PROPOSAL.md) | Na čem se dá pracovat paralelně, aniž to koliduje s S-trackem |

## Jak s tím naložit

Nálezy `EX-1`..`EX-5` nejsou zapsané do `RISK-REGISTER.md` ani do žádného
ledgeru — to je práce vlastníka větve. Jsou formulované tak, aby se daly
přenést beze změny formulace, včetně navrženého `gateImpact` tam, kde ho
nález potřebuje.
