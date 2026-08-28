# Model evaluation — remediační integrační handoff (2026-08-27)

**Stav:** historický remediační handoff; aktuální stav je
`SCORING_COMPLETE / SYSTEM_PROVIDER_BLOCKED / REREVIEW_REQUIRED`

**Poslední nezávisle zamítnutý head:** `40418aafb3feba0671b15c3214ada409f4c03ff5`

**Review base:** `74beafea439fdddbbb54e797d351dfe180b2d5f7`

**Product/test candidate:** `79328185c6da4d6dd8222cb4f15634ddc90ce5ce`

**Snapshot/provenance tool:** `178aa592ee483096aaf69ebd1cca1ed4ca6be6c8`

**Clean deterministic gate source:** `79328185c6da4d6dd8222cb4f15634ddc90ce5ce`

Tento report zachovává stav remediace z 2026-08-27. Její pozdější nezávislé
rereview prošlo. Live migraci, provider sidecar, GPU-only scoring a coverage
opravu z 2026-08-28 autoritativně doplňuje
[`model-scoring-live-20260828.md`](model-scoring-live-20260828.md); tyto nové
změny čekají na samostatné rereview. Timer zůstává vypnutý.

## Autoritativní stav po remediaci

- Current výsledek vyžaduje současně exact SHA-256 artefaktu, roli, suite name,
  suite version a suite contract SHA. D1 run se už nikdy neprojektuje do D2
  nebo R1 jen proto, že role sdílejí `reasoning_v2`.
- Append-only `model_evaluation_runs` a role-consistent
  `model_evaluation_decisions` jsou jediná scoring autorita.
  `ModelEvaluationReadModel` je jediný product reader.
- Migrace 097 zahrnula roli do unikátní identity a do DB decision invariantu.
  Na disposable kopii živé DB zachovala 22 validních decisions a 11 cross-role
  decisions přesunula s celým payloadem do append-only karantény.
- Binding a scoring jsou oddělené autority. Jediná aktivační cesta je ruční
  exact-digest binding application; hunt, discovery ani telemetry binding
  nemění.
- `DURABLE` nyní nese exact jméno i digest všech rolí. Gateway ověří inventory
  před provider POST uvnitř shared model-use lease, ale obsloužený artefakt
  přijme pouze z digestu přímo v provider response. Druhý mutable `/api/tags`
  už není důkaz. Stejné pravidlo platí pro manual binding verification;
  neattestovaná nebo driftující odpověď zůstane neověřená a usage se nezapíše
  jako úspěch.
- Autoritativní scoring runner dostane exact artefakt před prvním provider
  callem a tentýž digest vyžaduje přímo v každé response. Chybějící digest,
  A→B drift nebo jiné response model identity vyhodí typovanou terminální
  chybu; summary se neuloží jako `COMPLETE`.
- Runtime telemetry zůstává pouze raw diagnostická evidence. Veškerý výpočet
  telemetry blacklistu, veto ručního bindingu, skrytý discovery filtr i
  `runtime_state` API byly odstraněny. Migrace 099 odstraňuje starou odvozenou
  tabulku `model_runtime_guard`.
- Osiřelé `applyWinningBindings()`, `runExclusiveAutomaticFailover()` a všech
  11 veřejných repository metod pro auto-claim, proof selection, terminal,
  expiry, runtime finalization a restart recovery byly odstraněny. Původní
  999řádkový repository test nahradila detection-only sada. Historické schema
  zůstává pouze pro bezpečný upgrade a čtení již uložených incidentů.
- V123 runtime tabulky zůstávají odstraněné. Historické migrace jsou pouze
  upgrade cesta, nikoli runtime fallback.

## Upgrade a importní důkaz

- Migrace 076 odstraní přesně známé vadné policy/proof triggery ještě před
  rebuildem tabulek; standardní runner proto projde i skutečnou pre-082
  zálohou.
- Migrace 070 převádí povolené legacy `duration_ms=NULL` na nulu a zachová řádek.
- Sanitizovaná schema fixture je mechanicky odvozena ze zálohy
  `c3-pre-082-20260825T220813+0200.sqlite` se SHA-256
  `8a2c98e2dca1d7533f6f90093b2bbb4380848c87b393e9df806995d8fd1fef14`.
  Obsahuje schema a 62 stampů, žádná aplikační data.
