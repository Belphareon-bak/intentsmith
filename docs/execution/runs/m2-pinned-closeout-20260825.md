# M2 pinned closeout candidate — 2026-08-25

- **Stav:** `IMPLEMENTATION_GREEN / PINNED_V1 / OPERATOR_REVIEW_PENDING`
- **Větev:** `codex/m2-integration-20260824`
- **Product revision:** `c070ed7383e522fb58b53a799cbbc0e16c4b09a7`
- **Push:** neproveden
- **Acceptance authority:** Decision 030 a operátorské review 7/7

Tento report dokládá připnutý M2 kandidát. Není to M2 acceptance ani tvrzení,
že celý deterministic gate prošel. Gate má pravdivě `verdict: FAIL` a
`exitCode: 1`; jeho přesně nezměněný zděděný baseline je samostatně přijatelný
pouze podle Decision 030.

## Připnuté kontraktové bajty

Všech sedm veřejných stage markerů má hodnotu `PINNED_V1` a literal test:

| Kontrakt | Git blob na product revision |
|---|---|
| `ProjectContextQuery/Snapshot@1` | `9f6a43dc2afcbd89d32eead119d56121009c0a9e` |
| `EffectRequest/Result + ApprovalGrant@1` | `37f5c65c0740e747855218738b01f82d9b003c22` |
| `ToolRequest/Result@1` | `ea2fc32f97217775adc30d2d4d8d841099d2530f` |
| `ProjectChangeRequest/Result@1` | `93ca18fd98a0059dbb5bebf27531617aa5b85d32` |
| `GovernancePolicy/Decision/Receipt@1` | `b71c6426daab9575b546fbf2a96e618bb1fb50d5` |
| `LifecyclePlan/Approval/Terminal@1` | `f4010093a91cf4031985716bcf4293e1b14a9c8b` |
| `RemoteCorePort@1` | `1b767199cdcd0ff696ee7975895d5bde9a9720d6` |

Připnutý RemoteCorePort descriptor digest je
`sha256:245abe3a13d7d60ac537c7672522872df20f855d990bee0f02b2826379b56c52`.
Oddíl 1 je interní project-path primitive a samostatný veřejný stage marker
nemá; jeho přesné bajty připíná product revision.

## Čistý deterministic gate

Příkaz:

```bash
npm run test:deterministic
```

Report:
`.intentsmith-artifacts/test-runs/2026-08-25T17-26-00-661Z/report.json`

| Pole | Hodnota |
|---|---|
| `sourceRevision` | `c070ed7383e522fb58b53a799cbbc0e16c4b09a7` |
| `verdict / exitCode` | `FAIL / 1` |
| výsledky | `260 PASS / 3 FAIL / 0 TIMEOUT / 2 BLOCKED / 0 SKIPPED` |
| vybrané programy | `265` (`database`, `offline`, concurrency 1) |
| M2 programy | `27 PASS / 0 non-PASS` |
| registry hash | `54dce9be3a18ef854097c5919d1471e53f38bf6ef0e828ecc5ff0438f9e302d2` |
| inventory fingerprint | `b2048d3c4e702aea3121611db49b9b7b8b9aa316639145ae2a7aef1f930735d4` |
| options fingerprint | `b6c9a55d1eef4edd4cd3c3fc691fe87947b8aad52dc7249c05af5a41fed7db4e` |

Přesný non-PASS set je zděděný a nezměněný:

- `BLOCKED` `IS-T1-TESTS-CHAT-EXPORT-BUDGET-TEST`;
- `BLOCKED` `IS-T1-TESTS-EXPORT-PDF-DOCX-TEST`;
- `FAIL` `IS-T1-TESTS-NIGHTLY-AUDIT-RUNNER-SELF-TEST`;
- `FAIL` `IS-T1-TESTS-NIGHTLY-ORCHESTRATOR-SELF-TEST`;
- `FAIL` `IS-T3-TESTS-VRAM-COORDINATION-TEST`.

Žádný M2 program není v non-PASS množině.

## Focused a cross-section evidence

Všech 31 registrovaných `tests/m2-*` programů bylo na připnutých bajtech
spuštěno. Dvacet sedm prošlo uvnitř clean gate. Čtyři mimo zvolený
`offline,database` profil byly spuštěny přímo a jsou zelené:

- project-change runtime `20/20`;
- process supervision `13/13`;
- exact Git preservation `13/13`;
- lifecycle application service `6/6`.

Samostatně prošly:

- sedm contract sad: `17/17`, `24/24`, `13/13`, `22/22`, `11/11`, `14/14`,
  `17/17`;
- schema migrations nad přesně 73 migracemi;
- M1 schema compatibility tip `083 / 73`;
- module-boundary ratchet `13/13`, přijatý graph `1 131` hran, 3 cykly a 28
  souborů v cyklech;
- artifact validation `154/154`;
- registry validation: 428 programů, 14 explicit exclusions.

## Přijaté closeout hranice

- neprovedený expirovaný nebo revokovaný grant může vzniknout jako terminální
  `cancelled` pouze bez execution claimu; replay UNIQUE hranice se
  nerozvolnila;
- další skutečný pokus používá novou operation/effect identitu, reconnect stejné
  generace je exact replay;
- standalone rollback A-prime pouze pozoruje digesty a zapisuje append-only
  receipt; standalone before-image ani slepý kompenzátor nevznikl;
- multi-file project-change dál používá vlastní durable `before_bytes`
  kompenzátor;
- RemoteCorePort je pouze contract/unavailable provider. Listener, pairing,
  autentizace, device authority a remote runtime nejsou M2;
- M2 acceptance čeká na sedm operátorských `REVIEW_PASSED` a integrační
  closeout. Mechanické připnutí ani focused green nejsou review PASS.

GPU, Ollama, síťové modelové běhy, coworkerovy procesy a cizí checkouty nebyly
pro tento closeout použity ani změněny.
