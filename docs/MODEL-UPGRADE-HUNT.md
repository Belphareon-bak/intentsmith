# Hledání lepších modelů

**Vstup:** `scripts/model-upgrade-hunt.js` · **Stav:** current v136.1 pipeline
**Autorita evaluací:** [MODEL-SCORING-ACTIVATION.md](MODEL-SCORING-ACTIVATION.md)

Hunt používá trychtýř, aby GPU a disk platily až za kandidáty, kteří mají
reálnou šanci pro konkrétní roli:

1. online/local discovery a role-specific eligibility;
2. postupný pull jednoho kandidáta s 40 GiB diskovou rezervou;
3. prázdný GPU slot a měření reálného VRAM placementu při produkčním contextu;
4. krátké binární capability minimum;
5. candidate/incumbent na stejné versioned suite, třikrát, exact digest;
6. fail-closed evidence minima a append-only role decision až po kontrole
   celého portfolia; pouze přesně vybraný kandidát může mít
   `activationEligible=true`;
7. žádná automatická aktivace — vítěz je podklad pro ruční binding application.

Discovery/ranking není score. CPU spill je diskvalifikace, ne kvalitativní
penalizace. Run jiného digestu, role, suite contractu nebo verze provideru nelze z cache
znovu použít. D1/D2/R1 zůstávají samostatnými identitami i při sdílené sadě.

Nerozlišující sada, příliš úzký jazykový vzorek, nestabilní úlohy, neúplný run
nebo chybějící binding končí jako `nedostatečný důkaz`/`MISSING`/`BLOCKED`, ne
jako vítěz. Rychlost je diagnostika a tie-break metadata; bez minimálního
počtu stabilně rozlišujících úloh sama výměnu neautorizuje.

Párová výhra před portfolio solverem není akční doporučení. Read model vrací
`PORTFOLIO_NOT_APPROVED`, pokud rozhodnutí výslovně nenese portfolio
způsobilost; starší nebo částečně zapsaný decision proto selže zavřeně.

Hunt je GPU operace. Před spuštěním musí být prázdné `ollama ps`, žádný cizí
NVIDIA compute proces, dostatečná RAM/VRAM a ověřená disková rezerva. Report
aktuálního stavu je naproti tomu read-only:

```bash
npm run report:model-evaluations
```

Disková rezerva 40 GiB se kontroluje před pullem i v ručním režimu.
Pull používá stejný `UpgradeManager` jako server: exclusive durable claim,
append-only provider intent/outcome a transport idle timeout. Chybějící
injektovaná pull autorita skončí před prvním efektem. CLI při `--run` váže
model-use autoritu na svou DB; měření, capability probe a quality request
drží shared artifact claim. Selhaný pull nespouští ani cleanup modelu.
Selhání provideru, timeout nebo neúplná sada se neagregují na nulové skóre:
končí jako `FAILED/CANDIDATE_EVALUATION_RETRYABLE`, bez COMPLETE a bez
quality cache. Záznam zůstane v historii, ale neblokuje nový pokus.
`--only` pro nenainstalovaný model načte velikost jeho přesného katalogového
tagu; neznámá velikost pull blokuje. `--limit` musí být kladné celé číslo.
Výpis `--shortlist --only=...` ukazuje právě vybrané kandidáty.
Metadata tagů používají auditovanou cestu
`https://ollama.com/library/<family>/tags`; jiné cesty, query, tělo
requestu a nepovolené hlavičky zůstávají zakázané.

Poslední uchovaný factual discovery výstup je
[model-shortlist-current-20260825.json](execution/runs/model-shortlist-current-20260825.json)
(SHA-256 `9339a9017ee92495610391e673662b0e8ac5d767a18e2ec667aca31b829527b3`).
Jeho pořadí není score ani souhlas s pullem či aktivací.

Jednorázový úplný panel všech kompatibilních lokálních artefaktů se spouští:

```bash
node scripts/model-upgrade-hunt.js --run --installed-panel
```

Tento režim nevolá vzdálené discovery a nepřidá do fronty nenainstalovaný model.
Použije existující COMPLETE se shodným digestem, rolí a suite kontraktem;
rovněž přebírá dřívější VRAM blokace na stejném GPU a kontextu. Jde tedy o
doplnění coverage, nikoli vynucené přeměření. Model s CPU offloadem nepokračuje
do capability ani quality sad. Režim nic neaktivuje ani nemaže.

