# Autorizovaná aktivace provideru a kompatibilita policy — 2026-09-09

Stav: **SCOPED_REVIEW_PASSED / DETERMINISTIC_BASELINE_FAIL /
ACTIVATION_HEALTH_REVIEW_PASSED / CONTROLLED_GATEWAY_REVIEW_PASSED /
FULL_M6_REQUIRED / NOT_RELEASE_READY**.
Produktový kandidát: `a71e5b98a319416c5b74e0be65b0a5f6f74586eb`.
Tree: `8fdad186ff062decfcd752e773f8f4368ff6a97a`.
Autorita: [WP](../../../wp/WP-CORE-COMPLETION-20260909.md) a explicitní
operátorovo „ano potvrzuji“ k [připravenému nasazení](core-provider-activation-proposal-20260909.md).
Tento zápis a následný dokumentační commit nejsou novým měřeným source SHA.

## Historický provozní výsledek před terminálovou autentizací

Operátor povolil připnuté nasazení Ollamy, restart a sériové modelové okno.
Všech 54 binary/unit/native-library identit z `manifest.json` znovu souhlasilo.
Původní služba běžela pod uživatelem `ollama` pouze na `127.0.0.1:11434`,
inventář měl 9 modelů, `/api/ps` bylo prázdné a nebyl NVIDIA compute proces.
Žádný model, binding, scoring historie nebo timer nebyl změněn.

Autorizovaný pokus přes `pkexec` proběhl 11:11:17.926–11:11:28.057 UTC.
Skončil exit **127**, stderr **`Error executing command as another user:
Not authorized`**. Root bootstrap se nespustil. Kontrola v 11:39:17 UTC
potvrdila původní verzi **0.32.14**, aktivní službu, prázdné `/api/ps` a
neexistující candidate binary i drop-in v systémových cílech.
Nejde o automatické approval review ani potřebu nového souhlasu; chybí
skutečná autentizace správce na hostu. Žádná inference se v tomto běhu nekonala.

Artifact root `P` v tomto dokumentu znamená
`.intentsmith-artifacts/core-completion-20260909/provider-proposal/` v owned
checkoutu `/home/belphareon/worktrees/is-mobile-completion-20260908`.
Raw důkazy: `P/authorized-preflight.json`, `activation-check.json`,
`activation-invocation.json`, `activation.stdout.log`, `activation.stderr.log`,
`post-authentication-failure.json`, `current-runtime-before-closeout.json`.

## Původní připravený provozní krok v1

`P/activate-provider.py` SHA-256
`ea691c9b701d602d880ad4f3e938a0400c9f5e7157a4919cf546d5d4d604fbd1`
prošel nezávislým review. `--check` je read-only; `--activate` vyžaduje root.
Před efektem znovu připíná 54 souborů, aktuální službu a neobsazenou GPU.
Vytváří unikátní root-only zálohu, používá atomické no-clobber vytvoření,
ověří finální systemd unit, restart a přesnou binární/runtime identitu.
Kompenzace odstraňuje jen vlastní inode se shodnými bajty a obnoví původní
službu včetně bounded health kontroly. První review našlo dvě rollback
vady: selhání po vytvoření drop-inu a timeout daemon-reload. Obě byly opraveny
a reviewer zopakoval čistou fault injection i testy souborových helperů.
Tato evidence nenahrazuje skutečný systémový restart ani rollback.

Interaktivní launcher `P/activate-reviewed-provider.py`, SHA-256
`87d7dec6422023a11214ef0991a9c0b0a102660f66ce84839d53204dae597076`,
rovněž prošel review. Vyžaduje TTY a UID 1000, zavolá absolutní systémové
`sudo`; root bootstrap před vykonáním znovu hashuje přesné reviewed bytes.
Heslo jde pouze do skutečného terminálu. Launcher ukládá raw výstupy a
`latest-manual-activation.json`. Původní launcher je zachovaný jako evidence;
pro další pokus se používá opravený v2 launcher níže, bez vnějšího sudo:

