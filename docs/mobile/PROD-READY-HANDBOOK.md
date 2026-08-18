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

### P0-1 Rozhodnout 024

| | |
|---|---|
| **Kritérium** | `docs/decisions/024` má stav PŘIJATO nebo ODMÍTNUTO, s datem a jménem |
| **Důkaz** | commit, který mění hlavičku rozhodnutí; nic víc |
| **Vlastník** | Operátor |
| **Pád** | producent zůstane demo-only a všechno pod ním je stavba na neuzavřeném rozhodnutí |

Rozhoduje se **pět věcí najednou**, a je poctivé je vypsat, protože „přijímám
024" jinak znamená pro každého něco jiného: (1) producent smí razit approvaly,
(2) devět vět S1 slovníku je text, který uživatel uvidí, (3) čekání na řádku je
přijatelný mechanismus napříč procesy, (4) `adb reverse` je pro prototyp
dostatečná cesta, (5) `EncryptedSharedPreferences` + systémový zámek jsou
přijatelná hranice **pro interní použití**.

### P0-2 Skutečný effect seam

| | |
|---|---|
| **Kritérium** | `requestApproval()` volá reálná cesta jádra před skutečným efektem; demo skript přestane být jediným volajícím |
| **Důkaz** | test, který spustí reálnou cestu, zamítne approval a **ověří, že efekt nenastal**; a druhý, který ho schválí a ověří, že nastal právě jednou |
| **Vlastník** | Implementátor; přijetí Operátor |
| **Pád** | agent provede efekt bez svolení, nebo ho po schválení provede dvakrát |

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

Matice (každý řádek = pozorování, ne dojem):

| # | Scénář | Co musí platit |
|---|---|---|
| 1 | instalace a první spuštění | žádný prompt před spárováním |
| 2 | párování QR i vložením kódu | kód je jednorázový; druhé použití 409 |
| 3 | approve | efekt nastane až po ťuknutí |
| 4 | reject | efekt nenastane a běh to řekne |
| 5 | expire (nechat doběhnout okno) | běh skončí bez efektu, telefon ukáže propadnutí |
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

### P0-6 Chování s víc zařízeními

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
Kontroluje se **podpis a obsah**, ne hash. Dnešní toolchain: JDK 17
(`~/toolchain/jdk17`), Android SDK 34/35 (`~/toolchain/android-sdk`), Gradle
přes wrapper, Capacitor 6.

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

Dnes: credential je v Keystore, **cache klienta ne**. `P-3` (`ST-DB` chráněná
klíčem z `ST-SECURE`) je stále jen návrh.

### P1-6 Accessibility a device matice

| | |
|---|---|
| **Kritérium** | 200 % písmo, TalkBack, kontrast, focus order, malý displej, rotace, měkká klávesnice |
| **Důkaz** | `mobile-browser-a11y` PASS (dnes BLOCKED — chybí Chromium) + ruční průchod na telefonu |
| **Pád** | aplikace je nepoužitelná pro část lidí; u 200 % písma dnes **víme**, že se nic nezvětší |

### P1-7 Supply chain

| | |
|---|---|
| **Kritérium** | dependency audit bez neošetřených nálezů, podporované verze, SBOM |
| **Důkaz** | výstup auditu + seznam přijatých rizik |
| **Pád** | end-of-support runtime (dnes Capacitor 6) bez bezpečnostních záplat |

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
npm run mobile:android:doctor          # co stojí a co ne
npm run mobile:android:keystore        # jednou za život klíče
npm run mobile:android:build           # selže, pokud klíč chybí — to je záměr
"$ANDROID_HOME"/build-tools/*/apksigner verify --print-certs \
  mobile-app/android/app/build/outputs/apk/release/app-release.apk
```

Do zápisu patří: commit, `versionCode`, cert SHA-256, kdo build dělal. **Ne
hash APK** — ten se mění při každém buildu a jeho zapsání vytváří dojem
reprodukovatelnosti, který neexistuje.

### 5.2 Nasadit na telefon

```bash
npm run mobile:android:reverse   # tunel; nic se nevystavuje do sítě
npm run mobile:android:run       # tunel + instalace + spuštění
```

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
