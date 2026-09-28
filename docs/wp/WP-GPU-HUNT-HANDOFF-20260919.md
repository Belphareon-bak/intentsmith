# Předání GPU huntu druhému workerovi

**Stav:** HANDOFF / PRIMARY_PROCEDURE_SET / PILOT_IN_PROGRESS.
Komu: worker, který převezme dokončení GPU huntu bez znalosti předchozí práce.
Autorita: operátor, 19. 9. 2026.

Rozhodnutá pravidla jsou v [WP-GPU-HUNT-DIRECTION-20260919](WP-GPU-HUNT-DIRECTION-20260919.md)
a [WP-GPU-HUNT-EVALUATION-CONTRACT-20260918](WP-GPU-HUNT-EVALUATION-CONTRACT-20260918.md).
Tento dokument říká, **jak jsme k nim došli, co se ukázalo, a jakou cestou se
má pokračovat**. Primární je §5.

## 1. Odkud to vyšlo

Operátor si všiml, že skoro všechny výsledky evaluace jsou 0 % nebo 100 %,
a vyslovil podezření, že jsou špatně sestavené testy. Podezření se potvrdilo
a ukázalo se, že sahá hlouběji než k sadám.

Zásadní zjištění celého kola: **dvě roviny se pletly dohromady.** Jedna je
průkaznost čísla — digest artefaktu v odpovědi, append-only historie, contract
SHA, fail-closed brány. Ta byla postavená velmi pečlivě. Druhá je platnost
čísla, tedy jestli vůbec měří schopnost modelu. Ta nebyla ověřená nikdy.

Symptomem toho byl stav, kdy `tests/model-evaluation-suites.test.js` svítil
27/27 zeleně a současně měly hodnotitelé tři doložitelné vady. Zelené testy
ověřovaly, že hodnotitel dělá, co je v něm napsáno. Že to napsané dává smysl,
neověřoval nikdo.

## 2. Jak probíhala spolupráce dvou modelů

Operátor nechal věc posuzovat dvěma nezávislými modely — GPT a Opus — a sám
rozsuzoval sporná místa. Rozdělení sil se ukázalo jako věcné, ne formální:

**GPT bylo silnější v metodice a v přepočtech výstupů.** Přineslo chybějící
vazbu mezi benchmarkem a skutečným provozním výkonem, problém závislých shluků
úloh, upozornění že úloha, kterou zvládnou všichni, není zbytečná (je to
kvalifikační podmínka), křehkost historické opravy jako definice pravdy,
a kritiku nepodložených statistických prahů. V posledním kole přepočetlo HTML
export a našlo v něm věci, které čtení kódu odhalit nemohlo.

**Opus bylo silnější ve čtení produkčního kódu a v ručním známkování.**
Našlo tři konkrétní vady hodnotitelů přímo ve zdroji, rozpor mezi kontextem
měření a kvalifikace, vadu falešné konvergence v produkční smyčce, sdílení
jedné sady třemi rolemi, a to, že poslední nosná brána systému je literál.
Pak ručně oznámkovalo uložené odpovědi proti stejným kritériím.

**Obě se navzájem opravovala a to bylo produktivní.** Příklady:

- GPT zamítlo první Opusův návrh kontraktu jako příliš kategorický: prahy bez
  odůvodnění, `1/N` zaměněné za přesnost měření, a hlavně chybějící ověření
  přínosu v reálném workflow. Opus to přijalo a kontrakt se přepsal.
- Opus tvrdilo, že „vada byla výhradně v měřidle". To si protiřečilo s jeho
  vlastním nálezem, že tři role sdílejí dvanáct stejných promptů — což je vada
  zadání. Staženo.
- Opus tvrdilo, že všechny mezihodnoty známek vznikly ze šumu. GPT našlo
  protipříklad: `r2_model_cleanup` r2 dává 8/9 v obou pořadích **nezávisle**.
  Tvrzení bylo zeslabeno na doložitelnou podobu.
- Opus popsalo, že model „rozpoznal správné řešení a zavrhl ho". GPT upřesnilo,
  že model zavrhl přidání `BINDING_CUTOVER` v **exkluzivní** klasifikaci,
  zatímco správná oprava ho přidává mezi **sdílené**. Ověřeno v kódu, opraveno.
