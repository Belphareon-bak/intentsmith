# Devět rozhodnutí ke schválení

**2026-08-02** · `6c214aee` · adresát: operátor
**Důvod vzniku:** rozhodnutí operátora — schopnost po schopnosti je neefektivní.

---

## 0. Poctivě k tomu, co je odkud

První verze tohoto dokumentu psala o „nálezech". **Většinou to nálezy nebyly.**
`SYSTEM-MAP.md` už obsahuje:

| Co jsem „objevil" | Kde to už bylo |
|---|---|
| Adresáře neodpovídají schopnostem (`R1`) | `SYSTEM-MAP.md` § Schopnosti — *„Hranice schopností nekopírují adresáře"*, včetně mapování |
| Pět nedeklarovaných prerekvizit, 194/199 (`R4`) | `SYSTEM-MAP.md` § Spuštění |
| Rozložení `offline` vs `model` (`R3`) | `SYSTEM-MAP.md` § Kde se testuje bez modelu |
| Token streaming, rehydrate, shell krok | `SYSTEM-MAP.md` § Známý stav, který se vědomě neřeší |

Tenhle dokument tedy **nic z toho neobjevil — jen to převedl na rozhodnutí**.
`SYSTEM-MAP.md` popisuje stav a výslovně nerozhoduje; to je jeho role. Hodnota
níže je v tom, že se ze zaznamenaného stavu stane volba, ne v objevu.

**Skutečně nové z tohoto průchodu je jen dvojí:** 16 faktických odpovědí v §1
(inventury je měly jako otevřené otázky, `SYSTEM-MAP.md` je neřeší) a nález
v §2.

---

## 1. Zodpovězeno bez tebe — 16 položek

Ověřeno v kódu. Uzavírám je, pokud neřekneš jinak.

| # | Otázka | Zjištění |
|---|---|---|
| **G-3** | Kdo používá `LEGACY_DIRECT`? | **Jediné místo:** `routes/expertises.js:255`. Ne rozeseté obcházení. |
| **X-2** | Dva executory — stará a nová cesta? | **Ne, dvě různé cesty, obě živé.** `tool-executor.js` = chat, `c3-tool-executor.js` = build (`lifecycle-build.js`). |
| **A-2** | Jeden orchestrátor, nebo dva? | **Dva, žije jeden.** `architect/orchestrator.js` je dosažitelný přes `routes/architect.js` → `architect/index.js`. `planner/multi-agent.js` ne — §2. |
| **A-4** | Co edituje `editor.js` v governance? | `EditorLLM` — izolovaný editor bez kontextu konverzace, volaný výhradně z Orchestratoru po splnění gates. |
| **CI-2** | `perf-analyzer.js` — výkon čeho? | **Analyzovaného kódu**, ne C3. N+1, neohraničené smyčky, sync-in-async. *Advisory, neblokuje.* |
| **E-3** | 18 expertíz vs. 15 | Tři navíc nejsou v `expertise-layer.js` — pocházejí od specialistů. Potvrzuje `E-1`. |
| **T-3** | Proč je `npm-audit.js` mimo registr? | Obaluje `spawnSync` s timeouty a stropem výstupu 2 MB. Modul kolem procesu, ne deklarace nástroje. |
| **S-1** | Krok `shell` vs. zákaz shellu | **Není díra.** Whitelist (ne blacklist), sandbox na workspace, 120 s timeout. Zákaz `bash` v `AGENTS.md` platí pro *agenta*, ne pro produkt. |
| **L-3** | Tři „quality" | Tři různé věci: `quality-score` = spojité skóre 0–1, **není blocker**; `quality-gate` = syntax check před R1; `quality-gate-v2` = post-processing chatu. |
| **W-2** | Rehydrate — vada, nebo záměr? | **Vědomý stub**, `ws-server.js:241`: *„For now, acknowledge all — full DB validation in Phase 1.2"*. |
| **X-3** | Web search patří k nástrojům? | `tool-executor.js` je jeho jediný konzument. Vstup do `R1`. |
| **CI-3** | — | Bylo to pozorování, ne otázka. |
| **W-1, PA-3, EX-1(bezp.)** | | Odloženo podle `CONTRACT.md` §9. Provozní část `EX-1` je `R8`. |

---

## 2. Nález — `multi-agent.js` se nikdy nespustil

`src/planner/multi-agent.js` (396 ř.) **nemá v produkci konzumenta**:

```
multiAgentBuild, feasibilityGate, buildAgentPrompt, AgentRole
  grep přes src/          : 0 výskytů mimo vlastní soubor
  dynamické importy       : 0
  jediný importér         : tests/multi-agent.test.js
```

**Historie gitu to zpřesňuje.** `git log -S "multiAgentBuild("` přes všechny
větve vrací **jediný commit** — ten, který soubor přidal (`0e6a5e88`, v100).
Nebyl odpojen refaktorem. **Nikdy zapojený nebyl.**

