# Mobilní gateway — provoz

> **Kanonický overlay větve `mobile/master-prod-ready` (2026-09-07):** text
> níže zachycuje původní 13-route checkpoint. Aktuální přesný allow-list má 26
> rout; vedle worker/specialist read modelu, správy zařízení, revizního
> `PUT /m1/settings` a create-only `POST /m1/memory` obsahuje precondition-checked
> `PUT /m1/workers/:id/enabled` a metadata-only
> `GET /m1/workers/:id/runs` a live-only
> `GET /m1/specialists/:id`. MM3-C navíc rozšířilo existující
> `GET /m1/conversations` o uzavřený `projectId` filtr, dvojici scopů
> `read:chat` + `read:projects`, projektově svázaný cursor a `no-store`.
> MM4-M zpřísnilo consumer existujícího device list/revoke povrchu bez změny
> gateway kontraktu. MM4-N zpřísnilo consumer existujícího notification
> read/ack povrchu a doplnilo `no-store` response header bez změny route či
> wire body. Autoritou poslední změny je review
> `MM4N-NOTIFICATION-INBOX-INTEGRITY`. Následující MM3-G mění pouze klientské
> project cache window, nikoli gateway; viz `MM3G-PROJECT-CACHE-LIFECYCLE`.
> MM3-H stejně mění jen klientskou lifecycle klasifikaci a mazání expired
> thread cache; viz `MM3H-CONVERSATION-CACHE-LIFECYCLE`. MM3-I pak uzavírá
> exact thread consumer a přidává transportní `no-store` na oba existující
> globální conversation read tvary; body, route, scope ani port se nemění.
> Viz `MM3I-CONVERSATION-THREAD-INTEGRITY`;
> wildcard ani obecný `/api` proxy nevznikl.

**Status:** **`LOCAL_REGISTRY_CONVERGED / MOBILE_SUBSET_PASS / SHARED_VALIDATION_BLOCKED`**; gateway je implementovaná a testovaná pouze **na loopbacku**, nikoli produkčně DONE.
**Revize:** vstupy `RV-028`, `RV-036`, `RV-037`, reconciliation `RV-038`; Composition Review C `RV-039`/`RV-040`; registr a chráněné hodnoty `RV-042`/`RV-043`.
**Stavová evidence:** produktový commit `4553b3ee`; registr `362`, `C3-031=7`, `C3-032=5`, `offline=178`, `database=33`, required ACTIVE deterministic `211`; všech 11 mobilních programů a `schema-migrations` PASS, ale celý profil skončil exit `1`, `208 PASS / 3 FAIL` kvůli `F-115` a `F-116`; žádný Gate 0 PASS, verdikt ani handoff nebyl vydán.
**Kompozice:** historické `392c5928` dostalo v `RV-023`–`RV-025`
`CHANGES_REQUIRED`; opravené successory jsou kompozičně schválené. `F-080` je
`RESOLVED`, ale `F-100` dál blokuje produkční `R-3` a fáze 3A je `NOT DONE`.
Vzdálená expozice zůstává zakázaná a `GAP-2` otevřená — viz
[PLAN.md §8.1 a §8.2](PLAN.md).

**Aktuální hranice:** kód a `gateway-policy.js` drží přesný **13-route HTTP
allow-list**. Je to dnešní implementovaný/source-policy-frozen povrch, nikoli
formálně refrozený kontrakt v2 pro šest domén z `DR-008`. Dnešní `/m1` nemá
WebSocket ani SSE. Existují třída/DB tabulka, per-device receipts, unikátní
sequence, closed-S1 companion producer a HTTP read/ack surface
(`GET /m1/notifications`, `POST /m1/notifications/ack`). MM4-N jejich consumer
validuje fail-closed; obecná produkční event-selection/delivery a push policy
však nejsou uzavřené a realtime je jen budoucí neautorizovaný kandidát. Každé
nové spárování razí nový `deviceId`,
takže staré operace nejsou z nového zařízení dostupné. Při zachovaném tokenu
téhož zařízení se nejasný timeout řeší `GET /m1/operations/:id`; seznam
stejného zařízení obnoví jen serverová pole otevřených pokusů, ne lokální
atribuci, rozřešenou historii, retry payload ani draft. Všechny čtyři dříve
chybějící successor programy jsou registrované a `MS-20` bylo při zachování ID
překlasifikováno z `C3-031` do `C3-032`. Registry i chráněné hodnoty prošly
nezávislým review; to nemění sdílený deterministický exit `1` ani absenci
Gate 0 PASS, verdiktu a handoffu.

