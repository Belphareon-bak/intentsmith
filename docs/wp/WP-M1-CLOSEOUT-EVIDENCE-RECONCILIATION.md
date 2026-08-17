# WP-M1-CLOSEOUT-EVIDENCE-RECONCILIATION — canonical truth bez retroaktivní autority

**Typ:** docs-only governance/evidence reconciliation · **Slot:** jediný writer
v izolovaném disk-backed worktree

**Rozhodnutí:**
[`032 / selected A`](../decisions/032-m1-closeout-authority-gap-reconciliation.md)

**integrationRef:** `integration/m1-consolidated-20260810`

**baseRevision:**
`5b375c9e730fea2efcab3ab2549e4cd53afda5a3`

**Stav:** `SELECTED_A / DOCS_ONLY_RECONCILIATION / NO_RUNTIME_AUTHORITY`

## 1. Výsledek

Canonical docs oddělí technický 031 výsledek od chybějící předchozí authority,
připnou private evidence digesty, zachovají všechny FAIL/BLOCKED/RESTORED
attempts, klasifikují vyčerpanou §7.3 headless autoritu a nechají birth-time
attestaci nezávisle ověřit v Review A i B. WP nic nereplayuje a nepovoluje H0,
Q4 ani T3 effect.

## 2. Owned paths

Immutable subject `S_REC` smí změnit právě tento allowlist:

```text
docs/decisions/031-m1-pre-manifest-fk-recovery.md
docs/decisions/032-m1-closeout-authority-gap-reconciliation.md
docs/execution/m1-batch.md
docs/wp/WP-M1-CLOSEOUT-EVIDENCE-RECONCILIATION.md
docs/wp/WP-M1-MODEL-TERMINAL-FAILOVER.md
docs/wp/WP-M1-PRE-MANIFEST-FK-RECOVERY.md
```

Report v `S_REC` nesmí existovat. Po Review A smí `E_A_REC` jako jedinou změnu
vytvořit:

```text
docs/execution/runs/wp-m1-closeout-evidence-reconciliation-20260817-report.md
```

Integrátor smí při tvorbě exact merge candidate `C_REC` navíc aktualizovat
výhradně merge-SHA summaries:

```text
ROADMAP.md
SYSTEM-MAP.md
docs/wp/README.md
```

Tyto tři cesty nejsou writer-owned a v `S_REC` ani `E_A_REC` se nesmějí změnit.
Candidate je musí pouze zpravdivět proti exact merged tree; nesmí rozšířit
authority ani změnit subject docs.

**Zakázané:** existující
`docs/execution/runs/wp-m1-model-terminal-failover-20260812-report.md`, každý
jiný tracked path, source, runtime, test, registry, package/lock, build output,
user DB/config, private artifact rewrite, SSH/service/display/GPU/Ollama/model
effect, external network, push, tag, release, history rewrite a cleanup cizího
worktree.

## 3. Exact DAG

```text
I0=5b375c9e
  -> S_REC
  -> E_A_REC
  -> C_REC = merge(current integration, E_A_REC) + summaries
  -> E_B_REC
  -> integration/m1-consolidated-20260810 --ff-only
```

Refs:

- subject: `docs/m1-phaseb-evidence-reconciliation-20260817`;
- Review A: `evidence/m1-phaseb-evidence-reconciliation-review-a-20260817`;
- queue: `queue/m1-phaseb-evidence-reconciliation-20260817`;
- Review B: `evidence/m1-phaseb-evidence-reconciliation-review-b-20260817`.

`S_REC` je po Review A immutable. Review B běží nad exact `C_REC`; změna
candidate review ruší. Canonical se posune pouze non-force fast-forwardem po
metadata gate `E_B_REC`.

## 4. Povinné independent evidence review

Review A a Review B musí mít `writer != reviewer`; použijí dva různé reviewery,
jsou-li dostupní. Bez čtení raw secrets nebo quarantine rows ověří alespoň:

1. base HEAD/tree, čistotu, exact subject/candidate allowlist a
   `git diff --check`;
2. closure, mode, size a SHA každého deklarovaného payloadu tří executed 031
   roots; dvě restored failures a jeden technical outcome zůstanou oddělené;
3. `9b9dc710...` plan status stále čeká na exact acceptance a technical result
   se nepřeznačuje na historical governance PASS;
4. joint manifest `fbe9e33f...` projde deterministic `--check-manifest`, nemá raw
   secret a jeho acceptance zůstává canonical-unbound;
