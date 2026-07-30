# IntentSmith — Roadmapa 1.0

**Verze kódu:** 135.0.0
**Datum:** 2026-07-30
**Stav:** Gate 0 baseline candidate; autoritativní verdikt je pouze v
[convergence/STATUS.md](convergence/STATUS.md)
**Autorita pro verdikty:** [convergence/GATE-CRITERIA.md](convergence/GATE-CRITERIA.md)

---

## Co se změnilo proti C3 roadmapě v17

Tento dokument nahrazuje roadmapu C3-Agent v17. Historická verze je
v [archive/ROADMAP-v17-C3.md](archive/ROADMAP-v17-C3.md).

Předchozí roadmapa uváděla „~98 % celkové vize hotovo", čtyři pilíře na 100 %
a „~3 600+ verified tests". Gate 0 tato tvrzení nepotvrdil. Nešlo o to, že by
kód nefungoval — šlo o to, že **pro ta tvrzení neexistoval ověřitelný podklad**:

- 30 z 30 schopností v [CAPABILITY-MATRIX.md](convergence/CAPABILITY-MATRIX.md)
  je `UNVERIFIED` nebo `BASELINE_RED`;
- z 350 registrovaných testovacích programů je 25 `KNOWN_DEFECTIVE`
  (false-green vzory: `assert(true)`, předčasné návraty, akceptace HTTP 5xx)
  a 54 `BLOCKED` na prostředí;
- test harness hlásil zelenou i tam, kde běh selhal;
- registr testů byl neúplný — část spustitelných programů v něm nebyla.

Roadmapa proto **přestává měřit procenta hotovosti a začíná měřit stav důkazů.**
Procentní ukazatele typu „Pilíř 1 — 100 %" jsou z dokumentu odstraněny, protože
nebyly odvozené z ničeho měřitelného. Nahrazuje je evidenční stav per schopnost,
který má definovaný způsob výpočtu.

To není degradace rozsahu produktu. Vize i pilíře zůstávají. Mění se jen to, co
smí být označeno za hotové.

---

## Základní pravidlo

> **Nejdřív důkaz, potom funkce.**
>
> Žádná schopnost není hotová, dokud pro ni neexistuje důkaz reprodukovatelný
> třetí stranou ze samotného commitu. Žádná fáze se neotevírá, dokud předchozí
> gate nedrží.

Důsledky, které jsou v 1.0 nezpochybnitelné:

1. Deterministický `required` failure znamená FAIL, ať je zeleného cokoli.
2. `KNOWN_DEFECTIVE` sada se nikdy nepočítá jako zelený důkaz.
3. Blokovaná sada musí pojmenovat **konkrétní** chybějící prerekvizitu.
4. Verdikt platí ke commitu a fingerprintu registru; jakákoli změna ho ruší.
5. Evidence se generuje, nepíše.

---

## Kde jsme skutečně

Čísla níže jsou odvozená z `tests/registry.json` a validátorů, ne odhadnutá.
Reprodukce: `node scripts/validate-test-registry.js`,
`node scripts/validate-final-disposition.js`.

| Ukazatel | Hodnota |
|---|---:|
| Registrované spustitelné programy | 350 |
| Explicitní support/aggregate výjimky | 8 |
| `ACTIVE` | 256 |
| `BLOCKED` (chybí prostředí) | 54 |
| `KNOWN_DEFECTIVE` (vadné aserce) | 25 |
| `HISTORICAL` | 15 |
| Rozsah G0-C5 (`offline` + `database`, required) | **199** |
| Klasifikované dispoziční záznamy | 225 (validní) |
| Schopnosti s aktuálním akceptačním důkazem | **0 z 30** |

Dříve známý deterministický failure `tests/pilot-c1c2c3.test.js` A9 (quality
engine označoval všech 10 výstupů jako `EXCELLENT`) je **opravený v `f38f5e8`** —
sada hlásí 44 passed, 0 failed, exit 0.

Gate 0 tím ale nepřechází na PASS. Zbývá čistý kandidátní strom (G0-C1),
generovaná evidence (G0-C8) a skutečné spuštění celého rozsahu 199 sad na
výsledném commitu (G0-C5). Jeden opravený test není důkaz o zbylých 198.

