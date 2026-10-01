# WP — příprava závěrečné redukce větví a worktrees

**Autorita:** operátor požaduje redukci po dokončení analýzy a milníků.
**Stav:** `HOLD_CLEANUP_PREPARATION_ONLY`; žádné mazání, archivace ani
změna cizích refs/worktrees neproběhla. Vlastník inventury `/root/full405_diagnosis`.

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
