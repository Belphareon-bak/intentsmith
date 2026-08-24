# System Governor v135 — as-built kontrakt Level 1

**Stav:** implementováno · **Aktualizováno:** 2026-08-25

Název zůstává kvůli existujícím odkazům. Tento dokument popisuje skutečný
současný Level 1 governor; původní plán s `upgrade_proposals`, čtrnáctidenním
TTL a v123 validačními tabulkami je superseded.

## Hranice autority

Governor je read-only analyzátor a návrhová vrstva:

1. čte surovou provozní telemetrii a current-contract stav modelových evaluací;
2. sestaví šest health dimensions a deterministické návrhy;
3. zapisuje pouze snapshot do `governor_reports` a stav návrhu do
   `governor_proposals`;
4. nic nespouští, nemění modelový binding, neprovádí shell/exec a neupravuje
   soubory;
5. `approved` znamená pouze uživatelské potvrzení návrhu, ne autorizaci efektu.

Pipeline běží až na explicitní `POST /api/system/governor/check`:

```text
healthAnalyzer.analyze()
  -> improvementPlanner.evaluate()
  -> safetyGuard.filterSafe()
  -> governor_reports + governor_proposals
  -> control WS governor_report
```

## Health dimensions

| Dimension | Současná data | Význam |
|---|---|---|
| `models` | raw `model_performance` za 30 dní | provozní success rate, nikoli quality eval score |
| `cre` | `telemetry_snapshots`, `cre_override_log` | úspěch běhů a override rate |
| `architecture` | poslední `architecture_state` | drift a porušení hranic |
| `builds` | `quality_scores`, checkpoint telemetry | kvalita build outputu a checkpoint rate |
| `specialists` | outcome události `specialist_telemetry` | úspěšnost nástrojových outcome událostí |
| `upgrades` | durable bindings + `model_evaluation_runs` | COMPLETE/FAILED/BLOCKED/MISSING pro exact digest a dnešní contract |

Chybějící tabulka nebo data vracejí `UNKNOWN` s `dataCompleteness=0`, ne
optimistický PASS. Upgrades dimension nepoužívá name-only score, TTL ani
historické v123 tabulky. Jiný digest či contract se nepočítá jako aktuální.

## Deterministická pravidla

Planner může vytvořit tyto návrhy:

- `MODEL_SWITCH` při nízké provozní úspěšnosti nebo provozním driftu; payload
  ale odkazuje jen na read-only `/api/system/models/evaluations` a požaduje
  kontrolu exact-contract evidence před případnou ruční změnou;
- `MODEL_EVALUATION_REVIEW`, pokud některý durable binding nemá current
  COMPLETE evaluaci nebo je run FAILED/BLOCKED;
- `DRIFT_SCAN`, `QUALITY_REVIEW`, `PATTERN_REVIEW` a `SPECIALIST_CHECK` pro
  ostatní health dimensions.

Governor není druhý modelový scorer. Raw runtime success rate může upozornit na
provozní problém, ale neumí prohlásit kandidáta za kvalitnější, vytvořit
activation-eligible decision ani změnit binding.

## Safety guard a persistence

- požaduje platný typ, severity, title, description a confidence nejméně 0.3;
- deduplikuje stejný hash mezi `pending` i `approved` návrhy;
- po dismiss používá cooldown HIGH 3 h, MEDIUM 12 h, LOW 24 h;
- `governor_reports.proposals_json` je neměnný snapshot;
- `governor_proposals` je live stav `pending|approved|dismissed`.

## Ověření

```bash
node tests/governor.test.js
node tests/model-evaluation-read-model.test.js
node tests/model-evaluation-consolidation.test.js
```

Aktuální autoritativní modelový kontrakt je v
[MODEL-SCORING-ACTIVATION.md](MODEL-SCORING-ACTIVATION.md).
