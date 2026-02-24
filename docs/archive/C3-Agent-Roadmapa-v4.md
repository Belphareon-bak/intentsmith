# C3-Agent — Aktualizovaná Roadmapa v4

## Od aktuálního stavu k tvé vizi

**Datum:** 2026-02-12
**Verze kódu:** v62 (po Phase C lifecycle engine + Phase A audit + Q fix + modularizace B/C/D + C1/C4/D-int5)
**Testy:** 1700+ ověřených (1193 non-DB + 512 lifecycle = 1705 posledních regresí)
**Nové:** BE Code Review — 166 souborů, 66 375 řádků, 3 CRITICAL + 6 WARNING

---

## Tvá vize — 4+2 pilíře

### Pilíř 1: CHAT — náhrada ChatGPT
Kvalitní konverzační AI s generováním dokumentů a expertní specializací.

### Pilíř 2: PROJEKTY — stavění věcí
Lifecycle engine: SPEC→PLANNING→BUILD→REVIEW→CHANGE→COMPLETED.

### Pilíř 3: WORKERI — autonomní hlídací psi
24/7 monitoring s notifikacemi (email, Telegram, push).

### Pilíř 4: SPECIALISTÉ — komplexní on-demand agenti
Účetní, správce domácnosti, AI researcher. Tools + rutiny + paměť.

### Pilíř 5: IDE — vlastní vývojové prostředí
Eclipse Theia s custom panely.

### Pilíř 6: PRODUKT — balíčkování a ochrana
Installer, licence, auto-update, setup wizard.

---

## Kde je každý pilíř dnes (v62)

### Pilíř 1: CHAT — 95% ✅ (beze změny)
**Status: PHASE A = DONE.** Zbývá A7 kvalitativní ověření expert promptů.

### Pilíř 2: PROJEKTY — 95% ✅ (beze změny)
**Status: PHASE C = téměř DONE.** Zbývá C3 reálný LLM test.

### Pilíř 3: WORKERI — 80% ✅
B0+B4+B5+B6 done. Zbývá B8 reální workeři + B9 wizard.

### Pilíř 4: SPECIALISTÉ — 30%
Expert layer + accountant pilot. Chybí Specialist Runtime + knowledge base.

### Pilíř 5: IDE — 0% runtime, 50% příprava
WS bridge ready, Theia plány hotové, runtime neexistuje.

### Pilíř 6: PRODUKT — 5%
Shell sandbox + secrets auth. Chybí installer, licence, auto-update.

---

## 🔴 NOVÁ FÁZE: H — HARDENING (code review nálezy)

**Proč:** BE code review odhalil 3 kritické a 6 středně závažné problémy.
Žádný z nich neblokuje vývoj, ale všechny musí být opraveny před jakýmkoli
remote přístupem nebo nasazením mimo localhost.

**Effort:** 2–3 dny (lze integrovat do existujícího sprintu)
**Priorita:** PŘED Fází F (balíčkování) — nemá smysl balit nezabezpečenou app.

### H1. Error message sanitization 🔴 CRITICAL
**Problém:** `err.message` se leakuje přímo do HTTP responses (40+ míst v server.js).
Interní chybové zprávy (DB cesty, stack traces, systémové info) jsou viditelné klientovi.

**Řešení:**
```
1. Přidat error sanitization helper:
   function safeError(err) {
     const id = `E-${Date.now().toString(36)}`;
     logger.error('Server', `[${id}] ${err.message}`, { stack: err.stack });
     return { error: 'Internal server error', errorId: id };
   }
2. Nahradit všech 40+ `sendJSON(res, 500, { error: err.message })` → `sendJSON(res, 500, safeError(err))`
3. V development mode (C3_LOG_LEVEL=debug) volitelně vracet detaily
```
**Effort:** 0.5 dne
**Soubory:** server.js

### H2. Security headers 🔴 CRITICAL
**Problém:** Žádné CSP, X-Frame-Options, X-Content-Type-Options.
HTML stránky (/architect, /agents, /chat-ui) zranitelné vůči XSS/clickjacking.

