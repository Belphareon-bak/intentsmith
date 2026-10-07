# IntentSmith — aktuální postup dokončení

**Aktualizováno:** 7. 10. 2026; zdroj e6b83884 publikován. C1/C3/C7/C8 source review PASS, aktuální context41 / integrace19 / CI18 PASS. C4 fresh5 5PASS. C5 v5 LIVE_FAIL, D1 nedosažen; C6 kvalita NO_GO. C7 živá série 1/3 funkčně FAIL, cleanup FAIL; další dvě NOT_RUN. H1 sběr NOT_RUN.
**Vlastník integrace a CHAT:** tento koordinátor přebírá ROOT
(`work/real-chat-journeys-20260930`) podle následného pokynu operátora.
Jediný writer `cre-decision.js` i společných map je nyní ROOT; HTTP, Fan, fresh5
a M6 patří témuž koordinátorovi. Hunt a druhý posudek jeho matice zůstávají oddělené.
CHAT checkout slouží následně jen jako vlastní sériový běhový checkout zmrazených kandidátů.
**Release NOT_ACCEPTED. HTTP API FAIL. Fan FAIL. Mobil čeká na stabilní IDE/BE.**

## Autonomní postup přijatý po revizi 7. 10. 2026

Autorita: operátor opravil návrh v bodech 1–10 a výslovně povolil po jejich
zapracování začít; následně potvrdil převzetí M1 opravy od neaktivního CHAT writera.
Další pokyn v téže relaci přebírá celou ROOT koordinaci, ruší pořadovou
podmínku D1 a určuje jeden H1 sběr: Qwen i Gemma, každý 3 série, poté odstranit
plaintext. Pokud sběr nezačne hned, plaintext odstranit už před přípravou.
Zaslepený balík pro hodnotitele po sběru sestaví operátor.
Tento soubor je jediný aktuální deník. `COMPLETION-TRACKER` je historický od
`2a479852`; chatový PROGRESS uchovává předchozí měření, není druhý společný plán.

**Etapa 0 — převzetí, nikoli nová konsolidace.** Ověřený ROOT základ je
`a61fe70d5ddabd63e066e9cbf4c8111b88f9fa56`, 546 commitů nad ověřeným GitHub
main `838b8cee`. Obsahuje CHAT `e066956b` (merge `56138e4f`) a projektovou D1
změnu `8fe6fb53`. Čistý vlastní CHAT checkout byl na tento základ fast-forwardnut;
To byl stav vstupu C1. Nyní čistý ROOT checkout převzal přesný publikovaný
CHAT `e15264f14b3db3e47837da1adac11509bcc37bc4` pomocí fast-forwardu
z `a61fe70d`, bez slučovacího diffu. Aktuální zdroj po dalších cyklech je e6b83884.
Produkce ani oba zmrazené H1 kandidáty
`c7f03d56` / `9591ea1b` se nemění.
Full109 a kopírovaná cache/upgrade jsou přijaté v rozsahu níže; neopakují se bez
nové změny nebo konkrétní pochybnosti. Při převzetí patřil poslední celý profil 410 PASS pouze `86dbca40`; nový C1 výsledek je uveden níže.
Po integraci se kontroluje shoda instalovaných závislostí s lockfilem i dostupnost
předepsaného browser/PDF/OCR runtime před dalším celým během.

**Vlastnictví a předání.** Historický C1 měl úzký CHAT rozsah a byl nezávisle
přezkoumán před převzetím. Nyní se další zápisy i integrace provádějí pouze
v ROOT checkoutu; starý ROOT/CHAT souběh se neobnovuje. Převzetí nesnižuje
HTTP/Fan budgety ani akceptační podmínky a nepřebírá Hunt grading. Přijatý
projektový dispatch D1 se zachová a ověří. Reviewer produktový zdroj neopravuje;
každý nový souběh nad týmž souborem/connectorem vyžaduje výslovné předání.

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

