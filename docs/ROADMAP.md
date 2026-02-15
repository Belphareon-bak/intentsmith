# C3-Agent — Roadmapa v7

## Od aktuálního stavu k vizi

**Datum:** 2026-02-15
**Verze kódu:** v65.5 (Agent Builder Wizard, project context, conversation restore, lifecycle hardening)
**Testy:** ~1300 verified
**IDE:** C3 Studio (Theia 1.65.2), Sprint 1-7 done + agent wizard + project context (~80%)

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
Eclipse Theia s custom panely (chat, center views, detail panel, expertise wizard, agent builder).

### Pilíř 6: PRODUKT — balíčkování a ochrana
Installer, licence, auto-update, setup wizard.

---

## Kde je každý pilíř dnes (v65.5)

### Pilíř 1: CHAT — 98% ✅
**Status: PHASE A = DONE + CRE Gatekeeper (v64.0) + Project Context (v65.4).**
- CRE single-authority enforcement — `overrideDecision()` + `logIntercept()`
- 35 bypass pointů opraveno (conversation.js, clarification.js, followup.js)
- `cre_override_log` tabulka s audit trail
- v65.4: Project context injection — CRE hint `[[PROJECT_CONTEXT:...]]`, sanitized system prompt, `buildProjectContext()`
- Zbývá: A7 kvalitativní ověření expert promptů

### Pilíř 2: PROJEKTY — 98% ✅ (upgrade z 95%)
**Status: PHASE C = téměř DONE.**
- v65.2: BUILD hardening — real test exec, checkpoint FAIL default, pre-execution scope validation, hard milestone size limits
- v65.3: Conversation restore on project open — lifecycle bind, stale guard, scroll
- v65.4: Project context sync IDE→BE→LLM (`projectId` through full pipeline)
- Zbývá: C3 reálný LLM test (průběžně)

### Pilíř 3: WORKERI — 85% ✅ (upgrade z 80%)
B0+B4+B5+B6+B9 done. Zbývá B8 reální workeři (3 template agenty).
- v65.5: **Agent Builder Wizard** — FE wizard (simple 3-step + advanced 5-section), BE schema endpoint, `normalizeAgentDefinition()`, auto dry-run, 409 ID collision handling

### Pilíř 4: SPECIALISTÉ — 40% ✅
Expert layer (15 experts) + accountant pilot + 5D capability system + merge engine v2 + expertise wizard UI.
Chybí: Specialist Runtime + knowledge base + interaktivní scénáře.

### Pilíř 5: IDE — 80% ✅ (upgrade z 75%)
Theia 1.65.2 runtime, chat panel, center views (expert grid + wizard + agent builder), detail panel s capability bars, WS bridge.
- v65.3: Project opener s conversation restore + lifecycle bind
- v65.4: Project context pipeline (IDE→WS→BE→CRE→LLM)
- v65.5: Agent Builder Wizard UI (centerAgentWizard, simple + advanced mode)
- Sprint 1-7 done (~215 testů)

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
| v65.2 | **Lifecycle BUILD hardening** — real test exec, FAIL default, hard size limits |
| v65.3 | **Project conversation restore** — lifecycle bind, stale guard |
| v65.4 | **Project context injection** — CRE hint, sanitized prompt, IDE→LLM pipeline |
| v65.4 | **Instalační příručka** — INSTALL.md (BE + IDE + Docker) |
| v65.5 | **Agent Builder Wizard (B9)** — FE wizard UI + BE schema endpoint + normalizeAgentDefinition |

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
Fáze A: CHAT       ████████████████████████████████████████░░  98% → DONE (v65.4 project context)
Fáze C: PROJEKTY   ████████████████████████████████████████░░  98% → DONE (v65.3 restore, v65.2 hardening)
Fáze D-int: ÚČETNÍ ██████████████████████████████████████████  100% → DONE
Fáze B: WORKERI    ██████████████████████████████████░░░░░░░░  85% (B0-B6+B9 done)
Fáze H: HARDENING  ██████████████████████████████████████████  100% (9/9 DONE)
Fáze D: SPECIALISTÉ████████████████░░░░░░░░░░░░░░░░░░░░░░░░░░  40% (expert+merge+wizard)
Fáze E: IDE        ████████████████████████████████░░░░░░░░░░  80% (Sprint 1-7 + agent wizard)
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

### Sprint 2 — Workers + wizard (~1 týden)

```
❌→ B8. Worker: reality/jobs → notifikace (1d)
✅→ B9. Agent builder wizard — DONE (v65.5)
❌→ C3. Reálný LLM test lifecycle (průběžně, 1d focused)
```

### Sprint 3+ — Specialists, IDE, Packaging

- Fáze D: SPECIALISTÉ — Specialist Runtime, knowledge base (~6 týdnů)
- Fáze E: IDE — zbývající IDE sprinty (~3-4 sprinty)
- Fáze F: BALÍČKOVÁNÍ (2–3 týdny) — H1-H3 jsou hotové, nic neblokuje

---

## Kompletní task list (zbývající úkoly)

| # | Fáze | Úkol | Effort | Priorita | Status |
|---|------|------|--------|----------|--------|
| 1 | H | H1–H9 Hardening (9 úkolů) | — | — | ✅ DONE |
| 2 | C | C3. Reálný LLM test lifecycle | průběžně | 🟡 P1 | ❌ |
| 3 | B | B8. Worker: počasí → push/Telegram | 1d | 🟡 P1 | ❌ |
| 4 | B | B8. Worker: zprávy RSS → digest | 1d | 🟡 P1 | ❌ |
| 5 | B | B8. Worker: reality/jobs → email | 1d | 🟡 P1 | ❌ |
| 6 | B | B9. Agent builder wizard | 3d | 🟡 P1 | ✅ v65.5 |
| 7 | E | IDE: zbývající sprinty | ~1 měs. | ⚪ P2 | ❌ |
| 8 | D | D1–D9 Specialist platform | ~6 týd. | ⚪ P2 | ❌ |
| 9 | F | F1–F6 Balíčkování | ~3 týd. | ⚪ P2 | ❌ |

---

## Celkový progres

**Hotovo:** ~92% celkové vize (upgrade z 91%)
**Nové od v6:** v65.5 Agent Builder Wizard (B9), v65.4 project context injection, v65.3 conversation restore, INSTALL.md

```
Celkem zbývajících úkolů:  7
  🔴 Critical:              0  (všechny H1-H3 hotové!)
  🟡 Important (B,C):       4  (~4 dny)
  ⚪ Future (D,E,F):         3  (~2.5 měsíce)
```

---

*Tento dokument nahrazuje Roadmapa v6 (v65.4).
Nové ve v7: v65.5 Agent Builder Wizard (B9) — FE wizard (simple 3-step + advanced 5-section), BE `GET /api/agents/schema` s presety, `normalizeAgentDefinition()`, auto dry-run, ID collision handling.
v65.4 project context injection, v65.3 conversation restore, v65.2 lifecycle hardening,
INSTALL.md. Aktualizovaný progres (Chat 98%, Projekty 98%, Workeri 85%, IDE 80%, celkem 92%).*
