# Modelová platforma — aktuální handoff

**Datum:** 2026-08-26 · **Stav:** `IMPLEMENTATION_GREEN / REREVIEW_REQUIRED`
**Autoritativní popis:** [MODEL-SCORING-ACTIVATION.md](MODEL-SCORING-ACTIVATION.md)
**Evidence:** [post-review remediation](execution/runs/model-evaluation-review-remediation-2-20260826.md)

## Co je hotové v review kandidátovi

- jeden versioned role-evaluation plan pro D1, D2, CODE, R1, R2, CHAT a VISION;
- append-only exact-digest runy a role-specific decisions v SQLite;
- společný read model pro API, CLI, Studio, governor a registry;
- durable binding je oddělen od evaluace, všech 7 rolí má exact DB autoritu a
  chybějící fresh-install baseline se uloží observačně bez runtime operace;
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
- `DURABLE` vzniká pouze z runtime+provider startup ověření všech rolí;
  provider/drift failure je veřejné `DEGRADED` a blokuje actionability, zatímco
  rehydrate failure zastaví start. Standalone CLI je vždy
  `UNVERIFIED_RUNTIME`.
- promptový contract pokrývá text, rubric, language, grading inputs, VISION
  image bytes a skutečný CODE `buildPrompt`; outcome používá stabilní enum;
- migrace 082 bezpečně zachová i v123 zápisy vzniklé po aplikaci migrace 070;
- CODE fixture má čistou snapshot provenance a nedostupný historický oracle je
  explicitní pre-pull `BLOCKED`.
- CLI i Studio zobrazují všechna current-contract rozhodnutí role, včetně
  neakční CODE výhry qwen3.8;
- current discovery JSON je uchovaný content-addressed v run evidence.

## Acceptance hranice a zbývající omezení

- Remediace nespouštěla nový ostrý panel. Existujících 28 COMPLETE a 11 VRAM
  BLOCKED fyzických runů už je pod současnými contracty; starší contracty se
  automaticky nepovyšují.
- Dřívější nezávislý rereview nad candidatem `d8a2a108` skončil `PASS`, ale
  pozdější review rozsahu `e8c1ba85..96c762db` našlo číselné kolize migrací a
  review rozsahu `96c762db..4169c59d` následně prokázalo nebezpečný upgrade a
  nepravdivý startup stav `DURABLE`. Oba HIGH nálezy jsou implementačně
  opravené, ale kandidát čeká na nové nezávislé rereview.
- Automatický failover/proof issuance zůstává vypnutý; aktivace je ruční přes
  exact binding application.
- Předchozí candidate na `31234a6b` dostal `CHANGES_REQUESTED`; jeho 227 PASS
  evidence není přijetí ani evidence této opravené revize.
- Starší cross-branch slot 070 mezi modelovou a M2 linkou zůstává explicitním
  integračním blockerem; numerický preflight ho nenechá projít tiše.
- Lokální starý dokument `docs/MODEL-SCORING-RESULTS-20260824.md` zůstává jako
  cizí untracked soubor a není součástí kandidáta ani gate evidence.

## Praktický read-only start

```bash
npm run report:model-evaluations
npm run report:model-evaluations -- --json
```

Pro nový hunt použij `node scripts/model-upgrade-hunt.js` až po kontrole
sériového GPU/Ollama slotu. Výstup musí zachovat `BLOCKED`, `FAILED`, `MISSING`
a `nedostatečný důkaz` jako ne-PASS stavy.
