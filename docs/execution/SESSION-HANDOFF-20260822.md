# Handoff 2026-08-22

**Aktuální closeout větev:** `codex/m1-closeout-20260822`; finální fyzicky
ověřený B6 source `d518d7ec2156b108c5d71b72d16ee855781c6be5`, B5/C implementace
`4b20a5dd` a B3 GPU source `31859488`.
**Nepushnuto.** Izolovaný worktree je určený pouze pro M1 closeout; cizí změny
v hlavním a mobilním checkoutu zůstaly nedotčené.

## Co se dnes stalo, v pořadí

1. **M0 uzavřeno a M1 má všech sedm povinných scénářů** (`5cceed64`, 12:07).
   `studio-electron-boundary` vrací `STUDIO_ELECTRON_BOUNDARY_PASS`.
2. **Gate 1 fronta, položky 1–6** — 023, 022, rezervace migrací, 020, 015 a
   021 včetně produkčního ACK.

## Nález, který stojí za zapamatování

`electron-exited-before-cdp` **nebyl D-Bus ani network namespace**. Chromium si
v `TMPDIR` zakládá unix domain sockety a `sun_path` má tvrdý limit 108 bajtů;
runtime root pod `.intentsmith-artifacts` má na téhle stanici 95 znaků, takže na
jméno socketu zbylo 13 z potřebných ~30. `TMPDIR=/tmp` běží, 95 znaků padá,
16 znaků (mode 0700) běží. **Délka závisí na tom, kde repozitář leží** — proto to
jinde mohlo projít. D-Bus hláška v logu byla falešná stopa: objeví se jen uvnitř
namespace a bez něj sada padá bez ní.

## Stav Gate 1 fronty

| # | Položka | Stav | Commit |
|---|---|---|---|
| 1 | 023 VRAM delete race | hotovo | `51936ee1` |
| 2 | 022 operation-bound recovery | hotovo | `05b6c44b`, `c0a0340f` |
| 3 | rezervace migrací | hotovo | `2013e522` |
| 4 | 020 policy storage | hotovo | `b9731302` |
| 5 | 015 proof ↔ artefakty | hotovo | `6368bd2f` |
| 6 | 021 byte bridge + built journey + produkční ACK | hotovo | `2b6b151b`, `2e33e342`, `241b39ab` |
| 7 | autorizovaný GPU pilot | **hotovo / PASS** | source `31859488`, run `m1-b3-gpu-31859488-20260823` |

### Pokračování 2026-08-23 — fyzický T3 PASS

Po uvolnění sdíleného GPU okna byl kanonický registrovaný T3 spuštěn sériově
z čistého source `3185948840b96bb76567a43da69eb1505545e308`. Audit runner
skončil `1 PASS / 0 FAIL / 0 BLOCKED / 0 TIMEOUT`, exit `0`, za 181 342 ms.
Profil byl exact `qwen3.5:27b`, digest `7653528b…ec06e`, `num_ctx=4096`, 100%
GPU residency a zakázaný fallback. Cold/warm/classification byly
26 891/590/798 ms; skutečný mid-generation cancel skončil za 154 ms jako
`MODEL_CANCELLED` bez success auditu.

Po běhu se model přirozeně uvolnil za 152 758 ms, `ollama ps` i compute seznam
byly prázdné a GPU mělo 22 413 MiB free. Cleanup neprovedl pull, delete, unload
ani rebind. Report/log/artifact SHA-256 jsou po řadě
`cbb84fd1…304c1`, `9d1ee992…b58b9`, `66649693…b506b`.

Tím je Gate 1 fronta 1–7 uzavřená a explicitní závislost B5 na přijatém CHAT,
MODEL a STUDIO je splněná. Další pracovní krok je B5 `WP-M1-QUALITY`; teprve
po něm B6 integrovaná fresh-install exit demonstrace.

## Navazující M1 closeout — skutečný produkční posun

B4 už není jen testový kandidát: `241b39ab` zapnul produkční ACK
`m1-wire-v1`; built Electron journey na `417eaabb` prošel s pěti terminály,
reconnectem, nulovým externím egresssem a nulovým legacy pádem. Byte bridge je
samostatně fresh-clone doložený.

B3 se posunulo přes vlastní produkční commit pointy:

- `6037c4bc` aktivuje přijatou A-bootstrap / 7d policy;
- `d87549e4` + `3af419ed` přidávají atomický operator-only proof issuer;
- `9a61b95a` uzavírá claim/proof/policy/CAS terminální repository;
- `c8ffbccc` přidává append-only runtime finalize receipt a jednorázový
  `DEGRADED_PROOF_EXPIRED` health event;
- `6a231a42` zapojuje skutečný `ACTIVATE/REAPPLY/RESTORE` runtime do startupu a
  pětiminutového cyklu přes stejný mutation owner jako manual binding;
