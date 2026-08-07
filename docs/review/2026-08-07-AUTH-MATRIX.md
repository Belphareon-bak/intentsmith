# Route/WS auth matrix

**Zadání:** [`docs/wp/P4-AUTH-MATRIX.md`](../wp/P4-AUTH-MATRIX.md)
**Revision:** `1fc8f03e649dd561fb279ce68e5c119d35faad55` · **Datum:** 2026-08-07
**Adresát:** vlastník `WP-M5-AUTH`

> **Tento dokument není evidence** ve smyslu [`docs/review/README.md`](README.md).
> Negativní kontrola v `§5` je pozorování na této revizi.

---

## Shrnutí pro `WP-M5-AUTH`

**272 definic route, 251 unikátních klíčů** v 20 souborech. Z toho **7** má
per-route kontrolu (`src/routes/security.js`). Zbylých **244** chrání jediná věc:
hraniční kontrola `evaluateLegacyLocalAccess()` na `src/server.js:1091`.

Matrix je proto degenerovaný — sloupec „dnešní ochrana" má u 244 řádků stejnou
hodnotu. **To je ten nález.** Není to díra: hranice měřitelně funguje (`§5`).
Je to ale jediný bod selhání a přesně ten, který M5 odstraňuje ve chvíli, kdy
produkt přestane být loopback-only.

Čtyři věci mění zadání `WP-M5-AUTH` oproti tomu, co předpokládá `ROADMAP.md §9`:

- **`AM-1`** — globální middleware neexistuje; guard má právě jedno možné místo;
- **`AM-2`** — `mockReq` most u agent route **nepřenáší hlavičky**, takže
  header-based auth na 22 route nelze zavést bez změny mostu;
- **`AM-3`** — v produktu jsou dvě neslučitelné auth sémantiky, jedna fail-closed
  a jedna fail-open;
- **`AM-4`** — 21 klíčů je definovaných dvakrát; `GET /api/health` napříč dvěma
  soubory, kde pozdější spread tiše přebíjí dřívější.

### Oprava vstupního čísla

Zadání uvádělo 264 klíčů v `src/routes/*.js` z grepu. Strukturovaný parse (klíč
musí být na začátku řádku a následovat `:`) dává **257** v `src/routes/` a
**272** v celém `src/`. Rozdíl proti grepu jsou řetězce `'GET /…'` mimo definici
route.

---

## 1. Tvar routování — proč to není Express

`src/server.js:1091` vytváří `http.createServer`. Route moduly vracejí **objekty**
`{'GET /api/foo': handler}`, které se na `src/server.js:804-844` slévají spreadem
do jediné konstanty `routes`. Dispatch je `matchRoute()` na `src/server.js:989`,
volaný z `src/server.js:1175`.

### Nález `AM-1` — guard má právě jedno možné místo

Middleware chain neexistuje, takže není kam „pověsit" guard per route. Existují
jen dvě místa:

1. **před `matchRoute()`** — guard vidí metodu a URL, ale ne to, který handler
   se zavolá;
2. **uvnitř každého handleru** — 251 zásahů, přesně ten anti-pattern, kterým dnes
   trpí `security.js`.

Pro `WP-M5-AUTH` z toho plyne, že guard bude muset klasifikovat podle **klíče
route**, ne podle handleru. To je proveditelné — klíče jsou statické a známé při
startu — ale znamená to, že klasifikace musí být deklarativní tabulka vedle
`routes`, a ta se musí udržovat. Tuhle položku roadmapa nezmiňuje.

---

## 2. Dnešní ochrana

| Vrstva | Kde | Rozsah | Chování |
|---|---|---|---|
| Local access boundary | `src/server.js:1091-1125` | **všechny** HTTP requesty | 403 `LEGACY_LOCAL_ACCESS_REQUIRED` při nesouhlasu host/origin/capability |
| WS `verifyClient` | `src/ws-bridge/ws-server.js:117` | WS **handshake** | totéž pro upgrade |
| `requireAuth()` | `src/routes/security.js:20-38` | **7** route | dev+localhost → projde; jinak `C3_ADMIN_TOKEN`; bez tokenu → **403** |
| `requireAdminAuth()` | `src/agents/api.js:18` | 3 handlery, **nepřipojené** | bez tokenu → **projde** |
| `validateApiToken()` | `src/routes/security.js:270` | **nikde** | definovaná, exportovaná, nevolaná |

