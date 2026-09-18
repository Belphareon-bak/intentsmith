# Audit výpovědní hodnoty evaluací — 18. 9. 2026

Historický audit; následné opravy a nové VISION běhy jsou samostatně
v [navazujícím review](2026-09-18-EVALUATION-HARDENING-VISION.md).
Níže uvedené výsledky a závěry původního běhu zůstávají zachované.

Stav: **potvrzené vady hodnotitelů a nedostatečné pokrytí; opravy a quick/full
profily nedodané**. Toto je technický audit na výslovné zadání operátora,
nikoli přijetí benchmarku ani tvrzení, že je produkt hotový. Nezávislé review
tohoto auditu zatím neproběhlo.

## Závěr

Podezření operátora je opodstatněné. Nuly a jedničky jsou v jednotlivých
kontrolách korektnosti normální. Problém zde tvoří kombinace úzkých a snadných
sad, souvisejících úloh, chyb hodnotitelů a výběru extrémů v UI. Existující
skóre nelze vykládat jako obecnou schopnost modelu plnit roli.

Quick/full režimy skutečně neexistují. Je implementováno nové měření nebo
opětovné použití přesně odpovídajícího výsledku, nikoli dva rozsahy benchmarku.
Předchozí dodávka tuto část výslovně vyloučila; požadavek operátora zůstává
nesplněný. Prodlužovat existující sady opakováním do 30 minut by tento problém
nevyřešilo.

## Co bylo skutečně ověřeno

- Živý read model `/api/system/models/evaluations` z **18:17:35 CEST**,
  `generatedAt=2026-09-18T16:17:35.675Z`, provider
  `0.34.0-intentsmith.1`. Pro statistiku jen COMPLETE, technicky použitelné
  artefakty pod aktuálním kontraktem a providerem, nikoli směs historie.
- Instalovaný zdroj `577269693b6bc3f469a859b448d7b5fd07f87819`; všech sedm
  kontrolovaných souborů evaluačního jádra má stejné bajty jako auditovaný
  checkout `c5e8185d713fb00e5f65af8224051ace901ccabe`. Instalace je z jiného
  checkoutu a nebyla přepisována.
- Zadání, hodnoticí funkce, kontrakty, výběr a opakování úloh, skutečné uložené
  odpovědi a detaily dvou konkrétních běhů; šest negativních/parafrázových sond
  a jedna sonda identity hodnotitele. Sondy nejsou nové inference modelů.
- Znovu ohodnoceno **2 758 uložených odpovědí z 57 současných běhů mimo CODE**:
  žádný rozdíl proti uloženým bodům. Pět odpovědí na hranici ořezu 2 000 znaků
  bylo vynecháno. Jde o kontrolu konzistence implementace, nikoli sémantické
  správnosti hodnotitele; současné vady se tím reprodukují, ne vyvracejí.
- Znovu spuštěný CODE oracle: všech **7 referenčních oprav má 1**, všech
  **7 původních vadných verzí má 0**. To ověřuje rozlišení těchto konkrétních
  oprav, nikoli úplnost skrytých testů nebo férovost všech zadání.
- Existující `tests/model-evaluation-suites.test.js`: **27/27 PASS**.
  Současně auditní sondy potvrzují vady. Zelené unit testy tedy neprokazují
  sémantickou správnost a reprezentativnost benchmarku.

Produkční DB, modely, bindings, plánovač a instalovaný runtime se neměnily.
V tomto auditu neproběhla nová GPU inference ani uživatelský průchod GUI;
UI nález je ověřený ve zdroji a proti dodanému screenshotu.

## Naměřené rozdělení

Buňka znamená průměr jedné úlohy pro jeden model přes tři opakování.
„Nerozlišuje“ znamená přesně stejné skóre všech změřených modelů dané role.
Rozdílně velké panely se nesmějí přímo srovnávat jako obtížnost rolí.

| Role | Úloh | Modelů | 0 % | 100 % | Mezihodnoty | Nerozlišujících úloh | Medián měření |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| D1 | 12 | 9 | 5 | 73 | 30 | 5/12 | 46 s |
| D2 | 12 | 11 | 16 | 77 | 39 | 1/12 | 50 s |
| R1 | 12 | 8 | 5 | 65 | 26 | 6/12 | 56 s |
| CODE | 7 | 3 | 10 | 7 | 4 | 1/7 | 169 s |
| R2 | 10 | 11 | 16 | 27 | 67 | 0/10 | 48 s |
| CHAT | 40 | 11 | 1 | 245 | 194 | 7/40 | 94 s |
| VISION | 5 | 7 | 6 | 23 | 6 | 0/5 | 34 s |

