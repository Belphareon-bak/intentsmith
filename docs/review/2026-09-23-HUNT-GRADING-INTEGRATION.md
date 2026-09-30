# GPU hunt — celé předání implementace, měření a podmínek GO

Stav: **SUPERVISED_COLLECTION_RUNTIME_VERIFIED / REVIEW_PENDING**.
**AUTONOMOUS_SELECTION_NO_GO**, přijatých rozhodovacích profilů **0/7**. Autorita: zadání operátora
dokončit hunt, HANDOFF §5, DIRECTION a hodnoticí kontrakt ze září 2026.
Tento packet není přejímka modelů. Přijetí implementace a oprávnění vybírat
modely jsou dvě různé věci.

## Rozsah předání a instalace

Výchozí stav větve `work/hunt-model-controls-20260917` byl čistý
`a144c447908baf590876fdf3f917bed78c818bbc`. Nasazený a fyzicky testovaný
runtime je **`400c9d8ffdf336055d4dc6f9fb8a10565c0adccd`**; pozdější
commit předání mění pouze dokumenty a receipty. Instalace používá čistý
detached snapshot na `/mnt/vi7000/intentsmith/releases/400c9d8ffdf336055d4dc6f9fb8a10565c0adccd`.
Backend, Studio a provider wrapper mají stejný zdroj. Původní produkční DB
`/home/belphareon/Projects/intentsmith/data/c3.db` zůstala zachovaná;
podporovaný instalátor vytvořil zálohu a ověřil migrace před přepnutím.

Nové opravy při fyzickém prokliku:

- **Historie:** odmítnutí „Ohodnotit uložené odpovědi“ bylo viditelné jen
  v jiné záložce. Nyní je důvod přímo v Historii; zrušení potvrzení také
  ukončí průběžnou hlášku.
- **Disk:** přehled ukazoval kapacitu kořenového FS. Nyní čte dostupné
  `bavail` na skutečné cestě modelů. Živý přehled: **754,8 GiB**, nikoli
  187 GiB kořenového FS. Chyba sondy nevrací kapacitu jiného disku.
- **Přejímka:** souhrnná shoda mohla skrýt obrácená hodnocení jednotlivých
  kritérií. Reprodukce `[1,0]` proti `[0,1]` pro referenci `[0.5,0.5]`
  prokázala dřívější přijetí. Brána nyní vyžaduje stejné kontroly jako
  běžný hodnotitel: mez rozdílu kritéria a úspěšnou referenci v obou pořadích.

## Přehled všech funkcí

