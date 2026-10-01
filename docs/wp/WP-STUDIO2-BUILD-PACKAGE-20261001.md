# IDE 2.0 — build a izolovaný balíček, 1. 10. 2026

**Autorita:** explicitní požadavek operátora dokončovat IDE 2.0 a backend po
milnících; tento běh navazuje na připravený
[izolovaný staging](WP-STUDIO2-ISOLATED-STAGING-20261001.md). Nejnovější zadání
předává další modelové CHAT testy jinému workerovi. Tento WP ověřuje build,
balíček a dostupné testy rozhraní bez modelové inference.

**Zdroj:** `45caf5b54b78def257221ac2ab33a64031800813`.
**Stav:** `BUILD_PACKAGE_VERIFIED / NO_MODEL_UI_VERIFIED / PACKAGE_IDENTITY_REVIEW_PASS / REPORT_REVIEW_PENDING / NOT_DEPLOYED`.

## Rozsah a vlastnictví

Vlastník běhu: `/root/full405_diagnosis`. Použit stávající vlastní checkout
`intentsmith-ide2-staging-20261001`, původně čistý detached `e5b9ca82`;
nevznikl další worktree. Větev `work/ide2-build-stage-20261001` začíná přesně
na zdrojovém SHA. Jediné trackované změny jsou tento WP a
[výsledkový report](../review/2026-10-01-STUDIO2-BUILD-PACKAGE-45caf5b5.md).
Produktový kód, registry, kontrakty ani CI nejsou měněny.

Závislosti backendu a IDE jsou fyzické soukromé reflink kopie. Workspace
symlinky IDE míří do extensions tohoto staging checkoutu. Cizí závislosti
sloužily pouze jako zdroj pro čtení; jejich lockfile a package manifesty
odpovídají kandidátu. Build nepoužívá sdílené mutable `node_modules`.

## Ověření a výsledek

- Skutečný Yarn build a Electron dist na Node `24.21.0`, Yarn `1.22.22`: exit `0`.
- Přenosný balík přes existující `package-studio2-ready.mjs`: exit `0`,
  3 103 trackovaných souborů ověřeno proti zdroji.
- Všech 16 299 původních položek `SHA256SUMS`: exit `0` před i po běhu
  AppImage. Finální balík doplněný o TEST-RESULTS/evidence: 16 313 položek,
  celý manifest znovu exit `0`.
- Kritické JS/HTML bajty build → linux-unpacked → extrahovaný AppImage shodné.
- Registrovaný skutečný Electron Studio 2 DOM journey: exit `0`.
- Registrovaný M2 composer DOM journey: exit `0`; ověřuje bezpečnou chybu
  `LLM_PROVIDER_UNAVAILABLE`, nikoli úspěšné modelové generování projektu.
- SCM: `9/9`; staging kontrakty: `13/13`, oba skutečný exit `0`.
- AppImage z balíčku proti backendu a Node z téhož balíčku: vlastní nová DB,
  privátní profil, user/network namespace, přesná backend URL, Studio 2 DOM;
  AppImage i backend exit `0`.

## Hranice a další krok

Modelový CHAT, VAT, 53×3 a kompakce nejsou tímto milníkem přejaty. Celý
`studio2-isolated-stage --live` nebyl spuštěn; povinný modelový/GPU krok patří
jinému workerovi. Obnovení skutečných uživatelských dat a úspěšná modelová
M2 změna v AppImage také nebyly v tomto běhu zkoušeny. Následuje nezávislé
review přesné identity a předání integračnímu vlastníkovi. Nasazení,
produkční služba, produkční DB, bindingy a mobilní klient nejsou měněny.
