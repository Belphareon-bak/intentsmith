# IntentSmith Mobile — klientský datový, cache a trust model

**Status:** návrh k review; nic není schváleno k implementaci
**Datum:** 2026-07-30
**Ověřeno proti:** `54913a1` na `codex/intentsmith-1.0`
**Vychází z:** [ADR 0001](../adr/0001-mobile-data-ownership.md) ACCEPTED — REMOTE_COMPANION
**Souvisí:** [PLAN.md](PLAN.md) §2 (hranice), §5 (fáze 1–5), `G0-R021`

Legenda: **[F]** ověřený fakt v tomto repu · **[R]** doporučení · **[?]** rozhodnutí operátora · **[D]** odloženo

---

## 0. Co tento dokument rozhoduje a co nerozhoduje

**Rozhoduje** doménové chování dat v mobilním klientovi pod REMOTE_COMPANION:
kdo data vlastní, co smí ležet v telefonu, jak dlouho, co se s tím děje při
odhlášení a revokaci a co z toho zbyde útočníkovi po ztrátě telefonu.

**Nerozhoduje** — a záměrně: endpointy, tvary payloadů, transport, názvy tabulek,
knihovny úložiště. Kontrakt `/m1` se nezmrazuje (PLAN.md §8, podmínka 2). Model
níže je formulovaný tak, aby platil pro libovolný transport, který splní
doménové požadavky z §8.

**Neimplementuje se nic.** Žádný listener, pairing, `/m1`, UI ani síťové
zpřístupnění.

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
| **I-10** | Cache je **odvozená a kdykoli zahoditelná**. Její ztráta nesmí znamenat ztrátu dat — s jedinou výjimkou `MD-14` (draft) a `MD-15` (lokální preference). | Test: smazání app dat nesmí uživatele o nic připravit |
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

**`R-5` uzavřeno:** tabulka dělení v PLAN.md §5 je **závazná**. Celá Security
sekce a feature flags na telefon nepatří.

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

**`R-4` — stahování diffů: uzavřeno jako NE pro 1.0** (v souladu s `D-M7`).

Klient smí diff **bezpečně zobrazit**. Nepodporuje:

- stažení diffu jako souboru;
- export ani sdílení do jiné aplikace;
- uložení do uživatelsky přístupného úložiště telefonu.

To **není** zákaz nezbytné chráněné cache pro samotné zobrazení — ta smí
existovat v mezích tohoto modelu (`ST-MEM`, případně `ST-DB` pod ochranou §2).
Zakázaná je cesta ven: jakmile obsah opustí aplikaci, přestávají pro něj platit
`E-LOGOUT`, `E-REVOKE` i celá §5, protože systémová galerie ani cizí aplikace
o revokaci zařízení nevědí.

Rozhodnutí o exportu se může vrátit v pozdější verzi — ale s **vlastním threat
modelem**, ne jako drobné rozšíření tohoto. Diff schvalovaného approvalu se
řídí i `MD-07`.

---

### MD-06 — Uchovávané informace (LTM, task memory)

| Atribut | Hodnota |
|---|---|
| Zdroj pravdy | **server** |
| V telefonu | ano — read-only, dle PLAN.md §5 Fáze 4 |
| Citlivost | **S2** — kondenzovaný obsah mnoha konverzací naráz |
| Úložiště | `ST-DB` |
| TTL | `FRESH` 1 h · `STALE` 7 dnů · `EXPIRED` 7 dnů |
| Invalidace | refresh obrazovky |
| Offline čtení | `READ_CACHED` |
| Offline změny | `MUT-ONLINE-ONLY`; mazání paměti z telefonu je mimo 1.0 (PLAN.md §5) |
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
| Citlivost | **S2** (payload nese diff nebo příkaz) |
| Úložiště | `ST-MEM` |
| TTL | **`R-3` uzavřeno:** lokální okno **5 minut**, vzdálené okno **15 minut**. Autoritou je vždy serverová expirace, ne klientský čas |
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

#### `R-3` — rozdílná approval okna, uzavřeno

| Okno | Délka | Pro koho |
|---|---|---|
| **lokální** | **5 minut** | operátor u stroje; delší okno tam nic neřeší |
| **vzdálené** | **15 minut** | telefon v kapse — pět minut je pro něj nedosažitelných |

Šest pravidel, která z delšího okna nedělají slabší oprávnění:

1. Approval je **jednorázový**.
2. Je vázaný na **konkrétní run, konkrétní operaci a přesný schvalovaný obsah**.
3. **Jakákoli změna** příkazu, diffu, oprávnění nebo bezpečnostně významného
   stavu approval **zneplatní** — okno na tom nic nemění.
4. Delší vzdálené okno **neprodlužuje samotné oprávnění po jeho použití**.
   Patnáct minut je lhůta na rozhodnutí, ne platnost výsledku.
5. **Žádný replay.** Opakované odeslání téhož rozhodnutí je konflikt řešený
   klíčem operace (`MD-19`), ne druhé schválení.
6. Po expiraci **musí vzniknout nový approval request**. Prodloužení, obnovení
   ani „ještě chvilku" neexistuje.

> Delší okno je ústupek fyzice, ne bezpečnosti: telefon leží v kapse a jeho
> majitel není u obrazovky. Rozšiřuje se **doba na rozhodnutí**, nikoli to,
> co rozhodnutí zmůže.

---

### MD-08 — In-app notifikace

