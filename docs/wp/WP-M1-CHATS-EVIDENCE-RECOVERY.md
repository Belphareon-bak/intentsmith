# WP-M1-CHATS-EVIDENCE-RECOVERY — jednorázové smíření správné obálky s canonical historií

**Typ:** docs-only governance + evidence-envelope recovery · **Slot:** jediný
writer v izolovaném disk-backed worktree

**Rozhodnutí:**
[`030 / M1-CHAT-EVIDENCE-RECOVERY-X1 + X1-a + X1-b`](../decisions/030-m1-chats-evidence-envelope-recovery.md)

**integrationRef:** `integration/m1-consolidated-20260810`

**baseRevision / invalid historical evidence `I`:**
`39776f1e90e425bd91a7be707edc556a299869bd`

**reviewed candidate `C_CHAT`:**
`578876dd77c68df4bdcf6239383fa782b649f843`

**Refs:**

- governance `G_REC`: `docs/m1-standalone-chats-evidence-recovery-20260812`;
- corrected `X`:
  `evidence/m1-standalone-chats-decommission-review-b-corrected-20260812`;
- reconciliation `R_REC`:
  `queue/m1-standalone-chats-evidence-reconciliation-20260812`.

**Stav:** `ACTIVE / GOVERNANCE_WRITER` — nejprve vznikne a nezávisle se
zreviewuje `G_REC`; teprve potom může jiný zápis materializovat `X` a `R_REC`.
Reset zůstává blokovaný do metadata gate a canonical fast-forwardu na `R_REC`.

## 1. Výsledek a hranice

Bez přepsání historie se zachová invalidní pokus `I`, všech 25 jeho
narativních řádků se verbatim přesune do decision 030 a canonical tip nakonec
ponese správný dvouřádkový report blob z nového `X`. Produktový candidate,
source/runtime, support claim, data a už přijatý corrected Review B PASS se
nemění.

Tento WP není nový behavior subject a nevytváří nový run report. Jeho důkazem
jsou exact commit-parent, path, blob a tree gates níže. Jde o jednorázovou
výjimku výslovně přijatou operátorem, nikoli o obecnou alternativu standardního
`S -> E_A -> C -> E_B` procesu.

## 2. Governance writer `G_REC`

`G_REC` vzniká jako direct child exact `I` na governance refu. Jeho přesný
allowlist je:

```text
CONTRACT.md
ROADMAP.md
docs/decisions/030-m1-chats-evidence-envelope-recovery.md
docs/execution/m1-batch.md
docs/findings/011-user-settings-authority-and-secret-exposure.md
docs/wp/README.md
docs/wp/WP-M1-CHATS-EVIDENCE-RECOVERY.md
docs/wp/WP-M1-SETTINGS-RESET-AUTHORITY.md
docs/wp/WP-M1-STANDALONE-CHATS-DECOMMISSION.md
```

Zakázané jsou source, runtime, testy, registry, build output, existující run
report i jakákoli jiná cesta. Rename se počítá jako odstraněná a přidaná cesta.
`G_REC` nesmí změnit
`docs/execution/runs/wp-m1-standalone-chats-decommission-20260812-report.md`.
Z devíticestného allowlistu se v tomto `G_REC` záměrně nezmění
`docs/findings/011-user-settings-authority-and-secret-exposure.md`, protože
patří do dvanácticestného reset manifestu. Exact resulting census `G_REC`
proto obsahuje ostatních osm cest; Finding 011 zůstane byte-identický s `I`.

Decision 030 obsahuje verbatim 25řádkový payload z `I`, včetně:

- prvního `CHANGES_REQUIRED / harness-only` pokusu a `lsof` self-observation;
- věty `nonzero výsledek se nezatajuje ani nepřepisuje na PASS.`;
- plného stderr marker digestu
  `8cb740fc4e99efd6f47aa8836bcb1bdfbb024aab0fa2fcb14d4ea51baa994bc0`;
- plného manifest digestu
  `0a65ab74b92b95db640c6b929e1f1b5fa419512ab496dfa8b22322daacb1ddea`.

Payload má `1345` bytes a SHA-256
`76d79c2cc44b63b31ce02f582465d53eb3344ae6b88ea1c576d743b9384a0172`.
Governance reviewer musí před commitem nebo promotion ověřit jeho byte-shodu
proti prostřednímu payloadu `I`.

## 3. Corrected evidence `X`

`X` smí vzniknout až po nezávislém PASS review immutable `G_REC`. Musí:

- mít právě jednoho parenta, exact
  `C_CHAT=578876dd77c68df4bdcf6239383fa782b649f843`;
- měnit jedinou cestu
  `docs/execution/runs/wp-m1-standalone-chats-decommission-20260812-report.md`;
- mít report blob exact
  `04b839db53abcbce510a9d57d7b750f20e2c6f9d`;
