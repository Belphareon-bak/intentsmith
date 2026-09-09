# Core completion: navazující měření M6 — 2026-09-09

## Aktuální dokončený běh — 2026-09-09 21:39 UTC

Na totožném čistém produktovém source `7fa6f9854e4eda94a0ba2040d318a6ff90c241c1`
je doložen původní deterministic profil **352/352 PASS** a nyní samostatná
původní fresh-clone fáze **4/4 PASS**, exit 0. Instalace a build byly offline;
čtyři původní programy a jejich podmínky zůstaly beze změny. M1, upgrade
předchozí verze s obnovou po chybě, Studio boundary a Studio M1 prošly.
Jde o kontrolované integrační scénáře, nikoli obecný důkaz modelové kvality.

[Report čtyř programů](../../../../.intentsmith-artifacts/m6/candidate-7fa6f9854e4eda94a0ba2040d318a6ff90c241c1-xvfb-02/fresh-clone/report.json),
[validace fáze](../../../../.intentsmith-artifacts/m6/candidate-7fa6f9854e4eda94a0ba2040d318a6ff90c241c1-xvfb-02/phase-validation.json)
a [zachycený build](../../../../.intentsmith-artifacts/m6/candidate-7fa6f9854e4eda94a0ba2040d318a6ff90c241c1-xvfb-02/release/manifest.rerun.json)
vážou stejné SHA. Sedm skutečných build souborů má ověřené hashe. Odvozený
manifest upravuje pouze cestu k oddělenému běhu; původní capture manifest
zůstává zachovaný. [Záznam dokončení](../../../../.intentsmith-artifacts/core-completion-20260909/provider-proposal/m2-file-read-integration-20260909/fresh-7fa6f985-xvfb-02-completion.json)
potvrzuje úklid klonu, vlastních procesů i virtuální obrazovky.

Předchozí běh na témže SHA zůstává **3 PASS / 1 FAIL**. Jeho soukromá DB
obsahuje tři další vstupy mimo jediný vstup testu; jejich původ je UNKNOWN.
Opakování proto použilo samostatný Xvfb, nikoli běžnou pracovní obrazovku.
Podmínka přesně jednoho turnu zůstala stejná.
[Nezávislý audit neúspěšného běhu](../../../../.intentsmith-artifacts/core-completion-20260909/provider-proposal/m2-file-read-integration-20260909/fresh4-7fa6f985-independent-failed-review.json)
a [dřívější selhání instalace s neúplnou cache](../../../../.intentsmith-artifacts/core-completion-20260909/provider-proposal/m2-file-read-integration-20260909/fresh-install-host-cache-independent-review.json)
se nepřepisují novým PASS.

[Průběžný snapshot](../../../../.intentsmith-artifacts/core-completion-20260909/provider-proposal/provider-runtime-checkpoint-20260909T213231.json)
potvrzuje, že soak na starším `193e2351` má poslední **sedmihodinový heartbeat:
25 203 požadavků, 0 chyb**. Stále běží; 24hodinový závěr ani přijetí aktuálního
source tím nevzniká. Modelová kuchařka zůstává 24 PASS / 18 FAIL, hlavní
kontext 4096 a výstupní limit SPEC 4000. `file.list`, skutečná syntéza
FILE_EXPLAIN, oba předložené návrhy změny autority, externí podmínky M5,
finální M2 review a společný release zůstávají otevřené. M7 je oddělený release.

## Předchozí evidence checkpoint — 2026-09-09 21:11 UTC

