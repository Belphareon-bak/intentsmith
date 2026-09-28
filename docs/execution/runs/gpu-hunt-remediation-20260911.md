# GPU hunt — oprava discovery a reprodukovatelnosti, 2026-09-11

Stav: **IMPLEMENTATION_VERIFIED / REVIEW_PENDING / LIVE_HUNT_NOT_RUN**.
Zadání: operátor požádal prověřit a odladit GPU hunt a následně výslovně
předal soubory GPU huntu v produktové větvi tomuto běhu.

Produktová změna: `c09f7d76e90eb6ea3637626f843d41c9b3fd4f05`.
Finální ověřený kandidát včetně census:
`d53548aa06ab194b83bccbf4117a935a433a0ca8`.
Následný evidence commit nemění JavaScript ani build recipe.

## Aktuální nález

- Systémová Ollama už běží na `127.0.0.1:11434` jako
  `0.32.14-intentsmith.1`; SHA instalované binárky je
  `72580ab98c5c82afe9cf73e5b7400b1d3cd94ec0777f961d1aefab878146878a`.
  [Aktivace a dřívější omezená kvalifikace](m6/provider-activation-20260909.md)
  proběhly 9. září. Tento běh neprovedl další modelovou inference.
- Produktová větev obsahuje M6 model integration candidate `73385eeb`.
  To není nové nezávislé review ani M6 acceptance.
- Skutečný shortlist prošel 240 rodin, ale všechny tagové endpointy
  `/library/<family>/tags` odmítala vlastní outbound policy jako
  `OUTBOUND_TARGET_CONTRACT_DENIED`. Výsledkem bylo 0 vzdálených kandidátů.
- Opravený průchod našel 171 vzdálených kandidátů a 9 lokálních alternativ.
  Prvních deset vzdálených kandidátů má konzervativní součet 181,6 GiB;
  při inventuře bylo volných přibližně 134 GiB. Priorita není quality score.
- Read-only report nad konzistentní kopií živé DB potvrdil 55 COMPLETE,
  0 applicable MISSING a 8 N/A pro devět instalovaných artefaktů. Ze 100
  rozhodnutí má 47 důvod `INSUFFICIENT_EVIDENCE`.
- `LEGACY_UNVERIFIED` u 40 COMPLETE označuje časový interval. Další hunt
  je automaticky nepřeměří: použije cache a writer zachovává unikátní
  COMPLETE pro digest, roli a kontrakt.
- VISION `qwen3.8:latest` má 0,95556 proti 0,53333 u `llava-llama3:8b`
  a uloženou portfolio způsobilost. CLI však záměrně nepozoruje serverový
  runtime, proto stále vrací `UNVERIFIED_RUNTIME` a rozhodnutí není akční.

## Provedená oprava

Povolena pouze přesná auditovaná cesta ke katalogovým tagům při zachování
přepínače discovery, originu, metod, redirect kontroly a zákazu request body, query
a nepovolených hlaviček. Ruční i plánovaný hunt kontrolují 40 GiB rezervu;
každý pull má také novou kontrolu bezprostředně před spuštěním. Explicitní
`--only` dohledá velikost přesného tagu, neznámá velikost pull blokuje.
Neplatný `--limit` selže před otevřením DB a použitím sítě/GPU.

Do repa je přenesen originální provider patch `0cb3844557c2cbf0beac555da0147279eebd9488`
a [build recipe](../../../scripts/build-ollama-evaluation-provider.sh).
Patch obnoví stejný commit nad pinnutým upstream tagem. MLX obsahuje C makra
`__DATE__`/`__TIME__`; samotný tag a Go verze proto původně nestačily.
Recept připíná `SOURCE_DATE_EPOCH` a používá čerstvou Go cache.
Dva oddělené buildy s Go 1.26.7 a GCC 13.3.0 daly stejné bajty:
`bdd8ca1320a1332b6977a3d7bc4b26d370e4e36c10188b6983998632568b1e20`.
Nová binárka není vydávána za historickou `72580ab9…` a není instalovaná.
Whitespace atribut platí jen pro uložený unified patch, jehož kontextové
řádky mají povinný prefix mezery; kontroly produktových zdrojů se nemění.

## Ověření

- Regrese outbound policy na původním kódu FAIL; opravená sada 11/11 PASS
  včetně nepovolených cest, query, fragmentu, POST, body, hlavičky a opt-outu.
- Model sweep 44/44, model upgrade 61/61, candidate trial s dostupnou Git
  historií 34/34 a outbound opt-in 7/7 PASS; registry valid.
- Skutečné CLI s injektovaným transportem: původní ruční běh zahájil pull
  při malé rezervě. Finální kód blokuje malou rezervu, neznámou velikost
  i pokles volného místa po sestavení fronty; dostatečná rezerva dojde
  k zachycenému pullu. Žádný model se tím nestáhl ani nespustil.
- Sedm neplatných limitů odmítnuto; explicitní shortlist obsahuje právě
  požadovaný tag a jeho velikost.
- Provider Go testy `TestChatHandlerChatTemplateRoute` a
  `TestGenerateChat` včetně streaming/non-streaming případů PASS
  v bwrap bez sítě a bez host GPU zařízení.
- Čistý finální klon: **352 PASS / 0 FAIL / 0 TIMEOUT / 0 BLOCKED /
  0 SKIPPED**, exit 0. Všech 352 log hashů, source identit a unikátních ID
  bylo znovu ověřeno. Report SHA-256:
  `a789143b8c6a6fc69b5c2ed3e1016e44bb17c9011301cafd9e99d387747d45cd`.

Raw evidence:

```text
/home/belphareon/Projects/coworker/intentsmith-gpu-hunt-20260911-w9zc1p6l/
/home/belphareon/is-hunt11/.intentsmith-artifacts/test-runs/gpu-hunt-d53548aa/report.json
```

Původní neúspěchy jsou zachované. První full pokus odmítl untracked dependency
symlink; další měl 277/277 selhání na umístění TMPDIR mimo požadovaný
`.intentsmith-artifacts`. Následný běh měl 347 PASS / 5 FAIL: jeden
neaktualizovaný census z této změny byl opraven; tři testy selhaly i na
nezměněném rodiči při externím nebo dlouhém umístění sandboxu. Krátký klon
s artefakty uvnitř repo obnovil správné package/ignore prostředí a Unix
socket cesty. Heap kontrola specialist loaderu jednou naměřila 11,24 MiB
proti 10 MiB limitu; parent, focused i finální full běh prošly. Sady ani
jejich očekávání se kvůli těmto výsledkům neoslabovaly.

## Zbývá před plným provozem

Nezávislé review delty, runtime kvalifikace nově sestavené binárky,
malý sériový hunt přes pull až k append-only rozhodnutí a serverové
ověření binding authority. Rozlišitelnost R2/D2/D1/R1 a podporované opakované
měření stejného kontraktu jsou samostatné potřebné přírůstky. Historie se
kvůli obnovení časových údajů nemaže.

Timer zůstává disabled/inactive a stále míří na starší checkout
`/home/belphareon/Projects/intentsmith`; před budoucím zapnutím se musí
přesměrovat na ověřenou produktovou revizi. Bindingy se neměnily, upstream
patch nebyl publikován a M6 acceptance se tímto během neuzavírá.
