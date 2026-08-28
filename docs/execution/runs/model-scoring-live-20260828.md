# Live local model scoring — 2026-08-28

**Stav:** `SCORING_COVERAGE_COMPLETE / SYSTEM_PROVIDER_BLOCKED / REREVIEW_REQUIRED`

Tento dokument nahrazuje první neúplný scoring souhrn z téhož dne. Aktuální
autorita měří všechny nainstalované artefakty, které nejsou v rozporu s
verzovaným technickým kontraktem role
`technical-role-compatibility-v1`. `preferredCategories` už pouze řadí
kandidáty; nevyrábí `NOT_APPLICABLE`.

Nic nebylo smazáno, žádný binding nebyl změněn a timer zůstal vypnutý.
Implementace a evidence čekají na nové nezávislé rereview; tento stav proto
není `ACCEPTED` ani povolením k aktivaci či odstranění modelu.

## Autorita a provider

- Clean IntentSmith source při finálním GPU běhu:
  `6ae5a3369838fb17f0040c9580a86614833ebf21`.
- Systémová Ollama zůstala beze změny na `/usr/local/bin/ollama` 0.32.14.
- Izolovaný sidecar vycházel z upstream tagu `v0.32.14`, commitu
  `d67ad83426633195089509347ffd4fe795120198`, s jedinou změnou
  `0cb3844557c2cbf0beac555da0147279eebd9488`: `/api/chat` response nese
  exact manifest digest vybraného modelu.
- Sidecar binárka
  `/home/belphareon/.local/opt/ollama-intentsmith-0.32.14.1/bin/ollama` má
  SHA-256 `72580ab98c5c82afe9cf73e5b7400b1d3cd94ec0777f961d1aefab878146878a`.
  Běžela pouze na `127.0.0.1:11435`, s jedním modelem/requestem současně, a
  po běhu byla zastavena.

Systémový provider tento response contract stále neumí. Běžný runtime proto
zůstává `SYSTEM_PROVIDER_BLOCKED`; sidecar byl omezený prostředek pro tento
autorizovaný scoring, nikoli tichá náhrada systémové služby.

## DB a rollback provenance

Historická pre-migration DB se SHA-256
`e22d580f26b9b467eb2bf3774524206b3d95a36cdcdbc3902a08046e9e12c088`
není doložená jako byte-identická rollback záloha. Dne 2026-08-28 bylo podle
hashů prověřeno 33 SQLite kandidátů pod
`~/.local/share/intentsmith-private`, `~/.local/state` a `~/Projects`; shoda
nebyla nalezena. Dřívější disposable projection není rollback obraz. Tato
historická evidence gap je formálně otevřená a nesmí se převyprávět jako
existující záloha.

Před remediačním zápisem vznikla ověřená současná záloha:

- cesta:
  `/home/belphareon/.local/share/intentsmith-private/model-scoring-remediation-20260828T172616Z/backup/c3-pre-remediation.db`;
- source i kopie SHA-256:
  `b524145d053059426c06de42597785f68b6091593ea9f5db01c4f0eb6d8d765d`;
- `cmp` byte-identical, mód `0600`, SQLite `quick_check=ok`.

Po scoringu má live DB SHA-256
`a3eafab1a2061eb83e59720220891d8b41f7a5548a3b20ecd86b8df86827fa8a`
a `quick_check=ok`. Stará v123 runtime schema nejsou čtenářská ani scoring
autorita; aktuálnost vyžaduje exact tuple
`(digest, role, suite_name, suite_version, suite_contract_sha256)`.

## Coverage

Raw `MISSING` zůstává pravdivou absencí runu, ale coverage používá oddělenou
osu `applicable`. Finální panel má mezi 79 technicky kompatibilními dvojicemi
nulové `MISSING`:

| Coverage | COMPLETE | BLOCKED | MISSING | FAILED | N/A |
|---|---:|---:|---:|---:|---:|
| všech 91 buněk, raw status | 55 | 24 | 12 | 0 | 12 |
| technicky kompatibilních 79 buněk | 55 | 24 | **0** | 0 | 12 mimo coverage |

| Role | COMPLETE | BLOCKED | raw MISSING | applicable MISSING | N/A |
|---|---:|---:|---:|---:|---:|
| D1 | 7 | 4 | 2 | 0 | 2 |
| D2 | 9 | 4 | 0 | 0 | 0 |
| R1 | 7 | 4 | 2 | 0 | 2 |
| CODE | 9 | 4 | 0 | 0 | 0 |
| R2 | 9 | 4 | 0 | 0 | 0 |
| CHAT | 9 | 4 | 0 | 0 | 0 |
| VISION | 5 | 0 | 8 | 0 | 8 |

Přibylo 15 skutečných `COMPLETE` GPU běhů. Všech 15 má `started_at <
completed_at` a `duration_ms` odpovídající intervalu; rozsah je
`2026-08-28T17:31:14.781Z` až `2026-08-28T17:55:06.495Z`. Dalších sedm
current-role `BLOCKED` řádků převzalo exact-digest placement důkaz na shodné
RTX 3090 a shodném 32k kontextu. Jejich metadata obsahují původní run ID a
explicitně říkají, že nevznikly novým načtením modelu.

## Skóre po rolích

Čísla jsou procenta v rámci konkrétní suite. Nejsou srovnatelná napříč rolemi
a sama o sobě nejsou povolením k aktivaci nebo smazání.

