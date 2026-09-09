# Core completion: navazující měření M6 — 2026-09-09

## Aktuální evidence checkpoint — 2026-09-09 18:28 UTC

Stav: **TECHNICAL_COMPLETION_IN_PROGRESS / MODEL_FAILURES_OPEN / NOT_RELEASE_READY**.
Dokončené běhy této aktualizace mají hlavní měřený source
`2be9f521a831da0c6f3ca440662611f05b70bf31`. Oprava přímého LLM1 helperu
je samostatně v `109582d5`; kalibrace 6144 je pouze v privátním `a0b4c299`.
[Fakta a raw hashe k 18:28:00 UTC][facts1828] tyto zdroje oddělují.
Dokument ani jeho commit nejsou novým měřením; runtime JSON provideru se
textem nemění. Starší checkpointy níže zůstávají historickou evidencí.

| Source | Rozsah | Výsledek a hranice | Důkaz |
|---|---|---|---|
| `2be9f521` | Všech 352 required deterministic programů | **352 PASS**, 279 offline + 73 database, bez FAIL/TIMEOUT/BLOCKED/SKIPPED; existující dependencies, původní phase validator PASS | [report][d2be], [nezávislé review][d2ber] |
| `2be9f521` | Původní expertise routing a lifecycle context loss, běh 02 | **2 programy PASS: 43/43 + 27/27**, 17:55:37–17:56:55 UTC, původní ID/argv, bez retry a leaků | [report a raw hashe v review][followup2r] |
| `2be9f521` | Původní LLM1 | **15 PASS / 1 FAIL**, konec 18:06:23 UTC; jediný neúspěch 2.3 má prázdnou viditelnou odpověď při `length` | [nezávislé review a raw páry][llm1r] |
| `2be9f521` | Původní LLM2 | **17 PASS**, konec 18:07:47 UTC; 12 úplných provider odpovědí `stop` a pět skutečných trvalých M2_LOCAL výsledků | [nezávislé review a raw/DB hashe][llm2r] |
| `a0b4c299` | Privátní profil 6144, původní T3 pilot | **Physical PASS / REVIEW_PASSED**, 18:13:23–18:18:51 UTC; původní cookbook následně **FAIL**, konec 18:27:07 UTC; **NOT_ACTIVATED** | [report][calibration-report], [inner][calibration-inner], [root výsledek][calibration-result], [nezávislé fyzické review][calibration-physical-review] |

Guard6 má ve stejném skutečném rozhodnutí povinný pozitivní witness
`classifiedBy=llm`, `initialIntent=SEARCH`, `finalIntent=CREATIVE`, stejný
vrácený intent a `guard6_creative_override`; jde o ANSWER bez tools/slots.
Raw artefakt uchovává všech 39 rozhodnutí. Lifecycle 27/27 potvrzuje původní
routing aserce, nikoli uživatelský výpis souborů: 15 dotazů vylučuje
FILE_READ/FILE_EXPLAIN, devět dovoluje FILE_READ/FILE_EXPLAIN/LOCAL, jedna
kontrola požaduje nenulový intent a dvě ověřují lokální formátování.
`file.list` zůstává UNAVAILABLE. První dvouprogramový pokus skončil po chybě
PATH preflightu vlastním SIGTERM: **1 FAIL / 1 SKIPPED**, s 13 úspěšnými
callbacky před přerušením. Běh 02 jej nepřepisuje; nebyl to pokus bez efektů.

LLM1 selhání je jiná hranice než plný kontext SPEC: přímý helper neposlal
`think`, request měl výstupní limit 512, prompt 72 a odpověď skončila po
512 výstupních tokenech s 1913 znaky v `thinking` a nulovým `content`.
[Revidovaná oprava][llm1fixr], integrovaná v `109582d5`, přidává pouze
`think:false`, shodně s produkční gateway. Všech 16 případů, původní aserce
i limit 512 zachovává. Osm inertních kontrol prošlo; nový skutečný běh této
opravené sady zatím není součástí checkpointu. Výsledek `2be9f521` zůstává FAIL.

