# WP — skutečná oprava neúspěšného CODE návrhu přes existující M2 revizi

**Stav:** `SOURCE_REVIEW_PASS / REGISTERED9_PASS / CI_SUCCESS / APPLICATION_PHYSICAL_FAIL / FAILURE_EVIDENCE_REVIEW_PASS`.
**Vlastník:** ROOT, existující integrační checkout; zdroj před změnou
`6af06ea622dbb955cdb53e7fb2c69b430bfe8957`. Autorita: operátorem požadované
dokončení a skutečné projektové testy; stávající M2 failed-plan revision.
CHAT ani nový sandboxový či síťový effect není součástí rozsahu.

**Navazující autorizace 21:32 UTC:** operátor po konkrétní eskalaci udělil
veškeré povolení pokračovat k dokončení produktu. Původní níže uvedený
jednoschema profil a jeho osmigenerační FAIL zůstávají historicky přesné.
Nová omezená CLI revize nad kopií téhož failed runtime je vymezena v
[CODE context WP §8](WP-CODE-PEER-CONTEXT-BUDGET-20261001.md#8-autorizované-pokračování--1-10-2026-2132-utc).
Nejde o zpětnou změnu frozen protokolu ani schválení neúspěšné aplikace.

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

## Nezávislý nález a oprava 17:13 UTC

Publikovaný první kandidát `f17aaa27e6db2c0dddb16e30cbe9b6b0f4f4b6ab`
má **CHANGES_REQUIRED**, review SHA-256
`319e5c9008164be875fe84a087be6540d21f5687b9fabd6ef26cf0b7487f33f3`.
Reviewer skutečným frozen sandbox oraclem doložil CLI chybu se stejným
stderr markerem, zatímco schema nemělo žádné dependencies. První helper
by i tak povolil opravný request. Druhý nález: stav NOT_EXERCISED zůstával
do dokončení approval, i pokud osmý request již začal. První reviewer probe
exit1 kvůli nesprávnému result.output poli je zachovaný jako chyba revieweru,
nikoli produktový důkaz. Counterexample postprocessor využil již uložený
skutečný výstup, frozen f17 helper a zachoval původní data.

Registered f17 gate měl **8 PASS / 1 FAIL**, exit1, report
`d367c3f95b53ea17853dc96bd53d646964fa7ebad11be3e3aa7a96e2510bb046`:
artifact-validation zjistila neaktualizovaný SYSTEM-MAP test LOC census.
Tento výsledek se nepřeznačuje na zelený.

Oprava před osmým requestem parsuje přesný původní schema afterContent
pomocí existující locked JS/JSX grammar, bez evaluace. Vyžaduje skutečnou
static dependency declaration/reexport; komentář, string nebo regex nestačí.
stderr marker a typed failed/rollback zůstávají nutné, samotný marker již
nestačí. Jednoúčelový qualification AST guard neopravuje obecný M2 scanner.
NOT_EXERCISED patří jen počátečnímu success; další fáze jsou
REVISION_NOT_ELIGIBLE, REVISION_STARTED před requestem a REVISION_DRAFTED
před novým approval. Konečný stav aplikace se samostatně hodnotí oraclem.

Úzká CPU sada má **4/4 PASS**, log SHA-256
`6b583325ea56ec7277b136254f404bd3d5a48775b7c55065019a4370ffa2dfb9`.
Obě celé app sady mají **66/66 PASS**, exit0, 55 292.2 ms, log
`933a3da611759fd2ee2e60672cab86c8583a851ef580e04a70521c53195c9592`.
SYSTEM-MAP byte census je přeměřen: src681JS/234011LF,
tests600JS/266085LF; registry descriptors/fingerprint, produktové stromy,
SQLite oracle28c9 a všechny původní modelové bytes zůstávají stejné.
Nové nezávislé review a nový clean registered gate jsou REVIEW_PENDING.

## Přesná source přejímka a jediný skutečný průchod 17:37–17:38 UTC

Kandidát `a27e44701c2160e24ef4b3a37528f6a2f6e745a4` má nezávislý bounded
source REVIEW_PASS, SHA-256
`6d709946d45d1384c55f61b696f0a1fad717e8d8ccf770e16745e86ffd6b2677`.
Reviewer ověřil4 skutečné pojmenované CPU testy a21 vlastních kontrol;
originální CLI spoof je odmítnut před pokračováním. Registered gate
má9/9 PASS, report `c595d99837e8621c30657ad4b639eb07d6c526740bb0f8cead0f17e3e71c0511`.
[Push CI36898069050](https://github.com/Belphareon-bak/intentsmith/actions/runs/36898069050)
má13 kroků SUCCESS. Historické f17 CR a8PASS/1FAIL zůstávají beze změny.

Jediný fyzický běh exact sourcea27 proběhl17:37:41.151–17:38:37.501UTC:
**FAIL, exit1, ONE_REVISION_EXECUTED**. Qwen3.8/22130167 provider0.34.0
dodalo8/8 úplných pinned odpovědí; všech sedm initial preview pinů,
osmý parse-only replacement a šest retained final pinů souhlasí.
Schema oprava odstranila nepovolenou dependency. Nový plán a nové approval
prošly, ale nový frozen oracle selhal na skutečné `tx.add` nad undefined:
CLI očekává callback argument, store vykonává `fn()` bez argumentu.
Osmá odpověď neřešila ostatní moduly a tím se neobchází one-revision scope.

Oba terminály jsou failed; final result má PROJECT_CHANGE_TEST_FAILED,
rollback7/7, Git commitId null a původní HEAD. Actor hlásí vlastní model
unload, lease release a čisté source. Úspěšný final replay/postrestart
nebyl dosažen; nezávislá actual DB/provenance přejímka zatím PENDING.
Raw result SHA `0cc384be7344cc3baead1d255f1598ea0a2122b9dbec111b3953ba3ea7668bb8`,
inside evidence `25ab19a38660bea48d7687e17228aaa6b8a605048d7f1fa2631be144bdb1f16c`.
Privátní379 souborů se zachovává. Žádný manuální generated fix ani opakování
stejného kandidáta; další API upřesnění musí být předem zmrazené v novém WP.

Nezávislé actual review je uzavřené: **FAILURE_EVIDENCE_REVIEW_PASS**,
SHA `fbaba85e69f83a54ec9a43ab23c3ed41c6cc30cd53d7f3a0395f2ff71545558e`.
Všech379 původních souborů/19,849,491B zůstalo přesných. Reviewer nezávisle
rekonstruoval7 afterContent +8. replacement, initial/final preview a14
SQLite after_bytes BLOBů; dvě oddělená approval, oba409, dva7-path rollbacky,
durable failed terminal/results, baseline Git/absent7 a vlastní cleanup.
Úspěšný replay/postrestart zůstává NOT_REACHED. První reviewer audit exit1
chybně porovnal80-line context se SHA celého souboru; zachován odděleně,
opravená kontrola celých souborů exit0. Původní sourcea27 a pozdější docs
HEADfd749bac jsou rozlišené. Další upřesnění je ve
[WP transakčního callbacku](WP-SQLITE-TRANSACTION-CALLBACK-CONTRACT-20261001.md).
