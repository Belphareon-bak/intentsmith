# Production closeout — 17. 9. 2026

**Stav: INSTALLED / REVIEW_REQUIRED / RELEASE_NOT_ACCEPTED.**
Produktový kandidát a instalace: `c2989a3e1a36fe61c080aa57e4ce33b41f4d4735`.
Vstup `9b031278` + nasazený Studio design `023af4dd`, sloučeno v `adcccef8`.
Větev `work/production-closeout-20260917`; rozsah nového review
`9b031278..c2989a3e`. Pozdější evidence commit mění pouze dokumentaci.
[WP](../wp/WP-PRODUCTION-CLOSEOUT-20260917.md).

## Co se opravilo

1. Účetní OCR už neodvozuje cestu z nesouvisejícího PDF interpreteru.
   Audit předává explicitní `UCETNI_RUNTIME_DIR` jen deklarujícím testům,
   po kontrole adresáře, interpreteru a obou jazykových souborů. Chybějící
   prostředí zůstane BLOCKED. M6 předává oba nezávislé runtime a zahrnuje
   přítomné toolchainy; celé účetní workflow nyní projde ve společném profilu.
2. Specialist-loader měří retained heap s GC před i po 200 cyklech.
   Limit 10 MiB, počet cyklů a funkční assertions zůstávají. Přímá invokace
   bez `--expose-gc` spustí stejný program s tímto přepínačem; nic nepřeskakuje.
3. M2 používá pro oba skutečné Unix sockety krátkou privátní fixture.
   Před sandboxem ověří přesnou délku a existenci socketu, takže dlouhá
   instalační cesta nemůže tiše zkrátit bind ani předstírat izolaci neexistujícího
   socketu. Odmítnutí spojení a nulový počet host efektů zůstávají.
4. M5 scanner odhalil dva sledované PEM soubory z webových testů. Šlo o
   deklarované testovací identity, nikoli zjištěnou produkční credential.
   Nově vzniká krátkodobý klíč/certifikát za běhu přes deklarovaný OpenSSL,
   ve skutečně izolovaném privátním adresáři, který se ihned odstraní.
   Scanner nemá novou výjimku. Důvěra, hostname validation i záporný TLS
   handshake se stále testují přes skutečný Node HTTPS socket.

Produktové `src/**` a Studio jsou proti nasazenému `023af4dd` shodné kromě
dvou toolchainů v M6 execution planu. Předchozí opravy soukromí, hodin,
agentů, specialistů, panelů a motivů jsou zachované.

## Výsledky a meze

| Důkaz | Výsledek |
|---|---|
| Celý offline/database profil na `c2989a3e` | **358 PASS / 1 FAIL / 0 BLOCKED / 0 TIMEOUT**, 359 programů. Celkový verdict je **FAIL**. Jediný non-PASS: `nightly-orchestrator-self-test`, zapečetěný hash registry podle CONTRACT §8. Pečeť se neměnila. |
| HTTP na stejném kandidátu, privátní backend/DB | **6 programů / 134 kontrol PASS**: web 7, přílohy 38, lifecycle 75, native agent 6, expertiza 3, code-review specialista 5. Bez Ollamy; čtyři modelové server programy nebyly spuštěny. Nejde o celý M6 server profile. |
| M5 scanner aktuálního stromu | **0 nálezů**, `PASS_CURRENT_TREE_HISTORY_RETAINED_AS_DECLARED`; 13/13 známých historických objektů zůstává dosažitelných. Nejde o podepsanou history disposition. |
| Registry / module boundary | 523 programů; 1 358 hran, 3 cykly / 28 členů, bez nové hrany. Registry fingerprint `f0358f4af7bc6b702b2c8b08f10c472364c9cf0a699bfe3f76c7189cb1c777f1`. |
| Čistý detached klon | Produkční Studio build a consumer guard PASS; 7 souborů release artefaktu validováno. Závislosti převzaté z ověřené instalace, není to nové `npm ci` ani download proof. |
| Instalace | Backend, Studio launcher a hunt používají `c2989a3e` a společnou DB. Skutečné otevření ikonou, Nastavení a reload PASS; panely 240/416 px, vstup chatu dostupný. Finální běžné Studio bez debug portu. |
| Zachování dat | `quick_check=ok`, 0 FK chyb; stejné hashe 503 evaluací, 21 hunt attempts, 7 bindings, 28 memory, 10 project-memory řádků a user settings. Není to hash celé DB. |
| API autentizace | Nastavení bez capability 401, se skutečnou lokální capability 200. |

