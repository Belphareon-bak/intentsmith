# Projektový blueprint a web runtime — 2026-09-12

Stav: `IMPLEMENTED_CANDIDATE / REVIEW_REQUIRED / ACCEPTANCE_BLOCKED`.
Input `0211fde97ee5f2ab79278720f4487a50e8c35a13`; runtime/UI/HTTP source
`d09c9998d6d1bc41c61bdae0de8ae34cd18e64fd`; finální source včetně testové
optimalizace `877a3005f247af9a95f7c716897502a38b8088f1`.

Práce proběhla ve stávajícím `intentsmith-audit-20260911-FNF2jj/snapshot`,
branch `work/audit-remediation-20260911`; nevznikl další checkout. Root vlastnil
builder, Studio a následnou optimalizaci dvou testových setupů. Souběžný
webový writer přidal skutečné socket/DB scénáře, druhý proud provedl read-only
architektonickou kontrolu. Dodatečná kontrola prověřila transakční kompatibilitu
obou testových setupů. Nic z toho není nezávislé Opus acceptance.

Cizí hunt checkout se při pozorování posunul z `fe064ee8` (dirty) na `dbf1abfc`
(clean). Nebyl změněn ani integrován. Žádná inference, GPU, modelový pull,
změna bindingu, veřejné HTTPS, produkční DB, podpisy, release ani push.

## Ověřený výsledek

| Důkaz | Source | Výsledek |
|---|---|---|
| Celý deterministic profil | `877a3005` | **353/353 PASS**, 0 FAIL/TIMEOUT/BLOCKED/SKIPPED |
| Lifecycle service | `877a3005` | **53/53 PASS**, včetně šesti modulů, rollbacku a nového procesu |
| Studio VM / M2 routes | `877a3005` | **24/24 + 14/14 PASS** |
| Web DB/transport | `877a3005` | **23/23 PASS**, včetně dvou skutečných SQLite procesů |
| Effect broker / lifecycle authority | `877a3005` | **56/56 + 13/13 PASS**, 1445 ms / 839 ms v celém profilu |
| Skutečný HTTP server | `d09c9998` | **2/2 programy**, 27 lifecycle assertions + 7 webových případů |
| Studio build | stejné Studio bytes jako `d09c9998` | **PASS**, 51,13 s, build consumer ověřen |
| Skutečné Electron programy | `d09c9998` | **2/2 PASS**, procesy i privátní Xvfb ukončeny |
| Registry / artifact / module ratchet | runtime a finální dokumentační kontrola | **PASS**, 515 programů / 158 artifact případů / 1321 hran |

Finální profil běžel na čistém `877a3005`. HTTP a Electron mají skutečný pin
`d09c9998`; `git diff d09c9998..877a3005 -- src c3-ide` i příslušné HTTP/UI,
webové a lifecycle-service testy jsou prázdné. Nejnovější commit mění pouze
setup dvou dalších testových programů, WP a census. Studio build proběhl ještě
před runtime commitem nad přesně stejnými Studio bytes; výsledek ověřil
`verify-m1-consumer-build.js`. Všechny piny zůstávají odlišeny.

Celý registry zůstává 515 programů, fingerprint
`bb85f822d48d34e3a09297b026583ce808bfb05d28c764935e1c67481e7d2ad6`.
Module baseline zůstává 1321 hran / 3 cykly / 28 členů bez nového páru.
Census: src 605 JS / 222 957 ř.; tests 521 JS / 242 160 ř.

## Co testy skutečně dokazují

Šestisouborový service scénář používá řízené modelové odpovědi, skutečnou
SQLite, Git, governance a sandboxový behaviorální test. Generování jde
`totals → validate → storage → service → cli → app`, zatímco plán je řazen
kanonicky. První chybná dependency nebo chybný entrypoint způsobí neúspěšný
test a vrácení všech cílů. Po close původní DB nový Node proces ověří shodný
result digest, právě jeden terminál a nulový replay generování. Tím je
prokázán restart po dokončení, ne zotavení z pádu uprostřed efektu.

Skutečné HTTP má 27 lifecycle assertions (včetně nových guardů) a 7 webových
případů: 5 lokálních TLS/socket scénářů plus dva skutečné chat/controller
scénáře. Lokální TLS fixture výslovně mapuje DNS/IP na loopback; ověřuje TLS
validaci a stream, nikoli veřejný server. DB test má skutečný dvouprocesový
claim race, oddělený od socketového testu. Studio VM, Electron, HTTP a řízená
service generace nejsou jeden spojený uživatelský modelový journey.

## Zachované neúspěchy a testová optimalizace

Na `d09c9998`: první celý profil `project-build-web-20260912-01` má
**352 PASS / 1 TIMEOUT** (`m2-effect-broker-v1`, 30 331 ms). Druhý celý profil
`02` má **351 PASS / 2 TIMEOUT** (stejný broker 30 058 ms a
`m2-lifecycle-authority-repository` 30 048 ms). Žádný assertion FAIL;
oba profily jsou přesto neúspěšné a zachované celé. Druhý proběhl bez souběžného
Electronu, takže pouhý souběh neprokazuje příčinu.

Izolované on-disk měření stejného přípravného kódu z `d09c9998` ukázalo:

| Setup | Původní jednotlivé DDL commity | Jedna transakce | Rovnost |
|---|---|---|---|
| Effect broker | 28 928 ms, 9 338 ms | 47 ms, 95 ms | všech 107 sqlite_master objektů |
| Lifecycle authority | 7 551 ms | 82 ms | všech 115 sqlite_master objektů |

