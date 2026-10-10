# Důkazy integrace IDE/BE a preview V4 — 10. 10. 2026

Stav: **INTEGRATION_QUALIFIED / INDEPENDENT_REVIEW_REQUIRED / RELEASE_NOT_ACCEPTED**.
Aplikační SHA: `387a490fb3fbd6b5c06756629b42e6a44840f15b`.
[Výsledné změny, limity a release podmínky](../../ide-integration-remediation-20261010.md).
Nezávislý Opus NEEDS_CHANGES patří původnímu `230f657f`, nikoli těmto opravám.

## Identita a rozsah

Publikace této dokumentace a oprava čekání ruční nativní sondy nemění
aplikační `src/`, `tests/` ani `intentsmith-ide/`. Dokončené aplikační běhy
identifikují čistý zdroj `387a490f`; pozdější publikační HEAD se nezaměňuje
za testované aplikační SHA. [Manifest](manifest.json) obsahuje velikost a
SHA-256 každého souboru paketu kromě samotného manifestu.

- AppImage: `IntentSmith-0.1.0.AppImage`, 195182241 bajtů,
  SHA-256 `247ea9552231a5cd6946cde4842b41c7695c9f72380bb97ec821be67401a0969`.
  Binární soubor zůstává místní, není commitnutý.
- Spuštěná nativní sonda: `scripts/manual/verify-ide-integration-native.mjs`,
  SHA-256 `c786a7c5ef85ed4bf75106093f34f42477b4938831efa46562f9973bf076301e`.
  Při běhu byla přesná opravená kopie v ignorované cestě vlastního čistého
  frozen checkoutu; následně je stejný obsah publikován jako ruční skript.
- Registry fingerprint:
  `1cf9d212eb90e52c42da8f18962e0121de577c3adccb579785078626150d4780`.
- `full-audit.json`, `http-audit.json`, `appimage-build.json`, `native.json`,
  `preferences.json`, `fresh-install.json`, `ci.json`, `release-validation.json`,
  `long-soak-start.json` a `throughput-audit.json` jsou byte-for-byte kopie
  původních receipts. `upgrade-restore.json` je původní receipt vlastněného
  runneru s dekódovaným receipt skutečného testu. `throughput-runtime.json`
  je dekódovaný JSON z base64url markeru původního `throughput.log`.
- Snímky `screenshots/*.png` pocházejí z konečného nativního běhu. Původní
  absolutní lokální cesty v receipts byly zachovány, zde jsou přenositelné
  kopie pro review. Původní lokální logy auditů zůstávají zachované.

## Dokončené ověření

| Soubor | Výsledek | Praktický rozsah |
|---|---|---|
| `full-audit.json` | 415/415 PASS | 327 offline + 88 database, sériově, žádné vynechané/blokované programy |
| `http-audit.json` | 3/3 PASS | BE + skutečný autentizovaný HTTP produkt a restart + privacy HTTP |
| `appimage-build.json` | BUILD_PASS | production Theia build + AppImage, zdroj čistý před/po |
| `native.json` | 27/27 PASS | skutečné nativní kliknutí/zápisy/readback/restart; worker edit/filter, specialistův kontext ve dvou provider payloadech |
| `preferences.json` | 4 aktivní / 31 neúčinných | HTTP/restart + skutečný spotřebitel paměti; neúčinné zápisy odmítá Studio controller |
| `fresh-install.json` | PASS dvou příkazů | čerstvý samostatný clone, full/minimal install a repeat bez vypůjčených závislostí |
| `upgrade-restore.json` | PASS | přesná 136.0.0 → záloha → neúspěšný upgrade → offline obnova DB → 136.1.0 se zachovaným projektem |
| `ci.json` | 19/19 success | run 38007051740 na přesném aplikačním SHA |
| `throughput-audit.json` / `throughput-runtime.json` | PASS, 300096 ms | skutečný production public-health HTTP, sustained 43340.09 req/s, P95 26 ms, P99 37 ms, peak RSS 299.391 MiB, bez chyb/outboundu |
| `final-checks.json` | aktuální publikace | struktura dokumentace/census, registry, importní hranice, generator parity a diff; nejde o nový aplikační runtime test |

Fresh/repeat install logy a dva upgrade logy jsou původní soubory,
jejichž otisky jsou již obsažené v příslušných receipts. Příprava npm cache
přesné předchozí verze proběhla v samostatném vlastněném klonu; samotný
upgrade/restore běžel v loopback-only network namespace a instaloval
předchozí verzi z této cache offline. Nativní poskytovatel je řízená fixture,
nikoli fyzický GPU/model test. Zátěž měří HTTP health endpoint, nikoli chat.

