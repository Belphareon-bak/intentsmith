# Přirozené plánování projektu: doložená závada a připravený postup

Stav 4. 10. 2026: **REPRODUCED / IMPLEMENTATION_NOT_RUN /
WAITING_HOLDOUT_COMPLETION_EVIDENCE**. Autorita je výslovné zadání operátora
ze 4. 10.: opravit chatový vstup do D1 **po dokončení sběru holdoutu**, na
jeho hodnocení nečekat. Zapečetěný holdout se nesmí číst ani používat k ladění.

Vlastní čistý výchozí HEAD `d86baa270c6abb69d72fe1412f98561fa1ffd5db`;
aplikační zdroj je shodný se zmrazeným kandidátem
`9591ea1b07bc4b639a102bcc421f9d46b8f9906b`. Pevná kandidátní větev zůstává
beze změny. Vlastní záznam skutečného holdoutu
`.intentsmith-artifacts/chat-quality-20261004/holdout/holdout-runs.json`
neexistuje. Inventura procesů nenalezla běžící sběr. To nedokazuje, že
holdout dokončil někdo jiný; tento stav je **UNKNOWN** a operátor dostal
cílený dotaz na dokončení/metadatový záznam. Poslední vlastní stav je NOT_RUN.
Syntetický dummy 3×3 ani původní exponovaná regrese 53×3 nejsou tento holdout.
Zakázaný adresář nebyl otevřen ani prohledáván.

## Důkaz současného chování

Přesná původní zadání pocházejí z read-only podkladu projektového workera
`fan-d1-studio-m2-controller-preparation-v4-20261002/d1-inputs.json`.
Nebyl použit prefix, `/m2-build`, ručně sestavený plán ani opravování zadání.
Nový nezávislý běh volal skutečný `projectHandler` → skutečný CRE; zachytil
typované gateway porty s kontrolovanými providerovými odpověďmi. Inicializace
vytvořila pouze vlastní izolovaný testovací projekt a DB. Po požadavcích je
revize projektu stejná; žádná inference ani efekt v projektu nenastal.

| Vstup | Skutečné rozhodnutí | Klasifikátor v handleru | D1 v handleru |
| --- | --- | --- | --- |
| Původní první přírůstek core | CREATIVE / ANSWER, deterministic | 0 | 0 |
| Původní druhý přírůstek CLI | CREATIVE / ANSWER, deterministic | 0 | 0 |
| „udělej mi sledování ventilátorů“ | CODE / TOOL_CALL, llm fixture, scope=project | 1 | 1, zastaven před inferencí |

Obě první odpovědi úspěšně vrátí běžný chatový text a žádný
`ProjectWorkProposal@1`. Oddělené přímé zavolání skutečného klasifikačního
bridge přijme kontrolovanou odpověď `CODE / project` pro všechny tři vstupy;
vstupy se při 4K CHAT rozpočtu vejdou celé. Neprokazuje to, jak je klasifikuje
živá Gemma. U krátkého třetího vstupu tato fixture dosáhne skutečného
`WORKFLOW_PLANNER`, `correlation.modelRole=D1` a projektového systémového
promptu; plánovač je úmyslně zastavený před providerem, takže plán nevznikl.

[Úplná reprodukce, přesné vstupy, hashe, role a rozhodnutí](evidence/chat-quality-20261001/planning-entry-before.json).
SHA-256 tohoto důkazu:
`6c9956d48d4e2cb59d17a4ae6063cba5fb63954227443d1df4310b085e116852`.
Privátní log/script: `.intentsmith-artifacts/chat-planning-20261004/`.
První diagnostika použila neúplný `sessionState={}` a selhala při návratu
odpovědi. Je zachovaná, není důkazem úspěchu. Opakování `entry-before-v2.json`
používá skutečný `SessionState` a kontroluje i vrácenou odpověď; tabulka a
publikovaný důkaz vycházejí pouze z tohoto opakování.

## Příčina a připravená oprava

