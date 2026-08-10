# IntentSmith Mobile — návrh UI

**Status:** **`LOCAL_REGISTRY_CONVERGED / MOBILE_SUBSET_PASS / SHARED_VALIDATION_BLOCKED`**; UI tím není produktově DONE
**Datum a revize:** 2026-08-01 · vstupy `RV-028`, `RV-036`, `RV-037`, reconciliation `RV-038`; Composition Review C `RV-039`/`RV-040`; registr a chráněné hodnoty `RV-042`/`RV-043`
**Stavová evidence:** 13 rout na produktovém commitu `4553b3ee`; registr `362`, `C3-031=7`, `C3-032=5`, `offline=178`, `database=33`, required ACTIVE deterministic `211`; všech 11 mobilních programů a `schema-migrations` PASS, ale celý profil skončil exit `1`, `208 PASS / 3 FAIL` kvůli `F-115` a `F-116`; žádný Gate 0 PASS, verdikt ani handoff nebyl vydán, fáze 3A je `NOT DONE`, `F-100` blokuje produkci a `GAP-2` zůstává otevřená
**Navazuje na:** [PLAN.md](PLAN.md), [SCREENS.md](SCREENS.md), [DATA-MODEL.md](DATA-MODEL.md), [ADR 0001](../adr/0001-mobile-data-ownership.md)

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
emise nevytvoří řádek `mobile_notifications`. `F-112` je otevřený **HIGH**
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
zůstává blokovaný (`F-011`, `F-014`, `F-015`, `F-111`, `F-112`).

`F-113` je `RESOLVED` v source checkpointu `2a814434` (`RV-037`), prošlo
kompozičním review a má M3 testovací evidenci: každý persistence path pro
moderní i legacy řádky prochází
uzavřenou normalizací, platný záznam má přesně sedm allowlisted polí a
malformovaný nejvýše sedm bez fabrikace identity nebo času. `F-108` je
`RESOLVED`; jeho původní branch-aware census je historický, nikoli aktuální stav. Aktuální
census je `362/7/5/178/33/211`; sdílenou validaci blokují `F-115` a `F-116`.
Vstupy zůstávají pouze lokální, bez push a main integrace; `F-100`, `F-111`,
`F-112`, `F-081`, `GAP-2`, `GAP-9`, `MR-05` a `MR-25` zůstávají otevřené.

Legenda: **[F]** ověřený fakt v tomto repu · **[R]** doporučení · **[?]** rozhodnutí operátora · **[D]** odloženo

---

## 0. Co tento dokument rozhoduje a co nerozhoduje

`SCREENS.md` říká, **co uživatel smí** a v jakých stavech. Tento dokument říká,
**jak to vypadá a jak se to ovládá** — a nic víc.

| Rozhoduje | Nerozhoduje |
|---|---|
| Navigační model a informační architektura | Nové endpointy, payloady a tvary chyb (dnešní 13-route HTTP allow-list je fakt; formální v2 se zde nerefreezuje) |
| Komponenty a jejich stavy | Které fáze se otevřou a kdy |
| Mapování chybových kódů na to, co uživatel vidí | Bezpečnostní hranici (PLAN.md §2 platí beze změny) |
| Design tokeny, typografii, ergonomii | Volbu knihoven a strukturu kódu |
| Mikrocopy v češtině | Cokoli, co by vyžadovalo bind mimo loopback |

Platí pravidlo z `SCREENS.md` §0: **obrazovka nesmí vzniknout dřív než pravidlo,
které ji dělá ověřitelnou.** Kde tento dokument navrhuje novou obrazovku
(`MS-20`), navrhuje k ní i požadavek a povinnost dodat testovací ID — viz §6.9.

---

## 1. Co backend dnes UI skutečně dovoluje

Tohle je hlavní vstup návrhu. Návrh, který ignoruje tuhle tabulku, je návrh
pro jiný produkt.

| # | Ověřený stav backendu | Důsledek pro UI |
|---|---|---|
| **B-1** | **[F]** Implementovaný/source-policy-frozen HTTP allow-list `/m1` má přesně **13 rout**: `health`, `pair/claim`, `operations`, `operations/:id`, `operations/:id/abandon`, `capabilities`, `conversations`, `conversations/:id`, `chat`, `notifications`, `notifications/ack`, `approvals`, `approvals/:id/decide` (GATEWAY.md §4). **Není to formální refreeze v2.** | UI na tomto povrchu stojí na fázích 0, 1 a approvalové části 3. **Nastavení, projekty, paměť, agenti, průběh běhu a hledání nemají vlastní routu.** `DR-008` autorizovalo jen společné kontraktní kolo; ani schválení kontraktu samo neautorizuje obrazovky |
| **B-2** | **[F]** `capabilities.features.streaming = false`, s komentářem, že `onLLMToken` nemá producenta (`src/mobile/handlers.js:84`) | **Žádný typing indicator, žádný přitékající text.** Odpověď se objeví celá, nebo není |
| **B-3** | **[F]** `POST /m1/chat` blokuje až do odpovědi upstreamu; timeout je **120 s** (`src/mobile/upstream.js:23`) | Odeslání zprávy je operace na desítky sekund, na telefonu, přes VPN, kterou OS může kdykoli uspat. Composer proto **není tlačítko, je stavový automat** — §6.4 |
| **B-4** | **[F]** Žurnál operací má stavy `PENDING`, `CONFIRMED`, `REJECTED`, `UNKNOWN`; strop **32** neuzavřených na zařízení, rate limit **60 / 60 s** (`src/mobile/operation-journal.js:41-62`) | Neuzavřené operace jsou viditelný uživatelský stav, ne interní detail. Po dosažení stropu se **mutace odmítá** — uživatel musí mít kde je rozřešit → nová obrazovka `MS-20` |
| **B-5** | **[F]** `GET /m1/operations/:id` nevyžaduje scope, nenese payload, vrací `state`, `requestFingerprint`, `result`, `errorCode` (`handlers.js:329-359`) | Přesný mechanismus ověření známého klíče. `GET /m1/operations` zvlášť zajišťuje discovery otevřených pokusů stejného zařízení; UI se po reconnectu ptá „jak dopadl tenhle pokus", ne „poslat znovu" |
| **B-6** | **[F]** 20 rozlišených chybových kódů; `retryable` je součástí odpovědi (`src/mobile/protocol.js:29-55`) | Každý kód má **právě jedno** vizuální vyústění — §7. Sloučit dva kódy do jedné hlášky znamená zahodit práci, kterou backend odvedl |
| **B-7** | **[F]** `capabilities` vrací `scopes` + `features` a obnovuje je při každém čtení (`handlers.js:66-89`) | Navigace se **odvozuje ze serveru**, nekóduje se natvrdo. Nová tabulka scopů na desktopu = jiná dolní lišta na telefonu, bez update aplikace |
| **B-8** | **[F]** Approval nese `title`, `detail`, `payloadFingerprint`, `expiresAt`, `expired`; **obsah diffu tam není** | `R-4` je uzavřené jako **popis + otisk pouze**. Diff není součástí 1.0, nesmí se zobrazovat, stahovat, exportovat ani ukládat; UI na něj nepředstírá připravenou schopnost |
| **B-9** | **[F]** Historické `392c5928` kontrolovalo neshodu otisku jen tehdy, když ho volající poslal; klientský successor `a3443de1` guard opravil a spolu s `0292cb69` dostal bounded `RV-028` `APPROVED_WITH_FOLLOWUPS`. Přesné změny jsou kompozičně schválené (`RV-039`/`RV-040`), správně registrované a mobilní M3 subset prošel; produkční approval producer/TTL autorita chybí | Tři různé konce jednoho gesta mají tři různé obrazovky. Lokální kompozice není důkaz end-to-end `R-3`: `F-100` zůstává produkční blocker a celý profil je `208/3` |
| **B-10** | **[F]** Třída, tabulka a sekvenční HTTP read/ack surface (`afterSeq`) existují, ale produkční router `MobileChannel` nekonstruuje ani neregistruje (`F-111`, child `F-014`). ACK předává jen ID, ne `deviceId`, a broadcast sdílí globální `read_at` (`F-112`, **HIGH**, child `F-011`/`F-015`); root `F-015` navíc drží sekvenční závod. `DR-003` A, `DR-012` A a `DR-013` A jsou přijaté cílové kontrakty, ale receipts, sekvenční ochrana, producer/projektor a Gate 1 důkazy chybějí. Gateway nemá WS kanál | Jde o neuzavřené **pull komponenty**, ne produkční end-to-end inbox ani push. UI nesmí naznačovat, že běžná událost dorazí, že ACK je bezpečný mezi zařízeními nebo že ticho znamená klid — §6.8 |
| **B-11** | **[F]** Konverzace i zprávy stránkují kurzorem s explicitním koncem; neznámý kurzor vrací `restart: true` (`handlers.js:97-134`) | Konec cachovaného okna je zobrazitelný přesně (`C-3`), a odmítnutý kurzor má jedinou správnou reakci: plný refresh, nikdy dopočet |
| **B-12** | **[F]** Neexistuje route pro agent log ani průběh běhu | **`MS-15` nemá čím být.** Místo falešného průběhu se navrhuje poctivé „běží, nevím jak daleko" — §6.5 |
| **B-13** | **[F]** `GET /m1/operations/:id` je **vázané na zařízení**: handler volá `lookup(principal.deviceId, …)` a SQL filtruje `WHERE device_id = ? AND operation_id = ?` (`operation-journal.js:82-88`). `deviceId` pochází z `api_tokens.device_id` (`pairing.js:277`) a **revokovaný token je odmítnut dřív, než se čte cokoli** (`pairing.js:256`) | Čtení cizí operace není možné ani s platným tokenem jiného zařízení, ani s uhádnutým ID. Odvolaný klient nepřečte nic. **UI smí lookup považovat za bezpečný** — §7 a §16 |
| **B-14** | **[F]** `operationId` **vyrábí klient**; server ověřuje jen tvar `^[A-Za-z0-9_-]{16,128}$` (`operation-journal.js:64`). Klíč je součástí `PRIMARY KEY (device_id, operation_id)` (migrace 055) | **Neuhádnutelnost klíče je závazek klienta, ne serveru.** UI musí použít systémový CSPRNG a ≥ 128 bitů. Kolize v rámci zařízení nekončí tichým sloučením, ale `OPERATION_CONFLICT` |
| **B-15** | **[F]** Každé párování razí **nový** `deviceId = dev_<uuid>` a nový token (`pairing.js:197`) | Po přeinstalaci nebo novém spárování je starý žurnál z telefonu **nedosažitelný**. Není to chyba, je to důsledek vázání na zařízení — §15 |
| ~~**B-16**~~ | **UZAVŘENO.** `GET /m1/operations` a `POST /m1/operations/:id/abandon` existují a jsou bez scope — po dosažení stropu se odmítají všechny mutace, takže scope na cestě ven by byl strop bez východu | `MS-20` je postavitelné. Opuštění vrací `effectStillUnknown`: zavírá **záznam**, ne operaci — §6.9 |
| ~~**B-17**~~ | **UZAVŘENO.** `markUnknown()` ukládá `unknown_reason` (kód z uzavřeného seznamu), `unknown_at` a lookup razítkuje `last_checked_at` (migrace 056) | „Proč je to pořád neznámé" má odpověď, kterou lze otestovat i přeložit. Uživatelskou větu skládá klient — §6.9, `DATA-MODEL.md` §4.4 |
| **B-18** | **[F]** Lookup vrací **poslední zapsaný stav**, nedělá rekonciliaci s upstreamem. Operace zůstane `UNKNOWN`, i kdyby efekt dávno doběhl | UI nesmí tvrdit, že stav je živý — ukazuje „ověřeno před N". Skutečné dohledání je `MR-25` — §6.9 |
| **B-19** | **[F]** `PENDING` záznamy po pádu procesu už nezůstávají viset: `sweepInterrupted()` je při startu gateway překlopí na `UNKNOWN` s důvodem `process_terminated` | Bez toho by řádek tvrdil „odesílám" o procesu, který neexistuje, a držel místo ve stropu navždy — §16 |

