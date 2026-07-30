# ADR 0001 — Vlastnictví dat v mobilním klientovi

**Status:** PROPOSED — vyžaduje rozhodnutí operátora
**Datum:** 2026-07-30
**Kontext:** Gate 0, příprava mobilního klienta
**Souvisí:** `D-001` (C3 je produktový trunk), `D-003` (IntentSmith repo je donor)

---

## Problém

Mobilní klient musí odpovědět na otázku, kterou dosud nikdo explicitně nezodpověděl:
**kde žijí data, se kterými telefon pracuje?**

Tohle není implementační detail. Určuje datový model klienta, offline chování,
bezpečnostní hranici, i to, které z požadovaných funkcí jsou vůbec postavitelné.

Rozhodnutí nebylo dosud zaznamenáno. Prohledání `DECISIONS.md` (`D-001`..`D-022`),
`ROADMAP.md` a všech `*.md` v repozitáři na `local-first`, `stateless inference`,
`companion` a `mobil` nevrátilo nic. Pokud rozhodnutí padlo v jiném kontextu,
neexistuje tam, kde rozhodnutí žijí — a tato ADR to napravuje.

---

## Varianty

### A) REMOTE_COMPANION

Telefon je vzdálený pohled na data v IntentSmith DB. Konverzace, projekty,
nastavení a paměť jsou na serveru; telefon je zobrazuje a mění. Lokální úložiště
slouží jen jako cache pro čtení offline.

```
telefon ──VPN──▶ IntentSmith DB (zdroj pravdy)
   └─ cache (jen pro čtení bez VPN)
```

### B) LOCAL_FIRST

Konverzace vznikají a žijí v telefonu. Backend poskytuje pouze bezstavovou
inferenci a do IntentSmith DB nic nezapisuje.

```
telefon (zdroj pravdy) ──VPN──▶ IntentSmith: stateless inference
```

---

## Dopad na požadované funkce

Operátor pro mobil vyjmenoval: nastavení jako v IDE, projekty, uchovávání
informací, funkční in-app notifikace.

| Požadavek | REMOTE_COMPANION | LOCAL_FIRST |
|---|---|---|
| Nastavení jako v IDE | ✅ `GET/POST /api/settings` je serverový stav | ❌ serverová nastavení nejsou klientova data; buď je klient stejně čte vzdáleně (a pak už je to companion), nebo má vlastní nesouvisející |
| Projekty a lifecycle | ✅ projekty jsou serverový koncept | ❌ neexistuje lokální ekvivalent; projekt je adresář na stroji |
| Uchovávání informací (LTM) | ✅ LTM, task memory, cross-project | ❌ LTM je serverová paměť vázaná na serverové konverzace |
| In-app notifikace | ✅ notifikace vznikají ze serverových událostí | ⚠️ jen pro události vlastní inference |
| **Approval z telefonu** | ✅ nejcennější use case celého projektu | ❌ **nemožné** — approval je serverová lifecycle událost |
| Offline práce | ⚠️ jen čtení z cache | ✅ plná |
| Data mimo stroj | ⚠️ konverzace překročí hranici | ✅ minimum |

---

## Doporučení

**REMOTE_COMPANION**, s lokální cache pro čtení offline.

Odůvodnění není preference, ale aritmetika: **pět ze šesti požadovaných funkcí
je serverových konceptů.** Nastavení, projekty, LTM i approvaly v telefonu
neexistují a existovat nemohou — jsou to stavy stroje, ne klienta. LOCAL_FIRST
by z mobilu udělal samostatný chatovací klient, který s IntentSmithem sdílí jen
model.

Nejcennější use case — *„schválím build z telefonu"*, který je i deklarovanou
motivací donorovy ADR 0020 — je pod LOCAL_FIRST **nepostavitelný**, protože
approval je serverová lifecycle událost, ke které bezstavový klient nemá vztah.

### Pokud padne LOCAL_FIRST

Pak je potřeba explicitně přeškrtnout čtyři z pěti požadavků a mobil
překlasifikovat na *„offline chatovací klient používající můj GPU"*. To je
legitimní produkt, ale jiný, a je potřeba to říct nahlas, ne to zjistit
uprostřed Fáze 2.

---

## Důsledky doporučené varianty

**Přijímáme:**
- telefon bez VPN je jen čtečka cache, nikoli plnohodnotný klient;
- konverzace a metadata projektů překračují hranici stroje na telefon —
  což zvyšuje dopad ztráty telefonu a činí scoped device token nepodkročitelným;
- klient nesmí mít vlastní zdroj pravdy pro cokoli serverového, jinak vznikne
  problém slučování, který nikdo nechce řešit.

**Odmítáme:**
- offline vytváření konverzací, které by se později slučovaly;
- jakoukoli formu obousměrné synchronizace.

**Nezávislé na této ADR:** bezpečnostní hranice. Ať padne cokoli, telefon se
nesmí připojit ke stávajícímu listeneru — viz `G0-R018` a plán mobilního
klienta. Neautentizovaný WS terminál je problém současného systému, ne
mobilního návrhu.
