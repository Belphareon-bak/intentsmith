# M5 offline custody medium A — 2026-09-10

**Source:** `8cc1bb24c58ba30ea97386cc060bfa015f2882ce`
**Stav:** `OPERATOR_KEY_COPY_VERIFIED / MEDIUM_OFFLINE / CUSTODY_PARTIAL`

Operátor výslovně určil `/dev/sde1` jako plně dostupné médium a povolil jeho
formátování. Před změnou byl oddíl přesně identifikovaný jako removable USB
NAND Flash se sériovým číslem `0253798977575968`, velikostí oddílu
`4026499072` bajtů a by-id cestou
`usb-MFGCorp_NAND_Flash_0253798977575968-0:0-part1`. Původní filesystem byl
FAT32, label `USB DISK`, UUID `0090-44CC`. Médium nebylo systémovým diskem ani
nebylo připojené.

## Vytvořený svazek

- LUKS typ: `LUKS2`;
- LUKS UUID: `59a27dd8-a1aa-4b34-8077-a2fe50aa278d`;
- vnitřní filesystem: `ext4`, UUID
  `043ddf90-babd-4087-b18b-fba7d682eb72`;
- mount během zápisu: `rw,nosuid,nodev,noexec`;
- po dokončení: mapper nepřítomný, mount nepřítomný a `/dev/sde` po
  `udisksctl power-off` nepřítomné.

Heslo bylo dvakrát získané grafickým password promptem, nikdy nebylo vložené
do argv, souboru ani logu. Root helper přijal heslo jen na standardním vstupu
pro `cryptsetup luksFormat` a `cryptsetup open` a následně proměnnou zrušil.

## Obsah a ověření

Na médiu vzniklo 12 souborů o celkové velikosti payloadu 5462 bajtů; filesystem
hlásil 1 % využití a 3,6 GiB volných. Soukromá část obsahuje právě:

- `m5-privacy-operator`;
- `m5-acceptance-operator`;
- `m6-release-operator`.

Všechny tři soukromé soubory měly režim `0600` a nadřazený adresář `0700`.
Pro každý z nich byl v paměti odvozen veřejný SPKI klíč a bajtově porovnán se
samostatným public souborem i veřejným klíčem a key ID v Git-pinned trust
storu. Všechny kontroly prošly. Digest ani bajty soukromého klíče se do evidence
nezapisovaly. Veřejná část obsahuje všechny čtyři SPKI identity, trust store a
ceremony manifest.

Soukromý `m6-independent-reviewer` klíč je záměrně nepřítomný; kontrola jeho
absence prošla. Adresáře `receipts/` a `evidence/` jsou připravené, ale prázdné.
Interní `IntentSmithOfflineCustodyVerification@1` skončila verdiktem `PASS`.

Použité lokální helpery byly po syntaktické kontrole spustitelné jen pro
vlastníka. Provision wrapper měl SHA-256
`b375665010ec9722fa1d1350284dcd4e0b6738003eee72f16eeb95760677e109`.
Kořenový helper po opravě závěrečné identity kontroly měl SHA-256
`9071c96c0682cf00912915326b3acd54edffe11d8c5b3c1fd135612f1dfe35f9`.
První close pokus bezpečně odmítl pokračovat, protože rekurzivní `lsblk`
po otevření zahrnul mapper child; nerekurzivní kontrola stejného partition
device závěrečné zavření dokončila. Obsah tím nebyl změněný.

## Zbývající hranice

Toto je jedna ověřená offline kopie tří operátorských identit, nikoli dokončená
produkční custody:

- reviewer private key potřebuje jiné fyzické médium;
- před odstraněním online zdroje je nutná druhá ověřená offline kopie;
- osm category receipts, history receipt, M5 acceptance a tři M6 receipts
  ještě nebyly vydané ani na médium zkopírované.

M5 proto zůstává `KEY_CUSTODY_PARTIAL / PRIVACY_CHANGES_REQUIRED /
ACCEPTANCE_BLOCKED`. Tento run nedokládá rotaci credentials ani release podpis.
