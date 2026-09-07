# Jak si mobilní aplikaci zkusit — i bez backendu

Praktický runbook pro kanonickou aplikaci na větvi
`mobile/master-prod-ready`. Aktuální stav, cesta k APK, důkazy a prod-ready
mezery jsou výhradně v [FINAL-PROTOTYPE.md](FINAL-PROTOTYPE.md).

Tento návod obslouží stejný klient ve webovém prohlížeči i v Android shellu.

**Od 2026-08-19 už není potřeba demo.** Zápis uživatelských souborů jde přes
řízenou cestu, takže si o approval řekne **skutečný běh**: napiš do chatu něco
jako „ulož to do poznamka.md" a fronta se naplní sama. Demo (`npm run
mobile:demo`) zůstává jako rychlý způsob, jak si frontu naplnit bez psaní.

---

## Co jde bez běžícího IntentSmithu a co ne

Gateway je **samostatný proces**. Čte konverzace přímo ze SQLite a **sám servíruje
i webového klienta**, takže na čtení žádný backend nepotřebuje. Legacy server
(`C3_URL`, výchozí `127.0.0.1:3335`) je potřeba jen na **odeslání zprávy**.

| Funkce | Bez backendu |
|---|---|
| Párování zařízení | ✅ |
| Seznam konverzací, čtení historie, stránkování (`MR-05`) | ✅ |
| Projekty, detail a živé přiřazené konverzace (`MM3-C`) | ✅ — read-only; drill-down vyžaduje `read:projects` i `read:chat` a není offline cache |
| Přehled, trust bar, stavy cache, zamčení podle scope | ✅ |
| Žurnál operací, obrazovka rozřešení (`MS-20`) | ✅ |
| Seznam a odvolání spárovaných zařízení (`MS-04`) | ✅ — odvolání blokuje další requesty, není remote wipe |
| Veřejné nastavení a zápis 11 UX preferencí (`MS-10`/`MS-11`) | ✅ — vyžaduje explicitní `write:settings`, legacy backend proces ne |
| Uchovávané informace a vytvoření explicitní LTM položky (`MS-12`) | ✅ — vyžaduje explicitní `write:memory`; náhrada ani mazání nejsou dostupné |
| Seznam a detail agentů/specialistů, terminální historie agenta | ✅ — filtrované čtení ze sdílené SQLite; historie je metadata-only, detail specialisty ukazuje jen veřejný balíček a vazby expertiz |
| **Zapnout nebo vypnout agenta** | ❌ — změna je záměrně delegovaná živému legacy serveru, který vlastní scheduler |
| **Odeslat zprávu** | ❌ — `upstream: unreachable`, aplikace to řekne rovnou |
| Approvaly s reálným obsahem | ✅ — produkční cesta je zapojená (`server.js`), takže je vyrobí skutečný zápis. Gateway je ale jen čte; **vyrábí** je backend, takže bez něj se nová otázka neobjeví |
| Schránka s ukazateli běhu | ✅ pro durable S1 řádky — exact pull, sequence pagination a per-device ACK; bez push a bez přijaté obecné production event-selection/delivery policy |

Neběžící backend se **nemaskuje**: `GET /m1/health` vrací
`upstream: "unreachable"` s důvodem a composer se zamkne s vysvětlením. To je
záměr, ne rozbitý stav — nefunkční odeslání se nesmí tvářit jako odeslané.

---

## Rozhodnout se dá i z desktopu

Telefon není jediná možnost (`P0-6`). Backend servíruje rozhodovací plochu na

```
http://127.0.0.1:3335/approvals-ui
```

Je to tatáž fronta a tatáž autorita jako na telefonu — první odpověď vítězí a
druhá plocha se dozví, jak to dopadlo. V chatu (`/chat-ui`) se navíc v postranní
liště objeví, kolik rozhodnutí čeká.

## Postup

```bash
cd /home/belphareon/worktrees/is-mobile-prototype
npm ci --offline
npm --prefix mobile-app ci --offline

# 1. Demo databáze — nikdy ne ta ostrá; skript to odmítne.
npm run mobile:seed -- --db /tmp/is-demo.db

