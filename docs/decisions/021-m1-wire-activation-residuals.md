# 021 — Produkční ACK M1 wire čeká na attachment a effect-authority policy

- **typ:** přijatá source aktivace; BLOCK zůstává pro built B4 acceptance
- **stav rozhodnutí:** B / REJECT / A / B PŘIJATO operátorem 2026-08-09 včetně
  korekce autority limitů; operátor 2026-08-10 povolil source ACK po obou
  focused negativních sadách. Built Electron journey dál blokuje B4/PASS,
  nikoli commit source aktivace.
- **WP:** WP-M1-STUDIO / B4
- **rail:** R1, R2, R3, R5, R6
- **vzniklo při:** implementaci accepted 017/A+A ingress/egress a terminal ledgeru

## Co už není otázka

Rozhodnutí 017 závazně určilo required-offer token `m1-wire-v1` a exact
`{command, context}` wrapper. Implementační kandidát už:

- validuje command, outer wrapper i context před controller efektem;
- zachovává request/conversation/turn identitu a per-command monotónní sequence;
- emituje právě jeden validovaný `CoreEvent` stream bez legacy assistant nebo
  legacy `turn_end`;
- implementuje 004/C: target `cancelled` vždy předchází vlastnímu cancel
  `cancelled`, včetně více souběžných idempotentních cancel požadavků;
- fail-closed odmítá legacy chat/cancel po negotiated ACK;
- nechává `m1WireSupported=false` jako explicitní server activation seam.

`src/server.js` tento seam nepředává. Produkční server proto token stále
pravdivě neACKuje a stávající Studio zůstává na legacy wire. Tento dokument
není žádost o skrytý default ani důvod oslabit listener guard.

## Proč nelze jen přepnout boolean

### R1 — Přílohy dnes zahrnují implicitní filesystem autoritu

Studio před odesláním používá `FileReader`, ale při prázdném nebo chybovém
výsledku zachová také lokální `path`. `ChatController.handle()` pak pro
attachment bez contentu volá synchronní `fs.readFileSync(a.path)`. Přijetí
libovolného path z negotiated contextu by tedy nebylo pouhé doručení dat;
udělilo by remote commandu read authority nad backend filesystemem.

Původní B4 mezistav proto přijímal pouze exact `attachments: []`. Dormantní
implementační kandidát už podporuje variantu B: bez explicitní validní policy
token vůbec neACKuje, po vyjednání přijme jen exact inline DTO a každé porušení
ponechá lokálně jako typované `NOT_SENT` bez downgrade do legacy. Produkční
číselná policy ani ACK tím ještě zavedené nejsou.

| Varianta | Chování | Dopad |
|---|---|---|
| A — park do M2 | Produkční M1 ACK zůstane vypnutý, dokud M2 nevlastní attachment/read autoritu. | Bez regrese, ale B4 se neuzavře před M2 a změní se roadmap dependency. |
| B — bounded inline-only v B4 | Studio smí poslat pouze exact inline content bez `path`; count, jednotlivá i aggregate velikost a typ jsou omezené na obou stranách. Path nebo contentless položka je `NOT_SENT`. | Zachová běžné text/image FileReader přílohy bez nové FS autority; vyžaduje exact DTO a negativní byte/count testy. |
| C — ACK s prázdnou policy | M1 se zapne hned a každá neprázdná příloha zůstane `NOT_SENT`. | Nejmenší kód, ale vědomá produktová regrese vůči C3. |
| D — přijmout legacy path | Backend dál čte callerem zadanou cestu. | Nepřijatelné: nová nebrokerovaná filesystem authority. |

**Doporučení:** B. Je to nejmenší behavior-preserving šev: obsah už Studio
lokálně vlastní, zatímco path se explicitně zahodí. Odkud se berou přesné
limity, řeší korekce níže — nesmějí se odhadnout ani převzít z klienta.

#### Autorita limitů — operátorská korekce 2026-08-09

Review původně odvozovalo limit ze slideru `c3.system.maxFileSize`. To je
špatná autorita. Skutečné hodnoty jsou `config.limits.maxTextAttachment`
(1 MB) a `config.limits.maxImageAttachment` (5 MB), obojí přepsatelné přes
`C3_MAX_TEXT_ATTACHMENT` / `C3_MAX_IMAGE_ATTACHMENT`; Studio je přebírá
z health response do `_MAX_TEXT_SIZE` / `_MAX_IMG_SIZE`. Slider do 10 MiB je od
této cesty dnes odpojený a nesmí se stát vstupem wire policy.

