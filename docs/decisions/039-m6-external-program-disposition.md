# 039 — M6 required plán nesmí obsahovat neproveditelný external-network slib

- **stav:** `IMPLEMENTED / RE_REVIEW_REQUIRED`
- **rozsah:** registry, M6 locked plan a hard-blocked síťové prerequisite
- **datum:** 2026-08-27

## Nález

M6 plán správně vybral všechny `ACTIVE + required` položky, ale třináct z nich
mělo `requirements.network = external`. Nightly runner přitom external network
záměrně a bez výjimky hard-blockuje. Úplný candidate by proto konstrukčně
skončil třinácti `BLOCKED`, přestože focused test plánu oslavoval jejich
přítomnost.

První skutečný 24h soak na `1e962692` byl po 655 466 ms řízeně ukončen, jakmile
byl tento rozpor prokázán. Runner zapsal pravdivý `FAIL / SIGTERM`, ověřil čistý
source HEAD a ukončil celý vlastní process group. Tento pokus není a nikdy
nebude vydáván za 24h evidence.

## Disposition podle skutečných bajtů

Devět programů používá přímý ChatController/model pipeline a lokální Ollamu.
Některé jejich prompty mohou zvolit WebSearch, takže pouhé přeznačení registry
by nebylo dostatečným důkazem. Každý z devíti entry pointů proto před importem
produkčního controlleru instaluje test-owned `fetch` boundary. Ta povolí pouze
exact `http://{127.0.0.1,localhost,[::1]}:11434`, čtyři potřebné Ollama endpointy
a jejich přesné HTTP metody, vždy s `redirect: manual`; jiné originy, porty,
credentials, query, endpointy, metody i redirecty odmítne před transportem.
WebSearch tím může pouze projít svou existující fail-closed fallback větví.
Registry síť a fixture se opravují na `loopback / isolated-model-database` a
programy zůstávají `ACTIVE + required`:

- `CHAT-QUALITY`;
- tři `CONV-*` programy;
- pět `EXPERTISE-COMPARISON-*` programů.

Pět programů je skutečně operátorských externích E2E nebo kombinuje required
unit část s volitelným credentialed E2E. Jejich vlastní zdroj buď říká, že bez
externí konfigurace skipují, nebo přímo vyžaduje aktuální veřejný obsah a
operátorské filesystem/toolchain prerequisite.
Required alternativy už existují (`notifications.test.js`,
`workers-phase-b.test.js`, `multi-source-integration.test.js` a M5 outbound
policy). Proto zůstávají registrované a spustitelné, ale jsou přesně
`manual + required:false + external`:

- `E2E-NOTIFICATIONS`;
- `E2E-WORKERS`;
- `E2E-COMPLEX` — jeho A1 explicitně vyžaduje aktuální web search a odkazy,
  B1 čte zdrojový checkout bez ProjectContext authority a export vyžaduje
  operátorsky instalovaný PDF runtime;
- `MULTI-SOURCE-EXTERNAL`;
- `PUSH-CHANNEL`.

Nejde o překlad červeného výsledku na PASS. Tyto programy nejsou důkazem
default local-first releasu bez operátorských credentials a veřejných služeb;
jejich případný ruční výsledek se do M6 required verdictu nepřičítá.

## Trvalý invariant

`validateTestRegistry()` odmítá každý budoucí záznam s kombinací
`state=ACTIVE`, `required=true` a `network=external`. External program musí mít
explicitní operátorskou disposition, nebo jiný spustitelný a pravdivý runtime
kontrakt. Candidate plán dál vyžaduje přesnou množinovou rovnost všech 369
současných `ACTIVE + required` položek; žádný runnable required program se
nesmí ručně vynechat.