**M4 pravda po `RV-035`:** review je `CHANGES_REQUIRED`. `F-111` zůstává
otevřené jako úzké child evidence stále blokujícího root findingu `F-014`, ne
jako další unikátní root: produkční router registruje email/telegram/push a
server navíc webhook/desktop, nikoli `MobileChannel`, takže běžná produkční
emise nevytvoří řádek `mobile_notifications`. **`F-112` je `RESOLVED_IN_CODE`
k 2026-08-13** (per-device receipty, 10 testů PASS); dřívější **HIGH**
blocker a úzké ACK child evidence stále blokujících root findingů `F-011` a
`F-015`, ne další unikátní root: čtení se filtruje podle zařízení, ale ACK
předává jen ID a SQL aktualizuje jen podle ID; cílený řádek lze potvrdit napříč
zařízeními a broadcast sdílí jedno globální `read_at`. `F-015` navíc samostatně
drží závod `MAX(seq)+1` bez `UNIQUE`/transakční garance.

`DR-003` A a jeho specializace `DR-012` A byly `PRODUCT_OWNER` přijaty
společně: server-authoritativní append-only lifecycle a per-device receipt
tabulka jsou cílový kontrakt. `DR-013` A přijímá policy-controlled S1-safe
companion mirror. Rozhodnutí nejsou implementace: ACK izolace, sekvenční
závod, producer/projektor a Gate 1 důkazy chybějí, takže produkční wiring
zůstává blokovaný (`F-011`, `F-014`, `F-015`, `F-111`). `F-112` je uzavřený,
ale **uzavření child nálezu samo neuzavírá jeho rooty** `F-011` a `F-015` —
ty potřebují vlastní review.

`F-113` je `RESOLVED` v source checkpointu `2a814434` (`RV-037`), prošlo
kompozičním review a má M3 testovací evidenci: každý persistence path pro
moderní i legacy řádky prochází
uzavřenou normalizací, platný záznam má přesně sedm allowlisted polí a
malformovaný nejvýše sedm bez fabrikace identity nebo času. `F-108` je
`RESOLVED`; jeho původní branch-aware census je historický, nikoli aktuální stav. Aktuální
census je `362/7/5/178/33/211`; sdílenou validaci blokují `F-115` a `F-116`.
Vstupy zůstávají pouze lokální, bez push a main integrace; `F-100`, `F-111`,
`F-081`, `GAP-2`, `GAP-9` a `MR-25` zůstávají otevřené; `F-112` a `MR-05` už
ne.

---

## 1. Co to je

Samostatný proces, který vystavuje `/m1/*` a mobilního webového klienta.
**Není** to routa na stávajícím serveru — je to jiný proces na jiném portu,
protože scope middleware na sdíleném portu jde obejít tím, že se útočník
zeptá na `/api/*` nebo `/c3/ws`.

```
   telefon
      │  http (VPN / loopback)
      ▼
 ┌────────────────────────────┐        ┌────────────────────────────┐
 │ mobile gateway  :3336      │        │ legacy server  :3335       │
 │  /m1/*  + webový klient    │───────▶│  bind 127.0.0.1 — VŽDY     │
 │  fail-closed scope guard   │ named │  /api/*, /c3/ws (terminál) │
 └────────────────────────────┘        └────────────────────────────┘
            │                                      │
            └──────────── sdílená SQLite ──────────┘
```

Gateway nemá chatovou ani worker lifecycle logiku. Čtení bere přímo z SQLite;
chat a zapnutí/vypnutí workera deleguje pevnými jmenovanými příkazy na legacy
server přes loopback. CRE a worker repository/scheduler tak zůstávají jedinými
živými autoritami a žádný obecný `/api` proxy nevzniká.

---

## 2. Spuštění

```bash
# 1) legacy server (loopback, jinak fail-closed)
node src/server.js

# 2) gateway
C3_MOBILE_PAIRING=on node src/mobile-gateway.js
```

| Proměnná | Výchozí | Význam |
|---|---|---|
| `C3_MOBILE_HOST` | `127.0.0.1` | Bind host. Non-loopback je **odmítnut** |
| `C3_MOBILE_PORT` | `3336` | `0` = přidělí OS |
| `C3_URL` | `http://127.0.0.1:3335` | Legacy server |
| `C3_MOBILE_PAIRING` | *vypnuto* | `on` / `1` povolí claim. Nic jiného neplatí |
| `C3_MOBILE_UI` | *zapnuto* | `off` vypne servírování klienta |
| `C3_MOBILE_ALLOW_REMOTE` | — | Jediná platná hodnota je `i-accept-unproven-remote-boundary` |

