# 023 — VRAM cesta musí oddělit ochranu artefaktu od GPU residency

- **typ:** BLOCK pouze pro poslední VRAM hranu model-delete C2
- **stav rozhodnutí:** A PŘIJATO operátorem 2026-08-09 včetně korekce lease expiry;
  implementace poslední VRAM hrany je odemčená
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
  test pinuje, že checkpoint potichu netvrdí globální GPU autoritu;
- delete během běžícího media tasku selže typovaně a okamžitě, bez čekání a bez
  uvolnění lease časem.

## Operátorská korekce 2026-08-09 — delete busy a expirace lease

Review upozornilo, že shared lease držený od dequeue přes celý ComfyUI job
odmítne `MODEL_DELETE` po celou dobu generování, a navrhlo lease TTL nebo
heartbeat. Operátor TTL **zamítl**: bezpečnostní lease s expirací je horší než
žádný. Pokud dlouhý task model stále používá a lease vyprší, `MODEL_DELETE`
smaže artefakt uprostřed práce — přesně ta hrana, kterou toto rozhodnutí
uzavírá. Držení až do `finally` výše zůstává závazné.

Delete se proto při konfliktu chová fail-fast a pravdivě: typovaný
`MODEL_DELETE_IN_USE` bez čekání, bez tiché retry a bez slibu, kdy model bude
volný. Zaseklý nebo neukončený media task tím může blokovat delete neomezeně
dlouho; to je pojmenovaný residual pro M2 task supervision, nikoli důvod
oslabit lease. Heartbeat nebo fenced TTL dává smysl teprve u durable či
multiprocess autority v M2, kde držitele lze nezávisle ověřit.

## Residualy po variantě A

- gateway může být unloadem stále přerušena a Ollama může během ComfyUI práce
  znovu vstoupit do VRAM;
- `_chatModel` je startup snapshot a může po binding změně reloadovat starou
  identitu;
- authority zůstává single-process;
- remote provider scope, stalled-pull recovery a append-only delete audit
  zůstávají otevřené;
- zaseklý media task drží shared lease bez horního limitu a blokuje delete;
  supervizi vlastní M2, ne tato hrana;
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
023-delete-busy: TYPED-FAIL-FAST
023-lease-expiry: NONE-IN-SINGLE-PROCESS
023-release: TASK-FINALLY-ONLY
023-stalled-task: NAMED-RESIDUAL-FOR-M2-SUPERVISION
```

Operátor tento blok přijal 2026-08-09. `src/media/**` i owner vocabulary se
mění pouze v rozsahu varianty A; globální GPU residency zůstává v M2.

## Implementační checkpoint 2026-08-09

Varianta A je implementovaná jako source candidate. Composition root předává
`VRAMManager` úzký frozen port nad společnou `ModelUseAuthority`; media vrstva
nedostává delete ani jinou mutation autoritu. Port canonical-deduplikuje celý
seznam, získává shared leases v deterministickém pořadí a při jediném konfliktu
vrátí všechny dříve získané leases ještě před prvním unload POSTem.

Media task drží chat identity od dequeue do task `finally`. Přímý unload nejprve
načte úplný `/api/ps` seznam a až potom atomicky rezervuje všechny identity;
lease drží přes všechny provider response bodies. Přímý reload drží chat
identity přes výpočet efektivního `num_ctx`, provider request i body. Konflikt
authority uniká ze širokých legacy catch bloků a generation callback při
aktivním delete vůbec nezačne.

Focused offline důkaz source candidate:

- `tests/m1-model-use-authority.test.js`: 29/0;
- `tests/vram-coordination.test.js`: 47/0;
- `tests/multimedia.test.js`: 62/0, včetně živého route seamu;
- GPU, Ollama, produktový server, Electron a externí síť: `NOT RUN`.

Současně se na nedotčeném vstupním SHA reprodukoval starší rozpor profilu:
VRAM výpočet vracel 8192, zatímco společný runtime profil skutečně ukládal
4096. Candidate nyní vrací a při reloadu posílá efektivní hodnotu po aplikaci
stejného profile ceiling; referenční model je připnutý na přesných 4096 a
unprofiled fixture dál dokládá vyšší explicitně vypočtenou hodnotu.

Source commit `7da6be4c` přidal jednu přesně známou composition-root hranu
`src/server.js -> src/upgrade/model-use-authority.js`. Integrátorský writer ji
následně přijal jediným exact `--accept-edge`: baseline vzrostla 1020→1021,
cykly zůstaly 3 a počet souborů v cyklech 28. Baseline pinuje přesný source
`7da6be4c3a17a0bb58b2a3a029d87c4c67396ff6`; ratchet i jeho focused sada jsou
zelené 1021/1021 a 13/0. Fresh-clone evidence ještě následuje.
Globální GPU residency, multiprocess safety, durable delete audit, vzdálený
provider scope a bounded supervision dlouhého tasku zůstávají otevřené.
