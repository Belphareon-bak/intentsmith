# GPU hunt: připravený sběr, nová CODE úloha a význam jistoty

Datum: 23. 9. 2026. Stav: **IMPLEMENTED_AND_OFFLINE_VERIFIED / REVIEW_PENDING / NOT_DEPLOYED / NO_AUTONOMOUS_GO**.

Toto předání uzavírá technickou přípravu dalšího řízeného sběru. Neuzavírá nezávislou přejímku hodnotitele, modelový pilot ani provozní kvalifikaci. V tomto kole nebyla spuštěna žádná modelová inference. Připravený pilot má 0/64 volání; 64 HTTP volání v testu používá syntetické odpovědi.

Autorita: explicitní zadání operátora „Tak to dokonči a otestujeme to“, [handoff §5](../wp/WP-GPU-HUNT-HANDOFF-20260919.md), [direction §7.5](../wp/WP-GPU-HUNT-DIRECTION-20260919.md) a nezměněný [evaluační kontrakt](../wp/WP-GPU-HUNT-EVALUATION-CONTRACT-20260918.md). Rozsouzení starých odpovědí zůstává v [předchozím záznamu](2026-09-23-CODE-RECONCILIATION.md).

## 1. Co je nyní dokončené

| Milník | Implementace a důkaz | Přesná hranice |
|---|---|---|
| Sběr rozdělený do oken | Zmrazený plán, rozpočty volání/tokenů/času, hashovaný a fsyncovaný deník, pokračování ze skutečné historie kandidáta | Zatím offline a HTTP transport; nikoli živý modelový pilot |
| Ochrana prostředí | Vlastní provider a GPU lease, kontrola digestu/verze, RAM a tří FS před/během/po volání, ověření umístění po odpovědi | Umístění podle provider telemetry; není to nezávislá nativní offload attestation |
| Nové CODE zadání | Jistota ve všech kvalitativních větvích, explicitní doména, nová identita, 24 spustitelných kontrol na každou referenci | Jedna vývojová česká úloha; není nový holdout ani celá nová CODE sada |
| Extraktor významu | Dostane pouze prózu, dvě pořadí výstupního schématu, ověření identity a úplnosti, citované důkazy, zákaz stejného digestu jako hodnocená odpověď | Kandidát komponenty; zatím bez modelové a nezávislé sémantické přejímky |
| Předání odpovědí | Export celého dialogu, dílčích odpovědí a rubrik; identity v odděleném PRIVATE souboru | Žádné automatické známky ani import do produkce |

Základ implementace je `9b3e851b`; `095c3d1f` doplňuje kandidáta extraktoru, stav PREPARED a registr testů. `01d684e0` přijímá přesně devět prověřených module edges bez růstu cyklů (1 417 hran, 3 cykly / 28 členů). Nová komponenta extraktoru nepřidává interní importní hrany.

## 2. Jak se sbírá a pokračuje

Implementace: [stage engine](../../src/eval/collection-stage.js), [provider adaptér](../../src/eval/collection-stage-provider.js), [CLI](../../scripts/manual/collect-chat-conversation.mjs). Před spuštěním je nutný čistý strom a shoda hashů sběrače, promptů, generování, provideru a autoritních závislostí se zmrazeným plánem.

- Rozpočet okna nikdy nevynuluje spotřebu celé etapy. Počet volání a maximální výstupní tokeny jsou omezené plánem i aktuálním oknem. Nové okno má nové ID a explicitní rozpočet; maximálně 24 hodin.
- Volání se nejdřív rezervuje a trvale zapíše, až pak odešle. Jeho neznámá spotřeba při chybě se účtuje plným tokenovým limitem. Pád bez uložené odpovědi se nezamění za „nikdy se nestalo“ ani automaticky neopakuje.
- Úspěšné předchozí tahy se obnoví z deníku. Model dostane své skutečné odpovědi, žádnou referenční odpověď nebo historii jiného kandidáta.
- Předdispatch limit ponechá rozhovor rozpracovaný. Výpadek uprostřed inference nebo vyčerpání výstupního limitu zůstane dokončeným neúspěšným pokusem z hlediska sběru, bez obsahové nuly. Nový náhradní pokus potřebuje samostatně určené pravidlo zařazení; tento runner jej sám nevytváří.
- Poškozený deník, změna promptu, digestu či provideru běh zastaví. Neukládá se sloučený výsledek neporovnatelných běhů.
- JSON průběh obsahuje aktuální model, úlohu a tah, dokončené rozhovory, spotřebu a zbývající čas okna. `etaMs: null` znamená, že odhad doby není změřen; stopka není ETA.
- RAM rezerva 6 GiB; evidence a /home po 40 GiB; /tmp 2 GiB. Kontrola běží i během inference přibližně každé dvě sekundy. Jednotlivé síťové kontroly mají vlastní timeout, nejde o tvrdý real-time OOM limit. Cizí GPU proces se neukončuje.
- Po odpovědi se kontroluje digest, kontext 16 384, plné umístění modelu v GPU podle provideru a strop 22 GiB. Ruší a uvolňuje se pouze vlastní provider/model.