- Opus měřilo nestabilitu pořadí jako 4/40 = 10 %. Počítalo ale jen položky,
  které prolezly sítem; dalších 15 hodnocení systém kvůli téže nestabilitě
  zahodil. Správně je to 19 z 96 pokusů, tedy 20 %.

**Poučení pro dalšího workera:** dva modely se neshodnou na všem a právě ty
neshody nesly nejvíc informace. Nehledat rychlý konsenzus. Každé sporné
tvrzení se ověřovalo proti kódu nebo uloženým datům, ne argumentem.

## 3. Co se ukázalo — dobré a špatné

### Dobré

- **CODE má poctivé orákulum.** Jediná role, kde se spouštějí skryté testy.
  Sedm referencí i sedm alternativních správných řešení dostalo 1, sedm
  rozbitých základů 0. Reprodukovatelné bez GPU:
  `node scripts/manual/verify-code-oracles.mjs`. Tímto směrem má jít všechno
  ostatní, kde to jde.
- **Fail-closed rovina funguje.** Po opravách nemůže nepřijatá sada nic
  doporučit ani smazat: `decisionReady: false` se propisuje do retention
  (`RETENTION_SUITE_NOT_READY` → keep), read modelu i párové zkoušky.
- **Sondy chytily skutečné vady samy.** Požadavek na prohození pořadí odhalil
  hodnotitele, který dal negaci reference plné body v jednom pořadí a odmítl ji
  v opačném. Referenční sonda ≥ 0,9 odhalila špatně formulovanou rubriku R1.
  Obě chybové orientace — falešně pozitivní i falešně negativní — padly do sítě
  automaticky.
- **Poslední kolo skončilo poctivým NO-GO.** Pět rolí ze sedmi odmítlo vydat
  souhrnné skóre, protože hodnotitel neprošel přejímkou. Proti srpnu, kdy mělo
  všech sedm rolí sebejistá čísla na čtyři desetinná místa, je to pokrok,
  přestože na papíře vypadá jako krok zpět.

### Špatné

- **Původní hodnotitelé byly kontroly výskytu slov.** `includesAny(shape,
  ['circle'])` pustí odpověď „not a circle". Penalizace rozporu v sumarizaci
  hlídala dvě natvrdo zapsané hodnoty. V hodnocení revizí byly duplicity
  očekávaného druhu vady zdarma, takže sto vymyšlených lokací stálo nula.
- **Měřilo se na jiném kontextu, než se kvalifikovalo.** Kvalita při 4 096
  tokenech, paměťová brána při 32 768. `gemma4:31b` byla kvůli tomu automaticky
  smazaná za přetečení v kontextu, který se k měření kvality nepoužívá.
- **Produkce hlásila úspěch, když parser nepřečetl chyby.** Prázdný seznam chyb
  se rovnal `all_passed`. Opraveno: úspěch teď vyžaduje `testResults?.allPassed
  === true && qualityGate?.passed === true`.
- **Benchmark nepředpověděl provoz.** Krátké opravy daly 85,71 %, v reálném
  opravném postupu IntentSmithu dokončily oba modely 0/24. Po opravách předávání patchů
  se to zvedlo na 4/8 a 1/8 — úzké hrdlo bylo v postupu, ne v modelech.
- **Nový sémantický hodnotitel zdědil binární chování.** Ze 40 platně
  hodnocených pokusů D1/D2/R1/R2 má 32 přesně 1,0 a 4 přesně 0,0.
  Hodnotitel byl navíc **tentýž artefakt jako hodnocený model** (`qwen3.8`
  známkoval `qwen3.8`) a sondy si napsal autor sám.
- **Opravná smyčka dostávala neúplný vstup.** U `search-report` dostal model
  z `cre-decision.js` jen řádky 555–685 bez rozhodovací funkce, kterou měl
  opravit. Část výsledků tedy měří sestavení kontextu, ne model.
- **Souhrnné procento zakrývá podstatné.** VISION má průměr 84,62 %, ale jen
  **6 z 39** odpovědí splnilo `strictJson`; 33 přišlo v Markdownovém obalu.

## 4. Co je rozhodnuté

Čtyři pravidla operátora, podrobně v [direction dokumentu](WP-GPU-HUNT-DIRECTION-20260919.md) §1:

1. **Sebeoprava se sama netrestá.** Srážka jen proti pojmenovanému kritériu
   (přetrvávající rozpor, nepodložené tvrzení, porušení zadané hranice,
   nejednoznačný závěr) a je malá, řádově jednotky procent.
