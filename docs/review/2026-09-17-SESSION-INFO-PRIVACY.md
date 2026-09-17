# Soukromí informačního API relací

Stav: **IMPLEMENTED / REVIEW_REQUIRED**, instalace a úplný profil se doplní
po ověření připnutého kandidáta. Autorita: operátorem předané nezávislé
review `ba7c72d6..3bbf8bc1`; [WP](../wp/WP-PRIVACY-PANELS-REREVIEW-20260917.md).

Review potvrdilo odmítnuté zprávy bez logování a zachování dat přes skutečné
restarty. Našlo však únik pracovní paměti otevřené relace v obou informačních
GET endpointech po vypnutí `memory.saveContext`, před dalším tahem chatu.
Předchozí tvrzení o veškerém získávání živého stavu bylo příliš široké.

## Oprava a hranice

`SessionState.toJSON()` čte současnou DB policy při každé serializaci.
Při false nebo neplatném nastavení vynechá `projectWorkingMemory` úplně.
Stejná hranice pokrývá jednotlivý detail, seznam, přímé `JSON.stringify`
i `saveToStorage`; duplicitní gate jen ve storage je odstraněn.

`getSessionInfo()` nevolá `getState()`: nevytváří relace, neposouvá idle
timer a nemění cache ani lifecycle časy. Čtení API nepřepisuje SQLite.
Vypnutí kontextu nevymazává projektové řádky a není přepínačem historie
konverzace. Další chatový tah dál uplatňuje stávající cache/restore policy.

Integrace `d1fa2991` spojuje dosavadní closeout s instalovaným `d4dea0bb`,
aby následná instalace zachovala současné modelové ovládání Studia.
Samotná privacy oprava nemění Studio, registry ani veřejné endpointy.

## Regresní důkaz

Před opravou nové kontroly selhaly na skutečně přítomném poli pracovní
paměti: in-process 10 PASS / 1 FAIL, skutečný HTTP 0 PASS / 1 FAIL.
Logy jsou zachované v `.intentsmith-artifacts/session-info-privacy-20260917/`.

Po opravě: `chat-memory-privacy` **11/11**, `chat-privacy-http` **1/1**,
`session-context` **66/66**, `chat-fixes` **58/58 PASS**. Nové kontroly
ověřují kladný stav, opt-out před dalším tahem, oba GET endpointy,
neexistující relaci, lifecycle časy, nezměněné DB řádky a opětovné zapnutí.
HTTP test zachovává i skutečné restarty a kontrolu odmítnutých vstupů.
Module boundary: **1 360 hran**, žádná přidaná ani odebraná.
Registr zůstává na 523 programech; nový testovací program nevzniká.

Nezávislé přijetí této opravy se nepředjímá. Běžící 24h soak je připnutý
na `d4dea0bb` a nepředstavuje ověření této nové změny. Historické instalace
se zbytkovým TLS párem zůstávají beze změn; podpisy M5/M6 a Gate 0 pečeť
tato oprava neuzavírá.