Fail-closed výchozí stavy jsou záměrné: kdo o párování nepřemýšlel, nemá ho
zapnuté.

---

## 3. Párování

```bash
node scripts/mobile-pair.js
node scripts/mobile-pair.js --url http://100.x.y.z:3336 --ttl 300
```

Vypíše QR s párovací URL. Telefon ji otevře, klient pošle kód na
`POST /m1/pair/claim` a dostane device token.

- kód má **160 bitů** a v DB je jen jeho SHA-256;
- je **jednorázový** — druhý claim vrací `409 pairing_already_used`;
- z 8 souběžných claimů uspěje **právě jeden** (podmíněný `UPDATE`, ne read-then-write);
- TTL 30 s – 15 min, výchozí 5 min;
- udělitelné scopes jsou průnik s allow-listem — `admin`, `exec`, `terminal`
  a `write:security` nelze udělit **nikdy**;
- token nikdy není `C3_ADMIN_TOKEN`.

Kód se ukáže **jednou**. Znovu ho přečíst nejde; jde jen vydat nový.

### Odvolání zařízení

Kanonické UI MM4-D používá `GET /m1/devices` (`read:devices`) a
`POST /m1/devices/:id/revoke` (`write:devices`). Mutace nese `operationId`, je
vázaná na přesný cíl a revokaci se svým výsledkem commitne v jedné SQLite
transakci. Níže uvedené přímé volání zůstává nízkoúrovňovou operátorskou cestou.

```js
import { revokeDevice, listDevices } from './src/mobile/pairing.js';
revokeDevice(db, deviceId);
```

Revokace **okamžitě zablokuje nový přístup**. To je jediné, co zaručuje.
Nezaručuje vzdálené smazání dat z offline telefonu a nesmí se tak popisovat
(DATA-MODEL §4.2).

### Revizní zápis nastavení

MM4-E přidává `PUT /m1/settings` se samostatným, ne-výchozím
`write:settings`. Exact body je `{ operationId, expectedRevision, path, value }`
a provider přijímá jen 11 cest `UX_PREFERENCES_V1`. Souběžná změna vrací
`state_conflict`, nic automaticky nepřepisuje a klient nejprve znovu čte.
Nastavení a journal result nejsou v jedné transakci; chyba po commitu je proto
`UNKNOWN` řešené přes `/m1/operations`, ne falešné `REJECTED`. Úplná hranice a
testy jsou v `reviews/MM4E-REVISIONED-SETTINGS-WRITE.md`.

### Create-only zápis uchovávané informace

MM4-F přidává `POST /m1/memory` se samostatným, ne-výchozím `write:memory`.
Exact body je `{ operationId, category, key, value }`. Provider smí jediným
atomickým insertem vytvořit nový explicitní LTM záznam v kategoriích
`preference`, `project`, `style` nebo `correction`. Existující klíč je konflikt;
replacement, delete, task memory a interní kategorie nejsou routou dostupné.
Nejednoznačný výsledek po možném efektu je `UNKNOWN` a klient ho automaticky
neopakuje. Úplná hranice a testy jsou v
`reviews/MM4F-CREATE-ONLY-MEMORY.md`.

### Precondition-checked zapnutí/vypnutí workera

MM4-G přidává `PUT /m1/workers/:id/enabled` se samostatným, ne-výchozím
`write:workers`. Exact body je `{ operationId, expectedEnabled, enabled }` a
oba boolean stavy se musí lišit. Gateway nevystavuje obecný legacy proxy ani
nepíše `agents_v33` přímo. `workers.toggle` deleguje pouze pevný
`POST /api/agents/:id/enable|disable`; živý legacy proces pak ověří expected
state a změnu v jedné IMMEDIATE SQLite transakci a při zapnutí použije existující
scheduler. Konflikt je rozhodnuté `REJECTED`; timeout, 5xx nebo nečitelný
výsledek po možném efektu je `UNKNOWN`. Klient nad ním nedělá auto-retry.
Úplná hranice a testy jsou v `reviews/MM4G-WORKER-STATE.md`.

### Detail workera a terminální historie

