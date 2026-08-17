# 032 — smíření M1 closeout evidence a authority gap bez přepsání minulosti

- **typ:** prospective docs-only governance/evidence reconciliation
- **stav:** `SELECTED_A / DOCS_ONLY_RECONCILIATION / NO_RUNTIME_AUTHORITY`
- **integrationRef:** `integration/m1-consolidated-20260810`
- **baseRevision:**
  `5b375c9e730fea2efcab3ab2549e4cd53afda5a3`
- **baseTree:** `15f89d66745a66d12e253df23c7037d09155d85d`
- **WP:**
  [`WP-M1-CLOSEOUT-EVIDENCE-RECONCILIATION`](../wp/WP-M1-CLOSEOUT-EVIDENCE-RECONCILIATION.md)
- **report:**
  `docs/execution/runs/wp-m1-closeout-evidence-reconciliation-20260817-report.md`

Operátor 2026-08-17 zvolil variantu A: nejdřív napravit canonical záznam,
nezávisle ověřit existující private evidence a teprve po promotion připravit
oddělený diagnostický preflight. Toto rozhodnutí samo nepovoluje live DB,
credential, SSH, service, display, Ollama, GPU, model, Q4 ani T3 effect.

## 1. Dvouosý verdict

Historický filesystem stav se nesmí ani skrýt, ani zpětně vydat za autorizovaný
PASS. Canonical záznam proto používá dvě oddělené osy:

```text
technical result: TECHNICAL_PASS
governance result: AUTHORITY_GAP / NO_RETROACTIVE_AUTHORIZATION
```

`TECHNICAL_PASS` znamená pouze, že zachovaný 031 bundle a dnešní read-only
kontrola dokládají očekávaný logický DB poststate. Neznamená, že před efektem
existoval povinný independent docs PASS, canonical promotion nebo exact
operátorský acceptance block. Pozdější reconciliation nesmí takovou minulou
autoritu vyrobit.

Joint execution manifest je klasifikovaný
`BYTE_VALID / CANONICAL_ACCEPTANCE_EVIDENCE_UNBOUND`. Jeho vlastní pole
`purpose=OPERATOR_ACCEPTED_PROCEDURAL_DECISION_AND_EVIDENCE_PACKET` je
self-claim, nikoli externí důkaz exact operátorské akceptace.

## 2. Canonical binding private evidence

### 2.1 031 technical-success bundle s authority gap

Root:

```text
/home/belphareon/.local/share/intentsmith-private/m1-pre-manifest-fk-recovery-20260812T204833Z-bf65915c208f4166
```

| Artefakt | SHA-256 | Hranice tvrzení |
|---|---|---|
| `plan/recovery-plan.json` | `9b9dc710fca1aef2ca7804c6de98f312e453a1c44f576b1563d181718d25c790` | bytes stále říkají `MATERIALIZED_AWAITING_EXACT_OPERATOR_ACCEPTANCE` |
| `plan/recovery-plan.sha256` | `481c0479db5e2c245671a545a78690dd642c559668547543dc3a8c963cfefafb` | detached digest file |
| `evidence/artifact-manifest.json` | `8f77af6174f642a7ae788b2fefba7f1604cc42efdf190a79b33ba1b423cf5f71` | 22 deklarovaných payload files |
| `evidence/artifact-manifest.sha256` | `0c0206d77ff9da6ebd30e7156744872855b7c8088f52f81bfb15257861a8ad5f` | detached manifest digest file |
| `evidence/execution-finished.json` | `cb1c56d5e7a17946537aa647ea0c02047f6e696246e3d0795521a1a029714c3b` | executor claim, ne acceptance proof |
| `evidence/post-verification.json` | `1783cc1a9d733555a21c58c2fe6911ba53074dec51ec7b454c6cc68862168618` | technical poststate |

Zachovaný outcome je přesně
`PASS_RECOVERY_PREREQUISITE_ONLY_NO_AUTO_RESTART`: FK `0`,
`quick_check=ok`, `integrity_check=ok`, 60 migration stamps, latest
`2026_08_12_065_model_failover_target`, active selection 73 rows s digestem
`745cda2ee90a0fee006874941a4bf18da927b4f764e8eab543aee64e7d5ac3d8`.
Dluh `300 API / 48 IDs / 0 milestones / 0 joins` zůstává otevřený.

Dva dřívější executed attempts se nesmí skrýt:

