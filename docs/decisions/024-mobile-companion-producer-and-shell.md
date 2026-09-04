# 024 — Producenti mobilního companiona a nativní shell (prototyp)

- **typ:** implementační rozhodnutí pro prototyp; **nemění kontrakt `/m1`**
- **stav rozhodnutí:** **PŘIJATO operátorem 2026-08-19.** Strop v §5 tím
  nekončí — přijetí říká „tenhle tvar je správný", ne „spusťte producenta".
  Zapojení do reálného seamu je vázané na [025](025-approval-window-and-push.md)
  a na desktopovou plochu (viz §6)
- **WP:** prototyp mobilní aplikace (větev `wp/mobile-prototype-20260817`)
- **navazuje na:** `F-100` (producent approvalů), `DR-013 A` (S1 mirror),
  `F-111`/`F-112` (fail-closed kanál), `MR-22`/`MR-23` (úložiště a zámek)

> **Aktualizace 2026-08-18 (dřívější výhrada je vyřešená).** Konsolidační
> poznámka tu dřív říkala, že `onPause` nevymaže JS relaci ani neruší běžící
> requesty. To už neplatí: zamčení posílá do stránky `intentsmithLock`, který
> zahodí credential z paměti, zruší běžící requesty a zneplatní epochu, takže
> pozdní odpověď je inertní (7 testů v `tests/mobile-secure-credential.test.js`).
> Odemyká systémový `BiometricPrompt`. Řádek 8 tím zůstává `PARTIAL` už jen
> kvůli `EncryptedSharedPreferences` (deprecated) a chybějícímu testu na
> fyzickém telefonu. Kanonický stav je v
> [`FINAL-PROTOTYPE.md`](../mobile/FINAL-PROTOTYPE.md).

## Proč to vůbec vzniká jako rozhodnutí

`tests/mobile-approval-authority.test.js` končí testem, který **selže ve chvíli,
kdy někdo zapojí producenta approvalů, aniž by to rozhodnutí zapsal**. To byl
záměr: `createMobileApproval()` byl hotový a správný, ale nic ho nevolalo, a
zapojení emitoru rozšiřuje produkční povrch před M6 — což je release autorita,
ne rozhodnutí jednoho WP.

Tenhle dokument je ten zápis. Producent existuje, protože bez něj prototyp
nemůže ukázat ★ use case: prázdná fronta approvalů je k nerozeznání od klidné,
a to je přesně vada, kterou `F-111` popisuje na schránce.

## Co bylo rozhodnuto

| # | Rozhodnutí | Důvod |
|---|---|---|
| **1** | Producent žije v **`src/mobile/companion-producer.js`**, ne v routách | `handlers.js`, `gateway.js` a `server.js` zůstávají bez `createMobileApproval` — ratchet v testu drží dál a hlídá to, co hlídal |
| **2** | Approval se razí **výhradně** přes `createMobileApproval` | `DR-011` okno, počítaný otisk a povinná vazba jsou tím vlastností každého řádku, ne konvencí volajícího |
| **3** | S1 mirror má **uzavřený slovník** (`S1_VOCABULARY`, 9 položek) | `MD-08`: notifikace je S1 ukazatel bez obsahu. Text nejde parametrizovat — volající nemá jak obsah propašovat |
| **4** | Rozhodnutí se čeká **na řádku, ne na promise** | Gateway a jádro jsou různé procesy nad jedním SQLite. `awaitDecision()` proto vidí odpověď, kterou napsal jiný proces — tudy `F-100` uzavřít šlo, přes in-memory mapu `edit_request` ne |
| **5** | Ticho se hlásí jako ticho | `timeout` a `expired` jsou samostatné odpovědi; nikde se nemění na `approve` |
| **6** | Průběh běhu jede **stávající schránkou**, ne novou routou | `MR-07` je `BLOCKED_BY_CONTRACT`; prototyp běží na zmrazených 13 routách a nová `/m1/runs/:id/events` by je porušila |
| **7** | Nativní shell je **Capacitor nad servírovaným klientem** (`server.url`) | Klient zůstává jeden. Kdyby se assety balily do APK, vznikla by druhá kopie UI a gateway by musela otevřít CORS |
| **8** | Token jde do **Android Keystore** a zapečetí se zámkem | `MD-11` žádá `ST-SECURE` „výhradně"; prohlížeč ho nemá, proto byly `MR-22`/`MR-23` `PARTIAL`. Zámek vynucuje `LockPolicy` odmítnutím čtení, ne jen překrytím obrazovky |

