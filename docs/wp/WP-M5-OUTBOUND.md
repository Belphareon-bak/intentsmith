# WP-M5-OUTBOUND — process-wide network policy and audit

**Typ:** M5 production hardening · **Stav:** `IMPLEMENTATION_GREEN / REVIEW_PENDING`

**Product revision:** `07b8155c1c7135e7c8bbc5e5be34bbeb7849c5ab`

**Module-baseline revision:** `e8892d7acecf229639a169e70cad094a091b55a7`

## Uživatelský výsledek

Produkční proces instaluje jediný outbound guard před inicializací optional a
background služeb. Loopback zůstává lokální. Každý externí `fetch` bez
deklarované plochy a scope je před transportem odmítnut a rozhodnutí musí být
nejdřív zapsané do append-only SQLite auditu.

Operátorské rozhodnutí z 2026-08-19 o default-on model discovery zůstává
zachované. Tato plocha je nyní výslovně `model-discovery` /
`model.metadata.read`, dovoluje pouze GET/HEAD na přesné HTTPS originy
`ollama.com`, `whatllm.org` a `huggingface.co` a automatické redirecty odmítá.
Flag `C3_ENABLE_ONLINE_DISCOVERY=false` ji dál celý vypne.

## Autorita a invariants

- migrace 089 instaluje fingerprintovanou `m5_outbound_audit_events` s
  append-only UPDATE/DELETE triggery;
- decision event musí být durable před prvním externím transportem;
- audit ukládá origin, metodu, scope, surface a hash celé URL, nikdy URL path,
  query, body, header ani credential hodnotu;
- chybějící audit authority znamená deny, ne unaudited fallback;
- přesný scope bez zapnuté plochy, špatný origin, metoda nebo redirect končí
  typovaným deny/failure;
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
[`m5-outbound-20260826.md`](../execution/runs/m5-outbound-20260826.md).
Tento dokument není nezávislé review ani M5 acceptance.
