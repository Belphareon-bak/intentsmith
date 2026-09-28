# M1 B4 — fresh-clone parita byte bridge

- **source SHA:** `b65bcea5367af82fb2b3fc37efe9e6dd83679f88`
- **datum:** 2026-08-22
- **výsledek:** `FRESH_CLONE VERIFIED / PASS` pro production build, preload
  byte bridge a registrovanou Electron boundary journey
- **mimo claim:** produkční ACK `m1-wire-v1`, negotiated M1 multi-panel/
  provider/cancel/reconnect journey, vizuální akceptace UI a celé B4

## Izolace a reprodukce

Nový clone vznikl na disku přes `git clone --no-local --no-checkout`, byl
detached na přesném source SHA a před instalací měl čistý tracked strom.
Závislosti se obnovily bez sítě:

```text
npm ci --offline
corepack yarn install --frozen-lockfile --offline --non-interactive
corepack yarn build
```

Produkční build dokončil forced protocol prebuild, Theia/Electron build a
automatický postbuild guard. Guard vydal `STUDIO_M1_BUILD_CONSUMER_PASS` a
ověřil mimo jiné, že skutečný preload bundle obsahuje byte bridge:

| Artefakt | Bajty | SHA-256 |
|---|---:|---|
| frontend bundle | 11 757 125 | `0a5861836717b1c5143283bc9ccee686b770b57dff90ddea00b17793d8f6e55c` |
| preload | 21 321 | `58a47c8b344cdd3450a34ad15030dc62c02075071184c7ebb03e74f92c37b196` |
| Studio consumer | 49 293 | `8fb4e265b027551a14ad8f1add467ffeb7cd819d50320a590d522441465559e4` |
| generated protocol | 1 161 | `cdad67d9d818f845be3e6b6963b9befbecd4664b5ed1733af40df4883ad18f92` |

Focused kontroly ve stejném klonu skončily:

| Příkaz | Výsledek |
|---|---:|
| `node tests/m1-studio-client.test.js` | 122/122 PASS |
| `node tests/ws-bridge.test.js` | 86/86 PASS |
| `node tests/studio-electron-runner-contract.test.js` | 16/16 PASS |

## Registrovaná Electron boundary journey

Kanonická T5 sada běžela audit runnerem se souběžností jedna, explicitně
povoleným `linux-user-network-namespace`, `iproute2` a scoped X11, pětiminutovým
suite limitem a privátním artifact rootem:

```text
node scripts/nightly-audit.js \
  --suite=IS-T5-TESTS-STUDIO-ELECTRON-BOUNDARY-E2E \
  --allow-blocker=toolchain:linux-user-network-namespace,toolchain:iproute2,toolchain:x11-display \
  --concurrency=1 \
  --timeout-minutes=5 \
  --deadline-hours=1 \
  --fail-fast \
  --run-id=m1-b4-fresh-b65bcea5-20260822 \
  --out-dir=.intentsmith-artifacts/test-runs
```

Runner skončil `PASS`, `1 PASS / 0 FAIL / 0 TIMEOUT / 0 BLOCKED`, exit `0`, za
84 382 ms. Source-tree check uvnitř runneru potvrdil čistý strom a přesný SHA.

Evidence prokázala:

- `attachmentByteBridge.exposed=true`, obě API jsou funkce;
- rendererem vymyšlený token byl odmítnut jako `M1_BRIDGE_TOKEN_UNKNOWN`;
- preload nevystavil žádné path-taking read API;
- production preload měl SHA-256 `58a47c8b…c37b196`, shodný s postbuildem;
- síťový census měl 0 external, 0 other-loopback, 0 unsupported, 0 malformed,
  0 ambiguous a 0 orphaned pokusů;
- boundary matice skončila přesně `403 / 403 / 200`;
- deterministický WS turn měl 0 model-provider requestů, 0 zakázaných efektů,
  korelovaný assistant a správné terminal pořadí;
- povinný soak trval 65 866 ms a síťový capture 66 693 ms;
- Electron i backend skončily bez forced killu, oba process groups byly čisté
  a port file byl odstraněn.

SHA-256 runner evidence:

| Soubor | SHA-256 |
|---|---|
| `report.json` | `a42cddb014e4f5bf12027e988048f1ae5b3553cbfece95046569f01c5bccfc3d` |
| `studio-electron-boundary.json` | `f06438acfcde497fcd40a10f3c968c93e32f377fbea7de8881599bba8acdee07` |
| suite log | `c77c38045abb8f8240e042a10e927671224a82dc9a28e82edb7a9a02f0b3b2fa` |

Všechny tři soubory měly mód `0600`. Po buildu a journey zůstal tracked strom
čistý a `git diff --check` skončil bez chyby.

## Přesná hranice výsledku

Tento běh uzavírá dříve výslovně neprovedenou fresh-clone paritu pro 021 byte
bridge: source-tracked preload bridge se v čistém klonu skutečně sestaví,
postbuild jej fail-closed ověří a Electron boundary jej vidí přes skutečný
`contextIsolation` povrch.

Journey stále používá produkčně dormantní M1 ACK a jediný deterministický
legacy WS turn. Neprokazuje proto negotiated M1 multi-panel/provider/cancel/
reconnect chování a sama neopravňuje zapnout `m1WireSupported` ani označit celé
B4 za `ACCEPTED`.