```bash
python3 /home/belphareon/worktrees/is-mobile-completion-20260908/.intentsmith-artifacts/core-completion-20260909/provider-proposal/activate-reviewed-provider-v2.py
```

Gateway qualification harness je připraven a jeho chování prošlo samostatným
review, ale je **NOT_RUN**. Před spuštěním se musí připnout finální čistý
source HEAD. V2 vyžaduje skutečný systémový provider `0.32.14-intentsmith.1`, soukromou zálohu
DB před importy a explicitní izolované HOME/DB/runtime cesty. Provádí pouze
dvě omezené syntetické chat operace: typed exact verification a skutečnou
gateway. Pasivně uchová obsah request/response JSON, očekává response digest přímo od
provideru, nový private `model_usage` řádek a dva řádně uvolněné durable
shared claims. Nemění živé bindings ani DB a nevyrábí chybějící digest.
Rozsah je `CONTROLLED_DURABLE_GATEWAY_QUALIFICATION_NOT_SERVER_STARTUP`;
private DB claims plus sériové okno nejsou důkazem live-DB koordinace.
Plný současný server startup by vyvolal šest implicitních binding ověření
a migrace; nebyl spuštěn jako neomezená první sonda.

## Skutečná aktivace a oprava opakování v2

Operátor spustil launcher v1 v **12:20:28–12:20:41 UTC**. Admin autentizace
prošla, service běžela z přesné candidate binárky pod PID 1405365, ale naše
aserce očekávala `0.32.14.1`. Binárka skutečně hlásí
**`0.32.14-intentsmith.1`**. V1 skončila `ACTIVATION_FAILED`, provedla
`ORIGINAL_SERVICE_RESTORED` a zachovala inventář všech 9 modelů. Původní
Ollama 0.32.14 běží pod PID 1405679; candidate drop-in chybí a exact binárka
zůstala neaktivní root:root 0755, nlink 1, inode 4347299. Backup:
`/var/backups/intentsmith-provider-20260909-7dd4queh`. Raw původní pokus:
`P/manual-activation-ccqypjeg/`; není přepsán ani označen PASS.

Příčinu potvrzuje systémový journal `P/activation-v1-system-version-log.json`
se skutečnými PID/executable/verzí v 12:20:36 a 12:20:39 UTC. Další sonda
`P/version-probe-i55i26dt/` spustila stejný binary hash v bwrap s privátní
sítí, prázdným privátním modelem a bez GPU zařízení. Provedla jen GET
`/api/version`, `/api/ps`, `/api/tags`; shodná verze, prázdné inventáře,
server exit 0. Jde o ověření verze, nikoli inference/native-runner kvalifikaci.
V1 navíc neuložila actual candidate observation před asercí; v2 ji ukládá.

Reviewed `P/activate-provider-v2.py`, SHA-256
`983a08090af1fa2608e96c9945745c2c96f6d2d10362a23d0232d73677abfda0`,
zachovává všech 54 identit a přesnou schválenou binárku. Opravuje očekávanou
verzi, ukládá pozorování před asercí a bezpečně znovu používá retained target
bez zápisu. `O_NOFOLLOW`, lstat/fstat, root vlastnictví/mode/nlink/hash a
stabilní device/inode brání převzetí změněného souboru. Nový root-only backup
a receipt odkazují na starý pokus; rollback odstraní pouze vlastní drop-in.
Read-only finální preflight prošel; nezávislé fault/identity testy **19/19 PASS**:
`P/reviewer-v2-convergence-jzn1c09i/report.json`.

Terminálový launcher v2 má SHA-256
`2e82b598dd853e2b118ec3b5752c36d0b96e3b1159debb53db26bda65e5d0c7a`.
Zachovává stejnou TTY/sudo/hash autoritu, používá samostatný
`latest-manual-activation-v2.json` a oddělené attempt adresáře. Qualification
v2 opravuje pouze očekávanou verzi; její chování má samostatné review.
Source pin se před případným spuštěním přizpůsobí čistému dokumentačnímu
následníkovi; runtime zůstává **NOT_RUN**.

