# Rezervace čísel migrací — union census 2026-08-22, kontroly 2026-08-23 a 2026-08-24

**Vlastník:** integrační vlastník M1 · **Metoda:** union přes všechny živé větve
· **Platí od:** 2026-08-22

Tento dokument je položka 3 závazné Gate 1 fronty (`ROADMAP.md` §13). Vzniká
proto, aby obě migrační položky fronty — 020 a 015 — dostaly čísla z jednoho
censusu a nekolidovaly spolu ani s žádnou existující větví.

## Změřený stav

```text
git branch -a  (mimo archive/** a recovery/**)   351 větví
union obsazených čísel src/db/migrations/**      001–065, bez jediné mezery
nejvyšší obsazené číslo                          065
```

Kdo drží pásmo nad 054:

| Čísla | Linka | Větve |
|---|---|---|
| 055–060, 063 | mobilní | `wp/mobile-prototype-20260817`, `wp/mobile-refresh-20260809`, `integration/mobile-alpha-20260812`, `codex/mobile-prototype-20260817` |
| 061–062, 064–065 | M1 konsolidace | `integration/m1-consolidated-20260810` a ~120 navazujících `docs/**`, `evidence/**`, `queue/**`, `wp/**` větví |

`wp/mobile-prototype-20260817` drží 050–065 souvisle, protože obě linky nese
zároveň.

## Rezervace

| Číslo | Rozhodnutí | Obsah |
|---|---|---|
| **066** | [020](../decisions/020-m1-model-failover-opt-in-surface.md) | oddělená failover-policy storage, default-off, versioned/CAS řádek |
| **067** | [015](../decisions/015-m1-model-failover-proof-policy.md) | immutable proof run artifact vázaný na PASS proof |

## Navazující live rezervace 2026-08-22

Po B3 runtime closeoutu se v hlavním checkoutu objevila cizí necommitnutá
migrace `068_model_evaluation_history`, zatímco izolovaný B3 worktree používal
stejné číslo pro failover runtime finalizaci. Do cizího rozpracovaného stromu se
nezasahovalo. Opakovaný union census nad 351 živými commitnutými větvemi ukázal
obsazení `001`–`068` a volné `069`; B3 runtime finalizace byla proto před
integrací přesunuta na **069**.

| Číslo | Stav | Obsah |
|---|---|---|
| **068** | live, cizí necommitnutá práce | role-specific model evaluation history |
| **069** | rezervováno a použito B3 | failover runtime finalize receipts a proof-expiry health events |

## Navazující live rezervace 2026-08-24

Union census všech commitnutých větví mimo `archive/**` a `recovery/**` a
samostatný census necommitnutých worktree migrací potvrdily obsazení do `074`.
M2/4 následně spotřebovalo souvislý blok `075`–`077`. Bezprostřední opakovaný
union census commitnutých větví a všech worktrees před oddílem M2/5 potvrdil,
že `078` je volná; M2/5 ji rezervuje pro durable project-change authority.
Bezprostřední opakování stejného censusu před M2/6 potvrdilo volnou `079`;
M2/6 ji používá pro durable lifecycle a governance authority. Všechny identity
jsou zapsané zde i v níže strojově kontrolovaném source manifestu.

| Číslo | Stav | Obsah |
|---|---|---|
| **075** | rezervováno a použito M2/4 | append-only exact `ToolRequest` ↔ `EffectRequest` link pro approval settlement |
| **076** | rezervováno a použito M2/4 | execution fencing a exact terminal truth pro `ToolResult` |
| **077** | rezervováno a použito M2/4 | atomická invalidace pending effect authority a semantic result evidence |
| **078** | rezervováno a použito M2/5 | durable project-change request, approval set, claim/fencing, journal a terminal truth |
| **079** | rezervováno a použito M2/6 | exact lifecycle plan/approval/cancel, governance receipt, recovery a terminal truth |

## Navazující integrační použití a oprava kolizí 2026-08-26

Integrační M2 linka původně použila `070`, `081`, `082` a `083`. Pozdější
union všech živých větví odhalil, že tyto identity kolidují se starší
model-evaluation linkou; předchozí M2 acceptance je proto pro migrační identitu
superseded a vyžaduje nový nezávislý review.