**Pořadí.** C1 je integrován, C4 opakování původního fresh5 na b959a468 má5PASS
a nezávislé evidence review PASS. C5 opravil slot0 i WS guard, ale skutečný v5
skončil po odeslání vstupu při GPU dohledu; další retry ani rozšiřování aparátu
se v tomto cyklu neprovádí. C6 dokončil3×53 a dva posudky potvrzují NO_GO.
Navazující C7 opravil prokázanou aplikační ztrátu save kontextu, C8 další tři
třídy nepravdivého úspěchu při providerové chybě; oba mají nezávislé source
a execution review. C7 cílená živá série přesto nabídku uložení nevytvořila.
Další chatový krok musí oddělit rozhodnutí o návaznosti a save interpretaci
na již exponovaných případech, nikoli přidat nedoložený prompt/regex. C2 již rozebral všech 36 neužitečných odpovědí a 22 zastavení
z Gemma regrese podle rodiny a příčiny (aplikace/model/hodnocení, překryvy se nesčítají).
H1 má naplánované jedno společné GPU okno pro oba pevné kandidáty, zatím
WINDOW_NOT_OPEN; čeká na custody/dešifrování operátora. CPU vývoj pokračuje nezávisle. D1 nemá pořadovou závislost na sběru ani hodnocení H1.
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
H1 byl odpečetěný, ale podle operátorovy kontroly nespuštěný. Dne 7. 10.
v 16:12:33 UTC koordinátor ověřil oba SHA proti veřejné pečeti a odstranil
přesně `holdout.json`; šifrovaný originál zachován. Aktuálně
`PLAINTEXT_REMOVED / COLLECTION_NOT_RUN`; neznamená to anulování minulé expozice.
[Receipt](review/evidence/chat-holdout-window-20261007/plaintext-removal.json).
Obsah ani odpovědi implementátor nečte, nevyhledává ani nezahrnuje do běžného
review. Zákaz zahrnuje `restricted/`, celé H1/H2 evidence adresáře a jejich raw běhové logy.
Mode 0600 ani proces pod stejným OS účtem se nevydávají za technické oddělení.
Dešifrování provede operátor těsně před připraveným oknem; runner přečte corpus
strojově a ověří pečeť, veškeré logy se přesměrují do privátní evidence.
Koordinátor smí kontrolovat pouze předem vybraná metadata/počty, nikdy case ID,
texty, rodiny ani známky. Operátor po bězích sestaví zaslepený hodnoticí balík.
Jedna H1 kampaň obsahuje Qwen `c7f03d56` 3× a Gemmu `9591ea1b` 3× bez změn,
mezilehlého hodnocení či ladění; každý kandidát má samostatný nový record.
Po sběru se přesný plaintext znovu odstraní, šifrovaný originál a raw důkazy
zůstanou pro správce/hodnotitele. Neúplný sběr se nepřeznačí na přejímku;
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
| Produktové opravy v aktivních WP, vlastní DB a CPU regrese, lockfile instalace, dokumentace | ROOT autonomně v přidělených cestách; beze změny produktových kritérií |
| Přijetí cyklu a nové importní hrany | Nezávislý reviewer; autor opravuje nálezy a znovu předává změněný rozsah |
| Commit/push vlastní kandidátní větve | ROOT autonomně podle CONTRACT §11; povinné ověření remote SHA, publikace není přejímka |
| Společná integrace, HTTP/Fan/fresh5/M6, sdílené mapy | Tento ROOT koordinátor; dřívější budgety a chráněné oracle zůstávají |
| Živá inference a reviewerovo opakování | Předem dohodnuté GPU okno/lease s ROOT, přesný model/digest/profil a vlastní DB |
| H1/H2 obsah a hodnocení | Oddělený správce/hodnotitelé; implementátor pouze aggregate verdict a identita |
| Nové výdaje, produkční binding/deploy, snížení prahů, rozšíření efektů nebo vyčerpaného schváleného budgetu | Konkrétní návrh a operátorské rozhodnutí před dotčeným krokem; nezávislá práce pokračuje |

### C1 — M1 provider outage (FINAL_EVIDENCE_REVIEW_PASS; INTEGRATED_ROOT)

