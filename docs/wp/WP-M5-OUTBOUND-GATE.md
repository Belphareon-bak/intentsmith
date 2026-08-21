# WP-M5-OUTBOUND-GATE — síťový gate pro LLM-inicovaný egress

**Typ:** zapisující WP · **Slot:** paralelní vlastník, **efemérní worktree na disku**
**Vstupní revision:** `0a6bde54e1d2fdf7c284207e9555a0577ce6f6ff`
**Adresát:** nová session · integrátor
**Vychází z:** [`2026-08-07-OUTBOUND-CENSUS`](../review/2026-08-07-OUTBOUND-CENSUS.md)
**Invariant:** L0-12 — dnes `PARTIAL`

Toto je zadání, ne stav. Census je hotový; tento WP **nezakládá novou
inventuru**, uzavírá jedinou pojmenovanou plochu.

---

## 0. Vstupní brána

1. `git status` v hlavním checkoutu je skutečně čistý.
2. Worktree na disku, ne v `/tmp`.
3. Souběžně **neběží** jiný WP vlastnící `src/executor/**` nebo `src/llm/**`.
   M1 drží `src/llm/gateway.js` — viz §2, hranice je ostrá a musí se ověřit
   před prvním zápisem.

```bash
git worktree add ~/worktrees/is-outbound-gate -b wp/m5-outbound-gate 0a6bde54
```

## 1. Uživatelský výsledek

Model nemůže tiše otevřít odchozí spojení. Web search a web scrape, které dnes
spustí LLM přes tool executor, procházejí explicitním, konfigurovatelným a
auditovaným gate. Při vypnutém gate vrací nástroj **deklarovanou chybu**, ne
prázdný úspěch a ne tiché ticho.

Změřený stav, který se tím zavírá — census, nález u `src/executor/tool-executor.js`:

> `tool-executor.js` importuje `searchWeb` a `fetchPage`; `executeWebSearch`
> a web scrape je volají. Hledání `C3_ENABLE_WEB|allowNetwork|networkEnabled|offline`
> v `tool-executor.js` ani `web-search.js` nemá zásah — **žádný síťový gate na
> téhle cestě není.**

Konkrétní odchozí cíl je `https://html.duckduckgo.com/html/?q=…`
(`src/llm/web-search.js`, funkce `searchDDG`), plus SearX instance a libovolná
URL předaná do `fetchPage`.

## 2. Vlastněné a zakázané cesty

| | |
|---|---|
| **Vlastněné** | `src/executor/tool-executor.js` — **pouze** `executeWebSearch` a web scrape větev · `src/llm/web-search.js` · `src/config.js` — **pouze** přidání jednoho flagu |
| **Testy** | `tests/outbound-gate.test.js` (nový) · `tests/tool-enforcement.test.js` (rozšíření) |
| **Registry** | pouze **přidání** jednoho záznamu |
| **Zakázané** | `src/llm/gateway.js` (vlastní M1, `ModelRequest/Result`) · `src/upgrade/**` · `src/db/**` · `src/chat/**` · `src/ws-bridge/**` · `src/routes/**` · `specialists/**` · `scripts/**` · `CONTRACT.md` · `ROADMAP.md` · `SYSTEM-MAP.md` · `docs/decisions/**` |

**Ostrá hranice vůči M1.** `src/llm/` obsahuje `gateway.js`, který vlastní
`WP-M1-MODEL`. Tento WP se ho **nesmí dotknout** — Ollama egress na
`config.ollama.baseUrl` je loopback a do scope nepatří. Vlastněný je jen
`web-search.js` ve stejném adresáři. Před prvním zápisem ověř `git log -1 --stat`,
že M1 do `web-search.js` nezasahuje.

**Rezervace registry záznamu:**

```
id:          IS-T1-TESTS-OUTBOUND-GATE-TEST
path:        tests/outbound-gate.test.js
argv:        ["node", "tests/outbound-gate.test.js"]
capabilityId: C3-020        (executor capabilities / tool enforcement)
tier:        T1
fixture:     isolated-home
profile:     offline
timeoutMs:   120000
expectedDurationMs: 20000
requirements: network=none, database=false, server=false, ollama=false, gpu=false
owner:       WP-M5-OUTBOUND-GATE
```

Sada musí být `network: none` a splnit to doopravdy — gate se testuje tím, že
spojení **nevznikne**, ne tím, že uspěje.

## 3. Vlastněný connector

**Žádný veřejný.** WP nemění `ToolRequest/Result` jako kontrakt — ten je
teprve scope `WP-M2-TOOLS`. Mění se pouze návratová hodnota dvou konkrétních
nástrojů o jeden typovaný chybový stav. Tvar chyby se zapíše do zadání
`WP-M2-TOOLS` jako vstup, ne jako hotový kontrakt.

## 4. Vstupní revision a závislosti

