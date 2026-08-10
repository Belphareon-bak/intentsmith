# WP-MOBILE-028 — kurzorové stránkování historie konverzace (`MR-05`)

**Typ:** zapisující WP · **Adresát:** nová session
**Vstupní revision:** `c5cd3001` + tento commit · větev `wp/mobile-refresh-20260809`
**Worktree:** `/home/belphareon/worktrees/is-mobile-refresh`
**Nadřazená pravidla:** [`CONTRACT.md`](../../CONTRACT.md) · [`ROADMAP.md`](../../ROADMAP.md)
**Předchůdce:** [`WP-MOBILE-027-COMPLETION.md`](WP-MOBILE-027-COMPLETION.md) · [`WP-MOBILE-027-RESULT.md`](WP-MOBILE-027-RESULT.md)

> **Stav: uzavřeno.** Operátor rozhodl §4 ve prospěch **varianty A**; §5 je
> hotové a doložené. Výsledek je v
> [`WP-MOBILE-028-RESULT.md`](WP-MOBILE-028-RESULT.md). Tenhle dokument zůstává
> jako zadání a jako záznam ověření, kterým §2 odpovědělo na `PLAN.md` §5.1.
> Strop v §0 přestal platit jen v jediném bodě — v tom, který operátor schválil.

---

## 0. Strop — co tenhle WP dělat NESMÍ

Platí celý strop z [`WP-MOBILE-027-COMPLETION.md`](WP-MOBILE-027-COMPLETION.md) §0
beze změny. Navíc, specificky pro tenhle WP:

| Zakázáno | Proč |
|---|---|
| Přidat parametr do requestu `/m1/conversations/:id` bez rozhodnutí operátora | To je právě otevřená otázka §4. Povrch je source-policy-frozen; rozšíření se špatně vrací |
| Nechat klienta spočítat nebo inkrementovat kurzor | §8.2: klient by si vymyslel pozici, kterou server nevydal. Kurzor je opaque a checksumovaný — nejde to ani omylem |
| Dopočítat chybějící úsek po odmítnutém kurzoru | `SS-10` chce **plný refresh**. Dopočet by tiše slepil dvě různé verze streamu |
| Stavět lokální hledání nad načteným oknem | `MR-10` je `BLOCKED_BY_CONTRACT`; TEST-STRATEGY §7 to jmenuje jako zakázanou náhražku |
| Měnit stavové řádky `MR-05` v `COVERAGE.md`/`SCREENS.md`/`PLAN.md` na `IMPLEMENTED` | Klasifikace je akt review autority, ne implementace. WP zapíše výsledek, stav mění review |

---

## 1. Kde to je a jak to rozjet

```bash
cd /home/belphareon/worktrees/is-mobile-refresh
npm ci --offline
npm run test:mobile          # 20 sad, musí být 440 passed / 0 failed
```

Server: `src/mobile/handlers.js` (`handleConversationDetail`, ř. 147),
kurzor a stránkování `src/mobile/protocol.js` (`encodeCursor`, `decodeCursor`,
`paginate`, §8.2 a §8.6).
Klient: `src/mobile/client/app.js`, `loadThread` (ř. 2326).

> **Past:** `app.js` obsahuje pět bajtů `\0` jako sentinel v markdown rendereru
> (~ř. 498). `file` ho proto hlásí jako `data` a **`grep` bez `-a` v něm mlčky
> nenajde nic** — ani `const`. Vždycky `grep -a`.

---

## 2. Co už je ověřené — a nemusíš to dělat znovu

