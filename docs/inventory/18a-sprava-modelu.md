# Inventura #18a — Správa modelů

**GPU hunt — celé předání, 23. 9. 2026:**
Nasazeno `400c9d8f`: propojené dodatečné hodnocení uloženého sběru,
CLI/API/Studio, nezávislá T4 přejímka, odvolání a příjem provozní evidence
všech rolí.
Finální fyzický běh: všech 7 rolí plus druhý CODE kandidát, **327 pokusů**;
216 otevřených odpovědí čeká na posouzení.
Sedm záložek Studia fyzicky ověřeno, přesná disková kapacita
na Vi7000 a viditelný důvod odmítnutí hodnocení. Celý offline/database
profil: 364 PASS / 1 známý Gate 0 FAIL / 0 BLOCKED.
**DEPLOYED / REVIEW_PENDING / AUTONOMOUS_SELECTION_NO_GO**;
0/7 přijatých profilů, timer vypnutý. Pozitivní cesta skutečného T4 soudce
a nová úplná párová provozní kvalifikace nejsou tímto přijaté.
[Celý rozsah a podmínky GO](../review/2026-09-23-HUNT-GRADING-INTEGRATION.md).

**GPU hunt — úložiště a arbitráž, 22. 9. 2026:**
Staré `OLLAMA_MODELS` přepsáno pro user služby pomocí environment.d;
backend, transient evaluace a provider nyní používají `/mnt/vi7000/ollama/models`.
Na novém FS přibližně 755 GiB dostupných; 12 shodných inventářových artefaktů
bez inference. Připraveno deset kritériových podkladů k arbitráži; žádné
přijaté nové skóre ani rozhodovací profil. Timer disabled/inactive, **NO_GO**
pro automatický výběr a mazání podle kvality.
[Ověření, omezení a navazující práce](../review/2026-09-22-HUNT-ARBITRATION-STORAGE.md).

**GPU hunt — sběr pod dohledem, 21. 9. 2026:**
Běžná cesta nově sbírá odlišné D1/D2/R1/R2/CHAT sady bez nepřijatého soudce,
s průběžným uložením, detaily ve Studiu a odděleným exportem bez identit.
CODE/VISION zůstávají průzkumné; přejímka a provozní platnost zůstávají otevřené.
Paměťový profil je jednotně 16 384 tokenů / 22 GB, nikoli důkaz pro větší kontext.
Nasazeno `cd5a6943`. Skutečný Qwen běh přes sedm rolí: 306 pokusů,
pět rolí bez známek čeká na posouzení. Nové stahování blokuje rezerva 40 GiB.
**DEPLOYED / SUPERVISED_COLLECTION_VERIFIED / REVIEW_PENDING / AUTONOMOUS_SELECTION_NO_GO**.
[Rozsah, ověření a zbývající práce](../review/2026-09-21-HUNT-SUPERVISED-COLLECTION.md).


**GPU hunt — rozsouzení review, 21. 9. 2026:**
Malý provozní vzorek předpovědní platnost benchmarku nepotvrdil ani nevyvrátil;
změna znaménka u D1/R2 při podprahovém benchmarku není prokázaná reverze.
Nový vzorek: 29 číselných dvojic + 1 nevyřešený scope. Opraven export
`score`/`contentScore`, dvě autorské kritériové korekce připojeny bez přepsání
původní evidence. Hodnoticí měřítko stále není přijaté. Nové sémantické sady
nejsou zapojené do běžného huntu; staré T5 cesty jsou blokované, provozní
přejímka podporuje pouze CODE. **SCALE_ADJUDICATION_OPEN / NOT_DEPLOYED / NO_GO**.
[Srovnání známek, korekce závěru a zbývající implementace](../review/2026-09-21-HUNT-REVIEW-RECONCILIATION.md).

**GPU hunt — uzavřené hodnocení a nové provozní zkoušky, 20. 9. 2026:**
53 rubrik sjednoceno, přesný produkční parser sdílen; všech 2 922 starých
pokusů dohodnoceno (2 861 obsahových známek, 37 nečitelných, 24 limitů).
Známky zmrazené před odkrytím identit. Nových 76 použitelných provozních
pokusů přes všech 7 rolí: CODE 4/6 proti 3/6, NEROZHODNUTO; D1 a R2
mají obrácený bodový směr; VISION 4/4 proti 4/4 bez rozlišení. Jedna nová
R1 obsahová otázka zůstává bez souhrnné známky. 32 vadně označených revizí
a 1 VISION bez digestu zachováno zvlášť. Generate digest doplněn ověřeným
reprodukovatelným `.2` providerem pro manuální obrazovou kvalifikaci.
Finální offline/database regrese 363 PASS / 1 známý FAIL / 0 BLOCKED;
není L1 green ani nezávislá přejímka. Statické review UI prokliknuté,
celý Studio journey zbývá. **REVIEW_PENDING / NOT_DEPLOYED / NO_GO**.
Timer, bindingy, produkční import a mazání zůstávají neaktivované.
[Závěrečný packet a omezení](../review/2026-09-20-HUNT-COMPLETION.md).

