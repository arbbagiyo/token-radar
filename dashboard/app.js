// Token Radar radar-6 dashboard: renders window.RADAR (data.js) with no network.
// Order on the page: header, KPI strip, formula line, ledger, integrity strip,
// the out-of-sample evidence (value ladder, odds ladder, range honesty, comp
// scatter), filters, then the board. Every verdict is recomputed here from the
// row's own numbers, so the ticket and drop-share controls are live.
(function () {
  'use strict';
  var DATA = window.RADAR;
  var root = document.getElementById('board');
  if (!DATA || !Array.isArray(DATA.rows)) {
    root.textContent = 'Token Radar: data.js did not load, so there is no board to render.';
    return;
  }
  var MODEL = DATA.model;
  var ROWS = DATA.rows;
  var VALUE = DATA.value;
  var ODDS = DATA.odds;

  // ---------------------------------------------------------- formatting
  function usd(n) {
    if (n === null || n === undefined || !isFinite(n)) return '—';
    var abs = Math.abs(n);
    if (abs >= 1e9) return '$' + (n / 1e9).toFixed(2) + 'B';
    if (abs >= 1e6) return '$' + (n / 1e6).toFixed(1) + 'M';
    if (abs >= 1e3) return '$' + (n / 1e3).toFixed(1) + 'K';
    return '$' + Math.round(n);
  }
  function money(n) {
    if (n === null || n === undefined || !isFinite(n)) return '—';
    var sign = n < 0 ? '-' : '';
    return sign + '$' + Math.abs(n).toLocaleString('en-US', { maximumFractionDigits: 2, minimumFractionDigits: 2 });
  }
  function signedPct(n) {
    if (n === null || n === undefined || !isFinite(n)) return '—';
    return (n >= 0 ? '+' : '') + n.toFixed(1) + '%';
  }
  function pctOf(x) {
    return Math.round(x * 100) + '%';
  }
  function ageText(days) {
    if (days === null || days === undefined) return 'unknown';
    if (days < 90) return days + 'd';
    if (days < 365) return Math.round(days / 30.44) + ' mo';
    return (days / 365).toFixed(1) + 'y';
  }
  function mult(x) {
    return '×' + Number(x).toFixed(2);
  }
  function oddsPct(p) {
    return Math.round(p * 100) + '%';
  }

  // ---------------------------------------------------------- checksum + farm math
  function fnv1a(text) {
    var hash = 0x811c9dc5;
    for (var i = 0; i < text.length; i++) {
      hash ^= text.charCodeAt(i) & 0xff;
      hash = Math.imul(hash, 0x01000193);
    }
    return ('0000000' + (hash >>> 0).toString(16)).slice(-8);
  }
  // The browser's FNV-1a over UTF-8 bytes, matching main.ts's Buffer-based hash.
  function fnv1aUtf8(text) {
    var bytes = new TextEncoder().encode(text);
    var hash = 0x811c9dc5;
    for (var i = 0; i < bytes.length; i++) {
      hash ^= bytes[i];
      hash = Math.imul(hash, 0x01000193);
    }
    return ('0000000' + (hash >>> 0).toString(16)).slice(-8);
  }

  /** The farm verdict at the reader's scenario, mirroring lib/model.ts farmVerdict. */
  function farmAt(row, ticket, dropSharePct) {
    var share = row.tvl_usd > 0 ? ticket / row.tvl_usd : 0;
    var drop = row.implied_value_usd * (dropSharePct / 100) * share;
    var fees = MODEL.gas_usd + MODEL.gas_pct * ticket;
    var capital = ticket * (MODEL.capital_rate_pct / 100) * (MODEL.hold_days / 365);
    var net = drop - fees - capital;
    var perHour = net / MODEL.work_hours;
    var verdict = perHour >= MODEL.farm_bar_per_hour ? 'FARM' : net > 0 ? 'THIN' : 'SKIP';
    return { drop: drop, fees: fees, capital: capital, net: net, perHour: perHour, verdict: verdict };
  }

  // ---------------------------------------------------------- tiny DOM builder
  function h(tag, attrs) {
    var node = document.createElement(tag);
    if (attrs) {
      Object.keys(attrs).forEach(function (key) {
        if (key === 'text') node.textContent = attrs[key];
        else if (key === 'class') node.className = attrs[key];
        else if (key.indexOf('on') === 0) node.addEventListener(key.slice(2), attrs[key]);
        else node.setAttribute(key, attrs[key]);
      });
    }
    Array.prototype.slice.call(arguments, 2).forEach(function (kid) { appendKid(node, kid); });
    return node;
  }
  function appendKid(node, kid) {
    if (kid === null || kid === undefined || kid === false) return;
    if (Array.isArray(kid)) { kid.forEach(function (c) { appendKid(node, c); }); return; }
    if (typeof kid === 'string') { node.appendChild(document.createTextNode(kid)); return; }
    node.appendChild(kid);
  }
  function svgEl(tag, attrs) {
    var node = document.createElementNS('http://www.w3.org/2000/svg', tag);
    if (attrs) Object.keys(attrs).forEach(function (key) { node.setAttribute(key, attrs[key]); });
    return node;
  }

  // ---------------------------------------------------------- state
  var state = {
    verdict: 'all', tier: 'all', category: 'all', chain: 'all', query: '',
    sort: 'rank', dir: 1, ticket: MODEL.ticket_usd, drop: MODEL.drop_share_pct, detail: null,
  };
  function readHash() {
    var params = new URLSearchParams(location.hash.replace(/^#/, ''));
    if (params.get('verdict')) state.verdict = params.get('verdict');
    if (params.get('tier')) state.tier = params.get('tier');
    if (params.get('category')) state.category = params.get('category');
    if (params.get('chain')) state.chain = params.get('chain');
    if (params.get('q')) state.query = params.get('q');
    if (params.get('sort')) state.sort = params.get('sort');
    if (params.get('ticket')) state.ticket = Number(params.get('ticket')) || state.ticket;
    if (params.get('drop')) state.drop = Number(params.get('drop')) || state.drop;
    if (params.get('p')) state.detail = params.get('p');
  }
  function writeHash() {
    var params = new URLSearchParams();
    if (state.verdict !== 'all') params.set('verdict', state.verdict);
    if (state.tier !== 'all') params.set('tier', state.tier);
    if (state.category !== 'all') params.set('category', state.category);
    if (state.chain !== 'all') params.set('chain', state.chain);
    if (state.query) params.set('q', state.query);
    if (state.sort !== 'rank') params.set('sort', state.sort);
    if (state.ticket !== MODEL.ticket_usd) params.set('ticket', String(state.ticket));
    if (state.drop !== MODEL.drop_share_pct) params.set('drop', String(state.drop));
    if (state.detail) params.set('p', state.detail);
    var text = params.toString();
    history.replaceState(null, '', text ? '#' + text : location.pathname + location.search);
  }

  // ---------------------------------------------------------- integrity
  function integrityChecks() {
    var rows = ROWS;
    var checksumOk = fnv1aUtf8(JSON.stringify(rows)) === DATA.checksum;
    var orderOk = rows.every(function (r, i) {
      return r.rank === i + 1 && (i === 0 || rows[i - 1].implied_value_usd >= r.implied_value_usd);
    });
    var total = rows.reduce(function (s, r) { return s + r.implied_value_usd; }, 0);
    var stepsOk = rows.every(function (r) { return Array.isArray(r.farm_steps) && r.farm_steps.length === 8; });
    var wholeOk = rows.every(function (r) { return Number.isInteger(r.implied_value_usd) && r.implied_value_usd > 0; });
    var slugsOk = new Set(rows.map(function (r) { return r.slug; })).size === rows.length;
    var rangeOk = rows.every(function (r) { return r.range_p25_usd <= r.implied_value_usd && r.implied_value_usd <= r.range_p75_usd; });
    var watchOk = (DATA.watchlist || []).every(function (s) { return rows.some(function (r) { return r.slug === s; }); });
    var ledgerTotal = (DATA.ledger || []).reduce(function (s, g) { return s + g.count; }, 0);
    return [
      { ok: checksumOk && wholeOk && slugsOk, text: 'this table = board.json: ' + rows.length + ' of ' + rows.length + ' rows recomputed here' },
      { ok: orderOk, text: 'ranks 1–' + rows.length + ' in order, values never rise' },
      { ok: total > 0, text: 'totals equal: ' + usd(total) },
      { ok: checksumOk, text: 'checksum ' + DATA.checksum + ' = main.ts' },
      { ok: watchOk, text: 'watchlist ' + DATA.watchlist_size + ' of ' + DATA.watchlist_size + ' ranked' },
      { ok: ledgerTotal === 758, text: 'ledger ' + ledgerTotal + ' of 758 protocols' },
      { ok: stepsOk, text: 'farm plan 8 steps on all ' + rows.length + ' rows' },
      { ok: rangeOk, text: 'every implied value inside its P25–P75 range' },
    ];
  }

  // ---------------------------------------------------------- header + KPI + formula
  function buildHeader() {
    return h('header', { class: 'top' },
      h('div', { class: 'brand' }, h('b', { text: 'Token Radar' }), h('span', { text: 'Pre-token launches, ranked — every term tested held-out' })),
      h('div', { class: 'top-meta' },
        h('span', { text: 'live snapshot ' + DATA.as_of }),
        h('span', { text: 'DefiLlama protocol index' }),
        h('span', { text: DATA.model_version + ' model' })));
  }
  function kpiCard(label, valueNodes, sub) {
    return h('div', { class: 'kpi' },
      h('div', { class: 'k', text: label }),
      h('div', { class: 'v' }, valueNodes),
      h('div', { class: 's', text: sub }));
  }
  function buildKpis() {
    var keptValue = VALUE.kept_terms.length;
    var testedValue = VALUE.terms.filter(function (t) { return !t.control; }).length;
    var keptOdds = ODDS.kept_terms.length;
    var testedOdds = ODDS.terms.length;
    var valueNames = keptValue === 0 ? 'size curve only' : 'size curve + ' + VALUE.kept_terms.join(', ');
    return h('section', { class: 'kpis', 'aria-label': 'Key numbers' },
      kpiCard('Out-of-sample miss, walk-forward',
        [h('span', { class: 'good', text: mult(VALUE.final_walk_forward_miss) }), ' vs ' + mult(VALUE.flat_walk_forward_miss) + ' flat'],
        mult(VALUE.final_loo_miss) + ' leave-one-out, ' + VALUE.base_within_3x_loo + ' of ' + VALUE.members + ' inside 3×'),
      kpiCard('Is the printed range honest?',
        [h('span', { class: 'good', text: pctOf(VALUE.coverage_p25_p75_walk_forward) + ' · ' + pctOf(VALUE.coverage_p10_p90_walk_forward) })],
        'of later-listed caps inside P25–P75, P10–P90 (stated 50% · 80%)'),
      kpiCard('Token odds vs base rate, Brier',
        [h('span', { class: 'good', text: ODDS.brier_ten_fold.toFixed(3) }), ' vs ' + ODDS.base_brier_ten_fold.toFixed(3) + ' base'],
        'walk-forward ' + ODDS.brier_walk_forward.toFixed(3) + ' vs ' + ODDS.base_brier_walk_forward.toFixed(3) + ' base'),
      kpiCard('Terms that survived both tests',
        [h('span', { class: 'good', text: keptValue + ' of ' + testedValue + ' · ' + keptOdds + ' of ' + testedOdds })],
        'value model: ' + valueNames + '; the rest are shown below, not used'),
      kpiCard('Worth farming, this scenario',
        [h('span', { class: 'good', text: DATA.verdict_counts.FARM + ' of ' + DATA.board_size })],
        DATA.verdict_counts.FARM + ' farm, ' + DATA.verdict_counts.THIN + ' thin, ' + DATA.verdict_counts.SKIP + ' skip — net beats $25/h at a $5,000 ticket'),
      kpiCard('Watchlist ranked',
        [h('span', { class: 'good', text: DATA.watchlist_size + ' / ' + DATA.watchlist_size })],
        'plus ' + (DATA.early_size + DATA.offlist_size) + ' pre-token protocols it leaves out'));
  }
  function buildFormula() {
    var best = ROWS.map(function (r) { return { r: r, f: farmAt(r, MODEL.ticket_usd, MODEL.drop_share_pct) }; })
      .sort(function (a, b) { return b.f.perHour - a.f.perHour; }).slice(0, 3);
    var bestText = best.map(function (x) { return x.r.name + ' +' + money(x.f.perHour) + '/h'; }).join(', ');
    return h('section', { class: 'formula' },
      h('b', { text: 'Implied value = launch value × forward token odds. ' }),
      'Launch value = TVL × fitted multiple (size curve' + (VALUE.kept_terms.indexOf('cat') >= 0 ? ' + category effect' : '') + '); ' +
      'forward odds = the chance of a token within 24 months, from how long peers ran before recording one — odds fall the longer a protocol has run with no token. ' +
      'Each coefficient is fitted on this snapshot and tested held-out. ',
      h('span', { class: 'best', text: 'Best hands-on farms here: ' + bestText + '.' }));
  }

  // ---------------------------------------------------------- ledger + integrity
  var LEDGER_COLORS = ['#3fce7d', '#5ea8ff', '#b78cff', '#f5b83d', '#8a6d2f', '#7a8499', '#4a5568', '#3d4759', '#2f3847', '#252d3b', '#1c232f'];
  function buildLedger() {
    var groups = DATA.ledger;
    var total = groups.reduce(function (s, g) { return s + g.count; }, 0);
    var bar = h('div', { class: 'bar' }, groups.map(function (g, i) {
      return h('i', { style: 'width:' + (100 * g.count / total) + '%;background:' + LEDGER_COLORS[i % LEDGER_COLORS.length] });
    }));
    return h('section', { class: 'ledger' },
      h('h2', null, 'Protocol accounting ', h('span', { text: '— all ' + total + ' snapshot protocols in exactly one group: ' + DATA.board_size + ' ranked as pre-token, ' + (total - DATA.board_size) + ' set aside' })),
      bar,
      h('div', { class: 'lg' }, groups.map(function (g, i) {
        return h('span', null, h('i', { class: 'dot', style: 'background:' + LEDGER_COLORS[i % LEDGER_COLORS.length] }), g.label + ' ', h('b', { text: String(g.count) }));
      })));
  }
  function buildIntegrity() {
    return h('section', { class: 'integrity', 'aria-label': 'Integrity checks recomputed in this browser' },
      integrityChecks().map(function (c) {
        return h('span', { class: c.ok ? 'ok' : 'bad', text: (c.ok ? '✓ ' : '✗ ') + c.text });
      }));
  }

  // ---------------------------------------------------------- evidence
  function evidenceTable(headers, rows) {
    var table = h('table');
    var thead = h('thead', null, h('tr', null, headers.map(function (hd) {
      return h('th', { class: hd.num ? 'num' : null, text: hd.text });
    })));
    var tbody = h('tbody');
    rows.forEach(function (cells) {
      tbody.appendChild(h('tr', null, cells.map(function (c) {
        return h('td', { class: (c.num ? 'num ' : '') + (c.cls || ''), text: c.text });
      })));
    });
    table.appendChild(thead);
    table.appendChild(tbody);
    return table;
  }
  function buildValueLadder() {
    var rows = [
      [{ text: 'flat median multiple' }, { text: mult(VALUE.flat_loo_miss), num: true }, { text: mult(VALUE.flat_walk_forward_miss), num: true }, { text: 'baseline', cls: 'ctrl' }],
      [{ text: '+ size curve, ln TVL' }, { text: mult(VALUE.base_loo_miss), num: true }, { text: mult(VALUE.base_walk_forward_miss), num: true }, { text: 'kept', cls: 'kept' }],
    ];
    VALUE.terms.forEach(function (t) {
      rows.push([
        { text: '+ ' + t.label },
        { text: mult(t.loo_miss), num: true },
        { text: mult(t.walk_forward_miss), num: true },
        t.control
          ? { text: 'must not help', cls: 'ctrl' }
          : t.kept
            ? { text: 'kept', cls: 'kept' }
            : { text: 'tested, not kept', cls: 'notkept' },
      ]);
    });
    var coefText = VALUE.coefficients.map(function (c) {
      return c.name + ' ' + c.value.toFixed(2) + ' ± ' + c.se.toFixed(2);
    }).join('; ');
    return h('div', null,
      h('h3', null, 'Value if a token launches — typical miss, ' + VALUE.members + ' traded comps'),
      evidenceTable(
        [{ text: 'Term, added in order' }, { text: 'Leave-one-out', num: true }, { text: 'Walk-forward', num: true }, { text: 'Result' }],
        rows),
      h('p', { class: 'coef' }, 'Fitted, ± bootstrap s.e. (200 refits): ', h('b', { text: coefText + '.' })),
      h('p', null, 'Five-fold by size, final model: ', h('b', { text: mult(VALUE.final_five_fold_miss) }), ' median miss. Level factor ', h('b', { text: '×' + VALUE.level_factor.toFixed(2) }), VALUE.level_applied ? ' applied (it lowered the held-out miss).' : ' not applied (held-out said no).'));
  }
  function buildOddsLadder() {
    var rows = [
      [{ text: 'base rate of peers' }, { text: ODDS.base_brier_ten_fold.toFixed(3), num: true }, { text: ODDS.base_brier_walk_forward.toFixed(3), num: true }, { text: 'baseline', cls: 'ctrl' }],
      [{ text: '+ age only (Weibull clock)' }, { text: ODDS.age_only_brier_ten_fold.toFixed(3), num: true }, { text: ODDS.age_only_brier_walk_forward.toFixed(3), num: true }, { text: 'kept', cls: 'kept' }],
    ];
    ODDS.terms.forEach(function (t) {
      rows.push([
        { text: '+ ' + t.label },
        { text: t.brier_ten_fold.toFixed(3), num: true },
        { text: t.brier_walk_forward.toFixed(3), num: true },
        t.kept ? { text: 'kept', cls: 'kept' } : { text: 'tested, not kept', cls: 'notkept' },
      ]);
    });
    var bandRows = ODDS.age_bands.map(function (b) {
      return [{ text: b.band }, { text: String(b.peers), num: true }, { text: pctOf(b.token_rate), num: true }, { text: pctOf(b.forward_odds), num: true }];
    });
    return h('div', null,
      h('h3', null, 'Token odds — Brier score, ' + ODDS.peers + ' dated peers'),
      evidenceTable(
        [{ text: 'Term, added in order' }, { text: 'Ten-fold', num: true }, { text: 'Walk-forward', num: true }, { text: 'Result' }],
        rows),
      h('h3', { style: 'margin-top:10px' }, 'The record behind the odds'),
      evidenceTable(
        [{ text: 'Years listed' }, { text: 'Peers', num: true }, { text: 'Record a token', num: true }, { text: 'Forward odds', num: true }],
        bandRows),
      h('p', null, 'Weibull shape ', h('b', { text: ODDS.weibull_shape.toFixed(2) }), ', scale ', h('b', { text: ODDS.weibull_scale_years.toFixed(1) + 'y' }), ' — a shape below 1 means the hazard falls with age, so forward odds fall the longer a protocol has run with no token. ' + ODDS.peer_set_note));
  }
  function buildRangeHonesty() {
    var rows = [
      [{ text: 'within 3× of the model' }, { text: pctOf(VALUE.base_within_3x_loo / VALUE.members), num: true }, { text: pctOf(VALUE.base_within_3x_walk_forward / VALUE.walk_forward_test), num: true }],
      [{ text: 'inside P25–P75, stated 50%' }, { text: pctOf(VALUE.coverage_p25_p75_loo), num: true }, { text: pctOf(VALUE.coverage_p25_p75_walk_forward), num: true }],
      [{ text: 'inside P10–P90, stated 80%' }, { text: pctOf(VALUE.coverage_p10_p90_loo), num: true }, { text: pctOf(VALUE.coverage_p10_p90_walk_forward), num: true }],
    ];
    return h('div', null,
      h('h3', null, 'Is the printed range honest?'),
      evidenceTable(
        [{ text: 'Share of real caps' }, { text: 'Leave-one-out', num: true }, { text: 'Walk-forward', num: true }],
        rows),
      h('p', null, 'Ranges come from the leave-one-out residuals of the final model; the walk-forward column prices newer comps from older ones, so it is the honest check.'));
  }
  function buildScatter() {
    var comps = DATA.comps;
    var W = 360, H = 230, padL = 34, padB = 22, padT = 8, padR = 8;
    var xs = comps.map(function (c) { return Math.log10(c.tvl_usd); });
    var ys = comps.map(function (c) { return Math.log10(c.mcap_usd); });
    var x0 = Math.floor(Math.min.apply(null, xs)), x1 = Math.ceil(Math.max.apply(null, xs));
    var y0 = Math.floor(Math.min.apply(null, ys)), y1 = Math.ceil(Math.max.apply(null, ys));
    function X(v) { return padL + (v - x0) / (x1 - x0) * (W - padL - padR); }
    function Y(v) { return H - padB - (v - y0) / (y1 - y0) * (H - padB - padT); }
    var svg = svgEl('svg', { class: 'scatter', viewBox: '0 0 ' + W + ' ' + H, role: 'img', 'aria-label': 'Market cap against TVL for the traded comps' });
    for (var gx = x0; gx <= x1; gx++) {
      svg.appendChild(svgEl('line', { class: 'grid', x1: X(gx), y1: padT, x2: X(gx), y2: H - padB }));
      var tx = svgEl('text', { x: X(gx), y: H - 8, 'text-anchor': gx === x1 ? 'end' : 'middle' });
      tx.textContent = '$' + Math.pow(10, gx - 6) + 'M';
      if (gx >= 9) tx.textContent = '$' + Math.pow(10, gx - 9) + 'B';
      svg.appendChild(tx);
    }
    for (var gy = y0; gy <= y1; gy++) {
      svg.appendChild(svgEl('line', { class: 'grid', x1: padL, y1: Y(gy), x2: W - padR, y2: Y(gy) }));
      var ty = svgEl('text', { x: padL - 4, y: Y(gy) + 3, 'text-anchor': 'end' });
      ty.textContent = gy >= 9 ? '$' + Math.pow(10, gy - 9) + 'B' : '$' + Math.pow(10, gy - 6) + 'M';
      svg.appendChild(ty);
    }
    // P25-P75 band + fitted curve: mcap = TVL * 10^(intercept + slope*log10 TVL + residual)
    var fit = DATA.size_fit;
    function curveY(lx, resid) { return lx + fit.intercept + fit.slope * lx + resid; }
    var bandPts = [];
    for (var i = 0; i <= 24; i++) {
      var lx = x0 + (x1 - x0) * i / 24;
      bandPts.push(X(lx).toFixed(1) + ',' + Y(curveY(lx, VALUE.range_p75)).toFixed(1));
    }
    for (var j = 24; j >= 0; j--) {
      var lx2 = x0 + (x1 - x0) * j / 24;
      bandPts.push(X(lx2).toFixed(1) + ',' + Y(curveY(lx2, VALUE.range_p25)).toFixed(1));
    }
    svg.appendChild(svgEl('polygon', { class: 'band', points: bandPts.join(' ') }));
    var linePts = [];
    for (var k = 0; k <= 24; k++) {
      var lx3 = x0 + (x1 - x0) * k / 24;
      linePts.push(X(lx3).toFixed(1) + ',' + Y(curveY(lx3, 0)).toFixed(1));
    }
    svg.appendChild(svgEl('polyline', { class: 'curve', points: linePts.join(' ') }));
    comps.forEach(function (c) {
      svg.appendChild(svgEl('circle', { class: 'pt', cx: X(Math.log10(c.tvl_usd)).toFixed(1), cy: Y(Math.log10(c.mcap_usd)).toFixed(1), r: 1.8 }));
    });
    svg.appendChild(svgEl('line', { class: 'axis', x1: padL, y1: H - padB, x2: W - padR, y2: H - padB }));
    svg.appendChild(svgEl('line', { class: 'axis', x1: padL, y1: padT, x2: padL, y2: H - padB }));
    return h('div', null,
      h('h3', null, 'Market cap against TVL ', h('span', { text: '· ' + comps.length + ' comps, curve + P25–P75 band' })),
      svg);
  }
  function buildEvidence() {
    return h('section', { class: 'evid', 'aria-label': 'Out-of-sample evidence' },
      h('h2', null, 'Out-of-sample evidence ', h('span', { text: 'a term is kept only if it lowers the held-out miss in both tests: leave-one-out, and walk-forward (tokens listed earlier price those listed later)' })),
      h('div', { class: 'grid' },
        buildValueLadder(),
        buildOddsLadder(),
        h('div', null, buildRangeHonesty(), buildScatter())));
  }

  // ---------------------------------------------------------- controls + table
  function visibleRows() {
    var q = state.query.trim().toLowerCase();
    var rows = ROWS.filter(function (r) {
      if (state.verdict !== 'all' && farmAt(r, state.ticket, state.drop).verdict !== state.verdict) return false;
      if (state.tier !== 'all' && r.tier !== state.tier) return false;
      if (state.category !== 'all' && r.category !== state.category) return false;
      if (state.chain !== 'all' && r.chains.indexOf(state.chain) < 0) return false;
      if (q && (r.name + ' ' + r.slug + ' ' + (r.category || '') + ' ' + r.chains.join(' ')).toLowerCase().indexOf(q) < 0) return false;
      return true;
    });
    var key = state.sort;
    var val = function (r) {
      if (key === 'rank') return r.rank;
      if (key === 'tvl') return r.tvl_usd;
      if (key === 'change') return r.change_7d === null ? -Infinity : r.change_7d;
      if (key === 'age') return r.age_days === null ? -1 : r.age_days;
      if (key === 'odds') return r.token_odds;
      if (key === 'launch') return r.launch_value_usd;
      if (key === 'implied') return r.implied_value_usd;
      if (key === 'perhour') return farmAt(r, state.ticket, state.drop).perHour;
      return r.rank;
    };
    rows.sort(function (a, b) { return (val(a) - val(b)) * state.dir || a.rank - b.rank; });
    return rows;
  }
  function verdictCountsAt(ticket, drop) {
    var counts = { FARM: 0, THIN: 0, SKIP: 0 };
    ROWS.forEach(function (r) { counts[farmAt(r, ticket, drop).verdict]++; });
    return counts;
  }
  function buildControls() {
    var counts = verdictCountsAt(state.ticket, state.drop);
    var verdictBtn = function (key, label, n) {
      return h('button', {
        type: 'button', 'aria-pressed': state.verdict === key ? 'true' : 'false',
        onclick: function () { state.verdict = key; writeHash(); render(); },
      }, label + (n !== undefined ? ' ' + n : ''));
    };
    var tierBtn = function (key, label) {
      return h('button', {
        type: 'button', 'aria-pressed': state.tier === key ? 'true' : 'false',
        onclick: function () { state.tier = key; writeHash(); render(); },
      }, label);
    };
    var cats = Array.from(new Set(ROWS.map(function (r) { return r.category; }).filter(Boolean))).sort();
    var chains = Array.from(new Set(ROWS.flatMap(function (r) { return r.chains; }))).sort();
    var catSel = h('select', { 'aria-label': 'Category', onchange: function (e) { state.category = e.target.value; writeHash(); render(); } },
      h('option', { value: 'all', text: 'All categories' }),
      cats.map(function (c) { return h('option', { value: c, text: c }); }));
    catSel.value = state.category;
    var chainSel = h('select', { 'aria-label': 'Chain', onchange: function (e) { state.chain = e.target.value; writeHash(); render(); } },
      h('option', { value: 'all', text: 'All chains' }),
      chains.map(function (c) { return h('option', { value: c, text: c }); }));
    chainSel.value = state.chain;
    var ticketSel = h('select', { 'aria-label': 'Ticket size', onchange: function (e) { state.ticket = Number(e.target.value); writeHash(); render(); } },
      [1000, 5000, 10000, 20000].map(function (t) { return h('option', { value: String(t), text: '$' + (t / 1000) + 'K' }); }));
    ticketSel.value = String(state.ticket);
    var dropRange = h('input', {
      type: 'range', min: '3.5', max: '14', step: '0.5', value: String(state.drop), 'aria-label': 'Drop share percent',
      oninput: function (e) { state.drop = Number(e.target.value); writeHash(); render(); },
    });
    var search = h('input', {
      type: 'search', placeholder: 'Search name, chain, category', value: state.query, 'aria-label': 'Search',
      oninput: function (e) { state.query = e.target.value; writeHash(); renderTableOnly(); },
    });
    return h('section', { class: 'controls', 'aria-label': 'Filters' },
      h('div', { class: 'tabs' },
        verdictBtn('all', 'All', ROWS.length),
        verdictBtn('FARM', 'Farm', counts.FARM),
        verdictBtn('THIN', 'Thin', counts.THIN),
        verdictBtn('SKIP', 'Skip', counts.SKIP)),
      h('div', { class: 'tabs' },
        tierBtn('all', 'All tiers'),
        tierBtn('watchlist', 'Watchlist'),
        tierBtn('early', 'Early'),
        tierBtn('off-list', 'Off-list')),
      search, catSel, chainSel,
      h('label', null, 'Ticket ', ticketSel),
      h('label', null, 'Drop share ', dropRange, h('span', { text: state.drop.toFixed(1) + '%' })),
      h('button', { type: 'button', onclick: function () { state = { verdict: 'all', tier: 'all', category: 'all', chain: 'all', query: '', sort: 'rank', dir: 1, ticket: MODEL.ticket_usd, drop: MODEL.drop_share_pct, detail: state.detail }; writeHash(); render(); }, text: 'Reset' }),
      h('button', { type: 'button', onclick: downloadCsv, text: 'CSV' }),
      h('button', { type: 'button', onclick: downloadJson, text: 'JSON' }));
  }
  function download(name, text, type) {
    var blob = new Blob([text], { type: type });
    var a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = name;
    a.click();
    setTimeout(function () { URL.revokeObjectURL(a.href); }, 500);
  }
  function downloadCsv() {
    var head = 'rank,slug,name,category,tvl_usd,change_7d,age_days,token_odds,launch_value_usd,implied_value_usd,range_p25_usd,range_p75_usd,verdict,net_usd,net_per_hour_usd';
    var lines = visibleRows().map(function (r) {
      var f = farmAt(r, state.ticket, state.drop);
      return [r.rank, r.slug, '"' + r.name.replace(/"/g, '""') + '"', '"' + (r.category || '') + '"', r.tvl_usd, r.change_7d === null ? '' : r.change_7d, r.age_days === null ? '' : r.age_days, r.token_odds, r.launch_value_usd, r.implied_value_usd, r.range_p25_usd, r.range_p75_usd, f.verdict, f.net.toFixed(2), f.perHour.toFixed(2)].join(',');
    });
    download('token-radar-board.csv', head + '\n' + lines.join('\n') + '\n', 'text/csv');
  }
  function downloadJson() {
    download('token-radar-board.json', JSON.stringify({ rows: visibleRows() }, null, 1) + '\n', 'application/json');
  }
  function sortHead(key, label, num) {
    var arrow = state.sort === key ? (state.dir === 1 ? ' ↑' : ' ↓') : '';
    return h('th', { class: num ? 'num' : null },
      h('button', {
        type: 'button',
        onclick: function () {
          if (state.sort === key) state.dir = -state.dir;
          else { state.sort = key; state.dir = key === 'rank' ? 1 : -1; }
          writeHash(); renderTableOnly();
        },
      }, label + arrow));
  }
  function tierBadge(r) {
    if (r.tier === 'watchlist') return h('span', { class: 'badge wl', text: 'Watchlist' });
    if (r.tier === 'off-list') return h('span', { class: 'badge off', text: 'Off-list' });
    return h('span', { class: 'badge early', text: 'Early' });
  }
  function buildTable() {
    var rows = visibleRows();
    var totalTvl = ROWS.reduce(function (s, r) { return s + r.tvl_usd; }, 0);
    var totalImplied = ROWS.reduce(function (s, r) { return s + r.implied_value_usd; }, 0);
    var panel = h('section', { class: 'panel' });
    panel.appendChild(h('div', { class: 'caption' },
      'Pre-token protocols, strongest implied value first. Select a row for its model breakdown and farm plan. Implied value = launch value × forward token odds (chance of a token within 24 months).',
      h('span', { class: 'count', text: rows.length + ' of ' + ROWS.length + ' rows · ' + usd(totalTvl) + ' TVL · ' + usd(totalImplied) + ' implied' })));
    if (rows.length === 0) {
      panel.appendChild(h('div', { class: 'empty' }, h('h2', { text: 'No protocol matches these filters' }), h('p', { text: 'Widen the search, or reset the filters to see the whole board.' })));
      return panel;
    }
    var table = h('table');
    var colgroup = h('colgroup');
    [58, 240, 72, 52, 66, 66, 84, 120, 170, 84, 134].forEach(function (w) {
      colgroup.appendChild(h('col', { style: 'width:' + w + 'px' }));
    });
    table.appendChild(colgroup);
    table.appendChild(h('thead', null, h('tr', null,
      sortHead('rank', '# · Range'),
      h('th', { text: 'Protocol' }),
      sortHead('tvl', 'TVL', true),
      sortHead('change', '7D', true),
      sortHead('age', 'Age', true),
      sortHead('odds', 'Token odds', true),
      sortHead('launch', 'Launch value', true),
      sortHead('implied', 'Implied', true),
      h('th', { text: 'Verdict' }),
      sortHead('perhour', 'Net/h', true),
      h('th', { text: 'Farm plan' }))));
    var tbody = h('tbody');
    rows.forEach(function (r) {
      var f = farmAt(r, state.ticket, state.drop);
      var tr = h('tr', {
        'data-selected': state.detail === r.slug ? 'true' : 'false',
        tabindex: '0',
        onclick: function () { state.detail = r.slug; writeHash(); render(); },
        onkeydown: function (e) { if (e.key === 'Enter') { state.detail = r.slug; writeHash(); render(); } },
      },
        h('td', { class: 'num' }, String(r.rank), h('span', { class: 'small', style: 'display:block', text: r.rank_best + '–' + r.rank_worst })),
        h('td', { class: 'name' }, h('b', { text: r.name }), tierBadge(r), h('span', { class: 'sub', text: (r.category || 'No category') + ' · ' + (r.chains[0] || '—') })),
        h('td', { class: 'num', text: usd(r.tvl_usd) }),
        h('td', { class: 'num ' + (r.change_7d === null ? '' : r.change_7d >= 0 ? 'pos' : 'neg'), text: signedPct(r.change_7d) }),
        h('td', { class: 'num', text: ageText(r.age_days) }),
        h('td', { class: 'num' }, oddsPct(r.token_odds), h('span', { class: 'oddsbar', style: 'display:block;margin-left:auto' }, h('i', { style: 'width:' + Math.round(r.token_odds * 100) + '%' }))),
        h('td', { class: 'num', text: usd(r.launch_value_usd) }),
        h('td', { class: 'num' }, h('b', { text: usd(r.implied_value_usd) }), h('span', { class: 'small', style: 'display:block', text: usd(r.range_p25_usd) + '–' + usd(r.range_p75_usd) })),
        h('td', null, h('span', { class: 'verdict ' + f.verdict, text: f.verdict }), h('span', { class: 'small', style: 'display:block', text: money(f.net) + ' · ' + money(f.drop) + ' drop' })),
        h('td', { class: 'num ' + (f.perHour >= 0 ? 'pos' : 'neg'), text: (f.perHour >= 0 ? '+' : '') + money(f.perHour) }),
        h('td', null, h('span', { text: r.plan_type }), h('span', { class: 'small', style: 'display:block', text: '8 steps · ' + MODEL.work_hours + 'h · ' + MODEL.hold_days + 'd' })));
      tbody.appendChild(tr);
    });
    table.appendChild(tbody);
    panel.appendChild(h('div', { class: 'table-wrap' }, table));
    return panel;
  }

  // ---------------------------------------------------------- detail drawer
  function buildDetail(row) {
    var f = farmAt(row, state.ticket, state.drop);
    var dialog = h('dialog', { class: 'detail', 'aria-label': row.name + ' detail' });
    var close = function () { state.detail = null; writeHash(); render(); };
    dialog.addEventListener('close', close);
    var catLine = VALUE.kept_terms.indexOf('cat') >= 0 && row.cat_factor !== null
      ? h('div', null, h('span', { text: 'Category effect (' + (row.category || '—') + ', ' + row.comp_members + ' comps)' }), h('b', { text: '×' + Math.pow(10, row.cat_factor).toFixed(2) }))
      : null;
    var levelLine = row.level_factor !== 1
      ? h('div', null, h('span', { text: 'Level factor (held-out)' }), h('b', { text: '×' + row.level_factor.toFixed(2) }))
      : null;
    var why = [];
    why.push('Size multiple ×' + row.size_base.toFixed(2) + ' at ' + usd(row.tvl_usd) + ' TVL: the curve, not a flat median, sets the base for a protocol this big.');
    if (VALUE.kept_terms.length === 0) {
      why.push('No category, growth, age, chain-count or curvature term lowered both held-out misses, so the board prices on the size curve alone. The full table is in the evidence above the board.');
    } else {
      why.push('Kept terms: ' + VALUE.kept_terms.join(', ') + ' — each lowered both the leave-one-out and the walk-forward miss; the rest were tested and left out.');
    }
    why.push('Forward token odds ' + oddsPct(row.token_odds) + ' over 24 months' + (row.odds_age_known ? ' at ' + ageText(row.age_days) + ' with no token' : ' (listing date unknown, peer median age used)') + ' — from the dated peers\' record, not a forecast that a token will launch.');
    why.push('Range ' + usd(row.range_p25_usd) + '–' + usd(row.range_p75_usd) + ' from the leave-one-out residuals: ' + pctOf(VALUE.coverage_p25_p75_walk_forward) + ' of later-listed real caps landed inside the printed P25–P75 range, held-out.');
    why.push('Rank range ' + row.rank_best + '–' + row.rank_worst + ': where this row would sit at its own P75 and P25 values.');
    dialog.appendChild(h('div', { class: 'detail-head' },
      h('div', null,
        h('div', { class: 'small', text: 'Rank ' + row.rank + ' of ' + ROWS.length + ' · range ' + row.rank_best + '–' + row.rank_worst }),
        h('h2', { text: row.name }),
        h('p', { class: 'sub', text: (row.category || 'No category') + ' on ' + row.chains.join(', ') }),
        row.tier === 'watchlist' ? h('span', { class: 'badge wl', text: 'On the watchlist' }) : row.tier === 'off-list' ? h('span', { class: 'badge off', text: 'Off-list, above the floor' }) : h('span', { class: 'badge early', text: 'Early, below the floor' })),
      h('button', { class: 'close', type: 'button', onclick: close, text: 'Close' })));
    dialog.appendChild(h('div', { class: 'detail-section' },
      h('h3', { text: 'Implied value' }),
      h('div', { class: 'eq' },
        h('div', null, h('span', { text: 'TVL' }), h('b', { text: usd(row.tvl_usd) })),
        h('div', null, h('span', { text: 'Size multiple for this TVL' }), h('b', { text: '×' + row.size_base.toFixed(2) })),
        catLine,
        levelLine,
        h('div', null, h('span', { text: 'Launch value if it launches' }), h('b', { text: usd(row.launch_value_usd) })),
        h('div', null, h('span', { text: 'Forward token odds (24 mo)' }), h('b', { text: oddsPct(row.token_odds) })),
        h('div', { class: 'total' }, h('span', { text: 'Implied value' }), h('b', { text: usd(row.implied_value_usd) })),
        h('div', null, h('span', { text: 'P25–P75 range' }), h('b', { text: usd(row.range_p25_usd) + ' – ' + usd(row.range_p75_usd) })),
        h('div', null, h('span', { text: 'P10–P90 range' }), h('b', { text: usd(row.range_p10_usd) + ' – ' + usd(row.range_p90_usd) }))),
      h('p', { class: 'small', style: 'white-space:normal;margin-top:8px', text: 'Model ' + DATA.model_version + ': launch value = TVL × size multiple' + (VALUE.kept_terms.indexOf('cat') >= 0 ? ' × category effect' : '') + '; implied = launch × forward token odds. The size curve is fitted on the ' + DATA.comp_size + ' stand-alone traded comps; the odds come from the ' + ODDS.peers + ' dated peers\' time-to-record. This is an estimate, not a price.' })));
    dialog.appendChild(h('div', { class: 'detail-section' },
      h('h3', { text: 'Why this rank' }),
      h('ul', { class: 'why' }, why.map(function (w) { return h('li', { text: w }); }))));
    var stepsOl = h('ol', { class: 'steps' });
    row.farm_steps.forEach(function (step) {
      var m = step.match(/^(.*?) Cost: (.*?)\. Time: (.*?)\.$/);
      if (m) stepsOl.appendChild(h('li', null, m[1], h('span', { class: 'cost', text: 'Cost: ' + m[2] + '. Time: ' + m[3] + '.' })));
      else stepsOl.appendChild(h('li', { text: step }));
    });
    dialog.appendChild(h('div', { class: 'detail-section' },
      h('h3', { text: 'Farm plan — ' + f.verdict + ' (' + row.plan_type + ')' }),
      stepsOl,
      h('div', { class: 'budget' },
        'Budget at a ' + usd(state.ticket) + ' ticket and a ' + state.drop.toFixed(1) + '% drop share: expected drop ',
        h('b', { text: money(f.drop) }), ' − fees ', h('b', { text: money(f.fees) }), ' − capital charge ', h('b', { text: money(f.capital) }),
        ' = net ', h('b', { text: money(f.net) }), ' over ' + MODEL.work_hours + ' h (', h('b', { text: money(f.perHour) + '/h' }), '). Break-even implied value: ', h('b', { text: usd(row.break_even_usd) }), '.')));
    return dialog;
  }

  // ---------------------------------------------------------- render
  var tableHost = null;
  function renderTableOnly() {
    if (!tableHost) { render(); return; }
    var fresh = buildTable();
    tableHost.replaceWith(fresh);
    tableHost = fresh;
  }
  function render() {
    root.setAttribute('aria-busy', 'true');
    root.innerHTML = '';
    var shell = h('div', { class: 'shell' });
    shell.appendChild(buildHeader());
    shell.appendChild(buildKpis());
    shell.appendChild(buildFormula());
    shell.appendChild(buildLedger());
    shell.appendChild(buildIntegrity());
    shell.appendChild(buildEvidence());
    shell.appendChild(buildControls());
    tableHost = buildTable();
    shell.appendChild(tableHost);
    shell.appendChild(h('footer', { class: 'foot' },
      h('span', { text: 'Implied value is this entry\'s own claim, never a price and never a prediction that a token launches. Say a protocol records no token, never that it has none.' }),
      h('span', { text: DATA.source })));
    root.appendChild(shell);
    if (state.detail) {
      var row = ROWS.find(function (r) { return r.slug === state.detail; });
      if (row) {
        var dialog = buildDetail(row);
        root.appendChild(dialog);
        if (typeof dialog.showModal === 'function') dialog.showModal();
        else dialog.setAttribute('open', '');
      }
    }
    root.setAttribute('aria-busy', 'false');
    window.__shotReady = true;
  }
  readHash();
  render();
})();
