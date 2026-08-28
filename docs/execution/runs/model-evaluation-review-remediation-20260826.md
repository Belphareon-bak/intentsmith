# Model evaluation review remediation (2026-08-26)

**Stav:** `SUPERSEDED / CHANGES_REQUIRED`
**Vstupní review:** `e8c1ba85..96c762db` — `CHANGES_REQUESTED`
**Implementační checkpointy:** `2cead271`, `df4a50f8`, `5b855e26`, `341016f3`

Tento dokument je důkaz opravy, nikoli nezávislé přijetí. Původní scoring
panel se nepřeznačuje na nový běh a kandidát zůstává nepřijatý do samostatného
rereview celého rozsahu.

Navazující review rozsahu `96c762db..4169c59d` našlo dva HIGH blokery:
upgrade-unsafe přeznačení 081/081/082 a startup, který mohl publikovat
`DURABLE` při runtime/DB mismatch. Tento report proto není current green
evidence. Aktuální náprava je v
[druhém remediation reportu](model-evaluation-review-remediation-2-20260826.md).

## Uzavření review nálezů

### Migrační sloty a živá DB

- compatibility repairy používají 084 a 085, konsolidace 086;
- runner před jakoukoli DB mutací odmítne dvě různá jména se stejným
  třímístným slotem; povoleny jsou pouze přesné historické dvojice 008 a 030;
- živá DB byla před zápisem zastavena spolu s timerem, neměla aktivního writera
  a dostala dvě obnovitelné zálohy;
- v jedné `BEGIN IMMEDIATE` transakci byly pouze přeznačeny tři již aplikované
  version stringy; původní `applied_at` zůstal zachován;
- následný migrator hlásí `applied=[]`, `skipped=62`, `PRAGMA quick_check=ok`;
- `validation_results` ani `validation_suite_scores` fyzicky neexistují.

| Evidence | SHA-256 |
|---|---|
| `/home/belphareon/Backups/intentsmith/c3-pre-migration-rebind-20260826T085057+0200.sqlite` | `dd7250313fbdbc9dbba6d4aeb5e3c1e5498cb4cad6f5f01178b05c533353582b` |
| `/home/belphareon/Backups/intentsmith/c3-pre-code-baseline-20260826T090100+0200.sqlite` | `3fb9d1d14880bfd4bb6c702ed6b925bad5c0bcb72ae8b57f4c7e02de6472c261` |
| živá `data/c3.db` po remediaci | `aa956f3f0e28bebe6b7796eb96bb32e914d2022c922a209289a89a718f0db0c8` |

Živá `schema_migrations` má 65 historických řádků. Nové identity nesou původní
časy: 084 `2026-08-25 20:14:48`, 085 a 086 `2026-08-25 20:17:55` UTC.

Union census současně odhalil starší cross-branch konflikt slotu 070 mezi
modelovou historií a M2 effect authority. Nevznikl v tomto review rozsahu.
Zůstává explicitním integračním blockerem; nový preflight jej při spojení větví
zastaví fail-closed. Přeznačit jej bezpečně může až vlastník integrační M2
linky se znalostí již aplikovaných identit.

### Úplný decision povrch

CLI a Studio nyní renderují celé `decisions[]` každé role, ne pouze poslední
řádek podle timestampu. CODE proto zobrazuje i:

```text
DECISION CANDIDATE qwen3.5:27b -> qwen3.8:latest
2026-08-25T21:31:11.743Z PORTFOLIO_NOT_APPROVED
```

Rozhodnutí zůstává správně neakční; nebyl změněn binding ani
`activationEligible`.

### Sedm durable bindingů a bootstrap

- `model_desired_bindings` obsahuje všech 7 rolí a read model hlásí `DURABLE`;
- chybějící CODE byl přes typovaný repository writer pozorován jako
  `qwen3.5:27b@7653528ba5cb…`, `CONFIG_DEFAULT`,
  `2026-08-26T07:02:56.043Z`;
- před i po observaci existuje 11 manuálních binding operací: bootstrap žádnou
  nevytvořil a od panelu nevznikla žádná aktivace;
- startup nyní pouze pro chybějící role vyřeší installed exact digest a uloží
  baseline; existující durable autoritu nikdy nepřepíše;
