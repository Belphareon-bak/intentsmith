# Registrace dvou funkčních project-app sad, 1. 10. 2026

**Autorita:** explicitní zadání integračního vlastníka registrovat dvě přijaté
app sady podle požadavku operátora dokončit a ověřit skutečné projekty.
Jde o běžnou registraci existujících testů; produktové chování se nemění.
**Výchozí integrační zdroj:** `03c82d7e43e0d2831e8da3877476e2e4af8ed74e`.
**Vlastník:** `/root/full405_diagnosis`.
**Stav:** `REGISTRATION_VERIFIED / INTEGRATION_REVIEW_PENDING`.

## Vlastněný rozsah

Pouze `tests/registry.json`, autoritativně generovaný
`docs/convergence/TEST-REGISTRY.md`, aktuální počet v `README.md`, registry/LOC
census v `SYSTEM-MAP.md` a tento WP. Root současně vlastní
`WP-PROJECT-APP-FUNCTIONAL-20261001.md`; jeho pracovní změny se necommitují.

Přidané záznamy:

| Suite ID | Profil | Skutečné potřeby |
|---|---|---|
| `IS-T1-TESTS-PROJECT-APP-ACCEPTANCE-TEST` | T1 offline | bwrap, git, prlimit; in-memory SQLite ABI probe v runner preflight |
| `IS-T1-TESTS-PROJECT-APP-M2-FUNCTIONAL-TEST` | T1 database | soukromá SQLite, bwrap, git, prlimit, samostatný Node restart |

Obě jsou `ACTIVE + required`, síť `none`, server/Ollama/GPU `false`.
`lastGreen.commit` a `lastGreen.artifact` jsou `null`: tato registrace není
nový funkční běh a nepřipisuje starší autorovu evidenci novému source SHA.
Acceptance zůstává v offline profilu; jeho explicitní SQLite/Git potřeba
pochází z reálného volání no-inference runner preflight.

Jediný nový exclusion je `tests/helpers/project-app-reference.js`: importované
referenční moduly pro obě offline sady, bez samostatného testovacího vstupu.
Nevstupují do fyzického modelového journey.

## Měřená delta a statické kontroly

Výchozí registry validator skončil exit `1` výhradně za dva neregistrované
app programy a jejich helper. Původních **591 descriptorů a 31 exclusions**
jsou zachované beze změny; žádný není odstraněný. Přibyly přesně **2 sady
+ 1 exclusion**. Registry má **593 sad / 32 exclusions**, stavy
**495 ACTIVE / 83 BLOCKED / 0 KNOWN_DEFECTIVE / 15 HISTORICAL**.
Profily: offline **321**, database **86**, server **64**, model **86**,
soak **16**, manual **20**. Server/model membership ani M6 plán se nemění.

Fingerprint:
`bc1e55a9ca6f68b32a8e6ca1bbbdb9f55bbb724d667769a5bf3d9ef074a8085d`.

Census stejným algoritmem jako `artifact-validation.test.js`: skutečné
regulární `.js` soubory rekurzivně, bez symlinků, počet LF v bytech:
`src`: **681 souborů / 234 011 řádků**;
`tests`: **598 souborů / 264 848 řádků**.

Projekce vznikla existujícím
`node scripts/validate-test-registry.js --write-doc` a následná `--json`
kontrola mají skutečný exit `0`. Syntaxe dvou app sad a helperu, přesná
preservation kontrola a `git diff --check` mají skutečný exit `0` na
Node `24.21.0`; konkrétní záznamy zůstávají v ignored
`.intentsmith-artifacts/project-app-registration-03c82d7e`, včetně
`preservation-static.json` a `final-static-exits.json`.

DB census `183 / 108` v mapě je výslovně omezený na dříve měřenou čerstvou
kanonickou DB. Není znovu měřený tímto WP ani zobecněný na historické
instalace s podporovanými dodatečnými záznamy `061/062/068`.

## Předání

Root nezávisle zkontroluje registraci a na čistém HEAD spustí společnou
registrovanou app/artifact/M6 bránu. Tato evidence je **REGISTRATION**,
není release/model/CHAT přejímka. Source, chat, kontrakty, produkční DB,
služby a modely se tímto během nemění; inference nebyla spuštěna.

## Root registration review and actual combined red gate

Root independently confirmed all 591 original descriptors, all 31 original
exclusions, unchanged source/contracts trees and unchanged server/model
membership. Exactly two new suites and one helper exclusion were added;
new lastGreen fields remain null. Additive registration is **REVIEW_PASS**.

Actual registered combined gate on clean `7bb3b619` ended **FAIL: 6 PASS /
2 FAIL / 0 BLOCKED/TIMEOUT/SKIPPED**, report
`2026-10-01T08-37-47-117Z/report.json`. Both app suites and four M1-schema/M6
suites passed. Artifact-validation rejected the renamed DB table label in
SYSTEM-MAP; the documented qualifier is now retained in its paragraph while
the machine-checked row label is restored exactly. Its assertion is unchanged.
Harness-exit-code rejected 142 database-reachable roots against its pinned
141. Root independently extracted the existing analysis helper: the sole
new reachable root is project-app-m2-functional, all roots are protected,
removing the two app entry points restores 141, and removing the new root's
static bootstrap exposes precisely that root as unprotected. Private receipt:
`project-app-registration-03c82d7e/root-census-review.json`.

This follow-up extends the bounded owned scope by
`tests/harness-exit-code.test.js`: only the reviewed count 141→142 and its
three-line explanation change. The unprotected, mutation and process-exit
assertions remain unchanged. SYSTEM-MAP LOC is remeasured after the comment
change. No product source, contract, registry descriptor, CHAT behavior,
model or production data is changed. The failed combined report is retained;
a new clean registered gate and review of this narrow follow-up are pending.

The repeated clean gate on `226c0e71` ended **FAIL: 7 PASS / 1 FAIL**,
report `2026-10-01T08-41-09-930Z/report.json`. Harness coverage now passes;
artifact-validation caught a missing separator comma in root's LOC formatter.
The measured 264,851 total was correct. The exact machine-readable comma is
restored without changing the validator or any source byte count. This failed
report also remains preserved; the final clean gate is still pending.