`intervalIntegrity=LEGACY_UNVERIFIED` označuje nedoložený časový interval.
Pouhý další hunt jej neopraví: cache a unikátní COMPLETE identita zachovají
starý záznam. Přeměření stejného kontraktu vyžaduje samostatně vyřešit
append-only opakované běhy; historii nemaž ani nepřepisuj.

## Reprodukovatelný provider

Původní patch `0cb3844557c2cbf0beac555da0147279eebd9488` je v
[`patches/ollama/0001-chat-response-manifest-digest.patch`](../patches/ollama/0001-chat-response-manifest-digest.patch).
[`scripts/build-ollama-evaluation-provider.sh`](../scripts/build-ollama-evaluation-provider.sh)
obnoví přesný commit nad tagem `v0.34.0` (historicky také
`OLLAMA_PROVIDER_TAG=v0.32.14`), vyžaduje Go 1.26.7
linux/amd64, sestaví binárku a ověří její SHA-256.

```bash
GO_BIN=/cesta/go1.26.7/bin/go \
  scripts/build-ollama-evaluation-provider.sh /nova/cesta/provider-build
```

Skript potřebuje Git, C compiler a závislosti z `go.sum`. Výchozí zdroj
je oficiální Ollama Git; `OLLAMA_SOURCE_URL` může ukázat na lokální zrcadlo,
ale tag i výsledný commit se vždy ověřují. Reprodukce byla měřena s GCC
13.3.0 na Ubuntu; jiné prostředí smí skončit neshodou hashe.

MLX C kód obsahuje `__DATE__` a `__TIME__`. Recept proto připíná
`SOURCE_DATE_EPOCH` na čas source commitu a používá novou Go cache.
Historický výstup 0.32.14 má SHA-256
`bdd8ca1320a1332b6977a3d7bc4b26d370e4e36c10188b6983998632568b1e20`.
Původně systémová binárka má odlišnou identitu
`72580ab98c5c82afe9cf73e5b7400b1d3cd94ec0777f961d1aefab878146878a`;
nový build se za ni nesmí vydávat.

Jde o Go část provideru. Inference potřebuje odpovídající native payload
stejné verze Ollamy včetně CUDA runneru. Skript nic neinstaluje ani nespouští.
Runtime hledá native payload relativně k binárce: například
`<build>/ollama` spolu s `<build>/lib/ollama/llama-server` a CUDA knihovnami.
Samotné spuštění z `/usr/local` tuto vazbu nezajistí. Při lokálním ověření
lze `<build>/lib/ollama` propojit s již ověřeným `/usr/local/lib/ollama`;
při přenosu na jiný stroj je nutné dodat odpovídající native payload.
Nasazení nové binárky vyžaduje její runtime kvalifikaci; samotný shodný build
hash není důkaz GPU scoringu. Dosavadní systémové nasazení a jeho omezená
gateway kvalifikace jsou popsány v
[`provider-activation-20260909.md`](execution/runs/m6/provider-activation-20260909.md).
Případný evaluační sidecar používá pouze `127.0.0.1:11435` po dobu
sériového scoringu. Nemění nastavení systémové služby.

## Automatická kontrola vydání Ollamy

Kontrola verze provideru běží při startu `UpgradeManager`, v jeho denním
full cycle a při explicitním `POST /api/system/upgrades/check`. Výsledek
`ollamaUpdate` je dostupný také přes `GET /api/system/upgrades`.
Používá lokální `GET /api/version` a jediný auditovaný upstream endpoint
`https://api.github.com/repos/ollama/ollama/releases/latest`. Stejný přepínač
`C3_ENABLE_ONLINE_DISCOVERY=false` vypne i tuto kontrolu.

Nezávisle na běžícím serveru a GPU huntu lze spustit:

```bash
node scripts/check-ollama-upgrade.js --json
```

Šablony `systemd/user/intentsmith-ollama-update-check.{service,timer}.in`
zajišťují denní metadata check. Při chybě se kontrola opakuje po pěti minutách,
nejvýše tři pokusy v třicetiminutovém okně. To pokrývá dočasný výpadek sítě
po probuzení hostu; `CHECK_FAILED` se do úspěšné kontroly nezamlčuje. Při instalaci nahraď `@PROJECT_ROOT@`
ověřeným checkoutem a `@NODE_BIN@` absolutní cestou Node. Tento timer je
oddělený od GPU huntu a může běžet, i když je hunt vypnutý.
Výsledek s časem kontroly leží v
`${XDG_STATE_HOME:-~/.local/state}/intentsmith/ollama-upgrade/latest.json`,
vedle je append-only outbound audit. `--state-dir=/absolutní/cesta` umožní
izolovaný běh bez produktové DB.

