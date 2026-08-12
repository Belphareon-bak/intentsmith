# WP-MOBILE-027 — co bylo uděláno

**Typ:** záznam výsledku · **Zadání:** [`WP-MOBILE-027-COMPLETION.md`](WP-MOBILE-027-COMPLETION.md)
**Vstupní revision:** `5c61add4` · **Výstupní revision:** `786d4c74`
**Větev:** `wp/mobile-refresh-20260809` · worktree `/home/belphareon/worktrees/is-mobile-refresh`

> **Co tenhle dokument je.** Záznam implementace s pojmenovaným důkazem na
> konkrétních SHA. **Není to review verdikt a nemění stav nálezů.**
> Překlasifikovat `F-112`, `F-015` nebo `F-100` je akt review autority; tenhle
> dokument říká jen, co je v kódu a čím je to podložené. Stavové řádky
> v [`UI-DESIGN.md`](UI-DESIGN.md) a [`COVERAGE.md`](COVERAGE.md) proto zůstávají
> beze změny.

---

## 1. Fáze A — UI podle `D-UI-1..4`

| Položka | Commit | Sada | Důkaz |
|---|---|---|---|
| A1 trust bar | `398507dd` | `tests/mobile-trust-bar.test.js` | 18 PASS |
| A2 `Přehled` jako kořen | `e4a2ac5b` | `tests/mobile-overview.test.js` | 18 PASS |
| A3 posouvací lišta | `7b73c657` | `tests/mobile-navbar.test.js` | 20 PASS |
| A4 `RunSilence` | `3a61a8b9` | `tests/mobile-run-silence.test.js` | 12 PASS |

**A1** — tři zóny (spojení · stáří · zámek) v jedné komponentě, kterou nevolá
žádný `viewX()`; vkládá ji `render()` pod `</header>` jedním místem. Dnešní
`#conn-banner` se do zóny 1 přesunul, ne zahodil — `SS-03` a `SS-08` mají dál
oddělené znění a jen `SS-08` vede na diagnostiku. Samostatný element z
`index.html` zmizel, aby spojení nemluvilo ze dvou míst.

**A2** — `navItems()` je jediný zdroj, ze kterého se staví mapa sekcí na
`Přehledu` i lišta, takže podmínka úplnosti kořene není revizní pravidlo, ale
jeden seznam dvakrát. Sekce `Aktivní běhy` s procenty se nestaví (`D-UI-4`).

**A3** — lišta nese všechny položky, centruje se na zvolenou, na kořeni je
zatažená. Odebrání scopu za běhu vlastní sekce je případ, kdy by zvýraznění
zůstalo na ničem; `currentSection()` proto padá zpět na kořen.

**A4** — pruh říká, že běží a jak dlouho. „Zjistit stav" provádí výhradně
`GET /m1/operations/:id`. Za „běží" se počítá jen `PENDING`; `UNKNOWN` patří na
`MS-20`.

## 2. Fáze B — opravy vad

| Položka | Commit | Sada | Důkaz |
|---|---|---|---|
| B1 `F-112` ACK izolace | `e04be7f7` | `tests/mobile-notification-ack.test.js` | 10 PASS |
| B2 `F-015` závod sekvence | `88b7b435` | `tests/mobile-notification-seq.test.js` | 6 PASS |
| B3 `F-100` **částečně** | `7916098e` | `tests/mobile-approval-authority.test.js` | 12 PASS |

**B1** — migrace `058`, per-device receipt tabulka podle `DR-012` A. Množina,
kterou lze potvrdit, je stejný predikát jako množina, kterou lze číst.
Broadcast s globálním `read_at` se nebackfilluje — nelze zjistit kdo.
Před touhle sadou nemělo ACK **žádné pokrytí**, což je důvod, proč `F-112`
přežilo.

**B2** — migrace `059`, `UNIQUE` na `seq` plus ražba jedním statementem
(`INSERT ... SELECT COALESCE(MAX(seq),0)+1`). Migrace opraví duplicity a řádky
bez `seq`, ale nepřečísluje už unikátní hodnoty, proti kterým drží živí klienti
`afterSeq` kurzory.

