# Účetní: měsíční podklady → kontrolní hlášení a přiznání DPH

Stav: **CONTRACT_DRAFT / NOT_IMPLEMENTED**. Datum: 2026-09-11.
Adresát: operátor a implementátor účetního specialisty. Autorita: reálný příklad
operátora „posílám dokumenty ke kontrolnímu hlášení za květen“, PDF faktura a HEIC
s několika účtenkami, dva následné XML soubory od účetní; operátor potvrdil, že
patří ke stejnému měsíci. Tento dokument doplňuje průzkum prvního prototypu.
Není potvrzením správnosti nebo úplnosti předaného daňového podání.

## Výstup, který má specialista poskytovat

Jeden měsíční balíček obsahuje dva různé formuláře:

- `DPHKH-…xml`, dokument DPHKH1: kontrolní hlášení se členěním dokladů a souhrnů;
- `DPHDP-…xml`, dokument DPHDP3: přiznání DPH, souhrn daně na výstupu, odpočtu
  a výsledné vlastní daňové povinnosti / nadměrného odpočtu.

Přílohy jsou **přírůstek měsíční evidence**, nikoli automaticky její celý obsah.
Účetní může mít faktury, dobropisy nebo rozhodnutí o uplatnění odpočtu již z dřívějška.
Specialista musí navázat na existující účetní knihu, profil plátce a předchozí
rozhodnutí; nesmí z výsledného XML zpětně vymyslet chybějící doklad.

Předání uživateli: dvě samostatná stáhnutelná XML, čitelný souhrn (období, daň
na výstupu, uplatněný odpočet, výsledná daň, počty dokladů a nerozhodnuté položky),
seznam zdrojů a rozdíl proti předchozí verzi. Nevěrohodné/rozporné položky jsou
viditelně v sekci „Potřebuji doplnit“. Výsledek bez úplné evidence se označí jako
rozpracovaný; samotná existence dvou souborů není úspěch. Automatické podání na
FÚ není součástí tohoto příkladu.

## Zjištění v živém kódu a skutečné meze prototypu

`index.js` registruje pět kalkulaček. `ledger/ledger-engine.js` a
`ledger/ledger-repository.js` poskytují knihu a záznamy s auditní stopou.
`ledger/ledger-vat.js` poskytuje výpočty DPH/KH a `ledger/ledger-reports.js`
textové reporty. V účetním balíčku není exportér DPHKH1/DPHDP3 ani cesta
PDF + více účtenek v HEIC → zkontrolované účetní doklady → XML.

Host `src/ws-bridge/m1-attachment-policy.js` v současnosti přijímá inline text,
JSON a podporované rastrové obrázky; PDF a HEIC nelze jen označit jako podporované.
Je třeba řízená konverze nebo rozšíření příloh s review. Přímé čtení Downloads
z balíčku by obcházelo M3 boundary; domácí adresář není authority odvozená z chatu.

Stávající KH výpočet nelze bez auditu vydávat za exportér: používá hranici na
jednotlivém entry a zvolenou kategorii, zatímco musí pracovat s daňovým dokladem
jako celkem a s podmínkami jeho zařazení. Povinná pole, DIČ, období uplatnění,
opravy a poměrný/krácený nárok vyžadují vlastní validaci. Částky na dokladu mají
přednost před zpětným odhadem z celkového součtu; peníze zůstávají v haléřích.

## Postup a hranice dat

1. **Přijetí měsíce.** Určit subjekt z vybraného účetního profilu a zda jde o
   řádné/opravné/následné podání. Věta „za květen“ se naváže na explicitní rok
   nebo se vyjasní. IČO v názvu souboru není DIČ; role dodavatele/odběratele se
   ověřuje proti profilu, nepřebírá náhodně z první faktury.
2. **Host import.** Původní bytes, MIME detekce, hash, stránka/souřadnice a čas
   importu. PDF nejprve textově, při chybě OCR. HEIC věrně dekódovat, uchovat
   originál; rozdělit fotografii na jednotlivé účtenky. Neposílat daňové
   podklady externí OCR službě bez existujícího oprávnění.
3. **Extrakce návrhů.** U každého dokladu číslo, datum vystavení/DUZP, partner,
   DIČ, směrovost, měna, řádky po sazbách, základ/daň/celkem. Každé pole má
   `sourceRef`, metodu a confidence; confidence OCR není potvrzení daňového nároku.
   Oddělit obchodníka od provozovatele plateb/čerpací stanice, slevy a soukromé položky.
4. **Spojení s knihou.** Načíst existující měsíční doklady i dříve schválené
   rozhodnutí o pozdějším uplatnění. Deduplikace hash + partner/číslo/částka/DUZP;
   podobnost sama nesmaže účtenku. Není dovoleno započíst jeden doklad dvakrát
   při opětovném importu PDF či fotografie.
5. **Kontrola a rozhodnutí.** Součty, sazby, DUZP/období uplatnění, identita,
   podnikatelský účel a rozsah odpočtu. Nejasnost → NEEDS_REVIEW. Vyřazení musí
   mít důvod, původ rozhodnutí a vazbu na doklad. Zaokrouhlení nedoplňuje chybějící
   fakturu; rozdíl proti referenčnímu XML není důvod přepsat zdroje.
6. **Společný výpočet.** Jedna uzavřená revize měsíční evidence vytvoří obě
   projekce. DPHKH zachová požadovanou přesnost, DPHDP používá pravidla
   zaokrouhlení příslušných řádků; souhrny se porovnají po tomto mapování.
   Limity A4/A5 a B2/B3 se vyhodnocují na dokladu včetně daně, ne podle typu
   souboru nebo jednotlivého řádku. Nepodporované režimy se zastaví, neodhádají.