LLM2 raw capture potvrzuje jediný přesný model/digest, `num_ctx=4096`,
`think:false`, 12× HTTP 200 / `stop` bez relay chyby či zkrácení. Pět dvojic
ToolRequest/ToolResult je skutečně PURE/DIRECT a úspěšných: calendar 2,
date 2, math 1; odpovídají logu i uloženým výstupům. Privátní DB obsahuje
16 zpráv, žádný effect request/result/link a žádný řádek `model_usage`.
Tento běh tedy neprokazuje trvalý audit modelového použití. Kvalitativní
limity zůstávají: odpověď 7.1 obsahuje „nemám přístup k živým zprávám“,
ačkoli tato aserce ověřuje pouze češtinu; 7.4 neasertuje angličtinu,
pouze délku. PASS nepokrývá obecnou kvalitu odpovědí ani kompletní životní cyklus projektu.

Pokus s dvoudílnou SPEC skončil [prokázaným neúspěchem][splitr]: foundation
2065+1103 tokenů / `stop` prošel dílčím strukturálním validátorem, ale
remaining 3226+870 / `length` opět vyčerpal 4096 a nedal úplný JSON.
V částečném textu je navíc angličtina a `sensitive_data` jako string místo
pole. To není validovaná specifikace. Kompaktní ani dělený prompt nebyl
přijat jako produktová oprava; dělení se dál nerozšiřuje a žádná vstupní
fakta se nevynechávají, aby výsledek prošel.

Privátní `a0b4c299af5081a41d7960050bc704146de1866f` používá společný profil
6144 pro produkt i pilot při stejném modelu/digestu, rezervě nejméně
1024 MiB, 100% GPU residency a zákazu fallbacku. Hlavní produktový profil
zůstává 4096. Podle Decision 009/A je to další kalibrace; označení PRIVATE
nevytváří nový schvalovací požadavek. [Nezávislé fyzické review][calibration-physical-review]
je uzavřené: čtyři původní requesty při 6144, minimum 5868 MiB, 100% GPU
residency a přirozené vyprázdnění po 302810 ms. Pilot uchovává souhrn
195 vzorků s průměrným intervalem 128,43 ms, nikoli pole všech raw vzorků.
Produkční VRAM estimator zůstává UNKNOWN. Provozní PASS sám neprokazuje
kvalitativní cíl. Následný [původní cookbook][cookbook6144-report] na stejném
`a0b4c299` skončil **1 FAIL**, 18:19:16–18:27:07 UTC; [root výsledek][cookbook6144-root]
má exit 1, neaktivní scope a čistý source. Nezávislé rozebrání jeho raw
odpovědí k checkpointu ještě není dokončené; kvalita ani profil nejsou přijaty.
Původní 8192 FAIL zůstává zachován. [Připravené porovnání B][bprep]
nezjistilo prokázaného vítěze pro D1; staré skóre a metadata jiného kontextu
nejsou přijetím 6144 ani oprávněním změnit modelový binding.

[Zachovaný prefix soak logu][soak1828] na `193e2351` potvrzuje čtyřhodinový
heartbeat: `elapsedMs=14401002`, `requests=14402`, `errors=0`, přibližně
18:18:56 UTC. To není dokončený 24hodinový soak ani výsledek novějšího SHA.

M5 externí fakta/custody/history/podpisy, skutečné dokončení dlouhého soaku,
zbývající kvalita a společný release gate/review/demo/acceptance jsou otevřené.
Nejde o **413 PASS na jednom SHA**, M6 PASS ani dokončený release.

## Historický checkpoint — 2026-09-09 17:08 UTC

