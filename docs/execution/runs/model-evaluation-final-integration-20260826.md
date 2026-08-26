# Model evaluation — finální integrační handoff (2026-08-26)

**Stav:** `IMPLEMENTATION_GREEN / REREVIEW_REQUIRED`

**Review base:** `c5aa379a9d43eac732f26e4628121a63b33f60d5`

**Product/evidence candidate:** `5f11a4b103618b97d8bf3bd1d8bcc566e8f15c2a`

Tento report uzavírá implementační a integrační milestone. Není
nezávislým přijetím. `ACCEPTED` smí vzniknout až po novém nezávislém
review celého uvedeného rozsahu včetně navazujícího dokumentačního commitu.

## Co je nyní autoritativní

- Jediný scoring read/write kontrakt tvoří append-only
  `model_evaluation_runs` a `model_evaluation_decisions`. Aktuálnost vyžaduje
  exact model digest, roli, suite name/version a suite contract SHA; legacy
  fallback je vypnutý.
- API, CLI, Studio a governor čtou stejný `ModelEvaluationReadModel`.
  Metadata discovery neurčují kvalitu ani aktivaci.
- Binding je samostatná durable autorita. Evaluace ani doporučení model
  neaktivuje; bez ověřené runtime autority je actionability fail-closed.
- V123 runtime tabulky a paralelní ranker/recommendation/validation/proposal i
  automatická failover/proof application cesta byly odstraněny. Historické
  migrace a run dokumenty zůstávají pouze reprodukční evidencí.
- Každý budoucí modelový běh je sériový a GPU-only. CPU/RAM spill nedostane
  score: končí `BLOCKED/CANDIDATE_VRAM_FIT_FAILED` se `score=NULL`.

## Uzavření posledního review

1. Manifest a DB historie se validují jako sjednocení před první mutací.
2. Všech sedm adopcí a post-validace běží v jediné transakci.
3. M2 kolize `070/081/082/083` jsou přesunuty na `092–095`; modelové
   `084–086` se adoptují na původní kanonické identity.
4. Migrace `096` eviduje legacy import explicitně jako `VERIFIED` nebo
   `QUARANTINED`; neověřitelná stará data nejsou current score.
5. Provider-unavailable startup nad durable bindingy zůstane dostupný jako
   `DEGRADED`; integrity/digest rozpor je nadále fatal. Všech sedm rolí používá
   jeden immutable provider inventory snapshot.
6. Studio nevymýšlí installed defaults, wizard vyžaduje exact tag a Android
   preflight skutečně blokuje chybějící exact portfolio.
7. Dva poslední registry testy zrušené failover/proof application byly spolu
   s jejím kódem odstraněny, ne přebarveny na skip.

Migrační census je 83 zdrojů a čerstvá DB má 153 tabulek. Module boundary
baseline je 1 190 hran; nová scoring autorita přidala 40 explicitních hran a
odstranění starého systému odebralo 36. Počet cyklů se nezměnil: 3 cykly,
28 souborů v cyklech.

## Testovací evidence

Focused běhy bez Ollamy/GPU:

| Kontrola | Výsledek |
|---|---:|
| schema migrace včetně union/adoption scénářů | 55/55 PASS |
| model evaluation consolidation | 12/12 PASS |
| model evaluation read model | 9/9 PASS |
| role evaluation suites | 16/16 PASS |
| M1 binding application | 112/112 PASS |
| capability server včetně durable B-14 | 15/15 PASS |
| Studio client | 125/125 PASS |
| artifact/documentation integrity | 154/154 PASS |
| registry validace | 447 programů, fingerprint `059922af5232391aadee8367428712842d41c77d5c66916b3e6369e949e5deca` |
| module ratchet | 1 190/1 190 PASS |

Finální deterministická brána:

| Pole | Hodnota |
|---|---|
| command | `C3_LOG_LEVEL=error npm run test:deterministic` |
| run ID | `2026-08-26T21-26-07-640Z` |
| source revision | `5f11a4b103618b97d8bf3bd1d8bcc566e8f15c2a` |
| profiles | `offline,database` |
| concurrency | `1` |
| start / end UTC | `2026-08-26T21:26:07.679Z` / `2026-08-26T21:30:16.605Z` |
| verdict | `PASS` |
| status | `278 PASS / 0 FAIL / 0 TIMEOUT / 0 BLOCKED / 0 SKIPPED` |
| required failures / blockers | `0 / 0` |
| report SHA-256 | `0a0b8bf71567915ce256a660cf0ee33708147d7ba995b4f084544c690e916e15` |
| inventory SHA-256 | `778a3f5c3a6510f713eb4a94e64e8e851041a263abc66de01225f479a059a8ea` |
| inventory fingerprint | `993c2aece7f637c9119862a0b03d6bd2eac1ef75920355002e95a199f1e9ad48` |
| options fingerprint | `b6c9a55d1eef4edd4cd3c3fc691fe87947b8aad52dc7249c05af5a41fed7db4e` |

Před finálním PASS proběhly dva neakceptovatelné běhy, které se
nezamlčují: první byl infrastrukturně neplatný po `npm ci --ignore-scripts`
(172 PASS / 108 FAIL kvůli chybějícímu native `better-sqlite3`); druhý na
`c2c43a39` skončil 276 PASS / 4 FAIL a odhalil dva osiřelé failover testy,
starý registry contract a lokální direct-test artefakty. Všechny čtyři příčiny
byly odstraněny; finální PASS je nový plný běh, nikoli přepsaný report.

## Aktuální lokální scoring panel

Read-only snapshot `2026-08-26T21:31:07.185Z` nad živou DB a aktuální
Ollama inventory:

| Stav | Počet artifact/role buněk |
|---|---:|
| `COMPLETE` | 40 |
| `BLOCKED` | 17 |
| `MISSING` | 34 |
| `FAILED` | 0 |
| celkem | 91 (13 exact artefaktů × 7 rolí) |

Evidence obsahuje timestampy od `2026-08-25T20:24:21.425Z` do
`2026-08-25T21:31:09.963Z`, 33 durable decisions a 0 actionable decisions.
Všech sedm durable rolí je v standalone reportu pravdivě
`UNVERIFIED_RUNTIME`; CLI nepozoruje serverový runtime.

Scoring tedy záměrně není vydáván za dokončený. Podle posledního review se
34 chybějících buněk nesmí spustit před novým nezávislým přijetím tohoto
kandidáta. Staré contracty se do panelu nepočítají.

## Discovery a provozní stav

Discovery implementace prošla 38/38 testů a outbound/upgrade sada 66/66.
Živá DB ale nemá nové návrhy z tohoto běhu: obsahuje jen šest provisional
L4 záznamů z `2026-08-19` a `model_universe_raw/derived` jsou prázdné. Těchto
šest metadata záznamů proto nejsou scoring doporučení ani kandidáti k
aktivaci.

Systemd `intentsmith-model-hunt.timer` byl vypnut a zastaven. Timer i service
jsou `inactive`; seznam timerů neobsahuje další naplánovaný hunt. `ollama ps`
je prázdné a NVIDIA compute census nevrátil žádný proces. Timer se smí znovu
instalovat/povolit a 34 buněk se smí sériově dotestovat až po nezávislém
přijetí a nasazení tohoto kandidáta.

## Review handoff

Review musí pokrýt celý integrační rozsah `c5aa379a..5f11a4b1` a navazující
dokumentační commit. Zvlášť má znovu přehrát union/adoption rollback,
durable-provider-unavailable B-14, single provider snapshot, import audit 096,
exact Studio/wizard/Android preflight a odstranění posledních starých
failover cest. Do té doby zůstává jediný pravdivý stav
`IMPLEMENTATION_GREEN / REREVIEW_REQUIRED`.
