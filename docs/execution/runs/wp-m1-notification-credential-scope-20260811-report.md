# WP-M1 notification credential scope — Review A evidence

integrationRef: integration/m1-consolidated-20260810
baseRevision: 89de69202b7ed72937400a40ce0fbb91475aa926
subjectHead: 0ed3c0edf292acf8456e4dbc6bf0bb99ee01a2aa
reviewA.verdict: PASS

## Rozsah

WP027 zavádí exact-literal opt-in pro pět retained external notification
kanálů, default-deny registraci a effect boundary, feature-only
`sync_settings`, retirement notification credential vstupů ze Setupu a
credential-free source povrch ve čtyřech first-party UI plochách. Nepřenáší,
nečistí ani nemaže existující credentials; ty zůstávají pro navazující 028 a
026.

## Replacement provenance

První immutable subject
`c72b11c3f1044298f7a3e3a29420f578b7650c46` skončil v Review A jako
`CHANGES_REQUIRED`: fyzický Setup scanner nepokrýval všechny parser-effective
cross-line dotenv assignmenty. Jeho evidence commit nevznikl a původní local i
remote ref zůstaly beze změny. Replacement checkpoint
`fc5b34f32a6ea8e30aff18bb2234462503efe365` je tree-identický sibling nad
stejným base; remediation subject
`0ed3c0edf292acf8456e4dbc6bf0bb99ee01a2aa` nad ním mění pouze Setup writer,
focused test a Finding 011. Oprava fail-closed odmítá cross-line delimiter a
value spans i parserové line terminátory `U+2028`/`U+2029`, a stejnou hranici
vynucuje pro nové owned hodnoty před publikací.

## Nezávislé Review A

Review ověřilo exact lineární rozsah
`89de69202b7ed72937400a40ce0fbb91475aa926..0ed3c0edf292acf8456e4dbc6bf0bb99ee01a2aa`,
clean/upstream stav, dva source commity a přesně 23 allowlisted cest. Policy
validuje všech pět env flagů před konstrukcí kanálů, všechny produkční routery
a direct verifiery jsou default-deny, WS nejprve validuje celý exact
sedmiklíčový boolean payload a teprve poté mutuje feature state. Setup před
temp/publish krokem odmítá unsafe parser authority a výsledný dokument
terminálně ověřuje pinovaným `dotenv@17.3.1` parserem. UI retirement nemaže
legacy Setup ani Architect data a zachovává Security webhook povrch pro 028.

## Focused evidence

| Kontrola | Výsledek | Exit |
|---|---:|---:|
| `node tests/m1-notification-credential-scope.test.js` | 2 passed, 0 failed | 0 |
| `node tests/ws-bridge.test.js` | 92 passed, 0 failed | 0 |
| `node tests/m1-studio-client.test.js` | 127 passed, 0 failed | 0 |
| `node scripts/validate-test-registry.js --json` | 382 programů, 8 exclusions; fingerprint `571ae1a90a4246c7037d56fe5fb786beb4b5c4aae3e61f163d5b6ffe14341d71` | 0 |
| `node --check` nad 14 změněnými JS soubory | bez chyb | 0 |
| range `git diff --check` a finální porcelain | bez chyb, clean | 0 |

## Hranice tvrzení

WP027 neřeší canonical credential transfer/scrub, webhook retirement ani
server-settings reset. Známé ACTIVE compatibility residualy a route, která
ignoruje typed disabled runtime-apply výsledek, zůstávají výslovně zapsané ve
Findingu 011 pro navazující práci. Finding 011 je `OPEN`, Gate 1 zůstává
`BLOCKED` a pokračuje pořadí 028 → 026 → 029. Electron, GPU, Ollama, outbound
journey, externí síť ani full-product test nebyly spuštěné.
candidateHead: 56a00c09ae66b4ebba0eedde81b53fafb816cefa
reviewB.verdict: PASS
