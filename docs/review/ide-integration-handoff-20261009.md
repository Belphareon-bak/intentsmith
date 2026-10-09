# IDE a backend — předání pro nezávislou revizi

10. 10. 2026, operátor a Opus. **REVIEW_PENDING_WITH_OPEN_SETTINGS_FINDINGS**.
Regresní ověření prošlo; bod f) není úplně přijatý. Po publikování tohoto
předání čeká worker na nezávislý verdikt Opuse pro finální úpravy. Produkční
přejímka zůstává **NOT_ACCEPTED**.

## Přesný kandidát a vlastnictví

- Větev: `work/ide-integration-20261009`, publikovaná na originu.
- Testovaný aplikační kód: `c47d18839bea6c8481c75506f914e7acfc48d710`.
- Base: `138e958be927df9835c091d3ad41d44b347e85b5`.
- Spojené vstupy: BE `0766a0ba73b4f25be3d6ccc507d26ba5e26ba2c6` a FE
  `598de50e357350a2014ad49e4df46e288c678579`.
- Vlastní checkout: `/home/belphareon/Projects/intentsmith-ide-backend-20261009`.
  Cizí FE/CHAT checkouty, `/tmp/ibr`, `/tmp/ifr`, `/tmp/rb`, `/tmp/rf`, provozní
  DB a konfigurace nebyly upravované. Produkční PID 2027 byl znovu ověřen na
  releasu `c84b88cd0c0b76639823c82c022d2feab96dfc15`.

Pozdější předávací commit přidává dokumentaci, důkazy a ruční diagnostický
skript. AppImage a kompletní regresní běh patří výslovně k výše uvedenému
aplikačnímu SHA, nikoli k pozdějšímu dokumentačnímu SHA.

## Opravy předané revize

| Nález | Výsledné chování | Důkaz |
|---|---|---|
| P1-1, CHAT 2048/3072 | Role CHAT vyžaduje nejméně 4096; nižší hodnota se odmítne před voláním poskytovatele. Staré neplatné nastavení se označí `REQUIRES_UPDATE`. | `ide-backend.test.js`; skutečný Studio controller uloží 4096 a další zpráva projde přes `/api/chat`. |
| P2-1, výstup 32 ořízne klasifikaci | CHAT limit odpovědi platí pro `purpose: answer`; klasifikace si ponechá 256, kompakce vlastní limit. | Skutečný HTTP journey: klasifikace 256, odpověď 32, obě s kontextem 4096. |
| P2-2, sdílený model D2/R1/R2 | Planner posílá skutečnou roli. Odlišné kontexty/výstupy se projeví i při stejném modelu; telemetrie eviduje roli. | Tři reálná volání `WorkflowOrchestrator._callLLM`: 4096/8192/12288 a 128/129/130. |
| P2-3, chybná cesta modelů | Jeden resolver pro inventuru, registr a pull/cleanup čte explicitní konfiguraci aktivní lokální služby. Neznámá cesta zůstává `UNKNOWN`. | Read-only sonda této stanice: `/mnt/vi7000/ollama/models`, `LOCAL_PROVIDER_SERVICE`, odlišný backend hint. |
| P2-3, opakované disky a temp DB | Deduplikace zařízení + typu FS, vynechání Docker overlay a SQLite `temp`. | Fixtures `ide-backend.test.js`, nativní stránka úložiště. |
| P2-4, odmítnutý formulář | 400/422 zachová hodnoty a dovolí opravu; nejistý zápis zůstává blokovaný. Bezpečná česká chyba místo interní cesty/`ENOENT`; neočekávané chyby jsou 500. | Skutečný Studio SSH formulář: odmítnutí chybějícího klíče, stejné hodnoty, oprava, uložení a readback. |
| P2-5, workeři | FE uloží vlastní deklarativní M3 šablonu, ověří ji čtením, vytvoří instanci a upraví konfiguraci přes oba digesty. Nová instance je vypnutá; úprava nemění zapnutí. | Skutečný Studio → API journey; nativní průvodce; žádný požadavek na `/api/agents/__new__`. |
| P2-5, specialisté | Průvodce posílá systémový prompt, pravidla a omezení; české názvy se správně přepisují do ID. | Backend test tvorby/duplicit a zachovaných pravidel, FE test payloadu, nativně dostupná pole. |
| P2-6, podklady Huntu | FE umožňuje import veřejného podkladu s původem, rolí, měřítkem a datem. Kvantizace pochází z doložených metadat; chybějící údaje zůstanou neznámé. | Studio import → skutečné API → readback, validační/porovnávací testy. Automatický sběr veřejných skóre není implementován. |
| P2-7, Hunt bez stavu | Fronta uvádí skutečný důvod neprovedení, včetně `AUTOMATION_HOLD`, nedostupného Huntu a neznámého stavu GPU. | Scheduler a FE testy. Hold stanice je zachovaný; není to úspěšný GPU běh. |
| P3, validace a katalog | Validují se i mazací ID; vadná vlastní šablona nezruší celý katalog. Účty/SSH dostanou nové ID a UI uvádí místo credentials. | Negativní API/Studio testy. |