Je to 60 aktuálních COMPLETE buněk model×role, 942 buněk model×úloha.
V **873/942 (92,7 %)** mají všechna tři opakování stejné skóre. D1 samotné
má 105/108 takových buněk. Stejné skóre neznamená nutně stejný text odpovědi.
Různé role téhož modelu nejsou nezávislé modely ani nezávislé úlohy.

U D1 všichni dosahují 100 % v `history_early_guard`, `order`, `rate`,
`transform`; v `audit_error_envelope` všichni dosahují 50 %. U R1 je navíc
uniformní `logic` na 100 %. Také jednotný částečný výsledek může být
nerozlišující. Větší počet desetinných míst nepřidává důkaz.

## Konkrétní nálezy

### 1. D1, D2 a R1 nedostávají odlišné role-specific úlohy

`src/eval/role-quality-suites.js:759` a `:904` mapují všechny tři role na
**stejných 12 promptů, stejný hodnotitel a stejný suite hash**. Výsledky se
správně ukládají odděleně podle role, ale jejich obsah neměří tři rozdílné
schopnosti. Rozdíl téhož modelu mezi těmito rolemi může být variabilita běhů.

Osm úloh jsou krátké početní/logické příklady: sleva a daň, čtyři závislé
kroky, kritická cesta, součet čtyř čísel, množiny, konstantní rychlost,
jednoduchá logika a aritmetická transformace. Čtyři úlohy vycházejí z repa,
ale dvě jsou varianta před/po opravě téže historie. Kontext předem poskytuje
mnoho rozhodujících faktů. To je užitečná kontrola sledování toku programu,
nikoli náhrada hledání příčiny napříč soubory, návrhu řešení nebo hluboké revize.

### 2. CHAT hodnotí část významu pouhým výskytem slov

V `en_grounded_summary` (`role-quality-suites.js:92`) dostalo **100 %**:

> Project Northstar launches on October 14 with a $2.4 million budget; Maya
> Chen owns delivery and a delayed battery supplier is the only risk, but
> actually it launches in December with a $9 million budget and Alex owns delivery.

Text obsahuje všechny hledané výrazy, ale výslovně popírá tři klíčové údaje.
Penalizace zná pouze konkrétní jiné hodnoty October 15 a 2.5 million.

Naopak věcně správná parafráze obdržela **40 % / failed**:

> Northstar launches on 14 October with an approved budget of USD 2,400,000.
> Delivery is led by Maya Chen. The sole risk is a delay from the battery supplier.

Přeházené datum, ekvivalentní zápis částky a „led by“ nezapadají do regulárních
výrazů. Je prokázaný falešně pozitivní i falešně negativní výsledek.
`en_state_updates` navíc uvádí celou správnou JSON odpověď už v promptu;
měří tím hlavně kopírování instrukce.

### 3. VISION má jen tři různé obrázky a vadné kontroly atributů

Pět úloh tvoří červená plocha 8×8, tři barevné body 16×16, kruh 32×32,
stejné body česky a jedna úloha **bez obrázku**. Chybí OCR, screenshoty,
tabulky, diagramy i lokalizace konkrétních prvků.

`vision_ring` dalo **100 %** pro
`{"shape":"not a circle or ring","foreground":"not black","background":"not white"}`.
`vision_dots` dalo **100 %** při přidání neexistujících žlutých a černých bodů
do seznamu barev. Příčina je kontrola podřetězců a absence postihu za další
nepravdivé atributy (`role-quality-suites.js:841–895`).

### 4. R2 nezapočítává některé falešné nálezy

`gradeFindings` (`role-quality-suites.js:775`) počítá false positives podle
neznámého **druhu** vady. Dva správné nálezy doplněné o 100 dalších
`sql_injection` na neexistujících řádcích 1000–1099 získají **100 %**.
Nestačí kontrolovat taxonomii; musí se párovat a započítat každý nález včetně
duplicit, lokace a nepodloženého tvrzení.

### 5. Formát může zakrýt chybu obsahu a část bodů není schopnost úlohu vyřešit

`parseJson` vytáhne objekt i z dalšího textu. Prompt vyžaduje ONLY JSON,
ale „The actual total is 1 dollar.“ před správným JSON rozpočtem získá
**100 %**. Prosté `{}` v úloze pořadí získá **50 %**, protože jedna ze dvou
stejně vážených kontrol je samotný parse. To není PASS, ale ukazuje, proč
je potřeba oddělit správnost řešení a dodržení formátu.

### 6. CODE je funkční oracle, ale velmi úzký benchmark

Aktivních je 7 z 37 uložených úloh; 29 je `reserve-floor`, jedna
`reserve-unstable`. Aktivní výřezy mají 12–52 řádků. Dvě úlohy opravují
konstanty/sdílené vlastníky téhož `model-use-authority.js`, dvě další
časovač v téže `_verifyModel`. Šest ze sedmi pochází z `src/upgrade`, jedna
z `src/core/chat-turn-error.js`. Nejde o sedm různorodých projektů ani
o plný agentní cyklus hledání, editace, testování a nápravy.

