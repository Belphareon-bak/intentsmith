# 024 — proof issuer musí vlastnit původ měření a retry hranici

- **typ:** přijatá implementační autorita pro vydání PASS proofu
- **stav:** `ACCEPTED` 2026-08-10 jako varianta A; schema/ledger checkpoint 062
  tím není zpochybněn a automatická aktivace zůstává vypnutá
- **WP:** navazující `WP-M1-PROOF-ISSUER-PROVENANCE`
- **rail:** R1, R3, R5, R6
- **vzniklo při:** implementaci rozhodnutí 015 a call-graph auditu parent acceptance

## Ověřený problém

Původní statický connector přijímá
`issueModelFailoverProof({ db, acceptancePath })`. Samostatná funkce
`validateModelFailoverCandidateAcceptance()` ale bez interního
`expectedAuthority` výslovně vrací `validationScope: STRUCTURAL_ONLY`.
Vzájemně konzistentní measurement a acceptance bytes proto mohou projít
strukturální validací, aniž by prokazovaly, že je vytvořil důvěryhodný parent
run a skutečný modelový běh.

`acceptancePath` leží v gitignored candidate-measurement namespace. Source
porcelain záměrně ignoruje `docs/**` a runtime artefakty, takže čistý Git SHA
nenahrazuje provenance těchto bytes. Předání path callerem by pouze přesunulo
autoritu z ověřeného parentu na volajícího.

Další dvě hrany jsou také potvrzené:

- `PRAGMA foreign_keys` je connection-local a issuer jej musí ověřit těsně
  před vlastní top-level `BEGIN IMMEDIATE`, nikoli pouze při migraci;
- content-addressed blobs musí žít v interně odvozeném runtime data rootu.
  Worktree-local artefakt není durable důkaz pro SQLite, která worktree přežije.

## Varianty

### A — orchestration-owned run, bez externího resume (doporučeno)

Veřejný interní connector bude:

```text
issueModelFailoverProof({ db, role, proposedModelName })
  -> ISSUED
```

Issuer sám zavolá přijatý parent measurement, udrží jeho non-serialized
`expectedAuthority` v paměti, znovu ověří přesné bytes proti této autoritě,
publikuje blobs do DB-derived private store a commitne ledger+proof. Caller
nedodává path, threshold, suite, čas, TTL, source revision, hash ani proof ID.
Proof ID se interně deterministicky odvodí jako
`mfp-${acceptanceArtifactSha256}`; stejný parent result proto při nejasném
in-process DB výsledku míří na tutéž append-only identitu. Veřejný connector
ale neslibuje cross-process resume ani `ALREADY_ISSUED`.

Opakovaná samostatná operátorská akce znamená nové měření a smí vytvořit nový
časově omezený proof. Crash po DB commitu a před zobrazením výsledku může při
ručním retry vytvořit druhý validní proof z nového měření; tato varianta
netvrdí exactly-once operator outcome. DB chyba po durable blobu může zanechat
přiznaný orphan blob a další operátorská akce měření zopakuje. Pokud je nutné
resume téhož parent resultu po restartu, musí se zvolit B.

**Cena implementace:** operator-only issuer script exportující connector,
parent in-memory handoff, issuer focused suite, registry projekce a
dokumentace. Script importuje existující parent script; nevzniká nová
`src/** → scripts/**` hrana. Migrace 062 se nemění. Pozdější přechod na B přidá
novou migraci a retry connector, ale nepřepisuje proof ani blob formát.

### B — durable resumable issuance attempt

Před modelovým během vznikne nový append-only issuance-attempt journal s
opaque operation ID. Po pádu lze přes přesný journal pokračovat nad stejným
parent runem bez druhého GPU běhu; caller nikdy nedodává libovolnou path.

**Cena implementace:** navíc nová aditivní migrace po 062, claim/recovery CAS,
crash-window testy, garbage collection orphan pokusů a nový operator connector.
Přínos je levnější retry po pozdním DB/filesystem selhání. Cena a plocha jsou
výrazně větší než současná potřeba jednorázového operator-only proofu.

### C — kryptograficky podepsaný parent receipt

Parent podepíše acceptance klíčem mimo caller kontrolu a standalone issuer
ověří podpis. To dovolí oddělit measurement a issuance v čase i procesu.

**Cena implementace:** správa klíče, rotace, secure storage, recovery a nová
kryptografická autorita nebo závislost. Pro lokální 1.0 je to strategické
rozšíření scope a bez samostatného rozhodnutí se neimplementuje.

## Doporučení

Přijmout **A**. Je to nejmenší bezpečný connector pro současný explicitně
operátorský, sériový proof. Neuděluje background GPU autoritu, nemění L0-9 a
nevytváří nový recovery subsystém dřív, než je pro něj doložená potřeba.

## Přijatý význam modelové identity

Digest je provenance **jednoho proofu**, ne trvalý pin role ani produktu na
jeden model. Operátor může modely a role měnit. Proof pouze dokládá, které
konkrétní bytes byly v daném běhu skutečně změřené; po změně digestu pod
stejným tagem nebo po výměně modelu se pro nový artefakt vydá nový proof.
Starý proof nesmí být použit pro jiné bytes, ale nijak nebrání jejich instalaci,
ručnímu bindingu ani budoucí kalibraci jiné role. Tím se zachová rotace modelů
bez přenesení výsledku starého modelu na nový obsah.

Přesný potvrzovací blok:

```text
024-provenance: A-ORCHESTRATION-OWNED-PARENT
024-input: DB-ROLE-PROPOSED-MODEL-ONLY
024-artifact-root: DERIVED-FROM-CANONICAL-FILE-DB
024-proof-id: MFP-PREFIX-PLUS-ACCEPTANCE-SHA256
024-retry: NEW-OPERATOR-ACTION-RERUNS-MEASUREMENT
024-resume: OFF
024-ambiguous-outcome: MAY-CREATE-NEW-PROOF-ON-OPERATOR-RETRY
024-foreign-keys: RECHECK-IMMEDIATELY-BEFORE-BEGIN-IMMEDIATE
024-automatic-activation: OFF
024-model-rotation: ALLOWED
024-digest-scope: ONE-PROOF-ONE-OBSERVED-ARTIFACT
024-digest-change: NEW-PROOF-REQUIRED-FOR-AUTOMATION-ELIGIBILITY
```

Operátor tento blok přijal 2026-08-10. Implementace issueru zůstává
`IMPLEMENTATION_PENDING`, PASS proof `NOT_ISSUED` a Gate 1 `BLOCKED`, dokud
nevznikne přijatý integrační base, focused důkaz, reviewnutý issuer a skutečný
operátorský modelový běh. Odmítnutý prototyp s callerovým `acceptancePath`
zůstává neplatný.
