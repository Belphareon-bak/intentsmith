# docs/wp — zadání práce

**Adresát:** agent, který dostane konkrétní zadání · operátor při rozhodování `§14`
**Založeno:** 2026-08-07

Soubory zde jsou **zadání**, ne stav a ne evidence. Jsou to položky
`ROADMAP.md §12` — osm bodů aktivního Work Package — sepsané dřív, než se WP
aktivuje, plus zadání read-only sond.

**Tohle není board.** Stav práce je podle `CONTRACT.md §6` výhradně
v `ROADMAP.md` a v příslušné inventuře. Zde se nic neaktualizuje, neoznačuje
jako hotové ani nesleduje. Když zadání doběhne, výsledek jde tam, kam ho
posílá jeho sekce „Výstup" — ne sem.

Každé novější zadání rozlišuje `sourceEvidenceRevision` od skutečného
`baseRevision`. První hodnota říká, nad jakým stromem vznikla analýza; druhá je
čistý přijatý integrační commit obsahující kontrakt, z něhož writer vytvoří
vlastní branch a disk-backed worktree.

Statický kontrakt se po aktivaci nedoplňuje skutečnými SHA. Každý zapisující WP
v §2 rezervuje unikátní `docs/execution/runs/*-report.md`; ten zaznamená
pojmenovaný `integration/<batch>` ref, `baseRevision`, immutable subject `S`,
Review A, merge-candidate `C` a Review B. Zápis používá report-only obálky
`E_A` a `E_B` podle `CONTRACT.md §6`; report nikdy neobsahuje SHA commitu,
který jej právě zapisuje.

