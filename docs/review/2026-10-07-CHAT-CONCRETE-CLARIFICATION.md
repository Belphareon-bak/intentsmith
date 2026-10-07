# C3 — konkrétní otázka při nejisté klasifikaci

**Stav: SOURCE_AND_EVIDENCE_REVIEW_PASS / INTEGRATION_V2_PENDING.**
Autorita: přijatý WP-CHAT-QUALITY-20261001 (cílené doptání, původní zadání,
obnovení rozhovoru) a pokračující explicitní zadání operátora.
Aktuální deník: [WORK-PROGRESS](../WORK-PROGRESS.md).

- BASE `228caaf680002f062dabc47f65dd2b18aca84fc7`.
- Produkt a testy v2 `3bfebf98b8495c455d3193d22aaf2579afbf040e`.
- [Přesný diff v2](evidence/chat-clarification-20261007/product-and-regression-v2.patch).
- [Příkazy, exity, výsledky a hashe raw důkazů v2](evidence/chat-clarification-20261007/focused-v2.json).
- Zakázané vstupy pro implementátora/reviewera: H1/H2, `restricted/`, jejich
  raw logy, odpovědi, známky a soukromé projekty. Použit je výhradně známý
  exponovaný korpus a syntetické providerové odpovědi.

Před opravou validní AMBIGUOUS s confidence pod0.7 ztratilo konkrétní otázku
při přechodu na regex; v jednom doloženém vstupu pokračovalo do D1. Nová větev
v CRE vrací ASK_USER přímo s konkrétní otázkou, prázdnými tools a conversation
scope. Z nejisté klasifikace přenáší pouze otázku, confidence a příznak návaznosti;
žádný target, operaci, plánovač, unavailableAction ani formátovací instrukci.
Při návaznosti zachovává kanonickou operaci odvozenou existujícím helperem
z již uloženého pending stavu, dříve než se intent změní na AMBIGUOUS.
Parser a prahy pro akční klasifikace zůstávají stejné; chybný/truncated výstup
nevstupuje do nové větve. Změna nepřidává importní hranu ani oprávnění.

RED reprodukce: dva testy očekávaly konkrétní otázku, oba FAIL (exit1) —
jeden přes skutečný parser/CRE, druhý přes HTTP M1. GREEN v2: context28/28,
exit0, včetně pokračování po restartu a původních approval/cancellation asercí.
Deterministický test pokrývá3 vstupy ×3 nízké confidence, odříznutí akčních
metadat a8 neplatných/akčních negativních odpovědí. Po doplnění operace z pending
stavu také změnu write→read, která musí znovu ASK_USER, bez tools.

První source bdf461d2 měl context28PASS a následný checkpoint6b593a58
CHAT7/CODE12 19PASS +CI37654239411 success. Přesto jej evidence review vrátilo:
ve třech nízkých confidence se ztrácela implicitní původní FILE_WRITE operace.
Unit test ji měl předvyplněnou, takže vadu nezachytil. Tento důkaz zůstává v
[historickém focused.json](evidence/chat-clarification-20261007/focused.json).
Nový RED (1FAIL/exit1) reprodukuje skutečný pending bez předvyplněné operace;
v2 opravuje jen zachování existující autority, nikoli převzetí modelové operace.

Řízený replay v2 zachoval původní známé vstupy/providerové objekty, pět
confidence0.1/0.5/0.69/0.70/0.9 a privátní DB/projekt pro každou podmínku.
Skript je mechanicky odvozený z C2: nový source pin, výstupní cesta a pozitivní
aserce včetně původní operace/zadání; vstupy ani korpus se nemění.
Výsledek **15 OBSERVED /0 INCONCLUSIVE**,15 přesných otázek,15 podmínek bez
nového effectu, každá právě1 cílová klasifikace, žádná downstream inference.
Všech5 pending podmínek zachovalo write i původní zadání. Nezávislý reviewer
ověřil skutečné SQLite snapshoty,49 hashovaných artefaktů a nezměněných45 raw
souborů první verze. Historické C2 12 OBSERVED/3 INCONCLUSIVE zůstávají zachované.
Toto je důkaz aplikace s fixture providerem, nikoli nové skóre Gemmy/Qwenu.

Nezávislý reviewer `/root/m1_outage_review` přijal source i důkaz v2;
jeho cílené opakování1/1 PASS exit0. Předchozí širší nezávislé opakování
context28/M1 74/project44 prošlo na první verzi a zůstává odlišeno.
Opakování původních integračních CI CHAT7 +CODE12 na v2 ještě probíhá.
Všechny pozitivní příkazy čekají exit0, RED výše exit1. Node24.21.0 je povinný.

H1 kandidáty c7f03d56/9591ea1b, produkční bindingy a instalace se nemění.
Živá kvalita, StudioD1 a fresh5 nejsou tímto CPU výsledkem přijaty. Následuje
původní fresh5 na společném čistém/publikovaném/CI kandidátu s novým freeze,
aktuální provider authority a samostatným GPU oknem; autor fresh5 sám nepřijme.
