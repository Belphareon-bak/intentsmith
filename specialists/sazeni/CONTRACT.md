# Sázkař — kontrakt v3.2

Datum 2026-09-12. Autorita: operátor požaduje autonomní získávání informací,
vylučuje ručně dodané pravděpodobnosti a zachovává omezení času a kurzu.
Navazující pokyn požaduje top 5–10 podle odhadované úspěšnosti bez jejího
minimálního prahu. Tento dokument nahrazuje v2; ruční režim byl odstraněn.
Stav: **IMPLEMENTED_SLICE / REVIEW_PENDING**. Nejde o přijetí celého cílového
produktu. Navazující [WP](../../docs/wp/WP-SAZENI-PUBLIC-20260912.md)
autorizuje zkoušku z veřejných českých zdrojů bez placeného klíče; výchozí
zdroj je nyní Fortuna. Číselné kontrakty zůstávají verzí 3, resp. snapshot 2.

## 1. Veřejný vstup a význam výsledku

Uživatel dodává preference, nikoli vektor pravděpodobností, model, zdrojová
URL, hesla nebo příslib důvěryhodnosti. Podporované vstupy:

- text „do 24 h, kurz od 2 do 4“;
- text „Fortuna, do 3 dnů, rozestup max 12 h“;
- JSON `{"preferences": {...}}`, případně textové změny v další zprávě.

Uzavřený `preferences` kontrakt:

| Pole | Typ / význam / výchozí hodnota |
|---|---|
| `horizonHours` | celé 1–720, výchozí 24 |
| `maxSpreadHours` | celé 0–720, výchozí šířka okna |
| `minOdds`, `maxOdds` | desetinné stringy, celý tiket, `1.5` a `3` |
| `minProbability` | nepovinný práh 0–1 pro celý tiket; výchozí 0, tedy bez minimální úspěšnosti |
| `leagues` | neprázdný výběr `E0/D1/I1/SP1/F1`, výchozí všech pět |
| `dataSource` | `public_web` (výchozí), `reference`, `odds_io` |
| `bookmakerIds` | výchozí `iFortuna CZ`; pouze kanceláře zvoleného zdroje |
| `minLegs`, `maxLegs` | celé 1–8, výchozí 1 a 3 |
| `ticketCount` | celé 1–10, výchozí 5; CLI `--top 10` vyžádá deset |
| `maxSharedEvents` | celé 0–8, výchozí 8; alternativy mohou sdílet zápasy, 0 vyžádá nesdílené návrhy |
| `objective` | `highest_probability` nebo `highest_expected_value`; výchozí první |
| `minLegProbability` | nepovinné číslo 0–1 |
| `stake` | `{currency:'CZK',perTicketMinor,totalBudgetMinor}`, celé haléře |

Výchozí pořadí je sestupné podle odhadu úspěšnosti celého tiketu. Čas a kurz
zůstávají tvrdými omezeními, nulový práh neznamená automatické zmírnění jiných
podmínek. Návrhy jsou alternativy; společný zápas mezi nimi není důvod k
vyřazení lépe hodnocené varianty. Uvnitř jednoho tiketu zůstávají omezení
duplicit a známých závislostí. Neúplné hledání má nadále SEARCH_LIMIT_REACHED
a nesmí tvrdit, že našlo skutečné top pořadí celé nabídky.

Referenční kanceláře: `bet365-reference`, `betfred-reference`, `bwin-reference`,
`paddypower-reference`; výchozí první při `dataSource:reference`. Samotný výběr
referenčních kanceláří také zvolí referenci. `public_web` podporuje jen
`iFortuna CZ`; Tipsport při veřejné sondě vrátil 403. `odds_io` se musí zvolit
explicitně a podporuje `Tipsport.cz`, `Chance.cz`, `iFortuna CZ`, `Betano CZ`.
Nedostupný zdroj se automaticky nenahradí. Neznámá pole, vlastní `probabilities`, vektor p ve
snapshotu nebo tvrzení `trusted*` se odmítnou. Text nerozumí libovolnému jazyku:
„dnes/zítra/víkend“ žádá upřesnění. Nepodporované sporty a in-play se neprovedou.

