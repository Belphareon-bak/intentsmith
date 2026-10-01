# IntentSmith — průběžný report dokončování

**Aktualizováno:** 1. 10. 2026, 21:32 UTC / 23:32 CEST.
**Vlastník:** ROOT. CHAT řeší jiný worker, od posledního zadání jej ROOT neupravuje.
**Publikace:** `work/real-chat-journeys-20260930`; průběžný report se aktualizuje
po každém milníku, nejpozději po třech hodinách během aktivní práce. Operátor
dostává samostatný report práce každé dvě hodiny. Každý checkpoint uvádí
přesný testovaný zdroj; novější dokumentační commit nepřebírá jeho testy.

## Stav nyní

IDE/backend mají přijaté dílčí funkční důkazy, celý release není přijatý.
Tři malé skutečné CODE projekty fungují v doloženém rozsahu; SQLite modelové
kvalifikace zatím neprošly celým kontraktem. M2 oprava failed návrhu je
implementovaná a zdrojově přijatá; skutečná aplikace zůstává FAIL.
Skutečné zobrazení GPU/modelových hodnot v IDE má přijatý V7 průchod.
Hunt stále čeká na úplné přijaté hodnocení. Mobilní zařízení přijdou po
stabilním IDE/BE, podle zadání operátora.

| Milník | Doložený výsledek | Co zbývá |
| --- | --- | --- |
| Ledger a TaskFlow | Skutečný model→M2→funkční oracle→Git→restart, nezávislé přijetí | Obecné plánování a větší projekty |
| Packaged IDE/CODE ledger | Přijaté DOM handlery→šest kompletních generací→M2→oracle→commit a durable DB | Kliky byly přes DOM button.click(), nikoli pointer hit-test; fyzická dostupnost tlačítek v jejich okamžiku netestovaná; širší projekty/release |
| Worker | Skutečný pětiminutový test, první změna po intervalu, jedna notifikace, restart a čistý stop | Dlouhý soak a souběh mnoha workerů |
| M3 specialista | Skutečný ProjectContext ze dvou projektů, provenance, stale/foreign odmítnutí, deterministické testy PASS | Živá expert-vs-general kvalita |
| SQLite oracle | Source `34cfc198`: 62/62 autorských CPU, 21/21 nezávislých CPU, registered9/9 a CI SUCCESS / source REVIEW_PASS | Přijatá skutečná aplikace |
| SQLite Qwen3.8 | Sedm úplných generací, ale zakázaná schema dependency; APPLICATION_FAIL, rollback7/7, žádný commit; rejection review PASS | Modelová oprava přes existující nový M2 plán |
| SQLite Qwen3.6 | Čtyři úplné generace; pátý prompt 9468B >8736B, odmítnut před voláním; 0 M2 operací/efektů/zpráv; review důkazů PASS | Jednotlivý scénář není kvalifikovaný; kontextové limity zachované |
| M2 failed-plan revize | Source `a27e4470`:66/66 autorských CPU, source REVIEW_PASS, registered9/9 a CI13/13. Actual8/8 pinned generací, jedna revize, šest přesných retained modulů; nezávislý failure evidence review PASS | APPLICATION_PHYSICAL_FAIL: transaction callback rozhraní; žádný commit, dva7-path rollbacky, úspěšný restart/replay nedosažen |
| SQLite callback kontrakt | Source `f557`: 5/5 cílených CPU, SOURCE_REVIEW_PASS, registered 9/9 a CI 13/13. Actual: čtyři generace, pátý prompt 8811 B >8736 B odmítnut před voláním; REJECTION_EVIDENCE_REVIEW_PASS | APPLICATION_FAIL; callback v běžící aplikaci nedosažen. Řešit objem kontextu, neopakovat kandidáta; první overflow 44 PASS /22 FAIL zachovaný |
| GPU/modely v packaged IDE | V7 QUALIFIED_PHYSICAL_REVIEW_PASS: 7 pointer kliků, 14 modelů /84 eval /7 rolí /76 kandidátů, 98 null scores, 24 GiB a očekávaný Hunt 503; inference/forwarded writes 0, přísný finální namespace prázdný | Přijetí readonly UI/metadat a kapacity. Instalovaný Hunt, přijatý grader, kvalita modelů a release netestované; starší V5/V6 whole FAIL zachované |
| Hunt hodnocení | Strukturální čtení 18:34 UTC nezměněné: 596/1173 odpovědí, 2324/3689 kritérií; stejný report jako 13:31 a 17:21 | Přijatý grader chybí, zbývá 577 odpovědí /1365 kritérií; NO_DECISION /NO_GO. Proč se publikované výsledky neposunuly, je UNKNOWN |
| HTTP projekty | Předem připravený omezený návrh testu | Rozhodnutí o novém M2 síťovém oprávnění; HTTP_NOT_RUN |
| Mobil | Auditovaný handoff, historických47 host testů a přijaté VPN/TLS rozhodnutí | Fyzická matice13+7 NOT_RUN, skutečné zařízení/VPN a integrační mezery |
| CODE peer kontext | SOURCE_REVIEW_PASS; CPU 8 811 → 8 692 B. Lokálně 100 + 22 PASS, šest registry PASS + census recheck PASS, HTTP 75 assertions PASS, CI 13 SUCCESS | Doložená omezená úspora; větší zdroje dál správně odmítané. Celá aplikace stále FAIL |
| SQLite indexed860 | Osm úplných připnutých výstupů, nové přesné M2 schválení, šest retained modulů a dva rollbacky sedmi cest. Callback funguje, vstupy vyhověly rozpočtu | APPLICATION_FAIL: CLI maže dvakrát. Bez commitu a úspěšné restartové přejímky. Konkrétní CLI revize 5 700/11 520 B čeká na rozšíření osmi generací na devět |
| Cleanup | REVIEW_PASS: atomicky odstraněny pouze tři vlastní lokální refs, 216→213 branches, 71→71 worktrees. Tagy, ostatní refs a worktree metadata zachované; obnova v odděleném bare repo PASS. Hunt zpět na původní čisté větvi | BC větev HOLD_CONDITIONAL, fyzické worktree removal HOLD; další cizí/UNKNOWN větve nepřijaté k odstranění |

