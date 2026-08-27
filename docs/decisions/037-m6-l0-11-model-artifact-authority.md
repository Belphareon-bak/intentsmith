# 037 — M6 L0-11 používá durable artifact authority a loopback-only efekty

- **stav:** `IMPLEMENTED / RE_REVIEW_REQUIRED`
- **rozsah:** M6 L0-11, provider pull/delete a legacy chat cleanup
- **datum:** 2026-08-27

## Rozhodnutí

L0-11 není přijímáno přemapováním obecných M2 testů. Release cesta používá
jednu per-canonical model autoritu se sdílenými use claims a exkluzivními
pull/delete claims. Produkční server ji váže na SQLite repository; čistě
in-memory instance zůstává pouze testovacím portem.

Durable claim obsahuje Linux boot ID, PID, UID a `/proc` start ticks. Každá
akvizice běží v `BEGIN IMMEDIATE`: živý nebo nečitelný cizí vlastník je
fail-closed konflikt, prokazatelně mrtvý/reused vlastník dostane jediný
terminální `OWNER_GONE_RECOVERED`. Claim historii nelze smazat a update je
povolen jen z aktivního stavu do přesného release terminálu.

Každý provider `PULL` a `DELETE` zapisuje před prvním efektem immutable intent
a po něm append-only terminál. Nejednoznačný výsledek je `ORPHANED` a blokuje
další use i mutace dané identity. Pull stream má 120sekundový idle timeout;
EOF bez explicitního provider eventu `success` je terminální selhání a
malformed event ani event s `error` se nesmí schovat za současný status
`success`.
startup recovery smí znovu spustit pouze stejný exact pull a stejný připnutý
origin a až po úspěchu přidá `RECONCILED_SUCCEEDED`. Delete orphan se
automaticky neuvolňuje, protože absence modelu bez provider-side operation ID
nedokazuje, že pozdní delete už nemůže nastat.

Destruktivní provider scope je pro 1.0 výhradně necredentialed HTTP loopback s
kořenovou cestou a explicitním `/api/pull` nebo `/api/delete`. Vzdálený Ollama
provider je pro tyto efekty unsupported a odmítá se před inventory i zápisem.

Chatový `model_cleanup` je vyřazený fail-closed surface s typovaným
`MODEL_CLEANUP_CHAT_RETIRED`. Jeho zdroj uměl nabídnout pouze one-step rollback
identitu, kterou správně chrání binding authority. Skutečná deletion cesta je
authenticated Model Management nad exact name + digest.

## Hranice tvrzení

Toto rozhodnutí uzavírá artifact-use/delete bezpečnost L0-11. Neprohlašuje
globální GPU residency mezi Ollama gateway a ComfyUI/media za exkluzivní;
Decision 023/A ji záměrně odděluje a tato širší kapacitní otázka není
destruktivní artifact authority.

## Povinný důkaz

- dvě samostatné SQLite connection/process identity prokážou shared/exclusive
  race a `BEGIN IMMEDIATE` winnera;
- `UNKNOWN` `/proc` stav zůstane blokující, `GONE` se obnoví atomicky;
- provider je zavolán až po durable intentu a success/failure/orphan vytvoří
  pravdivý append-only stav;
- SQL schema odmítne operaci přes shared nebo cizí canonical claim, mismatched
  exact name i provider origin s cestou; success vyžaduje explicitní provider
  receipt;
- stalled pull se ukončí timeoutem, zůstane fenced a recovery znovu použije
  stejnou operation identity;
- remote/credential/path/query origin skončí bez provider efektu;
- chat cleanup nečte inventory, nevytváří preview a nemaže.
