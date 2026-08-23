# Model upgrade prototype v136.1

**Stav:** funkční GPU prototyp; portfolio splňuje segregaci, CHAT v3.5 má
40 dílčím checklistem hodnocených úloh (24 EN + 16 CZ) a CODE má 8 aktivních
úloh

**Rozsah:** discovery kandidátů, objektivní skórování podle role, trvalá historie,
výběr vítěze a operátorem spuštěná aplikace vazby

**Mimo rozsah prototypu:** bezobslužná aplikace vítězů a produkční failover
proof issuance. Bezpečně omezená retence lokálních artefaktů je součástí
prototypu.

## 1. Výsledek, který prototyp musí dodat

Jeden operátorem spuštěný hunt:

1. zjistí GPU a dostupnou VRAM;
2. projde modelové rodiny a vybere jen varianty, které se mohou vejít a jsou
   způsobilé pro alespoň jednu konkrétní roli;
3. odliší již změřený přesný modelový artefakt od nového;
4. spustí pouze chybějící aktuální role-specific sady;
5. porovná uložené skóre kandidáta a incumbent modelu;
6. při průkazně lepším výsledku aplikuje novou vazbu přes existující binding
   application boundary;
7. původní model ponechá na disku a v append-only historii jako rollbackovou
   volbu.

Žádný vítěz, neúplné měření nebo nerozhodný výsledek znamená beze změny vazby.

## 2. Kategorie

| Kategorie | Role | Sada | Princip hodnocení |
|---|---|---|---|
| `reasoning` | D1, D2, R1 | `reasoning_v2` | více přesných dílčích odpovědí, omezení a návaznosti |
| `code` | CODE | `code_patch` | skutečná oprava z historie, skryté testy, podíl splněných cílů |
| `review` | R2 | `review_v2` | recall známých vad minus penalizace za vymyšlené vady |
| `chat` | CHAT | `chat_v3` | EN 60 %, CZ 40 %; fakta, instrukce, kontext a jazyk |
| `vision` | VISION | `vision_v2` | přesné atributy syntetických obrazů, více bodů na úlohu |

Každá úloha vrací skóre `0..1`. PASS je jen čitelný práh úlohy; o pořadí
modelů rozhoduje průběžné skóre a párová marže, nikoli počet binárních PASS.

## 3. Identita a historie

Historie je append-only. Jedna dokončená evaluace je jednoznačně určena:

```text
model_digest_sha256 + suite_name + suite_contract_sha256
```

Jméno a tag se uchovávají pro čitelnost, ale nejsou autoritou identity. Tag
`latest` se může změnit; nový digest je nový modelový artefakt a smí se změřit.
Stejný digest pod aliasem se pod stejným kontraktem podruhé neměří.

`suite_contract_sha256` zahrnuje definici promptů, graderů, model options a
počet opakování. Změna testů tedy nezničí starou historii, ale správně vytvoří
nové jednorázové měření. Uchovávají se i FAILED/BLOCKED pokusy. `FAILED` pro
přesný digest a kontrakt se znovu nezařadí; hardwarový `BLOCKED` se přeskočí
jen na stejné GPU a stejné VRAM, aby větší budoucí GPU dostala nový pokus.
CPU-spill blok se sdílí i napříč změnami sady, pokud se nezměnil přesný
digest, GPU, VRAM ani měřený kontext. Změna promptu není důvod znovu načítat
model, který se na stejném hardwaru fyzicky nevejde. Pouze COMPLETE výsledek
lze znovu použít jako kvalitativní skóre rozhodnutí.

Před stažením vzdáleného tagu nemusí být digest dostupný. Kandidát proto může
být předběžně `unknown-artifact`; po pullu se přečte přesná lokální identita a
teprve potom se rozhodne `unseen` versus `already-scored`. Stažení stejného tagu
není nové skórování a po zjištění známého digestu se plná sada přeskočí.

## 4. Výběr kandidátů

