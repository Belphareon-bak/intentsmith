# GPU hunt — normalizace a provozní ověření

Stav: **GRADING_CLOSED / OPERATIONAL_PROBES_COMPLETE / REVIEW_PENDING / NOT_DEPLOYED**.
Autonomní hunt: **NO_GO**. Tento závěrečný packet není nezávislá přejímka.
Autorita: explicitní zadání operátora 20. 9. 2026; handoff §5–§7,
direction §1 a nezměněný evaluační kontrakt.

## Změna měřítka

`content-rubric.5` sjednocuje 53 otevřených rubrik. Odstraňuje bod za
obecné splnění instrukce a překrývající se rozklady stejného tvrzení.
R2 posuzuje lokalizovaný nález a jeho reprodukci společně: nesprávná
příčina nesmí přijít o bod dvakrát pod dvěma názvy. D1/D2 oddělují
diagnózu, varianty či opravu, zachování hranic a ověřovací postup.
R1 odděluje doložený nález s verdiktem a návrh navazujících kontrol.
Hodnotitel musí přiřadit jednu věcnou chybu právě jedné hodnocené položce.

Škála je 0 / 0,25 / 0,5 / 0,75 / 1 podle direction; mezihodnoty vyžadují
konkrétní správné části, nikoli nejistotu hodnotitele. Vadná rubrika či
chybějící kontext zůstává bez známky. Nulové první kritérium už nemaže
ostatní správné části. Formát zůstává oddělený od obsahu. Produkční parser
se neměnil; jeho sdílení a replay popisuje [parser parity](2026-09-20-PARSER-PARITY.md).

Nový kontrakt není přijatý automatický hodnotitel. Existující kvalifikační
brána zůstává zavřená. Změna formálně zavádí nové rubriky; nepřepisuje
historické response archivy ani jejich známky. Veřejné prompty oproti
předchozímu sběru zůstaly bajtově shodné.

## Ruční čtení

Průběžný adresář: `/home/belphareon/Projects/coworker/intentsmith-hunt-completion-20260920`.
`manual-grades.json` odkazuje přes SHA odpovědi a původní attempt ID na
anonymní `blind-items.json`. Obsahuje konkrétní důvod každé známky.
Identita kandidátů se při tomto čtení nezobrazuje; autor nástrojů však
není nezávislý na autorství části úloh. Shoda s dříve přečtenými externími
známkami se nesmí používat jako slepá přejímka.

Uzavřeno všech 2 922 pokusů. Přímé čtení pokrývá 1 577 dokončených
pokusů (1 277 unikátních textů); 13 nedokončených otevřených odpovědí
zůstává samostatně jako vyčerpaný limit. Celkem je 3 984 odůvodněných
kritérií. Shodná odpověď ve shodné úloze sdílí čtení, všechny pokusy
zůstávají započtené. `grading-freeze.json` vznikl před otevřením identity key;
SHA ručních známek `be00f4621197ac03e0c03b9fe3a18fbe0e78ea7d678a7977b6d955849553e49d`.

Dalších 210 CODE pokusů prošlo spustitelnými orákuly. Přesná pole CHAT/VISION
pokrývají 1 074 obsahových známek. U 37 neparsovatelných odpovědí je obsah
neznámý, provozní využitelnost nulová; 24 vyčerpaných limitů rovněž zůstává
v počtu pokusů s nulovou provozní využitelností. Žádné čekající čtení.
Hodnocení autora nástrojů není nezávislá lidská přejímka.

## Oddělená provozní zkouška CODE

Nový case set `fresh-20260920` obsahuje šest historických oprav:
nekonečný výsledek aritmetiky, gramatiku capabilities, filtrování prose
v konfiguraci, opakovanou VAT migraci, opětovné použití názvu archivovaného
projektu a integritu vzdáleného balíčku. Liší se od sedmi benchmarkových
úloh i osmi již odhalených vývojových případů. Historický kód mohl být
součástí tréninku modelů; netvrdí se opak.

