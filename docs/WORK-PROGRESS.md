# IntentSmith — aktuální postup dokončení

**Aktualizováno:** 2. 10. 2026, 15:27 UTC /17:27 CEST.
**Vlastník:** ROOT. CHAT ladí jiný worker.
Report aktualizuji po milníku, nejpozději po 3 h aktivní práce; operátorovi
podávám samostatný report po 2 h. **Release: NOT_ACCEPTED.**

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

## SQLite: přesný rozsah

Zdroj `f5964604cb76cad916fdc1ef894bfc6519c7e0d5`, commit aplikace `a5e789cb`.
Acceptance SHA `41d18e640cfbeaa9aaad38813ba822335f472438c5b96e72a0de823f9fb7302f`.
[Přesný export: sedm modulů /8 965 B, source-copy/privacy review](../examples/generated-apps/sqlite-catalog/README.md).
Publikovaný `cd3bece6` má [CI SUCCESS](https://github.com/Belphareon-bak/intentsmith/actions/runs/36987144761).
Devátá generace byla autorizovaná; dva failed plány, 14 rollbacků a původní
výstupy zachované. Aplikační DB mezi procesy v jednom sandboxu, nikoli mezi
různými sandboxy; backend restart/replay ověřuje M2 DB, commit a zdroje.

## Aktuální priority

1. **Společná integrace:** publikovaný `d7e7d1b1` slučuje `2a479852` + `6f0259ec`.
   Tři konflikty vyřešené, registry 594/35; novější CHAT `00ec5b52`
   je začleněný v `f2e6ac1a`. Celý offline/database profil na `2997afd5`: **408 PASS /0 FAIL /0 BLOCKED**, verdict PASS,
   14:24:36–14:34:45 UTC; report SHA `b69dcc223e231412…775e5138b`.
   Meta/LOC opravené, původní FAIL zachované. DPH eligibility: nezměněný routing 100 %, runtime 57/57, session 67/67 PASS;
   skutečný řízený M1 HTTP/WS 4/4 PASS (info vrací expertise gap).
   [Aktuální `592cb54c` CI SUCCESS](https://github.com/Belphareon-bak/intentsmith/actions/runs/37022906386):
   stažený artefakt potvrzuje **CHAT 7/7 + CODE 6/6**, všech 18 kroků SUCCESS.
   Celý profil je na `2997afd5`; potom se změnil jen kvalifikační helper a docs.
   Studio/privacy/hygiene/build PASS; vývojové kontroly nepřijímají release.
   CHAT NO_GO: 53×3 nesplnilo kvalitu; finální přejímku vlastní jeho worker.
2. **Omezený M2 scanner:** V2 adoptovaný do skutečné default M2 služby,
   evaluator 34/34 a service 103/103 PASS: přesné approval/commit/restart,
   assertion rollback tří souborů a cancel před registrací. Dvě nezávislá
   source review PASS; AST baseline nad `4a8fb4b2`, registry 11/11 PASS.
   [Rozsah a historické fixture FAILy](wp/WP-M2-AST-IMPORT-SCANNER-20261001.md).
3. **Kontext a větší projekt:** CPU rozhodnutí je úplný zdroj při 16k
   a skutečné projektové přírůstky. Ze 198 velikostních případů se při 8k
   vejde 27, při 16k 97; nejde o míru modelové úspěšnosti. Krátký skutečný
   16k load 09:51 UTC: full GPU, CPU spill 0, minfree 3 759 MiB. Plné okno
   nikoli míra úspěšnosti. Aplikace ještě nepřijatá; capture převzatý, source review
   PASS, gateway 44/44, context 18/18, service 104/104 PASS. Dosavadní 119 B /1,4 % je omezená
   úspora, nikoli řešení škálování; SQLite fit i bez formatteru 7 781 B.
   `8192` je pro Qwen3.8 fallback, ne změřené maximum; build má navíc 32 000 B
   serializační mez. Úplné zdroje dál určují náhled, digest a zápis.
   [CPU podrobnosti a odmítnutá projekce](wp/WP-CODE-PEER-CONTEXT-BUDGET-20261001.md#11-větší-projekty--nová-priorita-2-10-2026).
   **Odlišná aplikace fan-monitor:** offline core/CLI, dva přírůstky.
   [Veřejný runner/oracle](../scripts/manual/run-fan-monitor-journey.mjs), source review
   PASS; původní D1 vstup BLOCKED, fyzický D1 běh NOT_RUN.
   **D1 blokér:** ProjectHandler směruje původní požadavky do CHAT;
   jediný explicitní design prefix neopraví druhý vstup (`text` v `contextFiles`).
   CODE používá dokumentovaný Studio `/m2-build <JSON>`, explicitní zadání,
   stejný oracle, max11 CODE /0 D1 a nový freeze.
   Dva helpery `734231e4`, source/input review PASS, CPU8/8; vstupy nad starým byte guardem.
   První běh `2997afd5` skončil na kvalifikačním DOM výběru, **0 inferencí**;
   čistý stop/source/lease. Oprava jediného helperu má skutečný renderer CPU6 PASS
   a source review PASS. Druhý actual běh `592cb54c`, 14:57:56–14:59:28 UTC:
   **4 skutečné CODE generace**, exact provider identity, governance/source-policy PASS.
   Vstupy 2 167 /2 280 /6 733 /22 258 B; poslední prompt 6 518 tokenů.
   Náhled bez zápisu → wrong-digest409 → restart zachoval awaiting_approval.
   Potom helper odmítl legitimní `_m2Pending`: FAN_CONVERSATION_BUSY.
   **Approval, funkční test, commit a aplikační persistence NOT_RUN.**
   Vlastněné procesy/lease čistě ukončené, tracked source nezměněný.
   Další krok: exact pending resume v kopii runtime na stejné namespace cestě,
   Helper oprava adoptovaná: typed status/binding, úplná runtime kopie na stejné
   namespace cestě a consumed core-initial; CPU7 PASS, public import/syntax PASS.
   Dva nové module pins jsou povinné; positive +2 negative freeze checks PASS.
   Source review PASS; nový freeze/CI/live čekají, původní4 v max11, zbývá7.
   Oracle, 0 D1 /max11 CODE a limity oprav 172/163 UTF-8 B zůstávají stejné.
   Přirozené plánování zůstává CHAT workerovi.
4. **Hunt:** aktuální kontrola 2. 10. 09:21 UTC potvrzuje 596/1173. Původní
   grader skončil na týdenním limitu; [přesný event/vlastník](wp/WP-HUNT-COMPLETION-PATH-20261001.md).
   Slepé Sonnet dávky: 16/16 odpovědí, 64/64 kritérií DEVELOPMENT_DRAFT.
   Grader, rozhodnutí a aktivace stále nepřijaté.
   Třetí dávka porušila přesnou množinu ID jedním vymyšleným prázdným řádkem.
   Controller STOPPED; nic filtrováno/přijato, cost1,598950 USD /limit12 včetně FAIL.
   Vlastník ROOT; structured-output CPU návrh/source review PASS, NOT_ADOPTED/NOT_RUN.
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
