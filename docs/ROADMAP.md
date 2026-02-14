# C3-Agent — Roadmapa v5

## Od aktuálního stavu k vizi

**Datum:** 2026-02-14
**Verze kódu:** v64.0 (CRE Gatekeeper, schema migrations, 5D capability system, merge engine v2, expertise wizard)
**Testy:** ~1160 verified
**IDE:** C3 Studio (Theia 1.65.2), Sprint 1-7 done (~70%)

---

## Vize — 4+2 pilíře

### Pilíř 1: CHAT — náhrada ChatGPT
Kvalitní konverzační AI s generováním dokumentů a expertní specializací.

### Pilíř 2: PROJEKTY — stavění věcí
Lifecycle engine: SPEC→PLANNING→BUILD→REVIEW→CHANGE→COMPLETED.

### Pilíř 3: WORKERI — autonomní hlídací psi
24/7 monitoring s notifikacemi (email, Telegram, push).

### Pilíř 4: SPECIALISTÉ — komplexní on-demand agenti
Účetní, správce domácnosti, AI researcher. Tools + rutiny + paměť.

### Pilíř 5: IDE — vlastní vývojové prostředí
Eclipse Theia s custom panely (chat, center views, detail panel, expertise wizard).

### Pilíř 6: PRODUKT — balíčkování a ochrana
Installer, licence, auto-update, setup wizard.

---

## Kde je každý pilíř dnes (v64.0)

### Pilíř 1: CHAT — 97% ✅
**Status: PHASE A = DONE + CRE Gatekeeper (v64.0).**
- CRE single-authority enforcement — `overrideDecision()` + `logIntercept()`
- 35 bypass pointů opraveno (conversation.js, clarification.js, followup.js)
- `cre_override_log` tabulka s audit trail
- Zbývá: A7 kvalitativní ověření expert promptů

### Pilíř 2: PROJEKTY — 95% ✅ (beze změny)
**Status: PHASE C = téměř DONE.** Zbývá C3 reálný LLM test.

### Pilíř 3: WORKERI — 80% ✅
B0+B4+B5+B6 done. Zbývá B8 reální workeři + B9 wizard.

### Pilíř 4: SPECIALISTÉ — 40% ✅ (upgrade z 30%)
Expert layer (15 experts) + accountant pilot + 5D capability system + merge engine v2 + expertise wizard UI.
Chybí: Specialist Runtime + knowledge base + interaktivní scénáře.

### Pilíř 5: IDE — 70% ✅ (upgrade z 50%)
Theia 1.65.2 runtime, chat panel, center views (expert grid + wizard), detail panel s capability bars, WS bridge. Sprint 1-7 done (~215 testů).

### Pilíř 6: PRODUKT — 5%
Shell sandbox + secrets auth. Chybí installer, licence, auto-update.

---

## Co přibylo od v4 roadmapy

| Verze | Změna |
|-------|-------|
| v63.0 | Merge Engine v2 — multi-expertise composition (max 3) |
| v63.0 | 5D Capability System — per-expert vektory, kompatibilita |
| v63.0 | conversation_expertises tabulka (N:M, max 3) |
| v63.1 | Capability modifiers — runtime vliv 5D vektoru |
| v63.1 | Expertise Wizard UI — IDE formulář pro tvorbu expertiz |
| v63.3 | ExecutionTrace — UUID per turn, LLM log, prompt hash |
| v63.3 | Expert Sandbox — offline simulace |
| v64.0 | **CRE Gatekeeper** — single-authority enforcement |
| v64.0 | Schema migrations (5 souborů, timestamp-based) |
| v64.0 | cre_override_log tabulka |

---

## FÁZE H — HARDENING (code review nálezy)

**Status:** 9/9 DONE. Všechny CRITICAL opraveny.

| # | Úkol | Effort | Priorita | Status |
|---|------|--------|----------|--------|
| H1 | Error message sanitization (`safeError()`) | 0.5d | 🔴 P0 | ✅ |
| H2 | Security headers (CSP, X-Frame, X-XSS) | 0.5d | 🔴 P0 | ✅ |
| H3 | Architect session TTL + LRU (max 20, 4h, 30min cleanup) | 0.5d | 🔴 P0 | ✅ |
| H4 | parseBody JSON error handling (reject, ne raw) | 0.25d | 🟡 P1 | ✅ |
| H5 | Path traversal guard v sendStaticFile() | 0.25d | 🟡 P1 | ✅ |
| H6 | Memory API konsolidace | 0.5d | 🟡 P1 | ✅ `/memory` odstraněn, `/api/global-memory` canonical |
| H7 | safeParseInt helper (12+ usage sites) | 0.25d | 🟡 P1 | ✅ |
| H8 | Smazat integration-patches.js | 5min | 🟡 P1 | ✅ |
| H9 | server.js route split | 1d | ⚪ P2 | ✅ 7 route modulů v src/routes/, server.js 854 řádků |

---

## Aktualizovaný timeline

