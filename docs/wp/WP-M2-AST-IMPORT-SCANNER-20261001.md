# WP — AST kontrola skutečných závislostí M2 CODE

**Stav:** `DRAFT / IMPLEMENTATION_NOT_STARTED / CPU_NOT_RUN`.
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

Dosud nebyly přidány dependencies, změněn produktový scanner ani spuštěny
nové testy tohoto WP. Parser návrh není proof obecných capability hranic,
modelové kvality, release ani přijetí TS/TSX podpory.
