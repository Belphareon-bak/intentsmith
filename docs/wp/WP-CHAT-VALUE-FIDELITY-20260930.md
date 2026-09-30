# WP — ověření číselných hodnot v M1 chatu

**Stav k 30. 9. 2026:** implementační kandidát na větvi
`work/chat-value-fidelity-20260930`, založený z čistého
`a9fec745fd47258ec6e0aafcda55c67c34cbbdb6`. Deterministická sada
se skutečným M1 HTTP serverem a soukromou SQLite prošla. Živá modelová sada je
`LIVE_NOT_RUN`; její registr má `lastGreen: null`. Nezávislé review, Gate 0
a release přejímka této změny dosud neproběhly.

**Vstup:** operátor žádá ověřit, že chat vrací platné číselné hodnoty. V
soukromém modelovém běhu `85` na `09247504` byly obě cílové položky přítomné
ve finálním provider promptu, přesto se několik uložených odpovědí mýlilo v
hodnotě, rozdílu nebo směru. Technický PASS naplnění okna tyto sémantické
chyby nevyhodnocoval. Tento WP přidává samostatnou hodnotovou sondu; nemění
produktový routing, modelovou vazbu ani mechanismus auto-contextu.

**Vlastnictví:** `tests/chat-value-fidelity-contract.test.js`,
`tests/chat-value-fidelity-live.test.js`,
`tests/helpers/chat-value-fidelity-journey.js`, jejich registry/exclusion
záznamy, generovaný `docs/convergence/TEST-REGISTRY.md` a tento WP. Vlastní
runtime je pod `.intentsmith-artifacts/direct-tests/`, soubory mají práva
`0700`/`0600`. Falešný i živý test spouštějí pouze svůj M1 server a svůj
provider/proxy, čtou pouze svou SQLite. Produkční služba a DB se nepoužijí.

**Tři případy a orákulum:** jedna M1 konverzace dostane postupně kalibrace
`A=73, B=62` (`A−B=+11`, vyšší `A`), `A=17, B=46` (`−29`, vyšší `B`) a
`A=88, B=88` (`0`, `equal`). Prompt vyžaduje jediný JSON objekt s přesně
`a`, `b`, `delta`, `higher`; čísla musí být celočíselné JSON hodnoty. Orákulum
odmítne chybné znaménko, hodnotu, směr, řetězcové číslo, přidaný nebo
duplicitní JSON klíč i Markdown. Finální `/api/chat` požadavek providera musí
končit poslední uživatelskou zprávou s přesnými bajty právě testovaného
případu; starší shodná zpráva nestačí. Musí obsahovat i deklarovaný rozpočet.
Každá HTTP odpověď
se porovná s terminálním provider výsledkem a následně s HTTP historií i
přímým read-only dotazem do soukromé SQLite.

**Deterministická smlouva:** owned loopback provider vrací podle skutečného
finálního ANSWER požadavku přesný očekávaný JSON. To prokazuje M1 trasu,
provider prompt, orákulum a persistenci; nesmí být interpretováno jako
úspěšná kvalita fyzického modelu. Test zároveň mutuje správnou odpověď na
špatný rozdíl/směr/typ a finální prompt bez dat a vyžaduje odmítnutí.

**Živý profil:** vyžaduje explicitní přepínač, čistý commit a přesné
`INTENTSMITH_TEST_SOURCE_REVISION`, `KEEP_TEST_RUNTIME=1` při přímém běhu,
sdílený globální GPU lease a fail-closed preflight. Ten ověřuje nulovou
Ollama rezidenci, nulové cizí NVIDIA compute, RAM/disk a instalaci
`qwen3.5:27b@sha256:7653528ba5cba4dd8e19da24aaddc7f4d0b5ecd93571c0825dfd4137958ec06e`.
Owned capture proxy dovolí pouze loopback a přesný model. Pro každý tah
ověří `done_reason=stop`, odpověď M1 shodnou s terminální odpovědí,
`num_ctx`, `num_predict`, kladný `prompt_eval_count` a SHA-256 obou
provider zpráv. Číselné chyby se zaznamenají pro všechny dokončené tahy;
verdikt zůstane `FAIL`. GPU lease se uvolní i při chybě.

**Příkazy po integraci na čistém SHA** (Node 24 kvůli `better-sqlite3`):

```sh
export PATH=/home/belphareon/.nvm/versions/node/v24.21.0/bin:$PATH
node --test tests/chat-value-fidelity-contract.test.js
INTENTSMITH_CHAT_VALUE_FIDELITY_LIVE=1 KEEP_TEST_RUNTIME=1 \
  INTENTSMITH_TEST_SOURCE_REVISION=$(git rev-parse HEAD) \
  node --test tests/chat-value-fidelity-live.test.js
```

Živý příkaz se spustí teprve po uvolnění GPU/Ollama slotu. Soukromý JSONL
capture obsahuje prompt a odpovědi, proto není v Gitu; verdikt ukládá
zdrojové SHA, identitu modelu, hash capture, jednotlivé SHA, číselné výsledky
a shodu HTTP/SQLite. Pokud terminální provider odpověď neobsahuje digest,
záznam dokládá instalovaný digest při preflightu a přesnou identitu
terminálního modelu, ne nezávislý digest obsloužených vah.

**Hranice:** tři řízené případy neprokazují obecnou kvalitu chatu, české
volné formulace, odpovědi z projektových souborů, dlouhé konverzace,
auto-context ani mobil. Hodnotový verdikt je oddělený od technického
window-fill důkazu. Živá sada musí po integraci běžet na finálním SHA a její
výsledek musí projít nezávislým review; lokální PASS není Gate 0.
