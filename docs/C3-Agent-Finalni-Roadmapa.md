# C3-Agent — Finální Roadmapa
## Od aktuálního stavu k tvé vizi

**Datum:** 2026-02-07  
**Verze kódu:** v57.0

---

## Tvá vize — 4 pilíře

### Pilíř 1: CHAT — náhrada ChatGPT
Kvalitní konverzační AI s generováním dokumentů a expertní specializací.
Umí odpovídat přesně, v kontextu, ve správném jazyce, s podklady.

### Pilíř 2: PROJEKTY — stavění věcí
D1→CODE→R2→D2→R1 pipeline pro velké projekty (web, smart home, aplikace).
Týdny práce, ne jednorázové odpovědi.

### Pilíř 3: WORKERI — autonomní hlídací psi
Běží na pozadí 24/7. Sledují web, počasí, nabídky, zprávy.
Posílají notifikace (email, Telegram, SMS) když se něco stane.

### Pilíř 4: SPECIALISTÉ — komplexní on-demand agenti
Účetní, správce domácnosti, AI researcher. Kombinují expertní znalosti,
nástroje, rutiny a paměť. Nejsou jen chat persona — umí generovat
faktury, kontrolovat zákony, navrhovat jídelníčky.

---

## Kde je každý pilíř dnes

### Pilíř 1: CHAT — 80% hotový

| Co funguje | Co chybí |
|------------|----------|
| ✅ CRE routing (11 intentů) | ❌ PDF export |
| ✅ Safety engine (4 domény) | ❌ DOCX generování |
| ✅ Quality pipeline (K5.1–K5.5) | ⚠️ fetchPage kvalita (block detection) |
| ✅ Output gate D6 | ⚠️ Auto-retry při prázdném searchi |
| ✅ Export MD/HTML/TXT | ⚠️ Confidence-based styling |
| ✅ Language detection (7 jazyků) | ⚠️ Expert domain-specific prompty |
| ✅ Conversation store (DB) | ⚠️ Expert cross-session paměť |
| ✅ Context budget per intent | |
| ✅ Query canonicalizer | |
| ✅ Chat UI (základní) | |
| ✅ Expert routing + enforcement | |

**K dokončení:** ~2 týdny

### Pilíř 2: PROJEKTY — 70% hotový

| Co funguje | Co chybí |
|------------|----------|
| ✅ D1→CODE→R2→D2→R1 pipeline | ⚠️ Reálné testování na velkých projektech |
| ✅ Planner start/clarify/approve/reject | ⚠️ Project-scoped paměť (co se dělalo minule) |
| ✅ Build handoff z chatu | ⚠️ Multi-session projekty (pokračování po dnech) |
| ✅ Architect mode (editor, git, reviewer) | ⚠️ Progress tracking / roadmap per projekt |
| ✅ Project focus v DB | |

**K dokončení:** ~1 týden kódu + průběžné testování na reálných projektech

### Pilíř 3: WORKERI — 40% hotový

| Co funguje | Co chybí |
|------------|----------|
| ✅ Agent runner (scheduler, HUNTER) | ❌ **Doručení notifikací** (email, Telegram, SMS, push) |
| ✅ Edge detection (ne spam) | ❌ RSS/Atom source adapter |
| ✅ Conditions (compare, contains, new_items) | ❌ Vícezdrojové agenty (sleduj X,Y,Z najednou) |
| ✅ URL source + schema extraction | ⚠️ Robustnost scrapingu (anti-bot, JS render) |
| ✅ Webhook action | ⚠️ Agent builder UX (dnes DSL, ne konverzace) |
| ✅ LLM-generated notifikace | ⚠️ Agent monitoring UI (co běží, co selhalo) |
| ✅ Notifikace se ukládají do DB | |
| ✅ Agent secrets (API klíče) | |

**Notifikace jsou klíčový blocker.** Agent umí zjistit, že se něco stalo, umí to uložit do DB, ale neumí to doručit nikam mimo systém. Komentář v kódu říká: *"This would be handled by notification service"* — ale ten neexistuje.

