# Nezávislé ověření a mapa stavu repozitáře

**Datum:** 2026-08-01
**Ověřováno proti:** `17a8b9a80137222233dceaf24a3d2cfbe55b06e0` (`codex/s1-legacy-loopback-containment`)
**Prostředí:** čerstvý kontejner, čerstvý klon, Node v22.22.2, npm 10.9.7, Linux x64
**Status:** poznámky externího čtenáře; **žádný řádek zde není evidence**

Legenda: **[M]** změřeno mnou v tomto prostředí · **[F]** ověřený fakt v repu · **[R]** doporučení

---

## 1. Co jsem skutečně spustil

Tři validátory, všechny **bez `node_modules`** — čtou výhradně Git objekty
a commitnuté soubory. To odpovídá kontextu `COMMITTED_DATA_ONLY_VALIDATION`
z `GATE-CRITERIA.md` § Independent reproducibility.

### [M] `npm run gate0:validate-attestation`

```
Gate 0 attestation valid: 17a8b9a80137222233dceaf24a3d2cfbe55b06e0
  attests da485841c7016887c9bd4f969271e0d365020b2f; 4 generated files only
exit 0
```

### [M] `node scripts/validate-test-registry.js`

```
Test registry valid: 350 runnable programs,
  sha256 21992f9fcc1625c14baa0a7d53771a88e4f704e97e4c276f4d4b8fd9ea08cd73
exit 0
```

### [M] `node scripts/validate-final-disposition.js`

```
Disposition valid: 225 records;
  manifest=aa95bbc0918daa3f188283297e03562e3a4b8a8d0b178bec126b60a27cd8677e;
  dispositions={"EXCLUDE":91,"KEEP":42,"REBUILD":92};
  terminals={...,"REPAIRED":60};
  resolutions={"ABSENT":91,"EXACT":32,"MAPPED_REPAIR":3,"MODIFIED":99}
exit 0
```

### [M] Křížová kontrola fingerprintu

Fingerprint registru, který jsem přepočítal z čistého stromu
(`21992f9f…cd73`), je **totožný** s tím, který attestation váže jako
kandidátní. Nezávisle přepočítaná hodnota a hodnota v evidenci se shodují.

---

## 2. Co z toho plyne — a co ne

### Co je tím doloženo

`GATE-CRITERIA.md` § FAIL uvádí jako podmínku selhání:

> a validator cannot run from a fresh clone of the IntentSmith remote — for
> example because it dereferences a revision that no ref in this repository
> contains.

**[M] Tato podmínka je vyvrácena.** Všechny tři validátory doběhly z čerstvého
klonu, v jiném prostředí, na jiném stroji, bez jakéhokoli lokálního stavu
a bez instalovaných závislostí. Nic nedereferencovalo revizi, kterou by
repozitář neobsahoval.

