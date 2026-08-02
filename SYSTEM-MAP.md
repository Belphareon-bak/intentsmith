# IntentSmith — mapa systému

**Změřeno 2026-08-02 na `17a8b9a8`.** Neutrální dokument, nezávislý na nástroji.
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

**Prerekvizity sad — stav k 2026-08-02.** Z původních pěti nedeklarovaných
(`EX-6`) zbyly dvě otevřené položky:

| Sada | Stav |
|---|---|
| `export-pdf-docx`, `chat-export-budget` | **Vyřešeno.** Deklarováno jako `BLOCKED` s prerekvizitou `toolchain: python-pdf-runtime`. Instalace: `./scripts/install-pdf-runtime.sh` |
| `quality-gate` | **Nereprodukuje.** Bez `go` na PATH projde 22/22. |
| `multi-source-integration`, `nightly-audit-runner-self-test` | ⚠️ **Otevřené — nejsou to prerekvizity.** Exit 1 bez viditelné příčiny; deklarací se to nespraví. |

Registr do 2026-08-02 **toolchain deklarovat neuměl** — `hasConcreteBlockedPrerequisite()`
uznával jen network/server/ollama/gpu, takže sada potřebující Python musela
zůstat `ACTIVE` a padat. To je přesně mezera, kvůli které `G0-C7` tuhle třídu
chyby nezachytil. Doplněno `requirements.toolchain`.

---

## Rozsah

| | |
|---|---:|
| `src/` | **145 259 ř.**, 406 souborů |
| `tests/` | **142 287 ř.**, 345 souborů |
| Registrovaných testových programů | 350 |
| Tabulek v DB / migrací | 95 / 47 |
| HTTP rout | ~230 |
| **Schopností s akceptačním důkazem** | **0 z 22** |

`lastGreen.commit` je `null` u **všech 350 sad**, zelených i nezelených.

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
| 21 | Studio + WS | 1,3k | `ws-bridge/`, `c3-ide/` |
| 7 | Expertizy | 9,5k | `expertises/` **mimo** specialist-runtime, scenario-engine, knowledge-base |
| 16 | Nástroje | 5,7k | `tools/` — `registry.js` sám 5 094 ř. / **213 nástrojů** |
| 9 | Skills | 1,8k | `skills/` |
| 15 | Paměť | 3,1k | `memory/` |
| 12 | Code Intelligence | 11,6k | `code-intel/` |
| 11 | Execution + patch | 6,9k | `patch/`, `executor/` — **hranice sedí od 2026-08-02** |
| 10 | Project lifecycle | 14,5k | `planner/` **mimo** soubory patřící #13 |
| 13 | Governance | 4,7k | `architect/`, **+ `planner/architecture-{guardian,check,policy}.js`, `planner/api-contract-registry.js`, `planner/critic-agent.js`, `code-intel/regression-predictor.js`** |

### Mimo základ

| # | Schopnost | Ř. | Poznámka |
|---|---|---:|---|
| 8 | Specialisté | ~2,9k | `specialists/` **+ 1 516 ř. v `expertises/`** |
| 14 | Agenti | 6,5k | `agents/` **+ `chat/handlers/agent-wizard.js`** |
| 17 | Notifikace | 3,3k | `notifications/` |
| 18b | Upgrade automatika | 9,5k | `upgrade/` mimo #18a — **jediná síťová plocha produktu** |
| 19 | Marketplace | 0,9k | `marketplace/` |
| 20 | Media | 1,3k | `media/` |

Nedokončené / mimo 1.0: licencování, setup wizard.

---

## Kde se testuje bez modelu a kde ne

| Převážně `offline` — ověřitelné bez Ollamy | Převážně `model` — vyžaduje Ollamu |
|---|---|
| #12 Code Intelligence (13/17) | **#2 CRE** (rozhodnuto: bez Ollamy nemá smysl) |
| #13 Governance (11/12) | **#10 Lifecycle** (19 sad `model`) |
| #11 Execution (8/10) | #5 QGv2 (11/24) |
| #16 Nástroje (4/5) · #18a (vše) | #7 Expertizy (9/24) |

---

## Deset invariantů

Platí vždy. Plné znění v [`CONTRACT.md`](CONTRACT.md) §2.

1. CRE je jediná autorita — žádná zpráva ji neobejde
2. `mergeExpertisePrompt()` je čistá funkce
3. ExpertiseEnforcer: max 2 retries, temperature decay −0,1
4. 5D vektor `{reasoning, creativity, determinism, riskTolerance, verbosity}`
5. QGv2 je deterministický a idempotentní, bez LLM
6. Patch engine: 3-tier anchor, atomický zápis, plný rollback
7. Execution loop: max 8 iterací
8. Specialista je soběstačný — žádný `import ../../src/`
9. Model upgrade nikdy neupgraduje sám
10. **Legacy listener nikdy neopustí loopback**

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
| Bez modelu trvá klasifikace ~6 s (3 retries) | Otevřené, `C-1` |
| `startPeriodicCheck()` běží bez feature flagu, poll 5 min | Otevřené — jediná cesta ven ze systému |
| Lineární matching rout, regex per request | Naměřeno 0,87 ms — vědomě ponecháno |
| Rate limiter je na loopbacku mrtvý kód | Vědomě ponecháno |

---

## Co je zastaralé

`CLAUDE.md`, `docs/ROADMAP.md`, `docs/convergence/*` a `docs/README.md`
obsahují **legacy tvrzení**. Příklady rozporů, které tento dokument opravuje:
15 expertíz (skutečně 18) · `chat/cre-decision-types.js` (neexistuje) ·
11 guardů (12) · `cre-decision.js` ~2 900 ř. (4 196) · tabulka intentů se
třemi neexistujícími a sedmi chybějícími · „~98 % hotovo" · „3 500+ verified tests".

Ponechány jako reference. **Autoritou je tento dokument.**
