# CODE — nové měření 19. 9. 2026

> Aktuální stav celého huntu a navazující měření na finálním zdroji `89531748`
> jsou v [závěrečném review z 19. 9.](2026-09-19-GPU-HUNT-FINAL-REVIEW.md).
> Verdikt: **NO_GO_FOR_AUTONOMOUS_HUNT / NEROZHODNUTO / REVIEW_PENDING**.
> Následující historické výsledky zůstávají zachované a nejsou novým během nahrazeny.

## Dokončený rozhodovací průchod CODE — 19. 9., 10:27 CEST

**DECISION_RUN_COMPLETE / NEROZHODNUTO / REVIEW_PENDING / NOT_DEPLOYED.**
Provozní akce: **ponechat stávající binding Qwen3.8**, bez automatické výměny.
Není prokázána stejná kvalita modelů ani připravenost celé platformy.

Čistý měřený zdroj `5b91bab88338ed456664d16260eceec6d76c1e15`,
uzamčený plán `8a234843506a967389598adc82bed33a0785cc8761f66ef2b2338bf25d7172e3`.
Běh 09:54:07–10:27:51 CEST trval **33 min 45 s** včetně kvalifikace,
načítání a izolovaných kontrol. Osm reálných historických úloh, šest
skupin, tři opakování, 48 plánovaných i dokončených pokusů; 53 kvalitativních
volání modelů a dvě paměťové sondy. Každá z 53 odpovědí má ověřený digest,
provider `.2`, terminální `done` a nenulové počty tokenů.

| Model a jeho místo v duelu | Dokončeno bez opravné pomoci | Chybné/nepoužitelné opravy | Ověřené vyčerpání rozpočtu | Nehodnotitelné | Součet času pokusů |
| --- | ---: | ---: | ---: | ---: | ---: |
| Qwen3.8, současný CODE | 0/24 | 24 | 0 | 0 | 13 min 59 s |
| Devstral-small-2, kandidát | 0/24 | 20 | 4 | 0 | 15 min 38 s |

Všech osm úloh má u obou modelů 0/3 dokončení. Rozdíl skupinových průměrů
je 0 p. b.; předem zvolený konzervativní 95% interval je
**[−84,12; +84,12] p. b.**, podmíněný deklarovanou nezávislostí šesti skupin.
Interval nesplňuje podmínky pro změnu ani průkaz horší kvality kandidáta.
Nejde o důkaz ekvivalence ani
pravděpodobnost úspěchu na budoucím projektu. Metrika zde měří celý
lokalizovaný C3 opravný postup, včetně přijatelnosti patche.
[Výsledek a rozhodnutí](evidence/2026-09-19-code-decision-result.json),
[původní nezměněný výstup](evidence/2026-09-19-code-decision-result-raw.json).

### Co provozní porovnání skutečně odhalilo

- **43 pokusů skončilo `patch_failed`.** Z 39 jednoznačně přehratelných
  jednokolových případů nemělo 18 parsovatelný patch a 21 odmítla kontrola
  kotev či původního textu. Zbylé čtyři nejsou do tohoto rozkladu násilně
  zařazené. [Rozbor konkrétních odpovědí](evidence/2026-09-19-code-patch-diagnostics.json).
  Například scheduler: dvě změny pod stejnou funkční kotvou byly odmítnuté
  jako stale patch. Samotný návrh změny není dokončená oprava.
- **Třikrát C3 ohlásilo `all_passed`, přestože jeho testy selhaly.** Parser
  chyb nevyčetl assertion z Node výstupu a prázdný seznam chyb zaměnil
  za konvergenci. Nezávislá závěrečná kontrola stavu souborů všechny tři
  falešné úspěchy odmítla. [Zachované rozpory](evidence/2026-09-19-code-false-convergence.json).
- Dva zbývající pokusy skončily `not_converging`. Žádný nebyl odstraněn
  z jmenovatele. Opravy nebyly během běhu ručně doplňovány.

