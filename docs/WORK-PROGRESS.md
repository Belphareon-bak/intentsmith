# IntentSmith — aktuální postup dokončení

**Aktualizováno:** 8. 10. 2026. Celý offline/database profil na čistém `d4304899` s produktem C15 má 410 PASS a nezávislé review; starší profil `44e4d96c` zůstává historický. HTTP14 je přijatý v původním rozsahu 70 + 17 požadavků; rozpočet 14 CODE volání je uzavřený. C15 na `52d230c1` prošel jednou známou čtyřtahovou cestou až k přesně schválenému zápisu; C6 skóre a historický F11 FAIL se nepřepisují. C16 uzavřel omezenou CPU diagnózu dalších šesti souborových případů. C17 dokončil 24 odpovědí a nezávislé posudky: NO_MODEL_PREFERENCE; žádný binding ani retry. Fan čeká na rozhodnutí o oracle. H1 sběr i soukromé předání operátorovi jsou autorizované, zbývá technická příprava; H1 NOT_RUN, release NOT_ACCEPTED.
**Vlastník integrace a CHAT:** tento koordinátor přebírá ROOT
(`work/real-chat-journeys-20260930`) podle následného pokynu operátora.
Jediný writer `cre-decision.js` i společných map je nyní ROOT; HTTP, Fan, fresh5
a M6 patří témuž koordinátorovi. Hunt a druhý posudek jeho matice zůstávají oddělené.
CHAT checkout slouží následně jen jako vlastní sériový běhový checkout zmrazených kandidátů.
**Release NOT_ACCEPTED. HTTP14 PRIMARY70_SUPPLEMENT17_REVIEW_PASS. Fan FAIL. C15 známý save dialog PASS; C17 NO_MODEL_PREFERENCE. Historický F11 FAIL zachovaný. Mobil čeká na stabilní IDE/BE.**

## Pokračování schválené operátorem 8. 10. 2026

Operátor výslovně požaduje pokračovat za předchozí CPU checkpoint a rozhodl:
„s H1 bych počkal, až bude kontrola úklidu GPU, HTTP bych dal jeden maximálně dva pokusy;
fan — 15 jedna dávka oprav“. Tyto rozpočty již nečekají na další potvrzení.

- H1: podmínka kontroly GPU cleanup je doložená přijatými konkrétními běhy.
  Šest sérií i soukromé předání raw operátorovi pro zaslepení už jsou autorizované;
  starý custody PENDING nevyžaduje nový souhlas. Zbývá bounded vnější dohled,
  úklid dvou vlastněných modelů, bezpečný výstup pouze metadat a fresh freeze nad
  původními `c7f03d56` / `9591ea1b`. Operátor dešifruje těsně před připraveným oknem;
  zatím bez nového plaintextu či sběru, NOT_RUN. [Audit autority a technických mezí](review/evidence/product-continuation-20261008/c17-role-comparison.json).
- HTTP: první genuine CODE repair routeru nad skutečným FAILED návrhem, server
  pouze exact reusePrevious. Historie12 → nejvýše13 v prvním pokusu. Druhý pokus
  je rezerva podle konkrétního výsledku prvního, nejvýše14 celkem; žádný automatický
  retry nebo reset účetnictví. Stejný owner/origin/workspace, chráněný oracle,
  přesný M2 approval, primární70 +supplement17, commit/restart a nezávislé review.
- Fan: jedna dávka historical8 +core repair4 +CLI3, strop15 CODE volání.
  Čtyři spotřebované5f6 výstupy se započtou do budgetu, nesmějí se vydávat za
  durable materiál. Existující exact CODE32k repair output4096 se sváže do nového
  freeze; žádný nový D1/CLI repair/retry. Při selhání fáze rollback a stop této dávky.
- ROOT pokračuje po přijatých cyklech další nezávislou prací; běžný CPU checkpoint
  není konec dokončování produktu. H1 ani nevyčerpaná rozhodnutí jiného proudu
  neblokují HTTP/Fan/CHAT a další již autorizované uživatelské cesty.

Vstup tohoto pokračování je čistý publikovaný04d04ff0, produkt24f329c6;
GitHub main838b8cee znovu ověřený. ROOT je jediný tracked writer. Tři workeři
připravují oddělené privátní kandidáty: GPU cleanup hranice, HTTP single repair,
Fan rozpočet/provenance. Před inferencí source/test review, relevantní CPU kontroly,
publikovaný čistý kandidát, přesný freeze a sériové GPU okno. Žádné nové worktree.

C13 příprava zjistila konkrétní překážky: historický Fan helper uvolňuje lease
po unload chybě a neověřuje prázdné ps/compute; HTTP neověřuje compute po unloadu.
Staré HTTP/Fan helpery navíc správně odmítají nový budget, pro který nebyly napsané.
Opravují se pouze potřebné části existujících helperů; generované aplikační zdroje
ROOT ručně neupravuje. Skutečnou schopnost cleanup ověří následný HTTP/Fan běh,
nikoli zvláštní modelový smoke. CPU příprava sama aplikace nepřijímá.

### C13 — historický průběh schváleného HTTP/Fan pokračování (SOURCE/CPU_PASS; HTTP_PRE_INFERENCE_FAIL; FAN_LIVE_FAIL)

Následující přípravné kroky popisují stav tohoto cyklu. Aktuální HTTP13, F11 a HTTP14 jsou uvedené níže.

BASE04d04ff0. Čtyři stávající manual helpers nyní přijímají přesně HTTP@6
router1/server reusePrevious/cumulative13 a Fan historical8+repair4+CLI3/cumulative15.
Výstupy failed5f6 se účtují odděleně od materiálů; model/oracle/M2 kritéria se nemění.
Společný cleanup ověřuje vlastní provider/model/process lifetime pod stejnou lease,
ukončení requestů/aplikace, terminální unload a tři následné prázdné ps/compute vzorky.
Cizí proces nebo neukončený cleanup znamená FAIL a zachování lease; aplikační FAIL
s úspěšným doloženým cleanup lze bezpečně uklidit, jeho výsledek zůstane FAIL.
CPU22 cleanup,38 HTTP a16 Fan prošly; jiné workery přijaly source i integrované bytes.
ROOT opakoval cleanup22; artifact160/registry596/module1514+0/diffcheck PASS.
Doplňkové artifact/registry/module výsledky jsou ROOT observed tool output, bez samostatného raw logu.
[Hashové předání](review/evidence/product-continuation-20261008/preparation.json).
Lokální raw pakety jsou pod `.intentsmith-artifacts/c13-authorized-product-continuation-20261008/`;
base→candidate diff je `git diff 04d04ff0 -- scripts/manual/`.
Příkazy a očekávané exity jsou v jednotlivých receipt; CPU přezkoušení GPU nepotřebuje.
Živé reviewerovo opakování rozhodujících kontrol má sériové okno až po ROOT cleanup,
bez další inference nad vyčerpaným budgetem. H1/H2, `restricted/`, holdout a jejich raw logy
jsou mimo všechny revize. Další krok je čistý publikovaný kandidát/CI/freeze a skutečné
HTTP/Fan; žádný modelový běh ani přejímka aplikace z této CPU přípravy neplyne.

C13 skutečný source44567af7 publikovaný, remote SHA ověřeno, CI37743439100 všech18 SUCCESS.
HTTP okna adf7a15d a c954b579 skončila před modelem na původním util limitu30:
naměřeno32, potom21/21/32. Nová CODE0, historických12 beze změny, no-load cleanup3empty/release.
Další krok pouze @6 bounded čekání na3 po sobě jdoucí původně platné vzorky,
bez snížení prahů, skrytí odmítnutých měření nebo automatického modelového retry.

Fan freeze2ac4119e vykonal čtyři nové CODE opravy kompletně; spotřeba8+4=12/15.
Nový M2 návrh vznikl, ale source-policy jej zastavila před dnešním approval/oracle:
`../src/history.mjs` a `../src/readings.mjs` místo literal `./history.mjs` / `./readings.mjs`.
Původní protected oracle odmítá totéž; funkční core oracle ani CLI se dnes nespustily.
Projektové soubory se nezměnily; žádný nový approval/execution/effect. Nový pending
má pevnou expiry08:47:55.357UTC (10:47:55 Praha); expiry ani návrh se nepřepisují.
Source/raw/DB-copy/immutable packet audit PASS, 4raw→preview přesně, starý FAIL zachován.
Skutečný own-model unload +3empty ps/compute pod lease +release přijat druhým workerem;
tím je doložen cleanup tohoto Qwen32k běhu, nikoli kvalita aplikace ani H1 sběr.
H1 zůstává bez nového plaintextu/sběru; technické podmínky jsou samostatné.
Pozdější audit potvrzuje již autorizované soukromé předání operátorovi, viz aktuální stav nahoře.

Nezávislá diagnóza prokázala ekvivalentní import targets (M2 governance je přijala),
parse-only3+16CPU PASS, žádné spuštění subjectu. Konkrétní privátní změna source-policy
**i chráněného oracle** je přezkoumaná, operátorovi byla předložena k rozhodnutí;
zatím se neaplikuje. Funkční oracle scénáře a rozpočet15 se nemění, další core generace
není povolená. Pouhé obnovení dnešního pendingu není současným runnerem podporované;
změna chráněných souborů může zneplatnit jeho M2 workspace binding. Přijaté app výsledky0.
[Přesné actual a revizní SHA-256](review/evidence/product-continuation-20261008/actual.json).
HTTP admission V2 integrovaná po nezávislém review771a5e48…bd99b9c:
23 nových a38 původních CPU PASS, všechny15 hashované refs ověřené.
Pouze @6 čeká v každé ze dvou admission fází nejvýše20 vzorků/30s na3 po sobě
jdoucí původně platná měření pod stejnou lease; každý odmítnutý vzorek zůstává.
Cizí compute/model nebo ztráta lease okamžitě zastaví start. Žádné snížení prahů,
modelový retry či změna oracle/rozpočtu. Nové source/CI/freeze před skutečným HTTP.

### C14 — zachování požadavku při doplnění názvu souboru (SOURCE/CPU_PASS; F11_LIVE_FAIL)

