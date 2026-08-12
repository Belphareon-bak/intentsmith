# WP-M1-MODEL-TERMINAL-FAILOVER — terminal automatic failover and restore

**Typ:** zapisující M1 runtime-authority WP · **Slot:** jediný writer v
izolovaném disk-backed worktree

**Rozhodnutí:** [006/D+](../decisions/006-m1-model-auto-rebind-l0.md),
[015/A](../decisions/015-m1-model-failover-proof-policy.md),
[020/E](../decisions/020-m1-model-failover-opt-in-surface.md),
[024/A](../decisions/024-m1-proof-issuer-provenance.md) a
`M1-CLOSEOUT-X1`

**sourceEvidenceRevision / baseRevision:**
`6c36607421c013dd27f41e35853009bcaa0b5b51`

**integrationRef:** `integration/m1-consolidated-20260810`

**Branch:** `wp/m1-model-terminal-failover-20260812`

**Review/promotion refs:**

- Review A: `evidence/m1-model-terminal-failover-review-a-20260812`;
- merge queue: `queue/m1-model-terminal-failover-promotion-20260812`;
- Review B: `evidence/m1-model-terminal-failover-review-b-20260812`;
- report: `docs/execution/runs/wp-m1-model-terminal-failover-20260812-report.md`.

**Stav:** `ACTIVATED / IMPLEMENTATION_NOT_STARTED`. 026 a oba sériové 029
subjecty jsou na exact canonical tipu promovány s Review A/B PASS. Aktivace
tohoto WP není důkazem terminal effectu, nového proofu, GPU residency ani Gate
1 PASS.

## 1. Uživatelský výsledek

Po explicitním opt-inu může runtime pro jednu roli použít pouze operátorem
připnutý, lokálně instalovaný fallback s exact requested name, canonical name
a digestem. Aktivace vyžaduje fresh same-role digest-bound proof. Durable intent
předchází runtime effectu a úspěch vznikne až po exact runtime finalize
receiptu. Nula, více, stale nebo nezpůsobilý target skončí `INCONCLUSIVE` bez
binding, provider, config nebo broadcast effectu.

Po návratu exact desired name+digest+revision smí proběhnout nejvýše jeden
restore s fresh desired proofem. Restore failure ponechá fallback aktivní jako
degraded. User binding incident atomicky superseduje a pozdní restore zakáže.
Startup přijme pouze exact active lineage; uncertain commit se reconciliuje
podle exact generation a nikdy blind replayem ani jiným kandidátem.

## 2. Přesný allowlist

**Source:**

- nový `src/db/migrations/2026_08_12_065_model_failover_target.js`;
- `src/db/model-policy.js`;
- `src/upgrade/model-failover.js`;
- `src/upgrade/model-failover-coordinator.js`;
- `src/upgrade/model-binding-application.js`;
- `src/upgrade/model-failover-proof-policy.js`;
- `src/upgrade/upgrade-manager.js`;
- `src/server.js`;
- `scripts/run-model-failover-candidate-measurement.js`;
- `scripts/issue-model-failover-proof.js`;
- nový `scripts/apply-model-failover-target.js`.

**Testy, bez nové suite a bez registry změny:**

- `tests/m1-model-policy.test.js`;
- `tests/m1-model-failover-schema.test.js`;
- `tests/m1-model-failover-repository.test.js`;
- `tests/m1-model-failover-coordinator.test.js`;
- `tests/m1-model-binding-application.test.js`;
- `tests/m1-model-failover-proof-policy.test.js`;
- `tests/m1-model-failover-parent-acceptance.test.js`;
- `tests/m1-model-failover-proof-issuer.test.js`;
- `tests/schema-migrations.test.js`.

Review A report smí jako report-only `E_A` vytvořit pouze výše rezervovaný run
report. Po immutable source subjectu není dovolena jiná docs/source/test změna.

**Zakázané:** routes, HTTP/WS connector, Studio/mobile/chat/quality, generic
settings nebo portability změna, `src/db/user-settings.js`,
`src/db/settings-portability.js`, migrace 046/062/064, model profiles nebo
validation suites, package/lock, registry, user DB/config a jiné uživatelské
soubory. Zakázaný je pull, delete, stop, unload, implicitní rebind, external
network, nová dependency a změna auth/access/trusted-local hranice.

## 3. Target, CAS a migrace 065

Migrace 065 je jediná aditivní schema změna a zavádí versioned per-role target
autoritu a append-only target event. Target obsahuje requested name, canonical
name, exact lowercase 64hex digest, revision, actor, čas a poslední event.
Jediný writer je typed CAS seam v `src/db/model-policy.js`; caller dodává
expected revision a celý exact target nebo explicitní clear. Missing/extra
pole, canonical mismatch, stale revision, neinstalled/ambiguous artifact nebo
policy OFF selžou před mutací.

Backup/import target nepřenáší a destination jej zachová. Explicitní
`SERVER_SETTINGS_V1` reset target vyčistí ve stejné dual-CAS transakci. Migrace
defaultuje na žádný target a neodvozuje jej z proof ledgeru, installed modelů,
configu ani legacy settings. „Nejnovější proof vyhrává“ je zakázaná sémantika.

Ordinál 065 je rezervovaný z union census canonical
`6c36607421c013dd27f41e35853009bcaa0b5b51` a mobile ref
`2aeaa5028d9caf731f6a51f1f6df78a5f548c511`, jejichž merge-base je
`8366eb085415149f49e04bd9e788104c4c3ec1f8`. Mobile 055–060 musí být před
source commitem znovu vloženy do disposable již migrované DB; 046/062/064 se
nesmějí opakovat ani měnit a data se nesmějí ztratit.