---

## Gate ladder

Gate 0 se netýká kvality produktu. Týká se toho, jestli lze čemukoli o produktu
věřit. Teprve gaty po něm mluví o produktu.

```
Gate 0  DŮVĚRA V MĚŘENÍ        ← kandidát čeká na finální evidenci/review
        ├─ čistý strom, oba validátory zelené
        ├─ čistá instalace reprodukovatelná
        ├─ 199 deterministických required T1/T2 sad prochází
        ├─ žádná KNOWN_DEFECTIVE jako zelený důkaz
        └─ evidence generovaná z verdiktního commitu
              ↓
Gate 1  AKCEPTAČNÍ DŮKAZ       0 z 30 schopností
        └─ každý řádek CAPABILITY-MATRIX dostane vlastní důkaz, po jednom
              ↓
Gate 2  PRAVDIVÉ E2E           0 z 78 sad aktivováno
        └─ izolace → pravdivé exity → skutečný běh, per sada
              ↓
Gate 3  RELEASE                blokováno otevřeným privacy incidentem
        └─ P-001..P-003 uzavřeny
```

Žádné hromadné povyšování. Řádek matice se posouvá jednotlivě, s vlastním
důkazním záznamem.

---

## Vize — 6 pilířů

Pilíře se nemění. Mění se jen sloupec „stav".

### Pilíř 1: CHAT — náhrada ChatGPT
Kvalitní konverzační AI s generováním dokumentů a expertise specializací.
CRE jako jediná autorita nad routingem, 19 typů záměrů, deterministický
Quality Gate v2.

### Pilíř 2: PROJEKTY — stavění věcí
Lifecycle engine SPEC → PLANNING → BUILD → REVIEW → CHANGE → COMPLETED,
execution engine s iterativním fix cyklem, Code Intelligence.

### Pilíř 3: WORKERI — autonomní hlídací psi
24/7 monitoring s notifikacemi (email, Telegram, ntfy, webhook, desktop, push).

### Pilíř 4: SPECIALISTÉ — komplexní on-demand agenti
Self-contained pluginové balíčky, `ctx.registries`, N:M capability routing.

### Pilíř 5: IDE — vlastní vývojové prostředí
C3 Studio: Theia 1.65.2 + Electron 37, custom panely.

### Pilíř 6: PRODUKT — balíčkování a ochrana
Installer, licence, auto-update, setup wizard.

### Evidenční stav pilířů

Stav = stav důkazů, ne odhad hotovosti. Mapování na
[CAPABILITY-MATRIX.md](convergence/CAPABILITY-MATRIX.md).

| Pilíř | Schopnosti | Nejhorší stav v pilíři | Co chybí k Gate 1 |
|---|---|---|---|
| 1 CHAT | C3-002..004, C3-008, C3-011 | `BASELINE_RED` | CRE klasifikační sada zelená; jeden zdroj klasifikátoru je poškozený |
| 2 PROJEKTY | C3-005..007, C3-009, C3-018, C3-019 | `BASELINE_RED` | lifecycle a AST/symbol sady zelené na čistém commitu |
| 3 WORKERI | C3-015, C3-021 | `UNVERIFIED` | aktuální sada vůbec nespuštěna |
| 4 SPECIALISTÉ | C3-012..014, C3-022 | `BASELINE_RED` | specialist boot failures v registru |
| 5 IDE | C3-001, C3-023 | `UNVERIFIED` | kritický UI flow nespuštěn |
| 6 PRODUKT | C3-026, C3-028..030 | `BASELINE_RED` | dokumentační a instalační kontrakty |

---

## Plán 1.0 podle gatů

### Gate 0 — zbývá

