# 021 — Produkční ACK M1 wire čeká na attachment a effect-authority policy

- **typ:** BLOCK pouze pro produkční zapnutí `m1-wire-v1`
- **stav rozhodnutí:** DECISION_REQUIRED; exact adapter je bezpečně dormantní
- **WP:** WP-M1-STUDIO / B4
- **rail:** R1, R2, R3, R5, R6
- **vzniklo při:** implementaci accepted 017/A+A ingress/egress a terminal ledgeru

## Co už není otázka

Rozhodnutí 017 závazně určilo required-offer token `m1-wire-v1` a exact
`{command, context}` wrapper. Implementační kandidát už:

- validuje command, outer wrapper i context před controller efektem;
- zachovává request/conversation/turn identitu a per-command monotónní sequence;
- emituje právě jeden validovaný `CoreEvent` stream bez legacy assistant nebo
  legacy `turn_end`;
- implementuje 004/C: target `cancelled` vždy předchází vlastnímu cancel
  `cancelled`, včetně více souběžných idempotentních cancel požadavků;
- fail-closed odmítá legacy chat/cancel po negotiated ACK;
- nechává `m1WireSupported=false` jako explicitní server activation seam.

`src/server.js` tento seam nepředává. Produkční server proto token stále
pravdivě neACKuje a stávající Studio zůstává na legacy wire. Tento dokument
není žádost o skrytý default ani důvod oslabit listener guard.

## Proč nelze jen přepnout boolean

### R1 — Přílohy dnes zahrnují implicitní filesystem autoritu

Studio před odesláním používá `FileReader`, ale při prázdném nebo chybovém
výsledku zachová také lokální `path`. `ChatController.handle()` pak pro
attachment bez contentu volá synchronní `fs.readFileSync(a.path)`. Přijetí
libovolného path z negotiated contextu by tedy nebylo pouhé doručení dat;
udělilo by remote commandu read authority nad backend filesystemem.

Současný B4 kandidát proto přijímá pouze exact `attachments: []`. Studio
neprázdnou nebo malformed kolekci ponechá lokálně jako `NOT_SENT` a nikdy ji
nedowngradeuje do legacy. Je to bezpečný mezistav, ale při produkčním ACK by
uživateli znefunkčnil dnes živé přílohy.

| Varianta | Chování | Dopad |
|---|---|---|
| A — park do M2 | Produkční M1 ACK zůstane vypnutý, dokud M2 nevlastní attachment/read autoritu. | Bez regrese, ale B4 se neuzavře před M2 a změní se roadmap dependency. |
| B — bounded inline-only v B4 | Studio smí poslat pouze exact inline content bez `path`; count, jednotlivá i aggregate velikost a typ jsou omezené na obou stranách. Path nebo contentless položka je `NOT_SENT`. | Zachová běžné text/image FileReader přílohy bez nové FS autority; vyžaduje exact DTO a negativní byte/count testy. |
| C — ACK s prázdnou policy | M1 se zapne hned a každá neprázdná příloha zůstane `NOT_SENT`. | Nejmenší kód, ale vědomá produktová regrese vůči C3. |
| D — přijmout legacy path | Backend dál čte callerem zadanou cestu. | Nepřijatelné: nová nebrokerovaná filesystem authority. |

**Doporučení:** B. Je to nejmenší behavior-preserving šev: obsah už Studio
lokálně vlastní, zatímco path se explicitně zahodí. Přesné limity se nejprve
odvodí z dnešních 1 MiB text / 5 MiB image limitů a z maximálního počtu
souborů v UI; nesmějí se odhadnout ani převzít pouze z klienta.

### R2 — Legacy WS po chat success automaticky vykoná shell effect

Legacy `session-adapter.js` po controller výsledku kontroluje
`response.metadata.shellCommand` a fire-and-forget volá `handleTerminal()`.
Tento effect nemá M1 command/result autoritu, approval ledger ani jednotný
terminál. Kanonická větev jej správně nespouští, ale dnes by přesto mohla vrátit
chat `ok`, a tím nepravdivě tvrdit parity u SHELL intentu.

| Varianta | Chování | Dopad |
|---|---|---|
| A — honest no-effect terminal | M1 rozpozná požadovaný legacy effect před `ok` a vrátí typovaný `error/M1_EFFECT_AUTHORITY_REQUIRED`; nic nespustí. | Umožní bezpečně aktivovat běžný chat, ale SHELL je výslovně unavailable do M2. |
| B — M2 authority před B4 aktivací | Produkční ACK čeká na jeden schválený effect/approval port a SHELL přes něj dostane vlastní run identitu. | Nejlepší parity, ale mění pořadí M1→M2 a rozšiřuje současný WP. |
| C — převzít legacy auto-exec | M1 po chat success dál fire-and-forget spustí shell. | Nepřijatelné: dvojí autorita a false-success při effect failure. |
| D — selektivní turn downgrade | SHELL turn se po negotiated ACK pošle legacy. | Nepřijatelné podle 017: negotiation je connection-level a turn fallback je zakázán. |

**Doporučení:** A teď, B jako M2 náhrada. A nepředstírá funkci, kterou nový
connector neumí bezpečně potvrdit, a drží jediný vratný šev v mapování controller
výsledku na `ConversationResult`. Nejde o finální parity; B4/Gate 1 musí tuto
odchylku uvést explicitně, dokud ji M2 neuzavře.

## Reversible implementační defaulty, které neblokují ACK samy o sobě

- číselná Studio `agentId`/`projectId` se na jediném producer seamu převádí na
  kanonický decimal string; malformed hodnota skončí před wire efektem;
- jedna conversation má nejvýše jeden aktivní M1 send; HTTP a WS mutex zůstávají
  oddělené podle Findingu 005 a globální autorita se netvrdí;
- klient přijme nejvýše 256 CoreEventů a 1 048 576 serializovaných JavaScript
  code units na turn. Jde o client safety ceiling, nikoli payload byte SLA;
- terminal ledger drží nejvýše 256 položek a po terminálu zahodí payload,
  event history, socket i panel reference. Zůstane pouze bounded identity/order
  tombstone potřebný pro cancel ordering.

Tyto hodnoty se mohou změnit v jedné pojmenované funkci a focused testu. Pokud
skutečný built journey prokáže, že legitimní provoz limit překračuje, změna se
udělá z měření, ne skrytým odstraněním limitu.

## Důkaz, který ještě chybí bez ohledu na volbu

Současná Studio unit sada injektuje source M1 contract jako VM dependency.
Dokládá consumer logiku, nikoli to, že production bundle skutečně obsahuje
compiled `@c3/protocol`. Po commitech musí nový čistý klon provést frozen
offline install, forced protocol prebuild, production build, bundle/runtime
probe a negotiated multi-panel/cancel/provider/reconnect journey. Teprve
potom lze candidate změnit z focused PASS na built evidence.

## Přesná otázka pro operátora

```text
021-attachments: B-bounded-inline-only
021-path-authority: REJECT
021-shell-now: A-honest-no-effect-terminal
021-shell-target: B-M2-effect-authority
021-production-ack: AFTER-BOTH-NEGATIVE-SUITES-AND-BUILT-JOURNEY
```

Do odpovědi lze commitnout dormantní server adapter a Studio ledger, protože
produkční ACK zůstává vypnutý. Nesmí se aktivovat `m1WireSupported` v
`src/server.js`, rozšířit attachment policy ani zdědit legacy shell effect.
