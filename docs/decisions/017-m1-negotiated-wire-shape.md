# 017 — Negotiated M1 wire potřebuje feature token a transportní obálku

- **typ:** BLOCK pouze pro negotiated-wire část 010/A+
- **stav rozhodnutí:** Q1 A Q2 ČEKAJÍ NA OPERÁTORA; CANCEL JE ZAMČENÝ 004/C
- **WP:** WP-M1-STUDIO / B4
- **rail:** R1, R2, R5, R6
- **base evidence:** `da24246ab72edfec9b426004b5eda2cc69ec7ebd`
- **vzniklo při:** call-graph trasování po clean-clone checkpointu 010/A+

## Rozsah

Tento dokument nerozmrazuje M1 schéma, HTTP fallback, effect authority,
rehydrate ani legacy klienta. Řeší jen přepnutí jedné WS session mezi legacy
wire a už přijatým M1 connector consumerem.

Kanonický `ConversationCommand/Result` a `CoreEvent` v1 je uzavřený exact-key
kontrakt. TypeScript mirror se v čistém klonu vynuceně zkompiluje před Studio
buildem, runtime exporty se fail-closed ověří a Electron production build
projde bez tracked nebo untracked driftu. Žádný autoritativní Studio consumer
ale zatím `@c3/protocol` neimportuje, takže generated delivery sama není wire
ani product-bundle evidence.

Tento záznam nebere skrytý default a neblokuje nezávislé build, rehydrate nebo
modelové checkpointy.

## Evidence

`buildHelloAck()` má uzavřený seznam pěti feature tokenů a M1 mezi nimi není.
Studio nabízí stejných pět tokenů. `protocolVersion:1` proto dnes nerozliší
legacy peer od peeru schopného M1. B4 současně výslovně zakazuje obecné změny
`src/ws-bridge/protocol.js`, takže doplnění tokenu bez úzké operátorské výjimky
není povolený implementační krok.

`ConversationCommand` používá exact-key validaci. Legacy Studio ale posílá
navíc `editMode`, `agentId`, `projectId` a `attachments`. Tyto hodnoty nelze
spreadnout do commandu bez porušení přijatého connectoru. Dnešní
`session-adapter.js` navíc vytváří vlastní `turnId` a assistant emituje po
legacy cestě; klientem přidělenou M1 identitu proto neprokazuje.

## Q1 — Jak se M1 wire vyjedná

| Varianta | Přesné chování | Dopad / cena |
|---|---|---|
| A — `m1-wire-v1` | Klient token nabídne; server jej ACKne jen pokud jej podporuje. Kanonická cesta se zapne pouze po ACK. Bez ACK zůstane celá session legacy. | `protocol.js`, `ws-server.js`, `ws-client.js`; WS a Studio client test. Vyžaduje úzkou výjimku pro server feature allowlist. |
| B — implicitně z `protocolVersion:1` | Každý v1 peer se považuje za M1. | Starý klient i server mají stejnou verzi, ale M1 neumějí; false negotiation. |
| C — nový endpoint nebo WS subprotocol | M1 dostane vlastní transportní hranici. | Nový listener/security scope, upgrade routing a journey; není lokální B4 šev. |
| D — bez negotiation nahradit legacy | Každá session používá M1. | Rozbije staré klienty a odporuje 010/A+ požadavku zachovat pojmenovanou legacy cestu. |

### Doporučení Q1: A

Přesný token je `m1-wire-v1`. Aktivace je oboustranná: nabídka klienta sama
nestačí, rozhoduje až token vrácený v `hello_ack`. Po aktivaci nesmí konkrétní
turn při chybě potichu spadnout do legacy wire.

Jde o skutečný BLOCK: mění veřejné handshake chování a sahá do explicitně
zakázaného server feature allowlistu. A → jiná varianta změní 3 runtime soubory
a nejméně 2 focused testovací sady; connector JS/TS se nemění.

## Q2 — Jak oddělit kanonický command od Studio contextu