| Oblast | Stav a důkaz | Hranice tvrzení |
|---|---|---|
| Provider a identita | Připnutý evaluační `0.34.2-intentsmith.1`, SHA binárky/native knihoven, response-bound digest, sidecar pouze po dobu běhu | Systémová Ollama je `0.34.0-intentsmith.1`; přenos rozhodnutí mezi verzemi není kvalifikovaný |
| Inventář GPU | Živá RTX 3090 / 24 GiB, uložená denní inventura; umístění modelu se kontroluje při běhu | Odhad katalogu není důkaz úplného GPU umístění |
| Disk/RAM | Nový modelový FS, rezerva před pullem 40 GiB, start měření 8 GiB RAM, za běhu 4 GiB RAM / 12 GiB FS; systemd omezení a průběžná kontrola | V tomto předání nebyl proveden nový velký pull ani reboot stroje |
| Discovery a fronta | Studio: 246 katalogových položek, 121 v použitém VRAM limitu; filtr VISION vrací 24; priorita zohledňuje chybějící/slabé role | Katalogová velikost, datum vydání a priorita nejsou lokální skóre; všechny položky se znovu nestahovaly |
| Ruční test | Skutečné kliknutí „Otestovat vše“, dialog s počty úloh, branded POST 202, sériový běh všech 7 rolí | Výsledky série jsou popsány níže; měření neurčuje samo vítěze |
| Průběh/stop | Úloha, opakování, počet, procento, ETA sady, prostředky, posledních 5 akcí; první série zastavena skutečným potvrzením ve Studiu | ETA je odhad aktuální sady; přerušené pokusy nezmizely |
| CODE/VISION | Spustitelné CODE orákulum a přesná obrazová pole; sdílený produkční parser | Průzkumné skóre; žádná doložená obecná schopnost dokončovat projekty |
| D1/D2/R1/R2/CHAT | Celé odlišné sady a uložené odpovědi, oddělené pozdější hodnocení | Bez přijatého T4 hodnotitele nemají souhrnné obsahové skóre |
| Hodnocení uložených odpovědí | CLI/API/Studio, nepřepisování zdroje, kontrola přejímky a jejího odvolání; syntetické pozitivní i negativní integrační testy | Skutečná pozitivní inference přijatým hodnotitelem neběžela: v produkční DB takový záznam není |
| Rozhodování | Odvozená přejímka všech 7 rolí, přesná dvojice digestů/profilů, provozní konečný stav, žádné přijetí samotného `PASS` | Validátor přijímá reviewované receipty; automatický výrobce úplných provozních workflow pro všech šest ne-CODE rolí není dodaný |
| Retence | Nepřijatá sada, neúplná evidence, vazba role nebo rollback model zachovají; samotné přetečení jednoho kontextu neprokazuje nepoužitelnost | Nic se v tomto běhu nemaže; kvalitou řízená automatika není přijatá |
| Aktivace | Oddělená explicitní binding application; hunt nemění role | Žádná nová doporučení ani změny bindingů z průzkumných výsledků |
| Studio | Všech 7 záložek, řádky/tabulky, filtry, podrobnosti a historie; opravená viditelnost chyb | Diagnostické Electron okno s `--no-sandbox --disable-gpu`, samostatný profil a skutečný backend/DB; není to přejímka běžného desktopového sandboxu |
| Správce | Skutečné kliknutí Zkontrolovat: čerstvě ověřené zdroje 6/6 | Architektura a specialisté bez odpovídající dokončené aktivity nemají vymyšlené procento; přijetí návrhu samo změnu neprovede |
| Autocheck Ollamy | Denní metadata check, nově ověřený `UPDATE_AVAILABLE` pro upstream 0.34.3 | Automatická instalace je vypnutá; nový patch/build a kvalifikace neproběhly, běh zůstává na pinu |
| Plánovač | Stav a ovládání ve Studiu, persistentní systemd timer; aktuálně disabled/inactive a explicitní hold | Noční automatická smyčka v tomto běhu nebyla aktivována |

Release celého IntentSmithu (M5/M6, Gate 0, klíče a privacy) se tímto
předáním nepřijímá. Staré adresáře releasů nebyly plošně mazány ani měněny;
instalace ani jejich zachování nejsou přepis release pečeti.
Plán úklidu našel pouze asi 76 MiB starých sandboxů v cizím checkoutu
specialistů; nebyl aplikovaný. Žádné cizí pracovní soubory se nemažou kvůli
kosmetickému vyčištění tohoto předání.

## Co se mění

Dosud běžný hunt uměl otevřené odpovědi uložit, ale neměl podporovanou cestu
k jejich pozdějšímu hodnocení. Provozní přejímka navíc podporovala pouze CODE.
Nová cesta propojuje uložené odpovědi, přijatého hodnotitele, nezměnitelnou
historii, frontu, párové rozhodování a Studio pro všech sedm rolí.

Pro běžné použití ve Studiu otevři **Nastavení → Modely a inference →
Spravovat role a modely**. V **Evaluaci** vyber model a roli; **Nový test**
měří vybranou roli, **Otestovat vše** vypíše počty a změří celé příslušné sady
postupně. **GPU hunt** ukazuje probíhající úlohu, opakování, dobu a odhad do
konce sady. **Historie → Detail měření** zachovává konkrétní běh i po novém
měření. U otevřené role lze v detailu rozbalit zadání a všechny uložené
odpovědi. Nevyžaduje to příkazy v terminálu.

- Hodnocení je nový záznam. Původní odpovědi, jejich kontrakt, čas sběru a
  poskytovatel zůstávají zachované. Změna rubriky nebo hodnoticího kódu může
  využít staré odpovědi jen při shodě všech zadání a inferenčních parametrů.
