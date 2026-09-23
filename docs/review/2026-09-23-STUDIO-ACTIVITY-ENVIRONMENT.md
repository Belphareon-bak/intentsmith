# Studio: průběh práce a prostředí projektu

Stav: IMPLEMENTED / REVIEW_PENDING. Autorita: přímé zadání operátora 23. 9.
2026 (transparentní práce v IDE, kopírování odpovědi; znalost prostředí a
explicitní automatické/potvrzované instalace). Vstupní nasazený zdroj:
`400c9d8ffdf336055d4dc6f9fb8a10565c0adccd`. První UI commit `43a293f8`.
Nejde o přijetí release, změnu modelových profilů ani důkaz kvality inference.

## Co je vidět ve Studiu

- Průběh patří přesnému tahu. Nástroje, modelová volání, dotaz na uživatele,
  schválení, zrušení, timeout a chyba mají rozlišitelné stavy. Chybějící konec
  kroku není úspěch; kanonický M1 terminál má přednost před progress událostmi.
- Návrh a provedená změna jsou odlišeny. Každý soubor má +/− řádky a odkaz na
  read-only diff. Celkové počty pocházejí ze skutečných před/po obsahů; velké
  nevyčíslitelné změny nevymýšlejí statistiky. Úspěch musí potvrdit terminál M2.
- Za běhu M2 Studio čte trvalé auditní události. Polling nemá zápisovou autoritu,
  kontroluje identitu plánu a jeho digest, nemůže schválit změnu ani obnovit
  zrušenou operaci. Terminál, podrobné logy a chat zůstávají oddělené.
- Malé tlačítko kopíruje přesnou odpověď a přizná selhání schránky. Markdown má
  nadpisy, tabulky a kód, bez vykonatelného HTML nebo automatického načítání
  externích obrázků. Citovaný web ani modelový text nejsou autorita.
- Žádné předstírané univerzální Undo; tento produkt pro ně nemá bezpečný kontrakt.

## Prostředí a závislosti

**Nastavení → Systém → Prostředí a závislosti**, také tlačítko **Závislosti**
v projektovém chatu. OS/distribuce, architektura, Node a dostupné programy se
zjišťují z prostředí skutečného backendu. Pozorování přítomnosti programu není
ověření verze, funkčnosti ani důkaz sestavitelnosti projektu. Host OS a cílový
systém projektu jsou odlišné skutečnosti. Chat i projektová analýza dostávají
stručná pozorování; historie má rezervovaný prostor i v malém kontextu.

Dvě samostatné volby: **závislosti projektu** a **SDK pro projekt**. Každá má
`ask` / `automatic` / `disabled`, obě začínají `ask`. Automatika neznamená
hledání libovolných balíčků na internetu: provádí konkrétní připravený plán
pro registrovaný projekt. V této verzi se příprava vyvolává tlačítkem; model
sám balíčky nevybírá ani instalaci nespouští. Obecná autonomní oprava chybějících
závislostí v libovolném jazyce není tímto dokončená.

| Podpora nyní | Přesný rozsah |
|---|---|
| npm | Linux, `package.json` + `package-lock.json` v2/v3, veřejný npm registry, SHA-512, nejvýše 300 balíčků. `npm ci --offline --ignore-scripts`. Pouze první instalace do chybějícího `node_modules`; žádný přepis. |
| .NET SDK | Linux x64/arm64, přesná verze, oficiální release metadata a archiv ze `builds.dotnet.microsoft.com`, ověřený SHA-512. Projektová složka `.intentsmith-dotnet-VERSION`; žádná změna PATH/shell profilu. Automatika jen pokud přesná verze souhlasí s `global.json`. |
| Systémové balíčky, sudo, další správci | Ruční postup. Není obecná shellová ani privilegovaná instalační schopnost. |

Native npm moduly a Electron mohou potřebovat instalační skripty; zde se
nespouštějí. Windows GUI, systémové knihovny, workspaces, privátní registry,
Git/file závislosti, vytvoření lockfile a aktualizace existující instalace
nejsou touto cestou podporované. Chyba zůstává viditelná. SDK instalace sama
nemění stávající Node-only generátor/focused-test profil projektu.

