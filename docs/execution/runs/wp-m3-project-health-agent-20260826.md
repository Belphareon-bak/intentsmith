# WP-M3-AGENT — governed local project-health journey

- **Stav:** `IMPLEMENTATION_GREEN / REVIEW_PENDING`
- **Product revision:** `f484ef766eb96cb738e36e147b0655755e5c94a3`
- **Větev:** `codex/m3-integration-20260825`
- **Push:** neproveden
- **Review:** záměrně odloženo do společného operátorského review M3

Tento řez uzavírá povinnou M3 cestu lokálního project-health agenta: nativní
extension se objeví v registru, lze ji instalovat jako disabled instanci,
zapnout, ručně spustit, vypnout a odebrat. Agent získá projektová data pouze
přes M2 `ProjectContext`, vyhodnotí změnu workspace revision, spustí trigger a
zapíše skutečně viditelný in-app výsledek. Neoznačuje celý M3 za přijatý.

## Autorita a produkční cesta

- `ExtensionManifest@1` deklaruje jedinou required capability
  `code-intel.project-context.v1`; chybějící capability zastaví discovery;
- host vytvoří jednorázový opaque token vázaný na extension, agenta, run,
  aktivní project ID a canonical root. Agent nemůže nominovat cestu ani token
  použít podruhé;
- ProjectContext rozpočet je omezen na 16 souborů, 64 KiB a 16 384 tokenů a
  provider znovu ověřuje workspace revision;
- instalovaná definice nese digest manifestu a přesné identity. Změněná nebo
  zastaralá definice selže před čtením projektu;
- source analyzuje pouze vrácené snippety a ukládá workspace/snapshot digest,
  počet nálezů a path/content-digest provenance, nikoli surový obsah;
- první run vytvoří baseline bez notifikace. Další změna aktivuje `changed`
  condition, rising trigger a lokální `notify`; disabled run vytvoří nulový run
  i nulový efekt;
- Studio má samostatný escaped panel `Výsledky`; uninstall ověřuje vlastnictví
  extension instance a odmítá běžící instanci.

Řez zároveň opravil čtyři odhalené produkční chyby starého agent runneru:
manual run už neobchází disabled stav, `changed` condition skutečně persistuje
předchozí hodnotu, notification repository dostává správnou signaturu a
interpolovaná metadata a run order je deterministický i při shodné sekundě.
Object source už není chybně ukončen HUNTER zkratkou pro prázdné kolekce.

## Ověření

| Důkaz | Výsledek |
|---|---|
| `tests/m3-project-health-agent.test.js` | 7/7 PASS |
| `tests/e2e/63-agent-execution.e2e.js` | 5/5 PASS |
| `tests/e2e/64-m3-project-health-agent.e2e.js` | 6/6 PASS |
| `tests/scheduler.test.js` | 3/3 PASS |
| `tests/agent-runner.test.js` | 22/22 PASS |
| `tests/multi-source-integration.test.js` | 12/12 PASS |
| `tests/agent-sources.test.js` | 47/47 PASS |
| `tests/agent-wizard.test.js` | 65/65 PASS |
| `tests/m3-extension-contract-v1.test.js` | 14/14 PASS |
| `tests/m2-project-context-retrieval.test.js` | 9/9 PASS |
| `tests/m3-code-review-specialist.test.js` | 4/4 PASS |
| `tests/specialist-boundary-ratchet.test.js` | 11/11 PASS |
| `tests/session-context.test.js` | 66/66 PASS |
| `tests/harness-exit-code.test.js` | PASS; 115 DB-reachable root testů chráněno, mutation rejected |
| `tests/module-boundary-ratchet.test.js` | 13/13 PASS |
| `tests/artifact-validation.test.js` | 154/154 PASS |
| registry validace | 437 programů, `72bc64e6a6d8710ffd718ccb419b5106aa2637ae108eb92a8cef7442fa18bc97` |
| module graph | 1 148 hran, 3 cykly / 28 souborů v cyklech |
| `git diff --check` | PASS |

Canonical non-gate server run `2026-08-25T22-38-52-092Z` skončil 2/2 suites a
11/11 steps PASS na source revision `f484ef76...`. Report pravdivě nese
`gateEvidence: false`; nemění registry `lastGreen` a není vydáván za celý M3
gate.

Pět nových modulových hran bylo přijato proti jednomu úplnému přesnému seznamu:

- `src/agents/runner.js -> src/agents/sources/project-health.js`
- `src/extensions/agent-extension-service.js -> src/agents/schema.js`
- `src/extensions/agent-project-context.js -> src/code-intel/project-context-provider.js`
- `src/server.js -> src/extensions/agent-extension-service.js`
- `src/server.js -> src/extensions/agent-project-context.js`

Baseline připíná výhradně product revision `f484ef76`; počet cyklů ani cyclic
membership nevzrostly.

## Přiznané hranice

- Agent je záměrně local/effect-free: jediný výsledek je in-app SQLite
  notifikace. Manifest digest mu nedovolí změnit akci na filesystem, process,
  network ani webhook bez vytvoření nové, znovu schvalované identity.
- Legacy agent definitions mimo M3 extension cestu si zachovávají své starší
  source/action možnosti. Tento WP netvrdí, že je migroval pod novou hranici;
  jejich vztah k globálnímu M3 effect exit kritériu patří do closeoutu.
- Disable zabrání každému dalšímu startu; již běžící invocation se tímto WP
  aktivně necancelluje. Uninstall běžící instanci odmítne.
- Server E2E používá jen loopback, izolovanou databázi a runner-owned projekt.
  Nebyl použit model, externí síť, GPU ani Ollama.
- Celý deterministic gate ani sjednocený M3 closeout v tomto řezu spuštěné
  nejsou. Stav je proto pouze `IMPLEMENTATION_GREEN / REVIEW_PENDING`.
