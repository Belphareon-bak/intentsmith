# 030 — obnova evidence obálky standalone chats bez přepsání historie

- **typ:** jednorázová governance/evidence recovery výjimka
- **stav:** `ACCEPTED 2026-08-12: M1-CHAT-EVIDENCE-RECOVERY-X1 + X1-a + X1-b`
- **integrationRef:** `integration/m1-consolidated-20260810`
- **invalid historical evidence `I`:**
  `39776f1e90e425bd91a7be707edc556a299869bd`
- **reviewed candidate `C_CHAT`:**
  `578876dd77c68df4bdcf6239383fa782b649f843`
- **governance ref:**
  `docs/m1-standalone-chats-evidence-recovery-20260812`
- **corrected evidence ref:**
  `evidence/m1-standalone-chats-decommission-review-b-corrected-20260812`
- **reconciliation ref:**
  `queue/m1-standalone-chats-evidence-reconciliation-20260812`
- **WP:**
  [`WP-M1-CHATS-EVIDENCE-RECOVERY`](../wp/WP-M1-CHATS-EVIDENCE-RECOVERY.md)

## Ověřený defekt

`I` má jediného rodiče `C_CHAT` a proti němu mění pouze
`docs/execution/runs/wp-m1-standalone-chats-decommission-20260812-report.md`.
Je tedy direct child správného candidate a nemění runtime ani source. Report ale
přidává `27` řádků místo přesně povolených dvou: nejprve 25 řádků narativu a
potom správné

```text
candidateHead: 578876dd77c68df4bdcf6239383fa782b649f843
reviewB.verdict: PASS
```

`CONTRACT.md` vyžaduje byte-shodu `before + lines.join("\n") + "\n"`.
Přítomnost správných dvou hodnot na konci proto nedělá `I` validní obálkou.
Ověřené Git objekty jsou:

| Objekt | Hodnota |
|---|---|
| `C_CHAT` tree | `84fdb68f28e95f067b6fe649bfc36823f0100dd6` |
| report blob na `C_CHAT` | `1707ce3fa81eb602e5ddf9d31f77a4be40365df8` |
| `I` tree | `898f88dc008d56f58195df8fa96e1942b9322d1b` |
| report blob na `I` | `700063b149e2a8683b4a447ef9481be356c79151` |
| správný report blob `X` | `04b839db53abcbce510a9d57d7b750f20e2c6f9d` |
| očekávaný root tree `X` | `118a7b5007cfcb75baad0ce894b2e3bbd5517e72` |

Správný report blob má přesně obsah z `C_CHAT` a za ním pouze uvedené dva
řádky. Očekávaný root tree vzniká náhradou jediného report blobu v tree
`C_CHAT`; žádný jiný blob se nemění.

## Zachovaný narativ z invalidního pokusu

Následující payload je verbatim všech 25 narativních řádků mezi reportem
`C_CHAT` a dvěma povinnými metadata řádky v `I`, včetně úvodního a koncového
prázdného řádku. Má `1345` bytes a SHA-256
`76d79c2cc44b63b31ce02f582465d53eb3344ae6b88ea1c576d743b9384a0172`.
Není součástí správného report blobu `X`; tato decision je jeho trvalé
governance umístění.

<!-- M1_CHAT_INVALID_NARRATIVE_BEGIN -->
```text

## Review B

Review B běžel v čistém disk-backed `git clone --no-local` nad exact immutable
candidate. První bounded attempt skončil `CHANGES_REQUIRED / harness-only`:
`lsof` zapisoval vlastní výstup dovnitř právě skenovaného test-owned artifact
rootu a pozoroval své vlastní otevřené soubory. Candidate tím nebyl vyvrácen;
nonzero výsledek se nezatajuje ani nepřepisuje na PASS.

Po explicitní autorizaci proběhl právě jeden nový corrected attempt. Jediná
změna harnessu přesunula `lsof` výstup do shell capture mimo skenovaný root.
Import sentinelu skončil exitem `0` bez stdout/stderr. Přímý start skončil
exitem `78`, stdout byl prázdný a stderr obsahoval právě jeden marker s LF;
jeho SHA-256 byl
`8cb740fc4e99efd6f47aa8836bcb1bdfbb024aab0fa2fcb14d4ea51baa994bc0`.

Manifest test-owned `sentinel.db`, `sentinel.db-wal`, attachment a unknown
souboru byl před importem, po importu a po přímém startu byteově shodný; SHA-256
manifestu byl pokaždé
`0a65ab74b92b95db640c6b929e1f1b5fa419512ab496dfa8b22322daacb1ddea`.
Po wait nezůstal žádný vlastněný proces, listener ani handle. Exact efemérní
artifact root byl po nulových handles odstraněn; žádná skutečná uživatelská
data nebyla čtena. Neběhl npm install, build, externí síť, Electron, GPU,
Ollama ani full-product test.

```
<!-- M1_CHAT_INVALID_NARRATIVE_END -->

