# IntentSmith — pravidla vývoje

**Verze:** 1 · **Datum:** 2026-08-01 · **Vlastník:** operátor

> Tento dokument je **jediný zdroj pravdy pro pravidla vývoje**. Kde si jakýkoli
> jiný dokument v repozitáři odporuje s tímto, platí tento.
>
> Starší dokumenty (`AGENTS.md`, `docs/ROADMAP.md`, `docs/convergence/*`)
> **zůstávají jako reference** — obsahují platná zjištění a inventář. Přestávají
> však být autoritou pro to, jak se pracuje.

---

## 1. Východisko — změřeno, ne odhadnuto

Aby se to nemuselo znovu odvozovat:

| | |
|---|---:|
| C3 vývoj (2026-01-05 → 07-27) | 431 commitů, ~7 měsíců |
| „Konvergence" (07-27 → 07-31) | **177 commitů, 4 dny** |
| Z toho produktový přírůstek | 6 bezpečnostních oprav, 2 hygiena, 1 funkce |
| Přírůstek `src/` | +3 389 řádků |
| Přírůstek testů, skriptů a konvergenčních dokumentů | **+66 500 řádků** |
| `src/` celkem | 145 259 řádků, 406 souborů |
| `tests/` celkem | 142 287 řádků, 345 souborů |
| Schopností s akceptačním důkazem | **0 z 30** |

**Závěr:** testy jsou objemem už na paritě se zdrojem a přesto neprokazují nic.
Objem je tedy prokazatelně špatná metrika a žádné pravidlo v tomto dokumentu
ho nepoužívá.

**Ověřeno spuštěním** (2026-08-01, čerstvý klon, bez Ollamy): server nabootuje
napoprvé, deterministické intenty odpovídají pod 5 ms, registruje se 18 expertíz,
5 specialistů, 13 skills a 6 agentů, web UI odpovídá, a bez modelu systém
degraduje čistě přes `LLM_PROVIDER_UNAVAILABLE` místo pádu.

**C3 je funkční produkt.** Ne prototyp, ne baseline k obnově. Všechno níže z toho
vychází.

---

## 2. Vrstvy

Ne fáze. Fáze se projdou a zapomenou; tohle platí trvale a běží souběžně.

| | Vrstva | Co to je |
|---|---|---|
| **L0** | Invarianty | Co se nesmí porušit nikdy. Osm vět, osm testů. |
| **L1** | Zelená linie | Scénáře, které musí fungovat vždy. Běží při každé změně. Roste o jeden scénář za každou dokončenou schopnost. Cíl je běh v řádu vteřin — zatím **neověřeno**, dnešní deterministická sada běží minuty. |
| **L2** | Schopnosti | Části C3, jedna po druhé, vertikálně až do PASS. |
| **L3** | Kvalita jako číslo | p95 latence, chybovost, přesnost intentů, počet regresí. Měřeno průběžně. |
| **L4** | Evoluce | Výměny a upgrady. Sahá se jen na to, co je za stabilním rozhraním z L0. |

### L0 — invarianty

Převzato z `CLAUDE.md` § Klíčové kontrakty. Každý dostane **právě jeden** test.

1. CRE je jediná autorita — žádná zpráva ji neobejde.
2. `mergeExpertisePrompt()` je čistá funkce — žádné side effects.
3. ExpertiseEnforcer: max 2 retries, temperature decay −0,1/pokus.
4. 5D capability vector je `{reasoning, creativity, determinism, riskTolerance, verbosity}` 0–100.
5. QGv2 je deterministický a idempotentní — žádné LLM volání, žádné nové věty.
6. Patch engine: 3-tier anchor, atomický zápis, plný rollback při selhání.
7. Execution loop: max 8 iterací.
8. Specialista je soběstačný — žádný `import ../../src/` z balíčku, vše přes `ctx.registries`.
9. Model upgrade nikdy neupgraduje sám — discovery nemění konfiguraci.
10. Legacy listener nikdy neopustí loopback, dokud neexistuje oddělená ověřená hranice.

