# Dávkové zadání M1 — autonomní běh s odloženým review

**Určeno pro:** operátor (schválení) → agentní běhy (provedení)
**Vstup:** `ROADMAP.md` v4, `CONTRACT.md` §7, uzavřené `WP-M0-E` opravy
**Cíl dávky:** ~5 zapisujících WP + 1 read-only stopa proběhnou bez operátorského
vstupu; operátor vstoupí až na dvou review gates.
**Cílový umístění v repu:** `docs/execution/m1-batch.md` (založit až až bude
volný zapisující vlastník)

**Operátorský stav 2026-08-08:** tento M1 batch a volby 001–014 jsou přijaté
jako omezená prováděcí autorita. Plné přijetí `ROADMAP.md` v4 tím není
nahrazené. Follow-upy níže se provádějí po malých sériových checkpointech a
žádný vybraný BLOCK se nestává PASS bez implementace a důkazu.

**M1 closeout amendment 2026-08-11:** operátor přijal celý
`M1-CLOSEOUT-X1` včetně 026/029, B3–B6 a execution hranic a doplnil
`AUTONOMY-STOP-EXTRA-1` a `AUTONOMY-REVIEW-1`. Tento blok je normativní pro
closeout a při rozporu nahrazuje starší brief níže; nemění neprovedený krok na
PASS. Přesné pořadí je
`026 → 029 → B3 → B4 → Gate 1 → B5 → B6 → Gate 2`.
029 dual CAS vědomě nahrazuje dřívější single-revision 029/A a standalone
`chats/ = unsupported / not shipped` je vědomě přijatá změna support claimu.

---

## 0. Jak se to používá

Každý brief v §4 je samostatný, vložitelný prompt pro jeden agentní běh. Běhy
jdou **sériově** — jedno zapisující vlastnictví v jednom worktree. Agent se
během běhu neptá. Jediný kanál zpět k operátorovi je **rozhodovací fronta**
(`docs/decisions/`), kterou operátor přečte na review gate.

Dávka končí na M1 exit. M2 briefy se teď nepíšou: jejich WP konzumují
`EffectRequest/Result` a `ProjectContextQuery/Snapshot`, které ještě neexistují —
předepisovat je před freeze M1 connectoru by byly přesně ty „stovky
předvyplněných záznamů", které `ROADMAP.md` §2 zakazuje. Místo toho běží
paralelní read-only stopa **P1**, která pro M2 připraví důkazy.

---

## 1. Protokol autonomie

Roadmapa má u každého WP `Stop condition`. Doslova vzato zastaví běh u první
nejasnosti a dávka se rozpadne po dvaceti minutách. Tento protokol každou
zastávku zařadí do jedné ze čtyř tříd. **Zařazení je součástí zadání, ne
úvahy agenta za běhu** — každý brief má v §4 svůj seznam.

### BLOCK — zastavit dotčenou část, nehádat

Agent zapíše `docs/decisions/NNN-<slug>.md`, zastaví **jen** dotčenou část WP a
pokračuje nezávislými částmi. Když je zablokované jádro WP, ukončí běh se
stavem `BLOCKED` a přejde na další brief v pořadí.

Blokuje vždy a bez výjimky:

- změna L0 invariantu (`CONTRACT.md` §2);
- oslabení bezpečnostního guardu, testu nebo boundary, ať už jako „dočasné";
- nová runtime nebo test dependency;
- nejednoznačnost v tom, čí data se čtou/zapisují nebo kam mohou odtéct;
- akce nad zálohovanými/uživatelskými soubory, které nejdou vrátit;
- GPU stav, který nelze bezpečně obnovit;
- zjištění, které zpochybňuje směr WP jako celku (např. že měřený problém
  neexistuje).

### DECIDE-AND-CONTINUE — vzít vratný default, zapsat, pokračovat

Použitelné **jen** když je splněná podmínka švu: *alternativa je dosažitelná
změnou uvnitř jednoho pojmenovaného souboru/funkce plus jejích testů.* Švy jsou
předepsané v briefu; agent nové švy nevymýšlí.

Pravidlo výběru defaultu: **default je ta varianta, která se nejlevněji ruší, ne
ta, která vypadá líp.** Když jsou obě stejně vratné, vybere se ta, která
o systému tvrdí méně.

### PARK — vyhodit položku ze scope, pokračovat zbytkem

Když je jedna položka WP zablokovaná, ale zbytek na ní nestojí. Zapíše se
`docs/decisions/` záznam s `typ: PARK` a explicitním „co tím zůstává
neověřené". Nesmí se použít na položku, kterou brief označí jako `povinná`.

### FINDING — vada mimo povolené cesty

Nastane skoro jistě (CHAT najde vadu ve WS, MODEL v routes). Agent **neopraví
a nerozšíří scope**. Zapíše `docs/findings/NNN-<slug>.md` s minimální reprodukcí
a vlastníkem podle roadmapy. Když kvůli tomu nový test padá, test se
**nesmaže ani neoslabí** — označí se v hlavičce `PENDING-OWNER: WP-M1-XXX` a
zaregistruje jako známý červený s odkazem na finding.

### Formát rozhodovacího záznamu

```markdown
# NNN — <věta, co se rozhoduje>

- **typ:** BLOCK | DECIDE | PARK
- **WP:** WP-M1-XXX
- **rail:** R1..R7, kterých se týká
- **vzniklo při:** <konkrétní krok / test / soubor:řádek>

## Evidence na stole
<co agent skutečně naměřil nebo přečetl; ne dojem>

## Varianty
| Varianta | Chování | Dopad na rails | Cena zavedení |
|---|---|---|---|

## Vzatý default a proč
<která varianta a proč je nejvratnější>

## Šev
<soubor:funkce, kterou stačí změnit>

## Cena přepnutí, když operátor rozhodne jinak
<seznam souborů + testů + odhad; musí být konkrétní, ne „malá">
```

**Zakázané způsoby, jak rozhodnutí „vyřešit":** oslabit test, rozšířit povolené
cesty, označit schopnost jako PASS, přepsat roadmapu tak, aby otázka zmizela.

### M1-CLOSEOUT-X1 — autonomie, review a poslední manifest

Uvnitř schváleného WP agent autonomně volí fail-closed, preserve-data,
no-replay, no-network a nejvratnější kompatibilní variantu. Neeskaluje znovu
error codes, helper API, interní pořadí, fixtures, retry/no-op nebo jiné
implementační detaily. Vadu uvnitř allowlistu opraví a nechá nezávisle
zreviewovat; vady mimo scope sesbírá do jednoho balíku místo jednotlivých
zastavení.

Closeout se zastaví pouze při:

- nové veřejné capability nebo connectoru;
- změně L0;
- nevratném smazání dat;
- external network effectu;
- model pull/delete/rebind;
- změně support claimu;
- neřešitelném source conflictu;
- přidání, zeslabení nebo obejití auth guardu, access boundary či trusted-local
  kontraktu.

Poslední bod neblokuje opravu uvnitř schváleného allowlistu a již přijaté
hranice; změna bezpečnostní/autentizační hranice samotné se nesmí odvodit jako
implementační detail.

Nezávislé review vždy znamená `writer != reviewer`. Jakákoli nová změna
allowlistu přistane vlastním governance/docs commitem **před** source writerem,
nikoli uvnitř reviewovaného subjectu. Výslovně vyjmenovaná rozšíření v
`026-ALLOWLIST-EXTENSIONS` už tímto commitem přijata jsou a další rozhodnutí
nepotřebují.

Pro tento amendment je topologie připnutá: governance commit `G` vznikne jako
sibling P0 commitu z exact společného rodiče
`ea21bf3e2f8a54e1cbf93430cdb52037957a63c8`, projde vlastním nezávislým review
a promotion a teprve potom se běžným merge commitem bez rebase, cherry-picku
nebo jiného history rewrite připojí do existující P0 branch s commitem
`3bb35bbb32063dd058ab35872668d645fe9ff106`. Merge zachová exact P0 commit jako
ancestor i identitu. Finální 026 Review A použije promoted `G` jako
`baseRevision` a `S` jako `subjectHead`; review range je `G..S`, takže samotný
governance commit není uvnitř source subjectu a P0 v něm naopak zůstává přes
merge ancestry. P0 se tím samostatně nepromuje.

Po splnění tehdy známých predecessorů byly pro společný redigovaný
`M1-EXECUTION-MANIFEST` vymezené dvě datově závislé operátorské volby:

1. exact source/path/digest akce pro skutečně nalezené legacy hodnoty;
2. exact aktuální desired binding a dostupný distinct fallback target včetně
   potřebných proof pinů.

Manifest nenese raw secret a není blanket purge ani model selection authority.
Bez exact digestů se příslušná akce neprovede. Všechna ostatní rozhodnutí tohoto
closeoutu jsou přijatá níže nebo v decision 026/029 a znovu se neotvírají.
Později nalezený 031 DB predecessor je samostatná třetí data-recovery acceptance
hranice před tímto manifestem; její historical authority gap je zaznamenaný
níže a nesmí se zpětně zahrnout do těchto dvou voleb.

