# WP-M4-OBSERVATION — Learning contract V1

**Stav:** `IMPLEMENTATION_GREEN / REVIEW_PENDING`  
**Větev:** `codex/m4-integration-20260826`  
**Rozsah:** jednotný kontrakt `LearningObservation/Proposal/Outcome`

## Autoritativní hranice

Jediným kontraktem tohoto řezu je
[`contracts/m4/learning-v1.js`](../../contracts/m4/learning-v1.js). Záznamy jsou
exact-key, integer-only, content-addressed a v továrnách deep-frozen. Každá
evidence váže přesný zdroj, digest, workspace revision a čas.

Proposal:

- vznikne pouze nad nejméně dvěma exact same-project observations;
- zůstává `pending` user gate, sám nic neprovádí;
- smí navrhnout pouze `project_context_pattern`;
- bajtově zakazuje změnu permissions, code a config;
- nese uživatelem schvalovanou TTL a decay policy.

Outcome je append-only stavový řetěz. První záznam je uživatelské `approved`
nebo `rejected`; měření a expiraci zapisuje systém, weaken/rollback/delete
uživatel. Stavový automat váže předchozí outcome, monotónní čas, odvozenou
identitu learned itemu, verzi a neměnnou expiraci. Delete je tombstone, nikoli
fyzické přepsání historie.

## Důležité negativní invarianty

- cizí projekt nebo neúplná observation množina fail-close;
- nekanonické pořadí, neznámé pole a pozměněný content ID fail-close;
- po `deleted` nesmí vzniknout další stav;
- `weakened` jako jediný přechod zvyšuje verzi;
- měření nese baseline, observed score, přesnou deltu a sample size;
- float, `NaN`, cyklus ani nestandardní objekt nelze kanonizovat.

## Evidence

Registrovaná sada `IS-T1-TESTS-M4-LEARNING-CONTRACT-V1-TEST` má 17/17 PASS.
Registry po přidání obsahuje 439 programů a fingerprint
`68979b823d6bc0a0c2e975e6646b7675fea6b03440ef312eb53d4153b151a694`.
Po contract-only commitu zůstal module-boundary ratchet 13/13 PASS bez změny
autoritativního grafu.

První pokus přes registry runner nebyl produktový výsledek: nový worktree neměl
`node_modules` a runner-owned server skončil před testem na chybějícím
`dotenv`. Opakovaný běh se shodným lockfile dependency tree skončil `PASS` v
runu `2026-08-26T07-22-42-579Z`.

## Navazující authority implementace

`WP-M4-MEMORY` nyní přidává migraci `087` a
[`LearningAuthorityRepository`](../../src/memory/learning-authority-repository.js):

- tři exact canonical append-only tabulky s SQL guardy proti přímému bypassu;
- lineární outcome chain, právě jedno první user rozhodnutí a žádné větvení;
- `BEGIN IMMEDIATE` pro approve/reject/measure/weaken/rollback/delete/expire;
- jediný settlement accessor, aktivní learned-item projekci s provenance a
  deterministickým decay, project-isolated export;
- delete je terminální tombstone vyřazující položku z runtime čtení; auditní
  historie zůstává append-only a její fyzická retenční likvidace není tímto
  kontraktem vydávána za provedenou.

Focused repository sada má 14/14 PASS. Celý fresh-DB migrační runner má 38/38
PASS nad 74 migracemi a 148 tabulkami. Artifact validace má 154/154 PASS.
Registry v tomto authority řezu obsahoval 440 programů a fingerprint
`18c4a54804b65ffe46ec67d17515d1d342409f5faae4eda8b2bceb8353cca71b`.
Autoritativní graph následně explicitně přijal dvě authority hrany na product
commitu `5a542600`; má 1 152 hran, stále 3 cykly a 28 souborů v cyklech a ratchet
je 13/13 PASS.

## Code Intelligence producer

[`learning-pattern-producer.js`](../../src/code-intel/learning-pattern-producer.js)
přijímá pouze validní `succeeded` `ProjectChangeResult`, vytvoří exact evidence
jak pro celý M2 result, tak pro strukturovanou Code Intelligence analýzu a
persistuje same-project observation. Proposal vznikne až ze dvou různých
execution IDs, maximálně nad osmi nejnovějšími observations. Jeden execution
nelze vydávat za dvě opakování.

Pending nebo active proposal stejného klíče další návrhy potlačí. Po rejection
se stejná evidence znovu nenabízí; nový proposal může vzniknout až po nové
schválené změně. Producer nikdy nezapisuje Outcome ani vedlejší efekt. Starý
`queryCrossProject()` nyní vrací prázdný výsledek, pokud volající nepředá
explicitní `crossProjectOptIn: true`.

