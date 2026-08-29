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

### Aktuální klientský snapshot (2026-08-27)

Kandidát na větvi `codex/mobile-prod-client-20260826` uzavřel lokálně
řešitelné shell/client části: Capacitor 8.5.0, API 36, JDK 21, zabalené UI bez
`server.url`, přímý AndroidKeyStore AES-GCM pro credential i doménová data,
retention/wipe, AAB, R8, accessibility gate a release evidence se SBOM.

Verdikt je `CLIENT_P1_IMPLEMENTATION_GREEN / REMOTE_CORE_CONSUMER_PINNED /
RELEASE_TRANSPORT_BLOCKED / REVIEW_PENDING`. Fyzická zařízení, production
signing/distribuce, plný RemoteCore capability set, M7
listener/pairing/revokace/audit a nezávislé review nejsou touto implementací
nahrazené. Přesný aktuální stav a handoff jsou v
[FINAL-PROTOTYPE.md](FINAL-PROTOTYPE.md); níže zůstávají obecná akceptační
kritéria a runbooky.

Exact operation/payload požadavek pro chybějící provider práci je v
[REMOTE-CAPABILITY-CONTRACT-V1-CANDIDATE.md](REMOTE-CAPABILITY-CONTRACT-V1-CANDIDATE.md).
Spustitelný provider balík, digesty a acceptance matrix jsou v
[CORE-M7-CAPABILITY-HANDOFF.md](CORE-M7-CAPABILITY-HANDOFF.md). Stav je
`SCHEMA_COMPLETE_CANDIDATE / CANDIDATE_NOT_ACCEPTED / NO_BACKEND_AUTHORITY`,
takže odstraňuje nejasnost handoffu, nikoli samotný M7/BE blocker.

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
dostatečná cesta, (5) `EncryptedSharedPreferences` + systémový zámek jsou
přijatelná hranice **pro interní použití**.

### P0-2 Skutečný effect seam — ✅ **ZAPNUTO** (2026-08-19), rozsah `FILE_WRITE` + `fs.write` + patch engine

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
| 13 | odebrání a obnovení zámku obrazovky | bez zámku zůstane credential zapečetěný; obnovení vrátí systémovou unlock cestu |
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
Kontroluje se **podpis, obsah a vstupní commit**, ne shoda hashů mezi buildy.
Kandidátní toolchain: JDK 21, Android SDK/target 36, Gradle 8.14.3 přes wrapper,
AGP 8.13 a Capacitor 8.5.0. Current-host throwaway build prošel; čistý checkout
s throwaway debug signerem také prošel a jeho manifest váže APK/AAB na přesný
source commit. Čistý checkout se skutečným candidate signerem a připnutým
fingerprintem zůstává přijímací branou.

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

Hranice, kterou je nutné vyslovit nahlas (a je už v `DATA-MODEL` §5.3):
**revokace zabrání novému přístupu, nesmaže, co už v telefonu je.** Proti
útočníkovi, který telefon nepřipojí k síti, neexistuje remote wipe. Jediná
obrana, která funguje po ztrátě, je minimalizace cache (`P-1`).

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

Dnes na Android kandidátovi: credential, cache, journal i drafty jsou v
přímém AndroidKeyStore AES-GCM store. Cache žije 15 minut, dokončený journal
24 hodin, otevřený `PENDING/UNKNOWN` bez časového výmazu a draft 30 dní.
Změna identity, revokace a logout data mažou fail-closed. Browser/PWA zůstává
vývojová plocha s browser storage a není produkční security boundary.

### P1-6 Accessibility a device matice

| | |
|---|---|
| **Kritérium** | 200 % písmo, TalkBack, kontrast, focus order, malý displej, rotace, měkká klávesnice |
| **Důkaz** | `mobile-browser-a11y` **22/22 PASS** a v registru `ACTIVE` + ruční průchod na telefonu s TalkBackem |
| **Podmínka započtení** | Chromium se instaluje root `npm ci` a je povinnou prerekvizitou mobilní gate; fyzický TalkBack zůstává `NOT RUN` |
| **Pád** | aplikace je nepoužitelná pro část lidí. Automatická sada pokrývá kontrast, focus order, ohlášení čtečce a růst se 200 % písmem; **nepokrývá** TalkBack na zařízení a fyzickou AT matici |

### P1-7 Supply chain

