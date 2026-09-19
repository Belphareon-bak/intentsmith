# Sběr odpovědí dvou kandidátů pro každou roli

Stav: PREPARED — výsledky dosud nejsou hodnocené ani přijaté.

Autorita: explicitní zadání operátora a WP-GPU-HUNT-HANDOFF-20260919 §5,
pravidla WP-GPU-HUNT-DIRECTION-20260919. Evaluační kontrakt se nemění.

| Role | Kandidáti | Úlohy × opakování pro jeden model |
| --- | --- | --- |
| D1, D2, R1, R2 | qwen3.8:latest, devstral-small-2:latest | 8 × 3 pro každou roli |
| CODE | qwen3.8:latest, devstral-small-2:latest | 7 × 3 |
| CHAT | qwen3.8:latest, devstral-small-2:latest | 40 × 3 |
| VISION | qwen3.8:latest, ornith-1.5:9b | 12 obrázků + kontrola bez obrázku, vše 3× |

Výběr vychází z dostupných lokálních artefaktů, dosavadních průzkumných
výsledků CODE/R2 a deklarovaných schopností `/api/tags`. Je to předpoklad
vhodnosti k testu, nikoli závěr o kvalitě. Qwen3-coder se na CODE neopakuje.

## Předem stanovený profil

- Celkem 552 odpovědí. Celá sada, žádný výběr výhodných úloh nebo opakování.
- D1/D2/R1/R2: kontext 16 384, výstup 8 192 tokenů, limit volání 600 s.
  Předchozí limit 2 048 omezoval dokončení odpovědí. Nový profil slouží
  průzkumu schopností a **netvrdí shodu s produkčním workflow**. Stejný pro oba.
- CODE: kontext 16 384, výstup 4 096, 300 s; CHAT: 16 384 / 2 048 / 300 s.
- VISION: kontext 4 096, výstup 1 024, 120 s. Ostatní nastavení zachována
  v jednotlivých úlohách. `think:false`, bez nástrojů, bez historie pokusů.
- Výslovně doplněn typ a enum `confidence` do zadání CODE f63d14d5eb61
  a zachování rušení timeru před čtením těla odpovědi v adb1258cfec0.
  Jde o nové hashované zadání; staré odpovědi se podle něj nepřeznámkovávají.
- Plné umístění profilu na GPU, nejvýše 22 000 000 000 bajtů podle `/api/ps`.
  Telemetrie paměti zařízení se navíc vzorkuje každé 2 s; není to důkaz
  přesného maxima mezi vzorky. Desktopová paměť je odlišná od paměti modelu.
- Vlastněný provider 0.34.2-intentsmith.1, port 11435. Identita artefaktu
  i providera je ověřena z každé odpovědi. Časový rozpočet každého běhu 240 min.
- Žádné kalibrační ani hodnoticí volání, žádné skóre v datech sběru.
  Technická chyba a vyčerpání limitu zůstávají viditelné včetně původní odpovědi.
- Timer vypnutý, žádný import do produkce, změna rolí, mazání ani doporučení.

`--collect-only` v existujícím `scripts/manual/all-role-evaluation.mjs`
odděluje sběr od starého hodnoticího režimu. Referenční odpovědi, rubriky
a testovací orákula se modelu neposílají; ukládají se pouze pro pozdější review.
Export k hodnocení bude bez mých známek; moje stanovisko dostane samostatný soubor.

Ověření před spuštěním: `node --test tests/role-collection.test.mjs` (6 kontrol),
příprava všech 276 pokusů jednoho modelu bez inference, odmítnutí kombinace
`--collect-only --judge=...`. Tato evidence nedokazuje kvalitu úloh ani modelů.

Privátní evidence: `/home/belphareon/Projects/coworker/intentsmith-hunt-raw-pairs-20260919`.
Původní sady jsou vývojové případy, nikoli nový holdout. Uzavření produkční T5
cesty, kvalifikace soudce a provozní zkouška zůstávají oddělené práce; tento sběr
se neopírá o jejich nehotovou rozhodovací autoritu.