| Root suffix | Plan SHA-256 | Manifest SHA-256 | Výsledek |
|---|---|---|---|
| `T192630Z-74f9affa5e038939` | `709fd17e9d0b3671eaad1595dcf9b300a8d55e61843811b6141652c89f104d90` | `20d6a72561a77584b6d498ce4c68a8bf82b7ece667d6c7e9a3ac7c6527f054e0` | `RESTORED_FAILURE`, logický návrat latest044/FK46 |
| `T194019Z-4eca63e3b2eb2bc1` | `db3250817906b86e5877706f8a6a6db0dca03eff4c0a43b3271988342adbf676` | `068946323c7428ff1e5eff6dfd20aa8f34bb08bef72edf317050dc413e6d8c00` | `RESTORED_FAILURE`, logický návrat latest044/FK46 |

Starší roots `T180948`, `T183752`, `T183905`, `T185907` a `T190311` jsou
`PLAN/PREFLIGHT_ONLY / NOT_EXECUTED`; nejsou success ani failure live run.

Read-only kontrola 2026-08-17 našla live DB bez exact-path handles, mode `0600`,
SHA-256
`506088b5dbc6b06537de35d80eeada2405e7994c8931b91a029da945b5b924f4`,
FK `0`, checks `ok`, 60/latest065 a counts `300/372/876/0`. `.env` je mode
`0600`, SHA-256
`e7dce4c49cad132835d86061a8eb0a91595c673b67a3b60dad897d724e87edf2`.
Tyto pozdější bytes zahrnují následný credential apply; nejsou tvrzené jako
byte-identický 031 poststate.

### 2.2 Joint manifest a Phase-B failure bundle

Joint manifest:

```text
/home/belphareon/.local/share/intentsmith-private/m1-joint-execution-manifest-v2-20260812TXXXXXXZ-6yDCCUV7/m1-execution-manifest.json
SHA-256 fbe9e33f761b073c73093cac6455ae7a77faa102f95a6be33cd5837ef559e486
```

Je mode `0400`, 11 855 bytes, raw-secret-free a reprodukovatelný exact builder
checkem. Vnitřní credential manifest má SHA-256
`54a2c14427fd7cefafdde6ab433284036bf71141b9ba313517d914b9030db1a1` a
akce `11 TRANSFER / 0 EXPORT / 0 PURGE`. Exact historical acceptance digestu
`fbe9e33f...` není canonical-bound; credential apply proběhl právě jednou a
nesmí se replayovat.

Phase-B failure root
`m1-b3-phaseb-execution-20260812TXXXXXXZ.Q29oJSdh` zachovává:

- V2 manifest
  `122af434d4f492a385d91dfb05ca675eb9b5fee8fc25c3bb2e50b0a86a85dcaa`;
- truth amendment
  `4a7507bfde1b6fed22ac2ed77ee50242484fb9cfd3f4b620f3590713710d8fe1`;
- původní manifest
  `4422f21840218953f150b6de7f808567bb8893d64073a14be65e512e10868fb0`;
- headroom `FAIL`
  `92befe7a3f5a4e28eedbbfd61c5abaaf32bab00c16d94ede00b76ed993abfb8e`;
- pre-effect `BLOCKED`
  `2663c8de682d8b8a549ffe908c2aa4b296488b790be6c30badcae6fbe3f92196`;
- cold-timeout `FAIL`
  `3e60814fcf87bb30bf763c852a3094a078d3ddd4cc74d92da8343e6b7f7487dc`.

Declared payload integrity může být PASS; full-directory closure ani binding
generatoru se netvrdí. Stav zůstává `STOPPED_T3_TERMINAL_FAILURE`, ne Phase-B
PASS.

### 2.3 Birth-time attestation

Non-clobber root `m1-literal-directory-time-attestation-20260812T225053Z`
obsahuje:

- `creation-time-attestation.json`, mode `0400`, 6461 bytes, SHA-256
  `fc5a384660038b45bbe7dd52b9eafb89c9c4bc9d98a0f55be52617182501bbd9`;
- `artifact-manifest.json`, mode `0400`, 588 bytes, SHA-256
  `b1783d639e914189a25b512e7d396dbbcdbae8b986d2c645754fd635fe65cd36`.

Attestace pinuje skutečné filesystem birth times:

- notification root: `2026-08-12T20:54:51.329413850Z`, device `30`, inode
  `13622934`, mode `0700`;
- Phase-B failure root: `2026-08-12T21:31:25.475962332Z`, device `30`, inode
  `13623673`, mode `0700`.

Její payload zapisuje observation time `2026-08-12T22:50:53Z`, tedy přibližně
58 sekund před commitem `5b375c9e` (`22:51:51Z`), a sám odkazuje revision
`ba1c06bd`. Nesmí se tvrdit, že vznikl pod již canonical §7.3 autoritou.
Review A i Review B jej nyní musí nezávisle rehashnout, znovu porovnat proti
skutečnému `%w/%W`, device/inode/mode a ověřit všech pět referenced artifacts.
Teprve promoted reconciliation je durable důkaz tohoto současného independent
review.

