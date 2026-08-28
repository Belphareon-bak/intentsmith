# Modelové evaluace a aktivace

**Stav:** současný kontrakt v136.1 · **Aktualizováno:** 2026-08-28
**Implementace:** `WP-MODEL-EVALUATION-CONSOLIDATION` · **Přijetí:**
coverage je implementačně kompletní a čistý finální gate na `53ded662` prošel
`279/279`; evidence rereview rozsahu `d6137d4c..3f027938` skončilo
[`REVIEW_PASSED`](review/2026-08-28-WP-MODEL-EVALUATION-EVIDENCE-REREVIEW.md),
proto je tento scoring/evidence balík `ACCEPTED / SYSTEM_PROVIDER_BLOCKED`

Název souboru zůstává kvůli existujícím odkazům. IntentSmith už ale nemá
samostatný „scoring“ runtime. Existuje jedna autoritativní cesta pro modelové
evaluace a oddělená, ručně autorizovaná cesta pro změnu bindingu.

## Jedna autoritativní cesta

1. `src/eval/role-evaluation-plan.js` mapuje všech sedm rolí na versioned suite,
   contract SHA, počet opakování, fail-closed minima a explicitní versioned
   technický applicability kontrakt.
2. `scripts/model-upgrade-hunt.js` spouští role-specific párové měření na
   přesných Ollama artefaktech. Měření je sériové a předpokládá volný GPU slot.
3. `model_evaluation_runs` je append-only historie. Aktuální je pouze řádek se
   shodným digestem artefaktu, rolí, suite name, suite version a dnešním suite
   contract SHA.
4. `model_evaluation_decisions` je append-only rozhodnutí odkazující na oba
   přesné COMPLETE runy a na použitou politiku.
5. `ModelEvaluationReadModel` je jediný reader pro API, CLI, Studio, governor a
   model registry; CLI a Studio zobrazují všechna rozhodnutí role.
6. Skutečnou změnu role provádí výhradně manual binding application. Evaluace
   sama konfiguraci ani durable binding nemění.
7. Každá nakonfigurovaná role má durable exact-artifact baseline. Startup
   doplní pouze chybějící řádek z installed inventory; existující autoritu
   nepřepisuje, ale vždy ji znovu porovná s runtime jménem a installed exact
   digestem. Selhání rehydratace zastaví startup. Nedostupný provider, runtime
   mismatch nebo digest mismatch ponechá nemodelové route dostupné, ale
   zveřejní binding autoritu `DEGRADED`; žádné candidate rozhodnutí pak není
   akční a jinak připravený kandidát nese `BINDING_AUTHORITY_DEGRADED`.
   Gateway před POST pod model-use lease kontroluje očekávaný exact digest
   proti inventory, ale skutečně obsloužený artefakt přijme pouze z digestu
   přímo v téže provider response. Mutable inventory po odpovědi není důkaz.
   Neattestovaná nebo driftující odpověď se nevrátí ani nezapíše jako úspěšný
   usage.
8. Stejná response atestace platí pro nové autoritativní scoring běhy. Runner
   dostane očekávaný `(model name, digest)`; chybějící nebo jiný response digest
   vyhodí typovanou terminální chybu a nesmí vytvořit `COMPLETE` řádek.

Suite contract nehashuje zdroj wrapper closure. Hashuje explicitní skutečný
prompt, language, rubric, grader a jeho uzavřené vstupy, options a repeats.
VISION přidává SHA-256 dekódovaných image bytes a CODE přesný výstup
`buildPrompt()` i grading inputs. Úloha bez explicitního `contractMaterial`
zastaví sestavení plánu; starý run se proto po sémantické změně promptu nemůže
znovu vydávat za current.

Discovery prior je pouze levné pořadí kandidátů. Katalog, universe, raw runtime
telemetry ani externí benchmark se neukládají jako lokální quality score a
nesmějí být zobrazeny jako důkaz kvality. Telemetry nesmí vytvářet blacklist,
veto bindingu ani discovery filtr; starou derived guard tabulku odstraňuje
migrace 099.

## Co lze číst

```bash
npm run report:model-evaluations
npm run report:model-evaluations -- --json
curl -s http://127.0.0.1:3335/api/system/models/evaluations
```

Serverové API a Studio mohou hlásit `DURABLE` pouze po úspěšném startup
ověření všech sedmi runtime bindingů a exact digestů. Samostatný CLI proces
runtime serveru nepozoruje, proto poctivě hlásí `UNVERIFIED_RUNTIME` a nikdy
nevydá `READY_FOR_MANUAL_BINDING`; skóre, digesty, contracty a timestampy tím
zůstávají plně čitelné.

Každá role/artifact položka uvádí stav `COMPLETE`, `FAILED`, `BLOCKED` nebo
`MISSING`, přesný digest, suite/version/contract, `score` a `testedAt` tam, kde
existuje COMPLETE běh. Timestamp se zobrazuje; neexistuje 14denní TTL, které by
staré či name-only skóre automaticky prohlásilo za současné.

Časová evidence má vlastní explicitní provenienci. Reader zveřejní
`startedAt`, `durationMs` a `intervalIntegrity=VERIFIED` jen pokud start, konec
a uložená délka tvoří konzistentní interval. U 40 starších current-contract
řádků je interval nekonzistentní: `startedAt` a `durationMs` proto zůstávají
`null`, `intervalIntegrity=LEGACY_UNVERIFIED` a `testedAt` je pouze historický
recorded-at údaj. DB historie se kvůli kosmetice nepřepisuje. Chybějící měření
má `intervalIntegrity=NOT_AVAILABLE`.

