# 017 — Negotiated M1 wire potřebuje jediný transportní tvar a cancel ordering

- **typ:** BLOCK pouze pro negotiated M1 wire a terminal ledger
- **stav rozhodnutí:** ČEKÁ NA OPERÁTORA; generated protocol prebuild zůstává PASS
- **WP:** WP-M1-STUDIO
- **rail:** R1, R2, R4, R5
- **vzniklo při:** call-graph trasování po clean-clone checkpointu 010/A+

## Co už je doložené

Kanonický `ConversationCommand/Result` a `CoreEvent` v1 je uzavřený exact-key
kontrakt. TypeScript mirror se v čistém klonu vynuceně zkompiluje před Studio
buildem, runtime exporty se fail-closed ověří a celý Electron production build
projde bez tracked nebo untracked driftu. Žádný autoritativní Studio consumer
ale zatím `@c3/protocol` neimportuje, takže generated delivery sama není wire
ani product-bundle evidence.

Legacy klient žádá pět feature tokenů. Server je filtruje proti jedinému
allowlistu v `src/ws-bridge/protocol.js:buildHelloAck()`. `m1-conversation-v1`
v něm není. Post-handshake server přijímá legacy chat payload a
`session-adapter.js` si sám vytváří nové `turnId`; tato cesta nemůže doložit
identitu přidělenou klientem ani kanonický `CoreEvent` stream.

Tento záznam nemění schéma M1 v1, nebere skrytý default a neblokuje nezávislé
build, rehydrate nebo modelové checkpointy.

## Q1 — Kdo vlastní feature token

### Varianty

| Varianta | Chování | Dopad | Cena přepnutí |
|---|---|---|---|
| A — úzká výjimka pro existující handshake autoritu | `buildHelloAck()` přidá přesný token `m1-conversation-v1`; Studio jej požádá a použije M1 jen pokud jej ACK skutečně vrátí | Jediný allowlist, legacy klient beze změny, žádná změna protocol version | `src/ws-bridge/protocol.js`, klient, WS/client testy |
| B — druhý allowlist ve `ws-server.js` | Server ACK rozšíří mimo `buildHelloAck()` | Dvě handshake autority, které mohou driftovat | server + dva drift testy; pozdější odstranění druhé autority |
| C — M1 bez ACK tokenu | Klient pošle M1 podle své vlastní verze nebo domněnky | Není to capability negotiation; mixed-version spojení je nejednoznačné | Malý diff, nepřijatelně slabý kontrakt |

### Doporučení

**A.** Je to nejmenší explicitní výjimka z dnešního B4 allowlistu a jediná
varianta, která nepřidává druhou autoritu. Token je aditivní feature, nikoli
změna `PROTOCOL_VERSION`; legacy klient jej nepožádá a zůstane na legacy wire.

### Přepínací šev

Jediný šev je seznam `serverFeatures` v `buildHelloAck()` a klientský seznam
požadovaných features. A → B znamená vrátit jeden serverový řádek a přemístit
ACK logiku do `ws-server.js`; minimálně 2 produkční soubory a 2 testovací sady.

## Q2 — Kde žije legacy context, když je command exact-key

### Evidence

Kanonický `ConversationCommand(action:'send')` povoluje jen contract/version,
trojici identity, action a input. Legacy Studio ale současně předává
`editMode`, `agentId`, `projectId` a `attachments`. Přidat je přímo do commandu
by změnilo přijatý connector. Zahodit je by zhoršilo funkční paritu.

### Varianty

| Varianta | Chování | Dopad | Cena přepnutí |
|---|---|---|---|
| A — exact transport wrapper `{command, context}` | `command` se validuje kanonickým v1 validátorem; `context` má vlastní exact allowlist čtyř legacy polí a server obě části ověří před efektem | Connector zůstává jedinou sémantickou autoritou; wrapper je pouze transportní adaptér | 1 server parser/adapter, 1 klient emitter, WS/client/journey testy |
| B — rozšířit `ConversationCommand` | Context pole se stanou součástí v1 | Rozmrazuje JS i TS connector a všechny konzumenty | contracts JS+TS, codec, HTTP/WS/Studio testy a nové versioning rozhodnutí |
| C — context na M1 cestě zahodit | M1 send nenese projekt, agenta, ask režim ani attachmenty | Funkční regrese a odlišné chování legacy/M1 | Menší diff, následná obnova nejméně 4 chování |

