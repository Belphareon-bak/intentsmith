# 019 — L0-8 registrační hranice je strict injection, ne veřejné SDK

- **typ:** BLOCK — výklad L0 invariantu
- **stav rozhodnutí:** PŘIJATO OPERÁTOREM 2026-08-09; přijetí potvrzeno
  2026-08-21 a teprve tehdy zapsáno do `CONTRACT.md §9` a `SYSTEM-MAP.md`.
  Do té doby byl tento soubor neverzovaný a šest zadání v `docs/wp/` z něj
  odvozovalo autoritu, kterou committed dokumenty nepotvrzovaly
- **stav implementace:** NEIMPLEMENTOVÁNO
- **WP:** `WP-M3-BOUNDARY` (implementace hranice) · předsunutý enforcement
  vlastní rozšířený boundary ratchet
- **rail:** R3 z [`2026-08-08-MODULE-INDEPENDENCE.md`](../review/2026-08-08-MODULE-INDEPENDENCE.md) §6
- **evidence:** [`2026-08-07-L0-8-BOUNDARY.md`](../review/2026-08-07-L0-8-BOUNDARY.md)
  — import graph, oba prototypy postavené a spuštěné, srovnávací tabulka
- **uzavírá:** řádek „Strict injection versus veřejná extension boundary pro
  L0-8" v `ROADMAP.md §14` a `CARRIED_BLOCKER` v `ROADMAP.md §5`

## Rozhodnutí

**Varianta A — strict injection.** Base class a každý další symbol registrační
hranice přichází balíčku z runtime kontextu při registraci. Balíček neimportuje
z `src/**` nic a veřejné npm SDK nevzniká.

Konkrétně pro dnešní jediné porušení: `ToolAdapter` se doplní do `ctx`
v `src/specialists/specialist-loader.js` a `specialists/accountant-cz/adapters.js`
se obalí factory funkcí, protože `class X extends Injected` nelze na modulové
úrovni. Cena je ~25 řádků ve dvou souborech balíčku a jeden řádek v core;
prototyp A vrátil identický výsledek jako baseline včetně negativní clarify
cesty.

## Proč A, když sonda ukazovala B jako levnější

Sonda měřila 2026-08-07 a tehdy platila výtka, že varianta A má **implicitní,
neverzovatelný kontrakt** — `ctx.ToolAdapter` nemá verzi a balíček nemá jak
vyjádřit, jakou podobu hranice potřebuje. To byla nejsilnější námitka proti A
a je vyřešená dvěma rozhodnutími, která vznikla až *po* sondě:

1. **R3 to říká sám.** Navržené znění R3 zní *„veřejný kontrakt jen pro povrch
   jádra a extension manifest; interní repository jsou privátní detail modulu
   **injektovaný z composition rootu**"*. To je doslova varianta A. B by naopak
   povýšila interní base class na veřejný distribuovaný artefakt.
2. **R8 (PŘIJATO 2026-08-08) dodává A chybějící verzi.** Manifest odpojitelného
   modulu deklaruje `coreContract` rozsah a `requiredCapabilities`
   ([§6.2](../review/2026-08-08-MODULE-INDEPENDENCE.md)). Verzovaným povrchem
   se tedy stává `ExtensionManifest/Context`, ne npm balíček — a `ToolAdapter`
   se z implicitního pole `ctx` stává deklarovanou capability, kterou loader
   ověří fail-closed. Kontrakt je verzovaný, aniž by vznikl balíček s vlastním
   semver závazkem vůči třetím stranám.

Varianta B navíc otevírá instalační strom (`npm ci`, lockfile, workspaces),
což je scope `WP-M5-PACKAGE`, a zakládá trvalý údržbový závazek dřív, než
existuje jediný cizí konzument. Sonda to pojmenovala přesně: **A je uzavření
dnešního porušení, B je založení kontraktu.** Kontrakt se zakládá v kroku G
jako `ExtensionManifest/Context`, ne předem jako npm balíček.

## Co tím rozhodnuté není

- **`L8-3` — pět nástrojů existuje dvakrát bajtově identicky**
  (`src/expertises/tools/**` a `specialists/accountant-cz/tools/**`).
  Disposition `RETAIN` / `RETIRE` zůstává otevřená. Varianta A duplicitu
  neruší ani neprohlubuje.
- **`L8-4` — core kopie `src/expertises/tools/**` nemá v `src/**` konzumenta.**
  Drží ji naživu jen testy. Souvisí s R1 (expertises jsou odpojitelný modul)
  a patří do kroku G.