# 2. Gateway (v jednom terminálu)
C3_DB_PATH=/tmp/is-demo.db C3_MOBILE_PAIRING=on node src/mobile-gateway.js

# 3. Párovací QR (v druhém terminálu). Approval scopes jsou pro demo povinné.
#    C3_MOBILE_PAIRING=on tu musí být znovu: kill switch se čte v každém
#    procesu, takže bez něj skript kód nevydá — a skončí exit 0, takže je to
#    ticho, ne chyba.
C3_DB_PATH=/tmp/is-demo.db C3_MOBILE_PAIRING=on node scripts/mobile-pair.js \
  --scopes read:capabilities,read:chat,write:chat,read:notifications,write:notifications,read:approvals,write:approvals,read:projects,read:settings,write:settings,read:memory,write:memory,read:workers,write:workers,read:specialists,read:devices,write:devices

# 4. Volitelně: běh, který se zeptá na approval a čeká na odpověď
node scripts/mobile-demo-run.js --db /tmp/is-demo.db
```

Approvaly **nejsou ve výchozích scopech**. Příkaz výše je proto žádá
explicitně. `write:settings`, `write:memory` i `write:workers` jsou rovněž
pairable, ale záměrně nejsou výchozí;
rozšíření existujícího tokenu není možné a vyžaduje nový jednorázový kód.
Nejmenší dostatečný scope je záměr (`P-8`), ne opomenutí.

V prohlížeči pak otevři `http://127.0.0.1:3336` a vlož kód. V Android aplikaci
nejdřív proveď USB postup v další sekci a kód vlož tam. Kód je
**jednorázový** — po použití je spotřebovaný a další běh `mobile-pair.js` vydá
nový.

Seed vytvoří tři konverzace záměrně: **240 zpráv**, 8 zpráv a prázdnou.

> **Pozor na slovo „stránka".** Neznamená obrazovku. Aplikace si od serveru
> nebere celou historii najednou, ale **po dávkách po 50 zprávách**; téhle dávce
> se v dokumentaci říká stránka. Na obrazovku se vejdou tak tři až pět zpráv
> a scrolluje se úplně normálně.
>
> Konverzace o 240 zprávách = 5 dávek, takže si vynutí donačítání. Ta o 8
> zprávách se vejde do jedné dávky a je hned celá. Demo, kde by každá konverzace
> byla na jednu dávku, by o donačítání nedokázalo nic.

---

## Android aplikace přes USB

Kanonický prototyp používá jen `adb reverse`: Android otevře svůj
`127.0.0.1:3336` a USB kabelem jej přivede ke gateway na počítači. Gateway se
dál váže jen na loopback; žádný port se neotevře do Wi-Fi.

```text
# Jen kontrola, nic nemění
npm run mobile:android:doctor

# Jednou, pokud ještě neexistuje interní prototypový klíč
npm run mobile:android:keystore

# Build, adb reverse, instalace a spuštění
npm run mobile:android:build
npm run mobile:android:run
```

Tyto npm příkazy používají stejný Node CLI na Windows, Linuxu i macOS; Bash není
prerekvizita. `build` sám povinně ověří signer výsledného APK. Příkaz `run`
vyžaduje připojený a autorizovaný Android device nebo emulátor. Interní klíč ani
výsledné APK nejsou production release signing. Vzdálený listener,
Tailscale/VPN a `C3_MOBILE_ALLOW_REMOTE` nejsou podporovaná cesta tohoto
prototypu.

Nativní shell ukládá credential pouze do přímého AES-GCM trezoru pod
`AndroidKeyStore`; do `localStorage` nesmí propadnout ani při chybě. Když
párovací obrazovka hlásí nedostupný trezor, párovací tlačítko je záměrně
vypnuté. Nejdřív použij **Vymazat poškozený trezor** (nebo aplikaci
přeinstaluj) a teprve potom na desktopu vygeneruj nový jednorázový kód.

---

## Co si při zkoušení všímat

`MR-05` je nové, takže tohle je to zajímavé:

1. Otevři **Dlouhou konverzaci** — musí naskočit na **nejnovější** zprávě, ne na
   začátku historie.
2. **Scrolluj nahoru** — starší zprávy se dotáhnou samy, jako v jakémkoli chatu.
   Pozice čtení se přitom nesmí hnout.
3. Scrolluj až na úplný začátek — musí se objevit **„Začátek konverzace"**, ne
   nekonečné donačítání.
4. U **Krátké konverzace** musí být „Začátek konverzace" hned; nesmí nabízet
   načtení něčeho, co neexistuje.
5. Vypni gateway a scrolluj dál — okraj okna musí říct **„Starší zprávy vyžadují
   připojení"**, nikdy nesmí utnout historii mlčky.

Správu zařízení zkontroluj v **Nastavení → Spárovaná zařízení**:

1. aktuální telefon musí být označený „toto zařízení" a nikde se nesmí objevit
   token ani jeho hash;
2. první ťuknutí na **Odvolat** pouze otevře potvrzení se jménem cíle;
3. text musí říct, že se zablokuje další přístup, ale data v odpojeném telefonu
   se vzdáleně nesmažou;
4. odvolání tohoto telefonu ukončí relaci a vyžádá nové párování. Pokud jsou
   otevřené operace, potvrzení předem pojmenuje ztrátu jejich lokálních klíčů.

Přesný source-tested rozsah a non-claims jsou v
[MM4-D review](reviews/MM4D-PAIRED-DEVICES.md).

Integritu seznamu zařízení (MM4-M) zkontroluj ve stejné kartě:

1. odpověď musí mít přesně jeden `current` řádek a jeho `deviceId` se musí
   shodovat s credentialem tohoto telefonu;
2. duplicate id/scope, extra pole, chybný timestamp/revoke stav, HTTP 201 nebo
   neúplná obálka musí odmítnout celý live snapshot;
3. validní cache se při výpadku smí zobrazit se stářím, ale **Odvolat** musí
   zůstat zamčené; corrupt/expired cache se musí odstranit;
4. nový read, protocol/server/offline chyba, lock, reconnect nebo scope loss
   musí odebrat potvrzení i live revoke grant;
5. ze dvou souběžných readů smí publikovat pouze nejnovější generace a transport
   musí pro device read/revoke použít `no-store`.

Exact snapshot, cache a live-authority pravidla jsou v
[MM4-M review](reviews/MM4M-PAIRED-DEVICE-LIST-INTEGRITY.md).

Integritu notifikační schránky (MM4-N) zkontroluj v **Přehled → Zprávy**:

1. s `read:notifications` bez `write:notifications` musí být historie čitelná,
   ale **Označit zobrazené přečtené** zamčené a UI musí chybějící scope říct;
2. přes 50 řádků musí vzniknout **Načíst další zprávy** a druhý request vrací
   právě serverem vydané `nextAfterSeq`; počet na přehledu ukazuje u neúplného
   okna `+`;
3. extra pole, neznámý event/text mimo closed S1 slovník, duplicate id,
   neklesající pořadí nebo chybná boundary odmítne celou stránku;
4. validní cache se smí číst se stářím, ale ACK neodemkne; legacy array musí
   přiznat neúplnost a corrupt/expired snapshot se odstraní;
5. nový read, protocol/server/offline chyba, lock, reconnect nebo scope loss
   musí live ACK grant odebrat; nejasný ACK se nesmí sám opakovat.

Exact DTO/page/cache a live-authority pravidla jsou v
[MM4-N review](reviews/MM4N-NOTIFICATION-INBOX-INTEGRITY.md).

Revizní zápis nastavení zkontroluj v **Nastavení → Nastavení backendu**:

1. bez `write:settings` jsou hodnoty jen text a karta výslovně žádá nové
   párování; s ním se zobrazí editory přesně pro 11 bezpečných UX preferencí;
2. u prázdného dokumentu musí pole říkat „nenastaveno“, ne si vymyslet default;
3. po **Uložit** se revize zvýší právě o jedna a hodnota se zobrazí až po
   potvrzení serverem;