| Model | D1 | D2 | R1 | CODE | R2 | CHAT | VISION |
|---|---:|---:|---:|---:|---:|---:|---:|
| `qwen3.6:27b-mtp-q4_k_m` | 95.83 | 95.83 | 95.83 | 33.33 | 67.50 | 92.32 | 93.33 |
| `phi4:14b` | 87.50 | 87.50 | 87.50 | 38.10 | 62.08 | 85.88 | N/A |
| `mistral-small:22b-instruct-2409-q6_k` | BLOCKED | BLOCKED | BLOCKED | BLOCKED | BLOCKED | BLOCKED | N/A |
| `qwen3.8:latest` | 93.61 | 89.72 | 90.83 | **76.19** | 74.58 | 91.26 | **95.56** |
| `qwen3-coder:latest` | 82.50 | 82.50 | 82.50 | 11.43 | 62.08 | 84.25 | N/A |
| `llava-llama3:8b` | N/A | 29.72 | N/A | 0.00 | 25.97 | 79.17 | 53.33 |
| `qwen3:14b` | 82.50 | 82.50 | 82.50 | 4.76 | 71.67 | 88.67 | N/A |
| `qwen3.5:27b` | **100.00** | **100.00** | **98.61** | 31.75 | **78.19** | **91.53** | 93.33 |
| `llava:13b` | N/A | 46.67 | N/A | 0.00 | 28.61 | 76.83 | 20.00 |
| `qwen2.5-coder:32b` | BLOCKED | BLOCKED | BLOCKED | BLOCKED | BLOCKED | BLOCKED | N/A |
| `qwen2.5:32b` | BLOCKED | BLOCKED | BLOCKED | BLOCKED | BLOCKED | BLOCKED | N/A |
| `deepseek-r1-32b:latest` | BLOCKED | BLOCKED | BLOCKED | BLOCKED | BLOCKED | BLOCKED | N/A |
| `qwen3-30b-a3b:latest` | 80.00 | 80.00 | 80.00 | 0.00 | 55.00 | 89.50 | N/A |

Portfolio evidence doporučuje jednu změnu: VISION z `llava-llama3:8b` na
`qwen3.8:latest` (0.9556 vs 0.5333). `qwen3.6` a `qwen3.5` rovněž VISION
incumbenta porazily, ale solver vybral vyšší skóre `qwen3.8`. Celkem je v read
modelu 100 current-contract decisions a nula actionable decisions. Standalone
binding autorita je `UNVERIFIED_RUNTIME`, takže ani portfolio výhra není
autorizovaná aktivace.

## VRAM-only gate při 32k kontextu

„GPU-only“ zde znamená žádný model-weight/layer CPU spill; malé host buffers a
memory mapping provideru nejsou modelový offload. Quality běh se spustil jen
pokud `/api/ps` hlásilo přesně `size_vram == size`.

Čtyři dříve přesně změřené artefakty se na shodném GPU/kontextu znovu
nenačítaly. Jejich artifact-wide placement důkaz se bezpečně materializoval do
dosud chybějících current-role `BLOCKED` řádků:

| Model | size / size_vram | CPU spill | Výsledek |
|---|---:|---:|---|
| `qwen2.5:32b` | 26.83 / 21.10 GiB | 5.72 GiB | BLOCKED |
| `mistral-small:22b-instruct-2409-q6_k` | 24.26 / 21.09 GiB | 3.17 GiB | BLOCKED |
| `deepseek-r1-32b:latest` | 25.83 / 21.05 GiB | 4.78 GiB | BLOCKED |
| `qwen2.5-coder:32b` | 26.83 / 21.10 GiB | 5.72 GiB | BLOCKED |

Všechny modely skutečně spuštěné v tomto běhu měly plný VRAM placement.

## Odstranění a aktivace

Tento běh nepovoluje odstranění žádného modelu. Čtyři VRAM-blocked artefakty
jsou technicky silní kandidáti k pozdější samostatné autorizaci odstranění.
`qwen3-coder` má nyní kompletní textový panel a nízké CODE skóre, ale i jeho
odstranění vyžaduje nové rereview a explicitní operator decision.
`llava:13b` zůstává chráněný rollback artefakt; `llava-llama3:8b` je současný
VISION binding. Ani jeden se teď nemaže.

## Bounded evidence

Scoring běžel bez `--allow-removal`:

```bash
OLLAMA_URL=http://127.0.0.1:11435 \
C3_DB_PATH=/home/belphareon/Projects/intentsmith/data/c3.db \
node scripts/model-upgrade-hunt.js --run --installed-panel --limit=13 \
  --report=/private/evidence/model-upgrade-hunt.json
```

Raw hunt JSON je mimo Git v private evidence rootu a má SHA-256
`c37b7964a82ddaba18dffe5739e92770a126db6395d485e14f362ae50e0e4c2d`.
Commitnutý bounded gate/snapshot záznam je
[`model-scoring-remediation-20260828.json`](model-scoring-remediation-20260828.json).
Finální gate nad čistým kandidátem `03134931` skončil v runu
`2026-08-28T18-12-18-428Z` výsledkem `279/279 PASS`. Následný read-only
[`post-gate snapshot`](model-evaluation-host-db-snapshot-20260828-remediation-post-gate.json)
potvrdil stejný DB hash, nulové applicable `MISSING`, vypnutý timer/service a
prázdný Ollama/GPU slot. Evidence je uzavřená; otevřené zůstává nezávislé
rereview, nikoli další lokální gate.
