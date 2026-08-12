# 020 — D+ failover nemá podporovaný typovaný opt-in povrch

- **typ:** BLOCK pouze pro uživatelské zapnutí D+ failoveru
- **stav rozhodnutí:** E PŘIJATO operátorem 2026-08-09 s korekcemi legacy
  round-tripu a rozsahu drop; A samotné nezajišťuje jedinou policy autoritu
- **WP:** WP-M1-MODEL / B3-FAILOVER
- **rail:** R1, R3, R5, R6
- **vzniklo při:** post-checkpoint call-graph kontrole `updateModelSettings()`

## Evidence na stole

`src/db/user-settings.js:updateModelSettings()` je jediný writer, který:

- mění pouze vlastněnou `models` sekci v jedné `BEGIN IMMEDIATE` transakci;
- zachová všechny ostatní sekce;
- odmítne neznámé modelové klíče a neplatné hodnoty;
- neumožní přepsat malformed dokument.

V produkčním `src/` jej ale nic nevolá. D+ detection scheduler proto lze dnes
zapnout jen přímým zápisem do DB nebo obecným `POST /api/settings`.

Obecná route v `src/routes/misc.js` je autoritou backup/import/reset celého
dokumentu: tělo bez validace uloží přes `INSERT OR REPLACE` a potom je předá
feature manageru. Skutečný in-memory route probe skončil exit `0` a prokázal:

1. POST dokumentu s `models.autoFailoverEnabled=true` vrátil 200, policy byla
   `VALID/enabled` a neznámý `models.foreignKey` zůstal uložený;
2. navazující POST `{}` vrátil 200, odstranil všechny klíče dokumentu a policy
   přešla na validní default `false`.

Navazující review našlo další tři produkční read-modify-write cesty stejného
řádku: storage settings v `src/routes/system.js`, webhook secret v
`src/routes/security.js` a notification config v `src/routes/notifications.js`.
Všechny čtou JSON a později zapisují celý řádek bez společného transaction/CAS
seamu. Typed PUT podle původní varianty A by proto nebyl jedinou autoritou:
legacy POST může policy validně zapnout, vypnout nebo přepsat stale snapshotem
a ostatní writery mohou novější modelovou změnu ztratit. Samostatný
`POST /api/reset` navíc celý řádek maže. Celkem tedy existuje pět živých
mutation cest nad stejným blobem.

`readModelSettings()` navíc ověřuje pouze hodnotový tvar známých klíčů. Neznámé
modelové klíče ignoruje a nedokládá, který writer změnu provedl. Pouhá validace
modelové sekce v původní variantě B neřeší validní `true`, lost update ani
provenance; A+B v tomto znění tedy také nestačí.

Tento reset je živá funkce Studio runtime
(`c3-ide/extensions/c3-chat-panel/lib/browser/chat-panel-module.js`): tlačítko
„Obnovit výchozí“ záměrně posílá `{}`. Import a běžné Studio/legacy UI save
posílají celý snapshot. Změnit POST na merge by tedy nebyla interní oprava;
změnilo by to veřejnou backup/import/reset sémantiku.

Detection coordinator sám zůstává fail-closed: bez literal `true` neprovede
inventory ani zápis a policy kontroluje znovu uvnitř každé durable transakce.
Chybí podporovaný způsob, jak uživatel opt-in bezpečně a jednoznačně nastaví.

## Varianty

