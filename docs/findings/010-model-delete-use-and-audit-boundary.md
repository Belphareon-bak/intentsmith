# 010 — delete autorita zatím nekryje aktivní použití ani durable audit

- **vlastník:** navazující checkpoint
  `WP-M1-MODEL-CLEANUP-AUTHORITY / C2–C3`
- **nalezeno v:** read-only call-graph review cleanup authority
- **stav:** `PARTIAL_REMEDIATION / C2B_GATEWAY_FOCUSED_VERIFIED`
- **dopad:** M1 cleanup checkpoint je bezpečnější, L0-11 zůstává `PARTIAL`

## Evidence

Aktuální cleanup checkpoint centralizuje jediný Ollama `DELETE /api/delete`,
serializuje jej s apply/rollback/rehydrate a chrání runtime, durable desired,
pending i one-step rollback identitu. Toto je procesní mutation authority,
nikoli důkaz, že model právě nepoužívá jiný provider consumer.

Aktualizovaný source-to-effect call graph na C2 vstupu rozlišuje pět živých
produkčních cest:

- `src/llm/gateway.js`;
- registry-owned validaci přes `src/upgrade/validation-suites.js`;
- `src/media/vram-manager.js`;
- runtime cutover a exact verify v `src/upgrade/model-binding-application.js`;
- pull v `src/upgrade/upgrade-manager.js`, volaný jak binding application, tak
  přímou system route.

Tři dříve započítané cesty nejsou na současném HEAD produkční consumery:
`analyzeImages()` nemá volajícího v `src/`, `semantic-index.js` není ze `src/`
importovaný a legacy `_verifyModel()`/`_backgroundVerify()` je dosažitelný jen
ze starých apply/rollback writerů, které migration 050 blokuje před provider
efektem. Zůstávají evidované jako dormant kód; nejsou zapojené jen kvůli počtu.

C2a zavádí neutrální single-process per-canonical autoritu. Registry delete a
pull drží fail-fast exclusive lease; single i batch validace drží shared lease
po celou práci modelu. Tím se zavírá validation-start po posledním delete
guardu i direct-pull versus delete v jednom procesu. Error shape
`MODEL_DELETE_VALIDATING` zůstává pro známou validační cestu kompatibilní;
ostatní aktivní použití skončí `MODEL_DELETE_IN_USE`.

C2b zapojuje gateway do stejné autority. Shared lease vzniká až po přidělení
semaphore slotu a drží přes provider fetch, response body, retry pokusy i retry
delay; queued request model předčasně nerezervuje. Gateway může použít i
explicitní ne-bound model, takže lease se váže na skutečný request model, ne na
aktuální role binding. Focused sada skončila 24/24 a zčervenala při odstranění
acquire, předčasném release i odstranění owned body-abort klasifikace.

Pokryté jsou tím tři z pěti živých cest: registry validation, pull a gateway.
Binding cutover/exact verify a VRAM manager zůstávají otevřené; tento checkpoint
se proto nevydává za dokončený C2 ani L0-11 PASS.

Současný mutation owner je in-memory a chrání jeden serverový proces. Delete
událost má standardní log a best-effort WS broadcast, ale nemá append-only
durable intent/terminal audit. Konfigurovaný provider origin může být mimo
loopback; bezpečnostní disposition destruktivní vzdálené Ollamy není v tomto WP
rozhodnutá.

## Navazující acceptance

1. Jeden neutrální per-canonical-model use port: consumer drží shared lease do
   `finally`, delete získá fail-fast exclusive lease před inventory.
2. Aktivní use vrátí `MODEL_DELETE_IN_USE` bez inventory a delete efektu;
   probíhající delete odmítne nový use před provider requestem.
3. Všech pět živých consumer cest je zapojených; tři dormant cesty jsou
   explicitně vyřazené skutečným call graphem. Gateway-only oprava se nesmí
   vydat za celek.
4. Operátor rozhodne, zda M1 garantuje pouze jeden proces, nebo vyžaduje durable
   cross-process claim.
5. Destruktivní intent a terminál dostanou append-only audit dřív, než L0-11
   může přejít z `PARTIAL`.
6. Vzdálený provider delete je do samostatného outbound-authority rozhodnutí
   fail-closed nebo explicitně unsupported; současný checkpoint tuto změnu
   neprovádí potichu.

## Rozhodovací fronta

- single-process lease versus durable cross-process claim;
- samostatná model-delete audit migrace versus společný M2 effect ledger;
- explicitní remote Ollama delete versus loopback-only M1;
- zdroj a explicitní retirement identity starší než one-step rollback;
- doba platnosti chatového preview před jednorázovým potvrzením.
- VRAM unload/reload jako shared artifact-use versus nová exclusive residency
  autorita vůči gateway semaphore; C2a tuto sémantiku potichu nemění.
- direct pull stream nemá cancellation signal ani idle timeout; stalled
  `reader.read()` proto drží single-process writer do restartu. Operátor musí
  zvolit timeout a provider-outcome reconciliation dřív, než se tato cesta
  označí jako produkčně zotavitelná.
