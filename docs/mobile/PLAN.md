# IntentSmith Mobile — zadání a plán realizace

> **Kanonický overlay větve `mobile/master-prod-ready` (2026-09-07):** text
> níže zachycuje původní 13-route checkpoint. Aktuální přesný allow-list má 26
> rout; vedle worker/specialist read modelu, správy zařízení, revizního
> `PUT /m1/settings` a create-only `POST /m1/memory` obsahuje precondition-checked
> `PUT /m1/workers/:id/enabled` a metadata-only
> `GET /m1/workers/:id/runs` a live-only
> `GET /m1/specialists/:id`. Následné consumer-only checkpointy nyní validují
> a stránkují globální konverzace, projekty, workery/specialisty a stored
> information, validují project detail a uzavírají live settings read. MM4-M
> nyní uzavírá exact paired-device snapshot/cache a live revoke authority.
> MM4-N uzavírá exact notification DTO/page/cache consumer a live-only ACK
> autoritu nad oddělenými `read:notifications`/`write:notifications` scopy.
> Autoritou poslední změny je review
> `MM4N-NOTIFICATION-INBOX-INTEGRITY`;
> wildcard ani obecný `/api` proxy nevznikl.

**Status:** **`LOCAL_REGISTRY_CONVERGED / MOBILE_SUBSET_PASS / SHARED_VALIDATION_BLOCKED`**; **žádná produktová fáze není DONE**
**Revize:** vstupy `RV-028`, `RV-036`, `RV-037`, reconciliation `RV-038`; Composition Review C `RV-039`/`RV-040`; registr a chráněné hodnoty `RV-042`/`RV-043`
**Datum:** 2026-08-01
**Stavová evidence:** produktový commit `4553b3ee`; registr `362`, `C3-031=7`, `C3-032=5`, `offline=178`, `database=33`, required ACTIVE deterministic `211`; všech 11 mobilních programů a `schema-migrations` PASS, ale celý profil skončil exit `1`, `208 PASS / 3 FAIL` kvůli `F-115` a `F-116`; žádný Gate 0 PASS, verdikt ani handoff nebyl vydán a `F-100` blokuje produkční `R-3`
**Datový model:** REMOTE_COMPANION — rozhodnuto, [ADR 0001](../adr/0001-mobile-data-ownership.md) ACCEPTED
**Navazující dokumenty:** [DATA-MODEL.md](DATA-MODEL.md) · [TEST-STRATEGY.md](TEST-STRATEGY.md) · [SCREENS.md](SCREENS.md) · [COVERAGE.md](COVERAGE.md)

**Aktuální hranice:** kód a `gateway-policy.js` drží přesný **13-route HTTP
allow-list**. Je to dnešní implementovaný/source-policy-frozen povrch, nikoli
formálně refrozený kontrakt v2 pro šest domén z `DR-008`. Dnešní `/m1` nemá
WebSocket ani SSE. Existují třída/DB tabulka, per-device receipts, unikátní
sequence, closed-S1 companion producer a HTTP read/ack surface
(`GET /m1/notifications`, `POST /m1/notifications/ack`). MM4-N jejich consumer
validuje fail-closed; obecná produkční event-selection/delivery a push policy
však nejsou uzavřené a realtime je jen budoucí neautorizovaný kandidát. Každé
nové spárování razí nový `deviceId`,
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
emise nevytvoří řádek `mobile_notifications`. **`F-112` je `RESOLVED_IN_CODE`
k 2026-08-13** (per-device receipty, 10 testů PASS); dřívější **HIGH**
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
zůstává blokovaný (`F-011`, `F-014`, `F-015`, `F-111`). `F-112` je uzavřený,
ale **uzavření child nálezu samo neuzavírá jeho rooty** `F-011` a `F-015` —
ty potřebují vlastní review.

`F-113` je `RESOLVED` v source checkpointu `2a814434` (`RV-037`), prošlo
kompozičním review a má M3 testovací evidenci: každý persistence path pro
moderní i legacy řádky prochází
uzavřenou normalizací, platný záznam má přesně sedm allowlisted polí a
malformovaný nejvýše sedm bez fabrikace identity nebo času. `F-108` je
`RESOLVED`; jeho původní branch-aware census je historický, nikoli aktuální stav. Aktuální
census je `362/7/5/178/33/211`; sdílenou validaci blokují `F-115` a `F-116`.
Vstupy zůstávají pouze lokální, bez push a main integrace; `F-100`, `F-111`,
`F-081`, `GAP-2`, `GAP-9` a `MR-25` zůstávají otevřené; `F-112` a `MR-05` už
ne.

Legenda: **[F]** ověřený fakt v tomto repu · **[R]** doporučení · **[?]** rozhodnutí operátora · **[D]** odloženo

---

## 0. Co tento dokument opravuje

První verze tohoto plánu obsahovala tři nepravdivá tvrzení, která review odhalilo.
Jsou zde vypsaná, protože na nich stálo zadání Fáze 0:

| Původní tvrzení | Skutečnost |
|---|---|
| „Jediná autentizace je `C3_ADMIN_TOKEN`, all-or-nothing" | **Většina API nemá autentizaci žádnou.** `C3_ADMIN_TOKEN` hlídá jen `/api/security/*` |
| „`broadcast()` je assistant-output stream" | `broadcast()` obsluhuje jen `control` kanál (media/GPU/system progress) a jde všem klientům |
| DoD „live stream, odpověď přitéká postupně" | **Token streaming neexistuje.** `onLLMToken` je konzument bez producenta |

Návrh „přidat `/m1` na stávající listener" byl navíc aktivně nebezpečný — vedl by
ke změně `C3_HOST` z loopbacku, a tím k expozici neautentizovaného WS terminálu.
Viz §2.

---

## 1. Rozsah spike, který mobilní readiness zkoumal

Předaný mobile-readiness spike běžel proti `6676902c` — v `STATUS.md` vedeném
jako **„IntentSmith donor"**. Produktovým trunkem je podle `D-001` tento
repozitář.

**[F]** Čtyři „conditional" nálezy spike se tohoto repozitáře netýkají:
konverzace, listing endpointy i projektová doména tady existují
(`src/chat/conversation-store.js`, `/api/conversations`, `/api/projects`).

**Důsledky:**
1. Rozhodnutí A-1 ze spike (přeskládat konverzace na threads-over-tasks) je bezpředmětné.
2. Odhady pracnosti ze spike (FED 21/35/43/60/66) neplatí pro tento codebase.
3. **Bezpečnostní logika ze spike platí a je to hodnotná část** — je to přesně to,
   k čemu donor podle `D-003` slouží.

---

## 2. Bezpečnostní hranice — blokující, řeší se první

### Co je ověřeno

**[F]** Neexistuje globální auth guard. `src/server.js:1086` najde routu,
`:1094` zavolá handler; mezi tím není nic.

**[F]** `C3_ADMIN_TOKEN` hlídá pouze `/api/security/*` (`src/routes/security.js:20`).
Ostatní `/api/*` routy jsou bez autentizace.

**[F]** WebSocket `hello` handshake ověřuje výhradně `protocolVersion`
(`src/ws-bridge/ws-server.js:126`). Žádný token.

**[F]** Po handshake je dostupný terminal channel přijímající
`{type: "exec", command}` (`src/ws-bridge/session-adapter.js:398`).

**[F]** `validateApiToken()` (`src/routes/security.js:270`) existuje, hashuje
SHA-256, kontroluje expiraci a vrací `scopes`. Rozhodovací vrstva
`src/mobile/gateway-policy.js` ji nyní používá; samostatný listener ji zatím
nevolá a vzdálené zpřístupnění zůstává vypnuté.

### Co z toho plyne

