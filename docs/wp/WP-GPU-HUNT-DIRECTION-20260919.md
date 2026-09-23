# Směr GPU huntu k funkčnímu celku

**Stav:** DIRECTION_SET / PILOT_IN_PROGRESS / NOT_DEPLOYED.
Autorita: rozhodnutí operátora z 19. 9. 2026 po dvou nezávislých revizích
(GPT-návrh, Opus-review) a po doloženém NO-GO
[závěrečného měření](../review/2026-09-19-GPU-HUNT-FINAL-REVIEW.md).

Navazuje na [kontrakt](WP-GPU-HUNT-EVALUATION-CONTRACT-20260918.md) a nemění
jeho §§2–8. Doplňuje rozhodovací pravidla, která kontraktu dosud chyběla,
a stanoví pořadí prací. Není to přijetí implementace.

## 0. Co je dnes prokázané

Ověřeno nezávisle ve dvou revizích proti uloženým záznamům, bez nové inference:

- D1/D2/R1/R2 má **96 pokusů**: 40 s platným hodnocením dokončené odpovědi,
  **29 s vyčerpaným výstupním limitem**, **27 s neplatným hodnocením**.
- Neplatná hodnocení celé série (31): `SEMANTIC_ORDER_UNSTABLE` 19,
  `SEMANTIC_JUDGE_NOT_QUALIFIED` 11, `SEMANTIC_REFERENCE_REJECTED` 1.
  V D1/D2/R1/R2 je 15 z nich nestabilita pořadí, koncentrovaná v D2 (10) a R2 (5).
- Ze 40 platných má **32 přesně 1,0** a **4 přesně 0,0**. Čtyři mezihodnoty
  jsou vázané na neshodu alespoň v jednom kritériu mezi pořadími.
  **Neplatí, že mezihodnota vznikla zprůměrováním neshody**: u
  `r2_model_cleanup` r2 dává každé pořadí samostatně 8/9 = 88,89 %.
- D1: **18 z 24 pokusů (75 %)** skončilo `MODEL_OUTPUT_BUDGET_EXHAUSTED`
  při `outputTokenBudget: 2048`, `contentScoreEvaluated: false`.
- VISION: průměr 84,62 %, ale **27/39 obsahově zcela správně**, 30/39 nad
  prahem a jen **6/39 splnilo `strictJson`**; 33 odpovědí přišlo v Markdownovém
  obalu. Věcné chyby ověřené proti obrázkům: 101 místo 121, cesta za 8 místo
  minima 5, doklad 212,80 místo 205,20.
- Opravná smyčka má dvě doložené vady vstupu, ne modelu: u `search-report`
  dostal model z `cre-decision.js` jen řádky 555–685 bez rozhodovací funkce,
  kterou měl opravit; u `optional-legacy-table` skončila čitelná chyba
  `SqliteError: no such table` jako `TEST_OUTPUT_UNRECOGNIZED` s
  `recoverable: false` po jediné iteraci.
- Produkční `ROLE_SUITE_NAMES` stále mapuje D1/D2/R1 na `reasoning_v2`
  a CHAT na `chat_v3`, tedy na substringové známkování. Zákaz T5 podle §2
  není v produkční cestě uzavřený.

## 1. Rozhodovací pravidla — uzamčená operátorem

Tato čtyři pravidla platí pro všechny budoucí rubriky a hodnocení. Body se
vždy přiřazují ke **konkrétnímu kritériu**, nikdy k dojmu z odpovědi.

### 1.1 Viditelná sebeoprava

Sebeoprava **sama o sobě se netrestá**. Model, který chybnou hypotézu jasně
zavrhne a dodá jednoznačný správný závěr, není horší než model, který svůj
omyl neukáže.

Srážka se uděluje jen za doložitelnou vadu odevzdaného výstupu a vždy proti
pojmenovanému kritériu: přetrvávající rozpor, nepodložené tvrzení, porušení
výslovně zadané hranice nebo nejednoznačný závěr. Srážka je **malá, řádově
jednotky procent** — rozhoduje správnost odpovědi.

Hodnotí se to, co role skutečně předává dál. Odděluje-li runtime pracovní
uvažování od finální odpovědi, obsahový hodnotitel dostane finální odpověď.