Stav: **TECHNICAL_COMPLETION_IN_PROGRESS / MODEL_FAILURES_OPEN / NOT_RELEASE_READY**.
Poslední úplně měřený hlavní source je `7fa6f9854e4eda94a0ba2040d318a6ff90c241c1`:
oprava čtvrté revize `361a5f88`, projektové čtení `3132d58c` a samostatný pin
sedmi revidovaných závislostí. Hlavní profil zůstává **4096**, výstup SPEC
**4000**. Modelová měření při 16384 níže patří pouze privátnímu `b365896f`.
Opravy integračních chyb jsou v hlavním `7fa6f985`; jeho nový původní
full352 skončil **352 PASS / 0 FAIL / 0 BLOCKED / 0 SKIPPED**, exit 0.
[Fakta, zachované neúspěchy a přesné hashe](../../../../.intentsmith-artifacts/core-completion-20260909/provider-proposal/followup-status-proposal-361a5f88/facts.json) oddělují source i jednotlivé reporty.

| Source | Rozsah | Skutečný výsledek a hranice | Důkaz |
|---|---|---|---|
| `7fa6f985` | Nový původní required deterministic běh, 352 programů | **352 PASS / 0 FAIL / 0 BLOCKED / 0 SKIPPED**, exit 0; 21:03:42–21:07:51 UTC. Všech 352 unikátních ID a raw logových hashů ověřeno, source čistý a bez leaků | [nezávislé review](../../../../.intentsmith-artifacts/core-completion-20260909/provider-proposal/deterministic-7fa6f985-independent-review.json), [přesný report](../../../../.intentsmith-artifacts/core-completion-20260909/deterministic-current/core-deterministic-7fa6f985-20260909-01/report.json), [fakta a raw hashe](../../../../.intentsmith-artifacts/core-completion-20260909/provider-proposal/followup-status-proposal-361a5f88/facts.json) |
| `b21de040` | Původní required deterministic běh, 352 programů | **350 PASS / 2 FAIL / 0 BLOCKED**, exit 1; 20:54:16–20:58:38 UTC. Selhaly M2-TOOL-PRODUCTION-CONSUMER a M6-RUNTIME-EVIDENCE; oba PDF parametry byly předány, všechny logy přehashované, source čistý a bez leaků | [report a 352 logových hashů](../../../../.intentsmith-artifacts/core-completion-20260909/provider-proposal/followup-status-proposal-361a5f88/facts.json) |
| `3c004e70` | Předchozí required deterministic evidence | Původní report **350 PASS / 2 BLOCKED**, exit 2; doprovodný běh obou PDF programů na stejném source **2 PASS**. Dohromady 352 unikátních programů s PASS, nikoli přepsaný původní report | [nezávislé review obou reportů](../../../../.intentsmith-artifacts/core-completion-20260909/provider-proposal/deterministic-3c004e70-coverage-independent-review.json) |
| `361a5f88` | Čtvrtá a další výslovná připomínka ke SPEC | Stejných 119 kontrol: **100 PASS / 19 FAIL → 119 PASS / 0 FAIL**, nezávisle zopakováno; lifecycle **154 PASS**, M1 karanténa **8 PASS** | [source a párové review](../../../../.intentsmith-artifacts/core-completion-20260909/provider-proposal/spec-fourth-revision-fix-3c004e70/independent-release-review.json) |
| `3132d58c`, pin `b21de040` | Produkční projektové `file.read` a trvalé výsledky | Cíleně **22 consumer / 45 broker / 17 runtime / 55 schema / 20 M1 schema / 158 artifact PASS**, nezávislé integrační review. Původní dva FAIL na b21 a nový úplný PASS na 7fa jsou uvedené výše | [integrační review](../../../../.intentsmith-artifacts/core-completion-20260909/provider-proposal/m2-file-read-integration-20260909/independent-release-integration-review-3132d58c.json) |
| privátní kompozice revidovaného M2 čtení | Celý produkční migration runner a skutečný consumer | **13 migration kontrol**, fresh i populated 108→109, nezávisle revidováno; odděleně **11 consumer kontrol** se skutečným providerem/SQLite a replay po odstranění zdrojového souboru | [migration review](../../../../.intentsmith-artifacts/core-completion-20260909/provider-proposal/m2-file-read-output-proposal-6405992/production-migration-independent-release-review.json), [consumer důkaz](../../../../.intentsmith-artifacts/core-completion-20260909/provider-proposal/m2-file-read-consumer-proposal-6405992e/v3/composition-02/artifacts/composition.json) |
| `b365896f` | Původní LLM1 | **16/16 PASS**; 15 úplných POST odpovědí, všechny `stop`; čtyři přímá volání neuvádějí `num_ctx`, 11 produkčních posílá 16384; čtyři trvalé PURE/DIRECT výsledky | [nezávislé raw/DB review](../../../../.intentsmith-artifacts/core-completion-20260909/provider-proposal/llm1-calibration16384-independent-audit-b365896f/review.json) |
| `b365896f` | Původní LLM2 | **17/17 PASS**; 12 úplných POST odpovědí, všechny 16384 a `stop`; pět trvalých PURE/DIRECT výsledků | [nezávislé raw/DB review](../../../../.intentsmith-artifacts/core-completion-20260909/provider-proposal/llm2-calibration16384-independent-audit-b365896f/review.json) |
| `b365896f` | Původní fyzický T3 a následný cookbook | T3 **PASS / REVIEW_PASSED**, monitorované minimum 5377 MiB a 100% GPU residency; cookbook stále **24 PASS / 18 FAIL**, konec ve SPEC | [fyzické review](../../../../.intentsmith-artifacts/core-completion-20260909/provider-proposal/physical-calibration16384-b365896f-independent-mobile.json), [cookbook audit](../../../../.intentsmith-artifacts/core-completion-20260909/provider-proposal/cookbook16384-independent-audit-b365896f/review.json) |

