const test = require('node:test');
const assert = require('node:assert');
const { parseStream } = require('../src/parse');
const { pickTop } = require('../src/pick');

const RD = { name: 'Torrentio', debrid: 'RD' };
const RD2 = { name: 'Comet', debrid: 'RD' };
const TB = { name: 'MediaFusion', debrid: 'TB' };

const mk = (prov, res, seeds, hash, extra = '') =>
  parseStream({ name: `[${prov.debrid}+] ${prov.name}\n${res}`, title: `Movie.${hash.slice(0, 4)}.${res}.mkv\n👤 ${seeds} 💾 10 GB ${extra}`, infoHash: hash, url: 'x' }, prov);

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

test('prefers TB when RD lost a release (uncached on RD)', () => {
  const h = 'a'.repeat(40);
  const rdGone = parseStream({ name: '[RD download] Torrentio\n2160p', title: 'Show.2160p.mkv\n👤 900 💾 10 GB', infoHash: h }, RD);
  const tbOk = parseStream({ name: '[TB+] Torrentio\n2160p', title: 'Show.2160p.mkv\n👤 900 💾 10 GB', infoHash: h }, TB);
  const p = pickTop([rdGone, tbOk, mk(RD, '2160p', 20, 'b'.repeat(40))]);
  assert.strictEqual(p[0].debrid, 'TB');
  assert.ok(!p.some(x => x.release === 'h:' + h && x.debrid === 'RD'));
});

test('treats Comet ⬇️ as uncached', () => {
  const c = parseStream({ name: '[TB⬇️] Comet 2160p', description: 'X.2160p.mkv' }, TB);
  assert.strictEqual(c.cached, false);
});

test('skips the same file uploaded as a different torrent', () => {
  const t = (seeds, hash) => parseStream({ name: '[TB+] Comet\n2160p', description: `Dune.Part.Two.2024.2160p.WEB-DL.DV.mkv\n👤 ${seeds} 💾 29 GB`, infoHash: hash }, TB);
  const p = pickTop([t(503, 'a'.repeat(40)), t(452, 'b'.repeat(40)), mk(RD, '2160p', 100, 'c'.repeat(40)), mk(RD, '2160p', 90, 'd'.repeat(40)), mk(RD, '1080p', 5, 'e'.repeat(40)), mk(RD, '1080p', 4, 'f'.repeat(40))]);
  assert.deepStrictEqual(p.filter(x => x.slot === '4k').map(x => x.seeders), [503, 100, 90]);
});

test('coverage swap avoids repeating a release on the other debrid', () => {
  const y = (prov, seeds, hash) => parseStream({ name: `[${prov.debrid}+] X\n1080p`, title: `Dune.Part.Two.2024.1080p.WEBRip.x264-YTS.mkv\n👤 ${seeds} 💾 2.8 GB`, infoHash: hash }, prov);
  const s = [
    mk(TB, '2160p', 500, 'a'.repeat(40)), mk(TB, '2160p', 400, 'b'.repeat(40)), mk(TB, '2160p', 300, 'c'.repeat(40)),
    y(TB, 1090, 'd'.repeat(40)), mk(TB, '1080p', 800, 'e'.repeat(40)),
    y(RD, 1046, 'd'.repeat(40)), mk(RD, '1080p', 600, 'f'.repeat(40)),
  ];
  const p = pickTop(s);
  assert.ok(p.some(x => x.debrid === 'RD'));
  assert.strictEqual(p.filter(x => x.lookalike === p[3].lookalike).length, 1);
});

test('reads audio language from flags and release names', () => {
  const { parseLanguage } = require('../src/parse');
  assert.strictEqual(parseLanguage('Dune.Part.Two.2024.2160p.WEB-DL.mkv'), 'en');
  assert.strictEqual(parseLanguage('GoT.S01E01.MULTi.VFI.2160p.mkv\n🌎/🇫🇷'), 'unknown-multi');
  assert.strictEqual(parseLanguage('Show [ger eng].mkv\n🇬🇧 / 🇩🇪'), 'multi');
  assert.strictEqual(parseLanguage('Show.2160p.mkv\n🇮🇩'), 'foreign');
  assert.strictEqual(parseLanguage('Игра престолов.S01E01.WEB-DL.2160p.mkv'), 'foreign');
});

