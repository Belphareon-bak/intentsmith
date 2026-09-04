// Identita procesu, který čeká
// ==============================================================================
//
// Jedna náhodná hodnota na spuštění procesu.  Používá ji `createMobileApproval`
// (zapíše, kdo čeká) a úklid při startu (pozná, co po sobě nechal někdo jiný).
//
// Proč ne PID: PID se recykluje.  Po restartu může nový proces dostat týž PID
// jako ten, který spadl, a úklid by pak jeho vlastní čerstvé approvaly
// považoval za cizí zbytky — nebo naopak cizí zbytky za svoje.  Náhodná hodnota
// tenhle problém nemá a nic jiného od ní nechceme.
//
// Proč ne čas startu: dva procesy nastartované ve stejné milisekundě jsou
// nepravděpodobné, ne nemožné, a cena za jistotu je nula.
//
// ==============================================================================

import { randomUUID } from 'node:crypto';

export const BOOT_ID = randomUUID();

export default { BOOT_ID };
