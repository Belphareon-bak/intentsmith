# WP — Web v konverzaci bez projektu (brief pro navazujícího workera)

Stav: `DECISION_PENDING / NOT_APPROVED / NO_IMPLEMENTATION_AUTHORITY`.

Tento dokument **není** schválením. Rozhodnutí podle `CONTRACT.md §11` dosud
nepadlo a bez něj se neimplementuje žádný síťový rozsah. Slouží k tomu, aby
navazující worker věděl, co je hotové, co je zastaralé a kde jsou hranice.

Zdrojové podklady:

- návrh: `.intentsmith-artifacts/core-completion-20260909/provider-proposal/completion-network-decision-20260909.md`
- detailní design v2: `…/projectless-web-decision-proposal-1b2cb23d/decision-draft-v2.md`
- nezávislé review: `…/completion-network-decision-independent-review-93173e15.json`

## 1. Proč to vzniklo

Webové hledání dnes funguje jen v konverzaci s připojeným projektem. Bez
projektu se odmítne s `TOOL_EFFECT_AUTHORITY_UNAVAILABLE`, protože
`EffectRequest@1` vyžaduje kladné projektové ID. Doloženo je **34 odmítnutých
pokusů** ve scénářích B/C/E, všechny s ověřeným aktérem a `projectId:null`.

## 2. BLOKUJÍCÍ OPRAVA — `EffectRequest@2` je obsazené

Detailní návrh z 2026-09-09 navrhuje `EffectRequest@2` / `ApprovalGrant@2` /
`EffectResult@2` pro `kind:'network.request'`. **Tato verze už je zabraná.**

Mezitím (2026-09-10) ji obsadil výpis kořene projektu.
`contracts/m2/effect-current.js` vyhrazuje celý v2 envelope výhradně root-listu:

```js
export function validateEffectRequest(value) {
  if (value?.version !== 2) return legacy.validateEffectRequest(value);
  // …vynucuje kind==='fs.read', requiredCapability==='project.fs.list',
  //   riskClass==='read' a validateM2FileListTarget(value.target)
}
```

a `isM2FileListOutputRequest()` rozlišuje root-list **pouze** podle
`version === 2`. Síťový request s `version:2` proto neprojde (fail-closed,
nedojde k tichému přesměrování na file-list provider), ale v2 je nepoužitelné.

**Worker musí cílit na `EffectRequest@3`** — nebo na samostatně pojmenovanou
verzovanou větev — a ověřit, že se nový diskriminátor neopírá jen o číslo
verze, jak to dnes dělá v2. Návrh v tomhle bodě needituje; je zastaralý.

`M2_EFFECT_CONTRACT_VERSION` zůstává `1` pro projektovou větev.

## 3. Operátorský směr (2026-09-11)

Operátor sdělil dvě věci nad rámec původního návrhu:

1. **Rozsah nemá zůstat jen u chatu.** Web je potřeba i pro další sekce,
   zejména pro autonomního agenta (hlídání novinek, souhrny, watchdog). Původní
   restrikce se považuje za odladěnou a dnes zbytečně omezující.
2. **Žádný ručně udržovaný allowlist.** Místo toho vyžadovat platný certifikát
   a opřít se o **externí databázi bezpečných webů** — není to nic, co bychom
   měli sestavovat my.

Bod 2 je správný instinkt, ale sám o sobě neřeší celý problém. Viz §5.

## 4. Etapizace — dvě různá rozhodnutí, ne jedno větší

Bezpečnost úzkého návrhu stojí na tom, že **uživatel před odesláním vidí
přesnou adresu i dotaz a schválí je**. Autonomní agent tento krok ruší.
Per-request schvalování se na autonomii neškáluje, proto:

| Etapa | Co | Kontrola | Stav |
|---|---|---|---|
| 1 | konverzační rozsah, jeden schválený HTTPS GET | lidské schválení každého requestu | návrh hranice hotový; backend blokovaný na podporovaném API/službě |
| 2 | autonomní agent | ohraničený egress + reputace, bez lidského kroku | **samostatné rozhodnutí, nezahájeno** |

