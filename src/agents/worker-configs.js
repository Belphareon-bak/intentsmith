// ═══════════════════════════════════════════════════════════════════════════════
// C3-Agent — B8: Pre-built Worker Configurations
// ═══════════════════════════════════════════════════════════════════════════════
//
// Ready-to-deploy agent definitions for 3 common use cases:
//   1. Weather monitor → Telegram notification on significant change
//   2. Real estate hunter → email when new listing matches criteria
//   3. News aggregator → daily digest from multiple RSS feeds
//
// Usage:
//   import { WORKER_TEMPLATES } from './worker-configs.js';
//   const agent = WORKER_TEMPLATES.weather({ city: 'Prague', threshold: 5 });
//   agentStore.createAgent(agent);
//
// ═══════════════════════════════════════════════════════════════════════════════

// ─── 1. Weather Monitor ──────────────────────────────────────────────────────

/**
 * Create a weather monitoring agent.
 *
 * @param {object} params
 * @param {string} params.city - City name
 * @param {number} [params.lat] - Latitude
 * @param {number} [params.lon] - Longitude
 * @param {number} [params.tempThreshold=5] - Notify if temp changes by this many °C
 * @param {boolean} [params.notifyRain=true] - Notify on rain forecast
 * @param {string} [params.channel='telegram'] - Notification channel
 * @param {string} [params.recipient] - Channel recipient
 * @param {string} [params.schedule='0 7,12,18 * * *'] - Default: 7am, noon, 6pm
 */
export function weatherMonitor(params = {}) {
  const {
    city = 'Prague', lat = 50.0755, lon = 14.4378,
    tempThreshold = 5, notifyRain = true,
    channel = 'telegram', recipient = '',
    schedule = '0 7,12,18 * * *',
  } = params;

  return {
    id: `weather-${city.toLowerCase().replace(/\s+/g, '-')}`,
    name: `Počasí ${city}`,
    description: `Sleduje počasí v ${city}. Upozorní při změně teploty o ${tempThreshold}°C nebo při dešti.`,
    definition: {
      source: {
        type: 'api',
        url: `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&current=temperature_2m,precipitation,weather_code&daily=temperature_2m_max,temperature_2m_min,precipitation_sum&timezone=Europe/Prague&forecast_days=2`,
        id: 'open-meteo',
        name: 'Open-Meteo',
      },
      schedule: { cron: schedule },
      condition: {
        type: 'compare',
        rules: [
          { field: 'current.temperature_2m', operator: 'delta_abs', threshold: tempThreshold },
          ...(notifyRain ? [{ field: 'current.precipitation', operator: 'gt', threshold: 0 }] : []),
        ],
        mode: 'any',  // Trigger on ANY rule match
      },
      action: {
        type: 'notify',
        channel,
        recipient,
        template: {
          title: `🌤 Počasí ${city}`,
          body: `Teplota: {{current.temperature_2m}}°C\nSrážky: {{current.precipitation}}mm\nZítra: {{daily.temperature_2m_min[1]}}–{{daily.temperature_2m_max[1]}}°C`,
        },
      },
      extract: {
        fields: ['current.temperature_2m', 'current.precipitation', 'current.weather_code',
                 'daily.temperature_2m_max', 'daily.temperature_2m_min', 'daily.precipitation_sum'],
      },
    },
    enabled: true,
  };
}

// ─── 2. Real Estate Hunter ───────────────────────────────────────────────────

/**
 * Create a real estate monitoring agent.
 *
 * @param {object} params
 * @param {string} [params.location='Praha'] - City/region
 * @param {number} [params.maxPrice=5000000] - Max price CZK
 * @param {number} [params.minArea=60] - Min area m²
 * @param {string} [params.type='prodej'] - 'prodej' | 'pronájem'
 * @param {string[]} [params.keywords] - Additional filter keywords
 * @param {string} [params.channel='email'] - Notification channel
 * @param {string} [params.recipient] - Email address
 * @param {string} [params.schedule='0 8,16 * * *'] - Default: 8am, 4pm
 */
export function realEstateHunter(params = {}) {
  const {
    location = 'Praha', maxPrice = 5000000, minArea = 60,
    type = 'prodej', keywords = [],
    channel = 'email', recipient = '',
    schedule = '0 8,16 * * *',
  } = params;

  const locationSlug = location.toLowerCase().replace(/\s+/g, '-');

  return {
    id: `realestate-${locationSlug}-${type}`,
    name: `Reality ${location} — ${type}`,
    description: `Sleduje nové nabídky ${type === 'prodej' ? 'k prodeji' : 'k pronájmu'} v ${location}. Max ${(maxPrice / 1e6).toFixed(1)}M Kč, min ${minArea}m².`,
    definition: {
      sources: [
        {
          id: 'sreality',
          type: 'url',
          url: `https://www.sreality.cz/api/cs/v2/estates?category_main_cb=1&category_type_cb=${type === 'prodej' ? 1 : 2}&locality_region_id=10&per_page=20`,
          name: 'Sreality',
          priority: 2,
          maxItems: 20,
        },
        {
          id: 'bezrealitky',
          type: 'url',
          url: `https://www.bezrealitky.cz/api/record/markers?offerType=${type === 'prodej' ? 'PRODEJ' : 'PRONAJEM'}&estateType=BYT&regionOsmIds=R435514&limit=20`,
          name: 'Bezrealitky',
          priority: 1,
          maxItems: 20,
        },
      ],
      multiSource: true,
      schedule: { cron: schedule },
      condition: {
        type: 'new_items',
        filter: {
          maxPrice,
          minArea,
          keywords: keywords.length > 0 ? keywords : undefined,
        },
      },
      action: {
        type: 'notify',
        channel,
        recipient,
        template: {
          title: `🏠 Nová nabídka: {{title}}`,
          body: `📍 {{location}}\n💰 {{price}} Kč\n📐 {{area}} m²\n🔗 {{url}}`,
        },
        digest: {
          enabled: true,
          interval: '4h',
          maxItems: 10,
        },
      },
    },
    enabled: true,
  };
}