Host ukotví relativní okno v čase přijetí úlohy. 3 dny jsou 72 uplynulých hodin
i přes DST. Všechny **začátky** musejí ležet v uzavřeném okně, navíc alespoň
5 minut po čase hodnocení nabídky. Rozestup posledního a prvního začátku je
samostatná tvrdá mez. Nejde o deadline dohrání/vypořádání. Kancelář, ligy,
čas ani minimální úspěšnost se nerozšiřují automaticky.

## 2. Vnitřní číselné kontrakty

`autonomousRequest()` vytvoří uzavřený `BettingRequest@3`. Vnitřní solver
ponechává kompatibilní validaci `BettingRequest@2` pro syntetický replay, ale
`user_estimate` již není platný. Zachovává pole `requestId`, sport, soutěže,
`window`, kanceláře, `ticketType`, `legOdds`, `ticketOdds`, `legs`,
`probabilityFilter`, cíl, různost, výluky, `dataMode` a případný peněžní limit.
Volitelný `dataSource` vybírá výše popsanou autonomní datovou cestu.
Úplnou strojovou autoritou jsou [validátory](engine/contract.js).

`BettingSnapshot@2` je uzavřená normalizovaná nabídka s identitou zdroje,
časem, pokrytím, událostmi, účastníky a úplnými 1X2 trhy. `dataMode` je
`observed/delayed/live/imported/historical`. `sourceUpdatedAt:null` znamená neznámý čas
pořízení kurzu; nikdy se nenahradí časem stažení. `observedAt` je čas získání
konkrétního snímku. Průměrné/maximální kurzy více kanceláří nejsou jedna nabídka.

Hostem vygenerovaná predikce obsahuje `basis:'model'`, normalizované
`probabilities:{home,draw,away}`, metodu, čas a `modelRef`. Interní `basis:model`
znamená výstup výpočetní politiky, nikoli automaticky predikci z výsledků:
aktuální přijatá **implementační volba** je tržní referenční metoda.
Solver ji přijme pouze s odpovídajícím `trustedModelDigest` předaným kódem
hostované autonomní cesty. Vstupní JSON takovou autoritu nezíská. Živé kurzy
navíc vyžadují `trustedLiveDigest` stejného snapshotu; veřejná pozorovaná nabídka
vyžaduje `trustedObservedDigest`. Import nemůže tvrdit ani jednu autoritu.
Změna jediného pole
zruší původní otisk. Tato interní atestace nepotvrzuje výhodnost sázky.

## 3. Autonomní datová cesta a authority

Balíček nesmí importovat `src/**` ani provádět síťové/FS/DB efekty.
`ExtensionManifest/Context@1` deklaruje novou volitelnou capability
`sports.football-data.v1`; existující `specialist.runtime.v1` zůstává povinná.
Core loader předá runtime její spárovaný host. `needsBettingData` je opt-in
nástroje, spuštěný pouze pro přesné `sazeni` a jedno ze čtyř registrovaných ID.

Core otevírá opaque invocation token pro přesnou konverzaci a uloženou
uživatelskou zprávu. Standalone CLI jej otevírá jako explicitní operátorskou
invokaci. `turn.bettingData` obsahuje pouze `get`, `save`, `liveConfigured`.
Nevystavuje API klíč, transport, SQL, cestu ani obecný webový fetch. Token zaniká
v `finally`; po uložení výsledku je spotřebovaný. Cizí extension, zrušený či
ukončený token neprovede přenos. Discovery specialisty samo nic nestahuje.

Uzavřené dotazy capability:

