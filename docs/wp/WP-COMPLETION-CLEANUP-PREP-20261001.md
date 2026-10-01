# WP — příprava závěrečné redukce větví a worktrees

**Autorita:** operátor požaduje redukci po dokončení analýzy a milníků.
**Stav:** `PRIVATE_ARCHIVE_REVIEW_PASS / HOLD_DELETION`; žádné mazání
ani změna cizích refs/worktrees neproběhla. Vlastník inventury `/root/full405_diagnosis`.

## Navazující uchování 1. 10. 2026, 11:08 UTC

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

## Nejmenší pozdější návrh

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