`UPDATE_AVAILABLE` znamená nové stabilní upstream vydání. `UP_TO_DATE`
porovnává pouze verze; lokální suffix `-intentsmith.N` neznamená starší RC.
Offline, HTTP chyba a neplatná metadata vracejí `CHECK_FAILED` (CLI exit 1),
nikdy falešné „aktuální“. `DISABLED` neprovádí síťové požadavky.
Kompatibilita je vždy `UNVERIFIED`: každá nová binárka potřebuje reálné
ověření response digestu, streamingu a GPU běhu. Check nic neinstaluje,
nerestartuje provider a nemění modely ani bindingy.

## Plánovaný GPU hunt

User timer používá šablony
`systemd/user/intentsmith-model-hunt.service.in` a
`systemd/user/intentsmith-model-hunt.timer.in`. Instalovaná service musí mířit
na tento checkout a na jedinou aktuální cestu:

```text
scripts/model-upgrade-hunt.js --run --limit=2 --keep-inconclusive --scheduled
```

Před opětovným spuštěním timeru po změně scoring kontraktů se musí shodovat
`WorkingDirectory`, cesta skriptu a tento dokument. `--scheduled` vyžaduje
prázdný sdílený GPU slot a dostatečnou diskovou rezervu. Každý stažený artefakt
se změří při produkčním contextu; nenulový CPU placement zapíše pouze terminal
`BLOCKED/CANDIDATE_VRAM_FIT_FAILED` a nepustí model do quality sad. Timer nikdy
nemění binding a bez explicitního `--allow-removal` model nemaže. Dokumentace
nepřipíná přesný příští timestamp, protože jej po každém reloadu může změnit
`RandomizedDelaySec`.

## Bootstrap a nové modely

První `--bootstrap --shortlist` (nebo `--run --bootstrap --limit=N`) uloží dostupný katalog do append-only
`model_hunt_catalog` jako `BOOTSTRAP`. Datum je čas prvního pozorování,
nikoli vymyšlené datum vydání. Pozdější dosud neviděné modely nebo katalogové
revize jsou `INCREMENTAL`. Výpadek discovery nesmí sám založit prázdný bootstrap.

Timer dává přednost novinkám a potom dál zpracovává nevyřízený bootstrap.
`--incremental-only` umožní explicitně odložit zbývající historický backlog;
bez této volby se starší vhodné modely neztratí jen kvůli datu spuštění.
`--installed-panel` nejdřív proměří chybějící role již stažených artefaktů.

Výběr před stažením: jedna největší potenciálně vhodná varianta na rodinu,
Q4 a výš; bez cloud-only, MLX na NVIDIA a NVFP4 na RTX 3090; technická
způsobilost pro roli, externí výsledky, specializace, čerstvost a rezerva VRAM
určují pořadí. Žádný externí žebříček nenahrazuje lokální měření. Sady,
které nedávají dost rozlišujícího důkazu, nevytvářejí vítěze.

Dokončené kombinace katalogové revize, role/sady, hardware a verze provideru
nespotřebují další plánovaný slot. `INSUFFICIENT_EVIDENCE` je dokončené
měření a čeká na změnu sady. Dočasné chyby mají 24hodinový odstup; CPU spill
platí jen pro stejný provider/hardware/context. Neznámá katalogová revize
zůstává mimo automatický pull. Změna již instalovaného tagu se objeví v
`catalogUpdatesRequiringManualImport`, bez přepsání aktivního artefaktu.

Zůstává 40 GiB disková rezerva a výchozí zákaz mazání. Bootstrap může
pokračovat v několika vlnách; nedostatek disku je `STORAGE_BLOCKED`, nikoli
kvalitativní verdikt. Prázdný nebo již dokončený tick neměří incumbenty.

