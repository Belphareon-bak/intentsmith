# Decision 042 — M7 VPN listener and local pairing authority

**Datum:** 2026-09-08

**Stav:** `ACCEPTED / IMPLEMENTATION_IN_PROGRESS / RUNTIME_EVIDENCE_BLOCKED`

**Rozsah:** M7 Remote Companion transport, credential custody, rate-limit
identity and pairing issuance

## Rozhodnutí operátora

Operátor potvrdil doporučené varianty `M7-TLS-01=A`, `M7-RATE-01=A`,
`M7-NET-01=A` a `M7-PAIR-01=A` pokynem „potvrzuju co pises, makej“.

Závazný produktový tvar je:

1. samostatný TLS 1.3 listener na portu `7443`, navázaný pouze na jednu
   konkrétní adresu rozpoznaného VPN rozhraní;
2. žádný wildcard, veřejný bind, LAN bind, proxy trust, reverse proxy,
   NAT/port-forward ani internetový ingress;
3. klient připíná SHA-256 digest SPKI serverového certifikátu;
4. TLS private key a 32bajtový HMAC klíč limiteru se načítají výhradně jako
   systemd credentials, nikoli z repozitáře, SQLite, settings, CLI argumentu
   nebo serverového environmentu;
5. durable limiter používá 24hodinovou retenci a hard cap 50 000 bucketů;
6. pairing claim smí vydat pouze autentizované lokální Studio, je single-use a
   expiruje přesně po pěti minutách; vzdálené self-pairing ani trvalý kód
   neexistují.

## Fail-closed aktivace

Listener se nespustí, pokud chybí nebo nesedí byť jediná z těchto skutečností:

- exact VPN interface a bind address pozorované z OS;
- exact HTTPS origin na portu `7443`;
- TLS 1.3-only a `trustProxy=false`;
- systemd credential directory pro `intentsmith-m7.service`;
- regular, nesymlinkované credential soubory bez group/world oprávnění;
- validní certifikát, odpovídající private key a exact SPKI pin;
- přesně 32 náhodných bajtů rate-limit HMAC klíče.

Konfigurace ani testy nesmějí generovat produkční privátní klíče. Testy smějí
použít pouze efemérní, zřetelně testovací materiál.

## Aktuální runtime hranice

Na hostu při přijetí rozhodnutí nebylo aktivní žádné rozpoznané VPN rozhraní;
pozorované non-loopback adresy patřily Wi-Fi a Dockeru. Produkční bind, firewall
evidence, telefonní journey a release podpis proto zůstávají
`RUNTIME_EVIDENCE_BLOCKED`. Implementační a negativní fixture testy nejsou
náhradou tohoto důkazu.

## Co rozhodnutí nepovoluje

Rozhodnutí nepovoluje vytvoření produkčního TLS/HMAC klíče, změnu host firewallu,
instalaci či spuštění systemd unity, veřejnou expozici, skutečné párování
zařízení, release signing, publish, tag ani push. Tyto operace vyžadují vlastní
provozní krok a pravdivou evidenci.