### Nález `AM-3` — dvě neslučitelné sémantiky

```js
// src/routes/security.js:20-38  — fail-closed
if (isDev && isLocalhost) return true;
if (!adminToken) { sendJSON(res, 403, {...}); return false; }

// src/agents/api.js:18  — fail-open
const expected = process.env.C3_ADMIN_TOKEN;
if (!expected) return true;  // no token configured = local dev mode
```

Chybějící token znamená v jednom souboru „odmítni", v druhém „pusť". `C3_ADMIN_TOKEN`
je přitom v `.env.example` prázdný, takže default install je vždy v té druhé větvi.

**Dnes to nic neotvírá** — tři handlery, které `requireAdminAuth()` hlídá
(`listSecrets`, `setSecret`, `deleteSecret`, `src/agents/api.js:384,400,420`),
**nejsou připojené do route tabulky**. `src/routes/agents.js` mapuje 22 handlerů
a secrets mezi nimi nejsou. Ověřeno empiricky: `GET /api/secrets` → **404**.

Express mount `mountAgentRoutes()` (`src/agents/api.js:809-839`), který je jako
jediný registruje, není odnikud volaný — je to mrtvý kód.

Riziko je tedy latentní, ne aktivní: kdo doplní `'GET /api/secrets'` do
`src/routes/agents.js`, zdědí fail-open sémantiku, a bude to vypadat jako
chráněná route.

### Nález `AM-2` — most k agent route zahazuje hlavičky

`src/routes/agents.js` překládá 22 route na handlery přes umělý request:

```js
'GET /api/agents': async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  const mockReq = { query: { all: url.searchParams.get('all') } };
  const mockRes = createMockResponse(res);
  await agentRoutes.listAgents(mockReq, mockRes);
},
```

`mockReq` nese `query` nebo `params` — **nikdy `headers`**. Jakýkoli guard uvnitř
`agents/api.js`, který čte `req.headers.authorization`, dostane `TypeError`.
`requireAdminAuth()` je právě takový.

Pro `WP-M5-AUTH`: buď guard poběží **před** mostem (na úrovni klíče route, viz
`AM-1`), nebo se musí změnit `createMockResponse`/`mockReq` kontrakt ve všech
22 místech. První cesta je levnější a je to další argument pro deklarativní
klasifikaci podle klíče.

### Nález `AM-4` — 21 klíčů definovaných dvakrát

`routes` vzniká spreadem, takže **pozdější definice tiše přebíjí dřívější**.

- **`src/routes/specialists.js`** (13 klíčů) a **`src/routes/marketplace.js`**
  (7 klíčů) — obojí uvnitř jednoho souboru, větev „nedostupné" versus reálná.
  Provede se jen jedna větev; není to vada, ale grep-based census tím nadhodnotí.
- **`GET /api/health`** — definovaný na **`src/server.js:800`** i
  **`src/routes/misc.js:81`**. Spread `createMiscRoutes(routeDeps)` je na
  `src/server.js:811`, tedy **až za** inline definicí. Vyhrává `misc.js`;
  definice na `server.js:800` je mrtvá a nikdo se to nedozví.

Guard, který se bude klasifikovat podle klíče, musí tuhle kolizi umět detekovat —
jinak přiřadí politiku definici, která se nikdy nespustí.

---

## 3. Route matrix

Rozlišení „mění stav" odvozuji z metody: `GET`/`HEAD` čte, ostatní mění.
Sloupce „dnešní ochrana" a „rozbil by fail-closed guard dev mode" jsou pro
všech 244 ne-security route konstantní: *jen hraniční kontrola* a *ano*.