Každý případ obnovuje celé povolené soubory před opravou. Kontroly běží
v bubblewrap bez sítě, mimo produkční DB. Vyhodnocuje se uložený stav,
nikoli text modelu. Vedle reference a alternativy se spouští rozbitý
základ a cílený mutant, dále reference, alternativa, dvojitý fenced patch
a prázdná odpověď přes aktuální produkční fix loop. Čisté opakování na `5831dfaf`: **48/48 kontrol**.

Příprava má zachované dva neúspěšné mezikroky. První soubor obsahoval
chybu zápisu template literal. Další odhalil nesouvisející historickou
chybu parsování unárního minus; vstup byl změněn na výraz `0-5 / 0`,
který skutečně testuje deklarovaný výsledek `-Infinity`. Dále se opravilo
chybějící `entity_profiles` ID ve fixture a doplnila dobová legacy tabulka
`custom_experts`, potřebná k inicializaci historické instalace. Tyto
neúspěchy nejsou modelové pokusy ani se nemažou.

Předvolený pár: CODE incumbent Qwen3.8 proti Qwen3.5:27b podle uzavřeného
replay uloženého benchmarku (1,000 vs 0,84127). Gemma4:26b s 0,85714 nemá
doloženou plnou GPU kvalifikaci požadovaného profilu. Artefakty, profily,
runtime, případy a pravidla se zamykají před první inferencí.
Šest skupin je malý vzorek: shodné pořadí nebude důkaz obecné validity a
interval může zůstat nerozhodný. Výsledek neaktivuje binding ani retenci.

## Provozní výsledek CODE

Čistý `5831dfaf`, plán `374f4ff4ce70a70617e621bc963448175c5168df41bcfbb92e8c21f48fa3eafa`:
Qwen3.8 dokončil 4/6 a Qwen3.5 3/6. Všech 12 pokusů je platných,
7 SUCCESS a 5 INCORRECT. Oba kandidáti absolvovali paměťovou kvalifikaci
16k kontextu / 4 096 výstupních tokenů; maximální pozorovaná paměť celého
GPU byla 21,34 GB. Artefakt je potvrzen odpovědí, provider
`0.34.2-intentsmith.1`. Verdikt **NEROZHODNUTO**, rozdíl kandidát−incumbent
−16,67 p. b., interval [−90,40; +76,18] p. b. Šest předpokládaných
nezávislých skupin nestačí k obecné validaci pořadí. Směr bodového výsledku
souhlasí s benchmarkem, výhru ani přenosovou platnost tím netvrdíme.

## Další zjištěná produkční vada

`WorkflowOrchestrator._finalReview` přijímal neparsovatelný výsledek jako
COMPLETED. `_reviewLoop` propouštěl neznámý verdikt do dalšího kroku.
Obě větve nově končí FAILED s `R1_REVIEW_INVALID` / `R2_REVIEW_INVALID`.
Platné PASS/FAIL/REDESIGN zachovávají svůj význam. 14/14 cílených kontrol
zahrnuje nečitelný text, null, objekt bez verdiktu, pole, UNKNOWN i malé
`pass`, a všechny platné větve. Transport je metodou orchestrátoru,
v běžné aplikaci nadále volá autorizovanou bránu; manuální harness ji
v izolovaném procesu nahrazuje transportem s potvrzeným digestem.

## Příprava navazujících provozních zkoušek

První sběr rolí na `a7bdf9a8` zachovává všech 48 odpovědí. Před jejich
obsahovým posouzením byla zjištěna chyba harnessu: název plánu v R1/R2
obsahoval řídicí sufix before/after. Těchto 32 revizí se nepoužije pro
pořadí; nová série používá neutrální název případu. Šestnáct D1/D2
vstupů název nepoužívalo. Opakování revizí je přiznaný replay po opravě
protokolu, nikoli netknutý první holdout.