Closeout smí vytvářet bounded WP branches, commity, push, Review A/B a merge
queue evidence podle `CONTRACT.md`. External network zůstává vypnutá;
GPU/Ollama/Electron joby jsou sériové. Ukončovat se smějí jen test-owned process
groups. Zakázaný je force-push, tag, release, history rewrite a model
pull/delete/stop/unload/rebind. Uživatelská data se mimo později vymezený exact
031 recovery scope nemutují a failure artefakty se zachovají. Reconciliation
031 effectu nepovoluje opakování a jeho chybějící předchozí autoritu nemaže.

### M1-CHAT-EVIDENCE-RECOVERY-X1 — jednorázový predecessor resetu

Operátor 2026-08-12 přijal
[`M1-CHAT-EVIDENCE-RECOVERY-X1 + X1-a + X1-b`](../decisions/030-m1-chats-evidence-envelope-recovery.md).
Canonical integration omylem fast-forwardla na
`I=39776f1e90e425bd91a7be707edc556a299869bd`: direct child správného
`C_CHAT=578876dd77c68df4bdcf6239383fa782b649f843`, který mění pouze chats report,
ale připojuje 25 řádků narativu před dvěma povinnými metadata řádky. Tím porušuje
byte-exact `assert_report_append`; behavior candidate ani corrected Review B
PASS nejsou zpochybněné.

Před resetem se proto sériově provede
[`WP-M1-CHATS-EVIDENCE-RECOVERY`](../wp/WP-M1-CHATS-EVIDENCE-RECOVERY.md):

1. `G_REC` jako direct child `I` uchová 25 řádků verbatim v governance
   decision, projde vlastním nezávislým docs-only review a nezmění target
   report ani žádnou z dvanácti reset-relevantních transfer paths;
2. `X` jako direct child `C_CHAT` vytvoří correct `E_B_CHAT` s exact report
   blobem `04b839db53abcbce510a9d57d7b750f20e2c6f9d` a root tree
   `118a7b5007cfcb75baad0ce894b2e3bbd5517e72`; corrected behavior Review B se
   znovu nespouští;
3. `R_REC` má exact parent order `[G_REC, X]`, report byte-identický s `X` a
   každý non-report path byte-identický s `G_REC`;
4. integration se posune pouze fast-forwardem `I -> G_REC -> R_REC`.

Invalidní 27řádkový report z `I` zůstane dohledatelný v historii, ale nesmí být
v resulting canonical tree. Jen metadata-ověřený a fast-forward promováný
`R_REC` je přípustný `baseRevision` resetu. Rebase, cherry-pick, amend,
force-push, history rewrite, source/test změna a nový behavior run jsou
zakázané. Rozpracovaný dvanácticestný reset diff se zachová bez druhého reset
worktree: privátní disk patch + SHA, reverse-apply owned diffu, čistý `--ff-only`
posun stávající branche `I -> R_REC`, jedno reapply a exact path/digest gate.
`stash`, `reset --hard`, force update ani ruční přepis patch artifactu nejsou
povolené. Recovery nemění pořadí zbytku closeoutu:
`R_REC → 029 reset → B3 → execution manifest → B4 → Gate 1 → B5 → B6 → Gate 2`.

---

### B3 terminal failover activation — 2026-08-12

026, chats recovery/decommission a dual-CAS reset jsou promoted na canonical
tipu `6c36607421c013dd27f41e35853009bcaa0b5b51`. Samostatný
[`WP-M1-MODEL-TERMINAL-FAILOVER`](../wp/WP-M1-MODEL-TERMINAL-FAILOVER.md) je
aktivovaný z tohoto exact base. Jeho docs-only activation commit je vlastní
governance predecessor source writeru a nemění L0-9, connector ani
auth/access/trusted-local boundary.

WP rezervuje migraci 065, exact per-role target CAS, terminal
activation/restore lifecycle, úplnou transitivní proof source closure, mobile
late-insertion důkaz a oddělenou Phase A/B evidence. Aktivace sama není
implementation, proof issuance, model effect, GPU evidence ani Gate 1 PASS.

### Pre-manifest C3 DB foreign-key recovery — 2026-08-12

Po promotion B3 Phase A odkryl read-only real-data preflight nový predecessor:
explicitně nakonfigurovaná
`/home/belphareon/Projects/c3-agent-wip/data/c3.db` je na latest 044 a má 46
preexistujících FK violations. Private-copy direct migration commitnula
045–054 a 061, potom fail-closed skončila na 062; 064/065 nebyly spuštěné.
Přímý live migration run by proto zanechal partial schema a je zakázaný.

Samostatná proposed
[`decision 031`](../decisions/031-m1-pre-manifest-fk-recovery.md) a
[`WP-M1-PRE-MANIFEST-FK-RECOVERY`](../wp/WP-M1-PRE-MANIFEST-FK-RECOVERY.md)
oddělují tuto data mutation od promovaného 026 source důkazu i B3 Phase B
modelové hranice. Preserve-subtree varianta má nezávislý `CHANGES_REQUIRED`;
quarantine varianta má writer i independent
`PASS_FOR_PINNED_PRIVATE_SNAPSHOT`, ale live freshness neprokazuje. Tento
docs-only amendment sám nepovoluje live mutation.

Před prvním chmod/write je kumulativně povinné: independent docs PASS,
canonical fast-forward promotion, fresh no-handle/no-drift live plan a exact
operátorská akceptace jeho SHA-256. Akceptovaný plán teprve smí hardenovat
permissions, vytvořit private backup/quarantine, v jedné transakci odstranit
exact 34 orphan API rows a 7 orphan architecture rows, zachovat konverzaci s
jedním `project_id -> NULL` a jedním no-retry migration invocation dojít do
065. Unresolved `300 API / 48 milestone IDs / 0 milestones / 0 joins` zůstává
explicitní dluh.

Závazná closeout hrana se tím zpřesňuje na:

```text
B3 Phase A promotion
  -> 031 docs review + canonical promotion
  -> exact operator-accepted FK recovery plan
  -> successful FK recovery + latest 065
  -> separate explicit 026 authority for credential census once + plan once
  -> one M1-EXECUTION-MANIFEST (credentials + model)
  -> B3 Phase B
  -> B4 -> Gate 1 -> B5 -> B6 -> Gate 2
```

Recovery plan není druhý M1 execution manifest. Pozdější manifest zůstává
jediný, digest-bound a raw-secret-free; 031 nepředvybírá fallback model. Při
driftu, failure nebo neúplné akceptaci je stav `STOP/BLOCKED`, ne implicitní
preserve, delete, migration nebo PASS.

031 docs/promotion, recovery plán, jeho operátorské přijetí ani recovery PASS
nepovolují credential census, plan nebo apply. PASS pouze splní databázový
prerequisite. Census+plan vyžadují následnou samostatnou explicitní 026
autoritu; apply až zvlášť přijatý exact `M1-EXECUTION-MANIFEST`.

Historické cleanup pokusy včetně overall
`PARTIAL_SOURCE_SHM_METADATA_TOUCH`, odmítnutého unbound runneru a harness
failures zůstávají zachované; B3 PASS je zpětně nepřeznačuje. B3 Phase B dál
běží jen nad disposable file-backed DB/runtime a user DB/config se v ní
nemění.

### M1 closeout evidence reconciliation — 2026-08-17

Reconciliation inventura vyšla z čistého canonical checkoutu na
`5b375c9e730fea2efcab3ab2549e4cd53afda5a3`, který sledoval
`origin/integration/m1-consolidated-20260810`. V tomto inventory snapshotu to
nebyla integrace do lokálně pozorovaného `origin/main` na
`6676902c5f6fe7a5d66aba0d79cb502e0f3a60e4`; ten M1 ancestry neobsahoval.

Evidence recovery a 029 reset jsou promoted; B3 Phase A má Review A+B PASS.
Pozdější filesystem a private evidence ale odhalily canonical rozpor, který se
nesmí skrýt:

- 031 technical recovery dosáhla
  `PASS_RECOVERY_PREREQUISITE_ONLY_NO_AUTO_RESTART`, ale povinná předchozí
  docs promotion a exact acceptance finálního plan SHA nejsou canonical-bound;
- joint manifest SHA-256
  `fbe9e33f761b073c73093cac6455ae7a77faa102f95a6be33cd5837ef559e486`
  je byte-valid, ale jeho canonical exact acceptance evidence je
  `UNBOUND/UNKNOWN`;
- Phase B zůstává `STOPPED_T3_TERMINAL_FAILURE`: desktopové T3
  `FAIL/BLOCKED/FAIL`, potom dva fail-closed pre-T3 headless orchestration
  failures; druhý terminálně vyčerpal §7.3 handoff na pre-load desktop gate;
- birth-time attestace obou literal-`TXXXXXXZ` roots existuje, ale musí být v
  tomto reconciliation kole poprvé durable nezávisle ověřena.

Operátor zvolil
[`decision 032 / variantu A`](../decisions/032-m1-closeout-authority-gap-reconciliation.md):
nejdřív docs-only reconciliation s odděleným `TECHNICAL_PASS / AUTHORITY_GAP`,
canonical digest bindingem a Review A+B; žádná historical authority se tím
nevyrábí. Exact pořadí aktuálního closeoutu je:

```text
5b375c9e clean integration base
  -> S_REC docs-only reconciliation
  -> E_A_REC independent Review A report-only
  -> C_REC merge + integration-owned current-state summaries
  -> E_B_REC independent Review B report-only
  -> local canonical --ff-only promotion
  -> H0 V1 static materialization + two independent CHANGES_REQUIRED reviews
  -> decision 033 S_H0R -> E_A_H0R -> C_H0R -> E_B_H0R -> canonical promotion
  -> exactly one V2 non-clobber partial static materialization
  -> two independent V2 contract reviews: CHANGES_REQUIRED; V2 frozen unsealed
  -> decision 034 S_H0M -> E_A_H0M -> C_H0M -> E_B_H0M -> canonical promotion
  -> exactly one V3 non-clobber static materialization
  -> two independent V3 reviews: CHANGES_REQUIRED; V3 sealed/frozen/no runtime
  -> decision 035 S_H0Q -> E_A_H0Q -> C_H0Q -> E_B_H0Q -> canonical promotion
  -> exactly one V4 non-clobber static materialization
  -> V4 Review A CHANGES_REQUIRED + Review B PASS; aggregate red/frozen/no runtime
  -> decision 036 S_H0P -> E_A_H0P -> C_H0P -> E_B_H0P -> canonical promotion
  -> exactly one V5 non-clobber static materialization
  -> formal PRESEAL CHANGES_REQUIRED; sole V5 root frozen unsealed/no runtime
  -> decision 037 S_H0V5R -> E_A_H0V5R -> C_H0V5R -> E_B_H0V5R -> canonical promotion
  -> authentic old-red recorder; repair preflight stops before transaction on missing detached source
  -> decision 038 R1 S_H0V5SRC Review A CHANGES_REQUIRED; no report/E_A/authority
  -> decision 038 R2 S_H0V5SRC_R2 -> E_A_H0V5SRC_R2 -> C_H0V5SRC_R2 -> E_B_H0V5SRC_R2 -> canonical promotion
  -> exactly one fixed D037-E_B locked detached source-worktree create attempt
  -> fresh distinct source-worktree verification + non-filesystem structured handoff
  -> exactly one same-root three-core repair
  -> fresh distinct PRESEAL_READY over repaired bytes
  -> seal binding both old-red and fresh-ready recorders
  -> two independent post-seal V5 static reviews
  -> S_V5 -> E_A_V5 -> C_V5 -> E_B_V5 -> canonical promotion
  -> fresh SSH/logout preflight + exact GUI-saved operator declaration
  -> S_ACC receipt+detached digest -> E_A_ACC -> C_ACC -> E_B_ACC -> canonical promotion
  -> immediate same-boot/no-drift gate -> at most one H0 run
  -> independent H0 result review
  -> only after H0 PASS: separate new T3 authority decision
  -> only after headless T3 PASS: remaining Phase B -> B4 -> Gate 1 -> B5 -> B6 -> Gate 2
```

H0 je nový diagnostic-only no-model baseline, nikoli Q4 ani T3 retry. Tato
reconciliation jej sama nepovoluje. Credential apply a 031 recovery se
neopakují; B4, Gate 1, B5, B6 a Gate 2 zůstávají zamčené.

První H0 static root byl materializován přesně jednou pod decision 032, ale
formální regression review i nezávislý effect-callgraph review skončily
`CHANGES_REQUIRED`. V1 plan SHA-256 `6a25cac18e41f066f3d9a2f638b9c95b64a3c3588f842578acfa87ad513bd664`,
runner SHA-256 `0afbae84d37b99bd9f5effc32aac44c1397a0d4555011393ce40b75cb3a9a302`
a manifest SHA-256 `afcda074e6b25373d93a127355d17b6751e4808c7c95c3e81077693149303219`
jsou canonical-bound v [decision 033](../decisions/033-m1-h0-static-remediation.md).
Evidence adresář zůstal prázdný: žádný runner mode, runtime, acceptance ani live
effect neproběhl. V1 je `DO_NOT_EXECUTE` a one-plan allowance z 032 je
spotřebované.

Decision 033 byla docs-only remediation gate. Její independent Review A+B a
canonical promotion povolily jediný nový V2 private non-clobber **static**
root. Prospective V2 contract požadoval opravit canonical runtime receipt,
direct-post effect escape, immediate cumulative pre-isolate revalidation,
own-unit safety stop, pre-pinned restore, orphan-PASS/failure closure, full
pre-effect root/runtime binding, strict NVIDIA parsing, pravdivé timeout bounds
a RustDesk broad `ExecStop`/`KillMode=mixed` přes odděleně reviewovanou bounded
strategii. Promoted 033 nikdy nepovolilo H0 runtime, T3 nebo Gate 1.

Jediný 033 V2 RustDesk strategy candidate byl exact 43-byte runtime drop-in
`/run/systemd/system/rustdesk.service.d/90-intentsmith-h0-v2.conf` se SHA-256
`87f751ac676773104bbc400e38208057d4d12f8a702b8aeb4ae965984b00a9dc`, který
vyprázdní `ExecStop` a dočasně nastaví `KillMode=control-group`. Jeho `/run`
create/remove, daemon-reloads, isolate, sole stop, start a reconnect 033
neautorizovalo. Plánovaný řetězec dvou V2 static PASS, canonical promotion,
fresh SSH/logout, exact user block a tracked
`S_ACC -> E_A_ACC -> C_ACC -> E_B_ACC -> canonical --ff-only` receipt nikdy
nevznikl, protože V2 skončila před sealem `CHANGES_REQUIRED`. `systemctl kill`
ani V1/032 authority nejsou povolený bypass.

Decision 033 byla Review A+B PASS promoted na canonical tipu
`61bf4729af159000d1b2e9200c1a7d6d72f8df5e`. Její jediná V2 materializační
autorita byla spotřebovaná rootem
`/home/belphareon/.local/share/intentsmith-private/m1-h0-headless-no-model-v2-20260817T192545Z.ecpyfuh7`.
Materializace zůstala partial: runner SHA-256
`395e41c5da40bd40a02ff49ac010eb054a9022b97ade7a6432b77bb243c99b4a`
má 251 722 bytes/mode `0664`, strategy SHA-256
`59b91db84fb4b7d5758039844cd077bedd3696080365fdf28a466abc41f7221d`
má 8 606 bytes/mode `0664`; `plan/` a `evidence/` jsou empty a neexistuje
plan, detached digest, manifest ani seal. Žádný runtime nebo live effect
neproběhl.

Dvě independent contract review identity `/root/h0_static_adversary` a
`/root/systemd_contract_audit` skončily `CHANGES_REQUIRED_UNSEALED` a
`CHANGES_REQUIRED`. Recorder bundles jsou pouze non-authoritative záznam jejich
zpráv. Primární P0 je strukturální: `ExecStopPost` dostává fresh same-policy
filesystem namespace; exact child `ReadWritePaths` nelze odstranit, protože je
buď mountpoint (`EBUSY`), nebo by `rmdir` zapisoval do read-only parentu
(`EROFS`). V2 navíc neuzavřela exact ledger `argvClass`, recomputed
before/after, unique fixed-result binding ani plnou sample/fixed validation.
V2 je proto
`STATIC_CHANGES_REQUIRED_UNSEALED / NO_RUNTIME / DO_NOT_CONTINUE / NO_ACCEPTANCE`
a nesmí se doplnit nebo spustit.

[`Decision 034`](../decisions/034-m1-h0-v2-mount-namespace-remediation.md) je nový
docs-only amendment bez runtime authority. V3 zachová `ProtectSystem=strict` a
`ReadWritePaths` přesně evidence + exact child. Sandboxed `ExecStopPost` smí
dokončit restore, unlink exact V3 file, fsync child, cleanup reload a publikovat
pouze non-PASS `EMPTY_RUNTIME_DIR_PENDING_OUTER_RMDIR`. Teprve po
`systemd-run --wait`, exact terminal/deactivated/no-PID/job/cgroup proofu a
receipt/config closure smí outer v host namespace odstranit stejný empty inode,
fsyncnout parent, dokončit proof, druhý strict `ollama ps`, seal a
absolute-last marker. Broad parent RW, `+` command, parent FD pass,
`RuntimeDirectory`, helper unit, namespace escape, unmount a V2 continuation
jsou zakázané.

V3 amendment musí nejprve projít vlastním
`S_H0M -> E_A_H0M -> C_H0M -> E_B_H0M -> canonical --ff-only` řetězcem. Až
potom smí vzniknout právě jeden nový V3 static root. V3 stále potřebuje dvě
independent static review, vlastní canonical promotion a oddělený promoted
acceptance receipt po fresh SSH/logout a all-system graphical absence
preflightu. B3 Phase B zůstává `STOPPED_T3_TERMINAL_FAILURE`; B4, Gate 1, B5,
B6 a Gate 2 zůstávají `BLOCKED`.

Decision 034 byla Review A+B PASS promoted na canonical tipu
`6feed197f524dbe885e12e1dcd31d996777d4a13`. Její jediná V3 materializační
autorita byla spotřebovaná sealed rootem
`/home/belphareon/.local/share/intentsmith-private/m1-h0-headless-no-model-v3-20260817T214721Z.f41t4nd1`.
Plan `de8299d80...`, runner `4a241468...`, strategy `99c73d2e...` a manifest
`5f4ab9b6...` mají validní owner-only closure a `evidence/` je empty. Žádný
runtime ani live effect neproběhl. Writer však root sealnul před dokončením
independent preseal auditu; tento premature-seal workflow incident je povinná
failure evidence, ne PASS.