Nový grafický pokus **12:31:28–12:36:08 UTC** zůstal čekat na autentizaci.
Root pozastavil pouze svůj přesně identifikovaný čekající `pkexec`, ověřil,
že stále nevykonává bootstrap, a ukončil jej. Raw exit **-9** je záměrné
ukončení čekající autentizace, nikoli další instalační FAIL nebo zamítnutí
approval review. `P/activation-v2-pkexec-om7zu_m9/` a
`P/activation-v2-pending-auth-cancellation.json` uchovávají tuto hranici.
Původní service zůstala aktivní. Další terminálová autentizace umožní
pokračovat v již schváleném rozsahu; provider attestation stále není PASS.

## Dokončená aktivace a kontrolovaná gateway kvalifikace

Operátorův v2 terminálový pokus **12:38:28–12:38:40 UTC** skončil exit **0**,
`ACTIVATED_HEALTH_VERIFIED`. Receipt v `P/manual-activation-v2-81ykxiv1/`
a pointer `P/latest-manual-activation-v2.json` vážou přesný reviewed skript.
Target byl `REUSED_EXACT_CANDIDATE_WITHOUT_WRITE`, stejný inode 4347299,
mode 0755/root:root/nlink 1 a původní SHA. Backup/receipt:
`/var/backups/intentsmith-provider-20260909-_gep90s_`.

Nezávislý reviewer znovu ověřil všech 54 identit, PID **1421510**, service
active/running, exact version **0.32.14-intentsmith.1**, jediný loopback
listener a nezměněný devítimodelový inventář. Root instalační receipt ověřil
actual `/proc/PID/exe`; běžný reviewer k tomuto symlinku nemá přístup, a proto
samostatně potvrdil executable přes journal a UID 997 přes `/proc/status`.
Výsledek `ACTIVATION_HEALTH_REVIEW_PASSED` je oddělený od inference.

První gateway launcher použil `/usr/bin/node` v18.19.1 / ABI 109, zatímco
projekt vyžaduje Node >=22 <23 a jeho SQLite modul ABI 127. Skončil
`ERR_DLOPEN_FAILED` před otevřením živé DB či jakýmkoliv chatem. Raw FAIL
zůstává v `P/gateway-qualification-J0RNHy/qualification.json` a
`P/gateway-v2-console.log`. Nebyl proveden rebuild ani změna závislostí.

Opravené prostředí používá explicitně
`/home/belphareon/.nvm/versions/node/v22.21.1/bin/node` s `env -i` a odpovídajícím
PATH; harness nastavuje soukromé HOME/XDG/DB cesty. Node hash, ABI a sériový
GPU preflight jsou v `P/gateway-v2-node22-invocation.json`. Nezávislá kontrola
in-memory SQLite načtení prošla. Harness v2 má nezměněný SHA-256
`f846066b83d266c8255c6778ac2b092e8c7382dc2fdc41f308dbb8925bb01893`.

Skutečný běh na čistém **`ceb8de939b81885a0725564b9afcd26faa16a470`**,
12:42:22–12:42:49 UTC, skončil **PASS**. Produktové soubory jsou shodné
s měřeným `a71e5b98`; `ceb8de93` je dokumentační následník.
`P/gateway-qualification-XrgjOw/qualification.json` SHA-256
`c63da441d004570e327cdccec9febfd969ac9c3671079b96f70c2f0b1ae1e8d1` obsahuje:

- přesně dva zachycené request/response JSON: typed ping a gateway OK;
- provider model digest v obou odpovědích
  `7653528ba5cba4dd8e19da24aaddc7f4d0b5ecd93571c0825dfd4137958ec06e`;
- nový private DB usage **410 / CRE_DECISION / 12:42:49 UTC** se stejným digestem;
- dva navazující private SHARED claims, owners `BINDING_VERIFICATION` a
  `LLM_GATEWAY`, PID 1425019/UID 1000, oba uvolněné jako `NORMAL`;
- nezměněné čtyři kontrolované binding tabulky živé i soukromé DB.