**GPU hunt — produkční JSON parser, 20. 9. 2026:** CHAT T2 a VISION nyní
používají přímo `client.js#extractJSON`; produkční parser se neměnil.
Replay 1 182 odpovědí, všech 54 fence s prózou přečteno; 48 obsahových
výsledků opraveno (17 CHAT / 31 VISION). Čistý `30c5df33`: VISION 299/299,
celý offline/database profil **363 PASS / 1 FAIL** (známá Gate 0 pečeť).
Původní odpovědi a známky zachované, překryvy reasoning rubrik stále otevřené.
**PARSER_PARITY_VERIFIED / REVIEW_PENDING / NOT_DEPLOYED**, autonomní hunt **NO-GO**.
[Změny výsledků, důkazy a meze](../review/2026-09-20-PARSER-PARITY.md).

**GPU hunt — offline posouzení sběru, 20. 9. 2026:** všech 210 CODE odpovědí
má výsledek spustitelných kontrol (133 plných / 3 částečné / 74 neúspěšných;
67 unikátních spuštění). Ověřeno 16 externích známek po jejich přečtení;
14 dalších položek vzorku má posudek 88 obsahových kritérií, bez souhrnu
z překrývajících se bodů. Potvrzená VISION parserová falešná nula; celkem
95 parserových odmítnutí potřebuje odděleně posoudit obsah. Nejde o 95
prokázaných falešných nul. Původních 247 zapečetěných souborů beze změny.
**POST_COLLECTION_ASSESSMENT_PARTIAL / REVIEW_PENDING / NOT_DEPLOYED**;
**NO_GO_FOR_AUTONOMOUS_HUNT**, bez nové inference a produkčních změn.
[Posudky, CODE výsledky, ověřený archiv a otevřené vady](../review/2026-09-20-HUNT-GRADING-FOLLOWUP.md).

Následující checkpointy zachycují dřívější etapy; jejich stav hodnocení
není aktuálním stavem navazujícího posudku výše.

**GPU hunt — přejímací brána, 19. 9. 2026:** `decisionReady` se odvozuje
z append-only přejímky hodnotitele a odděleného párového provozního měření
pro přesný kontrakt/runtime. Odvolání se znovu kontroluje; přejímka jedné
dvojice neplatí pro jiné artefakty. Čistý `83cc4704`: 360 PASS / 1 známý
Gate 0 FAIL, 17 kontrol brány, 57 sond CODE orákul a opakovaný Electron PASS.
Žádná nová inference ani produkční přejímka; GPU byla obsazená cizí prací.
**REVIEW_PENDING / FULL_HUNT_NOT_READY / NOT_DEPLOYED**, timer vypnutý,
hold zachovaný. [Packet a zbývající meze](../review/2026-09-19-EVALUATION-ACCEPTANCE-GATE.md).

**GPU hunt, navazující oprava a audit 2026-09-19:** falešná konvergence
v produkčním fix loopu opravena; výsledek, paměť oprav a metriky nyní vyžadují
potvrzené kontroly. Regrese před opravou 63 PASS / 4 FAIL, po 67/67; navazující
build 114/114. Čistý `cd1c2170`: po sériových follow-upech 359 PASS /
1 zděděný FAIL Gate 0, bez BLOCKED. V instalaci zatím není. Hunt má
provozní infrastrukturu, ale
nemá přijaté rozhodovací sady všech rolí ani integrovaný CODE pilot.
Timer zůstává vypnutý, mazání vypnuté; **IMPLEMENTATION_VERIFIED /
REVIEW_PENDING / NOT_DEPLOYED**. [Oprava a seznam zbývající práce](../review/2026-09-19-GPU-HUNT-READINESS.md).