**K dokončení:** ~3 týdny

### Pilíř 4: SPECIALISTÉ — 5% hotový

| Co funguje | Co chybí |
|------------|----------|
| ✅ Expert personas (definice) | ❌ **Celý koncept** — dnes neexistuje |
| ✅ Expert store (DB) | ❌ Tool binding per specialista (účetní = generátor faktur) |
| | ❌ Rutiny (měsíční kontrola, týdenní report) |
| | ❌ Specializované nástroje (kalkulačky, šablony, API) |
| | ❌ Vlastní paměť a knowledge base per specialista |
| | ❌ Sub-agenti (specialista deleguje na workery) |

Tohle je největší kus práce. Aktuální „expert" je jen persona overlay na chat — změní styl odpovědi, ale neumí nic navíc. Specialista, jak ho popisuješ (účetní, který generuje faktury, hlídá termíny, zná zákony), je úplně jiná kategorie.

**K dokončení:** ~6–8 týdnů

---

## Realistická roadmapa

### Fáze A: CHAT dokončení (2 týdny)
**Cíl:** Chat je na úrovni, kde ho denně používáš místo ChatGPT.

```
Týden 1:
  A1. fetchPage quality — block detection, smart truncation, keyword relevance
  A2. Auto-retry search — < 3 výsledků → LLM reformuluje → retry
  A3. Confidence styling — odpověď reflektuje sílu podkladů
  A4. HTTP hardening — body limit, CORS, secrets auth, route safety

Týden 2:
  A5. PDF export (puppeteer HTML→PDF)
  A6. DOCX generování (docx-js nebo pandoc)
  A7. Expert domain prompty — per-doména specifické syntézy
  A8. Expert paměť — cross-session kontext v DB
  A9. Legacy cleanup — smazat workflow/engine.js, sjednotit verze
```

**Milestone:** "Pošlu C3 dotaz → dostanu českou, podloženou odpověď → exportuju jako PDF."

### Fáze B: WORKERI — notifikace a zdroje (3 týdny)
**Cíl:** Aspoň 3 agenti běží 24/7 a reálně posílají notifikace.

```
Týden 3:
  B1. Notification Service — abstraktní vrstva pro doručení
      - NotificationChannel interface (send, verify, test)
      - Routing: agent config → channel → deliver
  B2. Email channel — nodemailer, SMTP config
  B3. Telegram channel — Bot API, chat_id z configu

Týden 4:
  B4. Push channel (ntfy.sh nebo Pushover — jednoduché, bez vlastního serveru)
  B5. RSS/Atom source adapter — nový zdroj pro zpravodajské agenty
  B6. Multi-source agent — agent s více zdroji, merge výsledků
  B7. Agent health dashboard — co běží, kdy naposledy, kolik notifikací

Týden 5:
  B8. Testování 3 reálných workerů:
      - Počasí monitor → Telegram notifikace
      - Realitní hlídač → email
      - Zpravodajský aggregátor → denní report
  B9. Agent builder vylepšení — konverzační tvorba agenta přes chat
```

**Milestone:** "Ráno dostanu na Telegram zprávu od C3, že se změnilo počasí / vyšel nový pozemek."

### Fáze C: PROJEKTY — reálné nasazení (1–2 týdny + průběžně)
**Cíl:** Jeden reálný projekt postavený přes D1→CODE→R2→D2→R1.

```
Týden 6:
  C1. Multi-session projekt — planner si pamatuje stav přes dny
  C2. Progress tracking — co je hotové, co zbývá, blocker list
  C3. Spustit reálný projekt přes pipeline (tvůj web / smart home)
  C4. Opravit co se rozbije (tohle je ta nejdůležitější část)
```

**Milestone:** "C3 mi pomohl postavit [konkrétní věc] od návrhu po deploymentu."

Tohle je fáze, kde se má hlavně **používat**, ne programovat. Pipeline existuje, teď potřebuje kilometry.

### Fáze D: SPECIALISTÉ — nový koncept (6–8 týdnů)
**Cíl:** Účetní specialista funguje end-to-end.

