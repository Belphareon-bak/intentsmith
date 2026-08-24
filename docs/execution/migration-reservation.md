# Rezervace čísel migrací — union census 2026-08-22

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
Všechny identity jsou zapsané zde i v níže strojově kontrolovaném source manifestu.

| Číslo | Stav | Obsah |
|---|---|---|
| **075** | rezervováno a použito M2/4 | append-only exact `ToolRequest` ↔ `EffectRequest` link pro approval settlement |
| **076** | rezervováno a použito M2/4 | execution fencing a exact terminal truth pro `ToolResult` |
| **077** | rezervováno a použito M2/4 | atomická invalidace pending effect authority a semantic result evidence |
| **078** | rezervováno a použito M2/5 | durable project-change request, approval set, claim/fencing, journal a terminal truth |

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
| `2026_08_23_070_m2_effect_authority.js` | použito |
| `2026_08_24_071_m2_effect_authority_hardening.js` | použito |
| `2026_08_24_072_m2_effect_execution_claims.js` | použito |
| `2026_08_24_073_m2_effect_claim_truth.js` | použito |
| `2026_08_24_074_m2_tool_authority.js` | použito |
| `2026_08_24_075_m2_tool_effect_links.js` | použito |
| `2026_08_24_076_m2_tool_authority_truth.js` | použito |
| `2026_08_24_077_m2_effect_invalidations.js` | použito |
| `2026_08_24_078_m2_execution_authority.js` | použito |
<!-- migration-source-manifest:end -->

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