Opakovaný census nad 366 živými lokálními a remote refs (mimo
`archive/**` a `recovery/**`) našel 107 různých migračních cest. `087`–`088`
vlastní M4, `089`–`091` M5 a `096`–`097` model-evaluation authority. Globálně
volný souvislý blok byl přesně `092`–`095`; je novou autoritativní M2 řadou.

| Číslo | Stav | Obsah |
|---|---|---|
| **080** | použito M2 hardening | exact ApprovalGrant constraints proti immutable EffectRequest |
| **092** | použito, nahrazuje M2 `070` | durable effect authority |
| **093** | použito, nahrazuje M2 `081` | v2 semantic authority a karanténa neplatných legacy EffectResult řádků |
| **094** | použito, nahrazuje M2 `082` | pre-execution terminály pro expirované a revokované neprovedené granty |
| **095** | použito, nahrazuje M2 `083` | append-only rollback observation receipts pro standalone efekty |

Migrační runner převádí přesné staré M2 stampy na nové identity v jediné
transakci, zachovává jejich `applied_at` a znovu nespouští těla. Před zápisem i
po něm validuje union manifestu a projektované DB historie. Částečně aplikovaná
stará řada se nejprve adoptuje a teprve potom pokračuje chybějícími migracemi.
Persistovaný `source_migration` v karanténní tabulce zůstává záměrně na původní
hodnotě `2026_08_24_081_m2_effect_result_semantic_authority_v2`, aby byla nová
`093` schema byte-kompatibilní s již aplikovanou `081`.

## Navazující live rezervace 2026-08-26

Opakovaný union census všech commitnutých větví mimo `archive/**` a
`recovery/**` našel identity `084`–`086` na živé cizí větvi
`claude/gate1-mobile-app-progress-5sywlt`. Do této větve ani jejích migrací se
nezasahovalo. Identity **087–088** používá M4 learning authority, **089** M5
append-only outbound audit a bezprostředně opakovaný census před privacy blokem
potvrdil **090** jako volnou identitu pro append-only operator receipts.

| Číslo | Stav | Obsah |
|---|---|---|
| **084–086** | retired identity, atomicky adoptovaná | dříve vydané model policy/proof compatibility a model-evaluation consolidation; kanonické identity jsou `081`, `081` a `082` |
| **087** | rezervováno a použito M4 | exact Observation/Proposal/Outcome authority, user gate a lifecycle chain |
| **088** | rezervováno a použito M4 | version-bound plan evaluation evidence |
| **089** | rezervováno a použito M5 | append-only outbound policy decision a terminal audit |
| **090** | rezervováno a použito M5 | privacy rotation/history attestation authority a odstranění plaintext settings |
| **091** | rezervováno a použito M5 | opaque transport writer authority pro privacy receipts |
| **096** | rezervováno a použito model evaluation | explicitní audit `VERIFIED`/`QUARANTINED` pro legacy import evidence |
| **097** | rezervováno a použito model evaluation | role-specific run identity a karanténa cross-role decisions |
| **098** | obsazeno cizí živou M6 větví | model artifact authority; tato větev do něj nezasahuje |
| **099** | rezervováno a použito model evaluation | odstranění telemetry-derived runtime blacklist tabulky |

## Navazující live rezervace 2026-08-27

Read-only census všech lokálních worktrees našel cizí migrace **092–097**;
poslední z nich je rozpracovaná model-evaluation role identity v izolovaném
coworker worktree. Do žádného cizího souboru se nezasahovalo. Commitnutý union
větví končil na 096, ale worktree census je přísnější autorita pro zabránění
kolize, takže M6 používá první volnou identitu **098**.

| Číslo | Stav | Obsah |
|---|---|---|
| **091** | použito M5 | opaque transport writer authority pro privacy receipts |
| **092–095** | obsazeno v cizích worktrees | alternativní M2 effect authority chain |
| **096–097** | obsazeno v cizí model-scoring lince | import audit a role identity |
| **098** | rezervováno a použito M6 | durable cross-process model artifact claims a append-only provider effect audit |

### Strojově kontrolovaný manifest použitých migrací

Každý současný migrační soubor musí být právě jednou v tomto seznamu. Tím se
reservation ledger kontroluje proti skutečnému zdroji a nová migrace bez
záznamu selže v `artifact-validation`.

