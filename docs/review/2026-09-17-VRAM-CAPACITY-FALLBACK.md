# VRAM katalogu při nefunkčním NVML

Autorita: snímek operátora a námitka, že kapacitu GPU lze zjistit i při selhání nvidia-smi.
Produktová delta `45a6d821..40990f46`, připnutí jediné nové importní hrany `d4dea0bb`.
Instalace je čistý detached snapshot `d4dea0bb3dce1c3f0b0622da4639463bdd2d0743`.
`src/` a `c3-ide/` mezi 40990f46 a d4dea0bb mají prázdný diff.
Stav: **INSTALLED / REVIEW_PENDING / GPU_SCORING_BLOCKED**.

Živý důkaz: před instalací endpoint candidates vracel 71 položek, GPU 0,
limit null a 0 kandidátů v limitu. Po instalaci vrací stále 71 položek,
GPU 24103 MiB, zdroj nvidia-settings, automatický limit 19282 MiB
(dosavadních 80 %) a 49 kandidátů v limitu. Jde o katalogové odhady,
nikoli důkaz skutečného umístění modelu na GPU nebo doporučení kvality.

Fallback běží pouze v read-only katalogu, jestliže systémový profil nezná
kladnou kapacitu. Používá omezený execFile nvidia-settings -t -q
[gpu]/TotalDedicatedGPUMemory, timeout 3 s, limit výstupu 16 KiB; pro více GPU
bere největší jednotlivou kapacitu, nesčítá je. Neplatný nebo nedostupný výstup
vrací null. Nevrací autoritu available a není použit pro inference ani retention.
Význam atributu potvrzuje [zdroj NVIDIA](https://github.com/NVIDIA/nvidia-settings/blob/main/src/parse.c).
Nejde o aktuálně volnou paměť; dostupnost NV-CONTROL závisí na běžícím X serveru.

Pokud nezná kapacitu ani fallback, výchozí filtr ukazuje katalog a označení
neověřeného vejití. Kladný ruční limit obnoví filtrování; neplatná hodnota
se nevydává za kapacitu. Rozlišuje prázdný katalog od filtru bez výsledků.
Výstraha nad limitem se počítá ze skutečně zvoleného limitu, ne ze starého
backendového fitsVram. Ovládání dědí opravený tmavý/zlatý motiv.

Příčina nvidia-smi je doložená lokálně: start PC 17. 9. 10:46:32 CEST,
apt upgrade 11:16:33–11:20:09, NVIDIA 595.84 -> 595.91.07. Běžící kernel
má stále 595.84, NVML 595.91, modul na disku 595.91.07. Xorg eviduje
25165824 kBytes fyzické VRAM RTX 3090 a NV-CONTROL vrací 24103 MiB
dedikované kapacity. Restart PC nebyl proveden. Živý POST qwen3.5:27b/CODE
po instalaci stále vrací HTTP 503 GPU_DRIVER_LIBRARY_MISMATCH.

Cílené testy: desktop 19, current read model 19, Studio client 132,
artifact validation 158 PASS před změnou baseline. Parser je testovaný
pro více GPU, chybný výstup, nedostupný display a nezměněnou blokaci inference.
První plný offline/database profil: 357 PASS / 2 FAIL; navíc k známé release
pečeti chyběla nová importní hrana. Přidána přesným --accept-edge, bez růstu
cyklů nebo výjimky. Následný stav a dokumentační kontrola jsou uvedeny níže.

Fyzický Electron na 40990f46 s řízeným HTTP backendem: viditelnost 4/4 při
neznámém limitu, po zadání 20 GiB 2/4, číselné řazení, scoring refresh,
HTTP negativní test Qwenu s nativním confirm a alertem v témže řádku PASS.
Tři pole mají shodnou výšku 30 px. První fyzický pokus selhal až v navazujícím
kroku: harness předpokládal otevřenou záložku po baseline journey, click
na neexistující tlačítko. Upraven pouze harness, aby prošel viditelnou navigací.
Původní pokus i jeho private failure detail zůstaly zachované.
Limity: NODE_ENV=test, --no-sandbox, privátní user/network namespace,
fixture backend a capture po vyjednaném startu. Nejde o nový GPU benchmark.
Frontend SHA-256: 727b770c0ccd147cc317d3f9d372eb132f7ba24d95cc5981c4097a56b1ad6114.

Launcher --check PASS. Backend i timer active; ruční eval unit inactive.
Před/po instalační záloze jsou shodné hashe 503 evaluací, 220 rozhodnutí,
7 desired bindings a 11 binding operations; quick_check OK a 0 FK chyb.
Startup přidal rehydrate/verification attempts a receipts, takže není
slibovaná shoda celé DB. Žádný model nebyl smazán ani přepnut.
Otevřený operátorův Electron stále používá 09cbd0d6; nový frontend se načte
při opětovném spuštění Studia. Okno s případnými drafty nebylo ukončeno.

Privátní evidence root:
`/home/belphareon/Projects/coworker/intentsmith-vram-detection-20260917`.
Předchozí evidence archivy zůstávají zachované. Archiv neobsahuje produkční DB,
port capability ani instalační konfigurační zálohy; není publikován.

Následný plný profil na d4dea0bb: **357 PASS / 2 FAIL / 0 BLOCKED /
0 TIMEOUT**. Runtime a importní hranice prošly; non-PASS jsou release seal
a dokumentační assertion zastaralého počtu hran v ROADMAP (1359 místo 1360).
Následně opravena pouze tato hodnota v dokumentaci; cílený artifact-validation
**158/158 PASS**. Celý profil se po této dokumentační opravě neopakoval;
předchozí verdikt FAIL zůstává zachován, není přepsán na PASS. Zbývající
release seal odpovídá CONTRACT §8 a nebyl měněn. Nezávislé review je pending.

Evidence manifest připíná 767 souborů. Content-addressed archiv v nadřazeném
coworker adresáři:
`intentsmith-vram-detection-sha256-7f41e81737e13d6fa059ab2800aeb158a770ea590ee2dce247757b30b475825a.tar.gz`.
SHA-256: `7f41e81737e13d6fa059ab2800aeb158a770ea590ee2dce247757b30b475825a`.
