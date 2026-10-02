# IntentSmith — aktuální postup dokončení

**Aktualizováno:** 2. 10. 2026, 14:23 UTC / 16:23 CEST.
**Vlastník:** ROOT. CHAT ladí jiný worker.
Report aktualizuji po milníku, nejpozději po 3 h aktivní práce; operátorovi
podávám samostatný report po 2 h. Hotový produkt zatím není přijatý.

## Přijaté výsledky

| Oblast | Doloženo | Omezení |
| --- | --- | --- |
| Ledger / TaskFlow | Skutečný model → M2 → oracle → commit → restart, nezávislé přijetí | Malé aplikace; obecná spolehlivost plánování neprokázaná |
| Packaged IDE Ledger | Šest úplných generací, přesné approval, funkční test, commit a durable DB | DOM button.click(), nikoli fyzická dostupnost tlačítek |
| SQLite | APPLICATION_ACCEPTANCE_REVIEW_PASS na `f5964604`; sedm modulů, devátá CLI generace, šest zachovaných modulů, přesné approval, oracle, commit a backend restart | n=1; jeden přijatý scénář, nikoli benchmark spolehlivosti CODE |
| Worker | Skutečný 5min test, interval, jedna notifikace, restart, čistý stop | Dlouhý soak a mnoha-worker souběh otevřené |
| M3 | Dva skutečné ProjectContext, provenance a stale/foreign odmítnutí | Expert-vs-general kvalita otevřená |
| GPU readonly UI | Přijatý V7: hodnoty, 24 GiB, sedm pointer akcí | Nepřejímá grader ani modelovou kvalitu; neopakuje se |
| Cleanup | Přijaté odstranění tří vlastních refs, 216 → 213 větví | 71 worktrees zachováno; cizí/UNKNOWN/evidence se nemažou |

## SQLite: důkazy a přesný rozsah

- Skutečný zdroj: `f5964604cb76cad916fdc1ef894bfc6519c7e0d5`.
- Běh 2. 10. 08:18:22–08:18:41 UTC; jedna nová generace, devět celkem,
  rozšíření 8 → 9 předem autorizované operátorem.
- Git aplikace: `a5e789cbda24e009c0eeefeda16c202877d1b88f`.
- Nezávislá přejímka SHA:
  `41d18e640cfbeaa9aaad38813ba822335f472438c5b96e72a0de823f9fb7302f`.
- Původní výstupy, dva failed plány, 14 rollbacků a 21 materiálů zachované.
  Aplikační DB ověřená mezi procesy v jednom sandboxu; další sandbox má novou DB.
  Backend restart/replay ověřuje M2 DB, commit a zdroje; HTTP bodies zvlášť neuchované.
