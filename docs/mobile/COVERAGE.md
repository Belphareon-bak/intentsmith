# IntentSmith Mobile — coverage matice

**Status:** návrh k review; **žádný řádek zde není evidence**
**Datum:** 2026-07-30
**Ověřeno proti:** `54913a1` na `codex/intentsmith-1.0`
**Spojuje:** [DATA-MODEL.md](DATA-MODEL.md) · [TEST-STRATEGY.md](TEST-STRATEGY.md) · [SCREENS.md](SCREENS.md) · [PLAN.md](PLAN.md) · [ADR 0001](../adr/0001-mobile-data-ownership.md)

---

## 0. Co tento dokument je a co není

**Je:** jediné místo, kde se dá ověřit, že požadavek má obrazovku, obrazovka má
pravidlo, pravidlo má datový typ a všechno to má plánovaný test. Slouží
k hledání děr, ne k prokazování hotovosti.

**Není evidence.** Ani jedna ze 46 testovacích identit zde uvedených dnes
neexistuje jako program. Autoritou o tom, co je zelené, zůstává
`tests/registry.json` a generovaný `docs/convergence/STATUS.md`. Řádek v této
matici znamená *„je rozmyšleno, čím se to prokáže"*, nikoli *„je to prokázané"*.

Rozdíl je celý Gate 0 v jedné větě: **plán pokrytí není pokrytí.**

---

## 1. Sčítání

| Množina | Počet | Zdroj |
|---|---|---|
| Požadavky `MR-01`..`MR-23` | 23 | SCREENS §1 |
| Toky `MS-01`..`MS-19` | 19 | SCREENS §4 |
| Obrazovkové stavy `SS-01`..`SS-10` | 10 | SCREENS §2 |
| Datové typy `MD-01`..`MD-19` | 19 | DATA-MODEL §4 |
| Invarianty `I-1`..`I-11` | 11 | DATA-MODEL §1 |
| Plánované testy | 46 v 9 rodinách | TEST-STRATEGY §7 |
| Reziduální rizika `M-R1`..`M-R6` | 6 | DATA-MODEL §5.5 |
| Otevřená rozhodnutí | 13 (7 `D-M`, 3 `D-T`, 3 `D-S`) + 5 z PLAN.md; `D-S1` a `D-T1` uzavřel operátor | §8 |

**Ověřeno strojově napříč dokumenty:** každý požadavek má aspoň jeden tok
(0 sirotků), každé testovací ID zmíněné u toku existuje v katalogu rodin
(0 viset­ících odkazů), stavy `SS-01`..`SS-10` jsou vyplněné u všech 19 toků.

---

## 2. Požadavky × toky × data × testy × rizika

