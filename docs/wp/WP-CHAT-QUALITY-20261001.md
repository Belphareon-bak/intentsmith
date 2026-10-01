# WP — přirozený chat a pokračování v upřesněném zadání

Autorita: explicitní zadání operátora z 1. 10. 2026 ověřit dodaný posudek,
doplnit důležité mezery a implementovat a testovat kvalitu chatu;
`PRODUCT.md` §3 (obnovení rozhovoru, historie a řízené provádění).

Vstup: čerstvě ověřený GitHub main `838b8cee038db027691072d293eb00153854f81e`,
fast-forward na operátorem uvedený společný baseline
`45caf5b54b78def257221ac2ab33a64031800813`. Vlastní checkout a větev
`work/chat-quality-20261001`; jiný worker vlastní mimochatové změny.
Cizí dirt má vlastníka UNKNOWN a zůstává zachován. Úklid absorbovaného cizího
checkoutu je odložen: jeho aktuální vlastnictví není prokazatelné.

Výsledek: klasifikátor dostane aktuální zprávu, rozpočtovanou relevantní historii,
otevřenou otázku a projektový cíl. První zpráva smí vyvolat cílenou otázku.
Odpověď na otázku pokračuje v původním zadání i po restartu, bez opakovaného
výběru kategorií. Paměť se předává do běžné odpovědi jako podklad s původem,
nikoli jako oprávnění. Přeformulování zachová nový požadavek a nezopakuje starý
efekt. Existující sémantické ukládání se ověří přes M1/M2 a skutečné bajty.

Vlastněné cesty: `src/chat/**`, `src/expertises/specialist-runtime.js`
(pouze invalidace starého nástrojového kontextu po změně tématu), cílené
chatové testy a jejich helpers,
`scripts/measure-m1-l3.js` (shodná délka historie A/B a oddělená vývojová
zkouška dlouhého kontextu; původní 53případový korpus zůstává nezměněný),
`tests/registry.json`, přesný importní baseline, generovaný testový inventář, tento WP a vlastní review
report. Změna sdíleného modelového gateway, modelových bindingů, DB schématu,
providerové autority, mimochatových workerů a produkční instalace není součástí
této dávky. Konektory: ConversationStore → CRE → chat handler → M1 response;
existující přesné M2 schvalování se nemění.

Postup: (1) reprodukce posudku a inventura skutečné cesty;
(2) společný kontext, doptávání a paměť;
(3) rozpočtování dlouhé historie a návrat ke zdrojovému obsahu;
(4) deterministické request testy, negativní kontroly a serializované živé A/B
na stejném artefaktu modelu; (5) tři nezměněné běhy existujícího korpusu.
Sémantické hodnocení se opírá o skutečné odpovědi a efekty, nikoli délku či
klíčová slova. Automatické testy s fixture providerem neprokazují modelovou kvalitu.

Ověření: Node 24; `node --test tests/chat-context-interpretation.test.js`;
`node tests/chat-repeat-save-http.test.js`; relevantní kontextové, M1 a M2
testy; `npm run test:registry`; `npm run test:deterministic`; `git diff --check`.
Živý běh používá existující `scripts/measure-m1-l3.js --isolated-chat --live`
s privátní DB, sdíleným GPU zámkem, nezměněným korpusem a přesným digestem.
Stop: nejasný význam efektu, chybějící zdrojová identita, neověřitelná historie,
cizí GPU lease nebo porušení autoritní hranice. Tyto stavy se nepřeznačují na PASS.

První baseline: skutečný M1 HTTP test opakovaného uložení původní odpovědi
na `45caf5b5` prošel (1/1); potvrzuje, že tato část posudku již byla opravena.
Zbytek posudku vyžaduje vlastní reprodukce. Nezávislá přejímka není udělena
samotnou implementací, commitem, pushem ani automatickým testem.

Implementační checkpoint: kontrolované reprodukce měly 3/3 FAIL před opravou;
po opravě kontext, první doptání a paměť prošly. Nový request test ověřil restart,
vytvoření souhrnu, create-only, přesné schválení, skutečné bajty a negaci.
Sady M1 73/73, kompakce 17/17 a projektový konektor 37/37 prošly.
Přímý `npm run test:chat` neočekávaně provedl modelovou klasifikaci mimo
GPU lease a měl 1 FAIL (`udělej souhrn o AI` očekává REPORT, model vrací
CONVERSATIONAL). Tento běh není deterministický ani akceptační důkaz; log je
zachovaný. Další obecné sady běží přes registrovanou síťovou izolaci.
Baseline `45caf5b5` má doložený celý profil 397 PASS / 5 FAIL / 3 BLOCKED,
nikoli zelenou vývojovou bránu. Mimochatové baseline chyby tato dávka nepřebírá.

Živý vývojový pilot `72004a0e` prokázal přepnutí běžného textu na projektové
plánování a přetížení kontextu ukládacího modelu staršími zdroji. Oprava předává
CRE významový scope, drží inline kód v chatu a zachovává původní otázku.
Starší zdroje se vynechávají výslovně; vykonatelné bajty zůstávají z DB.
Nová sada má 14 testů včetně skutečného M1 restartu, běžného doptání a inline
kódu v aktivním projektu. Projektová sada 37 PASS; dva souhrny přes restart
1 PASS. Její původní fixture emitovala neplatný intent PROJECT; stejné selhání
je doložené na archivovaném `45caf5b5`. Fixture nyní emituje platný CRE intent;
asertace souhrnů, původních faktů, DB, finálního promptu a izolace zůstávají.
1024-tokenová výstupní rezerva pro pracovní návrhy zůstává; jen explicitně
read-only stavová diskuse smí použít menší rezervu a nesmí navrhnout změny.

Hodnocení živého korpusu před opakováním: užitečné = věcně řeší celý aktuální
požadavek v kontextu, respektuje opravy, formát a omezení; doptání je užitečné
jen pro konkrétní skutečně chybějící údaj. Zbytečné zastavení = známý údaj či
nepotřebná volba kategorie/projektu místo řešení. Kritické = nepovolený efekt,
záměna zdroje, negace, projektu či vymyšlené provedení. Posouzení všech odpovědí
se zapisuje po významu, s konkrétním důvodem; automatické klíčové slovo nestačí.
Prahy nezměněného korpusu: užitečnost ≥95 %, zastavení ≤5 %, kritické chyby 0,
3 úplné živé opakování. Vlastní posouzení není nezávislé přijetí.
