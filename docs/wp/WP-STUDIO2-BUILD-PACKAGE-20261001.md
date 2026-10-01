# IDE 2.0 — build a izolovaný balíček, 1. 10. 2026

**Autorita:** explicitní požadavek operátora dokončovat IDE 2.0 a backend po
milnících; tento běh navazuje na připravený
[izolovaný staging](WP-STUDIO2-ISOLATED-STAGING-20261001.md). Nejnovější zadání
předává další modelové CHAT testy jinému workerovi. Původní build část
ověřila balíček a dostupné testy rozhraní bez modelové inference;
následné samostatné modelové CODE/M2 přijetí je uvedené níže.

**Zdroj:** `45caf5b54b78def257221ac2ab33a64031800813`.
**Stav:** `BUILD_PACKAGE_VERIFIED / NO_MODEL_UI_VERIFIED / CONTROLLED_UI_M2_PASS / PHYSICAL_IDE_CODE_M2_PASS / PACKAGE_IDENTITY_REVIEW_PASS / REPORT_REVIEW_PASS / NOT_DEPLOYED`.

**Přijaté pokračování 12:30 UTC:** skutečný modelový composer/AppImage
na témže balíku vytvořil šest ledger modulů z předvyplněného typovaného
blueprintu. Přesný preview/DOM/terminal/Git/disk, frozen test exit 0,
restart a durable DB mají nezávislé **REVIEW_PASS**, review SHA-256
`62a55072c97427194481836eb49116cfe55edf6f97f00d814e4f395b872ff137`.
[Úplné aktuální identity a limity](../review/2026-10-01-STUDIO2-M2-FUNCTIONAL-UI.md).
Tento průchod neprovádí ani nepřijímá přirozený CHAT, větší projekty či release.

**Historické přijaté pokračování 10:14 UTC:** skutečný renderer/AppImage připravil,
zobrazil a schválil řízený návrh šesti souborů. Pevné funkční orákulum,
commit a nový read-only SQLite proces prošly; nezávislé REVIEW_PASS.
[Přesný kandidát, raw důkazy a hranice](../review/2026-10-01-STUDIO2-M2-FUNCTIONAL-UI.md).
Modelový CODE composer v AppImage nebyl tímto řízeným návrhem ověřený;
jeho následná přejímka je uvedená výše.

## Historický rozsah a vlastnictví build běhu

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

## Historické ověření a výsledek build běhu

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

## Historické hranice samotného build běhu

Modelový CHAT, VAT, 53×3 a kompakce nejsou tímto milníkem přejaty. Celý
`studio2-isolated-stage --live` nebyl spuštěn; povinný modelový/GPU krok patří
jinému workerovi. Obnovení skutečných uživatelských dat a úspěšná modelová
M2 změna v AppImage také nebyly v tomto běhu zkoušeny. Následuje nezávislé
review přesné identity a předání integračnímu vlastníkovi. Nasazení,
produkční služba, produkční DB, bindingy a mobilní klient nejsou měněny.
