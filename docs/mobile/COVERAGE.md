# IntentSmith Mobile — coverage matice

**Status:** **`LOCAL_REGISTRY_CONVERGED / MOBILE_SUBSET_PASS / SHARED_VALIDATION_BLOCKED`**; tato matice není sama evidence a žádný produktový požadavek zde není DONE
**Revize:** vstupy `RV-028`, `RV-036`, `RV-037`, reconciliation `RV-038`; Composition Review C `RV-039`/`RV-040`; registr a chráněné hodnoty `RV-042`/`RV-043`
**Datum:** 2026-08-01
**Stavová evidence:** produktový commit `4553b3ee`; registr `362`, `C3-031=7`, `C3-032=5`, `offline=178`, `database=33`, required ACTIVE deterministic `211`; všech 11 mobilních programů a `schema-migrations` PASS, ale celý profil skončil exit `1`, `208 PASS / 3 FAIL` kvůli `F-115` a `F-116`; žádný Gate 0 PASS, verdikt ani handoff nebyl vydán, fáze 3A je `NOT DONE` a `F-100` blokuje produkci
**Spojuje:** [DATA-MODEL.md](DATA-MODEL.md) · [TEST-STRATEGY.md](TEST-STRATEGY.md) · [SCREENS.md](SCREENS.md) · [PLAN.md](PLAN.md) · [ADR 0001](../adr/0001-mobile-data-ownership.md)

**Aktuální hranice:** kód a `gateway-policy.js` drží přesný **13-route HTTP
allow-list**. Je to dnešní implementovaný/source-policy-frozen povrch, nikoli
formálně refrozený kontrakt v2 pro šest domén z `DR-008`. Dnešní `/m1` nemá
WebSocket ani SSE. Existují třída/DB tabulka a HTTP read/ack surface
(`GET /m1/notifications`, `POST /m1/notifications/ack`), ale bez produkčního
producenta a wiring nejde o dosažitelný end-to-end inbox; realtime je jen
budoucí neautorizovaný kandidát. Každé nové spárování razí nový `deviceId`,
takže staré operace nejsou z nového zařízení dostupné. Při zachovaném tokenu
téhož zařízení se nejasný timeout řeší `GET /m1/operations/:id`; seznam
stejného zařízení obnoví jen serverová pole otevřených pokusů, ne lokální
atribuci, rozřešenou historii, retry payload ani draft. Všechny čtyři dříve
chybějící successor programy jsou registrované a `MS-20` bylo při zachování ID
překlasifikováno z `C3-031` do `C3-032`. Registry i chráněné hodnoty prošly
nezávislým review; to nemění sdílený deterministický exit `1` ani absenci
Gate 0 PASS, verdiktu a handoffu.

**M4 pravda po `RV-035`:** review je `CHANGES_REQUIRED`. `F-111` zůstává
otevřené jako úzké child evidence stále blokujícího root findingu `F-014`, ne
jako další unikátní root: produkční router registruje email/telegram/push a
server navíc webhook/desktop, nikoli `MobileChannel`, takže běžná produkční
emise nevytvoří řádek `mobile_notifications`. `F-112` je otevřený **HIGH**
blocker a úzké ACK child evidence stále blokujících root findingů `F-011` a
`F-015`, ne další unikátní root: čtení se filtruje podle zařízení, ale ACK
předává jen ID a SQL aktualizuje jen podle ID; cílený řádek lze potvrdit napříč
zařízeními a broadcast sdílí jedno globální `read_at`. `F-015` navíc samostatně
drží závod `MAX(seq)+1` bez `UNIQUE`/transakční garance.

`DR-003` A a jeho specializace `DR-012` A byly `PRODUCT_OWNER` přijaty
společně: server-authoritativní append-only lifecycle a per-device receipt
tabulka jsou cílový kontrakt. `DR-013` A přijímá policy-controlled S1-safe
companion mirror. Rozhodnutí nejsou implementace: ACK izolace, sekvenční
závod, producer/projektor a Gate 1 důkazy chybějí, takže produkční wiring
zůstává blokovaný (`F-011`, `F-014`, `F-015`, `F-111`, `F-112`).

`F-113` je `RESOLVED` v source checkpointu `2a814434` (`RV-037`), prošlo
kompozičním review a má M3 testovací evidenci: každý persistence path pro
moderní i legacy řádky prochází
uzavřenou normalizací, platný záznam má přesně sedm allowlisted polí a
malformovaný nejvýše sedm bez fabrikace identity nebo času. `F-108` je
`RESOLVED`; jeho původní branch-aware census je historický, nikoli aktuální stav. Aktuální
census je `362/7/5/178/33/211`; sdílenou validaci blokují `F-115` a `F-116`.
Vstupy zůstávají pouze lokální, bez push a main integrace; `F-100`, `F-111`,
`F-112`, `F-081`, `GAP-2`, `GAP-9`, `MR-05` a `MR-25` zůstávají otevřené.

