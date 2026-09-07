# IntentSmith Mobile — klientský datový, cache a trust model

> **Kanonický overlay větve `mobile/master-prod-ready` (2026-09-07):** text
> níže zachycuje původní 13-route checkpoint. Aktuální přesný allow-list má 26
> rout; vedle worker/specialist read modelu, správy zařízení, revizního
> `PUT /m1/settings` a create-only `POST /m1/memory` obsahuje precondition-checked
> `PUT /m1/workers/:id/enabled` a metadata-only
> `GET /m1/workers/:id/runs` a live-only
> `GET /m1/specialists/:id`. MM3-C navíc rozšířilo existující
> `GET /m1/conversations` o uzavřený `projectId` filtr. Projektový seznam
> konverzací je memory-only, má request/response `no-store` a mizí při ztrátě
> scope, relace, uzamčení aplikace nebo spojení. MM3-D poté doplnilo validovaný
> page snapshot globální S1 cache a úplný cursorový průchod. MM3-E přidalo
> state-bound page snapshots projektů. MM4-J uzavírá worker/specialist list
> snapshots exact DTO a page-boundary validací. MM3-F nyní stejnou exact
> validaci, id binding a failure semantics uplatňuje na detail projektu.
> MM4-K nyní ověřuje exact live-only settings DTO a celý 46-path public owner
> map před publikací nebo odemčením editoru. MM4-L váže exact LTM/task records
> na server-issued page boundary a validuje current i legacy cache. Autoritou
> poslední změny je review `MM4L-STORED-INFORMATION-LIST-INTEGRITY`;
> wildcard ani obecný `/api` proxy nevznikl.

**Status:** **`LOCAL_REGISTRY_CONVERGED / MOBILE_SUBSET_PASS / SHARED_VALIDATION_BLOCKED`**; žádná produktová fáze není DONE
**Revize:** vstupy `RV-028`, `RV-036`, `RV-037`, reconciliation `RV-038`; Composition Review C `RV-039`/`RV-040`; registr a chráněné hodnoty `RV-042`/`RV-043`
**Datum:** 2026-08-01
**Stavová evidence:** produktový commit `4553b3ee`; registr `362`, `C3-031=7`, `C3-032=5`, `offline=178`, `database=33`, required ACTIVE deterministic `211`; všech 11 mobilních programů a `schema-migrations` PASS, ale celý profil skončil exit `1`, `208 PASS / 3 FAIL` kvůli `F-115` a `F-116`; žádný Gate 0 PASS, verdikt ani handoff nebyl vydán a `F-100` zůstává produkční blocker
**Vychází z:** [ADR 0001](../adr/0001-mobile-data-ownership.md) ACCEPTED — REMOTE_COMPANION
**Souvisí:** [PLAN.md](PLAN.md) §2 (hranice), §5 (fáze 1–5), `G0-R032`

**Aktuální hranice:** kód a `gateway-policy.js` drží přesný **13-route HTTP
allow-list**. Je to dnešní implementovaný/source-policy-frozen povrch, nikoli
formálně refrozený kontrakt v2 pro šest domén z `DR-008`. Dnešní `/m1` nemá
WebSocket ani SSE. Existují třída/DB tabulka a HTTP read/ack surface
(`GET /m1/notifications`, `POST /m1/notifications/ack`), ale bez produkčního
producenta a wiring nejde o dosažitelný end-to-end inbox; realtime je jen
budoucí neautorizovaný kandidát. Každé nové spárování razí nový `deviceId`,
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

Legenda: **[F]** ověřený fakt v tomto repu · **[R]** doporučení · **[?]** rozhodnutí operátora · **[D]** odloženo

---

## 0. Co tento dokument rozhoduje a co nerozhoduje

**Rozhoduje** doménové chování dat v mobilním klientovi pod REMOTE_COMPANION:
kdo data vlastní, co smí ležet v telefonu, jak dlouho, co se s tím děje při
odhlášení a revokaci a co z toho zbyde útočníkovi po ztrátě telefonu.

**Nerozhoduje** — a záměrně: budoucí endpointy, nové tvary payloadů, nový
transport, názvy tabulek ani knihovny úložiště. Aktuální implementovaný a
source-policy-frozen 13-route HTTP allow-list pouze popisuje jako fakt;
**formální kontrakt v2** se zde neschvaluje ani nerefreezuje (PLAN.md §8,
podmínka 2). Model níže je formulovaný tak, aby platil pro každý budoucí
autorizovaný transport, který splní doménové požadavky z §8.

**Tento dokument neimplementuje nic** a nezakládá žádnou routu, scope, pole ani
schopnost. Dřívější věta „neimplementuje se nic — žádný listener, pairing,
`/m1`, UI" **už neplatí**: gateway, `/m1` handlery, pairing, žurnál operací a
PWA klient existují (PLAN.md §2, §7.1). Co platí dál: lokální kandidát prošel
Composition Review C (`RV-039`/`RV-040`) a registry review (`RV-042`/`RV-043`),
ale sdílená validace skončila `208/3`; nemá průchod do integrovaného
produktového stavu a není `DONE`. Historický
`PC-010` byl schválený, ale neprovedený; pro tuto kompozici jej nahradil
`PC-012`. Historické `392c5928` dostalo `CHANGES_REQUIRED`
(`RV-023`–`RV-025`); přesné source vstupy `a3443de1`/`0292cb69` dostaly v
bounded `RV-028` `APPROVED_WITH_FOLLOWUPS`, nyní jsou lokálně složené a jejich
jediná reconciliation prošla `RV-038`. Kontrakt
`/m1` **není refrozen jako v2** a **síťové zpřístupnění neexistuje — celá mobilní
plocha je LOOPBACK-ONLY** (`GAP-2`).

---

## 1. Invarianty

Jedenáct pravidel, ze kterých se odvozuje každý řádek §4. Kde tabulka
a invariant nesouhlasí, platí invariant a tabulka je chyba.

| # | Invariant | Proč |
|---|---|---|
| **I-1** | Server je jediný zdroj pravdy pro každý serverový koncept. Klient nikdy nedrží autoritativní verzi čehokoli serverového. | ADR 0001. Jinak vzniká slučování, které ADR výslovně odmítá |
| **I-2** | Offline je čitelné **pouze to, co bylo explicitně cachováno**. Neexistuje „snad to tam bude" — co není v cache, se nezobrazí a UI to řekne. | Tichý výpadek dat je horší než prázdná obrazovka; uživatel nesmí jednat podle neúplného seznamu |
| **I-3** | Změny serverového stavu se **nefrontují**. Offline pokus o změnu je odmítnut nyní, ne uložen na později. | Fronta je skrytá obousměrná synchronizace. ADR 0001 ji odmítá |
| **I-4** | Approvaly, příkazy, bezpečnostní a administrativní operace se nefrontují **nikdy** — ani jako opt-in, ani „chytře". | Odložený souhlas je souhlas s něčím jiným, než co uživatel viděl. Silnější než I-3: I-3 lze v budoucnu zvážit pro neškodné operace, I-4 ne |
| **I-5** | Rozepsaná zpráva je **jediný lokální originál** v celém klientovi. Její automatické odeslání po reconnectu **není** povoleno — viz `D-M1`. | Text psaný před 40 minutami do jiného kontextu se nesmí odeslat sám |
| **I-6** | Device token a párovací tajemství žijí **výhradně** v systémovém secure storage. Nikdy v cache DB, preferencích, logu, diagnostice ani chybovém hlášení. | Cache je předpokládaně čitelná (I-7, §5); token předpokládaně ne |
| **I-7** | Revokace zařízení zabrání **novému** přístupu. **Nesmaže data, která už v telefonu leží.** Tento limit je vlastnost systému, ne chyba k opravě. | Server nemá nad odpojeným telefonem žádnou moc. Evidováno jako `M-R1` |
| **I-8** | Cachuje se jen to, co má konkrétní obrazovka pro offline čtení slíbeno. Ne „co zrovna přišlo z odpovědi". | Každý cachovaný bajt je bajt, který přežije ztrátu telefonu |
| **I-9** | Každý cachovaný záznam nese `fetchedAt` a verzi/otisk od serveru. Bez toho nelze rozlišit čerstvé od zastaralého a §3 nemá na čem stát. | Obrazovkový stav „zastaralá cache" musí být odvoditelný, ne odhadnutý |
| **I-10** | Cache je **odvozená a kdykoli zahoditelná**. Její ztráta nesmí znamenat ztrátu dat — s **třemi** lokálními výjimkami: `MD-14` (draft), `MD-15` (lokální preference) a index klíčů operací (`MD-19` §4.5). Ztráta indexu bere lokální atribuci, rozřešenou historii a retry materiál; při zachovaném tokenu téhož zařízení ale neruší serverovou discovery otevřených pokusů. | Test: smazání app dat nesmí uživatele připravit o serverová data a musí přesně přiznat ztrátu lokálních schopností. Tři výjimky jsou vyjmenované, ne odvozené — viz `U-9` |
| **I-11** | **Klíč operace chrání před duplicitou, neopravňuje a neodkládá.** Záznam ve stavu `PENDING`/`UNKNOWN` se nikdy neodešle sám a u approvalů, bezpečnostních a administrativních operací nenahrazuje ani neprodlužuje jednorázové oprávnění. | Bez tohoto pravidla je žurnál operací fronta pod jiným jménem a I-3 i I-4 padají |

---

## 2. Klasifikace citlivosti

Citlivost určuje povolené úložiště, ne naopak.

| Třída | Obsah | Povolené úložiště | Smí do logu / diagnostiky |
|---|---|---|---|
| **S0** | Neutrální technické údaje: verze API, dostupnost, název modelu | `ST-PREFS`, `ST-DB`, `ST-MEM` | ano |
| **S1** | Provozní metadata bez obsahu: názvy projektů, počty, časy, stavy | `ST-DB`, `ST-MEM` | jen agregovaně, bez názvů |
| **S2** | **Obsah**: zprávy, uchovávané informace, diffy, obsah souborů, poznámky, přílohy | `ST-DB` (chráněná), `ST-MEM` | **ne** |
| **S3** | **Tajemství**: device token, párovací kód, cokoli, čím se lze autentizovat | **jen `ST-SECURE`** | **ne, ani zkráceně, ani hash** |

### Úrovně úložiště

| Kód | Co to je | Vlastnosti |
|---|---|---|
| `ST-SECURE` | Systémové secure storage (Keystore / Keychain) | Klíč vázaný na zařízení; mimo běžnou zálohu; jediné povolené místo pro S3 |
| `ST-DB` | Lokální databáze klienta, chráněná klíčem uloženým v `ST-SECURE` | Nese veškerý cachovaný serverový obsah; předmět §5 |
| `ST-PREFS` | Nešifrované klíč/hodnota preference | Jen S0/S1 bez obsahu — téma, hustota, poslední otevřená záložka |
| `ST-MEM` | Pouze RAM, nepřežije ukončení procesu | Výchozí volba, když stačí |
| `ST-NONE` | Neukládá se vůbec | |

