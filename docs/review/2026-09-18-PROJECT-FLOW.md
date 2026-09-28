# Projektový flow: nový projekt a import — 18. září 2026

**IMPLEMENTED / REVIEW_PENDING / PRODUCTION_SANDBOX_BLOCKED.**
Nasazený runtime a úplný gate: `5e46fca704098d9269bf6d00275d6c54be33e026`.
Vstup práce: `2f150ce7f3f183f9e14c3e2522ce150e1fe1c7a1`; integrovaný předchozí
runtime druhého workera `9298ef46e776e59cee01dc5e4354ae1b0d552c4e` je předek
kandidáta. Primární review delta vůči němu: `9298ef46..5e46fca7`.
Následný installer/profile/diagnostic/doc follow-up je součástí stejné větve;
nemění nasazené `src/` ani Studio. Nejde o release, přijetí M2/M5/M6 ani podpis
Gate 0. [Strojový souhrn a hashy](../execution/runs/project-flow-20260918.json).

## Co se změnilo

Nový projekt dostane výhradně nově vytvořený adresář, Git baseline, pravidla,
Node scaffold a poctivě červený výchozí test. Kolize neotevře cizí adresář jako
nový projekt. Průvodce nehlásí úspěch při 409/500 či neplatné odpovědi.
Projektový chat používá současný cíl, historii a omezené skutečné ukázky souborů,
navrhuje priority a otázky a může nabídnout editovatelný další krok.
„A jak?“ již nemusí spadnout do obecného rozcestníku. Legacy lifecycle zůstává
uzavřený. Samostatné generování, přesný diff, schválení, test a rollback zůstávají
v kanonickém M2. M1 WebSocket nyní skutečně doručuje proposal metadata do Studia;
HTTP úspěch sám tuto cestu dříve neprokazoval.

Existující projekt znamená repozitář vytvořený **mimo IntentSmith**. Import
provádí pouze omezenou statickou inspekci; nic nespouští, nepřepisuje a nezakládá
Git. Úvod se ptá na cíl; chat rozlišuje silné stránky, vady a nejasnosti. Nový
weather/news widget by byl další samostatný nový projekt. Import má volbu ruční
cesty; otevření uložené projektové karty čistí cizí konverzaci/agenta/návrh,
kontroluje HTTP výsledek a zahazuje opožděné odpovědi předchozího otevření.

Plánovač i CODE respektují schválené kontextové okno; profil se nezvyšuje.
D1 používá strukturovaný výstup, aktuální kalendářní kontext a zmenšuje vybrané
ukázky/history při velkých diagnostikách. Aktuální požadavek se netruncuje.
Počet ukázek vybraných pro model je oddělený od počtu načtených inspekcí.
Nejde o porozumění všem souborům rozsáhlého projektu ani o trénování vah.

Testovací stderr/stdout má omezený náhled a plné digesty. Plánovač může se
zapnutým `saveContext` číst kanonický výsledek a digestem ověřený vadný návrh
jen pro stejný projekt, konverzaci a actor. Vrácený návrh je označený jako
neaktuální. Paměť se nepřenáší do jiného projektu; při vypnutí se audit do
modelového kontextu nepřidává. Provozní audit M2 zůstává uložený.

## Co bylo skutečně provedeno

- Úplný čistý `offline,database` gate na `5e46fca7`: **358 PASS / 1 FAIL**,
  359 programů, verdict **FAIL**. Jediný FAIL je `nightly-orchestrator-self-test`
  (`registry hash differs from the reviewed Gate 0 policy`). Pečeť nezměněna.
  Všech 359 logů ověřeno proti hashům reportu.
- Nová projektová sada **17/17**, Studio surface **39/39**, lifecycle application
  service **53/53**; poslední sada nově ověřuje WebAssembly pod skutečným limitem.
  Dřívější izolovaný skutečný HTTP program **75/75** (`http-owned/program.log`)
  je samostatný důkaz před posledními UI/profile úpravami, nikoli celý finální journey.
- Produkční Studio build PASS; bundle SHA-256
  `5ff6c336f9b51cc29d8cba8010445d1121a01342e55e530d38b21159a6ba9a79`.
  Module graph **1376 hran, 3 cykly / 28 členů**; explicitní provenance zachovaná.
- Skutečný Electron v privátním Xvfb, backend, DB, Ollama, M1 WS a ovládací prvky:
  vytvoření nového projektu, D1 návrh, CODE generování, explicitní schválení,
  neúspěšný test, rollback, oprava přes další chat a zrušení dalšího vadného návrhu.
  Některé starší pokusy ručně vyklízely vlastní model; pozdější D1↔CODE přechod
  proběhl bez ručního unloadu. GPU bindingy ani coworker měření se neměnily.
- Samostatný cizí Python fixture byl načten přes skutečné HTTP; následný chat ve
  Studiu správně popsal CSV reading-list, dělení nulou a chybějící validaci a
  zeptal se na záměr. Model v této zkoušce nic nenavrhl k zápisu. Následný import
  přes nově sestavený skutečný GUI formulář též prošel. Původní soubory jsou
  bajtově totožné, žádné další soubory nevznikly. Není to audit velkého cizího repo.

## Fan checker: výsledek a meze modelu