MM4-H přidává `GET /m1/workers/:id/runs` s `read:workers`. Exact query přijímá
jen `limit` 1–100 a serverový neprůhledný `cursor`. Provider používá uzavřenou
operaci `workers.read/history`; stránkuje směrem do minulosti a vrací pouze
metadata dokončených běhů. Stav `running`, log, chybový text, explain payload,
identity triggerů, definition/state/params a všechny run commands zůstávají
mimo projekci. Detail a historie mají `no-store` a klient je neukládá do offline
cache. Úplná hranice a testy jsou v
`reviews/MM4H-WORKER-RUN-HISTORY.md`.

### Detail specialisty a vazeb expertiz

MM4-I přidává `GET /m1/specialists/:id` s `read:specialists` a bez query
parametrů. Uzavřená operace `specialists.read/detail` čte veřejná metadata
balíčku a uspořádané vazby z `specialists` + `specialist_expertises` v jedné
read transakci. Manifest, prompty, nástroje, filesystem a integrita, živá
registrace, telemetry, memory i všechny mutation operace jsou vyloučené.
Perzistovaný `status` není vydáván za stav živého runtime. Route i klient jsou
exact-shape, detail je `no-store` a nevzniká obecný loader ani `/api` proxy.
Úplná hranice a testy jsou v
`reviews/MM4I-SPECIALIST-DETAIL.md`.

### Konverzace přiřazené projektu

MM3-C nepřidává novou routu: uzavřený volitelný `projectId` filtr patří k
existujícímu `GET /m1/conversations`. Základní route vyžaduje `read:chat` a
filtrovaný tvar navíc `read:projects`. Id je kladné safe-integer desetinné
číslo; neznámé/duplicitní parametry selžou. `conversations.read/list` filtruje
`project_id` a `state != 'deleted'` uvnitř core provideru. Cursor má stream
konkrétního projektu, takže nejde použít pro jiný projekt ani globální seznam.
Filtrovaná odpověď má `Cache-Control: no-store`; nový `/api` proxy ani
projektová či konverzační mutation autorita nevznikly. Úplná hranice a testy
jsou v `reviews/MM3C-PROJECT-CONVERSATIONS.md`.

### Globální conversation-list consumer

MM3-D (`34bc19de`) nemění gateway, allow-list ani `RemoteCorePort`. Klient
nově spotřebuje `hasMore`, `nextCursor` a `end`, které globální
`GET /m1/conversations` už vydával, a odmítá neplatný nebo překrývající se
page. Opaque cursor nepočítá ani neupravuje. Úplná klientská hranice a testy
jsou v `reviews/MM3D-CONVERSATION-LIST-PAGINATION.md`.

MM3-I (`7a6b379e`) rovněž nepřidává route ani port operation. Klient váže
existující detail response na požadované conversation id, exact veřejné DTO,
`backward` směr a koherentní page boundary; continuation odmítne při duplicate
nebo overlap. Gateway na globální list i detail přidává pouze
`Cache-Control: no-store`, včetně autorizačních a handler chyb, zatímco klient
používá `cache: 'no-store'`. Wire body a cursor zůstávají stejné. Viz
`reviews/MM3I-CONVERSATION-THREAD-INTEGRITY.md`.

Stejnou consumer-only změnou je MM3-E (`075f5eb7`): aktivní a archivovaný
project list nyní spotřebují své již existující state-bound cursory, přesně
ověřují response/row state a drží oddělené cache boundaries. Gateway route,
query a provider se nezměnily. Viz
`reviews/MM3E-PROJECT-LIST-PAGINATION.md`.

MM4-J (`acff7939`) je rovněž consumer-only. Existující worker/specialist list
routes, query a port operations se nemění; klient nyní přijme pouze exact
public DTO page s koherentním `hasMore`/`nextCursor`/`end`, odmítne duplicate
nebo overlap a publikuje jen validovaný cache snapshot. Vadná worker stránka
navíc ruší live proof pro toggle. Viz
`reviews/MM4J-CONFIGURED-LIST-INTEGRITY.md`.

MM3-F (`a08d0dd0`) také nemění gateway, allow-list ani `RemoteCorePort`.
Existující `GET /m1/projects/:id` nyní klient přijme jen jako HTTP 200 success
envelope s exact verzovaným veřejným DTO a id shodným s požadovanou routou.
Corrupt/expired cache, conclusive `not_found`, scope loss a pozdní response po
odchodu z route se nesmějí publikovat. Viz
`reviews/MM3F-PROJECT-DETAIL-INTEGRITY.md`.

