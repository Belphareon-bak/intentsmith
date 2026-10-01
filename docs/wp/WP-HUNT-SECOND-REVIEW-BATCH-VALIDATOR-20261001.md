# WP — Strukturální kontrola dávkového druhého posudku Huntu

**Stav:** izolovaný implementační kandidát, `REVIEW_PENDING`. Nejde o přijetí
hodnotitele, akceptaci modelu ani povolení aktivace. Vstupní čistý integrační
commit: `20792e81146bd36ccc2cc0a1447c4fb15b5f3095`; vlastní větev:
`work/hunt-second-review-validator-20261001`.

## Autorita a rozsah

Operátor 2026-10-01 požádal o postupné dokončení a ověření Huntu. Podle
`DIRECTION.md` musí sémantické role posoudit nezávislí kvalifikovaní hodnotitelé.
`docs/wp/WP-GPU-HUNT-EVALUATION-CONTRACT-20260918.md` odděluje známé vývojové
odpovědi od přejímky hodnotitele a nového holdoutu. Read-only checkpoint
`docs/MODEL-SCORING-ACTIVATION.md` uvádí 596 ze 1 173 odpovědí druhého
posudku, zatím bez validace celé dávkové evidence. Přímý příkaz operátora
vyžádal reprodukovatelný JSON seznam mezer; toto WP pokrývá pouze tento krok.

Původní `scripts/verify-hunt-blind-review.mjs` ověřuje kompletní posudek
v exportním formátu, nikoli částečné soubory `chat-###`, `code-###`, `dr-###`.
`scripts/manual/build-hunt-dr-development-triage.py` míří na jiný 312-case
packet a JSONL. Nový `scripts/verify-hunt-second-review-batches.mjs` čte
aktuální packet, 106 dávkových JSONů, revize a dvě veřejné politiky.
Nečte `restricted/`, nespouští model/GPU ani externího hodnotitele a
nepřipojuje se k DB nebo síti. Výstup je pouze JSON na stdout; vstupní
soubory zůstávají beze změny.

## Ověřené invarianty

- Povinný očekávaný SHA-256 zamyká přesné bytes `packet.json`. Samostatně
  se ověří deklarovaný hash sdíleného CHAT kontextu, CODE politiky a
  kanonické rubrikové politiky. Report uchová SHA každého dávkového souboru
  i revizí.
- Každá známka používá jedinečný `idx` v packetu. Existující `id` musí
  přesně souhlasit; u D/R dávky bez `id` se identita odvodí pouze z
  `packet.cases[idx].id`. Ověří se role vůči typu dávky, task, anonymní
  label, případně repeat a úplná sada klíčů kritérií podle rubriky.
  Každé kritérium musí mít přípustné skóre, neprázdný důvod a citaci.
  CODE se kontroluje na vlastní setiny, komponenty z 24 bodů a snap;
  CHAT/D/R na čtvrtiny. Odůvodněný `TASK_ISSUE` zůstává neohodnocený.
- Každá zapsaná revize CHAT odkazuje na existující známku a přesně
  souhlasí s jejím nynějším skóre a důvodem. Historické `old_*` hodnoty
  bez předrevizních raw dávek nelze nezávisle potvrdit; validator to
  nevydává za důkaz jejich původu.
- Chybějící odpovědi jsou explicitní pole `missingCases` s indexem,
  identifikátorem, rolí, úlohou, štítkem a opakováním. `decisionStatus`
  je vždy `NO_DECISION`, `decisionAuthority:false`, `acceptedGrader:false`.
  Ani úplné budoucí pokrytí samo nezmění tento status.

## Reprodukovatelný checkpoint

```bash
node scripts/verify-hunt-second-review-batches.mjs \
  --packet=/mnt/vi7000/intentsmith/evidence/hunt-matrix-completion-20260928/matrix/second-review/packet.json \
  --grades-dir=/mnt/vi7000/intentsmith/evidence/hunt-matrix-completion-20260928/matrix/second-review/grades-sonnet-5-5 \
  --expected-packet-sha256=08d0ab7e92dc324d2a8e9e210d7b32525167b8eb7db2810b7fed55f31e7d4726 \
  > /private/path/report.json
```

Strukturální výsledek: `DEVELOPMENT_REVIEW_INCOMPLETE / NO_DECISION`;
596/1 173 odpovědí, 2 324/3 689 kritérií; přesně 577 chybějících
odpovědí a 1 365 kritérií. Role: CHAT 400/400, CODE 30/30, D1 166/180,
D2 0/189, R1 0/179, R2 0/195. Validátor odvodil 166 chybějících D/R ID
z packetu; validoval 106 dávek a 34 revizí CHAT (13 změn skóre).
Privátní reprodukovaný report je
`.intentsmith-artifacts/hunt-second-review-validator-20261001/report.json`
(SHA-256 `53ff3c71291641f3255943f45060225417049d9a9ed93154861bf5b73d0b7b46`,
mode 0600). Do Gitu se jeho anonymní indexový obsah neukládá.

Testy `tests/verify-hunt-blind-review.test.mjs` používají malý vlastní
packet a ověřují úspěšný dílčí report i negativní mutace hashů, duplicit,
cizího indexu, ID, tasku, rubriky, citace a revize. Počáteční běh před
přidáním validátoru skončil `ERR_MODULE_NOT_FOUND`; po implementaci
**16/16 PASS**. Opakované skutečné spuštění dalo byte-identický JSON.
Registrovaná sada `IS-T1-TESTS-VERIFY-HUNT-BLIND-REVIEW-TEST` prošla
**1/1 PASS** v izolovaném běhu
`.intentsmith-artifacts/run-suites/2026-10-01T00-40-40-449Z/report.json`
(`gateEvidence:false`); `artifact-validation` prošla **160/160** a registr
je validní s **579** běhovými programy. Tyto běhy nepředstavují nezávislé
review ani produkční GO.

## Hranice přejímky

Kontrola čte text důvodů a citací jen kvůli přítomnosti; neověřuje jejich
věcnou správnost, férovost rubrik, nezávislost hodnotitele, korektnost starých
revizních hodnot ani oprávnění použít packet jako nový holdout. Nevypočítává
role skóre, pořadí modelů nebo binding. Další krok je nezávislé review tohoto
kandidáta a oddělené přijetí politiky hodnotitelů před rozhodovací evaluací.