Dvě následné source/AST review skončily `CHANGES_REQUIRED`. V3 non-daemon
identity worker může po bounded join zůstat živý a přesto dovolit failure seal,
zatímco dál provádí `systemctl show` a mění shared capture. Review B navíc
prokázalo, že marker exception po digest fsync může spadnout do outer catch,
který znovu publikuje evidence a volá další seal. PASS je fail-closed, ale
failure closure a V3-08/V3-09/V3-25 nejsou splněné. V3 je proto
`STATIC_CHANGES_REQUIRED / SEALED / NO_RUNTIME / DO_NOT_EXECUTE / NO_ACCEPTANCE`
a nesmí se opravit in-place.

[`Decision 035`](../decisions/035-m1-h0-v3-worker-quiescence-remediation.md) je
docs-only prospective amendment bez runtime authority. Zachovává 034 mount
split, ale V4 zakazuje background thread/executor/shared capture, vyžaduje
main-owned client s terminal+reap proofem před result/seal a zavádí
jednosměrnou terminal fázi: po manifestu jen digest, final marker, fsync a
immediate exit. Neprokázaná quiescence nebo marker failure zůstává
`OUTCOME_UNSEALED/UNKNOWN` bez publish/retry.

Decision 035 musí nejprve projít
`S_H0Q -> E_A_H0Q -> C_H0Q -> E_B_H0Q -> canonical --ff-only`. Až potom smí
vzniknout právě jeden V4 static root. V4 dále potřebuje dvě independent static
review, canonical receipt a oddělený accepted runtime řetězec po fresh
SSH/logout preflightu. B3 Phase B zůstává `STOPPED_T3_TERMINAL_FAILURE`; B4,
Gate 1, B5, B6 a Gate 2 zůstávají `BLOCKED`.

První Decision 035 candidate `d162440b40eebdd8410d5356cb705742824610bc`
skončil v Review B `CHANGES_REQUIRED`: úvodní WP summary nesprávně vyžadoval
client reap před inner `unit-post` terminal receiptem. Report zůstal pouze
Review-A 4-line evidence; nevznikl E_B ani promotion. R2 opravuje summary na
pravdivé pořadí `unit-post -> systemd-run return/reap -> outer closure` a musí
projít novými Review A+B; původní red candidate zůstává zachovaný.

Decision 035 R2 následně prošla Review A+B a byla canonical promovovaná na
`ffe02f8c23b3c208cf6420d8857b85ca1ccb54b5`. Její jediná V4 autorita je
spotřebovaná birth-time-honest sealed rootem
`/home/belphareon/.local/share/intentsmith-private/m1-h0-headless-no-model-v4-20260818T013800Z.sws2y8cf`.
Plan `98379e46...`, runner `534332e8...`, strategy `3d2ae8d1...` a
manifest `1c5450bd...` mají validní owner-only closure a `evidence/` je
empty. Žádný runtime ani live effect neproběhl.

Dvě independent V4 static review zůstávají záměrně divergentní: Review A
`CHANGES_REQUIRED`, Review B `PASS`. Review A prokázala
`COMMON_MODE_NORMATIVE_PROJECTION_DRIFT`: plan a strategy mají nula exact
`CLIENT_QUIESCED` tokenů a spolu s runner self-validací pinují stale
osmiprvkový V3-style positive graph SHA-256 `5d221939...`, zatímco runner
invariant reálně vynucuje. Povinné dvě PASS proto nevznikly; V4 je
`STATIC_CHANGES_REQUIRED / SEALED / NO_RUNTIME / DO_NOT_EXECUTE`.

Nová
[decision 036](../decisions/036-m1-h0-v4-lifecycle-projection-remediation.md)
je docs-only prospective amendment bez runtime authority. V5 musí přesně
projektovat 15-node decision-035:335–344 lifecycle SHA-256
`492645f2...` napříč plan-side client phases, semantic receipt contracts a
key lists, strategy/manifest/static/acceptance/operator receipts, actual AST
dominancí a source-derived budgetem. Po canonical
`S_H0P -> E_A_H0P -> C_H0P -> E_B_H0P` smí vzniknout nejvýše jeden V5
static root; před sealem jej drží independent preseal review a po sealu jsou
nutné dvě další distinct static review. B3 Phase B zůstává
`STOPPED_T3_TERMINAL_FAILURE`; B4, Gate 1, B5, B6 a Gate 2 zůstávají
`BLOCKED`.

Jediný V5 root vznikl birth-time-honest jako
`m1-h0-headless-no-model-v5-20260818T083250Z.56131a74`, ale formální preseal
skončil `CHANGES_REQUIRED`. Frozen plan `c4764b58...`, runner `0d02ddb9...` a
strategy `26898ebc...` zůstávají unsealed; evidence je empty a žádný detached
digest ani manifest nevznikl. Povinný budget validator má cross-scope
`NameError`. Read-only shadow audit navíc uzavřel nepravdivý author-harness
claim, chybějící cleanup SHA dominanci, nevynucenou post-seal reviewer identity
a chybějící actual one-root enumeraci. Aggregate je `P0=0/P1=5` a V5 je
`DO_NOT_EXECUTE`.

Nová
[decision 037](../decisions/037-m1-h0-v5-preseal-remediation.md) je docs-only
remediation bez runtime authority. Po vlastním
`S_H0V5R -> E_A_H0V5R -> C_H0V5R -> E_B_H0V5R` a canonical promotion nejprve
vyžaduje authentic durable recorder původního red reviewera. Potom smí právě
jedna transaction změnit jen existující V5 plan/runner/strategy v témž rootu;
druhý root, cleanup, evidence write, retry a seal jsou zakázané. Repaired core
musí pinnut promoted Decision037 jako live static base, zachovat OLD+red
history, napravit všech pět P1 a znovu se zastavit na fresh distinct preseal.
Teprve `PRESEAL_READY` s `P0=0/P1=0` dovolí seal vázající red i ready recorder.
Ani 037, preseal ani seal nevydávají H0 runtime, T3 nebo Gate authority.

Po authentic red recorderu odhalil repair preflight přesnou operační mezeru:
Decision037 §5.6 vyžaduje čistý detached source checkout na promoted Review B
`df1863439b6ad83abf41396ba8063e5bffaa599e`. Při pre-S-R2 inventuře jsou
canonical, D037 Review B i D038 R2 writer worktree na B37 branch-attached; po
`S_H0V5SRC_R2` zůstanou oba pre-existing B37 worktrees branch-attached a
detached count je po celou dobu nula. Materializer skončil
`BLOCKED_BEFORE_TRANSACTION`; OLD core, red
recorder, evidence-empty stav i jeho single repair authority zůstávají beze
změny.

Nová
[decision 038](../decisions/038-m1-h0-v5-detached-source-checkout-authority.md)
je pouze docs-only operational erratum. Po vlastním
R1 subject `704dfa70e5d1856d98308315e1f030eb952f8ccf` skončil Review A
`CHANGES_REQUIRED`, `P0=0/P1=2`: poststate reads nebyly no-write a contract
nepřipínal info attributes/exclude, ignored entries ani full raw checkout
closure. Report/E_A nevznikly a R1 nevydává authority. Jediný live chain je
`S_H0V5SRC_R2 -> E_A_H0V5SRC_R2 -> C_H0V5SRC_R2 -> E_B_H0V5SRC_R2`; teprve po
jeho canonical promotion
dovolí právě jeden hardened `umask 077` / `env -i` pokus vytvořit nový locked
detached worktree na fixed path a exact Decision037 Review B. Nesmí detachnout
ani změnit existující checkout/ref, použít hook, lazy fetch, síť, force,
cleanup nebo retry. Každý Git read používá exact no-optional-lock envelope;
distinct verifier musí potvrdit immutable index/info pins, ignored-aware empty
streams, exact HEAD/tree, 1 614-path digest a úplnou tree/index/filesystem
OID/mode/blob closure bez common-Git/private/runtime driftu. Teprve jeho
structured non-filesystem handoff
znovu otevře původního `/root/v5_materializer`; Decision037 zůstává live base.
Decision038 sama core neopravuje, nesealuje a nevydává runtime autoritu.

Decision038 R2 byla následně canonical promovovaná na
`9205a906602cbd6e9a0e6cf3ebe8d30ed06113c2`, ale její operational run skončil
terminal `BLOCKED_BEFORE_ATTEMPT` ještě před final preflight snapshotem a před
`worktree add`. Po root orchestration GO exact task
`/root/v5_d038_source_checkout_verifier` před creator snapshotem provedl
ambientní common-Git reads mimo exact no-write envelope a exclusive writer
window. Creator GO přijal, ale zůstal `BEFORE_SNAPSHOT`, provedl zero post-GO
commands a final create-launch GO zůstal false. D038 authority je proto
spotřebovaná s attempt count `0`; target/admin zůstaly absent, explicit write
nebyl pozorován, ale optional index refresh nelze dokázaně vyloučit a
`canonicalIndexMutation` zůstává `UNKNOWN`. Provisional incident digesty nejsou
evidence a D038 se nesmí retryovat ani reclassifikovat.

