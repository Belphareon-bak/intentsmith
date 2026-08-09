# Lifecycle vstupy — parity sonda

**Datum:** 2026-08-09
**Zdrojová revision:** `8116d09f96b9c92338e0791f74bb825a572603a6`
**Ratchet checkpoint:** `b7afc721f810f248364275f679ce1af77108d81a`
**Rozsah:** statický call graph + dvě negativní route cesty před LLM + read-only
Git scope probe. Žádný fake LLM, Ollama, GPU, zápis do projektu ani změna
`src/**`.

## Verdikt

Tři veřejné vstupy nejsou parity adaptéry jedné operace:

- chatová cesta jako jediná čeká na `ProjectLifecycle.create()` a předává jeho
  skutečný konstrukční kontrakt;
- legacy `POST /api/lifecycle/start` předá do `startSpec()` objekt `Promise`,
  ne lifecycle instanci, a proto je **rozbitý i v happy pathu**;
- `POST /api/projects/lifecycle/start` implementuje jinou operaci: zapisuje DB a
  session state napřímo, nevolá `ProjectLifecycle.create()` ani `startSpec()` a
  vrací úspěch i po zachycené chybě DB insertu.

Live parity je **BLOCKED**, nikoli PASS: její provedení by vyžadovalo Ollamu,
GPU slot a rozhodnutí R6, zda smí lifecycle dostat fake LLM adaptér. Statický
verdikt je ale úplný pro vady konstrukce, persistence a filesystem scope;
žádná z nich nezávisí na kvalitě modelového výstupu.

## Skutečný call graph

| Vstup | Vytvoření lifecycle | Project path | SPEC / LLM | Odpověď |
|---|---|---|---|---|
| Chat `PROPOSED → ano` | `await ProjectLifecycle.create({ projectId, projectPath, lifecycleConfig, callLLM, executor })` | `context.projectPath`, jinak **nový `/tmp/lc-<čas>`** | `startSpec()` nad skutečnou instancí | phase a `lifecycle.id` se uloží do session state |
| `POST /api/lifecycle/start` | `ProjectLifecycle.create({ projectId, config })` **bez `await`** | neposílá nic a projekt nenačte | `startSpec(Promise, ...)`; použije default LLM, protože `Promise.callLLM` neexistuje | `lifecycle.id` a `.phase` jsou `undefined`; `JSON.stringify()` je vynechá |
| `POST /api/projects/lifecycle/start` | vlastní `INSERT OR IGNORE` + `setLcState()` + `bindSessionToLifecycle()` | přijme neověřený `projectPath` z body | LLM nevolá; uloží generický spec a fázi `SPEC` | `200 { ok: true, phase: "SPEC" }`, bez `lifecycleId` |

Chatová cesta je v
`src/chat/handlers/lifecycle-router.js:243-303`, legacy route v
`src/routes/expertises.js:506-531` a project route v
`src/routes/projects.js:382-428`. Konstrukční kontrakt je v
`src/planner/lifecycle.js:95-109,245-253`; `startSpec()` čte
`lifecycle.callLLM` a později `lifecycle.id` v
`src/planner/lifecycle-spec.js:128-153`.

## Vady s uživatelským dopadem

### P1 — legacy start předá `Promise`

`ProjectLifecycle.create()` je `static async`. Volající v
`routes/expertises.js` jej nečeká a navíc používá neexistující klíč `config`
místo `lifecycleConfig`. Důsledky jsou dva souběžné toky:

1. `create()` synchronně založí lifecycle row a potom čeká na Git;
2. route okamžitě spustí `startSpec()` nad Promise. Defaultní LLM může proběhnout,
   ale výsledek se nemá kam správně uložit, protože `lifecycle.id` je
   `undefined`.

Neplatný `projectId` navíc odmítne synchronní DB zápis uvnitř async funkce jako
zamítnutý Promise, který vnější `try/catch` bez `await` nezachytí.

### P1 — chybějící path znamená serverový checkout

`new GitManager(undefined)` nepředstavuje „žádný Git“. Node proces bez `cwd`
spustí child proces v aktuálním working directory serveru. Read-only probe nad
stejným kódem v tomto checkoutu vrátil:

```json
{"success":true,"stdout":"/home/belphareon/worktrees/is-boundary-ratchet","stderr":""}
```

Legacy start i **jedenáct** následných `ProjectLifecycle.resume(lifecycleId)`
volání v `routes/expertises.js:544-793` proto vážou Git operace na serverový
checkout. Chatový `resumeWithContext()` je lepší: path hledá ve state/contextu
a pak v projektu. Přesto neodmítne stav, ve kterém path ani potom neexistuje.

### P1 — project route potvrzuje stav, který nemusel vzniknout

`routes/projects.js` zachytí chybu přímého DB insertu pouze warningem a potom
bez podmínky nastaví RAM state, bindne session a vrátí `200`. Neplatný
`projectId` se záměrně převede na `NULL`; `projectPath` se nekříží s kanonickou
cestou uloženého projektu. První další SPEC zpráva už jde přes chatový
`answerSpecQuestions()`, nikoli přes `startSpec()`, takže i obsahová sémantika
fází je jiná.

### P1 — chatový `/tmp` fallback obchází pojmenovaný scope

Při chybějícím `context.projectPath` chat vytvoří cestu `/tmp/lc-<čas>`, založí
projektový záznam a přes `ensureGit()` může inicializovat repository. Není to
kanonická cesta uživatelem zvoleného projektu a rozhodnutí R4 správně zůstává
BLOCK, ne lokální oprava sondy.

## Spustitelné negativní důkazy

Route factory byly zavolány se stubem `parseBody()` vracejícím `{}`. Obě cesty
končí před dynamickým importem lifecycle, DB a LLM:

```json
{
  "legacyLifecycleMissingInput": {
    "status": 400,
    "error": "projectId and request are required"
  },
  "projectLifecycleMissingSession": {
    "status": 400,
    "error": "sessionId is required"
  }
}
```

To potvrzuje pouze dnešní vstupní validaci. Není to parity PASS: legacy route
nevyžaduje path/session a project route nevyžaduje ani platný projekt.

## Co musí WP-E sjednotit

1. Jeden command přijme kanonický `projectId`; application service načte path
   z project repository. Chybějící projekt/path skončí explicitním odmítnutím,
   nikdy `/tmp` nebo process CWD fallbackem.
2. Jen lifecycle service/repository vytvoří lifecycle row a session binding;
   chyba persistence nesmí skončit `200`.
3. Chat i zachovaný HTTP vstup volají stejnou službu a vracejí stejný
   `lifecycleId`, phase a typovaný error. Alternativou je legacy endpoint
   operátorsky retireovat s `410` podle R5.
4. Jeden parity test pokryje chat, legacy HTTP (pokud zůstane) a project HTTP:
   pozitivní vznik, neexistující projekt, chybějící path, DB chybu a zákaz Git
   operace mimo kanonický scope.
5. R6 se rozhodne před prvním implementačním commitem WP-E. Tato sonda žádný
   fake adaptér ani injection rozhraní nezaložila.

## Limity sondy

- Neběžel pozitivní LLM turn ani skutečný lifecycle build.
- Nebyla rozhodnuta R4, R5 ani R6.
- Sonda neříká, zda legacy route opravit, nebo retireovat; dokazuje, že dnešní
  tři implementace nelze označit za parity.
- DB singleton a import-time migrace zůstávají samostatnou hranicí budoucího
  `LifecycleRepository`; zde se neměnily.
