# Předání V4: existující IDE 2.0, nikoli další aplikace

Stav: **NATIVE_CORE_VERIFIED / INSTALLATION_BLOCKED_BINDING_CHOICE /
INDEPENDENT_REVIEW_PENDING / NOT_ACCEPTED**.
[Souhrn změn, důkazů, nedodělků a další kroky](../../ide-preview-completion-20261010.md).

Aplikační SHA `37ee6177f7cf8e5e4509c5860474e8dca2ce0e8e`.
AppImage SHA-256 `8225de42fa4b743a0113de3322c65450f7efe6e00687b4d0683697b047d4fe26`.
Celý offline/database audit má vlastní přesný zdroj `3f9410cc`; poté se měnily
pouze dva popisky, mouse-focus CSS a odpovídající generovaný view/CSS. Čtyři dotčené UI programy,
struktura, build, CI a nativní průchod dokládají poslední aplikační zdroj.
Toto není Gate 0 attestation ani podpis nezávislého revizora.

## Co má Opus posoudit

1. Důležité změny V4 1–9 v jediném stávajícím rendereru; reálné ukládání,
   readback, zachování draftu a profilové plánování. Nevyměňovat skutečnou
   funkci za ilustrativní benchmark nebo namalovaný GPU/offload výsledek.
2. Rozdíl běžící/provozní DB sestavy čtyř modelů a povinnou volbu před
   restartem; neaktivovat nový model jako vedlejší efekt aktualizace IDE.
3. Rozsah staršího NEEDS_CHANGES: lidské role, digest/stavy, CHAT/refine,
   SSH ID a 31 nefunkčních historických ovladačů. Ovladače pouze pro čtení
   nejsou 31 implementovaných funkcí ani automatické splnění bodu f).
4. Oddělení aktuálních zelených testů od stále staré běžné instalace,
   neprovedeného GPU/doručení, staršího soak a formální release přejímky.

## Důkazy

- [Celý audit](audit-3f9410cc.json), [inventory](audit-inventory-3f9410cc.json),
  [audit log](audit-3f9410cc.log); [zachované původní selhání inventory](audit-failed-3750986d.json).
- [Poslední build](appimage-37ee6177.json), [Studio log](studio-build-37ee6177.log.gz),
  [AppImage log](appimage-build-37ee6177.log).
- [47 UI testů](ui-tests-37ee6177.txt), [161 artifact kontrol](artifact-checks-37ee6177.txt),
  [registry](registry-37ee6177.txt), [hranice](boundary-37ee6177.txt), [consumer](consumer-build-37ee6177.txt).
- [CI runs](ci-37ee6177-runs.json), [CI jobs/19 steps](ci-37ee6177-jobs.json),
  [starší CI runs](ci-3f9410cc-runs.json), [starší CI jobs](ci-3f9410cc-jobs.json).
- [Nativní receipt/39 snímků](native-37ee6177.json); níže publikovaný reprezentativní výběr 14 snímků.
  Vlastní čerstvá DB/profil, skutečný backend a místní Ollama metadata,
  žádná inference, GPU zátěž, produkční rebind nebo venkovní zpráva.
- [Pomocná sonda FAIL 1](native-helper-failed-v1.json) a
  [FAIL 2](native-helper-failed-v2.json): nesprávné očekávání pravého panelu
  na 1366 a výběr starého modelového detailu místo editoru. Poslední sonda
  je opravena; původní FAIL se nepřeznačují na PASS.
- [Migrace kopie](migration-preflight-3750986d.json),
  [production-mode čtení/BLOCKED](production-copy-3f9410cc.json),
  [instalační plán/NEAPLIKOVÁNO](installation-plan-37ee6177.json).

## Nativní snímky z posledního AppImage

