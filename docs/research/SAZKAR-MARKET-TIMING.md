# Sázkař: vznik nabídky, cenová výhoda a průběžné doporučování

## Rozhodovací závěr

Kvalitní engine musí oddělit cenu, odhad pravděpodobnosti a rozhodnutí, zda
na nabídku upozornit. Samotný vysoký kurz, krátká doba od prvního pozorování
ani pohyb ceny nejsou důkazem kladné očekávané hodnoty. Čas je podstatná
informace o kontextu trhu; jeho význam se musí ověřovat na datech konkrétní
kanceláře, soutěže a typu sázky.

Praktickým základem je průběžný sběr s přesnými identitami a časem pozorování.
Bez něj nelze spolehlivě poznat novou nabídku, rekonstruovat rozhodnutí ani
ověřit, jak dopadl kurz po upozornění. Zároveň musí být možné neposlat nic:
absence dostatečné evidence je legitimní výsledek, nikoli důvod vyrobit tip.
Prototyp proto zavádí skutečné sledování změn a transparentní signály, ale
nepřisuzuje jim dosud neprokázanou predikční výhodu.

## 1. Co znamená atraktivní kurz

Pro desetinný kurz O a skutečnou pravděpodobnost p je očekávaný čistý výnos
na jednotku vkladu `p × O − 1`. Například při nezávisle odhadnutém p=0,50
a dostupném kurzu 2,10 vychází bodový odhad +5 %. Jestliže je však skutečné
p jen 0,46, tentýž kurz má odhad −3,4 %. Cena je výhodná pouze ve vztahu
k přiměřeně přesnému a aktuálnímu odhadu pravděpodobnosti.

Zde je přesná hranice dosavadního enginu. Pro kompletní 1X2 trh počítá
`S = 1/O1 + 1/O0 + 1/O2` a `pi = (1/Oi)/S`. Dosazením do výnosu vzniká
pro každou položku `Oi × pi − 1 = 1/S − 1`. Pokud S>1, žádná položka tímto
postupem nevytvoří pozitivní očekávaný výnos. Jde o užitečnou tržní referenci
a filtr pravděpodobnosti, nikoli o samostatný detektor chyb kanceláře.

Kladnou výhodu proto nelze vytvořit kosmetickým přidáním skóre „atraktivita“.
Musí přibýt informace nezávislá na oceňované nabídce: například současný
ověřený tržní konsenzus mimo tuto kancelář, nebo samostatný model, který
obstál v předem určeném hodnocení. Ani konsenzus není skutečná pravděpodobnost;
je to referenční odhad s vlastními chybami a závislostmi.

Výzkum Koninga a Zijm ukazuje, že jednoduché odstranění marže nemusí mít
stejné vlastnosti ve všech ligách. Porovnává normalizaci a Shinovu metodu
a nachází rozdílné výsledky v Premier League a La Lize. Nelze proto bez
měření přenést jednu kalibraci mezi soutěžemi nebo kancelářemi.[^1]

## 2. Dřívější a závěrečné kurzy

Při prvním vypsání obvykle ještě nejsou známy všechny informace, které budou
dostupné těsně před utkáním. Pro engine je důležité pozorovat, jak se tržní
odhad vyvíjí po zveřejnění zprávy nebo sestavy. Z toho však logicky neplyne,
že dřívější cena musí být pro vybranou stranu výhodnější. Zpřesnění informace
může cenu zkrátit i prodloužit; konkrétní směr je předem nejistý.

Buchdahlova analýza 158 092 zápasů spojuje poměr dřívější a závěrečné ceny
s následnými výnosy. Současně ukazuje, že domnělá zbytková výhoda z cenového
pohybu závisí na vzorku a typu kanceláře. Ve velkém vzorku Pinnacle nepřinesl
prostý výběr výrazně zkrácených cen při závěru ziskovou strategii. Jde o
historickou analýzu, nikoli potvrzení dnešní Fortuny.[^2]

