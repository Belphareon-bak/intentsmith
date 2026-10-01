# IntentSmith — publikace zdrojů a podklad pro pozdější úklid Gitu

**Read-only snapshot 1. 10. 2026, 05:26 UTC.** Výchozí integrační commit pro
tento dokument je `f5ca79a9d9c4f65c753ae7dc9e5a3e656e2df687`. Inventář
zachycuje pohyblivý lokální stav; žádné worktree, refy, procesy ani data nebyly
v rámci auditu odstraněny nebo přepnuty. Tento záznam není oprávnění k mazání.

## Publikovaný zdroj a soukromé podklady

| Vrstva | Ověřená identita | Závěr |
|---|---|---|
| GitHub `origin/main` | `838b8cee038db027691072d293eb00153854f81e` v lokálním remote-tracking snapshotu | Starší společný základ; současné chatové změny v něm nejsou. |
| `origin/work/real-chat-journeys-20260930` | `git ls-remote --heads origin work/real-chat-journeys-20260930` vrátil přesně `77672c2ce1bb503483f72ab559b17e1a2b46c714` | Čistý integrovaný checkpoint je zveřejněný pro review; není tím přijatý ani nasazený. |
| Lokální navazující kandidát | `f5ca79a9d9c4f65c753ae7dc9e5a3e656e2df687` | Obsahuje opravu opakovaného uložení. V době snapshotu nebyl ověřený na vzdálené větvi; nový celý profil a fyzická přejímka čekají. |
| Místní instalace | backendová systemd služba spouští `c84b88cd`; poslední doložený frontend je `fddfe996` | Publikace vývojové větve nezměnila běžící release. GPU Hunt timer je vypnutý. |

Pushnutá integrační větev obsahuje sledované zdroje, testovací manifest,
53případový chatový korpus, mobilní klient a Android shell, prototyp Studia 2
i verzované přehledy v `docs/review/evidence/`. Změna `origin/main...77672c2c`
má 393 cest. Přítomnost zdroje v Gitu dokládá dostupnost pro review, nikoli
úspěšný build, modelovou kvalitu ani release acceptance.

`.intentsmith-artifacts/` a `data/*.db*` jsou podle `.gitignore` soukromé;
živá databáze, provider capture, raw odpovědi, privátní prompt a běhové logy
se do Git commitu nepřidávají. Veřejný podklad tvoří úzké souhrny se source
SHA, stavem, počty a hashem privátního artefaktu. Například profil na
`bf7dc31f` má `402 PASS / 0 FAIL/BLOCKED/TIMEOUT/SKIPPED` a SHA-256 reportu
`1da328d78260da370fb999485696202a6f73e99ba9c383aa4d896110299bbdef`;
fyzický M3 pětiminutový soak má `PASS` a SHA-256 privátního záznamu
`b76226846566f644b5729f1beee43398a7e56e39469964a15912fbbb0cb4f763`.
Raw evidence zůstává lokálně; samotný hash ji nenahrazuje.

## Co ještě brání tvrzení „vše na Git remote“

Na předchozím checkpointu `77672c2c` bylo pomocí
`git rev-list --count --all --not --remotes=origin` napočteno **514** commitů
dosažitelných lokálními refy, nikoli lokálními remote-tracking refy. Po
navazujících trial commitech a založení tohoto dokumentačního worktree bylo
v 05:26 UTC naměřeno **517**. Číslo je snímek grafu commitů, nikoli počet
nepublikovaných unikátních funkcí: některé delty už mohou být integrovány
cherry-pickem pod jiným SHA. Refy jiných vlastníků se nesmí plošně pushovat
ani zahazovat. Před tvrzením o úplné publikaci je nutný nový inventář,
porovnání patchů a ověření přesného remote SHA po integraci.

## Bezpečné skupiny worktree pro poslední milník

`git worktree list --porcelain` v 05:26 UTC ukázal **67** worktrees a lokální
inventář **205** větví (`140` remote-tracking větví). Skupiny jsou podle
pracovního stavu a dosažitelnosti přes lokální `origin/*`, nikoli podle vlastníka:

| Skupina | Počet | Zacházení |
|---|---:|---|
| Dirty | 6 | **HOLD.** Hlavní checkout má neprokázaného vlastníka; další zahrnují aktivní trial/Gate 0, běhový test a starší M6/mobile práci. Konflikty ani untracked důkazy nemaž. |
| Čisté s tipem nedosažitelným z `origin/*` | 13 | **HOLD.** Nejdřív doložit vlastnictví, patch ekvivalenci, review a zda commit nebyl již přenesen pod jiným SHA. |
| Čisté pushnuté mimo současnou integraci | 20 | **HOLD.** Každý tip má samostatnou věcnou linii; porovnat s finální integrační větví. |
| Čisté pushnuté v historii integrace | 28 | **PODKLAD K POSOUZENÍ.** Jedenáct jsou release checkouty a zůstávají **HOLD**. Zbývajících sedmnáct běžných worktrees lze posoudit individuálně až po zmrazení zdroje, kontrole vlastníka/procesu a uchování důkazů. |

Ani pushnutý tip s čistým stromem sám nedokazuje, že worktree nikdo nepoužívá
nebo že neobsahuje lokální ignorované důkazy. Staré `recovery/*`, historické
review refy a release checkouty vyžadují samostatné rozhodnutí o retenci.
Nejprve dokončit integraci, testy, review a ověření remote; potom znovu
inventarizovat HEAD, dirty status, vlastníka, procesy, ignorované důkazy
a unikátní commity každého kandidáta. Teprve poté může vzniknout přesný
seznam k odstranění. **Dosavadní úklid: žádné odstranění.**
