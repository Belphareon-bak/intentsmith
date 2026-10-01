# WP — účetní DPH přes skutečný M1 HTTP chat

**Dodatečné review `12b7726a`: `CHANGES_REQUIRED`.** Negativní účetní
HTTP/SQLite cesta i veřejný filtr `extractedParams` prošly, ale při selhání
generativního wrapperu se původní raw tag vracel do M1 jako úspěch.
Překladatel navíc v `toolResults` zveřejňoval celý zdrojový text už při
úspěchu. Integrační oprava nyní vyřazuje raw fallback, používá typovanou
503/502 chybu a pro ostatní specialistické výsledky zveřejňuje jen typ;
strukturovaný VAT výsledek zůstává beze změny. Red-first HTTP testy pro
provider 503 a truncation byly před opravou FAIL, po ní jsou PASS. Nová
revize a čistý registrovaný běh ještě chybí.

**Následné integrační ověření 1. 10. 2026, 00:16 UTC:** společný commit
`033afd47` prošel registrovanými sadami účetního, překladatele a
specialistického followupu **3/3**, dále dokumentační a M1 sadou **2/2**.
Nezávislá revize však vrátila `CHANGES_REQUIRED`: `status:'error'` z
fail-closed účetního dokumentového nástroje směl pokračovat do generativního
wrapperu a veřejné `extractedParams` mohly obsahovat celý text překladu či
dokumentu. Přesný skutečný negativní M1 pokus na `033afd47` vrátil HTTP 500
`CHAT_PROCESSING_FAILED` po jednom provider volání; v tomto pokusu tedy
**neodešla** falešná odpověď `SUCCESS`, ale uživatelská chyba a zbytečný
modelový fallback jsou vady. Na lokální opravě stejný řízený HTTP/SQLite
scénář vrací HTTP 200 s `executionStatus: FAILED`, kódem
`M3_SPECIALIST_TOOL_PREPARATION_FAILED` a **0** provider volání. Úspěšný
deterministický dokumentový tah i překladatel mají veřejné
`extractedParams` nepřítomné; přesné čtyři skalární parametry VAT zůstávají.
Přímé testy účetního **2/2**, ostatních specialistických hran **3/3**,
M1 kontraktu a dokumentační validace prošly. Finální commit, čistý
registrovaný průchod a opakovaná nezávislá revize opravy ještě čekají.
Fyzický účetní model je stále **LIVE_NOT_RUN**.

**Integrační checkpoint 1. 10. 2026, 00:00 UTC:** izolovaný kandidát
`48364ff5` získal omezené nezávislé `REVIEW_PASS` a byl sloučen jako
`8e52c69a`. Integrační kontrola doplnila další ztracený údaj téže hranice,
`executionStatus: SUCCESS`, a negativní mutaci jeho absence. Před opravou
nová aserce skončila **0/1**, po ní prošel skutečný HTTP/SQLite test **1/1**;
M1 kontrakt **73/73**, překladatel **1/1**, specialistický followup **1/1**
a dokumentační validace **160/160**. Přesný nový integrační commit a
nezávislá revize doplňku `executionStatus` ještě čekají. Generický
`extractedParams` zvětšuje veřejná metadata i pro jiné specialistické
nástroje; před mobilním kontraktem je třeba rozhodnout o allowlistu či redakci.
Fyzický účetní modelový výpočet zatím **LIVE_NOT_RUN**.

**Historický stav izolovaného kandidáta:** **REVIEW_PENDING**.
Deterministický řízený provider běh prošel 1/1; fyzický model, UI a release
nejsou tím ověřené.

**Autorita a vstup:** operátor výslovně žádá skutečný chatový test specialisty
`accountant-cz` s částkou 10 000 Kč, sazbou 21 % a rokem 2025. Vstupní čistý
integrační commit je `c815ec435f69b4a52b30ab2f96da65136890d3c6`.
Produktový důkaz na uživatelské hranici plyne z `PRODUCT.md` §2 a
`CONTRACT.md` §4; práce navazuje na specialistickou M1 cestu ve
`WP-CHAT-SPECIALIST-FOLLOWUP-20260930.md`. Vlastní větev:
`work/chat-accountant-http-20261001`.

**Vlastněné cesty:** `tests/chat-accountant-model-contract.test.js`,
`src/chat/handlers/expertise.js`, tento WP, jediný nový záznam v
`tests/registry.json`, jeho generovaný derivát
`docs/convergence/TEST-REGISTRY.md` a mechanické počty v `README.md` a
`SYSTEM-MAP.md`.
Zakázány jsou jiné pracovní stromy, běžící služba a její DB, GPU/Ollama,
modelové vazby, daňové sazby a ostatní účetní balíček.

**Cesta a orákulum:** test spustí vlastněný `src/server.js`, privátní SQLite,
projekt a loopback provider. Přes HTTP zjistí a zvolí `accountant-cz`, pak
odešle `ConversationCommand` do `POST /api/chat`. Manifest mapuje tento
balíček na runtime expertizu `accountant`. Nástroj
`accountant.vat_calculator` musí z aktuální věty vytěžit přesně
`{amount:10000, year:2025, rate:'21', direction:'add'}`. Jeho strukturovaný
výsledek i podklad v závěrečném provider requestu musí uvádět základ 10 000,
DPH 2 100 a celkem 12 100 Kč, sazbu 21 %, směr `add` a rok 2025. Jediná
provider odpověď s přesnými částkami, předpoklady, nezahrnutým rozsahem a
účetním disclaimerem musí beze změny projít do M1 HTTP odpovědi a dvou
trvale uložených zpráv. Session po tahu drží zvolený `accountant-cz`.

**Red-first nález:** na nezměněném vstupním zdroji test skončil 0/1:
`response.metadata.specialistTool` bylo `undefined`. Specialist runtime
správně předal raw tool tag, ale `wrapWithExpertisePersona` při generativním
zabalení nepřenesl `specialistTool` ani `extractedParams` do finální M1
odpovědi. Kandidát přenáší tato dvě existující metadata spolu s již
přenášenými `toolResults`. Negativní mutace odmítají nesprávné DPH, sazbu
v parametrech a chybějící strukturovaný výsledek v provider promptu.

**Příkaz cíleného ověření:**

```sh
/home/belphareon/.nvm/versions/node/v24.21.0/bin/node --test tests/chat-accountant-model-contract.test.js
node scripts/validate-test-registry.js --json
git diff --check
```

**Stop condition a hranice důkazu:** test dokládá jeden vybraný účetní
výpočet v izolované M1 HTTP cestě s řízeným providerem. Nepotvrzuje daňové
poradenství v libovolném zadání, fyzický model, účetní workflow s doklady,
restart session, mobilní klient ani obecnou produkční připravenost.
Nezávislé review a opakování na sloučeném commitu jsou samostatné brány.