- `{kind:'fixtures'}`: pevná veřejná CSV nabídka;
- `{kind:'history',league,season}`: nejvýše aktuální a čtyři předchozí sezony;
- `{kind:'fortuna_public',leagues,from,to}`: veřejná Fortuna bez účtu/klíče;
- `{kind:'live',leagues,bookmakers,from,to}`: konkrétní nabídka z Odds-API.io;
- `save(BettingAnalysisEvidence@1)`: jediný výsledek vlastního běhu.
- `save(BettingWatchEvidence@1)`: pozorování vlastního hlídacího běhu, stejná
  vazba na hostovou invokaci a zdrojové observation ID; bez ručních predikcí.

Síťové efekty používají společný `createOutboundPolicy` a přesný M5 outbound
schema/audit writer v izolované DB sázkaře. Nová surface `betting-data`, scopes
`sports.football.read`, `sports.fortuna.public.read` a `sports.odds.read` jsou
omezené na GET, pevné HTTPS originy, cesty, hlavičky a uzavřené parametry.
Football-Data dovoluje kanonický
redirect www↔non-www. Jiný origin/cesta, lokální redirect, POST a dodatečné
parametry jsou odmítnuty. Rozšíření se nepovažuje za nezávisle přijatý M5 konektor.
Autoritou ke konkrétnímu čtení je operátorem vyžádaná autonomní úloha sázkaře.

Limity: 120 s na invokaci, 32 capability get volání, 64 HTTP požadavků,
15 s na jednotlivý přenos, 4 MB na odpověď, 16 MB na invokaci. Veřejné HTTP
požadavky jsou serializované s minimálním odstupem 750 ms. Cache Football-Data
referenční nabídky 1 h a historie 24 h zachovává původní čas pozorování.
Chyba/429 nevytváří retry bouři ani falešně čerstvou cache. Fortuna i Odds-API.io
se pro každý aktuální výpočet načítají znovu. Žádné vytvoření účtu, předplatné
nebo podání sázky není součást capability.

## 4. Zdroje a časová kvalita

Fortuna: veřejný JSON kanál anonymního webu `https://api.ifortuna.cz/offer/`.
Pouze pevné cesty `structure/api/v1_0/tournament/{id}/matches?timeFilter=all`
pro pět známých lig a `markets/api/v1_0/fixtures/markets/overview` s nejvýše
deseti unikátními `fixtureIds`. Žádné cookies, klíč, obecné URL či prohlížeč
v runtime. Nejvýše 100 vybraných událostí; větší rozsah se explicitně odmítne.
Po cenách se znovu čte seznam a ověří identita, účastníci, stav a termín.

Pouze předzápasové otevřené 1X2 v základní hrací době: typ `ufo:mtyp:00-00`,
žádné specifiers, STANDARD, prázdné tournamentStageIds a přesné znění pravidla.
Domácí/remíza/hosté se mapují podle `optionTypeId` a ověří proti názvu týmu,
nikoli podle pořadí v JSON. Chybné schéma selže; pozastavený trh se nevydá.
HTTP Date a případné Age musí potvrdit čerstvou odpověď do 120 s; to **není**
čas změny kurzu. `sourceUpdatedAt` zůstává null. `observed` vyžaduje pozorování
nejvýše 120 s staré, rozestup pozorování nejvýše 120 s a kontrolu vypršení po
hledání. `verifiedObservation:true` neznamená `verifiedLive:true` ani přijetí
sázky. Report ukáže čas načtení, obnovu a odkazy na veřejnou nabídku.

Football-Data CSV: skutečná veřejná data, pět lig, britský čas převedený přes
`Europe/London`; nejednoznačná/neexistující DST hodina se odmítne. Chybějící čas
budoucího zápasu se neodhaduje. U staré historie bez času se používá poledne s
příznakem `timePrecision:'date'`, jen pro modelování s konzervativním zpožděním.
Aktuální soubor musí mít použitelný Last-Modified a nesmí být starší než 4 dny.
Ani mladý soubor neprokazuje aktuální cenu. Pinnacle, Max/Avg a burzovní kurzy
se v této cestě nepoužívají. Soubor je referenční, ne ověřená česká nabídka.