### 1.2 Vlastnost, která z odpovědi plyne, ale není v ní napsaná

| Co kritérium požaduje | Hodnocení |
|---|---|
| chování se zachová | plný bod, doloží-li to kód nebo test, i bez slovního zopakování |
| odpověď vysvětlí, proč se chování zachová | samotný správný kód nestačí |
| hodnotitel pouze předpokládá, že by se chování zachovalo | **0,25**, ne plný a ne půl |

Půl bodu znamená **částečné splnění kritéria, ne nejistotu hodnotitele**.
Každý přiznaný bod musí mít konkrétní oporu v textu, kódu nebo testu.
Nedoložená vlastnost se nedomýšlí.

### 1.3 Věcně chybná odpověď proti nedodané odpovědi

| Situace | Skóre |
|---|---|
| nic nedodáno, ozvěna zadání, výčet klíčových slov | **0** |
| poctivý pokus s kritickou věcnou chybou | **0,25** |

Kritická věcná chyba **smí zablokovat úspěch úlohy**. Nesmí ale smazat
informaci o tom, co se stalo: stav a důvod neúspěchu zůstávají zaznamenané
odděleně. Nezávisle správné dílčí části se hodnotí, pokud je rubrika měří.
Body se nepřidělují za délku, úsilí ani profesionální strukturu.

### 1.4 Způsobilost modelu pro roli

**Model pod 50 % v roli je pro tu roli nevhodný.** Nehledá se stoprocentní
model, hledá se optimální model pro roli.

Jsou-li sady příliš přísné, **opraví se sady**, ne prahy pro jeden model —
a oprava se musí potvrdit opakovaně, ne jediným během.

Z toho plyne okamžitý důsledek pro D1: při 75 % vyhoření na 2 048 tokenech
se neměří analýza, ale vejití se do limitu. Před dalším měřením D1 se musí
rozhodnout, zda 2 048 odpovídá provoznímu profilu role. Pokud ano, model v něm
musí dokončovat; pokud ne, mění se profil **pro všechny porovnávané modely**,
nikdy výjimkou pro jeden.

## 2. Co odlišuje funkční hunt od dnešního stavu

Hunt je funkční, když u jedné role dokáže projít celou cestou: vzít kandidáta,
změřit ho v definovaném profilu a vydat **obhájitelný verdikt** — vyměnit,
ponechat, nebo nerozhodnuto — s doloženým důvodem u každého bodu.

Neznamená to jemnější stupnici. **Binární známka není vada**, měří-li kritérium
splnění konkrétního požadavku; dvě vyhovující odpovědi mohou oprávněně dostat
shodně plný počet. Cílem není pestřejší rozložení, ale aby každé číslo mělo
jasný význam a každý bod důkaz.

Platí ale zároveň: sada, která nerozlišuje mezi kandidáty, **nemůže
autorizovat výběr**. Správný výstup je pak `NEROZHODNUTO`, ne dopočítané pořadí.

## 3. Pořadí prací — tři nekonkurující větve

### Větev A — kód, bez GPU

1. **Sestavení kontextu opravné smyčky.** Dodat relevantní funkci a okolí,
   případně umožnit dočtení. Neprodlužovat běh nad stejným neúplným vstupem.
2. **Předání diagnostiky.** Zpracovat `SqliteError` a podobné čitelné výpisy;
   původní stderr bezpečně předat do další iterace v rámci zbývajícího
   rozpočtu. Nerozpoznaný formát výpisu není důkaz neopravitelnosti.
3. **Uzavřít T5 v produkční cestě.** Přemapovat D1/D2/R1 a CHAT; `measurementReady`
   musí odmítat podle úrovně hodnotitele.
4. **Rozhodnout profil D1** podle §1.4.
5. **Doplnit export** o tři věci: přesný vstup modelu (co model skutečně
   dostal, odděleně od toho, co úloha ověřuje), důvod ztráty bodů na úrovni
   konkrétní kontroly (u T1 název testu, očekáváno, skutečnost, výpis;
   u T4 kritérium a obě pořadí vedle sebe) a oddělené filtry
   „chybná odpověď“ / „vyčerpán limit“ / „neplatné hodnocení“.
