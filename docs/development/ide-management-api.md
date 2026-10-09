# Backend nových funkcí IDE

Stav: implementační kandidát WP-IDE-BACKEND-20261009. Frontend ani release
přejímka nejsou součástí tohoto WP. Rozsah Discord/Telegram vychází z přímého
rozhodnutí operátora 2026-10-09, zapsaného v PRODUCT/DIRECTION.

## Transport a trvalý stav

Nové správcovské endpointy vyžadují skutečnou lokální operátorskou transportní
identitu ze společné auth vrstvy. Ručně sestavený `actorId` nestačí. V produkci
platí stávající bearer/local-capability mechanismus; neautentizovaný HTTP
požadavek dostane 401, neoperátorský subject 403.

Konfigurace je v SQLite `ide_documents`, změny v append-only `ide_events`.
PUT má `revision: 0` při vytvoření, později přesnou aktuální revizi z GET.
Zastaralá revize dostane 409. Smazané ID se nesmí použít znovu
(`IDE_ID_RETIRED`), aby staré potvrzení neplatilo pro jiný účet/profil.
Frontend má pro nové prvky generovat nové ID. Neznámé vstupní klíče se odmítají.

## API pro Studio

| Oblast | Endpointy a význam |
|---|---|
| Úložiště | `GET /api/system/storage/inventory`: připojené filesystémy, kapacity, velikost cest s COMPLETE/PARTIAL/MISSING/UNAVAILABLE, všechny SQLite databáze na živém spojení, verze, stránky, WAL. `GET/PUT /api/system/storage/paths`: výchozí cesta nových projektů. |
| Modelové role | `GET /api/system/models/role-settings`, `PUT /api/system/models/role-settings/:role`: oddělené `contextWindowTokens` a `maxOutputTokens` pro D1/D2/CODE/R1/R2/CHAT/VISION, přiřazené k přesnému modelu a digestu. |
| Měření provozu | `GET /api/system/models/telemetry?days=7&digestSha256=…`: nejvýše 5000 posledních pozorování, P50/P95, počet/doba volání, průběh rychlosti. Seskupení podle modelu, skutečně vráceného digestu a role. Rychlost z provider `eval_count/eval_duration`; chybějící údaje zůstávají null. |
| Veřejná skóre | `GET /api/system/models/external-signals`, `PUT/DELETE /api/system/models/external-signals/:id`: operátorem importované reference se zdrojem, datem, rolí, metrikou a stupnicí. Existující `/api/system/models/candidates` je připojí jako `externalSignals`. |
| Účty | `GET /api/accounts`, `PUT/DELETE /api/accounts/:id`, `POST /api/accounts/:id/test`: více Discord/Telegram účtů, příjemce, jméno, zapnutí, odběr worker/lifecycle událostí. Test vyžaduje `confirm: true` a přesnou revizi. |
| Zálohy | `GET /api/system/backups`, `POST /api/system/backup`, `GET/PUT/DELETE /api/system/backups/:name`: výběr sekcí, poznámka, archivace, detail a přesně potvrzené odstranění. Existující `GET/PUT /api/system/storage/settings` řídí retenci. |
| Repozitáře | `GET /api/scm/repositories`: skutečné remotes a oprávnění projektu. `GET /api/scm/profiles`, `PUT/DELETE /api/scm/profiles/:id`: SSH profily. `PUT /api/scm/repositories/:projectId`: vazba profilu. |
| Git | `GET /api/scm/branches?projectId=…&sort=activity` (nebo name), `GET /api/scm/compare?projectId=…&base=…&head=…&file=…`, `GET /api/scm/commit?projectId=…&ref=…&file=…&parent=0`. Výsledek obsahuje přesné commit OID, soubory, přejmenování, binární změny a omezený patch. |
| Hunt | `GET /api/system/models/hunt/profiles`, `PUT/DELETE /api/system/models/hunt/profiles/:id`, `POST /api/system/models/hunt/profiles/:id/queue`, `GET /api/system/models/hunt/jobs`, `DELETE /api/system/models/hunt/jobs/:id`. |
| Workeři | `PUT/DELETE /api/agent-extensions/templates/:id`: deklarativní M3 šablony. Existující preview/install slouží pro vytvoření instance. `GET /api/agent-extensions/instances/:agentId/config`, `PUT /api/agent-extensions/instances/:agentId`: úprava parametrů, jména, popisu, enabled; přesné definition/config digests. |
| Specialisté | Existující `POST /api/specialists` nyní převádí českou diakritiku do čitelného ID a přijímá `systemPrompt`, `domainRules`, `constraints`; kolize je 409. Katalog nevrací `dummy-logger`. |

Příklad zápisu modelové role; hodnoty model/digest/revision se berou z GET:

```json
{"revision":0,"model":"fixture:1b","digestSha256":"<aktuální 64hex digest>","contextWindowTokens":2048,"maxOutputTokens":256}
```

