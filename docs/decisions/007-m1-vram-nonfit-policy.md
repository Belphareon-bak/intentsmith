# 007 — D-5: důkaz fyzického VRAM non-fit před provider efektem

- **typ:** DECIDE
- **WP:** WP-M1-MODEL
- **rail:** R2 LOCAL_FIRST, R3 OBSERVABLE_BEHAVIOR, R4 MEASURED_QUALITY, R6 REVERSIBILITY
- **vzniklo při:** `src/llm/model-ctx.js:fitsVram()` a `src/llm/gateway.js:callWithPolicy()`

## Evidence na stole

Pouhé jméno modelu, například `:7b`, neurčuje skutečnou velikost vah. Neříká
quantizaci, architekturu, alias ani umístění na GPU. Stav `NONFIT` proto vzniká
jen z explicitních metadat vah a KV cache dodaných důvěryhodným runtime
vlastníkem a z validního pozorování celkové kapacity. Pokud metadata nebo
pozorování chybí, výsledek je `UNKNOWN`, nikoli odhadovaný `FIT` nebo `NONFIT`.

Offline boundary fixture prokázala přesnou hranici: při vahách 4760 MB,
63 MB/1K KV, `num_ctx=4096` a rezervě 1024 MB je požadavek 5012 MB. Celkových
6036 MB je `FIT`; 6035 MB je `NONFIT`. V druhém případě gateway nevytvoří
provider request, nevezme semaforový slot, nezvýší call counter a nevydá success
evidence. Nízká aktuální volná paměť při dostatečné celkové kapacitě zůstává
`UNKNOWN`, protože legitimní model swap může požadavek uvolnit.

## Varianty

| Varianta | Chování | Dopad na rails | Cena zavedení |
|---|---|---|---|
| A — trusted `NONFIT` odmítnout před efektem | Pouze fyzicky nemožný request skončí `MODEL_VRAM_NON_FIT`; `UNKNOWN` pokračuje | Nevytváří předvídatelný OOM effect a současně neblokuje swap na základě odhadu | Současný stav: `model-ctx.js`, `gateway.js` a dvě focused sady |
| B — každý nejistý stav odmítnout | `UNKNOWN` se chová jako `NONFIT` | Nejsilnější fail-closed, ale produkt bez runtime metadat nebo GPU pozorování model vůbec nezavolá | Změna jedné větve v `callWithPolicy()` a nejméně čtyř negativních asercí |
| C — preflight pouze auditovat | I známý fyzický non-fit dojde k provideru | Zachovává legacy best-effort, ale znovu vytváří OOM jako provozní řídicí mechanismus | Odstranění guardu a změna non-fit testu na observační |

## Vzatý default a proč

Varianta **A**. Odpovídá dávkovému zadání a rozlišuje prokázanou fyzickou
nemožnost od dočasně obsazené nebo nepozorovatelné VRAM. Name-only heuristika
nesmí autoritativní stav vytvořit.

## Šev

Klasifikace je v `src/llm/model-ctx.js:fitsVram()`; terminální policy je jediná
větev `src/llm/gateway.js:callWithPolicy()`. Testovací ani runtime metadata
nejsou součástí request options a volající je nemůže přepsat. Trusted profily
jsou klíčované přesnou normalizovanou identitou modelu; metadata jednoho modelu
se pro jiný model nepoužijí a chybějící profil vytvoří `UNKNOWN`.

## Cena přepnutí, když operátor rozhodne jinak

Varianta B mění jeden produkční šev a `tests/m1-model-contract.test.js` plus
GPU acceptance scénáře. Varianta C mění stejné dva soubory, ale oslabuje
negativní kontrakt. Napojení autoritativních metadat skutečného modelu zůstává
samostatným krokem před GPU tvrzením; bez něj je produkční klasifikace poctivě
`UNKNOWN`.

## Rozhodnutí operátora — 2026-08-08

**Potvrzena varianta A.** Jen důvěryhodně doložený fyzický `NONFIT` se odmítne
před provider efektem. `UNKNOWN` se nesmí domyslet ze jména modelu ani z
momentálně nízké volné VRAM a pokračuje jako dosud.
