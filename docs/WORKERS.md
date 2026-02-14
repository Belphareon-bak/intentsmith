# C.3 Workers & Notifikace

**Verze:** v64.0 (2026-02-14)

Viz take: [EXPERTS.md](EXPERTS.md) | [SPECIALISTS.md](SPECIALISTS.md) | [README.md](README.md)

---

## Obsah

1. [Agent Runner & Scheduler](#agent-runner--scheduler) — exekucni engine, HUNTER pattern
2. [Zdroje, Podminky & Triggery](#zdroje-podminky--triggery) — data pipeline
3. [Notifikacni Pipeline](#notifikacni-pipeline) — dorucovani, policy, trust feedback
4. [REST API](#rest-api) — 28 endpointu
5. [Prikladove Agenti](#prikladove-agenti) — 6 sablon
6. [Testy](#testy)

---

# Agent Runner & Scheduler

## Co to je

Agent Runner je **deterministicky exekucni engine** pro autonomni monitoring a automatizaci. Workeri periodicky stahuju data z externich zdroju (HTTP API, RSS feedy), vyhodnocuji podminky, detekuji hranove zmeny (triggery) a provaduji akce (notifikace, webhooky). Cely rozhodovaci proces je algoritmicky — **zadne LLM v jadru exekuce**.

**Klicovy princip: HUNTER pattern** — `mark_seen` se provadi PRED business akcemi. Pokud server spadne po mark_seen ale pred notifikaci, pri restartu se polozky nepracuji znovu (crash-safe deduplikace).

## Architektura

```
AgentScheduler (cron/interval, 30s check loop)
  |
  v
AgentRunner.execute(agentId)
  |
  +-- STEP 1: Fetch Sources (paralelne, Promise.all)
  |     +-- fetchHttp(config)     → JSON/text
  |     +-- fetchRss(config)      → items[] via RSSSource
  |
  +-- STEP 2: Filter Seen Items (HUNTER pattern)
  |     +-- repository.getSeenItemIds(agentId, sourceId)
  |     +-- Identifikace: id, _id, url, link, nebo JSON hash
  |
  +-- STEP 3: Build _merged View (multi-source)
  |     +-- Cross-source deduplikace (URL exact || title Jaccard > 0.6)
  |
  +-- STEP 4: Evaluate Conditions (deterministicky)
  |     +-- 7 typu: compare, date_diff, contains, exists, in_range, changed, new_items
  |     +-- Schema degradace: >= 50% invalid → agent auto-disabled
  |
  +-- STEP 5: Detect Trigger Edges (stavove)
  |     +-- rising/falling/any + cooldown + max_fires_per_day
  |
  +-- STEP 6a: mark_seen (transakcni, PRED business akcemi!)
  |
  +-- STEP 6b: Execute Business Actions (s retry/backoff)
  |     +-- notify → NotificationPipeline
  |     +-- webhook → HTTP POST
  |     +-- update_state → persist
  |
  +-- STEP 7: Persist State + Complete Run
        +-- run_state: SUCCESS_TRIGGERED | SUCCESS_NO_TRIGGER | ...
```

## Run States (12)

| Stav | Typ | Popis |
|------|-----|-------|
| `SUCCESS_TRIGGERED` | Uspech | Podminky splneny, akce provedeny |
| `SUCCESS_NO_TRIGGER` | Uspech | Zadny trigger nevysel |
| `SUCCESS_NO_NEW` | Uspech | HUNTER: zadne nove polozky |
| `INIT_BASELINE` | Specialni | Prvni beh |
| `SKIP_DISABLED` | Preskoceni | Agent vypnuty |
| `SKIP_COOLDOWN` | Preskoceni | Cooldown neuplynul |
| `ERROR_SOURCE` | Chyba | Fetch zdroje selhal |
| `ERROR_EXECUTION` | Chyba | Akce selhala |
| `SCHEMA_DEGRADED` | Degradace | Nektere podminky invalidni |
| `SCHEMA_BROKEN` | Degradace | >= 50% invalidni, auto-disabled |

## Scheduler

| Typ | Format | Priklad |
|-----|--------|---------|
| Interval | string | `"5m"`, `"1h"`, `"4h"`, `"1d"` |
| Cron | 5 casti | `"0 8 * * *"` |
| Manual | — | Pouze rucne pres API |

**Deterministicky restart:** `next_run = last_run + interval_ms`. Pokud `next_run < now` → beh okamzite.

## Retry & Backoff

```
maxAttempts: 3
baseDelay: 500ms
backoffMultiplier: 2  →  500ms → 1000ms → 2000ms

Retriable: notify, webhook
Non-retriable: mark_seen, update_state, log
```

---

# Zdroje, Podminky & Triggery

## Co to je

Datovy pipeline: Zdroje stahnou data → Podminky vyhodnoti pravidla → Triggery detekuji hranove zmeny. **Zadne LLM. Vsechno je algoritmicke.**

## 7 Typu Podminek

| Typ | Popis | Priklad |
|-----|-------|---------|
| `compare` | Porovnani s prahem | cena < 5M |
| `date_diff` | Stari polozky | published > 7 dnu |
| `contains` | Text v retezci | description contains "Python" |
| `exists` | Pole existuje | data.length >= 1 |
| `in_range` | Hodnota v intervalu | cena 2M-8M |
| `changed` | Zmena oproti minule | teplota se zmenila |
| `new_items` | Nove polozky (HUNTER) | nove nabidky |

### Array Mody

| Mod | Popis |
|-----|-------|
| `any` | Alespon jeden splnuje |
| `all` | Vsechny splnuji |
| `none` | Zadny nesplnuje |
| `count` | Pocet polozek |
| `min` / `max` / `avg` / `sum` | Agregace |

## 3 Typy Triggeru

| Hrana | Podminky | Ucel |
|-------|---------|------|
| `rising` | false→true | Alert pri prekroceni prahu |
| `falling` | true→false | Alert pri zotaveni |
| `any` | zmena | Jakakoli zmena |

**Ochrana:** cooldown (sekundy) + max_fires_per_day

## Zdroje

| Typ | Stav | Popis |
|-----|------|-------|
| HTTP (GET/POST) | HOTOVO | JSON nebo text |
| RSS 2.0 + Atom 1.0 | HOTOVO | Keyword filter, CDATA podpora |
| Source Inspector | HOTOVO | URL introspekce + schema navrh |
| Scraper | PLACEHOLDER | Fallback na HTTP |
| Database | PLACEHOLDER | Vraci prazdne [] |

## Multi-Source (B6)

Deduplikace z vice zdroju:
1. **URL exact match**
2. **Title Jaccard index > 0.6**
3. **`sources._merged`** — synteticky zdroj vsech polozek
4. **Health tracking** per zdroj, castecne selhani neblokuje ostatni

---

# Notifikacni Pipeline

## Co to je

Kompletni system pro dorucovani zprav pres vice kanalu s policy enginem a trust feedback loop.

## Architektura

```
Agent akce (notify) nebo API volani
  |
  v
NotificationPipeline.process(ctx, policyConfig)
  |
  +-- 1. NotificationPolicy.evaluate()
  |       +-- Mute check (critical bypassuje)
  |       +-- Escalace (N za X minut → vyseni priority)
  |       +-- Suppress cooldown
  |       +-- Suppress if_unchanged (body hash)
  |       +-- Trust override
  |       → immediate | digest | drop
  |
  +-- 2. Routing
  |       +-- immediate → Channel.send()
  |       +-- digest → DigestAggregator.add()
  |       +-- drop → log only
  |
  +-- 3. Logging
  |
  v
Doruceno → Uzivatel da feedback (👍/👎)
  |
  v
TrustTracker.recordFeedback()
  +-- >= 30% useful → healthy
  +-- 10-30% → degraded (digest)
  +-- < 10% → critical (auto-mute 7 dni)
```

## Kanaly

| Kanal | Transport | Env |
|-------|-----------|-----|
| Email | SMTP (nodemailer) | C3_SMTP_HOST, C3_SMTP_PORT, C3_SMTP_USER, C3_SMTP_PASS |
| Telegram | Bot API, MarkdownV2 | C3_TELEGRAM_BOT_TOKEN, C3_TELEGRAM_CHAT_ID |
| Push | ntfy.sh (JSON body, UTF-8) | C3_NTFY_SERVER, C3_NTFY_TOPIC, C3_NTFY_TOKEN |

## Trust Feedback Loop

| usefulRatio | Trust Level | Akce |
|------------|-------------|------|
| >= 30% | healthy | Normalni provoz |
| 10-30% | degraded | Auto-degrade na digest |
| < 10% | critical | Auto-mute 7 dni + vysvetleni |
| < 5 feedbacku | insufficient_data | Zadna |

Auto-mute NIKDY nebyva tichy — vzdy posle vysvetleni uzivateli.

## Digest Batching

Skupiny: `agent_id::channel::recipient`. Deduplikace podle titulku. Flush na cron schedule.

---

# REST API

### Agent CRUD

| Endpoint | Metoda | Ucel |
|----------|--------|------|
| `/api/agents` | GET | Seznam |
| `/api/agents/:id` | GET | Detail + behy |
| `/api/agents` | POST | Vytvoreni |
| `/api/agents/:id` | PUT | Aktualizace |
| `/api/agents/:id` | DELETE | Smazani |

### Exekuce

| Endpoint | Metoda | Ucel |
|----------|--------|------|
| `/api/agents/:id/run` | POST | Rucni spusteni |
| `/api/agents/:id/enable` | POST | Povoleni |
| `/api/agents/:id/disable` | POST | Zakazani |
| `/api/agents/:id/runs` | GET | Historie behu |

### Builder

| Endpoint | Metoda | Ucel |
|----------|--------|------|
| `/api/agents/from-description` | POST | NL → definice |
| `/api/agents/refine` | POST | Uprava definice |
| `/api/agents/confirm` | POST | Ulozeni |

### Source Inspector

| Endpoint | Metoda | Ucel |
|----------|--------|------|
| `/api/sources/inspect` | POST | URL introspekce |
| `/api/sources/validate-field` | POST | Overit field path |
| `/api/sources/validate-condition` | POST | Otestovat podminku |

### Notifikace & Trust

| Endpoint | Metoda | Ucel |
|----------|--------|------|
| `/api/notifications` | GET | Seznam |
| `/api/notifications/:id/feedback` | POST | 👍/👎 |
| `/api/trust/metrics` | GET | Dashboard |
| `/api/trust/:agentId/unmute` | POST | Odtlumeni |

---

# Prikladove Agenti

| Sablona | Typ | Schedule | Zdroj | Akce |
|---------|-----|----------|-------|------|
| Weather Monitor | MONITOR | 1h | Open-Meteo HTTP | Telegram |
| Realty Watcher | HUNTER | 30m | Sreality HTTP | Email + mark_seen |
| Realty Multi-Source | HUNTER | 30m | Sreality + Bezrealitky | Notify + mark_seen |
| News RSS Digest | DIGEST | denne 8:00 | 2x RSS | Telegram (LLM shrne) |
| Rate Monitor | TRACKER | pondeli 9:00 | 6x HTTP | Notify zmena sazeb |
| Morning Briefing | DIGEST | denne 7:00 | RSS + HTTP + HTTP | Prehled dne |

---

# Testy

| Soubor | Pocet | Pokryva |
|--------|-------|---------|
| `workers-phase-b.test.js` | ~73 | B0/B4/B6/B8/B9 |
| `agent-runner.test.js` | ~20 | HUNTER, mark_seen |
| `agent-sources.test.js` | ~15 | HTTP, RSS zdroje |
| `agent-wizard.test.js` | ~20 | Agent builder |
| `rss-integration.test.js` | ~47 | RSS/Atom parser |
| `multi-source-integration.test.js` | ~14 | Deduplikace, health |
| `notifications.test.js` | ~67 | Kanaly, routing, policy |
| `push-channel.test.js` | ~31 | ntfy.sh |
| `trust-feedback.test.js` | ~34 | Auto-degrade/mute |
| **Celkem** | **~321** | |

---

## Soubory

### Agents

| Soubor | Radku | Ucel |
|--------|-------|------|
| `src/agents/runner.js` | 1339 | Exekucni engine |
| `src/agents/scheduler.js` | 282 | Planovac |
| `src/agents/repository.js` | 662 | SQLite CRUD |
| `src/agents/conditions.js` | 551 | 7 typu podminek |
| `src/agents/triggers.js` | 172 | Hranova detekce |
| `src/agents/multi-source.js` | 376 | Deduplikace |
| `src/agents/schema.js` | 528 | Whitelist validace |
| `src/agents/api.js` | 857 | 28 REST endpointu |
| `src/agents/builder.js` | 255 | NL → definice |
| `src/agents/worker-configs.js` | 265 | Sablony |

### Notifications

| Soubor | Radku | Ucel |
|--------|-------|------|
| `src/notifications/pipeline.js` | 230 | Orchestrator |
| `src/notifications/service.js` | 144 | Router |
| `src/notifications/policy.js` | 302 | Policy engine |
| `src/notifications/digest.js` | 240 | Batching |
| `src/notifications/trust.js` | 551 | Trust feedback loop |
| `src/notifications/feedback.js` | 294 | Telegram keyboard |
| `src/notifications/channels/` | ~430 | Email, Telegram, ntfy.sh |

**Celkem agents src:** 9478 radku | **Celkem notifications src:** 2956 radku

---

*Puvodni dokument: "EXPERTS, SPECIALISTS & WORKERS.md" (Subsystem 4, 5, 6)*
*Viz take: [EXPERTS.md](EXPERTS.md) (Expert Layer) | [SPECIALISTS.md](SPECIALISTS.md) (Accountant)*
