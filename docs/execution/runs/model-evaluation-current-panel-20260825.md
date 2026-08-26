# Model evaluation: current-contract local panel (2026-08-25)

**Stav:** COMPLETE pro kompatibilní lokální artefakty; žádná aktivace ani
změna bindingu. **Autorita:** `model_evaluation_runs` +
`model_evaluation_decisions`, pouze exact current contract.

## Rozsah a výsledek

- Migrace `082` byla aplikována `2026-08-25 20:17:55 UTC` po záloze
  `/home/belphareon/Backups/intentsmith/c3-pre-082-20260825T220813+0200.sqlite`
  (`sha256 8a2c98e2dca1d7533f6f90093b2bbb4380848c87b393e9df806995d8fd1fef14`).
- `PRAGMA quick_check` vrací `ok`.
- Fyzické v123 tabulky `validation_results` a `validation_suite_scores`
  neexistují. Jejich 664 + 92 zdrojových řádků zůstává pouze jako neměnný
  audit v `model_evaluation_import_evidence` s import timestampy
  `2026-08-25T20:17:55.644Z` a `2026-08-25T20:17:55.646Z`.
- Read model deklaruje `currentContractOnly: true` a `legacyFallback: false`.
  Staré suite contract SHA proto nejsou score ani fallback; jsou pouze historie.
- Pod aktuálními pěti contract SHA je fyzicky 28 `COMPLETE` a 11 `BLOCKED`
  řádků pro 13 exact digestů. Všech 11 blokací má reason code
  `CANDIDATE_VRAM_FIT_FAILED`.
- Panel skončil `2026-08-25T21:31:11.746Z`. Vzniklo 33 append-only decisions,
  všechna s `activationEligible=false`; od začátku panelu nevznikla žádná
  `model_binding_operations` operace.

Aktuální contract SHA:

| Kategorie | Role | Contract SHA-256 |
|---|---|---|
| reasoning_v2 | D1, D2, R1 | `b7ce84ce8428be75e6d9d62e8652b0a8ea1123e8b9e8b21c2ebcad97887f823b` |
| code_patch | CODE | `2eda09cffe2381ed37bf0ecb551c9465ab8d96f13d4ff2953a02298537420ffe` |
| review_v2 | R2 | `db1aa51634227c483d8e3b15fccc300915899ef1965d6e55eb34302f728d2e3a` |
| chat_v3 | CHAT | `6188b09201f59e262fd7f4844c0c6f490114a0155766747a20134bb80b0f8a5b` |
| vision_v2 | VISION | `02400c67d030a4b3f308e020a66ee84a6007cb5994a2a0685489b3435919c901` |

## Skóre lokálních modelů

Skóre jsou v rozsahu 0–1 a každá úloha se opakovala třikrát. `BLOCKED` není
nula: model vůbec nebyl připuštěn ke quality sadě, protože při produkčním
contextu část vah/compute skončila na CPU. Pomlčka znamená, že kategorie pro
daný artefakt není kompatibilní.

| Exact model | Reasoning | CODE | R2 | CHAT | VISION | Testováno UTC |
|---|---:|---:|---:|---:|---:|---|
| `deepseek-r1-32b:latest` | BLOCKED | — | — | — | — | `21:06:05` |
| `llava-llama3:8b` | — | — | — | — | 0.533 | `21:31:09` |
| `llava:13b` | — | — | — | — | 0.200 | `21:30:28` |
| `mistral-small:22b-instruct-2409-q6_k` | BLOCKED | BLOCKED | BLOCKED | BLOCKED | — | `20:57:05` |
| `phi4:14b` | 0.875 | 0.381 | 0.621 | 0.859 | — | `20:58:45–21:04:39` |
| `qwen2.5-coder:32b` | — | BLOCKED | BLOCKED | — | — | `21:21:15` |
| `qwen2.5:32b` | BLOCKED | BLOCKED | BLOCKED | BLOCKED | — | `20:24:21` |
| `qwen3-30b-a3b:latest` | 0.800 | 0.000 | 0.550 | 0.895 | — | `20:25:50–20:42:29` |
| `qwen3-coder:latest` | — | 0.114 | 0.621 | — | — | `21:23:54–21:24:38` |
| `qwen3:14b` | 0.825 | 0.048 | 0.717 | 0.887 | — | `20:41:11–21:11:46` |
| `qwen3.5:27b` | 1.000 | 0.317 | 0.782 | 0.915 | — | `20:28:39–21:28:40` |
| `qwen3.6:27b-mtp-q4_k_m` | 0.958 | 0.333 | 0.675 | 0.923 | — | `20:48:42–20:56:16` |
| `qwen3.8:latest` | 0.897 | 0.762 | 0.746 | 0.913 | — | `20:30:03–21:20:18` |

## VRAM-only admission

„VRAM-only“ zde přesně znamená `size_vram == size` a `cpuBytes == 0` pro
načtený model při contextu 32 768. Ollama a Node stále používají běžnou RAM pro
procesní režii, bookkeeping a page cache; zákaz se týká CPU offloadu modelu.