## 3. Připravený CHAT pilot

Evidence: `/mnt/vi7000/intentsmith/evidence/hunt-collection-ready-20260923/`.

Aktuální zmrazený plán je `chat-pilot-final/plan.json`, připravený na `01d684e0`:

- SHA plánu: `7fcbbae79a7339b99eab8afa5d9474dab3c443779ce4bd6fad1eba3f1590f1a4`.
- Dva instalované modely: **qwen3.8:latest** (`22130167c4c2…`) a **phi4:14b** (`ac896e5b8b34…`). Plné SHA a provider `0.34.2-intentsmith.1` jsou v plánu. Výběr porovnává dosavadního silného kandidáta s uživatelem preferovaným stylem Phi; netvrdí předem vítěze.
- Šest společných scénářů, každý česky a anglicky, jedno opakování: 12 jazykových variant × 2 modely = **24 rozhovorů / 64 volání**.
- Oprava projektového kontextu, offline diagnostika, vysvětlení času, citovaná injekce, změna tónu a jeden striktní JSON scénář. Pět scénářů má tři tahy, JSON jeden.
- Maximum 131 072 výstupních tokenů, úvodní okno 4 hodiny. To je strop, ne předpověď trvání. Jazykové varianty ani opakování nejsou automaticky nové nezávislé případy.
- Sada a rubriky jsou v `chat-proposal/review.html`. Je to vývojová sada, `notAHoldout: true`.

První starší `chat-pilot/` zůstal zachovaný, ale je nahrazený plánem `chat-pilot-final/`; nespouštět oba. Starší plán už neshoduje source contract po změně stavu PREPARED a sběrač ho odmítne.

### Spuštění po revizi přesného plánu

Spouštět z pracovního repozitáře. Pro spuštění se používá wrapper, který vlastní vyhrazený provider; samotné `--prepare`, `--status` a `--export` GPU nespouštějí.

```bash
cd /home/belphareon/worktrees/is-mobile-completion-20260908
OLLAMA_MODELS=/mnt/vi7000/ollama/models node scripts/run-model-hunt-provider.js \
  --collection-stage --run \
  --out=/mnt/vi7000/intentsmith/evidence/hunt-collection-ready-20260923/chat-pilot-final \
  --expected-plan=7fcbbae79a7339b99eab8afa5d9474dab3c443779ce4bd6fad1eba3f1590f1a4 \
  --window=pilot-01 --hours=4 --calls=64 --tokens=131072 \
  --report=/mnt/vi7000/intentsmith/evidence/hunt-collection-ready-20260923/chat-pilot-final/pilot-01-summary.json
```

Průběh se trvale zapisuje do `events.jsonl`; závěrečný `summary.json` je odvozený přehled. Při pádu procesu je autoritou deník, nikoli chybějící závěrečný soubor. Stav lze kdykoli přečíst:

```bash
node scripts/manual/collect-chat-conversation.mjs --status \
  --out=/mnt/vi7000/intentsmith/evidence/hunt-collection-ready-20260923/chat-pilot-final
```

Při pokračování použít nové `--window=pilot-02` a rozpočet nejvýše `remainingCalls` / `remainingOutputTokens` ze stavu. Neopakovat automaticky původních 64 volání a 131 072 tokenů. Dokončené odpovědi zůstávají; úmyslně se nevybírá lepší opakování.

Export po běhu (lze i při přerušení; cílový adresář musí být nový):

```bash
node scripts/manual/collect-chat-conversation.mjs --export \
  --out=/mnt/vi7000/intentsmith/evidence/hunt-collection-ready-20260923/chat-pilot-final \
  --review-out=/mnt/vi7000/intentsmith/evidence/hunt-collection-ready-20260923/pilot-review-01
```

