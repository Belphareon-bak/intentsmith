# WP-MOBILE-027 — dotažení mobilní aplikace

**Typ:** zapisující WP · **Adresát:** nová session
**Vstupní revision:** `277eae61` · větev `wp/mobile-refresh-20260809`
**Worktree:** `/home/belphareon/worktrees/is-mobile-refresh`
**Nadřazená pravidla:** [`CONTRACT.md`](../../CONTRACT.md) · [`ROADMAP.md`](../../ROADMAP.md)

---

## 0. Strop — co tenhle WP dělat NESMÍ

Přečti si tuhle sekci dřív než cokoli jiného. „Dotáhnout mobilní aplikaci"
**neznamená** vydat vzdáleného companiona.

| Zakázáno | Proč |
|---|---|
| Vzdálený listener, produkční pairing, jakékoli zpřístupnění mimo loopback | `G0-R032` je `LATER_GATE` s podmínkou; ROADMAP §11 staví produkční listener/pairing/UI **až za M6** |
| Změnit `C3_HOST` mimo loopback nebo obejít `requireLegacyLoopbackHost()` | L0-10; legacy API a `/c3/ws` terminál nemají route-level autentizaci |
| Přidat novou `/m1` routu | `PLAN.md`: 13-route allow-list je source-policy-frozen; *„ani budoucí schválení kontraktu samo neautorizuje implementaci nové routy"* |
| Postavit `MS-09` hledání, `MS-15` průběh běhu, `MS-12` projekty | `MR-10`, `MR-07`, `MR-14` jsou `BLOCKED_BY_CONTRACT`; projekty čekají na `DR-008` doménu 2 |
| Zapojit `MobileChannel` do notification routeru | Rozšířilo by produkční povrch před M6 |
| Mergovat tuhle větev do M1 linie | Změní `tests/registry.json` fingerprint, o který se opírá běžící Gate 1 evidence |
| Přepečetit `GATE0_REGISTRY_HASH` v `scripts/nightly-orchestrator.js` | Zapečetění je akt release autority vyhrazený před M6 |

**Když si nejsi jistý, jestli něco spadá pod strop, nedělej to a zeptej se
operátora.** Rozšíření povrchu se špatně vrací.

---

## 1. Kde to je a jak to rozjet

```bash
cd /home/belphareon/worktrees/is-mobile-refresh
npm ci --offline            # 252 balíčků, ~1 s
node tests/mobile-data-model.test.js     # smoke: musí být 41 passed
```

Gateway je **samostatný proces**, nikde se nedrátuje do `src/server.js`:

```bash
npm run mobile:gateway      # src/mobile-gateway.js
npm run mobile:pair         # scripts/mobile-pair.js — QR pro spárování
```

Klient je vanilla-JS PWA v `src/mobile/client/`, žádný build step.

---

## 2. Co je hotové (nepředělávat)

Backend gateway, pairing, žurnál operací, approval lifecycle a PWA klient
**běží a jsou zelené** — 11 sad, 320 testů, 0 selhání na aktuálním kódu.

Klient je jeden soubor `src/mobile/client/app.js` (2 918 řádků), `#app` se
překresluje celý při každé změně stavu. Existující pohledy:

| Funkce | Řádek | Obrazovka |
|---|---:|---|
| `viewPairing` | 585 | `MS-02` |
| `viewConversations` | 725 | `MS-06` |
| `viewChat` | 768 | `MS-07`/`MS-08` |
| `viewNotifications` | 873 | `MS-05` |
| `viewDiagnostics` | 905 | `MS-03` |
| `viewOperations` | 1247 | `MS-20` |
| `viewApprovals` | 1332 | `MS-13` |
| `viewApproval` | 1507 | `MS-14` |
| `viewSession` | 1574 | relace |
| `renderDrawer` | 1590 | **dnešní navigace = drawer** |
| `render` | 1637 | kořenový render |
| `navigate` | 2687 | přepnutí route |

**Chybí:** homescreen `Přehled`, spodní lišta, trust bar jako komponenta,
`RunSilence`. Dnešní `#conn-banner` v `index.html` pokrývá jen zónu 1 trust
baru (spojení), ne zónu 2 (stáří) a 3 (zámek).

---

## 3. Práce v pořadí závislostí

### Fáze A — UI podle přijatých rozhodnutí `D-UI-1..4`

Autorita: [`UI-REVIEW-2026-08-09.md`](UI-REVIEW-2026-08-09.md) §7,
[`UI-DESIGN.md`](UI-DESIGN.md) §3.1–§3.3, §4, §6.5.
Vizuální předloha: čtyři operátorské návrhy, popsané v `UI-REVIEW` §1.

**A1 — trust bar jako komponenta** (`D-UI-2`)

Tři zóny podle `UI-DESIGN.md` §4: spojení · stáří dat · zámek oprávnění.
32 dp pod hlavičkou, obsah **posouvá, nepřekrývá**. Dědí ho každá obrazovka —
požadavek zní, aby „zapomněl jsem ukázat, že je to z cache" **nebyl možný stav
kódu**, ne aby to každý `viewX()` volal ručně. Nastav to tak, že se trust bar
renderuje v `render()` nad výsledkem pohledu.

