# IntentSmith — aktuální postup dokončení

**Aktualizováno:** 4. 10. 2026, 20:04 UTC / 22:04 CEST.
**Vlastník:** ROOT; CHAT/Gemma a zbývající Hunt mají jiné workery.
Po milníku, nejpozději po 3 h aktualizuji report; operátorovi report nejpozději po 2 h aktivní práce.
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

Nový source merge `56138e4f` převzal CHAT `e066956b` a vlastní CODE32k/D1;
nezávislé source preservation PASS, po merge projekt44/44, registry594/35,
regenerovaný graph1500/3cykly/28 souborů a provenance ratchet PASS.
Push/remote `92767d77` ověřen; [CI18/18 SUCCESS](https://github.com/Belphareon-bak/intentsmith/actions/runs/37229844277),
skutečné7/7 CHAT i7/7 CODE z official job logs; ZIP download403, není přijatý download.
Celý nový profil19:51–20:01 UTC:404 PASS/1 FAIL/3 BLOCKED. Dva docs census
asserts byly zastaralé; runneru jsem nepředal existující PDF/OCR runtime paths.
Původní report b52ac733…a9b12 neměnný; opravené census/parametry čekají na nový běh.
Instalovaný BE `c84b88cd` je jiný release; tento proud jej nenasadil.
Externí `c5309a0`/bundle zde nejsou. Hlásené359/32/16/1 a cílené 3/3 + 8/8
bez zdrojů/raw reportu nejsou přijaté lokální výsledky ani důkaz 49 produktových vad.
Po transferu source review, konflikty/registry z úplného stromu a společný profil.

## 1. CODE 32k a fan-monitor — nejbližší funkční milník

Operátor schválil původní 4 + opravné 4 + CLI 3 = max. 11 CODE, bez dalšího retry,
a preferuje 32k po měření VRAM. Původní 4 výstupy i failed packet zachované.
`b1f7146c`: actual pending restart → exact approval → 8 PASS / 6 FAIL,
rollback 4/4, žádný commit,0 nových volání. Defekty history/readings/monitor/test;
naše staré instrukce také neuváděly výslovně array API/chronological history.
CLI/aplikační persistence NOT_RUN. Nový plán vyjde z FAILED DB copy, ne expired approval.

**4. 10. skutečná 32k alokace:** Qwen3.8, digest 22130167…9643, provider 0.34.0-intentsmith.1,
19:10:15–19:10:34 UTC, 1 krátký request 32768/1, CPU spill 0 / min. volná VRAM 2512 MiB.
Owned unload/lease release PASS, žádné app volání. Receipt 3de557fc…460c944.
První 0-load STOP při desktop util 32 % zachovaný; nové zmrazené měření zaznamenává
G zátěž popisně, chrání empty compute/ps, VRAM/RAM/disk, lease a exact pins.
**Produktový CODE 32k kandidát:** capture zachovaný; CHAT/D1 cache, serializer 32 000 B
ani output 4096/2048 se nemění. Model-contract 44 / context 18 / service 104 CPU PASS;
complete default service input přes starý 16k guard, serializer overflow stále odmítnutý.
První gateway 42/2 FAIL byly staré fixture hranice; původní logs zachované.
Úplný fan repair input 29 043 B se vejde do obalu; plný workload/headroom/úplný output
nejsou tím změřené. Funkční oracle, bytes, approval, rollback/commit/restart a review čekají.
[CODE scope/evidence](wp/WP-CODE-PEER-CONTEXT-BUDGET-20261001.md).

## 2. Přirozené plánování → D1

ROOT převzal pouze classifier→D1 projektovou hranici, nikoli konverzační ladění.
Creative/inline shortcut v aktivním M2 projektu vyžádá existující modelový scope;
conversation zůstane odpověď, project jde do D1, status read-only, nejasnost se doptá.
Žádný nový router/synonym list/approval. Projektové CPU 44/44 včetně skutečné default
classifier→D1 cesty; původní 2 vstupy/parser 24 PASS. Nezávislé SOURCE_REVIEW_PASS,
receipt ff2dcbe1…97b7b0, není přejímka živé aplikace ani aktuální CI.
První integrační 43/1 FAIL je zachovaný: chybná fixture očekávala revision v promptu;
finální proposal stále ověřuje přesnou workspaceRevision a nulovou autoritu/zápis.
CI přidá existující project-collaboration do CODE výběru; všech 7 CHAT kontrol zachová.
Živý Studio natural entry a fungující fan jsou dosud NOT_ACCEPTED.
[Existující projektový WP](wp/WP-PROJECT-FLOW-20260918.md).

## 3. Hunt a CHAT holdout — jiní vlastníci

Operátor 4. 10. předal další hodnocení Huntu workerovi. Poslední lokálně ověřený
stav 596/1173 je historický audit, nikoli dnešní dokončení. ROOT nepřebírá proces.
ROOT 16/64 DEVELOPMENT_DRAFT a třetí strict-ID FAIL / cena 1.598950 USD zůstávají;
gradovací metoda, finální známky/role rozhodnutí/aktivace stále nepřijaté.
Gemma freeze `9591ea1b` /fixed remote v2 ověřen; report `d86baa27` uvádí
123/159 užitečných, 22/159 zbytečných stop, tedy NO_GO. CI není kvalitativní acceptance.
Operátor odpečetil `/mnt/vi7000/intentsmith/evidence/chat-holdout-20261002/holdout.json`.
ROOT obsah nečetl. Worker má provést 3 neměnné série na přesném kandidátu;
slepé nezávislé grading až po všech sériích. Holdout RUN/známky zatím NOT_RUN.

## 4. HTTP, finální IDE/BE, release a mobil

HTTP follow-up je nyní výslovně autorizovaný; nejde již o čekání na souhlas.
[Nový omezený WP](wp/WP-M2-PRIVATE-HTTP-EXECUTION-20261004.md): private-loopback-v1,
navržené execution@2/network policy, exact authority/preview/digests, default V1 offline.
ROOT CPU namespace proof PASS: skutečný HTTP, wrong-IP/wildcard/port/socket zákazy,
capsets0/NNP/seccomp/Landlock; původní netNS-owner EPERM a ip-path FAIL zachované.
Design/scope review PASS ebcf2fad…45e2fc; native/schema source se připravují privátně,
produktové controls a generovaná HTTP app NOT_RUN.
HTTP CPU práce běží nezávisle; mobil se zkouší až po stabilním IDE/BE.

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
