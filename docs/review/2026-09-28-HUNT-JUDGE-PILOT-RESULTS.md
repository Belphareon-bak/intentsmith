# Místní hodnotitelé — dva dokončené piloty

28. 9. 2026. **146/146 plánovaných volání dokončeno, žádný kandidát neprošel
pilotním filtrem. STOP_CHAT / NO_GO pro autonomní známkování CHATu.**
Jde o skutečnou GPU inferenci. Pracovní výběr modelů do rolí je
[samostatné doporučení](2026-09-28-HUNT-ROLE-ALLOCATION.md).

## První varianta: pět modelů, stejné celé rozhovory

`evidence-first.3`: 16 celých rozhovorů × 5 hodnotitelů = **80 volání**.
Každý posuzoval 64 kritérií: 11 má obě reference nejvýš 50 %, 47 obě
nejméně 75 %, šest leží mimo tyto dva výběry. Čtyři scénářové skupiny,
oba autoři (Qwen3.8/Qwen3.5), oba jazyky. Modelové identity a referenční
známky nebyly v požadavcích hodnotitelů. Výluka rodiny Qwen zůstala v platnosti.

| Hodnotitel | Záchyt chyb | Nesprávně odmítnutá vysoká | Platná kritéria | MAE | „Všemu 100 %“ na shodných platných řádcích |
|---|---:|---:|---:|---:|---:|
| Gemma4 26B | 1/11 | 0/47 | 56/64 | 16,33 p. b. | 17,11 p. b. |
| Devstral Small 2 | 0/11 | 0/47 | 64/64 | 17,93 p. b. | 18,48 p. b. |
| Phi4 14B | 0/11 | 0/47 | 44/64 | 17,98 p. b. | 17,98 p. b. |
| Selene Mini 8B Q8 | 3/11 | 4/47 | 52/64 | 24,40 p. b. | 17,18 p. b. |
| Granite4 32B A9B | 0/11 | 1/47 | 64/64 | 19,16 p. b. | 18,48 p. b. |

Pravidlo bylo zmrazené před inferencí: nejméně 6/11 zachycených chyb,
90 % platných kritérií, nejvýše 10 % falešných odmítnutí vysokých a úplný sběr.
Žádný model neprošel. Přepočteno je **všech deset dvojic**, i napříč dvěma
kohortami totožných vstupů. Nejlepší sjednocený záchyt dvojice je jen 4/11.
Dvojice tedy problém nezakryje.

## Druhá varianta: soustředění na jedno kritérium

`evidence-focused.4`: všech 11 nízkých kritérií a 11 vysokých kontrol,
vybraných deterministicky před prvním voláním. Celé původní rozhovory i obě
reference zůstaly beze změny. Vysoké kontroly zajišťují zastoupení všech
16 zdrojových rozhovorů. **22 kritérií × 3 modely = 66 volání.**

Každý požadavek obsahuje celé zadání a rozhovor, jedno hodnocené kritérium
v původním znění a ostatní kritéria jako hranice, aby se nepočítala jedna
vada dvakrát. Nový prompt žádá kontrolu všech tahů a důkaz před známkou.
Dodaný deterministický kalendář ověřuje explicitní datum; nevymýšlí nezadaný
termín. Jde o společnou změnu postupu, nikoli ablační důkaz účinku jedné úpravy.

| Hodnotitel | Záchyt chyb | Nesprávně odmítnutá vysoká | Platné posudky |
|---|---:|---:|---:|
| Gemma4 26B | 2/11 | 0/11 | 21/22 |
| Selene Mini 8B Q8 | 1/11 | 0/11 | 16/22 |
| Granite4 32B A9B | 2/11 | 0/11 | 20/22 |

Stejná procentní pilotní pravidla: nejméně 6/11 chyb, 20/22 platných
posudků a nejvýš jedno falešné odmítnutí z 11 vysokých. **Znovu nikdo neprošel.**
Selene má nadále problémy i s úplností předepsaného výstupu. Výstup po limitu,
chybějící číselné pole nebo změněné schéma nejsou známkou nula hodnocenému autorovi.

## Co je změřeno a co nikoli

- Oba piloty jsou záměrně obohacené o chyby, nad stejnými čtyřmi známými
  vývojovými skupinami. Nejsou reprezentativním odhadem běžného provozu.
