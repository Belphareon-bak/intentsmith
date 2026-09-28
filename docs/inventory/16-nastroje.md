# Inventura #16 — Nástroje a registry

**Pořadí 10** · **2026-08-02** · `17a8b9a8` · 3 soubory, **5 694 řádků**

| Soubor | Ř. |
|---|---:|
| **`registry.js`** | **5 094** |
| `http-client.js` | 324 |
| `npm-audit.js` | 276 |

**Nástrojů v registry:** **153** (přesné top-level deklarace `tools[...]` /
`^  name:`; původních 213 vzniklo počítáním všech textových `name:` výskytů).
**Testy:** 5 sad — `offline` 4, `server` 1. `lastGreen: 0`.

## Dobré, použije se
- **Jeden registr, jeden kontrakt** — všech 153 nástrojů má stejný tvar deklarace. Nástroj se přidá zápisem, ne novým modulem.
- **`tool-enforcement`** — samostatná sada ověřující, že se nástroj nedá zavolat mimo deklarované oprávnění.
- **`http-client.js` odděleně** — síťový přístup nástrojů má jednu bránu, ne rozeseté `fetch`.
- **4 z 5 sad `offline`** — ověřitelné bez modelu.

## Zbytečné
Nic prokazatelného.

## Nejasné
| # | Zjištění | Otázka |
|---|---|---|
| **T-1** | **`registry.js` má 5 094 řádků a 153 nástrojů v jednom souboru.** Největší jednotlivý soubor projektu po `cre-decision.js`. | Nejdřív sjednotit `ToolRequest/Result` a effect policy; teprve pak rozhodovat o fyzickém dělení. |
| **T-2** | **Používá se všech 153?** Inventura to nezjišťovala — vyžaduje křížovou analýzu volání. | Zjistit využití, než se cokoli dělí nebo převádí na MCP. |
| **T-3** | **`npm-audit.js` (276 ř.)** je konkrétní nástroj povýšený na vlastní modul, zatímco ostatní jsou v registru. | Proč tenhle zvlášť? |
