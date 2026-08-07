# Census typů tajemství pro PRIVACY rozhodnutí

**Zadání:** [`docs/wp/P5-SECRET-TYPES.md`](../wp/P5-SECRET-TYPES.md)
**Revision:** `1fc8f03e649dd561fb279ce68e5c119d35faad55` · **Datum:** 2026-08-07
**Adresát:** operátor (`ROADMAP.md §14`, *Remediace kompromitované Git historie*) ·
vlastník `WP-M5-PRIVACY`

> **Tento dokument není evidence** ve smyslu [`docs/review/README.md`](README.md).
> Neobsahuje hodnotu, prefix, délku ani hash žádného tajemství — jen názvy,
> kategorie a cesty. Obsah exponovaných uživatelských souborů nebyl otevřen;
> `personalContentInspected` zůstává `false`.

---

## 1. Nosná věta

`docs/convergence/PRIVACY-INCIDENT.json` uvádí `repositoryWasPublic: true` a
`possibleExfiltrationAssumed: true`.

**Z toho plyne, že přepis Git historie expozici neruší.** Data, která byla
veřejně dostupná, mohla být stažena; rewrite mění jen dostupnost od okamžiku
provedení. Nosnou remediací je **rotace tajemství**. Přepis historie je
doplňková hygiena, ne ochrana.

Rozhodnutí, které po operátorovi `§14` chce, tedy má dvě části a jen jedna z nich
je naléhavá:

1. **rotovat** — chrání proti tomu, co už mohlo uniknout; udělat tak jako tak;
2. **přepsat historii** — sníží budoucí dostupnost; volba mezi variantami v `§5`.

Varianta „přepsat historii a nerotovat" nechrání nic.

---

## 2. Kategorie k rotaci

Ověření osmi kategorií z `rotationInventory` proti dnešnímu kódu. Sloupec „kde se
čte" je výsledek hledání názvu proměnné v `src/**`.

| # | Kategorie | Kde se čte | Externě platné | Kdo rotuje |
|---|---|---|---|---|
| 1 | License signing/validation (`C3_LICENSE_SECRET`) | `src/licensing/license.js` | podle vydaných licencí | operátor |
| 2 | Administrativní a vydané API credentials (`C3_ADMIN_TOKEN`) | `src/agents/api.js`, `src/routes/security.js` | ne (lokální) | operátor |
| 3 | Notifikační credentials — SMTP, webhook, Telegram, ntfy | `src/notifications/channels/{email,telegram,ntfy,push}.js`, `src/notifications/e2e-verify.js` | **ano — u třetích stran** | operátor u poskytovatele |
| 4 | Model/provider credentials (`C3_OPENAI_KEY` aj.) | v dnešním `src/**` **žádný zásah** | ano, pokud existují | operátor |
| 5 | License a agent credentials (`C3_LICENSE_KEY`) | `src/licensing/license.js`, `src/setup/wizard.js` | podle vydavatele | operátor |
| 6 | Fixture hesla (`KLICENKA_PASS`) | fixture kontext | jen při reuse | operátor |
| 7 | Project-scoped externí credentials | v datech uživatele, ne v kódu | **ano** | operátor, inventura bez publikace hodnot |
| 8 | Ephemeral authorization material (session, WS, capability grant, lease) | `api_tokens`, session tabulky | ne | restart / revokace |

Inventář je v tomhle rozsahu **správný a použitelný**. Kategorie 4 dnes nemá
v kódu žádný zásah — buď je historická, nebo se provider credentials čtou pod
jiným názvem; před rotací to stojí za ověření, ať se nerotuje něco, co produkt
nepoužívá, a nezapomene se na to, co používá.

### Co inventáři chybí

| Nález | Co to je |
|---|---|
| **`SEC-1`** | `webhookSecret` se ukládá **v plaintextu** do DB |
| **`SEC-2`** | Aplikační databáze byla v Git historii; není v manifestu incidentu |
| **`SEC-3`** | Jeden chat attachment a druhá databáze v historii, mimo manifest |

---

## 3. Nález `SEC-1` — webhook secret je v databázi v plaintextu

`src/routes/security.js:218-245` generuje `'c3_' + randomBytes(24)` a ukládá ho
takto:

```js
settings.webhookSecret = newSecret;
rawDb.prepare(
  "INSERT OR REPLACE INTO user_settings (id, data, updated_at) VALUES (1, ?, datetime('now'))"
).run(JSON.stringify(settings));
```

Tedy jako **hodnota v JSON sloupci** `user_settings.data`. Odpovědi API ho maskují
(`_maskSecret`), úložiště ne.