- `7ea36580` jmenovitě přijímá šest nových modulových hran bez růstu cyklů;
- `56ff8053` nahrazuje křehký ruční export zdrojů proof parentu tranzitivní
  uzávěrou importů z Git HEAD.
- `10b3d080` přesouvá novou runtime-finalization migraci z 068 na rezervované
  069 po zjištění živé kolize s coworkerovou necommitnutou model-evaluation 068.

Registrovaný runtime audit na `7ea36580` prošel `8/8`; proof/source-closure
audit na `56ff8053` prošel `4/4`. Samostatný fresh clone exact
`56ff805331b1863faeb441adbbe8dd771410b382` provedl offline instalaci 233
balíčků, našel 0 vulnerabilities a zeleně reprodukoval failover application
`6/6`, terminal repository `7/7`, parent acceptance `16/16`, manual binding
`108/108`, schema migrations `38/38` a module ratchet `13/13`.

První plný closeout gate na `66c2e511` pravdivě našel tři další lokální mezery:
stale README census, schema kontrakt nepřipnutý na nový runtime tip a sedm
diagnostických `direct-tests` adresářů. `c018f5f6` srovnal census a exact schema
kontrakt; diagnostické adresáře byly po přečtení logů přesunuty do koše.
Focused výsledky jsou schema `20/20`, artifact validation `151/151` a harness
metatest PASS.

Fresh clone exact `10b3d080068c81f387aa38244634a710d6281ea5` uvnitř svého
vlastního adresáře offline nainstaloval 233 balíčků (0 vulnerabilities) a prošel
application `6/6`, terminal `7/7`, schema `20/20`, migration suite `38/38`,
parent `16/16`, issuer `6/6`, binding `108/108` a ratchet `13/13`; finální
porcelain klonu byl prázdný. Jeden předchozí instalační příkaz po vytvoření
klonu zůstal omylem v aktivním worktree, proto se za fresh-clone evidenci
nepočítá; zdroj nezměnil.

## Čísla, ne dojmy

Deterministický gate na `10b3d080`:
`{"PASS":232,"FAIL":3,"BLOCKED":2}`, 237 sad. Oproti baseline přibyly tři
registrované B3 sady a všechny jsou PASS. Tři FAILy jsou stejné předchozí a
prostředím podmíněné — `nightly-audit-runner-self-test` (X11 self-test fixture),
`nightly-orchestrator-self-test` (povinné BLOCKED řádky) a
`vram-coordination` (hostitelský GPU stav). Dvě BLOCKED sady jsou beze změny
`chat-export-budget` a `export-pdf-docx` na PDF toolchain prerekvizitě.

## Co je vědomě nedodělané

- **015 už není implementační blocker.** Prahy, TTL, artifact-bound issuance,
  equality-at-expiry negativní scénář, terminal transitions, runtime finalizace
  i active-proof health jsou implementované a focused/fresh-clone zelené.
  Skutečný operator measurement/proof pro konkrétní fyzický model ale nevznikl;
  syntetické fixture proofy se za produkční důkaz nevydávají.
- **L3 čísla M1**: změřená 2026-08-22, detail v
  [`runs/m1-l3-measurement-20260822.md`](runs/m1-l3-measurement-20260822.md) —
  deterministika p50 `2,77 ms` / p95 `31,6 ms`, modelový chat cold `64,1 s`,
  warm p50 `30,1 s` / p95 `35,9 s`, throughput `1,96 turnu/min`.
  **Refinement delta zůstává nezměřená**: spouští se jen pro syntetizované
  odpovědi, takže patří do B5 s fixním corpusem.
- **B5 `WP-M1-QUALITY`** bylo k okamžiku původního handoffu nezačaté. Od
  2026-08-23 je jeho explicitní závislost splněná fyzickým T3 PASS a práce se
  otevírá.
- **Historický GPU blocker 2026-08-22:** při tehdejším preflightu
  používala RTX 3090 kromě RustDesk PID `540882` (294 MiB) i dynamická
  coworkerova Ollama zátěž: po `qwen3.5:27b` (17 GB) následoval
  `qwen3-30b-a3b:latest` (18 430 MiB, 100 % GPU), při němž volno kleslo na
  3 856 MiB. Cizí modelový běh ani vzdálená relace se nesmí ukončit.
  Registrovaný run `m1-b3-gpu-preflight-4f339e30-20260822` na clean
  `4f339e309eb0f59bfeefde08a3d394980c9e6ff5` později fail-close skončil za
  98 ms před provider efektem: rezidentní `qwen3:14b`, dva compute procesy,
  10 638 MiB free proti minimu 20 128 MiB a 99% utilization. Suite artifact má
  `measurements: null` a kód `GPU_PILOT_PREREQUISITE_BLOCKED`. Tento záznam
  byl překonán výše uvedeným clean-source T3 PASS, ne přepsán.