**B3** — migrace `060` (`origin`, `run_id`, `operation_ref`), TTL podle
`DR-011` odvozené z původu, povinný otisk na decide, odmítnutí nevázaného
approvalu. V klientovi zmizela natvrdo zapsaná hodnota TTL: délka okna se čte
ze dvou serverových časů, odpočet z korigovaného serverového času, bez
potvrzeného offsetu „vyprší brzy" a tlačítka zůstávají aktivní (§14).

### 2.1 Co z `F-100` zůstává otevřené

**Produkční producent approvalů se nestaví.** `createMobileApproval()` existuje
a je správný, ale nic v běžícím systému ho nevolá. Zapojení emitoru by vystavilo
approvaly na produkčním povrchu před M6 — to je release autorita, ne rozhodnutí
tohohle WP, ze stejného důvodu, proč `MobileChannel` zůstává mimo notifikační
router (strop §0).

Poslední test v `mobile-approval-authority.test.js` to drží zapsané v kódu:
selže ve chvíli, kdy někdo producenta zapojí, aniž by to rozhodnutí zaznamenal.

## 3. Ověření mutací

Každý negativní test byl ověřen odstraněním opravy, ne domněnkou:

| Mutace | Selhalo testů |
|---|---:|
| `render()` bez `withTrustBar()` | 10 |
| vypuštěná podmínka prázdného trust baru | 4 |
| stáří ignorující neznámý offset (§14) | 1 |
| položka v liště bez dlaždice na kořeni | 2 |
| chybné čtení fronty spadne do „Nic nečeká" | 2 |
| zvýraznění smí padnout na ničem | 1 |
| lišta se na kořeni nezatahuje | 1 |
| dopočítané procento v `RunSilence` | 2 |
| „Zjistit stav" jako opětovné odeslání | 2 |
| `UNKNOWN` hlášené jako běžící | 3 |
| ACK bez scope na zařízení (`F-112`) | 3 |
| přečtenost padá zpět na globální sloupec | 2 |
| vrácené okno mezi `MAX(seq)` a `INSERT` | 1 |
| index bez `UNIQUE` | 2 |
| otisk zase volitelný (`F-100`) | 1 |
| nevázaný approval se dá schválit | 2 |
| okno 10 minut a přijatý dodaný otisk | 3 |

## 4. Stav ověřovací baterie na `d11255ea`

```
npm run test:mobile                    18 sad, 418 PASS
node tests/schema-migrations.test.js   38 PASS   (058, 059, 060)
node scripts/validate-test-registry.js valid, 395 programů
node tests/artifact-validation.test.js 151 PASS
node tests/repository-hygiene.test.js  1 586 cest
node scripts/module-boundary-ratchet.mjs        1048/1048 PASS
node tests/module-boundary-ratchet.test.js      13 PASS
```

Commit `7916098e` uvádí v hlášce `420 PASS`; správné číslo je **418**
(41+10+6+12+11+38+9+14+15+10+4+61+76+43+18+18+20+12). Historie se kvůli tomu
nepřepisuje, autoritativní je tenhle řádek.

**Na `786d4c74`** (po dodatcích §6 a §7):

```
npm run test:mobile                    18 sad, 419 PASS   (parita 11 → 12)
npm run test:mobile:browser            12 PASS            (nová sada, BLOCKED řádek)
node tests/schema-migrations.test.js   38 PASS
node scripts/check-migration-numbers.mjs  bez kolize
node scripts/validate-test-registry.js valid, 396 programů
node tests/artifact-validation.test.js 151 PASS
node tests/repository-hygiene.test.js  1 587 cest
node scripts/module-boundary-ratchet.mjs        1048/1048 PASS, added=0
node tests/module-boundary-ratchet.test.js      13 PASS
```

Ratchet přijal pět nových hran, každou zvlášť a na čistém stromu: čtyři jsou
`migrace -> src/db/migrate.js` (táž hrana jako `055`–`057`), dvě uvnitř
`src/mobile/`. **Z jádra do `src/mobile/` nevede žádná** — závislost zůstává
jednosměrná.

