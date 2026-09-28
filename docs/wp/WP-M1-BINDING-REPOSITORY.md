# WP-M1-BINDING-REPOSITORY — druhý checkpoint manual bindingu

**Typ:** zapisující WP · **Slot:** hlavní zapisující vlastník, **hlavní checkout**
**Vstupní revision:** poslední schema checkpoint commit po `af889e3b`
**Adresát:** hlavní dev, pokračování po uzavření B3 schema checkpointu
**Souběžný WP:** [`WP-M1-BOUNDARY-RATCHET`](WP-M1-BOUNDARY-RATCHET.md) v efemérním worktree

Toto je zadání, ne stav. Stav je podle `CONTRACT.md §6` v `ROADMAP.md`.
Procesní rámec: [`2026-08-08-PARALLEL-PILOT.md`](../review/2026-08-08-PARALLEL-PILOT.md).

---

## 0. Vstupní stav

Uzavřené a doložené:

- `ce2d8b2b` — append-only manual binding lineage, migrace `048`;
- `684263e3` — migrační identity guard, fail-closed před jakoukoli DB mutací;
- `af889e3b` — atestace checkpointu.

Guard je ověřený nezávisle dvěma cestami: z čerstvého klonu (atestace v
[`016`](../decisions/016-migration-identity-guard.md)) a z `git archive`
mimo pracovní strom. Shodně **50 souborů, 50 unikátních verzí, 0 duplicit,
`tests/schema-migrations.test.js` 36/36, registry 372 programů, 1 500
trackovaných cest**. `049` prošla `validateMigrationPlan()` nad pracovním
stromem — plán 51 migrací, PASS.

**Nepřeměřovat.** Přeměřuje se až to, co se změní.

## 1. Uživatelský výsledek

Manual binding má úplnou, transakčně bezpečnou a typovaně odmítavou repository
vrstvu: caller nemůže podstrčit vlastní override pole, dočasný retirement
incidentu se při chybě vrátí celý, a retryable incident skončí typovaným
blockerem místo tichého pokračování.

## 2. Vlastněné a zakázané cesty

| | |
|---|---|
| **Vlastněné** | `src/upgrade/**` · `src/db/migrations/**` · `src/db/migrate.js` · migrační a binding testy v `tests/**` |
| **Roadmapa** | `ROADMAP.md` **§5** (WP-M1-MODEL / B3-FAILOVER) — viz §4 |
| **Registry** | přidání vlastních záznamů + regenerace `docs/convergence/TEST-REGISTRY.md` |
| **Zakázané po dobu překryvu** | `ROADMAP.md` §12 · `CONTRACT.md` · `SYSTEM-MAP.md` · `README.md` · `scripts/module-boundary-ratchet.mjs` · `tests/module-boundary-ratchet.test.js` · `tests/fixtures/module-boundary/**` · `docs/wp/**` · `docs/review/2026-08-08-*` |

Globální dokumenty jsou po dobu překryvu zmrazené. Po spojení větví je na merge
SHA aktualizuje tentýž člověk v oddělené roli integrátora.

## 3. Connector

`ModelRequest/Result` v1. **Nemění se.** Kdyby to práce vyžadovala, je to stop
condition podle §8, ne rozhodnutí uvnitř WP.

## 4. `ROADMAP.md §5` — jednorázová úprava na začátku

Dnešní §5 tvrdí, že repository operace a incident supersede zůstávají zavřené.
Po `049` a repository commitu to přestane platit. Ve stejné úpravě:

- převeď migrační guard do **doloženého minulého času** — implementován
  `684263e3`, atestován `af889e3b`, ne budoucí acceptance criterion;
- přidej přímý odkaz na `docs/decisions/016-migration-identity-guard.md`;
- **nepřidávej čísla** (50/50, 36/36) — roadmapa je nesmí opakovat, zastarala by.

Tím §5 přechází celé na tento WP a governance balík vlastní už jen
`CONTRACT.md §6` a `ROADMAP.md §12`. Překryv mezi oběma WP klesá na nulu mimo
registry.

## 5. Postup

### Krok 1 — uzavřít schema checkpoint

1. Dokončit testovou aserci kotvenou na **vlastněný stabilní identifikátor
   guardu 049**, ne na text chyby, s pozitivním protějškem.
2. Negativní pin: neměnnost stavu `RESTORED` a zákaz jeho smazání.
3. Focused sada: migrace, storage, failover, mutační kontrola.
4. `ROADMAP.md §5` podle §4 výše.
5. Čistý indexový export.
6. **Samostatný commit migrace `049`.**

Po tomto commitu je strom čistý → **operátor může vydat governance commit** →
teprve pak startuje souběžný ratchet WP. Je to brána pilotu, ne volitelný krok.

### Krok 2 — repository checkpoint

1. **Úplné testy zakázaných caller override polí** pro `apply` i `rollback` —
   obě cesty, ne jen jedna.
2. **Rollback celé transakce** po dočasném retirementu incidentu: při chybě se
   vrací i retirement, ne jen navazující zápis.
3. **Typovaný blocker pro retryable incident** — ne obecná výjimka, ne tiché
   pokračování.
4. Registrace nové sady v `tests/registry.json` + regenerace
   `docs/convergence/TEST-REGISTRY.md`.
5. Širší deterministická validace.
6. **Druhý commit.**

## 6. Demonstrace

Skutečný apply a rollback nad izolovanou DB: caller podstrčí zakázané override
pole a dostane typované odmítnutí; dočasný retirement incidentu se po vyvolané
chybě vrátí celý, včetně retirementu.

## 7. Testy

**Pozitivní:** povolený apply i rollback za jinak stejných podmínek projdou.
Bez tohoto protějšku test neměří odmítnutí, jen to, že se nic nepovedlo.

**Negativní:** každé zakázané override pole zvlášť pro apply i rollback ·
retryable incident → typovaný blocker · chyba uprostřed retirementu → rollback
celé transakce · neměnnost a nesmazatelnost `RESTORED`.

Asertace kotvit na **vlastněný stabilní signál** — constraint, error code nebo
prefix zprávy, který vlastníš. Nikdy `assert.throws()` bez predikátu: prošel by
i na syntaktické chybě v migraci.

## 8. Stop condition

- potřeba změnit `ModelRequest/Result` v1 nebo jiný veřejný povrch;
- runtime aktivace, GPU běh nebo oprava legacy V1–V4 — všechno mimo scope;
- nejasnost v bezpečnostní nebo datové sémantice;
- konflikt vlastnictví se souběžným WP mimo deklarovanou registry výjimku.

## 9. Ověřovací příkazy

```bash
node tests/schema-migrations.test.js
node tests/m1-model-binding-storage.test.js
node tests/m1-model-binding-repository.test.js
node tests/m1-model-failover-schema.test.js
node scripts/validate-test-registry.js
git diff --check
```

GPU jen registrovanou T3 sadou s `concurrency=1`, a **ne po dobu překryvu** —
souběžný WP na GPU nesahá, ale sériovost se drží vůči celému stroji.

## 10. Rozsah, který zůstává mimo

Runtime aktivace, GPU běh, opravy legacy V1–V4. Gate 1 zůstává pravdivě
`BLOCKED` a tento WP to nemění.

## 11. Výstup

Dva commity v hlavním checkoutu, merge commity bez squashe. Do
`docs/execution/runs/wp-m1-model-report.md` patří evidence s přesným source SHA.

Zaznamenej čas startu a dokončení každého kroku a operátorský čas zvlášť —
vstupuje to do vyhodnocení pilotu, ne do tohoto WP.
