// Merges duplicates, scores by popularity, and picks 3x 4K + 2x 1080p covering both RD and TB.

const SERVICES = ['RD', 'TB'];

// Same release + same debrid service from several providers collapses into one candidate.
function merge(parsed) {
  const byKey = new Map();
  let anon = 0;
  for (const p of parsed) {
    const key = (p.release || 'anon:' + anon++) + '|' + p.debrid;
    const cur = byKey.get(key);
    if (!cur) {
      byKey.set(key, { ...p, providers: new Set([p.provider]) });
      continue;
    }
    cur.providers.add(p.provider);
    if ((p.seeders ?? -1) > (cur.seeders ?? -1)) {
      cur.seeders = p.seeders;
      cur.stream = p.stream;
    }
    if (cur.cached !== true && p.cached === true) cur.cached = true;
    cur.size = cur.size || p.size;
  }
  return [...byKey.values()];
}

// Popularity: seeders (log scaled so 5000 vs 3000 doesn't dominate), plus a bump for
// every extra provider that listed the same release, plus a bump for being cached.
function score(c) {
  const seeds = c.seeders ?? 0;
  return Math.log2(1 + seeds) * 10 + (c.providers.size - 1) * 15 + (c.cached === true ? 10 : 0);
}

function byScore(a, b) {
  return b.score - a.score || (b.size || 0) - (a.size || 0);
}

function pickTop(parsed, { want4k = 3, want1080 = 2, onlyCached = false } = {}) {
  let cands = merge(parsed).map(c => ({ ...c, score: score(c) }));
  if (onlyCached) cands = cands.filter(c => c.cached !== false);
  cands.sort(byScore);

  const buckets = {
    '4k': cands.filter(c => c.resolution === '4k'),
    '1080p': cands.filter(c => c.resolution === '1080p'),
    rest: cands.filter(c => c.resolution !== '4k' && c.resolution !== '1080p'),
  };
  const picks = [];
  const taken = new Set();
  const usedRelease = new Set();
  // Prefer different releases; only reuse a release (on the other debrid) if nothing else is left.
  const fill = (list, n, slot) => {
    let got = 0;
    for (const strict of [true, false]) {
      for (const c of list) {
        if (got >= n) return got;
        if (taken.has(c) || (strict && c.release && usedRelease.has(c.release))) continue;
        taken.add(c);
        if (c.release) usedRelease.add(c.release);
        picks.push({ ...c, slot });
        got++;
      }
    }
    return got;
  };
  fill(buckets['4k'], want4k, '4k');
  fill(buckets['1080p'], want1080, '1080p');
  // Short on one resolution? Backfill from the other, then from anything else.
  const total = want4k + want1080;
  if (picks.length < total) fill(buckets['1080p'], total - picks.length, '1080p');
  if (picks.length < total) fill(buckets['4k'], total - picks.length, '4k');
  if (picks.length < total) fill(buckets.rest, total - picks.length, 'other');

  ensureCoverage(picks, buckets, taken);
  return picks.sort((a, b) => slotOrder(a) - slotOrder(b) || byScore(a, b));
}

function slotOrder(p) {
  return { '4k': 0, '1080p': 1, other: 2 }[p.slot];
}

// If every pick is on one debrid, swap in the best candidate from the missing one,
// choosing the swap that loses the least score and keeps the resolution slot intact.
function ensureCoverage(picks, buckets, taken) {
  for (const svc of SERVICES) {
    if (picks.some(p => p.debrid === svc)) continue;
    let best = null;
    for (let i = 0; i < picks.length; i++) {
      const out = picks[i];
      const pool = out.slot === 'other' ? buckets.rest : buckets[out.slot];
      const inn = pool.find(c => c.debrid === svc && !taken.has(c));
      if (!inn) continue;
      const loss = out.score - inn.score;
      if (!best || loss < best.loss) best = { i, inn, loss };
    }
    if (best) {
      taken.add(best.inn);
      picks[best.i] = { ...best.inn, slot: picks[best.i].slot };
    }
  }
}

module.exports = { pickTop, merge, score };