## Reprodukce

Použít Node 24, čistý vlastní clone připnutý k aplikačnímu SHA a vlastní
runtime/cache/DB. Nepracovat v produkčním checkoutu ani v cizím běhu.
Přesné argv, explicitní toolchain preflighty, časy a cleanup/source kontroly
jsou v auditních receipts. Celý profil má `--concurrency=1`.

```sh
node scripts/nightly-audit.js --profile=offline,database --concurrency=1 \
  --timeout-minutes=10 --deadline-hours=8 --run-id=<novy-vlastni-run> \
  --allow-blocker=toolchain:accountant-ocr-runtime,toolchain:bubblewrap,toolchain:bwrap,toolchain:git,toolchain:iproute2,toolchain:nftables,toolchain:prlimit,toolchain:python-pdf-runtime,toolchain:python3,toolchain:systemd-analyze,toolchain:tar

node scripts/nightly-audit.js --concurrency=1 --run-id=<novy-vlastni-http-run> \
  --suite=IS-T1-TESTS-IDE-BACKEND-TEST,IS-T3-TESTS-IDE-BACKEND-PRODUCT-HTTP-JOURNEY-TEST,IS-T3-TESTS-CHAT-PRIVACY-HTTP-TEST \
  --allow-blocker=toolchain:git

node scripts/nightly-audit.js --concurrency=1 --timeout-minutes=10 \
  --deadline-hours=1 --run-id=<novy-vlastni-throughput-run> \
  --suite=IS-T5-TESTS-M6-MAX-THROUGHPUT-E2E \
  --allow-blocker=server,toolchain:iproute2,toolchain:linux-user-network-namespace
```

PDF a accountant programy vyžadují doložené lokální runtime, ne zrušení
preflightu; původní celý běh použil `INTENTSMITH_PDF_PYTHON` a
`UCETNI_RUNTIME_DIR` explicitně. Nativní sonda spouští vlastní backend a
řízený provider, ověřuje přesný artefakt a uklízí vlastní procesy. Její
parametry jsou popsány v [publikovaném skriptu](../../../../scripts/manual/verify-ide-integration-native.mjs).
Přímý upgrade program je `tests/m6-previous-version-upgrade.e2e.js`; proměnná
`INTENTSMITH_M6_UPGRADE_NPM_CACHE` musí ukazovat na připravenou vlastní cache.

## Rozpracované a negativní důkazy

- `long-soak-start.json`: **STARTED_NOT_PASS**, 10. 10. 02:05 CEST;
  nejdříve dokončení 11. 10. 02:05 CEST. Produkční backend v izolovaném
  loopback namespace, pouze health/čtení projektů, bez chatu/GPU/outboundu.
  PID/start receipt není důkazem dokončení. Frozen zdroj musí zůstat stejný.
- `release-validation.json`: **BLOCKED**,
  `M6_RELEASE_EVIDENCE_NOT_FOUND`. Samostatné zelené programy nenahrazují
  aktuální M6 index, nezávislou přejímku, L0 podpisy nebo operátorské demo.
- `native-failed-v1.json`: **FAIL** po dvou kontrolách. Sonda se řídila
  nadpisem ještě před načtením dat rolí. Opravena synchronizace sondy;
  nový nativní běh používá stejný backend/AppImage, 27/27 PASS.
- `failed-08f-full-summary.json`: původní paralelní celý běh **FAIL**,
  400 PASS / 14 FAIL / 1 TIMEOUT, s otiskem zachovaného původního reportu.
  Dílčí zelené kontroly ani následný sériový PASS nepřepisují toto selhání.
- Vlastní starší `0efdf04a` soak byl po opravě backendu zastaven, není PASS.
  Cizí `138e958b` soak se nezastavoval ani nepoužívá jako důkaz pro `387a490f`.

Skutečné Discord/Telegram doručení, GPU Hunt/role quality a hardware maximum
kontextu nejsou tímto paketem ověřené. Automation hold, model bindingy,
provozní DB a běžící `c84b88cd` zůstávají beze změny. 31 obecných polí je
nepodporovaných, nikoli implementovaných; staré API může pole persistovat.
CHAT personalizace a Gemma 64/96/128k zůstávají podle zadání po releasu.
