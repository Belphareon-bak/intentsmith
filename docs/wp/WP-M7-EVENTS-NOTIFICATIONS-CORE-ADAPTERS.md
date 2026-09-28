# WP-M7-EVENTS-NOTIFICATIONS-CORE-ADAPTERS

**Typ:** zapisující M7 transport-free capability blok

**Vstupní revision:** `6688b8fd`

**Stav:** `IMPLEMENTATION_GREEN / FULL_OFFLINE_DATABASE_GATE_GREEN /
REVIEW_REQUIRED / NOT_ACTIVE / TRANSPORT_ABSENT`

## 1. Uživatelský výsledek

Remote Companion má skutečné core handlery pro bounded run events a in-app
notifications. `run-event.list` projektuje validované M1 `CoreEvent@1` bez
uložení payloadu. `notification.list/ack` projektuje přijatý M3 in-app zdroj a
ukládá pouze per-device potvrzení přečtení.

## 2. Autorita a data

- event source je skutečný M1 emitter; observer dostává událost až po
  `validateCoreEvent()` a run partition váže trusted subject;
- event payload se nepřenáší, retention je paměťově omezená a ztracené okno
  vrací `REMOTE_EVENT_WINDOW_GONE`;
- notification source je closure-brandovaný read-only port skutečné
  `AgentRepository`; legacy HTTP routes ani globální `read_at` nejsou
  konzumentem;
- title, priority, project a run target se autorizují dvakrát, body a volná
  `data` se nikdy neemitují;
- ACK nepřekročí `observedThroughSeq`, vyžaduje M7 operation intent a migrace
  107 drží append-only receipt partitionovaný device + subject.

## 3. Demonstrace

Focused event journey vede skutečný M1 session emitter do bounded read modelu,
prokazuje subject izolaci, long-poll wakeup, terminál a retention loss.
Notification journey vede skutečný M3 repository row přes redakci, autorizaci,
durable M7 journal, restart-safe replay a per-device read receipt. Composition
inzeruje capability jen při genuine kompletním portu; provider zůstává
`not_active`.

## 4. Stop condition

Blok nesmí připojit session autoritu k listeneru, otevřít síť, vytvořit pairing,
vydat produkční klíč, změnit mobilní wire kontrakt ani tvrdit device/release
evidence. O-01/O-02/O-04 a tento řez musí projít review před aktivací.

## 5. Ověření

```bash
node tests/m7-run-event-core-adapter.test.js
node tests/m7-notification-core-adapters.test.js
node tests/m7-core-composition.test.js
node tests/schema-migrations.test.js
node tests/m1-model-failover-schema.test.js
node tests/m6-runtime-evidence.test.js
node tests/m6-technical-evidence.test.js
node tests/module-boundary-ratchet.test.js
node tests/artifact-validation.test.js
node scripts/validate-test-registry.js --json
git diff --check
```

Souvislý profilový gate nad exact candidatem `277c7ee9` skončil
`337/337 PASS`, `verdict: PASS`, `exitCode: 0`. Dva předchozí kontrolní běhy
zůstávají evidované jako `329 PASS / 8 BLOCKED` a `335 PASS / 2 BLOCKED`;
neobsahují produktový FAIL a přesně ukazují chybějící host toolchain a PDF
runtime konfiguraci. Přesné identity a hashe jsou v
[`m7-events-notifications-core-adapters-20260830.md`](../execution/runs/m7/m7-events-notifications-core-adapters-20260830.md).
