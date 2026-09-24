# Hledání lepších modelů

**Cílové workflow k revizi, 24. 9. 2026:**
[Celý postup huntu se dvěma nezávislými hodnotiteli a výběrem sestavy rolí](GPU-HUNT-WORKFLOW.md).
Obsahuje sběr, přejímku hodnotitelů, neshody, provozní ověření, aktivaci,
fallback a rollback. Jde o cílový návrh, nikoli popis již dokončené implementace;
rozdíly vůči současnému kódu jsou uvedené v jeho §14.
Navazující [review](review/2026-09-24-HUNT-WORKFLOW-REVIEW.md) zpřesňuje
provozní profil, proveditelnost měření, absolutní brány a přechod k místní
dvojici. Seznam již zadaných a dosud otevřených rozhodnutí je ve workflow §0.
[Následná kontrola metody](review/2026-09-24-HUNT-DECISION-FEASIBILITY.md)
označuje proveditelnost malých rozhodovacích mezí jako blokující návrhový bod.
Srovnání KL/t/bootstrap je syntetické, není přejímkou ani změnou runtime.

**Vstup:** `scripts/model-upgrade-hunt.js` · **Stav:** current v136.1 pipeline
**Autorita evaluací:** [MODEL-SCORING-ACTIVATION.md](MODEL-SCORING-ACTIVATION.md)

Aktuální cesta (21. 9. 2026) odděluje **sběr**, **průzkumné skóre** a
**přijaté rozhodnutí**. Běžný hunt i ruční „Nový test“ používají stejný plán:

1. discovery a technická způsobilost pro roli, pull s 40 GiB diskovou rezervou;
2. ověřený prázdný GPU slot a měření umístění při 16 384 tokenech, maximálně
   22 000 000 000 bajtů modelové VRAM; nejde o kvalifikaci většího provozního kontextu;
3. D1, D2, R1, R2 a CHAT: celá odlišná sada, třikrát, uložené odpovědi bez
   volání sémantického soudce. Tyto požadavky nefiltrují krátké jazykové/JSON sondy;
4. CODE a VISION: celá sada třikrát, deterministické orákulum, pouze průzkumné skóre;
5. rozhodnutí a retence až s přijatou evidencí pro přesný kontrakt. Chybějící
   přejímku sběr nenahrazuje; automatická změna rolí se tím nezapíná.

Sběr se průběžně ukládá do stávající append-only historie. Databázový
`BLOCKED / EVALUATION_AWAITING_REVIEW` znamená blokované známkování;
API a Studio zobrazují `AWAITING_REVIEW`, počet odpovědí a jejich detail.
Nejde o zamítnutí modelu. `COLLECTION_PARTIAL` uchová i přerušené pokusy.
Neplatná identita/transport ani vyčerpaný výstup se nemění v obsahovou nulu.
Hotový sběr se při stejném digestu, roli, kontraktu a provideru neopakuje;
ruční nový test vynutí nový sběr. Staré výsledky se nepřepisují.

V Evaluaci nebo Historii otevři detail a „Zobrazit uložené odpovědi“.
Pro nezávislé posouzení lze z přesných run ID vyexportovat zadání, kritéria
a odpovědi bez identit modelů (výstupní adresář musí být nový):

```bash
node scripts/model-answer-review.js --db=/absolutni/cesta/db.sqlite \
  --out=/absolutni/cesta/nova-revize --run-id=eval_ID
```

`answers-for-review.json` patří hodnotiteli; `identity-key.private.json`
uchovej zvlášť až do zmrazení známek. Jde o export, nikoli import známek
nebo přejímku hodnotitele. Sebeidentifikaci uvnitř odpovědi export nerediguje.
Pět rolí s otevřenými odpověďmi zatím záměrně nevydává automatické skóre.

Rezervu 40 GiB vynucuje i společná cesta ručního stažení, přiřazení a obnovy
přerušeného pullu. Neznámá kapacita nebo nedostatečná rezerva zastaví požadavek
před kontaktem s providerem. Během přenosu se kontroluje i zbývající velikost
dosud oznámených vrstev a každé dvě sekundy dostupné místo. Přerušení zachová
záznam účinku pro pozdější obnovu; samo nemaže částečné vrstvy ani jiné modely.
Je to kontrola aktuálního místa, nikoli transakční rezervace proti cizím zápisům.
Pokles pod rezervu během přenosu může před příští kontrolou krátce překročit
hranici. Průběhový NDJSON buffer je omezený na 1 MiB.

