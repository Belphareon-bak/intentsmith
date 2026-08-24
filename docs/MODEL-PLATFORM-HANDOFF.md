# Modelová platforma — aktuální handoff

**Datum:** 2026-08-25 · **Stav:** implementace probíhá, `REVIEW_PENDING`
**Autoritativní popis:** [MODEL-SCORING-ACTIVATION.md](MODEL-SCORING-ACTIVATION.md)

## Co je hotové v review kandidátovi

- jeden versioned role-evaluation plan pro D1, D2, CODE, R1, R2, CHAT a VISION;
- append-only exact-digest runy a role-specific decisions v SQLite;
- společný read model pro API, CLI, Studio, governor a registry;
- durable binding je oddělen od evaluace a zůstává jedinou runtime autoritou;
- gateway zapisuje digest skutečně použitého durable artefaktu do usage;
- cleanup vyžaduje disk pressure, exact usage a COMPLETE current-contract stav;
- v123 runtime, endpointy, WS zprávy, UI a paralelní proof measurement jsou
  odstraněné; upgrade DB zachová jejich auditní evidence před dropem tabulek;
- všechny role mají víceúlohové task i discrimination minimum.
- katalog a model universe nesou jen faktická metadata; odhadované benchmarky,
  agregované quality score, blacklist a paralelní telemetry scorer jsou pryč;
- rozhodnutí je akční jen po portfolio gate a pouze s explicitním
  `activationEligible=true`.

## Co není hotový důkaz

- V tomto review kandidátovi zatím nebyl proveden nový ostrý sériový Ollama/GPU
  panel. Staré runy se automaticky nepovyšují na dnešní contract.
- Implementační testy nenahrazují nezávislé review operátora.
- Automatický failover/proof issuance zůstává vypnutý; aktivace je ruční přes
  exact binding application.

## Praktický read-only start

```bash
npm run report:model-evaluations
npm run report:model-evaluations -- --json
```

Pro nový hunt použij `node scripts/model-upgrade-hunt.js` až po kontrole
sériového GPU/Ollama slotu. Výstup musí zachovat `BLOCKED`, `FAILED`, `MISSING`
a `nedostatečný důkaz` jako ne-PASS stavy.