Dva deterministic FAIL mají revidované opravy v `7fa6f985`: stará kontrola
UNAVAILABLE nyní ověřuje přesný pending read@2 bez grantu či obsahu a M6
kontrakt připíná skutečných 96 migrací. Cílené původní sady prošly 22 a 8
kontrolami; původní full352 na b21 zůstává FAIL. Nový původní běh
`core-deterministic-7fa6f985-20260909-01` má samostatný skutečný **352/352 PASS** report.
[Consumer review](../../../../.intentsmith-artifacts/core-completion-20260909/provider-proposal/m2-file-read-integration-20260909/remaining-fixes/production-consumer-independent-release-review.json)
a [M6 migration-count review](../../../../.intentsmith-artifacts/core-completion-20260909/provider-proposal/m6-runtime-migration-pin-b21de040/independent-convergence-review.json)
předcházejí samostatnému úplnému běhu; samotné focused výsledky jej nenahrazují.
Nejde o původní PDF blokace na `3c004e70`.
Bootstrap a schema neúspěchy z cílené integrace zůstávají zachované, včetně
M1 schema **17 PASS / 3 FAIL → 20 PASS** po synchronizaci přesného migration oracle.

Čtvrtá připomínka již není zaměněna za schválení. Každý výslovný revizní
vstup prochází jedním existujícím `reviseSpec` voláním; nevznikla automatická
smyčka ani nová autorita. Nevyřešená připomínka blokuje schválení.
Oprava patří non-M1 větvi; M1/M7 karanténa zůstává beze změny.

Projektové čtení nyní zobrazuje přesnou schvalovanou cestu, projekt a limit,
po přesném grantu ukládá skutečné bytes a na reconnect je promítá z trvalého
výsledku bez nového čtení souboru. Cílené důkazy zahrnují odmítnutí cizího
aktéra/projektu/konverzace a související životní cyklus odstranění dat.
**`file.list` a úplná syntéza `FILE_EXPLAIN` zůstávají otevřené**; zobrazení
načteného souboru není jeho vysvětlením. Sedm nových src hran je připnutých:
1282 celkem, stejné 3 cykly / 28 souborů. Integrační review není finální
operátorské `REVIEW_PASSED` podle Decision 030 ani M2 acceptance.

