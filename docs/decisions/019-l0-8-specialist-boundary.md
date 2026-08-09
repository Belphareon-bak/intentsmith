# 019 — L0-8 registrační hranice používá strict injection

- **typ:** BLOCK — závazný výklad L0-8
- **stav rozhodnutí:** PŘIJATO OPERÁTOREM 2026-08-09
- **stav implementace:** IMPLEMENTATION_PENDING
- **original evidence revision:** `1fc8f03e649dd561fb279ce68e5c119d35faad55`
- **revalidated source revision:** `0a6bde54e1d2fdf7c284207e9555a0577ce6f6ff`
- **evidence:** [`2026-08-07-L0-8-BOUNDARY`](../review/2026-08-07-L0-8-BOUNDARY.md)
- **uzavírá:** `ROADMAP.md §4` carried blocker a rozhodovací řádek v §14

Odkazovaný prototyp vznikl na original evidence revision; kontraktová dávka
jeho call sites znovu ověřila na požadovaném vstupu `0a6bde54`. Tyto dvě role
SHA se nesmějí zaměnit s pozdějším integračním base.

## Rozhodnutí

Platí **varianta A — strict injection**. Balíček v `specialists/**` nesmí
importovat interní implementaci z `src/**`. Symbol potřebný při registraci
dostane od composition rootu v registračním `ctx`; pro dnešní porušení je tím
symbolem `ToolAdapter`.

Předsunutá oprava pouze doplní `ctx.ToolAdapter` a factory obal accountant
adaptérů. **Nezavádí** manifest, capability negotiation ani verzování. Ty
zůstávají povinnou součástí pozdějšího `WP-M3-BOUNDARY`, kde vznikne verzovaný
`ExtensionManifest/Context`. Veřejné npm SDK se teď nezakládá.

Tento krok je technický prerequisite. Zachování accountant chování samo o sobě
není specialist E2E a nesmí se vykázat jako splnění capability #8.

## Závazný výklad hranice

Zákaz je úmyslně přísný a platí pro celý zdroj balíčku, nejen pro jeho
entrypoint:

- static import a re-export;
- literal `import()` a `require()`;
- JSDoc/type import odkazující do `src/**`;
- nepřímý nebo vypočtený import, pokud nelze před efektem prokázat, že se po
  canonicalizaci drží uvnitř kořene daného specialistického balíčku.

Read/parse failure a neprokazatelný vypočtený cíl jsou fail-closed. Tři dnešní
JSDoc odkazy do `src/**` nejsou trvalá výjimka; injection WP je nahradí lokálními
strukturálními typedefy. Tím zůstává pravidlo jednoduché: `specialists/**`
nepoužívá `src/**` ani pro runtime, ani jako skrytou typovou autoritu.

### Dva existující computed importy

Source strom má dva neliterální call sites:

- `specialists/accountant-cz/index.js` — `import(tool.modulePath)`;
- `specialists/code-reviewer/index.js` — `import(tool.modulePath)`.

Nejsou allowlistované jako slepá výjimka. Přijatý proof mechanismus je úzký
`computed-package-local` tvar: analyzer musí staticky odvodit `toolsDir` jako
`path.join(__dirname, 'tools')`, každý `modulePath` jako
`path.join(toolsDir, '<literal>.js')`, odmítnout jakýkoli caller/manifest/user
input a po `realpath` ověřit existující regular file pod `realpath(package/tools)`
bez symlink escape. Jakákoli změna tohoto tvaru je fail-closed. Checker i loader
preflight mají pozitivní test obou dnešních call sites a negativní mutace
anchoru, neliterálního filename a symlinku.

## Enforcement

L0-8 bude hlídat **samostatný** `scripts/specialist-boundary-ratchet.mjs` s
vlastní baseline a testem. Existující `module-boundary-ratchet.mjs` se
nerozšiřuje.

Odůvodnění je přesné:

- `module-graph.mjs` dnes v `externalIntoSrc` vypíše dva deduplikované páry:
  accountant runtime import a dummy-logger → specialist-runtime. Druhý pár
  vzniká z JSDoc, ale scanner jej nerozliší podle `kind`, slije dva stejné
  occurrences a seed JSDoc pár úplně vynechá;
- stávající ratchet však záměrně validuje interní `graph.edges` omezené na
  `src/**`, pinuje strom `src/**` a vlastní už přijatou interní baseline;
- L0-8 potřebuje jinou množinu, jinou provenance a jiné expirační pravidlo.

Neplatí tedy ani jednoduché tvrzení „hrana v grafu není“, ani „graph vidí právě
runtime hranu“. Diagnostický výstup má dva páry, ale neumí autoritativně
reprezentovat skutečné čtyři occurrences ani jejich `runtime|jsdoc` kind a
count. Navíc nejsou v ratchetovaném interním poli. Nový checker musí nezávisle
odvodit všechny čtyři výskyty a zachovat jejich provenance.

Na revalidated source revision existují čtyři přesné odkazy do `src/**`: jeden
runtime import v `accountant-cz/adapters.js` a tři JSDoc type importy v
`accountant-cz/knowledge/seed.js` a `dummy-logger/index.js`. Všechny smějí být
dočasně připnuté pouze jako exact `from -> to` položky s vlastníkem
`WP-M3-L0-8-INJECTION` a expirací při jeho integraci. Široká adresářová výjimka
je zakázaná.

## Pořadí integrace

1. Integrovat `WP-M3-L0-8-ENFORCEMENT` a na integračním SHA prokázat, že
   zachytí existující čtyři odkazy i negativní fixture.
2. Teprve potom přijmout `WP-M3-L0-8-INJECTION`.
3. Integrátor odstraní dočasné baseline položky, přijme jedinou deklarovanou
   interní hranu
   `src/specialists/specialist-loader.js -> src/expertises/tool-adapter.js`
   a spustí oba ratchety na výsledném merge SHA.

Vývoj injection větve lze připravovat jen tehdy, pokud projektová kapacita a
vlastnictví opravdu dovolují souběh; její **akceptace a integrace** mají tvrdou
závislost na enforcementu. Nejkratší bezpečný plán je proto sériový.

## Povinná oprava L8-2

Současný loader kontroluje pouze `manifest.entry` až po dynamickém importu.
Injection WP musí provést rekurzivní, fail-closed kontrolu všech spustitelných
JS souborů balíčku **před prvním importem nebo `register()`**. Negativní test
použije top-level side-effect marker a prokáže, že při porušení nevznikl.

Standalone ratchet je merge rail; loader guard je runtime obrana. Ani jeden se
nesmí vydávat za náhradu druhého.

## Co rozhodnutí neřeší

- duplicitu pěti nástrojů mezi core a accountant balíčkem (`L8-3`);
- core kopii `src/expertises/tools/**` bez runtime konzumenta (`L8-4`);
- konečný seznam a verze capabilities v `ExtensionManifest/Context`;
- plný enable → route → output → disable specialist E2E.

Tyto body zůstávají v `WP-M3-BOUNDARY`; nesmějí rozšířit předsunuté WP.

## Branch a checkout model

`0a6bde54` je **revalidated source revision**, nikoli povinný checkout base.
Každý writer větví z čistého, reviewnutého integračního checkpointu, který už
obsahuje toto rozhodnutí a jeho WP, a pracuje ve vlastním disk-backed worktree.
Jeden checkout má právě jednoho writera; branches a worktrees jsou standardní
mechanismus paralelní práce, nikoli výjimka.
