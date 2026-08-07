# P5 — census typů tajemství pro PRIVACY rozhodnutí

**Typ:** read-only sonda · **Slot:** nesoutěží o zapisujícího vlastníka
**Vstupní revision:** `1fc8f03e649dd561fb279ce68e5c119d35faad55`
**Adresát:** operátor (rozhodnutí `§14` „Remediace kompromitované Git historie") ·
agent, který povede `WP-M5-PRIVACY`
**Důvod:** `§14` požaduje před M6 freeze *„seznam typů tajemství k rotaci, dopad
variant a výslovný operátorský souhlas"*. První dvě položky jsou read-only práce.
Třetí je operátorská a sonda ji nesmí předjímat.

---

## 1. Otázka, na kterou sonda odpovídá

Co všechno je nutné rotovat, a **co která varianta remediace Git historie
skutečně změní**. Ne „jak přepsat historii" — to je operátorská akce s výslovným
souhlasem podle `CONTRACT.md §9`.

## 2. Co je už ověřeno (nepřeměřovat)

`docs/convergence/PRIVACY-INCIDENT.json` (incident `G0-PRIVACY-001`,
`CONFIRMED_COMPROMISE`, hodnoceno 2026-07-30) už obsahuje:

- **`trackedObjectManifest`** — 13 cest, ~7,6 MB, s git blob hashi; kategorie:
  chat attachment, archived conversation, user project state, user project attachment;
- **`rotationInventory`** — **8 kategorií** tajemství s doporučenou akcí
  (license signing, admin/API credentials, notification credentials, model provider
  credentials, license/agent credentials, fixture hesla, project-scoped externí
  credentials, ephemeral authorization material);
- **stav historie:** `affectedObjectsRemainReachable: true`,
  `historyRewritten: false`, `remediationAuthority: "operator decision required"`;
- **posouzení:** `repositoryWasPublic: true`, `possibleExfiltrationAssumed: true`,
  `personalContentInspected: false`, metoda = jen názvy cest a metadata.

Dále ověřeno na vstupní revizi: `.env` **není** trackovaný (`.gitignore:2-4`),
trackovaný je jen `.env.example` s **47 názvy** proměnných; remote je dnes
`git@github-intentsmith:Belphareon-bak/intentsmith.git`.

**Tohle je ta věc, kterou musí sonda vyslovit nahlas, protože rozhoduje o celém
rozhodnutí:** `repositoryWasPublic: true` a `possibleExfiltrationAssumed: true`
znamená, že **přepis historie expozici neruší**. Přepis mění jen dostupnost
odteď. Nosnou remediací je rotace, ne rewrite. Report, který to neřekne první
větou, svádí k volbě varianty, která vypadá důkladně a nechrání nic.

Sonda tedy **nezakládá nový inventář** — ověřuje a doplňuje existující, a přidává
to, co v JSONu chybí: dopad variant.

## 3. Postup

1. **Ověřit `rotationInventory` proti dnešnímu kódu.** Pro každou z 8 kategorií
   dohledat, kde se hodnota dnes skutečně čte (`process.env.*`, config soubory,
   DB tabulky, vydané tokeny). Výstupem je mapování kategorie → místa v kódu →
   způsob, jakým se rotace projeví.
2. **Najít kategorie, které v inventáři chybí.** Porovnat s 47 klíči
   `.env.example` a s nálezy censu `P3` (notification credentials, model
   provider credentials). Zvlášť prověřit tajemství, která nejsou env proměnná:
   hodnoty v DB, vydané API tokeny (viz `validateApiToken()` a `P4`), licenční
   materiál, session a capability granty.
3. **Určit u každé kategorie, jestli je externě platná.** Rotace `C3_ADMIN_TOKEN`
   je lokální akce; rotace tokenu Telegram bota je akce u třetí strany a má
   jiný postup i jinou naléhavost. Bez tohoto rozlišení je seznam k rotaci
   nepoužitelný jako pracovní postup.
4. **Zpracovat varianty remediace historie a jejich dopad.** Minimálně:
   ponechat historii a rotovat; přepsat historii a rotovat; založit nový kořen
   a starý repozitář zneplatnit. Pro každou: co se skutečně změní pro už
   exponovaná data, co to udělá s existujícími klony a fork/cache kopiemi,
   co to udělá s Gate 0 evidencí a odkazy na commity napříč `docs/convergence/**`,
   a jaká je cena a riziko.
5. **Ověřit dosažitelnost objektů**, aby report nestál jen na tvrzení z JSONu.
   Přítomnost blobu se ověřuje jeho **existencí** (`git cat-file -e`), nikdy ne
   výpisem obsahu.
6. **Sepsat, co zůstane pravdivé i po remediaci** — tedy známá omezení, která
   musí být podle M6 exit kritérií explicitní.

## 4. Absolutní zákaz hodnot

Podle ROADMAP `§9`: *„hodnoty tajemství se nikdy nereportují."* V tomto reportu
tedy nesmí být hodnota, prefix, sufix, délka, hash ani zkrácená podoba
jakéhokoli tajemství. Sonda pracuje výhradně s **názvy proměnných, kategoriemi
a cestami**.

Stejně tak se **neotvírá obsah** exponovaných uživatelských souborů. Incident je
posouzený metodou „path names, Git object metadata, file size metadata" a sonda
tuhle metodu nerozšiřuje — `personalContentInspected` musí zůstat `false`.

## 5. Výstup

Jediný soubor: **`docs/review/2026-08-07-SECRET-TYPES.md`**

Povinné sekce:

1. **Nosná věta** — proč je rotace nosnou remediací a přepis historie ne.
2. **Kategorie k rotaci** — ověřený a doplněný seznam: kategorie, kde se čte,
   externě platné ano/ne, postup rotace, kdo ji provádí (operátor / agent).
3. **Doplňky proti `PRIVACY-INCIDENT.json`** — co inventáři chybělo, explicitně.
4. **Varianty remediace historie** — tabulka: co změní, co nezmění, dopad na
   klony a evidenci, cena, riziko.
5. **Ověření dosažitelnosti** — příkazy a výsledky (existence, ne obsah).
6. **Známá omezení po remediaci** — co zůstane pravdivé pro M6.
7. **Otázka pro operátora** — jedna, přesně formulovaná, s variantami z bodu 4.
   Bez doporučení vydávaného za rozhodnutí.

## 6. Hranice

- žádný zápis mimo výstupní soubor;
- **nepřepisovat historii, nespouštět `filter-repo`, `filter-branch`, `gc`
  ani force push** — ani zkušebně, ani na kopii, která by se dala zaměnit
  s produkčním repozitářem;
- neměnit `PRIVACY-INCIDENT.json` — je to evidence stavu k 2026-07-30; doplňky
  jdou do reportu;
- nerotovat nic; rotace je operátorská akce.

## 7. Stop condition

Zastavit a eskalovat, pokud:

- se najde tajemství **v současném stromu** (nejen v historii) — to je aktivní
  expozice a má přednost před dokončením censu;
- se najde kategorie s externě platným credentialem, která v `rotationInventory`
  chybí — hlásit hned, ne až s reportem, protože mění naléhavost;
- se ukáže, že repozitář má víc remotes nebo že existuje veřejný fork —
  to mění dopad všech variant a je to operátorská informace.

## 8. Ověření, že sonda doběhla pravdivě

```bash
git ls-files | grep -i "^\.env"      # smí vrátit jen .env.example
grep -oE "^[A-Z0-9_]+=" .env.example | wc -l    # 47 na vstupní revizi
```

A na samotném reportu: nesmí projít grep na hodnoty. Report, který obsahuje
cokoli, co vypadá jako credential, je vadný bez ohledu na obsah zbytku.