To ukazuje překážky konkrétního formátu patche a C3 integrace. Výsledek
**nelze překládat jako obecnou nulovou schopnost modelů programovat**.
Ranních 85,71 % / 46,03 % na krátkých opravách nepředpovědělo dokončení
zdejšího provozního úkolu. Další smysluplná oprava patří do předávání
patchů a zpracování chyb C3, nejprve na vývojových případech. Tato již
viděná sada se nesmí vydávat za nový nezávislý holdout při ladění promptů.

### Paměťová kvalifikace téhož profilu

| Model | Vstup / výstup sondy | Vzorkované maximum celé karty | Umístění |
| --- | ---: | ---: | --- |
| Qwen3.8 | 11 990 / 4 096 tokenů | 21,258 GB | plně GPU |
| Devstral-small-2 | 12 182 / 4 096 tokenů | 21,258 GB | plně GPU |

Oba splnily limit **22 000 000 000 bajtů**, kontext 16 384, souběh 1,
KV cache f16, teplotu 0,1 a stejný provider `0.34.0-intentsmith.2` jako
kvalitativní pokusy. Vzorkování po 250 ms: 296 / 402 vzorků, žádná chyba;
API placement potvrdilo celý model na GPU. Jde o naměřené maximum,
ne průkaz submilisekundových špiček nebo libovolného dalšího kontextu.
[Snímek runtime](evidence/2026-09-19-code-runtime.json).

### Oprava výsledkové třídy bez nové inference

Čtyři původní `INCORRECT / 0` měly poslední odpověď `done_reason:length`
a 4 096 tokenů. Podle již platného §4 patří do `OPERATIONAL_FAILURE / 0`.
[Přehled](evidence/2026-09-19-code-decision-result.json) obsahuje pro každou
korekci původní i novou třídu a hash původního záznamu. **Všechny odpovědi,
48 skóre, interval i verdikt zůstaly beze změny.** Původní záznamy nejsou
přepsané; nejde o nové měření. Oprava runneru pro příští běhy vznikla až
po doběhu připnutého zdroje. [Přejímka](evidence/2026-09-19-code-classification-oracles.json)
obsahuje 24 přímých a 28 C3 kontrol, včetně rozlišení tokenového rozpočtu,
neúplné HTTP 200 odpovědi a poruchy provideru.
[Cesta výsledkových tříd](evidence/2026-09-19-code-outcome-trace.json)
propojuje runner, ukládání, agregaci, rozhodnutí a ochranu retention.

### Ověření, evidence a provoz po běhu

- Opravený provider má shodné SHA ze dvou sestavení. Testy jeho completion
  včetně opakovaných znaků a chybějící terminální události prošly. Zůstává
  podporovaným ručním sidecarem; systémová Ollama se nepřepisovala.
- Zdroj obnovený ze samostatných Git bundlů zopakoval původních 24 přímých
  a 27 C3 kontrol; všechny manifesty odpovídají plánu.
  [Reprodukce](evidence/2026-09-19-code-bundle-replay.json) přiznává sdílené
  `node_modules`; nejde o novou instalaci závislostí.
- Širší deterministický profil: nejprve 355 PASS / 2 FAIL / 3 BLOCKED.
  Po opravě testovací odpovědi bez `done` a doložení existujících PDF/OCR
  runtime prošly čtyři dotčené sady. **Efektivně 359 PASS / 1 zděděný FAIL**:
  `nightly-orchestrator-self-test`, nesoulad registru s reviewovanou pečetí
  Gate 0. Není přebaselovaný ani skrytý. První špatně umístěný auditní TMPDIR
  i neúspěšný checkout bundlu jsou také zachované.
  [Validační souhrn](evidence/2026-09-19-code-decision-validation.json).
- Binding CODE před/po je totožný: Qwen3.8 a operace
  `op_4e6c3cf8-c8d3-45d2-bc4f-a18def25b619`. Produkční skóre se neimportovalo,
  nic se nestahovalo ani nemazalo. Sidecar je ukončený, compute procesy
  prázdné, systémová Ollama nemá rezidentní model. Timer disabled/inactive,
  ochranná podmínka zachovaná. [Koncový stav](evidence/2026-09-19-code-runtime-after.json).