2. **Vlastnost, kterou hodnotitel jen předpokládá, má 0,25** — ne plný bod
   a ne půl. Plný bod potřebuje oporu v textu, kódu nebo testu.
3. **Poctivý pokus s kritickou chybou má 0,25; nedodaná odpověď 0.**
   Kritická chyba smí zablokovat úspěch úlohy, ale nesmí smazat důvod.
4. **Model pod 50 % v roli je pro tu roli nevhodný.** Nehledá se stoprocentní
   model, hledá se optimální. Jsou-li sady moc přísné, opraví se sady
   a oprava se potvrdí opakovaně.

## 5. Primární postup — jak pokračovat

Toto je závazná cesta. Jejím smyslem je **zopakovat přesně to, co u prvního
modelu fungovalo**: změřit, nechat výsledky projít dvěma nezávislými modely,
a nechat operátora rozsoudit nejistoty.

1. **Vybrat z lokálních modelů toho s nejlepší premisou** uspět v rolích, kde
   první model neuspěl, a udělat kompletní testy. Výsledky procházejí Opus
   i GPT; operátor posuzuje nejistoty.
2. **Posoudit, zda jsou testy adekvátní** a zda daný model na role má —
   zejména tam, kde neprošel první ani druhý model.
3. **Opakovat body 1 a 2 pro všechny role**, tedy vybrat alespoň dva vhodné
   kandidáty, aby bylo dost výsledků.
4. **Prokáže-li se, že je test neadekvátní, opravit test.** Formulace „příliš
   přísný" je zavádějící: to, že neprojdou dva vhodní kandidáti, je důvod
   test **zkontrolovat**, nikoli důkaz jeho vady. Opravuje se test, který měří
   něco jiného než práci role — ne test, který je náročný.
5. **Teprve po závěru všech těchto měření** a po potvrzení, že hunt a jeho testy
   fungují, vybrat na základě prvních kol jeden či více hodnoticích modelů,
   které nastudují naše verdikty a zkusí podle nich ohodnotit nový model;
   výsledek zkontrolujeme.
6. **Neohodnotí-li správně, musíme ho to naučit.**
7. **Až budou prokazatelně správné testy i správné nezávislé hodnocení mimo
   operátora, Opus a GPT, je hunt funkční.** K funkčnosti patří i **skutečný
   průchod IntentSmithem** — hunt musí projít celou cestu v běhovém prostředí,
   ne jen vydat čísla.

## 6. Praktické poznámky k provedení §5

Postup v §5 je závazný tak, jak je. Následující body nejsou výhrady k němu,
ale věci, které při jeho provádění ušetří GPU a slepé uličky.

### 6.1 Sada musí správně seřadit, ne jen obodovat

Krok 2 je jádro celé věci. Sada je adekvátní právě tehdy, když její výsledek
odpovídá tomu, jak se model chová při skutečné práci v IntentSmithu — to je
jediné měřítko, které má smysl. Nejdražší poučení prvního kola bylo, že krátké
opravy daly 85,71 %, zatímco v reálném opravném postupu dokončily oba modely
0/24. Rozdíl tehdy neukázal nic o modelech, ukázal, že sada neměří to, k čemu je.

Proto se u každé role vyberou podle testů **alespoň dva modely** a jejich
pořadí se ověří na několika skutečných úlohách v běhovém prostředí. Nejde
o přeměření celé sady, jde o kontrolu, že benchmark odhadl správně.

**Vyjde-li v reálném provozu lépe model, který měl horší benchmark, jsou tím
testy prokázány jako nedostatečné.** Rozhodující není absolutní procento, ale
zda sada zachovává pořadí kandidátů. Sada, která seřadí opačně, nemůže sloužit
k výběru modelu do role, i kdyby její čísla vypadala přesvědčivě.

### 6.2 Chybějící procento není totéž co selhání modelu

U některých rolí nemáme prokázané „model neprošel", ale **neplatné hodnocení
nebo nedokončenou odpověď v přiděleném rozpočtu**. Export to poctivě odlišuje
a nechává souhrnná skóre prázdná. V D1/D2/R1/R2 zahodila 15 hodnocení
nestabilita pořadí a 29 pokusů vyhořelo na výstupním limitu — tyto role jsou
**otevřené, ne prohrané**.