test('ranks English audio above a more popular foreign release', () => {
  const en = parseStream({ name: '[TB+] X\n2160p', title: 'Movie.2160p.WEB-DL-FLUX.mkv\n👤 200 💾 20 GB', infoHash: 'a'.repeat(40) }, TB);
  const fr = parseStream({ name: '[TB+] X\n2160p', title: 'Movie.2160p.MULTi.VFF.mkv\n👤 800 💾 20 GB\n🇫🇷', infoHash: 'b'.repeat(40) }, TB);
  assert.strictEqual(pickTop([fr, en])[0].release, 'h:' + 'a'.repeat(40));
});

test('sticks to the previous episode release group', () => {
  const ep = (group, seeds, hash) => parseStream({ name: '[TB+] X\n1080p', title: `Show.S01E02.1080p.WEB-DL.DDP5.1-${group}.mkv\n👤 ${seeds} 💾 3 GB`, infoHash: hash }, TB);
  const a = ep('NTb', 100, 'a'.repeat(40)), b = ep('FLUX', 140, 'b'.repeat(40));
  assert.strictEqual(pickTop([a, b])[0].signature, b.signature);
  assert.strictEqual(pickTop([a, b], { prefer: new Set([a.signature]) })[0].signature, a.signature);
});

test('reads size from 💾, not from a size in the release name', () => {
  const c = parseStream({ name: '[TB+] X\n1080p', title: 'Dune.Part.Two.2024.1080p.WEBRip.1600MB.DD5.1.x264-GalaxyRG\n👤 299 💾 1.6 GB' }, TB);
  assert.strictEqual(Math.round(c.size / 1024 ** 2), 1638);
});

test('lite pick: smallest cached 1080p with a few seeders, not already listed', () => {
  const { pickLite } = require('../src/pick');
  const one = (seeds, gb, hash, extra = '') => parseStream({ name: `[TB+] X\n1080p`, title: `Show.${hash.slice(0, 4)}.1080p.mkv\n👤 ${seeds} 💾 ${gb} GB ${extra}`, infoHash: hash }, TB);
  const s = [one(900, 8, 'a'.repeat(40)), one(2, 0.9, 'b'.repeat(40)), one(40, 1.4, 'c'.repeat(40)), one(30, 0.1, 'd'.repeat(40)), one(50, 1.1, 'e'.repeat(40))];
  const picks = pickTop(s);
  const lite = pickLite(s, picks.filter(p => p.seeders === 50));
  assert.strictEqual(lite.seeders, 40); // 0.9GB has too few seeders, 0.1GB is junk, 1.1GB is already listed
  assert.strictEqual(lite.slot, 'lite');
});

test('lite pick skips AV1', () => {
  const { pickLite } = require('../src/pick');
  const one = (gb, hash, codec) => parseStream({ name: `[RD+] X\n1080p`, title: `Film.${hash.slice(0, 4)}.1080p.${codec}.mkv\n👤 20 💾 ${gb} GB`, infoHash: hash }, RD);
  const lite = pickLite([one(0.6, 'a'.repeat(40), 'AV1'), one(1.2, 'b'.repeat(40), 'x264')]);
  assert.strictEqual(lite.size, Math.round(1.2 * 1024 ** 3));
});

test('best pick: biggest English cached 4K, Remux wins, junk and foreign skipped', () => {
  const { pickBest } = require('../src/pick');
  const one = (gb, hash, tags, seeds = 50, extra = '') => parseStream({ name: `[RD+] X\n2160p`, title: `Film.${hash.slice(0, 4)}.2160p.${tags}.mkv\n👤 ${seeds} 💾 ${gb} GB ${extra}`, infoHash: hash }, RD);
  const s = [
    one(70, 'a'.repeat(40), 'WEB-DL', 1),           // too few seeders
    one(60, 'b'.repeat(40), 'REMUX.DV.Atmos'),
    one(65, 'c'.repeat(40), 'WEB-DL'),               // bigger, but not a Remux
    one(40, 'd'.repeat(40), 'WEB-DL'),
  ];
  assert.strictEqual(pickBest(s).size, Math.round(60 * 1024 ** 3));
  assert.strictEqual(pickBest(s).slot, 'best');
});
