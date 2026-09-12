# Sázkař — kontrakt v3

Datum 2026-09-12. Autorita: operátor požaduje autonomní získávání informací,
vylučuje ručně dodané pravděpodobnosti a zachovává omezení času, kurzu a
teoretické úspěšnosti. Tento dokument nahrazuje v2; ruční režim byl odstraněn.
Stav: **IMPLEMENTED_SLICE / REVIEW_PENDING**. Nejde o přijetí celého cílového
produktu. [WP](../../docs/wp/WP-SAZENI-AUTONOMOUS-20260912.md).

## 1. Veřejný vstup a význam výsledku

Uživatel dodává preference, nikoli vektor pravděpodobností, model, zdrojová
URL, hesla nebo příslib důvěryhodnosti. Podporované vstupy:

- text „do 24 h, kurz od 1.5 do 3, úspěšnost alespoň 40 %“;
- text „Tipsport, do 3 dnů, rozestup max 12 h“;
- JSON `{"preferences": {...}}`, případně textové změny v další zprávě.

Uzavřený `preferences` kontrakt:

| Pole | Typ / význam / výchozí hodnota |
|---|---|
| `horizonHours` | celé 1–720, výchozí 24 |
| `maxSpreadHours` | celé 0–720, výchozí šířka okna |
| `minOdds`, `maxOdds` | desetinné stringy, celý tiket, `1.5` a `3` |
| `minProbability` | číslo 0–1, teoretický bodový odhad celého tiketu, 0.4 |
| `leagues` | neprázdný výběr `E0/D1/I1/SP1/F1`, výchozí všech pět |
| `bookmakerIds` | referenční nebo české API kanceláře; režimy se nemíchají |
| `minLegs`, `maxLegs` | celé 1–8, výchozí 1 a 3 |
| `ticketCount` | celé 1–10, výchozí 3 |
| `objective` | `highest_probability` nebo `highest_expected_value`; výchozí první |
| `minLegProbability` | nepovinné číslo 0–1 |
| `stake` | `{currency:'CZK',perTicketMinor,totalBudgetMinor}`, celé haléře |

Referenční kanceláře: `bet365-reference`, `betfred-reference`, `bwin-reference`,
`paddypower-reference`; výchozí první. České API: `Tipsport.cz`, `Chance.cz`,
`iFortuna CZ`, `Betano CZ`. Neznámá pole, vlastní `probabilities`, vektor p ve
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
Úplnou strojovou autoritou jsou [validátory](engine/contract.js).

`BettingSnapshot@2` je uzavřená normalizovaná nabídka s identitou zdroje,
časem, pokrytím, událostmi, účastníky a úplnými 1X2 trhy. `dataMode` je
`delayed/live/imported/historical`. `sourceUpdatedAt:null` znamená neznámý čas
pořízení kurzu; nikdy se nenahradí časem stažení. `observedAt` je čas získání
konkrétního snímku. Průměrné/maximální kurzy více kanceláří nejsou jedna nabídka.

Hostem vygenerovaná predikce obsahuje `basis:'model'`, normalizované
`probabilities:{home,draw,away}`, metodu, čas a `modelRef`. Interní `basis:model`
znamená výstup výpočetní politiky, nikoli automaticky predikci z výsledků:
aktuální přijatá **implementační volba** je tržní referenční metoda.
Solver ji přijme pouze s odpovídajícím `trustedModelDigest` předaným kódem
hostované autonomní cesty. Vstupní JSON takovou autoritu nezíská. Živé kurzy
navíc vyžadují `trustedLiveDigest` stejného snapshotu. Změna jediného pole
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
- `{kind:'live',leagues,bookmakers,from,to}`: konkrétní nabídka z Odds-API.io;
- `save(BettingAnalysisEvidence@1)`: jediný výsledek vlastního běhu.

Síťové efekty používají společný `createOutboundPolicy` a přesný M5 outbound
schema/audit writer v izolované DB sázkaře. Nová surface `betting-data`, scopes
`sports.football.read` a `sports.odds.read` jsou omezené na GET, pevné HTTPS
originy, cesty, hlavičky a uzavřené parametry. Veřejná data dovolují kanonický
redirect www↔non-www. Jiný origin/cesta, lokální redirect, POST a dodatečné
parametry jsou odmítnuty. Rozšíření se nepovažuje za nezávisle přijatý M5 konektor.
Autoritou ke konkrétnímu čtení je operátorem vyžádaná autonomní úloha sázkaře.

Limity: 120 s na invokaci, 32 capability get volání, 64 HTTP požadavků,
15 s na jednotlivý přenos, 4 MB na odpověď, 16 MB na invokaci. Veřejné HTTP
požadavky jsou serializované s minimálním odstupem 750 ms. Cache veřejné nabídky
1 h a historie 24 h zachovává původní čas pozorování. Chyba/429 nevytváří retry
bouři ani falešně čerstvou cache. API snímky se pro aktuální analýzu načítají
znovu. Žádné vytvoření účtu, předplatné nebo podání sázky není součást capability.

## 4. Zdroje a časová kvalita

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
API týmy se spojují jen přes jedinečné normalizované jméno a verzované aliasy;
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
případy. API konektor má deterministické testy a ověřený veřejný katalog;
**LIVE_VALIDATION_BLOCKED — chybí API klíč**. Ve sdílené aplikaci se nic
neaktivovalo. Nezávislé review: **REVIEW_PENDING**.

Další nutné důkazy pro kvalitní provoz: živá sonda vybraných kanceláří,
prospektivní as-of sběr, vyhodnocení kalibrace po ligách/horizontech a v pásmech
výběru, celé tikety včetně závislostí, skutečné settlement podmínky, datové licence
pro konkrétní použití. Teprve poté případná změna predikční politiky.

Cílové rozšíření, aktuálně neimplementované: xG, zranění a sestavy s doloženým
časem publikace; historie výsledků/settlement a přesné refund/void případy;
trvalé plánované úlohy a explicitně nastavené doručování; formulář ve Studiu;
portfolio risk a závislostní model; další sporty a trhy. Žádná z těchto položek
není nahrazena textem LLM nebo prohlášením „všechny informace prozkoumány“.
