# GPU hunt — závěrečný podklad pro review všech funkcí, 19. 9. 2026

**NO_GO_FOR_AUTONOMOUS_HUNT / NEROZHODNUTO / PONECHAT / REVIEW_PENDING / NOT_DEPLOYED.**

Závěrečné měření tohoto kola je dokončené; **celý GPU hunt připravený k
přijetí není**. Sedm rolí prošlo skutečnou inferencí na finálním zdroji.
Celkem 318 benchmarkových pokusů a 16 provozních CODE pokusů, 2 331
zaznamenaných odpovědí, tři instalované artefakty, žádný nový download.
CODE a VISION mají úplné průzkumné skóre. Pět ostatních rolí nemá platný
souhrn kvůli neplatným hodnocením; nedokončené odpovědi se navíc vykazují
samostatně jako vyčerpání rozpočtu. Přijatých rozhodovacích profilů: **0/7**.
Timer a automatické mazání zůstávají vypnuté, binding se tímto kolem nemění.

Toto je jeden závěrečný podklad pro review celého huntu. Níže odděluje
měření, ověřené ochrany, nalezené vady a konkrétní práci nutnou k GO.
Nevydává dokončení měřicí série za dokončení produktu.

- [Strojový souhrn, přesná kopie z archivu](evidence/2026-09-19-gpu-hunt-final-summary.json)
- [Receipt archivu](evidence/2026-09-19-gpu-hunt-bundle-receipt.json)
  a [výsledek druhého ověřovacího skriptu](evidence/2026-09-19-gpu-hunt-archive-verification.json)
- [Proklikávací výsledky všech rolí](/home/belphareon/Projects/coworker/intentsmith-hunt-all-roles-20260919/role-review.html)
  — úlohy, kritéria, obrázky a úplné odpovědi.
- [Proklikávací CODE benchmark a skutečné opravy](/home/belphareon/Projects/coworker/intentsmith-hunt-all-roles-20260919/code-review.html)
  — požadavky, výsledné soubory, selhání a kontroly.

HTML a velký archiv jsou lokální podklady na tomto hostu; nejsou zveřejněné
v Gitu. Jejich obsah a hashe jsou součástí ověřeného archivu.

## Rozsah a autorita

Přímé zadání operátora: připravit celek, otestovat všechny role a dodat
výsledek, verdikt a jeden dokument pro review celého huntu. Platí
WP-GPU-HUNT-EVALUATION-CONTRACT-20260918 §§3/4/6/8. Zelená implementační
zkouška, průzkumné skóre a nezávisle přijatý rozhodovací profil jsou různé věci.

Vstup: `b352173a4fcde4cf36d4a040e4dd0775dea495fe`.
Měřený zdroj: `89531748fc6fab20327e0b539cbcd176a0ffb98f`.
Větev: `work/hunt-model-controls-20260917`.
Qualification runtime SHA-256:
`dac08aaa5cd205e02edb88c572393731cff9be914455752c15b33aec4b1aa4ab`.

## Co bylo v tomto kole skutečně dodáno

- D1, D2, R1 a R2 mají samostatná zadání nad osmi historickými případy;
  R1 dostává konkrétní změnu k revizi. CHAT má 40 zadání (24 EN / 16 CS).
- Otevřené odpovědi mají modelového hodnotitele: přesný artefakt, úplné
  JSON schéma, zdrojové reference, sedm pozitivních/negativních sond,
  dvě pořadí odpovědí, výslovné důvody dílčích známek. Neúplný výstup,
  odmítnutá reference nebo rozpor pořadí dávají chybějící skóre.
- Ověřený konec na výstupním limitu se vykazuje jako
  `OPERATIONAL_FAILURE / MODEL_OUTPUT_BUDGET_EXHAUSTED / 0`. Hodnotitel
  nedostane nedokončený text k obsahovému známkování; úplná odpověď,
  tokeny a digest zůstávají v záznamu. Výjimkou je spustitelné CODE
  orákulum, kde rozhoduje dosažený a nezávisle ověřený stav opravy.
- Původní negativní sondy byly příliš snadné. Nové obsahují konkrétní,
  věrohodně formulované chybné tvrzení; nespoléhají jen na sebeoznačení
  „nesprávná odpověď“. Všechny původní neúspěchy zůstávají v důkazech.
- Výsledky obsahují počty chybných přijetí, odmítnutí a neplatných úsudků
  s viditelnými jmenovateli. Jde o autorské vývojové sondy, nikoli nezávislou
  přejímku T4. Hodnotitel a měřený Qwen jsou tentýž artefakt; bias tím není vyloučen.
- VISION má reprodukovatelných 156 kontrol nad 12 různými obrázky a kontrolou
  bez obrázku. Správná alternativní forma projde; kontroluje se i dílčí kredit,
  chybný typ, přidané pole, negace a rozporná próza kolem JSON.