BASE44567af7, navazuje na přijatou C10 diagnózu. Pouhý název souboru ve stejném
kladném projektu nyní zachová aktivní kanonický write/create požadavek, i když
klasifikátor chybně vrátí continuesPending:false. Zdrojově15 řádků; prompt,
model, resolver a samostatné write schválení se nemění. Cancel, nové zadání,
jiný projekt, neaktivní otázka, chybějící původní odpověď a source barrier mají
negativní regrese. Source72cc496d…62876 a test13a44943…0d40a integrovány ROOT.
CPU RED15PASS/4FAIL → GREEN19PASS; původní testy zachované. Skutečný řízený
M1/SQLite/restart test: RED1FAIL → GREEN1PASS,30 HTTP tahů,17 čistých zastavení,
51 fixture provider odpovědí,0 skutečných modelových volání. Čtyři efekty mají
čtyři přesné explicitní approval příkazy/granty; restart před cílem, před approval
i po něm, přesné36/66/97/10B soubory. Nezávislé source review0b20da31…98a3ef
a test/raw/DB-copy revieweb9a9fe9…043d8b; žádná self-acceptance.
ROOT integrovaná context sada74PASS/0FAIL/exit0, raw v C14/root-validation/context.log.
Integrované project57/artifact160, module1514+0/3cykly28 a registry596 PASS;
raw logy i exit receipts zachované. [Hashové předání C14 a admission](review/evidence/product-continuation-20261008/c14-and-http-admission.json).
Dosavadní C6 NO_GO a C7 LIVE_FAIL zůstávají; fixture není modelové skóre.
Lokální evidence `.intentsmith-artifacts/c14-save-continuation-20261008/`;
nečíst H1/H2, restricted/ ani holdout. Následné HTTP13 a F11 výsledky jsou níže;
F11 neprocvičil false-flag guard a neprokázal úspěšnou save cestu.

C14 source checkpoint `eb6effe6b782f64b264cefbb5a29abeccdf4a98b` publikovaný,
remote přesně ověřené. CI37749230168/job113218074669 všech18 SUCCESS;
source binding6ba4f5de…39c904 a finální HTTP freeze reviewf3163a79…f1a994.
HTTP freeze f8e7ae2f…e9960fd, skutečný běh08:32:18–08:33:32UTC exit0:
jeden nový úplný CODE výstup238tokens, cumulative13. Přesný M2 approval,
primární oracle, commit app6e80b9f0, pending i durable restart replay PASS.
Původní util limit dodržen po11 a10 vzorcích; všechny odmítnuté vzorky zachované.
Own-model unload,3empty a lease release PASS. Původní raw stav PHYSICAL_PASS_REVIEW_PENDING
je zachovaný; nezávislý posudek2e80ca42…a758ff uzavřel PRIMARY_PHYSICAL_PASS_SUPPLEMENTAL_FAIL_CLOSED.
Původní supplemental oracle beze změny, freeze76d7248c…530b172:
skutečný jeden běh08:34:36UTC/exit1,16requestů; slash aliasy a quotedUTF8/OWS
kontroly prošly, `application/json; charset= utf-8` vrátil201 místo415.
Supplement FAIL, aplikace NOT_ACCEPTED. Přijatý druhý/poslední operátorský
pokus následoval jako nový normální single-router CODE modify HTTP14 níže.
Současný lifecycle je succeeded a nesmí být přeznačen na FAILED; žádná ruční
oprava generované aplikace ani oslabení oracle. První běh i jeho FAIL zůstávají.
Po HTTP cleanup proběhla jedna původní F11 CHAT série níže, bez retry a bez H1.
Nezávislý actual audit2e80ca42…a758ff přijal primární fyzickou cestu a správné
uzavření suplementálního FAIL; nová modelová volání z něj neplynou.

### C14 F11 — jeden cílený živý průchod (LIVE_FAIL; EVIDENCE_AND_CLEANUP_REVIEW_PASS)

Původní čtyři známé F11 tahy a původní schvalovací oracle zůstávají stejné;
žádný holdout, nový chatový korpus, prompt nebo změna modelu. Exact Gemma4K CHAT
a dosavadní Qwen4K D1 dependency. Nejvýše jedna série/12 generation forwards,
600s aktivní práce, žádný retry. Původní kontrola obsahu dovolí nejvýše jeden
přesný approval. Dva stávající helpery nyní přebírají přijatý owned cleanup;
3empty admission pod stejnou lease, vlastnictví provideru před forwardingem,
bounded metadata/deadline, join potomka a3empty cleanup před release.
První revize našla visící metadata fetch; druhá mez po synchronním ověření
vlastnictví. V3 obojí opravuje,35Node+5supervisor CPU PASS, staré FAIL zachované.
Source60f021b7…84263e +relay0bbd77ab…ea094a3, nezávislé review18affb60…aa0b49.
ROOT integrovaný runner-contract1 a artifact160 PASS; raw logy i exity zachované.
[Hashové předání F11](review/evidence/product-continuation-20261008/f11-preparation.json).
Před během se vyžadoval čistý source/CI/freeze; samotná CPU příprava nebyla přijetím chatu.

F11 helper publikovaný na `a7ef9239`, CI37752903870/job113230219183 všech18 SUCCESS,
source review16c51713…170fe67, freeze3780c5ed…d50abcb a READYb47c62aa…e9370c.
Skutečná jediná série09:12–09:13UTC:4 známé tahy,7 úplných Gemma4K volání,
transport exit0; praktický **LIVE_FAIL**. Na `photo.md` se znovu ptá na soubor,
nevznikl approval ani efekt. Classifier tentokrát správně vrací continuesPending:true,
původní požadavek se zachoval; následující interpreter dostal i vrátil správný
target photo.md/source answer2, ale zvolil clarify/understood:false. Jde o další
hranici modelového rozhodnutí; úspěch C14 guardu na chybném false flagu tento
konkrétní běh nepotvrzuje ani nevyvrací. Žádný opakovaný modelový pokus F11.
Shared cleanup skutečně unloadnul Gemmu,3empty a lease release PASS; before i after
metadata PASS. Všech74 613 refs/221symlinků po běhu shodných, source clean.
Nezávislé actual/DB/semantics review446c6c48…72b2056 přijalo důkazy LIVE_FAIL,
bezpečné zastavení bez efektů a cleanup PASS. Jde o HTTP/backend cestu; Studio,
živý restart ani úspěšné approval/file write tento běh neověřil. C6 skóre a release se nemění.

### HTTP14 — poslední autorizovaný modelový pokus (PRIMARY70_SUPPLEMENT17_ACTUAL_REVIEW_PASS)

Nový freeze@7 navazuje normální změnou pouze routeru na succeeded app6e80b9f0.
Bez revisionOf, bez přeznačení předchozího M2 stavu a bez nové generace serveru.
Původní primary70 i supplement17 beze změny, maximum13+1=14 CODE, žádný retry.
On-disk anchored edit předává skutečnou chybu charset whitespace a původní
pozitivní případy, nikoli hotovou ruční opravu. Server zůstává hashově chráněný;
do modelového kontextu se znovu nevkládá kvůli původnímu produktovému limitu.
CPU42PASS a nezávislý replay42PASS, review3184907d…83f271a, přesná rekonstrukce
patche a16nových/12historických refs; cleanup a původní oracly zachované.
Helpery jsou publikované na `44e4d96c`; CI37756055502/job113240758670 má všech18 SUCCESS.
Freeze9691c0b4…16acad a READY89eea1e2…1d5447; skutečný běh09:35:16–09:36:30UTC/exit0.
Jeden nový úplný CODE výstup, cumulative14; primární70, přesný M2 approval,
commit app0ae3bd8c a pending/durable restart PASS. Own-model unload+3empty/lease
release a source/history/authority kontrola PASS. Supplemental94a2e062…bf9b4f
jednou09:36:58–09:37:02UTC/exit0, všech17 požadavků PASS,0modelcalls/processGroup empty.
Nezávislý posudek9de65080…4188053 přijímá původní primary70+supplement17,
přesné M2 schválení/commit/restart a vlastněný cleanup. After source/history:
58 918 souborů,220 symlinků a19 historických/policy refs PASS, clean44e4d96c.
Původní HTTP13 supplement FAIL i raw PHYSICAL_PASS_REVIEW_PENDING se zachovávají;
[aktuální hashové předání](review/evidence/product-continuation-20261008/http14-actual.json).
Statický limit: router stále připouští alias charset=utf8, který původní oracly
nezkouší; PASS nedokládá úplnou shodu s přísnějším pokynem „Only utf-8“.
Primární oracle dokládá restart serveru se stejnou /tmp DB uvnitř jednoho běhu;
supplement používá vlastní novou DB. Trvalost M2 authority DB je ověřena zvlášť.
Vanished drain PID3101363 zůstal UNKNOWN/nonempty; teprve další3empty vzorky
umožnily release téže lease. Budget14 je vyčerpaný, žádné další CODE volání.
Nejde o přirozený Studio→D1, úplnou API shodu ani release přejímku.

### Celý offline/database profil před integrací C15 (FULL_PROFILE_REVIEW_PASS)

Čistý publikovaný `44e4d96ceadde57eb67e81c6f67142b1143956f3`,
8.10.09:52:43–10:02:53UTC:410 PASS/0 FAIL/TIMEOUT/BLOCKED/SKIPPED, exit0.
Původní příkaz, prostředí, registry a výběr323offline+87database beze změny;
žádné vyloučení programu, concurrency1,0retry,0uniklých vlastněných process groups.
Nezávislý posudek93ce797d…4381840 ověřil všech410logů/1 323 924B,
tři fingerprinty, context74, původních239kontrol C12 i scenario42.
Dva textové FAIL markery jsou doložené záměrné negativní/simulační stopy.
Přesný source před/po stejný a čistý. CI37756055502/job113240758670 má18 SUCCESS.
[Příkaz, exity, report, všechny logové hashe a přejímka](review/evidence/product-continuation-20261008/c14-full-profile.json).
410 jsou programy: output-gate je import smoke, pět offline crash probes
nedokládá významovou kvalitu. Project57 patří samostatnému focused/server ověření.
Runner-owned HOME/DB/env a process-group cleanup nejsou obecný host sandbox;
žádná nová inference, Studio, H1/H2 ani release přejímka tím nevzniká.
Historický C12 profil a všechny původní FAIL/withdrawn důkazy zůstávají zachované.

