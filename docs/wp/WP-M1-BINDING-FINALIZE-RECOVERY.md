# WP-M1-BINDING-FINALIZE-RECOVERY — durable runtime finalize receipt

> **Historická přijatá review jednotka.** Příkazy na odstraněné compatibility
> testy nejsou současným runbookem; current binding/evaluation brány jsou v
> [WP-MODEL-EVALUATION-CONSOLIDATION](WP-MODEL-EVALUATION-CONSOLIDATION.md).

**Typ:** zapisující WP · **Slot:** hlavní zapisující vlastník, hlavní checkout

**Vstupní revision:** `20b1b93387ab3c165dc01473178aca239a53e21b`

**Závislost:** dokončený [`WP-M1-BINDING-APPLICATION`](WP-M1-BINDING-APPLICATION.md)

**Stav:** `FRESH-CLONE VERIFIED` na `7c4aa73c`; review jednotka
`0a6bde54..7c4aa73c` prošla nezávislým read-only code/evidence review.

Toto je zadání, ne PASS evidence. Stav milníku zůstává v `ROADMAP.md §5`.
WP uzavírá pouze post-DB runtime-finalize residual z
[`Findingu 008`](../findings/008-model-binding-commit-point-split.md). Nemění
veřejný HTTP/WS kontrakt, L0-9 ani automatický failover.

## 1. Uživatelský výsledek

Manual apply/rollback nesmí být prezentovaný jako runtime `APPLIED`, dokud po
durable application attemptu neexistuje append-only potvrzení, že synchronní
runtime finalize skutečně doběhl. Chybějící potvrzení je typovaný
`RUNTIME_RECONCILIATION_REQUIRED` stav. Restart nebo ohraničený interní recovery
znovu exact-digest aplikuje současnou durable desired autoritu; nevymýšlí nový
uživatelský záměr, neopakuje provider pull a neprovádí automatický rollback.

## 2. Vlastněné a zakázané cesty

**Povolené:**

- aditivní migrace `054` a její přesné migrační testy;
- `src/upgrade/model-failover.js`, `model-binding-application.js` a úzký
  binding runtime port v `upgrade-manager.js`;
- focused binding repository/application testy a nutné compatibility testy;
- `ROADMAP.md §5`, `SYSTEM-MAP.md`, Finding 008, model execution report a tento
  WP index.

**Zakázané:**

- veřejný HTTP/WS/M1 connector a Studio/UI;
- proof issuance, rozhodnutí 015, automatic failover/rollback nebo L0-9;
- model delete/pull/cleanup, VRAM/GPU residency a vzdálená Ollama;
- nová závislost, externí síť, skutečná Ollama nebo GPU běh.

## 3. Interní connector a stav

Repository přidá interní append-only finalize receipt navázaný na přesný
úspěšný `(operation_id, runtime_attempt_revision)`:

- `DIRECT_CONFIRMED` potvrzuje návrat synchronního `runtime.commit()`;
- `RECOVERED_BY` naváže starší nepotvrzenou runtime generaci na přesný novější
  úspěšný `STARTUP_REHYDRATE` attempt;
- sequence, čas a recovery lineage odvozuje repository, ne caller;
- jeden runtime attempt smí mít právě jeden receipt a žádný receipt se nesmí
  měnit, mazat nebo nahradit přes `INSERT OR REPLACE`.

Odvozený stav nejnovější runtime generace je:

- bez úspěšného runtime attemptu: dnešní `NOT_APPLIED` nebo `FAILED`;
- úspěšný attempt bez `DIRECT_CONFIRMED`: interní stav
  `RUNTIME_RECONCILIATION_REQUIRED`, runtime `APPLIED` a nový
  `runtimeFinalizeStatus: UNKNOWN`;
- úspěšný attempt s `DIRECT_CONFIRMED`: dnešní `APPLIED` a teprve potom smí
  vzniknout verification nebo notification attempt.

Historické pre-054 úspěchy se nesmí mechanicky backfillnout jako potvrzené.
Současný desired operation je na startupu exact-digest rehydratovaný a nová
generace potvrdí sebe i recovery lineage starších nepotvrzených attemptů.

## 4. Povinné pořadí efektů

1. exact target a previous model zůstávají rezervované;
2. runtime `prepare()` vytvoří kompenzovatelný token;
3. repository zapíše dnešní úspěšný runtime attempt — finalize stav je zatím
   `UNKNOWN`;
4. synchronní `runtime.commit()` doběhne bez callbacku nebo `await`;
5. repository atomicky zapíše `DIRECT_CONFIRMED` a případné
   `RECOVERED_BY` receipts;
6. až potom se spustí proposal repair, notification a verification.

Při výjimce v kroku 4 se service pokusí o bezpečnou kompenzaci tokenu. Při
výjimce v kroku 4 nebo 5 vrací typovaný reconciliation error a ponechá durable
stav pravdivě `UNKNOWN`; nesmí appendnout falešný runtime failure za již
zapsaný success. Recovery smí zopakovat pouze exact rehydrate/finalize, nikoli
provider pull, provider mutation, nový provider intent ani nový user apply.
Exact provider identitu při recovery znovu čte.