| Varianta | Chování | Dopad | Cena přepnutí |
|---|---|---|---|
| **A — samostatná typed model-policy route** | Přidat exact `PUT /api/system/models/settings`; body smí nést pouze modelové policy klíče a volá `updateModelSettings()`. | Nutný vstupní povrch, ale při dnešním společném JSON řádku není výhradní autoritou. | Route/focused test; bez další ochrany zůstává overwrite cesta. |
| **B — validovat modelovou sekci v obecném POST** | `POST /api/settings` zůstane full replacement, ale před zápisem validuje `models` a odmítne neznámé klíče. | Odmítne malformed data, ale stále dovolí validní aktivaci a stale last-writer-wins. | `misc.js`, backup/import/reset testy; neřeší ostatní writery. |
| **C — změnit obecný POST na merge** | Chybějící sekce se zachovají; explicitní reset dostane nový endpoint nebo flag. | Řeší část lost-update problému, ale mění živý veřejný kontrakt a všechny settings klienty. | `misc.js`, Studio `lib`, legacy UI, backup/import/reset a route testy. |
| **D — pouze DB/CLI opt-in** | Produkční UI/API nevznikne. | Interní mechanismus zůstane pro běžného uživatele nedosažitelný; není to prod-ready výsledek. | Bez kódu, ale M1 zůstává BLOCKED. |
| **E — oddělená failover-policy storage + typed route** | D+ opt-in má vlastní versioned/CAS řádek a jediný repository writer; obecné settings jej neumí aktivovat ani přepsat. Export/import/reset dostanou explicitní verzovaný adaptér přes stejný repository seam. | Jediná prokazatelná writer provenance bez přepisování živého settings kontraktu. Failover lze default-off migrovat bez důvěry ve starý nevalidovaný klíč. | Aditivní migrace, failover-policy repository/read model, typed route a explicitní backup/import/reset integrace. |

## Doporučení

**E.** Původní A je nutná route, nikoli dostatečná storage autorita. Oddělená
`model_automation_policy` storage je menší než refaktor všech historických
settings writerů a jako jediná brání tomu, aby obecný POST nebo stale merge
policy zapnul či přepsal. D+ tabulka musí začít default-off; žádné staré
`user_settings.models.autoFailoverEnabled=true` se automaticky nepovýší na
důvěryhodný opt-in.

Projection nese revision a `last_event_id`; každá změna má repository-owned
request ID, actor/source a shodný append-only audit event. Reader přijme pouze
projekci odpovídající eventu, jinak vrátí typovaný invalid/default-off stav.
Typed GET/PUT používá exact tři dnešní automation klíče, expected revision a
CAS. Scheduler i cleanup čtou pouze tuto autoritu.

Obecný `/api/settings` policy nikdy nemění. Backup/import/reset parity se
zachová pouze explicitním verzovaným adaptérem, který volá tentýž repository
commit point; běžný full-document save policy neovládá a globální reset vytvoří
auditovaný přechod na OFF. Přesný způsob, jak generic POST policy neovládne, je
níže v operátorské korekci — **není** to odmítnutí requestu.

Samotná route ještě neaktivuje fallback. Pouze zpřístupní uživatelský opt-in
pro již implementovaný detection-only scheduler; PASS proof, threshold/TTL a
terminal activation zůstávají samostatně blokované rozhodnutím 015.

## Povinné negativní důkazy varianty E

- generic POST s validním `models.autoFailoverEnabled=true` vrátí `200`, ale
  vlastněný klíč sanitizuje, uvede jej v `ignoredReservedKeys` a nevytvoří
  policy ani provider efekt;
- stale Studio snapshot ani generic `{}` policy nezmění;
- unknown key, string `"true"` a neplatné cleanup days selžou bez mutace;
- missing/stale revision skončí konfliktem a dva WAL writery mají jednoho
  vítěze;
- projekce bez shodného audit eventu je invalid/default-off;
- preexisting legacy `models.autoFailoverEnabled=true` zůstane po migraci OFF;
- generic POST s vlastněnými klíči vrátí `200`, `ignoredReservedKeys` a
  neuloží je; nevlastněný klíč uvnitř `models` přežije beze změny;
- `featureManager` nikdy nedostane nesanitizovaný `body`;
- neúspěšný Studio import/reset se projeví jako chyba, ne jako tichý úspěch;
- storage, notification a webhook writer policy nezmění;
- neúspěšný explicitní import rollbackne general settings i policy;
- explicitní reset zapíše právě jeden auditovaný přechod na OFF;
- restart zachová policy, revision a event lineage.