### C15 — interpretace doplněného názvu souboru (A/B PŘÍNOS; KNOWN_USER_PATH_REVIEW_PASS)

Předem přijatý experiment porovnal společnou změnu instrukce a odstranění
starých routingových polí z `pending`. Pevný sběr na source `44e4d96c` proběhl
8. 10. 10:11:34–10:12:22 UTC: všech 12 odpovědí úplných, exit 0, žádný retry.
Gemma4:26b, přesný digest `08ae…12a68`, kontext 4K a původní schema zůstaly stejné.

U známého úplného zadání byla varianta A správná v 0 ze 3 opakování, B ve 3 ze 3.
Zákaz ukládání, volbu mezi dvěma cíli i zrušení obě varianty respektovaly ve 3 ze 3
negativních kontrol. Celkem A 3 ze 6, B 6 ze 6 užitečných odpovědí; žádná nebezpečná
interpretace. Nezávislý významový i technický posudek přijaly výsledek v tomto rozsahu.
Jde o opakování jednoho známého pozitivního zadání a tři různé negativy, ne o 95% kvalitu
chatu. Obě změny vstupu působily společně; jejich jednotlivý účinek nelze oddělit.

Replay nevolal M1, DB, approval ani efekty. Vlastněný model se unloadnul;
UNKNOWN PID 3195641 pouze přerušil počítání prázdných vzorků. Následovaly tři
prázdné vzorky a uvolnění téže lease. Technický reviewer znovu ověřil 58 918
souborů closure. [Plán, úplný raw sběr a oddělené posudky](review/evidence/product-continuation-20261008/c15-input-ab.json).

ROOT aplikoval přesné přijaté source a testy do pracovního kandidátu nad `44e4d96c`.
Nezávislé integrované review přijalo source a testy: context 82 ze 82 a project
57 ze 57 PASS v oddělených privátních bwrap bězích bez sítě. Registry 596 a module
graph 1 514 hran / 0 nových / 3 cykly / 28 členů mají nové exit 0 receipts.
Celý profil 410 výše patří zdroji před C15, nikoli této změně.
Na publikovaném `52d230c1` s CI 18 SUCCESS následně proběhla jedna původní
čtyřtahová cesta 8. 10. 10:45:03–10:45:29 UTC: 7 úplných Gemma 4K volání
z nejvýše 12, exit 0, bez retry. Chybějící název vyvolal dotaz; „ano“ jej
nevyřešilo. `photo.md` pak vytvořilo návrh původní odpovědi č. 2. Jediné přesné
schválení provedlo zápis shodných 90 bajtů; před ním žádný efekt ani změna souborů.
Nezávislé významové/DB-copy review `277a31a6…cd8232f` a technické review
`21d76d9b…af92b9` jsou PASS v tomto rozsahu. Vlastní unload, tři prázdná ps/compute
měření a uvolnění GPU lease prošly; 74 644 refs a 221 symlinků zůstalo shodných.
Nejde o živý restart, Studio→D1, nové C6 skóre, 95% kvalitu ani release.
[Přesný aktuální výsledek a meze](review/evidence/product-continuation-20261008/c15-user-path.json).
Původní A/B index je historický checkpoint před touto cestou.

C16 přehrál šest prvních souborových případů C6 mimo F11 (18 historických FAIL).
CPU 13 PASS a nezávislé review potvrdily zachování šesti otázek a průchod šesti
syntetických platných plánů pouze k odmítající hranici před M2. F13 zachoval
`file.create`; žádné efekty nebo změny projektových souborů. Modelový přínos ani
provedení M2 tím doložené nejsou. [C16 důkazy a meze](review/evidence/product-continuation-20261008/c16-literal-save-cpu.json).

### C17 — porovnání role ukládání (UZAVŘENO; NO_MODEL_PREFERENCE)

Na čistém `d4304899` s CI 18 SUCCESS proběhly dva pevné bloky: Gemma a poté Qwen,
každý 12 odpovědí, celkem 24 z 24 úplných, bez retry. Shodné vstupy, instrukce,
schema a nastavení 4K se lišily pouze modelem. Sběr skončil 8. 10. 11:14:55 UTC;
technický i významový posudek jsou uzavřené podle kritérií přijatých před inferencí.

| Model | Správné pozitivní interpretace | Správné negativní kontroly | Nebezpečné interpretace |
| --- | --- | --- | --- |
| Gemma4:26b `08ae…12a68` | 1 ze 7 | 4 z 5 | 0 |
| Qwen3.8 `2213…79643` | 5 ze 7 | 3 z 5 | 1 |

Gemma dál zbytečně žádala upřesnění všech šesti doslovných zápisů a pokračovala
v ukládání otázkou i po změně zadání. Qwen lépe zvládl jasné zdroje, ale znovu
otevřel výslovný zákaz a svévolně vybral `photo.md` z dvojice možných cílů.
U obou zadání se zákazem mazání jiného souboru obě varianty vrátily chybný
režim `create` místo `replace`; příčinu vnitřního uvažování tím nedokazujeme.
Jde o interpretační záměr, ne provedený efekt: adapter neotevíral DB ani M2.
Vlastní unload, tři prázdné ps/compute vzorky a uvolnění GPU lease prošly u obou modelů;
nezávislé technické review ověřilo 56 403 refs a 221 symlinků.

Žádný model nesplnil podmínku všech pěti negativ, nulového nebezpečného záměru
a vyššího počtu správných pozitivních interpretací. Binding se nemění a C17
nemá další retry. Jde o známou omezenou roli, ne nové C6 skóre, 95% kvalitu,
uživatelskou cestu nebo release přejímku. [Pevná kritéria, raw a oba posudky](review/evidence/product-continuation-20261008/c17-role-comparison.json).

### Aktuální celý profil po C15 (FULL_PROFILE_REVIEW_PASS)

Čistý publikovaný `d4304899` má stejné source/tests/scripts jako C15 `52d230c1`.
Původní offline/database profil proběhl 8. 10. 11:25:55–11:36:37 UTC: 410 PASS,
0 FAIL/TIMEOUT/BLOCKED/SKIPPED, exit 0, bez retry a bez hlášených úniků vlastních
process groups. Nezávislé review `84105069…29bc2b9` ověřilo všech 410 logů,
výběr 323 offline + 87 database, stejné fingerprints, context 82, původních 239
kontrol C12 a scenario 42. Zdroj před/po je stejný a čistý; CI má 18 SUCCESS.
Jde o současný produkt C15, ne soukromý kandidát C18. Dřívější `44e4d96c` zůstává
historický. Počet programů není počet úplných uživatelských cest; omezení import
smoke a crash probes, samostatný project 57 i hranice izolace zůstávají.
[Přesné příkazy, logy a přejímka](review/evidence/product-continuation-20261008/c17-full-profile.json).

## Autonomní postup přijatý po revizi 7. 10. 2026

Autorita: operátor opravil návrh v bodech 1–10 a výslovně povolil po jejich
zapracování začít; následně potvrdil převzetí M1 opravy od neaktivního CHAT writera.
Další pokyn v téže relaci přebírá celou ROOT koordinaci, ruší pořadovou
podmínku D1 a určuje jeden H1 sběr: Qwen i Gemma, každý 3 série, poté odstranit
plaintext. Pokud sběr nezačne hned, plaintext odstranit už před přípravou.
Zaslepený balík pro hodnotitele po sběru sestaví operátor; soukromé uchování
a předání raw témuž operátorovi je součást již udělené autorizace.
Tento soubor je jediný aktuální deník. `COMPLETION-TRACKER` je historický od
`2a479852`; chatový PROGRESS uchovává předchozí měření, není druhý společný plán.

**Etapa 0 — převzetí, nikoli nová konsolidace.** Ověřený ROOT základ je
`a61fe70d5ddabd63e066e9cbf4c8111b88f9fa56`, 546 commitů nad ověřeným GitHub
main `838b8cee`. Obsahuje CHAT `e066956b` (merge `56138e4f`) a projektovou D1
změnu `8fe6fb53`. Čistý vlastní CHAT checkout byl na tento základ fast-forwardnut;
To byl stav vstupu C1. Nyní čistý ROOT checkout převzal přesný publikovaný
CHAT `e15264f14b3db3e47837da1adac11509bcc37bc4` pomocí fast-forwardu
z `a61fe70d`, bez slučovacího diffu. Následný C9 produktový checkpoint byl24f329c6;
aktuální zdroj a výsledky jsou v hlavičce tohoto deníku.
Produkce ani oba zmrazené H1 kandidáty
`c7f03d56` / `9591ea1b` se nemění.
Full109 a kopírovaná cache/upgrade jsou přijaté v rozsahu níže; neopakují se bez
nové změny nebo konkrétní pochybnosti. Při převzetí patřil poslední celý profil 410 PASS pouze `86dbca40`; nový C1 výsledek je uveden níže.
Po integraci se kontroluje shoda instalovaných závislostí s lockfilem i dostupnost
předepsaného browser/PDF/OCR runtime před dalším celým během.

**Vlastnictví a předání.** Historický C1 měl úzký CHAT rozsah a byl nezávisle
přezkoumán před převzetím. Nyní se další zápisy i integrace provádějí pouze
v ROOT checkoutu; starý ROOT/CHAT souběh se neobnovuje. Převzetí nesnižuje
HTTP/Fan budgety ani akceptační podmínky a nepřebírá Hunt grading. Přijatý
projektový dispatch D1 se zachová a ověří. Reviewer produktový zdroj neopravuje;
každý nový souběh nad týmž souborem/connectorem vyžaduje výslovné předání.

**Cyklus.** Jedna pojmenovaná uživatelská změna nebo nezbytná diagnóza má vstupní
SHA, vlastněné cesty, reprodukci, pozitivní a negativní důkaz, stop podmínku a
přesné příkazy. Po implementaci následuje nezávislé review druhým workerem,
opravy a nové review změněné části; potom relevantní integrační kontroly.
Autor se nepřijímá sám. Jednotlivé úkoly/commity z agentního protokolu jsou
vnitřní kroky tohoto revizního cyklu. Uzavřený cyklus a nejpozději tři hodiny
aktivní práce dostanou checkpoint zde, včetně otevřených vad a dalšího kroku.
Po přijatém cyklu se pokračuje bez nového běžného potvrzení. Gate 0 patří až
release WP; FAIL/BLOCKED/NOT_RUN se nepřeznačují. Publikace podle CONTRACT §11
ověřuje vzdálené SHA a sama neznamená integraci, nasazení ani release přijetí.

