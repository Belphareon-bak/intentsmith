# GPU hunt — oprava workflow a rozhodovacích hranic

**REVIEW_PENDING / FULL_HUNT_NOT_READY / NOT_DEPLOYED.** Tento balík předává
opravu konkrétních vad produkčního přenosu patchů, diagnostiky a rozhodovací
autority. Nedokládá dokončení celého GPU huntu ani všech sedmi rolí.
Autorita: operátorovo zadání dokončit mezery z
[auditu](2026-09-19-GPU-HUNT-READINESS.md) a výsledek předat k revizi.

Vstupní commit `eb67eb314ab87c3ee6670855978c77bfb7468077`, implementace
`bdbcd201` → `fed43bf7` → `6610faf6` → **`20a2f7647d40f85ce44aeef33dc19587887a5e01`**,
větev `work/hunt-model-controls-20260917`. Pozdější změny tohoto packetu
nejsou změnou měřeného runtime. Archivní C3 zůstává na
`379c2e4b6dea0fd0cd0fb19df67c3454c267fd49`.

## Co se změnilo

1. Parser zachová více fenced patchů, více změn v jedné funkci, numerické
   unified hunks i doslovné trojité apostrofy uvnitř zdrojového komentáře.
   Poslední vada byla prokázána skutečnou odpovědí Qwenu na `structured-code`:
   původně `patch_format_invalid`, po opravě stejná odpověď projde nezávislou
   kontrolou výsledných souborů. Identickou opakovanou nabídku aplikuje jednou.
2. Validace i aplikace používají společný resolver původního úseku. Numerický
   patch vyžaduje přesnou pozici, obsah a počty; sémantický jednoznačný úsek.
   Nejednoznačný nebo zastaralý návrh se neaplikuje. Historie oscilací obsahuje
   jen aplikované změny; odmítnutý návrh nebrání opravenému opakování.
3. Smyčka rozpozná Node `ERR_ASSERTION`, TAP, členské TypeError, `.mjs/.cjs`
   stacky a pojmenované chyby skutečného repository harnessu. Jejich chybějící
   lokaci nevymýšlí. Další iterace vždy dostane aktuální chyby; dřívější
   zkrácený prompt je mohl celé vynechat. Neznámé selhání není prázdný úspěch.
   Jediný pokus opravy formátu zůstává uvnitř předem daného rozpočtu.
4. Spustitelnost průzkumného měření (`measurementReady`) je oddělená od
   přijetí rozhodovacího profilu (`decisionReady`). Současné prototypy mohou
   měřit, ale nemohou založit vítězství pro doporučení, actionable starý záznam
   ani retenční důkaz. Ruční přiřazení operátorem je samostatná cesta.
5. `tryCandidate` už nemaže po jedné prohře ani po CPU spill. Jedinou
   automatickou cestou je posouzení všech použitelných rolí přes retenční
   autoritu; ta nyní nepřijaté sady odmítne. Uložená historie se nepřepisuje.
6. Controller a GUI zobrazí ochranný hold a odmítnou start/resume, který by
   systemd stejně přeskočil. Hold s nečitelným obsahem nebo širšími oprávněními
   neshodí panel na 503: zachová se blokace a vysvětlí se chybějící podrobnosti.
   Ruční měření zůstává dostupné při splnění běžných kontrol.
7. Běžný wrapper, build a oba instalátory shodně vybírají opravený provider
   `0.34.0-intentsmith.2`, SHA-256
   `3c22a0cfb46a9ea38fd4dba6746a022be04f5ada21a529e83c9380a5f0547b9d`.
   Systémový provider a evaluační sidecar se stále liší vlastnictvím,
   životností a rolí při zápisu do modelového storu; číslo portu samo
   nepotvrzuje verzi ani vlastnictví.

Poslední malá změna `20a2f764` doplňuje §4: vyčerpané iterace a detekovaná
oscilace jsou `OPERATIONAL_FAILURE/0`. Porucha prostředí stále nemá skóre;
nezávisle ověřený dosažený stav má přednost před textem důvodu smyčky.
Původní reporty se nepřeznačovaly; jejich tehdejší kategorie zůstávají níže.