// ─── 3. News RSS Aggregator ──────────────────────────────────────────────────

/**
 * Create a news aggregation agent from multiple RSS feeds.
 *
 * @param {object} params
 * @param {string} [params.name='Zprávy'] - Agent name
 * @param {Array<{url: string, name: string}>} [params.feeds] - RSS feed list
 * @param {string[]} [params.keywords] - Filter keywords (empty = all)
 * @param {string} [params.channel='ntfy'] - Notification channel
 * @param {string} [params.recipient] - Channel recipient
 * @param {string} [params.schedule='0 8 * * *'] - Default: daily 8am
 * @param {boolean} [params.digest=true] - Batch as daily digest
 */
export function newsAggregator(params = {}) {
  const {
    name = 'Zprávy',
    feeds = DEFAULT_CZ_FEEDS,
    keywords = [],
    channel = 'ntfy', recipient = '',
    schedule = '0 8 * * *',
    digest = true,
  } = params;

  return {
    id: `news-${name.toLowerCase().replace(/\s+/g, '-')}`,
    name,
    description: `Agregátor zpráv z ${feeds.length} zdrojů.${keywords.length > 0 ? ` Filtr: ${keywords.join(', ')}` : ' Bez filtru.'}`,
    definition: {
      sources: feeds.map((f, i) => ({
        id: f.id || `rss-${i}`,
        type: 'rss',
        url: f.url,
        name: f.name,
        keywords: f.keywords || keywords,
        priority: f.priority || 1,
        maxItems: f.maxItems || 10,
      })),
      multiSource: true,
      schedule: { cron: schedule },
      condition: {
        type: 'new_items',
      },
      action: {
        type: 'notify',
        channel,
        recipient,
        template: {
          title: digest ? `📰 ${name} — denní přehled` : `📰 {{sourceName}}: {{title}}`,
          body: digest ? '{{#items}}\n• **{{title}}** ({{sourceName}})\n  {{description}}\n  {{url}}\n{{/items}}' : '{{description}}\n\n🔗 {{url}}',
        },
        digest: digest ? { enabled: true, interval: '24h', maxItems: 20 } : undefined,
      },
    },
    enabled: true,
  };
}

// ─── Default Czech news feeds ────────────────────────────────────────────────

const DEFAULT_CZ_FEEDS = [
  { id: 'irozhlas', name: 'iROZHLAS', url: 'https://www.irozhlas.cz/rss/irozhlas', priority: 2 },
  { id: 'novinky', name: 'Novinky.cz', url: 'https://www.novinky.cz/rss', priority: 1 },
  { id: 'lupa', name: 'Lupa.cz', url: 'https://www.lupa.cz/rss/clanky/', priority: 1, keywords: ['technologie', 'AI', 'IT'] },
  { id: 'root', name: 'Root.cz', url: 'https://www.root.cz/rss/clanky/', priority: 1, keywords: ['linux', 'open source'] },
];

// ─── Template Registry ───────────────────────────────────────────────────────

export const WORKER_TEMPLATES = {
  weather: weatherMonitor,
  realEstate: realEstateHunter,
  news: newsAggregator,
};

/**
 * Get available worker templates with descriptions.
 */
export function getTemplateDescriptions(lang = 'cs') {
  return [
    {
      id: 'weather',
      name: lang === 'cs' ? 'Monitor počasí' : 'Weather Monitor',
      description: lang === 'cs'
        ? 'Sleduje teplotu a srážky. Upozorní při velké změně nebo dešti.'
        : 'Monitors temperature and precipitation. Notifies on significant changes.',
      icon: '🌤',
      params: ['city', 'tempThreshold', 'notifyRain'],
    },
    {
      id: 'realEstate',
      name: lang === 'cs' ? 'Hlídač nemovitostí' : 'Real Estate Hunter',
      description: lang === 'cs'
        ? 'Sleduje nové nabídky na Sreality a Bezrealitky. Filtruje dle ceny a plochy.'
        : 'Monitors new listings on real estate portals. Filters by price and area.',
      icon: '🏠',
      params: ['location', 'maxPrice', 'minArea', 'type'],
    },
    {
      id: 'news',
      name: lang === 'cs' ? 'Zpravodajský agregátor' : 'News Aggregator',
      description: lang === 'cs'
        ? 'Sbírá zprávy z RSS feedů. Posílá denní přehled nebo okamžitě.'
        : 'Aggregates news from RSS feeds. Sends daily digest or instant.',
      icon: '📰',
      params: ['feeds', 'keywords', 'digest'],
    },
  ];
}

export default { WORKER_TEMPLATES, getTemplateDescriptions, weatherMonitor, realEstateHunter, newsAggregator };