Proč to není maličkost: implementuje pipeline `planner → builder → architect →
critic → debugger`, kterou `docs/ARCHITECTURE.md` vede jako hotovou —
*„Phase I (Governance) · 100% · … multi-agent"* — a `tests/multi-agent.test.js`
je zelený. Dokumentace tvrdí hotovo, test svítí zeleně, produkt to nevolá.

`SYSTEM-MAP.md` tohle nezachycuje; jeho sekce „Co je zastaralé" vyjmenovává jiné
rozpory (15 vs 18 expertíz, 11 vs 12 guardů). Tenhle je stejného druhu.

---

## 3. Devět rozhodnutí

U každého: **co navrhuju** a **protiargument** — nejsilnější důvod rozhodnout
opačně, ne slaměný panák.

---

### `R1` — Adresáře vs. schopnosti · sesypává 13 položek

~6 771 řádků leží v adresáři jiné schopnosti. `src/planner/` je domovem tří
schopností, `src/upgrade/` obsahuje základ i nadstavbu, 2 187 řádků
nízkoprioritních schopností je uvnitř základních.

**→ Navrhuju `C`: přesouvat až ve chvíli, kdy hranice brání psát seznam
chování.** Mapování zůstává v `SYSTEM-MAP.md`, kde už je. Přesun se stává
povinnou součástí práce na schopnosti, ne samostatnou úklidovou akcí.

> **Protiargument:** #1 i #2 došly do PASS, aniž se přesunul jediný soubor —
> empirický důkaz, že nesoulad PASS neblokuje, a moje věta „bez hranice není
> PASS" je tím oslabená. Kdo tomu věří, zvolí `B` (nechat, jen mapovat) a ušetří
> celý přesun. **Kde ten protiargument končí:** #1 a #2 jsou shodou okolností ty
> dvě schopnosti, jejichž kód rozstřelený *není*. Zkouška přijde u #11, kde 1 451
> z 6 900 řádků leží v `planner/`.

---

### `R2` — Kdy se dělí velký soubor

Precedenty jdou proti sobě: `C-4` — `cre-decision.js` (4 196 ř.) **nedělit**;
`N-6` — `system.js` (1 621 ř.) **rozdělit**. Menší soubor se dělí, větší ne.

**→ Navrhuju `B`: dělí se, až když seznam chování nejde napsat**, protože
soubor obsluhuje dvě nesouvisející věci. Řádky nerozhodují.

Sedí to na oba tvé precedenty: `cre-decision.js` seznam chování unesl (14 vět
o jedné věci — klasifikaci), `system.js` ne (GPU, úložiště, modely, proposals).

> **Protiargument:** kritérium je poznatelné až v kroku 2, tedy pozdě —
> u `registry.js` (5 094 ř.) se to dozvíš, až budeš psát chování #16. Řádkový
> práh je hrubý, ale dá se použít předem. A upřímně: **dva body ještě nejsou
> vzor.** Možná žádné kritérium nepotřebuješ a případ od případu stojí jednu
> krátkou úvahu, což je levnější než špatné pravidlo.

---

### `R3` — Co se dá odtrhnout od modelu

#5 QGv2 má **11 z 24 sad profil `model`**, přestože invariant **L0-5 zakazuje
QGv2 volat LLM**. Buď je prerekvizita zbytečná, nebo ty sady testují něco
jiného, než tvrdí.

**→ Navrhuju `A`, ale jen pro #5.** U QGv2 je to prokazatelný rozpor
s invariantem. #10 a #7 nechat — tam je závislost na modelu věcná.

> **Protiargument:** `CONTRACT.md` §4 říká, že existující testy se **mapují,
> nepřepisují**, a co se nenamapuje, je kandidát na archivaci. Rozdělovat sady
> teď může být práce, kterou krok 2 u #5 stejně zahodí. Navíc §7 chce po každé
> změně demonstrovatelný efekt — přeskládání testů žádný nemá. **Čistší postup:
> nedělat nic, dojít k #5 a nechat rozdělení vyplynout ze seznamu chování.**

---

### `R4` — Nedeklarované prerekvizity

Pět sad potřebuje Python PDF runtime nebo Go, a v registru mají
`offline`/`ollama:false`. `CONTRACT.md` §5: nedeklarovaná prerekvizita je **vada
evidence**.

**→ Navrhuju `A`: deklarovat a přeřadit na `BLOCKED` teď**, instalaci runtime
řešit až s releasem.

> **Protiargument:** deklarace srazí titulkové číslo z 199 na 194 přesně ve
> chvíli, kdy se chystá merge a Gate 0 kandidát. Kdo chce mít čísla vysoká,
> doinstaluje runtime v `install.sh` a prerekvizita zmizí místo toho, aby se
> přiznala. **Proč to přesto nedoporučuju:** 194 z 199 je pravda a 199 z 199
> není; `CONTRACT.md` §1 stojí na tom, že objem nic nedokazuje.

---

### `R5` — Rozsah 1.0 · pět krátkých

