# Decision 032 — M5 outbound policy authority

**Stav:** `IMPLEMENTED / REVIEW_PENDING` · **Datum:** 2026-08-26

## Rozhodnutí

Produkční Node proces má jednu globální `fetch` boundary. Neznámý externí
request je fail-closed, i kdyby vznikl v legacy nebo conditional modulu.
Povolení se uděluje pouze přes pojmenovanou plochu, přesný scope, metodu a
origin a před transportem vyžaduje durable audit decision.

Model discovery zachovává explicitní operátorské rozhodnutí z 2026-08-19:
default zůstává ON a `false` jej vypíná. M5 z něj nedělá nový user effect;
z transparentní operátorské policy dělá scoped a auditovanou komunikaci.

Web search/scrape se tím nepovoluje. M2 správně odmítá předstírat, že jediný
query-level EffectRequest autorizuje neznámou provider fallback/redirect síť.
Globální gate je poslední containment vrstva, ne náhradní effect broker.

## Důsledky

- chybějící nebo nefunkční audit blokuje externí request;
- URL path/query/body/header se neukládají, pouze origin a digest celé URL;
- conditional surface se stane podporovanou až vlastním přesným scope pravidlem
  a release disposition;
- host firewall, DNS sandbox cizích child procesů a dlouhohorizontové měření
  jsou samostatné hranice a tímto rozhodnutím nejsou tvrzené jako hotové.
