# Studio CDP evidence contract

**Stav:** implementovaný reducer; runtime runner ještě není acceptance evidence
**Scope:** `WP-M0-E`, capability `C3-001`

Tento kontrakt ověřuje pouze stabilní funkční hranici dnešního C3 Studia. UI,
které runner otevře, není finální podoba IntentSmithu. Text, layout, CSS,
selektory, screenshoty ani vizuální podobnost proto nejsou součástí verdiktu.

## Co reducer dokládá

`scripts/studio-cdp-evidence.js` zpracovává pouze události `Network.*`:

- skutečné wire hlavičky z `requestWillBeSentExtraInfo`, nikoliv pouze
  rendererový pohled z `requestWillBeSent`;
- opaque-origin HTTP boundary, local capability, CORS odpověď a status;
- přesný `/c3/ws` handshake, aplikační protokol a životnost rámců;
- nulový pokus o externí nebo neočekávaný loopback cíl.

Chybějící `ExtraInfo`, duplicitní evidence, redirect, neukončený request,
neznámý backend path, odmítnutí boundary nebo překročení kapacity jsou červený
výsledek. `/api/media/history` smí mít `404` pouze v explicitním režimu bez
ComfyUI; ostatní povinné HTTP cesty musí skončit `2xx`.

## Privacy boundary

Snapshot neobsahuje request ID, URL, origin/hostname, port, query, fragment,
userinfo, hlavičky, capability hodnotu, cookies, authorization, request/response
body, WS payload, error text, renderer location, filesystem path, timestamp ani
debug port. Dynamické cesty se redukují na pevné route identifikátory a neznámé
vstupy na pevné enumy. Capability se porovnává constant-time a ven jde jen
`match`, `mismatch`, `missing`, `duplicate` nebo `invalid`.

Tento checkpoint je testován v
`tests/studio-cdp-evidence.test.js`, včetně obráceného pořadí CDP událostí,
wire/base konfliktů, negativních HTTP/WS variant, limitu záznamů a redakčních
canary hodnot.

## Co ještě chybí

Reducer sám nespouští Electron ani server a netvrdí `C3-001 PASS`. Následující
checkpoint musí dodat registrovaný runner, který na čistém buildu:

1. pořídí snapshot až po minimálně 65 sekundách živého spojení;
2. doloží sedm startup route rodin, skutečný `POST /api/settings` a WS provoz;
3. provede oddělený negativní trojúhelník boundary;
4. ukončí Electron i backend s `code=0`, `signal=null`, bez `SIGKILL`;
5. uloží pouze snapshot podle tohoto kontraktu a sanitizované procesní exity.
