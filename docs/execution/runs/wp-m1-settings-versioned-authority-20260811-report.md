# WP-M1 settings versioned authority — Review A evidence

integrationRef: integration/m1-consolidated-20260810
baseRevision: 55d32e14876964863b573bfd4b18086aaa46768d
subjectHead: 4f7f57422c525cc16d6cdffea41fc41d0df25001
reviewA.verdict: PASS

## Rozsah

WP025 zavádí jedinou verzovanou autoritu `user_settings`, exact CAS pro generic
preferences, redigovanou 46cestnou public projection, typed mutation writery a
cutover tří first-party klientů. Legacy `GET/POST /api/settings` jsou ve
finálním source commitu inertní `410` endpointy.

## Replacement provenance

První final-source candidate
`cf050caaf67331c59b7bcb519b6867f18a0ea244` skončil v Review A jako
`CHANGES_REQUIRED`: produkční allowlist byl správný, ale test pinoval pouze
počet cest. Historie ani původní ref se nepřepisovaly. Replacement subject
`4f7f57422c525cc16d6cdffea41fc41d0df25001` je sibling nad stejným parentem
`75a6497606f7055c06741d3992ed6bd6004b677a`; oproti odmítnutému subjectu mění
jen authority test a Finding 011. Oprava přidává nezávislou exact 46-entry
fixture a zachovává čtyři top-level scénáře.

## Nezávislé Review A

Review ověřilo lineární rozsah
`55d32e14876964863b573bfd4b18086aaa46768d..4f7f57422c525cc16d6cdffea41fc41d0df25001`,
clean/upstream stav, exact pěticestný final-commit allowlist a nulový zásah do
klientských cest v posledním commitu. Produkční seznam i nezávislá fixture mají
46 unikátních členů a jejich seřazené množiny jsou byteově shodné. Migrace 064
má napříč lokálními/remote refs a registrovanými worktrees jediný filename i
jediný blob; původní a replacement subject nesou identickou migraci.

## Focused evidence

| Kontrola | Výsledek | Exit |
|---|---:|---:|
| `node tests/m1-settings-notification-authority.test.js` | 4 passed, 0 failed | 0 |
| exact generic owner fixture | production 46/46 unique, fixture 46/46 unique, exact membership | 0 |
| migration 064 census | jediný filename, jediný blob `06a117205120cb89f031937885c97971ab358aee` | 0 |
| `node scripts/validate-test-registry.js --json` | 381 programů, 8 exclusions; fingerprint `665461cccea8f691e6d609c381b21c7bd8b7b2b1ff9932fd4aad42b9552216e0` | 0 |
| `git diff --check` a finální porcelain | bez chyb, clean | 0 |

První plný Review A běh na odmítnutém subjectu navíc změřil schema `38/38`,
historické readery `6/6`, model-policy `36/36`, Studio VM `127/127`, CDP
`59/59` a non-visual Electron runner contract `16/16`. Replacement runtime
strom je byteově stejný a změnil pouze opravený test a Finding; proto se tyto
sady znovu nespouštěly.

## Hranice tvrzení

Standalone `chats/` raw settings autorita, WS SMTP injection a navazující
secret/reset práce zůstávají Finding 011 a frontou 027 → 028 → 026 → 029.
Finding 011 je `OPEN` a Gate 1 zůstává `BLOCKED`. Jedno přímé spuštění Electron
E2E skončilo ještě v bezpečném preflightu
`STUDIO_ELECTRON_BOUNDARY_BLOCKED artifact-root-missing`; Electron, build ani
produkt se nespustily. GPU, Ollama a externí síť neběžely.
candidateHead: 901bb6bad8db31304468c74391c93019f13f5a1e
reviewB.verdict: PASS
