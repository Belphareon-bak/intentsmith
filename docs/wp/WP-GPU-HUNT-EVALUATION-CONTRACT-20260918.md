# WP — kontrakt platnosti evaluací GPU huntu

**Stav:** SCOPE_APPROVED / DECISION_RUN_COMPLETE / NEROZHODNUTO / REVIEW_PENDING.
Průzkumná série je uzavřená. Navazující párový provozní průchod má 48/48
pokusů na předem uzamčeném plánu, oba modely kvalifikované do 22 GB,
výsledek NEROZHODNUTO a binding beze změny. Nejde o přijetí pilotu ani
obecnou použitelnost CODE: Qwen i Devstral v tomto C3 profilu dokončily 0/24
oprav. Podklady, nalezené vady a omezení jsou v
[review z 19. 9.](../review/2026-09-19-CODE-MEASUREMENT.md).
Původní průzkum není dodatečně prohlášen za intervalově rozhodovací data.
Autorita: zadání operátora z 18. 9. 2026 po dvou kolech nezávislé revize návrhu.
Tento dokument je **zadání pilotu**, nikoli přijetí implementace a nikoli
tvrzení, že současné evaluace jsou platné.

Navazuje na [audit výpovědní hodnoty](../review/2026-09-18-EVALUATION-VALIDITY-AUDIT.md)
(`b2512408`) a nahrazuje dosavadní neformální dohodu o rozsahu sad.

## 0. Hranice tohoto dokumentu

- Schválen je **rozsah prvního pilotu**, ne obecná přestavba metodiky.
- Počty z auditu (2 758 přeznámkovaných odpovědí, 57 běhů) jsou **údaje
  z předložené zprávy**, ne nezávisle ověřený stav repozitáře. Pilot je musí
  doložit znovu na vlastních výstupech.
- Tři vady hodnotitelů jsou ověřené čtením zdroje
  (`role-quality-suites.js` — negace u `vision_ring`, dvě natvrdo zapsané
  hodnoty v penalizaci `en_grounded_summary`, volné duplicity v `gradeFindings`).
  Tvrzení „vada byla výhradně v měřidle" **neplatí**: sdílení jedné sady
  třemi rolemi je vada zadání.
- Žádná část tohoto kontraktu neopravňuje ke změně vazby role ani ke smazání
  modelu.

## 1. Tři otázky, které se nesmějí zaměňovat

| Otázka | Co musí být doloženo |
|---|---|
| Známkuje hodnotitel správně? | Přijme správné řešení **i jeho správnou alternativu**, odmítne nesprávné. |
| Měří sada schopnosti role? | Úlohy odpovídají skutečné práci role, ne tomu, co se snadno kontroluje. |
| Pomůže výběr modelu provozu? | Lepší výsledek se projeví v dokončených úlohách a menší potřebě zásahu. |

Dosavadní kola řešila výhradně průkaznost čísla. Třetí otázka nebyla nikdy
položena a je pro tento pilot závazná.

## 2. Žebřík hodnotitelů

Každá úloha deklaruje úroveň. Skóre nesmí vzniknout z úrovně T5.

| Úroveň | Mechanismus |
|---|---|
| T1 | spuštění skrytých testů proti vrácené opravě |
| T2 | parsovaný JSON, porovnání typovaných hodnot s tolerancí |
| T3 | množinové porovnání lokací přes precision/recall/F1 |
| T4 | model jako hodnotitel, až po doložené přejímce |
| T5 | výskyt podřetězce — **zakázáno jako skóre**, přípustné jen jako předfiltr formátu |

## 3. Přejímka hodnotitele

Před prvním známkováním modelu musí hodnotitel projít sondami nad syntetickými
odpověďmi: prázdná, ozvěna zadání, klíčová kaše, negace faktů, sebejistý omyl
(všechny ≤ podlaha) a **referenční správná odpověď jinými slovy** (≥ 0,9).
Poslední sonda je povinná — hodnotitel, který srazí správnou odpověď za jinou
formulaci, je stejně vadný jako ten, který pustí nesmysl.

Sondy jsou levné a bez GPU **pouze pro T1–T3**. U T4 známkuje model, takže
přejímka stojí inferenci a plánuje se jako běh.

