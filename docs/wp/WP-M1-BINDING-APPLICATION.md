# WP-M1-BINDING-APPLICATION — jeden pravdivý manual runtime commit point

**Typ:** zapisující WP · **Slot:** hlavní zapisující vlastník, hlavní checkout
**Stav:** probíhá; checkpoint 1 application-state schema je implementovaný,
runtime application cutover zůstává otevřený
**Závislost:** dokončený `WP-M1-BINDING-REPOSITORY` (`515fb6f7`, evidence
`eb7e78b8`, review closure `1478cb20`)

Toto je zadání, ne PASS evidence. Stav milníku zůstává v `ROADMAP.md §5`.
Otevřené vratné provozní volby jsou shromážděné v
[`018`](../decisions/018-m1-manual-binding-application-policy.md).

## 1. Uživatelský výsledek

Uživatel při apply nebo rollbacku modelu přes HTTP i chat dostane jediný
durable, restart-safe a pravdivý binding přechod. Oba vstupy používají tutéž
application service. Žádná cesta netvrdí verifikaci před skutečnou probe a
`model_changed` emituje commit vrstva, nikoli jednotlivý caller.

Automatický failover zůstává vypnutý.

## 2. Vlastněné a zakázané cesty

**Povolené:**

- nový `src/upgrade/model-binding-application.js` a případný úzký provider
  adaptér vedle něj;
- `src/upgrade/model-failover.js`, `upgrade-manager.js` a jen
  `assignModel()`/initialization seam v `model-registry.js`;
- nová aditivní migrace `050` a migrační validace;
- exact composition/startup seam v `src/server.js`;
- exact apply/rollback handlery v `src/routes/system.js`;
- exact approval větev v `src/chat/handlers/pre-handler.js`;
- vlastní binding-application test, nutné compatibility testy, jeden registry
  záznam a regenerovaný `docs/convergence/TEST-REGISTRY.md`;
- `ROADMAP.md §5`, Finding 008, rozhodnutí 006/018, model execution report a
  relevantní stavový popis v `SYSTEM-MAP.md`.

**Zakázané:**

- proof-policy a measurement moduly/scripty, proof issuance a 015 prahy/TTL;
- auto-failover scheduler, opt-in consumption a automatické
  `ACTIVATE/REAPPLY/RESTORE`;
- model delete/cleanup, online discovery, `src/llm/**`, quality, Studio/WS;
- M1 veřejné contracty, `CONTRACT.md`, `PRODUCT.md`, `DIRECTION.md`;
- nová závislost nebo externí síť.

## 3. Vlastněný connector

Interní `ModelBindingApplicationPort v1`:

- `applyManualBinding()`;
- `rollbackManualBinding()`;
- `rehydrateBindings()`;
- interní zápis výsledku skutečné verifikace.

HTTP/chat dodají pouze uživatelský záměr. Service odvodí actor, request key,
revision, exact/canonical jméno, digest, event/operation identity a čas.
Callerem dodané `appliedBy`, digest, proof, verification status nebo auditní
identita nemají autoritu. Veřejné HTTP shape a WS control action names se
nemění.

## 4. Vstupní revision a závislosti

Vstup je commit tohoto zadání nad čistým hlavním checkoutem. Povinné předchozí
storage/repository invarianty jsou commitnuté a znovu se nestaví. Decision 015
blokuje jen proof/automatic failover, ne manual application.

Implementace má tři malé checkpointy:

1. migrace 050 + terminal repository stav;
2. application service + HTTP/chat/registry/startup cutover;
3. fresh-clone evidence navázaná na přesný produktový commit.

## 5. Malá demonstrace

Nad izolovanou SQLite a test-owned loopback providerem:

1. HTTP apply i chat apply stejného cíle vytvoří stejný durable/runtime/audit
   stav;
2. restart obnoví přesný commitnutý binding;
3. rollback přidá reversal a obnoví předchozí runtime binding bez smazání
   lineage;
4. verification failure zůstane pravdivě viditelný a nevytvoří `verified=1`.

Skutečná Ollama/GPU demonstrace je samostatně `BLOCKED / NOT RUN`.

## 6. Focused pozitivní a negativní test

**Pozitivní:** installed apply přes HTTP i chat, pull/progress parita,
append-only rollback, shodný výsledek obou entrypointů, restart rehydrate,
same-key replay bez druhého runtime/broadcast effectu a skutečná probe jako
jediná cesta k verified.

**Negativní:** caller authority injection; unavailable provider, missing digest,
ambiguous alias a digest drift před commitem; failure injection po každém DB
statementu; transaction failure po dočasné runtime změně; intent/pre-commit/
post-commit-pre-broadcast crash okna; verification failure bez false verified;
broadcast failure bez opakování provider effectu; concurrent CAS loser bez
runtime effectu; nulový proof/failover/scheduler/external-network efekt; static
call graph odmítne produkční direct legacy commit point.

## 7. Stop condition / eskalace

Zastavit jen dotčenou část při potřebě:

- změnit veřejný HTTP/WS/M1 connector;
- zvolit 015 threshold/TTL nebo vydat PASS proof;
- aktivovat automatický failover nebo změnit L0-9;
- přidat závislost;
- tiše přepsat legacy override bez odvoditelné identity;
- sáhnout do cest jiného aktivního writeru.

Nezávislé části pokračují. Defaulty 018 jsou vratné pouze přes pojmenované
funkce; agent si další DECIDE švy nevymýšlí.

## 8. Přesné ověření

```bash
C3_LOG_LEVEL=error node tests/schema-migrations.test.js
C3_LOG_LEVEL=error node tests/m1-model-binding-storage.test.js
C3_LOG_LEVEL=error node tests/m1-model-binding-repository.test.js
C3_LOG_LEVEL=error node tests/m1-model-binding-application.test.js
node tests/upgrade-apply.test.js
node tests/upgrade-ux-v125.test.js
node tests/proposal-stale-cleanup.test.js
node tests/routes-smoke.test.js
node tests/confirmation-ownership.test.js
node scripts/validate-test-registry.js
node tests/artifact-validation.test.js
node tests/repository-hygiene.test.js
git diff --check
```

## Výstup a pravdivé omezení

Navržené commity:

1. `feat(models): add manual binding runtime state`;
2. `fix(models): unify manual binding runtime application`;
3. `docs(models): attest manual binding application`.

Po WP zůstane Gate 1 `BLOCKED` na rozhodnutí 015, proof issueru, automatic
failover coordinatoru/scheduleru a skutečném sériovém GPU běhu. Tento WP má
uzavřít Finding 008 pouze pro manual HTTP/chat provoz.
