# Chování #2 — CRE (klasifikace a rozhodování)

**`CONTRACT.md` §3 krok 2** · **2026-08-02** · `17a8b9a8`
**Stav: k schválení operátorem — před schválením se nepíše žádný test**

> Rozhodnutí operátora (inventura #2, `C-2`): **CRE je na Ollamě závislá,
> testovat ji bez ní nemá přínos.** Fake LLM klient se nestaví.
>
> Většina chování je proto profil `model`. Sloupec **Model** říká, co ke svému
> ověření potřebuje běžící Ollamu — a co ne, protože LOCAL cesta a guard vrstva
> model nevolají vůbec.

---

## Deterministická vrstva — ověřitelná bez modelu

| # | Chování | Model |
|---|---|---|
| **C-01** | Dotaz na čas a na jednoduchý výpočet je klasifikován jako `LOCAL` a odpovězen bez volání modelu. | ne |
| **C-02** | Rozhodnutí `LOCAL` je terminální — nenásleduje žádné volání gateway. | ne |
| **C-03** | Každé rozhodnutí vytvoří `CRE_DIAG` záznam s `classifiedBy`, `initialIntent`, `finalIntent` a `confidence`. | ne |
| **C-04** | Když je model nedostupný, klasifikace spadne na regex a **nikdy nevyhodí výjimku**. | ne |
| **C-05** | `shellCommand` z výstupu modelu je vždy stržen — příkaz nikdy nepochází z modelu (`GUARD 1`). | ne |
| **C-06** | `SKILL` se nevybere, když je jeho feature flag vypnutý (`GUARD 4`). | ne |
| **C-07** | Žádná zpráva neobejde `decide()` — invariant L0-1. | ne |

## Klasifikace — vyžaduje model

| # | Chování | Model |
|---|---|---|
| **C-08** | Jednoznačný dotaz na informaci je klasifikován jako `SEARCH`. | **ano** |
| **C-09** | Jednoznačná žádost o kód je klasifikována jako `CODE`, ne `SEARCH`. | **ano** |
| **C-10** | Poděkování a rozloučení je `CONVERSATIONAL`, ne `SEARCH` (routing patch Q2). | **ano** |
| **C-11** | Nejednoznačný vstup dá `AMBIGUOUS` se slotem pro upřesnění, ne odhad. | **ano** |

## Guardy nad výstupem modelu — vyžadují model

| # | Chování | Model |
|---|---|---|
| **C-12** | Při aktivní kreativní expertize je `SEARCH` přepsán na `CREATIVE` (`GUARD 6`). | **ano** |
| **C-13** | `FILE_WRITE` bez rozpoznatelného cíle se nevybere (`GUARD 2`). | **ano** |
| **C-14** | `DESIGN` bez potvrzeného deterministického vzoru je sražen na `CREATIVE` (`GUARD 5`). | **ano** |

---

## Čeho se seznam vědomě nedotýká

- **Přesnosti klasifikace jako čísla.** „Kolik procent intentů CRE trefí" je
  metrika L3 nad pevným korpusem, ne akceptační chování. Jedno chování = jeden
  jednoznačný případ.
- **Všech 19 intentů a všech 12 guardů.** Seznam pokrývá deterministickou
  vrstvu úplně a z modelové vybírá reprezentativní případy. Zbytek se přidá,
  až konkrétní chyba ukáže, že je potřeba — podle pravidla „seznam roste jen
  z reality".
- **Rozdělení `cre-decision.js`.** Operátor rozhodl nedělit (`C-4`).

---

## Otevřené z inventury, které se řeší spolu s touto schopností

**`C-1` — bez dostupného modelu trvá klasifikace ~6 000 ms.** `config.ollama.retries`
= 3, odstupy 2 s a 4 s, teprve pak regex fallback. Týká se každé zprávy.

Klasifikace **má** fallback, takže na ni čekat 6 sekund je čistá ztráta. Role
volajících a jejich limity už v `auth-types.js` existují (`LLMCallerRole.CRE_DECISION`),
takže je kam odlišnou retry politiku pověsit.

Návrh: `C-04` se rozšíří o měřitelnou horní mez a oprava se udělá pod jeho
ochranou. Konkrétní mez je rozhodnutí operátora — **navrhuji jeden pokus bez
opakování**, protože fallback existuje a je okamžitý.
