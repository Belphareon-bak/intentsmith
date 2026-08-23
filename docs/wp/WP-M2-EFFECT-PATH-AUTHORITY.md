# WP-M2-EFFECT — project-path authority, první vertikální řez

- **Stav:** `IN_PROGRESS / FIRST_SLICE_VERIFIED`
- **Vlastník:** primární implementer M2-EFFECT
- **Worktree:** `/home/belphareon/worktrees/is-m2-effect-20260823`
- **Branch:** `codex/m2-effect-20260823`
- **Vstupní revision:** `44a9ba87c99a448b1b1b5f479963c3b6aaac7e91`
- **Implementace:** `37fab4f9dd3f6e7508c5a30746df30acf353f79d`
- **Boundary baseline:** `b523a47f`

## 1. Uživatelský výsledek

Existující patch/preview/rollback a lifecycle dead-import cleanup nesmí číst ani
měnit soubor mimo otevřený projekt jen proto, že vstup obsahoval absolutní
cestu, `..`, symlink ven nebo se rodičovská cesta změnila mezi kontrolou a
efektem. Odmítnutí je pojmenovaný neúspěch, ne falešný úspěch.

Tento řez implementuje již přijatá M2 exit kritéria a nálezy `P1-FX-001` a
`P1-FX-003`. Nezakládá nové produktové chování ani veřejný connector.

## 2. Povolené a zakázané cesty

Povolené:

- `src/executor/project-path-authority.js`;
- `src/patch/patch-engine.js`;
- `src/planner/lifecycle-build.js` pouze dead-import write cesta;
- odpovídající focused testy, přesné module-boundary hrany;
- `ROADMAP.md`, `SYSTEM-MAP.md`, `docs/findings/001-m2-effect-authority-gaps.md`
  a tento WP.

Zakázané v tomto řezu:

- `contracts/**`, approval schema, DB migrace a veřejný transport;
- mobile/companion cesty a coworkerův `WP-M2-CODE`;
- tool registry, process/network/Git efekty a lifecycle orchestrace mimo
  dead-import bypass;
- modely, Ollama, GPU běhy a jejich procesy.

## 3. Connector a verze

Projektovým vlastníkem `EffectRequest/Result` a `ApprovalGrant` zůstává
`WP-M2-EFFECT`, ale jejich verze je v tomto řezu **`NOT_PINNED`**. Nový modul je
interní path primitive, nikoliv náhradní veřejný effect connector. Konzumenti
nesmějí jeho existenci vykládat jako povolení implementovat další effect paths.

## 4. Závislosti

- M1 `ACCEPTED / GATE_2_PASS` na `44a9ba87`;
- přijatá `ROADMAP.md` §6;
- `docs/inventory/22-effect-authority-trace.md`;
- `docs/findings/001-m2-effect-authority-gaps.md`.

Původní branch-local kandidát na mobilní větvi byl pouze návrhový podklad. Jeho
commity se nepřenášely; implementace vznikla znovu nad přijatým M1, protože
větve mají široce odlišnou historii.

## 5. Malá demonstrace

1. Validní relativní patch nahradí soubor atomicky a zachová jeho mode bits.
2. Absolutní cesta, traversal a symlink ven vrátí
   `project_path_violation` před změnou sentinelů.
3. Descriptor-pinned preview nevrátí obsah po výměně rodičovské cesty.
4. Patch set provede path preflight celé sady před prvním zápisem.
5. Dead-import cleanup předem odmítne traversal/symlink; více skutečně
   měněných souborů vrátí `multi_file_atomicity_required` před prvním efektem.
6. Běžné `EIO` zůstane `read_failed`, není maskované jako security incident.

## 6. Focused pozitivní a negativní test

```bash
node tests/patch-engine.test.js
node tests/lifecycle-build.test.js
node tests/execution-loop.test.js
node tests/module-boundary-ratchet.test.js
```

Ověřený výsledek na implementačním commitu:

- patch engine: `66 PASS / 0 FAIL`;
- lifecycle BUILD: `84 PASS / 0 FAIL`;
- execution loop: `58 PASS / 0 FAIL`;
- module boundary: `13 PASS / 0 FAIL`, bez růstu cyklů.

Registry gate prošel se `397` spustitelnými programy a fingerprintem
`be1adcf9efc5bda2cfdcc7efdfb251643a092ec244359da5a1d226170a0939b4`.

## 7. Stop condition / eskalace

Tento WP se zastaví před:

- zmražením veřejného `EffectRequest/Result@1` nebo `ApprovalGrant@1` bez
  operátorského přijetí přesného schématu;
- volbou kompatibility, UX approvalů nebo nového product scope;
- tvrzením, že Node path API uzavírá nepřátelský ABA závod — silná varianta
  vyžaduje dirfd/openat2 broker;
- povolením více-souborového efektu bez durable batch journalu;
- integrací coworkerova CODE streamu bez samostatného review.

## 8. Ověření a aktuální výsledek

Po focused testech musí před handoffem projít:

```bash
npm run test:registry
npm run test:deterministic
git diff --check
```

Celý deterministický gate na `7af74db8` skončil reportem
`.intentsmith-artifacts/test-runs/2026-08-23T17-59-11-989Z/report.json`:

- `233 PASS / 3 FAIL / 2 BLOCKED`;
- FAIL zůstaly přesně známé baseline suite `nightly-audit-runner-self-test`,
  `nightly-orchestrator-self-test` a `vram-coordination`;
- BLOCKED zůstaly přesně `chat-export-budget` a `export-pdf-docx`;
- žádná nová produktová regrese proti přijatému M1 nebyla naměřena.

Aktuální pravdivý stav je `FIRST_SLICE_VERIFIED`, nikoliv `WP-M2-EFFECT DONE`,
`M2 PASS` ani připnutý effect connector. Zbývají approval/payload authority,
timeout/cancellation/restart revokace, process supervision, durable rollback,
network/Git/tool mediation, audit a skutečný M2 user journey. Nezávislé review
tohoto nového řezu zatím neproběhlo.
