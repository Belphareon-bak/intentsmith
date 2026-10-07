# IntentSmith — aktuální postup dokončení

**Aktualizováno:** 7. 10. 2026; převzetí úzké CHAT/M1 opravy a opravený autonomní postup.
**Vlastník integrace:** dosavadní ROOT (`work/real-chat-journeys-20260930`).
**Vlastník CHAT/M1 C1:** tento navazující CHAT worker (`work/chat-quality-20261001`);
operátor potvrdil, že předchozí CHAT již nezapisuje a úzkou opravu lze převzít.
HTTP, Fan, fresh5 a M6 zůstávají ROOT; Hunt a druhý posudek jeho matice se nepřebírají.
**Release NOT_ACCEPTED. HTTP API FAIL. Fan FAIL. Mobil čeká na stabilní IDE/BE.**

## Autonomní postup přijatý po revizi 7. 10. 2026

Autorita: operátor opravil návrh v bodech 1–10 a výslovně povolil po jejich
zapracování začít; následně potvrdil převzetí M1 opravy od neaktivního CHAT writera.
Tento soubor je jediný aktuální deník. `COMPLETION-TRACKER` je historický od
`2a479852`; chatový PROGRESS uchovává předchozí měření, není druhý společný plán.

**Etapa 0 — převzetí, nikoli nová konsolidace.** Ověřený ROOT základ je
`a61fe70d5ddabd63e066e9cbf4c8111b88f9fa56`, 546 commitů nad ověřeným GitHub
main `838b8cee`. Obsahuje CHAT `e066956b` (merge `56138e4f`) a projektovou D1
změnu `8fe6fb53`. Čistý vlastní CHAT checkout byl na tento základ fast-forwardnut;
ROOT checkout, produkce a zmrazený Gemma kandidát `9591ea1b` se nemění.
Full109 a kopírovaná cache/upgrade jsou přijaté v rozsahu níže; neopakují se bez
nové změny nebo konkrétní pochybnosti. Celý profil 410 PASS patří pouze `86dbca40`.

**Vlastnictví a předání.** CHAT C1 vlastní jen klasifikační propagaci chyby,
související regresní důkazy a vlastní dokumentaci v CHAT checkoutu. ROOT dále
vlastní HTTP/Fan/M6 a společné integrační dokumenty; změny tohoto deníku z CHAT
větve přebírá při integračním checkpointu, žádný souběžný zápis do jeho checkoutu.
`cre-decision.js` má pro C1 jediného writera CHAT; již integrovaný projektový
dispatch D1 se zachová a ověří. Reviewer produktový zdroj neopravuje. Nový
souběh nad stejným souborem nebo connectorem vyžaduje předání vlastnictví.

**Cyklus.** Jedna pojmenovaná uživatelská změna nebo nezbytná diagnóza má vstupní
SHA, vlastněné cesty, reprodukci, pozitivní a negativní důkaz, stop podmínku a
přesné příkazy. Po implementaci následuje nezávislé review druhým workerem,
opravy a nové review změněné části; potom relevantní integrační kontroly.
Autor se nepřijímá sám. Jednotlivé úkoly/commity z agentního protokolu jsou
vnitřní kroky tohoto revizního cyklu. Uzavřený cyklus a nejpozději tři hodiny
aktivní práce dostanou checkpoint zde, včetně otevřených vad a dalšího kroku.
Po přijatém cyklu se pokračuje bez nového běžného potvrzení. Gate 0 patří až
release WP; FAIL/BLOCKED/NOT_RUN se nepřeznačují. Publikace podle CONTRACT §11
ověřuje vzdálené SHA a sama neznamená integraci, nasazení ani release přijetí.

