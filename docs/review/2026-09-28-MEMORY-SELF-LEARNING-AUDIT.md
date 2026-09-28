# IntentSmith: jak skutečně funguje paměť a self-learning

**READ-ONLY AUDIT / FINDINGS_OPEN.** Navazuje na dokončené [předání obecné kontroly intentu](2026-09-28-INTENT-GROUNDING.md). Audit nemění nastavení, produkční DB ani implementaci učení. Zdroj kandidáta je `dd51f54c`; běžící proces PID 2035 používá release `72247a4983abcb12d42f6da6cc5b27af8f2212fd`, Node 22.21.1 a DB `/home/belphareon/Projects/intentsmith/data/c3.db`.

## Přímý závěr

Operátorská revize věrohodnost tohoto auditu potvrdila. **Následná samostatná změna 28. 9. v 08:49:02 UTC:** automatické chatové učení je vypnuté přes `learningEnabled=false`; historie, context a LTM čtení zůstávají zapnuté. [Výsledek, zachování ostatních nastavení a rollback](2026-09-28-INTENT-REVIEW-ROUND2.md#4-paměť). Níže uvedené read-only snapshoty a stav nastavení popisují okamžik původního auditu, před tímto zásahem. Nálezy implementace zůstávají otevřené.

Paměť ukládá historii, pracovní stav projektu, poznámky, opravy, preference a některé odvozené vzory. Self-learning zde upravuje uložená data a kontext pro příští odpověď/plán; v těchto cestách jsem nenašel trénování vah LLM.

Současné zapojení má podstatné mezery: běžná odpověď nepředává připravené korekce LTM do modelového promptu; česká negativní zpětná vazba se může stát pozitivním signálem; uložené chatové vzory nemají produkčního konzumenta. M4 má funkční schválení, rollback a předání kontextu plánovači, ale jeho producent pozorování a vyhodnocovač výsledků nejsou v nalezené produkční kompozici volané. Zelený řízený test této smyčky není důkazem automatického provozu.

## 1. Živý stav a metodika

SQLite jsem otevřel s `mode=ro` a `PRAGMA query_only=ON`, počty četl v jedné transakci. Nečetl ani nepublikoval jsem obsah soukromých zpráv. Snapshot **2026-09-28 06:36:04 UTC / 08:36:04 Europe/Prague**:

| Úložiště | Počet | Co z toho plyne |
| --- | ---: | --- |
| `conversations` | 48 | Konverzace jsou trvalé entity; samotný počet není velikost modelového kontextu. |
| `messages` | 2 | Aktuální řádky hlavního message store, nikoli celý historický archiv. |
| `memory` | 28 | 27 `pattern`, 1 `preference`, všechny `inferred`; vytvořeny 2.–22. 8. 2026. |
| `memory` s `user_id` začínajícím `chat-scope-v1:` | **0** | Staré LTM záznamy nejsou nově scoped pamětí chatu. |
| `project_memory` | 12 | Všechny kategorie `system`; poslední záznam 19. 9. 2026. |
| `task_memory`, `specialist_memory`, `expertise_memory`, `global_memory` | **0** | Bez uložené evidence v těchto tabulkách. |
| `learned_patterns`, `workflow_patterns` | **0** | Starší oddělená úložiště jsou prázdná. |
| M4 observations / proposals / outcomes / plan evaluations | **0 / 0 / 0 / 0** | Žádná zde uložená M4 smyčka ani schválený vzor. |
| `user_memory` | 1 | Samostatný JSON store z Memory API, nikoli automaticky LTM. |

Další read-only inventura našla **41 JSONL streamů konverzačního archivu, 283 396 B**, a **4 konverzace s uloženým souhrnem**. Malý počet řádků `messages` proto nedokazuje, že se historie neukládá. Archiv jsem obsahově neprocházel.

Aktuální paměťová nastavení nemají explicitní override. Skutečný [policy reader](../../src/db/user-settings.js) na read-only živé DB v **06:47:09 UTC** vrátil: `history=true, context=true, ltm=true, learning=true, feedback=true, patterns=true`. Defaulty jsou tedy zapnuté; prázdná scoped/M4 úložiště nejsou výsledkem zjištěného přepínače OFF.

Porovnal jsem SHA-256 **24 relevantních modulů** paměti, policy, feedbacku, M4, lifecycle konzumentů a kompakce s běžícím releasem: **24/24 mají shodné bajty**. Navíc jsem reprodukoval chybějící LTM v promptu přímo pomocí modulů běžícího releasu, Node 22.21.1, izolované DB a řízeného modelového callbacku. Živou DB jsem tímto testem nepoužil.

## 2. Jednotlivé vrstvy

| Vrstva | Jak se zapisuje | Jak se používá | Praktická hranice |
| --- | --- | --- | --- |
| Historie | `ConversationStore`: nejprve user turn, potom úspěšná finální assistant odpověď | Poslední tahy a případný uložený souhrn | Výpadek/zrušení nevytváří úspěšnou assistant odpověď. |
| Stav session a pracovní paměť | `SessionState`, `conversations.state`, `project_memory` s `wm:*` | Cíl, aktivní soubor, poslední artefakt, drift; projektový handler | `saveContext=false` potlačí tuto persistovanou pracovní paměť, nesmaže historické řádky. |
| Memory Bank | Projektové poznámky v `project_memory` | `buildContext()` -> projektový prompt; nejvýše 20 položek | Samostatná projektová vrstva, ne globální LTM. |
| Scoped chatové LTM | Opravy a naučené preference do `memory` | Preference se používají při syntéze výsledků nástrojů; korekce jsou připravené pro kontext | Níže doložená mezera při předání korekce do finálního promptu. |
| Chatové vzory | `PatternTracker.recordTurn()` sleduje sled záměrů, témata a úspěch nástroje | Záznamy a reinforcement existují | `getRelevantPatterns()` nemá nalezeného produkčního volajícího. |
| Task Memory | `recordFix()` má ukládat úspěšné/neúspěšné strategie oprav | Lifecycle build dotazuje předchozí opravy | Singleton nemá nalezené produkční `init(db)`; při `db=null` zápis vrací bez uložení. |
| M4 learning | Typed observation -> proposal -> uživatelské schválení -> append-only outcome | Schválený vzor stejného projektu doplní D1 SPEC prompt | Producent a evaluátor mají komponenty/testy, ale chybí nalezené runtime zapojení. |
| `user_memory` a `learned_patterns` | Starší Memory API / DB prepared statements | Nalezeno ukládání a definice | Nenašel jsem jejich zapojení jako zdroje běžného LLM promptu. |

Důkazy: [ConversationStore](../../src/chat/conversation-store.js), [Memory Bank](../../src/memory/memory-bank.js), [scoped chatMemory](../../src/memory/chat-memory.js), [TaskMemory](../../src/memory/task-memory.js), [lifecycle task-memory adaptér](../../src/planner/lifecycle-build.js), [Memory API](../../src/routes/chat.js).

### Historie a zkracování kontextu

Chat načte z DB posledních 10 tahů pomocí `buildHandlerHistory()`. Pokud existuje souhrn, přidá ho jako syntetický systémový tah a zahrne zprávy po jeho hranici. To není načtení celé historie do modelu.

[Auto-compact](../../src/chat/context-compact.js) běží na pozadí, výchozí práh je 75 % účinného kontextového okna, uchovává posledních 6 tahů a má 30s cooldown. Souhrn vytváří autorizované LLM volání, pak `setSummary()`; vstup omezuje na 50 starších tahů. On-demand summarizer v `buildBudgetedContext()` je stále `null`, ale samostatná background kompakce je skutečně zapojená. Uložené souhrny nejsou důkazem jejich faktické přesnosti.

Archivace, TTL, fyzické mazání a souhrny jsou oddělené mechanismy. [Retence](../../src/db/data-retention.js) umí archivovat nad 200 zpráv/konverzaci, odstraňovat staré archivované řádky a expirované LTM; [history drain](../../src/core/history-drain.js) ukládá JSONL mimo hlavní message tabulku. Vypnutí kontextu není smazání těchto dat.

### Scope a automatické chatové učení

`chatMemory()` odvozuje projekt z trvalého `conversations.project_id`, nikoli z modelu nebo dodaného `context.projectId`. Paměť sdílí konverzace stejného projektu; bez projektu je omezena na jednu konverzaci. Historické unscoped záznamy zůstávají uložené a nejsou automaticky přivlastněné novému projektu. Proto se nalezených 28 starých LTM záznamů nedá označit za aktivně používanou chatovou paměť.

[Pre-handler](../../src/chat/handlers/pre-handler.js) rozpoznává pochvalu, nesouhlas a opravu. Opravu ukládá jako `correction` s původním/corrected textem, intentem a provenance konverzace/scope, confidence 0.8. [Preference engine](../../src/memory/preferences.js) po 3 konzistentních signálech stejného response type změní nejvýše jednu osu: délku, strukturu nebo follow-up styl, a uloží preference s confidence 0.7. Neověřuje tím pravdivost opravovaného tvrzení.

Izolovaná sonda přes skutečný pre-handler pro tři `blbost` uložila `verbosity=detailed`; pět opakovaných CODE tahů uložilo dva vzory. Toto je skutečné ukládání dat. Automatický detektor je však heuristický: změna tématu se bere jako nepřímé přijetí předchozí odpovědi, i když to pravdivost nepotvrzuje.

LTM confidence exponenciálně slábne s `lambda=0.01/den`, poločas přibližně 69 dní. Reinforcement přidává 0.05, nejvýše do 0.95. LTM kontext má výchozí threshold 0.6 a nejvýše 10 faktů. `forget()` odstraní konkrétní řádek daného scope; TTL a retenční úklid mají vlastní cesty.

## 3. Konkrétní nálezy

### P1 — uložená korekce se nepředá běžné odpovědi

Sonda v kandidátu i v běžícím releasu vložila izolovanou scoped korekci `MEMORY_AUDIT_LTM_CANARY`. Skutečný `ChatController.handle()` připravil `ltmContext` obsahující canary. Skutečný `conversationHandler` a `handleAnswerDecision` však poslaly modelovému callbacku prompt bez něj:

```json
{
  "preparedLtmContainsCorrection": true,
  "finalModelPromptsContainCorrection": false,
  "modelCallbackCalls": 1,
  "finalIntent": "CONVERSATIONAL"
}
```

[ANSWER handler](../../src/chat/handlers/decisions.js) sestavuje prompt z `context.history` a projektového kontextu; připravené LTM nepřipojí. Nástrojový handler zavolá budget builder, ale z jeho výsledku použije `handlerHistory`; samostatné `ltmContext` a `summary` se tímto převzetím ztratí. `formatBudgetedHistory()` nemá nalezeného produkčního volajícího a samo formátuje pouze historii/souhrn. Preference jsou pro tool synthesis předávané jinou cestou; nelze z tohoto nálezu tvrdit, že veškerá paměť chybí ve všech odpovědích.

### P1 — český nesouhlas může posilovat nesprávný signál

Skutečný [feedback detector](../../src/memory/feedback-detector.js), se stejným předchozím ANSWER kontextem:

| Vstup | Zjištěný signál |
| --- | --- |
| `to je špatně` | **`positive_implicit`** |
| `blbost` | `negative_explicit` |
| `správně je 42` | `correction` |

Regex pro `špatně` končí ASCII `\b`; za koncovým `ě` zde očekávanou hranici slova nenajde. Následně nízký topic overlap spustí pozitivní fallback. Takto získaný signál není spolehlivým základem pro samočinné učení. Sonda změnu nevnášela do živé DB.

### P1 — M4 smyčka nemá nalezené automatické zapojení

[Producent](../../src/code-intel/learning-pattern-producer.js) umí přijmout typed úspěšný schválený `ProjectChangeResult`, vytvořit observation s digests a po **dvou odlišných schválených zdrojích** navrhnout projektový vzor. [Evaluátor](../../src/memory/learning-outcome-evaluator.js) umí porovnat přesně svázané plánové artefakty bez/při použití vzoru, uložit skóre, delta a evidence. V produkčním `src/**/*.js` jsem našel pouze jejich definice; vytváření a volání je v testech, nikoli v nalezeném runtime call graphu. Nulové živé M4 tabulky s tímto nálezem souhlasí, samy o sobě ale neprokazují jeho příčinu.

Je zapojený [learning service](../../src/memory/learning-application-service.js) a jeho authenticated projektové API pro review/approve/reject/weaken/rollback/delete. Konzument v [lifecycle routeru](../../src/chat/handlers/lifecycle-router.js) sestaví `ProjectLearningContext`, [D1 SPEC](../../src/planner/lifecycle-spec.js) jej skutečně přidá do promptu a validuje conformance. Mezera je na začátku a při automatickém měření výsledku této smyčky.

### P2 — zapisované vzory a task-memory nejsou úplný learning

`PatternTracker.recordTurn()` je zapojený do konverzace a výsledků nástrojů. Jeho `getRelevantPatterns()` nemá runtime volajícího a výchozí LTM context kinds zahrnují preference/style/project/correction, nikoli `pattern`. Zápis vzoru tedy nedokazuje jeho použití v příštím rozhodnutí.

`TaskMemory` je v lifecycle build adaptéru dostupná, ale singleton začíná s `db=null`, bez nalezeného produkčního `taskMemory.init(db)`. `recordFix()` za této podmínky jen vrací. Také `pattern-miner` nad task memory a cross-project learner mají implementace, bez nalezeného produkčního propojení. Nepovažuji je za doložené automatické učení mezi projekty.

## 4. Co M4 při skutečném použití dovoluje

Po schválení vznikne aktivní naučená položka pouze ve stejném projektu. [Typed adaptation](../../contracts/m4/learning-v1.js) deklaruje `changesPermissions=false`, `changesCode=false`, `changesConfig=false`; learning sám není oprávnění k efektu. Projektový kontext obsahuje nejvýše 16 položek s identitou, verzí, confidence, observation IDs a evidence digests.

Výchozí proposal producer nastavuje TTL 180 dní, confidence poločas 60 dní a floor 5000/10000. Při čtení se používá decayed confidence; položka může přestat přispívat do kontextu dřív než doběhne TTL. `weaken`, `rollback` a `delete` ovlivní její účinek. M4 `delete` je auditovaný outcome, nikoli fyzické vymazání všech proposals/evidence; historie měření zůstává.

Znovu spuštěný `m4-learning-journey-e2e.test.js`: **1/1 PASS**. Skutečné repository/service/startSpec komponenty projdou dvěma řízenými project-change receipts -> pending proposal -> explicitní approval -> doplněný prompt/conformance -> uložené porovnání -> rollback odstraní vzor z dalšího promptu -> delete zachová měřicí artefakty. Planner model je řízený callback a projektové receipts jsou testové vstupy. Nejde o skutečně změřené zlepšení reálného LLM ani důkaz, že server tuto smyčku automaticky produkuje.

## 5. Nastavení a praktický další postup

1. `intentsmith.memory.learningEnabled=false` vypne automatické chatové učení z preferencí/feedbacku/vzorů. LTM může dál číst již uložená data, pokud `ltmEnabled` a `saveContext` zůstávají zapnuté. Jde o rozumné dočasné nastavení do opravy detektoru; **živé nastavení jsem nezměnil**.
2. `intentsmith.memory.ltmEnabled=false` vypne scoped LTM v chatu. `memory.saveContext=false` potlačí persistovaný pracovní kontext a LTM, bez smazání historie. Přepínač `learningEnabled` je pro chatové učení; M4 má vlastní schválení a stavy, společné OFF přes tento flag v jeho cestách není zapojené.
3. `memory.saveHistory=false` dnes společný writer odmítne jako `CHAT_EPHEMERAL_UNSUPPORTED`. Již uložená hodnota false nebo neplatná policy zastaví chat `CHAT_PRIVACY_UNAVAILABLE`. Režim bez historie není hotový.
4. Priorita opravy: **finální prompt evidence pro LTM -> korektní české feedback signály a potvrzení preference -> zapojení M4 producenta/evaluátoru na skutečné schválené změny -> ověření, že uložený vzor mění další prompt a rollback jej odstraní**. Testovat finální prompt a durable source identity, nikoli pouze existenci řádku nebo zelený unit test.
5. Doplnit produktovou viditelnost: u naučené položky ukázat odkud pochází, kde se použila, její aktuální confidence, stav a rollback. O rozsahu opravy rozhodnout po revizi; tento audit žádnou z těchto dalších změn nepředjímá.

Alternativy: zachovat pouze explicitně potvrzené preference/poznámky; nebo dokončit řízenou M4 smyčku s měřením a revizí. Samotné automatické ukládání dalších vzorů neřeší zjištěnou chybějící spotřebu a chybné signály. Globální adaptace mezi projekty by vyžadovala samostatnou autoritu a scope, není tímto auditem přijata.

## 6. Lokální důkazy a reprodukce

Artefakty jsou pod `.intentsmith-artifacts/intent-baseline/`, nezměněná živá data nejsou součástí reportu:

| Důkaz | SHA-256 |
| --- | --- |
| `memory-live-readonly.json` | `bfd7d05e87522de95ddff0fc455d1d0faa3493df4ae13cc136804b2ad51e4d31` |
| `memory-extra-readonly.json` | `ec22e2673f01d31282ed61ffdd98e0b8e4707cd15239cb61b10ec79d56c93804` |
| `memory-runtime-byte-comparison.json` | `1d6298b94b6ee9e797151391dbd1a19a60793d0be752b97c82d3f5b74d6aa4f0` |
| `memory-runtime-prompt-probe.mjs` | `761ce55030108224f5c15f3e7961ffe72790d995c9eb444a105cbb8a56ad112e` |
| `memory-runtime-prompt-probe.json` | `64b8ec3d28803ce62050f4d518b56dac27b0e9c2eb6027bb6df06b5d3a8042e6` |
| `memory-m4-journey.log` | `62ededd4303628208f23abafad58c1ea7e6ed9d5bd064042643b8d48c0044d8c` |

Reprodukce sonduje skutečné moduly releasu s izolovaným test bootstrapem a invalidním providerem v konfiguraci. Modelový callback je nahrazen před zpracováním chatu:

```sh
source /home/belphareon/.nvm/nvm.sh
nvm use 22.21.1
OLLAMA_URL=invalid://memory-audit-no-provider node .intentsmith-artifacts/intent-baseline/memory-runtime-prompt-probe.mjs
nvm use 24.21.0
OLLAMA_URL=invalid://memory-audit-no-provider node tests/m4-learning-journey-e2e.test.js
rg -n 'createLearningPatternProducer|createLearningOutcomeEvaluator|taskMemory\.init|getRelevantPatterns' src --glob '*.js' --glob '!src/eval/**'
```

Pro tento audit nebyla provedena skutečná modelová inference, změna živé DB, přenesení historické paměti, aktivace M4, restart ani deploy. Dřívější incident během implementačního auditu je zachovaný v odděleném intent review reportu. Hodnocení faktické kvality souhrnů, širšího korpusu feedbacku a skutečného přínosu modelu zůstává **NOT_RUN**.
