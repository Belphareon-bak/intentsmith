# C7 — zachování zdroje při opakovaném doptání na uložení

Stav: CPU38PASS, SOURCE_AND_EVIDENCE_REVIEW_PASS; původních19 CHAT7/CODE12 sad PASS na čistém checkpointu1c7617a2.
Aktuální deník: [WORK-PROGRESS](../WORK-PROGRESS.md).
Autorita: přijatý WP-CHAT-QUALITY-20261001 a explicitní operátorské zadání
přirozeného pokračování, zachování významu a přesného schválení efektů.

BASE `cd3b8f02b65dbe0a92eab625ff39a5447f00cdb0`; produktový kandidát
`1c7617a218183470c6b8d51c57e59c3dad797ede`. Oprava mění pouze handler
ASK_USER a stávající kontextový test; prompty, modely, 4K, save resolver ani
schvalovací autorita se nemění. [Přesný diff, příkazy, exity a SHA-256 důkazů](evidence/chat-save-context-20261007/result.json).

Známá posloupnost „Ulož tu odpověď.“ → otázka na cíl → „ano“ → „photo.md“
ztrácela po klasifikaci AMBIGUOUS .5 core fileSaveClarification. Původní zadání
a operace zůstaly klasifikátoru dostupné, ale save interpreter je kvůli chybějící
provenance nedostal. Řízená RED/GREEN reprodukce dokládá aplikační ztrátu
kontextu. U prvního běhu C6 raw request165 potvrzuje chybějící pending pro
cílový save interpreter; oprava sama zatím neprokazuje nápravu všech tří živých
výsledků. C6 výsledky118/159 užitečných a24/159 zbytečných zastavení zůstávají
platným naměřeným NO_GO.

Nová větev zachová výhradně již uložený core zdroj, původní uživatelský tah
a případnou sourceBarrier při výslovném pokračování aktivního doptání ve stejném
projektu. Příchozí decision nesmí tuto provenance nahradit. Nový úkol, chybějící
potvrzení návaznosti, neaktivní stav nebo jiný projekt ji nepřebírají.
SourceMessageId určuje identitu odpovědi; není novým neměnným hashem jejího obsahu.

RED reprodukce s fixture providerem a skutečným M1/SQLite zachovala direct-save
kontrolu, ale po vloženém AMBIGUOUS .5 ztratila source/user/project ID a restart tuto
ztrátu zachoval;
exit1 byl očekávaný. Nové testy starý zdroj odmítly v9 z10 koncových kontrol
(Node počítá také neúspěšného rodiče). GREEN s opravou má38PASS/0FAIL/exit0.
Skutečný HTTP test zachoval summarize/create-only a doslovný obsah včetně původního
user-message ID přes doptání a restart. Soubor vzniká až po přesném schválení.
Devět handler→resolver kontrol zahrnuje podvrženou provenance, novější odpověď,
nový úkol, neprokázané pokračování, jiný projekt, zaniklý zdroj a sourceBarrier.
Původní zrušení, no-overwrite, nové zadání a stale-source assertions zůstaly.

První úplný GREEN pokus měl37PASS/1FAIL: zúžený fixture chybně neobsloužil
původní stale.md pokračování. Dvouřádková oprava obnovila jen přesnou fixture
větev s původním pending requestem; žádná assertion se nezměnila. Jeho log zůstal,
automaticky uklizený direct runtime není vydáván za dostupný DB důkaz. Další
přípravný pokus odmítl práva privátního adresáře před testy; následný samostatný
retained runtime s privátními právy poskytuje všech1280 hashovaných artefaktů.
Audit19 před source checkpointem správně odmítl dirty checkout, bez vykonání sad.

Živá cílená regrese společného C7+C8 `e6b83884` skončila
**STOPPED_INCOMPLETE / OBSERVED_SAVE_FAILURE**. Původní známé čtyři případy,
runner i corpus zůstaly beze změny; ze tří plánovaných sérií proběhla jediná.
7.10.20:26:18–20:26:39UTC: čtyři HTTP200 tahy,7úplných Gemma4/4K volání,
runnerexit0. První tři dílčí požadavky splněné, „photo.md“ ale dostalo další
zbytečné potvrzení místo přesného návrhu uložení. Proposal/approval/write0,
photo.md nevzniklo, původní projektové soubory zůstaly beze změny.