LLM1/LLM2 mají původní omezené jazykové, faktické a délkové aserce. SEARCH
v LLM1 ověřuje rozhodnutí, nikoli provedení webu; LLM2 živá data neobdržel
a počasí požádalo o souhlas. Oba běhy mají raw identity a trvalé lokální
výsledky, ne nové záznamy `model_usage`. Neprokazují obecnou kvalitu ani
přijetí hlavního profilu 16384; fyzický T3 má vlastní omezení níže.

Cookbook při 16384 uchoval zadání, veřejné předchozí SPEC, připomínky i
doplnění. První SPEC a následné řazení byly úplné, ale výživa třikrát
skončila `length` při **5795 + 4000 = 9795 < 16384**; limit byl výstupních
4000 tokenů. Pending výživa nebyla vydána za hotovou veřejnou SPEC.
[Návrh účelově omezeného SPEC rozpočtu 6000](../../../../.intentsmith-artifacts/core-completion-20260909/provider-proposal/completion-spec-budget-decision-20260909.md)
a [návrh síťového scope bez projektu](../../../../.intentsmith-artifacts/core-completion-20260909/provider-proposal/completion-network-decision-20260909.md)
jsou předložené, **odpověď operátora chybí**. Nejsou přijaté ani aktivované;
obecný planner a ostatní rozpočty se nemění. Projektové soubory lze dokončovat
podle existující autority bez dalšího předběžného souhlasu.

[Zachovaný šestihodinový soak prefix](../../../../.intentsmith-artifacts/core-completion-20260909/provider-proposal/followup-status-proposal-361a5f88/soak-prefix.log)
na historickém `193e2351` má `elapsedMs=21602001`, **21603 requests / 0 errors**.
Jde o průběžný heartbeat, nikoli finální 24hodinový PASS; navazující throughput
není uzavřený. Zbývající modelová kvalita a funkce, M5 externí
podmínky a společný release gate/review/demo/acceptance zůstávají otevřené.
**M6 PASS ani 413 PASS na jednom SHA doložené nejsou.**

## Historický checkpoint — 2026-09-09 20:04 UTC

Stav: **TECHNICAL_COMPLETION_IN_PROGRESS / MODEL_FAILURES_OPEN / NOT_RELEASE_READY**.
Hlavní source je `6405992e54140ff754043478b8ea68281cc43812` s profilem **4096**.
Běhy při 8192 níže patří privátnímu `875c041a`;
neobsahují následné opravy JSON, VRAMManageru a retence v hlavní větvi.
Novější privátní `b365896f` vychází přímo z `6405992e` a měří profil 16384.
[Fakta a hashe tohoto checkpointu][facts1926] vážou každý výsledek na jeho source.

| Source | Rozsah | Naměřený výsledek a hranice | Důkaz |
|---|---|---|---|
| `875c041a` | Původní fyzický T3, profil 8192 | **PASS / REVIEW_PASSED**, 18:33:46–18:39:13 UTC; čtyři requesty 8192, minimum 5766 MiB, 100% GPU residency, cancel 80 ms, přirozené vyprázdnění za 302818 ms | [nezávislé review, report a raw hashe][physical8kr] |
| `875c041a` | Původní cookbook při 8192 | **26 PASS / 16 FAIL**, 18:40:37–18:50:22 UTC; první úplná SPEC prošla, revize a dokončení projektu ne | [nezávislý raw/DB audit][cookbook8kr] |
| `875c041a` | Původní LLM1 s opraveným přímým helperem | **16/16 PASS**, 19:14:14–19:15:33 UTC; 16 úplných raw odpovědí a čtyři trvalé PURE/DIRECT lokální výsledky | [nezávislé review, report a raw/DB hashe][llm1fixed8kr] |
| `b365896f` | Původní fyzický T3, profil 16384 | **PASS / REVIEW_PASSED**, 19:28:37–19:34:05 UTC; čtyři requesty 16384, minimum monitoru 5377 MiB, po volání 5376 MiB, 100% GPU residency, cancel 78 ms, přirozené vyprázdnění za 302788 ms | [nezávislé review a raw hashe][physical16kr] |
| `b365896f` | Původní cookbook s JSON/retention/oracle opravami, profil 16384 | **24 PASS / 18 FAIL**, 19:35:32–19:49:09 UTC; první SPEC i revize řazení úplné, revize výživy třikrát ukončená limitem 4000, konec ve SPEC | [nezávislý raw/DB audit][cookbook16kr] |
| hlavní opravy do `6405992e` | Cílené kontroly bez modelu | **154 lifecycle / 45 workflow / 158 artifact PASS**; retence a oprava cookbook oracle mají nezávislé review | [lifecycle log][retention-root], [workflow log][workflow-root], [artifact log][artifact-root], [retence review][retentionr], [oracle review][oracler] |

