# WP-M1 portable settings security repair — source candidate evidence

baseRevision: `06e760bb04933a97857ea0ab25a397914b47e60e`

sourceRevision: `4ba38dd9c295558dc0b241cfdf5bda21a9fd2526`

reviewState: `AWAITING_REVIEW_A`

freshCloneState: `NOT_RUN`

## Výsledek

Předchozí schema-v1 blacklist dvou názvů nebyl bezpečná portable boundary.
Tento opravný subject jej nahrazuje jediným backendovým default-deny profilem,
bezpečně projektovanou v1/raw kompatibilitou a exact importní receipt validací
ve všech třech nalezených first-party UI consumerech.

Jde o lokálně ověřený source candidate, nikoli Review A, fresh-clone evidence
ani uzavření Gate 1. Historický PASS nad schema v1 je v tomto tvrzení
superseded, historie se nepřepisuje.

## Lokální pre-commit evidence

| Příkaz | Výsledek | Exit |
|---|---:|---:|
| `node tests/m1-model-policy.test.js` | 35 passed, 0 failed | 0 |
| `node tests/m1-studio-client.test.js` | 122 passed, 0 failed | 0 |
| `node tests/routes-smoke.test.js` | 109 passed, 0 failed | 0 |
| `node tests/schema-migrations.test.js` | 38 passed, 0 failed | 0 |
| `node tests/artifact-validation.test.js` | 151 passed, 0 failed | 0 |
| `node tests/repository-hygiene.test.js` | 1 547 tracked paths | 0 |
| `node scripts/validate-test-registry.js --json` | 378 programs, 8 exclusions; fingerprint `cb1259ca55a95ecb32bc1831fca37249c449f880c36c9f1506072fdce8d06e15` | 0 |
| syntax check šesti změněných runtime JS modulů | valid | 0 |
| `git diff --check` | bez whitespace chyb | 0 |

Ratchet před source commitem skončil očekávaně červeně: baseline 1 023,
aktuální graf 1 024, exit `1`, jediná přidaná hrana
`src/db/model-policy.js -> src/db/settings-portability.js`. Baseline se nesmí
přijmout proti dirty stromu; exact edge přijme až samostatný follow-up commit
nad čistým source SHA.

## Post-source ratchet checkpoint

Po commitu source subjectu byl strom čistý. Explicitní writer přijal pouze
hranu `src/db/model-policy.js -> src/db/settings-portability.js` a zapsal
`sourceRevision = 4ba38dd9c295558dc0b241cfdf5bda21a9fd2526`.

| Příkaz | Výsledek | Exit |
|---|---:|---:|
| `node scripts/module-boundary-ratchet.mjs` | 1 024/1 024; added 0, removed 0; provenance 0 commitů za source | 0 |
| `node tests/module-boundary-ratchet.test.js` | 13 passed, 0 failed | 0 |
| `node tests/m1-model-policy.test.js` | 35 passed, 0 failed | 0 |
| `node tests/m1-studio-client.test.js` | 122 passed, 0 failed | 0 |
| `node tests/artifact-validation.test.js` | 151 passed, 0 failed | 0 |
| `node tests/repository-hygiene.test.js` | 1 551 tracked paths | 0 |
| `node scripts/validate-test-registry.js --json` | 378 programs, 8 exclusions; fingerprint beze změny | 0 |
| `git diff --check` | bez whitespace chyb | 0 |

Tato druhá tabulka není fresh-clone evidence: běžela ve stejném izolovaném
worktree nad commitnutým source SHA a jedinou nezapsanou změnou ratchet
baseline. Jejím účelem je doložit přesné přijetí nové importní hrany, ne
opakovat celoproduktovou validaci.

## Negativní a mutační signál

- Po jediné dočasné mutaci, která pro v1/raw znovu materializovala všech
  jedenáct defaultů namísto source-derived sparse subsetu, backend sada skončila
  34 passed / 1 failed, exit `1`. Selhal přesně test, který chrání destination
  portable hodnoty před tichým přepsáním. Mutace byla vrácena.
- Po jediné dočasné mutaci Center Views exportu z canonical
  `/api/settings/backup` na `/api/system/info` Studio sada skončila
  120 passed / 2 failed, exit `1`: endpoint oracle a source-boundary guard.
  Mutace byla vrácena.
- Během read-only pre-commit auditu se ukázalo, že porovnání path listu přes
  `join(delimiter)` přijímá forged kratší seznam s delimiterem uvnitř prvku.
  Oprava ve všech třech consumerech porovnává délku i každý string; focused sada
  obsahuje comma i NUL collision variantu a končí 122/0.
- Tři async testy, které dříve běžely po `summary()` bez top-level `await`, jsou
  nyní skutečně součástí výsledku. Samostatná reprodukce starého harness vzoru
  vytiskla pozdní failure při exit `0`; aktuální sada čeká na všech 122 testů.

## Hranice tvrzení

Neběžela skutečná Ollama, GPU, external network, Electron ani fresh clone.
Obecný secret-bearing `GET/POST /api/settings`, legacy whole-row/RMW writery a
chybějící společná revision/CAS authority zůstávají P1
[Finding 011](../../findings/011-user-settings-authority-and-secret-exposure.md).
Proto Gate 1 zůstává `BLOCKED` i v případě, že tento bounded repair projde
nezávislým review.
