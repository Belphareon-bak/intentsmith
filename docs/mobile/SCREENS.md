# IntentSmith Mobile — mapa obrazovek a toků, fáze 1–5

**Status:** návrh k review; nic není schváleno k implementaci
**Datum:** 2026-07-30
**Ověřeno proti:** `54913a1` na `codex/intentsmith-1.0`
**Vychází z:** [DATA-MODEL.md](DATA-MODEL.md), [TEST-STRATEGY.md](TEST-STRATEGY.md), [PLAN.md](PLAN.md) §4–§6

Legenda: **[F]** ověřený fakt v tomto repu · **[R]** doporučení · **[?]** rozhodnutí operátora · **[D]** odloženo

---

## 0. Pravidlo, kterému se dokument podřizuje

> **Obrazovka nesmí vzniknout dřív než pravidlo, které ji dělá ověřitelnou.**

Každý tok níže proto nese trojici: **požadavek `MR-xx`** (co se slibuje),
**datové typy `MD-xx`** (čím to je podložené) a **plánovaná testovací ID**
(čím se to prokáže). Tok bez těch tří odkazů do mapy nepatří.

Nezmrazuje se nic z transportu: žádné endpointy, payloady ani tvary chyb.
Popisuje se, co uživatel vidí a co systém smí, ne jak se to přenáší.

---

## 1. Registr požadavků

Odvozeno z PLAN.md §4 (DoD P1–P7), §5 (fáze 1–5) a §6 (notifikace).
`MR-xx` je stabilní odkaz; formulace se může zpřesnit, číslo ne.

| ID | Požadavek | Původ | Fáze |
|---|---|---|---|
| **MR-01** | Telefon se spáruje bez opisování tokenu | P1 | 0 |
| **MR-02** | Zařízení má scoped device token; hranice je fail-closed | P2, S-3 | 0 |
| **MR-03** | Uživatel vidí stav backendu a **rozezná příčinu** nedostupnosti | P3 | 0 |
| **MR-04** | Uživatel vidí seznam konverzací | P4 | 1 |
| **MR-05** | Uživatel čte historii konverzace včetně stránkování | Fáze 1 | 1 |
| **MR-06** | Uživatel odešle zprávu a dostane odpověď — **najednou, ne streamovaně** | P5 | 1 |
| **MR-07** | Průběh běhu je viditelný přes události agent logu | P6 | 1 |
| **MR-08** | Po reconnectu se historie znovu načte a přerušený turn je označen | P7 | 1 |
| **MR-09** | Cachované konverzace jsou čitelné offline | Fáze 1, ADR 0001 | 1 |
| **MR-10** | Uživatel hledá v konverzacích | Fáze 1 | 1 |
| **MR-11** | Rozepsaná zpráva přežije zavření aplikace i offline stav | I-5 | 1 |
| **MR-12** | Uživatel čte mobilní podmnožinu nastavení | Fáze 2, R-5 | 2 |
| **MR-13** | Uživatel mění mobilní podmnožinu nastavení | Fáze 2, R-5 | 2 |
| **MR-14** | Uživatel vidí projekty a jejich lifecycle fázi | Fáze 3 | 3 |
| **MR-15** | Uživatel vidí frontu čekajících approvalů | Fáze 3 | 3 |
| **MR-16** | Uživatel rozhodne o approvalu — vázaně na otisk payloadu, jednorázově, idempotentně ★ | Fáze 3 | 3 |
| **MR-17** | Uživatel čte uchovávané informace (LTM, task memory) | Fáze 4 | 4 |
| **MR-18** | Uživatel přidá ruční poznámku | Fáze 4 | 4 |
| **MR-19** | Uživatel vidí stav agentů a historii běhů | Fáze 5 | 5 |
| **MR-20** | Uživatel spustí dry-run agenta | Fáze 5 | 5 |
| **MR-21** | In-app notifikace ze serverových událostí | §6 | 1+ |
| **MR-22** | Uživatel vidí spárovaná zařízení a může je odvolat | P-9 | 0 |
| **MR-23** | Zámek aplikace chrání cache při odemčeném telefonu | P-4, `D-M4` | 0 |

★ = nejcennější use case celého projektu (ADR 0001).

---

## 2. Slovník stavů

Deset stavů, které musí umět **každý** tok. Zde je výchozí chování; tabulka
u toku popisuje, čím se od něj liší.