- 22 jednotlivých kritérií není 22 nezávislých případů. Opravený analytický
  skript uchovává původní číslo kritéria při párování autorů; lokální číslo 1
  v jednopoložkovém požadavku nesmí slít různá původní kritéria.
- První varianta hodnotí celých 64 kritérií, druhá 22 vybraných. Přímé srovnání
  odchylky je proto v JSON i na **totožných 22 původních kritériích**.
- Mez 2 p. b. pro zkreslení rozdílu autorů je nadále závazná pro následný
  širší filtr, vůči každé referenci zvlášť. Čtyři skupiny nestačí na
  požadovaných 15; tento pilot ji neprokazuje.
- Širší plán 1 375 volání ani potvrzovací vzorek nebyly spuštěny. Žádný model,
  dvojice ani role nebyly přijaty, nasazeny nebo přepnuty.

## Provoz a dohledatelnost

Operátor výslovně ponechal **250 W** a převzal nastavování příkonu. Původní
175W plány jsou zachované nespuštěné; nové plány jsou oddělené.
První 250W pokus skončil po 12 skutečných voláních na spodní rezervě RAM.
Jeden raw výstup nemá závěrečnou kontrolu prostředí, takže není způsobilý
pro report. Tato evidence zůstala beze změny a nepřenesla se do nového pilotu.

Oprava `929db9aa` uvolňuje **pouze náš vlastní model po čtyřech voláních**;
rezerva RAM nebyla snížena. Následných 80 + 66 volání dokončilo i závěrečné
kontroly. Celkem tedy proběhlo **158 skutečných volání: 12 z přerušeného pokusu
+ 146 z úplných pilotů**. Nejde o 158 nezávislých příkladů.

| Podklad | Umístění / SHA plánu |
|---|---|
| Přerušený první pokus | `/mnt/vi7000/intentsmith/evidence/hunt-judge-pilot-20260928-250w/` |
| Gemma / Devstral / Phi, 48 volání | `hunt-judge-pilot-20260928-250w-batch4/existing-three` · `d9cb1e99765050ff3de34804739863a4391594e5ea6485ef5677976260bae197` |
| Selene / Granite, 32 volání | `hunt-judge-pilot-20260928-250w-batch4/new-families` · `4c4980a222a9d52426f81fa37ab40d259cb4a32449181c40c4ed4a8ed167b08f` |
| Jednotlivá kritéria, 66 volání | `hunt-judge-focused-20260928/experiment` · `14eeb2d0e9212c99f58121dec3d7738d1f9df71515343e3db9ac069b29699700` |

Relativní cesty v tabulce jsou pod `/mnt/vi7000/intentsmith/evidence/`.
Nová příprava má zdroj `d23451ce`; následná oprava párování je jen v offline
analýze a nemění zachycené požadavky, odpovědi ani původní známky.

[Úplné posudky druhého pilotu](</mnt/vi7000/intentsmith/evidence/hunt-judge-focused-20260928/assessment/comparison.html>).
[Společná čísla, všech deset dvojic a srovnání shodných kritérií](</mnt/vi7000/intentsmith/evidence/hunt-judge-focused-20260928/combined-analysis.json>).
[Reprodukční analýza](</mnt/vi7000/intentsmith/evidence/hunt-judge-focused-20260928/combine-pilots.py>).

Ověření konečné analytické změny: **37/37 semantic-evaluation, 160/160
artifact-validation; registr 542 programů**. Předchozí změna obsluhy modelu
má oddělený log 6/6 collection-stage-provider. Testy nástrojů a GPU volání
jsou různá čísla.

## Další malý experiment

Další plný CHAT panel se nespouští. Zbývá nejvýše třetí vývojová verze
před revizí příčiny. Pro Selene má smysl odděleně prověřit formát doporučený
výrobcem (zdůvodnění a výsledek na stupnici 1–5), protože nynější společný
JSON formát nebyl jeho doporučenou šablonou. Výrobce podporuje více stupnic,
ale pro nejlepší výsledky doporučuje [tréninkové šablony](https://raw.githubusercontent.com/atla-ai/selene-mini/main/prompt-templates/README.md)
a zveřejňuje [příklad pro absolutní hodnocení](https://raw.githubusercontent.com/atla-ai/selene-mini/main/prompt-templates/absolute-scoring.yaml).
**Tento pokus zatím neproběhl a není tvrzením, že formát vysvětluje slabý záchyt.**
Ani formálně bezchybný Devstral nebo Granite v prvním pilotu chyby nezachytával.