Build SHA-256: `10800af83ec0b6b8bd83720e8c3e9f7c9e29da618dffcc9808916121990a20a3`.
Raw důkazy a všechny negativní běhy zůstávají v
`.intentsmith-artifacts/production-closeout-20260917/`; piny a checksumy
obsahuje [strojový záznam](../execution/runs/production-closeout-20260917.json).

## Běžící měření a překážky skutečného releasu

- Předběžný plný 5min throughput na `779f4f5a` prošel: sustained
  39 557,594 req/s, p95 36 ms, 0 chyb, peak RSS 217,715 MiB. Měří pouze
  veřejný health endpoint produkčního serveru; není to výkon chatu/modelu
  ani prokázané absolutní maximum (`ceilingReached=true`, `saturationObserved=false`).
- Na přesném `c2989a3e` nezkrácený 5min throughput **PASS**: sustained
  38 457,532 req/s, p95 37 ms, p99 48 ms, 0 chyb, peak RSS 217,691 MiB.
  Stejná omezení měřené plochy platí i zde; maximum nebylo prokázané.
  Vlastní supervisor PID 870665 automaticky navázal skutečným 24h soakem
  **2026-09-17 16:29:38 UTC / 18:29:38 CEST**, očekávané dokončení
  18. 9. po 18:29 CEST. Každý program má vlastní produkční proces,
  privátní DB a ověřený Linux namespace obsahující pouze loopback.
  Stav a logy jsou pod instalačním snapshotem v
  `.intentsmith-artifacts/production-closeout-20260917/performance-job-local.json`
  a `performance/`. Rozběhnutý test není PASS; restart hostu tento běh přeruší.
- GPU evidence je **BLOCKED**: načtený kernel module 595.84, instalovaný
  modul 595.91.07, NVML hlásí driver/library mismatch. Hunt 18:11 CEST selhal
  ze stejné příčiny. Žádné nové inference, změny bindings ani model cleanup
  se z tohoto výsledku nevydávají za hotové. Je nutné sladit běžící ovladač
  s instalovaným, typicky restartem hostu; reload aktivního grafického driveru
  by přerušil desktop.
- Sázkař zůstává **PROVIDER_BLOCKED**: veřejný zdroj historie přes HTTPS
  přesměrovává na `http://127.0.0.1/...`. Přesměrování se nenásleduje.
- M5: [již zaznamenané operátorovo nepoužití přístupů](../execution/runs/m5/operator-history-facts-20260911.md)
  se nepřekládá na povinnost rotovat neexistující externí credentials.
  Osm category resolutions, odpovídající N/A evidence, podpisy a skutečná
  oddělená custody však nejsou nahrazené tímto testem. Chybí fyzická záloha,
  požadované podpisy a nezávislé přijetí; žádný privátní signer nebyl otevřen.
- Aktuální M6 validator vrací **BLOCKED / M6_RELEASE_EVIDENCE_NOT_FOUND**.
  Zbývá kompletní evidence index na jednom kandidátu, GPU/model a širší CODE
  kvalita, nezávislé review a operátorská akceptace. Tento packet není vydání 1.0.

## Zachované neúspěchy

`964b61ad`: 357 PASS / 2 FAIL (LOC census + release seal), 0 BLOCKED.
`779f4f5a`: 357 PASS / 2 FAIL (chybějící statický bootstrap nově generujícího
TLS testu + release seal), 0 BLOCKED. Opravy census a bootstrapu jsou explicitní;
finální celý profil je `c2989a3e`, původní logy se nemažou.

Tři první ruční M3 invokace měly chybné přípony souborů; nové skutečné běhy
všech šesti programů prošly na konečném kandidátu. První fresh-clone probe
odmítl adresář vytvořený s 0755; opraveno na 0700 bez změny guardu.
První background pokus pod uživatelskou systemd službou odmítl `uid_map`;
oba FAIL zůstávají. Supervisor je nově spuštěn ze stejného povoleného
pracovního prostředí jako úspěšný foreground test. Kernel/AppArmor policy
se nemění a požadovaná síťová izolace se nevypíná.
