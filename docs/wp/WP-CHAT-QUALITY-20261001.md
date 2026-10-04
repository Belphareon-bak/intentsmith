# WP — přirozený chat a pokračování v upřesněném zadání

Aktuální milníky, výsledky, otevřená selhání a publikační stav:
[průběžný dokument](WP-CHAT-QUALITY-20261001-PROGRESS.md), aktualizovaný po
každém milníku nebo nejpozději po třech hodinách aktivní práce.

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
`scripts/measure-m1-l3.js` a `scripts/chat-resilience-provider-relay.js`
(měření fsynced diagnostiky a konsolidace evidence mimo providerový požadavek;
shodná délka historie A/B a oddělená vývojová
zkouška dlouhého kontextu; původní 53případový korpus zůstává nezměněný),
`tests/registry.json`, přesný importní baseline, generovaný testový inventář, tento WP a vlastní review
report. Změna sdíleného modelového gateway, modelových bindingů, DB schématu,
providerové autority, mimochatových workerů a produkční instalace není součástí
této dávky. Konektory: ConversationStore → CRE → chat handler → M1 response;
existující přesné M2 schvalování se nemění.

Doplňující explicitní zadání operátora z 2. 10.: opravit fixture rozhodnutí,
významové archivní reprodukce a měřit růst ceny archivu a čisté složky latence.
`src/chat/archive-evidence-index.js` vlastní connection-local TEMP FTS5 cache;
nemění trvalé schéma ani zprávy. Hledání zůstává lexikální s citovanými sousedy,
nikoli sémantický rozhodovač. Výňatky mají přesný prefix a oddělený suffix
s bajtovou pozicí; mezera není zatajená. Modelový experiment byl v této fázi odložený.

Explicitní změna zadání operátora 4. 10.: pokračovat v přejímce a pro CHAT
použít Gemmu podle jeho nezávislého měření. Tato změna povoluje její ruční
produkční aktivaci jako jediné měněné role CHAT, s přesným dostupným tagem
`gemma4:26b`, přes existující binding application
API včetně nezbytné podporované obnovy. Uložené bindingy ostatních rolí,
gateway, trvalé schéma a provozní modelové politiky se nemění. Při obnově se
projevily již dříve uložené jiné runtime role CODE/R2/VISION; přesný skutečný
vedlejší dopad je uveden v S16 průběžného reportu. Izolovaný runner používá explicitní
tag/digest Gemmy; D1 zachová Qwen a přímá/aplikační větev stejný 4K rozpočet.
Původní kandidát z 2. 10. zůstane zmrazený, Gemma má nového kandidáta.
Čísla dodaná operátorem jsou vstup pro volbu, nikoli náhrada nové přejímky.
Obsah zapečetěného holdoutu zůstává nepřístupný; čeká se na privátní cestu.

Explicitní zadání operátora z 2. 10. po S10: s existující reprodukcí opravit
vymyšlené odeslání `recipient-bob` a neúplné složené zadání `gpu-composite`.
Stav neprovedeného efektu sestavuje aplikace, model dodává pouze textový obsah.
Před i po opravě proběhne 20 opakování každé reprodukce přes skutečné M1,
stejné vstupy, modelový digest, limity a čerstvé rozhovory. Probe
`quality-reproduced-defects` je ladicí regrese, nikoli nezávislý holdout.
Runner přijme `--holdout FILE --holdout-sha256 HEX`, ověří hash před inferencí
a zajistí neměnné fáze `holdout-1..3` s A/B. Ověření runneru používá pouze
syntetický dummy; zapečetěný adresář se neotevírá ani neprohledává.
Po čistém commitu, pushi a ověřeném SHA kandidát čeká na odpečetění operátorem;
odpovědi ze tří holdout sérií worker nečte ani nehodnotí. Toto zadání povoluje
jen obě doložené opravy a runner, ne ladění znalostí `versions`, změnu modelu
či neautorizovanou úpravu sdíleného routingu/CI.
Součástí runneru je čistý validační helper `scripts/chat-holdout-contract.js`;
aplikační helper `src/chat/unavailable-action.js` pouze kontroluje citované
úseky a skládá read-only odpověď. Tyto cesty vlastní chat WP z téhož zadání.

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
nikoli zelenou vývojovou bránu. Některé baseline chyby se chatu týkají:
`routing-accuracy` má chybnou účetní doménovou klasifikaci; exporty blokuje
chybějící autorizovaná PDF runtime. Tyto otevřené chyby zůstávají v reportu.

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

Doplnění operátora z přiloženého posudku: zmapovat řízené providerové, živé
a Studio důkazy odděleně; hodnotit celé dialogy, povinná fakta, konkrétní
omezení, obnovu po poruše, izolaci a skutečné efekty. Počet 10–12 průchodů
je vodítko pokrytí, nikoli náhrada významové přejímky. Původně oddělené rodiny F14–F20 jsou po S1/S2 exponované; všech 53 případů
se nadále používá jako regrese. Nezávislým holdoutem je pouze nový zapečetěný
corpus připravený operátorem 2. 10., bez expozice workerovi.
Starý test pěti frameworků zpřísňujeme na pět různých položek s negativní
kalibrací; tento strukturální oracle sám neprokazuje věcnou kvalitu textu.
