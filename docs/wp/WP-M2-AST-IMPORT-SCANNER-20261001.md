# WP — AST kontrola skutečných závislostí M2 CODE

**Stav:** `CPU_PREPARATION_PASS / IMPLEMENTATION_DEFERRED_CONTEXT_PRIORITY`.
**Vlastník:** ROOT; navazující nechatový milník na publikovaném
`79b201c8b484a7c8a21225945f51b9dba21d47dc`. Tento návrh neodblokuje
aktuální fyzickou kvalifikaci a nemění zmrazený SQLite source34.
**Autorita:** operátorské dokončení IDE/backendu a skutečné ověření různých
projektů; produktová kontrola architektury M2 dle `CONTRACT.md` §4, §6, §10.
Jde o opravu vyhodnocení existující policy, nikoli nové síťové oprávnění.

## Doložená mezera

`src/lifecycle/m2-governance-evaluator.js:178` provádí regexové hledání a
následně označí samotné slovo `import` nebo `require` ve zbytku textu za
nepodporovanou syntaxi. Skutečný SQLite CPU běh měl 17 governance denials
kvůli komentáři a textu chyby trusted oracle. Tyto FAIL zůstávají v SQLite
WP. Neutralizace textu konkrétního testu tuto obecnou produktovou mezeru
neopravila. Scanner také nedekóduje ECMAScript escape sekvence a deklaruje
TS/TSX bez odpovídající syntaxové analýzy.

