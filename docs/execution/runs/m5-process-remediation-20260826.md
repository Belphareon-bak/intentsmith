# M5 PROCESS — adversariální remediation evidence

- **Původní review candidate:** `94ea4ea715d0019f66b47a039872aefbee2a9daa`
- **Remediation product commit:** `7a282a3fc58ca8d151d2070ea041d952efe9aaf2`
- **Stav oddílu:** `IMPLEMENTATION_GREEN / RE_REVIEW_REQUIRED`
- **Push:** neproveden

Tento řez opravuje `M5-R08` až `M5-R10`. Není to nezávislý re-review, M5
acceptance ani povolení otevřít M6 gate.

## R08 — orphan terminalita a outstanding fence

Runtime odvozuje termination pouze z explicitního `processGroupState: empty`
nebo stejného exact cleanup důkazu. `orphaned` tento důkaz nikdy nepřebije.
Pokud recorded supervisor zůstane outstanding, runtime:

1. nezapíše `process_terminated`;
2. nezapíše parent terminal;
3. nespustí file rollback;
4. ponechá durable process row a aplikovanou after-image pro restart.

Regrese pak provede generation-two takeover: `linux-pidfd-v1` nejprve doloží
empty group, teprve potom vznikne termination event a rollback vrátí before
image. Focused provider se znovu nespustí.

## R09 — úplný startup-census guard

Jediný `requireRecoveryCensusComplete()` guard běží před prepare, před approval
již existujícího plánu a znovu uvnitř `runApproved()`. Recovery pass dostává
module-local `Symbol`, který volající přes API nemůže dodat. Restartová regrese
prokazuje, že approval před censem nevytvoří approval intent ani grant set,
nespustí provider a nezmění projekt; po úplném censu stejný exact plán projde.

## R10 — kernelově stabilní signal authority

Produkční recovery už nevolá `process.kill()` nad PID/PGID po odděleném
`/proc` checku. Exact `/usr/bin/python3` helper otevře Linux pidfd, pak pod
stále otevřeným fd znovu ověří boot ID, start identity, leader PID a PGID a
drží pidfd přes TERM, KILL i finální empty census. PID reuse regrese připne
živý cizí proces s odlišným start identity a ověří nulovou signalizaci; skutečná
TERM-resistant detached group projde KILL eskalací a skončí empty.

Installer fail-closed vyžaduje `/usr/bin/python3` s `os.pidfd_open`; DATA
závislost `/usr/bin/fuser` je ve stejném podporovaném Linux preflightu. Nový
`.py` helper je zahrnutý do distribučního privacy content manifestu.

## Důkazy

| Ověření | Výsledek |
|---|---:|
| `node tests/m5-process-hardening.test.js` | `8/8 PASS` |
| `node tests/m2-execution-process-supervision.test.js` | `13/13 PASS` |
| `node tests/m2-execution-authority-repository.test.js` | `14/14 PASS` |
| `node tests/m2-execution-project-change.test.js` | `23/23 PASS` |
| `node tests/m2-lifecycle-application-service.test.js` | `7/7 PASS` |
| `node tests/m5-install-profile.test.js` | `9/9 PASS` |
| `node tests/m5-privacy-remediation.test.js` | `15/15 PASS` |
| `node tests/module-boundary-ratchet.test.js` | `13/13 PASS` |
| `node tests/artifact-validation.test.js` | `154/154 PASS` |
| `node tests/repository-hygiene.test.js` | `1846 tracked paths / PASS` |
| exact-HEAD privacy scan | `1846 tracked / 981 content-read / 0 findings` |
| `git diff --check` | `PASS` |

Privacy verdict zůstává pravdivě
`PASS_CURRENT_TREE_HISTORY_STILL_REACHABLE`: všech 13 incident objektů je stále
dosažitelných. Úplný deterministický gate se v průběžném bloku nespouštěl;
poslední připnutý historický stav je `284 PASS / 2 FAIL / 2 BLOCKED`, `verdict:
FAIL`, `exitCode: 1`.
