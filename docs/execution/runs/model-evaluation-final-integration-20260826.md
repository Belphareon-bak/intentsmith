# Model evaluation — remediační integrační handoff (2026-08-27)

**Stav:** `IMPLEMENTATION_GREEN / REREVIEW_REQUIRED`

**Poslední zamítnutý candidate:** `74beafea439fdddbbb54e797d351dfe180b2d5f7`

**Implementační candidate:** `13413117fb0269beda2f6495b13a1018ca3a0781`

Tento report nahrazuje chybný panel 40/17/34 z předchozí verze dokumentu.
Nejde o nezávislé přijetí. Timer zůstává vypnutý a žádný GPU scoring se v
remediaci nespouštěl.

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
- `DURABLE` nyní nese exact jméno i digest všech rolí. Registry vyžaduje
  aktuální provider inventory. Gateway znovu ověří digest před provider POST
  uvnitř shared model-use lease a po odpovědi; neprokazatelnou nebo driftující
  odpověď zahodí a usage nezapíše jako úspěch.
- Runtime telemetry zůstává pouze raw diagnostická evidence. Veškerý výpočet
  telemetry blacklistu, veto ručního bindingu, skrytý discovery filtr i
  `runtime_state` API byly odstraněny. Migrace 099 odstraňuje starou odvozenou
  tabulku `model_runtime_guard`.
- Osiřelé `applyWinningBindings()` a `runExclusiveAutomaticFailover()` včetně
  jejich testů byly odstraněny. Detekční/auditní failover schema není proof
  issuer ani aktivační cesta.
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
| model evaluation read model včetně D1→D2/R1 negative | 10/10 PASS |
| pairwise role cache | 34/34 PASS |
| registry current authority | 13/13 PASS |
| gateway/model-use exact digest | 26/26 PASS |
| registry validace | 448 programů; fingerprint `0da4a318503be9cb05edb4ad3757d3c6d565ac61f28cc9db6473cb12a7196bcd` |

Plný deterministický gate nové revize v okamžiku tohoto implementačního
milníku ještě nebyl spuštěn. Poslední nezávislý gate 278/278 patří zamítnutému
`74beafea`; nelze jej vydávat za důkaz tohoto kandidáta. Nový gate a nové
nezávislé rereview jsou samostatné zbývající brány.

## Aktuální strict-role scoring panel

Read-only `ModelEvaluationReadModel` nad 13 přesnými artefakty a disposable
projekcí živé DB v `2026-08-27T08:08:10.418Z`:

| Role | COMPLETE | BLOCKED | MISSING | FAILED |
|---|---:|---:|---:|---:|
| D1 | 5 | 3 | 5 | 0 |
| D2 | 1 | 0 | 12 | 0 |
| R1 | 0 | 0 | 13 | 0 |
| CODE | 7 | 3 | 3 | 0 |
| R2 | 7 | 3 | 3 | 0 |
| CHAT | 6 | 2 | 5 | 0 |
| VISION | 2 | 0 | 11 | 0 |
| **Celkem** | **28** | **11** | **52** | **0** |

Current timestampy jsou od `2026-08-25T20:24:21.425Z` do
`2026-08-25T21:31:09.963Z`. Read model vidí 22 role-consistent decisions,
žádné actionable. Standalone odečet je správně `UNVERIFIED_RUNTIME` pro všech
sedm rolí.

Scoring všech modelů tedy **není hotový**: chybí 52 artifact/role buněk.
Staré contracty ani sdílené suite se do nich nepromítají.

## Bounded raw host/DB snapshot

Raw JSON:
[`model-evaluation-host-db-snapshot-20260827.json`](model-evaluation-host-db-snapshot-20260827.json)

| Položka | Hodnota |
|---|---|
| snapshot SHA-256 | `a2a4c17d969716c2366bd872bf60bf5ee0d336e0bbe5a33da06006ce420967f4` |
| živá source DB SHA-256 před i po | `e22d580f26b9b467eb2bf3774524206b3d95a36cdcdbc3902a08046e9e12c088` |
| disposable projected DB SHA-256 | `d349019eef3be9da8a28f861eabf7673cb9b97467814ee10d9e557769c41d7c5` |
| projected DB | `quick_check=ok`, 88 historických/current stampů, 169 fyzických tabulek |
| import audit | 664 ARCHIVED detailů, 92 VERIFIED summary, 0 QUARANTINED |
| decisions po 097 | 22 current + 11 quarantined |
| v123 tabulky po projekci | 0 |
| telemetry blacklist tabulka po 099 | 0 |

Vyšší počty stampů/tabulek v projekci živé DB oproti fresh schema nejsou
ztráta dat: živá DB nese starší adoptované a integrační větve. Snapshot proto
uvádí oba počty odděleně a nesnaží se je sjednotit.

## Discovery a bezpečný provoz

Remediace nespustila outbound discovery ani model hunt, takže nevytvořila žádné
nové návrhy. Metadata discovery mohou pouze seřadit budoucí měření; nejsou
quality score, blacklist, doporučení ani povolení k aktivaci.

Snapshot potvrzuje:

- `intentsmith-model-hunt.timer`: `disabled`, `inactive`;
- `intentsmith-model-hunt.service`: `inactive`;
- žádný naplánovaný hunt timer;
- prázdné `ollama ps`;
- žádný NVIDIA compute proces.

Timer se nesmí zapnout a 52 chybějících buněk se nesmí spustit před novým
nezávislým PASS. Potom musí běžet sériově, GPU-only; model, který se celý
nevejde do VRAM, se automaticky vyřadí jako `BLOCKED` se `score=NULL`.

## Review handoff

Nové rereview musí začít na zamítnutém base `74beafea` a pokrýt implementační
commity `d5518d4d` a `13413117` i navazující dokumentační/gate evidence.
Zvlášť má reprodukovat role leakage D1→D2/R1, cross-role decision insert,
pre-082 backup upgrade, nullable duration, same-tag digest drift před i po
gateway response, nulový telemetry veto call graph a absenci osiřelých
auto-activation API. Do jeho PASS zůstává pravdivý stav
`IMPLEMENTATION_GREEN / REREVIEW_REQUIRED`.