Kontrastuje to s `api_tokens`, kde jsou sloupce
`id, name, token_hash, scopes, last_used_at, expires_at, created_at` — tedy
**jen hash**, což je správně. Dvě tajemství, dvě různé úrovně hygieny.

Hledání `createCipheriv|encrypt(` v `src/**` má jediný zásah, a ten je
v `src/tools/registry.js`, tedy nástroj, ne úložiště. **Šifrování at-rest
neexistuje.**

**Dosah je širší, než vypadá.** `src/core/db-backup.js:88` kopíruje `c3.db` do
`data/backups/`. Plaintextový webhook secret se tím propaguje do každé zálohy —
a zálohy si dnes nikdo nešifruje. To spojuje tenhle nález s `WP-M5-DATA`:
restore obnoví i tajemství, takže rotace provedená mezi zálohou a restorem se
tichým návratem staré hodnoty zruší.

---

## 4. Nálezy `SEC-2` a `SEC-3` — historická expozice je širší než manifest

`trackedObjectManifest` má **13 položek** a všech 13 je dosažitelných
(`git cat-file -e` prošel 13/13, obsah nečten). To potvrzuje
`affectedObjectsRemainReachable: true`.

Manifest ale odpovídá na otázku **containment v současném stromu** — sekce se
tak i jmenuje (`currentTreeContainment`, `trackedPathsRemoved: 13`). Rozhodnutí
podle `§14` potřebuje **historický rozsah**, a ten je větší.

Sken historicky přidaných cest (`git log --all --diff-filter=A`, jen názvy):

| Cesta | Stav | Velikost bloku |
|---|---|---|
| `data/c3.db` | 9 commitů, 2026-01-11 → 2026-02-14, odstraněno v `11b8fec9` | 5 blobů, 356–581 KB |
| `data/c3.db-shm` | totéž období | — |
| `data/c3.db-wal` | totéž období | 28 872 B, dosažitelný |
| `e2e-review/P1-Alchymista/database.db` | 1 commit | 1 849 B, dosažitelný |
| `chats/conv-1768592151296-xtx75d2in/attachments/fba07691541b0b79.zip` | historický | 29 012 B, dosažitelný |

**`SEC-2` — aplikační databáze.** `data/c3.db` je živá databáze produktu:
konverzace, nastavení, projekty a podle `§3` potenciálně i `user_settings`
s plaintextovým webhook secretem. V manifestu není, protože v současném stromu
už netrackovaná byla — manifest je v tomhle konzistentní, jen neodpovídá na
otázku, kterou má odpovědět `§14`. WAL soubor je zvlášť nepříjemný: obsahuje
zápisy, které v hlavní DB ještě nebyly.

Pro rotační inventář to znamená **novou kategorii**: *„aplikační databáze
z historie"* — a její obsah určuje, co dalšího se musí rotovat. Bez otevření
databáze nelze říct, které z kategorií 1–8 v ní byly; to je operátorská akce,
protože jde o osobní data.

**`SEC-3` — jeden attachment navíc.** Z 19 souborů historicky přidaných pod
`chats/` a `projects/` je v manifestu **10**. Zbylých 9 je zdrojový kód
(`chats/src/**`, `chats/package.json`, `chats/DEPRECATED.md`) — s jedinou
výjimkou: `chats/conv-…/attachments/fba07691541b0b79.zip`, tedy **soukromá
příloha konverzace**, která v manifestu chybí.

---

## 5. Varianty remediace historie

| | Co změní | Co **ne**změní | Dopad na klony a evidenci | Cena / riziko |
|---|---|---|---|---|
| **A. Ponechat historii, jen rotovat** | nic v repozitáři | dostupnost objektů trvá | žádný; 67 SHA v evidenci platí dál | nejnižší; expozice objektů zůstává |
| **B. Přepsat historii + rotovat** | objekty přestanou být dosažitelné z repozitáře odteď | **cokoli už stažené**; forky, cache a mirrory | **všechny SHA po bodu přepisu se změní**; 67 commit SHA odkazovaných v `docs/convergence/**` přestane odpovídat; každý existující klon musí být znovu klonován | vysoká; nutný force push a koordinace |
| **C. Nový kořen, starý repozitář zneplatnit** | čistá historie bez zátěže | totéž co B | veškerá historická evidence ztrácí vazbu; 1072 commitů zaniká jako kontext | nejvyšší; ztráta auditní stopy projektu |

**Fakta k dopadu B a C.** V `docs/convergence/*.json` a `*.md` je **393**
čtyřicetiznakových hexadecimálních řetězců; z nich **67** jsou skutečné commity
v tomhle repozitáři. Repozitář má **1072** commitů. Přepis od bodu, kde byla
`data/c3.db` přidána (2026-01-11), se dotkne prakticky celé historie.

