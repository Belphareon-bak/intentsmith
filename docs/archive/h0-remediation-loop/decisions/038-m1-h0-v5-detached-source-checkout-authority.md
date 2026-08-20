# 038 — Jednorázová autorita k detached source checkoutu pro D037 repair

- **typ:** docs-only operational erratum bez private nebo runtime authority
- **stav:** `R1_CHANGES_REQUIRED / SOURCE_CHECKOUT_AUTHORITY_R2_PENDING_REVIEW / PRIVATE_REPAIR_HOLD /
  NO_RUNTIME_AUTHORITY`
- **integrationRef:** `integration/m1-consolidated-20260810`
- **baseRevision / B37:**
  `df1863439b6ad83abf41396ba8063e5bffaa599e`
- **baseTree:** `1f0e730a46a94a7f741b2dbf47426458b8125a97`
- **výsledek R2 subjectu:** po vlastním R2 review a promotion pouze jeden pokus
  vytvořit přesně pojmenovaný čistý detached Git worktree na promoted
  Decision037 Review B; žádná oprava private V5 core ani runtime

## 1. Proč je erratum nutné

Promovaná Decision037 v §5.6 závazně vyžaduje, aby source checkout pro
repaired core byl čistý detached checkout na jejím promoted Review B commitu.
Při pre-S-R2 inventuře jsou canonical, Decision037 Review B i nově alokovaný
Decision038 R2 writer worktree na exact `B37` branch-attached a detached count
je nula. Po R2 subject commitu se writer posune na `S_H0V5SRC_R2`; oba
pre-existing B37 worktrees zůstanou branch-attached a detached count zůstane
nula. Požadovaný source checkout proto nelze pravdivě pinnut.

Decision037 dovoluje jedinou same-root private core transaction, ale nedává
samostatnou autoritu měnit common-Git worktree administrativu. Původní
materializer `/root/v5_materializer` proto správně skončil
`BLOCKED_BEFORE_TRANSACTION`: neprovedl chmod, edit, seal, retry ani runtime a
jeho private repair authority zůstala nespotřebovaná. Branch-attached checkout
se nesmí detachnout, přepnout ani recyklovat jako zkratka.

Tento decision zavírá jen uvedenou operační mezeru. Nevydává opravené core,
preseal READY, seal, static PASS, H0 acceptance ani runtime authority.
Decision037 `B37` zůstává live static/source base; Decision038 ji nenahrazuje.

### 1.1 Zachovaný neúspěšný R1 subject a Review A

První subject `S_H0V5SRC` je neměnný historický commit
`704dfa70e5d1856d98308315e1f030eb952f8ccf` s tree
`b44d95c94aaf1ba5bc5419cdc01997689efe59cd`. Fresh
`/root/decision038_review_a` jej uzavřel `CHANGES_REQUIRED`, `P0=0/P1=2`:

1. `P1-01 POSTSTATE-READS-NOT-READONLY` — creator/verifier Git reads neměly
   povinné `GIT_OPTIONAL_LOCKS=0` a `--no-optional-locks`, takže například
   status mohl po jediném create effectu zapsat index;
2. `P1-02 CHECKOUT-ATTRIBUTE-IGNORE-CLOSURE-INCOMPLETE` — nebyly připnuté
   common `info/attributes`, `info/exclude`, ignored enumerace ani úplná
   filesystem-vs-tree closure, takže transformované bytes nebo skrytý extra
   soubor mohly falešně vypadat jako čistý checkout.

Review report i `E_A_H0V5SRC` jsou absent; neexistuje R1 candidate, Review B,
promotion ani operational authority. R1 commit ani review se nemažou,
neamendují a nepřepisují. Jediný live corrective chain je níže definovaný R2.

## 2. Exact frozen prestate

Promoted Decision037 Review B je exact:

| Pole | Hodnota |
|---|---|
| commit `B37` | `df1863439b6ad83abf41396ba8063e5bffaa599e` |
| tree | `1f0e730a46a94a7f741b2dbf47426458b8125a97` |
| tracked path count | `1614` |
| canonical JSON+LF path-set SHA-256 | `51a56c8acf7641fd3931e3b7c3cd10e41c54bf2e4c85ad1a51d4e906dc9ec0ea` |

Path-set digest se počítá ze seřazeného unique UTF-8 seznamu cest vyparsovaného
z `git ls-files -v -z --`; všechny vstupní flagy musí být právě `H`. Seznam se
serializuje jako compact JSON array s jedním koncovým LF. Newline path nebo
jiná NUL/UTF-8 gramatika je red.

Existující sole V5 root zůstává:

    /home/belphareon/.local/share/intentsmith-private/m1-h0-headless-no-model-v5-20260818T083250Z.56131a74

Birth je exact `2026-08-18T08:32:50.000727718Z`; root a `plan/`, `runner/`,
`strategy/`, `evidence/` jsou stejné inode/device identity jako v Decision037.
Evidence je empty a detached core digesty, materialization manifest, jeho
digest, marker i seal jsou absent. OLD core je beze změny:

| Core cesta | SHA-256 | Bytes | Mode |
|---|---|---:|---:|
| `plan/h0-v5-plan.json` | `c4764b58e9e8d492f5736e9195486a51d5352aa3de5999f6501a18c923b2c5ca` | 128 493 | `0400` |
| `runner/run-h0-v5.py` | `0d02ddb9ab420ca785b3255ec50eb58fca5920d58811dc31a949b8c6a73505cb` | 619 441 | `0500` |
| `strategy/rustdesk-v5-strategy.json` | `26898ebc89930c8319e028e983c008f326b2e06600181cf50d17096b54474a4d` | 67 666 | `0400` |

Authentic OLD-red recorder už existuje na exact cestě:

    /home/belphareon/.local/share/intentsmith-private/m1-h0-v5-preseal-red-review-d037-20260818T121226Z.hotln2oq

Jeho birth je `2026-08-18T12:12:26.093319032Z`, root je `0700` a tři regular
files jsou `0400`, UID/GID `1000/1000`, nlink `1`:

| Soubor | SHA-256 | Bytes |
|---|---|---:|
| `review-result.json` | `da95531f261800d3f3262141a7e205680359ea3db6c2036c65816129f43d1aeb` | 8 122 |
| `artifact-manifest.json` | `34c9b6af49cbdd2f24b0974207065ad00f86bcb560286e7054cd5ee6af268a0d` | 600 |
| `artifact-manifest.sha256` | `3f279358c690c2f8d4773678d16442ac82d55210139a1d30e1be5063d195e75f` | 89 |

Target i jeho common-Git admin path jsou před tímto subjectem any-type absent:

    /home/belphareon/worktrees/is-m1-h0-v5-d037-repair-source-eb-df186343
    /home/belphareon/Projects/intentsmith/.git/worktrees/is-m1-h0-v5-d037-repair-source-eb-df186343

Common-Git policy inputs jsou exact:

- `/home/belphareon/Projects/intentsmith/.git/info/attributes` je any-type
  absent;
- `/home/belphareon/Projects/intentsmith/.git/info/exclude` je regular file,
  mode `0664`, UID/GID `1000/1000`, nlink `1`, 400 bytes a SHA-256
  `468044a7d11af1e2b923279d508e54ddac2298a018d3005b70d434bb4de11e53`;
- active exclude content obsahuje řádek `/.worktree-archive/`;
- common config
  `/home/belphareon/Projects/intentsmith/.git/config` je regular non-symlink,
  mode `0664`, UID/GID `1000/1000`, nlink `1`, 10 775 bytes a SHA-256
  `35e602372a295fd0baad6eb1877837a17c6caec6845a7776cdff375daa40042f`;
- typed parser exact captured config bytes odmítá jakoukoli `include` nebo
  `includeIf` directive a enabled `extensions.worktreeConfig`; config nemá
  `core.attributesFile`, `core.excludesFile`, `core.autocrlf` ani `core.eol`
  override a common `config.worktree` je any-type absent;
- config leží na `/home` filesystemu typu `btrfs`, jehož mount options obsahují
  `noatime`; tento mount target/type/`noatime` pin platí ve všech níže uvedených
  phase captures.

Žádný poststate zatím nebyl vytvořen ani vydán za PASS. Níže uvedené expected
hashes jsou prospective contract, nikoli author execution evidence.

## 3. Authority až po canonical promotion

Promované `E_B_H0V5SRC_R2` dovolí pouze:

    EXACTLY_ONE_D037_EB_DETACHED_SOURCE_WORKTREE_CREATE_ATTEMPT
    NO_EXISTING_WORKTREE_OR_BRANCH_MUTATION
    NO_PRIVATE_CORE_OR_RUNTIME_AUTHORITY
    NO_PUSH_TAG_RELEASE_HISTORY_REWRITE

Povinné pořadí je:

1. creator znovu ověří promoted Decision038 DAG, frozen private state, common
   Git prestate, target/admin absence a výhradní common-Git writer window;
2. v exact fixed subshellu nastaví `umask 077` a provede právě jeden
   `env -i` / `git worktree add` attempt;
3. při exact exit `0`, ještě před jakýmkoli Git readem, creator same-FD
   připne nový admin index, common info policy inputs a common config;
4. creator provede celý postflight pouze exact no-write Git-read envelopem,
   připne full filesystem-vs-tree closure a znovu prokáže neměnný
   index/info/config;
5. distinct verifier vše od nuly stejným no-write envelopem přepočítá;
6. pouze verifier `PASS` dovolí předat pins původnímu `/root/v5_materializer`;
7. materializer před prvním private chmod/edit nezávisle znovu ověří source,
   OLD triple, authentic red recorder, same-root inody a všechny D037 gates.

Samotné vytvoření nebo ověření worktree nespotřebuje ani neprovádí D037 private
repair. Nezakládá branch/ref, nemění existující worktree, canonical checkout,
private V5 root, runner bytes ani evidence. State lock vznikne atomicky pouze
přes `--lock --reason` v jediném povoleném `worktree add`; žádný post-create
lock command neexistuje. Potom se worktree nesmí move/remove/prune/repair,
unlock/relock ani použít pro jinou práci.
`--lock` je pouze Git administrative/advisory lock, nikoli filesystem
immutability primitive; exclusive writer/no target consumer, repeated same-FD
stability a full closure proto zůstávají povinné.

## 4. Canonical task identity

Všech pět Decision038 rolí je pairwise distinct:

| Role | Exact task |
|---|---|
| Decision038 writer | `/root/decision038_writer` |
| Decision038 R2 Review A | `/root/decision038_r2_review_a` |
| Decision038 R2 Review B | `/root/decision038_r2_review_b` |
| detached checkout creator | `/root/v5_d038_source_checkout_materializer` |
| detached checkout verifier | `/root/v5_d038_source_checkout_verifier` |

Creator má exact sorted `excludedTasks` set; vlastní creator task v něm není:

    /root
    /root/decision036_review_a
    /root/decision036_review_b
    /root/decision036_writer
    /root/decision037_review_a
    /root/decision037_review_b
    /root/decision038_r2_review_a
    /root/decision038_r2_review_b
    /root/decision038_review_a
    /root/decision038_review_b
    /root/decision038_writer
    /root/v5_d037_fresh_preseal_review
    /root/v5_d037_postseal_review_a
    /root/v5_d037_postseal_review_b
    /root/v5_d038_source_checkout_verifier
    /root/v5_formal_preseal_review
    /root/v5_materializer

Verifier má stejný sorted set, ale obsahuje
`/root/v5_d038_source_checkout_materializer` místo vlastního verifier tasku.
Creator se navíc explicitně nerovná verifierovi. Všech pět live R2 rolí je
pairwise distinct a live R2 A/B se liší i od historických R1 A/B. Git author,
chat label ani prose designation není náhradní identity source.
Historický `/root/decision038_review_a` je executed red reviewer;
`/root/decision038_review_b` nikdy neběžel. Oba jsou jen excluded historical
identities, ne live R2 role.

## 5. Exact one-shot create contract

### 5.1 Pre-effect gate

Creator začne fresh a bez zápisu ověří; každý Git read bez výjimky používá
exact envelope z §5.3, nikdy ambientní nebo plain `git`:

- canonical Decision038 promotion a report DAG bez driftu;
- local object `B37` je commit s exact tree; žádný replace/promisor/alternate
  source se nepoužije;