## 4. Terminal lifecycle a jediný runtime owner

Repository rozšíří existující claim/CAS stav o exact terminal přechody
`ACTIVATED`, `REAPPLIED`, `RESTORED`, `FAILED`, `SUPERSEDED_BY_USER` a
`DEGRADED_PROOF_EXPIRED`. Claim je role/revision/episode/operation/policy-bound;
vítězství claimu samo není runtime success. Každý terminal writer znovu ověří
target, desired revision, exact inventory digest, live proof, policy/version,
claim a nepřeskočenou row/generation CAS.

`model-binding-application.js` zůstává jediným runtime apply/finalize ownerem.
Failover koordinátor dostane frozen least-authority port, ne plný repository,
provider ani arbitrary binding API. Aktivace a restore používají durable
intent → exact provider/runtime effect → operation-bound finalize receipt.
Pozdní nebo nejasný finalize vytvoří typovaný reconciliation stav; retry smí
pouze přečíst exact generation a uzavřít stejnou operaci. Provider effect ani
alternativní target se neopakuje.

Proof expiry aktivní fallback náhle nepřepne. Stav se stane
`DEGRADED_PROOF_EXPIRED`, jednou se zaznamená/oznámí a blokuje nový
`ACTIVATE/REAPPLY`. Revalidation je pouze explicitní operator action,
`ONE_ROLE_ONE_DIGEST_SERIAL`; background renewal nevzniká.

## 5. Source closure a proof invalidace

Terminální změna `src/upgrade/model-failover.js` zneplatní jeho dnešní
raw-byte-pinned proof autoritu. Closure se nesmí odvodit jen z přímých importů:

```text
model-failover.js
  -> src/db/model-policy.js
       -> src/db/user-settings.js
       -> src/db/settings-portability.js
```

Poslední dvě cesty jsou read-only closure inputs a nejsou v allowlistu k
editaci. Candidate measurement, issuer i policy musejí exportovat a ověřit
úplnou transitivní closure exact HEAD blobů, jejich modes/bytes/digesty a čistý
candidate source. Jednořádková mobile closure oprava ani cherry-pick není
přípustná; mobile parita se dokazuje nad exact refy výše.

Po final source se operator-only vydají nové CHAT proofy jen pro exact desired
a fallback digest skutečně potřebné přijatým execution manifestem, nejvýše
dva. Conditional reissue je přípustný pouze při expiry nebo relevantním
source/digest driftu. Issuance sama nemění target, desired/active binding ani
runtime.

## 6. Commity, review a evidence fáze

Source writer použije nejvýše čtyři malé commity:

1. `S1` — migrace 065 a typed target CAS/reset authority;
2. `S2` — terminal repository/claim/CAS;
3. `S3` — jediný runtime owner, coordinator a startup reconciliation;
4. `S4` — úplná proof/source closure a finální immutable `S_B3`.

Review A posuzuje exact `G_B3..S_B3`; writer není reviewer. `E_A` je
report-only direct child `S_B3`. Candidate `C_B3` má ordered parents exact
`[G_B3,E_A]`, strom byte-identický s `E_A`, a projde fresh-clone Review B.
`E_B` přidá pouze exact dvouřádkový append a teprve metadata gate dovolí
fast-forward canonical integration.

**Phase A — implementation evidence:** offline deterministic matrix,
source-closure, mobile late-insertion, report DAG a fresh clone. Nespouští GPU,
Ollamu proti skutečnému modelu ani user-data effect.

**Phase B — execution evidence:** až nad přijatým digest-bound
`M1-EXECUTION-MANIFEST` může jeden disposable file-backed DB/runtime provést
exact target/desired happy path proti lokální Ollamě a vydat potřebné proofy.
Failure/race matrix zůstává test-owned. Skutečná user DB/config se nemění.
Failure artefakty se zachovají a Phase B se nesmí zpětně vydávat za součást
Phase A Review B.

## 7. T3 resource envelope

Je autorizovaný právě jeden registrovaný sériový T3 běh na RTX 3090 pro
`qwen3.5:27b`, digest
`7653528ba5cba4dd8e19da24aaddc7f4d0b5ecd93571c0825dfd4137958ec06e`,
`num_ctx=4096`, headroom nejméně `1024 MiB`, GPU residency `100 %` a fallback
zakázaný. Měří cold, warm, classify a mid-generation cancel. Preflight vyžaduje
prázdný `ollama ps` a žádný compute proces. Pull/delete/stop/unload/rebind jsou
zakázané; cleanup je pouze přirozená expiry. Historický `8192 FAIL` zůstává
zachovaný. Běhy jsou serializované, artefakty disk-backed mimo `/tmp` a po
každé fázi se ukončují pouze test-owned process groups.

## 8. Stop conditions a acceptance

Zastavit dotčenou část při nové veřejné capability/connectoru, změně L0,
auth/access/trusted-local hranice, external network effectu, potřebě
pull/delete/rebind, nevratném user-data zásahu, změně support claimu, nové
dependency nebo neřešitelném source conflictu. Vada uvnitř allowlistu se opraví
a nezávisle zreviewuje; rozšíření allowlistu vyžaduje vlastní dřívější docs
commit.

Acceptance vyžaduje exact target CAS a clear, zero-effect negativní matici,
single-winner races, proof expiry, user supersede, restart/rehydrate, uncertain
finalize reconciliation, exact desired restore, úplnou source closure, mobile
late insertion, Review A/B PASS a čistý candidate tree. Gate 1 zůstává
`BLOCKED`, dokud navíc nedoběhne B4 a jeho evidence; tento aktivační commit
sám neprokazuje žádný z těchto výsledků.
