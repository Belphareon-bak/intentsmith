# GPU hunt — oprava falešného úspěchu a zbývající práce

> Aktuální stav celého huntu a navazující měření na finálním zdroji `89531748`
> jsou v [závěrečném review z 19. 9.](2026-09-19-GPU-HUNT-FINAL-REVIEW.md).
> Verdikt: **NO_GO_FOR_AUTONOMOUS_HUNT / NEROZHODNUTO / REVIEW_PENDING**.
> Následující historické výsledky zůstávají zachované a nejsou novým během nahrazeny.

**IMPLEMENTATION_VERIFIED / REVIEW_PENDING / NOT_DEPLOYED.** Navazuje na
operátorovo review dokončeného CODE duelu a požadavek shrnout všechny mezery
GPU huntu. Vstup `6d085f74`, větev `work/hunt-model-controls-20260917`.
Tento audit není nová specifikace ani přijetí celé platformy.

## Výsledek této opravy

`runFixLoop` hlásil `all_passed` při prázdném seznamu rozpoznaných chyb,
i když test runner vracel `allPassed: false`. Totéž se týkalo počátečního
stavu bez iterace; finally větev navíc nezávisle zapsala úspěch do paměti
oprav a metrik jen podle délky seznamu chyb.

Oprava v [execution-loop.js](../../src/executor/execution-loop.js) vyžaduje
potvrzený úspěch testů i quality gate. Chybějící, odložené nebo selhané
ověření už nevytvoří konvergenci. Výsledek `verification_failed` zachová
původní testový výstup; log ani report nehlásí opravený stav. Paměť oprav
a metriky přebírají skutečný konečný výsledek včetně důvodu ukončení.
Samotný parser diagnostik se tím ještě nenaučil neznámé chybové formáty.

Regrese spouští skutečný Node proces s `assert.deepEqual`, jehož nenulový
exit a `ERR_ASSERTION` původní normalizátor nerozpoznává. Před opravou
**63 PASS / 4 FAIL**, po opravě **67 PASS / 0 FAIL**. Pokrývá počáteční
chybu, chybějící ověření, neúspěšný compile check bez diagnostiky a chybu
po aplikování patche včetně paměti a metrik. Navazující lifecycle build
**114 PASS / 0 FAIL**, registry validátor **525 programů**.

Upřesnění proti review: aktuální IntentSmith má ještě pozdější
[canPassMilestone](../../src/planner/lifecycle-build.js), který odmítá
`testResults.allPassed === false` i při kladném checkpointu. Nelze tedy
z této vady samotné tvrdit, že aktuální milník musel skončit PASS.
Falešná konvergence, report, paměť a metriky jsou prokázané vady samy o sobě.
Archivní C3 ani původní 48 pokusů se neměnily; nová inference neproběhla.

## Živý stav při auditu

[Strojový snímek](evidence/2026-09-19-hunt-readiness.json) vznikl čtením
instalace, systemd, Ollamy a produkční DB otevřené pouze pro čtení.

- Instalace: `d22f64ac`; obsah pracovního stromu a instalovaná aplikace jsou
  odlišné. Pravidelný hunt i ruční GUI evaluace standardně používají provider
  `.1`; opravený `.2` je zatím vybraný pouze pro `--code-pilot`.
- Ollama na 11434: `0.34.0-intentsmith.1`, **13 instalovaných artefaktů**,
  žádný rezidentní model. Hunt timer disabled/inactive, ochranný hold trvá.
- Hunt bootstrap obsahuje **183 pozorovaných revizí BOOTSTRAP**; žádnou
  INCREMENTAL. Záznamy pokusů: 15 COMPLETE, 3 BLOCKED, 7 RETRYABLE. Nejde
  o 183 otestovaných modelů ani o přijaté výsledky podle nového kontraktu.
- Volných přibližně **37 GiB** na úložišti modelů. Automatické stahování
  vyžaduje 40 GiB rezervy plus kandidáta; samotné zapnutí timeru nestačí.
  Ruční měření staženého modelu má odlišnou rezervu 2 GiB.
- Automatické cleanup i failover v durable policy jsou OFF. Noční unit
  nemá `--prune-rejected`. Žádný model ani binding se v tomto auditu neměnil.
