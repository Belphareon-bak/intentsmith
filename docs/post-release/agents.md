# Kontrakt: agenti s úplnými funkcemi

**NÁVRH K REVIEW / NEIMPLEMENTOVÁNO.** Zadání operátora 2026-09-11.
Základ je native M3 extension runtime a M2 effect authority. Staré mutační
API zůstává odstavené, dokud přijatá náhrada nepokryje jeho skutečné scénáře.

## Co znamená úplnost

| Funkce | Požadovaná produkční cesta a demonstrace |
|---|---|
| Definice a nastavení | Vytvořit/upravit/validovat/verzovat agenta v UI, zobrazit zdroje, plán, nástroje, rozpočet a oprávnění. |
| Spouštění | Ručně, časově a událostí; timezone/DST, missed run, debounce, deduplication a souběh mají definovaný výsledek. |
| Zdroje | Projektové soubory a Git, RSS/Atom, HTTPS/API, databázový read model, více zdrojů a kurzory. Každý přes nativní provider se scope a podporovaným schématem. |
| Zpracování | Filtrace, změnová detekce, agregace, lokální modelový souhrn/klasifikace, specialisté a verzované skills. Provenance až k výsledku. |
| Akce | Uložená informace, in-app a schválené externí oznámení, návrh patche, schválený zápis/test či externí akce. Žádné přímé vedlejší zápisy. |
| Řízení | Run/pause/resume/cancel/disable/delete; restart obnoví kurzor a pravdivý stav, revoke zastaví další efekty. |
| Provoz | Durabilní run history, krokový stav, náklady, retries/backoff, circuit breaker, dead-letter a uživatelské řešení chyby. |

Před implementací vytvořit census stávajících native i legacy scénářů.
Každý zděděný scénář dostane konkrétní native náhradu nebo explicitně
schválenou disposition. Pouhý katalog, úspěšný CRUD nebo jediný health agent
neznamená úplnost celé platformy.

## Connector a mandát

Navržené `AgentDefinition@next`, `AgentRun@next`, `AgentExecutionMandate@1`
navazují na současné verzované typy; konkrétní volné verze se ověří při WP.
Mandát obsahuje owner, project/conversation scope, povolené třídy zdrojů a
efektů, data která smějí odejít, platnost, počty/objemy/náklady a revokaci.
Žádná neomezená autonomie ani implicitní dědění všech oprávnění aplikace.
Autonomní síť potřebuje samostatně přijatý mandát, ne recyklovaný jednorázový
chat grant. Reputace cíle nenahrazuje omezení dat odesílaných ven.

Použít stávající scheduler, native registry, run repository, model gateway,
ToolAdapter a effect broker. Vlastněné oblasti: `src/agents/**`, nativní
extension balíčky, provider adaptéry a Studio agent views; connector změny
se předají konzumentům až po review.

## Pravdivost a recovery

Každá exekuce má stabilní idempotency key, step journal a lease. Po pádu
se efekt se známým výsledkem neopakuje. U externího efektu bez idempotence,
jehož výsledek nelze zjistit, stav je UNKNOWN a řeší jej operátor;
nepředstírat exactly-once. Disable odvolá běžící mandát, cancel dostane
terminál a neuloží pozdní success. Žádný runaway retry nebo catch-up storm.
Čtený web/soubor je nedůvěryhodný obsah, který nemůže přidat oprávnění.

## Akceptace

Skutečné scénáře: RSS→dedup→modelový souhrn→notifikace; změna projektu→
analýza dopadu→návrh patche→approval→test; databázová změna→vícezdrojový
report. Pro každý vytvořit agenta v UI, provést běh, restart, vypnutí a
odstranění, ověřit uložený výsledek i efekty. Potom výpadek zdroje/modelu,
expirace mandátu, cancel, duplicate trigger, pád mezi efektem a receiptem,
cross-project a injekce ze zdroje. Reálné providery vedle deterministických
negativních testů; náklady a p95 podle předem zmrazeného workloadu.
Úplnost vyžaduje celou přijatou capability matici a nezávislé review.
