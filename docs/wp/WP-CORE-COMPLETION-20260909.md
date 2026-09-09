# WP-CORE-COMPLETION-20260909 — uzavření technické integrace

Autorita: operátor v tomto běhu přijal postup dokončení core 1.0 před samostatným
M7 releasem a výslovně zadal „souhlasim, pust se do toho“. Tento WP vymezuje
provedení přijatého zadání; nezakládá další produktové požadavky.

## Výsledek a rozsah

Jeden integrační kandidát s uzavřeným review dosavadního mobilního merge,
potřebné M7 follow-up delty a konkrétních nálezů blokujících důvěryhodné
ověření. Zachovat M5/M6/M7 acceptance hranice a odložené živé modelové běhy.

- Vstup: `2f11e91117cfeb08c926cb2d94e4888c06f5426c`, měřený merge `f7f78d5a`.
- Převzatá delta: `f812259d..0b0a4669902dfed2a3573f3090c32644711e07ca`;
  produktové commity `f3a8753e` a `9ae1a516`, samostatné nezávislé review.
- Jediný writer: Codex integrátor v existujícím
  `/home/belphareon/worktrees/is-mobile-completion-20260908`,
  větev `work/mobile-completion-20260908`. Revieweři jsou read-only.

Vlastněné cesty: soubory přesné slučované delty; související
`scripts/mobile-release-artifact-binding.mjs`, `src/security/privacy-scan.js`
a existující focused testy; tento WP, nové run/review důkazy a aktuální stav
v `ROADMAP.md` / `SYSTEM-MAP.md`. Connector zůstává existující M7 runtime
configuration a Android artifact binding; bez nového wire kontraktu.

## Demonstrace a ověření

- Přesný deklarovaný public credential filename nezpůsobuje secret finding;
  skutečné credential literály ve stejném souboru a distribuovaných kořenech
  zůstávají FAIL bez vypsání hodnot.
- Renderer odmítá newline/specifier/zone injection před výstupem; běžný VPN
  unit projde `systemd-analyze --user verify` bez instalace nebo aktivace.
- Android source manifest váže skutečně zabalený M7 index a odhalí jeho změnu.
- Registry a inventář odrážejí sjednocený strom; sealed Gate 0 drift zůstává
  pravdivě pojmenovaným vývojovým FAIL, bez nového release ratchetu.
- Na připnutém čistém commitu focused boundary testy, mobile/browser a
  fresh-clone offline/database profil; podle změněných Android vstupů znovu
  explicitně throwaway build a kontrola skutečných APK/AAB bytes.

Příkazy: `node --test tests/m5-privacy-remediation.test.js`,
`node tests/m7-vpn-runtime-config.test.js`,
`node tests/mobile-android-release.test.js`, `npm run test:mobile`,
`npm run test:mobile:browser`, `npm run test:registry`,
`npm run test:deterministic`, `node scripts/scan-m5-privacy.js`,
`git diff --check`. Full profil používá pouze již deklarované lokální
toolchain autority a samostatný artifact root; žádný živý model/GPU.

## Hranice a stop condition

Bez cizích změn, přepisu historie, produkčních klíčů, rotací externích účtů,
aktivace služeb/VPN/firewallu, telefonu, podpisových receipts nebo publikace.
Nález měnící schválené chování, L0 nebo potřebující dosud neudělenou externí
autoritu zastaví jen závislou práci. Stav a výsledek jsou v existující roadmapě,
mapě systému a run/review evidenci; tento WP se nepoužívá jako další board.
