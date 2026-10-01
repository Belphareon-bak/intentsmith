# WP — čtení druhého souboru z bezprostředního dialogu

**Autorita:** operátor požaduje skutečné ověření chatu, kontextu, práce s
projekty a platných výsledků. Rozsah této opravy je jediný návazný požadavek
„Přečti ten druhý soubor“ po uživatelem výslovně uspořádané dvojici názvů
souborů. Neřeší obecné rozpoznávání všech odkazů v přirozeném jazyce.

## Nález a červený důkaz

Živý pilot `pilot-4` na čistém `2477c8a2` uložil předchozí uživatelskou
zprávu s `alpha.md` a `beta.md` v tomto pořadí, ale následný skutečný M1 tah
vrátil neodůvodněný dotaz na upřesnění. Žádný `fs.read` návrh nevznikl.
Soukromý záznam je `.intentsmith-artifacts/chat-resilience/runs.json`;
výsledek celé čtyřpřípadové pilotní sondy je pouze
`LIVE_COMPLETE_UNASSESSED` na úrovni transportu, s věcným selháním této
referenční otázky.

Nový M1 HTTP/SQLite test na původním produktu nejprve selhal:
`project.collaboration` místo očekávaného `file.read`. Po první opravě
vytvořil správný návrh, avšak schválený obsah nebylo možné zobrazit:
produkční adaptér `ToolExecutor` měl `execute` a `settleEffect`, ale neměl
synchronní `resolveFileReadContent` ani `resolveFileListContent`. Skutečný
M1 test tak znovu zčervenal s `TOOL_EFFECT_AUTHORITY_UNAVAILABLE`.

## Oprava a hranice

Projektový handler vybere druhý soubor jen tehdy, když aktuální vstup je přesně
kladný pokyn přečíst/otevřít druhý soubor a bezprostředně předchozí
perzistentní dvojice obsahuje uživatelský výslovný seznam právě dvou různých
holých názvů v tomto pořadí. Nový požadavek stále vytvoří pouze M2 návrh;
čtení bajtů vyžaduje výslovné schválení přesného `effectId`. Chybějící
historie, tři názvy, kvalifikované cesty nebo rozporný výstup asistenta nechávají
referenci nevyřešenou. Tato úzká interpretace neodvozuje cestu z pouhého
seznamu na disku ani z dat cizího projektu.

Produkční M2 adaptér si po prvním asynchronním použití zapamatuje tentýž
autoritativní runtime. Synchronní resolvery čtení i výpisu odmítají použití,
dokud nebyl runtime načten; nikdy nečtou soubor druhou, neověřenou cestou.
Po schválení se obsah bere z perzistentního ověřeného M2 výstupu, vázaného na
projekt, konverzaci, žadatele a přesný digest.

Řízený M1 HTTP/SQLite průchod nyní ověřuje návrh `fs.read` pro `beta.md`,
absenci obsahu před schválením, odpověď s přesným soukromým obsahem až po
schválení, uložení odpovědi do historie a nulový modelový fallback. Stejná
konverzace ověřuje schválený `file.list`: zobrazí názvy a žádné bajty
souborů. Nová konverzace bez předchozího seznamu, seznam tří souborů a
seznam kvalifikovaných cest nesmějí vytvořit efekt. Zkouška používá vlastní
server, provider, SQLite a soukromé projektové adresáře; není fyzickou
modelovou přejímkou ani produkčním nasazením.

**Stav kandidáta:** řízený M1 HTTP/SQLite **2/2 PASS**; sousední M2 produkční
consumer **22/22**, M2 file consumer **39/39**, CRE file guard **9/9** a
projektový modelový kontrakt **1/1**. Nezávislé review, integrace, nový
živý pilot a finální 53případová sada dosud čekají.