- Ruční runner všech rolí používá pevný plán, rozpočet, přesný digest odpovědi
  i verzi providera, GPU lease a vlastní dočasný sidecar. Ukládá celé odpovědi
  včetně neplatných; pokračování nedostane nový časový rozpočet.
- Ollama 0.34.2 s digest/completion patchem je sestavená reprodukovatelně:
  tři sestavení shodného Go binárního souboru, ověřený nativní archiv, testy
  dokončení generování a skutečné GPU inference.

Nové sémantické sady jsou **ruční průzkumná cesta**. Produkční mapování
D1/D2/R1 stále ukazuje na legacy reasoning_v2 a CHAT na staré rubriky.
V `role-quality-suites.js` nadále zůstává obsahové známkování pomocí
`includesAny/includesAll`; produkční `measurementReady` je neodmítá podle
úrovně hodnotitele. **Zákaz nového T5 skórování podle §2 tedy není v celé
produkční cestě dokončený.** Uzavřená rozhodovací brána tento implementační
nedodělek nenahrazuje.
Výsledky tohoto runneru nejsou importované do produkční DB/Studia. To je
otevřená integrační práce, nikoli vlastnost schovaná pod slovem „hotovo“.
Průzkumný plán nese hash sady a zvlášť úplného runtime. Jeho kontrakt není
identický s produkčním `createRoleEvaluationPlans`, který přidává další
verzi a grading-runtime metadata. Záznam proto nelze prostě přejmenovat
na platné produkční měření nebo obejít autoritativní writer.

## Měření a jeho meze

Běh byl po 192 cílových pokusech přerušen `GPU_FOREIGN_WORK_PRESENT`
(16:21:38 UTC). Identita cizího procesu není v receipt doložená; nebyl
zastaven. Původní `CLEANUP_FAILED` a úplné logy jsou zachované v
`all-roles-final-04/interruption-01`. Pokračování používá stejný plán,
source SHA i původní šestihodinový rozpočet. Ověření hodnotitelů se po
obnovení opakuje; jejich opakované sondy nejsou další nezávislá pozorování
a předchozí neúspěchy nezmizely. Počty úloh a počty provedení sond jsou
proto oddělené. Pole `cleanupError` v obnoveném ručním reportu zachovává
chybu prvního přerušení; aktuální cleanup dokládá zvláštní závěrečný
snapshot. Toto reziduální pole je otevřená chyba reportování resume.

Plán má 92 úloh, tři opakování, 276 cílových pokusů a šestihodinový strop.
Původní plán počítal s 504 kalibračními sondami v obou pořadích a následným
známkováním otevřených odpovědí. Opakované kalibrace při pokračování zvýšily
skutečný počet na 812 sond. Doba běhu není sama o sobě důkaz důkladnosti.

CODE: sedm krátkých oprav, pět deklarovaných skupin, kontext 16 384.
Šest ze sedmi úloh pochází ze správy modelů (úklid, leases, porovnávání,
timeouty), jedna z chyb ukládání chatu. To je úzké pokrytí backendu,
nikoli obecný benchmark tvorby aplikací. Sada má navíc historickou
kuraci podle dříve měřeného panelu; není nezávislý vzorek.
VISION: dvanáct syntetických obrázků + chybějící obrázek, kontext 4 096.
D1/D2/R1/R2: osm vývojových zadání na roli; CHAT 40, kontext 16 384.
Tyto kontexty patří jednotlivým profilům; nejde o společnou kvalifikaci
všech rolí na 32k ani o zátěžový důkaz pro nejdelší produkční vstup.

| Profil | Kontext | Limit výstupu / odpověď | Teplota | Timeout odpovědi |
|---|---:|---:|---:|---:|
| Krátké CODE opravy | 16 384 | 4 096 tokenů | 0,1 | 300 s |
| VISION | 4 096 | 768 tokenů | 0 | 120 s |
| D1/D2/R1/R2/CHAT | 16 384 | 2 048 tokenů | 0,1 | 300 s |
| T4 hodnotitel | 16 384 | 2 048 tokenů | 0 | 300 s |

Krátká úloha může skončit správně za sekundy. Čekání do předem vybraných
20–30 minut by samo nic neověřilo. Důkladnost musí vycházet z pokrytí
odlišných případů, úplnosti provedení a přijatého měřidla; zde se náklady
otevřených odpovědí navíc násobí sondami a oběma pořadími hodnocení.

Souhrnné skóre role vznikne pouze při úplném počtu platných opakování
a prošlých sondách všech potřebných hodnotitelů.
Chybějící a neplatné pokusy zůstávají v tabulce; neporovnává se pouze
úspěšně změřená podmnožina. Jednotlivé úlohy a jejich syrové odpovědi mají
samostatný přehled v exportu pro review.

Navazující CODE workflow: aktuální IntentSmith execution loop, Qwen3.8
proti Devstral-small-2, osm dříve zveřejněných případů, šest skupin, jedno
opakování. Výsledek dokládá průchodnost oprav přenosu, nikoli výběr modelu;
případy jsou spálené a nesmí být přejmenovány na nový holdout. Jde o
lokalizované opravy s předem určenými zdrojovými výřezy kolem historicky
měněných míst, nikoli samostatné hledání vady v celém repozitáři.