- target a admin path jsou přes `lstat` any-type absent a jejich parent chain
  neobsahuje symlink;
- target není v `git worktree list --porcelain`; admin basename ani jiný target
  alias neexistuje;
- neexistuje branch/ref pro target a žádný preexisting worktree se nebude
  detachovat, checkoutovat, resetovat, přesouvat nebo recyklovat;
- common Git config projde preflight same-FD protokolem z §5.4, má exact 10 775
  bytes a SHA-256
  `35e602372a295fd0baad6eb1877837a17c6caec6845a7776cdff375daa40042f`,
  parser odmítne §2 vyjmenovaný attributes/excludes/EOL/include/worktree-config
  vstup, common `config.worktree` je any-type absent a mount pin je exact;
- exact `B37` tree nemá na žádné path `.gitmodules` ani `.gitattributes` a
  common config nemá aktivní filter, attributes, fsmonitor nebo sparse-checkout
  override;
- common `info/attributes` je any-type absent a common `info/exclude` se
  same-FD no-follow protokolem shoduje s type/mode/owner/nlink/400-byte/SHA pinem
  z §2 včetně active `/.worktree-archive/` řádku;
- common `HEAD`, `config`, `packed-refs`, celý `refs/**`, object store, common
  index a všechny control files každého preexisting worktree jsou zachyceny v
  canonical type/mode/owner/link/bytes/digest manifestu;
- nejsou přítomné common-Git lock files a orchestrator vyhradil jediný
  common-Git writer slot po celou operaci a bezprostřední postflight.

`GIT_ATTR_NOSYSTEM=1` ani `core.attributesFile=/dev/null` samy nevypínají common
`info/attributes`, proto je jeho exact absence samostatný gate. Stejně
`core.excludesFile=/dev/null` nevypíná common `info/exclude`; jeho pin, ignored
streams a full FS walk jsou všechny povinné.

Consumption boundary je exact. Před vstupem do fixed subshellu je
`commandAttemptCount=0`. Jakýkoli prelaunch gate failure skončí
`BLOCKED_BEFORE_ATTEMPT` a zachová `commandAttemptCount=0`, ale současně
permanentně uzavře a spotřebuje Decision038 authority. Pod tímto decisionem se
preflight neopakuje a nový command nesmí vzniknout; pokračování vyžaduje novou
governance. Samotný launch fixed subshellu atomicky přepne
`commandAttemptCount` z `0` na `1`.

### 5.2 Exact umask, environment, config a argv

Creator použije jeden fixed subshell pouze k nastavení `umask 077` a poté jej
nahradí přes `exec /usr/bin/env -i`. Žádná command substitution, glob, pipeline
ani další shell command se nepoužije. Git child environment je exact:

    PATH=/usr/bin:/bin
    LANG=C
    LC_ALL=C
    TZ=UTC
    GIT_CONFIG_NOSYSTEM=1
    GIT_CONFIG_GLOBAL=/dev/null
    GIT_TERMINAL_PROMPT=0
    GIT_ASKPASS=/bin/false
    SSH_ASKPASS=/bin/false
    SSH_ASKPASS_REQUIRE=never
    GIT_NO_LAZY_FETCH=1
    GIT_ATTR_NOSYSTEM=1
    GIT_COMMITTER_NAME=M1-D038-Worktree
    GIT_COMMITTER_EMAIL=m1-d038-worktree@localhost

`HOME` není přítomné. Stejně tak nejsou přítomné `GIT_DIR`, `GIT_WORK_TREE`,
`GIT_INDEX_FILE`, `GIT_OBJECT_DIRECTORY`,
`GIT_ALTERNATE_OBJECT_DIRECTORIES` ani žádné jiné env keys. Exact fixed command
je:

```bash
(
  umask 077
  exec /usr/bin/env -i \
    PATH=/usr/bin:/bin \
    LANG=C LC_ALL=C TZ=UTC \
    GIT_CONFIG_NOSYSTEM=1 GIT_CONFIG_GLOBAL=/dev/null \
    GIT_TERMINAL_PROMPT=0 GIT_ASKPASS=/bin/false \
    SSH_ASKPASS=/bin/false SSH_ASKPASS_REQUIRE=never \
    GIT_NO_LAZY_FETCH=1 \
    GIT_ATTR_NOSYSTEM=1 \
    GIT_COMMITTER_NAME=M1-D038-Worktree \
    GIT_COMMITTER_EMAIL=m1-d038-worktree@localhost \
    /usr/bin/git \
      -C /home/belphareon/worktrees/is-m1-consolidated \
      -c core.hooksPath=/dev/null \
      -c core.attributesFile=/dev/null \
      -c core.excludesFile=/dev/null \
      -c core.fsmonitor=false \
      -c core.untrackedCache=false \
      -c core.splitIndex=false \
      -c core.sparseCheckout=false \
      -c core.sparseCheckoutCone=false \
      -c submodule.recurse=false \
      -c maintenance.auto=false \
      -c gc.auto=0 \
      -c fetch.writeCommitGraph=false \
      -c protocol.allow=never \
      -c worktree.guessRemote=false \
      -c checkout.workers=1 \
      worktree add \
      --detach --checkout --no-guess-remote --lock \
      --reason Decision038-authorized-detached-source-df1863439b6ad83abf41396ba8063e5bffaa599e \
      /home/belphareon/worktrees/is-m1-h0-v5-d037-repair-source-eb-df186343 \
      df1863439b6ad83abf41396ba8063e5bffaa599e
)
```

Po `exec` je Git jediný child effect. `--force`, branch creation, unlock,
remote guessing, hook, fsmonitor, untracked cache, split/sparse index,
maintenance, GC, lazy fetch, commit-graph write, protocol access, parallel
checkout a submodule recursion jsou zakázané. Žádný druhý create command není
povolen. Creation environment má přesně čtrnáct assignments a creation argv
má přesně patnáct `-c` overrideů. Efekt záměrně nesmí obsahovat
`GIT_OPTIONAL_LOCKS=0` ani `--no-optional-locks`; ty patří výhradně do všech
následných a předchozích Git readů podle §5.3.

### 5.3 Exact no-write envelope pro každý Git read

