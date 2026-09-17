# Specialisté ve Studiu: chybějící Sázkař a NOT_SENT

Stav: **IMPLEMENTATION_VERIFIED / REVIEW_PENDING** pro níže uvedený řez.
Nejde o přijetí celého produktu ani důkaz správnosti daňového podání či
predikční výhody sázkaře. Navazuje na explicitní screenshot operátora a
[WP-SPECIALISTS](../wp/WP-SPECIALISTS-20260911.md).

## Příčina a výsledné chování

Instalovaný snapshot `1da840c0` měl starší specialisty. Zdroj `e0b75ee4`
navíc odvozoval seznam specialistů z heuristik expertyz. Balíček `sazeni`
proto chyběl a účetní se aktivoval jako `accountant` místo `accountant-cz`.
Aktivace nezaručovala stabilní identitu konverzace ani potvrzení serveru.
PDF/HEIC nebyly podporované inline přílohy; obecné odmítnutí bylo zobrazeno
jako chyba WebSocketu. V režimu specialisty se odpověď navíc nepřekreslovala
v hlavním panelu, i když už ji klient přijal.

Integrace zachovává obě historie (`e0b75ee4` + `ff313081`) a připojuje dříve
implementované lokální enginy do aktuálního Studia:

- Seznam používá skutečně povolené balíčky z `/api/specialists`; aktivace
  čeká na potvrzení a před odesláním obnoví vazbu konkrétní konverzace.
- PDF/HEIC/HEIF se čtou z vybraného souboru a přenášejí inline. Měřený
  příklad HEIC přibližně 6,7 MiB + PDF přibližně 33 KiB má pokrytí testem.
  Dokument: nejvýše 10 MiB, dávka s dokumentem: 20 MiB, nejvýše 5 příloh.
  Běžné textové/obrázkové limity zůstávají; rámec zahrnuje base64 režii.
  Cesta k souboru na backendu není přípustný vstup.
- Účetní dostává jednorázovou hostitelskou funkci pro konkrétní projekt,
  konverzaci a zprávu. Lokální OCR ukládá návrhy s dohledatelným zdrojem;
  opakovaný import je deduplikovaný. Následují požadavky na údaje, průvodce,
  kontrola dokladů a pracovní nebo validovaný export.
- Sázkař používá veřejnou Fortunu a historii football-data.co.uk bez
  ručně zadávaných pravděpodobností. Stav obou enginů je mimo instalaci,
  v soukromých složkách uživatele. Neprobíhá podání sázky ani e-mail.
- Příčiny odmítnutí příloh jsou konkrétní; rozepsaný vstup se zachovává.
  Přijatá odpověď překreslí také hlavní panel specialisty.

## Důkazy

Kanonický runner s `--allow-dirty`; účetní integrace má explicitní opt-in
lokálního Python/PDF/OCR runtime. Účetní doména/host, specialist runtime,
loader a package boundary, oba sázkařské programy, M1 Studio client a
harness mají focused PASS. Poslední M1 běh:
`2026-09-17T13-58-17-520Z`, poslední sázkařská integrace:
`2026-09-17T14-04-57-154Z`, pod `.intentsmith-artifacts/test-runs/`.

`yarn build` z `c3-ide`: PASS včetně ověření skutečného consumeru.
Frontend SHA256 `887b45378863978e4aef4f6ea43ccb24316e33c4586972f387708a2bd700cbfc`.
Registry: 523 programů, 429 ACTIVE / 79 BLOCKED / 15 HISTORICAL;
hash `f29ced20ed0c8e847d8f28ff92a19231c75b78328d18ede86f8bd5c4cb35a4c4`.

Skutečný Electron, nový izolovaný backend a vlastní DB, model provider vypnut:
originální PDF a HEIC → viditelná odpověď **2 soubory / 7 návrhů dokladů**.
`pruvodce` → otázka na jméno → jednoduchá odpověď → otázka na příjmení.
Soukromé screenshoty a výstupy jsou pouze v ignorované složce
`.intentsmith-artifacts/studio-specialists/run-auFMLk`.
Samostatný běh `run-y90ZMC` ověřil viditelný seznam Sázkař a skutečné
spuštění jeho nástroje přes chat.

Živá historie při sondě 17. 9. 2026 vracela z football-data.co.uk HTTP 302
na `http://127.0.0.1/...`. Síťová kontrola správně zastavila požadavek
(`OUTBOUND_REDIRECT_DENIED`); běh sázkaře je **PROVIDER_BLOCKED**, nikoli
důkaz načtení aktuálních kurzů. Přímá veřejná sonda Fortuny vrátila HTTP 200,
ale sama o sobě neprokazuje úspěšný výpočet tiketů. Přidána česká zpráva
identifikující nedostupnou historii a regresní test zákazu následování
tohoto přesměrování. Síťová ochrana se neoslabuje.

## Zachované neúspěchy a meze

První průchody odhalily chybějící závislost buildu, starý bundle, rekurzivní
base64 regex na velkém souboru a chybějící překreslení hlavního panelu.
Po opravách M1 regresní sada i skutečný DOM průchod prošly. Pozdější selhání
automatického kliknutí bylo odpojeným DOM handlem sondy, opraveným novým
výběrem prvku při kliknutí; není vydáváno za produktový úspěch celého běhu.
První runtime testy zachytily příliš široký matcher účetního; konkrétní
matcher zachovává pět původních kalkulačních nástrojů a průvodce navazuje
v kontextu stejné relace.

OCR je návrh vyžadující kontrolu; sedm extrahovaných dokladů není potvrzení
jejich částek, daňové uznatelnosti ani shody s referenčním podáním.
Export je lokální cesta, zatím bez samostatného download panelu.
Dokončení přiznání vyžaduje chybějící údaje a schválení evidence.
Nezávislé review integrace zůstává otevřené. Původní instalace a cizí
worktree zůstávají zachované; případná změna instalace má samostatný záznam.

## Integrační checkpoint

Implementace `da4fe7cb`, explicitně revidovaný boundary pin `81b873d8`:
19 přidaných hran, žádná odebraná, 1 356 celkem, 3 cykly / 28 členů.
Veškeré nové závislosti jsou hostitelská kompozice, bounded přílohy,
abort, lokální persistence a existující auditovaná síťová autorita.
Následující merge zachovává i mezitím nainstalovaný časový kontext
`58d7cced` (dvě další čisté importní hrany, výsledně 1 358).

Konečná soukromá Electron sonda `run-1sV6AB` prošla celým UI průchodem
včetně obou specialistů; PROVIDER_BLOCKED není zahrnut do tvrzení o
funkčním živém výpočtu. Původní běhy a jejich neúspěchy zůstávají zachované.

První úplný offline/database profil na `81b873d8`, běh
`2026-09-17T14-07-18-977Z`: **348 PASS / 4 FAIL / 7 BLOCKED**.
FAIL: zastaralá kardinalita/verze v accountant-self-contained, dokumentační
LOC/graph census, nesprávně zvolené účetní PDF prostředí pro obecný export
(charset-normalizer 3.5.1 místo připnutého 3.4.4), očekávaný release seal.
BLOCKED byly dostupné nástroje bez explicitního opt-in (git, bwrap,
bubblewrap, prlimit, systemd-analyze); nejedná se o PASS těchto programů.
Kontrola identity všech pěti původních kalkulačních adaptérů zůstává,
nový dokumentový nástroj má vlastní kontrolu požadované scoped autority.
