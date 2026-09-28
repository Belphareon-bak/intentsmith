# Místní hodnotitelé — skutečné porovnání deseti modelů

**28. 9. 2026 · EXPERIMENT_COMPLETE / RECOMMENDATION_WITHDRAWN_AFTER_REVIEW / ACCEPTANCE_NOT_GRANTED.**

Autorita: přímé zadání operátora vyzkoušet místní hodnotitele, vybrat dva nejlepší a měřit při polovičním příkonu. Toto je nové **hodnocení uložených odpovědí**; není to další sběr odpovědí modelů pro role ani přepis původních známek.

## Oprava doporučení po revizi

**Původní doporučení Devstral Small 2 + Qwen3.6 27B stahuji.** Ověřovací MAE proti dvěma posudkům bylo spočítané správně, ale nestačilo pro výběr: baseline „všemu 1“ má 13,12 p. b.; Devstral zachytí jen 1/18 nízkých kritérií. V ověřovací části nepřidá dvojici nic k samotnému Qwen3.6. Stažené je také doporučení Gemmy pro předběžné třídění. [Úplný přepočet všech dvojic a odchylek podle autora](2026-09-28-HUNT-LOCAL-JUDGES-REVISION.md).

Tento dokument dál uchovává původní naměřená čísla a omezení. Historický neměnný balíček obsahuje původní návrh; jeho `recommendation.json` je nyní **překonaný**, nikoli přijatá autorita. Žádné původní známky se nezměnily.

## Výsledky ověřovací části

Každý finalista dostal stejných **16 úplných rozhovorů z osmi dalších skupin**, v obou pořadích kritérií. Všechny měly platný první posudek. Tabulka zahrnuje i druhé pořadí, aby neschovávala neplatné výstupy.

| Hodnotitel | Odchylka od obou posudků, p. b. ↓ | Platná volání / 32 | Použitelné dvojice pořadí / 16 | Medián prvního posudku | Autorské kontroly |
|---|---:|---:|---:|---:|---:|
| **Devstral Small 2** | **10,96** | 30/32 | 14/16 | 21,0 s | 10/12 |
| **Qwen3.6 27B** | **11,30** | 32/32 | 15/16 | 15,0 s | 12/12 |
| Phi4 14B | 13,02 | 32/32 | 16/16 | 13,9 s | 10/12 |
| Gemma4 26B | 13,03 | 31/32 | 15/16 | 4,0 s | 12/12 |

Odchylka není procento správnosti. U každého kritéria počítám absolutní chybu vůči Codexovi a vůči Opusu zvlášť; průměruji **chyby**, nikoli jejich známky do nové „pravdy“. Primární metrika vynechává kritéria, kde se externí posudky rozcházejí o více než 0,25. Skupiny mají stejnou váhu. V ověřovací části zbývá 61 ze 64 kritérií. Původní známky, spory i všechny místní důvody zůstávají dostupné.

Použitelná dvojice zde znamená dva platné výstupy bez rozdílu jednotlivého kritéria nad 0,50 nebo neváženého průměru nad 0,15. Je to diagnostika tohoto experimentu; nepřebírá autoritu produkční přejímky s vlastními vahami.

### Proč nestačí vybrat dvě podobná průměrná skóre

| Dvojice, stejných 61 kritérií ověřovací části | Neshody mezi nimi nad 0,25 | Společné velké odchylky, které by shoda skryla |
|---|---:|---:|
| **Devstral + Qwen3.6** | 2 | **2** |
| Devstral + Phi4 | 1 | 4 |
| Devstral + Gemma4 | 1 | 4 |
| Phi4 + Gemma4 | 0 | 6 |
| Gemma4 + Qwen3.6 | 3 | 3 |
| Phi4 + Qwen3.6 | 3 | 3 |

„Skrytá odchylka“ znamená, že se dvojice shodne do 0,25, ale oba jsou o více než 0,25 mimo rozsah obou externích známek. Ne každá taková odchylka je kritická věcná chyba; část se týká měřítka komunikace. Ani externí posudky nejsou přijatá lidská pravda.

V úvodním kole daly Devstral a Phi4 společně vysoké skóre všem čtyřem kritériím, která obě reference hodnotily nejvýš 0,25. Devstral + Qwen3.6 společně přehlédly jedno z těchto čtyř. Qwenova dvě chybná nízká hodnocení výpočtu naopak s Devstralem vytvoří spor, který lze předat k revizi. Toto původně vedlo k návrhu dvojice, ale další přepočet jej vyvrací: na záchytu nízkých kritérií Devstral k Qwen3.6 nic nepřidal.

## Celý úvodní panel

Osm modelů dostalo společný vzorek: 24 CHAT dialogů z 12 skupin a osm D/R odpovědí; u osmi položek bylo prohozeno pořadí kritérií. Níže jsou platné první posudky; číselná odchylka se týká pouze CHAT. Neplatný posudek nemá nulu, má chybějící známku.