4. změň tutéž hodnotu mezitím na desktopu: telefon musí ohlásit konflikt, načíst
   aktuální revizi a nic sám nepřepisovat;
5. odpoj spojení: editace se zamkne a rozdělaná změna se po reconnectu sama
   neodešle.

Přesný allow-list, recovery pravidla a non-claims jsou v
[MM4-E review](reviews/MM4E-REVISIONED-SETTINGS-WRITE.md).

Integritu čtení nastavení (MM4-K) zkontroluj ve stejné kartě:

1. validní live dokument smí obsahovat jen `revision`, `settings`, `version` a
   jednu ze 46 veřejných core cest;
2. přidej simulovanou private cestu, neznámý nested child, extra top-level pole,
   neplatnou revizi/verzi nebo non-finite hodnotu — celý read musí skončit jako
   protocol chyba a hodnota se nesmí vyrenderovat;
3. i se scope `write:settings` musí malformed read skrýt všechny save controls;
4. HTTP 201 nebo success bez přesné obálky se nesmí vydávat za úspěšné čtení;
5. ze dvou souběžných readů smí publikovat jen novější generace a scope
   withdrawal musí dokument ihned stáhnout;
6. ověř, že se `settings` nikdy nezapsalo pod mobilní cache key.

Exact DTO, 46-path drift ratchet a mutation relock jsou v
[MM4-K review](reviews/MM4K-PUBLIC-SETTINGS-INTEGRITY.md).

Integritu seznamu paměti (MM4-L) zkontroluj ve stejné kartě:

1. validní první stránka s `hasMore: true` musí ukázat **Načíst další
   informace** a nesmí tvrdit, že je seznam úplný;
2. další požadavek smí vrátit pouze opaque `nextCursor` vydaný serverem;
3. duplicate/overlap, extra record field, chybný LTM/task tvar nebo nekoherentní
   cursor/end musí odmítnout celou stránku a ponechat potvrzené řádky beze změny;
4. current cache musí obsahovat `{ items, page }`; exact legacy array se smí
   zobrazit jen jako neúplný a corrupt/expired cache se musí odstranit;
5. offline, server nebo protocol chyba musí ponechat validní kopii pouze ke
   čtení a okamžitě zamknout create form;
6. scope withdrawal musí stáhnout seznam, page boundary i cache a opožděná
   starší generace nesmí přepsat novější výsledek.

Exact DTO, cursor/cache boundary a failure preservation jsou v
[MM4-L review](reviews/MM4L-STORED-INFORMATION-LIST-INTEGRITY.md).

Create-only paměť zkontroluj v **Nastavení → Uchovávané informace**:

1. bez `write:memory` musí karta zůstat pouze pro čtení; formulář se smí ukázat
   až po úspěšném živém čtení se scope `read:memory` i `write:memory`;
2. vyber jednu ze čtyř veřejných kategorií, zadej nový klíč a hodnotu a potvrď
   **Přidat informaci**;
3. po potvrzení serverem se seznam znovu načte a nová položka se zobrazí;
4. zopakuj stejný klíč: server musí vrátit konflikt a původní hodnotu nesmí
   změnit;
5. odpoj spojení během výsledku: operace musí přejít do `UNKNOWN` v MS-20 a
   klient ji nesmí automaticky poslat podruhé.

Přesná datová hranice, journal a negativní scénáře jsou v
[MM4-F review](reviews/MM4F-CREATE-ONLY-MEMORY.md).

Stav agenta zkontroluj v **Agenti** se spuštěným legacy backendem:

1. bez `write:workers` musí být seznam čitelný, ale tlačítka změny zamčená;
2. s `read:workers` i `write:workers` nejdřív proveď živé obnovení a zvol
   **Zapnout** nebo **Vypnout**; první stisk jen otevře potvrzení;
3. potvrď varování. Úspěch se nesmí zobrazit optimisticky — aplikace nejdřív
   znovu načte stav ze serveru;
4. změň mezitím stejný stav z desktopu: mobil musí dostat konflikt, obnovit
   seznam a cizí změnu nepřepsat;