- první běh testu založí 7/7 řádků bez operace, druhý je idempotentní;
- `src/config.js` a setup wizard sdílejí jednu mapu defaultů. Stejné portfolio
  je v `.env.example`, installeru, Dockeru, Studio fallbacku a dokumentaci:
  D1/CODE/CHAT `qwen3.5:27b`, D2/R1 `qwen3.8:latest`, R2 `qwen3:14b`, VISION
  `llava-llama3:8b`.

### Discovery a timer

Původní discovery JSON je nyní commitnutý jako
[model-shortlist-current-20260825.json](model-shortlist-current-20260825.json):
576 682 bytů, SHA-256
`9339a9017ee92495610391e673662b0e8ac5d767a18e2ec667aca31b829527b3`.
Je to factual prior, nikoli lokální score ani doporučení k aktivaci.

Po remediaci je `intentsmith-model-hunt.timer` `enabled/active (waiting)` a
service `inactive`. Instalovaný `ExecStart` míří na aktuální checkout a jediný
current příkaz `model-upgrade-hunt.js --run --limit=2 --keep-inconclusive
--scheduled`. Přesný další čas není kanonická dokumentace: mění jej
`RandomizedDelaySec=15m`; při závěrečné kontrole byl pouze ověřen budoucí běh
27. srpna. Timer nemění binding a CPU offload zapisuje jen jako terminal
`BLOCKED/CANDIDATE_VRAM_FIT_FAILED` bez skóre.

## Stav scoring evidence

Nový ostrý panel nebyl potřeba ani spuštěn. Stávající current-contract panel
má fyzicky 28 `COMPLETE` a 11 `BLOCKED` řádků pro 13 exact lokálních digestů;
všech 11 blokací má `score=NULL` a vzniklo výhradně kvůli VRAM fit admission.
DB má 33 decisions, z nich 0 activation eligible, a 756 import evidence řádků.
Výsledky a VRAM placement jsou v
[current panelu](model-evaluation-current-panel-20260825.md).

## Test evidence a odchylka

- binding application: 104 PASS / 0 FAIL;
- read model + CLI: 9 PASS / 0 FAIL;
- Studio client: 123 PASS / 0 FAIL;
- model request contract: 29 PASS / 0 FAIL;
- test registry: 384 runnable programs, valid;
- první celý gate `2026-08-26T07-10-04-667Z` poctivě skončil FAIL 225/227:
  jeden fail byl zbylý direct-test adresář po přerušeném testu a druhý přesně
  nový `setup/wizard.js -> config.js` boundary edge;
- direct-test adresář byl beze ztráty přesunut do
  `/home/belphareon/Backups/intentsmith/interrupted-test-artifacts/llm-integration.test-Lipo6K-20260826`;
  edge byl přijat exact-edge writerem bez růstu cyklů (3 -> 3, členství 28 -> 28);
- protože cizí untracked `docs/MODEL-SCORING-RESULTS-20260824.md` není součástí
  kandidáta, byl jen po dobu gate skryt přes přesnou lokální
  `.git/info/exclude` položku; obsah zůstal na SHA-256 `64a74699…`, položka byla
  po gate odstraněna a soubor je znovu viditelný jako untracked;
- finální gate nad čistým tracked snapshotem `341016f3`, run
  `2026-08-26T07-13-17-823Z`: `PASS`, 227 PASS / 0 FAIL / 0 BLOCKED /
  0 SKIPPED.

Při výběru doplňkových testů byl omylem spuštěn živý
`llm-integration.test.js`. Po prvním provider callu byl okamžitě přerušen,
načtený `qwen3.5:27b` byl odloadován a tento běh není započten jako test ani
scoring evidence. Nevznikl nový evaluation run; závěrečné `ollama ps` i NVIDIA
compute seznam jsou prázdné.

## Acceptance hranice

Implementace a lokální deterministic evidence jsou green. Přechod na
`ACCEPTED` vyžaduje nový nezávislý rereview. Globální M2 integrace navíc nesmí
sloučit známý konflikt 070 bez jeho explicitního přeznačení v autoritativní
integrační lince.