> **Nejdůležitější řádek je B-3 v kombinaci s B-2 a B-12.** Uživatel odešle
> zprávu a pak až dvě minuty nemá k dispozici žádnou informaci o postupu.
> Tohle je centrální UX problém mobilního klienta a celý §6.4 a §6.5 řeší
> jenom to, jak ho odpracovat pravdivě místo předstíráním.

---

## 2. Pět principů

Každý je odvozený z invariantu, ne z vkusu.

| # | Princip | Z čeho plyne | Co konkrétně zakazuje |
|---|---|---|---|
| **P-1** | **Pravdivost před plynulostí** | `I-2`, `C-1` | Kostru obsahu tam, kde obsah nemusí přijít. Prázdný stav bez potvrzení serverem. Plynulý přechod, který zakryje, že data jsou z cache |
| **P-2** | **Stav je vlastnost obrazovky, ne výjimka** | `SS-01`–`SS-10` | Ad-hoc chybové hlášky. Deset stavů má deset předepsaných vzhledů a každá obrazovka je dědí — §5.2 |
| **P-3** | **Mutace je operace, ne stisk** | `MD-19`, `B-4` | Tlačítko bez klíče operace. „Zkusit znovu", které vyrobí druhý efekt. Automatický retry čehokoli s vedlejším účinkem |
| **P-4** | **Zámek místo zmizení** | `C-4` | Skrývání nedostupných akcí. Výjimka: desktop-only sekce (`R-5`) na telefon nepatří vůbec |
| **P-5** | **Jedna ruka, jedno rozhodnutí** | ergonomie + `MR-16` | Rozhodovací tlačítko v dosahu palce při scrollování. Approval se schvaluje **vědomě**, ne cestou nejmenšího odporu |

---

## 3. Informační architektura

### 3.1 Navigace se odvozuje z `capabilities`

> **Přepsáno 2026-08-09** rozhodnutím `D-UI-3`
> ([UI-REVIEW-2026-08-09.md](UI-REVIEW-2026-08-09.md) §7). Původní znění mělo
> strop čtyř položek a pátou odsouvalo pod **Víc**. Strop i „Víc" jsou zrušené;
> odvození lišty z `capabilities` platí beze změny.

**[R]** Dolní lišta se **staví z odpovědi `/m1/capabilities`** (B-7), ne z konstanty
v kódu. Záložka bez scopu se nezobrazí; scope bez upstreamu se zobrazí uzamčený.

| `features` / scope | Záložka | Fáze |
|---|---|---|
| vždy, když je odemčeno | **Přehled** — kořen, §3.2 | 3 |
| `conversations` (`read:chat`) | **Konverzace** | 1 |
| `projects` (`read:projects`) | **Projekty** — `D-UI-1`, čeká na kontrakt `DR-008` domény 2 | — |
| `approvals` (`read:approvals`) | **Approvaly** ★ | 3 |
| vždy (i bez tokenu) | **Nastavení** — diagnostika, zařízení, o aplikaci | 0 |
| volitelné moduly | **až vzniknou**, viz níže | — |

Návrhy střídají popisek „Chaty" a „Konverzace"; kanonický je **Konverzace**,
shodně se `SCREENS.md` a `MS-06`.

**Volitelné moduly patří do lišty, ne pod „Víc".** Autonomní agenti,
specialisté, paměť a další moduly se při integraci zobrazí jako plnohodnotné
položky, jakmile jejich capability dorazí. Do té doby v liště nejsou vůbec —
`Připravujeme` dlaždice na `Přehledu` jim stačí.

#### Lišta je smyčka — upřesnění operátora 2026-08-10

**[F] Rozhodnuto operátorem.** Předloha
[`design/spodni-lista.png`](design/spodni-lista.png), varianta **dole (zlatá)**.
Tohle upřesňuje `D-UI-3` a **ruší dvě věci, které se do dokumentace dostaly
špatně**: strop čtyř položek i položku `Více`. Ani jedno neplatí.

| Pravidlo | Co to znamená |
|---|---|
| **Smyčka, ne řada** | 5–7 položek dokola. Za poslední jde první; lišta nikdy nenarazí na konec |
| **Lišta se nemění, jen posouvá** | Sada položek je pořád stejná. Nic nepřibývá, neubývá, nepřeskupuje se |
| **Aktivní je vždy uprostřed** | Střed je pevný rám (`brána`); položky jím projíždějí. Aktivní se nepozná barvou na místě, ale tím, že *dojela do středu* |
| **Obsah jde za lištou** | Posun lišty přepne sekci. Přechod je **vodorovné posunutí obsahu**, jako mezi plochami na telefonu |
| **Plynule, bez bliknutí** | Žádné probliknutí, žádný skeleton při přepnutí sekce, žádné načítání od nuly |
| **Bez `Více`** | Skládka se nedělá. Nastavení, Specialisté a další jsou plnohodnotné položky smyčky |

Zamýšlená sada podle předlohy: `Konverzace`, `Projekty`, `Domů`, `Aktivita`,
`Agenti` — plus `Nastavení`. Které z nich smějí vzniknout, dál řídí
`capabilities` a kontrakt: `Projekty` (`MR-14`), `Aktivita` (`MR-07`) a
`Agenti` (Fáze 5) jsou blokované, takže se zobrazí uzamčené, ne skryté.

> **Důsledek pro §3.2.** Když je `Domů` položkou smyčky, lišta se na kořeni
> **nezatahuje** — zatažení bylo součástí `D-UI-3` a s touhle předlohou nedává
> smysl. Podmínka úplnosti kořene tím ale nepadá: dokud lišta neumí smyčku,
> zůstává homescreen jedinou mapou.

**Stav implementace: NENÍ HOTOVO.** Dnešní lišta se centruje na výběr, ale
smyčku neumí a obsah se nepřesouvá, jen překreslí. Rozdíl je zapsaný, aby se
nepletl s hotovým stavem.

#### Sada položek, pořadí a zatahování — operátor 2026-08-10

**Sada smyčky:** `Domů`, `Konverzace`, `Projekty`, `Aktivita`, `Agenti`,
`Specialisté`, `Nastavení` — a další moduly, až vzniknou. `Projekty`
(`MR-14`), `Aktivita` (`MR-07`), `Agenti` a `Specialisté` (Fáze 5) nemají
kontrakt, takže se ve smyčce zobrazí **uzamčené, ne skryté**: §3.1 to žádá už
dnes a je to poctivější než lišta, která se po schválení kontraktu přeskupí.

**Pořadí si mění uživatel.** Dlouhý stisk lišty ji přepne do režimu úprav a
položky se přetahují, jako ikony na liště ve Windows nebo Ubuntu. Pořadí je
`MD-15` — lokální preference, `S0`, přežije i revokační výmaz, protože
`R5-2` vede vzhled a chování vázané na zařízení jako lokální.

**Zatahování na kořeni je volba, ne pravidlo.** Operátor chce, aby lišta při
přechodu na `Domů` plynule sjela a uvolnila místo dashboardu — je to hezčí a
homescreen tím dostane celou plochu. Zároveň to někomu vadit může, takže:

| | |
|---|---|
| Kde | `Nastavení` → `Vzhled` |
| Volba | „Skrýt lištu na domovské obrazovce" |
| Výchozí | zapnuto — efekt, kvůli kterému to vzniklo |
| Uloženo | `MD-15`, lokálně |

Podmínka úplnosti kořene (níže) tím platí **dvojnásob**: při zapnuté volbě je
homescreen opravdu jedinou mapou aplikace.

#### Čím se to postaví — a proč ne knihovnou

**[F] Posun mezi obrazovkami ani smyčku není potřeba vyvíjet ani stahovat.**
Dělá obojí `CSS scroll-snap` (`scroll-snap-type: x mandatory`), který je
v prohlížeči nativně: setrvačnost prstu, dosednutí na nejbližší položku
i plynulý posun bez jediného řádku animační logiky.

Knihovna typu Swiper by tu byla horší volba, ne lepší:

| | |
|---|---|
| Klient nemá build step | Knihovnu by bylo nutné vendorovat do `src/mobile/client/` jako další soubor k údržbě |
| CDN nepřipadá v úvahu | Gateway servíruje jen vlastní soubory a aplikace musí fungovat offline |
| Dodavatelský řetězec | Nová závislost v procesu obráceném do sítě je přesně to, čemu se `src/mobile-gateway.js` vyhýbá |
| Velikost | Celý dnešní klient je jeden soubor; typický slider je srovnatelně velký sám o sobě |

Nativní řešení navíc dá zadarmo to, co §8 žádá: respektuje
`prefers-reduced-motion` a nepotřebuje vlastní ošetření dotyku.

#### Posouvací lišta centrovaná na výběr

**[R]** Lišta je vodorovně posouvatelná a nese **všechny** dostupné položky.
Položky za okrajem vidět nejsou; lišta se vždy **vycentruje na právě zvolenou
položku a jen ta je zvýrazněná**. Přesně jeden zvýrazněný prvek, nikdy nula
a nikdy dva.

