# WP-M2-EXECUTION-V1

**Typ:** M2 oddíl 5/7 — durable project-change, sandbox, focused test, exact Git
a restart recovery

**Stav:** `PINNED_V1 / ACCEPTED / FINAL_OPERATOR_REVIEW_PASSED`

**Autorita:** operátorské spuštění celé M2; `ROADMAP.md` §6 krok 3 a exit
kritéria pro atomický patch, focused test, rollback, cancel/restart a audit

**Product/test revision:** `816c5b1479064bd9c1b1ae529976f45b795ed0c9`

## Uživatelský výsledek

Jeden přesně vymezený `ProjectChangeRequest` vlastní úplnou sadu schválení pro
všechny forward zápisy, jejich připravené rollbacky, jeden focused test a
volitelný exact Git commit. Před prvním efektem se atomicky spotřebuje celá
authority set. Runtime zapíše přesné after-images, spustí argv-only test v
Linux bubblewrap sandboxu bez sítě a se read-only projektem, a teprve po
úspěchu vytvoří Git commit jen z povolených cest.

Pád nebo takeover nikdy znovu nespouští již spotřebované efekty. Baseline HEAD
konverguje exact-path rollbackem; deterministicky zrekonstruovaný committed
HEAD opraví jen povolené index entries a dokončí durable success. Cizí HEAD,
foreign dirt nebo třetí obsah zůstane `in_doubt/orphaned` bez přepsání.

Kontrakt je podle Decision 030 mechanicky `PINNED_V1`. Připnutí není review
PASS: přesné integrační bajty musí ještě přijmout operátor.

## Vlastněný rozsah

- `contracts/m2/execution-v1.js`;
- migrace 078 a `src/execution/execution-authority-repository.js`;
- `project-change-planner.js` a `project-change-runtime.js`;
- `process-sandbox-provider.js` a supervisor child;
- `exact-git-provider.js`;
- batch approval consumption v effect authority repository;
- exact byte read, mode-preserving write a durable delete v path authority;
- pět registrovaných execution testů, schema sentinely, registry, module graph,
  tento WP a run report.

## Zakázaný rozsah

- rewiring legacy lifecycle, `execution-loop.js`, Studio routes nebo veřejného
  user journey; to je oddíl 6;
- obecný shell, více focused commands, network-enabled test nebo unsandboxed
  fallback;
- Git push, tag, hooks, `git add -A` nebo zahrnutí foreign dirt do commitu;
- RemoteCorePort/listener/pairing, mobil, GPU/Ollama/model a cizí checkouty.

## Kontraktové invariants

- Request/result mají exact keys, canonical UTF-8/NFC JSON, bounded paths a
  bajty, digesty všech images a exact child EffectRequest bindings.
- Nejvýše 32 souborů, 1 MiB na soubor a 8 MiB celkem; traversal, symlink,
  hardlink, nested Git, dirty target a neexistující parent selžou před efektem.
- Celá approval set se spotřebuje atomicky před zápisem. Crash mezi consumption
  a approval-set journalem se rekonstruuje pouze z úplné exact consumed set;
  partial set fail-close nic nespustí.
- Claim generation je monotónní, takeover vyžaduje expiraci a prokázanou smrt.
  Renewal musí živý effective lease pouze prodloužit; repository i SQLite
  odmítnou zkrácení, oživení po expiraci a předčasnou další generaci.
- Každý file intent předchází efektu a exact readback předchází applied eventu.
  Rollback přepisuje jen exact after-image; třetí obsah nikdy.
- Sandbox profil `linux-bwrap-ro-v2` začíná prázdným mount namespace, vystaví
  pouze systémový runtime, exact binary/project file descriptors a private
  tmp, kořenovou scaffolding znovu přimountuje read-only a oddělí
  PID/network/IPC/user namespaces. Seccomp odmítne socket/connect, kernel
  keyring a `io_uring_setup`; žádný plain-spawn fallback neexistuje.
- Supervisor identita je durable před start handshake. Timeout/cancel ukončí
  celý PGID přes TERM/KILL a success vyžaduje potvrzené vyklizení skupiny.
- Git používá temporary index, NUL-delimited index-info, literal pathspecs,
  exact-path real-index update, CAS `update-ref` a post-proof foreign dirt.
- Workspace revision je policy-limited evidence, ne náhradní proof zápisu:
  exact byte/mode readback dovoluje legitimní success i při stejné revision.
  Post-write observer failure vždy vytvoří durable non-success terminal.
- Po všech externích test/Git/revision krocích se exact after-images znovu
  ověřují bezprostředně před parent terminalem. Type/canonical mismatch se
  klasifikuje jako foreign, durable terminalizuje a nikdy nepřepíše cizí inode.
- Foreign dirt používá jeden batched NUL index read a obsahové hashování přes
  konstantní 64KiB buffer s before/after inode a metadata race kontrolou.
- Success vyžaduje všechny forward/test/Git EffectResulty, žádný rollback
  result, ukončený proces, exact after-images a immutable parent terminal.

## Acceptance

1. Contract positive/negative a false-success sady projdou.
2. Dvě SQLite connection mají jednoho live claim winnera; stale generation,
   direct SQL success a premature takeover selžou.
3. Dva soubory, nový soubor, nonzero test, rollback a third-party drift mají
   exact výsledky.
4. Skutečný bubblewrap test a celý child/grandchild PGID jsou containment-bound.
5. Skutečný `SIGKILL` po Git ref CAS před indexem i po indexu před DB se po
   restartu deterministicky opraví bez opakování testu nebo zápisů.
6. Foreign staged, unstaged a untracked bajty zůstanou identické; pathspec magic
   a LF filename jsou byte-exact a `add -A` neexistuje.
7. Registry, schema, module ratchet, artifact validation a deterministický gate
   se zopakují; známý celkový `FAIL/BLOCKED` se nevydává za PASS.
8. Operátor vrátí nad přesným připnutým řezem `REVIEW_PASSED`; každý
   `CHANGES_REQUESTED` se opraví, znovu připne a review se opakuje.

## Přiznané limity

- Atomicita znamená durable all-or-rollback terminalitu a restartovou
  konvergenci, ne současnou POSIX viditelnost více souborů.
- Linux/bubblewrap je jediný implementovaný sandbox profil. Jeho absence je
  typed unavailable bez plain-spawn fallbacku.
- Seccomp program je fail-closed připravený pro Linux `x64` a `arm64`; jiná
  architektura skončí před spuštěním focused testu jako unsupported profil.
- Tento oddíl je connector/direct journey. Aktivní lifecycle a Studio surface
  zůstávají do oddílu 6 na legacy cestě.
- Dvě historická Opus max kola vrátila `CHANGES_REQUESTED`; opravy jsou
  integrované. Jejich záznam zůstává evidencí, ale finální verdict podle
  Decision 030 vydává operátor nad připnutými integračními bajty.

## Ověření

```bash
node tests/m2-execution-contract-v1.test.js
node tests/m2-execution-authority-repository.test.js
node tests/m2-execution-project-change.test.js
node tests/m2-execution-process-supervision.test.js
node tests/m2-execution-git-preservation.test.js
node tests/m2-effect-authority-repository.test.js
node tests/schema-migrations.test.js
node tests/m1-model-failover-schema.test.js
node tests/module-boundary-ratchet.test.js
node scripts/validate-test-registry.js --json
node --test tests/artifact-validation.test.js
npm run test:deterministic
git diff --check
```