Pevný manuální vstup `conversation-operational-handoff.mjs` připravuje
CHAT přes skutečný answer handler a VISION přes skutečný image bridge.
Zachycuje požadavky a odpovědi bez náhrady produkčního parseru. Chybějící
digest nebo CPU přetečení ukončí kvalifikaci role; zbývající plánované
pokusy zůstávají explicitně nezahájené. Běh používá oddělenou DB a
procesovou konfiguraci, žádné produkční přiřazení.

## Přenos pořadí do provozu — výsledek

Pokusy používají skutečný fix loop, workflow prompt/parser, konverzační
answer handler nebo image bridge. D1/D2 se zastavují na hranici další role;
neprokazují provedení svého plánu. R1/R2 kontrolují celé poskytnuté soubory
před/po historické opravě. CHAT používá skutečnou historii, autorizovanou
bránu a výstupní omezení handleru v izolovaném procesu. VISION čte čtyři
vykreslené skutečné reporty, ne živé Studio. Nikde se netvrdí celý GUI journey.

| Role | Srovnávaný pár | Nové provozní pozorování | Pořadí vůči benchmarku |
|---|---|---|---|
| CODE | Qwen3.8 / Qwen3.5 | 4/6 / 3/6 dokončených oprav | stejný bodový směr, **NEROZHODNUTO** |
| D1 | Qwen3.5 / Qwen3.8 | 52,08 / 77,08 obsahových bodů, 4 plány/model | obrácený směr |
| D2 | Qwen3.6 / Qwen3.5 | 81,25 / 78,13 bodů, 4 plány/model | stejný směr, velmi malý rozdíl |
| R1 | Qwen3.8 / Qwen3.6 | 100 / bez souhrnné známky, 8 revizí/model | druhý má 1 nejasné zadání; možné meze 65,63–78,13 bodů |
| R2 | Qwen3.5 / Qwen3.8 | 68,75 / 100 bodů, 8 revizí/model | obrácený směr |
| CHAT | Phi4 / Qwen3.5 | 97,92 / 93,75 bodů, 4 nové vstupy/model | stejný směr, blízko stropu |
| VISION | Qwen3.5 / Qwen3.6 | 4/4 / 4/4 reportů se všemi poli správně | shoda, bez rozlišení |

**Body mezi rolemi ani mezi benchmarkem a provozním postupem nejsou totožné
měřítko.** D1/D2/R1/R2/CHAT jsou odůvodněné autorské posouzení k review;
CODE je spuštění kontrol, VISION přesná pole přes produkční `extractJSON`.
Tabulka nevyhlašuje vítěze, validitu ani procento autonomně splněných projektů.
Meze R1 vyplývají z neznámé jedné položky, nejsou intervalem spolehlivosti.
Before/after revize sdílejí čtyři případy, ne osm nezávislých pozorování.

Čtyři až šest případů je omezený ověřovací vzorek. V D1 a R2 se dokonce
obrátilo bodové pořadí. Nový ověřovací běh tedy **neopravňuje k automatickému
výběru u žádné role**. R1 runner-up navíc v benchmarku nedosáhl 50 %;
byl zvolen jen k diagnostickému porovnání, není přijatým vhodným kandidátem.
Časy jsou zaznamenané, ale CPU zátěž dalších kontrol nebyla izolovaná;
z těchto zkoušek neplyne platné pořadí rychlosti.

### Nové nálezy a poctivé vymezení hodnocení

- D1: plán filtrování pouze úvodu ponechá koncovou prózu; odstranění
  config přípon z `PLAIN_TEXT_EXTS` může následně smazat i validní řádky.
  Jiný plán filtruje všechny řádky a zachovává hranice přípon správně.
- R2: falešný nález tvrdí, že `[A-Z_a-z]` nepřijímá malá písmena.
  Druhý falešný nález ignoruje existující speciální větev non-finite formatteru.
