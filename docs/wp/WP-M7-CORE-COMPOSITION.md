# WP-M7-CORE-COMPOSITION

**Typ:** zapisující M7 integration blok

**Vstupní revision:** `1d04bd42`

**Stav:** `IMPLEMENTATION_GREEN / FULL_GATE_PENDING / REVIEW_PENDING / NOT_ACTIVE /
TRANSPORT_ABSENT`

## 1. Uživatelský výsledek

Jeden transport-free composition root skládá skutečné projektové, konverzační,
settings a stored-information adaptéry nad společným durable journalem. Stejný
provider vystavuje interní operation recovery a health control plane, ale
neotevírá listener a neumí se sám aktivovat.

## 2. Povolené a zakázané cesty

Povolený je nový composition modul, focused test, registry/module baseline a
evidence. Zakázané jsou server, route, session, pairing, listener, síť,
production credentials, allow-all autorita a změna mobile wire kontraktu.

## 3. Authority

Composition nevytváří autoritu. Povinně přijímá oddělený provider scope
resolver, project a conversation autorizaci, mutation mediator, exact cursor
key, DB a M1 command executor. Chybějící nebo chybně pojmenovaná závislost musí
selhat při konstrukci nebo při prvním bezpečném adapter boundary.

## 4. Dostupnost

Právě `conversations`, `projects`, `settings` a `stored_information` mají úplný
handler/journal set. `approvals`, `events` a `notifications` zůstávají
`unavailable`; composition je nesmí doplnit prázdným fixture handlerem.

## 5. Stop condition

Zastavit před aktivací provideru, vložením skutečných session/cursor klíčů,
pairingem, listenerem nebo tvrzením, že in-process composition je wire či
device evidence.
