# M4 — společná operátorská review matice

- **Stav:** `7 REVIEW_READY / 0 REVIEW_PASSED / OPERATOR_REVIEW_PENDING`
- **Technický base:** `d6213232e4384f1ea1a855fce7f7d093905ebded`
- **Přesný candidate:** `286f5ba881aa5dce3797955efe68a7d5cd97f39c`
- **Review range:** `d6213232..286f5ba8`
- **Větev:** `codex/m4-integration-20260826`
- **Push:** neproveden
- **Review autorita:** operátor projektu; lokální Opus se nepoužívá

M4 je implementačně a integračně zelený kandidát, nikoli přijatý milník.
Projděte všech sedm oddílů nad stejnými candidate bytes a vraťte jeden společný
verdict. Každý oddíl musí trasovat skutečnou produkční cestu až k persistované
nebo uživatelsky emitované podobě; samotný unit test ani mapping tabulka nestačí.

## Společný protokol

1. Ověřit exact candidate, čistý worktree, žádný upstream a žádný push.
2. Číst celé kontrakty a následovat call graph přes route/service/repository až
   k SQLite triggerům nebo přes lifecycle router až k planner draftu.
3. Pozitivní test doplnit negativní sondou pro identity, projekt, verzi,
   workspace revision, actor a nepovolený stav podle oddílu.
4. Nevyžadovat GPU, Ollamu ani internet; M4 model-quality readiness netvrdí.
5. U nálezu uvést severity, `file:line`, reprodukci, dopad a podmínku přijetí.
6. Nezaměnit raw registry `FAIL` za green gate: přijatelná je pouze přesně
   nezměněná zděděná množina dvou FAIL a dvou BLOCKED.

## Přehled

| # | Oddíl | Hlavní provenance | Stav |
|---:|---|---|---|
| 1 | Contract, identity a negativní invarianty | `e4d01c7c` | `REVIEW_READY` |
| 2 | Durable authority, scope, lifecycle a retention | `5a542600..a706df9b` | `REVIEW_READY` |
| 3 | Code Intelligence producer a proposal gate | `a9a0a7e5` | `REVIEW_READY` |
| 4 | ProjectLearningContext a planner boundary | `998c3442..8fceffb8` | `REVIEW_READY` |
| 5 | HTTP a Studio user authority | `d70f9b7d..21b5b221` | `REVIEW_READY` |
| 6 | Outcome measurement a durable plan artifacts | `885cf959..bd5eada6` | `REVIEW_READY` |
| 7 | Complete journey, rollback/delete a integrační baseline | `98791eb8..286f5ba8` | `REVIEW_READY` |

## 1. Contract, identity a negativní invarianty

**Vlastněné bajty:** `contracts/m4/learning-v1.js` a
`tests/m4-learning-contract-v1.test.js`.

**Kontrola:** exact keys a enumy; canonical integer-only serialization;
content-addressed observation/proposal/outcome identity; dvě distinct
same-project observations; proposal pouze jako pending adaptation; zákaz
permission/code/config payloadu; lineární outcome chain, monotónní čas,
version/expiry identity, allowed transitions a terminální delete. Ověřit, že
nekanonický order, unknown key, float, pozměněné ID, cross-project evidence a
transition po delete fail-close.

```bash
git diff d6213232..286f5ba8 -- contracts/m4/learning-v1.js \
  tests/m4-learning-contract-v1.test.js
node scripts/run-suites.js \
  --suite=IS-T1-TESTS-M4-LEARNING-CONTRACT-V1-TEST --log-level=warn
```

## 2. Durable authority, scope, lifecycle a retention

**Vlastněné bajty:** migrace 087, `learning-authority-validation.js`,
`learning-authority-repository.js`, `learning-application-service.js` a
repository/schema testy.

**Kontrola:** SQLite guardy musí zablokovat direct-SQL bypass stejně jako JS;
canonical payload a indexed columns se shodují; `BEGIN IMMEDIATE` serializuje
approve/reject/measure/weaken/rollback/delete/expire; právě jedno první user
rozhodnutí; žádné větvení chainu; settlement accessor skládá úplnou pravdu;
active projection aplikuje decay/TTL; export a reads jsou project-isolated.
Delete musí vyřadit runtime vliv, ale být pravdivě tombstone, ne fyzické
vymazání auditu.

