# GPU hunt: oprava měřidel po nezávislém posouzení

Adresát: operátor a nezávislý reviewer. Autorita: pokyn operátora 20. 9. 2026,
WP-GPU-HUNT-HANDOFF-20260919 §5, DIRECTION a nezměněný evaluační kontrakt.

## Rozsah opravy před novým sběrem

- CODE: zadání pěti úloh popisují pouze upravovaný úsek, nikoli práci hotovou
  v okolním historickém fixture. Nové fingerprinty; původní identity jsou
  zaznamenané v `supersedesTaskFingerprint`. Historické výsledky se nemění.
  Dodatečné spustitelné kontroly ověřují zachování všech původních ownerů,
  jejich sdílenou/exkluzivní klasifikaci, cleanup identity a veřejné API.
  Oprava interpunkčního assertu se provádí pouze v odhozeném worktree orákula.
- D1/D2/R1/R2: skutečný připnutý kontext authority, identity, response třídy,
  spotřebitelů výsledku, producenta testových chyb a historických callerů.
  D2 připouští doloženou alternativní opravu a jiný doložený nebezpečný shortcut.
  Typed exception není skrytá podmínka tam, kde veřejný kontrakt dovoluje error result.
  Tápání opravené v odpovědi se netrestá; chybný aspekt se nenuluje opakovaně.
- CHAT: opraveny tři sporné veřejné kontrakty. Dvacet z 40 úloh nahrazeno
  vícepodmínkovými úlohami s deterministickým JSON orákulem; ostatních dvacet
  zůstává otevřených jazykových úloh pro nezávislé čtení. Zachováno 24 EN / 16 CS.
- VISION: 22 různých obrazových úloh a kontrola bez obrázku, od základního vjemu
  po spojování tabulek, verze, časová okna, kritickou cestu, měny a skryté údaje.
  Obrázky jsou syntetické a veřejné vývojové případy. Nejde o test fotografií
  ani o oddělený provozní holdout. Převaha správných odpovědí není sama vadou;
  rozlišitelnost nových úloh ještě musí ukázat sběr.
- Obsah a formát: strojový rozpad vykazuje obsahové skóre a formát zvlášť.
  Správný JSON uvnitř Markdown fence nedostane PASS pro striktní formát.
  VISION PASS vyžaduje všechna pole správně i správný formát, ne překročení 0,7.
- Produkční T5: `measurementReady=false` a `EVALUATOR_T5_FORBIDDEN` pro staré
  substringové sady. Přímé volání produkčního runneru je odmítá před inferencí.
  Historické známky zůstávají uložené. Nové otevřené úlohy jsou cestou sběru
  bez automatické známky; přijatý T4 hodnotitel stále neexistuje.
- Ruční runner zakazuje známkování cíle stejným digestem. Telemetrie
  `size == size_vram` se výslovně nepovažuje za nezávislý důkaz umístění;
  zachovávají se NVIDIA vzorky a provider log pro následný audit.

## Uzamčený plán nového sběru

Qwen3.8: všech sedm rolí; Devstral-small-2: šest textových rolí;
Ornith-1.5:9b: VISION; Gemma4:26b: CODE. Jde o již instalované artefakty.
Qwen a Devstral pokračují jako dvojice pro opravený kontext, Ornith jako
samostatná menší vision alternativa; Gemma rozšiřuje CODE, kde předchozí
Devstral nebyl přesvědčivý. To není závěr o kvalitě nových výsledků.

Tři opakování každé úlohy, stejné zadání a limity v rámci role, celkem
633 pokusů (D1/D2/R1/R2: po 48, CHAT: 240, VISION: 138, CODE: 63).
Bez umělého prodlužování testů; délka je pozorování, nikoli podmínka kvality.
Nový oddělený evidence root:
`/home/belphareon/Projects/coworker/intentsmith-hunt-repair-20260920`.
Raw odpovědi a anonymizovaný čtecí přehled jsou oddělené od jakýchkoli známek.
Kritéria s vadným zadáním zůstávají NULL, nevytvářejí chybu modelu; nové
zadání se nemíchá s odpověďmi získanými na starém zadání.