Bind `C3_HOST` mimo loopback = **neautentizované vzdálené spuštění příkazů**
pro každého na té síti. Není to mobilní problém; je to vlastnost současného
systému. Evidováno jako `G0-R032`.

### Stav po milníku `codex/legacy-listener-loopback-boundary`

Stávající C3 listener nyní před `server.listen()` vynucuje explicitní loopback
hosty (`127.0.0.1`, `::1`, `::ffff:127.0.0.1`, `localhost`) a při síťovém bindu
fail-closed skončí s kódem `C3_LEGACY_LISTENER_LOOPBACK_REQUIRED`. Tím se
neautentizovaný legacy API/WS terminál nemůže omylem vystavit do LAN/VPN.
Negativní policy test je v `tests/legacy-listener-boundary.test.js` a je
registrován jako `IS-T1-TESTS-LEGACY-LISTENER-BOUNDARY-TEST`.

To **není** implementace mobilního přístupu: S-2 (oddělený listener), S-3
(zapojení policy do listeneru) a síťová část S-4 zůstávají otevřené. Do jejich
dokončení se `C3_HOST` mimo loopback nepovoluje.

### Stav po milníku `f9b0b60` — scope policy

Rozhodovací vrstva `src/mobile/gateway-policy.js` je připravená bez síťového
side-effectu. Povolené jsou pouze přesné cesty `/m1/*`; legacy `/api/*`,
`/api/security/*` a `/c3/ws` jsou default-deny. `/m1/health` je minimální
veřejná diagnostika, ostatní připravené operace vyžadují výhradně jeden
`Authorization: Bearer <device-token>` a přesný scope. Chybějící/neplatný nebo
expirovaný token vrací 401, chybějící scope 403.

To uzavírá rozhodovací část B2/S-3, nikoli listener. Testy jsou zatím offline
v `tests/legacy-listener-boundary.test.js`; serverové testy skutečné oddělené
gateway zůstávají prerekvizitou B1/B3. Tím se ustavil dnešní přesný
source-policy allow-list; **formální kontrakt v2** pro další domény tím nebyl
schválen ani refrozen.

Samotný scope middleware na `/m1` proto **nestačí** — útočník by `/m1` ignoroval
a šel přímo na legacy API nebo na WS terminál na stejném portu.

### Stav po milníku „oddělený listener" — S-2 až S-5, B5 a komponenty B6

Gateway a bezpečnostní řádky jsou implementované a ověřené proti **běžícímu**
listeneru na **loopbacku**. B6 se níže vede zvlášť jako sada existujících
komponent, nikoli jako zapojená produkční cesta.

> **„Hotovo" v této tabulce znamená `IMPLEMENTED_LOCAL_UNREVIEWED`** (§5):
> kód existuje a lokálně běží. **Neznamená zrevidováno, integrováno ani
> produktově hotovo** a neuvolňuje `GAP-2` — celá mobilní plocha zůstává
> LOOPBACK-ONLY (§8.1, §8.2).

| Úkol | Stav | Kde |
|---|---|---|
| S-2 / B1 — oddělený listener | hotovo | `src/mobile/gateway.js`, proces `src/mobile-gateway.js` |
| S-3 / B2 — policy zapojená za běhu | hotovo | listener volá `authorizeMobileRequest()` před každým handlerem |
| S-4 / B3 — hraniční negativní testy | registrovaný program, **38 testovacích případů PASS** v M3; lokální a bez main integrace či non-loopback důkazu | `tests/mobile-gateway-boundary.test.js` |
| S-5 / B4 — atomický jednorázový pairing | hotovo | `src/mobile/pairing.js`, `scripts/mobile-pair.js` |
| B5 — `/m1` handlery | hotovo | `src/mobile/handlers.js` |
| B6 — mobilní notifikace | **PARTIAL / SOURCE TESTED / PRODUCTION POLICY BLOCKED** | Fail-closed `MobileChannel`, jediný closed-S1 companion producer, per-device receipts/ACK, unikátní sequence a HTTP read/ack existují. MM4-N doplňuje exact DTO/page/cache consumer, úplný sequence průchod, oddělené read/write scopy a live-only ACK bez auto-retry. Obecná production event-selection/delivery a push/background policy, wire freeze, remote transport a device/release evidence zůstávají otevřené |
| DATA-MODEL §8 (11 požadavků) | registrovaný program, **41 testovacích případů PASS** v M3; bez main integrace | `src/mobile/protocol.js`, `src/mobile/operation-journal.js` |

**Vlastněný supervizor** (`tests/helpers/server-supervisor.js`) odstraňuje důvod,
proč byly hraniční testy `BLOCKED`. Sada, která si listener spustí a zase
zastaví sama (efemérní loopback port, izolovaná DB, deterministický teardown),
nemá žádnou externí serverovou prerekvizitu — proto je registrovaná jako
`requirements.server: false` a **běží**, místo aby se blokovala.

To se týká čtyř síťových mobilních sad; další dvě mobilní sady jsou
`ACTIVE` a čistě databázové (`network:none`). Spolu s pěti approval/client
successory jde o 11 required `ACTIVE` mobilních programů; všechny mají
`requirements.server:false` a v M3 prošly.

Samostatných 32 řádků s profilem `server` má naopak bez výjimky
`requirements.server:true`. Bez externího, identity-verified server
supervizoru proto **nejsou runtime-eligible**. To není totéž jako ledgerový
`state`: registr je eviduje jako 7 `ACTIVE`, 12 `BLOCKED` a 13
`KNOWN_DEFECTIVE`. Převedení na vlastněný listener je samostatná práce,
která zde nebyla udělána.

**Bind zůstává loopback-only.** `assertMobileGatewayBind()` odmítá non-loopback
fail-closed; výjimku dává jen přesná fráze
`C3_MOBILE_ALLOW_REMOTE=i-accept-unproven-remote-boundary`. Hodnoty `true`,
`1`, `yes` jsou vědomě odmítnuté, aby se přepínač nedal zapnout omylem.

### [R] Řešení: oddělený listener

```
   telefon
      │ jen VPN adresa
      ▼
 ┌──────────────────────────────┐     ┌────────────────────────────┐
 │ mobile gateway (nový)         │     │ stávající server           │
 │ bind: VPN adresa              │     │ bind: 127.0.0.1 — NIKDY    │
 │ povrch: 13 HTTP rout /m1      │────▶│ jinam                      │
 │ fail-closed scope guard       │     │ /api/*, /c3/ws (terminál)  │
 └──────────────────────────────┘     └────────────────────────────┘
```

**Šest pravidel:**

1. Stávající listener **nikdy** neopustí loopback.
2. Telefon nikdy nedrží `C3_ADMIN_TOKEN` — vždy device token se scopem.
3. Gateway vystavuje přesně 13 **implementovaných a source-policy-frozen** HTTP
   rout pod `/m1`. Nejde o formální refreeze v2. Gateway nemá WebSocket ani
   SSE; všechno ostatní končí default-deny odpovědí `404`.
4. Terminal channel a `/api/security/*` nejsou z gateway dosažitelné nikdy, ani se scopem.
5. Fail-closed: chybějící scope, expirovaný token, neznámá verze → 401/403/409, nikdy tichý fallback.
6. Backend kvůli mobilu neoslabí žádný existující kontrakt (CRE zůstává jedinou autoritou, QGv2 se neobchází).

Případný budoucí realtime transport (WebSocket nebo SSE) je jen
**nezávazný future candidate**. Dnes pro něj neexistuje route, formálně
refrozený kontrakt ani implementační oprávnění; vyžadoval by kontrakt v2,
příslušnou Gate 1 evidenci a samostatný Work Package.