Nová
[decision 039](../decisions/039-m1-h0-v5-detached-source-checkout-prelaunch-remediation.md)
je docs-only prelaunch remediation. Inkorporuje exact promoted Decision038 blob
a mění jen explicitní substitution table: nové role/identity/lock reason,
fresh one-shot authority a nepřerušený exclusive **all-Git-access** lease.
Creator run `D039-CREATE-01` musí pod lease dokončit fresh byte-bound snapshot
před GO; teprve po jeho success může distinct verifier spustit
`D039-VERIFY-01`, stále bez jediného external Git readu nebo write. D039 sama
nemění private V5 core, evidence ani runtime a pouze verified verifier-owned
PASS handoff může znovu otevřít dosud nespotřebovanou D037 same-root repair
transaction.

Promoted D039 operational run skončil terminal už prvním Git readem:
`PRELAUNCH_GIT_READ_ENVELOPE_NOT_EXACT_D039`. Raw argv mělo jen 6 env
assignments a 5 configů, z nichž `commit.gpgSign=false` byl unauthorized;
wall time, exit, signal, stdout a stderr zůstávají `UNKNOWN`. D039 CREATE token
je consumed s count `0`/launch `false`, VERIFY je `CANCELLED_UNISSUED/NO_RUN`
a target/admin nevznikly. Pozdější `rg` ENOENT a 2 624-byte digest
`45d002f6da445c78835b5c8daacee2786162faceaf632c86891bd8e0f37268aa`
jsou superseded non-evidence, nikoli canonical observation.

Nová
[decision 040](../decisions/040-m1-h0-v5-detached-source-checkout-toolchain-remediation.md)
je exact four-doc governance-only remediation, ne D039 retry. Tracked driver
směr byl před subjectem abandoned jako noncanonical/non-evidence a jeho path je
forbidden. Review B místo něj dokončí final `PRELEASE_READY` baseline a je
fenced. Sole executor `/root` pod jedním exclusive lease ff-only promuje exact
E_B; při exit `0` issue D040 CREATE a exact hardened worktree-add je velmi další
Git child, bez intervening discovery/preflight Git nebo direct common-metadata
readu. Command nemá force/branch/cleanup/retry a race failne closed. Root
zachová jen raw tool outcome, nikdy PASS. Při create exit `0` se lease bez gapu
převede distinct verifierovi, který celý poststate recompute fresh. D040
subject/candidate prošly Review A+B a E_B
`d0a1c91c76eea039dddf428e57cd758c26a9c81f` vznikl, ale nebyl canonical
promoted; canonical zůstal `c38e1b24849521b41025e70a37bf0219466c9d1e`.
Review-B final baseline skončil `NOT_READY / OPERATIONAL_RUN_NOT_STARTED` kvůli
persistent relevant open-CWD konfliktům. Lease nebyl aktivovaný,
promotion/create count zůstal `0` a CREATE/VERIFY `UNMINTED`. První outside-U40
identity následně terminalně foreclose-nula D040 jako `SUPERSEDED_BEFORE_LEASE /
PRELEASE_IDENTITY_UNIVERSE_DRIFT`; D040 se nerecykluje ani neretryuje.

Nová
[decision 041](../decisions/041-m1-h0-v5-detached-source-checkout-prelease-readiness-remediation.md)
je exact four-doc governance-only remediation D040 readiness/identity driftu.
Nemá process-control authority: historické `/usr/bin/yes`, Konsole bash a adb
cwd konflikty smí odstranit jen external user a jejich pouhé zmizení není
důkaz. Po docs Review A+B a external cleanup signálu smí exact
`/root/v5_d041_prelease_readiness_verifier` právě jednou z cwd `/` fresh
recompute-nout celý prelease closure včetně system-wide handles. Pouze complete
`PRELEASE_READY` převede tentýž lease bez gapu readiness→root; root bez
self-preflightu ff-only promuje D041 E_B a exact D041 CREATE je velmi další Git
child. Při exit `0` převezme fresh `D041-VERIFY-01` existující D040 source
verifier, ale pouze s D041 READ15/baseline. Každý non-PASS readiness nebo
command failure terminalně foreclose-ne D041 bez retry/cleanupu. Private,
evidence, seal a runtime authority zůstávají NONE.

D041 docs následně prošly Review A+B, ale jediný operational readiness run
skončil terminal `BLOCKED / INCOMPLETE`: první scoped Git child měl exact
environmentový `GIT_OPTIONAL_LOCKS=0`, avšak raw argv vynechalo bezprostřední
CLI `--no-optional-locks` před `-C`. Full argv/stdout/stderr/terminal artifact
jsou `ABSENT/UNKNOWN`; CREATE/VERIFY byly `CANCELLED_UNISSUED`, promotion i
create zůstaly 0/false, lease se uzavřel bez handoffu a D041 se nesmí retryovat.
Před-D042 adversary plain status je non-evidence s možným unknown index
refreshem, nikoli fresh baseline.

Nová
[decision 042](../decisions/042-m1-h0-v5-detached-source-checkout-read-constructor-remediation.md)
je exact four-doc governance-only read-constructor remediation, zatím pouze
frozen governance tooling candidate. Final V4.2 používá acyklický
post-E_B-materialized P→D→B→outer chain: canonical authority profile, isolated
CPython bootstrap, Popen dispatcher s odděleným stdout/stderr/exit/signal/reap
a dash builtin preflight 22 loader variables. Ruling A pravdivě přijímá task
runner, již načtený pinned dash a fenced filesystem jako roots of trust;
malicious preload ani transient path swap/revert resistance netvrdí a běžné
read-only audity přiznávají možný/unknown atime effect. Review A a adversary
musí před mintem tokenu nezávisle rekonstruovat bytes, provést dva bounded
same-FD ELF PASS audity four toolchain closures a oba exact
`rootWriteChain.materializationAudits` musí dát PASS. Teprve potom smí jeden fresh readiness
run použít closed contiguous operation manifest a prevalidated E_B-bound
`rootWriteChain`; každý child má 1:1 ledger a unproven branch zůstává
`UNKNOWN_OPEN/NO_HANDOFF`, zatímco non-PASS terminalně ruší další token bez
retry.
D042 není promoted, není source-checkout PASS, neodemkla D037 repair a není
M1/H0/runtime/T3/Gate DONE evidence.

---

## 2. Sdílené invarianty — platí pro každý běh v dávce

1. **Jeden zapisující vlastník.** Běhy jdou sériově. Před startem: `git status`
   musí být čistý mimo osm rozpracovaných inventur.
2. **Osm inventur `docs/inventory/*.md` (modifikované, necommitnuté) se nikdy
   nečte jako vstup, needituje a necommituje.** Platí i pro `git add -A`.
3. **Historický režim bez push je pro M1 closeout nahrazený:** bounded WP branch
   se po vlastním gate pushne pro immutable Review A/B a merge queue. Force-push,
   tag, release a history rewrite zůstávají zakázané.
4. **Malé commity.** Jeden commit = jedna ověřitelná změna chování + její test.
   Zpráva česky nebo anglicky, bez `Co-Authored-By`.
5. **Povinná baterie před každým commitem** — všechna musí projít, jinak se
   necommituje:
   ```
   node tests/artifact-validation.test.js
   node scripts/validate-test-registry.js --json
   node tests/repository-hygiene.test.js
   git diff --check
   ```
   plus focused testy daného WP z bodu 8 briefu.
6. **Nový test = update registry ve stejném commitu.** WP přidá kanonický
   záznam do `tests/registry.json` a přes
   `node scripts/validate-test-registry.js --write-doc` regeneruje odvozený
   `docs/convergence/TEST-REGISTRY.md`. Přidání testu bez obou synchronních
   kroků shodí bod 5. (Viz úzká odchylka O-1 v §6.)
7. **Artefakty** do `.intentsmith-artifacts/<wp>-<sha>/`, adresář `0700`,
   soubory `0600`. Capability hodnoty, tokeny ani obsah `~/.c3/port` se
   neevidují.
8. **GPU sériově.** Žádné dva běhy nesahají na Ollamu současně. Sdílená Ollama
   se nikdy nezastavuje — negativní cesty používají izolovaný fake nebo
   uzavřený port.
9. **Zákaz `yarn clean` v `c3-ide/extensions/c3-chat-panel`** a jakéhokoli
   `tsc -b` v tom balíčku, dokud nedoběhne WP-M1-STUDIO bod „zneškodnit build
   kontrakt". `outDir` je `lib` — build i clean smažou autoritativní runtime.
10. **Nic se nehlásí zeleně, co neproběhlo.** Neproběhlý krok se hlásí jako
    neproběhlý, `INCONCLUSIVE` zůstává `INCONCLUSIVE`.
11. **Závěr každého běhu** zapíše `docs/execution/runs/<wp>-report.md`:
    výsledek per bod 6 briefu, seznam commitů, seznam rozhodnutí a findingů,
    cesty k artefaktům, a co zůstalo neověřené.

---

## 3. Pořadí běhů

```
        ┌─────────────────────────────────────────────┐
        │ předpoklad: WP-M0-E opravy uzavřené kolegou │
        └───────────────────────┬─────────────────────┘
                                ▼
                    B1  WP-M1-CONTRACT          (zapisující)
                                │
              ┌─────────────────┼─────────────────┐
              ▼                 ▼                 ▼
        B2 WP-M1-CHAT     B3 WP-M1-MODEL   B4 WP-M1-STUDIO
        (sériově v tomto pořadí — logicky paralelní, fyzicky ne)
              └─────────────────┼─────────────────┘
                                ▼
                    ══ REVIEW GATE 1 ══
                                ▼
                    B5  WP-M1-QUALITY           (integrace)
                                ▼
                    B6  M1-JOURNEY              (exit demonstrace)
                                ▼
                    ══ REVIEW GATE 2 (M1 exit) ══

  paralelně po celou dobu, read-only, nikdy necommituje do src/:
        P1  M2-EFFECT-TRACE
```