Každý Git read v preflightu, creator postflightu, verifieru i bezprostředním
materializer rechecku musí být samostatný typed invocation pod stejným exact
envelopem. Neexistuje výjimka pro `status`, `ls-files`, `rev-parse`,
`symbolic-ref`, `worktree list`, ref/DAG čtení, `ls-tree` ani `cat-file`.
Environment vznikne přes `/usr/bin/env -i`, nemá `HOME` ani žádný neuvedený key
a obsahuje přesně:

    PATH=/usr/bin:/bin
    LANG=C
    LC_ALL=C
    TZ=UTC
    GIT_CONFIG_NOSYSTEM=1
    GIT_CONFIG_GLOBAL=/dev/null
    GIT_TERMINAL_PROMPT=0
    GIT_ASKPASS=/bin/false
    SSH_ASKPASS=/bin/false
    SSH_ASKPASS_REQUIRE=never
    GIT_NO_LAZY_FETCH=1
    GIT_ATTR_NOSYSTEM=1
    GIT_OPTIONAL_LOCKS=0
    GIT_COMMITTER_NAME=M1-D038-Worktree
    GIT_COMMITTER_EMAIL=m1-d038-worktree@localhost

Exact argv prefix každého readu je:

```text
/usr/bin/env -i \
  PATH=/usr/bin:/bin \
  LANG=C LC_ALL=C TZ=UTC \
  GIT_CONFIG_NOSYSTEM=1 GIT_CONFIG_GLOBAL=/dev/null \
  GIT_TERMINAL_PROMPT=0 GIT_ASKPASS=/bin/false \
  SSH_ASKPASS=/bin/false SSH_ASKPASS_REQUIRE=never \
  GIT_NO_LAZY_FETCH=1 GIT_ATTR_NOSYSTEM=1 GIT_OPTIONAL_LOCKS=0 \
  GIT_COMMITTER_NAME=M1-D038-Worktree \
  GIT_COMMITTER_EMAIL=m1-d038-worktree@localhost \
  /usr/bin/git --no-optional-locks \
    -C <EXACT_READ_ROOT> \
    -c core.hooksPath=/dev/null \
    -c core.attributesFile=/dev/null \
    -c core.excludesFile=/dev/null \
    -c core.fsmonitor=false \
    -c core.untrackedCache=false \
    -c core.splitIndex=false \
    -c core.sparseCheckout=false \
    -c core.sparseCheckoutCone=false \
    -c submodule.recurse=false \
    -c maintenance.auto=false \
    -c gc.auto=0 \
    -c fetch.writeCommitGraph=false \
    -c protocol.allow=never \
    -c worktree.guessRemote=false \
    -c checkout.workers=1 \
    <TYPED_READ_TAIL>
```

`EXACT_READ_ROOT` je pouze canonical checkout
`/home/belphareon/worktrees/is-m1-consolidated` nebo po úspěšném create exact
nový target; jiná cesta je red. Preflight používá canonical root. Target
semantic reads používají target; common-worktree/ref/DAG reads canonical.
`TYPED_READ_TAIL` je před invokací zaznamenaný argv array bez shellu, globu,
aliasu, pageru nebo config injection. Target proof používá právě tyto tails:

    rev-parse --verify HEAD
    rev-parse --verify HEAD^{tree}
    symbolic-ref -q HEAD
    status --porcelain=v1 -z --untracked-files=all --ignored=matching
    ls-files -v -z --
    ls-files --stage -z --
    ls-files --others --exclude-standard -z --
    ls-files --others --ignored --exclude-standard -z --
    ls-tree -r -z --full-tree df1863439b6ad83abf41396ba8063e5bffaa599e --
    cat-file --batch

Každý read record připíná argv/env/stdin, exact exit, no-signal, raw stdout a
stderr bytes/SHA. Všechny uvedené target reads mají exit `0` a empty stderr s
jedinou výjimkou detached proof `symbolic-ref -q HEAD`, který musí mít exit `1`
a empty stdout/stderr. `cat-file --batch` stdin tvoří LF-terminated exact OIDy v
dávce; jeho framed stdout se parseuje beze zbytku.

Promoted-DAG, ref, object a worktree reads používají stejné prefix/env/config
bytes a svůj předem typovaný read-only tail; žádný plain `/usr/bin/git`, ambient
`git`, porcelain bez `--no-optional-locks` ani creation command s read tail není
přípustný. Read child nesmí vytvořit lock, refreshnout index, spustit hook,
lazy-fetch, fsmonitor, maintenance, GC ani změnit žádný byte.

### 5.4 Phase-bound index/info/config capture

Po exact create exit `0` a no-signal, ale ještě před prvním postflight Git
readem, creator provede pouze filesystemové no-follow čtení. New admin `index`
nejprve `lstat`ne, otevře právě jednou `O_RDONLY|O_NOFOLLOW|O_CLOEXEC`; na témže
FD zachytí `fstat` před hash streamem, count+SHA-256 všech bytes do EOF a `fstat`
po streamu, potom znovu `lstat`ne path a FD zavře. Path i FD musí mít stejný
device/inode a oba staty/path stat musí shodně připnout type, mode, UID/GID,
nlink, size, device, inode, `mtime_ns` a `ctime_ns`; `atime` se záměrně
neporovnává. `bytesRead == fstat.size`, file je regular UID/GID `1000/1000`,
nlink `1`. Actual fields nejsou prospective constants.

Ve stejné immediate fázi musí `lstat` potvrdit common `info/attributes`
any-type absent. Common `info/exclude` se otevře stejným no-follow/same-FD
protokolem a musí odpovídat exact `0664`, UID/GID `1000/1000`, nlink `1`, 400
bytes, SHA-256
`468044a7d11af1e2b923279d508e54ddac2298a018d3005b70d434bb4de11e53` a active
řádku `/.worktree-archive/`. Tyto immediate captures se porovnají s preflightem.