5. přeruš odpověď po odeslání: operace musí přejít do `UNKNOWN` v MS-20 a
   klient ji nesmí automaticky opakovat;
6. při vypnutí počítej s tím, že už běžící práce může doběhnout; vypnutí brání
   budoucím plánovaným běhům, není to cancel.

Přesný authority path, precondition, journal a non-claims jsou v
[MM4-G review](reviews/MM4G-WORKER-STATE.md).

Detail a historii agenta zkontroluj v **Agenti → Detail a historie**:

1. detail musí ukázat identitu, typ, stav a plán, ale nikdy definition/state,
   log, error text, explain payload ani identitu triggeru;
2. běhy musí být od nejnovějšího, pouze ukončené a jen se stavem `success`,
   `partial` nebo `error`;
3. **Načíst starší běhy** musí pokračovat do minulosti bez duplicit; nový běh
   vložený mezi stránkami nesmí posunout již vydaný kurzor;
4. bez `read:workers` se nesmí zobrazit ani dříve zapamatované jméno workera;
5. odpojení, zamknutí nebo opuštění detailu nesmí historii nabízet jako offline
   cache.

Přesná projekce, kurzorový kontrakt, negativní scénáře a non-claims jsou v
[MM4-H review](reviews/MM4H-WORKER-RUN-HISTORY.md).

### Integrita seznamů agentů a specialistů (MM4-J)

1. Připrav více než 50 workerů nebo specialistů. Pokračování se smí ukázat jen
   nad potvrzeným `hasMore` a neprázdným serverovým cursorem.
2. **Načíst další** musí cursor vrátit beze změny; během requestu je ovládání
   neaktivní a řazení již potvrzených řádků zůstává stabilní.
3. V testovacím gateway vrať duplicate id, overlap předchozí stránky, hidden
   pole nebo nekonzistentní `hasMore`/`nextCursor`/`end`: celý page se musí
   odmítnout, potvrzený seznam i cache zůstat stejné a UI nabídnout načtení od
   začátku.
4. Po neplatné worker odpovědi musí Zapnout/Vypnout zůstat zamčené, i když je
   poslední cache stále vidět.
5. Odeber odpovídající read scope: seznam, cursor i persistentní cache musí
   zmizet společně. Starý array-only cache formát se smí zobrazit bez
   vymyšleného pokračování nebo tvrzení o konci.

Zdrojová evidence a exact DTO/cache hranice jsou v
[MM4-J review](reviews/MM4J-CONFIGURED-LIST-INTEGRITY.md).

### Aktivní a archivované projekty (MM3-E)

1. Připrav více než 100 aktivních projektů, otevři **Projekty → Aktivní** a
   ověř větu, že seznam je výřez, i tlačítko **Načíst další projekty**.
2. Další dávka musí pokračovat serverovým cursorem bez duplicit. Po potvrzeném
   konci tlačítko zmizí; počet řádků sám konec neurčuje.
3. Přepni na **Archivované**. Řádky ani cursor aktivního filtru se nesmějí
   objevit a pozdní aktivní odpověď nesmí archiv přepsat.
4. Odpoj síť při appendu: poslední potvrzené S1 řádky zůstanou označené jako
   cache, chyba je inline a obnova načte vybraný filtr od začátku.
5. Odeber `read:projects`: aktivní i archivovaný seznam, jejich page boundaries
   a všechny projektové detailové cache musí zmizet.
6. Po upgradu ze starší array-only cache smí aplikace ukázat správný filtr, ale
   pokračování nabídne až po novém serverovém readu.

State/cursor vazba, cache migrace a negativní scénáře jsou v
[MM3-E review](reviews/MM3E-PROJECT-LIST-PAGINATION.md).

### Integrita detailu projektu a cache lifecycle (MM3-F/MM3-G)

1. Otevři detail projektu a ověř, že live response s jiným id, extra polem,
   neplatným stavem, timestampem, countem nebo verzí skončí jako protocol
   chyba a nesmí přepsat poslední validní detail ani cache.