## 5. Pozitivní a negativní důkaz

**Pozitivní:** běžný apply, rollback a startup rehydrate mají direct receipt;
stav `APPLIED` vznikne až po něm; notification i exact verification dál
proběhnou a user replay neopakuje runtime, pull ani provider intent.

**Negativní minimálně:**

1. `runtime.commit()` vyhodí před skutečným finalize;
2. runtime commit doběhne, ale zápis receipt selže;
3. restart mezi application success a runtime finalize;
4. druhý restart po úspěšném rehydrate, ale před jeho receipt;
5. verification i notification bez direct receipt fail-close skončí před
   mutací;
6. pre-054 success nedostane syntetický direct receipt;
7. duplicitní, změněný, smazaný, `INSERT OR REPLACE` a caller-sequenced receipt
   jsou odmítnuté vlastněným signálem;
8. recovery neprovede druhý pull, nový user operation, broadcast ani
   verification před potvrzením;
9. pre-054 změněný `RUNTIME_APPLY` bez právě jedné přesné legacy history stopy
   zastaví migraci před první schema mutací;
10. po každém typed busy existuje nejvýše jeden operation-scoped timer bez
    provider/runtime práce; počet po sobě jdoucích busy rearmů není omezen,
    zatímco jiná recovery chyba ponechá roli v `UNKNOWN` bez auto-retry;
11. jinak shodný potvrzený attempt projde jako pozitivní protějšek.

## 6. Stop condition / eskalace

Zastaví se jen dotčená část, pokud by bylo potřeba:

- automaticky rollbacknout uživatelský desired binding;
- obsluhovat roli navzdory neúspěšnému exact startup recovery;
- změnit veřejný status/error/Studio surface;
- aktivovat automatic failover, vydat proof nebo zvolit 015 policy;
- sáhnout do cesty jiného aktivního writeru.

Backendový fail-closed recovery a interní typovaný stav mohou pokračovat bez
těchto rozhodnutí.

## 7. Ověřovací příkazy

```bash
C3_LOG_LEVEL=error node tests/schema-migrations.test.js
C3_LOG_LEVEL=error node tests/m1-model-failover-schema.test.js
C3_LOG_LEVEL=error node tests/m1-model-binding-repository.test.js
C3_LOG_LEVEL=error node tests/m1-model-binding-application.test.js
C3_LOG_LEVEL=error node tests/m1-model-binding-storage.test.js
C3_LOG_LEVEL=error node tests/m1-model-failover-repository.test.js
C3_LOG_LEVEL=error node tests/routes-smoke.test.js
C3_LOG_LEVEL=error node tests/ws-bridge.test.js
C3_LOG_LEVEL=error node tests/upgrade-flow.test.js
C3_LOG_LEVEL=error node tests/upgrade-ux-v125.test.js
C3_LOG_LEVEL=error node tests/model-upgrade.test.js
node scripts/validate-test-registry.js
node tests/artifact-validation.test.js
node tests/repository-hygiene.test.js
node scripts/module-boundary-ratchet.mjs
git diff --check
```

Skutečná Ollama/GPU demonstrace zůstává samostatně `BLOCKED / NOT RUN`.

## 8. Výstup a pravdivé omezení

Schema/repository a application/runtime cutover tvoří jeden nedělitelný source
candidate. Samostatný schema commit by záměrně shodil produkční application
sadu a dočasně by umožnil vydat nepotvrzený runtime attempt jako manual
binding. Historii nepřepisujeme: review jednotkou je `0a6bde54` spolu s jeho
bezprostředním opravným commitem `7c4aa73c`. Koncové SHA prošlo čistým lokálním
klonem, `npm ci --offline` a celou předepsanou focused/compatibility baterií.

Implementovaný candidate zachovává veřejný kontrakt: interní
`RUNTIME_RECONCILIATION_REQUIRED` se mapuje na dosavadní veřejné `PENDING` /
`NOT_APPLIED`; HTTP a WS schéma se nerozšiřuje. Nová post-054
`upgrade_history` vzniká až ve stejné transakci jako direct receipt; původní
pre-054 runtime writer musí mít přesnou atomickou history stopu. Pokud runtime
commit nebo receipt skončí v nejasném okně, user replay neopakuje runtime, pull
ani provider intent.
Operation-scoped recovery znovu čte exact provider identitu a vytvoří novou
`STARTUP_REHYDRATE` generaci. Po každém
`MODEL_BINDING_APPLICATION_BUSY` existuje nejvýše jeden operation-scoped timer,
ale počet po sobě jdoucích busy rearmů není omezen; libovolná jiná provider/DB
chyba auto-retry nezaloží.

Otevřené produktové rozhodnutí zůstává chování serveru při neúspěšném exact
startup recovery jedné role. Candidate zachovává dnešní dostupnost serveru,
chybu loguje a dotčený binding neprohlásí za potvrzený; per-role blokace, abort
celého serveru nebo explicitní degraded surface vyžadují rozhodnutí operátora.

Ani dokončení tohoto WP neuzavírá celé M1/Gate 1. Zůstávají nejméně rozhodnutí
015, proof/automatic failover, Studio recovery surface, skutečný GPU běh a
globální VRAM residency authority.