## Přejímací meze

Oprava kódu ani autorské sondy nejsou nezávislá přejímka. Dokud neproběhne
nové čtení odpovědí a oddělená provozní kvalifikace podle kontraktu, zůstávají
rozhodnutí, aplikace vazeb, mazání a timer neaktivní. Rozdíly průměrů ani
počet úloh samy neprokazují předpovědní platnost či nezávislost případů.
Sběr je vývojové měření, nikoli soutěž na novém holdoutu.

## Závěrečný výsledek 20. 9. 2026

**Opravený sběr a podklady: READY_FOR_INDEPENDENT_REVIEW. Autonomní rozhodování:
NO_GO. Nasazení do instalované aplikace: NOT_DEPLOYED.** Nejde o přijetí
hodnotitele, modelu do role ani celého GPU huntu. Zásadní vady z posouzení
jsou opravené v kandidátu; úplné rozhodování stále závisí na nezávislé
přejímce a provozní kvalifikaci podle nezměněného kontraktu.

### Nové skutečné měření všech rolí

| Role | Úloh na kandidáta | Kandidáti | Opakování | Zaznamenané pokusy |
|---|---:|---:|---:|---:|
| CODE | 7 | 3 | 3 | 63 |
| CHAT | 40 | 2 | 3 | 240 |
| VISION | 23 (22 obrázků + kontrola bez obrázku) | 2 | 3 | 138 |
| D1 | 8 | 2 | 3 | 48 |
| D2 | 8 | 2 | 3 | 48 |
| R1 | 8 | 2 | 3 | 48 |
| R2 | 8 | 2 | 3 | 48 |
| Celkem | 102 různých zadání | 4 různé artefakty v panelu | | 633 |

632 odpovědí bylo dokončeno. Devstral `d2_history_late_guard`, opakování 2,
vyčerpal 8 192 výstupních tokenů. Je to zaznamenané nedokončení, nikoli
neplatné prostředí ani platný správný prefix. Zůstává v počtech.

Celkem proběhlo **634 provider volání**: navíc jedno Qwen volání č. 104
odmítla následná kontrola `GPU_FOREIGN_WORK_PRESENT`. Odpověď zůstává v raw
archivu a `interruption-01`, není součástí 633 platně zachycených pokusů.
Příčinu přítomnosti cizí práce bez zachyceného PID nelze určit. Po ověřeném
uvolnění GPU pokračoval tentýž plán; odmítnutí nebylo změněno na nulu modelu.

Sériová fronta běžela od 19. 9. 23:18:41 do 20. 9. 00:56:04 UTC, přibližně
97 minut. Celé běhy: Qwen 52,02 min (včetně přerušení), Devstral 42,46 min,
Ornith pouze VISION 1,46 min, Gemma pouze CODE 1,02 min. Tyto rozsahy nejsou
stejně velké. U CODE jde o krátké lokální úpravy a ne o 20–30minutové řešení
celého projektu; délka nebyla uměle natahována. Rychlý kvalifikovaný profil
z tohoto vývoje zatím odvozen nebyl.

Identita každé odpovědi je v receiptu; úplné digesty jsou v `identity-key.json`
a jednotlivých `result.json`. Panel:

| Model | Role | Digest (zkrácený; úplný v evidenci) |
|---|---|---|
| qwen3.8:latest | všech 7 | 22130167c4c2 |
| devstral-small-2:latest | 6 textových | 24277f07f62d |
| ornith-1.5:9b | VISION | e5df7dcdd8a2 |
| gemma4:26b | CODE | 08ae7ec1744b |

### Oddělení sběru, známek a nezávislého posudku