Pořadí B2 → B3 → B4 je záměrné: CHAT nemá GPU závislost a odhalí nejvíc
kontraktních vad nejlevněji; MODEL potřebuje sériové GPU okno; STUDIO má
nejdelší build/journey cyklus, takže jde poslední, kdy je kontrakt nejstabilnější.

Pro aktuální closeout je B2 již hotový prerequisite a výše uvedený historický
diagram se provádí přes tuto exact frontu:

```text
026 secret-storage authority
  → 029 high-level krok se dvěma sériovými subjecty/reporty:
      standalone chats decommission → dual-CAS settings reset
  → B3 terminal failover/proof + autorizovaný T3 GPU běh
  → B4 immutable built Electron journey
  → Gate 1
  → B5 quality rozhodnutí podle předem přijatého prahu
  → B6 dvoufázová M1 journey nad jedním build manifestem
  → Gate 2
```

---

## 4. Briefy

### B1 — WP-M1-CONTRACT

> Jsi zapisující vlastník `WP-M1-CONTRACT`. Platí `ROADMAP.md` §5, `CONTRACT.md`
> §7 a §1–2 tohoto dokumentu. Neptej se; rozhodnutí zapisuj do fronty.

1. **Výsledek:** verze 1 connectorů připne korelaci, scope konverzačního stavu
   a jedinou terminální sémantiku shodnou pro HTTP, WS i Studio.
2. **Povolené:** nové `contracts/m1/**`, `src/ws-bridge/protocol.js`,
   `c3-ide/extensions/c3-protocol/src/**`, nový `tests/m1-contract.test.js`,
   `docs/convergence/TEST-REGISTRY.md`, `docs/decisions/**`.
   **Zakázané:** controller, routes, gateway, session-adapter, Studio UI, quality.
3. **Connector:** `ConversationCommand/Result`, `ModelRequest/Result`, `CoreEvent`
   v1 — vlastní je tento WP jako jediný.
4. **Vstup:** čistý base SHA po uzavření M0-E oprav; zapiš jej do reportu.
5. **Schéma k implementaci** je to, které `ROADMAP.md` §5 bod 5 už popisuje.
   Implementuj ho jako `PROVISIONAL_V1`: `conversationId` je state a durability
   key, `sessionId` jen transport; command i každý event nesou `requestId`,
   `conversationId`, `turnId`; cancel je scoped; Result je právě jeden z
   `ok | cancelled | timeout | error`; `ModelRequest` rozlišuje `callerRole`,
   `modelRole` a purpose `classify | answer | synthesize | refine`; prázdný
   output není úspěch.
   **Forward-compat požadavek:** `CoreEvent` musí mít monotónní `sequence` a
   terminal musí být odlišitelný od progress i bez čtení payloadu, aby bylo
   streaming později přidatelné bez změny v1.
6. **Test:** pozitivní round-trip všech tří connectorů v JS i TS; negativně
   chybějící/cizí ID, verze/status, response na error, error na ok, prázdný
   modelový obsah, duplicitní terminal, out-of-order sequence, unscoped cancel.
7. **Autonomie:**
   - `BLOCK`: kontrakt by musel obsahovat M2 effect/approval authority; TS/JS
     sdílení by vyžadovalo novou závislost.
   - `DECIDE` **D-1 `degraded` vs terminální `error`:** default = `degraded`
     **není** v unionu; částečný tool výsledek následovaný selháním providera je
     `error`, ale Result nese `partial.toolResults`, který se persistuje a
     **nerenderuje jako assistant**. Šev: `contracts/m1/terminal.js:classifyTerminal()`
     plus jedna větev renderu ve Studiu. Do záznamu vyčísli cenu přepnutí.
   - `DECIDE` **D-2 pozdní assistant po cancelu:** default = odmítnout a
     nepersistovat. Šev: tentýž `classifyTerminal()`.
   - `PARK`: streaming — mimo v1, jen ověř forward-compat požadavek výše.
8. **Ověření:** `node tests/m1-contract.test.js` (nový);
   `node tests/ws-bridge.test.js`; v disposable klonu z `c3-ide/`
   `corepack yarn workspace @c3/protocol build`.

---

### B2 — WP-M1-CHAT

> Zapisující vlastník `WP-M1-CHAT`. Vstup: přijatá v1 z B1. Nesaháš na schéma.

1. **Výsledek:** dva chaty nesdílejí stav; success/error/cancel/timeout mají
   jediný pravdivý request-level výsledek; úspěšný assistant je durable dřív,
   než odejde odpověď.
2. **Povolené:** `src/chat/controller.js`, `src/chat/conversation-store.js`,
   dočasně `src/chat/response-finalizer.js`, chat/abort error typy,
   `src/routes/chat.js`, nové `tests/m1-chat-*.test.js`, registry, decisions.
   **Zakázané:** `src/llm/**`, `src/ws-bridge/**`, `c3-ide/**`,
   quality/synthesis internals.
3. **Connector:** pouze adaptér přijaté v1; sémantiku nemění.
4. **Závislost:** B1. `response-finalizer.js` po přijetí předáš B5.
5. **Demo:** dva oddělené chaty, deterministický request, modelový request,
   skutečný stop/start backendu nad stejnou SQLite, přesně obnovené turny.
6. **Test — povinné položky:**
   - pozitivně: HTTP deterministic pod 100 ms bez LLM; durable restart přes
     **skutečný stop/start procesu**, ne jeden in-memory store;
   - negativně: provider exception, timeout, persist exception, cancel před /
     během / těsně před persistencí — nikde assistant turn ani false-success;
   - izolace: backendový stav konverzace A se nesmí objevit v B.
   - **Explicitně opravit** `tests/chat-persistence.test.js` — dnes používá
     `new ConversationStore(null)` a komentář na ř. 231 přiznává, že persistenci
     jen simuluje. Nahradit skutečným restartem, ne přidat druhý test vedle.
   - Izolaci Studio panelů nevlastníš — to je B4.
7. **Autonomie:**
   - `BLOCK`: potřeba změnit connector; filesystem attachment authority.
   - `DECIDE` **D-3 pořadí persist vs. odpověď:** default = persist-then-respond
     i za cenu latence; když to shodí p95 pod 100 ms u deterministické cesty,
     zapiš naměřená čísla a **neopravuj to zkrácením testu**.
   - `FINDING` očekávaně: `response-finalizer.js:163-165` (catch zaloguje a vrátí
     úspěch) je uvnitř tvých cest → oprav. Cokoli ve `ws-bridge/` nebo `llm/` →
     finding, neopravuj.
8. **Ověření:** `node tests/deterministic-answer-latency.test.js`,
   `node tests/confirmation-ownership.test.js`, `node tests/routes-smoke.test.js`,
   `node tests/chat-persistence.test.js`, `node tests/m1-chat-contract.test.js` (nový).

---

### B3 — WP-M1-MODEL

> Zapisující vlastník `WP-M1-MODEL`. GPU okno je tvoje a jen tvoje.

1. **Výsledek:** role binding, VRAM fit, timeout/cancel/provider failure a
   modelový výstup mají přesný typ; každé volání je přiřaditelné účelu.
2. **Povolené:** `src/llm/{auth-types,cre-bridge,gateway,model-ctx}.js`,
   `src/upgrade/{model-registry,model-profiles}.js`, nové model contract testy,
   registry, decisions. **Zakázané:** chat, Studio/WS, quality, online upgrade
   automatika, s těmito přesnými operátorskými výjimkami:
   - **B3-IDENTITY / 006:** nový `src/upgrade/model-identity.js`, identity
     comparisons v `model-registry.js` a `upgrade-manager.js`, plus přímý
     fallback `src/routes/system.js`; pokryje usage/validation, overview,
     `getUnusedOldModels()` a všechny delete/cleanup guardy. Integrity check
     smí jen `DETECTED/PROPOSED`, s nulovým assign/override/broadcast efektem;
   - **B3-PROFILE / 009:** jediný `src/llm/model-runtime-profile.js`, spotřeba
     v `model-ctx.js`, pouze `src/chat/context-compact.js` z chat scope a
     existující GPU/context-compact testy. Threshold, safety truncate i
     post-log fill používají tentýž efektivní kontext;
   - **B3-FAILOVER / 006:** až po přijatém IDENTITY samostatně opt-in
     desired/active persistence. Přesný scope: nový `src/db/user-settings.js`,
     `src/upgrade/model-failover.js`, jedna
     `src/db/migrations/*model_failover*.js`, `model-registry.js`, identity/
     verify části `upgrade-manager.js` a scheduler seam v `src/server.js`.
     Opt-in čte JSON `user_settings.id=1`; missing/malformed/DB error fail-close.
     Je to výslovná D+ výjimka, ne obecné rozmrazení online upgrade automatiky
     a ne změna L0-9 před důkazem.
