# CHAT pilot: skutečný sběr a podklad k hodnocení

23. 9. 2026 — **CAPTURE_COMPLETE / UNGRADED / REVIEW_PENDING / NO_AUTONOMOUS_GO**.

Na explicitní pokyn operátora „tak rovnou udělej pár dalších kroků“ byl spuštěn připravený pilot. Toto je následný stav po [technické přípravě](2026-09-23-HUNT-COLLECTION-READY.md); historický dokument ani jeho archiv se nepřepisují.

## Výsledek fyzického běhu

| Měřítko | Pozorování |
|---|---|
| Kandidáti | Qwen3.8 a Phi4; přesné digesty v zmrazeném plánu |
| Rozsah | 6 scénářů × CS/EN × 2 modely × 1 opakování |
| Úplné rozhovory | **24/24** |
| Skutečná volání modelů | **64/64** |
| Neúplné generování / transportní chyby | **0 / 0** |
| Výstupní tokeny | **21 019** z maxima 131 072 |
| Čas otevřeného okna | **452,810 s = 7 min 32,810 s** |
| Nejnižší zachycená RAM rezerva | **16,72 GiB** |
| Nejnižší zachycená rezerva evidence / home | **754,48 / 182,59 GiB** |
| Obsahové známky | **Nevydané** |

Sběr běžel na čistém `3a2a82cb9102cf9afce9c43bced00b9959885006`, provider `0.34.2-intentsmith.1`, kontext 16 384, teplota 0,1, výstupní limit 2 048 tokenů na tah. Plán `7fcbbae79a7339b99eab8afa5d9474dab3c443779ce4bd6fad1eba3f1590f1a4` zůstal při běhu beze změny. Po skončení byl vlastní provider uvolněn. Cizí procesy nebyly ukončované; žádný produkční import, změna rolí, mazání ani zapnutí timeru.

Technický audit ověřil všech 64 rezervací a odpovědí, přesnou návaznost dialogu na předchozí odpovědi téhož kandidáta, hashe vstupů/transkriptů, úplnost, digest/provider a kontext z provider telemetry. Neměří správnost obsahu. Minimální rezervy jsou z uložených kontrol před a po volání, nikoli důkaz nepřetržitého minima. Umístění modelu na GPU podle provideru není nezávislá nativní attestation.

| Model | Volání | Součet trvání volání včetně načtení | Výstupní tokeny |
|---|---:|---:|---:|
| qwen3.8:latest | 32 | 248,608 s | 10 983 |
| phi4:14b | 32 | 166,205 s | 10 036 |

Zbylý čas okna zahrnuje kontroly a režii. Toto není závod rychlostí ani pořadí kvality. Dva jazyky a opakování nejsou další nezávislé historické případy.

## Jak odpovědi prohlédnout a oznámkovat

Evidence leží v `/mnt/vi7000/intentsmith/evidence/hunt-chat-pilot-20260923/`.

1. Pro posouzení bez metadata identity otevřít `review/review.html`. Obsahuje společné zadání včetně všech následných dotazů a celé dva skutečné dialogy vedle sebe. Přepínač vybírá test a jazyk; žádné přeskakování pokusů A–D.
2. U každého ze čtyř kritérií zadat číslo **0–1 včetně mezihodnot** a konkrétní důvod. Sporné kritérium zůstane prázdné s vysvětlením. Návrh souhrnu se objeví až po vyplnění všech obsahových kritérií; používá zveřejněné navržené váhy 0,4 / 0,3 / 0,2 / 0,1. Nejsou tím přijaté nové váhy huntu.
3. Striktní formát má vlastní pole a nevstupuje do obsahového souhrnu. Celková poznámka umožňuje uvést osobní preferenci nebo vadu úlohy.
4. Tlačítko **Exportovat moje hodnocení** vytvoří `DRAFT` s důvody, ID položek a hashem podkladu. Bez důvodu ke známce export neprojde. Práce se navíc ukládá v místním úložišti prohlížeče; důležitý výsledek vždy exportovat. Není zde přímý import do produkce.

`review/comparison-with-identities.html` zobrazuje jména modelů a drží je ve stejných sloupcích napříč testy. Je určená pro osobní porovnání. Její export je výslovně **neslepý**. Kdo nejdřív otevře pojmenované porovnání nebo odpověď poznává z dřívějška, nemůže následné posouzení vydávat za nezávisle slepé. Zaškrtávací pole uchovává přiznanou expozici; identitní klíč je samostatný PRIVATE soubor.

Všechny odpovědi se zobrazují jako původní text. Formátovací značky modelu se zachovávají; žádné HTML z odpovědi se nespouští a nic se nestahuje ze sítě.

## Samostatné pozorování formátu

### Zopakování auditu bez GPU

`audit-chat-pilot.mjs` kontroluje uloženou událostní stopu a vytvoří nový report do dosud neexistujícího adresáře. Nevolá modely ani nepřiděluje obsahové známky:

```bash
node /mnt/vi7000/intentsmith/evidence/hunt-chat-pilot-20260923/audit-chat-pilot.mjs \
  --stage=/mnt/vi7000/intentsmith/evidence/hunt-chat-pilot-20260923/capture \
  --out=/absolute/new/audit-output \
  --repo=/home/belphareon/worktrees/is-mobile-completion-20260908
```

