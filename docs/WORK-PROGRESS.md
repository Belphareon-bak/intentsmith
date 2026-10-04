# IntentSmith — aktuální postup dokončení

**Aktualizováno:** 4. 10. 2026, 21:19 UTC / 23:19 CEST.
**Vlastník:** ROOT; CHAT/Gemma a zbývající Hunt mají jiné workery.
Report aktualizuji po milníku a do 3 h; operátorovi hlásím postup do 2 h aktivní práce.
**Release NOT_ACCEPTED; fan aplikace FAIL.**

## Přijatý základ

| Oblast | Doložený výsledek | Omezení |
| --- | --- | --- |
| Ledger / TaskFlow | Model → exact M2 → funkční oracle → commit → restart, review PASS | Malé projekty, nikoli obecná spolehlivost CODE |
| SQLite | APPLICATION_ACCEPTANCE_REVIEW_PASS, sedm modulů / 8 965 B, přesný export | n=1; DB mezi procesy v jednom sandboxu, BE restart ověřuje durable M2/zdroje |
| Packaged IDE Ledger | Šest generací, exact approval/oracle/commit/durable DB | DOM click, fyzická dostupnost tlačítek ještě otevřená |
| M3 /Worker | Projektová provenance/izolace; skutečný 5min worker/restart/čistý stop | Kvalita expert-vs-general, souběh a dlouhý soak otevřené |
| Scanner | Default M2 AST, evaluator 34 / service 103, nezávislé review PASS | Samostatná vada; není řešení velikosti kontextu |
| GPU UI /Cleanup | V7 readonly hodnoty/pointer přijaté; tři vlastní refs odstraněny | Neznamená Hunt/model acceptance; evidence/foreign worktrees zachované |

[SQLite přesný export](../examples/generated-apps/sqlite-catalog/README.md),
[24 zdrojových modulů čtyř přijatých snapshotů](../examples/generated-apps/README.md).
Historické FAIL/oracle/rollbacky zůstávají neměnné; přijaté scénáře neopakuji bez důvodu.

## Aktuální integrační stav

