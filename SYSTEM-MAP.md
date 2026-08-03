# IntentSmith — mapa systému

**Základ změřen 2026-08-02 na `17a8b9a8`; OS-isolated síťový scan proběhl
2026-08-03 na `24457ba2`; registry klasifikace byla opravena v `06309bc8`.**
Neutrální dokument, nezávislý na nástroji.
Pravidla vývoje: [`CONTRACT.md`](CONTRACT.md) · Detail: [`docs/inventory/`](docs/inventory/)

> Čísla níže jsou **změřená**, ne převzatá. Kde se rozcházejí se starší
> dokumentací, platí tento dokument.

---

## Spuštění

```bash
npm install                   # 233 balíčků, ~16 s
node src/server.js            # http://127.0.0.1:3335
node --watch src/server.js    # vývoj
```

**Prerekvizity:** Node.js 22+ · SQLite (better-sqlite3) · Ollama pro LLM cesty
(bez ní běží deterministické intenty, ostatní vrací `LLM_PROVIDER_UNAVAILABLE`)

```bash
npm test                      # deterministické sady
node scripts/validate-test-registry.js
```

**Prerekvizity sad — stav k 2026-08-03.** Rodičovská deklarace byla empiricky
prověřena v OS network namespace bez odchozí routy. Následné klasifikační
opravy v `06309bc8` ještě čekají na celý post-fix rerun:

| Sada | Stav |
|---|---|
| `export-pdf-docx`, `chat-export-budget` | **Vyřešeno.** Deklarováno jako `BLOCKED` s prerekvizitou `toolchain: python-pdf-runtime`. Instalace: `./scripts/install-pdf-runtime.sh` |
| `quality-gate` | **Nereprodukuje.** Bez `go` na PATH projde 22/22. |
| `multi-source-integration` | **Vyřešeno.** 12 offline testů zůstalo; 2 BBC/OpenMeteo testy jsou v samostatné `network: external` sadě. |
| `dependency-manager` | **Vyřešeno.** Unit test už nespouští skutečné `npm install`; fake executable ověřuje přesně tři pokusy bez sítě. |
| `harness-exit-code` | **Vyřešeno.** Po review import graphu je pin 95; mutační kontrola stále prokazuje odstranění isolation anchoru. |
| `nightly-orchestrator-self-test` | ⚠️ **Očekávaný vývojový drift release policy.** Gate 0 fingerprint se během vývoje nezapečeťuje; před release se musí obnovit. |

Registr do 2026-08-02 **toolchain deklarovat neuměl** — `hasConcreteBlockedPrerequisite()`
uznával jen network/server/ollama/gpu, takže sada potřebující Python musela
zůstat `ACTIVE` a padat. To je přesně mezera, kvůli které `G0-C7` tuhle třídu
chyby nezachytil. Doplněno `requirements.toolchain`.

---

## Rozsah