Role settings se použijí v gateway, v legacy CHAT/VISION adaptérech a při
výpočtu rozpočtů chatu, expertíz, specialistů, vysvětlení souboru a kompakce.
Jedno policy volání drží jeden snímek nastavení. Kontext nesmí překročit
schválený profil ani aktuální runtime strop; output nesmí rozšířit autoritu
call site nebo auth tokenu. Kvalifikovaný CODE má kontext připnutý na svůj
ověřený profil. `verifiedHardwareMaximum` je null: nový HW sweep neproběhl.
Telemetrie sleduje úspěšné odpovědi; není měřením kvality ani kompletním logem
selhání. Její retenci řídí `storage.retention.telemetry`.

Veřejné skóre určuje pouze prioritu stažení a testu. Přepočet do procent je
lineární na deklarované stupnici; odhad zisku se vrací jen pro stejnou roli,
zdroj, metriku, stupnici a datum benchmarku. Lokální kvalita zůstává autoritou
existujícího evaluation history. Nový automatický scraper veřejných žebříčků
nevzniká; stávající online discovery zůstává funkční.

## Účty a credentials

Účet obsahuje například `provider: "telegram"`,
`credentialEnv: "INTENTSMITH_TELEGRAM_PRIMARY"`, `recipient: "123456"`,
`events: ["worker"]`, `enabled: true`, `revision: 0`. Discord používá ID
kanálu a Bot token. Token je v environmentu procesu; API ani záloha DB
neobsahuje jeho hodnotu. Změna environmentu vyžaduje restart. OAuth ani úschova
klíčů se tím neimplementují.

Doručení jde přes notification pipeline a úzkou outbound capability pro
[Telegram sendMessage](https://core.telegram.org/bots/api#sendmessage) a
[Discord Create Message](https://docs.discord.com/developers/resources/channel#create-message).
Žádné libovolné webhook URL, přesměrování ani automatické Discord mentions.
Neúspěch jednoho účtu nezastaví další účty. Opt-in externího surface je povinný.
Stávající produkční M5 manifest externí notifikace stále odmítá: jeho změna
vyžaduje vlastní M5/M6 journey a přejímku nového rozsahu před vydáním. Testy
tohoto WP používají řízený transport; skutečná zpráva nebyla odeslána.

## Zálohy, SSH a Hunt

Databáze je povinná sekce snapshotu; config/skills/specialists jsou volitelné
archivní sekce. Stávající offline restore obnovuje pouze DB. Poznámka/archivace
nemění zapečetěný payload. Archivované a poslední zálohy chrání všechny
produktové retenční cesty. DELETE vyžaduje revizi, `contentFingerprint` z GET
a `confirm: true`; kontroluje přesnou cestu, symlinky a fingerprint.

SSH profil odkazuje na existující lokální soubory `identityFile` a
`knownHostsFile`, nikoli na vložený tajný klíč. Kontroluje vlastníka, práva,
symlinky, host, uživatele a port skutečného remote. Síťové Git operace stále
potřebují existující SCM policy a prepare/execute potvrzení. Změna klíče nebo
profilu zneplatní připravený plán. HTTPS token profily, upload klíče a editace
remote URL nejsou nové endpointy tohoto WP.

Hunt profil má kind hunt/evaluation/challenge, role, models, limit, modelsPath,
enabled a schedule. Podporuje manual, once (ISO at), interval (ISO at +
intervalMinutes), daily (HH:mm + IANA timezone) a weekly (+ weekDays 0–6).
Queue vyžaduje přesnou revizi, ISO `at` a `confirm: true`. Změna profilu již
zařazený job nemění. Limit patří discovery Huntu; evaluation má jeden model,
challenge dva. Kontext evaluace zůstává 4096 podle suite contractu. Scheduler
se aktivuje během běhu serveru, dohání nejvýše jednu zmeškanou periodu.

GPU admission, provider lease, automation hold a systemd limity zůstávají
povinné. Evaluation/challenge drží přesný digest a suite contract pro každou
roli; modely měří sériově. Výsledky obou částí se zachovají. Stav
AWAITING_REVIEW/PARTIAL/BLOCKED není PASS. Nejisté LAUNCHING po restartu je
INTERRUPTED, nikdy automatický replay. Výsledek se hledá podle jedinečného
job/step ID, ne podle posledního spuštěného modelu. Změna modelsPath platí jen
pro sidecar Huntu, nepřesouvá soubory živého Ollama provideru.

## Napojení a přejímka

ROOT může nejprve napojit GET/readback obrazovky, potom revizované PUT/DELETE
a samostatné potvrzení efektů. Bod a/b/h a file explorer z i jsou UI práce.
Existující Git branch.create přijímá název uživatele přes prepare/execute;
generický název v UI se neopravuje backendem. Vlastní worker šablony zachovávají
M3 projektový kontext a lokální efektové hranice; nejsou upload spustitelného
kódu. Specialistické nástroje vyžadují existující schválený package; nová
doménová pravidla sama žádný nástroj ani oprávnění nevytvářejí.

Po integraci je nutné nezávislé review, UI journey, skutečné externí účty a
ověření Huntu na GPU. Kvalitativní kampaň a release acceptance následují až po
těchto funkčních důkazech. Tento WP žádný model neaktivuje a nemění produkci.
