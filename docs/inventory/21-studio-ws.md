# Inventura #21 — Studio a WS bridge

**Pořadí 8** · **2026-08-02** · `17a8b9a8` · 5 souborů, **1 271 řádků** + `c3-ide/`

| Soubor | Ř. |
|---|---:|
| `session-adapter.js` | 676 |
| `ws-server.js` | 333 |
| `protocol.js` | 132 |
| `file-watcher.js` | 103 |
| `index.js` | 27 |

**Testy:** 4 sady — `offline` 2, `server` 2. `lastGreen: 0`.
**Ověřeno za běhu:** `/architect` vrací 200 a 74 KB, `/agents` 200, WS se připojuje na `/c3/ws`.

## Dobré, použije se
- **`protocol.js` odděleně** (132 ř.) — verze protokolu je vlastní modul, ne rozeseté konstanty.
- **`broadcast(channel, data)`** — kanálový model pro `control` (media/GPU/system progress).
- **Odpojení ruší práci** — `session-adapter.js` při disconnectu abortuje aktivní turny a zamítne pending edity. Nezůstávají viset.
- **`file-watcher.js` (103 ř.)** — malý, jedna starost.

## Zbytečné
Nic prokazatelného.

## Nejasné
| # | Zjištění | Otázka |
|---|---|---|
| **W-1** | **Terminal channel přijímá `{type:"exec", command}`** (`session-adapter.js:398`) po handshaku, který ověřuje pouze `protocolVersion` (`ws-server.js:126`). Na loopbacku neškodné, mimo něj je to RCE — to je `G0-R018` a invariant L0-10. | Nic k rozhodnutí teď (bezpečnost je odložená), ale **musí to zůstat viditelné**, protože to je nejtvrdší omezení celého produktu. |
| **W-2** | **Rehydrate vrací předložené conversation ID bez ověření v DB.** | Vada, nebo záměr? Klient si může říct o cizí konverzaci. |
| **W-3** | **Token streaming neexistuje** — `onLLMToken` je konzument bez producenta, komentář v kódu říká *„reserved for future use"*. Odpověď přichází až celá. | Je streaming v rozsahu 1.0? Ovlivňuje to vnímanou rychlost víc než cokoli jiného. |
| **W-4** | **`c3-ide/` (Theia/Electron) je produktová plocha, ale není ještě kompletně inventarizovaný.** WP-M0-E už změřil fresh-clone install, build, boot, WS, deterministický chat, outbound a local HTTP boundary; hluboká inventura 139 souborů a 20+ rozšíření zůstává součástí #21. | ~~Vlastní inventura pro IDE, nebo se 1.0 opře o web UI `/architect`?~~ **Uzavřeno 2026-08-02: IDE je plocha produktu, web UI je legacy.** Otevřená už není volba produktu, ale source disposition a oprava dvou níže doložených Studio vad. Viz `DIRECTION.md` §3 a WP-M0-E níže. |

## WP-M0-E — fresh-clone Studio probe (2026-08-03)

**Výsledek: `COMPLETED_WITH_PRODUCT_FAIL`.** Probe běžel v disposable klonu
na `df8f10399888726e7c5258d42bd00bdcb3cc1d25`. Produktový strom od
`ac320335` byl beze změny (`git diff --quiet ac320335..df8f1039 -- src c3-ide
package.json package-lock.json`, exit `0`). Osm rozpracovaných inventur v
hlavním checkoutu zůstalo read-only.

### Instalace, build a skutečný source-of-truth

| Příkaz / kontrola | Výsledek |
|---|---|
| `npm ci` | exit `0`, 233 balíčků; audit hlásí 3 moderate, 6 high a 1 critical nález. `audit fix` nebyl spuštěn. |
| z `c3-ide/`: `corepack yarn install --frozen-lockfile` | exit `0`, Yarn `1.22.22`, lockfile beze změny |
| z `c3-ide/`: `corepack yarn build` | exit `0`, production Theia build, 5 webpack warnings, pracovní strom po buildu čistý |
| z `c3-ide/`: `corepack yarn workspace @c3/chat-panel build` | **exit `1`**, šest `TS2307` na neexistující `c3-ide/extensions/lib/utils/cn` |

