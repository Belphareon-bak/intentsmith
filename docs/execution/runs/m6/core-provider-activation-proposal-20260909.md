# Ollama response identity — konkrétní návrh provozního kroku

Stav: `PREPARED_NOT_INSTALLED / OPERATOR_WINDOW_REQUIRED`.
Datum inventury: 2026-09-09. Tento dokument nepovoluje aktivaci.

## Problém a připravená změna

IntentSmith požaduje digest modelu skutečně obsluhujícího odpověď. Systémová
Ollama 0.32.14 jej neposkytuje; současné fail-closed chyby jsou popsány v
[model-evaluation-final-integration-20260826.md](../model-evaluation-final-integration-20260826.md).
Pouhé porovnání inventáře před a po dotazu tuto autoritu nenahrazuje.

Připravený kandidát z čistého source
`0cb3844557c2cbf0beac555da0147279eebd9488` doplňuje `Model.Digest` ze stejného
modelu, který `scheduleRunner` předává scheduleru, do běžné i native chat
odpovědi. Změna zachová službu `ollama`, uživatele/skupinu `ollama`, model store
`/usr/share/ollama/.ollama/models`, origin `http://127.0.0.1:11434` a stávající
nativní knihovny. Nemění model bindings, scoring historii ani zapnutí hunt timeru.

| Objekt | Přesná identita SHA-256 |
|---|---|
| Připravený `~/.local/opt/ollama-intentsmith-0.32.14.1/bin/ollama` | `72580ab98c5c82afe9cf73e5b7400b1d3cd94ec0777f961d1aefab878146878a` |
| Původní `/usr/local/bin/ollama` | `d0758d38ac5882a2c68fd930d0c1220af1952469fa9f30c268746d4021709bf4` |
| Původní `/etc/systemd/system/ollama.service` | `e5cab49b2d7316a4f9b333f525034c08f4aca28ea36c585a6b308d671ffd5e4e` |
| Stávající `/usr/local/lib/ollama/llama-server` | `234b05b2138264f8fb263c3205e85f4c290e8afe5067e280a4f6f90cdac5696b` |

Lokální podklady jsou v
`.intentsmith-artifacts/core-completion-20260909/provider-proposal/`.
`manifest.json` navíc připíná 50 položek nativních knihoven; nezávislý reviewer
znovu spočítal všech 54 identit a všechny souhlasily. Candidate binary má
embedded source revision shodnou s čistým checkoutem a `vcs.modified=false`.

Nezávislé statické review a nově zkompilované mock regrese prošly: přesný
source `0cb3844557c2cbf0beac555da0147279eebd9488`, ověřený Go 1.26.7,
`TestChatHandlerChatTemplateRoute` a `TestGenerateChat` včetně 15 subtestů,
exit 0. Testy běžely bez sítě/GPU/živého store v bwrap. Příkazy, izolace a
výstupy jsou v `toolchain/evidence/` pod uvedeným artifact kořenem.
Nejde o nové runtime ověření existující candidate binárky s nativním runnerem.

Finální nový soubor `/etc/systemd/system/ollama.service.d/50-intentsmith-response-digest.conf`
je připravený se skutečnými bajty:

```ini
[Service]
ExecStart=
ExecStart=/usr/local/bin/ollama-intentsmith-0.32.14.1 serve
```

Nová binárka i tento drop-in při inventuře chyběly. Staging unit prošla
`systemd-analyze verify`, ale odkazovala na existující uživatelskou candidate
binárku. Jde o parser/source-executable staging check; ověření finálního
root-owned `ExecStart` musí proběhnout po instalaci a před restartem.

## Přesné pořadí po povolení provozního okna

1. Znovu ověřit všech 54 identit, aktuální unit/drop-in stav, nepřítomnost obou
   cílových souborů, prázdné `/api/ps` a žádný NVIDIA compute proces. Při změně
   identity nebo cizí aktivitě zastavit závislý krok; nic cizího neukončovat.
2. Se správcovským potvrzením vytvořit nový root-only rollback adresář pod
   `/var/backups/` a uložit původní unit, původní binárku, inventář a ověřené
   hashe. Existující cesty se nepřepisují.
3. Nainstalovat přesně připnutou candidate binárku jako nový root-owned `0755`
   `/usr/local/bin/ollama-intentsmith-0.32.14.1` a připravený root-owned `0644`
   drop-in. Původní binárka a hlavní unit zůstávají na místě. Znovu ověřit
   nainstalované bajty a finální unit včetně drop-inu.
4. `systemctl daemon-reload` a `systemctl restart ollama.service`; ověřit
   výsledný `ExecStart`, UID, pouze loopback listener a `/api/version`.
   Při neúspěchu použít níže uvedený rollback a zachovat chybovou evidenci.
5. V tomtéž výslovně povoleném sériovém modelovém okně provést jeden omezený
   `/api/chat` na připnutém existujícím modelu, porovnat response digest se
   skutečným artefaktem, následně ověřit IntentSmith gateway a existující
   typed verification cestu. Uchovat raw request/response identity a stav DB.
   Žádný model se nevybírá ani neaktivuje na základě skóre.
6. `SYSTEM_PROVIDER_BLOCKED` změnit teprve podle této skutečné evidence.
   Úspěšný restart ani statické review tento stav samy neuzavírají. Další
   modelové release testy a 24h soak následují podle přesného M6 plánu.

Rollback: po opětovném ověření přesných vlastních bajtů odstranit pouze nově
vytvořený `50-intentsmith-response-digest.conf`, provést `daemon-reload` a
restart původní služby. Ověřit původní `ExecStart`, binární hash a loopback
health. Ponechat evidence/backup a nepřepisovat DB, model store či bindings.
Návrat na původní provider opět znamená `SYSTEM_PROVIDER_BLOCKED`.

## Autorita a potřebná součinnost

[WP-M6-RELEASE](../../../wp/WP-M6-RELEASE.md) výslovně uchovává operátorský
odklad živých LLM validačních běhů. Přijatý technický scope tohoto běhu
zachovává samostatný checkpoint pro systémovou aktivaci. Je potřeba povolit
tento konkrétní restart a vyhrazené živé modelové okno.

Read-only preflight prokázal UID 1000 a `sudo -n true` skončilo exit 1 s
`a password is required`. `pkexec` je dostupný, ale správcovské potvrzení
nebylo vyžádáno ani uděleno. Autonomní příprava neodstraňuje tuto skutečnou
hostovou hranici. M7 VPN, firewall, TLS/HMAC klíče, telefon, M5 externí rotace,
history disposition a release podpisy nejsou součástí tohoto zásahu.

Alternativa pro jednorázové měření je dosavadní izolovaný sidecar; jeho
výsledek ale neověří systémový origin. Pro core release je proto doporučený
výše uvedený verzovaný systémový provider se zachovanou návratovou cestou.