Výsledek: PROVIDER_UNAVAILABLE skutečně vyžádané modelové klasifikace skončí existujícím
typovaným M1 error, bez odpovědi assistant/úspěšného terminálu a bez effectu.
Deterministická odpověď, která model nepotřebuje, zůstane funkční offline.
Přijatý D1 dispatch ani pravidla pro neplatný modelový JSON se neoslabují.
Rozsah: `src/chat/cre-decision.js`, příslušná stávající M1/kontextová sada,
vlastní evidence a dokumentace; gateway, M2 authority, HTTP/Fan budgety,
produkční DB/bindingy, holdout a tehdejší ROOT checkout byly mimo zapisovaný rozsah C1.
BASE `a61fe70d`, RED `68a51405`, produktový kandidát `1f098912`.
Nová regrese nejprve doložila HTTP 200/status:ok a uložené doptání při obou
výpadcích. Po opravě HTTP 503/status:error, jen uživatelský tah a stejný počet
tool requestů také po restartu. Nezávislý reviewer zopakoval context 27/27,
M1 74/74 a project 44/44 (vše exit 0) a výslovně přijal jedinou novou importní
hranu; přesný baseline byl následně vygenerován z čistého `1f098912`.
[Revizní paket s SHA-256 a příkazy](review/2026-10-07-CHAT-M1-OUTAGE.md).
První širší profil `10ef40ab`: 409 PASS /1 FAIL (chybějící TS grammar).
Druhý `b9cfc7c5`: 409 PASS /1 FAIL (browser cache po npm ci). Oba FAILy zachované.
Závislosti synchronizované podle beze změny zachovaného lockfilu; obnoven tentýž
Chrome152.0.7977.75, samostatný browser test PASS. Finální celý profil
**b9cfc7c5, 15:42:11–15:51:54 UTC: 410 PASS /0 FAIL /BLOCKED /TIMEOUT /SKIPPED**.
CODE12 12/12, CHAT7 7/7, registry596 a CI37644166375 všech18 SUCCESS.
Strom src, chat-context test a lockfile shodné s `1f098912`; module baseline
byl samostatně schválen, ostatní tests soubory se neměnily. `b9cfc7c5` publikován a remote SHA ověřeno;
závěrečný commit doplňuje pouze dokumentaci a důkazy. Nezávislý reviewer ověřil
1250 logových hashů +27 dalších artefaktů a vydal FINAL_EVIDENCE_REVIEW_PASS.
Manifest `de2302b3…d90c89a7`, exact CI job112870464823. Závěrečný docs/evidence
commit `e15264f1` má také CI37648451862, 18 SUCCESS, a je nyní fast-forwardem
v ROOT. Identita testovaného zdroje se zachovala; při převzetí byl fresh5 NOT_RUN.
Následný C4 jej ověřil na b959a468,5PASS/review PASS.

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

### C3 — zachování konkrétního doptání (SOURCE_AND_EVIDENCE_REVIEW_PASS; INTEGRATION_V2_PASS)

Autorita: přijatý chat WP (přirozené doptání a obnovení původního zadání),
operátorův pokyn pokračovat autonomně a 7. 10. „udělej toho co nejvíc“.
BASE `228caaf680002f062dabc47f65dd2b18aca84fc7`; produkt v2 `3bfebf98b8495c455d3193d22aaf2579afbf040e`.
Jeden výsledek: validní AMBIGUOUS s konkrétní otázkou při confidence pod0.7
vrací ASK_USER před regex/project fallbackem. Žádné tools ani akční metadata
z nejistého modelu; kanonická operace a původní zadání z již uloženého pending
stavu zůstávají zachované. Přijímací prahy beze změny, H1/raw/restricted mimo rozsah.
ROOT je jediný writer CRE, stávajícího context testu, důkazů a dotčené dokumentace.

První kandidát bdf461d2 měl RED2FAIL→context28PASS a checkpoint6b593a58
CHAT7/CODE12 19PASS +CI37654239411 success. Nezávislá kontrola DB jej přesto
vrátila: tři nízké confidence ztratily implicitní pending FILE_WRITE operaci.
Nový RED1FAIL doložil vadu; v2 uchovává operaci existujícím canonical helperem.
Context v2 28/28 PASS. Řízený replay3×5:15/15 konkrétních otázek, právě1
klasifikace,0 efektů,0 INCONCLUSIVE, všech5 pending write i původní zadání zachováno.
Nezávislé source/evidence review v2 PASS; DB snapshoty,49 hashovaných artefaktů
ověřené, starých45 raw souborů zachováno. Jde o fixture provider, skóre modelů
se nemění. Opakování19 původních CI integračních sad na checkpointu3c4d750f
má19PASS/0FAIL/BLOCKED/TIMEOUT/SKIPPED, exit0; doc/artifact160PASS.
[Revizní paket s příkazy/exity/diffem/sha256](review/2026-10-07-CHAT-CONCRETE-CLARIFICATION.md).

### C4 — původní fresh5 po C1/C3 (FRESH5_ACTUAL_EVIDENCE_REVIEW_PASS)

