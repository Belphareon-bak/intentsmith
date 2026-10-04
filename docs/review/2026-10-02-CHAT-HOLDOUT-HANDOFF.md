# Zapečetěný holdout — předání zmrazeného chatového kandidáta

Stav k 4. 10.: **SEALED / WAITING_OPERATOR_UNSEAL / NOT_RUN / NO_GO**.
Zmrazený kandidát **`9591ea1b07bc4b639a102bcc421f9d46b8f9906b`**,
vzdáleně ověřená pevná větev `review/chat-quality-gemma-candidate-20261004-v2`.
CHAT `gemma4:26b`, digest
`08ae7ec1744bd7f451c4a530afb39d2673ad9d07a8369b8a33a3613b41212a68`.
D1 zůstává `qwen3.5:27b`, digest
`7653528ba5cba4dd8e19da24aaddc7f4d0b5ecd93571c0825dfd4137958ec06e`.
Runner ověřuje oba deklarované artefakty před/po běhu i u každé inference,
oba na měřicím 4K rozpočtu. Staré pevné kandidáty `c7f03d56` a `d096aa49`
zůstávají neměnné; dokumentační HEAD pracovní větve jej nenahrazuje.

Registry 592 PASS, cílené 4 PASS, úplný profil přímo na tomto SHA:
**399 PASS / 4 FAIL / 3 BLOCKED**, exit 1. [Skutečná CI](https://github.com/Belphareon-bak/intentsmith/actions/runs/37222976678)
SUCCESS na témže SHA, všechny vývojové kroky provedené, pouze vývojový subset.
Syntetický dummy 3×3 PASS, tři schválená čtení a tři zápisy, přesné bajty,
0 provedení před schválením. Původní 53×3 regrese je úplná, vlastní významové
hodnocení **123/159 = 77,36 %**, 13,84 % zbytečných zastavení, 0 nalezených
kritických chyb. Je to **NO_GO**, nikoli kvalitativní přejímka.
[Průběžný report S19–S20](../wp/WP-CHAT-QUALITY-20261001-PROGRESS.md)
obsahuje konkrétní modelové i aplikační nálezy. Před odpečetěním doporučuji
samostatný cílený milník zachování read-only otázek a interpretace souborových
akcí s Gemmou. Tento kandidát se dál neladí; nové opravy patří do nového
kandidáta s novým ověřením. Privátní dešifrovaná cesta stále není předaná.

Autorita: explicitní zadání operátora z 2. 10. známých reprodukcí,
SHA-ověřeného runneru a tří slepých sérií; ze 4. 10. výběr Gemmy pro CHAT.
Produkční CHAT je APPLIED / DIRECT_CONFIRMED / VERIFIED; aplikace zůstává
release `c84b88cd`, chatové opravy jsou v kandidátní větvi. Vedlejší dopady
obnovy uložených rolí a neúspěšná notifikace jsou v S16. Žádný PR/merge ani
nasazení chatové aplikace neproběhl. Dřívější návrh 60 dialogů a AUTHOR_UNKNOWN
jsou překonané skutečnou pečetí od koordinátora.

Pečeť: větev `review/chat-holdout-seal-20261002`, vzdáleně ověřený commit
`6a9d1dbe54adef4bb7cf2114afe10c58799a3a05`.
[Autorův protokol](https://github.com/Belphareon-bak/intentsmith/blob/6a9d1dbe54adef4bb7cf2114afe10c58799a3a05/docs/review/2026-10-02-CHAT-HOLDOUT-SEAL.md).
Worker četl pouze tento Git dokument. Zapečetěný adresář neotevřel ani
neprohledával, nic nedešifroval. Izolace autora je podle koordinátora
organizační, technicky nevynucená; worker ji sám neověřoval.

Deklarovaná struktura: 96 kroků, 60 česky / 36 anglicky, 9 oblastí,
17 vícekrokových dialogů a 14 schvalovaných akcí (6 čtení, 8 zápisů).
Obsah neznáme. SHA-256 budoucího dešifrovaného souboru podle Git pečeti:
`2431296e7a1583329fb4185a1dbbe6610749985385cd1afa2c6952428b63e9ff`.

Předání probíhá v tomto pořadí:

1. Chat worker zmrazí čistý commit včetně runneru, pushne pevnou kandidátní
   větev `review/chat-quality-gemma-candidate-20261004-v2` a ověří vzdálený SHA.
   Průběžný report se publikuje na `work/chat-quality-20261001`; následný
   dokumentační commit nesmí změnit zmrazeného kandidáta ani jeho runner.
2. Operátor potom dešifruje do privátního umístění mimo repozitář, mode 600,
   ověří celý SHA a vyprázdní cache GPG agenta. Worker dostane cestu k tomuto
   souboru; původní zapečetěný adresář zůstává zakázaný.
3. Worker před inferencí ověří HEAD proti předanému SHA a čistý strom.
   Případný pozdější dokumentační HEAD přepne pouze ve vlastním čistém
   checkoutu zpět na pevného kandidáta. Cizí checkouty se nemění.
4. V privátní evidenci spustí `holdout-1`, `holdout-2`, `holdout-3` za sebou,
   pod existující GPU lease, beze změny modelu, runneru, corpus a konfigurace.
   Mezi sériemi nečte ani nehodnotí odpovědi; sleduje jen stav, počty,
   transport a identitu. Fsynced úplné odpovědi a efekty zůstávají pro hodnotitele.
   Případné GPU čekání není souhlas s vyložením cizího modelu.
5. Koordinátor vytvoří zaslepený X/Y balík a zajistí nezávislé hodnocení.
   Worker nevytváří vlastní známky holdoutu ani podle něj průběžně neladí.
   Po použití je corpus exponovaný a další přejímka vyžaduje novou pečeť.

Příklad jedné série (privátní cestu poskytne operátor, nepoužívat původní
zapečetěný adresář):

```bash
git switch --detach 9591ea1b07bc4b639a102bcc421f9d46b8f9906b
PATH=/home/belphareon/.nvm/versions/node/v24.21.0/bin:$PATH \
CHAT_PROBE_NO_DIRECT=false node scripts/measure-m1-l3.js --live \
  --phase holdout-1 --holdout "$CHAT_HOLDOUT_FILE" \
  --holdout-sha256 2431296e7a1583329fb4185a1dbbe6610749985385cd1afa2c6952428b63e9ff \
  --model gemma4:26b \
  --model-digest 08ae7ec1744bd7f451c4a530afb39d2673ad9d07a8369b8a33a3613b41212a68 \
  --record .intentsmith-artifacts/chat-quality-20261004/holdout/holdout-runs.json
```

Runner kontroluje SHA před parsováním/preflightem/inferencí a znovu v child
procesu. Odmítá filtr případů, vypnutí A/B, nesprávnou fázi, nečistý zdroj,
změnu manifestu/konfigurace a opakování již celé fáze. Přijímá libovolný kladný
počet kroků a fixture, `usedForTuning: false`, `variant: "holdout"`.
Výpis neobsahuje odpovědi, souborové bajty ani modelové chybové texty.
Provedení a efekty se hodnotí z původní M1/M2 evidence; text modelu není
provedení. A je stále zjednodušená diagnostická cesta se stejnou příchozí
historií B, nikoli nezávislý dialog nebo cesta s nástroji.

Kritéria zůstávají ≥95 % užitečných reakcí, ≤5 % zbytečných zastavení,
0 kritických chyb, tři celé nezměněné série. Reportovat odděleně jazyk,
rodiny, latenci/načtení modelu a skutečné efekty. Samotných 36 anglických
kroků neprokazuje jazykovou paritu v mezích pěti procentních bodů.

Historické Qwen aplikační reprodukce byly opravené a změřené 20krát před i po:
e-mail i GPU mají 20/20 splněných aplikačních podmínek, vlastní významové
hodnocení 39/40 kvůli jedné zbývající modelové faktické chybě. Není to
nezávislý holdout výsledek. Původních 53 případů včetně F14–F20 jsou regrese.

Kvalitativní přejímka stále **NO_GO**. S Gemmou obě známé reprodukce mají
20/20 + 20/20 aplikačních podmínek, vlastní užitečnost 40/40 a 0 efektů;
nejde o doklad obecného zlepšení proti historickému 39/40. Samostatně
zůstávají čtyři technická FAIL a tři BLOCKED. CI_NOT_RUN je pro aktuální
kandidát překonán skutečným Actions výsledkem výše; společný integrační
vlastník a ROOT routing zůstávají otevřené. [CI předání](2026-10-02-CHAT-CI-HANDOFF.md)
a [přesná routing reprodukce](2026-10-02-CHAT-ROUTING-ROOT-HANDOFF.md).
Použít nový skutečný holdout record výše, nikdy dummy nebo regresní record.
Worker jeho odpovědi nebude číst ani známkovat; nezávislé hodnocení zajistí
koordinátor. Předané pevné SHA se nepřepisují následným dokumentačním commitem.
