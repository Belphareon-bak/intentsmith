# M1 consolidation queue — source checkpoint

stableBase: `1d351f67428eb1c4ae1adc99ce4dd99baef608e9`

candidateRevision: `c0fcc444f9f0d5a3519a02c6ab3b4d0bedd1fdab`

boundaryBaselineRevision: `6c2a95c9ce7bebf394ec1ea3423296ee5d6b4cb7`

branch: `queue/m1-consolidation-20260810`

reviewState: `PARTIAL_REVIEW_QUEUE`

freshCloneState: `FOCUSED_PROFILE_VERIFIED`

## Výsledek

Vznikl jeden serializovaný M1 review checkpoint nad stabilním remote základem.
Canonical ref `origin/integration/gate1-prod-ready-20260809` se neposunul.
Queue není nový sdílený vývojový základ ani Gate 1 PASS: obsahuje přezkoumané i
dosud čekající lineages a pravdivě zachovává jejich jednotlivé stavy.

Mobilní 055–060, M3, M5, P10 a cizí rozpracované dokumenty nejsou součástí
tohoto stromu. Starý proof issuer s caller-owned `acceptancePath` také nebyl
přenesen, protože odporuje navržené provenance hraně 024.

## Přenesené lineages

| Oblast | Source | Queue commit | Stav |
|---|---|---|---|
| default-deny portable settings | `95f428438d3467ce3c8dfa2cb499dab07bab4f41` | merge `b00d83b2babad8f18a4a0bc3710ba0e2d04d32c0` | čtyři review nálezy opravené; nové formální Review A a fresh clone otevřené |
| 015 proof policy + immutable ledger 062 | `5d93f74f39019e21b6acdb945ad24ee126f16406` | merge `de77fb2251132db93f2689327da6a8568987a82e` | schema/policy candidate; issuer a skutečný proof nejsou hotové |
| pending provenance contract 024 | dokumenty z `a3893ff6` | `06aa918836bf5f00e0e863d3d8a0ac7d213b950f` | `DECISION_REQUIRED`, žádná implementace |
| M1 wire attachment/shell hardening | osm bounded commitů | `c979cc83..9dae9508` | source/VM evidence; production ACK a built Electron journey otevřené |
| module boundary | source `9dae950819c338e915911086dd05f6aa9848a0db` | `6c2a95c9ce7bebf394ec1ea3423296ee5d6b4cb7` | baseline utažena 1 024 → 1 023, bez přidané hrany |

Wire změny byly replayovány bez jejich nesouvisejícího M3/P10 a překonaného
proof dědictví:

| Původní commit | Queue commit |
|---|---|
| `657e1edb` | `c979cc83310f9ddd094aad3fe921639214f17d0f` |
| `7b83faad` | `badbd40ee79b31143530dbccb430b50e696e7d69` |
| `c502470e` | `42796f2ee97dead2ef30c88c725483a16b760178` |
| `074fb107` | `5849c7d7ca780affe7bacd72dc4c116de021982b` |
| `adfdec32` | `ab31e2c58209ee0beeb2e02521c16b41838cd8bc` |
| `90203fc9` | `a50fe19b712e93d7fb818f7e5fa475596f5f055c` |
| `72b112b8` | `6e0be0f853480e03e26694f09bb7b9a4551dc1e1` |
| `e1bf6fcd` | `9dae950819c338e915911086dd05f6aa9848a0db` |

## Lokální validační evidence

Nový worktree nejprve neměl `node_modules`; čtyři pokusy proto skončily před
načtením testů na `ERR_MODULE_NOT_FOUND: better-sqlite3`, exit `1`. Nejsou
započítané jako výsledky produktu. `npm ci --offline` následně přidalo 233
balíčků podle lockfile, audit našel 0 vulnerabilities a skončil exit `0`.

