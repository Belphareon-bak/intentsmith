// Bookmaker Data — Reference info for Czech market + international
// ══════════════════════════════════════════════════════════════════════════════

export const BOOKMAKERS = [
  // Czech market
  {
    id: 'tipsport',
    name: 'Tipsport',
    country: 'CZ',
    avgMargin: 5.5,
    strengths: ['Nejširší nabídka v CZ', 'Livescore', 'Cashout'],
    weaknesses: ['Vyšší marže na nižší ligy', 'Limitování úspěšných'],
    features: ['live', 'cashout', 'stream', 'mobile'],
    url: 'https://www.tipsport.cz',
    license: 'CZ',
  },
  {
    id: 'fortuna',
    name: 'Fortuna',
    country: 'CZ',
    avgMargin: 5.0,
    strengths: ['Dobrá nabídka na fotbal', 'Fortuna liga sponzor'],
    weaknesses: ['Menší nabídka exotických sportů'],
    features: ['live', 'cashout', 'mobile'],
    url: 'https://www.ifortuna.cz',
    license: 'CZ',
  },
  {
    id: 'betano',
    name: 'Betano',
    country: 'CZ',
    avgMargin: 4.5,
    strengths: ['Nižší marže', 'Boost akce', 'Široká nabídka'],
    weaknesses: ['Relativně nový na CZ trhu'],
    features: ['live', 'cashout', 'mobile', 'boost'],
    url: 'https://www.betano.cz',
    license: 'CZ',
  },
  {
    id: 'chance',
    name: 'Chance',
    country: 'CZ',
    avgMargin: 5.5,
    strengths: ['Sesterský Tipsport', 'Identická nabídka'],
    weaknesses: ['Stejné limity jako Tipsport'],
    features: ['live', 'cashout', 'mobile'],
    url: 'https://www.chance.cz',
    license: 'CZ',
  },
  {
    id: 'sazka',
    name: 'Sazka',
    country: 'CZ',
    avgMargin: 6.0,
    strengths: ['Loterie + sázky', 'Silná značka'],
    weaknesses: ['Vyšší marže', 'Menší sportovní nabídka'],
    features: ['live', 'mobile'],
    url: 'https://www.sazka.cz',
    license: 'CZ',
  },

  // International sharp bookmakers
  {
    id: 'pinnacle',
    name: 'Pinnacle',
    country: 'INT',
    avgMargin: 2.0,
    strengths: ['Nejnižší marže', 'Nelimituje hráče', 'Sharp benchmark'],
    weaknesses: ['Bez CZ licence', 'Bez cashout'],
    features: ['mobile'],
    url: 'https://www.pinnacle.com',
    license: 'Curaçao',
    isSharp: true,
  },
  {
    id: 'bet365',
    name: 'bet365',
    country: 'INT',
    avgMargin: 3.5,
    strengths: ['Nejlepší live sázení', 'Stream', 'Obrovská nabídka'],
    weaknesses: ['Limituje úspěšné hráče', 'Bez CZ licence'],
    features: ['live', 'cashout', 'stream', 'mobile'],
    url: 'https://www.bet365.com',
    license: 'UK',
  },
  {
    id: 'betfair',
    name: 'Betfair Exchange',
    country: 'INT',
    avgMargin: 1.5,
    strengths: ['Burza — nejlepší kurzy', 'Lay betting', '0% marže (komise)'],
    weaknesses: ['Pouze velké trhy', 'Komise 2-5%', 'Bez CZ licence'],
    features: ['exchange', 'live', 'cashout', 'mobile'],
    url: 'https://www.betfair.com',
    license: 'UK',
    isSharp: true,
  },
];

/**
 * Czech bookmakers sorted by margin (best first).
 */
export const CZ_BOOKMAKERS = BOOKMAKERS.filter(b => b.license === 'CZ').sort((a, b) => a.avgMargin - b.avgMargin);

/**
 * Sharp bookmakers for benchmark pricing.
 */
export const SHARP_BOOKMAKERS = BOOKMAKERS.filter(b => b.isSharp);
