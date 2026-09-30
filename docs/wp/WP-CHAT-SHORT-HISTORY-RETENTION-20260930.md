# WP — uchování krátké historie chatu před limitem handleru

**Stav původního přírůstku:** offline ověřený kandidát; následnou souběhovou
mezeru řeší integrovaný `WP-CHAT-CONTEXT-RETENTION-20260930` s omezeným
nezávislým `REVIEW_PASS`. Nový živý modelový průchod po této opravě `NOT RUN`.

**Autorita a vstup:** operátor 30. 9. 2026 výslovně požádal dokončit reálné testy chatu včetně auto-context čištění. Navazující bounded zadání opravuje pozorovanou mezeru po kandidátu `0c8533442437ae43ab91f9bd44bf5455ac3ba656`: deset krátkých syrových zpráv se vejde hluboko pod 75% tokenový práh, ale `ChatController` předává handleru nejvýše posledních deset. Při jedenácté zprávě by první dosud neshrnutá vypadla bez spuštění sumarizace.

**Uživatelský výsledek:** po páté krátké výměně se na hranici deseti dosud neshrnutých zpráv spustí asynchronní souhrn, dokud je celý jeho vstup ještě v uložené i handlerové historii. Starší obsah pak nese ukotvený summary turn v následném promptu. Tokenový trigger zůstává na 75 % efektivního modelového okna.

**Rozsah a vlastnictví:** pouze `src/chat/conversation-store.js`, `src/chat/context-compact.js`, `tests/context-compact-model-ctx.test.js` a tento WP na `work/intent-resilience-20260928`. Počet dosud neshrnutých zpráv se bere z trvalé DB podle `summary_up_to_msg_id`, nikoli z desetizprávového výřezu ani ze všech historických tokenů. Žádné změny provideru, registru testů, modelových vazeb, produkčního API, GPU procesu nebo cizích worktree.

**Politika a cena:** retenční důvod spouští sumarizaci při 10 dosud neshrnutých zprávách, pokud `keepTurns < 10` (výchozí hodnota je 6), i když tokeny nedosahují prahu. Retence obchází třicetisekundový cooldown, protože další rychlá výměna by mohla zprávu vyřadit. Při úspěšném souhrnu výchozí konfigurace archívuje čtyři zprávy a ponechá šest; v dlouhém krátkém chatu tedy může vzniknout přibližně jedno dodatečné modelové volání na dvě uživatelské výměny. Překryv běhů nad jednou konverzací dál blokuje `activeCompactions`. Neúspěšný modelový souhrn se při pokračujícím chatu může opakovat; náklady a latenci je nutné změřit živě.

**Pozitivní a negativní offline důkaz:** deterministický test v `context-compact-model-ctx.test.js` používá krátké tahy, přesný `num_ctx=4096`, práh 75 %, in-memory store a falešný provider. Ověří nulové volání při osmi zprávách, volání při deseti hluboko pod prahem, správný archivní cutoff a zachování prvního anchoru v souhrnu. Další čtyři zprávy ověří nové volání i během cooldownu a zachování předchozího souhrnu. Samostatná in-memory SQLite sonda ověří, že počet v DB vynechá archivované zprávy i jinou konverzaci. Příkaz: `/home/belphareon/.nvm/versions/node/v24.21.0/bin/node tests/context-compact-model-ctx.test.js`.

**Historická souběhová mez a navazující oprava:** sumarizace běží na pozadí.
Reprodukce původního commitu držela po desáté zprávě provider promise a
po jedenácté sestavila prompt před dokončením souhrnu; první stará zpráva v
něm chyběla, ačkoli zůstala v DB. `WP-CHAT-CONTEXT-RETENTION-20260930`
zavedl čekání na sdílenou sumarizaci před dalším ztrátovým snapshotem a
ověřil jej deterministicky. Živá přejímka nové opravy zůstává otevřená.

**Předání:** samostatné review navazující opravy prošlo v omezeném rozsahu;
skutečný modelový test 85 je další brána pro nové integrované SHA.