| Metoda | Počet | Mění stav |
|---|---|---|
| GET | 121 | ne |
| POST | 121 | **ano** |
| DELETE | 16 | **ano** |
| PUT | 8 | **ano** |
| PATCH | 6 | **ano** |
| **Celkem** | **272** | 151 mění stav |

### 3.1 Route s nejvyšším efektem

Ze 151 stav měnících route má **76** v těle handleru vzor spuštění procesu,
zápisu, mazání, instalace nebo migrace. Nejzávažnější podmnožina:

| Route | Efekt | Ochrana dnes |
|---|---|---|
| `POST /api/workspace/file` <br> `POST /api/workspace/directory` <br> `PUT /api/workspace/rename` <br> `DELETE /api/workspace/file` | **zápis a mazání v souborovém systému** projektu | jen hranice |
| `POST /api/marketplace/install/:type/:id` <br> `POST /api/marketplace/update/:type/:id` <br> `DELETE /api/marketplace/installed/:type/:id` | **instalace cizího kódu** z katalogu | jen hranice |
| `POST /api/system/models/pull` <br> `DELETE /api/system/models` | stažení a mazání modelů (GB dat) | jen hranice |
| `POST /api/system/upgrades/apply` <br> `POST /api/system/upgrades/rollback` | změna modelové konfigurace | jen hranice |
| `POST /api/system/vacuum` <br> `POST /api/system/drain` <br> `POST /api/system/clean` <br> `POST /api/system/shutdown-backup` | destruktivní operace nad DB a daty | jen hranice |
| `POST /api/reset` <br> `POST /api/features/reset` | reset stavu produktu | jen hranice |
| `DELETE /api/projects/:id` <br> `DELETE /api/conversations/:id` | mazání uživatelských dat | jen hranice |
| `POST /api/specialists` <br> `POST /api/specialists/:id/update` | registrace a update balíčku specialisty | jen hranice |
| `POST /architect/action` | akce architekta nad projektem | jen hranice |
| `POST /api/autonomy/approve/:id` <br> `POST /api/skills/executions/:id/confirm` <br> `POST /api/lifecycle/*/approve` | **udělení approvalu** — autorita uživatele podle L0-11 | jen hranice |
| `POST /api/security/tokens` <br> `DELETE /api/security/tokens/:id` <br> `POST /api/security/webhook-secret` | vydání a zneplatnění credentialů | **`requireAuth()`** |

Approval route stojí za zvláštní pozornost: L0-11 vyžaduje, aby efekt měl
*„odpovídající approval"*. Approval sám je dnes route chráněná stejně jako
`GET /api/health`.

### 3.2 Úplný výpis

Všech 272 definic je v `§9`.

---

## 4. WS matrix

Handshake ověřuje `createLegacyWebSocketVerifyClient()`
(`src/ws-bridge/ws-server.js:117`). **Po handshake už žádná zpráva ověřovaná není.**

| Kanál / typ | Kde | Efekt | Ochrana |
|---|---|---|---|
| `hello` | `ws-server.js:181` | verze protokolu | handshake |
| `chat` | `ws-server.js:226` | **celý chat pipeline** — LLM, CRE, tool calls | handshake |
| `control` → `cancel` | `session-adapter.js:528` | zrušení běhu | handshake |
| `control` → `ping` | `session-adapter.js:546` | žádný | handshake |
| `control` → `sync_settings` | `session-adapter.js:551` | změna nastavení | handshake |
| `control` → **`edit_approve`** | `session-adapter.js:580` | **zápis do souboru** (hash guard proti `baseHash`) | handshake |
| `control` → `edit_reject` | `session-adapter.js:633` | zahodí návrh | handshake |
| `terminal` → `exec` | `ws-server.js:255` → `session-adapter.js:454` | **spuštění shell příkazu**, timeout 120 s | handshake + `validateCommand()` |

**`edit_approve` je approval i efekt v jedné zprávě** — schválí a rovnou zapíše.
Podle L0-11 je to nejcitlivější místo WS povrchu a ověřené je jen tím, že
handshake prošel.