---

## 3. Postup u jedné schopnosti

Každá schopnost prochází těmito čtyřmi kroky. Krok se nepřeskakuje ani
neslučuje s dalším.

### Krok 1 — inventura

> **Bez inventury se na schopnosti nezačíná pracovat.** Nelze stavět na tom,
> o čem není jasné, co dělá.

Inventura vyprodukuje tři seznamy:

1. **Co je dobré a použije se.**
2. **Co je zbytečné.**
3. **Co je nejasné a potřebuje rozhodnutí operátora.**

Platí to pro **všech patnáct schopností základu**, ne jen pro přerostlé
moduly. U velkých modulů (#6 s 32,3k a #18 s 10,3k řádky) je inventura
nejnákladnější, ale ne jiná.

Inventura popisuje **současný stav**, ne cílový. Nerozhoduje se v ní — jen se
zjišťuje. Rozhoduje se až nad hotovými třemi seznamy.

### Krok 2 — seznam chování

Viz §4. Schvaluje operátor, před psaním prvního testu.

### Krok 3 — testy

Jeden test na jedno chování. Existující testy se nejdřív mapují na chování;
píše se jen to, co v mapování chybí.

### Krok 4 — PASS

Podle §5. Teprve pak se schopnost zapíše jako hotová a její scénář se přidá
do L1.

---

## 4. Pravidlo chování

**Tohle je hlavní pravidlo tohoto dokumentu.**

> Ke každé schopnosti se **nejdřív** napíše seznam **chování** — krátkých vět
> o tom, co musí zvenčí platit. Každé chování má **právě jeden** test.
> Seznam schvaluje operátor **dřív, než se napíše první test**.

Vlastnosti, kvůli kterým to nahrazuje jakýkoli poměr:

- **Nedá se nafouknout** — test, který neodpovídá žádnému chování ze seznamu, je vidět.
- **Nedá se podcenit** — chování bez testu je vidět taky.
- **Recenzuje se deset vět, ne deset tisíc řádků.** To je kontrolní bod operátora.
- **Seznam roste jen z reality.** Každá chyba nalezená za provozu přidá právě
  jedno chování jako regresi. Nikdy se nepřidává z fantazie.
- **Existující testy se mapují, nepřepisují.** Co se nenamapuje na žádné
  chování, je kandidát na archivaci. Je to nástroj, jak testovou hmotu
  **zmenšit**, ne zvětšit.

Očekávaný rozsah: ~15–20 schopností × 5–15 chování ≈ **150–250 vět pro celý produkt.**

### Jak vypadá chování

Dobré — pozorovatelné zvenčí, jednoznačné PASS/FAIL:

> „Na `kolik je hodin?` přijde odpověď s aktuálním časem, bez volání modelu, do 50 ms."
> „Když Ollama neběží, chat vrátí `LLM_PROVIDER_UNAVAILABLE` a nespadne."
> „Vypnutý specialista se neúčastní routingu."

Špatné — neměřitelné, nebo popisuje implementaci:

> „CRE funguje správně."
> „`decide()` volá `classifyDeterministic()` před LLM."

---

## 5. Definice PASS a FAIL

Platí pro schopnost, ne pro testovací sadu.

**PASS** — všechna chování ze schváleného seznamu projdou, na čistém stroji,
z čerstvého klonu, u pojmenovaného commitu. Nic jiného PASS není.

**FAIL** — jakékoli chování ze seznamu neprojde. FAIL se nesnižuje na „většinou
funguje" ani se neschovává za varianci modelu.

**BLOCKED** — chování nelze ověřit kvůli **konkrétní pojmenované** prerekvizitě
(chybí GPU, model, vlastněný server, externí toolchain). `BLOCKED` nikdy
nezakrývá FAIL a nikdy se nepočítá jako zelený důkaz.

**NAPSÁNO** — test existuje, ale ten, kdo ho psal, ho v tomto prostředí
nespustil. Vzniká tam, kde vývoj běží jinde než prerekvizita — typicky testy
profilu `model` psané bez Ollamy.

`NAPSÁNO` je **slabší než `BLOCKED`**. `BLOCKED` říká „spustili jsme to a
narazili na chybějící prerekvizitu"; `NAPSÁNO` říká „nespustili jsme to vůbec,
takže nevíme ani to, jestli je test správně". Nepočítá se jako zelený důkaz,
nikdy nezakrývá FAIL a **schopnost s jediným `NAPSÁNO` chováním nemůže být
v PASS**. Přechází na PASS nebo FAIL při prvním skutečném běhu.

> **Prerekvizity se deklarují.** Sada, která potřebuje Go, Python runtime nebo
> cokoli mimo `npm install`, to musí říct. Nedeklarovaná prerekvizita je vada
> evidence — z čerstvého klonu dnes projde 194 z 199 „deterministických" sad,
> ne 199.

---

## 6. Milníky — schopnosti C3

Pracuje se **shora dolů, jedna schopnost v jednu chvíli.** Rozpracované schopnosti
se nehromadí.

### Základ — v rozsahu, v pořadí

Pořadí není volba priorit, ale **závislostí**: staví se na tom, co je nutné pro
běh. Historie vývoje C3 to potvrzuje.

| Pořadí | # | Schopnost | Rozsah | Proč zde |
|---:|---|---|---:|---|
| 1. | 1 | Server, routing, DB, migrace | 12,3k | bez toho neběží nic |
| 2. | 2 | CRE — klasifikace a rozhodování | v `chat/` | každá zpráva jí prochází |
| 3. | 4 | Konverzace a persistence | v `chat/` | rozhodnutí i historie se musí kam zapsat |
| 4. | 18a | **Správa modelů** — profily, registry, výběr, VRAM fit | ~0,9k | gateway musí vědět, který model obsluhuje kterou roli |
| 5. | 3 | LLM gateway a role modelů | 2,9k | nedeterministická část CRE bez něj padá na `AMBIGUOUS` |
| 6. | 5 | Quality Gate v2 | v `chat/quality/` | prochází jí každá odpověď |
| 7. | 6 | Chat pipeline a handlery | 32,3k | spojuje 2–6 dohromady; **kandidát na rozdělení** |
| 8. | 21 | Studio + WS bridge | 1,3k + IDE | první bod, kde je produkt vidět jako produkt |
| 9. | 7 | Expertizy a 5D merge | 9,5k | mění odpovědi, které už fungují |
| 10. | 16 | Nástroje a registry | 5,7k | předpoklad pro skills i práci s kódem |
| 11. | 9 | Skills runtime | 1,8k | staví na nástrojích |
| 12. | 15 | Paměť (LTM, task, cross-project) | 3,1k | zlepšuje kontext, není pro běh nutná |
| 13. | 12 | Code Intelligence | 11,6k | vstup pro execution i lifecycle |
| 14. | 11 | Execution engine + patch | 5,0k | mění soubory — až nad ověřenou code intel |
| 15. | 10 | Project lifecycle | 16,6k | orchestruje 12 a 13 |
| 16. | 13 | Architecture governance | 4,0k | dohlíží na 10–13 |

### Nízká priorita — mimo základ

Rozhodnutí operátora. Nejsou potřeba pro funkční základ a nepracuje se na nich,
dokud základ nedrží.

| # | Schopnost | Rozsah |
|---|---|---:|
| 8 | Specialisté a loader | 1,4k |
| 14 | Agenti a scheduler | 6,5k |
| 17 | Notifikace | 3,3k |
| 18b | **Upgrade automatika** — discovery, ranking, proposals, validace | ~9,5k |
| 19 | Marketplace | 0,9k |
| 20 | Media / ComfyUI | 1,3k |
| — | Licencování | nedokončené, připravovalo se |
| — | Setup wizard | mimo rozsah 1.0, stačí `.env` |

**Rozdělení #18** (rozhodnutí operátora 2026-08-01, inventura #1 `N-1`): název
„Model upgrade" popisoval 8 % modulu. Správa modelů — profily, registry, výběr
role, VRAM fit — je pro běh nutná a jde do základu. Zbytek, včetně
`model-universe-store.js` (1 919 ř.) a ~1 475 řádků síťových klientů, které
chodí na internet hledat modely, je volitelná nadstavba mimo základ.

Nízkoprioritní schopnosti dostanou inventuru také — ale až po základu, a jen
inventuru. Bez ní není o čem rozhodovat.

---

## 7. Kontrakt pro agenta

Agent řídí větev. Operátor řídí projekt a určuje tento kontrakt.

**Agent smí bez ptaní:**
- provést inventuru schopnosti, která je aktuálně na řadě;
- pracovat na schopnosti, která je aktuálně na řadě;
- opravit chybu, která shodila L1;
- doplnit chování jako regresi po nalezené chybě.

**Agent si musí vyžádat souhlas:**
- tři seznamy z inventury, **než se z nich cokoli vyvodí**;
- seznam chování schopnosti, **před** psaním testů;
- jakoukoli změnu pořadí schopností;
- výměnu jakékoli části za open source;
- cokoli, co mění L0.

**Agent nesmí:**
- začít pracovat na schopnosti bez hotové inventury;
- začít druhou schopnost, než je první v PASS;
- zapsat nedokončenou schopnost jako hotovou;
- založit dokument, který nemá adresáta a důvod;
- snížit, přeskočit nebo umlčet test kvůli zelené;
- spouštět attestační řetěz jako součást běžného vývoje.

**Každá změna má demonstrovatelný efekt** — je vidět v UI, nebo v čísle z L3.
Výjimka: bezpečnostní opravy a odstranění blokujících prerekvizit.

---

## 8. Co se tímto ruší

| Dosud | Nově |
|---|---|
| Gate 0 attestace u každé změny | Attestace **u releasu**. Denní režim = L1 zelená |
| „Jakákoli změna stromu ruší kandidáta" jako provozní režim | Platí jen pro release kandidát |
| Gate 1 jako 30 nezávislých důkazních řízení | Schopnosti podle §6, v pořadí daném závislostmi |
| Evidence generovaná devítifázovým producerem | Producer zůstává pro release; vývoj běží na L1 |
| `AGENTS.md` jako pravidla vývoje | Tento dokument. `AGENTS.md` zůstává jako historický kontext |

---

## 9. Odložená rozhodnutí

### Bezpečnost a credentials — až po odladění základu

**Rozhodnutí operátora, 2026-08-01.** Bezpečnost, credentials a privacy incident
`P-001`..`P-003` se řeší **až budou základní věci odladěné**. Nejsou blokerem
ničeho v §6.

Zůstávají v evidenci, aby se na ně nezapomnělo:

- `P-001`..`P-003` — privátní materiál je v současném stromu kontejnovaný,
  v git historii zůstává dosažitelný. Rotace credentialů a rozhodnutí o historii
  vyžadují akci operátora, dokud se to neudělá, expozice trvá;
- `G0-R018` — legacy listener zůstává na loopbacku, což je invariant L0-10.
  Dokud platí, není z toho aktivní riziko;
- nezapojený `validateApiToken()` a chybějící globální auth guard patří do téhož
  balíku a řeší se s ním.

Nic z toho nebrání pracovat na §6 — všechno běží lokálně na loopbacku.

### Zbývá rozhodnout

- **Rozdělení #6** (chat pipeline, 32,3k) na menší schopnosti — vyplyne z inventury.
- **Nedeklarované prerekvizity** 5 testovacích sad (Python PDF runtime, Go
  v izolovaném PATH). Detail v `docs/review/2026-08-01-STATE-AND-VERIFICATION.md` `EX-6`.