```bash
git diff d6213232..286f5ba8 -- src/db/migrations/2026_08_26_087_m4_learning_authority.js \
  src/memory/learning-authority-validation.js \
  src/memory/learning-authority-repository.js \
  src/memory/learning-application-service.js tests/m4-learning-authority-repository.test.js
node scripts/run-suites.js \
  --suite=IS-T1-TESTS-M4-LEARNING-AUTHORITY-REPOSITORY-TEST,IS-T1-TESTS-SCHEMA-MIGRATIONS-TEST \
  --log-level=warn
```

## 3. Code Intelligence producer a proposal gate

**Vlastněné bajty:** `src/code-intel/learning-pattern-producer.js`, default-off
změna v `src/memory/cross-project-learner.js` a odpovídající testy.

**Kontrola:** vstup je pouze validní succeeded `ProjectChangeResult`; evidence
váže exact execution, result digest, analysis digest a workspace revision;
jeden execution nemůže počítat dvakrát; proposal vzniká až ze dvou distinct
executions stejného canonical klíče a nejvýše z osmi observations; pending nebo
active proposal potlačí duplicitu; rejection nerecykluje stejnou evidenci.
Producer nesmí zapisovat outcome ani efekt. Foreign project a default
cross-project retrieval musí zůstat prázdné bez explicitního opt-in.

```bash
git diff d6213232..286f5ba8 -- src/code-intel/learning-pattern-producer.js \
  src/memory/cross-project-learner.js tests/m4-learning-pattern-producer.test.js \
  tests/cross-project-learner.test.js
node scripts/run-suites.js \
  --suite=IS-T1-TESTS-M4-LEARNING-PATTERN-PRODUCER-TEST,IS-T1-TESTS-CROSS-PROJECT-LEARNER-TEST \
  --log-level=warn
```

## 4. ProjectLearningContext a planner boundary

**Vlastněné bajty:** `contracts/m4/project-learning-context-v1.js`,
`src/code-intel/project-learning-context.js`, lifecycle router/prompts/spec a
jejich focused/regresní testy.

**Kontrola:** supplement nemění M2 `ProjectContextSnapshot@1`; váže exact
project/workspace revision a pouze current active same-project authority;
provenance, version, confidence, TTL, item count i byte budget jsou tvrdé;
router po analýze revision znovu změří; `startSpec()` validuje před LLM a
planner draft před persistencí. S contextem musí model dodat právě jeden exact
ID/version/key a povolený conformance status pro každý item. Missing,
duplicate, stale, invented, foreign nebo self-consistent rehashed divergent
context musí fail-close a nesmí persistovat draft.

```bash
git diff d6213232..286f5ba8 -- contracts/m4/project-learning-context-v1.js \
  src/code-intel/project-learning-context.js src/chat/handlers/lifecycle-router.js \
  src/planner/lifecycle-prompts.js src/planner/lifecycle-spec.js \
  tests/m4-project-learning-context.test.js
node scripts/run-suites.js \
  --suite=IS-T1-TESTS-M4-PROJECT-LEARNING-CONTEXT-TEST,IS-T2-TESTS-LIFECYCLE-TEST \
  --log-level=warn
```

## 5. HTTP a Studio user authority

**Vlastněné bajty:** `src/routes/learning.js`,
`learning-application-service.js`, server wiring a committed Studio panel.

**Kontrola:** list/detail jsou project-bound a bounded; approve/reject/weaken/
rollback/delete vyžadují aktivní projekt; actor ID pochází jen z transport
subjectu a project ID z route, nikdy z body; cizí proposal skončí před mutací;
typed 400/404/409 nesmí prosakovat interní detail. Studio musí znovu ověřit
session/project po response, exact contract před renderem, neodesílat actor ani
path a měnit stav jen explicitním commandem s exact proposal ID a reason.
Obecné potvrzení nesmí mít M4 mutační cestu.

```bash
git diff d6213232..286f5ba8 -- src/routes/learning.js src/server.js \
  src/memory/learning-application-service.js \
  c3-ide/extensions/c3-chat-panel/lib/browser/chat-panel-module.js \
  tests/m4-learning-api.test.js tests/m4-learning-studio-surface.test.js
node scripts/run-suites.js \
  --suite=IS-T1-TESTS-M4-LEARNING-API-TEST,IS-T1-TESTS-M4-LEARNING-STUDIO-SURFACE-TEST,IS-T1-TESTS-ROUTES-SMOKE-TEST \
  --log-level=warn
```

## 6. Outcome measurement a durable plan artifacts

**Vlastněné bajty:** `contracts/m4/learning-plan-evaluation-v1.js`, migrace
088, `learning-outcome-evaluator.js`, repository integration a test.

