# Víc zařízení nad jednou frontou

**Stav:** chování je v kódu a **ověřené** — `tests/multi-device-approvals.test.js`
(8 PASS). Tenhle dokument popisuje, co platí a proč to tak je; test je důkaz, ne
tenhle text.

Do téhle chvíle základ držel, ale nikdo ho nepustil se dvěma zařízeními
najednou. „Drží to" a „ověřili jsme, že to drží" jsou dvě různá tvrzení.

---

## Jedna věta, ze které plyne zbytek

**Co jsem viděl, je moje. Co se stalo, je společné.**

Receipt notifikace je fakt o jednom zařízení. Rozhodnutí approvalu je fakt
o světě. Splynutí těch dvou je zdroj obou chyb, které tenhle model vylučuje:
fronta, která ukazuje každému něco jiného, a schránka, kterou jeden telefon
umlčí všem ostatním.

---

## 1. Fronta approvalů je sdílená

`GET /m1/approvals` vrací **tytéž** nerozhodnuté řádky každému zařízení, které
má `read:approvals`. Není per-device a nemá být.

Kdyby byla per-device, „nic nečeká" by znamenalo „nic nečeká *pro tebe*" — a to
je věta, kterou uživatel neumí přečíst správně. Odloží telefon v přesvědčení, že
je klid, zatímco běh čeká na někoho jiného, kdo se zrovna nedívá.

Approval není adresovaný zařízení. Je adresovaný **člověku**, a ten má telefonů
kolik chce.

## 2. První odpověď vítězí a je vidět, kdo ji dal

Rozhodnutí je jeden `UPDATE ... WHERE decided_at IS NULL`. Ne kontrola a pak
zápis — jedno statement, takže mezi „je to volné" a „beru to" se nikdo nevleze.
Souběžné rozhodnutí dvou telefonů proto projde **právě jednou**, i když obě
volání dorazí ve stejné milisekundě.

`decided_by` nese **identitu zařízení** (`device-A`), ne obecné „mobil". Na
otázku „kdo to schválil" je „mobil" stejně málo užitečná odpověď jako „někdo".

Druhý telefon nedostane prázdnou chybu. Dostane stav, ze kterého umí postavit
`SS-09` („rozhodnuto jinde") — tedy **co** platí, **kdy** se to stalo a **kdo**
to rozhodl. Ta obrazovka existuje přesně pro tenhle případ.

Konkrétně obě konfliktní větve (`already_decided` i `race_lost`) vracejí
`decision`, `state`, `decidedAt` a `decidedBy`. `state` je vedle `decision`
schválně: `invalidated` a `cancelled` **nejsou** lidské zamítnutí a klient je
musí umět rozlišit.

> Do `M1-c` (2026-08-21) to tak nebylo: `already_decided` vracelo rozhodnutí bez
> času a autora, `race_lost` nevracelo ani to. Test to obcházel čtením
> z databáze — což nedokazovalo nic, protože klient databázi nevidí. Teď se čte
> **z odpovědi**.

## 3. Rozhodnutý approval zmizí všem

Ne jen tomu, kdo rozhodl. Fronta, která by ho druhému telefonu ukazovala dál, by
ho nechala rozhodnout podruhé — a druhé „ano" nad provedeným efektem je buď
zdvojený efekt, nebo tichý no-op. Obojí je horší než to, že otázka zmizí.

## 4. Receipty jsou po zařízeních (`F-112` / `DR-012 A`)

Notifikace bez adresáta (`device_id IS NULL`) je **broadcast**: vidí ji každé
spárované zařízení. Přečtení se ale zapisuje do `mobile_notification_receipts`
jako řádek `(notification_id, device_id)` — ne jako sloupec na notifikaci.

Proto přečtení na telefonu A **nemá žádný vliv** na schránku telefonu B. Dřív to
tak nebylo a byla to přesně ta chyba, kterou `F-112` pojmenoval: jeden telefon
odklikl schránku a ostatní přišly o upozornění, které nikdy neviděly.

`INSERT OR IGNORE` drží dvě věci najednou: opakovaný ACK je idempotentní a
**zůstává první čas přečtení** — ten, který se skutečně stal. Počet, který se
vrátí, je počet řádků, které tenhle ACK doopravdy nově potvrdil; druhý identický
ACK hlásí `0`, ne že práci udělal znovu.

`ackMobileNotifications` zapisuje jen do řádků, které to zařízení **smí vidět**.
Predikát je schválně tentýž, kterým se čte: „smí potvrdit" nesmí být širší
množina než „smí číst", jinak by id odposlechnuté z cizí schránky něco potvrdilo.

## 5. Scope je hranice i mezi zařízeními

| Routa | Scope |
|---|---|
| `GET /m1/approvals` | `read:approvals` |
| `POST /m1/approvals/:id/decide` | `write:approvals` |

Telefon, který má jen `read:approvals`, frontu **vidí** a rozhodnout **nesmí**.
Vynucuje se to na routě (`gateway-policy.js`), ne v handleru — proto to tam taky
test kontroluje.

To dává smysluplnou konfiguraci pro víc zařízení: pracovní telefon rozhoduje,
domácí tablet jen kouká.

## 6. S1 zůstává S1 i při víc zařízeních

Notifikace nenese cestu, obsah ani diff — ani když je adresovaná konkrétnímu
zařízení. Počet zařízení na tom nic nemění a test to drží: v serializované
notifikaci nesmí být ani cesta k cíli, ani jeho obsah.

---

## Co tenhle model **ne**řeší

* **Adresné approvaly.** Není způsob, jak říct „tuhle otázku má rozhodnout jen
  telefon A". Fronta je jedna a scope je jediné rozlišení. Kdyby to někdo
  potřeboval, je to nová vlastnost, ne konfigurace.
* **Živý push mezi zařízeními.** Telefon B se o rozhodnutí telefonu A dozví při
  nejbližším pullu (nebo z broadcast hintu, který je best-effort). Není to
  okamžité a nemá být — jistotu dává řádek, ne hint.
* **Rozdílné identity lidí.** Všechna spárovaná zařízení jsou „ten uživatel".
  Kdo z rodiny drží telefon, systém neřeší a netvrdí, že řeší.

---

## Ověřeno

`tests/multi-device-approvals.test.js` — 8 PASS:

| # | Co dokazuje |
|---|---|
| 1 | oba telefony vidí tentýž čekající approval, oba dostanou otisk |
| 2 | první odpověď vítězí; druhá nepřepíše; odpověď nese `decision`, `state`, `decidedAt` i `decidedBy` |
| 3 | rozhodnutý approval zmizí z fronty **obou** |
| 4 | routa `decide` je scoped na `write:approvals`; čtečka rozhodnout nesmí |
| 5 | ACK z telefonu A neoznačí zprávu přečtenou na telefonu B |
| 6 | opakovaný ACK hlásí 0, ne práci navíc |
| 7 | notifikace nenese cestu ani obsah |
| 8 | souběžné rozhodnutí obou projde právě jednou; i poražený v závodě dostane platný konec |