Po osvědčení huntu má automatický úklid uvolňovat místo po prokazatelně
nepřínosných kandidátech. Podmíněné zadání a kritéria jsou v
[Decision 044 — uchování kandidátů](decisions/044-reproducible-evaluation-provider.md#upřesnění-operátora--uchování-kandidátů).
Dosavadní široký `--allow-removal` tuto policy nesplňuje; během současné
počáteční dávky zůstává vypnutý. Nedokončený nebo nerozlišený test není důvod
pro odstranění modelu.

Nová měření ukládají `metadata_json.provider.version` a API/report ukazují
`providerVersion`. Starší evidence má `UNRECORDED`. Aktuální default build
0.34.0-intentsmith.1 má SHA
`8883245b864485a74ecccf62c4ce17d4538816cde4e37ea2107c2204d1d04ca7`;
linux amd64 native archive má SHA
`cf95886728959aa09910bb34de5cca1cc5a8f68003b5597197d3f2c2d57c0804`.
Podporovaný provider popisuje [Decision 044](decisions/044-reproducible-evaluation-provider.md).

Šablona GPU service vyžaduje také `@DB_PATH@`: absolutní cestu jedné
provozní DB, před migrací zálohované SQLite backup API. Checkout-local DB
ani soukromá kvalifikační kopie nejsou automaticky provozní evidence.

## Sidecar pro pravidelný běh

`scripts/run-model-hunt-provider.js` ověří SHA binárky a soupis native
knihoven, spustí sidecar na `127.0.0.1:11435` a předá argumenty
hunt CLI. Sidecar běží jako běžný uživatel s vypnutým cloudem; výchozí
systémový modelový sklad vlastní účet `ollama` a uživatel do něj nemůže
zapisovat. Nejde o filesystem sandbox. Vlastní procesní skupina zajišťuje
ukončení provideru i všech jeho native runnerů; systemd navíc vlastní celou
cgroup. Není potřeba povolovat user namespaces ani měnit AppArmor.
Při ukončení dávky se procesy zastaví. Provider log a JSON report
zůstanou v `~/.local/state/intentsmith/model-hunt/run-*/`.

Výchozí runtime je
`~/.local/share/intentsmith/evaluation-provider/0.34.0-intentsmith.1`;
`INTENTSMITH_EVAL_RUNTIME` dovoluje explicitní jinou cestu ke stejné
ověřené binárce. Potřebuje `bin/ollama`, odpovídající `lib/ollama` a
`native.sha256`. Manifest vzniká z ověřeného upstream archivu při instalaci.

Scoring a čtení inventory používají sidecar. Pull používá systémový
`127.0.0.1:11434` přes stejnou durable mutation autoritu; oba procesy musí
číst `/usr/share/ollama/.ollama/models` (nebo explicitní `OLLAMA_MODELS`).
Každý artefakt se po pullu znovu řeší přes evaluační inventory a response
proof. Nesdílený sklad tedy nevytvoří COMPLETE. Systémová Ollama při této
cestě neprovádí scoring; její starší verze nezneplatňuje označené měření
na 0.34.0. Systémový upgrade zůstává samostatná instalační operace.

Šablona timer service používá tento wrapper. Před zapnutím proveď například:

```bash
C3_DB_PATH=/absolutni/provozni.db node scripts/model-upgrade-hunt.js --bootstrap --shortlist --json
C3_DB_PATH=/absolutni/provozni.db node scripts/run-model-hunt-provider.js --run --installed-panel --role=CODE,VISION --limit=10 --scheduled --keep-inconclusive
```

Reprodukovatelná instalace uživatelského runtime používá
`scripts/install-user-evaluation-runtime.sh PATCHED_BINARY UPSTREAM_ARCHIVE`.
Archiv je oficiální `ollama-linux-amd64.tar.zst` z
[release v0.34.0](https://github.com/ollama/ollama/releases/tag/v0.34.0).
Instalátor kontroluje oba připnuté SHA před rozbalením a odmítne přepsat
existující runtime. Systémovou službu a modelový sklad nemění.

Aktuální šablona plánuje nejvýše dva kandidáty denně ve 03:00 místního času
s náhodným odkladem do 15 minut. `Persistent=false` brání dohánění zmeškaného
nočního běhu hned při pracovním startu počítače. Obsazený sidecar port,
evaluační lock nebo GPU vytvoří `SCHEDULED_SKIPPED`; nevyvolají další modelový
request. Uvolnění modelu používá prázdné `messages` + `keep_alive:0`, tedy
provider unload bez další inference nebo změny contextu.