To je částečný, ale skutečný příspěvek k **`G0-R015`** (P1, OPEN — *„no
independent party has reproduced it … Independent read-only execution remains
pending"*).

### Co tím doloženo NENÍ

Tohle je nutné číst stejně přísně jako všechno ostatní v tomhle repu:

| Nedoloženo | Proč |
|---|---|
| Plná reprodukce Gate 0 | Nespustil jsem devítifázový producer ani 199 deterministických sad. Ověřil jsem **validátory a vazby**, ne kandidátní běh |
| Nezávislé review | Review je definované jako `C→E→R→A` řetěz s vlastním schématem výsledku. Tohle není review packet a nemůže žádný nahradit |
| Uzavření `G0-R015` | Riziko zůstává `OPEN`. Posouvá se jen jeho důkazní základ, ne stav |
| Cokoli o kvalitě produktu | Gate 0 je o důvěře v měření. Nic z výše uvedeného neříká, že produkt funguje |

**[R]** Nález zapsat jako doplňkový důkaz k `G0-R015`, **nikoli** jako důvod
ke změně jeho stavu. Změnu stavu smí udělat až skutečné nezávislé review.

---

## 3. Mapa větví

Tohle byl nejdražší poznatek celého čtení: repozitář obsahuje **dvě nesouvisející
kódové linie** a rozdíl mezi nimi není z `main` poznat.

```
main  (6676902c)  ─── IntentSmith donor ─── NENÍ předkem ničeho níže
                        │
                        └── local-validation-runner (+4)

codex/intentsmith-1.0  (+592 proti main)      ── C3 produktový trunk
        │
        └── codex/s1-legacy-loopback-containment  (+609)   ← HLAVA, Gate 0 PASS
                    ▲
                    │ 119 pozadu / 16 napřed
                    │
        mobile/plan-and-security-boundary
```

### [M] Ověřená topologie

| Vztah | Výsledek |
|---|---|
| `main` je předkem `codex/s1-…` | **NE** |
| `codex/intentsmith-1.0` je předkem `codex/s1-…` | ANO |
| `mobile/…` je předkem `codex/s1-…` | **NE** (16 napřed / 119 pozadu) |

### [F] `main` je donor, ne trunk

`AGENTS.md` § Baseline uvádí `IntentSmith donor: 6676902c5f6fe7a5d66aba0d79cb502e0f3a60e4`.
To je přesně současný `origin/main`. `AGENTS.md` § Product and scope dodává:
*„C3 is the product trunk; the existing IntentSmith repository is a donor."*

Tohle je správně a záměrně. Riziko je jen v tom, že **výchozí větev
repozitáře je donor**, takže kdokoli, kdo repozitář naklonuje bez přečtení
`AGENTS.md`, začne číst špatný strom a všechny jeho závěry budou neplatné.
Viz `EX-4`.

### [M] Stav donoru

Donor `6676902c` jsem pro pořádek ověřil, protože je vstupem pro `C3-029`
a `C3-030`:

```
pnpm install --frozen-lockfile   OK (204 balíčků)
pnpm build                       OK
pnpm test                        869 testů / 55 souborů — vše zelené
pnpm test:coverage               92,81 % stmts | 84,38 % branch
                                 93,45 % func  | 94,57 % lines
                                 (prahy 90/82/88/92 splněny)
```

Donor je tedy jako vstupní materiál v pořádku a jeho testy drží.

---

## 4. Nálezy

Číslované `EX-` (external), aby se nepletly s `G0-R`. Návrh cílového ID je
u každého, který si zápis do registru zaslouží.

---

### `EX-1` — kolize ID rizika `G0-R021` mezi větvemi · **P0** · blokuje merge mobilní větve

**[M] Ověřeno diffem.** Dvě různá rizika sdílejí totéž ID na dvou větvích:

| Větev | `G0-R021` | Severity | Stav |
|---|---|---|---|
| `codex/s1-…`, `codex/intentsmith-1.0` | Pět soak programů deklarovaných jako `network:none`/`ollama:false`/`gpu:false`, které volají `CREDecisionEngine.decide()` ve smyčkách | P1 | `MITIGATED` |
| `mobile/plan-and-security-boundary` | **Neautentizované vzdálené spuštění příkazů, jakmile listener opustí loopback** | P0 | `OPEN` |

Mobilní větev přidává svůj řádek do `RISK-REGISTER.md`, ale
**neaktualizuje `GATE0-RISK-IMPACT.json`** — diff té větve mění 9 souborů
a tenhle mezi nimi není.

**Důsledek podle `GATE-CRITERIA.md` § Risk impact policy:**

> Validation fails closed. A missing or **duplicate entry** … or newly added
> unclassified open/local risk makes G0-C9 fail.

Merge mobilní větve v současné podobě tedy **shodí `G0-C9`, a tím celý Gate 0**.
Selhání je fail-closed, což je správné chování — ale nastane až při merge,
zatímco vyřešit se to dá teď za pár minut.

Druhý, tišší problém: kdyby se řádky někdy slily bez konfliktu, RCE nález by
zdědil klasifikaci `G0_FAIL` po soak programech. To je sémanticky špatně —
patří mu `LATER_GATE` s podmínkou, stejně jako `G0-R018`.

**[R] Řešení:** přejmenovat řádek na mobilní větvi na první volné ID (registr
má 31 řádků, nejvyšší je `G0-R031` → **`G0-R032`**) a doplnit odpovídající
entry do `GATE0-RISK-IMPACT.json`:

```json
{
  "riskId": "G0-R032",
  "gateImpact": "LATER_GATE",
  "rationale": "Unauthenticated remote code execution is reachable only if the legacy listener leaves loopback; the separate authenticated boundary is an explicitly post-Gate-0 track.",
  "condition": "The legacy listener must remain loopback-only. Off-loopback binding, any remote listener and any pairing surface are prohibited until S-2..S-4 exist and their bypass-negative tests pass."
}
```

Formulace podmínky je záměrně shodná s tím, co `PLAN.md` §8.1 označuje jako
`GAP-2`, aby dvě místa neříkala dvě různé věci.

---

### `EX-2` — P0 nález o RCE žije jen na odstavené větvi · **P1**

**[F]** Nejzávažnější bezpečnostní nález projektu — s konkrétními důkazy na
úrovni řádků (`src/server.js:1086`/`:1094`, `src/routes/security.js:20`,
`src/ws-bridge/ws-server.js:126`, `src/ws-bridge/session-adapter.js:398`) —
existuje **pouze** na `mobile/plan-and-security-boundary`, tedy 119 commitů
pozadu a nesloučeně.

Na trunku je jeho podstata pokryta přes **`G0-R018`** (OPEN, `LATER_GATE`,
podmínka *„legacy listener must remain loopback-only"*), takže **díra
v evidenci to není**. Chybí ale ta konkrétní část: `G0-R018` popisuje hranici,
`G0-R021`-na-mobilní-větvi popisuje **přesně které řádky ji drží otevřenou**
a že `validateApiToken()` je hotová funkce bez importu
(`// TODO (Phase 3b): Wire into route-level middleware`).

To je přesně ten materiál, který potřebuje `S-3`. Dnes ho ale implementátor
`S-3` na své větvi nevidí.

**[R]** Přenést důkazní část na trunk společně s `EX-1` — je to jeden a týž
zásah do jednoho souboru.

---

### `EX-3` — `ROADMAP.md` je o jeden commit pozadu za vlastním verdiktem · **P2**

**[M]** `docs/ROADMAP.md` naposledy měnil `da485841`; `docs/convergence/STATUS.md`
až `17a8b9a8` (promotion). Roadmapa proto stále popisuje stav před promotion:

| Místo v `ROADMAP.md` | Říká | Skutečnost |
|---|---|---|
| Gate ladder | `Gate 0 … ← nový kandidát čeká na vlastní C→E→R→A` | Řetěz je kompletní, verdikt **PASS** |
| § Kde jsme skutečně | *„současná větev potřebuje nový čistý běh, attestation, review receipt a promotion"* | Všechny čtyři proběhly |

**Není to nepravdivé tvrzení** — hlavička roadmapy sama říká *„autoritativní
verdikt je pouze v `convergence/STATUS.md`"*, takže dokument správně deleguje
autoritu. Je to zastaralost, ne false-green.

**[R] Neopravovat samostatně.** Oprava `ROADMAP.md` je non-evidence
documentation change, tedy zneplatní kandidáta a vynutí celý nový
`C→E→R→A` běh. Za opravu jedné věty se to nevyplatí. Přibalit k nejbližší
změně, která kandidáta ruší tak jako tak.

---

### `EX-4` — výchozí větev repozitáře je donor · **P2**

**[M]** `git clone` bez dalších parametrů vytáhne `main`, tedy donor. Donor má
vlastní `README.md`, vlastní `docs/STATUS.md` a vlastní roadmapu, které
popisují jiný produkt (greenfield IntentSmith, fáze 0–8) a o C3 trunku,
Gate ladderu ani `CAPABILITY-MATRIX.md` nevědí.

Že jde o donor, se čtenář dozví až z `AGENTS.md` **na C3 větvi**, kterou v tu
chvíli nemá naklonovanou.

Tenhle nález je zvlášť nepříjemný proto, že je to přesně ta třída problému,
kvůli které Gate 0 vznikl: dokument, který zní autoritativně, ale popisuje
něco jiného, než si čtenář myslí.

**[R]** Levná varianta bez zásahu do kandidáta: přepnout výchozí větev
repozitáře na GitHubu na `codex/intentsmith-1.0`. Je to nastavení
repozitáře, ne commit, takže **kandidáta to nezneplatní**. Dražší varianta
(nadpis v `main/README.md`) kandidáta ruší.

---

### `EX-5` — donor: `pnpm test` bez předchozího `pnpm build` shodí 13 testů · **P3**

**[M]** Na donoru (`6676902c`) selže 13 testů ve dvou souborech —
`apps/server/src/startup-refusal.process.test.ts` a
`apps/server/src/opencode/restart-recovery.process.test.ts` — s
`ERR_MODULE_NOT_FOUND` na `@intentsmith/contracts/dist/index.js`.

**Není to defekt.** Oba soubory spouštějí reálný child proces, který
workspace balíčky resolvuje přes `dist/`. Po `pnpm build` projde všech 869.
`pnpm verify` build obsahuje, takže CI to nikdy nepotká.

Dopad je čistě na čtenáře: kdo si donor naklonuje a spustí `pnpm test`,
uvidí červenou a může usoudit, že donor je rozbitý. Vzhledem k tomu, že
donor je vstupem pro `C3-029` a `C3-030`, to za zápis stojí.

**[R]** Nízká priorita, donorová strana, neblokuje nic na trunku.

---

### `EX-6` — deterministická sada se z čerstvého klonu nereprodukuje · **P1**

**[M] Změřeno spuštěním `npm test` na čistém stroji** (Node 22, `npm install`,
nic dalšího). Audit vydal verdikt **FAIL**: `{"PASS":193,"FAIL":6}`.

Po zastavení mého vlastního běžícího serveru a čistém přeběhu jednotlivých sad:

| Sada | Příčina | Skutečný nález? |
|---|---|---|
| `export-pdf-docx` | chybí Python PDF runtime (`scripts/install-pdf-runtime.sh`) | ANO |
| `chat-export-budget` | totéž, 4 aserce | ANO |
| `quality-gate` | `go` není dosažitelné v izolovaném PATH testu, ačkoli v systému je | ANO |
| `multi-source-integration` | exit 1, přestože všechny viditelné aserce projdou | ANO, nutno prošetřit |
| `nightly-audit-runner-self-test` | exit 1 na scénáři s `BLOCKED` model testem | ANO, nutno prošetřit |
| `dependency-manager` | souběh s mým běžícím serverem nad toutéž DB | NE — samostatně 25/25 |

**Čistý stav je tedy 194/199, ne 199/199.**

**Proč to je vážné.** `G0-C5` — *„Every required deterministic T1/T2 suite …
pass"* — je nosné číslo celého Gate 0. Těch pět sad je v registru `ACTIVE`
a `required`, nikoli `BLOCKED`, takže **jejich prerekvizity nejsou nikde
deklarované**. `G0-C7` vyžaduje pojmenovanou prerekvizitu pouze u `BLOCKED`
řádků, takže validátor tuhle třídu chyby nemůže zachytit.

Na stroji operátora Go i PDF runtime existují, takže tam 199 skutečně projde.
Evidence není nepravdivá — je **vázaná na prostředí, které nic nedeklaruje**.
Přitom `GATE-CRITERIA.md` § Independent reproducibility si sám stanoví:

> Evidence that cannot satisfy this contract from a fresh clone is not evidence.

**[R]** Dvě možnosti, obě levné: buď pěti sadám doplnit deklaraci prerekvizity
a překlopit je na `BLOCKED` mimo `G0-C5` scope, nebo prerekvizity doinstalovat
v rámci `scripts/install.sh --minimal`, aby `G0-C4` a `G0-C5` mluvily o témž
prostředí. Rozhodnutí patří vlastníkovi větve.

Nález zároveň vysvětluje, proč `G0-R015` (nezávislá reprodukce) nemá zůstat
otevřený formálně — první skutečně nezávislý běh ho našel napoprvé.

---

## 5. Souhrn stavu k 2026-08-01

| Gate | Otázka | Stav | Zbývá |
|---|---|---|---|
| **Gate 0** | Lze čemukoli o tomhle kódu věřit? | **PASS** (`da485841`, review APPROVED) | — |
| **Gate 1** | Má každá schopnost aktuální akceptační důkaz? | **0 / 30** | 30 důkazních záznamů, po jednom |
| **Gate 2** | Jsou E2E sady pravdivé a aktivované? | **0 / 78** | 78 sad × 3 kroky aktivace |
| **Gate 3** | Je produkt vydatelný? | blokováno | `P-001`..`P-003` (privacy incident) |

**Bezpečnostní track:** `S-1` ✅ · `S-2` ❌ · `S-3` ❌ · `S-4` ❌
**Mobilní klient:** design kompletní (6 dokumentů, ADR 0001 `ACCEPTED`), implementace 0 %, blokováno `GAP-2`

Gate 1 je **odemčený a nezačatý**. To je dobrá zpráva: úzké hrdlo se právě
přesunulo z „nevíme, čemu věřit" na „víme, co je potřeba prokázat".