**Kontrola:** artifact je exact, content-addressed a váže project/proposal/item/
version/context/time/response/conformance. Baseline musí být context-null a
`absent`; observed musí být pozdější a vázaný na current exact context.
Repository nesmí uložit measurement bez obou durable artifactů a jejich shody
s aktivním itemem. SQL trigger a JS validator musí mít stejnou autoritu.
Evaluator musí znovu porovnat item core proti repository a správně rozlišit
`absent`, `conformed`, `conflict_explicit`; fabricated nebo rehashed divergent
context nesmí projít.

```bash
git diff d6213232..286f5ba8 -- contracts/m4/learning-plan-evaluation-v1.js \
  src/db/migrations/2026_08_26_088_m4_learning_plan_evaluations.js \
  src/memory/learning-outcome-evaluator.js \
  src/memory/learning-authority-repository.js tests/m4-learning-outcome-evaluator.test.js
node scripts/run-suites.js \
  --suite=IS-T1-TESTS-M4-LEARNING-OUTCOME-EVALUATOR-TEST,IS-T1-TESTS-SCHEMA-MIGRATIONS-TEST \
  --log-level=warn
```

Přiznaná hranice: `0 → 10000`, sample size 1 je exact conformance důkaz, ne
model-quality benchmark. Pokud je tato reprezentace pravdivá, není sama o sobě
blockerem; false semantic-quality claim by blocker byl.

## 7. Complete journey, rollback/delete a integrační baseline

**Vlastněné bajty:** celý product M4 range,
`m4-learning-journey-e2e.test.js`, registry, module baseline a schema/harness
oracle. Closeout a tato matice jsou podpůrné dokumenty nad exact product range,
ne další product změna.

**Kontrola:** cesta skutečně používá migration runner/SQLite/repository/
producer/application service/workspace revision/ProjectLearningContext/
`ProjectLifecycle.startSpec()`, nikoli paralelní fake authority. Fake smí být
jen planner response. Ověřit exact pořadí dvou changes → proposal → baseline →
approval → injection → measured outcome → invented-ID rejection → rollback →
no influence → delete a trvalost artifactů. Cizí projekt musí zůstat prázdný.
Delete musí být označen jako tombstone. Cross-project musí být default off.

Integrační baseline na source `286f5ba8` je raw a interpretovaně stejně
`276 PASS / 2 FAIL / 2 BLOCKED`, protože runner už BLOCKED vede samostatně.
Celkový verdict musí zůstat `FAIL`, exit `1`. Jediné non-PASS:

- `nightly-orchestrator-self-test` — FAIL;
- `vram-coordination` — FAIL;
- `chat-export-budget` — BLOCKED / `python-pdf-runtime`;
- `export-pdf-docx` — BLOCKED / `python-pdf-runtime`.

```bash
git diff --check
node scripts/validate-test-registry.js --json
node scripts/run-suites.js \
  --suite=IS-T1-TESTS-M4-LEARNING-CONTRACT-V1-TEST,IS-T1-TESTS-M4-LEARNING-AUTHORITY-REPOSITORY-TEST,IS-T1-TESTS-M4-LEARNING-PATTERN-PRODUCER-TEST,IS-T1-TESTS-M4-PROJECT-LEARNING-CONTEXT-TEST,IS-T1-TESTS-M4-LEARNING-API-TEST,IS-T1-TESTS-M4-LEARNING-STUDIO-SURFACE-TEST,IS-T1-TESTS-M4-LEARNING-OUTCOME-EVALUATOR-TEST,IS-T3-TESTS-M4-LEARNING-JOURNEY-E2E-TEST \
  --log-level=warn
node tests/module-boundary-ratchet.test.js
node tests/schema-migrations.test.js
node tests/artifact-validation.test.js
node tests/repository-hygiene.test.js
```

## Výstup review

Vrať verdict každého oddílu, nálezy a společný stav. Bez blockeru je požadovaný
tvar:

```text
Oddíl 1: REVIEW_PASSED
Oddíl 2: REVIEW_PASSED
Oddíl 3: REVIEW_PASSED
Oddíl 4: REVIEW_PASSED
Oddíl 5: REVIEW_PASSED
Oddíl 6: REVIEW_PASSED
Oddíl 7: REVIEW_PASSED
M4: REVIEW_PASSED
```

Samotný text ještě musí integrátor svázat s exact candidate SHA a zapsat do
finální closeout authority. Jakýkoliv `CHANGES_REQUESTED` nechává M4 otevřené.
