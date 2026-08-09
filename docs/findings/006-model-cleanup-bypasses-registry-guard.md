# 006 — chatový model cleanup obchází registry mutation guard

- **vlastník:** [`WP-M1-MODEL-CLEANUP-AUTHORITY`](../wp/WP-M1-MODEL-CLEANUP-AUTHORITY.md), checkpoint C1
- **nalezeno v:** `B3-IDENTITY`, read-only trace destruktivních modelových cest
- **stav:** `PARTIAL_REMEDIATION / FOCUSED_VERIFIED`; direct bypass a
  assign/delete race jsou opravené, durable audit zůstává otevřený
- **závislost:** dokončená kanonická presence identita z `B3-IDENTITY`

## Evidence

Původní call graph vedl z `src/chat/handlers/pre-handler.js:model_cleanup`
přímo na Ollama `DELETE /api/delete`. Stejný provider effect navíc duplikoval
HTTP route fallback. Aktuální source checkpoint nechává jediný produkční
výskyt `/api/delete` v `src/upgrade/model-registry.js`.

Chat už nemá vlastní provider effect. Jeho interní adapter umí přijmout exact
registry plan a jednorázově spotřebovat potvrzení, ale skutečný
`getUnusedOldModels()` zdroj vrací právě `model_overrides.previous_model`.
Binding application tuto identitu úmyslně chrání jako one-step rollback. C1 ji
proto odmítne ještě před inventory a netvrdí, že chatový delete journey je
dosažitelný bez explicitního retirement pravidla. Registry pod společným
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
odstraněný. Finding zůstává `PARTIAL`, protože chatový candidate/rollback
konflikt potřebuje retirement rozhodnutí a destruktivní receipt nemá durable
auditní stopu. Gate 1 navíc zůstává otevřený
na širší model-use
hranici: probíhající inference, vision, embedding a VRAM consumer zatím nesdílí
per-model use reservation s deletem. Tento odlišný residual je v
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
- reálný post-apply chat kandidát je před inventory odmítnut jako rollback
  protected; adapter-only single-use preview test se nevydává za runtime E2E;
- assign/rollback/delete sdílejí jeden fail-fast mutation owner;
- provider effect zachovává exact name; očekávaný digest se kontroluje dvakrát
  před efektem a canonical key slouží pouze k bezpečnostnímu porovnání;
- veřejné HTTP a WS tvary zůstaly kompatibilní.

## Co uzavřená část findingu netvrdí

Checkpoint netvrdí atomickou ochranu proti concurrent provider pull po druhém
inventory snapshotu, aktivní inference ani durable cross-process delete claim a
nezapisuje trvalý delete audit. Tyto vlastnosti jsou explicitně
oddělené ve findingu 010. Stejně tak zatím neurčuje, kdy lze one-step rollback
identitu retireovat; L0-11 proto zůstává `PARTIAL`.
