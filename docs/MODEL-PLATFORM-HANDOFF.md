# Modelová platforma — aktuální handoff

**Datum:** 2026-08-28 · **Stav:** `ACCEPTED / SYSTEM_PROVIDER_BLOCKED`
**Autoritativní popis:** [MODEL-SCORING-ACTIVATION.md](MODEL-SCORING-ACTIVATION.md)
**Evidence:** [finální remediační handoff](execution/runs/model-evaluation-final-integration-20260826.md)

## Co je hotové v přijatém balíku

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
- API, CLI, Studio a scoring queue používají jeden extended inventory
  normalizátor a jeden versioned technical applicability contract;
  `preferredCategories` zůstává pouze ranking prior;
- current/reuse lookup zahrnuje suite name, suite version i contract SHA a
  nové GPU runy ukládají skutečný start a konec.
- reader, CLI a Studio rozlišují ověřený interval od staršího
  `LEGACY_UNVERIFIED`; nekonzistentní historie nikdy nepublikuje start ani
  duration.

## Acceptance hranice a zbývající omezení

- Přijatý scoring snapshot 13 installed artefaktů má mezi 79 technicky
  kompatibilními dvojicemi 55 `COMPLETE`, 24 `BLOCKED`, 0 `FAILED` a 0
  applicable `MISSING`; dalších 12 raw `MISSING` je explicitní N/A. Po
  explicitně autorizovaném odstranění čtyř VRAM-blocked artefaktů má současná
  inventory 9 artefaktů, 55 `COMPLETE`, 0 `BLOCKED`, 8 N/A a 0 applicable
  `MISSING`. Append-only DB historii odstranění nemění. Starší contracty ani
  run jiné role se automaticky nepovyšují. Důkaz je v
  [`model-removal-live-20260828.json`](execution/runs/model-removal-live-20260828.json).
- Dřívější nezávislý rereview nad candidatem `d8a2a108` skončil `PASS`, ale
  pozdější review rozsahu `e8c1ba85..96c762db` našlo číselné kolize migrací a
  review rozsahu `96c762db..4169c59d` a `c5aa379a..74beafea` následně prokázala
  nebezpečný upgrade, cross-role leakage, nepravdivý startup stav `DURABLE` a
  telemetry veto. Poslední rereview nad `40418aaf` navíc našlo ABA response
  identity, zbytky auto-failover writerů a neúplnou snapshot provenienci.
  Product/test oprava `9f6e4828` prošla novým čistým 279/279 gate. Následný
  `0bd38b7d` přenesl stejnou exact-response atestaci i do ukládaného scoringu a
  product/test head `79328185` prošel novým čistým 279/279 gate. Kandidát poté
  prošel nezávislým Opus max rereview rozsahu `74beafea..26ab3291` s verdictem
  `REVIEW_PASSED`; pozdější coverage review ale vrátilo `CHANGES_REQUIRED`.
  Aktuální remediace následně prošla čistým finálním gate `279/279` na
  `53ded662` v runu `2026-08-28T20-11-17-080Z`; bounded post-gate evidence,
  SHA-bound inventory projection, offline 55/24/0/12 replay a reprodukovatelný
  manifest hledání historické zálohy jsou commitnuté. Nezávislé evidence
  rereview rozsahu `d6137d4c..3f027938` zopakovalo offline replay, tamper
  kontrolu, manifest i nový clean-clone gate `279/279` a skončilo
  [`REVIEW_PASSED`](review/2026-08-28-WP-MODEL-EVALUATION-EVIDENCE-REREVIEW.md).
  Model-scoring/evidence balík je proto `ACCEPTED`; provider capability popsaná
  níže zůstává samostatně blokovaná.
- Automatický failover/proof issuance není jen vypnutý: veřejné auto-claim,
  proof selection, terminal, expiry/finalization a restart writery jsou
  odstraněné. Aktivace je ruční přes exact binding application.
- Na hostu nainstalovaná Ollama 0.32.14 v `ChatResponse` nevrací digest
  obslouženého artefaktu. Online kontrola 2026-08-28 potvrdila stejnou absenci
  v nejnovějším stable `v0.33.1`, prerelease `v0.33.2-rc1` i v aktuálním
  serverovém `main`; neexistuje tedy vydaný upgrade, který by capability
  doplnil. Do zavedení důvěryhodné response-attesting provider capability
  `DURABLE` call, binding verification i nový autoritativní scoring správně
  selžou jako neověřené; plně funkční durable runtime a nové scoring běhy
  nejsou hotovou vlastností tohoto kandidáta.
- Předchozí candidate na `31234a6b` dostal `CHANGES_REQUESTED`; jeho 227 PASS
  evidence není přijetí ani evidence této opravené revize.
- Starší cross-branch sloty jsou atomicky adoptované nebo fail-closed odmítnuté.
  Historická pre-migration záloha se SHA `e22d580f…` nebyla dohledána a její
  existence není prokazována. Před poslední živou mutací vznikla nová
  byte-identická záloha současné DB se SHA `b524145d…` a `quick_check=ok`.
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