## Publikované a uchované materiály

- [Generované aplikace](../examples/generated-apps/README.md):17 skutečných
  modelových modulů tří přijatých snapshotů; [archivní IDE probe](../materials/ide2-code-dom-physical-response-guard-20261001/README.md)
  obsahuje15 přijatých zdrojových souborů bez privátních runtime dat.
- Dříve zmrazený skutečně testovaný zdroj je
  [`a27e44701c2160e24ef4b3a37528f6a2f6e745a4`](https://github.com/Belphareon-bak/intentsmith/commit/a27e44701c2160e24ef4b3a37528f6a2f6e745a4).
  Obsahuje opravený AST guard a průběžný report. Má vlastní
  [push CI SUCCESS](https://github.com/Belphareon-bak/intentsmith/actions/runs/36898069050),
  job110489992532,13 úspěšných kroků. Source review přijímá kvalifikaci,
  nikoli neúspěšnou aplikaci. Původní `f17aaa27` CR se zachovává.
- Samostatný pracovní report byl poprvé pushnut v `b1791c7a`; následný
  `fd749bacf0e19e65e602cd5dbe46c57c058f5342` má ověřený remote a vlastní
  [CI13/13 SUCCESS](https://github.com/Belphareon-bak/intentsmith/actions/runs/36901760691).
  Callbackf557 má samostatný source review,9/9 registered PASS a
  [CI13/13 SUCCESS](https://github.com/Belphareon-bak/intentsmith/actions/runs/36904385532);
  jeho actual je kontextový FAIL.
- Dokumentační checkpoint `61bc486f` je pushnutý a má vlastní
  [CI SUCCESS, 13 kroků](https://github.com/Belphareon-bak/intentsmith/actions/runs/36907138041).
  Jeho dokumentační změny nepřebírají actual kvalifikaci source `f557`.
- Následný report `c106e34a` má ověřený remote a vlastní
  [CI SUCCESS, 13 kroků](https://github.com/Belphareon-bak/intentsmith/actions/runs/36910252264).
  Nový [archiv V7 zdrojů](../materials/ide2-hunt-readonly-dom-v7-20261001/README.md)
  obsahuje 19 přesných MJS souborů /105,388 B a má samostatný export
  REVIEW_PASS, SHA `16193bf96ae2d1a151f5005395633b936273f3d9e65e82a0d338370ac7aca904`.
- Přijatý export a nový report jsou pushnuté v `5fd54ee7`, remote přesně
  ověřený, [vlastní CI SUCCESS, 13 kroků](https://github.com/Belphareon-bak/intentsmith/actions/runs/36912177685).
  Návrh CODE peer kontextu je stále DRAFT, nikoli implementovaná oprava.
- Dokumentační `79b201c8` má vlastní [CI SUCCESS](https://github.com/Belphareon-bak/intentsmith/actions/runs/36891027839).
  Source34 má [samostatné CI SUCCESS](https://github.com/Belphareon-bak/intentsmith/actions/runs/36888388296).
  Dokumentační commity nepřebírají fyzickou kvalifikaci jiného SHA.
- Privátní DB, raw provider capture, screenshoty, cookie a provozní metadata
  zůstávají v hashovaných privátních packetách a chráněných archivech. Do Gitu
  se publikují přijaté source-only kopie a popisné důkazy. Nevyhovující
  SQLite snapshot se nevydává za přijatou aplikaci.
- Cizí/UNKNOWN rozpracovanost hlavního checkoutu a produkční BE nebyly
  upraveny ani pushnuty jako vlastní změny. Produkce nebyla aktualizována.

## Důkazy a limity aktuálních výsledků

Source34 review SHA `0f8ec265197d9a5a573a3a049e27ced7a4d0b4585541ad16311cd45a458691e5`.
Qwen3.8 rejection review SHA `4b21d8a33a785f4b2cb163146d8d3239925dcc9a6f6fe4384c985c76691f4953`.
Qwen3.6 review SHA `ea60409e32e3801b07fe0c9022583658ddde6bb3c0d17c8e205513da22cc0db0`.
Revision CPU65 log SHA `d278fffaee6d450a621fc4a8337b37c16a55946b9ff2f9297aa282a9b0284b09`.
Sourcef17 CR review SHA `319e5c9008164be875fe84a087be6540d21f5687b9fabd6ef26cf0b7487f33f3`.
Navazující AST/fáze/census CPU66 log SHA `933a3da611759fd2ee2e60672cab86c8583a851ef580e04a70521c53195c9592`.
Registered f17 report SHA `d367c3f95b53ea17853dc96bd53d646964fa7ebad11be3e3aa7a96e2510bb046`
má8PASS/1FAIL, nikoli zelenou bránu. První autorský SQL-query FAIL je uchován.
V3 GPU guard review SHA `9915aa9f0b41f6e30a9d143e98fc7b2e2b9b2660dc5fef1b295c6f82a2a39dd6`
přijímá harness, nikoli jeho následný actualFAIL ani modelovou kvalitu.
Actualv3 failure review SHA `37f8c171c4299872cc71b2de494559a1aa018fae18ddc9ab2fec12d9d823b8d0`:
kapacita24GiB potvrzená, model workspace NOT_REACHED. Všech296 souborů
zachováno,14 kontrolovaných DB tabulek0, namespace0 a relaye prázdné.
Příčina v3 settings kliknutí je UNKNOWN. Actualv4 potvrdila HIT_BLOCKED:
centrum skutečného Nastavení BUTTON kryje DIV.theia-preload; žádný pointer
nebyl proveden. Packaged startup lifecycle odstraňuje překryv až po layoutu.
Chybělo bounded čekání na skutečnou hit-test připravenost; trvalé zaseknutí
produktu není doložené. Review SHA
`f23ac6c67e3d8dd34207f3e540cced42d83d8501b0030360cd864fecffdb0561`:
všech298 souborů/15,885,565B přesných,14 DB tabulek0, vlastní namespace0,
drain0 a forwarded writes0. Nová v5 tuto readiness kontrolu připravila,
manifest `29d718929ee55a24eeef37d398fa415cd9ed4ded9d5c0f165d44202eebed4356`;
CPU13/13 včetně delayed preload/permanent block/exact deadline negativy,
stejný30s celkový budget, žádné odstranění overlay. Následné GO a actual
jsou doložené níže; původní v3/v4 FAIL zůstávají zachované.

V5 actual18:08:58.800–18:09:31.516UTC zůstává **FAIL**. Nezávislý review
`a6e0773e82e04d51aa66f0568f6105fd057d5ee5d99edc831f0ca9adcfb640cd`
ověřil všech7 pointer kliků a UI/API hodnoty,359 přesných souborů/20,671,650B.
Inner byl PASS bez catcherror; finally jej snížilo kvůli2 stateZ po
app/backend exit0. Parentnamespace po ukončení skutečně0, starší finish
gate však kontroloval live0, nikoli explicitně emptyafter. V6 oddělí
validní ownedZ od živých/UNKNOWN a zpřísní finální parent emptyafter;
rawV5 FAIL zůstává. Host16 GET-only metadata čtení, writes0; startup
innerPOST show odmítnut před hostem. Hunt503 je private nenainstalovaný
režim, nikoli přijetí instalovaného Hunt.

Audit staršího accepted ledger probe našel programové DOM button.click().
Jeho funkční generování, M2, oracle, bajty a restart se zachovávají, ale
pointer použitelnost v okamžiku těchto kliků není doložená. Nelze zpětně
tvrdit, že skutečně probíhaly za preload vrstvou; chybí tehdejší hit-test.

## Milník — jedna skutečná CODE revize, 17:37–17:38 UTC

Zmrazený source `a27e4470` má nezávislý source review SHA
`6d709946d45d1384c55f61b696f0a1fad717e8d8ccf770e16745e86ffd6b2677`
a registered9/9 report `c595d99837e8621c30657ad4b639eb07d6c526740bb0f8cead0f17e3e71c0511`.
Po přirozeném uvolnění cizího GPU běžel jediný kvalifikační pokus
17:37:41.151–17:38:37.501UTC, exit1. Qwen3.8/22130167 dodalo osm
kompletních výstupů se správnými bajty/digesty; šest retained modulů
zůstalo přesných. Schema oprava odstranila původní zakázanou dependency,
nový návrh vyžadoval nové schválení. Stav `ONE_REVISION_EXECUTED` není PASS.

Frozen oracle pak při prvním create zjistil `tx.add` nad undefined:
CLI předpokládá parametr callbacku, store volá `fn()` bez parametru.
Terminál hlásí PROJECT_CHANGE_TEST_FAILED, rollback7/7 a žádný commit.
Úspěšný replay/restart nebyl dosažen. Actor doložil vlastní model unload,
lease release a čisté source; nezávislé actual DB/provenance review
je **FAILURE_EVIDENCE_REVIEW_PASS**, SHA
`fbaba85e69f83a54ec9a43ab23c3ed41c6cc30cd53d7f3a0395f2ff71545558e`.
Všech379 souborů přesných; oba failed návrhy/durable DB/14 after_bytes,
nová approval a oba409 i dva7-path rollbacky nezávisle potvrzeny. Raw result SHA
`0cc384be7344cc3baead1d255f1598ea0a2122b9dbec111b3953ba3ea7668bb8`.
Původní data se neupravují a aplikace se neexportuje jako přijatá.

Callbackf557 source review
`0c5543515a9134bc855be01e7c5a5775bbc890374b5704e1c427dfd7f61aa71c`,
registered9/9 report `8d2af57acc9c43e72648ea46240e19302d19c2f957743c4f24af2f79011a196c`.
Actual18:17:10.863–18:17:51.265UTC skončil4/7 na kontextové bráně:
8811B >8736B, ctx8192/maxOutput3440/reserve384 zachované; žádný pátý
request ani M2 návrh/approval/revision/efekt. Jde o byte odhad, nikoli
změřené tokeny pátého promptu. Raw result
`6bc2a627f4fe3bf66851094177eccee79df002627b35c53fd5d3fc27a42e4e0f`;
nezávislé odmítnutí má **REJECTION_EVIDENCE_REVIEW_PASS**, SHA
`bed896bac5d5549913e54351ae0db277ecd720c55db312eea95a9321ceaee43d`.
Všech 208 souborů /10,845,298 B zůstalo přesných. Čtyři outbound requesty
byly rekonstruovány se shodnými hashi, pátý budget výpočet je doložený;
33 M2 tabulek a obě tabulky zpráv mají nulu, baseline Git nezměněný.
To přijímá důkaz odmítnutí, nikoli aplikaci. Další inference stejného
kandidáta se neopakuje.

## Milník — review GPU V6 a skutečný Linux CPU test V7

V6 actual 18:37:28.962–18:37:59.490 UTC zůstává **FAIL**. Review SHA
`888a00543c69f3b524f2dd2e91efa08e8e9e2bb5272d400282f727ef66a7e12a`
nezávisle ověřil sedm pointer akcí, UI/API hodnoty, nulové sledované DB
tabulky a přísný parent `after=[]`, ACK a relay drain nula. Všech 359
souborů /20,704,316 B zachováno. Jediným důvodem inner FAIL byly tři
`MALFORMED_PROC_STAT` řídicí procesy; jejich původní PGID se neuložila.
Validní tři Z procesy po ukončení aplikace nebyly blokující.

Nová V7 ověřila problém samostatně ve skutečném vlastním Linux namespace:
init a controller mají platné PGID 0, detached child kladné PGID.
Původní scanner vytvoří falešné UNKNOWN, nový filtr zachová sledovanou
kladnou skupinu a odmítne živý proces. Po ukončení child a init je finální
namespace prázdný; vnější vlastní sentinel zůstal nedotčený. Autorské CPU
4/4, cleanup 32/32, DOM fixtures 13/13 a syntax 19/19 PASS. Neznámé
stavy/čtení nadále FAIL, přísný finální cleanup a všechny provider/DOM
guardy zachované. Manifest V7
`8de45d3c69db8c4485c34649fa5665d9fdf2f25b3dddb12ed7cd228e7de1f287`.
Následné source GO a actual jsou doložené níže; CPU samotné se za
přijetí GPU UI, scoringu nebo release nevydává.

## Milník — GPU V7 actual nezávisle přijatý

Jeden běh 18:55:11.326–18:55:41.123 UTC, exit0, má
**QUALIFIED_PHYSICAL_REVIEW_PASS**, review SHA
`707b686ddac2b6e8f0d95e37ed541e8e6799c67927ecb483e114611b4e5951bc`.
Source GO SHA `e52ea593bbe89cf57272f4760b6465729adb5df461d3cabb3acf9b936c31f09a`.
Review ověřil všech sedm pointer hit-test akcí, metadata a převody modelů,
absence známek, role/kandidáty, canonical GPU kapacitu a private Hunt503.
Čtrnáct sledovaných DB tabulek má nulu, quick_check/FK bez chyby.
Všech 359 raw souborů /20,698,831 B zachováno. Vlastní namespace je finálně
prázdný, child/init exit0, nonce ACK a oba relay drain nula, source clean.
Tři průběžné Z procesy jsou zachované v důkazech a odstraněné init teardown.

Raw RESULT SHA `eb489b568e305e5cecd1ca15c76123e0bf38f55526f6883a31812846879a69c2`,
HOST SHA `969f5fd3c1bdaf91468191d9050ed9180481610d8b3e35b4839417027e716a79`.
Host provedl16 GET metadat, inference/forwarded writes0; startup inner
POSTshow odmítnutý předhostem. Přijetí neověřuje instalovaný Hunt,
produkční scoring, inference readiness, CHAT, mobil ani celý release.
Veřejný source-only export má samostatný REVIEW_PASS soukromí/přesných
bajtů, SHA `16193bf96ae2d1a151f5005395633b936273f3d9e65e82a0d338370ac7aca904`.
Všech 21 exportovaných souborů ověřeno, žádný nový runtime při publikaci.

Fresh Hunt audit 18:34 UTC má report SHA
`22f46b6bf7dc3d8e285e9f85c3930e47933ba4c45f0b09fd597f957bd34c608e`;
stejná publikovaná struktura jako 13:31 a 17:21. Všech 115 cizích souborů
zachováno včetně mtime. Cizí hodnotitel existuje; krátké pozorování procesu
nedokazuje, zda čeká, pracuje, je pozastavený nebo zaseknutý. Žádné jeho
spuštění/ukončení, grading request, DB zásah ani aktivace modelu.

Poslední úplný profil staršího `45caf5b5` zůstává397PASS/5FAIL/3BLOCKED.
Cílené opravy a nové malé testy nejsou novým úplným profilem. Static GPU
kapacita se nesmí vydávat za volnou VRAM; velikost modelu není jeho známka.
Private fresh DB bez přijatých známek neověřuje produkční scoring.

## Nejbližší pořadí práce

1. Uzavřít design [CODE peer kontextu](wp/WP-CODE-PEER-CONTEXT-BUDGET-20261001.md)
   source review a actual průchodem je dílčí kontextové řešení dokončené.
   Celý SQLite oracle po schema revizi selhal na dvojitém CLI remove;
   připravená pouze CLI revize vyžaduje rozšíření frozen8→9call scope.
   Větší kontext není zaručen, budget/initialinstrukce/oracle se nemění.
2. [Callback kontrakt](wp/WP-SQLITE-TRANSACTION-CALLBACK-CONTRACT-20261001.md)
   má uzavřený rejection review; funkční aplikace zůstává nepřijatá.
3. Obecný [M2 AST scanner](wp/WP-M2-AST-IMPORT-SCANNER-20261001.md) má
   bounded návrh; TS grammar/ABI a parser resource containment jsou otevřené.
4. Mobilní integrace následuje po stabilním IDE/BE; fyzická matice a
   M5/M6 release brány zůstávají otevřené, CHAT vlastní jiný worker.
5. Omezený závěrečný cleanup tří refs byl přijatý po publikaci/CI.
   BC podmínka není splněná; žádné physical WT removal.
   Remote/UNKNOWN refs, cizí procesy a protected evidence se zachovávají.

## Poslední milník — závěrečný vlastní ref cleanup, 19:14 UTC

Po přijaté publikaci V7 a CI13 SUCCESS se vlastní reused Hunt checkout
vrátil na původní clean `work/hunt-completion-plan-20261001` /`00c71cd4`.
Všech 1164 pravidelných ignored souborů /61,603,715 B i jeden externí
node_modules symlink před/po přesné; původních19 i předchozích579 důkazů
zachovaných. Receipt SHA
`0e4e464812f6075d4913661b033d5d04cef8cdb74e952fe34b4983c4459dd1b4`.
Žádný další worktree nevznikl ani nezmizel.

Nový tří-ref GO SHA
`f6bbeb1e38d26663fd060e79816e1809455fa8237fac93cd57a1ceeff78acd09`.
Jediná actual transakce 19:14:00.313–19:14:01.992 UTC odstranila jen
`work/full405-baseline-oracles-20261001`,
`work/backend-migration-evidence-20261001` a
`work/project-app-provider-guards-20261001` s přesnými expected SHA.
Výsledek **216→213 lokálních branches /71→71 worktrees**. Všechny ostatní
refs a worktree metadata přesné, čtyři local/remote evidence tags stejné,
BC `work/project-app-acceptance-20261001` zachovaný. Raw receipt SHA
`f876833991f053865e660d4b496d34a63cc14d6f9879f8e136758ce8430c4851`;
actual observational review má **REVIEW_PASS**, SHA
`99cf52726ce060ff9f80c458f00d90181d897aa3aa641e8ad3dc983823e66506`.
Reviewer čerstvě ověřil všech368 refs a71 WT records, čtyři local/remote
evidence tags i BC, všech1164 Hunt souborů/symlink, V7 raw/source/export
a původníV5/V6 FAIL důkazy. Žádné remote/tag/DB/process writes
ani fyzické worktree smazání. Obnova tří názvů má atomický absence-only
protokol s pozitivním i kolizním důkazem. Starý čtyř-ref návrh NOT_RUN.

Podrobnosti a historická chronologie:
[completion tracker](review/2026-09-30-COMPLETION-TRACKER.md),
[SQLite WP](wp/WP-PROJECT-SQLITE-CATALOG-FUNCTIONAL-20261001.md),
[M2 revision WP](wp/WP-CODE-FAILED-PROPOSAL-REVISION-20261001.md),
[cleanup WP](wp/WP-COMPLETION-CLEANUP-PREP-20261001.md),
[HTTP návrh](wp/WP-M2-PRIVATE-HTTP-QUALIFICATION-PROPOSAL-20261001.md).


## Navazující CODE milník — CPU rozhodnutí, 20:18 UTC

ROOT převzal omezený connector z `84faa2a5` ve stávajícím WP. CPU experiment
porovnal úplný JSON, tuples, mapu cest, raw frames a projekci rozhraní.
Vybraný obecný `indexed-full/v1` zachoval všechny původní hodnoty a bajty.
Historický pátý vstup se zmenšil z 8 811 na 8 692 B, tedy 44 B pod limitem.
Větší vstupy nadále správně odmítá guard. Projekce nevybrána: neprokazovala
osm signatur metod factory a ztrácela část informace. Cizí GPU proces zůstal
nedotčený; výsledek v tomto checkpointu ještě nebyl implementační PASS.

## CODE implementace — CPU checkpoint, 20:29 UTC

Studio → M2 service → produktový formatter používá výslovný verzovaný JSON.
Úplné zdroje, stavy, digesty a autorské instrukce zůstaly; původní režim malých
změn má stejné bajty. Lokálně prošlo 100 kontrol služby a 22 kontrol app oracle.
Nové regrese zahrnují grafy 1/2/7/32 souborů, read-only kontext, retained repair,
UTF-8, escaping, null, chybějící/duplicitní/cizí/zastaralý peer a limit + 1 B.
Controlled fixtures pouze dekódují nový vstup; nemění funkční očekávání.

## Poslední CODE milník — živý FAIL a konkrétní eskalace, 20:46 UTC

Produktový `11f74be8` má **SOURCE_REVIEW_PASS**. Testovaný `86002334` přidává
jen opravený dokumentační census a má ověřený remote SHA i všech 13 kroků CI
SUCCESS: run `36922420547`, job `110571450326`. Šest registrovaných kontrol
prošlo; původní artifact-validation FAIL kvůli LOC zůstal zachován a nový census
recheck prošel. HTTP test po opravě Node 24 PATH prošel 75 assertions ve
vlastním network namespace; předchozí ABI 127 environment FAIL je zachován.

Skutečný běh 20:37–20:38 UTC dodal sedm modulů a jednu povolenou modelovou
opravu schématu. Všech osm request SHA, model/digest/provider, úplné bajty
preview a plánu i šest retained modulů souhlasí. Pátý vstup měl 7 662/8 736 B.
Nové výstupy jsou menší: i původní JSON by s nimi vyhověl na 7 781 B. Izolovaný
důkaz úspory formatteru proto zůstává historický CPU replay 8 811 → 8 692 B.

**Aplikace zůstává FAIL.** Po odstranění zakázaného schema importu původní
funkční oracle odhalil dvojité volání `remove` v generovaném CLI. První vrátí
`true`, druhé už řádek nenajde. Oba neúspěšné plány provedly rollback všech
sedmi cest; Git HEAD zůstal stejný a commit nevznikl. Úspěšný restart/replay
ani konečná persistence přejímka nebyly dosaženy. Vlastní model byl uvolněn,
GPU lease odstraněna, relay má nulu aktivních requestů a zdroj zůstal čistý.
Provider audit i nezávislé celkové review potvrzují důkazy selhání:
**REJECTION_EVIDENCE_REVIEW_PASS / APPLICATION_FAIL_NOT_QUALIFIED**.
Nepřijatá aplikace se nepublikuje jako přijatý ukázkový projekt.

CPU diagnostika ve třech samostatných sandboxech: původní modelový výstup
FAIL, hypotetická oprava jediného CLI výrazu PASS celého stejného oraclu,
mutant vynechávající mazání FAIL. Historické modelové bajty se nezměnily.
Tato hypotetická oprava není skutečná CODE generace ani přijetí aplikace.

**Připravený další krok:** pouze modelová revize `src/cli.js`, navázaná přes
poslední failed lifecycle/digest; ostatních šest modulů se zachová, včetně
opraveného schématu. Úplný opravný vstup má 5 700/11 520 B. Následuje nový
preview/digest, přesné M2 schválení, nezměněný oracle, commit a restart/replay.
Stávající WP dovoluje pouze jednu schema opravu a osm generací. Devátá CLI
generace vyžaduje výslovné rozšíření tohoto zmrazeného rozsahu. Operátor dostal
konkrétní volbu: doporučená jedna CLI revize, nebo zachování osmigeneračního
limitu a jiná předem zmrazená strategie. Žádná další inference před odpovědí.

[Podrobný stávající WP](wp/WP-CODE-PEER-CONTEXT-BUDGET-20261001.md).

## Uzavření review a publikace eskalace — 21:03 UTC

Nezávislé review `79e225b6cb2cd28323942c09bb8e653cbc1c6211210b6c7025695a75be02c27b`
ověřilo všech osm requestů, úplné bajty preview a 14 durable materiálů,
dva failed terminály, 14 úspěšných rollbacků a nepřítomnost všech sedmi
generovaných cílů. Žádný aplikační Git commit nevznikl. Restart backendu
před prvním schválením proběhl; závěrečný restart úspěšné aplikace a persistence
přejímka nebyly dosaženy. Všech 379 raw souborů /19 849 724 B zůstalo přesných
včetně módů a Git indexu. Read holds jsou uvolněné.

Review přijalo také konkrétní CLI blueprint a jeho vstup 5 700/11 520 B;
CPU oprava není kvalifikovaná aplikace. Potvrdilo hranici dosavadních osmi
generací a potřebu konkrétního rozhodnutí pro devátou. **Není vydán souhlas
k dalšímu živému běhu.** Eskalace je doložená a zreviewovaná; aplikace zůstává
FAIL, nikoli dokončená.

Checkpoint `4759fe339b8c21faf1a5822fd70a6b903eac12b2` je pushnutý s přesně
ověřeným remote SHA a [CI SUCCESS, 13 kroků](https://github.com/Belphareon-bak/intentsmith/actions/runs/36925015539).
Toto doplnění review mění pouze čtyři existující dokumenty; testovaný produkt
zůstává `11f74be8` a živý kandidát `86002334`. Novější report nepřebírá
funkční přejímku, která neprošla. Doporučený další krok je jedna skutečná
CLI CODE revize se šesti zachovanými moduly, novým přesným M2 schválením,
stejným oraclem, následným commitem a ověřením po restartu.

## Autorizované pokračování — 21:32 UTC

Operátor výslovně povolil autonomně dokončit IntentSmith podle dokumentace
a priorit; pouze ladění CHATu vlastní druhý worker. Připravená devátá CLI
generace je tím autorizovaná. Historický FAIL a všechny raw bajty zůstávají.
Pokračování použije oddělenou kopii failed runtime, stejný oracle a model,
šest retained modulů, nový digest a nové přesné M2 schválení. Původních sedm
modulů se znovu negeneruje. Ownership, kontrola kopie a předběžné brány jsou
v [existujícím WP §8](wp/WP-CODE-PEER-CONTEXT-BUDGET-20261001.md#8-autorizované-pokračování--1-10-2026-2132-utc).

Baseline `35d50ed17c47a4649d514a4bb4ce593edbd5d902` je čistý, remote přesný,
[CI 13/13 SUCCESS](https://github.com/Belphareon-bak/intentsmith/actions/runs/36926343858).
Implementace pokračování začíná; aplikace stále není přijatá. Po SQLite budou
navazovat nejbližší dokumentované release priority; souběžně probíhá pouze
read-only audit jejich pořadí. Hotový core se nebude zaměňovat za mobilní M7,
který přichází po stabilním IDE/backendu.