<!-- migration-source-manifest:start -->
| Soubor | Stav |
|---|---|
| `2026_02_14_001_baseline.js` | použito |
| `2026_02_14_002_v59_is_external.js` | použito |
| `2026_02_14_003_v62_active_session.js` | použito |
| `2026_02_14_004_v63_execution_trace.js` | použito |
| `2026_02_14_005_v64_cre_override_log.js` | použito |
| `2026_02_18_006_v67_auto_compact.js` | použito |
| `2026_02_19_007_v68_knowledge_base.js` | použito |
| `2026_02_19_008_v69_ledger_core.js` | použito |
| `2026_02_20_008_v69_expert_to_expertise.js` | použito |
| `2026_02_20_009_v70_period_locks.js` | použito |
| `2026_02_22_010_v72_vat_engine.js` | použito |
| `2026_02_22_011_v73_compliance.js` | použito |
| `2026_02_22_012_v74_specialists.js` | použito |
| `2026_02_24_013_v78_archive_status.js` | použito |
| `2026_02_24_014_v78_drop_old_expert_tables.js` | použito |
| `2026_02_24_015_v79_specialist_memory.js` | použito |
| `2026_02_24_016_v80_quality_scores.js` | použito |
| `2026_02_24_017_v81_telemetry_snapshots.js` | použito |
| `2026_02_25_018_v82_specialist_telemetry.js` | použito |
| `2026_02_26_019_v83_autonomy_tables.js` | použito |
| `2026_02_26_020_v85_skills.js` | použito |
| `2026_02_27_021_v86_memory_retention.js` | použito |
| `2026_02_27_022_v85_workflow_patterns.js` | použito |
| `2026_02_28_023_v87_auto_expertise_log.js` | použito |
| `2026_03_01_024_v91_security.js` | použito |
| `2026_03_01_025_v91_specialist_expertises.js` | použito |
| `2026_03_02_026_v92_checkpoint_mode.js` | použito |
| `2026_03_03_027_v91_feedback.js` | použito |
| `2026_03_03_028_v91_feedback_attachments.js` | použito |
| `2026_03_05_029_v98_architecture_governance.js` | použito |
| `2026_03_08_030_v103_model_overrides.js` | použito |
| `2026_03_08_030_v107_task_memory.js` | použito |
| `2026_03_10_031_v118_upgrade_proposals.js` | použito |
| `2026_03_11_032_v120_model_performance.js` | použito |
| `2026_03_11_033_v121_discovered_models.js` | použito |
| `2026_03_12_034_v123_validation_results.js` | použito |
| `2026_03_12_035_v124_marketplace.js` | použito |
| `2026_03_12_036_v125_model_verified.js` | použito |
| `2026_03_22_037_v130_media_generations.js` | použito |
| `2026_03_25_038_v132_benchmark_source.js` | použito |
| `2026_03_26_039_v133_model_usage.js` | použito |
| `2026_03_27_040_v135_governor.js` | použito |
| `2026_04_08_041_v136_model_universe.js` | použito |
| `2026_04_08_042_v137_universe_reconciliation.js` | použito |
| `2026_04_12_043_drafts_table.js` | použito |
| `2026_04_12_044_v138_runtime_guard.js` | použito |
| `2026_07_30_045_telemetry_aggregation_version.js` | použito |
| `2026_08_08_046_model_failover.js` | použito |
| `2026_08_08_047_model_failover_claim_expiry.js` | použito |
| `2026_08_08_048_model_binding_operations.js` | použito |
| `2026_08_08_049_model_binding_manual_supersede.js` | použito |
| `2026_08_09_050_model_binding_application_attempts.js` | použito |
| `2026_08_09_051_model_binding_runtime_generation.js` | použito |
| `2026_08_09_052_model_binding_provider_effects.js` | použito |
| `2026_08_09_053_model_binding_append_only_identity.js` | použito |
| `2026_08_09_054_model_binding_runtime_finalization.js` | použito |
| `2026_08_22_066_model_automation_policy.js` | použito |
| `2026_08_22_067_model_failover_proof_artifacts.js` | použito |
| `2026_08_22_069_model_failover_runtime_finalization.js` | použito |
| `2026_08_22_070_model_evaluation_history.js` | použito |
| `2026_08_23_092_m2_effect_authority.js` | použito |
| `2026_08_24_071_m2_effect_authority_hardening.js` | použito |
| `2026_08_24_072_m2_effect_execution_claims.js` | použito |
| `2026_08_24_073_m2_effect_claim_truth.js` | použito |
| `2026_08_24_074_m2_tool_authority.js` | použito |
| `2026_08_24_075_m2_tool_effect_links.js` | použito |
| `2026_08_24_076_m2_tool_authority_truth.js` | použito |
| `2026_08_24_077_m2_effect_invalidations.js` | použito |
| `2026_08_24_078_m2_execution_authority.js` | použito |
| `2026_08_24_079_m2_lifecycle_authority.js` | použito |
| `2026_08_24_080_m2_effect_semantic_authority.js` | použito |
| `2026_08_24_081_model_policy_trigger_compatibility.js` | použito |
| `2026_08_24_081_model_proof_trigger_compatibility.js` | použito |
| `2026_08_24_082_model_evaluation_consolidation.js` | použito |
| `2026_08_24_093_m2_effect_result_semantic_authority_v2.js` | použito |
| `2026_08_25_094_m2_preexecution_approval_terminals.js` | použito |
| `2026_08_25_095_m2_effect_rollback_receipts.js` | použito |
| `2026_08_26_087_m4_learning_authority.js` | použito |
| `2026_08_26_088_m4_learning_plan_evaluations.js` | použito |
| `2026_08_26_089_m5_outbound_audit.js` | použito |
| `2026_08_26_090_m5_privacy_authority.js` | použito |
| `2026_08_26_091_m5_privacy_writer_authority.js` | použito |
| `2026_08_26_096_model_evaluation_import_audit.js` | použito |
| `2026_08_27_097_model_evaluation_role_identity.js` | použito |
| `2026_08_27_098_m6_model_artifact_authority.js` | použito |
| `2026_08_27_099_remove_model_runtime_guard.js` | použito |
| `2026_08_28_100_signed_privacy_receipts.js` | použito |
| `2026_08_29_101_m7_remote_operation_journal.js` | použito pro M7 persistentní mutation journal |
<!-- migration-source-manifest:end -->

