# M6 technical candidate closeout — 2026-08-27

> **SUPERSEDED / HISTORICAL.** Operátorský review kandidáta `8abd6065` vyvrátil
> `TECHNICAL_IMPLEMENTATION_PASS`: plán nepokrýval celý ACTIVE+required set,
> finální evidence důvěřovala self-asserted gitignored JSON a deset deklarovaných
> „soak“ programů nebylo skutečným dlouhým měřením. Dokument níže zachovává
> historické bajty, ale není aktuálním verdict ani release podkladem.

## Verdikt a identity

- **Produktový stav:** `CANDIDATE_COMPLETE / TECHNICAL_IMPLEMENTATION_PASS`.
- **Release stav:** `REVIEW_PENDING / ACCEPTANCE_BLOCKED`.
- **Product candidate:** `8abd6065bd614a15bf9f7814dea14ed1e040c616`.
- **Candidate tree:** `f41a6af70b29d9024ba1006aabe417aad2ff26aa`.
- **Implementační range:** `55938fd0628bdb725736acdf21a451854580aaa7..8abd6065bd614a15bf9f7814dea14ed1e040c616`.
- **Rozsah:** 17 commitů, 46 změněných souborů, 5 027 insertions a 152 deletions.
- **Branch:** `codex/m6-release-20260827`, bez upstreamu; nic nebylo pushnuto.
- **Registry:** 464 runnable programů, fingerprint
  `3593af7c529d73c15cc3f12ee7e4e90fd2de91e6b383313ac43bca46969ea342`.

`TECHNICAL_IMPLEMENTATION_PASS` znamená, že všechny implementací vlastněné
produktové řádky a L0 důkazy jsou zelené. Neznamená M5 acceptance, nezávislé
review, Gate 0 attestation, operator demo, merge, tag, publish ani release.

## Osm implementačních bloků

1. **Release baseline.** Required PDF/export sady jsou ACTIVE nad explicitním
   offline Python runtime, orchestration self-testy odpovídají current registru
   a test fixture runtime je časově omezený bez oslabení produkční cesty.
2. **Executable manifest a candidate binding.** `M6ReleaseValidation@1`, locked
   plan, content-addressed evidence a dirty/mismatched candidate guards vážou
   každý report k jedinému SHA a registry fingerprintu.
3. **Server/WS/Studio a řízené efekty.** Owned production server, skutečný
   `m1-wire-v1` Studio klient, effect/approval/security/data/recovery programy a
   terminální negativní větve jsou součástí required matice.
4. **Platform journeys.** Specialist, extension agent, skill, learning,
   `RemoteCorePort` a model-discovery conditional surface mají pojmenované
   runtime konzumenty a executable journey.
5. **Upgrade a recovery.** Required set zahrnuje instalaci, release build,
   schema, backup/restore, locking a upgrade hranice.
6. **Sekvenční model/GPU/soak.** Producer zakazuje argumenty i concurrency,
   provádí read-only GPU census, čeká bez intervence na přesně identifikovaný
   Ollama worker a fyzický pilot spustí až nad prázdným GPU stavem.
7. **L0 evidence.** `L0-1` až `L0-13` se odvozují z konkrétních program IDs a
   content-addressed reportů; všechny jsou PASS.
8. **Oddělená acceptance authority.** Product evidence nemůže sama vytvořit
   M5 acceptance, user review, Gate 0 ani operator demo. Promotion vyžaduje
   externí, exact-candidate receipts a evidence-only descendant.

## Finální candidate evidence

| Fáze | Výsledek | Doba / poznámka |
|---|---:|---|
| deterministic offline + database | `296/296 PASS` | exit 0, 0 timeout/blocker/leak |
| owned production server | `1/1 PASS` | global HTTP/WS auth journey |
| controlled soak | `10/10 PASS` | concurrency 1, čistý cleanup |
| detached fresh clone | `3/3 PASS` | offline install, production build, M1 + 2 Electron journeys |
| physical Ollama/GPU | `1/1 PASS` | 314 444 ms, čistý source a cleanup |
| L0 | `13/13 PASS` | žádný missing/failed program |
| conditional journeys | `1/1 PASS` | `M6-JOURNEY-MODEL-DISCOVERY-V1` |
| release evidence | `11 PASS / 4 BLOCKED` | artifact PASS; blokují externí autority |