- T4 vyžaduje jiný digest hodnotitele než odpovídajícího modelu. Samotné
  autorské kontrolní sondy nedávají produkčnímu hodnotiteli oprávnění.
- Přejímka T4 přepočítává chyby z jednotlivých nezávisle označených odpovědí,
  včetně obou pořadí, všech jmenovatelů a skupin původu. Nepřebírá tvrzení PASS.
- Nový příjem provozních důkazů pro D1/D2/R1/R2/CHAT/VISION vyžaduje úplný
  postup role, doložený konečný stav a regresní kontroly. Jedna izolovaná
  odpověď nebo zopakování jednoho historického případu to nenahradí.
- Přijetí hodnotitele samo neotevírá rozhodování. Potřebuje se i přijaté
  oddělené párové provozní měření přesných dvou digestů, profilu a runtime.
- Zneplatnění přejímky zavře aktuální skóre i běžící hodnocení; historický
  záznam se nemaže. Nová přejímka mění klíč fronty, aby se čekající sběr znovu
  dostal na řadu.
- Studio nabízí **Ohodnotit uložené odpovědi** v detailu sběru. Ověří dostupnou
  přejímku, potvrdí přesný zdroj a spustí samostatné hodnocení. Ukazuje průběh
  a oddělenou dobu sběru/hodnocení; nevyvolá skrytě nové odpovědi modelu.

## Rozhraní a provozní hranice

`GET /api/system/models/grading/:runId` poskytuje čerstvý náhled, pevný hash
zdroje a způsobilé hodnotitele. `POST /api/system/models/grade` přijímá jen
run ID, hash a ID přejímky. GET podléhá autentizaci serveru; mutační POST navíc
vyžaduje lokální brandovanou autoritu. Vstup nemůže dodat skóre, příkaz,
cestu DB ani libovolný systemd unit.

CLI `scripts/grade-model-collection.js --help` popisuje read-only `--plan`
a měření přes vlastněný provider wrapper `--grade-collection --run`.
Vlastní hodnocení používá stejný GPU zámek, sidecar, sledování rezerv a
omezenou systemd službu jako ruční test. Před i po volání kontroluje cizí
GPU procesy, systémovou Ollamu, digest, verzi provideru a úplné GPU umístění.
Selhání hodnotitele je chybějící známka; nejde o nulu kandidáta.

Produkční import přejímky zůstává oddělený a explicitní přes
`scripts/model-evaluation-acceptance.js --record`. Žádný běh si vlastní
přejímku nevytvoří. Hodnocení nezmění přiřazení role ani nic nesmaže.
Retence stále potřebuje důkaz pro všechny příslušné role a kontrolu bindingů.

Pro kontrolu kódu použij rozsah `a144c447..400c9d8f` (38 souborů).
Nejdůležitější cesta je
[plán role](../../src/eval/role-evaluation-plan.js) →
[přejímka](../../src/upgrade/model-evaluation-acceptance.js) →
[hodnocení uložených odpovědí](../../src/eval/grade-answer-collection.js) →
[historie](../../src/upgrade/model-evaluation-history.js) →
[aktuální čtecí model](../../src/upgrade/model-evaluation-read-model.js).
Vedle ní zkontroluj
[T4 přejímku](../../src/eval/semantic-grader-acceptance.js),
[konečný stav provozního postupu](../../src/eval/role-operational-decision.js)
a [CLI vstup](../../scripts/grade-model-collection.js). Reprodukce chybných
kritériových permutací a odmítnutí neúplných či odvolaných důkazů jsou v
[integračním testu](../../tests/evaluation-grading-acceptance.test.mjs).

## Konkrétní návrhové volby k review

Nový T4 validátor navrhuje pro každý deklarovaný typ úlohy nejméně 20
nezávislých skupin, alespoň 8 kladných a 8 záporných skupin, nejvýše 10 %
nesprávných přijetí i odmítnutí, průměrnou absolutní kritériovou chybu do
0,10 a rozdíl pořadí do 0,15. Parametry se uzamykají před měřením.
Tyto konkrétní meze jsou implementační návrh, ne dříve schválená fakta ani
záruka chybovosti v populaci. Jsou předmětem tohoto review. Identita skupin,
nezávislost lidského značení a pravdivost receiptů vyžadují kontrolu zdrojů;
validátor ověřuje konzistenci, nemůže sám dokázat jejich historický původ.
Jednotlivá kritéria nesmějí mezi pořadími kolísat o více než 0,5 a referenční
odpověď musí mít v obou pořadích průměr alespoň 0,9. Nejde jen o průměrnou
shodu, která může opačné odchylky vzájemně vyrušit.

