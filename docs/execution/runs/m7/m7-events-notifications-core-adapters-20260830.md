# M7 events + notifications core adapters — 2026-08-30

**Stav:** `IMPLEMENTATION_GREEN / FULL_OFFLINE_DATABASE_GATE_GREEN /
REVIEW_PENDING / PROVIDER_NOT_ACTIVE / TRANSPORT_ABSENT`

## Vazba

- vstupní evidence HEAD: `6688b8fd1fa47c05c923b657dfd1732745b9a83f`;
- implementace: `1231b27a46d31f9814083bba04b9522a57d6a064`;
- module-boundary ratchet: `f1b93dd675ff7eb0fa2ce8ab55b0dca3c106b342`;
- 7/7 composition proof: `e18d7df6aaeb4bc2a1e045be21b1e2fd09a065c9`;
- exact gate candidate: `277c7ee9d87c7507c56b4e4c15a30d0710a01eae`;
- candidate tree: `a0a4b9ac128a9f421f23746b83f1252442d35303`;
- branch: `codex/m7-mobile-contract-integration-20260829`, bez upstreamu;
- registry: 497 runnable, 403 ACTIVE / 79 BLOCKED / 15 HISTORICAL;
- `ACTIVE + required`: 398;
- profil `offline + database`: 337 (`269 + 68`);
- registry fingerprint:
  `7adffb2446dca9a292c6b635a345f8591923893e8a45a76e13ec05b96d51b2ee`.

## Milník A — run events

`m7-run-event-core-adapter.js` přijímá jen validovaný M1 `CoreEvent@1`. Událost
je content-addressed, partitionovaná trusted subjectem a runem a do remote read
modelu nepřenáší volný payload ani detail. Retence je bounded; klient, který
ztratí okno, dostane `REMOTE_EVENT_WINDOW_GONE` místo tiché mezery. Konfliktní
sequence zneplatní jen dotčený run. Long poll má exact-once completion a je
bezpečný i s injektovaným synchronně pálícím timerem.

WS session adapter má pouze volitelný observer skutečného validovaného eventu.
Observer není autorita odeslání, jeho chyba nezmění primární M1 výsledek a
žádný startup nebo listener mu observer nepředává.

## Milník B — notifications + durable ACK

Skutečná M3 `AgentRepository` může vydat jen closure-brandovaný úzký read port.
M7 nedostává CRUD, legacy HTTP route, body, volnou `data` ani globální
`read_at`. List je bounded, používá keyset paging a autorizuje každou položku
před i po čtení. Cursor postupuje podle poslední emitované sequence; skryté
řádky mezi viditelnými položkami se bezpečně znovu proskenují bez úniku dat.

ACK je povolen jen pro dříve pozorovanou položku, existující stejný subject a
device a dvě platná authority rozhodnutí před prvním durable efektem. Potom
projde M7 operation journalem. Migrace 107 ukládá exact canonical BLOB receipt,
váže jej na `STARTED notification.ack` intent a zakazuje UPDATE/DELETE.
Connection-local validační UDF se registruje při každém vytvoření adaptéru,
takže file-backed restart nespadne na chybějícím UDF. Replay vrací tentýž
výsledek a čtenost zůstává per-device.

## Milník C — pravdivá composition a ratchet

Default composition bez optional portů dál inzeruje `4/7`. Genuine M2 port
přidá approvals, genuine M1/M3 porty events a notifications. Test skládá všech
sedm skutečných capability, ale provider stále hlásí
`IMPLEMENTED_NOT_ACTIVE` a žádný listener nebo transport není importovaný.

Dvě nové sady jsou `ACTIVE`, `required` a součást deterministické fáze. M6 plan
má pro obě omission sentinel: odstranění programu z kopie plánu musí skončit
`plan:required-program-uncovered`. Nightly policy, self-test a registry
fingerprint byly přepnuté společně. Module ratchet přijal přesně šest nových
hran; graph má 1 241 hran, 3 cykly a 28 souborů v cyklech.

## Focused a compatibility evidence

| Hranice | Výsledek |
|---|---|
| run-event core adapter | `7/7 PASS` |
| notification core adapters | `8/8 PASS` |
| core composition | `8/8 PASS` |
| WS bridge | `88/88 PASS` |
| schema migrations | `55/55 PASS` |
| M1 schema oracle | `20/20 PASS` |
| M6 runtime evidence | `8/8 PASS` |
| M6 technical evidence | `8/8 PASS` |
| M6 candidate plan | `19/19 PASS` |
| module-boundary ratchet | `13/13 PASS` |
| artifact boundary | `158/158 PASS` |
| nightly self-test | PASS / exit 0 |
| registry validation | valid / 497 / exact fingerprint výše |
| `git diff --check` před gate | PASS |

## Souvislý offline + database gate

Všechny tři běhy mají stejný `sourceRevision`, registry hash a inventory
fingerprint `d4970aadd80a2d063da480c314358cce2ee444384231b44c5346f172eb38ae5a`.
Nejde o přebarvení jednoho reportu.

| Běh | Výsledek | Význam | SHA-256 reportu |
|---|---|---|---|
| `2026-08-29T22-21-07-181Z` | `329 PASS / 8 BLOCKED`, exit 2 | kontrola bez otevřených toolchainů; pět přesných tříd `python-pdf-runtime`, `git`, `bwrap`, `bubblewrap` a `prlimit` | `a3a17c498519a1046e41a41c1204b6b3f050a587b51ba64d62b31304275ef768` |
| `2026-08-29T22-25-04-826Z` | `335 PASS / 2 BLOCKED`, exit 2 | deklarované toolchainy povolené, ale PDF interpreter ještě nebyl předán procesu | `85a27a78853d4b29d7b9c3cf44c4173129130bf13dd4fdf6ba7446adc9d2d46a` |
| `2026-08-29T22-29-25-473Z` | `337 PASS / 0 non-PASS`, exit 0 | stejný plán s existujícím připnutým PDF runtime | `9f2b66269ed2f1cd296694271e6cb6c144dd6447082b7cb1a1d8892b591e5a4f` |

Finální raw report:

`.intentsmith-artifacts/m7-events-notifications-offline-database-final-20260830/2026-08-29T22-29-25-473Z/report.json`

Finální běh začal `2026-08-29T22:29:25.523Z`, skončil
`2026-08-29T22:33:21.750Z`, běžel nesouběžně a explicitně použil pouze profily
`offline,database`. Lokální PDF interpreter byl
`.intentsmith-artifacts/pdf-runtime/bin/python`. Live chat/model, Ollama, GPU,
síťový listener, fyzické zařízení ani produkční signing nebyly spuštěné.

## Limity

Tento řez není M7 acceptance ani M6 Gate 0. O-01/O-02/O-04 a nový registry
ratchet čekají na nezávislé review. Provider není aktivní, transport absent,
APK/AAB zůstávají pouze debug-signed current-host evidence. M5/M6 stále blokuje
offline key custody a skutečné operátorské receipts; rotace, history
disposition, demo, promotion, tag, publish ani push neproběhly.