Závěrečná cena je užitečný dodatečný benchmark. Protiprázdným claimem by ale
bylo nazvat každý kurz, který následně překonal closing, předem zjistitelnou
příležitostí. Budoucí closing nesmí vstoupit do online rozhodnutí. Taková
strategie by využívala informaci, která v okamžiku výběru ještě neexistovala.

### Vlastní párové měření

Reprodukovatelný skript `scripts/research-betting-timing.py` zpracoval existující
zdrojové snímky Football-Data. Použil pouze páry úplných Bet365 1X2 cen a známý
výsledek; vyřadil duplicity, neúplná/neplatná data a součet inverzních kurzů
mimo 1–1,3. Dataset obsahuje **7 228 zápasů pěti lig** od 5. 8. 2022 do
7. 9. 2026. Porovnání není modelem pro Fortunu ani optimalizací obchodního pravidla.

| Měření na společném vzorku | Výsledek |
|---|---:|
| Dřívější cena vyšší než závěrečná | 9 048 / 21 684 možností, 41,73 % |
| Závěrečná cena vyšší než dřívější | 8 448 / 21 684, 38,96 % |
| Cena stejná | 4 188 / 21 684, 19,31 % |
| Log loss dřívějšího odhadu / závěrečného | 0,96972 / 0,96755 |
| Brier score dřívějšího odhadu / závěrečného | 0,57660 / 0,57523 |
| Výnos sázení dříve vybraného favorita při dřívější / závěrečné ceně | −2,21 % / −2,05 % |

Menší log loss a Brier score znamenají lepší pravděpodobnostní predikci.
Párový bootstrap rozdílu log loss po 154 kalendářních týdnech, 2 000 opakování
s pevným seedem, dává interval 95 % **[−0,00379; −0,00049]** pro závěr minus
dřívější měření. V tomto vzorku tedy závěrečný odhad vychází přesnější.
Výběr favorita byl v obou cenových variantách stejný, určený dřívější cenou;
nešlo o dodatečný výběr favorita podle budoucnosti.

Toto měření má zásadní limit: Football-Data výslovně uvádí, že první sada
je sbíraná **po otevření** v určených časech. Není to skutečný opening.
Publikované budoucí zápasy se sbírají zpravidla v úterý a pátek. U těchto řádků
neznáme přesný odstup prvního odečtu od zahájení trhu nebo utkání. Poskytovatel
také upozorňuje na zastaralé Pinnacle ceny od 23. 7. 2025; proto toto měření
nepoužívá Pinnacle jako nezpochybnitelnou referenci.[^3]

Záznam má zdrojové SHA-256, čas stažení každého souboru, rozpad po ligách,
vyřazení a parametry bootstrapu. Leží v
`.intentsmith-artifacts/betting-watch-20260912/timing.json`. Z výsledků nelze
odvodit konkrétní optimální hodinu nákupu ceny. Lze z nich odmítnout obecné
pravidlo, že dřívější kurz je vždy lepší, a odůvodnit prospektivní sběr.

## 3. Jak zachytit vznik a vývoj nabídky

Časová evidence musí rozlišovat několik událostí:

| Čas | Význam |
|---|---|
| `observedAt` | host skutečně získal konkrétní cenu |
| `firstSeenAt` | první vlastní pozorování stejné identity nabídky |
| `openingAt` | skutečný okamžik vypsání, jen pokud jej zdroj doloží |
| `sourceUpdatedAt` | poslední změna ceny podle zdroje, pokud je známá |
| `kickoffAt` | plánovaný začátek utkání, ověřovaný před i po cenách |

Fortuna v ověřeném veřejném payloadu poslední dva zdrojové časy vypsání a
aktualizace ceny neposkytuje. `openingAt` proto zůstává null. Běžící hlídač
může po dvou úspěšných odečtech říci, že nabídku nově zachytil mezi nimi.
Nemůže dokázat, že předtím neexistovala jinde nebo byla skutečně poprvé vypsána.