7. **Validace souborů.** Sériová XML čísla bez locale čárek, escapování znaků,
   kontrola proti připnutému oficiálnímu XSD pro oba formuláře a samostatná
   věcná/formulářová kontrola. Přijetí XSD není přijetí FÚ ani daňová správnost.
8. **Předání a opravy.** Uložit immutable zdroje, revizi knihy, mapu polí,
   verzi pravidel/XSD, výsledné bytes a jejich hash. Nová příloha nebo změna
   nároku zneplatní obě odvozené verze; další export je nová revize, nikdy tichý
   přepis dříve předaného měsíce.

## Navržený doménový kontrakt

`MonthlyVATRequest@1`:
`requestId`, `taxpayerProfileRef`, `period:{year,month}`, `filingKind`,
`ledgerRevision`, `attachmentRefs[]`, `priorSubmissionRef?`.
Identity/scopes a dostupné refs přidělí host; libovolná cesta či uživatel z body
neuděluje přístup. Profil a ledger musí patřit témuž subjektu i oprávněnému uživateli.

`ExtractedDocument@1`:
`documentId`, `originalRefs[]`, `kind`, `documentNumber`, `counterparty`,
`issuedAt`, `taxableSupplyAt`, `receivedAt?`, `claimPeriod?`, `currency`,
`amountsByRate[]`, `grossMinor`, `fieldEvidence[]`, `reviewState`,
`deduplicationCandidates[]`, `taxTreatmentDecisionRef?`.
Částky jsou celočíselné haléře, ne float; chybějící pole jsou explicitně null
s důvodem. Potvrzený doklad odkazuje na zdroj a schválené účetní rozhodnutí.

`MonthlyVATResult@1`:
`status: NEEDS_INPUT | NEEDS_REVIEW | READY_FOR_REVIEW | VALIDATED_EXPORT | ERROR`,
`period`, `taxpayerProfileRef`, `ledgerRevision`, `includedDocuments[]`,
`excludedDocuments[]`, `unresolvedItems[]`, `summary`, `fieldTrace[]`,
`artifacts:[{form,version,artifactRef,sha256,xsdVersion,xsdValidation}]`,
`priorSubmissionDiff`, `errors[]`.

`VALIDATED_EXPORT` vyžaduje obě validní XML, úplnost měsíce potvrzenou oprávněným
uživatelem, zkontrolované rozdělení nároku, žádný nezodpovězený relevantní rozpor a
shodnou revizi všech podkladů. Není to `SUBMITTED` ani `ACCEPTED_BY_TAX_OFFICE`.
V rozpracovaném stavu jsou případné soubory jasně DRAFT a určené ke kontrole.

## Reálný příklad operátora: důkaz a poučení

Přímé čtení PDF a dekódování originálního HEIC ukázalo jednu vydanou fakturu a
šest samostatných účtenek. Vydaná faktura souhlasí s A4 v předaném KH. Přijatá
strana XML uvádí jiný doklad v B2, který v předaných přílohách není; B3 je nulová.
Operátor potvrdil společný měsíc, nikoli důvod účtování nebo úplnost příloh.

Přípustné vysvětlení je další doklad v účetní knize a samostatné rozhodnutí o
účtenkách; z dodaných dat se toto **nedá potvrdit**. K vysvětlení rozdílu je
potřeba měsíční evidence účetní nebo příslušný doklad a její rozhodnutí. Do té
doby jde o PARTIAL_EVIDENCE, nikoli prokázanou chybu účetní.

Oba skutečné XML byly lokálně porovnány s oficiálními XSD staženými 2026-09-11:
KH validní; DPHDP jedna chyba `Veta5.koef_p20_nov`: hodnota s desetinnou čárkou
není validní podle aktuálního XSD. Originály nebyly změněny. Nevyvozujeme z toho,
že podání bylo úřadem odmítnuto. Soukromé soubory, jejich přesné částky, identity,
hashe a audit zůstávají mimo Git v privátní evidenci pracovního běhu.

## Ověření budoucí implementace a nejbližší krok

Reálný případ musí fungovat ve dvou variantách: samotné nové přílohy vrátí
viditelně neúplnou evidenci; po doplnění existujících dokladů a rozhodnutí
vytvoří oba formuláře se správnou vazbou každého řádku na zdroj. Golden XML
ověřuje význam polí a součty, nikoli byte-for-byte pořadí atributů či hlavičku
jiného účetního softwaru. Opakovaný import nezmění součty; změna jednoho zdroje
zneplatní obě staré projekce. Testy musejí pokrýt hranici 10 000 Kč, více sazeb,
opravy, nezařazené účtenky a zaokrouhlení. Provozní osobní doklady nepatří do fixture Git.

Nejbližší implementační řez: hostový dokumentový import a přehled rozeznaných
položek s vazbou na měsíční knihu, následovaný exportérem dvou projekcí a XSD
validátorem. OCR, odsouhlasení nároku a XML export jsou stále chybějící chování
účetního prototypu; tento kontrakt jejich implementaci nenahrazuje.

Oficiální zdroje ověřené 2026-09-11:
[DPHKH1](https://adisspr.mfcr.cz/dpr/adis/idpr_pub/epo2_info/popis_struktury_detail.faces?zkratka=DPHKH1),
[DPHDP3](https://adisspr.mfcr.cz/dpr/adis/idpr_pub/epo2_info/popis_struktury_detail.faces?zkratka=DPHDP3),
[otázky Finanční správy ke KH](https://financnisprava.gov.cz/cs/dane/dane/dan-z-pridane-hodnoty/kontrolni-hlaseni-dph/caste-dotazy-a-odpovedi).
Schémata: DPHKH1 03.01.14, DPHDP3 03.01.03 (obě z 9. 3. 2026).