### Doporučení

**A.** Wrapper musí být exact-key a `context` smí obsahovat jen explicitně
validované `editMode`, `agentId`, `projectId` a `attachments`; neznámé pole,
getter, ne-JSON hodnota nebo malformed attachment se odmítne před voláním
controlleru. Wrapper nevytváří druhý `ConversationCommand` kontrakt a nesmí
měnit význam těchto polí.

### Přepínací šev

Jediným švem je pojmenovaný transportní parser v `ws-server.js`; downstream
vždy dostane stejný interní request. A → B mění 2 contract implementace,
codec a nejméně 3 testovací sady. A → C odstraní context adaptér a nejméně
4 pozitivní parity testy.

## Q3 — Jak korelovat cancel command a terminál cílového sendu

### Evidence

Rozhodnutí 004/C už stanovilo, že cancel má vlastní `requestId` a `turnId`, ale
cílí právě aktivní turn pomocí společného `conversationId`. HTTP implementace
vydává dva oddělené výsledky: cílový send skončí `cancelled` pod svou původní
identitou a potvrzený cancel skončí `cancelled` pod identitou cancel operace.
M1 WS dosud neurčuje pořadí těchto dvou streamů ani to, zda cancel command smí
zůstat bez vlastního terminálu.

### Varianty

| Varianta | Chování | Dopad | Cena přepnutí |
|---|---|---|---|
| A — zrcadlit přijatý HTTP kontrakt | Nejdřív terminál cílového sendu pod jeho identitou; po potvrzení samostatný terminál cancel commandu pod jeho identitou. Každý stream má právě jeden terminál | Shodná sémantika HTTP/WS; ledger nikdy neslije dvě identity | session adapter + ledger, WS/client/journey testy |
| B — terminál jen cílovému sendu | Cancel command je fire-and-forget a vlastní result stream nemá | Porušuje očekávání command→terminal a ztrácí audit cancel operace | Menší wire diff, speciální výjimka v ledgeru a dokumentaci |
| C — terminál jen cancel commandu | Cílový send se ukončí interně, ale jeho stream terminál nedostane | Původní spinner/ledger nemá autoritativní konec | Menší backend diff, nebezpečný klientský timeout cleanup |

### Doporučení

**A.** Přenáší už přijatou HTTP sémantiku beze změny connectoru. Cílový
terminál musí vzniknout dřív než potvrzující cancel terminál. Timeout nebo jiný
nepotvrzený výsledek cíle se nesmí přeznačit na cancel; cancel command pak
skončí vlastním pravdivým `timeout` nebo `error` stejně jako HTTP adaptér.

### Přepínací šev

Jediný šev je funkce, která po výsledku abortovaného cíle vydá result pro
čekající cancel operaci. A → B/C mění session adapter, terminal ledger a
nejméně 2 kompozitní testy; canonical schema se nemění.

## Implementační invarianty po rozhodnutí

1. M1 frame se nesmí zpracovat bez oboustranně ACKnutého feature tokenu.
2. Command i wrapper jsou validované před controller/provider/filesystem/tool
   efektem; nevalidní frame vytváří přesně nula těchto efektů.
3. M1 spojení nesmí pro stejný send současně emitovat legacy assistant a M1
   terminal stream.
4. Klientský ledger vlastní korelaci identity, monotónní sequence a první
   terminál. `ok` jediný smí vytvořit assistant; všechny terminály musí přes
   jeden pojmenovaný seam ukončit spinner.
5. Duplicate, foreign, out-of-order, late event a event po terminálu jsou
   odmítnuté bez UI nebo persistence effectu.
6. Legacy klient, který token nepožádá, zůstává byte/behavior kompatibilní.

## Přesná otázka pro operátora

Potvrdit nebo změnit jediným blokem:

```text
017-Q1: A
017-Q2: A
017-Q3: A
```

Do potvrzení je zastaven pouze negotiated M1 wire, terminal ledger a built
journey, která je potřebuje. Gate 1 zůstává `BLOCKED`; generated protocol
delivery a ostatní nezávislé práce mohou pokračovat.