Přejímka T4 navíc vykazuje **podíl nesprávně přijatých a nesprávně odmítnutých
odpovědí po typech úloh**, ne jen souhrnnou shodu — dobrá celková shoda zakryje
problém v malé, ale důležité skupině. Ladicí vzorek je oddělený od přejímacího.
U párového hodnocení se prohazuje pořadí. Souhrnná míra shody je doplňkový
údaj, ne přejímací podmínka sama o sobě.

## 4. Výsledkové třídy

Nula je legitimní výsledek. Vadou je, když **stejná nula znamená chybnou opravu
i rozbité prostředí**.

| Situace | Zacházení |
|---|---|
| Správně dokončená oprava | platné hodnocení, úspěch |
| Chybná nebo částečná oprava | platné hodnocení, neúspěch nebo dílčí skóre podle rubriky |
| Zacyklení nebo vyčerpání rozpočtu v jinak funkčním prostředí | **provozní neúspěch**; nesmí zmizet mezi poruchami prostředí |
| Model nesplní paměťové požadavky profilu | `NEZPŮSOBILÝ_PROFIL`; nedoporučuje se pro profil, **model se nemaže** |
| Porucha prostředí nebo neověřený hodnotitel | hodnocení neplatné/blokované; skóre **chybí**, nenahrazuje se nulou |

Rozhoduje **dosažený stav prostředí**, ne závěrečná zpráva agenta.

Vyloučené a nehodnotitelné pokusy zůstávají viditelné v počtech i důvodech.
Kandidáta nelze porovnat jen na jeho úspěšně doběhlých úlohách proti
současnému modelu na všech. Pro párové vyhodnocení musí být zřejmé, které
scénáře do porovnání vstoupily a proč některé chybějí.

## 5. Referenční pravda

Historická oprava je **podklad pro správnou odpověď, ne celá pravda**. Vada
může vzniknout v jedné funkci a být zaplátovaná v druhé; shoda na místě fixu
by pak odmítla správnou diagnózu.

Úloha nese ověřený popis vady, podmínky vzniku, přijatelné varianty vysvětlení
a reprodukční test, kde jde vytvořit. Lokalizace je součást důkazu, ne jeho
náhrada. U CODE se vedle referenční opravy ověřuje i **jiná správná
implementace** a úmyslně vadné varianty.

Nález mimo referenci je **nejprve neověřený**; po posouzení může být potvrzený
nebo vyvrácený. Samotná absence v referenci není důkaz chyby. Automatické
pravidlo „není v seznamu, tedy falešný" je přípustné jen tam, kde je označení
úplné z konstrukce — typicky u čistých negativních kontrol.

## 6. Uzamčené rozhodovací pravidlo

Před finálním měřením musí být vyplněno a uzamčeno: hlavní měřítko, metoda
a hladina intervalu, minimální přínos, mez přijatelného zhoršení, rozsah úloh,
plán opakování a maximální rozpočet. Bez těchto hodnot smí běh dodat průzkumná
data, ale **neautorizuje změnu**.

| Důvod výměny | Pravidlo |
|---|---|
| Vyšší kvalita | dolní mez intervalu rozdílu *kandidát − současný* překročí minimální přínos |
| Vyšší rychlost při přijatelné kvalitě | dolní mez rozdílu kvality je nad zápornou mezí přijatelného zhoršení **a zároveň** je splněn předem stanovený požadavek na zrychlení |

„Neprokázali jsme rozdíl" **není** „prokázali jsme stejnou kvalitu".

Opakování se nejdřív agregují uvnitř scénáře, aby vícekrát opakovaná úloha
nezískala větší váhu. Plán opakování se odvodí z pilotních dat a pak uzamkne.
**Samostatné ID scénáře nezaručuje nezávislost**: varianty odvozené od téže
vady nebo téže výchozí úlohy tvoří jednu skupinu závislých pozorování a tato
vazba musí zůstat zachovaná při výpočtu nejistoty. Jednotkou nezávislosti není
kontrola — deset kontrol nad jednou opravou je jedno pozorování.

Po vyčerpání schváleného rozpočtu je korektním výstupem
**verdikt `NEROZHODNUTO`, provozní akce `PONECHAT`**. To není selhání pilotu.
Selháním by bylo pokračovat, dokud některému modelu náhodou nevyjde vítězství.

