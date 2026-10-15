// Fetches streams from each configured provider in parallel.

const TIMEOUT_MS = Number(process.env.UPSTREAM_TIMEOUT_MS || 10000);

function baseUrl(url) {
  return url.replace(/\/manifest\.json\/?$/, '').replace(/\/$/, '');
}

async function fetchProvider(provider, type, id) {
  const url = `${baseUrl(provider.url)}/stream/${type}/${id}.json`;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(url, { signal: ctrl.signal, headers: { 'user-agent': 'stremio-top5/1.0' } });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const body = await res.json();
    return Array.isArray(body.streams) ? body.streams : [];
  } finally {
    clearTimeout(timer);
  }
}

async function fetchAll(providers, type, id) {
  const results = await Promise.allSettled(providers.map(p => fetchProvider(p, type, id)));
  return results.map((r, i) => {
    if (r.status === 'rejected') console.warn(`[${providers[i].name}] failed: ${r.reason && r.reason.message}`);
    return { provider: providers[i], streams: r.status === 'fulfilled' ? r.value : [] };
  });
}

module.exports = { fetchAll, baseUrl };
