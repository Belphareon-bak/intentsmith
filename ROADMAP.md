# IntentSmith — roadmapa

**Verze:** 1 · **2026-08-02** · **Vlastník:** operátor
**Pravidla:** [`CONTRACT.md`](CONTRACT.md) · **Směřování:** [`DIRECTION.md`](DIRECTION.md) · **Stav:** [`SYSTEM-MAP.md`](SYSTEM-MAP.md)

> Nahrazuje `docs/ROADMAP.md`, který popisuje Gate 0 / Gate 1 řízení zrušené
> rozhodnutím operátora (`CONTRACT.md` §8).

---

## 1. Na čem to stojí

Roadmapa nevznikla ze čtení kódu. Vznikla z toho, že jsem produkt **pustil
a zkusil** — chat, expertizy, skills, projekt. Za jeden večer to našlo tři
vady, každou jiného druhu:

| Co | Co se dělo | Jednotlivé díly |
|---|---|---|
| Refinement | `kolik je hodin?` trvalo **25 466 ms** — model „vylepšoval" spočítaný čas | oba v pořádku |
| Potvrzení | `ano` u skillu **přenastavilo pět modelů** včetně CHAT, natrvalo | oba v pořádku |
| Routa expertíz | 500 při každém volání, **od v87 do v135** | oba v pořádku |

**Vzorec je u všech tří stejný a je to hlavní zjištění:**

> **Jádro je dobré. Rozbité jsou spoje mezi díly.**
> Každý díl má vlastní zelené testy. Spoj nemá žádné.

Proto má roadmapa tvar, který má. Nejde stavět nové patro na domě, kde nedrží
spoje — a naopak nemá smysl přestavovat zdi, které stojí.

To sedí na princip 8 (`DIRECTION.md` §0c): **evoluce, ne revoluce.**

---

## 2. Pět úrovní

Nejsou to fáze, které se projdou a zapomenou. Je to **pět otázek v pořadí, kde
každá další má smysl jen tehdy, když ta předchozí drží.**

| | Úroveň | Otázka, na kterou odpovídá |
|---|---|---|
| **Ú0** | **Drží to** | Funguje produkt jako celek, ne jen po dílech? |
| **Ú1** | **Je to předvídatelné** | Vím, co to udělá a jak dlouho to potrvá? |
| **Ú2** | **Dá se to nasadit** | Co C3 chybělo do provozu? |
| **Ú3** | **Je to chytré** | Kde nám cizí řešení dá víc než vlastní? |
| **Ú4** | **Zlepšuje se to samo** | Jde produkt vyvíjet dál, aniž by ztloustl? |

Postupuje se shora dolů a **úrovně se nepřeskakují**. Zároveň platí, že Ú0 a Ú1
nikdy „neskončí" — rostou s každou novou schopností.

---

## Ú0 — Drží to

**Otázka:** funguje produkt jako celek?

### Kde jsme

