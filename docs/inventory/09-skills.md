# Inventura #9 — Skills runtime

**Pořadí 11** · **2026-08-02** · `17a8b9a8` · 13 souborů, **1 768 řádků**

Registry, resolver, runner a **8 vykonávaných step typů** (`llm`, `template`,
`write`, `shell`, `ask`, `review`, `validate`, `transform`). `substitute.js` je
sdílená helper vrstva, ne devátý typ kroku.

**Testy:** 4 sady — `offline` 2, `model` 1, `server` 1. `lastGreen: 0`.
**Ověřeno za běhu:** `/api/skills` vrací **13 skills** — `brainstorm`,
`changelog-gen`, `code-refactor`, `create-expertise`, `create-skill`,
`create-specialist`, `email-composer`, `interview-prep`, `meeting-notes`,
`presentation`, `project-bootstrap`, `report-gen`, `summarizer`.

## Dobré, použije se
- **Skill je JSON, ne kód** — deterministický workflow s definovanými kroky. Přidání skillu nevyžaduje nasazení.
- **8 typů kroků jako uzavřená množina** — runner je stavový automat nad známými typy, ne libovolný eval.
- **Meta-skills** (`create-skill`, `create-expertise`, `create-specialist`) — systém rozšiřuje sám sebe vlastním mechanismem, ne zvláštní cestou.
- **1 768 řádků na 13 skills a 8 typů kroků** — nejlepší poměr hodnoty k objemu v celém projektu.

## Zbytečné
Nic prokazatelného.

## Nejasné
| # | Zjištění | Otázka |
|---|---|---|
| **S-1** | **Krok `shell` je mezi osmi typy.** Skill tedy může spustit shell příkaz. | Ověřit, že efekt jde stejným M2 authority/approval/sandbox connectorem jako ostatní exec cesty; hostitelská pravidla pro agenta nejsou produktovou policy. |
| **S-2** | **Jen 4 testové sady na runtime s 8 typy kroků.** | Pokrývají uživatelské journey a negativní effect boundary, ne jen registry dispatch? |
| **S-3** | **`create-specialist` skill vytváří specialisty (#8).** | Specialist platforma + jeden E2E patří do 1.0 M3; skill musí používat schválený extension contract. |