Příkazy musí běžet z `c3-ide/`. `corepack yarn --version` spuštěný z kořene
repozitáře končí exit `1`, protože kořenový `packageManager` je `npm`; pouhé
`--cwd c3-ide` se vyhodnotí až pozdě.

Zelený Theia build nekompiluje `@c3/chat-panel` z TS. Package i Theia entrypoint
ukazují na commitnutý `lib/browser/chat-panel-module.js`. Ten zůstal po buildu
byte-for-byte stejný (7 062 řádků, SHA-256
`d8e7c3def4135fb36bc89c84a971b59d8e854a765411207ac58ce452ee3f609c`)
a vzniklý Electron bundle má SHA-256
`e7d8462f7d5e3580f3cbf5ae8db1ac1507a8261299cbd0409a56aa496dff2fac`.

To není nová skrytá konvence: `docs/dev-checklist.md` výslovně říká, že
`chat-panel-module.js` je ručně udržovaný a `tsc -b` se nesmí spustit, protože
by jej stale TS přepsal. `src/` má 1 127 řádků a naposledy se měnilo v únoru;
`lib/` má 8 743 řádků a nese funkce až do července. Samotná oprava šesti importů
by proto byla nebezpečná: umožnila by přepsat funkční produkt menším prototypem.

Neúspěšný workspace build před zastavením změnil čtyři trackované generated JS
soubory (`+75/-10`) a vytvořil 36 untracked declaration/map výstupů v
`c3-protocol/lib` a `c3-backend-bridge/lib`; `c3-chat-panel/lib` nezměnil.
Vše vzniklo pouze v disposable klonu.

### Diagnostický artifact runtime pod blokovanou sítí

Samostatný čistý klon byl spuštěn v user+network namespace s aktivním pouze
loopbackem, vlastním `HOME`, SQLite, projects/output/temp rootem, bez Ollamy,
ComfyUI, autonomie a online discovery. Electron v user namespace vyžadoval
diagnostický `--no-sandbox`; jde o omezení tohoto probe, ne release konfiguraci.

- Theia při počátečním bootu přešla do stavu `ready` za 13,2 s;
- Studio zobrazilo commitnuté plné UI a WS handshake na `/c3/ws` prošel;
- skutečný první chat panel odeslal `kolik je 17 * 23?` a zobrazil přesně
  `📊 **17*23 = 391**`; backend naměřil celý turn **24 ms**, bez modelu;
- renderer se přesto pokusil načíst `fonts.googleapis.com`; síťový namespace
  pokus zablokoval;
- původně zaznamenaných šest běžných HTTP rodin (`/api/health`, `/api/projects`,
  `/api/conversations`, `/api/expertises`, `/api/media/history`, `/health`)
  vracelo **403**. Původní nezachované DevTools pozorování je chybně připsalo
  chybějící capability; sanitizovaná revalidace níže prokázala jinou příčinu a
  navíc zachytila vždy spouštěnou sedmou rodinu `/api/agents`;
- kontrolní raw request se stejnými opaque-origin hlavičkami skončil bez
  capability `403` a s capability `200`. Backendová boundary tedy funguje;
  rozbitá je skutečná browser delivery cesta.

Přibližně šest minut po startu, při ukončování diagnostického namespace, zapsal
Electron `GPU process isn't usable` a skončil signálem `SIGTRAP`; backend ve
stejném okamžiku přijal řízený `SIGTERM` a ukončil se čistě. Protože k tomu
došlo při teardownu user/network namespace a probe vyžadoval `--no-sandbox`,
nelze výsledek pravdivě klasifikovat ani jako produktový crash, ani jako čistý
shutdown. Počáteční boot/WS/chat journey je `PASS`; stabilita a korektní
ukončení jsou `INCONCLUSIVE` a musí je připnout budoucí Studio journey.