## Hranice pro review

Nové API `/api/development/*` používá skutečnou WeakSet identitu místního
transportu; textový actor ID ani M7/API token nestačí. Konkrétní plán,
manifesty, cílová cesta, digest a verze policy jsou uložené před efektem.
Příprava nic nestahuje. Potvrzení váže přesný digest a doslovné boolean true;
automatická volba je oddělená autorita, nelze ji nastavit přes obecné nastavení.
Migrace 117 pouze přidává tři tabulky, žádnou automatiku nezapíná.

Policy je CAS/revision a audit append-only. Změna policy zastaví aktuální
operaci. Před sítí, procesem i publikací se znovu kontroluje oprávnění. Změna
manifestu, expirovaný plán, obsazený cíl a chybějící sandbox blokují provedení.
Jediná instalace může být running; restart ji označí interrupted bez retry.
Singleton služby zabrání tomu, aby druhá kompozice přerušila živou instalaci.

Stahování: jen dvě přesné domény/HTTPS, žádné query credentials, userinfo,
redirecty, cookies, ambientní hlavičky, komprese ani soukromé IP. Všechny DNS
odpovědi musí být veřejné; socket používá přesnou zkontrolovanou IP.
Sdílená klasifikace IP přes `ipaddr.js` zůstává bezpečnostní hranicí a její
aktualizace vyžaduje nové review. Limit 700 MB celkem, 120 s/request,
10 minut/operace. Žádný `curl | sh` ani dotnet-install skript.

Balíčky se zpracovávají v bubblewrap bez sítě, host HOME či přístupu ke zdrojům
projektu. Zapisovat lze jen do vlastní staging složky; žádný fallback bez
sandboxu. Archiv se před rozbalením kontroluje v dítěti s paměťovým/CPU limitem:
cesty, typy, počet souborů a deklarovaná velikost, bez symlinků/sparse souborů.
Max. 2 GB rozbalených dat, prostorová rezerva 8 GB. Proces má timeout a limit
výstupu; výsledek stromu se kontroluje znovu. `renameat2(RENAME_NOREPLACE)`
zabrání přepsání i cíle vytvořeného mezi preflight a publikací. Při selhání po
publikaci zůstává interrupted, nikoli falešný úspěch. Záznam obsahuje cílovou
cestu a fázi pro ruční obnovu. Souběžná škodlivá změna projektových rodičů
stejným host uživatelem není samostatným OS threat modelem této implementace.

## Provedené důkazy

Vše v `.intentsmith-artifacts/studio-activity-20260923/` tohoto checkoutu.
Ovládání proběhlo ve skutečném Electronu s vlastní DB a projekty, bez GPU/modelu.

- M1 chat, skutečná OS schránka, M2 návrh tří souborů → diff → schválení →
  zápis → cílený test → potvrzený souhrn **+6 / −2**:
  `gui-check-second.log`, `gui-results.json`, `work-completed-wide.png`.
- Řízené pomalé/otázkové/fault události, Markdown/XSS, nulový request pro
  tracking obrázek, chyba schránky, cancellation/timeout/error:
  `ui-states-second.log`, `ui-states.json`. Jde o řízená data, nikoli model.
- Skutečný drát M1 přenáší pending web approval do activity:
  `question-wire.json`. Otázková metadata jsou navíc ověřena v `ws-bridge`.
- Skutečné Studio → backend → připravit → potvrdit → offline npm →
  existující `node_modules`; následné uložení `disabled` ověřeno GET policy:
  `development-gui-first.log` PASS, `development-complete.json`.
- Instalace skutečného SDK **10.0.100**: **240 170 069 B staženo**, **636 825 805 B /
  5 688 položek** publikováno v testovacím projektu, skutečné `dotnet --info`
  exit 0. `sdk-live-plan.json`, `sdk-live-result.json`, `sdk-live.log`.
  Testovací SDK bylo po ověření odstraněno; důkazy a vlastní DB zůstaly.