První opakování v `audit-replay-01/` potvrdilo totožné kontroly, zdrojová pozorování rezerv a rozpad po modelech (`audit-replay-verification.json`: PASS). Je to reprodukce technického auditu stejných dat, nikoli nové měření nebo nezávislá přejímka hodnotitele. Archiv balíčku obsahuje také identity modelů; pro posouzení bez metadata identity se předává samostatně pouze `review/review.html`.

### Výstupy parseru

Jediný striktní JSON scénář má dvě jazykové varianty a dva modely, tedy čtyři odpovědi. **2/4 byly přímo platný JSON, produkční `extractJSON()` přečetl 4/4.** `format-observations.json` váže výsledky na anonymní ID a SHA odpovědi. Neříká nic o správnosti vyčtených hodnot ani o obsahové známce. Ostatní konverzační scénáře za formát penalizované nejsou.

## Oprava nalezená při pilotu a ověření rozhraní

Ve zmrazeném sběrači se neuzavřené čtyřhodinové okno vykazovalo jako čtyři hodiny spotřeby i po první minutě. Rozpočty a uložené odpovědi tím nebyly změněné. Po dokončení sběru je v `60783fd0` opravený průběžný výpis: uplynulý čas otevřeného okna, jeho rezervovaný strop a konzervativně účtovaný čas havarovaného okna jsou oddělené. Uzavřený pilot už původně obsahoval skutečnou délku, proto jeho data nebyla přepsána.

Stejný commit přidává místní hodnoticí stránky do exportu. Sběr byl proveden před touto opravou výpisu a rozhraní; netvrdíme, že nový kód sběru už prošel dalším modelovým během. Prompty, provider a modelové odpovědi zůstaly původní.

- **45/45 cílených kontrol:** návaznost, ochrana rozpočtu, počítání živého času a havárií, identity, export, bezpečné zobrazení odpovědí a dosavadní přejímací brána.
- **17/17 kontrol v prohlížeči:** všech 24 dialogů / 64 odpovědí byte-for-byte, 12 přepínatelných testů, stálé sloupce modelů, neúplné známky, povinné důvody, navržené váhy, zachování rozpracované práce a export DRAFT. Žádné JS chyby ani síťové požadavky. Testovací známky byly jen v izolovaném prohlížeči a nejsou skutečným posudkem.
- Na čistém `60783fd0`: oba auditované programy **PASS**, artifact validation 160/160 a module boundary 13/13. Nejde o nový běh celého profilu ani o odstranění dříve zdokumentované release pečeti FAIL.

## Připravený další panel a jeho rozpočet

Připravený, **nespuštěný**, plán je `full-panel-prepared/plan.json`, SHA:
`a13dcc6e5b89acf5c07f2a8c6f5c75cfa7580ad8ae04c523b2dae28584dc9570`.

Z čerstvého inventáře připíná deset instalovaných artefaktů: Devstral Small 2, Gemma4 26b, Ornith 1.5 9b, Phi4 14b, Qwen3 30b A3b, Qwen3 Coder, Qwen3.5 27b, Qwen3.6 27b, Qwen3.8 a Qwen3 14b. Konkrétní tagy, SHA a generování jsou v plánu.

Rozsah: **20 CS/EN dvojic, 3 opakování, 1 200 rozhovorů / 3 480 volání**, maximálně 7 127 040 výstupních tokenů, první okno nejvýše 24 hodin. Není to provozní holdout.

Lineární přepočet pilotu vychází na **6,84 hodiny**, ale není změřenou ETA plného panelu: chybí osm modelů a čtrnáct skupin scénářů, jiné délky odpovědí a amortizace načítání. Zůstává proto 24hodinová stopka s checkpointem; další okno nesmí automaticky zvýšit celkový počet volání/tokenů. Prostý součet všech 300sekundových timeoutů by byl 290 hodin, což není schválená délka běhu.

Před plným sběrem zbývá posoudit použitelnost dialogů a rubrik na těchto skutečných odpovědích. Úprava promptu znamená nový plán a nový sběr; změna samotné rubriky musí být verzovaná a nepřepisuje staré známky. Pilot není důkaz, že sada umí seřadit kandidáty.

```bash
# Připravený příkaz pro navazující etapu po posouzení pilotu:
OLLAMA_MODELS=/mnt/vi7000/ollama/models \
INTENTSMITH_HUNT_STATE_DIR=/mnt/vi7000/intentsmith/evidence/hunt-chat-pilot-20260923/full-provider-state \
node scripts/run-model-hunt-provider.js --collection-stage --run \
  --out=/mnt/vi7000/intentsmith/evidence/hunt-chat-pilot-20260923/full-panel-prepared \
  --expected-plan=a13dcc6e5b89acf5c07f2a8c6f5c75cfa7580ad8ae04c523b2dae28584dc9570 \
  --window=full-01 --hours=24 --calls=3480 --tokens=7127040 \
  --report=/mnt/vi7000/intentsmith/evidence/hunt-chat-pilot-20260923/full-01-summary.json
```

Alternativa při nalezení vady scénáře: nejprve opravit a zopakovat pouze dotčené zadání jako novou verzi pilotu. Ostatní odpovědi uchovat jako původní data, nikoli je beze stopy přemíchat do nové sady.

Nezávislá přejímka hodnotitele a extraktoru významu, CODE v2 modelový sběr a nové oddělené provozní ověření zůstávají otevřené. **Tohle je dokončený CHAT sběr k posouzení, nikoli přijetí autonomního huntu nebo konečné pořadí modelů.**