| ID | Stav | Výchozí chování | Zakázáno |
|---|---|---|---|
| **SS-01** | Načítání | Skeleton s tvarem cílového obsahu. Nad `STALE` cache se načítá **na pozadí** a stará data zůstávají viditelná | Blokující spinner přes celou obrazovku, když je co ukázat |
| **SS-02** | Prázdná data | „Tady nic není" **potvrzené serverem**, s návrhem další akce | Zaměnit prázdno s nedostupností — `SS-02` platí jen po úspěšné odpovědi |
| **SS-03** | Offline, čtení z cache | Trvalý nenápadný ukazatel „offline · data z `<čas>`". Mutační prvky **neaktivní**, ne skryté — a s vysvětlením proč | Ukázat neúplný seznam jako úplný (I-2). Konec cache musí být viditelný |
| **SS-04** | Zastaralá cache (`STALE`) | Viditelné stáří + nabídka obnovit. Čtení ano, **jakákoli akce ne** (DATA-MODEL §3) | Rozhodnout, schválit nebo změnit cokoli nad `STALE` daty |
| **SS-05** | Reconnect | Obnovení spojení → refresh hlavy obrazovky. Rozpracovaný turn se označí jako **přerušený**; nepokračuje se v něm | Předstírat, že přerušený turn pokračuje (PLAN.md §3: resume neexistuje) |
| **SS-06** | Expirovaný nebo revokovaný token | **Dva různé stavy.** Expirace → „přihlas se znovu". Revokace → „toto zařízení bylo odvoláno", cache se maže dřív, než se cokoli zobrazí (P-5) | Sloučit je do jedné hlášky. Nechat po revokaci viditelný obsah |
| **SS-07** | Nedostatečný scope | „Toto zařízení na to nemá oprávnění", s tím, kde se to mění (na desktopu). Prvek je vidět jako uzamčený | Tvářit se, že akce neexistuje — uživatel by hledal chybu v aplikaci. A nikdy nezkoušet obejít |
| **SS-08** | Server nedostupný | Odlišené od `SS-03`: síť funguje, server neodpovídá. Nabídne diagnostiku (`MS-03`) | Zaměnit se `SS-03` nebo `SS-06`; DATA-MODEL §8.3 to výslovně vyžaduje rozlišit |
| **SS-09** | Konflikt / změna serverového stavu | „Stav se mezitím změnil" + načtení aktuálního + **znovupotvrzení uživatelem** | Přepsat cizí změnu. Rozhodnout podle toho, co uživatel viděl před konfliktem |
| **SS-10** | Bezpečné opakování | Opakovat lze jen operaci **idempotentní nebo nesoucí klientský klíč** operace. Jinak: znovu načíst stav a zeptat se | Slepé opakování operace s vedlejším účinkem. Automatický retry u čehokoli schvalovacího |

### 2.1 Tři záměny, které tuhle aplikaci rozbijí

1. **`SS-02` × `SS-03`** — prázdný seznam a nedostupný seznam vypadají stejně
   a znamenají opak. Bez potvrzení serverem se `SS-02` nezobrazuje nikdy.
2. **`SS-03` × `SS-08`** — „nemám síť" a „server neběží" vedou uživatele
   k úplně jiné akci. Proto `MR-03`.
3. **`SS-06` expirace × revokace** — první je rutina, druhá je bezpečnostní
   událost. Revokace navíc spouští úklid cache.

---

## 3. Navigační kostra

```
  start ──▶ MS-01 odemčení ──┬─(bez tokenu)─▶ MS-02 párování
                             │
                             └─(s tokenem)──▶ domovská obrazovka
                                                │
   ┌──────────────┬───────────────┬─────────────┼──────────────┬──────────────┐
   ▼              ▼               ▼             ▼              ▼              ▼
 MS-06         MS-13          MS-12         MS-16          MS-18         MS-05
 konverzace    approvaly ★    projekty      informace      agenti        notifikace
   │              │               │             │              │
   ▼              ▼               ▼             ▼              ▼
 MS-07 detail  MS-14 rozhodnutí MS-15 běh    MS-17 poznámka MS-19 dry-run
   │
   ▼
 MS-08 odeslání · MS-09 hledání

  kdykoli dostupné:  MS-03 diagnostika · MS-04 zařízení · MS-10/MS-11 nastavení
```

---

## 4. Toky

### Fáze 0 — základ, bez kterého nemá zbytek smysl

---

#### MS-01 — Start aplikace a odemčení

**Požadavky:** `MR-23`, `MR-02` · **Data:** `MD-11`, `MD-12` · **Testy:** `IS-T1-TESTS-MOBILE-LIFECYCLE-LOGOUT-WIPE-TEST`, `IS-T1-TESTS-MOBILE-CACHE-EXPIRED-PURGE-TEST`, `IS-T2-TESTS-MOBILE-LIFECYCLE-TOKEN-STORAGE-TEST`

Startovní pořadí je bezpečnostní, ne kosmetické: **úklid `EXPIRED` → zámek →
teprve pak jakýkoli obsah.**

| Stav | Chování |
|---|---|
| `SS-01` | Neutrální úvodní obrazovka. **Žádný náhled obsahu před odemčením** — ani v přepínači úloh OS |
| `SS-02` | Bez tokenu → rovnou `MS-02` párování |
| `SS-03` | Odemčení funguje offline; token se k němu nepotřebuje |
| `SS-04` | Stará cache se po odemčení zobrazí jako `STALE`, ne jako čerstvá |
| `SS-05` | — |
| `SS-06` | Zjištěná revokace → smazat cache **před** zobrazením čehokoli, pak `MS-02` |
| `SS-07` | — |
| `SS-08` | Odemčení na serveru nezávisí; nesmí ho blokovat |
| `SS-09` | — |
| `SS-10` | Opakované zadání zámku má strop pokusů; po překročení jen ostřejší cesta (systémové ověření), nikdy tichý průchod |

---

#### MS-02 — Párování zařízení

**Požadavky:** `MR-01`, `MR-02` · **Data:** `MD-16`, `MD-11`, `MD-12` · **Testy:** `IS-T2-TESTS-MOBILE-PAIRING-SINGLE-USE-TEST`, `IS-T2-TESTS-MOBILE-PAIRING-TTL-TEST`, `IS-T2-TESTS-MOBILE-PAIRING-BRUTE-FORCE-TEST`, `IS-T1-TESTS-MOBILE-PAIRING-NO-ESCALATION-TEST`, `IS-T1-TESTS-MOBILE-PAIRING-KILL-SWITCH-TEST`, `IS-T1-TESTS-MOBILE-PAIRING-CODE-NOT-PERSISTED-TEST`

