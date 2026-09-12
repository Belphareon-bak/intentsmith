# Hunt review follow-up — 2026-09-12

Zadání vychází z operátorova review repo-scoring packetu a trvajícího pokynu
dokončovat produkční práci. Nezakládá nový produktový rozsah ani acceptance.

- Výsledek: společný core/hunt kandidát obsahuje repo evaluace a opravený
  sidebar; doložená obnova duelu při změně kontraktu a neúplném incumbentovi;
  review propojí historické FAILED, bootstrap službu a současné providery.
- Vstup: owned `fd653630`; přebíraný hunt `5e3521ef`, společný předek
  `ee4472d5`. Checkout se znovu používá na `work/hunt-review-followup-20260912`.
- Vlastněné cesty: integrační konflikty `SYSTEM-MAP.md`,
  `tests/model-evaluation-suites.test.js`; regresní testy evaluace/Studia,
  stávající Studio build guard podle potvrzené vady; `docs/MODEL-UPGRADE-HUNT.md`,
  `docs/MODEL-SCORING-ACTIVATION.md`, ROADMAP a doplňující review evidence.
  Cizí checkout, jeho modelové běhy, DB, služby a bindingy jsou pouze čtené.
- Pozitivní/negativní důkaz: exact-contract historie, chybějící/selhaný
  incumbent a opakování; sole-sidebar v aplikaci/build výstupu; celý společný
  deterministický profil a registry. Žádné fyzické inference při obsazené GPU.
- Stop: změna veřejného connectoru, retence, aktivace modelu nebo potřeba
  zápisu do cizího běhu není součást této opravy.
- Ověření: `npm run test:deterministic` s explicitně dostupnými deklarovanými
  toolchain prerekvizitami, `npm run test:registry`, produkční Studio build;
  focused testy podle dotčených cest. Minulé výsledky se nepřepisují.
