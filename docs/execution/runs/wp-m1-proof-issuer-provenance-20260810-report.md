# M1 proof issuer provenance — review evidence

integrationRef: integration/m1-consolidated-20260810
baseRevision: eb93d59bf8e143ee92149f61a8491fb3e26f9835
subjectHead: 60518223e8e86873197c39cc059b0ef673f8f9f0
reviewA.verdict: PASS

## Rozsah

Nezávislé read-only Review A prověřilo operator-only proof issuer nad přesným
promoted integračním základem. Subject přidává privátní parent handoff,
DB-derived durable content-addressed store, companion-first atomický zápis
proofu a focused negativní důkazy. Nemění `src/**`, produkční binding,
scheduler, automatic activation, restore ani provider mutation.

## Jednorázová operátorská výjimka

První Review A správně skončilo `CHANGES_REQUIRED`: subject vedle původního
allowlistu změnil také decision 024, index Work Packages a samotný proof-issuer
WP. V témže rozsahu tím aktivoval WP, doplnil integrační základ, změnil
předběžný allowlist na aktivní, určil první store layout a opravil očekávaný
počet loopback `GET /api/tags` ze dvou na čtyři.

Operátor 2026-08-10 tuto přesnou scope a activation výjimku výslovně přijal
pro tento jediný subject. Nejde o precedent: příští WP musí mít aktivační
commit a contract review před writerem. Immutable subject se po přijetí
výjimky nezměnil; opakovaný metadata gate potvrdil čistý synchronized checkout,
přesný Git základ, absenci tohoto reportu v subjectu, běžné `100644` entries,
žádný delete/rename a žádné rozšíření runtime scope.

## Technické Review A

Všechny uvedené kontroly skončily exit `0`:

- syntax issueru;
- proof issuer: 5 passed, 0 failed;
- parent acceptance: 16 passed, 0 failed;
- proof policy: 9 passed, 0 failed;
- failover schema: 25 passed, 0 failed;
- registry: 379 programů, 8 exclusions, fingerprint
  `df64f6050391a1ea720d660e97fe85c0dc705c31cbc95e248a2a3fa36c5c2ec9`;
- `git diff --check`, DAG, clean-tree a remote-identity kontroly.

Issuer odvozuje artifact root z kanonické file-backed `main` DB, odmítá TEMP a
attached namespace, po terminálním rechecku bez dalšího await provede jediný
`BEGIN IMMEDIATE`, zapisuje companion před proofem a veřejně vrací pouze
`status`, `proofId` a `expiresAtMs`. Exact digest váže jeden proof ke skutečně
změřeným bytes; roli ani produkt nepřipíná k jednomu modelu.

## Zbývající stav

Tento report přijímá source subject do merge queue. Neprokazuje skutečný
GPU/Ollama proof, automatic activation/restore ani Gate 1. Ty zůstávají
samostatnými navazujícími kroky.
candidateHead: 6e04117b9cfff79c52c58ba8b2b3d514be5da8e5
reviewB.verdict: PASS