Odds-API.io: katalog, stránkované události a dávky nejvýše 10 událostí pro kurzy.
Katalog musí potvrdit aktivní vybrané kanceláře. Překročení stránkování, jiné
liga/sport, duplicitní ID či změna účastníků/času/statusu mezi odpověďmi vrací
chybu. API key má pouze host a nikdy se neukládá v URL ani nevstupuje do reportu.
Přenos je auditován přes origin a digest URL; reflexe klíče v těle je odmítnuta.

Přijímá se pouze `Moneyline` s jedinou trojicí home/draw/away bez handicapu,
před začátkem utkání. Všechny položky musí být čerstvé nejvýše 120 s podle
aktualizace zdroje i pozorování; konečné vypršení se ověří také po hledání.
Čas hodnocení se může od kotvy zadání lišit nejvýše 120 s; posun nepřepíše
uživatelem vymezené časové okno. Dostupnost na účtu a detaily skutečného
vypořádání kanceláře zůstávají mimo ověřený rozsah.

## 5. Model, volba metody a přijímací hranice

`FootballModel@1`: metoda a hyperparametry, `asOf`, `trainedThrough`, přesný
hash tréninku, počet/effective počet řádků, týmová mapa, parametry, doložená
konvergence a `modelId`. Čistý JS řešič trénuje regularizovaný Dixon–Coles;
počítá gradient, omezuje velikost a přijme jen konvergované konečné parametry.
Skórová matice má kontrolovanou zbytkovou hmotu a validní low-score korekci.

Pouze zápasy starší než 48 h a data dostupná před `asOf`; pokud existuje
`availableAt`, platí také tato mez. Historické CSV nemá původní observační
časy: 48h pravidlo je konzervativní předpoklad, ne důkaz dostupnosti tehdy.
Trénink používá posledních 1 461 dní, recency half-life 365 dní a ridge .005.
Nové/neznámé týmy nebo méně než deset zápasů za poslední dva roky jsou vynechány.
Týmy Fortuny i API se spojují jen přes jedinečné normalizované jméno a verzované aliasy;
žádné fuzzy sloučení. Tato konzervativní podmínka omezuje i tržní návrhy.

Chronologický benchmark: train rolling, výběr 2021–2023, kalibrace 2023–2024,
uzamčený test 2024–2026; 7 Poisson/DC variant, tržní proporcionalita/power,
logaritmická kombinace a teplota. Samostatný průzkumný experiment porovnal
Elo/formu/střely v logistické regresi a boosted trees. Nezávislý numerický
řešič ověřil JS optimum. [Výsledky a metodické limity](../../docs/research/2026-09-12-AUTONOMOUS-BETTING.md).

Na datech nevznikl důkaz lepší predikce proti trhu. `FORECAST_POLICY` tedy
ponechává tržní proporcionalitu; strukturální model je diagnostický.
Tato výpočetní politika nebyla nezávisle přijata ani kalibrována na české
kanceláři. Nemá se prezentovat jako nejlepší možný nebo profitabilní model.
`lower_bound` vrací `MODEL_UNAVAILABLE`; interval přesnosti průměrné metriky
není dolní mez pravděpodobnosti konkrétního tiketu.

## 6. Solver a předání výsledku

`BettingResult@3` obsahuje stav, ID běhu, efektivní preference, typ a pokrytí dat,
search budget/completeness, tikety, zamítnuté kandidáty, chyby, varování, důkazy,
`analysis` a případnou potvrzenou persistenci. Každý tip má zdroj, časy, kurz,
metodu p a identitu trhu. Tiket má součin kurzů, bodový odhad, časový rozestup,
kontrolu splnění limitů, případné peníze a konec platnosti. Závislost má explicitní
předpoklad nezávislosti a Fréchetovy meze; nejde o statistický interval jistoty.