Vlastněné cesty jsou nová aditivní policy migrace, nový
`src/db/model-policy.js`, model failover/registry readers, typed route v
`src/routes/system.js`, rezervované pole a explicitní import/reset v
`src/routes/misc.js` a pozdější autoritativní Studio consumer.

## Operátorská korekce 2026-08-09 — drop místo reject

Původní znění chtělo, aby obecný POST rezervovaný `models` odmítl. To by
rozbilo živý round-trip: `GET /api/settings` vrací celý syrový řádek a Studio
`_saveBCfg()` posílá zpět nezměněný dokument, který z GET dostalo, debounced při
každé změně nastavení. Na každé instalaci, kde `models` v řádku už existuje, by
se každé uložení nastavení stalo `400`; totéž potká export→import.

Přijaté chování je **drop**, a to jen v rozsahu vlastněných klíčů:

- generic POST strhne právě tři vlastněné automation klíče
  (`autoFailoverEnabled`, `autoCleanupEnabled`, `autoCleanupDays`) a nikdy je
  neuloží; zbytek objektu `models` se zachová beze změny, aby se neztratily
  cizí ani budoucí hodnoty, které dnešní reader ponechává;
- generic GET vlastněné automation klíče neemituje, takže je klient nemá čím
  poslat zpět;
- do `user_settings` i do `featureManager.applySettings()` jde **sanitizovaný**
  dokument, ne původní `body`; jinak by policy ovlivnila runtime, i když se
  neuložila;
- odpověď uvádí `ignoredReservedKeys`, aby drop nebyl tichý;
- Studio import i reset musí kontrolovat `response.ok`; dnešní volání výsledek
  ignorují a tichý neúspěch by vypadal jako úspěšné obnovení;
- export/import/reset policy prochází výhradně verzovaným adaptérem a je
  atomický vůči general settings;
- migrace startuje default-off a legacy hodnotu zachová nebo umístí do
  karantény, nikdy ji nepovýší na důvěryhodný opt-in;
- na novou repository autoritu přejdou **oba** produkční readery, failover
  i auto-cleanup; ponechat jednoho na starém blobu by znamenalo dvě autority;
- downgrade na starší build je explicitně nepodporovaný, nebo musí být
  guardovaný — starý reader novou tabulku nezná.

### Rezervace čísla migrace

Census se počítá jako **union přes všechny aktivní větve**, ne přes jeden
checkout. Původní rezervace `058`/`059` v `b863190a` byla před vznikem M1
migrací zneplatněna mobilními commity `e04be7f7` a `88b7b435`; mobilní větev
pak v `7916098e` commitnula i `060_mobile_approval_authority`. Aktuální mobilní
rozsah je proto `055`–`060` a ordinály `046`–`051` už navíc v historii kolidují
napříč větvemi. Tento dokument nyní výslovně rezervuje **061** a rozhodnutí
015 rezervuje **062**; obě čísla pocházejí z jednoho obnoveného census.

Pokud mobilní migrace nebudou v integračním základu dřív, než se 061/062
aplikují, musí test pokrýt i pozdější vložení `055`–`060` do databáze, která už
061/062 aplikovala.

### Přijaté sekvenční pořadí integrace

Mobilní balík se nebude integrovat předčasně pouze kvůli ordinalitě migrací.
M1 pokračuje s rezervovanými `061`/`062`; pozdější integrace mobilních
`055`–`060` je podporovaný scénář migračního runneru a stává se povinnou
acceptance evidencí obou M1 migrací.

