# WP — projektová expertiza s finálním modelem v M1 chatu

**Stav 2026-09-30:** implementační kandidát. Deterministický průchod se
skutečným M1 HTTP serverem, soukromou SQLite a řízeným providerem prošel
1/1. Živý modelový průchod je `LIVE_NOT_RUN` kvůli obsazenému GPU hodnoticímu
slotu. Nezávislé review, Gate 0 a release přejímka ještě neproběhly;
`lastGreen` živé sady zůstává `null`.

**Autorita a vstup:** explicitní zadání operátora ověřit chat napříč různými
projekty a expertizami skutečným modelem. Kandidát vznikl ve vlastním worktree
`/home/belphareon/Projects/intentsmith-chat-live-expertise-20260930` na
větvi `work/chat-live-expertise-20260930` z čistého commitu
`09247504143ac0a37d75d7d52867768447790ad2`. Po integraci je nutný nový
živý běh a nové review na přesném integračním SHA.

**Vlastnictví:** `tests/chat-project-expertise-model-contract.test.js`,
`tests/chat-project-expertise-live.test.js`, společná podpora
`tests/helpers/chat-project-expertise-model-journey.js`, jejich řádky v
`tests/registry.json`, generovaný `docs/convergence/TEST-REGISTRY.md` a tento
WP. Produkční zdroj, vazby modelových rolí, služba, systémová DB ani jiné
worktree se nemění.

**Průchod a oracle:** dva testem vytvořené soukromé projekty obsahují různé
soubory `README-A.md` a `README-B.md` a různé kódy
`ORION_A_FILE_391`/`LYRA_B_FILE_752`. Kódy nejsou v zadání ani v popisu
projektu. Test použije `POST /api/projects/open-folder`, `POST
/api/conversations`, `GET/PUT /api/conversations/:id/expertises` a tři M1
`POST /api/chat` zprávy A→B→A s odlišnými `requestId` a trvalými
`conversationId`. Projektový handler sestaví analýzu souboru a aktivní
`developer` nebo `writer` pravidlo; `generateProjectDiscussion` odešle
rozpočtovaný JSON prompt na roli D1. Oracle čte **finální** `/api/chat`
požadavek providera: přesné bajty vlastního souboru a pravidla expertizy musí
být přítomné, cizí kód, soubor a pravidlo nesmí být přítomné. Odpověď M1
musí obsahovat vlastní kód bez cizího. Na konci se ověří každá uložená
asistentská odpověď v obou konverzacích. Negativní mutace oracle odmítají
cizí bajty vydávané za vlastní soubor, záměnu pravidla a kontaminovanou
odpověď.

**Dva druhy důkazu:** deterministická sada používá vlastněný loopback fake
provider, který vrátí jen kód skutečně přítomný v `analysis.excerpts`
finálního požadavku. Dokládá trasu M1, izolaci projektů, výběr expertizy,
trvalost historie a sílu oracle, nikoli chování reálného modelu. Živá sada
vede produkt přes soukromý `provider-capture` proxy na lokální Ollama;
proxy synchronně uloží finální požadavek a terminální odpověď před jejich
předáním produktu. Vyžaduje právě jeden úspěšný modelový požadavek na tah,
kladné `prompt_eval_count`, `done_reason=stop`, identitu modelu a shodu
skutečné M1 odpovědi s terminálním výsledkem. Očekává přesné kódy i v
modelových odpovědích; neúspěch zůstane FAIL a nepřepíše se na PASS.

**Modelový profil a hranice:** `model`, pouze loopback, izolovaná DB a server,
Ollama + GPU, bez fallbacku. Před prvním požadavkem se získá globální
GPU evaluation lock, ověří se prázdná Ollama rezidence a žádný cizí NVIDIA
compute proces, dostupná RAM/disk a nainstalovaný
`qwen3.5:27b@sha256:7653528ba5cba4dd8e19da24aaddc7f4d0b5ecd93571c0825dfd4137958ec06e`.
Proxy dovolí jen tento model a `num_ctx <= 4096`; produkt pro D1 dostane
stejný model přes izolované prostředí. Registr nemá `modelFixture`, protože
jeho čtecí preflight vyžaduje **již zavedený** model, zatímco tato sada
vyžaduje před vlastním získáním GPU prázdnou rezidenci. Pinned identitu a
zdroje proto fail-closed hlídají živý preflight a proxy. Terminální Ollama
odpověď může vynechat digest obsloužené instance; důkaz v tom případě
spojuje nainstalovaný digest, přesný název terminálního modelu a záznam
finálního požadavku, nikoli nezávislý digest terminální instance.

**Spuštění po uvolnění GPU slotu** v tomto čistém commitnutém checkoutu
(Node 24 je potřebný pro lokální `better-sqlite3` ABI):

```sh
export PATH=/home/belphareon/.nvm/versions/node/v24.21.0/bin:$PATH
KEEP_TEST_RUNTIME=1 INTENTSMITH_TEST_SOURCE_REVISION=$(git rev-parse HEAD) \
  node --test tests/chat-project-expertise-model-contract.test.js
INTENTSMITH_CHAT_EXPERTISE_LIVE=1 KEEP_TEST_RUNTIME=1 \
  INTENTSMITH_TEST_SOURCE_REVISION=$(git rev-parse HEAD) \
  node --test tests/chat-project-expertise-live.test.js
```

Živý test bez explicitního přepínače selže jako `LIVE_NOT_RUN`. Se špinavým
checkoutem nebo nesprávným SHA selže před GPU požadavkem. Pokud je GPU lock
obsazený, nebo preflight neprojde, model se nespustí. Test spouští a zastaví
jen vlastní server/proxy; lease se uvolňuje i při chybě. Nepoužívá běžící
produkční server ani DB.

**Artefakty a rozhodnutí:** přímý běh s `KEEP_TEST_RUNTIME=1` zachová
soukromý runtime pod `.intentsmith-artifacts/direct-tests/` (`0700`), v něm
provider JSONL a verdiktový JSON (`0600`). Verdikt `PASS` se píše až po
úspěšném uvolnění vlastních procesů a GPU lease a obsahuje přesné source SHA,
model/digest, verzi Ollama, SHA-256 celého JSONL a SHA-256 jednotlivých
požadavků/odpovědí plus projektové a konverzační identity. Zachycený JSONL
obsahuje celý prompt a odpovědi, proto se neposílá do Git repozitáře;
uchovává se lokálně v soukromém runtime. Při selhání může zůstat dílčí
JSONL pro diagnostiku, nikdy ne verdikt PASS. Úspěšný lokální běh stále
není Gate 0 ani důkaz Studio UI; pro přejímku je nutné nezávislé review,
opakování na integračním SHA a odpovídající auditní záznam.
Deterministický artefakt označí commit jen tehdy, když dodané SHA souhlasí
s čistým checkoutem; bez něj nese `direct-run-unattested`.
