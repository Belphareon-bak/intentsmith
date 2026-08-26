# WP-M5-REMOTE-PORT — in-process core adapter

**Typ:** M5 production hardening · **Stav:** `IMPLEMENTATION_GREEN / REVIEW_PENDING`

## Výsledek

`createM5RemoteCorePortAdapter()` implementuje zmražený M2 `RemoteCorePort` bez
síťové vrstvy. Descriptor zůstává byte-identický s M2; M5 verifikační manifest
má digest
`sha256:34f3c20c94e1c4316ad76e8c92c1ce8b7dab0868b7685c3d5a637a6f6aa98e52`.

Implementované capability:

| Capability | Operace | Request → result |
|---|---|---|
| `conversations@1` | `conversation.execute` | `ConversationCommand@1` → `ConversationResult@1` |
| `projects@1` | `project-context.query` | `ProjectContextQuery@1` → `ProjectContextSnapshot@1` |

Zbývajících pět katalogových capability vrací exact `unavailable`. Chybějící
handler, cizí port/capability verze, pozměněný manifest digest, unknown pole,
neplatný payload nebo nesedící request/conversation/turn/project identita
selže dřív, než je vrácen zdánlivý úspěch.

## Security boundary

Adaptér nemá `listen`, `connect`, `pair`, `fetch` ani approval metodu a jeho
statický import graph nevede do serveru, routes, DB, websocketu nebo síťových
Node modulů. `src/server.js` jej neinstancuje a legacy listener zůstává pod
samostatnou M2 loopback sentinelu. Invocation context dodává důvěryhodná core
kompozice; M7 teprve smí přidat autentizovaný transport.

## Ověření

- product commit: `9abf672c585bf8398de76a375b361e668e859e64`
- module baseline: `f8fc13e355c40cbb90f5cf4000d246a4d7abf421`
- `tests/m5-remote-core-adapter.test.js`: 11/11 PASS
- M2 remote contract + boundary: 27/27 PASS
- module graph: 1 176 hran, 3 cykly, 28 souborů v cyklech

Tento WP nepřidává companion listener, pairing, mobilní UI ani remote auth a
není M5 acceptance či nezávislé review.