6. **Vyjasnit kontrakt `patch_f63d14d5eb61`**: typ a výčet hodnot pole
   `confidence`. Body se nepřidělují automaticky; zadání ale musí být
   jednoznačné a chyba musí ukázat konkrétní assertion.

### Větev B — měřítko, bez GPU

Dooznámkovat uložené odpovědi podle pravidel §1. Rozsah zahrnuje i **27
neplatně hodnocených pokusů** D1/D2/R1/R2 a čtyři mimo platných 116 u CHAT —
neplatná původní známka neznamená nehodnotitelnou odpověď; právě tam je vidět,
kde hodnotitel selhává.

U každé odchylky se rozliší:

- **chyba známkování podle existující rubriky** → oprava známky s důkazem;
- **nejasná nebo nedostatečná rubrika** → návrh upřesnění a nová verze,
  nevydává se za opravu starého hodnotitele;
- **vlastnost, kterou rubrika úmyslně neměří** → žádná zpětná penalizace.

Původní známky zůstávají; nové se připojují s odůvodněním. Ladicí a přejímací
část se dělí **po scénářích nebo skupinách**, ne rozdělením opakování téže úlohy.

Tyto známky jsou **druhý odborný názor, ne lidská referenční pravda**.
U sporných technických vlastností se verdikt opírá o kód nebo reprodukci,
u významu kritérií o schválená pravidla §1.

### Větev C — operátor

Rozsoudit vzorek sporných případů vybraný podle nejnižší jistoty anotátora.
To je jediný krok, který nikdo jiný neudělá, a je to kotva pro celou větev B.

## 4. Brána, která hunt zapíná

`decisionReady` přestane být literál a **odvodí se** z uložené evidence
přejímky pro konkrétní `suiteContractSha256`: prošlá přejímka hodnotitele
podle §3 kontraktu a přijatá párová provozní kvalifikace podle §8 kroku 5.
Dokud takový záznam neexistuje, hodnota vyjde `false`, protože se nedá spočítat
jinak.

Do té doby platí beze změny: timer vypnutý, žádné automatické mazání, žádná
změna vazby, rychlý profil bez autority nad vazbou i mazáním.

## 5. Co se teď nedělá

- Nepřidávat další modely, dokud neběží oprava sestavení kontextu — nové
  měření by zdědilo tutéž vadu. Pro **benchmarkové role** to omezení neplatí,
  jejich zadání jsou samonosná.
- Nehonit jemnější stupnici a nepřidávat půlbody za snahu.
- Nepoužívat osm vyčerpaných vývojových případů jako nezávislý holdout.
- Nezvyšovat toleranci neshody jen proto, aby zmizely prázdné výsledky.
- Nestavět nový reportovací systém; potřebná struktura v exportu existuje.

## 6. Definice hotova pro první doložený průchod

> U jedné role umíme na konkrétních správných a chybných výstupech doložit,
> že hodnocení funguje, a na jeho základě obhájit výběr modelu — nebo jasně
> ukázat, proč zatím nelze rozhodnout.

Za úspěch se nepovažuje počet nových testů ani hotová infrastruktura.

## 7. Doplnění rozhodovacího zadání po review 23. 9. 2026

Operátor přijal pořadí **rozhodovací pravidlo → audit orákul → práce nad
uloženými daty → rozhodnutí o nutném novém sběru → oddělená přejímka**.
Nový CHAT panel má samostatný rozpočet a vlastní GO; souhlas s offline
opravami není souhlasem s přesběrem. Kontrakt z 18. 9. se tím nemění.

### 7.1 Rozhodovací návrh — vyžaduje finální uzamčení před měřením

Pro CHAT je návrhem dolní mez 95% párového intervalu zlepšení přijaté
konverzační rubriky **nad 0,04**, při toleranci zhoršení faktické správnosti
a provozní dokončenosti **0,02**. Tolerance je výchozí návrh k revizi,
nikoli již nasazený parametr. Kontroly se vykazují také zvlášť pro CZ a EN.
Přesnou rubriku, váhy, metodu a společné pokrytí intervalů pro více podmínek,
rozsah, opakování a maximální rozpočet je nutné uzamknout jako jeden celek.
Tento odstavec sám není úplný rozhodovací profil podle §6 kontraktu.

