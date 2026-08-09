# 023 — VRAM cesta musí oddělit ochranu artefaktu od GPU residency

- **typ:** BLOCK pouze pro poslední VRAM hranu model-delete C2
- **stav rozhodnutí:** DECISION_REQUIRED; současný VRAM manager autoritu nekonzultuje
- **WP:** WP-M1-MODEL-CLEANUP-AUTHORITY / C2
- **rail:** R1, R3, R5, R6
- **vzniklo při:** source-to-effect kontrole páté živé model-use cesty

## Dvě různé vady, které se nesmějí sloučit do jednoho tvrzení

Živá media cesta vede z `POST /api/media/generate` přes
`VRAMManager.acquire()` do `unloadOllama()`, dlouhého ComfyUI jobu a
`reloadOllama()`. `unloadOllama()` nejprve čte `/api/ps` a potom pro každý
načtený model volá `/api/generate` s `keep_alive: "0"`. Reload znovu používá
startup snapshot `_chatModel`.

Existují proto dva odlišné problémy:

1. **Artifact/delete race.** Mezi unload a reload lze chat model smazat;
   delete může také začít mezi `/api/ps` a prvním unload efektem. Stávající
   per-canonical `ModelUseAuthority` tuto hranu umí uzavřít bez nového
   veřejného kontraktu.
2. **GPU residency/admission.** Shared gateway inference může běžet současně
   s unloadem a během ComfyUI práce může Ollama znovu obsadit VRAM. To
   per-model shared lease záměrně neřeší; vyžaduje globální GPU read/write
   autoritu, jednotné pořadí locků a uživatelskou busy/retry sémantiku. Je to
   stávající Finding 003, nikoli skrytá součást delete checkpointu.

Startup audit používá stejný unload/reload call graph, ale běží před otevřením
listeneru. Přesto musí přímé metody držet vlastní lease, protože jejich
bezpečnost nesmí záviset jen na dnešním entrypoint pořadí.

## Varianty

| Varianta | Chování | Dopad |
|---|---|---|
| **A — úzká shared artifact authority** | Přidat `VRAM_ARTIFACT_USE` jako shared per-model owner. Chat identity se drží od dequeue media tasku do `finally`; všechny canonical-deduplikované `/api/ps` identity se získají před prvním unload efektem a drží přes response bodies; přímý reload drží chat identity přes provider body. | Uzavře delete race a pátou cestu pouze pro artifact safety. Gateway a VRAM zůstávají vzájemně shared; Finding 003 zůstane otevřený. |
| **B — globální GPU residency authority už v M1** | Gateway/validation/binding drží globální shared GPU lease, media unload/ComfyUI/reload globální exclusive lease; vedle toho zůstávají per-model leases. | Řeší i přerušení inference a VRAM re-entry, ale mění více konzumentů, lock ordering, busy UX a M1/M2 hranici. |
| **C — VRAM hranu odložit celou** | Kód zůstane beze změny a delete C2 zůstane 4/5. | Bez nové změny, ale L0-11 ani cleanup C2 nelze přijmout jako hotové. |

## Doporučení

**A nyní, globální residency do M2.** Úzká varianta používá existující
reverzibilní interní seam a nemění veřejné HTTP/WS payloady, retry policy ani
GPU profil. Nesmí však být popsána jako ochrana gateway před unloadem.

Authority konflikt musí uniknout z dnešních širokých `catch` bloků. Při
konfliktu v multi-model seznamu se dříve získané leases uvolní a před prvním
`/api/generate` musí být nula provider efektů. Všechny leases zůstávají aktivní
i během čtení response body a uvolní se právě jednou v `finally`.

Povinné negativní důkazy:

- delete mezi unload a reload skončí `MODEL_DELETE_IN_USE` před inventory;
- aktivní delete zastaví VRAM task před prvním dotčeným provider efektem;
- konflikt jediné identity v multi-model seznamu znamená nula unload POSTů;
- delete během čekajícího response body zůstane blokovaný;
- fetch/body/task failure uvolní všechny leases;
- `name` a `name:latest` vytvoří jednu canonical rezervaci;
- `VRAM_ARTIFACT_USE` a `LLM_GATEWAY` mohou současně držet shared lease — tím
  test pinuje, že checkpoint potichu netvrdí globální GPU autoritu.

## Residualy po variantě A

- gateway může být unloadem stále přerušena a Ollama může během ComfyUI práce
  znovu vstoupit do VRAM;
- `_chatModel` je startup snapshot a může po binding změně reloadovat starou
  identitu;
- authority zůstává single-process;
- remote provider scope, stalled-pull recovery a append-only delete audit
  zůstávají otevřené;
- provider outcome v dnešním unload/reload kódu není vždy pravdivý.

## Přesná otázka pro operátora

```text
023-vram-delete-scope: A-SHARED-PER-CANONICAL-ARTIFACT
023-owner: VRAM_ARTIFACT_USE
023-chat-lease-window: TASK-DEQUEUE-THROUGH-FINALLY
023-unload-lease-window: ALL-DISCOVERED-MODELS-BEFORE-FIRST-UNLOAD-THROUGH-ALL-BODIES
023-direct-reload-window: BEFORE-PROVIDER-THROUGH-BODY
023-conflict: FAIL-BEFORE-AFFECTED-PROVIDER-EFFECT
023-global-gpu-residency: DEFERRED(M2-GPU-EFFECT-AUTHORITY)
023-public-connector: UNCHANGED
```

Do potvrzení se `src/media/**` ani owner vocabulary nemění. Nezávislá M1
práce pokračuje; blokovaná je pouze poslední VRAM hrana cleanup C2.
