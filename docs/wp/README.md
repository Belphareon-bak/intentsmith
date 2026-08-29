# docs/wp — zadání práce

**Adresát:** agent, který dostane konkrétní zadání · operátor při rozhodování `§14`
**Datum:** 2026-08-07 · **Vstupní revision:** `1fc8f03e` u P2–P5 a obou WP,
`13701b2a` u P6

Soubory zde jsou **zadání**, ne stav a ne evidence. Jsou to položky
`ROADMAP.md §12` — osm bodů aktivního Work Package — sepsané dřív, než se WP
aktivuje, plus zadání read-only sond.

**Tohle není board.** Stav práce je podle `CONTRACT.md §6` výhradně
v `ROADMAP.md` a v příslušné inventuře. Zde se nic neaktualizuje, neoznačuje
jako hotové ani nesleduje. Když zadání doběhne, výsledek jde tam, kam ho
posílá jeho sekce „Výstup" — ne sem.

| Soubor | Typ | Stav | Výsledek |
|---|---|---|---|
| [P2-L0-8-IMPORT-GRAPH](P2-L0-8-IMPORT-GRAPH.md) | read-only sonda | **doběhla 2026-08-07** | [L0-8-BOUNDARY](../review/2026-08-07-L0-8-BOUNDARY.md) |
| [P3-OUTBOUND-CENSUS](P3-OUTBOUND-CENSUS.md) | read-only sonda | **doběhla 2026-08-07** | [OUTBOUND-CENSUS](../review/2026-08-07-OUTBOUND-CENSUS.md) |
| [P4-AUTH-MATRIX](P4-AUTH-MATRIX.md) | read-only sonda | **doběhla 2026-08-07** | [AUTH-MATRIX](../review/2026-08-07-AUTH-MATRIX.md) |
| [P5-SECRET-TYPES](P5-SECRET-TYPES.md) | read-only sonda | **doběhla 2026-08-07** | [SECRET-TYPES](../review/2026-08-07-SECRET-TYPES.md) |
| [P6-MODULE-GRAPH](P6-MODULE-GRAPH.md) | read-only sonda | **doběhla 2026-08-07** | [MODULE-GRAPH](../review/2026-08-07-MODULE-GRAPH.md) + měřidlo a JSON |
| [P7-ENFORCEMENT-AUDIT](P7-ENFORCEMENT-AUDIT.md) | read-only sonda | **doběhla 2026-08-07** | [ENFORCEMENT-AUDIT](../review/2026-08-07-ENFORCEMENT-AUDIT.md) |
| [WP-M5-PACKAGE](WP-M5-PACKAGE.md) | zapisující WP | **REVIEW_PASSED** | [M5 PACKAGE + OBSERVE remediation](../execution/runs/m5-package-observe-remediation-20260826.md) |
| [WP-M5-DATA](WP-M5-DATA.md) | zapisující WP | **second-review remediation implemented / re-review required** | [M5 DATA remediation](../execution/runs/m5-data-remediation-20260826.md) |
| [WP-M5-PROCESS](WP-M5-PROCESS.md) | zapisující WP | **REVIEW_PASSED** | [M5 PROCESS remediation](../execution/runs/m5-process-remediation-20260826.md) |
| [WP-M5-OBSERVE](WP-M5-OBSERVE.md) | zapisující WP | **REVIEW_PASSED** | [M5 PACKAGE + OBSERVE remediation](../execution/runs/m5-package-observe-remediation-20260826.md) |
| [WP-M5-OUTBOUND](WP-M5-OUTBOUND.md) | zapisující WP | **REVIEW_PASSED** | [M5 transport remediation](../execution/runs/m5-auth-outbound-remote-remediation-20260826.md) |
| [WP-M5-PERF](WP-M5-PERF.md) | zapisující WP | **second-review remediation implemented / re-review required** | [M5 PERF report](../execution/runs/m5-perf-20260826.md) |
| [WP-M5-REMOTE-PORT](WP-M5-REMOTE-PORT.md) | zapisující WP | **REVIEW_PASSED** | [M5 transport remediation](../execution/runs/m5-auth-outbound-remote-remediation-20260826.md) |
| [WP-M5-CONDITIONAL-SURFACES](WP-M5-CONDITIONAL-SURFACES.md) | zapisující WP | **REVIEW_PASSED** | [M5 transport remediation](../execution/runs/m5-auth-outbound-remote-remediation-20260826.md) |
| [WP-M5-PRIVACY](WP-M5-PRIVACY.md) | zapisující WP | **second-review remediation implemented / operator remediation required / re-review required** | [M5 PRIVACY report](../execution/runs/m5-privacy-20260826.md) |
| [WP-M6-RELEASE](WP-M6-RELEASE.md) | zapisující WP | **aktivní; implementace povolena, acceptance brány zůstávají zavřené** | — |
| [WP-M6-OPERATOR-DEMO-PREP](WP-M6-OPERATOR-DEMO-PREP.md) | zapisující M6 příprava | **IMPLEMENTED / REVIEW_PENDING / REAL DEMO NOT RUN** | [M6 operator demo runbook](../review/M6-OPERATOR-DEMO-RUNBOOK.md) |
| [WP-M7-MOBILE-CONTRACT-INTEGRATION](WP-M7-MOBILE-CONTRACT-INTEGRATION.md) | zapisující M7 connector prep | **IMPLEMENTATION_GREEN / FULL_GATE_GREEN / REVIEW_PENDING / PROVIDER_ABSENT / TRANSPORT_ABSENT** | [candidate contract](../mobile/REMOTE-CAPABILITY-CONTRACT-V1-CANDIDATE.md) |
| [WP-M7-MOBILE-CLIENT-INTEGRATION](WP-M7-MOBILE-CLIENT-INTEGRATION.md) | zapisující M7 client/Android integration | **client/Android scope; production transport and signing excluded** | [integration report](../execution/runs/m7/m7-mobile-client-integration-20260829.md) |
| [WP-M7-IN-PROCESS-CAPABILITY-PROVIDER](WP-M7-IN-PROCESS-CAPABILITY-PROVIDER.md) | zapisující M7 provider prerequisite | **IMPLEMENTATION_GREEN / FULL_GATE_GREEN / REVIEW_PENDING / NOT_ACTIVE** | [provider report](../execution/runs/m7/m7-in-process-capability-provider-20260829.md) |
| [WP-M7-PERSISTENT-MUTATION-JOURNAL](WP-M7-PERSISTENT-MUTATION-JOURNAL.md) | zapisující M7 recovery prerequisite | **IMPLEMENTATION_GREEN / FULL_GATE_PENDING / REVIEW_PENDING / NOT_ACTIVE** | — |
| [WP-M1-BINDING-REPOSITORY](WP-M1-BINDING-REPOSITORY.md) | zapisující WP | **dokončeno** na `515fb6f7`, evidence `eb7e78b8` | [WP-M1-MODEL report](../execution/runs/wp-m1-model-report.md) |
| [WP-M1-BINDING-APPLICATION](WP-M1-BINDING-APPLICATION.md) | zapisující WP | **dokončeno** na `e7d89b5e`, fresh-clone evidence `9b71c741` | [WP-M1-MODEL report](../execution/runs/wp-m1-model-report.md) |
| [WP-M1-BINDING-FINALIZE-RECOVERY](WP-M1-BINDING-FINALIZE-RECOVERY.md) | zapisující WP | **fresh-clone verified** na `7c4aa73c`; review range `0a6bde54..7c4aa73c` | [Finding 008](../findings/008-model-binding-commit-point-split.md) |
| [WP-M1-MODEL-CLEANUP-AUTHORITY](WP-M1-MODEL-CLEANUP-AUTHORITY.md) | zapisující WP | **C1 + C2a + C2b gateway/binding fresh-clone / PARTIAL; 4/5 live paths**, C2a source `9b4d9f79`, baseline `19d63e1b`; gateway source `7ccd8a58`; binding source a clean-clone target `cfcb63dd`, exact-edge baseline `175d5f31`; evidence je commit obsahující tento stav | [WP-M1-MODEL report](../execution/runs/wp-m1-model-report.md) |
| [WP-M1-BOUNDARY-RATCHET](WP-M1-BOUNDARY-RATCHET.md) | zapisující WP | **technicky dokončeno**; hardening integrován v `ec98803a`, baseline `b05392e1`; procesní pilot invalidován | [IMPORT-CENSUS](../review/2026-08-09-IMPORT-CENSUS.md) + [LIFECYCLE-PARITY](../review/2026-08-09-LIFECYCLE-PARITY.md) |
| [WP-MODEL-EVALUATION-CONSOLIDATION](WP-MODEL-EVALUATION-CONSOLIDATION.md) | zapisující WP | **ACCEPTED** na `d8a2a108`; nezávislý rereview `PASS`, první candidate zůstává historicky `CHANGES_REQUESTED` | [remediation evidence](../execution/runs/model-evaluation-consolidation-review-remediation-20260825.md) |
| [WP-M3-L0-8-ENFORCEMENT](WP-M3-L0-8-ENFORCEMENT.md) | zapisující WP | **nezahájeno**; odemčeno rozhodnutím 019 | — |
| [WP-M3-L0-8-INJECTION](WP-M3-L0-8-INJECTION.md) | zapisující WP | **nezahájeno**; odemčeno rozhodnutím 019 | — |
| [WP-M5-OUTBOUND-GATE](WP-M5-OUTBOUND-GATE.md) | zapisující WP | **nezahájeno** | — |
| [P8-DISABLED-BOOT](P8-DISABLED-BOOT.md) | read-only sonda | **nezahájena** | — |
| [P9-OUTBOUND-LONG-HORIZON](P9-OUTBOUND-LONG-HORIZON.md) | read-only sonda | **nezahájena** | — |
| [P10-CORE-OPTIONAL-MAP](P10-CORE-OPTIONAL-MAP.md) | read-only sonda | **nezahájena** | — |

