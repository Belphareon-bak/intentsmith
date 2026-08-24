# WP-M2-EXECUTION-V1

**Typ:** M2 oddíl 5/7 — durable project-change, sandbox, focused test, exact Git
a restart recovery

**Stav:** `IMPLEMENTATION_GREEN / REVIEW_PENDING`

**Autorita:** operátorské spuštění celé M2; `ROADMAP.md` §6 krok 3 a exit
kritéria pro atomický patch, focused test, rollback, cancel/restart a audit

**Product/test revision:** `08d249adab097fc4e628b5ee8e54e9df1a26fa9c`

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

Kontrakt je `CANDIDATE_V1`. `PINNED_V1` je zakázaný, dokud lokální Claude Opus
s `--effort max` nevrátí `REVIEW_PASSED`.

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
- Sandbox používá exact binary/project file descriptors, read-only root a
  projekt, private tmp, oddělené PID/network/IPC namespaces a žádný fallback.
- Supervisor identita je durable před start handshake. Timeout/cancel ukončí
  celý PGID přes TERM/KILL a success vyžaduje potvrzené vyklizení skupiny.
- Git používá temporary index, NUL-delimited index-info, literal pathspecs,
  exact-path real-index update, CAS `update-ref` a post-proof foreign dirt.
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
8. Opus max vrátí `REVIEW_PASSED`; každý `CHANGES_REQUESTED` se opraví a review
   se opakuje.

## Přiznané limity

- Atomicita znamená durable all-or-rollback terminalitu a restartovou
  konvergenci, ne současnou POSIX viditelnost více souborů.
- Linux/bubblewrap je jediný implementovaný sandbox profil. Jeho absence je
  typed unavailable bez plain-spawn fallbacku.
- Tento oddíl je connector/direct journey. Aktivní lifecycle a Studio surface
  zůstávají do oddílu 6 na legacy cestě.
- Opus account limit nesmí být přeložen na review PASS.

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