**Pořadí.** C1 je integrován, C4 opakování původního fresh5 na b959a468 má5PASS
a nezávislé evidence review PASS. C5 opravil slot0 i WS guard, ale skutečný v5
skončil po odeslání vstupu při GPU dohledu; další retry ani rozšiřování aparátu
se v tomto cyklu neprovádí. C6 dokončil3×53 a dva posudky potvrzují NO_GO.
Navazující C7 opravil prokázanou aplikační ztrátu save kontextu, C8 další tři
třídy nepravdivého úspěchu při providerové chybě; oba mají nezávislé source
a execution review. C7 cílená živá série přesto nabídku uložení nevytvořila.
Externí revize C1/kolo5 doložila zbývající404/binding false-ok, nesprávné500/502
mapování a projektový catch; jejich společná oprava C9 je přijatá níže.
C10 a C14 oddělily a opravily doloženou ztrátu návaznosti. F11 request19 nyní
odhalil clarify i při úplném vstupu a správném target/source. C15 dokončil
řízené CPU kontroly a pevné A/B: A 0 ze 3, B 3 ze 3 správných pozitivních opakování,
obě varianty zachovaly všechny tři negativy. Integrované context 82 / project 57
mají review PASS. Následná známá čtyřtahová cesta na `52d230c1` prošla včetně
přesného schválení a zápisu; C16 odlišil dalších šest interpretačních případů
od překážek před M2. C17 je uzavřený s NO_MODEL_PREFERENCE: lepší počet pozitivních
interpretací Qwenu nepřekonal vady negativních kontrol; binding se nemění.
`understood:false` se nepovyšuje na zápis. Další rozhodnutí staví na těchto omezených důkazech,
nikoli na novém nedoloženém promptu či regexu. C2 již rozebral všech 36 neužitečných odpovědí a 22 zastavení
z Gemma regrese podle rodiny a příčiny (aplikace/model/hodnocení, překryvy se nesčítají).
H1 má autorizované jedno společné GPU okno pro oba původní kandidáty a soukromé
předání operátorovi; zatím WINDOW_NOT_OPEN. Konkrétní cleanup běhy jsou přezkoumané.
Zbývá technická příprava vnějšího dohledu, dvoumodelového úklidu, bezpečné projekce
metadat a fresh freeze. Nejde o nové rozhodnutí o custody.
Nové dešifrování ani sběr neproběhly; další autorizovaná práce pokračuje nezávisle. D1 nemá pořadovou závislost na sběru ani hodnocení H1.
Stagnace se uplatňuje ihned; nové prompty ani regex opravy bez doložené příčiny.
Po dvou cyklech bez posunu se strategie přehodnotí a problém oznámí, nezávislá
práce může pokračovat. Historické různě hodnocené série nejsou samy kontrolované
srovnání modelů. Pokud evidence ukáže limit lokálního modelu, předloží se měřené
varianty bez tichého snížení kvality nebo změny produkčních bindingů.
Přirozený vstup D1 je implementovaný a integrovaný; zbývá skutečné Studio → D1
ověření, nikoli nové povolení k napsání téže opravy. Další cykly pokryjí
file/web/export/skills, projektové A→B→A a změna→test→rollback/restart,
specialistu/agenta, scoped learning, další restore a provozní/release matice
podle již přijatých závislostí. Mobil zůstává samostatný release.

**Kvalita a holdout.** ≥95 % užitečných / ≤5 % zbytečných zastavení / 0 kritických
chyb / 3 nezměněné série jsou nutná regrese na známých 53 případech, ne finální
přejímka. Rozpad rodin a celé odpovědi lze použít pro tuto exponovanou regresi.
H1 byl odpečetěný, ale podle operátorovy kontroly nespuštěný. Dne 7. 10.
v 16:12:33 UTC koordinátor ověřil oba SHA proti veřejné pečeti a odstranil
přesně `holdout.json`; šifrovaný originál zachován. Aktuálně
`PLAINTEXT_REMOVED / COLLECTION_NOT_RUN`; neznamená to anulování minulé expozice.
[Receipt](review/evidence/chat-holdout-window-20261007/plaintext-removal.json).
Obsah ani odpovědi implementátor nečte, nevyhledává ani nezahrnuje do běžného
review. Zákaz zahrnuje `restricted/`, celé H1/H2 evidence adresáře a jejich raw běhové logy.
Mode 0600 ani proces pod stejným OS účtem se nevydávají za technické oddělení.
Dešifrování provede operátor těsně před připraveným oknem; runner přečte corpus
strojově a ověří pečeť, veškeré logy se přesměrují do privátní evidence.
Koordinátor smí kontrolovat pouze předem vybraná metadata/počty, nikdy case ID,
texty, rodiny ani známky. Operátor po bězích sestaví zaslepený hodnoticí balík.
Jedna H1 kampaň obsahuje Qwen `c7f03d56` 3× a Gemmu `9591ea1b` 3× bez změn,
mezilehlého hodnocení či ladění; každý kandidát má samostatný nový record.
Po sběru se přesný plaintext znovu odstraní, šifrovaný originál a raw důkazy
zůstanou pro správce/hodnotitele. Neúplný sběr se nepřeznačí na přejímku;
implementátor dostane jen celkový verdikt a identitu kandidáta/protokolu,
žádné rodiny, příklady ani průběžné známky. Po uzavření se H1 považuje za
spotřebovaný regresní korpus. Finální etapa 5 vyžaduje nový nezávislý H2,
zapečetěný s rubrikou/prahy před sběrem, bez ladění podle výsledků. Významovou
přejímku provádějí dva nezávislí kvalifikovaní hodnotitelé, ne autor kódu.

**Paket pro každou revizi.** Base SHA a candidate SHA; přesný diff; příkazy
s očekávanými exity; cesty k raw důkazům a jejich SHA-256; známá omezení;
seznam zakázaných vstupů (`restricted/`, H1/H2 a jejich odpovědi). GPU okno
má vlastníka, dohodnutý začátek/konec a předání lease s čistým procesním/GPU
inventářem. C1 CPU/řízený loopback GPU nevyžaduje; živý fresh5 rezervuje ROOT
společně s reviewerem před spuštěním. Bez potvrzeného okna se inference nespustí.
Dokumentace dotčeného chování a aktuální mapy se mění ve stejném cyklu;
historická evidence se zachovává. Technické volby se řeší autonomně; změny
produktového cíle, authority, kritérií, nevratné zásahy a nové výdaje se předkládají
s daty, variantami, doporučením a konkrétním blokovaným krokem včas.

### Pravomoci během autonomních cyklů

| Krok | Kdo rozhoduje / podmínka |
| --- | --- |
| Produktové opravy v aktivních WP, vlastní DB a CPU regrese, lockfile instalace, dokumentace | ROOT autonomně v přidělených cestách; beze změny produktových kritérií |
| Přijetí cyklu a nové importní hrany | Nezávislý reviewer; autor opravuje nálezy a znovu předává změněný rozsah |
| Commit/push vlastní kandidátní větve | ROOT autonomně podle CONTRACT §11; povinné ověření remote SHA, publikace není přejímka |
| Společná integrace, HTTP/Fan/fresh5/M6, sdílené mapy | Tento ROOT koordinátor; dřívější budgety a chráněné oracle zůstávají |
| Živá inference a reviewerovo opakování | Předem dohodnuté GPU okno/lease s ROOT, přesný model/digest/profil a vlastní DB |
| H1/H2 obsah a hodnocení | Oddělený správce/hodnotitelé; implementátor pouze aggregate verdict a identita |
| Nové výdaje, produkční binding/deploy, snížení prahů, rozšíření efektů nebo vyčerpaného schváleného budgetu | Konkrétní návrh a operátorské rozhodnutí před dotčeným krokem; nezávislá práce pokračuje |

### C1 — M1 provider outage (FINAL_EVIDENCE_REVIEW_PASS; INTEGRATED_ROOT)

Výsledek: PROVIDER_UNAVAILABLE skutečně vyžádané modelové klasifikace skončí existujícím
typovaným M1 error, bez odpovědi assistant/úspěšného terminálu a bez effectu.
Deterministická odpověď, která model nepotřebuje, zůstane funkční offline.
Přijatý D1 dispatch ani pravidla pro neplatný modelový JSON se neoslabují.
Rozsah: `src/chat/cre-decision.js`, příslušná stávající M1/kontextová sada,
vlastní evidence a dokumentace; gateway, M2 authority, HTTP/Fan budgety,
produkční DB/bindingy, holdout a tehdejší ROOT checkout byly mimo zapisovaný rozsah C1.
BASE `a61fe70d`, RED `68a51405`, produktový kandidát `1f098912`.
Nová regrese nejprve doložila HTTP 200/status:ok a uložené doptání při obou
výpadcích. Po opravě HTTP 503/status:error, jen uživatelský tah a stejný počet
tool requestů také po restartu. Nezávislý reviewer zopakoval context 27/27,
M1 74/74 a project 44/44 (vše exit 0) a výslovně přijal jedinou novou importní
hranu; přesný baseline byl následně vygenerován z čistého `1f098912`.
[Revizní paket s SHA-256 a příkazy](review/2026-10-07-CHAT-M1-OUTAGE.md).
První širší profil `10ef40ab`: 409 PASS /1 FAIL (chybějící TS grammar).
Druhý `b9cfc7c5`: 409 PASS /1 FAIL (browser cache po npm ci). Oba FAILy zachované.
Závislosti synchronizované podle beze změny zachovaného lockfilu; obnoven tentýž
Chrome152.0.7977.75, samostatný browser test PASS. Finální celý profil
**b9cfc7c5, 15:42:11–15:51:54 UTC: 410 PASS /0 FAIL /BLOCKED /TIMEOUT /SKIPPED**.
CODE12 12/12, CHAT7 7/7, registry596 a CI37644166375 všech18 SUCCESS.
Strom src, chat-context test a lockfile shodné s `1f098912`; module baseline
byl samostatně schválen, ostatní tests soubory se neměnily. `b9cfc7c5` publikován a remote SHA ověřeno;
závěrečný commit doplňuje pouze dokumentaci a důkazy. Nezávislý reviewer ověřil
1250 logových hashů +27 dalších artefaktů a vydal FINAL_EVIDENCE_REVIEW_PASS.
Manifest `de2302b3…d90c89a7`, exact CI job112870464823. Závěrečný docs/evidence
commit `e15264f1` má také CI37648451862, 18 SUCCESS, a je nyní fast-forwardem
v ROOT. Identita testovaného zdroje se zachovala; při převzetí byl fresh5 NOT_RUN.
Následný C4 jej ověřil na b959a468,5PASS/review PASS.