Stav: **TECHNICAL_COMPLETION_IN_PROGRESS / MODEL_FAILURES_OPEN / NOT_RELEASE_READY**.
Runtime checkpoint: **2026-09-09 17:08:54 UTC**, čistý source
`6fccb1c2685c0a55eaf5830c76a68173543a692f`.
Autorita: [WP-CORE-COMPLETION](../../../wp/WP-CORE-COMPLETION-20260909.md).
Navazuje na [aktivaci provideru](provider-activation-20260909.md).
Tento dokument ani jeho budoucí commit nejsou novým měřeným source SHA.
Doplnění v 17:09:59 UTC zaznamenává pouze dokončené Guard6 source review.
Samostatné doplnění níže zachycuje přerušení v 17:21 a nový běh v 17:22 UTC.

## Dokončené běhy podle přesného source

| Source | Rozsah | Skutečný výsledek a hranice | Důkaz |
|---|---|---|---|
| `69b52278` | Všech 352 required deterministic programů | **352 PASS, 0 FAIL/TIMEOUT/BLOCKED/SKIPPED**; 279 offline + 73 database, existující dependencies v owned checkoutu | [report][d69], [nezávislé review][d69r] |
| `3b026f40` | Čtyři původní fresh-clone programy | **4 PASS**; skutečná offline npm/Yarn instalace a produkční Studio build; sedm release souborů hashově svázáno | [report][f3b], [nezávislé review][f3br] |
| `828dd4b3` | C12, executor, workflow; pětiprogramový batch | Tyto tři programy **PASS**, celý batch **3 PASS / 2 FAIL** (chat quality a lifecycle context) | [report][fix5] |
| `69b52278` | Chat quality; tříprogramový diagnostics batch | Chat quality **33 PASS / 0 FAIL / 1 WARN**; celý batch **1 PASS / 2 FAIL** | [report][diag], [raw chat log][cqt] |
| `6fccb1c2` | Registrovaná chat persistence | **1 program PASS, všech 36 interních kontrol PASS**, včetně skutečně awaitované singleton kontroly | [report][persist], [nezávislé review][persistr] |
| `69b52278` | Expertise routing | **35/43 PASS, 8 FAIL**; uchováno všech 39 skutečných rozhodnutí; nová Guard6 oracle oprava má pouze source review | [triage][guardtriage], [návrh a review][guardreview] |
| `599ec10a` | Explicitní project listing routing | Integrovaná oprava má **9 focused PASS**; `file.list` zůstává **UNAVAILABLE**, nikoli funkční výpis adresáře | [focused review][listing] |
| `da782aea` | M5 podmíněné credential resolution | **45 focused PASS** (24 + 6 + 15) a integrační source review; žádná skutečná N/A evidence ani acceptance nebyla vystavena | [integrační review][m5] |

Full deterministic běh ověřuje přesný seznam, všechny log hashe, checkpoint,
čistotu source a cleanup; původní phase validator vrací `valid: true`.
Použil explicitně připnutý místní Python PDF runtime. Není to fresh install.
Fresh-clone běh samostatně ověřuje M1 journey, upgrade předchozí verze,
Studio Electron boundary a Studio M1 journey. M1 vnitřní kontrakt má 29/29,
real provider response digest je ověřen a původní release validator přijímá
všech sedm zachovaných build souborů; vlastněný clone byl čistě odstraněn.
Tohle není součet **413 PASS na jednom kandidátu** ani release acceptance.

## Co je opravené a co výsledek neprokazuje

Reviewed registry refresh `573c7d92` sjednotil seal s fingerprintem
`3ce12a0edffe7e6da0f875ce3f0b25758524641557023d00aae39d0784fdbbfc`.
Registry má 512 programů, 413 ACTIVE + required a 19 support exclusions.
Všech 511 předchozích programových řádků zůstalo zachováno; přibyl jeden
required offline mobile program a přesná podpůrná 061 fixture. Rovnost seal,
required/ACTIVE kontroly ani negativní self-testy nebyly oslabeny.
[Párové baseline FAIL / candidate PASS a review][seal] předcházely dnešnímu
352/352 běhu. Historický `a71e5b98` zůstává **351 PASS / 1 sealed FAIL**.