| Stav | Chování |
|---|---|
| `SS-01` | Průběh párování krok za krokem; nikdy neurčitý spinner — uživatel drží dvě zařízení |
| `SS-02` | Není co párovat: párování je na serveru vypnuté → řekni to, nenabízej obejití |
| `SS-03` | Párovat offline nelze. Jasně: „potřebuješ spojení se serverem" |
| `SS-04` | — cache se párování netýká |
| `SS-05` | Přerušené párování se **nedokončuje na pozadí**. Začíná se znovu s novým kódem |
| `SS-06` | Neaplikuje se — token teprve vzniká |
| `SS-07` | Kód s nižším scope, než obrazovka očekává → přijmout scope, který server dal, a **zobrazit ho**. Nikdy nežádat víc |
| `SS-08` | Rozlišit od `SS-03`: „server neodpovídá" vs. „nejsi na síti" |
| `SS-09` | **Kód už byl použit → konflikt.** Nikdy druhé uplatnění, nikdy tiché opakování |
| `SS-10` | Opakování = **nový kód**, ne opakované odeslání starého |

> Po dokončení je kód pryč z paměti i z obrazovky. `MD-16` nemá přežít
> ani úspěch, ani chybu.

---

#### MS-03 — Diagnostika a stav spojení

**Požadavky:** `MR-03` · **Data:** `MD-10`, `MD-12` · **Testy:** `IS-T1-TESTS-MOBILE-CONTRACT-ERROR-STATES-TEST`, `IS-T1-TESTS-MOBILE-PRIVACY-DIAGNOSTICS-TEST`

Jediná obrazovka, která má smysl i bez platného tokenu — má odpovědět na otázku
„čí je to problém".

| Stav | Chování |
|---|---|
| `SS-01` | Postupné vyplňování řádků, jak přicházejí odpovědi |
| `SS-02` | Nikdy prázdno: vždy je co ukázat, i kdyby jen čas posledního kontaktu |
| `SS-03` | Poslední známý stav se stářím + „nejsi připojený" |
| `SS-04` | Údaje starší než TTL se označí, nemažou |
| `SS-05` | Po obnovení spojení automatický refresh |
| `SS-06` | **Zobrazí se i s neplatným tokenem** — s explicitním „token je neplatný / odvolaný" jako výsledkem diagnostiky |
| `SS-07` | Části vyžadující scope se ukážou jako uzamčené, ne zmizí |
| `SS-08` | Toto je jeho hlavní stav: rozliš síť / VPN / server / model |
| `SS-09` | Změna verze API → upozornit, že klient může být zastaralý |
| `SS-10` | Ruční „zkusit znovu" je vždy bezpečný — čtení bez vedlejšího účinku |

> Diagnostika **nikdy** nezobrazí token, ani zkrácený (I-6).

---

#### MS-04 — Spárovaná zařízení a jejich odvolání

**Požadavky:** `MR-22` · **Data:** `MD-11`, `MD-12` · **Testy:** `IS-T2-TESTS-MOBILE-SCOPE-TOKEN-EXPIRY-TEST`, `IS-T1-TESTS-MOBILE-LIFECYCLE-REVOKE-WIPE-TEST`, `IS-T1-TESTS-MOBILE-LIFECYCLE-REVOKE-CANNOT-WIPE-OFFLINE-TEST`

| Stav | Chování |
|---|---|
| `SS-01` | Skeleton seznamu |
| `SS-02` | Jen tohle zařízení — legitimní stav, ne chyba |
| `SS-03` | Seznam ze cache **ano**, odvolání ne. `MUT-NEVER-QUEUED` |
| `SS-04` | Seznam se stářím; odvolávat nad `STALE` seznamem nelze — nejdřív refresh |
| `SS-05` | Refresh seznamu |
| `SS-06` | Odvolání sebe sama = okamžitý logout a úklid cache tohoto telefonu. Existují-li `PENDING`/`UNKNOWN` (`MD-19`), **varovat**: klíč zmizí, ale efekt na serveru může zůstat nerozřešený |
| `SS-07` | Bez scope na správu zařízení: seznam ano, odvolání uzamčené |
| `SS-08` | Odvolání se **nefrontuje**; řekni, že se to nepovedlo |
| `SS-09` | Zařízení už bylo odvoláno odjinud → ukaž aktuální stav, neopakuj |
| `SS-10` | Odvolání je idempotentní: druhý pokus končí stejným stavem, ne chybou. Nese klíč operace (`MD-19`) jako každá mutace |

> **Obrazovka musí říct nahlas, co odvolání nedokáže:** zabrání novému přístupu,
> ale nesmaže data, která už v odvolaném telefonu leží (`M-R1`, I-7).
> Formulace typu „zařízení bylo vymazáno" by byla lež.

---

#### MS-05 — Notifikační centrum

**Požadavky:** `MR-21` · **Data:** `MD-08` · **Testy:** `IS-T1-TESTS-MOBILE-PRIVACY-NOTIFICATION-CONTENT-TEST`