- Na disposable kopii celé původní zálohy prošel standardní runner do migrace
  099: `quick_check=ok`, 138 legacy runů, 756 import evidence, 92/92 VERIFIED,
  0 QUARANTINED importů a žádná v123 tabulka. Originální backup zůstal se
  shodným SHA.
- Migrace 096 toleruje pouze strojový JSON REAL roundtrip v rozsahu čtyř
  `Number.EPSILON`; materiální rozdíl `1e-6` dál karanténuje.

Čerstvá DB z kandidátního manifestu má 85 aplikovaných migračních zdrojů a 154
fyzických SQLite tabulek včetně interních FTS tabulek. Živá historická DB má
jinou legitimní historii stampů; její přesná projekce je doložena níže.

## Focused testy

| Kontrola | Výsledek |
|---|---:|
| model universe, raw telemetry bez blacklistu | 15/15 PASS |
| model upgrade/history/portfolio | 58/58 PASS |
| model evaluation consolidation 070/082/096/097 | 16/16 PASS |
| sanitizovaný skutečný pre-082 upgrade | 1/1 PASS |
| schema migrace včetně 097/099 | 55/55 PASS |
| manual binding application | 109/109 PASS |
| failover detection repository | 4/4 PASS; auto-transition surface absent |
| model evaluation runner response attestation | 19/19 PASS |
| pairwise exact-artifact propagation | 35/35 PASS |
| candidate scoring reason-code propagation | 34/34 PASS |
| model evaluation read model včetně D1→D2/R1 negative | 10/10 PASS |
| registry current authority | 13/13 PASS |
| gateway/model-use exact digest včetně A→B→A | 27/27 PASS |
| registry validace | 448 programů; fingerprint `b8791c78ca0277ed1b1b4b301887ff5a2d85c6f16e6840e95e540860b0275d4d` |
| module boundary ratchet | 1 193/1 193 hran; 3 cykly; 28 souborů v cyklech |

První plný deterministický gate remediace na source
`3af097a058da40d92f855900458fc1e484e71a64` zůstal červený a je zachován jako
důkaz, nikoli přepsán následným během:

| Run | Rozsah | Výsledek | Report SHA-256 |
|---|---|---|---|
| `2026-08-27T08-29-07-007Z` | 279 deterministic suites | 275 PASS / 4 FAIL / 0 BLOCKED | `928eb6590304701a1007ec8fd980de04630e5d044dafa52f70dd4dd83bc5550d` |
| `2026-08-27T08-39-33-848Z` | čtyři opravené sady, diagnosticky nad dirty tree | 4 PASS / 0 FAIL | `3c314178d1e45a6f1c2fb5a58c0631872e5bfe4d2d4cf8b52b3a4130920b9f23` |
| `2026-08-27T08-41-33-095Z` | 279 deterministic suites, clean source `0b7f1c27` | 279 PASS / 0 FAIL / 0 TIMEOUT / 0 BLOCKED / 0 SKIPPED | `a024c7a9632a24b36efa8e3601408d89a78372621f8c4349c1ad52e077991774` |
| `2026-08-27T19-51-19-172Z` | 279 deterministic suites, clean source `9f6e4828` | 279 PASS / 0 FAIL / 0 TIMEOUT / 0 BLOCKED / 0 SKIPPED | `c6c9eb65702f6ccefdf831b27eb5895d375e78aeb682e40c761816fd22663921` |
| `2026-08-27T20-19-10-435Z` | 279 deterministic suites, clean source `9fb3b575` | 278 PASS / 1 FAIL; E2E harness probe interně vypršel na 20 s | `197bf7d76672d4d5074eee3737ab743f2441f5e55d31d554dc2c391545468ab9` |
| `2026-08-27T20-28-35-581Z` | opakovaný clean source `79328185` | `ABORTED / INFRA ENOSPC` po 74 PASS; bez finálního reportu | checkpoint `c4f57ca03699c4ad17b30385fff60e5e39a30b9c8ccfd979a63b39c4e9456336` |
| `2026-08-27T20-32-24-822Z` | 279 deterministic suites, clean source `79328185` | 279 PASS / 0 FAIL / 0 TIMEOUT / 0 BLOCKED / 0 SKIPPED | `6bc0e13c40de73606024bf25c9f567992c50a581e8d9b602cca402b92f52ae3f` |