| Model | Placement | Admission |
|---|---:|---|
| `deepseek-r1-32b:latest` | 21.05 GiB VRAM + 4.78 GiB CPU | BLOCKED |
| `llava-llama3:8b` | 5.55 GiB VRAM, 0 CPU | PASS |
| `llava:13b` | 10.04 GiB VRAM, 0 CPU | PASS |
| `mistral-small:22b-instruct-2409-q6_k` | 21.09 GiB VRAM + 3.17 GiB CPU | BLOCKED |
| `phi4:14b` | 11.56 GiB VRAM, 0 CPU | PASS |
| `qwen2.5-coder:32b` | 21.10 GiB VRAM + 5.72 GiB CPU | BLOCKED |
| `qwen2.5:32b` | 21.10 GiB VRAM + 5.72 GiB CPU | BLOCKED |
| `qwen3-30b-a3b:latest` | 19.20 GiB VRAM, 0 CPU | PASS |
| `qwen3-coder:latest` | 20.23 GiB VRAM, 0 CPU | PASS |
| `qwen3:14b` | 13.55 GiB VRAM, 0 CPU | PASS |
| `qwen3.5:27b` | 16.98 GiB VRAM, 0 CPU | PASS |
| `qwen3.6:27b-mtp-q4_k_m` | 16.23 GiB VRAM, 0 CPU | PASS |
| `qwen3.8:latest` | 16.20 GiB VRAM, 0 CPU | PASS |

## Rozhodnutí a bindingy

Jediná raw párová výhra kandidáta byla `qwen3.8:latest` pro CODE. Není to
akční doporučení: portfolio solver by tím porušil oddělení odpovědností, takže
zapsal `activationEligible=false` a nezměnil žádný binding.

| Role | Binding po panelu |
|---|---|
| D1 | `qwen3.5:27b` |
| D2 | `qwen3.8:latest` |
| CODE | `qwen3.5:27b` |
| R1 | `qwen3.8:latest` |
| R2 | `qwen3:14b` |
| CHAT | `qwen3.5:27b` |
| VISION | `llava-llama3:8b` |

Read model hlásí `DURABLE_WITH_BOOTSTRAP_FALLBACK`: šest rolí má durable
binding, CODE zatím čte stejný model z bootstrap configu. To není scoring
fallback a nebyla provedena skrytá aktivace.

## Čerstvé discovery

Read-only běh `--shortlist --json` dokončený `2026-08-25 23:45 CEST` našel
236 rodin. Fronta má 167 položek: 159 vzdálených návrhů a 8 již oscorovaných
lokálních artefaktů. JSON měl 576 682 bytů a SHA-256
`9339a9017ee92495610391e673662b0e8ac5d767a18e2ec667aca31b829527b3`.

| Pořadí | Návrh | Role | Odhad velikosti |
|---:|---|---|---:|
| 1 | `north-mini-code-1.0:latest` | CODE, R2 | 19 GB |
| 2 | `muse-glimmer:30b-q4_k_m-dflash` | VISION | 20 GB |
| 3 | `laguna-xs-2.1:latest` | CODE, R2 | 20 GB |
| 4 | `ornith:35b` | CODE, R2 | 21 GB |
| 5 | `devstral-small-2:latest` | CODE, R2 | 15 GB |
| 6 | `ornith-1.5:9b` | D2, CODE, R2, CHAT | 6.6 GB |
| 7 | `lfm2.5:8b-a1b-bf16` | D2, CODE, R2, CHAT | 17 GB |
| 8 | `qwen3.5:35b-a3b-int4` | VISION | 20 GB |

Toto pořadí je discovery priorita z katalogových metadat, nikoli score ani
doporučení k nasazení. Každý návrh musí projít exact-artifact pull, skutečným
VRAM placementem, aktuální rolovou sadou, párovým rozhodnutím a portfolio
solverem.

## Timer a ověření

- Timer byl před migrací zastaven a znovu spuštěn až po aktuálním panelu a
  čerstvém discovery.
- Od `2026-08-25 23:47:43 CEST` je `enabled/active (waiting)`; service je
  `inactive`, takže při restartu neproběhl skrytý hunt.
- Po posledním `daemon-reload` je další trigger `2026-08-27 19:04:55 CEST`;
  `RandomizedDelaySec=15m` může při dalším reloadu přesný čas znovu posunout.
- Instalovaný `ExecStart` míří na aktuální checkout a jedinou cestu
  `scripts/model-upgrade-hunt.js --run --limit=2 --keep-inconclusive --scheduled`.
  Dokumentační odkaz i repozitářová service šablona míří na
  `docs/MODEL-UPGRADE-HUNT.md`.
- Čistý deterministic replay na implementačním commitu `5c75c5d7`, run
  `2026-08-25T21-41-20-764Z`: `227 PASS`, `0 FAIL`, `0 BLOCKED`.
- Focused schema gate po vložení historických kolizních scénářů: `46/46 PASS`.
- `npm run test:registry`: 384 programů, registry validní.
