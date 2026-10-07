# C6 — známá chatová regrese po C1/C3

**NO_GO: oba úplné nezávislé významové posudky jsou pod požadovanou kvalitou.**
Všechny tři neshody oba hodnotitelé vyřešili společným dodatkem; originály
obou posudků zůstávají uzamčené. Výsledek je118/159 (74,21%) užitečných,
24/159 (15,09%) zbytečných zastavení a0 kritických problémů. Deník: [WORK-PROGRESS](../WORK-PROGRESS.md).

Testovaný čistý zdroj `7ef8efbad9cb4ac78e60c0b29fc2f6f5e565e94c` obsahuje
C1 outage, C3 konkrétní otázku/pending operaci a další ROOT změny. Nejde o
izolovaný experiment příčinného vlivu samotného C3 ani přímé srovnání s jinak
hodnoceným historickým výsledkem123/159. Base a testovaný SHA jsou stejné;
navazující commit mění dokumentaci a Studio testovací ovladač, nikoli chatový produkt.

[Přesné příkazy, exity, série, modelová identita a SHA-256 důkazů](evidence/chat-regression-c3-20261007/result.json).
Původní runner, známý korpus53 případů i rubrika zůstaly beze změny. Tři série
7.10.2026 proběhly18:13:42–18:16:41,18:21:35–18:25:09 a18:25:58–18:29:45UTC;
každá53/53, exit0, bez retry a mezilehlého ladění či čtení odpovědí.
Gemma4:26b digest `08ae7ec1744bd7f451c4a530afb39d2673ad9d07a8369b8a33a3613b41212a68`,
4K; všech421 skutečných generování patří tomuto artefaktu. Žádné D1 volání.
Shodný configuration fingerprint všech tří sérií:
`1612badd851cf3b78babf804578ef3228d1ccb9064e7c09374f92d18f6f014f5`.

Nutná regrese vyžaduje≥95% užitečných,≤5% zbytečných zastavení,0 kritických
problémů ve3 nezměněných sériích. Každý reviewer samostatně přečetl všech159
B odpovědí v příslušném kontextu, bez primárních známek druhého. Technický
reviewer odděleně zkontroloval transport, identitu a efekty. Přímá odpověď A
slouží k diagnóze, do výsledku produktu se nezapočítává. 156/159 značek se
shodovalo; tři neshody vyřešili oba hodnotitelé, ROOT o známkách nerozhodoval.
Konsenzus SHA256 `ece4195e57ff1e873debef648a6d168cfe5f4eac501bcabba4673c2eb2093395`.

| Série | Užitečné | Zbytečná zastavení | Kritické |
| --- | --- | --- | --- |
| final-1 | 39/53 | 8/53 | 0 |
| final-2 | 40/53 | 7/53 | 0 |
| final-3 | 39/53 | 9/53 | 0 |

Ze41 neužitečných odpovědí vzniká21 již ve výstupu interpretu ukládání a20
v generování odpovědi. Je to první pozorované místo vady pod aplikačním promptem,
nikoli rozlišení vrozené schopnosti modelu od kvality promptu/kontextu. Rozpad
rodin a159 konečných značek je v JSON paketu. Největší skupinou je zbytečné
doptávání na již známé údaje ukládání. Kontrola dvou konkrétních chybných
interpretačních výstupů ukázala851/857 vstupních tokenů, úplný stop a4K profil;
nešlo v nich o vyčerpání kontextu.

Hodnoticí citlivost zůstává viditelná: šest Wi-Fi odpovědí nesplňuje výslovné
rozlišení Wi-Fi/upstream z původní rubriky; nejde o nově přidaný požadavek.
U záporného faktoriálu final3 vrací None místo dřívější ValueError: je přijatý
výslovný způsob odmítnutí, nikoli tvrzení o zachování typu výjimky. Jazykové
skupiny mají různé rodiny a počty, proto19,27p.b. český/anglický rozdíl není
izolovaný jazykový efekt; popisně rovněž překračuje stanovených5p.b.

Technické evidence review PASS_WITH_LIMITS: všech423 hash refs,698 raw HTTP
requests,421 úplných stop odpovědí (159A+262B). Vlastní kopie všech3 DB/WAL/SHM
mají integrity PASS. Ověřeno33 přesných schválení a efektů (12read,21write),
žádná předčasná změna či efekt. Oba významoví hodnotitelé navíc vykonali všech12
Python bloků. Tyto zelené kontroly nepřebíjejí nedostatečnou užitečnost odpovědí.

B warm n156: medián2218ms,p953798ms. Cold první B každé série n3:
medián15096ms. A warm n159: medián1247ms,p952368ms. B běží před A, chybí
randomizace, probíhala souběžná CPU příprava a původní runner nemá continuous
GPU/lifetime monitor; nejde o izolovaný performance benchmark ani čistou režii aplikace.

Final3 cleanup zůstává **FAIL**: po potvrzeném unload vznikl při inventáři
záznam zmizelého PID1359590, jehož identita je UNKNOWN. Nebyl ukončen cizí
proces ani zopakován unload. Samostatná nová leased postflight kontrola
následně naměřila3 prázdné vzorky a uvolnila lease. Dokládá pozdější připravenost,
nepřepisuje selhání úklidu. Collection-v2 opravuje jen chybný souhrnný klíč
fingerprint; původní COLLECTION.json i veškeré raw důkazy zůstávají.

Pravidlo stagnace platí okamžitě. Další změna musí vycházet z rozlišení vad
interpretu ukládání, generovaných odpovědí a hodnoticí rubriky. Bez kontrolovaného
srovnání se nebude tvrdit, že lokální model obecně nedosáhne95%, ani měnit
produkční binding. Nejbližší měřitelná varianta je porovnání kandidátů pro
konkrétní roli se stejným promptem, schema a4K, včetně zákazů a nejasných vstupů.

Toto je exponovaný regresní korpus. Staré příznaky `heldOut` z něj nedělají
H1/H2. H1 zůstává NOT_RUN, plaintext odstraněný; finální přejímka potřebuje
nový nezávislý H2. Reviewerovo opakování inference potřebuje nové sériové GPU
okno/lease a nový record, beze změny corpus/rubriky. Zakázané vstupy: H1/H2,
`restricted/` a jejich odpovědi. **Release NOT_ACCEPTED.**
