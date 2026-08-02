# IntentSmith — směřování a ideologie

**Verze:** 1 · **Založeno:** 2026-08-02 · **Vlastník:** operátor

> **Proč tenhle dokument existuje.** `CONTRACT.md` říká *jak se pracuje*.
> `SYSTEM-MAP.md` říká *co je změřeno*. Nikde ale nebylo zapsané **co
> IntentSmith je a kam jde** — tahle rozhodnutí žila roztroušená uvnitř
> inventur, v konverzacích a v hlavě operátora. To je ta nejdražší věc, která
> se dá ztratit, protože se z kódu nedá odvodit.
>
> Kde si jiný dokument odporuje s tímto **v otázce směřování**, platí tento.
> V otázce pravidel vývoje platí `CONTRACT.md`. V otázce změřeného stavu
> `SYSTEM-MAP.md`.

---

## 0. Jak se to sem dostalo — dvě špatná uchopení

**Zapsáno podle operátora, 2026-08-02.** Bez tohohle kontextu vypadá stav repa
nepochopitelně a hrozí, že se táž chyba udělá potřetí.

### Pokus č. 1 — greenfield

Když přišel nápad předělat C3 na IntentSmith, **zahodilo se všechno z C3**
a začal se stavět nový projekt, který si z C3 bral jen nápady.

**Proč to byla chyba:** zahodila by se tím téměř veškerá práce. Sedm měsíců
a 431 commitů funkčního produktu.

### Pokus č. 2 — vylepšování bez řízení

Druhý nápad byl správný: **vzít C3 a výrazně ho vylepšit**, protože pár měsíců
leželo u ledu a mezitím se mnohé změnilo. Jenže se to rozjelo **bez jakéhokoli
kvalitního řízení** — řídila to AI a řídila to špatně. Práce a vylepšení
vznikly, ale **do nesmyslných rozměrů**.

**Doloženo měřením** (`CONTRACT.md` §1): za 4 dny 177 commitů, z toho
do `src/` +3 389 řádků a mimo něj +66 500. Poměr aparátu k produktu zhruba
**5 : 1**. Schopností s akceptačním důkazem po tom všem **0 z 30**.

### Diagnóza

> **Gate 0 je dobrý výstup a špatný provozní režim.**

Pravidlo *„jakákoli změna stromu ruší kandidáta"* je správné pro certifikaci
releasu a fatální pro vývoj — nelze zároveň vyvíjet a být certifikovaný.
Proces tím **trestá produktovou práci a odměňuje práci na aparátu**, což je
přesně to, co těch 177 commitů ukazuje. Aparát fungoval; jen měřil prázdný pokoj.

Řešení už je v `CONTRACT.md` §8: **attestace u releasu, denní režim = L1 zelená.**

### Co se z toho naopak zachovává

Aby se neudělala chyba č. 1 podruhé. Ta čtyřdenní práce našla věci, které mají
cenu: inventář 30 schopností a ~350 klasifikovaných testů (mapa, kterou C3
nikdy nemělo) · doklad, že „~98 % hotovo / 3 500+ testů" nebyla pravda ·
6–8 skutečných bezpečnostních oprav · nightly infrastrukturu.

**Problém není, že se ten audit udělal. Problém je, že se z jednorázového
auditu stal trvalý provozní režim.**

### Poznámka k `ffd21cf`

Tvrzení, že deklarovaný C3 baseline `ffd21cf` v repozitáři neexistuje,
**neplatí**. Ověřeno 2026-08-02: commit existuje a je dosažitelný z refů
`archive/20260802/intentsmith-gate0/*`. Analýza, která tvrdila opak, nejspíš
běžela ve worktree bez těch refů.

---

## 0b. Kdo co řídí

**Rozhodnutí operátora, 2026-08-02.** Tentokrát projekt řídí operátor sám,
tak jako řídil C3.

| | |
|---|---|
| **Operátor řídí projekt** | Určuje kontrakt, směřování a pořadí. Nestrká nos do každé maličkosti. |
| **Agent řídí větev** | Ale **větev nesmí vzniknout dřív, než existuje kontrakt** — a ten určuje operátor. |

Tohle nahrazuje pravidlo v `AGENTS.md`, že jediný zapisovatel je Codex agent.

---

## 0c. Osm principů, podle kterých se to má dělat

Zadání operátora, 2026-08-02. Doslova, protože každý z nich mění rozhodování.

