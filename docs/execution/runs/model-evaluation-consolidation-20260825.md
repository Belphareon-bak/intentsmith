# Model evaluation consolidation — candidate evidence

> **Historický kandidát — `CHANGES_REQUESTED`.** Nezávislé review 2026-08-25
> odmítlo tento candidate na `31234a6b` kvůli neúplnému suite contract SHA a
> pádu migrace 082 na post-070 legacy zápisu. Níže uvedené runy zůstávají
> neměnnou historickou evidencí této revize, nikoli current PASS. Opravený
> candidate je v
> [review remediation](model-evaluation-consolidation-review-remediation-20260825.md).

**Datum:** 2026-08-25  
**WP:** `WP-MODEL-EVALUATION-CONSOLIDATION`  
**Stav:** `CHANGES_REQUESTED / SUPERSEDED`
**Větev:** `codex/model-evaluation-consolidation-20260824`

Tento dokument je implementační handoff. Není nezávislé review ani přijetí
operátorem.

## Review jednotka

- base: `bd71b2ff37036f1b80d56620083402ffe3610269`
- implementation head před evidenčními docs: `836a4eb5190ea51f86ecb3d72e87e50aee55d181`
- diff před evidenčními docs: 133 souborů, +4 868 / -24 668 řádků;
  18 přidaných, 26 odstraněných, 88 změněných a 1 rename
- commity v pořadí:
  - `7ad69885` — definice WP a invariantů
  - `13d3fee1` — konsolidovaná evaluační autorita a odstranění v123 runtime
  - `b3d11040` — sjednocení decision dokumentace
  - `51dffe94` — boundary a test-registry ratchet
  - `c8b34091` — acceptance kontrakty a efektivní runtime context
  - `658e3d22` — validace rollback role před recovery identity
  - `836a4eb5` — ukončení watchdogů serverového suite runneru

Review příkaz:

```bash
git diff --find-renames bd71b2ff37036f1b80d56620083402ffe3610269..HEAD
```

## Výsledek milníků

1. M0: izolovaný worktree, base, zákaz automatické aktivace a přesné acceptance
   podmínky byly připnuty před implementací.
2. M1: v123 validation/scoring runtime, endpointy, WS/UI surface, proof skripty,
   ranker, proposal/preference scorer a paralelní apply/rollback writery byly
   odstraněny. Historické migrace a run evidence zůstaly pouze jako audit.
3. M2: migrace 082 zavádí append-only exact-artifact run/decision kontrakt a
   bezpečně importuje audit před dropem v123 runtime tabulek.
4. M3: API, CLI, Studio, governor i registry čtou jeden
   `ModelEvaluationReadModel`; decision bez `activationEligible=true` a
   portfolio gate je neakční.
5. M4: všech sedm rolí má versioned suite, contract SHA, víceúlohové minimum a
   discrimination floor. Chybějící, starý, blocked nebo DB-error stav fail-close
   není PASS.
6. M5: discovery, katalog a universe jsou faktické; WhatLLM je jen hunt-order
   signál. Telemetry už nevyrábí paralelní doporučení, blacklist ani agregovaný
   quality score.
7. M6: registry obsahuje 384 programů; deterministic scope je 191 offline + 36
   database = 227. Boundary baseline má 1 064 přesných hran a beze změny
   zachovává 3 cykly / 28 souborů.
8. M7: focused brány, clean deterministic gate a dva runner-owned serverové
   modelové E2E doběhly. Žádný E2E server ani watchdog po běhu nezůstal.

## Test evidence

### Zelené

- clean deterministic run `2026-08-24T22-43-55-697Z` nad `c8b34091`:
  227 PASS / 0 FAIL / 0 BLOCKED / 0 TIMEOUT;
- finální clean deterministic run `2026-08-24T22-53-27-269Z` nad handoff
  commitem `7980e6f5c6ce86fb4d55045912d42a9e4039f615`:
  227 PASS / 0 FAIL / 0 BLOCKED / 0 TIMEOUT;
- runner-owned server run `2026-08-24T22-51-23-483Z` nad `836a4eb5`:
  - `IS-T3-E2E-21-MODEL-UPGRADE`: PASS, 8 kroků;
  - `IS-T3-E2E-62-MODEL-EVALUATIONS`: PASS, 2 kroky;
  - jde o vývojové měření s `gateEvidence:false`, nemění registry state;
- focused: model consolidation/read-model/suites, schema migrations, binding
  application, routes, WS, Studio, governor, registry, repository hygiene a
  module boundary všechny PASS;
- test registry: 384 programů, SHA-256
  `a2c4d29e6bcc09bea6fc3baca03c339bbb79a662b0b1a2f6dbebce9116948fd3`;
- disputed E2E path hash:
  `54611abfccccc11318da8ebc974e2782f9bf1f9a8a109cd9d1bb57b1fef4e180`.

Tento řádek s finálním run ID je jediná změna navazujícího evidence-only
commitu; po zeleném handoff běhu už se produkční kód nezměnil.

### Zachované non-PASS

- run `2026-08-24T22-35-23-023Z`: 222 PASS / 5 FAIL. Odhalil zastaralý
  migrační/census/outbound kontrakt, `umask` fixture a rozpor runtime contextu;
  všechny příčiny byly opraveny, ne přeznačeny;
- run `2026-08-24T22-41-21-128Z`: 226 PASS / 1 FAIL. Meta-test našel 11
  lokálních direct-test artefaktů z focused běhů. Artefakty byly přesunuty mimo
  worktree a gate byl zopakován;
- server run `2026-08-24T22-47-27-615Z`: 1 PASS / 1 FAIL. Odhalil, že rollback
  validoval chybějící recovery identity před neplatnou rolí; pořadí bylo
  opraveno a zopakovaný run prošel;
- první zelený E2E rerun odhalil 15minutový neodpojený watchdog runneru. Runner
  byl přesně ukončen, watchdog opraven a konečný run skončil sám za 3,4 s.

## Host/GPU pravda

- nový ostrý hunt, pull, inference panel a VRAM measurement: `NOT RUN`;
- před i po serverových read/binding E2E byl `ollama ps` prázdný a nebyl
  přítomen NVIDIA compute proces;
- server E2E nepředstavuje current-contract model quality PASS;
- žádný decision nebyl aktivován a žádný durable binding nebyl změněn mimo
  runner-owned izolovanou DB.

## Nezávislé review

Tento konkrétní candidate nezávislým review neprošel. Jeho stav zůstává
`CHANGES_REQUESTED / SUPERSEDED`; opravy jsou doložené v navazující evidenci.

Whole-repo audit dalších zastaralých/paralelních částí IntentSmith je výslovně
následující samostatná práce po přijetí tohoto WP; není skrytě započítán do
tohoto výsledku.
