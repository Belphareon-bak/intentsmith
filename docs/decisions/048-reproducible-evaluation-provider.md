# Decision 048 — Reprodukovatelný evaluační provider a verze měření

**Datum:** 2026-09-11

**Identita:** kanonická 048 od integrace 2026-09-12. Původní provider dokument
na `3f3a22203b51905a6bf834cb39f5e7f76b2306f2` používal 044, které nezávisle
vlastní konverzační web. Přečíslování nemění zadání, pravomoci ani stav review.
Historické odkazy na původní cestu zůstávají dostupné jako alias.

**Stav:** `OPERATOR_AUTHORIZED / IMPLEMENTATION_CANDIDATE / REVIEW_PENDING`

## Zadání operátora

Operátor požaduje funkční pravidelný GPU hunt, podporovaný reprodukovatelný
sidecar, automatickou kontrolu nových vydání Ollamy a zaznamenání verze
provideru u každého nového měření. Výslovně povolil aktualizaci Ollamy,
commit a push. Tento záznam zachycuje zadání; sám nevytváří novou pravomoc.

## Provedení

Response digest zůstává povinný. `/api/ps`, inventory ani exclusive lease
jej nenahrazují. Patch 0.34.0 navíc vrací `provider_version` v každé lokální
chat odpovědi. Runner kontroluje oba údaje, takže změna provideru uvnitř
sady nemůže vytvořit COMPLETE pod starou verzí.

Výchozí build je přesný upstream `v0.34.0` + verzovaný patch; historický
`v0.32.14` lze reprodukovat explicitní volbou tagu. Go toolchain, source
commit, epoch a výstupní SHA jsou připnuté. Native payload musí odpovídat
stejnému upstream vydání. Shoda binárky nenahrazuje GPU kvalifikaci.

Sidecar je legitimní evaluační provider na `127.0.0.1:11435`, pouze po dobu
sériového scoringu. Nemění systémovou službu. Samostatně autorizovaný
systémový upgrade používá loopback `11434`, verzi oddělenou v `/opt` a
zachovává původní konfiguraci pro rollback.

Plánovaný sidecar běží pod uživatelským účtem, s vypnutým cloudem a vlastní
procesní skupinou. Ukončení musí zahrnout i native GPU runnery. Systémový
modelový sklad je pro tento účet chráněn běžnými oprávněními; wrapper není
filesystem sandbox. Tato cesta funguje také pod systemd na hostu, kde
AppArmor blokuje neprivilegované user namespaces. Globální policy se nemění.

Identita opakovaně použitelného výsledku zahrnuje digest, roli, kontrakt sady
a verzi Ollamy. Verze leží v append-only `metadata_json.provider`; starým
řádkům se nedoplňuje odhad. Nová Ollama vyžaduje nové měření incumbenta i
kandidáta. Databázový trigger odmítá rozhodnutí mezi dvěma verzemi provideru.

Autocheck jen hlásí nové stabilní vydání. Instalace každé nové verze vyžaduje
přenesení patche, kontrolu checksumů a runtime test. Upstream vydání bez
response proof není automaticky způsobilé pro scoring.

## Upřesnění operátora — uchování kandidátů

Operátor následně upřesnil cílové chování: až se GPU hunt osvědčí, nemá
uchovávat kandidáta, u kterého je průkazné, že nebude vhodnější než současné
modely. Uvolněný disk má sloužit dalším kandidátům. Toto je podmíněný požadavek
na automatický úklid, nikoli pokyn nyní zapnout dosavadní široké mazání.

Prováděcí kritéria pro navazující implementaci a review:

- Podkladem je dokončené, dostatečně rozlišující opakované měření přesného
  artefaktu proti současným modelům na stejné verzi provideru a kontraktech sad.
  Kandidát nemá přínos v žádné relevantní roli podle platné rozhodovací politiky;
  posuzuje se také rychlost, nároky a využití v přípustném portfoliu rolí.