[Skutečné A/B replaye stejného provider requestu][ab] prokázaly nedostatečný limit
256 tokenů u emailu a 64 u `Python` / `?`; při vyšším limitu stejný seed
skončil `stop` na 678 / 127 / 84 tokenech. [Projektový pár 128/256][abproject] naopak
skončil v obou případech na 102 tokenech; tuto vadu nereprodukoval.
Přímé provider A/B obchází produktový handler/finalizer; původní email ještě
neměl nový 150slovný scope. Tyto replaye nejsou nový registrovaný PASS.
Oprava `fa573c41` upravila headroom a rozsah emailu, zachovala strict finalizer.
Následný [skutečný šestipoložkový panel][panel] na tomto source má šest HTTP 200
s `finish=stop`, exact digest a řádnou private DB persistence. Samostatné
haiku/regex sondy nereprodukují původní vícetahový kontext celé modelové sady.

Chat-quality WARN zůstává: populační odpověď neobsahuje čísla, protože
neautorizovaný nástroj vrací poctivé odmítnutí. Opravená pozitivní EN
heuristika zachovává požadavek na angličtinu; není úplný jazykový posudek.
Guard6 návrh nemění produkt: pouze SEARCH/AMBIGUOUS musí přes přesný marker
přejít na CREATIVE; CONVERSATIONAL/CREATIVE se zachovají a emitují ANSWER.
Skutečný pozitivní SEARCH witness a explicit-search/effect/analyst výjimky
zůstávají. Nezávislé source review a 46 inertních kontrol prošly;
nový registrovaný modelový výsledek zatím není součástí tohoto checkpointu.

Listing oprava řeší routing před modelovou arbitráží. Existující M2 consumer
záměrně nevydá obsah přes nepodporované `file.list`; nepřibylo filesystem
oprávnění. Původní lifecycle `69b52278` **24 PASS / 3 FAIL** zůstává zachován.
Persistence oprava pouze doplnila chybějící await: předchozí `69b52278`
registrovaný PASS vykonal 35 z 36 deklarovaných kontrol; nový `6fccb1c2`
prokazuje všech 36. Source baseline grafu byl samostatně přijat v `6fccb1c2`
pro jedinou novou pure formatter hranu (1273 → 1274; 3 cykly / 28 souborů).

## Živý stav a dosud nedokončené práce

[Provider checkpoint][runtime] v 17:08:54 UTC znovu ověřil systémovou
Ollamu `0.32.14-intentsmith.1`, binary SHA `72580ab9…6878a` a všech devět
nezměněných modelových digestů. Běžel jeden vlastní `qwen3.5:27b` s digestem
`7653528ba5cba4dd8e19da24aaddc7f4d0b5ecd93571c0825dfd4137958ec06e`.
Checkpoint z 13:06 je zachován byte-for-byte; dnešní controlled/private DB
běhy neprokazují nasazení všech změn do živé DB nebo všechny role modelů.

Containment batch 13 programů na `69b52278` je k tomuto checkpointu
**RUNNING_NO_FINAL_VERDICT**. Dílčí dvě PASS a čtyři FAIL nejsou
konečným součtem. Původní v3 na `828dd4b3` má **13 FAIL / 0 provider requestů**
kvůli runtime/infrastrukturní chybě; tento report nebyl změněn na PASS.
Původní soak/throughput na `193e2351` běží od 14:18:55 UTC, čeká na
24hodinové okno a navazující průchod; nejdřívější konec přibližně
**2026-09-10 14:24 UTC**. Zatím nemá finální verdikt ani platnost pro novější SHA.

M5 kód umí podepsaně rozlišit dokončenou rotaci a prokázanou nepoužitelnost
kategorie; původní validní v1 receipt zůstává beze změny. Chybějící současná
konfigurace sama neprokazuje historické nepoužití. Historická fakta, skutečné
externí credential operace, offline custody, history disposition a pravé
podpisy/acceptance zůstávají nedořešené. Žádná z nich nebyla nahrazena testem.
M7 fyzická matice, produkční konfigurace a podpisy zůstávají samostatné.