## Navazující M7 rezervace 2026-08-29

Bezprostřední census před persistentním mutation journalem prošel 378
commitnutých lokálních a remote refs mimo `archive/**` a `recovery/**` a všech
27 lokálních worktrees. Obě množiny končí na identitě `100`; první volná
identita je proto **101**.

| Číslo | Stav | Obsah |
|---|---|---|
| **101** | použito | append-only device + subject + operation mutation journal a exact replay |

## Proč to nejsou 058 a 059

`ROADMAP.md` §13 bod 5 uvádí `058` = 020 a `059` = 015 a k tomu poznámku, že
`055`–`057` jsou obsazené mobilními migracemi z `d6fee86f`. To platilo, když se
fronta psala. Mobilní linka mezitím pokračovala na `058`, `059`, `060` a `063`
a M1 konsolidace zabrala `061`, `062`, `064` a `065`. Rezervace `058`/`059` by
dnes vyrobila kolizi při prvním merge s kteroukoli mobilní větví.

Přesně kvůli tomuhle fronta žádá **union census přes všechny větve**, ne jen
kontrolu vlastního stromu. ROADMAP je opravená ve stejném commitu jako tento
dokument.

## Jak census zopakovat

```bash
for b in $(git branch -a --format='%(refname:short)' | grep -vE "^archive/|^recovery/"); do
  git ls-tree -r --name-only "$b" -- src/db/migrations 2>/dev/null \
    | sed -E 's#.*/[0-9_]{11}([0-9]{3})_.*#\1#'
done | grep -E "^[0-9]{3}$" | sort -u
```

Před každou další migrací se census pouští znovu. Rezervované číslo, které se
do dvou týdnů nepoužije, se uvolňuje.

## Kontrolní census 2026-08-23 — eval historie

Před začleněním eval historie byl census zopakován nad aktuálně dostupnými
branch tipy. Výsledek se od původní rezervace změnil:

```text
git branch -a  (mimo archive/** a recovery/**)   352 větví
union obsazených čísel src/db/migrations/**      001–069
068 na aktuálním tipu                            model_evaluation_history
069 na codex/m1-closeout-20260822                model_failover_runtime_finalization
první volné číslo                                070
```

`model_failover_runtime_finalization` existovalo už v commitu `c8ffbccc` jako
068 a teprve později bylo na své větvi přesunuto na 069. Číslo 068 proto není
bezpečné znovu použít: databáze, nad kterou se původní commit spustil, už může
mít stejný version string v `schema_migrations` a jinou migraci by tiše
přeskočila. Eval historie proto dostává **070**, i když na branch tipech po
přejmenování není druhý soubor 068 vidět.