| Stav | Chování |
|---|---|
| `SS-01` | Skeleton |
| `SS-02` | „Zatím nic" |
| `SS-03` | Historie z cache **s výslovným upozorněním, že je z definice neúplná** — offline notifikace nedorazily |
| `SS-04` | Stáří posledního doručení je vidět vždy |
| `SS-05` | Po reconnectu **nedochází k dopočtu zmeškaných událostí**; stav se čte z dat, ne z notifikací (DATA-MODEL §3) |
| `SS-06` | Vyprázdnit, přejít na přihlášení |
| `SS-07` | Notifikace mimo scope se nedoručují ani nezobrazují |
| `SS-08` | Kanál je dole — řekni to; ticho není „nic se neděje" |
| `SS-09` | Notifikace odkazuje na věc, která už neexistuje → otevři aktuální stav, ne 404 |
| `SS-10` | Čtení, opakování vždy bezpečné |

> Notifikace nese ukazatel, ne obsah (`MD-08`) — objevuje se na zamčené
> obrazovce, kde neplatí `MR-23`.

---

### Fáze 1 — Konverzace

---

#### MS-06 — Seznam konverzací

**Požadavky:** `MR-04`, `MR-09` · **Data:** `MD-03`, `MD-13` · **Testy:** `IS-T1-TESTS-MOBILE-CACHE-ONLY-EXPLICIT-TEST`, `IS-T1-TESTS-MOBILE-CACHE-FRESHNESS-STATES-TEST`, `IS-T1-TESTS-MOBILE-CONTRACT-PAGINATION-END-TEST`

| Stav | Chování |
|---|---|
| `SS-01` | Skeleton; nad cache se načítá na pozadí |
| `SS-02` | „Zatím žádné konverzace" — jen po potvrzené odpovědi |
| `SS-03` | Cachované okno + **viditelná hranice**: „starší konverzace jsou dostupné po připojení" |
| `SS-04` | Ukazatel stáří v hlavičce; položky se needitují |
| `SS-05` | Refresh hlavy seznamu, pozice ve výpisu se neztratí |
| `SS-06` | Expirace → přihlášení. Revokace → úklid cache, pak přihlášení |
| `SS-07` | Bez scope na konverzace je obrazovka uzamčená s vysvětlením |
| `SS-08` | Cache zůstává čitelná, ukazatel „server neodpovídá" |
| `SS-09` | Konverzace přejmenovaná či archivovaná jinde → převezmi serverový stav |
| `SS-10` | Refresh je bezpečný vždy; stránkování se opakuje od posledního potvrzeného kurzoru (`MD-13`) |

---

#### MS-07 — Detail konverzace

**Požadavky:** `MR-05`, `MR-09` · **Data:** `MD-04`, `MD-05`, `MD-13` · **Testy:** `IS-T1-TESTS-MOBILE-CACHE-ONLY-EXPLICIT-TEST`, `IS-T1-TESTS-MOBILE-CONTRACT-CURSOR-REJECTION-TEST`, `IS-T1-TESTS-MOBILE-CONTRACT-PAGINATION-END-TEST`

| Stav | Chování |
|---|---|
| `SS-01` | Skeleton zpráv; nad cache se dotahuje hlava |
| `SS-02` | Nová prázdná konverzace — výzva k první zprávě |
| `SS-03` | **Jen stažené okno.** Na jeho konci stojí „starší zprávy vyžadují připojení", nikdy tiché useknutí (I-2) |
| `SS-04` | Ukazatel stáří; odpověď, která mezitím dorazila, tu nebude |
| `SS-05` | Refresh hlavy. **Přerušený turn se označí jako přerušený a nepokračuje** (PLAN.md §3) |
| `SS-06` | Jako `MS-06` |
| `SS-07` | Uzamčeno s vysvětlením |
| `SS-08` | Cache čitelná, odesílání neaktivní |
| `SS-09` | Konverzace smazaná jinde → řekni to a vrať na seznam; drž draft (`MD-14`) |
| `SS-10` | Odmítnutý kurzor → **plný refresh, nikdy dopočet** chybějícího úseku |

> Přílohy (`MD-05`) se necachují: offline zástupný stav, ne prázdné místo.

---

#### MS-08 — Odeslání zprávy a rozepsaný text

**Požadavky:** `MR-06`, `MR-08`, `MR-11` · **Data:** `MD-14`, `MD-04` · **Testy:** `IS-T1-TESTS-MOBILE-OFFLINE-MUTATIONS-REFUSED-TEST`, `IS-T1-TESTS-MOBILE-OFFLINE-DRAFT-NO-AUTOSEND-TEST`, `IS-T1-TESTS-MOBILE-OFFLINE-DRAFT-LOCAL-ONLY-TEST`

| Stav | Chování |
|---|---|
| `SS-01` | Po odeslání **čekání na celou odpověď** — token streaming neexistuje (PLAN.md §3). Průběh se ukazuje přes `MS-15`, ne přitékajícím textem |
| `SS-02` | — |
| `SS-03` | Psát ano, odeslat ne. Text zůstává jako `MD-14`. **Žádná fronta** (I-3) |
| `SS-04` | Odeslat do `STALE` konverzace lze až po refreshi hlavy |
| `SS-05` | Draft se obnoví do editoru. **Neodešle se sám** (I-5, `D-M1`) — čeká na uživatele |
| `SS-06` | Draft zůstává při expiraci; při revokaci padá s cache (`D-M3`) |
| `SS-07` | Bez scope na zápis je editor uzamčený, ale draft se uchová |
| `SS-08` | Jako `SS-03`, s jinou formulací příčiny |
| `SS-09` | Konverzace mezitím archivovaná → nabídni jinou nebo novou, text neztrať |
| `SS-10` | Opakování odeslání **jen s týmž klíčem operace** (`MD-19`), jinak vznikne duplicitní zpráva. Nejasný timeout → `UNKNOWN`; **nový klíč se nevyrábí**, řeší se přečtením konverzace. Zná-li klient klíč, ale ne původní text, nabídne **nové odeslání**, nikdy dopsaný náhradní obsah (C-13) |