---

## 0. Co tento dokument je a co není

**Je:** jediné místo, kde se dá ověřit, že požadavek má obrazovku, obrazovka má
pravidlo, pravidlo má datový typ a všechno to má plánovaný test. Slouží
k hledání děr, ne k prokazování hotovosti.

**Není evidence.** Většina plánovaných testovacích identit zde uvedených dnes
neexistuje jako samostatný program; přímé mobilní successory jsou označené v
TEST-STRATEGY §7, registrované a v M3 prošly. Autoritou zůstává
`tests/registry.json` a běhová evidence, která zároveň říká, že celý profil
skončil `208 PASS / 3 FAIL`; tato matice ani mobilní subset jej nenahrazují.
Řádek v této matici znamená *„je rozmyšleno, čím se to prokáže"*, nikoli
*„je to prokázané"* — a to platí i o řádcích, ke kterým už program existuje.

Rozdíl je celý Gate 0 v jedné větě: **plán pokrytí není pokrytí.**

---

## 1. Sčítání

| Množina | Počet | Zdroj |
|---|---|---|
| Požadavky `MR-01`..`MR-25` | 25 | SCREENS §1 |
| Toky `MS-01`..`MS-19` | 19 | SCREENS §4 |
| Obrazovkové stavy `SS-01`..`SS-10` | 10 | SCREENS §2 |
| Datové typy `MD-01`..`MD-19` | 19 | DATA-MODEL §4 |
| Invarianty `I-1`..`I-11` | 11 | DATA-MODEL §1 |
| Plánované testy | 55 v 9 rodinách | TEST-STRATEGY §7 |
| Reziduální rizika `M-R1`..`M-R9` | 9 | DATA-MODEL §5.5 |
| Otevřená rozhodnutí | 13 (7 `D-M`, 3 `D-T`, 3 `D-S`) + 2 z PLAN.md s gaty (`N-1`, `R-2`); uzavřené navíc: `DR-003` A, `DR-012` A a `DR-013` A (**cílové kontrakty, ne implementace**) | §8 |
| Požadavky blokované kontraktem | 3 — `MR-07`, `MR-10`, `MR-14` | §2.1 |

**Ověřeno strojově napříč dokumenty:** každý požadavek má aspoň jeden tok
(0 sirotků), každé testovací ID zmíněné u toku existuje v katalogu rodin
(0 viset­ících odkazů), stavy `SS-01`..`SS-10` jsou vyplněné u všech 19 toků.

> **Jedna výjimka, kterou to sčítání nezachytilo:** `MR-24` odkazuje na tok
> `MS-20`, ale **SCREENS §4 žádný `MS-20` nemá** — toků je devatenáct,
> `MS-01`..`MS-19`. Není to překlep k tichému smazání. Samostatný kandidát
> `392c5928` obrazovku implementoval a v `RV-025` historicky dostal
> `CHANGES_REQUIRED`. Opravený klient `a3443de1` a disjunktní cache/gateway
> `0292cb69` dostaly v bounded `RV-028` `APPROVED_WITH_FOLLOWUPS` a jejich
> změny jsou nyní v lokálním `WP-MOBILE-024`, prošly `RV-039`/`RV-040`, registry
> handoff `RV-042`/`RV-043` a mobilní M3 subset. Tok přesto není produktově DONE:
> sdílená validace je blokovaná a definice toku v tomto dokumentačním svazku chybí.
> Definice toku v SCREENS stále chybí a je evidovaná jako `GAP-9`.

---

## 2. Požadavky × toky × data × testy × rizika

Sloupec „Fáze" u `MR-14`/`MR-15`/`MR-16` odráží dělení Fáze 3 na **3A a 3B**
(PLAN.md §5.2). Stav plnění je v §2.1 — tato tabulka mapuje **záměr**, ne
hotovost.

