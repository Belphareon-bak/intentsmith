# Inventura #6 — Chat pipeline a handlery

**Pořadí 7** · **2026-08-02** · `17a8b9a8` · **46 souborů, ~20 400 řádků**
**Největší schopnost v systému.**

| Část | Souborů | Ř. |
|---|---:|---:|
| `src/chat/handlers/` | 45 | 18 249 |
| `src/chat/controller.js` | 1 | 2 173 |

Největší handlery: `decisions.js` 1 122 · `lifecycle-router.js` 993 ·
`expertise.js` 895 · `pre-handler.js` 772 · `file.js` 715 ·
`conversation.js` 689 · `agent-wizard.js` 671 · `design.js` 634 · `skill.js` 583.

## Dobré, použije se
- **Handler per intent** — 45 souborů místo jednoho switche. Přidání intentu je nový soubor, ne zásah do existujícího.
- **`pre-handler.js`** — pre-CRE intercepty (upgrade notifikace, approval) s auditní stopou přes `logIntercept()`, takže obcházení CRE je zaznamenané, ne tiché.
- **`lifecycle-router.js`** — routing do projektového lifecycle je oddělený od běžné konverzace.
- **`controller.js` jako jediný vstupní bod** — vše jde přes `ChatController.handle()`.

## Zbytečné
Neurčeno. **Na 20 400 řádků je tahle inventura strukturální, ne řádková** — čtení celého modulu je samostatná práce.

## Nejasné
| # | Zjištění | Otázka |
|---|---|---|
| **P-1** | **20 400 řádků a 46 souborů na jednu schopnost.** Obsahuje routing, syntézu, expertizy, lifecycle, soubory, skills, wizard, design. | Rozdělit — a podle čeho? Nabízí se řez podle intentu (konverzační / projektové / souborové / wizard). |
| **P-2** | **`agent-wizard.js` (671 ř.)** je průvodce tvorbou agenta — schopnost #14 je přitom mimo základ. | Stejný případ jako `N-1` u #18: nízkoprioritní schopnost má povrch v jádru. |
| **P-3** | **`expertise.js` (895 ř.) v handlerech** vs. `src/expertises/` (9 464 ř.) jako #7. | Kde končí handler a začíná schopnost #7? |
| **P-4** | **Inventura je zde mělčí než u ostatních schopností.** | Než se na #6 sáhne, potřebuje vlastní hlubší průchod. Doporučuji to jako samostatný úkol, ne jako součást téhle vlny. |
