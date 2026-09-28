# Core completion — technická integrace 2026-09-09

Produktový kandidát: `70eef905b9f779958a5ce908d6ed03fac53602f9`.
Tree: `8776f4d335fffdb948a82660a993226572af8a3c`.
Scope: [WP-CORE-COMPLETION-20260909](../../wp/WP-CORE-COMPLETION-20260909.md).
Review: [nezávislé výsledky](../../review/2026-09-09-CORE-COMPLETION-REVIEW.md).
Verdikt plného deterministic běhu: **FAIL**, 351 PASS / 1 FAIL / 0 TIMEOUT /
0 BLOCKED / 0 SKIPPED. Toto není M5/M6/M7 acceptance ani release attestation.

## Výchozí stav a skutečné změny

Vlastněný checkout je `/home/belphareon/worktrees/is-mobile-completion-20260908`,
větev `work/mobile-completion-20260908`. Čistý vstup `2f11e911` navazoval na
měřený merge `f7f78d5a`. Scope commit je `c68dc352`; produktový merge
`70eef905` přebírá celý čistý B `0b0a4669` a uzavírá tři konkrétní vady:

1. Systemd renderer i runtime odmítají procentní suffix a neplatnou IP.
   Původní normalizátor suffix odřezával, zatímco renderer emitoval původní
   hodnotu; šlo vložit další systemd/environment obsah.
2. Android source manifest renderuje index ve skutečném transport mode a
   validator navíc přímo hashově porovnává deklaraci s APK indexem. APK/AAB
   manifesty dříve souhlasily se stejným chybným generátorem, nikoli s indexem.
3. Privacy scanner vyjímá pouze přesný veřejný credential filename v jediné
   byte-pinned deklaraci a cestě. Ostatní literály zůstávají kontrolované.

Main checkout `832db06f` s cizími změnami, B checkout, cizí procesy a předchozí
artefakty zůstaly zachované. Bylo evidováno 29 worktrees a žádný bezpečně
retirable; nevznikl další registrovaný worktree. Disposable klony slouží jen
ověření tohoto kandidáta. Nebyl proveden push, systémová aktivace ani živý LLM/GPU.

## Připnuté ověření

Registry: 512 programů, 418 ACTIVE / 79 BLOCKED / 15 HISTORICAL;
413 ACTIVE + required, deterministic 352 = 279 offline + 73 database.
Fingerprint:
`17fbf752d7dfd6ddbc2da8f331c482db1ec968a50243f4f9cf41ef524d998a47`.
Raw kořen v owned checkoutu:
`.intentsmith-artifacts/core-completion-20260909/`.

| Kontrola | Výsledek | Raw evidence |
|---|---|---|
| Privacy regrese | 20/20 PASS | `focused/m5-privacy-remediation.test.log` a full-gate log |
| VPN/runtime/renderer regrese | 13/13 PASS | `focused/m7-vpn-runtime-config.test.log` a full-gate log |
| Android release boundary | 19/19 PASS | `focused/mobile-android-release.test.log` a full-gate log |
| JS canonical parity | 11/11 PASS | `focused/m7-canonical-json-parity.test.log` a full-gate log |
| Artifact metadata integrita | 158/158 PASS | `focused/artifact-validation.log` a full-gate log |
| Module ratchet | 13/13 PASS | `focused/module-boundary.log` a full-gate log |
| DB harness census | 105 root / 126 DB-reachable, anchor-negative PASS | `focused/harness-census.log` a full-gate log |
| Browser accessibility | 24/24 PASS | nový full-gate mobile-browser log |
| Mobile gate / registry | 47/47 PASS / 512 programů valid | `focused/mobile-gate.log`, `focused/registry-final.log` |
| Inertní M7 unit | `systemd-analyze --user verify` exit 0 | `m7-systemd-verify/result.json`, žádná instalace |
| Nový APK/AAB build | PASS, 14 s | `android/` logs |
| Offline JVM / lint | 4 M7 + 1 template PASS; 0 errors / 16 lint warnings | `android/reports/` |
| Runtime dependency audit | 0 reported vulnerabilities | retained Android bundle |

Skutečný privacy scanner na čistém `70eef905` vrátil exit 0,
`PASS_CURRENT_TREE_HISTORY_REMEDIATION_REQUIRED`, current tree PASS / 0 findings.
Všech 13 historických incidentních objektů zůstalo reachable; bylo 453 declared
refs. Raw `privacy-70eef905.json` nepovyšuje neprovedené rotace/custody/history
disposition na PASS. Původní false-positive scan zůstává v `privacy-baseline.json`.

## Dva úplné běhy a oprava prostředí

První čistý klon byl pod dlouhou cestou
`<owned>/.intentsmith-artifacts/core-completion-20260909/runtime/repo`.
Výsledek **349 PASS / 3 FAIL** zůstává v
`full-gate/core-completion-70eef905/report.json`. Dvě neočekávaná selhání:

- `m2-execution-process-supervision`: inside-project socket měl 151 bajtů.
  Host-only probe `unix-socket-probe.json` doložil zkrácený kernel socket path
  a `ENOENT` pro plnou cestu. Nešlo o změnu sandboxu; test i obě produktové
  implementace jsou proti `f7f78d5a` byte-identické.
- `e2e-harness-isolation`: údajně public fixture odvozená z rodiče klonu
  stále ležela pod `.intentsmith-artifacts`. Helper správně prošel první
  containment check a selhal až na neexistujícím adresáři. Test a oba helpery
  jsou proti `f7f78d5a` byte-identické.

Nový fyzický klon `/home/belphareon/is-cc09-st5rx2jd/repo` je krátký a nemá
privátní artifact komponentu v předcích. Obě nezměněné sady nejprve prošly
auditorovým `short-probe` 2/2 PASS. Poté proběhl celý 352programový profil,
2026-09-09 10:07:32.639–10:11:42.293 UTC, **351 PASS / 1 FAIL**, exit 1.
Report `core-completion-short-70eef905/report.json` má SHA-256
`6e7a6453f086b6b253a443745660d5bf012c8e5c6f6ad73aa570c5afed825e10`.
Přesné původní umístění je `short-clone.json`; uchování a případné přemístění
raw bundle se eviduje odděleně, reporty se kvůli cestám nepřepisují.

Po dokončení nezávislého review byly obě vlastní disposable kopie odstraněny.
Všechny regular files/symlink metadata z jejich artifact kořenů byly předem
zkopírovány a byte/hash ověřeny: 6 526 položek krátkého klonu a 20 Android
klonu. `artifact-preservation.json` drží úplný manifest a původní/nové cesty.
Nový full report je nyní pod
`retained-clones/short/.intentsmith-artifacts/gates/core-completion-short-70eef905/report.json`
v raw kořeni tohoto běhu; jeho bytes/hash zůstaly beze změny. Žádný cizí
worktree nebo předchozí neúspěšná evidence nebyly odstraněny.

Instalace v obou klonech: `npm ci --offline --no-audit --no-fund`, 233 packages,
Chromium cache byla byte-copy z existujícího owned dependency kořene.
Ověřovací příkaz v krátkém čistém klonu:

```bash
LC_ALL=C INTENTSMITH_PDF_PYTHON=/home/belphareon/worktrees/is-m6-operator-demo-prep-20260827/.intentsmith-artifacts/pdf-runtime/bin/python node scripts/nightly-audit.js --profile=offline,database --allow-blocker=toolchain:git,toolchain:bwrap,toolchain:bubblewrap,toolchain:prlimit,toolchain:python-pdf-runtime --run-id=core-completion-short-70eef905 --out-dir=.intentsmith-artifacts/gates
```

Jediný zbývající FAIL je `IS-T1-TESTS-NIGHTLY-ORCHESTRATOR-SELF-TEST`:
`registry hash differs from the reviewed Gate 0 policy`. Sealed B policy
zahrnuje 351 deterministic programů; společný locale inventář přidává jeden.
Podle CONTRACT §8 se nový release ratchet přijímá až nad zmraženým M6
kandidátem. Test nebyl vyřazen a policy nebyla přepsána pro zelený výsledek.

## Skutečné Android bytes

Retained 17-file bundle v owned checkoutu:
`.intentsmith-artifacts/mobile-release/70eef905b9f7-KWGSVY/`.

| Objekt | SHA-256 |
|---|---|
| `manifest.json` | `b7333b63c95d39b43b5891d039e6608e2697527352f6c2143296adc2146f2598` |
| APK | `f7eb4943f94d11076b44f2358e06c350cba976c5ba40573570b1e4c6fc93635c` |
| AAB | `819084ffb80b6df14ff5a155832d2e1dabbda572dae6fbeafb4fe388daeecbad` |
| Skutečný i deklarovaný generated index, oba archivy | `6935b7961de19148da0aa4f4b011c02aab7b37eb3b05c8a7a5baead8f1b96e13` |

Oba archivy připínají přesný source SHA, package `cz.intentsmith.companion`,
version 1.0/code 1, targetSdk 36. Classification je `THROWAWAY_DEBUG_SIGNED`,
synthetic VPN origin/SPKI, `runtimeEvidence:null`, `releaseTransportReady:false`.
Toto neopravňuje instalaci/distribuci jako produkční release. Starý bundle
`f7f78d5a113d-V2FryZ` zůstává historický a jeho chybný declared index hash
nebyl zpětně upraven.

## Následující skutečná závislost

[Konkrétní provider activation a rollback návrh](m6/core-provider-activation-proposal-20260909.md)
je připravený samostatně; aktivace neproběhla. Dále zbývají M5 externí
rotace/custody/history, aktuální modelové ověření, celý M6 gate, 24h soak,
nezávislé release review, demo a podpisy. M7 UI mapping, fyzická matice 13+7,
VPN/device/TalkBack a produkční distribuce zůstávají samostatnou větví.
