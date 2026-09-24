# GPU hunt: převzetí uložených odpovědí po změně známkování

25. 9. 2026 · vývojová větev `work/hunt-model-controls-20260917` · **IMPLEMENTATION_REVIEW / NO_GO**

Běžný hunt nyní může najít dokončený sběr se starším hashem hodnoticího kontraktu, pokud se změnilo jen známkování. Před převzetím spouští přesně tentýž validátor, který se spouští před inferencí hodnotitele: kontroluje roli a sadu, přesný digest odpovídajícího artefaktu, verzi poskytovatele, počet a identitu úloh, hash všech veřejných vstupů a generačních voleb, všechna opakování a identitu každé uložené odpovědi. Změna otázky, produkčního promptu, parametru inference, modelu nebo poskytovatele vyžaduje nový sběr. Původní řádek zůstává neměnný; případná známka dostane nový kontrakt a odkaz na původní sběr.

Přesný výstup živého auditu je v [důkazním JSON](evidence/2026-09-25-hunt-capture-reuse.json). Opakovatelný read-only příkaz:

```bash
node scripts/audit-hunt-collections.mjs --db=/home/belphareon/Projects/intentsmith/data/c3.db --provider-version=0.34.0-intentsmith.1
```

Nad živou DB k datu dokumentu prošlo kontrolou **11 dokončených sběrů**: D1 3, D2 2, R1 2, R2 2 a CHAT 2. Ve všech pěti rolích jde pouze o **jeden přesný artefakt qwen3.8**, takže to není dvoukandidátové srovnání. Všech 11 má starší hash kontraktu a kompatibilní zachycené vstupy. **Pro aktuálně běžícího poskytovatele není automaticky znovupoužitelný ani jeden:** uložené odpovědi vznikly na `0.34.2-intentsmith.1`, živá služba hlásila `0.34.0-intentsmith.1`. Znovupoužití by bylo přípustné až při přesném obnovení odpovídajícího poskytovatele a nové kontrole jeho identity; samotný soulad vstupů nestačí. Dalších **448 průběžných checkpointů** je neúplných a nelze je vydat za celé měření. CODE a VISION se touto cestou neznámkují.

Audit ani tato změna neudělují známky, přejímku hodnotitelů nebo rozhodovací autoritu. V živé DB zatím nejsou přijatí hodnotitelé pro nové sémantické kontrakty, a tudíž je počet kvalifikovaných rolí stále **0/7**. Navíc je vývojový kód oddělený od nainstalované release. Před rozhodováním je nutné přijmout nezávislou dvojici hodnotitelů, sebrat srovnatelná data druhého kandidáta a provést oddělené provozní ověření.

Regresní ověření používá umělou in-memory DB: starší známkovací hash je znovupoužitelný jen při shodné verzi poskytovatele; jiný digest, verze poskytovatele, otázka nebo nastavení inference ne. Uložení známky a lidského rozsouzení navíc vrací sdílený filtr poskytovatele na původní hodnotu, takže historický běh nepřepne pohled na další kandidáty. Cílené testy sběru, hodnocení a orchestrace prošly; žádná modelová inference ani zápis do živé DB při auditu neproběhly.