Status a applicability jsou dvě různé osy. `MISSING` se nepřepisuje na umělý
výsledek. Read model i scoring queue používají
`technical-role-compatibility-v1`: všechny technicky kompatibilní páry se
měří, zatímco `preferredCategories` pouze řadí discovery kandidáty. Aktuální
lokální panel má 55 COMPLETE, 24 BLOCKED a 12 raw MISSING; všech 12 raw
MISSING je `NOT_APPLICABLE`, takže mezi 79 technicky kompatibilními páry je
`applicable MISSING=0`.
Přesná data a timestampy jsou v
[`model-scoring-live-20260828.md`](execution/runs/model-scoring-live-20260828.md).
Commitnutý snapshot nese SHA-bound normalizovanou inventory projekci včetně
`params`, `family`, `category` a `capabilities`. Offline replay používá pouze
tuto projekci a stejnou read-only DB; bez kontaktu s Ollamou musí reprodukovat
55 COMPLETE, 24 BLOCKED, 0 applicable MISSING a 12 N/A, jinak selže.

## Decision-ready minima

| Role | Suite | Aktivních úloh nejméně | Stabilně rozlišujících nejméně |
|---|---|---:|---:|
| D1, D2, R1 | `reasoning_v2` | 8 | 3 |
| CODE | `code_patch` | 6 | 2 |
| R2 | `review_v2` | 6 | 3 |
| CHAT | `chat_v3` | 40 | 7, z toho EN 3 a CS 4 |
| VISION | `vision_v2` | 5 | 2 |

Nesplněné minimum, jiný digest, jiný contract, chybějící run nebo DB chyba
blokují candidate decision. I pro průkazného vítěze zůstává rozhodnutí
neakční, dokud celý portfolio solver nepotvrdí segregaci odpovědností a uložený
decision nemá `activationEligible=true`. Jedna šťastná úloha nemůže změnit
binding.

CODE prompt fixture je commitnutý snapshot a stejný contract lze sestavit i v
shallow/package checkoutu. Samotný skrytý historický oracle vyžaduje dosažitelné
commity; pokud chybějí, role nese `CODE_FIXTURE_RUNTIME_UNAVAILABLE`, není
decision-ready a hunt skončí před pull/GPU. Infrastrukturní nedostupnost se
nikdy nepřepočítá na nulu modelu.

## Odstraněná cesta

Runtime soubor `src/upgrade/validation-suites.js`, jeho HTTP/WS/UI povrch,
`model-scoring-report.js` a oddělené v123 proof-measurement skripty neexistují.
Migrace 082 před dropem starých tabulek kontroluje import, jejich obsah ukládá
do `model_evaluation_import_evidence` a teprve potom odstraňuje
`validation_results` a `validation_suite_scores`. Historické migrace a review
dokumenty zůstávají reprodukovatelnou auditní stopou, nikoli fallbackem.
Souhrny zapsané legitimně mezi migracemi 070 a 082 se nejprve doplní jako
nepoužitelnou `BLOCKED / LEGACY_EXACT_IDENTITY_UNKNOWN` evidenci; server kvůli
nim při upgradu nespadne.

## Bezpečný provoz

- Report a API jsou read-only a GPU nepoužívají.
- Hunt spouštěj jen s prázdným `ollama ps`, bez cizího NVIDIA compute procesu,
  s dostatečnou VRAM a 40 GiB rezervou po pullu. CPU/RAM offload je zakázaný;
  artefakt, který se celý nevejde do VRAM, končí `BLOCKED` bez score.
- Exact-digest placement block je artifact-wide, ale lze jej převzít pouze na
  shodném GPU a shodném context window. Installed panel jej materializuje pro
  chybějící current role bez dalšího modelového loadu; jiný hardware nebo
  kontext vyžaduje nové měření.
- `FAILED`, `BLOCKED`, `MISSING`, nerozhodný výsledek ani implementační green
  nejsou PASS.
- Rychlost zůstává provozní metrika. Při nedostatečném kvalitativním důkazu
  nesmí vyrobit vítěze; decision outcome používá stabilní `reasonCode`, ne
  porovnání lokalizovaného textu `basis`.
- Usage digest se bere pouze z přímé provider response. Exact `/api/tags`
  inventory pod aktivním model-use lease dokládá očekávání, nikoli obslouženou
  identitu. Desired binding ani druhý inventory snapshot nejsou důkaz.
  Neověřitelná či driftující odpověď není úspěch, nevrátí se klientovi a
  nevytvoří kladný usage záznam; cleanup dál fail-close nemaže.
- Veřejné repository writery automatického failover/proof lifecycle jsou
  odstraněné. Jejich případné budoucí obnovení vyžaduje nové rozhodnutí,
  implementaci a current-contract review.

Na hostu nainstalovaná systémová Ollama 0.32.14 ani její publikované
`ChatResponse` schema neposkytují digest obslouženého artefaktu. Systémová
služba proto zůstává beze změny a durable runtime je dál fail-closed. Pro
autorizovaný live scoring byl z přesného upstream tagu `v0.32.14` sestaven
izolovaný loopback sidecar s minimálním patchem, který vrací exact manifest
digest v téže `/api/chat` response. Patch prošel Go testy a reálný preflight
ověřil současně shodu digestu i `size_vram == size`. Sidecar umožnil bezpečně
dokončit scoring, po běhu byl zastaven a nepředstírá systémové nasazení.
Podrobnosti, commity a SHA jsou v
[`model-scoring-live-20260828.md`](execution/runs/model-scoring-live-20260828.md).
