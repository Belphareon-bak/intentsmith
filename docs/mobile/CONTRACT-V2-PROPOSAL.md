# Kontrakt v2 pro šest domén — NÁVRH k nezávislému review

**Stav:** `NÁVRH` · **Autor:** implementační session · **Datum:** 2026-08-11
**Vstup:** `wp/mobile-refresh-20260809`, revision `42d9c40f`
**Autorizace:** `DR-008` (PLAN.md §5.3) — autorizuje **návrh, review a refreeze**, nic víc
**Určeno:** k nezávislému review; revidovat nesmí autor

---

## 0. Co tenhle dokument je a co není

Je to **jeden společný kontrakt pro šest domén najednou**, jak `DR-008` žádá —
aby nevznikly dílčí kontrakty, které se navzájem neunesou.

**Není to autorizace implementace.** `DR-008` to říká výslovně a platí to i po
schválení: každá fáze potřebuje navíc **příslušnou Gate 1 evidenci a vlastní
Work Package**. Schválení tohoto dokumentu neotevírá ani jednu obrazovku.

**Nepřepisuje rozhodnutí, která už padla.** `R-5` (dělení nastavení) je
uzavřené a závazné, `D-UI-1` zařadilo projekty do produktu, `ADR 0001` určilo
`REMOTE_COMPANION`, Fáze 4 a 5 mají v `PLAN.md` §5 daný rozsah. Tenhle dokument
je **skládá do kontraktu**, nevrací je k diskusi.

Kde jsem nemohl rozhodnout, protože to není odvoditelné z repa, je to v §9 jako
otázka pro review — ne skrytý předpoklad v textu.

---

## 1. Společná pravidla — dědí je všech šest domén

Tohle je důvod, proč se domény projednávají spolu. Kdyby si každá určila
vlastní stránkování nebo vlastní tvar chyby, klient by musel umět šest
protokolů.

### 1.1 Obálka odpovědi

Beze změny proti v1 (`protocol.js`, §8.7): `ok`, `protocolVersion`, `scopes`,
`principalId`, `serverTime`, `data`. Odpověď **vždy hlásí scopes, pod kterými
požadavek skutečně proběhl**, ne ty, které si klient myslí, že má.

### 1.2 Stránkování

Beze změny proti v1 a **bez výjimky pro kteroukoli doménu**:

- kurzor je **neprůhledný a serverem vydaný**; klient si ho nesmí spočítat
  (§8.2). Dnes to hlídá kontrolní součet — to zůstává;
- `hasMore`, `end` a `nextCursor` jsou v obálce, `end` je **potvrzený konec**,
  ne odvozený z počtu položek (§8.6);
- `limit` se ořezává, nikdy neodmítá;
- odmítnutý kurzor → `400 cursor_unknown` s `restart: true` a **pojmenovaným
  důvodem**; klient dělá plný refresh, nikdy dopočet;
- kde má obrazovka začínat na konci streamu (jako historie konverzace), používá
  se `anchor` s kurzorem mířícím zpět — mechanismus je hotový a ověřený
  (`MR-05`), nové domény ho **přebírají, nevymýšlejí znovu**.

### 1.3 Chyby

Uzavřený slovník z `MOBILE_ERRORS`. Nová doména **nesmí zavést nový kód chyby**,
aniž ho tenhle kontrakt vyjmenuje. Doplňují se dva, oba už používané `MR-05`:

| Kód | Kdy |
|---|---|
| `bad_request` s `reason` | parametr, kterému server nerozumí — **nikdy se tiše neignoruje** |
| `cursor_unknown` s `restart` | kurzor, který server nevydal |

### 1.4 Scopes

Každá doména má **čtecí a zapisovací scope zvlášť**. Čtení bez zápisu je platný
stav a obrazovka v něm musí být použitelná, ne zamčená.

| Doména | Čtení | Zápis |
|---|---|---|
| Nastavení | `read:settings` | `write:settings` |
| Projekty | `read:projects` | `write:projects` |
| Paměť | `read:memory` | `write:memory` |
| Workeři | `read:workers` | `write:workers` |
| Průběh běhu | `read:runs` | — (jen čtení) |
| Hledání | `read:search` | — (jen čtení) |