MM4-K (`99cdfdde`) je další consumer-only zpřísnění. Existující live-only
`GET /m1/settings` nyní klient přijme jen jako HTTP 200 success envelope s
exact `{ revision, settings, version }` a 46-path public owner map shodnou s
core exportem. Unknown/private pole nebo malformed hodnota se nerenderuje a
nemůže odemknout MM4-E writer. Gateway, provider a wire se neměnily. Viz
`reviews/MM4K-PUBLIC-SETTINGS-INTEGRITY.md`.

MM4-L (`d1f0a98a`) stejně zpřísňuje pouze consumer existujícího
`GET /m1/memory`. Klient nyní přijme exact versioned LTM/task DTO a koherentní
`kind=all` page, vrací jen opaque server-issued cursor a cacheuje potvrzené
okno společně s boundary. Duplicate/overlap, malformed live nebo cached data
se nepublikují a existující create-only writer se relockne. Gateway, provider,
wire i allow-list se neměnily. Viz
`reviews/MM4L-STORED-INFORMATION-LIST-INTEGRITY.md`.

MM4-M (`af33f984`) zpřísňuje pouze consumer existujícího `GET /m1/devices`.
Klient požadavek explicitně posílá s `no-store`, přijme jen HTTP 200 success
envelope s exact veřejným DTO, unikátními id a jedním `current` řádkem
svázaným s aktivním credentialem. Validní cache je jen ke čtení a revoke
odemkne pouze aktuální live read. Gateway, provider, wire i allow-list se
neměnily. Viz `reviews/MM4M-PAIRED-DEVICE-LIST-INTEGRITY.md`.

---

## 4. Routy

> Tabulka v této historické sekci zachycuje původních 13 rout. Aktuálních 26
> exact rout je generováno v `BACKEND-CAPABILITY-INVENTORY.md`; poslední novou
> routou je `GET /m1/specialists/:id` (`read:specialists`, MM4-I) a MM3-C
> následně rozšířilo existující conversation-list query bez změny počtu rout.
> Následující věta „vše ostatní je 404“ se vztahuje k tehdejšímu checkpointu,
> ne k dnešnímu HEAD.

| Metoda | Cesta | Scope |
|---|---|---|
| GET | `/m1/health` | *veřejné* |
| POST | `/m1/pair/claim` | *veřejné* (chrání kód + TTL + vypínač) |
| GET | `/m1/operations` | *jen autentizace* |
| GET | `/m1/operations/:operationId` | *jen autentizace* |
| POST | `/m1/operations/:operationId/abandon` | *jen autentizace* |
| GET | `/m1/capabilities` | `read:capabilities` |
| GET | `/m1/conversations` | `read:chat` |
| GET | `/m1/conversations/:id` | `read:chat` |
| POST | `/m1/chat` | `write:chat` |
| GET | `/m1/notifications` | `read:notifications` |
| POST | `/m1/notifications/ack` | `write:notifications` |
| GET | `/m1/approvals` | `read:approvals` |
| POST | `/m1/approvals/:id/decide` | `write:approvals` |

Vše ostatní je **404**. Žádný wildcard, žádný prefix match.

Třináct rout je aktuální **implementovaný a source-policy-frozen HTTP
allow-list**, ne formálně refrozený kontrakt v2 ani autorita k jeho rozšíření.
`DR-008` autorizovalo jen společné kontraktní kolo pro šest dalších domén;
ani budoucí schválení kontraktu samo neautorizuje implementaci nové routy.

### 4.1 Stránkování historie konverzace (`MR-05`)

`GET /m1/conversations/:id` čte stránku zpráv. Směr chůze určuje **kurzor**,
ne klient — a otevřít chůzi na konkrétním konci streamu umí `anchor`:

| Parametr | Hodnoty | Význam |
|---|---|---|
| `limit` | 1–100, výchozí 50 | Ořezáno na `MAX_PAGE_SIZE`, nikdy odmítnuto |
| `anchor` | `latest` | Otevře chůzi na **nejnovější** zprávě a vydá kurzor směřující do minulosti. Jiná hodnota → `400 bad_request`, `reason: anchor_unknown` |
| `cursor` | opaque | Pokračuje v už otevřené chůzi. S `anchor` současně → `400`, `reason: anchor_with_cursor` |

Odpověď nese `hasMore`, `end`, `nextCursor` a **`direction`** (`forward` |
`backward`), aby `end` nebyl dvojznačný: u zpětné chůze znamená „držíš
nejstarší zprávu" — to je hranice, kterou `SS-03` vykresluje.

