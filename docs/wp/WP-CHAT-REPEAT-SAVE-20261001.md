# WP — opakované uložení původní odpovědi

## Reprodukce

Skutečný M1 HTTP průchod nad soukromou SQLite nejprve vytvořil odpověď,
navrhl její uložení do `copy.md` a po výslovném M2 schválení provedl zápis.
Následný pokyn „Ulož ji i do copy-backup.md“ navrhl do druhého souboru
potvrzovací hlášku `✅ Efekt … byl proveden`, nikoli původní odpověď. Přesný
red-first test selhal porovnáním trvalého `tool_v1_requests.request_json`.

## Změna

Finalizér nově ukládá k asistentovu trvalému tahu jednoduchou příznakovou
informaci, zda je jeho obsah způsobilý být zdrojem dalšího zápisu. Návrh
zápisu, hláška o schválení, čekání na schválení, blokování a chybová odpověď
takový zdroj netvoří. Historie předaná handlerům nese tuto perzistentní
informaci i ID projektu, ke kterému odpověď patřila při zahájení tahu.
`file.write` přeskočí jen známé procesní hlášky; nejnovější skutečnou odpověď
smí použít pouze ve stejném projektu. Starší tah bez informace nebo odpověď
z jiného projektu končí bez návrhu zápisu.

První nezávislé review `0ad0b4f7` bylo **CHANGES_REQUIRED**. Skutečný M1
HTTP/SQLite průchod přeřadil konverzaci z projektu A do B, navrhl zápis
soukromé odpovědi A do B a po schválení jej provedl. Nový red-first test
tuto cestu reprodukoval. Oprava váže zdroj na trvalé ID projektu a při
neshodě nepokračuje ke starší odpovědi. Test pokrývá i cyklus B→A→B.
Přeřazení může proběhnout během čekání na provider: kontroler zachytí
projekt při vstupu tahu a před uložením odpovědi jej porovná v jedné SQLite
transakci. Změna během tahu ukončí odpověď bez asistentského tahu, takže
obsah A nevznikne jako zdroj pro B.

## Ověření a hranice

Registrovaný test spouští skutečné M1 HTTP rozhraní, řízený místní provider,
vlastní backend a soukromou SQLite. Porovnává bajty prvního požadavku i
souboru, trvalé označení původu tří asistentových tahů, restart backendu,
bajty druhého požadavku i souboru po dalším výslovném schválení.
Red-first **0/1**, po opravě **1/1 PASS**. `chat-persistence` **36/36** a
`m1-quality-contract` **7/7 PASS**. První ruční přímý běh
`m2-effect-file-consumer` čekal přes tři minuty bez dalšího výstupu a byl
ukončen. Jeho fixture postrádala novou informaci o trvalém původu předchozí
odpovědi, takže první test správně nevytvořil efekt, ale čekal na něj bez
timeoutu. Fixture nyní výslovně označuje důvěryhodnou odpověď; opakovaný
samostatný běh prošel **39/39 PASS**. M1 test nyní kontroluje A→B, B→A→B a
přeřazení během provider requestu i starší netagovaný asistentský tah,
aktuálně **1/1 PASS**. Samostatný kandidát `d2121e3b` získal nezávislé
**REVIEW_PASS** s podmínkou integrace řazení podle `messages.id` z WP
ordinal. Kombinovaný kandidát `f5ca79a9` zachovává toto řazení i schválený
parser doslovného zápisu a zákazu přepsání.

Rozšířený M1 test vytvoří přes HTTP sedm různých odpovědí a potom ve
zastavené soukromé testovací DB sjednotí čas všech čtrnácti tahů. Po restartu
porovná přesný trvalý požadavek a schválený soubor s nejnovější odpovědí.
Tento průchod zahrnuje i již vytvořený souhrn historie; **1/1 PASS**.
Samostatný registrovaný `chat-history-order` kontroluje posledních deset
z dvanácti tahů se shodným časem; **1/1 PASS**. Společný
`chat-literal-write-http` **1/1** a `m2-effect-file-consumer` **39/39 PASS**.
Přijetí tohoto mezikandidáta bylo pozastaveno kvůli níže uvedené regresi.

Širší offline/database profil na `6d16e3f8` našel regresi C15: neúplný
`ulož to` bez oprávnění skončil na parseru místo `effect_authority_required`.
Kontrola oprávnění nyní předchází parseru i volbě zdroje. Původní C15
prošel společně s celou sadou **26/26**, M1 literal **1/1**, M1 repeat
**1/1** a M2 consumer **39/39 PASS**. Přerušený profil zůstává **FAIL**
(`98 PASS / 5 FAIL / 5 BLOCKED / 297 SKIPPED`), včetně chybějících
závislostí IDE a nepovolených lokálních toolchainů; nový celý profil čeká.

Nový čistý `c1a25dc1` získal nezávislé **REVIEW_PASS** pro kombinovaný source
a testovací izolaci. Reviewer zopakoval C15 **26/26**, oba M1 průchody
**1/1**, M2 **39/39**, řazení historie **1/1**, stage **13/13** a harness
meta test. Návrat pouze `getLastN` ke starému řazení podle času změnil
registrovaný test historie na **0/1**; obnovení ID řazení vrátilo **1/1**.
HTTP fixture nad souhrnem prošla i pod touto mutací a tento SQL defekt sama
nezachycuje. Source je integrovaný; nový celý profil a fyzický modelový pilot
stále čekají. [Review receipt](../review/2026-10-01-CHAT-STAGING-INTEGRATION-REVIEW.md).
