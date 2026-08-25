# Modelová platforma — aktuální handoff

**Datum:** 2026-08-25 · **Stav:** `ACCEPTED`
**Autoritativní popis:** [MODEL-SCORING-ACTIVATION.md](MODEL-SCORING-ACTIVATION.md)
**Evidence:** [review remediation](execution/runs/model-evaluation-consolidation-review-remediation-20260825.md)

## Co je hotové v review kandidátovi

- jeden versioned role-evaluation plan pro D1, D2, CODE, R1, R2, CHAT a VISION;
- append-only exact-digest runy a role-specific decisions v SQLite;
- společný read model pro API, CLI, Studio, governor a registry;
- durable binding je oddělen od evaluace a zůstává jedinou runtime autoritou;
- gateway zapisuje providerem/inventory ověřený digest skutečně obsluhujícího
  artefaktu; pokud jej neprokáže, zapisuje `NULL`, nikdy desired digest;
- cleanup vyžaduje disk pressure, exact usage a COMPLETE current-contract stav;
- v123 runtime, endpointy, WS zprávy, UI a paralelní proof measurement jsou
  odstraněné; upgrade DB zachová jejich auditní evidence před dropem tabulek;
- všechny role mají víceúlohové task i discrimination minimum.
- katalog a model universe nesou jen faktická metadata; odhadované benchmarky,
  agregované quality score, blacklist a paralelní telemetry scorer jsou pryč;
- rozhodnutí je akční jen po portfolio gate a pouze s explicitním
  `activationEligible=true`.
- promptový contract pokrývá text, rubric, language, grading inputs, VISION
  image bytes a skutečný CODE `buildPrompt`; outcome používá stabilní enum;
- migrace 082 bezpečně zachová i v123 zápisy vzniklé po aplikaci migrace 070;
- CODE fixture má čistou snapshot provenance a nedostupný historický oracle je
  explicitní pre-pull `BLOCKED`.

## Acceptance hranice a zbývající omezení

- V tomto review kandidátovi zatím nebyl proveden nový ostrý sériový Ollama/GPU
  panel. Staré runy se automaticky nepovyšují na dnešní contract.
- Nezávislý rereview nad candidatem `d8a2a108` skončil `PASS`; samostatný run
  `2026-08-25T17-15-48-322Z` reprodukoval `227/227`.
- Automatický failover/proof issuance zůstává vypnutý; aktivace je ruční přes
  exact binding application.
- Předchozí candidate na `31234a6b` dostal `CHANGES_REQUESTED`; jeho 227 PASS
  evidence není přijetí ani evidence této opravené revize.
- Šest drobných neblokujících follow-upů je vypsáno v remediation evidence;
  nejsou součástí tohoto acceptance ani důvodem měnit autoritativní kontrakt.

## Praktický read-only start

```bash
npm run report:model-evaluations
npm run report:model-evaluations -- --json
```

Pro nový hunt použij `node scripts/model-upgrade-hunt.js` až po kontrole
sériového GPU/Ollama slotu. Výstup musí zachovat `BLOCKED`, `FAILED`, `MISSING`
a `nedostatečný důkaz` jako ne-PASS stavy.