| Požadavek | Fáze | Toky | Data | Plánované testy | Rizika |
|---|---|---|---|---|---|
| `MR-01` párování bez opisování tokenu | 0 | `MS-02` | `MD-16`, `MD-11` | MP ×6 | `G0-R021` |
| `MR-02` scoped device token, fail-closed | 0 | `MS-01`, `MS-02` | `MD-11`, `MD-12` | MS ×4, MB ×5 | `G0-R021`, `M-R2` |
| `MR-03` rozeznatelná příčina nedostupnosti | 0 | `MS-03` | `MD-10` | MN-error-states, MV-diagnostics | `M-R4` |
| `MR-04` seznam konverzací | 1 | `MS-06` | `MD-03`, `MD-13` | MC ×3 | `M-R3` |
| `MR-05` historie a stránkování | 1 | `MS-07` | `MD-04`, `MD-13` | MC-only-explicit, MN-cursor, MN-pagination | `M-R3` |
| `MR-06` odeslat zprávu, dostat odpověď najednou | 1 | `MS-08` | `MD-04`, `MD-14`, `MD-19` | MO-mutations-refused, MN-operation-key-reuse | — |
| `MR-07` průběh běhu přes agent log | 1 | `MS-15` | `MD-09` | MV-log-redaction, MN-error-states | `M-R6` |
| `MR-08` reconnect, přerušený turn označen | 1 | `MS-08`, `MS-15` | `MD-04`, `MD-09`, `MD-19` | MO-draft-no-autosend, MO-operation-key-unknown-state | — |
| `MR-09` offline čtení cachovaných konverzací | 1 | `MS-06`, `MS-07` | `MD-03`, `MD-04` | MC ×6 | `M-R1`, `M-R3` |
| `MR-10` hledání | 1 | `MS-09` | `MD-03`, `MD-04` | MC-only-explicit | `M-R3` |
| `MR-11` draft přežije zavření i offline | 1 | `MS-08` | `MD-14` | MO-draft-no-autosend, MO-draft-local-only | `M-R3` |
| `MR-12` čtení nastavení | 2 | `MS-10` | `MD-01`, `MD-12` | MC-freshness, MS-client-hint-only | — |
| `MR-13` změna nastavení | 2 | `MS-11` | `MD-01`, `MD-19` | MO-mutations-refused, MC-stale-blocks-action, MS-security-routes-denied, MN-operation-key-conflict | `G0-R021` |
| `MR-14` projekty a jejich fáze | 3 | `MS-12` | `MD-02`, `MD-13` | MC-freshness, MO-never-queued | `M-R3` |
| `MR-15` fronta approvalů | 3 | `MS-13` | `MD-07` | MO-approval-hidden, MO-never-queued | — |
| `MR-16` rozhodnutí o approvalu ★ | 3 | `MS-14` | `MD-07`, `MD-12`, `MD-19` | MN-approval-idempotency, MN-operation-key-conflict, MO-never-queued, MO-operation-key-not-a-queue, MC-stale-blocks-action, MS-fail-closed | `M-R2` |
| `MR-17` čtení uchovávaných informací | 4 | `MS-16` | `MD-06` | MC-only-explicit, MV-storage-class | **`M-R3` (nejvyšší hustota)** |
| `MR-18` ruční poznámka | 4 | `MS-17` | `MD-06`, `MD-14`, `MD-19` | MO-mutations-refused, MO-draft-no-autosend, MN-operation-key-reuse | — |
| `MR-19` stav agentů a historie | 5 | `MS-18` | `MD-17`, `MD-09` | MC-freshness, MO-never-queued | — |
| `MR-20` dry-run agenta | 5 | `MS-19` | `MD-17`, `MD-19` | MO-never-queued, MS-fail-closed, MO-operation-key-unknown-state | `G0-R021` |
| `MR-21` in-app notifikace | 1+ | `MS-05` | `MD-08` | MV-notification-content | `M-R5` |
| `MR-22` správa a odvolání zařízení | 0 | `MS-04` | `MD-11`, `MD-12` | MS-token-expiry, ML-revoke-wipe, ML-revoke-cannot-wipe-offline | **`M-R1`** |
| `MR-23` zámek aplikace | 0 | `MS-01` | `MD-11` | ML-logout-wipe, MC-expired-purge, ML-token-storage | **`M-R2`** |

---

## 3. Testy × co chrání

Obrácený pohled. Jeho smysl: **žádný plánovaný test nesmí být sirotek** a
u každého musí být jasné, co padne, když bude chybět.

### Chrání hranici, ne obrazovku (`C3-031`)

Devět testů níže se v mapě obrazovek neobjeví, a je to správně — chrání
serverovou hranici, která má cenu i kdyby žádný telefon nikdy nevznikl
(PLAN.md: `S-1`..`S-4` jsou na mobilu nezávislé).

| Test | Chrání | Bez něj |
|---|---|---|
| `MB-route-policy` (`offline`) | Default deny, allow-list jen `/m1/*` | Hranice je tvrzení, ne vlastnost |
| `MB-legacy-api-unreachable` (`server`) | `G0-R021` | Vzdálený peer se dostane na neautentizované `/api/*` |
| `MB-ws-terminal-unreachable` (`server`) | `G0-R021` | Vzdálený peer se dostane na `exec` |
| `MB-loopback-only` (`server`) | PLAN.md §2 pravidlo 1 | Stávající listener tiše opustí loopback |
| `MB-admin-token-absent` (`offline`) | PLAN.md §2 pravidlo 2 | Telefon skončí s admin tokenem |
| `MC-invalidation` | DATA-MODEL §3 | TTL a invalidace splynou; zastaralost přestane být odvoditelná |
| `MC-discardable` | `I-10` | Cache se stane skrytým zdrojem pravdy |
| `ML-expiry-readonly` | `MD-01`..`MD-06` chování při expiraci | Vypršelý token buď maže víc, než má, nebo míň |
| `MX-client-suite` | PLAN.md §8 podmínka 3 | Vznikne druhá nedohledatelná testovací plocha |

