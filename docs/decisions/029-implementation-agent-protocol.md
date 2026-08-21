# 029 — Protokol implementačního agenta

**Stav:** přijato · **Datum:** 2026-08-21 · **Rozhodl:** operátor
**Dotčené dokumenty:** `CONTRACT.md §10`, `CLAUDE.md`, `AGENTS.md`,
`SYSTEM-MAP.md`, `docs/development/agent-protocol.md`

## Kontext

Dlouhý autonomní běh selhal tím, že vyráběl dokumenty a testy, které pak
ospravedlňovaly další dokumenty a testy, aniž pohnul jakýmkoli akceptačním
kritériem. Vznikl z toho protokol — commit `95ea4c4b` z 2026-08-21 14:06 UTC na
větvi `claude/intentsmith-protocol-review-ela54b`: `docs/development/agent-protocol.md`
(341 řádků, 16 sekcí), `CLAUDE.md` (142 řádků), a napojení do `CONTRIBUTING.md`,
`docs/README.md` a `docs/STATUS.md`.

Obsah je věcně správný a míří přesně na past, kterou tenhle projekt měřitelně
má — `DIRECTION.md §0` zaznamenává poměr aparátu k produktu 5 : 1 na 177
commitech za 4 dny.

## Problém, který si vynutil rozhodnutí

Ta větev **není postavená na tomto stromu**. Rodičem `95ea4c4b` je `6676902c`
z 2026-07-29 a `git merge-base` mezi ní a živým `HEAD` vrací prázdno — nulový
společný předek. Je to starý pnpm/TypeScript monorepo strom (`apps/`,
`packages/`, `pnpm-workspace.yaml`, `vitest.config.ts`).

Ověřeno proti živému stromu (v136.1, npm): `SECURITY.md`, `CONTRIBUTING.md`,
`docs/STATUS.md`, `docs/test-matrix-phase-1-to-4.md`, `docs/testing/`,
`packages/contracts/src/index.ts`, `artifacts/` a `pnpm-lock.yaml`
**neexistují**. Povinné příkazy `pnpm install --frozen-lockfile` a `pnpm verify`
v tomto repozitáři nejsou. `docs/ROADMAP.md` sice existuje, ale
`SYSTEM-MAP.md` ho od v136 vede jako zastaralý — autoritou je kořenový
`ROADMAP.md`.

Merge ani cherry-pick té větve by tedy zavedl závazný protokol, jehož každý
odkaz na autoritu je slepý, a jeho `CLAUDE.md` by přepsal živý rozcestník.

## Rozhodnutí

1. **Větev se nemerguje.** Zůstává v originu jako doklad původu.
2. **Text se portuje** na živý strom se skutečnými názvy dokumentů a příkazů:
   `docs/development/agent-protocol.md`.
3. **Protokol není nová autorita vedle `CONTRACT.md`.** Přijímá ho
   `CONTRACT.md §10` a je mu podřízený. Dvě paralelní autority na způsob práce
   jsou přesně ta nemoc, kterou má protokol léčit; `CONTRACT.md §7` už kontrakt
   pro agenta obsahuje a protokol ho upřesňuje, nenahrazuje.
4. **Jazyk zůstává anglický** (rozhodnutí operátora), jako vědomá výjimka
   z jinak českého korpusu. Termíny definované česky v `CONTRACT.md` se
   nepřekládají — `schopnost`, `chování`, `Work Package`, `disposition`,
   `invariant`.
5. **`CLAUDE.md` se nepřepisuje.** Zůstává rozcestníkem; protokol přibyl do
   povinného pořadí četby jako bod 4 a do „prvního bezpečného kroku" přibylo
   pojmenování autoritativní položky. `AGENTS.md` je nadále bajtově shodný.

## Mapování autorit

| Zdroj v původním textu | Živý ekvivalent |
|---|---|
| `SECURITY.md` + `docs/security/` | `docs/security/` + `CONTRACT.md §9` |
| accepted ADRs (`docs/adr/`) | `docs/decisions/` |
| architecture boundaries | `CONTRACT.md §2` (`L0`) + „Třináct invariantů" v `SYSTEM-MAP.md` |
| `CONTRIBUTING.md` | `CONTRACT.md` |
| phase exit gates v `docs/ROADMAP.md` | kořenový `ROADMAP.md` + zadání aktivního WP v `docs/wp/` |
| verification matrix (`test-matrix-phase-1-to-4.md`) | `tests/registry.json` + profily v `docs/nightly-audit.md` |
| `docs/testing/`, `artifacts/` | `docs/execution/runs/`, `docs/review/`, `docs/findings/`, historicky `docs/convergence/` |
| `docs/STATUS.md` | `SYSTEM-MAP.md` |
| C3 capability ledger | capability picture v `SYSTEM-MAP.md` + `docs/inventory/` |
| `packages/contracts/src/index.ts` a contract suites | pozorované chování běžícího produktu (`CONTRACT.md §4`); pro M1 wire shape `contracts/m1/` |
| `pnpm install --frozen-lockfile && pnpm verify` | `npm run test:deterministic`, `npm run test:registry` |
| product `Autonomous Agent` concept | `PRODUCT.md` |

## Dvě věcné odchylky od původního textu

- **Gate 0.** Původní §0 říká, že protokol nikdy neopravňuje přeskočit *gate*.
  V tomhle repozitáři je `CONTRACT.md §8` operátorské rozhodnutí, že **Gate 0
  při vývoji neplatí**. Port to říká výslovně: *gate* v protokolu znamená
  akceptační podmínku aktivního WP a zelenou `L1`, nikdy attestační řetěz
  `C→E→R→A`. Do klasifikace selhání (§6, §12) přibyla třída „při vývoji
  očekávaně červené", aby `nightly-orchestrator-self-test` a rozchod se
  zapečetěným fingerprintem registru nespouštěly stall ani zápis vady.
- **Rozhodovací politika (§11).** Neduplikuje `CONTRACT.md §7`, ale odkazuje na
  něj: §7 určuje, co agent smí bez ptaní, co si musí vyžádat a co nesmí;
  protokol říká jen, **jak** se eskaluje.

## Důsledky

- `SYSTEM-MAP.md` má novou sekci **„Otevřené release-blocking vady"** jako
  kanonický cíl §12. Je odlišená od „Známý stav, který se vědomě neřeší": tam
  patří vědomě odložené, sem nerozhodnuté a blokující. První zápis vznikl hned
  při portu — `npm run test:registry` je červený kvůli 10 neregistrovaným
  testovacím programům z eval série 2026-08-19 až 2026-08-21. Změřeno na čistém
  `43687e6b`, tedy předchozí vada; podle §12 se zapsala a **neabsorbovala** do
  tohoto běhu.
- `CONTRACT.md` je nyní verze 3.
- Neverzované návrhy v `docs/wp/` a `docs/decisions/019` spadají pod §2 jako
  artefakty běhu — buď se přijmou, nebo zahodí; ležet a tvářit se jako autorita
  nesmí.
