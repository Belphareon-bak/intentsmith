# Inventura #21 — Studio a WS bridge

**Pořadí 8** · **2026-08-02** · `17a8b9a8` · 5 souborů, **1 271 řádků** + `c3-ide/`

| Soubor | Ř. |
|---|---:|
| `session-adapter.js` | 676 |
| `ws-server.js` | 333 |
| `protocol.js` | 132 |
| `file-watcher.js` | 103 |
| `index.js` | 27 |

**Testy:** 4 sady — `offline` 2, `server` 2. `lastGreen: 0`.
**Ověřeno za běhu:** `/architect` vrací 200 a 74 KB, `/agents` 200, WS se připojuje na `/c3/ws`.

## Dobré, použije se
- **`protocol.js` odděleně** (132 ř.) — verze protokolu je vlastní modul, ne rozeseté konstanty.
- **`broadcast(channel, data)`** — kanálový model pro `control` (media/GPU/system progress).
- **Odpojení ruší práci** — `session-adapter.js` při disconnectu abortuje aktivní turny a zamítne pending edity. Nezůstávají viset.
- **`file-watcher.js` (103 ř.)** — malý, jedna starost.

## Zbytečné
Nic prokazatelného.

## Nejasné
| # | Zjištění | Otázka |
|---|---|---|
| **W-1** | **Terminal channel přijímá `{type:"exec", command}`** (`session-adapter.js:398`) po handshaku, který ověřuje pouze `protocolVersion` (`ws-server.js:126`). Na loopbacku neškodné, mimo něj je to RCE — to je `G0-R018` a invariant L0-10. | Nic k rozhodnutí teď (bezpečnost je odložená), ale **musí to zůstat viditelné**, protože to je nejtvrdší omezení celého produktu. |
| **W-2** | **Rehydrate vrací předložené conversation ID bez ověření v DB.** | Vada, nebo záměr? Klient si může říct o cizí konverzaci. |
| **W-3** | **Token streaming neexistuje** — `onLLMToken` je konzument bez producenta, komentář v kódu říká *„reserved for future use"*. Odpověď přichází až celá. | Je streaming v rozsahu 1.0? Ovlivňuje to vnímanou rychlost víc než cokoli jiného. |
| **W-4** | **`c3-ide/` (Theia/Electron) není v této inventuře změřený.** Je to samostatný build s vlastními závislostmi a `G0-R030` ho blokuje pro Gate 1. | Vlastní inventura pro IDE, nebo se 1.0 opře o web UI `/architect`? |