## Výsledek všech sedmi rolí

**Qwen3.8:latest**, digest `22130167c4c20e20c7b71454612966ca8e8171e9b3cc8ab6ce8aa6cbfec79643`, stejný artefakt také jako T4 hodnotitel.

Běh 19. 9. 2026 **14:26:01–18:01:09 UTC** (16:26–20:01 CEST), **3 h 35 min 8 s** včetně přerušení a nového ověření hodnotitelů. Všech **276/276** plánovaných cílových pokusů proběhlo. Terminální stav je **INCOMPLETE_EVIDENCE**, nikoli PASS.

| Role | Provedeno | Neplatné měření | Vyčerpání výstupu (platná nula) | Celkové průzkumné skóre |
|---|---:|---:|---:|---:|
| CODE | 21/21 | 0 | 0 | 80,95 % |
| VISION | 39/39 | 0 | 0 | 84,62 % |
| D1 | 24/24 | 4 | 18 | Nedoloženo |
| D2 | 24/24 | 10 | 2 | Nedoloženo |
| R1 | 24/24 | 1 | 7 | Nedoloženo |
| R2 | 24/24 | 12 | 2 | Nedoloženo |
| CHAT | 120/120 | 4 | 0 | Nedoloženo |

**31 neplatných měření má skóre NULL**, **29 ověřených vyčerpání výstupního rozpočtu má skóre 0**. Dalších 199 pokusů překročilo práh úlohy a 17 ne; to není 199 dokončených reálných pracovních úkolů. Zejména agregace nepoužívá jen platnou nebo úspěšnou podmnožinu.

Poslední kalibrace: D1 **4/8**, D2 **8/8**, R1 **7/8**, R2 **6/8**, CHAT **40/40**. Celkem **65/72** unikátních sémantických úloh. Kvůli obnovení bylo provedeno 116 kalibrací; všech 14 neúspěšných provedení zůstalo v historii. I přes prošlé sondy mají D2 deset a CHAT čtyři skutečné odpovědi odmítnuté jako nestabilní při prohození pořadí. Úspěšná vývojová sonda tedy sama nedokládá obecnou spolehlivost hodnotitele.

Při započtení opakovaných kalibrací je to **812 dvoupořadových sond**:
798 s čitelnou známkou v autorsky očekávaných mezích a **14 neplatných**.
Před uplatněním ochrany dvou pořadí vykázal hodnotitel **8 chybných přijetí
z 1 156 čitelných negativních pořadí** a **4 chybná odmítnutí ze 464
pozitivních pořadí**; další čtyři negativní pořadí nebyla čitelná.
Tato diagnostika zahrnuje opakované tytéž sondy a není odhadem chybovosti
na nezávislém produkčním vzorku. Jmenovatele, abstence a rozpad po rolích
zachovává `semantic-calibration-analysis.json`.

Uloženo **2 258 odpovědí**: 276 cílových a 1 982 od hodnotitele (včetně jedné odpovědi odmítnuté kvůli cizí práci na GPU). Součet časů cílových volání je **40 min 4 s**, hodnocení **2 h 47 min 8 s**. Většinu času tedy tvořilo ověřování měřidla, nikoli širší výběr nezávislých úloh. Nejde o rychlostní benchmark.

Výsledky jednotlivých úloh, očekávané a skutečné hodnoty, dílčí kritéria i celé odpovědi jsou v `role-review.html`; finální strukturovaný přehled je v `final-summary.json`.

## Krátké CODE srovnání tří modelů

Všechny tři série používají stejný runtime a krátký kontrakt
`23164c94ec042e9782722ff6f203ebcc603e22be0b0ce8e68a81c8f9b8bbb936`:
sedm úloh, tři opakování, pět deklarovaných skupin.

| Model | Nové pokusy | Průměr úloh | Nad prahem / pod prahem |
|---|---:|---:|---:|
| Qwen3.8:latest | 21/21 | 80,95 % | 17 / 4 |
| Devstral-small-2:latest | 21/21 | 49,21 % | 9 / 12 |
| Qwen3-coder:latest | 21/21 | 11,43 % | 3 / 18 |

Coderových **11,43 % = (0 + 0 + 0 + 0 + 0,8 + 0 + 0) / 7**.
Všechna tři opakování měla stejná dílčí skóre. Odpovědi šly vložit a byly
syntakticky platné; konkrétně však:

- opravy binding/VRAM autority neobsahovaly potřebné vlastníky operací,
  proto testy vracely `MODEL_USE_INPUT_INVALID`; u VRAM nebyl dokončen
  ani testovací modul. To je důsledek vrácené opravy, nikoli chybějícího
  GPU nebo rozbitého testovacího prostředí;
- v porovnávání rolí vznikl překlep `incumbententWins`, který vyvolal
  `ReferenceError` a čtyři nové regrese;
