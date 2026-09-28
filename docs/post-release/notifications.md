# Kontrakt: externí notifikace po 1.0

**NÁVRH K REVIEW / NEIMPLEMENTOVÁNO.** Zadání operátora 2026-09-11;
navazuje na in-app oznámení a M5 conditional boundary.

Výsledek: uživatel nastaví SMTP, Telegram, ntfy nebo HTTPS webhook, odešle
ověřovací zprávu a připojí kanál k agentovi. Desktopová in-app cesta funguje
i bez těchto služeb. Credentials jsou referencí do schváleného secret store,
nikoli hodnotou v agent definition, DB exportu nebo logu.

Navržený `NotificationDelivery@1` váže event ID, recipient/channel policy,
payload classification, idempotency key, pokusy a skutečný provider receipt.
`queued`, `accepted_by_provider`, `delivered`, `failed`, `unknown`, `cancelled`
se nezaměňují; HTTP 200 nebo SMTP accepted není důkaz přečtení příjemcem.
Retry respektuje provider idempotenci; při nejistotě nevyrobí falešný success.

Vlastněné oblasti: `src/notifications/**`, provider adaptéry, Studio settings
a existující secret/outbound connectors. Podmíněnou produkční plochu zapnout
až po přijetí scénáře. Quiet hours/timezone, priority, dedup, rate limits,
redakce projektového obsahu a revoke jsou součástí funkce, ne pozdější dodatek.
Uživatel předem určí, jaká data mohou na který kanál.

Akceptace: lokální testovací SMTP/HTTP provider ověří bytes/timeout/retry/
redirect/SSRF/TLS a log redakci; navazující řízený skutečný provider test
ověří každou podporovanou cestu a její receipt. Restart fronty, nedostupný
secret, zrušení příjemce a duplicita nesmějí poslat data navíc. Měřit dobu
doručení, chybovost a počet pokusů podle předem přijatého workloadu.
Bez účtu či externího ověření zůstává konkrétní provider NOT_RUN.