Cookbook při 8192 nejprve vytvořil validní SPEC při `2831+3462` tokenech a `stop`.
První revize pak vrátila neplatný JSON také při `stop`; její připomínka se
ztratila před druhou revizí. Tři následující totožné požadavky skončily na
**výstupním limitu 4000** (`4078+4000=8078 < 8192`, `length`). Historické
finální kontroly SPEC-F řazení/výživy byly falešné PASS: přijaly „přiřazené“
ve staré specifikaci a text v interní historii. Revizní blok T3-R v tomto běhu
neproběhl. Raw zprávy, neúspěch i nepřijatý dvoudílný pokus zůstávají zachované.

Novější cookbook při 16384 vytvořil úplnou SPEC (`2815+3485`, `stop`).
První výstup revize řazení byl neúplný (`5500+4000`, `length`); další totožný
požadavek z původní omezené smyčky scénáře vrátil validní SPEC
(`5500+3880`, `stop`) se skutečným veřejným požadavkem na řazení a HTTP 422.
Revize výživy pak třikrát skončila při `5795+4000=9795 < 16384`, vždy
`length` a neúplný JSON. **Zbývající limit je výstupních 4000 tokenů;
kontext se při těchto neúspěších nevyčerpal.** Původní zadání, úplné předchozí
veřejné SPEC, připomínky i doplnění byly přesně předány: nezávislá rekonstrukce
ověřila všech devět skutečných JSON požadavků. Retence tedy v tomto běhu
funguje; výživa zůstala v pending draftu a nebyla vydána za validní veřejnou SPEC.
Běh skončil po 20 tazích ve SPEC, bez roadmapy a milníků. Nové finální oracle
řazení/výživy správně FAIL; rozdíl 24/18 proti 26/16 při 8192 není přímé
srovnání kvality, protože starý běh používal vadné oracle. Root skončil
19:49:11 UTC, scope je neaktivní, source čistý a runner bez leaků.

[Konkrétní návrh rozpočtu SPEC 6000][specbudgetdraft] a níže uvedený návrh
webu bez projektu byly předloženy operátorovi; k tomuto checkpointu odpověď
chybí. Rozpočet 6000 se týká pouze úplného SPEC dokumentu a má
[nezávislé review návrhu][specbudgetr]; obecný planner i analýzy zůstávají 4000.
Návrh zatím není přijatý ani implementovaný a nezaručuje další kvalitativní PASS.

LLM1 případ 2.3 má nyní `think:false`, 156 znaků skutečné odpovědi, žádné
thinking znaky, `stop` a `74+51` tokenů; celá předchozí odpověď o Tokiu je
v témže požadavku. **Čtyři přímá volání neuvádějí `num_ctx`**, jejich skutečný
kontext tedy tato evidence neurčuje; dvanáct produkčních volání posílá 8192.
Čtyři LOCAL dvojice odpovídají neměnným request/result záznamům a zobrazenému
výsledku; privátní DB má 20 zpráv, žádné efekty a žádné `model_usage`.
SEARCH kontroluje rozhodnutí `TOOL_CALL`, nikoli provedení webu. Jedna
odpověď byla odmítnuta D6 a prošel až existující jediný retry. Jazykové,
faktické a délkové aserce mají původní omezený rozsah; nejde o úplnou kvalitu
ani nové fyzické měření všech těchto volání.