- u ukládání chatu prošly čtyři z pěti požadavků; chyběla příčina původní
  chyby persistence. Ostatní krátké opravy požadované chování nesplnily.

Krátký adaptér původně uložil jen souhrn testových kontrol, nikoli jejich
plný stdout/stderr. **To je otevřený nedostatek diagnostiky produktu.**
Proto byly uložené odpovědi navíc přehrány bez modelu přes přesný runner:
**63/63 původních hodnocení se reprodukovalo**, 26 odlišných dvojic
úloha/odpověď. Nový konzolový výstup je v `code-short-replay.json`;
není vydáván za původní výstup měření. Výsledek 11,43 % není důkaz, že
Coder zvládne jen 11 % libovolného programování; platí pro tuto úzkou sadu
oprav a její předepsaný formát.

## Skutečný opravný postup CODE

Finální kód `89531748` dokončil 19. 9. **18:01:24–18:20:20 UTC** všech **16/16** pokusů; celkově **18 min 56 s** včetně kvalifikace profilů. Každý model dostal osm stejných známých případů, vždy čisté prostředí, nejvýše tři iterace a deset minut na pokus. Pořadí prvního modelu je vyvážené 4:4.

| Případ | Qwen3.8 | Devstral-small-2 |
|---|---|---|
| search-report | Neopraveno | Výstupní limit; neopraveno |
| build-arbitration | Neopraveno | Výstupní limit; neopraveno |
| manual-scheduler | Opraveno | Opraveno |
| specialist-cleanup | Neopraveno | Neopraveno |
| expertise-categories | Opraveno | Neopraveno |
| java-javadoc | Opraveno | Neopraveno |
| structured-code | Opraveno | Neopraveno |
| optional-legacy-table | Neopraveno | Neopraveno |

**Qwen: 4/8 dokončeno, 4/8 nesprávně; Devstral: 1/8 dokončeno, 5/8 nesprávně, 2/8 vyčerpaný výstupní rozpočet.** V uložené sérii je pět `converged: true` a všechny mají finální kontroly `allPassed: true`; zbylých jedenáct konvergenci nehlásí. Žádný neplatný pokus se neztratil z jmenovatele.

Oba profily prošly samostatnou zátěží: Qwen **11 990 vstupních / 4 096 výstupních tokenů**, Devstral **12 182 / 4 096**, skutečné celé umístění na GPU, peak nejvýše **21 425 553 408 B** pro celé zařízení (limit 22 000 000 000 B). Bez chyby vzorkování. To jsou údaje pro tento profil 16k a tento provider, nikoli všechny produkční kontexty.

**Verdikt série: DEVELOPMENT_ONLY / EXPOSED_CASES_NOT_SELECTION_EVIDENCE.** Pět skutečných oprav dokládá průchodnost postupu na finálním kódu. Poměr 4:1 neprokazuje vítěze ani předpovědní platnost krátkého benchmarku: osm případů je zveřejněných, obsahují jen šest deklarovaných skupin a byly použity při vývoji oprav. Nelze z nich vytvořit nový holdout. Přiřazení CODE před a po běhu je přesně shodné.

Detail se zadáním, důvodem zastavení, odpověďmi a výstupem finálních kontrol je v `code-review.html`. Původní modelové odpovědi ani uložené zdrojové soubory se při následné kontrole neupravují.

## Konkrétní nálezy finálního měření

Samotné výsledky 0 nebo 100 % nejsou důkaz špatné sady: přesný formát,
oprava s regresní kontrolou nebo správná hodnota mohou být přirozeně binární.
Vadou je přidělit body za klíčová slova bez ověření významu, sloučit poruchu
prostředí s chybnou odpovědí nebo z úzkého testu odvozovat obecnou schopnost.
Nové sondy ukázaly, že ani náhrada substringů modelovým hodnotitelem sama
nezaručuje platné měřidlo. Následující nálezy jsou konkrétní důvody, proč
z tohoto kola nelze vyhlásit přijaté rozhodovací profily.


- CHAT deklaruje 40 ID skupin, ale nejméně několik dvojic sdílí šablonu
  nebo schopnost; EN/CS odstavec o dvoudenním zpoždění čidel má stejnou
  konstrukci. **40 ID není důkaz 40 nezávislých pozorování.** Před
  rozhodovacím experimentem je nutná přijatá mapa závislostí. V tomto
  průzkumu se z tohoto počtu nepočítá rozhodovací interval.

- R1 `model_cleanup`: není to jen náhodná chyba hodnotitele. Rubrika
  `Deletion revalidates current protected bindings` nejasně žádá vlastnost
  systému, zatímco správná revize má upozornit, že tato hranice v diffu
  chybí. Hodnotitel v obou pořadích srazil správné referenci právě tuto
  položku na nulu (6/7 = 85,7 %, pod přejímací mezí). To je **nalezená
  vada formulace rubriky**. V tomto uzamčeném měření se nepřepisovala;
  profil zůstává nepřijatý. Nový kontrakt musí hodnotit rozpoznání a
  požadavek ověření chybějící kontroly, nikoli tvrdit, že ji diff dokládá.

