# IntentSmith Mobile — zadání a plán realizace

**Status:** návrh k review; nic není schváleno k implementaci
**Datum:** 2026-07-30
**Ověřeno proti:** `54913a1` na `codex/intentsmith-1.0`
**Datový model:** REMOTE_COMPANION — rozhodnuto, [ADR 0001](../adr/0001-mobile-data-ownership.md) ACCEPTED
**Navazující dokumenty:** [DATA-MODEL.md](DATA-MODEL.md) · [TEST-STRATEGY.md](TEST-STRATEGY.md) · [SCREENS.md](SCREENS.md) · [COVERAGE.md](COVERAGE.md)

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
SHA-256, kontroluje expiraci, vrací `scopes` — a **není nikde importovaná**.
V kódu stojí `// TODO (Phase 3b): Wire into route-level middleware`.

### Co z toho plyne

Bind `C3_HOST` mimo loopback = **neautentizované vzdálené spuštění příkazů**
pro každého na té síti. Není to mobilní problém; je to vlastnost současného
systému. Evidováno jako `G0-R021`.

Samotný scope middleware na `/m1` proto **nestačí** — útočník by `/m1` ignoroval
a šel přímo na legacy API nebo na WS terminál na stejném portu.

### [R] Řešení: oddělený listener

```
   telefon
      │ jen VPN adresa
      ▼
 ┌──────────────────────────────┐     ┌────────────────────────────┐
 │ mobile gateway (nový)         │     │ stávající server           │
 │ bind: VPN adresa              │     │ bind: 127.0.0.1 — NIKDY    │
 │ vystavuje: /m1/*, /m1/ws      │────▶│ jinam                      │
 │ fail-closed scope guard       │     │ /api/*, /c3/ws (terminál)  │
 └──────────────────────────────┘     └────────────────────────────┘
```

**Šest pravidel:**

1. Stávající listener **nikdy** neopustí loopback.
2. Telefon nikdy nedrží `C3_ADMIN_TOKEN` — vždy device token se scopem.
3. Gateway vystavuje jen `/m1/*` a `/m1/ws`. Default deny.
4. Terminal channel a `/api/security/*` nejsou z gateway dosažitelné nikdy, ani se scopem.
5. Fail-closed: chybějící scope, expirovaný token, neznámá verze → 401/403/409, nikdy tichý fallback.
6. Backend kvůli mobilu neoslabí žádný existující kontrakt (CRE zůstává jedinou autoritou, QGv2 se neobchází).

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
**bez vzdáleného zpřístupnění serveru** a **bez zmrazení `/m1` kontraktu**.

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
| P6 | ~~Live stream~~ → progres běhu | agent log události (`LLM_START`, `LLM_DONE`, `GATE_VERDICT`) jako indikace postupu |
| P7 | Reconnect dle §3 | historie se znovu načte, přerušený turn označen |

**Vědomě mimo Fázi 0:** approvaly, editace nastavení, projekty, iOS, cloud push,
vzdálené zpřístupnění serveru.

**Backendové úkoly:**

| # | Úkol | Pozn. |
|---|---|---|
| B1 | Mobile gateway jako samostatný listener | §2, nikoli `/m1` na stávajícím serveru |
| B2 | Zapojit `validateApiToken` + scope tabulka | funkce hotová, chybí middleware |
| B3 | Negativní testy hranice | **před** B4, do registru testů |
| B4 | `POST /m1/pair/claim` — atomický jednorázový kód | nejrizikovější nový kód |
| B5 | `GET /m1/health`, `/m1/capabilities`, `/m1/conversations`, `POST /m1/chat` | delegace na existující |
| B6 | WS notifikační kanál pro in-app notifikace | §6 |

Odhady v člověkodnech záměrně neuvádím — po P1 (párování end-to-end) se přeměří.

---

## 5. Fáze 1–5

[ADR 0001](../adr/0001-mobile-data-ownership.md) je ACCEPTED jako REMOTE_COMPANION,
takže všechny fáze níže jsou v rozsahu.

