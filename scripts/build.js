const fs = require('fs'), path = require('path');
const E = require('./engine.js');
const DIR = process.argv[2];
// Stocks traded long only
const UNIVERSE = { MSFT: 'Microsoft', NVDA: 'NVIDIA', GOOG: 'Alphabet', AMZN: 'Amazon', META: 'Meta Platforms', AVGO: 'Broadcom', TSLA: 'Tesla', AMD: 'AMD', MU: 'Micron', INTC: 'Intel', MRVL: 'Marvell', PLTR: 'Palantir' };
// Indexes traded short only, as a hedge. VTI (US total market) stands in for the S&P 500, which the dataset does not carry.
const INDEXES = { QQQ: 'Nasdaq-100 (QQQ)', VTI: 'S&P 500 proxy (VTI)' };
const START = '2020-01-02', CAPITAL = 100000;

function load(t) {
  const rows = fs.readFileSync(path.join(DIR, t.toLowerCase() + '.csv'), 'utf8').trim().split('\n').slice(1);
  return rows.map(r => r.split(',')).filter(f => f[4]).map(f => ({ d: f[0], o: +f[1], h: +f[2], l: +f[3], c: +f[4] }));
}
const raw = {}; for (const t of Object.keys(UNIVERSE)) raw[t] = load(t);
const iraw = {}; for (const t of Object.keys(INDEXES)) iraw[t] = load(t);
const prep = {}; for (const t in raw) prep[t] = E.prepare(raw[t]);
const iprep = {}; for (const t in iraw) iprep[t] = E.prepare(iraw[t]);
const bench = iprep.QQQ;

const snap = E.snapshot(prep, bench);
const strat = E.backtest(prep, bench, { start: START, hedges: iprep });
const lo = E.backtest(prep, bench, { start: START });
const d0 = strat.curve[0][0], base = bench.dates[bench.dates.indexOf(d0) - 1];
const bh = I => strat.curve.map(([d]) => [d, I.c[I.dateIx.get(d)] / I.c[I.dateIx.get(base)]]);
const loMap = new Map(lo.curve);
const C = { strat: strat.curve, lo: strat.curve.map(([d]) => [d, loMap.get(d)]), qqq: bh(iprep.QQQ), vti: bh(iprep.VTI) };
const keys = Object.keys(C);

// Calendar-year returns: [year, strat, lo, qqq, vti]
const ends = {}; strat.curve.forEach(([d], i) => { ends[d.slice(0, 4)] = i; });
let prev = null; const years = [];
for (const y of Object.keys(ends)) { const i = ends[y]; years.push([y, ...keys.map(k => +((prev == null ? C[k][i][1] : C[k][i][1] / C[k][prev][1]) - 1).toFixed(4))]); prev = i; }

const out = {
  asOf: snap.date, regime: { on: snap.regimeOn, ...snap.bench },
  params: E.P, names: UNIVERSE, indexes: INDEXES,
  backtest: {
    start: base, end: strat.curve[strat.curve.length - 1][0], capital: CAPITAL,
    stats: Object.fromEntries(keys.map(k => [k, E.stats(C[k])])),
    final: Object.fromEntries(keys.map(k => [k, Math.round(C[k][C[k].length - 1][1] * CAPITAL)])),
    stocks: { trades: strat.trades, winRate: strat.winRate, avgExposure: strat.avgExposure },
    hedge: { share: strat.hedgeShare, trades: strat.hTrades, pnl: strat.hedgePnl },
    years,
    // weekly points: [date, strat, long-only, QQQ, VTI] as growth of $1
    curve: strat.curve.map((p, i) => [p[0], ...keys.map(k => +C[k][i][1].toFixed(4))]).filter((_, i, a) => i % 5 === 0 || i === a.length - 1)
  },
  // Last ~320 bars of OHLC per ticker so the page can recompute signals and draw charts
  series: Object.fromEntries([...Object.entries(raw), ...Object.entries(iraw)].map(([t, s]) => [t, s.slice(-320).map(b => [b.d, b.o, b.h, b.l, b.c])]))
};
fs.writeFileSync(process.argv[3], JSON.stringify(out));

console.log('asOf', out.asOf, 'regimeOn', out.regime.on);
for (const r of snap.rows.sort((a, b) => b.longScore - a.longScore)) console.log(r.ticker.padEnd(5), r.longScore.toFixed(0).padStart(3), r.signal.padEnd(10), r.close.toFixed(2), 'stop', r.stop.toFixed(2), '|', r.why);
for (const t in iprep) { const I = iprep[t], i = I.c.length - 1, x = E.components(I, i, 0.5, null, null), d = E.decideIndex(x, false); console.log(t.padEnd(5), d.signal.padEnd(12), x.close.toFixed(2), '200d', x.sS.toFixed(2), '|', d.why); }
const m = v => '$' + v.toLocaleString('en-US');
console.log(`$${CAPITAL.toLocaleString('en-US')} from ${base} to ${out.backtest.end}:`);
for (const k of keys) { const s = out.backtest.stats[k]; console.log(' ', k.padEnd(6), m(out.backtest.final[k]).padStart(10), `CAGR ${(s.cagr * 100).toFixed(1)}% Sharpe ${s.sharpe.toFixed(2)} MaxDD ${(s.maxDD * 100).toFixed(1)}%`); }
