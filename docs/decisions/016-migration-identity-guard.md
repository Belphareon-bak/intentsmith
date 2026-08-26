# 016 — Migrační identita musí být fail-closed před DB mutací

- **typ:** BLOCK pouze pro `runMigrations` před první DB mutací
- **stav rozhodnutí:** PŘIJATO OPERÁTOREM 2026-08-08
- **stav implementace:** IMPLEMENTOVÁNO V TOMTO CHECKPOINTU
- **WP:** WP-M1-MODEL / B3-FAILOVER (acceptance criterion)
- **rail:** R3, R5
- **vzniklo při:** rozboru podmínek paralelního vývoje, 2026-08-08

## Proč to patří do B3, ne do budoucího paralelního WP

Není to příprava na paralelismus. Numerický index migrací **nikdy nebyl
unikátní a kolidoval už dvakrát bez jakéhokoli paralelismu** — u `008`
(`2026_02_19_008_v69_ledger_core.js`, `2026_02_20_008_v69_expert_to_expertise.js`)
a u `030` (`..._030_v103_model_overrides.js`, `..._030_v107_task_memory.js`).
Skutečnou identitou je celý řetězec `version`, ne číslo v názvu.

Guard patří do B3, protože právě B3 migrace aktivně vytváří — `046`, `047`
a `048_model_binding_operations`. Původně navrhovaný termín „před vznikem
`048`" byl zmeškán: `048` i její storage test už přistály v
`ce2d8b2b3a2b1a54e7e0787f9f37f84c038b1af6`, guard nikoli. To je potvrzený
procesní a bezpečnostní nález, ne důvod commit přepisovat.

Náprava je samostatný checkpoint před přijetím jakékoli další migrace. Teprve
po něm může pokračovat `049_model_binding_manual_supersede`; guard zůstává
podmínkou B3 acceptance.

## Výchozí stav na `ce2d8b2`

- řadí soubory lexikograficky podle názvu;
- jako identitu ukládá exportovaný `version`;
- **nekontroluje** duplicity, formát ani shodu názvu souboru s exportovanou
  verzí;
- chybějící `version` nebo `up()` pouze zaloguje a přeskočí;
- vytváří `schema_migrations` před discovery a validací;
- eviduje pouze `version`, nikoli checksum obsahu.

Chování bez guardu se liší podle stavu DB:

- na **fresh DB** se dvě stejné verze obě jeví jako pending, protože množina
  `applied` je snapshot z počátku běhu a nikdy se neaktualizuje; druhá spadne
  na `PRIMARY KEY` a její transakce se rollbackne;
- na DB, která danou verzi **už má**, se nově přidaný soubor se stejnou verzí
  **tiše přeskočí**.

Tichý přeskok je ta nebezpečná varianta a nastane právě v produkci.

## Invariant

Loader před **jakoukoli** DB mutací fail-closed odmítne:

1. duplicitní `version`;
2. chybějící nebo nefunkční `up()`;
3. chybějící, netextovou nebo formátově neplatnou `version`; platná gramatika
   je

   ```text
   ^\d{4}_\d{2}_\d{2}_\d{3}(?:_[a-z0-9]+)*$
   ```

4. chybějící nebo neplatný název `.js` souboru;
5. název souboru, který nesplňuje delimiter-aware invariant

   ```
   basename === version || basename.startsWith(`${version}_`)
   ```

   Prostý `startsWith` nestačí: verze `..._008` by přijala i `..._0080_bad.js`.

Po úspěšném provedení migrace loader přidá `applied.add(migration.version)`
jako defense-in-depth, aby duplicita nikdy nezávisela jen na DB constraintu.

## Test

Test musí doložit, že guard selže **dřív**, než vznikne `schema_migrations`
nebo proběhne kterékoli `up()`. Negativní případy zahrnují duplicitu,
neplatný formát, basename mismatch, prefixovou kolizi `008` versus `0080` a
chybějící exporty. Testovací seam používá stejný `runMigrationPlan()` jako
produkční `runMigrations()`, ale produkční discovery zůstává natvrdo vázané na
`src/db/migrations/`; veřejný override adresáře nevzniká.