Kalibrace se opírala i o modely, které tento benchmark následně porovnává.
Chybí oddělený potvrzovací panel a nezávislá sada úloh pro ověření pořadí.
Vyřazovat úlohy jen proto, že je současný panel neumí, může zakrýt schopnost
budoucího modelu; obtížné reprezentativní úlohy patří do potvrzovací sady.

Historický qwen3-coder run `eval_51da4e2a-7465-4837-b310-41305e890ccf`
skončil v 11:19:38 CEST, trval **109 278 ms**, měl 7 úloh×3 opakování.
Task means jsou **0, 0, 0, 0, 0.8, 0, 0**, tedy **0.8/7 = 11,43 %**.
Všech 21 odpovědí bylo podle uložených detailů syntakticky platných a
aplikovaných; žádná nebyla vynulována kvůli regresi. U páté úlohy prošly
4/5 cílových kontrol. Ostatní cíle nesplněny.

Tento výsledek patří kontraktu `6ee5ab47…`; aktuální CODE kontrakt je
`82d70e89…`. Aktuální read model správně hlásí u codera **MISSING / SUITE_CHANGED**.
Číslo 11,43 % není současná autorita pro výběr nebo smazání modelu.

CODE odpovědi se navíc před uložením ořezávají na **500 znaků**
(`code-patch-suite.js:325`). Hodnotitel dostává celou odpověď, takže to samo
nemění skóre, ale z DB nelze u delších odpovědí znovu přehrát přesný patch.
Přesnou příčinu každé nesplněné kontroly nelze z uloženého prefixu doložit.

### 7. Změna sdíleného hodnotitele nemusí změnit kontrakt

`suiteContract` hashuje text `grade` funkce, ale u textových sad nezahrnuje
bajty sdílených helperů `checklist`, `parseJson`, `gradeFindings` atd.
V čistě paměťové kopii modulu jsem změnil výpočet `checklist` na nulu.
Správná rozpočtová odpověď se změnila z **1 na 0**, avšak hash zůstal
`2bbda86b76ff4ecf99121193eb32e72a00049d1f8ca632410495d512a998f3b2`.

To prokazuje možnost chybného reuse po změně helperu bez ručního zvýšení
verze. Neprokazuje, že k takové změně již došlo v konkrétním uloženém běhu.
Přehrání 2 758 kompletně uchovaných odpovědí naopak nenašlo současný rozdíl.
Před opravou hodnotitelů musí být opravené zahrnutí jejich implementace do
kontraktu; CODE už obdobné připnutí runtime má.

### 8. UI a doba běhu vytvářejí nesprávná očekávání

`_modelResultBullets` řadí úlohy podle skóre a ukazuje nejvýše tři výsledky
≥80 % a tři <50 %. Prostřední pásmo při existenci extrémů nezobrazuje.
Proto screenshot působí ještě binárněji než všechna data.

Obecné inference mají limit 512 výstupních tokenů, kontext 4096,
temperature 0.1; VISION temperature 0. CODE má 4096 výstupních tokenů
a kontext 16384. `think:false` je i v produkční gateway: nevytvářím proto
nepodložený nález, že právě tento přepínač odlišuje benchmark od produkce.
Krátká JSON odpověď opravdu může vzniknout za sekundy. Doba sama o sobě
neprokazuje podvod ani kvalitu pokrytí.

Dřívější screenshot 44 s výslovně uvádí „použito platné měření“: tento čas
nepředstavuje nové kompletní skórování. Současné tlačítko nového měření
vede na `fresh: EVALUATE_INSTALLED`, ale stále na stejnou sadu×3.
Controller přijímá pouze model, digest, roli a hash sady; volbu quick/full
nemá. Ani trojí opakování nezakládá další nezávislé testovací scénáře.

## Doporučené řešení

Následující je návrh vycházející ze zadání operátora, **není implementovaný
stav ani nový schválený kontrakt**.

1. Opravit a zneplatnit chybné hodnotitele novou verzí kontraktu. Přidat
   negativní i ekvivalentní správné odpovědi: negace, rozpory, další nálezy,
   alternativní zápisy dat/částek. Samotné další regexy nevyřeší volný text;
   strukturované úlohy potřebují přesnou sémantiku a jazykové úlohy zvláštní,
   kalibrované hodnocení. LLM soudce může doplnit měkké metriky, nemá být
   jediným rozhodčím funkční správnosti kódu.