První spuštění založí výchozí stav bez hromadných upozornění. Stejně se zachází
s dlouhým výpadkem nebo změnou filtrů. Zápas, který pouze vstoupil do posouvajícího
se 72hodinového okna, se neoznačí za nově vypsaný. Přeložení zápasu nebo změna
identity také nesmějí resetem historie vytvořit falešnou novinku.

Patnáctiminutový interval je provozní kompromis veřejného prototypu. Zaznamenává
řadu změn bez neustálého dotazování, ale může minout nabídku trvající jen několik
minut. Pozdější slib upozornění „ihned po vypsání“ by vyžadoval skutečný zdroj
událostí nebo častější ověřený sběr s respektováním limitů zdroje. Častější
dotazování samo nezlepší kvalitu pravděpodobností.

## 4. Dva současné signály a budoucí hodnotové doporučení

Implementovaný `NEWLY_OBSERVED` znamená nově zachycenou nabídku v již sledovaném
okně při souvislém sběru. Uvádí interval detekce, aktuální cenu, čas do začátku,
tržní odhad a neznámý opening. `PRICE_IMPROVED` znamená zvýšení ceny proti
předchozímu blízkému odečtu o nastavenou mez, výchozí 5 %. Zobrazuje také starou
cenu a její čas. Vyšší cena může doprovázet zhoršení šance; proto signál nedává
pokyn vsadit a má `valueStatus:UNVERIFIED`, `expectedValue:null`.

Oba signály respektují omezení jednotlivého tipu, výchozí kurz 1,5–3 a tržní
odhad alespoň 40 %. To je jiná úloha než sestavení celého akumulátoru. Hlídač
nepovažuje nabídku s vysokým součinem kurzů za nejlepší cenu. Nabídky stejného
zápasu a výsledku mají stabilní identitu; již oznámená cena má šestihodinový
cooldown a další upozornění musí překonat i poslední oznámenou cenu.

Budoucí skutečné hodnotové doporučení potřebuje navíc aktuální nezávislou
referenci. Nabízená cena se porovná s pravděpodobností odvozenou bez této
oceňované kanceláře. Očekávanou výhodu je vhodné zobrazit spolu s rozptylem
odhadů a nejistotou. Jestliže se při rozumně konzervativním odhadu ztratí,
výsledek má zůstat ke sledování. Prah nemá být odvozen pouze z lepšího zpětného
výnosu při mnoha vyzkoušených nastaveních.

Kaunitz, Zhong a Kreiner zkoumali využití cenových rozdílů mezi kancelářemi,
včetně historických, minutových a skutečně provedených sázek. Práce podporuje
význam srovnatelné nabídky více zdrojů; současně popisuje omezení dosažitelnosti
a účtů. Její historická úspěšnost není automaticky přenositelná na současný
veřejný feed jediné české kanceláře.[^4]

## 5. Zdroje, které skutečně mohou změnit rozhodnutí

Nejbližší datový přínos představuje další čerstvá kancelář nebo ověřený konsenzus.
Nestačí přidat název poskytovatele do seznamu adaptérů. Musí existovat skutečný
odečet ceny, známé stáří, pravidlo vypořádání, identita účastníků a pokrytí.
Stejná data přeprodávaná více službami nejsou nezávislé názory trhu. Agregace
musí mít ochranu proti zastaralé odlehlé ceně a vynechávat nabízející kancelář
z její vlastní hodnotící reference.

Zprávy o zranění, trestech a sestavách přidávají jiný typ informace. Je vhodné
upřednostnit oficiální klub, soutěž nebo doloženého poskytovatele a uchovat
čas publikace, čas načtení a stav potvrzení. „Hráč chybí“ není totožné s
„hráč je nejistý“ a chybějící zpráva neznamená zdravý tým. Odhad vlivu závisí
na hráčově roli, očekávaných minutách a náhradníkovi.