Hlavní `48dd1e5c` žádá JSON jen ve třech existujících SPEC voláních;
[125 lifecycle][json-lifecycle] a [30 M1 kontrol][json-m1] prošlo bez modelu.
`1f68dceb` sjednotil VRAMManager s přesným profilem a `fd359775` připnul jedinou
novou hranu (1275 celkem, stále 3 cykly / 28 souborů); [47 cílených kontrol
pro hlavní profil a review][vramr] neznamená fyzický GPU PASS.
`6405992e` uchovává původní zadání a uspořádané revizní připomínky před modelem,
chrání zápisy přesnými bytes a fází a odmítá schválení nerozřešené revize.
Cookbook oracle nyní čte veřejnou SPEC a odmítá uvedené falešné shody.
Tyto opravy nemění výstupní limit SPEC 4000. Nový fyzický T3 při 16384
je uzavřený s nezávislým review; stejného modelu/digestu a rezervy nejméně
1024 MiB dosáhl bez fallbacku. Pilot uchovává souhrn 197 vzorků s průměrným
intervalem 127,01 ms, nikoli úplné pole raw GPU vzorků; produkční estimator
zůstává UNKNOWN. Původní cookbook na stejném source skončil uvedeným FAIL.
Kvalita ani profil 16384 tím nejsou přijaty; hlavní profil zůstává 4096.

**Otevřené implementační nedostatky:** [audit B/C/E][web34] doložil 34 odmítnutí
webu v konverzacích bez projektu; autentizace byla platná, současný efektový
kontrakt však takový scope neumí. [Čtení a výpis souborů][filegap] navíc nemají
hotový producer ani vazbu skutečného obsahu na schválený efekt; kořenový výpis
nelze vyjádřit nynější hranicí „pouze potomek“. To nejsou funkce vyřazené z 1.0.
[Opravený autoritativní výklad][fileautonomy] potvrzuje, že projektové čtení,
kořenový výpis a jejich kompatibilní evidence se mají implementovat podle
již přijatého [PRODUCT][productprimary], [ProjectContext][projectcontextprimary]
a [Decision 030][m2decisionprimary]: implementace, důkazy a pin předcházejí
finálnímu operátorskému review. Nová reprezentace kořene či uloženého výstupu
sama nevyžaduje další předběžný souhlas. Dřívější opačný výklad soukromých
návrhů byl příliš široký; nebyl to přijatý zákaz práce.
[Dosud nepřijatý návrh rozhodnutí][scopedraft] se týká pouze nového síťového
scope v konverzaci bez projektu; jeho [nezávislé source review][networkr]
není přijetím scope ani grantem k odeslání požadavku. Odděleně zůstává
[čtvrtá revize v non-M1 routeru][fourthrevision]: zděděná větev může nový
nesouhlas zaměnit za schválení předchozí platné SPEC. Retence v `6405992e`
tuto dosud nepředanou připomínku sama neopravuje; M1/M7 karanténa se nemění.

[Zachovaný soak prefix][soak1926] na `193e2351` má pětihodinový heartbeat
`elapsedMs=18001002`, **18002 requests / 0 errors**, přibližně 19:18:56 UTC.
Finální 24hodinový výsledek chybí. Dřívější 352/352 deterministic a routing
43/43 + 27/27 na `2be9f521`, LLM2 17/17 a další běhy níže mají vlastní source.
M5 externí podmínky, zbývající implementace/kvalita a společný release
průchod/review/demo/acceptance zůstávají otevřené. **413 PASS na jednom SHA
ani M6 PASS doložené nejsou.**

## Historický checkpoint — 2026-09-09 18:28 UTC

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

[facts1926]: ../../../../.intentsmith-artifacts/core-completion-20260909/provider-proposal/followup-docs-proposal-6405992-1926/facts.json

