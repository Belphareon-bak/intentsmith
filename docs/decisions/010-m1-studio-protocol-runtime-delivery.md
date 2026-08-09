# 010 — Jak doručit kanonický M1 kontrakt do autoritativního Studio runtime

- **typ:** BLOCK
- **stav rozhodnutí:** A+ SCHVÁLENO; GENERATED PREBUILD CHECKPOINT
  IMPLEMENTOVÁN; CLEAN-CLONE, NEGOTIATED WIRE A BUILT JOURNEY OTEVŘENÉ
- **WP:** WP-M1-STUDIO (jen přesná `CoreEvent` consumer integrace)
- **rail:** R1, R2, R5
- **vzniklo při:** B4 call-graph inventura

## Evidence na stole

B1 vlastní kanonický JavaScript kontrakt v `contracts/m1/**` a TypeScript mirror
v `c3-ide/extensions/c3-protocol/src/m1.ts`. Produkční balíček
`@c3/protocol` ale načítá commitnutý `lib/index.js`, který je stale stub;
`lib/m1.js` vznikl jen při disposable B1 buildu a nebyl commitnut. B4 allowlist
nepovoluje měnit B1 protocol package ani root Studio build kontrakt.

Autoritativní chat-panel runtime je prostý commitnutý JavaScript v
`c3-chat-panel/lib/**`. Přímý `require('@c3/protocol')` by proto dnes
neposkytl M1 validátory a zelený source test by neprokazoval built runtime.

## Varianty

| Varianta | Chování | Dopad na rails | Cena zavedení |
|---|---|---|---|
| A — protocol build před Studio buildem | Root build nejprve vytvoří runtime `@c3/protocol/lib`, potom Electron bundle | Jedna kanonická autorita, ale mění root build mimo B4 allowlist | `c3-ide/package.json`, protocol build output policy, runner + fresh-clone testy |
| B — dependency-free panel adaptér | Autoritativní `c3-chat-panel/lib` validuje jen svůj consumer seam; Node test jej porovnává s `contracts/m1` | Bez build změny, ale vzniká druhá implementace části kontraktu | 1 runtime modul, `ws-client.js`, Studio client test + drift matrix |
| C — commitnout protocol `lib` | Studio importuje commitnutý build output | Přidává další generated autoritativní plochu vedle panelu | protocol `lib/**`, source/build guards, package + journey testy |
| D — přesnou integraci odložit | B4 zůstane na korelovaném legacy transportu | Nic nepředstírá, ale M1 exit zůstane nedosažený | report + otevřený blocker; bez produktového diffu |

## Vzatý default a proč

Žádný. Výběr A/C mění soubory vlastněné B1 nebo root build scope, B vytváří
novou runtime autoritu a D mění dosažitelný výsledek B4. To nejsou alternativy
uvnitř jednoho předem schváleného švu. Zastavena je pouze přesná M1 terminal
consumer část; scoped legacy cancel a ostatní nezávislé fail-closed opravy B4
pokračují.

## Šev

Po rozhodnutí je jediným spotřebitelem `c3-chat-panel/lib/browser/ws-client.js`.
Varianta B by vložila jeden pojmenovaný modul vedle něj; A/C by zachovaly import
z `@c3/protocol` a změnily pouze delivery před Electron buildem.

## Cena přepnutí, když operátor rozhodne jinak

- A → B: odstranit root prebuild, přidat 1 panel modul a přepsat 1 consumer;
  zachovat společnou negativní matici v `tests/m1-studio-client.test.js`.
- B → A: odstranit 1 panel modul, změnit import v 1 consumeru, doplnit root
  build + fresh-clone guard; přibližně 4 soubory a 2 testovací sady.
- C → A: odstranit trackovaný generated output a změnit source/build guard;
  přibližně 3 policy soubory plus fresh-clone journey.

Žádná varianta nesmí měnit schéma M1 v1 ani oslabit validaci, aby „pasovala“ do
existujícího bundle.

## Rozhodnutí operátora — 2026-08-08: A+

Operátor schválil variantu A s těmito zpřesněními:

- `contracts/m1/**` zůstává sémantickou autoritou;
- `c3-ide/extensions/c3-protocol/src/m1.ts` je TypeScript mirror přijatého
  kontraktu, nikoli archivovaný chat-panel TypeScript;
