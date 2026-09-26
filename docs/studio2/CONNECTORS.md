# Studio 2.0 — napojení na backend

Stav: podklad k [WP-STUDIO-2](../wp/WP-STUDIO-2-20260925.md). Seznam cest je
vytažený z volání v `intentsmith-ide/extensions/*/lib/browser` na `e9dcf52b`.
Nové UI **nemění žádný stávající konektor**; mění se jen jeho konzument.

## 1. Transport a identita

| Co | Jak | Připnuto |
|---|---|---|
| Adresa backendu | `window.electronIntentSmith.getBackendUrl()` při **každém** požadavku — restart spravovaného backendu mění port i capability | `chat-panel-module.js` `_backendUrl()` → přesunout beze změny |
| HTTP autorizace | `intentsmith-local-http-bootstrap.js` doplní `X-IntentSmith-Local-Capability` jen pro přesný origin | `studio-electron-boundary.e2e.js` |
| WebSocket | `ws://127.0.0.1:<port>/intentsmith/ws`, subprotokoly `intentsmith-v1` a `intentsmith-local-v1.<capability>`; `hello` s featurami `workspace, terminal, merge-preview, edit-ask, audit, m1-wire-v1` | `ws-client.js`, `m1-studio-client.test.js`, `docs/WS-PROTOCOL.md` |
| Kanály | `chat`, `agent`, `control`, `terminal`, `status`, `workspace` | `docs/WS-PROTOCOL.md` |
| Identita zpráv | Server váže efekty na `authenticatedSubject` spojení; payload ji nemůže změnit | WS-PROTOCOL „Authentication" |

Nové UI používá `ws-client.js` beze změny. Adaptér `session-store.js` mu dodá
globály `_sessions` a `_sessionActive`; routování zpět do relací zůstává podle
`reqId` terminálu, `conversationId` a posledního odesílatele.

## 2. Mapa obrazovek na API

| Obrazovka Studia 2 | Stávající konektor |
|---|---|
| Sloupec relace — chat | WS `chat` (`wsSendChat`), `control` `cancel`, `edit_approve`/`edit_reject`; historie `GET /api/conversations/:id/messages`; `POST /api/conversations`; obnova `control` `rehydrate` |
| Sloupec relace — návrh změn a schválení | `POST /api/m2/lifecycle/draft`, `prepare`, `approve`, `cancel`, `GET …/status` |
| Sloupec relace — terminál | WS `terminal` `exec` (pod `validateCommand()`), výstup `stdout`/`exec_start`/`exec_result` |
| Sloupec relace — log, průběh | WS `agent`: `turn_start`, `turn_end`, `tool_call`, `tool_result`, `llm_start`, `llm_done`, `cre_decision`, `gate_verdict`, `system_step` |
| Sloupec relace — audit | `GET /api/audit?limit=` |
| Skladatel zprávy | `POST /api/autocomplete`, `POST /api/context` (zaplnění kontextu), přílohy přes `pickAttachmentFiles` |
| Konverzace (katalog) | `GET /api/conversations?limit=50&status=` |
| Projekty | `GET /api/projects?limit=50&status=`, `POST /api/projects`, `/api/projects/:id/conversations`, `POST /api/projects/open-folder`, `GET /api/projects/defaults` |
| Specialisté | `GET /api/specialists`, `POST /api/chat/specialist` |
| Expertýzy | `GET /api/expertises`, `/api/expertise-schema`, `POST /api/expertise-wizard/test-prompt` |
| Workeři | `GET /api/agents?all=true`, `GET /api/agents/:id`; mutace jen ověřené instance M3 přes `POST /api/agent-extensions/instances/:agentId/run`, `/enable`, `/disable`. Legacy mutace `/api/agents/:id/*` a `/api/agents/dry-run` vracejí 410. |
| Obchod | `GET /api/marketplace/catalog?page=`, `POST …/catalog/refresh`, `…/install/:type/:id`, `DELETE …/installed/:type/:id`, `…/update/:type/:id`, `…/export/:type/:id` |
| Multimédia | `GET /api/media/history`, `/models`, `/health`, `/output?id=`; `POST /api/media/generate`, `/cancel`, `/favorite`, `/models/refresh` |
| Pracovní plocha — soubory | `GET /api/workspace/tree?path=`, `/ls?path=`, `/file?path=`; `POST /api/workspace/file`, `/directory`, `/rename`; `POST /api/merge-preview` |
| Pracovní plocha — kontext | `POST /api/context` |
| Nastavení — účet, výstup, funkce | `GET/POST /api/settings`, `/api/settings/import`, `/api/features`, `/api/features/reset` |
| Nastavení — modely | `/api/system/models` (`overview`, `candidates`, `downloads`, `pull`, `evaluate`, `evaluations`, `grade`, `grading`, `hunt`, `hunt/control`), `/api/system/upgrades` (`check`, `apply`, `rollback`, `bindings`), `/api/system/governor` (`report`, `proposals`, `check`) |
| Nastavení — systém | `GET /api/system/info`, `/gpu`, `/storage`; `POST /api/system/vacuum`; `/api/development/{environment,installations,policy,status,prepare,execute,cancel}` |
| Nastavení — oznámení | `GET /api/notifications/channels`, `POST /api/notifications/test` |
| Nastavení — zabezpečení | `/api/security/tokens`, `/sessions`, `/audit`, `/webhook-secret` |
| Nastavení — zálohy, logy | `GET /api/logs/export`, `POST /api/reset` |
| O aplikaci, zpětná vazba | `GET /api/health`, `/health`, `/api/feedback` |
| Vzdálený společník | `/api/m7/remote/pairing/claims` |
| Stavová lišta | `GET /api/health`, WS `status`, `/api/system/gpu` |

