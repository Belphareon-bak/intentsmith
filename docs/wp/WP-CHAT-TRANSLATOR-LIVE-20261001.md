# WP — generativní překladatel přes produktový M1 chat

**Integrační pokračování 1. 10. 2026, 00:22 UTC:** na čistém `c815ec43`
prošel živý M1 překlad s fyzickým `qwen3.5:27b` **1/1**; důkaz leží v
privátním `chat-translator-live-evidence.json` pod
`.intentsmith-artifacts/direct-tests/chat-translator-live.test-RGxNY0/`.
Nezávislá revize společného `12b7726a` poté našla veřejný únik původního
vstupu přes `toolResults[0].data.data.sourceText`, a při provider 503 dokonce
HTTP 200 s raw JSON a `SUCCESS`. Red-first skutečný M1 HTTP/SQLite test
potvrdil oba případy. Lokální oprava ponechává raw výsledek pouze v privátním
provider promptu; veřejný specialistický `toolResults` mimo bezpečný VAT
výpočet nese jen typ nástroje. Při provider 503 nebo `done_reason=length`
vrací terminální M1 chybu 503/502 bez asistenční zprávy v SQLite a bez raw
textu v odpovědi. Přímé testy překladu **3/3** a účetního **2/2** procházejí;
čistý registrovaný commit a nezávislé review této opravy teprve následují.

**Stav 2026-10-01:** implementační kandidát. Deterministický průchod se
skutečným izolovaným HTTP serverem, privátní SQLite a řízeným providerem
prošel 1/1 po opravě registrace. Živý Ollama průchod je `LIVE_NOT_RUN`;
neproběhlo nezávislé review ani přejímka na integrační revizi.

**Autorita a rozsah:** operátor chce ověřit specialisty na reálných příkladech.
Tento WP pokrývá přesně specialistu `translator` a jedno české zadání překladu
do angličtiny. Nepotvrzuje ostatní specialisty, mobilní aplikaci ani Studio UI.
Kandidát je ve vlastním worktree `intentsmith-chat-translator-live-20261001`
na větvi `work/chat-translator-live-20261001`, od čistého rootu `658ba911`.

**Vlastněné cesty:** `specialists/translator/index.js`, jeho
`specialist.json`, `tests/chat-translator-model-contract.test.js`,
`tests/chat-translator-live.test.js`, `tests/helpers/chat-translator-journey.js`,
rozšíření záznamu v `scripts/provider-capture.js`, nové řádky
`tests/registry.json`, generované `docs/convergence/TEST-REGISTRY.md` a tento
WP. Žádná produkční DB, modelová vazba, běžící služba ani cizí worktree.

**Red-first příčina:** `specialistHandler` vyvolá
`specialistRuntime.tryToolExecution`, jeho `ToolExecutor` potřebuje u každého
nástroje `modulePath` a `functionName`. Translator je neregistroval, proto
`loadToolFunction` selhal při importu a handler přešel do nabídky mezery
expertizy. Red-first M1 test zaznamenal 0 provider volání. Oprava přidává
kanonické cesty a exportované funkce oběma translator nástrojům; manifest
ukazuje na stejné skutečné exporty. Nemění obecnou politiku runtime.

**Oracle:** test zvolí specialistu přes `POST /api/chat/specialist`, založí
soukromý projekt a konverzaci, pošle jediný `ConversationCommand` přes
produktové `POST /api/chat`, načte výběr v session a po odpovědi specialistu
zruší. Provider musí vidět personu `Překladatel`, přesnou českou větu,
výsledek `translator.translate` s cílovým jazykem `en` a žádný privátní
marker projektového souboru. Odpověď musí zachovat negaci, jméno `Nora Vela`,
identifikátor `RIGEL_731`, zásilku a archiv; nesmí přidat obsah projektu.
Kontrolují se dvě trvalé zprávy a bajtový snapshot projektu před/po.
Negativní mutace oracle odmítnou chybějící výsledek nástroje, únik projektu,
kladný překlad, pozměněné jméno nebo identifikátor i přidanou druhou větu či
klauzuli. Výstup se ověřuje proti ohraničené gramatice této jedné věty;
přijímá několik běžných aktivních a pasivních anglických variant, ale není
obecným hodnotitelem kvality překladu libovolného textu. Před zpřísněním
oracle prošel nesprávný výstup s větou o smazání lokálních projektů; nový
red-first test jej zachytil.

**Důkazové hranice:** fake provider dokládá produktovou trasu, skutečný
provider payload, stav a sílu oracle, nikoli kvalitu reálného modelu. Živá
sada je opt-in přes `INTENTSMITH_CHAT_TRANSLATOR_LIVE=1`. Vyžaduje čistý HEAD
shodný s `INTENTSMITH_TEST_SOURCE_REVISION`, uchování privátního runtime,
globální GPU lease a preflight bez cizího NVIDIA compute/Ollama rezidenta.
Přes privátní loopback proxy dovolí jen nainstalovaný
`qwen3.5:27b@sha256:7653528ba5cba4dd8e19da24aaddc7f4d0b5ecd93571c0825dfd4137958ec06e`
a `num_ctx <= 4096`. Požaduje jedno úspěšné terminální volání, kladné
`prompt_eval_count`, `done_reason=stop`, modelovou identitu a přesnou shodu
M1 textu s terminálními provider bajty. Provider může vynechat obsloužený
digest; v tom případě důkaz spojuje nainstalovaný digest, terminální jméno
modelu a capture, nikoli nezávislý digest obsloužené instance.

**Spuštění po uvolnění GPU slotu a po nezávislém review** v čistém checkoutu
s Node 24 (lokální `better-sqlite3` ABI):

```sh
export PATH=/home/belphareon/.nvm/versions/node/v24.21.0/bin:$PATH
node --test tests/chat-translator-model-contract.test.js
INTENTSMITH_CHAT_TRANSLATOR_LIVE=1 KEEP_TEST_RUNTIME=1 \
  INTENTSMITH_TEST_SOURCE_REVISION=$(git rev-parse HEAD) \
  node --test tests/chat-translator-live.test.js
```

Bez explicitního přepínače test skončí `LIVE_NOT_RUN`; se špinavým checkoutem
nebo nesprávným SHA skončí před GPU. Po úspěchu se privátní provider JSONL a
verdiktový JSON uloží pod `.intentsmith-artifacts/direct-tests/` s oprávněním
`0600`. Verdikt `PASS` vznikne až po zastavení vlastního serveru, proxy a
uvolnění lease. Zachycené prompty a odpovědi zůstávají lokálně a neposílají
se do Git. Selhání nesmí vytvořit `PASS`. Po integraci je nutné review a živý
průchod zopakovat na přesném integračním HEAD.
