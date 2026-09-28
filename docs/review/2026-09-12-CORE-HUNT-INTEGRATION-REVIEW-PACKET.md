# Core + hunt: společný kandidát a databázový upgrade — review

Stav: `IMPLEMENTATION_CANDIDATE / REVIEW_PENDING / PHYSICAL_MODEL_JOURNEY_UNPROVEN`.

Integrace spojuje Studio builder a jednotlivě schvalovaný web s verzovanou
modelovou evidencí a hunt ledgerem. Původní souběh dvou různých migrací 111
už nezastaví podporovaný upgrade žádné z těchto dvou větví.

## Přesné vstupy a rozsah

- Core: `ab0565bc7a8f47e452c4f41a3f65b3d8564ad5fe`.
- Commitnutý hunt: `3f3a22203b51905a6bf834cb39f5e7f76b2306f2`.
- Merge: `cc8269976d55d6dd94b3e859bc5f23dac303088c`.
- Explicitní graph baseline: `71968508eacb68c1e6216eefc5c723c60e525e91`.
- Integrovaný source/test kandidát: `f80bcaa1769667acaeb4e7ad310058ca25973d64`.
- Pozdější retenční změny huntu jsou vyloučené. Novější foreign HEAD a dirty
  seznam zachycuje `foreign-checkpoint.json`; runtime huntu se neměnil.

Recenzent má použít oba pohledy, nikoli jen combined merge diff:

```bash
git diff ab0565bc..f80bcaa1
git diff 3f3a2220..f80bcaa1
git show --remerge-diff cc826997
```

Předchozí source review webu/builderu na e87 a jeho omezení zůstávají
v [zaznamenaném výsledku](2026-09-12-WEB-BUILDER-OPERATOR-REVIEW.md).
Studio/CODE delta core má [vlastní packet](2026-09-12-BUILD-COMPOSER-CODE-REVIEW-PACKET.md),
hunt [validační follow-up](2026-09-12-GPU-HUNT-VALIDATION-REVIEW.md).
Tyto předchozí výsledky nejsou samy přijetím dnešního merge.

## Co prověřit

1. **Adopce databáze.** `src/db/migrate.js` mapuje pouze přesný starý stamp
   `2026_09_11_111_conversation_web` na `2026_09_11_113_conversation_web`.
   Hunt 111/112 ani web body se nemění. Guard validuje projektovaný union
   před změnou historie; chybějící kanonický cíl a neznámý owner 111 se
   odmítnou bez změny DB. Datum adopce nepřepíše původní `applied_at`.
2. **Migrační důkaz.** `tests/schema-migrations.test.js` používá skutečné
   manifesty fresh/base/web/hunt, uložená data a diskové close/reopen.
   Zachovává binární output, spotřebované approval, pending request, outbound
   audit, COMPLETE run i bootstrap/catalog/attempt rows. Kontroluje shodné
   schéma, nula FK vad, nulový druhý upgrade a ochranu proti přímému zápisu
   či REPLACE. `migration-body-parity.json` porovnává 197 historických
   souborových vstupů; jediná dovolená odlišnost je exportovaná verze webu.
3. **Modelová evidence.** CODE helper/lock/Node provenance z core se zachovává
   spolu s provider verzí a efektivními inference options huntu. Historický
   COMPLETE není znovu použitý pro jiný contract/provider. Pairwise chyba
   nese identitu skutečně selhavšího modelu, i když jde o incumbent. Povinné
   okolí: role plans, evaluation runner/history/read model, candidate trial,
   model-use authority a provider 111. Žádná aktivace bindingu neproběhla.
4. **Autorita.** Provider dokument je kanonická Decision 048, původní cesta
   044 je označený alias; web Decision 044 zůstává. Oprava nepřidává práva.
   Web transport a repository jsou byte-identické proti ab0565bc. Kontrola
   veřejné IP závisí na přesném ipaddr.js 2.4.0 a update vyžaduje re-review.
5. **Graph a setup.** Připnutí grafu má vlastní commit: devět explicitních
   nových hran, sedm odstraněných, 1323 celkem, cykly stále 3 / 28. Změna
   lifecycle testu seskupuje pouze šest inicializačních migrací; FK je ON
   před transakcí, všechny testované operace až po commitu. SQL/schema/reopen
   parity a měření jsou uložené; žádný test ani timeout nebyl oslabený.

## Důkazy a jejich hranice

| Ověření | Source | Výsledek |
|---|---|---|
| Celý povinný deterministic profil | f80bcaa1 | **353 PASS / 0 FAIL / 0 TIMEOUT / 0 BLOCKED / 0 SKIPPED** |
| Schema migrace včetně 6 nových upgrade/adoption regresí | f80bcaa1 | **61/61** |
| Lifecycle application service | f80bcaa1 | **53/53**, 18 110 ms při nezměněném 60s limitu |
| Model upgrade / evaluation suites / web | f80bcaa1 | **71/71 · 24/24 · 23/23** |
| HTTP lifecycle / web | 71968508 | **75/75 · 7/7**, dva skutečné procesové restarty |
| Studio composer DOM / M0 / M1 | 71968508 | **PASS / PASS / prvně FAIL, izolovaně PASS** |
| Registry + artifact integrity | f80bcaa1 | 516 programů; artifact validation **158/158** |

Full report SHA256: `c949dcbc3d08f7265325ebcb7fd4978e90249d72b1d9dd2122838e397a293bea`.


První full běh `core-hunt-integration-20260912-01` na 71968508 zůstal
**351 PASS / 1 FAIL / 1 TIMEOUT**. Chyba roadmap census je opravená; lifecycle
setup má stejný SQL digest a schéma, 1630,72 → 12,75 ms pro jednu přípravu.
Samostatný nezměněný lifecycle před opravou prošel za 34 496 ms.

Studio společná sekvence měla **2 PASS / 1 FAIL**, následný izolovaný M1
běh na stejném source **PASS**. Příčina chybějící wire/response evidence pěti
list rodin prvního M1 běhu není prokázaná. Oba záznamy zůstávají; nejde o
3/3 úspěšnou sekvenci ani o odstraněnou nestabilitu. Síťová policy zůstala
stejně přísná. HTTP používá skutečné routes/service/SQLite/Git/bwrap, ale řízený
model/auth/project registry. Studio DOM ověřuje formulář proti production backendu a očekávané odmítnutí
503 při chybějící policy, bez schválení či inference. GPU devices byly skryté.

Od runtime pinu 71968508 se produktové ani Studio/HTTP probe bytes nezměnily;
f80bcaa1 mění jen setup jiné unit fixture a dokumentaci. Žádný z oddělených
běhů neprokazuje celý fyzický Studio→server→binding→model→approval→execution→
restart journey. To, nové CODE měření pod společným kontraktem, dokončení
pozdější retence huntu, nezávislé přijetí delty a M5/M6 vnější podmínky zbývají.

Podrobnosti: [run record](../execution/runs/core-hunt-integration-20260912.md).
Přenositelný bundle, manifest s hashi a archiv jsou v
`.intentsmith-artifacts/core-hunt-review-20260912/`. Bundle zahrnuje obě
linie od společného předka 983121ee; žádný push, deploy, podpis, změna klíče,
živé DB nebo cizího checkoutu nebyla provedena.