3. **Connector:** adaptér `ModelRequest/Result` v1; schéma nemění.
4. **Závislost:** B1. Offline fake běhy nečekají na GPU — udělej je první.
5. **Demo:** skutečná odpověď z lokální Ollamy. Negativní cesta používá
   izolovaný fake nebo uzavřený port; **sdílená Ollama se nikdy nezastavuje**.
6. **Test:** fake Ollama pokryje validní, prázdný/malformed, 404/500/503,
   refused socket, timeout, queued cancel, retry policy, uvolnění semaforu.
   Sériový GPU běh změří cold/warm, klasifikaci, answer, mid-generation cancel,
   model/num_ctx a VRAM před/peak/po.
   **Povinná oprava:** `src/llm/gateway.js:508` bere
   `data.message?.content || data.response || ''` a pak emituje
   `emitRuntimeSignal('runtime', true)` a audit `LLM_CALL_COMPLETE` — prázdný
   obsah dnes projde jako úspěch.
7. **Autonomie:**
   - `BLOCK`: nutnost pull/delete/rebind modelu; nebezpečný VRAM stav; změna
     connectoru; požadavek na streaming.
   - `DECIDE` **D-4 retry policy:** default = **žádný automatický retry ve v1**.
     Retry maskuje selhání providera, což je přesně to, co má M1 zpravdivět.
     Šev: `gateway.js:callWithPolicy()`.
   - `DECIDE` **D-5 VRAM nefit:** default = odmítnout typovaným errorem před
     voláním, ne best-effort a OOM. Šev: `model-ctx.js:fitsVram()`.
   - **M1-CLOSEOUT-X1 nahrazuje dřívější otevřený terminal/GPU rozsah:**
     fallback target je explicitní per-role typed CAS pin obsahující exact
     requested name, canonical name a digest. Nikdy neplatí „nejnovější proof
     vyhrává“. Backup/import target nepřenáší a destination jej zachová;
     explicitní reset target vyčistí. Nula, více nebo nezpůsobilý target je
     `INCONCLUSIVE` bez effectu.
   - Aktivace vyžaduje literal opt-in, explicitní target, exact installed
     artifact a fresh same-role digest-bound proof. Durable intent předchází
     runtime effectu; success vznikne až po exact runtime finalize receiptu.
     Uncertain commit se pouze reconciliuje podle exact generation, nikdy blind
     replayem ani alternativním kandidátem.
   - Restore smí použít pouze exact desired name+digest+revision s fresh desired
     proofem. Restore failure nechá fallback aktivní jako degraded. User binding
     superseduje failover a blokuje pozdní restore; startup rehydrate přijme jen
     exact active lineage. Happy-path používá skutečný connector v disposable
     file-backed DB/runtime proti lokální Ollamě; failure/race matrix smí použít
     test-owned adaptéry. Uživatelská DB ani config se nemění.
   - Terminální změna `model-failover.js` zneplatní dnešní raw-byte-pinned proof.
     Po final B3 source se operator-only sériově vydají nové CHAT proofy jen pro
     přesně potřebné desired/fallback digests, nejvýše dva. Conditional reissue
     je povolen jen při expiraci nebo relevantním source/digest driftu. Issuance
     nemá background obnovu ani runtime mutaci. Active failover po expiry
     zůstává bound jako `DEGRADED_PROOF_EXPIRED`; nový `ACTIVATE/REAPPLY` je
     blokovaný.
   - Je autorizovaný právě jeden registrovaný T3 běh na RTX 3090 pro
     `qwen3.5:27b`, digest
     `7653528ba5cba4dd8e19da24aaddc7f4d0b5ecd93571c0825dfd4137958ec06e`,
     `num_ctx=4096`, headroom nejméně `1024 MiB`, GPU residency `100 %` a
     fallback zakázaný. Měří cold, warm, classify a mid-generation cancel.
     Preflight vyžaduje prázdný `ollama ps` a žádný compute proces. Zakázaný je
     pull/delete/stop/unload/rebind; cleanup jen přirozenou expiry. Historický
     `8192 FAIL` zůstává zachovaný.
8. **Ověření bez GPU:** `node tests/llm-gateway-runtime-signal.test.js`,
   `node tests/model-ctx.test.js`, `node tests/m1-model-contract.test.js` (nový).
   GPU jen registrovanou T3 sadou s `concurrency=1`.

---

### B4 — WP-M1-STUDIO

> Zapisující vlastník `WP-M1-STUDIO`. Nejdřív si přečti report z M0-E oprav.

1. **Výsledek:** built Theia správně koreluje panely, ukáže progress i přesný
   terminal, scoped cancel/reconnect, žádný tichý outbound.
2. **Povolené:** `src/ws-bridge/{ws-server,session-adapter}.js` **bez**
   `protocol.js`; `c3-ide/extensions/c3-chat-panel/{src,lib}/**` a bridge podle
   přijaté source disposition; nové Studio client/journey testy, registry,
   decisions. **Zakázané:** chat controller, routes, LLM, quality, přijatý
   protocol.
   **Gate 1 follow-up výjimky schválené operátorem:** 010/A+ smí odstranit stale
   `c3-protocol/lib/**` z trackingu a změnit jen `.gitignore` a
   `c3-ide/package.json` pro jeho generated prebuild; 012/B smí změnit jen
   existence-aware history větev v `src/routes/chat.js`; 014/A smí změnit jen
   legacy rehydrate control payload/handler,
   autoritativní klient/localStorage clamp a úzký durable-readiness šev v
   `conversation-store.js`. Ostatní routes/store, connector schema a
   `src/ws-bridge/protocol.js` zůstávají zakázané.
3. **Connector:** konzument `ConversationCommand/Result` a `CoreEvent` v1.
4. **Závislost:** B1 + přijatá disposition z M0-E.
   **Cancel začíná v klientovi**, ne v backendu: `wsSendCancel` /
   `_cancelExecution` doplní `conversationId`. Scoped backend větev
   (`session-adapter.js:528-541`) se **zachová**; její `cancel all` fallback se
   pouze negativně otestuje. Nezačínej v `session-adapter.js`.
5. **Demo:** skutečná Theia, dva panely s prokládanými eventy, jeden cancel a
   jeden success, provider stop, restart/reconnect, nulový Fonts request.
6. **Test:** Po operátorském rozhodnutí 011/A platí pro M1 **WS send +
   fail-closed offline stav**, nikoli původní WS/HTTP send parity. Pro všechny
   tři send call sites se samostatně ověří unavailable WS,
   `sendChat() === false` a synchronní throw; s `FILE_WRITE`, `SHELL` a generic
   tool je počet `/chat`, provider, filesystem i tool efektů přesně nula a
   input zůstane `NOT_SENT`/retryable. HTTP send parity se vrátí v M2. Browser local
   capability projde na přesný backend origin a nikdy jinam; základní Studio
   HTTP cesty nevracejí boundary `403`;
   `503` nikdy jako assistant (dnes `chat-panel-module.js:6125` nekontroluje
   `response.ok`); cancel A neovlivní B; pozdní assistant po cancelu odmítnut;
   každá terminal větev vypne spinner; jen explicitní `invalidIds` z úplného
   ACK nad durable storem zruší syntakticky platnou identitu, history `404` ji
   zachová a lokálně malformed identita zůstane se snapshotem quarantined;
   matching reject degraduje ihned, cizí/replayed reject neukončí aktuální běh;
   clean build dá stejné runtime chování; bounded soak a řízený shutdown bez
   renderer/GPU crashu. Clean-clone protocol output smí před prebuildem chybět;
   po něm musí být ignored/untracked, exportovat M1 a tracked strom zůstat čistý.
7. **Autonomie:**
   - `BLOCK`: build přepisuje nebo maže dnešní UX; potřeba nové browser test
     dependency; změna connectoru; zatažení effect/auto-exec scope.
   - **D-6 je potvrzené rozhodnutí, ne otevřený DECIDE:** relokace se
     neprovádí, commitnutý chat-panel `lib` zůstává autoritativní a již
     implementované ochrany `build`/`clean` se zachovají. Archivovaný TypeScript
     ani neexistující chat-panel `tsconfig` nejsou implementační plocha;
     případná relokace je vlastní pozdější behavior-preserving WP.
   - `DECIDE` **D-7 reconnect backoff:** default = fixní strop a viditelný stav,
     ne tiché nekonečné opakování. Šev: `ws-client.js:_scheduleReconnect()`.
   - **M1-CLOSEOUT-X1 built envelope:** použij fresh disk clone `--no-local`,
     offline/frozen install, forced protocol prebuild a production build.
     Nespouštěj standalone chat-panel build/clean. Trackovaný strom musí zůstat
     čistý a build/bundle digesty se uloží do immutable manifestu.
   - Povolené prostředí je scoped X11 a user/network namespace s loopback-only
     přístupem. Nad jedním buildem proveď negotiated inline attachment, dva
     panely, cancel A/success B, provider failure, reconnect, server
     restart/rehydrate, operation rollback a 65s soak. Počet external a
     unexpected-loopback requestů je nula.
   - Tentýž build musí získat dva po sobě jdoucí nezávislé PASS. Hidden retry a
     disable-GPU workaround jsou zakázané. `SIGTRAP` je `FAIL` a diagnostický
     finding, nikoli environmentální PASS.
8. **Ověření:** `node tests/ws-bridge.test.js`,
   `node tests/m1-studio-client.test.js` (nový); v čistém klonu frozen Yarn
   install, build a registrovaný Studio journey. **Build neběží v dirty
   checkoutu.** Runtime potřebuje skutečný X11/Wayland displej — když není,
   je to `PARK`, ne produktová vada.