## Měření a kontroly

| Evidence | Přesný výsledek a meze |
| --- | --- |
| Orákula finální smyčky, `acceptance-final/oracle-acceptance.json` | **60/60 PASS**, čistý `20a2f764`: 24 přímých kontrol stavu + 36 přes opravnou smyčku. Obsahují správnou referenci, jinou správnou opravu, opakovaný správný blok, prázdný výstup, vyčerpání rozpočtu a poruchy provideru. Osm případů, šest konzervativně deklarovaných skupin; nezávislost není prokázaná. |
| Nová inference na `bdbcd201`, `development-clean/result.json` | **16/16 pokusů**, Qwen3.8 **2/8** dokončených oprav, Devstral **0/8**. Qwen: 6 INCORRECT; Devstral: 7 INCORRECT + 1 OPERATIONAL_FAILURE kvůli limitu odpovědi. Žádný ENVIRONMENT_INVALID v této dokončené sérii. |
| Paměťová kvalifikace téhož běhu | Oba přesné artefakty celé na GPU při 16 384 kontext / 4 096 výstup. Špičky Qwen 21 288 189 952 B, Devstral 21 253 586 944 B, obě pod 22 GB. Response-bound digest a provider `.2`; 323 / 420 paměťových vzorků. |
| Doba téhož běhu | Qwen vlastní pokusy 332 395 ms, Devstral 496 661 ms; celá série s přípravou a kvalifikací přibližně 18 minut. Není to úplný test role ani uměle prodloužený dvacetiminutový benchmark. |
| Replay 16 odpovědí na finálním parseru | **3** ověřené opravy proti původním 2; `structured-code` navíc. **3** pokusy potřebují odpověď, která v archivu není (`INCOMPLETE_ARCHIVE`). Bez nové inference, prompty by se změnily: nejde o nové skóre modelu. |
| Cílené regrese po opravách | Patch engine **79/79**, execution loop **71/71**, normalizátor **52/52**, desktop hunt **34/34**. Nové testy spouštějí skutečný Node proces a ověřují výsledný obsah souboru. |
| Široká regrese `fed43bf7` | **359 PASS / 1 FAIL / 0 BLOCKED / 0 TIMEOUT**. Jediný FAIL je zděděná pečeť `nightly-orchestrator-self-test`; Gate 0 platí až pro release (`CONTRACT.md §8`). Pečeť ani test se nepřeklasifikovaly. |
| Široká regrese provozních oprav `6610faf6` | **359 PASS / 1 FAIL / 0 BLOCKED / 0 TIMEOUT**, stejně jen nezměněná Gate 0 pečeť. Záznam `hunt-workflow-6610faf6-20260919`. |
| Poslední klasifikační doplnění `20a2f764` | Párová/rozhodovací sada **49/49** a znovu celá přejímka orákul **60/60**. Celý 360programový profil byl měřen na předchozím `6610faf6`; za běh finálního HEAD se nevydává. |
| Registry | 525 spustitelných programů, validní. |
| Frontend | Produkční build + consumer verification PASS, bundle SHA `e1810967516b1e7e5e73ea0ca82c2c37836dd5f036e66184cb3c59414bec9dfd`. Frontend mezi buildem a finálním commitem beze změny. |
| Skutečný Electron/CDP, `gui-final/receipt.json` | **PASS**: všech sedm záložek, historický detail, průzkumné označení, blokovaný start/resume a zotavení po restartu vlastního backendu na jiném portu. Screenshot po reconnectu také vizuálně zkontrolován. |

Vývojový plán první série:
`ef6b086d78c8a57f7def183ffe4495fe120b1ab4f6e2d1cdd4053dbe54489dca`.
Všechny osm případů už bylo zveřejněno v původním pilotu: **notAHoldout=true**,
`DEVELOPMENT_ONLY`, žádný import do produkčního skóre a žádné doporučení
výměny. Historický provozní výsledek 0/24 pro každý model zůstává nedotčený.
Samotných 2/8 nelze vydávat za důkaz, že Qwen je lepší model.

