// Read-only interpretation and rendering. This module cannot execute effects.
// The classifier selects exact spans; the application owns execution status.
const KINDS = new Set(['mail', 'calendar', 'hardware']);

function hardwareValueMissing(request) {
  // Missing numeric parameters are a core check, not a classifier confidence
  // flag. These are unit domains, never routing rules or executable values.
  const domains = [
    [/nap[eě]t[ií]|nap[aä]tie|voltage|spannung/iu, /^(?:mV|V|kV|volts?|volt[uůy]|voltov)$/iu],
    [/frekvenc|frequency|frequenz|takt|clock/iu, /^(?:Hz|kHz|MHz|GHz)$/iu],
    [/v[yý]kon|power|leistung/iu, /^(?:mW|W|kW|watts?|watt[uůy])$/iu],
  ];
  const domain = domains.find(([quantity]) => quantity.test(request));
  if (!domain) return false;
  const values = [...request.matchAll(/(?:^|[\s(,:])([-+]?\d+(?:[.,]\d+)?)\s*([\p{L}]+)(?![\p{L}\p{N}_])/gu)];
  return !values.some(match => domain[1].test(match[2]) && Number.isFinite(Number(match[1].replace(',', '.'))));
}

export function validateUnavailableAction(value, input) {
  if (!value || !KINDS.has(value.kind) || typeof value.request !== 'string'
    || !value.request.trim() || !input.includes(value.request)
    || input.indexOf(value.request) !== input.lastIndexOf(value.request)) return null;
  const requestStart = input.indexOf(value.request);
  const textRequest = value.textRequest ?? null;
  if (textRequest !== null) {
    if (typeof textRequest !== 'string' || !textRequest.trim() || !input.includes(textRequest)) return null;
    const start = input.indexOf(textRequest);
    if (start < requestStart + value.request.length && requestStart < start + textRequest.length) return null;
  }
  const recipient = value.recipient ?? null;
  if (recipient !== null && (typeof recipient !== 'string'
    || !/^[^\s<>@]+@[^\s<>@]+\.[^\s<>@]+$/u.test(recipient)
    || !value.request.includes(recipient))) return null;
  const literalBody = value.literalBody ?? null;
  if (literalBody !== null && (typeof literalBody !== 'string'
    || ![['"', '"'], ['„', '“'], ['“', '”'], ["'", "'"]]
      .some(([open, close]) => value.request.includes(open + literalBody + close)))) return null;
  // The model may omit independent text (observed in 19/20 reproductions).
  // Preserve ALL remaining source spans instead of trusting that omission.
  // Remove only a dangling join after terminal punctuation, never a subject
  // such as the variable A. No remainder can grant executable authority.
  const prefix = input.slice(0, requestStart).replace(/([.!?;])\s+(?:a|and|then|pak|potom|und)[,\s]*$/iu, '$1').trim();
  const suffix = input.slice(requestStart + value.request.length).replace(/^[\s.!?;,]+/u, '').trim();
  const independentText = [prefix, suffix].filter(part => /[\p{L}\p{N}]/u.test(part)).join('\n');
  return { kind: value.kind, request: value.request, recipient, literalBody, independentText,
    needsClarification: value.needsClarification === true || value.kind === 'hardware' && hardwareValueMissing(value.request) };
}

// A longer fence prevents draft text becoming an application status in Markdown.
export function quoteActionDraft(text) {
  let width = 3;
  for (const match of String(text).matchAll(/`+/gu)) width = Math.max(width, match[0].length + 1);
  const fence = '`'.repeat(width);
  return `${fence}text\n${text}\n${fence}`;
}

export function unavailableActionPresentation(kind, language, quantity = null) {
  quantity = quantity?.replace(/[\r\n]/gu, ' ').replace(/[\\`*_{}[\]()#+.!<>|]/gu, '\\$&') || null;
  const cs = {
    mail: ['Neodeslal jsem — pošta není napojená.', 'Koncept e-mailu'],
    calendar: ['Událost jsem nevytvořil — osobní kalendář není napojený.', 'Návrh události pro ruční vložení'],
    hardware: ['Nastavení GPU jsem nezměnil — ovládání hardwaru není napojené.', ''],
    other: ['Požadovanou akci jsem neprovedl — tato chatová cesta pro ni nemá adaptér.', 'Textový návrh'],
  };
  const en = {
    mail: ['I did not send it — mail is not connected.', 'Email draft'],
    calendar: ['I did not create the event — the personal calendar is not connected.', 'Event draft for manual entry'],
    hardware: ['I did not change the GPU settings — hardware control is not connected.', ''],
    other: ['I did not perform the requested action — this chat path has no adapter for it.', 'Text draft'],
  };
  const sk = {
    mail: ['Neodoslal som — pošta nie je napojená.', 'Koncept e-mailu'],
    calendar: ['Udalosť som nevytvoril — osobný kalendár nie je napojený.', 'Návrh udalosti na ručné vloženie'],
    hardware: ['Nastavenie GPU som nezmenil — ovládanie hardvéru nie je napojené.', ''],
    other: ['Požadovanú akciu som nevykonal — táto chatová cesta pre ňu nemá adaptér.', 'Textový návrh'],
  };
  const de = {
    mail: ['Ich habe nichts gesendet — E-Mail ist nicht angebunden.', 'E-Mail-Entwurf'],
    calendar: ['Ich habe keinen Termin erstellt — der persönliche Kalender ist nicht angebunden.', 'Terminentwurf zum manuellen Eintragen'],
    hardware: ['Ich habe die GPU-Einstellungen nicht geändert — die Hardwaresteuerung ist nicht angebunden.', ''],
    other: ['Ich habe die gewünschte Aktion nicht ausgeführt — dieser Chat hat dafür keinen Adapter.', 'Textentwurf'],
  };
  const messages = { cs, en, sk, de }[language] || cs;
  const [status, draftLabel] = messages[kind] || messages.other;
  const clarification = language === 'en'
    ? `For a manual procedure, what are the current and target values${quantity ? ` of ${quantity}` : ''}, including units?`
    : language === 'sk' ? `Pre ručný postup: aká je súčasná a cieľová hodnota${quantity ? ` veličiny ${quantity}` : ''}, vrátane jednotiek?`
      : language === 'de' ? `Für das manuelle Vorgehen: Wie lauten der aktuelle und der gewünschte Wert${quantity ? ` für ${quantity}` : ''}, einschließlich Einheiten?`
        : `Pro ruční postup: jaká je současná a cílová hodnota${quantity ? ` veličiny ${quantity}` : ''}, včetně jednotek?`;
  return { status, draftLabel, clarification };
}
