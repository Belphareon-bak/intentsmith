# Live local model scoring — 2026-08-28

**Stav:** `SCORING_COMPLETE / SYSTEM_PROVIDER_BLOCKED / REREVIEW_REQUIRED`

Tento běh doplnil current-contract evidenci všech model-role párů, které jsou
podle sdílené role/category policy skutečně použitelné. Nic nebylo smazáno,
žádný binding nebyl změněn a timer zůstal vypnutý.

## Autorita a provider

- IntentSmith source při GPU běhu: `b0f94196422d868179e58ac588e55fcfcd96589f`.
- Systémová Ollama zůstala beze změny na `/usr/local/bin/ollama` 0.32.14.
- Izolovaný sidecar vycházel z upstream tagu `v0.32.14`, commitu
  `d67ad83426633195089509347ffd4fe795120198`, s jedinou změnou
  `0cb3844557c2cbf0beac555da0147279eebd9488`: lokální `/api/chat` response
  nese exact manifest digest vybraného modelu.
- Sidecar binárka
  `/home/belphareon/.local/opt/ollama-intentsmith-0.32.14.1/bin/ollama` má
  SHA-256 `72580ab98c5c82afe9cf73e5b7400b1d3cd94ec0777f961d1aefab878146878a`.
  Běžel pouze na `127.0.0.1:11435`, se stejným read-only model store, jedním
  modelem a jedním requestem současně. Po běhu byl zastaven.
- Provider patch prošel `go test ./api ./server`. Reálný preflight pro
  `qwen3:14b` vrátil digest
  `bdbd181c33f2ed1b31c972991882db3cf4d192569092138a7d29e973cd9debe8`,
  shodný s `/api/tags`; `/api/ps` současně hlásilo
  `size_vram == size == 9 308 712 467` B.

Systémový provider tento response contract stále neumí. Běžný runtime proto
zůstává `SYSTEM_PROVIDER_BLOCKED`; sidecar byl omezený prostředek pro tento
autorizovaný scoring, nikoli tichá náhrada systémové služby.

## Live DB

Před zápisem vznikla disposable SQLite projection se SHA-256
`6cc334a2f07f8eefa03b31a06881fe2694c584aef16a6c02eacc61287f9313cd`.
Source DB před migrací měla SHA-256
`e22d580f26b9b467eb2bf3774524206b3d95a36cdcdbc3902a08046e9e12c088`.

Na neobsazenou live DB se poté standardním runnerem aplikovalo 23 chybějících
migrací od 069 do 099. Výsledný stav:

- `quick_check=ok`, 88 migration stampů, 169 tabulek;
- `validation_results`, `validation_suite_scores` a `model_runtime_guard`: 0;
- 92 importovaných summary `VERIFIED`, 664 detailů `ARCHIVED`;
- 52 role-consistent decisions, 11 historických cross-role decisions v
  karanténě;
- live DB SHA-256
  `b524145d053059426c06de42597785f68b6091593ea9f5db01c4f0eb6d8d765d`.

Raw snapshot:
[`model-evaluation-host-db-snapshot-20260828-post-scoring.json`](model-evaluation-host-db-snapshot-20260828-post-scoring.json),
SHA-256 `73f69f3a0807692d885c7260af56cb51901f7ee0f8d1cfb3258b63c3d5df2c5a`.

## Coverage

Čtyři DB statusy zůstávají beze změny. Read model k nim nově přidává
`applicable` podle stejné policy, kterou používá installed scoring queue.
`MISSING` tedy dál pravdivě znamená neexistující run, ale panel současně
rozliší, zda daný model-role pár vůbec patří do měření.

| Coverage | COMPLETE | BLOCKED | MISSING | FAILED | NOT APPLICABLE |
|---|---:|---:|---:|---:|---:|
| všech 91 buněk (raw status) | 40 | 17 | 34 | 0 | 34 |
| použitelných 57 buněk | 40 | 17 | **0** | 0 | 34 mimo coverage |

Po rolích je `applicableMissing=0` pro D1, D2, R1, CODE, R2, CHAT i VISION.
Current timestamp rozsah je `2026-08-25T20:25:50.055Z` až
`2026-08-28T14:45:38.355Z`.

## Skóre po rolích

Čísla jsou procenta v rámci konkrétní suite. Nejsou srovnatelná napříč rolemi
a sama o sobě nejsou povolením k aktivaci nebo smazání.

