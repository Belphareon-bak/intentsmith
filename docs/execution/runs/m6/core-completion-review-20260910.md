# Uzavřená dávka k review — 2026-09-10

Stav: dvě souborové schopnosti implementované; review kandidátu `ffa17a4a`
skončilo bez blokujícího nálezu. Čtyři drobné nálezy jsou opravené v
`cf4f4322` a úzké následné review je přijalo. Nejde o finální přijetí M2 ani
vydání IntentSmith. Test-trust commit `c108da86` a restore základ `65bcbc4b`
prošly úzkým review. Jediný drobný restore follow-up je implementovaný v
`b4136a43` a čeká na review.
Rozsah dokončeného review vůči `7dacd466`: výpis kořene projektu a vysvětlení
schváleného souboru. Pokus o stručnější SPEC byl vrácen; původní prompt je
byte-identický.

## 1. Výpis projektu

Chat předloží přesný kořen ke schválení. `file.list@2` a úzce omezený
`EffectRequest@2` vrátí jména a typy přímých potomků, včetně skrytých položek,
nejvýše 10000 položek a 1 MiB. Nečte obsah souborů, nerekurzuje a nenásleduje
symlinky; neúplný výsledek se nepublikuje. Po schválení se uloží přesný snapshot.
Opakované zobrazení po změně adresáře používá uložený výsledek. Neplatné UTF-8
názvy mají přesné hex zobrazení, řídicí znaky jsou viditelné.

Migrace 110 přidává immutable output a tombstone. Staré read/write kontrakty,
read@2 a předchozích 96 migrací zůstávají. Aktuální počet migrací je 97,
tabulek 173 včetně SQLite interní tabulky (172 aplikačních).

## 2. Vysvětlení souboru

Po přesném schválení read@2 se D1 předají celé ověřené uložené bajty a původní
dotaz. Jde o jedno omezené volání bez náhradního čtení, zkracování souboru nebo
retry. Uložené navázání na původní dotaz přežije restart; hotové vysvětlení lze
obnovit bez další inference. Cizí metadata v historii ani uživatelský JSON
nemohou takové navázání vytvořit. Scope a zrušení se kontrolují po modelu i
před uložením. Neúplná odpověď, binární data či příliš velký vstup selžou.

Skutečný modelový demo běh této schopnosti je **NOT_RUN**. Integrační testy
používají skutečnou SQLite, grant, claim, filesystem provider a chat finalizer,
ale odpověď D1 je řízená fixture. Souběžná inference stejné operace je blokována
v procesu; nejde o trvalou exactly-once záruku inference při pádu před uložením.

## 3. SPEC — experiment uzavřen bez přijetí

Pokus `ea309f08` prošel 170 offline kontrolami, ale původní kuchařka na soukromém
`4bc685e7` skončila 14 PASS / 17 FAIL: model vracel i nesprávné typy polí,
chybějící alternativy a později timeouty. Původní source obnovuje `4410c360`.
Raw odpovědi, neúspěšný report a úklid scope jsou zachovány. Časová mezera přes
noc zůstává v důkazech; nevyvozujeme z ní příčinu ani srovnání rychlosti.
Hlavní kontext 4096 a výstup 4000 se nezměnily. Další modelový pokus neběží.

## Ověření a důkazy

Společný původní běh `2ceaf152` má **351 PASS / 1 FAIL**, bez blokací či přeskočení. Jediný FAIL je dokumentační census a chybějící řádek migračního manifestu; žádný produktový program neselhal. Dokumentační údaje byly doplněny a samostatná kontrola má 158/158 PASS; původní registrovaný program je opakován v `core-documentation-closeout-20260910-01`. Původní neúspěšný report zůstává zachovaný; nejde o nový společný výsledek 352 PASS.