- **Fáze 1 — Konverzace:** historie, stránkování, hledání, přepínání, markdown, offline cache pro čtení.
- **Fáze 2 — Nastavení:** viz dělení níže.
- **Fáze 3 — Projekty a approvaly ★:** nejcennější fáze; sem patří celá bezpečnostní logika ze spike (single-use approvaly vázané na payload hash, expirace, revokace, replay ochrana, idempotency).
- **Fáze 4 — Uchovávání informací:** LTM a task memory read-only, ruční poznámka. Bez mazání.
- **Fáze 5 — Workeři:** stav agentů, historie, dry-run. Bez vytváření agentů.

**[D] Za 1.0:** iOS, vytváření agentů/specialistů, marketplace, editace skillů,
cokoli se shell přístupem.

### [?] R-5 — dělení nastavení

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

**[F]** `broadcast(channel, data)` existuje (`src/ws-bridge/ws-server.js:250`),
ale notifikační pipeline ho nepoužívá. `desktop.js` je Electron-only.

**[R]** Nový notifikační kanál nad `NotificationChannel` abstrakcí, který volá
`broadcast()` na mobilní gateway (úkol B6).

**Hranice — produktový limit, ne bug:**

| Stav appky | Dorazí? |
|---|---|
| Popředí | ✅ okamžitě |
| Pozadí, proces žije, VPN aktivní | ⚠️ dokud OS proces neuspí |
| Zavřená / proces zabitý / VPN dole | ❌ nic |

**[?] N-1 — notifikace při spící appce:**

- **(a) Nijak** — in-app only. Nulová externí závislost. **Doporučeno pro Fázi 0.**
- **(b) ntfy** — kanál `ntfy.js` v backendu existuje. **Korekce:** ntfy je bez
  Googlu jen při použití F-Droid buildu se self-hosted serverem nebo instant
  delivery; běžná instalace z Play Store používá FCM. Bez Googlu to tedy znamená
  self-hosting **i** F-Droid distribuci.
- **(c) FCM** — plné push, ale cloud a rozpor s offline-first. **Nedoporučeno do 1.0.**

---

## 7. Platforma

**[?] M-1:** doporučuji **React Native + Expo + TypeScript**.

Odůvodnění: celý stack je JS/TS, takže neopouštíš jazyk a API typy lze sdílet.
Flutter by vyhrál u polished aplikace s hodně custom grafikou — což Fáze 0 není.

**Korekce z review:** Expo Go je playground s omezeními a sám Expo ho pro
skutečné projekty nedoporučuje. Použij ho maximálně na první obrazovky;
od okamžiku, kdy je ve hře `expo-secure-store` a device token, je potřeba
**development build**.

---

## 8. Vztah ke Gate 0

Repozitář Gate 0 nedrží. Roadmapa říká *„žádná fáze se neotevírá, dokud
předchozí gate nedrží"*.

**Schválený kompromis:** Fáze 0 je discovery spike, ne otevření fáze. Podmínky:

1. **Žádné vzdálené zpřístupnění serveru** dokud neplatí §2 včetně negativních testů.
2. **Kontrakt `/m1` se nezmrazí**, dokud backend nemá Gate 1 pro `C3-002`
   (chat sessions) a `C3-023` (API/WS bridge).
3. **Mobilní testy do registru od prvního dne** — ať nevznikne druhá
   nedohledatelná testovací plocha.
4. **B2 (scope enforcement) je nepodkročitelný** i pro spike.
5. Spike je časově omezený; po vypršení se vyhodnotí, nepokračuje setrvačností.

### 8.1 Potvrzený zákaz do doby, než hranice projde testy

Operátor potvrdil stav `BLOCKED` u hraničních negativních testů jako správný
(`GAP-2` v [COVERAGE.md](COVERAGE.md)). Dokud nevznikne vlastněný supervizor
a **neprojdou všechny hraniční negativní testy**, neplatí žádná výjimka:

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

---

## 9. Otevřená rozhodnutí

### Uzavřená — kde a čím