- mít root tree exact `118a7b5007cfcb75baad0ce894b2e3bbd5517e72`;
- připojit za report `C_CHAT` pouze:

  ```text
  candidateHead: 578876dd77c68df4bdcf6239383fa782b649f843
  reviewB.verdict: PASS
  ```

Corrected Review B se znovu nespouští. Povolena je pouze materializace
správného report blobu a read-only metadata gate.

## 4. Reconciliation `R_REC`

`R_REC` je běžný merge commit s přesným pořadím parentů `[G_REC, X]`. Merge
resolution musí zvolit report byte-identický s `X`; 27řádkový report z `I`
nesmí být v resulting tree. Všechny ostatní paths musí být byte-identické s
`G_REC`.

Tím vznikne fast-forward cesta z aktuálního integration tipu:

```text
I -> G_REC -> R_REC
```

`X` současně zůstane direct child `C_CHAT`. `I` je dosažitelné v historii a
decision 030 uchovává jeho narativ, ale canonical obsah používá správný report.
Žádný rebase, amend, cherry-pick, force-push nebo history rewrite není povolen.

## 5. Vlastnictví, review a resource hranice

- governance writer nesmí reviewovat `G_REC`;
- nezávislý reviewer ověří `G_REC` dřív, než začne corrected-evidence writer;
- writer `X`/`R_REC` nesmí být jejich metadata reviewer;
- současně smí existovat nejvýše jeden nově vytvořený recovery-owned worktree;
- všechny nové worktrees jsou disk-backed pod `/home/belphareon/worktrees`,
  nic nevzniká v `/tmp`;
- neprokázané cizí worktrees, dirty stromy, procesy a data jsou `UNKNOWN` a
  nesmějí se uklízet ani měnit;
- žádný test, build, install, server, Electron, Ollama, GPU nebo síťový job se
  pro recovery nespouští.

Tento limit výslovně zakazuje vytvořit druhý reset worktree pro přenos již
rozpracovaného reset diffu. Protože `I..R_REC` musí být byteově prázdné na
všech dvanácti reset paths, downstream reset smí použít pouze preservation
postup připnutý ve svém WP: privátní mode-0600 disk patch se shodným SHA,
reverse-apply owned diffu v současném worktree, čistý `--ff-only` branch posun
`I -> R_REC`, jedno reapply a exact path/digest gate. `stash`, `reset --hard`,
force update, druhý reset worktree a ruční přepis patchů jsou zakázané.

## 6. Exact gates

Governance gate ověří alespoň:

```text
parent(G_REC) = I
paths(I..G_REC) = exact eight-path subset of the nine-path allowlist
finding 011 blob(G_REC) = finding 011 blob(I)
target report blob(G_REC) = 700063b149e2a8683b4a447ef9481be356c79151
narrative(decision 030) = exact 1345-byte payload from I
sha256(narrative) = 76d79c2cc44b63b31ce02f582465d53eb3344ae6b88ea1c576d743b9384a0172
git diff --check I G_REC = PASS
```

Corrected evidence gate ověří alespoň:

```text
parents(X) = [C_CHAT]
paths(C_CHAT..X) = exact target report path
reportBlob(X) = 04b839db53abcbce510a9d57d7b750f20e2c6f9d
tree(X) = 118a7b5007cfcb75baad0ce894b2e3bbd5517e72
assert_report_append C_CHAT X = exact two required lines
```

Reconciliation gate ověří alespoň:

```text
parents(R_REC) = [G_REC, X]
reportBlob(R_REC) = reportBlob(X)
every non-report path(R_REC) = corresponding path(G_REC)
runtime/source tree(R_REC) = runtime/source tree(C_CHAT)
I is ancestor of R_REC
X is parent of R_REC
integration can fast-forward I -> G_REC -> R_REC
```

`R_REC` se nejprve ověří na reconciliation refu. Až potom integrátor provede
non-force fast-forward canonical integration refu a znovu ověří jeho exact tip.

## 7. Stop conditions

Dotčená část se zastaví při jakémkoli odlišném parentu, blobu, tree, path
censusu nebo report obsahu; při potřebě přepsat historii; při source/runtime/
test změně; při změně support claimu, auth/access boundary, dat nebo při
neřešitelném merge conflictu mimo přesný target report. Vada se nesmí obejít
oslabením `assert_report_append` ani přeznačením `I` na PASS.

## Výstup

- nezávisle reviewovaný docs-only `G_REC`;
- correct direct-child `X` s exact dvouřádkovým appendem;
- metadata-ověřený `R_REC` s reportem byte-identickým `X`;
- canonical integration posunutá pouze fast-forwardem;
- `R_REC` jako jediný přípustný base 029 resetu;
- žádný nový behavior run a žádná ztráta prvního neúspěšného pokusu.
