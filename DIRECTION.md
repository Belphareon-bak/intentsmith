# IntentSmith — směřování a ideologie

**Verze:** 1 · **Založeno:** 2026-08-02 · **Vlastník:** operátor

> **Proč tenhle dokument existuje.** [`PRODUCT.md`](PRODUCT.md) říká, komu
> IntentSmith slouží a co znamená verze 1.0. `CONTRACT.md` říká, jak se pracuje,
> a `SYSTEM-MAP.md`, co je změřeno. Tento dokument uchovává **evoluční směr z
> C3 a chronologická rozhodnutí operátora**, která se z kódu nedají odvodit.
>
> Kde si jiný dokument odporuje s tímto **v otázce evolučního směřování**, platí
> tento. Produkt a scope určuje `PRODUCT.md`, pravidla `CONTRACT.md`, pořadí
> `ROADMAP.md` a změřený stav `SYSTEM-MAP.md`.

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

**Doloženo měřením** (historický `CONTRACT.md` v1; aktuální shrnutí níže): za
4 dny 177 commitů, z toho
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

Tohle nahradilo pravidlo v historické revizi `AGENTS.md`, že jediný zapisovatel
je Codex agent. Současný `AGENTS.md` je už pouze vstupní ukazatel.

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

## 1. Evoluční východisko

Úplná definice produktu je v `PRODUCT.md`. Zde platí pracovní směr:
**C3 je funkční produkt, ne prototyp k obnově.** IntentSmith zachovává jeho
funkční části a modulární principy, zpevňuje jejich spoje a nahrazuje je pouze
tam, kde je doložený konkrétní přínos. Nejde o greenfield přepis.

### Co znamená „local-first"

Není to marketingové slovo, je to omezení:

