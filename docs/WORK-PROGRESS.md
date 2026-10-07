# IntentSmith — aktuální postup dokončení

**Aktualizováno:** 7. 10. 2026, 09:39 CEST /07:39 UTC.
**Vlastník:** ROOT; CHAT/Gemma a zbývající Hunt mají jiné workery.
**Release NOT_ACCEPTED. HTTP API FAIL. Fan FAIL. Mobil čeká na stabilní IDE/BE.**

## Přijaté dílčí výsledky

| Oblast | Doložený výsledek | Omezení |
| --- | --- | --- |
| Ledger / TaskFlow | CODE → přesné M2 → oracle → commit → restart, review PASS | Malé projekty; obecná úspěšnost CODE neprokázaná |
| SQLite | APPLICATION_ACCEPTANCE_REVIEW_PASS; 7 modulů, 8 965 B | n=1; DB mezi procesy v jednom sandboxu |
| Packaged IDE Ledger | 6 generací; approval/oracle/commit/durable M2 | DOM kliknutí; fyzická dostupnost ovládání otevřená |
| M3 / Worker | Izolace, původ dat, skutečný 5min worker/restart/čistý stop | Kvalita expertise, souběh a delší stabilita |
| AST / GPU panel / Cleanup | Omezené AST review, panel V7 a 3 vlastní refs přijaté | Hunt/model acceptance a cizí/evidence checkouty zachované |
| M6 data | Full109 backup → CLI restore → restart, review PASS | n=1, DB; project/config/skills restore otevřený |
| Kopírovaná cache / upgrade | Původní 56→forcedFAIL80→restore56→109, review PASS | n=1, bez modelu; celý fresh5 ani release nepřijaté |

[SQLite export](../examples/generated-apps/sqlite-catalog/README.md), [24 přijatých modulů](../examples/generated-apps/README.md).
BE restart SQLite dokládá durable M2/zdroje; nedokládá DB v dalším novém sandboxu.

## Společný kandidát a kontroly

Zdroj cache opravy a přijatého upgradu: **0d86b68e**; [CI37460776179](https://github.com/Belphareon-bak/intentsmith/actions/runs/37460776179), všech 18 kroků SUCCESS.
CHAT 7 / CODE 12 kontroly zachované; merge 56138e4f obsahuje CHAT e066956b / CODE32k / D1.
CHAT checkout 6. 10. ověřený clean e066956b; produktovou logiku CHATu ROOT neměnil.
Poslední celý offline/database profil **86dbca40: 410 PASS / 0 FAIL / BLOCKED / TIMEOUT**,
5. 10., 04:44:14–04:54:05 UTC; report a5a2f4a3…326d11c, všechny řádky/logy nezávisle ověřené.
Data 24/24, M1 kontrakt 74/74; tento starší profil necertifikuje cache opravu ani release.
Doc/artifact gate160 PASS; nynější census src688/237191, tests604/270426; source review přijímá přesný graph+1/1511/3cykly28.
Studio bundle 7bf62455…bfe24 / instalovaný BE c84b88cd nezměněné; žádný deploy ani aktivace.
Externí c5309a0/bundle místně chybí; jeho výsledky nejsou přijaté místní důkazy.

## Poslední přijatý milník: cache oprava a skutečný upgrade

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
| HTTP CODE | Anchored@5 skutečně vyčerpal 12/12; nový router vrací GET /items/1=400, A3 neopravena; rollback obnovil retained zdroje |
| HTTP strategie | Přesné M2 schválení/pending restart/rollback prošly; aplikace FAIL. Doporučený další krok: jeden skutečný repair routeru nad FAILED návrhem, rozpočet 13 vyžaduje rozhodnutí podle WP |
| Fan | Frozen5f6: 8/11 volání, oracle 8 PASS /6 FAIL; repair4+CLI3 / cumulative15 čeká na samostatnou odpověď |
| Přirozené plánování | Classifier→D1 CPU 44 +parser 24 /review PASS; skutečný vstup přes Studio ještě nepřijatý |
| M1 outage | Typed PROVIDER_UNAVAILABLE spolknutý classifierem → fallback/status ok; produktová oprava patří CHAT workerovi |
| Mobil | Chybí conversation.create; implementace a device přejímka až po stabilním IDE/BE |
| Hunt | Potřebujeme nový grading report/cestu a vlastníka pokračování; ROOT cizí hodnocení nepřebírá |

[HTTP WP](wp/WP-M2-PRIVATE-HTTP-EXECUTION-20261004.md): linux-bwrap-private-loopback-v1 je zapojený, default offline V1 zachovaný.
Retained@3 M2/oracle/Git1856920f/BE restart prošel; API SOURCE FAIL, [export](../examples/generated-apps/http-items-candidate/README.md) NOT_ACCEPTED.
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

1. Po opravě M1 od CHAT workera společný freeze/CI a původní fresh5: poslední actual na90 zůstal **3 PASS /2 FAIL**.
   Electron boundary/Studio M1/Studio M2 prošly; historický M1 a cache FAIL se nepřepisují. Nový whole fresh5 NOT_RUN.
2. HTTP: rozhodnout jeden genuine repair routeru nad skutečným FAILED M2 (12→13); poté frozen oracle +supplement17, commit/restart/persistence a review. Fan má samostatné rozhodnutí.
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
Holdout odpečetěn operátorem; jeho obsah ROOT nečetl, přejímku Gemma kandidáta vlastní CHAT worker.
[Datovaný archiv](https://github.com/Belphareon-bak/intentsmith/blob/0d86b68ef94bfd260dfb6f06d2231d14865dc9f1/docs/WORK-PROGRESS.md).
