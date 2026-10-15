const test = require('node:test');
const assert = require('node:assert');
const { parseStream } = require('../src/parse');
const { pickTop } = require('../src/pick');

const RD = { name: 'Torrentio', debrid: 'RD' };
const RD2 = { name: 'Comet', debrid: 'RD' };
const TB = { name: 'MediaFusion', debrid: 'TB' };

const mk = (prov, res, seeds, hash, extra = '') =>
  parseStream({ name: `[${prov.debrid}+] ${prov.name}\n${res}`, title: `Movie.${res}.mkv\n👤 ${seeds} 💾 10 GB ${extra}`, infoHash: hash, url: 'x' }, prov);

test('picks 3x4K + 2x1080p by seeders', () => {
  const s = [
    mk(RD, '2160p', 500, 'a'.repeat(40)), mk(RD, '2160p', 400, 'b'.repeat(40)),
    mk(RD, '2160p', 300, 'c'.repeat(40)), mk(RD, '2160p', 10, 'd'.repeat(40)),
    mk(TB, '1080p', 900, 'e'.repeat(40)), mk(TB, '1080p', 800, 'f'.repeat(40)), mk(TB, '1080p', 1, '1'.repeat(40)),
  ];
  const p = pickTop(s);
  assert.deepStrictEqual(p.map(x => x.slot), ['4k', '4k', '4k', '1080p', '1080p']);
  assert.deepStrictEqual(p.map(x => x.seeders), [500, 400, 300, 900, 800]);
});

test('swaps in TB when everything popular is RD', () => {
  const s = [
    mk(RD, '2160p', 500, 'a'.repeat(40)), mk(RD, '2160p', 400, 'b'.repeat(40)), mk(RD, '2160p', 300, 'c'.repeat(40)),
    mk(RD, '1080p', 900, 'e'.repeat(40)), mk(RD, '1080p', 800, 'f'.repeat(40)),
    mk(TB, '1080p', 700, '9'.repeat(40)), mk(TB, '2160p', 20, '8'.repeat(40)),
  ];
  const p = pickTop(s);
  assert.ok(p.some(x => x.debrid === 'TB'));
  assert.ok(p.some(x => x.debrid === 'RD'));
  assert.strictEqual(p.length, 5);
  // cheapest swap: TB 1080p (700) replaces RD 1080p (800)
  assert.deepStrictEqual(p.filter(x => x.slot === '1080p').map(x => x.seeders), [900, 700]);
});

test('dedupes same release across providers and rewards agreement', () => {
  const h = 'a'.repeat(40);
  const s = [mk(RD, '2160p', 100, h), mk(RD2, '2160p', 120, h), mk(RD, '2160p', 110, 'b'.repeat(40)), mk(TB, '1080p', 5, 'c'.repeat(40))];
  const p = pickTop(s);
  const top = p[0];
  assert.strictEqual(top.release, 'h:' + h);
  assert.strictEqual(top.providers.size, 2);
  assert.strictEqual(top.seeders, 120);
  assert.strictEqual(p.filter(x => x.release === 'h:' + h).length, 1);
});

test('backfills when not enough 4K', () => {
  const s = [mk(RD, '2160p', 50, 'a'.repeat(40)), ...[1, 2, 3, 4, 5].map(i => mk(TB, '1080p', i * 10, String(i).repeat(40)))];
  const p = pickTop(s);
  assert.strictEqual(p.length, 5);
  assert.strictEqual(p.filter(x => x.slot === '4k').length, 1);
});

test('parses common title formats', () => {
  const c = parseStream({ name: 'Comet [TB⚡]', description: 'Dune.Part.Two.2024.UHD.BluRay.mkv\n🌱 42 · 💾 58.3 GB' }, RD);
  assert.strictEqual(c.resolution, '4k');
  assert.strictEqual(c.seeders, 42);
  assert.strictEqual(c.debrid, 'TB');
  assert.strictEqual(c.cached, true);
});