Další postup k tomuto checkpointu: dokončit aktivní batch a uchovat každý neúspěch; opravit nebo
přesně zdůvodnit zbývající modelové vady, změřit přijaté source změny; potom
zmrazit jeden kandidát pro požadované M6 fáze a jejich společnou validaci.
M5 externí podmínky, skutečný dlouhý soak, nezávislé release review, demo
operátora a podpisy zůstávají podmínkami přijetí. Technická práce pokračuje
pod již schváleným WP, bez přeznačení starých FAIL nebo přeskočení testů.

## Doplnění po checkpointu — 17:21 až 17:22 UTC

V 17:21:28 UTC root ukončil přesný vlastní nightly proces signálem SIGTERM
kvůli opakované D1 SPEC parse chybě, aby nejdřív zachytil původní provider
odpověď. [Nezměněný report][contained] má **2 PASS / 7 FAIL / 4 SKIPPED**:
šest programů skončilo přirozeným FAIL, jeden byl přerušen a čtyři nebyly
spuštěné. Nejde o 13 dokončených assertion běhů ani o přijetí této fáze.
Všech devět spuštěných programů má `cleanup.checked=true`, žádný hlášený
leak; [záznam zásahu][interruption] odděluje tento vlastní proces od soak
běhu a systémového provideru. Historický checkpoint 17:08 výše zůstává zachován.

Guard6 oracle byla mezitím integrována v `1afaf2a8`; [artifact suite][guardartifact]
má **158 PASS / 0 FAIL / 0 SKIPPED** a [registry kontrola][guardregistry] drží
512 programů se stejným fingerprintem. Jde o source/test změnu, její nový
registrovaný modelový výsledek zůstává nezměřený.

V 17:22:29.526 UTC byl spuštěn [jeden původní cookbook program][cookbook]
na nezměněném `69b52278` přes v5 launcher s privátním zachováním raw POST
requestů a odpovědí. Stav při spuštění je **RUNNING / NO_VERDICT**; tento
addendum neuděluje PASS ani nepřenáší výsledek na `1afaf2a8`. Soak pokračuje
samostatně. Další postup je vyhodnotit raw diagnostiku, prokázat opravu příčiny
a zopakovat potřebné původní programy; ostatní release podmínky se nemění.


## Diagnostika příčiny a navazující přímý pokus

Samostatný cookbook program skončil **1 FAIL**, source zůstal čistý `69b52278`
a vlastní scope je neaktivní. [Přesné raw request/response páry][d1raw]
prokazují u všech pěti generování specifikace `done_reason=length` a součet
prompt/output tokenů přesně 4096: 3061+1035, 3048+1048 a třikrát 2868+1228.
Všechny mají HTTP 200 a správný modelový digest. První analizační volání
skončilo zvlášť `stop` (1074+2118); specifikace se nepodařila načíst.
Příčinou těchto pěti selhání je vyčerpání sdíleného kontextu, nikoli dosažení
samostatného výstupního limitu 4000. Žádný provider profil se tím nemění.
Přímý soukromý pokus s kompaktním zápisem stejných vstupních hodnot také
skončil `length` (2263+1833); tento nepřijatý návrh není produktovou opravou.
Další oprava musí zachovat všechny povinné části, dovolit pouze omezené
modelové kroky a nikdy neuložit neúplnou specifikaci jako hotovou.

## Evidence

Odkazy míří na původní reporty nebo review, které připínají všechny raw hashe.
Nové doplnění připíná contained report SHA-256
`bc24dbb0b129e35a64ec0a84c81c5977434bfd4f18e5107b174bc305d43f7987`;
A/B evidence review SHA-256
`5f24424abeaf2f51a28e2723e1172e71c0a0ff2b0ae4edd03e7daa04e1411dd4`.
Provider checkpoint SHA-256 je
`5c1857df9ed0a669acc642f18bd9757a681a1dd14fbc1a93153d6fc80ad7fa0a`;
[nezávisle ověřená coverage 44 modelových ID][coverage] dokládá výběr všech
původních ID napříč běhy, nikoli společný PASS. Staré `193e2351` safe25
**11 PASS / 14 FAIL**, `828dd4b3` fresh4 **3 PASS / 1 FAIL** i neúspěšný
první build-copy wrapper zůstávají historické; jeho následná hashově přesná
path recovery opravila uchování sedmi build souborů, nikoli výsledek testů.