Etapa 2 se **nesmí** udělat roztažením grantu z etapy 1.

## 5. Řídicí model — co která vrstva skutečně řeší

Zásadní rozlišení, které musí worker mít v hlavě:

- **Reputace / safe-browsing** chrání uživatele před *škodlivým obsahem, který
  se vrátí* (malware, phishing).
- **Ohraničení egressu** chrání před *daty, která odejdou* (exfiltrace přes
  injektovaného agenta).

**Databáze bezpečných webů neřeší exfiltraci.** Útočník exfiltruje na naprosto
reputovaný cíl — pastebin, Google Form, zkracovač URL, veřejný analytics
endpoint, dokonce i vyhledávací dotaz na velký engine. Vše „bezpečné" podle
reputace, vše použitelné jako kanál ven. Reputace navíc odpovídá na otázku
„je to *známé zlo*?", ne „je to *známé dobro*?" — neznámá doména projde, a
čerstvá útočníkova doména je přesně neznámá.

### Vrstva 0 — povinná, bez seznamu

Striktní validace TLS, žádné přesměrování (nebo ohraničené a znovu validované),
žádné cookies ani credentials, neotevírat odkazy z výsledku, časový limit,
strop na velikost odpovědi. Tohle už úzký návrh má.

Pozor: **platný certifikát není bezpečnostní signál.** Certifikáty jsou zdarma
a drtivá většina phishingu dnes platný certifikát má. Validovat se musí, ale
jako reputační filtr je to prakticky no-op.

### Vrstva 1 — reputace (operátorův bod 2)

Externí zdroj místo vlastní kurátorské práce. Reálné možnosti: Google Safe
Browsing, Cloudflare, Spamhaus, PhishTank, Tranco.

Dvě tvrdé podmínky:

1. **Neposílat URL třetí straně.** Dotazování reputační služby per-request je
   samo o sobě egress a únik toho, co uživatel hledá. Použít režim s lokálními
   hash-prefixy (Safe Browsing Update API) nebo lokálně cachovaný seznam.
2. **Určit chování při nedostupnosti zdroje** — fail-open, nebo fail-closed.
   Musí to být explicitní rozhodnutí, ne vedlejší efekt implementace.

### Vrstva 2 — ohraničení egressu, a tady je pointa

**Na omezení exfiltrace není potřeba žádný seznam. Stačí ohraničit, kolik
bajtů může odejít.**

- pouze GET, žádné tělo požadavku,
- strop na celkovou délku URL (řádově stovky bajtů; vyhledávací dotaz má ~100),
- strop na počet a délku query parametrů,
- limity na frekvenci a objem,
- egress receipty, aby bylo zpětně vidět, co odešlo.

Exfiltrace potřebuje nést payload. Když je odchozí kapacita na požadavek pár
set bajtů a je logovaná, přestává být praktická — a nepotřebovali jsme k tomu
nic sestavovat.

Pokud operátor přesto bude chtít seznamovou kontrolu bez vlastní kurátorské
práce, střední cestou je **kategorizace od externího poskytovatele**: povolit
vyhledávače, zpravodajství a referenční weby; zakázat pastebiny, file sharing,
zkracovače URL a tunelovací/webhook služby — tedy klasické exfil kategorie.
Kategorizace je nepřesná a přidává závislost, ale nekurátorujeme ji my.

### Vrstva 3 — SSRF, opět bez seznamu

Rozlišení jména musí skončit na veřejné adrese. Zakázat RFC1918, loopback,
link-local a cloud metadata (`169.254.169.254`). Ošetřit DNS rebinding —
validovat adresu, na kterou se skutečně připojuje, ne jen tu z prvního
rozlišení. Toto jsou pravidla nad IP rozsahy, žádná databáze.

### Vrstva 4 — obsah je data, nikdy instrukce

Stažený web obsah nesmí nikdy dostat status instrukce. Tenhle kód už tu
disciplínu u souborů má — viz system prompt v
`src/chat/handlers/utils/file-explain.js`. Pro web musí platit totéž, a je to
kritičtější, protože obsah je cizí.