xG má význam jako vstup do odhadu síly týmu a kvality šancí, nikoli jako
univerzální násobitel pravděpodobnosti výhry. Je nutné sledovat pokrytí,
konzistenci definice poskytovatele a publikaci dostupnou před rozhodnutím.
Stejný požadavek platí pro rozpis, odpočinek, cestování a motivaci v soutěži.
Volný text typu „musí vyhrát“ bez modelu a evidence nevytváří číselnou výhodu.

LLM může pomáhat vyhledávat, třídit a extrahovat fakt s citací a nejistotou.
Nemá nahrazovat měřený pravděpodobnostní model ani doplňovat chybějící údaj
smyšleným číslem. Každá nová skupina vstupů musí prokázat přidanou hodnotu
v porovnání se stejným modelem bez těchto vstupů.

## 6. Model a měření kvality

Dosavadní samostatný Dixon–Coles model zůstává diagnostický. Již provedený
chronologický experiment nepodpořil jeho nasazení místo tržní reference.
To je důvod zachovat měřenou základní metodu, nikoli důvod zastavit výzkum.
Další kandidát musí mít přesnou verzi, zdroje, trénovací okno, kalibraci a
jednoznačný okamžik, od kterého smí být použit.

Nový preprint Gota, Takeishiho a Yairiho z roku 2026 porovnává konverze kurzů
a navrhuje OO-EPC a jednoduchý FL-GLM na 90 014 zápasech. Je relevantním
kandidátem pro reprodukci, nikoli již ověřenou metodou tohoto enginu.
Publikovaná výhoda proti jiným konverzím se musí znovu ověřit na konkrétních
zdrojích a odděleném časovém testu.[^5]

Výběr modelu má používat chronologický trénink, následnou validaci a uzamčený
test. Úpravy po nahlédnutí do testu potřebují nové budoucí hodnocení. Zvlášť se
hodnotí liga, horizont do utkání, pásmo kurzů a podmnožina skutečně doporučených
tipů. Dobrá průměrná kalibrace všech zápasů nezaručuje správnost nejvýhodnějšího
jednoho procenta vybraného po několika filtrech.

Minimální sada metrik obsahuje log loss, Brier score a kalibraci, dále pokrytí,
podíl odmítnutých neúplných dat, cenu dostupnou při odeslání, pozdější tržní
benchmark a výnos po skutečných podmínkách vypořádání. Intervaly nejistoty se
mají seskupovat podle zápasu nebo času, protože více výsledků téhož zápasu
nejsou nezávislá pozorování. U akumulátorů je třeba zvlášť hodnotit společnou
pravděpodobnost; součin jednotlivých odhadů je pouze předpoklad nezávislosti.

Prospektivní „paper“ historie musí ukládat i odmítnuté a nevyslané kandidáty.
Bez nich vzniká zkreslení výběrem úspěšných tipů. U každého rozhodnutí je
potřeba reprodukovat vstupy dostupné právě tehdy. Uzavírací cena, skutečná
sestava zveřejněná později nebo opravené xG nesmějí zpětně přepsat rozhodnutí.

## 7. Automatická upozornění jako samostatná odpovědnost

Průběžný sběr je v prototypu uživatelská systemd služba spuštěná timerem.
Má pevný veřejný zdroj, časové a objemové limity, vlastní stav a možnost
zastavení. Změna preference nevytváří nový souhlas s jiným serverem nebo účtem.
Příkazy pro hledání a hlídač používají stejný veřejný adaptér; hlídač ale při
každém odečtu znovu netrénuje diagnostický model.

Upozornění vznikne nejprve v transakční lokální frontě. Před odesláním se
ověří platnost ceny, současné zapnutí a přesný příjemce. Výchozí limit je
čtyři pokusy za klouzavých 24 hodin, nejvýše jeden nejlepší signál při jednom
odečtu. Staré zprávy se po výpadku nedosílají. Při cenovém pohybu se pořadí
řídí velikostí doloženého zlepšení, potom tržním odhadem; toto pořadí není žebříček EV.