První attempt zůstává pravdivě `CHANGES_REQUIRED`; pozdější opravený attempt
jej nemaže ani nepřeznačuje. Plné digesty stderr markeru a byteově stabilního
manifestu jsou součástí výše zachovaného verbatim payloadu.

## Přijatá recovery topologie

Proměnné znamenají:

- `G_REC` — vlastní docs-only governance commit obsahující tuto decision,
  contract amendment a statický recovery WP; je přímý potomek `I`;
- `X` — nový správný `E_B_CHAT`, přímý potomek `C_CHAT`;
- `R_REC` — jednorázový reconciliation promotion carrier.

Povinný DAG je:

```text
C_CHAT = 578876dd77c68df4bdcf6239383fa782b649f843
├── I = 39776f1e90e425bd91a7be707edc556a299869bd
│   └── G_REC ────────────────────────────────┐
└── X (correct E_B_CHAT) ─────────────────────┴── R_REC
```

Platí všechny následující piny:

1. `G_REC` vznikne na governance refu jako direct child `I`, smí měnit pouze
   devíticestný governance allowlist uvedený ve statickém WP a skutečně změní
   jeho exact osmícestný subset bez Findingu 011. Finding 011 zůstane proti `I`
   byte-identický, aby všech dvanáct reset-relevantních cest zůstalo mezi `I`
   a `R_REC` beze změny. Před prvním zápisem `X` projde `G_REC` nezávislým
   review; `writer != reviewer`.
2. `X` má právě jednoho parenta, exact `C_CHAT`. Mezi nimi se mění pouze
   rezervovaný chats report. Report blob `X` je exact
   `04b839db53abcbce510a9d57d7b750f20e2c6f9d`, root tree `X` je exact
   `118a7b5007cfcb75baad0ce894b2e3bbd5517e72` a
   `assert_report_append C_CHAT X` projde pouze pro exact `candidateHead` a
   `reviewB.verdict: PASS` uvedené výše.
3. Opravený behavior Review B se znovu nespouští. `C_CHAT`, source/runtime
   tree a již získaný corrected PASS jsou totožné; recovery spouští pouze
   read-only Git metadata/blob/path gates.
4. `R_REC` je merge commit s přesným pořadím parentů `[G_REC, X]`. Report blob
   na `R_REC` je byte-identický s report blobem `X`, tedy
   `04b839db53abcbce510a9d57d7b750f20e2c6f9d`. Každá jiná cesta na `R_REC` je
   byte-identická s `G_REC`; tím se zachovají governance změny a runtime/source
   zůstane shodný s `C_CHAT`.
5. Report na `R_REC` nesmí použít `700063b149e2a8683b4a447ef9481be356c79151`
   ani jinou 27řádkovou verzi z `I`. `I` zůstane dosažitelné pouze jako
   historická invalid evidence, nikoli jako obsah canonical tipu.
6. Canonical integration se posune výhradně fast-forwardem
   `I -> G_REC -> R_REC`. Žádný rebase, cherry-pick, amend, force-push nebo
   history rewrite není povolen.
7. Teprve metadata-ověřený a fast-forward promováný `R_REC` je jediný povolený
   `baseRevision` pro `WP-M1-SETTINGS-RESET-AUTHORITY`. Původní `I`, samotný
   `G_REC` ani samotný `X` reset odemknout nesmějí.

## Hranice tvrzení

Toto rozhodnutí neopakuje behavior Review B, nemění jeho PASS, nemění support
claim, source, runtime, auth/access boundary ani data. Neopravuje obecně
`CONTRACT.md` pro libovolnou chybnou obálku. Povoluje jediný výše připnutý DAG,
protože canonical integration už fast-forwardla na invalidní docs-only `I` a
správný sibling `X` z ní bez přepsání historie fast-forwardem vzniknout nemůže.

## Přijatý potvrzovací blok

```text
M1-CHAT-EVIDENCE-RECOVERY-X1: ACCEPTED
X1-a: PRESERVE-25-NARRATIVE-LINES-VERBATIM-IN-GOVERNANCE
X1-b: R-REPORT-BYTE-IDENTICAL-X-CORRECT-TWO-LINE-APPEND
recovery-history: NO-REWRITE-INTEGRATION-FAST-FORWARD-ONLY
recovery-review-b: REUSE-CORRECTED-PASS-NO-RERUN
recovery-reset-base: R_REC-ONLY
```
