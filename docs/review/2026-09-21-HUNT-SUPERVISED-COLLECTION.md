# GPU hunt — nasazený sběr pod dohledem, 21. 9. 2026

Nasazení: **DEPLOYED / SUPERVISED_COLLECTION_VERIFIED**.
Stav přejímky: **REVIEW_PENDING**. Automatický výběr, aktivace a mazání podle
kvality: **NO_GO, 0/7 přijatých rozhodovacích profilů**.
Tento packet nevyhlašuje přijetí hodnotitele ani předpovědní platnost benchmarku.
Autorita: zadání operátora, HANDOFF §5, DIRECTION a nezměněný kontrakt evaluace.

## Dodaná funkce a její hranice

Běžný produkční candidate trial nově sbírá odlišné sady D1, D2, R1, R2 a CHAT
bez nepřijatého soudce. Sběr nevyžaduje měření současného modelu ani průchod
starým jazykovým filtrem. Pět rolí končí `AWAITING_REVIEW` s `score: null`;
přenosová chyba, vyčerpaný limit a neúplný sběr zůstávají samostatně viditelné.
CODE a VISION mají průzkumný výsledek z orákula, žádnou rozhodovací autoritu.

Po každém pokusu vzniká append-only checkpoint v existující produkční DB.
Historie slučuje průběžné snapshoty pro zobrazení, DB je zachovává. Studio
ukazuje vstup, odpověď, kritéria, počty i stav. Export odděluje anonymizovaná
metadata od soukromého klíče identit. Export ani HTML posudek nezapisují známky
do produktu. U jednoho známého modelu odstranění metadat není nezávislá slepá
přejímka.

Paměťové ověření a inference používají stejný kontext 16 384 tokenů a limit
22 GB modelové VRAM. Nejde o důkaz vhodnosti pro větší produkční kontext;
překročení tohoto limitu samo neospravedlňuje smazání artefaktu.

Ve Studiu jsou opravené hodiny nově přijatého požadavku a otevření výsledků
celé dávky. Role a Historie při otevření obnoví evidence. Panel huntu ukazuje
poslední ověřenou dostupnou RAM a disk s časem kontroly a mezemi. Správce
uvádí datum svého uloženého reportu, odděleně od načtení inventáře.

## Rezerva FS a ochrana před OOM

- Před evaluací: alespoň 8 GiB `MemAvailable` a 12 GiB dostupných na všech FS
  se stavem, DB a modely. Během ní kontrola každé 2 s, mez RAM 4 GiB / FS 12 GiB.
  Nečitelná kapacita blokuje další práci. Ukončují se jen vlastní procesové
  skupiny; nejprve TERM, po 8 s KILL, checkpointy zůstávají.
- Manuální i plánovaná jednotka: `MemoryHigh=60%`, `MemoryMax=75%`,
  `MemorySwapMax=1G`, `OOMPolicy=stop`. CODE izolovaná jednotka má vlastní
  limit 2 GiB, swap 256 MiB a časové omezení.
- Každé stahování přes centrální `UpgradeManager` vyžaduje 40 GiB rezervy.
  Kontrola je před efektem provideru a dále za běhu; dostupné místo se porovnává
  i se známými zbývajícími vrstvami. Výpadek/stagnace streamu kontrolu nevypne.
  Nejde o atomickou rezervaci proti cizím zápisům mezi dvěma kontrolami.
- Buffer nedokončeného NDJSON rámce je omezen na 1 MiB. Selhání před providerem
  uvolní claim, selhání během efektu zachová stav pro zotavení, nic nemaže.
- V aktuálním FS pod 40 GiB se nové modely nestahují. Již stažené modely lze
  měřit, pokud projdou menší rezervou pro evaluaci. Pro další stahování musí
  být navíc prostor pro celý model, nejen samotná mez 40 GiB.

## Skutečné chyby nalezené při ověření

Sanitizované CODE testy neměly adresu uživatelského busu. Bezpečný fallback
nyní najde pouze ověřený socket stejného UID. Následná negativní kontrola
odhalila, že `PrivateNetwork=yes` může na tomto hostu zůstat bez účinku.
Fallback používá root-owned `bwrap` s vlastním network namespace. Bootstrap
před importem testu ověří skutečný odlišný namespace; falešně úspěšný launcher
modelový kód nespustí. Read-only kořen a zapisovatelný pracovní adresář nejsou
tvrzením plné izolace nepřátelského kódu ani skrytí všech čitelných dat hostu.