Pád po SMTP přijetí může mít nejasný výsledek. Fronta proto zachová stav
`unknown` a takovou zprávu automaticky neopakuje. Upřednostňuje omezení duplicit
před předstíraným přesně-jednou doručením. SMTP přijetí také ještě neprokazuje,
že zpráva dorazila do doručené pošty. Pro první ověření slouží výslovně vyžádaný
testovací e-mail bez smyšleného sázkového doporučení.

Doručovací adaptér používá instalovaný Nodemailer, jeden nastavený SMTP server
a jednoho příjemce, TLS a ověření certifikátu. Nečte přílohy ani vzdálené URL.
Dokumentace transportu rozlišuje implicitní TLS na 465 a vyžadovaný STARTTLS
na 587; pouhé automatické nabídnutí STARTTLS by nebylo stejným požadavkem.[^6]
Tajemství zůstává v místním souboru s právy 600, mimo Git a auditní obsah.

## 8. Pořadí dalšího rozšiřování

První provozní krok je nyní hotový základ: ovladatelné CLI, vlastní cenová
historie, pozorované novinky a zlepšení, lokální fronta a připravené e-mailové
doručování. Tím vznikají data potřebná k dalšímu měření. Samotný čas běhu
hlídače ani počet uložených cen nejsou potvrzením hodnotových doporučení.

Následující přínos má mít druhý ověřený čerstvý zdroj, přesné spojení stejných
trhů a referenční odhad bez oceňované kanceláře. Poté má smysl vyhodnotit
kalibraci, cenové odchylky a publikované modelové kandidáty. Oficiální zprávy
a sestavy lze přidávat postupně jako časově doložené vstupy s měřením jejich
přínosu. Rozšíření na další sporty, hráčské trhy a korelované akumulátory má
následovat až po ověření těchto základů na současném malém rozsahu.

Pro změnu signálu „ke kontrole“ na hodnotové doporučení je potřeba současně
prokázat: čerstvou dostupnou cenu, odpovídající nezávislou predikci, měřenou
kalibraci ve vybrané podmnožině a robustnost vůči nejistotě i změně ceny mezi
výběrem a doručením. Pokud některý důkaz chybí, musí to být vidět ve výsledku.
To je praktická definice chytřejšího enginu: umí využít doloženou informaci,
vyhodnotit její časovou platnost a také rozpoznat, kdy zatím neví dost.

## Zdroje

[^1]: Ruud H. Koning a Renske Zijm. [Betting market efficiency and prediction in binary choice models](https://link.springer.com/article/10.1007/s10479-022-04722-3). Publikováno 29. 4. 2022, Annals of Operations Research 325 (2023).
[^2]: Joseph Buchdahl. [Steamers and Drifters Revisited: Evidence for Closing Market Efficiency?](https://football-data.co.uk/blog/steamers_drifters_revisited.php). 20. 9. 2018, Football-Data.
[^3]: Football-Data. [Historical Football Results and Betting Odds Data](https://football-data.co.uk/data.php), metodika sběru a upozornění k Pinnacle; ověřeno 12. 9. 2026. Vlastní měření používá uchované CSV snímky uvedené v JSON artefaktu.
[^4]: Lisandro Kaunitz, Shenjun Zhong a Javier Kreiner. [Beating the bookies with their own numbers — and how the online sports betting market is rigged](https://arxiv.org/pdf/1710.02824). arXiv:1710.02824v2, 11. 11. 2017.
[^5]: Kaito Goto, Naoya Takeishi a Takehisa Yairi. [Forecast Sports Outcomes under Efficient Market Hypothesis](https://arxiv.org/html/2604.17194v1). arXiv:2604.17194v1, 19. 4. 2026; preprint, dosud nereprodukovaný v tomto enginu.
[^6]: Nodemailer. [SMTP transport](https://nodemailer.com/smtp). TLS, timeouty a omezení přístupu k souborům a URL; ověřeno 12. 9. 2026.