Prázdný trust bar znamená čerstvá data, online, plný přístup — to je jediný
stav, kdy nic neříká. Nikdy dvě pravdy: při odvolaném zařízení mluví zóna 1
a zóna 2 mlčí.

Dnešní `#conn-banner` do zóny 1 zapoj, nezahazuj — rozlišení `SS-03` offline
vs `SS-08` server neodpovídá je už správně implementované a je to jedna ze tří
záměn, kterým se `SCREENS.md` §2.1 brání.

**A2 — homescreen `Přehled` jako kořen** (`D-UI-3`)

Nový `viewOverview()`. Obsah podle návrhu `homescreen-1_schvaleni-3` pozice 1,
**bez** sekce `Aktivní běhy` s procenty.

Musí splnit **podmínku úplnosti kořene** z `UI-DESIGN.md` §3.2: dlaždice nebo
řádek pro **každou** položku lišty. Dlaždice vedou hluboko (konkrétní projekt,
konkrétní approval), lišta přepíná sekci.

**A3 — posouvací spodní lišta** (`D-UI-3`)

Nahrazuje `renderDrawer()`. Vodorovně posouvatelná, nese všechny dostupné
položky, žádné „Více". Vždy se **vycentruje na zvolenou položku a zvýrazněná
je právě jedna** — nikdy nula, nikdy dvě. Mentální model: prstenec brány.

Na `Přehledu` je **zatažená**; vstup do sekce ji vysune, volba `Přehled` zase
zasune. Vycentrovaná po vysunutí je ta položka, kterou uživatel zvolil na
`Přehledu` — žádná výchozí vycentrovaná položka před první volbou neexistuje.

Pořadí: `Přehled · Konverzace · Projekty · Approvaly · Nastavení`, plus
volitelné moduly, až dorazí jejich capability. Sada se staví z
`/m1/capabilities` (§3.1), ne z konstanty.

Přístupnost: všechny položky patří do accessibility stromu i mimo viewport;
přesun fokusu je odscrolluje do viditelna. Zvýraznění nese **text i tvar**,
ne jen barvu (§10).

`MS-03`, `MS-04` a `MS-20` žijí pod `Nastavením`, které nahrazuje dřívější
samostatnou položku „Stav".

**A4 — `RunSilence` pruh** (`D-UI-4`)

Podle `UI-DESIGN.md` §6.5. Běží a jak dlouho; **žádné procento, žádný odhad**.
Tlačítko „Zjistit stav" provádí výhradně `GET /m1/operations/:id` a smí vrátit
znovu `UNKNOWN`. Falešný progress se nedoplňuje ani dočasně.

### Fáze B — opravy vad (nezávislé na A, lze paralelně)

Tohle jsou **opravy existujícího chování, ne nový povrch** — proto jsou
povolené dnes, bez kontraktního kola.

**B1 — `F-112` HIGH: ACK není izolovaný per zařízení.**
`GET /m1/notifications` filtruje cílené řádky na `principal.deviceId`, ale
`POST /m1/notifications/ack` předá jen seznam ID a SQL aktualizuje `read_at`
pouze podle ID. Zařízení tak může potvrdit uhodnutý cílený řádek jiného
zařízení; broadcast má jedno globální `read_at`. Oprava: predikát na
`device_id` v UPDATE a per-device receipt podle přijatého `DR-012` A.
Negativní test musí prokázat, že cizí ACK selže.

**B2 — `F-015`: závod `MAX(seq)+1`.** Bez `UNIQUE` a bez transakční garance.
Oprava: `UNIQUE` omezení nebo sekvence v transakci; test dvěma souběžnými
zápisy.

**B3 — `F-100`: approval bez autoritativní vazby.** Chybí produkční producent,
TTL autorita a vazba na run/operaci/normalizovaný obsah. Cílový kontrakt je
`R-3`/`DR-011`: **lokální 5 min, vzdálené 15 min**, jednorázový, bez
prodloužení. Hodnota TTL nesmí být v UI natvrdo — přichází ze serveru, protože
serverový čas je autorita (`UI-DESIGN.md` §14). Návrh ukazoval `10 minut`, což
neodpovídá ani jedné straně `DR-011`.

B3 je z trojice největší; pokud se nevejde, udělej B1 a B2 a B3 pojmenuj jako
nedokončené. **Nedeklaruj ho hotovým bez negativního testu.**

### Fáze C — projekty (`D-UI-1`) · **blokované, nezačínat bez operátora**

Operátor rozhodl, že projekty v mobilu být musí. Rozsah je menší, než vypadá:
projektová doména v jádře existuje (`/api/projects`, project lifecycle,
`src/chat/conversation-store.js`) — chybí `/m1` kontrakt, který ji vystaví.
Je to **kontraktní kolo `DR-008` domény 2 plus adaptér**, ne nová funkce.