Otázku z `PLAN.md` §5.1 („je-li stávající kurzor použitelný, nejde o změnu
veřejného kontraktu") tenhle WP **zodpověděl měřením proti běžící gateway**, ne
čtením kódu. Důkaz drží dvě nové sady:

| Sada | ID | Testů |
|---|---|---:|
| `tests/mobile-contract-cursor-rejection.test.js` | `IS-T2-TESTS-MOBILE-CONTRACT-CURSOR-REJECTION-TEST` | 10 |
| `tests/mobile-contract-pagination-end.test.js` | `IS-T2-TESTS-MOBILE-CONTRACT-PAGINATION-END-TEST` | 11 |

Obě jsou v `test:mobile`, v registru `ACTIVE`, profil `database`, fixture
`owned-loopback-gateway`. Obě byly ověřené mutací (§7), ne domněnkou.

### 2.1 Mechanismus kurzoru je v pořádku — použitelný

**[F]** Změřeno, ne odvozeno:

- **Úplný průchod bez ztráty a bez duplicity.** 250 zpráv po 50 → přesně
  5 stránek, každá zpráva právě jednou, pořadí stabilní přes hranice stránek.
- **Konec je explicitní.** Poslední stránka hlásí `end: true`, `hasMore: false`
  a **nevydá další kurzor**. Klient tedy nemůže donekonečna stránkovat prázdný
  ocas.
- **Přesný násobek stránky končí čistě.** 200 zpráv po 50 → 4 stránky; čtvrtá je
  plná *a přesto* `end: true`. Tohle je případ, kvůli kterému §8.6 přifetchuje
  jeden řádek navíc — naivní `items.length === limit` by tu hlásil pátou stránku.
- **Prázdná konverzace je okamžitý potvrzený konec**, ne nedokončený stream
  (rozdíl `SS-02` vs `SS-03`).
- **Offset přežije souběžný zápis.** Vložení nové zprávy uprostřed průchodu
  nezpůsobí přeskočení ani zdvojení. Offsetové stránkování tohle obecně
  negarantuje; platí to **jen** proto, že stream je append-only a řazený
  vzestupně, takže insert padne za každý už vydaný offset. Kdyby se řazení
  změnilo na `DESC` nebo přibylo mazání zpráv, tahle vlastnost padá — test to
  hlídá.
- **`limit` se ořezává** na `MAX_PAGE_SIZE = 100`, nikoli odmítá.

### 2.2 Odmítnutí kurzoru má na čem stavět `SS-10`

**[F]** Odmítnutý kurzor vrací `400`, `error.code = cursor_unknown`,
`restart: true`, `retryable: false`, **a žádnou stránku ani další kurzor**.
Tři důvody se rozlišují a nesplývají:

| Reason | Znamená | Ověřeno na |
|---|---|---|
| `cursor_malformed` | tohle není kurzor | `nonsense`, `c1.only-two-parts`, `c2.abc.def`, `....` |
| `cursor_unrecognized` | kurzor, ale nevydal jsem ho já | podvržený checksum; **podvržená `position`** (pokus přeskočit dopředu) |
| `cursor_stream_mismatch` | kurzor jiného streamu | kurzor seznamu na vlákně, kurzor vlákna na seznamu, kurzor **sourozenecké konverzace** |

Podvržená `position` je ten důležitý: server ji **neobslouží**, takže klient
nemůže obejít §8.2 ani úmyslně.

### 2.3 Ale směr je pro `MS-07` obrácený — a to je jádro věci

**[F]** Server stránkuje `ORDER BY id ASC` od offsetu 0, tedy **od nejstarší
zprávy**. `MS-07` potřebuje opak: při otevření nejnovější zprávy a hranici okna
na **starším** konci — `SS-03` říká doslova „na konci okna stojí *starší zprávy
vyžadují připojení*".

**[F]** Změřeno na dnešním klientovi: `loadThread` posílá `?limit=100`, což je
přesně strop. U konverzace s 250 zprávami dostane zprávy **1–100**. Nejnovější
zpráva v odpovědi **není**. Server přitom pravdu říká — vrací `hasMore: true`,
vydá `nextCursor` a hlásí `messageCount: 250` — a klient všechna tři pole
ignoruje.

**[F]** Nejnovější stránku dnes **nejde vyžádat přímo**. `offset`, `order`,
`before`, `anchor` ani `direction` nejsou odmítnuté — jsou **tiše ignorované**
a vrátí stránku jedna. Jediná cesta na konec streamu je projít všechny stránky
dopředu.

> **Kandidát na nález — patří review autoritě, ne tomuhle WP.**
> Nejde o chybějící funkci, ale o **vadu, která je v repu už dnes**: MS-07
> u konverzace delší než 100 zpráv zobrazí začátek historie, nejnovější výměna
> chybí a **na obrazovce to nic neříká**. To je přesně tiché useknutí, které
> `SS-03` zakazuje (I-2). Existuje nezávisle na tom, že stránkování chybí —
> nepostaví se „stránkováním navíc", je to špatný první request.
> Stavové řádky proto tenhle WP nemění; zakládám to stejně jako `F-043`,
> `F-112`, `F-015` a nález o dynamickém písmu z `WP-MOBILE-027-RESULT.md` §7.

---

## 3. Odpověď na podmínku z `PLAN.md` §5.1

Podmínka zní: *„Je-li stávající kurzor na `/m1/conversations` pro tento účel
použitelný, nejde o změnu veřejného kontraktu a kontraktní kolo se kvůli tomu
neotevírá."*

**Odpověď je dvojí a je potřeba ji číst celou:**

- **Mechanismus ano.** Kurzor, `hasMore`, `end`, odmítnutí i stabilita offsetu
  jsou hotové a správné. Na *stránkování jako takové* kontraktní kolo netřeba.
- **Pro `MS-07` ale nestačí.** Dnešní povrch umí jen dopředu od nejstarší.
  Obrazovka potřebuje nejnovější napřed a hranici na starším konci.

Tím pádem **předpoklad z předchozího handoffu — že `MR-05` je jediná mezera,
která `DR-008` nepotřebuje — neplatí bez výhrady.** Platí pro mechanismus,
neplatí pro směr. Rozhodnutí v §4 je právě o tom, jestli ten směr je změna
veřejného kontraktu.

---

## 4. Rozhodnutí, které tenhle WP potřebuje **před** implementací

**[?] Otázka pro operátora / kontraktní autoritu:** je přidání *request
parametru* na existující allow-listovanou routu změna veřejného kontraktu?

`GATEWAY.md` ř. 161–162 mluví o **13-route** allow-listu a říká, že není
autoritou k jeho rozšíření. Parametr novou routu nepřidává — allow-list se
nedotkne. Jestli se ale „source-policy-frozen povrch" vztahuje i na tvar
requestu, je věc výkladu, kterou nemá rozhodnout implementace.

| | Varianta | Cena | Kontraktní dopad |
|---|---|---|---|
| **A** ★ | Server dostane kotvu na konec streamu — např. `?anchor=latest`, který vrátí poslední stránku a kurzor **dozadu** | Malá, aditivní; nová routa nevzniká | **Rozšiřuje request contract.** Potřebuje ruling |
| **B** | Klient projde všechny stránky dopředu až na konec | Žádný kontraktní dopad | `O(n)`: 5 000 zpráv = 50 round-tripů **při každém otevření**, kde cache nestačí. Nepoužitelné |
| **C** | Nechat historii nejstarší-napřed | Žádný | Rozporuje `SS-03` i `MS-07`. Zamítnuto |

**[R] Doporučení: A.** B je technicky bez rizika a prakticky neúnosné; C mění
požadavek, což WP nesmí.

> Varianta „stáhnout jednou a pak jen delty" se do samostatné možnosti neskládá:
> delta je dotaz „co je po zprávě X", tedy tentýž chybějící parametr, a první
> otevření dlouhé konverzace stojí plný průchod tak jako tak.

**Dokud tohle rozhodnutí nepadne, §5 se nezačíná.** Ověřovací část (§2) je
hotová a stojí samostatně — proto je tenhle WP zapsaný i bez rozhodnutí.

---

## 5. Práce po rozhodnutí — v pořadí závislostí

### Fáze A — server (jen u varianty A; u B odpadá)

1. `handleConversationDetail` přijme kotvu na konec streamu a vydá kurzor mířící
   **dozadu**. Kurzor zůstává opaque a checksumovaný; směr patří dovnitř
   payloadu, ne do klienta.
2. `paginate` musí u zpětného směru držet tytéž záruky, které §2.1 měří dopředu:
   explicitní konec, žádný kurzor na konci, přesný násobek stránky bez fantomové
   stránky navíc.
3. `IS-T2-TESTS-MOBILE-CONTRACT-PAGINATION-END-TEST` se rozšíří o zpětný směr.
   **Test „nejnovější stránku nejde vyžádat přímo" se tím stane nepravdivým —
   přepiš ho, nemaž.** Má zůstat jako doklad, že se to změnilo vědomě.

### Fáze B — klient

4. `loadThread` přestane posílat `limit=100` jako celou historii a začne
   respektovat `hasMore`/`nextCursor`/`end`.
5. `SS-03`: na starším konci okna **viditelná hranice** — „starší zprávy
   vyžadují připojení". Nikdy prázdno, nikdy tiché useknutí.
6. `SS-10`: `cursor_unknown` → **plný refresh vlákna**, nikdy dopočet. Server
   pro to už posílá `restart: true` (§2.2).
7. Cache (`MD-13`) drží okno a poslední **potvrzený** kurzor, ne dopočítaný.
8. Dotažení starší stránky nesmí uskočit scrollem — pozice se drží na zprávě,
   kterou uživatel čte.

### Fáze C — dokumentace

9. `WP-MOBILE-028-RESULT.md` ve tvaru `WP-MOBILE-027-RESULT.md`: co se udělalo,
   na jakém SHA, jaké mutace to ověřily.
10. Stavové řádky `MR-05` **nechat na review** (§0).

---

## 6. Definice hotovo

| # | Kritérium | Jak se pozná |
|---|---|---|
| 1 | Konverzace delší než jedna stránka jde přečíst celá | Test projde 250 zpráv bez ztráty a duplicity |
| 2 | Otevření dlouhé konverzace ukáže **nejnovější** zprávu | Test na tail konverzace o 250 zprávách |
| 3 | Hranice okna je vidět | `SS-03` řetězec v DOM na starším konci, ne prázdno |
| 4 | Odmítnutý kurzor → plný refresh | `SS-10`, ověřeno mutací |
| 5 | Klient nikdy nekonstruuje kurzor | Grep: `encodeCursor` se v `client/` nevyskytuje |
| 6 | `npm run test:mobile` zelené | 20+ sad, 0 failed |
| 7 | Registr, hygiena, ratchet, artefakty zelené | §7 |
| 8 | Žádná nová `/m1` routa | `gateway-policy.js` má dál 13 rout |

---

## 7. Ověřovací příkazy

```bash
npm run test:mobile                          # 440 passed / 0 failed (20 sad)
npm run test:mobile:browser                  # 12 passed (potřebuje chromium)
npm run test:registry                        # 398 programů; při změně registru
node scripts/validate-test-registry.js --write-doc   # ...regeneruj derivovaný doc
node tests/artifact-validation.test.js       # 151 passed — hlídá počty v README.md
node tests/repository-hygiene.test.js        # 1588 cest
node scripts/module-boundary-ratchet.mjs     # added=0
node scripts/check-migration-numbers.mjs     # před každou novou migrací
```

**Mutace, kterými byly sady §2 ověřené** (každá zvlášť, pak vrátit):

| Mutace v `src/mobile/protocol.js` | Zachyceno |
|---|---|
| `hasMore = rows.length === limit` | 7 z 11 |
| `nextCursor` vydán vždy | 6 z 11 |
| kontrola `stream` odstraněna | 2 z 10 |
| checksum se neověřuje | 3 z 10 |

---

## 8. Pasti, na které jsem narazil

| Past | Co se stane | Jak se jí vyhnout |
|---|---|---|
| **`grep` v `app.js`** | Mlčky nenajde nic, ani `const` — soubor má `\0` sentinely a je pro grep binární | Vždy `grep -a` |
| **`message_count` má trigger** | `messages_count_ai` z baseline migrace sloupec udržuje sám. Kdo ho v testu naplní ručně, dostane dvojnásobek a `conversation.messageCount` tiše lže | Seedovat 0 a nechat trigger počítat |
| **Počty v `README.md`** | Registr je zdroj pravdy; `artifact-validation` spadne na `396 ≠ 398`, ale jmenuje jen „state counts" | Po každé změně registru synchronizovat ř. 10–11 v `README.md` |
| **`test:registry` po přidání sady** | Spadne na `TEST-REGISTRY.md is stale` | `node scripts/validate-test-registry.js --write-doc` |
| **Tier v novém ID** | `offline`/T1 je „čistá logika bez sítě, DB a serveru". Sada s vlastní gateway je `database`/T2 | Odvodit tier z profilu **než** se ID zmrazí |

---

## 9. Co potřebuje operátora, ne agenta

1. **Rozhodnutí §4** — je request parametr změna veřejného kontraktu? Bez toho
   se `MR-05` nezačne a `DR-009` (Fáze 1) zůstává otevřená.
2. **Založení nálezu** na tiché useknutí MS-07 (§2.3) — vada existuje dnes,
   nezávisle na stránkování.
3. **Push/merge větve** — mění `tests/registry.json` fingerprint, o který se
   opírá běžící Gate 1 evidence. Tenhle WP proto **jen commituje, nepushuje**.
4. **Přejmenování ID.** `SCREENS.md` a `TEST-STRATEGY.md` slibovaly obě sady jako
   `IS-T1-…`. Profil je ale `database`, tedy T2, a TEST-STRATEGY §2.1 žádá, aby
   se **nové** mobilní ID odvodilo správně a teprve pak zmrazilo. ID nebyla nikdy
   vydaná do registru, takže na ně žádná evidence neodkazuje; srovnal jsem
   dokumentaci na `IS-T2-…` a profil ve sloupci na `database`. Jestli má
   přednost slíbený tvar, je to k vrácení — ale pak se rozchází ID s tierem.

---

**Autorita:** tenhle dokument je zadání a záznam ověření. Klasifikaci `MR-05`,
zakládání nálezů a release rozhodnutí nemění.
