# IntentSmith — průběžný report dokončování

**Aktualizováno:** 1. 10. 2026, 18:53 UTC / 20:53 CEST.
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
Probíhá ověření skutečného zobrazení GPU/modelových hodnot v IDE.
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
| GPU/modely v packaged IDE | V5 i V6: nezávisle ověřených 7 pointer kliků, 14 modelů /84 eval /7 rolí /76 kandidátů, 98 null scores, 24 GiB a očekávaný Hunt 503; žádná inference ani forwarded writes | Celé V5/V6 zůstávají FAIL. V6 splnila přísný finální prázdný namespace, ale parser odmítl řídicí procesy. V7: skutečný Linux CPU 4/4, cleanup 32/32, DOM fixtures 13/13 a syntax 19/19; nezávislé GO a actual čekají |
| Hunt hodnocení | Strukturální čtení 18:34 UTC nezměněné: 596/1173 odpovědí, 2324/3689 kritérií; stejný report jako 13:31 a 17:21 | Přijatý grader chybí, zbývá 577 odpovědí /1365 kritérií; NO_DECISION /NO_GO. Proč se publikované výsledky neposunuly, je UNKNOWN |
| HTTP projekty | Předem připravený omezený návrh testu | Rozhodnutí o novém M2 síťovém oprávnění; HTTP_NOT_RUN |
| Mobil | Auditovaný handoff, historických47 host testů a přijaté VPN/TLS rozhodnutí | Fyzická matice13+7 NOT_RUN, skutečné zařízení/VPN a integrační mezery |
| Cleanup | Nezávisle připravené čtyři vlastní nepřipojené lokální refs, exact remote evidence tags a restore transakce | Poslední fresh preflight a atomic CAS; žádné mazání dosud neprovedeno, worktree removal HOLD |

## Publikované a uchované materiály

- [Generované aplikace](../examples/generated-apps/README.md):17 skutečných
  modelových modulů tří přijatých snapshotů; [archivní IDE probe](../materials/ide2-code-dom-physical-response-guard-20261001/README.md)
  obsahuje15 přijatých zdrojových souborů bez privátních runtime dat.
- Zmrazený skutečně testovaný zdroj je
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

## Poslední milník — jedna skutečná CODE revize, 17:37–17:38 UTC

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

## Poslední milník — review GPU V6 a skutečný Linux CPU test V7

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
Nezávislé source GO a nový actual jsou **PENDING /NOT_RUN**; CPU test
není přijetí GPU UI, scoringu nebo release.

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

1. Uzavřít nezávislé GO V7, jeden GPU UI actual a jeho review; poté
   zveřejnit přijaté zdroje sondy bez privátních runtime dat.
2. Vymezit obecné řešení objemu CODE kontextu; žádné opakování, ruční
   změny actual výstupů či zvýšení budgetu tohoto frozen WP.
3. [Callback kontrakt](wp/WP-SQLITE-TRANSACTION-CALLBACK-CONTRACT-20261001.md)
   má uzavřený rejection review; funkční aplikace zůstává nepřijatá.
4. Obecný [M2 AST scanner](wp/WP-M2-AST-IMPORT-SCANNER-20261001.md) má
   bounded návrh; TS grammar/ABI a parser resource containment jsou otevřené.
5. Nakonec provést schválený omezený cleanup vlastních refs s restore důkazem.
   Remote/UNKNOWN refs, cizí procesy a protected evidence se nemažou.

Podrobnosti a historická chronologie:
[completion tracker](review/2026-09-30-COMPLETION-TRACKER.md),
[SQLite WP](wp/WP-PROJECT-SQLITE-CATALOG-FUNCTIONAL-20261001.md),
[M2 revision WP](wp/WP-CODE-FAILED-PROPOSAL-REVISION-20261001.md),
[cleanup WP](wp/WP-COMPLETION-CLEANUP-PREP-20261001.md),
[HTTP návrh](wp/WP-M2-PRIVATE-HTTP-QUALIFICATION-PROPOSAL-20261001.md).
