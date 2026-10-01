# WP — význam požadavku na uložení a trvalý zdroj

**Autorita:** explicitní review a zadání operátora z 1. 10. 2026;
`PRODUCT.md` §2/§3, `CONTRACT.md` §4/§7. **Stav: IMPLEMENTATION_IN_PROGRESS.**

Vstup: pushnutý integrační `4cbb4b55`. GitHub main ověřen jako `838b8cee`;
jde o pokračování stávajícího integračního WP, jehož přijaté opravy zachováváme.
Soukromý checkout repeat-merge-trial byl čistý a přepnut na novou větev;
nevznikl další worktree. Produkční checkout, DB, procesy a GPU se nemění.

Výstup: model s kontextem vyloží přirozený požadavek na soubor. Jádro ověří
typovaný plán, konkrétní cíl z uživatelského vstupu, zdroj podle trvalého ID,
projekt, přesné bajty a podporovaná omezení. Složené shrnutí→uložení vytvoří
samostatný trvalý obsahový zdroj a následně navrhne M2 schválení zápisu.
Seznam povolených formulací a jednotlivých jazykových výjimek se odstraní.
Požadavek vytvořit pouze nový soubor používá samostatný atomický `file.create`
z paralelního WP; bez této schopnosti se nesmí změnit na přepis.

Vlastněné: `src/chat/handlers/file.js`, nový interní významový resolver,
`src/chat/conversation-store.js`, callback v `src/chat/controller.js`,
`src/chat/response-finalizer.js`, routing v `src/chat/cre-decision.js` a
`src/chat/handlers/project.js`, jejich
testy a registrace. Zakázané: tool/effect/provider/schema (atomic WP),
specialist/expertise/runtime (VAT WP), produkční data, mobil, cizí změny.

Ověření: řízený lokální provider + skutečné M1 HTTP + soukromá SQLite.
Pozitivní: zdvořilé a složené požadavky, doslovné bajty, trvalé ID při opakování
po schválení a restartu, shrnutí navázané na původní ID. Negativní: model si
vymyslí cíl/obsah/ID, nejasnost, další nepodporovaný efekt, změna projektu,
neoznačený zdroj, zrušení a useknutí generace. Každý zápis čeká na schválení.
Testy ověřují obsah a skutečné soubory, nejen názvy a transport.

Stop: nesoulad konkrétních hodnot, nedostupný model nebo nepodporované
omezení skončí cíleným upřesněním bez ToolRequest. Offline fixture není
důkaz kvality významového výkladu. Po review následuje krátký živý vývojový
pilot, teprve potom zmrazení a finální 53×3 bez úprav mezi opakováními.

## První kandidát a pozorování

Řízený M1/SQLite test na předchozím source `4cbb4b55` (test-only baseline
`e6e9aa05`) selhal **0/1**, přímo na zdvořilém uložení. Testovací checkout byl
obnoven čistý. Nový source má stejné skutečné HTTP průchody **1/1 PASS**;
opakované uložení s projekty a restarty **1/1**, původní C15/CRE **26/26**,
M2 effect **39/39**, M2 production **22/22**, WS **93/93**, izolovaný writer
harness **6/6 PASS**. Soukromé logy `semantic-*.log` patří tomuto checkoutu.

HTTP odhalilo ještě skutečný routing: zdvořilost přebila souborový cíl a
`summary.md` spustil status shortcut. Konkrétní souborový token nyní vyžaduje
modelovou arbitráž; filename nevytváří autoritu. Původní vstup se nemění.
Technické návrhy a potvrzení mají trvalý typ `protocol`; obsah má `answer`.
Jádro načte přesné ID poslední obsahové zprávy z SQLite i po kompakci či
mnoha potvrzeních. Neznámý/cizí nejnovější obsah stále tvoří bariéru.
Shrnutí je samostatný dokončený obsahový zdroj, s původním ID a vlastním ID;
netvrdí M1 terminal success ani provedení zápisu. Před návrhem M2 se znovu
ověří projekt a bajty. Preview zobrazuje obsah a zda zápis může přepsat cíl.

Stav prvního kandidáta: **CHANGES_REQUIRED / LIVE_PILOT_FAIL**. Modelové semantic labely
nejsou důkazem správné interpretace negace a doménových podmínek. Offline
fixture je konkrétní plán; fyzický pilot musí ověřit skutečné odpovědi,
obsah návrhů a dodržení požadavků. Atomické create-only zatím čeká na svůj
oddělený přijatý source; neznámý tool nikdy nepřejde na `file.write`.

## Oprava po nezávislém review a fyzickém pilotu

