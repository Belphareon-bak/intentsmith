# 010 — delete autorita zatím nekryje aktivní použití ani durable audit

- **vlastník:** navazující checkpoint
  `WP-M1-MODEL-CLEANUP-AUTHORITY / C2–C3`
- **nalezeno v:** read-only call-graph review cleanup authority
- **stav:** `PENDING-OWNER`
- **dopad:** M1 cleanup checkpoint je bezpečnější, L0-11 zůstává `PARTIAL`

## Evidence

Aktuální cleanup checkpoint centralizuje jediný Ollama `DELETE /api/delete`,
serializuje jej s apply/rollback/rehydrate a chrání runtime, durable desired,
pending i one-step rollback identitu. Toto je procesní mutation authority,
nikoli důkaz, že model právě nepoužívá jiný provider consumer.

Skutečný call graph má model-use efekty nejméně v:

- `src/llm/gateway.js`;
- `src/upgrade/validation-suites.js`;
- vision cestě `src/llm/cre-bridge.js`;
- embeddings v `src/code-intel/semantic-index.js`;
- `src/media/vram-manager.js`;
- exact verify v `src/upgrade/model-binding-application.js`;
- legacy pull/verify v `src/upgrade/upgrade-manager.js`.

Gateway navíc smí použít explicitní ne-bound model. Rebind po zahájení
inference proto sám o sobě nezaručí, že starý model lze bezpečně smazat.

Současný mutation owner je in-memory a chrání jeden serverový proces. Delete
událost má standardní log a best-effort WS broadcast, ale nemá append-only
durable intent/terminal audit. Konfigurovaný provider origin může být mimo
loopback; bezpečnostní disposition destruktivní vzdálené Ollamy není v tomto WP
rozhodnutá.

## Navazující acceptance

1. Jeden neutrální per-canonical-model use port: consumer drží shared lease do
   `finally`, delete získá fail-fast exclusive lease před inventory.
2. Aktivní use vrátí `MODEL_DELETE_IN_USE` bez inventory a delete efektu;
   probíhající delete odmítne nový use před provider requestem.
3. Všech sedm produkčních consumerů je zapojených nebo explicitně vyřazených
   skutečným call graphem; gateway-only oprava se nesmí vydat za celek.
4. Operátor rozhodne, zda M1 garantuje pouze jeden proces, nebo vyžaduje durable
   cross-process claim.
5. Destruktivní intent a terminál dostanou append-only audit dřív, než L0-11
   může přejít z `PARTIAL`.
6. Vzdálený provider delete je do samostatného outbound-authority rozhodnutí
   fail-closed nebo explicitně unsupported; současný checkpoint tuto změnu
   neprovádí potichu.

## Rozhodovací fronta

- single-process lease versus durable cross-process claim;
- samostatná model-delete audit migrace versus společný M2 effect ledger;
- explicitní remote Ollama delete versus loopback-only M1;
- zdroj a explicitní retirement identity starší než one-step rollback;
- doba platnosti chatového preview před jednorázovým potvrzením.
