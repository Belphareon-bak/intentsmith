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

## Omezení

Toto není nezávislé acceptance review M6. Krátký katalogový manifest ID slouží
jen k detekci změn před stažením; autorita artefaktu vyžaduje plný SHA-256
z obsloužené odpovědi. Změněný tag již instalovaného modelu se pouze ohlásí,
protože automatický přepis by mohl změnit aktivní nebo rollback binding.