- Denní timer kontroly aktualizací Ollamy je enabled/active. **Poslední
  uložená kontrola**, 18. 9. ve 22:07 UTC, hlásí `UPDATE_AVAILABLE` pro
  `0.34.2`, kompatibilitu `UNVERIFIED` a automatickou instalaci false.
  Nejde o nové ověření aktuální upstream verze.
- Správce: **6/6 čteček READY**, nikoli šest změřených kvalit. Architektura
  nemá provedený audit; modely a specialisté mají události bez dostatečného
  jmenovatele úspěšnosti. Instalace má 2/7 rolí pokrytých aktuálním kontraktem;
  pracovní zdroj po opravě response protokolu 0/7. Rozdíl je změna identity
  měřidla, nikoli náhlé zhoršení modelů.

## Co existuje a co zbývá

| Oblast | Existující schopnost a důkaz | Práce nutná k dokončení |
| --- | --- | --- |
| Pravdivý výsledek opravy | Dnešní oprava konvergence, paměti a metrik; 67/67 regresí. | Nezávislé review a nasazení. Následně rozpoznávání neparsovaných selhání, aby je šlo také opravit, nejen pravdivě zastavit. |
| Předávání CODE patchů | Skutečný C3 patch engine má preview, kotvy, ochranu cest a rollback. Duel doložil 43 `patch_failed`. | Na vývojových případech opravit převod odpovědi do patche a více změn v jedné kotvě, rozlišit chybný návrh od odmítnutého přenosu; zachovat atomické bezpečné odmítnutí. |
| Výběr CODE modelu | Ruční pilot má předem uzamčený plán, páry, výsledkové třídy, skupiny a interval; výsledek NEROZHODNUTO. | Po opravě workflow nová oddělená sada reálných případů, rozpočet odpovídající rozhodovací přesnosti, další párové měření. Osm použitých případů je nyní vývojová evidence, ne nový holdout. |
| Produkční rozhodovací autorita | Běžný hunt stále používá `createRoleEvaluationPlans` a `trialRole`; `decisionReady` hlídá počet úloh/runtime. | Přejímku hodnotitele a profilu skutečně zapojit jako podmínku rozhodnutí, binding doporučení a retention. Ruční `decideCodePilot` není dosud zapojený do pravidelného huntu, produkční DB ani GUI. |
| Rychlý a úplný test | GUI umí vynutit nové měření celé dnešní krátké sady a odlišit opakované použití starého měření. | Po ověření plného workflow odvodit rychlý výběr úloh s pokrytím schopností. Samostatné identity, rozsah, počty úloh a ETA. Rychlý profil nesmí měnit vazbu ani mazat model. Pevné čekání 20–30 minut není test. |
| D2 a R2 | Jsou připravená odlišná zadání v `fixtures/drafts`; aktivní D2 stále sdílí reasoning s D1/R1. | Spustitelné orákulum pro diagnózu/opravu a lokální revizi, přejímací sondy a provozní páry. U R2 posoudit nález mimo referenci; absence v referenci není automatický falešný nález. |
| D1 a R1 | Přípravné karty rozlišují analýzu/plán a revizi změny napříč vrstvami. | Doplnit úplný relevantní kontext/diff a přijmout hodnotitele otevřených odpovědí včetně chybných přijetí/odmítnutí a prohazování pořadí. Pak měření samostatných rolí. |
| CHAT | Aktivní sada 40 úloh, jazykové pokrytí EN/CS. Audit již zaznamenal nesprávné přijetí rozporného shrnutí a odmítnutí správné parafráze. | Opravit a přijmout významové hodnocení; relevantní konverzační úlohy a oddělená provozní přejímka. Počet úloh sám platnost nedokládá. |
| VISION | Aktivních 12 odlišných PNG + kontrola bez obrázku, skutečné exploratorní běhy existují. | Reálné dokumenty/fotografie, obtížnost a rozlišitelnost doložená výkonem, přejímka orákul a provozní porovnání. Současná sada je syntetická; požadavek alespoň 10 obrázků již splňuje. |
| GPU a paměťový profil | Inventura karty se ukládá na 24 hodin; živé použití paměti a procesy se ověřují před měřením. CODE pilot oba modely kvalifikoval pod 22 GB. | Sjednotit kvalifikaci a inferenci pro každou produkční roli: kontext, výstup, souběh, KV/think a verze provideru. CODE-only cesta už kontext přizpůsobuje; obecný hunt není kvalifikovaný stejným způsobem jako pilot. |
| Provider a aktualizace | Reprodukovatelný digest patch, striktní response proof, oprava opakovaných tokenů v `.2`, denní metadata autocheck. | Dostávat přijatý opravený provider i do běžných GUI/hunt běhů. Každou novou upstream verzi sestavit, ověřit proof/completion, paměť a rollback; jasně zobrazit dostupnost versus kompatibilitu. Kontrola aktualizace není instalace. |
| Discovery a priority | Knihovna Ollamy, katalog a uložená discovery; datum vydání má zdroj. Chybějící místní měření má přednost před downloadem; role s nízkým/chybějícím skóre dostávají prioritu. | Dokončit úvodní backlog podle nových platných sad; kvalitu priorit odvozovat z platného měření. Ověřit další incremental průchod bez opakování identických dokončených kontraktů. Stejný tag s novým digestem vyžaduje řízený import, ne tiché přepsání. |
| Fronta a obnovování | Exact identity, 24h retry cooldown, uchované výsledky, locky, čekání na GPU a omezený počet kandidátů. | Integrovat úplný profil a jeho rozpočty; ověřit restart, cancel, retry po selhání incumbenta a běh bez opakovaného zacyklení. Uživatelsky zobrazit ochranný hold: dnešní controller podmínku systemd nerozlišuje a může potvrdit start, který podmínka přeskočí. |
| Stahování a disk | Trvalé operation receipts, vrstvy/bajty/rychlost/ETA, HTTP obnova bez WS; doložený GUI průchod z 18. 9. | Na finální společné instalaci zopakovat přerušení, obnovu, dokončení a nedostatek místa. Uvolnit oprávněně místo nebo zvolit kandidáta/profil podle reálného rozpočtu; nesnižovat skrytě rezervu. |
| Konzervativní mazání | Exact digest, ochrana aktuální/rollback vazby, role-specific evidence. Samotný CPU spill už není důvodem smazání. | Před opětovným zapnutím navázat důkaz prohry ve všech použitelných rolích na přijaté sady/profily. Chyba prostředí, chybějící důkaz ani NEROZHODNUTO nesmí být důvod odstranění. Ověřit živý řízený cleanup a ochrany. |
| GUI Role/Evaluace/Historie | Tabulky, řazení, alternativy, detaily úloh a neměnných běhů, spuštění testu, průběh, ETA a pět posledních akcí existují. | Ukázat exploratorní versus rozhodovací měření, neplatnost starého kontraktu, typ profilu a celý párový výsledek včetně tříd/počtů. Proklikat finální instalaci od discovery po ručně potvrzený binding a rollback, včetně výpadku backendu. |
| Správce | Všech šest čteček nyní funguje; přijetí doporučení zaznamená rozhodnutí, samo změnu neprovede. | Doplnit chybějící terminální provozní události a provést skutečné architekturní/specialistické scénáře. Zachovat rozdíl mezi funkčním sběrem, žádnou aktivitou a změřenou kvalitou; nevyrábět procenta pro 6/6. |
| Nasazení a pravidelný provoz | Desktop launcher/backend, instalační manifest a systemd již existují. Hunt je záměrně pozastavený. | Společný přijatý build/provider/DB/UI, aktuální regresní a GUI průchod, následně malá ruční vlna a řízené obnovení timeru. Zachovat noční klid podle operátorova časového rozpočtu. |

