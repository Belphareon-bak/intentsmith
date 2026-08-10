# WP-M1-PROOF-ISSUANCE — schema/ledger checkpoint evidence

- **stav:** `PARTIAL / FRESH_CLONE_VERIFIED`
- **source candidate:**
  `133040261280150df7a03bf70b8416d79188e879`
- **evidence commit ověřený v klonu:**
  `99c93ec87ec2ddc672a311f5a276c59e7fac91c1`
- **base:** `2cbed0a06c7b86d115f4da21af67751a086b8ab9`
- **větev:** `wp/m1-proof-issuance-20260810`
- **integrační remote ref při ověření:**
  `origin/integration/gate1-prod-ready-20260809 =`
  `1d351f67428eb1c4ae1adc99ce4dd99baef608e9`
- **GPU / Ollama / Electron / externí síť:** `NOT RUN`
- **PASS proof:** `NOT ISSUED`
- **automatic activation:** `OFF / BLOCKED`

## Co checkpoint garantuje

Migrace 062 přidává append-only companion ledger
`model_failover_proof_artifacts`. Každý nový proof musí být ve stejné
transakci svázán s source revision, parent runem, SHA-256 a byte length obou
immutable artefaktů a s přesnou kopií proof tuple. Proof bez exact companionu,
orphan companion při commitu, historical attach, replacement, update a delete
selžou fail-closed.

Všechny čtyři eligibility triggery nově vyžadují ledger join a používají
striktní podmínku `expires_at_ms > event/proof_verified time`. Historické
proofy zůstávají auditní data, ale nemohou získat vyrobenou provenance.
Upgrade s aktivním legacy failoverem se odmítne před první mutací schématu.
Preflight navíc pinuje očekávané tabulky, sloupce a trigger SQL a odmítá
preexistující objekty nebo foreign-key drift.

Schema checkpoint sám nevydává proof, nespouští model a nemění binding,
provider, runtime, scheduler ani broadcast.

## Ověření na commitnutém source SHA

Všechny příkazy níže běžely v
`/home/belphareon/worktrees/is-m1-proof-issuance` na čistém HEAD
`133040261280150df7a03bf70b8416d79188e879`.

| Příkaz | Výsledek | Exit |
|---|---:|---:|
| `node tests/m1-model-failover-proof-policy.test.js` | 9 passed, 0 failed | 0 |
| `node tests/m1-model-failover-measurement.test.js` | 9 passed, 0 failed | 0 |
| `node tests/m1-model-failover-parent-acceptance.test.js` | 15 passed, 0 failed | 0 |
| `node tests/m1-model-failover-schema.test.js` | 25 passed, 0 failed | 0 |
| `node tests/schema-migrations.test.js` | 38 passed, 0 failed | 0 |
| `node tests/m1-model-failover-repository.test.js` | 14 passed, 0 failed | 0 |
| `node tests/m1-model-failover-coordinator.test.js` | 16 passed, 0 failed | 0 |
| `node tests/m1-model-binding-storage.test.js` | 16 passed, 0 failed | 0 |
| `node tests/m1-model-binding-repository.test.js` | 46 passed, 0 failed | 0 |
| `node tests/m1-model-policy.test.js` | 35 passed, 0 failed | 0 |
| `node tests/artifact-validation.test.js` | 151 passed, 0 failed | 0 |
| `node scripts/validate-test-registry.js --json` | valid; 380 programů; 8 exclusions; fingerprint `50d4b6d9314301214318f738ebe7b4ed810837981a22f280da8b79eb94a81b95` | 0 |
| `node tests/repository-hygiene.test.js` | 1 561 tracked cest | 0 |
| `node scripts/specialist-boundary-ratchet.mjs --require-clean` | 5 packages; 32 files; 0 references | 0 |
| `node tests/specialist-boundary-ratchet.test.js` | 19 passed, 0 failed | 0 |
| `node scripts/module-boundary-ratchet.mjs` | 1 023 current / 1 024 baseline; 0 added, 1 removed; tightening available | 0 |
| `node tests/module-boundary-ratchet.test.js` | 13 passed, 0 failed | 0 |
| `git diff --check` | bez výstupu | 0 |
| `git status --porcelain=v1 --untracked-files=all` | prázdný výstup | 0 |

Červené logové řádky uvnitř schema sad jsou očekávané negativní fixtures;
terminální souhrny a procesní exity výše jsou zelené.

## Fresh-clone reprodukce

Tento příkaz skončil exit 0:

```bash
git clone --no-local --branch wp/m1-proof-issuance-20260810 \
  /home/belphareon/worktrees/is-m1-proof-issuance \
  /tmp/intentsmith-proof-attest-46cZjW/repo
```

Nový checkout měl před instalací přesný HEAD
`99c93ec87ec2ddc672a311f5a276c59e7fac91c1` a prázdný porcelain.
`npm ci --offline` přidal 233 balíčků, auditoval 234, našel 0 vulnerabilities a
skončil exit 0.

V klonu byly znovu spuštěny všechny příkazy z tabulky výše. Focused výsledky
zůstaly 9/0, 9/0, 15/0, 25/0, 38/0, 14/0, 16/0, 16/0, 46/0 a 35/0; artifact
validation 151/0, registry 380/8 se stejným fingerprintem, hygiene 1 562 cest,
specialist ratchet 0 referencí a module ratchet 1 023/1 024 s jedinou
odstraněnou hranou. Všechny procesy skončily exit 0. Závěrečný
`git status --porcelain=v1 --untracked-files=all` i `git diff --check` byly
prázdné, exit 0.

## Negativní mutační důkaz

Dočasná jediná mutace změnila ve všech čtyřech eligibility triggerech striktní
`>` na `>=`. `node tests/m1-model-failover-schema.test.js` poté skončil
`24 passed / 1 failed`, exit `1`, přesně na rovnosti
`now === expiresAtMs`. Mutace byla vrácena přesným patchem, izolovaný failure
runtime přesunut do koše a čistý běh se vrátil na 25/0, exit 0.

## Otevřený blocker issueru

Standalone acceptance validator prokazuje pouze `STRUCTURAL_ONLY` konzistenci.
Connector `issueModelFailoverProof({ db, acceptancePath })` proto nemůže brát
callerem lokalizovaný receipt jako provenance autoritu: vzájemně konzistentní
measurement a acceptance lze zkonstruovat bez důvěryhodného parent běhu.

Bezpečný navazující connector musí vlastnit parent orchestration pro
`(role, proposedModelName)`, držet očekávané source/policy/contract piny v
paměti, interně odvodit private store root a těsně před `BEGIN IMMEDIATE`
znovu ověřit connection-local `PRAGMA foreign_keys=ON`. Tato změna connectoru
a případný nový reusable issuer modul vyžadují nový statický Review A. Do té
doby zůstává issuer `CHANGES_REQUIRED` a žádný proof nebyl vydán.

## Integrace a paralelní vlastnictví

Remote integrační ref nebyl tímto checkpointem posunut. V jiném worktree
existuje paralelní necommitnutá implementace stejné migrace a issueru; její
soubory nebyly čtením převzaty, editovány ani mergovány. Před integrací je
nutný explicitní výběr jednoho source candidate a review rozdílů, nikoli
mechanické spojení obou implementací.

Schema/ledger checkpoint je tím `FRESH_CLONE_VERIFIED` na přesném evidence
commitu výše. Gate 1 zůstává `BLOCKED` na bezpečném issuer kontraktu,
skutečném operátorském proof běhu a dalších již evidovaných M1 podmínkách.