U CODE zůstává hlavním provozním měřítkem dokončení celé úlohy v rozpočtu,
bez opravné pomoci člověka a se splněnými přejímacími a regresními kontrolami.
Pro ostatní role musí profil uvést příslušný celý provozní výstup; samotný
průměr historických dílčích známek není náhradou tohoto ověření.

### 7.2 Kritická chyba — návrh definice k revizi

Kritická chyba je **konkrétní prokázané porušení předem označené povinné
podmínky úlohy**, které činí finální výstup nepoužitelným nebo by při jeho
použití způsobilo nesprávný zásadní postup či neautorizovaný efekt. Příklady:

- deklaruje úspěšnou opravu, ale stanovené akceptační kontroly prokazují opak;
- doporučí provedení nebo schválí změnu porušující výslovnou ochranu dat,
  oprávnění či vazeb, přestože relevantní podklady byly dodané;
- vymyslí rozhodný údaj nebo ignoruje jeho explicitní opravu a na tomto
  údaji stojí výsledné rozhodnutí uživatele či navazující akce;
- vrátí nečitelný povinný strojový výstup tam, kde jej konkrétní provozní
  konzument skutečně vyžaduje a nedokáže zpracovat.

Pouhá délka, styl, drobná formulace ani fence zpracovatelná produkčním
parserem nejsou samy o sobě kritickou chybou. Závažnost musí být uvedena
předem v zadání hodnotitele; nově nalezený případ dostane stav
`CRITICAL_FINDING_REVIEW_REQUIRED`, konkrétní důkaz, dopad a vlastníka
rozsouzení (operátora). Nejasnost se nevydává za prokázanou vadu modelu.

„Nová“ znamená, že kandidát tuto podmínku porušil v párovém případě, kde
současný model podmínku splnil. Identita případu, opakování, důkaz a stav
prostředí se uchovají. Pokud oba selhali, není to nová regrese kandidáta,
ale stále to může být nesplněná absolutní podmínka způsobilosti. Jeden výskyt
prokazuje dané selhání, nikoli jeho populační četnost.

Potvrzená kritická chyba blokuje úspěch případu a doporučení do rozsouzení;
nezávislé dílčí známky se zachovají. Samotný příznak nesmí přidat druhou
srážku za stejnou chybu ani změnit vadné prostředí na obsahovou nulu.

### 7.3 Opakované NEROZHODNUTO — návrh provozního postupu

Po vyčerpání rozpočtu je kombinace dvojice artefaktů, role a verze profilu
uzavřena výsledkem `NEROZHODNUTO / PONECHAT`. Plánovač ji nesmí automaticky
opakovat do dosažení vítězství. Změna runtime nebo profilu není způsob,
jak skrýt předchozí výsledek; navazující měření nese jeho identitu.

Worker předá operátorovi důvod neurčitosti, dosavadní náklad, intervaly,
počet nezávislých skupin a přesný návrh, jaká nová informace by rozhodnutí
mohla změnit. Operátor rozhodne o ponechání jako uzavřené volbě, novém
rozpočtu a nových případech, opravě měřítka, nebo explicitním ručním přepnutí.
Ruční přepnutí se neoznačí za doporučení prokázané huntem.

Pokud další **výslovně schválené** porovnání opět nerozhodne, automatická
fronta pro tutéž dvojici zůstává uzavřená a předává se společný souhrn obou
běhů. Vlastníkem rozhodnutí je operátor; přípravu důkazů vlastní worker.
V reportu musí být vidět otevřená operátorská položka i datum posledního
rozsouzení. Čekání na ni samo neautorizuje další spotřebu prostředků.

### 7.4 Samostatně měřené osy

Konverzační kvalita, technická správnost, dodržení instrukcí/formátu a
zpracovatelnost produkčním runtime mají vlastní hodnoty a pokrytí.
Technické úlohy zůstávají měřenou osou, ne pouhým archivem. Striktní JSON
je jednou formátovou kontrolou, nikoli úplným měřítkem dodržování instrukcí.
Chybějící měření se nezamění za nulu ani za úspěch. Nová rubrika nezmění
zpětně to, co původní prompt žádal. Změna promptu vyžaduje nový sběr;
oprava hodnotitele vyžaduje nejprve přejímku jeho pozitivních a negativních
kontrol a teprve potom verzovaný replay s uchováním původních známek.