| Věc | Návrh | Protiargument |
|---|---|---|
| **Token streaming** (`W-3`) | **Nedělat teď.** Zapsat jako chování #21, které je 8. v pořadí. Sahá do #3, #6 i #21 — žádná z nich nemá seznam chování. | Je to jediná položka, kterou uživatel pozná **okamžitě**. Produkt s 15 zelenými schopnostmi, kde odpověď přijde po deseti vteřinách vcelku, působí pomalu bez ohledu na důkazy. |
| **`c3-ide/`** (`W-4`) | **Mimo 1.0**, opřít se o web UI `/architect` (ověřeno: 200, 74 KB). | 32 rozšíření a Phase E na 85 % je hodně odvedené práce k odložení. Pro část uživatelů **je IDE ten produkt**, ne web UI. |
| **`roadmap.js`** (`A-3`, 325 ř.) | **Nechat, nepřeřazovat.** Malé, funkční, uvnitř architect módu. | Je to funkce navíc v produktu, který ještě neumí prokázat základ. |
| **`export-pipeline.js`** (`K-2`, 517 ř.) | **Nechat v #4.** Přeřazení je přejmenování, ne zlepšení. | Táhne s sebou `R4` — je to jediný důvod prerekvizity Python PDF runtime. |
| **`preferences.js`** (`PA-1`, 715 ř.) | **Nechat v #15**, vyřešit v jejím seznamu chování. | Stejný vzor jako #18: dvě věci pod jedním jménem. Tam ses rozdělit rozhodl. |

---

### `R6` — #6 potřebuje hlubší inventuru

Inventura #6 je **vědomě mělčí** — 20 400 řádků a 46 souborů se strukturálním
průchodem vyčerpat nedá. #6 je 7. v pořadí.

**→ Navrhuju udělat hlubší průchod dřív, než na #6 dojde řada**, jako
samostatný úkol. `CONTRACT.md` §7 na to potřebuje tvůj souhlas, protože #6
teď na řadě není.

> **Protiargument:** je to práce dopředu na schopnosti, která je šestá v pořadí
> od té současné — do té doby se kód změní a část průchodu zestárne. Levnější
> je dojít k #6 normálně a udělat inventuru tehdy. **Proti tomu stojí jen to,**
> že #6 je 20 400 řádků a zjistit její rozsah pozdě znamená zablokovat pořadí.

---

### `R7` — `multi-agent.js`

**→ Navrhuju `A`: smazat soubor i jeho test.** Historie ukazuje, že nikdy
zapojený nebyl — `B` (zapojit) by tedy nebyla obnova, ale **nová funkce**,
a ta patří do rozhodnutí o rozsahu, ne do úklidu.

> **Protiargument:** 396 řádků implementuje smysluplnou věc — feasibility gate,
> pět rolí, kritik s max 2 iteracemi opravy. `lifecycle-build.js` (2 138 ř.)
> dnes staví jednofázově; ta pipeline by mu měla co dát. Smazat něco hotového,
> co stačí zavolat, může být dražší než to nechat ležet. **Kde to selhává:**
> „stačí zavolat" je odhad — kód, který nikdy neběžel v produkci, není hotový,
> je nevyzkoušený. A zelený test nad ním aktivně **lže o stavu produktu**.

---

### `R8` — `EX-1` blokuje merge · **P0**

Mobilní větev definuje `G0-R021` jako neautentizované RCE, trunk pod týmž ID
vede něco jiného, `GATE0-RISK-IMPACT.json` na to nemá entry. Merge v současné
podobě shodí `G0-C9`, a tím celý Gate 0.

**→ Navrhuju opravu podle hotového návrhu** (přejmenovat na `G0-R032`
+ připravená JSON entry) jako součást jedné merge dávky.

> **Protiargument:** žádný věcný. Jediná volba je **kdy** — teď, nebo až se
> bude mergovat. Odklad znamená, že ta past leží nastražená dál.

---

### `R9` — #18b: 9 470 řádků, které si nikdo nevyžádal

**~1 475 řádků síťových klientů** chodí na internet hledat modely — v local-first
produktu **jediná plocha, která z principu volá ven**. `model-universe-store.js`
má 1 919 řádků.

**→ Navrhuju kód nemazat, ale síťovou část nechat vypnutou a mimo rozsah 1.0.**
Invariant L0-9 drží (nikdy neupgraduje sám), takže to není riziko — je to objem.

> **Protiargument:** „ponecháno, ale vypnuto" je nejhorší ze tří možností —
> platí se údržba a plocha, a nezískává se funkce. Buď to má být v produktu
> a pak ať se ověřuje, nebo nemá a pak ať se vyřízne do pluginu. Půlka
> rozhodnutí je způsob, jak ho neudělat.

---

## 4. Jak to schválit

Stačí `R1: C, R2: B, …` a u čeho chceš protiargument, napiš to místo písmene.

Po schválení jde psát seznamy chování pro všech 20 zbývajících schopností
naráz — zbylé otázky jsou už jen uvnitř schopností, ne mezi nimi.

Hotové: **#1 PASS** (13/13) · **#2 PASS** (10/10 + 9/9).