**CODE, dokončený provozní duel 2026-09-19:** 48/48 pokusů, Qwen3.8
0/24 dokončených oprav, Devstral 0/24; 44 chybných oprav a 4 ověřená
vyčerpání rozpočtu, žádný nehodnotitelný pokus v konečné sérii. Oba modely
splnily 22 GB profil při 16 384 tokenech. Verdikt **NEROZHODNUTO**,
binding CODE beze změny. Překážkou jsou zejména nepřijaté C3 patche;
tři falešná hlášení konvergence odmítla závěrečná kontrola souborů.
Provider opraven, starší přerušený běh zachovaný. GPU uvolněná, timer
vypnutý a chráněný před starou instalací. **DECISION_RUN_COMPLETE /
REVIEW_PENDING / NOT_DEPLOYED**, širší testy 359 PASS / 1 zděděný FAIL.
[Důkazy a meze](../review/2026-09-19-CODE-MEASUREMENT.md).

Starší checkpointy níže zachycují stav v dané etapě; aktuální výsledek
a provozní stav uvádí dokončený duel výše.

**Historický checkpoint — CODE, dvoubloková sonda 2026-09-19:** opravené zahození kratší části
jednoho úseku; před opravou čtyři falešné nuly, po opravě 57/57 kontrol PASS.
Extrakce 63 ranních odpovědí beze změny. Pět deklarovaných skupin není
hotové rozhodovací pravidlo §6; krok 4 zůstává částečný. Bez nové inference
a zápisu skóre; instalace `ec78722b` opravu neobsahuje.
PILOT_INCOMPLETE / REVIEW_PENDING / NOT_DEPLOYED. [Důkazy](../review/2026-09-19-CODE-MEASUREMENT.md).

**CODE pilot, měření 2026-09-19:** dokončeno 63/63 pokusů na čistém
`0ca09dd9`; Qwen3.8 85,71 %, Devstral 46,03 %, qwen3-coder 11,43 %.
Dvě zadání mají doplněné veřejné rozhraní, novou identitu a čerstvý baseline.
16/16 neúspěšných odpovědí reprodukovalo stejné skóre. Průzkumné srovnání,
bez finálního pravidla a provozního holdoutu; role ani artefakty se neměnily.
Souběžná instalace `c0eeec50` tuto deltu neobsahuje a znovu je aktivní timer.
PILOT_INCOMPLETE / REVIEW_PENDING / NOT_DEPLOYED. [Důkazy a meze](../review/2026-09-19-CODE-MEASUREMENT.md).

**CODE pilot, noční checkpoint 2026-09-18:** ověřené hodnotitele a výsledkové
třídy (`d2ce71b7`), jedno nové měření Qwen3.8 76,19 % (21/21). Devstral
zrušen na pokyn operátora, coder nezahájen. Hunt timer inactive/disabled,
další testy odložené kvůli nočnímu klidu. Ostatní role mají připravené
neaktivní podklady, nikoli ověřené sady. 359 PASS / 1 zděděný FAIL před
poslední integrací vzhledu; integrovaný build PASS, GUI neověřené.
REVIEW_PENDING / PILOT_INCOMPLETE / NOT_DEPLOYED. [Důkazy a meze](../review/2026-09-18-CODE-PILOT-GRADER-CHECKPOINT.md).

**IDE a GPU hunt, 2026-09-18:** nasazeno `576719bf`. Řazení hlavičkou,
celé použitelné role v jedné evaluaci, číselné matice, 249 kandidátů ze
sloučeného katalogu, záložky/kontext/sloupce/soubory a zarovnané seznamy.
119 cílených/navazujících Node testů, 20 kontrol instalovaného GUI PASS;
úplný profil 359 PASS / 1 FAIL (nezměněná Gate 0 pečeť). Data zachovaná.
REVIEW_PENDING. [Rozsah a důkaz](../review/2026-09-18-IDE-HUNT-POLISH.md).

**Schopnost:** #18a (pořadí 4) · **Datum:** 2026-08-02 · **Commit:** `17a8b9a8`
**Poslední follow-up:** 2026-08-25 (konsolidace evaluací, rozhodnutí 030)
**Vznik:** rozdělením #18 rozhodnutím operátora, inventura #1 `N-1`

> `CONTRACT.md` §3 krok 1. Popisuje stav, nerozhoduje.
> Staré scoring/validation části této point-in-time inventury jsou superseded;
> current stav je v [MODEL-SCORING-ACTIVATION.md](../MODEL-SCORING-ACTIVATION.md).

## 1. Rozsah