Selhání byla: role-less governor fixture, neaktuální 096/83 migrační oracle,
reviewed Gate 0 fingerprint stále na 278 sadách a meta-test, který zaměnil
cizí pre-existing ignored runtime za svůj leak. Product/test commit `5f89bc36`
opravil všechny čtyři tehdejší příčiny; focused audit už zahrnoval skutečnou
auditní větev harnessu. Po nálezu ABA a osiřelé failover autority prošel nový
plný gate nad čistým `9f6e4828`, se sériovou concurrency 1 a bez povolených
blocker bypassů. Jeho inventory SHA-256 je
`2a4bade6ec5801fa828c9ef27d5d9f24dee42ddfed9b3bb6293196e42e173ca9`.
Po scoring response-attestation první plný gate pravdivě selhal na interním
20s meta-test limitu. Samostatná reprodukce prošla za 1,93 s; limit širokého
importového probe byl proto zvýšen na 60 s uvnitř nezměněného 120s suite
stropu. Další pokus byl přerušen plným `/home`; pět disposable runtime stromů
bylo beze smazání přesunuto do
`/tmp/intentsmith-gate-runtime-archive-owgAn5it`, zatímco reporty, inventory a
logy zůstaly. Finální clean rerun na `79328185` prošel 279/279. Jeho inventory
SHA-256 je
`51a3e282b9da9d43a8081e5765a30d9698542beff1c0759ea0709150f1813419`.
Poslední nezávislý gate 278/278
patří zamítnutému `74beafea`; nelze jej vydávat za nezávislý důkaz tohoto
kandidáta. Zbývající bránou je nové nezávislé rereview.

## Strict-role scoring panel — aktualizace 2026-08-28

Původní panel 28/11/52 byl před live během správný historický snapshot. Po
autorizovaném scoringu a live migraci ukazuje aktuální read model:

| Role | COMPLETE | BLOCKED | raw MISSING | applicable MISSING | NOT APPLICABLE |
|---|---:|---:|---:|---:|---:|
| D1 | 6 | 3 | 4 | 0 | 4 |
| D2 | 6 | 3 | 4 | 0 | 4 |
| R1 | 6 | 3 | 4 | 0 | 4 |
| CODE | 7 | 3 | 3 | 0 | 3 |
| R2 | 7 | 3 | 3 | 0 | 3 |
| CHAT | 6 | 2 | 5 | 0 | 5 |
| VISION | 2 | 0 | 11 | 0 | 11 |
| **Celkem** | **40** | **17** | **34** | **0** | **34** |

U CODE a R2 jsou tři raw MISSING současně tři NOT APPLICABLE. Current
timestampy jsou od `2026-08-25T20:25:50.055Z` do
`2026-08-28T14:45:38.355Z`. Read model vidí 52 role-consistent decisions,
11 quarantined historických decisions a žádné actionable. Standalone odečet
je správně `UNVERIFIED_RUNTIME` pro všech sedm rolí.

Scoring všech použitelných role/category párů je hotový:
`applicable MISSING=0`. Raw MISSING zůstává viditelný jako absence runu, ale
je explicitně oddělený od coverage a nepředstírá score pro nesmyslné dvojice,
například textový model ve VISION.

## Bounded raw host/DB snapshot

Raw JSON:
[`model-evaluation-host-db-snapshot-20260827-post-gate.json`](model-evaluation-host-db-snapshot-20260827-post-gate.json)

| Položka | Hodnota |
|---|---|
| snapshot SHA-256 | `ae23c7d9d649d267718ac3499b46618c202adde1ef0628503cd8c49dd5c4e34d` |
| živá source DB SHA-256 před i po | `e22d580f26b9b467eb2bf3774524206b3d95a36cdcdbc3902a08046e9e12c088` |
| disposable projected DB SHA-256 | `dd8137892b09217a1ff112913d9fc2ee34fd8f4b1b9c1cf6fc4a1805a48f8ba7` |
| projected DB | `quick_check=ok`, 88 historických/current stampů, 169 fyzických tabulek |
| import audit | 664 ARCHIVED detailů, 92 VERIFIED summary, 0 QUARANTINED |
| decisions po 097 | 22 current + 11 quarantined |
| v123 tabulky po projekci | 0 |
| telemetry blacklist tabulka po 099 | 0 |