## 021 — byte bridge, uzavřeno

Commity `2b6b151b` (bridge) a `2e33e342` (built journey).

**Tvar řešení.** Renderer nedostal API na čtení souboru podle cesty a nedostane
ho. Preload vystavuje dvojici: `pickAttachmentFiles` otevře nativní dialog a
za každý vybraný soubor vydá neprůhledný token, `readAttachmentBytes` je jediná
cesta zpátky k bajtům. Cesta do modulu vstupuje jen z dialogu a ven nejde vůbec
— renderer žádnou cestu k souboru nevidí. Dosah rendereru je tím přesně
"soubory, u jejichž výběru jsem byl", ne "cesta, kterou umím napsat". Grant je
jednorázový a vyprší po pěti minutách.

Nebyl potřeba nový kanál do electron-main: `ShowOpenDialog` už registruje
Theia a preload ho volá přímo. Rebuild se tedy týká jen preloadu.

**Strop u čtení.** `fstat` na otevřeném deskriptoru rozhodne PŘED alokací
bufferu. Panel posílá strop podle druhu souboru, takže `.txt` jde proti 1 MiB
a `.png` proti 5 MiB; jeden paušální strop by 4 MiB `.txt` načetl celý a zahodil
až v policy, což je přesně to, čemu se krok 2 měl vyhnout. Velikost se čte znovu
z deskriptoru, takže soubor, který mezi výběrem a čtením povyrostl, strop
neobejde. Nad tím je ještě `HARD_READ_CAP_BYTES` 32 MiB jako paměťová pojistka,
schválně nad policy, aby se nikdy nestala tím skutečným limitem.

**Panel.** Z bajtů staví skutečný `File`, takže drag&drop, `<input type=file>`
i dialog konvergují na jeden tvar a `_readAttachments` se nemění. Picker je
vytažený jako `_chatPickAttachments` do řezu, který testovací harness načítá —
předtím byl zadrátovaný v `onClick` uvnitř `_chatPaneUI`, kam test nedosáhne.

**Rozhodnutí, které stojí za pozornost.** Bridge hlásí u `svg/bmp/ico/tiff/avif`
pravdivý `image/*` typ, ne `text/plain`. Vydávat je za text by je propašovalo
jako `data:text/plain;base64,...`, měřené a doručené jako text — zatímco tentýž
soubor přetažený myší policy odmítne jako nepodporovaný typ. Bridge říká, co
soubor je, a rozhodnutí nechává policy.

**Co se nově hlídá.** `verify-m1-consumer-build.js` kontroluje i preload bundle.
Ten se balí vlastním webpack configem, jehož entry přepisujeme ručně v
`webpack.config.js`; kdyby přepis přestal platit, aplikace se normálně sestaví
a nastartuje a jediným příznakem by bylo, že přílohy z dialogu zase tiše ztrácejí
bajty. Teď je to chyba buildu.

**Built journey.** `studio-electron-boundary` má sondu `attachmentByteBridge`.
Nativní dialog se z CDP zavřít nedá, takže se nedrivuje samotný výběr; ověřuje
se, že postavený preload bridge opravdu vystavuje a že token vymyšlený
rendererem nekoupí nic (`M1_BRIDGE_TOKEN_UNKNOWN`). Výsledek jde do evidence.

**Testy.** 26 nových v `tests/m1-studio-client.test.js` (122 celkem), 16 v
runner-contractu. Devět nových bylo napsáno bez `await`, takže doběhly až po
`summary()` a nemohly shodit exit kód — konvence v souboru je `await testAsync`.
Opraveno a ověřeno záměrným pádem, že failující async test teď opravdu vrací 1.

## Uzavřený kandidát na finding

Křehký `CANDIDATE_SOURCE_PATHS` byl odstraněn v `56ff8053`. Parent nyní z
runtime entrypointů odvozuje seřazenou tranzitivní uzávěru relativních importů
z přesných blobů Git HEAD, odmítá escape i netrackovaný modul a exportuje jen
skutečně dosažitelné zdroje. Mutace přidávající nový import se automaticky
propsala do closure; zastaralý `src/db/user-settings.js` z ní naopak zmizel.

## Pasti, na které jsem narazil

- **Gate ukáže to, co focused běhy neukážou.** Dnes šest sad, všechny důsledek
  přesunu autority. Nespoléhej na focused zelenou.
- **Ratchet writer vyžaduje čistý strom.** `--write-baseline` musí jít až po
  commitu zdrojů; pořadí je commit → writer → commit baseline.
- **Tři census se srovnávají ručně a vědomě**: README (počet a `ACTIVE`),
  `module-boundary-ratchet` (`--accept-edge` jmenovitě) a
  `harness-exit-code` (database-reachable inventář).