Solver vylučuje společnou událost/tým/známou dependency, rozdílné kanceláře,
regiony či settlement pravidla. Hledá nejvýše 200 000 stavů nad 200 kandidáty
a nejvýše 10 s. Zbytek rozpočtu sdílejí přepočtené alternativy. Přesné kurzy
jsou racionální BigInt; peníze jsou celé haléře s označeným odhadem výplaty.
`within_snapshot` znamená pořadí jednotlivých tiketů v dodané nabídce; následný
výběr různých tiketů není globální optimalizace portfolia.

`READY` pouze znamená návrhy splňující bodové limity v daném snapshotu.
`NO_SOLUTION` předpokládá kompletní prohledání a pokrytí; při dírách je
`INSUFFICIENT_DATA`. Další stavy: `NEEDS_INPUT`, `INVALID_REQUEST`,
`MODEL_UNAVAILABLE`, `SEARCH_LIMIT_REACHED`, `CANCELLED`, `PROVIDER_ERROR`,
`PERSISTENCE_ERROR`, `INTERNAL_ERROR`. Neúspěch nevytváří fallback LLM tipy.

Core vlastní oddělenou SQLite DB pod `.intentsmith-artifacts/betting/`.
Uchovává obsah podle SHA-256, každé pozorování zvlášť, modely, nabídku, preference
a výsledek v jedné evidenci běhu. Při chybě save se tikety nezveřejní jako READY.
CLI exportuje soukromé soubory bez přepsání existující cesty. Chat vrátí stejná
čísla deterministickým rendererem; test kontroluje skutečný serializovaný
handler výstup. Povolený je přímý výstup uživateli v jeho úloze, nikoli samostatné
zprávy třetím osobám nebo plánované notifikace.

## 7. Stav přijetí a zbývající cílový produkt

Implementováno a lokálně ověřeno: autonomní veřejná cesta, model, benchmark,
preference, solver, chat, export, scoped datový host, persistence a negativní
případy. Veřejná Fortuna má skutečný běh s načtenými cenami a tikety:
[evidence](../../docs/review/2026-09-12-SAZENI-PUBLIC.md).
Tipsport při veřejné sondě vrátil 403. Samostatný agregátor Odds-API.io má
deterministické testy a ověřený katalog, ale jeho ceny zůstávají
**LIVE_VALIDATION_BLOCKED — chybí API klíč**. Tento blok se nevztahuje na
ověřenou veřejnou cestu Fortuny. Ve sdílené aplikaci se nic neaktivovalo.
Nezávislé review: **REVIEW_PENDING**.

Další nutné důkazy pro kvalitní provoz: opakované měření dostupnosti zdroje,
prospektivní as-of sběr, vyhodnocení kalibrace po ligách/horizontech a v pásmech
výběru, celé tikety včetně závislostí, skutečné settlement podmínky, datové licence
pro konkrétní použití. Teprve poté případná změna predikční politiky.

Samostatné lokální plánování a mailová capability jsou popsány v §8; přímé
e-mailové doručení dosud nebylo provozně ověřeno. Cílové rozšíření, aktuálně neimplementované: xG, zranění a sestavy s doloženým
časem publikace; historie výsledků/settlement a přesné refund/void případy;
integrace plánování a doručování do aplikace; formulář ve Studiu;
portfolio risk a závislostní model; další sporty a trhy. Žádná z těchto položek
není nahrazena textem LLM nebo prohlášením „všechny informace prozkoumány“.

## 8. Standalone CLI a průběžný hlídač

Autorita: operátor výslovně požaduje CLI/aliasy, samostatný pravidelný sběr
a upozornění e-mailem. `bin/sazkar.js` je hostový operátorský vstup, nikoli
nová obcházka CRE pro příchozí chat. Launcher `~/.local/bin/sazkar` a aliasy
spouštějí konkrétní checkout. Produktový balíček má pouze čistou analytiku
`engine/opportunities.js`; nemá přímý přístup k síti, DB, SMTP nebo systemd.