| Soubor | Typ | Stav | Výsledek |
|---|---|---|---|
| [P2-L0-8-IMPORT-GRAPH](P2-L0-8-IMPORT-GRAPH.md) | read-only sonda | **doběhla 2026-08-07** | [L0-8-BOUNDARY](../review/2026-08-07-L0-8-BOUNDARY.md) |
| [P3-OUTBOUND-CENSUS](P3-OUTBOUND-CENSUS.md) | read-only sonda | **doběhla 2026-08-07** | [OUTBOUND-CENSUS](../review/2026-08-07-OUTBOUND-CENSUS.md) |
| [P4-AUTH-MATRIX](P4-AUTH-MATRIX.md) | read-only sonda | **doběhla 2026-08-07** | [AUTH-MATRIX](../review/2026-08-07-AUTH-MATRIX.md) |
| [P5-SECRET-TYPES](P5-SECRET-TYPES.md) | read-only sonda | **doběhla 2026-08-07** | [SECRET-TYPES](../review/2026-08-07-SECRET-TYPES.md) |
| [P6-MODULE-GRAPH](P6-MODULE-GRAPH.md) | read-only sonda | **doběhla 2026-08-07** | [MODULE-GRAPH](../review/2026-08-07-MODULE-GRAPH.md) + měřidlo a JSON |
| [P7-ENFORCEMENT-AUDIT](P7-ENFORCEMENT-AUDIT.md) | read-only sonda | **doběhla 2026-08-07** | [ENFORCEMENT-AUDIT](../review/2026-08-07-ENFORCEMENT-AUDIT.md) |
| [WP-M5-PACKAGE](WP-M5-PACKAGE.md) | zapisující WP | **blokován do přijetí M3+M4 a rebase** | — |
| [WP-M5-DATA](WP-M5-DATA.md) | zapisující WP | **blokován do přijetí M3+M4 a rebase** | — |
| [WP-M1-BINDING-REPOSITORY](WP-M1-BINDING-REPOSITORY.md) | zapisující WP | **dokončeno** na `515fb6f7`, evidence `eb7e78b8` | [WP-M1-MODEL report](../execution/runs/wp-m1-model-report.md) |
| [WP-M1-BINDING-APPLICATION](WP-M1-BINDING-APPLICATION.md) | zapisující WP | **dokončeno** na `e7d89b5e`, fresh-clone evidence `9b71c741` | [WP-M1-MODEL report](../execution/runs/wp-m1-model-report.md) |
| [WP-M1-BINDING-FINALIZE-RECOVERY](WP-M1-BINDING-FINALIZE-RECOVERY.md) | zapisující WP | **fresh-clone verified** na `7c4aa73c`; review range `0a6bde54..7c4aa73c` | [Finding 008](../findings/008-model-binding-commit-point-split.md) |
| [WP-M1-PROOF-ISSUANCE](WP-M1-PROOF-ISSUANCE.md) | zapisující prerequisite | **PROMOTED / REVIEW A+B PASS; CHAT proof issued**; po final terminal B3 source je historický proof kvůli source pin driftu nezpůsobilý pro novou aktivaci | [WP-M1-MODEL report](../execution/runs/wp-m1-model-report.md) |
| [WP-M1-PROOF-ISSUER-PROVENANCE](WP-M1-PROOF-ISSUER-PROVENANCE.md) | zapisující WP | **PROMOTED / REVIEW A+B PASS; CHAT proof issued**; issuer zůstává operator-only a final B3 vyžaduje nový manifest-bound proof | [WP-M1-MODEL report](../execution/runs/wp-m1-model-report.md) |
| [WP-M1-MODEL-CLEANUP-AUTHORITY](WP-M1-MODEL-CLEANUP-AUTHORITY.md) | zapisující WP | **C1 + C2a + C2b gateway/binding fresh-clone / PARTIAL; 4/5 live paths**, C2a source `9b4d9f79`, baseline `19d63e1b`; gateway source `7ccd8a58`; binding source a clean-clone target `cfcb63dd`, exact-edge baseline `175d5f31`; evidence je commit obsahující tento stav | [WP-M1-MODEL report](../execution/runs/wp-m1-model-report.md) |
| [WP-M1-POLICY-PORTABLE-SECURITY](WP-M1-POLICY-PORTABLE-SECURITY.md) | zapisující security repair | review-remediation source `2c06b159`; exact-edge baseline `37d9b4e3`; nové Review A a fresh clone otevřené | [source candidate evidence](../execution/runs/wp-m1-policy-portable-security-20260810-report.md) |
| [WP-M1-SETTINGS-NOTIFICATION-CLOBBER](WP-M1-SETTINGS-NOTIFICATION-CLOBBER.md) | zapisující P1 data-integrity repair | **PROMOTED na `8c7ff414`; Review A+B PASS; focused 4/4**; ostatní Finding 011 zůstává otevřený | [promotion report](../execution/runs/wp-m1-settings-notification-clobber-20260810-report.md) |
| [WP-M1-SETTINGS-VERSIONED-AUTHORITY](WP-M1-SETTINGS-VERSIONED-AUTHORITY.md) | zapisující M1 public-connector/data-integrity WP | **PROMOTED na `0322d468`; Review A+B PASS**; subject `4f7f5742`, candidate `901bb6ba`, legacy 410 + v2 CAS | [promotion report](../execution/runs/wp-m1-settings-versioned-authority-20260811-report.md) |
| [WP-M1-NOTIFICATION-CREDENTIAL-SCOPE](WP-M1-NOTIFICATION-CREDENTIAL-SCOPE.md) | zapisující M1 capability/security-boundary WP | **PROMOTED / REVIEW A+B PASS** na `f1913587`; subject `0ed3c0ed`, candidate `56a00c09`, in-app only a external default-off | [promotion report](../execution/runs/wp-m1-notification-credential-scope-20260811-report.md) |
| [WP-M1-WEBHOOK-SECRET-SEMANTICS](WP-M1-WEBHOOK-SECRET-SEMANTICS.md) | zapisující M1 credential/runtime-authority WP | **PROMOTED / REVIEW A+B PASS** na `0037d56a`; subject `6733cccb`, candidate `fc01a5e9`, environment-only immutable status/signer autorita a HTTP setter 410 | [promotion report](../execution/runs/wp-m1-webhook-secret-semantics-20260811-report.md) |
| [WP-M1-SECRET-STORAGE-AUTHORITY](WP-M1-SECRET-STORAGE-AUTHORITY.md) | zapisující M1 credential/storage-authority WP | **PROMOTED / REVIEW A+B PASS** na `69d29ed3`; subject `27dd323e`, candidate `f4435079`, Setup P0 + canonical env/offline migration authority | [promotion report](../execution/runs/wp-m1-secret-storage-authority-20260811-report.md) |
| [WP-M1-CHATS-EVIDENCE-RECOVERY](WP-M1-CHATS-EVIDENCE-RECOVERY.md) | jednorázový docs-only governance/evidence recovery WP | **PROMOTED** na reconciliation tipu `17aba1b5`; invalidní narativ zůstává v historii/governance a canonical report převzal correct sibling blob | [decision 030](../decisions/030-m1-chats-evidence-envelope-recovery.md) |
| [WP-M1-STANDALONE-CHATS-DECOMMISSION](WP-M1-STANDALONE-CHATS-DECOMMISSION.md) | zapisující M1 support-boundary decommission WP | **PROMOTED / REVIEW A+B PASS**; invalidní evidence attempt zůstává dohledatelný, corrected envelope je canonical ancestor | [promotion report](../execution/runs/wp-m1-standalone-chats-decommission-20260812-report.md) |
| [WP-M1-SETTINGS-RESET-AUTHORITY](WP-M1-SETTINGS-RESET-AUTHORITY.md) | zapisující M1 destructive-connector/recovery WP | **PROMOTED / REVIEW A+B PASS** na `6c366074`; exact dual CAS, owner-only reset a legacy alias 410 | [promotion report](../execution/runs/wp-m1-settings-reset-authority-20260812-report.md) |
| [WP-M1-PRE-MANIFEST-FK-RECOVERY](WP-M1-PRE-MANIFEST-FK-RECOVERY.md) | historický one-shot data-recovery prerequisite | **TECHNICAL_PASS / AUTHORITY_GAP / NO_RETROACTIVE_AUTHORIZATION / NO_REPLAY**; exact plan/manifest/poststate jsou canonical-bound, dva předchozí `RESTORED_FAILURE` attempts zůstávají zachované | [decision 032](../decisions/032-m1-closeout-authority-gap-reconciliation.md) |
| [WP-M1-MODEL-TERMINAL-FAILOVER](WP-M1-MODEL-TERMINAL-FAILOVER.md) | zapisující M1 runtime-authority WP | **PHASE_A_PROMOTED / PHASE_B_TERMINAL_BLOCKED / HEADLESS_AUTHORITY_EXHAUSTED**; desktopové T3 `FAIL/BLOCKED/FAIL`, dva další pre-T3 headless failures, B4 a Gate 1 zamčené | [Phase-A-only report](../execution/runs/wp-m1-model-terminal-failover-20260812-report.md) |
| [WP-M1-CLOSEOUT-EVIDENCE-RECONCILIATION](WP-M1-CLOSEOUT-EVIDENCE-RECONCILIATION.md) | docs-only governance/evidence reconciliation | **DOCS-ONLY / NO_RUNTIME_AUTHORITY**; první candidate zůstal `Review B: CHANGES_REQUIRED`, R2 opravuje mode claim a zachovává authority gap i birth-time review-now evidence; verdicty patří jen do reportu | [reconciliation report](../execution/runs/wp-m1-closeout-evidence-reconciliation-20260817-report.md) |
| [WP-M1-H0-STATIC-REMEDIATION](WP-M1-H0-STATIC-REMEDIATION.md) | docs-only V1 failure binding + one-shot V2 static remediation | **PROMOTED / V1 STATIC_CHANGES_REQUIRED**; jediná V2 materializace byla spotřebovaná partial rootem a zůstala `STATIC_CHANGES_REQUIRED_UNSEALED / NO_RUNTIME / DO_NOT_CONTINUE`; V2 se neopravuje ani nespouští | [decision 033](../decisions/033-m1-h0-static-remediation.md) |
| [WP-M1-H0-V2-MOUNT-NAMESPACE-REMEDIATION](WP-M1-H0-V2-MOUNT-NAMESPACE-REMEDIATION.md) | docs-only V2 failure binding + one-shot V3 static remediation | **PROMOTED / V3 STATIC_BYTES_SEALED / REVIEW A+B CHANGES_REQUIRED / NO_RUNTIME**; 034 mount split zůstává závazný, jediná V3 authority je spotřebovaná a V3 se neopravuje ani nespouští | [decision 034](../decisions/034-m1-h0-v2-mount-namespace-remediation.md) |
| [WP-M1-H0-V3-WORKER-QUIESCENCE-REMEDIATION](WP-M1-H0-V3-WORKER-QUIESCENCE-REMEDIATION.md) | docs-only V3 failure binding + one-shot V4 static remediation | **PROMOTED / V4 STATIC_BYTES_SEALED / REVIEW A CHANGES_REQUIRED + REVIEW B PASS / NO RUNTIME**; R2 byla promovovaná, jediná V4 authority je spotřebovaná a aggregate zůstává `CHANGES_REQUIRED / DO_NOT_EXECUTE` | [decision 035](../decisions/035-m1-h0-v3-worker-quiescence-remediation.md) |
| [WP-M1-H0-V4-LIFECYCLE-PROJECTION-REMEDIATION](WP-M1-H0-V4-LIFECYCLE-PROJECTION-REMEDIATION.md) | docs-only V4 divergent-review binding + one-shot V5 static remediation | **V4 REVIEW A CHANGES_REQUIRED / REVIEW B PASS / AGGREGATE CHANGES_REQUIRED / NO RUNTIME**; 036 vyžaduje plan-side `CLIENT_QUIESCED` přes exact 15-node callgraph, phase/receipt projections, AST dominance a source-derived budget, independent preseal hold a dvě distinct post-seal review | [decision 036](../decisions/036-m1-h0-v4-lifecycle-projection-remediation.md) |
| [WP-M1-H0-V5-PRESEAL-REMEDIATION](WP-M1-H0-V5-PRESEAL-REMEDIATION.md) | docs-only V5 preseal red binding + jediná same-root three-core remediation | **V5 PRESEAL CHANGES_REQUIRED / P0=0 P1=5 / UNSEALED / DO NOT EXECUTE / NO RUNTIME**; 037 vyžaduje authentic old-red recorder, právě jednu opravu existujícího plan/runner/strategy, pravdivé isolated mutations, cleanup SHA chain, reviewer identity, actual one-root enumeraci a fresh distinct PRESEAL_READY před sealem | [decision 037](../decisions/037-m1-h0-v5-preseal-remediation.md) |
| [WP-M1-H0-V5-DETACHED-SOURCE-CHECKOUT-AUTHORITY](WP-M1-H0-V5-DETACHED-SOURCE-CHECKOUT-AUTHORITY.md) | docs-only jednorázová autorita k fixed locked detached D037-E_B source worktree | **R2 PROMOTED / OPERATIONAL BLOCKED_BEFORE_ATTEMPT / AUTHORITY CONSUMED / NO RUNTIME**; po root GO starý verifier provedl external ambient common-Git read před snapshotem, creator provedl zero post-GO commands, attempt zůstal 0, target/admin nevznikly a D038 se nesmí retryovat | [decision 038](../decisions/038-m1-h0-v5-detached-source-checkout-authority.md) |
| [WP-M1-H0-V5-DETACHED-SOURCE-CHECKOUT-PRELAUNCH-REMEDIATION](WP-M1-H0-V5-DETACHED-SOURCE-CHECKOUT-PRELAUNCH-REMEDIATION.md) | docs-only náhrada spotřebované D038 prelaunch authority | **D038 TERMINAL RED / D039 PENDING REVIEW / PRIVATE REPAIR HOLD / NO RUNTIME**; exact D038 blob + substitution table, nové role/lock identity a creator-then-verifier pod nepřerušeným exclusive all-Git-access lease | [decision 039](../decisions/039-m1-h0-v5-detached-source-checkout-prelaunch-remediation.md) |
| [WP-M1-BOUNDARY-RATCHET](WP-M1-BOUNDARY-RATCHET.md) | zapisující WP | **technicky dokončeno**; hardening integrován v `ec98803a`, baseline `b05392e1`; procesní pilot invalidován | [IMPORT-CENSUS](../review/2026-08-09-IMPORT-CENSUS.md) + [LIFECYCLE-PARITY](../review/2026-08-09-LIFECYCLE-PARITY.md) |
| [WP-M3-L0-8-ENFORCEMENT](WP-M3-L0-8-ENFORCEMENT.md) | zapisující prerequisite | blokován do merge contract checkpointu + pojmenování integration refu | — |
| [WP-M3-L0-8-INJECTION](WP-M3-L0-8-INJECTION.md) | zapisující prerequisite | blokován do integrace enforcementu | — |
| [WP-M2-OUTBOUND-PILOT](WP-M2-OUTBOUND-PILOT.md) | zapisující M2 consumer | blokován do M1 + M2 effect/tool connectoru | — |
| [P8-DISABLED-BOOT](P8-DISABLED-BOOT.md) | dvoufázový evidence WP | blokován do M1 acceptance | — |
| [P9-OUTBOUND-LONG-HORIZON](P9-OUTBOUND-LONG-HORIZON.md) | dvoufázový evidence WP | blokován do přijetí M2 outbound | — |
| [P10-CORE-OPTIONAL-MAP](P10-CORE-OPTIONAL-MAP.md) | dvoufázový evidence WP | validator po contract merge; mapa post-M2 | — |

