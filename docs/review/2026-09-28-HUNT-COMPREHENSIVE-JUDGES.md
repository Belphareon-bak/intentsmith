# Rozšířené hodnocení místních hodnotitelů

28. 9. 2026 · **PREPARED_NOT_RUN / POWER_BLOCKED / NO_GO**

## Aktuální pořadí po připomínkách operátora

Plán 1 375 volání níže je zachovaný nespuštěný podklad. **Nespouští se rovnou.**
Nová příprava je v `/mnt/vi7000/intentsmith/evidence/hunt-judge-pilot-20260928/`;
její plány a receipts se se starým experimentem nemíchají.

1. **Krátký pilot:** 16 celých CHAT dialogů, čtyři skupiny se souhlasně nízkými
   kritérii, vždy oba autoři a oba jazyky. Skupiny se vybírají pouze ze screening
   části podle počtu nízkých kritérií; shodu pořadí rozhoduje pevný SHA klíč.
   Gemma4, Devstral a Phi4: 48 volání, nejvýš hodina a 98 304 výstupních tokenů.
   V každém modelu je 11 nízkých kritérií. Potřebuje zachytit nejméně 6/11,
   mít nejméně 90 % platných kritérií a neprávem odmítnout nejvýš 10 % vysokých.
   Pilot musí být úplný. Neplatná známka se nepočítá jako zachycená chyba.