Producer sada má 11/11 PASS a cross-project compatibility sada 37/37 PASS.
Registry má 441 programů a fingerprint
`fbdcc4fc65b47ae0bc751e0679048d9e32deb2467a4a4082469233492124d5b7`.

## Versionovaný ProjectContext supplement a runtime konzument

[`ProjectLearningContext`](../../contracts/m4/project-learning-context-v1.js)
je samostatný exact-key, content-addressed supplement. Nemění bajty přijatého
`ProjectContextSnapshot@1`: váže se na aktuální `projectId` a
`workspaceRevision`, ale learned itemy čte výhradně z aktivní same-project
projekce authority. Každá položka nese přesnou verzi, proposal/outcome ID,
efektivní i základní confidence, expiraci a seznam observation/evidence
digestů. Výstup je omezen na 16 položek a všechny kolekce i JSON hodnota mají
tvrdý budget.

Pojmenovaným produkčním konzumentem je SPEC planner. Lifecycle router po
projektové analýze znovu pozoruje workspace revision, sestaví supplement a
`startSpec()` jej po plné validaci přidá jako user-approved project data.
Learning kontext nemůže udělit permission ani měnit code/config; neplatný
supplement skončí před LLM, zatímco nedostupná volitelná learning vrstva je v
routeru auditně zalogována a původní M3 project-context cesta pokračuje beze
změny.

Focused sada má 7/7 PASS, lifecycle regresní sada 103/103 PASS a všechny čtyři
M2 ProjectContext suity mají dohromady 50/50 PASS. Znovu bylo ověřeno i osm
M3 konzumentských/extension suit: 359/359 PASS. Registry má 442 programů a
fingerprint
`ed993fccec0e605e2a07471214fe4058ab005d41bfbccd5a86f217dda173485f`.
Fresh schema má 38/38 PASS a artifact validace 154/154 PASS.
Module-boundary writer z čistého product commitu `998c3442` explicitně přijal
čtyři pojmenované hrany. Graph má 1 156 hran, stále 3 cykly a 28 souborů v
cyklech; ratchet má 13/13 PASS.

## HTTP user gate

Projektově vázané `/api/projects/:projectId/learning/proposals` zpřístupňuje
omezený seznam a detail exact proposal/evidence/settlement view. Pět mutací
approve, reject, weaken, rollback a delete odvozuje actor ID výhradně z
autentizovaného transport subjectu; body nemůže podvrhnout uživatele ani
projekt. Aktivní project registry row je povinná a proposal cizího projektu
končí typed konfliktem ještě před změnou authority.

Repository čtecí seam omezuje list na 100 položek, rozlišuje
pending/active/terminal a vrací pouze exact observation IDs proposal. API sada
má 7/7 PASS, repository po rozšíření 15/15 PASS a routes smoke včetně reálného
owned HTTP server startu 114/114 PASS. Registry má 443 programů a fingerprint
`1f009ef3772b486de29155d6922f6a3d4156d4c6f39d8b8bd21a4c25839348ae`.
Tři HTTP authority hrany byly explicitně přijaty z čistého product commitu
`d70f9b7d`; module graph má 1 159 hran bez růstu cyklů nebo cyklického
membershipu.

## Studio user gate

Autoritativní committed Studio runtime přidává pouze explicitní příkazy
`/m4-learning`, `-show`, `-approve`, `-reject`, `-weaken`, `-rollback` a
`-delete`. Před každým HTTP požadavkem váže numeric project ID a po response
znovu ověřuje, že uživatel nepřepnul session/project. Úspěch vyžaduje
`Response.ok` a exact `LearningProposalReview/List`; Studio ověřuje project,
proposal, observation order, evidence digest/revision a current outcome před
zobrazením.

Approve/reject/rollback/delete vyžadují exact proposal ID a neprázdný reason;
weaken vyžaduje exact-key strict JSON. Studio neposílá actor ani project path a
obecné „ano“ nemá žádnou mutační cestu. Renderer ukazuje rationale, pattern,
TTL, confidence, úplnou evidence provenance a konkrétní user-gate příkazy.

Studio focused sada má 7/7 PASS, M2 Studio regrese 9/9 PASS, authoritative-lib
contract PASS, M1 Studio regrese 122/122 PASS a repository hygiene
1 777/1 777 PASS. Registry po tomto řezu má 444 programů a fingerprint
`80048d888a41fd6a22734a783b0c273721fd8a9168d37946fd0e2373e4ca37e3`.

## Outcome measurement a první integrační E2E