**[R]** `ST-DB` musí být chráněná klíčem z `ST-SECURE`, ne jen spoléhat na
šifrování souborového systému OS. Rozdíl je hmatatelný u odemčeného telefonu
a u zálohy — viz `M-R2`. Rozhodnutí `D-M2`.

---

## 3. Životní cyklus cachovaného záznamu

Tři stavy, ne dva. Obrazovkový stav „zastaralá cache" z mapy toků existuje
právě proto, že mezi „čerstvé" a „nic" je pásmo, ve kterém data pořád mají cenu.

```
  fetch ──▶ FRESH ──(ttlFresh)──▶ STALE ──(ttlHard)──▶ EXPIRED ──▶ smazáno
              │                     │                      │
       zobrazí se bez        zobrazí se s viditelným   nezobrazí se
        upozornění            „data z <čas>"           ani offline
```

| Stav | UI | Smí na tom stavět akce? |
|---|---|---|
| `FRESH` | normální zobrazení | ano |
| `STALE` | povinný viditelný ukazatel stáří a zdroje (cache) | **jen čtení.** Žádná mutace, žádný approval, žádné rozhodnutí |
| `EXPIRED` | nezobrazí se; UI ukáže „offline, data vypršela" | ne |

**Pravidla:**

- `EXPIRED` záznamy se mažou při startu aplikace, při přechodu do pozadí
  a při každém úklidu — ne až při příštím zobrazení.
- Vypršení TTL **není** invalidace. Invalidace je změna na serveru; TTL je
  hranice důvěry v nepřipojeném stavu. Obojí musí existovat.
- Invalidace přichází třemi cestami: (a) explicitní refresh obrazovky,
  (b) posun kurzoru `MD-13`, (c) notifikační událost `MD-08`.
  Cesta (c) je nejslabší — notifikace nemusí dorazit (PLAN.md §6), takže na ní
  nesmí stát korektnost, jen svižnost.
- **[?] `D-M5`** — konkrétní hodnoty TTL v §4 jsou návrh. Přeměří se po Fázi 1.

---

## 4. Datové typy

Značení: `MD-xx`. Sloupec „Offline změny" používá:

| Kód | Význam |
|---|---|
| `MUT-ONLINE-ONLY` | Změna je možná jen online. Offline se pokus odmítne s vysvětlením, nic se neukládá |
| `MUT-NEVER-QUEUED` | Jako výše a navíc: nesmí být nikdy zavedena fronta, ani volitelně (I-4) |
| `MUT-LOCAL-ORIGINAL` | Lokální originál — jediný případ, `MD-14` |
| `MUT-LOCAL-ONLY` | Data, která na serveru nemají protějšek a nikdy se neodesílají |

---

### MD-01 — Nastavení (podmnožina viditelná na mobilu)

> **Implementační checkpoint MM4-E (2026-09-06):** aktuální klient drží tuto
> projekci záměrně jen v paměti a při vstupu ji čte živě; níže navržený `ST-DB`
> settings cache proto není implementační pravda této větve. Zapisovat lze jen
> 11 cest `UX_PREFERENCES_V1`, nad přesnou revizí a s `operationId`; konflikt se
> nepřepisuje a nejasný výsledek se automaticky neopakuje. Viz
> `reviews/MM4E-REVISIONED-SETTINGS-WRITE.md`.

> **Implementační checkpoint MM4-K (2026-09-07):** live response se publikuje
> pouze jako exact `{ revision, settings, version }` s pozitivní safe-integer
> revizí, `v1:` verzí a konečnými JSON hodnotami výhradně na všech 46
> core-owned veřejných cestách. Klientská kopie allow-listu se v testu přímo
> porovnává s core exportem. Unknown/private nebo neplatná vnořená data odmítnou
> celý read a neodemknou 11-path MM4-E editor. Cache tím nevzniká a route,
> scope, port ani wire se nemění. Zdrojová evidence:
> [MM4-K review](reviews/MM4K-PUBLIC-SETTINGS-INTEGRITY.md).

**`R-5` uzavřeno — jednoznačně a všude:** tabulka dělení v PLAN.md **§5.4** je
**závazná**. Celá Security sekce a feature flags na telefon nepatří. `R-5` není
otevřené rozhodnutí operátora a v žádné tabulce této sady se tak nesmí značit
(nález `F-069`).

Uzavřené je **dělení**, ne dodání. Přijetí `DR-008` autorizovalo jen jedno
společné kontraktní kolo. Fáze 2 (`MR-12`, `MR-13`) zůstává blokovaná, dokud
nebude změněný kontrakt nezávisle schválený a refrozen jako v2, nebudou splněné
příslušné Gate 1 závislosti a nevznikne samostatný implementační Work Package
(PLAN.md §5.3). Zamýšlené pořadí z ní dělá první implementační fázi, ne
automaticky otevřenou práci.

| Atribut | Hodnota |
|---|---|
| Zdroj pravdy | **server** |
| V telefonu | ano — jen podmnožina z `R-5`, jako cache pro čtení |
| Citlivost | **S1** (hodnoty knobů) |
| Úložiště | `ST-DB` |
| TTL | `FRESH` 1 h · `STALE` 24 h · `EXPIRED` 24 h |
| Invalidace | při otevření obrazovky nastavení vždy refresh; STALE se needituje |
| Offline čtení | `READ_CACHED` — zobrazí se jen pro informaci, ovládací prvky jsou neaktivní |
| Offline změny | `MUT-ONLINE-ONLY` |
| `E-LOGOUT` | smazat |
| `E-EXPIRE` | ponechat do konce TTL jako read-only, editace zamčená |
| `E-REVOKE` | smazat při zjištění |
| Po ztrátě (`E-LOST`) | čitelné do `EXPIRED`. Prozrazuje konfiguraci stroje, ne obsah |

> Editace nastavení z telefonu je změna serverového stavu se skutečným
> dopadem. Nikdy se needituje nad `STALE` daty — jinak uživatel přepíše hodnotu,
> kterou už někdo změnil.

#### `R-5` — pět invariantů dělení nastavení

| # | Invariant | Kde se to projeví |
|---|---|---|
| **R5-1** | Bezpečnostní, autorizační, pairingové, projektové a serverové nastavení má **autoritativní zdroj na serveru** | `MD-01`, `MD-12`, `MD-16` |
| **R5-2** | Vzhled, lokální cache a čistě zařízení specifické chování zůstává **lokální** | `MD-15` |
| **R5-3** | **Lokální nastavení nesmí oslabit serverovou policy ani rozšířit scope** — je to preference, ne oprávnění | `MD-12` je nápověda, ne vynucení |
| **R5-4** | Při konfliktu bezpečnostně významných hodnot **vítězí server** a klient ten stav **jasně zobrazí** | `SS-09` u `MS-10`/`MS-11` |
| **R5-5** | Logout a revokace odstraní lokální **zařízení specifická a citlivá** nastavení **podle již definovaného datového modelu** | řádky `E-LOGOUT`/`E-REVOKE` v §4 |

> `R5-5` nezavádí nové mazání a nepřebíjí §4. `MD-01` se při logoutu maže,
> protože je to serverová hodnota v cache; `MD-15` (téma, hustota — `S0`)
> zůstává, protože to nejsou data účtu. „Citlivá" je v `R5-5` určující slovo:
> co je `S0` a čistě kosmetické, mazat není co.
>
> `R5-3` je jediný invariant s bezpečnostním zubem. Zbytek popisuje vlastnictví;
> tenhle zakazuje obcházení — žádná lokální volba nesmí být cestou, jak si
> přidat scope nebo změkčit serverové pravidlo.

---

### MD-02 — Projekty a jejich lifecycle stav

> **Kanonický stav MM3-A/MM3-C/MM3-E/MM3-F na této větvi:** na základě explicitního
> operátorského zadání existuje read-only seznam/detail projektů a živý
> drill-down do jejich konverzací. Jde o `SOURCE TESTED / DEVICE TEST PENDING`,
> nikoli o refreeze wire v2 nebo dokončený lifecycle. Projektové a konverzační
> mutation operace zůstávají nedostupné. Starší blokované znění v historických
> podkladech proto není stavem aktuálního checkoutu.

| Atribut | Hodnota |
|---|---|
| Zdroj pravdy | **server** |
| V telefonu | ano — seznam a stav, ne obsah pracovního adresáře |
| Citlivost | **S1** (názvy projektů prozrazují, na čem operátor dělá) |
| Úložiště | `ST-DB` |
| TTL | `FRESH` 15 min · `STALE` 7 dnů · `EXPIRED` 7 dnů |
| Invalidace | refresh obrazovky, kurzor, notifikace o změně fáze |
| Offline čtení | `READ_CACHED` — seznam a poslední známá fáze, vždy se stářím |
| Offline změny | `MUT-NEVER-QUEUED` — start, bind, přechod fáze jsou administrativní operace |
| `E-LOGOUT` | smazat |
| `E-EXPIRE` | ponechat do konce TTL, read-only |
| `E-REVOKE` | smazat při zjištění |
| Po ztrátě (`E-LOST`) | čitelný seznam projektů a fází |

Projektový seznam a detail používají omezenou S1 cache podle tabulky. Seznam
konverzací uvnitř detailu je jiný dataset: `ST-MEM`, živý, se dvěma scopy
(`read:projects` + `read:chat`), request/response `no-store` a cursorem vázaným
na projekt. Mizí při odchodu z projektu, uzamčení, disconnectu nebo odebrání
kteréhokoli scope a po návratu se čte znovu. Názvy a metadata projektů tedy
mohou zůstat označené jako cache, ale členství konverzací se z cache netvrdí.

> **Implementační checkpoint MM3-E (2026-09-07):** seznam projektů ukládá
> oddělený validovaný `{ items, page }` snapshot pro `active` a `archived`.
> Response `state`, každý řádek, cache key i opaque cursor musí patřit právě
> vybranému filtru. Duplicate/overlap nebo pozdní response starého filtru
> potvrzené okno nepřepíše. Starý array-only snapshot zůstává při upgradu
> čitelný, ale nevydává se za potvrzený konec ani zdroj cursoru. Ztráta
> `read:projects` maže oba seznamy, jejich boundaries a detailové cache.
> Zdrojová evidence: [MM3-E review](reviews/MM3E-PROJECT-LIST-PAGINATION.md).

> **Implementační checkpoint MM3-F (2026-09-07):** live i cached detail musí
> mít exact veřejný DTO tvar a id shodné s požadovanou routou. Expired/corrupt
> snapshot se před publikací smaže; nejednoznačný offline/server/protocol pád
> ponechá pouze validní neexpirovanou kopii s explicitním označením a retry.
> Definitivní `not_found`, ztráta scope a pozdní response po odchodu detail i
> cache stáhnou nebo nechají inertní. MM3-F nemění délku cache: aktuální
> generické klientské window je `FRESH` 1 min a `EXPIRED` po 15 min, takže delší
> cíl v tabulce výše zatím není implementovaná skutečnost a jeho sjednocení
> zůstává otevřené. Zdrojová evidence:
> [MM3-F review](reviews/MM3F-PROJECT-DETAIL-INTEGRITY.md).

