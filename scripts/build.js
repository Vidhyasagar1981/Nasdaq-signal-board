const fs = require('fs'), path = require('path');
const E = require('./engine.js');
const DIR = process.argv[2];
const UNIVERSE = { MSFT: 'Microsoft', NVDA: 'NVIDIA', GOOG: 'Alphabet', AMZN: 'Amazon', META: 'Meta Platforms', AVGO: 'Broadcom', TSLA: 'Tesla', AMD: 'AMD', MU: 'Micron', INTC: 'Intel', MRVL: 'Marvell', PLTR: 'Palantir' };

function load(t) {
  const rows = fs.readFileSync(path.join(DIR, t.toLowerCase() + '.csv'), 'utf8').trim().split('\n').slice(1);
  return rows.map(r => r.split(',')).filter(f => f[4]).map(f => ({ d: f[0], o: +f[1], h: +f[2], l: +f[3], c: +f[4] }));
}
const raw = {}; for (const t of Object.keys(UNIVERSE)) raw[t] = load(t);
const qqq = load('QQQ');
const prep = {}; for (const t in raw) prep[t] = E.prepare(raw[t]);
const bench = E.prepare(qqq);

const snap = E.snapshot(prep, bench);
const START = '2018-01-02';
const ls = E.backtest(prep, bench, { costBps: 10, start: START, sides: 'both' });
const lo = E.backtest(prep, bench, { costBps: 10, start: START, sides: 'long' });
const d0 = ls.curve[0][0], base = bench.dates[bench.dates.indexOf(d0) - 1];
const qStart = bench.c[bench.dateIx.get(base)];
const qCurve = ls.curve.map(([d]) => [d, bench.c[bench.dateIx.get(d)] / qStart]);
const ewCurve = ls.curve.map(([d]) => { let s = 0, k = 0; for (const t in prep) { const ix = prep[t].dateIx, a = ix.get(base), b = ix.get(d); if (a != null && b != null) { s += prep[t].c[b] / prep[t].c[a]; k++; } } return [d, s / k]; });
const loMap = new Map(lo.curve);
// Calendar-year returns: [year, long/short, long-only, QQQ]
function yearly(curves) {
  const ends = {}; ls.curve.forEach(([d], i) => { ends[d.slice(0, 4)] = i; });
  let prev = null; const outY = [];
  for (const y of Object.keys(ends)) {
    const i = ends[y];
    outY.push([y, ...curves.map(c => (prev == null ? c[i][1] / 1 : c[i][1] / c[prev][1]) - 1)]);
    prev = i;
  }
  return outY;
}
const loAligned = ls.curve.map(([d]) => [d, loMap.get(d)]);
const years = yearly([ls.curve, loAligned, qCurve]).map(r => [r[0], ...r.slice(1).map(v => +v.toFixed(4))]);
const pick = r => ({ ticker: r.ticker, close: r.close, signal: r.signal, why: r.why, side: r.side, longScore: r.longScore, shortScore: r.shortScore, bias: r.bias, stop: r.stop, target: r.target, posPct: r.posPct, m12: r.m12, excess: r.excess, rsi2: r.rsi2 });
const out = {
  asOf: snap.date, regime: { on: snap.regimeOn, ...snap.bench },
  params: E.P,
  names: UNIVERSE,
  rows: snap.rows.map(pick),
  backtest: {
    start: d0,
    ls: { stats: E.stats(ls.curve), trades: ls.trades, winRate: ls.winRate, tr: ls.tr, avgGross: ls.avgGross, avgNet: ls.avgNet, longPnl: ls.longPnl, shortPnl: ls.shortPnl },
    lo: { stats: E.stats(lo.curve), trades: lo.trades, winRate: lo.winRate, avgGross: lo.avgGross },
    qqq: E.stats(qCurve), ew: E.stats(ewCurve), years,
    // weekly points: [date, long/short, long-only, QQQ]
    curve: ls.curve.map((p, i) => [p[0], +p[1].toFixed(4), +loMap.get(p[0]).toFixed(4), +qCurve[i][1].toFixed(4)]).filter((_, i, a) => i % 5 === 0 || i === a.length - 1)
  },
  // Last ~320 bars of OHLC per ticker so the page can recompute signals and draw charts
  series: Object.fromEntries([...Object.entries(raw), ['QQQ', qqq]].map(([t, s]) => [t, s.slice(-320).map(b => [b.d, b.o, b.h, b.l, b.c])]))
};
fs.writeFileSync(process.argv[3], JSON.stringify(out));
console.log('asOf', out.asOf, 'regimeOn', out.regime.on);
for (const r of out.rows.sort((a, b) => b.bias - a.bias)) console.log(r.ticker.padEnd(5), ('bias ' + r.bias.toFixed(0)).padEnd(9), ('L' + r.longScore.toFixed(0) + '/S' + r.shortScore.toFixed(0)).padEnd(9), r.signal.padEnd(12), r.close.toFixed(2), 'stop', isNaN(r.stop) ? '-' : r.stop.toFixed(2), 'size', (r.posPct * 100).toFixed(0) + '%', '|', r.why);
const f = s => `CAGR ${(s.cagr * 100).toFixed(1)} vol ${(s.vol * 100).toFixed(1)} Sharpe ${s.sharpe.toFixed(2)} MaxDD ${(s.maxDD * 100).toFixed(1)} total ${(s.total * 100).toFixed(0)}`;
console.log('long/short ', f(out.backtest.ls.stats), '| trades L', ls.tr.long.n, 'win', (ls.tr.long.win / ls.tr.long.n).toFixed(2), 'S', ls.tr.short.n, 'win', (ls.tr.short.win / ls.tr.short.n).toFixed(2), '| gross', ls.avgGross.toFixed(2), 'net', ls.avgNet.toFixed(2), '| sum pnl L', ls.longPnl.toFixed(2), 'S', ls.shortPnl.toFixed(2));
console.log('long only  ', f(out.backtest.lo.stats));
console.log('QQQ        ', f(out.backtest.qqq));
console.log('EW12       ', f(out.backtest.ew));