## Co tato delta sama neuzavírá

1. Deset otevřených položek v [arbitráži z 22. září](2026-09-22-HUNT-ARBITRATION-STORAGE.md).
   Návrhy autora nejsou operátorovým rozsouzením.
2. Nový oddělený, nezávisle označený přejímací vzorek pro T4 a skutečné
   predikce jiného hodnotitele. Syntetické DB fixture testují implementaci,
   nikoli schopnost konkrétního modelu známkovat.
3. Dostatečné nové provozní případy a přijatá kvalifikace přesných dvojic.
   Stará vývojová měření se nepřejmenovávají na holdout.

Příjem a vynucování této evidence je implementace této delty. Výroba nezávisle
označené evidence a ověření skutečných modelů z ní automaticky neplynou.
Dokud přijaté záznamy chybí, **automatický výběr a mazání podle kvality nejsou GO**.
Sběr pod dohledem zůstává samostatná použitelná cesta.

Rovněž zbývá podporovaný výrobce úplných provozních receiptů ne-CODE rolí;
dosavadní ruční izolované odpovědi nestačí jako kvalifikace. U běžného huntu
musí být incumbent již platně ohodnocený; samostatné doplnění jeho T4 baseline
se neprovádí automaticky. Rychlý profil není dodaný ani přijatý. To jsou
konkrétní implementační meze, nikoli položky, které by schválení dokumentu
nebo přepnutí `decisionReady` mohlo nahradit.

## Jak dokončit GO bez dalšího přepisování významu výsledků

1. Uzavřít kritériové spory podle existujícího arbitrážního podkladu, včetně
   rozsahu případu [29]. U shodného problému promítnout stejný výklad do
   všech odpovědí; opravy append-only. Autorský návrh se neoznačí za
   nezávislý posudek a souhlas se souhrnným packetem nenahradí rozsouzení.
2. Z nezávisle označených odpovědí oddělit přejímací vzorek, uzamknout
   pravidla a obě pořadí, spustit odlišný digest hodnotitele. Ověřit chyby
   po typech úloh a negativní případy, ne jen celkovou korelaci. Syntetické
   fixture z tohoto PR nejsou přejímací data.
3. Pro CODE lze nezávisle na sémantické arbitráži připravit nové historické
   provozní případy; pro další role doplnit úplný workflow a jeho konečné
   kontroly. Před inferencí uzamknout dvojici, profil, rozpočet, skupiny
   původu a rozhodovací pravidlo. Dosavadních sedm CODE úloh s pěti skupinami
   se tímto měřením nestalo novým holdoutem. Více opakování nenahradí více
   nezávislých historických případů.
4. Importovat pouze přijaté receipty pro přesný runtime a provider, provést
   skutečný pozitivní průchod uložený sběr → hodnocení → párové rozhodnutí
   → doporučení ve Studiu. Teprve potom uvolnit omezený plánovač. Retenci
   ověřit na předem autorizovaném postradatelném artefaktu; vazby a rollback
   zůstávají chráněné.

Při malém nebo neprůkazném rozdílu je správný výsledek NEROZHODNUTO/PONECHAT.
Změna znaménka bodového pořadí pod prahem není důkaz selhání měřidla.
Alternativou k čekání na T4 je převádět vhodné D2/R2 úlohy na spustitelnou
reprodukci a lokalizaci. To vyžaduje nové přijaté orákulum; není to výjimka
z požadavku na přejímku.

## Ověření

### Nová série přes skutečné Studio a produkční DB

`qwen3.8:latest`, digest
`22130167c4c20e20c7b71454612966ca8e8171e9b3cc8ab6ce8aa6cbfec79643`,
provider `0.34.2-intentsmith.1`, kontext 16 384, tři opakování.
Spuštění přes GUI přijato HTTP 202 v `2026-09-23T00:00:20Z`, ukončení
`00:53:29Z`: **53 min 9 s** včetně přípravy. Služba skončila s exit 0,
souhrn správně **AWAITING_REVIEW**. Nejde o použití starých skóre z cache.