| Požadavek | Fáze | Toky | Data | Plánované testy | Rizika |
|---|---|---|---|---|---|
| `MR-01` párování bez opisování tokenu | 0 | `MS-02` | `MD-16`, `MD-11` | MP ×6 | `G0-R032` |
| `MR-02` scoped device token, fail-closed | 0 | `MS-01`, `MS-02` | `MD-11`, `MD-12` | MS ×4, MB ×5 | `G0-R032`, `M-R2` |
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
| `MR-13` změna nastavení | 2 | `MS-11` | `MD-01`, `MD-19` | MO-mutations-refused, MC-stale-blocks-action, MS-security-routes-denied, MN-operation-key-conflict | `G0-R032` |
| `MR-14` projekty a jejich fáze | **3B** | `MS-12` | `MD-02`, `MD-13` | MC-freshness, MO-never-queued | `M-R3` |
| `MR-15` fronta approvalů | **3A** | `MS-13` | `MD-07` | MO-approval-hidden, MO-never-queued | — |
| `MR-16` rozhodnutí o approvalu ★ | **3A** | `MS-14` | `MD-07`, `MD-12`, `MD-19` | MN-approval-idempotency, MN-operation-key-conflict, MO-never-queued, MO-operation-key-not-a-queue, MC-stale-blocks-action, MS-fail-closed | `M-R2` |
| `MR-17` čtení uchovávaných informací | 4 | `MS-16` | `MD-06` | MC-only-explicit, MV-storage-class | **`M-R3` (nejvyšší hustota)** |
| `MR-18` ruční poznámka | 4 | `MS-17` | `MD-06`, `MD-14`, `MD-19` | MO-mutations-refused, MO-draft-no-autosend, MN-operation-key-reuse | — |
| `MR-19` stav agentů a historie | 5 | `MS-18` | `MD-17`, `MD-09` | MC-freshness, MO-never-queued | — |
| `MR-20` dry-run agenta | 5 | `MS-19` | `MD-17`, `MD-19` | MO-never-queued, MS-fail-closed, MO-operation-key-unknown-state | `G0-R032` |
| `MR-21` in-app notifikace | 1+ | `MS-05` | `MD-08` | MV-notification-content | `M-R5` |
| `MR-22` správa a odvolání zařízení | 0 | `MS-04` | `MD-11`, `MD-12` | MS-token-expiry, ML-revoke-wipe, ML-revoke-cannot-wipe-offline | **`M-R1`** |
| `MR-23` zámek aplikace | 0 | `MS-01` | `MD-11` | ML-logout-wipe, MC-expired-purge, ML-token-storage | **`M-R2`** |
| `MR-24` rozřešení neuzavřených operací | 1 | `MS-20`, `MS-03` | `MD-19` | MN-operation-device-bound, MN-operation-retry-no-second-effect, MN-operation-unknown-reason, MN-operation-crash-sweep, MN-sweep-owner-scoped, MN-result-persistence-failed, MO-operation-key-unknown-state | **`M-R7`** |
| `MR-25` osiřelé operace (backend) | — | *desktop, mimo mobilní toky* | `MD-19` | *zatím žádný — úkol není zahájen* | **`M-R8`** |

> `MR-25` je jediný požadavek v této tabulce **bez testu**, a je to přiznaný
> stav, ne opomenutí: úkol není zahájen. Až vznikne, vznikne s testy na
> `ownership state` a na to, že administrativní uzavření **nemaže** záznam.
>
> Migrace 048 zavádí `owner_instance` a registr `mobile_gateway_instances`.
> **Není to `MR-25`.** Je to vlastnictví *procesem gateway*, aby sweep nesáhl
> na cizí živou operaci — ne `ownership state` osiřelé operace, ne dotaz na
> osiřelost, ne desktopový pohled operátora. Až se `MR-25` začne dělat, tabulka
> instancí je použitelný stavební kámen; hotovou částí úkolu není.

### 2.1 Stav plnění požadavků

Tabulka §2 mapuje **záměr**. Tahle mapuje **stav** — jinak se matice dá číst
jako seznam hotových věcí, což byla přesně jedna z výtek review `RV-021`.
Slovník stavů je v PLAN.md §5; zdrojová inventura je PLAN.md §5.1 a §5.2,
obrazovkový dopad v SCREENS §1.1.

> `IMPLEMENTED_LOCAL_UNREVIEWED` = *kód existuje na této větvi a lokálně běží*.
> **Neznamená zrevidováno, integrováno ani produktově hotovo.** Autoritou pro
> strukturu je `tests/registry.json`; běhovou pravdu nese přesná M3 evidence v
> `CP-WP-MOBILE-025-M3` (`4553b3ee`, exit `1`, `208/3`). Současný
> `docs/convergence/STATUS.md` je historický pro staršího kandidáta a není
> autoritou tohoto checkpointu. **Žádný požadavek zde není DONE.**