---

### B5 — WP-M1-QUALITY

> Integrační vlastník. Běží až po REVIEW GATE 1.

1. **Výsledek:** `ResponseFinalizer` je jediný refinement owner. Synthesis smí
   scoreovat, ale nesmí spustit refinement; na jeden turn je nejvýše jeden
   refine provider call. Přidaná hodnota, cena i latence jsou změřené.
2. **Povolené:** synthesis, `src/chat/quality/**`, quality telemetrie, převzatý
   `response-finalizer.js`, fixní corpus, M1 quality testy, registry, decisions.
   **Zakázané:** connector, gateway, routes, WS, Studio.
3. **Connector:** pouze čte přijaté Model/Conversation výsledky.
4. **Závislost:** přijaté B2, B3, B4.
5. **Demo:** corpus se zmrazí před prvním outputem a má přesně 12 případů,
   `8 CS + 4 EN`. A/B použije stejný exact model/digest a `num_ctx=4096`, jeden
   baseline na případ a žádný reroll. Report obsahuje sample výsledky, p50/p95,
   delta, acceptance, tokeny, latency a reject reason včetně jednoho konkrétního
   přijatého a jednoho odmítnutého refinementu.
6. **Test:** fake model pro skip, právě jeden refine, zlepšení, semantic drift,
   horší/prázdný výsledek, provider error, cancel. GPU A/B reportuje p50/p95,
   score delta, acceptance rate, tokeny a dobu.
   Pokrýt vadu #7 z call grafu: synthesis i finalizer dnes mohou spustit vlastní
   refinement a telemetrie je nerozliší.
7. **Autonomie — předem přijaté automatické rozhodnutí:** `KEEP-LIMITED` platí
   jen pokud současně:
   - je nula semantic/correctness/code-invariant regresí;
   - median accepted score delta je nejméně `5/100`;
   - corpus-wide delta je `>= 0`;
   - acceptance rate je nejméně `25 %`;
   - je nula false-success, cancel nebo duplicate-call vad.

   Jinak se refinement pro M1 vypne. Ambiguous metrika znamená vypnout, nikoli
   další rozhodovací kolo. QGv2 deterministic scoring zůstává beze změny.
   Změna connectoru nebo nebezpečná GPU prerekvizita zůstává stop condition.
8. **Ověření:** `node tests/improvement-loops.test.js`,
   `node tests/chat-output-quality.test.js`,
   `node tests/chat-synthesis-hardening.test.js`,
   `node tests/m1-quality-contract.test.js` (nový); GPU A/B jen sériově.

---

### B6 — M1-JOURNEY (exit demonstrace)

> Není to nový WP, je to integrační ověření. Zapisuje jen do dokumentace,
> testů a artefaktů.

1. **Výsledek:** všech sedm povinných scénářů z `ROADMAP.md` §5 proběhne bez
   `PARK` nad jedním fresh buildem a jedním immutable manifestem.
2. **Povolené:** `tests/m1-journey.test.js` (nový), `ROADMAP.md` a `SYSTEM-MAP.md`
   stavové řádky, `docs/execution/**`, registry, artefakty.
   **Zakázané:** jakýkoli produktový soubor. Když journey najde vadu, je to
   `FINDING`, ne oprava.
3. **Demo:** Phase A spustí Electron v loopback-only namespace s test-owned
   providerem. Phase B použije tentýž build proti exact `127.0.0.1` Ollamě.
   Dohromady: čistá instalace → Theia → konverzace → deterministická i modelová
   odpověď → restart → obnovený stav.
4. **Měření k zápisu, ne k odhadu:** deterministic p95 `<100 ms`, cold/warm
   whole-response latence odděleně, p95 modelového chatu, throughput,
   refinement delta, false-success `0` a unexpected outbound `0`.
5. **Autonomie:** journey se **nesmí** prohlásit za PASS s parkovanou položkou.
   Chybějící scénář = M1 zůstává `PARTIAL` a to se tak i zapíše. User DB,
   projects a config musí zůstat beze změny a shutdown čistý. Produktová vada
   nalezená v B6 je finding; journey subject nesmí obsahovat produktovou opravu.
   Streaming zůstává mimo M1.

---

### P1 — M2-EFFECT-TRACE (paralelní, read-only)

> Můžeš běžet kdykoli souběžně s B1–B6. **Nikdy nezapisuješ mimo
> `docs/inventory/2x-*.md` nové soubory a `docs/findings/`.** Nesaháš na osm
> rozpracovaných inventur.

1. **Výsledek:** skutečný import/call graph efektových cest (#11 sandbox/patch/
   Git/test/rollback, #16 tools, #13 governance) jako vstup pro `WP-M2-EFFECT`.
2. **Otázky k zodpovězení evidencí, ne názorem:**
   - kudy dnes vzniká zápis na disk, exec a network efekt, a kde je (nebo není)
     kontrolována authority;
   - které cesty obcházejí approval a jakým konkrétním voláním;
   - kde je dnes path traversal ověřen a kde ne;
   - jaké orphan stavy zůstanou po cancel/timeout/kill/restart.
3. **Výstup:** jedna nová inventura + rozhodovací podklad pro
   `EffectRequest/Result` a `ApprovalGrant` — **návrh schématu, ne implementace**.
4. **Autonomie:** vše je `FINDING` nebo podklad. P1 nikdy nic neopravuje.

---

## 5. Review gates

### GATE 1 — po přijatých 026+029+B3+B4

Operátor dostane jeden balík:

- `docs/execution/runs/` reporty z pěti subjectů: 026, samostatný 029 chats
  decommission, samostatný 029 reset, B3 a B4. High-level krok 029 tedy
  přispívá dvěma sériovými reporty, nikoli jedním sloučeným;
- **rozhodovací frontu** — očekávaně D-1 až D-7 plus co přibylo; každé
  s evidencí, defaultem a cenou přepnutí;
- seznam findingů s vlastníky;
- seznam commitů a `git log --stat` proti base SHA;
- výsledek povinné baterie a fingerprint registry.

Operátor rozhoduje: potvrdit nebo přepnout každý `DECIDE`; odblokovat `BLOCK`;
schválit `PARK` nebo poslat zpět. Teprve pak se pouští B5.

**Stav 2026-08-08:** operátor zvolil všechny varianty 001–014. „Odblokovat“ zde
neznamená změnit štítek dokumentu: 006, 009–012 a 014 zůstávají implementačně
`BLOCKED`, dokud neprojdou jejich pojmenované důkazy. B5 se proto ještě
nespouští.

### GATE 2 — M1 exit, po B5+B6

Navíc:

- naměřená L3 čísla proti cílům `ROADMAP.md` §5;
- automatický B5 výsledek `KEEP-LIMITED` pouze při splnění všech přijatých
  prahů, jinak refinement pro M1 vypnutý, vždy s daty;
- journey artefakty;
- návrh stavového řádku M1 v `ROADMAP.md` a `SYSTEM-MAP.md` **k odsouhlasení**,
  ne už zapsaný jako hotový.

---

## 6. Odchylky od `ROADMAP.md` — k potvrzení před spuštěním

| # | Odchylka | Důvod |
|---|---|---|
| **O-1** | Roadmapa §5: „`tests/registry.json` … upravuje jen integrační vlastník". Tato dávka dává běžícímu sériovému WP úzkou výjimku změnit `tests/registry.json` a ve stejném commitu regenerovat `docs/convergence/TEST-REGISTRY.md` přes `--write-doc`. | Pravidlo brání konfliktu mezi souběžnými zapisovateli. Při sériovém běhu je běžící WP jediný zapisovatel, takže konflikt nemůže vzniknout — a bez kanonického záznamu i odvozeného ledgeru shodí `validate-test-registry.js` povinnou baterii. |
| **O-2** | Roadmapa §12: „Agent zastaví dotčenou část při … nejasnosti." Protokol §1 část nejasností převádí na `DECIDE` s vratným defaultem. | Bez toho dávka neběží déle než jeden WP. Omezeno podmínkou švu a povinným vyčíslením ceny přepnutí; `CONTRACT.md` §7 zakázané kategorie (L0, connector, scope, open source) zůstávají tvrdý `BLOCK`. |
| **O-3** | Dávka nepokrývá M2. | M2 WP konzumují connectory, které ještě neexistují. Místo toho běží P1 read-only. |
| **O-4** | B4 bod 6 po Gate 1 nevyžaduje WS/HTTP send parity; vyžaduje WS send + explicitní fail-closed `NOT_SENT` stav. | Call graph prokázal, že legacy `/chat` fallback může provést filesystem/tool efekt bez společné authority. Operátor schválil 011/A nyní a 011/C až v M2; původní parity claim se nesmí vydat za splněný. |

---

## 7. Co tahle dávka **nezaručí**

- Že M1 skončí zeleně. Klidně skončí `PARTIAL` s pojmenovanými dírami — a to je
  správný výsledek, ne selhání dávky.
- Že nebudou potřeba rozhodnutí dřív než na GATE 1. `BLOCK` je reálná možnost;
  když padne brzy, dávka pokračuje dalším briefem a gate přijde dřív.
- Stabilitu Studia, dokud není dostupný displej pro bounded soak.