- Dvě nové testovací sady: instalace **11/11** (reálný offline npm + sandbox),
  transport **6/6**. Změněná wire sada **91/91**. Chat-context **33/33**.
- Studio **140/140**, M2 surface **43/43**, log UX **45/45** z první UI delty;
  integrované opakování těchto sad prošlo. Produkční Studio build PASS.

Neúspěšné první testy jsou zachované: chybná dvojí npm config cesta, chybějící
SDK manifest, nový host prompt vytlačující historii; opraveno v produkčním kódu.
První nedokončený celý profil byl přerušen a není PASS. Na `398d1448` celý
offline/database profil dokončil **366 PASS / 1 FAIL / 0 BLOCKED** ze 367
programů (`test-runs/2026-09-23T21-20-18-742Z/report.json`). Jediný FAIL:
`nightly-orchestrator-self-test`, registry fingerprint nesouhlasí s přijatou
operátorskou Gate 0 pečetí. Pečeť se neměnila, celkový verdict zůstává FAIL.

## Rozsah dalšího review

Oddělit UI/M1 zobrazení od nové instalační autority. Zaměřit se na lokální
transport, policy revoke/race, síť a DNS, lockfile/SDK integritu, izolaci procesů,
atomickou publikaci, restart a přiznané omezení parserů/instalací. Zelené testy
neznamenají nezávislé přijetí této nové schopnosti.

### První úplný integrovaný profil

Na `0c424e6a`: 360 PASS / 6 FAIL / 1 BLOCKED ze 367 programů. Zachováno
v `test-runs/2026-09-23T21-13-54-213Z/report.json`. Pět opravitelných
FAIL: nové testy chyběly v standardní izolaci, dva inventáře migrací, aktuální
M6 počet migrací a generovaný inventář desktopových rout. Opravy zachovávají
přesné seznamy i assertions; upgrade/fresh/idempotence sada 61/61 PASS.
Šestý FAIL je očekávaná operátorská Gate 0 pečeť. BLOCKED procesu vyžadoval
explicitní toolchain: bubblewrap (samostatný alias od bwrap).

### Incident při nasazení — nesplněná kontinuita Huntu

`398d1448` byl nasazen 23. 9. v 21:30 UTC. Před restartem byly prověřeny
oddělené procesy a provider kolektoru, shodný kód Huntu i konfigurace. To
**nestačilo**: přehlédnutá startup cesta `rehydrateBindings` →
`startBackgroundVerification` → `verifyExact` posílá skutečný jednoto­kenový
`POST /api/chat` na 11434. Zámek evaluace dosud nerespektovala. Systémová
Ollama začala načítat model v 21:30:22.512Z; CHAT panel uzavřel okno v
21:30:22.914Z s `GPU_FOREIGN_WORK_PRESENT`, service skončila exit 1.
Jde o dopad tohoto nasazení, nikoli o úspěšně zachovaný běh.

Uložený panel zůstal PARTIAL: 712 finished / 710 captured conversations,
2060 calls, 488 unattempted. Automatický restart se neprovedl; ve vedlejším
workeru už existoval záměr po aktuálním modelu zastavit a `autoResume:false`.
Do jeho rozpočtu, procesů, provideru ani příkazů nebylo přímo zasaženo;
to neanuluje uvedený nepřímý dopad. Evidence: `deploy-run.log`,
`hunt-interruption-journal.log`, `ollama-startup-probes.log`.

Náprava: background ověření musí získat stávající cross-process GPU lease.
Při obsazení nevydá provider request, nezapíše neúspěšné ověření a naplánuje
odložený pokus. Při něm znovu ověří, že binding nebyl nahrazen. Lease drží
do konce probe a auditního zápisu a uvolní ji i při chybě. Rozšířená původní
sada má **111/111 PASS** včetně skutečného cizího procesu držícího zámek,
pokračování po uvolnění a odmítnutí zastaralého odloženého bindingu.
První pokus odhalil chybné pořadí testovací izolace; zachován, opraven.