- [Sedm přesných modulů /8 965 B a source-copy/privacy review](../examples/generated-apps/sqlite-catalog/README.md).
- Publikováno v [`cd3bece6`](https://github.com/Belphareon-bak/intentsmith/commit/cd3bece693264bf78b0744a5eead9aa9859c715b), remote SHA přesné;
  [CI 13/13 SUCCESS](https://github.com/Belphareon-bak/intentsmith/actions/runs/36987144761).

## Aktuální priority

1. **Společná integrace:** publikovaný `d7e7d1b1` slučuje `2a479852` + `6f0259ec`.
   Tři konflikty vyřešené, registry 594/35; novější CHAT `00ec5b52`
   je začleněný v `f2e6ac1a`. Poslední úplný offline/database profil
   na publikovaném `26f087e4`: **407 PASS /1 FAIL /0 BLOCKED**, verdict FAIL.
   Meta test je opravený a PASS. Jediný nový FAIL je formát LOC tabulky:
   ROOT omylem odstranil čárku; správný počet 268380 se nemění.
   Formát opravený, dotčená sada **160/160 PASS**; oba FAIL reporty zůstávají.
   DPH eligibility: nezměněný routing 100 %, runtime 57/57, session 67/67 PASS;
   skutečný řízený M1 HTTP/WS 4/4 PASS (info vrací expertise gap).
   [CI na přesném `26f087e4` SUCCESS](https://github.com/Belphareon-bak/intentsmith/actions/runs/37018106744):
   stažený artefakt potvrzuje **CHAT 7/7 + CODE 6/6**, všech 18 kroků SUCCESS.
   Studio/privacy/hygiene a lokální build PASS; vývojový výběr kontrol
   nenahrazuje celý profil ani přijetí releasu.
   CHAT zůstává NO_GO: série 53×3 nesplnily kvalitativní cíle; archivní
   delta je opravená, finální kvalitu dál přejímá jeho worker.
2. **Omezený M2 scanner:** V2 adoptovaný do skutečné default M2 služby,
   evaluator 34/34 a service 103/103 PASS: přesné approval/commit/restart,
   assertion rollback tří souborů a cancel před registrací. Dvě nezávislá
   source review PASS; AST baseline nad `4a8fb4b2`, registry 11/11 PASS.
   [Rozsah a historické fixture FAILy](wp/WP-M2-AST-IMPORT-SCANNER-20261001.md).
3. **Kontext a větší projekt:** CPU rozhodnutí je úplný zdroj při 16k
   a skutečné projektové přírůstky. Ze 198 velikostních případů se při 8k
   vejde 27, při 16k 97; nejde o míru modelové úspěšnosti. Krátký skutečný
   16k load 09:51 UTC: full GPU, CPU spill 0, minfree 3 759 MiB. Plné okno
   a skutečná aplikace NOT_RUN; produktový capture převzatý, source review
   PASS, gateway 44/44, context 18/18, service 104/104 PASS. Dosavadní 119 B /1,4 % je omezená
   úspora, nikoli řešení škálování. Nový živý fit měl i bez formatteru 7 781 B.
   `8192` je pro Qwen3.8 fallback, ne změřené maximum; build má navíc 32 000 B
   serializační mez. Úplné zdroje dál určují náhled, digest a zápis.
   [CPU podrobnosti a odmítnutá projekce](wp/WP-CODE-PEER-CONTEXT-BUDGET-20261001.md#11-větší-projekty--nová-priorita-2-10-2026).
   **Další odlišná aplikace:** fan-monitor z existujícího projektového WP,
   offline core/CLI, dva přírůstky. Původní D1 qualification V4
   source review PASS; [veřejný runner](../scripts/manual/run-fan-monitor-journey.mjs)
   a oracle v `4fb800c5`, focused 3/3 a CI SUCCESS; živý běh NOT_RUN.
   **D1 blokér:** ProjectHandler směruje původní požadavky do CHAT;
   jediný explicitní design prefix neopraví druhý vstup (`text` v `contextFiles`).
   Další CODE strategie používá dokumentovaný `/m2-build <JSON>` ve Studiu,
   explicitní operátorské zadání, stejný oracle, max11 CODE /0 D1 a nový freeze.
   Dva helpery publikované v `734231e4`, source/input review PASS, CPU8/8;
   plné vstupy
   14–17 kB /10–12 kB přesahují starý8736 B guard. Modelová aplikace NOT_RUN.
   Oracle, 0 D1 /max11 CODE a limity oprav 172/163 UTF-8 B jsou zmrazené.
   Tento průchod nepřijímá přirozené plánování; to zůstává CHAT workerovi.
4. **Hunt:** aktuální kontrola 2. 10. 09:21 UTC potvrzuje 596/1173. Původní
   hodnoticí relace skončila na týdenním limitu poskytovatele; přesný event
   je připnutý v [Hunt WP](wp/WP-HUNT-COMPLETION-PATH-20261001.md).
   Nové skutečné slepé Sonnet dávky daly 16/16 odpovědí a 64/64 kritérií;
   samostatný DEVELOPMENT DRAFT, canonical počet se nepřepisuje.
   Grader, rozhodnutí a aktivace stále nepřijaté.
   Třetí dávka porušila přesnou množinu ID jedním vymyšleným prázdným řádkem.
   Controller STOPPED, nic nefiltrováno ani přijato; skutečný list-cost
   1,598950 USD včetně FAIL, limit 12 USD. Další volání zastavená, žádné retry.
5. **Společná přejímka IDE/BE:** aktuální celý profil, fyzické pointer UI,
   funkční větší projekty, upgrade/restore a přijetí vlastněných delt.
6. **M5/M6:** osm nepodepsaných podkladů připraveno, 13 signed receipts
   chybí. Finální kandidát potřebuje vlastní 24h soak a throughput;
   historické jiné SHA nestačí. Offline kopie klíčů a skutečné podpisy otevřené.
7. **Mobil, potom HTTP:** až po stabilním IDE/BE. Mobilní fyzická matice
   13+7 NOT_RUN; aktuální mobilní CPU 47/47 PASS. Chybí skutečné založení
   konverzace v BE pro první send, device/VPN/origin/signer přejímka.
   HTTP má samostatný dosud nepřijatý M2 profil.
8. **Závěrečný cleanup:** až po integraci, s ověřeným vlastnictvím a obnovou.

## Publikace a historie

Veřejně je [24 přesných modulů čtyř snapshotů](../examples/generated-apps/README.md).
Raw DB, prompty, provider obaly a provozní data jsou privátní a hashovaná.
Produkční nasazení ani aktivace modelů tímto proudem neproběhly.
Aktuální detail: [CODE WP](wp/WP-CODE-PEER-CONTEXT-BUDGET-20261001.md),
[projektový WP](wp/WP-PROJECT-FLOW-20260918.md), [Hunt WP](wp/WP-HUNT-COMPLETION-PATH-20261001.md).

[Archiv původního reportu v neměnném Git commitu](https://github.com/Belphareon-bak/intentsmith/blob/cd3bece693264bf78b0744a5eead9aa9859c715b/docs/WORK-PROGRESS.md)
a [archiv celého historického trackeru](https://github.com/Belphareon-bak/intentsmith/blob/cd3bece693264bf78b0744a5eead9aa9859c715b/docs/review/2026-09-30-COMPLETION-TRACKER.md)
uchovávají všechny původní výsledky včetně FAIL a tehdejších blokérů.
Historické čekání na devátou generaci už není aktuální pracovní úkol.
