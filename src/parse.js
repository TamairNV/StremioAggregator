// Pulls resolution, seeders, size, debrid service and cache status out of an upstream stream object.

function textOf(s) {
  return [s.name, s.title, s.description, s.behaviorHints && s.behaviorHints.filename]
    .filter(Boolean)
    .join('\n');
}

function parseResolution(text) {
  if (/\b(2160p|4k|uhd)\b/i.test(text)) return '4k';
  if (/\b1080p\b/i.test(text)) return '1080p';
  if (/\b720p\b/i.test(text)) return '720p';
  return 'other';
}

function parseSeeders(text) {
  const patterns = [
    /👤\s*(\d+)/u,
    /🌱\s*(\d+)/u,
    /\bseed(?:er)?s?\s*[:=]?\s*(\d+)/i,
    /\bS\s*:\s*(\d+)/,
    /\bpeers?\s*[:=]?\s*(\d+)/i,
  ];
  for (const re of patterns) {
    const m = text.match(re);
    if (m) return parseInt(m[1], 10);
  }
  return null;
}

function parseSizeBytes(s, text) {
  if (s.behaviorHints && s.behaviorHints.videoSize) return Number(s.behaviorHints.videoSize);
  // Prefer the addon's 💾 size over sizes baked into names like "WEBRip.1600MB".
  const m = text.match(/💾\s*(\d+(?:\.\d+)?)\s*(TB|GB|MB)\b/iu) || text.match(/(?<![\w.])(\d+(?:\.\d+)?)\s*(TB|GB|MB)\b/i);
  if (!m) return null;
  const mult = { TB: 1024 ** 4, GB: 1024 ** 3, MB: 1024 ** 2 }[m[2].toUpperCase()];
  return Math.round(parseFloat(m[1]) * mult);
}

function parseDebrid(s, fallback) {
  if (fallback === 'P2P') return 'P2P';
  const label = [s.name, s.title, s.description].filter(Boolean).join(' ');
  if (/\bTB\b|torbox/i.test(label)) return 'TB';
  if (/\bRD\b|real-?debrid/i.test(label)) return 'RD';
  return fallback;
}

function parseCached(text) {
  if (/⏳|⬇|\bdownload\b|uncached/iu.test(text)) return false;
  if (/\+\]|⚡|\bcached\b|\b(RD|TB)\+/iu.test(text)) return true;
  return null;
}

function releaseKey(s, text) {
  const hash = s.infoHash || ((s.url || '').match(/\b[a-f0-9]{40}\b/i) || [])[0];
  if (hash) return 'h:' + hash.toLowerCase();
  const fname = (s.behaviorHints && s.behaviorHints.filename) || text.split('\n').find(l => /\.(mkv|mp4|avi)\b/i.test(l)) || '';
  if (fname) return 'f:' + fname.toLowerCase().replace(/[^a-z0-9]+/g, '');
  return null;
}

// Same file uploaded as different torrents: match on the release name + rough size instead of hash.
function lookalikeKey(s, text, size) {
  const lines = [s.behaviorHints && s.behaviorHints.filename, ...text.split('\n')].filter(Boolean);
  const line = lines.find(l => /\.(mkv|mp4|avi|ts)\s*$/i.test(l)) ||
    lines.filter(l => /\b(2160p|1080p)\b/i.test(l)).sort((a, b) => b.length - a.length)[0];
  if (!line || line.length < 15) return null;
  const name = line.toLowerCase().replace(/\.(mkv|mp4|avi|ts)\s*$/, '').replace(/[^a-z0-9]+/g, '');
  return name + '|' + (size ? Math.round(size / 1024 ** 3) : '?');
}

// Audio language: 'en' (English only, or nothing says otherwise), 'multi' (English plus others),
// 'unknown-multi' (several tracks, English not mentioned) or 'foreign' (no English at all).
const FLAG = /[\u{1F1E6}-\u{1F1FF}]{2}/gu;
const EN_FLAGS = new Set(['🇬🇧', '🇺🇸']);
const ENGLISH = /\b(eng|english|original)\b/i;
const FOREIGN = /\b(multi|vff|vfi|vfq|vf2?|truefrench|french|ita|ger|german|spa|spanish|latino|castellano|hindi|tamil|telugu|rus|ukr|lektor|dubbed|dub)\b|[\u0400-\u04FF]/iu;

function parseLanguage(text) {
  const flags = text.match(FLAG) || [];
  const enFlag = flags.some(f => EN_FLAGS.has(f));
  const otherFlag = flags.some(f => !EN_FLAGS.has(f));
  const multi = /\bmulti\b|🌎/iu.test(text);
  const hasEn = enFlag || ENGLISH.test(text);
  if (!otherFlag && !multi && !FOREIGN.test(text)) return 'en';
  if (hasEn) return 'multi';
  return multi ? 'unknown-multi' : 'foreign';
}

// Who made the release and from what source, so episode N+1 can match episode N.
function releaseSignature(s, text, resolution, release) {
  const fname = (s.behaviorHints && s.behaviorHints.filename) || (text.match(/[^\n\/]+\.(?:mkv|mp4|avi|ts)\b/i) || [])[0] || '';
  const group = ((text.match(/🏷️\s*([^\s|]+)/u) || [])[1]) ||
    ((fname.replace(/\.(mkv|mp4|avi|ts)$/i, '').match(/-([A-Za-z0-9]{2,})(?:\[[^\]]*\])?$/) || [])[1]);
  const src = (text.match(/\b(remux|blu-?ray|web-?dl|web-?rip|hdtv)\b/i) || [])[1];
  if (group) return [resolution, group, src || ''].join('|').toLowerCase().replace(/-/g, '');
  // Season packs share one torrent across every episode.
  return release && release.startsWith('h:') ? release : null;
}

function parseStream(s, provider) {
  const text = textOf(s);
  const size = parseSizeBytes(s, text);
  const resolution = parseResolution(text);
  const release = releaseKey(s, text);
  return {
    stream: s,
    provider: provider.name,
    resolution,
    seeders: parseSeeders(text),
    size,
    lookalike: lookalikeKey(s, text, size),
    debrid: parseDebrid(s, provider.debrid),
    cached: parseCached(text),
    release,
    language: parseLanguage(text),
    signature: releaseSignature(s, text, resolution, release),
  };
}

module.exports = { parseStream, parseResolution, parseSeeders, parseSizeBytes, parseDebrid, parseCached, parseLanguage };