**`terminal` není nechráněný**, jen ne autentizací: `C3ToolExecutor` volá
`validateCommand()` z `src/executor/shell-security.js`, kde je whitelist binárek
(`ALLOWED_COMMANDS`, `:12`), blacklist argumentů (`:56`) a path sandbox
(`:107`). Je to tedy capability guard, ne auth guard — omezuje **co** lze
spustit, ne **kdo** to smí.

Pro `WP-M5-AUTH`: zpráva, která umí zápis nebo exec a projde jen handshake, je
ekvivalent neautentizované route. Takové jsou **tři** — `chat`, `edit_approve`,
`terminal`.

---

## 5. Negativní kontrola

Produkt spuštěn v default konfiguraci (`C3_ADMIN_TOKEN` odstraněn z prostředí),
izolovaná DB, port 3398.

### 5.1 Loopback bez credentials

| Request | Odpověď |
|---|---|
| `GET /api/health` | **200** |
| `GET /api/projects` | **200** |
| `GET /api/agents` | **200** |
| `POST /api/system/backup` | **200** — záloha skutečně vytvořena |
| `GET /api/security/audit` | **200** — localhost bypass v `requireAuth()` |
| `GET /api/secrets` | **404** — route neexistuje (viz `AM-3`) |

### 5.2 Hranice

| Request | Odpověď |
|---|---|
| `GET /api/projects` s `Origin: https://evil.example` | **403** |
| `GET /api/secrets` s `Origin: https://evil.example` | **403** |
| `GET /api/projects` s `Host: evil.example` | **403** |
| WS handshake bez `Origin` (nativní klient) | **spojeno** |
| WS handshake s `Origin: https://evil.example` | **403** |

**Verdikt: PASS.** Hranice odmítá cizí origin i host na HTTP i WS. `POST` měnící
stav projde z loopbacku bez jakéhokoli credentialu — což je dnešní návrh, ne vada.

Nenašel jsem route ani WS zprávu, která by hranici obešla. Stop condition ze
zadání se neaktivovala.

---

## 6. Stav `validateApiToken()`

**Použitelná bez přepisu.** Je to čistá funkce `(rawDb, token)` →
`{ valid, id, name, scopes }`:

- hashuje SHA-256 a hledá v `api_tokens` podle `token_hash`;
- kontroluje `expires_at`;
- aktualizuje `last_used_at` jen při úspěchu;
- **vrací `scopes`** — model oprávnění tedy už existuje, včetně route
  `POST /api/security/tokens` pro vydávání.

Chybí tři věci, a všechny jsou v `WP-M5-AUTH`:

1. volající — dnes žádný (`TODO (Phase 3b): Wire into route-level middleware`
   na `src/routes/security.js:267`);
2. mapování scope → klíč route (viz `AM-1`);
3. rozhodnutí, co se stane, když token není: dev bypass, nebo odmítnutí (`AM-3`).

---

## 7. Návrh tvaru guardu

Návrh, ne implementace.

**Místo:** jediné — mezi `matchRoute()` (`src/server.js:989`) a voláním handleru
(`src/server.js:1175`), tedy **za** hraniční kontrolou a **před** mostem k agent
route. Tím se obchází `AM-2` i anti-pattern per-handler kontrol.

**Vstup:** klíč route, který `matchRoute()` už zná.

**Klasifikace:** deklarativní tabulka vedle `routes`, s povinným pokrytím —
klíč bez třídy je chyba při startu, ne default povolení. Návrh tříd:

| Třída | Rozsah | Chování bez credentialu |
|---|---|---|
| `PUBLIC` | `GET /api/health`, `GET /health`, statika | projde |
| `READ` | 121 GET route | dev+loopback projde; jinak token |
| `MUTATE` | 151 stav měnících | dev+loopback projde; jinak token se scope |
| `SENSITIVE` | 76 z `§3.1` + `security.js` | **vždy token**, i na loopbacku |
| `APPROVAL` | approval route z `§3.1` | vždy token; audit povinný (L0-11) |