MM3-I vyžaduje, aby mobilní backward consumer přijal jen přesný veřejný
conversation/message tvar, id odpovídající routě a koherentní boundary bez
duplicate/overlap. `GET /m1/conversations` i
`GET /m1/conversations/:id` mají na requestu i odpovědi `no-store`; gateway
hlavičku drží také na authorization a handler error cestách.

Bez `anchor` se chová jako dřív: dopředu od nejstarší zprávy. Ta výchozí
sémantika se **nezměnila**, protože nezměněný dotaz musí dostat nezměněnou
odpověď.

**[?] Kontraktní poznámka.** `anchor` je *aditivní parametr na existující
routě* — allow-list zůstává třináctiroutový a nová routa nevznikla. Operátor
tenhle krok schválil (`WP-MOBILE-028` §4, varianta A). Není to formální refreeze
kontraktu v2; jestli kontraktní autorita usoudí, že tvar requestu pod zmrazený
povrch spadá, projde `MR-05` kolem `DR-008` jako ostatní domény.

Notifikační dvojice rout je source-tested jako device-scoped pull/ACK kanál.
`GET /m1/notifications` filtruje cílené řádky na `principal.deviceId`, přidává
broadcasty a vydává unikátní monotónní sequence boundary. Stav přečtení je v
`mobile_notification_receipts` per zařízení; `POST /m1/notifications/ack`
předává databázi i `principal.deviceId`, takže cizí cílený řádek ani broadcast
receipt jiného zařízení nezmění. Obě odpovědi nesou `Cache-Control: no-store`.

Produkční router registruje fail-closed `MobileChannel`; jeho neforgeable
capability drží právě `src/mobile/companion-producer.js`, který mapuje approval
a core-run ukazatele do uzavřeného S1 slovníku. MM4-N klient přijímá pouze
exact DTO z tohoto slovníku, validuje sequence page/cache, odděluje read a write
scope a ACKuje jen zobrazené nepřečtené id po aktuálním live readu. Komponentní
evidence je zelená, ale obecná produkční event-selection/delivery policy, push,
wire freeze, device průchod a release acceptance tím nejsou prohlášeny.

`POST /m1/approvals/:id/decide` také sám neprokazuje cílový kontrakt `R-3`.
Podle `DR-011` zůstává `R-3` cílem: chybí produkční producent approvalů,
5/15minutová TTL autorita, povinný otisk a autoritativní vazba na run, operaci
a normalizovaný obsah (`F-100`). Historické review doložilo, že odpovědi na
`392c5928` neměly `Cache-Control: no-store` (`F-080`). Disjunktní successory
`a3443de1`/`0292cb69` opravily klientský fetch, service worker i HTTP odpověď
a bounded `RV-028` proto vede `F-080` jako `RESOLVED`. Tyto přesné vstupy jsou
nyní lokálně složené pod `PC-012`/`WP-MOBILE-024`, jediná reconciliation
prošla `RV-038` a kompozice `RV-039`/`RV-040`. Historický `PC-010` byl
schválený, ale nikdy se neprovedl; nahradil jej právě `PC-012`/`WP-MOBILE-024`.
Mobilní M3 subset je PASS, ale sdílený profil `208/3`, `F-100` a chybějící
produkční autorita brání `DONE` stavu.

`/m1/operations/:id` schválně nevyžaduje scope: je to čtení bez payloadu
a jediný přesný lookup posledního serverem zapsaného stavu konkrétního
pokusu. `GET /m1/operations` vedle toho vypíše `PENDING` a `UNKNOWN` pokusy
autentizovaného **stejného `deviceId`**, takže při zachovaném device tokenu
dokáže znovu objevit jejich ID i po ztrátě samotného lokálního indexu.

Serverový seznam ale nevrací rozřešenou historii, lokální popisek ani
původní request. Lokální index drží přiřazení a krátkou historii;
doprovodný draft drží přesný request nutný pro bezpečný retry pod týmž
klíčem. Nové párování razí nový `deviceId`, který staré záznamy ani
seznamem, ani lookupem neuvidí (MD-19 §4.1 a §4.5).

---

## 5. Chybové kódy

Každá příčina má vlastní kód, protože klient na každou ukazuje jinou obrazovku.

