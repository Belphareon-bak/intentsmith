# WP — příprava závěrečné redukce větví a worktrees

**Autorita:** operátor požaduje redukci po dokončení analýzy a milníků.
**Stav:** `THREE_OWN_LOCAL_REFS_REMOVED / ACTUAL_REVIEW_PASS / WORKTREE_REMOVAL_HOLD`.
Tři vlastní local refs odstraněné atomicky; cizí refs/worktrees zachované.
Vlastník inventury `/root/full405_diagnosis`, vykonavatel ROOT.

## Provedení posledního omezeného cleanup, 19:14 UTC

Po publikaci exportu/reportu `5fd54ee7`, remote ověření a vlastní
[CI13 SUCCESS](https://github.com/Belphareon-bak/intentsmith/actions/runs/36912177685)
je původní Hunt checkout obnovený na clean `00c71cd4` /původní branch.
Všech1164 ignored regular souborů /61,603,715 B i node_modules symlink
před/po stejné, původní19 a579 records přesné. Receipt SHA
`0e4e464812f6075d4913661b033d5d04cef8cdb74e952fe34b4983c4459dd1b4`.

Nezávislé nové GO pouze3 refs má SHA
`f6bbeb1e38d26663fd060e79816e1809455fa8237fac93cd57a1ceeff78acd09`.
Fresh před transakcí všechny čtyři local/remote annotated/peeled tags
přesné, pouze tři nepodmíněně uvolněné cíle bez worktree association,
archive tar hashe znovu stejné. Přesný delete protocol SHA
`bc0de1f16e1865f9c3c25c049ac7bf73713370190851dd71b199df83d9eb599f`.

Actual19:14:00.313–19:14:01.992 UTC, git update-ref start/prepare/commit,
exit0: **216→213 lokálních branches /71→71 worktrees**. Pouze tři
expected refs zmizely, ostatní ref tips a všechna worktree metadata stejná.
BC větev a čtyři evidence tags zůstávají local/remote přesné. Raw result SHA
`f876833991f053865e660d4b496d34a63cc14d6f9879f8e136758ce8430c4851`.
Actual observational review **REVIEW_PASS**, SHA
`99cf52726ce060ff9f80c458f00d90181d897aa3aa641e8ad3dc983823e66506`.
Čerstvě ověřeno všech368 refs a71 WT records, čtyři local/remote tags,
BC, všech1164 Hunt files/symlink, oba přijaté archivy, V7 raw359/source27/
public21 i původníV5/V6 FAIL packets. Reviewer nevykonal Git writes,
runtime, DB open ani procesové/modelové zásahy. Veškeré physical WT removal HOLD.
Žádná obnova live nebyla potřeba; připravený absence-only create protokol
se stejnými SHA chrání znovu použité názvy.

## Historická příprava 19:00 UTC — tři nepodmíněně uvolněné refs

Nová ROOT kontrola 19:00 UTC našla rozpor mezi starším public textem a
durable preflight review: BC `work/project-app-acceptance-20261001` má
**CONDITIONAL** uvolnění po přijaté a publikované SQLite náhradě.
SQLite application FAIL a přijatý důkaz odmítnutí tuto podmínku nesplňují.
Pozdější nepodmíněné uvolnění nebylo v bounded důkazech nalezené.
Tato větev zůstává **HOLD_CONDITIONAL**; stará čtyř-delete transakce se neprovede.

Fresh 216 lokálních branches /71 worktrees; všechny čtyři evidence tags
mají přesné local/remote annotated objects i peeled commits, všechny čtyři
staré branch refs bez worktree association. Nový návrh atomicky odstraní
pouze e6e9/ce2/153 s expected SHA a ověřením všech čtyř evidence tagů.
PREFLIGHT SHA `4934567f5718a53e10136b8b8ad1ba1b61c600d84de16a477335967c598c9293`.

Obnova je připravená přes tři `create` pouze do volných jmen. V odděleném
vlastním bare repo byla skutečně ověřená delete3→restore3 přesných tips;
jedno znovu použité jméno odmítne celou restore transakci a ostatní dvě
zůstanou nepřítomné. Sdílené refs/worktree metadata před/po stejné, žádné
skutečné mazání. Receipt SHA
`7cd12a915286e8bb9b6e8df215940cd26b5d3e3b43cba8dfb929148918b7cd6e`.
Nové nezávislé GO čeká. Očekávaný počet je213 branches /71 worktrees
pouze při nezměněném okolním inventáři. Fyzické worktree removal HOLD.

## Historická čtyř-ref transakce — nepoužít, podmínka BC nesplněná

Read-only preflight na clean `a3d6e61d` potvrdil **216 lokálních branches /
71 worktrees**. Všechny čtyři cíle mají přesný očekávaný SHA, 0 worktree
associations a vzdáleně ověřené annotated tag objects i peeled commits.
Nezávislé preflight review SHA-256
`8e690e0dfd021f47b29be78b702ce5c58076be8f6e4262de08253053f6fb1152`,
manifest `100332ce8de3550450da2661d6c9a6124cb08f5ef06d7e82dc4b98d3bc1a3382`.

| Vlastní nepřipojený local ref | Expected old SHA | Zachovaný remote evidence tag |
| --- | --- | --- |
| `work/full405-baseline-oracles-20261001` | `e6e9aa057bb48a35d244250bac1449777d5d7074` | `evidence/full405-baseline-oracles-20261001` |
| `work/backend-migration-evidence-20261001` | `ce2d2d4d571c9f0c92cf8edb2ebc8f59d233a803` | `evidence/backend-user-data-upgrade-20261001` |
| `work/project-app-acceptance-20261001` | `bc82434cd068c8c2e4f360e2be191b4e55e91b58` | `evidence/taskflow-oracle-20261001` |
| `work/project-app-provider-guards-20261001` | `15337cdeed901c2a8468c16345db31efc2999ea1` | `evidence/project-app-provider-guards-20261001` |

BC není ancestor nové SQLite cherry-pick řady; přesné uchování tagem je
ověřeno odděleně od patch ekvivalence. Jeho uvolnění bylo podmíněné přijatou
a publikovanou SQLite náhradou, nikoli pouze ověřením originu. Dřívější text
tuto podmínku vynechal; oprava výše znamená BC HOLD_CONDITIONAL. Active
atomic51 SQL branch/WT zůstávají.
Vlastník 153 uvolnil starý ref po publikaci M3; active M3 branch/WT zůstávají.
`ded75136` a `51d70e35` jsou navíc zachované vlastními remote evidence tags.
Kód/profile/kernel se touto transakcí nemění. Před provedením musí ROOT znovu
ověřit refs, remote tag objects, asociace a explicitní vlastnictví; transakce
ověřuje všechny čtyři tag objects a CAS-deletes všechny čtyři local refs.
Obnova je připravená jako atomický `create`, pouze pokud jsou všechna jména volná.
**Provedení dosud NOT_RUN**; odhad 212 branches / 71 worktrees platí jen při
nezměněném okolním inventáři. Žádné cizí refy ani physical WT se nemažou.

Třetí private archiv mimo worktree je
`/mnt/vi7000/intentsmith/evidence/completion-cleanup-20261001/ide-code-ledger/ide-code-ledger-physical-1205.tar.gz`:
2 346 989 B, SHA-256
`27d39a23cb8cb1d0a7ce6235d4614f1c67ab597f9cba4b8ad652bf9522d530e5`.
Obsahuje 527 physical a šest review členů: **533 pravidelných souborů /
25 185 430 původních B**. Root i nezávislý reviewer ověřili stream a
originály; originals zůstávají. Review SHA-256
`2ce071413f86e49cab114fa05739cce93f6d68d97e791f9a09f15a6cca3bdd03`,
manifest `c3ef513955740647f6d3dccadcc2126c7a46963412db2857187b6444b91fab5d`.
Historické at-export REVIEW_PENDING se nepřepsalo; archiv se váže na skutečné
accepted physical review `62a55072…`. Dřívější archivy 404 a 2 071 členů níže
zůstávají přijaté. Archive PASS není potvrzení možnosti odstranit worktree.

Historicky byl owned Hunt checkout dočasně znovupoužit jako detached `936e9a33` pro
čekající SQLite běh. Původní `00c71cd4` ref i všech 19 ignorovaných důkazů
jsou uchované a nezávisle ověřené. Nové checkouty ani branch nevznikly;
později byl využit na frozen34 pro accepted GPU UI audit, nyní obnoven na00c;
jeho data zůstávají zachovaná. Kvůli sedmi historicky nečitelným
PID cwd/FD i cizí/UNKNOWN práci zůstává veškeré physical WT removal **HOLD**.

## Navazující uchování 1. 10. 2026, 11:08 UTC

**Doplnění 11:43 UTC:** také celá soukromá `.intentsmith-artifacts` evidence
dokončeného vlastního project-app checkoutu `bc82434c` má nezávislé
`REVIEW_PASS_REGULAR_EVIDENCE_ARCHIVE_ONLY`. Archive mimo worktree
`/mnt/vi7000/intentsmith/evidence/completion-cleanup-20261001/taskflow-ledger/taskflow-ledger-evidence-bc82434c.tar.gz`
má 8 674 307 B, SHA-256
`ad22902762887797addcca84cf61f07deaaebcf841dfad3febbde929e7c18026`.
Reviewer streamem i opakovaně v originálech ověřil všech 2 071 pravidelných
členů / 130 421 962 B a metadata, bez extrakce/spuštění/DB open.
Manifest SHA-256
`ab14df94a356453f31d9dd6e97c88cdc16683533c3b6d053e7691f3272927d51`;
review manifest SHA-256
`3880743005e490312292f07465b6dcd021e0a07da7f015cf24ec69eb721096f4`.
Externí node_modules symlink je excluded a jeho cíl zachovaný.
Process kontrola má 0 pozitivních cwd/FD vazeb, ale 7 nečitelných PIDů;
**worktree delete stále HOLD**, archivní PASS ho nenahrazuje.

Oddělené review dvou starých nepřipojených refs `e6e9/ce2d` potvrdilo
patch ekvivalenci všech šesti commitů v root, přesné evidence tags
a explicitní uvolnění autora. Jeho manifest má SHA-256
`3cea36f14454d78536d9e7ea34669681f408b2e6e289cb1e9ca5a7553ad43f21`.
Pouze pro tyto lokální refs je připravený expected-SHA transakční cleanup
po dokončení aktivních milníků a dalším čerstvém preflightu.
Fresh úplný snapshot `11:29 UTC` má **71 worktrees / 214 local branches /
142 tracking refs / 144 actual remote heads**; nic dosud odstraněno.

Root atomicky pushnul a `ls-remote` ověřil vlastní evidence tags:

| Ref | Exact peeled source |
|---|---|
| `evidence/full405-baseline-oracles-20261001` | `e6e9aa057bb48a35d244250bac1449777d5d7074` |
| `evidence/backend-user-data-upgrade-20261001` | `ce2d2d4d571c9f0c92cf8edb2ebc8f59d233a803` |

Ancestry kontrola potvrdila, že `ce2d` uchovává skutečný physical DB source
`e6fb6b46463e73055cc7924679e6a659ae48c93d`; patch ekvivalence ho nenahrazuje.
Původní ledger source má tag `evidence/project-app-20261001-0913 → 92f7b51c`,
TaskFlow oracle `evidence/taskflow-oracle-20261001 → bc82434c`; physical
TaskFlow `6f0f04d5` je přesný publikovaný integrační source.

Skutečný private archive mimo worktree je
`/mnt/vi7000/intentsmith/evidence/completion-cleanup-20261001/full405-backend/full405-evidence-ce2d2d4d.tar.gz`:
55 023 027 B, SHA-256
`9ecb21fc75e41b52e53fda24eba5e4b9365a25cdcdd6fe475805963bc68aecac`.
Přesných 404 pravidelných členů / 324 826 796 původních B bylo ověřeno
před zápisem, při něm, streamem tar bez extrakce a znovu v originálech.
Root navíc nezávisle znovu ověřil celý stream, aktuálních 404 originálů,
15 manifestových členů i samotný manifest, mode `0700/0600`.
Archive metadata manifest SHA-256
`346b40bbe41149cd7f4d7f61bf053b808d6f8c77ba87a6fbb3c65643c651c8fe`;
root review `.intentsmith-artifacts/root-archive-review-full405-20261001/REVIEW.json`
v IDE stagingu má SHA-256
`28b0eb7998878e5c183bbd985ddbd0d9d54b771a9545487629fd4ed745de7dfc`.

**Hranice:** archiv je jen pravidelná evidence, není celý worktree backup.
Samostatná fixture symlink `link.pdf` je excluded s uchovanými metadata;
node_modules, .git, produktový source a produkční DB nejsou v archivu.
Originals zůstaly. Sedm UID1000/mixed procesů má nečitelné cwd/FD a úplné
uvolnění nebylo prokázané. Dokončený vlastní checkout je navíc nyní aktivně
znovupoužit pro bounded public provider-harness opravu; nesmí se odstranit.

Čerstvý local snapshot `11:08 UTC` má **71 worktrees / 214 local branches /
142 tracking refs**. Oproti předchozím 213 přibyla jedna bounded větev v
existujícím checkoutu; nevznikl worktree. Posledních 144 actual remote heads
patří `10:42 UTC`, není přeznačených na nový čas. Nejmenší pozdější ref
cleanup stále vyžaduje nový ownership/association/expected SHA preflight;
žádné odstranění se tímto uchováním netvrdí.

## Ověřený časový snapshot

Čtení proběhlo 1. 10. 2026 `09:00–09:11 UTC`: **71 worktrees**, **213
lokálních větví**, **142 remote-tracking refs**, **144 skutečných remote
heads**. Lokální + tracking součet je 355; tracking refs nejsou úplným
aktuálním seznamem remote heads. Tehdy publikovaná integrace byla přesně
`5b79d05cb384778ca5ca330d7c8265f3ecfc3510`, remote main `838b8cee`.
Následné root integrace nejsou přeznačené na tento starší snapshot.

| Kategorie | Worktrees | Lokální větve |
|---|---:|---:|
| `SAFE_ABSORBED` | 0 | 0 |
| `PRESERVE_EVIDENCE_OWNED` | 4 | 4 |
| `HOLD_FOREIGN_ACTIVE_DIRTY_UNKNOWN` | 67 | 209 |

Pět worktrees bylo dirty, 51 mělo privátní podklady a sedm procesů mělo
nečitelný cwd. Během čtení se pohnuly aktivní CHAT a project-app refs.
Samotný clean stav ani patch ekvivalence nedokazuje ukončené vlastnictví
nebo dostupnost původního SHA na remote. Ancestry, patch ekvivalence,
privátní důkazy a procesní nejistota jsou v manifestu vedené odděleně.
529 dosažitelných lokálních commitů nemá prokázanou dostupnost v remote
historii; jde o uchování historie, nikoli 529 chybějících funkcí.

Privátní artefakty v integračním checkoutu:

| Soubor | SHA-256 |
|---|---|
| `.intentsmith-artifacts/cleanup-candidate-manifest-20261001/candidate-manifest.json` | `fcef378a815c61e814af0cfada5df27b7ff6da2135ed44d98585e8e1e966e331` |
| `.intentsmith-artifacts/cleanup-candidate-manifest-20261001/git-cherry-proofs.json` | `e3e0d4134b530ccdb76fa702c547d4437d0ea32abc6f37152a2cba9198fd479f` |

## Historický první návrh — snapshot 09:11 UTC

Po uzavření aktivních milníků lze nejprve vzdáleně uchovat přesný vlastní
author commit `e6e9aa057bb48a35d244250bac1449777d5d7074`, následně znovu
ověřit stav jediné nepřipojené lokální větve
`work/full405-baseline-oracles-20261001` a samostatně posoudit její
odstranění. Její patch je integrován v `742d3dac`, původní SHA ale ve
snapshotu neměl doložené vzdálené uchování. Nyní se neodstraňuje.

Před každým odstraněním je nutný aktuální immutable source, doložené
vlastnictví, přesný ref SHA, vzdálené uchování originálu, uchované privátní
důkazy a nová kontrola worktree/process stavu. Cizí nebo UNKNOWN práce
zůstává. Fyzický source `92f7b51c` musí mít vlastní vzdálené uchování;
cherry-pick do integrace sám toto původní SHA neuchovává.