---

#### MS-09 — Hledání v konverzacích

**Požadavky:** `MR-10` · **Data:** `MD-03`, `MD-04` · **Testy:** `IS-T1-TESTS-MOBILE-CACHE-ONLY-EXPLICIT-TEST`

| Stav | Chování |
|---|---|
| `SS-01` | Průběžné výsledky; nikdy blokující |
| `SS-02` | „Nic nenalezeno" — a offline s dodatkem, že se hledalo jen v cache |
| `SS-03` | **Hledá se výhradně v cachovaném okně** a musí to být napsané. Jinak uživatel usoudí, že věc neexistuje |
| `SS-04` | Výsledky ze `STALE` dat se označí |
| `SS-05` | Po připojení nabídnout zopakování hledání na serveru |
| `SS-06` | Jako `MS-06` |
| `SS-07` | Uzamčeno |
| `SS-08` | Degradace na hledání v cache, s vysvětlením |
| `SS-09` | Nalezený záznam mezitím zmizel → aktuální stav, ne chyba |
| `SS-10` | Hledání je čtení; opakování vždy bezpečné |

---

### Fáze 2 — Nastavení

---

#### MS-10 — Nastavení, čtení

**Požadavky:** `MR-12` · **Data:** `MD-01`, `MD-12` · **Testy:** `IS-T1-TESTS-MOBILE-CACHE-FRESHNESS-STATES-TEST`, `IS-T1-TESTS-MOBILE-SCOPE-CLIENT-HINT-ONLY-TEST`

| Stav | Chování |
|---|---|
| `SS-01` | Skeleton sekcí |
| `SS-02` | Nenastane — nastavení má vždy hodnoty |
| `SS-03` | Hodnoty ze cache, **ovládací prvky neaktivní** |
| `SS-04` | Stáří viditelné; editace zamčená do refreshe |
| `SS-05` | Refresh při návratu na obrazovku |
| `SS-06` | Jako `MS-06` |
| `SS-07` | Desktop-only sekce (`R-5`) se **nezobrazují vůbec** — nejsou to uzamčené prvky, na telefon nepatří |
| `SS-08` | Cache čitelná, editace neaktivní |
| `SS-09` | Hodnota změněná na desktopu → převzít serverovou |
| `SS-10` | Čtení, bezpečné |

---

#### MS-11 — Nastavení, změna

**Požadavky:** `MR-13` · **Data:** `MD-01` · **Testy:** `IS-T1-TESTS-MOBILE-OFFLINE-MUTATIONS-REFUSED-TEST`, `IS-T1-TESTS-MOBILE-CACHE-STALE-BLOCKS-ACTION-TEST`, `IS-T1-TESTS-MOBILE-SCOPE-SECURITY-ROUTES-DENIED-TEST`

| Stav | Chování |
|---|---|
| `SS-01` | Ukládání s viditelným průběhem; hodnota se přepíše až po potvrzení serverem |
| `SS-02` | — |
| `SS-03` | **Změnit nelze.** Odmítnout hned, nic si nepamatovat (I-3) |
| `SS-04` | **Nad `STALE` se needituje** — jinak uživatel přepíše cizí čerstvou změnu |
| `SS-05` | Po reconnectu se rozdělaná změna **nepodá sama**; hodnota se načte znovu |
| `SS-06` | Zamítnout, odhlásit |
| `SS-07` | Bezpečnostní sekce nedosažitelná ani se scopem (PLAN.md §2, pravidlo 4) |
| `SS-08` | Odmítnout s vysvětlením |
| `SS-09` | Souběžná změna → ukázat obě hodnoty a nechat rozhodnout. Nikdy tiché přepsání |
| `SS-10` | Opakování až po načtení aktuální hodnoty, a s týmž klíčem operace (`MD-19`); nikdy slepé opakované uložení |

---

### Fáze 3 — Projekty a approvaly ★

---

#### MS-12 — Projekty: seznam a detail

**Požadavky:** `MR-14` · **Data:** `MD-02`, `MD-13` · **Testy:** `IS-T1-TESTS-MOBILE-CACHE-FRESHNESS-STATES-TEST`, `IS-T1-TESTS-MOBILE-OFFLINE-NEVER-QUEUED-TEST`

| Stav | Chování |
|---|---|
| `SS-01` | Skeleton |
| `SS-02` | „Žádné projekty" |
| `SS-03` | Seznam a **poslední známá fáze** ze cache, vždy se stářím |
| `SS-04` | Fáze projektu zastarává rychle — ukazatel stáří je zde důraznější |
| `SS-05` | Refresh; změna fáze se převezme bez ptaní (je serverová) |
| `SS-06` | Jako `MS-06` |
| `SS-07` | Uzamčeno |
| `SS-08` | Cache čitelná, akce neaktivní |
| `SS-09` | Fáze se změnila → převzít, a pokud na ní visela nabízená akce, akci stáhnout |
| `SS-10` | Čtení bezpečné; přechody fází se z telefonu neopakují (`MUT-NEVER-QUEUED`) |

