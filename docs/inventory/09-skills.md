# Inventura #9 — Skills runtime

**Pořadí 11** · **2026-08-02** · `17a8b9a8` · 13 souborů, **1 768 řádků**

Registry, resolver, runner a **9 step executorů** (`llm`, `template`, `write`,
`shell`, `ask`, `review`, `validate`, `substitute`, `transform`).

**Testy:** 4 sady — `offline` 2, `model` 1, `server` 1. `lastGreen: 0`.
**Ověřeno za běhu:** `/api/skills` vrací **13 skills** — `brainstorm`,
`changelog-gen`, `code-refactor`, `create-expertise`, `create-skill`,
`create-specialist`, `email-composer`, `interview-prep`, `meeting-notes`,
`presentation`, `project-bootstrap`, `report-gen`, `summarizer`.

## Dobré, použije se
- **Skill je JSON, ne kód** — deterministický workflow s definovanými kroky. Přidání skillu nevyžaduje nasazení.
- **9 typů kroků jako uzavřená množina** — runner je stavový automat nad známými typy, ne libovolný eval.
- **Meta-skills** (`create-skill`, `create-expertise`, `create-specialist`) — systém rozšiřuje sám sebe vlastním mechanismem, ne zvláštní cestou.
- **1 768 řádků na 13 skills a 9 typů kroků** — nejlepší poměr hodnoty k objemu v celém projektu.

## Zbytečné
Nic prokazatelného.

## Nejasné
| # | Zjištění | Otázka |
|---|---|---|
| **S-1** | **Krok `shell` je mezi devíti typy.** Skill tedy může spustit shell příkaz. `AGENTS.md` přitom vede shell jako `bash` = denied capability, a mobilní plán ho zakazuje výslovně. | Jaký je vztah `shell` kroku k zákazu shellu? Buď je zákaz jinde, nebo je tady díra. **Zaznamenat, i když se bezpečnost řeší až po základu.** |
| **S-2** | **Jen 4 testové sady na runtime s 9 typy kroků.** | Pokrývá to všech 9? Vypadá to na málo. |
| **S-3** | **`create-specialist` skill vytváří specialisty (#8), kteří jsou mimo základ.** | Počtvrté týž vzor (`N-1`, `P-2`, `E-1`). |