## 7. Provozní profil a způsobilost

Výsledek patří ke konkrétní kombinaci: **model a kvantizace + runtime +
šablona a systémový prompt + nastavení generování + dostupné nástroje +
paměťový a časový rozpočet.** Ne k samotnému jménu modelu.

Paměťová způsobilost se měří jako skutečná špička při reprezentativně dlouhém
vstupu a generování, včetně nastavení KV cache a souběhu, se zaznamenaným
případným CPU offloadem. Evaluace a paměťová kvalifikace používají **tentýž
kontext**; dnešní rozpor (kvalita na 4 096, kvalifikace na 32 768) je vada.

**Model nezpůsobilý pro profil není nekvalitní.** Jsou to dvě různé informace
a `NEZPŮSOBILÝ_PROFIL` nesmí být vstupem do mazání.

## 8. Pilot — role CODE

Jedna role, celý rozhodovací průchod. Žádné souběžné otevírání dalších rolí.

1. **Reprodukovat doložené vady hodnotitele a opravit je.** Každá oprava musí
   rozlišit chybnou odpověď od alternativního správného řešení.
2. **Zavést výsledkové třídy** podle §4.
3. **Doplnit referenční pravdu** podle §5.
4. **Porovnat současný model a dva kandidáty** na totožných úlohách v
   benchmarku; vydat rozdíl, nejistotu a mez podle §6.
5. **Párové ověření v provozu.** Na oddělené, předem uzamčené sadě reálných
   úloh porovnat vybraného kandidáta **se současným modelem** v běhovém
   prostředí C3. Oba dostanou totožná zadání, výchozí stav, nástroje a provozní
   limity. Každý pokus začne v čistém prostředí bez přístupu k referenční
   opravě nebo k výsledkům předchozích pokusů.
6. **Rozhodnout:** změnit / ponechat / nerozhodnuto.

Hlavní provozní měřítko kroku 5:

> **Podíl úloh dokončených v rozpočtu, bez opravné pomoci člověka, se splněnými
> akceptačními a stanovenými regresními testy.**

Vedle něj se vykazuje čas dokončení, počet opravných zásahů a spotřeba
prostředků. Povinné schválení oprávnění se **nepočítá** jako opravná pomoc.
V reportu se formuluje „bez regresí zachycených stanovenými kontrolami", ne
„bez regresí".

Oddělená přejímací sada se **nesmí** současně používat k ladění promptů ani
k opakovanému vybírání kandidátů; jinak se informace z přejímky vrací do výběru
a přestává být nezávislá.

Výsledkem pilotu je **doložená použitelnost konkrétní záměny v konkrétním
profilu**, ne obecný důkaz, že benchmark předpovídá výkon budoucích modelů.

## 9. Přejímací výstupy

1. **Reprodukce vad a jejich oprav** — chybná odpověď neprojde, alternativní
   správná projde; odkazy na konkrétní existující testy a výsledky.
2. **Jedno dokončené porovnání** — současný model a dva kandidáti v benchmarku,
   následně vybraný kandidát proti současnému modelu na oddělených reálných
   úlohách.
3. **Jedno rozhodnutí s podklady** — změnit, ponechat nebo nerozhodnuto, včetně
   nejistoty, provozních selhání, nehodnotitelných pokusů a omezení závěru.

## 10. Co se v tomto pilotu nestaví

- ostatní role (D1, D2, R1, R2, CHAT, VISION);
- nový framework, paralelní registr ani nová vrstva ručních reportů;
- kalibrační panel šesti „známě různě schopných" modelů;
- rychlý profil — odvodí se až z ověřeného postupu, a to nejen podle největších
  rozdílů mezi modely, ale i podle pokrytí schopností role;
- obecné posuzování revizních nálezů mimo referenci (§5 zatím jen jako pravidlo
  v textu).

Trvale platí: **rychlý profil nikdy nemění vazbu role a nikdy nemaže model.**

## 11. Definice hotova

> U jedné role umíme na konkrétních správných a chybných výstupech doložit, že
> hodnocení funguje, a na jeho základě obhájit výběr modelu — nebo jasně ukázat,
> proč zatím nelze rozhodnout.

