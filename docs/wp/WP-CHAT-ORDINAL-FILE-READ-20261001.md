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
perzistentní dvojice obsahuje celou kladnou uživatelskou větu s výslovným
seznamem právě dvou různých holých názvů v tomto pořadí. Volný výskyt seznamu
uvnitř příkladu, opravy nebo negace oprávnění k četbě nevytváří. Nový
požadavek stále vytvoří pouze M2 návrh;
čtení bajtů vyžaduje výslovné schválení přesného `effectId`. Chybějící
historie, tři názvy, kvalifikované cesty nebo rozporný výstup asistenta nechávají
referenci nevyřešenou. Tato úzká interpretace neodvozuje cestu z pouhého
seznamu na disku ani z dat cizího projektu.

První nezávislé review `6c39132e` bylo **CHANGES_REQUIRED**: skutečný M1
průchod přijal větu „To byl jen neplatný příklad: soubory alpha.md a beta.md
v tomto pořadí vůbec nejsou můj seznam.“ jako autoritativní seznam a založil
`fs.read`. Nová M1 regrese pro zneplatněný příklad nejprve prokázala chybu;
vedle ní byla přidána negativní regrese pro citovaný příklad. Opravený resolver nyní vyžaduje shodu celé předchozí věty,
nikoli její části; opakovaný M1/SQLite průchod prochází. Následovalo druhé
nezávislé review s další negativní mutací níže.

Druhé nezávislé review `f74596f2` opět skončilo **CHANGES_REQUIRED**.
Podporované přeřazení konverzace z projektu A do projektu B přeneslo starý
seznam A do nového kontextu B; `Přečti ten druhý soubor` vytvořilo `fs.read`
pro B/beta.md a po schválení vrátilo skutečné soukromé bajty B. Přesná
recenzentova M1/SQLite mutace je součástí testu a před opravou selhala.
Každý nově uložený uživatelský tah teď nese ID projektu z trvalého záznamu
konverzace v okamžiku zápisu. Resolver smí použít předchozí tah pouze při
shodě tohoto ID s nynějším projektem; starší tah bez doloženého ID selže
uzavřeně. Čtyři skutečné M1 testy včetně negativních mutací po opravě
procházejí **4/4**, session-context **66/66**. Další nezávislé review čeká.

Třetí revize `df012e18` našla další významovou únikovou cestu: resolver
sice nespojil starý seznam A s novým projektem B, ale po návratu do CRE
mohl klasifikační model navrhnout `FILE_READ beta.md` pro stejný nevyřešený
odkaz. Jeho cílová cesta se totiž nemusela objevit v aktuální větě. Proto
projektový handler rozpoznaný, ale neprokázaný odkaz ukončí cílenou otázkou
ještě před CRE a nevytvoří žádný efekt. M1/SQLite test pro přeřazení
konverzace i další nevyřešené odkazy nyní vyžaduje veřejné
`file_reference_unresolved`; řízený průchod zůstává **4/4 PASS**.
Opakovaná nezávislá kontrola této změny dosud neproběhla.

Stejná revize poukázala na druhou cestu ke starému antecedentu. SQL pro
posledních deset zpráv řadilo podle `created_at`, které má přesnost pouze
na sekundu. Při dvanácti zprávách se shodným časem staré SQL v izolované
SQLite vrátilo ID 1–10 místo novějších 3–12. Nový registrovaný databázový
test byl proto nejprve **FAIL**. Produkční čtení zpráv nyní řadí podle
trvalého autoincrement ID; stejný test prochází **1/1** a pořadí platí i
při shodném timestampu. Negativní M1/SQLite scénář s dvanácti tahy a
starým seznamem v historii nepřipraví žádný `fs.read`. Pro tento souhrnný
kandidát zbývá nezávislé review, integrace a opakovaný živý pilot.

Čtvrté nezávislé review `6ba07ef5` skončilo **CHANGES_REQUIRED**: věta
„Otevři ten druhý soubor, první je alpha.md“ obsahovala jiný pojmenovaný
soubor. Stráž nevyřešeného odkazu se kvůli němu vypnula a CRE mohlo samo
navrhnout čtení `beta.md` v jiném projektu. Totéž platilo pro záporné
„Neotevři…“. Stráž nyní zachytí každý výskyt „druhý soubor“, který neprošel
přesným kladným resolverem, bez ohledu na další názvy ve větě. Reálné M1
regrese obou smíšených vět po změně procházejí; nový kandidát čeká na
opětovné nezávislé review.

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

**Stav kandidáta:** řízený M1 HTTP/SQLite **5/5 PASS**; sousední M2 produkční
consumer **22/22**, M2 file consumer **39/39**, CRE file guard **9/9** a
projektový modelový kontrakt **1/1**. Nezávislé review, integrace, nový
živý pilot a finální 53případová sada dosud čekají.
