# M3 oddíl 7 — response na `CHANGES_REQUESTED`

- **Stav:** `IMPLEMENTATION_GREEN / RE_REVIEW_READY`
- **Původní reviewed HEAD:** `07f2510cb7dc6a07ff7aece7c4d3863a27ca3205`
- **Product fix:** `7708519e7ac8774660ed4098834afbe26c82d1ee`
- **Boundary evidence:** `708086b9840d43bc376823f310b30c95d45bb9ff`
- **Ověřený evidence source:** `abd7c594e0d8afe2433f97470c5185ecf264f727`
- **Re-review range:** `07f2510c..abd7c594`
- **Push:** neproveden

Review správně odmítlo zúžit exit kritérium jen na extension producenty.
Implementovaná je doporučená varianta B: legacy non-extension agent mutační
surface je fail-closed odstavený a jediná spustitelná produkční cesta vede přes
ověřenou M3 agent extension vazbu. Tento dokument netvrdí `REVIEW_PASSED`;
to musí dodat operátor nad uvedeným rozsahem.

## Uzavření nálezu

### 1. Legacy HTTP mutátory

`src/agents/m3-legacy-agent-quarantine.js` je import-free modul se zmrazeným
seznamem 13 mutačních, builder a source-validation routes. Každý handler vrací
beze čtení requestu přesně:

```json
{
  "error": "Legacy agent mutation endpoints are retired.",
  "code": "LEGACY_AGENT_MUTATION_RETIRED",
  "replacement": "/api/agent-extensions"
}
```

s HTTP 410. Overlay se aplikuje jako poslední v agent route factory a zůstává
autoritativní i při `C3_ENABLE_AGENTS=false`; disabled-platform guard jej
nepřepíše na 501.

Regresní test předává retired handlerům request a params proxy, jejichž libovolné
čtení vyhodí chybu. Samostatná sonda obsahuje původní problematický webhook
`{{sources.source-1.data.redirect}}`; handler jeho definici nečte a nemůže tedy
vybrat ani kontaktovat cíl.

### 2. Scheduler a startup

Produkční `AgentScheduler` dostává explicitní `executionAuthority`. Ta pro každý
schedule, due run, manual run, reschedule i status znovu volá
`AgentExtensionService.resolveExecution`. Chybějící, stale nebo pozměněná
`M3AgentExtensionBinding` fail-closed zabrání spuštění; manual run vrací typed
`M3_AGENT_EXTENSION_AUTHORITY_REQUIRED`.

Startup už neprochází `src/agents/examples` a nevytváří ani neplánuje legacy
definice. Existující historické DB řádky mohou zůstat čitelné, ale scheduler je
nezařadí a mutační API je nedokáže spustit.

### 3. Zachovaná nativní M3 cesta

Agent extension service nyní vlastní obecné instance operace
`runInstance`, `setInstanceEnabled` a `uninstallInstance`. Studio a project-health
E2E používají výhradně:

- `POST /api/agent-extensions/instances/:agentId/run`;
- `POST /api/agent-extensions/instances/:agentId/enable`;
- `POST /api/agent-extensions/instances/:agentId/disable`;
- `DELETE /api/agent-extensions/instances/:agentId`.

Každá operace nejdřív ověří skutečnou extension identity a definition digest.
Install zůstává na verzovaném `/api/agent-extensions/:id/install` kontraktu.

## Důkazy

| Důkaz | Výsledek |
|---|---|
| retirement contract a scheduler authority | 10/10 PASS |
| celý M3 focused panel | 16/16 PASS, run `2026-08-26T06-55-06-187Z` |
| module boundary ratchet | 13/13 PASS; 1 150 hran; 3 cykly / 28 souborů |
| schema | 38/38 PASS; 73 migrací |
| artifact | 154/154 PASS |
| registry | 438 programů; fingerprint `ca2aa642e8e433ea484a2c20c42f3f8aa045b2b4b906548f417a5185265ed54f` |
| plný `offline,database` baseline | `268 PASS / 2 FAIL / 2 BLOCKED`, run `2026-08-26T06-59-52-119Z` |

Plný runner skončil pravdivě exit 1. `BLOCKED` zůstávají oba PDF programy
na `python-pdf-runtime`; `FAIL` zůstávají `nightly-orchestrator-self-test` a
`vram-coordination`. Množina non-PASS se oproti reviewed M3 kandidátu nezměnila.
Ollama, GPU, modely, externí síť ani cizí procesy nebyly použity.

## Požadovaný re-review výstup

```text
Oddíl 7: REVIEW_PASSED
M3: REVIEW_PASSED
Legacy-agent scope disposition: mutační legacy surface je fail-closed retired;
native M3 extension cesta zůstává jedinou spustitelnou agent authority.
```