### C2 — okamžité uplatnění stagnace (diagnóza i CPU experiment REVIEW_PASS)

Read-only rozbor exponované Gemma regrese `9591ea1b` připravil druhý worker;
[úplný rozpad 36 vad a 22 zastavení](review/2026-10-07-CHAT-STAGNATION-DIAGNOSIS.md).
22 zastavení je podmnožinou 36 vad, nikoli dalších 22 případů. Přímé providerové
stopy pokrývají jen 19/36 vad; pro 17 chybí. Sedm vad dokládá ztrátu konkrétního
doptání v aplikaci, šest souborových má modelový nebo smíšený kontextový podklad,
16 souborových zůstává UNKNOWN, čtyři se týkají faktů/hodnocení a tři kalendáře.
Samostatný CPU experiment 3×5 podmínek dokončen a nezávisle přezkoumán:
u ambiguous a missing-target-yes se pod0.7 ztrácí konkrétní otázka, nad prahem
zůstává při jinak totožných bajtech. Gibberish pod prahem prokazuje project
dispatch; konečný text je ve třech podmínkách INCONCLUSIVE. Ve všech15 nulové
nové efekty a čistý stop, 2600 hashů ověřeno. Produkt ani modelové skóre se
neměnily. Další C3 má opravit zachování validního read-only doptání bez nových
pravomocí, s vlastní reprodukcí/revizí; C1 freeze pro ROOT se tím nepřesouvá.

### C3 — zachování konkrétního doptání (SOURCE_AND_EVIDENCE_REVIEW_PASS; INTEGRATION_V2_PASS)

Autorita: přijatý chat WP (přirozené doptání a obnovení původního zadání),
operátorův pokyn pokračovat autonomně a 7. 10. „udělej toho co nejvíc“.
BASE `228caaf680002f062dabc47f65dd2b18aca84fc7`; produkt v2 `3bfebf98b8495c455d3193d22aaf2579afbf040e`.
Jeden výsledek: validní AMBIGUOUS s konkrétní otázkou při confidence pod0.7
vrací ASK_USER před regex/project fallbackem. Žádné tools ani akční metadata
z nejistého modelu; kanonická operace a původní zadání z již uloženého pending
stavu zůstávají zachované. Přijímací prahy beze změny, H1/raw/restricted mimo rozsah.
ROOT je jediný writer CRE, stávajícího context testu, důkazů a dotčené dokumentace.

První kandidát bdf461d2 měl RED2FAIL→context28PASS a checkpoint6b593a58
CHAT7/CODE12 19PASS +CI37654239411 success. Nezávislá kontrola DB jej přesto
vrátila: tři nízké confidence ztratily implicitní pending FILE_WRITE operaci.
Nový RED1FAIL doložil vadu; v2 uchovává operaci existujícím canonical helperem.
Context v2 28/28 PASS. Řízený replay3×5:15/15 konkrétních otázek, právě1
klasifikace,0 efektů,0 INCONCLUSIVE, všech5 pending write i původní zadání zachováno.
Nezávislé source/evidence review v2 PASS; DB snapshoty,49 hashovaných artefaktů
ověřené, starých45 raw souborů zachováno. Jde o fixture provider, skóre modelů
se nemění. Opakování19 původních CI integračních sad na checkpointu3c4d750f
má19PASS/0FAIL/BLOCKED/TIMEOUT/SKIPPED, exit0; doc/artifact160PASS.
[Revizní paket s příkazy/exity/diffem/sha256](review/2026-10-07-CHAT-CONCRETE-CLARIFICATION.md).

### C4 — původní fresh5 po C1/C3 (FRESH5_ACTUAL_EVIDENCE_REVIEW_PASS)

Autorita: přijatý M6/project WP a převzetí ROOT operátorem; ne nový release Gate0.
Čistý publikovaný `b959a468554a6377319248e3e3752b4643f85c81`, CI37656397580/18SUCCESS.
Jeden actual7.10.17:25:47–17:33:05UTC: **5PASS/0FAIL**, exit0, žádný retry.
Původní M1 journey, previous-version upgrade, Electron boundary, Studio M1
Electron a Studio M2 composer DOM proběhly po čerstvé offline instalaci/buildu.
Původní90c17489/3PASS2FAIL se nemění. C1/cache/C3 jsou ověřené společně.

Původní V3 ADAPTER426200be…590d4, wrapper9dc32914…8674, cache receipt82265b3a…da6,
5 programů, oracle a limity beze změny. Nový freeze6b1dd8df…8905c připíná aktuální
source/deps/CI/PID/boot; byte drift znamenáSTOP. Nezávislý freeze review uzavřel
P2 nepřipnutého Yarn launcher linku pomocí externího before/after verifieru.
Obě úplné closure a obě launcher kontroly `python3 -I -B` PASS, exit0.

10/10 skutečných modelových odpovědí (4class/4answer/2summary), exactQwen3.5/4K,
395GPU vzorků/316loaded/min5875MiB. 224 vlastněných procesních identit po běhu
neexistuje, bez ROOT cleanup signálů, model/relay/lease uvolněné. Nezávislé review
ověřilo manifest1760,30request-kind a395GPU predikátů, logy/5programů/source/build.
M1 DB z vlastní kopie potvrdila jen USER při outage. Upgrade nested DB test po
úspěchu uklidil;56→80→56→109 dokládá raw receipt a nezměněný oracle, ne nový
post-hoc audit odstraněné DB. n=1; celý M6/soak/release a nové modelové skóre otevřené.
Review65b4b843…12a06. [Přesný paket a omezení](review/2026-10-07-FRESH5-C1-C3.md).
ROOT provedlactual, druhý worker přijal; autor si nepřijímal vlastní výsledek.

### C5 — přirozený Studio→classifier→D1 (LIVE_FAIL; D1_NOT_REACHED)

Původní1012B vstup a limit classifier1 +D1max2/4K,0CODE/efektů zůstaly.
v2/v4 DOM FAIL před emisí a v3 CHANGES_REQUIRED/NOT_RUN jsou zachované.
Ovladač slot0 a v5 WS guard mají nezávislé review;26raw/tamper CPU kontrol PASS.
První freeze builder selhal před actual, opravený r2 má7CPU kontrol a review PASS.
Actual na čistém cd3b8f02,7.10.19:44:28–19:44:42UTC, skončil **FAIL/exit1**:
jeden sloupec doložen, vstup odeslán,1classifier request,0úplných modelových
odpovědí,0D1/CODE. GPU PID1492316 zmizel před /proc kontrolou, cleanup PID1492337
byl zombie bez argv; identity nepřijaté.16pozorovaných app procesů zaniklo,
3SIGTERM skupinám,relay0; graceful cleanup se netvrdí. Own lease uzavřena až
samostatnou přezkoumanou recovery po3prázdných GPU vzorcích; actual FAIL zůstává.
Vlastní post-stop DB kopie: USER +protokolový ASK_USER/status ok,36authority
tabulek prázdných,8projektových souborů/Git beze změny. Source closure PASS.
Přesný gateway exception chybí; C8 samostatně reprodukoval a opravil tři
operational error větve, ale neurčuje zpětně příčinu C5. Nezávislé actual review
b87ccf60…ad3e8/recovery reviewbdfba6d9…5ba82. Podle pravidla stagnace žádný další
C5 retry v tomto cyklu. Před návratem jiná omezená strategie, beze změny oracle.
[Paket a původní FAILy](review/2026-10-07-STUDIO-D1-ENTRY.md).

### C6 — známý Gemma53 korpus po C1/C3 (COLLECTION_COMPLETE; QUALITY_NO_GO)

Clean7ef8efba, původní runner/korpus/rubrika, exactGemma4:26b08ae…12a68/4K.
3×53 dne7.10.,18:13:42–18:29:45UTC, každá série exit0, bez retry/ladění/čtení
odpovědí mezi sériemi.421 úplných generování (159A+262B),0D1; stejné config
fingerprint1612badd…14f5. Technické review4a21b2f3…eb46 PASS_WITH_LIMITS:
423hash refs,698HTTP requests,33schválených efektů(12read/21write),0předčasných
změn/efektů,3integrityPASS na vlastních kopiích DB. Původní DB se při review neotevírají.
Dva nezávislí hodnotitelé přečetli všech159B v kontextu a vykonali12Pythonbloků;
156značek se shodovalo,3neshody oba hodnotitelé vyřešili bez ROOT sebe-přejímky.
**118/159 (74,21%) užitečných,24/159 (15,09%) zastavení,0kritických.**
Série39/40/39 užitečných a8/7/9 zastavení; konsenzusece4195e…93395.
41neužitečných:21vzniká ve výstupu save interpretu,20v odpovědi; tento původ
neodděluje schopnost modelu od aplikačního promptu. Rozpad rodin a159značek v paketu.

B warm n156 medián2218ms/p953798ms, cold n3 medián15096ms. Pozorovaná latence
hostu, ne izolovaný benchmark. Původní runner nemá continuous GPU/lifetime
monitor. Final3 cleanup **FAIL**, zmizelý PID1359590 **UNKNOWN**; samostatný
pozdější leased postflight3empty PASS tento FAIL nepřepisuje.
Historických123/159 není kontrolovaný příčinný baseline C3 (jiný zdroj i posudek).
Stagnace pokračuje: další krok je kontrolované porovnání rolí/příčin se stejným
promptem/schema/4K a negativními kontrolami, nikoli další nedoložený regex/prompt.
Známých53 není H1/H2; finální přejímka zůstává na novém holdoutu.
[Paket C6](review/2026-10-07-CHAT-REGRESSION-C3.md).