---

### MD-03 — Konverzace (seznam a metadata)

| Atribut | Hodnota |
|---|---|
| Zdroj pravdy | **server** ([F] `GET /api/conversations`, `src/routes/chat.js:224`) |
| V telefonu | ano — okno posledních N konverzací |
| Citlivost | **S1** (titulky konverzací jsou fakticky obsah — viz poznámka) |
| Úložiště | `ST-DB` |
| TTL | `FRESH` 15 min · `STALE` 30 dnů · `EXPIRED` 30 dnů |
| Invalidace | refresh, kurzor, notifikace o nové zprávě |
| Offline čtení | `READ_CACHED` |
| Offline změny | `MUT-ONLINE-ONLY` (přejmenování, archivace, smazání) |
| `E-LOGOUT` | smazat |
| `E-EXPIRE` | ponechat do konce TTL, read-only |
| `E-REVOKE` | smazat při zjištění |
| Po ztrátě (`E-LOST`) | čitelný seznam titulků a časů |

> **Titulek konverzace je odvozený z obsahu.** Formálně metadata, prakticky
> často shrnutí toho nejcitlivějšího. Proto se `MD-03` chová jako S1 s poznámkou:
> pro účely §5 se s ním zachází jako s obsahem.
>
> **Implementační checkpoint MM3-D (2026-09-06):** globální seznam ukládá
> validovaný snapshot `{ items, page }`, kde `page` je poslední serverem
> potvrzené `hasMore`/`nextCursor`/`end`. Další stránku smí vyžádat jen opaque
> cursorem z tohoto snapshotu; počet řádků ani starý array-only formát nesmí
> vytvořit domnělý cursor nebo konec. Neplatná a překrývající se stránka
> poslední potvrzené okno nepřepíše. Odebrání `read:chat` maže paměť, boundary
> i tuto S1 cache; lock maže paměť a zneplatní rozběhnuté čtení, ale dodržuje
> stávající logout/revoke/TTL pravidla trvalé cache. Zdrojová evidence:
> [MM3-D review](reviews/MM3D-CONVERSATION-LIST-PAGINATION.md).
>
> **Hledání (`MR-10`) nad `MD-03`/`MD-04`: `BLOCKED_BY_CONTRACT`**
> (PLAN.md §5.1). **Hledání v cachovaném okně požadavek nesplňuje** — uživatel,
> který nic nenajde, z toho nesmí usoudit, že hledaná věc neexistuje. Kontrakt
> musí napevno určit rozsah hledání, stránkování, autorizaci, klasifikaci dat
> a chování offline. Do jeho schválení k `MR-10` nevzniká UI.

---

### MD-04 — Zprávy v konverzaci

| Atribut | Hodnota |
|---|---|
| Zdroj pravdy | **server** ([F] `GET /api/conversations/:id/messages`, `src/routes/chat.js:288`) |
| V telefonu | ano — **jen okno**, ne celá historie. Rozsah `D-M6` |
| Citlivost | **S2** |
| Úložiště | `ST-DB` |
| TTL | `FRESH` 15 min · `STALE` 7 dnů · `EXPIRED` 7 dnů |
| Invalidace | otevření konverzace vždy refreshuje hlavu; kurzor `MD-13` |
| Offline čtení | `READ_CACHED` — jen stažené okno, konec okna je v UI viditelný, ne tichý |
| Offline změny | `MUT-ONLINE-ONLY` — odeslání zprávy offline se odmítne; text zůstane jako `MD-14` |
| `E-LOGOUT` | smazat |
| `E-EXPIRE` | ponechat do konce TTL, read-only |
| `E-REVOKE` | smazat při zjištění |
| Po ztrátě (`E-LOST`) | **čitelný obsah konverzací v rozsahu okna.** Nejcitlivější položka celého modelu |

> Okno je bezpečnostní parametr, ne výkonnostní. Čím delší, tím větší dopad
> ztráty telefonu. Výchozí návrh **[R]**: posledních 200 zpráv na konverzaci,
> maximálně 20 naposledy otevřených konverzací.

---

### MD-05 — Přílohy a média

| Atribut | Hodnota |
|---|---|
| Zdroj pravdy | **server** |
| V telefonu | **[R] ne** pro 1.0 — zobrazují se jen online, do `ST-MEM` |
| Citlivost | **S2** |
| Úložiště | `ST-MEM` (výchozí), `ST-NONE` na disku |
| TTL | neaplikuje se — nepřežije proces |
| Invalidace | — |
| Offline čtení | `READ_NONE` — offline se ukáže zástupný stav, ne prázdno |
| Offline změny | `MUT-ONLINE-ONLY` |
| `E-LOGOUT` | vyprázdnit RAM |
| `E-EXPIRE` / `E-REVOKE` | totéž |
| Po ztrátě (`E-LOST`) | **nic** — pokud se nezavede diskový cache |

> Obrázky a soubory jsou nejobjemnější a nejhůř mazatelná kategorie (systémové
> galerie, náhledy OS). Necachovat je nejlevnější bezpečnostní rozhodnutí, které
> tento model dělá.

#### `R-4` — diffy pro 1.0: **přeformulováno pravdivě**

Dřívější znění uzavíralo `R-4` větou „zobrazit ano, stáhnout ne". **Ta věta
zavírala schopnost, kterou kontrakt nedodává** (nález `F-068`): approval, který
se dnes k telefonu dostane, nese **titulek, popis a otisk payloadu** — žádný
diff. Zavřít „zobrazování diffu" nad zdrojem dat, který diff neobsahuje, je
uzavření na papíře.

**`R-4` je proto uzavřeno v tomto — a jen v tomto — rozsahu:**

| Pro 1.0 | Stav |
|---|---|
| Approval nese **popis a otisk** schvalovaného obsahu | závazné; na tom stojí vazba rozhodnutí na obsah (`MD-07`, `R-3`) |
| **Zobrazení diffu** v mobilním klientovi | **NENÍ součástí 1.0. Vedeno jako nesplněné, ne jako vyřešené** |
| Stažení diffu jako souboru | **zakázáno** |
| Export nebo sdílení do jiné aplikace | **zakázáno** |
| Uložení do uživatelsky přístupného úložiště telefonu | **zakázáno** |

**Požadavek nezmizel.** Rozhodovat podle popisu a otisku je vědomé omezení 1.0,
ne tvrzení, že diff není potřeba. Jakékoli budoucí zobrazení diffu vyžaduje
**vlastní kontraktní kolo** (zdroj dat, rozsah, klasifikace, velikostní strop)
a **vlastní threat model**; do té doby o něm žádný dokument v této sadě nesmí
mluvit jako o dostupné schopnosti.

Zákaz cesty ven platí beze změny a nezávisle na tom, zda diff někdy začne
existovat: jakmile obsah opustí aplikaci, přestávají pro něj platit `E-LOGOUT`,
`E-REVOKE` i celá §5, protože systémová galerie ani cizí aplikace o revokaci
zařízení nevědí. To **není** zákaz nezbytné chráněné cache pro samotné
zobrazení — ta smí existovat v mezích tohoto modelu (`ST-MEM`, případně `ST-DB`
pod ochranou §2).

Obsah schvalovaného approvalu se řídí i `MD-07`.

---

### MD-06 — Uchovávané informace (LTM, task memory)

> **Implementační checkpoint MM4-F (2026-09-06):** klient čte filtrovanou
> projekci LTM a task memory a smí online vytvořit jen nový explicitní LTM klíč
> v jedné ze čtyř veřejných kategorií. Existující klíč nelze nahradit;
> odstranění, zápis task memory a interní kategorie zůstávají nedostupné.
> Mutace se nikdy neřadí offline, její HTTP odpovědi mají `no-store` a lokální
> operation journal neobsahuje klíč ani hodnotu. Viz
> `reviews/MM4F-CREATE-ONLY-MEMORY.md`.

> **Implementační checkpoint MM4-L (2026-09-07):** `MD-06` se publikuje jen
> jako exact 14-field LTM/task DTO v koherentní `kind=all` stránce. Klient
> spotřebuje opaque cursor až do serverem potvrzeného `end`, ukládá
> `{ items, page }` a cache před renderem znovu validuje. Přesný legacy array
> může zůstat čitelný, ale je označený jako neúplný a cursor se nevymýšlí.
> Expired/corrupt cache se maže; vadná live/append response zachová poslední
> validované okno jen ke čtení a relockne MM4-F formulář. Stávající TTL 1 h / 7
> dnů, route, scope, port, wire ani mutation se nemění. Zdrojová evidence:
> [MM4-L review](reviews/MM4L-STORED-INFORMATION-LIST-INTEGRITY.md).

| Atribut | Hodnota |
|---|---|
| Zdroj pravdy | **server** |
| V telefonu | ano — čtení a create-only online formulář dle MM4-F |
| Citlivost | **S2** — kondenzovaný obsah mnoha konverzací naráz |
| Úložiště | `ST-DB` |
| TTL | `FRESH` 1 h · `STALE` 7 dnů · `EXPIRED` 7 dnů |
| Invalidace | refresh obrazovky |
| Offline čtení | `READ_CACHED` |
| Offline změny | `MUT-ONLINE-ONLY`; nic se nefrontuje, replacement i mazání jsou mimo aktuální kontrakt |
| `E-LOGOUT` | smazat |
| `E-EXPIRE` | ponechat do konce TTL, read-only |
| `E-REVOKE` | smazat při zjištění |
| Po ztrátě (`E-LOST`) | čitelné. **Hustota informace je zde vyšší než u `MD-04`** — jedna položka LTM může shrnovat měsíce |

> **[R]** Kvůli té hustotě navrhuji `MD-06` cachovat úsporněji než zprávy:
> jen položky zobrazené na aktuální obrazovce, bez předstahování celého seznamu.

---

### MD-07 — Approvaly (čekající i rozhodnuté)

| Atribut | Hodnota |
|---|---|
| Zdroj pravdy | **server** — výhradně |
| V telefonu | **jen v `ST-MEM`, nikdy na disk** |
| Citlivost | **S2** (popis schvalovaného obsahu nese podstatu příkazu). **Pro 1.0 approval nenese diff** — jen popis a otisk, viz `R-4` v `MD-05` |
| Úložiště | `ST-MEM` |
| TTL | **Cílový kontrakt `R-3`:** lokální okno **5 minut**, vzdálené okno **15 minut**. Autoritou je vždy serverová expirace, ne klientský čas |
| Invalidace | před zobrazením i před odesláním rozhodnutí vždy znovu ověřit stav |
| Offline čtení | `READ_NONE` — **offline se čekající approval nezobrazí vůbec** |
| Offline změny | `MUT-NEVER-QUEUED` |
| `E-LOGOUT` | zmizí s procesem |
| `E-EXPIRE` / `E-REVOKE` | totéž |
| Po ztrátě (`E-LOST`) | **nic** |