| Atribut | Hodnota |
|---|---|
| Zdroj pravdy | **server** (událost), klient drží jen stav přečtení v rámci relace |
| V telefonu | ano — krátká historie, bez obsahu |
| Citlivost | **S1** — text notifikace **nesmí** nést obsah zprávy ani diffu |
| Úložiště | `ST-DB` |
| TTL | `FRESH` — · `STALE` 7 dnů · `EXPIRED` 7 dnů |
| Invalidace | doručením novější události; historie je append-only |
| Offline čtení | `READ_CACHED` — s tím, že offline je seznam z definice neúplný a UI to říká |
| Offline změny | `MUT-ONLINE-ONLY` |
| `E-LOGOUT` | smazat |
| `E-EXPIRE` | ponechat do konce TTL |
| `E-REVOKE` | smazat při zjištění |
| Po ztrátě (`E-LOST`) | čitelné: co se dělo a kdy, bez obsahu |

> **[R]** Notifikace nese ukazatel („nový approval v projektu X"), ne obsah.
> Notifikace se zobrazují i na zamčené obrazovce, kde neplatí žádná z ochran §5.
> Doručovací hranice zůstává dle PLAN.md §6 — na spící aplikaci nedorazí nic.

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

Žurnál drží před prvním odesláním: `operationId`, identitu zařízení, typ
operace, otisk kanonického požadavku, čas vzniku a stav
`PENDING` / `CONFIRMED` / `REJECTED` / `UNKNOWN`.

| Atribut | Hodnota |
|---|---|
| Zdroj pravdy | **Klient vydává klíč, server je autoritou nad výsledkem.** Žurnál je záznam o pokusu, ne o pravdě |
| V telefonu | ano — jinak by klíč nepřežil restart aplikace, tedy právě ten případ, kvůli kterému existuje |
| Citlivost | **S1** — typ operace a otisk. **Payload se do žurnálu neukládá nikdy** (jinak by to bylo S2) |
| Úložiště | `ST-DB`, oddělený od dat |
| TTL | `CONFIRMED`/`REJECTED` → úklid po 24 h. **`PENDING`/`UNKNOWN` se nemažou časem** — jen rozřešením nebo vědomým zahozením uživatelem |
| Invalidace | výsledkem potvrzeným serverem |
| Offline čtení | `READ_CACHED` — uživatel musí vidět, že výsledek operace zůstal neznámý |
| Offline změny | `MUT-LOCAL-ONLY` pro žurnál samotný. **Žurnál není fronta** (I-11) |
| `E-LOGOUT` | smazat — s **výslovným varováním**, existují-li `PENDING`/`UNKNOWN`: lokální klíč zmizí, ale **efekt na serveru může zůstat nerozřešený** a z telefonu už ho nepůjde dohledat |
| `E-EXPIRE` | **ponechat** — po novém přihlášení lze `UNKNOWN` rozřešit přečtením serverového stavu |
| `E-REVOKE` | smazat s cache — **jen pokud zařízení revokaci autenticky přijme a wipe skutečně proběhne.** Viz §4.1 |
| Po ztrátě (`E-LOST`) | prozradí **typy** operací a jejich časy, ne obsah |

**Pravidla, která z klíče dělají ochranu a ne frontu:**

1. Tentýž klíč s **tímtéž otiskem** → server vrátí původní výsledek **bez nového
   efektu**.
2. Tentýž klíč s **jiným payloadem** → **fail-closed konflikt**. Jiný payload je
   jiná operace; sdílení klíče je chyba klienta, ne důvod k domýšlení.
3. **Nejasný timeout → `UNKNOWN`.** Klient v té chvíli **nesmí vyrobit nový
   klíč** — tím by z jedné operace udělal dvě. `UNKNOWN` se řeší přečtením
   serverového stavu, ne dalším pokusem naslepo.
4. Approvaly, bezpečnostní a administrativní operace se offline **nefrontují ani
   s klíčem**. Klíč je ochrana proti duplicitě uvnitř jednoho vědomého pokusu;
   jednorázové oprávnění approvalu neprodlužuje ani nenahrazuje (I-11, I-4).
5. Otisk se počítá z **kanonického** tvaru požadavku, aby se přeuspořádáním polí
   nedala obejít pravidla 1 a 2.

> Žurnál je jediné místo v klientovi, kde je „nevím" legitimní trvalý stav.
> Všude jinde se nejistota překlápí na refresh; tady by refresh mohl operaci
> provést podruhé.

#### 4.1 Obnova operace bez payloadu

Žurnál nese otisk, ne obsah. Z toho plyne, co lze a co nelze:

1. **Stav operace se po reconnectu zjistí podle klíče**, bez opětovného zaslání
   payloadu. Dotaz „jak dopadl `operationId`" je čtení a je vždy bezpečný.
2. **Ze samotného otisku nelze požadavek obnovit.** Otisk slouží k porovnání,
   ne k rekonstrukci; jednosměrnost je jeho smysl.
3. Vrátí-li server, že **klíč nezná**, je retry možný **jen tehdy, je-li přesný
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
| **A4** | Peer na stejné VPN, bez telefonu | Nic z telefonu. Pro něj platí `G0-R021` a hranice z PLAN.md §2 |
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
| Typy a časy pokusů o operace (`MD-19`) | Payloady těch operací — žurnál drží jen otisk |
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
| **P-9** | Viditelný seznam spárovaných zařízení a jednoklikové odvolání | A2 | Zkracuje okno mezi ztrátou a revokací |

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
| **D-M7** | Cachovat diffy a obsah souborů? Váže na `R-4` v PLAN.md | Ne pro 1.0 — patří do `MD-05` |

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
5. **Rozhodnutí o approvalu je idempotentní** a druhé odeslání je rozpoznatelný
   konflikt, ne tiché druhé schválení. Idempotenci nese klíč operace z `MD-19`,
   ale **nenahrazuje jednorázové oprávnění approvalu** — to zůstává jednorázové
   i tehdy, když je klíč platný.
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