| Požadavek | Fáze | Stav | Poznámka |
|---|---|---|---|
| `MR-01`..`MR-03` | 0 | `IMPLEMENTED_LOCAL_UNREVIEWED` | Pairing, scope, diagnostika |
| `MR-04`, `MR-06`, `MR-08`, `MR-09`, `MR-11` | 1 | `IMPLEMENTED_LOCAL_UNREVIEWED` | Šest z osmi oblastí Fáze 1 (spolu s částí `MR-05`) |
| `MR-05` historie a stránkování | 1 | **`PARTIAL`** | Čtení historie ano; **kurzorové stránkování v klientovi `MISSING_IMPLEMENTATION`**. Kompoziční a registry prerekvizita je splněná, ale vlastní implementační Work Package není tímto docs balíkem autorizovaný a sdílená validace zůstává blokovaná; historické `WP-MOBILE-016` je `CHANGES_REQUIRED` |
| `MR-07` průběh běhu | 1 | **`BLOCKED_BY_CONTRACT`** | Blokující `/m1/chat` ani žurnál operací **nejsou agent log**. Žádné UI do schválení kontraktu na zdroj dat o průběhu, jeho lifecycle a obnovu. Doména 5 kontraktního kola `DR-008` |
| `MR-10` hledání | 1 | **`BLOCKED_BY_CONTRACT`** | **Lokální hledání nad načtenými stránkami požadavek nesplňuje.** Kontrakt musí určit rozsah, stránkování, autorizaci, klasifikaci dat a chování offline. Doména 6 kontraktního kola `DR-008` |
| `MR-12`, `MR-13` | 2 | **`BLOCKED_BY_CONTRACT_AND_GATE1`** | `DR-008` autorizovalo jen společné kontraktní kolo. Před implementací je nutný schválený/refrozený kontrakt v2, příslušná Gate 1 evidence a samostatný Work Package |
| `MR-14` projekty | **3B** | **`BLOCKED_BY_CONTRACT_AND_GATE1`** | Nález `F-055`: **není odložený a není odstraněný.** Doména 2 kontraktního kola `DR-008` |
| `MR-15`, `MR-16` approvaly | **3A** | **`LOCALLY_COMPOSED / COMPOSITION_REVIEW_APPROVED / REGISTRY_REVIEW_APPROVED / MOBILE_PASS / SHARED_VALIDATION_BLOCKED`** | Historické `392c5928` dostalo v `RV-023`–`RV-025` `CHANGES_REQUIRED`; opravená kompozice prošla `RV-039`/`RV-040` a registry `RV-042`/`RV-043`. Celý profil je `208/3`, 3A je **NOT DONE** a `F-100` blokuje produkci |
| `MR-17`, `MR-18` | 4 | **`BLOCKED_BY_CONTRACT_AND_GATE1`** | Doména 3; kontrakt v2 + příslušná Gate 1 evidence + samostatný Work Package |
| `MR-19`, `MR-20` | 5 | **`BLOCKED_BY_CONTRACT_AND_GATE1`** | Doména 4; kontrakt v2 + příslušná Gate 1 evidence + samostatný Work Package |
| `MR-21` notifikace | 1+ | **`PARTIAL / PRODUCTION_BLOCKED`** | Třída/tabulka/read+ack surface existují. `DR-003` A, `DR-012` A a `DR-013` A určují append-only lifecycle, per-device receipts a S1-safe mirror, ale nejsou implementované: pipeline řádek nevytvoří (`F-111`/`F-014`), ACK není izolovaný (`F-112`/`F-011`/`F-015`) a spící PWA nemá push (`N-1`) |
| `MR-22` správa zařízení | 0 | **`PARTIAL`** | Pod úložištním limitem PWA (PLAN.md §7.2) |
| `MR-23` zámek aplikace | 0 | **`PARTIAL`** | Pod úložištním limitem PWA; `localStorage` není OS keychain, `M-R2` zůstává neodstraněné |
| `MR-24` neuzavřené operace | 1 | **`LOCALLY_COMPOSED / COMPOSITION_REVIEW_APPROVED / REGISTRY_REVIEW_APPROVED / MOBILE_PASS / SHARED_VALIDATION_BLOCKED`** | Opravené checkpointy a journal allowlist jsou kompozičně i registry zrevidované a mobilní program prošel. Funkce není produktově DONE; sdílený profil selhal a SCREENS stále postrádá samostatnou definici toku (`GAP-9`) |
| `MR-25` osiřelé operace | — | `MISSING_IMPLEMENTATION` | Backendový úkol, není zahájen (`M-R8`) |

**Fáze 1 zůstává OTEVŘENÁ** (`DR-009`, nález `F-071`). Šest z osmi funkčních
oblastí má kód; to fázi nezavírá, protože zbylé dvě jsou kontraktní blok
a jedna z těch šesti má chybějící část.

**Fáze 3 je DONE teprve po 3B.** Uzavření 3A fázi nezavírá.

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
| `MB-legacy-api-unreachable` (`server`) | `G0-R032` | Vzdálený peer se dostane na neautentizované `/api/*` |
| `MB-ws-terminal-unreachable` (`server`) | `G0-R032` | Vzdálený peer se dostane na `exec` |
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
| **MO** offline | 9 | `MS-08`, `MS-11`, `MS-12`, `MS-13`, `MS-14`, `MS-17`, `MS-18`, `MS-19` |
| **ML** lifecycle | 7 | `MS-01`, `MS-04` |
| **MV** privacy | 4 | `MS-03`, `MS-05`, `MS-15`, `MS-16` |
| **MN** contract | 13 | `MS-03`, `MS-07`, `MS-14`, `MS-15`, `MS-20` |

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
| `MD-19` žurnál operací | `MS-04`, `MS-08`, `MS-11`, `MS-14`, `MS-17`, `MS-19` | MN ×5, MO ×4, ML ×2 | `D-S1`; jediné místo, kde je „nevím" trvalý stav |
| `MD-16` párovací stav | `MS-02` | MP-code-not-persisted | |
| `MD-17` agenti | `MS-18`, `MS-19` | MC-freshness, MO-never-queued | |
| `MD-18` klientský log | **žádný konkrétní** | MV-log-redaction | průřezové; viz `GAP-1` |