| # | Rozhodnutí | Kde žije |
|---|---|---|
| **ADR 0001** | REMOTE_COMPANION jako datový model klienta | [ADR 0001](../adr/0001-mobile-data-ownership.md) ACCEPTED |
| **`D-S1`** | Klíč operace: 128bitový `operationId`, dedup podle `(deviceId, operationId)`, `UNKNOWN` bez nového klíče, klíč neopravňuje | [DATA-MODEL.md](DATA-MODEL.md) `MD-19` §4.1–§4.3, [SCREENS.md](SCREENS.md) §5.1 |
| **`D-T1`** | `C3-031` a `C3-032` se přidají **atomicky s prvním skutečným mobilním testem** | [TEST-STRATEGY.md](TEST-STRATEGY.md) §3.1 |
| **`GAP-2`** | Do doby, než hranice projde testy: žádný bind mimo loopback, listener, pairing, `/m1` ani tvrzení o prokázané hranici | §8.1 tohoto dokumentu |

### Stále otevřená

| # | Otázka | Doporučení | Co na tom visí |
|---|---|---|---|
| **M-1** | Expo/RN vs Flutter | Expo/RN + TS, development build | rodina testů `MX` a její můstek |
| **N-1** | Notifikace při spící appce | (a) pro Fázi 0, pak (b) jako opt-in | `MR-21`, tok `MS-05` |
| R-2 | VPN: Tailscale vs WireGuard | — | nic z designu; čistě provozní volba |
| R-3 | Approval TTL: lokální vs remote | rozlišit; 5 min je pro telefon nedosažitelných | `MD-07`, tok `MS-14` |
| R-4 | Je diff obsah stahovatelný na telefon? | ne pro 1.0, viz `D-M7` | `MD-05`, `MD-07` |
| R-5 | Dělení nastavení dle §5 | tabulka v §5 je návrh k potvrzení | `MD-01`, toky `MS-10`/`MS-11` |

Plus sedm klientských rozhodnutí `D-M1`..`D-M7` v [DATA-MODEL.md](DATA-MODEL.md) §7,
tři otevřená `D-T` v [TEST-STRATEGY.md](TEST-STRATEGY.md) §10 a tři otevřená
`D-S` v [SCREENS.md](SCREENS.md) §6 — `D-T1` a `D-S1` jsou uzavřené výše.
Souhrnný přehled všech je v [COVERAGE.md](COVERAGE.md) §8.

ADR 0001 je uzavřená. API kontrakt `/m1` se ale nepíše, dokud Gate 0 nedosáhne
reprodukovatelného PASS a dokud není oddělená security boundary prokázaná
negativními testy — viz §8.

---

## 10. Stav dokumentové sady

Mobilní designová větev je **kompletní jako design**. Neimplementuje nic
a nezmrazuje žádný kontrakt.

| Dokument | Co odpovídá | Stav |
|---|---|---|
| [ADR 0001](../adr/0001-mobile-data-ownership.md) | Kde žijí data | **ACCEPTED** |
| PLAN.md (tento) | Co se staví, v jakém pořadí a co to blokuje | k review |
| [DATA-MODEL.md](DATA-MODEL.md) | Co smí ležet v telefonu a co zbyde po jeho ztrátě | k review |
| [TEST-STRATEGY.md](TEST-STRATEGY.md) | Čím se to prokáže a jak to vstoupí do kanonického registru | k review |
| [SCREENS.md](SCREENS.md) | Co uživatel vidí v každém z deseti stavů | k review |
| [COVERAGE.md](COVERAGE.md) | Kde jsou v tom všem díry | k review |

**Co se stane dál, v tomto pořadí:**

1. Gate 0 dosáhne reprodukovatelného PASS z čerstvého klonu (mimo tuto větev).
2. `S-1`..`S-4` hotové včetně negativních testů — teprve tím padá `GAP-2`.
3. První mobilní test + oba capability řádky v jednom atomickém commitu (`D-T1`).
4. Teprve pak discovery spike Fáze 0, pořád bez vzdáleného zpřístupnění.

**Poznámka k základu větve:** dokumenty jsou ověřené proti `54913a1`, který
**není předkem** tehdejší hlavy remote `be84c53` — obě větve se rozešly
v `GATE-CRITERIA.md` a `ROADMAP.md`. Oprava kritérií Gate 0 (Gate 1 vstupuje
jen z `PASS`, dvě nové FAIL podmínky) žije jen na `54913a1`. Kdo tyto dokumenty
čte proti jinému commitu, musí si ten rozdíl ověřit dřív, než se o jejich
`[F]` tvrzení opře.
