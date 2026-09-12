# Decision 044 — Reprodukovatelný evaluační provider a verze měření

**Datum:** 2026-09-11

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
