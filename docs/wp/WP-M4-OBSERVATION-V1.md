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

## Zbývající rozsah

Code Intelligence HTTP/Studio user gate a první úplné integrační E2E včetně
outcome měření zatím nejsou hotové. Bez nezávislého review je celý dosavadní
stav pouze `IMPLEMENTATION_GREEN / REVIEW_PENDING`.