| | |
|---|---:|
| `src/**/*.js` | **144 944 ř.**, 405 souborů |
| `tests/**/*.js` | **143 023 ř.**, 351 trackovaných `.js` souborů |
| Registrovaných testových programů | **356** (`260 ACTIVE`, `81 BLOCKED`, `15 HISTORICAL`) |
| Tabulek v DB / migrací | 95 / 47 |
| HTTP rout | ~230 |
| **Schopností v `ACCEPTED/PASS`** | **1 z 22** (#2 CRE); #1 server/routing/DB má historicky schválených 13/13 chování, ale podle nového kontraktu mu chybí clean-clone provenance a testovaný výsledný SHA, proto je zatím `RUNTIME_VERIFIED` |

Registry fingerprint po pravdivém external splitu je
`35c590edcd7de9ecab6db870a0118e3ae67ff37ea99f58943c6b180ea04c60f4`.
`lastGreen.commit` zůstává prázdný; registry řádek sám proto není akceptační důkaz.

Tool census ze zdroje: **3 JavaScript soubory, 5 694 řádků, 153 top-level
nástrojových deklarací**. Počet 213 v dřívější inventuře byl textový false count.

---

## Schopnosti a jejich soubory

Toto je závazné mapování schopnost → kód. **Hranice schopností nekopírují
adresáře** — u čtyř schopností kód leží jinde, než by název adresáře čekal.

> **2026-08-02:** #11 se srovnalo — `execution-loop.js`, `error-normalizer.js`
> a `fix-strategy.js` přešly z `planner/` do `executor/`. Byla to uzavřená
> trojice se dvěma dotyky ven.
>
> **#13 se srovnat nedá a je to doloženo.** `architecture-check.js`
> a `architecture-policy.js` importuje `lifecycle-planning.js`
> a `lifecycle-build.js`, tedy #10. Přesun do `architect/` by křížové importy
> jen otočil, ne odstranil. Governance a lifecycle **nejsou oddělitelné
> přesunem souborů** — sdílejí kód, ne jen adresář.

### Základ

| # | Schopnost | Ř. | Soubory |
|---|---|---:|---|
| 1 | Server, routing, DB | 12,5k | `server.js`, `routes/`, `db/`, `config.js`, `security/`, `core/` |
| 2 | CRE | 4,3k | `chat/cre-decision.js`, `chat/cre-routing-patches.js` |
| 4 | Konverzace | 2,3k | `chat/conversation-store.js`, `chat/context-*.js`, `chat/ltm-context.js`, `chat/export-pipeline.js` |
| 18a | Správa modelů | 0,9k | `upgrade/model-profiles.js`, `upgrade/model-registry.js` |
| 3 | LLM gateway | 2,9k | `llm/` |
| 5 | Quality Gate v2 | 2,9k | `chat/quality/` |
| 6 | Chat pipeline | 20,4k | `chat/handlers/` (45), `chat/controller.js` |
| 21 | Studio + WS | 1,3k + **14,9k** | `ws-bridge/` + **`c3-ide/` (139 souborů TS/TSX, 20+ rozšíření)** — Theia IDE je **plocha produktu**, viz `DIRECTION.md` |
| 7 | Expertizy | 9,5k | `expertises/` **mimo** specialist-runtime, scenario-engine, knowledge-base |
| 16 | Nástroje | 5,7k | `tools/` — `registry.js` sám 5 094 ř. / **153 registrovaných nástrojů** |
| 9 | Skills | 1,8k | `skills/` — 8 vykonávaných step typů + samostatná substitution helper vrstva |
| 15 | Paměť | 3,1k | `memory/` |
| 12 | Code Intelligence | 11,6k | `code-intel/` |
| 11 | Execution + patch | 6,9k | `patch/`, `executor/` — **hranice sedí od 2026-08-02** |
| 10 | Project lifecycle | 14,5k | `planner/` **mimo** soubory patřící #13 |
| 13 | Governance | 4,7k | `architect/`, **+ `planner/architecture-{guardian,check,policy}.js`, `planner/api-contract-registry.js`, `planner/critic-agent.js`, `code-intel/regression-predictor.js`** |

### Rozšíření a volitelné subsystémy

| # | Schopnost | Ř. | Poznámka |
|---|---|---:|---|
| 8 | Specialisté | ~2,9k | `specialists/` **+ 1 516 ř. v `expertises/`**; 1.0 vyžaduje platformu + jeden E2E |
| 14 | Agenti | 6,5k | `agents/` **+ `chat/handlers/agent-wizard.js`**; 1.0 vyžaduje platformu + jeden E2E |
| 17 | Notifikace | 3,3k | `notifications/` |
| 18b | Upgrade automatika | 9,5k | `upgrade/` mimo #18a; automatické discovery je opt-in, nikoliv jediná outbound plocha |
| 19 | Marketplace | 0,9k | `marketplace/` |
| 20 | Media | 1,3k | `media/` |

Nedokončené / mimo 1.0: licencování, setup wizard.

**Legacy plocha:** `src/ui/architect/` (web UI na `/architect`) je zděděný
předchůdce C3 Studia z doby před přechodem na Theia. Není to fallback pro 1.0.
Osud neurozhodnut — viz `DIRECTION.md` §4.

---

## Kde se testuje bez modelu a kde ne

| Převážně `offline` — ověřitelné bez Ollamy | Převážně `model` — vyžaduje Ollamu |
|---|---|
| #12 Code Intelligence (13/17) | **#2 CRE** (rozhodnuto: bez Ollamy nemá smysl) |
| #13 Governance (11/12) | **#10 Lifecycle** (19 sad `model`) |
| #11 Execution (8/10) | #5 QGv2 (11/24) |
| #16 Nástroje (4/5) · #18a (vše) | #7 Expertizy (9/24) |

---

## Třináct invariantů

Jsou závaznou release podmínkou a vývojovými rails. Ne všechny dnes platí:
otevřený nebo neověřený stav je uveden níže a nesmí se vydávat za splnění. Plné
znění v [`CONTRACT.md`](CONTRACT.md) §2.

1. CRE je jediná autorita — žádná zpráva ji neobejde
2. `mergeExpertisePrompt()` je čistá funkce
3. ExpertiseEnforcer: max 2 retries, temperature decay −0,1
4. 5D vektor `{reasoning, creativity, determinism, riskTolerance, verbosity}`
5. QGv2 je deterministický a idempotentní, bez LLM
6. Patch engine: 3-tier anchor, atomický zápis, plný rollback
7. Execution loop: max 8 iterací
8. Specialista neimportuje interní `src/**` — **aktuálně porušeno** jediným
   vykonávaným importem `specialists/accountant-cz/adapters.js` →
   `src/expertises/tool-adapter.js`; chybí fail-closed rekurzivní guard
9. Model upgrade nikdy neupgraduje sám
10. **Legacy listener nikdy neopustí loopback**
11. Významný efekt zůstává pod přesnou uživatelskou authority — **UNVERIFIED
    jako celek**; M2 musí spojit existující mediaci/approval cesty a zavřít bypassy
12. Žádná tichá background outbound komunikace — **PARTIAL**; background model
    discovery je off a rodičovský deterministický profil byl empiricky
    skenovaný, ale C3 Studio bundle bez opt-inu vkládá Google Fonts URL a
    explicitní outbound plochy ještě nemají jednotnou policy
13. Učení nerozšiřuje authority, nemění code/config a nekříží projekt bez
    opt-inu — **UNVERIFIED**; M4 vyžaduje negativní boundary testy

---

## Známý stav, který se vědomě neřeší

Zaznamenané, rozhodnuté, ne zapomenuté.

| Co | Stav |
|---|---|
| Bezpečnost, credentials, privacy incident `P-001`..`P-003` | Odloženo do odladění základu (rozhodnutí operátora) |
| Chybí globální auth guard; `validateApiToken()` je napsaná a nezapojená | Součást téhož balíku |
| WS terminal channel přijímá `exec` po handshaku bez tokenu | Neškodné na loopbacku (invariant 10) |
| Skills mají krok `shell`, jinde je shell denied | Zaznamenáno k prověření |
| Rehydrate vrací conversation ID bez ověření v DB | Zaznamenáno |
| Token streaming neexistuje — `onLLMToken` je konzument bez producenta | Odpověď přichází celá |
| Nedostupná Ollama při klasifikaci | Opravena na jeden pokus; změřeno přibližně 80 ms místo 6 091 ms |
| Automatické online model discovery | `C3_ENABLE_ONLINE_DISCOVERY`, default off; ostatní explicitní outbound plochy čekají na jednotnou policy |
| C3 Studio Google Fonts | `c3-chat-panel/lib/browser/chat-panel-module.js` vkládá dvě `fonts.googleapis.com` URL bez opt-inu; potvrzené otevřené L0-12 porušení pro M0/M1 |
| `multi-source-external.test.js` | Explicitní public-service smoke; není deterministická offline evidence |
| L0-8 specialist boundary | Potvrzeně porušený; strict injection versus public extension SDK vyžaduje rozhodnutí operátora |
| Self-learning | PatternTracker má runtime čtení; cross-project learner nemá prokázanou produkční smyčku. M4 vyžaduje jeden uzavřený same-project E2E |
| Lineární matching rout, regex per request | Naměřeno 0,87 ms — vědomě ponecháno |
| Rate limiter je na loopbacku mrtvý kód | Vědomě ponecháno |

---

## Co je zastaralé

`docs/ROADMAP.md`, `docs/convergence/*` a `docs/README.md` obsahují **legacy
tvrzení**. `AGENTS.md` a `CLAUDE.md` jsou nyní shodné ukazatele bez stavových
claimů. Příklady rozporů, které tento dokument opravuje:
15 expertíz (skutečně 18) · `chat/cre-decision-types.js` (neexistuje) ·
11 guardů (12) · `cre-decision.js` ~2 900 ř. (4 196) · tabulka intentů se
třemi neexistujícími a sedmi chybějícími · „~98 % hotovo" · „3 500+ verified tests".

Ponechány jako reference. **Autoritou je tento dokument.**