Hodnotitel dostane `review.json` s celými dialogy a `coverage.json`. `PRIVATE-identity-key.json` zůstává u operátora. Export sám nezaručí slepotu člověka, který odpověď pozná z dřívějška; expozice se musí přiznat.

Plný CHAT panel je samostatná navazující etapa: **10 modelů, 20 CZ/EN dvojic, 3 opakování, 1 200 rozhovorů / 3 480 volání**, maximum 7 127 040 výstupních tokenů. První okno nejvýše 24 hodin; případné pokračování má vlastní explicitní rozpočet. Nejde o měření všech sedmi rolí. Trvání a využitelnost odpovědí se posoudí podle pilotu před spuštěním celého panelu.

## 4. Nová CODE úloha a kandidát extraktoru

Nové zadání `code_confidence_all_quality_v2_cs` má kontrakt `f4d8a38408fee900caab7aefef0e9e2f7daf82b7e46e98e25c1f1b0a704e09fa`. Jeho veřejné znění požaduje jistotu i u podprahového ponechání založeného na kvalitě. Původní reference a odpovědi se nemění. Historické rychlostní větve jsou součást izolované úlohy, nikoli nové oprávnění produkce měnit model podle rychlosti při neprůkazné kvalitě.

Vstupní doména je explicitní: konečné marže a rychlosti, celé nezáporné počty se správným součtem, kladný práh. Neplatné či chybějící vstupy nejsou v této úloze hodnocené. Jde o vymezení nového zadání, nikoli o oslabení původního důkazu.

`code-v2/review.json` obsahuje skutečné běhy izolovaného runneru:

| Kontrola | Technická složka | Celkové skóre |
|---|---:|---|
| Referenční oprava | 24/24 | null |
| Jinak napsaná správná oprava | 24/24 | null |
| Rozbitý základ | 4/24; zachované rychlostní větve | null |

Technické orákulum ověřuje API a rozhodnutí; nepřisuzuje význam próze. Proto i kód se správným API a negovaným vysvětlením může splnit technickou složku, ale **nedostane celkový PASS**. To je v regresním testu výslovně ověřené.

[Extraktor](../../src/eval/confidence-meaning.js) má rozhraní `observeConfidenceMeaning({text, artifact, answerArtifact, call, onReceipt})`. Provider callback má stejný tvar jako `ModelEvaluationRunner._callModel`. Jde o izolovanou komponentu k následující přejímce, ne o zapojeného produkčního hodnotitele. Dostává jen text; až následné `compareConfidenceSources()` porovná pozorovaný stupeň s API a počtem. Hash kontraktu zahrnuje instrukci, volby generování, schéma i implementaci.

Povolené výsledky jsou ASSERTED / MISSING / UNRESOLVED / CONTRADICTORY. Stejný digest odpovědi a soudce je odmítnut. Obě pořadí výstupního schématu, identity, úplnost a citace jsou uložené. Citace potvrzuje původ textu, **ne jeho význam**. Stejně chybné čtení ve dvou pořadích může působit konzistentně; proto ani trojí shoda nezakládá přejímku a celkové skóre zůstává null.

18 zveřejněných autorských sond pokrývá tři stupně a kladné tvrzení, parafrázi, negaci, citaci, vnitřní rozpor a nejistotu. Jejich známé očekávání je vývojová pomůcka. Žádný skutečný model na nich v tomto kole neběžel a nejsou nezávislým přejímacím vzorkem.

## 5. Ověření a zachované neúspěchy

- **60/60 cílených kontrol**: deník/rozpočty/obnova, skutečný HTTP transport se syntetickými odpověďmi, přerušení a zdroje, nová CODE úloha, kandidát extraktoru, konverzační sběr, technická projekce a existující přejímací brána. `focused-final.log`.
- Registr: **538 programů** (444 ACTIVE, 79 BLOCKED, 15 HISTORICAL); osm nově registrovaných zahrnuje čtyři již existující testovací soubory, které dříve v registru chyběly. Žádné oslabení ani překlasifikace testů.
- Široký offline/database běh na `9b3e851b`: **359 PASS / 3 FAIL / 10 BLOCKED** z 372. FAIL: dokumentační census, devět nezapsaných module edges, známý release fingerprint v orchestration self-testu. BLOCKED byly explicitně nepovolené lokální toolchainy.
- Cílený opakovaný běh na `01d684e0`: **13 PASS / 2 FAIL / 0 BLOCKED**. Všech deset toolchain programů i module boundary prošlo. Zbývaly dva dokumentační údaje a známý release fingerprint. Závěrečná oprava dokumentace prošla **160/160 kontrolami**; viz `artifact-final.log`.
- První chybně spuštěná širší regrese mimo cestu `.intentsmith-artifacts` je uchována: **58 PASS / 304 FAIL / 10 BLOCKED**. Izolované testy oprávněně odmítly nevhodné TMPDIR. Není to důkaz 304 produktových regresí ani se nezapočítává jako úspěšná regrese.