Použité role odpovídaly živému bindingu: D1 `qwen3.5:27b`
(`7653528ba5cba4dd8e19da24aaddc7f4d0b5ecd93571c0825dfd4137958ec06e`), CODE `qwen3.8:latest` (`22130167c4c20e20c7b71454612966ca8e8171e9b3cc8ab6ce8aa6cbfec79643`). Model opakovaně
minul skutečnou strukturu sysfs, Buffer/string nebo testovací assertions.
Jedno ruční vyplnění formuláře v prvním probe nepoužilo nativní React setter;
nezměněné zadání proto nelze interpretovat jako model ignorující tuto editaci.
Pozdější ověřené editace přesto nezajistily správnou implementaci. **Úspěšný
samostatný modelový build celého widgetu není prokázaný.**

Dokončený kód widgetu napsal a revidoval Codex, nikoli lokální model. Pět souborů
prošlo přes skutečné Studio approval, 8 funkčních kontrol a Git commit v izolovaném
projektu. Po restartu obou procesů je stejný kanonický úspěšný výsledek dostupný
(`lifecycle:98d1382d-be55-4e80-99a9-dd7470b755c6`). Testy pokrývají vnořené
hwmon cesty, nulové/neplatné RPM, výpadky, hodinovou historii, limity a HTTP hranici.
Skutečné okno na hostu ukázalo chybějící senzory. Samostatné jasně označené
syntetické hodnoty prokázaly graf, mezery a 0 RPM; nejde o měření tohoto PC.
Historie je pouze v paměti. Žádné změny otáček, ovladačů nebo externí požadavky.

Původní uživatelův `fan-checker` byl zálohován a doplněn o chybějící scaffold,
bez změny původních čtyř souborů (`40e596f7`). Produkční M2 pokus na systémové
službě pak **selhal a všech šest změn úspěšně vrátil** kvůli AppArmor (níže).
Ověřený widget nakonec nainstaloval Codex běžnou změnou projektu; commit
`7fbacd8aabc1cfde36c1636bf687b4b818c6f00d`, čistý strom, 8/8 testů.
Tento poslední zápis není úspěšný produkční M2 journey. Návod je v jeho README.

## Produkční blok, který izolované testy nenašly

První sandboxová zkouška widgetu odhalila Node WebAssembly rezervaci virtuální
paměti: 8 assertions PASS, ale závěr procesu FAIL. Výchozí navrhovaný test nyní
používá `--disable-wasm-trap-handler`; limit 4 GiB zůstává. Důvod odpovídá
[dokumentaci Node 22](https://nodejs.org/download/release/v22.18.0/docs/api/cli.html#--disable-wasm-trap-handler).

Na skutečné systémové službě se navíc bwrap nedostane přes vytvoření loopbacku:
`Failed RTM_NEWADDR: Operation not permitted`. Stejný canonical provider je
**PASS pod AppArmor `vscode (unconfined)` a BLOCKED pod systemd `unconfined`**.
Kontrolovaný host má `apparmor_restrict_unprivileged_userns=1`; pro bwrap chybí
profil. Proto se ani zelené offline testy, ani privátní Studio nesčítají do
úspěšného produkčního flow. [Připravený profil a skutečný systemd probe](../DESKTOP.md#sandbox-projektových-testů-ubuntukubuntu).
Profil parsován, není nahraný: `sudo -n` požaduje heslo správce. Neobcházeli jsme
to vypnutím AppArmor, sdílením sítě ani změnou izolace.

## Nasazení, zachované neúspěchy a další review

Backend/launcher/hunt jsou na čistém detached `5e46fca7`, služby a timer aktivní.
Instalátor vytvořil konzistentní backup; projects/conversations/messages/user_settings
mají před a po přepnutí stejné počty i hash všech řádků, DB quick_check OK, FK 0.
Závislosti byly kopírované ze shodných manifestů; nejde o fresh npm/yarn install.
Cizí dirty main, coworker GPU hunt a běžící 24h soak nejsou převzaté ani zastavené.

Zachované evidence zahrnují první špatně konfigurovaný paralelní gate
304 PASS / 45 FAIL / 10 BLOCKED, následující sériové 358/1 běhy, chybné modelové
výstupy, předchozí HTTP harness chyby, runtime rollbacky, odmítnuté README mimo
policy roots i chybně zadaný digest v instalačním probe. Odmítnuté approval nic
nespustilo. Všechny další pokusy jsou samostatně označené, nic není přepsané na PASS.

Nezávislé review: nové vytvoření/import (žádné import-time zápisy), M1 WS metadata,
scoping diagnostik/paměti, context budget, nový testovací příkaz, změny UI relací.
Před prohlášením provozního dokončení zbývá nahrát profil správcem a zopakovat
systemd probe i skutečný Studio M2 krok. Nadále chybí důkaz spolehlivého samostatného
modelového dokončení widgetu, acceptance/release pečetě a finální soak. Sekundární
weather/news widget nebyl realizován; prioritu dostaly skutečné bloky hlavního flow.

Publikace: větev `work/project-flow-20260918` je na GitHubu. Pokus vytvořit
draft PR konektorem skončil HTTP 403 `Resource not accessible by integration`;
PR tedy nevzniklo. Review lze provést přímo nad větví a výše uvedenou deltou.
M5 kontrola na `c8d5d7ab`: `PASS_CURRENT_TREE_HISTORY_REMEDIATION_REQUIRED`;
historický podpis tím nevzniká. Vlastní testovací servery, Xvfb, Studio a GPU
lease byly uklizené; produkční služba/timer a cizí soak zůstaly běžet.