[d69]: ../../../../.intentsmith-artifacts/core-completion-20260909/deterministic-current/core-deterministic-69b52278-20260909-02/report.json
[d69r]: ../../../../.intentsmith-artifacts/core-completion-20260909/provider-proposal/deterministic-69b52278-independent-review.json
[f3b]: ../../../../.intentsmith-artifacts/m6/candidate-3b026f40521e445c8e7c2da91a262e12704bfdb7/fresh-clone/report.json
[f3br]: ../../../../.intentsmith-artifacts/core-completion-20260909/provider-proposal/fresh-four-3b-independent-review.json
[fix5]: /home/belphareon/is-m6-work09-a7ba5490/repo/.intentsmith-artifacts/m6-fixes5/core-fixes5-828dd4b3-20260909-01/report.json
[diag]: /home/belphareon/is-m6-work09-a7ba5490/repo/.intentsmith-artifacts/m6-diagnostics3/core-diagnostics3-69b52278-20260909-01/report.json
[cqt]: /home/belphareon/is-m6-work09-a7ba5490/repo/.intentsmith-artifacts/m6-diagnostics3/core-diagnostics3-69b52278-20260909-01/logs/tests_chat-quality.test.js.dde7f77e.log
[persist]: ../../../../.intentsmith-artifacts/core-completion-20260909/persistence-gap/core-chat-persistence-6fccb1c2-20260909-02/report.json
[persistr]: ../../../../.intentsmith-artifacts/core-completion-20260909/provider-proposal/chat-persistence-6fccb1c2-independent-review.json
[guardtriage]: ../../../../.intentsmith-artifacts/core-completion-20260909/provider-proposal/expertise-eight-69b52278-triage.json
[guardreview]: ../../../../.intentsmith-artifacts/core-completion-20260909/provider-proposal/expertise-guard6-oracle-69b52278/independent/review-04c431e7.json
[listing]: ../../../../.intentsmith-artifacts/core-completion-20260909/provider-proposal/lifecycle-listing-proposal-69b52278/independent/review-listing-07f2d5b9.json
[m5]: ../../../../.intentsmith-artifacts/core-completion-20260909/provider-proposal/m5-na-integrated-01/independent-integration-review.json
[seal]: ../../../../.intentsmith-artifacts/core-completion-20260909/provider-proposal/gate0-seal-proposal-a7ba5490/independent-review.json
[panel]: ../../../../.intentsmith-artifacts/core-completion-20260909/provider-proposal/truncation-fa573c-independent-evidence-review.json
[runtime]: ../../../../.intentsmith-artifacts/core-completion-20260909/provider-proposal/provider-runtime-checkpoint-20260909-followup-01.json
[coverage]: ../../../../.intentsmith-artifacts/core-completion-20260909/provider-proposal/m6-model44-coverage-20260909-02.json
[ab]: ../../../../.intentsmith-artifacts/core-completion-20260909/provider-proposal/truncation-headroom-six-independent-evidence-review.json
[abproject]: ../../../../.intentsmith-artifacts/core-completion-20260909/provider-proposal/truncation-headroom-six-independent-review.json
[contained]: /home/belphareon/is-m6-work09-a7ba5490/repo/.intentsmith-artifacts/contained-core-contained13-69b52278-20260909-02/gates/core-contained13-69b52278-20260909-02/report.json
[interruption]: ../../../../.intentsmith-artifacts/core-completion-20260909/provider-proposal/contained13-69b52278-interruption-01.json
[guardartifact]: ../../../../.intentsmith-artifacts/core-completion-20260909/provider-proposal/expertise-guard6-oracle-69b52278/root-artifact.log
[guardregistry]: ../../../../.intentsmith-artifacts/core-completion-20260909/provider-proposal/expertise-guard6-oracle-69b52278/root-registry.log
[cookbook]: ../../../../.intentsmith-artifacts/core-completion-20260909/provider-proposal/raw-cookbook-v5-69b52278-01/root-invocation.json