Ručně udržovaný `ALL_MIGRATIONS` v `tests/schema-migrations.test.js`
**zůstává**. Je to jediné nezávislé orákulum proti discovery implementaci;
jeho nahrazení výsledkem discovery by vytvořilo tautologický false-green, kdy
test potvrzuje sám sebe. Doplní se pouze rovnost:

```
počet fyzických .js souborů
= ALL_MIGRATIONS.length
= Set(ALL_MIGRATIONS).size
= počet objevených unikátních verzí
```

## Měření, na kterém stojí zapnutí

Přeměřeno 2026-08-08 na commitnutém
`ce2d8b2b3a2b1a54e7e0787f9f37f84c038b1af6`: **50 fyzických souborů, 50
unikátních exportovaných verzí, 0 duplicit, 0 neplatných verzí a 0 porušení
delimiter-aware invariantu.** `048` exportuje plný řetězec shodný s názvem
souboru. Guard lze proto zapnout fail-closed bez migrace legacy souborů a bez
přečíslování.

Hodnoty jsou snapshot k SHA. Autoritou je test, ne tato čísla; roadmapa je
z toho důvodu neopakuje.

Implementační commit
`684263e34a6f18fa76ede578fee25d13bbe3b5a5` byl následně ověřen z nového
lokálního klonu: **50 souborů, 50 unikátních verzí, 0 duplicit**;
`tests/schema-migrations.test.js` skončil **36/36**, test registry obsahoval
**372** programů a repository hygiene zkontrolovala **1 500** trackovaných
cest. Všechny tři příkazy skončily s exit code `0`.

## Model paralelní práce

- Implementační vlastník je jediný zapisovatel do `src/db/migrate.js`,
  `src/db/migrations/` a migračních testů.
- Paralelní worker smí proti připnutému SHA provést read-only audit nebo
  připravit dokumentační patch v předem povolené cestě.
- Před převzetím se patch přegeneruje proti novému HEAD a znovu projde
  `git apply --check --whitespace=error-all`, kontrolou odkazů a
  `git diff --check`.
- Konflikt, nový invariant nebo potřeba měnit produktový scope se pouze zapíše;
  paralelní worker jej sám neintegruje.

## Pravidla pro budoucí migrace

1. Každá migrace dostane při vzniku globálně unikátní a neměnný identifikátor
   (timestamp/ULID + slug nebo WP ID).
2. Při integraci se **nikdy nepřečísluje** migrace, která už byla testována
   nebo aplikována.
3. Branchová indexace je přijatelná jen tehdy, je-li branch/WP namespace
   součástí finální neměnné verze. Centrální přidělování obyčejných čísel by
   pouze vytvořilo nový serializační bod.

## Odloženo

Checksum aplikované migrace, aby změna už aplikovaného souboru nebyla
neviditelná. Není podmínkou tohoto rozhodnutí ani B3 acceptance.

## Post-review oprava 2026-08-26

Modelová linka už před integrací M2 aplikovala dvě různé plné identity pod
slotem 081 a konsolidaci 082. Jejich pozdější přeznačení na 084–086 bylo v
review prokázáno jako upgrade-unsafe a podle pravidla 2 výše bylo zrušeno.
Guard proto grandfatheruje i přesnou dvojici
`2026_08_24_081_model_policy_trigger_compatibility` a
`2026_08_24_081_model_proof_trigger_compatibility`; žádnou třetí identitu pod
081 nepřijme. Omylem aplikované 084–086 jsou trvale vyřazené a runner je
atomicky adoptuje na původní identity. Stejný numeric-slot guard se nyní
aplikuje i na uložené `schema_migrations`, takže přejmenování souboru nemůže
skrýt historickou branch kolizi.