| Role | Úlohy × opakování | Doba sady | Výsledek |
|---|---:|---:|---|
| D1 | 8 × 3 | 15:18 | 24 úplných odpovědí, čeká na posouzení |
| D2 | 8 × 3 | 8:52 | 24 úplných odpovědí, čeká na posouzení |
| R1 | 8 × 3 | 11:22 | 24 úplných odpovědí, čeká na posouzení |
| CODE | 7 × 3 | 4:20 | **100 %; 21/21** oprav prošlo stanovenými kontrolami |
| R2 | 8 × 3 | 8:45 | 24 úplných odpovědí, čeká na posouzení |
| CHAT | 40 × 3 | 1:52 | 120 úplných odpovědí, čeká na posouzení |
| VISION | 23 × 3 | 2:06 | **77,25 %** průměr dílčích polí; **36/69** zcela úspěšných pokusů |

Všech **306 pokusů** má výsledek; všech 216 otevřených odpovědí je CAPTURED,
0 vyčerpaných výstupních limitů a 0 neplatných přenosů. Krátká doba CHAT a
VISION není přejaté skóre: běh uložil všechny nové odpovědi a response proof.
Méně výstupních tokenů trvá podstatně kratší dobu než dlouhé rozbory D1.
Čas se uměle neprodlužuje na dvacet minut.

VISION má **33 INCORRECT**, nikoli 33 neplatných měření. Konkrétně například
objednávky 101 místo 121, trasa za 8 místo 5 a přestup T1+T2 místo T1+T5.
Průměr 77,25 % proto není tvrzení, že model spolehlivě vyřeší 77 % obrazových
úloh. CODE je sedm známých vývojových úloh v pěti deklarovaných skupinách;
21/21 z nich nedělá nový provozní holdout.

Tato série ověřuje nasazené propojení všech rolí. Nenahrazuje starší panel
dvanácti modelů, rozsouzení jeho sporů ani nezávislou přejímací sadu.
Obsahové známky otevřených rolí nebyly dodatečně domyšleny.

### Druhý CODE kandidát při stejných podmínkách

Po skončení Qwenu bylo stejným skutečným tlačítkem přijato HTTP 202 pro
`devstral-small-2:latest`, digest
`24277f07f62db8f9cb68e9dfc679ea1818a7fbac47a50eff0a701d3f645b63c8`.
Čas `00:53:53Z–00:59:58Z`, celkem **6 min 5 s**, samotná CODE sada
**5 min 27 s**. Stejný runtime `400c9d8f`, provider, kontext, kontrakt,
sedm úloh a tři opakování. Výsledek **47,62 % = 10/21** úspěšných oprav;
služba exit 0, stav COMPLETE. Tři vstupní základní sondy také prošly.

Celé finální předání proto obsahuje **8 běhů role/model a 327 pokusů**:
Qwen všech sedm rolí, Devstral CODE. Z toho **111** pokusů má spustitelné
nebo přesně deterministické vyhodnocení a **216** čeká na obsahové posouzení.
První zrušená série ani vstupní sondy nejsou připočtené k těmto 327.

Rozdíl CODE 21/21 proti 10/21 je skutečně naměřený na této vývojové sadě;
nejde o nový oddělený provozní rank-check. Žádná role nebyla přepnuta a
žádný model smazán. Ani nulový výsledek některé jednotlivé úlohy sám
neopravňuje k odstranění modelu.

### Testy implementace a měřidel

Čistý `400c9d8f`: celý profil offline/database **364 PASS / 1 FAIL /
0 BLOCKED / 0 TIMEOUT**, 365 programů, 5 min 51 s. Jediný FAIL:
`tests/nightly-orchestrator-self-test.js`, registry hash se liší od staré
reviewované Gate 0 policy. `CONTRACT.md §8` tento vývojový stav výslovně
popisuje; kontrola nebyla odstraněna ani převydaná pečeť. Celkový výsledek
auditu zůstává **FAIL**, ne 365/365 ani release PASS.