Nezávislý reviewer ověřil oba raw capture hashe, přesně dva soubory, obsah
provider odpovědí, actual usage/claim řádky soukromé DB, její integrity_check
`ok` a nulový FK check. Verdikt **CONTROLLED_GATEWAY_EVIDENCE_REVIEW_PASSED**.
Rozsah zůstává `CONTROLLED_DURABLE_GATEWAY_QUALIFICATION_NOT_SERVER_STARTUP`:
private DB claims a operátorské sériové okno nedokazují koordinaci přes živou
DB, všechny modelové role ani release acceptance. Chybějící response digest
již není blokátorem tohoto skutečně ověřeného systémového rozsahu.

## Navazující skutečný GPU pilot a pipeline program

Po přirozeném uvolnění qualification modelu prošel existující registrovaný
`IS-T3-TESTS-M1-MODEL-GPU-PILOT-TEST` na clean `ceb8de93`, **12:47:55–12:53:24
UTC / exit 0 / PASS**. Spuštěn samostatným `scripts/nightly-audit.js`
`--suite=IS-T3-TESTS-M1-MODEL-GPU-PILOT-TEST --allow-blocker=ollama,gpu
--concurrency=1 --timeout-minutes=15 --deadline-hours=1 --fail-fast
--run-id=core-m1-gpu-20260909-01
--out-dir=.intentsmith-artifacts/core-completion-20260909/gpu-pilot` přes Node 22.
Přesný argv a počáteční idle/GPU kontrola jsou v `P/gpu-pilot-invocation.json`
a `P/gpu-pilot-idle-preflight.json`.

- Přesně 4 `/api/chat`, jediný pinned `qwen3.5:27b`, kontext 4096, bez fallbacku
  nebo administrativních `keep_alive`/unload požadavků.
- Cold odpověď 24127 ms, warm aritmetika 540 ms, JSON klasifikace 795 ms;
  všechny semantic kontroly prošly. Jde o jednotlivé malé syntetické úlohy.
- Cancel po pozorované aktivní generaci: `MODEL_CANCELLED`, žádný success
  audit. Celý request trval 78 ms; samostatná post-abort latence se neměřila.
- 100% GPU residency (16325279742 bajtů), minimum sampled free 6214 MiB.
- Přirozená obnova za 302774 ms: loaded models 0, compute procesy 0,
  free 23139 MiB, žádné explicitní administrační akce.

Outer report pod `gpu-pilot/core-m1-gpu-20260909-01/report.json` relativně
k `.intentsmith-artifacts/core-completion-20260909/` má SHA-256
`1da5db4124420329c1285a78acbc8e4a29cce201397e932c087e636c1cbc602c`.
Inner `runtime/tests_m1-model-gpu-pilot.test.js.aa9fc5db/artifacts/m1-model-gpu-pilot.json`
má SHA-256 `213a35d75f2fd5bf7b71310e4aa1e05b28fe1eda03beb4249d7053b8919dc492`.
Nezávislé evidence review prošlo. Produkční VRAM preflight přesto zůstává
`UNKNOWN / VRAM_FOOTPRINT_UNKNOWN`; pilot není důkazem obecného FIT rozhodování,
všech rolí, throughputu ani 24h stability. Sampling maximum 59% není globální
maximum: samostatný cancel trigger pozoroval 96%.

Následný existující `IS-T3-TESTS-E2E-PIPELINE-TEST` na stejném clean source
prošel **17 kontrol / exit 0 / PASS**, 12:55:00–12:55:20 UTC, 19185 ms.
Stejný runner použil `--suite=IS-T3-TESTS-E2E-PIPELINE-TEST`, blocker `ollama`,
run `core-e2e-pipeline-20260909-01` a out-dir
`.intentsmith-artifacts/core-completion-20260909/pipeline`.
Celý argv, Node 22/addon/idle preflight a výstup jsou v
`P/pipeline-invocation.json`, `P/pipeline-console.log`.
Outer report SHA-256
`890d83a1f6f4de6e1c63af6d70c6d95cc0dc4801baab580c76f792fa8c4c6bd6`.
Nezávislý reviewer ověřil source/checkpoint/log hash a cleanup bez leaků.

