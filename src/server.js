const fs = require('fs');
const path = require('path');
const { addonBuilder, serveHTTP } = require('stremio-addon-sdk');
const { fetchOne } = require('./upstream');
const { parseStream } = require('./parse');
const { pickTop, pickLite, pickBest } = require('./pick');

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
  if (!b) return null;
  const gb = b / 1024 ** 3;
  return gb >= 10 ? Math.round(gb) + ' GB' : gb.toFixed(1) + ' GB';
}

// Quality tags worth seeing at a glance, pulled from the upstream text.
const TAGS = [
  [/\b(DV|DoVi|Dolby[ .]?Vision)\b/i, 'DV'],
  [/\bHDR10\+/i, 'HDR10+'],
  [/\bHDR(10)?\b/i, 'HDR'],
  [/\bREMUX\b/i, 'Remux'],
  [/\bAtmos\b/i, 'Atmos'],
];

function qualityTags(text) {
  const out = [];
  for (const [re, tag] of TAGS) {
    if (re.test(text) && !(tag === 'HDR' && out.includes('HDR10+'))) out.push(tag);
  }
  return out;
}

// A short, readable release name: the filename if we have one, minus extension and dots.
function shortTitle(s) {
  const text = [s.behaviorHints && s.behaviorHints.filename, s.title, s.description].filter(Boolean).join('\n');
  const line = text.split('\n').map(l => l.trim()).find(l => /\.(mkv|mp4|avi|ts)$/i.test(l) || /\b(2160p|1080p)\b/i.test(l)) || text.split('\n')[0] || '';
  const clean = line.replace(/^[^\w]+/u, '').replace(/\.(mkv|mp4|avi|ts)$/i, '').replace(/[._]+/g, ' ').trim();
  return clean.length > 60 ? clean.slice(0, 57) + '…' : clean;
}

function decorate(p) {
  const s = p.stream;
  const text = [s.name, s.title, s.description, s.behaviorHints && s.behaviorHints.filename].filter(Boolean).join('\n');
  const label = p.slot === '4k' ? '4K' : p.slot === '1080p' ? '1080p' : p.slot === 'lite' ? '1080p Lite' : p.slot === 'best' ? '4K Best' : p.resolution;
  const lang = { multi: 'Multi', 'unknown-multi': 'Multi?', foreign: 'No ENG' }[p.language];
  const stats = [...qualityTags(text), lang, fmtSize(p.size), p.seeders != null ? `👤 ${p.seeders}` : p.cached ? '⚡ cached' : null].filter(Boolean).join(' · ');
  const { title, ...rest } = s;
  // Stremio's autoplay picks the next episode's stream with the same bingeGroup.
  // (Lite and Best each share one group, so autoplay keeps you on that kind of file all season.)
  const behaviorHints = { ...s.behaviorHints, bingeGroup: p.slot === 'lite' ? 'top5|lite' : p.slot === 'best' ? 'top5|best' : `top5|${p.debrid}|${p.signature || p.release || p.slot}` };
  return {
    ...rest,
    behaviorHints,
    name: `${label}\n${p.debrid}${p.cached ? ' ⚡' : ''}`,
    description: `${shortTitle(s)}\n${stats}`,
  };
}

function toParsed(results) {
  return results.flatMap(r =>
    r.streams
      .map(s => parseStream(s, r.provider))
      .filter(p => !r.provider.resolutions || r.provider.resolutions.includes(p.resolution)));
}

const inflight = new Map();
// series:season -> release signatures picked for the latest episode looked up.
const seasonPicks = new Map();

function seasonKey(type, id) {
  const m = type === 'series' && id.match(/^(.+):(\d+):\d+$/);
  return m ? `${m[1]}:${m[2]}` : null;
}

// Share one in-flight lookup per title, so a prefetch and a real click don't both hit the addons.
function lookup(type, id) {
  const key = `${type}:${id}`;
  if (!inflight.has(key)) inflight.set(key, doLookup(type, id).finally(() => inflight.delete(key)));
  return inflight.get(key);
}

async function doLookup(type, id) {
  const key = `${type}:${id}`;
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < CACHE_MS) return hit.value;

  // Start everything at once, but only wait on the backup if the debrid addons come up short.
  const main = Promise.all(providers.filter(p => !p.backup).map(p => fetchOne(p, type, id)));
  const backup = Promise.all(providers.filter(p => p.backup).map(p => fetchOne(p, type, id)));
  const season = seasonKey(type, id);
  const prefer = season && seasonPicks.get(season);
  const mainParsed = toParsed(await main);
  // The two special slots are chosen first so they really are the biggest / smallest;
  // the popular picks (2x 4K + 2x 1080p) come from what's left.
  const best = pickBest(mainParsed);
  const lite = pickLite(mainParsed, best ? [best] : []);
  const specialKeys = [best, lite].filter(Boolean).flatMap(p => [p.release, p.lookalike]).filter(Boolean);
  const rest = mainParsed.filter(p => ![p.release, p.lookalike].some(k => k && specialKeys.includes(k)));
  // If Best is already a Remux, keep the popular 4K slots for something different (when there's enough else).
  const isRemux = p => /\bREMUX\b/i.test([p.stream.name, p.stream.title, p.stream.description, p.stream.behaviorHints && p.stream.behaviorHints.filename].filter(Boolean).join(' '));
  const nonRemux4k = new Set(rest.filter(p => p.resolution === '4k' && !isRemux(p)).map(p => p.release || p.lookalike)).size;
  const pool = best && isRemux(best) && nonRemux4k >= 2 ? rest.filter(p => !(p.resolution === '4k' && isRemux(p))) : rest;
  const want = 4;
  const popular = pickTop(pool, { want4k: 2, want1080: 2, onlyCached, prefer: prefer && Date.now() - prefer.at < 6 * 3600e3 ? prefer.sigs : null });
  if (season && popular.length) seasonPicks.set(season, { at: Date.now(), sigs: new Set(popular.map(p => p.signature).filter(Boolean)) });
  const missing = want - popular.length;
  if (missing > 0) popular.push(...pickTop(toParsed(await backup), { want4k: 0, want1080: missing }));
  // Order: best-quality 4K, popular 4K, popular 1080p, then the bad-wifi Lite pick.
  const picks = [best, ...popular, lite].filter(Boolean);

  const value = { streams: picks.map(p => decorate(p)), cacheMaxAge: 1800 };
  // Don't cache backup-only answers, so a debrid hiccup doesn't stick around.
  if (picks.length && missing <= 0) cache.set(key, { at: Date.now(), value });
  return value;
}

builder.defineStreamHandler(async ({ type, id }) => {
  const value = await lookup(type, id);
  // Watching a series? Warm up the next episode so it opens instantly.
  const m = type === 'series' && id.match(/^(.+):(\d+):(\d+)$/);
  if (m) lookup(type, `${m[1]}:${m[2]}:${Number(m[3]) + 1}`).catch(() => {});
  return value;
});

serveHTTP(builder.getInterface(), { port: Number(process.env.PORT || 7000) });