Vlastní DB kopie s integrityPASS potvrdila, že po „ano“ zůstaly původní
sourceMessageId2/userMessageId3 a požadavek „Ulož tu odpověď.“. Finální
klasifikátor dostal tuto pending operaci i historii, ale vrátil
continuesPending:false. Save interpret pak dostal samotné photo.md a správnou
původní odpověď2; vyžádal další potvrzení. Nový pending stále odkazuje na
odpověď2, ale na uživatelský filename tah7. Tato série tedy dokládá zachování
zdroje přes „ano“, zároveň další praktickou chybu návaznosti. Nedokládá celkovou
nápravu save cesty ani izolovaný kauzální účinek C7 proti C8.
Nezávislé sémantické/DB review a71b81c7…69ec,139raw refs d3669907…c0b7.

Cleanup po potvrzeném promptless unload narazil na novou procesní identitu
Ollama gpu-discover1595839, která nebyla v předem ověřené množině. Exit1,
bezprostřední postflight takéexit1; obě lease uvolněné. Série2/3 jsou NOT_RUN,
žádný další actual se v tomto paketu nespouští. Samostatné pozdější tři prázdné
vzorky20:35:24–27UTC/providerexact/leaseabsent jsou pozorování bez držené lease,
nikoli nový READY nebo přepsání historického FAIL. Reviewer navíc potvrdil
neexistenci čtyř pozorovaných runner/server/llama/discovery PID a opět shodu
9523hashů/14linků; nejde o úplný audit všech možných potomků.
Cleanup review f81c6933…8b39f, source closure před/po původním actual PASS.

Nejde o nové skóre53 případů ani H1/H2 přejímku. H1/H2, restricted/ a jejich
odpovědi jsou zakázané vstupy; produkční binding a release stav se nemění.
GPU okno tohoto sběru je uzavřené. Reviewerovo nové opakování vyžaduje nové
sériové okno/lease a nové output cesty, nesmí navázat na spotřebovaný freeze.
Nejbližší diagnostika má oddělit chybu modelové návaznosti od předání požadavku
save interpretu, s negativními případy skutečně nového úkolu a zrušení. Z této
jediné série nelze rozhodnout, že lokální model nedosáhne95%.

Původní CHAT7/CODE12: 7.10.19:51:48–19:54:32 UTC,19PASS/0FAIL/BLOCKED/TIMEOUT/SKIPPED, exit0. Přesný příkaz a raw report patří čistému1c7617a2. Nejde o opakování celého410suitového profilu ani živou kvalitu.

Původní CI na1c7617a2 skončilo po20min timeoutu při apt downloadu, před CHAT/CODE
kontrolami; pokus o rerun odmítnut403 oprávněními integrace. FAIL/cancelled historie
zůstává. Následný společný C7+C8 e6b83884 má samostatnou čistou integraci19PASS
a [CI37680691150](https://github.com/Belphareon-bak/intentsmith/actions/runs/37680691150) všech18SUCCESS.
Publikace a zelené CPU kontroly nejsou přijetí živé kvality ani release.

### C10 — oddělení chyby návaznosti a ztráty pending (8.10., bez nového modelu)

Na čistém dd8a451b proběhly dvě izolované4tahové M1/DB varianty se skutečným
restartem po „ano“ i finále. Sedm response contents je byteově převzato z C7 raw;
jediná syntetická změna je classifier request17 continuesPending:false→true.
Request17 dostal oběma variantám totožný relevantní vstup. Následující
request19 je file.save.interpret, nikoli D1; jeho vstup se liší přítomností pending.

False: clearSupersededFileSaveQuestion původní pending odstraní; resolver dostane
photo.md +answer2, konečný stav má originalRequest:photo.md/user7. True: resolver
vidí „Ulož tu odpověď.“ a původní user3. Zdrojanswer2 zůstává v obou. Obě varianty
mají8durable zpráv,0všech5sledovaných efektových počtů a nezměněný projekt/Git;
6vlastních product stopůexit0. Sada3PASS, nezávislé reviewc0e704e0…0164a1.
Stejná konečná otázka je VYNUCENÁ REPLAYEM; není výsledkem lepšího modelu ani
samostatným důkazem chyby save interpretátoru. Neopravuje produkt nebo skóre C6.
Ignorovat false by ohrozilo zrušení či nové zadání. Před změnou patří do kontrol
cancel/new task, jiný projekt, inactive pending, chybějící zdroj a literal/user
provenance i summarize/create-only. Žádný nový prompt, regex nebo binding nevznikl.
Raw RESULT ee7c2ee5…315c, MANIFEST4aa41e22…515f a nezávislý receipt s přesnými
cestami/SHA jsou v [společném paketu](evidence/chat-terminal-errors-20261007/result.json).
