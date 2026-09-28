# Sjednocení GitHub main s aktuálním IntentSmithem

Autorita: operátor 28. 9. 2026 požádal o push commitnuté práce, povinnou
publikaci schválených milníků a po vysvětlení odlišných historií zadal
„tak to naprav“. Jde o sjednocení repozitáře, nikoli přijetí veřejného releasu.

## Přesný rozsah

- Původní GitHub `main`: `6676902c5f6fe7a5d66aba0d79cb502e0f3a60e4`,
  66 commitů, poslední z 29. 7. 2026. Jiný root než vývoj vycházející z C3;
  `git merge-base` nemá výsledek ani v úplném, neshallow repozitáři.
- Aktuální vývojový základ: `04f2be7131654a432dba610544a0d1786f6f62af`,
  větev `work/studio2-sessions-visual-20260928`. Obsahuje nasazený backend
  `c84b88cd` a frontend `79c19096`, včetně poslední dokumentace nasazení.
- Povinná publikace milníků: převzatý dokumentační patch `74738dc0`.
  Nepřebírá se jeho rodičovská větev s novějším hunt kandidátem.
- Původní `main` zůstává v `archive/main-before-reconcile-20260928` a jako
  první rodič sjednocovacího merge. Druhý rodič nese aktuální vývoj.
  Výsledný strom je záměrně aktuální IntentSmith, ne součet dvou různých
  aplikací. Starý pnpm/OpenCode strom je dostupný v archivu a historii.

Produktové cesty `src/`, `contracts/`, `tests/`, `intentsmith-ide/`,
specialisté i dependency manifests zůstávají shodné s `04f2be71`.
Změny jsou omezené na instrukce, README, tento report a odpovídající CI.
Nové pracovní větve vznikají z `main`; existující workery jej převezmou
ve svém bezpečném checkpointu. Cizí checkouty se nepřepínají ani nerebasují.

## Stav a hranice přijetí

Základ je **LOCAL_PRODUCTION_DEPLOYED / IMPLEMENTATION_VERIFIED /
REVIEW_PENDING**, nikoli veřejný release. Výchozí zaznamenaný profil na
`79c19096` má **385 PASS / 1 FAIL / 0 BLOCKED**; FAIL je Gate 0 pečeť registru.
Tento původní výsledek není přepsán. [Přesné důkazy nasazení a limity](2026-09-28-STUDIO2-RECENCY-CATEGORIES.md).

Novější `work/hunt-model-controls-20260917`, `work/intent-resilience-20260928`
a odlišná `codex/studio2-integration-20260925` zůstávají publikovanými
pracovními větvemi. Jejich vlastní nepřijaté změny se do tohoto sjednocení
nepřidávají a otevřené review/M5/M6 se automaticky nepřijímá.

## Ověření sjednocení

Před posunem `main` se ověřuje shoda produktového stromu s přesným vstupem,
zachování obou historií a vzdálených SHA, registry, modulové hranice,
generovaná vrstva Studia, privacy HTTP a Studio 2 testy. Nové GitHub CI běží
na Node 24 a npm lockfile aktuálního produktu; původní `pnpm verify` patří
k archivované aplikaci. CI je explicitně vývojový výřez, nikoli celý
offline/database profil nebo release gate.

Lokálně prošlo všech 21 kontrolních příkazů vývojového CI: registry, modulové
hranice, generátor, privacy HTTP skupina a všech 17 Studio 2 testovacích programů.
První pokus správně selhal na chybějících IDE workspace závislostech; doplněna
instalace z nezměněného Yarn lockfile a sestavení protokolu. Neúspěšné logy jsou
zachované. Produktové soubory a oba dependency lockfiles se nezměnily.

Soukromé logy se uchovávají mimo produktový checkout; uživatelská DB, služby,
profily, modelové vazby a běžící okna se při sjednocení nemění. Celý profil
a vzdálené CI mají samostatný přesný výsledek při předání integračního commitu.
