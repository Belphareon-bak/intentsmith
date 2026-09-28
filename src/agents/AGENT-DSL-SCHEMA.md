# C.3 Agent DSL Schema
> Version 33.0 | Specifikace co builder SMÍ generovat

Builder je **překladač**, ne autor. Generuje POUZE z těchto povolených bloků.

---

## 📋 Agent Definition Schema

```yaml
agent:
  id: string           # slug: [a-z0-9-]+, max 64 chars
  name: string         # max 128 chars
  description: string  # max 500 chars
  icon: string         # single emoji
  
  schedule: Schedule
  sources: Source[]    # min 1
  conditions: Condition[]
  triggers: Trigger[]
  actions: Action[]
  
  state_schema: object # initial state shape
  params: Param[]      # user-configurable params
```

---

## ⏰ Schedule (povolené typy)

```yaml
Schedule:
  type: enum
    - cron      # "0 8 * * *"
    - interval  # "1h", "30m", "4h", "1d"
    - manual    # only on-demand
  value: string # required for cron/interval
```

**Povolené intervaly:** `5m`, `15m`, `30m`, `1h`, `2h`, `4h`, `6h`, `12h`, `1d`, `7d`

**Cron:** standardní 5-part format, min interval 5 minut

---

## 📡 Sources (povolené typy)

### HTTP API
```yaml
Source:
  id: string
  type: "http"
  config:
    url: string              # HTTPS only
    method: "GET" | "POST"   # default GET
    headers: object          # optional
    params: object           # query params, supports {{params.x}}
    body: object             # for POST
    timeout: number          # ms, default 30000, max 60000
```

### Web Scraper
```yaml
Source:
  id: string
  type: "scraper"
  config:
    url: string
    selectors:               # CSS selectors → named fields
      field_name: string     # e.g., ".price", "#title"
    timeout: number
```

### RSS Feed
```yaml
Source:
  id: string
  type: "rss"
  config:
    url: string
    limit: number            # max items, default 20, max 100
```

### Internal Database
```yaml
Source:
  id: string
  type: "database"
  config:
    table: enum              # only allowed tables
      - user_inventory
      - agent_data
    where: object            # simple key-value filters
```

**Zakázáno:** arbitrary SQL, file://, localhost, internal IPs

---

## 🔍 Conditions (deterministické porovnání)

Condition = čisté vyhodnocení hodnoty, vrací `true`/`false`

### Compare (porovnání hodnot)
```yaml
Condition:
  id: string
  type: "compare"
  field: string              # path: "sources.weather.data.temp"
  operator: enum
    - "<"
    - ">"
    - "<="
    - ">="
    - "=="
    - "!="
  value: number | string | boolean | "{{params.x}}"
```

### Date Diff (časový rozdíl)
```yaml
Condition:
  id: string
  type: "date_diff"
  field: string              # path to date field
  operator: "<=" | ">=" | "<" | ">"
  value: number              # amount
  unit: "days" | "hours" | "minutes"
  reference: "now"           # always relative to now
```

### Contains (text obsahuje)
```yaml
Condition:
  id: string
  type: "contains"
  field: string
  value: string
  case_sensitive: boolean    # default false
```

### Exists (položky existují)
```yaml
Condition:
  id: string
  type: "exists"
  field: string              # path to array
  min_count: number          # default 1
```

### In Range (hodnota v rozsahu)
```yaml
Condition:
  id: string
  type: "in_range"
  field: string
  min: number                # optional
  max: number                # optional
  array_mode: enum           # when field is array
    - "any"                  # default - at least one matches
    - "all"                  # all must match
    - "none"                 # none must match
```

---

## 🔢 Array Mode (pro všechny conditions)

Když `field` ukazuje na pole (např. `results[*].price`):

```yaml
array_mode: enum
  - "any"    # default - alespoň jeden prvek splňuje
  - "all"    # všechny prvky musí splňovat
  - "none"   # žádný prvek nesmí splňovat
  - "count"  # vrací počet splňujících (pro compare s číslem)
  
  # Agregace (pro numerické hodnoty):
  - "min"    # porovnává minimum z pole
  - "max"    # porovnává maximum z pole  
  - "avg"    # porovnává průměr z pole
  - "sum"    # porovnává součet z pole
```

**Příklad:**
```json
{
  "id": "any_cheap_property",
  "type": "in_range",
  "field": "sources.sreality.data.results[*].price",
  "max": 3000000,
  "array_mode": "any"
}
```