Common config se v preflightu, immediate fázi před prvním post-create Git readem
a creator-final fázi zachytí exact stejným filesystemovým protokolem. Každá fáze
provede path `lstat`, jediný `open(O_RDONLY|O_NOFOLLOW|O_NOATIME|O_CLOEXEC)`,
`fstat -> count+SHA-256 všech bytes do EOF -> fstat`, nový path `lstat` a close.
Path/FD identity se nesmí změnit; type, mode, UID/GID, nlink, size, device,
inode, `mtime_ns` a `ctime_ns` jsou před/po i mezi fázemi identické, `atime` se
neporovnává a `bytesRead == size`. File je exact regular non-symlink mode `0664`,
UID/GID `1000/1000`, nlink `1`, 10 775 bytes a SHA-256
`35e602372a295fd0baad6eb1877837a17c6caec6845a7776cdff375daa40042f`.
Z právě zachycených bytes typed parser v každé fázi odmítne `include`,
`includeIf` a enabled `extensions.worktreeConfig` i §2 zakázané core overrides;
common `config.worktree` zůstává any-type absent. Mount observation musí vždy
potvrdit `/home`, `btrfs` a option `noatime`.

Po všech creator Git readech se index, info i config protokoly zopakují. Admin
index path se znovu otevře jedním no-follow FD, celý lstat/fstat/hash/fstat/lstat
record musí být byteově i ve všech porovnávaných polích identický s immediate
capture; `info/attributes` zůstává absent a `info/exclude` zůstává identický s
preflight/immediate. Verifier zopakuje index/info/config capture před prvním i po
posledním svém Git readu; materializer totéž zopakuje před prvním i po posledním
svém revalidation Git readu a obě materializer captures musí nastat ještě před
jakýmkoli private chmod/edit. Všechny role musí dostat totožný config obsah,
invariantní stat fields, parser result, `config.worktree` absence a mount pin.
Index replacement/refresh, mtime/ctime drift nebo info/config/policy-input/mount
drift je terminal failure.

### 5.5 Exact successful poststate a full checkout closure

Exit musí být exact `0` bez signálu. Nový worktree musí mít:

- `HEAD=df1863439b6ad83abf41396ba8063e5bffaa599e`;
- `HEAD^{tree}=1f0e730a46a94a7f741b2dbf47426458b8125a97`;
- detached HEAD; enveloped `symbolic-ref -q HEAD` nevrátí ref a branch name je
  empty;
- raw enveloped
  `status --porcelain=v1 -z --untracked-files=all --ignored=matching` má `0`
  bytes a
  SHA-256 `e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855`;
- raw enveloped `ls-files --others --exclude-standard -z --` i
  `ls-files --others --ignored --exclude-standard -z --` mají každý `0` bytes a
  SHA-256
  `e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855`;
- právě 1 614 sorted unique UTF-8 tracked paths, všechny `H`, a canonical
  JSON+LF digest `51a56c8acf7641fd3931e3b7c3cd10e41c54bf2e4c85ad1a51d4e906dc9ec0ea`;
- žádný tracked, staged, untracked, ignored-produced ani sparse/skip-worktree/
  assume-unchanged stav.

Known exact administrative files jsou:

| Cesta relativně k target/admin | Bytes | SHA-256 |
|---|---:|---|
| target `.git` | 104 | `bc60b7bc82ca7b58d7c47557d2c0b7c1c9df458aef46c979dd9d26effb9d456e` |
| admin `HEAD` | 41 | `8f9e30bf8072fe837a13583a056dee64bb5ff87e87ff001321f14f8418a95bbe` |
| admin `ORIG_HEAD` | 41 | `8f9e30bf8072fe837a13583a056dee64bb5ff87e87ff001321f14f8418a95bbe` |
| admin `commondir` | 6 | `340ddcb67a6204f742cd1e28e5b462622dde7daaa8ee36001897196aacdc6d47` |
| admin `gitdir` | 75 | `6ea79e1e778da9ef8f18ec112bbe333d1230e4b02f1edd48cdeaa31b0a18dd33` |
| admin `locked` | 80 | `31fceca6b3e9b07a2c3973a39bd37d45ea36f1275bac0a1ed6a52f29608ac5b3` |

Admin subtree smí obsahovat právě `HEAD`, `ORIG_HEAD`, `commondir`, `gitdir`,
`index`, `locked`, adresář `logs/` a `logs/HEAD`. `.git`, všechny uvedené admin
files a `logs/HEAD` jsou regular files; nové cesty jsou non-symlink a UID/GID
`1000/1000`. Known control bytes musí přesně odpovídat tabulce. `locked`
obsahuje exact reason z §5.2.

Index, reflog bytes, inody, mtimes ani whole-admin digest se prospectivně
nepřipínají, protože je Git vytváří za běhu. Immediate actual index capture ze
§5.4 se však stane závazným run-specific pinem a všechny pozdější reads jej musí
zachovat byte/stat-identický. Reflog actual stat/hash se zaznamená a verifier jej
znovu přečte; není náhradou za semantic HEAD/tree/status/path-set proof.
Jakákoli devátá admin entry nebo missing allowed entry je red.

Full target closure se odvozuje nezávisle od statusu a ignore pravidel:

1. raw enveloped `ls-tree` stream má 151 786 bytes a SHA-256
   `f58eaf76cb26cdcdae343ebaea8830b51d4130e15a437148c8e6ea6904109ff6` a
   vyparsuje exact 1 614 B37 entries jako `(mode,type,oid,path)`; všechny type
   jsou `blob`, object format je `sha1`, právě 1 598 entries má mode `100644`,
   16 má `100755` a odvozených parent directories je 355;
2. enveloped `ls-files --stage -z --` má jen stage `0` a exact stejný sorted
   `(mode,oid,path)` set jako B37 tree; žádná extra stage/path/OID není povolena;
3. no-follow FD-relative walk targetu má exact entry set: 1 614 tracked leaves,
   jejich odvozené parent directories a jediný control leaf `.git`; žádný další
   file, directory, symlink, socket, FIFO, device nebo mount-boundary escape;
4. každý tracked leaf je regular non-symlink, UID/GID `1000/1000`, nlink `1`.
   Při `umask 077` je tree mode `100644` přesně actual `0600` a tree mode
   `100755` přesně actual `0700`; tím je executable-bit parity deterministická.
   Derived directories jsou non-symlink directories stejného ownera bez unsafe
   group/other nebo special bits a jejich actual modes se zapíšou do handoffu;