Instalace zachová vypnutý timer a automation hold. Timer má nyní i ve
skutečně instalované jednotce `Persistent=false`; zmeškaný noční běh se
nepřehraje při startu počítače. Evaluation provider je
připnutá `.34.2-intentsmith.1`; systémový provider zůstává `.34.0-intentsmith.1`.
GUI čte výsledky evaluační verze, ale odlišná systémová verze nedostane autoritu
k aktivaci. Není tvrzeno, že byl systémový provider aktualizován.

## Původ kódu a neúspěšné kontroly

Výchozí větev `6503366c` nebyla před nasazením totožná s novějším instalovaným
`9ad8bc3f`. Merge `2799ab44` zachoval jeho změny chatu a projektů. Celý diff
proti původní větvi proto není výhradně GPU hunt. Původní instalace i její
historie zůstaly zachovány; závislosti a sestavení mají samostatné inody
s Btrfs reflinky, nejde o sdílené zapisovatelné hardlinky.

Úplný offline/database profil na čistém `be32d679`: **363 PASS / 1 FAIL /
0 TIMEOUT / 0 BLOCKED / 0 SKIPPED**. Jediný FAIL je
`tests/nightly-orchestrator-self-test.js`, neshoda registry hashe s dříve
přijatou Gate 0 pečetí. Podle CONTRACT §8 se při běžném vývoji pečeť
nepřepisuje. Není to plný zelený profil.

Starší nedokončené série, chybné sondy a následně opravené pády jsou zachované
v evidence rootu a `validation-attempts.json`; nepočítají se jako úspěšné běhy.
Následné změny UI a centrálního stahování mají cílené testy. Nejsou vydávány
za další úplný běh offline/database profilu.

## Nasazení a skutečné měření

Instalovaný produkt: `cd5a6943379254b3ec0a769913fab2db1249b85b`.
Produkční databáze je původní `/home/belphareon/Projects/intentsmith/data/c3.db`.
Při instalaci vznikly nové zálohy; neproběhla výměna produkčních dat za fixture.

Úplný průchod byl spuštěn skutečným tlačítkem **Otestovat vše** a potvrzením
ve Studiu. `run-Ig7qPU`, 21. 9. 2026 19:34:24–20:37:03 UTC,
trval **62 min 39,7 s**, exit 0, stav `AWAITING_REVIEW`. Nebyla použita cache.
Běžel na čistém nasazeném `be32d679`; následné změny UI, diskové rezervy
stahování a timeru jsou v `cd5a6943`. Strojová kontrola všech sedmi plánů
potvrdila shodné kontrakty mezi těmito revizemi. Celý hodinový běh se za běh
na pozdější revizi nevydává.

Model `qwen3.8:latest`, digest
`22130167c4c20e20c7b71454612966ca8e8171e9b3cc8ab6ce8aa6cbfec79643`,
Ollama `0.34.2-intentsmith.1`, kontext 16 384 tokenů:

| Role | Úlohy × opakování | Výsledek | Čas samotné role |
|---|---:|---|---:|
| D1 | 8 × 3 | 24 odpovědí, bez známky | 14 min 32 s |
| D2 | 8 × 3 | 24 odpovědí, bez známky | 10 min 37 s |
| R1 | 8 × 3 | 23 úplných + 1 vyčerpaný limit, bez známky | 12 min 54 s |
| CODE | 7 × 3 | 21 platných oprav, průzkumné skóre 1,000 | 4 min 50 s |
| R2 | 8 × 3 | 24 odpovědí, bez známky | 9 min 42 s |
| CHAT | 40 × 3 | 120 odpovědí, bez známky | 2 min 7 s |
| VISION | 23 × 3 | průzkumné skóre 0,772464 | 3 min 3 s |

Celkem **306 pokusů**. Pět otevřených rolí má 216 uložených pokusů,
215 úplných a jeden `OUTPUT_BUDGET_EXHAUSTED`; žádný z nich nedostal
automatickou obsahovou známku. Limit patří `r1_metrics_flush`; je viditelný
v API, GUI i exportu. Nejde o obsahovou nulu.

CODE 100 % znamená průchod konkrétními kontrolami sedmi krátkých oprav,
nikoli obecnou kompetenci programátora. Sada deklaruje pět historických skupin; samotný počet není přejímkou
statistické nezávislosti.
VISION má přesné dílčí chyby: `vision_connections` 0 %, kontrola dokladu
25 %, propojení panelů 33,3 %. `SUCCESS` u úlohy znamená dosažení prahu,
nikoli bezchybnost všech polí. Agregát 77,2 % proto není důkaz vhodnosti
k autonomnímu nasazení.

### Druhý model na finální instalaci

