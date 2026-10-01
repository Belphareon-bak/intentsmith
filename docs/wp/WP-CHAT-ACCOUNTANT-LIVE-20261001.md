# WP — účetní DPH přes skutečný lokální model a M1

**Stav:** izolovaný kandidát z čistého integračního `8bf1c069ae87007773d1f196c8680b21c56bd083`,
`REVIEW_PENDING / LIVE_NOT_RUN / NOT_DEPLOYED`. Živá GPU sada se nespustí před
operátorským signálem po společném auditu; lokální zelená orákula nejsou
modelový ani release důkaz.

**Autorita a rozsah:** operátor žádá fyzické ověření vybraného specialisty
`accountant-cz` přes skutečný M1 HTTP chat a privátní SQLite na jediném vstupu:
základ 10 000 Kč, DPH 21 %, rok 2025, ČR. Uživatelská M1 hranice plyne z
`PRODUCT.md` §2 a `CONTRACT.md` §4. Kandidát navazuje na řízený účetní průchod
v `WP-CHAT-ACCOUNTANT-HTTP-20261001`. Vlastní větev a worktree:
`work/chat-accountant-live-20261001` a `intentsmith-chat-accountant-live-20261001`.
Produkční server, instalovaná DB, daňová pravidla a modelová vazba se nemění.

**Vlastněné cesty:** `tests/chat-accountant-live.test.js`, společný účetní
oracle `tests/helpers/chat-accountant-vat-oracle.js`, jeho negativní sada
`tests/chat-accountant-vat-oracle.test.js`, úzké sdílení s existujícím
`tests/chat-accountant-model-contract.test.js`, registr a odvozené počty.
Nový test používá stávající `scripts/provider-capture.js` a globální
`gpu-evaluation-lock`; nepřidává paralelní modelovou cestu.

## Průchod a orákulum

Test před GPU ověřuje přesný čistý source SHA a explicitní
`INTENTSMITH_CHAT_ACCOUNTANT_LIVE=1`; přímý běh navíc vyžaduje
`KEEP_TEST_RUNTIME=1`. Drží globální GPU lease, ověří bez cizího NVIDIA
compute a Ollama rezidenta, dostupné prostředky, `qwen3.5:27b` s přesným
instalovaným digestem
`7653528ba5cba4dd8e19da24aaddc7f4d0b5ecd93571c0825dfd4137958ec06e`
a zprostředkuje model přes soukromou loopback capture proxy. Vlastněný
`src/server.js` má oddělené adresáře a SQLite.

Přes HTTP musí najít a vybrat `accountant-cz`, poslat jediný
`ConversationCommand` a získat právě **jedno dokončené** modelové volání
`/api/chat`: HTTP 200, `done=true`, `done_reason=stop`, kladné prompt tokeny,
`num_ctx <= 4096`, přesný model a povolený digest. Capture zaznamená SHA256
syrových request/response bajtů dřív, než odpověď dojde produktu. Terminální
`message.content` musí být přesně shodný s finálním M1 textem; další provider
volání znamená selhání.

Stejný sdílený oracle jako řízený M1 test požaduje metadata
`executionStatus=SUCCESS`, `accountant.vat_calculator`, přesné parametry
`{amount:10000,year:2025,rate:'21',direction:'add'}` a strukturovaný
výsledek `base=10000, vat=2100, total=12100, rate_percent=21, year=2025`.
Finální provider prompt musí obsahovat tento skutečný tool výsledek, ne jen
uživatelské číslice. Věcný oracle ve finální odpovědi vyžaduje správně
označený základ, DPH a cenu s DPH, sazbu, rok a ČR, oddíly „Předpoklady“ a
„Nezahrnuje“ a povinnou formulaci upozornění na nezávaznou daňovou radu a
konzultaci poradce. HTTP historie i přímý read-only SQLite dotaz musí mít
právě uložený uživatelský vstup a shodný asistenční text.