5. každý leaf se path-lstatne a otevře právě jedním
   `O_RDONLY|O_NOFOLLOW|O_CLOEXEC` FD. Fstat před/po streamu a path lstat po něm
   musí zachovat stejnou identity i všechna pole z §5.4 kromě atime;
   `bytesRead == size`. Actual payload z téhož FD se hashuje s repository Git
   blob framingem `blob <decimal-byte-count>\0<payload>` i SHA-256; object ID
   musí být exact tree/index OID;
6. expected raw Git blob payload se načte enveloped `cat-file --batch` v
   lexikograficky deterministických dávkách nejvýše 128 unique OIDů. Typed parser
   ověří requested OID, type `blob`, declared size, payload a delimiter; pro
   každý path jsou filesystem bytes byte-equal odpovídajícímu raw blob payloadu.

`.git` odpovídá known 104-byte/SHA controlu výše. FS walk, index/tree equality,
Git-framed OID a raw blob comparison jsou čtyři nezávislé proofs; status ani
zero ignored streams samy o sobě full closure nenahrazují.

Všechny phase-bound common config captures z §5.4, refs, packed refs, common
HEAD, objects, index a všechny preexisting worktree control manifests musí být
byte-identické.
Přípustná změna je pouze nový target subtree, nový named admin subtree a parent
directory metadata nutně změněná jejich vytvořením. Canonical branch, všechny
existující worktrees a private root zůstávají byteově nezměněné.

### 5.6 Failure je terminal

Po fixed-subshell launchi je `commandAttemptCount=1` nevratně. Nonzero exit,
signál, target/admin race, hook/config/env drift, index/info/config/mount drift, ignored
output, transformed/mismatched file, partial path, wrong closure nebo jakýkoli
out-of-allowlist Git delta od této hranice spotřebuje jediný
create attempt. Stav se zachová `STOP / FREEZE`; nic se nemaže ani neopravuje a
nespustí se `worktree remove/prune/repair`, cleanup, druhý pokus ani private
repair. Prelaunch failure se řídí §5.1; oba druhy failure vyžadují novou
canonical governance.

Prelaunch failure vytvoří pouze non-filesystem `creatorFailureObservation` s
`authorityConsumed=true`, `commandAttemptCount=0`, `launch=false` a exact failed
gate; obsahuje poslední complete common-config same-FD record, nebo přesný
config/stat/parser/mount gate, na kterém capture selhal. Launched failure
observation má count `1`, exact exit/signal/stdout/stderr, last completed phase a
každý observable partial target/admin/index/FS/common info/config/mount delta.
Ani jeden failure record není verified PASS handoff; nesmí aktivovat
cleanup, retry, prune, repair, unlock ani private transaction.

## 6. Dvoustupňový handoff bez filesystem artefaktu

Successful creator předá verifierovi pouze orchestrator
`creatorObservation`; nevytváří report, sidecar, cache ani jiný soubor.
Creator observation neobsahuje verifier-owned task, exclusions ani budoucí
verdict. Obsahuje exact:

- promoted Decision038 R2 head/tree/report path, blob SHA a content SHA;
- `creatorTask` a exact creator exclusion set;
- `commandAttemptCount=1`, `umask=0077`, exact fourteen-key creation env,
  fifteen creation `-c` overrideů, argv, exit `0`, no-signal a raw
  stdout/stderr bytes/SHA;
- canonical serialization exact fifteen-key no-write read env, fifteen read
  `-c` overrideů, `--no-optional-locks`, read roots/tails/stdin a každý exit;
- target/admin pre-absence a preflight common-Git manifest digests;
- target, admin a common Git paths;
- target, `.git`, celý nový admin subtree a immediate/final same-FD index
  stat/hash/stat closure;
- known six administrative file hashes z §5.5;
- pre/immediate/final `info/attributes` absence a same-FD `info/exclude`
  type/mode/owner/nlink/bytes/SHA/content proof;
- pre/immediate/final common-config same-FD path/FD stat/hash/stat records,
  byte-identical content, parser rejection result, `config.worktree` absence a
  `/home`/`btrfs`/`noatime` mount proof;
- HEAD, tree, detached proof, raw ignored-aware status a oba raw
  ignored/nonignored others stream bytes/SHA;
- tracked count, path-set SHA, flag set, index-stage-vs-tree equality a
  UTF-8/sort/unique proof;
- exact filesystem entry-set manifest; per-leaf type/owner/nlink/actual mode,
  executable parity, byte count, SHA-256, Git-framed OID a raw blob equality;
- derived-directory actual modes, bounded `cat-file --batch` transcript digests
  a full-closure aggregate digest;
- common config, refs, packed refs, objects, common HEAD, common index a všech
  preexisting worktree controls before/after digests;
- `privateCoreTouched=false`, `runnerImportedOrExecuted=false`,
  `runtimeEffects=false`, `push=false`.

Verifier zopakuje všechna filesystemová čtení od nuly a každý Git read provede
výhradně envelopem z §5.3. Před prvním svým Git readem same-FD připne admin
index, info policy inputs a common config, po posledním Git readu je znovu
připne a vyžaduje identity s creator pre/immediate/final captures včetně parseru,
`config.worktree` absence a mount pinu. Znovu provede ignored-aware status,
oba others streams, index/tree equality i celou FS/blob closure a vytvoří vlastní
orchestrator
`verifiedSourceHandoff`. Ten byte-bindne canonical serialization a SHA-256
celého `creatorObservation`, doplní verifier-owned `verifierTask`, exact
verifier exclusion set, creator != verifier, vlastní before/after common-config
same-FD records a jejich cross-phase equality, ostatní recomputed observations,
drift/finding counts a odvozený `verdict=PASS|CHANGES_REQUIRED`. Pouze nulový
drift a nulový P0/P1 dovolí `PASS`; creator self-verdict je zakázaný.

Teprve composite `creatorObservation + verifiedSourceHandoff(PASS)` se předá
materializeru. Ani jedna stage se neukládá do targetu, repo nebo private
parentu. Materializer před jakýmkoli private chmod/edit nejprve same-FD rehashuje
admin index, common info inputs a common config, potom obě stage a full target
closure nezávisle revaliduje pouze §5.3 envelopem a nakonec zopakuje stejnou
same-FD capture; oba materializer boundary records vzniknou před private effectem
a musí být identické se všemi předchozími. Jakýkoli drift zachová
`BLOCKED_BEFORE_TRANSACTION`. Orchestrator handoff sám není private repair
evidence.

