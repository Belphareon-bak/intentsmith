# 006 — chatový model cleanup obchází registry mutation guard

- **vlastník:** [`WP-M1-MODEL-CLEANUP-AUTHORITY`](../wp/WP-M1-MODEL-CLEANUP-AUTHORITY.md), checkpoint C1
- **nalezeno v:** `B3-IDENTITY`, read-only trace destruktivních modelových cest
- **stav:** `IMPLEMENTED / M6_RE_REVIEW_REQUIRED`; direct bypass a
  assign/delete race jsou opravené, durable audit doplnila migrace 098
- **závislost:** dokončená kanonická presence identita z `B3-IDENTITY`

## Evidence

Původní call graph vedl z `src/chat/handlers/pre-handler.js:model_cleanup`
přímo na Ollama `DELETE /api/delete`. Stejný provider effect navíc duplikoval
HTTP route fallback. Aktuální source checkpoint nechává jediný produkční
výskyt `/api/delete` v `src/upgrade/model-registry.js`.

Chat už nemá vlastní provider effect. M6 explicitně vyřazuje i jeho
neproveditelný preview/confirmation adapter: `model_cleanup` vrací
`MODEL_CLEANUP_CHAT_RETIRED` bez inventory a bez efektu. Skutečný
`getUnusedOldModels()` zdroj vrací právě `model_overrides.previous_model` a
binding application tuto identitu úmyslně chrání jako one-step rollback.
Registry pod společným
mutation ownerem aplikační binding vrstvy:

1. znovu ověří runtime, durable desired, právě probíhající a one-step rollback
   binding;
2. načte provider inventory a odvodí jediný exact artifact;
3. těsně před efektem načte inventory podruhé a vyžaduje shodné exact name i
   digest;
4. teprve potom provede jeden provider delete.

Negativní interleaving vloží binding přesně při vstupu do mutation owneru a
končí `MODEL_DELETE_BOUND` s nulovým inventory i delete efektem. Samostatný
test drží delete reservation otevřenou a souběžný apply končí typovaným
`MODEL_BINDING_APPLICATION_BUSY` před providerem, runtime i DB zápisem.

## Dopad

Assign/rollback versus delete jsou centralizované a chatový direct bypass je
odstraněný. Decision 037 konflikt uzavírá retirementem chat surface a migrace
098 přidává durable cross-process claims i append-only provider receipt. Širší
model-use hranice a její aktuální důkaz jsou v
[`010-model-delete-use-and-audit-boundary.md`](010-model-delete-use-and-audit-boundary.md).

## Minimální reprodukce

```bash
rg -n "getUnusedOldModels|/api/delete|model_cleanup" \
  src/chat/handlers/pre-handler.js src/upgrade/upgrade-manager.js \
  src/upgrade/model-registry.js
```

## Splněná část acceptance

- HTTP i scheduler používají jedinou registry mutation cestu a chat nemá
  vlastní provider effect;
- reálný post-apply chat kandidát zůstává rollback protected a chat cleanup je
  explicitně retired bez preview nebo provider efektu;
- assign/rollback/delete sdílejí jeden fail-fast mutation owner;
- provider effect zachovává exact name; očekávaný digest se kontroluje dvakrát
  před efektem a canonical key slouží pouze k bezpečnostnímu porovnání;
- veřejné HTTP a WS tvary zůstaly kompatibilní.

## Hranice remediation

Artifact authority netvrdí globální GPU residency mezi gateway a media
runtime. Nejednoznačný delete se také bez provider-side operation ID
automaticky neuvolňuje; durable orphan zůstává fail-closed operátorský stav.
