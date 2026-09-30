# WP — dokončení odpovědi po výstupním limitu v živém chatu

**Stav:** implementační kandidát; deterministický M1 test PASS, opakovaný živý běh a nezávislá přejímka otevřené.

**Autorita a nález:** operátor 30. 9. 2026 žádá funkční chat a skutečné modelové testy. Sada `IS-T3-E2E-85-LONG-SESSION-DEGRADATION` na přesném čistém SHA `4a789bb1376504104698fe6f45f2f9e202000159` skončila `FAIL` (3/4): v první části při otázce „A co list comprehension?“ vrátil provider terminální `done_reason=length`, `eval_count=1200`, backend pak správně odmítl neúplnou odpověď HTTP 502. Soukromý běhový záznam je `.intentsmith-artifacts/run-suites/2026-09-30T17-31-23-783Z/report.json`. Ve stejné sadě prošla samostatná nová část naplnění a zkrácení okna; její `PASS` neznamená `PASS` celé sady.

**Změna:** `handleAnswerDecision` použije stávající nejvýše dva opravné pokusy při `finishReason=length` pro všechny své textové generace, tedy i inline `CODE` a projektový `PLAN` fallback. Každý pokus používá původní `maxTokens`, `num_ctx` a signál zrušení. Finální neúplný výstup nadále odmítá `finalizeChatResponse` před uložením odpovědi; cesta k efektovým nástrojům není součástí této smyčky. Nemění se model, vazby, tokenová autorita ani produkční DB.

**Důkaz a hranice:** `tests/m1-chat-contract.test.js` zkouší `CONVERSATIONAL` i `CODE`, úspěšný druhý pokus a vyčerpání všech tří volání. Kontroluje stálý budget/signál, úspornější opravný prompt, návrat celé odpovědi a nulový zápis při koncovém `MODEL_RESPONSE_TRUNCATED`. Na Node 24.21.0 vyšlo 35/35. Tento offline test neprokazuje, že živý model na opravný prompt skutečně odpoví v limitu. Po čistém commitu je nutné zopakovat identickou sadu 85 s `--capture-provider` a vyhodnotit celý výsledek; do té doby stav zůstává otevřený.
