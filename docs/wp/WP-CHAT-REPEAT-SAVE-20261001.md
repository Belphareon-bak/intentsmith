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
aktuálně **1/1 PASS**. Po integraci je
nutné ověřit společné řazení historie podle `messages.id` z WP ordinal;
samostatná větev této opravy vychází ze staršího zdroje. Nezávislé review,
integrace a fyzický modelový pilot dosud čekají.