Existující root lock má `tree-sitter@0.21.1` a JS/JSX grammar
`tree-sitter-javascript@0.21.4`, nemá TS/TSX parser. Kandidátní
[oficiální TypeScript grammar v0.23.2](https://github.com/tree-sitter/tree-sitter-typescript/blob/v0.23.2/package.json)
uvádí peer `tree-sitter ^0.21.0`, ale kompatibilita přesného native artefaktu
s Node 24/ABI137 a náklady na závislosti jsou **UNVERIFIED**. Verze se
nezaměňuje za úspěšný integrační důkaz.

## Omezený rozsah a invarianty

Po uzavření současné fyzické kvalifikace použít existující owned checkout,
WP-first commit, red regresi a přesné parser dependency/lock změny pouze
pokud izolovaná CPU kontrola potvrdí kompatibilitu. Scope: evaluator, malý
helper a existující governance/actual-M2 testy; související registry/census
se přeměří. CHAT, instrukce modelu, project app oracles, M1, sandbox profil,
policy allowlist/resolver, canonical digests, v1 wire a produkční DB/vazby
zůstávají mimo scope.

1. Pro `.js/.cjs/.mjs/.jsx` použít skutečnou JS/JSX gramatiku; pro `.ts/.tsx`
   skutečnou typed gramatiku. Komentáře, řetězce, regex a JSX text jsou data.
2. Bez evaluace dekódovat skutečné string literals a získat static imports,
   reexports, typed imports, TS import-equals, přímý literal `require()` a
   literal `import()`. Obecná současná M2 policy literal dynamic import
   automaticky nezakazuje; SQLite specifický zákaz je samostatná kontrola.
3. Computed nebo nerozpoznaný loader výraz se nesmí tiše vynechat. Require
   alias, `createRequire`, členy a lokální shadowing vyžadují explicitní
   lexical binding kontrolu nebo typed UNAVAILABLE. Komentář nemůže sloužit
   jako zákaz ani jako obejití. Specifiers jsou dekódované, UTF-8 sorted unique.
4. Syntax error, chybějící/incompatible grammar, překročený parser budget
   či nepodporovaný loader musí skončit UNAVAILABLE před efektem. Žádný regex
   fallback. Parser nespouští projektové moduly ani jejich importy.
5. Resource mez je nutné odvodit i pro celé baseline overlay, nikoli jen
   změněných 1 MiB/file a 8 MiB total-after. Ověřit velký/deep/mnohasouborový
   vstup, parser reset po timeoutu a crash containment. Přesný mechanizmus
   budget/containment se musí doložit před source REVIEW_PASS; aktuálně
   **DESIGN_OPEN**. Časy se nepřidávají do canonical decision digests.

## Předem připravená přejímka

- Red důkaz skutečného evaluatoru pro SQLite oracle komentář/chybovou zprávu.
- Pozitiva inertních tokenů a validní syntaxe všech šesti deklarovaných přípon;
  literální moduly s escaped specifiers, namespace a annotated reexports.
- Negativa chybné vrstvy, undeclared builtin, unresolved module, syntax errors,
  computed/alias/value/member loader, shadowing, missing grammar a budget.
- Stejný vstup má stejný sorted finding a canonical digest. Dosavadní test
  reexportu s komentářem se má vyhodnotit přes skutečnou dependency/layer policy.
- Existující governance contract/evaluator/lifecycle sady; jeden skutečný M2
  pozitivní návrh s inertními tokeny a rollback/durable failed negativy.
- Nezávislé source/adversarial review, dotčený registrovaný integrační gate,
  push exact SHA, skutečné GitHub CI. Teprve potom další fyzický CODE kandidát.

Parser návrh není proof obecných capability hranic, modelové kvality,
release ani přijetí TS/TSX podpory.

## Navazující vlastnictví a rozhodnutí — 2. 10. 2026

Autorita opravy je původní požadavek dokončit skutečné projekty a doložená
regrese existující M2 policy. Operátor autorizoval veškeré běžné dokončovací
práce; nevzniká nová otázka na stejné oprávnění. Použije se owned checkout
`work/real-chat-journeys-20260930` po SQLite `f5964604`; žádný nový worktree.
Ověřený GitHub main `838b8cee038db027691072d293eb00153854f81e` zůstává
integrační referencí, cizí běžící checkout se nepřepíná.

ROOT vlastní connector a integraci. Delegovaný scanner worker vlastní
`src/lifecycle/m2-import-scanner.js` (trusted adapter/worker a privátně
označené immutable pozorování), `src/lifecycle/m2-governance-ast-adapter.js`,
`src/lifecycle/m2-governance-evaluator.js` a existující
`tests/m2-governance-evaluator.test.js`. ROOT vlastní navázaný
`src/lifecycle/m2-lifecycle-application-service.js`, existující skutečné M2
integrační testy, přesnou dependency/lock změnu, registraci potřebných helperů,
census a tento WP. Ostatní cesty vyžadují výslovné zaznamenání před editací.
SQLite raw packet, modelové zdroje, oracles a původní příklady se nemění.

Volba: **async trusted AST adapter před synchronním čistým evaluatorem**.
Service čeká na parser, před registrací opět ověří cancellation. Adapter
sám připraví immutable úplný validovaný source overlay před prvním await;
caller mu nedodává autoritativní
výsledek parseru. Native parser se načte pouze v jeho vlastním child procesu.
Evaluator nepřistupuje k FS/procesům/DB/síti/času a nepoužívá regex fallback.
Ověří privátní původ observation, ordered source set, každé úplné bytes/SHA,
request/policy/baseline vazby a přesné parser identity. Chybějící, zkopírované,
JSON nebo zastaralé observation skončí UNAVAILABLE. V1 wire a canonical
decision shapes se nemění; do digestu nevstupuje naměřený čas.

CPU experiment v ignorovaném
`.intentsmith-artifacts/m2-ast-cpu-preparation-20261002-0752` ověřil přesný
Node24/ABI137 runtime0.21.1, JS grammar0.21.4 a TypeScript grammar0.23.2.
Root JS pin zůstane stejný; TS závislost může mít oddělenou nested JS verzi.
Nativní `parse(string)` na tomto artefaktu selhává nad přibližně 32 Ki
UTF-16 i bez timeoutu. Bezztrátový bounded callback po 4 Ki UTF-16 problém
odstraňuje; chunk boundary/Unicode se zvlášť ověří. Nesmí se označit jako
modelový overflow ani se řešit zkrácením zdrojů.

Containment: celkem nejvýše 10 000 baseline entries /8 MiB baseline a 8 MiB
after bytes, pevná mez jednotlivého souboru, zvláštní mez encoded IPC input
a 2 MiB output. Jeden native child na proces, bez neomezené fronty;
souběh nad mez má explicitní RESOURCE_BUSY. Child má 2 GiB address-space,
128 MiB V8 heap, 5 s CPU,
10 s wall timeout a core dump0. Limit 512 MiB AS se odmítá jako neproveditelný
pro start Node24; požadavek na reálné omezení tím nezaniká. Předem abortovaný
call nespustí dítě; abort/timeout/crash drénuje a ukončí pouze vlastní proces.
Chybná syntaxe, unsupported loader, missing/incompatible grammar, rozpočet,
crash či neplatná reply má konkrétní typed UNAVAILABLE před efektem.
Po await musí service ověřit signal před governance denial i znovu před
durable registrací; cancellation nesmí změnit klasifikaci na POLICY denial.

Nezávislé read-only design review podporuje tuto architekturu, nikoli dosud
nepředloženou implementaci. Receipt SHA
`646c6b28d902e9a9708dd4b7a83573e05422540567b10d90c1100b9414eb4d07`,
DESIGN_SUPPORTED_IMPLEMENTATION_REVIEW_REQUIRED. Nález validního Unicode
identifier escape s více úvodními nulami se musí opravit, ne obejít zákazem
escapů. Běžné named imports z `node:module` se odliší od nepodporované
createRequire factory/namespace/default vazby. Každé omezení dostane
konkrétní chybu a regresi; blanket zákaz celého deklarovaného modulu se
nepovažuje za dokončené rozpoznávání závislostí.

Dosud jsou změny pouze privátní CPU příprava, nikoli produktová implementace
nebo source REVIEW_PASS. Před změnou trackovaných zdrojů se publikuje tento
WP-first rozsah; poté red regrese, implementace, nezávislé adversarial review
a dotčené skutečné M2/registrované brány. Finální zdrojová přejímka musí
ověřit navržené meze a produkční call graph, nikoli pouze parser fixture.


## Změna pořadí podle revize operátora — 2. 10. 2026

Kontextová strategie větších projektů má přednost před touto implementací.
80 CPU kontrol a 7 containment kontrol zůstává privátně zapečetěných;
manifest `162b71bc8070466b9d7c8a8335753790e4d626b1991ea69cf3f98df7afa13478`.
Delegovaní workeři nezměnili žádný trackovaný zdroj. Čtyři vlastní rozpracované
ROOT soubory (service, package, lock, tento WP) jsou úplně uloženy v ignored
`.intentsmith-artifacts/m2-ast-owned-hold-20261002`; patch SHA
`63447b605b73d3b3967ca588f8acf2f856c5b65d6309570acdebe6941a1decb7`.
Checkout zdrojů obnovený na publikovaný cd3; původní JS/runtime dependencies
nezměněné. Produktový AST scanner dosud není implementovaný ani přijatý.
