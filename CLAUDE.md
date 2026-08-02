# CLAUDE.md

> Tento soubor je ukazatel. Obsah je v neutrálních dokumentech, které čte
> každý nástroj i člověk — ne jen Claude.

**Než začneš cokoli dělat, přečti v tomto pořadí:**

1. **[`CONTRACT.md`](CONTRACT.md)** — pravidla vývoje. **Jediný zdroj pravdy pro
   to, jak se pracuje.** Kde si jakýkoli jiný dokument odporuje s ním, platí on.
2. **[`SYSTEM-MAP.md`](SYSTEM-MAP.md)** — změřený stav systému: rozsah,
   schopnosti a jejich soubory, invarianty, co se vědomě neřeší.
3. **[`docs/inventory/`](docs/inventory/)** — inventura jednotlivých schopností.

Postup u jedné schopnosti (`CONTRACT.md` §3): **inventura → seznam chování →
testy → PASS.** Krok se nepřeskakuje.

---

## Inventura zdrojového kódu

Tato tabulka zde zůstává, protože ji strojově hlídá
`tests/artifact-validation.test.js` proti skutečným zdrojům — je to
existující pojistka proti dokumentačnímu driftu a nemá se rušit.
Až se guard přesune na `SYSTEM-MAP.md`, přesune se s ním i tabulka.

| Adresář | Soubory | Řádky | Popis |
|---------|---------|-------|-------|
| src/chat/ | 74 | 31,846 | Konverzační pipeline (CRE, handlery, quality, syntéza) |
| src/planner/ | 34 | 15,350 | Lifecycle + execution engine + architecture governance |
| src/code-intel/ | 33 | 11,561 | Code Intelligence (symbol index, KG, AST, graph, context) |
| src/expertises/ | 23 | 9,464 | Expertise system + specialist runtime + merge engine |
| src/upgrade/ | 15 | 6,780 | Model upgrade (catalog, pairwise, empirical, L4, validation) |
| src/routes/ | 15 | 6,670 | HTTP API routes (15 route modulů, vč. media) |
| src/agents/ | 14 | 6,510 | Agent platform (runner, scheduler, conditions, triggers) |
| src/tools/ | 3 | 5,694 | Tool registry (153 nástrojů) |
| src/ui/ | 2 | 4,552 | Web UI (architect.js) |
| src/architect/ | 13 | 4,007 | Architecture Intelligence (policy, refactor, predictor) |
| src/db/ | 44 | 4,493 | SQLite schema, 41 migrací |
| src/executor/ | 8 | 3,474 | Tool executor, circuit breaker, sandbox |
| src/notifications/ | 19 | 3,335 | 6 kanálů (email, TG, ntfy, webhook, desktop, push) |
| src/memory/ | 9 | 3,132 | LTM, task memory, cross-project, feedback |
| src/llm/ | 6 | 2,696 | LLM gateway, Ollama klient, web search |
| src/domains/ | 12 | 1,816 | Domain scaffoldy (React, Vue, FastAPI, Flutter, ...) |
| src/skills/ | 13 | 1,768 | Skills: registry, resolver, runner, 9 step executors |
| src/patch/ | 5 | 1,505 | Patch engine: parser, validator, applier, scope limiter |
| src/specialists/ | 2 | 1,379 | Specialist loader + capability registry |
| src/ws-bridge/ | 5 | 1,109 | WebSocket bridge (IDE ↔ backend) |
| src/channels/ | 3 | 841 | Channel adaptery (CLI, Web, API) |
| src/marketplace/ | 2 | 797 | Marketplace client + package installer |
| src/context/ | 3 | 742 | Prompt builder, import map, context delta |
| ostatní | 17 | 3,577 | core, autonomy, system, telemetry, licensing, setup, config, server |
| **Celkem** | **380+** | **~137,000** | |

---

## Historický obsah

Předchozí verze tohoto souboru (514 řádků) popisovala stav, který se rozešel
s kódem — 15 expertíz místo 18, neexistující soubor `cre-decision-types.js`,
11 guardů místo 12, „~98 % hotovo". Přehled rozporů je v `SYSTEM-MAP.md`
§ „Co je zastaralé".

Původní znění zůstává v historii gitu; nebylo opraveno, protože jeho platná
část je v dokumentech výše a neplatná se opravovat nemá.
