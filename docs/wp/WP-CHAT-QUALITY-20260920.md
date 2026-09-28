# Chat: podrobnost, návaznost a čitelné výsledky webu

Autorita: explicitní hlášení operátora 20. 9. 2026 se screenshoty Docker/Kubernetes
(a opakovaným požadavkem na detaily) a nerelevantního webového hledání auta.
Stav: IN_PROGRESS / REVIEW_PENDING. Vstup `080114ae`, runtime `9660d99b`.
Vlastněné cesty: konverzační ANSWER, návaznost, zobrazení konverzačního webu,
související testy a dokumentace. Hunt, bindingy, role profily a cizí checkout
se nemění. Práce používá existující čistý checkout a novou větev.

Pozorování: CONVERSATIONAL má bezpodmínečně nejvýše 45 slov/2–3 věty a vstup
do 160 znaků dostane 256 tokenů. Historie se zkracuje na 200 znaků každé zprávy.
Webový výsledek pouze odstraní tagy a vypíše prvních 12 000 znaků RSS včetně
hlavičky; nehodnotí relevanci. Toto není závěr o kvalitě konkrétního modelu.

Výsledek: běžná konverzace přizpůsobí podrobnost požadavku, krátký požadavek na
rozvedení zachová předchozí téma a nevede do menu záměrů. Historie využije
skutečný rozpočet, výstup zůstane uvnitř stávající modelové autority. Výsledky
vyhledání musí být čitelné, odkazované a bez tvrzení, že snippet dokládá všechny
podmínky uživatele. Přesná schválení jednotlivých HTTPS požadavků zůstávají.

Ověření: skutečný M1 HTTP průchod před/po se stejným CHAT bindingem a promptem,
regrese s kontrolovaným modelem nad skutečným handlerem, webové approval/replay
regrese, cílené chat/privacy/boundary sady a kompletní offline/database profil.
GPU měření jen při volném společném zámku a bez cizího aktivního modelu.
Pokud GPU obsadí jiný worker, pokračují offline opravy; fyzický důkaz zůstává
oddělený a nesmí být prohlášený za hotový.

Fyzický průchod na `945fc40c` odhalil u první otázky HTTP 502 /
MODEL_RESPONSE_TRUNCATED; další čtyři měly stop a správnou návaznost, ale
obsahovaly i věcné a jazykové nepřesnosti. Běh není PASS. Následná oprava
přidává plánování rozsahu podle rozpočtu a nejvýše dvě regenerace po
useknutí v rámci původního retry limitu a stejné tokenové autority.
Vyčerpaný nedokončený výstup zůstává chybou bez uložení do historie.