Hunt netestuje každý model. Kandidát musí současně:

- projít odhadem VRAM pro detekovanou GPU a potom reálným měřením umístění;
- být způsobilý pro konkrétní roli/modalitu;
- projít schopnostním minimem;
- být vhodnou rodinou/specializací pro roli nebo nést lepší externí signál než
  incumbent;
- mít alespoň jednu relevantní roli, pro kterou je potřeba nové skóre nebo
  nové porovnání s dnešním incumbentem; známé COMPLETE skóre se přitom načte
  z historie a model se znovu nespustí.

Živý Ollama katalog je zdroj rodin, popisu a stáří poslední aktualizace.
Kategorie `code`, `vision`, `embedding`, `ocr`, `safety` a `translation` se oddělují ještě
před role rankingem, aby například embedding nebo vision model nekandidoval na
reasoning. Čerstvost pouze zvedá prioritu dosud neznámého artefaktu ke
screeningu; není důkazem kvality a nikdy nenahrazuje role-specific scoring.
Rodina bez záznamu ve statickém benchmarkovém katalogu se proto neztratí, ale
musí kvalitu teprve fyzicky prokázat.

Modely se zkoušejí sériově. Mezi dvěma modely se uvolní Ollama residency a na
NVIDIA se čeká i na prázdný seznam compute procesů; samotné krátce prázdné
`/api/ps` během přechodu nestačí. Neúspěšný drain ukončí měření fail-closed. Hunt
nesmí ukončovat cizí procesy ani sessions a nesmí vyvolat `swapoff`.
Hunt a kalibrační panel navíc sdílejí mezi-procesový GPU lock, takže se
nemohou navzájem dostat mezi drain a placement measurement.

## 5. Rozhodnutí, segregace a aplikace

Pro každou roli se porovnávají uložené task-level průměry kandidáta a
incumbenta. Úloha rozlišuje jen tehdy, když rozdíl překročí vlastní naměřený
rozptyl a minimální marži. Kandidát vyhraje, když:

- má kladnou průměrnou marži alespoň role-specific threshold;
- vyhrál více rozlišujících úloh než incumbent;
- nemá neúplný nebo BLOCKED výsledek.

Rychlost je pouze tie-breaker při kvalitativní shodě; sama nesmí překonat
prokázanou ztrátu kvality. Aplikace jde jedině přes existující
`ModelBindingApplication`. Přímý zápis do `config.models` nebo binding tabulek
je zakázán. Incumbent se nemaže.

Incumbent se neurčuje pouze z `config.models`: po startupu jsou autoritou
durable `USER_APPLY`/`USER_ROLLBACK` desired bindings. Hunt je načte přes
`ModelFailoverRepository` a config použije jen pro dosud nepozorovanou roli.
Tím se neporovnává proti již supersedovanému defaultu.

Kvalitativní vítěz ještě automaticky neznamená přípustnou vazbu. Prototyp
uplatňuje segregaci odpovědností:

- jeden přesný modelový artefakt nesmí držet většinu rolí; při současných
  sedmi rolích smí být primární nejvýše pro tři;
- D1 a R1 nesmí používat stejný model (autor plánu versus finální reviewer);
- CODE nesmí sdílet model s R1 ani R2 (implementace versus review);
- D2 nesmí sdílet model s R2 (návrh opravy versus kontrola opravy);
- pokud vítěz narazí na policy, jeho skóre zůstane v historii, ale vazba se
  nezmění; hunt pokračuje k dalšímu schopnému kandidátovi.

Tyto čtyři dvojice operátor potvrdil jako současnou policy prototypu, nikoli
jako navždy neměnný stav. Když policy blokuje doloženého vítěze, nejdřív se
párově přeměří blokující role proti dnešnímu poli; zákaz se ad hoc neuvolní.

## 6. CHAT v3

CHAT je English-first, nikoli English-only:

- dvacet čtyři EN úloh a šestnáct CZ úloh, stále s vahami 60/40;
- původní fakta, přesné instrukce, korekce kontextu, překlad a přiznání
  chybějícího kontextu doplňuje práce s konfliktními instrukcemi, referencemi,
  přesnou strukturou, bezpečným přiznáním limitů a zachováním významu;
- česká část navíc ověřuje skloňování, formální registr, nejednoznačnou
  referenci, přesný strukturovaný výstup a dva souvislé třívěté odstavce se
  zachováním faktů a správným oddělením jistoty od nejistoty;
- každá úloha má zveřejnitelný checklist dílčích bodů;
- faktické rozpory, překročení formátu a hallucinated values body odebírají;
- diakritika je jedna složka českého skóre, ne celý český test.

CHAT smí automaticky změnit vazbu jen při nejméně sedmi stabilně
rozlišujících úlohách, z toho nejméně třech EN a čtyřech CZ. Dvě české úlohy
jsou diagnostický signál, nikoli dostatečný podklad pro výměnu.

CLI musí umět vypsat přesné CHAT prompty a scoring rubric bez spuštění modelu,
aby je operátor mohl samostatně posoudit.

Panel v3.4 rozlišil 12 úloh, ale jen tři české. Ruční kontrola odpovědí pak
odhalila tři příliš úzké jazykové podmínky graderu (anglické vyjádření příčiny,
absence reliability dat a české formální `vaší`). Oprava vytvořila nový
kontrakt v3.5; stará měření zůstala v historii, ale nesmějí rozhodovat pod novým
hashem. Čistý souboj v3.5 mezi `qwen3.6` a incumbentem `qwen3.5` už poskytl
čtyři stabilní české signály, avšak pouze jeden anglický. Celkových pět je pod
branou 7 (EN 3 + CZ 4), takže vyšší průměr kandidáta ani výhra 4:1 vazbu
nezměnily. Rozšíření signálu zůstává kalibrační úkol, ne důvod snížit práh.

## 7. Frekvence huntu

- read-only discovery může běžet denně a nepoužívá GPU ani nestahuje modely;
- GPU hunt běží každých 48 hodin, sériově a nejvýše pro dva dosud
  neoscorované kandidáty na běh;
- plánovaný běh se bez zásahu přeskočí, pokud je v Ollamě rezidentní model,
  GPU používá jiný compute proces, je dostupných méně než 8 GiB RAM nebo by
  volné místo pro modely kleslo pod bezpečnostní rezervu 40 GiB;
- už nainstalovaný artefakt s chybějící aktuální sadou má přednost před novým
  downloadem; plánované pully rezervují svou hlášenou velikost kumulativně a
  nesmějí po stažení snížit volné místo pod 40 GiB;
- známý digest a shodný suite contract se znovu neinferuje;
- překryv ručního, plánovaného a kalibračního běhu blokuje společný GPU lock;
- automatická aplikace zůstává vypnutá, dokud notification receipt a B3/B4
  nedávají terminální důkaz.

Automatický úklid se smí spustit jen pod 40 GiB volného místa a skončí, jakmile
se rezerva obnoví. Smí odstranit pouze nevázaný artefakt starší sedmi dnů,
který není incumbent ani poslední rollback. Přesný digest bez alespoň jednoho
dokončeného `COMPLETE` záznamu v historii je chráněný; chybějící nebo nečitelná
historie znamená bez mazání.

Na hostu 2026-08-23 zůstává aktivace retence fail-closed: živá DB nese novější
automation-policy event schema z paralelní M1 linky, které v136.1 reader ještě
nečte. Přímý SQL bypass není přípustný. Cleanup kontrakt je implementovaný a
otestovaný, ale policy se zapne typed writerem až po sjednocení autority.

## 8. Akceptační důkaz prototypu

