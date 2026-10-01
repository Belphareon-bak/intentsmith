# IntentSmith — průběžný report dokončování

**Aktualizováno:** 1. 10. 2026, 17:43 UTC / 19:43 CEST.
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
| Packaged IDE/CODE ledger | PHYSICAL_PASS / REVIEW_PASS; šest kompletních generací, DOM náhled, approval, commit a durable DB | Širší projekty a celý release |
| Worker | Skutečný pětiminutový test, první změna po intervalu, jedna notifikace, restart a čistý stop | Dlouhý soak a souběh mnoha workerů |
| M3 specialista | Skutečný ProjectContext ze dvou projektů, provenance, stale/foreign odmítnutí, deterministické testy PASS | Živá expert-vs-general kvalita |
| SQLite oracle | Source `34cfc198`: 62/62 autorských CPU, 21/21 nezávislých CPU, registered9/9 a CI SUCCESS / source REVIEW_PASS | Přijatá skutečná aplikace |
| SQLite Qwen3.8 | Sedm úplných generací, ale zakázaná schema dependency; APPLICATION_FAIL, rollback7/7, žádný commit; rejection review PASS | Modelová oprava přes existující nový M2 plán |
| SQLite Qwen3.6 | Čtyři úplné generace; pátý prompt 9468B >8736B, odmítnut před voláním; 0 M2 operací/efektů/zpráv; review důkazů PASS | Jednotlivý scénář není kvalifikovaný; kontextové limity zachované |
| M2 failed-plan revize | Source `a27e4470`:66/66 autorských CPU, nezávislé source REVIEW_PASS, registered9/9 a push CI13/13 SUCCESS. Skutečný běh vykonal jednu revizi,8/8 úplných pinned generací a zachoval šest modulů | APPLICATION_PHYSICAL_FAIL po opravě schema: nesoulad transaction callback rozhraní; actual review zatím PENDING |
| GPU/modely v packaged IDE | V3 actualFAIL má nezávisle přijatou evidenci: kapacita24GiB potvrzená, model workspace nedosažený;0 inference/forwarded writes. V4 připravená, CPU10/10 a syntax15/15 | V4 nezávislé GO review a fyzický běh čekají; příčina v3 kliknutí UNKNOWN; celý Hunt tím není testován |
| Hunt hodnocení | Nové strukturální čtení17:21UTC nezměněné:596/1173 odpovědí,2324/3689 kritérií | Accepted grader false,577/1365 chybí, NO_DECISION / NO_GO; žádná aktivace |
| HTTP projekty | Předem připravený omezený návrh testu | Rozhodnutí o novém M2 síťovém oprávnění; HTTP_NOT_RUN |
| Mobil | Auditovaný handoff, historických47 host testů a přijaté VPN/TLS rozhodnutí | Fyzická matice13+7 NOT_RUN, skutečné zařízení/VPN a integrační mezery |
| Cleanup | Nezávisle připravené čtyři vlastní nepřipojené lokální refs, exact remote evidence tags a restore transakce | Poslední fresh preflight a atomic CAS; žádné mazání dosud neprovedeno, worktree removal HOLD |

## Publikované a uchované materiály

- [Generované aplikace](../examples/generated-apps/README.md):17 skutečných
  modelových modulů tří přijatých snapshotů; [archivní IDE probe](../materials/ide2-code-dom-physical-response-guard-20261001/README.md)
  obsahuje15 přijatých zdrojových souborů bez privátních runtime dat.
- Poslední potvrzený vzdálený kód je
  [`a27e44701c2160e24ef4b3a37528f6a2f6e745a4`](https://github.com/Belphareon-bak/intentsmith/commit/a27e44701c2160e24ef4b3a37528f6a2f6e745a4).
  Obsahuje opravený AST guard a průběžný report. Má vlastní
  [push CI SUCCESS](https://github.com/Belphareon-bak/intentsmith/actions/runs/36898069050),
  job110489992532,13 úspěšných kroků. Source review přijímá kvalifikaci,
  nikoli neúspěšnou aplikaci. Původní `f17aaa27` CR se zachovává.
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
Příčina neúčinného settings kliknutí je zatím UNKNOWN; připravuje se úzká
instrumentovaná v4 sonda se skutečným klikacím cílem a postclick důkazem.

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
je **REVIEW_PENDING**. Raw result SHA
`0cc384be7344cc3baead1d255f1598ea0a2122b9dbec111b3953ba3ea7668bb8`.
Původní data se neupravují a aplikace se neexportuje jako přijatá.

Poslední úplný profil staršího `45caf5b5` zůstává397PASS/5FAIL/3BLOCKED.
Cílené opravy a nové malé testy nejsou novým úplným profilem. Static GPU
kapacita se nesmí vydávat za volnou VRAM; velikost modelu není jeho známka.
Private fresh DB bez přijatých známek neověřuje produkční scoring.

## Nejbližší pořadí práce

1. Uzavřít nezávislé review neúspěšného actual CODE revision průchodu.
2. Před dalším kandidátem sjednotit callback kontrakt mezi CLI/service/store;
   nový WP-first freeze a samostatná kvalifikace, bez ruční změny výstupů.
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