- R1: nový nález mimo referenci odhalil skutečně rozbité české odmocniny
  a mocniny — čištění odstraní písmena placeholderu. Reprodukce původních
  funkcí je v `operational-novel-findings.json`. Popis neplatného regex
  escapování je chybná část příčiny; spekulativní RCE se nezapočítalo
  jako potvrzená vada. Referenční oprava není důkaz bezvadnosti celého souboru.
- U odsazených `#` komentářů se ztráta reprodukuje, ale zadání nevymezuje
  jejich rozsah. R1 položka `b560a5ac36d9` zůstává `score:null`, ne nula.
- CHAT obsahuje dvě blízké hranice k posouzení: neprokázaná příčina timeoutu
  a formulace dalšího kroku se zatím neschváleným deploymentem.

Označení „100 bodů“ u revizí znamená soulad s tímto omezeným zadáním,
ne dokonalý review schopný najít všechny latentní vady. Gold varianty nejsou
úplně označené negativní kontroly celého souboru. Toto není přejímka T4.

Původní známky 2 922 pokusů byly zmrazeny před otevřením identit.
U nových workflow kroků byl klíč rovněž otevřen až po uzamčení známek,
ale při inspekci harnessu byla jedna D2 odpověď předem viděna s identitou.
Nové CHAT čtení bylo **neslepé** (šest identit bylo v metadata prvního výpisu).
Autor posuzoval i vlastní část úloh. Nic z toho se nesmí citovat jako
nezávislá kalibrace ani nahrazovat operátorské posouzení.

## Dokončená obrazová kvalifikace provideru

První skutečný `analyzeImages` zachytil správný obsah, ale skončil
`RESPONSE_UNVERIFIED`: `/api/generate` neměl digest. Tento pokus a sedm
nezahájených plánovaných pokusů zůstávají v `conversation-handoff/result.json`.
Nový verzovaný patch `0005` přidává do lokálních generate odpovědí digest
již vybraného manifestu a provider version; cloudové forwardování nemění.
Výměna tagu během odpovědi nesmí identitu přepsat. Test se streamem i bez
něj prošel; odstranění attestation polí v kontrolním mutantu oba testy shodilo.

Dva buildy z různých prázdných cgo cache, druhý přes verzovaný build skript,
mají stejný SHA `351d992d509eb4c0d97dea75111de1b91d1bec8643dd46a88355fd0b7f11cef3`.
Manuální `.2` sidecar využívá ověřený shodný native payload 0.34.2.
Následných **8/8** skutečných image bridge odpovědí nese potvrzený digest
správného kandidáta a `0.34.2-intentsmith.2`, má celou rezidentní váhu na GPU
a končí `stop`. Všechna očekávaná pole byla správná. Systémová Ollama 11434
se neaktualizovala; běžný hunt nadále používá `.1`.

## Evidence, reprodukce a provedené kontroly

Kořen evidence: `/home/belphareon/Projects/coworker/intentsmith-hunt-completion-20260920`.

- `assessment-review.html`: všechny původní odpovědi, přesná zadání, důvody,
  rozpad podle rolí a identity odkryté po zmrazení známek.
- `operational-review.html`: všech **76** použitelných nových pokusů,
  včetně skutečných CODE testů. Obsahově 75 číselných výsledků + 1 spor.
- `review-sample.html`: **30** anonymních položek (14 cílených,
  10 stratifikovaně náhodných otevřených, 4 náhodné obrazové a 2 nové
  provozní spory). `review-sample-my-grades.json` otevřít až po posouzení.
- `grading-freeze.json` a `operational-grading-freeze.json`: přesné otisky
  před otevřením klíčů; `source-records/` uchovává vstupní evidence.
- Všech 32 vyřazených revizí s before/after názvem zůstává ve staré sérii;
  první neověřený VISION rovněž. Celkem 109 nových modelových pokusů =
  76 použitelných + 32 vyřazených kvůli protokolu + 1 bez response proof.
  Paměťové kvalifikační požadavky CODE jsou evidované zvlášť.
