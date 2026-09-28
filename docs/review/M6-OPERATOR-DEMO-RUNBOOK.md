# M6 operator demo — runbook

**Stav:** `PREPARED / REAL DEMO NOT RUN / APPROVAL NOT ISSUED`

Tento postup se použije až nad zmrazeným M6 kandidátem po technické matici.
Pozorování a approval jsou dvě odlišné věci: runner umí první, pouze operátor
smí po vlastním vyhodnocení dodat druhé.

## 1. Předpoklady

- standalone fresh clone, ne linked worktree;
- checkout exact product candidate SHA a žádné změny product cest;
- offline install `core-minimal-offline` a production Studio build
  `linux-x64-studio-production`;
- žádná souběžná cizí GPU/Ollama práce;
- nulový neočekávaný egress;
- aktuální technická evidence a review zůstávají samostatnými branami.

Zamčený plán zobrazí:

```bash
npm run m6:operator-demo
```

Tento příkaz pouze tiskne plán a vrací 0. Není to demo evidence.

## 2. Raw evidence a input

Pro kandidát `$SHA` patří raw soubory výhradně pod:

```text
docs/execution/runs/m6/operator-demo/candidate-$SHA/raw/
```

Každý z devíti kroků musí mít alespoň jeden samostatný JSON/text/screenshot
artefakt. Neukládat tokeny, prompty s citlivým obsahem ani osobní data. Input
má exact tvar:

```json
{
  "contract": "M6OperatorDemoInput",
  "version": 1,
  "candidateSha": "<40-hex exact candidate>",
  "startedAt": "<canonical ISO timestamp>",
  "completedAt": "<canonical ISO timestamp>",
  "environment": {
    "freshCloneObserved": true,
    "installProfile": "core-minimal-offline",
    "buildProfile": "linux-x64-studio-production",
    "unexpectedEgressAttempts": 0
  },
  "steps": [
    { "id": "open-project", "status": "PASS", "notes": "...", "artifactPaths": ["docs/execution/runs/m6/operator-demo/candidate-<sha>/raw/open-project.json"] },
    { "id": "resume-conversation", "status": "PASS", "notes": "...", "artifactPaths": ["docs/execution/runs/m6/operator-demo/candidate-<sha>/raw/resume-conversation.json"] },
    { "id": "deterministic-turn", "status": "PASS", "notes": "...", "artifactPaths": ["docs/execution/runs/m6/operator-demo/candidate-<sha>/raw/deterministic-turn.json"] },
    { "id": "model-turn", "status": "PASS", "notes": "...", "artifactPaths": ["docs/execution/runs/m6/operator-demo/candidate-<sha>/raw/model-turn.json"] },
    { "id": "approve-change", "status": "PASS", "notes": "...", "artifactPaths": ["docs/execution/runs/m6/operator-demo/candidate-<sha>/raw/approve-change.json"] },
    { "id": "negative-effect", "status": "PASS", "notes": "...", "artifactPaths": ["docs/execution/runs/m6/operator-demo/candidate-<sha>/raw/negative-effect.json"] },
    { "id": "specialist-agent", "status": "PASS", "notes": "...", "artifactPaths": ["docs/execution/runs/m6/operator-demo/candidate-<sha>/raw/specialist-agent.json"] },
    { "id": "learning", "status": "PASS", "notes": "...", "artifactPaths": ["docs/execution/runs/m6/operator-demo/candidate-<sha>/raw/learning.json"] },
    { "id": "model-discovery", "status": "PASS", "notes": "...", "artifactPaths": ["docs/execution/runs/m6/operator-demo/candidate-<sha>/raw/model-discovery.json"] }
  ]
}
```

`FAIL` a `NOT_RUN` jsou platné vstupní statusy a musí zůstat pravdivé. Runner
je nikdy nepřekládá na PASS.

## 3. Záznam a revalidace

```bash
node scripts/run-m6-operator-demo.js --record \
  docs/execution/runs/m6/operator-demo/candidate-$SHA/raw/input.json
```

Výstup je content-addressed `observation-<sha256>.json` vedle `raw/`. I při
devíti PASS vrátí runner exit 2 a stav
`DEMO_COMPLETED_AWAITING_OPERATOR_APPROVAL`. Poté lze stejný artifact znovu
ověřit:

```bash
node scripts/run-m6-operator-demo.js --validate \
  docs/execution/runs/m6/operator-demo/candidate-$SHA/observation-<sha256>.json
```

Raw evidence a observation se commitnou pouze jako evidence-only descendant.
Registry ani product soubory se po zmražení kandidáta nesmí změnit.

## 4. Externí approval

Operátor si observation přečte a teprve potom může offline podepsat
`SignedAuthorityReceipt@1` do
`docs/review/M6-OPERATOR-DEMO-RESULT.json`. Receipt musí mít doménu
`intentsmith.m6.operator-demo.v1`, roli `m6-release-operator`, exact
candidate/tree/registry/evidence-index/manifest bindings, user actora, payload
se všemi devíti kroky v exact pořadí a artifact binding na jediný committed
observation soubor. Musí navazovat na předchozí C-E-R-A receipt identity.

Podpis se nesmí provést, dokud privátní release key není ve skutečně offline
custody podle Decision 041. Runner privátní klíč nečte a podpis neumí.

Implementační agent tento receipt nevytváří. Následné
standalone `node scripts/verify-signed-authority-bundle.js` znovu načte přesné
observation bytes i všechny raw Git bloby z podepsaného evidence HEAD. Teprve
jeho PASS může spotřebovat `node scripts/validate-m6-release.js`. Demo approval
samo o sobě stále nenahrazuje M5 acceptance, nezávislé M6 review ani Gate 0
C-E-R-A attestation.