Zadání sondy zůstává i po doběhnutí — je v něm postup a ověřovací příkaz, kterým
si lze výsledek přeměřit. Sloupec „stav" je tady jediná výjimka z pravidla, že se
zde stav nesleduje; drží ho, aby nikdo nespustil hotovou sondu podruhé.

Historické aktivační podmínky M5 PACKAGE/DATA jsou zachované v jejich zadáních.
Tyto bloky i OBSERVE už mají implementační kandidáty; nejde však o acceptance,
dokud neproběhne operátorské review a nezavře se nadřazená M3 brána.

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

## Dávka nezávislé práce k `0a6bde54`

Šest zadání níže vzniklo jako odpověď na otázku, co posouvá produkt k
production-ready **bez** dotyku s běžící M1 dávkou. Nejsou to nové milníky ani
nový track; každé má domov v existujícím WP nebo kroku
[`2026-08-08-MODULE-INDEPENDENCE`](../review/2026-08-08-MODULE-INDEPENDENCE.md) §7.

| Zadání | Sloty | Uzavírá |
|---|---|---|
| `WP-M3-L0-8-ENFORCEMENT` | zapisující | L0-8 přestává být neviditelný |
| `WP-M3-L0-8-INJECTION` | zapisující | L0-8 přestává být porušený |
| `WP-M5-OUTBOUND-GATE` | zapisující | jedna plocha L0-12 |
| `P8-DISABLED-BOOT` | žádný | podmínka 5 nezávislosti modulů |
| `P9-OUTBOUND-LONG-HORIZON` | žádný | `NOT RUN` horizont u L0-12 |
| `P10-CORE-OPTIONAL-MAP` | žádný | vstup kroku A2 |

**Kapacita.** `CONTRACT.md §6` dovoluje projektově nejvýše tři zapisující WP,
v jednom checkoutu vždy právě jeden. M1 drží jeden slot, takže volné jsou dva —
tři zapisující zadání se tedy **nespouštějí najednou**. Doporučené pořadí je
`WP-M3-L0-8-ENFORCEMENT` + `WP-M3-L0-8-INJECTION` souběžně (disjunktní cesty,
integrace enforcement první), `WP-M5-OUTBOUND-GATE` až po uvolnění slotu.

Tři sondy slot nespotřebují, ale **žádná z nich není filesystem-read-only** —
každá vytváří DB, logy nebo JSON výstup. Sdílený checkout proto použít nesmějí;
patří jim vlastní checkout nebo izolovaný artifact root.

Historická sekce níže popisuje původní frontu z roku 2026-08-08; aktuální M5
stav a zbývající brány jsou autoritativně vedené v `ROADMAP.md` §9.
