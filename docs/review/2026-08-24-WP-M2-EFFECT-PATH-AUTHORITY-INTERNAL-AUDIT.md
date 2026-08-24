# M2 section 1 — integrační audit před Opus max review

- **Provenance range:** `44a9ba87c99a448b1b1b5f479963c3b6aaac7e91..7dc6a807d94ee1fc4596abc3dd0233d77d55322d`
- **Auditovaný product head:** `c14d800ee150`
- **Remediation:** `4ddfe56e6ca2ea8e1eed0f60b80f2ab78711d5fe`
- **Výsledek interního auditu:** `3 FINDINGS / CANDIDATE_CLOSED`
- **Nezávislý verdict:** `NOT_AVAILABLE / OPUS_ACCOUNT_LIMIT`

Tento dokument není nezávislé review a nesmí být počítán do `7 OF 7`.

## A1 HIGH — evidence persistence nebyla na produkčním call path terminální

`_persistEffectEvidence` sice vyhodil chybu, ale druhý fix-loop a dead-import
recovery běžely uvnitř best-effort semantic `try/catch`; catch chybu zalogoval
a pokračoval. Unit test původně volal jen helper, nikoli policy wrapper.

Oprava na `src/planner/lifecycle-build.js:796-798,1797-1818` dává storage chybě
typ `EFFECT_EVIDENCE_PERSISTENCE_FAILED` a wrapper ji znovu vyhodí. Test
ověřuje stejnou error instanci i původní `SQLITE_READONLY` cause.

## A2 MEDIUM — dead-import četl metadata mimo root

Import například `../../outside-import.js` se převáděl na absolutní candidate a
volal přímo `statSync`. Obsah se nečetl ani nezapisoval, ale existence vnějšího
souboru ovlivňovala recovery a porušovala deklarovanou read boundary.

Oprava na `src/planner/lifecycle-build.js:1860-1875,2055-2066` odmítne candidate
lexikálně před I/O a následně použije sdílenou canonical path authority.
Injektovaný čítač dokládá nula outside `statSync` a byte-identický sentinel.

## A3 HIGH — post-rename chyba tvrdila nulový efekt

`writeProjectFileAtomic` správně rozlišuje selhání directory fsync po rename
jako `effectApplied:true`, ale patch engine je mapoval na `write_failed` a
`written:false`; backup pouze odstranil. Reprodukce ukázala nové bajty na
disku vedle tvrzení o nulovém zápisu.

Oprava na `src/patch/patch-engine.js:62-79,145-202,300-329,420-449` vrací
`write_durability_unconfirmed`, přizná efekt, provede kompenzaci a zachová
`compensated/orphaned`. `src/executor/execution-loop.js:864-904` přenese
orphan terminal a lifecycle jej uloží do `EFFECT_AUTHORITY` drift evidence.

## Ověření

- patch engine `72/72`;
- execution loop `61/61`;
- lifecycle BUILD `114/114`;
- lifecycle DB `71/71`;
- artifact validation `154/154`;
- module boundary ratchet `13/13`;
- registry `428`, fingerprint
  `54dce9be3a18ef854097c5919d1471e53f38bf6ef0e828ecc5ff0438f9e302d2`.

Clean deterministic report
`.intentsmith-artifacts/test-runs/2026-08-24T10-38-56-185Z/report.json` je
source-bound na `4ddfe56e`, SHA-256
`458b3aa1a91f84020c57ef4235f15fe6adad7043c160a6ac51915d8cccb5127f`.
Jeho přesný výsledek je `verdict: FAIL`, `exitCode: 1`,
`260 PASS / 3 známé FAIL / 2 známé BLOCKED`; žádná M2 suite není non-PASS.

## Opus pokus

Exact lokální příkaz použil `claude --print --model opus --effort max
--permission-mode plan --no-session-persistence` a celý section-1 prompt.
CLI skončilo před modelovým výstupem hláškou o měsíčním spend limitu. Nevznikl
názor, nález ani verdict; jediný pravdivý stav je
`REVIEW_BLOCKED_ACCOUNT_LIMIT`.