```json
{
  "id": "avg_price_dropped",
  "type": "compare",
  "field": "sources.sreality.data.results[*].price",
  "operator": "<",
  "value": "{{state.last_avg_price}}",
  "array_mode": "avg"
}
```

**Zakázáno:** regex, eval, custom functions, LLM evaluation

---

## ⚡ Triggers (edge detection)

Trigger = změna stavu condition. **Ne** pouhá pravdivost.

```yaml
Trigger:
  id: string
  condition_id: string       # reference to Condition
  edge: enum
    - "rising"               # false → true (default)
    - "falling"              # true → false
    - "any"                  # any change
  cooldown: number           # min seconds between fires, default 0
  max_fires_per_day: number  # optional, prevents spam
```

**Runtime logika:**
```
previous_state = state[condition_id] ?? null
current_state = evaluate(condition)

if edge == "rising":
    fire = (previous_state == false) && (current_state == true)
elif edge == "falling":
    fire = (previous_state == true) && (current_state == false)
elif edge == "any":
    fire = (previous_state != current_state) && (previous_state != null)

state[condition_id] = current_state
```

---

## 🎬 Actions (povolené akce)

### Notify (in-app notifikace)
```yaml
Action:
  type: "notify"
  trigger_id: string         # which trigger activates this
  config:
    title: string            # supports {{field}} interpolation
    body: string             # supports {{field}} interpolation
    priority: "low" | "normal" | "high"
    use_llm: boolean         # LLM formats body text (default false)
```

**LLM pravidla (když `use_llm: true`):**
- ✅ Přeformulovat text do přirozeného jazyka
- ✅ Shrnout více hodnot do věty
- ✅ Přidat kontext (např. "to je o 15% méně než minule")
- ❌ NESMÍ měnit fakta nebo čísla
- ❌ NESMÍ přidávat údaje, které nejsou v datech
- ❌ NESMÍ volat další akce nebo měnit stav
- ❌ Output NIKDY není persistován do state

**LLM je presentation-only layer.**

### Store (uložit do state)
```yaml
Action:
  type: "store"
  trigger_id: string | null  # null = always run
  config:
    key: string
    value: string            # supports {{field}}
    append: boolean          # append to array (default false)
    max_items: number        # for arrays, default 1000
```

### Webhook
```yaml
Action:
  type: "webhook"
  trigger_id: string
  config:
    url: string              # HTTPS only
    method: "POST" | "PUT"
    headers: object
    body: object             # supports {{field}}
```

### Mark Seen (pro HUNTER agenty)
```yaml
Action:
  type: "mark_seen"
  trigger_id: string | null
  config:
    source_id: string
    id_field: string         # path to unique ID in items
```

**Zakázáno:** email (zatím), exec, file write, chain agents (zatím)

---

## 🎛️ Params (user-configurable)

```yaml
Param:
  name: string               # slug
  type: enum
    - "string"
    - "number"
    - "boolean"
    - "date"
    - "location"             # {lat, lon, name}
    - "select"               # single choice
    - "multiselect"          # multiple choices
  label: string              # display name
  description: string        # optional
  required: boolean          # default false
  default: any               # optional
  
  # For number:
  min: number
  max: number
  
  # For select/multiselect:
  options:
    - value: string
      label: string
```

---

## 📦 State Schema

Definuje tvar perzistentního stavu agenta:

```yaml
state_schema:
  _last_run: "datetime"          # auto
  _condition_states: "object"    # auto (for edge detection)
  
  # Custom fields:
  seen_ids: "string[]"           # for HUNTER
  last_value: "number"           # for PRICE_MONITOR
  history: "object[]"            # for tracking
```

---

## ✅ Validation Rules

Builder MUSÍ dodržet:

1. **Všechny ID jsou unique** v rámci agenta
2. **Trigger.condition_id** musí existovat v conditions
3. **Action.trigger_id** musí existovat v triggers (nebo null)
4. **Source URLs** musí být HTTPS (kromě localhost pro dev)
5. **Field paths** musí začínat `sources.`, `state.`, nebo `params.`
6. **Interpolace** `{{x}}` jen pro povolené paths
7. **Schedule interval** min 5 minut
8. **Max 10 conditions** per agent
9. **Max 10 actions** per agent
10. **Max 5 sources** per agent

---

## 🚫 Co Builder NESMÍ