## 6. Co zůstává z původního návrhu v platnosti

- vázat rozsah na ověřeného vlastníka konverzace a neměnný původní user-turn,
- jeden plně materializovaný request, grant nejvýše 5 minut, jedno použití,
- uložit skutečné bajty odpovědi a jejich původ **před** ohlášením úspěchu,
- obnovení konverzace zobrazí uložený výsledek a **neposílá request znovu**,
- selhání nesmí spustit skrytý náhradní požadavek,
- nikdy nevyrábět fiktivní projekt ani `projectId:0`,
- projektová v1 větev zůstává beze změny; žádný downgrade,
- změna vlastnictví, smazání konverzace nebo revokace ruší čekající granty.

## 7. Otevřené otázky pro operátora

1. Fail-open, nebo fail-closed, když je reputační zdroj nedostupný?
2. Které podporované search API nebo operátorem řízená služba bude jediným
   stage-1 backendem? `html.duckduckgo.com` je po §8 vyřazený kandidát.
3. Jaký konkrétní reputační zdroj, a je přijatelná jeho licence a závislost?
4. Kategorizační allowlist ano/ne, nebo stačí ohraničení bajtů?

## 8. Živý preflight `html.duckduckgo.com` — 2026-09-11

Jediný benigní HTTPS GET s dotazem `example`, bez cookies, credentials a
přesměrování, s 15sekundovým timeoutem a limitem odpovědi 1 MiB, ověřil pouze
dosažitelnost transportu:

- TLS ověření: `ssl_verify_result=0`;
- HTTP: `202` za `0,193 s`;
- odpověď: 14 193 bajtů HTML;
- SHA-256 odpovědi:
  `f9e30416cba07508cbd7b3a1c3ef296f1009943289f72d2409e4e3ecf1441122`.

Obsah nebyl výsledková stránka. Byl to interaktivní bot challenge s požadavkem
na výběr obrázků. Endpoint je tedy z tohoto hostu dosažitelný, ale **není
použitelný jako bezobslužný search backend a pro etapu 1 se odmítá**. Tento
jeden preflight neprokazuje dlouhodobou dostupnost ani licenci. Dosavadních 34
scénářů tím není vyřešených.

Soukromý raw preflight je v ignorovaném
`.intentsmith-artifacts/projectless-web-preflight-20260911/`. Do Git se
nepřidává, protože challenge URL obsahuje efemérní serverové hodnoty.

## 9. Přijímací hranice stage-1 backendu

Před implementací musí být vybraný přesný backend a doložené všechny body:

- jde o dokumentované a podporované API nebo operátorem spravovanou službu,
  ne scraping HTML stránky či obcházení bot challenge;
- má stabilní HTTPS origin, zveřejněný auth model, rate limits a provozní
  podmínky slučitelné s lokálním produktem;
- je rozhodnuté, co poskytovatel uvidí a jak dlouho může uchovávat dotaz,
  IP adresu a identifikátory; credential nepatří do Git ani receiptu;
- poskytuje strojově rozlišitelné úspěchy, limity a terminální chyby bez
  skrytého fallbacku na druhý provider;
- jeden inertní contract test a jeden živý benigní preflight prokážou přesný
  request/response tvar před tvrzením, že search scénáře jsou vyřešené.

Přijatelné třídy řešení jsou placené či bezplatné podporované search API nebo
vlastní operátorem spravovaný metasearch. Volba konkrétní služby je stále
operátorské rozhodnutí, protože vytváří externí datový tok, credential,
licenční vztah a provozní závislost. Dokud není vybraná, etapa 1 je
`BACKEND_DECISION_BLOCKED` a žádný network contract se neimplementuje.

## 10. Co se nesmí předpokládat

- že přijetí tohoto briefu je přijetím rozhodnutí,
- že schválení etapy 1 zahrnuje etapu 2,
- že uživatelský dotaz, výběr SEARCH modelem nebo frontend callback je
  schválením konkrétního odchozího efektu,
- že `EffectRequest@2` je volné,
- že reputační databáze řeší exfiltraci.