`nightly-orchestrator-self-test` nebyl spouštěn: podle zadání §6.5 padá i na
čistém `HEAD`u a není to regrese tohohle WP.

## 5. Čemu se WP vyhnul

Beze změny zůstává: `C3_HOST` a `requireLegacyLoopbackHost()`, 13-route
allow-list, `MS-09`/`MS-12`/`MS-15`, zapojení `MobileChannel` do notifikačního
routeru, `GATE0_REGISTRY_HASH` v `scripts/nightly-orchestrator.js`, a merge
téhle větve kamkoli.

Fáze C (projekty) nezačala — čeká na kontraktní kolo `DR-008` domény 2.
`Projekty` jsou v liště položkou bez obrazovky: dokud server nedá
`read:projects`, nejsou vůbec; s ním jsou zamčené a nekliknutelné.

## 6. Dodatek `2026-08-10` — koordinace čísel migrací

Tohle nebyla implementační nejasnost, ale skutečný konflikt mezi větvemi.

**Co bylo špatně.** `d6fee86f` musel při refreshi přesunout mobilní gateway
migrace z `046`/`047`/`048` na `055`/`056`/`057`, protože hlavní linie tatáž
čísla obsadila dřív. Přejmenovaly se **jen soubory a exportované `version`** —
komentáře, konstanty a dokumentace dál říkaly `046`/`047`/`048`. Ta čísla dnes
patří reálným cizím migracím ve stejném adresáři (`046 model_failover`,
`047 model_failover_claim_expiry`, `048 model_binding_operations`), takže odkaz
z `operation-journal.js` končil u model-binding lineage. Opraveno 24 odkazů
v 9 souborech (`8a92ab0c`).

**Pravidlo z §6.3 zadání je překonané.** „Prefix vyšší než `2026_08_09_057`"
dnes vyrobí kolizi: fáze B obsadila `058`–`060` a modelová linie `061`
(`905a3422`). Autoritativní znění je nově [`TEST-STRATEGY.md`
§6.5](TEST-STRATEGY.md); u §6.3 je erratum.

**Číslo se nečte z dokumentu.** Mezi napsáním §6.5 a jeho zacommitováním vznikl
worktree `is-m1-proof-issuance-impl` a obsadil `062`. Proto
`scripts/check-migration-numbers.mjs`: prochází všechny registrované worktree
včetně pracovních stromů, `main` a HEAD větev, hlásí kolize i další volné číslo
a vrací `1`, když si číslo z tohohle stromu nárokuje jinde jiná migrace
(`92a7dda1`, `c0cf596c`). Ověřeno mutací — podstrčená
`2026_08_09_058_other_branch_thing` do cizího worktree → exit 1.

`tests/mobile-migration-parity.test.js` k tomu drží in-tree invariant: každé
číslo migrace napsané na mobilním povrchu musí patřit mobilní migraci, cizí se
odkazuje plnou verzí. Sada je proto 12 PASS místo 11.

## 7. Dodatek `2026-08-10` — prohlížečové ověření UI

