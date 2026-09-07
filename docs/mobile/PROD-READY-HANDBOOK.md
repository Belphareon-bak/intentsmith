# Prod-ready handbook — jak se mobilní companion dostane z prototypu do provozu

**Stav dokumentu:** návod, ne verdikt. Kanonický stav je v
[FINAL-PROTOTYPE.md](FINAL-PROTOTYPE.md); tohle je jeho druhá polovina — *jak*
se každá otevřená položka zavírá.

Handbook má jediné pravidlo, ze kterého plyne všechno ostatní:

> **Položka je hotová, když existuje důkaz, který by šel vyvrátit.**
> Ne když je napsaná, ne když „to funguje", ne když to někdo viděl.

Proto má každá položka čtyři sloupce, ne jeden: *kritérium* (co musí platit),
*důkaz* (čím se to ukáže), *vlastník* (kdo to smí prohlásit) a *pád* (co se
stane, když to selže v provozu). Poslední sloupec je tam schválně: položka,
u které nikdo neumí říct, jak vypadá její selhání, není hotová ani promyšlená.

---

## 0. Slovník rolí

| Role | Co smí prohlásit |
|---|---|
| **Operátor** | přijetí rozhodnutí (`docs/decisions/*`), release, revokaci zařízení |
| **Integrátor** | boundary baseline, merge do M1 linie, obsah release artefaktu |
| **Implementátor** | že kód dělá, co je popsané, a že to drží test |
| **Reviewer** | že důkaz odpovídá tvrzení — ne že se mu řešení líbí |

Jedna osoba může nosit víc klobouků. Nesmí ale **prohlásit vlastní důkaz za
ověřený**: kdo psal kód, nepodepisuje jeho review.

---

## 1. Definice hotovosti pro tři úrovně

| Úroveň | Věta, která ji vystihuje | Kdo ji smí vyslovit |
|---|---|---|
| **P0 — pravdivý interní prototyp** | „Na jednom telefonu to prokazatelně dělá, co říká, a co nedělá, je napsané." | Implementátor + Reviewer |
| **P1 — interní pilot** | „Dá se to dát pěti lidem ve firmě, aniž bychom museli být u toho." | Operátor |
| **P2 — Remote Companion release** | „Smí to běžet mimo USB kabel, na cizí síti, proti ostrým datům." | Operátor po security review |

Mezi P0 a P1 je hranice **distribuce**. Mezi P1 a P2 je hranice **sítě**. Tyhle
dvě hranice jsou důvod, proč se seznam nedá zkrátit: každá z nich mění model
útočníka, ne jen množství práce.

---

## 2. P0 — uzavřít pravdivý interní prototyp

### P0-1 Rozhodnout 024 — ✅ **HOTOVO 2026-08-19**

Operátor přijal 024, 025, 026 i 027. Producent má tvar, který smí zůstat;
zapojení do reálné práce agenta je vázané na P0-2 a P0-6.

**Co z toho vyplynulo jako nová práce:** dvě osy platnosti approvalu (025),
druhá rozhodovací plocha v IDE (P0-6), zámek na soubor (027), měření spotřeby
před volbou způsobu probouzení (025, §Probuzení).

Rozhoduje se **pět věcí najednou**, a je poctivé je vypsat, protože „přijímám
024" jinak znamená pro každého něco jiného: (1) producent smí razit approvaly,
(2) devět vět S1 slovníku je text, který uživatel uvidí, (3) čekání na řádku je
přijatelný mechanismus napříč procesy, (4) `adb reverse` je pro prototyp
dostatečná cesta, (5) systémový zámek a ST-SECURE vault jsou přijatelná
hranice **pro interní použití**. Původní `EncryptedSharedPreferences` už není
aktuální implementace: MM5-B jej nahradil přímým AES-GCM klíčem v
`AndroidKeyStore`.

### P0-2 Skutečný effect seam — ✅ **ZAPNUTO** (2026-08-19), rozsah `FILE_WRITE` + `fs.write`

> **Auto-approve je výchozí stav** (rozhodnutí [`028`](../decisions/028-approval-is-exceptional.md)).
> Agent zapisuje bez ptaní; approval je **výjimka** pro případy, které
> vyjmenovává `src/executor/write-policy.js` — jedno čitelné místo, protože co
> je citlivé, rozhoduje operátor.
>
> Záznam implementace: [`WP-APPROVAL-PLANE-RESULT.md`](WP-APPROVAL-PLANE-RESULT.md).
> Otevřené `P1` nálezy a mediace zbylých zapisovatelů:
> [`docs/execution/approval-mediation.md`](../execution/approval-mediation.md).