```
        ◀ posun                    posun ▶
 ┌──────────┬──────────┬═══════════┬──────────┬──────────┐
 │ Přehled  │Konverzace║ PROJEKTY  ║Approvaly │Nastavení │
 └──────────┴──────────┴═══════════┴──────────┴──────────┘
                        ▲ vycentrovaná a zvýrazněná
```

Mentální model je **brána ze Stargate**: prstenec se otáčí tak, aby zvolený
symbol dojel doprostřed, a svítí právě jeden. Uživatel nehledá položku na pevné
souřadnici — čte střed.

**Co se tím vědomě ztrácí:** lišta přestává být úplná mapa vidět naráz. Za to
odpadá „Víc" jako skládka a lišta unese proměnnou sadu z `capabilities`, u níž
pevná mapa stejně nikdy plně nevznikne — sada se liší podle scopů a verze
klienta (§3.4).

**[R]** Při jediné dostupné položce se lišta nezobrazuje vůbec. Lišta se dvěma
položkami, z nichž jedna je „Nastavení", je horší než žádná.

### 3.2 Kde je domovská obrazovka

> **Přepsáno 2026-08-09** rozhodnutím `D-UI-3`. Původní znění vedlo jako
> výchozí obrazovku seznam konverzací a `Přehled` odkládalo.

**[R] Fáze 0–1 domovskou obrazovku nemá.** Bez tokenu aplikace startuje na
`MS-01`/`MS-02`; agregační přehled bez approvalů a bez projektů by agregoval
jednu věc.

**Od fáze 3 je `Přehled` kořen aplikace**, protože teprve tam má co říct:
čekající approvaly (živě, necachovaně — `MS-13`), `RunSilence` podle §6.5
(`D-UI-4`) a poslední konverzace.

#### Lišta je na kořeni zatažená

**[R]** Na `Přehledu` **lišta není vidět**. Vstup do kterékoli sekce ji plynule
vysune zdola; volba `Přehled` ji zase zasune.

Zasunutí je proto **signál „jsi doma"**, ne ztráta navigace. Na `Přehledu` by
lišta duplikovala dlaždice, které vedou na totéž.

Dlaždice a lišta se nedublují, protože mají **jinou zrnitost**: dlaždice vedou
hluboko (konkrétní projekt, konkrétní approval), lišta přepíná sekci.

**Vycentrovaná položka po vysunutí je ta, kterou uživatel zvolil na
`Přehledu`.** Žádná „výchozí vycentrovaná položka" před první volbou neexistuje
— na kořeni je lišta zatažená, takže není co centrovat.

#### Rozložení kořene — podle předlohy operátora

**[F] Rozhodnuto 2026-08-10.** Rozložení `Přehledu` se řídí předlohou
[`design/homescreen-1_schvaleni-3.png`](design/homescreen-1_schvaleni-3.png):
dlaždice **nahoře pod hlavičkou**, pod nimi co čeká, pak nedávné konverzace
s odkazem `Zobrazit všechny`. `Nastavení` je **ozubené kolo v hlavičce**, ne
dlaždice — druhá cesta na totéž místo na jedné obrazovce je duplicita, ne mapa.

Tři vědomé odchylky od předlohy, každá proto, že pod ní není datový zdroj nebo
ji operátor zamítl:

| Předloha | Zde | Proč |
|---|---|---|
| Pozdrav „Ahoj, Jano 👋" | není | Rozhodnutí operátora 2026-08-10 |
| `3 agenti běží`, `8 aktivních projektů` | není | `MR-07` a `MR-14` jsou `BLOCKED_BY_CONTRACT`; číslo bez zdroje je přesně to, co §2 zakazuje |
| Lišta stále viditelná, pevná, s `Více` | posouvací, na kořeni zatažená | `D-UI-3`; **předloha a `D-UI-3` popisují dvě různé lišty a rozpor je otevřený** — viz §3.1 |

Dřívější sekce `Kam dál` s navigační mřížkou dole je **zrušená**: byla to kopie
lišty, kterou §3.2 zakazuje, a vykreslovala se do dvou mřížek, takže rozpadala
řádky. Pokrytí sekcí podle podmínky níže obstarávají horní dlaždice.

#### Podmínka úplnosti kořene

> **Kořen musí pokrýt každou položku lišty.** Když je lišta na `Přehledu`
> zatažená, je homescreen **jedinou mapou aplikace**. Každá položka lišty proto
> musí mít na `Přehledu` dlaždici nebo řádek.

Nová položka v liště a nová dlaždice na `Přehledu` vznikají **zároveň, jedním
krokem**. Sekce, kterou dlaždice nepokrývá, je z kořene nedosažitelná — a
protože lišta je tam schovaná, uživatel se o její existenci nedozví vůbec.

Platí to i pro volitelné moduly: zapnutí modulu přidává obojí, ne jen položku.

### 3.3 Navigační kostra po doplnění

```
  start ──▶ MS-01 odemčení ──┬─(bez tokenu)──▶ MS-02 párování
                             │
                             └─(s tokenem)───▶ PŘEHLED  [kořen, §3.2]
                                                  │        lišta zatažená
   ┌──────────────┬─────────────────┬─────────────┴──────┬─────────────────┐
   ▼              ▼                 ▼                    ▼                 ▼
 MS-06         MS-13 fronta ★   MS-05 zprávy      MS-03 stav        MS-20 pokusy
 konverzace      │              (F-111/F-112)     pod Nastavením     (nové, §6.9)
   │             ▼                                     │
   ▼           MS-14 rozhodnutí ★                MS-04 zařízení
 MS-07 detail                                          projekty ▶ D-UI-1
   │                                                   (čeká na DR-008)
   ▼
 MS-08 odeslání          po vstupu do sekce lišta vyjede a vycentruje ji
 MS-09 hledání           (BLOCKED_BY_CONTRACT, nestaví se)
```

`MS-20` je dosažitelné **odkudkoli, kde se mutace odmítne** kvůli stropu (B-4),
a trvale z `Nastavení`.

**[R]** `MS-03` stav, `MS-04` zařízení a `MS-20` pokusy žijí pod položkou
**Nastavení**; ta nahrazuje dřívější samostatnou položku „Stav" (`D-UI-3`).

### 3.4 Mapovací vrstva — capability není obrazovka

Přímé pravidlo „capability `X` → záložka `X`" by svázalo navigaci s názvy
scopů a rozbilo se při první capability, která obrazovku nemá. Mezi server
a lištu proto patří čtyři kroky:

```
  serverová capability        (co server hlásí — scopes + features, B-7)
        ▼
  podporovaná capability      (co tahle verze klienta zná; ostatní ignoruje)
        ▼
  feature policy              (co z toho je v této fázi zapnuté; víc capability
        ▼                      může spadat pod jednu položku a naopak)
  navigační položka           (co uživatel uvidí)
```

Co tím vzniká:

| Případ | Chování |
|---|---|
| Neznámá budoucí capability | **Klient ji ignoruje, zapíše do diagnostiky (`MS-03`) a nespadne.** Nikdy nevykreslí položku, kterou neumí obsloužit |
| Capability bez vlastní obrazovky (`read:capabilities`) | Nemá navigační položku; ovlivňuje jen obsah `MS-03` |
| Víc capability pod jednou položkou | `read:chat` + `write:chat` → jedna záložka **Konverzace**, uvnitř různě uzamčené prvky |
| Capability jen pro jednu akci | Ovlivní tlačítko, ne navigaci (`LockedRow`) |
| „Server umí" × „uživatel smí" | `features.chat` je konjunkce scopu **a** dostupnosti upstreamu (`handlers.js:77`). Navigace se řídí **scopem** (položka existuje), aktivnost prvků **feature flagem** (jde to teď použít) |

Poslední řádek je důvod, proč se tyhle dvě věci nesmí slít: záložka, která
zmizí, protože model zrovna neběží, vypadá jako ztráta oprávnění.

---

## 4. Trust bar — komponenta, na které stojí celý návrh

Tři nejnebezpečnější záměny (`SCREENS.md` §2.1) mají společnou příčinu: stav
spojení, stáří dat a rozsah oprávnění se v běžných aplikacích zobrazují
nahodile. **Řešení je jedna komponenta na jednom místě, kterou dědí každá
obrazovka**, takže „zapomněl jsem ukázat, že je to z cache" není možný stav kódu.

```
┌─────────────────────────────────────────────────────┐
│  [zóna 1: spojení]   [zóna 2: stáří]   [zóna 3: 🔒] │  ← 32 dp, pod hlavičkou
└─────────────────────────────────────────────────────┘
```

| Zóna | Co ukazuje | Kdy je prázdná |
|---|---|---|
| 1 — spojení | `online` · `bez sítě` · `server neodpovídá` · `token vypršel` · `zařízení odvoláno` | při `online` je zóna prázdná, ne „✓ online" |
| 2 — stáří | `data z 14:02` u `STALE`; nic u `FRESH` | u `FRESH` vždy |
| 3 — oprávnění | zámek, když je na obrazovce něco uzamčené scopem | když je vše dostupné |

**Pravidla:**

1. Trust bar je **vždy na stejném místě** a nikdy nepřekrývá obsah — posouvá ho.
2. Prázdný trust bar znamená „čerstvá data, online, plný přístup". To je jediný
   stav, kdy nic neříká.
3. **Nikdy dvě pravdy.** Je-li zařízení odvolané, zóna 1 hlásí odvolání a
   zóna 2 mlčí — cache už se stejně maže (`C-7`).
4. Barva nikdy nenese význam sama: každý stav má **text i tvar** (§10).

### 4.1 Tři úrovně naléhavosti

Trvale rozbalený stavový pruh by z každé obrazovky udělal diagnostickou konzoli.
Komponenta má proto tři podoby a **běžný stav je téměř neviditelný**.

| Úroveň | Kdy | Provedení |
|---|---|---|
| **Nenápadná** | online + `FRESH` + plný přístup | Pruh se nevykresluje vůbec; nula výšky |
| **Nenápadná s obsahem** | `STALE`, omezený scope, pull kanál neaktivní | Jeden řádek 24 dp, malé písmo, klepnutím se rozbalí detail se zdroji (§4.2) |
| **Rozbalená** | offline, server mlčí, protokol se rozešel | Dva až tři řádky s příčinou a odkazem na `MS-03` |
| **Blokující plocha** | **jen** revokace zařízení a `EXPIRED` cache | Přes celou obrazovku — v obou případech se stejně nesmí nic zobrazit (`SS-06`, `C-7`) |