| Kód | HTTP | Znamená |
|---|---|---|
| `token_missing` | 401 | Chybí `Authorization: Bearer` |
| `token_invalid` | 401 | Token neznáme |
| `token_expired` | 401 | Vypršel → znovu spárovat |
| `token_revoked` | 401 | **Odvoláno** → smazat cache, bezpečnostní událost |
| `scope_required` | 403 | Chybí konkrétní scope (je v odpovědi) |
| `operation_conflict` | 409 | Týž klíč, jiný payload |
| `state_conflict` | 409 | Stav se mezitím změnil |
| `approval_superseded` | 409 | Payload approvalu se změnil |
| `operation_limit` | 429 | Strop nerozřešených operací |
| `cursor_unknown` | 400 | Kurzor neznáme → načíst od začátku |
| `server_unavailable` | 503 | Gateway běží, backend ne |

Odpověď má vždy tvar `{ "ok": false, "error": { "code": … } }`.

---

## 6. Klíč operace (MD-19)

Každá mutace nese `operationId` — 128 bitů, vydaný klientem.

```
POST /m1/chat  { conversationId, message, operationId }
```

- **týž klíč, týž payload** → vrátí původní výsledek, **bez druhého efektu**;
- **týž klíč, jiný payload** → `409 operation_conflict`, fail-closed;
- **nejasný timeout** → server označí `UNKNOWN`; klient **nesmí** vyrobit nový
  klíč, musí přečíst `GET /m1/operations/:id`;
- záznam **přežije restart** (je to tabulka, ne cache) — přesně pro chvíli,
  kdy na tom záleží nejvíc;
- strop 32 nerozřešených na zařízení; po dosažení se další mutace **odmítne**,
  neodloží (fronta by porušila I-11);
- `PENDING`/`UNKNOWN` **nikdy nemizí časem**. Uvolní je jen rozřešení nebo
  vědomé zahození uživatelem.

Strop bez cesty ven by byl jednosměrná rohatka — aplikace by se dostala do
stavu, ze kterého se sama nedostane. Proto existují dvě routy navíc:
`GET /m1/operations` (výpis vlastních neuzavřených pokusů, s důvodem u
`UNKNOWN`) a `POST /m1/operations/:id/abandon` (vědomé opuštění). Opuštění
**nezavírá operaci, jen záznam** — odpověď to říká polem `effectStillUnknown`
a UI to říká uživateli předem. Rozřešený záznam opustit nelze; to by zahodilo
právě tu odpověď, kvůli které žurnál existuje.

Obě routy jsou bez scope záměrně: při dosažení stropu se odmítají všechny
mutace, takže kdyby uvolnění stropu samo vyžadovalo scope, který zařízení
nemá, nebyla by cesta ven vůbec. **Chrání je vazba na `deviceId`** — token
určuje zařízení a dotaz filtruje `device_id`, takže cizí ani uhádnutý klíč
nevrátí nic. To je silnější než scope check, ale jen dokud je to testované;
proto jsou testy pojmenované doslova (§7).

### Proč je `UNKNOWN` důvod kód

`markUnknown()` ukládá `unknown_reason` z **uzavřeného seznamu**
(`src/mobile/protocol.js`), `unknown_at` a každé čtení stavu razítkuje
`last_checked_at`. Volný text by nešel otestovat ani přeložit a nesl by na
obrazovku obsah chybového řetězce z upstreamu.

| Kód | Mohl efekt nastat |
|---|---|
| `upstream_timeout` | ano — požadavek odešel, odpověď nepřišla |
| `upstream_unreachable` | spíš ne — spojení se nenavázalo |
| `connection_lost_after_dispatch` | ano, klidně celý |
| `upstream_error_status` | ano, mohl stihnout část |
| `process_terminated` | ano — gateway skončila za běhu operace |
| `result_persistence_failed` | téměř jistě — zápis výsledku selhal |
| `gateway_exception` | neurčeno |
| `unspecified` | neurčeno — příčinu server nezaznamenal |

Neznámý řetězec degraduje na `unspecified`; `markUnknown()` nikdy nespadne,
protože běží přesně ve chvíli, kdy server o operaci ztratil přehled.
V seznamu **není** `client_disconnected` — gateway dnes nerozliší klienta,
který zavěsil, od klienta, který čeká, a slovník s položkou bez producenta je
slib, který server nedrží.

### Úklid po pádu procesu — a proč je omezený na vlastníka

Při startu `sweepInterrupted()` překlopí `PENDING` záznamy po pádu procesu na
`UNKNOWN` / `process_terminated`. Bez toho by tvrdily „běží" o procesu, který
neexistuje, a držely místo ve stropu navždy.