Zbylých 326 řetězců jsou blob hashe, fingerprinty a registry hashe — u nich
přepis nezmění hodnotu, ale může zrušit dosažitelnost objektu, na který
ukazují. To znamená, že po variantě B nebo C část Gate 0 evidence přestane být
ověřitelná proti repozitáři.

**Co platí u všech tří variant:** rotace kategorií z `§2` je nutná. Žádná
varianta ji nenahrazuje.

---

## 6. Ověření dosažitelnosti

Metodou existence, ne obsahu:

```bash
git cat-file -e <blob>     # 13/13 z manifestu prošlo
git cat-file -s <blob>     # velikost, bez výpisu obsahu
```

| Skupina | Dosažitelné |
|---|---|
| 13 objektů z `trackedObjectManifest` | **13 / 13** |
| `chats/…/fba07691541b0b79.zip` (mimo manifest) | ano |
| `e2e-review/P1-Alchymista/database.db` | ano |
| `data/c3.db-wal` | ano |

Žádný objekt nebyl otevřen ani dekódován.

---

## 7. Známá omezení po remediaci

Tohle musí být podle M6 exit kritérií explicitní bez ohledu na zvolenou variantu:

- **Expozice před remediací je nevratná.** `possibleExfiltrationAssumed: true`
  a `thirdPartyDownloadKnown: false` znamená, že produkt nemůže tvrdit, že data
  neunikla — jen že byla rotována a dostupnost zastavena.
- **Rozsah osobního obsahu zůstane neznámý,** dokud se nezmění metoda posouzení.
  `personalContentInspected: false` je vědomé rozhodnutí, ne mezera.
- **Šifrování at-rest neexistuje** (`SEC-1`) a rotace to neřeší. Dokud se
  nezavede, každá záloha nese tajemství v plaintextu.
- **Rotace bez opravy `SEC-1` je vratná restorem ze starší zálohy.** Pořadí
  vůči `WP-M5-DATA` je proto podstatné.
- **Varianty B a C zneplatní část Gate 0 evidence** (`§5`).

---

## 8. Otázka pro operátora

Sonda nedoporučuje variantu. Formuluje otázku tak, aby šla zodpovědět:

> **Rotace kategorií 1–8 z `§2` proběhne v každém případě.** Kromě ní zvol
> jednu z variant nakládání s historií:
>
> - **A** — historii ponechat. Objekty z `§4` zůstanou dosažitelné; evidence
>   a klony beze změny.
> - **B** — historii přepsat. Objekty přestanou být dosažitelné z repozitáře;
>   67 commit SHA v `docs/convergence/**` přestane odpovídat a všechny klony
>   se musí obnovit.
> - **C** — založit nový kořen a starý repozitář zneplatnit. Nejčistší výsledek,
>   ztráta 1072 commitů historie jako auditního kontextu.
>
> Vedle toho dvě samostatná rozhodnutí, která na variantě nezávisí:
>
> 1. Má se otevřít `data/c3.db` z historie, aby se zjistilo, která tajemství
>    v ní byla? Zvýší to přesnost rotace a poruší dosavadní zásadu
>    `personalContentInspected: false`.
> 2. Má `WP-M5-PRIVACY` zahrnout šifrování tajemství at-rest (`SEC-1`), nebo to
>    patří jinam? Bez toho zůstane rotace vratná restorem.

---

## 9. Reprodukce

```bash
# kategorie proti kódu (jen názvy proměnných)
for v in C3_ADMIN_TOKEN C3_LICENSE_SECRET C3_SMTP_PASS C3_TELEGRAM_BOT_TOKEN C3_NTFY_TOKEN; do
  echo "$v: $(grep -rln "$v" src/ --include='*.js' | tr '\n' ' ')"
done

# SEC-1
sed -n '218,245p' src/routes/security.js
grep -rln "createCipheriv\|encrypt(" src/ --include="*.js"

# SEC-2 / SEC-3 (jen cesty a metadata)
git log --all --pretty=format: --name-only --diff-filter=A | sort -u \
  | grep -iE "\.db($|-)|\.sqlite|\.env|\.key$|\.pem$"
git log --all --oneline -- data/c3.db | wc -l

# dosažitelnost bez obsahu
git cat-file -e <blob> && echo dosažitelný
git cat-file -s <blob>

# dopad variant B/C
grep -rhoE "\b[0-9a-f]{40}\b" docs/convergence/*.json docs/convergence/*.md | sort -u | wc -l
git rev-list --all --count
```

Historie nebyla přepsána, nespouštěl jsem `filter-repo`, `filter-branch`, `gc`
ani force push. Nic nebylo rotováno. `PRIVACY-INCIDENT.json` zůstal nezměněn.