---

#### MS-13 — Fronta approvalů

**Požadavky:** `MR-15` · **Data:** `MD-07` · **Testy:** `IS-T1-TESTS-MOBILE-OFFLINE-APPROVAL-HIDDEN-TEST`, `IS-T1-TESTS-MOBILE-OFFLINE-NEVER-QUEUED-TEST`

| Stav | Chování |
|---|---|
| `SS-01` | Skeleton; fronta se **vždy** načítá ze serveru, nikdy z cache |
| `SS-02` | „Nic nečeká" — jen po potvrzené odpovědi |
| `SS-03` | **Fronta se offline nezobrazí vůbec.** Ne prázdný seznam — explicitní „bez připojení nelze zobrazit" (`MD-07`) |
| `SS-04` | Nenastane: approvaly se necachují, tedy nemají co zastarat |
| `SS-05` | Po reconnectu plné načtení fronty |
| `SS-06` | Vyprázdnit z paměti, odhlásit |
| `SS-07` | Bez scope na approvaly obrazovka není dostupná; řekni proč |
| `SS-08` | Nezobrazovat nic než chybu — prázdná fronta by tu byla nebezpečná lež |
| `SS-09` | Položka mezitím rozhodnuta jinde → zmizí s poznámkou kým a kdy |
| `SS-10` | Načtení fronty je čtení; opakování bezpečné |

> Prázdná fronta a nedostupná fronta se v této obrazovce nesmí podobat ani
> vzdáleně. „Nic nečeká" znamená, že uživatel může jít od telefonu pryč.

---

#### MS-14 — Rozhodnutí o approvalu ★

**Požadavky:** `MR-16` · **Data:** `MD-07`, `MD-12` · **Testy:** `IS-T3-TESTS-MOBILE-CONTRACT-APPROVAL-IDEMPOTENCY-TEST`, `IS-T1-TESTS-MOBILE-OFFLINE-NEVER-QUEUED-TEST`, `IS-T1-TESTS-MOBILE-CACHE-STALE-BLOCKS-ACTION-TEST`, `IS-T1-TESTS-MOBILE-SCOPE-FAIL-CLOSED-TEST`

Nejcennější a nejnebezpečnější tok aplikace.

| Stav | Chování |
|---|---|
| `SS-01` | Rozhodovací tlačítka jsou neaktivní, dokud není načtený **kompletní** payload a jeho otisk |
| `SS-02` | Nenastane |
| `SS-03` | **Nedostupné. Nikdy fronta, nikdy „odešle se později"** (I-4) |
| `SS-04` | Nenastane — approval se nikdy nezobrazuje ze cache |
| `SS-05` | Po reconnectu se stav **znovu ověří dřív**, než se ukáže rozhodovací tlačítko |
| `SS-06` | Zahodit, odhlásit. Rozpracované rozhodnutí se neuchovává |
| `SS-07` | Chybí scope → **fail-closed**, zobrazit jen k náhledu bez rozhodování |
| `SS-08` | Rozhodnout nelze; řekni to bez náznaku, že se to zkusí znovu |
| `SS-09` | Approval mezitím vypršel, byl rozhodnut nebo se změnil payload → **rozhodnutí se zahodí**, načte se aktuální stav a začíná se znovu |
| `SS-10` | Opakování jen jako **idempotentní zopakování téhož rozhodnutí s týmž klíčem operace a týmž otiskem** (`MD-19`). Jiný otisk = jiná věc = nové rozhodnutí. Automatický retry **zakázán**. Klíč **neprodlužuje jednorázové oprávnění** approvalu (I-11) |

> Tři pravidla, která z tohoto toku dělají to, čím má být:
> 1. rozhoduje se **jen** o právě načteném stavu, nikdy o cachovaném;
> 2. rozhodnutí je vázané na otisk payloadu — změna payloadu ruší rozhodnutí;
> 3. druhé odeslání je rozpoznatelný konflikt, ne druhé schválení.
>
> Lokální vs. vzdálená TTL approvalu zůstává otevřená (`R-3`): pět minut je
> pro telefon, který je v kapse, nedosažitelných.

---

#### MS-15 — Průběh běhu (agent log)

**Požadavky:** `MR-07`, `MR-08` · **Data:** `MD-09` · **Testy:** `IS-T1-TESTS-MOBILE-PRIVACY-LOG-REDACTION-TEST`, `IS-T1-TESTS-MOBILE-CONTRACT-ERROR-STATES-TEST`

Náhrada za neexistující token streaming (PLAN.md §4, P6): **indikace postupu,
ne přepis běhu.**

| Stav | Chování |
|---|---|
| `SS-01` | „Čeká se na první událost" — s tím, že mlčení neznamená zamrznutí |
| `SS-02` | Běh bez událostí je legitimní; řekni to |
| `SS-03` | **Nedostupné.** Události se necachují (`MD-09`) |
| `SS-04` | Nenastane |
| `SS-05` | Po reconnectu se **události nedopočítávají**. Ukáže se poslední známý stav a označí mezera |
| `SS-06` | Zavřít, odhlásit |
| `SS-07` | Bez scope se běhy nezobrazují |
| `SS-08` | Ukázat přerušení, ne zamrzlý průběh |
| `SS-09` | Běh skončil jinak, než průběh naznačoval → autoritou je výsledek, ne poslední událost |
| `SS-10` | Znovupřipojení k proudu událostí je bezpečné; **znovuspuštění běhu není** a z této obrazovky nejde |

