# Desktop, společná instalace a provoz huntu — review 2026-09-17

**LOCAL_INSTALLATION_VERIFIED / REVIEW_PENDING / GPU_CALIBRATION_BLOCKED.**
Runtime rozsah `5dedbfe8..9d13bb53`, testovací follow-up `2587ae56`; přesný běžící zdroj
`9d13bb530f955199df7a7dc01f1caf1ec93fa09d`. Závěrečný dokumentační commit
nemění tento runtime pin. Přijetí M5/M6 ani release se tím nevyhlašuje.

## Výsledek a vlastnictví

Samostatný čistý detached checkout pod `~/.local/share/intentsmith/releases/`
slouží backendu, Studiu i huntu. Provozní DB je původní
`/home/belphareon/Projects/intentsmith/data/c3.db`. Staré CODE kontrakty zůstaly
historické; žádné skóre ani binding se nepřevádí jen přejmenováním.
Pracovní mobile checkout ani cizí dirty main se nemění. Uživatelské služby
`intentsmith-backend.service`, `intentsmith-model-hunt.service` a timer čtou
společný `runtime.env`. Timer je persistentní. Ikona v nabídce spouští nebo
připojí Studio; zavření okna nechá backend běžet.

Použitý monogram je rastrová adaptace operátorova návrhu 2A, splash používá
horizontální sazbu podle B. Stejný asset se načítá lokálně v aplikaci.

## Bezpečnostní plocha pro review

- Nové GET `/api/system/models/hunt` a POST `/api/system/models/hunt/control`
  potřebují skutečný brandovaný lokální transport. M7 ani podvržený actor ID
  oprávnění nezískají. POST přijímá pouze jeden klíč `action` a čtyři pevné akce.
- Efekty jdou přes `/usr/bin/systemctl --user` a pevné argv; žádný shell ani
  libovolný unit name. Instalace/source/DB a skutečná hunt unit se porovnávají
  před ovládáním. Historická fronta je označená časem pozorování.
- Backend běží v produkčním režimu. `admin.env` vzniká s náhodnými 256 bity a
  právy 0600, při další instalaci se zachová. Používá jej jen backend. Studio
  používá privátní lokální capability; nic z toho se nezapisuje do reportu.
- Readiness vyžaduje 200 s capability a 401/403 bez ní, nikoli pouze `/health`.
- Instalátor prověřuje unit skutečným parserem systemd před změnou konfigurace;
  varování o ignorovaném EnvironmentFile je rovněž chyba. Dělá konzistentní
  SQLite backup a migraci kopie, zálohu konfigurace, teprve potom přepnutí.
  Aktivní cizí backend/hunt nepřerušuje. Stejná aktivní instalace je no-op.
- Zastavení huntu ruší i asynchronní kontrolu native checksumů. Záznam je
  CANCELLED a jednotka exit 0; skutečné selhání zůstává FAILED. Procesní skupina
  vlastního sidecaru se uklízí, systémová Ollama se tím nevypíná.
- `src/routes/system.js -> global-auth-policy.js` a `-> hunt-control.js` jsou
  dvě explicitně připnuté importní hrany; graf 1332 hran, 3 cykly/28 členů.

## Fyzický důkaz

`desktop-journey.json` pro běžící `9d13bb53`: spuštění přes skutečný desktop
entry pomocí GTK, title IntentSmith a načtený 1254px monogram; HTTP 401/200;
opakované spuštění zachovalo PID backendu 318030. Zavření oken zachovalo stejný
PID a funkční autentizovaný backend. Skutečný restart služby změnil PID na
324798; readiness znovu prošla. Opakovaný installer hlásil `unchanged:true`.
Jde o společný desktop/service/HTTP journey; žádný modelový výkon se z něj
neodvozuje.

`hunt-ui-controls.json` na předchozím `73a2e980` zachycuje skutečné kliknutí,
nativní potvrzení a změny pause/resume/start. Spuštění při obsazené Ollamě
skončilo SCHEDULED_SKIPPED. Samostatný `hunt-ui-cancel.json` na `9d13bb53`
prokazuje rychlé start/stop během ověřování provideru: CANCELLED, success/0,
žádný inference výsledek. Screenshoty a raw HTTP/UI důkazy zůstávají lokální.

Před prvním přepnutím měla DB 102 záznamů migrací a 21 hunt attempts. Přibyla
pouze conversation_web 113: po migraci 103 záznamů, quick_check=ok, 0 FK vad,
21 hunt attempts. Obsah všech 503 evaluation runs, 21 hunt attempts a 7
požadovaných bindingů je byte-for-byte shodný v kanonickém JSON porovnání
s předinstalačním backupem (hashy v přenositelném souhrnu). Rozdíl proti fresh schema (100 souborů migrací) je zděděná
historie, nikoli ztráta tabulek. Konzistentní backupy i stará konfigurace jsou
pod `~/.local/state/intentsmith/installation-backups/` a nejsou publikované.

## Celý profil a build

Na čistém `2587ae56` skončil finální profil `desktop-hunt-20260917-05`
**353 PASS / 1 FAIL / 0 TIMEOUT / 0 BLOCKED / 0 SKIPPED**. Jediným FAIL je
release seal; celkový verdict je pravdivě FAIL. Focused desktop 8/8,
process supervision 13/13, registry 517 a module-boundary kontrola prošly.
Fresh instalace závislostí proběhla na `12e04d60`; všechny dependency manifesty
a locky jsou do `9d13bb53` totožné. Produkční build na čistém `9d13bb53`
prošel za 50,5 s, bundle SHA-256 `4ae1a03a…fd7a073`.