Snímky jsou z testovacího profilu; barevný motiv operátora zůstává ve jeho
původním profilu. Šířka je Electron viewport. Zbývajících 25 snímků a jejich
texty jsou lokálně v `.intentsmith-artifacts/preview-completion-20261010/native-mouse-decoration/`.

| Obrazovka a šířka | Důkaz |
|---|---|
| account-1920 | [PNG](screenshots/account-1920.png) · [text](screenshots/account-1920.txt) |
| catalog-1366 | [PNG](screenshots/catalog-1366.png) · [text](screenshots/catalog-1366.txt) |
| challenge-draft-1366 | [PNG](screenshots/challenge-draft-1366.png) · [text](screenshots/challenge-draft-1366.txt) |
| context-editor-1366 | [PNG](screenshots/context-editor-1366.png) · [text](screenshots/context-editor-1366.txt) |
| hunt-1920 | [PNG](screenshots/hunt-1920.png) · [text](screenshots/hunt-1920.txt) |
| hunt-settings-1366 | [PNG](screenshots/hunt-settings-1366.png) · [text](screenshots/hunt-settings-1366.txt) |
| matrix-1366 | [PNG](screenshots/matrix-1366.png) · [text](screenshots/matrix-1366.txt) |
| model-detail-1366 | [PNG](screenshots/model-detail-1366.png) · [text](screenshots/model-detail-1366.txt) |
| operations-1366 | [PNG](screenshots/operations-1366.png) · [text](screenshots/operations-1366.txt) |
| overview-1920 | [PNG](screenshots/overview-1920.png) · [text](screenshots/overview-1920.txt) |
| profiles-list-1366 | [PNG](screenshots/profiles-list-1366.png) · [text](screenshots/profiles-list-1366.txt) |
| profiles-tiles-1366 | [PNG](screenshots/profiles-tiles-1366.png) · [text](screenshots/profiles-tiles-1366.txt) |
| settings-1920 | [PNG](screenshots/settings-1920.png) · [text](screenshots/settings-1920.txt) |
| telemetry-1366 | [PNG](screenshots/telemetry-1366.png) · [text](screenshots/telemetry-1366.txt) |

## Opakování sondy

[Build script](build-pinned.mjs) a [native script](capture-native.mjs) jsou
kopie skutečně spuštěných vlastních sond, nikoli další product aplikace.
Pro jejich relativní importy je zkopírujte do pracovních cest před spuštěním:

```bash
mkdir -p .intentsmith-artifacts/preview-completion-20261010/build-mouse-decoration
cp docs/review/evidence/ide-preview-completion-20261010/build-pinned.mjs .intentsmith-artifacts/preview-completion-20261010/build-mouse-decoration/build-pinned.mjs
cp docs/review/evidence/ide-preview-completion-20261010/capture-native.mjs .intentsmith-artifacts/preview-completion-20261010/capture-mouse-decoration.mjs
node .intentsmith-artifacts/preview-completion-20261010/build-mouse-decoration/build-pinned.mjs
node .intentsmith-artifacts/preview-completion-20261010/capture-mouse-decoration.mjs
```

Použijte Node 24, čistý checkout, skutečné desktop prostředí, stávající
projektové závislosti a místní metadata Ollamy na 127.0.0.1:11434.
Opakování na jiném SHA vytváří jiný receipt a nesmí přepsat publikované
výsledky. Sonda uklízí pouze vlastní backend a vlastní potomky AppImage.
Privátní DB, přístupové soubory, uživatelský profil a celé runtime zálohy
nejsou součástí předání.

[Manifest souborů](manifest.json) zajišťuje jejich identitu; neuděluje přejímku.

Publikované textové výpisy matice/detailu a artifact kontrol mají odstraněné
koncové bílé znaky; původní výpisy zůstávají v pracovních artefaktech.
Studio build log je gzip beze změny rozbalených bajtů: SHA-256 po rozbalení
se rovná `commands[0].logSha256` v build receiptu. PNG a ostatní runtime
receipty zůstávají původní.