`read:projects` už pairing vydává (operátor 2026-08-11); ostatní se přidají do
`PAIRABLE_SCOPES` až s příslušným WP. **Žádný z nich nesmí být dosažitelný
zkratkou přes `admin`** — `FORBIDDEN_SCOPES` platí beze změny.

### 1.5 Klasifikace dat a cache

`I-10` platí pro všechny nové domény: cache je **odvozená a zahoditelná**.
Tenhle kontrakt **nezavádí žádnou čtvrtou výjimku** k dnešním třem (`MD-14`
draft, `MD-15` preference, `MD-19` index operací).

Každá doména níže má řádek **„offline"**, který říká jedno ze tří:

- **čitelné z cache** — s viditelným ukazatelem stáří;
- **nečitelné** — obrazovka to řekne, nezobrazí prázdno;
- **nikdy z cache** — hodnota je autorita a stará odpověď by lhala.

### 1.6 Routy

Kontrakt **jmenuje routy, které doména potřebuje**, ale jejich vznik neautorizuje.
Dnešní 13-route allow-list zůstává platný až do WP, který routu skutečně
implementuje. `PLAN.md` to říká přesně: *„ani budoucí schválení kontraktu samo
neautorizuje implementaci nové routy."*

### 1.7 Co žádná doména nesmí

- vracet data, která nemá odkud vzít, ani jako placeholder;
- mít obrazovku bez datového zdroje (`UI-REVIEW` §3);
- obcházet stránkování „vrátím všechno";
- zapisovat, když má jen čtecí scope;
- být dosažitelná bez spárovaného zařízení.

---

## 2. Doména 1 — Nastavení (Fáze 2, `MR-12`, `MR-13`)

### 2.1 Co je rozhodnuté a co z toho plyne

`R-5` je **uzavřené a závazné** (`PLAN.md` §5.4). Dělení se tímto kontraktem
nemění, jen se přepisuje do wire formátu.

| Na mobil | Desktop-only |
|---|---|
| LLM: model, temperature, context | GPU offload, batch size, threads, NUMA, rope scaling |
| Notifikace: kanály, tichý režim, priority | webhook secret, HMAC, trusted domains |
| Vzhled: téma, font, density | custom CSS injection |
| Paměť: LTM on/off, threshold | eviction strategy, hard token caps |
| Systém: jazyk, časová zóna, měna | worker threads, DB vacuum, log retention |
| — | **celá Security sekce** a Feature flags |

**Invariant `R5-1`..`R5-5` platí jako filtr na serveru, ne jako skrývání
v UI.** Desktop-only klíč se přes `/m1` nesmí ani přečíst — jinak je to jen
schované, ne oddělené.

### 2.2 Tvar

Nastavení je **plochý seznam klíčů**, ne strom. Každý klíč nese svůj typ a
rozsah, aby klient uměl postavit ovládací prvek, aniž by o klíči věděl předem:

```
{ key, section, label, type, value, default, editable, constraint }
```

`type` z uzavřeného seznamu: `bool`, `int`, `float`, `enum`, `string`.
`constraint` nese meze (`min`/`max`/`step`/`options`) — bez toho by klient
validoval odhadem a server by odmítal až po odeslání.

`editable: false` je platný stav: klíč, který je vidět, ale mění se jen
z desktopu.

### 2.3 Zápis

Zápis je **po jednotlivých klíčích**, ne dávkou celého objektu. Dávka by při
konfliktu přepsala i to, co uživatel neviděl.

Konflikt řeší `version` u klíče: zápis nese verzi, kterou klient četl, a server
odmítne `409 state_conflict`, když se mezitím změnila. Klient pak **ukáže
serverovou hodnotu**, nepřepíše ji potichu.

### 2.4 Routy, offline

| | |
|---|---|
| Routy | `GET /m1/settings`, `PATCH /m1/settings/:key` |
| Scope | `read:settings` / `write:settings` |
| Stránkování | ne — seznam je krátký a uzavřený; kdyby přerostl, přidá se podle §1.2 |
| Offline | **čitelné z cache** s ukazatelem stáří; zápis offline nejde a řekne se to předem |
| Obrazovky | `MS-10`, `MS-11` |

**Co v doméně není:** cokoli z pravého sloupce `R-5`, a `MD-15` lokální
preference — ty jsou zařízení, ne účtu, a na server nepatří.

---

