# IntentSmith — produktový kontrakt

**Verze:** 3 · **Datum:** 2026-08-21 · **Vlastník:** operátor ·
**Stav: PŘIJATO OPERÁTOREM 2026-08-21** společně s `ROADMAP.md`.
Verze 2 byla pracovní návrh; přijetí proběhlo s jednou opravou, která srovnala
závazek 3 a tabulku zděděných ploch s rozhodnutím operátora z 2026-08-19
zapsaným v `DIRECTION.md`. Explicitní rozhodnutí operátora zůstávají v
`DIRECTION.md`.

> Tento dokument je autoritou pro to, **komu IntentSmith slouží, jaký problém
> řeší a co znamená hotový produkt**. Způsob práce určuje `CONTRACT.md`, pořadí
> `ROADMAP.md` a aktuální fakta `SYSTEM-MAP.md`.

## 1. Definice produktu

IntentSmith je local-first AI pracovní prostředí pro technického power usera,
který chce na vlastním hardwaru konverzovat, rozumět svým projektům a bezpečně
nad nimi provádět práci. Jeho odlišnost není počet funkcí, ale **řízené
provádění**: uživatel zůstává autoritou nad daty, sítí, nástroji a změnami,
zatímco znovupoužitelné skills, expertizy, paměť a Code Intelligence zvyšují
kvalitu práce bez ztráty kontroly.

### Primární uživatel

Samostatný technický power user na Linuxu, který:

- používá lokální modely a nechce povinnou cloudovou službu;
- pracuje nad vlastními repozitáři, dokumenty a dlouhodobými projekty;
- chce spojit konverzaci, plánování a skutečné provedení práce;
- vyžaduje dohledatelnost, potvrzení citlivých efektů a možnost vše zastavit;
- chce systém rozšiřovat bez přepisování jeho jádra.

IntentSmith 1.0 není týmový SaaS ani autonomní systém bez operátora.

## 2. Nevyjednatelné produktové závazky

1. **Autorita uživatele.** Každý významný efekt nad soubory, procesy,
   konfigurací, sítí nebo externí službou je připsatelný konkrétnímu požadavku,
   omezený rozsahem a podle rizika vyžaduje schválení.
2. **Local-first.** Běžná práce nevyžaduje internet ani povinný cloud. Lokální
   Ollama může obsluhovat všechny modelové role.
3. **Žádná tichá odchozí komunikace.** Žádná odchozí cesta neběží skrytě ani
   se netváří jako lokální: každá je deklarovaná, auditovaná a degraduje sama,
   takže bez internetu produkt funguje dál. Síť smí být použita, nikdy
   vyžadována. **Automatické model discovery je od rozhodnutí operátora
   2026-08-19 výchozím stavem zapnuté** (`C3_ENABLE_ONLINE_DISCOVERY`, vypíná
   se hodnotou `false`) — bez něj katalog tiše stárne a scoring doporučuje
   modely nahrazené před měsíci, takže vyhledávání aktuálně nejefektivnějších
   modelů je **záměr produktu, ne vedlejší efekt**. Zapnutá cesta tím ale
   nepřestává být vázaná na společnou outbound policy, approval, audit
   a rollback. Explicitní webový nástroj, marketplace nebo vzdálená služba
   zůstávají samostatné, uživatelem vyvolané a auditované schopnosti.
4. **Data pod kontrolou.** Uživatel ví, kde data leží, může je exportovat,
   zálohovat, obnovit a odstranit. Projektová data nepřecházejí mezi projekty
   bez explicitního opt-inu. **Síť má směr:** ven se chodí pro informace
   a open source, dovnitř se nechodí vůbec — žádná projektová ani aplikační
   data nejsou dosažitelná z internetu a produkt nevystavuje listener mimo
   loopback (invariant L0-10). Vzdálený přístup je samostatná schopnost
   Remote Companion release, ne vlastnost core 1.0.