Merge `56138e4f` převzal CHAT `e066956b` a vlastní CODE32k/D1;
nezávislé source preservation PASS, po merge projekt44/44, registry594/35,
regenerovaný graph1500/3cykly/28 souborů a provenance ratchet PASS.
Publikovaný `77bd5a03`: [CI SUCCESS](https://github.com/Belphareon-bak/intentsmith/actions/runs/37232683974),
18/18 kroků, skutečné7/7 CHAT +7/7 CODE z official job logs; remote SHA ověřené.
Nový celý profil `769d4930`,20:04–20:14 UTC: **408 PASS/0 FAIL/0 BLOCKED/0 TIMEOUT/0 SKIP**.
Report SHA934d9673…e65dd. První404/1/3 (stale census/mnou nepředané runtime paths)
zůstává zachovaný b52ac733…a9b12; změněná byla dokumentace a parametry, ne produkt.
Instalovaný BE `c84b88cd` je jiný release; tento proud jej nenasadil.
Externí `c5309a0`/bundle zde nejsou; hlášené výsledky nejsou přijaté lokální důkazy.
Produkt/testy/registry stejné jako celý profil769; pouze dva manual helpers a docs.
CI neznamená app přejímku; nový GPU admission delta nyní čeká na publikaci/CI/freeze.

## 1. CODE 32k a fan-monitor — nejbližší funkční milník

Operátor schválil původní 4 + opravné 4 + CLI 3 = max. 11 CODE, bez dalšího retry,
a preferuje 32k po měření VRAM. Původní 4 výstupy i failed packet zachované.
`b1f7146c`: actual pending restart → exact approval → 8 PASS / 6 FAIL,
rollback 4/4, žádný commit,0 nových volání. Defekty history/readings/monitor/test;
naše staré instrukce také neuváděly výslovně array API/chronological history.
CLI/aplikační persistence NOT_RUN. Continuation obnoví přesnou FAILED DB copy,
vyžádá nový plán/approval a hlídá rozpočet; CPU10/review57d6ea9b…17978 PASS.
Actual Studio build a CI77 PASS. Freeze67efa879…147ba04d zachovaný.
20:55 actual placement STOP a 20:57 preflight STOP utratily 0 nových volání.
Inventář ukázal jen desktop G procesy, compute/ps prázdné, free cca22 500 MiB;
starý limit util30 zaměňoval grafickou zátěž za obsazenou compute GPU.
Nový explicitní failed32 opt-in: 3 vzorky pod lease, free≥22 000 MiB, empty compute/ps,
známé údaje/identity/RAM/disk; util se zaznamenává. Default util30 zůstává.
CPU7/review8835de1e…524adfe PASS, přesná adopce runner6a62ef65…605c4b7.
Nové source/CI/freeze před inferencí; oracle/instrukce/limity/max11 zůstávají.

**4. 10. skutečná 32k alokace:** Qwen3.8, digest 22130167…9643, provider 0.34.0-intentsmith.1,
19:10:15–19:10:34 UTC, 1 krátký request 32768/1, CPU spill 0 / min. volná VRAM 2512 MiB.
Owned unload/lease release PASS, žádné app volání. Receipt 3de557fc…460c944.
První capacity0-load STOP při desktop util32 zachovaný; nedokládá plný workload.
**Produktový CODE 32k kandidát:** capture zachovaný; CHAT/D1 cache, serializer 32 000 B
ani output 4096/2048 se nemění. Model-contract 44 / context 18 / service 104 CPU PASS;
complete default service input přes starý 16k guard, serializer overflow stále odmítnutý.
Úplný fan repair input 29 043 B se vejde do obalu; plný workload/headroom/úplný output
nejsou tím změřené. Funkční oracle, bytes, approval, rollback/commit/restart a review čekají.
[CODE scope/evidence](wp/WP-CODE-PEER-CONTEXT-BUDGET-20261001.md).

## 2. Přirozené plánování → D1

ROOT převzal pouze classifier→D1 projektovou hranici, nikoli konverzační ladění.
Creative/inline shortcut v aktivním M2 projektu vyžádá existující modelový scope;
conversation zůstane odpověď, project jde do D1, status read-only, nejasnost se doptá.
Žádný nový router/synonym list/approval. Projektové CPU 44/44 včetně skutečné default
classifier→D1 cesty; původní 2 vstupy/parser 24 PASS. Nezávislé SOURCE_REVIEW_PASS,
receipt ff2dcbe1…97b7b0; první fixture FAIL zachovaný. Aktuální CI již obsahuje
project-collaboration i všech 7 CHAT kontrol. Živá kvalitativní přejímka čeká.
Živý Studio natural entry a fungující fan jsou dosud NOT_ACCEPTED.
[Existující projektový WP](wp/WP-PROJECT-FLOW-20260918.md).

## 3. Hunt a CHAT holdout — jiní vlastníci

Operátor předal další Hunt workerovi; ROOT nepřebírá proces. Audit20:54 UTC:
106 canonical batches stále596/1173 odpovědí a2324/3689 kritérií, poslední zápis30.9.
Receipt55b77073…f91fa9; jméno/path nového workeru zatím nedoložené, cílený dotaz čeká.
ROOT 16/64 DEVELOPMENT_DRAFT a strict-ID FAIL zachované; finální známky/role nepřijaté.
Gemma freeze `9591ea1b` /fixed remote v2 ověřen; report `d86baa27` uvádí
123/159 užitečných, 22/159 zbytečných stop, tedy NO_GO. CI není kvalitativní acceptance.
Operátor odpečetil `/mnt/vi7000/intentsmith/evidence/chat-holdout-20261002/holdout.json`.
ROOT obsah nečetl. Worker má provést 3 neměnné série na přesném kandidátu;
slepé nezávislé grading až po všech sériích. Holdout RUN/známky zatím NOT_RUN.

## 4. HTTP, finální IDE/BE, release a mobil

HTTP follow-up je nyní výslovně autorizovaný; nejde již o čekání na souhlas.
[Nový omezený WP](wp/WP-M2-PRIVATE-HTTP-EXECUTION-20261004.md): private-loopback-v1,
navržené execution@2/network policy, exact authority/preview/digests, default V1 offline.
CPU namespace/native Node24 HTTP PASS včetně capsets0/NNP/seccomp/Landlock a zákazů;
host unchanged, původní EPERM/ip-path/AF_UNIX pipe FAIL zachované. Není produktový PASS.
V2 schema35/review981339fa…48f8d PASS. Provider/native/build proposal CPU9 PASS,
nezávislé review běží; V2 full payload není zatím durable a SQL fix se připravuje.
Produktový provider/V2/DB-reopen/UI a generovaná HTTP app NOT_RUN.
HTTP příprava privátní, mimo zmrazený fan source; mobil až po stabilním IDE/BE.

Po fan/shared candidate: skutečné pointer UI/M2 v instalovaném service kontextu,
file/web/export/skills journeys, různé projekty/A→B→A, kvalitativní expertise oracle
(dosavadní keywords/length nestačí), skutečný souběh workerů. Pak nový společný profil,
fresh install/upgrade/backup-restore, finální 24h soak/throughput a přijetí delt.
M5/M6: osm unsigned podkladů existuje, 13 signed receipts chybí; skutečné recovery,
offline key copy/operator/reviewer role a 9krokové demo. Historický soak nestačí.
Mobil: conversation.create v BE chybí; 47 CPU PASS, fyzická 13+7 matice NOT_RUN.
Device/signed APK/VPN origin/pair-revoke/restart/M2 approval/TalkBack čekají.
Poslední cleanup až po integraci: audit 215 větví / 72 worktrees, cizí/UNKNOWN/evidence HOLD.

[Archiv předchozího aktuálního reportu](https://github.com/Belphareon-bak/intentsmith/blob/5cf1c36db6ad8d9748b02a65aeab7974be3e28e9/docs/WORK-PROGRESS.md)
a [historického trackeru](https://github.com/Belphareon-bak/intentsmith/blob/cd3bece693264bf78b0744a5eead9aa9859c715b/docs/review/2026-09-30-COMPLETION-TRACKER.md)
uchovávají podrobnou historii. Raw DB/prompty/provozní data zůstávají privátní.