- R2 `verification_timeout`: reference míchá popis současné vady
  s požadavkem na ověření stavu po opravě. V jednom pořadí hodnotitel
  vyložil požadavek jako tvrzení o současném chování a požadoval další
  nálezy; v obráceném pořadí tutéž referenci přijal. To je další důvod
  oddělit stav před opravou, požadovaný stav a podmíněné požadavky
  na důkazy. Není to nula o schopnosti řešícího modelu.

- D1 `model_cleanup`, negativní sonda: při prvním pořadí hodnotitel připsal
  negaci reference plné body a popsal obsah správné reference. Po prohození
  téže dvojice ji odmítl. `SEMANTIC_ORDER_UNSTABLE` znemožnil přejímku úlohy.
  Není to chyba modelu řešícího úlohu a nevstupuje do průměru jako nula.
- D1 má doložené vyčerpání 2 048 výstupních tokenů. To vypovídá o dokončení
  v tomto konkrétním profilu, ne o obecné neschopnosti modelu analyzovat kód.
  Rozpočet se během série nezvyšoval podle výsledků.
- VISION má věcné chyby s dílčím kreditem: objednávky 101 místo 121,
  chybnou trasu a chybnou rekonstrukci celkové ceny dokladu. Proto lze mít
  správnou detekci objektů a současně slabší obrazové uvažování.
- V krátkých sadách `SUCCESS` znamená překročení prahu rubriky (u VISION
  0,7), nikoli správnost všech polí. Provozní CODE dokončení je samostatná
  binární kontrola stavu souborů a akceptačních/regresních testů.

Dlouhá doba tohoto kola vzniká především z opakovaného hodnocení a sond T4.
Není to validace požadovaného rychlého/plného produktového profilu. Výkonnostní
porovnání se z těchto časů neodvozuje; během části průzkumu běžely také
kontroly orákul na CPU. Teplota, cache a ostatní procesy nejsou kontrolovaný
experiment rychlosti.

Po skončení inference byly v novém read-only sandboxu **znovu spuštěny
finální kontroly všech 16 uložených CODE stavů**. Shodují se úspěchy,
exit kódy, dokončovací markery, počty selhání i třídy chyb; zdrojové hashe
se nezměnily (`code-final-state-recheck.json`, PASS). Samostatný replay
sémantických záznamů rekonstruoval 990 párů a přesně spároval **988 uložených
známek**; dva nedokončeně uložené páry a jeden osiřelý směr z přerušení
zůstaly viditelné (`semantic-replay-integrity.json`, PASS). To ověřuje
výpočet a návaznost evidence, nikoli správnost sémantického úsudku.

Exporty mají nové proklikání a fyzické snímky `*-painted-final.*`:
10 kontrol rolí (včetně 12 skutečných obrazových vstupů) a čtyři kontroly
CODE. První snímky exportů zachytily předchozí frame, ačkoli DOM aserce
prošly. Jejich omezení je zachované v `review-export-first-visual-inspection.json`.
Nové snímky čekají na dvě vykreslení a byly skutečně zobrazené a zkontrolované;
nejde o důkaz integrace exportu do Studia.

## Ověřené kontroly mimo GPU

- Čistý offline/database audit na `32f1eef5`: **361 PASS / 1 FAIL / 0 BLOCKED / 0 TIMEOUT**.
  Produktový runtime má stejný SHA jako měřený `89531748`; nová změna
  v ručním runneru (terminální receipt při časném blokování) má samostatnou
  kontrolu na `89531748`. Celá sada nebyla znovu spuštěna na dokumentačním commitu.
  FAIL je `tests/nightly-orchestrator-self-test.js`: hash aktuálního registru
  neodpovídá starší reviewované Gate 0 politice. Pečeť se nepřepisovala.
- Významový protokol: 15/15; parametry a ochrany ručního runneru: 10/10.
- CODE krátká orákula na čistém `89531748`: 57/57 sond, sedm úloh, pět
  deklarovaných skupin, pozitivní alternativy i více bloků kódu; CODE
  provozní orákula: 60/60 na runtime shodném s finálním měřením.
- Skutečný produkční Electron frontend: sedm záložek, historický detail,
  sedm uzavřených přejímacích bran, blokovaná automatika a reconnect po
  restartu vlastního backendu na jiném portu, PASS. Screenshot po reconnectu
  byl také vizuálně zkontrolován. První starší snímek Přehledu zachytil
  načítací překryv Theia, ač DOM již obsahoval data. Zachovaný starý PASS
  proto není důkazem vykreslení tohoto snímku. Nový průchod na `89531748`
  čeká na odstranění překryvu a dvě animation frames; Přehled i reconnect
  jsou nově fyzicky zachycené a vizuálně zkontrolované.