Další čtyři fakta, která policy nesmí domyslet:

1. strop 256 CoreEventů a 1 048 576 bajtů na turn níže je limit **serverových
   CoreEventů směrem ke klientovi**, ne limit uploadu; nesmí se recyklovat jako
   attachment cap;
2. dnešní UI nemá žádný počet příloh; count limit je proto **nová** explicitní
   runtime policy, ne převzatá hodnota;
3. WS server nemá projektový `maxPayload`, takže dnes platí jen default
   knihovny — vlastní strop musí vzniknout s policy;
4. Legacy Electron picker vrací primárně cestu, nikoli bajty. Negotiated M1
   proto používá standardní user-gesture `File` picker a `FileReader`; hodnotu
   `File.path`, pokud ji Electron objekt zpřístupní, ignoruje. Chyba čtení končí
   typovaným `NOT_SENT`, nikdy backendovým path fallbackem. Built Electron
   journey musí ještě prokázat, že tato byte cesta funguje v distribuovaném
   rendereru.

Velikost se měří jednoznačně: text jako UTF-8 bajty, obrázek jako dekódované
bajty, aggregate rovněž dekódovaně a navíc strop na celý serializovaný frame.
Klientské odmítnutí je typované, viditelné a neretryovatelné `NOT_SENT`; server
tutéž policy znovu ověří **před** controller efektem. `path` se v DTO
nevyskytuje vůbec, ani jako `null`. Prázdný text zůstává legitimní obsah `""`,
nikoli chybějící content. Binární přílohy mimo schválené obrázkové typy jsou
odmítnuté. Textovou větev smí otevřít pouze současný allowlist textových přípon;
neznámá přípona zůstává binary a končí `NOT_SENT`, i kdyby její bytes tvořily
platný UTF-8. Povolená textová větev čte původní bytes přes `ArrayBuffer` a
používá fatal UTF-8 decode; nesmí použít lossy `FileReader.readAsText()`.
Klient i server navíc odmítnou zakázané C0/DEL řídicí znaky a neplatné surrogate
páry. Soubor, který tuto definici nesplní, je typované nereplayovatelné
`NOT_SENT` ještě před wire/controller efektem.

### R2 — Legacy WS po chat success automaticky vykoná shell effect

Legacy `session-adapter.js` po controller výsledku kontroluje
`response.metadata.shellCommand` a fire-and-forget volá `handleTerminal()`.
Tento effect nemá M1 command/result autoritu, approval ledger ani jednotný
terminál. Kanonická větev jej správně nespouští, ale dnes by přesto mohla vrátit
chat `ok`, a tím nepravdivě tvrdit parity u SHELL intentu.

| Varianta | Chování | Dopad |
|---|---|---|
| A — honest no-effect terminal | M1 rozpozná požadovaný legacy effect před `ok` a vrátí typovaný `error/M1_EFFECT_AUTHORITY_REQUIRED`; nic nespustí. | Umožní bezpečně aktivovat běžný chat, ale SHELL je výslovně unavailable do M2. |
| B — M2 authority před B4 aktivací | Produkční ACK čeká na jeden schválený effect/approval port a SHELL přes něj dostane vlastní run identitu. | Nejlepší parity, ale mění pořadí M1→M2 a rozšiřuje současný WP. |
| C — převzít legacy auto-exec | M1 po chat success dál fire-and-forget spustí shell. | Nepřijatelné: dvojí autorita a false-success při effect failure. |
| D — selektivní turn downgrade | SHELL turn se po negotiated ACK pošle legacy. | Nepřijatelné podle 017: negotiation je connection-level a turn fallback je zakázán. |

**Doporučení:** A teď, B jako M2 náhrada. A nepředstírá funkci, kterou nový
connector neumí bezpečně potvrdit, a drží jediný vratný šev v mapování controller
výsledku na `ConversationResult`. Nejde o finální parity; B4/Gate 1 musí tuto
odchylku uvést explicitně, dokud ji M2 neuzavře.

Odmítnutí musí nastat před finalizací a zápisem assistant turnu. Nestačí
odfiltrovat shell metadata až po návratu `ChatController.handle()`: taková
varianta by sice neposlala wire success, ale durable historie by dál obsahovala
falešné „spouštím“. Při `M1_EFFECT_AUTHORITY_REQUIRED` smí zůstat jen již
přijatý user turn a jediný kanonický error terminal; assistant odpověď ani
legacy terminal channel efekt nevzniknou.

## Reversible implementační defaulty, které neblokují ACK samy o sobě