[Přenositelný strojový souhrn](../execution/runs/desktop-hunt-20260917.json)
obsahuje všech pět běhů, hash reportů, ověřené logy, DB porovnání i hranice
kalibrace. [Návod k aplikaci](../DESKTOP.md).

## Selhání zachovaná v důkazech

1. `desktop-hunt-20260917-01` na `12e04d60`: 351 PASS / 3 FAIL. Opravený počet
   DB-reachable testů 129→130 a mobilní inventář; release seal ponechán.
2. `...-02` na `f6818b09`: 353 PASS / 1 FAIL (pouze release seal).
3. Instalace `f6818b09` odhalila chybnou syntax uvozovek WorkingDirectory a
   EnvironmentFile. Opraveno reálným parserem, včetně varování s exit 0.
4. HTTP kontrola `42b414f7` odhalila vývojovou localhost výjimku (200 bez
   tokenu). Služba byla zastavena; produkční profil a negativní readiness
   regresní kontrola ji odstranily. Potřebný soukromý admin credential se
   nyní vytváří automaticky. Návrat k dev režimu nebyl použit.
5. `...-03` na `42b414f7`: 124 PASS / 2 FAIL / 228 SKIPPED; běh byl úmyslně
   přerušen po fyzickém nálezu. Jeden FAIL je nedostupný XDG runtime parseru,
   druhý přerušený failover-schema test. Soukromý krátký `/tmp/is-units-*`
   odstranil i navazující překročení limitu délky unix socketu.
6. První UI cancel na `73a2e980` selhal během synchronního sha256sum.
   `hunt-ui-cancel-01-failed.json` zůstává, následná asynchronní oprava prošla.

7. `...-04` na `9d13bb53`: 352 PASS / 2 FAIL. Vedle release seal starší
   process-supervision test poslal cancel po pevných 300 ms před připraveností
   potomka. `2587ae56` mění pouze tento test a census: čeká na jedinečný
   process title nastavený po výpisu ready PID, pak ruší a kontroluje prázdnou
   skupinu. Focused 13/13; assertions ani produkční containment se neoslabují.

Po aktualizaci dokumentace byla ještě opravena přesná formulace census
v ROADMAP, kterou hlídá integritní test (157/1 → 158/0). Oba logy zůstávají.
Všech 1542 auditních logů pěti běhů bylo znovu ověřeno proti reportům.

Pečeť `scripts/nightly-orchestrator.js` se nepřepisuje kvůli zelenému vývoji.
`CONTRACT.md §8` tento rozdíl výslovně ponechává pro release práci. Výsledek
celého profilu se proto nesmí označit jako úplný PASS.

## Kalibrace: co data skutečně dovolují tvrdit

Panel `2026-09-12`, SHA-256
`e12cef01127caca23090023d110ba8081816ca1d5fdfda110e9f2095ecd03410`, má 38
rozhodnutí a 13 INSUFFICIENT_EVIDENCE. Diagnostika odděluje 7 případů, kde
pozorovaný rozdíl překrývá variabilita, a 6 s malým pozorovaným rozdílem.
Není to důkaz, že více opakování automaticky rozhodne všech sedm.

Detail podle úloh: `reason_order` nerozlišil žádný z 27 reasoning duelů a
v obou ramenech byl vždy perfektní. `reason_logic` nerozlišil také 0/27,
`reason_transform` 1/27. Naproti tomu `reason_repo_immutable_refinement`
rozlišil 22/27 a `reason_sets` 19/27. `reason_critical_path` rozlišil 23/27,
ale 13 srovnání obsahovalo nenulovou variabilitu. Jsou to četnosti srovnání,
ne nezávislé vzorky: stejný incumbent run může být použit opakovaně.

Následující kalibrace má nahradit nejsnazší pořadí/logiku/transformaci třemi
repo scénáři s vykonatelným oracle: vlastnictví port file při attach/shutdown,
argv hranice přepínačového názvu souboru a časování lokální transportní
kontroly před DB/egress. Ponechat čisté negativní příklady a původní margin,
noise i minimum-discriminating policy. Nejdřív změřit stejné exact artefakty
incumbentů i kandidátů, vyhodnotit schema failures a variability zvlášť,
teprve potom povýšit nový suite contract. Žádný požadavek na nulový počet
neprůkazných duelů a žádná aktivace vítěze podle agregovaného skóre.

Nové fyzické GPU měření se neuskutečnilo: nvidia-smi vrací Driver/library
version mismatch; načtený kernel modul 595.84, modul na disku 595.91.07 a
NVML 595.91. Běžící aplikace nebyly kvůli tomu restartovány ani ovladač
odpojen. Kalibrace kvality zůstává **BLOCKED**, samotná diagnostika je hotová.

## Hranice předání

Lokální app/service/hunt ovládání je ověřené. Nezávislé review nové delty,
nové modelové kalibrační běhy po opravě ovladače a starší M5/M6 podmínky jsou
stále otevřené. Persistent timer dohání zmeškaný čas při běhu uživatelského
manageru; nejde o garanci měření při vypnutém počítači nebo obsazené GPU.
