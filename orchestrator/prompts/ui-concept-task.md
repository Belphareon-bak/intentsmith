# 🧪 C.3 – UI CONCEPT TASK (BACKEND-DRIVEN, NO CODE)

## Kontext
Pracuješ s hotovým backendem **C.3**, který je:
- perzistentní
- deterministický
- UI-agnostický
- ovladatelný přes HTTP + SSE

Backend je **jediný zdroj pravdy**.  
UI nesmí obsahovat žádnou execution logiku ani stavové heuristiky.

K dispozici máš **neměnný kontrakt**:
UI_CONTRACT.md

---

## ⚠️ Tvrdá pravidla (NEPORUŠIT)

- ❌ NEPIŠ KÓD
- ❌ UI NESMÍ:
  - dopočítávat execution stav
  - dedukovat progress z eventů
  - rozhodovat, zda je akce povolená
  - cachovat execution stav
  - opravovat chyby backendu
- ✅ UI MUSÍ:
  - být reload-safe
  - fungovat jen podle `execution_snapshot`
  - tolerovat duplicity / reorder eventů
  - zůstat plně stateless vůči execution

Pokud by UI potřebovalo „něco dopočítat“, **zastav se a navrhni, co má dodat backend místo toho**.

---

## Tvůj úkol

Navrhni **kompletní UI KONCEPT** (bez implementace), který splňuje:

- prompt = vstup pro build / plan (a později chat)
- možnost:
  - pokračovat v posledním projektu
  - vytvořit nový projekt
  - vybrat existující projekt
- podpora dlouhých běhů, reloadů, více projektů
- UI může být vizuálně bohaté, ale architektonicky lehké

---

## Povinná struktura výstupu

### 1️⃣ UI Overview
- jaký problém UI řeší
- pro koho je (power-user, dlouhé běhy)
- proč je UI navržené tímto způsobem

---

### 2️⃣ Screen & Layout
Popiš hlavní obrazovku:

- levý sidebar (collapsible):
  - new chat
  - search
  - agents (do budoucna)
  - chats
- centrální část:
  - výběr aktivního projektu
  - hlavní prompt input
- pravý panel:
  - settings (dark mode, layout, další volby)
- spodní bar:
  - HW info (CPU, RAM, GPU, disk, network)

Pouze popis. Žádná grafika, žádný kód.

---

### 3️⃣ Project & Session Flow
Detailně popiš:
- první spuštění UI
- volbu:
  - continue last project
  - new project
  - select existing project
- jak UI komunikuje s backendem (endpointy)
- co si UI vědomě nepamatuje

---

### 4️⃣ Execution Flow (KRITICKÉ)
Popiš:
- jak UI pracuje s `executionId`
- jak reaguje na `execution_snapshot` a `execution_event`
- jak UI pozná, že execution běží / čeká / skončila

Musí být explicitně uvedeno:
UI se rozhoduje výhradně podle `execution_snapshot`.

---

### 5️⃣ Prompt vs Chat
Odděl:
- prompt (build / plan / tasks)
- chat (konzultace, vysvětlení – později)

Popiš:
- co chat nikdy nesmí dělat
- jak zabráníš obcházení build/plan flow

---

### 6️⃣ What UI Does NOT Do
Samostatná kapitola.

Očekává se výčet:
- UI nepočítá progress
- UI nehlídá povolení akcí
- UI neudržuje execution stav
- UI neřeší retry ani fallback
- UI neinterpretuje eventy jako stav

---

### 7️⃣ Open Questions for Backend
Uveď:
- kde UI potřebuje další info
- co má dodat backend
- bez frontend workaroundů

Ideálně 2–6 bodů.

---

## Kritéria hodnocení

Návrh je ÚSPĚŠNÝ, pokud:
- je realizovatelný bez změny BE
- zachovává backend jako autoritu
- je přehledný i při dlouhých bězích
- neobsahuje skrytou logiku

Návrh je FAIL, pokud:
- UI supluje backend
- dopočítává stav
- skrývá rozhodovací logiku

## OUTPUT REQUIREMENTS (MANDATORY)

You MUST produce a written UI CONCEPT in markdown.
Empty sections, TODOs, or placeholders are NOT allowed.

Your output MUST contain the following sections:

1. UI Overview
2. Screen & Layout
3. Project & Session Flow
4. Execution Flow (snapshot-driven)
5. Prompt vs Chat
6. What UI Does NOT Do
7. Open Questions for Backend

If you are unsure about any section, write assumptions explicitly.
Failure to produce this structure is considered a FAILED TASK.