Autorita: přijatý M6/project WP a převzetí ROOT operátorem; ne nový release Gate0.
Čistý publikovaný `b959a468554a6377319248e3e3752b4643f85c81`, CI37656397580/18SUCCESS.
Jeden actual7.10.17:25:47–17:33:05UTC: **5PASS/0FAIL**, exit0, žádný retry.
Původní M1 journey, previous-version upgrade, Electron boundary, Studio M1
Electron a Studio M2 composer DOM proběhly po čerstvé offline instalaci/buildu.
Původní90c17489/3PASS2FAIL se nemění. C1/cache/C3 jsou ověřené společně.

Původní V3 ADAPTER426200be…590d4, wrapper9dc32914…8674, cache receipt82265b3a…da6,
5 programů, oracle a limity beze změny. Nový freeze6b1dd8df…8905c připíná aktuální
source/deps/CI/PID/boot; byte drift znamenáSTOP. Nezávislý freeze review uzavřel
P2 nepřipnutého Yarn launcher linku pomocí externího before/after verifieru.
Obě úplné closure a obě launcher kontroly `python3 -I -B` PASS, exit0.

10/10 skutečných modelových odpovědí (4class/4answer/2summary), exactQwen3.5/4K,
395GPU vzorků/316loaded/min5875MiB. 224 vlastněných procesních identit po běhu
neexistuje, bez ROOT cleanup signálů, model/relay/lease uvolněné. Nezávislé review
ověřilo manifest1760,30request-kind a395GPU predikátů, logy/5programů/source/build.
M1 DB z vlastní kopie potvrdila jen USER při outage. Upgrade nested DB test po
úspěchu uklidil;56→80→56→109 dokládá raw receipt a nezměněný oracle, ne nový
post-hoc audit odstraněné DB. n=1; celý M6/soak/release a nové modelové skóre otevřené.
Review65b4b843…12a06. [Přesný paket a omezení](review/2026-10-07-FRESH5-C1-C3.md).
ROOT provedlactual, druhý worker přijal; autor si nepřijímal vlastní výsledek.

### C5 — přirozený Studio→classifier→D1 (LIVE_FAIL; D1_NOT_REACHED)

Původní1012B vstup a limit classifier1 +D1max2/4K,0CODE/efektů zůstaly.
v2/v4 DOM FAIL před emisí a v3 CHANGES_REQUIRED/NOT_RUN jsou zachované.
Ovladač slot0 a v5 WS guard mají nezávislé review;26raw/tamper CPU kontrol PASS.
První freeze builder selhal před actual, opravený r2 má7CPU kontrol a review PASS.
Actual na čistém cd3b8f02,7.10.19:44:28–19:44:42UTC, skončil **FAIL/exit1**:
jeden sloupec doložen, vstup odeslán,1classifier request,0úplných modelových
odpovědí,0D1/CODE. GPU PID1492316 zmizel před /proc kontrolou, cleanup PID1492337
byl zombie bez argv; identity nepřijaté.16pozorovaných app procesů zaniklo,
3SIGTERM skupinám,relay0; graceful cleanup se netvrdí. Own lease uzavřena až
samostatnou přezkoumanou recovery po3prázdných GPU vzorcích; actual FAIL zůstává.
Vlastní post-stop DB kopie: USER +protokolový ASK_USER/status ok,36authority
tabulek prázdných,8projektových souborů/Git beze změny. Source closure PASS.
Přesný gateway exception chybí; C8 samostatně reprodukoval a opravil tři
operational error větve, ale neurčuje zpětně příčinu C5. Nezávislé actual review
b87ccf60…ad3e8/recovery reviewbdfba6d9…5ba82. Podle pravidla stagnace žádný další
C5 retry v tomto cyklu. Před návratem jiná omezená strategie, beze změny oracle.
[Paket a původní FAILy](review/2026-10-07-STUDIO-D1-ENTRY.md).

### C6 — známý Gemma53 korpus po C1/C3 (COLLECTION_COMPLETE; QUALITY_NO_GO)

