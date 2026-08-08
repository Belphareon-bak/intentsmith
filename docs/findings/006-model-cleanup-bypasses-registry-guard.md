# 006 — chatový model cleanup obchází registry mutation guard

- **vlastník:** budoucí `WP-M1-MODEL` cleanup-authority checkpoint
- **nalezeno v:** `B3-IDENTITY`, read-only trace destruktivních modelových cest
- **stav:** `PENDING-OWNER`
- **závislost:** dokončená kanonická presence identita z `B3-IDENTITY`

## Evidence

`src/chat/handlers/pre-handler.js:model_cleanup` získá kandidáty přes
`upgradeManager.getUnusedOldModels()`, ale každý model následně smaže vlastním
voláním Ollama `DELETE /api/delete`. Nevolá `ModelRegistry.deleteModel()` a nemá
společné mutation ownership s přiřazením role.

Kanonická identita opravuje dnešní konkrétní chybu `name` versus
`name:latest`: přiřazený alias se už do seznamu unused nedostane. Mezi vytvořením
seznamu a provider efektem ale zůstává závod:

1. model je přečten jako nepřiřazený;
2. uživatel jej mezitím přiřadí roli;
3. starý cleanup seznam jej pošle do Ollama delete.

Pouhé přesměrování na dnešní `ModelRegistry.deleteModel()` by přidalo pozdější
recheck a odstranilo přímý bypass, ale samo o sobě ještě nedokazuje atomickou
serializaci assign versus delete.

## Dopad

`B3-IDENTITY` smí tvrdit, že registry delete a registry auto-cleanup kanonicky
chrání bound i právě validovaný model. Direct system-route fallback a list-time
klasifikace chat cleanupu chrání pouze kanonicky bound model; bez živého
`ModelRegistry` nemají autoritu nad `_validatingModel`. Checkpoint nesmí tvrdit,
že všechny model delete cesty mají atomickou autoritu. Gate 1 zůstává na tomto
širším tvrzení otevřená.

## Minimální reprodukce

```bash
rg -n "getUnusedOldModels|/api/delete|model_cleanup" \
  src/chat/handlers/pre-handler.js src/upgrade/upgrade-manager.js \
  src/upgrade/model-registry.js
```

## Acceptance směr

- chat cleanup používá jedinou registry mutation cestu, ne vlastní `fetch`;
- assign a delete sdílejí mutation ownership nebo binding revision, takže
  přiřazení mezi discovery a delete znamená přesně nula provider delete efektů;
- negativní test vloží přiřazení právě do tohoto interleavingu a ověří nulový
  `/api/delete` call;
- audit zachová přesný provider model name a digest, canonical key slouží jen
  k bezpečnostnímu porovnání.

## Co se v tomto checkpointu neopravuje

`src/chat/handlers/pre-handler.js` není povolená cesta schváleného
`B3-IDENTITY`. Scope se proto nerozšiřuje potichu a současný chatový cleanup se
nevydává za atomicky bezpečný.