| | |
|---|---|
| Schopností v PASS | **2 z 22** (#1 server/routing/DB, #2 CRE) |
| Spojů s testem | **3** — všechny vznikly dnes, z nalezených vad |
| Server z čerstvého klonu | běží napoprvé |

### Co se dělá

**Ú0.1 — Testy spojů, ne jen dílů.** Tohle je nová třída testu a přímý důsledek
dnešních nálezů. Chování `C-02` znělo *„LOCAL je terminální — nenásleduje volání
gateway"*, test to ověřoval na `decide()` a **prošel** — model se volal až za
rozhodnutím.

> **Pravidlo:** každá schopnost má v seznamu chování **aspoň jednu větu
> formulovanou tam, kde ji zažívá uživatel** — přes HTTP nebo přes UI, ne nad
> modulem.

**Ú0.2 — Dojít se schopnostmi do PASS**, v pořadí podle `CONTRACT.md` §6.
Zbývá 20. U každé platí Ú0.1.

**Ú0.3 — Před psaním chování produkt spustit.** Inventura ze čtení kódu
nenašla ani jednu ze tří dnešních vad. Spuštění našlo všechny tři za večer.

### Kdy je hotovo

Nikdy úplně, ale měřitelný postup: **schopností v PASS** a **spojů s testem**.
Cíl na první kolo: **6 schopností** (#1, #2, #4, #18a, #3, #5) a **žádná
schopnost bez chování na úrovni požadavku.**

---

## Ú1 — Je to předvídatelné

**Otázka:** vím, co to udělá a jak dlouho to potrvá?

### Kde jsme

Dnes změřeno na běžícím produktu:

| | |
|---|---:|
| deterministická odpověď | 46 ms *(bylo 25 466)* |
| konverzační odpověď | **138 271 ms** |
| SPEC fáze projektu | 58 521 ms |

Konverzační odpověď přes **dvě minuty** je to, co uživatel zažívá nejčastěji.

### Co se dělá

**Ú1.1 — Změřit, kolik refinement reálně přidává.** Ve dvou pozorováních
**nepřidal nic** — jednou zamítnuto pro drift, jednou 73 → 73 — a stojí druhé
volání modelu. Telemetrie se už loguje (`scoreBefore`, `scoreAfter`), takže
stačí ta data pár dní sbírat a podívat se.

**Rozhodnutí až podle čísel**, ne teď. Když se ukáže, že skóre stoupne v 60 %
případů o 20 bodů, je to jiná odpověď než v 10 % o 3 body.

**Ú1.2 — Token streaming.** `stream: false` je v `gateway.js:428` natvrdo,
`onLLMToken` je konzument bez producenta. **Nezkracuje to odpověď, ale mění,
co uživatel zažívá** — dvě minuty čekání na první znak versus dvě sekundy na
první slovo. Ze všech položek roadmapy tahle nejvíc mění dojem z produktu.

Sahá do #3, #6 a #21, takže se dělá **až budou všechny tři v PASS.**

**Ú1.3 — L3 jako číslo od začátku, ne později.** p95 chatu, p95 deterministické
odpovědi, chybovost, počet regresí. Kdyby se p95 měřilo, těch 25 sekund je
vidět první den.

### Kdy je hotovo

p95 deterministické odpovědi **pod 100 ms**, p95 konverzační odpovědi
**změřený a známý** (ne nutně malý — model je model), první token **pod 2 s**.

---

## Ú2 — Dá se to nasadit

**Otázka:** co C3 chybělo do provozu? (princip 5)

Tohle není nová funkčnost. Je to seznam věcí, které C3 nemělo a bez kterých se
produkt nedá dát z ruky.

| Co | Stav dnes | Proč to blokuje nasazení |
|---|---|---|
| **Autentizace API** | `validateApiToken()` je **napsaná a nikde nezapojená**; globální auth guard chybí | Dnes to drží jen invariant L0-10 (loopback). Jakmile listener opustí loopback, je to neautentizované RCE |
| **Privacy hygiena** | 877 konverzací v git historii, `P-001`..`P-003` | Rotace credentialů a rozhodnutí o historii vyžaduje akci operátora |
| **Izolace procesů** | rozšíření `c3-process-isolation` v IDE existuje, nezměřeno | Skill má krok `shell` s whitelistem — sandbox je, hloubka neověřená |
| **Backup a upgrade** | `db-backup.js` existuje, migrace pod zátěží neověřená | Upgrade instalace bez ztráty dat je podmínka provozu |
| **WS hranice** | terminal channel bere `exec` po handshaku bez tokenu | Neškodné na loopbacku, fatální mimo něj |

**Pořadí uvnitř Ú2 je dané:** autentizace první, protože z ní plyne, jestli
smí listener opustit loopback. Zbytek pak.

`CONTRACT.md` §9 tenhle balík **vědomě odkládá až po odladění základu** — což
je Ú0 a Ú1. Roadmapa to nemění, jen pojmenovává, co v něm je.

---

## Ú3 — Je to chytré

**Otázka:** kde nám cizí řešení dá víc než vlastní? (princip 2)

### Pravidlo, kterým se to řídí

> **Náhrada se nedělá proto, že cizí řešení existuje. Dělá se proto, že se dá
> ukázat, co tím produkt získá — číslem nebo funkcí.**

Bez toho je to výměna kódu za jiný kód, a to je přesně ta práce, která
v konvergenci nadělala 66 500 řádků bez jediné prokázané schopnosti.

### Co je nahrazeno dnes

| Co | Čím | Přidaná hodnota |
|---|---|---|
| Vlastní model runtime | **Ollama** | Nemusíme řešit inference, kvantizaci ani VRAM management |
| Vlastní UI | **Theia** | 32 rozšíření staví na hotovém IDE frameworku místo na vlastním editoru |

Obojí je hotové a je to dobré rozhodnutí. **Dvě náhrady za celý projekt je málo
na to, aby se z toho dala dělat věda, a dost na to, aby bylo vidět, že to
funguje.**

### Kandidáti k vyhodnocení

Ne k provedení — **k vyhodnocení podle pravidla výše.**

**MCP pro nástroje** — `tools/registry.js` má **5 094 řádků a 213 nástrojů**
v jednom souboru s vlastním kontraktem. MCP je dnes standard pro vystavení
nástrojů modelu.

- *Co by to dalo:* nástroje by šly použít i mimo IntentSmith, a IntentSmith by
  uměl konzumovat cizí MCP servery — tedy nástroje, které nikdo z nás nenapsal.
  To je přesně princip 3: modularita, aby šly části upgradovat.
- *Co by to stálo:* přepis kontraktu 213 nástrojů. Velké.
- *Jak rozhodnout:* zkusit **jeden** nástroj přes MCP vedle stávajícího registru
  a změřit, co to obnáší. Ne přepisovat 213 na základě dojmu.

**Ostatní kandidáti se určí až po Ú0.** Dneska nevím, co bude po dokončení
schopností bolet — a hádat to je přesně ta chyba č. 2 z `DIRECTION.md` §0.

---

## Ú4 — Zlepšuje se to samo

**Otázka:** jde produkt vyvíjet dál, aniž by ztloustl? (principy 3, 4, 8)

### Co se zachovává, protože to C3 udělalo dobře

Tohle není práce k udělání, je to **seznam věcí, na které se nesahá**, protože
jsou to ty „skvělé principy", o kterých mluví princip 8:

- **CRE jako jediná autorita** — model navrhuje, systém rozhoduje, 12 guardů
  výstup modelu validuje. LLM-first návrh s deterministickou pojistkou.
- **Specialista je soběstačný balíček** — žádný `import ../../src/`, všechno
  přes `ctx.registries`. Kvůli tomu jde specialistu přidat i odebrat za běhu.
- **Skill je JSON, ne kód** — 9 typů kroků jako uzavřená množina. Přidání
  skillu nevyžaduje nasazení.
- **`mergeExpertisePrompt()` je čistá funkce** — expertizy se skládají
  předvídatelně.
- **Patch místo regenerace** — 3-tier anchor, atomický zápis, plný rollback.
- **Paměť slábne, nemaže se** — poločas rozpadu místo mazání.

### Co se přidává

**Ú4.1 — Strop na meta-práci.** Aparát se nerozšiřuje, dokud nejsou tři
schopnosti v PASS. Přímý důsledek poměru 5 : 1 z `DIRECTION.md` §0.

**Ú4.2 — Seznam chování jako trvalý mechanismus.** Roste jen z reality: každá
chyba nalezená za provozu přidá právě jedno chování. Nikdy z fantazie.
Za dnešek přibyla dvě — `deterministic-answer-latency` a
`confirmation-ownership`.

**Ú4.3 — Model upgrade zůstává, ale nikdy sám.** Invariant L0-9 drží.
Discovery je od dneška opt-in (`C3_ENABLE_ONLINE_DISCOVERY`, default off).

---

## 3. Způsob práce (princip 6)

Čtyři pravidla. Víc jich není potřeba.

| | Pravidlo | Proč |
|---|---|---|
| **1** | **Jednotka práce je schopnost, vertikálně do PASS.** Ne „důkaz pro C3-024", ale „tohle funguje a nerozbije se to." | Rozpracované schopnosti se nehromadí |
| **2** | **Definition of done na tři řádky:** (a) předvedeno, že to funguje, (b) existuje test, který by selhal při rozbití, (c) je v registru. | 335řádková definice vyprodukovala 0 z 30 |
| **3** | **Týdenní demonstrovatelný přírůstek.** Týden bez něčeho, co jde ukázat, je varovný signál. | Princip 7 — začít s málem a ladit |
| **4** | **Změna bez demonstrovatelného efektu jde až za tou, která ho má.** Výjimka jen tam, kde bezpečnost nebo prerekvizita blokuje provoz. | Přesně to, co se v konvergenci porušilo |

**Test, jestli to funguje:** *dá se to, co jsem tento týden udělal, ukázat na
obrazovce nebo jako číslo?* Když ne, dělal jsem aparát.

---

## 4. Co se vědomě nedělá

Aby bylo jasné, co v roadmapě není a proč:

| Co | Proč ne |
|---|---|
| Gate 0 attestace při vývoji | Zrušeno, `CONTRACT.md` §8. Jen při releasu |
| Schopnosti mimo základ (#8, #14, #17, #18b, #19, #20) | Dostanou inventuru, ne práci, dokud základ nedrží |
| Přesun #13 z `planner/` | Doloženo, že to jen otočí křížové importy |
| Setup wizard, licencování | Mimo 1.0, stačí `.env` |
| Legacy web UI `/architect` | Zděděný předchůdce Theia. Osud nerozhodnut, práce se do něj nedává |

---

## 5. Co dělat příště

Konkrétně, aby se nemuselo vymýšlet:

1. **#4 Konverzace a persistence** — je na řadě podle `CONTRACT.md` §6.
   Inventura hotová, seznam chování ne. Napíše se **včetně chování na úrovni
   požadavku** (Ú0.1) a **po spuštění produktu** (Ú0.3).
2. **Prošetřit dvě sady**, které hlásí exit 1 bez viditelné příčiny —
   `multi-source-integration` a `nightly-audit-runner-self-test`.
3. **Zapnout sběr `scoreBefore`/`scoreAfter`** a nechat běžet (Ú1.1).