Clean7ef8efba, původní runner/korpus/rubrika, exactGemma4:26b08ae…12a68/4K.
3×53 dne7.10.,18:13:42–18:29:45UTC, každá série exit0, bez retry/ladění/čtení
odpovědí mezi sériemi.421 úplných generování (159A+262B),0D1; stejné config
fingerprint1612badd…14f5. Technické review4a21b2f3…eb46 PASS_WITH_LIMITS:
423hash refs,698HTTP requests,33schválených efektů(12read/21write),0předčasných
změn/efektů,3integrityPASS na vlastních kopiích DB. Původní DB se při review neotevírají.
Dva nezávislí hodnotitelé přečetli všech159B v kontextu a vykonali12Pythonbloků;
156značek se shodovalo,3neshody oba hodnotitelé vyřešili bez ROOT sebe-přejímky.
**118/159 (74,21%) užitečných,24/159 (15,09%) zastavení,0kritických.**
Série39/40/39 užitečných a8/7/9 zastavení; konsenzusece4195e…93395.
41neužitečných:21vzniká ve výstupu save interpretu,20v odpovědi; tento původ
neodděluje schopnost modelu od aplikačního promptu. Rozpad rodin a159značek v paketu.

B warm n156 medián2218ms/p953798ms, cold n3 medián15096ms. Pozorovaná latence
hostu, ne izolovaný benchmark. Původní runner nemá continuous GPU/lifetime
monitor. Final3 cleanup **FAIL**, zmizelý PID1359590 **UNKNOWN**; samostatný
pozdější leased postflight3empty PASS tento FAIL nepřepisuje.
Historických123/159 není kontrolovaný příčinný baseline C3 (jiný zdroj i posudek).
Stagnace pokračuje: další krok je kontrolované porovnání rolí/příčin se stejným
promptem/schema/4K a negativními kontrolami, nikoli další nedoložený regex/prompt.
Známých53 není H1/H2; finální přejímka zůstává na novém holdoutu.
[Paket C6](review/2026-10-07-CHAT-REGRESSION-C3.md).

### C7 — zdroj při opakovaném doptání (SOURCE_REVIEW_PASS; LIVE_PARTIAL_FAIL)

BASE cd3b8f02 →1c7617a2: ASK_USER zachová již uložené source/user/project ID
pouze při aktivním pokračování ve stejném projektu; modelová provenance se
nepřebírá. Původní „ano“ AMBIGUOUS .5 ztrácelo core save kontext i po restartu.
Řízený RED to reprodukoval, oprava má38CPU PASS včetně skutečné HTTP/restart/
přesné approval cesty a devíti handler→resolver kontrol. Source/evidence review
ee5b34a5…abe3c a čistá integrace19PASS/review777478be…d0f. Původní CI1c skončilo
cancelled při20min apt timeoutu, rerun403; není to PASS. Následný společný
C7+C8 e6b83884 má vlastní integraci19PASS a CI37680691150 všech18SUCCESS.

Cílený živý sběr e6b83884 zastaven po první ze tří plánovaných sérií.
7.10.20:26:18–20:26:39UTC, čtyři známé případy,7úplných Gemma4/4K volání,
runner exit0. Praktický výsledek **FAIL**: po „photo.md“ další doptání,
0proposal/approval/file effect. Klasifikátor obdržel původní write pending,
ale vrátil continuesPending:false; save interpret dostal samotné photo.md
s dostupnou původní odpovědí. Nejde o důkaz ztráty všech core ID ani úspěch3/3.
Cleanup selhal na novém gpu-discover procesu po potvrzeném unload; okamžitý
postflight také FAIL. Pozdější3prázdné metadata vzorky20:35:24–27UTC jsou
samostatné pozorování bez lease, nikoli přepsání FAIL ani admission pro další
běh. Série2/3 NOT_RUN; další actual se v tomto cyklu nespouští.
[Paket C7](review/2026-10-07-CHAT-SAVE-CONTEXT.md). Celkové C6 skóre se nemění.

### C8 — provozní provider chyby (SOURCE_AND_EVIDENCE_REVIEW_PASS)

BASE1c7617a2 → **e6b83884417b066e9d9b40286350255ee3dd4b30**, publikováno a remote
ověřeno. Samostatný řízený M1 RED doložil HTTP502, socket před hlavičkami a
přerušené200tělo jako chybné HTTP200/status ok/uložené doptání. Oprava propaguje
bližší typed HTTP_ERROR/MALFORMED_RESPONSE jako existující500/CHAT_PROCESSING_FAILED,
samostatný UND_ERR_SOCKET jako503/LLM_PROVIDER_UNAVAILABLE. Zrušení má přednost;
invalidní obsah klasifikace uvnitř platné provider odpovědi stále fallbackuje.
Žádná nová importní hrana, prompt, model, retry ani schvalovací pravomoc.
CPU overlay41PASS, finální přesný test6PASS; skutečná čistá integrace19PASS
zahrnuje aktuální context41PASS. Independent review15e0b54c…0ffbc a execution
c8e8460d…93b4f; CI37680691150 všech18SUCCESS. Pět DB kopií potvrzuje po restartu
jen user v chybných konverzacích a žádný nový efekt. Interní user m7.status
zůstává ok; tento cyklus neopravuje samostatnou M7 sémantiku ani všechny
404/empty/binding/queue chyby. C5 přesná historická výjimka stále UNKNOWN.
[Paket C8](review/2026-10-07-CHAT-TRANSPORT-FAILURES.md).