2. Rozdělit skutečné schopnosti rolí: D1 plán a závislosti/omezení; D2
   diagnóza podle logů a zdrojů; R1 návrhové a bezpečnostní dopady napříč
   komponentami; R2 přesnost a úplnost lokalizovaných nálezů. CODE rozšířit
   o práci s více soubory, asynchronní chyby, data/API, UI a opravu po testu.
   Každý scénář musí obsahovat dostatečné zadání a ověřitelný referenční výsledek.
3. Zachovat malou společnou základní sadu, přidat střední a obtížné nezávislé
   scénáře z reálných incidentů/commitů. Příbuzné varianty sdružit do rodin,
   aby jeden timer nebo jedna chyba historie neměly několik hlasů v pořadí.
   Držet oddělené kalibrační a potvrzovací úlohy; neměnit sadu po každé prohře
   konkrétního modelu.
4. Zavést dva explicitní profily v UI, API, frontě i DB:

| Profil | Zamýšlený obsah | Zamýšlená doba a použití |
| --- | --- | --- |
| Rychlý odhad | Přibližně 8–12 reprezentativních scénářů relevantních rolí, jedno měření; viditelné nepokryté schopnosti | Zhruba 2–5 min/model; prioritizace fronty, nikoli potvrzený vítěz nebo důvod ke smazání |
| Úplné ověření | Přibližně 40–60 nezávislých scénářů podle schopností, složitější kontext/opravy a opakování vybraných úloh; samostatná potvrzovací část | Návrhový cíl 20–30 min/model na tomto GPU, nutno kalibrovat; podklad k potvrzenému srovnání |

   Počty a časy jsou návrhový rozsah, ne naměřený slib. Pokud uživatel vybere
   jiné role nebo pomalejší model, UI musí ukázat novou ETA a rozsah.
   Srovnávané modely musí projít totožným profilem. Dosažení časového limitu
   před koncem nesmí dostat štítek úplné ověření. Test se nesmí uměle zdržovat.
   Zaznamenat profil, verzi/rodiny úloh, parametry inference, počet skutečných
   volání, seed/strategii opakování, celé odpovědi a výstup testů, přesný digest
   modelu, verzi a identitu providera. Odhad času oddělit od načtení a fronty.
5. UI ukázat souhrn **po schopnostech** se skóre, počtem nezávislých úloh,
   pokrytím a variabilitou. Detail má rozlišit správnost, formát, regrese,
   timeout a infrastrukturu. Nejlepší/nejhorší tři úlohy mohou zůstat jako
   doplněk. Vedle skóre vždy profil, rozsah a „orientační“/„ověřené“.
6. Teprve na opravené sadě přeměřit stejné artefakty, zkontrolovat pořadí na
   nezávislých úlohách a směrovat hunt na chybějící/slabé schopnosti. Vysoké
   nebo nízké procento napříč odlišně obtížnými rolemi není samo o sobě
   srovnatelný ukazatel priority. Historii ponechat; vadný benchmark nesmí
   sám ospravedlnit odstranění modelu jako „pro nic nevhodného“.

Alternativou je připojit hotový benchmark. Doporučuji kombinaci:
vlastní reprodukovatelné úlohy pro produktové situace a oddělený externí
kontrolní vzorek. SWE-bench testuje řešení skutečných repository issues;
EvalPlus ukazuje přístup zesílení funkčních kontrol; HELM rozlišuje scénáře
a více metrik. Nejde o doporučení přepsat produkt jedním číslem z leaderboardu.
[SWE-bench](https://www.swebench.com/SWE-bench/),
[EvalPlus](https://evalplus.github.io/),
[HELM](https://crfm.stanford.edu/2022/11/17/helm.html).

## Reprodukce a evidence

Manuální [auditní skript](../../scripts/manual/audit-evaluation-validity.mjs)
nevolá modely a nepíše do DB. Vrací JSON a **exit 1 při zjištěné vadě**;
nejde o tvrzení PASS. Na auditovaném zdroji potvrzuje šest sémantických vad
a jednu vadu kontraktu. Lze jej spustit i bez snapshotu.

```sh
node scripts/manual/audit-evaluation-validity.mjs --snapshot /absolutni/cesta/evaluations.json
```

Souhrnná strojová evidence je
[evaluation-validity-20260918.json](../execution/runs/evaluation-validity-20260918.json).
Soukromý evidence root:
`/home/belphareon/Projects/coworker/intentsmith-evaluation-validity-20260918`.
Obsahuje celý zachycený read model, uložené odpovědi vybraných běhů, rozdělení,
sondy, oracle replay a log 27 unit testů. Archiv a SHA-256 jsou uvedeny ve
strojovém záznamu. Neobsahuje databázi, port capability ani credentials.

Audit byl dokončen. Opravy hodnotitelů, širší sady, quick/full profily a jejich
fyzická GPU kalibrace zůstávají skutečnou implementační prací; tento dokument
je za hotové neoznačuje.