## 3. Mezery — co backend dnes nemá

| # | Potřeba z UI | Stav dnes | Návrh | Etapa |
|---|---|---|---|---|
| G1 | Správa zdrojů (větve, commit, pull, push, historie) | jen `GET /api/workspace/git-status` (porcelain + větev); nástroje agenta `git.status`, `git.commit` | nový konektor `/api/scm/*` s efekty přes effect broker — [SCM](SCM.md) | S2-6 |
| G2 | Upravené a otevřené soubory relace | soubory plánu a výsledku M2 v `/api/m2/lifecycle/status`, změny z WS `workspace`, soubory ve `tool_call` | nejdřív složit v UI z těchto tří zdrojů; backendový read model jen pokud to nestačí po restartu | S2-5 |
| G3 | Víc než tři relace | limit je jen v UI (`_sessionCount`), backend konverzace paralelizuje | beze změny backendu; `session-store.js` s migrací `intentsmith-session-state` | S2-1 |
| G4 | Rozložení sloupců a výběr relace ve sloupci | nic | UI stav v `localStorage` (verze 2 schématu relací) | S2-1 |
| G5 | Terminál relace | routování podle `reqId`; příkazy agenta jsou v `agent` událostech | beze změny backendu; sloupec filtruje podle `conversationId` a `reqId` | S2-1 |
| G6 | Balíčky nástrojů v obchodě | typy `skill`, `expertise`, `specialist` | mimo tento WP — [MARKETPLACE-TOOLCHAINS](MARKETPLACE-TOOLCHAINS.md) | — |

## 4. Pravidla pro nové konektory

- Čtení nemá efekt a nesmí ho vyvolat (žádný `git fetch` při zobrazení stavu).
- Každý zápis nebo síťový krok je efekt: původ, omezený rozsah, schválení podle
  politiky, audit (L0-11). Odchozí síť jen explicitně, mediovaně a auditovaně
  (L0-12).
- Politika `automatic` se nastavuje vlastním endpointem s CAS revizí, ne obecným
  `POST /api/settings` (vzor migrace 117).
- Nový konektor vlastní jeden WP; konzumenti pracují proti připnuté verzi
  (CONTRACT §6).
