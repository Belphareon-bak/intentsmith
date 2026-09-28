# Memory System

> **v86** (M1 + M2 + M3) | 7 modules | ~2,100 lines

## Architecture

Three-tier memory system with learning and persistence:

```
Session (fast, in-memory, TTL)     ← policy.js
    ↕
Long-Term Memory (persistent, decay)  ← long-term.js
    ↕
Project Memory (scoped, SQLite)    ← memory-bank.js

Cross-cutting:
  preferences.js   — preference learning from feedback
  feedback-detector.js — detect implicit/explicit user signals
  injection-ranker.js  — rank LTM entries for context injection
  pattern-tracker.js   — cross-conversation pattern learning
```

## Modules

### long-term.js (504 lines)

Per-user fact store with confidence decay. Semantic memory (stable facts), NOT conversation history.

**Confidence decay:** `effective = base * e^(-0.01 * ageDays)` — half-life ~69 days

**Singleton:** `longTermMemory`

| Method | Signature | Description |
|--------|-----------|-------------|
| `init()` | `()` | Creates SQLite table if db present |
| `write()` | `({kind, key, value, confidence?, source?, ttl?})` | Store fact |
| `read()` | `({kind, key, minConfidence?})` | Read single fact |
| `queryByKind()` | `(kind, {minConfidence?})` | Query all facts of a kind |
| `reinforce()` | `(kind, key)` | Boost confidence +0.05 (cap 0.95), increment access_count |
| `forget()` | `({kind, key, reason?})` | Delete fact |
| `updateConfidence()` | `(kind, key, newConfidence)` | Manual confidence update |
| `getStats()` | `()` | `{entries, byKind, bySource, avgConfidence}` |

**Enums:**

```javascript
MemoryKind:   PREFERENCE | PROJECT | STYLE | CORRECTION | PATTERN | AGENT_INTERNAL
MemorySource: EXPLICIT | INFERRED | CORRECTED | SYSTEM
```

**Database:** `memory` table — `(user_id, kind, key, value, confidence, source, created_at, last_used, ttl)`

### preferences.js (714 lines)

Multi-axis preference storage with feedback learning.

**Singletons:** `preferenceEngine` (PreferenceEngine)

| Axis | Values | Default |
|------|--------|---------|
| `verbosity` | MINIMAL / NORMAL / DETAILED | NORMAL |
| `riskTolerance` | LOW / MEDIUM / HIGH | MEDIUM |
| `technicalDepth` | BASIC / ADVANCED | ADVANCED |
| `language` | string | 'cs' |
| `structure` | BULLETS / PARAGRAPHS / MIXED | MIXED |
| `followUpStyle` | CONCISE / COMPREHENSIVE / ADAPTIVE | ADAPTIVE |

**Key methods:**

| Method | Description |
|--------|-------------|
| `loadFromMemory(ltm)` | Load persisted prefs from LTM on startup |
| `apply(decision, context?)` | Modify decision with preference hints |
| `getPreferencesForSynthesis(intent)` | Get output style for LLM synthesis |
| `recordPositiveFeedback(context)` | Positive signal → adjust axis |
| `recordNegativeFeedback(context)` | Negative signal → adjust axis |

**Learning rule:** Needs 3+ consistent signals on same axis before applying adjustment.

### injection-ranker.js (140 lines)

Score LTM entries for context injection into synthesis prompts. Pure function, no side effects.

```javascript
rankForContext(entries, input, intent)
→ Array<{...entry, score, relevance}> sorted by score desc
```

**Scoring:**
```
score = effectiveConfidence × relevance
relevance = (keywordOverlap × 0.4) + (intentAffinity × 0.45) + (recencyBonus × 0.15)
```

**Intent-kind affinity matrix:**

| Intent | Best match kinds |
|--------|-----------------|
| CODE | PROJECT=0.9, CORRECTION=0.9, PATTERN=0.7 |
| SEARCH | PROJECT=0.8, PATTERN=0.6 |
| CONVERSATIONAL | PREFERENCE=0.9, STYLE=0.9 |
| REPORT | PROJECT=0.9, STYLE=0.7 |

