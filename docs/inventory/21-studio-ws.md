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
- šest běžných HTTP requestů (`/api/health`, `/api/projects`,
  `/api/conversations`, `/api/expertises`, `/api/media/history`, `/health`)
  vracelo **403**. DevTools potvrdily, že na wire chybí
  `X-IntentSmith-Local-Capability`, a backend je odmítl jako
  `CROSS_SITE_WITHOUT_ORIGIN`;
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
Seznam šesti URL, chybějící capability na wire, Fonts pokus a kontrolní
`403/200` jsou proto **current-host observation**, nikoliv plně reprodukovatelná
release evidence. Přesné instalační a build příkazy jsou v tabulce výše;
runtime podmínky jsou popsané, ale automatizovaný runner dosud neexistuje.

### Disposition k rozhodnutí

Nejmenší evoluční varianta je zachovat dnešní funkční commitnuté JS jako
autoritativní runtime, odstranit nepravdivý package build kontrakt a teprve v
ohraničeném WP případně přesunout stejný kód do jasného source adresáře.
Přepsat celé UI do stale TS by byla široká náhrada bez doloženého přínosu.
Operátor musí tuto disposition přijmout před prvním zapisujícím Studio WP.

Nezávisle na této volbě musí Studio repair zavřít browser capability delivery,
Google Fonts egress a přidat skutečný Electron boundary test. Do té doby je
#21 `RUNTIME_VERIFIED + BROKEN`, nikoliv `PASS`.