5. Phase-B V2 declared payload integrity, včetně původního manifestu, truth
   amendmentu a všech `FAIL/BLOCKED/FAIL` artefaktů;
6. oba post-5b headless hash lists, result JSON, nulový headless T3 subprocess,
   obnovený graphical target ve druhém attemptu a neprokázaný empty postflight;
7. birth-time payload/manifest, oba současné `%w/%W`, device/inode/mode a všech
   pět referenced artifact hashes; zároveň timeline `ba1c` attestation před
   `5b` se nesmí přepsat na historical authorization;
8. existující Phase-A report zůstává byte-identický a neobsahuje žádný
   `phaseB.*`, `B_S`, `B_EA`, `B_C` nebo `B_EB` claim.

Aggregate verdict při shodě je pouze:

```text
PRIVATE_ARTIFACT_BYTE_INTEGRITY: PASS
031_TECHNICAL_RESULT: PASS_RECOVERY_PREREQUISITE_ONLY_NO_AUTO_RESTART
031_GOVERNANCE_AUTHORITY: AUTHORITY_GAP / NO_RETROACTIVE_AUTHORIZATION
M1_EXECUTION_MANIFEST: BYTE_VALID / CANONICAL_ACCEPTANCE_EVIDENCE_UNBOUND
BIRTH_TIME_ATTESTATION: INTEGRITY_PASS / INDEPENDENTLY_REVIEWED_NOW
B3_PHASE_B: STOPPED_T3_TERMINAL_FAILURE
HEADLESS_ATTEMPTS: TWO FAIL-CLOSED PRE-T3 ORCHESTRATION FAILURES
GATE_1: BLOCKED
```

Zakázané verdicty jsou `031 AUTHORIZED`, `B3 PASS`, `Gate-1-ready`,
`release-ready` nebo tvrzení, že pozdější review opravilo minulou authority.

## 5. Report-only obálka

`E_A_REC` vytvoří přesně:

```text
integrationRef: integration/m1-consolidated-20260810
baseRevision: 5b375c9e730fea2efcab3ab2549e4cd53afda5a3
subjectHead: <full S_REC>
reviewA.verdict: PASS
```

`E_B_REC` připojí pouze:

```text
candidateHead: <full C_REC>
reviewB.verdict: PASS
```

Obě obálky používají normativní `assert_report_same` / `assert_report_append`
gates z `CONTRACT.md`; report nikdy nepíše vlastní commit SHA.

## 6. Focused verification

Writer a oba revieweři spustí bez runtime effectu:

```text
git diff --no-renames --name-only I0..S_REC = exact six-path subject allowlist
git diff --check I0..S_REC = PASS
git status --porcelain=v1 --untracked-files=all = empty
all private hash/stat/closure gates from section 4 = PASS
existing Phase-A report blob(S_REC) = existing Phase-A report blob(I0)
ROADMAP/SYSTEM-MAP/docs-wp-README blob(S_REC) = corresponding blob(I0)
```

Review B navíc ověří:

```text
E_A_REC is ancestor of C_REC
candidate summary paths are truthful and the only integration-owned additions
subject decision/WP blobs(C_REC) = corresponding blobs(E_A_REC)
report prefix(C_REC) = report(E_A_REC)
no source/runtime/test/private-user-data delta
```

## 7. Prospective handoff

Promotion `E_B_REC` pouze opraví canonical record. Následné pořadí je:

```text
promoted reconciliation
  -> materialized H0 no-model plan + static independent review
  -> exact operator acceptance H0 digest/effects
  -> one H0 run + independent result review
  -> only on H0 PASS: separate new T3 decision
```

H0 ani T3 není autoritou tohoto WP. Credential apply, 031 recovery a jiné
historické efekty se neopakují.

## 8. Stop conditions

`CHANGES_REQUIRED/BLOCKED` při path, parent, tree, report, private hash/mode/
closure/stat driftu, nejasné klasifikaci, chybějícím nezávislém review, změně
historického Phase-A reportu, změně subjectu po Review A, runtime/user-data
effectu, credential replay, H0/Q4/T3 spuštění, neřešitelném conflict nebo
pokusu fast-forwardnout canonical bez validního `E_B_REC`.

## Výstup

- canonical-bound digests bez retroaktivní authority;
- pravdivý 031, B3 a M1 status;
- zachované restored/failure/headless/Q4 evidence;
- současně nezávisle ověřená birth-time attestace;
- Review A/B PASS pouze pro docs/evidence truthfulness;
- B3 Phase B, H0, B4 a Gate 1 stále pravdivě `BLOCKED`.
