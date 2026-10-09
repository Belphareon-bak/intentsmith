# Importní hranice integračního kandidátu

WP-IDE-INTEGRATION-20261009; implementační self-review, nezávislé review pending.
Z baseline 1554 vzniká 1557 hran, odstraněno 0. Cyklů zůstává 3 / 28 souborů.
Rebaseline je samostatný commit podle CONTRACT §11 a pinne předchozí čistý
implementační commit.

Přijímají se pouze tyto tři hrany:

- src/system/ide-storage.js -> src/system/ollama-storage.js
- src/upgrade/model-registry.js -> src/system/ollama-storage.js
- src/upgrade/upgrade-manager.js -> src/system/ollama-storage.js

Společný resolver čte pevnou lokální službu s timeoutem a porovnává endpoint,
aktivní PID a explicitní absolutní cestu. Neznámá cesta zůstává UNKNOWN.
Resolver nenabízí shell, přepis konfigurace, efekt nebo novou síťovou autoritu.
Úložiště i měření prostoru při pull/cleanup tak používají stejné ověření.
Pozitivní fixture i odmítnutí remote/jiného portu/chybějící služby jsou v
ide-backend.test.js. Odebrání artefaktu nadále vyžaduje vlastní autoritu.

Přehled ModelRegistry předává jeden snímek provider cesty také měření kapacity.
Test prokazuje odlišný backend hint, tři různé hodnoty volného místa a přesně
jedno pozorování cesty na přehled. Testovací resolver je interní DI, žádné HTTP
nepřijímá cestu ani spustitelný příkaz.