Nová sada přejímky/hodnocení: 17/17; existující acceptance store: 17/17;
sémantický runner: 18/18; read model včetně GUI regresí: 25/25; diskové
chování registry: 22/22. Pozitivní T4 integrační případy používají
explicitně syntetické odpovědi a izolované DB. Nepředstavují nezávislou
přejímku skutečného hodnoticího modelu.

Studio build prošel; frontend bundle SHA-256
`30e06c7fb5bd76bfeea2b19b72034bcfb178ef5142f43f892324e2fbdb7efb7d`.
Fyzický proklik sedmi záložek nezaznamenal renderer error ani neúspěšnou API
odpověď; negativní přejímka je navíc ověřena odděleně: nepřijatý hodnotitel
POST **409**, neautorizovaný GET **401**, viditelná hláška v Historii.
Další skutečné kliknutí na nový CODE test během obsazené GPU vrátilo
**409 / HUNT_ALREADY_RUNNING** a viditelnou chybu u modelu. Původní běh
pokračoval; požadavek není předstíraně zařazený do fronty.

Autorské orákulové sondy na čisté instalované revizi: CODE **62/62**, sedm
úloh / pět deklarovaných skupin; VISION **299/299**, 23 úloh / 22 obrazů.
Jde o kontrolu měřidla, ne přijetí relevance sad nebo počtu nezávislých
provozních případů. VISION boduje vytažené hodnoty, nikoli veškerou prózu
kolem nich. Registr validní: 530 programů (436 ACTIVE / 79 BLOCKED /
15 HISTORICAL); ostatní profily nejsou zahrnuté do výše uvedených 365 běhů.
Závislosti buildu byly převzaté z lokálního prostředí; instalace z prázdné
dependency cache na jiném stroji nebyla ověřena.

Neúspěšné vývojové pokusy zůstávají zachované: špatně složené argv nových
testů, nevhodný audit output root, chybějící toolchain environment,
změna HEAD během dřívějšího auditu, první build bez vnořených závislostí
a omylem zadaná neexistující cesta testu. Pozdější úspěšné kontroly je
nepřepisují. První GPU série na `790ceeeb` byla **CANCELLED**, protože nová
oprava přejímky musela projít skutečným měřením na finálním kódu.


### Výsledky v aplikaci, restart a zachování evidence

Po měření prošlo řazení CODE oběma směry, rozbalení výsledků úloh,
zobrazení všech tří otevřených odpovědí a detail konkrétního historického
běhu Devstralu. Původní čekání testu na run ID v `innerText` skončilo
časovým limitem: identita byla v zavřeném `<details>`. Následující kontrola
identitu rozbalila a ověřila i dokončené načtení úloh; zachovaný výsledek
`ui-history-loaded-final.json` tento rozdíl výslovně uvádí.

Backend byl po uvolnění GPU restartován z PID 239414 / portu 40561 na
PID 332432 / port 41825. Stejné otevřené Studio se připojilo a znovu načetlo
všech osm přesných run ID i skóre. První validační skript selhal při čtení
těla odpovědi z inspekční cache Chromium (`Request content was evicted
from inspector cache`), přestože HTTP bylo 200. Po zvětšení CDP bufferu
prošla kontrola ve stejném okně, bez dalšího restartu. Původní FAIL je
zachovaný v `backend-reconnect-final.json`, následný PASS v
`backend-reconnect-retry.json`. Backend běží s `NODE_ENV=production`;
testovací Electron používal výše přiznané diagnostické přepínače.

Kontrola proti podporované předinstalační záloze zachovala přesné řádky
všech **754 původních evaluací**, **234 rozhodnutí**, **7 požadovaných
bindingů**, **0 přejímek** a **0 provider operací**. `quick_check = ok`.
DB nyní obsahuje 1 002 evaluačních řádků. Přírůstek 248 není 248 nových
měření: sběr ukládá průběžné neměnné checkpointy (216 finálních pokusů,
27 pokusů z přerušené série), k nim pět výsledků deterministických sad
(tři finální, dva z přerušené série). Raw SQL u sběru používá `BLOCKED` s
`EVALUATION_AWAITING_REVIEW`; veřejný read model zobrazuje AWAITING_REVIEW.