---

## 5. Rizika × čím se řeší

| Riziko | Opatření | Test | Stav |
|---|---|---|---|
| **`G0-R032`** neautentizované RCE mimo loopback | Oddělený listener, `S-1`..`S-4` | MB ×5 (3× vyžaduje serverovou runtime prerekvizitu) | **OPEN** — blokuje jakékoli vzdálené zpřístupnění |
| **`M-R1`** revokace nesmaže offline cache | `P-1` minimalizace, `P-2` úklid, `MS-04` to říká nahlas | `ML-revoke-cannot-wipe-offline` | **přijato jako vlastnost** |
| **`M-R2`** odemčený telefon obchází úložiště | `P-4` zámek aplikace, `P-8` nejmenší scope | ML-logout-wipe, MC-expired-purge | zmírněno, neodstranitelné. **Pod dnešním PWA klientem zmírněno slaběji:** `localStorage` není OS keychain, takže `MR-22`/`MR-23` jsou `PARTIAL` a **nesmí se tvrdit, že jsou pokryté** (PLAN.md §7.2) |
| **`M-R3`** okno zpráv je největší dopad ztráty | `P-1`, `D-M6` rozsah okna | MC-only-explicit | zmírněno, rozsah otevřený |
| **`M-R4`** diagnostika prozradí backend | přijato | MV-diagnostics | přijato |
| **`M-R5`** notifikace na zamčené obrazovce | ukazatel, ne obsah | MV-notification-content | zmírněno |
| **`M-R6`** log pojme S2/S3 | `P-7` | MV-log-redaction | zmírněno testem |
| **`M-R7`** nerozřešené pokusy blokují mutace | `MD-19` §4.3: strop, rate limit, metrika, ruční rozřešení | MO-operation-key-limit, MN-operation-key-rate-limit | **přijatý kompromis** |
| **`M-R8`** osiřelé operace rostou neomezeně | `MR-25`: `ownership state`, dotaz na osiřelost, desktopový pohled | *zatím žádný* | **OPEN** — úkol není zahájen; migrace 048 dodala jen vlastnictví procesem, ne `ownership state` operace |
| **`M-R9`** `UNKNOWN` se nedohledá zpětně | do vyřešení `MR-25`: UI ukazuje `last_checked_at` a netvrdí živý stav | MN-operation-unknown-reason | **OPEN**, zmírněno formulací |
| `G0-R011` testy píšou do sledovaného stromu | artefaktový root | podmínka §5 TEST-STRATEGY | platí i pro mobil |
| `G0-R012` import DB bez `C3_DB_PATH` | `isolated-sqlite` | podmínka §6.3 TEST-STRATEGY | platí i pro mobil |
| `G0-R016` false-green vzorce | zákazy §8 TEST-STRATEGY | — | platí i pro mobil |

---

## 6. Díry, které matice našla

Vypsané, protože nevypsaná díra je horší než přiznaná.