Sběr běžel na čistém `01b30ae6fa8885b65ac3ae997a3ee6f5a243306c`, bez
hodnotitele-modelu a bez zápisu výsledků do produkční DB. Provider všech
pokusů: `0.34.2-intentsmith.1`, přesný digest v odpovědi. Pro každou úlohu
byly napříč kandidáty stejné zprávy, obrázky, kontext, limity a nastavení.
`collection-integrity.json` ověřuje raw záznamy, 102 vstupů, provider receipty,
úplnost i vyloučené volání; **PASS**.

Konečný kód hodnocení a zobrazení je
`b9b7707b60c79dbc9cccd68f20e3f2c92f3834cd`. `input-equivalence.json`
potvrzuje nezměněných 102 veřejných vstupů a generačních profilů, nezměněné
inferenční soubory a spustitelné CODE orákulum. V CODE adaptéru přibyly
pouze čtyři diagnostické vlastnosti; odstranění těchto řádků vrací přesně
původní bytes. To není tvrzení o provozní kvalifikaci finálního runtime.

Po sběru je odděleně vyhodnoceno **315 pokusů deterministické části**:
CODE 63, VISION 138 a 19 přesných CHAT úloh × 2 × 3 = 114. Dalších
**317 dokončených otevřených odpovědí čeká na posouzení**; jeden otevřený
pokus nedokončil výstup. Žádná chybějící sémantická známka nebyla doplněna
nulou ani neprověřeným modelovým soudcem. 113 různých dvojic úloha/odpověď
má vlastní deterministické vyhodnocení; opakované stejné odpovědi mají
výslovný odkaz `reusedExactExecutionFrom`.

Autorské hodnocení není nezávislá přejímka: autor zná kandidáty a psal část
úloh. Metadata proto nesou `blindToIdentity:false` a
`independentAdjudicator:false`. Anonymizovaný export naproti tomu neobsahuje
mapu identity ani známky. Vzorek má 15 rizikových/nových složitých úloh a
15 reprodukovatelně náhodně vybraných odpovědí; stejné odpovědi stejné úlohy
jsou deduplikované. Nejde o 30 prokázaně nezávislých scénářů. CODE není ve
vzorku ke známkování čtením; vyžaduje spustitelné orákulum.

### Korekce, které přinesla kontrola nových odpovědí

- `en_instruction_priority`: správná fakta bez koncové tečky jsou obsahově
  správně, ale porušují výslovný doslovný formát. Neudanému pořadí položek
  se nepřidává skryté pravidlo. Předchozí mezivýsledek je zachovaný.
- `cz_grammar_correction`: porovnání celé věty s jediným řetězcem bylo
  neplatné měřítko jazykové varianty. Úloha přešla z T2 do otevřeného
  posouzení, **bez automatické známky**. Původní i opravená rubrika jsou
  rozlišené; prompt ani odpovědi se zpětně nezměnily. Proto je konečný
  CHAT profil 19 deterministických a 21 otevřených úloh, nikoli původních 20/20.
- Uzavřené názvy dnů a režimu nemají neudaný požadavek na velikost písmen.
  Syntetický protipříklad `Středa` proti `středa` je opraven, nesprávný den
  a typ zůstávají chybou. Oprava nezměnila žádnou ze 114 získaných odpovědí.
- Adaptér CODE původně zahazoval výpis a názvy původních kontrol. Nyní se
  zachovají `testFiles`, `targetNames`, `regressionNames` a `testOutput`
  přes čtecí model až do detailu. Replay všech 633 záznamů potvrdil stejné
  známky, stavy a verdikty před/po doplnění diagnostiky. Export byl ověřen
  na konkrétním neúspěchu, ne pouze na zelené referenci.

Korekce CHAT mění identitu hodnotitele. Zachycený kontrakt je
`ccd52ef7bca5a1db155091e512479e4bd4909ed53fbb371ba2af9c6c4c1603a4`,
konečné offline známkování
`be0b16a4b5f928867d75791d9397ba1bfe08539535a13840ee8f085d94cf1eaf`.
Historická skóre se nepřepisují a nové identity se nesměšují.

### Oprava známé CODE regrese a ověření orákul

