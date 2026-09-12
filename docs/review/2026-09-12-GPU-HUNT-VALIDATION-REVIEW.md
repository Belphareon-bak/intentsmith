# GPU hunt: dlouhý validační běh, 2026-09-12

**DETERMINISTIC_GREEN / PILOTS_COMPLETE / BASELINE_RUNNING / REVIEW_PENDING.**
Pozdější autorizaci automatického mazání, důkazy VISION a další checkpoint
zachycuje [retention follow-up](2026-09-12-GPU-HUNT-RETENTION-REVIEW.md).
Níže uvedené OFF a počty jsou historické údaje příslušných běhů.
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
- Dávka `intentsmith-model-hunt-bootstrap-20260911.service` byla operátorsky
  zastavena 09:24 CEST; terminální stav v 09:24:22 byl `status=1/FAILURE`;
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
Ornithu na zdroji **`dbf1abfc9059d9127e1494145345e0d7efd86d4b`**:
**352 PASS / 0 FAIL / 0 TIMEOUT / 0 BLOCKED / 0 SKIPPED**. Všech 352 log SHA-256,
source revision, čisté source stromy a jedinečné test IDs byly ověřeny.
Report tohoto checkpointu SHA-256:
`30a7f631f6706bf90ded05cb5e6b513e00609501d276818ed981849790c839c7`.
[Strojový manifest](../execution/runs/gpu-hunt-validation-20260912.json)
uchovává také předchozí gate, runtime reporty a jejich hashe.

Evidence root:
`/home/belphareon/Projects/coworker/intentsmith-hunt-validation-20260912`.
Původní provider log:
`/home/belphareon/.local/state/intentsmith/model-hunt/run-a4QCsd/provider.log`.

Acceptance M6 a nezávislé review zůstávají otevřené. Automatická aktivace rolí
ani podmíněná evidence-based retence nejsou tímto během zapnuté.

## První vlna nově stažených modelů

Dávka `intentsmith-hunt-wave1-20260912.service` na `ab4da3b9` proběhla
09:40:57–10:41:16 CEST, exit 0. North se stahoval přibližně 25 min 36 s,
Ornith 9 min 8 s. Po dokončení byly GPU compute seznam, Ollama ps i port
11435 prázdné. Zůstalo přibližně 73 GiB volných při rezervě 40 GiB.

| Kandidát | GPU při 32k | D2 | CODE | R2 | CHAT |
| --- | ---: | ---: | ---: | ---: | ---: |
| North Mini Code 1.0 | 17.78 GiB, bez CPU offloadu | 0.8417 | 0.0000 | 0.4569 | 0.8501 |
| Ornith 1.5 9B | 6.23 GiB, bez CPU offloadu | 0.8500 | 0.1619 | 0.7514 | 0.8822 |
| Současný model příslušné role | — | 0.9667 | 0.2857 | 0.7167 | 0.9125 |

Osm duelů skončilo bez roleErrors: pět ponechává incumbenta na základě
pairwise quality policy, tři jsou INSUFFICIENT_EVIDENCE (North D2, Ornith
D2/R2). Vyšší průměr Ornithu v R2 nestačí: stabilně rozlišují jen 2/3
požadovaných úloh. U Ornith CODE nerozhoduje vysoká jistota ztráty; aktuální
policy pouze nenašla požadované zlepšení. Ani jeden model se nesmazal.

DB ověření `wave1-db-verification.json` potvrzuje 12 jedinečných COMPLETE
(8 kandidátských a 4 sdílené incumbent běhy), tři opakování, plný digest a
`provider.proof=RESPONSE_BOUND`, verzi `0.34.0-intentsmith.1`. Osm append-only
rozhodnutí odkazuje na tyto běhy. Přesné digests:

- North: `d8b269ad5c7c7144ce104b83ce93bc3efb85e0f74e01be6be5f5d6f7ca90b60f`.
- Ornith: `e5df7dcdd8a263994df62d610317e07be0d6af23f96fcbd8543273058fce575e`.

Manuální `--only` pilot nepoužívá scheduler attempt journal. Následný běžný
hunt tyto modely převezme do journalu a shodné COMPLETE může použít z cache.
Discovery již doložilo, že jejich plné lokální digests zdědily BOOTSTRAP a
first-seen 2026-09-11T20:26:28.369Z z katalogových otisků.

CODE oracle kontrola aplikovala všech sedm skutečných opravných patchů;
všech sedm získalo 1.000. Nízké modelové výsledky tedy nejsou vysvětlitelné
tím, že runner nedokáže přijmout referenční opravu. Historických 0.7619
nelze přenést na dnešní jiný provider a efektivní kontrakt.

Další gate na `b639e944` zachytil **351 PASS / 1 TIMEOUT**:
`IS-T1-TESTS-M2-EFFECT-BROKER-V1-TEST`, 30 221 ms při současné GPU/CODE
zátěži. Samostatné opakování programu prošlo 56 kontrolami. Celý opakovaný
gate bez současné CODE evaluace prošel **352 PASS**; původní timeout
zůstává v manifestu a izolovaný retry jej nepřepisuje.