Vlastní worker zůstává uvnitř existující M3 autority: deklarativní
`project_context` a in-app oznámení. Průvodce neslibuje obecné spouštění
libovolného kódu. Veřejný podklad není místní ověřené skóre ani autorita
aktivovat model.

## Otevřený nález při ověření bodu f)

Ruční sonda použila **skutečný `LiveModel` a `CatalogStore`, autentizované
produktové HTTP API, izolovanou SQLite a restart backendu**. Všech 35 obecných
polí bylo změněno přes frontend, uloženo, znovu přečteno a nalezeno po restartu.
To je **CONFIG_ROUNDTRIP_PASS**, ne důkaz účinku všech polí.

Další skutečná chatová zpráva na kontrolovaném poskytovateli prokázala:

| Volba | Uložená hodnota | Další odpověď dostala | Stav |
|---|---:|---:|---|
| Obecná teplota `intentsmith.llm.temperature` | přibližně 0,8 | 0,7 | **OPEN / NOT_APPLIED** |
| Obecný kontext `intentsmith.llm.contextWindow` | 33792 | 32768 | **OPEN / NOT_APPLIED** |

Naproti tomu **nastavení konkrétní role** přes `/api/system/models/role-settings`
má ověřený účinek na další zprávu. Obecná dvojice výše je samostatná starší
preference a regresní sada její runtime účinek netestovala. Účinek dalších
33 obecných voleb tato sonda neprokazuje; jednotlivé řádky mají
`runtimeEffect: NOT_VERIFIED`. Výsledky nesmějí být prezentované jako
„všechna nastavení fungují“.

Pro finální úpravu po verdiktu jsou možné dvě cesty: propojit každou obecnou
volbu s konkrétním runtime spotřebitelem a ověřit její účinek, nebo odstranit
duplicitní konfiguraci a vést uživatele na existující editor rolí. Doložené
neúčinné volby ani nepokryté účinky se nepovažují za přijaté.

Reprodukce, Node 24, kořen tohoto checkoutu:

```sh
node scripts/manual/verify-ide-preferences-http.mjs
```

Skript vlastní dočasný backend/DB a záznamového poskytovatele, vše ukončí a
výsledek uloží pod `.intentsmith-artifacts/ide-integration-20261009/`. Jeho exit
0 znamená úspěšné uložení/readback/restart a dokončení diagnostiky; úplnou
funkčnost by musel potvrdit stav všech `runtimeEffect`, což dnes neplatí.

## Důkazy a ověření

Publikované JSON jsou v [evidence/ide-integration-20261009](evidence/ide-integration-20261009/validation.json).
Manifest uvádí SHA256 a velikosti; původní logy zůstávají ve vlastním ignored
artifact rootu. Žádná běžící produkce nebyla použita jako testovací instance.

| Ověření na `c47d1883` | Výsledek |
|---|---|
| Celý offline + database profil, serializovaně, Node 24.21.0 | **415 PASS, 0 FAIL/TIMEOUT/BLOCKED/SKIPPED**, exit 0; 327 offline + 88 database. |
| Registrované IDE backend a skutečný HTTP journey | **2/2 programy PASS**; backend 22 subtestů, journey 2 scénáře včetně restartu a skutečných FE controllerů. |
| Zabalená AppImage připojená k vlastnímu backendu | **9/9 kontrol PASS**, žádná chyba rendereru. Skutečné nativní kliknutí do úložiště, role CHAT, SSH, workera a specialisty. |
| CI `37997242415` | **19/19 kroků success**, přesné plné SHA ověřené GitHub API; [běh CI](https://github.com/Belphareon-bak/intentsmith/actions/runs/37997242415). |
| Generovaný view, registr/census, importní ratchet a hygiena | PASS; registr 602 programů, graph 1557 hran bez driftu. Tři nové importy mají samostatný rebaseline/self-review. |
| Bod f), obecné volby | 35/35 uloží/readback/restart; dva prokázané neúčinné runtime vstupy, ostatní účinky touto sondou nepokryté. **Není plný PASS.** |

Nativní proof používá kontrolovaného poskytovatele; netestuje kvalitu skutečné
Gemmy ani doručení externí zprávy. `media/history` je v této izolované instanci
404, protože ComfyUI je vypnuté. Není to důkaz multimediální přejímky.

