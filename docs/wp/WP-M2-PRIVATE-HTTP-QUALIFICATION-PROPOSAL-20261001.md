# WP-M2-PRIVATE-HTTP-QUALIFICATION-PROPOSAL-20261001

**Aktuální stav 5. 10.:** `FOLLOWUP_AUTHORIZED / BOUNDED_SOURCE_REVIEW_PASS / PRODUCT_V2_ADOPTED / CONTROLLED_PROVIDER_PASS / GENERATED_HTTP_NOT_RUN`.
Operátor výslovně povolil navazující implementační WP, review kontraktu a testy.
[Navazující WP](WP-M2-PRIVATE-HTTP-EXECUTION-20261004.md) eviduje rozsah,
skutečné namespace sondy a jejich omezení. Výchozí offline profil se nemění.
Následující datovaný návrh zachovává původní stav rozhodování z 1. 10.

**Historický stav 1. 10.:** `DRAFT / DECISION_REQUIRED / IMPLEMENTATION_NOT_RUN / HTTP_NOT_RUN`.
**Datum:** 2026-10-01. **Vlastník přípravy:** ROOT; rozhodnutí náleží operátorovi.
**Podklad:** čistý checkout `6a9161a563c81f6837ae9181df9045bf44c62682`.
Tento WP připravuje rozhodnutí; nepovoluje implementaci ani nemění sandbox.
Níže uvedené testy jsou návrh přejímky, nejsou připravené ani vykonané.

## Proč je potřeba rozhodnutí

[CONTRACT](../../CONTRACT.md), ř. 64–70, vyžaduje omezenou autoritu,
approval, audit a explicitní opt-in pro síťové schopnosti; ř. 340–352 vymezuje
samostatné rozhodnutí pro změny L0 a veřejného chování před implementací.
Obecné dokončení projektu opravňuje přípravu návrhu; nový síťový profil
nelze z tohoto zadání považovat za již schválený.
[Přijatý M2 WP](WP-M2-EXECUTION-V1.md), ř. 15–20 a 42–49, předepisuje
focused test bez sítě a výslovně vylučuje network-enabled test i fallback.
Jeho ř. 65–71 připínají `linux-bwrap-ro-v2` a vyklizení celé procesní skupiny.
[Validator](../../contracts/m2/execution-v1.js), ř. 296–324, přijímá jen tento
profil v `ProjectChangeRequest.focusedTest`; [planner](../../src/execution/project-change-planner.js),
ř. 381–394, jej pevně sestavuje. [Provider](../../src/execution/process-sandbox-provider.js),
ř. 274–303, jiné profily odmítá. [Supervisor](../../src/execution/process-supervisor-child.js),
ř. 32–46 a 174–227, blokuje socket/connect a odděluje network namespace.
Backendové HTTP fixtures M6 nejsou schválením síťového profilu generovaného M2.

## Navržené rozhodnutí a rozsah

Povolit následný omezený WP pro skutečnou HTTP kvalifikaci jedné generované
SQLite aplikace v soukromém loopback namespace. Výchozí `linux-bwrap-ro-v2`
zůstane beze změny. Pracovní jméno nového profilu je
`linux-bwrap-private-loopback-v1`: **návrh**, nikoli registrovaná autorita.
Přesné verze execution kontraktu, policy, schématu a approval polí musí určit
samostatný kontraktový review; stávající `PINNED_V1` se nesmí potichu rozšířit.
Rozsah nezahrnuje host listener, internet, DNS, VPN, pairing, mobilní transport,
veřejný connector, produkční DB ani změnu běžících backendových služeb.

## Navržená hranice oprávnění

- Jeden argv-only focused command spustí server a důvěryhodný HTTP oracle
  uvnitř stejného nového soukromého network namespace; žádný obecný shell.
- Povolený je jediný přesně schválený IPv4 loopback endpoint a port.
  Ostatní porty, non-loopback cíle, IPv6, AF_UNIX a odchozí síť mají být zakázané.
- Exact approval musí vázat profil, endpoint, binary, argv, environment, timeout,
  projektové cesty/bajty a digest neměnného oracle/policy před generováním.
- Projekt zůstane read-only, pracovní SQLite DB pouze v private `/tmp`;
  žádné host sockets, zděděné síťové FD ani připojení do host namespace.
- Zachovat FD pinning, omezené resources, durable supervisor identity,
  cancel/timeout TERM/KILL a prokázané vyklizení serveru i všech potomků.

## Navržená funkční přejímka a durable výsledek

Důvěryhodný oracle ověří skutečné HTTP statusy, Content-Type, úplný omezený
JSON a přesné výsledky předem zveřejněných operací; úspěch neurčuje child marker.
Trusted parent samostatně čte SQLite řádky, schema a constraints pro své
náhodné vstupy. Chybné požadavky a neplatná dávka musí zachovat stav podle
výslovného veřejného API kontraktu, který následný WP teprve konkretizuje.
Oracle ukončí server a otevře stejnou private DB přes nový serverový proces
ve stejném sandboxu; nejde o persistenci mezi samostatnými M2 invokacemi.
Teprve úplný HTTP/SQLite proof a cleanup dovolí exact-path Git commit.
Failure, cancel či timeout vyžadují rollback celé schválené sady a durable
non-success terminal; foreign bytes/HEAD zůstávají chráněné pravidly přijatého M2.
Samostatný backend restart a read-only reader authority DB ověří approval,
efekty a stejný terminal bez opakování již spotřebovaných efektů.

## Navržené negativní kontroly

- Defaultní RO profil stále odmítá socket/connect; nový profil nepřijme
  neschválený profil, endpoint, port, digest ani approval před prvním efektem.
- Skutečné pokusy o AF_UNIX, non-loopback, IPv4/IPv6 egress a DNS selžou;
  host socket a služby zůstanou nedostupné, včetně zděděných FD.
- Timeout, cancel, crash a zanechaný potomek nesmějí vytvořit success/commit;
  ověřit uzavření socketů, vyklizení procesů, rollback a durable reopen terminalu.
- Neúplný JSON, chybný status, nepravdivý child report, nesprávné SQLite řádky
  nebo constraints musí skutečný oracle odmítnout konkrétním důvodem.

## Nevyřešené mechanismy a omezení

Zřízení soukromého loopbacku, omezení adres/portů, syscallů a zděděných FD
zatím nejsou navržené implementační důkazy. Nelze předpokládat, že samotný
seccomp ověří obsah adresních struktur. Potřebný kernel mechanismus,
podporované architektury, listen/accept/connect pravidla a auditní pole jsou
otevřené body následného WP. Chybné omezení může zpřístupnit host socket či síť.
Pokud hranici nelze doložit, profil zůstane nepovolený; žádný plain-spawn fallback.
Tato kvalifikace neprokáže produkční HTTP bezpečnost, výkon ani kvalitu modelu.

## Postup po rozhodnutí / alternativa bez rozhodnutí

Po souhlasu: kontrakt a veřejné API → omezená implementace → skutečné offline
sandbox negativní kontroly → nezávislé review a registrované gates → případný
samostatně autorizovaný generovaný běh s přesnými source/model/oracle pins.
Bez souhlasu pokračuje `API_SEMANTICS_ONLY`: současný RO/CLI/pure-API/SQLite
oracle ověřuje aplikační sémantiku; skutečné HTTP zůstane `NOT_RUN / NOT_QUALIFIED`.
Po review a publikaci operátor zvolí nový omezený profil, nebo tuto alternativu.
Příprava tohoto dokumentu neobsahuje runtime, test, model, GPU ani DB operaci.