**Negativní testy, které musí existovat dřív než se telefon připojí:**
- remote peer nedosáhne na žádnou legacy `/api/*` routu;
- remote peer nedosáhne na `/c3/ws` ani na terminal channel;
- device token nedosáhne na `/api/security/*`;
- expirovaný a revokovaný token jsou odmítnuty;
- pairing kód je jednorázový (druhé použití → 409), má TTL a odolá brute-force;
- pairing nelze použít k eskalaci na admin scope;
- pairing lze globálně vypnout jedním přepínačem.

---

## 3. Co streaming a reconnect dnes umí

**[F]** Chatová odpověď se posílá až po dokončení `ChatController.handle()`.
**[F]** `onLLMToken` hook existuje, ale nemá producenta — komentář v kódu:
*„streaming — reserved for future use"*.
**[F]** Odpojení abortuje aktivní turny a zamítne pending edity (`session-adapter.js`).
**[F]** Rehydrate vrací předložená conversation ID bez ověření v DB.

**[R] Skromná definice reconnectu pro Fázi 0 — jediná, která odpovídá kódu:**

> Po opětovném přihlášení klient znovu načte historii a může zahájit nový turn.
> Rozpracovaný turn se označí jako přerušený; jeho pokračování není podporováno.

Skutečné resume streamu vyžaduje event journal, sequence cursor a per-device WS
session. To je samostatná backendová práce, **[D]** odložená za prototyp.

---

## 4. FÁZE 0 — discovery spike

**Rámec schválený review:** oddělený, časově omezený discovery spike
**bez vzdáleného zpřístupnění serveru** a **bez formálního refreeze `/m1` v2**.

Prototyp běží proti loopbacku nebo emulátoru. Vzdálené zpřístupnění nastává až
poté, co je hotová hranice z §2 včetně negativních testů.

**Definition of done — opravený:**

| # | Schopnost | Ověření |
|---|---|---|
| P1 | Párování bez opisování tokenu | QR z desktopu → telefon má device token |
| P2 | Device token se scopem | `validateApiToken` zapojená, scope guard, negativní testy z §2 |
| P3 | Health a diagnostika | verze API, dostupnost backendu, model |
| P4 | Seznam konverzací | `GET /m1/conversations` |
| P5 | Poslat zprávu, dostat odpověď | `POST /m1/chat` — **odpověď dorazí najednou**, ne streamovaně |
| P6 | ~~Live stream~~ → progres běhu | agent log události (`LLM_START`, `LLM_DONE`, `GATE_VERDICT`) jako indikace postupu — **NESPLNĚNO**, `MR-07` je `BLOCKED_BY_CONTRACT` (§5.1). Blokující `/m1/chat` ani žurnál operací tuto položku nesplňují |
| P7 | Reconnect dle §3 | historie se znovu načte, přerušený turn označen |

**Vědomě mimo Fázi 0:** approvaly, editace nastavení, projekty, iOS, cloud push,
vzdálené zpřístupnění serveru.

**Backendové úkoly:**

| # | Úkol | Pozn. |
|---|---|---|
| B1 | Mobile gateway jako samostatný listener | §2, nikoli `/m1` na stávajícím serveru; legacy listener mezitím odmítá non-loopback bind |
| B2 | Zapojit `validateApiToken` + scope tabulka | rozhodovací policy hotová; listener wiring čeká na B1 |
| B3 | Negativní testy hranice | offline policy testy hotové; serverové testy **před** B4 |
| B4 | `POST /m1/pair/claim` — atomický jednorázový kód | nejrizikovější nový kód |
| B5 | `GET /m1/health`, `/m1/capabilities`, `/m1/conversations`, `POST /m1/chat` | delegace na existující |
| B6 | **PARTIAL / SOURCE TESTED / PRODUCTION POLICY BLOCKED:** fail-closed channel, jediný closed-S1 producer, per-device ACK, unikátní sequence, HTTP pull/ack a MM4-N exact klientský consumer existují. Uzavřít obecnou production event-selection/delivery a push/background policy; žádný WS/SSE | §6; MM4-N review |

Odhady v člověkodnech záměrně neuvádím — po P1 (párování end-to-end) se přeměří.

---

## 5. Fáze 1–5

[ADR 0001](../adr/0001-mobile-data-ownership.md) je ACCEPTED jako REMOTE_COMPANION,
takže všechny fáze níže jsou **v rozsahu**. Rozsah ale není otevřenost a už vůbec
ne hotovost.

> **Slovník stavů, který v tomto dokumentu platí bez výjimky:**
>
> | Stav | Znamená |
> |---|---|
> | `IMPLEMENTED_LOCAL_UNREVIEWED` | Kód existuje na této větvi a lokálně běží. **Neprošel nezávislým review, integrací ani sdílenou validací.** Není to DONE |
> | `PARTIAL` | Část požadavku je pokrytá, zbytek je pojmenovaně nesplněný |
> | `MISSING_IMPLEMENTATION` | Požadavek platí, kód neexistuje. Není odložený ani zrušený |
> | `BLOCKED_BY_CONTRACT` | Nelze stavět, dokud neprojde kontraktní kolo. UI se do té doby nestaví |
> | `BLOCKED_BY_CONTRACT_AND_GATE1` | Totéž a navíc čeká na Gate 1 |
> | `CHANGES_REQUIRED` | Samostatný kandidát prošel nezávislým review, které našlo blokující vady. Není schválený, integrovaný ani DONE |
> | `READY_TO_INTEGRATE` | Bounded checkpoint prošel požadovaným review a smí vstoupit do explicitně autorizované integrace. **Neznamená merged, composed, Review C, Gate 0, DONE ani release-ready.** |
> | `LOCAL_REGISTRY_CONVERGED / MOBILE_SUBSET_PASS / SHARED_VALIDATION_BLOCKED` | Kompozice a registry checkpointy prošly review a mobilní subset prošel; celý profil ale skončil `208/3`. Není to Gate 0 PASS, DONE ani release-ready |
>
> **Žádná fáze v tomto dokumentu není DONE.** Nikde v této dokumentové sadě
> nesmí být výsledek review zaměněn za integraci: `RV-023`–`RV-025`
> historicky vrátila `CHANGES_REQUIRED` na `392c5928`. Až disjunktní successory
> `a3443de1` a `0292cb69` dostaly v bounded Review B `RV-028`
> `APPROVED_WITH_FOLLOWUPS`; nyní jsou jejich přesné změny lokálně složené pod
> `PC-012`/`WP-MOBILE-024`, reconciliation prošla `RV-038`, kompozice
> `RV-039`/`RV-040` a registr `RV-042`/`RV-043`. Mobilní subset je PASS, ale
> sdílená validace `208/3` a `F-100` drží 3A `NOT DONE`. Historický `PC-010`
> nebyl proveden a `PC-012` jej nahradil.

- **Fáze 1 — Konverzace: OTEVŘENÁ** (`DR-009`, nález `F-071`). Historie,
  stránkování, hledání, přepínání, markdown, offline cache pro čtení.
  Šest z osmi funkčních oblastí je implementováno; inventura je v §5.1.
  **Fáze se neuzavírá**, dokud platí to, co je v §5.1 vypsané jako nesplněné.
- **Fáze 2 — Nastavení:** dělení dle `R-5` (§5.4). Přijetí `DR-008` autorizovalo
  jen společné kontraktní kolo. Implementace zůstává blokovaná do schválení a
  refreeze kontraktu v2, splnění příslušných Gate 1 závislostí a založení
  samostatného Work Package; pak je zamýšlená jako první (§5.3).
- **Fáze 3 — Projekty a approvaly ★:** nejcennější fáze; sem patří celá
  bezpečnostní logika ze spike (single-use approvaly vázané na payload hash,
  expirace, revokace, ochrana proti replay, idempotence).
  **Dělí se na 3A a 3B — viz §5.2.**
