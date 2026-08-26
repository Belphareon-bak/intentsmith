# Model evaluation review remediation 2 (2026-08-26)

**Stav:** `IMPLEMENTATION_GREEN / REREVIEW_REQUIRED`  
**Vstupní review:** `96c762db..4169c59d` — `CHANGES_REQUIRED`  
**Implementační rozsah pro nové review:** `4169c59d..7bf48ece`  
**Candidate:** `7bf48ece4df71d41b3a47de451eccabc1ef65434`

Toto je bounded D-013 evidence implementačního kandidáta, nikoli nezávislé
přijetí. Stav `ACCEPTED` může vzniknout až novým nezávislým rereview uvedeného
rozsahu. Raw logy a `report.json` zůstávají pouze v ignorovaném
`.intentsmith-artifacts/` čistého gate worktree.

## Uzavření review nálezů

### Upgrade-safe migrace

- Původní aplikované identity 081/081/082 jsou znovu kanonické. Omylem
  zavedené 084/085/086 nemají vlastní migration soubory ani druhé spuštění;
  runner umí pouze jejich přesně vyjmenovanou atomickou adopci zpět.
- Adopce zachovává `applied_at`, odstraní jen redundantní shodný stamp a celá
  transakce se vrátí při chybějícím cíli nebo kolizi.
- Numeric-slot guard kontroluje nejen manifest, ale i již uložené
  `schema_migrations`; historická M2 kolize 070 proto zůstává explicitní
  integrační blocker, ne tichý merge.
- Testy pokrývají accidental-only DB, canonical+redundant DB, rollback adopce,
  starý 96c-style upgrade a uloženou kolizi 070.
- Importní preflight 082 porovnává celý kanonický importovaný řádek včetně
  suite version/contractu, role, statusu, skóre a počtů, JSON payloadů, chyb,
  obou timestampů a source `validated_at` před odstraněním v123 tabulek.

Živá DB byla změněna jen předchozí bezpečnou adopcí po záloze; tento checkpoint
ji už pouze četl. Aktuální stav:

| Kontrola | Výsledek |
|---|---|
| `PRAGMA quick_check` | `ok` |
| v123 tabulky | `0` |
| durable bindingy | `7` |
| kanonické stampy | policy 081 `2026-08-25 20:14:48`; proof 081 a 082 `2026-08-25 20:17:55` |
| `data/c3.db` SHA-256 | `e22d580f26b9b467eb2bf3774524206b3d95a36cdcdbc3902a08046e9e12c088` |
| pre-adoption záloha | `c3-pre-canonical-migration-adoption-20260826T205647+0200.sqlite`, SHA-256 `aa956f3f0e28bebe6b7796eb96bb32e914d2022c922a209289a89a718f0db0c8` |

### Pravdivá binding autorita a dostupnost serveru

- Rehydrate failure zastaví startup před baseline zápisy a routami.
- Baseline vždy pozoruje runtime model i provider exact digest, také pro již
  existující desired řádek. Runtime/name nebo digest drift DB nepřepíše.
- Nedostupný provider nebo baseline drift zachová přijaté B-14 chování:
  nemodelové route běží, LLM vrátí typed 503 a evaluation API zveřejní
  `bindingAuthority.status=DEGRADED` s konkrétními failures.
- Registry nikdy neodvodí `DURABLE` jen ze sedmi DB řádků. Vyžaduje explicitní
  startup receipt všech sedmi rolí a průběžně nepřekryje runtime projekci
  neshodným desired stavem.
- `ModelEvaluationReadModel` povolí `READY_FOR_MANUAL_BINDING` jen při
  `DURABLE`; jinak připravený kandidát dostane
  `BINDING_AUTHORITY_DEGRADED`. Portfolio blocker zůstává viditelný jako
  `PORTFOLIO_NOT_APPROVED`.
- Standalone CLI runtime serveru nepozoruje a poctivě hlásí
  `UNVERIFIED_RUNTIME`. Studio zobrazuje binding status/reason a neakční stav.

### Další review body

- Setup schema v2 deep-merge doplňuje všech sedm rolí, známé v1 defaulty
  migruje na současné portfolio a skutečný uživatelský override zachová.
- Studio fallback obsahuje všechny čtyři artefakty installer portfolia.
- Čtyři required ACTIVE T3 programy a jejich harness kontrolují přesně
  `Object.values(config.models)`, ne již neinstalovaný deepseek prerequisite.
- 082 exact-import collision test odmítá shodné staré subset pole s odlišným
  contractem, metadaty nebo časem a v123 tabulky při chybě zachová.

## Focused evidence

Všechny příkazy byly bez živého modelu/GPU:

| Příkaz | Výsledek |
|---|---|
| `node tests/m1-model-binding-application.test.js` | exit 0, 109 PASS |
| `node tests/model-evaluation-read-model.test.js` | exit 0, 9 PASS |
| `node tests/model-registry-current-authority.test.js` | exit 0, 13 PASS |
| `node tests/m1-studio-client.test.js` | exit 0, 124 PASS |
| `node tests/capability-01-server-behaviours.test.js` | exit 0, 14 PASS |
| `node tests/routes-smoke.test.js` | exit 0, 109 PASS |
| `node scripts/validate-test-registry.js` | exit 0, 384 runnable programs |
| `node tests/artifact-validation.test.js` | exit 0, 151 PASS |
| `git diff --check` | exit 0 |

Registry SHA-256 je
`a2c4d29e6bcc09bea6fc3baca03c339bbb79a662b0b1a2f6dbebce9116948fd3`.

## Čistá deterministická brána

Čistý detached worktree měl před i po běhu prázdný `git status --porcelain`
a přesný HEAD kandidáta. Příkazy a exity:

```bash
git worktree add --detach /tmp/intentsmith-model-remediation-gate-7bf48ece \
  7bf48ece4df71d41b3a47de451eccabc1ef65434
# exit 0

(cd /tmp/intentsmith-model-remediation-gate-7bf48ece && npm ci --offline)
# exit 0; 233 packages; audit 0 vulnerabilities

(cd /tmp/intentsmith-model-remediation-gate-7bf48ece && \
  C3_LOG_LEVEL=error npm run test:deterministic)
# exit 0
```

| Pole | Hodnota |
|---|---|
| run ID | `2026-08-26T19-14-07-510Z` |
| source revision | `7bf48ece4df71d41b3a47de451eccabc1ef65434` |
| profiles | `offline,database` |
| concurrency | `1` |
| verdict | `PASS` |
| status | `227 PASS / 0 FAIL / 0 TIMEOUT / 0 BLOCKED / 0 SKIPPED` |
| required failures / blockers | `0 / 0` |
| start / end UTC | `2026-08-26T19:14:07.538Z` / `2026-08-26T19:15:40.688Z` |
| report SHA-256 | `52fe925c069828310fe87cfcef3bae2a3e3c11a46b8e95d47bb25dc9110dd75a` |
| inventory fingerprint | `d486a8c01286406a2d24fc642a6678b5edcaa4e6f4bdd63464ca2c6d5cfce1f4` |
| options fingerprint | `b6c9a55d1eef4edd4cd3c3fc691fe87947b8aad52dc7249c05af5a41fed7db4e` |

Před validním během byl jeden chybný launcher spuštěn z hlavního checkoutu.
Runner jej před prvním testem odmítl kvůli cizímu untracked souboru; nejde o
testovací FAIL ani gate evidence. Kandidáta nezměnil. Validní výsledek výše je
jediný uváděný verdict.

## Aktuální lokální panel a GPU hranice

Read-only CLI snapshot po gate:

- 13 installed exact artefaktů, tedy 91 artifact/role buněk;
- 40 `COMPLETE`, 17 `BLOCKED`, 34 `MISSING`, 0 `FAILED` pod současnými
  contracty;
- 33 decisions, 0 actionable; DB má 0 `activationEligible=true`;
- raw historie má 92 COMPLETE a 178 BLOCKED, ale staré contracty nejsou
  current evidence a do předchozích čísel se nepočítají.

Scoring všech lokálních artefaktů tedy není dokončený: 34 current-contract
buněk zůstává `MISSING`. V tomto remediation běhu nebyl spuštěn žádný T3,
Ollama inference, pull ani GPU job. `ollama ps` a NVIDIA compute seznam byly
prázdné. Každý budoucí hunt musí zůstat sériový, přijmout jen 100% GPU
residency a při nedostatku VRAM skončit `BLOCKED/CANDIDATE_VRAM_FIT_FAILED`
se `score=NULL`; CPU/RAM offload není povolen.

Systemd service míří na současný checkout a jediný příkaz
`model-upgrade-hunt.js --run --limit=2 --keep-inconclusive --scheduled`.
Timer je enabled, ale během implementace i tohoto evidence snapshotu zůstal
záměrně inactive; service je inactive. Obnovení plánování patří až za nové
nezávislé přijetí, aby během review neměnil živou DB ani GPU stav.

## Review handoff

Nové review má posoudit `4169c59d..7bf48ece`. Commit `4a99e1d0` opravuje
migrace, exact import, wizard/Studio/T3 a přísné startup ověření; commit
`7bf48ece` zachovává B-14 dostupnost přes explicitní `DEGRADED` autoritu a
blokovanou actionability. M2 slot 070 zůstává samostatný integrační blocker a
není vydáván za vyřešený tímto WP.

