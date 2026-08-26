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

Registrovaná sada `IS-T1-TESTS-M4-LEARNING-CONTRACT-V1-TEST` má 16/16 PASS.
Registry po přidání obsahuje 439 programů a fingerprint
`68979b823d6bc0a0c2e975e6646b7675fea6b03440ef312eb53d4153b151a694`.
Module-boundary ratchet zůstal 13/13 PASS bez změny autoritativního grafu.

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
Registry obsahuje 440 programů a fingerprint
`18c4a54804b65ffe46ec67d17515d1d342409f5faae4eda8b2bceb8353cca71b`.

## Mimo rozsah

Tento řez ještě neobsahuje SQLite authority, producenta Code Intelligence,
uživatelské API/UI ani injekci do ProjectContext. Ty navazují v
`WP-M4-MEMORY`, `WP-M4-CODEINTEL` a `WP-M4-CONTEXT`. Bez nezávislého review je
stav pouze `IMPLEMENTATION_GREEN / REVIEW_PENDING`.
