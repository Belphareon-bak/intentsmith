# Autorizovaná aktivace provideru a kompatibilita policy — 2026-09-09

Stav: **SCOPED_REVIEW_PASSED / DETERMINISTIC_BASELINE_FAIL /
ADMIN_AUTHENTICATION_BLOCKED / NOT_RELEASE_READY**.
Produktový kandidát: `a71e5b98a319416c5b74e0be65b0a5f6f74586eb`.
Tree: `8fdad186ff062decfcd752e773f8f4368ff6a97a`.
Autorita: [WP](../../../wp/WP-CORE-COMPLETION-20260909.md) a explicitní
operátorovo „ano potvrzuji“ k [připravenému nasazení](core-provider-activation-proposal-20260909.md).
Tento zápis a následný dokumentační commit nejsou novým měřeným source SHA.

## Skutečný provozní výsledek

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

## Připravený bezpečný provozní krok

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
`latest-manual-activation.json`. Spouští se bez vnějšího sudo:

```bash
python3 /home/belphareon/worktrees/is-mobile-completion-20260908/.intentsmith-artifacts/core-completion-20260909/provider-proposal/activate-reviewed-provider.py
```

Gateway qualification harness je připraven a jeho chování prošlo samostatným
review, ale je **NOT_RUN**. Před spuštěním se musí připnout finální čistý
source HEAD. Vyžaduje skutečný systémový provider 0.32.14.1, soukromou zálohu
DB před importy a explicitní izolované HOME/DB/runtime cesty. Provádí pouze
dvě omezené syntetické chat operace: typed exact verification a skutečnou
gateway. Pasivně uchová obsah request/response JSON, očekává response digest přímo od
provideru, nový private `model_usage` řádek a dva řádně uvolněné durable
shared claims. Nemění živé bindings ani DB a nevyrábí chybějící digest.
Rozsah je `CONTROLLED_DURABLE_GATEWAY_QUALIFICATION_NOT_SERVER_STARTUP`;
private DB claims plus sériové okno nejsou důkazem live-DB koordinace.
Plný současný server startup by vyvolal šest implicitních binding ověření
a migrace; nebyl spuštěn jako neomezená první sonda.

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
D1/R1 FAIL. `P/role-oracle-check.json`. Celý modelový program **NOT_RUN**.

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

Po skutečné admin autentizaci následuje kontrola systémového procesu a
response identity, potom private durable gateway kvalifikace a sériové M6
modelové/runtime testy. Stávající M6 orchestrátor vyžaduje před modelovou
fází úplný PASS; před release freeze se jeho sealed policy nesmí svévolně
ratchetovat. Existující pořadí zůstává deterministic → owned server → 44
modelových → 9 serverových → 4 fresh-clone journeys → fyzická GPU → soak.
24h soak, M5 custody/rotace/history a operátorské demo/podpisy zůstávají
otevřené. M7 zařízení/síť/keys/distribuce je samostatná větev.
Alternativní izolovaný sidecar by neověřil systémový origin a nenahrazuje
zvolený postup. Žádná M5/M6/M7 acceptance nebyla udělena.