- GUI používalo diagnostický bridge nad read-only produkční SQLite a systemd;
  jiné GETy předával instalovaný backend. NODE_ENV=production, --no-sandbox,
  softwarové vykreslování, soukromý profil. Nejde o důkaz nové instalace,
  inference přes GUI, stažení, změny bindingu ani smazání modelu.

## Závěrečný stav hostu a ukončení procesů

Po měřeních je timer **disabled / inactive**, služba inactive, `ollama ps`
prázdné a žádný NVIDIA compute proces. Vlastní GPU lease byl uvolněn,
11435 odmítá spojení; systémová 11434 dál hlásí **0.34.0-intentsmith.1**.
Automatický hold zůstává přítomný s právy 0600. Podklady:
`live-snapshot-final.json`, `post-measurement-release.json`.

Produkční DB se tímto měřením neměnila: nové výsledky do ní nebyly
importovány. Závěrečná read-only kontrola nad soukromou projekcí eviduje
historických **280 COMPLETE / 216 BLOCKED / 32 FAILED**, 234 rozhodnutí
a 12 instalovaných artefaktů. Aktuální read model má **74 použitelných
buněk MISSING, 10 N/A a 0 aplikovatelných doporučení**. Historická čísla
proto nelze zaměňovat za aktuální přijatá skóre. Migrace 116 byla provedena
jen na projekci; živá instalace zůstává na migraci 115. Živou DB mohou
nezávisle používat jiné běhy; netvrdíme neměnnost celého souboru během dne.

Samostatná nesrovnalost: vnější terminálová relace fronty benchmarků
vrátila **exit 143**, zatímco její log doložil u Devstralu i Coderu
**WRAPPER_EXIT 0** a oba mají 21/21 pokusů. Z dostupné evidence není
určen původce, čas ani příčina možného signálu; nebyl nalezen vysvětlující
záznam v uživatelském journalu. Důsledně tedy netvrdíme bezchybný lifecycle
celé orchestrace (`session-exit-audit.json`). Výstupy obou měření jsou
úplné a jejich skóre navíc zopakoval offline replay. Ostatní sledované
relace: hlavní série exit 2 pro INCOMPLETE_EVIDENCE, CODE workflow 0,
finalizace podkladů 0. Nic z toho nepřevádí hlavní nepřijatý výsledek na PASS.

## Celý hunt: stav funkcí a chybějící přejímka

| Funkce | Aktuální důkaz | Co ještě brání přijetí celku |
|---|---|---|
| Provider a upgrade | Reprodukovatelná 0.34.2 v evaluačním sidecaru; digest a completion v každé odpovědi. | Systémová 11434 stále 0.34.0-intentsmith.1. Správní instalace a společná produktová integrace neprovedeny. Metadata autocheck není automatická kvalifikace nové verze. Upstream PR s patchem nebyl v tomto kole publikován. |
| GPU/VRAM | Denní uložená identita karty, živý lease a per-response skutečné umístění/context. | Přijmout samostatné zátěžové profily všech rolí se shodnými produkčními limity; samotný malý prompt není maximum paměti. |
| Discovery/fronta | Read-only knihovna a shortlist; místní modely před downloadem, priority chybějících/slabých rolí, přesné identity. | Dokončit bootstrap a následný incremental průchod na nových platných sadách. Zatím není dokázaná produktivita automatického výběru. |
| Download/disk | Trvalé receipts, vrstvy/bajty/rychlost/ETA a obnovení přes HTTP jsou v kódu a regresích. | Dnešní běh nestahoval nový velký model. Finální instalace potřebuje znovu prokázat skutečné přerušení/obnovu a diskovou rezervu. |
| D1/D2/R1/R2/CHAT | Samostatné ruční sady a modelové sondy v tomto packetu. | Nezávislá přejímka T4, produkční mapování/writer/GUI. D2 a R2 zde stále používají T4; požadovaná spustitelná lokace + reprodukce ještě není produkční cesta. |
| VISION | 12 odlišných obrázků, 156 kontrol a nová inference. | Syntetická sada nepokrývá libovolné reálné dokumenty/fotografie; chybí provozní párová kvalifikace. |
| CODE | Ověřená orákula, nová krátká inference a nová vývojová provozní série. | Nové oddělené historické případy, předem uzamčená přesnost/rozpočet a přijaté provozní páry. Starých osm nelze recyklovat jako holdout. |
| Rychlý/úplný profil | Úplný ruční průzkum a diagnostický smoke mají jasně odlišný význam. | **Platný rychlý odhad ani plný kvalifikovaný profil v GUI nejsou dodané.** Smoke není rychlý quality score. |
| Rozhodovací autorita | Uložená přejímka pro exact contract/runtime SHA, revokace a přijatý pár; getter se nedá otevřít změnou konstanty. | Není přijatý žádný profil. T4 importer a ne-CODE provozní evidence zůstávají nepodporované a správně zavřené. |
| Binding/rollback | Existuje explicitní autoritativní aplikace a ochrana rollback slotu. | Tento běh nedodal přijatého vítěze a žádný binding neměnil. Koncový uživatelský průchod na společné instalaci není prokázán. |
| Retence | Chybějící přejímka, chybějící důkaz, NEROZHODNUTO a samotný CPU spill neautorizují smazání. | Před obnovením mazání přijatá prohra ve všech použitelných rolích a živé ověření ochranných callbacků. V tomto běhu se nic nemaže. |
| Studio | Aktuální čtení, tabulky, detail historie, přejímací důvody a reconnect proklikány. | Nové ruční profily nejsou v produkčním UI; instalace patří souběžně měněné produktové větvi. |
| Správce | 6/6 čteček READY, skutečná data a explicitní NO_ACTIVITY/OBSERVED. | To není 6/6 změřených kvalit. Architektura potřebuje provedený audit; některé provozní metriky nemají dostatečný jmenovatel. |
| Pravidelný provoz | Timer disabled/inactive, ochranný hold čitelný a soukromý. | Ponechat vypnutý do společné přejímky a úspěšné malé ruční vlny. |