| # | Úkol | Priorita | Stav |
|---|---|---|---|
| G0-1 | Izolace E2E na runner-owned root (7 posledních sad) | 🔴 P0 | ✅ hotovo |
| G0-2 | Doplnit registr na úplnost (2 neregistrované programy) | 🔴 P0 | ✅ hotovo |
| G0-3 | Opravit `pilot-c1c2c3` A9 — quality engine nerozlišuje kvalitu | 🔴 P0 | ✅ hotovo (`f38f5e8`) |
| G0-4 | Izolovat autoritativní běhy přes `C3_DB_PATH`; produktový import-side-effect ponechat jako transparentní residual risk (`G0-R012`) | 🔴 P0 | ✅ runner + self-test; produktové chování nezměněno |
| G0-5 | Discovery registru podle spustitelnosti, ne názvu; explicitní výjimky (`G0-R013`) | 🟡 P1 | ✅ 350 programů + 8 explicitních výjimek; meta-test dokazuje nekonvenční název |
| G0-6 | Generátor evidence — status, index, baseline report a review packet z čistého kandidáta (`D-020`) | 🔴 P0 | ✅ implementováno; finální běh čeká na kandidátní SHA |
| G0-7 | Každý `REBUILD` záznam do koncového stavu (`D-018`) | 🟡 P1 | přesunuto do per-suite Gate 2 aktivace; Gate 0 validator má 225/225 resolution |
| G0-8 | Každý registry-`BLOCKED` řádek s konkrétní prerekvizitou (G0-C7) | 🟡 P1 | ✅ 0 řádků bez server/external/Ollama/GPU důvodu |
| G0-9 | Čistá instalace + celý rozsah G0-C5 z výsledného commitu | 🔴 P0 | ❌ |
| G0-10 | Rozhodnout rozsah izolace pro T1 (43 sad ve sdíleném `/tmp`, `G0-R014`) | ⚪ P2 | residual risk; nešlo o novou Gate 0 regresi |

### Gate 1 — akceptační důkaz per schopnost

Po jednom řádku matice. Pořadí podle rizika, ne podle snadnosti:

1. **C3-024** SQLite a migrace — je pod tím všechno ostatní; navíc přímo souvisí
   s `G0-R012`.
2. **C3-003** CRE routing — jediná autorita nad chováním celého chatu.
3. **C3-008** deterministické quality gates — bez nich nelze měřit nic dalšího
   a je to zdroj `pilot-c1c2c3` failure.
4. **C3-005 / C3-006** lifecycle a workflow.
5. **C3-018 / C3-019** Code Intelligence a symbol backend.
6. Zbytek podle závislostí.

### Gate 2 — postupná aktivace E2E

78 obnovených sad, po jedné, tři podmínky per sada (izolace → pravdivé exity →
skutečný běh). Rozpad práce:

Následující kategorie **nejsou rozkladem těch 78** — překrývají se. Sada může
být zároveň blokovaná na prostředí a mít vadné aserce; sedm izolovaných sad je
podmnožinou blokovaných. Součet 7 + 25 + 54 = 86 tedy neodpovídá 78 a ani nemá.

| Osa | Počet | Co je potřeba |
|---|---:|---|
| Izolace přepojena na runner-owned root | 7 | ⊂ blokovaných; čeká na prostředí |
| Registrový stav `KNOWN_DEFECTIVE` (vadné aserce) | 25 | oprava asercí + before/after důkaz |
| Registrový stav `BLOCKED` (chybí prostředí) | 54 | pojmenovat prerekvizitu, pak hardware |

Autoritativní je registrový stav, ne tahle tabulka. Přesný rozklad bez překryvů
vznikne až při per-suite klasifikaci do koncových stavů `D-018` — a právě proto
je ta klasifikace Gate 0 podmínka, ne úklid.

Sada, která splní izolaci a pravdivé exity, ale nemůže běžet z environmentálních
důvodů, se uzavírá jako `REBUILD/DEFERRED(<prerekvizita>)`. To je koncový stav,
ne nedodělek.

### Gate 3 — release

Blokováno otevřeným privacy incidentem. Vyžaduje uzavření operátorských
rozhodnutí `P-001` (viditelnost repozitáře), `P-002` (rotace credentials),
`P-003` (remediace veřejné historie).

Privacy incident **není** položka v seznamu prerekvizit a CONDITIONAL PASS ho
nepohlcuje. Má vlastní verdikt.

---

## Paralelní bezpečnostní track — vzdálená hranice

