# GPU hunt: dlouhý validační běh, 2026-09-12

**IMPLEMENTATION_CANDIDATE / VALIDATION_IN_PROGRESS / REVIEW_PENDING.**
Pokračování explicitně autorizovaného GPU testování a oprav. Předchozí
[produkční packet](2026-09-11-GPU-HUNT-PRODUCTION-REVIEW-PACKET.md) popisuje
provider, reprodukovatelný build, migrace, timery a původní zelený offline gate.
Jeho PASS není důkazem, že delší hunt nemá provozní vady.

## Nálezy z první dávky

- První dávka měla před zastavením 28 COMPLETE na provideru
  `0.34.0-intentsmith.1`. Jeden celý duel `llava:13b` skončil ve všech pěti
  soutěžených rolích ve prospěch stávajících modelů. Model zůstává na disku.
- Opakované chyby `qwen3.8:latest / reasoning_v2` byly v logu providera
  ukončené klientem přibližně po 30 sekundách ještě během načítání modelu
  (HTTP 499, `client connection closed before llama-server finished loading`).
  Nejde o důkaz nízké kvality modelu.
- Chyba incumbenta přerušovala zbývající role a CLI ji nesprávně zapisovalo
  kandidátovi ve všech rolích. Historické FAILED řádky se zachovávají jako
  evidence vadného běhu; nelze je použít k odůvodnění smazání kandidáta.
- Běh zahrnoval suspend hostu mezi 2026-09-11 23:54 a 2026-09-12 09:20 CEST.
  Jeho celkový čas ani jeden přes suspend měřený interval nejsou čistý GPU čas.
- Dávka byla operátorsky zastavena 09:24 CEST, unit skončil nenulovým statusem;
  provider i native runner se uklidily a NVIDIA compute seznam byl prázdný.

## Oprava pro rereview

1. Každá role zachytí vlastní chybu a další role pokračují. Dokončené výsledky
   a rozhodnutí se zachovají. Neúplný journal zůstane RETRYABLE.
2. Inference zachytí skutečný model, digest, provider, opakování, čas a vadné
   úlohy. FAILED se zapíše pouze pro tuto identitu a roli. Chyba přípravy bez
   pokusu inference zůstává v journalu; nevyrábí modelové FAILED.
3. Transportní/proof chyba je opakovatelná, s původním kódem v metadatech;
   nepromění se v trvalé odmítnutí artefaktu. Částečný běh ani výjimka model
   nesmaže ani při explicitním legacy removal flagu. Produkční mazání je OFF.
4. Výchozí request timeout je 120 s, včetně cold loadu. Efektivní výchozí
   parametry se nově účastní suite contract SHA-256. Změna kontraktu vyžaduje
   nové měření; stará COMPLETE se nebudou vydávat za výsledky nového nastavení.
   Prompty, grading, prahy a požadavek response-bound identity se nemění.
5. Mezi dvěma různými skutečně měřenými modely se požaduje dokončený drain.
   Refresh artefaktu po pullu zachová očekávanou verzi providera i pro VRAM gate.

## Validace

Focused: candidate 36, pairwise 37, upgrade 70, consolidation 16, read model 17,
vše bez selhání. Regrese pokrývá chybu incumbenta mezi dvěma úspěšnými rolemi,
správnou identitu FAILED, zákaz mazání a RETRYABLE přes dílčí COMPLETE.
Celý offline/database gate a nové GPU běhy budou doplněny po dokončení.

Evidence root:
`/home/belphareon/Projects/coworker/intentsmith-hunt-validation-20260912`.
Původní provider log:
`/home/belphareon/.local/state/intentsmith/model-hunt/run-a4QCsd/provider.log`.

Acceptance M6 a nezávislé review zůstávají otevřené. Automatická aktivace rolí
ani podmíněná evidence-based retence nejsou tímto během zapnuté.