Nezávislé review našlo v `guardedWrite` tři `P0` vady (TOCTOU, zápis po ztrátě
lease, chyba čtení vydávaná za neexistující soubor). Všechny jsou opravené a
sondy z review jsou regresními testy. **Jedna vlastnost se ale opravit nedá** a
je to podmínka, ne detail:

> Mezi poslední kontrolou a zápisem zůstává mikroskopické okno, protože zápis
> souboru na POSIXu není compare-and-swap. Externí zapisovatel (editor, `git
> checkout`) ho může trefit. Zavřít to jde jen tak, že **všichni** zapisovatelé
> půjdou přes jednu mediační vrstvu.

**Rozhodnutí, které to odemyká** (patří operátorovi, ne implementaci):

| Varianta | Co slibuje | Cena |
|---|---|---|
| **Praktická** ⭐ | Všichni zapisovatelé IntentSmithu jsou mediovaní; externí editor se detekuje best-effort a zápis se zastaví, pokud se změna stihne projevit do poslední kontroly | dnešní stav; zbývá okno v řádu mikrosekund |
| **Silná** | Žádný externí zapisovatel nemůže přepsat stav | verzované úložiště nebo broker pro **všechny** zapisovatele; velký zásah mimo mobil |

Dokud tohle není rozhodnuté, `setApprovalDeps` se v produkčním kódu **nevolá** —
cesta existuje a je otestovaná, ale nikdo ji nezapíná.

`src/executor/guarded-write.js` je ta cesta: vezme zámek (`027`), zeptá se
s předpokladem (`025`), počká, a zapíše **až** po souhlasu — nebo nezapíše a
pojmenuje proč (`locked`, `reject`, `precondition_changed`, `timeout`). Osm
testů proti skutečnému souborovému systému, včetně toho, kdy se cíl změní mezi
odpovědí a zápisem.

**Zapojeno do editační cesty jádra** (`fs.write` v režimu `ask`,
`src/ws-bridge/session-adapter.js`). `edit_request` chodí do IDE dál, ale
`reqId` je nově **id approvalu**, takže odpovědět může telefon, desktop i IDE a
první odpověď vítězí. Třicetivteřinový timer zmizel — otázka platí, dokud platí
předpoklad. Konec relace otázku **stáhne** a pustí zámek.