Limit `F-043`, který si drží každá mobilní UI sada („there is no browser here"),
je pro fázi A uzavřený: `tests/mobile-browser-a11y.test.js` renderuje skutečného
klienta v Chrome a měří to, co markup říct nemůže (`786d4c74`, 12 PASS).

**Devět vad, které žádné tvrzení o markupu nemohlo vidět:**

| Co | Naměřeno | Oprava |
|---|---|---|
| `--text-faint` | 3.07:1 světlý · 2.88:1 tmavý | `#6d6b66` / `#9c988f` |
| `--text-muted` | 4.78:1 — pod ním nezbyl krok | `#5c5a54` |
| `--accent` jako **text** | 3.90:1 na bílé (vybraná položka lišty, počty) | nový `--accent-text` `#a75337`; výplně zůstávají |
| `--warn` | 4.33:1 na `--danger-soft` | `#8b611c` |
| `--danger` (tmavý) | 4.42:1 na `--info-soft` | `#e57d6e` |
| `.icon-btn` | 40 × 40 dp | 48 × 48 |
| `.btn-sm` („Zjistit stav", A4) | 92 × 37 dp | `min-height: 48px` |
| `.appr-actions` (MS-14) | 48 dp a 10 px mezera | 56 dp a 12 px podle §8 |
| pin v `mobile-ms14-decision` | vynucoval `min-height: 48px` | posunut na 56 — pin kódoval vadu, ne pravidlo |

Šest mutací ověřeno zvlášť: vrácení `--text-faint`, `.icon-btn`, MS-14
geometrie, `position: fixed` na trust baru, `aria-label` jen s první zónou
a zvýraznění jen barvou — každá shodí právě svůj test.

**Co je nově doloženo, ne jen tvrzeno:** trust bar má `position: static`, začíná
přesně na spodní hraně hlavičky a posune obsah o svou vlastní výšku (§4);
prázdný má 0 px (§4.1); čtečce se ohlásí jako `role="status"` jednou větou
o všech třech zónách (§10); všechny položky lišty jsou ve stromu přístupnosti
i mimo viewport, vybraná je právě jedna a fokus ji odscrolluje do viditelna
(§3.1, §3.3).

**Co zůstává neověřené.** Headless Chrome není telefon: VoiceOver ani TalkBack,
iOS Safari a chování pod skutečným systémovým písmem doložené nejsou.

**Nový otevřený nález — §10 dynamická velikost písma.** Klient je celý v `px`.
Při nastavení prohlížeče na 200 % se `documentElement` zvětší na 32 px, ale
`body` zůstane na 16 px a komponentní velikosti se nezmění vůbec — požadavek
„layouty testované na 200 %" tedy dnes nejde ani vyzkoušet. Převod na `rem` je
změna napříč celým stylesheetem a patří do vlastního WP, ne sem. Poslední test
v sadě to drží zapsané jako charakterizaci: spadne ve chvíli, kdy se klient
stane škálovatelným, a vynutí překlasifikaci místo tichého zapomenutí.

**Registrace.** Řádek je `BLOCKED` s `requirements.toolchain
["chromium-runtime"]` — `TEST-STRATEGY.md` §5 podmínka 5 říká, že sada
vyžadující toolchain, který běžný běh nemá, není `offline`. Sada je
fail-closed: bez prohlížeče končí nenulově s pojmenovanou prerekvizitou
(podmínka 1, `G0-R016`). Do `test:mobile` zařazená není, aby baterie nepadala
na strojích bez prohlížeče; běží jako `npm run test:mobile:browser`.

## 8. Co potřebuje operátora

Beze změny proti zadání §7: otevření `DR-008` domény 2, popisek
`Chaty` × `Konverzace` (implementace používá kanonické **Konverzace**), přílohy
v chatu, merge větve. Nově k tomu:

| Věc | Proč |
|---|---|
| Zapojení produkčního producenta approvalů | Poslední část `F-100`; rozšíření produkčního povrchu před M6 |
| Review verdikt nad `F-112` a `F-015` | Implementace a důkaz existují; překlasifikace nálezu je akt review autority |
| Umístění `Zpráv` (`MS-05`) v navigaci | Implementováno jako hluboký cíl kořene podle `UI-REVIEW` §3.5; zvoneček zůstává otevřenou otázkou |
| Založení nálezu pro §10 dynamickou velikost písma | Klient je v `px` a na 200 % nereaguje (§7). Doložené, ale **nezaložit nález je akt review autority**, stejně jako ho překlasifikovat |
| WP na převod stylesheetu na `rem` | Jediná cesta, jak §10 „layouty testované na 200 %" splnit; mění každou obrazovku, takže nepatří do dotahovacího WP |
| Ověření na skutečném telefonu | Headless Chrome uzavřel kontrast, cíle, geometrii a strom přístupnosti. VoiceOver/TalkBack, iOS Safari a systémové písmo zůstávají mimo dosah CI |
