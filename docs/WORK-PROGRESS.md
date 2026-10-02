# IntentSmith — aktuální postup dokončení

**Aktualizováno:** 2. 10. 2026, 16:14 UTC /18:14 CEST.
**Vlastník:** ROOT. CHAT ladí jiný worker.
Report aktualizuji po milníku, nejpozději po 3 h aktivní práce; operátorovi
podávám samostatný report po 2 h. **Release: NOT_ACCEPTED.**

## Přijaté výsledky

| Oblast | Doloženo | Omezení |
| --- | --- | --- |
| Ledger / TaskFlow | Skutečný model → M2 → oracle → commit → restart, nezávislé přijetí | Malé aplikace; obecná spolehlivost plánování neprokázaná |
| Packaged IDE Ledger | Šest úplných generací, přesné approval, funkční test, commit a durable DB | DOM button.click(), nikoli fyzická dostupnost tlačítek |
| SQLite | APPLICATION_ACCEPTANCE_REVIEW_PASS na `f5964604`; sedm modulů, devátá CLI generace, šest zachovaných modulů, přesné approval, oracle, commit a backend restart | n=1; jeden přijatý scénář, nikoli benchmark spolehlivosti CODE |
| Worker | Skutečný 5min test, interval, jedna notifikace, restart, čistý stop | Dlouhý soak a souběh více workerů otevřené |
| M3 | Dva skutečné ProjectContext, provenance a stale/foreign odmítnutí | Expert-vs-general kvalita otevřená |
| GPU readonly UI | Přijatý V7: hodnoty, 24 GiB, sedm pointer akcí | Nepřejímá grader ani modelovou kvalitu; neopakuje se |
| Cleanup | Přijaté odstranění tří vlastních refs, 216 → 213 větví | Při přejímce 71 worktrees zachováno; aktuálně 72, cizí/UNKNOWN/evidence se nemažou |

## SQLite: přesný rozsah

Zdroj `f5964604cb76cad916fdc1ef894bfc6519c7e0d5`, commit aplikace `a5e789cb`.
[Přesný export: sedm modulů /8 965 B, source-copy/privacy review](../examples/generated-apps/sqlite-catalog/README.md).
Publikovaný `cd3bece6` má [CI SUCCESS](https://github.com/Belphareon-bak/intentsmith/actions/runs/36987144761).
Devátá generace autorizovaná, původní FAIL/rollbacky zachované. Aplikační DB
mezi procesy v jednom sandboxu; backend restart/replay ověřuje M2 DB/commit/zdroje.

## Aktuální priority

1. **Společná integrace:** publikovaný `d7e7d1b1` slučuje `2a479852` + `6f0259ec`.
   Tři konflikty vyřešené, registry 594/35; novější CHAT `00ec5b52`
   je začleněný v `f2e6ac1a`. Celý profil `2997afd5`: **408 PASS /0 FAIL /0 BLOCKED**,
   14:24:36–14:34:45 UTC; report SHA `b69dcc223e231412…775e5138b`.
   Meta/LOC opravené, původní FAIL zachované. DPH eligibility: nezměněný routing 100 %, runtime 57/57, session 67/67 PASS;
   skutečný řízený M1 HTTP/WS 4/4 PASS (info vrací expertise gap).
   [Publikovaný `b1f7146c` CI SUCCESS](https://github.com/Belphareon-bak/intentsmith/actions/runs/37027278776):
   stažený artefakt potvrzuje **CHAT 7/7 + CODE 6/6**, všech 18 kroků SUCCESS.
   Celý profil je na `2997afd5`; potom se změnily dva kvalifikační helpery a docs.
   Studio/privacy/hygiene/build PASS; vývojové kontroly nepřijímají release.
   CHAT NO_GO: 53×3 nesplnilo kvalitu; finální přejímku vlastní jeho worker.
2. **Omezený M2 scanner:** V2 adoptovaný do skutečné default M2 služby,
   evaluator 34/34 a service 103/103 PASS: přesné approval/commit/restart,
   assertion rollback tří souborů a cancel před registrací. Dvě nezávislá
   source review PASS; AST baseline nad `4a8fb4b2`, registry 11/11 PASS.
   [Rozsah a historické fixture FAILy](wp/WP-M2-AST-IMPORT-SCANNER-20261001.md).
3. **CODE a větší projekt:** úplné zdroje při16k, skutečné přírůstky.
   CPU 198 případů: 27 se vejde při8k /97 při16k; nejde o úspěšnost modelu.
   Krátký load full GPU/CPU spill0/minfree3 759 MiB; plné okno NOT_RUN.
   Capture/source review PASS, gateway44/context18/service104 PASS.
   Úspora obalu119 B /1,4 % není řešení škálování; serializer32 000 B zůstává.
   [Kontextové rozhodnutí a odmítnutá projekce](wp/WP-CODE-PEER-CONTEXT-BUDGET-20261001.md#11-větší-projekty--nová-priorita-2-10-2026).
   **Fan-monitor, offline core/CLI:** dokumentovaný Studio `/m2-build <JSON>`,
   skutečný default CODE, explicitní zadání; 0 D1 /max11 CODE, stejný oracle.
   Přirozený D1 vstup blokuje CHAT classifier; ladění vlastní jiný worker.
   Čtyři actual generace `592cb54c`: vstupy2 167 /2 280 /6 733 /22 258 B,
   poslední prompt6 518 tokenů. Governance/source-policy/provider identity PASS.
   Historické DOM/pending helper FAIL zachované v [projektovém WP](wp/WP-PROJECT-FLOW-20260918.md).
   Opravy mají renderer CPU6, pending CPU7, required-pin3 a source review PASS.
   **`b1f7146c`: skutečný pending restart → exact approval → test8 PASS /6 FAIL.**
   Úplný rollback 4/4, bez commitu, všechny ownedStops PASS, původní packet/source
   nezměněné. Nová modelová volání0; celkem původní4 /max11.
   History odmítá pole; readings/monitor/test mají rozporné API. Naše zadání
   neuvádělo výslovně readings návratové pole a chronological history.
   Běžná oprava potřebuje4targety proti zmrazeným2; selection timeout po rollbacku.
   Audit excerpt4096 UTF-8 B truncated; focused outputTruncated=false.
   **Aplikace FAIL; CLI/commit/aplikační persistence NOT_RUN.**
   Návrh: čtyři core opravy +tři CLI generace bez dalšího retry, celkem stále11.
   Silnější API instrukce a test `contextFiles=[]`: model nevidí implementaci
   oracle; fyzický oracle i úplné app peers/previousDraft zůstávají zachované.
   CPU 29 043 →17 129 B; ≥1,5× UTF-8/escaping fixture 22 650 B, guard 27 904 B.
   Omezené CPU input review PASS; původní overflow zachovaný, aplikace FAIL.
   Implementace/nový freeze/rozhodnutí čekají; další inference neběží. Větší okno potřebuje VRAM měření.
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