**Výjimka ze shody celé DB:** starší `model_overrides` projekce při
`STARTUP_REHYDRATE` obnovila u sedmi rolí pouze `applied_at`. Původní
assertion úplné shody této tabulky selhala a je zaznamenaná. Následné
porovnání ověřilo nezměněný model, digest, operaci, předchozí model,
verifikaci, skóre a aktéra. Aktualizace provozního času se nezamlčuje jako
bitově nezměněná tabulka ani neinterpretuje jako nová volba modelu.

### Prostředky a konečný stav stroje

Sledování po 30 sekundách zachovalo 159 vzorků, z toho 140 od začátku
finální série. Nejnižší pozorovaná dostupná RAM **16,80 GiB**,
kořenový FS **186,52 GiB**, modelový FS **754,73 GiB**. Nejvyšší zaznamenané
cgroup `memory.peak` finální série **18,70 GiB**; `oom`, `oom_kill` i
`memory.max` události **0**. `memory.high` má **3 621** událostí, takže
měkké omezení paměti skutečně zasahovalo; není to tvrzení o běhu bez
paměťového tlaku. Host používal i swap. Vzorkování nezaručuje pozorování
každé krátké špičky a nedokazuje stav nesouvisejících procesů.

Závěrečný snapshot `2026-09-23T01:09:59Z`: GPU bez compute procesu,
Ollama bez rezidentního modelu, sidecar 11435 vypnutý, modelový FS přibližně
754,7 GiB volných, RAM přibližně 26,4 GiB dostupných. Dvanáct modelových
artefaktů zůstalo nainstalovaných. Hunt timer je **disabled/inactive**;
backend běží. Vlastní diagnostické Studio a hlídač prostředků byly
ukončeny, cizí aplikace nebyly zastavovány.

## Předání k revizi

[Strojový receipt](evidence/2026-09-23-hunt-grading-integration.json)
svazuje revizi runtime, konkrétní běhy, testy, stav DB a hash ověřeného
archivu. Soukromý evidence root:
`/mnt/vi7000/intentsmith/evidence/hunt-grading-20260923`.

- [Odpovědi k posouzení — 216 položek](/mnt/vi7000/intentsmith/evidence/hunt-grading-20260923/review/review.html):
  zadání, kritéria, odpověď, návrh známky a důvodu, lokální uložení a export.
  Exportovací UI bylo samostatně prokliknuté. Testovací známka z prokliku
  je označená synteticky a není součástí odevzdaných známek ani produkční DB.
- [CODE a VISION — 111 pokusů](/mnt/vi7000/intentsmith/evidence/hunt-grading-20260923/oracle-review.html):
  celé vstupy, odpovědi, obrazové úlohy, skutečné výsledky kontrol a chyby.
  Ověřeno načtení 22 obrázků, všech 37 řádků úloh ve třech bězích.
- `source.bundle` obsahuje přírůstek `a144c447..400c9d8f`; k obnovení je
  potřeba výchozí commit `a144c447`. Archiv obsahuje manifest s SHA každého
  souboru a všechny auditové výsledky včetně neúspěšných pokusů. Neobsahuje
  produkční DB, modelové váhy ani závislosti instalace.

Odstranění identity z review exportu z něj nedělá nezávislou přejímku:
je známo, že v této sérii otevřených odpovědí byl jediný kandidát. Archiv
navíc obsahuje oddělený soukromý klíč identit; není určený k veřejnému
publikování nebo k předání slepému hodnotiteli jako celek.

**K revizi je připravená nasazená integrace a doložený sběr pod dohledem.**
Plné autonomní GO nelze z tohoto předání schválit: vedle lidské arbitráže a
přejímky skutečného hodnotitele zbývá nový provozní holdout, výrobce úplných
ne-CODE workflow důkazů a pozitivní koncový průchod s přijatou evidencí.
Část těchto bodů je stále implementační práce, ne pouhý podpis operátora.
Změna verdiktu vyžaduje tyto konkrétní důkazy, nikoli úpravu konstanty nebo
přejmenování tohoto packetu na GO.