Původní odpověď Devstralu, která měla 8/8 historických VRAM kontrol PASS a
současně odstranila sdílené vlastníky, byla přehrána proti nové sadě.
Výsledek: platné **INCORRECT / 0** s konkrétními selháními
`MODEL_VALIDATION`, `BINDING_VERIFICATION`, `BINDING_CUTOVER`. Původních
8/8 PASS zůstává vidět. Důkaz `old-owner-regression-replay.json` prokazuje
opravu této mezery, nikoli úplnost orákula pro libovolný kód.

Na čistém finálním zdroji `b9b7707b` prošlo **7 CODE úloh / 62 kontrol**
a **23 VISION úloh / 276 kontrol**, včetně správných alternativ a negativů.
CODE uvádí 5 deklarovaných skupin; jejich skutečnou nezávislost tím netvrdí.
`code-oracles-final-source.json`, `vision-oracles-final-source.json`.
Původní nezdařené pokusy i jejich opravy jsou zachované, včetně reprodukce
z bundle, která nejprve neměla závislosti a až po jejich doplnění prošla.
Závislosti byly zkopírovány z pracovního prostředí; není to důkaz čistého
nového `npm ci` na jiném hostu.

### Co nové výsledky říkají — a co ne

Obsahové průměry se liší u **5 z 19 deterministických CHAT úloh** a
**11 z 23 VISION úloh**. U CHAT zůstávají 4 přesné úlohy, kde oba kandidáti
mají nulový obsahový podíl, a 7, kde mají oba plný. To je důvod číst konkrétní
chyby a kontrolovat adekvátnost; rozptyl sám není důkaz platnosti testu.

Čísla a chyby jsou v oddělených `deterministic-assessment.html/json` a
`assessment-summary.json`; odborné posouzení konkrétních odpovědí v
`author-observations.md`. Obsahové podíly přesných polí nejsou sémantická
známka poctivého pokusu podle DIRECTION. Správnost formátu je další samostatný
údaj. Průměry nepokrývají otevřenou část CHAT ani analytické/revizní role.
U CODE jsou výsledky lokálních oprav, nikoli dokončení projektu.

U nových D1/D2/R1/R2 odpovědí jsou doložené správné nálezy i věcné chyby:
například přiřazení nové hodnoty do `const`, záměna sdílené a výlučné
rezervace nebo tvrzení o trojím započítání opakování navzdory dodanému
seskupení do průměru. Dvě lokální reprodukce jsou přiložené; nejde o nový
souhrnný modelový žebříček. Žádná role tím nezískala doloženou předpovědní
platnost pro reálný opravný postup.

### GPU, provider a aktuální provoz

Logy všech čtyř modelů vykazují úplné offloadování uvedených vrstev a žádné
zaznamenané ořezání vstupu. Maximální **vzorkované celkové** GPU využití
paměti: Qwen 20 472 MiB, Devstral 18 870 MiB, Ornith 8 157 MiB, Gemma
20 633 MiB. Jde o vzorky celkové paměti včetně ostatních alokací, nikoli
exaktní špičku samotného modelu či důkaz nulových CPU alokací.

**Otevřená vada providera:** Gemma API uvádí jen 998 737 181 bajtů,
což je méně než vlastní CUDA váhy v logu. Přepis přesně připnutého
`memoryParsingWriter` do diagnostiky reprodukoval přepsání hlavních bufferů
MTP draft buffery: klíč mapy nerozlišuje hlavní a draft model. Reprodukce
používá zachovaný starší Gemma log a přesné zdrojové regexy; není to spuštění
Go testu ani zjištění skutečného součtu všech alokací. Provider v tomto kole
opraven/přestavěn nebyl. Rovnost `size == size_vram` není platná paměťová
kvalifikace a nesmí sama rozhodovat o stažení či mazání.
`hardware-audit.json`, `provider-accounting-replay.json` a podpůrné zdroje
jsou v archivu. Před autonomním provozem je oprava/ověření tohoto účtování
samostatný nutný krok.

