# GPU hunt: dlouhý validační běh, 2026-09-12

**DETERMINISTIC_GREEN / GPU_VALIDATION_IN_PROGRESS / REVIEW_PENDING.**
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
5. Fronta ponechá již změřeného kandidáta, pokud duel nebyl dokončen.
   O opakování rozhoduje durable journal s 24h odstupem, ne samotné vlastní
   COMPLETE kandidáta; neúspěšný incumbent tedy duel neztratí z fronty.
6. Mezi dvěma různými skutečně měřenými modely se požaduje dokončený drain.
   Refresh artefaktu po pullu zachová očekávanou verzi providera i pro VRAM gate.

7. Denní metadata check po ranním suspendu selhal na dostupnosti upstreamu.
   Opakování v 09:35 CEST potvrdilo UP_TO_DATE / 0.34.0. Service nyní opakuje
   chybu po 5 minutách, nejvýše 3 pokusy za 30 minut. Neinstaluje aktualizace.

8. Oficiální [katalog Ornith 1.5](https://ollama.com/library/ornith-1.5)
   potvrzuje Text/Image pro 9B. Parser to nyní rozpoznává, takže VISION jej
   nevyloučí kvůli chybějícímu jménu rodiny. Parametrový gate pro R1 zůstává.
   [North Mini Code](https://ollama.com/library/north-mini-code-1.0) je 30B/3B
   MoE zaměřený na agentic coding; deklarované externí výsledky pouze odůvodňují
   jeho výběr ke stažení. Výrobce doporučuje thinking. Současný hunt měří
   produkční `think:false`; neprokazuje nejlepší dosažitelnou kvalitu ve všech
   možných režimech, což je další důvod nyní neodstraňovat kandidáty automaticky.

9. Při přechodu katalogového otisku na plný lokální digest se dědí původní
   cohort/first-seen. Stažení historického kandidáta jej neoznačí INCREMENTAL.
   Lokální klíč zůstává z plného digestu a kvalitativní proof se nezkracuje.

10. CODE executor nyní předává privátní `C3_DB_PATH` i větvi `unshare`.
    Fallback přes systemd ji předával již dříve. Probe se stejným
    `NoNewPrivileges=true` jako hunt na tomto hostu potvrdila odmítnutí
    `unshare` při zápisu `uid_map`; dnešní služba tedy používá správně
    izolovaný fallback. Regrese ověřuje, že dítě dostane vlastní DB místo
    cesty rodiče. CODE runner také zachová `timedOut` v diagnostice inference.

## Validace

Focused: candidate 36, pairwise 37, upgrade 70, consolidation 16, read model 17,
vše bez selhání. Regrese pokrývá chybu incumbenta mezi dvěma úspěšnými rolemi,
správnou identitu FAILED, zákaz mazání a RETRYABLE přes dílčí COMPLETE.
První clean-clone offline/database gate na `794f1e57`: **351 PASS / 1 FAIL**.
Selhal pouze artifact-validation kvůli neaktualizovanému počtu modulových hran
v ROADMAP po přidání importu výchozích parametrů (1 309 → 1 310). Census je
opraven následným dokumentačním commitem; původní neúspěšný report zůstává.

R1 runtime retry na `794f1e57` dokončil Phi4 vs Qwen3.8 ve třech opakováních,
bez chyb a bez mazání. COMPLETE: `eval_b38990fd-a001-43d3-92e6-3b287ab57aa8`
(Phi4 0.875) a `eval_32646596-2845-4821-b90d-e7980880759d` (Qwen3.8 0.95).
Tři stabilně rozlišující úlohy, marže kandidáta -0.200, incumbent quality win.
Service skončila exit 0 a uvolnila GPU i port. Offline replay současného
snapshotu reprodukoval 2 COMPLETE / 60 applicable MISSING / 8 N/A bez kontaktu
s providerem. Současně běžící druhý wrapper skončil SCHEDULED_SKIPPED / PORT_BUSY.

Celý offline/database gate po opravě census na `e4d5cf8b` i po doplnění
Ornithu na finálním zdroji **`dbf1abfc9059d9127e1494145345e0d7efd86d4b`**:
**352 PASS / 0 FAIL / 0 TIMEOUT / 0 BLOCKED / 0 SKIPPED**. Všech 352 log SHA-256,
source revision, čisté source stromy a jedinečné test IDs byly ověřeny.
Finální report SHA-256:
`30a7f631f6706bf90ded05cb5e6b513e00609501d276818ed981849790c839c7`.
[Strojový manifest](../execution/runs/gpu-hunt-validation-20260912.json)
uchovává také oba předchozí gate, runtime reporty a jejich hashe. Nová vzdálená dávka na `ab4da3b9`
testuje North Mini Code a Ornith 1.5 v D2/CODE/R2/CHAT; výsledky budou doplněny.

Evidence root:
`/home/belphareon/Projects/coworker/intentsmith-hunt-validation-20260912`.
Původní provider log:
`/home/belphareon/.local/state/intentsmith/model-hunt/run-a4QCsd/provider.log`.

Acceptance M6 a nezávislé review zůstávají otevřené. Automatická aktivace rolí
ani podmíněná evidence-based retence nejsou tímto během zapnuté.