### feedback-detector.js (255 lines)

Detect implicit/explicit user feedback signals from conversation messages.

```javascript
detectFeedback(input, sessionState) → {type, confidence, signal, correctionData?}
classifyFeedback(feedbackType) → 'positive' | 'negative' | null
```

**6 signal types:**

| Signal | Example patterns |
|--------|-----------------|
| POSITIVE_EXPLICIT | "díky", "super", "thanks", 👍👏 |
| POSITIVE_IMPLICIT | New topic (similarity <30%) → accepted prev response |
| NEGATIVE_EXPLICIT | "špatně", "wrong", "oprav", 👎 |
| NEGATIVE_IMPLICIT | High topic similarity >60% without reformulation |
| CORRECTION | "ne, myslel jsem...", "actually I meant..." |
| NEUTRAL | No signal detected |

### pattern-tracker.js (246 lines)

Cross-conversation behavioral pattern learning via LTM.

**Singleton:** `patternTracker`

| Method | Description |
|--------|-------------|
| `wire(ltm)` | Enable persistence to LTM |
| `recordTurn(intent, input, {toolSuccess?, tool?})` | Record each turn |
| `getRelevantPatterns(intent, input)` | Query matching patterns |

**3 pattern types:**

| Type | Detection | Threshold |
|------|-----------|-----------|
| INTENT_SEQUENCE | `prev→current` pairs (e.g. SEARCH→CODE) | ≥3 occurrences |
| TOPIC_AFFINITY | Repeated topic tokens | reinforced on reuse |
| TOOL_SUCCESS | Which tools succeed for which topics | per tool+topic |

### memory-bank.js (195 lines)

Project-scoped persistent memory backed by `project_memory` SQLite table.

```javascript
getMemoryBank(db?) → MemoryBank  // lazy singleton
```

| Method | Signature | Description |
|--------|-----------|-------------|
| `set()` | `(projectId, key, value, category?)` | Store project fact |
| `get()` | `(projectId, key, defaultValue?)` | Read project fact |
| `delete()` | `(projectId, key)` | Remove fact |
| `list()` | `(projectId, category?)` | List facts |
| `buildContext()` | `(projectId, maxEntries?)` | Build prompt block for LLM |

**Categories:** DECISION | PREFERENCE | CONTEXT | PROGRESS | GENERAL

### policy.js (266 lines)

Session-scoped in-memory fact store with TTL and namespace support.

**Singleton:** `memory`

| Feature | Description |
|---------|-------------|
| Namespaces | `user.*`, `session.*`, `tool.*` |
| TTL | Auto-expiration on recall |
| LRU eviction | When maxEntries (500) exceeded |
| Tags | Arbitrary string tags for grouping |

## Integration Points

| Consumer | Module | Usage |
|----------|--------|-------|
| `server.js` | long-term.js | `longTermMemory.db = db.db; longTermMemory.init()` |
| `server.js` | pattern-tracker.js | `patternTracker.wire(longTermMemory)` |
| `ltm-context.js` | injection-ranker.js | `rankForContext()` for synthesis prompt |
| `pre-handler.js` | feedback-detector.js | Detect feedback before CRE |
| `pre-handler.js` | preferences.js | Record feedback to preference engine |
| `synthesis.js` | preferences.js | `getPreferencesForSynthesis()` for output style |
| `handlers/*.js` | pattern-tracker.js | `recordTurn()` after each decision |
| `context-budget.js` | long-term.js | LTM context in budgeted prompt |

## Database Tables

| Table | Backing | Scope |
|-------|---------|-------|
| `memory` | long-term.js | Per-user |
| `project_memory` | memory-bank.js | Per-project |

## Safety Invariants

1. LTM never influences CRE intent classification (read-only injection into synthesis)
2. Preference adjustment requires 3+ consistent signals (no single-event changes)
3. Memory writes are non-critical (try/catch, logged but won't crash handler)
4. TTL auto-expiration prevents stale data accumulation
5. Confidence decay ensures old facts fade naturally (~69 day half-life)
