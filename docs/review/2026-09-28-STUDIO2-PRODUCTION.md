# IDE 2.0 — místní produkční instalace a Legacy

**Následná oprava startu:** operátor odkryl restartový dialog a pád na
uložených přílohách. Výchozí frontend je nyní `16318bf8`; backend tohoto
historického nasazení zůstává. [Oprava a nové důkazy](2026-09-28-STUDIO2-STARTUP-FIX.md).

Autorita: výslovné zadání operátora 28. 9. 2026: „vše otestuj a pak nové IDE
dej do produkčního stavu a staré jako legacy“. Rozsah:
[WP-STUDIO-2-PRODUCTION](../wp/WP-STUDIO-2-PRODUCTION-20260928.md).

## Instalovaný výsledek

**LOCAL_PRODUCTION_DEPLOYED / IMPLEMENTATION_VERIFIED / REVIEW_PENDING.**
IDE 2.0 je běžný desktopový vstup. Původní frontend je samostatně **IntentSmith
Legacy**; oba používají jeden spravovaný backend a původní databázi. Tento
záznam nepřijímá M5/M6 ani nevyhlašuje veřejný IntentSmith 1.0 release.

- Zdroj/backend/frontend: `c84b88cd0c0b76639823c82c022d2feab96dfc15`.
- Instalovaný čistý detached snapshot:
  `/mnt/vi7000/intentsmith/releases/c84b88cd0c0b76639823c82c022d2feab96dfc15`.
- AppImage SHA-256:
  `4f7907c023b8c1a908b86a56e5e74ff04d73c20f8fce50a75ddf8b4fba6b14a6`.
- Frontend bundle SHA-256:
  `73d3e8b1c8c779cd3b13696f5788a240463882b9bdc1af15ea8c9d3230e121c1`.
- Trvalý Node 24.21.0; Theia 1.76.0, React 19.3.0, Electron 42.11.3.
- DB: `/home/belphareon/Projects/intentsmith/data/c3.db`; projekty mají původní
  adresář. Přístupové prostředí, sandboxová volba, hunt hold a vazby modelů
  se zachovaly. Běžný spouštěč nemá CDP diagnostický port.
- Legacy frontend: původní snapshot `72247a4983abcb12d42f6da6cc5b27af8f2212fd`,
  původní Node 22 a původní profil. Nové UI má `~/.config/intentsmith-studio2`.

## Co se opravilo při ověřování

1. Desktopový spouštěč vybírá ověřený AppImage. Legacy má vlastní jméno,
   profil a skutečný původní frontend. Runtime není závislý na `/tmp`.
2. Instalátor ověřuje čistý snapshot, součet AppImage a systemd jednotky;
   před změnou vytvoří soukromý koherentní DB backup i migrační zkoušku.
   Chyba aktivace obnoví konfiguraci a službu bez přepsání nově zapsaných dat.
3. Živá zkouška restartu odhalila přepis `model_overrides.applied_at`.
   Stejná vazba nyní zachovává původní čas; nová verification generace se
   nadále audituje. Regrese přejde přes skutečnou hranici sekundy.
4. Původní profil obnovil nativní panel Problems pod novým UI. Veřejné Theia
   `collapsePanel` sbalí původní panely po obnově. Test otevře skutečný
   `problemsView:toggle`, obnoví uložené rozložení a kontroluje celou výšku UI.
5. Kompletní profil odhalil kolizi časových reqId dvou terminálů. Adaptér
   zaznamenává čas až po odeslání a po timeru znovu ověřuje hodiny. Regrese
   vynutí přechod hodin i předčasné probuzení; proti předchozímu kódu selže.
   Původní WS klient a M1 byte bridge zůstaly beze změny.

## Ověření

| Kontrola | Výsledek a přesný rozsah |
|---|---|
| Produkční build a AppImage | PASS; sestavený a kontrolovaný artefakt |
| Dokumentace / artifact-validation | 160/160 PASS; census zdroje/testů sjednocen |
| Prototyp a generovaná React vrstva | PASS; 1916 kontrol, fuzz, shoda generování |
| Finální offline/database profil | **385 PASS / 1 FAIL / 0 TIMEOUT / 0 BLOCKED** na `c84b88cd` |
| M1 v Electronu | PASS; skutečný sestavený renderer, controlled wire/provider, reconnect/cancel/error, 65s soak |
| M2 negativní cesta v Electronu | PASS; odmítnutý provider nic nezapíše, ponechá vstup a focus |
| Výhradní UI / uložený Problems | PASS; pět relací, ochrana konceptů, výměna sloupců, restart, celá výška, témata, prostředí, přílohy |
| Živý finální AppImage nad kopií původní DB | PASS na `c84b88cd`: skutečný chat, M2 návrh/preview/schválení/zápis, test nuly/záporných/desetinných vstupů, SCM stage/commit/větev a odmítnutý nepovolený push, Legacy |
| Instalované výchozí UI, Legacy a restart | PASS na `c84b88cd`; živá uložená odpověď, načtené původní katalogy, start i restart: y=0 / 1000 z 1000 px, původní Problems skrytý |
| Integrita a zachování původních dat | PASS; všechny původní konverzace/zprávy/evaluace a obsah projektů zachované; 7 nezměněných vazeb VERIFIED |