- současný stale `c3-protocol/lib/index.js` se odstraní z trackingu a celý
  `c3-protocol/lib/**` se stane ignorovaným, reprodukovatelným generated
  outputem, nikoli další ručně udržovanou autoritou;
- kořenový Studio prebuild tento output z TypeScript mirroru vždy znovu vytvoří
  ještě před bundlováním; root build nesmí předpokládat, že generated adresář
  existoval už na vstupu;
- commitnutý `c3-chat-panel/lib/**` zůstává autoritativním Studio runtime a jeho
  build/clean ochrana se nesmí oslabit.

Protocol delivery commit musí z čistého klonu prokázat `clean + build`, runtime
export M1 validátorů, stejnou negativní matici JS/compiled mirroru, zabalení do
product bundle a čistý tracked strom. Build musí selhat, pokud M1 export chybí
**po prebuild kroku**, pokud prebuild selže nebo pokud bundle použije stale
stub. Chybějící generated output **před** prebuildem je naopak očekávaný stav
čistého klonu, nikoli důvod k selhání.

Samotný zelený protocol build **není B4 acceptance**. Následuje explicitně
feature-negotiated M1 wire: klient vytvoří `requestId`, `conversationId` i
`turnId`, server command před efektem validuje a session adapter emituje
monotónní `CoreEvent` se stejnou identitou. Legacy klient zůstává na své
pojmenované cestě.

Autoritativní Studio terminal ledger smí vykreslit assistant pouze po validním
terminálu `ok`. `cancelled`, `timeout` a `error` ukončí spinner bez assistant
zprávy; duplicate, out-of-order, foreign identity, event po terminálu a late
`ok` po cancelu se odmítnou. Negotiated M1 nesmí současně renderovat legacy i
M1 odpověď. Built multi-panel/cancel/provider-failure/reconnect journey je
poslední důkaz tohoto rozhodnutí.

## Generated prebuild checkpoint

Kořenový Studio balíček nyní vlastní pořadí `clean protocol → compile protocol
→ ověř runtime M1 exporty → Electron build`. Ověření po kompilaci fail-closed
vyžaduje verzi 1 a všechny validátory, které potřebuje následný consumer; stale
stub proto nemůže projít jen proto, že soubor `lib/index.js` existuje.

Jediný dříve trackovaný `c3-protocol/lib/index.js` je odstraněný a celý
`c3-protocol/lib/**` je explicitně ignorovaný generated output. Root `clean`
jej odstraňuje, zatímco autoritativní `c3-chat-panel/lib/**` zůstává mimo tuto
operaci a jeho vlastní preserve guard se nemění.

Registrovaná `tests/m1-studio-client.test.js` připíná Git output policy, přesné
pořadí prebuildu, povinné runtime exporty i source re-export. Sada prošla
`57/57`; odstranění runtime verify kroku a odstranění ignore pravidla ji
nezávisle shodily na `56/1`, exit `1`, a obě mutace byly přesně obnovené.

První fresh-clone pokus z `1478cb20` skončil správně fail-closed ještě před
Electron bundlingem: verifier původně vyžadoval tři pojmenované command/result
validátory, které přijatý TypeScript mirror nikdy neexportoval. Verifier byl
opraven na skutečný veřejný mirror povrch — generický dispatcher, stream a
terminal validaci, codec/round-trip a type guard. Schéma ani mirror se kvůli
testu nerozšířily a validace command/result zůstává uvnitř generického
`validateM1Contract()`.

Druhý fresh-clone pokus z `48267f5e` odhalil, že `rimraf lib` ponechal
`tsconfig.tsbuildinfo`. Obyčejné `tsc -b` pak po smazání výstupu nesprávně
vyhodnotilo projekt jako aktuální a nevytvořilo `lib/index.js`; verifier znovu
fail-closed zastavil build s `MODULE_NOT_FOUND`. Root prebuild proto používá
`tsc -b --force` přes workspace script. Chybějící output se vždy znovu vytvoří
bez závislosti na timestamp cache.

Tento checkpoint ještě netvrdí fresh-clone build ani zabalení do Electron
produktu. Následuje čistý klon, frozen install, `clean + build`, runtime
negative matrix a kontrola čistého tracked stromu. Teprve potom pokračuje
feature-negotiated M1 wire a terminal ledger.
