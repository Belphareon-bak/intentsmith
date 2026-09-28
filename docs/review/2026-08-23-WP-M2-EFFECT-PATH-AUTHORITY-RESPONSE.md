# Implementační odpověď — WP-M2-EFFECT path authority review

- **Review:** `25cdaac8` / `CHANGES_REQUESTED`
- **Opravný commit:** `664d91d85b77e8524ac2515656d6c2e74035df2d`
- **Stav odpovědi:** `CHANGES_APPLIED / RE_REVIEW_REQUIRED`
- **Rozsah:** pouze první project-path authority řez; veřejné M2 konektory
  zůstávají `NOT_PINNED`.

## Disposition

| Nález | Disposition | Důkaz |
|---|---|---|
| R1 HIGH | `CANDIDATE_CLOSED` | Preview i apply `project_path_violation` ukončí celou iteraci; loop report obsahuje `action: rejected`, `state`, `pathAuthority` a `rejectedPatches`. Smíšený validní + traversal test ověřuje nulový zápis obou sentinelů. |
| R2 HIGH | `CANDIDATE_CLOSED` | Dead-import zůstává best-effort recovery. Absolutní in-project scope se bezpečně normalizuje; outside absolute, adresář, dangling symlink a nečitelný vstup se přeskočí s typovaným důkazem; více souborů se zpracuje po jednotlivých atomických náhradách. |
| R3 MEDIUM | `CANDIDATE_CLOSED` | Rozpor deklarovaného jména a canonical cíle vrací `canonical_target_mismatch`; in-project symlink test prokazuje nezměněný cílový soubor. |
| R4 MEDIUM | `DOCUMENTED_RESIDUAL` | Hlavička authority modulu a WP přiznávají hardlink read exposure. Zápis zůstává omezený atomickým rename uvnitř projektu; úplné řešení patří dirfd/openat2 brokeru. |
| R5 LOW/MEDIUM | `CANDIDATE_CLOSED` | Adresář vrací `not_a_file`, dangling/loop symlink `symlink_unresolvable`; běžné I/O zůstává `read_failed`. |
| R6 LOW | `CANDIDATE_CLOSED` | `applyPatchSet` propaguje `state` a `pathAuthority` i ze selhání v apply fázi; race test to vynucuje po úspěšném preflightu. |
| R7 INFO | `ACKNOWLEDGED` | Historie se nepřepisuje. `b523a47f` vedle M2 hran odstranil dvě reprodukovatelně zastaralé `response-finalizer` hrany; tato nesouvisející integrator-owned tightening změna je zde explicitně zaznamenaná. |

## R2 — přesná kompatibilita

Baseline `44a9ba87` už u chybějícího/adresářového/nečitelného jediného vstupu
vrátila ze stripperu nulu a produkční caller následně použil původní
`out-of-scope errors unfixable`. Oprava proto netvrdí, že všechny tyto vstupy
předtím vedly k PASS. Odstraňuje novou tvrdou effect-refusal větev, obnovuje
vícesouborovou recovery a každý skip nově pojmenovává. Traversal, symlink ven a
race zůstávají terminální před zápisem.

Rozhodnutí pro modelový absolutní `scope_files` vstup je lokální a explicitní:
pokud jeho native absolutní cesta leží pod canonical project rootem, redukuje
se na relativní authority jméno a projde stejnými kontrolami. Jinak se bez
čtení a zápisu uloží jako `untrusted_scope_path` a recovery pokračuje.

## Reprodukované testy

```text
tests/patch-engine.test.js:             69 PASS / 0 FAIL
tests/lifecycle-build.test.js:          97 PASS / 0 FAIL
tests/execution-loop.test.js:           59 PASS / 0 FAIL
tests/module-boundary-ratchet.test.js:  13 PASS / 0 FAIL
registry: 397 runnable programs, be1adcf9efc5bda2cfdcc7efdfb251643a092ec244359da5a1d226170a0939b4
```

Celý deterministický runner na `664d91d8` vytvořil
`.intentsmith-artifacts/test-runs/2026-08-23T18-33-25-223Z/report.json`.
Jeho přesný výsledek je `verdict: FAIL`, `exitCode: 1`,
`233 PASS / 3 FAIL / 2 BLOCKED`; non-PASS suite jsou stejné jako přijatá M1
baseline. To dokládá nepřítomnost nové měřené regrese, nikoliv PASS celého gate.

Poznámka k názvu testu: přímé ověření `git show
c3b882d0:docs/wp/WP-M2-EFFECT-PATH-AUTHORITY.md` ukazuje, že WP §6 už na
reviewovaném commitu jmenoval existující
`tests/module-boundary-ratchet.test.js`; v implementaci nebylo co opravovat.

## Podmínka uzavření

Tento dokument nemění reviewerův verdikt. `REVIEW_PASSED` smí zapsat až
nezávislý re-review, který znovu prověří R1–R4 a přesný rozsah `25cdaac8..HEAD`.