> Tři důvody, proč approval nikdy nesmí být cachovaný:
> 1. rozhodnutí nad `STALE` daty je rozhodnutí o něčem jiném (§3);
> 2. cachovaný approval by po ztrátě telefonu prozradil, co se chystalo;
> 3. offline zobrazený approval svádí k frontě, kterou I-4 zakazuje.
>
> Approval se schvaluje **jen** na základě právě načteného stavu, včetně
> vazby na otisk payloadu a serverovou expiraci (PLAN.md §5, Fáze 3).

> **Stav podle `DR-011`: `R-3` je přijatý cílový kontrakt, ne tvrzení o dnešní
> end-to-end implementaci.** Historické `392c5928` nevyžadovalo otisk, když ho
> volající vynechal; bounded successor `a3443de1` tento guard opravil a spolu
> s cache/gateway checkpointem `0292cb69` dostal v `RV-028`
> `APPROVED_WITH_FOLLOWUPS`. Oba přesné source vstupy jsou lokálně složené pod
> `PC-012`/`WP-MOBILE-024`, jejich reconciliation prošla `RV-038` a kompozice
> `RV-039`/`RV-040`; mobilní M3 subset je PASS. Integrovaný produkční producent
> approvalů, autorita pro
> lokální 5minutové a vzdálené 15minutové TTL a autoritativní vazba na run,
> operaci a normalizovaný obsah proto nejsou prokázané.
> To je samostatný produkční blocker `F-100`, který nelze zavřít dokumentací.
> Fáze 3A zůstává `NOT DONE`.

#### `R-3` — přijatý cílový kontrakt rozdílných approval oken

| Okno | Délka | Pro koho |
|---|---|---|
| **lokální** | **5 minut** | operátor u stroje; delší okno tam nic neřeší |
| **vzdálené** | **15 minut** | telefon v kapse — pět minut je pro něj nedosažitelných |

Šest pravidel, která z delšího okna nedělají slabší oprávnění:

1. Approval je **jednorázový**.
2. Je vázaný na **konkrétní run, konkrétní operaci a přesný schvalovaný obsah**.
3. **Jakákoli změna** příkazu, schvalovaného obsahu, oprávnění nebo bezpečnostně
   významného stavu approval **zneplatní** — okno na tom nic nemění.
4. Delší vzdálené okno **neprodlužuje samotné oprávnění po jeho použití**.
   Patnáct minut je lhůta na rozhodnutí, ne platnost výsledku.
5. **Žádný replay oprávnění.** Přesná definice je v §`R-3.1` níže — a je to
   definice, ne slogan.
6. Po expiraci **musí vzniknout nový approval request**. Prodloužení, obnovení
   ani „ještě chvilku" neexistuje.

> Delší okno je ústupek fyzice, ne bezpečnosti: telefon leží v kapse a jeho
> majitel není u obrazovky. Rozšiřuje se **doba na rozhodnutí**, nikoli to,
> co rozhodnutí zmůže.

#### `R-3.1` — replay versus idempotentní odpověď

Dřívější znění `R-3` říkalo „bez replay" a zároveň `MS-14` sliboval „idempotentní
zopakování". Čtené doslova si to odporovalo (nález `F-067`). Rozpor byl
terminologický, ne věcný — **jsou to dvě různé věci a obě musí být pojmenované
zvlášť.** Tato sekce je pro obě autoritou; `MS-14` a `MD-19` ji nesmí přepsat.

| Pojem | Co to je | Povoleno |
|---|---|---|
| **Replay oprávnění** | Druhé **uplatnění** jednorázového souhlasu: znovu se rozhoduje, znovu vzniká efekt | **NIKDY.** Ani s platným klíčem, ani se shodným otiskem, ani v okně |
| **Idempotentní odpověď** | Zopakování **téhož** pokusu pod **týmž klíčem operace** a **týmž otiskem**: server vrátí **už zaznamenaný výsledek** a **nevznikne druhý efekt** | **Ano** — je to čtení výsledku, ne druhé schválení |
| **Konflikt** | Týž klíč s **jiným** otiskem nebo jiným obsahem | **Fail-closed odmítnutí.** Nikdy domýšlení, nikdy druhý efekt |

**Cílové chování, kterým se měří každá implementace `R-3`.** Následující body
jsou normativní kontrakt, nikoli tvrzení, že je historické `WP-MOBILE-016`
nebo bounded successory `WP-MOBILE-019`/`020` vynucují end to end:

1. **Klíč se drží.** Kde je opakování vůbec přípustné, nese **týž klíč operace**
   (`MD-19`). Klíč je ochrana proti duplicitě uvnitř **jednoho** vědomého
   rozhodnutí.
2. **Neúspěšný ani nejasný pokus se nikdy tiše nestane rozhodnutím pod novým
   klíčem.** Ani po timeoutu, ani po pádu spojení, ani po chybě serveru.
   Nejasný výsledek je `UNKNOWN` a při zachovaném tokenu téhož zařízení se řeší
   **`GET /m1/operations/:id` podle klíče** (`MD-19` §4.1), ne čtením
   konverzace ani dalším odesláním.
3. **Nový klíč vzniká výhradně vědomým aktem uživatele**, který ví, že rozhoduje
   znovu — a takový akt je nové rozhodnutí o (nutně novém) approval requestu,
   ne pokračování starého.
4. **Klíč neopravňuje** (`I-11`). Platný klíč nenahrazuje jednorázové oprávnění
   ani ho neprodlužuje; jednorázovost se kontroluje **vždy** a **navíc** k
   deduplikaci podle klíče. Obě kontroly běží; kontrolu jednorázovosti nelze
   uspokojit předložením klíče.
5. **Zopakování pod týmž klíčem se rozpozná a označí** — uživatel musí poznat
   „tohle je odpověď ze záznamu" od „právě se rozhodlo". Tichá shoda obou
   případů je přesně ta záměna, kvůli které `F-067` vznikl.

Splnění těchto klientských pravidel samo `R-3` neuzavírá. Historické
review vrátilo `CHANGES_REQUIRED`; bounded successory následně dostaly v
`RV-028` `APPROVED_WITH_FOLLOWUPS`, jsou lokálně složené a Composition Review C
prošlo `RV-039`/`RV-040`. Registry i mobilní testy prošly, ale celý profil je
`208/3`; produkční producent, TTL autorita a autoritativní restart-safe vazba
zůstávají otevřené v `F-100`.

> Zkratka, která platí všude: **replay = druhý efekt = nikdy. Idempotentní
> odpověď = žádný nový efekt = v pořádku.** Kde by z rozdílu vzniklo ticho,
> vítězí odmítnutí.

---

### MD-08 — In-app notifikace

| Atribut | Hodnota |
|---|---|
| Zdroj pravdy | Existující řádek v serverové tabulce `mobile_notifications`; klientská cache není autorita. Normální produkční pipeline ale dnes žádný mobilní řádek nevytváří (`F-111`) |
| V telefonu | ano — krátká historie, bez obsahu |
| Citlivost | **S1** — text notifikace **nesmí** nést obsah zprávy ani diffu |
| Úložiště | `ST-DB` |
| TTL | `FRESH` — · `STALE` 7 dnů · `EXPIRED` 7 dnů |
| Invalidace | doručením novější události; historie je append-only |
| Offline čtení | `READ_CACHED` — s tím, že seznam je do dalšího HTTP pullu neúplný a UI to říká; existující serverový řádek se offline neztrácí |
| Offline změny | `MUT-ONLINE-ONLY` |
| `E-LOGOUT` | smazat |
| `E-EXPIRE` | ponechat do konce TTL |
| `E-REVOKE` | smazat při zjištění |
| Po ztrátě (`E-LOST`) | čitelné: co se dělo a kdy, bez obsahu |

