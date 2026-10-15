// Fetches streams from each configured provider in parallel.

const TIMEOUT_MS = Number(process.env.UPSTREAM_TIMEOUT_MS || 6000);

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

async function fetchOne(provider, type, id) {
  const t0 = Date.now();
  try {
    const streams = await fetchProvider(provider, type, id);
    console.log(`[${provider.name}] ${streams.length} streams in ${Date.now() - t0}ms`);
    return { provider, streams };
  } catch (e) {
    console.warn(`[${provider.name}] failed after ${Date.now() - t0}ms: ${e.message}`);
    return { provider, streams: [] };
  }
}

async function fetchAll(providers, type, id) {
  return Promise.all(providers.map(p => fetchOne(p, type, id)));
}

module.exports = { fetchAll, fetchOne, baseUrl };
