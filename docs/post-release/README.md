# Rozšíření IntentSmith po produkčním vydání 1.0

Adresát: operátor a budoucí implementátoři. Zadání operátora z 2026-09-11
požaduje tyto návrhy a následné dokončení odložených oblastí.
**Stav všech technických kontraktů: NÁVRH K REVIEW / NEIMPLEMENTOVÁNO.**
Pořadí práce zůstává v [ROADMAP](../../ROADMAP.md); tento adresář není další
roadmapa ani registr hotových funkcí. Detailní limity a schémata níže jsou
navržená akceptační kritéria, nikoli nově udělená provozní oprávnění.

| Kontrakt | Pozorovatelný výsledek |
|---|---|
| [Model improvement](model-improvement.md) | Nový skutečně natrénovaný artefakt se na nezávislých úlohách zlepší, projde regresními kontrolami a lze jej bezpečně vrátit. |
| [Project Intelligence](project-intelligence.md) | Systém vysvětlí architekturu a změnové dopady napříč rozsáhlým projektem s důkazy, pokrytím a přiznanými mezerami. |
| [Úplní agenti](agents.md) | Uživatel agenta vytvoří, naplánuje, spustí, zastaví a obnoví; zdroje i akce mají plnou nativní cestu a audit. |
| [Externí notifikace](notifications.md) | Zpráva dorazí přes zvolený kanál, stav doručení je pravdivý, tajemství a data zůstávají pod kontrolou. |
| [Marketplace](marketplace.md) | Rozšíření lze ověřit, instalovat, aktualizovat, vypnout a odstranit s jasnými oprávněními. |
| [Média](media.md) | Obraz/audio/video mají skutečný vstup, zpracování, výstup a export v podporovaných formátech. |
| [Aktualizace produktu](updates.md) | Podepsanou aktualizaci lze bezpečně připravit, schválit, aplikovat a vrátit včetně kompatibility dat. |

Společný základ je přijatá desktopová 1.0, její testovaný modelový/provider
kontrakt, M2 effect authority, M3 extension runtime a M5 privacy/backup.
Project Intelligence poskytuje kontext agentům a evidence pro model improvement.
Notifikace dodávají agentům výstupní kanály; marketplace distribuuje přijaté
rozšiřující balíčky. Žádná budoucí funkce nesmí obcházet původ, scope,
rozpočet, zrušení, audit, privacy nebo vratnost.

Automatizace poběží uvnitř předem uděleného omezeného mandátu. Schválení
kontraktu nezapíná síť, nezískává souhlas s užitím soukromých dat k tréninku
a neaktivuje nový model. Neomezené samopřepisování produktu není cílem.

Každý kontrakt se před implementací připne k aktuálnímu integračnímu SHA,
existujícím connectorům a vlastnímu bounded WP. Číselná kapacitní/latency
kritéria se zmrazí po měření baseline; kvalitativní oracle a held-out data
se zmrazí před tuningem. Staré implementace se odstraní až po přijetí
náhrady, migraci a doložené shodě uživatelských scénářů.

Tři možné strategie: (A) automatická tvorba kandidátů s explicitním nasazením
— doporučený první release; (B) pozdější omezená automatická aktivace v rámci
samostatně přijaté policy; (C) experimenty pouze ručně. Varianta B vyžaduje
vlastní změnu autority a nesmí vzniknout jako nenápadné rozšíření discovery.