| Soubor | Řádků |
|---|---:|
| `src/upgrade/model-profiles.js` | 272 |
| `src/upgrade/model-registry.js` | 572 |
| **Celkem** | **844** |

Plus podmnožina rout ze `system.js` — `models`, `models/info`,
`models/compatibility`, `models/check`, `models/overview`, `models/pull`,
`DELETE models`.

## 2. Naměřeno

| | |
|---|---|
| `model-upgrade.test.js` | **58 passed** (pokrývá profily i registry) |
| `model-ctx.test.js` | **6 passed** |
| Za běhu bez Ollamy | `Discovered 0 local + 0 catalog + 0 L4 = 0 candidates, 3 hints`, `ollamaAvailable: false` — čistá degradace |
| Inicializace kontextu modelu | `qwen3.5:27b → num_ctx=8192` z `{declaredCtx: null, vramNumCtx: null}` — fallback funguje |

**Veřejné API `model-profiles.js`:** `MODEL_FAMILIES`, `MODEL_PROFILES`,
`parseModelName()`, `getAllProfiles()`, `getProfile(role)`,
`getCurrentBindings()`, `isSameFamily()`, `isNewerVersion()`.

## 3. Seznam 1 — dobré, použije se

| Co | Proč |
|---|---|
| **Vazba role → model je explicitní a deterministická** | `getProfile(role)` a `getCurrentBindings()`. Žádná část systému si model nevybírá sama; ptá se profilu. To je předpoklad pro to, aby #3 (gateway) mohl fungovat. |
| **`parseModelName()` + `isSameFamily()` + `isNewerVersion()`** | Rozumí `qwen3.5:27b` jako rodině, verzi a velikosti. Čisté funkce, snadno testovatelné. |
| **VRAM fit a `num_ctx` odvození** | Kontext se odvozuje z VRAM s fallbackem, ne natvrdo. Ověřeno v logu při startu. |
| **Degradace bez Ollamy** | Registry i discovery vrátí prázdno a systém běží dál. |
| **Test pokrytí** | 58 asercí, profil `offline` — tedy uvnitř deterministického rozsahu. Na rozdíl od CRE jde tuhle schopnost ověřit bez modelu. |

## 4. Seznam 2 — zbytečné

Nic. 844 řádků, obojí zapojené a pokryté.

## 5. Seznam 3 — nejasné

| # | Zjištění | Otázka |
|---|---|---|
| **M-1** | **Kód fyzicky leží v `src/upgrade/`**, ale schopnost je nově v základu, zatímco zbytek adresáře (18b) je mimo. Adresář neodpovídá rozdělení. | Přesunout do `src/models/`, nebo nechat a rozlišovat jen v dokumentaci? |
| **M-2** | **`model-upgrade.test.js` (58 asercí) pokrývá 18a i 18b dohromady.** Sada nerozlišuje, co je základ a co nadstavba. | Rozdělit sadu podle nového řezu, nebo nechat společnou? |
| **M-3** | **`model-registry.js` (572 ř.) má jen jeden export** — singleton `modelRegistry`. Vnitřní API není z venku vidět. | Je to záměr (zapouzdření), nebo to komplikuje testování jednotlivých částí? |

## 6. Co inventura nenašla

- Žádné automatické stahování ani upgrade modelu v této části — to je celé v 18b.
- Žádný externí discovery klient: `whatllm-client`, `registry-client` a
  `online-discovery` jsou v 18b, ne zde. 18a ale komunikuje přes HTTP s
  konfigurovanou Ollamou; `offline` zde znamená bez externí služby, nikoli bez
  lokálního síťového effectu.

## 7. Runtime follow-up B3-IDENTITY — 2026-08-08

Pozdější runtime probe vyvrátil implicitní předpoklad, že Ollama a config vždy
použijí byteově stejné jméno. Config měl například bare binding, zatímco Ollama
vracela `:latest`; registry pak označila přiřazený model jako deletable a přímý
route fallback skutečně došel k provider delete effectu.

Oprava přidala `src/upgrade/model-identity.js` jako jedinou autoritu pro
binding/presence safety. Pokrývá role, validating guard, overview,
validation/usage join, recommendation, registry delete/auto-clean,
`getUnusedOldModels()` a direct system-route fallback. Integrity scan už binding
nemění: vrací pouze typované `DETECTED/PROPOSED`, nebo `INCONCLUSIVE` při
prázdné/nedostupné Ollamě.