- **Fáze 4 — Uchovávání informací:** LTM a task memory read-only, ruční poznámka.
  Bez mazání. Až po kontraktu v2, příslušné Gate 1 evidenci a samostatném Work
  Package; zamýšlené pořadí 3 (§5.3).
- **Fáze 5 — Workeři:** stav agentů, historie, dry-run. Bez vytváření agentů.
  Až po kontraktu v2, příslušné Gate 1 evidenci a samostatném Work Package;
  zamýšlené pořadí 4 (§5.3).

**[D] Za 1.0:** iOS, vytváření agentů/specialistů, marketplace, editace skillů,
cokoli se shell přístupem.

### 5.1 Fáze 1 zůstává otevřená — inventura (`DR-009`, nález `F-071`)

**Rozhodnuto operátorem:** Fáze 1 je **OTEVŘENÁ**. Šest z osmi funkčních oblastí
má kód; to není důvod fázi zavřít, protože zbylé dvě nejsou opomenutí, ale
kontraktní blok, a jedna z těch šesti má chybějící část.

| # | Oblast | Požadavek | Stav | Co přesně platí |
|---|---|---|---|---|
| 1 | Seznam konverzací | `MR-04` | `IMPLEMENTED_LOCAL_UNREVIEWED` | — |
| 2 | Historie konverzace | `MR-05` | `LOCAL_REGISTRY_CONVERGED / MOBILE_SUBSET_PASS / SHARED_VALIDATION_BLOCKED` | Čtení historie i kurzorové stránkování v klientovi existují — viz níže |
| 3 | Odeslat zprávu, dostat odpověď najednou | `MR-06` | `IMPLEMENTED_LOCAL_UNREVIEWED` | Token streaming neexistuje (§3), odpověď přichází najednou |
| 4 | Průběh běhu / agent log | `MR-07` | **`BLOCKED_BY_CONTRACT`** | Viz níže |
| 5 | Reconnect, přerušený turn označen | `MR-08` | `IMPLEMENTED_LOCAL_UNREVIEWED` | V rozsahu skromné definice z §3, ne resume |
| 6 | Offline čtení cachovaných konverzací | `MR-09` | `IMPLEMENTED_LOCAL_UNREVIEWED` | V mezích úložiště PWA — §7.2 |
| 7 | Hledání | `MR-10` | **`BLOCKED_BY_CONTRACT`** | Viz níže |
| 8 | Draft přežije zavření i offline | `MR-11` | `IMPLEMENTED_LOCAL_UNREVIEWED` | — |

**K bodu 2 — `MR-05`, kurzorové stránkování (aktualizováno 2026-08-12):**
tvrzení „klient dnes stránkování nemá" **už není pravdivé**. Klient má
`loadOlderMessages`, `threadWindowOf` i `THREAD_PAGE_SIZE`, server má kotvu
`anchor` (`handlers.js` §8.2) a kryjí to `mobile-ms07-history`,
`mobile-contract-pagination-end` a `mobile-contract-cursor-rejection`.

Stav je proto `LOCAL_REGISTRY_CONVERGED / MOBILE_SUBSET_PASS / SHARED_VALIDATION_BLOCKED`: je to na integračním
kandidátu a mobilní subset prochází, ale **produktově DONE to není** —
sdílená validace zůstává blokovaná. Historické `WP-MOBILE-016` je
`CHANGES_REQUIRED` a zůstává historickým záznamem. Je-li stávající kurzor na
`/m1/conversations` pro tento účel
použitelný, **nejde o změnu veřejného kontraktu** a kontraktní kolo se kvůli
tomu neotevírá.

**K bodu 4 — `MR-07`, průběh běhu:** `BLOCKED_BY_CONTRACT`. Dnešní blokující
`/m1/chat` a žurnál operací **nejsou agent log** — jedno je jedna odpověď
najednou, druhé je evidence pokusů o mutaci. Ani dohromady nedávají průběh běhu.
**Žádné UI k `MR-07` nevzniká**, dokud není schválen kontrakt, který pojmenuje
pravdivý zdroj dat o průběhu, jeho životní cyklus a chování při obnově spojení.
Ten kontrakt projde kolem `DR-008` jako doména 5 (§5.3).
Do té doby je `P6` v §4 nesplněné.

**K bodu 7 — `MR-10`, hledání:** `BLOCKED_BY_CONTRACT`. **Lokální hledání nad
už načtenými stránkami požadavek nesplňuje** — uživatel, který nenajde zprávu,
z toho nesmí usoudit, že neexistuje. Kontrakt musí napevno určit rozsah hledání,
stránkování, autorizaci, klasifikaci dat a chování offline; projde kolem
`DR-008` jako doména 6 (§5.3).

**Mimo těchto osm oblastí, ale rovněž Fáze 0–1:**

| Požadavek | Stav | Co platí |
|---|---|---|
| `MR-22` správa a odvolání zařízení | `PARTIAL` | Omezeno úložištěm PWA (§7.2) |
| `MR-23` zámek aplikace | `PARTIAL` | Omezeno úložištěm PWA (§7.2); `M-R2` zůstává |
| `MR-24` rozřešení neuzavřených operací | `LOCALLY_COMPOSED / COMPOSITION_REVIEW_APPROVED / REGISTRY_REVIEW_APPROVED / MOBILE_PASS / SHARED_VALIDATION_BLOCKED` | Historické `392c5928` dostalo v `RV-025` `CHANGES_REQUIRED`; opravená kompozice prošla `RV-039`/`RV-040`, registry `RV-042`/`RV-043` a mobilní program M3. Celý profil FAIL `208/3` brání produktovému DONE; `GAP-9` zůstává dokumentační mezera. `MR-25` je otevřený souběžný backendový úkol, ne prerekvizita `MR-24` |

### 5.2 Fáze 3 se dělí na 3A a 3B

**Rozhodnuto operátorem.**

| Část | Obsah | Stav a podmínka |
|---|---|---|
| **3A — approvaly** | `MR-15` fronta approvalů, `MR-16` rozhodnutí o approvalu ★ | Historické `392c5928` dostalo v `RV-023`–`RV-025` `CHANGES_REQUIRED`. Opravená kompozice prošla `RV-039`/`RV-040`, registry `RV-042`/`RV-043` a mobilní M3 subset. Sdílený profil `208/3` a produkční `F-100` blokují; 3A je **NOT DONE** |
| **3B — projekty** | `MR-14` projekty a jejich lifecycle fáze | **`BLOCKED_BY_CONTRACT_AND_GATE1`** |

**Fáze 3 jako celek je DONE teprve po 3B.** Uzavření 3A fázi nezavírá.

Navíc ani budoucí průchod klientského review neprokáže celé `R-3`. Podle
`DR-011` je `R-3` přijatý **cílový kontrakt**, ne dnešní implementační stav.
Produkční producent approvalů, autorita 5/15minutových TTL, povinný otisk a
autoritativní vazba na run/operaci/normalizovaný obsah chybějí; `F-100` proto
blokuje end-to-end i production-ready tvrzení a nelze ho uzavřít dokumentací.

**`MR-14` — nález `F-055`:** požadavek je **`BLOCKED_BY_CONTRACT_AND_GATE1`,
nikoli odložený a nikoli odstraněný.** Zůstává v registru požadavků, v mapě
obrazovek i v coverage matici a nesmí z nich zmizet; blokáda je stav, ne
zrušení.

### 5.3 `DR-008` — jedno společné kontraktní kolo pro šest domén