Blokující varianta má právě dva spouštěče. Cokoli dalšího, co by chtělo
zabrat celou obrazovku, patří do `StateBlock` uvnitř obsahu, ne do trust baru.

### 4.2 Zdroje stavů

Pruh nesmí odhadovat. Každý stav má pojmenovaný zdroj a vlastní stáří.

| Stav | Zdroj | Ověřeno |
|---|---|---|
| Síť v telefonu | systémové API konektivity | mimo backend |
| Dosažitelnost gateway | poslední odpověď na `GET /m1/health` | **[F]** `handlers.js:48-61` |
| Dosažitelnost backendu | `health.upstream` + `upstreamDetail` | **[F]** tamtéž — gateway může být nahoře a mozek dole |
| Platnost tokenu | poslední odpověď: `TOKEN_EXPIRED` × `TOKEN_REVOKED` | **[F]** `pairing.js:253-263` |
| Rozsah oprávnění | `capabilities.scopes` z posledního čtení | **[F]** `handlers.js:75` |
| Identita protějšku | `capabilities.device` + `protocolVersion` | **[F]** `handlers.js:71-72` |
| Stáří posledního ověření | čas posledního úspěšného `health` / `capabilities` | klient |
| Serverový čas | `health.time` → offset proti lokálním hodinám | **[F]** `handlers.js:59`, viz §14 |

**Pravidlo:** stáří se počítá od posledního **úspěšného** volání, ne od
posledního pokusu. Neúspěšný pokus mění zónu 1, nikdy nenuluje zónu 2.

---

## 5. Komponenty

### 5.1 Inventář

| Komponenta | Účel | Klíčové stavy |
|---|---|---|
| `TrustBar` | §4 | 5 × spojení × 2 stáří × 2 zámek |
| `FreshnessChip` | stáří u jednotlivé položky, kde se liší od hlavičky | `FRESH` (neviditelný) / `STALE` |
| `StateBlock` | **pět vizuálně odlišných** prázdných ploch | prázdno · bez sítě · server neodpovídá · cache vypršela · bez oprávnění |
| `LockedRow` | uzamčený prvek + důvod + kde se to mění | zamčeno scopem / zamčeno `STALE` daty / zamčeno offline |
| `OperationButton` | jediné povolené mutační tlačítko | klidový · drží klíč · `PENDING` · `UNKNOWN` · `CONFIRMED` · `REJECTED` |
| `EndOfWindowRow` | konec cachovaného okna (`C-3`, B-11) | „starší vyžadují připojení" / „to je vše" |
| `ApprovalCard` | položka fronty | čeká · vyprší za `<t>` · vypršelo · rozhodnuto jinde |
| `DecisionSheet` | rozhodnutí ★ | §6.6 |
| `FingerprintRow` | otisk payloadu, o kterém se rozhoduje | shodný · změněný (blokuje) |
| `RunSilence` | poctivá indikace běhu bez událostí (B-12) | čeká · dlouho čeká · přerušeno |
| `DraftBar` | lokální originál (`MD-14`) | uložen · obnoven · neodesílá se sám |
| `SkeletonList` | `SS-01` nad prázdnem | — |
| `NotificationRow` | ukazatel, ne obsah (`MD-08`) | nepřečteno · potvrzeno |
| `DeviceRow` | `MS-04` | toto zařízení · jiné · odvolané |

### 5.2 `StateBlock` — pět ploch, které se nesmí podobat

Tohle je `C-1` převedená do vzhledu. Pět různých ikon, pět různých textů, pět
různých akcí. Žádné dvě nesdílejí ilustraci ani formulaci.

| Stav | Ikona | Nadpis | Akce |
|---|---|---|---|
| `SS-02` prázdno | prázdný rámeček | „Zatím žádné konverzace" | vytvořit / nic |
| `SS-03` bez sítě | přeškrtnutá síť | „Nejsi připojený" | zkusit znovu · co je v cache |
| `SS-08` server mlčí | server s vykřičníkem | „Server neodpovídá" | **diagnostika** (`MS-03`) |
| cache `EXPIRED` | přesýpací hodiny | „Offline, data vypršela" | připojit se |
| `SS-07` bez scope | zámek | „Toto zařízení na to nemá oprávnění" | vysvětlení, kde se mění (desktop) |

### 5.3 `OperationButton` — mutace jako stavový automat

`MD-19` §5.1 v podobě jedné komponenty. Žádné mutační tlačítko v aplikaci
nesmí být obyčejný `Button`.

```
  klid ──stisk──▶ drží klíč ──odesláno──▶ PENDING ──┬─▶ CONFIRMED  „hotovo"
    ▲                                               ├─▶ REJECTED   „odmítnuto: <důvod>"
    │                                               └─▶ UNKNOWN    „výsledek neznámý"
    │                                                       │
    └──────── uživatel vědomě začne znovu ◀── nový klíč ◀───┘
                                              (nikdy automaticky)
```

| Stav | Vzhled | Co smí uživatel |
|---|---|---|
| klid | plné tlačítko | stisknout |
| drží klíč | tlačítko neaktivní, průběh | nic (klíč vzniká) |
| `PENDING` | průběh + „odesláno, čeká se" | odejít z obrazovky — operace tím nezaniká |
| `CONFIRMED` | výsledek | pokračovat |
| `REJECTED` | důvod z `errorCode` | **vědomě** zopakovat = nový klíč |
| `UNKNOWN` | „výsledek neznámý" + **„zjistit stav"** | přesně `GET /m1/operations/:id` (B-5). **Tlačítko „poslat znovu" tu není** |

> Rozdíl mezi `REJECTED` a `UNKNOWN` je celý rozdíl mezi bezpečným a
> nebezpečným klientem. `REJECTED` se smí nabídnout zopakovat, protože se
> prokazatelně nic nestalo. `UNKNOWN` se **čte**, nikdy neopakuje.

---

## 6. Blueprinty obrazovek

Vlnovka `~` značí místo, kde se text mění podle dat.

### 6.1 `MS-02` — párování

Uživatel drží dvě zařízení. Průběh proto musí být krokový, ne neurčitý (`SS-01`).

```
┌───────────────────────────────┐
│  Spárovat s IntentSmithem     │
│                               │
│   ┌─────────────────────┐     │
│   │   [ hledáček QR ]   │     │
│   └─────────────────────┘     │
│   Na desktopu: Nastavení →    │
│   Zařízení → Spárovat telefon │
│                               │
│   ① kód načten                │  ← kroky, ne spinner
│   ② ověřuje se na serveru…    │
│   ③ ukládá se do telefonu     │
│                               │
│   [ Zadat kód ručně ]         │  ← záložní cesta, ne primární
└───────────────────────────────┘
```

Po dokončení obrazovka **ukáže scope, který server skutečně dal** (`SS-07`
u `MS-02`), formulací „toto zařízení smí: číst konverzace, psát zprávy".
Nikdy nežádá víc. Kód mizí z paměti i z obrazovky (`MD-16`).

Chyby mají tři různé konce: `PAIRING_ALREADY_USED` → „kód už byl použit, vygeneruj
nový", `PAIRING_EXPIRED` → „kód vypršel", `PAIRING_DISABLED` → „párování je na
serveru vypnuté" **bez** nabídky, jak to obejít.

### 6.2 `MS-03` — stav a diagnostika

Jediná obrazovka funkční i s neplatným tokenem. Odpovídá na „čí je to problém",
a proto je to **řetěz**, ne seznam.

```
┌───────────────────────────────┐
│  Stav spojení                 │
│                               │
│  Síť v telefonu       ✓       │
│  VPN                  ✓       │
│  Gateway              ✓  m1.… │  ← protocolVersion (B-6: PROTOCOL_MISMATCH)
│  Backend              ✗       │  ← health.upstream = unreachable
│    └ důvod: ~upstreamDetail~  │
│  Model                —       │  ← nezjišťuje se, když backend mlčí
│                               │
│  Toto zařízení                │
│  Oprávnění: číst konverzace,  │
│             psát zprávy       │
│  Platnost do: ~datum~         │
│                               │
│  [ Zkusit znovu ]             │
└───────────────────────────────┘
```

Řetěz se **přerušuje na prvním ✗** a další řádky jsou `—`, ne ✗. Zbytečné
křížky by rozmělnily jedinou informaci, kterou obrazovka nese.

Token se nezobrazí nikdy, ani zkrácený, ani jako otisk (`C-9`).

### 6.3 `MS-06` / `MS-07` — konverzace

```
┌───────────────────────────────┐
│  Konverzace           [hledat]│
│  data z 14:02                 │  ← TrustBar, zóna 2 (STALE)
├───────────────────────────────┤
│  ~Název~                      │
│  ~úryvek~            ~12:40~  │
├───────────────────────────────┤
│  ~Název~                      │
│  ~úryvek~            ~9:15~   │
├───────────────────────────────┤
│  ── starší konverzace jsou    │  ← EndOfWindowRow (C-3, B-11)
│     dostupné po připojení ──  │
└───────────────────────────────┘
```

V detailu platí totéž na horním okraji zpráv. Odmítnutý kurzor (`CURSOR_UNKNOWN`,
`restart: true`) vede na **plný refresh s viditelným vysvětlením**, ne na tiché
dotažení chybějícího úseku.

### 6.4 `MS-08` — odeslání, hlavní UX problém (B-3)

Uživatel čeká až 120 s bez jakékoli zpětné vazby z modelu. Návrh to řeší tím,
že **čekání přizná a udělá ho opustitelným**.

```
  ┌──────────────────────────────┐   ┌──────────────────────────────┐
  │ ~poslední zpráva~            │   │ ~poslední zpráva~            │
  │                              │   │                              │
  │ ┌──────────────────────────┐ │   │ ┌──────────────────────────┐ │
  │ │ ty: ~text~               │ │   │ │ ty: ~text~               │ │
  │ └──────────────────────────┘ │   │ └──────────────────────────┘ │
  │                              │   │  ⟳ odesláno, čeká se na      │
  │ [ napiš zprávu…      ] [ ▶ ] │   │    odpověď · 0:38            │
  └──────────────────────────────┘   │    Můžeš odejít. Stav zjistíš│
         klid                        │    GET /m1/operations/:id.  │
                                     └──────────────────────────────┘
                                            PENDING
```

#### Pět pojmenovaných stavů čekání

Uživateli se nikdy neukazuje číslo, které nemá krytí. **Žádné „70 % hotovo".**
Rozlišují se právě tyto stavy a každý má jinou větu i jiné dostupné akce:

