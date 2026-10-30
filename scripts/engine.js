/* Nasdaq Signal Engine — shared by the build script (Node) and the web page.
   Input series: arrays of {d (YYYY-MM-DD), o, h, l, c}, oldest first. */
(function (root) {
  const P = {
    smaFast: 50, smaSlow: 200, momLong: 252, momSkip: 21, momMid: 126, rs: 63,
    rsiShort: 2, atr: 22, chandMult: 3, volWin: 20,
    w: { trend: 0.30, mom: 0.30, rs: 0.15, timing: 0.15, vol: 0.10 },
    entryScore: 65, exitScore: 35, riskPerTrade: 0.01, maxPos: 0.20,
    borrowBps: 50, // annual cost of borrowing an index ETF to short
    hedgeW: 0.25    // capital put into each index short when it fires
  };

  const closes = s => s.map(b => b.c);
  function sma(a, n, i) { if (i < n - 1) return NaN; let t = 0; for (let k = i - n + 1; k <= i; k++) t += a[k]; return t / n; }
  function ret(a, i, back, skip = 0) { const j = i - back, e = i - skip; return j < 0 ? NaN : a[e] / a[j] - 1; }
  function rsi(a, n, i) {
    if (i < n * 10) return NaN; // Wilder smoothing warm-up
    let g = 0, l = 0;
    for (let k = 1; k <= n; k++) { const d = a[k] - a[k - 1]; if (d > 0) g += d; else l -= d; }
    g /= n; l /= n;
    for (let k = n + 1; k <= i; k++) { const d = a[k] - a[k - 1]; g = (g * (n - 1) + Math.max(d, 0)) / n; l = (l * (n - 1) + Math.max(-d, 0)) / n; }
    return l === 0 ? 100 : 100 - 100 / (1 + g / l);
  }
  // Rolling RSI for whole series (fast path)
  function rsiSeries(a, n) {
    const out = new Array(a.length).fill(NaN); let g = 0, l = 0;
    for (let k = 1; k < a.length; k++) {
      const d = a[k] - a[k - 1], up = Math.max(d, 0), dn = Math.max(-d, 0);
      if (k <= n) { g += up / n; l += dn / n; } else { g = (g * (n - 1) + up) / n; l = (l * (n - 1) + dn) / n; }
      if (k >= n * 10) out[k] = l === 0 ? 100 : 100 - 100 / (1 + g / l);
    }
    return out;
  }
  function atrSeries(s, n) {
    const out = new Array(s.length).fill(NaN); let a = 0;
    for (let i = 1; i < s.length; i++) {
      const tr = Math.max(s[i].h - s[i].l, Math.abs(s[i].h - s[i - 1].c), Math.abs(s[i].l - s[i - 1].c));
      if (i <= n) { a += tr / n; if (i === n) out[i] = a; } else { a = (a * (n - 1) + tr) / n; out[i] = a; }
    }
    return out;
  }
  function stdev(x) { const m = x.reduce((p, v) => p + v, 0) / x.length; return Math.sqrt(x.reduce((p, v) => p + (v - m) ** 2, 0) / (x.length - 1)); }
  function realVol(a, n, i) { if (i < n) return NaN; const r = []; for (let k = i - n + 1; k <= i; k++) r.push(Math.log(a[k] / a[k - 1])); return stdev(r) * Math.sqrt(252); }
  const logistic = x => 1 / (1 + Math.exp(-x));

  /* Precompute per-series indicator arrays. */
  function prepare(series) {
    const c = closes(series), n = c.length;
    const ind = { c, rsi2: rsiSeries(c, P.rsiShort), atr: atrSeries(series, P.atr),
      sF: new Array(n).fill(NaN), sS: new Array(n).fill(NaN), vol: new Array(n).fill(NaN), dates: series.map(b => b.d), hi: series.map(b => b.h), lo: series.map(b => b.l) };
    let tF = 0, tS = 0;
    for (let i = 0; i < n; i++) {
      tF += c[i]; tS += c[i];
      if (i >= P.smaFast) tF -= c[i - P.smaFast];
      if (i >= P.smaSlow) tS -= c[i - P.smaSlow];
      if (i >= P.smaFast - 1) ind.sF[i] = tF / P.smaFast;
      if (i >= P.smaSlow - 1) ind.sS[i] = tS / P.smaSlow;
      ind.vol[i] = realVol(c, P.volWin, i);
    }
    ind.dateIx = new Map(ind.dates.map((d, i) => [d, i]));
    return ind;
  }

  /* Component scores at index i. xsRank: cross-sectional percentile (0..1) of 12-1 momentum; bench: prepared benchmark + its index. */
  function components(ind, i, xsRank, bench, bi) {
    const { c, sF, sS } = ind;
    if (i < P.momLong || isNaN(sS[i - 20])) return null;
    const trendBits = [c[i] > sS[i], sF[i] > sS[i], c[i] > sF[i], sS[i] > sS[i - 20]];
    const trend = trendBits.filter(Boolean).length / 4;
    const m12 = ret(c, i, P.momLong, P.momSkip), m6 = ret(c, i, P.momMid);
    const mom = 0.35 * (m12 > 0 ? 1 : 0) + 0.15 * (m6 > 0 ? 1 : 0) + 0.5 * (xsRank ?? 0.5);
    let rsx = 0.5, excess = NaN;
    if (bench && bi != null && bi >= P.rs) { excess = ret(c, i, P.rs) - ret(bench.c, bi, P.rs); rsx = logistic(excess / 0.08); }
    const r2 = ind.rsi2[i];
    // Mean-reversion timing: reward short-term pullbacks, penalise stretched moves
    const timing = isNaN(r2) ? 0.5 : (100 - r2) / 100;
    // Volatility: today's 20d vol vs its own 1y median (calmer = better risk/reward)
    const vs = ind.vol.slice(Math.max(0, i - 251), i + 1).filter(v => !isNaN(v)).sort((a, b) => a - b);
    const med = vs[Math.floor(vs.length / 2)];
    const volS = Math.max(0, Math.min(1, 1 - (ind.vol[i] / med - 1)));
    // Long score: the bullish reading of each component. Short score: the exact mirror (volatility counts for both sides).
    const longScore = 100 * (P.w.trend * trend + P.w.mom * mom + P.w.rs * rsx + P.w.timing * timing + P.w.vol * volS);
    const momS = 0.35 * (m12 < 0 ? 1 : 0) + 0.15 * (m6 < 0 ? 1 : 0) + 0.5 * (1 - (xsRank ?? 0.5));
    const shortScore = 100 * (P.w.trend * (1 - trend) + P.w.mom * momS + P.w.rs * (1 - rsx) + P.w.timing * (1 - timing) + P.w.vol * volS);
    // Net bias from -100 (fully bearish) to +100 (fully bullish); the shared volatility term cancels out
    const bias = (longScore - shortScore) / (1 - P.w.vol);
    const hh = Math.max(...ind.hi.slice(i - P.atr + 1, i + 1)), ll = Math.min(...ind.lo.slice(i - P.atr + 1, i + 1));
    const stopL = hh - P.chandMult * ind.atr[i], stopS = ll + P.chandMult * ind.atr[i];
    return { i, date: ind.dates[i], close: c[i], trend, trendBits, mom, momS, m12, m6, rsx, excess, timing, rsi2: r2, volS, vol: ind.vol[i], longScore, shortScore, bias, stopL, stopS, atr: ind.atr[i], sF: sF[i], sS: sS[i] };
  }

  function riskOn(bench, bi) { return bench.c[bi] > bench.sS[bi]; }

  /* Stock rules (long only): BUY / STRONG BUY / HOLD / WAIT / AVOID, or SELL when a held position must close. */
  function decide(x, regimeOn, held = false) {
    const exitHit = x.close < x.sS || x.close < x.stopL || x.longScore < P.exitScore;
    const entryOk = regimeOn && x.trend >= 0.75 && x.m12 > 0 && x.longScore >= P.entryScore;
    let signal, why;
    if (exitHit) {
      const below = x.close < x.sS;
      signal = held ? 'SELL' : below ? 'AVOID' : 'WAIT';
      why = below ? 'Below its 200-day average' : x.close < x.stopL ? 'Fell through its ATR trailing stop; let it reset' : 'Composite score weak';
    } else if (entryOk && x.rsi2 < 20) { signal = 'STRONG BUY'; why = 'Uptrend with a short-term pullback'; }
    else if (entryOk) { signal = 'BUY'; why = x.rsi2 > 90 ? 'Trend and momentum aligned; short-term stretched, scale in' : 'Trend and momentum aligned'; }
    else if (!regimeOn && x.trend >= 0.75) { signal = 'HOLD'; why = 'Strong stock, but market regime is risk-off'; }
    else { signal = 'HOLD'; why = x.trend < 0.75 ? 'Trend not confirmed' : x.m12 <= 0 ? '12-month momentum negative' : 'Score below buy threshold'; }
    const risk = x.close - x.stopL;
    const buy = signal.includes('BUY');
    const posPct = buy && risk > 0 ? Math.min(P.maxPos, P.riskPerTrade * x.close / risk) : 0;
    return { signal, why, stop: x.stopL, target: buy ? x.close + 2 * risk : NaN, posPct, exitHit };
  }

  /* Index rules (short only, used as a hedge): time-series trend following on QQQ and the S&P proxy.
     SHORT when the index is below its 200-day, the 50-day is below the 200-day, the 12-1 month return is negative
     and price is under the short ATR stop. STRONG SHORT when that comes with a 2-day bounce (RSI(2) over 80).
     Cover when price closes back over the 200-day or over the short stop. */
  function decideIndex(x, held = false) {
    const cover = x.close > x.sS || x.close > x.stopS;
    const shortOk = x.close < x.sS && x.sF < x.sS && x.m12 < 0 && x.close < x.stopS;
    let signal, why, side = 0;
    if (held && cover) { signal = 'COVER'; why = x.close > x.sS ? 'Back above its 200-day average' : 'Rose through the short stop'; }
    else if (shortOk) { side = -1; signal = x.rsi2 > 80 ? 'STRONG SHORT' : 'SHORT'; why = x.rsi2 > 80 ? 'Downtrend with a short-term bounce to sell into' : 'Below 200-day, 50 under 200, 12-month return negative'; }
    else {
      signal = 'NO SHORT';
      why = x.close >= x.sS ? 'Above its 200-day average' : x.sF >= x.sS ? 'Below the 200-day, but the 50-day is still above it' : x.m12 >= 0 ? 'Below the 200-day, but the 12-month return is still positive' : 'Just rose through the short stop';
    }
    const risk = x.stopS - x.close;
    return { signal, why, side, stop: x.stopS, target: side ? x.close - 2 * risk : NaN, posPct: side ? P.hedgeW : 0, cover, shortOk };
  }

  /* Cross-sectional ranks of 12-1 momentum on a date across a universe of prepared series. */
  function xsRanks(prepared, date) {
    const vals = [];
    for (const [t, ind] of Object.entries(prepared)) { const i = ind.dateIx.get(date); if (i != null && i >= P.momLong) vals.push([t, ret(ind.c, i, P.momLong, P.momSkip)]); }
    vals.sort((a, b) => a[1] - b[1]);
    const out = {}; vals.forEach(([t], k) => out[t] = vals.length > 1 ? k / (vals.length - 1) : 0.5); return { ranks: out, vals };
  }
  function rankAgainst(vals, v) { if (!vals.length) return 0.5; const below = vals.filter(x => x[1] < v).length; return below / vals.length; }

  /* Latest snapshot for every ticker. */
  function snapshot(prepared, bench) {
    const date = bench.dates[bench.dates.length - 1], bi = bench.dates.length - 1;
    const { ranks } = xsRanks(prepared, date); const on = riskOn(bench, bi);
    const rows = [];
    for (const [t, ind] of Object.entries(prepared)) {
      const i = ind.dateIx.get(date); if (i == null) continue;
      const x = components(ind, i, ranks[t], bench, bi); if (!x) continue;
      rows.push({ ticker: t, ...x, ...decide(x, on, false) });
    }
    return { date, regimeOn: on, bench: { close: bench.c[bi], sma200: bench.sS[bi] }, rows };
  }

  /* Daily backtest. Signals at close t, positions earn the t+1 return.
     Stocks: long only, inverse-volatility weights capped at P.maxPos, halved when QQQ is risk-off.
     opts.hedges: { name: prepared index series } shorted at P.hedgeW each while decideIndex says SHORT. */
  function backtest(prepared, bench, opts = {}) {
    const cost = opts.costBps ?? 10, start = opts.start ?? null, hedges = opts.hedges || {}, hw = opts.hedgeW ?? P.hedgeW;
    const tick = Object.keys(prepared), dates = bench.dates;
    let eq = 1, held = new Set(), w = {}, hpos = {}, curve = [], trades = 0, wins = 0, entryPx = {}, expoSum = 0, hedgeDays = 0, n = 0;
    let longPnl = 0, hedgePnl = 0; const hTrades = {}; for (const h in hedges) hTrades[h] = { n: 0, win: 0, entry: 0 };
    for (let bi = P.momLong + 25; bi < dates.length - 1; bi++) {
      const d = dates[bi]; if (start && d < start) continue;
      const { ranks } = xsRanks(prepared, d); const on = riskOn(bench, bi);
      const cand = {};
      for (const t of tick) {
        const ind = prepared[t], i = ind.dateIx.get(d); if (i == null) continue;
        const x = components(ind, i, ranks[t], bench, bi); if (!x) continue;
        const dec = decide(x, on, held.has(t));
        if (held.has(t) && dec.signal === 'SELL') { held.delete(t); trades++; if (x.close > entryPx[t]) wins++; }
        else if (!held.has(t) && dec.signal.includes('BUY')) { held.add(t); entryPx[t] = x.close; }
        if (held.has(t)) cand[t] = 1 / Math.max(x.vol, 0.1);
      }
      const tot = Object.values(cand).reduce((a, b) => a + b, 0); const nw = {};
      for (const t in cand) nw[t] = Math.min(P.maxPos, cand[t] / tot) * (on ? 1 : 0.5);
      // index hedges
      for (const h in hedges) {
        const ind = hedges[h], i = ind.dateIx.get(d); if (i == null) continue;
        const x = components(ind, i, 0.5, null, null); if (!x) continue;
        const dec = decideIndex(x, !!hpos[h]);
        if (hpos[h] && dec.cover) { hpos[h] = 0; hTrades[h].n++; if (x.close < hTrades[h].entry) hTrades[h].win++; }
        else if (!hpos[h] && dec.shortOk) { hpos[h] = 1; hTrades[h].entry = x.close; }
        if (hpos[h]) nw['@' + h] = -hw;
      }
      let turn = 0; for (const t of new Set([...Object.keys(w), ...Object.keys(nw)])) turn += Math.abs((nw[t] || 0) - (w[t] || 0));
      w = nw;
      let rL = 0, rH = 0, borrow = 0; const nd = dates[bi + 1];
      for (const t in w) {
        const ind = t[0] === '@' ? hedges[t.slice(1)] : prepared[t], i = ind.dateIx.get(d), j = ind.dateIx.get(nd); if (i == null || j == null) continue;
        const r = w[t] * (ind.c[j] / ind.c[i] - 1);
        if (w[t] > 0) rL += r; else { rH += r; borrow += -w[t] * P.borrowBps / 1e4 / 252; }
      }
      eq *= (1 + rL + rH - borrow - turn * cost / 1e4);
      longPnl += rL; hedgePnl += rH - borrow;
      expoSum += Object.entries(w).filter(([t]) => t[0] !== '@').reduce((a, [, v]) => a + v, 0);
      if (Object.keys(w).some(t => t[0] === '@')) hedgeDays++; n++;
      curve.push([nd, eq]);
    }
    return { curve, trades, winRate: trades ? wins / trades : NaN, avgExposure: n ? expoSum / n : 0, hedgeShare: n ? hedgeDays / n : 0,
      longPnl, hedgePnl, hTrades, held: [...held], hedgeOpen: Object.keys(hpos).filter(h => hpos[h]) };
  }

  function stats(curve) {
    if (curve.length < 2) return null;
    const v = curve.map(p => p[1]), r = []; for (let i = 1; i < v.length; i++) r.push(v[i] / v[i - 1] - 1);
    const yrs = r.length / 252, cagr = (v[v.length - 1] / v[0]) ** (1 / yrs) - 1;
    const m = r.reduce((a, b) => a + b, 0) / r.length, sd = stdev(r);
    let pk = -Infinity, mdd = 0; for (const x of v) { pk = Math.max(pk, x); mdd = Math.min(mdd, x / pk - 1); }
    return { cagr, vol: sd * Math.sqrt(252), sharpe: m / sd * Math.sqrt(252), maxDD: mdd, total: v[v.length - 1] / v[0] - 1 };
  }

  const api = { P, prepare, components, decide, decideIndex, riskOn, xsRanks, rankAgainst, snapshot, backtest, stats, sma, rsi };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.Engine = api;
})(this);