Vyšší počty stampů/tabulek v projekci živé DB oproti fresh schema nejsou
ztráta dat: živá DB nese starší adoptované a integrační větve. Snapshot proto
uvádí oba počty odděleně a nesnaží se je sjednotit. V2 raw evidence navíc nese
přesnou invocation, sama vytvořila dosud neexistující disposable DB přes SQLite
backup, vyjmenovala aplikované migrace, je označená `post-gate` a obsahuje
source summary před i po celé projekci.

## Provider attestation — systémový blocker a bounded scoring sidecar

Na hostu nainstalovaná Ollama 0.32.14 neumí naplnit nový exact-response
kontrakt: její oficiální `ChatRequest` přijímá model name a `ChatResponse`
vrací model name, nikoli digest obslouženého artefaktu. Žádná
response-attesting verze není autorizovaně nasazená do systémové služby. Ta
proto zůstává záměrně fail-closed: `DURABLE` gateway volání skončí
`LLM_BINDING_ARTIFACT_UNVERIFIED`, manual verification skončí
`MODEL_BINDING_VERIFICATION_ARTIFACT_UNVERIFIED` a scoring přes systémový
provider skončí
`MODEL_EVALUATION_RESPONSE_ARTIFACT_UNVERIFIED`, dokud před Ollamou není
důvěryhodná response-attesting provider capability. Mutable pre/post inventory
tuto mezeru nesmí nahrazovat. Viz oficiální
[API typy 0.32.14](https://github.com/ollama/ollama/blob/v0.32.14/api/types.go),
[OpenAPI schema 0.32.14](https://github.com/ollama/ollama/blob/v0.32.14/docs/openapi.yaml).

Systémový provider se nezměnil a plně ověřený durable LLM runtime proto zůstává
blokovaný. Live scoring ale proběhl přes izolovaný sidecar sestavený z přesného
tagu 0.32.14 s minimálním response-digest patchem. Preflight prokázal exact
digest a plný VRAM placement; sidecar byl po scoringu zastaven. Nejde o
obcházení autority ani o skryté nasazení. Úplná evidence je v
[`model-scoring-live-20260828.md`](model-scoring-live-20260828.md).

## Discovery a bezpečný provoz

Remediace nespustila outbound discovery. Následný běh 2026-08-28 spustil pouze
installed panel, bez pullu a bez `--allow-removal`. Metadata discovery nadále
nejsou quality score, blacklist, doporučení ani povolení k aktivaci.

Snapshot potvrzuje:

- `intentsmith-model-hunt.timer`: `disabled`, `inactive`;
- `intentsmith-model-hunt.service`: `inactive`;
- žádný naplánovaný hunt timer;
- po ukončení sidecaru prázdné `ollama ps`;
- po ukončení sidecaru žádný NVIDIA compute proces.

Historický `post-gate` snapshot z `2026-08-27T22:40:38+02:00` zachovává
tehdejší byte-identickou source DB se SHA-256 `e22d580f...`. Následující
autorizovaná live migrace a scoring z 2026-08-28 jsou odděleně doložené novým
snapshotem; starý hash se proto nesmí vydávat za aktuální.

Timer se nezapnul. Sériový GPU-only běh uzavřel všech 57 použitelných buněk;
čtyři příliš velké artefakty byly automaticky vyřazeny jako `BLOCKED` se
`score=NULL`. Systémové nasazení response-attesting provider capability a nové
nezávislé rereview coverage změny zůstávají otevřené.

## Review handoff

Remediační rozsah `74beafea..26ab3291` už nezávislým Opus max rereview prošel.
Nové rereview má začít na pre-scoring headu
`b0f94196422d868179e58ac588e55fcfcd96589f` a pokrýt celý navazující candidate.
Musí ověřit sdílenou applicability policy v queue/read modelu/overview, raw
MISSING versus applicable MISSING, fail-closed oddělení auto-cleanupu,
provider source commit a preflight, live DB snapshot, nulové automatické
smazání/aktivace a exact current timestamps.
Do tohoto PASS zůstává nový stav
`SCORING_COMPLETE / SYSTEM_PROVIDER_BLOCKED / REREVIEW_REQUIRED`.