Hranice zůstává záměrně úzká: presence identity není identity artefaktu.
`name:latest` se může pod stejným jménem změnit, proto automatický failover
později vyžaduje exact digest-bound fresh validation. Chatový cleanup navíc po
vytvoření unused seznamu používá vlastní provider delete; jeho atomický závod s
novým bindingem je samostatný `finding 006`, nikoli skrytě rozšířený scope této
opravy. Age-based cleanup současně porovnává SQLite a ISO timestampy jako text;
oddělený retention residual je `finding 007`.

## 8. Runtime follow-up cleanup authority — 2026-08-09

Navazující source checkpoint centralizuje všechny tři produkční delete vstupy
(HTTP, chat a opt-in scheduler) do `ModelRegistry.deleteModel()`. Přímý provider
DELETE z route a chatu zmizel. Destruktivní cesta sdílí fail-fast mutation owner
s apply/rollback/rehydrate, chrání runtime, durable desired, pending i one-step
rollback identitu a těsně před efektem podruhé ověřuje exact provider name a
normalizovaný digest.

Chat už nemá přímý provider effect. Jeho současný candidate source ale vrací
právě one-step rollback model, který binding application správně chrání; reálný
post-apply test jej proto zaparkuje před inventory. Funkční chatové odstranění
čeká na explicitní retirement pravidlo a není vydávané za hotový journey.
Auto-cleanup čte pouze autoritativní JSON settings,
neumožní překryv ticků a porovnává striktně validované UTC epochy. Parsuje
všechny usage alias řádky před numerickým maximem; nulová usage, invalidní nebo
chybějící age evidence a DB chyba fail-close chrání model. Nulová usage není
důkaz nepoužití, protože validation, vision a embeddings zatím nesdílejí jeden
usage writer.

Finding 007 je tím v C1 remediovaný. U findingu 006 je odstraněný direct bypass
a assign/delete race, ale durable audit zůstává otevřený. Není vyřešené ani
mazání proti concurrent pull po posledním snapshotu, již běžící
inference/vision/embedding práci nebo cross-process claim. Tyto hranice jsou
pravdivě oddělené ve findingu 010 a brání povýšit L0-11 nad `PARTIAL`.

## 9. Runtime follow-up C2 model-use authority — 2026-08-09

C2a přidalo jednu fail-fast per-canonical single-process autoritu: registry
validation drží shared lease a pull/delete jsou vzájemně exclusive. C2b
gateway checkpoint zapojil třetí živou cestu; request drží shared lease přes
celý provider lifecycle včetně response body a retry delay, ale až po přidělení
semaphore slotu.

Binding cutover/exact verification checkpoint zapojil čtvrtou živou cestu.
Previous+target lease vzniká až po případném pullu a drží přes nový exact
resolve, durable zápis, compensation a synchronní finalize; verification drží
target přes probe i durable success zápis a před retry delay jej uvolní.
Startup snapshot není autorita. Operationless legacy override však zůstává
name-only `LEGACY_UNVERIFIED`. Tvrzení z tohoto checkpointu, že post-DB runtime
finalize neměl durable recovery, už neplatí: navazující `7c4aa73c` přidal
operation-scoped exact startup recovery bez druhého pullu.

Call graph má nadále pět živých cest. Nepřipojený zůstává VRAM manager;
durable/cross-process autorita není rozhodnutá a direct pull stream nemá idle
timeout ani recovery. Schopnost #18a proto zůstává v tomto řezu `PARTIAL`;
fresh-clone zelená gateway+binding evidence pokrývá pouze 4/5 živých cest a
není release ani L0-11 PASS.

## 10. Runtime follow-up B3 detection coordinator — 2026-08-09

Původní pětiminutový scheduler volal name-only `checkBindingIntegrity()` přes
`setInterval()` a celý výsledek zahodil. Nový
`src/upgrade/model-failover-coordinator.js` tuto diagnostiku nepoužívá: po
literal-true opt-inu vezme právě jeden strict snapshot přes stejný
loopback-only provider jako manual binding application. Před prvním DB zápisem
ověří celý inventory a stabilitu sedmi runtime bindingů. Poslední policy check
je součástí stejné repository `BEGIN IMMEDIATE` transakce jako durable efekt.