2. S validní cache starší než 15 minut odpoj backend. Detail musí zůstat
   označený jako zastaralý, vysvětlit offline stav a nabídnout **Načíst detail
   znovu**; konverzace projektu se za offline cache vydávat nesmějí.
3. Cache stará sedm dnů nebo se špatným id/tvarem musí být odstraněna před
   publikací. Active list, archived list i detail mají stejné okno z `MD-02`:
   15 minut `FRESH`, potom `STALE`, od sedmi dnů `EXPIRED`.
4. Definitivní `not_found` musí odstranit zapamatovaný detail i cache. Oproti
   tomu server/protocol/offline selhání nesmí smazat validní neexpirovanou
   kopii.
5. Zahaj načtení, vrať se na seznam a teprve potom dokonči response. Detail ani
   cache se nesmí znovu objevit. Ze dvou souběžných načtení stejného projektu
   smí publikovat pouze novější generace.
6. Odeber `read:projects`; detail, projektové seznamy i jejich persistentní
   cache musí zmizet společně.

Exact DTO, cache/failure semantics a route-generation důkazy jsou v
[MM3-F review](reviews/MM3F-PROJECT-DETAIL-INTEGRITY.md); přesné age boundaries
a privacy tradeoff delší S1 retence jsou v
[MM3-G review](reviews/MM3G-PROJECT-CACHE-LIFECYCLE.md).

### Konverzace, stránkování, cache lifecycle a integrita (MM3-D/MM3-H/MM3-I)

1. Otevři **Konverzace** s více než 50 nesmazanými konverzacemi. Pod první
   dávkou musí být věta, že seznam je výřez, a tlačítko **Načíst další**.
2. Stisk načte přesně další stránku vydaným serverovým cursorem; existující
   řádky zůstanou ve stejném pořadí a žádný se nesmí zdvojit.
3. Po potvrzeném konci tlačítko zmizí. Samotný počet řádků nesmí konec ani
   pokračování odhadnout.
4. Odpoj síť před dalším načtením: potvrzené S1 okno zůstane označené jako
   cache, chyba se ukáže inline a obnova začne vědomě od hlavy.
5. Odeber `read:chat`: seznam, page boundary i persistentní cache musí zmizet.
   Po navrácení scope je nutný nový serverový read.
6. Starší instalace s array-only cache smí řádky během upgradu přečíst, ale
   nesmí z ní nabídnout **Načíst další**, dokud server nevydá nový cursor.
7. V řízeném testu timestampů je list po 16 minutách `STALE`, po 29 dnech stále
   čitelný a po 30 dnech `EXPIRED`; S1 titulek se nesmí vydávat za live stav.
8. Stažené vlákno je po 16 minutách `STALE`, ale od sedmi dnů `EXPIRED` a musí
   být smazáno dřív, než se jeho S2 zprávy objeví v paměti nebo UI.
9. V řízeném gateway testu vrať jiné conversation id, extra pole, duplicitní
   message id, overlap starší stránky nebo nekoherentní boundary: celý page se
   musí odmítnout a poslední validní okno i cache zůstanou beze změny.
10. Odešli thread request a před odpovědí odejdi z chatu, otevři jiný chat nebo
    odeber `read:chat`: pozdní response se nesmí publikovat; scope loss navíc
    odstraní všechny `thread.*` cache.
11. Definitivní `404 not_found` pro známou serverovou konverzaci musí smazat
    její data a ukázat chybu. Jen nové, nikdy neodeslané lokální `m-*` id smí
    zůstat prázdným chatem.
12. V devtools ověř, že globální list i thread posílají `cache: no-store` a
    gateway vrací `Cache-Control: no-store` pro 200, handler error i 401.

Přesná validace, cache migrace a negativní cursor scénáře jsou v
[MM3-D review](reviews/MM3D-CONVERSATION-LIST-PAGINATION.md); lifecycle hranice
a jejich security tradeoff jsou v
[MM3-H review](reviews/MM3H-CONVERSATION-CACHE-LIFECYCLE.md); exact thread a
HTTP-cache boundary je v
[MM3-I review](reviews/MM3I-CONVERSATION-THREAD-INTEGRITY.md).

