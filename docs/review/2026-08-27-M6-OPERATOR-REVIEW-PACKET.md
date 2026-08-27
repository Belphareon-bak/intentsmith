# M6 operator review packet — 2026-08-27

## Review jednotka

- **Požadovaný reviewer:** operátor; lokální Opus se podle Decision 036
  nepoužívá.
- **Product range:** `55938fd0628bdb725736acdf21a451854580aaa7..8abd6065bd614a15bf9f7814dea14ed1e040c616`.
- **Candidate:** `8abd6065bd614a15bf9f7814dea14ed1e040c616`.
- **Tree:** `f41a6af70b29d9024ba1006aabe417aad2ff26aa`.
- **Registry fingerprint:**
  `3593af7c529d73c15cc3f12ee7e4e90fd2de91e6b383313ac43bca46969ea342`.
- **Review stav:** `PENDING`; tento dokument není self-issued verdict.
- **Technická evidence:** 311/311 required program results PASS, 13/13 L0
  PASS, conditional 1/1 PASS, release validator valid/BLOCKED/exit 2.

Pozdější closeout commit smí být pouze evidence-only descendant. Produktové
review se vždy váže k výše uvedenému candidate SHA, ne k dokumentačnímu HEAD.

## Oddíl 1 — baseline a locked candidate plán

Ověřit:

- `contracts/m6/candidate-plan-v1.js`, `src/release/m6-candidate-plan.js` a
  `scripts/run-m6-candidate-evidence.js` přijímají nulové argumenty,
  concurrency 1 a úplný odvozený required set;
- PDF/export, nightly/orchestration a VRAM sady nejsou falešně přesunuté do
  BLOCKED a registry fingerprint odpovídá exact candidatu;
- duplicate, reordered, omitted, external-network nebo dirty plán selže.

Evidence: `296/296 PASS`; registry 464 programů; focused candidate-plan `6/6`.

## Oddíl 2 — release kontrakt, evidence a artifact binding

Ověřit:

- `M6ReleaseValidation@1` odmítá forged SHA, dirty tree, chybějící report,
  změněný digest/counter/log a ne-evidence-only descendant;
- release artifact kopíruje skutečné production build bytes a validuje mode,
  size, digest i source candidate;
- sedm rolí manifestu přesně odpovídá buildu; artifact row se povýší na PASS
  až po validaci copied manifestu.

Evidence: manifest SHA-256 `6bc3bee3…979c`, frontend `9d3fe00c…aab0`, release
artifact focused `4/4`.

## Oddíl 3 — server, WS, Studio a M1 journey

Ověřit:

- owned server má skutečný auth transport a není pouze in-process unit;
- Studio boundary používá negotiated `m1-wire-v1`, exact correlation a jediný
  terminal; raw legacy chat, provider/effect bypass a neočekávaný egress jsou
  nulové;
- fresh clone je standalone detached checkout exact candidatu, offline install
  a production build, nikoli sdílený worktree/node_modules důkaz.

Evidence: server `1/1 PASS`, fresh clone `3/3 PASS`; M1 HTTP p95 30 ms, cold
27 795 ms, warm p95 52 445 ms, 0 Studio external attempts.

## Oddíl 4 — effect, approval, security, data a recovery

Ověřit skutečné call graphy a finální serializované terminály pro:

- approval/effect authority, cancellation, timeout, orphan/recovery a rollback;
- process census a startup fence;
- auth mixed credentials, outbound redirect/capability boundary;
- SQLite backup/restore/WAL/SHM a lock ownership.

Required mapping je v `src/release/m6-technical-evidence.js`; příslušné
deterministické i controlled-soak programy musí být v reportech PASS.

## Oddíl 5 — specialist, agent, skill, learning a conditional platforma

Ověřit:

- platform journey vede přes native extension authority, nikoli odstavené
  legacy mutation routes;
- specialist/agent/skill efekty zůstávají za M2 authority;
- learning je proposal + user gate + verzovaný same-project context;
- jediná enabled/supported conditional plocha je model discovery a její
  journey je odvozena z manifestu, ne ručně připsaná.

Evidence: `M6-JOURNEY-MODEL-DISCOVERY-V1 PASS`, M6 platform journey PASS.

## Oddíl 6 — RemoteCorePort, upgrade a recovery boundaries

Ověřit:

- remote adapter svazuje exact request/revision/query/budget a nemá listener,
  pairing ani legacy remote bypass;
- unsupported conditional startupy fail-closed používají stejný normalizovaný
  manifest jako preflight;
- install/upgrade, schema, backup/restore a release artifact používají přesné
  current-candidate bytes.

Remote companion runtime zůstává M7 a nesmí být do M6 PASS přičten.

## Oddíl 7 — soak, GPU a všech 13 L0

Ověřit:

- deset soak programů je sériových a cleanup neuniká;
- GPU preflight a quiescence jsou read-only; runner nepoužívá `ollama stop`;
- protected `/proc/PID/exe` větev přijímá pouze `EACCES` spolu s exact NVIDIA
  process path, `argv[0]`, UID 997, model/mmproj blobem, loopback/offline a
  připnutým model ID; cizí/multiple/unreadable identity selže;
- fyzický pilot začíná až na nulovém compute censu a po doběhu přirozeně vrátí
  sdílený GPU stav;
- `L0-1` až `L0-13` mají pojmenované program IDs, content-addressed artefakty a
  žádný missing/failed výsledek.

Evidence: soak `10/10 PASS`; GPU `1/1 PASS`, peak 17 937 MiB, restored free
23 082 MiB; quiescence PASS za 45 991 ms; L0 `13/13 PASS`.

## Oddíl 8 — acceptance authority a pravdivý closeout

Ověřit:

- technický producer si nemůže vystavit M5 acceptance, `actorType=user`,
  independent review, Gate 0 ani operator demo;
- acceptance promotion vyžaduje exact candidate/evidence/review/demo chain a
  povoluje jen evidence-only descendant;
- `BLOCKED` se nepřekládá na PASS a exit 2 je odlišený od technického FAIL;
- žádný push, merge, tag, publish, rotace ani history rewrite není součástí
  tohoto kandidáta.

## Požadovaný výstup review

Reviewer připne verdict k exact `8abd6065bd614a15bf9f7814dea14ed1e040c616`:

```text
M6_SECTION_1 .. M6_SECTION_8 = REVIEW_PASSED | CHANGES_REQUESTED
M6_TECHNICAL_REVIEW         = REVIEW_PASSED | CHANGES_REQUESTED
```

`REVIEW_PASSED` uzavře pouze M6 technické review. M6 zůstane
`ACCEPTANCE_BLOCKED`, dokud nejsou samostatně doložené M5 9/9 + 8/8 rotací +
history disposition, Gate 0 attestation a operator demo/approval. Při změně
product candidate SHA review automaticky pozbývá platnost.