Po sběru: timer **disabled/inactive**, `ollama ps` prázdné, žádný NVIDIA
compute proces, sidecar ukončen. Pracovní checkout nebyl instalován přes
cizí produktovou větev: aplikace má revizi `9660d99b…`. Nová T5 brána a UI
změny jsou **v review větvi, nikoli doloženě v této nainstalované verzi**.
Modely nebyly automaticky mazány ani přiřazovány. Žádný přejímací záznam
nebyl vytvořen a žádný rozhodovací profil otevřen.

### Proklikání a reprodukovatelnost

Skutečný renderer prošel 16 kontrolami: filtry, správné zadání a obrázek,
anonymita, známka s důvodem, zachování po reloadu, skutečné stažení JSON,
přímé odkazy vzorku, vyčištění prázdného filtru, zamčené známkování CODE
čtením a neúspěšný CODE detail s původním testovým výpisem. Screenshoty
jsem otevřel a zkontroloval. `review-ui.json` má PASS.

Rozsah je samostatný review export v diagnostickém Electronu se softwarovým
vykreslováním a `--no-sandbox`, nikoli fyzická přejímka nainstalovaného Studia.

Source bundle obsahuje i historickou revizi `570782eb…`, která není předkem
HEAD a při prvním rozšířeném ověření chyběla. Nový prázdný bare clone ověřil
43 potřebných commitů včetně zdroje sběru, konečného hodnotitele, všech CODE
historií a historických revizí z opravdu dodaných role promptů. První
neúspěch zůstává zaznamenaný; nešlo o chybějící vstup při inferenci.

### Co ještě brání funkčnímu autonomnímu huntu

1. Nezávisle posoudit nové odpovědi a přiměřenost rubrik; sporné případy
   rozsoudit operátorem. Vadné kritérium vyloučit, neopravovat modelovou
   známku na sílu. Změní-li se veřejné zadání, potřebují oba kandidáti nové
   odpovědi; stará data zůstávají vývojová.
2. D2/R2 převádět na spustitelné reprodukce tam, kde lze výrok skutečně
   ověřit. Zbytek T4 vyžaduje nezávisle přijatého hodnotitele se samostatným
   ladicím a přejímacím vzorkem, chybovostí po druzích úloh a prohazováním
   pořadí. Tento sběr žádného takového hodnotitele nepřijímá.
3. Ověřit výběr na nové oddělené provozní sadě v IntentSmith workflow,
   se stejným profilem obou modelů a předem uzamčenými pravidly. Dosavadní
   vypálené případy ani opakování jedné úlohy nenahradí další historické
   případy. Rovnost či neprůkazný rozdíl znamená NEROZHODNUTO.
4. Opravit/nezávisle ověřit provider paměťové účtování, integrovat změny do
   aktuální produktové linie a projít skutečnou cestu ve Studiu: stažení,
   průběh/ETA, měření, detail, odpojení/obnova, verdikt, chráněné přiřazení
   a retence. Tento běh takovou produktovou přejímku nenahrazuje.
5. Teprve evidence §3 a §8 pro konkrétní contract/runtime může otevřít
   odvozenou rozhodovací bránu. Do té doby timer, automatická aktivace a
   mazání zůstávají mimo tento průchod.

Praktický další krok: otevřít `review-sample.html`, vyplnit kritéria a
konkrétní důvody, stáhnout JSON; teprve potom porovnat oddělené autorské
posouzení. Tím vznikne podklad pro další krok handoff §5, nikoli další
nepodložený příslib hotového huntu.

### Závěrečná regrese a zachování neúspěchů

Na čistém finálním `b9b7707b` doběhlo 364 programů profilů `offline,database`:
**363 PASS / 1 FAIL / 0 BLOCKED / 0 TIMEOUT**. Celkový verdikt runneru zůstává
**FAIL**, nikoli „všechny testy zelené“. Selhává
`IS-T1-TESTS-NIGHTLY-ORCHESTRATOR-SELF-TEST`:

> Nightly evidence contract violation: registry hash differs from the reviewed Gate 0 policy

Současný registr má SHA256
`47ff3ca5944a2ae0ba88bb86c3ff21675898aadc931b9f3c70cad32e760455b8`.
Nezávisle přijatá release pečeť nebyla přepsána kvůli získání PASS.
Kontrola aktuální pečeti není v tomto průchodu přejata; nelze ji potichu vyřadit.

`test-validation-summary.json` a `regression/` obsahují konečný report,
inventář, checkpoint a všechny logy i ze dvou předchozích širokých průchodů.
První měl 348 PASS / 6 FAIL / 10 BLOCKED; po opravách metadat, očekávání
nových sad a explicitním zpřístupnění PDF/OCR testových runtime prostředí
zůstala uvedená kontrola pečeti. Tím nejsou původní pády skryté.

Zdrojový bundle `source-b9b7707b-with-history.bundle`, SHA256
`132306a64d64311b88cd00fe891ffdd05fd751f2b526646d59bdf2eb2d2aeddc`,
obsahuje finální kód a 43 ověřených potřebných commitů. Závěrečné doplnění
zprávy je následný dokumentační commit; nezmění již změřený runtime.

### Předávané soubory a archiv

Doporučené pořadí: nejprve anonymní vzorek, potom oddělené autorské posouzení.

- [30 anonymních odpovědí k posouzení](/home/belphareon/Projects/coworker/intentsmith-hunt-repair-20260920/review-sample.html)
- [Všech 633 pokusů, zadání a obrázky](/home/belphareon/Projects/coworker/intentsmith-hunt-repair-20260920/review.html)
- [Moje oddělené odborné poznámky](/home/belphareon/Projects/coworker/intentsmith-hunt-repair-20260920/author-observations.md)
- [Rozpad deterministických kontrol](/home/belphareon/Projects/coworker/intentsmith-hunt-repair-20260920/deterministic-assessment.html)
- [Návod k reprodukci a meze důkazu](/home/belphareon/Projects/coworker/intentsmith-hunt-repair-20260920/README-EVIDENCE.md)
- [Souhrn testů včetně jediného FAIL](/home/belphareon/Projects/coworker/intentsmith-hunt-repair-20260920/test-validation-summary.json)

Archivy jsou obsahově adresované a ověřené po zabalení; přenos mimo tento
host nebyl součástí běhu. Verifikace porovnala 1265 souborů úplného archivu.

| Balík | SHA256 | Velikost |
|---|---|---:|
| [blind-review](/home/belphareon/Projects/coworker/intentsmith-hunt-repair-20260920/blind-review-63768c5946f142aa.tar.gz) | `63768c5946f142aa0b203ee8c4807cbcebd3d5642a1dd3103a9766b6fa3d91a6` | 1,945,991 B |
| [separate-assessment](/home/belphareon/Projects/coworker/intentsmith-hunt-repair-20260920/separate-assessment-1111cbe10f9ae819.tar.gz) | `1111cbe10f9ae8194db13aa9d99c39d6cd9c49eda113f1e9d7849702813b7cd6` | 2,841,925 B |
| [complete-evidence](/home/belphareon/Projects/coworker/intentsmith-hunt-repair-20260920/evidence-303994441a9f7ce8.tar.gz) | `303994441a9f7ce85ccbe4d1f66153c340fcfae8ff24f1a2c8c82f4d230ef709` | 85,849,161 B |

Zdrojový bundle v archivu končí finálním produktovým kódem `b9b7707b`.
Tento závěrečný text s hashy je následný dokumentační commit, aby nevznikl
kruhový požadavek na hash archivu obsahujícího vlastní hash.
Pomocný čistý worktree byl po začlenění odstraněn; důkazy a cizí checkouty
zůstaly zachované. Plná sada 317 otevřených odpovědí není autorem jednotlivě
oznámkovaná: oddělený odborný text obsahuje ověřené konkrétní příklady,
nikoli předstíranou přejímku všech odpovědí.