[physical8kr]: ../../../../.intentsmith-artifacts/core-completion-20260909/provider-proposal/physical-calibration8192-875c041a-independent-release.json

[cookbook8kr]: ../../../../.intentsmith-artifacts/core-completion-20260909/provider-proposal/cookbook8192-independent-audit-875c041a/review.json

[llm1fixed8kr]: ../../../../.intentsmith-artifacts/core-completion-20260909/provider-proposal/llm1-calibration8192-independent-audit-875c041a/review.json

[retention-root]: ../../../../.intentsmith-artifacts/core-completion-20260909/provider-proposal/spec-review-retention-root-lifecycle.log

[workflow-root]: ../../../../.intentsmith-artifacts/core-completion-20260909/provider-proposal/spec-review-retention-root-workflow.log

[artifact-root]: ../../../../.intentsmith-artifacts/core-completion-20260909/provider-proposal/spec-review-retention-root-artifact.log

[retentionr]: ../../../../.intentsmith-artifacts/core-completion-20260909/provider-proposal/spec-review-retention-proposal-875c041a/independent-mobile-review-f8251f9b.json

[oracler]: ../../../../.intentsmith-artifacts/core-completion-20260909/provider-proposal/cookbook-public-spec-oracle-proposal-1f68dceb/independent-review-cd7489c0.json

[json-lifecycle]: ../../../../.intentsmith-artifacts/core-completion-20260909/provider-proposal/json-mode-root-lifecycle.log

[json-m1]: ../../../../.intentsmith-artifacts/core-completion-20260909/provider-proposal/json-mode-root-m1-contract.log

[vramr]: ../../../../.intentsmith-artifacts/core-completion-20260909/provider-proposal/vram-profile-default-root-review.json

[web34]: ../../../../.intentsmith-artifacts/core-completion-20260909/provider-proposal/authority-bce-audit-109582d5/web-scope-addendum.json

[filegap]: ../../../../.intentsmith-artifacts/core-completion-20260909/provider-proposal/m2-project-read-list-proposal-1b2cb23/independent-convergence-review.json

[scopedraft]: ../../../../.intentsmith-artifacts/core-completion-20260909/provider-proposal/completion-network-decision-20260909.md

[fourthrevision]: ../../../../.intentsmith-artifacts/core-completion-20260909/provider-proposal/spec-revision-limit-audit-fd359775/finding-and-proposal.md

[soak1926]: ../../../../.intentsmith-artifacts/core-completion-20260909/provider-proposal/followup-docs-proposal-6405992-1926/soak-log-prefix-1926.log


[physical16kr]: ../../../../.intentsmith-artifacts/core-completion-20260909/provider-proposal/physical-calibration16384-b365896f-independent-mobile.json

[cookbook16kstart]: ../../../../.intentsmith-artifacts/core-completion-20260909/provider-proposal/raw-cookbook-v5-calibration16384-b365896f-01/root-invocation.json

[fileautonomy]: ../../../../.intentsmith-artifacts/core-completion-20260909/provider-proposal/m2-file-autonomy-reassessment-6405992.json

[productprimary]: ../../../../PRODUCT.md

[projectcontextprimary]: ../../../../docs/wp/WP-M2-CODE-PROJECT-CONTEXT-V1.md

[m2decisionprimary]: ../../../../docs/decisions/030-m2-closeout-authority.md

[cookbook16kr]: ../../../../.intentsmith-artifacts/core-completion-20260909/provider-proposal/cookbook16384-independent-audit-b365896f/review.json

[networkr]: ../../../../.intentsmith-artifacts/core-completion-20260909/provider-proposal/completion-network-decision-independent-review-93173e15.json

[specbudgetdraft]: ../../../../.intentsmith-artifacts/core-completion-20260909/provider-proposal/completion-spec-budget-decision-20260909.md

[specbudgetr]: ../../../../.intentsmith-artifacts/core-completion-20260909/provider-proposal/completion-spec-budget-decision-20260909.mobile-review.json