> **[R]** Notifikace nese ukazatel („nový approval v projektu X"), ne obsah.
> Notifikace se zobrazují i na zamčené obrazovce, kde neplatí žádná z ochran §5.
> Doručovací hranice zůstává dle PLAN.md §6 — spící aplikace nedostane realtime
> signál. Pokud řádek vznikl přímým zápisem nebo seedem, může ho načíst při
> příštím HTTP pullu; běžnou produkční emisi to bez `F-111` wiring nepokrývá.

**`F-111` zůstává otevřený produkční blocker a úzké child evidence root
`F-014`, ne druhý root.** Třída
`MobileChannel`, tabulka a HTTP read/ack surface existují, ale produkční router
`MobileChannel` nekonstruuje ani neregistruje. Bez samostatného produkčního
producenta/wiring běžná notification pipeline řádek nevytvoří (`F-111`).

Stav přečtení **je** od migrace 058 per-device autorita a `F-112` je uzavřený
(dřívější znění o tom, že autorita chybí, už neplatí; úzké child
evidence root findingů `F-011`/`F-015`, ne další root). Pull je device-filtered,
ACK však aktualizuje jen podle ID bez `deviceId` a broadcast má jediné globální
`read_at`. Root `F-015` současně zůstává otevřený kvůli závodu `MAX(seq)+1` bez
`UNIQUE`/transakční garance. `DR-003` A a jeho specializace `DR-012` A byly
`PRODUCT_OWNER` přijaty společně; `DR-013` A přijímá policy-controlled S1-safe
companion mirror. Jsou to cílové kontrakty, ne implementace. Dokud nevznikne
per-device receipt/ACK izolace, sekvenční garance, producent/projektor a Gate 1
důkazy, B6 ani životní cyklus `MD-08` nejsou produkčně uzavřené.

---

### MD-09 — Agent log a běhové události

| Atribut | Hodnota |
|---|---|
| Zdroj pravdy | **server** ([F] typy událostí v `src/ws-bridge/protocol.js`) |
| V telefonu | jen běžící relace; **na disk nic** |
| Citlivost | **S2** — události nesou názvy souborů, útržky promptů a verdikty |
| Úložiště | `ST-MEM` |
| TTL | délka relace, strop na počet událostí v paměti |
| Invalidace | — |
| Offline čtení | `READ_NONE` |
| Offline změny | `MUT-ONLINE-ONLY` |
| `E-LOGOUT` | vyprázdnit |
| `E-EXPIRE` / `E-REVOKE` | totéž |
| Po ztrátě (`E-LOST`) | **nic** |

> Agent log je podle PLAN.md §4 (P6) náhradou za neexistující token streaming.
> Je to indikace postupu, ne přepis běhu — a jako takový nemá důvod přežít
> zavření obrazovky.
>
> **Stav požadavku `MR-07`: `BLOCKED_BY_CONTRACT`** (PLAN.md §5.1). Model výše
> popisuje, jak se s běhovými událostmi zachází, **až nějaké budou**. Dnešní
> blokující `/m1/chat` je jedna odpověď najednou a žurnál operací (`MD-19`) je
> evidence pokusů o mutaci — **ani jedno, ani obojí dohromady není agent log.**
> Do schválení kontraktu, který pojmenuje pravdivý zdroj dat o průběhu, jeho
> životní cyklus a chování při obnově spojení, **nevzniká k `MR-07` žádné UI**.

---

### MD-10 — Diagnostika a health

| Atribut | Hodnota |
|---|---|
| Zdroj pravdy | **server** |
| V telefonu | ano — poslední známý stav |
| Citlivost | **S0** (verze, dostupnost) / **S1** (název modelu, VRAM) |
| Úložiště | `ST-PREFS` pro S0, `ST-DB` pro S1 |
| TTL | `FRESH` 1 min · `STALE` 24 h · `EXPIRED` 24 h |
| Invalidace | každý pokus o spojení |
| Offline čtení | `READ_CACHED` — vždy s časem posledního kontaktu |
| Offline změny | neaplikuje se |
| `E-LOGOUT` | smazat S1; S0 (verze API) může zůstat |
| `E-EXPIRE` | ponechat |
| `E-REVOKE` | smazat S1 |
| Po ztrátě (`E-LOST`) | prozradí existenci a adresu backendu — viz `M-R4` |

> Diagnostika je jediná obrazovka, která má smysl i bez platného tokenu:
> potřebuje odpovědět „je problém v síti, v tokenu, nebo v serveru?".
> Tomu odpovídá požadavek na rozlišitelné chybové stavy v §8.

---

### MD-11 — Device token a identita zařízení

| Atribut | Hodnota |
|---|---|
| Zdroj pravdy | **server** (token vydává a odvolává server) |
| V telefonu | ano — jinak by párování nemělo smysl |
| Citlivost | **S3** |
| Úložiště | **`ST-SECURE`, výhradně** (I-6) |
| TTL | serverová expirace je autorita; klient si ji pamatuje jen pro UX |
| Invalidace | odmítnutí ze serveru, expirace, logout |
| Offline čtení | token se offline nepoužívá; jeho přítomnost určuje jen to, zda se ukáže cache nebo párovací obrazovka |
| Offline změny | `MUT-NEVER-QUEUED` |
| `E-LOGOUT` | **smazat okamžitě**, před mazáním cache |
| `E-EXPIRE` | smazat; přechod na párovací obrazovku |
| `E-REVOKE` | smazat při prvním odmítnutí |
| Po ztrátě (`E-LOST`) | dokud není revokován, útočník s odemčeným telefonem **má přístup k serveru** v rozsahu scope. Proto je revokace první reakce na ztrátu |

> Token nesmí být v diagnostice, v exportu logu, v chybové hlášce ani ve
> screenshotu obrazovky nastavení. Ani zkrácený, ani jako otisk.

---

### MD-12 — Scope a capabilities zařízení

| Atribut | Hodnota |
|---|---|
| Zdroj pravdy | **server** — klientská kopie je jen nápověda pro UI |
| V telefonu | ano |
| Citlivost | **S1** |
| Úložiště | `ST-DB` |
| TTL | `FRESH` 1 h · `STALE` 24 h · `EXPIRED` 24 h |
| Invalidace | při každé odpovědi serveru, která scope zmiňuje |
| Offline čtení | `READ_CACHED` — jen aby UI vědělo, co skrýt |
| Offline změny | `MUT-NEVER-QUEUED` |
| `E-LOGOUT` | smazat |
| `E-EXPIRE` | smazat |
| `E-REVOKE` | smazat |
| Po ztrátě (`E-LOST`) | prozradí, co zařízení smělo |

> **Klientský scope není vynucení.** Je to nápověda, aby UI neukazovalo tlačítka,
> která skončí 403. Vynucení je vždy serverové a fail-closed (PLAN.md §2,
> pravidlo 5). Klient, který by scope vynucoval sám, je bezpečnostní iluze.

---

### MD-13 — Synchronizační kurzor

| Atribut | Hodnota |
|---|---|
| Zdroj pravdy | **server** vydává, klient uchovává poslední potvrzenou pozici |
| V telefonu | ano |
| Citlivost | **S0** (neprůhledná hodnota bez obsahu) |
| Úložiště | `ST-DB` (vedle dat, ke kterým patří) |
| TTL | žádné — kurzor nezastarává, jen se stává neplatným |
| Invalidace | odmítnutí serverem → zahodit kurzor a načíst od začátku |
| Offline čtení | neaplikuje se |
| Offline změny | `MUT-LOCAL-ONLY` — posouvá se jen po potvrzené odpovědi serveru |
| `E-LOGOUT` | smazat s daty |
| `E-EXPIRE` | ponechat — po opětovném přihlášení stejného zařízení má cenu |
| `E-REVOKE` | smazat |
| Po ztrátě (`E-LOST`) | bez ceny sám o sobě |

> Kurzor musí být neprůhledný a jeho odmítnutí musí být bezpečné: klient nikdy
> nesmí „dopočítat" chybějící úsek. Neplatný kurzor = plný refresh, ne odhad.
>
> **Stav v klientovi — aktualizováno 2026-08-12: `LOCAL_REGISTRY_CONVERGED / MOBILE_SUBSET_PASS / SHARED_VALIDATION_BLOCKED`.**
> Dřívější `MISSING_IMPLEMENTATION` už neplatí. Kurzorové stránkování (`MR-05`)
> klient má (`loadOlderMessages`, `threadWindowOf`, `THREAD_PAGE_SIZE`), takže
> pravidlo výše **má kdo dodržet** a kryjí ho `mobile-ms07-history`,
> `mobile-contract-pagination-end` a `mobile-contract-cursor-rejection`.
> Produktově `DONE` to není: sdílená validace zůstává blokovaná. Historické `WP-MOBILE-016` je
> `CHANGES_REQUIRED` a současný kandidát stále není `DONE` (PLAN.md §5.1).
> Je-li stávající kurzor u `/m1/conversations` pro tento účel použitelný,
> **nejde o změnu veřejného kontraktu** a kontraktní kolo se kvůli tomu
> neotevírá.

---

### MD-14 — Rozepsaná zpráva (draft)

**Jediný lokální originál v celém klientovi.**

| Atribut | Hodnota |
|---|---|
| Zdroj pravdy | **telefon** — a jen dokud není odeslána |
| V telefonu | ano |
| Citlivost | **S2** |
| Úložiště | `ST-DB` |
| TTL | `EXPIRED` 30 dnů bez doteku → smazat s upozorněním |
| Invalidace | odesláním, smazáním, vypršením |
| Offline čtení | `READ_CACHED` — draft je offline plně dostupný, to je jeho smysl |
| Offline změny | `MUT-LOCAL-ORIGINAL` |
| `E-LOGOUT` | **[?] `D-M3`** — návrh: smazat i drafty, s explicitním varováním v dialogu |
| `E-EXPIRE` | ponechat; po novém přihlášení je draft na místě |
| `E-REVOKE` | jako logout |
| Po ztrátě (`E-LOST`) | čitelný text, který uživatel nikdy neodeslal |

> **[F] Server má vlastní úložiště draftů** — `GET/POST/DELETE /api/drafts`
> (`src/routes/chat.js:442,455,471`). Pokud by telefon psal do něj, vzniknou
> dva zapisovatelé jedné hodnoty a s nimi slučování, které ADR 0001 odmítá.
>
> **[R] `D-M1`:** mobilní draft zůstává lokální a do `/api/drafts` se nezapisuje.
> Po reconnectu se **neodesílá automaticky** — obnoví se do editoru a čeká na
> uživatele. Automatické odeslání by porušilo I-5 a je nevratné.

---

### MD-15 — Lokální UI preference

| Atribut | Hodnota |
|---|---|
| Zdroj pravdy | **telefon** — nemají serverový protějšek |
| V telefonu | ano |
| Citlivost | **S0** |
| Úložiště | `ST-PREFS` |
| TTL | žádné |
| Invalidace | uživatelem |
| Offline čtení | `READ_CACHED` |
| Offline změny | `MUT-LOCAL-ONLY` |
| `E-LOGOUT` | ponechat — nejsou to data účtu |
| `E-EXPIRE` / `E-REVOKE` | ponechat |
| Po ztrátě (`E-LOST`) | bez ceny |

> Pozor na hranici vůči `MD-01`: téma aplikace v telefonu je lokální preference,
> téma IDE je serverové nastavení. Stejný název, jiný vlastník.

---

### MD-16 — Párovací stav

| Atribut | Hodnota |
|---|---|
| Zdroj pravdy | **server** |
| V telefonu | jen po dobu párování |
| Citlivost | **S3** |
| Úložiště | `ST-MEM` po dobu operace, výsledný token do `ST-SECURE` |
| TTL | krátká serverová expirace kódu (PLAN.md §2, negativní testy) |
| Invalidace | jednorázové použití — druhé použití je konflikt |
| Offline čtení | `READ_NONE` — párovat offline nelze |
| Offline změny | `MUT-NEVER-QUEUED` |
| `E-LOGOUT` | neaplikuje se |
| `E-EXPIRE` | zahodit, začít znovu |
| `E-REVOKE` | zahodit |
| Po ztrátě (`E-LOST`) | **nic** — kód nesmí přežít dokončené ani nedokončené párování |

---

### MD-17 — Agenti a workeři (stav, historie běhů)

| Atribut | Hodnota |
|---|---|
| Zdroj pravdy | **server** |
| V telefonu | ano — stav a shrnutí, ne výstupy běhů |
| Citlivost | **S1** stav / **S2** výstup běhu |
| Úložiště | `ST-DB` pro stav; výstupy běhů `ST-MEM` |
| TTL | `FRESH` 5 min · `STALE` 7 dnů · `EXPIRED` 7 dnů |
| Invalidace | refresh, notifikace o dokončení běhu |
| Offline čtení | `READ_CACHED` pro stav, `READ_NONE` pro výstupy |
| Offline změny | `MUT-NEVER-QUEUED` — spuštění, pozastavení i dry-run jsou příkazy |
| `E-LOGOUT` | smazat |
| `E-EXPIRE` | ponechat stav do konce TTL |
| `E-REVOKE` | smazat při zjištění |
| Po ztrátě (`E-LOST`) | čitelný seznam agentů a jejich stavů |

> **MM4-G write overlay:** `enabled` se mění jen online nad úspěšným živým
> readem a přesným `expectedEnabled`. Serverový operation fingerprint váže id,
> předchozí i cílový stav; lokální journal používá pouze obecný popis bez id a
> názvu workera. Úspěch se do UI nepřijímá optimisticky, ale ověřuje následným
> readem. Konflikt přebírá serverovou pravdu. Timeout nebo chyba po možném
> efektu je `UNKNOWN` v `MD-19`, nikdy automatický retry. Vypnutí zastavuje
> budoucí plánované běhy, ne již běžící práci. Specialisté zůstávají read-only.

> **MM4-H history overlay:** detail workera a stránky ukončených běhů jsou
> live-only `ST-MEM`, nikoli `ST-DB` cache. Projekce je omezena na S1 metadata:
> id, `success|partial|error`, start/dokončení a počty akcí/triggerů. `running`,
> log, error text, explain payload, identity triggerů a worker
> definition/state/params se neposílají. Opaque kurzor je svázaný s workerem a
> směrem do minulosti; scope/session/background invalidace detail zahodí.

> **MM4-I specialist-detail overlay:** detail specialisty je live-only
> `ST-MEM`, má HTTP `no-store` a po scope/session/background invalidaci se
> zahodí. Jedna SQLite read transakce spojuje veřejná perzistovaná metadata
> `specialists` s uspořádanými vazbami `specialist_expertises`. `status` je stav
> balíčku v databázi, nikoli důkaz živé `SpecialistRuntime` registrace.
> `manifest_json`, prompty, nástroje, filesystem/integrita, telemetry, memory a
> všechny zápisy jsou vyloučené; poškozený typ, čas, status, priorita nebo vazba
> odmítne celý detail fail-closed.

> **MM4-J configured-list overlay:** cache workerů i specialistů ukládá pouze
> validovaný `{ items, page }` snapshot. `items` musí odpovídat přesnému
> veřejnému verzovanému DTO a mít unikátní id; `page` musí mít koherentní
> `hasMore`/`end` a opaque cursor přesně jen pro pokračování. Překryv další
> stránky, skryté pole, poškozený nested worker stav nebo corrupt cache odmítne
> celý vstup bez změny posledního potvrzeného okna. Starý array-only formát je
> čitelný bez vymyšleného cursoru nebo tvrzení o konci. Neplatná worker response
> ruší `workersLive`, takže z ní nelze odemknout mutation.

---

### MD-18 — Klientský chybový a telemetrický log

| Atribut | Hodnota |
|---|---|
| Zdroj pravdy | **telefon** |
| V telefonu | ano — malý kruhový buffer |
| Citlivost | **musí být S0/S1** — a to je vynutitelné jen tím, co se do něj zapisuje |
| Úložiště | `ST-DB`, oddělený od dat |
| TTL | `EXPIRED` 7 dnů nebo strop velikosti |
| Invalidace | rotací |
| Offline čtení | `READ_CACHED` |
| Offline změny | `MUT-LOCAL-ONLY` |
| `E-LOGOUT` | smazat |
| `E-EXPIRE` / `E-REVOKE` | smazat |
| Po ztrátě (`E-LOST`) | čitelný — proto **nikdy** nesmí obsahovat S2 ani S3 |

> Chybový log je nejčastější cesta, kterou obsah unikne mimo svou třídu:
> zalogovaná odpověď serveru, hlavička s tokenem, text zprávy v hlášení výjimky.
> To je věc, kterou musí hlídat test, ne disciplína — viz rodina `MOBILE-PRIVACY`
> v testovací strategii.

---

### MD-19 — Žurnál operací (klíč operace)

**[?] `D-S1` — rozhodnuto operátorem, závazný model.**

Klient vydává pro každou **logickou mutaci** náhodný 128bitový `operationId`.
Tentýž klíč přežije všechny síťové retry téže operace; **nové vědomé provedení
dostane nový klíč.**

Je nutné oddělit dva různé záznamy. **First-party writer `journal.add` v dnešním
`app.js` zapisuje sedm polí:** `operationId`, `operationType`, `createdAt`,
`lastKnownState`, `lastCheckedAt`, `unknownReason` a obsahově prázdný
`displaySummary`; sám nezapisuje `deviceId` ani `requestFingerprint`.
`normalizeEntry` v lokálně složeném checkpointu `2a814434` (`RV-037`) vynucuje
stejný sedmipoložkový allowlist pro moderní i legacy řádky: aliasy `type` a
`state` použije jen tehdy, když odpovídající canonical pole chybí, a všechna
ostatní pole zahodí. Platný řádek má přesně sedm polí; malformovaný má nejvýše
sedm a chybějící identitu ani čas si nevymyslí. Tím je `F-113` plně source,
kompozičně a mobilním M3 během evidované jako `RESOLVED`. **Serverový
žurnál** naproti tomu váže operaci na `device_id`, ukládá otisk kanonického
požadavku a autoritativní stav `PENDING` / `CONFIRMED` / `REJECTED` / `UNKNOWN`.

| Atribut | Hodnota |
|---|---|
| Zdroj pravdy | **Klient vydává klíč, server je autoritou nad výsledkem.** Žurnál je záznam o pokusu, ne o pravdě |
| V telefonu | ano — jinak by klíč nepřežil restart aplikace, tedy právě ten případ, kvůli kterému existuje |
| Citlivost | **First-party writer je S1** — lokálně typ, časy, stav, důvod a bezobsahový popisek; serverově navíc jednosměrný otisk. Writer payload neukládá a `F-113` při každé normalizaci zahazuje všechna pole mimo přesný sedmipoložkový allowlist; source, kompozice i mobilní M3 evidence jsou uzavřené |
| Úložiště | `ST-DB`, oddělený od dat |
| TTL | `CONFIRMED`/`REJECTED` → úklid po 24 h. **`PENDING`/`UNKNOWN` se nemažou časem** — jen rozřešením nebo vědomým zahozením uživatelem |
| Invalidace | výsledkem potvrzeným serverem |
| Offline čtení | `READ_CACHED` — uživatel musí vidět, že výsledek operace zůstal neznámý |
| Offline změny | `MUT-LOCAL-ONLY` pro žurnál samotný. **Žurnál není fronta** (I-11) |
| `E-LOGOUT` | smazat — s **výslovným varováním**, existují-li `PENDING`/`UNKNOWN`: lokální klíč zmizí, ale **efekt na serveru může zůstat nerozřešený** a z telefonu už ho nepůjde dohledat |
| `E-EXPIRE` | Dnešní `app.js` lokální index ponechá, ale opětovné spárování vždy razí nový `deviceId`. Starý serverový záznam proto novým tokenem **nelze** číst ani seznamem, ani lookupem; ponechaný index je jen lokální historie/varování, ne obnovitelná serverová kontinuita |
| `E-REVOKE` | smazat s cache — **jen pokud zařízení revokaci autenticky přijme a wipe skutečně proběhne.** Viz §4.1 |
| Po ztrátě (`E-LOST`) | First-party záznam prozradí hodnoty sedmi povolených polí, zejména typy operací a jejich časy; normalizace moderních i legacy řádků extra pole zahazuje. Malformovaný řádek může mít méně polí, ne však fabrikovanou identitu nebo čas |

**Pravidla, která z klíče dělají ochranu a ne frontu:**

1. Tentýž klíč s **tímtéž otiskem** → server vrátí původní výsledek **bez nového
   efektu**.
2. Tentýž klíč s **jiným payloadem** → **fail-closed konflikt**. Jiný payload je
   jiná operace; sdílení klíče je chyba klienta, ne důvod k domýšlení.
3. **Nejasný timeout → `UNKNOWN`.** Klient v té chvíli **nesmí vyrobit nový
   klíč** — tím by z jedné operace udělal dvě. Při stále platném tokenu téhož
   zařízení se `UNKNOWN` řeší přesným `GET /m1/operations/:id`, ne čtením
   konverzace ani dalším pokusem naslepo.
4. Approvaly, bezpečnostní a administrativní operace se offline **nefrontují ani
   s klíčem**. Klíč je ochrana proti duplicitě uvnitř jednoho vědomého pokusu;
   jednorázové oprávnění approvalu neprodlužuje ani nenahrazuje (I-11, I-4).
5. Otisk se počítá z **kanonického** tvaru požadavku, aby se přeuspořádáním polí
   nedala obejít pravidla 1 a 2.

> Žurnál je jediné místo v klientovi, kde je „nevím" legitimní trvalý stav.
> Všude jinde se nejistota překlápí na refresh; tady by refresh mohl operaci
> provést podruhé.

#### 4.1 Obnova operace bez payloadu

Serverový žurnál nese otisk, ne obsah. First-party writer lokálního indexu
zapisuje sedm polí vyjmenovaných v §4.5 a žádný otisk. Source oprava `F-113`
v checkpointu `2a814434` (`RV-037`) vede každý persistence path přes uzavřenou
normalizaci: legacy alias použije jen při absenci canonical pole, extra pole
zahodí a malformovanému záznamu nefabrikuje identitu ani čas. Recovery kontrakt
se proto smí opírat právě o pojmenovaná pole; `F-113` má schválenou kompoziční i
mobilní M3 evidenci. Z toho plyne, co lze a co nelze:

1. **Stav operace se po reconnectu zjistí podle klíče** přes
   `GET /m1/operations/:id`, bez opětovného zaslání payloadu. Čtení je bezpečné,
   ale jen pro token stejného `deviceId`; po novém spárování starý klíč není
   dostupný.
2. **Ze samotného otisku nelze požadavek obnovit.** Otisk slouží k porovnání,
   ne k rekonstrukci; jednosměrnost je jeho smysl.
3. Vrátí-li server témuž zařízení, že **klíč nezná**, je retry možný **jen
   tehdy, je-li přesný
   původní kanonický požadavek stále dostupný** v odpovídajícím chráněném
   doménovém úložišti — například text zprávy jako `MD-14`. Retry pak nese
   **týž klíč**.
4. **Není-li původní požadavek dostupný, retry se nekoná.** Klient **nesmí**
   sestavit náhradní požadavek, doplnit chybějící pole ani se tvářit, že
   opakování je bezpečné. Uživateli se řekne, že obsah pokusu už není k
   dispozici, a nabídne se **vědomé nové provedení**.
5. Editovaný nebo znovu vědomě vytvořený obsah dostává **nový klíč** — jak už
   stanovuje SCREENS §5.1. Týž klíč s jiným payloadem je konflikt, ne retry.

> Tohle **není** offline fronta a nezavádí ji. Fronta by odesílala sama; zde se
> jen umožňuje, aby vědomé zopakování téhož pokusu neslo týž klíč. Payload do
> `MD-19` nepřibývá — žurnál zůstává S1.

#### 4.2 Co `E-REVOKE` doopravdy znamená

Řádek „`E-REVOKE` → smazat s cache" platí **jen za podmínky, že zařízení
revokaci autenticky přijme a lokální wipe skutečně proběhne.** To je online
případ.

Revokace ztraceného telefonu:

- **okamžitě zablokuje nový serverový přístup** — to je jediné, co je zaručené;
- **nezaručí vzdálené smazání dat** z telefonu, který je offline nebo pod
  kontrolou útočníka;
- **nesmí být v dokumentaci ani v testech vydávána za prokázaný remote wipe.**

Je to týž limit, který už drží `I-7` a `M-R1`, jen aplikovaný na žurnál:
i `MD-19` zůstane v odvolaném a nepřipojeném telefonu ležet a prozradí typy
a časy pokusů. Test, který má tento limit zamknout, je
`ML-revoke-cannot-wipe-offline`.

#### 4.3 Omezení neuzavřených záznamů

`PENDING`/`UNKNOWN` se nemažou časem (jinak by se ztrácela informace). Bez
stropu by to ale znamenalo neomezený růst a laciný storage DoS. Proto:

| Pravidlo | |
|---|---|
| **Limit současně neuzavřených operací** na zařízení/principal | strop je konečný a vynucený, ne doporučený |
| **Rate limit vzniku nových operací** | brání zaplnění stropu jedním rychlým během |
| **Fail-closed odmítnutí dalších mutací po dosažení limitu** | další mutace se **odmítne**, nikoli odloží — odložení by bylo fronta (I-11) |
| **Metrika a diagnostika** pro ruční rozřešení | uživatel i operátor musí vidět, kolik pokusů visí a které |
| **Žádné automatické mazání nejstaršího `PENDING`/`UNKNOWN`** | vytlačení nejstaršího záznamu je tichá ztráta právě té informace, kvůli které žurnál existuje — a zároveň cesta, jak si útočník vyčistí stopu |

Strop se tedy neuvolňuje mazáním, ale **rozřešením**: přečtením serverového
stavu, nebo vědomým zahozením ze strany uživatele. Dokud uživatel visící pokusy
nerozřeší, další mutace neprojdou — to je nepříjemné a je to správně, protože
alternativou je klient, který neví, co provedl.

#### 4.4 Proč je `UNKNOWN` důvod kód, a ne věta

`UNKNOWN` bez příčiny nedává uživateli nic, o čem by mohl rozhodnout. Server
proto k záznamu ukládá `unknown_reason`, `unknown_at` a `last_checked_at`.

`unknown_reason` je **kód z uzavřeného seznamu** (`src/mobile/protocol.js`),
nikdy volný text. Volný text nejde otestovat, nejde přeložit a nese na
obrazovku cokoli, co zrovna obsahoval chybový řetězec z upstreamu. Každý kód
odpovídá na jedinou otázku: **mohl efekt nastat?**

| Kód | Význam | Mohl efekt nastat |
|---|---|---|
| `upstream_timeout` | Požadavek odešel, odpověď nepřišla včas | ano |
| `upstream_unreachable` | Spojení se vůbec nenavázalo | spíš ne, jisté to není |
| `connection_lost_after_dispatch` | Spojení spadlo až po odeslání | ano, klidně celý |
| `upstream_error_status` | Backend odpověděl chybovým stavem | ano, mohl stihnout část |
| `process_terminated` | Gateway skončila, zatímco operace běžela | ano |
| `result_persistence_failed` | Efekt proběhl, zápis výsledku ne | ano, téměř jistě |
| `gateway_exception` | Výjimka uprostřed operace | neurčeno |
| `unspecified` | Server příčinu nezaznamenal | neurčeno |

Seznam je krátký záměrně: **každý kód má v kódu producenta.** Slovník s
položkou, kterou nikdo nikdy nevydá, je slib, který server nedrží. Proto v něm
zatím **není** `client_disconnected` — gateway dnes nerozliší klienta, který
zavěsil, od klienta, který čeká.

`unknown_at` je oddělené od `created_at`, protože stáří se počítá od okamžiku,
kdy se výsledek ztratil, ne od začátku pokusu. `last_checked_at` zapisuje každé
čtení stavu, aby obrazovka mohla říct „ověřeno před 2 min" místo aby budila
dojem živého stavu.

**Zbývající poctivé omezení:** `GET /m1/operations/:id` je **čtení posledního
zapsaného stavu, ne rekonciliace** s tím, co doopravdy proběhlo upstream.
Operace označená `UNKNOWN` zůstane `UNKNOWN`, i kdyby efekt dávno doběhl —
server dnes nemá jak se zpětně dotázat. Skutečné dohledání výsledku je
samostatný úkol (`MR-25`, §4.6).

#### 4.5 Klientský index klíčů operací — třetí výjimka z `I-10`

**Rozhodnuto (`U-9`).** Lokální index klíčů je vedle draftu (`MD-14`)
a preferencí (`MD-15`) **třetí věc v klientovi, jejíž ztráta uživatele
o něco připraví** — a proto výslovná výjimka z `I-10`.

Není to cache. Ztráta indexu ale není totéž co ztráta veškeré serverové
discovery: dokud zůstane platný token téhož `deviceId`,
`GET /m1/operations` znovu vypíše jeho otevřené `PENDING`/`UNKNOWN` pokusy
včetně jejich klíčů. Seznam ale nevrací rozřešenou historii, lokální
přiřazení a popisek ani původní request.

Index proto drží **lokální atribuci a krátkou historii** pokusu; doprovodný
draft drží přesný request potřebný pro bezpečný retry pod týmž klíčem.
Jejich ztráta uživatele o tyto schopnosti připraví, i když server stále
umí vypsat otevřené pokusy stejného zařízení. Ztráta device tokenu je
tvrdší hranice: nové párování razí nový `deviceId`, který starý seznam
ani jednotlivé lookupy neuvidí (§4.6).

| Pole zapisované first-party writerem | Proč tam je |
|---|---|
| `operationId` | klíč pro lookup/retry a lokální přiřazení; serverový seznam ho obnoví jen u otevřených pokusů stejného `deviceId` |
| `operationType` | co se zkoušelo |
| `createdAt` | kdy se to zkoušelo |
| `lastKnownState` | poslední stav **hlášený serverem**; je to paměť, ne pravda |
| `lastCheckedAt` | kdy byl ten stav naposledy načten |
| `unknownReason` | kód z uzavřeného seznamu výše |
| `displaySummary` | **bezobsahový** popisek, aby byl seznam čitelný |

`displaySummary` **nesmí obsahovat text zprávy.** First-party writer payload,
token, `deviceId` ani otisk requestu nezapisuje; text patří do draftu (`MD-14`)
a serverový otisk do serverového žurnálu. „Shrnutí" složené ze slov uživatele
by záznam tiše změnilo z S1 na S2 (§5.2). Source checkpoint `2a814434`
(`RV-037`) vynucuje přesný sedmipoložkový allowlist na čtení i každém následném
zápisu: canonical pole má přednost i při falsy hodnotě, známý legacy alias se
použije jen při jeho absenci a extras se zahodí. Platný záznam tak persistuje
přesně sedm polí; malformovaný nejvýše sedm a bez domyšlené identity nebo času.
`F-113` je tím `RESOLVED` v source, kompozici i mobilní M3 evidenci. Fáze přesto
není `DONE`: sdílený profil je `208/3` a produkční blokátory zůstávají otevřené.

**Pořadí zápisu je součást kontraktu, ne implementační detail:**

```
1. vytvořit operationId
2. zapsat lokální recovery záznam
3. teprve potom odeslat mutaci
```

Opačné pořadí ztrácí právě ten případ, kvůli kterému index existuje: aplikace
zemře mezi odesláním a zápisem a na serveru běží operace, kterou už telefon
neumí pojmenovat, tedy ani ověřit, ani bezpečně zopakovat.

Po terminálním výsledku se položka **nemaže hned** — zůstává jako krátká
historie a odchází až s retencí. „Jak to nakonec dopadlo" musí jít zodpovědět
i minutu poté.

**Úložiště:** `ST-DB`. Na platformě, kde je k dispozici šifrované perzistentní
úložiště, patří index do něj. **Dnešní PWA klient to nesplňuje** — `localStorage`
není šifrovaný a je čitelný ve třídě útočníka A2/A3 (§5.1). Index je S1 (typy
a časy, žádný obsah), takže to není blokátor, ale **je to evidované omezení**,
ne vyřešený bod. Nativní klient ho má povinně uložit šifrovaně.

#### 4.6 Osiřelé operace — `MR-25`, otevřený backendový úkol

**[R] Nový úkol pro backend, mimo mobilní UI.** Přeinstalace nebo nové
spárování vyrobí nový `deviceId`. Staré `PENDING`/`UNKNOWN` tím zůstanou bez
vlastníka: nikdo se k nim už nepřihlásí, `purgeResolved()` je ze zásady nemaže
a jejich počet může růst neomezeně.

**Řešení nesmí být „smazat je".** Otevřená operace může reprezentovat efekt,
který se opravdu stal a jehož výsledek jen nebyl potvrzen. Mazání by zahodilo
právě ten záznam, kvůli kterému žurnál existuje.

Model, který se tím zavádí — **vlastnictví je jiná osa než stav operace**:

| Osa | Hodnoty |
|---|---|
| `operation state` | `PENDING` / `CONFIRMED` / `REJECTED` / `UNKNOWN` |
| `ownership state` | `OWNED` / `ORPHANED` / `ADMIN_CLOSED` |

`ORPHANED` tedy **není nový terminální stav operace**. Operace zůstane
`UNKNOWN`; jen už nemá, kdo by se na ni zeptal.

K určení osiřelosti backend potřebuje u zařízení evidovat:

| Sloupec | K čemu |
|---|---|
| `last_seen_at` | dlouhodobá neaktivita |
| `revoked_at` | revokované zařízení *(dnes existuje v `api_tokens`)* |
| `replaced_by_device_id` | nové párování téhož telefonu |

Operace je **potenciálně osiřelá**, je-li ve stavu `PENDING`/`UNKNOWN`
a zařízení je revokované, nahrazené, nebo dlouhodobě neaktivní.

Desktopový operátor pak potřebuje: **zobrazit** osiřelé operace, **označit je
administrativně uzavřené**, **ponechat pro audit** a **exportovat diagnostiku**.

Rozsah `MR-25`: sloupce u zařízení, dotaz na osiřelost, `ownership state`,
desktopový pohled. **Není součástí mobilní fáze 0–1** a mobilní UI na něj
nečeká.

---

## 5. Ztráta telefonu

Nedílná součást tohoto modelu. Tabulky v §4 mají sloupec `E-LOST` právě proto,
že bez něj by cache byla navržena podle pohodlí.

### 5.1 Třídy útočníka

| # | Kdo | Co má |
|---|---|---|
| **A1** | Nálezce zamčeného telefonu | Nic z `ST-DB` ani `ST-SECURE`. Vidí notifikace na zamčené obrazovce (`MD-08`) |
| **A2** | Někdo s odemčeným telefonem — známý PIN, telefon odemčený v okamžiku ztráty | **Všechno**, co appka umí zobrazit, včetně platného tokenu, dokud není revokován |
| **A3** | Forenzní extrakce, záloha, chip-off | `ST-PREFS` a `ST-DB` v rozsahu, který ochrana klíčem neubrání; `ST-SECURE` výrazně hůř |
| **A4** | Peer na stejné VPN, bez telefonu | Nic z telefonu. Pro něj platí `G0-R032` a hranice z PLAN.md §2 |
| **A5** | Kompromitovaný nebo rootnutý OS | Vše. Mimo dosah jakéhokoli klientského opatření — uvádí se pro úplnost, ne k řešení |

### 5.2 Co konkrétně zbyde (A2, nejrealističtější případ)

| Zbyde | Nezbyde |
|---|---|
| Obsah zpráv v rozsahu okna (`MD-04`) | Approvaly (`MD-07`) |
| Uchovávané informace (`MD-06`) | Agent log (`MD-09`) |
| Titulky konverzací (`MD-03`) | Přílohy a média (`MD-05`) |
| Seznam projektů a fází (`MD-02`) | Párovací kód (`MD-16`) |
| Hodnoty mobilní podmnožiny nastavení (`MD-01`) | Výstupy běhů agentů (`MD-17`) |
| Neodeslané drafty (`MD-14`) | Cokoli mimo TTL — pokud úklid proběhl |
| Hodnoty sedmi povolených polí pokusů o operace (`MD-19`), zejména typy a časy | Payloady těch operací — first-party lokální writer je nezapisuje, normalizace extra pole zahazuje a serverový žurnál drží jen jednosměrný otisk; malformovanému legacy řádku se identita ani čas nefabrikují |
| Adresa backendu a jeho verze (`MD-10`) | |
| **Platný token do revokace** (`MD-11`) | |

### 5.3 Limit, který se musí vyslovit nahlas

> **Revokace zařízení zabrání novému přístupu. Nesmaže to, co už v telefonu je.**
>
> Server nemá nad odpojeným telefonem žádnou moc. Neexistuje „remote wipe",
> který by fungoval proti útočníkovi, který zařízení nepřipojí k síti — a ten,
> kdo cíleně krade data, ho nepřipojí.
>
> Z toho plyne jediné použitelné pravidlo: **minimalizace cache je jediná
> ochrana, která funguje po ztrátě.** Všechno ostatní jen zvyšuje cenu útoku.

### 5.4 Navrhovaná opatření — **[R]**, nic se neimplementuje

| # | Opatření | Proti komu | Poznámka |
|---|---|---|---|
| **P-1** | Minimalizovat rozsah cache (okno zpráv, žádná média, žádné approvaly) | A2, A3 | Jediné opatření účinné po ztrátě |
| **P-2** | Tvrdý úklid `EXPIRED` při startu a přechodu do pozadí | A2, A3 | Bez něj TTL nic neznamená |
| **P-3** | `ST-DB` chráněná klíčem z `ST-SECURE`, ne jen šifrováním FS | A3 | `D-M2` |
| **P-4** | Zámek aplikace (biometrie / PIN) při otevření a návratu z pozadí | **A2** | Jediné opatření proti odemčenému telefonu. `D-M4` |
| **P-5** | Při zjištěné revokaci nebo expiraci smazat cache dřív, než se zobrazí cokoli | A2 | Účinné jen když telefon je online — proto to není náhrada za P-1 |
| **P-6** | Vyloučit `ST-DB` a `ST-SECURE` ze systémových záloh | A3 | |
| **P-7** | Zakázat S2/S3 v `MD-18` a v notifikacích `MD-08` | A1, A3 | Vynucené testem, ne pravidlem |
| **P-8** | Nejmenší dostatečný scope zařízení; telefon jako čtečka + approvaly | A2 | Omezuje škodu z platného tokenu |
| **P-9** | Viditelný seznam spárovaných zařízení a explicitně potvrzené odvolání | A2 | Zkracuje okno mezi ztrátou a revokací bez záměny cílového telefonu |

### 5.5 Reziduální rizika

Značení `M-Rx`. **Nepatří do `docs/convergence/RISK-REGISTER.md`** — ten popisuje
zjištění o *současném stromu* v rámci Gate 0. Tato rizika popisují *navrhovaný*
klient. Do centrálního registru se přesouvají teprve tehdy, až budou popisovat
existující kód.

| ID | Riziko | Závažnost | Stav |
|---|---|---|---|
| **M-R1** | Revokace nesmaže existující offline cache (I-7) | P1 | **přijato jako vlastnost**, ne k opravě |
| **M-R2** | Odemčený telefon (A2) obchází veškerou ochranu úložiště | P1 | zmírňuje P-4; nelze odstranit |
| **M-R3** | Okno zpráv `MD-04` je největší jednotlivý dopad ztráty | P1 | zmírňuje P-1; rozsah je `D-M6` |
| **M-R4** | Diagnostika prozradí existenci a adresu backendu (`MD-10`) | P3 | přijato — bez toho nelze diagnostikovat |
| **M-R5** | Notifikace na zamčené obrazovce obcházejí `P-4` | P2 | zmírňuje pravidlo „ukazatel, ne obsah" u `MD-08` |
| **M-R6** | Chybový log může nechtěně pojmout S2/S3 (`MD-18`) | P2 | zmírňuje P-7 + test |
| **M-R7** | Strop neuzavřených operací (`MD-19` §4.3) po dosažení **zablokuje další mutace**, dokud uživatel visící pokusy nerozřeší | P2 | **přijatý kompromis** — alternativou je buď neomezený růst žurnálu, nebo klient, který neví, co provedl |
| **M-R8** | **Osiřelé operace rostou neomezeně.** Nové párování razí nový `deviceId`; staré `PENDING`/`UNKNOWN` tím zůstanou bez vlastníka a `purgeResolved()` je ze zásady nemaže | P3 | **OPEN** — řeší `MR-25` (§4.6). Zmírnění nesmí být automatické mazání; otevřený záznam může být efekt, který se opravdu stal |
| **M-R9** | **`UNKNOWN` se nedohledá zpětně.** Lookup čte poslední zapsaný stav, nedělá rekonciliaci s upstreamem — operace zůstane `UNKNOWN`, i kdyby efekt doběhl | P3 | **OPEN** — řeší `MR-25`. Do té doby UI ukazuje `last_checked_at` a netvrdí, že je stav živý |

---

## 6. Souhrn: co smí offline

Jedna tabulka, protože právě tohle se v návrzích nejčastěji rozjede.

| Operace | Offline |
|---|---|
| Číst cachované konverzace, zprávy, projekty, LTM, nastavení, notifikace, stav agentů | **ano**, se stářím a s viditelnou hranicí cache |
| Psát a upravovat draft | **ano** |
| Číst žurnál operací a jeho `UNKNOWN` stavy (`MD-19`) | **ano** — uživatel musí vidět, co zůstalo nerozřešené |
| Odeslat operaci s dříve vydaným klíčem po připojení | **ne automaticky** — klíč není fronta (I-11) |
| Odeslat zprávu | ne |
| Změnit nastavení | ne |
| Zapnout nebo vypnout workera | ne — `MUT-NEVER-QUEUED`, vyžaduje živý read a online legacy autoritu |
| Schválit nebo zamítnout approval | **nikdy** |
| Spustit agenta, přechod fáze, jakýkoli příkaz | **nikdy** |
| Bezpečnostní a administrativní operace | **nikdy** |
| Párovat zařízení | ne |
| Zobrazit přílohy, agent log, approvaly | ne — zobrazí se zástupný stav |

---

## 7. Otevřená rozhodnutí

| # | Otázka | Doporučení |
|---|---|---|
| **D-M1** | Automatické odeslání draftu po reconnectu; zápis do serverového `/api/drafts` | **Ne a ne.** Draft zůstává lokální, po reconnectu se jen obnoví do editoru |
| **D-M2** | Chránit `ST-DB` klíčem z `ST-SECURE`, nebo spolehnout na FS šifrování OS | Klíč z `ST-SECURE` |
| **D-M3** | Maže logout i drafty? | Ano, s explicitním varováním v dialogu |
| **D-M4** | Je zámek aplikace povinný, nebo volitelný? | Povinný ve chvíli, kdy je v cache S2 — tedy prakticky vždy |
| **D-M5** | Konkrétní hodnoty TTL v §4 | Přijmout jako výchozí, přeměřit po Fázi 1 |
| **D-M6** | Rozsah okna `MD-04` (počet zpráv × počet konverzací) | 200 × 20 jako výchozí; je to bezpečnostní parametr |
| **D-M7** | Cachovat diffy a obsah souborů? Váže na `R-4` | Ne pro 1.0 — patří do `MD-05`. **Pozn.:** pro 1.0 se diff ani nezobrazuje (`R-4` v `MD-05`), takže není co cachovat; otázka ožívá teprve s kontraktním kolem o diffu |

---

## 8. Co z modelu plyne pro budoucí API

Doménové požadavky, **ne kontrakt**. Neuvádí endpointy ani tvary — ty se
nezmrazují, dokud neplatí PLAN.md §8.

1. **Verze u každého záznamu.** Bez otisku/verze nelze splnit I-9 a stav
   „zastaralá cache" je neodvoditelný.
2. **Neprůhledný monotónní kurzor** s bezpečným odmítnutím: „tenhle kurzor
   neznám, načti od začátku". Nikdy dopočítávání na straně klienta.
3. **Rozlišitelné chybové stavy.** Klient musí umět odlišit: server nedostupný ·
   token vypršel · token revokován · chybí scope · konflikt stavu · verze
   protokolu nesouhlasí. Jeden „401" pro všechno činí obrazovkové stavy
   nesplnitelnými a nutí klienta hádat.
4. **Approval nese vlastní expiraci a vazbu na otisk payloadu**, aby platilo
   `MD-07`.
5. **Rozhodnutí o approvalu rozlišuje tři případy** — přesně podle `MD-07`
   §`R-3.1`, a všechny tři musí být na odpovědi rozpoznatelné:
   (a) **týž klíč + týž otisk** → **idempotentní odpověď**: vrátí se už
   zaznamenaný výsledek a **nevznikne druhý efekt**, a je z ní poznat, že jde
   o odpověď ze záznamu;
   (b) **týž klíč + jiný otisk** → **fail-closed konflikt**, nikdy domýšlení;
   (c) **druhé uplatnění samotného oprávnění** → **nikdy**, ani s platným
   klíčem. Idempotenci nese klíč operace z `MD-19`, ale **nenahrazuje
   jednorázové oprávnění approvalu** — obě kontroly běží a kontrolu
   jednorázovosti nelze uspokojit předložením klíče.
6. **Serverem řízené stránkování s explicitním koncem**, aby klient poznal
   hranici okna a neukazoval neúplný seznam jako úplný (I-2).
7. **Odpověď zmiňuje platný scope**, aby `MD-12` neputoval mimo realitu.
8. **Server deduplikuje podle `(deviceId, operationId)`.** Shodný klíč se
   shodným otiskem vrací původní výsledek bez nového efektu; shodný klíč s jiným
   payloadem je fail-closed konflikt (`MD-19`).
9. **Deduplikační záznam přežije celý podporovaný retry interval i restart
   serveru.** Bez toho je klíč bezcenný přesně ve chvíli, kdy je nejpotřebnější
   — po pádu nebo restartu, kdy klient nezná výsledek.
10. **Stav operace lze zjistit podle klíče bez zaslání payloadu**, a odpověď
    rozlišuje „znám a dopadlo takto" od „klíč neznám" (`MD-19` §4.1).
11. **Strop a rate limit neuzavřených operací** na zařízení/principal jsou
    vynucené serverem, ne jen klientem, a jejich dosažení je rozpoznatelné
    odmítnutí (`MD-19` §4.3).

---

*Navazuje: testovací strategie a kostra ID → mapa obrazovek a toků → coverage matice.*
