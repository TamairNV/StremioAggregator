const fs = require('fs');
const path = require('path');
const { addonBuilder, serveHTTP } = require('stremio-addon-sdk');
const { fetchAll } = require('./upstream');
const { parseStream } = require('./parse');
const { pickTop } = require('./pick');

function loadProviders() {
  if (process.env.PROVIDERS) return JSON.parse(process.env.PROVIDERS);
  const file = process.env.PROVIDERS_FILE || path.join(__dirname, '..', 'providers.json');
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

const providers = loadProviders();
const onlyCached = process.env.ONLY_CACHED === 'true';
const CACHE_MS = Number(process.env.CACHE_MINUTES || 30) * 60 * 1000;
const cache = new Map();

const builder = new addonBuilder({
  id: 'community.top5.rdtb',
  version: '1.0.0',
  name: 'Top 5 (RD + TB)',
  description: `Best 3 4K + best 2 1080p from ${providers.map(p => p.name).join(', ')}`,
  resources: ['stream'],
  types: ['movie', 'series'],
  idPrefixes: ['tt', 'kitsu'],
  catalogs: [],
});

function fmtSize(b) {
  return b ? (b / 1024 ** 3).toFixed(1) + ' GB' : '?';
}

function decorate(p, rank) {
  const s = p.stream;
  const label = p.slot === '4k' ? '4K' : p.slot === '1080p' ? '1080p' : p.resolution;
  const stats = `⭐ #${rank} · 👤 ${p.seeders ?? '?'} · 💾 ${fmtSize(p.size)} · ${p.debrid}${p.cached ? '⚡' : ''} · via ${[...p.providers].join('+')}`;
  return {
    ...s,
    name: `Top5 ${label}\n${p.debrid}${p.cached ? '+' : ''}`,
    description: `${stats}\n${s.description || s.title || ''}`,
    title: undefined,
  };
}

builder.defineStreamHandler(async ({ type, id }) => {
  const key = `${type}:${id}`;
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < CACHE_MS) return hit.value;

  const results = await fetchAll(providers, type, id);
  const parsed = results.flatMap(r =>
    r.streams
      .map(s => parseStream(s, r.provider))
      .filter(p => !r.provider.resolutions || r.provider.resolutions.includes(p.resolution))
      .map(p => ({ ...p, backup: !!r.provider.backup })));
  const picks = pickTop(parsed.filter(p => !p.backup), { onlyCached });
  // Backup providers (e.g. plain P2P Torrentio) only fill slots the debrid addons couldn't.
  const missing = 5 - picks.length;
  if (missing > 0) picks.push(...pickTop(parsed.filter(p => p.backup), { want4k: 0, want1080: missing }));
  const value = { streams: picks.map((p, i) => decorate(p, i + 1)), cacheMaxAge: 1800 };
  // Don't cache backup-only answers, so a debrid hiccup doesn't stick around.
  if (picks.length && missing <= 0) cache.set(key, { at: Date.now(), value });
  return value;
});

serveHTTP(builder.getInterface(), { port: Number(process.env.PORT || 7000) });
