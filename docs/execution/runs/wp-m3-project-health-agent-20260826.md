# WP-M3-AGENT — governed local project-health journey

- **Stav:** `REVIEW_PASSED / SECTION_7_FOLLOWUP_GREEN`
- **Product revisions:** `f484ef766eb96cb738e36e147b0655755e5c94a3`, `b278a0ab`, `7708519e`
- **Větev:** `codex/m3-integration-20260825`
- **Push:** neproveden
- **Review:** oddíl 6 `REVIEW_PASSED`; integrační oddíl 7 čeká na re-review

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
| `tests/m3-project-health-agent.test.js` | 9/9 PASS |
| `tests/m3-legacy-agent-surface-retirement.test.js` | 10/10 PASS |
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
| `tests/specialist-boundary-ratchet.test.js` | 12/12 PASS |
| `tests/session-context.test.js` | 66/66 PASS |
| `tests/harness-exit-code.test.js` | PASS; 115 DB-reachable root testů chráněno, mutation rejected |
| `tests/module-boundary-ratchet.test.js` | 13/13 PASS |
| `tests/artifact-validation.test.js` | 154/154 PASS |
| registry validace | 438 programů, `ca2aa642e8e433ea484a2c20c42f3f8aa045b2b4b906548f417a5185265ed54f` |
| module graph | 1 150 hran, 3 cykly / 28 souborů v cyklech |
| `git diff --check` | PASS |

Aktuální společný non-gate server run `2026-08-25T23-08-49-411Z` skončil 5/5
suites a 32/32 steps PASS na source `ad23c278...`. Report pravdivě nese
`gateEvidence: false`; nemění registry `lastGreen` a není vydáván za Gate 0.

Pět nových modulových hran bylo přijato proti jednomu úplnému přesnému seznamu:

- `src/agents/runner.js -> src/agents/sources/project-health.js`
- `src/extensions/agent-extension-service.js -> src/agents/schema.js`
- `src/extensions/agent-project-context.js -> src/code-intel/project-context-provider.js`
- `src/server.js -> src/extensions/agent-extension-service.js`
- `src/server.js -> src/extensions/agent-project-context.js`

Původní agent baseline připíná product revision `f484ef76`; follow-up baseline
`708086b9` přidal proti product fixu `7708519e` jen dvě quarantine import hrany.
Počet cyklů ani cyclic membership nevzrostly.

## Přiznané hranice

- Agent je záměrně local/effect-free: jediný výsledek je in-app SQLite
  notifikace. Manifest digest mu nedovolí změnit akci na filesystem, process,
  network ani webhook bez vytvoření nové, znovu schvalované identity.
- Native M3 agent manifest je fail-closed omezen na ProjectContext source a
  lokální `store`, `mark_seen` nebo non-LLM `in_app notify`; HTTP, webhook a
  modelové action varianty jsou odmítnuté před instalací.
- Legacy agent definice mohou zůstat čitelné, ale jejich mutační, build, run a
  source-validation routes jsou typovaně retired a scheduler bez platné M3
  extension vazby nic nespustí. Historické HTTP/RSS/webhook chování nebylo
  migrováno ani zachováno jako spustitelná cesta.
- Disable zabrání každému dalšímu startu; již běžící invocation se tímto WP
  aktivně necancelluje. Uninstall běžící instanci odmítne.
- Server E2E používá jen loopback, izolovanou databázi a runner-owned projekt.
  Nebyl použit model, externí síť, GPU ani Ollama.
- Oddíl 6 je operátorsky přijatý. Integrační oprava oddílu 7 je zelená, ale
  její re-review stále čeká.