| # | Díra | Závažnost | Návrh |
|---|---|---|---|
| **GAP-1** | `MD-15` a `MD-18` nemají vlastní tok — jsou průřezové | nízká | Nechat; `MV-storage-class` a `MV-log-redaction` je pokrývají napříč |
| **GAP-2** | Hranice není prokázaná mimo loopback | **vysoká** | **OTEVŘENÁ — beze změny.** Celá mobilní plocha (gateway, `/m1`, pairing, klient) zůstává **LOOPBACK-ONLY**. Co se změnilo, je *množství důkazů uvnitř loopbacku*, ne rozsah povoleného: vlastněný supervizor vznikl (`tests/helpers/server-supervisor.js`), mobilní hraniční sada si listener spouští sama na efemérním loopback portu a **38 testovacích případů** v `tests/mobile-gateway-boundary.test.js` běží lokálně zeleně. **To `GAP-2` nezavírá ani částečně.** Neprokázané zůstává chování při skutečném bindu mimo loopback (netestováno) a 32 sad s profilem `server`, které mají `requirements.server:true` a na vlastněný listener převedené nejsou. Jejich ledgerové stavy jsou 7 `ACTIVE` / 12 `BLOCKED` / 13 `KNOWN_DEFECTIVE`. Zákaz vzdálené expozice trvá — PLAN.md §8.1 a §8.2 |
| **GAP-2b** | 32 sad s profilem `server` není bez externího supervizoru runtime-eligible; to není totéž jako jejich ledgerový `state` | **vysoká** | Všech 32 má `requirements.server:true`; ledger je eviduje jako 7 `ACTIVE`, 12 `BLOCKED` a 13 `KNOWN_DEFECTIVE`. Převést je na vlastněný listener stejným způsobem jako síťové mobilní sady. Do té doby o žádné neplatí runtime důkaz |
| ~~**GAP-3**~~ | ~~`SS-10` stojí na klíči operace, který nikdo nevydává~~ | — | **UZAVŘENA** rozhodnutím `D-S1`: závazný model v `MD-19` a SCREENS §5.1, šest testů v rodinách MN/MO/ML |
| **GAP-4** | `MR-06` slibuje odpověď „najednou", protože token streaming neexistuje. Až vznikne, změní se tok `MS-08` i `MS-15` | nízká | Ponechat; `MR-06` je pravdivý popis dneška, ne cíl |
| **GAP-5** | Žádný test nepokrývá `SS-01`..`SS-10` jako **úplnost** — tedy že tok žádný stav nevynechal | střední | Zvážit jeden `offline` test nad deklarativním popisem toků. Riziko: test, který kontroluje dokumentaci, ne chování |
| **GAP-6** | Budoucí klientské testy by mohly obejít kanonický registr přes souhrnný wrapper | střední | Pět dnešních successorů je registrovaných přímo a fail-closed, bez prázdného wrapperu. Každý budoucí klientský program musí dostat vlastní registry řádek; agregace nesmí skrýt jeho výsledek |
| **GAP-7** | `MR-21` (notifikace) nemá end-to-end produkční doručení ani bezpečný ACK pro více zařízení | **vysoká** | `DR-003` A, `DR-012` A a `DR-013` A jsou přijaté cíle, ne hotový kód. Chybí per-device receipt migrace a dotazy, ochrana sekvence, S1 projector a producer/wiring; `F-011`, `F-014`, `F-015`, `F-111`, `F-112` i `N-1` zůstávají otevřené |
| ~~**GAP-8**~~ | ~~`C3-032` nemělo žádný registrovaný program~~ | **RESOLVED** | `eee04db9` a `RV-042`: `C3-031=7`, `C3-032=5`; čtyři programy byly přidány a `MS-20` přesunuto při zachování ID. To uzavírá registry mezeru; sdílenou validaci a `WP-MOBILE-025` dál blokují `F-115`/`F-116` a Gate 0 verdikt nebyl vydán |
| **GAP-9** | `MR-24` odkazuje na tok `MS-20`, který v SCREENS §4 **neexistuje** | střední | Implementace je lokálně složená, ale dokumentační definice toku stále chybí. Jde o přiznanou díru, ne důvod maskovat stav jako DONE |
| ~~**GAP-10**~~ | ~~Lokální operation index nevynucuje uzavřený sedmipolový tvar~~ | **RESOLVED / EVIDENCED** | `2a814434`, `RV-037`, kompoziční `RV-039`/`RV-040` a M3 mobilní PASS dokazují allowlist pro moderní i legacy zápisy |

---

## 7. Co musí platit, než se otevře další krok

Pořadí neurčují fáze klienta, ale to, co brání čemu.

