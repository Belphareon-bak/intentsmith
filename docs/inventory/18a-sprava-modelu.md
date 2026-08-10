# Inventura #18a — Správa modelů

**Schopnost:** #18a (pořadí 4) · **Datum:** 2026-08-02 · **Commit:** `17a8b9a8`
**Vznik:** rozdělením #18 rozhodnutím operátora, inventura #1 `N-1`

> `CONTRACT.md` §3 krok 1. Popisuje stav, nerozhoduje.

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

Call graph má nadále pět živých cest. Přijaté 023/A nyní připojuje VRAM manager
jako focused zelený source candidate: task, celý canonical-deduplikovaný unload
batch a direct reload drží shared artifact leases přes své přesné effect/body
hranice. Source `7da6be4c` má exact-edge baseline 1021/1021 a baseline HEAD
`3b95f2b1` prošel novým `git clone --no-local` se všemi relevantními exity 0.
Durable/cross-process autorita není rozhodnutá, direct pull stream nemá idle
timeout ani recovery a shared artifact lease není globální GPU residency.
Schopnost #18a proto zůstává `PARTIAL`; pět z pěti single-process artifact-use
cest je fresh-clone ověřených, ale není to release ani L0-11 PASS.

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

## 11. Runtime follow-up 020/E policy storage — 2026-08-09

Failover a cleanup opt-in už nemají být důvěryhodně odvozované z obecného
`user_settings` blobu. Migrace 061 vytváří samostatnou default-off projekci a
append-only event authority. Platné historické automation klíče se z obecného
dokumentu odstraní, jejich přesný tříklíčový fragment zůstane v bootstrap
eventu a cizí modelové klíče přežijí. Malformed legacy dokument se nepovýší a
zůstává fail-closed.

Nový repository seam zapisuje projection first a event second v jediném
`BEGIN IMMEDIATE`; deferred FK a triggery zakazují jednostranný commit. Dva
skutečné WAL workery nad stejnou revision mají jednoho vítěze a jednoho stale
losera. Detection repository i auto-cleanup/overview už čtou pouze tuto novou
autoritu. Generic GET/POST dropuje tři rezervované klíče a hlásí je přes
`ignoredReservedKeys`; pre-061 JSON helper nemá produkčního konzumenta a jeho
sada je `HISTORICAL`. Typed GET/PUT používá exact body a revision CAS. Backend
explicitního versioned backup/import/reset adaptéru už sdílí jeden
repository-owned commit point pro general settings, policy a audit event.
Původní schema-v1 portable export vynechával `webhookSecret` a
`c3.notif.smtpPass`; jeho nedostatečnou boundary superseduje korekce níže.
Runtime chyba po durable commitu je
přiznaný degraded výsledek, ne falešné 500. Repository catch končí před
post-commit runtime/presentation fází a logger failure je best-effort, takže ani
dvojité selhání nesníží commitnutý import/reset na non-2xx. Autoritativní Studio `lib` consumer
už fail-closed kontroluje HTTP i exact envelope, přijímá pouze serverem
commitnutý snapshot a serializuje import/reset proti generic save. Nejasné
doručení uzamkne další zápisy, definitivní reject jediný obnoví deferred save a
generation token odmítne settings GET zahájený před recovery. Tehdejší VM sada
měla 110/0; první Review A vrátilo `CHANGES_REQUIRED`. Scheduler proto zůstává
default off.
Skutečná parita s
mobilními migracemi bude doložená až na společném integračním SHA.

### Korekce portable boundary 2026-08-10

Předchozí dvouklíčový schema-v1 blacklist nechránil nested credentials,
destinations ani future unknown fields a jeho Review A claim je superseded.
Nová repository autorita exportuje pouze schema v2 se source-derived sparse
mapou nad default-deny profilem jedenácti předvoleb. Nepřítomná source hodnota
se nefabrikuje defaultem a nepřepisuje existující destination preference.
V1/raw zůstává importní kompatibilita
projektovaná týmž allowlistem; source secret/private hodnoty nemohou založit ani
přepsat destination authority. Importní HTTP metadata už nepublikují názvy
local-only cest, pouze jejich počty.

Focused backend sada má 36/0 a její security coverage je zpřísněná:
canaries zahrnují nested i flat credential/destination varianty, future pole,
invalid v2 profile/value a datové klíče `constructor`, `prototype` a
`__proto__`. V1/raw import je sparse: chybějící portable cesta už destination
hodnotu nedefaultuje ani nepřepisuje. Tři UI consumery navíc přijmou commit jen
při shodě source schema, path/value/policy provenance, propojeného eventu a
pravdivého ignored countu; portable source má 123/0 a po selektivním wire
replayi má konsolidační queue 127/0. Gate 1 zůstává `BLOCKED`:
generic GET/whole-row writer a další
RMW cesty nemají společný secret/CAS kontrakt, viz
[`Finding 011`](../findings/011-user-settings-authority-and-secret-exposure.md).

## 12. Proof policy 015/A — implementační checkpoint 2026-08-10

Role-suite autorita nyní používá schválený konzervativní bootstrap: všech sedm
rolí vyžaduje skóre `1`, úplnou seřazenou sadu 8/8 nebo 6/6 a TTL
`604800000` ms. `reason` je `null`; caller nemůže dodat práh, TTL, proof ID ani
jinou autoritu.

Authority hash pokrývá celý policy envelope včetně acceptance prahů, TTL,
runneru a tří raw-byte source pinů. `model-failover.js`, z něhož se čte
`policyVersion`, je pinnutý stejně jako profily a validační sady; pouhá změna
prahu nebo TTL bez přepočtu očekávané autority proto skončí fail-closed.

Izolovaný measurement tím nezískal DB writer. Jeho kanonický artefakt dál nese
`NOT_ISSUED`, `proofIssued=false` a přesný handoff
`SEPARATE_OPERATOR_PROOF_COMMIT_REQUIRED`. PASS proof smí vzniknout pouze v
odděleném operator-only issueru po durable artifact storage a terminálním
rechecku. Migrace 062 už implementuje immutable companion ledger, transakční
proof vazbu, historical-proof quarantine a striktní expiry všech čtyř
eligibility triggerů. Issuer zůstává `CHANGES_REQUIRED`: nesmí přijmout
callerem lokalizovaný strukturální receipt, ale musí sám vlastnit parent run a
jeho odvozené expected piny. Skutečný GPU/Ollama běh neproběhl a automatic
activation/restore zůstává vypnutá.

Operátor 2026-08-10 přijal provenance variantu 024/A. Implementace se tím
odemyká po přijetí konsolidačního base, ale proof ještě vydaný není. Digest
váže pouze evidence jednoho běhu ke skutečně pozorovaným modelovým bytes; role
ani produkt nejsou připnuté k jednomu modelu a po rotaci se pro nový artefakt
vydá nový proof.
