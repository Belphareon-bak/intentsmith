# 038 — M6 soak evidence vzniká pouze z owned production runtime

- **stav:** `IMPLEMENTED / FULL_RUN_EVIDENCE_COLLECTED / RE_REVIEW_REQUIRED`
- **rozsah:** M6 24h stability, maximum throughput a registry klasifikace
- **datum:** 2026-08-27

## Problém

Předchozí M6 kandidát označil deset krátkých nebo jinak zaměřených programů za
„controlled soak“. Pět z nich byly pouze in-memory CRE no-throw sondy, další
byly modelové, Studio, database nebo process testy. Jejich zelený výsledek
nedokazoval 24hodinovou stabilitu ani maximum throughput produkčního serveru.

## Rozhodnutí

Profil `soak` v množině `ACTIVE + required` tvoří přesně dva programy:

1. `IS-T5-TESTS-M6-LONG-SOAK-E2E` — nejméně 24 hodin, střídavý public health a
   authenticated project read v sekundové kadenci, průběžné RSS a závěrečná
   produkční diagnostics kontrola;
2. `IS-T5-TESTS-M6-MAX-THROUGHPUT-E2E` — pětiminutový ramp přes concurrency
   `1, 8, 32, 128, 512, 1024` a následný sustained běh na nejvyšší stabilní
   úrovni souvislého stable prefixu. První nestabilní stupeň je saturation
   boundary; případný pozdější náhodný re-green nesmí zvednout vybranou úroveň
   ani předstírat dosažení horního limitu.

Oba programy spouštějí vlastní produkční `src/server.js`, vlastní SQLite,
HOME/temp/artifact root a nový Linux user+network namespace. Namespace má
aktivní pouze `lo`; test proto nemůže kontaktovat host ani internet. Ollama a
GPU nejsou součástí této evidence. Server se ukončuje pouze přes exact child
PID s bounded SIGTERM a případný SIGKILL se zapisuje jako neúspěch.

Release receipt je připnutý k exact candidate SHA. Parser kontroluje přesnou
strukturu, dobu, request/RSS/latency budgety, diagnostics, síťový namespace,
clean shutdown a vnitřní vazby stage/sustained výsledků. Vývojové zkrácení je
možné pouze při explicitním direct-run režimu, vrací `DEV_ONLY` a autoritativní
parser ho vždy odmítne.

Candidate plán je sériový a pro controlled-soak zamyká timeout 1 500 minut a
deadline 30 hodin. Jeho množina je odvozena ze všech současných 369
`ACTIVE + required` programů; false-soak položky jsou překlasifikované podle
jejich skutečných efektů a prerequisite. Controlled soak je poslední fáze:
deterministické, serverové, modelové, fresh-clone i fyzické GPU brány musí
skončit zeleně dřív, než kandidát začne spotřebovávat 24hodinové okno.
Po každé auditní fázi runner navíc ihned ověřuje exact result set, PASS/exit,
candidate SHA, timeout/signál, cleanup a čistotu source tree. Červená dokončená
fáze proto zastaví kandidáta před další fází a nikdy se nepřenese přes dlouhý
soak až do opožděného finálního vyhodnocení.

Obecný audit runner zachovává `server` jako hard blocker. Výjimku otevře jen
po explicitním `--allow-blocker=server` a současné shodě jednoho ze dvou exact
M6 program IDs s fixture
`owned-production-server-loopback-network-namespace`. Ostatní serverové
programy zůstávají hard-blocked i tehdy, když caller obecný blocker povolí.

## Budgety

- long soak: 0 chyb a HTTP 5xx, p95 nejvýše 100 ms, p99 nejvýše 250 ms, RSS
  peak nejvýše 1 024 MiB, růst nejvýše 128 MiB, nejméně 80 000 requestů;
- throughput: sustained nejméně 500 requestů/s při stejných latency limitech,
  RSS peak nejvýše 1 536 MiB a růst nejvýše 512 MiB; musí být pozorována
  saturace nebo dosažen horní concurrency limit 1 024;
- oba: database a lifecycle recovery ready, nejvýše jeden aktivní diagnostics
  request, nulové outbound policy decision a čistý shutdown bez force.

## Výsledek úplných běhů 2026-09-11

Exact source `193e2351f4a967679ee237a99c673ceff216ddc1` má úplný 24hodinový
`M6LongSoakReceipt@1` a samostatný úplný pětiminutový
`M6MaxThroughputReceipt@1`, oba `PASS`. Původní společný wrapper zůstává `FAIL`,
protože host suspend vyčerpal jeho wall-clock deadline a druhý program přeskočil;
samostatné opakování přes stejné registry/audit authority jej doplnilo bez skipu.
Přesné hodnoty, hashe i hranice jsou v
[`m6-runtime-evidence-20260911.md`](../execution/runs/m6/m6-runtime-evidence-20260911.md).
Výsledek čeká na nezávislé review a sám nepřijímá M6 ani nepřipíná finální release
candidate.

## Hranice tvrzení

Zkrácené sondy dokládají správnost harnessu, nikoli splnění M6 exit kritéria.
Stav zůstává `FULL_RUN_PENDING`, dokud oba programy neproběhnou z registru nad
jedním čistým kandidátem a jejich raw logy neprojdou Git-native evidence
řetězcem. Toto rozhodnutí samo neotevírá M5, Gate 0, review, demo ani release.
