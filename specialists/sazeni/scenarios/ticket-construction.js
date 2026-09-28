// Ticket Construction Scenario — Průvodce sestavením tiketu
// ══════════════════════════════════════════════════════════════════════════════

export const ticketConstructionScenario = {
  id: 'sazeni.ticket_construction',
  specialistId: 'sazeni',
  name: 'Sestavení sázkového tiketu',
  description: 'Provede uživatele celým procesem — od analýzy zápasů přes výběr tipů po sestavení tiketu s risk managementem.',
  introMessage: 'Pomohu ti sestavit sázkový tiket. Projdeme to krok za krokem — od výběru zápasů přes analýzu až po finální tiket s doporučeným stake.',

  triggers: [
    /sestav\w*\s+tik/i,
    /(?:postav|udělej|vytvoř)\w*\s+(?:mi\s+)?tik/i,
    /chci\s+(?:si\s+)?vsadit/i,
    /(?:tip|tipy)\s+na\s+(?:dnes|víkend|zítra|zápas)/i,
    /(?:jaké?|dej)\s+(?:mi\s+)?tipy/i,
  ],

  steps: [
    {
      id: 'sport',
      question: 'Na jaký sport chceš sázet?\n  1. Fotbal\n  2. Hokej\n  3. Tenis\n  4. Basketbal\n  5. Jiný',
      extract: (input) => {
        if (/1|fotbal|soccer|football/i.test(input)) return 'football';
        if (/2|hokej|ice\s*hockey/i.test(input)) return 'hockey';
        if (/3|tenis/i.test(input)) return 'tennis';
        if (/4|basketbal|basket|nba/i.test(input)) return 'basketball';
        const m = input.match(/5|jin[ýé]\w*:?\s*(.+)/i);
        return m ? m[1].trim() : input.trim() || null;
      },
      required: true,
      errorMessage: 'Prosím zvol sport (1-5)',
    },
    {
      id: 'matches',
      question: 'Jaké zápasy chceš analyzovat? Zadej je ve formátu:\n`Domácí vs Hosté` (jeden zápas na řádek)\n\nNapříklad:\n```\nSlavia vs Sparta\nBarcelona vs Real Madrid\n```',
      extract: (input) => {
        const lines = input.split('\n').map(l => l.trim()).filter(l => l.length > 0);
        const matches = [];
        for (const line of lines) {
          const m = line.match(/^(.+?)\s+(?:vs\.?|[-–—:]|proti)\s+(.+)$/i);
          if (m) matches.push({ home: m[1].trim(), away: m[2].trim() });
        }
        return matches.length > 0 ? matches : null;
      },
      required: true,
      errorMessage: 'Zadej alespoň jeden zápas ve formátu "Domácí vs Hosté"',
    },
    {
      id: 'odds_source',
      question: 'Máš k dispozici kurzy? Pokud ano, zadej je. Pokud ne, analýzu provedu bez nich.\n\nFormát: `Zápas | Booker | 1 | X | 2`\n\nNapříklad:\n```\nSlavia vs Sparta | Tipsport | 2.10 | 3.40 | 3.20\nSlavia vs Sparta | Fortuna | 2.15 | 3.30 | 3.10\n```\n\nNebo napiš "nemám" / "bez kurzů".',
      extract: (input) => {
        if (/nem[aá]m|bez\s+kurz|ne\b/i.test(input)) return 'none';
        const lines = input.split('\n').map(l => l.trim()).filter(l => l.length > 0);
        const odds = [];
        for (const line of lines) {
          const parts = line.split('|').map(p => p.trim());
          if (parts.length >= 4) {
            odds.push({
              match: parts[0],
              bookmaker: parts[1] || 'Neznámý',
              home: parseFloat(parts[2]),
              draw: parts[4] ? parseFloat(parts[3]) : null,
              away: parseFloat(parts[parts.length - 1]),
            });
          }
        }
        return odds.length > 0 ? odds : 'none';
      },
      required: false,
    },
    {
      id: 'ticket_type',
      question: 'Jaký typ tiketu chceš?\n  1. Akumulátor (všechny tipy musí vyjít)\n  2. Systém (toleruje prohru některých tipů)\n  3. Jednotlivé sázky (každý tip zvlášť)',
      extract: (input) => {
        if (/1|akum|kombin|parlay/i.test(input)) return 'accumulator';
        if (/2|syst[eé]/i.test(input)) return 'system';
        if (/3|jednotliv|singl/i.test(input)) return 'single';
        return null;
      },
      required: true,
      errorMessage: 'Zvol typ tiketu: 1 (akumulátor), 2 (systém) nebo 3 (jednotlivé)',
    },
    {
      id: 'stake',
      question: 'Jaký je tvůj celkový stake (vklad)? A kolik je tvůj bankroll (celková suma na sázení)?\n\nNapříklad: `500 Kč, bankroll 10000 Kč`\nNebo jen: `500`',
      extract: (input) => {
        const result = {};
        const stakeMatch = input.match(/(\d[\d\s,.]*\d?)\s*(?:kč|czk|Kč)?/i);
        if (stakeMatch) result.stake = parseFloat(stakeMatch[1].replace(/[\s,]/g, ''));
        const brMatch = input.match(/bankroll\s*:?\s*(\d[\d\s,.]*\d?)/i);
        if (brMatch) result.bankroll = parseFloat(brMatch[1].replace(/[\s,]/g, ''));
        return result.stake ? result : null;
      },
      required: true,
      validate: (v) => v.stake > 0,
      errorMessage: 'Zadej platnou částku (číslo)',
    },
  ],
};
