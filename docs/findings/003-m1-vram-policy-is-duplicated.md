# 003 — VRAM policy má více nesjednocených vlastníků

- **vlastník:** budoucí WP pro GPU/effect authority po M1
- **nalezeno v:** WP-M1-MODEL, call-graph kontrola před GPU během
- **stav:** PENDING-OWNER

## Evidence

`src/llm/model-ctx.js:initModelNumCtx()` odhaduje velikost modelu z jeho jména a
počítá kontext při startupu. `src/media/vram-manager.js:computeNumCtx()` má
samostatný odhad vah/KV a pozoruje VRAM znovu; stejný modul navíc umí modely
uvolnit a znovu načíst. Nový `fitsVram()` je pouze request-level klasifikátor
pro modelový connector v1. Tyto tři cesty zatím nesdílejí autoritativní model
footprint ani jednu GPU authority.

## Dopad

Stejný model může dostat od startupu, media koordinátoru a request preflightu
jiný závěr. Request boundary proto zatím smí tvrdit jen to, co prokáže
explicitním trusted footprintem; nesmí převzít name-only odhad jako fyzický
`NONFIT`. GPU běh musí uvést přesný zdroj metadat a nesmí automaticky volat
unload/reload cestu.

## Minimální reprodukce

```bash
rg -n "estimateWeights|kvMbPer1k|modelAlreadyLoaded|computeNumCtx|fitsVram" \
  src/llm/model-ctx.js src/media/vram-manager.js
```

## Co se v tomto WP neopravuje

`src/media/**` není povolená cesta WP-M1-MODEL a změna unload/reload authority
by překročila L0. M1 dokončí pravdivý request contract; sjednocení footprintu,
multi-GPU placementu a GPU effect authority potřebuje vlastní connector a
negativní testy.