Prameny pro implementované části:
[hunt](../../scripts/model-upgrade-hunt.js),
[fronta](../../src/upgrade/model-hunt-state.js),
[plány rolí](../../src/eval/role-evaluation-plan.js),
[retention](../../src/upgrade/model-hunt-retention.js),
[desktop controller](../../src/system/hunt-control.js),
[GPU cache](../../src/system/gpu-detector.js),
[příprava rolí](../../src/eval/fixtures/drafts/README.md),
[ověřené stahování](2026-09-18-MODEL-DOWNLOAD-JOURNEY.md),
[meze VISION/CHAT/R2](2026-09-18-EVALUATION-HARDENING-VISION.md).
Historické GUI průchody nejsou vydávané za dnešní fyzické proklikání nové instalace.

## Pořadí dokončení

1. Přijmout a nasadit pravdivou konvergenci, potom opravit C3 přenos patchů
   a diagnostiku selhání na vývojových případech. Žádné nové modely k tomu
   stahovat není nutné.
2. Ověřit průchozí CODE workflow a na nové oddělené sadě jeho rozhodovací
   postup. Teprve pak zapojit tento výsledek do běžného huntu/DB/GUI a
   odvodit rychlý profil. Nezávislé případy, ne další opakování téhož.
3. Přijmout ostatní role v pořadí D2/R2, hodnotitel otevřených odpovědí,
   D1/R1; CHAT/VISION mají vlastní uvedené mezery. Do té doby lze ověřovat
   CODE samostatně, ale nelze slibovat hunt všech sedmi rolí ani mazat na
   základě údajné prohry v neověřené roli.