## 7. Decision038 acceptance matrix

1. `R38-01` — exact B37/tree, čistý four-path subject a absent reserved report jsou prokázané.
2. `R38-02` — authority gap, frozen OLD/red/core a nespotřebovaná private repair authority jsou byte-bound.
3. `R38-03` — R2 docs DAG/report a live/historical pairwise-distinct task identities jsou exact.
4. `R38-04` — target/admin absence, exclusive writer a pinned common info/config policy inputs jsou prokázané.
5. `R38-05` — creator použije právě jeden exact create envelope a každá role používá exact no-write Git-read envelope.
6. `R38-06` — detached state, immutable index, ignored streams, admin controls a full FS/index/tree/blob/mode closure odpovídají B37.
7. `R38-07` — žádný read ani effect nezmění existující worktree, index, info, ref, config, object, history nebo canonical stav.
8. `R38-08` — creator observation bez verdictu a verifier-owned PASS handoff byte-bindují všechny nové closure proofs bez filesystem artefaktu.
9. `R38-09` — private core/evidence/runtime/import/seal/push/tag/release authority zůstává NONE.
10. `R38-10` — D037 zůstává live base a pouze verified handoff znovu otevře původního `/root/v5_materializer`.

## 8. Povinné negativní fixtures

Každý independent docs review ověří odděleně:

1. `F38-01-TARGET-ALREADY-EXISTS`
2. `F38-02-ADMIN-PATH-ALREADY-EXISTS`
3. `F38-03-DETACH-OR-REUSE-EXISTING-CANONICAL-OR-REVIEW-WORKTREE`
4. `F38-04-SYMBOLIC-HEAD-OR-BRANCH-CREATED`
5. `F38-05-WRONG-COMMIT-TREE-PATH-RELATIVE-FORCE-OR-GUESS-REMOTE`
6. `F38-06-UNCONSTRAINED-HOOKS-CONFIG-OR-ENVIRONMENT`
7. `F38-07-DIRTY-WRONG-COUNT-PATHSET-OR-NON-H-INDEX`
8. `F38-08-EXTRA-COMMON-GIT-REF-CONFIG-OBJECT-OR-PREEXISTING-WORKTREE-DELTA`
9. `F38-09-FAILURE-OR-PARTIAL-THEN-RETRY-CLEANUP-PRUNE-OR-REPAIR`
10. `F38-10-TASK-IDENTITY-COLLISION`
11. `F38-11-PRIVATE-EVIDENCE-RUNTIME-SEAL-IMPORT-OR-PUSH-EFFECT`
12. `F38-12-D038-SUBSTITUTED-AS-LIVE-BASE-OR-1614-PINS-CHANGED`
13. `F38-13-MISSING-OPAQUE-OR-UNVERIFIED-HANDOFF`
14. `F38-14-OPTIONAL-LOCKS-READ-WRITES-INDEX`
15. `F38-15-INFO-ATTRIBUTES-TRANSFORMS-CHECKOUT`
16. `F38-16-INFO-EXCLUDE-HIDES-EXTRA`
17. `F38-17-IGNORED-SCAN-OMITTED`
18. `F38-18-TARGET-BYTES-OR-EXEC-PARITY-DIFFERS-FROM-TREE`

Čtrnáctá fixture je red při jediném Git readu bez obou optional-lock controls
nebo při libovolném index stat/byte driftu, i kdyby porcelain output vypadal
stejně. Patnáctá vkládá common info attribute nebo checkout transform; šestnáctá
nechá pinned info exclude skrýt extra leaf; sedmnáctá vynechá ignored stream
nebo vrátí jeho nonempty byte; osmnáctá zachová clean index/status, ale změní raw
leaf payload, Git-framed OID nebo executable parity. Každý případ musí selhat
nezávisle na normal statusu.

Author tyto fixtures nespouští proti live common Git ani private rootu.
Review je docs/static; případné modelování používá pouze isolated synthetic
bytes bez create effectu.

## 9. Canonical docs-only DAG

Corrective subject `S_H0V5SRC_R2` je direct child `B37` a má exact allowlist:

1. `docs/decisions/038-m1-h0-v5-detached-source-checkout-authority.md`
2. `docs/execution/m1-batch.md`
3. `docs/wp/README.md`
4. `docs/wp/WP-M1-H0-V5-DETACHED-SOURCE-CHECKOUT-AUTHORITY.md`

Reserved report je v `B37` i subjectu absent:

    docs/execution/runs/wp-m1-h0-v5-detached-source-checkout-authority-20260818-report.md

Povinný DAG je:

    B37
      -> S_H0V5SRC_R2
      -> E_A_H0V5SRC_R2
      -> C_H0V5SRC_R2
      -> E_B_H0V5SRC_R2
      -> integration/m1-consolidated-20260810 --ff-only

`E_A_H0V5SRC_R2` je direct child R2 S a mění pouze report exact čtyřmi
LF-terminated řádky:

    integrationRef: integration/m1-consolidated-20260810
    baseRevision: df1863439b6ad83abf41396ba8063e5bffaa599e
    subjectHead: <full-S_H0V5SRC_R2-sha>
    reviewA.verdict: PASS

Smí jej vytvořit pouze fresh `/root/decision038_r2_review_a`. R2 candidate má
ordered parents `[B37,E_A_H0V5SRC_R2]`, je ancestry-bound, má tree exact R2 E_A
a zachová subject/report blobs. `E_B_H0V5SRC_R2` je direct child R2 C a do
stejného reportu připojí právě:

    candidateHead: <full-C_H0V5SRC_R2-sha>
    reviewB.verdict: PASS

Smí jej vytvořit pouze fresh `/root/decision038_r2_review_b`. Writer a oba R2
revieweři jsou distinct; `CHANGES_REQUIRED/BLOCKED` nevytvoří candidate,
promotion ani create authority. Push, tag, release a history rewrite jsou
zakázané.

## 10. Subject gates a pravdivý stav