Orchestration self-test se kvůli zastaralé release pečeti nepřeznačuje na PASS. Tohle není release přejímka. Výsledky různých SHA nejsou prezentované jako jeden zelený běh na finálním commitu.

Na čistém `0a9eec5a` proběhlo závěrečné opakování 60/60 cílených kontrol a dva auditované programy: artifact validation (160/160) a module boundary (13/13), oba PASS. `final-stage-check.json` potvrzuje shodu všech zdrojových hashů se zmrazeným pilotem a 0 dosavadních modelových volání.

## 6. Zachování původních dat a prostředí

Původních 2 922 odpovědí, známky, DRAFT druhého posuzovatele ani produkční DB nejsou předmětem přepisu. DRAFT SHA256 zůstává `680bbc7d41b7c286c46bede4a59372dc908da298c21afd1b4dbcf95411cf9d65`. Shoda 60/60 je druhé čtení s expozicí; nikde se z ní nestává nezávislá slepá přejímka.

Timer zůstává disabled/inactive; žádná změna bindingů, automatického mazání, stahování modelů nebo instalovaného releasu. Pracuje se v původním worktree. Předání obsahuje snapshot zdrojových rozdílů a kontrolní hashe, nikoli kopii vah modelů či runtime sandboxů.

Úklid standardním `workspace-budget clean --yes` skončil částečně: z 566 naplánovaných runtime/home adresářů je po běhu 217 nepřítomných, 349 zůstává. Běh zastavilo EACCES na staré Go cache (`core-completion-20260909/provider-proposal/toolchain/gomodcache/.../runtime`). Individuální receipt se při chybě nevydal, proto jde o kontrolu existence po běhu, nikoli úplný seznam potvrzených smazání. Další mazání ani změny práv nebyly provedené. `workspace-clean-result.json` uchovává přesný rozsah a chybu. Zdroje zůstaly čisté; rezerva /home přibližně 183 GiB, evidence 755 GiB. Tento úklid neblokuje pilot.

## 7. Co zbývá po této revizi

1. Posoudit nové veřejné CODE znění/doménu a CZ/EN dialogy CHATu. Připravený pilot ověří délky, navazování, limity, úplnost a použitelnost odpovědí; samotný sběr může proběhnout před přejímkou soudce, protože nerozdává skóre.
2. Spustit **pilot 64 volání** přes uvedený plán. Z jeho checkpointu rozhodnout o plném panelu a skutečném časovém rozpočtu, nikoli odvozovat kvalitu z rychlosti dokončení.
3. Pro extraktor a sémantického hodnotitele získat nepoužité odpovědi s nezávisle stanovenými očekáváními, uzamknout ladicí/přejímací rozdělení a meze falešného přijetí/odmítnutí podle kontraktu. Prověřit negace, citace, chybějící tvrzení, pořadí a skutečná selhání. Přejímka musí být vázaná na přesný kontrakt a digest; autorské sondy ani vystavených 30 řádků ji nenahrazují.
4. Po přijatém měřidle a potřebném sběru ověřit srovnání kandidáta se současným modelem na nových oddělených provozních případech. Postupné GO po rolích; neotevírat automatiku pouhým dokončením pilotu.

Alternativa pro první kolo: nové dialogy známkovat dvěma lidmi/nezávislými posuzovateli bez automatického extraktoru. Urychlí to kontrolu použitelnosti sady, ale neprokáže spolehlivost automatického huntu. Pro D1/D2/R1/R2/VISION nevzniklo v tomto kole nové modelové měření ani nová přejímka; jejich dřívější omezení zůstávají.

**Další test je připravený jako sběr pod dohledem. Autonomní výběr zůstává NO-GO do doložené přejímky a provozního ověření.**

Strojový souhrn: [rozsah, zdrojové hashe, výsledky a zachované FAIL](evidence/2026-09-23-hunt-collection-ready.json). Přenosný archiv a jeho manifest jsou v kořeni uvedené evidence; nezahrnují modelové váhy ani testovací runtime.