**Pořadí.** C1 opraví spolknutý `LLM_PROVIDER_UNAVAILABLE` před ROOT fresh5.
Potom společný freeze/CI a původní fresh5 vlastní ROOT. Před dalším laděním
kvality následuje rozbor všech 36 neužitečných odpovědí a 22 zastavení z Gemma
regrese podle rodiny a příčiny (aplikace/model/hodnocení, překryvy se nesčítají).
Stagnace se uplatňuje ihned; nové prompty ani regex opravy bez doložené příčiny.
Po dvou cyklech bez posunu se strategie přehodnotí a problém oznámí, nezávislá
práce může pokračovat. Historické různě hodnocené série nejsou samy kontrolované
srovnání modelů. Pokud evidence ukáže limit lokálního modelu, předloží se měřené
varianty bez tichého snížení kvality nebo změny produkčních bindingů.
Přirozený vstup D1 je implementovaný a integrovaný; zbývá skutečné Studio → D1
ověření, nikoli nové povolení k napsání téže opravy. Další cykly pokryjí
file/web/export/skills, projektové A→B→A a změna→test→rollback/restart,
specialistu/agenta, scoped learning, další restore a provozní/release matice
podle již přijatých závislostí. Mobil zůstává samostatný release.

**Kvalita a holdout.** ≥95 % užitečných / ≤5 % zbytečných zastavení / 0 kritických
chyb / 3 nezměněné série jsou nutná regrese na známých 53 případech, ne finální
přejímka. Rozpad rodin a celé odpovědi lze použít pro tuto exponovanou regresi.
H1 je podle operátorovy kontroly odpečetěný, SHA odpovídá pečeti, ale sběr
neproběhl: `UNSEALED / NOT_RUN`. Obsah ani odpovědi tohoto holdoutu implementátor
nečte, nevyhledává ani nezahrnuje do běžné inventury či balíku review. Neprohlašuje
se technická izolace: plaintext dostupný témuž OS účtu není izolovaný pomocí 0600.
Před sběrem musí vlastník holdoutu zajistit oddělený přístup runneru/hodnotitelů;
mezitím zůstává mimo pracovní vstupy. Žádné široké hledání v evidence rootu,
`restricted/`, dešifrovaných sadách ani jejich odpovědích. C1 používá výhradně
veřejnou původní outage reprodukci, nové vlastní logy a známou regresi.
H1 slouží jedné přejímce zmrazeného kandidáta (tři předepsané neměnné série);
implementátor dostane jen celkový verdikt a identitu kandidáta/protokolu,
žádné rodiny, příklady ani průběžné známky. Po uzavření se H1 považuje za
spotřebovaný regresní korpus. Finální etapa 5 vyžaduje nový nezávislý H2,
zapečetěný s rubrikou/prahy před sběrem, bez ladění podle výsledků. Významovou
přejímku provádějí dva nezávislí kvalifikovaní hodnotitelé, ne autor kódu.

**Paket pro každou revizi.** Base SHA a candidate SHA; přesný diff; příkazy
s očekávanými exity; cesty k raw důkazům a jejich SHA-256; známá omezení;
seznam zakázaných vstupů (`restricted/`, H1/H2 a jejich odpovědi). GPU okno
má vlastníka, dohodnutý začátek/konec a předání lease s čistým procesním/GPU
inventářem. C1 CPU/řízený loopback GPU nevyžaduje; živý fresh5 rezervuje ROOT
společně s reviewerem před spuštěním. Bez potvrzeného okna se inference nespustí.
Dokumentace dotčeného chování a aktuální mapy se mění ve stejném cyklu;
historická evidence se zachovává. Technické volby se řeší autonomně; změny
produktového cíle, authority, kritérií, nevratné zásahy a nové výdaje se předkládají
s daty, variantami, doporučením a konkrétním blokovaným krokem včas.

### Pravomoci během autonomních cyklů

| Krok | Kdo rozhoduje / podmínka |
| --- | --- |
| Úzký CHAT fix, vlastní izolovaná DB a CPU regrese, lockfile instalace, dokumentace | CHAT autonomně v přidělených cestách; beze změny produktových kritérií |
| Přijetí cyklu a nové importní hrany | Nezávislý reviewer; autor opravuje nálezy a znovu předává změněný rozsah |
| Commit/push vlastní kandidátní větve | CHAT autonomně podle CONTRACT §11; povinné ověření remote SHA, publikace není přejímka |
| Společná integrace, HTTP/Fan/fresh5/M6, sdílené mapy | Dosavadní ROOT přebírá přesný CHAT commit ve svém checkoutu |
| Živá inference a reviewerovo opakování | Předem dohodnuté GPU okno/lease s ROOT, přesný model/digest/profil a vlastní DB |
| H1/H2 obsah a hodnocení | Oddělený správce/hodnotitelé; implementátor pouze aggregate verdict a identita |
| Nové výdaje, produkční binding/deploy, snížení prahů, rozšíření efektů nebo vyčerpaného schváleného budgetu | Konkrétní návrh a operátorské rozhodnutí před dotčeným krokem; nezávislá práce pokračuje |

