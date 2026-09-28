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

Sjednocovací commit je `966cc4689f8c6d0131b19c87f06bfab7ee54f117`.
[GitHub CI na tomto commitu](https://github.com/Belphareon-bak/intentsmith/actions/runs/36476201566)
prošlo včetně čisté instalace npm/Yarn závislostí, sestavení protokolu a
kontroly čistého pracovního stromu. Tento závěrečný dodatek mění pouze report.

Celý nový offline/database běh na `966cc468` skončil **385 PASS / 1 FAIL /
0 TIMEOUT / 0 BLOCKED / 0 SKIPPED**, verdict **FAIL**. Přesný non-PASS seznam
se shoduje s nasazeným `79c19096`: jediný
`IS-T1-TESTS-NIGHTLY-ORCHESTRATOR-SELF-TEST` kvůli Gate 0 pečeti.
Všech 386 výsledných logů bylo ověřeno proti SHA-256 z reportu.
Registr ani pečeť se kvůli výsledku neměnily; nejde o zelenou release gate.

Běh je `2026-09-28T20-03-39-517Z`, izolovaný pomocí `bwrap --unshare-net`.
Po 241 PASS byl ukončen SIGTERM během hostitelského nedostatku paměti;
ve stejném čase earlyoom ukončoval procesy. Po obnovení dostupné paměti
runner navázal ze svého ověřeného checkpointu na stejném SHA a se stejnými
volbami. Přerušený browser log i checkpoint před navázáním jsou zachované.
Dřívější chybně nastavený artifact root a záměrně přerušená příprava
toolchainu mají vlastní neúspěšné výsledky, ne nahrazené PASS.

Report: `/mnt/vi7000/.intentsmith-artifacts/main-reconcile/2026-09-28T20-03-39-517Z/report.json`.
Soukromé logy a srovnání jsou v
`/home/belphareon/Projects/intentsmith-push-audit-20260928/main-reconcile/`.
Uživatelská DB, služby, profily, modelové vazby a běžící okna se při sjednocení
neměnily. Aktuální `main` je vývojový integrační bod; novější pracovní větve
a jejich otevřené review zůstávají samostatné.