Lokální review artefakty jsou v
`.intentsmith-artifacts/m0e-studio-probe-df8f1039/`: screenshot po odpovědi
(SHA-256 `495dced0b5c247eb126d8abf87d4c575e5eef8e89906a52fd94aca82fd2a9bef`),
backend log (`1ffc773d…27c75`) a Electron log (`d7b011d0…64abf`). Adresář má
mód `0700`, soubory `0600`; lokální capability hodnota se neeviduje.

Zachované logy dokazují `ready`, WS, chat, opakovaná boundary odmítnutí a
závěrečný `SIGTRAP`; neobsahují však strojově čitelný export DevTools Network.
Původní seznam šesti URL, Fonts pokus a kontrolní `403/200` jsou proto
**current-host observation**, nikoliv plně reprodukovatelná release evidence.
Přesné instalační a build příkazy jsou v tabulce výše; runtime podmínky jsou
popsané, ale automatizovaný runner dosud neexistuje.

### Revalidace skutečných HTTP hlaviček (2026-08-07)

Na zdrojovém HEAD `1fc8f03e649dd561fb279ce68e5c119d35faad55` proběhl nový
fresh production build a skutečný Electron boot v odděleném user+network
namespace. CDP reducer zpracoval `Network.requestWillBeSent` i
`requestWillBeSentExtraInfo`, ale z hlaviček zachoval pouze bezpečné hodnoty
`Origin`, `Sec-Fetch-Site` a boolean přítomnosti capability; hodnotu capability,
cookies, authorization, body ani plný header dump neuložil.

Výsledek všech pozorovaných základních backend requestů byl:

- existující webpack bootstrap, preload bridge i local-access metadata byly po
  načtení přítomné;
- `X-IntentSmith-Local-Capability` byl na wire **přítomný**;
- `Origin` byl **nepřítomný** a `Sec-Fetch-Site` měl hodnotu `cross-site`;
- odpověď byla `403`, protože policy záměrně vrací
  `CROSS_SITE_WITHOUT_ORIGIN` před opaque-origin capability větví;
- explicitní `Request.mode = 'cors'` browser-owned hlavičky ani výsledek
  nezměnil;
- Electron i backend při tomto 35sekundovém diagnostickém běhu skončily
  řízeně s code `0`, bez signálu.

Sanitizovaný current-host artefakt je v
`$HOME/.cache/intentsmith-studio-rootcause.7SRi7E/runtime3/artifacts/network-observation.json`
mimo repozitář. Opravuje diagnózu, ale ještě nenahrazuje plánovaný commitnutý
runner, bounded soak a fresh-clone acceptance evidence.

### Přijatá source disposition

Operátor 2026-08-07 přijal dnešní funkční commitnuté JS jako autoritativní
runtime. Stale TypeScript/Tailwind prototyp se přesouvá do inertního archivu;
package `build` jej nesmí emitovat přes runtime a `clean` jej nesmí smazat.
Také historický v7 fix payload, který mohl autoritativní soubory přepsat starší
kopií, musí být neproveditelný. Případná pozdější relokace je samostatná
behavior-preserving změna, nikoliv přepis UI.

Současné UI není finální vizuální ani UX baseline. Journey připíná jen stabilní
funkční hranice: start, HTTP/WS, security, outbound, soak a clean shutdown.

Nezávisle na této volbě musí Studio repair zavřít browser capability delivery,
Google Fonts egress a přidat skutečný Electron boundary test. Do té doby je
#21 `RUNTIME_VERIFIED + BROKEN`, nikoliv `PASS`.

### Ohraničená oprava HTTP transportu (2026-08-07)

Root cause se neopravuje druhým renderer shimem ani oslabením serveru. Existující
`c3-local-http-bootstrap.js` dál přidává capability pouze pro přesný backend
origin. Nový Electron-main normalizer doplní pravdivé `Origin: null` pouze tehdy,
když současně souhlasí privátní port file, capability v constant-time porovnání,
přesný loopback origin a chráněná cesta, metoda/XHR, top-level frame a přesný
`file://.../lib/frontend/index.html`. Oddělená preflight větev přijme jen
deklarovanou podporovanou metodu a header names z množiny `Content-Type` +
capability, přičemž capability header musí být deklarovaný, ale jeho tajná
hodnota na preflightu být nesmí. Pojmenovaný nebo již přítomný `Origin`,
cizí frame/cíl/cesta, chybějící či duplicitní capability a neprivátní nebo
symlinkovaný port file končí beze změny requestu. `Sec-Fetch-Site` se nepřepisuje
a backendová policy se nemění.