[d1raw]: ../../../../.intentsmith-artifacts/core-completion-20260909/provider-proposal/d1-raw-context-ceiling-69b52278.json

[d2be]: ../../../../.intentsmith-artifacts/core-completion-20260909/deterministic-current/core-deterministic-2be9f521-20260909-01/report.json

[d2ber]: ../../../../.intentsmith-artifacts/core-completion-20260909/provider-proposal/deterministic-2be9f521-independent-review.json

[followup2r]: ../../../../.intentsmith-artifacts/core-completion-20260909/provider-proposal/followup2-2be9f521-run02-independent-review.json

[llm1r]: ../../../../.intentsmith-artifacts/core-completion-20260909/provider-proposal/llm1-direct-think-proposal-2be9f521/actual-run-independent-review.json

[llm1fixr]: ../../../../.intentsmith-artifacts/core-completion-20260909/provider-proposal/llm1-direct-think-proposal-2be9f521/independent-review-c84474d5.json

[llm2r]: ../../../../.intentsmith-artifacts/core-completion-20260909/provider-proposal/llm2-2be9f521-independent-review/review.json

[splitr]: ../../../../.intentsmith-artifacts/core-completion-20260909/provider-proposal/spec-partition-proposal-cb6bdc3b/independent-two-part-replay-review.json

[calibrationr]: ../../../../.intentsmith-artifacts/core-completion-20260909/provider-proposal/calibration6144-a0b4c299-launch-review-mobile.json

[bprep]: ../../../../.intentsmith-artifacts/core-completion-20260909/provider-proposal/b-comparison-prep-2be9f521/handoff.json

[calibration-result]: ../../../../.intentsmith-artifacts/core-completion-20260909/provider-proposal/physical-calibration6144-a0b4c299-01/result.json

[calibration-report]: /home/belphareon/is-m6-work09-a7ba5490/repo/.intentsmith-artifacts/core-calibration6144/gpu-pilot/core-m1-gpu-calibration6144-20260909-01/report.json

[calibration-inner]: /home/belphareon/is-m6-work09-a7ba5490/repo/.intentsmith-artifacts/core-calibration6144/gpu-pilot/core-m1-gpu-calibration6144-20260909-01/runtime/tests_m1-model-gpu-pilot.test.js.aa9fc5db/artifacts/m1-model-gpu-pilot.json

[facts1828]: ../../../../.intentsmith-artifacts/core-completion-20260909/provider-proposal/followup-docs-proposal-2be9f521-1828/facts.json

[calibration-physical-review]: /home/belphareon/worktrees/is-mobile-completion-20260908/.intentsmith-artifacts/core-completion-20260909/provider-proposal/physical-calibration6144-a0b4c299-independent-mobile.json

[cookbook6144-root]: /home/belphareon/worktrees/is-mobile-completion-20260908/.intentsmith-artifacts/core-completion-20260909/provider-proposal/raw-cookbook-v5-calibration6144-a0b4c299-01/root-result.json

[cookbook6144-report]: /home/belphareon/is-m6-work09-a7ba5490/repo/.intentsmith-artifacts/contained-core-cookbook-calibration6144-a0b4c299-20260909-01/gates/core-cookbook-calibration6144-a0b4c299-20260909-01/report.json

[soak1828]: /home/belphareon/worktrees/is-mobile-completion-20260908/.intentsmith-artifacts/core-completion-20260909/provider-proposal/followup-docs-proposal-2be9f521-1828/soak-log-prefix-1828.log
