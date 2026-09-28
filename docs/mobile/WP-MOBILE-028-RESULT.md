# WP-MOBILE-028 — co bylo uděláno

**Zadání:** [`WP-MOBILE-028-HISTORY-PAGINATION.md`](WP-MOBILE-028-HISTORY-PAGINATION.md)
**Větev:** `wp/mobile-refresh-20260809` · worktree `/home/belphareon/worktrees/is-mobile-refresh`
**Vstup:** `c5cd3001` → ověření `bb01c097` → implementace (tento commit)
**Rozhodnutí operátora:** varianta **A** (§4 zadání) — kotva na konec streamu.
Push zamítnut, větev zůstává lokální.

---

## 1. Ověření (`bb01c097`) — odpověď na `PLAN.md` §5.1

Otázka zněla, jestli je stávající kurzor použitelný. Změřeno proti běžící
gateway, ne odvozeno z kódu:

| Zjištění | Stav |
|---|---|
| Úplný průchod 250 zpráv bez ztráty a duplicity, pořadí stabilní | ✅ |
| Explicitní konec; poslední stránka nevydá kurzor | ✅ |
| Přesný násobek stránky (200 po 50) → 4 stránky, poslední plná *a* `end: true` | ✅ |
| Odmítnutí s rozlišeným důvodem, `restart: true`, bez stránky v těle | ✅ |
| Offset stabilní pod souběžným appendem | ✅ (jen díky append-only ASC) |
| **Směr pro `MS-07`** | ❌ jen dopředu od nejstarší |

**Vada, kterou to odhalilo.** Klient posílal `?limit=100` — přesně serverový
strop — a odpověď vykresloval jako celou historii. U konverzace o 250 zprávách
tím zobrazil zprávy 1–100, nejnovější výměnu neukázal a **na obrazovce to nic
neříkalo**. Server přitom vracel `hasMore: true`, kurzor i `messageCount: 250`;
klient všechna tři pole ignoroval. To je tiché useknutí zakázané `SS-03` (I-2),
nikoli chybějící funkce.

---

## 2. Implementace — varianta A

### 2.1 Server

`GET /m1/conversations/:id` přijímá `anchor=latest`: otevře chůzi na nejnovější
zprávě a vydá kurzor mířící do minulosti. Směr žije **uvnitř kurzoru**
(`protocol.js`, `CURSOR_FORWARD` / `CURSOR_BACKWARD`), ne v query stringu — jinak
by klient mohl otočit cizí kurzor a dostat stránku z opačného konce.

- `paginateBackward` nepotřebuje over-fetch: `start > 0` odpovídá na „je něco
  staršího" přesně. `end: true` u zpětné chůze znamená „držíš nejstarší zprávu".
- Zprávy uvnitř stránky zůstávají vzestupně — chůze jde pozpátku, stránka ne.
- Odpověď nese nově `direction`, aby `end` nebyl dvojznačný (§8.7).
- **Zpětná kompatibilita:** bez `anchor` se nic nezměnilo. Dopředné kurzory
  vydané dřív mají nezměněný tříprvkový payload, takže dál sedí na svůj checksum.
- `anchor=banana`, `anchor=` i `anchor` s `cursor` → `400 bad_request`
  s pojmenovaným `reason`. **Neznámý parametr se nesmí propadnout na první
  stránku** — právě tak klient uvěří, že drží nejnovější zprávy.

### 2.2 Klient

- `loadThread` otevírá `?anchor=latest&limit=50`. `THREAD_PAGE_SIZE` je 50, ne
  100: strop nikdy nebyl „celá historie".
- `loadOlderMessages` prodlouží okno o jednu serverem vydanou stránku a
  **předřadí** ji. Nic nepočítá — §8.2 to stejně znemožňuje, ale klient se o to
  ani nepokouší (hlídá strukturální test).
- `SS-03`: starší okraj okna je **vždy** popsaný. Tlačítko, když jde stránkovat;
  věta „Starší zprávy vyžadují připojení", když ne; „Začátek konverzace", když
  opravdu nic staršího není. Třetí případ je ten, který by tiše shnil — bez něj
  vypadá „vršek načteného" a „začátek konverzace" stejně.
- `SS-10`: `cursor_unknown` → **plný refresh vlákna**, nikdy dopočet.
- Cache drží okno **i to, kam došlo**. Záznam bez té informace (zapsaný starším
  klientem) se považuje za neúplný — fail-safe směrem k přiznání, ne k mlčení.
- Selhané dotažení starší stránky nechá okno na obrazovce: bylo pravdivé, když
  se načetlo.