**Rozhodnuto operátorem: `DR-008` je přijato.** Přijaté je rozhodnutí vytvořit,
nezávisle zrevidovat a znovu zmrazit **jeden společný kontrakt v2** pro šest
domén; není tím schválený výsledný kontrakt ani autorizovaná implementace.
Kolo pokrývá **šest domén najednou**, aby nevznikly nekompatibilní dílčí kontrakty:

| # | Doména | Váže na | Zamýšlené pořadí až po kontraktu v2, Gate 1 a vlastním WP |
|---|---|---|---|
| 1 | Nastavení | Fáze 2, `MR-12`, `MR-13` | 1. |
| 2 | Projekty | Fáze 3B, `MR-14` | 2. |
| 3 | Paměť | Fáze 4, `MR-17`, `MR-18` | 3. |
| 4 | Agenti | Fáze 5, `MR-19`, `MR-20` | 4. |
| 5 | Konverzace/běh (agent log) | Fáze 1, `MR-07` | **nerozhodnuto** — viz níže |
| 6 | Hledání | Fáze 1, `MR-10` | **nerozhodnuto** — viz níže |

**Zamýšlené pořadí implementace po splnění všech bran:** Fáze 2 nastavení → 3B
projekty → Fáze 4 paměť → Fáze 5 agenti. Domény 5 a 6 v tomto pořadí
**nefigurují** — rozhodnutí je zařadilo do kola, ne do implementační fronty.

> **Návrh kontraktu v2 existuje od 2026-08-11:**
> [`CONTRACT-V2-PROPOSAL.md`](CONTRACT-V2-PROPOSAL.md). Je to `NÁVRH` čekající na
> **nezávislé review** — revidovat ho nesmí jeho autor. Neschválený návrh
> neautorizuje nic; otevřené body, které z repa nešly rozhodnout, jsou v jeho §9.

> **Kontraktní kolo ani schválení kontraktu neautorizují žádnou implementaci.**
> `DR-008` autorizuje jen návrh, review a refreeze v2. Každá fáze se smí začít
> až po splnění příslušné Gate 1 závislosti a založení samostatného Work Package.
> Do té doby nevzniká žádné UI ani nový server-side povrch.

**Co domény 5 a 6 znamenají — a co ne.** `MR-07` (konverzace/běh) a `MR-10`
(hledání) jsou `BLOCKED_BY_CONTRACT` (§5.1) a **zůstávají jimi i po tomto
rozhodnutí**. Dřívější zápis vedl jejich přiřazení ke kolu jako otevřené, protože
zadání bylo v tomto bodě rozporné. **Rozpor je rozhodnutím operátora uzavřen:
kolo má šest domén**, a jako otevřená otázka se v této sadě už nevede.

Prakticky se tím pro `MR-07` a `MR-10` nemění nic dalšího: obojí zůstává
blokované kontraktem, **žádné UI nevzniká** — `MS-15` ani `MS-09` se nestaví —
a **pořadí jejich implementace toto rozhodnutí neurčuje**. Ani schválený v2
kontrakt by sám implementaci neautorizoval; příslušná Gate 1 evidence a vlastní
Work Package zůstávají povinné. Otevřený zůstává obsah kontraktu: u `MR-07`
pravdivý zdroj dat o průběhu, jeho životní cyklus a chování při obnově spojení,
u `MR-10` rozsah hledání, stránkování, autorizace, klasifikace dat a chování
offline.

### 5.4 `R-5` — dělení nastavení: **uzavřeno, závazné**

**Stav: UZAVŘENO.** Není to otevřené rozhodnutí operátora a nikde v této sadě
se tak nesmí značit. Tabulka níže je **závazná**; pět invariantů `R5-1`..`R5-5`
je v [DATA-MODEL.md](DATA-MODEL.md) `MD-01`, projev v tocích `MS-10`/`MS-11`.

Uzavření se týká **dělení**, ne dodání: samotná Fáze 2 zůstává za kontraktním
kolem `DR-008` (§5.3).

| Na mobil | Desktop-only |
|---|---|
| LLM: model, temperature, context | GPU offload, batch size, threads, NUMA, rope scaling |
| Notifikace: kanály, tichý režim, priority | webhook secret, HMAC, trusted domains |
| Vzhled: téma, font, density | custom CSS injection |
| Paměť: LTM on/off, threshold | eviction strategy, hard token caps |
| Systém: jazyk, časová zóna, měna | worker threads, DB vacuum, log retention |
| — | **celá Security sekce** a Feature flags |

Čím víc runtime knobů je dosažitelných z telefonu, tím větší škoda z jeho ztráty.

---

## 6. In-app notifikace

**[F] Source-tested pull tok.** Produkční router registruje fail-closed
`MobileChannel` a jediný držitel jeho capability je closed-S1 companion
producer. Durable tabulka má unikátní sequence a per-device receipts. Gateway
nabízí sekvenční `GET /m1/notifications?afterSeq=…` a device-scoped
`POST /m1/notifications/ack`, obojí s `no-store`.

MM4-N klient načte první stránku a pokračuje pouze serverem vydaným
`nextAfterSeq`. Přijme jen exact devítipolový DTO odpovídající uzavřenému
`S1_VOCABULARY`, koherentní boundary a validní scopes. Potvrzené okno ukládá
jako `{ items, page }`; stará array cache zůstane jen explicitně neúplná.
ACK vyžaduje oba scopy a nový live read, obsahuje jen zobrazené unread id,
po úspěchu se ověří novým readem a nejasný výsledek se automaticky neopakuje.

**B6 stále není production-ready end to end.** Chybí přijatá obecná policy,
které runtime události se mají zrcadlit a pro která zařízení; mobilní WS/SSE ani
push pro spící aplikaci neexistují. Source/loopback důkazy také nejsou Android
device, remote transport, wire-freeze nebo release/security acceptance.

**Hranice — produktový limit, ne bug:**

| Stav appky | Dorazí? |
|---|---|
| Popředí | ✅ existující S1 řádky se načtou při startu/otevření/foreground refreshi a stránkují podle sequence; nejde o realtime subscription |
| Pozadí, proces žije, VPN aktivní | ⚠️ durable řádek čeká na příští HTTP pull; background polling policy není přijata |
| Zavřená / proces zabitý / VPN dole | ❌ žádný realtime signál; durable řádek lze číst až po návratu |

**[?] N-1 — notifikace při spící appce:**

- **(a) Nijak** — in-app only. Nulová externí závislost. **Doporučeno pro Fázi 0.**
- **(b) ntfy** — kanál `ntfy.js` v backendu existuje. **Korekce:** ntfy je bez
  Googlu jen při použití F-Droid buildu se self-hosted serverem nebo instant
  delivery; běžná instalace z Play Store používá FCM. Bez Googlu to tedy znamená
  self-hosting **i** F-Droid distribuci.
- **(c) FCM** — plné push, ale cloud a rozpor s offline-first. **Nedoporučeno do 1.0.**

---

## 7. Platforma

### Původní doporučení — **překonáno rozhodnutím v §7.2**

Ponecháno jako historie, aby bylo vidět, co se rozhodlo jinak.

**M-1 (původně):** doporučeno **React Native + Expo + TypeScript**.

Odůvodnění: celý stack je JS/TS, takže neopouštíš jazyk a API typy lze sdílet.
Flutter by vyhrál u polished aplikace s hodně custom grafikou — což Fáze 0 není.

**Korekce z review:** Expo Go je playground s omezeními a sám Expo ho pro
skutečné projekty nedoporučuje. Použij ho maximálně na první obrazovky;
od okamžiku, kdy je ve hře `expo-secure-store` a device token, je potřeba
**development build**.

### 7.1 Co se stalo místo toho — gate byl překročen

