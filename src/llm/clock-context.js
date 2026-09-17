// Request-time clock facts for interactive model responses. Never derive the
// present from training data, conversation history or a browser-provided date.
export function clockContext(now = new Date(), timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone) {
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-GB', {
    timeZone, calendar: 'gregory', numberingSystem: 'latn',
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23',
  }).formatToParts(now).map(part => [part.type, part.value]));
  // Shift civil calendar dates, not 24-hour durations: DST days can be 23/25h.
  const civil = new Date(`${parts.year}-${parts.month}-${parts.day}T12:00:00.000Z`);
  const dateAt = offset => {
    const date = new Date(civil);
    date.setUTCDate(date.getUTCDate() + offset);
    return `${date.toISOString().slice(0, 10)} (${new Intl.DateTimeFormat('en', {
      weekday: 'long', timeZone: 'UTC',
    }).format(date)})`;
  };
  return Object.freeze({
    utc: now.toISOString(), timeZone,
    localTime: `${parts.hour}:${parts.minute}:${parts.second}`,
    yesterday: dateAt(-1), today: dateAt(0), tomorrow: dateAt(1),
  });
}

export function clockSystemPrompt() {
  const clock = clockContext(); // Fresh for every request, including retries.
  return `[Current clock — supplied by IntentSmith for this request]
UTC: ${clock.utc}; local timezone: ${clock.timeZone}; local time: ${clock.localTime}.
Yesterday / včera: ${clock.yesterday}.
Today / dnes: ${clock.today}.
Tomorrow / zítra: ${clock.tomorrow}.
Use this reference for relative dates in the current question, including calendar arithmetic. Do not treat dates in earlier replies or training data as the present. Preserve explicit historical, quoted or hypothetical reference dates. The clock does not provide knowledge of current events.`;
}

export function withClockContext(systemPrompt, options = {}) {
  const clock = clockSystemPrompt();
  return {
    ...options,
    systemPrompt: `${clock}\n\n${options.systemPrompt ?? systemPrompt ?? ''}`,
    ...(Array.isArray(options.messages)
      ? { messages: [{ role: 'system', content: clock }, ...options.messages] }
      : {}),
  };
}