Zadání sondy zůstává i po doběhnutí — je v něm postup a ověřovací příkaz, kterým
si lze výsledek přeměřit. Sloupec „stav" je tady jediná výjimka z pravidla, že se
zde stav nesleduje; drží ho, aby nikdo nespustil hotovou sondu podruhé.

Ani jeden ze dvou historických **M5** WP není schválený k zahájení. Volný slot
během M1 je neodemkne: oba čekají na přijaté M3+M4 a povinný rebase/review
kontraktu proti tehdejšímu integračnímu SHA.

Dvojice **M1** WP původně otevřela bránu prvního paralelního pilotu podle
[`2026-08-08-PARALLEL-PILOT.md`](../review/2026-08-08-PARALLEL-PILOT.md):
`WP-M1-BINDING-REPOSITORY` už skončil před vznikem ratchet větve, proto se jako
souběžný writer neměří. `WP-M1-BOUNDARY-RATCHET` technicky doběhl a byl
integrován merge commitem `5332d30e`; jeho exact-edge baseline je připnutý
k tomuto merge SHA. Hardening větev následně na zdrojovém merge `da898277`
přijala šest hran binding-application checkpointu a zapsala baseline 1 010
hran v `b05392e1`; aktivní větev ji po uzavření předchozího writeru integrovala
merge commitem `ec98803a`. Pilotní měření je ale invalidované porušením
pravidla jednoho writera v ratchet checkoutu a nevytváří kladný ekonomický závěr.
`WP-M1-BINDING-APPLICATION` je tímto sériovým nástupcem, ne znovuotevřením
dokončeného repository WP.

