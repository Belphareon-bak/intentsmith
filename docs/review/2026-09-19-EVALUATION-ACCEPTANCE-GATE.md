# Přejímací brána GPU huntu — 19. 9. 2026

Stav: IMPLEMENTED / VALIDATION_IN_PROGRESS / REVIEW_PENDING / NOT_DEPLOYED.
Autorita: přímé zadání operátora po review `df459c33`: odvodit `decisionReady`
z uložené přejímky hodnotitele (§3) a přijatého párového provozního měření
(§8 krok 5) pro konkrétní contract SHA. Tento packet žádný profil nepřijímá.

## Změna chování

`decisionReady` je getter nad záznamy v téže SQLite DB jako historie evaluací.
Samotná přejímka hodnotitele nestačí. Chybějící tabulka, chyba čtení, poškozený
obsah, jiný kontrakt nebo runtime a odvolaná přejímka bránu zavírají.
Spustitelnost průzkumného měření zůstává oddělená.

Migrace 116 přidává append-only `model_evaluation_acceptances`. Ukládá celý
přijatý report, obsahový SHA-256, recenzenta, datum, odkaz a odůvodnění přijetí.
Odvolání je další záznam s vazbou na původní přejímku; historii nepřepisuje.
Žádný běh modelu ani úspěšný test nezapisuje přejímku automaticky.

Fingerprint runtime zahrnuje celé `src/`, `contracts/`, Node, dependency lock
a oba soubory provozního runneru včetně wrapperu providera. Změna nepřímo
načítaného prompt builderu tím přejímku také zneplatní.

Párová přejímka se váže na přijatého hodnotitele, konkrétní role/kontrakt,
artefakty obou modelů, provider, GPU, kontext, parametry generování a uzamčený
provozní plán. Jeho verdikt se přepočítá existujícím rozhodovacím postupem,
nepřebírá se z textu reportu. Vývojové případy, neúplné páry a neplatné pokusy
nelze tímto importérem prohlásit za rozhodovací důkaz.

Doporučení vychází z **přijatého provozního verdiktu**. Krátký benchmark nemůže
přebít jeho NEROZHODNUTO ani přenést přejímku na nového kandidáta. Dvě souběžné
přejímky pro tutéž dvojici blokují použití, dokud operátor výslovně neodvolá
nahrazenou. Přijetí profilu samo neaplikuje binding.

Plány nejsou cache přejímky. Po odvolání se změní i existující instance:
po doběhnutí inference, při zápisu rozhodnutí, při čtení doporučení a při
retenční kontrole. Zápis rozhodnutí kontroluje přejímku uvnitř SQLite write
transakce. Retence znovu ověřuje důkaz v existujícím callbacku pod zámkem
přesného artefaktu; vyžaduje přijaté výsledky všech použitelných rolí.

API a detail v Evaluacích ukazují stav, konkrétní důvod uzavření a ID/recenzenta
přijatých důkazů. Není to nový souhrnný quality score.

## Zápis přijaté evidence

Pouze pro explicitně přijatou přejímku, po nasazení migrace 116:

```sh
node scripts/model-evaluation-acceptance.js --db /absolutni/c3.db
node scripts/model-evaluation-acceptance.js --db /absolutni/c3.db --record /absolutni/prijata-prejimka.json
```

První příkaz je read-only. Druhý importuje posouzený JSON, nevytváří schválení,
neprovádí migraci ani nespouští hunt. Databáze musí existovat. JSON envelope:

- `schemaVersion: 1`, `kind: GRADER | OPERATIONAL | REVOKE`, `role`,
  `contractSha256`, `evidence`, `review`; u odvolání také `targetId`.
- `review`: `reviewer`, `reviewedAt`, `reference`, `reason`,
  `decision: ACCEPTED | REVOKED`, `evidenceSha256` = kanonický hash `evidence`
  funkcí `acceptanceHash`. Recenzent musí skutečně posoudit důkazy;
  importer sám nepotvrzuje nezávislost člověka ani faktickou pravdivost review.
- Oba reporty: `role`, `contractSha256`, `runtimeSha256`, `archiveSha256`,
  `completedAt`, `status: PASS`. Hash archivu je reference na uchované syrové
  důkazy; importer nevydává tvrzení, že externí archiv sám zopakoval.
- GRADER: `tasks` přesně pokrývají aktuální sadu. Každá nese `name`,
  `tier: T1 | T2 | T3`, předem přijatou `floor` a `probes`:
  `empty`, `prompt-echo`, `keyword-stuffing`, `negated-facts`,
  `confident-wrong`, `gold`, `alternative`. Každá sonda nese `score` a
  `responseSha256`; alternativní i referenční odpověď musí dosáhnout ≥ 0,9,
  negativní odpovědi nejvýše podlahy. Chybějící sonda je chyba.
- OPERATIONAL: `graderAcceptanceId`, `plan`, `attempts`, `qualifications`,
  `hardware: { model, vramMb }`, `holdout: { independent: true,
  usedForDevelopment: false, manifestSha256 }`. Plán má stávající formát
  `code-pilot-decision.js`, navíc uzamčené `evaluationContractSha256`,
  `runtimeSha256`, `holdoutSha256`, `workflow: intentsmith`,
  `developmentOnly: false`, `notAHoldout: false`. Předpoklad nezávislosti
  historických skupin stále vyžaduje odborné review, ne pouze různá ID.
- REVOKE: `evidence: { targetId }`, review s `decision: REVOKED`.

Importer pro provozní kvalifikaci v tomto CODE pilotu podporuje **CODE**.
T4 ani kvalifikace ostatních rolí se nepovolí pouhým přidáním PASS do JSON;
potřebují své přijaté postupy. Žádný existující report se zpětně nepovyšuje
na tuto přejímku. Původní C3 0/24 i vývojové 2/8 zůstávají historickou evidencí.

## Co se tím nedokončilo

Žádný produkční profil dosud nemá oba přijaté záznamy. Všechny aktuální role
proto zůstávají průzkumné, timer vypnutý a hold zachovaný. Nový holdout,
čerstvá inference finálního runtime, ostatní role, odvození rychlé sady a
instalovaný celý uživatelský průchod zůstávají podle předchozího packetu
otevřené. Zvlášť: 2/8 není výsledek pro porovnávání modelů.

## Validace

Doplní se přesné commity, výsledky čistého checkoutu a aktuální GPU stav.
Dosavadní cílené kontroly jsou pracovní důkaz, nikoli přijetí modelového profilu.

První celý běh `bfb75e8e`: 356 PASS / 5 FAIL. Vedle zděděné pečeti Gate 0
selhaly aktuální census/manifest, dvě vazby na počet/poslední migraci a P6
seznam hran. Následující změna aktualizuje pouze aktuální soupisy a očekávání
migrace 116; historické receipt/počty se nepřepisují. P6 přídavky jsou šest
konkrétních importů přejímky: plán → store; store → rozhodovací algoritmus
CODE a sdílené inference defaults; zápis rozhodnutí → plán a store; duel →
store. Umožňují odvození a opětovnou kontrolu stejné autority, nepřidávají
cyklus (zůstávají 3 cykly / 28 členů). Jedna dříve odstraněná hrana
`role-quality-suites → synthetic-images` se z baseline vypouští. Rebaseline
je revize implementátora podle CONTRACT §11, nikoli nezávislé přijetí změny.