- Chybějící měření, timeout, chyba provideru ani `INSUFFICIENT_EVIDENCE`
  nejsou průkazem nevhodnosti. Nevyřešená role brání kvalitativnímu vyřazení
  celého modelu. Samotné označení `winner=incumbent` nestačí.
- Bezprostředně před odstraněním se ověří přesný digest a ochrany aktivních,
  desired i rollback bindingů a právě používaných modelů. Odstranění vede
  existující durable artifact authority; samotný diskový tlak důkaz nenahrazuje.
- Odstraňuje se lokální artefakt. Výsledky, důvod vyřazení a audit zůstávají
  v DB, aby se stejný zamítnutý artefakt bez změny podmínek znovu nestahoval.

### Výslovná aktivace operátorem, 2026-09-12

Operátor nyní požaduje zapnout automatické mazání modelů, které se průkazně
nehodí pro žádnou roli. Nahrazuje tím předchozí podmínku čekat s aktivací.
Implementace `--prune-rejected` má dvě úzké větve:

- Stejný artefakt, provider a GPU/context mají ověřený
  `CANDIDATE_VRAM_FIT_FAILED` s kladným CPU offloadem. Provozní timeout nestačí;
  protichůdné current COMPLETE odstranění blokuje.
- Kandidát jasně prohraje všechny technicky použitelné role proti aktuálním
  přesným bindingům. Každá role má tři opakování, aktuální kontrakt, dostatek
  stabilně rozlišujících úloh, většinu incumbenta, zápornou marži alespoň
  ve výši role threshold a také celkovou score ztrátu alespoň v této výši.
  Samotné `INCUMBENT_QUALITY` nestačí. Rychlost a VRAM se zaznamenají;
  současná quality-first policy rychlostí nepřebíjí průkaznou kvalitativní prohru.

Obě větve zachovají aktivní, desired a rollback modely. Před efektem se uvnitř
registry mutation owneru a exclusive durable artifact claimu opakuje proof,
provider, klid GPU a binding ochrana. Systémový provider 11434 vlastní zápis
modelového skladu; sidecar 11435 slouží evaluaci. Žádná binding application,
rollback změna ani odstraňování historie nejsou součástí tohoto zadání.

Append-only hunt journal uchová schválení, důkazy a výsledek odstranění.
Scheduler neopakuje stažení zamítnuté katalogové revize, dokud se nezmění
provider, GPU/context, sada/policy nebo přesní incumbenti. Katalogový otisk
pouze plánuje; lokální mazání stále vyžaduje plný digest. Ruční `--only`
zůstává explicitním diagnostickým override scheduleru.

Serverový starší age-based auto-cleanup se tímto nezapíná. CLI legacy spelling
`--allow-removal` nyní vede stejnou úzkou cestou; inline mazání v candidate trial
CLI nikdy nezapíná. Nezávislé review zůstává PENDING.

## Omezení

Toto není nezávislé acceptance review M6. Krátký katalogový manifest ID slouží
jen k detekci změn před stažením; autorita artefaktu vyžaduje plný SHA-256
z obsloužené odpovědi. Změněný tag již instalovaného modelu se pouze ohlásí,
protože automatický přepis by mohl změnit aktivní nebo rollback binding.

## Opravený provider a rozhodovací přejímka, 19. 9. 2026

Výchozí reprodukovatelný build, oba instalační skripty a evaluační wrapper
nyní cílí `0.34.0-intentsmith.2`. Druhý patch opravuje předčasné ukončení
opakovaných tokenů v kódu. SHA binárky je
`3c22a0cfb46a9ea38fd4dba6746a022be04f5ada21a529e83c9380a5f0547b9d`;
upstream native payload zůstává 0.34.0. Změna skriptů sama neznamená instalaci
ani kvalifikaci další upstream verze. Systémový upgrade se provádí v klidu,
přes root instalační skript se zachováním předchozí služby pro rollback.