## Rozhodnutí a další povinné kroky

Nezávislé review má posoudit konkrétní implementaci a evidence. Toto kolo
nedoložilo přijetí sad ani provozních párů a našlo zbývající implementační
mezery. Konečný verdikt tohoto kola je **NO-GO pro autonomní hunt**,
modelové rozhodnutí **NEROZHODNUTO**, provozní akce **PONECHAT**.

Průzkumné měření zůstává užitečné pro vývoj a hledání vad. K automatickému
výběru, přepínání či mazání modelů nestačí. Nejbližší práce je v pořadí
uvedeném níže; další inference na totožném nepřijatém měřidle tyto mezery
neuzavře.


## Co je potřeba pro změnu verdiktu na GO

1. **Uzavřít zbylou produkční cestu T5 a opravit zadání/hodnotitele.**
   Staré obsahové substringové rubriky nesmějí vytvářet nové skóre;
   historické záznamy se zachovají s jejich původním kontraktem. Oddělit v R1/R2
   popis stávající vady od požadovaného stavu po opravě. D1 musí mít
   předem určený smysluplný výstupní profil a zadání, které modelu sdělí
   požadovanou stručnost; nedokončený text nelze zachraňovat známkou za
   jeho prefix. Zrevidovat skupiny závislých CHAT úloh. D2/R2 převést tam,
   kde je to možné, na spustitelnou reprodukci a lokalizaci; přesný JSON,
   tabulky a podobné CHAT kontroly hodnotit deterministicky.
2. **Přijmout T4 na oddělených anotovaných odpovědích.** Autorské sondy
   použít na ladění, přejímací vzorek uzamknout zvlášť. Zveřejnit chybná
   přijetí, odmítnutí i abstence po typech úloh a obou pořadích. Druhý
   hodnoticí model je možná alternativa k současnému self-judge, nikoli
   náhrada této přejímky.
3. **Získat nový provozní důkaz.** Nové oddělené historické případy,
   skutečný kandidát proti současnému modelu, stejné limity a předem
   uzamčené rozhodování. Více opakování starých osmi případů nezvyšuje
   počet nezávislých skupin. Rozsah odvodit od požadované přesnosti;
   případný další NEROZHODNUTO nesmí být přepsán na vítězství.
4. **Dokončit produktovou integraci.** Jednotné produkční kontrakty,
   autoritativní persistence a čtení v GUI pro nové sady; podporované
   přejímací záznamy T4 a provozních rolí. Teprve z přijatého úplného
   profilu odvodit rychlý odhad s popsaným pokrytím a nejistotou.
5. **Ověřit společnou instalaci jako uživatel.** Přijatý provider a
   finální backend/frontend musí běžet společně. Prokliknout skutečné
   stažení včetně přerušení, obnovení, rezervy disku, průběhu a ETA,
   nové měření, dohledání výsledku a explicitní aplikaci/rollback
   přijatého doporučení. Dnešní read-only GUI průchod tyto efekty nedokládá.
6. **Uzavřít integrační přejímku a malou ruční vlnu.** Nezávisle
   zkontrolovat změněný registr a teprve potom aktualizovat Gate 0 pečeť.
   Timer a automatické mazání zapnout až po přijatých profilech a
   doložené ruční vlně; samotný CPU spill ani chybějící skóre neopravňují
   k odstranění modelu.

Review může přijmout konkrétní ochrany, reprodukovatelnost a doložené
nálezy. Nemůže samotným schválením tohoto dokumentu nahradit uvedené
chybějící implementace a neúspěšnou přejímku měřidla.

## Archiv a návaznost evidence

Archiv `evidence-42b743e872671e1d02b0e8ba36c7e1780699f7f034516b67c6382bc0a29ab909.tar.gz`
má **186 146 053 B**, SHA-256
`42b743e872671e1d02b0e8ba36c7e1780699f7f034516b67c6382bc0a29ab909`.
Manifest SHA-256:
`d4c5db3de20b790238ba65b5cad445434c84b09c3c0460c49e9c3a82029ae9fa`.
Přesná místní cesta je v přiloženém receipt.