## 3. Doména 2 — Projekty (Fáze 3B, `MR-14`)

### 3.1 Co je rozhodnuté

`D-UI-1`: projekty patří do produktu. Nález `F-055` **není odložený ani
odstraněný** — dnešní backend projektová data nemá, takže tenhle kontrakt je
zároveň zadáním, co musí vzniknout na serveru.

### 3.2 Tvar

```
projekt = { id, name, state, createdAt, updatedAt, conversationCount, openApprovalCount }
```

`state` z uzavřeného seznamu **`active` | `preparing` | `done` | `archived`** —
`UI-REVIEW` §2 označilo `Aktivní`/`V přípravě`/`Dokončeno` za čitelný stavový
slovník; `archived` doplňuji, protože bez něj nemá seznam co dělat se starými
projekty a začne se filtrovat po klientovi.

**Pole, která návrh obrazovek chtěl a která tenhle kontrakt vědomě NEZAVÁDÍ:**
`Popis`, `Cíl`, `Vlastník`, záložky `Soubory`, `Úkoly`, `Nastavení` projektu
a `2 běžící úkoly`. Nemají zdroj a `UI-REVIEW` §3.1 je jmenuje. Zavést je smí
až rozšíření tohoto kontraktu, ne obrazovka.

### 3.3 Vazba na konverzace

Konverzace dostává **volitelné** `projectId`. „Mimo projekt" je `null`, ne
zvláštní projekt — jinak by šel smazat.

Seznam konverzací umí filtr `?projectId=`; **filtr nikdy nemění stránkovací
kontrakt** (§1.2).

### 3.4 Routy, offline

| | |
|---|---|
| Routy | `GET /m1/projects`, `GET /m1/projects/:id` |
| Scope | `read:projects` (dnes vydávaný, obrazovka se nestaví) |
| Stránkování | ano, podle §1.2, řazení `updatedAt DESC` |
| Offline | **čitelné z cache** s ukazatelem stáří; počty se offline neukazují, protože stárnou jinak než seznam |
| Obrazovka | `MS-12` — **nestaví se do WP a Gate 1** |

**Zápis (`write:projects`) tenhle kontrakt nezavádí.** Zakládání a editace
projektu z telefonu je samostatné rozhodnutí; `PLAN.md` §5 vede vytváření
agentů a podobné za 1.0 a projekty patří do stejné třídy.

---

## 4. Doména 3 — Paměť (Fáze 4, `MR-17`, `MR-18`)

### 4.1 Co je rozhodnuté

`PLAN.md` §5: **LTM a task memory read-only, ruční poznámka.** Operátor
2026-08-11 navíc rozhodl, že **paměť není vlastní sekce, ale je pod Nastavením**
— v liště tedy nemá položku a v `UI-DESIGN` §3.1 je vedená jako karta Nastavení.

### 4.2 Tvar

```
záznam = { id, kind, text, source, createdAt, lastUsedAt, strength }
```

`kind`: `ltm` | `task`. `source` říká, **odkud se to vzalo** — z konverzace,
z běhu, nebo ručně; bez toho uživatel nemá jak posoudit, proč si to systém
pamatuje. `strength` je hodnota, kterou počítá server (LTM decay), klient ji
jen zobrazuje a **nikdy nedopočítává**.

### 4.3 Co smí telefon měnit

Jen dvě věci, obojí `write:memory`:

- **přidat ruční poznámku** (`kind: manual`);
- **smazat záznam**, který si vyžádal.

**Editace existujícího záznamu ani změna `strength` v kontraktu není.** Ladit
paměť z telefonu je přesně ta třída akcí, kterou `R-5` drží na desktopu.

### 4.4 Routy, offline

| | |
|---|---|
| Routy | `GET /m1/memory`, `POST /m1/memory`, `DELETE /m1/memory/:id` |
| Scope | `read:memory` / `write:memory` |
| Stránkování | ano, §1.2; řazení `lastUsedAt DESC` |
| Offline | **čitelné z cache**; zápis a mazání offline nejde |
| Obrazovka | karta pod `Nastavení` |

---

## 5. Doména 4 — Workeři (Fáze 5, `MR-19`, `MR-20`)

### 5.1 Co je rozhodnuté

`PLAN.md` §5: **stav agentů, historie, dry-run. Bez vytváření agentů.**

### 5.2 Tvar