| Krok | Podmínka | Kde je zapsaná |
|---|---|---|
| **Discovery spike (M-0)** | Běží proti loopbacku nebo emulátoru. **Žádné vzdálené zpřístupnění.** `B2` scope enforcement platí i pro spike | PLAN.md §8 body 1 a 4 |
| **Jakékoli vzdálené zpřístupnění** | `S-1`..`S-4` hotové **včetně** negativních testů (splněno na loopbacku), a navíc test proti skutečnému non-loopback bindu, který zatím **neexistuje**. Zákaz tedy trvá | PLAN.md §2, §8.1 a §8.2, `G0-R032` |
| **Formální refreeze kontraktu `/m1` v2** | Backend má Gate 1 pro `C3-002` a `C3-023`; dnešní 13-route HTTP allow-list tím není zpochybněn | PLAN.md §8 bod 2 |
| ~~**Registry closure pro bounded successory**~~ | **Dokončeno:** `eee04db9`/`RV-042` registrovalo čtyři programy a překlasifikovalo `MS-20`; `4553b3ee`/`RV-043` srovnalo chráněné hodnoty. Úplný profil je FAIL a sdílená validace i `WP-MOBILE-025` zůstávají blokované na `F-115`/`F-116`; Gate 0 verdikt nebyl vydán | TEST-STRATEGY §4.2 a §6.4 |
| **Fáze 3A (approvaly)** | Kompozice a registr jsou schválené, mobilní subset PASS. Sdílený profil a produkční `F-100` zůstávají blokující; 3A je `NOT DONE` | SCREENS `MS-14`, PLAN.md §5.2, `DR-011` |
| **Fáze 3B (projekty)** | Schválený/refrozený kontrakt v2, příslušná Gate 1 evidence **a samostatný Work Package**. `MR-14` je do té doby `BLOCKED_BY_CONTRACT_AND_GATE1` | PLAN.md §5.2, §5.3 |
| **Fáze 3 jako celek** | Hotová 3B. Uzavření 3A fázi nezavírá | PLAN.md §5.2 |
| **`MR-07`, `MR-10`** | Schválený/refrozený kontrakt v2 — domény 5 a 6 — plus příslušná Gate 1 evidence a samostatný Work Package. **Schválení kontraktu implementaci neautorizuje** | PLAN.md §5.3 |
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
| ~~`D-T1`~~ | `C3-031` a `C3-032` do CAPABILITY-MATRIX | **ROZHODNUTO a provedeno:** capability řádky existují a registr má `C3-031=7`, `C3-032=5` | ~~`GAP-8`~~ |
| ~~`D-T2`~~ | Můstek na klientské testy | **PROVEDENO pro současné successory:** pět přímých fail-closed programů má vlastní registry řádky; budoucí programy musí zachovat stejný princip | `GAP-6` |
| ~~`D-T3`~~ | Kdy zapsat chybějící successor řádky | **PROVEDENO:** po Composition Review C v `eee04db9`, schváleno `RV-042`; historický `PC-010` nebyl proveden | ~~`GAP-8`~~ |
| `D-T4` | Je `revoke-cannot-wipe-offline` test, nebo dokumentace? | Test | `M-R1` |
| ~~`D-S1`~~ | Klientský klíč operace | **ROZHODNUTO:** 128bitový `operationId` na logickou mutaci, dedup podle `(deviceId, operationId)`, `UNKNOWN` bez nového klíče, klíč neopravňuje | — |
| `D-S2` | Počet approvalů na domovské obrazovce | Živý údaj, offline mizí | `MS-13` |
| `D-S3` | Serverové hledání mimo cache | Ano ve fázi 1 | `MS-09` |
| `D-S4` | `MS-04` ve fázi 0? | Ano | `P-9` |
| ~~`M-1`~~ | Expo/RN vs Flutter | **ROZHODNUTO retrospektivně:** PWA pro Fáze 0–1, přehodnocení až u `N-1`. Klient vznikl dřív, než rozhodnutí padlo; gate zůstává překročený. `F-099` drží tuto skutečnost trvale na záznamu (navazuje na `F-074`) | `MX` |
| `N-1` | Notifikace při spící appce | (a) pro fázi 0 — **gate:** před zmrazením notifikační architektury; může vyžadovat APNs/FCM a serverovou registraci | `MR-21` |
| `R-2` | Tailscale vs WireGuard | — **gate:** před prvním provozním nasazením vzdáleného přístupu | provoz, ne design |
| ~~`R-3`~~ | Approval okna | **PŘIJATÝ CÍLOVÝ KONTRAKT (`DR-011`), ne stav implementace:** lokální 5 min, vzdálené 15 min; jednorázový, vázaný na run/operaci/obsah, bez prodloužení. Replay oprávnění nikdy; idempotentní odpověď ano. End-to-end vynucení blokuje `F-100` | produkční stav |
| ~~`R-4`~~ | Diffy pro 1.0 | **ROZHODNUTO v přeformulovaném rozsahu:** approval nese **popis a otisk**; **zobrazení diffu není součástí 1.0 a je vedeno jako nesplněné**; stáhnout, exportovat ani uložit ne. Budoucí diff vyžaduje vlastní kontraktní kolo a threat model (nález `F-068`) | — |
| ~~`R-5`~~ | Dělení nastavení | **ROZHODNUTO, jednoznačně a všude:** PLAN §5.4 závazné + invarianty `R5-1`..`R5-5`. **Není to otevřené rozhodnutí operátora** (nález `F-069`); dodání Fáze 2 zůstává za `DR-008` | — |
| ~~`DR-008`~~ | Kontraktní kolo | **PŘIJATO pouze jako společné kolo** pro šest domén. Ani přijetí rozhodnutí, ani budoucí schválení kontraktu samo neautorizuje implementaci: před každou fází je nutný kontrakt v2, příslušná Gate 1 evidence a samostatný Work Package (PLAN §5.3) | `MR-07`, `MR-10`, `MR-12`..`MR-14`, `MR-17`..`MR-20` |
| ~~`DR-009`~~ | Je Fáze 1 hotová? | **ROZHODNUTO:** **ne, zůstává OTEVŘENÁ** (nález `F-071`). Šest z osmi oblastí implementováno; `MR-05` stránkování chybí, `MR-07` a `MR-10` blokované kontraktem | Fáze 1 |
| ~~dělení Fáze 3~~ | Jde uzavřít approvaly bez projektů? | **ROZHODNUTO:** ano. Composition Review C je hotové, ale **3A** smí být DONE až po úplném shared PASS, produkčním uzavření `F-100` a explicitní integraci. Dnes je `208/3`, proto 3A zůstává **NOT DONE**; **3B** je kontraktně blokované | `MR-14`..`MR-16` |

---

## 9. Stav mobilní designové větve