Měření již staženého modelu požaduje při startu 8 GiB dostupné RAM a 12 GiB
disku. Za běhu se zastaví pod 4 GiB RAM nebo 12 GiB disku a uchová checkpointy.
Proto lze při 32 GiB volného disku měřit místní model, ale nelze začít další pull.

Discovery/ranking není score. CPU spill znamená nezpůsobilost konkrétního
paměťového profilu, nikoli automatický souhlas s odstraněním modelu.
D1, D2, R1 a R2 mají odlišná zadání a kontrakty.

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
Starý záznam zůstává historií; běžný hunt není vynucené přeměření.
Ruční „Nový test“ dnes vytvoří nový append-only běh stejného kontraktu
s novým response-bound důkazem. Historii nemaž ani nepřepisuj.

## Reprodukovatelný provider

Původní patch `0cb3844557c2cbf0beac555da0147279eebd9488` je v
[`patches/ollama/0001-chat-response-manifest-digest.patch`](../patches/ollama/0001-chat-response-manifest-digest.patch).
[`scripts/build-ollama-evaluation-provider.sh`](../scripts/build-ollama-evaluation-provider.sh)
obnoví přesný commit nad tagem `v0.34.2` (volitelně také
`OLLAMA_PROVIDER_TAG=v0.34.0` nebo `v0.32.14`), vyžaduje Go 1.26.7
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
`INTENTSMITH_ENABLE_ONLINE_DISCOVERY=false` vypne i tuto kontrolu.

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
nemění binding. Operátorem autorizované `--prune-rejected` odstraňuje pouze
artefakty s ověřenou celkovou nevhodností; detail je níže. Dokumentace
nepřipíná přesný příští timestamp, protože jej po každém reloadu může změnit
`RandomizedDelaySec`.

## Bootstrap a nové modely

První `--bootstrap --shortlist` (nebo `--run --bootstrap --limit=N`) uloží dostupný katalog do append-only
`model_hunt_catalog` jako `BOOTSTRAP`. Datum je čas prvního pozorování,
nikoli vymyšlené datum vydání. Pozdější dosud neviděné modely nebo katalogové
revize jsou `INCREMENTAL`. Výpadek discovery nesmí sám založit prázdný bootstrap.

Po stažení si plný digest převezme původní cohort a čas pozorování odpovídajícího
katalogového otisku stejného jména. Z historického modelu se samotným stažením
nestane novinka; plný digest pro scoring a lokální journal zůstává zachovaný.

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

Zůstává 40 GiB disková rezerva. Ruční běh bez `--prune-rejected` nic nemaže. Bootstrap může
pokračovat v několika vlnách; nedostatek disku je `STORAGE_BLOCKED`, nikoli
kvalitativní verdikt. Prázdný nebo již dokončený tick neměří incumbenty.