| Model | Platné první posudky / 32 | Odchylka CHAT, p. b. |
|---|---:|---:|
| Phi4 14B | 29/32 | 13,36 |
| Devstral Small 2 | 32/32 | 14,64 |
| Qwen3.6 27B | 32/32 | 15,35 |
| Gemma4 26B | 31/32 | 15,92 |
| Qwen3 14B | 21/32 | 16,79 |
| Qwen3 Coder | 29/32 | 17,44 |
| Qwen3 30B A3B | 30/32 | 37,82 |
| Ornith 1.5 9B | 8/32 | 39,61 |

Chyba Phi4 je podmíněná platnými výstupy; vynechala i oba časové dialogy. Na shodných platných kritériích je její náskok proti Devstralu jen přibližně **0,31 p. b.**, nikoli rozdíl průměrů celé tabulky. Tři ze čtyř neplatných volání Phi4 měly jen nadbytečná pole JSON, jedno chybný počet kritérií. U Devstralu jsou obě neplatná obrácená volání ve druhém kole také pouze nadbytečná pole. Tyto integrační vady odděluje `format-diagnostic.json` od zkrácení, chybějících kritérií a výslovného odmítnutí hodnotit. Známky se dodatečnou opravou parseru nepřepisovaly. Přesný tvar polí vyžaduje i současný parser konverzačního hodnotitele v `semantic-evaluation-judge.js`.

**Dva další modely měly jiný vzorek kvůli zákazu sebehodnocení:** Qwen3.5 27B má 16/16 platných prvních posudků a odchylku 11,86 p. b.; Qwen3.8 má 16/16 a 17,66 p. b. Tyto hodnoty nepatří do společného žebříčku výše. Na shodných odpovědích má Qwen3.6 proti Qwen3.5 o 1,04 p. b. menší odchylku; Devstral proti Qwen3.8 o 3,44 p. b. menší. Úplná párová srovnání jsou v JSON. Dva starší modely LLaVA nebyly způsobilé pro společný kontext 16 384 tokenů.

Kontrolní baseline „všemu dát 1“ má v prvním kole chybu 16,69 p. b. a přehlédne všechna čtyři nízká referenční kritéria. To ukazuje, proč samotný průměr nestačí a proč číslo 13–16 p. b. nesmí být přepsáno na „84–87% spolehlivost“.

## Konkrétní vady k revizi

1. **Společné přehlédnutí ve druhém kole:** `cbe3be1e3352a9e1cb808ca1`, kritérium 1, příčina versus korelace. Devstral i Qwen3.6 citují správné varování z prvního tahu a dávají 1. Ve finální zprávě ale model tvrdí, že růst objednávek způsobila výhradně reklama; data takové příčinné přiřazení nedokládají. Reference: 0,25 a 0,50. To je doložená věcná chyba dvojice, ne pouze spor o styl.
2. **Společné přehlédnutí v prvním kole:** `b678168505e9a2782b216d9d`, kritérium 1. Oba dávají 1 za odpověď s „Friday, September 28, 2026“ a domyšlenou frontendovou architekturou. Datum je pondělí a zadání technologie neuvádí. Obě reference: 0,25.
3. **Vnitřně rozporný Qwen3.6:** `26d801fc338b74b4fe25c77d` a `e30a5913c5e02c466052a78a`, kritérium 3. Pole skóre je 0, vysvětlení samo dopočítá 225/30 zaokrouhlené nahoru na osm a skončí „Score 1.0“. Obě reference: 0,75. V příslušné dvojici s Devstralem jde o viditelný spor.
4. **Gemma4 a Phi4 opakují stejnou chybu:** `5bdaa71afcd622219c3aef5d`, kritérium 1. Citují „Tím tím myslíš Janu“, ale tvrdí, že odpověď nepředstírá znalost příjemce, a dávají 1. Devstral dává 0; reference obě 0,25. Různé rodiny modelů samy nezaručují nezávislé chyby.
5. **Kontrola skutečného kódu:** Devstral ohodnotil chybnou odpověď k `.filter().map()` hodnotou 0,75, Phi4 hodnotou 1. Funkce ve skutečnosti vrací `[1,1,2]`, nikoli `[1,2]`; doloženo také spuštěním Node. Qwen3.6 a Gemma4 chybnou odpověď odmítly. Devstral se proto nesmí z tohoto reportu převést na přijatého hodnotitele technických rolí.

Autorské kontroly mají čtyři skupiny: vážený průměr, pořadí `filter/map`, explicitní zákaz zveřejnění tokenu a chybné finální schválení release. Každá má správnou odpověď, správnou alternativu a chybnou odpověď. Devstral i Phi4 kromě kódu také srazily správnou ekvivalentní variantu váženého průměru na 0,75. Jde o kontroly napsané Codexem během prvního kola a zmrazené před druhým kolem, **nikoli nezávislou přejímku**. Výsledky nejsou zamlčené ani zahrnuté do stejného průměru jako známky rozhovorů.

## Co bylo skutečně změřeno