Úplný [archiv evidence](/home/belphareon/Projects/coworker/intentsmith-code-decision-20260919/evidence.tar.gz)
má 137 720 708 bajtů a SHA-256
`35221181fe3b0a30c636e3080a568f0ad4b3a14f9a42aa93a51ea48cc7100062`.
Obsahuje původní odpovědi a kontroly, oba Git bundly, plány, neúspěšné
přípravy, opravený provider a postup reprodukce. [Receipt](evidence/2026-09-19-code-bundle-receipt.json)
a [ověření](evidence/2026-09-19-code-bundle-verification.json) dokládají kontrolu
všech 949 souborů proti manifestu (950 položek s manifestem). Velké modelové
bloby a nezměněné nativní CUDA knihovny jsou identifikované otisky; nejsou
součástí archivu. Archiv zůstává na tomto hostu, v Git jsou souhrny a otisky.

Nezávislé přijetí ani nasazení tím nevzniká. Rychlý profil a další role
nejsou součástí této dodávky. Následující oddíly zachovávají přípravu a
průzkumné checkpointy; jejich starší stavové výroky popisují danou etapu.

## Přípravný checkpoint — plán uzamčen před inferencí

**Historický stav před během: PREPARED / MEMORY_QUALIFICATION_NOT_RUN / PAIRED_RUN_NOT_RUN.**
Tato část navazuje na nové zadání operátora; uzavřenou průzkumnou sérii níže
nepovyšuje na rozhodovací data. Aktuální ověřený CODE binding je
`qwen3.8:latest`, digest `22130167c4c2…`, operace
`op_4e6c3cf8-c8d3-45d2-bc4f-a18def25b619`. Protikandidát Devstral byl zvolen
jako druhý v průzkumné sérii, nikoli podle výsledku tohoto duelu.

[Uzamčený plán](evidence/2026-09-19-code-decision-plan.json), SHA-256
`8a234843506a967389598adc82bed33a0785cc8761f66ef2b2338bf25d7172e3`,
obsahuje přesné artefakty, otisky runneru, testů a vstupních kontextů, rozpočet,
provider i Node. [Přejímka orákul](evidence/2026-09-19-code-c3-oracles.json)
zachycuje osm reálných historických oprav C3 `379c2e4` a jejich alternativy.
Dvě chyby CRE tvoří jednu skupinu; dvě opravy jednoho auditu také jednu.
Celkem šest skupin, ne 48 nezávislých pozorování. Výsledkem pokusu je stav
souborů ověřený spustitelnými kontrolami, nikoli závěrečná zpráva modelu.