**WS:** `chat`, `edit_approve` a `terminal` potřebují třídu i po handshake.
Handshake může nést token jednou a session si držet scope — pak se per-message
kontrola redukuje na porovnání se scope session.

**Co guard nesmí rozbít:** dev mode. Dnes projde všech 244 route z loopbacku bez
credentialu; nasazení `SENSITIVE` bez dev výjimky zastaví vývoj i M1 demonstrace.
Doporučení je proto explicitní `NODE_ENV`-vázaná výjimka pro `READ` a `MUTATE`,
ale **ne** pro `SENSITIVE` a `APPROVAL` — u těch se token vyžaduje vždy a je to
ta část, která se dá zavést hned.

---

## 8. Co matrix nerozhodl

- **Zda `SENSITIVE` vyžaduje token i na loopbacku v dev módu.** Mění to denní
  práci a je to operátorské rozhodnutí.
- **Osud mrtvého `mountAgentRoutes()`** a tří nepřipojených secrets handlerů:
  připojit se sjednocenou sémantikou, nebo odstranit.
- **Zda `GET /api/health` na `src/server.js:800` má zmizet** — dnes je nedosažitelný.
- **Scope model** — `validateApiToken()` scopes vrací, ale co znamenají, nikdo
  nedefinoval.

## 9. Úplný výpis route

Formát: `soubor (počet)`, pod tím klíče v pořadí definice.