### C1 — M1 provider outage (SOURCE_REVIEW_PASS; širší kontroly probíhají)

Výsledek: PROVIDER_UNAVAILABLE skutečně vyžádané modelové klasifikace skončí existujícím
typovaným M1 error, bez odpovědi assistant/úspěšného terminálu a bez effectu.
Deterministická odpověď, která model nepotřebuje, zůstane funkční offline.
Přijatý D1 dispatch ani pravidla pro neplatný modelový JSON se neoslabují.
Rozsah: `src/chat/cre-decision.js`, příslušná stávající M1/kontextová sada,
vlastní evidence a dokumentace; gateway, M2 authority, HTTP/Fan budgety,
produkční DB/bindingy, holdout a ROOT checkout jsou mimo zapisovaný rozsah.
BASE `a61fe70d`, RED `68a51405`, produktový kandidát `1f098912`.
Nová regrese nejprve doložila HTTP 200/status:ok a uložené doptání při obou
výpadcích. Po opravě HTTP 503/status:error, jen uživatelský tah a stejný počet
tool requestů také po restartu. Nezávislý reviewer zopakoval context 27/27,
M1 74/74 a project 44/44 (vše exit 0) a výslovně přijal jedinou novou importní
hranu; přesný baseline byl následně vygenerován z čistého `1f098912`.
[Revizní paket s SHA-256 a příkazy](review/2026-10-07-CHAT-M1-OUTAGE.md).
První širší profil `10ef40ab`: 409 PASS / 1 FAIL (M2 TypeScript grammar chybí
v node_modules proti lockfilu). FAIL report zachován; synchronizace vlastních
závislostí a nové opakování probíhají. CI/publikace PENDING; ROOT fresh5 NOT_RUN.

### C2 — okamžité uplatnění stagnace (diagnóza i CPU experiment REVIEW_PASS)

Read-only rozbor exponované Gemma regrese `9591ea1b` připravil druhý worker;
[úplný rozpad 36 vad a 22 zastavení](review/2026-10-07-CHAT-STAGNATION-DIAGNOSIS.md).
22 zastavení je podmnožinou 36 vad, nikoli dalších 22 případů. Přímé providerové
stopy pokrývají jen 19/36 vad; pro 17 chybí. Sedm vad dokládá ztrátu konkrétního
doptání v aplikaci, šest souborových má modelový nebo smíšený kontextový podklad,
16 souborových zůstává UNKNOWN, čtyři se týkají faktů/hodnocení a tři kalendáře.
Samostatný CPU experiment 3×5 podmínek dokončen a nezávisle přezkoumán:
u ambiguous a missing-target-yes se pod0.7 ztrácí konkrétní otázka, nad prahem
zůstává při jinak totožných bajtech. Gibberish pod prahem prokazuje project
dispatch; konečný text je ve třech podmínkách INCONCLUSIVE. Ve všech15 nulové
nové efekty a čistý stop, 2600 hashů ověřeno. Produkt ani modelové skóre se
neměnily. Další C3 má opravit zachování validního read-only doptání bez nových
pravomocí, s vlastní reprodukcí/revizí; C1 freeze pro ROOT se tím nepřesouvá.

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
Historický doc/artifact gate160 PASS patří ROOT. Aktuální CHAT census src688/237206, tests604/270539; revidovaný graph1512/3cykly28.
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
| M1 outage | C1 `1f098912` SOURCE_REVIEW_PASS, řízené HTTP/restart testy PASS; širší profil/CI a ROOT fresh5 čekají |
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