AppImage ze zdroje `c47d1883`: `IntentSmith-0.1.0.AppImage`, 195165744 bajtů,
SHA256 `a99dbd2cb225ae859f2ca12f8c34296d82bb53ceb76378f188f8386c5aaab4db`.
Renderer bundle: `209dfda0169114588dc21732c9631ad062a952587b6c2c560fe6ed8bc6aae1a1`.
Build receipt a příkazy mají vlastní otisky. Reprodukce nativní sondy:

```sh
node scripts/manual/verify-ide-integration-native.mjs
```

Před opakováním musí být sestavená vlastní AppImage; sonda není launcher pro
produkční provoz. Lokální screenshoty:
[úložiště](../../.intentsmith-artifacts/ide-integration-20261009/native-final/storage.png),
[role CHAT](../../.intentsmith-artifacts/ide-integration-20261009/native-final/role.png),
[SSH](../../.intentsmith-artifacts/ide-integration-20261009/native-final/ssh.png),
[worker](../../.intentsmith-artifacts/ide-integration-20261009/native-final/worker.png),
[specialista](../../.intentsmith-artifacts/ide-integration-20261009/native-final/specialist.png).

Kompletní profil:

```sh
INTENTSMITH_PDF_PYTHON=/home/belphareon/.local/share/intentsmith/python/pdf/bin/python3 \
UCETNI_RUNTIME_DIR=/home/belphareon/.local/share/ucetni \
node scripts/nightly-audit.js --run-id=ide-integration-review --profile=offline,database --concurrency=1 \
  --allow-blocker=toolchain:accountant-ocr-runtime,toolchain:python-pdf-runtime,toolchain:python3,toolchain:systemd-analyze,toolchain:tar,toolchain:git,toolchain:bwrap,toolchain:bubblewrap,toolchain:prlimit,toolchain:iproute2,toolchain:nftables
```

Historie selhání zůstává zachovaná: v1 byl přerušen kvůli chybějícím explicitním
toolchain povolením; v2 skončil **413 PASS / 2 FAIL**. V2 odhalil host-dependent
storage fixture a chybějící inertní kontrakty nových polí prototypu. Obojí bylo
opraveno v `c47d1883`; v3 je celý nový běh, není upravená statistika v2.

## Kontrakt Huntu a další etapa

[Původní kontrakt](2026-10-09-HUNT-ROLES-AND-CHAT-PROMPT-CONTRACT.md) je sem
převzat beze změny z cizího necommitnutého dokumentu; SHA256
`fadcf68f6ae591f3ccc646193e6d5ae0d1abeacaca39a696fd0c4fff011b63d4`.
Jeho stav zůstává `CONTRACT_FOR_REVIEW / NO_BINDING_CHANGE`. Nezávisle ověřená
shoda běžného CHAT promptu tohoto kandidátu a `bc3471da`:
`CONVERSATIONAL_SYSTEM_PROMPTS` block SHA256
`c3181fd658e99d6bbe14eff3c2a340bf1dfb407869554290e558355358a9cec1`.
Číselné výsledky Huntu v kontraktu jsou převzaté revizní podklady; tento WP
nepřepočítával matici ani kvalitu modelů.

Nové rozhodnutí operátora pro styl/default/vlastní prompt po releasu je v
[doplnění](2026-10-10-HUNT-CHAT-OPERATOR-ADDENDUM.md). Sestava, sdílené dvojice,
ústupky a kontext 64k/96k/128k se tím neaktivují. W1–W4 návrhu zůstávají
samostatnou kvalitativní/provozní kampaní; zde se nedokládá jejich přejímka.

Discord/Telegram jsou ve scope před vydáním podle aktualizovaných PRODUCT a
DIRECTION. API a integrační kontrakty jsou ověřené, **skutečné doručení nebylo
provedené**. GPU Hunt, HW strop kontextu, nové bindingy a sealed kvalita také
nebyly spouštěné. Hold
`~/.local/state/intentsmith/code-pilot-automation-hold.json` je zachovaný;
zařazení úkolu v IDE za těchto podmínek nezakládá jeho provedení.

Příští krok: Opus posoudí publikovaný kandidát, bod f), tři importní hrany a
výše uvedené limity. Worker provede finální opravy až podle tohoto verdiktu a
na novém aplikačním SHA zopakuje dotčené brány. Nejde o merge do main,
deployment, Gate 0 ani konečnou přejímku operátora.


Aktualizace 10. 10.: nezávislý Claude (Opus) posoudil `230f657f`, verdikt
NEEDS_CHANGES; tři nové importní hrany schválil. Přesný posudek a následné
opravy jsou v [novém paketu](ide-integration-remediation-20261010.md).
Staré výsledky uvedené výše platí pouze pro své připnuté revize.
