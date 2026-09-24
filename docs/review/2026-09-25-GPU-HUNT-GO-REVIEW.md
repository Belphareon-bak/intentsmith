# GPU hunt: předání k velké revizi a aktuální GO brána

25. 9. 2026 · `work/hunt-model-controls-20260917` · **NO_GO pro autonomní výměny**

Tento packet popisuje skutečný stav. Vývojová větev není nainstalovaná release a zelené syntetické testy nepředstavují přejímku modelů. Souhrnný [read-only audit živého stavu](evidence/2026-09-25-hunt-readiness-live.json) lze opakovat:

```bash
node scripts/audit-hunt-readiness.mjs --db=/home/belphareon/Projects/intentsmith/data/c3.db
```

## Co je hotové ve vývojové větvi

- Sběr neznámkuje odpovědi a ukládá přesný digest modelu, poskytovatele, vstup i volby inference. Starší sběr lze bez nové inference převzít pouze po shodě všech těchto faktů. Rozpad a původní run ID jsou v [auditu sběrů](evidence/2026-09-25-hunt-capture-reuse.json).
- Dva samostatně přijatí hodnotitelé mají append-only posudky. Bez druhého posudku a shody po kritériích nevzniká `COMPLETE`; při sporu zůstávají obě známky a existuje oddělené lidské rozsouzení. Převzetí staršího sběru funguje i přes rozsouzení. Žádný z těchto kroků sám neaktivuje binding.
- Zápis známky ani rozsouzení nemění sdílený provider filtr pro následné kandidáty. Hledání staršího sběru neskrývá databázové/programové chyby za nové GPU měření.
- Sestavovač rolí má maximálně dvě role na artefakt a explicitní zákaz autorské/revizní kombinace; neobchází jej jen proto, že současný stav je konfliktní.
- Běžný hunt má progress/ETA, trvalé checkpointy a oddělené fáze sběru a hodnocení. To je implementační stav vývojové větve, nikoli důkaz dokončené lokální kampaně.

## Co právě říká živý stroj

| Brána | Ověřený stav | Důsledek |
|---|---|---|
| Aktuální skóre | 0 `COMPLETE` z 74 použitelných model/role buněk; 10 technicky nepoužitelných buněk zvlášť | Žádná role nemá aktuální srovnání pro automatický výběr. |
| Přijetí hodnotitelů a provozní kvalifikace | 0/7 rolí `decisionReady` | Nelze vydat rozhodovací souhrnnou známku. |
| Uložené odpovědi | 11 strukturálně kompatibilních dokončených sběrů pro D1/D2/R1/R2/CHAT, ale jen jeden artefakt qwen3.8 | Není zde dvojice kandidátů pro srovnání. |
| Provider sběrů | Sběry i připnutý evaluační sidecar používají `0.34.2-intentsmith.1`; interaktivní Ollama používá `0.34.0-intentsmith.1` | Všech **11** dokončených sběrů lze převzít při běhu přes ověřený sidecar. Read-only audit samotné spuštění ani hash binárky nedokládá. |
| Požadované bindingy | qwen3.8 drží D2+CODE+R1; qwen3.5 drží D1+CHAT | Audit našel kapacitní a nezávislostní konflikt. |
| Skutečný runtime binding | Read-only CLI vidí požadovaný stav DB, nikoli ověřený runtime serveru | Nelze tvrdit, že DB stav je přesný stav obsluhy uživatelů. |

Živá DB dosud nemá nové migrace 117/118 ani přijaté místní hodnotitele. Aktivní backend používá release `72247a4983abcb12d42f6da6cc5b27af8f2212fd`, nikoli tento vývojový checkout. Z tohoto důvodu nebyly provedeny změny živé DB, bindingů, timeru ani služby.

## Revizní rozhodnutí a cesta k GO

1. **Přijmout měřidla.** Nezávisle a zaslepeně označit čerstvé odpovědi pro každou sémantickou roli, přijmout nezávislou dvojici různorodých hodnotitelů pro každou roli podle předem zamčených mezí včetně společných falešných přijetí a odmítnutí. Historické známky jednoho externího hodnotitele nelze tímto krokem zpětně povýšit.
2. **Srovnat profil a provider.** Spustit nové sběry pro nejméně dva přesné artefakty na roli pod stejnou přijatou verzí poskytovatele. CHAT musí ověřit skutečnou produkční systémovou zprávu, směrování, historii, limity a opravy; vývojový vícekolový panel s `think:false` a bez systémové zprávy je jen průzkum.
3. **Ověřit pořadí na nových provozních případech.** Předem uzamknout prahy, interval, rozpočet a sadu nezávislých případů. Zvlášť ověřit CODE plným opravárenským workflow; staré 21/21 na vývojových úlohách není holdout. Technické skóre a provozní dokončení neslévat.
4. **Sestavit sedm rolí jako celek.** Jen z kvalifikovaných variant odstranit současné sdílení CODE/R1 a překročení dvou rolí. Ověřit fallback, rychlost přepnutí a rollback. Pokud pro nějakou roli není vhodná náhrada, verdikt zůstane `NEROZHODNUTO` s výslovně přiznaným konfliktem.
5. **Přejmout nainstalovanou release.** Až po nezávislé revizi vývojového kódu provést zálohovanou migraci, fyzický průchod na běžící službě, negativní cesty a dohled. GO se váže na tuto přesnou release a evidenci, ne na větev.

Alternativa s menším počátečním nákladem je nejprve pod dohledem zprovoznit **sběr bez rozhodovací autority**. Dostane nové srovnatelné odpovědi a přesný pokrok bez rizika automatické výměny; rozhodovací brána zůstane zavřená do přejímky hodnotitelů a provozního ověření. Tato alternativa je částečný provoz, nikoli GO autonomního huntu.

## Kontroly přesného revizního commitu

Na čistém commitu `5e32abfe` dokončila deterministická sada `offline,database` 375 programů: **364 PASS, 1 FAIL, 10 BLOCKED**. Jediný FAIL je `tests/nightly-orchestrator-self-test.js`: Gate 0 registry hash se liší od nezávisle revidované policy (`Nightly evidence contract violation: registry hash differs from the reviewed Gate 0 policy`). Tatáž chyba se projevila už na čistém `94315ed9`; není to zelený výsledek ani důvod přepsat review pečeť. Detaily jsou v lokálním reportu `.intentsmith-artifacts/test-runs/2026-09-24T23-04-50-460Z/report.json`. Cílené kontroly modelového read modelu prošly 26/26. Po opravě rozlišení systémového a evaluačního provideru se i samostatný CLI report řídí stejným připnutým evaluačním filtrem jako `ModelRegistry` a uvádí běžící interaktivní provider zvlášť. Živý read-only audit byl zopakován; změnil počet podmíněně znovupoužitelných sběrů z chybně uvedené nuly na 11, verdikt zůstává `NO_GO`.
