# M5 — operátorská fakta pro posouzení historie

Datum: 2026-09-11. Stav: **OPERATOR_FACT_RECORDED / SIGNED_RECEIPTS_PENDING**.
Tento záznam není podpis ani potvrzení provedené rotace.

Na dotaz, zda se v projektu někdy používaly skutečné cloudové/modelové API
klíče, SMTP/Telegram/webhook přístupy, licenční klíče nebo testovací hesla
mimo testy, operátor odpověděl: „ne, na ostry test cekam uz hodne dlouho“.
Pro toto posouzení jde o operátorské historické tvrzení o nepoužití těchto
skupin, nikoli o závěr odvozený z dnešní prázdné konfigurace.

Podle upřesnění [Decision 035](../../../decisions/035-m5-privacy-remediation-authority.md)
je správnou navazující reprezentací posouzení `ROTATION_NOT_APPLICABLE`
pro odpovídající kategorie; nemá se vykazovat rotace neexistujících přístupů.
Existující history disposition `retain_and_rotate` se nemění. Konkrétní
osm category payloadů musí zachovat identitu incidentu a odkázat na tento
podklad; před podpisem potřebují kontrolu shody s incident manifestem.

Odpověď nepotvrzuje dokončenou druhou fyzickou zálohu operátorského signeru
ani bezpečné odpojení médií. Signer custody, podepsané category/history
receipts a nezávislé M5 review zůstávají otevřené. Žádný klíč, heslo,
fingerprint tajemství ani obsah historických credential objektů zde není.
