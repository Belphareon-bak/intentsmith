# WP-M2-EXECUTION-V1 — Claude Opus max review

- **oddíl:** M2 5/7
- **reviewer:** lokální Claude Opus, `--model opus --effort max`
- **režim:** read-only `--permission-mode plan --no-session-persistence`
- **provenance range:** `a35805ee79b778638151c608eaf29afec6d7df3b..da8698ffec6ce56e90603f05d55ec6644f6c4a29`
- **současné product bytes:** `61e09d47298c3d24b0bb7ba6fef7f2940553ec49`
- **verdict:** `CHANGES_REQUESTED`
- **původní modelový výstup:** `/home/belphareon/.claude/plans/perform-an-independent-read-only-snuggly-ladybug.md`
- **SHA-256 původního výstupu:** `95dc075dee5fce2c970d4c25c31e64a64aa3d608d2546cb8912d8c98518a9c5a`

Tento dokument je repo-local záznam prvního dostupného povinného review. Není
to `REVIEW_PASSED`; celý přesný section scope musí být po opravě revidován
znovu.

## Ověřené bez blokujícího nálezu

Opus neomezil review na testy. Přímými sondami ověřil prázdný mount root a
read-only hranice `linux-bwrap-ro-v2`, uzavření FD 4/5/6, x64/arm64 cBPF arch
guard, x32 kill, runtime `Seccomp: 2`, `NoNewPrivs: 1`, `CapEff: 0`, zákaz
socket/connect/keyctl/io_uring, zákaz nested user namespace, absenci controlling
TTY, exact Git CAS/literal paths/foreign dirt, SQL fencing a pravdivý gate
`FAIL / 260 PASS / 3 FAIL / 2 BLOCKED`. Znovu spustil execution contract
22/22, authority 13/13, project change 10/10, process supervision 13/13, Git
preservation 10/10 a effect authority 43/43.

## F1 HIGH — stejná workspace revision vytvářela falešný neúspěch

`src/execution/project-change-runtime.js` po úspěšném write/test/Git vyžadoval,
aby `workspaceRevision` byla odlišná od before revision. Produkční
`ContextFilePolicy@1` však záměrně nerevisionuje například `deploy.cfg`, `.env`,
`*.tf` nebo `CHANGELOG`, zatímco planner tyto legitimní projektové cesty
povoluje. Přímá reprodukce s produkčním `observeWorkspaceRevision` provedla
správný Git commit, ale první run vyhodil `PROJECT_CHANGE_CONTEXT_STALE` bez
parent terminalu; restart jej trvale a nepravdivě označil `orphaned` s failed
rollbackem. Stejně nechráněné byly post-write Git/revision observery.

Falsifikovatelná podmínka: ne-manifestová změna musí okamžitě i po SIGKILL
recovery skončit durable `succeeded`, committed Git, bez rollbacku a bez
opakování focused testu. Observer/Git failure po forward zápisu musí vždy
zanechat durable non-success result místo výjimky.

## F2 MEDIUM — foreign dirt nebyl škálovaný ani paměťově omezený

`src/execution/exact-git-provider.js` četl každý cizí dirty soubor celý přes
`readFileSync` a pro každou cestu spouštěl samostatné `git ls-files --stage`.
Opus naměřil přibližně 241 MB RSS na jednom 200MB souboru a 10,3 s na 3000
untracked souborech; soubor nad 2 GiB vedl na raw `ERR_FS_FILE_TOO_LARGE`.

Falsifikovatelná podmínka: 3000 souborů pod 1 s a jediný batched NUL-delimited
index read; velký soubor nesmí být celý resident, jeho změna musí zůstat
obsahově detekovatelná a filesystem chyby nesmí unikat jako raw Node error.

## Neblokující pozorování

- 20ms supervisor grace může pod extrémní zátěží fail-safe vytvořit spurious
  orphan.
- `--new-session` by explicitněji dokumentovalo TTY obranu, ačkoli současný
  `detached: true`/`setsid()` probe prošel.
- Chyba nepodporované bwrap volby se dnes diagnosticky podobá neúspěchu
  focused testu, ale nevytváří false success.

Odpověď a nové důkazy jsou v
`docs/review/2026-08-24-WP-M2-EXECUTION-V1-OPUS-MAX-RESPONSE.md`.