Za úspěch se **nepovažuje** počet nových testů ani hotová infrastruktura.

## 12. Oddělená okamžitá položka

Nezávisle na pilotu: překlasifikovat nezpůsobilost profilu tak, aby nemohla
vést ke smazání modelu. Dnešní retention větev maže na základě paměťového
přetečení měřeného při 32 768 tokenech, zatímco kvalita se měří při 4 096.
`gemma4:31b` byla takto odstraněná 12. 9. Běží to každou noc a je to nevratné.

**Implementační checkpoint 18. 9. večer (nemění rozsah pilotu):** předchozí
odstavec popisuje výchozí závadu. V nasazeném `230778ad` je automatické mazání
v noční jednotce vypnuté; časovač zůstává aktivní. Samotné přetečení v jednom
kontextu již retenční politika odmítá jako důvod odstranění
(`RETENTION_CONTEXT_SPECIFIC_GPU_UNFIT`). Sjednocení kontextu kvalifikace
a evaluace, nové výsledkové třídy a CODE pilot tím nejsou implementované.
Podrobnosti a meze dokládá
[navazující review](../review/2026-09-18-EVALUATION-HARDENING-VISION.md).

## Operátorské upřesnění, 18. 9. 2026 v noci

Nový přímý pokyn rozšiřuje **přípravu** také na ostatní role a odkládá další
testování: počítač má zůstat tichý. §8/§9 nadále definují přejímku CODE pilotu.
Výluka dalších rolí v §10 nyní nebrání přípravě jejich zadání, ale jejich
neověřené návrhy nevstupují do produkčního skóre ani rozhodování.

[Přípravný materiál](../../src/eval/fixtures/drafts/README.md): osm historických
případů, odlišné úkoly pro D1/D2/R1/R2, revize CHAT a inventář VISION.
Po pokynu se nespouštěla další inference ani validační sada; náročné ověření
a GUI kontrola společného buildu jsou odložené. GPU hunt timer je zastavený
a disabled, do dalšího výslovného spuštění se neobnovuje.

## Navázání po review, 19. 9. 2026

Operátor výslovně zadal dokončení nalezených mezer GPU huntu a předání k
revizi. Následující implementace opravuje produkční přenos patchů a diagnostiku,
odděluje spustitelnost měření od přijetí profilu pro rozhodování a ukazuje
ochranné pozastavení automatiky v GUI. Původní provozní výsledek 0/24 na každé
straně se nemění. Stejných osm případů se smí použít pouze k vývoji; nová
inference nad nimi není nový holdout ani podklad k výměně modelu.

Ruční runner podporuje `--workflow=intentsmith --development` při `--seal`
a `--run`. Uzamyká zdroje současného produktu, nejvýše tři iterace, jeden
pokus každého modelu na případ a paměťový profil. Výsledek vývojové série má
vždy `DEVELOPMENT_ONLY`, bez změny produkční DB, vazeb nebo modelů. Přejímka
správných/alternativních oprav a negativních kontrol běží přes stejnou smyčku.
Automatický hunt zůstává pod původním holdem do přijetí rozhodovacích profilů.


Vývojová oprava `6610faf6` má vlastní
[packet k revizi](../review/2026-09-19-HUNT-WORKFLOW-REPAIR.md). Obsahuje
60 kontrol orákul, uzavřenou 16pokusovou vývojovou sérii na předchozím
`bdbcd201` a opravy nalezené jejím rozborem. Tento záznam nepřijímá nový
rozhodovací profil, rychlou sadu ani jiné role a nemění původní NEROZHODNUTO.

## Odvozená rozhodovací způsobilost — zadání operátora 19. 9. 2026

Po revizi oprav operátor požaduje odstranit ručně nastavovaný `decisionReady`.
Hodnota má vycházet z uložené přejímky hodnotitele podle §3 a přijatého
párového provozního měření podle §8 kroku 5 pro konkrétní contract SHA.
Chybějící přejímka znamená `false`; záznam musí umožnit dohledat proč.
Tento pokyn nepřijímá žádnou existující sadu ani vývojové modelové výsledky.
Implementace a validační meze jsou v
[packetu přejímací brány](../review/2026-09-19-EVALUATION-ACCEPTANCE-GATE.md).