**Řešení:**
```
1. Přidat security headers middleware do HTTP server handleru:
   const securityHeaders = {
     'X-Content-Type-Options': 'nosniff',
     'X-Frame-Options': 'SAMEORIGIN',
     'X-XSS-Protection': '1; mode=block',
     'Referrer-Policy': 'strict-origin-when-cross-origin',
     'Content-Security-Policy': "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'",
   };
2. Aplikovat na všechny responses (JSON i HTML)
3. CSP upravit podle potřeb UI (cdnjs, fonts, apod.)
```
**Effort:** 0.5 dne
**Soubory:** server.js (HTTP handler + sendJSON/sendHTML/sendStaticFile)

### H3. Architect session memory leak 🔴 CRITICAL
**Problém:** `global.architectSessions` roste bez limitu. Každý `/architect/init` call přidá orchestrator do paměti a nikdy se nemaže.

**Řešení:**
```
1. Nahradit global objekt LRU cache s TTL:
   - Max 20 sessions
   - TTL 4 hodiny (nebo configurable)
   - Při eviction: graceful cleanup orchestratoru
2. Alternativa: jednoduchý Map + setInterval cleanup (každých 30 min smazat > 4h staré)
```
**Effort:** 0.5 dne
**Soubory:** server.js (architect routes)

### H4. parseBody() silent JSON failure 🟡 WARNING
**Problém:** Když JSON parse selže, vrátí se `{ raw: body }` místo 400 erroru.
Downstream handlery pak spadnou na neočekávaném `body.raw`.

**Řešení:**
```
V parseBody():
  catch {
    reject(new Error('Invalid JSON in request body'));
  }
V HTTP handler: odchytit a vrátit 400.
```
**Effort:** 0.25 dne
**Soubory:** server.js (parseBody)

### H5. Path traversal guard v sendStaticFile() 🟡 WARNING
**Problém:** Funkce přijímá filepath bez containment check. Aktuálně volaná
s hardcoded stringy (ne user inputem), ale budoucí změna by mohla otevřít path traversal.

**Řešení:**
```
const resolved = path.resolve(baseDir, filepath);
if (!resolved.startsWith(path.resolve(baseDir))) {
  throw new Error('Path traversal detected');
}
```
**Effort:** 0.25 dne
**Soubory:** server.js (sendStaticFile)

### H6. Duplicitní Memory API — konsolidace 🟡 WARNING
**Problém:** DVĚ Memory API existují paralelně:
- `GET/POST/DELETE /memory` → `global_memory` tabulka (key-value, structured)
- `GET/POST /api/memory` → `user_memory` tabulka (raw JSON blob, id=1)

`POST /api/memory` přijímá jakýkoli JSON bez validace a zapisuje celý body.

**Řešení:**
```
1. Rozhodnout: /api/memory (JSON blob pro UI sidebar) je primární user-facing API
2. /memory (global_memory) přejmenovat na /api/global-memory nebo deprecovat
3. Přidat JSON schema validaci na /api/memory (max velikost, povinné pole)
```
**Effort:** 0.5 dne
**Soubory:** server.js, případně chat UI

### H7. parseInt validace v route parametrech 🟡 WARNING
**Problém:** `parseInt(params.id)` vrací NaN bez kontroly na 10+ místech.

**Řešení:**
```
function safeParseInt(val, name = 'id') {
  const n = parseInt(val);
  if (isNaN(n)) throw new AppError(`Invalid ${name}: ${val}`, ErrorCode.VALIDATION);
  return n;
}
```
**Effort:** 0.25 dne
**Soubory:** server.js

### H8. Smazat integration-patches.js 🟡 WARNING
**Problém:** Orphaned soubor (240 řádků) s broken importem `./progress-tracker.js`.
Patchovací template stringy — nikde se neimportuje, nikdo ho nepoužívá.

**Řešení:** `rm src/integration-patches.js`
**Effort:** 5 minut
**Soubory:** integration-patches.js

### H9. server.js — velikost 🟡 INFO
**Problém:** 2665 řádků. Většina jsou route definice, ale soubor roste.
Přes 50 route handlerů v jednom objektu.