**[F]** M-1 měl padnout *„před založením mobilního projektu nebo první
implementací UI"* (§9). Nepadl. Mezitím vznikl klient
`src/mobile/client/app.js` — **vanilla JS PWA** s `localStorage`, service workerem
a manifestem, servírovaný přímo mobilní gateway. Počet řádků se mezi vybranými
implementačními checkpointy mění a není stavová evidence
(`src/mobile/gateway.js`, statická cesta `/`). Žádný React Native, žádné Expo,
žádný `expo-secure-store`.

Tohle se tu píše proto, že překročený gate zapsaný jako by se nic nestalo je
horší než překročený gate. Rozhodnutí nevzniklo volbou; vzniklo tím, že se
stavělo dřív, než se rozhodlo.

### 7.2 M-1 — rozhodnuto: PWA pro Fáze 0–1 (**retrospektivní ratifikace**)

**[?] Rozhodnutí operátora, zaznamenané zde jako rozhodovací záznam** — ne
doporučení autora dokumentu a ne odvození ze stavu kódu.

**Rozhodnutí:** klientem pro **Fáze 0 a 1** je **PWA** v `src/mobile/client/`.
Postavené se nezahazuje a nepřepisuje se na React Native. Přehodnocení nastává
u `N-1`, ne dřív.

> **Povaha záznamu — `F-099` (navazuje na `F-074`): je to retrospektivní
> ratifikace, ne volba učiněná v čase.** Klient vznikl dřív, než rozhodnutí
> padlo (§7.1).
> Ratifikace mění vlastníka rozhodnutí, **nemění jeho pořadí**: gate zůstává
> překročený a zpětně se splnit nedá. Zapisuje se právě proto, aby se
> překročený gate nedal později číst jako řádný výběr platformy.

**Odvolaná parita.** Předchozí znění této sekce tvrdilo, že „PWA plní Fáze 0 i 1
beze zbytku". **To tvrzení je odvolané — kontrakt ani klient ho neunesou.**
Pravdivý stav:

| Schopnost Fáze 0–1 | PWA | Stav |
|---|---|---|
| P1 párování QR → device token | ano | `IMPLEMENTED_LOCAL_UNREVIEWED` |
| P2 scoped token v úložišti prohlížeče | ano, s omezením níže | `PARTIAL` — bod 1 níže |
| P3–P5 health, konverzace, chat | ano | `IMPLEMENTED_LOCAL_UNREVIEWED` |
| **P6 progres běhu** | **ne** | **NESPLNĚNO** — `MR-07` je `BLOCKED_BY_CONTRACT` (§5.1) |
| P7 reconnect dle §3 | ano, jen v rozsahu §3 | `IMPLEMENTED_LOCAL_UNREVIEWED` — resume neexistuje |
| `MR-05` kurzorové stránkování | **ano, neuzavřeno** | `LOCAL_REGISTRY_CONVERGED / MOBILE_SUBSET_PASS / SHARED_VALIDATION_BLOCKED` (§5.1) |
| `MR-10` hledání | **ne** | **`BLOCKED_BY_CONTRACT`** (§5.1) |
| Obrazovka `MS-20` — obnova neuzavřených operací | ano v lokální kompozici | Kompozice `RV-039`/`RV-040`, registrace pod `C3-032` `RV-042` a mobilní M3 PASS. Sdílený profil FAIL `208/3` brání produktovému DONE a `GAP-9` zůstává dokumentační mezera. `MR-25` je otevřený paralelní backendový úkol, ne prerekvizita obrazovky |
| Offline čtení cache | ano, service worker | `IMPLEMENTED_LOCAL_UNREVIEWED` |
| `MR-22`, `MR-23` | částečně | `PARTIAL` — bod 1 níže |

Řádky označené `IMPLEMENTED_LOCAL_UNREVIEWED` znamenají *kód existuje a lokálně
běží*. **Neznamenají schváleno, integrováno ani produktově hotovo.**
Historické `392c5928` skončilo `CHANGES_REQUIRED`; opravená kompozice prošla
`RV-039`/`RV-040`, registr `RV-042`/`RV-043` a mobilní subset M3. Main integrace
a Gate 0 PASS neexistují; sdílený profil skončil `208 PASS / 3 FAIL`.

**Cena, kterou to má — ne skrytá:**

1. `localStorage` **není** `expo-secure-store`. Device token leží v úložišti
   prohlížeče bez OS keychainu. `MR-23` (zámek aplikace) a `M-R2` tím nejsou
   pokryté v té kvalitě, jakou nativní klient umí, a **nesmí se tvrdit, že jsou**.
2. Notifikace při spící appce (`N-1`, `MR-21`) PWA bez push service neumí.
3. Biometrika a bezpečné pozadí nejsou dostupné.

**Přehodnocení nastane u `N-1`, ne dřív.** Jakmile padne rozhodnutí, že spící
aplikace notifikace dostávat má, je potřeba APNs/FCM registrační infrastruktura
— a to je právě ten okamžik, kdy se nativní klient vyplatí. Do té doby by přepis
na RN nepřinesl žádnou schopnost navíc, jen náklad.

**Co to znamená pro rodinu `MX`:** můstek se testuje proti PWA klientovi, ne
proti RN. Podmínky `MX-client-suite` z §8 podmínky 3 platí beze změny — mobilní
testy patří do registru od prvního dne bez ohledu na runtime.

---

## 8. Vztah ke Gate 0

Lokální mobilní registr je konvergovaný a mobilní subset PASS. **Repozitář ale
Gate 0 stále nedrží:** úplný deterministický profil skončil exit `1`, `208 PASS /
3 FAIL`, na `F-115`/`F-116`. Roadmapa říká *„žádná fáze se neotevírá, dokud
předchozí gate nedrží"*.

**Schválený kompromis:** Fáze 0 je discovery spike, ne otevření fáze. Podmínky:

1. **Žádné vzdálené zpřístupnění serveru** dokud neplatí §2 včetně negativních testů.
2. **Formální kontrakt `/m1` v2 se nerefrozne**, dokud backend nemá Gate 1 pro
   `C3-002` (chat sessions) a `C3-023` (API/WS bridge). To nezpochybňuje
   dnešní implementovaný/source-policy-frozen 13-route HTTP allow-list.
3. **Mobilní testy do registru od prvního dne** — ať nevznikne druhá
   nedohledatelná testovací plocha.
4. **B2 (scope enforcement) je nepodkročitelný** i pro spike.
5. Spike je časově omezený; po vypršení se vyhodnotí, nepokračuje setrvačností.

### 8.1 Potvrzený zákaz do doby, než hranice projde testy

Operátor potvrdil stav `BLOCKED` u vzdálených hraničních negativních
testů jako správný (`GAP-2` v [COVERAGE.md](COVERAGE.md)). Vlastněný
loopback supervizor později vznikl a lokální mobilní sady jsou `ACTIVE`
(§8.2); skutečný non-loopback test ale neproběhl. Všech 32 server-profile
řádků má `requirements.server:true` a bez externího supervizoru není
runtime-eligible; jejich ledgerové stavy jsou 7 `ACTIVE` / 12 `BLOCKED` /
13 `KNOWN_DEFECTIVE`, ne 32× `BLOCKED`. Dokud **neprojde vzdálená hranice
a všechny příslušné negativní testy**, neplatí žádná výjimka:

| Zakázáno | |
|---|---|
| Bind mimo loopback | ani dočasně, ani „jen pro test" |
| Vzdálený listener | včetně mobilní gateway |
| Pairing | `B4` je nejrizikovější nový kód a nemá kam bezpečně ústit |
| `/m1` v jakékoli podobě | ani prototypově |
| **Tvrzení, že je remote security boundary prokázaná** | tři z pěti testů `MB` jsou `server` profil a ten je `BLOCKED` |