- **Žádná povinná závislost na cloudu.** Bez internetu produkt funguje.
- **Bez modelu degraduje čistě** — `LLM_PROVIDER_UNAVAILABLE`, ne pád.
- **Síť smí být použita, ale nikdy vyžadována.** Automatické model discovery
  (#18b) bylo od 2026-08-02 za `C3_ENABLE_ONLINE_DISCOVERY` s výchozím **off**.
  **Operátor to 2026-08-19 obrátil: výchozí je nyní `on`, vypíná se explicitně
  hodnotou `false`.** Důvod: bez discovery katalog tiše stárne a scoring
  doporučuje modely, které byly před měsíci nahrazeny — vyhledávání aktuálně
  nejefektivnějších modelů je záměr produktu, ne vedlejší efekt.

  Local-first tím zůstává v platnosti, protože omezení zní „nic mimo stroj není
  *povinné*", ne „nic mimo stroj se nesmí použít". Každá discovery cesta
  degraduje sama (registry po 3 selháních přejde do offline režimu, sonda na
  Ollamu couvá 30 s, WhatLLM má error cooldown), takže offline běh stále
  seřadí modely z lokálního katalogu.

  Produkt má i další explicitní nebo konfigurované síťové schopnosti — webové
  nástroje, marketplace, agent sources/actions, notifikace a případně vzdálenou
  Ollamu. Ty nejsou povinnou cloudovou závislostí, ale musí projít společnou
  outbound policy a auditem.

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

### Pozorované chování místo poměrů

Ke každé aktivní schopnosti se po skutečném runtime pozorování schválí krátké
věty o tom, co musí platit **na uživatelské hranici**. Každá věta má pojmenovaný
důkaz, který při rozbití zčervená; jeden důkaz může potřebovat více testů a
modulový test sám není náhradou za journey.

Vlastnost, kvůli které to nahrazuje jakoukoli objemovou metriku: recenzuje se
význam tvrzení a jeho důkaz, ne počet řádků. Seznam roste z runtime pozorování,
nalezených regresí a explicitního threat modelu pro bezpečnost, data a recovery.
Aktuální postup a hranice jsou závazně v `CONTRACT.md` §3–§5.

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
| 2026-08-01 | **Bezpečnost a credentials až po odladění základu, ale před release** | `P-001`..`P-003` zůstávají v evidenci. Loopback dovoluje lokální vývoj; production-ready milník je bez nápravy nepustí. |
| 2026-08-01 | **Setup wizard mimo 1.0** | Zatím stačí `.env`. |
| 2026-08-01 | **Licencování je nedokončené, ne mrtvé** | Připravovalo se. Mimo základ, zůstává. |
| 2026-08-01 | **Ukázkoví agenti jsou produktová funkce**, ne demo data | Chování je zhruba správné, úprava počká. |
| 2026-08-02 | **CRE je na Ollamě závislá, fake LLM klient se nestaví** | CRE je LLM-first s deterministickou guard vrstvou. Testovat ji bez modelu nemá přínos. |
| 2026-08-02 | **`cre-decision.js` se nedělí** | 4 196 řádků je v pořádku; soudržnost rozhodovací logiky je důvod nechat to pohromadě. Nesouhlasí dokumentace, ne kód. |
| 2026-08-02 | **Klasifikace má jeden pokus, žádné opakování** | Má regex fallback, takže čekat 6 s na odmítnuté spojení je čistá ztráta. 6 091 ms → 80 ms. |
| 2026-08-02 | **„Ulož to" zůstává zkratkou pro uložení poslední odpovědi** | Funguje, spustí se jen na explicitní žádost a vždy oznámí jméno i cestu. Zakazovat to bylo špatné znění chování, ne vada kódu. |
| 2026-08-02 | **Odchozí síť je opt-in, default off** | Viz §1. |
| **2026-08-02** | **C3 Studio (Theia) je IDE produktu. Web UI `/architect` je legacy.** | Studio bylo původně webové, než se celé postavilo na Theia. Theia verze je vychytaná a zbývá na ní málo. **Web UI je zděděný předchůdce, ne fallback.** |
| 2026-08-03 | **Primární uživatel je samostatný technický power user** | Hlavní hodnota je řízené provádění práce nad vlastními projekty na vlastním hardwaru. |
| 2026-08-03 | **Specialisté a agenti patří do 1.0 jako platforma + jeden reálný E2E každého typu** | Modularita musí být prokázaná skutečným užitkem, ne jen zeleným testem loaderu. |
| 2026-08-03 | **Self-learning je lokální, scoped, auditovatelný a vratný** | Učení nesmí samo rozšířit authority, měnit kód/config ani přecházet mezi projekty. |
| 2026-08-03 | **Remote Companion je samostatný release nad rozhraním core 1.0** | Core dodá verzovaný kontrakt; mobilní listener, pairing a UI nesmí blokovat lokální 1.0. |
| 2026-08-03 | **První podporovaná platforma je Linux + Theia + Ollama** | Na této kombinaci se měří install, runtime, GPU a release kvalita; další platformy nejsou pro 1.0 garantované. |
| 2026-08-07 | **Commitnutý `c3-chat-panel/lib` je současný autoritativní Studio runtime; stale TypeScript je pouze archiv.** | Package `build` ani `clean` jej nesmí přepsat nebo smazat. Případná budoucí relokace bude samostatná behavior-preserving změna, ne přepis funkčního UI. |
| 2026-08-07 | **Současné Studio UI není finální vizuální ani UX baseline.** | M0/M1 testy připínají funkční transport, security boundary, protokol, stabilitu a lifecycle; dnešní layout, styling a screenshot se nesmí povýšit na finální produktový kontrakt. |
| 2026-08-07 | **Chybějící browser `Origin` se normalizuje v Electron main pouze pro přesný capability-autorizovaný opaque Studio request.** | Existující renderer capability shim zůstává jediným producentem headeru. Main doplní jen `Origin: null`; nemění `Sec-Fetch-Site`, cíl ani capability. Legacy backend guard se neoslabuje a všechny neshody zůstávají fail-closed. |
| 2026-08-08 | **Modelový self-healing smí být jen explicitně opt-in, dočasný, auditovaný a vratný local failover.** | Desired binding se nemění discovery. Automatická aktivace je povolená až po společné kanonické identitě, ochraně delete/cleanup, oddělení desired/active stavu, pravdivém verify auditu a bezpečném restore. Do té doby se L0-9 nemění a současný auto-rebind zůstává blokovaný. |
| 2026-08-08 | **Studio v M1 při výpadku WS neposílá chat přes legacy HTTP fallback.** | Route neumí vynutit effect authority; pouhá oprava response parseru by byla false-green. M1 ukáže vratný `NOT_SENT` stav bez HTTP effectu, plná WS/HTTP parita se vrátí až nad M2 `EffectRequest/ApprovalGrant`. |

### Co to znamená pro rozsah

**V základu 1.0** — v pořadí podle závislostí:
server/routing/DB · CRE · konverzace · správa modelů · LLM gateway · QGv2 ·
chat pipeline · **Studio + WS bridge včetně `c3-ide/`** · expertizy · nástroje ·
skills · paměť · code intelligence · execution+patch · lifecycle · governance

K tomu **platforma specialistů + jeden E2E**, **platforma agentů + jeden E2E**
a interní verzované rozhraní pro budoucí Remote Companion.

**Mimo core release 1.0:** mobilní klient/listener/pairing · OpenCode · Serena ·
garance Windows/macOS · setup wizard. Notifikace, marketplace, media a upgrade
automatika se zařazují jen podle schváleného user journey a dependency DAG.

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