`devstral-small-2:latest`, digest
`24277f07f62db8f9cb68e9dfc679ea1818a7fbac47a50eff0a701d3f645b63c8`,
byl spuštěn přes **Nový test → CODE** na `cd5a6943`, bez přepnutí role.
`run-8cBExc`, 20:50:10–20:56:26 UTC, exit 0, `COMPLETE`.
**21 platných pokusů: 11 SUCCESS / 10 INCORRECT, skóre 52,38 %**.
Doba celé akce 6 min 15,8 s, samotná sada 5 min 39,8 s; nebyla použita cache.
Run ID: `eval_679de7a6-f2b4-42ed-8f20-ff35c16e79cc`.

Nejde o nuly z nefunkčního prostředí: všechny pokusy mají `valid: true`.
Selhaly opravy časovačů (včetně `timeoutId is not defined`), oprava jistoty
porovnání rozbila další test ve všech třech opakováních a deduplikace selhala
v jednom opakování. Zbylé tři úlohy prošly pokaždé. Qwen na stejné sadě
prošel 21/21; **to je průzkumný rozdíl této sady, nikoli nová provozní
kvalifikace ani povolení k automatické výměně**.

Za toto integrační kolo je dohromady 327 modelových pokusů. Instalace,
prodleva při načtení i samotné testy jsou časově odlišené; sada se uměle
neprodlužuje, aby splnila předem očekávanou délku.

## Ověření Studia a zdrojů hostu

V nově spuštěném Electronu byla zkontrolována URL rendereru s přesnou revizí
`cd5a6943`. Všech šest podzáložek se načetlo z produkčního backendu bez
`Failed to fetch`. Doložené akce:

- dokončená dávka zobrazuje všech sedm rolí, skutečnou délku a vyčerpaný limit;
- **Zobrazit výsledky** otevře správný model a všechny role, nezúží dávku na
  jednu neexistující společnou roli;
- detail načte zadání, kritéria a skutečně uložené odpovědi;
- Historie po otevření obsahuje nové záznamy, včetně čekání na posouzení;
- Správce po kontrole ověří zdroje **6/6**, ukáže čas reportu; prázdná aktivita
  zůstává bez skóre, nevede k umělým 50 nebo 100 %;
- kliknutí na **Stáhnout gemma4:31b** skončí před providerem konkrétním
  důvodem: 31,0 GiB dostupných proti rezervě 40 GiB. GUI přestane čekat na
  manifest a znovu nabídne tlačítko. Negativní API odpověď nyní používá HTTP 500
  s konkrétním kódem; není vydávána za úspěšné stažení;
- živý Devstral CODE zobrazuje počet dokončených pokusů, procenta, uplynulý
  čas a odhad zbývajícího času. Poslední ověřená RAM/FS mají vlastní timestamp.

Diagnostický Electron používá privátní profil, `--no-sandbox --disable-gpu`
a lokální CDP. Kontroluje skutečný produkt a původní DB; není důkazem přejímky
nativního Electron sandboxu. První pokus o závěrečnou kontrolu omylem připojil
staré diagnostické okno `be32d679`, protože byl ukončen jeho child backend
místo hlavního Electronu. Chybný launcher a neúspěšná kontrola jsou uchované;
opakovaný průchod připíná a kontroluje revizi ještě před asercemi.

Při sestavení Studia zasáhl nízký `MemoryHigh=7500M`: objevilo se výrazné
škrcení, nikoli OOM. Při dostupných více než 18 GiB RAM byl **jen vlastnímu
buildu** zvýšen High na 9 GiB / Max na 10 GiB, swap zůstal 512 MiB. Build
pak doběhl; peak 7,6 GiB, OOM 0. Nejde o tvrzení nulového tlaku na paměť
po celou dobu práce.

Průběžný dohled zaznamenal minimálně 16.16 GiB dostupné RAM.
Po obou bězích je dostupných přibližně 27.4 GiB RAM a 30.9 GiB FS.
Qwen cgroup dosáhla peaku 18,7 GiB / 1 GiB swapu, Devstral přibližně
4,2 GiB / 0 swapu. V obou cgroups jsou `oom=0`, `oom_kill=0`; kernel journal
neobsahuje OOM událost. Tím není zaručeno, že jiná aplikace nemůže později
vyčerpat host mezi dvěma kontrolami.

Porovnání s instalační zálohou doložilo beze změny všech 7 bindings,
234 rozhodnutí, 16 binding operací a inventář 12 artefaktů se shodnými
digesty a velikostmi. Přibyly startupové ověřovací pokusy bindings a nová
měření, nikoli nová přiřazení. GPU i evaluační služba jsou po dokončení
uvolněné, timer disabled/inactive; samostatná cleanup/failover politika OFF.

## Reprodukce a podklady pro posouzení

Evidence root:
`/home/belphareon/Projects/coworker/intentsmith-hunt-supervised-20260921`.