**Důležitá mez GUI důkazu:** finální frontend běžel s `NODE_ENV=production`,
`--no-sandbox`, softwarovým vykreslováním a privátním profilem. Diagnostický
bridge používá skutečný nový read model/controller nad produkční SQLite
otevřenou pouze pro čtení a skutečný systemd; jiné GETy předává instalované
aplikaci. Mutace odmítá. Neověřuje novou instalaci, stažení modelu, inferenci
přes GUI, změnu role ani smazání artefaktu.

## Zachované neúspěchy a souběh

- První přejímka odhalila dvě správné reference odmítnuté starým přenosem;
  původní FAIL je v `modern-oracles`, opravené kontroly jsou oddělené.
- První start wrapperu postrádal explicitní `--run` a skončil před inferencí.
- První širší audit odmítl neignorovaný symlink závislostí; sériový opakovaný
  běh je samostatný záznam. Reprodukce používá již instalované závislosti,
  ne novou instalaci z registry.
- GUI první pokus měl chybu diagnostického bridge (raw DB místo wrapperu),
  druhý našel skutečnou chybu nebezpečně čitelného hold. Oba FAIL jsou v archivu.
- Regrese pojmenovaných chyb nejprve ukázala předčasné `not_converging`, potom
  prázdný následný prompt; zachované logy vedly ke konkrétním opravám.
- Nové měření finálního `6610faf6` nejprve zastavila cizí GPU práce
  (`GPU_FOREIGN_WORK_PRESENT`), další pokus živý zámek PID 3028048,
  `operator three-project real model journey`. Ani jeden není skóre modelu.
  Žádný cizí proces jsme neukončili. Navazující čekání skončilo po **901 s** jako `BLOCKED_FOREIGN_GPU_WORK`; nezůstává žádný čekající ani inferující proces tohoto běhu. Finální nová inference nebyla provedena.
- Během práce se jinou cestou měnila instalace i binding operation IDs.
  V 13:09 CEST byla instalace `532b6c34`, systémový provider stále `.1`.
  Tento běh instalaci nepřepsal a žádnou roli ani artefakt neměnil.

## Co skutečně zbývá před funkčním pravidelným huntem

| Pořadí | Neuzavřená část | Konkrétní přejímka |
| --- | --- | --- |
| 1 | CODE workflow | Po uvolnění cizího GPU zámku dokončit čerstvou vývojovou inferenci finální verze; opravy přenosu přijmout nezávislou revizí. Tato přejímka netvrdí, že modely již spolehlivě zvládají celé opravy. |
| 2 | Výběr CODE | Nové oddělené historické případy, předem uzamčené skupiny, přesnost a rozpočet; párová provozní přejímka. Dosavadní osmice je vývojová. Napojit přijatý výsledek do jediné produkční DB/autority/GUI. |
| 3 | Rychlý / úplný profil | **Stále není dodáno.** Úplný provozní profil musí být nejprve přijat; z něj se odvodí rychlá sada s pokrytím schopností. Odlišné identity, počty pokusů, ETA; rychlý odhad bez účinků na vazby a mazání. |
| 4 | D2 / R2 | Přípravné karty převést na samostatné spustitelné orákulum, přijmout pozitivní a negativní sondy a provozní páry. Nález mimo referenci je neověřený, ne automaticky chybný. |
| 5 | D1 / R1 | Přijmout hodnotitele otevřených odpovědí na oddělených vzorcích, s chybnými přijetími/odmítnutími podle typu a záměnou pořadí. Dnešní sdílená reasoning sada není tímto profilem. |
| 6 | CHAT / VISION | CHAT: významové hodnocení včetně negací/parafrází a provozní přejímka. VISION: již 12 obrázků + negativní kontrola, ale doplnit reálné materiály a doložit platnost i rozlišitelnost. Samotný počet není přejímka. |
| 7 | Společná instalace a provider | Integrovat opravy s mezitím změněnou produktovou větví a nasadit shodný přijatý provider do systému i sidecaru. Root instalátor je připravený; `sudo -n` vyžaduje heslo. Neměnit výsledky mezi různými verzemi provideru na „aktuální“. |
| 8 | Discovery, disk, fronta a cleanup | Malá ruční vlna přes přijaté profily, původní backlog a následný incremental průchod. Ověřit retry/cancel/restart, diskovou rezervu, přerušení/resume downloadu a držení/prohru ve všech rolích před smazáním. Nová inference se nesmí zaměnit za nově objevený model. |
| 9 | Celý uživatelský průchod | Na společné instalaci discovery → stažení s bytes/s a ETA → měření → detail → výslovný binding → rollback. Dnešní read-only GUI průchod tento řetězec nenahrazuje. |
| 10 | Správce a automatika | 6/6 fungujících čteček neznamená 6/6 změřených kvalit; doplnit skutečné provozní události/audity. Až po přejímce obnovit timer a případné konzervativní mazání. Timer zůstává disabled/inactive a ochranný hold trvá. |

