# C3 — konkrétní otázka při nejisté klasifikaci

**Stav: SOURCE_REVIEW_PASS / INTEGRATION_AND_EVIDENCE_REVIEW_PENDING.**
Autorita: přijatý WP-CHAT-QUALITY-20261001 (cílené doptání, původní zadání,
obnovení rozhovoru) a pokračující explicitní zadání operátora.
Aktuální deník: [WORK-PROGRESS](../WORK-PROGRESS.md).

- BASE `228caaf680002f062dabc47f65dd2b18aca84fc7`.
- Produkt a testy `bdf461d262128cc168de6fdc805119fbc0f4e5c4`.
- [Přesný diff](evidence/chat-clarification-20261007/product-and-regression.patch).
- [Příkazy, exity, výsledky a hashe raw důkazů](evidence/chat-clarification-20261007/focused.json).
- Zakázané vstupy pro implementátora/reviewera: H1/H2, `restricted/`, jejich
  raw logy, odpovědi, známky a soukromé projekty. Použit je výhradně známý
  exponovaný korpus a syntetické providerové odpovědi.

Před opravou validní AMBIGUOUS s confidence pod0.7 ztratilo konkrétní otázku
při přechodu na regex; v jednom doloženém vstupu pokračovalo do D1. Nová větev
v CRE vrací ASK_USER přímo s konkrétní otázkou, prázdnými tools a conversation
scope. Přenáší pouze otázku, confidence a příznak návaznosti; žádný target,
operaci, plánovač, unavailableAction ani formátovací instrukci. Existující
ASK_USER handler zachová původní pending request/operation. Parser a prahy
pro akční klasifikace zůstávají stejné; chybný/truncated výstup nevstupuje do
nové větve. Změna nepřidává importní hranu ani oprávnění.

RED reprodukce: dva testy očekávaly konkrétní otázku, oba FAIL (exit1) —
jeden přes skutečný parser/CRE, druhý přes HTTP M1. GREEN: context28/28,
exit0, včetně pokračování po restartu a původních approval/cancellation asercí.
Nový deterministický test pokrývá3 vstupy ×3 nízké confidence, odříznutí
akčních metadat a8 neplatných/akčních negativních odpovědí.

Řízený replay původního C2 experimentu na source bdf461d2 zachoval známé
vstupy/providerové objekty, pět confidence0.1/0.5/0.69/0.70/0.9 a privátní
DB/projekt pro každou podmínku. Skript je mechanicky odvozený z C2: nový source
pin, výstupní cesta a závěrečné pozitivní aserce; vstupy ani korpus se nemění.
Výsledek **15 OBSERVED /0 INCONCLUSIVE**, 15 přesných otázek,15 podmínek bez
nového effectu, každá právě1 cílová klasifikace, žádná downstream inference.
Historické C2 12 OBSERVED/3 INCONCLUSIVE zůstávají zachované. Toto je důkaz
aplikačního chování s fixture providerem, nikoli nové měření kvality Gemmy/Qwenu.

Nezávislý source reviewer `/root/m1_outage_review` nenašel blokující nález.
Přezkoumané SHA-256: CRE `e02fb8011a0bf7a064a021d7edf7882716043c2e229c166d0b7d92cdb6c54c40`,
context test `f6e08b5d76d807d1e83435f438fa52990fe066f8461b4d0162952d3adff90231`.
Nezávislé opakování context/M1/project a konečné evidence review probíhá;
integrační profil obsahuje původní CI CHAT7 +CODE12. Všechny pozitivní příkazy
čekají exit0, RED výše exit1. Node24.21.0 je povinný.

H1 kandidáty c7f03d56/9591ea1b, produkční bindingy a instalace se nemění.
Živá kvalita, StudioD1 a fresh5 nejsou tímto CPU výsledkem přijaty. Následuje
původní fresh5 na společném čistém/publikovaném/CI kandidátu s novým freeze,
aktuální provider authority a samostatným GPU oknem; autor fresh5 sám nepřijme.