Jediný finální FAIL je `IS-T1-TESTS-NIGHTLY-ORCHESTRATOR-SELF-TEST`: nesoulad
aktuálního registru s přijatou Gate 0 pečetí. Nejde o zelenou release gate;
pečeť se v tomto úkolu nepřijímala ani nepřepisovala. Registrované profily
nejsou souhrnným tvrzením, že každý historický či providerový test v registru
byl spuštěn. Živé providerové integrace jsou doložené zvlášť.

Tři finální izolované Electron běhy mají každý nulové external/other-loopback/
unsupported network attempts a čisté ukončení vlastních procesů. Nad kopií
DB je skutečné schválení M2 oddělené od negativní providerové zkoušky.

Přímé porovnání původního backupu a produkce: konverzace **48 → 50**,
zprávy **2 → 6**, projekty **16 → 16**, modelové evaluace **1012 → 1012**.
Všechny původní konverzace, zprávy a evaluace zůstaly obsahově identické;
projekty mají identický obsah kromě běžného `last_active`, které se při
startu aktualizovalo u devíti projektů. Časy před/po jsou v měřicím packetu.
Dvě přidané konverzace jsou vlastní uložené produkční zkoušky chatu.
Všech sedm kompletních řádků `model_overrides` odpovídá původnímu backupu,
včetně `applied_at = 2026-09-26 05:58:01`. První příliš přísné porovnání
projektového `last_active` je ponechané jako FAIL; finální kontrola výslovně
porovnává obsah a vykazuje změnu aktivity.

## Použití a návrat

Zavřít dříve otevřené staré okno a v nabídce aplikací otevřít **IntentSmith
IDE 2.0**, případně:

```bash
gtk-launch intentsmith
```

Původní frontend nad stejnými daty:

```bash
gtk-launch intentsmith-legacy
```

Běžné spuštění přes desktopovou položku je také ověřené, bez CDP argumentů;
nové okno je ponechané otevřené pro operátora. Po prvním spuštění z krátkého
testovacího shellu kontrola nenašla běžící okno. Spuštění v samostatné
desktopové relaci prošlo a frontend došel do stavu `ready`.

Zavření UI nezastavuje spravovaný backend. Starší zkušební archiv `b0603b24`
se tímto nemění a neobsahuje poslední dvě opravy; pro běžnou práci používat
nainstalovanou desktopovou položku.

První pre-cutover backup konfigurace/DB:
`/home/belphareon/.local/state/intentsmith/installation-backups/2026-09-28T09-52-17-445Z`.
Finální backup před posledním přepnutím: /home/belphareon/.local/state/intentsmith/installation-backups/2026-09-28T10-20-44-137Z.
Původní instalace zůstává na disku. Při návratu se obnovují soubory uvedené v
`files.json` včetně jejich módů, následuje daemon-reload a ověřený start
služby. DB backup se nevrací přes nová data. Starý backend byl na kopii
upgradované DB ověřen: žádné nové migrace, integrity/fk check OK.

## Důkazy a omezení

Přesné běhy: finální profil `2026-09-28T10-13-51-808Z`, Electron adresáře
`studio2-production-final-{m1,m2,exclusive}-c84b88cd`, živý staging
`studio2-production-stage-BnTclE`, nasazení `studio2-production-apply-et5MJK`
a skutečná produkce `studio2-production-post-2jQ9fr` (PASS 10:22:20 UTC).

Soukromý měřicí packet:
`/mnt/vi7000/intentsmith/evidence/studio2-production-20260928-c84b88cd`.
[Chat v instalovaném IDE](/mnt/vi7000/intentsmith/evidence/studio2-production-20260928-c84b88cd/runs/studio2-production-post-2jQ9fr/production-chat.png),
[restart bez nativního Problems panelu](/mnt/vi7000/intentsmith/evidence/studio2-production-20260928-c84b88cd/runs/studio2-production-post-2jQ9fr/restart.png),
[manifest](/mnt/vi7000/intentsmith/evidence/studio2-production-20260928-c84b88cd/manifest.json).

Packet obsahuje nezměněné původní i neúspěšné pokusy, strukturované výsledky,
spouštěcí skripty, logy, screenshoty a manifest součtů. Kopie DB a původní
soukromá prostředí se do Gitu nepublikují.

Před finálním PASS zůstávají doložené tyto neúspěšné pokusy:
- neplatné testové X11 proměnné: runner BLOCKED před startem;
- klávesová příprava panelu Problems: fixture timeout, nahrazeno jeho
  skutečným registrovaným příkazem, následné obnovení PASS;
- profil `def7daa0`: 384 PASS / 2 FAIL (Gate 0 + reálná terminálová kolize),
  kterou poslední commit opravuje;
- původní staging pokusy: chybné fixture cesty/parametry, správné odmítnutí
  chybějící governance, nalezený přepis `applied_at`, příliš široké porovnání
  proměnlivého verification statusu. Finální identity i výsledky jsou zvlášť.

Zůstává samostatná zděděná backendová chyba: formulace „Stručně česky: kolik
je 17 krát 23? Napiš výsledek a krátké vysvětlení.“ může skončit `local.math /
NO_EXPRESSION`. Jednoduchý výraz funguje a živé modelové odpovědi procházejí.
Tento UI/desktop WP neopravuje parser přirozeného jazyka. Nezávislá přejímka
nových změn zůstává **REVIEW_PENDING**.