5. **Učení nerozšiřuje pravomoc.** Naučená informace sama nesmí změnit kód ani
   konfiguraci, udělit oprávnění, spustit efekt nebo překročit projektovou
   hranici. Každá učící smyčka je lokální, auditovatelná a vratná.
6. **Modularita s jasnými konektory.** Nástroje, skills, expertizy, specialisté
   a agenti rozšiřují systém přes verzované kontrakty. Modul nesmí získat
   interní pravomoc pouhým importem implementačního detailu.
7. **Pozorované chování má přednost před deklarací.** Produktový claim platí,
   až když je prokázaný na hranici, kde jej zažívá uživatel.

## 3. Co musí umět IntentSmith 1.0

### Každodenní práce

- zahájit a obnovit konverzaci s lokálním modelem;
- připojit konverzaci ke konkrétnímu projektu a zachovat její historii;
- odpovědět deterministicky bez modelu tam, kde model není potřeba;
- degradovat srozumitelně, když model nebo jiná deklarovaná prerekvizita chybí;
- zobrazit průběh, umožnit zrušení a nezapsat zrušený či selhaný turn jako
  úspěšnou odpověď.

### Práce nad projektem

- sestavit relevantní kontext z projektu, paměti a Code Intelligence;
- nechat Code Intelligence učit se schválené projektové konvence a opakující
  se vzorce a s doloženou provenance je použít v příštím project contextu;
- vysvětlovat a vyhledávat v kódu bez nechtěných změn;
- navrhnout změnu, ukázat její rozsah a po schválení ji atomicky provést;
- při selhání zachovat nebo obnovit původní stav;
- vést projekt od záměru přes plán a provedení ke kontrole výsledku.

### Rozšiřitelnost

- používat expertizy ke zvýšení kvality výstupu;
- používat nástroje přes jednotnou policy, approval, timeout, cancellation a
  auditní hranici;
- používat skills jako hotové, verzované procedurální know-how: skill nese účel
  a trigger, typované vstupy, fixní i proměnné části, prompty nebo šablony,
  pravidla volby nástrojů, checkpointy/approvaly a kritéria kvality i výstupu;
  co už je ve skillu definované, se znovu nevymýšlí;
- dodat platformu specialistů a **jeden skutečný end-to-end scénář** specialisty;
- dodat platformu agentů a **jeden skutečný end-to-end scénář** agenta.

### Self-learning

Učení není samovolný přepis produktu. Verze 1.0 podporuje uzavřenou smyčku:

```text
pozorování → scoped evidence → návrh adaptace → gate → měřitelný výsledek
           → audit → rollback / decay / forget
```

Minimálně jedna taková smyčka musí být zapojená do skutečného uživatelského
scénáře Code Intelligence v rámci stejného projektu. Samostatně existuje
confidence decay, TTL, explicitní forget a retenční mazání; žádný z těchto
mechanismů nenahrazuje ostatní.

### Produktové rozhraní

- **IntentSmith Studio** postavené na dnešním C3 Studio/Theia kódu je hlavní
  desktopové/IDE rozhraní 1.0;
- Linux + Theia + Ollama je první podporovaná platforma;
- legacy `/architect` není cílové rozhraní ani fallback 1.0. Operátor 2026-08-21 potvrdil disposition **legacy**: neudržuje se, nevstupuje do release matice a nesmí být nabízen jako cesta k práci. Odstranění kódu je samostatné pozdější rozhodnutí, ne podmínka 1.0;
- jádro 1.0 dodá verzované a bezpečnostně oddělené rozhraní pro budoucí
  Remote Companion.

## 4. Co není součástí stejného release

- mobilní Remote Companion je samostatný navazující release; jeho UI, pairing
  ani vzdálený listener nejsou podmínkou vydání core 1.0;
- OpenCode a Serena jsou kandidáti pro pozdější vyhodnocení, ne kritická cesta
  1.0;
