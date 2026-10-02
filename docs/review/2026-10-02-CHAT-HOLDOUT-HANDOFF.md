# Zapečetěný holdout — předání zmrazeného chatového kandidáta

Stav: **SEALED / NOT_RUN / REVIEW_PENDING**. Autorita: explicitní zadání
operátora z 2. 10. 2026, známé reprodukce `recipient-bob` a `gpu-composite`
a režim `--holdout FILE --holdout-sha256 HEX`. Dřívější návrh 60 dialogů a
stav AUTHOR_UNKNOWN jsou překonané skutečnou pečetí od koordinátora.

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
   větev `review/chat-quality-holdout-candidate-20261002` a ověří vzdálený SHA.
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
PATH=/home/belphareon/.nvm/versions/node/v24.21.0/bin:$PATH \
CHAT_PROBE_NO_DIRECT=false node scripts/measure-m1-l3.js --live \
  --phase holdout-1 --holdout "$CHAT_HOLDOUT_FILE" \
  --holdout-sha256 2431296e7a1583329fb4185a1dbbe6610749985385cd1afa2c6952428b63e9ff \
  --record .intentsmith-artifacts/chat-quality-20261001/live/holdout-runs.json
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

Známé aplikační reprodukce byly opravené a změřené 20krát před i po:
e-mail i GPU mají 20/20 splněných aplikačních podmínek, vlastní významové
hodnocení 39/40 kvůli jedné zbývající modelové faktické chybě. Není to
nezávislý holdout výsledek. Původních 53 případů včetně F14–F20 jsou regrese.

Kvalitativní přejímka stále **NO_GO**. Samostatně zůstávají čtyři technická
FAIL, tři BLOCKED a CI_NOT_RUN. Vlastník integrace pro routing a automatický
CI trigger nebyl určen; [předání CI](2026-10-02-CHAT-CI-HANDOFF.md) a
[přesná routing reprodukce](2026-10-02-CHAT-ROUTING-ROOT-HANDOFF.md) jsou připravené.
Workflow již má ruční `workflow_dispatch`; přidání automatického triggeru
chatové větve zůstává integrační práce. Srovnání modelů ani změna bindingu
nebyly znovu otevřené. Žádný PR, merge nebo produkční nasazení neproběhlo.