Samostatná ověřená kontrola aktualizace 19. 9. ve 13:02 CEST našla
[Ollamu 0.34.2](https://github.com/ollama/ollama/releases/tag/v0.34.2).
Upstream uvádí změnu llama.cpp, opravu růstu paměti u MLX a úvodní setup.
To není důkaz kompatibility digest patche ani místního GPU profilu; výsledek
je `UPDATE_AVAILABLE / UNVERIFIED / automaticInstall=false`. Denní autocheck
je enabled/active. Upgrade 0.34.2 nebyl v tomto balíku sestaven ani nasazen.

## Jak reprodukovat bez GPU

Z archivu obnovit `source.bundle` a `c3-reference.bundle` do dvou checkoutů,
přepnout přesné výše uvedené revize a instalovat uzamčené závislosti.
Node měření byl `v22.21.1`; orákula potřebují také git, Python 3,
bubblewrap/prlimit a podporu lokálního sandboxu. Podrobný toolchain a skutečné
povolené schopnosti širších testů jsou v jejich reportech.

```sh
node tests/patch-engine.test.js
node tests/error-normalizer.test.js
node tests/execution-loop.test.js
node tests/desktop-hunt.test.js
node scripts/manual/c3-code-pilot.mjs --prepare --workflow=intentsmith \
  --c3=/absolute/c3-reference --out=/new/absolute/oracle-evidence
```

`--prepare` nic neoznačí za přijaté pro produkční rozhodování. Nová inference
vyžaduje explicitní `--seal --development` a `--run --development`, čisté
zdroje, přesnou vazbu/digests, provider a volnou GPU. Existující výsledek se
nesmí přepsat.

Evidence je v
`/home/belphareon/Projects/coworker/intentsmith-hunt-completion-20260919`.
[Strojový souhrn](evidence/2026-09-19-hunt-workflow-validation.json),
[receipt archivu](evidence/2026-09-19-hunt-workflow-bundle.json) a
[archiv důkazů](/home/belphareon/Projects/coworker/intentsmith-hunt-completion-20260919/evidence.tar.gz):
**236 297 572 B**, SHA-256
`a41f981cbec21f26d8154f706970650cc6faf9252490b9b13b01f5c3e956cd40`,
všech **2 661** archivovaných souborů ověřeno proti manifestu. Obsahuje
zdrojové bundles s úplnou historií obou repozitářů, surové odpovědi, plány,
pozitivní i neúspěšné reporty/logy, skutečné koncové zdrojové soubory a GUI
receipts/screenshoty. Neobsahuje produkční DB, privátní Electron profily ani
jejich přístupové údaje.

Úplné pracovní exporty orákul a pokusů jsou bezeztrátově uložené v
`export-snapshots.json` a `export-content/<sha256>`: 1 402 unikátních obsahů
místo 5 755 923 682 B kopií. Manifest zachovává i cesty, režimy a symbolické
odkazy; odkazy na závislosti se při archivaci nenásledovaly. Teprve po
kontrole archivu a shody všech dosavadních pracovních souborů se odstranilo
11 těchto generovaných adresářů. [Receipt úklidu](evidence/2026-09-19-hunt-workflow-scratch-cleanup.json).
Zdrojové checkouty, původní reporty a produkční modely zůstaly zachované.
Poslední kontrola dokumentových artefaktů 160/160 a repository hygiene PASS.