Kandidáti se proto nevybírají podle chybějícího celkového procenta, ale podle
**konkrétní slabiny**: věcná diagnostika, dodržování instrukcí, dokončení
analýzy v limitu, práce s obrazem, použití nástrojů.

Kde platný výsledek je, řídí se pravidlem §1.4: `qwen3-coder` má na CODE
11,43 % a nula dokončených oprav, takže je pro tu roli nevhodný a znovu se
tam neměří.

### 6.3 Kandidát prochází celou sadu své role

Ne jen úlohy, které první model nezvládl. Jinak se ověří jeho možné výhody,
ale neodhalí vlastní slabiny.

Podmínky porovnání zůstávají shodné pro všechny kandidáty: zadání, nástroje,
provozní rozpočet a pravidla způsobilosti do 22 GB VRAM.

### 6.4 Profil D1 se musí rozhodnout před měřením

Při 75 % vyhoření na 2 048 tokenech se u D1 neměří analýza, ale vejití se do
limitu. Podle §1.4 platí jedno ze dvou: buď 2 048 odpovídá provoznímu profilu
role a model v něm musí dokončovat, nebo neodpovídá a profil se mění **pro
všechny porovnávané modely**. Výjimka pro jeden model je vyloučená.

### 6.5 Opravu sestavení kontextu dokončit před dalším provozním během

U `search-report` dostal model z `cre-decision.js` jen řádky 555–685 bez
rozhodovací funkce, kterou měl opravit. Dokud to není opravené, druhý model
zdědí tutéž vadu a provozní čísla budou opět měřit postup, ne model.
Benchmarkových rolí se to netýká, jejich zadání jsou samonosná.

## 7. Jak se známkuje a jak se přejímá hodnotitel

### 7.1 První posouzení probíhá naslepo

Opus a GPT vytvářejí první známku **bez znalosti závěru toho druhého** a pokud
možno i bez jména kandidáta a bez původního automatického skóre. Oba dostanou
stejné zadání, podklady, kritéria a celou odpověď. Teprve potom se závěry
porovnají.

Důvod je praktický: jakmile jeden vidí známku druhého, přestává být nezávislým
posouzením a stává se revizí. Neshody mezi nimi nesly v prvním kole nejvíc
informace a nesmí se ztratit tím, že se srovnají předem.

### 7.2 Ladicí a přejímací případy se dělí po scénářích

Případy, na kterých se upravují pravidla a učí hodnotitel, musí být oddělené
od případů, kterými se ověřuje jeho přenos na nové situace.

Dělí se **podle scénářů nebo společného původu vady**, nikdy tak, že dvě
opakování téže úlohy jdou k učení a třetím se „nezávisle" přezkouší. Blízce
související vzorky by výsledek nadlepšily, aniž by cokoli dokázaly.

### 7.3 Přejímka potřebuje i dosud nepoužité scénáře

Nový hodnocený model je dobrý kontrolní krok, ale sám nestačí — hodnotitel může
zvládat naučené případy, aniž je ověřeno, že zvládá nové úlohy. Do přejímky
proto patří také scénáře, které se dosud nepoužily.

### 7.4 Při přejímce hodnotitel nedostane naši známku

Dostane zadání, podklady, rubriku a odpověď. **Naši výslednou známku ani její
odůvodnění nedostane** — ty slouží až k následnému porovnání.

## 8. Závěr

Hotový autonomní hunt zatím není. Poprvé ale existuje měřidlo, které o sobě
umí říct, že neměří — a to je jediný stav, ze kterého se dá stavět dál.

Zbývající práce není další přestavba metodiky. Je to opakování postupu, který
u prvního modelu zabral: změřit, nechat výsledky projít dvěma nezávislými
posuzovateli, nechat operátora rozsoudit sporná místa, a teprve z hotových
verdiktů vychovat hodnotitele, který bude sám známkovat tak, jak bychom to
dělali my.

Varování na závěr, protože na tom tato práce opakovaně uvázla: **nepřidávat
další vrstvy průkaznosti tam, kde stačí se podívat.** Otázka „hodnotí to jako
my?" se zodpoví tím, že si jeho známky přečteme a porovnáme s vlastními.
Většina zpoždění prvního kola vznikla tím, že kolem čísel rostl aparát,
zatímco vlastní posouzení nikdo neudělal.
