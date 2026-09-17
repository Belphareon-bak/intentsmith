# IntentSmith — mapa systému

**Základ změřen 2026-08-02 na `17a8b9a8`; pre-fix OS-isolated scan proběhl na
`24457ba2`; registry klasifikace byla opravena v `06309bc8`, post-fix scan
aktuálního registru proběhl na `a85c344f` a izolovaný HTTP/restart baseline na
`ac320335`. Fresh-clone Studio probe proběhl na dokumentačním HEAD `df8f1039`
se zdrojovým stromem shodným s `ac320335`; registrovaný Electron boundary
runner byl znovu fresh-clone ověřen na `7236d221` a současný legacy runtime
byl offline buildem a 65s non-visual journey znovu potvrzen na `9464dacf`.
Finální M1 fresh-install journey prošel na `d518d7ec` přes built Electron,
skutečný server/SQLite/Ollamu i kontrolované negativní terminály.**
Neutrální dokument, nezávislý na nástroji.
Pravidla vývoje: [`CONTRACT.md`](CONTRACT.md) · Detail: [`docs/inventory/`](docs/inventory/)

**Navazující M5 inventář, 2026-09-17:** 15 známých historických objektů
(původních 13 + testovací TLS klíč a veřejný certifikát). Červencový containment
je zachovaný; zářijové odstranění je samostatný záznam. Nový podpis nesmí
použít starý scan 13/13. [Remediace a meze review](docs/review/2026-09-17-M5-TLS-HISTORY-REMEDIATION.md).
Osm starších instalací obsahuje zbytkové kopie stejného páru; jejich obsah
se nemění a nepočítá se jako nové Git objekty. Aktivní `d4dea0bb` je bez
páru. Původní soak přerušen restartem hostu 21:20 (FAIL/SIGTERM), nový
24h běh na `d4dea0bb` začal 21:26 CEST a není dosud PASS. Tato větev
nemění živou instalaci. [Inventura](docs/execution/runs/m5-tls-residual-copies-20260917.json).

**Předchozí společná instalace 2026-09-17:** `c2989a3e` spojuje opravy
soukromí/panelů, specialisty, časový kontext a Studio design `023af4dd`.
Celý offline/database profil: **358 PASS / 1 FAIL / 0 BLOCKED**; jediný
FAIL je release pečeť, bez změny její autority. Šest HTTP programů / 134
kontrol, Studio build v čistém klonu, privacy scanner aktuálního stromu,
skutečné otevření ikonou a reload PASS. Sledované DB tabulky nezměněné.
Pětiminutový health throughput PASS; 24h soak od 18:29 CEST teprve běží.
GPU/NVML a provider Sázkaře jsou BLOCKED, nezávislé přijetí a M5/M6 otevřené.
[Packet a přesné meze](docs/review/2026-09-17-PRODUCTION-CLOSEOUT.md),
[checksumy důkazů](docs/execution/runs/production-closeout-20260917.json).

**Předchozí společná instalace 2026-09-17:** `3f005fc0` spojuje specialisty,
opravný commit `3bbf8bc1` (privacy/panely) a obecný časový kontext.
Privacy + Studio focused PASS; fyzická geometrie a vstupy chatu ověřeny
přes skutečnou ikonu i reload běžného profilu. Profil společného zdroje
na `e564f22c` má **357 PASS / 1 FAIL / 1 BLOCKED**: release pečeť a oddělený
OCR runtime. OCR program samostatně ve svém prostředí PASS. Produktové
zdroje jsou shodné s instalovaným `3f005fc0`; 354/1 níže patří předchozímu
`3bbf8bc1`. Neúspěšný profil z dlouhé instalační cesty a kolísání heap testu
jsou zachované v [navazujícím packetu](docs/review/2026-09-17-PRIVACY-PANELS-REREVIEW.md).

**Oprava specialistů ve Studiu, 2026-09-17:** kandidát `be0f5d65` integruje
účetní dokumentový workflow a autonomního Sázkaře, zachovává instalovanou
opravu časového kontextu `58d7cced`. Čistý instalační snapshot: 7/7 focused
PASS a skutečné Electron PDF/HEIC journey PASS. Celý profil: 356 PASS /
2 FAIL / 1 BLOCKED (release seal, dokumentační formát LOC, oddělený OCR
toolchain). Oprava formátu a konečný stav instalace mají vlastní záznam v
[review packetu](docs/review/2026-09-17-STUDIO-SPECIALISTS.md).
Živý sázkař je PROVIDER_BLOCKED na zdroji historie; integrace REVIEW_PENDING.