- Zdrojové revize: CODE `5831dfaf`; první role `a7bdf9a8`; neutrální
  revize a CHAT `82161288`; potvrzený VISION `cca3de3b`.
  Pozdější změny neopravovaly produkční CODE fix loop měřený na `5831dfaf`.
- Celý offline/database profil na `cca3de3b`: **363 PASS / 1 FAIL /
  0 BLOCKED / 0 TIMEOUT**. FAIL je
  `IS-T1-TESTS-NIGHTLY-ORCHESTRATOR-SELF-TEST`, již doložená neshoda
  registru vůči Gate 0 pečeti. Pečeť se nepřepisovala; L1 není zelené.
- Cílené kontroly: `evaluation-repair` **14/14**, `desktop-hunt` **34/34**,
  čisté CODE orákulum **48/48**, závěrečný stav všech **12/12** CODE pokusů
  souhlasí se skutečnými testy (7 splněných / 5 nesplněných).
- Chromium proklik: všech 7 rolí / 2 922 dostupných starých pokusů,
  všech 76 provozních detailů a všech 30 položek vzorku; žádná JS chyba.
  Headless `--no-sandbox`, statické review soubory, nikoli nasazené Studio.

Zachované neúspěchy přípravy: první chybné Go testy (import a zděděný model
store), pre-start `DIRTY_SOURCE` při souběžné regresi bez inference,
první L1 bez toolchain opt-in, chybný výstupní adresář toolchain retry,
a chybějící OCR runtime u dalšího retry. Finální celá sada má explicitní
runtime cesty a stále stejný jeden FAIL. Žádný neúspěch se nevydává za PASS.

## Finální verdikt a další přejímka

**NO_GO pro autonomní výběr a mazání podle skóre.** Normalizace rubrik,
sjednocení parseru, dohodnocení původního sběru a nové provozní zkoušky
jsou dodané k review. Zkoušky nepotvrdily obecnou platnost pořadí.

Zbývá nezávislé posouzení připraveného vzorku a rozsouzení nových hranic,
přejímka hodnotitele navázaná na konkrétní contract SHA, dostatečně velká
nová oddělená provozní sada a skutečný průchod Studiem. Tyto malé již
přečtené případy nelze použít jako nový holdout po dalších úpravách.
Automatická rozhodovací autorita zůstává zavřená. Timer vypnutý,
žádná změna bindingů, žádné mazání modelů, žádný import těchto známek
jako přijatého produkčního skóre. Tento packet žádnou z přejímek nenahrazuje.

## Zapečetěný archiv

[Strojový receipt](evidence/2026-09-20-hunt-completion.json) zaznamenává
archiv o 1 258 864 156 bajtech, SHA-256
`7eab04d13d056d4c83aee40f39e6caedf683c67be7a61ea6804a13980ff24523`.
Všech **42 726** běžných souborů bylo po zabalení znovu přečteno z archivu
a ověřeno proti velikosti i SHA v manifestu; bez chybějících, duplicitních
nebo neočekávaných členů. Součástí jsou ověřené úplné Git bundly
IntentSmith `cca3de3b`, historického C3 `379c2e4b` a provideru `2206cee8`.

Manifest výslovně uvádí 59 vyloučených adresářů závislostí, kompilátorových
cache a Git metadat. Patnáct syntetických symlinků z testů uchovává jako
metadata; absolutní cíle se nedereferencují ani neobnovují. Nové spuštění
vyžaduje zvlášť runtime závislosti, toolchainy, váhy a native Ollama payload.
Čtení uložených odpovědí, známek a obrazových podnětů v HTML je přenositelné.
Archivní `REVIEW.md` obsahuje tento dokument před přidáním tohoto receipt;
po zapečetění se mění pouze dokumentace, nikoli měřený runtime nebo známky.