### C7 — zdroj při opakovaném doptání (SOURCE_REVIEW_PASS; LIVE_PARTIAL_FAIL)

BASE cd3b8f02 →1c7617a2: ASK_USER zachová již uložené source/user/project ID
pouze při aktivním pokračování ve stejném projektu; modelová provenance se
nepřebírá. Původní „ano“ AMBIGUOUS .5 ztrácelo core save kontext i po restartu.
Řízený RED to reprodukoval, oprava má38CPU PASS včetně skutečné HTTP/restart/
přesné approval cesty a devíti handler→resolver kontrol. Source/evidence review
ee5b34a5…abe3c a čistá integrace19PASS/review777478be…d0f. Původní CI1c skončilo
cancelled při20min apt timeoutu, rerun403; není to PASS. Následný společný
C7+C8 e6b83884 má vlastní integraci19PASS a CI37680691150 všech18SUCCESS.

Cílený živý sběr e6b83884 zastaven po první ze tří plánovaných sérií.
7.10.20:26:18–20:26:39UTC, čtyři známé případy,7úplných Gemma4/4K volání,
runner exit0. Praktický výsledek **FAIL**: po „photo.md“ další doptání,
0proposal/approval/file effect. Klasifikátor obdržel původní write pending,
ale vrátil continuesPending:false; save interpret dostal samotné photo.md
s dostupnou původní odpovědí. Nejde o důkaz ztráty všech core ID ani úspěch3/3.
Cleanup selhal na novém gpu-discover procesu po potvrzeném unload; okamžitý
postflight také FAIL. Pozdější3prázdné metadata vzorky20:35:24–27UTC jsou
samostatné pozorování bez lease, nikoli přepsání FAIL ani admission pro další
běh. Série2/3 NOT_RUN; další actual se v tomto cyklu nespouští.
[Paket C7](review/2026-10-07-CHAT-SAVE-CONTEXT.md). Celkové C6 skóre se nemění.

### C8 — provozní provider chyby (SOURCE_AND_EVIDENCE_REVIEW_PASS)

BASE1c7617a2 → **e6b83884417b066e9d9b40286350255ee3dd4b30**, publikováno a remote
ověřeno. Samostatný řízený M1 RED doložil HTTP502, socket před hlavičkami a
přerušené200tělo jako chybné HTTP200/status ok/uložené doptání. Oprava propaguje
bližší typed HTTP_ERROR/MALFORMED_RESPONSE jako existující500/CHAT_PROCESSING_FAILED,
samostatný UND_ERR_SOCKET jako503/LLM_PROVIDER_UNAVAILABLE. Zrušení má přednost;
invalidní obsah klasifikace uvnitř platné provider odpovědi stále fallbackuje.
Žádná nová importní hrana, prompt, model, retry ani schvalovací pravomoc.
CPU overlay41PASS, finální přesný test6PASS; skutečná čistá integrace19PASS
zahrnuje aktuální context41PASS. Independent review15e0b54c…0ffbc a execution
c8e8460d…93b4f; CI37680691150 všech18SUCCESS. Pět DB kopií potvrzuje po restartu
jen user v chybných konverzacích a žádný nový efekt. Interní user m7.status
zůstává ok; tento cyklus neopravuje samostatnou M7 sémantiku ani všechny
404/empty/binding/queue chyby. C5 přesná historická výjimka stále UNKNOWN.
[Paket C8](review/2026-10-07-CHAT-TRANSPORT-FAILURES.md).

### C9 — chyba classifier/D1 ukončí tah (SOURCE/TEST/EVIDENCE/INTEGRATION_REVIEW_PASS)

Autorita: explicitní nálezy operátora C1/kolo5 nad e6b83884, včetně jednotného
HTTP503 pro provozní výpadky a projektové cesty ve vlastnictví ROOT.
BASE22bb4413; produktový zdroj24f329c6; samostatný přijatý baseline d2f39d7e.
ROOT vlastní CRE, project-collaboration, core chat-turn-error a dva existující
testy; nezávislý worker posoudil zdroj, další reviewer testy a raw evidence.

RED13 ukázal6 false-ok s durable assistant (404, tags absent/500 a3drift podmínky)
a2 chybné500/recoverable:false pro provider500/502;5 controls PASS.
Samostatný projektový RED503 měl200/ok a assistant i po restartu.
Přípravný probe1 chybně očekával recoverable na M1 wire; zachovaný FAIL je chyba
sondy. Opravená sonda ověřuje recoverable uvnitř ChatTurnError; M1 kontrakt se nemění.

C9 odděluje zamítnuté gateway volání od neplatného obsahu úspěšné klasifikace.
Rejected call končí503/recoverable:true, včetně nových/neznámých kódů a EMPTY_RESPONSE;
malformed provider obálka zůstává500. Cancellation a existující typed chyby se
zachovají. Projektový handler už nepřevádí výjimku na úspěšnou assistant zprávu:
invalid/incomplete/vyčerpaný strukturální repair končí500, platné plan:null zůstává200.
Počet původních repair pokusů, prompty, modely, parametry ani approval se nemění.

Řízený GREEN: classifier13HTTP/restart, celý contextv2 52PASS, v3delta7PASS;
project57PASS (44původní+12scénářů+parent), včetně cancel409/validnull200.
Nezávislé source/test/evidence review PASS včetně projektového57PASS.
Žádná inference/GPU, žádný nový efekt či projektová změna. Dvě přesné nové
project→core hrany přijaté; graph1514/3cykly28, žádné nové testové programy.
Na čistém dd8a proběhlo19/19 integračních sad PASS (21:38:09–21:40:59UTC),
finální context55 a project57; nezávislé review0ff669b7…bf53. CI37691183506:
1job/18kroků SUCCESS, reviewfc99f3ad…730b9. Celý profil21:41:51–21:52:35UTC
hlásil410PASS/exit0, ale nezávislé review2d88e7e6…b24b4 jej NEPŘIJALO:
scenario-engine raw22/42PASS20FAIL s exit0. Jde o samostatně opravovaný C11 test,
nikoli přeznačení reportu nebo odvolání cílených C9 výsledků.
[Paket C9: přesná identita, diff, příkazy/exity a SHA-256](review/2026-10-07-CHAT-TERMINAL-FAILURES.md).
CPU přezkoušení nevyžaduje GPU; H1/H2/restricted/ se nečtou. Release NOT_ACCEPTED.

### C10 — přehrání ztráty návaznosti (BOUNDED_CAUSAL_DIAGNOSIS_PASS)

Přesných7 zaznamenaných modelových odpovědí C7, dvě fresh M1/DB varianty,
4tahy a restart po „ano“ i finále. Jediná změna response je classifier
continuesPending:false→true; následující file.save.interpret odpověď zůstává
stejná. Zaznamenané false smaže pending a vytvoří nové originalRequest:photo.md,
user7. Syntetické true předá původní „Ulož tu odpověď.“, user3. V obou je answer2,
8durable zpráv,0efektů/approval, projekt/Git stejný,6vlastních stopů exit0.
3testové výsledky PASS, nezávislé reviewc0e704e0…0164a1. Toto je příčinný důkaz
přenosu kontextu, nikoli oprava nebo zlepšení modelu; finální stejné doptání je
vynucené replayem. Samostatná chyba save interpretátoru prokázaná není.
[Přesný C10 dodatek](review/2026-10-07-CHAT-SAVE-CONTEXT.md).

### C11 — scénářový test nesmí skrývat assertion FAIL (SOURCE_AND_FULL_REVIEW_PASS)

Autorita: operátorský důraz na kvalitu testů a pravdivé release výsledky;
konkrétní překážka z nezávislého C9 full review. Core od v121 načítá scénář
z package, starý test ho neregistroval a jeho vlastní it jen tisklo chyby.
Stejný22PASS/20FAILexit0 je ověřen také ve f475 raw; dřívější přijetí celého
f475 profilu se tím stahuje. Původní logy/posudekb132 i JSON reporty zůstávají
beze změny. Další historické profily se tím automaticky necertifikují ani neaudituji.

ROOT mění pouze tests/scenario-engine.test.js: skutečný taxOptimizationScenario
se explicitně registruje jako fixture generického enginu; všech42původních
jmen a oracle bodies beze změny. Standardní node:test, všechny testy explicitně
await, žádné polykání failure ani návrat doménové logiky do core.
d91ea3e7 je testový commit; a54eaa60 zahrnuje nezávisle přijatou EOF opravu a dokumentaci.
GREEN42/0exit0; missing-fixture22/20exit1; sync i async mutant41/1exit1.
Nezávislé source/test review c429a6d4…f5d261. Nový celý profil na čistém a54eaa60:
7. 10., 22:07:54–22:18:02 UTC, všech 410 PASS, exit 0 a clean after;
review 69e5a0ec…0a771c ověřilo všechny logy, scenario 42/42 i context 55.
CI37694174356: 1 job / 18 kroků SUCCESS, nezávislé review ecfc4383…b4dbc.
U šesti programů C12 bylo vykázáno všech 239 původních kontrol; jejich obecnou
nespolehlivost při vynucené chybě tento konkrétní zelený běh neuzavírá.
Samotné načtení helperu tests/output-gate.js v profilu je pouze import smoke;
nevydává se za provedené funkční assertions. Žádný required program se nevyřazuje.

### C12 — všechny kontroly musí doběhnout a chyba musí vrátit nenulový exit (SOURCE_AND_PROBE_AND_FULL_REVIEW_PASS)

Autorita: operátorův důraz na kvalitu testů a pravdivé výsledky; konkrétní
nálezy omezeného auditu 410 vybraných programů plus společného harnessu.
BASE a54eaa60 → testový commit 6699e962. ROOT vlastní šest testových souborů;
produktový zdroj 24f329c6, registry i výběr programů se nemění.
Knowledge-base, ledger-core a ledger-annual při vložené assertion hlásily FAIL,
ale vracely exit 0. Expertise-system, chat-search-quality a chat-synthesis-hardening
ukončily proces před dokončením vložené zpožděné kontroly, rovněž exit 0.
To nedokládá přirozené selhání jejich původních kontrol v dřívějším běhu.

