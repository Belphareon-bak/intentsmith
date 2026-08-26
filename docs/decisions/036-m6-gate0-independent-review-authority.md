# Decision 036 — M6 Gate 0 review authority

## Rozhodnutí

M6 reaktivuje releaseový řetěz `C → E → R → A`, ale review autoritou je
nezávislý operátorský reviewer, který poskytne exact-candidate read-only
verdikt. Starý Gate 0 v1 kontrakt připínající konkrétní produkt „Opus 5" je
historický důkaz staršího baseline a pro M6 se znovu nepoužije. Operátor
výslovně rozhodl, že M6 review provede sám a lokální Opus se nemá používat.

- `C` je zmražený product candidate SHA;
- `E` je content-addressed M6 technical matrix, release artifact a 13/13 L0;
- `R` je operátorem dodaný `REVIEW_PASSED` nad exact kandidátem;
- `A` je operátorem provedené demo a explicitní approval.

Gate 0 receipt musí hashově svázat review i demo artifact. Model ani
implementační agent nesmí sám deklarovat `actorType=user`; lokální JSON receipt
není kryptografický podpis a jeho provenance proto zůstává procesní hranicí
uživatelského handoffu. Bez operátorem skutečně dodaného review a dema zůstávají
řádky `BLOCKED`.

## Evidence-only commit

Product candidate a evidence HEAD jsou dvě identity. Po zmražení kandidáta smí
následovat pouze evidence-only descendant měnící přesně vyjmenované roadmap,
run a review dokumenty; registry ani produktový soubor se změnit nesmí. Tím
review dokumentace nezmění testovaný build a současně nemusí zůstat
necommitnutá.

