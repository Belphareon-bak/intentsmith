# WP-M1 policy import/reset — Review A/B evidence

integrationRef: integration/gate1-prod-ready-20260809
baseRevision: 1d351f67428eb1c4ae1adc99ce4dd99baef608e9
subjectHead: da7abd75b52b65c909b12169c4929db4114f139b
reviewA.verdict: PASS
candidateHead: 928dd06c1b418bc093632ea8ac3964cdf95114c8
reviewB.verdict: PASS

## Rozsah subjectu

Integrační ref zůstala po celou dobu této dávky zmrazená na `baseRevision`.
Subject je lineární čtyřcommitová změna nad tímto base:

1. `09b34e30b8aa76cc9fc666f472da4a4ee9f91974` — atomický verzovaný backend
   importu a resetu nastavení;
2. `21ffa72b40603f2e334a5d388177690d55260c43` — konzumace verzované obnovy v
   autoritativním commitnutém Studio runtime;
3. `94d2a473a1f530bc49a0039307fc6f10c33261f0` — fail-closed ochrana před
   nejednoznačným doručením a pozdním přepsáním stavu;
4. `da7abd75b52b65c909b12169c4929db4114f139b` — pravdivý post-commit degraded
   výsledek i při souběžném selhání runtime aplikace a loggeru.

Změna zavádí přesné verzované portable schema, transakční zápis general
settings, model policy a jediného audit eventu, zachování tajemství, explicitní
import/reset endpointy a Studio write fence pro výsledek `DELIVERY_UNKNOWN`.
Úspěšný DB commit se po post-commit runtime chybě neprezentuje jako odmítnutá
mutace: odpověď zůstává HTTP `200` s `runtimeApplied: false`.

## Nezávislé Review A

První review nad `21ffa72b` vrátilo `CHANGES_REQUIRED`: nejednoznačný výsledek
mohl obnovit stale whole-document save a pozdní GET mohl přepsat právě
commitnutý snapshot. Druhé review potvrdilo opravu Studio hran, ale nad
`94d2a473` našlo post-commit cestu, na níž throwing logger změnil commitnutou
mutaci na HTTP `500`. Třetí review nad přesným rozsahem
`1d351f67..da7abd75` skončilo `PASS`, bez P0–P2.

Reviewer znovu ověřil, že import i reset při současném selhání runtime aplikace
a loggeru vracejí pravdivé `200`, `runtimeApplied: false`, zachovají commitnutý
stav a vytvoří dva navazující audit eventy. Studio ochrany
`DELIVERY_UNKNOWN`, generation/load token a skutečný Backup panel oracle
zůstaly zachované.

## Fresh-clone ověření remote subjectu

Ověřovací checkout:
`/home/belphareon/worktrees/is-policy-recovery-clean-da7abd75`.
Byl vytvořen z remote feature větve a před i po běhu měl čistý strom a přesný
HEAD `da7abd75b52b65c909b12169c4929db4114f139b`.

| Příkaz | Výsledek | Exit |
|---|---:|---:|
| `npm ci --offline` | 233 packages, 0 vulnerabilities | 0 |
| `node tests/m1-studio-client.test.js` | 110 passed, 0 failed | 0 |
| `node tests/m1-model-policy.test.js` | 35 passed, 0 failed | 0 |
| `node tests/routes-smoke.test.js` | 109 passed, 0 failed | 0 |
| `node tests/schema-migrations.test.js` | 38 passed, 0 failed | 0 |
| `node tests/m1-model-failover-coordinator.test.js` | 16 passed, 0 failed | 0 |
| `node tests/m1-model-identity.test.js` | 25 passed, 0 failed | 0 |
| `node tests/artifact-validation.test.js` | 151 passed, 0 failed | 0 |
| `node tests/repository-hygiene.test.js` | 1 546 tracked paths | 0 |
| `node scripts/validate-test-registry.js --json` | 378 programs, 8 exclusions; fingerprint `cb1259ca55a95ecb32bc1831fca37249c449f880c36c9f1506072fdce8d06e15` | 0 |
| `node scripts/module-boundary-ratchet.mjs` | 1 023/1 023 exact edges; 3 cycles, 28 files | 0 |
| `node tests/module-boundary-ratchet.test.js` | 13 passed, 0 failed | 0 |
| syntax checks pro Studio runtime, route a focused testy | valid | 0 |
| `git diff --check 1d351f67428eb1c4ae1adc99ce4dd99baef608e9..HEAD` | bez whitespace chyb | 0 |