Prospective index byl zkopírován mimo pracovní checkout a proti již zamčeným
lokálním závislostem prošel production build (`corepack yarn build`, exit `0`,
pět existujících webpack warnings). Osm autoritativních chat-panel runtime
souborů zůstalo byteově identických. Skutečný Electron běh v odděleném
user/network namespace potom potvrdil na wire capability + opaque origin a
`200` pro startup HTTP cesty i skutečný `POST /api/settings`; volitelná
`/api/media/history` při vypnutém ComfyUI skončila aplikačním `404`, nikoliv
boundary `403`. Electron i backend skončily `code=0, signal=null`.

Focused evidence: `tests/upgrade-ux-v125.test.js` **78/78**,
`tests/ws-bridge.test.js` **64/64** a repository hygiene **1 414** trackovaných
cest, vše exit `0`. Běh byl zatím diagnostický: používá necommitnutý CDP reducer,
ještě neprovádí negativní trojúhelník ani 65sekundový soak a stále zachytil
Google Fonts pokus. Proto transportní implementace sama #21 neuzavírá; závazný
fresh-clone journey a odstranění egressu jsou následující checkpointy.

### Odstranění vzdálených fontů (2026-08-07)

Dva aktivní `<link>` loadery v autoritativním chat-panel runtime, vzdálený
`@import` v ručním theme preview a stejný loader v inertním historickém v7
payloadu byly odstraněny. Existující `font-family` stacky zůstaly beze změny a
použijí lokální nebo systémové fallbacky; nové font assets se nebundlují a
dnešní typografie se nepovažuje za finální UI kontrakt. Repository hygiene nyní
odmítne obě Google Fonts domény v každém trackovaném `.js`, `.css` a `.html`
Studio assetu včetně archivního payloadu.

První disposable build scan byl správně odmítnut, protože sdílený
`c3-ide/node_modules` nesl workspace symlink do staršího klonu a zabalil jeho
chat-panel. Po vlastní frozen Yarn instalaci v prospective exportu, čistém
application buildu (exit `0`, pět existujících warnings) a kontrole výsledného
frontend bundle nezůstala žádná Google Fonts doména. Následný fresh-profile
Electron/CDP běh v blokovaném network namespace zachytil `external: []`, lokální
startup/POST transport zůstal funkční a Electron i backend skončily
`code=0, signal=null`. Jde stále o diagnostický prospective-index běh; trvalý
registered runner s negativním trojúhelníkem a soakem je další checkpoint.

### Registrovaný fresh-clone boundary runner (2026-08-08)

Na remote fresh clone přesného `7236d221` proběhly `npm ci`, frozen Yarn install
a production Theia build, vše exit `0`. Současné UI nebylo testováno vizuálně:
runner nepoužívá DOM, screenshoty ani privátní `_c3`; přes CDP sleduje síť a
přes veřejné `C3WS.send`/`C3Bus` provede transportní journey.

První běh skončil `FAIL electron-exited-before-cdp` po časném `SIGTRAP`. Druhý
skončil `FAIL functional-websocket-probe-failed`, protože runner očekával
`LOCAL` v legacy eventu `cre_decision`, který ve skutečnosti nese mode detection
`conversation`. Po opravě testovacího kontraktu následovaly dva po sobě jdoucí
`PASS`, oba exit `0`. V obou bylo 648 CDP událostí, nula external a
other-loopback pokusů, přesně jeden C3 WS a jeden Theia WS, správný boundary
trojúhelník, jeden korelovaný deterministický turn bez provider requestu či
efektu, 65s live-ready soak a čisté exity obou procesů.