- migrace a schema testy pro append-only historii;
- unit test: stejný digest + kontrakt se podruhé nespustí;
- unit test: nový digest stejného tagu se spustí;
- unit test: změna kontraktu zachová starý běh a vytvoří nový;
- unit test: role dostane správnou sadu a cache nemíchá kontrakty;
- unit test: neviděný nevhodný model se netestuje;
- integrační test: vítěz se předá binding application portu, incumbent se
  nesmaže a nejasný výsledek nic nezmění;
- deterministické grader testy včetně všech CHAT checklistů;
- sériový GPU pilot s RAM/VRAM/swap snapshotem před, během a po běhu;
- JSON/Markdown report s kandidáty, reused/new výsledky, vítězi a důvody.

Prototyp je funkční, až skutečný call graph prokáže celý řetězec od unseen
kandidáta přes uložené skóre po aplikaci nebo pravdivé `UNCHANGED`.

## 9. Výsledek GPU pilotu 2026-08-23

- Discovery prošla 235 rodin a vytvořila roli-specifickou frontu. Vedle
  původního `qwen3.8:latest` byly skutečně změřeny `qwen3.5:27b`,
  `qwen3-30b-a3b:latest` a `phi4:14b`; 32B varianty a Mistral 22B byly
  hardwarově odmítnuty kvůli CPU spill při 32k kontextu.
- Konečné portfolio je `D1/CODE/CHAT=qwen3.5`, `D2/R1=qwen3.8`,
  `R2=qwen3:14b`, `VISION=llava-llama3:8b`. Žádný model tak nemá většinu
  sedmi rolí a všechny autor-reviewer zákazy jsou splněny.
- `qwen3.5` dosáhlo v reasoning sadě 1,000 proti 0,9528 u `qwen3.8`.
  Rozdíl nebyl task-level stabilní, proto nejde o tvrzení, že je obecně
  lepší; bylo zvoleno pro D1 jako naměřená ekvivalentní alternativa potřebná
  k opravě původně nevyhovující segregace.
- CHAT v3.2 má 35 úloh. Panel pěti modelů rozlišil 11 (7 EN + 4 CZ).
  `qwen3.5` porazilo CHAT incumbent na 12 stabilních úlohách (6 EN + 6 CZ),
  marží 0,100 a poměrem 7:5; `qwen3.8` na 10 (5 EN + 5 CZ), marží 0,127 a
  poměrem 6:4. Po nahrazení svévolného limitu 2 schváleným pravidlem
  „žádná většina“ převzalo `qwen3.5` CHAT jako třetí roli.
- CODE má po návratu čtyř stále platných gold úloh 8 aktivních
  rozlišujících úloh. `qwen3.8` porazilo CODE incumbent `qwen3.5` poměrem
  4:0 a marží 0,833; vazbu nepřevzalo, protože CODE–R1 zůstává nezávislá
  dvojice a `qwen3.8` už zastává R1.
- Aplikace D1 na `qwen3.5` je `APPLIED_NOTIFICATION_DEGRADED`: durable
  binding a runtime apply proběhly, notifikační receipt nebyl vydán.
- Aktivní user timer spouští nejvýše dva dosud neoscorované kandidáty každých
  48 hodin, bez mazání a bez automatické aplikace. První běh skončil úspěšně;
  další trigger je 2026-08-25 09:51 CEST.
- Následný discovery follow-up fyzicky ověřil také nový
  `qwen3.6:27b-mtp-q4_k_m`: při 32k kontextu je celý v 24GiB VRAM a dosáhl
  37,3 tok/s. V reasoning souboji neporazil dnešní incumbent a v CHAT v3.5
  sice vedl 4:1 s marží 0,0933, ale měl jen 5/7 požadovaných stabilních úloh
  (EN 1/3, CZ 4/4), takže binding zůstal beze změny. CODE a REVIEW skóre tohoto
  artefaktu zůstávají ve frontě; GPU byla na žádost operátora uvolněna.

Kompletní evidence, CHAT odpovědi a task-level skóre jsou v
[GPU pilot reportu](execution/runs/model-upgrade-prototype-20260823.md).
