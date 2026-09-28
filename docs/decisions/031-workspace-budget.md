# 031 — Rozpočet pracovní plochy: strop worktreeů a retence sandboxů

**Stav:** `ACCEPTED` (rozhodnutí operátora) · **Datum:** 2026-08-28
**WP:** — (provozní pravidlo, mimo milníkový proud) · **Migrace:** —

## Kontext

`CONTRACT.md` §6 od verze 4 říká, že efemérní worktree „vzniká po explicitním
schválení, žije jen po dobu svého WP a po integraci se odstraní". Pravidlo
existovalo, ale nemělo strop ani operační definici konce, takže se nevynucovalo.

Naměřeno 2026-08-28 na referenčním stroji, podruhé v řadě:

- filesystém `/` zaplněný na 100 % — 3,1 MB volných ze 477 G;
- 26 worktreeů, z toho 13 s větví plně obsaženou v jiné živé větvi;
- 99 GB jednorázových sandboxů proti ~130 MB důkazů ke gate;
- žádná z 22 větví worktreeů nebyla zmergovaná do `main`.

Poslední bod je jádro věci. `main` se v projektu jako integrační cíl
nepoužívá — integrace probíhá řetězením integračních větví. Podmínka „po
integraci" vázaná na `main` proto nenastala nikdy a úklid se nespustil.

Sandboxy navíc nejsou jen v `test-runs/*/runtime/`. Stejný vzorec leží
v `m6/{,failed-}candidate-*/<suite>/`, `m6-diagnostics/`, `run-suites/<ts>/`
a ve stromech `*-fresh-clone-*/home` + `/repo`, které se `runtime` nejmenují.

## Rozhodnutí

1. **Rozpočet se počítá z živých worktreeů** (těch, které jiná živá větev ještě
   celé neobsahuje); orientačně tři vedle hlavního checkoutu. Úklid vynucuje
   růst, ne zákaz: před založením nového worktree se vypořádají absorbované.
2. **Default je větev v existujícím checkoutu.** Nový worktree opravňuje jen
   prokazatelně souběžný zapisující WP, ne práce navazující v čase.
3. **Konec worktree je měřitelný a nezávislý na `main`:** worktree lze odstranit,
   jakmile jiná živá větev obsahuje jeho commity celé
   (`git merge-base --is-ancestor`). Odstraňuje se worktree, ne větev.
4. **Bezpečnost má přednost před mechanickým úklidem.** Dirty checkout,
   checkout s živým procesem, detached checkout a checkout s nepřenesenými
   evidence soubory se neodstraňuje automaticky. Report ho pojmenuje a úklid se
   provede až po vypořádání konkrétní překážky.
5. **Sandbox je vstup běhu, ne důkaz.** `runtime/`, `home/`, `repo/`,
   `node_modules/` pod `.intentsmith-artifacts/` jsou jednorázové; drží se sada
   z nejnovějšího běhu na worktree. `report.json`, `checkpoint.json`,
   `inventory.json`, `logs/` se nemažou nikdy. Sandbox obsahující důkaz je
   chráněný. Plošné smazání `.intentsmith-artifacts` je zakázané.
6. **Rozpočet se kontroluje na vstupu běhu a uklízí na výstupu** —
   `agent-protocol.md` §1 a §14.
7. **Mechanismus:** [`scripts/workspace-budget.sh`](../../scripts/workspace-budget.sh)
   (`report` / `clean [--yes]`). Skript je nástroj, ne autorita; pravidlo platí
   i tam, kde ho nikdo nespustil.

## Důsledky

- `CONTRACT.md` §6 obsahuje závazný rozpočet a bezpečnostní výjimky.
- `agent-protocol.md` §1 a §14 vyžadují kontrolu rozpočtu a úklid v handoffu.
- Bod 5 nekoliduje s `agent-protocol.md` §9 („Do not delete useful artifacts"):
  spotřebovaný sandbox bez důkazu užitečný artefakt není.
- Nezahrnuto: modely Ollama ani `~/.codex/sessions` leží mimo repozitář a tímto
  rozhodnutím se neřídí.