**Re-review R1–R3, původní ověřený kandidát `3bbf8bc1`, 2026-09-17:** logování kompatibilního
chatu a projektová pracovní paměť mají navazující regresní opravu; panelový
commit `4fca7e67` je integrován jako `da0c9120`. 36 privacy/settings testů
a produkční Studio build PASS. Úplný profil **354 PASS / 1 FAIL**, jen známá
release pečeť. Fyzické panely: 240/416 px, dostupné také po reloadu, ověřeno
v privátním i běžném profilu. Sledované DB tabulky mají nezměněné hashe.
Nové nezávislé přijetí zůstává otevřené, původní verdikt je `CHANGES_REQUIRED`.
[Packet](docs/review/2026-09-17-PRIVACY-PANELS-REREVIEW.md).

**Předchozí lokální instalace 2026-09-17:** `58d7cced`, větev
`work/chat-date-context-20260917`. Časový kontext v každé interaktivní
modelové odpovědi je odvozený ze skutečných hodin a lokálního časového pásma.
Fyzický model přes instalovaný HTTP backend správně použil včera/dnes/zítra
ve tvůrčím zadání (16./17./18. 9. 2026). HTTP sequence bez modelu i kontrola
provider payloadu prošly. Celý profil **353 PASS / 2 FAIL** (dokumentační
fráze opravena v následném dokumentačním commitu; release seal zůstává).
[Packet](docs/review/2026-09-17-CHAT-CLOCK-REVIEW.md),
[run record](docs/execution/runs/chat-clock-20260917.json). REVIEW_REQUIRED.

**Předchozí lokální instalace a opravy revize 2026-09-17:** `1da840c0`,
větev `work/review-remediation-20260917`. Automatické učení respektuje
nastavení i projektovou hranici; Studio potvrzuje pouze skutečné native
agentí výsledky. Režim bez historie není implementovaný, API jej odmítá
a již uložené false blokuje nový chat. Úplný profil: **354 PASS / 1 FAIL**,
jen očekávaný release seal. Produkční Studio build, 10 nových regresí
v čistém instalačním snapshotu a spuštění přes ikonu jsou ověřené.
[Review packet](docs/review/2026-09-17-PRIVACY-AGENT-REMEDIATION.md),
[strojový záznam](docs/execution/runs/privacy-agent-remediation-20260917.json).
Stav **IMPLEMENTED / INSTALLED / REVIEW_REQUIRED**, nikoli přijatý release.

**Předchozí společný kandidát (publikační kontrola 2026-09-17):** runtime
`20e5a022`, publikační kontrola zdroje `26a038db`, větev
`work/hunt-review-followup-20260912`. Nový úplný deterministický profil má
353/353 PASS; [run record](docs/execution/runs/github-publication-20260917.json)
zachovává i původní 352 PASS / 1 FAIL a opravu kalendářní závislosti testu.
Produktové zdroje jsou shodné s `20e5a022`, jeho produkční Studio build
prošel 2026-09-12. Fyzický dvousouborový build/restart/restore
má [ohraničený review receipt](docs/review/2026-09-12-PRODUCTION-JOURNEY-REVIEW-RECEIPT.md);
novější [hunt/core delta](docs/review/2026-09-12-HUNT-REVIEW-FOLLOWUP.md) zůstává
REVIEW_PENDING. Údaje o modelovém panelu jsou měření z 2026-09-12, nikoli
nově spuštěné modelové testy z 2026-09-17. Starší checkpointy níže zůstávají
historickou evidencí svých přesných revizí.

> Čísla níže jsou **změřená**, ne převzatá. Kde se rozcházejí se starší
> dokumentací, platí tento dokument.

---

## Spuštění

```bash
npm install                   # 233 balíčků, ~16 s
node src/server.js            # http://127.0.0.1:3335
node --watch src/server.js    # vývoj
```

**Prerekvizity:** Node.js 22+ · SQLite (better-sqlite3) · Ollama pro LLM cesty
(bez ní běží deterministické intenty, ostatní vrací `LLM_PROVIDER_UNAVAILABLE`)

```bash
npm test                      # deterministické sady
node scripts/validate-test-registry.js
```

**Prerekvizity sad — stav k 2026-08-03.** Deklarace byla empiricky prověřena v
OS network namespace bez odchozí routy. Autoritativní post-fix run na
`a85c344f` vybral 203 programů a skončil `200 PASS / 1 FAIL / 2 BLOCKED`, exit
`1`; proto nejde o zelený celek:

