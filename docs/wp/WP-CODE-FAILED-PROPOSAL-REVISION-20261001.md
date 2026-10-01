# WP — skutečná oprava neúspěšného CODE návrhu přes existující M2 revizi

**Stav:** `WP_FIRST / IMPLEMENTATION_NOT_STARTED / LIVE_NOT_RUN`.
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
nezávislé funkční/provenance přejímce. Tento návrh nebyl dosud implementován.