Kandidáti používají standardní node:test; všech 239 názvů i testových těl,
DB setup a cleanup zachované. Dva nezávislí source revieweři přijali příslušné
poloviny změny. Celkem 24 izolovaných overlay běhů: šest RED, šest kandidátních
baseline (239 PASS), devět negativních kontrol s exit 1 a tři dokončené
zpožděné pozitivní kontroly s exit 0. Vynucené async chyby nekončí cancellation.
Nezávislý peer audit 5039c9ef…618ab přijal všech 24 běhů, přesné mutanty,
manifesty a 239 nezměněných oracle bodies. Závěrečný čistý checkpoint678eead7:
7. 10. 22:26:12–22:36:25 UTC, 410 PASS / 0 FAIL / BLOCKED / TIMEOUT / SKIPPED,
exit 0, clean after. Review dc23d603…d631a ověřilo všech 410 logů, přesný výběr
323 offline + 87 database, 239 C12 testů, scenario42 a context55, bez retry
a úniku vlastněné process group. CI37696180485 má 1 job / 18 SUCCESS kroků,
review 0c495c0d…96db7; registry596 ověřeno samostatně se stejným fingerprintem.
Output-gate import smoke a pět offline crash probes nepředstírají úplné
uživatelské cesty. Živá kvalita, H1/H2 a release nejsou přijaté.
[Přesný diff, příkazy, exity, SHA-256 a limity](review/2026-10-08-TEST-HARNESS-INTEGRITY.md).

## Přijaté dílčí výsledky

| Oblast | Doložený výsledek | Omezení |
| --- | --- | --- |
| Ledger / TaskFlow | CODE → přesné M2 → oracle → commit → restart, review PASS | Malé projekty; obecná úspěšnost CODE neprokázaná |
| SQLite | APPLICATION_ACCEPTANCE_REVIEW_PASS; 7 modulů, 8 965 B | n=1; DB mezi procesy v jednom sandboxu |
| Packaged IDE Ledger | 6 generací; approval/oracle/commit/durable M2 | DOM kliknutí; fyzická dostupnost ovládání otevřená |
| M3 / Worker | Izolace, původ dat, skutečný 5min worker/restart/čistý stop | Kvalita expertise, souběh a delší stabilita |
| AST / GPU panel / Cleanup | Omezené AST review, panel V7 a 3 vlastní refs přijaté | Hunt/model acceptance a cizí/evidence checkouty zachované |
| M6 data | Full109 backup → CLI restore → restart, review PASS | n=1, DB; project/config/skills restore otevřený |
| Kopírovaná cache / upgrade | Původní 56→forcedFAIL80→restore56→109, review PASS | n=1; samostatný C4 fresh5 přezkoumán, release otevřený |
| C4 původní fresh5 | b959a468, všech5 programů PASS, nezávislé evidence review PASS | n=1/4K/Qwen; celý M6, modelová kvalita a Studio→D1 otevřené |

[SQLite export](../examples/generated-apps/sqlite-catalog/README.md), [24 přijatých modulů](../examples/generated-apps/README.md).
BE restart SQLite dokládá durable M2/zdroje; nedokládá DB v dalším novém sandboxu.

## Společný kandidát a kontroly