Tento track není mobilní implementace. S-1 až S-4 platí pro současný server
bez ohledu na budoucího vzdáleného klienta. Po Gate 0 může pokračovat samostatně;
do té doby se stávající listener nesmí bindovat mimo loopback.

| # | Úkol | Priorita | Stav |
|---|---|---|---|
| S-1 | `G0-R018` — zdokumentovat a zachovat loopback-only hranici současného listeneru | 🔴 P0 | ❌ otevřeno |
| S-2 | Navrhnout oddělený listener pro vzdálený přístup; legacy `/api/*` a `/c3/ws` zůstávají pouze na loopbacku | 🔴 P0 | ❌ |
| S-3 | Zavést autentizaci a scope enforcement pouze na oddělené vzdálené hranici | 🔴 P0 | ❌ |
| S-4 | Přidat negativní testy dokazující, že vzdálený peer neobejde hranici přes legacy API ani WS terminál | 🔴 P0 | ❌ |

Pairing, mobilní kontrakt a mobilní UI nejsou součástí tohoto tracku ani Gate 0.

---

## Odloženo na 1.1

| Co | Důvod | Rozhodnutí |
|---|---|---|
| OpenCode a Serena benchmarky | nesouvisí s obnovou baseline | `D-007` |
| Náhrada C3 executoru | C3 executor zůstává 1.0 incumbent | `D-006` |
| Náhrada C3 Code Intelligence | totéž | `D-006` |
| IDE Settings Phase 3b (OAuth, GitHub Gist sync) | rozšiřuje security surface před uzavřením incidentu | — |
| IDE Settings Phase 4 (GPU wizard, model auto-download) | závisí na Gate 1 pro C3-010 | — |
| Electron builder, installer dist | závisí na Gate 3 | — |
| Kalibrace quality score na reálných datech | závisí na opravě C3-008 | — |

---

## Co bylo z roadmapy odstraněno a proč

| Odstraněno | Důvod |
|---|---|
| „~98 % celkové vize hotovo" | neodvozené z měřitelného podkladu |
| „Pilíř 1/2/4 — 100 % ✅" | 0 z 30 schopností má akceptační důkaz |
| „~3 600+ verified tests" | 25 sad je `KNOWN_DEFECTIVE`, 54 `BLOCKED`; „verified" neplatilo |
| Sprint 1–6 s ✅ značkami | sprinty popisovaly C3 historii, ne směr IntentSmithu; nahradil je gate ladder |
| Timeline s progress bary | procenta bez definice výpočtu |
| Detailní specifikace IDE Settings (~350 řádků) | je to produktová specifikace, ne roadmapa — patří do vlastního dokumentu |
| Fáze H hardening tabulka | uzavřená C3 historie, přesunuto do archivu |
| Quality Score architektura (~70 řádků) | duplikovala [ARCHITECTURE.md](ARCHITECTURE.md); roadmapa na ni jen odkazuje |

Nic z odstraněného obsahu není smazané — historická roadmapa zůstává
v [archive/ROADMAP-v17-C3.md](archive/ROADMAP-v17-C3.md) a je dohledatelná
v Git historii.

---

## Související dokumenty

| Dokument | Role |
|---|---|
| [convergence/GATE-CRITERIA.md](convergence/GATE-CRITERIA.md) | normativní definice verdiktů |
| [convergence/STATUS.md](convergence/STATUS.md) | který verdikt platí a ke kterému commitu |
| [convergence/CAPABILITY-MATRIX.md](convergence/CAPABILITY-MATRIX.md) | evidenční stav 30 schopností |
| [convergence/RISK-REGISTER.md](convergence/RISK-REGISTER.md) | otevřená rizika |
| [convergence/DECISIONS.md](convergence/DECISIONS.md) | uzamčená rozhodnutí a čekající operátorská |
| [convergence/TEST-REGISTRY.md](convergence/TEST-REGISTRY.md) | generovaný ledger testů |
| [ARCHITECTURE.md](ARCHITECTURE.md) | technická architektura |

---

*Roadmapa 1.0. Nahrazuje C3-Agent roadmapu v17. Stav odvozen z registru
a validátorů k 2026-07-30; není to verdikt — ten definuje `GATE-CRITERIA.md`
a nese ho `STATUS.md`.*
