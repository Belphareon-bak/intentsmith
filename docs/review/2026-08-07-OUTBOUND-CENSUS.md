# Census odchozích call sites

**Zadání:** [`docs/wp/P3-OUTBOUND-CENSUS.md`](../wp/P3-OUTBOUND-CENSUS.md)
**Revision:** `1fc8f03e649dd561fb279ce68e5c119d35faad55` · **Datum:** 2026-08-07
**Adresát:** vlastník `WP-M5-AUTH`, krok 3 „OUTBOUND v rámci AUTH/conditional policy"

> **Tento dokument není evidence** ve smyslu [`docs/review/README.md`](README.md).
> Empirický běh v `§5` je pozorování na této revizi, ne gate výsledek.

---

## Shrnutí pro `WP-M5-AUTH`

**82** call sites ve **34** souborech. Z toho **24** míří na loopback Ollama,
**11** je prohlížečový same-origin kód, **1** je falešný pozitiv. Skutečně
odchozích je **46**, a z nich **16** má cíl natvrdo v kódu.

Default instalace v pozorovaném okně **neprovedla jediné spojení mimo loopback**
(`§5`). Tři background plánovače existují, ale všechny cesty ven jsou zavřené
buď feature flagem, chybějícím credentialem, nebo prázdnou konfigurací.

Nejvážnější nález není tichý egress — ten se nepotvrdil. Je to `OB-3`:
**neexistuje perzistentní audit odchozí komunikace.** Exit kritérium M5
*„všechny outbound call sites mají policy, scope a audit"* je dnes nesplnitelné
ne proto, že by chyběla policy, ale proto, že chybí místo, kam by se zapisovala.

### Oprava vstupního čísla