- Po background úloze se `cwd` vrátí na `Projects` — relativní cesty pak míří
  mimo repo.

**Runner kontroluje čistotu stromu po KAŽDÉ sadě, ne jen na začátku.**
Editoval jsem `tests/studio-electron-boundary.e2e.js` během běhu gate a všech
81 sad od té chvíle spadlo na `sourceEvidenceComplete`, ne na ničem skutečném:
`{"PASS":148,"FAIL":84}` místo baseline. Není to regrese, je to neplatný běh.
Poznámka "neupravovat strom během gate" v paměti tohle myslí doslova — čekat
s editacemi, ne je jen necommitovat.

**`direct-tests/` po neúspěšném běhu zůstává schválně.** `cleanupRequested`
maže runtime jen při `exitCode === 0`, aby šel neúspěch prohlédnout. Moje dva
padlé přímé běhy `m1-studio-client.test.js` tam nechaly dva adresáře a
`harness-exit-code` je v gate ohlásil. Před gate mazat `.intentsmith-artifacts/direct-tests`.

## Pokračování B5 — 2026-08-23

Source `759bcad0` odstranil double-refine: synthesis už model-backed rewrite
nevlastní a jediný owner je response finalizer. Quality telemetry nyní
rozlišuje všechny accepted/rejected/error/cancel outcomes a nese before,
candidate, final score, tokeny i latenci. Offline baterie je zelená; nový M1
quality kontrakt má 10/10 a registry 396 programů.

Fyzické A/B ještě neproběhlo. Registrovaný preflight
`m1-b5-quality-preflight-759bcad0-20260823` na clean source skončil za 89 ms
před provider efektem: cizí model byl rezidentní, compute `1`, free 4 775 MiB
a utilization 93 %. B5 je proto implementation-ready / GPU BLOCKED a B6 se
nespouští. Podrobný stav je v `runs/wp-m1-quality-report.md`; rozhodnutí
ponechat/omezit/odstranit je připravené jako 024 a čeká na skutečná čísla.

## Pokračování B5 — fyzická čísla

Operátor správně odmítl absolutní požadavek na nulový compute seznam. Commit
`92790a39` dovolil změřený non-Ollama baseline a dál blokuje cizí Ollamu,
nedostatek VRAM a vysokou utilization; `20f61f2e` zachovává per-case data i při
acceptance failure. Registrovaný run `m1-b5-quality-ab-20f61f2e-20260823` na
clean `20f61f2e` provedl fyzické A/B s `qwen3.5:27b`: bezpečnost a restore PASS,
quality acceptance FAIL. Dva ze čtyř případů byly eligible, ale oba refinementy
se odmítly; applied delta 0, cena 1 027 tokenů a 14 291 ms. B6 je zavřené na
Gate 2 volbě; 024 doporučuje `C-REMOVE`, ale operátorskou volbu nepředstírá.

## Finální M1 closeout — 2026-08-23

Operátor přijal `024-refinement-disposition: C-REMOVE` se zpřesněným důvodem:
lexikální Jaccard guard konstrukčně odporoval rewrite promptu a krátká správná
FACTUAL odpověď aktivovala refinement kvůli false-positive scoreru. Produkční
post-answer modelový caller odstranil jediný vratný commit `4b20a5dd`; scorer,
telemetrie, synthesis `fastRetryGate`, provider/cancel hranice a persistence
zůstaly. B5 je `PASS/CLOSED`; historický A/B acceptance FAIL se nepřebarvil.

B6 následně prošlo na standalone `git clone --no-local` exact source
`d518d7ec2156b108c5d71b72d16ee855781c6be5`. Offline npm/Yarn instalace a
produkční Theia/Electron build byly zelené. Jedna evidence envelope provedla
všech sedm M1 scénářů přes skutečný server, izolovanou SQLite, exact lokální
`qwen3.5:27b` a shipped Studio; controlled backend sloužil pouze pro přesně
vyvolané error/cancel/reconnect terminály. Deterministické HTTP p95 bylo 34 ms
z 20 raw vzorků, model cold 51,2 s, warm p95 55,3 s, Studio model turn 52,3 s,
provider audit měl nula refinement promptů a síťový census nula neočekávaného
egressu. Restart obnovil exact 50/50 zpráv, oba procesy skončily čistě.

Kanonický report je
[`runs/m1-b6-fresh-install-20260823.md`](runs/m1-b6-fresh-install-20260823.md).
Gate 2 a M1 jsou `ACCEPTED/PASS`; dalším neotevřeným milníkem je M2. Finding
011 zůstává samostatná neblokující chyba scoreru. Coworkerovy GPU/Ollama běhy
nebyly ukončeny ani měněny; vlastní kolidující B6 pokusy byly přerušeny.