| Model | D1 | D2 | R1 | CODE | R2 | CHAT | VISION |
|---|---:|---:|---:|---:|---:|---:|---:|
| `qwen3.6:27b-mtp-q4_k_m` | 95.83 | 95.83 | 95.83 | 33.33 | 67.50 | 92.32 | N/A |
| `phi4:14b` | 87.50 | 87.50 | 87.50 | 38.10 | 62.08 | 85.88 | N/A |
| `mistral-small:22b-instruct-2409-q6_k` | BLOCKED | BLOCKED | BLOCKED | BLOCKED | BLOCKED | BLOCKED | N/A |
| `qwen3.8:latest` | 93.61 | 89.72 | 90.83 | **76.19** | 74.58 | 91.26 | N/A |
| `qwen3-coder:latest` | N/A | N/A | N/A | 11.43 | 62.08 | N/A | N/A |
| `llava-llama3:8b` | N/A | N/A | N/A | N/A | N/A | N/A | **53.33** |
| `qwen3:14b` | 82.50 | 82.50 | 82.50 | 4.76 | 71.67 | 88.67 | N/A |
| `qwen3.5:27b` | **100.00** | **100.00** | **98.61** | 31.75 | **78.19** | 91.53 | N/A |
| `llava:13b` | N/A | N/A | N/A | N/A | N/A | N/A | 20.00 |
| `qwen2.5-coder:32b` | N/A | N/A | N/A | BLOCKED | BLOCKED | N/A | N/A |
| `qwen2.5:32b` | BLOCKED | BLOCKED | BLOCKED | BLOCKED | BLOCKED | BLOCKED | N/A |
| `deepseek-r1-32b:latest` | BLOCKED | BLOCKED | BLOCKED | N/A | N/A | N/A | N/A |
| `qwen3-30b-a3b:latest` | 80.00 | 80.00 | 80.00 | 0.00 | 55.00 | 89.50 | N/A |

Pairwise decision našel jediného kandidátního vítěze:
`qwen3.8:latest` pro CODE, marže 1.000 na třech stabilně rozlišujících
úlohách (3:0). Portfolio solver ale nevytvořil přípustnou změnu; všech sedm
bindingů zůstalo beze změny a `actionableDecisionCount=0`.

## VRAM gate při 32k kontextu

| Model | size / size_vram | CPU spill | Výsledek |
|---|---:|---:|---|
| `qwen2.5:32b` | 26.83 / 21.10 GiB | 5.72 GiB | BLOCKED |
| `mistral-small:22b-instruct-2409-q6_k` | 24.26 / 21.09 GiB | 3.17 GiB | BLOCKED |
| `deepseek-r1-32b:latest` | 25.83 / 21.05 GiB | 4.78 GiB | BLOCKED |
| `qwen2.5-coder:32b` | 26.83 / 21.10 GiB | 5.72 GiB | BLOCKED |

Modely, které prošly quality během, měly přesně `size_vram == size` a
`cpuBytes=0`: `qwen3-30b-a3b` 19.20 GiB, `qwen3.6` 16.23 GiB, `phi4` 11.56
GiB, `qwen3:14b` 13.55 GiB, `qwen3.8` 16.20 GiB a `qwen3.5` 16.98 GiB.

## Shortlist k samostatně autorizovanému odstranění

Bez dalšího quality úsudku lze navrhnout čtyři artefakty vyřazené VRAM gate:
`qwen2.5:32b`, `qwen2.5-coder:32b`, `deepseek-r1-32b:latest` a
`mistral-small:22b-instruct-2409-q6_k`. Uvolnily by 76 739 812 302 B,
tedy 71.47 GiB.

Druhá, méně jistá skupina je `qwen3-coder:latest` (CODE 11.43 %, R2 62.08 %)
a `llava:13b` (VISION 20 %). Uvolnily by dalších 24.74 GiB, ale jejich smazání
vyžaduje explicitní operator decision po kontrole fallback/diversity potřeb.
Žádný z těchto šesti modelů nebyl tímto během smazán.

## Reprodukce

Scoring běžel bez `--allow-removal`:

```bash
OLLAMA_URL=http://127.0.0.1:11435 node scripts/model-upgrade-hunt.js \
  --run --installed-panel --limit=10 \
  --db=/home/belphareon/Projects/intentsmith/data/c3.db \
  --report=.intentsmith-artifacts/model-scoring-20260828T141726Z/scoring-run.json
```

Run JSON SHA-256:
`2ccd477a0336177f0225aefad1bee0291baa4d11712a28866e410981033f5c45`.
Run log SHA-256:
`aa228aa5e4ec50cb51b12cafafde8eda740c5a24c3c6ebbb4a0c3d1d0a200402`.
