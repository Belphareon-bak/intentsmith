# Dokumentace IntentSmithu

Tento index odděluje návod k použití, autoritativní produktové dokumenty,
měřenou technickou realitu a historii. Pokud se dokumenty rozcházejí, použijte
pořadí autority níže; starý detail nikdy nepřebíjí aktuální měření.

## Začínám jako uživatel

1. [README](../README.md) — co IntentSmith je, současná zralost a rychlý start.
2. [Instalace](INSTALL.md) — prerekvizity, instalace, start a troubleshooting.
3. [Používání](USAGE.md) — Studio, chat, projekty, API, data a omezení.

IntentSmith zatím nemá stabilní 1.0 release. Uživatelské návody popisují
současný vývojový checkout a otevřeně uvádějí nehotové production hranice.

## Autoritativní dokumenty

Čtou se v tomto pořadí:

1. [PRODUCT.md](../PRODUCT.md) — uživatel, problém, scope a definice hotové 1.0.
2. [DIRECTION.md](../DIRECTION.md) — evoluce z C3 a rozhodnutí operátora.
3. [CONTRACT.md](../CONTRACT.md) — závazná pravidla vývoje a evidence.
4. [ROADMAP.md](../ROADMAP.md) — závislosti, milníky a aktuální pořadí.
5. [SYSTEM-MAP.md](../SYSTEM-MAP.md) — naměřený stav schopností a kódu.

[AGENTS.md](../AGENTS.md) a [CLAUDE.md](../CLAUDE.md) jsou pouze vstupní
ukazatele. Nejsou samostatnou autoritou.

## Technická práce

| Potřeba | Zdroj |
|---|---|
| Změřit konkrétní schopnost | příslušný soubor v [inventory/](inventory/) |
| Zkontrolovat Studio build/runtime | [inventory/21-studio-ws.md](inventory/21-studio-ws.md) |
| Zvolit správné testy ke změně | [dev-checklist.md](dev-checklist.md) |
| Zkontrolovat testový stav | [convergence/TEST-REGISTRY.md](convergence/TEST-REGISTRY.md) a `tests/registry.json` |
| Pochopit historickou architekturu | [ARCHITECTURE.md](ARCHITECTURE.md), vždy proti `SYSTEM-MAP.md` |
| Práce s lifecycle | [PROJECT-SYSTEM.md](PROJECT-SYSTEM.md) |
| Storage a persistence | [STORAGE-ARCHITECTURE.md](STORAGE-ARCHITECTURE.md) |
| CRE authority | [AUTHORITY.md](AUTHORITY.md) |
| WebSocket protokol | [WS-PROTOCOL.md](WS-PROTOCOL.md) |
| Nástroje | [tools/REGISTRY.md](tools/REGISTRY.md) a [tools/EXECUTOR_CONTRACT.md](tools/EXECUTOR_CONTRACT.md) |

Detailní modulové dokumenty jsou užitečné pro trace, ale mohou obsahovat C3
názvy nebo historické počty. Aktuální claim vždy ověřte proti kódu,
`SYSTEM-MAP.md` a příslušné inventuře.

## Review a rozhodovací podklady

`review/` obsahuje cílené read-only analýzy, například auth matrix, outbound
census, secret types a specialist boundary. Jsou důkazem pro konkrétní
rozhodnutí; samy nemění produktový kontrakt ani disposition.

## Historie

- `archive/` — staré návrhy a implementované RFC;
- `convergence/` — historická a release evidence;
- staré roadmapy uvnitř `docs/` — reference k C3, nikoli aktuální pořadí práce.

Historické výsledky se nemažou ani nepřepisují na zeleno. Pro současný stav
slouží root [SYSTEM-MAP.md](../SYSTEM-MAP.md).

## Jak dokumentaci udržovat aktuální

- Uživatelské návody neuvádějí rychle zastarávající počty testů nebo PASS;
  ty patří do registru a měřené evidence.
- Změna installeru, `.env.example`, endpointu nebo podporované platformy musí
  ve stejném commitu upravit `INSTALL.md` nebo `USAGE.md`.
- Nový produktový claim musí odkazovat na aktuální `SYSTEM-MAP.md`, inventuru
  nebo reprodukovatelný test. Historická evidence zůstává historická.