- povinný cloudový účet, týmová multitenance a neřízená autonomie nejsou cílem;
- náhrada fungující části open source komponentou není sama o sobě přínos.

### Zděděné plochy s podmíněným rozsahem

Funkční části C3 se nemažou jen proto, že nejsou v hlavní demonstraci. Pro 1.0
mají tuto explicitní disposition:

| Plocha | Disposition pro core 1.0 |
|---|---|
| Správa lokálních modelů | **IN** — je nutná pro Ollama role a degradaci. |
| Upgrade automatika / online discovery | **IN / GOVERNED** — rozhodnutím operátora z 2026-08-19 je discovery **default on**. Tím přestává být podmíněnou plochou a stává se **podmínkou vydání**: cesta musí prokázat outbound policy, approval, audit a rollback (`WP-M5-OUTBOUND-GATE`, invariant L0-12). Nesplněná validace blokuje 1.0; vypnutí už není náhradní řešení. |
| Notifikace | **IN pro in-app** — notifikace uvnitř Studia jsou součástí 1.0 a interní výsledek je povinný pro agent E2E. Externí kanály (mail, webhook, push) jsou **rozšíření po releasu**; testují se, jen pokud se vydají jako podporované. |
| Marketplace | **OUT pro 1.0 / TBD** — rozhodnutí operátora 2026-08-21: není součástí prvního releasu. Kód se nemaže. Pokud se později vydá jako podporovaný, vyžaduje security a install/rollback journey. |
| Media | **OUT pro 1.0 / TBD** — rozhodnutí operátora 2026-08-21: není součástí prvního releasu. Funkční parita se zachová, do release matice nevstupuje. |
| Licencování | **OUT pro 1.0 claim** — nedokončený kód se bez samostatného rozhodnutí nemaže, ale není podmínkou vydání. |
| Setup wizard | **OUT** — 1.0 má dokumentovanou instalační a konfigurační cestu. |

`CONDITIONAL` neznamená „může být rozbité“. Znamená: plocha není podmínkou
hlavního user journey, ale pokud je v artefaktu zapnutá nebo dokumentovaná jako
podporovaná, musí projít příslušnou M5/M6 validací.

### Mobilní aplikace jako vedlejší produkt

Mobilní companion **není součástí core 1.0** a nikdy jí nebyl — je to vedlejší
větev a vlastní produkt, který s IntentSmithem musí komunikovat.

Ta komunikační hranice ale není pro core bez užitku. Vytahuje otázky, které M2
stejně čekají — vlastnictví zápisu, rozhodovací rovina, approval hranice — a
řeší je dřív, takže M2 nezačíná s nesrovnalostmi a neřeší je až za běhu. Práce
na mobilu proto smí běžet souběžně a její výstup vůči core se čte jako
**prerekvizita M2**, ne jako exekuce milníku. Podrobnosti `ROADMAP.md §6`.

Vydání core 1.0 na ní nezávisí. Vlastní release mobilu je M7.

## 5. Jak poznáme hotový produkt

IntentSmith 1.0 je hotový pouze tehdy, když:

1. hlavní uživatelské cesty výše projdou z čerstvé instalace na pojmenovaném
   release kandidátu;
2. žádná aktivní cesta neobchází autoritu, approval, projektovou nebo síťovou
   hranici;
3. deterministický profil je empiricky offline, nikoliv jen tak deklarovaný;
4. modelové a GPU scénáře mají skutečný běh na podporované lokální konfiguraci;
5. data přežijí upgrade a doložený backup/restore round-trip;
6. latence, chybovost, resource limity a známé degradace jsou změřené;
7. release gate nezakrývá `FAIL`, `BLOCKED` ani neprovedený test;
8. operátor výsledek přijme po uživatelské demonstraci.

Konkrétní cesta, závislosti a milníky jsou v [`ROADMAP.md`](ROADMAP.md).