- vstup: `0a6bde54`
- závisí na: nic rozhodnutého; census je hotový
- **nezávisí na:** M1, M2 effect brokeru, L0-8
- **předchází:** `WP-M2-EFFECT` — až vznikne broker, gate se stane jeho
  konzumentem. Tento WP proto **nesmí** stavět vlastní policy/approval
  aparát. Zavádí jediný fail-closed vypínač a typovanou chybu, nic víc.

Tohle je hlavní riziko zadání: pokušení postavit „malý effect broker" bokem.
Nesmí se stát — M2 by ho musel zrušit.

## 5. Malá demonstrace

```bash
# default: dnešní chování zachováno
node -e "…executeWebSearch('test')…"        # vrací výsledky

# gate vypnutý
C3_ENABLE_WEB_TOOLS=false node -e "…"       # typovaná chyba, žádné spojení
```

Chyba nese kód ve tvaru shodném s existující konvencí souboru — vzorem je
`SCRAPE_REQUIRES_URL`, který už v `tool-executor.js` je. Navržený tvar:
`WEB_TOOLS_DISABLED`.

## 6. Focused pozitivní a negativní test

**Pozitivní**

1. Se zapnutým gate se chování nemění — existující sady `tool-enforcement`
   a `capability-sandbox` procházejí beze změny.
2. Vypnutý gate vrací typovanou chybu s pojmenovaným kódem, nikoli prázdný
   výsledek. Tohle je přímý protějšek nálezu, že gateway přijme HTTP `200`
   s prázdným obsahem jako úspěch — stejná třída chyby se tu nesmí zopakovat.
3. Gate je čitelný ze stejného místa jako ostatní flagy (`config.features`
   vzor `C3_ENABLE_*`).

**Negativní — jádro WP**

1. **Žádné spojení nevznikne.** Test nesmí spoléhat na to, že fetch vrátí
   chybu; musí instrumentovat odchozí vrstvu a doložit **nula pokusů**. Sada
   běží pod `network: none`, takže úspěšný fetch by stejně selhal — a právě
   proto by test bez instrumentace prošel z nesprávného důvodu.
2. `fetchPage` s libovolnou URL při vypnutém gate nespustí spojení.
3. Gate nelze obejít druhým vstupem: test projde **oba** call sites
   (`executeWebSearch` i scrape větev), ne jen jeden.
4. Default konfigurace zůstává funkčně identická — negativní test dokládá, že
   WP nezměnil produktové chování potichu.

> **Poučení, které se sem přenáší z profilu `model`:** prerekvizitu si sada
> musí **vyrobit, ne předpokládat od prostředí**, a guard test musí ověřit
> **obě poloviny**, jinak projde z nesprávného důvodu.

## 7. Stop condition / eskalace

- **BLOCK** — ukáže se další odchozí cesta iniciovaná modelem mimo tyto dva
  call sites. Zapiš finding, scope nerozšiřuj; census eviduje 82 `fetch` call
  sites, z toho 46 skutečně odchozích, a jejich sjednocení je práce
  `WP-M5-OBSERVE` a M2 brokeru.
- **BLOCK** — potřeba sáhnout na `src/llm/gateway.js`.
- **BLOCK** — potřeba zavést approval nebo audit tabulku. To je M2.
- **DECIDE-AND-CONTINUE** — default hodnota flagu. Šev: jeden řádek v
  `src/config.js`. Default je **zapnuto** (`!== 'false'`), protože vypnutí by
  bylo tichá změna produktového chování; opt-out je levněji vratný než
  opt-in u už existující funkce. Zapiš do `docs/decisions/`.
- **FINDING** — `executeWebSearch` nebo scrape mají další vadu (např. tichý
  úspěch při prázdné odpovědi). Neopravuj, zapiš.

## 8. Ověřovací příkaz a očekávaný výsledek

```bash
C3_LOG_LEVEL=error node tests/outbound-gate.test.js          # exit 0
C3_LOG_LEVEL=error node tests/tool-enforcement.test.js       # exit 0
C3_LOG_LEVEL=error node tests/capability-sandbox.test.js     # exit 0
C3_LOG_LEVEL=error node tests/executor-capabilities.test.js  # exit 0
node scripts/validate-test-registry.js                       # +1 program, exit 0
node scripts/module-boundary-ratchet.mjs                     # added=0 nebo přesná deklarovaná hrana
C3_LOG_LEVEL=error node tests/repository-hygiene.test.js     # exit 0
git diff --check
```

Ratchet smí přijmout novou hranu jen tehdy, je-li vypsaná jako přesná
`from → to` dvojice s odůvodněním v tomto WP. Široká adresářová výjimka je
tvrdé selhání.

**Co tento WP nedokazuje.** Nedokazuje L0-12 jako celek. Zavírá jednu
pojmenovanou plochu; `PARTIAL` zůstává, dokud explicitní outbound plochy
nemají jednotnou policy a dokud neproběhne dlouhohorizontový scan —
[`P9-OUTBOUND-LONG-HORIZON`](P9-OUTBOUND-LONG-HORIZON.md).