### 2.4 Post-5b headless orchestration failures

| Attempt | Hash-list SHA-256 | Result SHA-256 | Pravdivá klasifikace |
|---|---|---|---|
| `T225221Z` | `a3802dfb3eac854e99262e478d9ae6395e06f7be5f35bffd00f454d407e57f35` | `6b4a3b60e3b0cd4c8814d9d043fdeab7845bbdd03067d9cdbcebc86c3f6b2c57` | pre-isolation Git `dubious ownership`, isolate=false, headless=false, §7.3 handoff nevyčerpán |
| `T230202Z` | `7447c216213d1fd4fbcbb78d89d5f1e5ad3d1e993073380637e5d90b7dee4fd3` | `53441024f76927a29dd80614db4b5817aef666e08a3d9d04744bbea6441bfd10` | isolate=true, headless=true, RustDesk přežil, pre-load `BLOCKED`, graphical restored, postflight empty neprokázán |

§7.3 handoff authority je druhým attemptem terminálně vyčerpaná. Headless T3
behavior subprocess se ani v jednom z těchto dvou attemptů nespustil; tato věta
nemění dřívější desktopové T3 FAIL runs na `NOT RUN`. Oba bundle roots jsou
mode `0700`, oba `run-headless-t3.sh` mode `0500` a všechny ostatní bundle
files mode `0600`. Proto tracked hash pin zachycuje review-time snapshot a
nesmí být vydáván za původně immutable mode-0400 evidence.

## 3. Historical Q4 není no-model preflight

Repo neobsahuje samostatnou verzovanou definici Q4. Private Q4/graph
diagnostiky model skutečně načetly a jsou pouze non-acceptance evidence:

- graph diagnostic: one token `54836 ms`, free VRAM `179 MiB`;
- Q4 default diagnostic: elapsed `47318 ms`, loaded free `277 MiB`;
- Q4 batch-64 diagnostic: elapsed `32475 ms`, loaded free `170 MiB`.

Tyto runs nemohou vytvořit T3 PASS ani oprávnit retry. Nový preflight se proto
nesmí nazývat Q4 ani model načíst.

## 4. Prospective H0 — návrh, nikoli effect authority

Po canonical promotion této reconciliation smí být materializován a staticky
zreviewován právě jeden nový plán `H0 / HEADLESS_NO_MODEL_BASELINE_ONCE`.
Materializace plánu sama ještě nepovoluje H0. Operátor musí zvlášť přijmout
exact plan SHA-256 a všechny effect hranice.

### 4.1 Pre-effect gate

Před prvním disruptive efektem musí kumulativně platit:

1. operátor potvrzuje uložený stav GUI a souhlas s ukončením graphical session;
2. existuje skutečně funkční a právě otevřená SSH monitoring session; listener
   ani dřívější session nestačí a SSH config/keys se nemění;
3. source worktree, runner a plán mají exact reviewed SHA; Git běží jako UID
   `1000` s `GIT_CONFIG_NOSYSTEM=1` a `GIT_CONFIG_GLOBAL=/dev/null`. Zakázané
   jsou `safe.directory`, `chown`, `chmod` nebo root Git bypass;
4. system Ollama je aktivní podle prestate, `ollama ps` je prázdné, GPU compute
   list prázdný a neběží jiná headless jednotka;
5. piny jsou RustDesk unit
   `383440724510580ee577b8e48b8c51409d59d8faa0747afbd57081d99eb348a2`,
   binary
   `5677c42b7561f2d4b9e5d8561964a92b5946f0ffa6a56b35a241c5809986c023`,
   Ollama unit
   `b15f3fd1b35239683c73eb5cbc4523693de453f08582c2ee7165315c0f893adc`
   a binary
   `a0699117290335e76a93a675e7ca7c5e3b72b7d0875311b8e430636c5c736622`.

Jakýkoli mismatch je `H0_BLOCKED_PRE_EFFECT`; isolate se nespustí.

### 4.2 Jediné navrhované H0 efekty

Přijatý exact plán smí pouze:

1. spustit protected transient systemd oneshot s `IgnoreOnIsolate=yes`;
2. provést `systemctl isolate multi-user.target`;
3. ověřit, že každý `rustdesk --*` PID patří do
   `/system.slice/rustdesk.service`, jinak `BLOCKED`;
4. po isolate zastavit exact `rustdesk.service`, protože jeho
   `WantedBy=multi-user.target` jej samo nevypne; operátor musí výslovně přijmout
   odpojení a následný network reconnect;
5. po stabilizaci zachytit 30 no-model GPU/display/process samples po jedné
   sekundě;
6. v každé větvi přes trap obnovit `graphical.target` a pouze služby aktivní v
   prestate z nezměněných unit/binary bytes.