- Vymýšlet nové typy (conditions, sources, actions)
- Generovat regex nebo custom expressions
- Navrhovat LLM-based conditions
- Vytvářet cyklické závislosti
- Používat eval() nebo podobné
- Přistupovat k file systému
- Volat interní API bez definice

---

## 📝 Příklad: Weather Frost Alert

```json
{
  "id": "frost-alert-praha",
  "name": "Frost Alert Praha",
  "description": "Upozorní 2 dny před mrazem",
  "icon": "🥶",
  
  "schedule": {
    "type": "cron",
    "value": "0 8 * * *"
  },
  
  "sources": [
    {
      "id": "weather",
      "type": "http",
      "config": {
        "url": "https://api.openweathermap.org/data/2.5/forecast",
        "params": {
          "lat": "{{params.location.lat}}",
          "lon": "{{params.location.lon}}",
          "appid": "{{secrets.OPENWEATHER_KEY}}",
          "units": "metric"
        }
      }
    }
  ],
  
  "conditions": [
    {
      "id": "frost_in_forecast",
      "type": "compare",
      "field": "sources.weather.data.list[0].main.temp_min",
      "operator": "<=",
      "value": 0
    }
  ],
  
  "triggers": [
    {
      "id": "frost_detected",
      "condition_id": "frost_in_forecast",
      "edge": "rising",
      "cooldown": 86400
    }
  ],
  
  "actions": [
    {
      "type": "notify",
      "trigger_id": "frost_detected",
      "config": {
        "title": "🥶 Pozor: Blíží se mráz!",
        "body": "Minimální teplota: {{sources.weather.data.list[0].main.temp_min}}°C",
        "priority": "high",
        "use_llm": false
      }
    }
  ],
  
  "state_schema": {
    "seen_ids": []
  },
  
  "params": [
    {
      "name": "location",
      "type": "location",
      "label": "Město",
      "required": true
    }
  ]
}
```

---

## 📝 Příklad: Property Hunter

```json
{
  "id": "property-hunter-praha",
  "name": "Pozemky Praha",
  "description": "Hledá pozemky 800-1500m² do 3M Kč",
  "icon": "🏠",
  
  "schedule": {
    "type": "interval",
    "value": "1h"
  },
  
  "sources": [
    {
      "id": "sreality",
      "type": "http",
      "config": {
        "url": "https://www.sreality.cz/api/v1/estates",
        "params": {
          "category": "land",
          "region": "{{params.region}}"
        }
      }
    }
  ],
  
  "conditions": [
    {
      "id": "has_new_items",
      "type": "exists",
      "field": "sources.sreality.data.results",
      "min_count": 1
    },
    {
      "id": "price_ok",
      "type": "in_range",
      "field": "sources.sreality.data.results[*].price",
      "max": "{{params.max_price}}"
    },
    {
      "id": "size_ok",
      "type": "in_range",
      "field": "sources.sreality.data.results[*].area",
      "min": "{{params.min_size}}",
      "max": "{{params.max_size}}"
    }
  ],
  
  "triggers": [
    {
      "id": "new_property",
      "condition_id": "has_new_items",
      "edge": "rising"
    }
  ],
  
  "actions": [
    {
      "type": "notify",
      "trigger_id": "new_property",
      "config": {
        "title": "🏠 Nový pozemek!",
        "body": "Nalezeny nové pozemky matching kritéria",
        "priority": "high",
        "use_llm": true
      }
    },
    {
      "type": "mark_seen",
      "trigger_id": null,
      "config": {
        "source_id": "sreality",
        "id_field": "id"
      }
    }
  ],
  
  "state_schema": {
    "seen_ids": []
  },
  
  "params": [
    {
      "name": "region",
      "type": "string",
      "label": "Region",
      "required": true
    },
    {
      "name": "min_size",
      "type": "number",
      "label": "Min m²",
      "default": 800
    },
    {
      "name": "max_size",
      "type": "number",
      "label": "Max m²",
      "default": 1500
    },
    {
      "name": "max_price",
      "type": "number",
      "label": "Max cena",
      "default": 3000000
    }
  ]
}
```

---

## ✓ Checklist pro Builder

Při generování definice builder MUSÍ:

- [ ] Použít POUZE typy z tohoto schema
- [ ] Validovat proti JSON Schema
- [ ] Zkontrolovat reference (trigger→condition, action→trigger)
- [ ] Ověřit paths (sources.x, params.x, state.x)
- [ ] Dodržet limity (max conditions, actions, sources)
- [ ] Nastavit rozumné defaults (cooldown, priority)
- [ ] Vygenerovat unikátní ID
- [ ] Nastavit default cooldown min 300s (5 min)