- číselná Studio `agentId`/`projectId` se na jediném producer seamu převádí na
  kanonický decimal string; malformed hodnota skončí před wire efektem;
- jedna conversation má nejvýše jeden aktivní M1 send; HTTP a WS mutex zůstávají
  oddělené podle Findingu 005 a globální autorita se netvrdí;
- klient přijme nejvýše 256 CoreEventů a 1 048 576 serializovaných UTF-8 bajtů
  na turn. Jde o client safety ceiling, nikoli provider payload SLA;
- terminal ledger drží nejvýše 256 položek a po terminálu zahodí payload,
  event history, socket i panel reference. Zůstane pouze bounded identity/order
  tombstone potřebný pro cancel ordering.

Tyto hodnoty se mohou změnit v jedné pojmenované funkci a focused testu. Pokud
skutečný built journey prokáže, že legitimní provoz limit překračuje, změna se
udělá z měření, ne skrytým odstraněním limitu.

## Důkaz, který ještě chybí bez ohledu na volbu

Dřívější clean-clone build doložil obecný compiled `@c3/protocol` consumer,
nikoli tento nový attachment-policy delta. Po jeho immutable commitech musí
nový čistý klon znovu provést frozen offline install, forced protocol prebuild,
production build, bundle/runtime probe a negotiated
attachment/multi-panel/cancel/provider/reconnect journey. Teprve potom lze
candidate změnit z focused PASS na built evidence.

## Přesná otázka pro operátora

```text
021-attachments: B-bounded-inline-only
021-path-authority: REJECT
021-shell-now: A-honest-no-effect-terminal
021-shell-target: B-M2-effect-authority
021-production-ack: AFTER-BOTH-NEGATIVE-SUITES
021-b4-acceptance: AFTER-BUILT-ELECTRON-JOURNEY
021-attachment-policy-authority: NORMALIZED-SERVER-RUNTIME-CONFIG
021-attachment-policy-delivery: VERSIONED-M1-NEGOTIATION-METADATA
021-attachment-count-source: NEW-EXPLICIT-RUNTIME-POLICY
021-attachment-size-semantics: TEXT-UTF8+IMAGE-DECODED+AGGREGATE-DECODED+WHOLE-FRAME-UTF8
021-attachment-client-rejection: TYPED-VISIBLE-NONRETRYABLE-NOT_SENT
021-attachment-server-revalidation: REQUIRED-BEFORE-CONTROLLER
021-electron-file-source: USER-GESTURE-BYTES-OR-TYPED-NOT_SENT
021-binary-policy: REJECT
```

Operátor původní blok přijal 2026-08-09 a 2026-08-10 výslovně rozdělil source
aktivaci od drahé Electron evidence. `m1WireSupported` lze zapnout v produkční
composition vrstvě až po obou focused negativních sadách. Attachment policy se
nesmí rozšířit nad tento blok a legacy shell effect se nedědí. Built Electron
journey je nadále povinná pro B4/PASS a skutečné runtime tvrzení; source ACK ji
nenahrazuje.

### Implementační stav 2026-08-10

Dormantní server i Studio seam umějí exact versioned metadata, user-gesture
inline DTO, klientský i serverový count/item/aggregate/frame guard, druhé
serverové měření a typovaný nereplayovatelný `NOT_SENT`. Source activation
candidate nyní skládá policy výhradně z runtime configu: `maxCount=8`, decoded
aggregate `6 MiB`, celý UTF-8 frame `12 MiB` a stávající item capy `1 MiB` text
/ `5 MiB` image. Produkční composition používá default-on
`C3_ENABLE_M1_WIRE`, ale required-offer sémantika zachovává legacy klienta.

`tests/ws-bridge.test.js` prošel 91/0 a `tests/m1-studio-client.test.js` 127/0;
obě sady exit `0`. První pokus o WS sadu skončil před testy na chybějícím
`better-sqlite3`; po `npm ci --offline` se zopakoval celý a prošel. Follow-up
po prvním neúspěšném Review A dál čte text byte-first s fatal UTF-8 decode a
odmítá shell metadata na posledním vratném pre-persistence seamu.

Tento stav je pouze `SOURCE_ENABLED / FOCUSED_VERIFIED`. Electron, produkční
build, X11/Wayland journey, GPU, Ollama ani externí síť nebyly spuštěné.
Immutable Review A a built attachment/multi-panel/cancel/provider/reconnect
journey proto zůstávají otevřené; B4 a Gate 1 nejsou PASS.