---

### Fáze 4 — Uchovávané informace

---

#### MS-16 — Uchovávané informace, čtení

**Požadavky:** `MR-17` · **Data:** `MD-06` · **Testy:** `IS-T1-TESTS-MOBILE-CACHE-ONLY-EXPLICIT-TEST`, `IS-T1-TESTS-MOBILE-PRIVACY-STORAGE-CLASS-TEST`

| Stav | Chování |
|---|---|
| `SS-01` | Skeleton |
| `SS-02` | „Zatím nic uloženo" |
| `SS-03` | Jen položky, které byly zobrazené a cachované — cache je zde úmyslně úsporná (`MD-06`) |
| `SS-04` | Stáří viditelné |
| `SS-05` | Refresh |
| `SS-06` | Jako `MS-06` |
| `SS-07` | Uzamčeno |
| `SS-08` | Cache čitelná |
| `SS-09` | Položka zanikla nebo zeslábla (decay) → převzít serverový stav |
| `SS-10` | Čtení bezpečné. **Mazání paměti z telefonu není v 1.0** (PLAN.md §5) |

---

#### MS-17 — Ruční poznámka

**Požadavky:** `MR-18` · **Data:** `MD-06`, `MD-14` · **Testy:** `IS-T1-TESTS-MOBILE-OFFLINE-MUTATIONS-REFUSED-TEST`, `IS-T1-TESTS-MOBILE-OFFLINE-DRAFT-NO-AUTOSEND-TEST`

| Stav | Chování |
|---|---|
| `SS-01` | Ukládání s potvrzením serveru |
| `SS-02` | — |
| `SS-03` | Uložit nelze; text zůstává jako lokální draft, **neodesílá se sám** |
| `SS-04` | Nevadí — nová poznámka nepřepisuje cizí stav |
| `SS-05` | Draft se obnoví, čeká na uživatele |
| `SS-06` | Jako `MS-08` |
| `SS-07` | Zápis do paměti bez scope je uzamčený |
| `SS-08` | Odmítnout, text zachovat |
| `SS-09` | Konflikt je nepravděpodobný (přidání), ale duplicita ano → opakování jen s týmž klíčem operace (`MD-19`) |
| `SS-10` | Jako výše. `UNKNOWN` se řeší přečtením seznamu poznámek, ne druhým uložením |

---

### Fáze 5 — Workeři

---

#### MS-18 — Agenti: stav a historie běhů

**Požadavky:** `MR-19` · **Data:** `MD-17`, `MD-09` · **Testy:** `IS-T1-TESTS-MOBILE-CACHE-FRESHNESS-STATES-TEST`, `IS-T1-TESTS-MOBILE-OFFLINE-NEVER-QUEUED-TEST`

| Stav | Chování |
|---|---|
| `SS-01` | Skeleton |
| `SS-02` | „Žádní agenti" |
| `SS-03` | Stav ze cache se stářím; **výstupy běhů nedostupné** (`MD-17`) |
| `SS-04` | Stav agenta zastarává rychle; ukazatel je důrazný |
| `SS-05` | Refresh |
| `SS-06` | Jako `MS-06` |
| `SS-07` | Uzamčeno |
| `SS-08` | Cache čitelná, ovládání neaktivní |
| `SS-09` | Agent mezitím doběhl nebo byl vypnut → převzít serverový stav |
| `SS-10` | Čtení bezpečné; **spuštění a pozastavení jsou příkazy a neopakují se automaticky** |

---

#### MS-19 — Dry-run agenta

**Požadavky:** `MR-20` · **Data:** `MD-17`, `MD-09` · **Testy:** `IS-T1-TESTS-MOBILE-OFFLINE-NEVER-QUEUED-TEST`, `IS-T1-TESTS-MOBILE-SCOPE-FAIL-CLOSED-TEST`

| Stav | Chování |
|---|---|
| `SS-01` | Průběh přes `MS-15` |
| `SS-02` | Dry-run bez výstupu je platný výsledek |
| `SS-03` | **Nelze.** Dry-run je příkaz, byť neškodný (`MUT-NEVER-QUEUED`) |
| `SS-04` | Nespouštět nad `STALE` definicí agenta |
| `SS-05` | Po reconnectu se **nespouští znovu sám** |
| `SS-06` | Zahodit, odhlásit |
| `SS-07` | Fail-closed |
| `SS-08` | Odmítnout |
| `SS-09` | Definice agenta se mezitím změnila → načíst znovu a nechat potvrdit |
| `SS-10` | Opakování jen s týmž klíčem operace (`MD-19`); nikdy automaticky. `UNKNOWN` → přečíst stav běhu, ne spustit znovu |

> Vytváření agentů je mimo 1.0 (PLAN.md §5). Dry-run je nejsilnější operace,
> kterou telefon nad agenty smí — a i ta je příkaz.

---

## 5. Průřezová pravidla

Platí ve všech tocích; opakují se, protože se v návrzích obrazovek nejčastěji
ztratí.

