# Modelová platforma — aktuální handoff

**Datum:** 2026-08-27 · **Stav:** `IMPLEMENTATION_GREEN / REREVIEW_REQUIRED`
**Autoritativní popis:** [MODEL-SCORING-ACTIVATION.md](MODEL-SCORING-ACTIVATION.md)
**Evidence:** [finální remediační handoff](execution/runs/model-evaluation-final-integration-20260826.md)

## Co je hotové v review kandidátovi

- jeden versioned role-evaluation plan pro D1, D2, CODE, R1, R2, CHAT a VISION;
- append-only exact-digest runy a role-specific decisions v SQLite;
- společný read model pro API, CLI, Studio, governor a registry;
- durable binding je oddělen od evaluace, všech 7 rolí má exact DB autoritu a
  chybějící fresh-install baseline se uloží observačně bez runtime operace;
- gateway přijme digest skutečně obsluhujícího artefaktu pouze přímo z
  provider response; mutable inventory před/po jej nesmí dokazovat ani doplnit;
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

- Remediace nespouštěla nový ostrý panel. Role-strict read-only snapshot pro 13
  installed artefaktů má 28 `COMPLETE`, 11 `BLOCKED` a 52 `MISSING`
  artifact/role buněk pod současnými contracty. Scoring panel tedy není úplný;
  starší contracty ani run jiné role se automaticky nepovyšují.
- Dřívější nezávislý rereview nad candidatem `d8a2a108` skončil `PASS`, ale
  pozdější review rozsahu `e8c1ba85..96c762db` našlo číselné kolize migrací a
  review rozsahu `96c762db..4169c59d` a `c5aa379a..74beafea` následně prokázala
  nebezpečný upgrade, cross-role leakage, nepravdivý startup stav `DURABLE` a
  telemetry veto. Poslední rereview nad `40418aaf` navíc našlo ABA response
  identity, zbytky auto-failover writerů a neúplnou snapshot provenienci.
  Product/test oprava `9f6e4828` prošla novým čistým 279/279 gate. Následný
  `0bd38b7d` přenesl stejnou exact-response atestaci i do ukládaného scoringu a
  product/test head `79328185` prošel novým čistým 279/279 gate. Kandidát čeká
  na nezávislé rereview a provider capability popsanou níže.
- Automatický failover/proof issuance není jen vypnutý: veřejné auto-claim,
  proof selection, terminal, expiry/finalization a restart writery jsou
  odstraněné. Aktivace je ruční přes exact binding application.
- Na hostu nainstalovaná Ollama 0.32.14 v `ChatResponse` nevrací digest
  obslouženého artefaktu. Aktuální upstream už pole `ChatResponse.digest`
  obsahuje; preferovaná navazující capability je proto autorizovaný upgrade na
  připnutý release, který pole obsahuje, a kompatibilitní preflight. Do té doby
  `DURABLE` call, binding verification i nový autoritativní scoring správně
  selžou jako neověřené; plně funkční durable runtime a nové scoring běhy
  nejsou hotovou vlastností tohoto kandidáta.
- Předchozí candidate na `31234a6b` dostal `CHANGES_REQUESTED`; jeho 227 PASS
  evidence není přijetí ani evidence této opravené revize.
- Starší cross-branch sloty jsou atomicky adoptované nebo fail-closed odmítnuté;
  skutečná pre-082 fixture i plná záloha nyní projdou standardním runnerem.
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