```
src/notifications/trust-api.js  (5)
  POST /api/notifications/:id/feedback
  GET /api/trust/metrics
  GET /api/trust/metrics/:agentId
  POST /api/trust/:agentId/unmute
  POST /api/trust/:agentId/reset

src/routes/agents.js  (22)
  GET /agents
  GET /api/agents
  GET /api/agents/:id
  POST /api/agents
  PUT /api/agents/:id
  DELETE /api/agents/:id
  POST /api/agents/:id/run
  POST /api/agents/:id/enable
  POST /api/agents/:id/disable
  GET /api/agents/:id/runs
  POST /api/agents/build
  POST /api/agents/refine
  POST /api/agents/confirm
  POST /api/agents/dry-run
  GET /api/agents/schema
  POST /api/sources/inspect
  POST /api/sources/validate-field
  POST /api/sources/validate-condition
  GET /api/notifications
  POST /api/notifications/:id/read
  POST /api/notifications/read-all
  GET /api/scheduler/status

src/routes/architect.js  (7)
  POST /architect/init
  POST /architect/message
  GET /architect/status/:projectRoot
  POST /architect/action
  GET /architect
  GET /architect/architect.css
  GET /architect/architect.js

src/routes/autonomy.js  (4)
  GET /api/autonomy/status
  POST /api/autonomy/approve/:id
  POST /api/autonomy/reject/:id
  POST /api/autonomy/alerts/:id/acknowledge

src/routes/chat.js  (23)
  GET /api/chat/sessions/stats
  GET /api/chat/sessions
  GET /api/chat/sessions/:sessionId
  DELETE /api/chat/sessions/:sessionId
  POST /api/chat/specialist
  DELETE /api/chat/specialist
  POST /chat
  GET /chat-ui
  POST /api/export
  GET /api/memory
  POST /api/memory
  GET /api/conversations
  POST /api/conversations
  GET /api/conversations/:id
  GET /api/conversations/:id/messages
  PUT /api/conversations/:id
  PATCH /api/conversations/:id/archive
  PATCH /api/conversations/:id/restore
  DELETE /api/conversations/:id
  POST /api/chat
  GET /api/drafts
  POST /api/drafts
  DELETE /api/drafts

src/routes/expertises.js  (24)
  GET /api/merge-preview
  GET /api/expertise-schema
  POST /api/merge-preview
  POST /api/expertise-wizard/test-prompt
  GET /expertises
  GET /api/expertises
  GET /api/expertises/:id
  POST /api/expertises
  PUT /api/expertises/:id
  DELETE /api/expertises/:id
  POST /api/expertises/route
  POST /api/lifecycle/start
  POST /api/lifecycle/spec/answer
  POST /api/lifecycle/spec/approve
  POST /api/lifecycle/roadmap/approve
  POST /api/lifecycle/milestone/approve
  POST /api/lifecycle/milestone/next
  POST /api/lifecycle/milestone/blocked
  POST /api/lifecycle/review/acknowledge
  POST /api/lifecycle/change/propose
  POST /api/lifecycle/change/approve
  POST /api/lifecycle/change/reject
  GET /api/lifecycle/status
  GET /api/lifecycle/resume

src/routes/governor.js  (6)
  GET /api/system/governor/status
  GET /api/system/governor/report
  POST /api/system/governor/check
  GET /api/system/governor/proposals
  POST /api/system/governor/proposals/:id/approve
  POST /api/system/governor/proposals/:id/dismiss

src/routes/marketplace.js  (14 — 7 unikátních, dvě větve)
  GET /api/marketplace/catalog
  POST /api/marketplace/catalog/refresh
  GET /api/marketplace/installed
  POST /api/marketplace/install/:type/:id
  DELETE /api/marketplace/installed/:type/:id
  POST /api/marketplace/update/:type/:id
  POST /api/marketplace/export/:type/:id
  ... (tytéž klíče podruhé, druhá větev)

src/routes/media.js  (11)
  GET /api/media/health
  POST /api/media/generate
  GET /api/media/status
  GET /api/media/history
  GET /api/media/output
  GET /api/media/models
  POST /api/media/models/refresh
  POST /api/media/cancel
  PUT /api/media/favorite
  DELETE /api/media
  GET /api/media/vram

src/routes/misc.js  (16)
  GET /api/storage/info
  GET /api/settings
  POST /api/settings
  GET /api/features
  POST /api/features/reset
  POST /api/features/:name
  GET /api/health
  POST /api/autocomplete
  POST /api/context
  GET /api/audit
  GET /api/logs
  GET /api/logs/export
  POST /api/reset
  POST /api/feedback
  POST /api/feedback/:id/attach
  GET /api/feedback

src/routes/notifications.js  (7)
  GET /api/notifications/config
  POST /api/notifications/config
  GET /api/notifications/channels
  POST /api/notifications/test
  POST /api/notifications/verify
  GET /api/notifications/log
  POST /api/notifications/send

src/routes/planner.js  (10)
  POST /planner/start
  POST /planner/clarify
  POST /planner/approve
  POST /planner/reject
  GET /planner/session
  GET /planner/sessions
  GET /planner/progress
  GET /planner/dashboard
  GET /planner/project/:projectId/sessions
  POST /planner/resume

src/routes/projects.js  (32)
  GET /projects
  POST /projects
  GET /api/projects/defaults
  GET /api/projects
  POST /api/projects
  GET /api/projects/:id
  PUT /api/projects/:id
  GET /api/projects/:id/conversations
  GET /api/projects/:id/lifecycle
  POST /api/projects/:id/lifecycle/bind
  POST /api/projects/lifecycle/start
  POST /api/projects/open-folder
  PATCH /api/projects/:id/archive
  PATCH /api/projects/:id/restore
  DELETE /api/projects/:id
  POST /api/conversations/:id/assign
  GET /api/projects/:id/roadmap
  POST /api/attachments
  GET /api/artifacts/:filename
  GET /api/attachments/:id
  GET /api/workspace/tree
  GET /api/workspace/ls
  GET /api/workspace/file
  POST /api/workspace/file
  POST /api/workspace/directory
  PUT /api/workspace/rename
  DELETE /api/workspace/file
  GET /api/workspace/git-status
  GET /api/projects/:id/memory
  PUT /api/projects/:id/memory
  POST /api/projects/:id/readme
  DELETE /api/projects/:id/memory/:key

src/routes/quality.js  (5)
  GET /api/quality/summary
  GET /api/quality/distribution
  GET /api/quality/project/:id
  GET /api/quality/volatility/:id
  GET /api/quality/report

src/routes/security.js  (7 — jediné s per-route kontrolou)
  GET /api/security/audit
  GET /api/security/tokens
  POST /api/security/tokens
  DELETE /api/security/tokens/:id
  GET /api/security/webhook-secret
  POST /api/security/webhook-secret
  GET /api/security/sessions

src/routes/skills.js  (7)
  GET /api/skills
  GET /api/skills/:id
  POST /api/skills/reload
  GET /api/skills/executions/:id
  POST /api/skills/executions/:id/confirm
  POST /api/skills/executions/:id/resume
  POST /api/skills/executions/:id/cancel

src/routes/specialists.js  (26 — 13 unikátních, dvě větve)
  GET /api/specialists
  GET /api/specialists/:id
  POST /api/specialists/:id/enable
  POST /api/specialists/:id/disable
  POST /api/specialists/:id/update
  POST /api/specialists/discover
  GET /api/specialists/:id/integrity
  GET /api/specialists/telemetry
  GET /api/specialists/:id/expertises
  POST /api/specialists/:id/expertises
  DELETE /api/specialists/:id/expertises/:expertiseId
  PATCH /api/specialists/:id/expertises/:expertiseId
  POST /api/specialists
  ... (tytéž klíče podruhé, druhá větev)

src/routes/system.js  (36)
  GET /api/system/gpu
  POST /api/system/gpu/refresh
  GET /api/system/models/compatibility
  GET /api/system/models/check
  GET /api/system/models
  GET /api/system/models/info
  GET /api/system/models/universe
  GET /api/system/models/universe/:name
  GET /api/system/info
  GET /api/system/storage
  GET /api/system/storage/settings
  PUT /api/system/storage/settings
  POST /api/system/drain
  POST /api/system/clean
  POST /api/system/backup
  GET /api/system/backups
  POST /api/system/shutdown-backup
  POST /api/system/vacuum
  GET /api/system/upgrades
  POST /api/system/upgrades/check
  POST /api/system/upgrades/apply
  POST /api/system/upgrades/rollback
  DELETE /api/system/models
  GET /api/system/upgrades/bindings
  GET /api/system/catalog
  GET /api/system/proposals
  GET /api/system/upgrades/scoring
  GET /api/system/upgrades/discovered
  POST /api/system/models/pull
  GET /api/system/upgrades/recommendations
  POST /api/system/models/validate
  GET /api/system/models/validate
  GET /api/system/models/validation-scores
  GET /api/system/models/overview
  POST /api/system/models/validate-all
  POST /api/system/proposals/:id/dismiss

src/server.js  (4)
  GET /
  GET /api/health          ← mrtvá, přebita misc.js:81 (AM-4)
  GET /health
  GET /api/license/status

src/setup/wizard.js  (6)
  GET /api/setup/status
  POST /api/setup/ollama
  POST /api/setup/language
  POST /api/setup/notifications
  POST /api/setup/license
  POST /api/setup/complete
```

## 10. Reprodukce

```bash
# 272 definic / 251 unikátních klíčů
# parse: /^\s*'(GET|POST|PUT|DELETE|PATCH|HEAD|OPTIONS) ([^']+)'\s*:/ nad src/**/*.js

# dvě auth sémantiky
sed -n '20,38p' src/routes/security.js
sed -n '17,22p'  src/agents/api.js

# mrtvý Express mount
grep -rn "mountAgentRoutes" src/    # jediný zásah = definice

# negativní kontrola (server na izolované DB, port 3398, bez C3_ADMIN_TOKEN)
curl -s -o /dev/null -w '%{http_code}' http://127.0.0.1:3398/api/secrets            # 404
curl -s -o /dev/null -w '%{http_code}' -H 'Origin: https://evil.example' \
     http://127.0.0.1:3398/api/projects                                             # 403
```

Testovací server běžel na izolovaném `C3_DB_PATH` a `C3_PROJECTS_DIR` mimo
worktree a byl ukončen. Do `src/**`, `tests/**` ani konfigurace se nezapsalo nic.