`LearningPlanEvaluationArtifact@1` je exact-key, integer-only a
content-addressed důkaz jednoho planner response. Váže project, proposal,
learned item ID a verzi, nullable ProjectLearningContext digest, čas, response
digest a právě jeden conformance stav. Baseline musí být bez learning contextu
a `absent`; observed artifact musí následovat v čase a být svázaný s přesným
aktuálním context digestem.

Migrace `088` ukládá oba artifacty kanonicky a append-only. SQLite trigger
ověřuje celý kontrakt i indexed columns a stejný projekt proposal. Měřený
`LearningOutcome` nese oba artifact ID jako povinná typovaná pole; repository
odmítne outcome bez existujícího exact baseline/observed páru. Evidence zůstává
obnovitelná i po rollback/delete tombstone, místo aby po restartu zbyl pouze
neověřitelný hash v logu.

SPEC planner už modelovému výstupu pouze nevěří: s learning kontextem vyžaduje
právě jednu exact položku pro každý dodaný item ID/version/key, povolený stav a
ohraničené vysvětlení. Chybějící, duplicitní, cizí nebo vymyšlená identita končí
před persistencí planner draftu. Outcome evaluator navíc znovu porovná
ProjectLearningContext item proti aktuální SQLite authority; ani validně
přepočítaný digest nad pozměněnou hodnotou nestačí.

Registrovaná lokální E2E používá skutečný migration runner, SQLite repository,
Code Intelligence producer, application service, workspace-revision provider,
ProjectLearningContext a produkční `startSpec()`. Pouze odpověď planner modelu
je deterministický fake; test nemá síť, server, Ollamu ani GPU. Prokázaná cesta:

1. dva různé succeeded `ProjectChangeResult` vytvoří dvě observations a jeden
   pending proposal se dvěma přesnými zdroji;
2. baseline plán bez learning contextu vytvoří durable `absent` artifact;
3. explicitní user approval aktivuje item verze 1 a následující plán vrátí
   exact `conformed` záznam svázaný s context digestem;
4. evaluator persistuje oba artifacty a measured outcome s
   `baselineScoreBps=0`, `observedScoreBps=10000`, `deltaBps=10000`,
   `sampleSize=1`;
5. záměrně vymyšlené item ID planner odmítne; rollback odstraní pattern z
   dalšího contextu/plánu a delete uzavře append-only chain tombstonem;
6. cizí projekt po celou cestu nemá observation ani outcome.

Outcome focused sada má 8/8 PASS a E2E 1/1 PASS. Celých osm M4 sad má 73/73
PASS; lifecycle regrese 103/103, schema 38/38 nad 75 migracemi a 149 tabulkami,
artifact validation 154/154 a module ratchet 13/13 při 1 160 hranách, třech
cyklech a 28 souborech v cyklech. Registry má 446 programů, 14 exclusions a
fingerprint `30cd508c5e615650234d17bb80ac75cedd5e39b9f5133846529d89228c2340be`.

Toto měření je úzký contract conformance důkaz s jedním deterministickým
vzorkem, ne obecný sémantický benchmark modelu. Bez nezávislého review a
operátorského verdictu zůstává M4 pouze
`CANDIDATE_COMPLETE / OPERATOR_REVIEW_PENDING`.

## Integrační closeout candidate

Úplný sériový registry run `2026-08-26T08-52-35-050Z` na source
`286f5ba881aa5dce3797955efe68a7d5cd97f39c` vybral 280 `offline,database`
programů. Runner pravdivě skončil `verdict: FAIL`, exit `1`, s výsledkem
`276 PASS / 2 FAIL / 2 BLOCKED / 0 TIMEOUT`. Non-PASS množina je přesně
zděděná: `nightly-orchestrator-self-test`, `vram-coordination`, blokovaný
`chat-export-budget` a blokovaný `export-pdf-docx`. Všech osm M4 programů v
tomtéž běhu prošlo.

Tři zastaralé full-gate oracle odhalené předchozím během byly opraveny v
`286f5ba8`: DB-bootstrap census nyní zahrnuje M4 journey, schema oracle zná
migrace 087/088 a Xauthority self-test explicitně nastaví deklarovaný mode i
pod privátním umaskem. Sedm starších zachovaných direct-test runtime nebylo
smazáno; před finálním během bylo bezeztrátově přesunuto do ignorovaného
`.intentsmith-artifacts/preserved-direct-tests/2026-08-26-pre-m4-final-gate`.

Přesná evidence a review rozsah jsou v
[`m4-closeout-20260826.md`](../execution/runs/m4-closeout-20260826.md) a
[`2026-08-26-M4-OPERATOR-REVIEW-MATRIX.md`](../review/2026-08-26-M4-OPERATOR-REVIEW-MATRIX.md).