`WP-M1-BINDING-FINALIZE-RECOVERY` je úzký sériový follow-up po C2b race review.
Nemění veřejný HTTP/WS connector; rozšiřuje interní repository/application
kontrakt o chybějící durable potvrzení mezi application success a synchronním
runtime finalize.

## Kontraktová dávka se source evidence `0a6bde54`

Decision [`019`](../decisions/019-l0-8-specialist-boundary.md) přijalo strict
injection. Nejkratší bezpečné pořadí je:

1. merge tohoto governance/contract checkpointu;
2. `WP-M3-L0-8-ENFORCEMENT`;
3. `WP-M3-L0-8-INJECTION`;
4. integrátorské utažení specialist baseline a přijetí jedné deklarované
   loader → ToolAdapter hrany.

Injection se neakceptuje ani neintegruje před enforcementem. Původní
[`WP-M5-OUTBOUND-GATE`](WP-M5-OUTBOUND-GATE.md) byl architektonicky chybný:
default-ON flag nemohl dodat exact approval ani durable audit. Nahrazuje jej blokovaný
`WP-M2-OUTBOUND-PILOT`, který konzumuje canonical network effect po M1.

P8–P10 nejsou „práce zdarma“. Každý má krátkou zapisující fázi A pro
runner/validator a pozdější evidence fázi B. Raw artifact může vzniknout mimo
projektový writer slot, ale potřebuje vlastní checkout/runtime root; tracked
report je normální zapisující změna a jde merge queue. P8 A vzniká po M1 před
M3 boundary, P9 A hned po outbound M2 consumeru, aby 26h běh překryl M3/M4.
P10 validator může vzniknout už po contract merge, vlastní klasifikace až na
post-M2 SHA.

## Standard branches a worktrees

Standard je jeden canonical integration checkout vlastněný integrátorem a pro
každý aktivní WP samostatná feature branch i disk-backed worktree. Writer předá
immutable subject `S` k Review A a následná report-only obálka `E_A` jej
připne. PASS kandidáti se po jednom skládají do dočasné merge queue proti
aktuálnímu integration tipu; Review B a integrační testy běží na přesném
candidate `C`. Report-only `E_B` připne `C` a Review B; canonical integration
branch se posune až po metadata gate `E_B`.

První pilot nezneplatnil tento Git model. Zneplatnil pouze měření procesu,
protože dva writeři zapisovali do stejného checkoutu. Přesná normativní pravidla
jsou v `CONTRACT.md §6`; historická evidence incidentu v
[`PARALLEL-PILOT`](../review/2026-08-08-PARALLEL-PILOT.md).