Primární metrika: dokončení bez opravné pomoci, binárně za celý scénář.
Tři opakování se agregují uvnitř scénáře, scénáře uvnitř skupiny; skupiny
mají stejnou váhu. 95% interval se počítá inverzí dvoustranné
[Chernoffovy–Hoeffdingovy meze pro omezené proměnné, §2](https://www.cs.rpi.edu/academics/courses/spring06/random/hoefding.pdf).
Předpoklad nezávislosti skupin není tímto výpočtem dokázán. Kurátorovaná sada
nedokazuje úspěšnost na libovolném budoucím projektu. Přínos musí mít dolní
mez nad +5 p. b.; mez horší kvality je −5 p. b. Rychlost se měří, ale
v tomto plánu není samostatnou cestou ke změně role. Maximálně 600 s a tři
C3 iterace na pokus, celkově čtyři hodiny. Neúplný pár nebo neplatný pokus
blokuje doporučení změny; všechny zůstávají v počtech.

Provozní rozsah je lokalizovaná oprava v nezměněném C3 `runFixLoop` a patch
engine, přes jeho skutečné testovací callbacky. Není to celý Studio journey.
Každý pokus má čistý export bez Git historie a dokumentace; stejné požadavky,
zdrojové výřezy a limity. Testy a závislosti jsou v izolovaném procesu pouze
ke čtení, síť odpojená. Referenční oprava a odpovědi minulých pokusů nejsou
součástí kontextu ani připojeného filesystému. Model může pracovat jen na
vyjmenovaných zdrojových souborech. Nativní tree-sitter archivního C3 na tomto
hostu padá; jeho vlastní ochrana aktivuje fallback. Každý měněný JS soubor
proto navíc projde `node --check` a skutečnými behaviorálními testy.

Příprava odhalila a zachovala i neúspěchy: neplatný absolutní symlink v
archivu, chybnou detekci dokončení starého testu s `process.exit(0)`, selhání
staré DB migrace, nevhodný síťový test a chyby přípravných kontrol. Vyřazené
historické sady i opravené sondy zůstávají v privátním evidence rootu
`/home/belphareon/Projects/coworker/intentsmith-code-decision-20260919`.
Žádný z těchto stavů není nula připsaná modelu.

Provozní ochrana: instalace při kontrole `d22f64ac` je odlišná od pracovního
zdroje. Její jednotka nepředává `--prune-rejected` ani oprávnění k odstranění
modelů a hunt nepřiřazuje role. Timer je disabled/inactive. V jednotkách
`intentsmith-model-hunt.{service,timer}` je navíc drop-in
`90-code-pilot-hold.conf` s podmínkou na nepřítomnost souboru
`~/.local/state/intentsmith/code-pilot-automation-hold.json`.
Skutečný pokus o start služby skončil `ConditionResult=no`, `MainPID=0`.
Vlastníkem ochrany je tato větev; odstranit ji lze až po přijetí a nasazení
opravené verze a vědomém obnovení plánovače. Tento pilot ji automaticky neuvolní.

Ověření výsledkových tříd: `pairwise-trial` 46/46, durable storage 18/18,
upgrade/retention 103/103; `desktop-hunt` 33/33. V C3 replay navíc ověřené
vyčerpání rozpočtu dává `OPERATIONAL_FAILURE / 0`, porucha provideru
`ENVIRONMENT_INVALID / null`. Profilová nezpůsobilost blokuje kvalifikaci,
nikdy se nepoužije k odstranění artefaktu. Po měření se doplní skutečný
výsledek; zatím není doporučena výměna CODE.

### Zachovaná nepřijatá paměťová sonda a oprava jejího vstupu

První uzamčený [plán v1](evidence/2026-09-19-code-decision-plan-v1.json)
obsahoval nadměrně dlouhý vstup. Provider jej zkrátil na 8 194 / 8 195 tokenů;
oba modely vytvořily 4 096 tokenů, ale nesplnily požadovaných alespoň 10 000
vstupních tokenů. Naměřené špičky celé karty byly 21,152 / 21,146 GB a placement
plně na GPU. [Původní výsledek](evidence/2026-09-19-code-profile-v1.json)
zůstává `PROFILE_NOT_QUALIFIED`; **žádný ze 48 kvalitativních pokusů se nespustil**.
Příčina byla ověřena v lokálním připnutém zdroji Ollamy
`llm/llama_server.go:completionPromptForRequest/contextShiftPromptLimit`:
přesáhne-li vstup celý kontext, první zkrácení uvolní jeho polovinu.

Plán v2 proto zkracuje technickou sondu z 1 000 na 350 vstupních záznamů.
Požadavek ≥10 000 vstupních / ≥2 048 výstupních tokenů, kontext 16 384,
limit 22 000 000 000 bajtů celé karty, modely, všech osm úloh, rozpočty,
metriky i rozhodovací meze zůstaly stejné. Jde o opravu vstupu před jakýmkoli
kvalitativním výsledkem; v1 se nepřepisuje a jeho nespustené pokusy nejsou
falešné nuly. Plán v2 byl následně zastaven kvůli níže doložené chybě provideru.

### Přerušený v2 a oprava neúplných odpovědí provideru

V2 kvalifikoval oba modely: Qwen 11 990 / 4 096 tokenů, 21,159 GB celé
karty; Devstral 12 182 / 4 096 tokenů, 21,151 GB; oba plně na GPU.
Duel byl po sedmi zapsaných pokusech zastaven pouze v našem vlastním procesu.
Devstral při build-arbitration vrátil HTTP 200 s digestem, ale bez terminálního
`done` a počtů tokenů. Provider ukončil legitimní opakovanou čáru `═` po
31 stejných částech a vrátil `ctx.Err() == nil`. Také konec proudu bez
terminální události původně vracel nil. Runner neověřoval dokončení.

[Původní záznamy a jejich vyřazení](evidence/2026-09-19-code-v2-disposition.json)
nejsou přepsané. Jeden doložený neúplný pokus je porucha prostředí;
celý přerušený kohort není rozhodovací evidence. Zbývajících 41 pokusů
zahrnuje jeden přerušený rozpracovaný pokus. Nic se neimportovalo do produkční DB.

Patch `0003-v0.34.0-complete-repeated-code-tokens.patch` odstraňuje pouze
heuristiku opakovaných tokenů; původní konečný tokenový rozpočet a časový
limit zůstávají. Chybějící terminální událost je nyní explicitní chyba.
Runner navíc vyžaduje `done:true` a `stop|length`; uchovává dokončení,
digest a verzi provideru. Sonda přes skutečný C3 loop dává pro neúplnou
HTTP 200 odpověď `ENVIRONMENT_INVALID / null`, bez falešné nuly.
Oprava nemění modelové zadání, případy, meze ani agregaci podle výsledků.

Ollama `.2` je pouze evaluační sidecar pro ruční CODE pilot na 11435.
Systémová 11434 a běžný hunt stále používají `.1`; plánovač zůstává
zablokovaný a nic se neaktivuje. Build: Go 1.26.7, základ v0.34.0,
patchnutý zdroj `4b548b3d49c8bb79b08673bfebc3c2f1f8468fd7`, binárka
`3c22a0cfb46a9ea38fd4dba6746a022be04f5ada21a529e83c9380a5f0547b9d`.
Dvě sestavení se shodují. Reprodukce: `OLLAMA_PROVIDER_REVISION=2`
u existujícího `scripts/build-ollama-evaluation-provider.sh`; nativní payload
zůstává hashově ověřený a beze změny. V3 je nový uzamčený plán uvedený výše;
opakuje i paměťovou kvalifikaci na opraveném provideru. Orákula: 24 přímých
kontrol a 27 průchodů C3; všechny PASS. Nejde o nezávislé review.

## Uzavřená průzkumná série

**EXPLORATORY_MEASUREMENTS_COMPLETE / STEP_4_PARTIAL / PILOT_INCOMPLETE / REVIEW_PENDING.**
Autorita: pokračování schváleného CODE pilotu a přímý pokyn operátora
„muzes zacit s merenim“. Průzkumná data neopravňují k výměně role.

## Rozsah a výsledek

Čistý zdroj `0ca09dd931fe94fb09b8e0937cb43d9d9f62d7ed`, kontrakt
`0e55ee99cda70bb8d5a1c78741eeee3efcb234da5aa2fc8cb1278c4f61677c94`.
Stejná Ollama `0.34.0-intentsmith.1`, kontext 16 384, teplota 0,1,
limit odpovědi 4 096 tokenů, limit generování 300 s. Jeden model současně;
45 minut maximálně na proces včetně čekání na GPU. Tři čerstvá měření,
žádná použitá cache, celkem **63/63 pokusů, tři DB COMPLETE**.

| Model | Průměr sady | Plně splněné úlohy ve všech opakováních | Pokusy | Čas měření | Krátká paměťová sonda |
| --- | ---: | ---: | ---: | ---: | ---: |
| `qwen3.8:latest` | 85.71 % | 6/7 | 21/21 | 5:00 | 16.13 GiB |
| `devstral-small-2:latest` | 46.03 % | 3/7 | 21/21 | 5:27 | 15.78 GiB |
| `qwen3-coder:latest` | 11.43 % | 0/7 | 21/21 | 3:36 | 18.71 GiB |

Čas měření zahrnuje kontrolu orákula a vyhodnocení, nikoli celý start a
ukončení provideru. Všechny tři paměťové sondy vykázaly nulový CPU offload;
nejde o kvalifikaci maximální špičky při dlouhém vstupu a generování.
Plný protokol a zdrojová data shrnuje
[strojový přehled](evidence/2026-09-19-code-pilot-comparison.json).

## Co skutečně znamenají čísla

Sedm úloh opravuje úseky o 12–52 řádcích. Pět skupin: výběr starých modelů,
modelové lease (dvě varianty), jistota porovnání, ukládání chatu, časovače
(dvě varianty). 78 cílových kontrol není 78 nezávislých scénářů; 63 pokusů
není 63 různých úloh. Průměr zde dává stejnou váhu sedmi úlohám. Při
popisném zprůměrování nejprve uvnitř pěti skupin vycházejí hodnoty
80,0 % / 44,44 % / 16,0 %. Nejde o alternativní rozhodovací pravidlo.

Výsledky tří opakování v procentech:

| Úloha | Qwen3.8 | Devstral | qwen3-coder |
| --- | ---: | ---: | ---: |
| Výběr starých modelů bez duplicit | 100.0 / 100.0 / 100.0 | 0.0 / 0.0 / 0.0 | 0.0 / 0.0 / 0.0 |
| Souběh změny modelu | 100.0 / 100.0 / 100.0 | 100.0 / 100.0 / 100.0 | 0.0 / 0.0 / 0.0 |
| Ochrana modelu během VRAM práce | 100.0 / 100.0 / 100.0 | 100.0 / 100.0 / 100.0 | 0.0 / 0.0 / 0.0 |
| Jistota porovnání | 0.0 / 0.0 / 0.0 | 0.0 / 66.7 / 0.0 | 0.0 / 0.0 / 0.0 |
| Chyba zápisu odpovědi | 100.0 / 100.0 / 100.0 | 100.0 / 100.0 / 100.0 | 80.0 / 80.0 / 80.0 |
| Časovač úspěšného volání | 100.0 / 100.0 / 100.0 | 0.0 / 0.0 / 0.0 | 0.0 / 0.0 / 0.0 |
| Časovač síťové chyby | 100.0 / 100.0 / 100.0 | 0.0 / 0.0 / 0.0 | 0.0 / 0.0 / 0.0 |

Qwen v této sadě vede; to není průkazná pravděpodobnost dokončení projektu.
Průzkumné rozdíly proti němu jsou −39,68 a −74,29 procentního bodu.
Interval ani rozhodovací mez nebyly uzamčené před během. Nevydáváme proto
intervalové rozhodnutí podle §6 ani doporučení ke změně bindingu. Oddělený
provozní holdout v C3 podle §8 stále neproběhl; quick/full profil není hotový.

## Proč coder dostal 11,43 %

Z celých uložených odpovědí a jejich skutečného znovuspuštění:

- ve dvou úlohách modelových lease vrátil původní vadný kód bez opravy;
- v rozhodovací funkci napsal `incumbententWins`, takže vznikla ReferenceError
  a čtyři regresní kontroly selhaly;
- při čištění modelů porovnává původní jména, ne kanonickou identitu, a
  `.filter(Boolean)` nad objekty neodstraní jejich prázdné pole `model`;
- při chybě sítě používá `timeoutId` mimo platný rozsah;
- při úspěšném volání ruší časovač až po parsování, přestože zadání požaduje
  dřívější hranici;
- typ chyby zápisu splnil 4/5 kontrol: potomek předá `cause`, ale základní
  konstruktor ji nepřijme ani nepředá do Error, takže se původní chyba ztratí.

Qwen3.8 splnil šest úloh; v sedmé vrací číselné `confidence` místo
požadovaného slovního stupně. Devstral měnil výsledek této úlohy mezi
opakováními (0 / 2⁄3 / 0); dále selhal na deduplikaci a obou časovačích.
**16/16 různých neúspěšných odpovědí z celé série reprodukovalo stejné skóre.**
Žádné dnešní skóre nebylo dodatečně opravováno či přepsáno v DB.

## Oprava zadání a ověření před inferencí

Dvě původní úlohy neuváděly povinné veřejné rozhraní a stupně jistoty.
Doplněno před novou sérií; všichni tři dostali stejný nový prompt. Historické
kalibrace jsou oddělené, fingerprinty úloh i kontrakt sady se změnily.
To opravuje zadání, nikoli reprezentativnost celé sady. Qwenových starých
76,19 % se nepřebírá jako nové měření. Podrobná korekce původní hypotézy
parseru je v [předchozím checkpointu](2026-09-18-CODE-PILOT-GRADER-CHECKPOINT.md).

Čistý commit před inferencí: 49/49 odpovědních sond + gold/alternate/broken
orákula všech sedmi úloh PASS. Cílené kontroly runner 62/62, suite 27/27,
read-model 22/22, artifact 160/160, registry 525 programů validní. Původní
neúspěchy (vlastní neplatná sonda, zastaralý LOC census, chybná cesta k
registry skriptu) zůstávají v evidenci; nejsou skryté jako úspěch.
Úplný profil po této deltě nebyl opakován; dřívější zděděný FAIL pečeti
nightly orchestrátoru nebyl touto prací opravován ani přeznačen.

## Živý stav a evidence

Při dokončení jsou všechna skóre ověřená proti produkční DB. Přesné identity:

- `qwen3.8:latest`: run `eval_17ffb1f3-2f42-4f8a-bec7-8e11780cac03`, digest `22130167c4c20e20c7b71454612966ca8e8171e9b3cc8ab6ce8aa6cbfec79643`.
- `devstral-small-2:latest`: run `eval_b11c62f7-8631-4485-9af9-17e49c0306ee`, digest `24277f07f62db8f9cb68e9dfc679ea1818a7fbac47a50eff0a701d3f645b63c8`.
- `qwen3-coder:latest`: run `eval_40172b39-041b-44b5-b627-b477aa97426a`, digest `06c1097efce0431c2045fe7b2e5108366e43bee1b4603a7aded8f21689e90bca`.

Inventář zůstal na 13 stejných artefaktech, bindingy jsou beze změny. Nebylo
stahováno ani mazáno. První ranní pokus se starým kontraktem byl ukončen
před inferencí při čekání na cizí GPU práci. Tato práce nebyla zastavena.

Během série se **souběžně změnila instalace** z `0ef67a56` na `c0eeec50`
a timer přešel na enabled/active (07:26:44 CEST, další tick
20. 9. v 03:10:48 CEST). Tato série timer nezapínala ani nepřepisovala
instalaci; původ změny není tímto reportem doložen. Aktuální instalovaný
build neobsahuje dnešní opravy evaluátoru, takže výsledek aktuálního
kontraktu nelze automaticky očekávat v jeho tabulce současných skóre.
Měření běželo z připnutého pracovního zdroje, data jsou v téže produkční DB.
**NOT_DEPLOYED** platí pro tuto deltu. Po skončení série byl seznam NVIDIA
compute procesů prázdný; další GPU měření tato série neplánuje.

Soukromá evidence:
`/home/belphareon/Projects/coworker/intentsmith-code-resume-20260919`.
Obsahuje plné odpovědi, replay a logy, vstupní/výstupní inventář, plán,
invokace, identity kontraktů a zachované negativní pokusy.

Content-addressed balíček (SHA-256):

- `evidence.tar.gz`: `f15b36f0d310baa1b2c800007d78d3fba4db6db099e24512f71768904048ca90`;
- `evidence-manifest.json` (47 souborů): `24e86096a2445241b0470f3e6ee0fbdaccbe1c4a61dc7e070ffc76304521b5cc`;
- `source.bundle`: `4fd6168c096c6b53f7761cfc77ca95b7a29b10d1481bf3f010c3873ff7cf4235`.

Git bundle byl ověřený; obsahuje měřený `0ca09dd9` a vyžaduje předchozí
publikovaný `f5f35757`. Není to archiv celého prostředí ani nezávislé
zopakování fyzického GPU běhu. První neúspěšný pokus balení zůstává
označený jako neplatný v `packaging-first-error.json` a oddělených souborech.

## Následná dvoubloková sonda — bez inference

Autorita: operátorovo review a §3 schváleného kontraktu. Původní kontrola
49 odpovědí neověřovala rozdělení **jednoho nahrazovaného úseku** mezi dva
bloky. U tří úloh s více úseky už správná alternativa měla dva nebo tři
bloky; tvrzení, že všechny dosavadní sondy byly jednoblokové, by nebylo přesné.

Nová sonda rozdělí alternativu čtyř jednoúsekových úloh do dvou bloků na
hranici řádků. **Před opravou všechny čtyři dostaly 0** s důvodem neplatné
syntaxe; původních 49 kontrol prošlo. Parser z odpovědi vybíral nejdelší
blok, a tím odstraňoval nutnou část opravy. Nyní pro jeden úsek spojí všechny
bloky v pořadí odpovědi, vloží jediný celek a jednou jej vyhodnotí. Nevybírá
úspěšnou variantu podle testů a nezahazuje kratší blok s chybou.

Přejímka po opravě: **57/57 kontrol, všech 7 úloh PASS**, včetně čtyř
rozdělených správných alternativ (1) a čtyř rozdělených vadných základů (0).
Runner **66/66**, suite **27/27**, artifact **160/160**. Další skutečné
spouštěné kontroly ověřují pomocnou funkci ve druhém bloku, konfliktní
deklarace a kratší blok, který vyvolá chybu. Nejde o pouhé testování řetězce.
Fragmentace více samostatných rozsahů do dalších neoznačených bloků zůstává
nepodporovaná: vyžadovala by jednoznačné přiřazení fragmentů. Tato delta ji
neprohlašuje za vyřešenou.

Nový kontrakt je
`94ef238d38c3ad8b2ed4894b9ad85e90a8905a02eb7f4d85773337b99d5b66ab`.
**63/63 ranních odpovědí dává se starým i novým parserem bajtově totožný
extrahovaný kód.** Je to kontrola dopadu parseru, nikoli nová inference ani
přeznámkování. DB řádky se nepřepisovaly, nepřenášely do nového kontraktu
ani nepoužily k výměně role. Původní měření výše patří výhradně k `0e55ee99…`.

Report orákul nadále kvůli kompatibilitě nese `independentGroups: 5`, ale
výslovně doplňuje `groupingStatus: DECLARED_SCENARIO_GROUPS_ONLY` a
`decisionRuleStatus: NOT_IMPLEMENTED`. Počet deklarovaných skupin není důkaz
nezávislosti a není implementací celého §6. Ani hotové tři průzkumné běhy
nedokončují krok 4, který požaduje také předem uzamčené meze a nejistotu.

Navazující pořadí: dokončit rozhodovací a provozní část CODE; potom D2/R2
s lokacemi a reprodukčními kontrolami; před sémantickým skórováním otevřených
odpovědí D1/R1 přijmout hodnotitele T4 podle §3. Více opakování nebo variant
jedné vady nenahradí více nezávislých historických případů. Rychlý profil se
odvodí až z přijatého širšího měření; samotných 20–30 minut kvalitu sady
nedokazuje a krátké současné úlohy nepředstavují kompletní test role.

Soukromá evidence této delty je oddělená:
`/home/belphareon/Projects/coworker/intentsmith-code-parser-20260919`.
Obsahuje zachovaný neúspěšný průchod, úspěšný průchod, srovnání parserů a logy.
Starší zapečetěný balíček se nezměnil. Strojový přehled je
[zde](evidence/2026-09-19-code-parser-probes.json).

Při této kontrole má instalace revizi `ec78722b`, stále bez této opravy
parseru i dřívějšího `ENVIRONMENT_INVALID`. **NOT_DEPLOYED** trvá. Timer je
`enabled/active`, další termín 20. 9. 2026 03:07:10 CEST; tato práce jej
neměnila. NVIDIA compute seznam je prázdný. Celý širší testovací profil
nebyl opakován; dřívější zděděný FAIL pečeti tím nezískává PASS.