Poslední řádek je stejně závazný jako první čtyři. Neprokázaná hranice se
nesmí popisovat jako hotová v žádném dokumentu, statusu ani commit message —
to je přesně ta třída tvrzení, kvůli které Gate 0 vznikl.

### 8.2 Co se změnilo — a co se nezměnilo

Zákaz z §8.1 byl čten jako **zákaz expozice, ne zákaz psaní kódu**. Jinak by
vznikl deadlock: hraniční negativní testy potřebují listener, aby bylo co
testovat. Kód vznikl a testuje se **výhradně na loopbacku**; bind mimo loopback
zůstává fail-closed v kódu, ne jen v dokumentu.

**`GAP-2` se tímto nemění. Celá mobilní plocha zůstává LOOPBACK-ONLY** —
gateway, `/m1`, pairing i klient. Nic z toho, co je níže vyjmenované jako
prokázané, ten zákaz neuvolňuje.

**Prokázané je toto a nic víc** — 38 testovacích případů v registrovaném
`tests/mobile-gateway-boundary.test.js` proti běžícímu listeneru na loopbacku,
**PASS v M3, bez main integrace a bez non-loopback důkazu** (autoritou je
`tests/registry.json` a běhová evidence; celý profil je stále `208/3`):

- žádná legacy `/api/*` routa není přes gateway dosažitelná;
- `/c3/ws` ani jiný WS endpoint neodpoví `101`, ani s platným tokenem
  (ověřeno syrovým upgrade handshakem, ne přes `fetch`);
- device token nedosáhne na `/api/security/*`;
- expirovaný, revokovaný, neplatný a chybějící token jsou **čtyři různé** kódy;
- pairing kód je jednorázový — z 8 souběžných claimů uspěje právě jeden;
- pairing nedokáže udělit `admin`, `exec` ani `terminal` scope;
- pairing lze vypnout jedním přepínačem a vypnutý kód nespotřebuje;
- non-loopback bind je odmítnut a „true"/„1"/„yes" neplatí jako souhlas;
- zařízení vidí a smí opustit jen **vlastní** neuzavřené operace;
- cizí ani **uhádnutý** klíč operace nepřekročí hranici zařízení — odmítnutí
  vypadá stejně jako u klíče, který nikdy neexistoval;
- **revokovaný** ani **vypršelý** token nepřečte ani vlastní operaci, a když
  platí obojí, hlásí se **revokace** (bezpečnostní událost se neschová za
  rutinní vypršení);
- zopakování s **týmž** klíčem odpoví ze záznamu a **nedojde k druhému
  odeslání** k upstreamu; týž klíč s jinou zprávou je fail-closed konflikt;
- `PENDING` po pádu procesu se při startu překlopí na `UNKNOWN` s důvodem
  `process_terminated` a **rozřešené záznamy zůstanou nedotčené**.

**Neprokázané zůstává:**

| Co | Proč |
|---|---|
| Chování při skutečném bindu na VPN adresu | netestováno; testy běží na `127.0.0.1` |
| Odolnost na nedůvěryhodné síti | žádný test neběžel proti reálnému peerovi |
| 32 sad s profilem `server` | všechny mají `requirements.server:true` a bez externího supervizoru nejsou runtime-eligible; ledger `state` je 7 `ACTIVE` / 12 `BLOCKED` / 13 `KNOWN_DEFECTIVE` |
| Gate 0 PASS | **neexistuje**; úplný profil je FAIL, exit `1`, `208 PASS / 3 FAIL`; sdílená validace a `WP-MOBILE-025` jsou blokované na `F-115`/`F-116` a Gate 0 verdikt ani handoff nebyl vydán |

Proto **zákaz vzdálené expozice z §8.1 platí dál**. „Hranice na loopbacku má
negativní testy" není totéž co „remote security boundary je prokázaná" a v této
podobě se to ani nikde tvrdit nesmí.

---

## 9. Otevřená rozhodnutí

### Uzavřená — kde a čím

| # | Rozhodnutí | Kde žije |
|---|---|---|
| **ADR 0001** | REMOTE_COMPANION jako datový model klienta | [ADR 0001](../adr/0001-mobile-data-ownership.md) ACCEPTED |
| **`D-S1`** | Klíč operace: 128bitový `operationId`, dedup podle `(deviceId, operationId)`, `UNKNOWN` bez nového klíče, klíč neopravňuje | [DATA-MODEL.md](DATA-MODEL.md) `MD-19` §4.1–§4.3, [SCREENS.md](SCREENS.md) §5.1 |
| **`D-T1`** | **Provedeno:** capability řádky existují a reviewed registr má `C3-031=7`, `C3-032=5`; všech pět successorů je pod `C3-032` | [TEST-STRATEGY.md](TEST-STRATEGY.md) §3.1–§4.2 |
| **`GAP-2`** | Do doby, než hranice projde testy: žádný bind mimo loopback, listener, pairing, `/m1` ani tvrzení o prokázané hranici | §8.1 tohoto dokumentu |
| **`R-3` / `DR-011`** | **Přijatý cílový kontrakt, ne implementační stav:** lokální **5 min**, vzdálené **15 min**; jednorázový, vázaný na run/operaci/obsah, bez prodloužení. Idempotentní odpověď ano, replay oprávnění nikdy. End-to-end vynucení blokuje `F-100` | [DATA-MODEL.md](DATA-MODEL.md) `MD-07` §`R-3`, [SCREENS.md](SCREENS.md) `MS-14` |
| **`R-4`** | Diff pro 1.0: **approval nese popis a otisk payloadu, nic víc.** Zobrazení diffu **není součástí 1.0** a je vedeno jako nesplněné; stažení, export a uložení jsou zakázané | [DATA-MODEL.md](DATA-MODEL.md) `MD-05`, `MD-07` |
| **`R-5`** | Dělení nastavení dle §5.4 je **závazné**, s pěti invarianty `R5-1`..`R5-5`. Uzavřené je dělení, ne dodání: Fáze 2 čeká na kontrakt v2, příslušnou Gate 1 evidenci a samostatný Work Package | §5.4 tohoto dokumentu, [DATA-MODEL.md](DATA-MODEL.md) `MD-01` §`R-5`, toky `MS-10`/`MS-11` |
| **`M-1`** | **PWA** pro Fáze 0–1; přehodnocení až u `N-1`. **Retrospektivní ratifikace** — gate byl překročen, rozhodnutí vzniklo stavbou a teprve pak zápisem. `F-099` tuto skutečnost drží na záznamu (navazuje na `F-074`) | §7.1 a §7.2 tohoto dokumentu |
| **`DR-008`** | **Přijato jen jako společné kontraktní kolo.** Šest domén: nastavení, projekty, paměť, agenti, konverzace/běh (`MR-07`) a hledání (`MR-10`). Ani přijetí rozhodnutí, ani budoucí schválení kontraktu samo neautorizuje implementaci; nutné jsou kontrakt v2, příslušná Gate 1 evidence a samostatný Work Package — §5.3 | §5.3 tohoto dokumentu |
| **`DR-009`** | **Fáze 1 zůstává OTEVŘENÁ** (nález `F-071`). **Důvod aktualizován 2026-08-12:** `MR-05` stránkování už **nechybí** — je `LOCAL_REGISTRY_CONVERGED / MOBILE_SUBSET_PASS / SHARED_VALIDATION_BLOCKED` (§5.1). Otevřená zůstává kvůli `MR-07` a `MR-10` blokovaným kontraktem a kvůli blokované sdílené validaci. Rozhodnutí se nemění, jen přestává stát na neplatném důvodu | §5.1 tohoto dokumentu |
| **dělení Fáze 3** | Fáze 3 se dělí na **3A** (`MR-15`, `MR-16` — smí být DONE samostatně po nezávislém review, integraci a sdílené validaci) a **3B** (`MR-14`). Fáze 3 jako celek je DONE až po 3B | §5.2 tohoto dokumentu |