Negativní offline mutace odmítají chybné tři částky, dvě částky DPH v jedné
větě i prohozené štítky základu a DPH v jednom souvětí, sazbu, rok, jurisdikci,
chybějící oddíly nebo disclaimer, nedokončený/cizí provider, jiný M1 text,
prázdný seznam omezení, pozdní větu za disclaimerem, protichůdnou další
částku DPH, chybějící tool prompt a chybný strukturovaný VAT výsledek. Parser
pro tento scénář svazuje každou měnovou částku s příslušným štítkem a odmítá
nejednoznačné vícenásobné částky v jeho úseku napříč celou finální odpovědí,
včetně „Předpoklady“ a „Nezahrnuje“. Citovaná rozporná částka nemá obecnou
výjimku; oracle ji z opatrnosti odmítne. Jde o ohraničený výpočet, ne obecný
hodnotitel daňových rad.

**Důkazové hranice:** validní provider řádek a přesný HTTP/SQLite výsledek
vzniknou pouze při úspěchu. Verdiktový soukromý JSON se stavem `PASS` vzniká
až po zastavení serveru i proxy a uvolnění lease; váže source SHA, model,
instalovaný digest, verzi providera, capture SHA a VAT orákulum. Pokud
obsloužený model nevrátí vlastní digest, capture váže jeho jméno a preflight
instalovaný digest, nikoli nezávislý digest obsloužené instance. Sada je v
registru `BLOCKED`/GPU opt-in. Jeden fyzický běh by neprokázal obecnou
správnost daňových rad, opakovatelnost ani mobilní klienta.

**Bezpečné přípravné ověření:** pouze offline oracle, řízený M1 účetní test,
validace registru, dokumentační kontrola a `node --check` živé sady.
První negativní oracle s pouhou kontrolou typu odpovědi skončilo podle
očekávání `Missing expected exception: VAT amount`. Po doplnění hodnotových
kontrol offline sada prošla **2/2**, existující řízený M1 účetní test po
sdílení orákula **2/2**, dokumentační validace **160/160**, syntaxe živé sady
a registr **582** programů prošly. Vynucený neopt-in běh skončil ještě před
lease jako `LIVE_NOT_RUN` (záměrná negativní kontrola). Fyzický Ollama běh
zatím **neproběhl**.

Nezávislá revize kandidáta `afb73b05` vrátila **CHANGES_REQUIRED**: starý
oracle falešně přijal dvě různé částky DPH v jedné větě i prohozené štítky
základu a DPH ve stejném souvětí. Přímé opakování obou přesných mutací na
`afb73b05` dalo `FALSE_GREEN` a samostatná negativní regrese na první případ
byla na starém orákulu červená (`Missing expected exception`). Nová
verze ověřuje jedinečnou částku za každým štítkem; oba konkrétní případy
odmítá a přímé offline testy orákula **4/4** i řízeného M1 **2/2** procházejí.
Oprava zůstává `REVIEW_PENDING`, živý model stále `LIVE_NOT_RUN`.

Druhá nezávislá revize `67d229a5` vrátila **CHANGES_REQUIRED**: explicitní
`- DPH je 2 200 Kč.` v oddílu „Předpoklady“ starý rozsah vůbec nečetl.
Red-first regrese měla na `67d229a5` **2 FAIL** pro rozpornou DPH v
„Předpoklady“ a rozpornou celkovou cenu v „Nezahrnuje“. Opravený oracle
prochází celý finální text; přímé offline testy mají **6/6**, řízený M1
**2/2**. Nezávislé re-review této nové opravy stále čeká.

Živý příkaz až po review a uvolnění GPU slotu na přesném čistém commitu:

```sh
export PATH=/home/belphareon/.nvm/versions/node/v24.21.0/bin:$PATH
INTENTSMITH_CHAT_ACCOUNTANT_LIVE=1 KEEP_TEST_RUNTIME=1 \
  INTENTSMITH_TEST_SOURCE_REVISION=$(git rev-parse HEAD) \
  node --test tests/chat-accountant-live.test.js
```

Privátní capture a evidence zůstávají ignorované v `.intentsmith-artifacts/`.
Po sloučení je nutné review a případný živý běh zopakovat na přesném
integračním source SHA.