- **Kotvení scrollu.** `render()` překresluje celou obrazovku a chat pak
  bezpodmínečně sjížděl dolů. Předřazení stránky by tím čtenáře strhlo zpátky
  na nejnovější zprávu — tedy pryč od toho, co si právě vyžádal. Pozice se teď
  měří jako vzdálenost **od spodku** (jediná reference, která při vkládání
  nahoru drží) a obnovuje se. Skok dolů zůstal tam, kam patří: otevření
  konverzace a odeslání zprávy.

---

## 3. Testy

| Sada | ID | Testů |
|---|---|---:|
| `mobile-contract-cursor-rejection.test.js` | `IS-T2-…-CONTRACT-CURSOR-REJECTION-TEST` | 10 |
| `mobile-contract-pagination-end.test.js` | `IS-T2-…-CONTRACT-PAGINATION-END-TEST` | 20 |
| `mobile-ms07-history.test.js` | `IS-T1-TESTS-MOBILE-MS07-HISTORY-TEST` | 15 |

Charakterizace „nejnovější stránku nejde vyžádat přímo" byla podle §5 Fáze A bodu 3 zadání
**přepsána, ne smazána** — drží teď opačné tvrzení. Test „jeden dopředný request
o velikosti stropu nedosáhne na nejnovější zprávu" zůstal: dokládá, proč se
kotva musela zavést.

### 3.1 Ověření mutací

| Mutace | Zachyceno |
|---|---|
| `hasMore = rows.length === limit` | 7 z 11 |
| `nextCursor` vydán vždy | 6 z 11 |
| kontrola `stream` odstraněna | 2 z 10 |
| checksum se neověřuje | 3 z 10 |
| klient zahodí `anchor` (původní vada) | 3 z 15 |
| hranice okna se nevykreslí při neznámém rozsahu | 2 z 15 |
| odmítnutý kurzor splétá místo refreshe | 1 z 15 |
| server ignoruje neznámý `anchor` | 1 z 20 |
| zpětná stránka ztratí poslední řádek | 4 z 20 |
| render sjede dolů i po předřazení stránky | 1 z 14 (prohlížeč) |

---

## 4. Vedlejší nález — dvě vady `§8`, které nikdo neměřil

Prohlížečová sada renderovala pět obrazovek; **chat mezi nimi nebyl**. Po
přidání `MS-07` okamžitě spadla na dvou cílech, které tam ležely celou dobu:

| Prvek | Bylo | Je |
|---|---|---|
| `.composer textarea` | 300 × **40** | 48 dp (`min-height` + padding, `autoGrow` funguje dál) |
| `.send-btn` | **34 × 34** | 48 × 48, ikona 20 px |

`.send-btn` byl nejmenší ovládací prvek aplikace a zároveň ten nejčastěji
mačkaný. Nesouvisí s `MR-05`; našlo se to jen proto, že obrazovka poprvé prošla
prohlížečem. Sada teď renderuje `MS-07` ve dvou stavech okna, takže hranice
i composer se měří jako každý jiný cíl.

---

## 5. Stav na tomto commitu

```
test:mobile              464 PASS / 0 FAIL (21 sad)
test:mobile:browser       14 PASS (8 povrchů)
test:registry            399 programů
artifact-validation      151 PASS
repository-hygiene      1588 cest
module-boundary-ratchet  added=0
check-migration-numbers  bez kolize
```

Z jádra do `src/mobile/` dál nevede žádná hrana. Nová routa nevznikla —
allow-list má pořád třináct položek.

---

## 6. Co tenhle WP **ne**udělal

| | Proč |
|---|---|
| Nezměnil stavové řádky `MR-05` v `COVERAGE.md` / `SCREENS.md` / `PLAN.md` | Klasifikace je akt review autority (§0 zadání). Kód existuje a je ověřený; `PARTIAL` → cokoli dalšího patří review |
| Nezaložil nález na tiché useknutí ani na dva `§8` cíle | Totéž — zakládání nálezů je review autorita, ne implementace |
| Nepushnul větev | Operátor zamítl; mění registry fingerprint pod běžící Gate 1 evidencí |
| Nesáhl na `MR-07`, `MR-10`, `MR-14` | Dál `BLOCKED_BY_CONTRACT` |

---

## 7. Co potřebuje operátora

1. **Review klasifikace `MR-05`.** Stránkování je implementované a ověřené
   v obou směrech; jestli to `PARTIAL` mění, rozhoduje review, ne tenhle WP.
2. **Kontraktní status `anchor`.** Operátor schválil aditivní parametr. Formální
   refreeze kontraktu v2 to není — pokud kontraktní autorita usoudí, že tvar
   requestu pod zmrazený povrch spadá, `MR-05` projde kolem `DR-008`.
3. **Nálezy** na tiché useknutí (§1) a na dva `§8` cíle (§4).
4. **Převod stylesheetu na `rem`** jako samostatný WP
   (`WP-MOBILE-027-RESULT.md` §7) — dokud klient zůstane v px, `§10` na 200 %
   písma nejde ani vyzkoušet.
