# WP — bezpečný záznam skutečného provider promptu pro dlouhý chat

**Stav:** implementační kandidát; GPU a živá sada 85 `NOT RUN`; nezávislá revize otevřená.

**Autorita:** požadavek operátora z 30. 9. 2026 připravit a ověřit skutečný chat při naplnění kontextového okna. Tento WP konkretizuje pouze měřicí hranici; sám nezakládá produktové chování.

**Vstup a výsledek:** vlastní checkout `work/intent-resilience-20260928` na `362a24b5`. Runner má opt-in `--capture-provider` pouze pro `IS-T3-E2E-85-LONG-SESSION-DEGRADATION`. Před startem vlastního testového serveru získá sdílený GPU lease, ověří prázdné `/api/ps`, prázdné NVIDIA compute, RAM, disk, přesný model `qwen3.5:27b` a digest `7653528ba5cba4dd8e19da24aaddc7f4d0b5ecd93571c0825dfd4137958ec06e`. Při nedostupné prerekvizitě skončí bez modelového requestu jako `BLOCKED`.

**Vlastněné cesty:** `scripts/run-suites.js`, `scripts/provider-capture.js`, `tests/provider-capture-proxy.test.js`, jeho nová položka v `tests/registry.json`, odpovídající generovaný `docs/convergence/TEST-REGISTRY.md` a tento WP. Produktové API, produkční server, modelové bindings, GPU hunt, cizí procesy a worktree jsou mimo rozsah.

**Hranice:** lokální proxy dovolí pouze čtecí `/api/tags`, `/api/ps`, `/api/version`, `POST /api/show` a ne-streamový `POST /api/chat` pro připnutý model a `num_ctx` nejvýše 4096. `/api/pull`, `/api/delete`, `/api/generate`, unload a jiný model jsou odmítnuty. Proxy zapisuje po každém dokončeném chat volání synchronní JSONL řádek (`messages`, `numCtx`, provider `prompt_eval_count`, celý terminální JSON, hashes, status) do souboru s právy `0600`; teprve potom předá odpověď serveru. Suite dostane jen `INTENTSMITH_TEST_PROVIDER_CAPTURE_FILE`, nikoli přímou adresu Ollamy. Běžný runner bez přepínače zachová stávající režim.

**Ověření a přejímka:** `tests/provider-capture-proxy.test.js` proti falešnému loopback upstreamu musí prokázat okamžitě čitelný přesný request i response, soukromý artefakt, odmítnutí zakázaných efektů a cizího modelu, blokaci obsazené GPU/provider prerekvizity a chybného digestu. Registry a diff kontrola musí projít. Po integraci s testem 85 spustit teprve při skutečně volném GPU:

```sh
node scripts/run-suites.js --suite=IS-T3-E2E-85-LONG-SESSION-DEGRADATION --capture-provider --keep-run-root
```

Tento WP dodává pouze měřicí nástroj. Offline self-check neznamená modelový `PASS`; živý běh musí ověřit finální provider prompt, skutečné `num_ctx`, `prompt_eval_count`, persistovaný summary stav a modelovou odpověď na stejném integračním SHA.