Test musí porovnat fresh plán `001`–`062` s databází, která nejprve aplikuje
plán bez `055`–`060`, ale včetně `061`/`062`, a následně doplní právě mobilní
šestici. Musí prokázat, že druhý běh aplikuje přesně `055`–`060`, `061`/`062`
neopakuje, třetí běh je no-op, výsledné verze a relevantní schéma jsou shodné,
M1 policy/proof data zůstala zachovaná a striktní expiry hrana z 062 i mobilní
journal/instance ownership po pozdním vložení fungují.

## Implementační checkpoint storage/repository + generic drop — 2026-08-09

Migrace `061` a nový `src/db/model-policy.js` implementují první část varianty
E. Nová autorita startuje vždy `OFF/OFF/14`; tři legacy klíče se z validního
obecného dokumentu odstraní a jejich původní fragment zůstane v append-only
bootstrap eventu. Cizí klíče se zachovají a DB guard zabrání starému writeru
rezervované klíče znovu zavést bez ohledu na jejich hodnotu.

Repository vlastní čas, identity, actor/source i top-level `BEGIN IMMEDIATE`.
Projekce se posouvá přes revision CAS a odpovídající event musí vzniknout ve
stejné transakci; deferred FK a obousměrné triggery odmítnou event bez projekce
i projekci bez eventu. Dva skutečné WAL workery, kteří oba přečetli revision 1
před společnou bariérou, prokázali právě jeden commit revision 2 a jeden
typovaný stale výsledek. Registrovaná focused sada má 20/0 a migrační oracle
38/0.

Ve stejném checkpointu přešly oba produkční readery — detection repository i
auto-cleanup/overview — na tuto versioned autoritu. Generic GET/POST dropuje
přesně tři rezervované klíče, odpověď uvádí `ignoredReservedKeys` a
`featureManager` nikdy nevidí nesanitizovaný dokument. Starý JSON helper nemá
produkčního konzumenta a jeho pre-061 sada je `HISTORICAL`.

Typed `GET /api/system/models/settings` vrací pouze konzistentní projekci;
invalidní authority končí 503 bez fallbacku na legacy JSON. Exact
`PUT /api/system/models/settings` přijímá `expectedRevision` a právě tři
automation hodnoty. Neplatný nebo neparsovatelný vstup končí 400, stale revision
409 a nedostupná či nekonzistentní storage 503; žádná z těchto cest nemutuje
stav. Úspěch appenduje jediný `USER_UPDATE/TYPED_API` event.

Navazující backend checkpoint implementuje explicitní versioned adaptér přes
`GET /api/settings/backup`, `POST /api/settings/import` a
`POST /api/settings/reset`; legacy `/api/reset` používá tentýž reset commit
point. Export čte general settings i policy v jednom SQLite snapshotu. Import
a reset drží změnu `user_settings`, policy projekce a právě jeden append-only
event ve stejném repository-owned `BEGIN IMMEDIATE`. Selhání kteréhokoli
settings nebo event zápisu rollbackne celek a cizí top-level transakce je
odmítnutá před mutací.

Portable schema v1 má přesně `kind`, `schemaVersion`, `generalSettings`,
`modelAutomationPolicy` a `omittedSensitiveKeys`. Export vynechává přesné
top-level klíče `webhookSecret` a `c3.notif.smtpPass`; import jejich hodnoty
z dokumentu ignoruje a zachová lokální destination hodnoty. Full SQLite state
backup zůstává oddělený recovery artefakt. Po durable commitu se runtime
aplikuje zvlášť; jeho chyba vrací `200`, `runtimeApplied:false` a stabilní code,
nikoli retry-inducing `500` nad již provedenou změnou.

Review nad `94d2a473` prokázalo další post-commit hranu: výjimka z runtime apply
následovaná výjimkou diagnostického `logger.warn` dříve propadla do společného
repository catch a změnila již commitnutý import/reset na HTTP 500. Follow-up
oddělil repository error boundary před runtime/presentation fází a logger je
výhradně best-effort. Durable commit proto i při současném selhání runtime a
diagnostiky vrací pravdivé `200` s `runtimeApplied:false`; regresní test provádí
import i reset a ověřuje uložený stav i append-only event lineage.