Předchozí produktový zdroj **e6b83884**: C7+C8, context41PASS, původní CHAT7/CODE12
19PASS, nezávislé execution review a [CI37680691150](https://github.com/Belphareon-bak/intentsmith/actions/runs/37680691150) všech18SUCCESS.
Nový celý offline/database profil9b161de5,20:47:08–20:57:18UTC:409PASS/1FAIL,
0BLOCKED/TIMEOUT/SKIPPED. Jediný FAIL je zastaralý LOC údaj v SYSTEM-MAP,159/160
artifact assertions PASS. Nezávislý census0256f015…cf7c1c5 potvrzuje nové hodnoty;
oprava mění jen dokumentaci, původní neúspěšný report zůstává. Aktuální
[CI37684623930](https://github.com/Belphareon-bak/intentsmith/actions/runs/37684623930) na9b161de5 má18SUCCESS.
**C11 erratum:** přijetí následujícího celého f475 profilu je STAŽENÉ: raw
scenario-engine obsahuje20FAIL s exit0. Níže jsou historická tvrzení runneru
a tehdejšího posudku, nikoli nynější zelené přijetí.
Po tehdejší opravě dokumentace f4754575 proběhl celý původní profil znovu,
**21:00:05–21:09:49UTC:410PASS/0FAIL/BLOCKED/TIMEOUT/SKIPPED, exit0**.
Výběr410sad a všechny limity zachované, source/tests i tracked package/lock manifesty
proti e6 beze změny; nejde o nový hash audit instalovaných dependencies/native loaderu.
Nezávislé execution reviewb132b085…0f8fe ověřilo každý log i konečný stav;
první409/1 se nepřepisuje. [CI37686205441](https://github.com/Belphareon-bak/intentsmith/actions/runs/37686205441)
na témž f4754575 má18SUCCESS. Registry596 ověřen na9b; registry/runner bytes na f475 stejné.
[Příkazy, oba celé profily, oprava a review s SHA-256](review/evidence/chat-transport-failures-20261007/full-profile.json).
Jde o offline/database kvalitu implementace, nikoli živou95% přejímku nebo release.
Starší profily patří svým SHA.

Zdroj cache opravy a přijatého upgradu: **0d86b68e**; [CI37460776179](https://github.com/Belphareon-bak/intentsmith/actions/runs/37460776179), všech 18 kroků SUCCESS.
CHAT 7 / CODE 12 kontroly zachované; merge 56138e4f obsahuje CHAT e066956b / CODE32k / D1.
CHAT checkout 6. 10. ověřený clean e066956b; produktovou logiku CHATu ROOT neměnil.
Historický ROOT offline/database profil **86dbca40: 410 PASS / 0 FAIL / BLOCKED / TIMEOUT**,
5. 10., 04:44:14–04:54:05 UTC; report a5a2f4a3…326d11c, všechny řádky/logy nezávisle ověřené.
Data 24/24, M1 kontrakt 74/74; tento starší profil necertifikuje cache opravu ani release.
Historický doc/artifact gate160 PASS patří ROOT. Aktuální C12 census: src688/237254, tests604/270801; revidovaný graph1514/3cykly28.
Studio bundle 7bf62455…bfe24 / instalovaný BE c84b88cd nezměněné; žádný deploy ani aktivace.
Externí c5309a0/bundle místně chybí; jeho výsledky nejsou přijaté místní důkazy.

## Historický přijatý ROOT runtime milník: cache oprava a skutečný upgrade

Nový cache helper kontroluje vlastní nový cíl a nastaví pouze jeho kořen 0700;
zdroj, payload a executable modes zachované. CPU 23/23; source review 69836bd2…350de0.
Actual **6. 10., 12:26:07–12:26:16 UTC / 8,804 s / bez modelu**, zdroj 0d86b68e:
dvě produktové kopie cache → původní upgrade test → vynucená chyba → přesná obnova → restart/upgradovaný projekt.
Oracle nezměněný: 56→80→56→109, přesné DB bytes, canary/metadata, stejná obnovená DB, pouze loopback.
Exit 0 / timeout 0 / ordinary PGID leak 0 / ROOT signals 0; nested runtime uklizený.
Zdroj/závislosti: 9 464 bytehashů +14 odkazů beze změny; původních 1 180 cache položek zachovaných.
Receipt e7b527bd…ffe1e09, raw oracle 83013355…2475b65; **review 1223d2a8…9d95e79 PASS**.
Actual používá zdroj cache 0700; původní zdroj 0775 pokrývá CPU regrese, nebyl v tomto native běhu zopakován.
[Existující M6 WP](wp/WP-M6-RELEASE.md) uchovává datované FAILy a úplné hranice výsledku.

## Otevřené implementace a rozhodnutí

| Oblast | Co chybí / nejbližší krok |
| --- | --- |
| HTTP CODE | HTTP14 nové1/celkem14, primary70+supplement17 actual review PASS; app0ae3bd8c, M2/restart/cleanup PASS. Omezení charset=utf8 zachované; historické HTTP13 a anchored@5 FAIL nepřeznačené |
| HTTP strategie | HTTP14 zmrazený rozsah uzavřen posudkem9de65080; rozpočet14 vyčerpaný. Další CODE volání, úplná API shoda ani release přejímka z výsledku neplynou |
| Fan | C13 dokončil4 další výstupy, celkem12/15; literal import guard/oracle změna čeká na operátora, původní FAIL zachovaný. Cleanup skutečného Qwen32k běhu přijat; další core inference nepovolena |
| Přirozené plánování | C5 v5 po opraveném ovladači odeslal vstup; GPU monitor FAIL před úplnou odpovědí, D1 NOT_REACHED. Stagnace: žádný další retry v tomto cyklu |
| M1 outage | C1 `1f098912` source review a řízené HTTP/restart PASS; testovaný `b9cfc7c5` full410/CHAT7/CODE12/CI PASS; ROOT převzal e15264f1; C4 fresh5 b959a468 5PASS/review PASS |
| Chatová kvalita | C6 skóre 74,21 % / 15,09 % zůstává NO_GO. C15 na `52d230c1`: známý čtyřtahový dialog, přesný schválený zápis 90 B a cleanup mají nezávislé review PASS. Historické F11 FAIL zachované. C16: šest dalších zadání, CPU 13 PASS pouze před M2. C17 uzavřeno: NO_MODEL_PREFERENCE, 24 odpovědí; žádný binding ani retry |
| Providerové chyby | C9 zdroj24f329c6: zbývající classifier404/binding/drift +projektové chyby terminal; řízené13HTTP/57project GREEN, source/test/evidence/integrace19/CI PASS. C12 na678eead7 a C14 na44e4d96c jsou historické profily; aktuální d4304899 s produktem C15 má 410 PASS / CI 18 SUCCESS / nezávislé review; interní M7 status se nemění |
| Mobil | Chybí conversation.create; implementace a device přejímka až po stabilním IDE/BE |
| Hunt | Potřebujeme nový grading report/cestu a vlastníka pokračování; ROOT cizí hodnocení nepřebírá |
| H1 připravenost | Sběr i soukromé předání operátorovi autorizované, cleanup doložený. Zbývá vnější dohled, dvoumodelový úklid, bezpečná metadata a fresh freeze pro c7/959; dešifrování operátorem až před připraveným oknem. H1 NOT_RUN |

**Historická HTTP evidence do 7. 10.; aktuální HTTP13/14 je uvedené výše.**
[HTTP WP](wp/WP-M2-PRIVATE-HTTP-EXECUTION-20261004.md): linux-bwrap-private-loopback-v1 je zapojený, default offline V1 zachovaný.
Retained@3 M2/oracle/Git1856920f/BE restart prošel; jeho API SOURCE FAIL zůstává historický. [Aktuální export s historií](../examples/generated-apps/http-items-candidate/README.md) odpovídá následnému HTTP14 app0ae3bd8c a přijatému primary70+supplement17 rozsahu.
70 HTTP +14 refused SQL /14 positive, AUTOINCREMENT a dva servery se stejnou DB doložené; rollback4 PASS.
Normal@4 měl úplný kontext/výstupy; následný entry FAIL/model0 zachovaný. Anchored@5 zdroj409ed3a1:
[CI37586564446](https://github.com/Belphareon-bak/intentsmith/actions/runs/37586564446) všech18 SUCCESS; core119/model45, lokální CODE12 PASS, source review PASS.
Actual7.10.,07:27–07:28: dvě úplná CODE volání /cumulative12; vstupy31 115/29 016 B pod guard32 000, stop597/257 tokenů.
Wrongdigest409, pending restart a skutečné přesné approval prošly; nový oracle FAIL po7 HTTP: GET /items/1=400 místo200.
A2 static import opravený jen v kandidátu; A1 regrese ID segmentu a A3 charset stále FAIL. Žádný nový app commit/persistence/supplemental.
Rollback2/2 obnovil všechny4 zdroje/Git1856920 clean; všech257 původních M2 řádků a46 immutable refs zachovaných.
Independent closed FAIL review4279065c…4c6afa9, manifest51/51; ownprocess/proxy/unload/lease closed. Aplikace NOT_ACCEPTED.
Post helper CPU6 +ROOT actualref10/negative2, review6bc20522 PASS; opravuje post kontrolu inode, strict preflight zachovaný, actual FAIL nezměněný.
Genuine repair CPU feasibility9c0c6a3a: router1/server retain, prompt30 614 B, stejný FAILED origin/workspace; žádná inference ani rozšíření budgetu.
Fan 32k byl nejdřív změřen: krátká alokace fullGPU/min free 2 512 MiB; actual dvě loaded samples 2 476 MiB.
To nedokládá zaplněné 32k okno. Output4096 platí jen pro vydaný exact CODE32k profil; ostatní parametry zachované.
[CODE WP](wp/WP-CODE-PEER-CONTEXT-BUDGET-20261001.md), [projektový WP](wp/WP-PROJECT-FLOW-20260918.md).

## Zbývající testy a pořadí dokončení

1. C17 je uzavřený s NO_MODEL_PREFERENCE; celý profil na `d4304899` s produktem
   C15 má 410 PASS a nezávislou přejímku. C18 nyní v soukromém kandidátu prověřuje
   odmítnutí nevyřešených alternativ před předložením efektového návrhu;
   source/CPU review je pending, žádná integrace ani nový modelový přínos.
   Před další inferencí nezávisle přijmout rozhodující kontrolu a negativy;
   žádné automatické přepnutí modelu, per-case prompty, přepis clarify na write
   ani další retry C17. H1 technická příprava může pokračovat pod již udělenou
   autorizací; dešifrování až těsně před revidovaným oknem.
   C15 je publikovaný na `52d230c1`, CI 18 PASS; jeho jediný známý čtyřtahový
   průchod až k přesně schválenému souboru má nezávislou přejímku.
   C14 oprava návaznosti má source/CPU přejímku. C9/C11/C12 jsou uzavřené v uvedeném
   CPU rozsahu; aktuální přijatý celý profil je `d4304899`, 410 PASS a CI 18 SUCCESS.
   C4 původní fresh5 na b959a468: **5PASS/review PASS**. Historický90/3PASS2FAIL zachovaný.
   C5 uzavřít jako přezkoumaný FAIL; další strategie nesmí pokračovat řadou retry aparátu.
   C6 známá regrese74,21%/15,09% NO_GO; C7/C8 produktové opravy přijaté v uvedeném rozsahu,
   první cílený živý save stále FAIL. C14 F11 také LIVE_FAIL, ale bez ztráty vstupu
   a s cleanup PASS. Další změna potřebuje nezávisle přijatý důkaz včetně
   cancel/new-task/cross-project/source negativ. Širší M6/release otevřený.
2. HTTP14 primary70+supplement17 má uzavřený actual review PASS v testovaném rozsahu; další CODE0, úplná API shoda se netvrdí. HTTP13 primary PASS/supplement FAIL zůstává historicky zachovaný. Fan12/15 čeká na rozhodnutí o protected oracle; žádná nová core inference. Původní funkční oracle, commit/restart/persistence a review se zachovají.
3. Živý přirozený classifier→D1, fyzická ovladatelnost IDE/M2, file/web/export/skills a projektové A→B→A.
4. Kvalita expertise/specialistů, worker souběh a delší stabilita; project/config/skills restore; společný profil a finální M5/M6.
5. Mobil: historical CPU47, fyzická matice 13+7 NOT_RUN; device/APK/VPN/pair-revoke/M2/TalkBack.
6. Po přejímce bezpečný cleanup vlastněných zastaralých refs; foreign/UNKNOWN/evidence HOLD (poslední census 215 branches /72 worktrees).

## M5/M6 a Hunt: zbývající externí podmínky

M5 **8/9 REVIEW_PASSED / PRIVACY_CHANGES_REQUIRED / KEY_CUSTODY_PARTIAL / ACCEPTANCE_BLOCKED**.
History retain_and_rotate již vybraná; chybí její signed receipt a 8 category receipts (rotace/revokace nebo podepsané historic not-applicable).
Offline A/operator a B/oddělený reviewer doložené; chybí druhá ověřená operator kopie a reviewer recovery s oddělenou dešifrovací autoritou.
Online zdroje se zachovají. Signed receipts 13, aktuální 24h soak/5min throughput/Gate0 a demo 9 kroků + user approval otevřené.
Hunt RO 6. 10., 12:18 UTC: canonical 107 JSON (106 batches +revision) +3 MD; poslední zápis 30. 9.,19:43 UTC.
Poslední validované pokrytí 596/1173 responses,2324/3689 criteria; historický stop byl weekly API limit, dnešní quota tím nedoložená.
Oddělený ROOT development draft 16/64 se nepřičítá. Nový worker progresspath vyžádaný; Gemma9591 poslední NO_GO, žádná aktivace.
H1 plaintext byl odstraněn, nový sběr NOT_RUN. Kampaň i soukromé předání raw témuž
operátorovi jsou autorizované; nový souhlas s custody se nežádá. Po přijatém cleanup
zbývá technická příprava vnějšího dohledu, dvoumodelového úklidu, bezpečné projekce
metadat a fresh freeze. Operátor dešifruje těsně před připraveným oknem a následně
vytvoří zaslepený balík. ROOT obsah nečetl; veřejné historické receipts se nemění.
[Datovaný archiv](https://github.com/Belphareon-bak/intentsmith/blob/0d86b68ef94bfd260dfb6f06d2231d14865dc9f1/docs/WORK-PROGRESS.md).

### Předání 7. 10. — převzetí ROOT a příprava H1

BASE `e15264f1` (předchozí ROOT `a61fe70d`). C1 je převzat fast-forwardem;
C2 diagnóza i experiment mají oddělené review. D1 časová podmínka výslovně
zrušena; jeho existující implementace `8fe6fb53` potřebuje Studio důkaz.
Při tomto historickém předání C3 ještě neměnil produkt; následný výsledek je výše. H1 kampaň a příkazy jsou v aktualizovaném
[handoffu](review/2026-10-02-CHAT-HOLDOUT-HANDOFF.md); sběr NOT_RUN.
Šifrovaný H1 zůstal beze změny, plaintext odstraněn ověřeným přesným unlinkem;
nejde o zaručené fyzické vymazání ani důkaz, že dříve nemohl být čten.
Heslo vlastní pouze operátor, nový plaintext se připraví až k běhu.
Read-only audit obou frozen runnerů dokončen druhým workerem; finální review
tohoto dokumentačního cyklu **READINESS_DOCS_REVIEW_PASS**
([receipt](review/evidence/chat-holdout-window-20261007/review.json)).
Dva původní P2 (přepis logu a cleanup při přerušení) opraveny a znovu přezkoumány;
finální doc/artifact kontrola 160 PASS, diff check exit 0. CPU runner kontrakt prošel na obou přesných
SHA (syntetický corpus, 0 model calls); instalace frozen lockfilu, SQLite ABI
a bwrap PASS. [Readiness včetně příkazů/hashů](review/evidence/chat-holdout-window-20261007/readiness.json).
CHAT checkout je čistý detached c7f03d56, závislosti patří frozen lockfilu;
ROOT vývojový checkout tím není přepínán. Po sběru návrat na CHAT větev vyžaduje
obnovení jejího novějšího lockfilu, nikoli předpoklad shodných závislostí.
GPU okno není otevřené a žádná inference neproběhla. Raw evidence také obsahuje
kopie H1; výběr jejího předání (šifrovaný balík / soukromě operátorovi) byl tehdy
zapsán PENDING. Pozdější audit autority výše potvrzuje, že soukromé předání operátorovi
už vyplývá z jeho pokynu; tento historický PENDING není nový consent blocker.
Fresh5/Studio má vlastní sériové GPU okno; na dosud neotevřené H1 okno
časově nečeká a inference se nepřekrývají. Tehdy HTTP 13. CODE volání a Fan rozšíření
čekaly na rozhodnutí; operátor je následně 8. 10. autorizoval v rozsahu uvedeném nahoře.
