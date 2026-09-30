# WP — dokončení odpovědi po výstupním limitu v živém chatu

**Aktuální checkpoint 22:38 UTC:** nový živý běh sady 85 na `9c9fdd34`
odhalil opakování téhož CODE dotazu třikrát s `done_reason=length` a
`num_predict=1200`; v zaplněném 4K kontextu se stará úspornější instrukce
nevešla a opravné požadavky byly byte shodné kromě hodin. Izolovaná oprava
`22c369c3` získala omezené nezávislé `REVIEW_PASS` a je integrovaná jako
`0e0f48be`. Znovu skládá volitelnou historii kolem kratší systémové
instrukce pro oba opravné pokusy; úplný durable summary, aktuální dotaz a
chráněná nedávná oprava zůstávají. Integrovaná registrovaná M1 sada prošla
**1/1**, uvnitř **49/49** (`.intentsmith-artifacts/run-suites/2026-09-30T22-38-34-364Z/report.json`).
Nový živý modelový běh této opravy je **LIVE_NOT_RUN**. Přímý izolovaný
`npm run test:chat` skončil **50/52** při modelové `chat-pipeline` sadě
spuštěné bez GPU lease; tento běh není zelenou přejímkou a neprokazuje
regresi ani její absenci. Další ověření poběží přes registrované a
koordinované profily.

**Stav k 30. 9. 2026:** nezávislé omezené review `REVIEW_PASS`, deterministický M1 test 35/35 PASS a vývojový živý běh sady 85 PASS 4/4 na `0b0cabdba153b0bebfda8fc06a8a34da11766a30`. Release Gate 0 a plná auto-context přejímka zůstávají otevřené.

**Autorita a nález:** operátor 30. 9. 2026 žádá funkční chat a skutečné modelové testy. Sada `IS-T3-E2E-85-LONG-SESSION-DEGRADATION` na přesném čistém SHA `4a789bb1376504104698fe6f45f2f9e202000159` skončila `FAIL` (3/4): v první části při otázce „A co list comprehension?“ vrátil provider terminální `done_reason=length`, `eval_count=1200`, backend pak správně odmítl neúplnou odpověď HTTP 502. Soukromý běhový záznam je `.intentsmith-artifacts/run-suites/2026-09-30T17-31-23-783Z/report.json`. Ve stejné sadě prošla samostatná nová část naplnění a zkrácení okna; její `PASS` neznamená `PASS` celé sady.

**Změna:** `handleAnswerDecision` použije stávající nejvýše dva opravné pokusy při `finishReason=length` pro všechny své textové generace, tedy i inline `CODE` a projektový `PLAN` fallback. Každý pokus používá původní `maxTokens`, `num_ctx` a signál zrušení. Finální neúplný výstup nadále odmítá `finalizeChatResponse` před uložením odpovědi; cesta k efektovým nástrojům není součástí této smyčky. Nemění se model, vazby, tokenová autorita ani produkční DB.

**Důkaz a hranice:** `tests/m1-chat-contract.test.js` zkouší `CONVERSATIONAL` i `CODE`, úspěšný druhý pokus a vyčerpání všech tří volání. Kontroluje stálý budget/signál, úspornější opravný prompt, návrat celé odpovědi a nulový zápis při koncovém `MODEL_RESPONSE_TRUNCATED`. Na Node 24.21.0 vyšlo 35/35. Následný živý běh `2026-09-30T17-58-43-582Z` dokončil všechny čtyři části sady 85; zachycený CODE request č. 18 skončil `done_reason=length`, `eval_count=1200`, a opakování č. 19 skončilo `stop`, `eval_count=273`. Report `.intentsmith-artifacts/run-suites/2026-09-30T17-58-43-582Z/report.json` uvádí `runnerStatus=PASS`, `providerCapture.status=PASS`, 57 řádků a uvolněný GPU lease. Soukromý provider záznam zůstává mimo Git. Jediný modelový běh neprokazuje deterministickou spolehlivost ani release acceptance.
