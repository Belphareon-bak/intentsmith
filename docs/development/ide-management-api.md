# Backend nových funkcí IDE

Stav: integrovaný kandidát WP-IDE-BACKEND-20261009 a
WP-IDE-INTEGRATION-20261009, aplikační `387a490f`. Frontend/BE jsou funkčně
kvalifikované; nezávislá revize a release přejímka zůstávají otevřené.
[Paket kvalifikace](../review/ide-integration-remediation-20261010.md).
Rozsah Discord/Telegram vychází z přímého
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
| Úložiště | `GET /api/system/storage/inventory`: připojené filesystémy, kapacity, velikost cest s COMPLETE/PARTIAL/MISSING/UNAVAILABLE/UNKNOWN, pojmenované SQLite databáze (bez dočasné temp) na živém spojení, verze, stránky, WAL. `GET/PUT /api/system/storage/paths`: výchozí cesta nových projektů. |
| Modelové role | `GET /api/system/models/role-settings`, `PUT /api/system/models/role-settings/:role`: oddělené `contextWindowTokens` a `maxOutputTokens` pro D1/D2/CODE/R1/R2/CHAT/VISION, přiřazené k přesnému modelu a digestu. |
| Měření provozu | `GET /api/system/models/telemetry?days=7&digestSha256=…`: nejvýše 5000 posledních pozorování, P50/P95, počet/doba volání, průběh rychlosti. Seskupení podle modelu, skutečně vráceného digestu a role. Rychlost z provider `eval_count/eval_duration`; chybějící údaje zůstávají null. |
| Veřejná skóre | `GET /api/system/models/external-signals`, `PUT/DELETE /api/system/models/external-signals/:id`: operátorem importované reference se zdrojem, datem, rolí, metrikou a stupnicí. Existující `/api/system/models/candidates` je připojí jako `externalSignals`. |
| Účty | `GET /api/accounts`, `PUT/DELETE /api/accounts/:id`, `POST /api/accounts/:id/test`: více Discord/Telegram účtů, příjemce, jméno, zapnutí, odběr worker/lifecycle událostí. Test vyžaduje `confirm: true` a přesnou revizi. |
| Zálohy | `GET /api/system/backups`, `POST /api/system/backup`, `GET/PUT/DELETE /api/system/backups/:name`: výběr sekcí, poznámka, archivace, detail a přesně potvrzené odstranění. Existující `GET/PUT /api/system/storage/settings` řídí retenci. |
| Repozitáře | `GET /api/scm/repositories`: skutečné remotes a oprávnění projektu. `GET /api/scm/profiles`, `PUT/DELETE /api/scm/profiles/:id`: SSH profily. `PUT /api/scm/repositories/:projectId`: vazba profilu. |
| Git | `GET /api/scm/branches?projectId=…&sort=activity` (nebo name), `GET /api/scm/compare?projectId=…&base=…&head=…&path=…`, `GET /api/scm/commit?projectId=…&ref=…&path=…&parent=0`. Výsledek obsahuje přesné commit OID, soubory, přejmenování, binární změny a omezený patch. |
| Hunt | `GET /api/system/models/hunt/profiles`, `PUT/DELETE /api/system/models/hunt/profiles/:id`, `POST /api/system/models/hunt/profiles/:id/queue`, `GET /api/system/models/hunt/jobs`, `DELETE /api/system/models/hunt/jobs/:id`. |
| Workeři | `PUT/DELETE /api/agent-extensions/templates/:id`: deklarativní M3 šablony. Existující preview/install slouží pro vytvoření instance. `GET /api/agent-extensions/instances/:agentId/config`, `PUT /api/agent-extensions/instances/:agentId`: úprava parametrů, jména a popisu; přesné definition/config digests. |
| Specialisté | Existující `POST /api/specialists` nyní převádí českou diakritiku do čitelného ID a přijímá `systemPrompt`, `domainRules`, `constraints`; kolize je 409. Katalog nevrací `dummy-logger`. |

Příklad zápisu modelové role; hodnoty model/digest/revision se berou z GET:

```json
{"revision":0,"model":"fixture:1b","digestSha256":"<aktuální 64hex digest>","contextWindowTokens":8192,"maxOutputTokens":256}
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
Nedostupná evaluace jednoho profilu nezastaví ostatní joby; profil ukazuje
historický `lastScheduleError` s revizí a časem, nejde o aktuální GPU měření.

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

## Integrační doplnění WP-IDE-INTEGRATION-20261009

CHAT vyžaduje nejméně 8192 tokenů kontextu; menší hodnota vrací bezpečnou
422 s kódem IDE_CONTEXT_TOO_SMALL. Limit výstupu CHAT řídí pouze odpověď,
klasifikační JSON a kompakce mají vlastní autorizované rozpočty. D2/R1/R2
předávají roli explicitně i při společném modelu. Staré nedostatečné nastavení
se označí REQUIRES_UPDATE a nepoužije se.

Cesta modelů se ověřuje přes konfiguraci aktivní lokální služby Ollama pro
odpovídající endpoint. Neznámá/remote cesta je null/UNKNOWN; fallback je pouze
výslovná instalační konfigurace. Mounty stejného zařízení jsou sloučené.
Interní chyby jsou 500 IDE_OPERATION_FAILED; chybějící SSH soubor je 422 bez
úniku technické cesty. Formát ID je stejný při PUT i DELETE.

Studio poskytuje editor deklarativních vlastních šablon a úpravu instance
přes chráněnou M3 konfiguraci. Preview úpravy vyžaduje lokální operátorský
subject, existující vlastnictví rozšíření a expectedConfigDigest. Uložení
instance dále vyžaduje expectedDefinitionDigest. Stav zapnutí se tím nemění.
Neplatná uložená vlastní šablona neodstaví zbytek katalogu; GET vrátí invalidTemplates.
Specialista má v průvodci prompt, doménová pravidla a omezení.

400/422 odmítnutí zachová editovatelný návrh. 409 konflikt nebo nejistý zápis
zůstává uzamčený pro obnovu a kontrolu; automatické opakování není povolené.
Veřejnou referenci lze importovat formulářem s readbackem zdroje, metriky,
data a stupnice. Kvantizace pochází z metadata API; chybějící údaj se nepředstírá.
Hunt respektuje automation hold a zobrazuje důvod odložení.

Vytvořený specialista má deklarovaný čistý nástroj `prepare_context`
registrovaný přes ExtensionContext V1. Balíček se před odpovědí 201 ověří
skutečným loaderem/runtime. Nástroj přijímá i krátký vstup a přes existující
M3 wrapper vloží aktuální požadavek, systémový prompt, doménová pravidla a
omezení do provider payloadu. Funkční HTTP i nativní důkaz ověřují další tah
před restartem a po něm. Jde o přípravu doménového kontextu, nikoli nové
oprávnění spouštět libovolné nástroje nebo externí akce.


## Dokončení revize a preview V4, 10. 10.

CHAT přijímá nejméně 8 192 tokenů. Nadlimitní interpretace i následná odpověď
vrací `413 CHAT_CONTEXT_CAPACITY_EXCEEDED` s českou opravnou větou; nevzniká
vymyšlená odpověď. Všechny konfigurované role kontrolují před inference odhad
textu + rámování + vlastní výstupní rozpočet. Jde o konzervativní přijímací
kontrolu textu, nikoli přesný tokenizer, měření obrazových tokenů nebo HW maxima.
Limit běžné odpovědi platí pro explicitní `purpose: answer` nebo textový
`purpose: refine` bez JSON
formátu; interní strukturované kroky včetně VISION drží vlastní auth/call-site
rozpočet. Při malém okně odmítnou vstup jako `LLM_CONTEXT_WINDOW_EXCEEDED`.

`POST /api/system/backups/retention-preview` přijímá `{maxDaily,maxWeekly}`,
vrací aktuální kandidáty a chráněné snímky a nic nemaže. Používá stejný plán
jako všechny stávající automatické retence. Studio ukáže kandidáty a před
uložením pravidel s dopadem vyžaduje potvrzení. Nové zálohy mohou plán změnit;
uložení pravidel samo nic neodstraní. Legacy zápis pravidel má preflight a
readback, není vydáván za CAS.

Git compare/detail vrací `diffTruncated` a nejvýše 1 MB patche; seznam souborů
zůstává k dispozici i pro velkou změnu. Frontend nabízí větve podle aktivity
nebo názvu, přesné reference, rodiče commitu a společný diff / vedle sebe.
Telemetrie má naměřené P50/P95, součet, první/poslední čas a graf maximálně
120 skutečných pozorování. Čas prvního tokenu se neměří a UI to uvádí.

Worker má formulář nad povolenou místní M3 autoritou: projektový zdroj,
změna revize nebo práh signálů, ruční/intervalové spouštění, oznámení v IDE.
Pokročilý JSON je volitelný. Úprava instance je dostupná z detailu; tvorba
neaktivuje workera. Obecná historická nastavení mají čtyři aktivní přepínače
paměti; dalších 31 bez ověřeného spotřebitele je pro čtení s vysvětlením a
UI jejich zápis odmítá. Kontext/výstup se nastavují výhradně v editoru role.

Resolver úložiště používá ověřenou místní službu Ollama; její skutečná cesta
má přednost před backendovým hintem. `systemctl` má pevnou cestu
`/usr/bin/systemctl`. Hunt předává adresu skutečného pull provideru, nikoli
inference sidecaru; neznámou kapacitu nevydává za dostatek místa. Pokud chybí
instalace Huntu, fronta uchová důvod `DESKTOP_NOT_INSTALLED`. Automation hold
stanice zůstává účinný.