| | |
|---|---|
| **Kritérium** | dependency audit bez neošetřených nálezů, podporované verze, SBOM |
| **Důkaz** | výstup auditu + seznam přijatých rizik |
| **Pád** | nepodporovaný runtime nebo známá zranitelnost bez opravy/přijatého rizika |

Aktuální klient: Capacitor 8.5.0, runtime audit 0 a generovaný CycloneDX SBOM.
Plný mobile development strom má 3 moderate dev-only nálezy v Capacitor CLI
řetězci. Root/shared strom má 15 nálezů včetně jednoho critical; to je otevřená
projektová release brána mimo mobile-only WP, ne důvod přepsat klientský runtime
audit na FAIL ani celkový release na PASS.

---

## 4. P2 — Remote Companion release

Tady se mění model útočníka: zmizí USB kabel. Do té doby platí, že **jediná
cesta k gateway je `adb reverse`** a že gateway se váže na loopback.

1. M2 `RemoteCorePort@1` je zmražený a M5 in-process adapter review-passed;
   klient pinuje jejich digesty. M7 musí doplnit celý mobilní operation set a
   fyzický transport, teprve pak může vzniknout mobilní release.
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
npm run mobile:android:doctor          # co stojí a co ne
npm run mobile:android:keystore        # jednou za život klíče
npm run mobile:android:build           # selže, pokud klíč chybí — to je záměr
npm run mobile:android:evidence -- \
  --expected-signer-sha256 <64-hex>    # připne signer; zapíše SBOM/audit/podpis
```

Do zápisu patří: commit, `versionCode`, cert SHA-256, hash konkrétního APK/AAB,
SBOM a kdo build dělal. Hash identifikuje konkrétní artefakt; nesmí se vydávat
za slib bitové shody dalšího sestavení.

### 5.2 Nasadit na telefon

```bash
npm run mobile:android:reverse   # tunel; nic se nevystavuje do sítě
npm run mobile:android:run       # tunel + instalace + spuštění
```

**Vzdálený development/pilot build:** adresa gateway je generovaný runtime
asset uvnitř artefaktu, ne `server.url` a ne vzdáleně servírovaný klient —

```bash
C3_MOBILE_APP_URL=https://mobile-gateway.example.internal \
  npm run mobile:android:build
```

Nešifrovaný provoz mimo loopback build bez explicitní vědomé výjimky odmítne.
Production origin a jeho TLS identita smějí vzniknout až z přijatého M7
listener/pairing kontraktu.

> **Proč to není `server.url`.** Native bridge zůstává jen v lokálně zabaleném
> a podepsaném klientovi. Vzdálená gateway poskytuje data, nikoli JavaScript,
> který by získal přístup k vault bridge.

Po instalaci vždy zkontrolovat v Nastavení: *Úložiště přihlášení* musí říkat
**Android Keystore** a *Zámek aplikace* **zámek telefonu**. Když říká něco
jiného, telefon nemá zámek obrazovky — a to je nález, ne detail.

### 5.3 Revokovat ztracené zařízení

1. Na desktopu zrušit token zařízení (`revokeDevice`).
2. Ověřit, že další request z telefonu dostane 401.
3. Zapsat, kdy k tomu došlo — okno mezi ztrátou a revokací je to, co útočníkovi
   zbylo.
4. **Nepředstírat remote wipe.** Co je v telefonu, tam zůstane.

### 5.4 Když se něco pokazí při demu

| Příznak | První kontrola |
|---|---|
| aplikace ukazuje „Gateway není dostupná" | běží gateway? je otevřený `adb reverse`? (`mobile:android:doctor`) |
| párovací skript nevydá kód | `C3_MOBILE_PAIRING=on` — bez něj skončí tiše a exit 0 |
| fronta approvalů je prázdná | běžel `mobile:demo`? má zařízení scope `read:approvals`? |
| snímek obrazovky je černý | `FLAG_SECURE`; v debug buildu `adb shell settings put global intentsmith_capture 1` |
| po odemčení je aplikace prázdná | správně: relace se po zamčení čte z trezoru znovu, ne z paměti |

---

## 6. Co tenhle handbook **nezavádí**

- Žádný nový kontrakt, routu ani tabulku. Prototyp běží na zmrazených 13
  routách a tenhle dokument to nemění.
- Žádný termín. Termíny patří operátorovi; tady jsou jen závislosti a pořadí.
- Žádné „nice to have". Každá položka výše má popsaný způsob, jak selže —
  když ho někdo nedokáže popsat u nové položky, do seznamu nepatří.