| Blok | Dokument | Stav |
|---|---|---|
| Rozhodnutí o vlastnictví dat | `adr/0001` | **ACCEPTED** |
| Plán a bezpečnostní hranice | `mobile/PLAN.md` | kompozice `RV-039`/`RV-040`, registry `RV-042`/`RV-043`; post-M3 truth zachovává shared validation BLOCKED |
| Klientský datový, cache a trust model | `mobile/DATA-MODEL.md` | totéž |
| Testovací strategie a napojení na registr | `mobile/TEST-STRATEGY.md` | totéž |
| Mapa obrazovek a toků | `mobile/SCREENS.md` | totéž |
| Coverage matice | `mobile/COVERAGE.md` | totéž |

**Oprava dřívějšího znění.** Tato sekce dřív tvrdila, že listener, pairing,
`/m1` a mobilní UI nejsou implementované a že tato práce nesáhla do
`tests/registry.json`. **Ani jedno už neplatí:** gateway, `/m1` handlery,
pairing, žurnál operací a PWA klient na této linii existují. V registru je
`C3-031=7` a `C3-032=5`; všechny successory jsou registrované přímo a
`MS-20` má správnou capability (TEST-STRATEGY §4.2).

Co platí dál, a je to podstatnější:

| Tvrzení | Stav |
|---|---|
| Formální kontrakt `/m1` v2 **není schválený ani refrozený** | platí; současně existuje implementovaný/source-policy-frozen 13-route HTTP allow-list (PLAN.md §8, podmínka 2) |
| **Žádné síťové zpřístupnění** — celá mobilní plocha je LOOPBACK-ONLY | platí, `GAP-2` je otevřená |
| Approval/MS-20 successory jsou **lokálně složené, zrevidované a mobilně zelené, ale nejsou produktově hotové** | platí — `RV-039`/`RV-040`, `RV-042`/`RV-043` a M3 mobile PASS; celý profil je FAIL `208/3`, sdílená validace je blokovaná, Gate 0 verdikt nebyl vydán a DONE chybí (§2.1) |
| Tento dokument **není evidence** | platí; strukturu určuje `tests/registry.json` a běhovou pravdu `CP-WP-MOBILE-025-M3`; současný `docs/convergence/STATUS.md` je historický pro staršího kandidáta |

### 9.1 Co by tuto matici změnilo

Aby se nečekalo, až to někdo objeví při čtení:

| Událost | Co se přepíše |
|---|---|
| Vznikne token streaming | `MR-06` přestane platit, mění se `MS-08` i `MS-15` (`GAP-4`) |
| Padne `GAP-2` (hranice prokázaná) | Tři `MB` testy z `BLOCKED` na `ACTIVE`; teprve pak smí být řeč o vzdáleném zpřístupnění |
| ~~Uzavře se `R-5`~~ | **stalo se** — PLAN §5.4, `MD-01` §`R-5`, toky `MS-10`/`MS-11` |
| ~~Přijme se cílový kontrakt `R-3`~~ | **stalo se v `DR-011`**, ale implementace se tím neuzavřela; produkční gap drží `F-100` |
| ~~Uzavře se `R-4`~~ | **stalo se, v přeformulovaném rozsahu** — `MD-05`; zobrazení diffu zůstává **nesplněné** |
| Schválí se a refrozne kontrakt v2 z kola `DR-008` | **Žádná fáze se tím sama neotevře.** Každá čeká ještě na příslušnou Gate 1 evidenci a samostatný Work Package; pořadí 2 → 3B → 4 → 5 je až následné plánování |
| Schválí se a refroznou domény 5 a 6 z kola `DR-008` (`MR-07`, `MR-10`) | §2.1 a §7; **implementaci to neautorizuje** — `MS-09` ani `MS-15` se nestaví bez příslušné Gate 1 evidence a samostatného Work Package |
| Vznikne kurzorové stránkování (`MR-05`) | §2.1, `MS-07`, `MD-13` — a teprve pak má `MN-cursor`/`MN-pagination` co testovat v klientovi |
| ~~Lokální `MS-20` kompozice projde Review C a registry handoffem~~ | **Stalo se:** `RV-039`/`RV-040`, `RV-042`/`RV-043` a mobilní M3 PASS. `MR-24` přesto neopouští produktový `NOT_DONE`: sdílené suite blokují `F-115`/`F-116`; současně zůstávají otevřené skutečná rekonciliace `MR-25` a definice toku `GAP-9` |
| Padne `N-1` směrem k APNs/FCM | `MD-08`, tok `MS-05` a nová serverová registrační závislost |
| Změní se `D-M6` (rozsah okna zpráv) | `M-R3`, tedy největší jednotlivý dopad ztráty telefonu |
| Zvolí se jiná platforma než `M-1` | Rodina `MX` a podmínky můstku, ne zbytek matice |

Nic z toho není důvod matici teď nedokončit — je to seznam míst, kde se
při každé z těch událostí musí sáhnout, aby nezůstala nepravdivá.