**Zapnuto v produkci od 2026-08-19.** `server.js` vyrábí producenta a volá
`configureEffects({ db, producer })` + `setApprovalDeps({ db, producer })`.
Strop z `024` §5.1 („producent se nespouští sám") operátor sundal; `024` to má
zaznamenané.

Zápis uživatelských souborů **v cestě FILE_WRITE a `fs.write`** jde přes jednu
řízenou cestu (`src/executor/effects.js`) a ta je **fail-closed**: zapisuje jen
režim `approval` (db + producent). `lock` (jen db) i `none` odmítají a nic
nezapíšou — zámek chrání dva běhy před sebou navzájem, ne uživatele před
zápisem, na který nekývl.

Původní návrh nechával oba slabší režimy zapisovat a spoléhal na to, že režim je
vidět v návratové hodnotě. Review to označilo za `P0` a mělo pravdu: viditelnost
nikoho nezachrání, když se na ni nikdo nedívá.

**Pozor na rozsah.** Řízená cesta pokrývá `FILE_WRITE` intent a nástroj
`fs.write`. **Nepokrývá** patch engine, skill write step ani další zapisovatele —
mediace zbytku je samostatný balík a slib se zatím nesmí formulovat šířeji.

**Kdy se ptá.** Secrety a klíče · CI a nasazení · přepis už aplikované migrace.
Zápis do `.git/` se **odmítá**, ne ptá — otázka, na kterou je správná odpověď
vždycky „ne", je jen zdržení. Všechno ostatní jde automaticky, ale **pořád přes
tutéž cestu**: zámek, kanonický cíl, fencing a atomická náhrada platí i pro
zápis, na který se nikdo neptal.

Pravidlo, podle kterého ten seznam vznikl: *ptát se tam, kde je frekvence
blízká nule a důsledek sahá mimo to, co jde snadno vrátit.* Proto v něm nejsou
manifesty (`package.json`) — agent je při stavbě mění běžně a zajímavá otázka
je stejně „smím nainstalovat tenhle balík", ne „smím editovat manifest".

**Zrušení, timeout a osiřelý efekt.** Zrušení i vypršení času efekt
**zastaví** — signál teče z controlleru přes handler i nástroj až do
`guardedWrite`, a `executeWithTimeout` po vypršení abortuje a **čeká na
terminální zastavení**. Když se efekt nezastaví ani v odkladu (2 s), stav
**není** `timeout`, ale `EFFECT_ORPHANED`:

| | `timeout` | `orphaned` |
|---|---|---|
| Co víme | efekt **neproběhl** | **nevíme**, jestli proběhl |
| `retryable` | ano | **ne, nikdy** |
| Na telefonu | `run.failed` | `run.unknown` — „Stav běhu není jistý" |

Rozdíl je celý smysl `025` a návrhový dokument ho žádá výslovně
(`docs/inventory/22-effect-authority-trace.md`): `cancelled` ani `timed_out` se
nesmí vydat před potvrzeným ukončením efektu, jinak je pravdivý stav `orphaned`.
Zopakovat efekt, o kterém nevíme, jestli proběhl, je nejrychlejší cesta k tomu,
aby proběhl dvakrát — proto `orphaned` nikdy nespustí auto-retry a nespadne ani
do LLM fallbacku, který by ho zakryl klidnou větou.

Co zbývá: rozšířit na další efekty než zápis souboru (shell, mazání, nasazení) a
doplnit jim vlastní stropy podle `025`.

| | |
|---|---|
| **Kritérium** | `requestApproval()` volá reálná cesta jádra před skutečným efektem; demo skript přestane být jediným volajícím |
| **Důkaz** | test, který spustí reálnou cestu, zamítne approval a **ověří, že efekt nenastal**; a druhý, který ho schválí a ověří, že nastal právě jednou |
| **Vlastník** | Implementátor; přijetí Operátor |
| **Pád** | agent provede efekt bez svolení, nebo ho po schválení provede dvakrát |
| **Stav** | **splněno** — `tests/effects-guarded-path.test.js` (12 PASS) pouští skutečný handler i skutečný nástroj a kouká na disk; `tests/approval-lifecycle.test.js` (10 PASS) drží cancel, vlastnictví, idempotenci a restart |

Seam musí umět pět věcí, které demo neumí: **idempotenci** (schválení se
nesmí provést dvakrát, ani po restartu), **cancel** (běh zrušený mezi ptaním
a odpovědí nesmí efekt provést), **timeout** (okno `DR-011` vyprší → efekt se
neprovede a běh to řekne), **recovery** (proces spadne mezi rozhodnutím a
efektem → po startu je stav `UNKNOWN`, ne „hotovo"), a **audit** (kdo, kdy,
na základě čeho).

Nejbližší reálný kandidát je `fs.write` v režimu `ask`
(`src/ws-bridge/session-adapter.js`). Pozor: tamní okno je **30 s**, `DR-011`
žádá 5 minut. Sjednocení oken je součást toho rozhodnutí, ne jeho vedlejší
efekt — a je to změna chování IDE, ne mobilu.

### P0-3 Fyzický device journey

| | |
|---|---|
| **Kritérium** | jeden podporovaný telefon projde celou maticí níže |
| **Důkaz** | vyplněná matice s datem, modelem, verzí OS a jménem toho, kdo klikal |
| **Vlastník** | Reviewer |
| **Pád** | „na emulátoru to šlo" — biometrie, Doze, výrobcem zabité procesy a reálná USB odpojení se na emulátoru nechovají stejně |
| **Stav** | `NOT RUN` — protokol a záznamový list jsou připravené v [DEVICE-MATRIX-RUN.md](DEVICE-MATRIX-RUN.md) včetně doslovných kroků pro řádky 3, 4, 5, 9, 10 a 12. Chybí jediné: telefon a někdo, kdo to odklikne |

Matice (každý řádek = pozorování, ne dojem):

| # | Scénář | Co musí platit |
|---|---|---|
| 1 | instalace a první spuštění | žádný prompt před spárováním |
| 2 | párování QR i vložením kódu | kód je jednorázový; druhé použití 409 |
| 3 | approve | efekt nastane až po ťuknutí |
| 4 | reject | efekt nenastane a běh to řekne |
| 5 | nechat propadnout (změnit cíl během čekání) | běh skončí bez efektu; telefon ukáže nový text podle `025` |
| 6 | Home → návrat | zámek, `BiometricPrompt`, po odemčení funkční relace |
| 7 | recents náhled | prázdný / zakrytý (`FLAG_SECURE`) |
| 8 | zabití procesu z recents | po startu zámek, credential přežil v Keystore |
| 9 | odpojení USB za běhu | aplikace řekne „gateway nedostupná", nemlčí a neukazuje starý obsah jako živý |
| 10 | vypnutí gateway během čekání na approval | totéž, plus běh na desktopu se dozví timeout |
| 11 | letadlový režim | `SS-03` offline, ne `SS-08` |
| 12 | reboot telefonu | po startu zámek, pak funkční relace |
| 13 | změna zámku obrazovky (přidání/odebrání) | `lockKind` se přepne a nastavení to říká |
| 14 | odhlášení | credential zmizí z Keystore, návrat na párování |

### P0-4 Boundary delta

| | |
|---|---|
| **Kritérium** | tři hrany jsou přijaté, odmítnuté, nebo je změněná architektura |
| **Důkaz** | rozhodnutí integrátora + `module-boundary-ratchet` PASS |
| **Vlastník** | Integrátor |
| **Pád** | ratchet se umlčí `--write-baseline` a příště už nikdo nepozná, co přibylo |

### P0-5 S1 slovník jako produktový text

| | |
|---|---|
| **Kritérium** | devět vět prošlo produktovým čtením; změny jsou v kódu, ne v hlavě |
| **Důkaz** | commit měnící `S1_VOCABULARY` (nebo záznam, že měnit netřeba) |
| **Vlastník** | Operátor |
| **Pád** | uživatel dostane oznámení, kterému nerozumí, nebo které říká víc, než smí |

### P0-6 Druhá rozhodovací plocha (IDE) — ⚙️ **API HOTOVÉ 2026-08-19, GUI ZBÝVÁ**

`GET /api/approvals` a `POST /api/approvals/:id/decide` běží na desktopovém
serveru nad **toutéž** tabulkou a **toutéž** autoritou jako mobil: otisk je
povinný, nevázaný approval nejde rozhodnout, propadlý taky ne, a první odpověď
vítězí (druhá plocha dostane tu první, ne chybu). Deset testů, včetně toho, že
běh čekající na odpověď ji dostane i bez telefonu.

Co zbývá: **obrazovka v IDE.** API je plocha, ne uživatelské rozhraní — dokud
nad ním nic není, rozhoduje se `curl`em.

| | |
|---|---|
| **Kritérium** | approval z `mobile_approvals` jde rozhodnout i z počítače, se stejnou autoritou a stejným ověřením otisku |
| **Důkaz** | test: approval vytvořený producentem se rozhodne bez telefonu; a druhý, že rozhodnutí z obou ploch je idempotentní |
| **Vlastník** | Implementátor |
| **Pád** | agent se zeptá, telefon není po ruce, a práce stojí — protože jiná cesta neexistuje |

Zadání operátora: *„telefon nesmí být jedinou možností"*. Dnes na tuhle tabulku
nesahá nic mimo mobilní cestu, takže tenhle pád je reálný, ne teoretický.

### P0-7 Chování s víc zařízeními

| | |
|---|---|
| **Kritérium** | popsané a otestované: kdo rozhodl, co vidí druhý telefon, jak se chovají receipty |
| **Důkaz** | test se dvěma `deviceId` nad jednou frontou; dokument v `DATA-MODEL` nebo zde |
| **Pád** | druhý telefon ukáže „nic nečeká" nad approvalem, který právě vyprší; nebo naopak nabídne rozhodnout něco už rozhodnutého |

Dnešní stav: `decideApproval` je idempotentní a receipty jsou per-device
(`DR-012 A`, migrace 058), takže základ drží. Chybí **popis** a test.

---

## 3. P1 — interní pilot

### P1-1 Reprodukovatelný build

| | |
|---|---|
| **Kritérium** | z čistého klonu vznikne APK se stejným `applicationId`, `versionCode` a signerem; postup je zapsaný |
| **Důkaz** | build z `git clone` do prázdného adresáře, log s verzemi JDK/SDK/Gradle |
| **Pád** | „u mě to jde" — a release se nedá zopakovat, až bude potřeba hotfix |

**Bit-shodné APK to nebude** a nemá se to slibovat: zip nese časová razítka.
Kontroluje se **podpis a obsah**; SHA-256 v manifestu identifikuje konkrétní
artefakt, ale netvrdí bitovou reprodukovatelnost. Checkout od MM6-A vyžaduje JDK 21,
Android SDK 36, Gradle 8.14.3 přes wrapper a pinovaný Capacitor 8.4.3. Na
aktuálním hostu JDK ani Android SDK nejsou, proto zatím existuje statický důkaz,
ne clean-clone binární důkaz.

Verze má jedinou trackovanou autoritu `mobile-app/release.json`. Schéma
`major*1000000 + minor*1000 + patch` dává verzi `0.1.0` kód `1000`, takže je
vyšší než historický prototyp s kódem 1. Každý distribuovaný upgrade musí změnit
`versionName` i odvozený monotónní `versionCode` v tomto souboru.

### P1-2 Podpis a klíč

| | |
|---|---|
| **Kritérium** | oddělený interní a release flavor; klíč mimo repo, se zálohou a popsaným vlastnictvím; rotace nacvičená |
| **Důkaz** | `apksigner verify --print-certs` u obou variant + záznam o uložení klíče |
| **Pád** | ztráta klíče = žádný upgrade existující instalace, jen odinstalace a nové párování |

> **Co se stane při výměně klíče:** Android odmítne upgrade APK podepsaného
> jiným klíčem. Uživatel musí aplikaci odinstalovat, čímž **přijde o obsah
> Keystore trezoru** a musí se znovu spárovat. Rotace klíče proto není jen
> provozní úkon — je to hromadné re-pairing všech pilotních zařízení a patří
> do plánu, ne do překvapení.

Dnes: release **selže**, když klíč chybí (fail-closed);
`-PallowDebugSigning=true` je vědomý únik pro jednorázový build.

### P1-3 Revokace a ztracené zařízení

| | |
|---|---|
| **Kritérium** | desktop zruší token okamžitě; aplikace to při prvním pokusu zjistí a lokálně smaže credential |
| **Důkaz** | test: revokace → další request 401 → klient vyčistí trezor a jde na párování |
| **Vlastník** | Operátor (proces), Implementátor (kód) |
| **Pád** | ztracený telefon zůstane platným čtenářem, dokud nevyprší token |

Stav MM4-D: `IMPLEMENTED AND SOURCE TESTED; DEVICE EXECUTION NOT RUN`.
Scope-gated mobilní seznam a revoke prošly 8/8 gateway a 11/11 klientskými
scénáři. Server commitne self-revocation a její výsledek atomicky; klient po
potvrzení maže credential z nativního vaultu. Desktopová administrátorská
obrazovka, fyzický lost-device průchod a nezávislá bezpečnostní akceptace však
zůstávají otevřené. Viz
[MM4-D review](reviews/MM4D-PAIRED-DEVICES.md).

Hranice, kterou je nutné vyslovit nahlas (a je už v `DATA-MODEL` §5.3):
**revokace zabrání novému přístupu, nesmaže, co už v telefonu je.** Proti
útočníkovi, který telefon nepřipojí k síti, neexistuje remote wipe. Jediná
obrana, která funguje po ztrátě, je minimalizace cache (`P-1`).

### P1-3a Revizní zápis nastavení

Stav MM4-E: `IMPLEMENTED AND SOURCE TESTED; DEVICE EXECUTION NOT RUN`.
`PUT /m1/settings` zapisuje jednu z 11 validovaných UX preferencí pouze nad
přesnou serverovou revizí. `write:settings` je pairable, ale není ve výchozím
profilu; konflikt se znovu načte a nikdy se automaticky nepřepisuje. Výsledek
operace a samotné nastavení nejsou v jedné transakci, takže selhání zápisu
výsledku po commitu zůstává pravdivě `UNKNOWN` v MS-20. Obecný settings editor,
security/model authority, fyzický WebView průchod a v2 refreeze se netvrdí. Viz
[MM4-E review](reviews/MM4E-REVISIONED-SETTINGS-WRITE.md).

### P1-3b Create-only uchovávaná informace

Stav MM4-F: `IMPLEMENTED AND SOURCE TESTED; DEVICE EXECUTION NOT RUN`.
`POST /m1/memory` smí atomicky vložit jen nový explicitní LTM klíč v jedné ze
čtyř veřejných kategorií. `write:memory` je pairable, ale není ve výchozím
profilu. Existující klíč se nikdy nepřepíše; smazání, task memory a interní
kategorie nejsou touto autoritou dosažitelné. Serverový operation fingerprint
váže i hodnotu, klientský lokální journal však uchovává jen obecný popis bez
klíče a hodnoty. Selhání po možném efektu je `UNKNOWN`, nikdy automatický retry.
Fyzický WebView průchod a nezávislé security review zůstávají otevřené. Viz
[MM4-F review](reviews/MM4F-CREATE-ONLY-MEMORY.md).

### P1-3c Precondition-checked stav agenta

Stav MM4-G: `IMPLEMENTED AND SOURCE TESTED; DEVICE EXECUTION NOT RUN`.
`PUT /m1/workers/:id/enabled` smí změnit pouze boolean `enabled` a jen pokud
odpovídá stav, který telefon právě živě načetl. `write:workers` je pairable,
ale není ve výchozím profilu; UI navíc vyžaduje `read:workers`, čerstvý serverový
stav a dvoukrokové potvrzení. Gateway nemění worker tabulky přímo: pevně
deleguje existující legacy `AgentRepository` + `AgentScheduler` autoritě.
Konflikt nic nepřepíše, nejednoznačný výsledek je `UNKNOWN` a nikdy se
automaticky neopakuje. Vypnutí zastaví budoucí plánované běhy, ale neruší už
běžící práci. Specialist mutation, create/edit/run/dry-run, fyzický WebView
průchod a nezávislé security review zůstávají otevřené. Viz
[MM4-G review](reviews/MM4G-WORKER-STATE.md).

### P1-3d Detail agenta a terminální historie

Stav MM4-H: `IMPLEMENTED AND SOURCE TESTED; DEVICE EXECUTION NOT RUN`.
`GET /m1/workers/:id/runs` používá `read:workers` a vrací samostatný detail
workera plus nejnovější stránku ukončených běhů. Kurzor je neprůhledný, svázaný
s workerem a směrem do minulosti. Mobil dostane jen id, terminální stav, čas
startu/dokončení a počty akcí a triggerů; `running`, logy, chybové texty,
explain payloady, identity triggerů, definition/state/params ani run commands
nejsou součástí projekce. Historie není perzistentní offline cache. 15/15
gateway/core a 15/15 UI scénářů prošlo, fyzický WebView průchod nikoli. Viz
[MM4-H review](reviews/MM4H-WORKER-RUN-HISTORY.md).

### P1-3e Detail balíčku specialisty a expertiz

Stav MM4-I: `IMPLEMENTED AND SOURCE TESTED; DEVICE EXECUTION NOT RUN`.
`GET /m1/specialists/:id` vyžaduje `read:specialists` a vrací pouze veřejná
perzistovaná metadata balíčku a uspořádané vazby expertiz z jedné read
transakce. Detail je live-only, má `Cache-Control: no-store` a scope/session
invalidation. Manifest, prompty, nástroje, filesystem, integrita, živá runtime
registrace, telemetry, specialist memory a všechny mutation operace jsou mimo
povrch. Kombinované worker/specialist sady prošly 18/18 backend a 18/18 UI
scénáři. Zdrojová evidence a non-claims:
[MM4-I review](reviews/MM4I-SPECIALIST-DETAIL.md).

### P1-3f Read-only konverzace projektu

Stav MM3-C: `IMPLEMENTED AND SOURCE TESTED; DEVICE EXECUTION NOT RUN`.
Existující `GET /m1/conversations` přijímá uzavřený `projectId` filtr pouze s
`read:chat` i `read:projects`. Core provider filtruje členství a smazané řádky,
gateway izoluje cursor pro každý projekt a klient drží výsledek jen v paměti s
request/response `no-store`. Detail rozlišuje loading, chybu, prázdno a
scope-lock a otevírá existující chat. 11/11 gateway/core a 17/17 UI scénářů
prošlo. Žádná project/chat mutation, search, run progress, fyzický WebView
průchod ani security acceptance se tím netvrdí. Viz
[MM3-C review](reviews/MM3C-PROJECT-CONVERSATIONS.md).

### P1-3g Úplný globální seznam konverzací

Stav MM3-D: `IMPLEMENTED AND SOURCE TESTED; DEVICE EXECUTION NOT RUN`.
Globální `GET /m1/conversations` už na klientovi nekončí prvními 50 řádky.
UI zobrazuje potvrzenou partial boundary a vrací pouze opaque cursor vydaný
serverem. Exact DTO, duplicita, překryv i pozdní stará odpověď selžou bez
přepsání potvrzeného okna. S1 cache ukládá validované `{ items, page }`, umí
přečíst starý array-only formát bez fabrikace cursoru a celá se maže při ztrátě
`read:chat`. Klientská sada prošla 25/25; route, provider a scope se neměnily.
Search, mutation, fyzický WebView průchod ani release acceptance se tím
netvrdí. Viz
[MM3-D review](reviews/MM3D-CONVERSATION-LIST-PAGINATION.md).

### P1-3h Úplné filtry projektů

Stav MM3-E: `IMPLEMENTED AND SOURCE TESTED; DEVICE EXECUTION NOT RUN`.
Aktivní a archivované projekty už na klientovi nekončí první stovkou. Každý
filtr vrací pouze svůj opaque cursor, response i řádky musí nést správný stav a
duplicate, overlap nebo pozdní odpověď předchozího filtru potvrzené okno
nezmění. Oba S1 filtry mají oddělený validovaný `{ items, page }` snapshot a
starý array-only formát nevyrábí cursor. Backend prošel 11/11 a klient 23/23;
route, provider ani scope se neměnily. Project mutation, fyzický WebView
průchod ani release acceptance se tím netvrdí. Viz
[MM3-E review](reviews/MM3E-PROJECT-LIST-PAGINATION.md).

### P1-4 Push, nebo přiznané pull-only

| | |
|---|---|
| **Kritérium** | buď push s consentem, outbound policy, scope, retry a auditem — nebo produkt **říká**, že spící aplikace nic nedostane |
| **Důkaz** | policy dokument + implementace, nebo věta v UI a v popisu produktu |
| **Pád** | pětiminutové okno approvalu vyprší dřív, než uživatel aplikaci otevře; „companion" nikoho nedoprovází |

Tohle je nejpodceňovanější položka celého seznamu. Bez pushe je hodnota
approvalů omezená na „mám telefon zrovna v ruce".

### P1-5 Datová hranice

| | |
|---|---|
| **Kritérium** | rozhodnuto, co je šifrované v klidu (WebView cache, `localStorage`, žurnál), jak dlouho žije a co maže logout |
| **Důkaz** | rozhodnutí + test, že logout maže, co má |
| **Pád** | S2 obsah přežije odhlášení v cache WebView, kterou nikdo nesmazal |

Dnes: credential, identita zařízení, PIN verifier a čítač pokusů jsou ve
verzovaných AES-GCM obálkách pod neexportovatelným AndroidKeyStore klíčem.
Náhodné IV generuje provider, identita záznamu je AAD a logické skupiny se
commitují atomicky. Nativní shell se při chybě nikdy nevrací do
`localStorage`; párování je zablokované ještě před odesláním jednorázového
kódu. **Cache klienta ale šifrovaná není.** `P-3` (`ST-DB` chráněná klíčem z
`ST-SECURE`) zůstává návrh. Detail a non-claims:
[MM5-B review](reviews/MM5B-DIRECT-ANDROID-KEYSTORE.md).

### P1-6 Accessibility a device matice

| | |
|---|---|
| **Kritérium** | 200 % písmo, TalkBack, kontrast, focus order, malý displej, rotace, měkká klávesnice |
| **Důkaz** | `mobile-browser-a11y` PASS (dnes **22/22** v Chromiu, ale v gate withheld) + ruční průchod na telefonu s TalkBackem |
| **Podmínka započtení** | sada je v registru `BLOCKED`; aby ji gate počítal, musí ji implementátor přeřadit na `ACTIVE` a Chromium se tím stane povinnou prerekvizitou gate (≈150 MB při setupu). Do té doby je to důkaz, ne gate |
| **Pád** | aplikace je nepoužitelná pro část lidí. Automatická sada pokrývá kontrast, focus order, ohlášení čtečce a růst se 200 % písmem; **nepokrývá** TalkBack na zařízení a fyzickou AT matici |

### P1-7 Supply chain

| | |
|---|---|
| **Kritérium** | dependency audit bez neošetřených nálezů, podporované verze, SBOM |
| **Důkaz** | výstup auditu + seznam přijatých rizik |
| **Pád** | nepodporovaný runtime nebo neřešený nález v runtime/build dependency stromu |

---

## 4. P2 — Remote Companion release

Tady se mění model útočníka: zmizí USB kabel. Do té doby platí, že **jediná
cesta k gateway je `adb reverse`** a že gateway se váže na loopback.

1. `RemoteCorePort` přijatý a implementovaný v jádře (M6), teprve pak mobilní
   release (M7).
2. Oddělený vzdálený listener, autentizované pairing, device scope, expirace,
   revokace, audit — každé s **pozitivním i negativním** testem.
3. Legacy `/api/*` a `/c3/ws` nesmí být přes vzdálenou cestu dostupné. Negativní
   test, ne tvrzení.
4. TLS a identita protistrany. `adb reverse` se dnes o důvěru nestará, protože
   žádná síť není; jakmile bude, je to první věc.
5. Verzovaný kontrakt pro projekty, konverzace, nastavení, paměť, approvaly,
   notifikace a typované runtime události, s pravdivým degraded chováním.
6. Release kandidát z čistého klonu projde fyzickou maticí, security review,
   datovým round-tripem a operátorskou demonstrací.

---

## 5. Runbooky

### 5.1 Vydat interní build

```bash
npm run mobile:android:doctor           # read-only přehled na Windows/Linux/macOS
npm run mobile:android:doctor -- --strict # failne, pokud build toolchain není celý
npm run mobile:android:keystore         # jednou pro lokální interní klíč
npm run mobile:android:build            # build + povinné ověření podpisu
```

Autoritativní cesta je `scripts/mobile-android.mjs`; shellový soubor je jen
kompatibilní delegát. CLI vyžaduje JDK 21, Android API 36 a `apksigner.jar`,
nepřijme nepodepsané APK a chybu verifikace nepřekryje. Volba
`npm run mobile:android:build -- --debug-signing` je výslovný throwaway escape,
nikoli release postup.

Úspěšný build musí vytvořit čtyři navzájem svázané výstupy pod Gradle
`app/build/outputs/`: signed APK pro device journey, signed AAB pro publikační
kanál, `release-sbom.cdx.json` a `release-manifest.json`. Manifest zaznamená
plný Git commit a dirty flag, verzi, gateway origin, cert SHA-256, verze
toolchainu, hash dependency locku a hashe/velikosti obou binárních artefaktů.
Výchozí build odmítá dirty worktree; `--allow-dirty` je pouze explicitně
označený diagnostický artefakt. Production metadata navíc zakazuje dirty i
debug-signed manifest.

Do zápisu patří: `release-manifest.json`, `versionCode`, cert SHA-256, kdo build
dělal a výsledek device/release review. Hash APK/AAB slouží k identifikaci právě
tohoto výstupu, ne jako slib reprodukovatelnosti dalšího buildu.

### 5.2 Nasadit na telefon

```bash
npm run mobile:android:reverse   # tunel; nic se nevystavuje do sítě
npm run mobile:android:run       # tunel + instalace + spuštění
```

**Bezdrátově (rozhodnutí 026):** kanonický klient je zabalený do APK. Adresa
gateway je vstup přípravy build assetu, ne adresa WebView stránky —

```bash
C3_MOBILE_APP_URL=https://companion.example.internal \
  npm run mobile:android:build
```

Přípravný krok odmítne vzdálené `http://`; cleartext je povolen pouze pro
`127.0.0.1`, `localhost` a `[::1]` při USB `adb reverse`. Vzdálený build vyžaduje
`https://` a release review identity/certifikátu protistrany.

> **Proč to není přepínač v aplikaci.** Endpoint je podepsaná build konfigurace,
> ne uživatelská preference. `CapacitorHttp` převádí klientské `fetch` na nativní
> transport; klient zůstává lokální a neztrácí pluginový most. Změna endpointu
> proto vyžaduje nový artefakt a nové ověření transportní identity.

Po instalaci vždy zkontrolovat v Nastavení: *Úložiště přihlášení* musí říkat
**Android Keystore** a *Zámek aplikace* **zámek telefonu**. Když říká něco
jiného, telefon nemá zámek obrazovky — a to je nález, ne detail.

### 5.3 Revokovat ztracené zařízení

1. Na jiném spárovaném telefonu se scopes `read:devices,write:devices` otevřít
   **Nastavení → Spárovaná zařízení**, vybrat přesný cíl a potvrdit odvolání.
   Nízkoúrovňová desktopová cesta `revokeDevice` zůstává operátorská alternativa.
2. Ověřit, že další request z odvolaného telefonu dostane 401
   `token_revoked`; jakmile ji aplikace přijme, musí vyčistit i nativní vault.
3. Zapsat, kdy k tomu došlo — okno mezi ztrátou a revokací je to, co útočníkovi
   zbylo.
4. **Nepředstírat remote wipe.** Co je v telefonu, tam zůstane.

### 5.4 Když se něco pokazí při demu

| Příznak | První kontrola |
|---|---|
| aplikace ukazuje „Gateway není dostupná" | běží gateway? je otevřený `adb reverse`? (`mobile:android:doctor`) |
| párovací skript nevydá kód | `C3_MOBILE_PAIRING=on` — bez něj skončí tiše a exit 0 |
| párování je zablokované hláškou o trezoru | nejdřív použít „Vymazat poškozený trezor“; pokud selže, přeinstalovat aplikaci; nový párovací kód vytvořit až potom |
| fronta approvalů je prázdná | běžel `mobile:demo`? má zařízení scope `read:approvals`? |
| snímek obrazovky je černý | `FLAG_SECURE`; v debug buildu `adb shell settings put global intentsmith_capture 1` |
| po odemčení je aplikace prázdná | správně: relace se po zamčení čte z trezoru znovu, ne z paměti |

---

## 6. Co tenhle handbook **nezavádí**

- Handbook sám nezavádí kontrakt. Aktuální přesný allow-list má 26 rout;
  poslední specialist-detail routu přidal MM4-I a MM3-C následně rozšířilo
  existující conversation-list query bez přidání routy. MM3-D pouze doplnilo
  klientského konzumenta jejího už existujícího cursoru a MM3-E totéž pro
  existující project-state cursory, ne tento dokument.
- Žádný termín. Termíny patří operátorovi; tady jsou jen závislosti a pořadí.
- Žádné „nice to have". Každá položka výše má popsaný způsob, jak selže —
  když ho někdo nedokáže popsat u nové položky, do seznamu nepatří.
