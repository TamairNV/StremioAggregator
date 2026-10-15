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
  const m = text.match(/([\d.]+)\s*(TB|GB|MB)\b/i);
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

function parseStream(s, provider) {
  const text = textOf(s);
  return {
    stream: s,
    provider: provider.name,
    resolution: parseResolution(text),
    seeders: parseSeeders(text),
    size: parseSizeBytes(s, text),
    debrid: parseDebrid(s, provider.debrid),
    cached: parseCached(text),
    release: releaseKey(s, text),
  };
}

module.exports = { parseStream, parseResolution, parseSeeders, parseSizeBytes, parseDebrid, parseCached };