Zadání uvádělo „77 výskytů". To bylo `grep -c "fetch(" | grep -v "//"`, které
zahodilo každý řádek obsahující `//` — tedy i řádky s `http://`. Skutečný počet
je **82**. Rozdíl je artefakt grepu, ne změna kódu.

---

## 1. Klasifikace — přehled

| Třída | Počet | Skutečně ven? |
|---|---|---|
| A. Ollama přes loopback | 24 | ne, dokud `OLLAMA_URL` míří na loopback |
| B. ComfyUI (conditional media) | 8 | podle konfigurace |
| C. Cíl natvrdo v kódu | 16 | **ano** |
| D. URL od uživatele, agenta nebo LLM | 22 | **ano** |
| E. Prohlížečový same-origin (`architect.js`) | 11 | ne |
| F. Falešný pozitiv (šablona) | 1 | ne |
| **Celkem** | **82** | |

---

## 2. Tabulka call sites

### A. Ollama přes loopback (24)

Default `http://127.0.0.1:11434`. **Pozor:** kromě dvou natvrdo zapsaných míst
je adresa konfigurovatelná přes `OLLAMA_URL` — nastavením na vzdálený host se
celá tato třída stane egressem a projdou jí prompty i obsah projektu.

| Místo | Cíl | Spouštěč |
|---|---|---|
| `src/code-intel/semantic-index.js:134` | `http://127.0.0.1:11434/api/embeddings` **natvrdo** | indexace |
| `src/code-intel/semantic-index.js:153` | `http://127.0.0.1:11434/api/tags` **natvrdo** | indexace |
| `src/llm/cre-bridge.js:216` | `${config.ollama.baseUrl}/api/generate` | chat request |
| `src/llm/gateway.js:493` | `${config.ollama.baseUrl}/api/chat` | chat request |
| `src/llm/model-ctx.js:71` | `${ollamaUrl}/api/show` | startup + chat |
| `src/media/vram-manager.js:187,202,244,279` | `/api/ps`, `/api/generate` ×2, `/api/ps` | media |
| `src/routes/system.js:125,395,439,970,1100,1367` | `/api/show`, `/api/tags`, `/api/show`, `/api/delete`, `/api/tags` ×2 | HTTP route |
| `src/setup/wizard.js:135` | `${ollamaUrl}/api/tags` | setup |
| `src/upgrade/model-discovery.js:50,90` | `/api/tags`, `/api/show` | **background** |
| `src/upgrade/model-registry.js:57,351` | `/api/tags`, `/api/delete` | background + akce |
| `src/upgrade/upgrade-manager.js:606,705` | `/api/chat`, `/api/pull` | validace, pull |
| `src/upgrade/validation-suites.js:690` | `${this._baseUrl}/api/chat` | validace |
| `src/chat/handlers/pre-handler.js:385` | `${baseUrl}/api/delete` | chat handler |

### B. ComfyUI a GPU (8)

| Místo | Cíl | Poznámka |
|---|---|---|
| `src/media/comfyui-connector.js:25,50,72,112,206,240,347` | `${this._baseUrl}/…` | conditional plocha; adresa z konfigurace |
| `src/system/gpu-detector.js:340` | `${opts.comfyuiUrl}/system_stats` | detekce GPU |

### C. Cíl natvrdo v kódu (16) — jádro pro policy

| Místo | Cíl | Default stav | Spouštěč |
|---|---|---|---|
| `src/notifications/feedback.js:194,210` | `https://api.telegram.org/bot…` | vyžaduje `C3_TELEGRAM_BOT_TOKEN` | reakce na callback |
| `src/upgrade/registry-client.js:199` | `https://ollama.com/library` | **vypnuto** (`onlineDiscovery`) | background full cycle |
| `src/upgrade/registry-client.js:151,260,278` | odvozeno z `REGISTRY_BASE` | **vypnuto** | background |
| `src/upgrade/whatllm-client.js:337` | `https://whatllm.org` | **vypnuto** | background full cycle |
| `src/upgrade/online-discovery.js:453` | discovery endpoint | **vypnuto** | background |
| `src/packaging/auto-updater.js:93` | `https://api.github.com/repos/${repo}/releases/latest` | vyžaduje `C3_UPDATE_REPO` (default prázdný) | **background 24 h** |
| `src/packaging/auto-updater.js:163` | `downloadUrl` z release | vyžaduje `C3_UPDATE_REPO` | stažení |
| `src/marketplace/marketplace-client.js:221` | `https://raw.githubusercontent.com/C3studio/C3-agent/master/marketplace/catalog.json` | zapnuto, ale jen na akci | uživatel |
| `src/marketplace/marketplace-client.js:329` | URL balíčku z katalogu | zapnuto | uživatel |
| `src/llm/web-search.js:75` | `https://html.duckduckgo.com/html/?q=…` | zapnuto | **LLM přes tool executor** |
| `src/llm/web-search.js:100` | SearX instance (`searx.be`, `searx.tiekoetter.com`, `searx.fmac.xyz`) | zapnuto | **LLM** |
| `src/llm/web-search.js:303` | libovolná URL (`fetchPage`) | zapnuto | **LLM** |
| `src/ui/architect/architect.js:3147` | `https://ipapi.co/json/` | zapnuto | tlačítko v UI (`architect.html:924`) |

### D. URL od uživatele, agenta nebo LLM (22)

| Místo | Zdroj URL |
|---|---|
| `src/agents/runner.js:975,1006,1272` | konfigurace agenta |
| `src/agents/sources/inspector.js:45` | konfigurace zdroje |
| `src/agents/sources/rss.js:20,43,44` | konfigurace zdroje |
| `src/notifications/channels/ntfy.js:80,150` | `C3_NTFY_SERVER` |
| `src/notifications/channels/push.js:67,95` | konfigurace kanálu |
| `src/notifications/channels/telegram.js:34` | `C3_TELEGRAM_BOT_TOKEN` |
| `src/notifications/channels/webhook.js:96` | **libovolná URL od uživatele** |
| `src/notifications/e2e-verify.js:124,181` | konfigurace kanálu |
| `src/tools/http-client.js:225` | **libovolná URL** |
| `src/tools/registry.js:660,3610,3981,4033,4080,4158` | **libovolná URL** |

### E. Prohlížečový same-origin (11)

`src/ui/architect/architect.js:106,1231,1476,1564,1801,1833,2708,3174,3200,3236`
volá vlastní `/api/*`. Výjimka: **`:3227`** volá
`settingsState.system.ollamaUrl + '/api/tags'` — pokud uživatel nastaví
vzdálenou Ollamu, jde spojení z **prohlížeče** přímo tam, mimo backend a mimo
jakoukoli serverovou policy. Pro `WP-M5-AUTH` to znamená, že policy na backendu
tenhle call site nepokryje.

### F. Falešný pozitiv (1)

`src/domains/scaffolds/fullstack.js:100` — `fetch('http://localhost:3000/api/health')`
je uvnitř **template stringu** generovaného scaffoldu. Produkt to nevolá; je to
text, který se zapíše do vygenerovaného `App.jsx`.

---

## 3. Background a startup cesty

Tři plánovače, všechny spouštěné ze `src/server.js`:

| Plánovač | Kde | Perioda | Default | Cesta ven |
|---|---|---|---|---|
| Agent scheduler | `src/agents/scheduler.js:94`, start `src/server.js:1208` | **30 s** | **zapnuto** (`C3_ENABLE_AGENTS !== 'false'`) | jen když existuje agent se zdrojem |
| Update checker | `src/packaging/auto-updater.js:297`, start `src/server.js:1365` | 24 h | **vypnuto** — gate `if (process.env.C3_UPDATE_REPO)` | `api.github.com` |
| Upgrade manager | `src/upgrade/upgrade-manager.js:1396`, start `src/server.js:1372` | poll 5 min, full cycle 24 h ±90 min | **start nepodmíněný** | jen při `onlineDiscovery` |

### Nález `OB-1` — jediný nepodmíněný background start je uvnitř gated

`upgradeManager.startPeriodicCheck()` na `src/server.js:1372` se volá bez
podmínky, na rozdíl od update checkeru o sedm řádků výš. Sám o sobě ale ven
nesahá: 5minutový poll jde na Ollama loopback a internetová část je uvnitř
podmíněná `config.features?.onlineDiscovery`
(`upgrade-manager.js:869` a `:1224`).

Ten flag je:

```js
// src/config.js:30
onlineDiscovery: process.env.C3_ENABLE_ONLINE_DISCOVERY === 'true',
```

Tedy **opt-in**, přesně jak vyžaduje L0-12. Potvrzeno i v logu běhu:
`Discovered 13 local + 0 catalog + 0 L4` — katalogová a L4 větev jsou nulové.

**Ale:** `C3_ENABLE_ONLINE_DISCOVERY` **není v `.env.example`.** Jediný vypínač
mezi produktem a `ollama.com` + `whatllm.org` není nikde zdokumentovaný.

### Nález `OB-2` — LLM může vyvolat egress bez schválení

`src/executor/tool-executor.js:24` importuje `searchWeb` a `fetchPage`;
`executeWebSearch` (`:981`) a web scrape (`:1130`) je volají. Hledání
`C3_ENABLE_WEB|allowNetwork|networkEnabled|offline` v `tool-executor.js` ani
`web-search.js` nemá zásah — **žádný síťový gate na téhle cestě není.**

Prakticky: rozhodnutí modelu pošle dotaz na `html.duckduckgo.com` nebo na
veřejnou SearX instanci, případně stáhne libovolnou URL. To se netýká jen
L0-12, ale i L0-11 (efekt pod autoritou uživatele) a L0-13 (data přes hranici),
protože do dotazu jde obsah konverzace.

Pro `WP-M5-AUTH` je tohle nejtěžší call site: nedá se zavřít flagem, aniž se
zruší schopnost. Potřebuje scope a approval, ne vypínač.

---

## 4. Nález `OB-3` — audit odchozí komunikace neexistuje

Dotaz na tabulky obsahující `audit`, `effect`, `approval` nebo `grant`
v čerstvě vytvořené DB vrací jedinou: **`merge_audit_log`**, která se týká
mergů, ne sítě.

Odchozí volání tedy dnes nikde nezanechávají dohledatelnou stopu. To, co
existuje, je aplikační log — a i ten nerovnoměrně:

| Modul | `logger.` volání |
|---|---|
| `src/llm/web-search.js` | 19 |
| `src/marketplace/marketplace-client.js` | 8 |
| `src/packaging/auto-updater.js` | 7 |
| `src/upgrade/registry-client.js` | 4 |
| `src/upgrade/whatllm-client.js` | 4 |
| `src/tools/http-client.js` | 4 |
| `src/notifications/channels/webhook.js` | 2 |
| `src/tools/registry.js` | 2 (na 6 call sites) |
| **`src/agents/sources/rss.js`** | **0** |

`rss.js` je background zdroj bez jediného logu. `tools/registry.js` má dva logy
na šest odchozích volání s libovolnou URL.

Log není audit: nemá scope, nemá vazbu na approval, není dotazovatelný a maže se
rotací. Exit kritérium M5 *„všechny outbound call sites mají policy, scope a
audit"* proto **dnes nelze splnit doplněním policy** — chybí úložiště.

---

## 5. Empirická kontrola

**Metoda.** Produkt spuštěn v default konfiguraci pod instrumentací, která
obaluje `globalThis.fetch`, `net.connect`, `net.createConnection` a `tls.connect`,
každý pokus zapíše se stackem a **vše mimo loopback zahodí výjimkou**. Jde tedy
o negativní kontrolu, ne o pasivní pozorování — kdyby produkt chtěl ven, dozvíme
se to a spojení nevznikne.

**Konfigurace.** `C3_UPDATE_REPO`, `C3_ENABLE_ONLINE_DISCOVERY` a `C3_ADMIN_TOKEN`
explicitně odstraněny z prostředí. Izolovaný `C3_DB_PATH` a `C3_PROJECTS_DIR`,
port 3399. Ollama běžela na `127.0.0.1:11434`. Čerstvá DB — 0 agentů.

**Okno.** 75 s: startup, idle, graceful shutdown na SIGTERM.

**Výsledek:**

```
{ 'probe-installed': 1, 'fetch-loopback': 3, 'connect-loopback': 3 }
--- BLOKOVANÉ (mimo loopback) ---
ŽÁDNÉ
--- unikátní cíle ---
http://127.0.0.1:11434/api/ps
http://127.0.0.1:11434/api/show
http://127.0.0.1:11434/api/tags
127.0.0.1:11434
```

**Verdikt: PASS** pro tvrzení *„default instalace neprovede tiché spojení mimo
loopback v pozorovaném okně"*.

### Co okno nepokrylo — nutno říct

| Cesta | Perioda | Pokryto? |
|---|---|---|
| Agent scheduler | 30 s | **ano**, ~2 cykly, 0 agentů v DB |
| Startup + shutdown | — | **ano** |
| Ollama poll | 5 min | ne (míří na loopback) |
| Upgrade full cycle | 24 h ±90 min | ne (gated na `onlineDiscovery`) |
| Update checker | 24 h | ne (gated na `C3_UPDATE_REPO`) |

Tvrzení tedy platí pro startup, idle a 30s agent cyklus. **Pro delší horizont
je to `NOT RUN`, ne PASS** — a to je přesně ta díra, kterou má zaplnit bounded
soak. Poctivé plné ověření L0-12 potřebuje běh delší než 24 h + 90 min.

### Rozdíly statika versus běh

- **Kód, který se nespustil:** všech 46 skutečně odchozích call sites. Očekávané
  — jsou za flagem, credentialem nebo uživatelskou akcí.
- **Spojení, které census nepředpověděl:** **žádné.** Statický census a běh se
  neshodly v ničem, co by census minul.

### Vztah k dřívějšímu `egress-scan`

`.intentsmith-artifacts/egress-scan/*-24457ba2/` obsahuje běhy z 2026-08-02 na
revizi `24457ba2` — jsou to běhy **testové sady** pod izolací sítě
(`offline-egress-valid`: verdikt `FAIL`, 62 required failures), ne census call
sites. Jiná otázka, jiná metoda; nepřespouštěl jsem je.

---

## 6. Kandidáti na policy třídy

Návrh, jak pokrýt 46 odchozích call sites malým počtem tříd. **Není to
rozhodnutí** — `WP-M5-AUTH` si ho udělá sám.

| Třída | Call sites | Co potřebuje |
|---|---|---|
| `MODEL_BACKEND` | 24 (A) | ověření, že cíl je loopback; při vzdáleném cíli explicitní opt-in a varování o odesílaných datech |
| `CONDITIONAL_SURFACE` | 8 (B) | zapnuto jen s plochou, adresa z konfigurace |
| `PRODUCT_METADATA` | 8 (C: registry, whatllm, discovery, github) | dnes gated flagem; policy = ponechat opt-in + audit |
| `USER_DESTINATION` | 12 (D: notifikace, agent zdroje) | scope na uživatelem zadanou destinaci + audit |
| `LLM_INITIATED` | 10 (C: web-search ×3 + D: tools ×7) | **approval, ne flag** — nejtěžší třída, viz `OB-2` |
| `BROWSER_DIRECT` | 1 (`architect.js:3227`) | serverová policy nepokryje; řešit v UI nebo proxovat |
| `USER_ACTION` | 3 (marketplace ×2, ipapi ×1) | audit stačí |

---

## 7. Co census nerozhodl

- **Jestli je `ipapi.co` přijatelné.** Je za tlačítkem, ale odesílá IP adresu
  uživatele třetí straně kvůli předvyplnění města a měny.
- **Jestli veřejné SearX instance patří do 1.0.** Seznam je natvrdo v kódu a
  provozují ho třetí strany.
- **Disposition 18b upgrade automatiky** — `ROADMAP.md §14` ji stejně vyžaduje
  samostatně; tento census k ní dodává, že celá cesta je dnes korektně opt-in.

## 8. Reprodukce

```bash
# počet call sites (82, ne 77 — viz shrnutí)
node -e "…walk('src')… /\bfetch\s*\(/…"

# gate onlineDiscovery
grep -n "onlineDiscovery" src/config.js src/upgrade/upgrade-manager.js

# background starty
grep -n "startUpdateChecker\|startPeriodicCheck\|agentScheduler.start" src/server.js

# negativní kontrola
node --import file://<probe.mjs> src/server.js   # probe blokuje vše mimo loopback
```

Instrumentace i izolovaný datový adresář byly mimo worktree. Do `src/**`,
`tests/**` ani konfigurace repozitáře se nezapsalo nic.