1. `CREATIVE_IDEATION_PATTERNS` obsahuje obecné „navrhni“. V `decide()` je
   CREATIVE deterministická zkratka; u těchto dvou projektových zadání proto
   přeskočí kontextovou interpretaci. Projektový handler následně správně
   respektuje její označení jako přímou konverzační odpověď.
2. Dřívější regex pro tvůrčí psaní `vytvoř.*(báseň|příběh|text)` u CLI
   navíc najde `text` uvnitř `contextFiles`. Samostatná diagnostika slovních
   hranic toto falešné zachycení odstraní a zachová „Vytvoř mi text o přírodě“.
   Oprava hranic sama nestačí: obecné „Navrhni druhý přírůstek“ by stále
   skončilo v CREATIVE zkratce.
3. Stávající předání interpretace `responseScope=project` do read-only D1
   už funguje. Oprava má odstranit předčasné uzavření nejednoznačných
   projektových návrhů a předat celý nezměněný požadavek klasifikátoru.
   Jednoznačné tvůrčí odpovědi a běžný chat mají zachovat své chování.

Implementační rozsah po splnění časové podmínky: slovní/identifikátorové
hranice ve tvůrčím rozpoznávání a výběr kontextové interpretace v
`src/chat/cre-decision.js`; pouze podle prokázané potřeby odpovídající
projektový dispatch. Použije se existující D1 a M2 návrh, nikoli nový writer
nebo plánovací framework. Aktivní projekt není sám důkaz žádosti o změnu.
Obecná otázka, báseň, návrhy názvů a ukázka kódu mají nadále patřit do chatu.
Nejasnost může skončit cíleným dotazem; výběr D1 nesmí změnit původní cíl,
negaci či podmínku. Návrh souborů stále vyžaduje přesné M2 schválení.

Alternativy: rozšiřovat regex o „fan-monitor“ by pokrylo jednotlivý příklad,
nikoli přirozené projektové požadavky. Poslat do D1 vše v projektu by poškodilo
běžný chat. `/m2-build` zůstává platným pokročilým vstupem, ale nesplňuje
požadovanou přejímku přirozeného záměru. Tyto varianty nejsou zvolený postup.

## Ověření a předání

1. Z metadat potvrdit dokončení `holdout-1..3`, kandidáta, SHA corpus,
   neměnnost konfigurace a úplnost kroků. Výsledné odpovědi nečíst ani
   nehodnotit. Sběr může skončit i neúspěchem; nic se nepřeznačí na PASS.
2. Na následujícím kandidátu doplnit reprodukční testy skutečného
   ProjectHandler → classifier → D1 → úspěšný validovaný návrh. Obě původní
   věty musí dojít do D1 bez prefixu; test zkontroluje celý vstup, role,
   metadata, konkrétní návrh a nulové provedení před schválením. Negativní
   případy zahrnou obyčejný chat v projektu, tvůrčí text, ukázku kódu,
   podobné identifikátory, nejasný dovětek, negaci a podmíněné zadání.
3. Provést cílené projektové, CRE, kontextové, M1/M2 a importní regrese;
   poté přes skutečnou Gemmu CHAT a zachovanou roli D1 ověřit původní
   vstupy. Znovu spustit nezměněné chatové regrese 53×3 na novém pevném SHA.
   Porovnat odpovědi, zbytečná zastavení, efekty a latenci s C2. Samotné
   počty PASS nejsou významové ověření ani důkaz nezhoršení.
4. Commit/push a ověřený nový SHA předat projektovému workerovi/ROOT pro
   nový fan-monitor průchod přes D1. Jeho vstupy, freeze a chráněné oracle
   soubory zde neměníme. Dokončení jeho průchodu musí doložit on; tento
   diagnostický milník není hotová aplikace ani uzavřená přejímka.

**Následující krok:** získat metadatový důkaz dokončení skutečného sběru;
pak ihned implementovat reprodukované opravy, bez čekání na známky holdoutu.
