# Modelové evaluace a aktivace

**Stav:** současný kontrakt v136.1 · **Aktualizováno:** 2026-08-26
**Implementace:** `WP-MODEL-EVALUATION-CONSOLIDATION` · **Přijetí:**
implementace green, čeká na nezávislé rereview post-review remediace

Název souboru zůstává kvůli existujícím odkazům. IntentSmith už ale nemá
samostatný „scoring“ runtime. Existuje jedna autoritativní cesta pro modelové
evaluace a oddělená, ručně autorizovaná cesta pro změnu bindingu.

## Jedna autoritativní cesta

1. `src/eval/role-evaluation-plan.js` mapuje všech sedm rolí na versioned suite,
   contract SHA, počet opakování a fail-closed minima.
2. `scripts/model-upgrade-hunt.js` spouští role-specific párové měření na
   přesných Ollama artefaktech. Měření je sériové a předpokládá volný GPU slot.
3. `model_evaluation_runs` je append-only historie. Aktuální je pouze řádek se
   shodným digestem artefaktu a dnešním suite contract SHA.
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

Suite contract nehashuje zdroj wrapper closure. Hashuje explicitní skutečný
prompt, language, rubric, grader a jeho uzavřené vstupy, options a repeats.
VISION přidává SHA-256 dekódovaných image bytes a CODE přesný výstup
`buildPrompt()` i grading inputs. Úloha bez explicitního `contractMaterial`
zastaví sestavení plánu; starý run se proto po sémantické změně promptu nemůže
znovu vydávat za current.

Discovery prior je pouze levné pořadí kandidátů. Katalog, universe ani externí
benchmark se neukládají jako lokální quality score a nesmějí být zobrazeny
jako důkaz kvality.

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
Souhrny zapsané legitimně mezi migracemi 070 a 082 nejprve doplní jako
nepoužitelnou `BLOCKED / LEGACY_EXACT_IDENTITY_UNKNOWN` evidenci; server kvůli
nim při upgradu nespadne.

## Bezpečný provoz

- Report a API jsou read-only a GPU nepoužívají.
- Hunt spouštěj jen s prázdným `ollama ps`, bez cizího NVIDIA compute procesu,
  s dostatečnou VRAM a 40 GiB rezervou po pullu. CPU/RAM offload je zakázaný;
  artefakt, který se celý nevejde do VRAM, končí `BLOCKED` bez score.
- `FAILED`, `BLOCKED`, `MISSING`, nerozhodný výsledek ani implementační green
  nejsou PASS.
- Rychlost zůstává provozní metrika. Při nedostatečném kvalitativním důkazu
  nesmí vyrobit vítěze; decision outcome používá stabilní `reasonCode`, ne
  porovnání lokalizovaného textu `basis`.
- Usage digest se bere z identity vrácené providerem nebo z exact `/api/tags`
  inventory pod aktivním model-use lease. Desired binding není důkaz obsloužené
  identity. Neověřitelná identita se zapíše jako `NULL` a cleanup fail-close
  nemaže.
- Automatický failover/proof issuer není tímto kontraktem zapnut. Případné
  budoucí zapnutí vyžaduje nové rozhodnutí a current-contract review.
