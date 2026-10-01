# WP — skutečná oprava neúspěšného CODE návrhu přes existující M2 revizi

**Stav:** `IMPLEMENTATION_GREEN / REVIEW_PENDING / LIVE_NOT_RUN`.
**Vlastník:** ROOT, existující integrační checkout; zdroj před změnou
`6af06ea622dbb955cdb53e7fb2c69b430bfe8957`. Autorita: operátorem požadované
dokončení a skutečné projektové testy; stávající M2 failed-plan revision.
CHAT ani nový sandboxový či síťový effect není součástí rozsahu.

## Důvod a přesné omezení

Qwen3.8 na source34 dvakrát porušilo schema dependency kontrakt. Druhý
pokus byl správně odmítnut a rollbacknut. Qwen3.6 dokončilo jen čtyři
moduly, pak byl další prompt odmítnut pro překročení CODE budgetu.
Tyto skutečné FAIL zůstávají; nelze je ručně změnit na přijatou aplikaci.

Produkt už poskytuje `draft.revisionOf` a `reusePrevious`: stejný vlastník
může nad přesným terminated failed/cancelled plánem a stejnou workspace
revision nechat model navrhnout přesné replacements. Předchozí neprovedené
bajty pocházejí z authority material, oprava musí vytvořit nový digest a
vyžaduje nové schválení. Nejde o nové automatické opravování produktu.

## Předem vymezený test

1. Ve zcela novém privátním projektu/DB v existujícím frozen runneru zadat
   stejné sedmimodulové SQLite zadání s již instalovaným Qwen3.8 digestem
   `22130167c4c20e20c7b71454612966ca8e8171e9b3cc8ab6ce8aa6cbfec79643`.
   Oracle28c9, vstupní sedm instrukcí, policy, entrypoint a resource budget
   jsou invarianty. Žádné ruční opravy generated source.
2. Samostatná explicitní volba `--revision-once` dovoluje nejvýše jeden
   další modelový request pouze pro `src/schema.js`, pokud první approval
   skončil typed PROJECT_CHANGE_TEST_FAILED a frozen dependency kontrola
   doložila schema chybu. Jiný důvod selhání zůstává FAIL bez pokračování.
3. Ověřit 7/7 rollback, původní HEAD a frozen bytes. Vyžádat nový draft
   pomocí přesného `revisionOf`; šest ostatních souborů označit
   `reusePrevious`. Jediný pevný opravný pokyn je splnění již existujícího
   schema kontraktu bez závislostí a se zachováním exportů. Nezvolňuje se
   oracle, policy, kontextové limity ani rozpočet modelu.
4. Nový plán musí mít nový lifecycle/digest a přesně stejných šest modulů.
   Starý approval nesmí autorizovat opravu. Nové přesné schválení, stejný
   frozen oracle, Git commit, restart a durable DB jsou samostatné důkazy.
5. Provider evidence samostatně váže prvních sedm úplných afterContent na
   původní preview a osmý skutečný replacement na výsledný schema modul.
   Konstruktér replacementů je existující parse-only M2 compiler; žádné
   generated module se nespouští v trusted parent procesu.
6. Pokud původních sedm generací projde, kvalifikace může být funkční PASS,
   ale revize musí být označena NOT_EXERCISED. Nelze vynutit modelovou chybu
   ruční mutací a pak ji vykazovat jako přirozený modelový výstup.

## Implementační scope a brány

Pouze runner, jeho existing registered app testy/helper a tento WP + měřené
docs. Produktové src/contracts/IDE/specialists/skills ani registry descriptor
se nemění. Připravit CPU actual-M2 failed→rollback→revision→new approval
pozitivum a špatný digest/nezachované bajty/false provider provenance
negativa. Původní režim bez volby musí mít stejné chování i evidence shape.
Source review, dotčené registered gates a push/CI předcházejí jednomu
zmrazenému živému průchodu. Žádná další inference během cizího GPU lease.

Nejde o přijetí jednopokusové modelové spolehlivosti, obecného automatického
repair systému, projektového plánování, HTTP aplikací, expertíz ani release.
Privátní raw output zůstává zachovaný; veřejný source-only snapshot až po
nezávislé funkční/provenance přejímce.

## Autorský CPU checkpoint 16:56 UTC

WP-first commit `8e069c030ac5242a52c03cac17cf2704feb5ec9b` předcházel kódu.
Scope implementace: runner, nový parse-only qualification helper a dvě
již registrované app sady. Produktové stromy ani SQLite oracle se nezměnily.
První nový actual-M2 test měl **0 PASS / 1 FAIL**, exit 1: závěrečná kontrola
DB chybně použila neexistující tabulku. Log SHA-256
`6524c21357e0ac0ccc671310699740dcab6bc4ef9a5a5918f3565664c2713ad5`
je zachovaný; není to produktový PASS. Po opravě SQL dotazu měla úzká sada
**3/3 PASS**, exit 0, log `76dadfb8a9f92403c1b0f38bba5a6f382e27316c83cb9fb9b8080c0cefd1e284`.

Konečné dvě celé CPU app sady mají na explicitním Node24 **65/65 PASS**,
0 FAIL, exit 0, 42 631.7 ms. Log SHA-256
`d278fffaee6d450a621fc4a8337b37c16a55946b9ff2f9297aa282a9b0284b09`.
Skutečný M2 fixture doložil failed→7 rollback→nový digest/lifecycle,
šest byte-identických retained modulů, odmítnutí starého approval digestu,
nové approval→frozen test→commit a po uzavření writeru read-only DB se dvěma
terminály failed/succeeded. Generátor této CPU fixture je deterministický,
nikoli model; fyzická revize zůstává LIVE_NOT_RUN. Provider controls
rekonstruují osmý replacement a odmítají changed retained/schema bytes,
jiný model digest, truncation, chybějící i přebytečnou generaci.
Nezávislé source review, přesný registered gate a push/CI ještě čekají.
