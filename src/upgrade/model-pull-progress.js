// Presentation of Ollama's NDJSON stream. A layer reaching 100% is not a
// completed pull: only the provider's success receipt settles the operation.
export function createModelPullProgress(model, { now = Date.now } = {}) {
  const layers = new Map();
  const labels = {
    'pulling manifest': 'Stahuji manifest',
    'verifying sha256 digest': 'Ověřuji integritu stažených dat',
    'writing manifest': 'Zapisuji model',
    'removing any unused layers': 'Dokončuji stahování',
    success: 'Staženo',
  };
  return data => {
    const time = now();
    const transfer = Number.isSafeInteger(data.total) && data.total > 0 && (data.status === 'downloading'
      || /^pulling\s+(?!manifest\b)/u.test(data.status || ''));
    if (transfer) {
      const key = data.digest || data.status;
      const completed = Math.min(data.total, Math.max(0, Number(data.completed) || 0));
      const previous = layers.get(key);
      const sample = previous && completed >= previous.completed ? previous : { samples: [] };
      const samples = [...sample.samples, { time, completed }].filter(s => time - s.time <= 15_000);
      // Do not count bytes already on disk after a resumed pull as network speed.
      const first = samples[0];
      const seconds = (time - first.time) / 1000;
      const bytesPerSecond = seconds >= 1 ? (completed - first.completed) / seconds : null;
      layers.set(key, { total: data.total, completed, samples });
      const values = [...layers.values()];
      const totalBytes = values.reduce((sum, layer) => sum + layer.total, 0);
      const completedBytes = values.reduce((sum, layer) => sum + layer.completed, 0);
      return { status: 'downloading', text: 'Stahuji vrstvy modelu',
        percent: Math.min(100, Math.floor(100 * completedBytes / totalBytes)),
        completedBytes, totalBytes, bytesPerSecond,
        etaSeconds: bytesPerSecond > 0 ? Math.ceil((totalBytes - completedBytes) / bytesPerSecond) : null,
        layerCount: layers.size, totalScope: 'known-layers', model,
      };
    }
    return { model, status: data.status === 'success' ? 'verifying' : data.status || 'waiting',
      text: labels[data.status] || 'Čekám na zprávu od Ollamy',
      percent: null, bytesPerSecond: null, etaSeconds: null };
  };
}
