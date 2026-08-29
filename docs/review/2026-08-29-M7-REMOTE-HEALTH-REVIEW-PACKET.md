# M7 remote health — review packet

**Požadovaný verdikt:** `REVIEW_PASSED` nebo `CHANGES_REQUIRED`

**Product candidate:** `f40c58e06449df04b0443cb327c1b27d9afa1fb0`

**Product tree:** `fb71eeeb7c18641584fd65784780e2cd03784caf`

**Review range:** `acebfc79dd4118984215b9a18a8ff1d32159893a..f40c58e06449df04b0443cb327c1b27d9afa1fb0`

## Review otázky

Review má sledovat candidate schema → provider validation → adapter → finální
snapshot, ne pouze helper výstup:

1. Je `remote-health.read` dostupný jen přes exact control-plane manifest a
   complete handler, aniž by se začal inzerovat jako aktivní capability?
2. Validuje provider request i result stejným canonical mobile kontraktem a
   odmítne foreign `requestId` nebo změněný payload?
3. Může adapter získat transport, route, session, network nebo DB singleton
   autoritu, případně obejít provider authority?
4. Vyžaduje composition 1–32 unikátních exact component probes a odmítá
   unknown config fields, invalid IDs a allow-all empty default?
5. Je výstup deterministicky seřazený a deeply frozen, i když byly probes
   předány v jiném pořadí?
6. Změní throw a malformed probe pouze danou komponentu na explicitní
   `unavailable`, bez úniku zprávy nebo falešného `ok`?
7. Selže neplatný i Date-nereprezentovatelný čas před voláním probes a vrátí
   contract-valid typed error?
8. Je absence per-probe timeoutu pravdivě uvedená jako budoucí production
   composition práce, nikoliv skrytá jako live readiness?
9. Zůstává module graph na 1 223 hranách / 3 cyklech / 28 souborech a je nový
   adapter skutečně bez importních hran?
10. Je finální `332/332` nový čistý běh nad `f40c58e0` a zůstává předchozí
    `331/1` census failure zachovaný jako červená mezievidence?

## Minimální reprodukce

```bash
git diff --check acebfc79..f40c58e0
node tests/m7-remote-health-adapter.test.js
node tests/m7-in-process-capability-provider.test.js
node tests/mobile-remote-capability-provider-contract.test.js
node tests/nightly-orchestrator-self-test.js
node tests/module-boundary-ratchet.test.js
node tests/artifact-validation.test.js
node scripts/validate-test-registry.js --json
```

Zelený report:
`.intentsmith-artifacts/m7-remote-health-offline-database-final-20260829/2026-08-29T04-32-31-535Z/report.json`.
Ověřit SHA-256
`3b5803d8a05e5abebd495e662f4e0614a53aabff8c85ab4ea88962dc700b817f`,
source `f40c58e06449df04b0443cb327c1b27d9afa1fb0`, registry
`0f7c1dc10985d64278e894f75ca2a6a386e1c521fad12e0d5e6a5d36a5f97827`,
verdict `PASS`, exit 0 a counts `332/0/0/0/0`.

Červený mezireport na `a59bc68a`: `331 PASS / 1 FAIL`, exit 1, SHA-256
`470c15974e9d95f80a90d34cf85daee94c934e446337bdc8aee2d651a16e128b`.

Packet žádá verdict pouze pro remote-health blok. Nežádá M7 acceptance ani
nepovoluje production composition, session/cursor keys, pairing,
listener/transport activation, mobilní distribuci, live LLM/GPU/device práci,
M5/M6 podpisy, rotace, history změny, promotion, tag, publish nebo push.
