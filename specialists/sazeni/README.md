# Sázkař 3.1 — autonomní analytický engine

Zadáš preference. Host načte skutečné zdroje, engine vypočítá pravděpodobnosti,
porovná je s modelem z historie a sestaví tikety. Ručně zadané pravděpodobnosti
nepřijímá. Fotbal, předzápasové 1X2, pět nejvyšších evropských lig.
**IMPLEMENTED_SLICE / REVIEW_PENDING**: skutečný běh ověřil veřejné kurzy
Fortuny bez účtu a API klíče. Nezávislé přijetí ještě neproběhlo.

## Vyzkoušení bez účtu a bez připravených dat

Z kořene tohoto checkoutu:

```bash
node bin/sazeni.js --auto /tmp/sazkar-fortuna-1 'Fortuna, do 24 h, kurz od 1.5 do 3, úspěšnost alespoň 40 %'
```

Výstupní adresář musí být nový. Dostaneš `tickets.md`, `tickets.csv`,
`result.json` a zadání `input.json`. První běh stahuje historii; další využije
ověřenou cache. Databáze `.intentsmith-artifacts/betting/analysis.sqlite` ukládá
zdrojové snímky, hashe, čas načtení, modely, výsledek a audit síťových požadavků.

Výchozí režim načítá **veřejnou nabídku Fortuny** stejným datovým kanálem,
který používá její anonymní web. Nepotřebuje prohlížeč, účet ani placený klíč.
Zná čas načtení, ale zdroj neposkytuje čas poslední změny konkrétní ceny:
výsledek má `dataMode: observed`, `verifiedObservation: true`,
`verifiedLive: false`. Kurzy se pro každý výpočet načtou znovu a výběr vyprší
nejpozději dvě minuty po jejich načtení. Pro obnovení spusť nový výpočet do
nového adresáře. Nejde o potvrzení přijetí sázky.

Po stažení cen host znovu zkontroluje termíny a účastníky. Pozastavené trhy,
neúplné 1X2 nebo prošlá data nevytvoří platný návrh. Při změně schématu či
odmítnutí přístupu vrátí konkrétní chybu, nepřejde na jinou kancelář.

Pro třídenní akumulátory je připravený upravitelný
[soubor preferencí](examples/fortuna-72h.json): 2–3 položky, kurz 2–4,
teoretická úspěšnost alespoň 20 %, rozestup nejvýše 12 h a tři různé tikety.

```bash
node bin/sazeni.js --auto /tmp/sazkar-fortuna-2 'Fortuna, do 3 dnů' specialists/sazeni/examples/fortuna-72h.json
```

Textové hodnoty mají přednost před stejnojmennými hodnotami v souboru.
Limity jsou pro celý tiket. `do 3 dnů` znamená následujících 72 hodin;
`rozestup max 12 h` navíc omezuje vzdálenost prvního a posledního začátku.
Konec zápasu ani vypořádání do daného času tím není garantováno.

## Další zdroje

Fortuna je výchozí a ověřená cesta. Tipsport při veřejné sondě 12. 9. 2026
vrátil HTTP 403 i v anonymním prohlížeči; veřejný sběrač pro něj nyní není
funkční. [Záznam sondy a skutečného výpočtu](../../docs/review/2026-09-12-SAZENI-PUBLIC.md).

Původní veřejná CSV reference z Football-Data zůstává dostupná přes
`{"dataSource":"reference"}` v souboru preferencí; výchozí kancelář je potom
`bet365-reference`. Je označená `delayed`, ukazuje stáří souboru a nepotvrzuje
aktuální cenu u české kanceláře. Historie Football-Data slouží také k modelování
ve výchozím režimu Fortuny.

Připravený adaptér Odds-API.io podporuje `Tipsport.cz`, `Chance.cz`,
`iFortuna CZ`, `Betano CZ`. Veřejný katalog potvrdil všechny čtyři jako aktivní
12. 9. 2026. Zápasy a kurzy z tohoto agregátoru vyžadují klíč a odpovídající
kanceláře v jeho plánu. Klíč nastav **v prostředí procesu** pod názvem
`INTENTSMITH_BETTING_ODDS_IO_API_KEY`; nepatří do chatu ani JSON preferencí.