Oba providery mohou mít tentýž patch. Odděluje je životnost, procesní skupina,
port, účet a vlastnictví operací: 11434 obsluhuje aplikaci a řízené zápisy
modelového skladu; 11435 existuje pouze pro izolovaný sériový evaluační běh.
Rozdíl nespočívá v přítomnosti patche. Historie nesmí míchat měření `.1` a `.2`.

Historický odstavec o odstranění na základě CPU offloadu již není současnou
politikou: samotné přetečení konkrétního kontextu vede pouze k nezpůsobilosti
tohoto profilu. Retence musí mít přijatý profil a prokázanou ztrátu v každé
použitelné roli. `decisionReady` neplyne z počtu úloh; neověřené prototypy
zůstávají průzkumné. Legacy `allowRemoval` na jednotlivém candidate trialu
neopravňuje k mazání; běžný hunt používá samostatnou retenční autoritu.


## Navazující upstream 0.34.2, 19. 9. 2026

Výchozí recept je nyní `v0.34.2`, upstream
`dfabde4539e42ba1e1eab50a3a50b88aea7958a0`, patchovaný zdroj
`cd1553287618f6583c793fc4e5f9199b5bd8e894`, provider
`0.34.2-intentsmith.1`. Oba patche jsou v
`patches/ollama/0004-v0.34.2-attested-complete-responses.patch`.
Dva nezávislé cgo build cache a reprodukce verzovaným skriptem poskytly
SHA-256 `2b98fceffbc6d5d97a6e96ddfd46c597cee4fa06a03d740fdb74dd9a34ff0f92`.
Nativní upstream archiv má SHA-256
`e155b83589986d2c581fdbf1381ea3ebdb16549883679cd5a0627f7cdc05b12b`.
Regrese `go test ./llm -run 'Test.*Completion' -count=1` prošla.

Runtime v uživatelském adresáři byl sestaven a instalován pro izolovaný
sidecar. Toto není potvrzení systémového upgradu na portu 11434 ani
předpovědní platnosti hodnocení. Systémový instalační skript nadále
vyžaduje root autentizaci, klid GPU a uchovává rollback. Konkrétní
fyzická měření a jejich omezení jsou v závěrečném review huntu.

Upstream [0.34.1](https://github.com/ollama/ollama/releases/tag/v0.34.1)
mění detekci opakovaných tokenů a načítání katalogových údajů;
[0.34.2](https://github.com/ollama/ollama/releases/tag/v0.34.2)
aktualizuje llama.cpp a opravuje dlouhé generování MLX. Samotná dostupnost
nové verze neprokazuje kompatibilitu starých měření. Starší recepty zůstaly
explicitně dostupné přes `OLLAMA_PROVIDER_TAG`/`OLLAMA_PROVIDER_REVISION`.

## Lokální generate attestation, 20. 9. 2026

Provozní obrazová cesta `analyzeImages` používá `/api/generate`. Reprodukce
na `0.34.2-intentsmith.1` potvrdila, že tato cesta nevrací response digest;
odmítnutý první pokus zůstává v evidence, inventory jej nenahrazuje.
Patch `0005` doplňuje digest již vybraného modelu a provider version do
lokálních generate odpovědí včetně streamu, load/unload a debug renderu.
Remote forwarding se nemění. Go regresní kontrola mění manifest tagu
během dokončování a požaduje původní obsloužený digest; bez doplněných
polí selže v obou stream režimech.

`OLLAMA_PROVIDER_REVISION=2` s tagem `v0.34.2` skládá nový build
`0.34.2-intentsmith.2`, source `2206cee85bf2cbe12ea69101aa7d76b91cd8cbb4`,
binary SHA `351d992d509eb4c0d97dea75111de1b91d1bec8643dd46a88355fd0b7f11cef3`.
Explicitní manuální `--conversation-handoff` jej vyžaduje; běžný hunt a
dříve uzamčené piloty nadále používají `.1`. Systémový provider ani
produkční bindingy se tím neaktualizují. Stejný 0.34.2 native payload
je ověřen přes jeho souborové hashe. Tato implementace není přejímka
automatického rozhodovacího profilu.