| Varianta | Přesné chování | Dopad / cena |
|---|---|---|
| A — exact `{command, context}` wrapper | Na existujícím `chat` kanálu bude `data` přesně `{command, context}`. `command` je nezměněný `ConversationCommand`; `context` je adapter-owned exact-key DTO pro `editMode`, `agentId`, `projectId`, `attachments`. Server obě části validuje před controllerem. | Server adapter, session adapter, Studio client/panel; dvě focused sady a built journey. Connector JS/TS se nemění. |
| B — rozšířit `ConversationCommand` | Context pole se přidají přímo do commandu. | Rozmrazí JS i TS connector, codec a contract testy; vyžaduje nové versioning rozhodnutí. |
| C — poslat současně legacy i M1 | Jeden turn má legacy payload/eventy i kanonický stream. | Vytváří dvojí autoritu a umožňuje dvojí assistant render; přímo zakázáno 010/A+. |
| D — context zahodit | M1 command nese jen text a identity. | Mění project/edit/attachment chování; není behavior-preserving evoluce C3 → IntentSmith. |

### Doporučení Q2: A

Autoritativní ingress tvar:

```json
{
  "channel": "chat",
  "data": {
    "command": "<exact ConversationCommand>",
    "context": {
      "editMode": "...",
      "agentId": "...",
      "projectId": "...",
      "attachments": []
    }
  }
}
```

- outer wrapper i context odmítají neznámé klíče;
- context se nikdy nemerguje do commandu;
- command i context se validují před `processChat()` a před efektem;
- malformed negotiated frame končí fail-closed bez controller effectu;
- context nezískává novou effect/approval autoritu;
- pokud přesná validace attachmentů vyžádá novou filesystem authority, zastaví
  se jen attachment subpath jako samostatný BLOCK;
- egress je právě jeden validovaný `CoreEvent` stream; negotiated turn nesmí
  emitovat legacy assistant ani legacy `turn_end`.

Jde o skutečný BLOCK: je to dosud neschválená veřejná transportní obálka.
Varianta A zachová přijaté connector schéma a drží změnu v adapteru. A → B
mění obě contract implementace, codec a nejméně 3 testovací sady; A → D
odstraňuje nejméně 4 pozitivní parity scénáře.

## Cancel — zamčený invariant, nikoli nová otázka

Původní verze 017 jej omylem uvedla jako Q3. Read-only porovnání s přijatým
[rozhodnutím 004/C](004-m1-http-cancel-target.md) prokázalo, že volba už
existuje:

1. send command a cancel command mají vlastní `requestId`, `turnId`,
   `ConversationResult` a event stream;
2. společný `conversationId` vybírá právě aktivní cíl;
3. cílový send dostane terminál `cancelled` pod svou identitou;
4. teprve po tomto potvrzení dostane cancel command terminál `cancelled` pod
   svou identitou;
5. chybějící cíl vytvoří pouze `error` terminál cancel operace;
6. jiný cílový terminál vytvoří cancel `error/not-confirmed`; timeout čekání
   vytvoří cancel `timeout`;
7. pozdní `ok` cílového streamu se odmítne podle rozhodnutí 002.

Control-only ACK, přepsání identity cílového sendu nebo nový
`targetRequestId` by znovu otevřely 004 a connector v2. B4 se na tuto část
znovu neptá.

## Povinný důkaz po přijetí Q1/Q2

Server/WS:

- token se ACKne jen po nabídnutí; legacy klient zůstane legacy;
- M1 frame bez negotiated tokenu nedojde do controlleru;
- malformed command/context skončí před efektem;
- dvě konverzace mají izolované identity a monotónní eventy;
- target cancel terminál předchází vlastnímu cancel terminálu;
- legacy cancel-all zůstane dostupný jen legacy klientovi.

Studio:

- klient přepne cestu jen podle ACK tokenu;
- wrapper má přesné klíče a command projde generated runtime validátorem;
- foreign, duplicate, out-of-order a post-terminal event se odmítne;
- jen terminál `ok` renderuje assistant;
- `cancelled`, `timeout`, `error` vždy přes jediný seam ukončí spinner;
- jeden negotiated turn nikdy nevyrenderuje legacy i M1 odpověď;
- downgrade na legacy je connection-level, ne fallback po odeslání turnu.

Regresně zůstane zelený nezměněný M1 contract, HTTP cancel autorita, generated
protocol build a následný built Studio journey.

## Přesná otázka pro operátora

Potvrdit nebo změnit jediným blokem:

```text
017-Q1: A
017-Q2: A
```

Do potvrzení je zastaven pouze negotiated M1 wire, terminal ledger a built
journey, která jej potřebuje. Gate 1 zůstává `BLOCKED`; generated protocol
delivery a ostatní nezávislá práce mohou pokračovat.