- `review-all/review.html`: 216 odpovědí bez automatických známek, stránkování,
  filtrování rolí a ruční známka/důvod po kritériích. Exportuje jen DRAFT JSON;
  známky z něj nevstupují do DB. Rozpracované známky jsou jen v paměti stránky,
  před zavřením je nutné stáhnout JSON.
- `review-all/answers-for-review.json`: úplný vstup, kritéria a výstup,
  SHA-256 `0368a58202d1d8b993aa074cef3f43806118f1f3d27b2a66e4ac8cd08fe96b39`.
  Klíč identit je samostatný privátní soubor a není v přenosném archivu.
- `run-final/` a `run-devstral/`: skutečné summary/progress/result/resources,
  přesná run ID a dílčí oracle výsledky včetně uložených odpovědí.
- `ui-delivery/`: DOM důkazy, skutečné POST požadavky a screenshoty; bez
  autentizačních hlaviček a profilu prohlížeče.
- `evidence-receipt.json` a [verzovaný receipt](evidence/2026-09-21-hunt-supervised.json):
  SHA archivu a manifestu. Každý soubor byl po zabalení znovu přečten a ověřen.
  Archiv neobsahuje produkční databázi ani lokální capability.

Zdroj je přenositelný pomocí ověřeného `source.bundle` (do `5fa456ec`) a
malého `source-delivery-delta.bundle` (finální runtime `cd5a6943`):

```bash
git clone source.bundle source
git -C source fetch ../source-delivery-delta.bundle HEAD
git -C source checkout --detach FETCH_HEAD
node source/scripts/manual/verify-code-oracles.mjs --out /absolutni/cesta/report.json
```

Závislosti nejsou součástí source bundlu. Referenční orákula běží bez GPU
s odpovídajícím Node a nainstalovanými závislostmi; výstup běhu a report jsou v `oracles-final.log` a `oracles-final.json`.

| Kontrola | Výsledek a rozsah |
|---|---|
| Úplný offline/database profil, `be32d679` | 363 PASS / 1 FAIL, pečeť registru; není plně zelený |
| CODE referenční kontroly, `be32d679` | 7/7 úloh, 62/62 kontrol; 5 deklarovaných skupin |
| CODE runner s ověřením skutečného síťového namespace | 68/68 |
| Desktop + timer po finální opravě | 37/37 |
| Pět dotčených testovacích programů centrálního pullu | všechny PASS; podrobnosti v `pull-storage-test-results.json` |
| Architektonická hranice | 1 398 hran / 3 cykly / 28 členů |
| Review HTML | 216 položek, 18 stránek, filtr a skutečné stažení DRAFT JSON ověřeny |
| Aktivační profily | 0/7 přijatých; měření tuto bránu neotevřelo |

## Zbývající přejímka

1. Rozsoudit bodové kotvy D1/D2 a otevřený rozsah R1; podle nich přepočítat
   dotčené uložené odpovědi, ne zprůměrovat nesouhlasící posuzovatele.
2. Přijmout samostatného hodnotitele na odděleně anotovaných odpovědích
   s chybami podle typů úloh. Tam, kde jde ověřit stav/testy, dát přednost
   spustitelnému orákulu před sémantickým soudcem.
3. Předem uzamknout větší počet nových nezávislých provozních případů.
   Malý dosavadní rank-check platnost nepotvrdil ani nevyvrátil. Dvacet
   případů je pracovní návrh, ne záruka statistické průkaznosti.
4. Rozšířit a přijmout provozní kvalifikační schéma mimo CODE; poté dovodit
   `decisionReady` z přijaté evidence pro přesný contract SHA.
5. Teprve z ověřených dat odvodit rychlý profil a povolit pravidelný dohledový
   provoz. Tato dodávka je plný sběr, ne přijaté rozdělení rychlý/plný benchmark.

Timer zůstává vypnutý. Nové přiřazení ani automatické mazání nejsou výsledkem
samotných bodových skóre. Pozitivní stažení velkého modelu se v tomto kole při
malé rezervě disku záměrně neopakovalo; doložená je bezpečná negativní cesta.

Samostatná serverová automatika rovněž zůstává vypnutá: autoritativní
`autoFailoverEnabled=false`, `autoCleanupEnabled=false`, revision 1.
Vypnutí timeru tak není zaměňováno za stav této oddělené politiky.

Nový běh je **integrační ověření jednoho modelu přes všechny role**. Opakuje
známé sady, není holdout, nová kalibrace dvanácti modelů ani nové provozní
ověření pořadí. Historický panel 2 922 pokusů a rozsouzení známek zůstávají
oddělené a nebyly přepsány. Kontroly orákula dokazují, co přijme měřidlo;
neprokazují samy úspěch modelu na libovolném projektu.
