# C8 — provozní chyba poskytovatele nesmí být úspěšné doptání

Stav: SOURCE_AND_EVIDENCE_REVIEW_PASS, CPU overlay41PASS a přesný v2test6PASS;
původních19 integračních sad PASS a exact CI37680691150/18SUCCESS. Deník: [WORK-PROGRESS](../WORK-PROGRESS.md).
Autorita: operátorský požadavek pravdivého M1 výsledku při výpadku poskytovatele,
přijatý chat-quality rozsah a existující terminální chybový kontrakt.
BASE `1c7617a218183470c6b8d51c57e59c3dad797ede`, kandidát
`e6b83884417b066e9d9b40286350255ee3dd4b30`.

C5 zachytil protokolové doptání po přerušeném přenosu, ale přesná gateway výjimka
v jeho důkazech chybí. Samostatná řízená reprodukce proto použila skutečné M1
HTTP a fixture provider ve vlastní síťové namespace. Tři podmínky — HTTP502,
zavření socketu před hlavičkami a přerušené HTTP200 tělo — každá skončily
HTTP200/status:ok a uloženým assistant doptáním. Původní503/refused kontroly
prošly. Nezávislý autor zachoval všechny neúspěchy a přesný transparentně
zachycený exception chain; tatáž výjimka se znovu vyhodila beze změny.
Tento experiment zpětně neurčuje neznámou historickou příčinu C5.

Oprava v původním CRE error boundary předá socket code UND_ERR_SOCKET jako
existující LLM_PROVIDER_UNAVAILABLE/HTTP503. Typed provider HTTP_ERROR a
MALFORMED_RESPONSE přejdou na existující CHAT_PROCESSING_FAILED/HTTP500.
V řetězci má bližší typed gateway chyba přednost před hlubším socket cause;
proto přerušené tělo zůstane500. Veřejná odpověď neobsahuje providerové detaily.
Nedokončený turn neukládá assistant odpověď ani nepřidává efekt. Durable uživatelský
tah zůstává; jeho interní metadata m7.status jsou nadále ok stejně jako u starých
503/refused kontrol. Oprava nemění tento samostatný význam ani netvrdí M7error.

Kandidát je úzký: stejná importní hrana na existující chat-turn-error modul,
žádná změna promptů, modelů, retry počtu, schvalování nebo akčních guardů.
Neplatný obsah klasifikace uvnitř platné odpovědi poskytovatele zachovává původní
fallback a uživatelské cancellation má přednost. Jiné kategorie404/empty/binding/
queue nejsou tímto cyklem obecně vyřešené.

GREEN před aplikací použil read-only bind dvou přesných kandidátních souborů
v privátní bwrap namespace; host checkout zůstal čistý1c7617. Celá kontextová sada
měla41PASS, včetně původních unit invalid-content/cancellation kontrol a skutečné
HTTP/restart cesty C7. Finální test zpřesnil očekávané HTTP/code dvojice; cílených
5podmínek+parent6PASS. Zbytek testu je byteidentický. To není nové HTTP cancellation
pokrytí všech cause chains ani důkaz živého modelu. Pět vlastních DB kopií:
integrityPASS, v chybné konverzaci pouze user i po restartu, nulový přírůstek tool
requestů a prázdné sledované M2 authority tabulky. Jediný starší math tool pochází
z předchozí deterministické kontroly a nesmí se zaměnit za efekt vadného turnu.

Nezávislý reviewer přijal source/test/evidence přesným receiptem
15e0b54c…0ffbc. RED má5161 hashovaných referencí; nezávislé review původní DB
neotevíralo, pracovalo s vlastními kopiemi. Přípravný permissions FAIL i všechny
REDy zůstaly zachované. Po aplikaci původních19 CHAT7/CODE12 sad na čistém e6b83884 prošlo,0FAIL/
BLOCKED/TIMEOUT/SKIPPED; samostatné exact CI37680691150 má všech18SUCCESS.
Nezávislé execution reviewc8e8460d…93b4f; overlay není jejich náhradou.

Samostatná [C7 cílená živá regrese](2026-10-07-CHAT-SAVE-CONTEXT.md) společného
e6b83884 dokončila první ze tří transportních sérií, ale uložení zůstalo FAIL
a cleanup zastavil zbylé dvě série. Nejde o izolovaný kauzální účinek C7,
nové celkové skóre53 případů ani H1/H2. Holdout/restricted/ a produkční bindingy
jsou mimo rozsah; release stále NOT_ACCEPTED.

[Přesný paket: base/target, diff, příkazy a očekávané/skutečné exity, raw cesty a SHA-256](evidence/chat-transport-failures-20261007/result.json).
CPU reprodukce a review GPU nevyžadují. Nové živé opakování musí mít samostatné
sériové GPU okno s ROOT; dřívější neúplná C7 kampaň se neobnovuje.

Celý původní offline/database profil na f4754575 (produktový zdroj e6 beze změny):
**7.10.21:00:05–21:09:49UTC,410PASS/0FAIL/BLOCKED/TIMEOUT/SKIPPED, exit0**.
Nezávislé execution reviewb132b085…0f8fe ověřilo všech410 logů, Git programy,
source/cleanup metadata a stejné výběrové podmínky. Exact CI37686205441 má18SUCCESS.
Předchozí profil9b161de5 měl409PASS/1FAIL kvůli zastaralému LOC údaji; jeho původní
FAIL zůstává. Nezávislá census oprava mění pouze dva dokumenty, focused artifact
160/160PASS. Registry běžel na9b, na f475 má stejné registry/runner bytes.
[Paket celých profilů s přesnými příkazy a SHA-256](evidence/chat-transport-failures-20261007/full-profile.json).
Tato dodatečná vývojová kontrola nemění C5/C7 živé FAILy ani C6/H1/H2 přejímku.
