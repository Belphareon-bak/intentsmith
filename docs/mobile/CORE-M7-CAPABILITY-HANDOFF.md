# Core/M7 capability handoff

> Historický snapshot níže je vázaný na SHA z 2026-08-30. Na novějším
> integračním základu `de0e8127` existuje VPN runtime a server wiring; tento
> text není důkaz jejich absence ani aktivace. Aktuální mobilní řez a jeho
> omezení uvádí [completion evidence](../execution/runs/mobile/mobile-completion-20260908.md).

**Stav 2026-08-30:** `CORE_IMPLEMENTATION_GREEN /
LATEST_FULL_GATE_GREEN_AT_BBA4BBF3 / REVIEW_PENDING /
PROVIDER_NOT_ACTIVE / M7_LISTENER_ABSENT /
CANDIDATE_NOT_ACCEPTED`

**Aktuální integrační kontext:** connector, client, transport-free provider,
durable journal a všech sedm capability adapterů jsou implementation-green.
Aktuální 338-programový offline+database plán včetně disconnected LAN/VPN
admission policy prošel souvisle `338/338 PASS` na exact kandidátu
`bba4bbf3`; produktový řez a nový M6 registry ratchet však stále čekají na
nezávislé review. Policy neotevírá listener, nevlastní produkční klíče a
nekonzumuje session authority. Produkční M7 transport proto zůstává absent.
Novější disconnected durable limiter na exact kandidátu `b23f63d6` prošel
souvislým `339/339 PASS`; limiter nemá listener consumer ani produkční HMAC key
custody a řez čeká na nezávislé review.
Stav M5/M6 se přebírá pouze z
`ROADMAP.md` a `SYSTEM-MAP.md`, nikoli z historického počítadla zdrojové
mobilní větve.

Tento balík odstranil schema/design blokaci pro core a M7. Transport-free
provider, durable journal, health a všech sedm core capability oblastí existují
jako review-pending kandidát. Approval používá výhradně přijatou M2 autoritu,
events skutečný M1 emitter a notifications úzký M3 read port. Žádný listener
ani runtime aktivace z toho neplyne.

## 1. Jediný kandidátní balík

| Autorita | Účel | Digest |
|---|---|---|
| `remote-capability-requirements-v1.js` | 7 capability, 14 operací, scope/data/provider metadata | `sha256:e076d2…a0654` |
| `remote-capability-payloads-v1.js` | exact nested schémata, bounds a cross-field validátory | `sha256:1f9ac2…3753b` |
| `remote-capability-manifests-v1.js` | per-capability contract/operation/schema manifesty | viz tabulka níže |
| `remote-capability-golden-v1.js` | 18 sanitizovaných success/error párů a negativní drift | golden `sha256:171d02…5a17d`; negative `sha256:869d1f…935fb` |
| `remote-capability-conformance-v1.js` | in-process advertisement a provider gate | bez listeneru a BE importu |

Candidate adapter manifest má digest `sha256:abe993…822f4`. Je to integrační
pin, nikoli nový přijatý M5 manifest. Runtime mobilního klienta jej neimportuje.

| Capability | Verze | Contract digest | Operations digest | Payload schema digest |
|---|---:|---|---|---|
| approvals | 1 | `sha256:ea976e…f18b6` | `sha256:2678a4…c4f74` | `sha256:785419…43ef9` |
| conversations | 2 | `sha256:fbc0d2…6c76b` | `sha256:839f84…99838` | `sha256:ae9cd7…66956` |
| events | 1 | `sha256:cc371d…24ac3` | `sha256:975cfe…ad977` | `sha256:18dfc7…7102f` |
| notifications | 1 | `sha256:d780ec…20f2a` | `sha256:75cec5…970e4` | `sha256:27bd21…0fbb7` |
| projects | 2 | `sha256:a3b9bc…6e9f3` | `sha256:69bd4d…0639d` | `sha256:d794b4…54773` |
| settings | 1 | `sha256:f45384…296b4` | `sha256:17d460…84b3a` | `sha256:263f64…948c5` |
| stored_information | 1 | `sha256:73b961…c96ed` | `sha256:d01733…157e5` | `sha256:e0ce3f…4ae50` |

M7 prerequisite je záměrně mimo M2 capability negotiation:

- contract digest `sha256:02d60a…ede2`;
- operations digest `sha256:3c9e13…5f0a7`;
- payload schema digest `sha256:e06bca…86d7c`.

## 2. Provider acceptance matrix

