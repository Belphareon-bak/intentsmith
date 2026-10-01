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

Stav kandidáta: **REVIEW_PENDING / LIVE_NOT_RUN**. Modelové semantic labely
nejsou důkazem správné interpretace negace a doménových podmínek. Offline
fixture je konkrétní plán; fyzický pilot musí ověřit skutečné odpovědi,
obsah návrhů a dodržení požadavků. Atomické create-only zatím čeká na svůj
oddělený přijatý source; neznámý tool nikdy nepřejde na `file.write`.