Journal `P/pipeline-provider-journal.json` potvrzuje přesně dvě úspěšné
provider inference / HTTP 200. Test ale neukládá response JSON ani
`classifiedBy`, takže následný regex fallback nelze vyloučit. Jeho
workflow/role kroky simulují stavy; přes název testu nejde o skutečné celé
multi-role workflow. Soukromá DB má integrity/FK PASS, ale usage/claims/telemetry
počty 0; durable důkazem zůstává výše uvedená kontrolovaná gateway kvalifikace.
Tento výsledek uzavírá běh celého programu se dvěma opravenými role-config
asercemi, nikoli M6 release matici. Oba původní záznamy `NOT_RUN` výše se
vztahují k dřívější přípravě; nynější přesný běh je uveden zde.

## Dvě prokázané technické opravy

**Modelová politika:** uznané historické schéma 061 zůstávalo po všech
aktuálních migracích, ale typed reader/writer podporoval pouze schéma 066.
Na skutečné read-only DB i její plně migrované soukromé kopii byl výsledek
`DB_ERROR/default OFF`; čerstvá DB byla platná. Oprava rozpozná přesné
column sets a table kind obou uznaných schémat, zachová jejich vlastní pořadí
zápisů, optimistic revision, trigger/FK autoritu, append-only historii a
atomický rollback. Neznámé schéma nebo neplatný stav nadále odmítne.
Nejde o kryptografické ověření celého SQLite DDL ani novou policy aktivaci.

Historická fixture `tests/fixtures/model-policy-061.js` je byte-identická
s přijatou migrací z `905a3422fa0a01f3f1c4656f914ee26a696549a8`.
Rozšířená existující suite na původním kódu: **16 PASS / 7 FAIL**; oprava:
**23/23 PASS**, settings **14/14**, coordinator **16/16**.
Regrese ověřují skutečné pořadí migrací, event lineage, chybnou autoritu,
rollback při append failure a skutečné import/reset routes. Soukromá kopie
živé DB prošla typed OFF/OFF update a reset, revision 1→2→3, quick_check i
FK kontrolou; původní genesis zůstal zachovaný.

Pouhé čtení skutečné DB novým readerem nyní vrací **VALID, revision 1,
OFF/OFF, 14 dní**, beze změny jediného historického eventu SHA-256
`f4f4876be317fcd7aaee03b78363641c7efd861bd04f9b4814b3e02a764ef643`.
To není doklad nasazení nového serveru. Důkazy:
`P/live-policy-read-after-fix.json` a
`P/policy-repair-draft-ynf8ql4_/validation.json` včetně všech raw logů,
`live-derived-probe.json` a patch SHA-256
`907266a5f850b7cee5613a0851739e90b77bfc1870965b0b5b2a8deddce58f25`.

**Role-config test:** starý test vyžadoval společný DeepSeek pro D1/R1,
přestože přijatá konfigurace již role rozlišuje. Commit `4f17f70a` test váže
na jednotlivé accepted defaults a role overrides; nemění živé role ani
workflow aserce. Přesné izolované callbacky: původní defaults FAIL; opravené
defaults, nezávislé overrides a společný override PASS; úmyslně prohozené
D1/R1 FAIL. `P/role-oracle-check.json`. Při focused opravě byl celý modelový
program **NOT_RUN**; dokončený registrovaný běh na `ceb8de93` je popsán výše.

## Přesný čistý full běh

Standalone krátký klon měl clean `a71e5b98`, vlastní závislosti instalované
`npm ci --offline --no-audit --no-fund` a lokální připnuté toolchain autority.
Příkaz:

```bash
LC_ALL=C INTENTSMITH_PDF_PYTHON=/home/belphareon/worktrees/is-m6-operator-demo-prep-20260827/.intentsmith-artifacts/pdf-runtime/bin/python node scripts/nightly-audit.js --profile=offline,database --allow-blocker=toolchain:git,toolchain:bwrap,toolchain:bubblewrap,toolchain:prlimit,toolchain:python-pdf-runtime --run-id=provider-policy-a71e5b98 --out-dir=.intentsmith-artifacts/gates
```