```
worker = { id, name, kind, state, lastRunAt, lastRunOutcome, enabled }
```

`state`: `idle` | `running` | `failed` | `disabled` — uzavřený seznam, a
`failed` v něm musí být, jinak se rozbitý worker tváří jako nečinný.

### 5.3 Co smí telefon

- **zapnout a vypnout** workera (`write:workers`);
- **spustit dry-run** — běh, který **nic nemění** a jehož výsledek je text.

**Ostrý běh z telefonu tenhle kontrakt nezavádí.** Dry-run je bezpečný, protože
nemá efekt; ostrý běh je mutace s dosahem, který se z telefonu neposoudí.

Dry-run se řídí `MD-19`: nese **klíč operace**, aby šel bezpečně zopakovat, a je
vidět v žurnálu jako každá jiná mutace.

### 5.4 Routy, offline

| | |
|---|---|
| Routy | `GET /m1/workers`, `PATCH /m1/workers/:id`, `POST /m1/workers/:id/dry-run` |
| Scope | `read:workers` / `write:workers` |
| Offline | seznam **čitelný z cache**; `state` **nikdy z cache** — běží/neběží je autorita, stará odpověď by lhala |
| Obrazovka | Fáze 5 |

---

## 6. Doména 5 — Průběh běhu (`MR-07`)

### 6.1 Proč je tahle doména jiná

U ostatních pěti jde o tvar dat, která existují nebo mají vzniknout. Tady je
otevřená **sama existence pravdivého zdroje**, a `PLAN.md` §5.1 to říká přímo:
blokující `/m1/chat` ani žurnál operací **nejsou agent log** — jedno je jedna
odpověď najednou, druhé evidence pokusů o mutaci. Ani dohromady nedávají průběh.

Dnešní `/m1` navíc **nemá WebSocket ani SSE** a je pull-only.

### 6.2 Co kontrakt požaduje po serveru

Aby doména vůbec šla dodat, musí na serveru vzniknout **typovaný proud událostí
běhu** s těmito vlastnostmi:

1. **Trvanlivý.** Událost přežije odpojení klienta. Bez toho je „průběh"
   dostupný jen tomu, kdo se dívá, a reconnect je ztráta.
2. **Sekvenčně očíslovaný** monotónně rostoucím `seq` **s unikátní garancí** —
   `F-015` ukazuje, co dělá `MAX(seq)+1` bez ní.
3. **Uzavřený slovník typů událostí.** Klient nesmí dostat typ, který nezná,
   a tvářit se, že mu rozumí.
4. **Ukončený.** Běh má koncovou událost s výsledkem; „přestalo přicházet" není
   konec.

```
událost = { runId, seq, at, type, level, text, meta }
```

`type` z uzavřeného seznamu, minimálně: `started` | `step` | `tool` |
`warning` | `error` | `finished`.

### 6.3 Čtení a obnova

Pull podle `seq`, stejným způsobem jako inbox: `GET /m1/runs/:id/events?afterSeq=`.
**Reconnect je dotaz na `afterSeq`, ne nové připojení** — proto ta trvanlivost
v §6.2 bodu 1. Realtime push je mimo tenhle kontrakt.

`GET /m1/runs` vrací běhy podle §1.2, `state` z `running` | `finished` | `failed`.

### 6.4 Co je zakázané a proč

**Žádné procento hotovo.** `UI-REVIEW` §3.3 a `D-UI-4` to už rozhodly: procento
potřebuje známý celek a ten neexistuje. Na jeho místě je `RunSilence` —
uplynulý čas, který telefon vlastní, a nic dalšího.

| | |
|---|---|
| Routy | `GET /m1/runs`, `GET /m1/runs/:id`, `GET /m1/runs/:id/events` |
| Scope | `read:runs` |
| Offline | **nečitelné.** Průběh je o tom, co se děje teď; z cache by to byla lež. Obrazovka to řekne |
| Obrazovka | `MS-15` — **nestaví se** |

---

## 7. Doména 6 — Hledání (`MR-10`)

### 7.1 Co je rozhodnuté

`PLAN.md` §5.1 a `D-S3`: **lokální hledání nad načteným oknem požadavek
nesplňuje.** Uživatel, který nenajde zprávu, z toho nesmí usoudit, že
neexistuje. Hledání je proto **serverové, nebo žádné**.