## Co se tím **ne**rozhodlo

- **Nic z kontraktu v2.** Šest nových domén, `CoreEvent` v2 s diskriminovaným
  subjektem ani jedenáct otevřených nálezů se prototypu netýká.
- **Gate 0, Remote Beta, `G0-R032`.** Gateway se dál váže na loopback; cesta
  z telefonu je `adb reverse`, který nic nevystavuje.
- **Push (`N-1`).** Spící aplikace notifikaci nedostane. Schránka je pull.

## 5. Strop, dokud to operátor nepřijme

1. ~~Producent se **nespouští sám**. Volá ho jen `scripts/mobile-demo-run.js`
   a testy; v `server.js` ani v gateway pro něj není žádné zapojení.~~
   **Zrušeno operátorem 2026-08-19.** Strop splnil svůj účel a byl přijetím
   sundán: „GuardedWrite se má teď zapojit do skutečné produkční cesty."
   `server.js` producenta vyrábí a volá `configureEffects` + `setApprovalDeps`;
   §6 níž tohle přijetí předpokládá a tohle je ta chvíle. Ostatní tři body
   stropu platí beze změny.

   Zároveň byla přijata **praktická** síla slibu, ne silná:

   > Všechny zápisy uživatelských souborů prováděné IntentSmithem jdou přes
   > jednu řízenou cestu. Dva běhy IntentSmithu si nepřepíšou stejný kanonický
   > cíl. Externí změna zápis zastaví, pokud je viditelná při poslední kontrole.
   > Mikrointerval mezi kontrolou a atomickou náhradou souboru není pokrytý.

   Silná varianta (žádný externí zapisovatel nikdy nepřepíše stav) by znamenala
   mediační vrstvu pro **všechny** zapisovatele — CAS nebo verzované úložiště,
   kterým by musel projít i editor a `git checkout`. Otevře se znovu při
   reálných kolizích, na síťovém filesystemu nebo při víc nezávislých editorech.
2. `MobileChannel` zůstává fail-closed a capability drží **jen** projektor.
3. Prototypová větev se **nemerguje do M1 linie** — mění `tests/registry.json`,
   o který se opírá běžící Gate 1 evidence (stejný důvod jako u
   `wp/mobile-refresh-20260809`).
4. Podpisový klíč v `mobile-app/keys/` je **interní prototypový**, git-ignorovaný.
   Do obchodu s ním nejde nic a nesmí se zaměnit za release ceremonii.

## 6. Co by přijetí odemklo — a co do něj **nepatří**

Přijetí odemyká zapojení `requestApproval()` do reálného seamu jádra
(`fs.write` v režimu `ask`, `src/ws-bridge/session-adapter.js`).

**To zapojení ale není součástí tohohle rozhodnutí a nemá se do něj přibalit**,
protože má dva důsledky, které s mobilem nesouvisejí:

1. **Mění chování IDE.** Tamní okno je 30 s, `DR-011` žádá 5 minut. Sjednocení
   se dotkne lidí, kteří o mobilu nevědí — viz [025](025-approval-window-and-push.md),
   kde se navíc řeší, jestli má okno vůbec existovat.
2. **Chybí druhá rozhodovací plocha.** Původně tu stálo, že producent čeká celé
   okno, i když není spárovaný telefon, a že to chce pojistku „neptej se, když
   není komu". Operátor to vyřešil líp a jinak (2026-08-18):

   > „telefon nesmí být jedinou možností k approvalům… bez spárovaného telefonu
   > neexistuje jakákoli remote možnost, rozhoduje IDE z PC."

   Tím se speciální případ ruší: **approval je objekt v BE a rozhodovacích ploch
   je víc.** IDE je tam vždycky, telefon jen když je spárovaný. Běh se tedy
   neptá telefonu, ptá se člověka, a nemůže viset na odpověď, kterou nemá kdo
   dát. Podmínkou zapojení proto **není** detekce spárovaného telefonu, ale
   **existence desktopové plochy** nad toutéž tabulkou — ta dnes chybí
   (viz [025](025-approval-window-and-push.md)).

Souhrn: 024 říká „tenhle tvar je správný". Kdy a jak se agent doopravdy zeptá,
řeší [025](025-approval-window-and-push.md) a [026](026-wireless-gateway-access.md).