Koordinátor smí pouze založit první exact digest-bound baseline pro přítomný
config nebo `LEGACY_OVERRIDE` desired baseline podložený jedním operationless
`LEGACY_UNVERIFIED` compatibility override a nad později chybějícím stejným
desired artifactem vytvořit `DETECTED`. Existující desired binding
nikdy nepřepisuje. Digest drift pod stejným canonical jménem, chybějící
baseline, manual desired, nevysvětlený override, terminal incident, prázdný či
ambiguous inventory a souběžná změna authority končí bez failover effectu.
Repository `expectedAbsent` a `detectionOnly` zavírají dva race švy: scheduler
nesmí přepsat novější desired autoritu ani retireovat terminální incident.

Composition root mu předává dva frozen porty: pět repository metod a jedinou
inventory metodu; plný repository/provider a jejich další efekty
koordinátor nevlastní. Produkční scheduler je recursive single-flight a první provider call zůstává
až po dosavadním pětiminutovém delay. Checkpoint netvoří proof, claim, fallback
candidate, provider mutation, runtime binding ani broadcast; L0-9 se proto
nemění a automatic activation/restore zůstává otevřená.

## 11. Runtime follow-up evaluace CODE — 2026-08-21

Validační sady `SUITES` hodnotí odpovědi klíčovými slovy a žádná z nich kód
nespustí. Změřeno 2026-08-19: 100 % padlo 26× z 65 (13 modelů × 5 sad),
`llava:13b` dostal 100 % v sadě `code` a nefunkční `isPrime` dostal 1.0 za
`return` a cyklus. Souboj na roli CODE tím skončil nerozhodně.

Nová sada `code_patch` v `src/eval/` staví úlohy z vlastní historie repa: zdroják
se vrátí do stavu před opravou, model dostane vadné funkce a popis požadovaného
chování, jeho odpověď se vloží zpátky do souboru a spustí se skrytý test.
Cílové testy se odvozují spuštěním, ne z textu commitu — `failToPass` (padá před
opravou, prochází s gold patchem) je zadání, `passToPass` hlídač regresí. Skóre
je podíl spravených cílových testů, nula při jakékoli regresi. Model vidí vadné
funkce a názvy požadovaného chování, ne tělo testu, fixtury ani gold patch.

Izolace: odhozený `git worktree`, podproces s timeoutem a síťový namespace
`unshare -rn` s nahozeným `lo` — loopback funguje, ven se model nedostane.
Extrakce ani hodnocení nemají vedlejší efekt na zdrojový repozitář: používá se
`git show <ref>:<cesta>` a ruční zápis, protože `git checkout <ref> -- <cesta>`
mění index hlavního repa i při zápisu do jiného `--work-tree`.

**Připnuté soubory zůstávají nedotčené.** `src/upgrade/validation-suites.js` je
vedle `model-profiles.js` bajtově připnutý ve `model-failover-proof-policy.js`
(`sha256-raw-bytes-v1`) a policy navíc kontroluje, že `Object.keys(SUITES)`
přesně odpovídá pěti očekávaným sadám. První verze sady zapsala registraci do
toho souboru a shodila policy na `MODEL_FAILOVER_PROOF_POLICY_SOURCE_DRIFT`;
zápis do registru zvenčí ji shodí na `AUTHORITY_INVALID`. `code_patch` se proto
do `SUITES` nezapisuje vůbec a do souboje se předává explicitně —
`comparePair(runner, 'code_patch', a, b, { suite })`. Vlastní parametry volání
(`num_ctx`, `num_predict`, timeout) nese `CodePatchValidationRunner`, potomek
`ValidationRunner`. Hlídají to testy `připnutý validation-suites.js zůstává
nedotčený` a `sada se do registru SUITES nezapisuje`.

Vazba role CODE se **nemění**: sada má `roles: []` a běží vedle `code` jako
podklad k ručnímu potvrzení operátorem. `REMOVAL_ENABLED_BY_DEFAULT` zůstává
`false`.

Naměřeno 2026-08-21 na pěti modelech (3 opakování × 7 úloh, 105 běhů, 47,1 min,
šum 0,000): `qwen2.5-coder:32b` 0,190 · `qwen3.5:27b` 0,143 · `qwen3-coder`
0,048 · `qwen2.5:32b` 0,048 · `qwen3:14b` 0,000. Informaci nesou **2 úlohy ze
7**, zbylých 5 je nad síly celého panelu. Kalibrace (`calibrate-code-suite.js`)
zapisuje každé úloze `status`; běžné měření jede jen přes `active`, rezervy se
nemažou, protože dnešní podlaha je zítřejší strop. Zásoba je úzká — z 29
kandidátů padá 18 na tom, že mění řádky mimo funkce.