- **Rozsah hranice.** Toto rozhodnutí říká *jak* symbol přejde hranici, ne
  *které* symboly na ní budou. Ty určí `ExtensionManifest/Context` v kroku G.

## Otevřená podotázka — JSDoc typové odkazy

Sonda ji pojmenovala a mění rozsah varianty A: tři výskyty tvaru
`@param {import('../../src/...')}` doslovné znění L0-8 porušují, runtime
hranici ne.

**Navržená odpověď k potvrzení:** JSDoc typový odkaz **není** porušení L0-8,
protože invariant chrání runtime soběstačnost balíčku, ne typovou dokumentaci.
Vynucení se proto váže na vykonávané importy. Šev: je to jeden regex
v checkeru; přepnutí na přísnější výklad znamená změnu vzoru a doplnění tří
JSDoc odkazů do allowlistu, nic víc.

## Enforcement — dnes L0-8 nehlídá nic

Toto je nejdůležitější důsledek rozhodnutí a nesouvisí s volbou varianty.
Porušení je dnes neviditelné pro **oba** existující mechanismy:

| Mechanismus | Proč porušení nevidí |
|---|---|
| Kontrola v `specialist-loader.js:521-531` | Čte jen `manifest.entry`, tedy `index.js`. Skutečné porušení je v `adapters.js`. Vzor `from\s+` navíc nechytá JSDoc tvar. Loader dnes vypíše **nula varování** (nález `L8-2`) |
| Boundary ratchet | `scripts/module-graph.mjs:49` řadí `specialists` mezi `EXTERNAL_DIRS`; `scripts/module-boundary-ratchet.mjs:34` přijímá jen cesty `^src/**`. Hrana `specialists/** → src/**` **není v grafu** |
| `tests/accountant-self-contained.test.js` | Navzdory názvu testuje registraci přes `ctx`, ne import hranici |

Rozhodnutí bez vynucení by tedy porušení jen přejmenovalo. Součástí přijetí je
proto **druhé pravidlo v ratchetu**: hrana `specialists/** → src/**` je
zakázaná, se současným jediným porušením zapsaným jako přesná `from → to`
položka s vlastníkem a expirací na implementaci A. Ratchet zůstává směrově
slepý uvnitř `src/**`; tohle je samostatné, L0-8 přímo odvozené pravidlo,
které přijatou cestovou mapu `core / optional` nepotřebuje.

## Model paralelní práce

Podle `CONTRACT.md §6` (dvě úrovně vlastnictví) a
[`2026-08-08-PARALLEL-PILOT.md`](../review/2026-08-08-PARALLEL-PILOT.md).
Projektový strop jsou tři zapisující WP; M1 drží jeden.

| Stopa | Vlastněné cesty | Souběh s M1 |
|---|---|---|
| **L0-8 enforcement** — druhé pravidlo ratchetu | `scripts/module-boundary-ratchet.mjs`, `tests/fixtures/module-boundary/**`, `tests/module-boundary-ratchet.test.js`, jeden záznam v `tests/registry.json` | ano — nesahá na `src/**`, bez GPU, Ollamy a sítě; přesně profil, který technicky prošel v prvním pilotu |
| **A implementace** | `specialists/accountant-cz/{adapters,index}.js`, `src/specialists/specialist-loader.js`, `src/expertises/tool-adapter.js` + oprava `L8-2` | ano — disjunktní vůči M1 cestám (chat, model binding, studio, `src/db/migrations/**`); nemění žádný M1 connector |
| **A2 směrové pravidlo `core → optional`** | ratchet + cestová mapa | až po file-level cestové mapě; ta je read-only derivace z už změřeného grafu, ne nové rozhodnutí |
| **G — plné `WP-M3-BOUNDARY`** | `ExtensionManifest/Context`, vytažení expertises, rozetnutí chat SCC | **ne** — vede přes 21modulový chat SCC, který vlastní M1 |

Podmínka před založením dalšího worktree je nezměněná
([`PARALLEL-PILOT` §2](../review/2026-08-08-PARALLEL-PILOT.md), vstupní
podmínka 1): skutečně čistý `git status`, ne jen čisté tracked cesty, a kořen
efemérního worktree na disku, ne v `/tmp`.

## Cena přepnutí, kdyby operátor rozhodl jinak

Přechod A → B je jeden řádek v `adapters.js`, re-export v
`src/expertises/tool-adapter.js` a nový workspace balíček; factory obal z
varianty A přitom může zůstat, protože injektovaná i importovaná base class
mají shodnou identitu. Přepnutí zpět je symetrické. Ani jeden směr nevyžaduje
migraci dat ani změnu veřejného HTTP/WS povrchu.