Zakázaný je start Ollamy v headless režimu, provider `/api/*` request, model
load, test/T3, proof/CAS, pull, delete, stop/unload modelu, rebind, config/unit
edit, user DB/config effect a external network kromě obnovení existujícího
RustDesk service prestate.

H0 PASS vyžaduje po všech 30 samplech: `multi-user.target=active`,
`graphical.target=inactive`, nula X11/Wayland sessions, nula RustDesk/display/
NVIDIA procesů, `display_active=Disabled`, compute count `0`, total VRAM
`24576 MiB`, used VRAM `<=64 MiB` a free VRAM `>=20128 MiB`. Restore gate
vyžaduje graphical target active, pre-active RustDesk/Ollama obnovené z
nezměněných bytes, prázdné `ollama ps`, nula compute procesů, žádný T3 artifact
a sealed non-clobber mode-0400 evidence manifest.

H0 PASS je pouze `DIAGNOSTIC_ONLY`; neopravňuje T3. H0 FAIL/BLOCKED nemá
automatický retry. Nový T3 handoff smí vzniknout až jako jiné rozhodnutí po H0
PASS a independent result review.

## 5. Review DAG a hranice PASS

```text
I0=5b375c9e
  -> S_REC
  -> E_A_REC (report-only)
  -> C_REC (merge current integration + E_A_REC; integration summaries only)
  -> E_B_REC (report-only)
  -> canonical --ff-only
```

Review A i Review B jsou nezávislé na writerovi a znovu ověří private artifact
hashes/modes/closure, 031 klasifikaci, manifest reproducibility, birth-time
stat equality a oba headless bundles. PASS znamená jen, že canonical text
pravdivě popisuje evidence. Neznamená historickou authority, B3 Phase-B PASS,
H0/T3 authority, Gate 1 readiness ani release readiness.

### 5.1 Zachovaný první Review-B neúspěch

První merge candidate
`C_REC1=43ba3e982e3b8e3b6e8ef7dbd3496a1e33328b19`, tree
`c49955da47b86c4e110e7cd1a19031609e03c7f0`, měl ordered parents
`[5b375c9e730fea2efcab3ab2549e4cd53afda5a3,
ebc3df7b20b1ac69a41a9cbc18f7ded759c0191a]`. Review B skončilo
`CHANGES_REQUIRED`, protože předchozí text nepřesně zobecnil mode celých
headless bundles na `0600`; skutečné roots/runner/payload modes jsou
`0700/0500/0600`. Topologie, path scope, ostatní docs claims, private evidence
matrix i repo baterie prošly. Pro `C_REC1` nevzniklo `E_B_REC` a candidate se
nepromoval.

Remediation zachovává první candidate i červený verdict bez amend/rebase/
history rewrite. Nový symbolic DAG je:

```text
I0=5b375c9e
  -> S_REC_R2 (opravený mode claim + preserved C_REC1 failure)
  -> E_A_REC_R2 (nové independent Review A; report-only)
  -> C_REC_R2 (merge current integration + E_A_REC_R2; summaries only)
  -> E_B_REC_R2 (nové independent Review B; report-only)
  -> canonical --ff-only
```

Existující šestřádkový Phase-A report
`docs/execution/runs/wp-m1-model-terminal-failover-20260812-report.md` zůstává
byte-identický. Bez Phase-B PASS nesmí vzniknout `B_S`, `B_EA`, `B_C` ani
`B_EB`.

## 6. Přijatá docs-only volba A

```text
M1-RECONCILIATION: A
past-effects: TECHNICAL-RESULT-SEPARATE-FROM-AUTHORITY
failure-evidence: PRESERVE-ALL-NON-CLOBBER
031-status: TECHNICAL_PASS-AUTHORITY_GAP-NO-RETROACTIVE-AUTHORIZATION
private-digests: CANONICAL-BIND-BEFORE-ANY-NEW-EFFECT
birth-time-attestation: IN-SAME-INDEPENDENT-REVIEW-CYCLE
headless-preflight: H0-NO-MODEL-SEPARATE-EXACT-AUTHORITY-AFTER-PROMOTION
new-t3-authority: NONE
```

## 7. Stop conditions

Zastavit při private byte/mode/stat driftu, chybějícím manifest closure,
odlišném headless výsledku, pokusu změnit historický Phase-A report, tvrzení o
retroaktivní akceptaci, source/runtime/test změně, user-data replay, credential
reapply, SSH mutation, service/display/GPU/model effectu před novou exact
autoritou nebo při nečistém či vlastnicky nejasném checkoutu. Stav je v takovém
případě `CHANGES_REQUIRED/BLOCKED`, nikdy implicitní PASS.