Operátor 2026-09-12 výslovně autorizoval úzké automatické mazání.
`--prune-rejected` provede úklid před discovery i po dokončení dávky;
`--run --prune-rejected --prune-only --scheduled` provede jen úklid bez inference.
Noční service používá `--prune-rejected`. Kritéria a zbývající review:
[Decision 048 — uchování kandidátů](decisions/048-reproducible-evaluation-provider.md#výslovná-aktivace-operátorem-2026-09-12).

CPU spill nyní končí `RETENTION_CONTEXT_SPECIFIC_GPU_UNFIT`: model se ponechá,
protože chybí důkaz nevhodnosti i při menším kontextu. Kvalitativní odstranění
vyžaduje přejímku příslušných profilů; nepřijatá sada končí
`RETENTION_SUITE_NOT_READY` a model se také ponechá. K odstranění může vést jasná
prohra ve všech použitelných rolích na aktuálním provideru, GPU, kontextu a
sadách proti aktuálním digestům incumbentů. Chybějící data, timeout, remíza,
INSUFFICIENT_EVIDENCE, vítězství v jedné roli a chráněný rollback znamenají
ponechat. Podmínky se znovu ověří uvnitř registry těsně před efektem.
Historie a rejection receipt zůstávají v DB; stejné zamítnuté katalogové revize
se za stejných podmínek znovu nestahují. Nedostatek místa sám mazání nepovoluje.
Starý CLI `--allow-removal` je alias této úzké cesty, nikoli povolení inline
mazání částečných candidate trials. Serverový age-based cleanup zůstává oddělený.

Nová měření ukládají `metadata_json.provider.version` a API/report ukazují
`providerVersion`. Starší evidence má `UNRECORDED`. Aktuální default build
0.34.2-intentsmith.1 má SHA
`2b98fceffbc6d5d97a6e96ddfd46c597cee4fa06a03d740fdb74dd9a34ff0f92`;
linux amd64 native archive má SHA
`e155b83589986d2c581fdbf1381ea3ebdb16549883679cd5a0627f7cdc05b12b`.
Podporovaný provider popisuje [Decision 048](decisions/048-reproducible-evaluation-provider.md).

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
cgroup. Samotný sidecar nepoužívá user namespaces; spustitelná CODE orákula
mají vlastní izolaci a vyžadují ověřený oddělený síťový namespace.
Při ukončení dávky se procesy zastaví. Provider log a JSON report
zůstanou v `~/.local/state/intentsmith/model-hunt/run-*/`.

Výchozí runtime je
`~/.local/share/intentsmith/evaluation-provider/0.34.2-intentsmith.1`;
`INTENTSMITH_EVAL_RUNTIME` dovoluje explicitní jinou cestu ke stejné
ověřené binárce. Potřebuje `bin/ollama`, odpovídající `lib/ollama` a
`native.sha256`. Manifest vzniká z ověřeného upstream archivu při instalaci.

Scoring a čtení inventory používají sidecar. Pull používá systémový
`127.0.0.1:11434` přes stejnou durable mutation autoritu; oba procesy musí
číst `/usr/share/ollama/.ollama/models` (nebo explicitní `OLLAMA_MODELS`).
Každý artefakt se po pullu znovu řeší přes evaluační inventory a response
proof. Nesdílený sklad tedy nevytvoří COMPLETE. Systémová Ollama při této
cestě neprovádí scoring. Rozdělení je podle odpovědnosti a účtu, nikoli podle
stáří verze: při kontrole 2026-09-12 oba endpointy hlásily
`0.34.0-intentsmith.1`. Verze `/api/version` sama neprokazuje response-bound
identitu; tu musí dodat každá měřená odpověď. Systémový upgrade zůstává
samostatná instalační operace.

Nasazení 21. 9. 2026 má evaluační `.34.2-intentsmith.1` a systémovou
`.34.0-intentsmith.1`. Read model zobrazí výsledky evaluační verze, ale
odlišná systémová verze nemá kvalifikaci pro aktivaci těchto výsledků.
Aktuální měření a hranice nasazení shrnuje
[packet sběru pod dohledem](review/2026-09-21-HUNT-SUPERVISED-COLLECTION.md).

Po změně suite kontraktu se starší COMPLETE zachovají jako historie.
Chybějící aktuální incumbent není předpokladem pro pád: párový runner jej
doměří po kandidátovi. Pokud některá inference selže, neúplná role nevytvoří
rozhodnutí; ostatní role pokračují a hotový kandidátův souhrn zůstane v DB.
Příští pokus jej může znovu použít a doměřit incumbenta. Journal zůstává
RETRYABLE s obvyklým 24h odstupem. Úplné pokrytí panelu před timerem šetří
měření, není však podmínkou samotného spuštění duelu. Retence vyžaduje vlastní
úplné aktuální důkazy; tento retry režim nepovoluje mazání z FAILED.

Šablona timer service používá tento wrapper. Před zapnutím proveď například:

```bash
INTENTSMITH_DB_PATH=/absolutni/provozni.db node scripts/model-upgrade-hunt.js --bootstrap --shortlist --json
INTENTSMITH_DB_PATH=/absolutni/provozni.db node scripts/run-model-hunt-provider.js --run --installed-panel --role=CODE,VISION --limit=10 --scheduled --keep-inconclusive
```

Reprodukovatelná instalace uživatelského runtime používá
`scripts/install-user-evaluation-runtime.sh PATCHED_BINARY UPSTREAM_ARCHIVE`.
Archiv je oficiální `ollama-linux-amd64.tar.zst` z
[release v0.34.2](https://github.com/ollama/ollama/releases/tag/v0.34.2).
Instalátor kontroluje oba připnuté SHA před rozbalením a odmítne přepsat
existující runtime. Systémovou službu a modelový sklad nemění.

Aktuální šablona plánuje nejvýše dva kandidáty denně ve 03:00 místního času
s náhodným odkladem do 15 minut. `Persistent=false` brání dohánění zmeškaného
nočního běhu hned při pracovním startu počítače. Obsazený sidecar port,
evaluační lock nebo GPU vytvoří `SCHEDULED_SKIPPED`; nevyvolají další modelový
request. Uvolnění modelu používá prázdné `messages` + `keep_alive:0`, tedy
provider unload bez další inference nebo změny contextu.