| Příkaz | Výsledek | Exit |
|---|---:|---:|
| `node tests/m1-model-policy.test.js` | 36 passed, 0 failed | 0 |
| `node tests/m1-model-failover-proof-policy.test.js` | 9 passed, 0 failed | 0 |
| `node tests/m1-model-failover-measurement.test.js` | 9 passed, 0 failed | 0 |
| `node tests/m1-model-failover-schema.test.js` | 25 passed, 0 failed | 0 |
| `node tests/m1-model-binding-storage.test.js` | 16 passed, 0 failed | 0 |
| `node tests/m1-model-binding-repository.test.js` | 46 passed, 0 failed | 0 |
| `node tests/schema-migrations.test.js` | 38 passed, 0 failed | 0 |
| `node tests/ws-bridge.test.js` | 91 passed, 0 failed | 0 |
| `node tests/m1-studio-client.test.js` | 127 passed, 0 failed | 0 |
| `node tests/artifact-validation.test.js` | 151 passed, 0 failed | 0 |
| `node tests/module-boundary-ratchet.test.js` | 13 passed, 0 failed | 0 |
| `node tests/repository-hygiene.test.js` | 1 555 tracked paths | 0 |
| `node scripts/validate-test-registry.js --json` | 378 programs, 8 exclusions, fingerprint `cb1259ca55a95ecb32bc1831fca37249c449f880c36c9f1506072fdce8d06e15` | 0 |
| `node scripts/module-boundary-ratchet.mjs` | 1 023/1 023, added 0, removed 0, cycles 3/28 | 0 |
| `git diff --check` | bez whitespace chyb | 0 |

Cross-worktree checker z mobilního tool checkoutu navíc našel 62 obsazených
migračních čísel, nejvyšší `062`, další volné `063` a žádnou divergentní
kolizi. Skript není součástí tohoto queue source, proto tento běh není vydáván
za jeho portable test evidence.

## Oddělený `--no-local` clone checkpoint

Kandidát `c0fcc444f9f0d5a3519a02c6ab3b4d0bedd1fdab` byl checkoutnutý detached v
novém `git clone --no-local --no-checkout`. Před instalací i po testech byl
`git status --porcelain=v1 --untracked-files=all` prázdný. `npm ci --offline`
znovu přidalo 233 balíčků, audit našel 0 vulnerabilities a skončil exit `0`.

Fresh-clone profil úmyslně neopakoval každou lokální sadu. Spustil přímo
integrované hranice a skončil takto:

| Příkaz nad `c0fcc444` | Výsledek | Exit |
|---|---:|---:|
| `node tests/m1-model-policy.test.js` | 36 passed, 0 failed | 0 |
| `node tests/m1-model-failover-proof-policy.test.js` | 9 passed, 0 failed | 0 |
| `node tests/m1-model-failover-schema.test.js` | 25 passed, 0 failed | 0 |
| `node tests/schema-migrations.test.js` | 38 passed, 0 failed | 0 |
| `node tests/ws-bridge.test.js` | 91 passed, 0 failed | 0 |
| `node tests/m1-studio-client.test.js` | 127 passed, 0 failed | 0 |
| `node tests/artifact-validation.test.js` | 151 passed, 0 failed | 0 |
| `node scripts/validate-test-registry.js --json` | 378 programs, 8 exclusions, fingerprint `cb1259ca55a95ecb32bc1831fca37249c449f880c36c9f1506072fdce8d06e15` | 0 |
| `node scripts/module-boundary-ratchet.mjs` | 1 023/1 023, added 0, removed 0 | 0 |
| `node tests/repository-hygiene.test.js` | 1 556 tracked paths | 0 |
| `git diff --check` + prázdný porcelain | bez rozdílu | 0 |

## Zbývající blokátory M1

1. rozhodnutí 024 je stále `DECISION_REQUIRED`; bezpečný issuer proto není
   implementovaný a PASS proof je `NOT_ISSUED`;
2. skutečný autorizovaný GPU/Ollama role run nebyl proveden;
3. produkční server stále neACKuje `m1-wire-v1` a built Electron B4 journey
   nebyla provedena;
4. Finding 011 — generic secret-bearing `/api/settings` a whole-row/RMW writery
   nemají společnou CAS/secret authority;
5. formalizované review nových merge lineages chybí; focused `--no-local`
   checkpoint je hotový, ale není náhradou za Review A ani built journey.

Do uzavření těchto bodů je výsledek `BLOCKED` pro Gate 1 a nesmí posunout
stabilní remote ref. Po potřebném review vznikne samostatný promotion
commit/ref; historie této queue se nebude přepisovat.