Balicí kontrola přečetla a ověřila všech **4 117 souborů**. Následný druhý
čtecí skript znovu ověřil archiv, celý manifest a **70 025 odkazů na obsah
pracovních souborů**, bez extrakce nebo spouštění obsahu. Obě kontroly
prošly. Jsou to dvě kontroly integrity v rámci této práce, nikoli
nezávislé odborné přijetí měření.

Uvnitř jsou ověřené `source.bundle` a `c3-reference.bundle`, přesný
provider Go binary, raw odpovědi, plány, logy, zdrojová delta, snímky GUI,
HTML exporty a obsahově adresované pracovní stavy včetně starších
neúspěšných běhů. Referenční C3 commit je
`379c2e4b6dea0fd0cd0fb19df67c3454c267fd49`. Archiv neobsahuje živou ani
projektovanou produkční SQLite, modelové váhy, instalované závislosti,
soukromé Electron profily/tokeny ani 1,4GB nativní CUDA archiv. Identita
nativního balíku a postup sestavení jsou v build receipt.

[Publikovaný ověřovací skript](evidence/2026-09-19-verify-gpu-hunt-archive.py)
má SHA-256 `7dddeb4f2ea36de7e35bad9164ca6e96ee0f6eb1209916b576098a2dddde6c48`.
Je to druhá, sekvenčně čtoucí verze použitého verifieru. Archiv obsahuje
předchozí správnou, ale pomalejší verzi; po zapečetění se nepřebaloval.
Druhý receipt a tento review dokument tedy vznikly až nad hotovým archivem.
Strojový souhrn v Gitu je naopak byte-for-byte kopie z jeho obsahu.

Měřený produktový zdroj zůstává `89531748`; následný předávací commit
přidává pouze dokumentaci, receipts a tento ověřovací nástroj. Nemění
měřený runtime ani nepřeznámkovává uzamčené odpovědi.

## Jak může reviewer důkazy zopakovat

1. Ověřit SHA-256 archivu podle přiloženého receipt, potom z kořene repa
   spustit `python3 docs/review/evidence/2026-09-19-verify-gpu-hunt-archive.py
   docs/review/evidence/2026-09-19-gpu-hunt-bundle-receipt.json`.
   Při přesunu změnit pouze cestu `archive` v pracovní kopii receipt;
   očekávané hashe a velikosti zachovat. Skript kontroluje každý člen
   archivu i odkazy na uložené pracovní soubory. Shoda hashů dokládá
   integritu, nikoli pravdivost fyzického pozorování.
2. Z `source.bundle` vytvořit samostatný checkout měřeného commitu;
   `c3-reference.bundle` obsahuje přesný referenční C3 commit. Použít
   zaznamenaný Node a závislosti z lockfile. Archiv neobsahuje závislosti, váhy modelů ani celý
   nativní CUDA balík; obsahuje jejich identity a build receipt. Modelové
   artefakty je nutné opatřit zvlášť a ověřit proti uloženým digestům.
3. Bez GPU znovu spustit `scripts/manual/verify-code-oracles.mjs --out
   /absolutni/novy-code-report.json` a `scripts/manual/verify-vision-oracles.mjs
   --out /absolutni/novy-vision-report.json` pomocí Node. Výstupní soubory
   musí být nové, aby se nepřepsala původní evidence. Provozní orákula
   připravuje `scripts/manual/c3-code-pilot.mjs --prepare
   --workflow=intentsmith --c3=/absolutni/c3 --out=/absolutni/novy-adresar`.
4. `replay-semantic-evidence.mjs --source=/absolutni/checkout` načte uložené
   odpovědi hodnotitele a znovu sestaví známky i vstupní hashe bez inference.
   Neověřuje, zda je sémantický úsudek správný. `recheck-code-final-states.py`
   spouští původní kontroly nad zachovanými finálními soubory v novém
   read-only sandboxu; nové odpovědi modelů nevytváří. Privátní pomocné
   skripty mají cesty tohoto hostu; při přesunu je potřeba přenastavit
   jejich kořen evidence a cestu k připnutému C3/Node.
5. Nová fyzická inference je samostatný experiment: vlastní prázdné GPU,
   stejný provider/artifact/profile, nový výstupní adresář a zachování
   neúspěšných pokusů. Samotný obsah archivu nedokáže zpětně nezávisle
   pozorovat tehdejší GPU. Přepsání původního výsledku opakováním není
   přípustná reprodukce.

Podklady pro kontrolu příčin jsou v `src/eval/semantic-evaluation-judge.js`,
`src/eval/role-evaluation-plan.js`, `src/upgrade/model-evaluation-acceptance.js`
a `scripts/manual/all-role-evaluation.mjs`. Přesný souborový rozsah změn je
v archivu (`source-diff-stat.txt`, `source-range.txt`, `source-change.patch`).
