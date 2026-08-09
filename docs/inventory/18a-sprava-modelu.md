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

Call graph má nadále pět živých cest. Binding cutover/exact verify a VRAM
manager nejsou zatím připojené, durable/cross-process autorita není rozhodnutá
a direct pull stream nemá idle timeout ani recovery. Schopnost #18a proto
zůstává v tomto řezu `PARTIAL`; focused zelená gateway evidence není release
ani L0-11 PASS.
