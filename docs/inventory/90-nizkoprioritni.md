# Inventura — rozšíření a volitelné subsystémy

**#8, #14, #17, #18b, #19, #20** · **2026-08-02** · `17a8b9a8`

> Specialisté a agenti jsou od 2026-08-03 v rozsahu 1.0 jako platforma + jeden
> reálný E2E každého typu (M3). Ostatní subsystémy vstupují podle schváleného
> user journey a dependency DAG. Dokument zůstává mělkou výchozí inventurou.
> Modelový výčet z 2026-08-02 je superseded rozhodnutím 030; odstraněné rankery,
> proposal store a v123 validation nejsou current runtime.

**Celkem v této skupině: ~23 000 řádků, 55 historicky mapovaných testových sad.**

---

## #8 — Specialisté a loader · 1 379 ř. + 5 balíčků

`specialist-loader.js` 1 244 · `capability-registry.js` 135
Balíčky: `accountant-cz`, `code-reviewer`, `dummy-logger`, `sazeni`, `translator`
**Testy:** 23 sad — `offline` 17, `model` 3, `server` 2, `manual` 1
**Za běhu:** všech 5 registrovaných, **všichni vypnutí**

**Dobré:** `ctx.registries`, deterministický boot přes Kahnův algoritmus,
fail-safe unregister, 17 `offline` sad. **L0-8 dnes neplatí:** accountant-cz má
jeden vykonávaný přímý import do interního `src/**`; současný loader guard není
rekurzivní ani fail-closed.
**Nejasné:** dalších **1 516 řádků specialistů leží v `src/expertises/`** (`specialist-runtime`, `scenario-engine`, `knowledge-base`) — viz `E-1`. Skutečný rozsah #8 je tedy ~2 900 ř., ne 1 379.

---

## #14 — Agenti a scheduler · 6 531 ř.

`runner.js` 1 339 · `api.js` 857 · `repository.js` 678 · `schema.js` 619 · `conditions.js` 551
**Testy:** 8 sad — `offline` 6, `server` 2
**Za běhu:** 6 ukázkových agentů registrováno a naplánováno při startu

**Dobré:** `schema.js` (619 ř.) — definice agenta je validovaný datový typ; `conditions.js` — deterministické podmínky, ne LLM; cron i interval scheduling; 6 notifikačních kanálů.
**Nejasné:** `agent-wizard.js` (671 ř.) je v handlerech #6 (viz `P-2`); ukázkoví agenti se zapisují do DB při každém startu (`N-2`, operátor rozhodl: chování je zhruba správné, úprava počká).

---

## #17 — Notifikace · 3 335 ř.

`trust.js` 551 · `policy.js` 302 · `feedback.js` 294 · `e2e-verify.js` 273
**Testy:** 5 sad — `model` 2, `offline` 2, `server` 1

**Dobré:** 6 kanálů (email, Telegram, ntfy, webhook, desktop, push) za jedním rozhraním; `policy.js` odděluje „co poslat" od „jak poslat"; `trust.js` (551 ř.) — hodnocení důvěryhodnosti kanálu.
**Nejasné:** proč je `trust.js` největší soubor notifikací; `desktop.js` je Electron-only, tedy mimo web UI; `broadcast()` z #21 notifikační pipeline nepoužívá.

---

## #18b — Upgrade automatika · ~9 470 ř.

`model-universe-store.js` **1 919** · `upgrade-manager.js` 1 440 · `validation-suites.js` 986 · `online-discovery.js` 678 · `model-catalog.js` 654 · `model-recommendations.js` 526 · `whatllm-client.js` 471 · `model-discovery.js` 471 · `model-ranker.js` 414 · dalších 7
**Testy:** 14 sad — `offline` 10, ostatní 4

**Dobré:** invariant L0-9 (nikdy neupgraduje sám, komunikace jen přes proposals v DB); `proposal-store.js` s cooldownem proti thrashingu; 10 `offline` sad.
**Nejasné — a je toho hodně:**
- **~1 475 řádků síťových klientů** (`whatllm-client`, `registry-client`, `online-discovery`) chodí na internet hledat modely. Background discovery je default off; nejde ale o jedinou outbound plochu produktu, protože explicitní síť používají také tools, marketplace, agent sources/actions a notifikace.
- `model-universe-store.js` má 1 919 řádků — největší soubor v celém `src/upgrade/`. Co „universe" je?
- 9 470 řádků na funkci, kterou si podle tvého zadání nikdo nevyžádal.
- **Toto je hlavní kandidát na inventuru „co je dobré / zbytečné / nejasné" v tvém původním smyslu.**

---

## #19 — Marketplace · 945 ř.

`package-installer.js` 499 · `marketplace-client.js` 446
**Testy:** 3 sady — `offline` 2, `server` 1

**Dobré:** transakční instalace s rollbackem, SHA-256 ověření, mutex, dependency resolver, null-byte guard. Na 945 řádků nezvykle důkladné.
**Nejasné:** stahuje balíčky ze sítě — druhá síťová plocha po #18b. Existuje vůbec remote katalog, na který ukazuje?

---

## #20 — Media / ComfyUI · 1 301 ř.

`vram-manager.js` 373 · `comfyui-connector.js` 366 · `workflow-templates.js` 295 · `output-storage.js` 224 · `model-discovery.js` 43
**Testy:** 1 sada — `offline`
**Za běhu:** routy se registrují jen když `comfyuiConnector` existuje

**Dobré:** `vram-manager.js` — koordinace VRAM s LLM, aby si generování obrázků a model nelezly do paměti; podmíněné zapojení rout.
**Nejasné:** `G0-R030` (lifecycle v render fázi) je otevřené riziko blokující #21/`C3-001` pro Gate 1 a týká se media cache; **1 testová sada na 1 301 řádků** je nejslabší pokrytí v projektu.