| Sada | Stav |
|---|---|
| `export-pdf-docx`, `chat-export-budget` | **Vyřešeno.** Deklarováno jako `BLOCKED` s prerekvizitou `toolchain: python-pdf-runtime`. Instalace: `./scripts/install-pdf-runtime.sh` |
| `quality-gate` | **Nereprodukuje.** Bez `go` na PATH projde 22/22. |
| `multi-source-integration` | **Vyřešeno.** 12 offline testů zůstalo; 2 BBC/OpenMeteo testy jsou v samostatné `network: external` sadě. |
| `dependency-manager` | **Vyřešeno.** Unit test už nespouští skutečné `npm install`; fake executable ověřuje přesně tři pokusy bez sítě. |
| `harness-exit-code` | **Vyřešeno.** Po review import graphu je pin 95; mutační kontrola stále prokazuje odstranění isolation anchoru. |
| `nightly-orchestrator-self-test` | **M6 release baseline opravený a změřený.** Required PDF/export programy jsou pravdivě ACTIVE nad explicitním lokálním Python runtime, zapečetěný candidate plán má registry fingerprint `3593af7c…` a exact candidate `8abd6065` prošel `296/296` deterministickými programy včetně orchestration self-testů. |

Registr do 2026-08-02 **toolchain deklarovat neuměl** — `hasConcreteBlockedPrerequisite()`
uznával jen network/server/ollama/gpu, takže sada potřebující Python musela
zůstat `ACTIVE` a padat. To je přesně mezera, kvůli které `G0-C7` tuhle třídu
chyby nezachytil. Doplněno `requirements.toolchain`.

### Aktuální runtime baseline

Na přesném `ac320335` proběhl server v izolovaném runtime rootu s prázdným
`HOME/XDG/TMP`, vlastní DB, projekty a output adresářem, bez zděděných tajemství
a s vypnutým online discovery, ComfyUI a autonomií:

- health `200` za 19 ms a založení konverzace `201`;
- skutečný HTTP deterministický dotaz `17 * 23` vrátil přesný výsledek za 22 ms;
- skutečný HTTP modelový dotaz přes `qwen3.5:27b` vrátil odpověď za 24 784 ms;
- před restartem byly uloženy přesně čtyři turny; po stop/start nad stejnou DB
  byly načteny stejné čtyři role za 19 ms;
- samostatná modelová behavior sada CRE prošla **9/9**, exit `0`; studená první
  klasifikace trvala 20 966 ms, následující přibližně 1,1–1,3 s.

Lokální raw evidence zůstává mimo Git v
`.intentsmith-artifacts/runtime-baseline.qAU9qe/`; sanitizované JSON souhrny mají
SHA-256 `2700a942…d8c37` před restartem a `8d123f79…42bb68` po restartu. Toto
je **current-checkout pozorování**, nikoliv přenositelná release evidence:
neobsahuje commitnutý runner ani environment manifest. Tento starší baseline
sám neprokazoval fresh-clone instalaci ani Theia runtime; následný WP-M0-E je
změřil samostatně níže a odkryl dvě Studio produktové vady.

### Aktuální Studio baseline

WP-M0-E na `df8f1039` použil dva disposable čisté klony; produktové cesty jsou
od `ac320335` beze změny. `npm ci`, frozen Yarn install a production Theia build
prošly exit `0`. Build zabalil byte-identický commitnutý
`c3-chat-panel/lib/browser/chat-panel-module.js`, nikoliv stale TS source.
Samostatný package build `@c3/chat-panel` skončil exit `1` na šesti chybných
importech a před selháním změnil 4 trackované a vytvořil 36 untracked generated
výstupů pouze v disposable klonu. Repozitář přitom v `docs/dev-checklist.md`
výslovně označuje commitnutý JS za ručně udržovaný runtime a `tsc -b` zakazuje.

Diagnostický runtime v OS network namespace při počátečním bootu přešel do
`ready`, provedl WS handshake a přes skutečný Studio panel vrátil
deterministické `17*23 = 391` za 24 ms. Současně odkryl dvě produktové vady:

- renderer se pokusil načíst Google Fonts i pod blokovaným outboundem;
- sedm startup Studio HTTP rodin, včetně dříve vynechané `/api/agents`, vracelo
  `403`. Sanitizovaná CDP revalidace na `1fc8f03e` prokázala, že existující
  bootstrap capability na wire posílá;
  Chromium ale z `file://` posílá `Origin` nepřítomný a
  `Sec-Fetch-Site: cross-site`. Backend proto správně odmítá
  `CROSS_SITE_WITHOUT_ORIGIN` ještě před capability větví. Rozbitý je spoj mezi
  browser transportem a policy kontraktem, nikoliv instalace shimu.