Následné review kandidátu `ffa17a4a` nezávisle zopakovalo osm relevantních sad:
**309 kontrol / 0 selhání**. Ověřilo také census, 97 migrací, změnu 171→173
tabulek, 1302 hran modulového grafu, byte-identický SPEC revert, právě jeden
modelový pokus a bezpečnostní hranice `file.list@2`. Čtyři neblokující nálezy
jsou v `cf4f4322` opravené: prototype guard výstupního důkazu, bezpečná práce s
non-Error rejection, nezávislost běžného read resume na metadatech vysvětlení a
kanonický claim key. Cílené post-fix ověření má **29/29 contract, 39/39 file
consumer a 36/36 persistence PASS**. Přímý pipeline runner hlásí **47/47 PASS**.
Dříve zapsaných 52/52 vzniklo jen v měřicím wrapperu, který před importem
dosadil `globalThis.fetch`: pět asynchronních případů pak doběhlo před předčasným
`summary()` této legacy suity. Tento výsledek se nepoužívá jako důkaz. Module
boundary ratchet zůstal na 1302 hranách a 3 cyklech / 28 členech; sleduje pouze
hrany `src/` → `src/`, nikoli nový import z `src/` do `contracts/`.

Test-trust follow-up `c108da86` odstranil příčinu proměnlivého součtu:
`chat-pipeline` i sesterský `chat-output-quality` nejprve zaregistrují případy
a potom je sekvenčně dokončí před `summary()`. Pipeline má v síťově odděleném
namespace **52/52 PASS**, output-quality **46/46 PASS** a žádný model nebyl
načten. Jde o test-only kandidát čekající na review; nemění produktové chování.

Backendový snapshot má 233 cílených PASS a 11 plných produkčních migračních
kontrol; předintegrační FILE_EXPLAIN má 36/36 a M1 companion 29/29. To jsou
samostatně připnuté důkazy, nesčítají se do výsledku společného kandidáta.
Modulový graf má 1302 hran; 20 přesně revidovaných nových hran, žádná odebraná,
stále 3 cykly / 28 členů. Formatter zůstává v existujícím handleru, aby nepřidal
nového člena cyklu. Dřívější nález schvalovacího preview a chybné migrační
oracly zůstaly zachované spolu s opravami.

Lokální důkazy jsou pod `.intentsmith-artifacts/core-completion-20260909/provider-proposal/`:

- `file-functions-integration-20260910/` — integrace, přesun formatteru,
  census, společný běh a uzavření SPEC experimentu;
- `m2-file-list-completion-7dacd466/handoff.json` a
  `independent-release-backend-review-baa9ca45.json`;
- `m2-file-list-consumer-7dacd466/root-integration-source-review-remediation.json`;
- `m2-file-explain-completion-7dacd466/handoff.json` a
  `root-independent-review-final08.json`.

## Co zbývá mimo tuto dávku

Skutečné modelové vysvětlení, modelová kuchařka a společná release evidence na
následném kandidátu. Restore follow-up `b4136a43` čeká na úzké review.
Předchozí fresh-clone 4/4 patří source 7fa6f985; nevydáváme jej za nové měření.
Dřívější dlouhý soak na 193e2351 pokračuje odděleně. Poslední přečtený heartbeat
má 15 hodin aktivního času / 54007 požadavků / 0 chyb; wall-clock běh zahrnuje
uspání stroje a není 24hodinovým výsledkem. Konečný výsledek ještě není k dispozici.
Otevřené návrhy SPEC 6000 a projectless-web nebyly schváleny. M5 vnější
podmínky, podpisy a M7 fyzické ověření zůstávají samostatné. Nic se neposílalo,
nepodepisovalo, nenasazovalo ani nemigrovalo v živé databázi.

## Navazující autonomní milník — obnova podporované živé DB

Operátor následně výslovně obnovil autonomní dokončování. Read-only inventura
živé DB ukázala 88 migration stampů a tři historicky vydané identity `061`,
`062` a `068`, které současný 97-souborový manifest už neobsahuje. Po aplikaci
12 chybějících současných migrací má legitimní historie 100 stampů. Původní
restore kontroloval jen aktuální manifest, takže by zálohu této podporované
historie odmítl jako neznámé schéma.

Commit `65bcbc4b87301e8e1279953611a99a9538a5a8a7` přidává přesný uzavřený
seznam těchto tří historických identit. Libovolná jiná neznámá migrace zůstává
odmítnutá. Ověření na tomto exact commitu:

- `m5-data-restore`: 19/19 PASS;
- `pre082-upgrade-regression`: 1/1 PASS;
- `schema-migrations`: 55/55 PASS;
- `module-boundary-ratchet`: 13/13 PASS, 1302 hran beze změny;
- čistý `m6-previous-version-upgrade.e2e`: PASS; previous 56, úmyslně
  přerušený upgrade 80, ověřený restore a current 97 migrací;
