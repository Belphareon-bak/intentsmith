# 008 — ModelRequest v1: role-purpose authority a parametrický šev

- **typ:** DECIDE-AND-CONTINUE
- **WP:** WP-M1-MODEL
- **rail:** R1 C3_EVOLUTION, R2 LOCAL_FIRST, R3 OBSERVABLE_BEHAVIOR, R6 REVERSIBILITY
- **vzniklo při:** `src/llm/cre-bridge.js:executeM1ModelRequest()`

## Evidence na stole

`ModelRequest` v1 nese odděleně `callerRole`, `modelRole`, `purpose` a volný
JSON objekt `parameters`. Tyto osy nejsou zaměnitelné:

- `callerRole` určuje oprávnění;
- `purpose` říká, proč efekt vzniká;
- `modelRole` je provozní vazba na přesný model z `config.models`;
- `parameters` smí ladit výpočet, ale nesmí měnit autoritu, korelaci, model,
  retry policy ani cancellation transport.

Samotné pole `callerRole` je tvrzení payloadu, nikoli důkaz autority. Adaptér
proto přijímá process-local vydaný auth token mimo connector payload. Token
musí mít shodnou roli, `decisionId == requestId`, `sessionId == conversationId`
a `stepId == turnId`; kopie, spread, serializovaný objekt, cizí identity nebo
nadlimitní token skončí před providerem. Po úspěšném preflightu si adaptér
uchová ověřenou identitu pro terminální audit, takže expirace tokenu během
oprávněného efektu neztratí atribuci.

Jednoduché mapování `purpose -> capability` by odmítlo legitimní lifecycle
cestu `WORKFLOW_CODER + answer/refine`, protože coder vlastní
`code_generation`, nikoli obecné `reasoning`. Naopak převzetí capability přímo
z requestu by volajícímu dovolilo vlastní oprávnění zvolit.

## Vzatý default

Adaptér používá explicitní matici `(callerRole, purpose) -> capability`:

| Caller | Purpose | Capability |
|---|---|---|
| `CRE_DECISION` | `classify` | `classification` |
| `CRE_DECISION`, `CRE_PLANNING` | `answer`, `refine` | `reasoning` |
| `SYNTHESIZER` | `synthesize` | `summarization` |
| `REFLECTOR` | `refine` | `reasoning` |
| `WORKFLOW_CLASSIFIER`, `SKILL_RESOLVER` | `classify` | `classification` |
| `WORKFLOW_THINKER`, `WORKFLOW_ANALYZER`, `WORKFLOW_PLANNER`, `SKILL_EXECUTOR` | `answer`, `refine` | `reasoning` |
| `WORKFLOW_CODER` | `answer`, `refine` | `code_generation` |
| `WORKFLOW_REVIEWER` | `answer`, `refine` | `code_review` |

`TOOL_INTERNAL` nemá v purpose enumu v1 poctivý ekvivalent pro `extraction` a
končí typovaným `MODEL_PURPOSE_NOT_AUTHORIZED`. `LEGACY_DIRECT` není veřejná
autorita connectoru. `VISION` vyžaduje image schema a zůstává oddělený finding.

Všech šest textových rolí `D1/D2/CODE/R1/R2/CHAT` je vůči matici ortogonální:
adaptér vždy použije přesně `config.models[modelRole]`. Request model nepřijímá.

Request se před první asynchronní hranicí hluboce snapshotuje a validuje;
pozdější mutace původních ID ani vnořených parametrů nemůže rozdělit provider
audit a `ModelResult`. Parametry v1 jsou allowlist `temperature`, `top_p`,
`maxTokens`, `num_ctx`, `timeout`, `format=json`. Model, capability,
correlation, messages, retry, auth token, signal a VRAM policy se odmítnou před
provider efektem. `maxTokens` pouze žádá menší limit; adaptér odmítá token nad
defaultem role a gateway použije minimum requestu a tokenu.

## Alternativy a cena přepnutí

| Varianta | Dopad | Cena přepnutí |
|---|---|---|
| A — současná explicitní matice a allowlist | Nejméně implicitní autority; neznámé kombinace fail-closed | Současný stav ve dvou produkčních souborech a jedné focused sadě |
| B — capability odvodit jen z purpose | Jednodušší, ale rozbije code/review lifecycle | Jedna funkce a nejméně čtyři maticové testy |
| C — capability/model/policy přijmout z parameters | Pružné, ale request si zvolí autoritu a deployment | Bezpečnostní změna connectoru; vyžaduje operátorské rozhodnutí a nové negativní kontrakty |
| D — přidat purpose `generate/review/extract` | Přesnější veřejný slovník | Změna connectoru B1, všech validátorů a konzumentů; tvrdý BLOCK v tomto WP |

## Švy

- matice a parametrická normalizace:
  `src/llm/cre-bridge.js:executeM1ModelRequest()`;
- role token limit a process-local provenance:
  `src/llm/auth-types.js:createAuthToken()`;
- jeden provider effect a finální clamp:
  `src/llm/gateway.js:callWithPolicy()`.

Přepnutí A -> B mění jednu pojmenovanou matici a focused fixtures. Varianty C a
D nejsou vratný lokální default a bez operátora se neprovedou.

## Rozhodnutí operátora — 2026-08-08

**Potvrzena varianta A.** Explicitní `(callerRole, purpose) -> capability`
matice, process-local auth provenance a bounded parameter allowlist zůstávají
autoritou adaptéru M1. `TOOL_INTERNAL`, `LEGACY_DIRECT` ani vision se do v1
nedoplňují domyšleným významem.