| # | Stav | Co se stalo | Co uživatel vidí | Akce |
|---|---|---|---|---|
| **W-1** | Příkaz přijat | Klíč vydán, požadavek odeslán | „Odesláno" | žádná |
| **W-2** | Čeká na zpracování | Server drží `PENDING` (B-4) | „Čeká se na odpověď · 0:38" | odejít |
| **W-3** | Zpracovává se / stav není znám | Spojení padlo nebo app byla uspána, žurnál drží `PENDING`/`UNKNOWN` | „Nevím, jak to dopadlo" | **Zjistit stav = `GET /m1/operations/:id`** |
| **W-4** | Dokončeno | `GET /m1/operations/:id` vrátil `CONFIRMED` + výsledek | potvrzený výsledek operace; bez příslibu, že se objeví v konverzaci | pokračovat |
| **W-5** | Výsledek nelze momentálně ověřit | Lookup sám selhal (offline, server mlčí) | „Ověření teď nejde, pokus zůstává otevřený" | zkusit ověřit později · `MS-20` |

`W-3` a `W-5` se běžně slévají do „něco se pokazilo" — a je to chyba: v `W-3`
je odpověď na dosah jedním čtením, v `W-5` není dosažitelná vůbec.

#### Co drží kontinuitu dnes

**[F]** Opakované odeslání **s týmž klíčem** vrátí `202` a stav bez druhého
efektu (`handlers.js:249-257`). To je použitelné hned: po probuzení aplikace
se buď čte `GET /m1/operations/:id` (B-5), nebo se pošle týž požadavek s týmž
klíčem — obojí je bezpečné a obojí odpoví `PENDING` / `CONFIRMED`.

| Situace | Chování |
|---|---|
| Čekání > 20 s | Doplní se věta „Model běží lokálně, delší odpovědi jsou normální." **Ne** změna průběhu na neurčitý |
| Uživatel odejde | Operace běží dál; návrat ukáže výsledek nebo `UNKNOWN` podle žurnálu (B-5) |
| App uspána OS | Po probuzení se **nejdřív čte** `GET /m1/operations/:id`, teprve pak se cokoli zobrazí (§12) |
| `UNKNOWN` | `W-3`. **[ Zjistit stav ] = `GET /m1/operations/:id`**, nikdy „poslat znovu"; lookup může znovu vrátit `UNKNOWN` |
| Offline | Psát ano, odeslat ne. `DraftBar`: „Uloženo v telefonu. Neodešle se samo." (`I-5`) |
| Editace textu po chybě | **Nový klíč** — a je to správně, protože jde o jinou zprávu (`MD-19`) |

#### [R] Do další fáze: `202` místo dvou minut

Blokující `POST /m1/chat` (B-3) je přijatelný pro první verzi, ne dál. Telefon
nemá držet HTTP request 120 s přes síť, která se mezitím přepne z Wi-Fi na LTE.

Cílový tvar: **chat vytvoří operaci a okamžitě vrátí `202` s `operationId`**;
klient stav dotahuje. Ze čtyř možností — asynchronní `202`, SSE, WebSocket,
dlouhý polling — je `202` + existující `GET /m1/operations/:id` nejlevnější,
protože **žurnál i lookup už existují** a UI z §5.3 se nemění ani o řádek.
SSE a WS jsou samostatná infrastruktura a řeší průběh (B-12), ne latenci.

Patří do roadmapy jako backendový úkol, ne do tohoto dokumentu.

### 6.5 `RunSilence` — náhrada za neexistující průběh (B-12)

Dokud `/m1` nemá plochu pro agent log, `MS-15` v UI **není obrazovka, ale pruh**.
Poctivá varianta zní: víme, že běží; nevíme, kde je.

```
┌───────────────────────────────┐
│  ⟳ Běží · 1:12                │
│  Průběh běhu není z telefonu  │
│  dostupný. Ticho neznamená    │
│  zamrznutí.                   │
└───────────────────────────────┘
```

Obě tlačítka „Zjistit stav" provádějí výhradně
`GET /m1/operations/:id`. Lookup smí vrátit znovu `UNKNOWN`; UI neslibuje, že
se výsledek objeví v konverzaci, poznámkách ani ve stavu běhu.

Až plocha vznikne, pruh se rozbalí do `MS-15` beze změny okolních obrazovek.
Falešný „progress" se nedoplňuje ani dočasně.

### 6.6 `MS-13` / `MS-14` — approvaly ★

Nejcennější a nejnebezpečnější tok. Vizuál pro něj má **jediný úkol**: udělat
rozhodnutí vědomým a znemožnit rozhodnutí nad zastaralými daty.

**Implementační stav:** historické `392c5928` mělo autorské sady zelené,
ale `RV-023`–`RV-025` vrátila `CHANGES_REQUIRED`. Opravený klient
`a3443de1` a disjunktní cache/gateway `0292cb69` dostaly v bounded Review B
`RV-028` `APPROVED_WITH_FOLLOWUPS`; jejich přesné změny jsou lokálně složené,
reconciliation prošla `RV-038`, kompozice `RV-039`/`RV-040`, registr
`RV-042`/`RV-043` a mobilní M3 subset. Celý profil je `208/3`, historický
`PC-010` nebyl proveden a fáze 3A je `NOT DONE`.
Následující blueprint je cílový design, ne potvrzení implementace.

**Hranice `R-3`:** podle `DR-011` jde o přijatý cílový kontrakt. Chybějící
produkční producent approvalů, 5/15minutová TTL autorita, povinný otisk a
autoritativní vazba na run/operaci/normalizovaný obsah jsou `F-100`; nelze je
uzavřít úpravou UI ani dokumentace.

**Fronta (`MS-13`)** se nikdy nezobrazuje z cache. Offline není prázdný seznam,
ale plná plocha `StateBlock`: *„Bez připojení nelze zobrazit, co čeká."*
Prázdná fronta má vlastní, uklidňující formulaci: *„Nic nečeká."*

**Rozhodnutí (`MS-14`)**:

```
┌───────────────────────────────┐
│  ← Approval                   │
│                               │
│  ~title~                      │
│  ~subjectType~ · ~subjectId~  │
│                               │
│  ~detail~                     │
│                               │
│  Diff není součástí verze 1.0 │  ← B-8: uzavřené R-4, popis + otisk pouze
│  telefonu dostupný.           │
│                               │
│  Otisk: ~a1b2c3…~             │  ← FingerprintRow
│  Vyprší za: 4:12              │  ← odpočet, ne čas
│                               │
│  ┌─────────────┐ ┌──────────┐ │
│  │  Zamítnout  │ │ Schválit │ │  ← v dosahu palce, oddělené
│  └─────────────┘ └──────────┘ │
└───────────────────────────────┘
```

| Pravidlo | Vizuální provedení |
|---|---|
| Rozhoduje se jen o načteném stavu | Tlačítka jsou **neaktivní, dokud nedorazí celý payload a otisk** (`SS-01`) |
| Vázanost na otisk | Změna otisku během zobrazení → obrazovka se **přepne na „zadání se změnilo"**, rozhodnutí zahodí a načte znovu |
| Vědomé gesto | **[R]** Schválení potvrzuje druhý krok (`DecisionSheet` se shrnutím), zamítnutí ne. Nesouměrnost je záměr: schválení je nevratné směrem k akci |
| Fail-closed bez scope | Náhled ano, tlačítka pryč a nahrazená `LockedRow`, ne šedivá tlačítka |
| Odpočet | Pod 60 s zčervená. **Tlačítka zůstávají aktivní, dokud approval skutečně nevyprší** — viz níže |

#### Expiraci rozhoduje server, ne hodiny telefonu — `U-3` rozhodnuto