- privátní projekce skutečné živé DB: 88→100 stampů, 188 tabulek a bajtově
  shodný backup→poškození→restore, `integrity_check=ok`, 0 FK porušení.

První přímý E2E pokus skončil před spuštěním produktu na prázdné offline npm
cache (`ENOTCACHED zod 3.25.76`). Opakování použilo dříve naplněnou izolovanou
cache a prošlo; oba výsledky zůstávají zachované. Relevantní lokální důkazy:

- `provider-proposal/m5-backup-compat-65bcbc4b/m6-previous-version-upgrade.log`,
  SHA-256 `79a35f87f5fd5bd895ec77f57b1221bf75b77dc8dce32ad42e936143e4fd5c74`;
- dekódovaný E2E receipt, SHA-256
  `a48c8b6ab5a9592d562193fd832261c122962f39d350c22bca7daa6ca6e9051a`;
- `provider-proposal/m5-current-preflight-2bd1a281/migration-rehearsal/backup-restore-roundtrip.json`,
  SHA-256 `05bbdc1d18c30710728eae5d410e644e20c336d134db820066750e47bde3f89c`.

Živá DB, služba, model bindings, klíče i Git historie zůstaly beze změny;
senzitivní DB projekce byly odstraněny. Review přijalo tento restore základ a
našlo jednu drobnou mezeru v duplicate guardu; navazující `b4136a43` ji opravil
a má 20/20 restore, 1/1 pre-082, 55/55 schema a 13/13 boundary PASS. Stav je
`BACKUP_COMPAT_REMEDIATION_IMPLEMENTED / RE_REVIEW_REQUIRED`. M5 dál blokuje offline
custody, historie, provider receipts a acceptance. FILE_EXPLAIN modelový běh
čeká na konec odděleného soaku.

## Následné úzké review a operátorská rozhodnutí

Review potvrdilo, že `c108da86` správně awaituje všech 52 deklarovaných pipeline
případů; starých 47 nebyl platný menší rozsah, ale tiché podhodnocení. Čtyři
další nalezené ruční async harnessy žádný případ neztrácejí. Test-trust má proto
stav `REVIEW_PASSED`.

U `65bcbc4b` review nezávisle potvrdilo tři historické stampy, tvarovou
kompatibilitu náhradních migrací i 88→100 restore důkaz. Drobný nález byl, že
source migration se stejnou identitou jako historical allowlist mohl projít
přes `Set`. `b4136a43` kontroluje duplicity po sjednocení a přidává negativní
test se skutečně znovuzavedeným `061` ID. Tento nový commit je implementation
green a čeká na úzké review.

Operátor zvolil `retain_and_rotate`. History receipt zatím nevzniká: nejprve je
nutné doložit všech osm kategorií credentials a přesunout podpisové klíče do
offline custody. Pro budoucí custody je určen samostatný celý LUKS2 disk;
aktuální JV-Drive zůstává NTFS a slouží oddělenému účelu. 16 GB pro klíče,
13 receipts a manifesty postačuje s velkou rezervou, reviewer key však vyžaduje
fyzicky oddělenou custody.

### Zachovaná hranice přímého chat probe

Při navazujícím ověřování 2026-09-10 přibližně v 14:35 UTC byl
`chat-pipeline.test.js` jednou omylem spuštěn přímo bez síťového oddělení.
Systémový provider krátce načetl `qwen3.5:27b`; textový výsledek byl 50/52 se
selháním REPORT klasifikace a sticky SEARCH pokračování. Model byl ihned přes
`ollama stop` odložen a následný `ollama ps` i NVIDIA compute census byly
prázdné. Tento probe není release ani model-quality důkaz a jeho souběžný
sběrač vrátil nekonzistentní process status; řízený loopback fake-provider
následně potvrdil, že stejný runner při 49/52 končí exit 1.

Long-soak proces nebyl zastaven a jeho poslední heartbeat zůstal 54007/0.
Decision 038 výslovně vyjímá Ollamu/GPU z této evidence, soak běží v odděleném
loopback-only network namespace a měří RSS vlastního server child procesu.
Krátká cizí GPU rezidence proto není porušením jeho strojového kontraktu;
zůstává zde uvedená, aby reviewer mohl případně požadovat přísnější opakování
na zcela klidném hostu. FILE_EXPLAIN launcher ji nadále blokuje explicitním
host-level process a GPU preflightem.
