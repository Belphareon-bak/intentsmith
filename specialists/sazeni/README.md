# Sázkař 3.2 — autonomní analytický engine

Zadáš preference. Host načte skutečné zdroje, engine vypočítá pravděpodobnosti,
porovná je s modelem z historie a sestaví tikety. Ručně zadané pravděpodobnosti
nepřijímá. Fotbal, předzápasové 1X2, pět nejvyšších evropských lig.
**IMPLEMENTED_SLICE / REVIEW_PENDING**: skutečný běh ověřil veřejné kurzy
Fortuny bez účtu a API klíče. Nezávislé přijetí ještě neproběhlo.

## Pohodlné ovládání z terminálu

Na tomto počítači je nainstalovaný příkaz `sazkar`, který funguje z libovolného
adresáře. Bez parametrů otevře jednoduché menu. Příkazy:

| Příkaz / alias | Co udělá |
|---|---|
| `sazkar` / `sk` | menu |
| `sazkar hledej` / `sk24` | top 5 podle odhadu úspěšnosti, do 24 h, kurz 1,5–3 |
| `sazkar hledej --profil 72h` / `sk72` | top 5, 2–3 položky do 72 h, kurz 2–4, rozestup ≤12 h |
| `sazkar hledej --top 10` / `sk24 --top 10` | deset nejlépe hodnocených návrhů |
| `sazkar posledni` / `skposledni` | poslední uložený report; ceny mohou být již prošlé |
| `sazkar historie` | posledních deset výpočtů |
| `sazkar stav` / `skstav` | poslední sběr, stav plánovače a upozornění |
| `sazkar hlidat start` / `skhlidej` | zapne pravidelný veřejný sběr |
| `sazkar hlidat stop` / `skstop` | vypne pravidelný sběr i automatický mail |
| `sazkar upozorneni` | historie zaznamenaných signálů |

V novém terminálu budou aliasy dostupné automaticky. V již otevřeném:

```bash
source ~/.bash_aliases
```

Vlastní požadavek například:

```bash
sazkar hledej 'do 24 h, kurz od 2 do 4'
sazkar hledej --top 10 'do 24 h, kurz od 2 do 4'
```

Úspěšnost nemusíš zadávat: výchozí hledání nemá její minimální práh a řadí
podle vypočteného odhadu od nejvyššího. `--top` přijímá 1–10, výchozí je 5;
funguje i s profilem 72 h. V úvodu výsledku je tabulka pořadí, kurzů a odhadů.
Nejlepší varianty mohou sdílet zápasy, proto jde o alternativy k výběru.
Při nedostatku použitelných dat ukáže méně návrhů; při dosažení limitu hledání
výslovně označí neúplný výsledek. Kurz ani časové okno kvůli počtu neuvolní.

Výstupní adresáře se vytvářejí automaticky pod `~/.local/state/sazkar/results/`.
Každý obsahuje Markdown, CSV, JSON výsledku a zadání. Soukromá databáze
`~/.local/state/sazkar/analysis.sqlite` uchovává zdroje, výsledky, historii
cen, signály a audit. Starší výzkumná DB v checkoutu zůstává historickou evidencí.
Launcher odkazuje na tuto pracovní větev, kterou je potřeba pro běh zachovat.

Na jiném checkoutu se instalace provede z jeho kořene:

```bash
node scripts/install-sazkar.mjs --install
```

Instalátor zachovává cizí příkazy/aliasy a nevytváří automatické předplatné
nebo účet. User timer se zapíná samostatným příkazem výše.

## Průběžné sledování a e-mail

Hlídač čte Fortunu každých 15 minut, výchozí okno má 72 hodin. První odečet,
dlouhý výpadek nebo změna filtrů založí výchozí stav bez hromadného rozeslání.
Oznámí nově zachycenou nabídku v již sledovaném okně nebo zlepšení ceny
alespoň o 5 %. Filtry jednotlivého tipu jsou kurz 1,5–3 a tržní odhad ≥40 %.
Skutečný okamžik vypsání zdroj neuvádí. Signál neznamená prokázané +EV;
vyšší cenu může doprovázet zhoršení šance výsledku.