`BettingWatchPreferences@1`: horizonHours 1–168, pět podporovaných lig,
minOdds/maxOdds pro jednotlivý tip (>1 až 100), minProbability 0–1,
minImprovement 0,01–1, intervalMinutes 5–120, maxAlertsPerDay 1–20.
Výchozí hodnoty jsou 72 h, 1,5–3, 0,4, 0,05, 15 min, 4 pokusy za 24 h.
Neznámá pole jsou neplatná. Jde o signály jednotlivých cen, nikoli filtr
společné pravděpodobnosti akumulátoru.

`BettingWatchSignal@1`: stabilní identita zápasu/trhu/výsledku, stará a nová
cena s pozorovacími časy, firstSeenAt, openingAt:null, hoursToKickoff,
důvod, vypršení; `valueStatus:UNVERIFIED` a `expectedValue:null`.
`NEWLY_OBSERVED` vyžaduje předchozí úspěšný sběr stejného scope do 2,5násobku
intervalu a předchozí pokrytí času začátku. První běh, vstup do posunutého
okna, přeložení nebo dlouhá mezera nejsou doklad nového vypsání.
`PRICE_IMPROVED` vyžaduje zvýšení ceny nad mez proti blízkému otevřenému
pozorování. Opakování stejného tipu má šestihodinový cooldown a musí překonat
i poslední oznámenou cenu. Součet inverzních cen mimo 1–1,3 se pro tyto běžné
signály vyřazuje; arbitrage/boosted nabídky nejsou tímto pravidlem modelovány.

Core uchovává surové snímky a hostovou evidenci, dále odvozenou časovou řadu,
stav sběrů a doručovací frontu. Běh hlídače chrání obnovitelný lease;
první vytvoření DB/tabulek používá transakční zámek. Selhání sítě nezaloží
úspěšný baseline. Při zdrojové chybě platí původní fail-closed pravidla.
Zdroj se každým během znovu čte, ale diagnostický DC model se znovu netrénuje.

SMTP je samostatná omezená hostová capability. Používá uživatelem lokálně
nastavený server, port 465/587 s vynuceným TLS a ověřením certifikátu,
jednoho příjemce a pevný renderer; žádné přílohy, obecné textové zprávy,
LLM-generované směrování, cookies nebo automatické čtení C3 SMTP prostředí.
Audit používá přesný stávající M5 writer/schema, surface `betting-notifications`,
scopes `sports.betting.email.notify` a `sports.betting.email.test`, method SMTP.
Secret není v auditu; identita příjemce/nastavení je hashovaná. Tato capability
není nezávisle přijatým M5 konektorem.

Bez konfigurace zůstávají signály lokální. Zapnutí timeru ani změna zdrojových
cen nevyplňuje příjemce. Před doručením se znovu načte aktuální opt-in a
konfigurace; vazba fronty zahrnuje příjemce, SMTP i preference. Prošlé a cizímu
nastavení odpovídající zprávy se nevydají. Nejvýše jedna zpráva při odečtu,
podle největšího cenového zlepšení a pak tržního odhadu, s denním limitem.
To není ranking podle prokázaného EV.

Claim ve frontě je transakční. Pád či nejasný SMTP výsledek po zahájení přenosu
vede na `unknown` bez automatického opakování. `sent` znamená přijetí SMTP
serverem, nikoli prokázané doručení do schránky. Přímý `mail test` je explicitně
vyžádaný test bez sázkového signálu; nevyžaduje zapnuté pozadí.

Vlastní user timer je opt-in, trvale vypnutelný a nezasahuje jiné jednotky.
Při spánku PC neprobíhá sběr ani dohánění starých mailů. Lokální stav je pod
`~/.local/state/sazkar`, soukromá konfigurace pod `~/.config/sazkar`; oba
adresáře 700, data a tajemství 600. Limit DB 512 MiB zastaví další sběr místo
neomezeného růstu. [Výzkum a další přijímací důkazy](../../docs/research/SAZKAR-MARKET-TIMING.md).
