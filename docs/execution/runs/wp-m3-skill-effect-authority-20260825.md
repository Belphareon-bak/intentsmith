# WP-M3-SKILL — M2 effect authority journey

- **Stav:** `IMPLEMENTATION_GREEN / REVIEW_PENDING`
- **Product revision:** `381011d05b8236ce417008ed8a4dfe11f73d0524`
- **Větev:** `codex/m3-integration-20260825`
- **Push:** neproveden
- **Review:** záměrně odloženo do společného operátorského review M3

Tento řez dokládá existující verzovaný skill od deterministického triggeru přes
typované parametry, fixní a proměnné kroky, review a exact-effect checkpoint až
po trvalý `ToolResult` a `EffectResult`. Neoznačuje M3 za přijaté a nenahrazuje
operátorské review.

## Produktový výsledek

- `m3-project-note` je `ExtensionManifest` skill s explicitními capabilities,
  účelem, triggerem, typovanými parametry, step modelem, tool selection a
  quality/output kritérii;
- připnutý trigger se vyhodnotí před CRE a nepoužívá modelový resolver;
- `write` nevlastní filesystem API. Připraví pouze `file.write` přes centrálně
  injektovaný M2 bridge a čeká na příkaz obsahující přesné `effectId`;
- obecné `ano` efekt neschválí; cizí actor pending execution nespotřebuje ani
  nezruší a jeho chybný pokus nezmění stav vlastníka;
- zrušení před startem zapíše durable `cancelled / APPROVAL_GRANT_REVOKED`,
  vypořádá ToolResult a odstraní pending payload;
- legacy write definice se kompatibilně překládají pouze na `file.write`.
  Legacy shell si ponechává parser pro diagnostiku, ale nemá žádné process API
  a fail-closed čeká na budoucí M2 process effect;
- interní durable actor/project/message binding se nevrací přes veřejný skill
  status.

## Ověření

| Důkaz | Výsledek |
|---|---|
| `tests/m3-skill-effect-authority.test.js` | 10/10 PASS |
| `tests/m2-tool-broker-v1.test.js` | 34/34 PASS |
| `tests/create-specialist-skill.test.js` | 48/48 PASS |
| `tests/m3-extension-contract-v1.test.js` | 14/14 PASS |
| `tests/m2-effect-file-consumer.test.js` | 7/7 PASS |
| `tests/module-boundary-ratchet.test.js` po integrátorském přijetí | 13/13 PASS |
| registry validace | 433 programů, 14 exclusions, `be5a7f55ee9f8419679cfe4d3c947e01a2ff4f2234a28381b6699789ef2331b2` |
| module graph | 1 141 hran, 3 cykly / 28 souborů v cyklech |
| `git diff --check` a syntax check změněných modulů | PASS |

Pět nových modulových hran je přijato jednotlivě proti přesným párům; počet
cyklů ani cyclic membership nevzrostly. Baseline připíná výhradně product
revision výše.

Celý deterministic gate ani M3 closeout v tomto řezu spuštěné nejsou. Stav je
proto pouze `IMPLEMENTATION_GREEN / REVIEW_PENDING`, nikoli `PASS` celého
milníku.

## Provozní hranice

Focused acceptance test je deterministický a nevyžaduje síť, Ollamu ani GPU.
Při širší kompatibilitní kontrole byl před tímto reportem omylem spuštěn legacy
`tests/executor-capabilities.test.js`; jeho tři CRE případy sáhly na lokálně
nakonfigurovaný model. Běh skončil 85/85, ale není použit jako offline důkaz.
Žádný model, proces, konfigurace, checkout ani GPU fronta nebyly tímto řezem
měněny a další modelové testy se nespouštěly.

Známá fail-closed hranice: cancel mezi vydáním a revokací single-use grantu má
mezivláknový race. Pokud jiný executor grant mezitím spotřebuje, cancel
neprohlásí falešný úspěch a vrátí `EFFECT_EXECUTION_IN_DOUBT`; neexistuje ale
atomický repository příkaz „mint-and-revoke“. To je vhodný bod pro společné
operátorské review, ne skrytý PASS claim.