Kontraktní kolo je samostatná práce a **není součástí tohohle WP**. Do jeho
uzavření se `MS-12` nestaví a `Projekty` v liště zůstávají položkou bez
obrazovky.

---

## 4. Definice hotovo

Pro každou položku fáze A a B platí `CONTRACT.md` §3 krok 4–5:

1. focused **pozitivní i negativní** test — negativní musí selhat, když se
   oprava odstraní (ověř mutací, ne domněnkou);
2. uživatelsky viditelná demonstrace nebo L3 číslo;
3. registrace nové sady v `tests/registry.json` (viz past 6.1);
4. commit s pojmenovaným důkazem — čísla v commit message, ne „funguje".

Objem testů ani délka commit message nejsou důkaz výsledku.

---

## 5. Ověřovací příkazy

Celá baterie, kterou musíš mít zelenou před každým commitem:

```bash
npm run test:mobile                              # 11 sad, dnes 320 PASS
node tests/schema-migrations.test.js             # 38 PASS
node scripts/validate-test-registry.js           # valid, 388 programů
node tests/artifact-validation.test.js           # 151 PASS
node tests/repository-hygiene.test.js            # 1 574 cest
node scripts/module-boundary-ratchet.mjs         # 1043/1043 PASS
node tests/module-boundary-ratchet.test.js       # 13 PASS
```

---

## 6. Pasti, na které jsem narazil — ušetři si je

**6.1 Registr testů je fail-closed.** Nový soubor `tests/*.test.js` shodí
`validate-test-registry.js`, dokud ho nezaregistruješ. Pomocný modul bez
vlastního vstupního bodu patří do `exclusions` s důvodem, ne mezi programy.
Po změně registru **musíš** spustit `node scripts/validate-test-registry.js
--write-doc`, jinak zůstane `docs/convergence/TEST-REGISTRY.md` stale a
validátor to nahlásí.

**6.2 Ratchet vyžaduje přijetí každé hrany zvlášť.** Plošný `--write-baseline`
je odmítnutý. Každý nový import mezi moduly musíš přijmout jednotlivě:

```bash
node scripts/module-boundary-ratchet.mjs --write-baseline \
  --accept-edge "src/a.js -> src/b.js" --accept-edge "…"
```

Navíc to **odmítne běžet na špinavém stromu** — commitni, pak zapiš baseline,
pak commitni baseline. A projdi ty hrany doopravdy: platí, že **žádná hrana
nesmí vést z jádra do `src/mobile/`**. Závislost je jednosměrná a je to jediné,
co dnes drží nulový produkční povrch.

**6.3 Migrace se řadí lexikograficky přes celý název včetně data.** Nová
migrace musí mít prefix vyšší než `2026_08_09_057`. Exportovaný `version`
musí odpovídat názvu souboru a přidej ji do `ALL_MIGRATIONS` a `EXPECTED_TABLES`
v `tests/schema-migrations.test.js`.

**6.4 `artifact-validation` hlídá odvozená čísla.** Změna registru rozbije
počty v kořenovém `README.md` (řádek 10 a 11: celkem a `ACTIVE`/`BLOCKED`/
`KNOWN_DEFECTIVE`/`HISTORICAL`). Změna `RISK-REGISTER.md` rozbije `riskCount`
a `policyCount` v `tests/artifact-validation.test.js`. Obojí je pin, ne vada —
srovnej ho, ale **ověř, že nové číslo je pravdivé**, nesnaž se test umlčet.

**6.5 `nightly-orchestrator-self-test` padá i na čistém HEADu.** Zapečetěná
release policy odmítá non-ACTIVE položky. **Není to tvoje regrese** a neopravuj
to — viz strop §0.

**6.6 Prerekvizitu si test musí vyrobit, ne předpokládat od prostředí.**
Na tomhle stroji běží Ollama, takže test „nedostupný model" bez vlastní
izolace měří skutečné volání a lže o tom, co ověřil.

---

## 7. Co potřebuje operátora, ne agenta

| Věc | Proč |
|---|---|
| Otevření kontraktního kola `DR-008` domény 2 | Fáze C nezačne bez toho |
| Popisek `Chaty` vs `Konverzace` | Návrhy střídají obojí; dokumentová sada používá `Konverzace` |
| Přílohy v chatu | Policy patří k rozhodnutí 021 |
| Merge téhle větve kamkoli | Mění registry fingerprint; strop §0 |

---

## 8. Doporučené pořadí

A1 → A2 → A3 → A4, potom B1 → B2 → B3. Fáze A dá **viditelný výsledek na
telefonu** a je mimo sporné území; fáze B zavírá vady, které dnes brání tomu,
aby se notifikace a approvaly daly prohlásit za pravdivé.

Po každé položce commit s čísly. Nedělej jeden velký commit na konci — tenhle
repozitář se opírá o pojmenovaný důkaz na konkrétním SHA.