Jde o samostatnou explicitní volbu, nikoli fallback veřejného sběru. Vytvoř
`api-preferences.json` s `{"dataSource":"odds_io"}` a poté lze zadat:

```bash
node bin/sazeni.js --auto /tmp/sazkar-tipsport-1 'Tipsport, do 24 h, kurz od 1.5 do 3, úspěšnost alespoň 40 %' api-preferences.json
```

Bez klíče dostaneš konkrétní `ODDS_IO_KEY_REQUIRED`. Čerstvý API snapshot má
úplný trh 1X2, shodné identifikátory účastníků a aktualizaci nejvýše dvě minuty
starou; přijetí sázky konkrétním účtem stále neověřuje. České zápasy mimo
podporovaných pět zahraničních lig zatím nejsou součástí modelového pokrytí.
Služba je nezávislý agregátor, nikoli oficiální API kanceláří. Nákup ani
registrace nebyly provedeny. Aktuální omezení bezplatných klíčů a ceny jsou
v [průzkumu](../../docs/research/2026-09-12-AUTONOMOUS-BETTING.md).

## Chat a pravděpodobnosti

V aplikaci **spuštěné z této větve** zapni specialistu `sazeni`. Zadej stejný
text jako výše, příloha není potřeba. Host musí mít konverzaci a uloženou
uživatelskou zprávu; přímé CRE volání bez času a datového hostu nevytváří
predikci. Následné „do 3 dnů“ přepočítá okno. Volbu lig a další parametry lze
vložit jako `{"preferences": {...}}`. Relace si pamatuje preference 30 minut;
nový JSON je resetuje. Zpráva s nepodporovanou přílohou vrací chybu.

Výchozí metoda je **automaticky odvozený tržní odhad očištěný o marži**.
Dixon–Coles se trénuje samostatně z načtené historie a uchovává pro srovnání.
Měření na 3 306 společných testovacích zápasech nepodpořilo jeho použití místo
tržní reference ani kalibrované kombinace. Proto jej engine nepředstírá jako
lepší predikci. Detaily, kalibrace, pokrytí a další experimenty jsou v průzkumu.

Procenta jsou bodové teoretické odhady. Součin položek předpokládá nezávislost;
engine vylučuje společný zápas/tým či známou závislost a u akumulátoru ukazuje
meze při neznámé závislosti. Validovaná statistická dolní mez není dostupná.
Zadaných „40 %“ tedy není záruka ani certifikované minimum skutečné šance.

## Ověření a omezení

```bash
node tests/sazeni-engine.test.js
node tests/sazeni-integration.test.js
```

Solver má nejvýše 200 kandidátů, 200 000 stavů a 10 sekund; celý datový běh
120 sekund. Limity tiše nerozšiřuje. Každý tiket má jednu kancelář, region a
pravidlo vypořádání. Pořadí jednotlivých tiketů a následný výběr různých tiketů
není společná optimalizace portfolia. Kurzy a peníze počítá přes racionální
BigInt; peníze jsou celé haléře. Report nevytváří ani nepřepisuje LLM.

Samostatný formulář ve Studiu, automatické vyhodnocení výsledků, plánované
rozesílání, zranění/sestavy/xG a prokázaná predikční výhoda zatím nejsou hotové.
Sázky se nepodávají. Změny nejsou aktivované ve sdíleném provozním checkoutu.

Syntetický historický solver lze stále reprodukovat bez sítě:

```bash
node bin/sazeni.js tests/fixtures/betting/envelope.json /tmp/sazkar-fixture-1 --now 2026-09-11T12:00:00.000Z
```

[Kontrakt](CONTRACT.md) · [výzkum](../../docs/research/2026-09-12-AUTONOMOUS-BETTING.md)
· [aktuální pracovní zadání](../../docs/wp/WP-SAZENI-PUBLIC-20260912.md)