Běh 11:34:31–11:38:41 UTC: **351 PASS / 1 FAIL / 0 TIMEOUT / 0 BLOCKED /
0 SKIPPED, exit 1**. Report SHA-256
`887b5af4ebbf64e15e510d551bb40984f252a06d0664c0d2ca1ed28ffeb17ebb`.
Jediný FAIL: `IS-T1-TESTS-NIGHTLY-ORCHESTRATOR-SELF-TEST`, doslovná příčina
`registry hash differs from the reviewed Gate 0 policy`.
Sealed release policy se nezměnila; vývojový FAIL není zelený release gate.

Aktuální registry: 512 runnable, 19 support exclusions, 418 ACTIVE,
79 BLOCKED, 15 HISTORICAL; 413 ACTIVE + required, 352 deterministic (279+73).
Fingerprint `3ce12a0edffe7e6da0f875ce3f0b25758524641557023d00aae39d0784fdbbfc`.
Přibyla pouze support fixture; všech 512 runnable položek zůstalo zachovaných.
Nezávislé review ověřilo všech 352 raw log hashů, exact source a čistotu
každého řádku, shodu checkpoint/report a úspěšný cleanup bez leaků.

Všech 1893 regular artifact souborů (244310499 bajtů) bylo následně
zkopírováno a byte/hash ověřeno do `P/retained-policy-clone/.intentsmith-artifacts/`.
Report je pod `gates/provider-policy-a71e5b98/report.json`; jeho původní
source/run cesty se nepřepisují. `P/policy-artifact-preservation.json`
připíná všechny soubory, režimy a původní/retained root mapping, SHA-256
`f10f0da2d87eb58eb5c8a86e131ef48dec23b1878b0e590a15fc3c3d02ee8111`.
Žádný ephemeral special file nebyl přítomen.
Po kontrole clean source, dokončeném nezávislém review, prázdné shodě process
cwd a opakovaném ověření retained hashů byl vlastní dočasný klon odstraněn.
`P/policy-clone-cleanup.json` potvrzuje přesnou cestu a zachovaný report.

Preparatory chyby zůstaly v `P/policy-registry*.json` a
`P/policy-artifact-validation*.log`: nejprve chyběla support exclusion,
následoval neplatný CLI souběh `--write-doc --json` a pak chybějící čárka ve
formátu SYSTEM-MAP. Poslední artifact chyba byla formát, nikoli nesprávný
filesystem census. Po opravě: registry VALID, artifact **158/158 PASS**,
znovu potvrzeno čistým full během. Census: src 591 JS / 218792 řádků,
tests 518 JS / 235839 řádků.

## Další závislosti

Admin autentizace, systémová aktivace/health, řízená response identity a
private durable gateway kvalifikace jsou dokončené. Dokončené jsou také
dva popsané registrované GPU/pipeline programy. Zbývá celá M6 release matice
a její závislosti; částečné měření je nenahrazuje. Stávající M6 orchestrátor vyžaduje před modelovou
fází úplný PASS; před release freeze se jeho sealed policy nesmí svévolně
ratchetovat. Existující pořadí zůstává deterministic → owned server → 44
modelových → 9 serverových → 4 fresh-clone journeys → fyzická GPU → soak.
24h soak, M5 custody/rotace/history a operátorské demo/podpisy zůstávají
otevřené. M7 zařízení/síť/keys/distribuce je samostatná větev.
Alternativní izolovaný sidecar by neověřil systémový origin a nenahrazuje
zvolený postup. Žádná M5/M6/M7 acceptance nebyla udělena.

Závěrečná provozní kontrola v **13:01:18 UTC** potvrdila stále aktivní
systémovou verzi `0.32.14-intentsmith.1`, přesný binary hash, všech 9 modelů,
prázdné `/api/ps` a žádný GPU compute proces. Také model po pipeline programu
se uvolnil přirozeně. `P/runtime-after-validation.json` zachovává raw stav.