Úplná chronologie a čtyři sanitizované JSON artefakty jsou v
[`2026-08-08-STUDIO-ELECTRON-BOUNDARY.md`](../review/2026-08-08-STUDIO-ELECTRON-BOUNDARY.md).
Raw profil, testovací DB, capability a logy nejsou commitnuté. Registrovaná T5
sada zůstává `BLOCKED`, dokud nightly/audit orchestrátor neumí dodat frozen
install a production-build envelope. Capability #21 tím není `PASS`: M1 stále
musí ověřit multi-panel korelaci, scoped cancel, reconnect a provider failure.

### Versioned settings recovery consumer (2026-08-09)

Autoritativní commitnutý
`c3-ide/extensions/c3-chat-panel/lib/browser/chat-panel-module.js` už pro
portable settings recovery nepoužívá generic whole-document endpoint. Export
volá `GET /api/settings/backup`, import `POST /api/settings/import` a reset
`POST /api/settings/reset`. Každá cesta vyžaduje pravdivý HTTP success a exact
JSON commit. Doručený non-2xx je definitivní `REJECTED`; rejected fetch,
timeout, malformed JSON a neúplný 2xx výsledek jsou `DELIVERY_UNKNOWN` a kromě
zachování `_bCfg` uzamknou další whole-document zápis do nového načtení Studia.

Klient před downloadem sám validuje schema v1 a odmítne envelope obsahující
`webhookSecret` nebo `c3.notif.smtpPass`. Object URL po clicku revokuje. Import
a reset jsou single-flight a recovery čeká na případný generic save. Jen
definitivní reject obnoví deferred save; nejasné doručení jej nikdy nereplayuje.
Společná generation/token hranice navíc odmítne opožděný settings GET zahájený
před recovery. Lokální stav se po úspěchu přebírá výhradně ze
serverem vráceného `generalSettings`; tím následující generic debounced save
zachová i destination secrets, které portable soubor nenese. Tokenovaný status
timer nemůže odstranit novější failure zprávu.

VM behavior sada má 110/0 a používá přímo runtime slice ze sledovaného `lib`;
nově vykonává i skutečné Backup tlačítko a FileReader load/error/abort wiring.
První Review A nad `21ffa72b` skončilo `CHANGES_REQUIRED`; opravný subject čeká
na nové review a fresh clone.
Electron ani finální UI nebyly spuštěné; tento checkpoint neuzavírá built B4,
vizuální baseline ani capability #21 jako celek.

#### Security repair schema v2 — 2026-08-10

Schema v1 už není exportní formát: kontrola dvou secret názvů byla false
boundary. Autoritativní chat panel nyní přijímá ke stažení jen exact schema v2
default-deny profil a před lokální adopcí import/reset výsledku vyžaduje i
exact policy, audit event, source-derived portable path/value list, source
version a ignored-count metadata. V2 artifact nese jen skutečně uložený
portable subset; nevyrábí defaulty, které by na cíli přepsaly existující
preference. VM sada má 123/0; tři dříve detached async
testy jsou nyní skutečně awaitované a konstantu profilu sada porovnává přímo s
backendovou autoritou.

Stejná sada nově vykonává i dvě dříve nekryté živé UI cesty. Center Views
exportuje/importuje pouze přes canonical endpoints, už nestahuje
`/api/system/info` config a nereplayuje JSON přes WS `syncSettings`; falešný
„Export All“ nevytváří efekt. `/architect` už neserializuje credential-bearing
`settingsState`, nemutuje stav před serverovým commitem a po nejasném doručení
blokuje generic save. Autoritativní server read nepřebíjí stale localStorage.
Committed dokument se přebírá bez prototype mutation, reset znovu materializuje
UI defaulty a generation fence odmítne GET zahájený před recovery. V1/raw mění
jen skutečně přítomný portable subset a všechny tři plochy přiznají počet
ignorovaných nonportable source cest.
Úplné data recovery a factory delete zůstávají oddělené nepodporované
kontrakty, ne přejmenované settings operace.

Tento source candidate ještě nemá Review A, fresh clone ani Electron běh a
neuzavírá obecný secret-bearing settings read/write surface z Findingu 011.