### 7.2 Rozsah — a proč je tohle jádro domény

Hledání musí **vždy vědět a říct, kde hledalo**. Odpověď proto nese rozsah
zpátky:

```
{ query, scope, truncated, results: [...], nextCursor, end }
```

`scope` je uzavřený seznam: `conversations` | `projects` | `memory`. Klient si
vybírá z toho, na co má scope; server **nikdy nehledá v tom, na co uživatel
nemá právo**, a výsledek to přiznává.

`truncated: true` znamená „našel jsem víc, než vracím" a je to **jiný stav než
`end`**. Bez toho vypadá ořezaný výsledek jako úplný.

### 7.3 Autorizace a klasifikace

Výsledek nese **jen to, co uživatel smí vidět bez dalšího dotazu**: identifikátor,
titulek, kontextový úryvek a odkaz. **Nikdy celý obsah** — jinak by hledání
obešlo scope na detail.

### 7.4 Routy, offline

| | |
|---|---|
| Routa | `GET /m1/search?q=&scope=&cursor=` |
| Scope | `read:search` **plus** čtecí scope každé prohledávané domény |
| Stránkování | ano, §1.2 |
| Offline | **nečitelné.** Hledání v cache je přesně ta past z §7.1; obrazovka to řekne a nenabídne náhradu |
| Obrazovka | `MS-09` — **nestaví se** |

---

## 8. Routy, které kontrakt požaduje

Souhrn. **Vznik žádné z nich tenhle dokument neautorizuje** (§1.6).

| Doména | Routy | Scope |
|---|---|---|
| Nastavení | `GET /m1/settings`, `PATCH /m1/settings/:key` | `read/write:settings` |
| Projekty | `GET /m1/projects`, `GET /m1/projects/:id` | `read:projects` |
| Paměť | `GET /m1/memory`, `POST /m1/memory`, `DELETE /m1/memory/:id` | `read/write:memory` |
| Workeři | `GET /m1/workers`, `PATCH /m1/workers/:id`, `POST /m1/workers/:id/dry-run` | `read/write:workers` |
| Průběh | `GET /m1/runs`, `GET /m1/runs/:id`, `GET /m1/runs/:id/events` | `read:runs` |
| Hledání | `GET /m1/search` | `read:search` + doménové |

**13 + 14 = 27 rout.** To je víc než dvojnásobek dnešního povrchu a je to samo
o sobě věc k posouzení v review, ne detail.

---

## 9. Otevřené body — pro revidujícího

Tohle jsem **nemohl rozhodnout z repa** a neschoval jsem to do textu jako
předpoklad.

1. **`MR-07` možná není dodatelný.** §6.2 popisuje, co musí na serveru vzniknout.
   Jestli to nevznikne, doména 5 se neschválí jako kontrakt, ale jako **zadání
   pro backend** — a Fáze 1 zůstane otevřená dál.
2. **Zápis u projektů** (§3.4) jsem vynechal. Jestli má jít projekt z telefonu
   založit, patří to do kontraktu teď, ne později.
3. **Ostrý běh workera** (§5.3) jsem vynechal ze stejného důvodu.
4. **`archived` u projektů** (§3.2) jsem doplnil nad rámec `UI-REVIEW`. Je to
   moje volba, ne rozhodnutí — bez ní se starý projekt nemá kam podít.
5. **27 rout** (§8). Jestli je to moc, dá se to řešit sloučením
   (`/m1/runs/:id/events` pod `/m1/runs/:id`), ale za cenu horšího stránkování.
6. **`read:search` jako vlastní scope** je moje volba; alternativa je hledat
   bez něj jen v doménách, na které scope je.

---

## 10. Co musí nastat po schválení

Ani schválený a refrozený kontrakt nic neotevírá. Pro **každou** fázi zvlášť:

1. příslušná **Gate 1 evidence**;
2. **samostatný Work Package** s vlastním stropem a definicí hotovo;
3. teprve pak routa, obrazovka a testy.

Zamýšlené pořadí z `PLAN.md` §5.3: **Fáze 2 nastavení → 3B projekty → Fáze 4
paměť → Fáze 5 workeři.** Domény 5 a 6 v tom pořadí **nefigurují** — rozhodnutí
je zařadilo do kola, ne do implementační fronty.
