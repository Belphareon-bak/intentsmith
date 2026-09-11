# GPU hunt — předání pro review, 2026-09-11

**Stav: IMPLEMENTATION_CANDIDATE / RUNTIME_EVIDENCE / REVIEW_PENDING.**
Autorita: explicitní zadání operátora obnovit scoring, rozšířit počáteční
panel, zapnout pravidelný hunt, ověřit/aktualizovat Ollamu a commitnout/pushnout.
Tento packet není acceptance M6 ani povolení automaticky měnit role.

## Rozsah pro review

Produktová větev `work/mobile-completion-20260908`, implementační rozsah
`e8557165b9a30876696fc80536aa45d8e4e438f1..67b633477ab95d0f57c0c6331bb0eee1cd619ac3`.
Předchozí [remediation](../execution/runs/gpu-hunt-remediation-20260911.md)
a [autocheck/pilot](../execution/runs/gpu-hunt-ollama-autocheck-20260911.md)
zůstávají historickou evidencí svých přesných commitů. Níže uvedený provozní
checkpoint je nahrazuje pouze v otázkách nynějšího runtime, DB a timerů.

1. Zachovaný response digest; nový patch váže navíc `provider_version` do
   všech lokálních stream/non-stream chat odpovědí. Quality runner, capability
   floor a VRAM měření odmítají nesoulad. Chyba inference nedostane COMPLETE.
2. Reprodukovatelný build, uživatelský runtime installer a samostatný systémový
   installer. Ephemeral sidecar na loopback `11435`, systémový pull na `11434`
   přes durable artifact authority. Unload používá prázdné messages.
3. Verze provideru je součást reuse identity i DB evidence; cross-provider
   decision odmítá trigger. Staré řádky se nepřepisují ani nedoplňují odhadem.
4. Migrace 111 přidává bootstrap/incremental katalog a journal pokusů;
   následná 112 uzavírá ověřený `INSERT OR REPLACE` bypass. Opakované discovery
   je idempotentní; 111 již byla aplikovaná a její obsah se zpětně neměnil.
5. Denní kontrola stabilních vydání používá schválenou outbound cestu.
   Neinstaluje neověřený upstream provider automaticky.
6. CLI i API filtrují aktuální coverage podle provider verze. Host snapshot
   ukládá tento filtr pod SHA-256; offline replay jej použije bez kontaktu
   s dnešní Ollamou. Staré v1 snapshoty zůstávají přehratelné beze změny.

## Provider a upgrade