### Konverzace projektu (MM3-C)

1. Spáruj zařízení se scopy `read:projects` i `read:chat`, otevři **Projekty**
   a vyber projekt.
2. Detail musí zachovat metadata projektu a pod nimi načíst jen aktivní nebo
   archivované konverzace přiřazené právě tomuto projektu; smazané a cizí řádky
   se nesmí objevit.
3. **Načíst starší konverzace** pokračuje serverovým cursorem. Cursor z jiného
   projektu ani z globálního seznamu se nesmí přijmout.
4. Řádek otevře stávající chat. Detail nesmí nabídnout vytvoření, přiřazení,
   archivaci ani smazání projektu nebo konverzace.
5. Odeber jen `read:chat`: metadata projektu zůstanou čitelná, konverzační
   sekce se zamkne a zapamatovaný seznam zmizí. Totéž členství se zahodí při
   odpojení, uzamčení nebo opuštění detailu.
6. V offline režimu se seznam konverzací projektu nesmí vydávat za aktuální;
   klient jej neukládá do persistentní cache.

Přesná authority, cache a cursor hranice jsou v
[MM3-C review](reviews/MM3C-PROJECT-CONVERSATIONS.md).

### Detail specialisty a expertiz (MM4-I)

1. V navigaci otevřete **Specialisté** a vyberte **Detail expertiz**.
2. Ověřte veřejná metadata balíčku a pořadí vazeb expertiz podle priority.
3. Rozlište perzistovaný stav balíčku od živé runtime registrace: aplikace
   výslovně říká, že živý stav z tohoto gateway procesu nepozoruje.
4. Ověřte, že obrazovka nemá enable/disable, bind/unbind, editaci priority ani
   zobrazení manifestu, promptů, nástrojů či execution obsahu.
5. Odeberte scope `read:specialists` nebo uzamkněte aplikaci; otevřený detail
   se musí zahodit. Po návratu se čte znovu online, ne z offline detail cache.

Zdrojová evidence a přesné non-claims jsou v
[MM4-I review](reviews/MM4I-SPECIALIST-DETAIL.md).

---

## Známá omezení, ať je nehlásíš jako vady

| | |
|---|---|
| Odpověď přijde najednou, netéče po tocích | Token streaming neexistuje (`PLAN.md` §3) |
| Vlastní obrazovka průběhu / agent log chybí | `MR-07` je `BLOCKED_BY_CONTRACT`; demo ukazuje jen S1 indikátory ve schránce |
| Hledání chybí | `MR-10` je `BLOCKED_BY_CONTRACT` |
| Projekty jsou jen read-only | seznam a detail jsou zapojené; mutation kontrakt zatím není přijatý |
| Nastavení není obecný desktop editor | zapisuje jen 11 `UX_PREFERENCES_V1` cest; security, modely, import/reset/backup a feature flags zůstávají mimo mobil |
| Paměť je jen create-only | lze přidat nový explicitní LTM klíč; nelze nahradit ani smazat LTM, zapisovat task memory nebo interní kategorie |
| Agent lifecycle je úzký | lze číst metadata ukončených běhů a zapnout/vypnout worker nad živě načteným stavem; live progress, create/edit/run/dry-run ani cancel právě běžící práce nejsou dostupné |
| Specialisté jsou read-only | seznam a detail balíčku/expertiz existují, ale perzistovaný status není živý runtime stav; bezpečný mutation port přes `SpecialistLoader` zatím neexistuje a přímý DB toggle by obcházel runtime autoritu |
| Odvolání zařízení není remote wipe | nový přístup se zablokuje; obsah už uložený v offline telefonu tím nezmizí |
| Notifikace nedorazí do spící aplikace | Push (`N-1`) není; schránka je pull. Naplnit ji umí `npm run mobile:demo` |
| ~~Na 200 % písma se nic nezvětší~~ | **Už neplatí.** Stylesheet byl převedený 2026-08-11 a `mobile-browser-a11y` to měří v prohlížeči |
| Nové spárování = nový `deviceId` | Staré operace z nového zařízení nejsou vidět |