2. **Samostatný pilot nových rodin:** Selene Mini (Llama) a Granite, tentýž
   vzorek, samostatný plán 32 volání a hodinová stopka. Stažení není přejímka.
   Selene je specializovaný hodnotitel; výrobce češtinu mezi podporovanými
   jazyky neuvádí. Granite má češtinu doloženou, ale hodnoticí schopnost se
   teprve změří. Zdroje: [Atla](https://huggingface.co/AtlaAI/Selene-1-Mini-Llama-3.1-8B),
   [IBM](https://huggingface.co/ibm-granite/granite-4.0-h-small).
3. **Zastavení nebo další vývoj:** pokud žádný kandidát pilotu neprojde,
   velký CHAT se nespustí. Neúspěšný kandidát nesmí do rozšíření ani tehdy,
   když prošel jiný. Jedna úspěšná rodina ještě nevytváří nezávislou dvojici.
   Nový prompt dostane nový plán; žádné opravné přepsání receipts. Potvrzovací
   část zůstává při ladění nepoužitá. Maximálně tři vývojové verze pilotu,
   potom revize příčiny, nikoli další ladění až do vynuceného úspěchu.

`evidence-first.3` doplňuje kontrolu výslovně napsané číselné známky proti
poli `score`. Například pole 0 a závěr „Score 1.0“ posudek zneplatní. Citace
ve dvojitých uvozovkách/backticku a běžné výpočty nejsou známky hodnotitele.
Jde o omezenou syntaktickou kontrolu, **ne přejatý extraktor významu prózy**:
rozpor bez výslovného číselného verdiktu musí zachytit obsahová přejímka.
Interpretace archivovaných profilů `.1` a `.2` se nemění.

**Filtr odchylky podle autora:** vývojová CHAT nominace má navíc mez 2 p. b.
pro rozdíl chyb qwen3.8 − qwen3.5 vůči každé referenci zvlášť. Předem se vyberou
shodné úlohy a kritéria, u nichž se reference u obou autorů liší nejvýš o 25 p. b.;
skupiny mají stejnou váhu. Nutných je alespoň 15 skupin úplných párových známek.
Filtr se uplatní na celý rozšířený CHAT, ne na záměrně obtížný pilot. Chybějící
párové známky blokují výběr; pokud reference vyžadují neslučitelné meze,
výsledkem je `AUTHOR_GAP_REFERENCE_ARBITRATION_REQUIRED`. Práh se při výsledku
neuvolňuje. Je to popisná odchylka, nikoli důkaz příčinného zvýhodňování rodiny.

Rozšíření ověřuje SHA pilotu, skutečné receipts, jejich výstupy a prostředí,
identitu modelů, stejný prompt/profil i nezměněné zadání, rubriku a reference.
Uložený příznak PASS samo o sobě nepřijme. Modely Qwen zůstávají z hodnocení
skutečného CHATu vyloučené. Nové modely vyžadují vlastní pilot s přesným digestem.

Ověření této úpravy: **35/35 semantic-evaluation, 6/6 collection-stage-provider,
160/160 artifact-validation**, registr 542 programů. První kontrola census
zachytila chybnou interpunkci v SYSTEM-MAP; oprava i původní FAIL mají log.
To jsou testy nástrojů, nikoli inference nebo kvalifikace modelů.

## Původní širší plán (před pilotní revizí)

Tento dokument popisuje nový experiment, nikoli výsledky nových inferencí.
Původních 536 posudků ani jejich stažené doporučení se nepřejmenovávají na
nový běh. Předchozí nespuštěný návrh 204 volání nahrazuje širší plán níže.
Produkční přejímky, bindingy a modely se nemění.

## Rozsah a původ reference

| Podklad | Úplné odpovědi | Kritéria | Oba posudky ≤ 50 % | Oba posudky ≥ 75 % |
|---|---:|---:|---:|---:|
| CHAT s opravenou historií, 27. 9. | 80 | 320 | 36 | 243 |
| D/R, sedm historických případů | 91 | 245 | 78 | 93 |
| Opravený `model_cleanup` v6 | 8 | 22 | 7 | 9 |
| Konstrukční kontroly | 60 | 96 | 48 | 48 |

Celkem **239 odpovědí, 683 kritérií**, z toho **179 skutečných odpovědí a
121 skutečných nízkých kritérií**. CHAT zahrnuje všechny české i anglické
varianty současného dvoumodelového sběru. D/R zahrnuje první opakování každé
kombinace dostupný autor × role × případ. Výběr opakování 1 je pevný, ne
podle známky. Další opakování nepřidává nezávislý historický případ.

Vadný starý `model_cleanup` je vyloučen celý; jeho nová verze je samostatný
podklad. Její jediný historický případ je diagnostika, nikoli další plná
přejímka čtyř rolí. Soubory s původními známkami se nemění. U každé odpovědi
zůstává SHA zdrojového balíčku, přesný model, oba původní posudky i důvody.

Reference nejsou rozsouzená lidská pravda: jsou to dva externí LLM posudky
s přiznanou expozicí. Ve skutečných odpovědích zbývá 48 kritérií se sporem
nad 25 p. b.; nepatří do hlavního MAE. Ani shoda obou neprokazuje správnost.
Výsledky místních modelů poslouží k posouzení kandidátů, ne k přijetí profilu.

## Kandidáti a výluky

Do společného profilu vstupuje deset instalovaných modelů: Gemma4 26B,
Devstral Small 2, Phi4 14B, Qwen3.6 27B, Ornith 1.5 9B, Qwen3 Coder,
Qwen3 14B, Qwen3 30B A3B, Qwen3.8 a Qwen3.5 27B. Přesné digesty jsou v plánu.
Dva instalované LLaVA modely mají nativní kontext 8 192 a 4 096 tokenů;
do společného profilu 16 384 nevstupují. Kontext odpovědi se nezkracuje,
aby se model uměle vešel.

Předem naplánováno **1 375 volání** včetně 12 případů s obráceným pořadím
kritérií (jen pro způsobilé hodnotitele). Rodinně příbuzná hodnocení se
explicitně označují `RELATED_AUTHOR_FAMILY`, vlastní artefakt `SELF_ARTIFACT`.
Nejsou to chybějící známky ani nuly autorovi.

Oba autoři skutečného CHATu jsou Qwen. Proto sedm Qwen/Ornith hodnotitelů
nemá v tomto podkladu způsobilé skutečné CHAT odpovědi. Hodnotí skutečné D/R
odpovědi jiných rodin a konstrukční kontroly. Z těchto kontrol jim nelze
udělit CHAT kvalifikaci. Stejná výluka platí pro Gemmu a Devstral u jejich
vlastní rodiny. Různé rozsahy způsobilosti se nesmějí seřadit v jednom žebříčku.

## Co změříme

1. Záchyt kritérií, která **obě reference** hodnotí nejvýš 50 %, s neplatnými
   výstupy ve jmenovateli a současně uvedenými zvlášť.
2. Nesprávné odmítnutí kritérií, kde obě reference dávají nejméně 75 %;
   zvlášť přijetí vážných chyb vysokou známkou.
3. MAE vůči každému posudku, stejně vážené skupiny, srovnání s konstantními
   hodnotiteli 100 %, 75 % a 50 %. Průměr dvou vzdáleností nevytváří novou známku.
4. Všechny dvojice na stejných způsobilých odpovědích: co zachytí jen první,
   jen druhý a oba přehlédnou. Rodiny dvojice jsou uvedené.
5. Odchylky podle autora, částí sady, role a jazyka; nestabilita po otočení
   kritérií, neplatné výstupy a úplné důvody známek.

Nový prompt žádá důkaz před číslem a kontrolu celé odpovědi včetně závěru.
Všem modelům se předává stejné úplné zadání, rubrika a odpověď. Identity,
referenční známky ani označení variant správná/chybná do požadavku nevstupují.
Zdrojový text ovšem může obsahovat modelová jména; nelze garantovat jeho
nepoznatelnost. Parser ověří strukturu a pořadí polí, nikoli správnost důvodu.

Šedesát konstrukčních odpovědí tvoří 24 šablon. Příbuzné šablony se sdružují
pod zdrojovou vadu, výsledkem je **21 skupin**. Dvanáct šablon má správnou,
částečnou a chybnou variantu se dvěma oddělenými kritérii. Jejich technická
fakta jsou doložená 12 spustitelnými programy. Očekávané známky kontrol mají
jediného exponovaného autora; nejsou to dva nezávislé posudky.

CHAT má předem rozdělených 13/7 skupin, historické D/R 4/3 a kontroly 14/7.
Jazyky, autoři, varianty a opakování téhož případu nesmějí přejít mezi částmi.
Obě části zůstávají známým vývojovým materiálem, nikoli čerstvým holdoutem.
Profil ani rozdělení se po prvním volání nemění.

Předem navržený filtr vývojové nominace: nejméně 95 % platných kritérií,
záchyt nízkých nejméně 70 %, falešné odmítnutí vysokých nejvýš 10 % a MAE
lepší než „všemu 100 %“ v obou částech; v každé nejméně pět nízkých kritérií
ve třech skupinách. Je to pracovní filtr k revizi, **ne produkční přejímka**.
U dvojice musí každý přidat záchyt skutečné chyby na společném podkladu a
musí jít o různé rodiny. Nevyhovující dvojici nevybereme jen proto, že jsou
požadována dvě jména. CODE a deterministický VISION se dál hodnotí orákuly.

## Provedení a předání

Evidence: `/mnt/vi7000/intentsmith/evidence/hunt-judge-comprehensive-20260928/`.
Autoritativní nový plán a receipts budou pouze v `experiment/`; kontrolní
vývojové přípravy nemají žádné inference. Report se vytváří do samostatného
adresáře, kontroluje SHA celých vstupů, skutečný prompt každého volání,
artefakt, umístění na GPU a přepočítá známku z původního výstupu hodnotitele.
Upravená pomocná kopie `parsed` nemůže změnit report bez detekce.

Rozpočet: 1 375 volání, nejvýš 12 hodin aktivního běhu a 2 816 000 výstupních
tokenů. Jde o horní meze, nikoli změřenou ETA. Každé volání má limit 300 s;
naivní součet timeoutů je 114,6 hodiny, takže stopka může vytvořit částečný
checkpoint. Zbývající volání zůstanou viditelná. Uříznutý posudek není známka.
Průběh ukazuje model, úlohu, počet hotových volání a odhad ze skutečných časů.

Aktuálně je GPU nastavena na **250 W**, poslední schválený limit tohoto
experimentu je **175 W**. Operátor má otevřenou otázku na obnovení 175 W
nebo použití 250 W. Žádná nová inference při 250 W neproběhla. Nedostupnost
změny příkonu bez hesla správce je skutečnou překážkou spuštění, ne výsledkem
hodnotitelů. Předchozí souhlas s inferencí se znovu nevyžaduje.

## Ověření přípravy

- `semantic-evaluation`: **32/32**, včetně skutečného spuštění všech 12 nových technických kontrol, rodinných výluk a detekce změněné uložené známky.
- `collection-stage-provider`: **6/6**, včetně rezerv RAM/FS a vlastnictví GPU.
- `artifact-validation`: **160/160**, registr **542 programů**. První běh zachytil chybnou interpunkci nového řádku census v SYSTEM-MAP; oprava je ověřená druhým během a oba logy zůstávají.
- Celkem **198 testů**, nikoli 198 měření modelů.
- Příprava nad skutečnými zdroji, sestavení celé matice způsobilosti, ověření 0/1 375 receipts a generování prohlížeče proběhly bez inference. JavaScript výsledného HTML prošel syntaktickou kontrolou.