DevTools Network záznam nebyl zachován jako strojově čitelný artefakt; konkrétní
URL, wire header a Fonts pokus jsou current-host observation, zatímco uložený
backend log potvrzuje opakovaná boundary odmítnutí. Při teardownu přibližně šest
minut po startu skončil Electron po ztrátě GPU procesu `SIGTRAP`, současně s
řízeným `SIGTERM` backendu. Diagnostický namespace a `--no-sandbox` neumožňují
rozlišit environment teardown od produktové vady: počáteční journey prošla,
stabilita a clean shutdown nejsou prokázané.

Detail, přesné build příkazy a lokální screenshot/logy jsou v
[`docs/inventory/21-studio-ws.md`](docs/inventory/21-studio-ws.md). M0 tím
získalo fresh-clone install/build a initial boot/chat pozorování, ale Studio
část končí `PRODUCT_FAIL + STABILITY_INCONCLUSIVE`, ne `PASS`.

Následná oprava zachovala autoritativní `lib`, odstranila Google Fonts egress a
normalizovala opaque Electron Origin pouze za přesnou local capability. Na
`7236d221` pak remote fresh clone prošel `npm ci`, frozen Yarn instalací a
production buildem. První automatizovaný běh skončil časným pre-CDP `SIGTRAP`,
druhý odkryl chybnou interpretaci legacy `cre_decision` v runneru. Po opravě
proběhly dva samostatné `PASS`, exit `0`: 648 CDP událostí, nulový external i
other-loopback provoz, přesný boundary trojúhelník, korelovaný deterministický
turn bez provider requestu či efektu, nejméně 65 s live-ready a čisté exity
Electronu i backendu. Současný vzhled nebyl hodnocen. Červené běhy i oba PASS
artefakty jsou v
[`docs/review/2026-08-08-STUDIO-ELECTRON-BOUNDARY.md`](docs/review/2026-08-08-STUDIO-ELECTRON-BOUNDARY.md).

T5 runner zůstává registry `BLOCKED`, protože standardní auditní orchestrátor
zatím nevyrábí jeho production build. To neanuluje current-host fresh-clone
výsledek, ale brání vydávat ručně splněnou prerekvizitu za nightly readiness.

---

## Rozsah

Aktuální tabulka zahrnuje opravy soukromí/agentů z 17. 9. (519 programů).
Historické výsledky níže nadále patří svým přesným source pinům.

Předchozí desktop/hunt checkpoint `9d13bb53` s testovacím follow-up `2587ae56`,
2026-09-17. Společná instalace, produkční backend, GTK desktop launcher a GUI
huntu jsou fyzicky ověřené. Finální profil: **353 PASS / 1 release-seal FAIL**.
Obsah 503 modelových evaluací, 21 hunt attempts a 7 desired bindings se proti
předinstalační záloze nezměnil. Novou kalibraci blokuje ovladač GPU; nová delta
není nezávisle přijatá. [Packet tohoto checkpointu](docs/review/2026-09-17-DESKTOP-HUNT-REVIEW.md).
Následující dřívější výsledky si zachovávají vlastní piny.

Společný kandidát včetně sidebar opravy `9d5e207a`: **353/353 PASS** a
produkční Studio build na čistém `20e5a022`. Změna kontraktu + timeout
incumbenta má DB retry regresi. Panel D1/D2/R1/R2 je dokončený (12 kandidátů,
0 roleErrors); 13/38 duelů má nedostatečný důkaz. Stav je
**REVIEW_PENDING**, nikoli release acceptance. [Evidence a hranice](docs/review/2026-09-12-HUNT-REVIEW-FOLLOWUP.md).

Studio model controls jsou instalované na `08f8d1c5`: filtr odhadované VRAM,
řazení kandidátů, test konkrétního instalovaného modelu/role a vysvětlení
chybějícího aktuálního skóre. Offline/database **358 PASS / 1 FAIL** (registry
release pečeť), řízený fyzický Electron PASS. Živé GPU měření je **BLOCKED**
na nesouladu NVIDIA 595.84 / NVML 595.91; nové inference skóre nevzniklo.
Tlačítka a filtry odpovídají motivu; chyby testu jsou přímo u modelu a role.
**REVIEW_PENDING** — [aktuální UI oprava a evidence](docs/review/2026-09-17-HUNT-MODEL-CONTROLS-FOLLOWUP.md).

| | |
|---|---:|
| `src/**/*.js` | **225 007 ř.**, 627 `.js` souborů v pracovním kandidátu |
| `tests/**/*.js` | **246 117 ř.**, 531 `.js` souborů v pracovním kandidátu |
