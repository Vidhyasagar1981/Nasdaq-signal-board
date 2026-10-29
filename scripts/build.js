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
const bt = E.backtest(prep, bench, { costBps: 10, start: START });
const d0 = bt.curve[0][0];
// Benchmarks over the same dates
const bIx = bench.dateIx, qStart = bench.c[bIx.get(bench.dates[bench.dates.indexOf(d0) - 1])];
const qCurve = bt.curve.map(([d]) => [d, bench.c[bIx.get(d)] / qStart]);
const eqCurve = bt.curve.map(([d]) => { let s = 0, k = 0; for (const t in prep) { const ix = prep[t].dateIx; const a = ix.get(bench.dates[bench.dates.indexOf(d0) - 1]), b = ix.get(d); if (a != null && b != null) { s += prep[t].c[b] / prep[t].c[a]; k++; } } return [d, s / k]; });
// Fix equal-weight: only names alive at start, rebalanced never (buy & hold)
const out = {
  asOf: snap.date, regime: { on: snap.regimeOn, ...snap.bench },
  params: E.P,
  names: UNIVERSE,
  rows: snap.rows.map(r => ({ ticker: r.ticker, close: r.close, score: r.score, signal: r.signal, why: r.why, stop: r.stop, target: r.target, posPct: r.posPct, trend: r.trend, trendBits: r.trendBits, m12: r.m12, m6: r.m6, excess: r.excess, rsi2: r.rsi2, vol: r.vol, sF: r.sF, sS: r.sS, mom: r.mom, rsx: r.rsx, timing: r.timing, volS: r.volS })),
  backtest: { start: d0, trades: bt.trades, winRate: bt.winRate, avgExposure: bt.avgExposure, held: bt.held,
    strat: E.stats(bt.curve), qqq: E.stats(qCurve), ew: E.stats(eqCurve),
    curve: bt.curve.filter((_, i) => i % 5 === 0 || i === bt.curve.length - 1).map((p, k) => [p[0], +p[1].toFixed(4), +qCurve[bt.curve.indexOf(p)][1].toFixed(4), +eqCurve[bt.curve.indexOf(p)][1].toFixed(4)]) },
  // Last ~320 bars of OHLC per ticker so the page can recompute signals and draw charts
  series: Object.fromEntries([...Object.entries(raw), ['QQQ', qqq]].map(([t, s]) => [t, s.slice(-320).map(b => [b.d, b.o, b.h, b.l, b.c])]))
};
fs.writeFileSync(process.argv[3], JSON.stringify(out));
console.log('asOf', out.asOf, 'regimeOn', out.regime.on);
for (const r of out.rows.sort((a, b) => b.score - a.score)) console.log(r.ticker.padEnd(5), r.score.toFixed(1).padStart(5), r.signal.padEnd(10), r.close.toFixed(2), 'stop', r.stop.toFixed(2), 'm12', (r.m12 * 100).toFixed(0) + '%', 'rsi2', r.rsi2.toFixed(0), r.why);
console.log('BT from', d0, 'trades', bt.trades, 'win', bt.winRate.toFixed(2), 'expo', bt.avgExposure.toFixed(2));
for (const k of ['strat', 'qqq', 'ew']) { const s = out.backtest[k]; console.log(k.padEnd(6), 'CAGR', (s.cagr * 100).toFixed(1), 'vol', (s.vol * 100).toFixed(1), 'Sharpe', s.sharpe.toFixed(2), 'MaxDD', (s.maxDD * 100).toFixed(1), 'total', (s.total * 100).toFixed(0)); }