Focused backend sada má 35/0. Pokrývá secret canaries, malformed/unknown schema,
foreign transaction ownership, unavailable storage, settings i event rollback,
právě jeden import/reset event a pravdivý post-commit degraded výsledek.

Autoritativní commitnutý Studio `lib` používá pouze nové explicitní endpointy.
Export kontroluje HTTP i exact envelope a před downloadem znovu odmítne oba
secret keys. Import/reset změní `_bCfg` pouze z pravdivého serverového
`ok/success/generalSettings` commitu. Výsledek mutace je explicitně
`COMMITTED`, `REJECTED` nebo `DELIVERY_UNKNOWN`: pouze doručený non-2xx smí
obnovit odložený generic save; timeout, ztracená nebo malformed 2xx odpověď
zachová lokální snapshot, ale až do nového načtení Studia uzamkne další
whole-document zápis i recovery. Společná generation/token hranice zneplatní
každý settings GET zahájený před importem/resetem. Obě mutace jsou
single-flight, object URL se revokuje a starý success timer nemůže smazat
novější chybu. FileReader error i abort mají viditelný fail-closed výsledek.
Legacy holý JSON se
zabalí do schema v1 s `modelAutomationPolicy:null`; policy tedy zachová a jeho
případné secret keys backend ignoruje. Navazující generic Studio save používá
serverem vrácený dokument včetně zachovaných lokálních secret hodnot.

VM behavior sada má 110/0 a připíná exact URL/metodu/header/timeout, obě runtime
větve, definitive reject proti nejasnému doručení, pozdní GET, secret-bearing
export, koordinaci generic save proti recovery, skutečný Backup panel,
FileReader chyby, single-flight i timer race. První Review A nad `21ffa72b`
vrátilo dvě race a stale rozsah jako `CHANGES_REQUIRED`; follow-up je lokálně
uzavírá, ale opakované read-only review a fresh-clone attestation nového
subjectu jsou stále otevřené. Nejde proto ještě o úplné uzavření 020/E.

Skutečná late-insertion parita s finálně
přečíslovanými mobilními migracemi zůstává `PENDING_FIRST_COMMON_INTEGRATION_SHA`;
syntetická náhrada nebyla použita. Aktivace, GPU a Electron nebyly spuštěné.

Source `905a3422…49a8` a exact-edge baseline `34a047d4…6638` prošly samostatným
`git clone --no-local`, offline instalací a celou relevantní deterministic
maticí; tento dílčí storage/readers/generic-drop checkpoint je
`FRESH_CLONE_VERIFIED`. Stav se nevztahuje na dosud neimplementované části
varianty E ani na Gate 1 jako celek.

## Přesná otázka pro operátora

```text
020-storage: E
020-api: typed-route
020-legacy-settings: DROP-OWNED-KEYS-NOT-REJECT
020-generic-get: OMIT-OWNED-AUTOMATION-KEYS
020-backup-import-reset: EXPLICIT-VERSIONED-ATOMIC-ADAPTER
020-migration: DEFAULT-OFF-PRESERVE-OR-QUARANTINE-LEGACY
020-reader-cutover: FAILOVER-AND-AUTO-CLEANUP
020-downgrade-policy: EXPLICITLY-UNSUPPORTED-OR-GUARDED
```

Operátor tento blok přijal 2026-08-09. Implementace 020 je odemčená v rozsahu
varianty E a výše uvedených korekcí.

## Bezpečnostní korekce 2026-08-10 — schema v1 není bezpečný portable formát