## Přijaté dílčí výsledky

| Oblast | Doložený výsledek | Omezení |
| --- | --- | --- |
| Ledger / TaskFlow | CODE → přesné M2 → oracle → commit → restart, review PASS | Malé projekty; obecná úspěšnost CODE neprokázaná |
| SQLite | APPLICATION_ACCEPTANCE_REVIEW_PASS; 7 modulů, 8 965 B | n=1; DB mezi procesy v jednom sandboxu |
| Packaged IDE Ledger | 6 generací; approval/oracle/commit/durable M2 | DOM kliknutí; fyzická dostupnost ovládání otevřená |
| M3 / Worker | Izolace, původ dat, skutečný 5min worker/restart/čistý stop | Kvalita expertise, souběh a delší stabilita |
| AST / GPU panel / Cleanup | Omezené AST review, panel V7 a 3 vlastní refs přijaté | Hunt/model acceptance a cizí/evidence checkouty zachované |
| M6 data | Full109 backup → CLI restore → restart, review PASS | n=1, DB; project/config/skills restore otevřený |
| Kopírovaná cache / upgrade | Původní 56→forcedFAIL80→restore56→109, review PASS | n=1; samostatný C4 fresh5 přezkoumán, release otevřený |
| C4 původní fresh5 | b959a468, všech5 programů PASS, nezávislé evidence review PASS | n=1/4K/Qwen; celý M6, modelová kvalita a Studio→D1 otevřené |

[SQLite export](../examples/generated-apps/sqlite-catalog/README.md), [24 přijatých modulů](../examples/generated-apps/README.md).
BE restart SQLite dokládá durable M2/zdroje; nedokládá DB v dalším novém sandboxu.

## Společný kandidát a kontroly