Systémová služba i klient nyní používají **0.34.0-intentsmith.1**. Základ je
[upstream v0.34.0](https://github.com/ollama/ollama/releases/tag/v0.34.0),
nejnovější stabilní vydání zjištěné 2026-09-11, publikované 2026-09-05.
Přínos oproti 0.32.14 zahrnuje opravy parser hangů a metadata cache v
[0.32.15](https://github.com/ollama/ollama/releases/tag/v0.32.15), cancelled
prefill/cache restore v [0.33.0](https://github.com/ollama/ollama/releases/tag/v0.33.0)
a GGUF default parametrů/cached prompt tokenů v
[0.33.3](https://github.com/ollama/ollama/releases/tag/v0.33.3).
Část změn se týká macOS/MLX a desktopu. Zrychlení RTX 3090 proti staré verzi
se tímto packetem netvrdí; nebyl proveden kontrolovaný cross-version benchmark.

| Identita | Hodnota |
|---|---|
| Upstream commit | `d8ab4b4f0ca24b51d3a46b3bf4f462e58ce66b1f` |
| Patched source | `e8c2d86c3a056b58031c77ec5141a8ecd7cf923a` |
| Go / GCC | `go1.26.7 linux/amd64` / `13.3.0` |
| Patched binary SHA-256 | `8883245b864485a74ecccf62c4ce17d4538816cde4e37ea2107c2204d1d04ca7` |
| Official native archive SHA-256 | `cf95886728959aa09910bb34de5cca1cc5a8f68003b5597197d3f2c2d57c0804` |

Dva nezávislé buildy s prázdnou cgo cache daly stejnou binárku. Runtime
kvalifikace na Phi4:14b a Qwen3.5:27b ověřila non-stream, všechny stream frames
i typed runner; oba modely byly plně na GPU. Go route testy prošly s izolovaným
modelem store. První pokus bez izolace selhal na oprávnění a je v logu zachovaný.

Systémový runtime je `/opt/intentsmith/ollama/0.34.0-intentsmith.1`, původní
konfigurace je `previous-service.conf` v tomto adresáři. Drop-in
`/etc/systemd/system/ollama.service.d/50-intentsmith-response-digest.conf`
mění ExecStart a vynucuje loopback. Původní CLI je uložen jako
`previous-ollama-client` v níže uvedeném evidence rootu; SHA
`d0758d38ac5882a2c68fd930d0c1220af1952469fa9f30c268746d4021709bf4`.
Původní provider a native knihovny zůstaly na disku. Rollback vyžaduje
prázdnou GPU a obnovení konfigurace/CLI, nikoli změnu modelových bindingů.

Patch byl odeslán upstream jako
[issue #18394 s aplikovatelným patchem](https://github.com/ollama/ollama/issues/18394).
Není to upstream PR ani přijatá změna.

## Fronta a pravidla modelů

Provozní DB je explicitně `/home/belphareon/Projects/intentsmith/data/c3.db`.
Před migrací vznikla SQLite backup, SHA
`12600c62be0556a362a65d8ba65b2ac0ed03fd4359bf39173d31f271f10cc6f3`.
Staré skóre, rozhodnutí a bindingy se zachovaly. Bootstrap snapshot z
`2026-09-11T20:26:28.369Z` obsahuje 180 kandidátů: 10 instalovaných a 170
vzdálených, ze 240 rodin.

- První snapshot je BOOTSTRAP. Později nalezený digest/revize je INCREMENTAL,
  i když se jméno tagu nezměnilo. Datum vydání samo nezakládá identitu modelu.
- Nové revize dostávají přednost; poté se postupně zpracovává nezměřený starý
  backlog. `--incremental-only` může starý backlog explicitně odložit.
- Priority slouží k výběru downloadu: role, externí discovery signály,
  aktuálnost, kompatibilní formát/kvantizace a velikost. Předvýběr není skóre.
  Výchozí sweep volí jednu vhodnou variantu rodiny a nestahuje všechny její tagy.
- Disk drží 40 GiB rezervu; skutečnou GPU residency ověřuje měření, nikoli
  velikost GGUF. Při checkpointu bylo přibližně 103 GiB volných před rezervou.
  Velký backlog proto nelze bez další kapacity zpracovat celý najednou.
- Stejný dokončený artefakt/role/kontrakt/provider se z historie použije znovu.
  Nová Ollama nebo sada vyžaduje nové relevantní měření. Provider verze a čas
  jsou uloženy v DB; starší řádky zůstávají `UNRECORDED`.
- Dočasná chyba má 24hodinový odstup. CPU spill je platný jen pro stejný
  hardware/provider/context. `INSUFFICIENT_EVIDENCE` je dokončená evidence,
  nikoli důvod opakovat stejný test každou noc.
- Již instalovaný tag s jiným katalogovým digestem se pouze ohlásí jako
  `catalogUpdatesRequiringManualImport`; automatický pull jej nepřepíše.
  Neznámá katalogová revize se automaticky nestahuje.
- Hunt nemění bindingy a výchozí mazání je vypnuté. Vítěz musí projít
  samostatnou binding application autoritou.

Podrobné příkazy a instalační cesta jsou v [MODEL-UPGRADE-HUNT](../MODEL-UPGRADE-HUNT.md)
a [Decision 044](../decisions/044-reproducible-evaluation-provider.md).

## Runtime a kontroly

Uživatelský wrapper nejprve kontroluje binárku i native soupis. AppArmor na
tomto hostu zakázal bwrap user namespace pod systemd; terminálová zkouška tuto
chybu neodhalila. Finální wrapper používá obyčejný uživatelský proces a vlastní
procesní skupinu, vypnutý cloud a loopback. Modelový store vlastní `ollama`;
nejde o filesystem sandbox. Globální AppArmor policy se neměnila.

Skutečná service na `252d4728` prošla startem. SIGTERM hlavnímu wrapperu při
17 432 MiB GPU alokaci ukončil i provider a native runner; GPU compute seznam
i port 11435 byly prázdné. Přerušená služba skončila exit 1, nikoli falešným
úspěchem. Současný běh při obsazeném sidecar portu skončil `SCHEDULED_SKIPPED`
s nulovým novým modelovým requestem. Cgroup má explicitní KillMode a 15s stop
timeout. Zkušební override jednoho CODE kandidáta byl po zkoušce odstraněn.

První nové COMPLETE v provozní DB:

- `eval_b8f0dbd2-98c1-40ed-93f5-59302e5f1c64`, Devstral Small 2, CODE,
  skóre `0.37777777777777777`, 7 úloh × 3 opakování.
- Digest `24277f07f62db8f9cb68e9dfc679ea1818a7fbac47a50eff0a701d3f645b63c8`.
- `2026-09-11T20:36:10.847Z` až `20:42:02.015Z`, provider
  `0.34.0-intentsmith.1`, `proof=RESPONSE_BOUND`.
- Předchozí panel byl po uložení tohoto řádku přerušen kvůli opravě unloadu.
  Samotný řádek není dokončený duel ani doporučení změnit CODE binding.

Navazující skutečná service na `252d4728` dokončila duel v `20:59:48Z`,
ukončila všechny své GPU procesy a skončila `Result=success / exit 0`.
Incumbent Qwen3.5:27b má nové COMPLETE
`eval_439734b8-6cd9-4241-8979-ad80dcae3422`, skóre `0.3968253968253968`,
stejnou sadu a provider. Kandidátovo COMPLETE se použilo z historie.
Rozhodnutí `decision_478b3191-c843-4680-981f-ff73a48cb811` je **INCONCLUSIVE**,
`INSUFFICIENT_EVIDENCE`: jedna ze dvou požadovaných stabilně rozlišujících úloh.
Tři úlohy byly nestabilní napříč opakováními. Ani CODE proto nelze obecně
považovat za vyřešenou rozlišitelnost všech dvojic. Historické skóre jiného
provideru se s novým výsledkem nemíchá a důvod rozdílu se zde neodhaduje.

Migrace 112 byla následně ověřena na provozní kopii i aplikována typed migration
runnerem do provozní DB. Všech 180 katalogových řádků a evaluation historie
zůstaly stejné, opakované observe prošlo a REPLACE byl odmítnut. `quick_check=ok`.
Backup před 112 má SHA
`d468e04fbbd72c58dc98d9b717230dcc674d64f7d12d47ebda458ffc94601198`.

Oba timery jsou enabled/active. Hunt běží denně ve 03:00 s odkladem do 15 minut,
nejvýše dva kandidáti; při checkpointu byl příští termín **2026-09-12 03:14:44 CEST**.
Autocheck má denní timer; poslední report v `20:41:57Z` hlásil UP_TO_DATE
(`installed=0.34.0-intentsmith.1`, `latest=0.34.0`). Jeho
`compatibility=UNVERIFIED` je záměrné: metadata check nesmí předstírat GPU
kvalifikaci. Kvalifikaci dokládá samostatný `provider-qualification.json`.

Čistý klon `/home/belphareon/is-hunt11`, commit `7dab3f3c`: úplný profil
`offline,database` **352 PASS / 0 FAIL / 0 TIMEOUT / 0 BLOCKED / 0 SKIPPED**,
report `hunt-provider-final/report.json`, SHA
`1f9c49d1cbe2374dce849501c4ade45713acd8d7a0e463ecfb9e47fb8a2eb5d4`.
Všechny logy a source identity se ověřují podle tohoto reportu.
Focused testy migrace 112: upgrade 68, schema 55, failover schema 20,
M6 evidence 8 PASS. Read-model/replay 17, artifact validation 158 a
consolidation 16 PASS na `67b63347`. Fresh schema má 176 tabulek / 99 migrací.

Live CLI před opravou filtru ukazovalo 56 COMPLETE včetně starého provideru;
po opravě správně ukazuje **2 COMPLETE / 60 applicable MISSING / 8 N/A**.
Všechna historická data zůstala v DB. Nový host snapshot na provozní kopii
i skutečný offline replay CLI tento výsledek reprodukovaly, včetně SHA a
nezměněné DB. Filtr `0.34.0-intentsmith.1` je součást nového v2 snapshot hash;
změna filtru bez změny hash je odmítnuta. Starý v1 replay nemá dnešní provider
filtr a nevydává se za coverage současného runtime.

Předchozí chyby zůstávají dohledatelné: první provider-specific gate měl dvě
chyby zastaralého schema censusu (opravené); další gate měl jeden FAIL kontrastu
mobilního UI (3,73:1), zatímco následující úplný gate prošel. Pozdější běh pod
GPU zátěží na `252d4728` zaznamenal TIMEOUT M2 effect brokeru. Příčina těchto
časově citlivých výsledků nebyla prokázána a cizí mobile/M2 implementace se
v tomto scope neměnila. Gate na `7c693d32` měl 351 PASS / 1 FAIL v artifact
validation: chyběl explicitní řádek rezervace 112 v machine-read tabulce.
Řádek byl doplněn v `67b63347`; test nebyl oslaben.

**Finální gate na čistém `67b63347`: 352 PASS / 0 FAIL / 0 TIMEOUT / 0 BLOCKED /
0 SKIPPED.** Profil `offline,database`, run `hunt-production-reviewed-input`,
report SHA-256
`1aea183b879d32f3008e435a85caab0dc4b08ee40b2f8c3afb2baf0bc56dc2cc`.
Všech 352 log hashů, source identit a unikátních ID bylo znovu ověřeno.
M2 timeout ani mobile contrast se v tomto běhu neopakovaly; předchozí výsledky
jsou zachované v [strojové evidenci](../execution/runs/gpu-hunt-production-20260911.json).

Po tomto gate byla spuštěna úvodní dávka pod
`intentsmith-model-hunt-bootstrap-20260911.service`: limit 13 kandidátů,
nejvýše 12 hodin, stejný GPU lock a storage gate jako noční hunt. Plán obsahoval
10 instalovaných modelů, poté North Mini Code 1.0 (19 GB), Gemma4 31B (20 GB)
a Muse Glimmer 30B (20 GB). To je plán bounded dávky, nikoli 13 dokončených
výsledků. Dávka může skončit dříve na místu na disku nebo časovém limitu.
Výsledky se průběžně ukládají do provozní DB; již uložená COMPLETE se používají
z historie. Pokud dávka poběží ještě ve 03:14, pravidelný tick ji bezpečně
vynechá kvůli obsazenému sidecaru. Stav a invocation ID jsou ve strojové evidenci.

## Co má reviewer rozhodnout

Prověřit vazbu skutečné odpovědi na artefakt/verzi, upgrade/reuse a DB guards,
durable pull/recovery, idempotenci fronty a zachování cizí GPU práce při
startu, pullu i stopu. Posoudit supported provider cestu a rozdíl mezi metadata
autocheckem a skutečnou runtime kvalifikací. M6 acceptance není tímto během
automaticky změněná; nezávislý rereview stále chybí.

Počáteční široký panel ještě není dokončený. Rozlišitelnost D1/D2/R1/R2 nebyla
v této implementační dávce navýšena; další práce musí vycházet z auditovaných
repo případů, např. AUDIT-v123/RISK-REGISTER, a změřit změnu rozlišitelnosti.
Historické doporučení VISION se musí na nové Ollamě znovu potvrdit před
binding application. Žádná změna aktivních rolí v této dávce neproběhla.

Navazující upřesnění operátora požaduje automatické odstraňování průkazně
nepřínosných kandidátů až po osvědčení huntu. Kritéria a rozdíl proti dnešnímu
širokému přepínači mazání zachycuje [Decision 044](../decisions/044-reproducible-evaluation-provider.md#upřesnění-operátora--uchování-kandidátů).
Jde o navazující implementační práci; tento packet neprokazuje její dokončení
a současná dávka automatické mazání nepoužívá.

Evidence root (lokální, obsahuje také provozní backup; není publikován):
`/home/belphareon/Projects/coworker/intentsmith-hunt-production-20260911`.
Klíčové soubory: `provider-qualification.json`, `build.log`, `rebuild.log`,
`system-install.log`, `user-runtime-install.log`, `bootstrap-catalog.json`,
`sidecar-cancellation.json`, `hunt-ledger-replace-probe.json`,
`migration112-census.json`, focused a full-profile logy.
`evidence-manifest.json` váže soubory na SHA-256 a ověření všech logů/zdrojových
identit v úplných reportech. `live-service-duel.json` obsahuje přesné DB řádky,
stav služby a prázdnou GPU/port po dokončení.