Při chybě → vrátit validační error, NE hádat.

---

## 📚 Canonical Patterns

### HUNTER Pattern (hledání nových položek)

Pro agenty typu "najdi nové inzeráty/nabídky":

```json
{
  "conditions": [
    {
      "id": "has_items",
      "type": "exists",
      "field": "sources.listings.data.items"
    }
  ],
  
  "triggers": [
    {
      "id": "new_items_found",
      "condition_id": "has_items",
      "edge": "rising",
      "cooldown": 3600
    }
  ],
  
  "actions": [
    {
      "type": "notify",
      "trigger_id": "new_items_found",
      "config": { "..." }
    },
    {
      "type": "mark_seen",
      "trigger_id": null,
      "config": {
        "source_id": "listings",
        "id_field": "id"
      }
    }
  ],
  
  "state_schema": {
    "seen_ids": []
  }
}
```

**Jak to funguje:**
1. `mark_seen` (trigger_id: null) běží VŽDY a ukládá ID všech položek
2. Při dalším běhu source vrací položky, ale runtime automaticky filtruje:
   - `items.filter(i => !state.seen_ids.includes(i.id))`
3. `exists` condition kontroluje filtrované (=nové) položky
4. Trigger `rising` = "dříve 0 nových, teď >0 nových"

### MONITOR Pattern (sledování podmínky)

Pro agenty typu "upozorni když X":

```json
{
  "conditions": [
    {
      "id": "threshold_crossed",
      "type": "compare",
      "field": "sources.data.value",
      "operator": "<=",
      "value": "{{params.threshold}}"
    }
  ],
  
  "triggers": [
    {
      "id": "alert",
      "condition_id": "threshold_crossed",
      "edge": "rising",
      "cooldown": 86400
    }
  ]
}
```

**Klíčové:** `edge: "rising"` = notifikace jen při ZMĚNĚ na true, ne při každém běhu.

### TRACKER Pattern (sledování termínů)

Pro agenty typu "záruky, expirace":

```json
{
  "sources": [
    {
      "id": "items",
      "type": "database",
      "config": {
        "table": "user_inventory",
        "where": { "warranty_end": { "not_null": true } }
      }
    }
  ],
  
  "conditions": [
    {
      "id": "expiring_soon",
      "type": "date_diff",
      "field": "sources.items.data[*].warranty_end",
      "operator": "<=",
      "value": "{{params.days_ahead}}",
      "unit": "days",
      "array_mode": "any"
    }
  ]
}
```

### PRICE_MONITOR Pattern (sledování změn)

Pro agenty typu "cena se změnila o X%":

```json
{
  "conditions": [
    {
      "id": "price_changed",
      "type": "compare",
      "field": "sources.prices.data.current",
      "operator": "!=",
      "value": "{{state.last_price}}"
    }
  ],
  
  "triggers": [
    {
      "id": "significant_change",
      "condition_id": "price_changed",
      "edge": "rising"
    }
  ],
  
  "actions": [
    {
      "type": "store",
      "trigger_id": null,
      "config": {
        "key": "last_price",
        "value": "{{sources.prices.data.current}}"
      }
    }
  ]
}
```

### DIGEST Pattern (pravidelné shrnutí)

Pro agenty typu "denní přehled":

```json
{
  "schedule": {
    "type": "cron",
    "value": "0 7 * * *"
  },
  
  "triggers": [
    {
      "id": "daily",
      "condition_id": "has_content",
      "edge": "any"
    }
  ],
  
  "actions": [
    {
      "type": "notify",
      "trigger_id": "daily",
      "config": {
        "title": "📰 Denní přehled",
        "body": "{{sources.news.data}}",
        "use_llm": true
      }
    }
  ]
}
```

**Pozn:** `edge: "any"` = triggeruje při každém běhu kdy je obsah (pro pravidelné digestu).

---

## 🔧 Runtime Defaults

Builder MUSÍ nastavit tyto defaults pokud uživatel nespecifikuje:

| Parametr | Default | Min | Max |
|----------|---------|-----|-----|
| trigger.cooldown | 300 | 60 | 604800 |
| trigger.max_fires_per_day | 10 | 1 | 100 |
| action.notify.priority | "normal" | - | - |
| source.timeout | 30000 | 5000 | 60000 |
| schedule.interval | "1h" | "5m" | "7d" |