Navazující adversarial review vyvrátilo tvrzení předchozího checkpointu, že
odebrání dvou top-level klíčů stačí pro přenosnou zálohu. Živý Architect
dokument obsahuje nested Telegram, Slack, Discord, webhook a SMS credentials i
destinations; Studio a budoucí writery navíc mohou přidat flat nebo neznámé
varianty. Schema v1 proto zůstává pouze vstupní compatibility formát a **už se
nesmí exportovat**. Historický Review A report nad `06e760bb` je v tomto bodě
superseded; nepřepisuje se.

Opravný WP zavádí schema v2 s jedinou backendovou default-deny autoritou
`UX_PREFERENCES_V1`. Artifact nese exact source-derived sparse mapu tvořenou
pouze skutečně přítomným subsetem jedenácti podporovaných JSON Pointer cest:

- appearance: accent color, font family, font size a theme;
- Architect output: code style, default format a naming convention;
- Studio: language a tři rendering booleany.

Location/account, identity, notifications, secrets, destinations,
memory/retention, provider/model, device/storage, feature/effect policy a
všechna neznámá pole zůstávají local-only. `omissions` je fixní serverový popis
default-deny strategie, nikoli autorita dodaná artifactem. V2 odmítne chybějící
nebo extra envelope pole, neznámou portable cestu a neplatnou hodnotu před DB
mutací. Absence podporované cesty je naopak významná: export nesmí vyrobit
default, který na zdrojové instalaci nebyl uložen, a import takovou destination
hodnotu zachová. V1/raw import se projektuje stejným allowlistem a jeho omission
metadata se ignoruje. UI viditelně přizná počet source cest, které compatibility
projekce ignorovala.

Backend import načte destination uvnitř vlastního `BEGIN IMMEDIATE`, overlayne
jen portable profil a ve stejné transakci commitne policy i event. HTTP response
už nepublikuje názvy default-denied cest, pouze jejich počty. Klienti vyžadují
exact policy/event/path provenance, než změní lokální snapshot.

Stejný explicitní backup/import kontrakt teď konzumují všechny tři nalezené
first-party UI plochy: autoritativní Studio chat panel, Studio Center Views a
`/architect`. Center Views už neexportuje `/api/system/info` config ani
nereplayuje import po jednotlivých klíčích přes WS. `/architect` už
neserializuje celý credential-bearing `settingsState`, po serverovém readu
neoverlayuje stale localStorage a během nejasného recovery výsledku blokuje
generic save. Nepravdivý full-backup/factory-delete ovládací prvek nevytváří
efekt.

Receipt se nepřijímá jen podle tvaru. Každý klient porovná schema verzi,
source-derived seznam i hodnoty portable cest, případnou vstupní policy,
exaktní actor/source, shodu `policy.lastEventId === event.eventId` a počet
ignorovaných source cest. Reset vyžaduje prázdný committed dokument a přesnou
default-off policy. Architect committed snapshot přebírá data-property-safe,
znovu materializuje své UI defaulty a generation fence odmítne settings GET,
který začal před importem nebo resetem.

Tato korekce nezavírá obecný settings authority problém. Generic GET stále
vrací celý secret-bearing řádek, import response kvůli dnešnímu whole-document
klientovi vrací destination dokument a několik RMW writerů nemá společný CAS.
Je to samostatný P1 [Finding 011](../findings/011-user-settings-authority-and-secret-exposure.md),
který blokuje Gate 1 exit. Opravný source candidate proto čeká na Review A a
fresh-clone důkaz a nesmí být prezentován jako úplné uzavření 020/E.

## Terminal target activation — 2026-08-12

Promované 025/029 drží settings/reset autoritu na exact canonical tipu
`6c36607421c013dd27f41e35853009bcaa0b5b51`. Terminal B3 smí přidat
samostatný versioned per-role target CAS v migraci 065. Target není portable:
backup/import jej nepřenáší a destination jej zachová; explicitní dual-CAS
reset jej čistí. Generic settings, `user-settings.js` ani portability schema
se znovu neotevírají. Toto je activation scope, ne tvrzení, že target writer či
automatic effect už existuje.
