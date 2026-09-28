# Decision 034 — M5 remote adapter and conditional release boundary

**Stav:** `ACCEPTED_FOR_IMPLEMENTATION / REVIEW_PENDING`

## Rozhodnutí

M5 implementuje `RemoteCorePort` pouze jako in-process adaptér nad zmraženou
M2 negotiation obálkou. Capability je `available` jen tehdy, když současně
existuje exact request/result kontrakt, připnutý manifest a injektovaný core
handler. Tuto podmínku dnes splňují pouze `conversations@1` a `projects@1`.
`approvals`, `events`, `notifications`, `settings` a `stored_information`
zůstávají explicitně `unavailable`; M5 jejich payload schema nevymýšlí.

Negotiation neuděluje authority. Adaptér nevytváří listener, pairing, device
identity, token, revokaci ani bridge do legacy routes/DB/serveru. Tyto hranice
patří M7. Každý invoke znovu ověří hello, negotiation, capability verzi, oba
manifest digests, operation ID, request/result kontrakt a výslednou identitu.

Produkční M5 conditional release set obsahuje jedinou supported plochu:
`model-discovery`, navázanou na už existující outbound authority
`model.metadata.read` a required journey `M6-JOURNEY-MODEL-DISCOVERY-V1`.
Externí notifications, marketplace, ComfyUI media a core auto-update jsou
`unsupported`, defaultně vypnuté a bez M6 journey. Pokus zapnout je v
produkčním procesu je startup chyba, nikoli skrytý degraded režim.

## Důsledky

- Budoucí companion může ověřit kompatibilitu a dvě přesné core operace, ale
  nemůže z negotiation odvodit transportní nebo uživatelskou autoritu.
- Vývojové běhy mohou dormant moduly explicitně zapnout; jejich releaseStatus
  zůstává `unsupported` a produkční profil je odmítne.
- Defaultní server neregistruje email, Telegram, push ani webhook delivery,
  neinicializuje marketplace ani ComfyUI a bez `C3_UPDATE_REPO` nespouští core
  updater. Lokální desktop/in-app notifications nejsou externí plocha.
- Přidání další RemoteCore capability vyžaduje nový exact payload/operation
  manifest a jeho review; zapnutí další conditional plochy vyžaduje vlastní M6
  journey a případně novou outbound authority.

Toto rozhodnutí není nezávislé review ani M5 acceptance.