| Pořadí | Capability/operace | Povinný core port | Minimální důkaz před integrací |
|---:|---|---|---|
| 1 | conversation list/history | `conversation-read-model` | snapshot-bound cursor, chronologická history stránka, cizí conversation odmítnuta |
| 2 | project list/rootless context | `project-read-model`, `remote-project-context-port` | serverový `projectId→canonicalRoot`, exact workspace revision, žádná host path v requestu/výsledku |
| 3 | approval list/decide | `approval-read-model`, `approval-decision-service` | view↔payload digest, expiry, CAS revision, single-use a replay téhož operationId |
| 4 | operation list/get/abandon | `operation-read-model`, `operation-control-service` | device-subject partition, nerozřešený efekt bez auto-retry, abandon není rollback |
| 5 | run events | `run-event-read-model` | monotónní sequence, bounded retention, viditelný `REMOTE_EVENT_WINDOW_GONE` |
| 6 | notification list/ack | `notification-read-model`, `notification-receipt-service` | S1-only projection, per-device receipt, ACK nepřekročí observed sequence |
| 7 | settings read/update | `mobile-settings-read-model`, `mobile-settings-command-service` | typed allowlist, fresh revision, effect/approval mediation, zakázané admin/security klíče |
| 8 | stored info list/append | `stored-information-read-model`, `stored-information-command-service` | subject/project scope, pouze manual append, effect/approval mediation |
| 9 | health + session boundary | `remote-health-read-model` + M7 | pouze S0 pre-auth health; pairing, TLS peer, scope, expiry, revoke, audit a rate/resource limity |

Každý řádek musí mít vedle happy path nejméně: malformed/unknown field,
foreign subject, chybějící scope, stale revision nebo cursor, reuse operationId
s jiným request digestem, provider unavailable a result-identity mismatch podle
toho, co je pro operaci relevantní.

## 3. Jak balík převzít v core

1. V connector-only WP připnout exact candidate commit a nejdřív schválit nebo
   verzovaně změnit schémata. Nikdy nekopírovat paralelní JSON Schema jako další
   autoritu; executable JS registr je zdroj pravdy.
2. Pro existující `ConversationCommand/Result@1` injektovat přijaté M1
   validátory. Pro `ProjectContextSnapshot@1` injektovat přijatý
   `validateProjectContextSnapshot` z M2. Kandidátní gate bez nich selže.
   Settings decimal hodnoty nepřevádět na JSON float: kvůli M2 canonical
   digestu zůstávají canonical decimal stringy (např. `"0.7"`).
3. Implementovat jen uvedené provider porty uvnitř core. RemoteCore adaptér
   nesmí importovat HTTP route, websocket, server, DB repository ani listener.
4. Provider test zavolat přes `runMobileRemoteProviderConformance({ invoke,
   externalValidators })`. Gate ověří všech 14 capability operací, exact
   payload, result identity a také to, že provider nemutuje request.
5. Teprve po provider acceptance zapojit M7 invocation envelope a znovu spustit
   gate s `includeControlPlane: true`; tím se přidají 4 operation/health případy.
6. Publikovat accepted manifest digesty do negotiation odpovědi. Mobile runtime
   pin se mění až proti review-passed core/M7 artefaktu, nikdy podle tohoto
   kandidáta samotného.

Lokální důkaz bez backendu:

```bash
node tests/mobile-remote-capability-contract.test.js
node tests/mobile-remote-capability-provider-contract.test.js
npm run test:registry
npm run test:mobile
```

## 4. Stop conditions

Integrace není přijatelná, pokud platí alespoň jedna položka:

- provider vrací prázdný úspěch místo typed unavailable/error;
- telefon může dodat actor, scope, token, grant, device identity, endpoint,
  `canonicalRoot` nebo absolutní host path;
- RemoteCore provider obchází authority přes legacy `/api/*`, `/m1/*` nebo
  `/c3/ws`;
- mutace nemá durable operation journal, request digest a replay sémantiku;
- cursor není bound k subjectu, filtrům, operaci, capability verzi a snapshotu;
- M7 vystaví listener před pairing/auth/scope/revoke/audit a negativním
  boundary testem;
- accepted M1/M2 kontrakt je lokálně překopírovaný nebo oslabený namísto použití
  jeho authoritative validátoru;
- capability nebo digest se označí jako available dřív, než existuje provider a
  všechny relevantní negativní testy.

## 5. Co je a není dokončeno

Dokončeno je schema/design/conformance vstupní rozhraní: přesné typy, verze,
digests, fixtures, identity bindings a implementační pořadí. Core/M7 se tedy
nemusí zastavit kvůli nejasnému mobilnímu kontraktu.

Implementačně dokončený je generic provider, operation journal, health a všech
sedm core oblastí: projects, conversations, approvals, events, notifications,
safe settings projection a subject/project-scoped manual notes. O-01/O-02
session bytes jsou hotové, ale podmíněný session review zakazuje jejich spojení
s listenerem do nového review. LAN/VPN admission policy už ověřuje TLS/bind,
peer, route/header/body hranice a připravuje opaque rate-limit bucket identity,
ale nemá durable limiter ani síťového konzumenta. Nedokončené zůstávají přijetí
aktuálního core kandidáta, produkční listener/certificate, signing a fyzické
device/security/release důkazy. Proto je správný stav stále
`CANDIDATE_NOT_ACCEPTED`, nikoli production-ready.
