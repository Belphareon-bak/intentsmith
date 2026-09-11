# Sázkař 2.0 — implementační prototyp

Výpočetní engine pro předzápasový fotbal 1X2. Sestavuje singly/akumulátory ze
zadané nabídky a splňuje meze kurzu, počtu položek, pravděpodobnosti, času a
rozpočtu. Stav integrace: **IMPLEMENTED_SLICE / REVIEW_PENDING**, nikoli živá
služba či přijatý celý kontrakt.

## Vyzkoušení

Z kořene tohoto checkoutu, s novým výstupním adresářem:

```bash
node bin/sazeni.js tests/fixtures/betting/envelope.json /tmp/sazkar-demo-1 --now 2026-09-11T12:00:00.000Z
```

Demo je syntetické: obsahuje zápasy za 2, 4, 8, 24, 48, 72, 168 a 720 hodin.
Vzniknou `input.json`, `result.json`, `tickets.md`, `tickets.csv`. Pevný čas je
jen reprodukce dodané nabídky. Bez `--now` bere CLI skutečný čas. Staré zápasy
proto v režimu `imported` později nevybere. Existující adresář nepřepisuje.

V chatu zapni specialistu `sazeni` z tohoto balíčku, přilož JSON envelope nebo
ho vlož jako JSON blok. Zadej například:

> Sestav tiket do 24 h, kurz od 3 do 4, úspěšnost alespoň 20 %, rozestup max 8 h.

Následné „do 3 dnů“ v téže relaci přepočítá časové okno. JSON poskytuje ligy,
kanceláře, limity položek a metodu pravděpodobnosti; z pouhých názvů týmů engine
nenajde živé kurzy. Parametry si chat pamatuje 30 minut v procesu. Nový JSON
resetuje předchozí textové úpravy. „Dnes/zítra/víkend“ se zatím vyjasňují, místo
aby se tiše odhadla hranice. Pro zadání s přílohou používej „sestav tiket“;
obecné „analyzuj soubor“ zachytává stávající host FILE_EXPLAIN před specialistou.

## Čas a čísla

`window: {timezone: "Europe/Prague", horizonHours: 24, maxSpreadHours: 8}`
znamená všechny začátky v následujících 24 h a nejvýše 8 h mezi prvním a posledním
zápasem každého tiketu. `horizonHours: 72` jsou 3 × 24 h i přes změnu letního času.
Alternativně lze zadat `from` a `to` v UTC; relativní a absolutní okno se nemíchají.
Rozsah je nejvýše 30 dnů. Hraniční čas je včetně; v importu/živém režimu musí do
začátku zbývat alespoň 5 minut. Tato okna omezují **začátky**, negarantují konec
zápasu ani vypořádání do jejich horní hranice.

Kurzy jsou desetinné řetězce. Peníze jsou celé haléře; součin kurzů a výplata se
počítají přes racionální BigInt, výplata je odhad zaokrouhlený na haléře. Filtr
pravděpodobnosti používá číslo 0–1. Součin odhadů předpokládá nezávislost; report
ukazuje také meze při neznámé závislosti. Stejný zápas, společný tým či explicitní
závislost se nekombinují; každému tiketu patří jedna kancelář, region a pravidlo
vypořádání. Mezi tikety lze omezit počet společných událostí.

`market` normalizuje převrácené kurzy celého 1X2 trhu dané kanceláře.
`user_estimate` používá explicitně dodaný vektor p se součtem 1. Ani jeden není
kalibrovaná predikce. `model` a `lower_bound` vrátí `MODEL_UNAVAILABLE`, dokud
není přijatý modelový artefakt. Automatický fallback metodu nemění.

## Data, výstup a hranice

Validátory: [engine/contract.js](engine/contract.js). Kompletní příklad:
[envelope.json](../../tests/fixtures/betting/envelope.json). Čistý adaptér
[providers/odds-api-import.js](providers/odds-api-import.js) převede lokálně
dodaný The Odds API v4 JSON. Vyžaduje konfiguraci regionu a settlement pravidla
kanceláře; chybějící nebo neúplný trh odmítá. Nemá síť ani credentials a výsledek
zůstává `imported` s neúplným pokrytím.

V chatu se předá vypočtený `BettingResult` a deterministický Markdown bez LLM
přepisování čísel. CLI export dovoluje soukromou reprodukci. Search prochází
nejvýše 200 kandidátů, 200 000 stavů a 10 sekund v hostu. Přepočtené alternativy
sdílejí zbývající rozpočet, jsou oddělené od platných tiketů a vyžadují změnu zadání.
`SEARCH_LIMIT_REACHED` se nevydává za neexistenci řešení. `within_snapshot`
znamená úplné pořadí jednotlivých tiketů v dodaném snapshotu, ne společné optimum
portfolia; různost a peněžní rozpočet se aplikují následným postupným výběrem.

Živý datový host, DB historie/settlement, kalibrovaný model, formulář ve Studiu
a automatické doručování ještě nejsou implementované. Původní pomocné
kalkulačky/scénář zůstaly v balíčku jako legacy zdroje, ale registrace a manifest
vedou na nový engine. Čtyři staré veřejné tool ID zůstávají registrované;
přímé CRE volání bez hostového času vrátí NEEDS_INPUT. Sázky se nepodávají.

Testy: `node tests/sazeni-engine.test.js`, `node tests/sazeni-integration.test.js`.
Celkový zamýšlený rozsah a zdroje: [CONTRACT.md](CONTRACT.md).
