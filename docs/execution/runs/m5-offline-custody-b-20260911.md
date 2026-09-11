# M5 offline custody medium B — 2026-09-11

**Source při operaci:** `5163e670` plus rozpracovaný, dosud nereviewovaný SPEC
milník, který custody obsah nemění.

**Stav:** `REVIEWER_KEY_COPY_VERIFIED / MEDIUM_OFFLINE / CUSTODY_PARTIAL`

Operátor výslovně povolil přeformátování flash disku, který byl nejprve
pozorovaný jako `/dev/sdd` a po odpojení/připojení jako `/dev/sdc`. Operace se
proto nevázala na proměnlivé jméno `/dev/sdX`, ale na:

- by-id:
  `usb-USB_2.0_USB_Flash_Drive_00000000664DFFCA-0:0`;
- serial: `00000000664DFFCA`;
- model: `USB Flash Drive`;
- velikost: `4 041 211 904` bajtů;
- removable: ano; read-only: ne.

Bezprostředně před změnou helper všechny údaje znovu porovnal a fail-closed by
skončil při jakémkoli rozdílu. Původní dva 249MiB FAT16 oddíly obsahovaly jen
56 KiB složek `System Volume Information` a `.Trash-1000`. Jejich tar záloha
má 61 440 bajtů a SHA-256
`bcf4d56811bda9bd54c247cee6da832496a8d8ccd89eaee1bc1c1785edb36c20`.
Do čistého custody svazku nebyla tato systémová metadata vrácena.

## Vytvořený svazek

- partition table: GPT, jeden oddíl přes dostupnou kapacitu;
- LUKS typ: `LUKS2`;
- LUKS UUID: `a6aa18cd-e2d0-47bb-b53a-33f01e24a129`;
- vnitřní filesystem: `ext4`, label `IS-CUSTODY-B`;
- filesystem UUID: `703918e1-5ed0-4d3e-b76d-259e12825e14`;
- mount během zápisu: `rw,nosuid,nodev,noexec`;
- po ověření: mapper nepřítomný, mount nepřítomný, USB přes `udisksctl
  power-off` nepřítomné.

Heslo bylo dvakrát získané grafickým password promptem. Nebylo vložené do
argv, souboru, prostředí ani logu. Root helper je přijal pouze na standardním
vstupu, použil pro `luksFormat` a `open` a následně proměnnou zrušil.

## Obsah a ověření

Svazek obsahuje sedm souborů s payloadem 3 205 bajtů. Soukromá část obsahuje
právě jediný soubor s režimem `0600`:

- `m6-independent-reviewer.pkcs8.pem`.

Žádný ze tří operátorských private keys na médiu není. Veřejná část obsahuje
všechny čtyři SPKI soubory, public ceremony manifest a Git-pinned trust store.
Reviewer public SPKI byl během otevřeného svazku znovu odvozený z private key
v paměti a bajtově porovnaný s veřejným souborem. Kopie trust storu byla
bajtově porovnaná s `contracts/authority/trusted-public-keys-v1.json`.
Adresáře `receipts/` a `evidence/` jsou připravené a prázdné.

Provision wrapper má SHA-256
`90266e04771047d27b73e98875870d91221921b9554916921190f47fc0518694` a root
helper
`f2fafcd1bb0fc53861237c8e06d1f00dd6f4f66f46900b65b5b0339fa3fa1757`.
Nesenzitivní výsledek helperu má SHA-256
`cc0f04c2502a02d339be9549544fc3f4de3b9d903d5d8f6f069dd28b73662a8f`.
Tyto soukromé provozní artefakty zůstávají v ignorovaném
`.intentsmith-artifacts/custody-b-20260911/`.

## Zbývající hranice

Médium B nyní prokazuje fyzicky oddělenou šifrovanou offline kopii reviewer
identity. Online zdroj čtyř klíčů zůstává zachovaný, dokud nevznikne druhá
ověřená offline kopie tří operátorských klíčů a není připravená bezpečná
obnova. Tento krok proto sám neuzavírá celou custody ani M5:

- chybí druhá offline kopie tří operátorských private keys;
- online zdroj nebyl autorizovaně odstraněný;
- osm credential category akcí a receiptů nebylo provedeno;
- history, M5 acceptance a tři M6 receipts nebyly podepsané.

Žádný receipt, release podpis, tag, push ani publikace při této operaci
nevznikly.