Po první vlně current-contract read model uvádí **14 COMPLETE / 0 FAILED /
0 BLOCKED / 59 applicable MISSING / 11 N/A** nad 12 instalovanými artefakty.
Read-only report uvádí binding autoritu `UNVERIFIED_RUNTIME /
MODEL_BINDING_RUNTIME_NOT_OBSERVED`: nezachycuje běžící produktovou session.
Response-bound scoring proof tím není zneplatněn; zároveň samotná oprava
providera nedokazuje ověření celé produktové binding application.

## Finální implementační gate

Implementační rozsah dnešních oprav:
`fe064ee888a4efeb82ad0c77e5c40686f7c6fd83..3b0dcdfb2b2fce4e2ae525d86515f1ca2c961d10`.
Původní provider/bootstrap změny jsou v předchozím packetu. Následné evidence
commity mění jen dokumentaci a manifest.

Clean-clone offline/database gate na přesném finálním implementačním zdroji
`3b0dcdfb2b2fce4e2ae525d86515f1ca2c961d10`:
**352 PASS / 0 FAIL / 0 TIMEOUT / 0 BLOCKED / 0 SKIPPED**.
Všech 352 logů má ověřený SHA-256, shodnou source revision a čistý source
strom. Report SHA-256:
`f0475470fff1c11f2bb3f49215fe5b5586bb80a69043994d3d182c09f8b436a6`.
CODE private-DB regrese: 56 PASS; CODE suite diagnostika: 22 PASS;
referenční CODE opravy: 7/7 score 1.000. Nezávislé review tím není nahrazené.

## VISION: dokončené porovnání na nové Ollamě

Service `intentsmith-hunt-vision-validation-20260912.service` na `3b0dcdfb`
skončila úspěšně přibližně 10:55 CEST. Oba kandidáti i incumbent mají
response-bound COMPLETE se třemi opakováními. Po skončení se provider
uvolnil; nezůstala GPU compute úloha ani listener na 11435.

| Model | VISION score | Duel proti aktuální Llavě |
| --- | ---: | --- |
| llava-llama3:8b | 0.5333 | incumbent |
| qwen3.8:latest | 0.9333 | CANDIDATE_QUALITY, 2:0, střední jistota |
| ornith-1.5:9b | 0.9556 | CANDIDATE_QUALITY, 2:0, střední jistota |

Portfolio doporučilo Ornith (6.23 GiB při 32k) pro VISION;
`decision_53b16de8-9adc-4643-8c49-c48ad5bbe331` má activationEligible=true.
Qwenův duel také vyhrál, ale není výsledným výběrem portfolia. Skórové
pořadí **není** přímý důkaz převahy Ornithu nad Qwenem; oba duely používaly
Llava incumbent. Všechny durable binding revisions zůstaly beze změny,
VISION nadále ukazuje na `llava-llama3:8b`. Neproběhla binding application.

Current-contract snapshot po VISION: **17 COMPLETE / 0 FAILED / 0 BLOCKED /
56 applicable MISSING / 11 N/A**, 12 instalovaných modelů. SHA-bound offline
replay reprodukoval stejné počty s `providerContacted=false`. Zdrojová DB
zůstala při pořizování disposable projekce byte-identická. Plné run/decision
IDs, digests, provider a časy jsou v `vision-db-verification.json` a manifestu.

## Pokračující úvodní dávka a předání k review

V 10:56:24 CEST byl spuštěn normální scheduler-backed hunt
`intentsmith-hunt-baseline-validation-20260912.service`, invocation
`6571405889e94d68a8583e925e801605`, implementace `3b0dcdfb`:
`--run --limit=13 --keep-inconclusive --scheduled`, timeout 6 h.
Dávka v okamžiku tohoto checkpointu **běží; není prohlášena za dokončenou**.
Výsledný report bude `baseline.json` ve výše uvedeném evidence rootu;
mezivýsledky jsou průběžně v DB a stav je v journalu služby:

```bash
journalctl --user -fu intentsmith-hunt-baseline-validation-20260912.service
```

Discovery před startem mělo 180 čekajících položek; všech 12 prvních byly
lokální artefakty, následovala Gemma4 31B a další katalogoví kandidáti.
Reálný běh znovu provádí discovery a kontrolu místa. Před startem bylo
71.94 GiB volných. Žádný počet kandidátů neobchází diskový ani GPU gate.
Noční timer má nadále limit dva kandidáti; přesný čas randomizuje systemd.
Denní autocheck hlásí dostupnou verzi Ollamy, neinstaluje ji automaticky.

Review má prověřit zejména nové error/proof hranice, invalidaci cache podle
provideru a efektivních parametrů, journal po částečném duelu a záznamy
skutečných pilotů. M6 acceptance zůstává otevřená. Nízká rozlišitelnost sad
a pozdější bezpečná retence jsou zbývající produktová práce; legacy
`--allow-removal` zůstává vypnutý. Tento checkpoint dokládá připravenost
k řízenému testování, nikoli dokončenou autonomní správu všech modelů.