Obě varianty zachovaly foreign_keys=1, synchronous=2 (FULL), journal_mode=delete
a po inicializaci neměly otevřenou transakci. Přípravný SQL je stejný, změnil
se počet commitů při instalaci prázdné fixture. Žádný dosavadní SQL příkaz ani
assertion nebyl odstraněn; normalizované porovnání je v
`fixture-change-check.json`. Testované efekty/approvaly/reopen okna jsou mimo
setup transakci, původní 30s limity zůstávají. Čtecí kontrola migrací potvrdila
kompatibilitu, produkční migrátor už sám používá transakce. Pozorované čekání
hostitele na I/O zůstává environmentálním údajem, ne uzavřenou root-cause analýzou
hostitelského úložiště. Následný celý profil je samostatný běh, ne slepený PASS.

Původní cílené logy také zůstaly: service-01/02 měly 48 PASS / 3 FAIL kvůli
špatnému testovému očekávání Git message a potom jeho digestu; správný kontrakt
obsahuje hash kanonicky JSON serializovaného stringu. Studio-01 mělo 22 PASS /
2 FAIL, protože nová fixture předstírala success bez požadovaného result auditu.
Test teď dodává platný failed terminal, transportní validace se neoslabila.
Routes-02 má 13 PASS / 1 FAIL a reprodukuje nově objevenou HTTP 500 pro cycle;
opravena typed 400. Build a pozdější cílené běhy prošly.

## Reprodukce

```bash
node tests/m2-lifecycle-application-service.test.js
node --test tests/m2-lifecycle-studio-surface.test.js
node tests/m2-lifecycle-routes.test.js
node tests/conversation-web.test.js
node tests/m2-effect-broker-v1.test.js
node tests/m2-lifecycle-authority-repository.test.js
npm run test:registry
node tests/artifact-validation.test.js
node scripts/module-boundary-ratchet.mjs

unshare --user --map-root-user --net -- sh -c \
 'ip link set lo up && exec node scripts/run-suites.js --keep-run-root --suite=IS-T3-TESTS-CONVERSATION-WEB-HTTP-TEST,IS-T3-TESTS-M2-LIFECYCLE-HTTP-E2E-TEST'

LC_ALL=C INTENTSMITH_PDF_PYTHON=/home/belphareon/worktrees/is-m6-operator-demo-prep-20260827/.intentsmith-artifacts/pdf-runtime/bin/python \
npm run test:deterministic -- \
 --allow-blocker=toolchain:git --allow-blocker=toolchain:bwrap \
 --allow-blocker=toolchain:bubblewrap --allow-blocker=toolchain:prlimit \
 --allow-blocker=toolchain:python-pdf-runtime \
 --run-id=project-build-web-20260912-03 --out-dir=.intentsmith-artifacts/audit
```

Použijte nový run-id, aby nevznikl pokus přepsat zachované důkazy. Pro Studio:
`corepack yarn build` v `c3-ide/`. Oba skutečné Electron programy spustil
archivovaný `run-project-build-studio.py` s privátním Xvfb, skrytými GPU devices
a vlastními izolovanými procesy. Oba process groups i Xvfb jsou ukončené,
port files odstraněné. Nejde o nový fresh-clone release důkaz.

## Přenosné důkazy

| Artefakt | SHA-256 |
|---|---|
| `.intentsmith-artifacts/audit/project-build-web-20260912-01/report.json` | `0212a0689d204dff5ffbe827b214b8bb11235999cebfcc6ca19d43f67e0019a8` |
| `.intentsmith-artifacts/audit/project-build-web-20260912-02/report.json` | `369ae47d4e7a4d28d666da64ebba85d189aa96017a24d81395b4056dda21243a` |
| `.intentsmith-artifacts/audit/project-build-web-20260912-03/report.json` | `30aba1bbc194282712ecbc904df7cbb922b8a36c30dec2e501eb7ec5da985eaa` |
| `.intentsmith-artifacts/run-suites/2026-09-12T07-56-17-290Z/report.json` | `e4514bce5cdba2d59e1383f77d97b9022a8ed71e56cae5838f899a933011f903` |
| `.intentsmith-artifacts/project-build-studio-runtime-20260912/result.json` | `5b478837cccb4bf536daa2b1122527351e1a0455fc8828396b3d235677457794` |
| `.intentsmith-artifacts/project-build-web-evidence-20260912.json` | `d82569f48c9b461e67f785a3e136b9aff4b040cbdaf5bbfac6cea15bf8934b22` |
| `.intentsmith-artifacts/project-build-web-evidence-20260912.tar.gz` | `2a474e752f74ac3f01557caf3d7a67068f628600ab8c2db3c7d1f1e3d207278a` |

Ověřeno 1111 artefaktů, 1059 auditních logů a 19 source souborů. Archiv má 1205086 B.


Archiv obsahuje reporty/logy, setup-profiling a source manifest má přesné
bytes z Git objektů. Neobsahuje produkční DB ani Xauthority. Všechny logy
všech tří úplných profilů jsou znovu hashované; každý člen archivu je znovu
porovnán. Bundle je `.intentsmith-artifacts/intentsmith-project-build-web-review-20260912.bundle`;
final HEAD, jeho hash a ověření uvádí
`.intentsmith-artifacts/project-build-web-handoff-20260912.json`.

Zbývající práce a přesný rozsah review:
[review packet](../../review/2026-09-12-PROJECT-BUILD-WEB-REVIEW-PACKET.md).
