# WP — sjednocení rozhraní transakce generovaného SQLite projektu

**Stav:** `IMPLEMENTATION_GREEN / CPU_FOCUSED5_PASS / SOURCE_REVIEW_PENDING / REGISTERED_GATE_PENDING / LIVE_NOT_RUN`.
**Vlastník:** ROOT, stávající integrační checkout; výchozí dokumentační
HEAD `fd749bacf0e19e65e602cd5dbe46c57c058f5342`.
**Autorita:** operátorem požadované dokončení skutečných CODE projektů;
existující typed M2 draft/revision/approval, bez nového efektu či oprávnění.
CHAT, produkční BE/DB/vazby a obecný M2 import scanner jsou mimo rozsah.

## Skutečný důvod změny

Jediný zmrazený průchod `a27e44701c2160e24ef4b3a37528f6a2f6e745a4`
17:37:41.151–17:38:37.501UTC dodal8/8 úplných Qwen3.8/22130167 výstupů.
Jedna oprava schema odstranila nepovolenou dependency; nový frozen oracle
pak při prvním create odmítl `tx.add` nad undefined. CLI očekává argument
callbacku, ale store vykoná `fn()` bez argumentu; service jej pouze předá.
Původní tři instrukce určují transaction(fn)/forward/BEGIN-COMMIT, ale
neurčují argument callbacku. Jde o skutečný nesoulad rozhraní modulů,
nikoli useknutou odpověď či chybu sandboxu. Oba návrhy rollback7/7, bez commitu.

Nezávislý failure evidence review SHA
`fbaba85e69f83a54ec9a43ab23c3ed41c6cc30cd53d7f3a0395f2ff71545558e`
ověřil všech379 původních souborů/19,849,491B, durable failed terminály,
14 after_bytes BLOBů a oba nové/odmítnuté approval toky. Aplikace zůstává
FAIL. Žádná její skutečná generace se nezmění ani nevydá za přijatou.

## Předem zvolený API kontrakt

Transakce je synchronní obal `transaction(fn)`, který zavolá `fn()`
**bez argumentů**, vrátí jeho výsledek, při úspěchu COMMIT a při výjimce
ROLLBACK a rethrow. CLI callback používá svůj otevřený `catalog` z closure.
Service předá tentýž callback store; všechny CRUD operace se provádějí přes
catalog, aby zůstala service validace. Jediný callback argument se nesmí
v jednotlivých modulech nezávisle domýšlet.

Alternativa `fn(catalog)` je možná jako jiné předem určené API, ale prosté
předání store API by obcházelo service validaci. Tento WP volí bezargumentový
callback; nevytváří souběžně druhý kontrakt ani další opravovací loop.

## Omezený rozsah a invarianty

1. WP-first commit před změnou. Upřesnit pouze tři existing instruction
   hodnoty `src/cli.js`, `src/service.js`, `src/store.js` v
   `scripts/project-sqlite-catalog-acceptance.js`; ostatní čtyři instrukce
   a celkový projektový kontrakt ponechat přesné.
2. Oracle SHA `28c9b73f1eec7e0b32a6e563f75f71da1d7b9f60a6a8dc149fbdbbb2c9a0ceb3`,
   entrypoint, dependency graph, policy, sandbox, kontextové budgety a
   modelové identity se nemění. Veřejné run(dbPath,commands), tuple/API,
   atomická celá dávka, invalid/no-mutation a procesová persistence zůstávají.
3. Produktové src/contracts/IDE/specialists/skills, package/lock, registry
   descriptor a existující revision helper/CLI se nemění. Testové oracles
   se nepřizpůsobují nevyhovujícím modelovým odpovědím.
4. Ověřit instrukce v přesném source diffu, CPU existing app/M2 sady a
   registrované dotčené brány; nezávislé source review, push exact SHA a CI.
   Nepsat testy, které jen kopírují novou instrukční větu.
5. Jediný nový frozen live průchod se stejným Qwen3.8 digestem22130167,
   existing `--revision-once` s nejvýše jednou schema opravou. Nový privátní
   projekt/DB/evidence; žádný manuální repair ani automatické další opakování.
   Fresh GPU/readiness a canonical lease; cizí inference zůstává nedotčená.
6. Nezávisle ověřit model→preview→M2 durable bajty, approval, rollback či
   commit a při úspěchu replay/restart/persistence. Export jen skutečně
   přijaté source-only aplikace. FAIL je platný výsledek kvalifikace.

Před zahájením implementace nebyl spuštěn další modelový request ani změněn
callback v raw aplikaci. Tento WP nezaručuje obecné CODE plánování,
jednopokusovou modelovou spolehlivost, HTTP projekty ani celý release.

## Implementační checkpoint 18:01 UTC

WP-first `d895fef92fcf2777ad16de2688139f3ac1a044f4` předcházel změně.
Pouze tři instruction hodnoty nyní určují stejný synchronní callback,
bezargumentové zavolání a CLI closure s service validací. Nezvětšil se
existing512B instruction limit. První příliš dlouhá formulace měla
**44 PASS / 22 FAIL**, exit1,62 813.9ms; log SHA
`a929ed81d5fd959462eabd8029ccc093ae08eda7c35104e17615235259ec1ba5`
je zachovaný. Jde o autorskou chybu qualification vstupu, nikoli nový
produktový regression verdict. Tato formulace nebyla použita pro inference.

Po zkrácení při zachování požadavků mají instrukce CLI497B/service492B/
store512B. Existing cílené compiler/provider/provenance/actual-M2 testy
mají na posledním přesném vstupu **5/5 PASS**, exit0,5346.2ms, log
`47b297c768963d5980deebf895063e01603d98711dff5faff942368c3f5f611a`.
Další čtyři instrukce, oracle28c9, entrypoint, produktové stromy, registry
a resource/context budget zůstávají přesné. Nezávislé source review,
celý registered gate a aktuální push CI ještě čekají; LIVE_NOT_RUN.