1. **Srozumitelně říct, jaká je roadmapa** a na čem se pracuje.
2. **Naplánovat, které části se nahradí open source a proč** — a u každé
   náhrady vidět **přidanou hodnotu**, ne jen fakt výměny.
3. **C3 bylo chytře modulární, aby šly části snadno upgradovat.** Tuhle
   ideologii zachovat.
4. **C3 mělo promyšlený celý koncept** od jádra po periferie a principy.
   Zachovat a klidně vylepšit.
5. **Identifikovat, co všechno C3 chybělo do prod-ready.**
6. **Identifikovat způsob kvalitní práce**, aby se nakonec nedohánělo spousta
   věcí a nedivili jsme se, proč to nefunguje podle očekávání.
7. **Snazší je začít s málem, vyladit a přidávat**, než udělat velkou hromadu
   kódu a pak ji dlouho ladit a předělávat.
8. **Princip IntentSmithu:** za rozumný čas se má C3 **evolučně** vyvinout
   v mnohem kvalitnější produkt na solidním základu a skvělých principech.

> Bod 7 a 8 spolu drží celý zbytek dokumentu: **evoluce, ne revoluce.**
> Vylepšení se lepí na běžící základ, ne naopak.

---

## 1. Co IntentSmith je

**Lokální AI platforma odvozená z C3.** Konverzační asistence, správa projektů
a autonomní agenti, běžící na vlastním hardware.

**C3 je funkční produkt, ne prototyp k obnově.** Není to baseline, ze které se
staví znovu — je to hotová věc, která se zpevňuje. Vývoj C3 trval 7 měsíců
a 431 commitů; IntentSmith na tom staví.

### Co znamená „local-first"

Není to marketingové slovo, je to omezení:

- **Žádná povinná závislost na cloudu.** Bez internetu produkt funguje.
- **Bez modelu degraduje čistě** — `LLM_PROVIDER_UNAVAILABLE`, ne pád.
- **Odchozí síť je opt-in.** Jediná plocha, která z principu volá ven, je
  discovery modelů (#18b). Od 2026-08-02 je za `C3_ENABLE_ONLINE_DISCOVERY`
  s výchozím **off**. Předtím vypínač neexistoval a produkt volal ven jednou
  za 24 h bez volby uživatele — to bylo v rozporu s tímhle odstavcem a bylo
  to opraveno.

---

## 2. Ideologie vývoje

Převzato z `CONTRACT.md`, protože je to důvod, proč ten dokument vypadá,
jak vypadá.

### Objem nic nedokazuje

Změřeno na vlastním projektu: za 4 dny „konvergence" přibylo **66 500 řádků**
testů, skriptů a dokumentů a **177 commitů**. Schopností s akceptačním důkazem
po nich bylo **0 z 30**. Testy jsou objemem na paritě se zdrojem a přesto
neprokazovaly nic.

**Proto žádné pravidlo v `CONTRACT.md` nepoužívá poměr ani počet.**

### Chování místo poměrů

Ke každé schopnosti se nejdřív napíše seznam **chování** — krátkých vět o tom,
co musí zvenčí platit. Jedno chování = jeden test. Seznam schvaluje operátor
dřív, než vznikne první test.

Vlastnost, kvůli které to nahrazuje jakoukoli metriku: **nedá se nafouknout ani
podcenit** a recenzuje se deset vět místo deseti tisíc řádků.

**Seznam roste jen z reality.** Každá chyba nalezená za provozu přidá právě
jedno chování jako regresi. Nikdy se nepřidává z fantazie.

### Měřeno, ne odhadnuto

Čísla v dokumentech jsou naměřená. Kde se dokumentace rozchází s kódem, platí
kód a dokumentace se opraví — ne naopak.

Doložené případy driftu: 15 expertíz vs. skutečných 18 · 11 guardů vs. 12 ·
`cre-decision.js` „~2 900 ř." vs. 4 196 · „~98 % hotovo" · `multi-agent.js`
vedený jako *„Phase I 100 %"*, přitom se nikdy nespustil.

### PASS se nesnižuje

`PASS` je na úrovni schopnosti, z čerstvého klonu, u pojmenovaného commitu.
`FAIL` se nesnižuje na „většinou funguje" ani se neschovává za varianci modelu.
`BLOCKED` nikdy nezakrývá `FAIL`. `NAPSÁNO` je slabší než `BLOCKED`.

**Nedeklarovaná prerekvizita je vada evidence**, ne detail.

---

## 3. Rozhodnutí o produktu

Chronologicky, s důvodem. Tohle je ta část, která se z kódu odvodit nedá.

| Datum | Rozhodnutí | Důvod |
|---|---|---|
| 2026-08-01 | **Pořadí schopností je dané závislostmi, ne prioritami** | Staví se na tom, co je nutné pro běh. Historie vývoje C3 to potvrzuje. |
| 2026-08-01 | **#18 se rozdělí** na správu modelů (základ) a upgrade automatiku (mimo) | Název „Model upgrade" popisoval 8 % modulu. Správa modelů je pro běh nutná, discovery ne. |
| 2026-08-01 | **Bezpečnost a credentials až po odladění základu** | `P-001`..`P-003` zůstávají v evidenci. Všechno běží na loopbacku, takže nic z toho neblokuje §6. |
| 2026-08-01 | **Setup wizard mimo 1.0** | Zatím stačí `.env`. |
| 2026-08-01 | **Licencování je nedokončené, ne mrtvé** | Připravovalo se. Mimo základ, zůstává. |
| 2026-08-01 | **Ukázkoví agenti jsou produktová funkce**, ne demo data | Chování je zhruba správné, úprava počká. |
| 2026-08-02 | **CRE je na Ollamě závislá, fake LLM klient se nestaví** | CRE je LLM-first s deterministickou guard vrstvou. Testovat ji bez modelu nemá přínos. |
| 2026-08-02 | **`cre-decision.js` se nedělí** | 4 196 řádků je v pořádku; soudržnost rozhodovací logiky je důvod nechat to pohromadě. Nesouhlasí dokumentace, ne kód. |
| 2026-08-02 | **Klasifikace má jeden pokus, žádné opakování** | Má regex fallback, takže čekat 6 s na odmítnuté spojení je čistá ztráta. 6 091 ms → 80 ms. |
| 2026-08-02 | **„Ulož to" zůstává zkratkou pro uložení poslední odpovědi** | Funguje, spustí se jen na explicitní žádost a vždy oznámí jméno i cestu. Zakazovat to bylo špatné znění chování, ne vada kódu. |
| 2026-08-02 | **Odchozí síť je opt-in, default off** | Viz §1. |
| **2026-08-02** | **C3 Studio (Theia) je IDE produktu. Web UI `/architect` je legacy.** | Studio bylo původně webové, než se celé postavilo na Theia. Theia verze je vychytaná a zbývá na ní málo. **Web UI je zděděný předchůdce, ne fallback.** |

### Co to znamená pro rozsah

**V základu 1.0** — v pořadí podle závislostí:
server/routing/DB · CRE · konverzace · správa modelů · LLM gateway · QGv2 ·
chat pipeline · **Studio + WS bridge včetně `c3-ide/`** · expertizy · nástroje ·
skills · paměť · code intelligence · execution+patch · lifecycle · governance

**Mimo základ:** specialisté · agenti · notifikace · upgrade automatika ·
marketplace · media · licencování · setup wizard

---

## 4. Co ještě rozhodnuté není

Aby se nepředstíralo, že je hotovo víc, než je.

| Otázka | Stav |
|---|---|
| **Rozdělení #6** (chat pipeline, 20,4 k) | Vyplyne z hlubší inventury. Ta je zatím vědomě mělká. |
| **Token streaming** | Dnes neexistuje — `stream: false` natvrdo, `onLLMToken` je konzument bez producenta. Odpověď přichází celá. Zařazeno jako chování #21. |
| **Osud legacy web UI** (`src/ui/architect/`) | Po rozhodnutí o Theia je to zděděná plocha. Neřešeno: zůstává, nebo se vyřadí. |
| **#18b — 9 470 řádků** | Síť je vypnutá, ale kód zůstává. „Ponecháno, ale vypnuto" je půlka rozhodnutí; celé zní, jestli 18b v produktu je, nebo se vyřízne. |
| **Kritérium dělení souborů** | Návrh: *dělí se soubor obsluhující víc než jednu schopnost, řádky nerozhodují*. Neschváleno do `CONTRACT.md`. |
| **`EX-1`** | Kolize ID rizika blokuje merge mobilní větve. Oprava navržená, neprovedená. |

---

## 5. Jak tenhle dokument udržovat

Přibude řádek do §3, kdykoli padne rozhodnutí **o produktu** — ne o kódu.
Rozhodnutí o kódu patří do inventur a seznamů chování.

Test: *„dá se to odvodit z kódu?"* Pokud ano, sem to nepatří. Pokud ne — pokud
by to nový člověk nebo nový nástroj nemohl uhodnout — patří to sem.