Sweep ale **nesmí sáhnout na cizí živou operaci**. Původní verze přepisovala
všechny `PENDING` v tabulce s odůvodněním „při startu nic neběží" — což platí
pro jeden proces a neplatí pro dva nad jednou databází. Port to nezachrání:
sweep běží **před** `listen()`, takže druhý proces škodu napáchá a teprve pak
zjistí, že port je obsazený. S `C3_MOBILE_PORT=0` kolize nenastane vůbec.

Vlastnictví je proto explicitní (migrace 057):

| Sloupec / tabulka | Role |
|---|---|
| `mobile_operations.owner_instance` | která instance gateway záznam otevřela; `NULL` = zápis před migrací 057 nebo z nenavázaného žurnálu |
| `mobile_gateway_instances` | registr instancí: `pid`, `host_identity` (hostname + boot id), `heartbeat_at`, `released_at` |

Instance je **živá**, jen když má čerstvý heartbeat (TTL 5 min) **a** — na tomto
stroji a bootu — běžící PID. Obě podmínky zároveň, aby každá chyba padla na
bezpečnou stranu. Sweep pak překlopí jen řádky, které **nemá kdo živý vlastnit**:

| Vlastník řádku | Sweep |
|---|---|
| živá jiná instance | **nesahá** — to je ta záruka |
| tato instance | nesahá |
| mrtvá instance | překlopí na `process_terminated` |
| `NULL` (pre-057) | překlopí — živého vlastníka nelze doložit |

Jediný případ, kdy to rozhodne špatně: proces žije, ale déle než 5 minut
nespustil heartbeat timer. Gateway se zablokovanou smyčkou stejně neobsluhuje
požadavky. Je to napsané zde, ne zamlčené.

Důkaz je v `tests/mobile-operation-isolation.test.js` — mimo jiné dvěma
**skutečnými procesy** nad jednou databází.

**Poctivé omezení:** `GET /m1/operations/:id` je **čtení posledního zapsaného
stavu, ne rekonciliace** s tím, co doopravdy proběhlo upstream. `UNKNOWN`
zůstane `UNKNOWN`, i kdyby efekt dávno doběhl. Klient proto ukazuje „ověřeno
před N", ne živý stav. Skutečné dohledání je `MR-25`.

---

## 7. Testy

```bash
node tests/mobile-data-model.test.js          # 41 — DATA-MODEL §8
node tests/mobile-gateway-boundary.test.js    # 38 — hranice proti běžícímu listeneru
node tests/mobile-gateway-supervisor.test.js  #  9 — vlastněný proces
node tests/mobile-operation-isolation.test.js # 14 — izolace sweepu mezi procesy
node tests/mobile-fault-injection.test.js     # 15 — result_persistence_failed
node tests/mobile-migration-parity.test.js    # 12 — parita migrací 055/056/057
node tests/schema-migrations.test.js           # 38 — migrace schématu
node scripts/check-migration-numbers.mjs      #      kolize čísel migrací (§6.5)
npm run test:mobile:browser                   # 12 — §4/§8/§10 v Chrome (BLOCKED: chromium-runtime)
node tests/legacy-listener-boundary.test.js   # 11 — offline policy
```

Čtyři síťové mobilní sady mají `requirements.server:false`, protože si
listener spouštějí a zastavují samy. Další dvě mobilní sady jsou
`ACTIVE` a čistě databázové (`network:none`). Těchto šest foundational sad a
pět approval/client successorů tvoří 11 required `ACTIVE` mobilních programů;
všechny v M3 prošly.

---

## 8. Co prokázané není

- chování při bindu na **skutečnou** síťovou adresu — netestováno;
- odolnost proti reálnému nedůvěryhodnému peerovi;
- **32 sad s profilem `server`** — všechny mají
  `requirements.server:true` a bez externího, identity-verified server
  supervizoru nejsou runtime-eligible; jejich ledgerový `state` je
  7 `ACTIVE` / 12 `BLOCKED` / 13 `KNOWN_DEFECTIVE`;
- úplný Gate 0 PASS — **neexistuje**: sdílený deterministický profil je FAIL,
  exit `1`, `208 PASS / 3 FAIL`; sdílená validace a `WP-MOBILE-025` zůstávají
  blokované na `F-115`/`F-116` a Gate 0 verdikt ani handoff nebyl vydán.

Proto zůstává v platnosti zákaz vzdálené expozice z PLAN.md §8.1.

---

*Navazuje: [PLAN.md](PLAN.md) · [DATA-MODEL.md](DATA-MODEL.md) · [SCREENS.md](SCREENS.md) · [COVERAGE.md](COVERAGE.md)*