### Chrání tok

| Rodina | Počet | Toky, které na ní stojí |
|---|---|---|
| **MP** pairing | 6 | `MS-02` |
| **MS** scope | 4 | `MS-01`, `MS-04`, `MS-10`, `MS-11`, `MS-14`, `MS-19` |
| **MC** cache | 6 | `MS-06`, `MS-07`, `MS-09`, `MS-10`, `MS-11`, `MS-12`, `MS-14`, `MS-16`, `MS-18` |
| **MO** offline | 7 | `MS-08`, `MS-11`, `MS-12`, `MS-13`, `MS-14`, `MS-17`, `MS-18`, `MS-19` |
| **ML** lifecycle | 6 | `MS-01`, `MS-04` |
| **MV** privacy | 4 | `MS-03`, `MS-05`, `MS-15`, `MS-16` |
| **MN** contract | 7 | `MS-03`, `MS-07`, `MS-14`, `MS-15` |

---

## 4. Datové typy × kde se objevují

| Data | Toky | Testy | Poznámka |
|---|---|---|---|
| `MD-01` nastavení | `MS-10`, `MS-11` | MC-freshness, MC-stale-blocks-action | |
| `MD-02` projekty | `MS-12` | MC-freshness, MO-never-queued | |
| `MD-03` konverzace | `MS-06`, `MS-09` | MC ×3 | |
| `MD-04` zprávy | `MS-07`, `MS-08`, `MS-09` | MC-only-explicit, MN-pagination | **největší dopad ztráty** |
| `MD-05` přílohy | `MS-07` | MV-storage-class | necachují se |
| `MD-06` uchovávané informace | `MS-16`, `MS-17` | MC-only-explicit, MV-storage-class | nejvyšší hustota informace |
| `MD-07` approvaly | `MS-13`, `MS-14` | MO-approval-hidden, MN-approval-idempotency | necachují se |
| `MD-08` notifikace | `MS-05` | MV-notification-content | |
| `MD-09` agent log | `MS-15`, `MS-18`, `MS-19` | MV-log-redaction | necachuje se |
| `MD-10` diagnostika | `MS-03` | MV-diagnostics, MN-error-states | |
| `MD-11` device token | `MS-01`, `MS-02`, `MS-04` | ML-token-storage, MS-token-expiry | jediné S3 na disku |
| `MD-12` scope | `MS-01`..`MS-04`, `MS-10`, `MS-14` | MS-client-hint-only, MS-fail-closed | |
| `MD-13` kurzor | `MS-06`, `MS-07`, `MS-12` | MN-cursor-rejection | |
| `MD-14` draft | `MS-08`, `MS-17` | MO-draft-no-autosend, MO-draft-local-only | jediný lokální originál |
| `MD-15` lokální preference | **žádný konkrétní** | MV-storage-class | průřezové; viz `GAP-1` |
| `MD-19` žurnál operací | `MS-04`, `MS-08`, `MS-11`, `MS-14`, `MS-17`, `MS-19` | MN-operation-key ×3, MO-operation-key ×2, ML-operation-journal-wipe | `D-S1`; jediné místo, kde je „nevím" trvalý stav |
| `MD-16` párovací stav | `MS-02` | MP-code-not-persisted | |
| `MD-17` agenti | `MS-18`, `MS-19` | MC-freshness, MO-never-queued | |
| `MD-18` klientský log | **žádný konkrétní** | MV-log-redaction | průřezové; viz `GAP-1` |

---

## 5. Rizika × čím se řeší