Dočasná jednotlivá mutace vypnula `DELIVERY_UNKNOWN` write fence; Studio sada
skončila 109 passed / 1 failed, exit `1`, přesně na ambiguous-delivery testu.
Druhá jednotlivá mutace obešla generation/load guard; sada skončila rovněž
109/1, exit `1`, přesně na late-load testu. Obě mutace byly vráceny a checkout
zůstal čistý.

## Transparentně evidované chyby orchestrace

První wrapper při vytváření dřívějšího fresh checkoutu `94d2a473` clone
dokončil, ale následný `git rev-parse` omylem spustil z
`/home/belphareon/Projects`; wrapper proto skončil exit `128`. Checkout byl
následně ověřen samostatně. Jiný wrapper v single-branch clone ověřil HEAD a
feature SHA, ale pokusil se rozlišit záměrně nefetchnutou integrační ref a
skončil exit `128`; integrační ref byla ověřena zvlášť v hlavním feature
worktree. Nešlo o produktové ani testovací failure a finální clone
`da7abd75` těmito chybami zasažen nebyl.

## Hranice tvrzení a zbývající blockery

Původní report commit `06e760bb` potvrzoval pouze Review A a
reprodukovatelnost subjectu. Následující část připíná samostatnou integraci a
Review B. Gate 1 jako celek zůstává `BLOCKED`. Neběžel GPU/Ollama pilot,
Electron journey ani externí síť. Není doložena pozdní parita mobilních
migrací, proof issuance a migrace 062 z rozhodnutí 015 ani built-Electron cesta
z rozhodnutí 021.

## Current-integration candidate a Review B

Merge commit `55bf8e0a2d27a2f5dd6c37143651c8a10b990f48` má první parent
`c6a02e697b73231e8da5b993b26ab859700d4b9b` a druhý parent Review-A evidence
`06e760bb04933a97857ea0ab25a397914b47e60e`. Následné dva dokumentační
commity opravily pouze stale stav M1 a L0-8; výsledný immutable candidate je
`928dd06c1b418bc093632ea8ac3964cdf95114c8`.

Nezávislé bounded Review B nad exact candidate skončilo `PASS` bez P0–P2.
First-parent diff má přesně 13 schválených cest, všechny jako `100644 blob`.
Call graph vede import/reset přes jediný atomický repository commit point a
Studio rozlišuje `COMMITTED`, `REJECTED` a nereplayovatelný
`DELIVERY_UNKNOWN`. Injection i P10 artefakty jsou proti přijatému parentu
zachované.

Nový `git clone --no-local` exact candidate, následný `npm ci --offline` a
všechny příkazy níže skončily exit `0`; před instalací i po testech byl tracked
strom čistý:

| Příkaz | Výsledek |
|---|---:|
| `node tests/m1-model-policy.test.js` | 35/0 |
| `node tests/m1-studio-client.test.js` | 110/0 |
| `node tests/routes-smoke.test.js` | 109/0 |
| `node tests/schema-migrations.test.js` | 38/0 |
| `node tests/m1-model-failover-coordinator.test.js` | 16/0 |
| `node tests/m1-model-identity.test.js` | 25/0 |
| `node tests/accountant-self-contained.test.js` | 25/0 |
| `node tests/tool-adapter.test.js` | 96/0 |
| `node tests/specialist-loader.test.js` | 309/0 |
| `node tests/core-optional-map-validator.test.js` | 16/0 |
| specialist boundary ratchet + focused test | 5 balíčků / 32 souborů / 0 referencí; 19/0 |
| module boundary ratchet + focused test | 1 024/1 024; 13/0 |
| artifact validation | 151/0 |
| registry validation | 380 programů / 8 exclusions; `50d4b6d9…1b95` |
| repository hygiene | 1 558 tracked cest |
| `git diff --check` | bez výstupu |

Tato evidence přijímá pouze policy import/reset checkpoint do lokálního
integračního řetězce. Automatic failover, proof issuer/persistence, migrace 062,
mobile late-insertion parita, built negotiated Electron journey a autorizovaný
GPU pilot zůstávají otevřené; Gate 1 proto není `PASS`.