Čistý kandidát `b67eb312b0e8da97030345315fda6660e3005b6b` měl registrovaných
6/6 PASS (`2026-10-01T06-26-04-687Z/report.json`). Nezávislé review přesto
prokázalo dvě chyby skutečným M1/SQLite průchodem: číselné metadata
`saveSourceEligible: 0` se v SQL chybně přeskočilo jako známé `false`,
a platný JSON ukončený `finishReason: length` připravil návrh zápisu.
SQL nyní rozlišuje JSON typ `false`; neznámá hodnota tvoří bariéru.
Resolver useknutý plán odmítá před parsováním. Oba případy jsou v reálných
HTTP regresních testech a vyžadují nulový počet ToolRequest.

Krátký fyzický pilot `save-content,save-content-first,save-content-again`
na tomtéž SHA použil skutečný `qwen3.5:27b`, digest
`7653528ba5cba4dd8e19da24aaddc7f4d0b5ecd93571c0825dfd4137958ec06e`.
První obsahová odpověď vznikla, oba požadavky na uložení však selhaly:
model vybral správný cíl a ID, ale vyplnil zbytečné `source.text` prázdným
řetězcem místo `null`. **0/2 úspěšných uložení**; HTTP 200 a exit 0 runneru
nejsou produktový PASS. Soukromé `initial-results.json` má SHA256
`e9be9fd6f65a4293738ba6101bea68058826b06158c6b657d017d37f5e5d3812`.

Zdroj je nyní diskriminovaný kontrakt: `{kind:answer,messageId}` nebo
`{kind:literal,text}`. Každá varianta obsahuje pouze potřebná pole;
ověření konkrétního ID a přesných bajtů zůstává povinné. Nejde o další
jazykovou výjimku. Přímé M1 testy po těchto opravách mají 1/1 + 1/1 PASS
(`semantic-fixed-http.log`, `semantic-fixed-repeat.log`). Nový čistý
kandidát čeká na nezávislé review, registrované opakování a nový fyzický
pilot. Finální 53×3 stále **LIVE_NOT_RUN**.

Další nezávislé review celého `4cbb4b55` → `70b78597` našlo dva skutečné
M1/SQLite návrhy neověřeného cíle: opakovaný citovaný `ghost.md` poskytl
cíl pouze uvnitř obsahu; odstranění `"PAYLOAD"` z `notes"PAYLOAD".md`
dokonce vytvořilo neexistující původní token `notes.md`. Výsledek celého
review je proto **CHANGES_REQUIRED**, i přes 8 registrovaných PASS.
Resolver nyní maskuje všechny přesné citované výskyty zdrojových bajtů
whitespace stejné délky. Nevznikají spojené tokeny a žádný z těchto výskytů
neposkytuje autoritu cíle. HTTP regrese obsahuje oba původní případy,
smíšené uvozovky a pozitivní opakování při samostatném výslovném cíli.
Původní dvě privátní reprodukce zůstávají uchované jako red evidence.

### Vývojový pilot b2 a výběr doslovného zdroje podle ID

Na čistém `b2cbff96` proběhlo devět vývojových případů F06/F10/F12
(žádné inference nad F14–F20). Opakované uložení odpovědi opět zachovalo
přesné bajty ve dvou schválených souborech. Čtyři běžné literal žádosti
selhaly, protože model do `source.text` zahrnul i uvozovky; typo varianta
skončila otázkou. To je **LIVE_PILOT_FAIL**, nikoli úspěšná přejímka.
Report je `chat-resilience-b2cbff96/runs.json` v soukromých artefaktech.

Literal kontrakt nyní používá `{kind:literal,literalId}`. Jádro lexikálně
vymezí citované úseky nezměněného aktuálního zadání, nabídne jejich ID a
obsah; model pouze vybere ID. Jádro z daného úseku vezme přesné bajty,
nikdy modelový přepis obsahu. Počet přípustných formulací se tím nemění.
Únik cíle z literal dat stále odmítá maskování všech odpovídajících
obsahových spanů. Po nalezení cíle navíc musí tentýž úsek původního vstupu
přesně odpovídat cíli; maskované mezery tak nemohou vytvořit novou cestu.
Nezávislá třetí repro takové cesty na `b2` zůstává uchována.

HTTP regrese stále ověřuje původní pozitivní doslovné bajty, samostatný
cíl při opakovaném obsahu a všechny původní nepřípustné cíle; přidává
modelově zvolenou cestu s maskovanými mezerami a neznámé literal ID.
První přímé opakování má **1/1 PASS** (`semantic-literal-ids-green.log`).
Nový kandidát zůstává **REVIEW_PENDING / LIVE_NOT_RUN**; poslední přijatý
celý CHAT ještě neexistuje a finální 53×3 stále čeká.