| Riziko | Opatření | Test | Stav |
|---|---|---|---|
| **`G0-R021`** neautentizované RCE mimo loopback | Oddělený listener, `S-1`..`S-4` | MB ×5 (3× `server`, tedy `BLOCKED`) | **OPEN** — blokuje jakékoli vzdálené zpřístupnění |
| **`M-R1`** revokace nesmaže offline cache | `P-1` minimalizace, `P-2` úklid, `MS-04` to říká nahlas | `ML-revoke-cannot-wipe-offline` | **přijato jako vlastnost** |
| **`M-R2`** odemčený telefon obchází úložiště | `P-4` zámek aplikace, `P-8` nejmenší scope | ML-logout-wipe, MC-expired-purge | zmírněno, neodstranitelné |
| **`M-R3`** okno zpráv je největší dopad ztráty | `P-1`, `D-M6` rozsah okna | MC-only-explicit | zmírněno, rozsah otevřený |
| **`M-R4`** diagnostika prozradí backend | přijato | MV-diagnostics | přijato |
| **`M-R5`** notifikace na zamčené obrazovce | ukazatel, ne obsah | MV-notification-content | zmírněno |
| **`M-R6`** log pojme S2/S3 | `P-7` | MV-log-redaction | zmírněno testem |
| `G0-R011` testy píšou do sledovaného stromu | artefaktový root | podmínka §5 TEST-STRATEGY | platí i pro mobil |
| `G0-R012` import DB bez `C3_DB_PATH` | `isolated-sqlite` | podmínka §6.3 TEST-STRATEGY | platí i pro mobil |
| `G0-R016` false-green vzorce | zákazy §8 TEST-STRATEGY | — | platí i pro mobil |

---

## 6. Díry, které matice našla

Vypsané, protože nevypsaná díra je horší než přiznaná.

| # | Díra | Závažnost | Návrh |
|---|---|---|---|
| **GAP-1** | `MD-15` a `MD-18` nemají vlastní tok — jsou průřezové | nízká | Nechat; `MV-storage-class` a `MV-log-redaction` je pokrývají napříč |
| **GAP-2** | Tři z pěti MB testů jsou `server`, tedy `BLOCKED` až do vzniku vlastněného supervizoru | **vysoká** | Hranici do té doby **nelze prokázat**. Odtud plyne §7: žádné vzdálené zpřístupnění |
| ~~**GAP-3**~~ | ~~`SS-10` stojí na klíči operace, který nikdo nevydává~~ | — | **UZAVŘENA** rozhodnutím `D-S1`: závazný model v `MD-19` a SCREENS §5.1, šest testů v rodinách MN/MO/ML |
| **GAP-4** | `MR-06` slibuje odpověď „najednou", protože token streaming neexistuje. Až vznikne, změní se tok `MS-08` i `MS-15` | nízká | Ponechat; `MR-06` je pravdivý popis dneška, ne cíl |
| **GAP-5** | Žádný test nepokrývá `SS-01`..`SS-10` jako **úplnost** — tedy že tok žádný stav nevynechal | střední | Zvážit jeden `offline` test nad deklarativním popisem toků. Riziko: test, který kontroluje dokumentaci, ne chování |
| **GAP-6** | Rodina MX má jediný řádek, který zastupuje celou testovací sadu klienta | střední | Přijatelné, pokud platí fail-closed z §5 TEST-STRATEGY. Jinak je to jeden bod, kde se schová cokoli |
| **GAP-7** | `MR-21` (notifikace) má jediný test a ten pokrývá obsah, ne doručení | nízká | Doručení je podle PLAN.md §6 produktový limit, ne funkce; testovat půjde až s kanálem |

---

## 7. Co musí platit, než se otevře další krok

Pořadí neurčují fáze klienta, ale to, co brání čemu.

| Krok | Podmínka | Kde je zapsaná |
|---|---|---|
| **Discovery spike (M-0)** | Běží proti loopbacku nebo emulátoru. **Žádné vzdálené zpřístupnění.** `B2` scope enforcement platí i pro spike | PLAN.md §8 body 1 a 4 |
| **Jakékoli vzdálené zpřístupnění** | `S-1`..`S-4` hotové **včetně** negativních testů, tedy `GAP-2` uzavřená | PLAN.md §2, `G0-R021` |
| **Zmrazení kontraktu `/m1`** | Backend má Gate 1 pro `C3-002` a `C3-023` | PLAN.md §8 bod 2 |
| **První mobilní řádek v registru** | Integrační větev dokončila manifest a terminální uzavření `REBUILD`. Pak jeden atomický commit: oba capability řádky + testovací soubor + řádek registru + regenerovaný ledger | TEST-STRATEGY §3.1 a §6.4 |
| **Fáze 3 (approvaly)** | `MN-approval-idempotency` (`server`) je proveditelný, tedy platí totéž co pro `GAP-2` | SCREENS `MS-14` |
| **Klientská aplikace** | `MX` můstek splňuje pět podmínek fail-closed | TEST-STRATEGY §5 |

