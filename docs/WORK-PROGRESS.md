# IntentSmith — průběžný report dokončování

**Aktualizováno:** 1. 10. 2026, 18:22 UTC / 20:22 CEST.
**Vlastník:** ROOT. CHAT řeší jiný worker, od posledního zadání jej ROOT neupravuje.
**Publikace:** `work/real-chat-journeys-20260930`; průběžný report se aktualizuje
po každém milníku, nejpozději po třech hodinách během aktivní práce. Operátor
dostává samostatný report práce každé dvě hodiny. Každý checkpoint uvádí
přesný testovaný zdroj; novější dokumentační commit nepřebírá jeho testy.

## Stav nyní

IDE/backend mají přijaté dílčí funkční důkazy, celý release není přijatý.
Tři malé skutečné CODE projekty fungují v doloženém rozsahu; SQLite modelové
kvalifikace zatím neprošly celým kontraktem. Probíhá kvalifikace existující
M2 opravy failed návrhu a skutečné zobrazení GPU/modelových hodnot v IDE.
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
| SQLite callback kontrakt | Sourcef557:5/5 cílených CPU, SOURCE_REVIEW_PASS, registered9/9 a CI13/13. Actual4 generace, pátý prompt8811B >8736B odmítnut před voláním | APPLICATION_FAIL; actual reviewPENDING, callback nedošel do běžící aplikace. Řešit objem kontextu, neopakovat kandidát; první512B overflow44PASS/22FAIL zachovaný |
| GPU/modely v packaged IDE | V5 nezávisle ověřila7 skutečných pointer kliků,14 modelů/84 eval/7 rolí/76 kandidátů,98 null scores,24GiB a očekávanýHunt503;0 inference/zápisů | RawwholeV5 FAIL kvůli2Z předinitteardown; parentafter0 pozorováno, starý gate jenlive0. V6 upřesní Z a zpřísní parentafter0; installedHunt/quality/release netestované |
| Hunt hodnocení | Nové strukturální čtení17:21UTC nezměněné:596/1173 odpovědí,2324/3689 kritérií | Accepted grader false,577/1365 chybí, NO_DECISION / NO_GO; žádná aktivace |
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
stejný30s celkový budget, žádné odstranění overlay. Nezávislé GO a actual čekají.

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
actual reviewPENDING. Další inference stejného kandidáta se neopakuje.

Poslední úplný profil staršího `45caf5b5` zůstává397PASS/5FAIL/3BLOCKED.
Cílené opravy a nové malé testy nejsou novým úplným profilem. Static GPU
kapacita se nesmí vydávat za volnou VRAM; velikost modelu není jeho známka.
Private fresh DB bez přijatých známek neověřuje produkční scoring.

## Nejbližší pořadí práce

1. Uzavřít actual budget/provenance review
   [callback kontraktu](wp/WP-SQLITE-TRANSACTION-CALLBACK-CONTRACT-20261001.md).
2. Vymezit obecné řešení objemu CODE kontextu; žádné opakování, ruční
   změny actual výstupů či zvýšení budgetu tohoto frozen WP.
3. Uzavřít skutečný GPU panel audit a zveřejnit přijaté archivní zdroje sondy.
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