```
Fáze Q: QUALITY    ██████████████████████████████████████████  100% → DONE
Fáze A: CHAT       ████████████████████████████████████████░░  97% → DONE (v64.0 Gatekeeper)
Fáze C: PROJEKTY   ████████████████████████████████████████░░  95% → téměř DONE
Fáze D-int: ÚČETNÍ ██████████████████████████████████████████  100% → DONE
Fáze B: WORKERI    ████████████████████████████░░░░░░░░░░░░░░  80% (B0-B6 done)
Fáze H: HARDENING  ██████████████████████████████████████████  100% (9/9 DONE)
Fáze D: SPECIALISTÉ████████████████░░░░░░░░░░░░░░░░░░░░░░░░░░  40% (expert+merge+wizard)
Fáze E: IDE        ████████████████████████████░░░░░░░░░░░░░░  70% (Sprint 1-7 done)
Fáze F: BALÍČKOVÁNÍ██░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░  5%
```

---

## Doporučené pořadí práce

### Sprint 1 — Workers (~1 týden)

Phase H je KOMPLETNÍ (9/9). Focus se přesouvá na workery.

```
✅→ H6. Memory API — DONE (/memory odstraněn)
✅→ H9. server.js route split — DONE (3325→854 řádků, 7 modulů)
❌→ B8. Worker: počasí → Telegram/push (1d)
❌→ B8. Worker: zprávy RSS → digest email (1d)
```

### Sprint 2 — Workers + quality (~1 týden)

```
❌→ B8. Worker: reality/jobs → notifikace (1d)
❌→ B9. Agent builder wizard (3d)
❌→ C3. Reálný LLM test lifecycle (průběžně, 1d focused)
```

### Sprint 3+ — Specialists, IDE, Packaging

- Fáze D: SPECIALISTÉ — Specialist Runtime, knowledge base (~6 týdnů)
- Fáze E: IDE — zbývající IDE sprinty (~3-4 sprinty)
- Fáze F: BALÍČKOVÁNÍ (2–3 týdny) — H1-H3 jsou hotové, nic neblokuje
- ~~H9: server.js route split~~ — DONE

---

## Kompletní task list (zbývající úkoly)

| # | Fáze | Úkol | Effort | Priorita | Status |
|---|------|------|--------|----------|--------|
| 1 | H | H1. Error message sanitization | 0.5d | 🔴 P0 | ✅ |
| 2 | H | H2. Security headers (CSP, X-Frame) | 0.5d | 🔴 P0 | ✅ |
| 3 | H | H3. Architect session memory leak | 0.5d | 🔴 P0 | ✅ |
| 4 | H | H4. parseBody JSON error handling | 0.25d | 🟡 P1 | ✅ |
| 5 | H | H5. Path traversal guard | 0.25d | 🟡 P1 | ✅ |
| 6 | H | H6. Memory API konsolidace | 0.5d | 🟡 P1 | ✅ |
| 7 | H | H7. safeParseInt helper | 0.25d | 🟡 P1 | ✅ |
| 8 | H | H8. Smazat integration-patches.js | 5min | 🟡 P1 | ✅ |
| 9 | H | H9. server.js route split | 1d | ⚪ P2 | ✅ |
| 10 | C | C3. Reálný LLM test lifecycle | průběžně | 🟡 P1 | ❌ |
| 11 | B | B8. Worker: počasí → push/Telegram | 1d | 🟡 P1 | ❌ |
| 12 | B | B8. Worker: zprávy RSS → digest | 1d | 🟡 P1 | ❌ |
| 13 | B | B8. Worker: reality/jobs → email | 1d | 🟡 P1 | ❌ |
| 14 | B | B9. Agent builder wizard | 3d | 🟡 P1 | ❌ |
| 15 | E | IDE: zbývající sprinty | ~1 měs. | ⚪ P2 | ❌ |
| 16 | D | D1–D9 Specialist platform | ~6 týd. | ⚪ P2 | ❌ |
| 17 | F | F1–F6 Balíčkování | ~3 týd. | ⚪ P2 | ❌ |

---

## Celkový progres

**Hotovo:** ~90% celkové vize (upgrade z 88%)
**Nové:** Phase H KOMPLETNÍ (9/9), H6 Memory API konsolidace, H9 server.js route split (3325→854 řádků)

```
Celkem zbývajících úkolů:  8
  🔴 Critical:              0  (všechny H1-H3 hotové!)
  🟡 Important (B,C):       5  (~7 dní)
  ⚪ Future (D,E,F):         3  (~2.5 měsíce)
```

---

*Tento dokument nahrazuje C3-Agent-Roadmapa-v4.md (v4, 2026-02-12).
Nové ve v5.1: Phase H KOMPLETNÍ (9/9 — H6 Memory API, H9 route split),
CRE Gatekeeper (v64.0), Phase H téměř hotová (7/9 verified),
aktualizovaný progres pilířů (Chat 97%, Specialisté 40%, IDE 70%),
schema migrations, 5D capability system, merge engine v2, expertise wizard.*