---

## 8. Otevřená rozhodnutí — sloučeno

Patnáct z mobilních dokumentů plus pět z PLAN.md. Rozhodnutí, která mění
přijatý `REMOTE_COMPANION`, mezi nimi nejsou — ADR 0001 zůstává nedotčená.

| # | Otázka | Doporučení | Blokuje |
|---|---|---|---|
| `D-M1` | Auto-odeslání draftu; zápis do serverových draftů | Ne a ne | `MS-08` |
| `D-M2` | Klíč z `ST-SECURE` pro cache DB | Ano | `M-R2` |
| `D-M3` | Maže logout i drafty? | Ano, s varováním | `MS-08` |
| `D-M4` | Povinný zámek aplikace | Ano, když je v cache S2 | `MR-23` |
| `D-M5` | Konkrétní TTL | Přijmout výchozí, přeměřit po fázi 1 | — |
| `D-M6` | Rozsah okna zpráv | 200 × 20 | `M-R3` |
| `D-M7` | Cachovat diffy a obsah souborů | Ne pro 1.0 | `R-4` |
| ~~`D-T1`~~ | `C3-031` a `C3-032` do CAPABILITY-MATRIX | **ROZHODNUTO:** oba řádky se přidají **atomicky ve stejném commitu jako první skutečný mobilní test** — viz TEST-STRATEGY §3 a §6 | — |
| `D-T2` | Můstek na klientské testy | V-2 s pěti podmínkami | `GAP-6` |
| `D-T3` | Kdy zapsat první mobilní řádek | Po dokončení integrační práce | — |
| `D-T4` | Je `revoke-cannot-wipe-offline` test, nebo dokumentace? | Test | `M-R1` |
| ~~`D-S1`~~ | Klientský klíč operace | **ROZHODNUTO:** 128bitový `operationId` na logickou mutaci, dedup podle `(deviceId, operationId)`, `UNKNOWN` bez nového klíče, klíč neopravňuje | — |
| `D-S2` | Počet approvalů na domovské obrazovce | Živý údaj, offline mizí | `MS-13` |
| `D-S3` | Serverové hledání mimo cache | Ano ve fázi 1 | `MS-09` |
| `D-S4` | `MS-04` ve fázi 0? | Ano | `P-9` |
| `M-1` | Expo/RN vs Flutter | Expo/RN + TS, development build | PLAN.md §9 |
| `N-1` | Notifikace při spící appce | (a) pro fázi 0 | PLAN.md §9 |
| `R-2` | Tailscale vs WireGuard | — | PLAN.md §9 |
| `R-3` | Approval TTL lokální vs vzdálená | Rozlišit; 5 min je pro telefon nedosažitelných | `MS-14` |
| `R-4` | Stahovatelnost diffů na telefon | Váže na `D-M7` | `MD-05` |

---

## 9. Stav mobilní designové větve

| Blok | Dokument | Stav |
|---|---|---|
| Rozhodnutí o vlastnictví dat | `adr/0001` | **ACCEPTED** |
| Plán a bezpečnostní hranice | `mobile/PLAN.md` | k review |
| Klientský datový, cache a trust model | `mobile/DATA-MODEL.md` | k review |
| Testovací strategie a napojení na registr | `mobile/TEST-STRATEGY.md` | k review |
| Mapa obrazovek a toků | `mobile/SCREENS.md` | k review |
| Coverage matice | `mobile/COVERAGE.md` | k review |

**Neimplementováno a záměrně:** listener, pairing, `/m1`, mobilní UI, síťové
zpřístupnění. Kontrakt `/m1` není zmrazený. Do `tests/registry.json`,
`CAPABILITY-MATRIX.md` ani na integrační větev tato práce nesáhla.
