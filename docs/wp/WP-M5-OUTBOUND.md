# WP-M5-OUTBOUND — process-wide network policy and audit

**Typ:** M5 production hardening · **Stav:** `IMPLEMENTATION_GREEN / RE_REVIEW_REQUIRED`

**Product revision:** `122b5df5303e08a38cdd62a35e6577b118795c30`

**Module-baseline revision:** `d3829643545fde1d6b6f71db9f1d88b86bd54b91`

## Uživatelský výsledek

Produkční proces instaluje jediný outbound guard před inicializací optional a
background služeb. Loopback zůstává lokální. Každý externí `fetch` bez
deklarované plochy a scope je před transportem odmítnut a rozhodnutí musí být
nejdřív zapsané do append-only SQLite auditu.

Operátorské rozhodnutí z 2026-08-19 o default-on model discovery zůstává
zachované. Privátní capability není exportovaná; jediný scoped vstup je
`modelDiscoveryFetch()`. Ten dovoluje pouze GET/HEAD bez body a s přesnými
caller headers na `ollama.com/library[/<family>]`, exact Hugging Face model
search query a root `whatllm.org`. Flag `C3_ENABLE_ONLINE_DISCOVERY=false` ji
dál celý vypne.

## Autorita a invariants

- migrace 089 instaluje fingerprintovanou `m5_outbound_audit_events` s
  append-only UPDATE/DELETE triggery;
- decision event musí být durable před prvním externím transportem;
- audit ukládá origin, metodu, scope, surface a hash celé URL, nikdy URL path,
  query, body, header ani credential hodnotu;
- chybějící audit authority znamená deny, ne unaudited fallback;
- opsaný `{ surface, scope }` objekt nemá object-identity capability a končí
  před transportem;
- přesná capability bez zapnuté plochy nebo s cizím path, query, header, body či
  metodou končí typovaným deny/failure;
- každý transport včetně loopbacku používá `redirect: manual`; každá
  `Location` dostane nové exact rozhodnutí a teprve allow smí spustit další
  transport;
- raw produkční `fetch` z agents, notifications, marketplace, tools, media,
  updateru i uživatelské URL cesty prochází globální guard a je unscoped, dokud
  conditional-surface blok výslovně nezavede užší autoritu;
- web search/scrape se nepřekládá falešně: přijatý M2 adapter je dál odmítá,
  protože query neidentifikuje přesné provider requesty a redirecty.

Standalone `model-upgrade-hunt` aplikuje migrace, konfiguruje stejnou policy a
teprve poté spouští discovery; neobchází tak autoritu hlavního serveru.

## Přiznané limity

Guard vlastní Node `fetch`, což je jediný produkční outbound transport nalezený
v přijatém censu. Nejde o host firewall ani síťový namespace pro cizí procesy.
Procesové efekty mají vlastní M2/PROCESS hranici. Dlouhý 5min/24h outbound
horizont ještě nebyl spuštěn a conditional plochy zůstávají fail-closed do
svého disposition bloku.

Focused důkaz je v
[`m5-auth-outbound-remote-remediation-20260826.md`](../execution/runs/m5-auth-outbound-remote-remediation-20260826.md);
původní report zůstává v
[`m5-outbound-20260826.md`](../execution/runs/m5-outbound-20260826.md). Tento
dokument není nezávislý re-review ani M5 acceptance.