| # | Pravidlo |
|---|---|
| **C-1** | Prázdno se od nedostupnosti musí lišit **vždy a na první pohled** (`SS-02` × `SS-03` × `SS-08`) |
| **C-2** | Cachovaný obsah nese stáří **na obrazovce**, ne v detailu nebo v nastavení |
| **C-3** | Hranice cachovaného okna je viditelná; neúplný seznam se nikdy netváří jako úplný |
| **C-4** | Nedostupná akce je **uzamčená a vysvětlená**, ne skrytá — kromě desktop-only sekcí, které na telefon nepatří vůbec |
| **C-5** | Žádná fronta. Odmítnutá operace je odmítnutá, ne odložená |
| **C-6** | Automatické opakování je povolené jen u čtení. U operací s vedlejším účinkem nikdy |
| **C-7** | Revokace se od expirace liší chováním, ne jen textem: revokace maže cache |
| **C-8** | Přerušený turn se označí jako přerušený; nepředstírá se pokračování |
| **C-9** | Žádná obrazovka nezobrazí token — ani zkrácený, ani jako otisk |
| **C-10** | Změna serverového stavu se přebírá; klient nikdy nevyhrává konflikt sám |
| **C-11** | **Nejasný výsledek je stav, ne chyba.** `UNKNOWN` se řeší přečtením serverového stavu, nikdy novým klíčem ani slepým opakováním |
| **C-12** | **Nerozřešené pokusy blokují další mutace.** Po dosažení stropu se mutace odmítá fail-closed; strop se uvolňuje rozřešením, nikdy vytlačením nejstaršího záznamu |
| **C-13** | Klient **nikdy nesestaví náhradní požadavek** za ztracený originál. Buď má přesný původní obsah a opakuje s týmž klíčem, nebo uživatel provede novou operaci s novým klíčem |

### 5.1 Klíč operace — `D-S1`, rozhodnuto

Bez tohoto modelu je `SS-10` u `MS-08`, `MS-11`, `MS-14`, `MS-17` a `MS-19`
nesplnitelný, protože „opakuj bezpečně" nemá čím být bezpečné.

| Pravidlo | Důsledek pro obrazovku |
|---|---|
| Klient vydá pro každou **logickou mutaci** náhodný 128bitový `operationId` | Tlačítko, které mutuje, drží klíč od prvního stisku |
| Tentýž klíč přežije **všechny síťové retry téže operace** | „Zkusit znovu" po chybě sítě neplodí druhý efekt |
| **Nové vědomé provedení = nový klíč** | Uživatel, který stiskne odeslat podruhé záměrně, odesílá skutečně podruhé |
| Server deduplikuje podle `(deviceId, operationId)` | Tentýž klíč + tentýž otisk vrátí původní výsledek |
| Tentýž klíč + **jiný payload** → fail-closed konflikt | Editace textu po neúspěšném odeslání **musí** vyrobit nový klíč, jinak skončí konfliktem — a to je správně |
| Nejasný timeout → `UNKNOWN`, **nikdy nový klíč automaticky** | Obrazovka ukáže „výsledek neznámý" s nabídkou načíst aktuální stav, ne s tlačítkem „poslat znovu" |
| Klíč **neopravňuje** | U approvalů, bezpečnostních a administrativních operací nenahrazuje ani neprodlužuje jednorázové oprávnění (I-11, I-4) |
| **Stav se zjišťuje podle klíče, bez payloadu** | Po reconnectu se obrazovka ptá „jak dopadl tenhle pokus", ne „pošli to znovu" |
| Server klíč **nezná** → retry jen s dostupným původním kanonickým požadavkem | Obsah pokusu už není k dispozici → obrazovka nabídne **vědomé nové provedení**, ne tiché zopakování |
| **Strop neuzavřených operací** | Po jeho dosažení se další mutace **odmítne** (fail-closed), dokud uživatel visící pokusy nerozřeší |

Detailní model včetně stavů žurnálu, obnovy bez payloadu, pravdivého významu
revokace a stropu neuzavřených záznamů je `MD-19` §4.1–§4.3
v [DATA-MODEL.md](DATA-MODEL.md).

---

## 6. Otevřená rozhodnutí

| # | Otázka | Doporučení |
|---|---|---|
| ~~`D-S1`~~ | Klientský klíč operace | **ROZHODNUTO** operátorem — závazný model v §5.1 a `MD-19` |
| **D-S2** | Ukazuje `MS-13` počet čekajících approvalů na domovské obrazovce, když je fronta necachovaná? | Ano, ale jen jako živý údaj; offline zmizí, nezůstane zastaralé číslo |
| **D-S3** | Má `MS-09` nabízet serverové hledání mimo cachované okno? | Ano ve fázi 1, jinak je hledání matoucí |
| **D-S4** | Vejde se `MS-04` (správa zařízení) do fáze 0, nebo je to fáze 2? | Fáze 0 — bez odvolání zařízení nemá `P-9` smysl |

---

## 7. Co v mapě záměrně není

Vytváření agentů a specialistů, editace skillů, marketplace, cokoli se shell
přístupem, iOS, cloud push a přechody lifecycle fází z telefonu. Mimo 1.0
podle PLAN.md §5 a §9 — a `MS-12` je proto čtecí obrazovka, ne ovládací panel.

---

*Navazuje: coverage matice — požadavky × toky × rizika × testovací ID.*
