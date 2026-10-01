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
informaci; `file.write` vybírá poslední způsobilou odpověď. Starší tah bez
informace končí bez návrhu zápisu, protože původ obsahu nelze prokázat.

## Ověření a hranice

Registrovaný test spouští skutečné M1 HTTP rozhraní, řízený místní provider,
vlastní backend a soukromou SQLite. Porovnává bajty prvního požadavku i
souboru, trvalé označení původu tří asistentových tahů, restart backendu,
bajty druhého požadavku i souboru po dalším výslovném schválení.
Red-first **0/1**, po opravě **1/1 PASS**. `chat-persistence` **36/36** a
`m1-quality-contract` **7/7 PASS**. Ruční přímý běh
`m2-effect-file-consumer` čekal přes tři minuty bez dalšího výstupu a byl
ukončen; jeho stav je **INTERRUPTED**, nikoli PASS. Nezávislé review,
integrace a fyzický modelový pilot dosud čekají.
