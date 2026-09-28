# Oprava hlavní navigace při obnově rozložení Studia

Autorita: hlášení operátora 2026-09-18 — hlavní levé menu musí zůstat dostupné
v nastavení i při přepínání obrazovek. Navazuje na WP-IDE-WORKSPACE-20260918.
Vlastník změny: Codex v `intentsmith-audit-20260911-FNF2jj/snapshot`.
Rozsah proti předchozí instalaci: `39cad5f1..57726969`; produktová delta je jen
`intentsmith-ide/extensions/intentsmith-chat-panel/lib/browser/chat-panel-module.js`.
Změny druhého workera jsou zachované merge commitem `a3adb4eb`.

## Příčina a oprava

Theia volá `onStart` před obnovou uloženého rozložení. Obnova mohla znovu
sbalit dock navigace; jeho vnější kontejner přitom nebyl `hidden`, takže ani
původní ovládání obnovení nezjistilo skutečný stav. Reprodukce po restartu:
Settings existuje, main x=4, navigace 0×0, `dockHidden=true` a žádný currentTitle.
Dřívější důkaz z nového profilu nepokrýval tento uložený stav.

Navigace se nyní znovu připojí a odkryje v `onDidInitializeLayout`, po obnově
Theia layoutu. Odkrytí rozbalí také dock, ne pouze kontejner. Ctrl+B, vlastní
šipka a automatické sbalení ponechávají dostupný 48px pás ikon. Neprovádí se
reset profilu, smazání localStorage ani přepsání zvolené stránky či relací.

V reálném GUI se navíc objevil prázdný pravý panel (276px) vedle nastavení.
Shell jej při obnově znovu ukázal, zatímco cached view stále tvrdilo, že je
skrytý. Synchronizace proto u katalogů/nastavení vždy uplatňuje skrytí; při
návratu do pracovního prostoru pravý panel znovu otevře. Výsledné nastavení
vyplňuje ve 1400px okně x=244 až 1400, levé menu měří 239px. Při sbalení je
navigace 48px a střed začíná na x=52.

## Důkazy a meze

- 25/25 workspace regresí, včetně obnovy docku a opětovně zobrazeného pravého
  panelu. Navazující Studio/desktop boundary testy 71/71; validační program
  artefaktů 160/160. Při integraci modelových změn dalších 88/88 Node testů
  (překrývají se s uvedenými boundary testy; nejde o sčítané nezávislé pokrytí).
- Produkční build PASS. Instalovaný bundle:
  `1b88df02c49bb2d2d477f202a776c895c600c3e20a44246aad6a03c95221e80d`.
- Skutečný Electron: 17 kontrol se stejným uloženým testovacím profilem,
  opakováno z čisté instalované kopie `57726969`: obnova sbaleného layoutu
  s původním ID `c3-sidebar`, osm položek menu, Ctrl+B oběma směry, navigace
  přes ikonu, automatické sbalení a fyzické velikosti okna 1400/1000/900/1400.
  Samostatně otevření projektového prostoru vrací pravý panel; návrat do
  nastavení jej skryje a ponechá levou navigaci.
- Kontrola grafu: 1377/1377 hran, žádná přidaná hrana. M5 strom 0 nálezů;
  historie dál 15/15 dosažitelných objektů, HISTORY_REMEDIATION_REQUIRED.
- Testovací GUI používalo soukromou DB/profil a nedostupného modelového
  providera. Nejde o nový fyzický modelový journey ani nezávislé review.
  Obchod/Multimédia v tomto runtime hlásí nedostupná data; kontrolována byla
  navigace, ne jejich funkčnost. Uživatelský profil se nemaže ani nekopíruje.

## Nasazení

Nainstalováno `577269693b6bc3f469a859b448d7b5fd07f87819` místo `39cad5f1`.
Instalace vytvořila konzistentní zálohu
`~/.local/state/intentsmith/installation-backups/2026-09-18T15-33-03-988Z`.
Deset sledovaných tabulek odpovídá předinstalační záloze počtem i hashem,
`quick_check=ok`, FK chyb 0, 105 záznamů migrací. Credential zachovaný,
autorizované HTTP 200, bez credentialu 401, launcher check PASS.
Hunt i samostatné měření byly při přepnutí neaktivní, timer zůstal aktivní.
Staré otevřené okno používá starý bundle, vyžaduje zavření a nové spuštění ikonou.

## Zachované neúspěšné a neúplné pokusy

První pokus o aktualizaci LOC tabulky měl chybný formát; artefaktový validátor
jej zamítl. Opravena pouze tabulka a opakování je 160/160.
První úplný profil na `f49ffcfc` byl úmyslně zastaven po zjištění prázdného
pravého panelu: 165 PASS / 1 FAIL / 194 SKIPPED, verdict FAIL. Není to
úplný gate; report i logy zůstávají v `gate/ide-sidebar`.
Nepoužitá a nikdy neinstalovaná kopie `f49ffcfc` byla po ověření odstraněna;
commit i důkazy zůstávají. Dřívější instalace nebyly čištěny.

Úplný finální profil: 359 PASS / 1 FAIL / 0 BLOCKED / 0 SKIPPED, 360 programů na `57726969`. Jediný FAIL je `nightly-orchestrator-self-test` (nezměněný operátorský Gate 0 hash); celkový verdict zůstává **FAIL**.

Stav: oprava implementovaná, instalovaná a runtime ověřená; REVIEW_PENDING.
Předchozí release blockery tím nejsou uzavřené a nejde o tvrzení production-ready.

[Strojová evidence](../execution/runs/ide-sidebar-20260918.json), [obrazovka opraveného nastavení](assets/ide-sidebar-20260918/settings-fixed.png).