```bash
sazkar hlidat jednou
sazkar hlidat nastav --interval 15 --hodin 72 --zlepseni 5 --uspesnost 40 --max-mailu 4
```

Interval lze nastavit na 5–120 minut, okno na 1–168 hodin. Větší nabídka může
narazit na existující limit 100 zápasů; rozsah se tiše neořízne. Opakování
téhož tipu má cooldown šest hodin a musí překonat poslední oznámenou cenu.
Nejvýše jeden nejlepší signál při odečtu a výchozí čtyři e-mailové pokusy za
24 hodin. Fronta nevydává starou cenu za čerstvou a po výpadku ji nedosílá.

Nastavení e-mailu probíhá lokálně; heslo se zadává skrytě:

```bash
sazkar mail nastav
sazkar mail test
```

Zadává se SMTP server, TLS port 465/587, účet, odesílatel a jediný příjemce.
Použij pověření určené poskytovatelem pro SMTP, případně heslo aplikace.
Heslo je v `~/.config/sazkar/smtp-password` s právy 600; do chatu ani Git
nepatří. `mail test` odešle výslovně označený test bez fiktivních tipů.
SMTP přijetí ještě nepotvrzuje doručení do schránky; ověř skutečné přijetí.
Nejasný výsledek přenosu se automaticky neopakuje a je označený `unknown`.

Bez mailu funguje sběr a lokální historie. Aktuální instalace má sběr zapnutý,
ale skutečné odesílání je **MAIL_CONFIGURATION_REQUIRED**. User timer běží
v uživatelské systemd relaci; při vypnutém/uspaném počítači nesbírá a neslibuje
zachycení krátkých cenových oken. Nastavení přetrvává restart příkazu.
Databáze má limit 512 MiB; při jeho dosažení se další sběr zastaví s chybou.

[Výzkum načasování a hodnotových doporučení](../../docs/research/SAZKAR-MARKET-TIMING.md)
vysvětluje měření 7 228 zápasů i potřebný další krok: čerstvou nezávislou
referenci, časově doložené informace a prospektivní ověření predikční výhody.

## Vyzkoušení bez účtu a bez připravených dat

Z kořene tohoto checkoutu:

```bash
node bin/sazeni.js --auto /tmp/sazkar-fortuna-1 'Fortuna, do 24 h, kurz od 1.5 do 3'
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
bez minimálního prahu úspěšnosti, rozestup nejvýše 12 h a pět alternativ
seřazených podle odhadu úspěšnosti.

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

Samostatný formulář ve Studiu, automatické vyhodnocení výsledků,
zranění/sestavy/xG a prokázaná predikční výhoda zatím nejsou hotové.
Sázky se nepodávají. Změny nejsou aktivované ve sdíleném provozním checkoutu.

Syntetický historický solver lze stále reprodukovat bez sítě:

```bash
node bin/sazeni.js tests/fixtures/betting/envelope.json /tmp/sazkar-fixture-1 --now 2026-09-11T12:00:00.000Z
```

[Kontrakt](CONTRACT.md) · [výzkum](../../docs/research/2026-09-12-AUTONOMOUS-BETTING.md)
· [aktuální pracovní zadání](../../docs/wp/WP-SAZENI-PUBLIC-20260912.md)

## Studio (2026-09-17)

Ve Specialisté vyber **Sázkař** a zadej „do 24 h, kurz od 2 do 4“.
Seznam čte skutečně povolené balíčky, aktivace používá ID `sazeni`.
Stejný autonomní engine jako CLI používá veřejnou Fortunu bez API klíče;
pravděpodobnosti se nezadávají ručně. Nedostupná/neúplná nabídka vrací
konkrétní stav, nikdy vymyšlené tikety. IDE samo nepodává sázky ani nezapíná mail.
Stav analýz přežije upgrade instalace pod `~/.local/state/sazkar/studio/`.