**Řešení (budoucí):**
```
Rozdělit routes do souborů:
  src/routes/chat.js       — /chat, /api/chat/*, /chat-ui
  src/routes/planner.js    — /planner/*
  src/routes/lifecycle.js  — /api/lifecycle/*
  src/routes/architect.js  — /architect/*
  src/routes/agents.js     — /api/agents/*, /agents
  src/routes/memory.js     — /memory, /api/memory
  src/routes/projects.js   — /api/projects/*
server.js zůstane jen: init + wiring + createServer + graceful shutdown
```
**Effort:** 1 den (neurgentní, kvalitativní zlepšení)
**Soubory:** nové src/routes/*.js + server.js refactor

---

## Aktualizovaný timeline

```
Fáze Q: QUALITY    ██████████████████████████████████████████  100% → DONE
Fáze A: CHAT       ██████████████████████████████████████████  95% → DONE
Fáze C: PROJEKTY   ████████████████████████████████████████░░  95% → téměř DONE
Fáze D-int: ÚČETNÍ ██████████████████████████████████████████  100% → DONE
Fáze B: WORKERI    ████████████████████████████░░░░░░░░░░░░░░  80% (B0-B6 done)
Fáze H: HARDENING  ░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░  0% → NEW
Fáze D: SPECIALISTÉ████████████░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░  30%
Fáze E: IDE        ████████████████████░░░░░░░░░░░░░░░░░░░░░░  50% (kód ready)
Fáze F: BALÍČKOVÁNÍ██░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░  5%
```

---

## Doporučené pořadí práce

### Sprint 1 — Hardening + Worker dokončení (~1 týden)

**Den 1–2: Phase H — Critical fixes**
```
✅→ H1. Error message sanitization (0.5d)
✅→ H2. Security headers (0.5d)
✅→ H3. Architect session cleanup (0.5d)
✅→ H8. Smazat integration-patches.js (5 min)
```

**Den 3: Phase H — Warnings**
```
✅→ H4. parseBody() JSON error handling (0.25d)
✅→ H5. Path traversal guard (0.25d)
✅→ H7. safeParseInt helper (0.25d)
✅→ H6. Memory API konsolidace (0.5d)
```

**Den 4–5: Phase B — Worker reálný provoz**
```
❌→ B8. Worker: počasí → Telegram/push (1d)
❌→ B8. Worker: zprávy RSS → digest email (1d)
```

### Sprint 2 — Workers + quality (~1 týden)

```
❌→ B8. Worker: reality/jobs → notifikace (1d)
❌→ B9. Agent builder wizard (3d)
❌→ C3. Reálný LLM test lifecycle (průběžně, 1d focused)
```

### Sprint 3+ — Specialists, IDE, Packaging (dle roadmap v3)

Beze změny:
- Fáze D: SPECIALISTÉ (6–8 týdnů)
- Fáze E: IDE — Theia runtime (8 sprintů, ~2 měsíce)
- Fáze F: BALÍČKOVÁNÍ (2–3 týdny) — ALE závisí na H1-H3 hotových

---

## Kompletní task list (zbývající úkoly)

| # | Fáze | Úkol | Effort | Priorita | Status |
|---|------|------|--------|----------|--------|
| 1 | **H** | **H1. Error message sanitization** | 0.5d | 🔴 P0 | ❌ |
| 2 | **H** | **H2. Security headers (CSP, X-Frame)** | 0.5d | 🔴 P0 | ❌ |
| 3 | **H** | **H3. Architect session memory leak** | 0.5d | 🔴 P0 | ❌ |
| 4 | **H** | **H8. Smazat integration-patches.js** | 5min | 🟡 P1 | ❌ |
| 5 | **H** | H4. parseBody JSON error handling | 0.25d | 🟡 P1 | ❌ |
| 6 | **H** | H5. Path traversal guard | 0.25d | 🟡 P1 | ❌ |
| 7 | **H** | H7. safeParseInt helper | 0.25d | 🟡 P1 | ❌ |
| 8 | **H** | H6. Memory API konsolidace | 0.5d | 🟡 P1 | ❌ |
| 9 | **H** | H9. server.js route split | 1d | ⚪ P2 | ❌ |
| 10 | C | C3. Reálný LLM test lifecycle | průběžně | 🟡 P1 | ❌ |
| 11 | B | B8. Worker: počasí → push/Telegram | 1d | 🟡 P1 | ❌ |
| 12 | B | B8. Worker: zprávy RSS → digest | 1d | 🟡 P1 | ❌ |
| 13 | B | B8. Worker: reality/jobs → email | 1d | 🟡 P1 | ❌ |
| 14 | B | B9. Agent builder wizard | 3d | 🟡 P1 | ❌ |
| 15 | E | Sprint 0–7 Theia runtime | ~2 měs. | ⚪ P2 | ❌ |
| 16 | D | D1–D9 Specialist platform | ~8 týd. | ⚪ P2 | ❌ |
| 17 | F | F1–F6 Balíčkování | ~3 týd. | ⚪ P2 | ❌ |

---

## Co Code Review potvrdil jako OK

| Oblast | Nález |
|--------|-------|
| **Runtime imports** | 0 broken z 166 souborů ✅ |
| **Circular dependencies** | 0 ✅ |
| **SQL injection** | 0 rizik — prepared statements všude ✅ |
| **DB schema** | 20+ tabulek, proper FK, CASCADE, CHECK, WAL ✅ |
| **LLM Gateway** | Auth tokens, audit, rate limiting, retry — production-grade ✅ |
| **Architecture rules** | server.js = transport only — dodržováno ✅ |
| **Feature flags** | B/C/D moduly odpojitelné, graceful degradation ✅ |
| **Graceful shutdown** | SIGINT/SIGTERM + DB close + session cleanup ✅ |
| **Input sanitization** | Body limit 1MB, search query sanitization, rate limiting ✅ |
| **Export patterns** | Konzistentní ESM (named + default exports) ✅ |

---

## Code review gaps nalezené mimo existující roadmapu

Toto jsou věci, které nebyly v žádné fázi roadmapy, ale code review je identifikoval:

### 1. Chybí request validation middleware
Roadmapa neřeší validaci request bodies. Aktuálně každý endpoint si validuje sám
(nekonzistentně — někde chybí). Centralizovaný validator by snížil duplicitu.

### 2. Chybí structured error responses
Chybová odpověď je vždy `{ error: string }`. Pro frontend by bylo lepší:
```json
{ "error": { "code": "VALIDATION_ERROR", "message": "...", "field": "name" } }
```
Existující `ErrorCode` enum v error-handler.js se nepoužívá v HTTP responses.

### 3. Chybí API versioning
Aktuálně mix `/memory`, `/api/memory`, `/projects`, `/api/projects`.
Pro stabilitu by pomohlo `/api/v1/*` prefix.

### 4. Chybí health check endpoint s DB probe
`GET /` vrací statický JSON. Pro monitoring by měl probeovat DB:
```json
{ "status": "ok", "db": "ok", "ollama": "ok|unreachable", "uptime": 12345 }
```

### 5. Templates v domains/recipes obsahují hardcoded credentials
`postgres://app:secret@db:5432/appdb`, `POSTGRES_PASSWORD: secret`,
`GF_SECURITY_ADMIN_PASSWORD: admin` — jsou to generátorové šablony,
ale produkční šablony by měly generovat random hesla nebo placeholder.

---

## Celkový progres

**Hotovo:** ~82% celkové vize
**Nový úkol:** Phase H (Hardening) — 2-3 dny práce, musí být před Phase F

```
Celkem zbývajících úkolů:  17
  🔴 Critical (H1-H3):     3  (~1.5 dne)
  🟡 Important (H4-H8,B,C): 9  (~8 dní)
  ⚪ Future (D,E,F,H9):     5  (~3.5 měsíce)
```

---

*Tento dokument nahrazuje C3-Agent-Roadmapa-v3.md (v3.5, 2026-02-12).
Nové v v4: Fáze H (Hardening) — 9 úkolů z BE code review (3 CRITICAL, 6 WARNING).
Code review potvrdil 0 broken imports, 0 circular deps, 0 SQL injection.
Doporučené pořadí: H (critical) → B8/B9 → C3 → D → E → F.*
