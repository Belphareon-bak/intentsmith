# Používání IntentSmithu

Tento průvodce popisuje současný vývojový produkt. C3 Studio je cílové lokální
rozhraní; legacy `/architect` není fallback 1.0. Před prvním použitím dokončete
[instalaci](INSTALL.md).

## 1. Spuštění a ukončení

```bash
./scripts/run.sh
```

Wrapper spustí backend, ověří `/api/health` a otevře C3 Studio. Skutečný port
je v `~/.c3/port`, backend log v `.c3-backend.log`. Produkt ukončujte přes
`Ctrl+C` v terminálu, který spustil wrapper.

Pouze backend:

```bash
./scripts/run.sh --backend
```

Vývojový backend s watch režimem:

```bash
./scripts/run.sh --dev
```

## 2. První konverzace

1. V levém panelu otevřete **Konverzace**.
2. Založte novou konverzaci.
3. Napište `17 * 23`. Výsledek `391` ověřuje deterministickou cestu bez
   závislosti na Ollamě.
4. Položte běžnou znalostní otázku. Ta ověří CRE, lokální model a persistence.
5. Konverzaci znovu otevřete ze seznamu a ověřte, že se historie načetla.

Odpověď dnes přichází jako celek; token streaming není implementovaný
produkční kontrakt. Pokud provider selže nebo je požadavek zrušen, nepovažujte
částečný UI stav automaticky za úspěch — pravdivé error/cancel sjednocení je
aktivní práce M1.

## 3. Práce s existujícím projektem

1. Otevřete **Projekty** a zvolte existující adresář Git repozitáře.
2. IntentSmith vytvoří nebo obnoví projektovou konverzaci.
3. Začněte read-only úlohou, například vysvětlením konkrétního souboru.
4. U změny nejprve požadujte plán a přesný rozsah.
5. Před efektem zkontrolujte cílové cesty a approval; po něm ověřte `git diff`,
   výsledek testu a pracovní strom.

Pro první experiment nepoužívejte nenahraditelný nebo dirty repozitář. Jednotná
effect/approval/audit hranice je cílem M2, ne dokončenou production garancí
současného checkoutu.

### Lifecycle

Projektový lifecycle používá fáze `SPEC → PLANNING → BUILD → REVIEW → CHANGE`.
Je vhodný pro delší práci po milnících, ale jeho úplná Studio user journey a
recovery ještě nejsou přijaty. Stav konkrétní schopnosti je v
[SYSTEM-MAP.md](../SYSTEM-MAP.md).

## 4. Expertizy, skills, specialisté a agenti

- **Expertiza** mění doménový profil odpovědi; sama nemá získat novou pravomoc.
- **Skill** je verzovaný postup s typovanými vstupy, kroky, checkpointy a
  kritérii výstupu.
- **Specialista** skládá expertizu, znalosti a nástroje pro konkrétní doménu.
- **Agent** reaguje na zdroj nebo plán a má vytvořit viditelný výsledek.

Platformy existují, ale jejich produkční hranice nejsou všechny přijaty.
Specialisté mají známé otevřené porušení interní import boundary a agentní
efekty čekají na sjednocenou M2 authority. Při testování proto začínejte
read-only scénářem a kontrolujte log i výsledný stav.

## 5. Lokální API

API je určeno pro lokální klienty. Backend držte na `127.0.0.1`; globální auth
guard a remote boundary nejsou dokončené.

```bash
INTENTSMITH_PORT=$(node -p \
  "JSON.parse(require('fs').readFileSync(process.env.HOME+'/.c3/port','utf8')).port")
INTENTSMITH_BASE="http://127.0.0.1:${INTENTSMITH_PORT}"

curl --fail "${INTENTSMITH_BASE}/api/health"

INTENTSMITH_CONVERSATION=$(curl --fail --silent \
  -X POST "${INTENTSMITH_BASE}/api/conversations" \
  -H 'Content-Type: application/json' \
  -d '{"title":"API smoke"}')

INTENTSMITH_CONVERSATION_ID=$(node -e \
  'const x=JSON.parse(process.argv[1]); console.log(x.conversation.id)' \
  "$INTENTSMITH_CONVERSATION")

curl --fail \
  -X POST "${INTENTSMITH_BASE}/api/chat" \
  -H 'Content-Type: application/json' \
  -d "{\"conversation_id\":\"${INTENTSMITH_CONVERSATION_ID}\",\"message\":\"17 * 23\"}"
```

WebSocket endpoint je `ws://127.0.0.1:<port>/c3/ws`. Protokolová reference je
v [WS-PROTOCOL.md](WS-PROTOCOL.md), ale aktuální runtime chování má přednost
před starším dokumentem.

## 6. Data a soukromí

| Data | Výchozí umístění |
|---|---|
| SQLite stav | `data/c3.db` |
| nové projekty | `projects/` |
| backend log | `.c3-backend.log` |
| runtime port/capability metadata | `~/.c3/port` |
| Studio profil | `${XDG_CONFIG_HOME:-$HOME/.config}/C3 Studio` |
| izolovaný PDF runtime | `${XDG_DATA_HOME:-$HOME/.local/share}/intentsmith/python/pdf` |

`C3_DB_PATH` a `C3_PROJECTS_DIR` mohou umístění změnit. Před ruční manipulací s
SQLite backend ukončete a berte v úvahu WAL/SHM soubory. Současný backup modul
nemá přijatý restore round-trip; důležitá data chraňte nezávislou zálohou.

Uložená settings mohou obsahovat credentials externích služeb. Necommitujte
`.env`, runtime DB, logy ani Studio profil. Známé privacy a secret nálezy jsou
v root `SYSTEM-MAP.md` a cílených dokumentech `docs/review/`.

## 7. Síťové chování

Výchozí backendové online model discovery je vypnuté:

```dotenv
C3_ENABLE_ONLINE_DISCOVERY=false
```

To neznamená, že každá explicitní funkce je offline. Síť mohou použít zejména
webové nástroje, marketplace, HTTP/RSS agent sources, externí notifikace,
vzdálená Ollama nebo uživatelem zapnuté discovery. Zapínejte pouze plochu,
kterou právě potřebujete, a ověřte její cíl i credentials.

## 8. Co je dnes podporované a co ne

| Plocha | Současné postavení |
|---|---|
| Linux + Theia + lokální Ollama | cílová platforma 1.0, stále ve vývoji |
| C3 Studio | hlavní UI; současný vzhled není finální UX kontrakt |
| `/architect` | legacy, ne fallback 1.0 |
| Docker | neověřená legacy cesta, nepodporovaná |
| Remote Companion | samostatný pozdější release |
| Windows/macOS | bez garance 1.0 |
| Setup wizard | mimo scope 1.0 |
| Streaming | není implementovaný produktový claim |

## 9. Diagnostika

```bash
tail -f .c3-backend.log
curl --fail http://127.0.0.1:11434/api/tags
ollama ps
git status --short
```

Při problému zaznamenejte přesný commit, konfiguraci bez hodnot tajemství,
endpoint/journey, očekávaný a skutečný výsledek a exit status testu. Vytištěný
souhrn bez exit statusu není dostatečný důkaz.

Pro vývoj a testování pokračujte [CONTRACT.md](../CONTRACT.md) a
[dev-checklist.md](dev-checklist.md).