### Stále otevřená

Zbývají dvě. Ani jedna není otevřená bez omezení — každá má **gate, do
kterého musí padnout**, jinak blokuje to, co je za ní.

| # | Otázka | Doporučení | **Rozhodnout nejpozději** | Co na tom visí |
|---|---|---|---|---|
| **N-1** | Notifikace při spící appce | (a) pro Fázi 0, pak (b) jako opt-in | **před zmrazením notifikační architektury** | `MR-21`, tok `MS-05`, a nově i platforma klienta |
| R-2 | VPN: Tailscale vs WireGuard | — | **před prvním provozním nasazením vzdáleného přístupu** | nic z designu; čistě provozní volba |

### Blokované kontraktem — ne otevřená rozhodnutí, ne odložené požadavky

Tyhle tři nečekají na názor, ale na schválený kontrakt.

| # | Požadavek | Stav | Kontraktní kolo | Do schválení kontraktu platí |
|---|---|---|---|---|
| `MR-07` | Průběh běhu / agent log | `BLOCKED_BY_CONTRACT` | `DR-008`, doména 5 | Žádné UI. Blokující `/m1/chat` ani žurnál operací **nejsou agent log** |
| `MR-10` | Hledání | `BLOCKED_BY_CONTRACT` | `DR-008`, doména 6 | Žádné UI. Lokální hledání nad načtenými stránkami požadavek **nesplňuje** |
| `MR-14` | Projekty (Fáze 3B) | `BLOCKED_BY_CONTRACT_AND_GATE1` | `DR-008`, doména 2 | Požadavek zůstává evidovaný; **není odložený ani odstraněný** (`F-055`) |

U všech tří už rozhodnutí, že se kontrakt napíše, padlo (`DR-008`) a otevřený je
jeho obsah; kolo je přidělené i `MR-07` a `MR-10` — viz §5.3. **Přidělení kola
blokádu nezmenšuje**: dokud kontrakt neprojde a není refrozen jako v2, nestaví se
k těmto požadavkům nic. Ani potom schválení kontraktu samo implementaci
neautorizuje; zůstává Gate 1 a samostatný Work Package.

**Proč právě tyhle gaty:**

- **N-1** je teď nejtvrdší ze zbylých dvou, a po uzavření `M-1` drží víc než
  dřív: rozhodnutí o spící aplikaci je zároveň rozhodnutím, zda PWA klient
  stačí, nebo se přepisuje na nativní. Podpora spící aplikace může vyžadovat
  **APNs/FCM a serverovou registrační infrastrukturu**. To není přepínač v
  klientovi, ale kus backendu a cloudová závislost, která se do architektury
  nedá dolepit potom.
- **R-2** nedrží nic z designu, ale drží provoz — a padnout musí dřív, než
  poprvé něco poteče mimo loopback, tedy až po uzavření `GAP-2`.

Plus sedm klientských rozhodnutí `D-M1`..`D-M7` v [DATA-MODEL.md](DATA-MODEL.md) §7,
jedno otevřené `D-T4` v [TEST-STRATEGY.md](TEST-STRATEGY.md) §10 a tři otevřená
`D-S` v [SCREENS.md](SCREENS.md) §6 — `D-T1`..`D-T3` a `D-S1` jsou uzavřené.
Souhrnný přehled všech je v [COVERAGE.md](COVERAGE.md) §8.

ADR 0001 je uzavřená. Dnešní implementovaný/source-policy-frozen 13-route HTTP
allow-list existuje; **formální v2 pro nové domény** se ale nepíše ani
nerefreezuje, dokud Gate 0 nedosáhne reprodukovatelného PASS a dokud není
oddělená security boundary prokázaná negativními testy — viz §8.

---

## 10. Stav dokumentové sady

Přesný dokumentační vstup `41983e8f` prošel `RV-036` jako
`APPROVED_WITH_FOLLOWUPS`, kompozice `RV-039`/`RV-040` a registry handoff
`RV-042`/`RV-043`. Tato následná post-M3 truth úprava je přesně ohraničená jako
`WP-MOBILE-026`; její review evidence se vede samostatně v governance. Sada
**formálně nerefreezuje žádný kontrakt v2**; jen popisuje již existující
13-route HTTP allow-list.

> **Pozor na dřívější formulaci.** Tato sekce dřív tvrdila, že větev
> „neimplementuje nic". To už neplatí: gateway, `/m1` handlery, pairing, žurnál
> operací a PWA klient existují (§2, §7.1). Historické approval/MS-20
> `392c5928` dostalo v `RV-023`–`RV-025` `CHANGES_REQUIRED`; jeho disjunktní
> successory `a3443de1`/`0292cb69` dostaly v bounded `RV-028`
> `APPROVED_WITH_FOLLOWUPS` a nyní jsou lokálně složené pod
> `PC-012`/`WP-MOBILE-024`; reconciliation prošla `RV-038` a kompozice
> `RV-039`/`RV-040`. Nejsou produktově hotové: celý profil je FAIL `208/3`,
> sdílená validace a `WP-MOBILE-025` jsou blokované, Gate 0 verdikt nebyl vydán
> a `F-100` zůstává otevřené. Historický `PC-010` nebyl proveden a byl nahrazen
> `PC-012`. Stavy jsou v §5.1, §5.2 a §7.2 a žádný není DONE.

| Dokument | Co odpovídá | Stav |
|---|---|---|
| [ADR 0001](../adr/0001-mobile-data-ownership.md) | Kde žijí data | **ACCEPTED** |
| PLAN.md (tento) | Co se staví, v jakém pořadí a co to blokuje | kompozice a registr reviewed; post-M3 truth zachovává shared validation BLOCKED |
| [DATA-MODEL.md](DATA-MODEL.md) | Co smí ležet v telefonu a co zbyde po jeho ztrátě | totéž |
| [TEST-STRATEGY.md](TEST-STRATEGY.md) | Čím se to prokáže a jak to vstoupí do kanonického registru | totéž |
| [SCREENS.md](SCREENS.md) | Co uživatel vidí v každém z deseti stavů | totéž |
| [COVERAGE.md](COVERAGE.md) | Kde jsou v tom všem díry | totéž |

**Co se stane dál, v tomto pořadí:**

1. ~~Uzavřít Composition Review C~~ — dokončeno `RV-039`/`RV-040`.
2. ~~Registrovat čtyři programy a překlasifikovat `MS-20`~~ — dokončeno
   `eee04db9`/`RV-042`, při zachování ID.
3. ~~Srovnat chráněné hodnoty a spustit deterministickou validaci~~ — hodnoty
   schválilo `RV-043`; validace pravdivě skončila `208 PASS / 3 FAIL`.
4. Mimo mobilní scope opravit `F-115`/`F-116`, pak zopakovat celý přesný profil.
   Teprve jeho PASS může vstoupit do úplného Gate 0 rozhodnutí.
5. `S-1`..`S-4`, skutečný non-loopback test a všechny další gate podmínky
   zůstávají nutné pro uzavření `GAP-2`; vzdálené zpřístupnění je zakázané.

**Poznámka k provenienci:** lokální kandidát `4553b3ee` vychází z přesného
základu `a92e537`; source composition vede přes `8c3376eb`. Dokumentace byla
přinesena `--no-ff` z `41983e8f` se zachováním publikovaného předka `1accf655`.
Post-M3 truth změny zůstávají lokální a bez push; jejich review výsledek se
eviduje v governance. Ani schválení dokumentace není Gate 0 handoff ani
integrační autorita.