Aktuální produktový zdroj **e6b83884**: C7+C8, context41PASS, původní CHAT7/CODE12
19PASS, nezávislé execution review a [CI37680691150](https://github.com/Belphareon-bak/intentsmith/actions/runs/37680691150) všech18SUCCESS.
Následující starší celé profily patří svým přesným SHA; celý410profil se po C7/C8 neopakoval.

Zdroj cache opravy a přijatého upgradu: **0d86b68e**; [CI37460776179](https://github.com/Belphareon-bak/intentsmith/actions/runs/37460776179), všech 18 kroků SUCCESS.
CHAT 7 / CODE 12 kontroly zachované; merge 56138e4f obsahuje CHAT e066956b / CODE32k / D1.
CHAT checkout 6. 10. ověřený clean e066956b; produktovou logiku CHATu ROOT neměnil.
Historický ROOT offline/database profil **86dbca40: 410 PASS / 0 FAIL / BLOCKED / TIMEOUT**,
5. 10., 04:44:14–04:54:05 UTC; report a5a2f4a3…326d11c, všechny řádky/logy nezávisle ověřené.
Data 24/24, M1 kontrakt 74/74; tento starší profil necertifikuje cache opravu ani release.
Historický doc/artifact gate160 PASS patří ROOT. Aktuální CHAT census src688/237206, tests604/270539; revidovaný graph1512/3cykly28.
Studio bundle 7bf62455…bfe24 / instalovaný BE c84b88cd nezměněné; žádný deploy ani aktivace.
Externí c5309a0/bundle místně chybí; jeho výsledky nejsou přijaté místní důkazy.

## Historický přijatý ROOT runtime milník: cache oprava a skutečný upgrade

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
| Přirozené plánování | C5 v5 po opraveném ovladači odeslal vstup; GPU monitor FAIL před úplnou odpovědí, D1 NOT_REACHED. Stagnace: žádný další retry v tomto cyklu |
| M1 outage | C1 `1f098912` source review a řízené HTTP/restart PASS; testovaný `b9cfc7c5` full410/CHAT7/CODE12/CI PASS; ROOT převzal e15264f1; C4 fresh5 b959a468 5PASS/review PASS |
| Chatová kvalita | C6 úplné3×53/dva posudky NO_GO; C7 oprava context/restart CPU přijatá, živý save i cleanup první série FAIL; další2 NOT_RUN. Oddělit návaznost a save interpretaci |
| Providerové chyby | C8 tři další false-ok větve opravené; context41/integrace19/CI18 PASS, source/evidence review PASS; interní M7 stav a ostatní error kategorie mimo rozsah |
| Mobil | Chybí conversation.create; implementace a device přejímka až po stabilním IDE/BE |
| Hunt | Potřebujeme nový grading report/cestu a vlastníka pokračování; ROOT cizí hodnocení nepřebírá |
| H1 custody | Čeká volba veřejného GPG fingerprintu pro zašifrované výstupy nebo privátní raw custody u operátora, poté dešifrování těsně před společným oknem; sběr NOT_RUN |

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

1. C4 původní fresh5 na b959a468: **5PASS/review PASS**. Historický90/3PASS2FAIL zachovaný.
   C5 uzavřít jako přezkoumaný FAIL; další strategie nesmí pokračovat řadou retry aparátu.
   C6 známá regrese74,21%/15,09% NO_GO; C7/C8 produktové opravy přijaté v uvedeném rozsahu,
   první cílený živý save stále FAIL. Další cyklus oddělí návaznost/interpretaci na známých
   vstupech při stejném promptu/schema/4K a negativních kontrolách. Širší M6/release otevřený.
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
H1 plaintext odstraněn; sběr obou kandidátů připravuje tento ROOT, zaslepení
a předání hodnotitelům provede operátor. Obsah ROOT nečetl.
[Datovaný archiv](https://github.com/Belphareon-bak/intentsmith/blob/0d86b68ef94bfd260dfb6f06d2231d14865dc9f1/docs/WORK-PROGRESS.md).

### Předání 7. 10. — převzetí ROOT a příprava H1

BASE `e15264f1` (předchozí ROOT `a61fe70d`). C1 je převzat fast-forwardem;
C2 diagnóza i experiment mají oddělené review. D1 časová podmínka výslovně
zrušena; jeho existující implementace `8fe6fb53` potřebuje Studio důkaz.
Při tomto historickém předání C3 ještě neměnil produkt; následný výsledek je výše. H1 kampaň a příkazy jsou v aktualizovaném
[handoffu](review/2026-10-02-CHAT-HOLDOUT-HANDOFF.md); sběr NOT_RUN.
Šifrovaný H1 zůstal beze změny, plaintext odstraněn ověřeným přesným unlinkem;
nejde o zaručené fyzické vymazání ani důkaz, že dříve nemohl být čten.
Heslo vlastní pouze operátor, nový plaintext se připraví až k běhu.
Read-only audit obou frozen runnerů dokončen druhým workerem; finální review
tohoto dokumentačního cyklu **READINESS_DOCS_REVIEW_PASS**
([receipt](review/evidence/chat-holdout-window-20261007/review.json)).
Dva původní P2 (přepis logu a cleanup při přerušení) opraveny a znovu přezkoumány;
finální doc/artifact kontrola 160 PASS, diff check exit 0. CPU runner kontrakt prošel na obou přesných
SHA (syntetický corpus, 0 model calls); instalace frozen lockfilu, SQLite ABI
a bwrap PASS. [Readiness včetně příkazů/hashů](review/evidence/chat-holdout-window-20261007/readiness.json).
CHAT checkout je čistý detached c7f03d56, závislosti patří frozen lockfilu;
ROOT vývojový checkout tím není přepínán. Po sběru návrat na CHAT větev vyžaduje
obnovení jejího novějšího lockfilu, nikoli předpoklad shodných závislostí.
GPU okno není otevřené a žádná inference neproběhla. Raw evidence také obsahuje
kopie H1; výběr jejího předání (šifrovaný balík / soukromě operátorovi) byl
vyžádán před dešifrováním a zůstává PENDING. Fresh5/Studio má vlastní sériové GPU okno; na dosud neotevřené H1 okno
časově nečeká a inference se nepřekrývají. HTTP 13. CODE volání a Fan rozšíření zůstávají mimo současné
rozpočty; vyžadují konkrétní operátorské rozhodnutí před jejich spuštěním.