| Číslo | Vlastník | Obsah |
|---|---|---|
| **068** | historicky `c8ffbccc` | nepoužívat znovu; původní runtime-finalization identita |
| **069** | `codex/m1-closeout-20260822` | runtime finalization po odstranění kolize |
| **070** | `claude/gate1-mobile-app-progress-5sywlt` | append-only historie modelových evaluací |

## Kontrolní census 2026-08-24 — konsolidace modelových evaluací

Před vytvořením nové migrace byl union census zopakován přes všechny dostupné
živé větve mimo `archive/**` a `recovery/**`. Dřívější pracovní odhad `081` už
neplatí: integrační M2 větev mezitím přidala i toto číslo.

```text
git branch -a  (mimo archive/** a recovery/**)   363 větví
union obsazených čísel src/db/migrations/**      001–081
071–081                                         M2 authority migrace
první volné číslo                                082
```

| Číslo | Vlastník | Obsah |
|---|---|---|
| **071–081** | `codex/m2-integration-20260824` a zdrojové M2 větve | M2 effect/tool/execution/lifecycle authority |
| **082** | `codex/model-evaluation-consolidation-20260824` | model evaluation decision/audit a odstranění v123 runtime tabulek |

Rezervace `082` je aktivní od 2026-08-24. Před vznikem souboru migrace se
census zopakuje ještě jednou; případný novější konflikt dostane přednost a WP
se posune na další volné číslo.

## Kontrolní census 2026-08-26 — review remediace modelových evaluací

Review rozsahu `e8c1ba85..96c762db` prokázalo, že M2 mezitím použilo 082 a 083
a modelová linka po posledním censusu přidala dva různé suffixy pod 081.
Opakovaný census všech dostupných lokálních a remote live refů mimo
`archive/**` a `recovery/**` změřil:

```text
živé refs                                         364
081                                               M2 + dva model compatibility repairy
082                                               M2 + model evaluation consolidation
083                                               M2 rollback receipts
první souvislý volný blok                         084–086
```

Modelová linka proto uvolňuje 081/082 a používá následující identity v pořadí,
ve kterém se musí aplikovat:

| Číslo | Vlastník | Obsah |
|---|---|---|
| **084** | model-evaluation review remediace | kompatibilita policy triggerů |
| **085** | model-evaluation review remediace | kompatibilita proof triggeru |
| **086** | model-evaluation review remediace | exact-contract evaluace, decisions, audit a odstranění v123 runtime tabulek |

Tento census je porovnaný s integračním tipem
`codex/m2-integration-20260824@9f8a7019`, který vlastní 071–083. Samostatně
zůstává v unionu starší konflikt čísla 070 mezi `model_evaluation_history`
a `m2_effect_authority`; nevznikl v tomto review rozsahu a musí jej vyřešit
integrační vlastník před sloučením obou linek. Není zde tiše přeznačen ani
vydáván za vyřešený.

Migrační preflight nyní vedle celého version stringu kontroluje i třímístný
numerický slot. Povoluje pouze dvě přesně vyjmenované historické dvojice 008
a 030; každou jinou kolizi odmítne před vytvořením `schema_migrations` nebo
spuštěním `up()`. Po budoucím spojení modelové a M2 linky tak existující konflikt
070 fail-closed zastaví integraci místo tichého průchodu.

## Oprava identity po review 2026-08-26

Následné upgrade review prokázalo, že výše popsané přesunutí už aplikovaných
081/081/082 na 084–086 porušilo rozhodnutí 016 a běžný upgrade z DB na
`96c762db` spouštěl konsolidaci podruhé. Platí proto:

- původní plné identity 081/081/082 jsou obnovené a neměnné;
- přesná modelová dvojice pod 081 je třetí explicitně grandfathered kolize;
- identity 084, 085 a 086 jsou trvale vyřazené a nesmějí být znovu použity;
- runner je v jedné transakci adoptuje zpět na původní identity; existující
  původní stamp má přednost, jinak se přejmenováním zachová jeho `applied_at`;
- guard kontroluje před adopcí i numerické sloty už uložené v
  `schema_migrations`. M2 konflikt 070 proto zůstává viditelný a fail-closed;
  vyřešit jej smí pouze autoritativní M2 integrační linka.