Pevná hranice („pod 15 s se nedá rozhodnout") je příliš hrubá: znemožnila by
rozhodnutí, které by server ještě platně přijal, a při rozejitých hodinách by
tlačítka zhasla předčasně nebo naopak pozdě.

| Pravidlo | Provedení |
|---|---|
| Odpočet je **informace**, ne autorita | Renderuje se z `expiresAt` korigovaného offsetem serverového času (§14) a je zjevně přibližný |
| Autorita je serverový příznak | **[F]** `approvals` vrací `expired` počítané na serveru (`handlers.js:451`) a `decide` vrací `APPROVAL_EXPIRED` (`handlers.js:518-521`). **Deaktivuje se podle nich, ne podle odpočtu** |
| Ochrana proti dvojímu klepnutí | Po prvním stisku je tlačítko neaktivní, dokud operace nedoběhne (`OperationButton`, §5.3) — to je celá potřebná ochrana v posledních sekundách |
| Neznámý offset | Není-li čerstvý serverový čas, ukáže se **„vyprší brzy"** bez čísel; tlačítka zůstávají aktivní |
| `TOKEN_EXPIRED` při odesílání rozhodnutí | Přihlásit znovu a **načíst approval znovu**. Původní operace se neopakuje naslepo — payload i platnost se mezitím mohly změnit |

Tři různé konce jednoho gesta (B-9), tři různé obrazovky:

| Kód | Co uživatel vidí | Co může udělat |
|---|---|---|
| `APPROVAL_SUPERSEDED` | „Zadání se mezitím změnilo. Tvoje rozhodnutí se nepoužilo." | přečíst nové a rozhodnout znovu |
| `STATE_CONFLICT` | „Rozhodl už někdo jiný: ~decision~." | zpět na frontu |
| `APPROVAL_EXPIRED` | „Platnost vypršela dřív, než rozhodnutí dorazilo." | zpět na frontu |

### 6.7 `MS-04` — zařízení

Obrazovka musí **nahlas říct, co odvolání nedokáže** (`I-7`):

> Odvolání zabrání dalšímu přístupu. **Data, která už v tom telefonu jsou,
> nesmaže** — na odpojený telefon server nedosáhne.

Odvolání sebe sama je oddělené a varuje, existují-li neuzavřené operace (B-4):
klíč zmizí, ale efekt na serveru může zůstat nerozřešený.

### 6.8 `MS-05` — zprávy

Notifikace nese **ukazatel, ne obsah** (`MD-08`) — objevuje se na zamčené
obrazovce, kde neplatí zámek aplikace. „Čeká approval pro ~projekt~", nikdy text.

Protože současná HTTP surface umí jen pull existujících řádků (B-10), hlavička
nese **čas posledního načtení** a historie z cache je označená jako z definice
neúplná. Nejde o tvrzení, že produkční pipeline řádky vytváří.

Tento návrh lze zatím ověřovat jen nad seedovanými nebo přímo zapsanými řádky.
Běžná produkční pipeline mobilní řádek nevytvoří (`F-111`, child root `F-014`)
a ACK/badge nelze považovat za device-scoped autoritu (`F-112`, child root
`F-011`/`F-015`); `F-015` navíc drží samostatný sekvenční závod. `PRODUCT_OWNER`
přijal `DR-003` A, `DR-012` A a `DR-013` A, ale append-only lifecycle,
per-device receipts, policy-controlled S1-safe mirror, producer/projektor a
Gate 1 důkazy nejsou implementované. Obrazovka proto není důkazem hotového
produkčního inboxu.

### 6.9 `MS-20` — nerozřešené pokusy: **recovery mechanismus**, `U-1` schváleno

Backend má strop 32 neuzavřených operací a po jeho dosažení **odmítá mutace**
(B-4, `C-12`). `PENDING` a `UNKNOWN` navíc **nikdy nezanikají časem** — **[F]**
`purgeResolved()` maže výhradně `CONFIRMED` a `REJECTED` (`operation-journal.js:274-285`).
Strop je tedy jednosměrná rohatka: bez cesty ven se aplikace dostane do stavu,
ze kterého se sama nedostane. `MS-20` proto není seznam, ale **obnova**.

#### Co k tomu backend má a co nemá

| Schopnost | Stav |
|---|---|
| Znovu ověřit stav jednoho pokusu | **[F]** je — `GET /m1/operations/:id` (B-5, B-13) |
| Vypsat neuzavřené pokusy | **[F]** je — `GET /m1/operations` *(doplněno; B-16 uzavřeno)* |
| Označit pokus jako opuštěný | **[F]** je — `POST /m1/operations/:id/abandon` *(doplněno; B-16 uzavřeno)* |
| Potvrdit známý výsledek | plyne z lookupu — `CONFIRMED`/`REJECTED` uzavírá záznam sám |
| Důvod, proč je pokus `UNKNOWN` | **[F]** je — `unknown_reason` z uzavřeného slovníku + `unknown_at`, `last_checked_at` *(doplněno; B-17 uzavřeno)* |
| Archivovat terminální záznamy | **[F]** je, automaticky po 24 h (`resolvedRetentionMs`) |
| **Skutečně dohledat výsledek u `UNKNOWN`** | **[F]** **není** — lookup čte poslední zapsaný stav, nedělá rekonciliaci s upstreamem (`MR-25`) |

**Pět z šesti schopností `/m1` má.** Šestá — skutečné dohledání výsledku — je
jiný úkol než tato obrazovka a `MS-20` na něj nečeká: obrazovka smí ukázat
poslední známý stav a jeho stáří, **nesmí** tvrdit, že je živý.

#### Požadované pořadí

```
  MR-24 (pravidlo)  ──▶  resolution kontrakt  ──▶  testovací ID  ──▶  MS-20
 lokálně implementováno    v /m1 + důvod u          C3-032 ✔          (UI)
                       UNKNOWN — implementováno  RV-042 + M3 PASS   RV-039/RV-040
                                                               SHARED VALIDATION
                                                               BLOCKED (208/3)
```

Program `tests/mobile-ms20-ui.test.js` má zmrazené ID, je správně pod `C3-032`
a v M3 prošel. Stejně jsou registrované a zelené další čtyři successory. Diagram
přesto není Gate 0 důkaz: celý deterministický profil skončil exit `1`, `208/3`.

**[R] `MR-24`:** *„Uživatel vidí neuzavřené operace, zjistí jejich stav a může
je vědomě opustit; strop se uvolňuje rozřešením nebo opuštěním, nikdy
vytlačením nejstaršího záznamu."* Druhá polovina věty je `MD-19` §4.3 a je
závazná — opuštění je **uživatelský akt s vyslovenou cenou**, ne tichý úklid.

**[R] Resolution kontrakt** musí pokrýt: výpis otevřených pokusů; opuštění
jednoho pokusu s návratem počtu; **uložení důvodu při přechodu do `UNKNOWN`**;
a rozlišení „server o klíči neví" (`known: false`) od „server ho zná a nedopadl".
Tvar se v tomto dokumentu nezmrazuje — je popsaný v `GATEWAY.md` §6.

**Splněno.** Přibyly `GET /m1/operations`, `POST /m1/operations/:id/abandon`
a sloupce `unknown_reason` / `unknown_at` / `last_checked_at`. Obě routy jsou
**bez scope** ze stejného důvodu jako lookup: po dosažení stropu se odmítají
všechny mutace, takže kdyby uvolnění stropu samo vyžadovalo scope, který
zařízení nemá, nebyla by cesta ven vůbec. Chrání je vazba na `deviceId`, ne
scope — a přesně tak jsou pojmenované testy (§17.1).

`unknown_reason` je **kód z uzavřeného seznamu**, ne volný text
(`DATA-MODEL.md` §4.4). Volný text nejde otestovat ani přeložit a nese na
obrazovku obsah chybového řetězce z upstreamu. Uživatelskou větu skládá klient.

#### Blueprint

```
┌───────────────────────────────┐
│  Nerozřešené pokusy      3/32 │
│  Dokud je rozřešíš, nejde nic │  ← při naplněném stropu
│  odeslat ani schválit.        │
├───────────────────────────────┤
│  Zpráva do „~konverzace~"     │
│  před 12 min · výsledek neznám│
│  Požadavek odešel, ale odpověď│  ← věta klienta ke kódu
│  nepřišla. Efekt mohl proběh- │     ~upstream_timeout~
│  nout.                        │
│  ověřeno před 2 min           │  ← ~last_checked_at~, ne živý stav
│               [ Zjistit stav ]│
│               [ Opustit      ]│  ← druhotné, s potvrzením
├───────────────────────────────┤
│  Approval ~title~             │
│  před 40 min · čeká           │
│               [ Zjistit stav ]│
└───────────────────────────────┘
```

| Pravidlo | Důvod |
|---|---|
| Jen čtení stavu a vědomé opuštění | `I-11` — klíč neopravňuje a neodkládá |
| **Žádné hromadné „zkusit vše znovu"** | Jedno klepnutí by vyrobilo N nejednoznačných efektů |
| Opuštění potvrzuje druhý krok a říká cenu: **„Efekt na serveru zůstane nerozřešený."** | Doslova to, co dělá `discardOpen()` (`operation-journal.js:287-291`) — formulace nesmí slibovat zrušení |
| Odmítnutá mutace kvůli stropu sem vede přímo | `OPERATION_LIMIT` už nese `openOperations` (`handlers.js:241`) |
| Prázdný stav je uklidňující | „Nic nevisí." |

| **Nikdy netvrdit, že je stav živý** | Lookup čte poslední zapsaný stav. Řádek proto nese „ověřeno před N", ne dojem průběžné kontroly (`MR-25`) |

#### Stav `MS-20` — tři různé věci, ať se nepletou

| Co | Stav | Přesně to znamená |
|---|---|---|
| **Backendové recovery komponenty** | **IMPLEMENTOVÁNO LOKÁLNĚ / CÍLOVÝ LIFECYCLE PŘIJAT** | `GET /m1/operations`, `GET /m1/operations/:id`, `POST /m1/operations/:id/abandon` existují, `unknown_reason` je kód z uzavřeného slovníku a `unknown_at`/`last_checked_at` jsou v datech (migrace 056). `DR-003` A je přijatý cílový kontrakt, ale související notifikační receipts/projektor a Gate 1 důkazy nejsou implementované. |
| **Samostatná obrazovka `MS-20`** | **`LOCALLY_COMPOSED / COMPOSITION_REVIEW_APPROVED / REGISTRY_REVIEW_APPROVED / MOBILE_PASS / SHARED_VALIDATION_BLOCKED`** | Historické `392c5928` dostalo v `RV-025` `CHANGES_REQUIRED`; opravená kompozice prošla `RV-039`/`RV-040`, registrace `RV-042` a mobilní M3 program. Celý profil FAIL `208/3` brání produktovému DONE a `GAP-9` zůstává dokumentační mezera. `MR-25` je otevřený paralelní backendový úkol, ne prerekvizita obrazovky. |
| **Diagnostický žurnál v `MS-03`** | **ZACHOVANÁ DIAGNOSTICKÁ PLOCHA** | Diagnostický žurnál se s `MS-20` nezaměňuje a v lokální kompozici zůstává zachovaný; ani jedna plocha není produkční rekonciliace `MR-25`. |

Odblokovaný kontrakt, Composition Review C, registry review ani mobilní PASS
neznamenají hotovou obrazovku. Successory zůstávají lokální, celý profil je
FAIL `208/3` a `GAP-9` zůstává dokumentační mezera. `MR-25` je otevřený
souběžný backendový úkol, nikoli prerekvizita `MS-20`. Historický `PC-010`
nebyl proveden.

---

## 7. Chybové kódy → co uživatel vidí

Backend rozlišuje 20 kódů (B-6). Tabulka je závazek, že se ani jeden neztratí
v obecné hlášce.

| Kód | Uživatel vidí | Primární akce | Auto-retry |
|---|---|---|---|
| *(bez sítě — klient)* | „Nejsi připojený" | číst cache | ne |
| `SERVER_UNAVAILABLE` | „Server neodpovídá" | `MS-03` diagnostika | jen u čtení |
| `TOKEN_MISSING` / `TOKEN_INVALID` | „Přihlas se znovu" | `MS-02` | ne |
| `TOKEN_EXPIRED` | „Platnost přihlášení vypršela" | `MS-02`, cache **zůstává** | ne |
| `TOKEN_REVOKED` | „Toto zařízení bylo odvoláno" | **smazat cache, pak** `MS-02` | ne |
| `SCOPE_REQUIRED` | „Toto zařízení na to nemá oprávnění" + `requiredScope` lidsky | vysvětlení, kde se mění | ne |
| `STATE_CONFLICT` | „Stav se mezitím změnil" | načíst aktuální, potvrdit znovu | ne |
| `OPERATION_CONFLICT` | „Tenhle pokus se liší od původního" | vědomě nová operace (nový klíč) | ne |
| `APPROVAL_EXPIRED` | „Platnost approvalu vypršela" | zpět na frontu | ne |
| `APPROVAL_SUPERSEDED` | „Zadání se změnilo" | přečíst nové | ne |
| `PAIRING_ALREADY_USED` | „Kód už byl použit" | nový kód na desktopu | ne |
| `PAIRING_EXPIRED` | „Kód vypršel" | nový kód | ne |
| `PAIRING_DISABLED` | „Párování je na serveru vypnuté" | **žádná** cesta kolem | ne |
| `PROTOCOL_MISMATCH` | „Aplikace je starší než server" | jak aktualizovat | ne |
| `CURSOR_UNKNOWN` | *(bez hlášky)* plný refresh seznamu | — | ano, jednou |
| `BAD_REQUEST` | k poli: „Zpráva je příliš dlouhá (max ~N~)" | oprava vstupu | ne |
| `ROUTE_NOT_ALLOWED` | „Tuhle funkci telefon nemá" | — | ne |
| `NOT_FOUND` | „Už neexistuje" | zpět na seznam | ne |
| `OPERATION_LIMIT` | „Máš ~open~ nerozřešených pokusů" | **`MS-20`** | ne |
| `RATE_LIMITED` | „Moc rychle po sobě" + `retryAfterMs` odpočtem | počkat | jen u čtení |

Dvě věci, které tabulka drží a které se v aplikacích běžně ztrácejí:
**expirace ≠ revokace** (druhá maže cache) a **`OPERATION_CONFLICT` ≠ `STATE_CONFLICT`**
(první je o klíči, druhá o světě).

---

## 8. Design tokeny

Bez značky — role, ne konkrétní odstíny. Konkrétní hodnoty vzniknou při
implementaci a musí projít kontrastní kontrolou z §10.

| Role | Použití | Poznámka |
|---|---|---|
| `surface` / `on-surface` | pozadí a text | tmavý režim je rovnocenný, ne dopočítaný |
| `muted` | metadata, časy, stáří | nikdy pod 4.5:1 |
| `attention` | `STALE`, čekání, odpočet > 60 s | žlutá rodina |
| `danger` | odvolání, vypršení, odpočet < 60 s | červená rodina |
| `locked` | uzamčené prvky | šedá **+ ikona zámku** |
| `positive` | `CONFIRMED` | používá se **jen** po potvrzení serverem |

**Typografie:** jedna rodina, pět velikostí (12/14/16/20/28), tučnost jen pro
nadpisy a hodnoty. Zprávy 16 sp minimálně; obsah konverzace se nesmí zmenšovat
kvůli vejití.

**Rozestupy:** 4 dp mřížka; 8/12/16/24 jsou jediné povolené vnitřní odsazení.

**Dotykové cíle:** minimum 48 × 48 dp. Rozhodovací tlačítka `MS-14`
minimálně 56 dp na výšku a **12 dp od sebe**, aby palec netrefil vedle.

**Pohyb:** přechody ≤ 200 ms, žádné dekorativní animace. **Zakázáno:** pulzující
„typing" indikátor (B-2), neurčitý spinner přes celou obrazovku, animace, která
zakryje změnu stáří dat.

---

## 9. Mikrocopy

Formulace jsou v tomhle produktu součást bezpečnosti, ne kosmetika.

| Zakázáno | Místo toho | Proč |
|---|---|---|
| „Zařízení bylo vymazáno" | „Zařízení ztratilo přístup" | `I-7` — data v telefonu zůstávají |
| „Odešle se, až budeš online" | „Offline odeslat nelze" | `I-3`, `C-5` — žádná fronta |
| „Něco se pokazilo" | konkrétní kód podle §7 | zahazuje rozlišení, které backend má |
| „Zkusit znovu" u mutace | „Zjistit stav" | `UNKNOWN` se čte, neopakuje |
| „Aktualizace…" u `STALE` | „Data z 14:02, aktualizuji" | stáří nesmí zmizet během načítání |
| „Žádné výsledky" offline | „Hledalo se jen v uložených datech" | `SS-03` u `MS-09` |
| „Přihlášení vypršelo" po revokaci | „Zařízení bylo odvoláno" | `C-7` — jiná událost, jiné chování |

Jazyk: čeština s diakritikou, tykání (jednouživatelský nástroj), žádné vykřičníky.
Čísla a časy: relativně do 24 h („před 12 min"), pak absolutně.

---

## 10. Přístupnost

| Požadavek | Provedení |
|---|---|
| Význam nikdy jen barvou | Každý stav má text + ikonu; `STALE` je čitelné i v odstínech šedi |
| Kontrast | 4.5:1 text, 3:1 ikony a okraje — v obou režimech |
| Dynamická velikost písma | Layouty testované na 200 %; `MS-14` musí zůstat rozhodnutelný |
| Čtečka obrazovky | Trust bar má souhrnný popisek („offline, data z 14:02, část obrazovky uzamčena"); `OperationButton` hlásí stav, ne jen jméno |
| Jedna ruka | Primární akce v dolní třetině; `MS-14` nikdy nevyžaduje dosah do horního rohu |
| Zamčená obrazovka | Náhled obsahu v přepínači úloh OS zakázán (`MS-01`) |

---

## 11. Co UI záměrně neumí

Streamovanou odpověď (B-2), frontu offline změn (`I-3`, `I-4`), zobrazení diffu
(B-8; uzavřené `R-4` ho pro 1.0 vylučuje), spouštění a přechody lifecycle fází, vytváření agentů,
specialistů a skillů, marketplace, cokoli se shell přístupem, bezpečnostní
sekci nastavení (`R-5`), iOS a cloud push (PLAN.md §5, §9).

**Nastavení, projekty, paměť, agenti, průběh běhu a hledání nejsou v 1.0 UI
proto, že pro ně neexistuje schválená `/m1` plocha (B-1)** — ne proto, že by
byly nežádoucí. `DR-008` samo jejich implementaci neotevřelo.

---

## 12. Lifecycle mobilní aplikace

Mobil není desktop s menším displejem: proces je uspáván a zabíjen, síť se
přepíná mezi Wi-Fi a LTE a HTTP request v letu je jednorázově ztracen. Pořadí
kroků je proto součást návrhu, ne implementační detail.

| Přechod | Pořadí kroků | Zakázáno |
|---|---|---|
| **Studený start** | ① úklid `EXPIRED` cache → ② zámek aplikace → ③ smíření otevřených operací (§16) → ④ obsah | Cokoli zobrazit před ②. Náhled v přepínači úloh OS |
| **Návrat do popředí** | ① `health` + `capabilities` (obnoví scope i serverový čas) → ② smíření otevřených operací → ③ refresh hlavy obrazovky | Vykreslit mutační prvky dřív než po ②. Automaticky cokoli odeslat |
| **Odchod do pozadí** | ① úklid `EXPIRED` → ② uložit draft → ③ pustit rozpracovaný požadavek | Držet síťové operace na pozadí. Doposlat „na dokončení" |
| **Ztráta konektivity** | Trust bar → `SS-03`, mutační prvky neaktivní, draft zůstává | Fronta. Automatický retry mutace |
| **Změna sítě (Wi-Fi ↔ LTE)** | Zachází se s ní jako s reconnectem (`SS-05`): požadavek v letu je považován za **ztracený**, ne za běžící | Předpokládat, že spojení pokračovalo |
| **Zabití procesu při čekání** | Po startu se pokus najde v lokálním indexu a **přečte** (`W-3`) | Odeslat znovu s novým klíčem |
| **Reconnect** | ① `health` → ② operace → ③ data; při aktivaci notifikační obrazovky také HTTP pull existujících/seedovaných řádků. Bez producenta `F-111` nejde o důkaz doručení běžné události. Přerušený turn se **označí**, nepokračuje (`C-8`) | Z notifikace domýšlet autoritativní stav nebo rekonstruovat neexistující události běhu |

Pravidlo, které to spojuje: **žádný přechod nikdy nezpůsobí mutaci.** Obnovit
se dá jen čtením.

---

## 13. Idempotence mutací

Ke každé mutaci patří odpověď na tři otázky: potřebuje klíč, smí se zopakovat,
a co znamená nejasný konec. Stav je ověřený proti handlerům.

| Operace | Klíč | Bezpečné zopakování | Nejasný konec (`UNKNOWN`) | Změna payloadu |
|---|---|---|---|---|
| `POST /m1/chat` | **povinný** — bez něj `BAD_REQUEST` (`handlers.js:211-215`) | jen s **týmž** klíčem → `202`/`200` bez druhého efektu (`handlers.js:249-264`) | přečíst `GET /m1/operations/:id` (`resolveBy` je v odpovědi, `handlers.js:291`) | jiný text = jiná zpráva → **nový klíč**; týž klíč + jiný payload = `OPERATION_CONFLICT` |
| `POST /m1/approvals/:id/decide` | **povinný** (`handlers.js:464`) | jen s týmž klíčem **a** týmž otiskem; klíč **neprodlužuje** jednorázové oprávnění (`I-11`) | přečíst stav approvalu **i** operace; nikdy nerozhodovat znovu naslepo | jiný otisk → `APPROVAL_SUPERSEDED`, rozhodnutí se zahazuje |
| `POST /m1/notifications/ack` | není | stejné ID je mechanicky idempotentní, ale endpoint není bezpečný mezi zařízeními: handler nepředá `deviceId`, SQL filtruje jen ID a broadcast má globální `read_at` (`F-112`, child `F-011`/`F-015`) | **nepovažovat za produkčně bezpečný retry**; `DR-003` A a `DR-012` A přijaly append-only lifecycle a per-device receipts, ale implementace, sekvenční ochrana a Gate 1 důkazy chybějí | — |
| `POST /m1/pair/claim` | není | **ne** — druhé uplatnění je `PAIRING_ALREADY_USED` | začít znovu s **novým kódem** | — |
| všechna `GET` | není | ano | — | — |

**[R]** Každá budoucí mutace v `/m1` (nastavení, odvolání zařízení, dry-run)
nastupuje s klíčem od prvního dne. Doplnit ho zpětně znamená mít v produktu
období, kdy retry plodí duplicity.

---

## 14. Serverový čas

Expirace se nikdy nerozhoduje podle hodin telefonu. Rozejité hodiny by jinak
tlačítka zhasly předčasně nebo je nechaly svítit po vypršení.

| Pravidlo | Provedení |
|---|---|
| Zdroj offsetu | **[F]** `health.time` (`handlers.js:59`); offset se přepočítá při každém úspěšném volání |
| Odpočty | Renderují se z korigovaného času a jsou **zjevně přibližné** |
| Autorita nad platností | **serverový příznak, ne odpočet**: `approvals.expired` (`handlers.js:451`), `APPROVAL_EXPIRED`, `TOKEN_EXPIRED` |
| Neznámý nebo starý offset | Kvalitativní formulace („vyprší brzy") místo čísel; prvky se **nedeaktivují** |
| Velký rozdíl hodin | Zapsat do diagnostiky (`MS-03`) a upozornit; nikdy tiše nekorigovat výpočty stáří cache |
| Stáří cache | Počítá se ze stejného korigovaného času; jinak by `FRESH`/`STALE`/`EXPIRED` záviselo na nastavení telefonu |

---

## 15. Obnova po přeinstalaci a ztrátě lokálního žurnálu

**[F]** Každé párování razí nový `deviceId` (B-15) a žurnál je klíčovaný
`(device_id, operation_id)`. Přeinstalace, která smaže device token, proto
vede k novému párování a k tvrdému a nepříjemnému závěru:

> **Po přeinstalaci nebo novém spárování jsou dřívější neuzavřené pokusy
> z telefonu nedosažitelné.** Nový `deviceId` je nevidí, i když serverové
> záznamy zůstávají zachované.

| Důsledek | Kde se projeví |
|---|---|
| Serverová discovery pro stejné zařízení | `GET /m1/operations` vrátí otevřené `PENDING`/`UNKNOWN` pokusy autentizovaného `deviceId`; při zachovaném tokenu tak lze znovu objevit jejich ID i bez lokálního indexu |
| Lokální index a draft mají jinou roli | Index drží přiřazení, popisek a krátkou historii včetně rozřešených pokusů; draft drží přesný request pro bezpečný retry pod týmž klíčem. Serverový seznam ani jedno neobnoví |
| Nové párování ztrácí přístup ke starému `deviceId` | Nový token neuvidí staré pokusy ani přes seznam, ani přes `GET /m1/operations/:id`; tento přechod je z telefonu nevratný |
| UI to musí říct při prvním spuštění po novém spárování | „Pokusy z předchozího spárování tu nejsou vidět." Nikdy „vše je vyřešeno" |
| Osiřelé záznamy zůstávají na serveru napořád | `PENDING`/`UNKNOWN` se nemažou časem (§16) a jejich `deviceId` už se nikdy nepřihlásí |

**[R] `MR-25` — evidovaný backendový úkol, ne poznámka v UI.** Operátor
potřebuje na desktopu pohled na osiřelé otevřené operace; bez něj
`mobile_operations` monotónně roste o řádky, ke kterým se žádný klient nemůže
přihlásit. Zadání je rozepsané v `DATA-MODEL.md` §4.6 a drží dvě rozhodnutí:

- **osiřelost se neřeší mazáním** — otevřená operace může být efekt, který se
  opravdu stal a jen nebyl potvrzen;
- **vlastnictví je jiná osa než stav operace.** `ORPHANED` není nový terminální
  stav; operace zůstává `UNKNOWN` a jen už nemá, kdo by se na ni zeptal.

`MR-25` **není součástí fáze 0–1** a mobilní UI na něj nečeká.

**ROZHODNUTO `U-9` — ano, index klíčů operací je třetí výjimka z `I-10`.**
Jeho ztráta není pouhá ztráta cache, ale rozsah škody závisí na tokenu. Se
zachovaným tokenem téhož `deviceId` serverový seznam znovu objeví ID a stav
otevřených `PENDING`/`UNKNOWN` pokusů; jednotlivý
`GET /m1/operations/:id` je může ověřit. Neobnoví však lokální atribuci a popisek,
rozřešenou historii, draft ani přesný retry payload. Po ztrátě tokenu a novém
spárování se razí nový `deviceId` a nedostupné jsou i starý seznam a lookupy.
Klasifikace je tedy `draft` · `preference` · `operation recovery index`.
Obsah, zákaz ukládat text zprávy, pořadí zápisu **klíč → záznam → odeslání**
a omezení dnešního `localStorage` jsou v `DATA-MODEL.md` §4.5.

---

## 16. Maximální stáří `UNKNOWN` a eskalace

**[F]** `PENDING` a `UNKNOWN` nezanikají časem — `purgeResolved()` se dotýká
jen `CONFIRMED` a `REJECTED` (`operation-journal.js:274-285`). Bez eskalace
by tedy jeden nejasný pokus zůstal viset navždy a strop by se plnil jen jedním
směrem.

Stáří se počítá od `unknown_at`, ne od `created_at`: pokus, který běžel hodinu
a pak ztratil odpověď, není hodinu starý `UNKNOWN`. Řádek k tomu ukazuje
`last_checked_at` — kdy byl stav naposledy načten — aby bylo jasné, že jde
o poslední zapsaný stav, ne o živý (B-18).

| Stáří | Chování UI |
|---|---|
| < 5 min | Běžné čekání (`W-2`/`W-3`), žádné upozornění |
| 5 min – 1 h | Při každém návratu do popředí **jeden** pokus o čtení stavu; položka v `MS-20` |
| 1 h – 24 h | Nenápadná připomínka v trust baru: „~n~ pokusů čeká na rozřešení" |
| > 24 h | `MS-20` se nabídne **aktivně** při další mutaci, s vysvětlením a s možností opustit |
| ≥ 24 z 32 otevřených | Varování **před** vyčerpáním stropu — po vyčerpání už nejde odeslat nic |

Tři pravidla, která eskalace nesmí porušit:

1. **Nikdy neopouštět pokus automaticky.** Opuštění je uživatelský akt s cenou.
2. **Nikdy neopakovat pokus automaticky**, ani po libovolně dlouhé době (`C-6`).
3. Eskalace je otravná záměrně — `MD-19` §4.3 to nazývá „intentionally
   inconvenient" a UI to nemá zjemňovat.

---

## 17. Otevřená rozhodnutí

| # | Otázka | Stav |
|---|---|---|
| ~~**U-1**~~ | Vzniká `MS-20`? | **ROZHODNUTO — ano**, jako recovery mechanismus, ne seznam. Program je pod `C3-032`, kompozice i registr jsou zrevidované a mobilní M3 program PASS; celý profil FAIL `208/3` brání DONE a `GAP-9` zůstává dokumentační mezera. `MR-25` je otevřený paralelní backendový úkol, ne prerekvizita `MS-20` — §6.9 |
| **U-2** | Potvrzuje se schválení druhým krokem? | **[R]** Ano u schválení, ne u zamítnutí |
| ~~**U-3**~~ | Deaktivovat rozhodovací tlačítka pod 15 s do vypršení? | **ROZHODNUTO — ne.** Odpočet ano, ochrana proti dvojímu klepnutí ano, deaktivace až podle serveru. Autorita je serverový čas a serverový příznak — §6.6, §14 |
| **U-4** | Startovní obrazovka ve fázi 1 | **[R]** Konverzace; přehled až s fází 3 |
| **U-5** | Ukazuje se počet approvalů na záložce offline? | **[R]** Ne — mizí, nezůstává zastaralé číslo (`D-S2`) |
| **U-6** | Tmavý režim: následovat systém, nebo volba v aplikaci? | **[R]** Systém + přepínač; je to lokální preference `MD-15`, ne serverové téma |
| **U-7** | Zámek aplikace: PIN v aplikaci, nebo systémové ověření? | **[R]** Systémové (biometrie/PIN OS); vlastní PIN je další tajemství k ochraně |
| **U-8** | Zobrazovat `confidence` a `mode` z odpovědi chatu? | **[D]** — hodnoty existují, ale bez kalibrace by mátly |
| ~~**U-9**~~ | Je lokální index klíčů operací třetí výjimka z `I-10`? | **ROZHODNUTO — ano.** Povinně perzistentní; není to cache, ale schopnost ověřit a bezpečně zopakovat. `I-10` má nově tři výjimky — §15, `DATA-MODEL.md` §4.5 |
| **U-10** | Šifrované úložiště indexu na dnešní PWA | **[D]** `localStorage` šifrovaný není. Index je S1 (typy a časy, žádný obsah), takže to fázi 0–1 neblokuje; **nativní klient ho musí uložit šifrovaně** — `DATA-MODEL.md` §4.5 |

### 17.1 Co musí být hotové před zahájením implementace

Tři body z review operátora, seřazené podle toho, co blokuje co:

| # | Podmínka | Stav |
|---|---|---|
| 1 | `MS-20` schváleno **a** doplněn skutečný resolution kontrakt | Kontrakt, kompozice, registry napojení a mobilní M3 program jsou splněné (`RV-039`/`RV-040`/`RV-042`). Obrazovka přesto není produktově DONE: celý profil je `208/3`, diagnostický žurnál v `MS-03` zůstává zachovaný a skutečné dohledání výsledku (`MR-25`) je otevřené |
| 2 | Žádná slepá deaktivace podle lokálního času; expiraci řídí server | **vyřešeno** v §6.6 a §14 |
| 3 | Ověřit authorization model `GET /m1/operations/:id` | **ověřeno a zamčené testy.** Vazba na `deviceId` je silnější než scope check, ale jen dokud je testovaná — proto jsou testy pojmenované doslova: *a valid token cannot read another device operation*, *a revoked token cannot read its own operation*, *an expired token cannot read its own operation*, *a token that is both revoked and expired reports revoked, not expired*, *a guessed operationId cannot cross the device boundary* |
| 4 | Klientská entropie klíče (B-14) | **splněno** — `newOperationId()` bere 16 B z `crypto.getRandomValues()`, tedy plných 128 bitů. Server validuje jen tvar; entropii vynutit neumí a dokument to říká nahlas |
| 5 | Pořadí zápisu u mutací | **splněno** — `klíč → recovery záznam → odeslání`, `DATA-MODEL.md` §4.5. Opačné pořadí vyrábí operaci, kterou telefon neumí pojmenovat |

---

## 18. Vztah ke Gate 0

Tento dokument **nic neodblokovává**. Loopback hraniční sada je PASS, ale
skutečný non-loopback/VPN peer test neproběhl, 32 `server` programů nejsou bez
externího supervizoru runtime-eligible a celý profil je `208/3`. Platí tedy
PLAN.md §8.1: žádný bind mimo loopback, vzdálený listener, pairing ani `/m1`
v produkčním vzdáleném provozu.

Návrh je psaný tak, aby byl **postavitelný proti loopbacku nebo emulátoru** —
párování, approvaly i žurnál operací se dají prokázat lokálně. Nic v UI
nevyžaduje síťové zpřístupnění dřív, než ho povolí bezpečnostní hranice.

---

*Stav řetězce: `MR-24` zapsané ✔ → resolution kontrakt v `/m1` ✔ → opravené
vstupy složené ✔ → Composition Review C `RV-039`/`RV-040` ✔ → `MS-20` pod
`C3-032` a registry `362/7/5` schválené `RV-042`/`RV-043` ✔ → mobilní M3 PASS ✔
→ **celý profil exit `1`, `208 PASS / 3 FAIL`, SHARED_VALIDATION_BLOCKED,
Gate 0 není PASS, NOT DONE**.*

*Souběžně a nezávisle: `MR-25` (rekonciliace výsledku + osiřelé operace
a desktopový pohled operátora) — backendový úkol mimo fázi 0–1.*