4. Sjednotit instalaci/provider a profily, projít celý uživatelský řetězec,
   zpracovat první omezenou vlnu, ověřit cleanup a teprve obnovit automatiku.

Dvě interpretační meze: 85,71 % dílčích kontrol a 0/24 celých workflow jsou
odlišné metriky; první není kalibrovaná pravděpodobnost druhé. Výběrová platnost
krátkého benchmarku pro toto workflow nebyla doložená. Současně při použité
konzervativní mezi samotné zvýšení úspěšnosti obou modelů při stejném rozdílu
interval nezúží. Pro nulový průměrný rozdíl je 6 skupin ±84,12 p. b.,
20 skupin ±55,54 a 50 skupin ±37,04. Ani dvacet případů tedy samo o sobě
nezaručuje rozlišení malého zlepšení; počet je nutné volit podle předem
stanovené přesnosti a obhajitelného způsobu odhadu, nikoli podle výsledku.

Záznamy tohoto auditu a neúspěšná reprodukce jsou v
`/home/belphareon/Projects/coworker/intentsmith-hunt-closeout-20260919`.

## Závěrečné ověření commitu cd1c2170

Čistý klon přesného commitu používá již instalované sdílené `node_modules`;
nejde o ověření nové instalace závislostí. Offline/database profil měl
337 PASS / 13 FAIL / 10 BLOCKED. Dvanáct sad s exit 0 označila kontrola
čistoty za FAIL kvůli souběžnému dočasnému stromu
`tests/.nightly-nested-source-*`, doloženému v jejich `sourceTree.porcelain`.
Deset sad vyžadovalo explicitní povolení lokálního toolchainu. Všech 23
neúspěšných/blokovaných sad bylo zopakováno sériově s příslušnými nástroji:
22 PASS / 1 FAIL. **Výsledné pokrytí je 359 PASS / 1 FAIL / 0 BLOCKED**,
nikoli jeden plně zelený běh. Zůstal pouze zděděný
`nightly-orchestrator-self-test`: `registry hash differs from the reviewed
Gate 0 policy`. Související soubory jsou proti vstupu nezměněné a reviewovaná
pečeť se nepřepisovala. [Souhrn a otisky](evidence/2026-09-19-hunt-readiness-validation.json).

Zachované jsou také počáteční odmítnutí klonu s neignorovaným symlinkem
závislostí a vadná interpunkce aktualizované LOC tabulky; po opravách
artefaktová sada prošla 160/160. Produkční kód se během širší validace neměnil.

Poslední čtení 19. 9. v **11:56 CEST** naměřilo **57,54 GiB volného místa**,
stejných 13 artefaktů, prázdný resident list a nadále vypnutý hunt timer.
Počátečních 37 GiB výše je starší časovaný snímek; příčinu mezitím uvolněného
místa tento audit neurčuje. Nynější prostor dovoluje některé kandidáty při
zachování rezervy 40 GiB; každý pull musí znovu ověřit jeho konkrétní rozpočet.

[Archiv důkazů](/home/belphareon/Projects/coworker/intentsmith-hunt-closeout-20260919/evidence.tar.gz),
496 341 bajtů, SHA-256
`9355df554c726045bef2505ee35045d5c3d10cc6418e11b1298b78a11cc999a7`:
ověřeno všech **395 souborů** proti manifestu. Obsahuje původní i následné
logy/reporty a zdrojový patch proti `6d085f74`; není samostatnou instalací
celého repozitáře. [Receipt](evidence/2026-09-19-hunt-readiness-bundle.json).
Nasazení, nový GPU běh a současný fyzický GUI průchod nebyly součástí této opravy.