Celkem bylo v pěti execution fázích spuštěno 311 disjunktních required
programů a všechny skončily PASS. Autoritativní reporty jsou pod
`.intentsmith-artifacts/m6/candidate-8abd6065bd614a15bf9f7814dea14ed1e040c616/`;
globální projekce je `.intentsmith-artifacts/m6/release-evidence.json`.

## Měřené runtime výsledky

Fresh-clone M1 Studio → server → SQLite → Ollama journey:

- deterministické HTTP p95: `30 ms`;
- model cold: `27 795 ms`;
- model warm p95: `52 445 ms`;
- provider requesty: `9`, exact `qwen3.5:27b`;
- pozorované `num_ctx`: pouze `1024` a `4096`;
- neočekávaný Studio egress: `0`.

Fyzický GPU pilot na NVIDIA GeForce RTX 3090:

- model ID: `7653528ba5cb`, exact model blob
  `sha256-d4b8b4f4c350f5d322dc8235175eeae02d32c6f3fd70bdb9ea481e3abb7d7fc4`;
- cold `9 930 ms`, warm `529 ms`, classify `757 ms`, cancel `764 ms`;
- peak VRAM `17 937 MiB`;
- přirozené obnovení sdíleného GPU stavu za `302 254 ms`;
- před pilotem guard čekal `45 991 ms` bez intervence a skončil s nulovým
  compute procesem a `23 082 MiB` volné VRAM.

## Release artifact

Fresh clone vyrobil sedm přesně připnutých výstupů: frontend bundle, preload,
backend main, Electron main, ripgrep, M1 consumer a M1 protocol. Manifest má
2 952 bytes a SHA-256
`6bc3bee3d664abbcbdeb297abeb8c70201481f51cac652ca98d6fe3713bd979c`.
Frontend bundle má 11 776 467 bytes a SHA-256
`9d3fe00cb080b96ce7524b2b8270ed82daed8b47d3a1e8198c548ecb7684aab0`.

## Nálezy během integračního běhu

- Původní Electron boundary posílal raw legacy chat frame. Test byl přepojen
  na skutečný negotiated `m1-wire-v1` consumer a nově zakazuje legacy zprávy.
- Fresh clone neuměl čistě z lokálních cache materializovat Electron toolchain
  a headers. Offline install/build nyní používá pouze pojmenované cache vstupy.
- Ollama registrace a NVIDIA compute mají přechodové pořadí a host chrání
  `/proc/PID/exe` přes `EACCES`. Guard nyní přijme jen přesnou shodu NVIDIA
  cesty, `argv[0]`, UID, model/mmproj blobu, loopback/offline režimu a model ID;
  cizí, duplicitní či nečitelná autorita dál selže fail-closed. Každý neúspěch
  zapisuje receipt.
- Jeden candidate pokus pravdivě zčervenal na hygiene self-testu kvůli mnou
  zachovanému focused runtime. Runner byl ukončen, oba moje diagnostické
  adresáře byly beze smazání přesunuty do
  `.intentsmith-artifacts/m6-diagnostics/harness-runtime-contamination-8abd6065/`
  a čistý opakovaný běh prošel 296/296.

Žádný z červených diagnostických běhů se nepočítá jako release evidence.

## Samostatná validace a otevřené autority

`node scripts/validate-m6-release.js` nad product candidatem vrátil:

```text
valid: true
verdict: BLOCKED
exitCode: 2
errors: []
```

Čtyři release řádky zůstávají správně BLOCKED:

1. M5 acceptance: 4/9 oddílů čekají na re-review, chybí skutečných 8/8 rotací
   a history disposition receipt;
2. M6 independent read-only review nad exact product candidatem;
3. Gate 0 attestation svazující kandidát, evidence, review a demo;
4. operator demo a explicitní release approval.

Review packet je
[`2026-08-27-M6-OPERATOR-REVIEW-PACKET.md`](../../review/2026-08-27-M6-OPERATOR-REVIEW-PACKET.md).
Bez výslovného dalšího pokynu nebyl proveden push, merge, tag, publish,
credential rotation ani Git history rewrite.