Tohle je největší architektonická změna. Specialista ≠ expert ≠ worker. Je to nová entita:

```
Týden 7–8: Architektura
  D1. Specialist Contract — definice: co je specialista, co umí, co potřebuje
      - Knowledge base (zákony, sazby, šablony)
      - Bound tools (generátor faktur, kalkulačka DPH)
      - Routines (měsíční kontrola, připomínky)
      - Memory (klient X má IČO Y, poslední faktura Z)
  D2. Specialist Runtime — jak specialista zpracovává požadavek
      - Chat interface (ptám se účetního)
      - Tool execution (generuj fakturu)
      - Routine scheduling (připomeň mi za měsíc)

Týden 9–10: Nástroje
  D3. Document generator engine — šablony + data → PDF/DOCX
      - Faktura, kontrolní hlášení, smlouva
  D4. Knowledge base per specialista — vektorový store nebo FTS5
  D5. Routine engine — specialista si naplánuje vlastní úkoly (sub-workery)

Týden 11–12: Účetní jako pilot
  D6. Účetní specialista end-to-end:
      - "Vygeneruj fakturu pro klienta X" → PDF
      - "Kdy je deadline pro kontrolní hlášení?" → odpověď + reminder
      - "Zkontroluj nové předpisy" → web search + shrnutí
  D7. Testování + iterace

Týden 13–14: Generalizace
  D8. Druhý specialista (správce domácnosti / AI researcher)
  D9. Specialist builder — konverzační vytvoření nového specialisty
```

**Milestone:** "Řeknu C3: vygeneruj fakturu pro klienta Novák — a dostanu PDF."

---

## Celkový timeline

```
Fáze A: CHAT            ████████░░░░░░░░░░░░░░░░░░░░  Týden 1–2
Fáze B: WORKERI          ░░░░░░░░████████████░░░░░░░░  Týden 3–5
Fáze C: PROJEKTY         ░░░░░░░░░░░░░░░░░░░░████░░░░  Týden 6–7 (+ průběžně)
Fáze D: SPECIALISTÉ      ░░░░░░░░░░░░░░░░░░░░░░░░████████████████  Týden 7–14
                         ─────────────────────────────────────────
                         Měsíc 1          Měsíc 2          Měsíc 3
```

**~3 měsíce** na kompletní vizi. Z toho:
- Po 2 týdnech: Chat funguje na produkční úrovni
- Po 5 týdnech: Workeri reálně běží a notifikují
- Po 7 týdnech: První projekt postavený přes pipeline
- Po 14 týdnech: Účetní specialista generuje faktury

---

## Princip řazení

Řazení není náhodné:

1. **Chat první** — protože ho budeš používat každý den a okamžitě. A protože každý
   další pilíř staví na kvalitním chatu (specialista potřebuje kvalitní syntézu,
   worker potřebuje kvalitní search).

2. **Workeri druzí** — protože jakmile běží, pracují za tebe 24/7.
   Každý den zpoždění = jeden den, kdy hlídače nepracují.

3. **Projekty třetí** — protože pipeline existuje, jen potřebuje reálné testování.
   Tady se nemá programovat, ale používat.

4. **Specialisté poslední** — protože jsou architektonicky nejsložitější
   a stavějí na všem ostatním (chat quality, document generation, tools,
   scheduling, memory).

---

## Co NEDĚLAT (aktualizováno)

1. Neimplementovat autonomy/observability/skills/copilot/ecosystem z ROADMAP v43
2. Nestavět vlastní frontend framework — vanilla JS stačí
3. Neoptimalizovat performance před dokončením features
4. Neprogramovat planner, dokud ho nezačneš používat na reálném projektu
5. Nestavět specialistu, dokud chat + workeri nefungují spolehlivě
6. Nedělat "ještě jedno vylepšení" na hotových věcech — jít dál

---

*Tento dokument nahrazuje ROADMAP.md (v43.2) a CHAT-QUALITY-ROADMAP.md (v55.2).*