- **10 místních hodnotitelů**, čtyři modelové rodiny. Ornith je podle artefaktových metadat ve skupině Qwen, ne samostatná rodina.
- **48 různých uložených odpovědí:** 40 CHAT dialogů ve 20 skupinách a osm D/R odpovědí. U každé CHAT skupiny je vybrána jedna jazyková varianta, střídavě CS/EN, a oba autoři. Nejde o opětovné oznámkování všech 80 dialogů všemi deseti modely.
- **360 + 128 + 48 = 536 zachycených volání** v experimentu. Další dvě žádosti byly přerušené infrastrukturou a zůstávají v samostatném archivu. Po opravě sběrače proběhla ještě čtyři skutečná kontrolní volání mimo pořadí. Celkem **542 žádostí**.
- Samotný experiment má 482 platných a 54 neplatných odpovědí hodnotitelů. Neplatnost neznamená nulu za kvalitu hodnoceného modelu.
- Při všech zachycených voláních byl před a po volání ověřen limit **175 W**. Uživatel nastavil polovinu výchozích 350 W; napětí se neměnilo.
- Shodný hodnoticí profil: kontext 16 384, výstup nejvýše 2 048 tokenů, `temperature:0`, `top_p:1`, `think:false`, JSON, timeout pět minut, poskytovatel `0.34.2-intentsmith.1`. Maximální naměřený vstup byl 8 912 tokenů.
- Každý požadavek obsahuje úplné zadání, odpověď a stejnou rubriku. Neobsahuje přidané jméno autora, digest ani naše známky/důvody. Přesná shoda digestu autora s hodnotitelem znamená vynechání. Obsah odpovědi může sám autora naznačit; absolutní zaslepení stylu tím neslibuji.

D/R jsou **jediný historický případ `model_cleanup`** se čtyřmi různými rolemi. Nedokládají schopnost hodnotit celé sady D1/D2/R1/R2. CHAT pochází pouze z opraveného sběru 27. 9.; zdrojové poskytovatele CHAT a D/R neslučuji do jedné role. CODE orákula ani obrazové hodnocení VISION tento pokus nenahrazuje.

Ověřovací skupiny byly oddělené před inferencí. Reference jsou dva skutečné externí LLM posudky s přiznanou expozicí, nikoli přijatá lidská kotva. Zde se nepřijímá místní hodnotitel pro jiný prompt, profil nebo roli. **Doporučení dvojice je po revizi stažené; produkční přejímka zůstává otevřená.**

## Provozní opravy a reprodukce

První přerušení způsobilo uspání stroje 01:00–07:37; druhé spuštění cizího modelu na hlavním Ollama a pokles rezervy RAM. Sběr se zastavil, cizí proces se neukončoval. Zůstalo zachováno nejprve 145 a později 336 hotových odpovědí s totožnými SHA. Opakovaly se jen dvě přerušené žádosti, se stejným zadáním a profilem. Čas zahrnující spánek není započítán do rychlosti modelu.

Přerušení odhalila chybu finalizace tohoto nového sběrače: selhání `provider.close()` mohlo zabránit zápisu konečného stavu. Oprava nyní uloží `BLOCKED` i oba důvody selhání a uvolní zámek. Obnovení odmítá samotnou odpověď bez odpovídajícího záznamu kontroly prostředí po volání. Test CLI ověřuje odmítnutí před jakýmkoli přístupem ke GPU.

Měřené zdroje jsou zachované v `source/` a jejich SHA v původním plánu; výchozí revize byla `d6de790f`, nové skripty při zmrazení ještě nebyly commitnuté. **Následná provozní oprava je commit `73659669`**, nemění prompt, parser známek ani nastavení inference. Na tomto commitu proběhl skutečný smoke 4/4 dokončených volání. Jeho známky nevstupují do pořadí; zachovává i nesprávný posudek kontrolní odpovědi.

Ověření finálního kódu: **192 cílených testů** (semantic 26 + stage provider 6 + artifact validation 160), **5 kontrol v prohlížeči**, registr **542 programů**. Nejde o úplný release audit ani nasazení.

Balíček: `/mnt/vi7000/intentsmith/evidence/hunt-local-judges-20260928/`.

- [Úvodní porovnání — zadání, odpověď, tři známky a důvod](</mnt/vi7000/intentsmith/evidence/hunt-local-judges-20260928/screen-comparison.html>)
- [Ověřovací část stejným způsobem](</mnt/vi7000/intentsmith/evidence/hunt-local-judges-20260928/confirm-comparison.html>)
- [Kontroly a jednotlivá odůvodnění](</mnt/vi7000/intentsmith/evidence/hunt-local-judges-20260928/controls-analysis.json>)
- [Audit všech požadavků, identity, 175 W a zachování zdrojů](</mnt/vi7000/intentsmith/evidence/hunt-local-judges-20260928/capture-audit.json>)
- [Návrh dvojice s přesnými artefakty, bez rozhodovací autority](</mnt/vi7000/intentsmith/evidence/hunt-local-judges-20260928/recommendation.json>)

Hlavní plán SHA256: `18a76e45bdcb4e3c7ed69075be18835dc4b11a125e5d39189df92e08577512ea`. Příkazy k opětovnému výpočtu jsou v README balíčku; žádná nová inference pro přepočet není nutná.
