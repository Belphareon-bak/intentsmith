# M6 remediation — re-review packet

- **Stav:** `IMPLEMENTATION_CHECKPOINT / REREVIEW_REQUIRED / ACCEPTANCE_BLOCKED`
- **Původní review target:** `fe3735fa0126db3e037bedf2292d18187aa98597`
- **Nový product candidate:** `51fb6f25e41add21edea6dd3551587a85d0fc4b3`
- **Review range:** `fe3735fa0126db3e037bedf2292d18187aa98597..51fb6f25e41add21edea6dd3551587a85d0fc4b3`
- **Branch:** `codex/m6-release-20260827`, bez upstreamu, nic nebylo pushnuto
- **Model/GPU:** všechny live chat/LLM, Ollama, fyzické GPU a model-quality acceptance běhy jsou odložené rozhodnutím operátora

Tento checkpoint neříká `REVIEW_PASSED`, `M6_COMPLETE` ani `ACCEPTED`.
Uzavírá pět implementačních tříd z review a dvě další převádí z false-green
na pravdivý release blocker.

## Odpověď na nálezy

| Review nález | Kandidátní stav | Důkaz |
|---|---|---|
| C1 producer nenačítá log bytes | **opraveno / re-review required** | producer načte exact regular bytes každého logu; `308/308` reálných logů bylo načteno jako `Buffer`; evaluator vyžaduje exact log set a digest |
| C2 unsigned acceptance receipts | **rozhodnutí otevřené / release blocked** | lokální promotion zůstává zakázaná pro acceptance; volba Ed25519 versus externí verifier je operátorská authority decision |
| C3 L0 false-green | **false-green opraven / invarianty stále blocking** | passing programy již nemohou samy vydat semantic `VERIFIED`; L0-11 je `OPEN_VIOLATION/FAIL`, L0-12 `PARTIAL/NOT_RUN`, L0-13 `VERIFIED` |
| C4 M5 privacy same-process bypass | **rozhodnutí otevřené / M5 blocked** | WeakMap/UDF se nepovažuje za opravenou hranici; L0-11 i M5 acceptance zůstávají červené, dokud nebude autorita mimo zapisovatelnou DB nebo nebude local promotion retired |
| C5 `finishReason:length` jako success | **opraveno / re-review required** | centrální finalizer hází `MODEL_RESPONSE_TRUNCATED` před scoringem/persistence; HTTP `502`, M1 WS exact `error`, žádný assistant turn |
| C6 phase/runner/deletion/artifact binding | **opraveno / re-review required** | exact ordered phase+runner+program+log set, D/T/deletion fail-closed, fresh-clone artifact až po runtime journeys |
| C7 failed-upgrade recovery | **opraveno / re-review required** | skutečný 136.0 → backup → failed partial upgrade 56→76 → exact restore na 56 → úspěšný upgrade na 79; raw receipt je Git-pinned vedle tohoto packetu |
| C8 stale registry docs | **opraveno / re-review required** | `469` programů, fingerprint `e85370f224316ca8ff044f92f9f8c7e6623701f5325fe354f093905fc47b8071`, validator PASS |

## Přesná focused evidence

| Program | Výsledek |
|---|---:|
| M1 chat contract | `29/29` |
| WS bridge | `88/88` |
| M6 candidate plan | `16/16` |
| M6 release validation | `13/13` |
| M6 technical evidence | `8/8` |
| M6 L0 evidence | `7/7` |
| M6 runtime evidence | `7/7` |
| M5 data/restore | `18/18` |
| module boundary ratchet | `13/13`, `1192` hran, `3` cykly / `28` souborů |
| schema migrations | `38/38`, `79` migrací |
| artifact validation | `155/155` |
| registry validation | `PASS`, `469` programů |
| `git diff --check` | `PASS` |

Skutečný clean-candidate upgrade/recovery journey skončil `exit 0` a emitoval
[`M6-PREVIOUS-VERSION-UPGRADE-RECEIPT.json`](../execution/runs/m6/M6-PREVIOUS-VERSION-UPGRADE-RECEIPT.json).
Je vázaný na candidate `51fb6f25`; předchozí dirty diagnostický receipt není
release evidence.

## Co se záměrně netvrdí

- Nebyl spuštěn celý 469-programový gate.
- Nebyl spuštěn 24h soak ani finální pětiminutový candidate throughput běh.
- Nebyly spuštěny live chat/LLM, Ollama, fyzické GPU ani model-quality sady.
- M5 privacy zůstává `8/9 REVIEW_PASSED / PRIVACY CHANGES_REQUIRED`.
- M6 acceptance chain, operator demo, skutečné rotace a history disposition
  zůstávají `BLOCKED/NOT_RUN`.
- Starší diagnostika 78 turnů zůstává pouze diagnostikou: 78/78 v limitu,
  77/78 obsahově úplných, jediný problém full one-pager, expert 39/39; cap
  full-deliverable 1024. Není to model acceptance pro nový candidate.

## Požadavek na re-review

1. Reviewovat exact range a produkční call graph, ne pouze testy.
2. U C1 ověřit, že producer čte skutečné log bytes před evaluací a že relabel
   mezi fázemi nebo runnery selže.
3. U C5 trasovat provider `finishReason` přes finalizer, persistence, HTTP a
   M1 WS terminál.
4. U C7 ověřit receipt v3, statickou migrační identity discovery a skutečný
   failed-upgrade → restore → successful-upgrade round-trip.
5. C2 a C4 neposuzovat jako opravené; vraťte jejich technickou preferenci pro
   operátorské rozhodnutí. L0-11/12 mají zůstat release-blocking.

Požadovaný výstup je verdict po jednotlivých osmi oddílech, seznam blockerů a
explicitní potvrzení, že odložené model/GPU/24h běhy nebyly přeloženy do PASS.