Před i po subject commitu musí projít:

    exact B37/tree and clean isolated writer worktree
    exact four-path diff; reserved report absent
    frozen V5 OLD triple/evidence/no-seal and red recorder exact
    target/admin any-type absent; no detached B37 worktree exists
    every Decision038 matrix ID exactly once in Decision and WP
    all 18 Decision038 fixture IDs exactly once in Decision and WP
    exact R2 role registry and historical exclusions
    exact 14-key create env / 15 create configs / no optional-lock suppression
    exact 15-key no-write read env / --no-optional-locks / 15 read configs
    exact phase-bound info/config pins, immutable index and full target closure
    node tests/artifact-validation.test.js -> 151/151
    node scripts/validate-test-registry.js --json -> 382 + 8
    node tests/repository-hygiene.test.js -> PASS / 1616 subject paths
    git diff --check -> PASS

Tyto gates jsou read-only vůči common Git/private/runtime s výjimkou běžného
docs subject commitu v izolovaném writer worktree. Nespouštějí create attempt,
runner, hook, provider ani runtime.

Pravdivý stav do canonical promotion je:

    D038 SOURCE CHECKOUT: NOT CREATED / R1 CHANGES_REQUIRED / R2 AUTHORITY PENDING REVIEW
    D037 PRIVATE REPAIR: BLOCKED_BEFORE_TRANSACTION / UNCONSUMED
    V5: PRESEAL_CHANGES_REQUIRED / UNSEALED / DO_NOT_EXECUTE
    RUNTIME / ACCEPTANCE / RETRY / T3 / GATES: NO_AUTHORITY

## 11. Transparentní author evidence

R2 autor provedl pouze read-only inventuru a docs edit v novém isolated R2
writer worktree přímo z B37. Target ani admin path nevytvořil; exact create argv
ani negativní fixtures nespustil. Operational poststate je proto
`NOT_RUN / UNVERIFIED` až do promoted Decision038 R2 a práce distinct
creatora/verifiera. Autor zároveň
zachoval chybně zadaný první read-only lookup private V5 rootu jako tooling
incident: neexistující zkrácená cesta vrátila error; následný lookup použil
canonical `m1-h0-headless-no-model-v5-*` cestu a nic nezměnil.

První dvě fresh precommit review nad frozen four-file snapshotem skončily
pravdivě `CHANGES_REQUIRED`: structural `P0=0/P1=1` za nepravdivý exact-two
checkout claim a semantic `P0=0/P1=2` za nejednoznačnou consumption boundary a
creatorův budoucí verifier verdict. Tento bounded patch opravuje všechny tři
findings, ale nesmí být commitnut bez nových zero-based rechecků. Structural
reviewer při read-only fsck omylem vytvořil `/tmp/d038_fsck_output` a následně
jej odstranil; repo, common Git, private root ani runtime to nezměnilo a temp
file není evidence.

Opravený R1 subject `704dfa70e5d1856d98308315e1f030eb952f8ccf` pak prošel dvěma
zero-based precommit audity `PASS`, ale fresh Review A nad committed bytes
později správně vydal `CHANGES_REQUIRED`, `P0=0/P1=2`, s exact findings
`P1-01 POSTSTATE-READS-NOT-READONLY` a
`P1-02 CHECKOUT-ATTRIBUTE-IGNORE-CLOSURE-INCOMPLETE`. Report/E_A nevznikly a
R1 historie zůstává zachovaná.

Při alokaci R2 worktree uspěl `git worktree add`, ale následná verify část
stejného shellového řetězce běžela z `/home/belphareon/Projects` a vrátila
`fatal: not a git repository`; creator neopakoval add a existující R2 registraci
následně jen read-only ověřil z exact worktree. První pokus přenést R1 docs přes
`apply_patch` použil chybnou relativní cestu pod `Projects` a selhal atomicky
před zápisem; opravený path patch pak přenesl exact four-file bytes. Ani incident
neměl private, runtime, target/admin nebo remote effect. Tento R2 patch nesmí být
commitnut bez dvou nových zero-based precommit auditů.

Writer, coordinator i contract-map auditor před úplným zakódováním §5.3 použili
plain `git status` uvnitř R2 docs-authoring worktree. Contract-map auditor tehdy
pouze po příkazu zaznamenal prior pre-staging tuple inode `13981295`, size
`183391` a SHA-256
`5cd04a4f4ffcc41e689f0d60159fa268c096c6d578f2189b3637ffcd740521a1`;
pre-command digest neexistuje a tuple neprokazuje byte immutability. Pozdější
autorizovaný staging writer index nahradil, jak se u stagingu očekává. Writer
index je non-normative a zcela vyloučený ze subject evidence; žádný current
writer-index pin se zde netvrdí. Jde o non-evidence tooling-method incident mimo
absent reserved operational target/admin, private root a runtime.

První fresh R2 precommit audity nad staged snapshotem skončily pravdivě
`CHANGES_REQUIRED`: structural `P0=0/P1=1` našel self-referenční a po stagingu
nepravdivý current writer-index claim; semantic `P0=0/P1=2` potvrdil tentýž
finding a navíc chybějící explicitní common-config same-FD pin ve všech
creator/verifier/materializer fázích. Tento bounded patch opravuje pouze tyto dvě
třídy; commit zůstává zakázaný do dvou nových zero-based auditů.

Jedna mechanická parity kontrola vložila Markdown fence regex
<code>^```bash$</code> do
JavaScript template stringu a wrapper skončil přesně
`Script error: SyntaxError: Unexpected identifier 'bash$'`; shell command se
vůbec nespustil a snapshot se nezměnil. Pozdější multi-file `apply_patch` pro
advisory-lock/handoff prose nenašel jeden WP context a selhal atomicky; stejné
změny pak prošly ve dvou bounded patchích bez partial stavu. Ani incident není
verification evidence.

První stale-pattern scan měl neescapovaný backtick v double-quoted shell regexu
a Bash jej zastavil `unexpected EOF while looking for matching backtick` ještě
před spuštěním `rg`; single-quoted opakování uspělo a snapshot se nezměnil.
První freeze-inventory wrapper následně vložil neescapovanou shell-array
interpolaci do JavaScript template literálu a skončil před shell launch přesně
`Script error: SyntaxError: Invalid or unexpected token`; žádný gate ani command
se nespustil a staged/repo/private/runtime stav se nezměnil.
